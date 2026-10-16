"""Deterministic data preflight and reversible sanitation.

The model may explain or extend these findings, but it never decides basic facts such as
duplicate counts, missing values, or whether the original file was modified.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event
from typing import Any, Literal

import numpy as np
import pandas as pd

from app.services.file_formats import JSON_FILE_FORMATS
from app.services.file_formats import SUPPORTED_FILE_FORMATS as SUPPORTED_FILE_FORMATS
from app.services.result_filters import build_revenue_refund_option_strategies
from app.services.sanitation_contract import (
    EXECUTABLE_SANITATION_OPERATIONS,
    SANITATION_PROVENANCE_OPERATIONS,
    canonicalize_sanitation_operations,
    executable_sanitation_operations,
)
from app.services.semantic_field_roles import (
    SEMANTIC_ROLE_INFERENCE_VERSION,
    has_identifier_semantics,
    has_monetary_semantics,
    has_refund_semantics,
    has_time_semantics,
    infer_semantic_field_role,
)

TOTAL_MARKERS = {"total", "grand total", "subtotal", "合计", "总计", "小计"}
REVENUE_INTENT_TERMS = (
    "收入",
    "营收",
    "销售额",
    "销售",
    "gmv",
    "实付",
    "支付金额",
    "金额",
    "退款",
    "净额",
    "毛利",
    "利润",
    "revenue",
    "sales",
    "refund",
    "amount",
    "profit",
)
RECIPE_METADATA_OPERATIONS = SANITATION_PROVENANCE_OPERATIONS
SUPPORTED_RECIPE_OPERATIONS = EXECUTABLE_SANITATION_OPERATIONS


class PreflightInputError(ValueError):
    """Known user-correctable failures, without exposing arbitrary exception text."""

    def __init__(
        self,
        message: str,
        *,
        code: Literal[
            "xlsx_formula_result_missing",
            "xlsx_cell_error",
            "xlsx_expanded_limit",
            "xlsx_metadata_limit",
            "parquet_schema_unsupported",
            "parquet_size_limit",
            "parquet_unreadable",
            "json_unreadable",
            "json_structure_unsupported",
            "json_size_limit",
            "json_lines_invalid",
        ],
        sheet: str = "",
        cell: str = "",
        line: int | None = None,
    ):
        super().__init__(message)
        self.presentation_code = code
        self.presentation_facts: dict[str, str | int] = {"sheet": sheet[:128], "cell": cell[:16]}
        if line is not None:
            self.presentation_facts["line"] = line


@dataclass(slots=True)
class PreflightResult:
    status: str
    summary: str
    issues: list[dict[str, Any]] = field(default_factory=list)
    ambiguities: list[dict[str, Any]] = field(default_factory=list)
    inferred_schema: dict[str, Any] = field(default_factory=dict)
    source_snapshot: dict[str, Any] = field(default_factory=dict)
    operations: list[dict[str, Any]] = field(default_factory=list)
    input_fingerprint: str = ""
    output_fingerprint: str = ""
    working_path: Path | None = None


def fingerprint_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalize_name(value: Any, index: int) -> str:
    name = re.sub(r"\s+", " ", str(value or "").strip())
    if not name or name.lower().startswith("unnamed"):
        return f"column_{index + 1}"
    return name


def _dedupe_columns(columns: list[Any]) -> list[str]:
    counts: dict[str, int] = {}
    used: set[str] = set()
    normalized: list[str] = []
    for index, column in enumerate(columns):
        base = _normalize_name(column, index)
        counts[base] = counts.get(base, 0) + 1
        name = base if counts[base] == 1 else f"{base}_{counts[base]}"
        while name.casefold() in used:
            counts[base] += 1
            name = f"{base}_{counts[base]}"
        used.add(name.casefold())
        normalized.append(name)
    return normalized


def _header_score(row: pd.Series) -> tuple[int, int]:
    values = [
        str(value).strip() for value in row.tolist() if pd.notna(value) and str(value).strip()
    ]
    textual = sum(not re.fullmatch(r"[-+]?\d+(\.\d+)?", value) for value in values)
    return textual, len(set(values))


def _recipe_steps(operations: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return executable_sanitation_operations(operations)


def _recipe_step(operations: list[dict[str, Any]], operation: str) -> dict[str, Any] | None:
    return next((item for item in operations if item.get("operation") == operation), None)


def _read_tabular(
    path: Path,
    recipe_operations: list[dict[str, Any]] | None = None,
) -> tuple[pd.DataFrame, int, dict[str, Any]]:
    """Remaining materialized readers; the other formats use bounded staging."""
    suffix = path.suffix.lower().lstrip(".")
    if suffix != "xls":
        raise ValueError(f"不支持的文件格式: {suffix}")

    recipe_operations = recipe_operations or []
    header_step = _recipe_step(recipe_operations, "select_header")
    headerless = _recipe_step(recipe_operations, "use_generated_headers") is not None
    requested_header = None
    if header_step is not None:
        try:
            requested_header = max(0, int(header_step.get("row", 1)) - 1)
        except (TypeError, ValueError):
            requested_header = None
    sheet_step = _recipe_step(recipe_operations, "select_sheet")
    requested_sheet = (
        str(sheet_step.get("sheet")) if sheet_step and sheet_step.get("sheet") else None
    )
    replay_drift: list[str] = []

    with pd.ExcelFile(path) as workbook:
        sheet_candidates: list[tuple[tuple[int, int], int, str]] = []
        sheet_profiles: list[dict[str, Any]] = []
        sheets_to_probe = (
            [requested_sheet]
            if requested_sheet and requested_sheet in workbook.sheet_names
            else workbook.sheet_names
        )
        for sheet_name in sheets_to_probe:
            raw = pd.read_excel(workbook, sheet_name=sheet_name, header=None, nrows=12)
            if len(raw.index):
                header_row = max(
                    range(len(raw.index)), key=lambda index: _header_score(raw.iloc[index])
                )
                score = _header_score(raw.iloc[header_row])
            else:
                header_row, score = 0, (0, 0)
            sheet_candidates.append((score, header_row, sheet_name))
            data_rows = (
                int(raw.iloc[header_row + 1 :].dropna(axis=0, how="all").shape[0])
                if len(raw.index) > header_row + 1
                else 0
            )
            sheet_profiles.append(
                {
                    "name": str(sheet_name),
                    "header_row": int(header_row),
                    "textual_headers": int(score[0]),
                    "unique_headers": int(score[1]),
                    "sample_data_rows": data_rows,
                    "credible_table": score[1] >= 2 and data_rows >= 1,
                    "quality_score": int(score[1] * 2 + min(data_rows, 10)),
                }
            )
        _, inferred_header, inferred_sheet = max(sheet_candidates)
        if requested_sheet and requested_sheet in workbook.sheet_names:
            selected_sheet = requested_sheet
            selected_raw = pd.read_excel(workbook, sheet_name=selected_sheet, header=None, nrows=12)
            selected_inferred_header = (
                max(
                    range(len(selected_raw.index)),
                    key=lambda index: _header_score(selected_raw.iloc[index]),
                )
                if len(selected_raw.index)
                else 0
            )
        else:
            selected_sheet = inferred_sheet
            selected_raw = pd.read_excel(workbook, sheet_name=selected_sheet, header=None, nrows=12)
            selected_inferred_header = inferred_header
            if requested_sheet:
                replay_drift.append(f"原配方指定的工作表“{requested_sheet}”已不存在")
        header_row = selected_inferred_header
        if requested_header is not None:
            requested_raw = pd.read_excel(
                workbook,
                sheet_name=selected_sheet,
                header=None,
                skiprows=requested_header,
                nrows=1,
                keep_default_na=False,
            )
            if len(requested_raw.index) and any(
                pd.notna(value) and str(value) != "" for value in requested_raw.iloc[0]
            ):
                header_row = requested_header
            else:
                replay_drift.append(f"原配方指定的第 {requested_header + 1} 行表头已不存在")
        if headerless:
            frame = pd.read_excel(
                workbook,
                sheet_name=selected_sheet,
                header=None,
                dtype=object,
                keep_default_na=False,
            )
            # Preserve stored strings rather than inferring types from invented
            # field names. Real empty cells still participate in blank cleanup.
            frame = frame.replace("", None).infer_objects()
            frame.columns = _dedupe_columns([None] * len(frame.columns))
            header_row = -1
        else:
            frame = pd.read_excel(workbook, sheet_name=selected_sheet, header=header_row)
        return (
            frame,
            int(header_row),
            {
                "selected_sheet": selected_sheet,
                "header_row": None if headerless else int(header_row) + 1,
                "has_header": not headerless,
                "sheet_names": workbook.sheet_names,
                "sheet_profiles": sheet_profiles,
                "recipe_replay_drift": replay_drift,
            },
        )


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if np.isnan(value) else float(value)
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    if pd.isna(value):
        return None
    return value


def compare_working_copies(
    before_path: Path,
    after_path: Path,
    *,
    profile_columns: list[str] | None = None,
    cancelled: Event | None = None,
) -> dict[str, Any]:
    """Keep the public cleaning API on the shared exact, bounded comparison path."""
    from app.services.working_copy_comparison import compare_working_copies as compare

    return compare(before_path, after_path, profile_columns=profile_columns, cancelled=cancelled)


def _convert_currency(series: pd.Series) -> tuple[pd.Series, bool, int]:
    if not (
        pd.api.types.is_object_dtype(series.dtype) or pd.api.types.is_string_dtype(series.dtype)
    ):
        return series, False, 0
    non_null = series.dropna().astype(str)
    if non_null.empty:
        return series, False, 0
    cleaned = non_null.str.replace(r"[￥¥$€£,\s]", "", regex=True).str.replace(
        r"^\((.*)\)$", r"-\1", regex=True
    )
    converted = pd.to_numeric(cleaned, errors="coerce")
    if converted.notna().mean() < 0.85:
        return series, False, int(converted.isna().sum())
    result = pd.to_numeric(
        series.astype(str)
        .str.replace(r"[￥¥$€£,\s]", "", regex=True)
        .str.replace(r"^\((.*)\)$", r"-\1", regex=True),
        errors="coerce",
    )
    return result, True, int(converted.isna().sum())


def _infer_and_clean_types(
    frame: pd.DataFrame,
    operations: list[dict[str, Any]],
    issues: list[dict[str, Any]],
    recipe_operations: list[dict[str, Any]] | None = None,
    replay_drift: list[str] | None = None,
) -> pd.DataFrame:
    recipe_operations = recipe_operations or []
    replay_drift = replay_drift if replay_drift is not None else []
    expected_columns = {
        operation: {
            str(item.get("column"))
            for item in recipe_operations
            if item.get("operation") == operation and item.get("column")
        }
        for operation in (
            "trim_text",
            "normalize_currency",
            "normalize_datetime",
            "fill_missing",
            "replace_text_values",
        )
    }
    available_columns = {str(column) for column in frame.columns}
    for operation, columns in expected_columns.items():
        for missing in sorted(columns - available_columns):
            replay_drift.append(f"字段“{missing}”已不存在，无法执行 {operation}")

    cleaned = frame.copy()
    for column in cleaned.columns:
        column_name = str(column)
        series = cleaned[column]
        is_text = pd.api.types.is_object_dtype(series.dtype) or pd.api.types.is_string_dtype(
            series.dtype
        )
        replay_trim = column_name in expected_columns["trim_text"]
        if is_text:
            stripped = series.map(lambda value: value.strip() if isinstance(value, str) else value)
            if not stripped.equals(series) or replay_trim:
                operations.append(
                    {
                        "operation": "trim_text",
                        "column": column_name,
                        **({"replayed": True} if replay_trim else {}),
                    }
                )
            cleaned[column] = stripped
        elif replay_trim:
            operations.append({"operation": "trim_text", "column": column_name, "replayed": True})

        replay_currency = column_name in expected_columns["normalize_currency"]
        if has_monetary_semantics(column_name) or replay_currency:
            if replay_currency and pd.api.types.is_numeric_dtype(cleaned[column].dtype):
                operations.append(
                    {
                        "operation": "normalize_currency",
                        "column": column_name,
                        "replayed": True,
                    }
                )
                continue
            converted, changed, failed = _convert_currency(cleaned[column])
            if changed:
                cleaned[column] = converted
                operations.append(
                    {
                        "operation": "normalize_currency",
                        "column": column_name,
                        **({"replayed": True} if replay_currency else {}),
                    }
                )
                if failed:
                    issues.append(
                        {
                            "code": "invalid_currency_values",
                            "title": f"{column} 中有 {failed} 个金额无法识别",
                            "detail": "这些值在分析副本中标记为空，原文件保持不变。",
                            "severity": "warning",
                            "automatic": False,
                            "count": failed,
                        }
                    )
                continue
            if replay_currency:
                replay_drift.append(
                    f"字段“{column_name}”的金额格式变化过大，未强制转换以免改变结论"
                )

        is_text = pd.api.types.is_object_dtype(
            cleaned[column].dtype
        ) or pd.api.types.is_string_dtype(cleaned[column].dtype)
        replay_datetime = column_name in expected_columns["normalize_datetime"]
        if replay_datetime and pd.api.types.is_datetime64_any_dtype(cleaned[column].dtype):
            operations.append(
                {
                    "operation": "normalize_datetime",
                    "column": column_name,
                    "replayed": True,
                }
            )
            continue
        if (has_time_semantics(column_name) or replay_datetime) and is_text:
            converted = pd.to_datetime(cleaned[column], errors="coerce", format="mixed")
            non_null = cleaned[column].notna().sum()
            if non_null and converted.notna().sum() / non_null >= 0.8:
                cleaned[column] = converted
                operations.append(
                    {
                        "operation": "normalize_datetime",
                        "column": column_name,
                        **({"replayed": True} if replay_datetime else {}),
                    }
                )
                failed = int(non_null - converted.notna().sum())
                if failed:
                    issues.append(
                        {
                            "code": "invalid_date_values",
                            "title": f"{column} 中有 {failed} 个日期无法识别",
                            "detail": "这些值在分析副本中标记为空，原文件保持不变。",
                            "severity": "warning",
                            "automatic": False,
                            "count": failed,
                        }
                    )
            elif replay_datetime:
                replay_drift.append(
                    f"字段“{column_name}”的日期格式变化过大，未强制转换以免改变结论"
                )
        elif replay_datetime:
            replay_drift.append(f"字段“{column_name}”不再是可识别的日期文本")

    for fill_operation in (
        item for item in recipe_operations if item.get("operation") == "fill_missing"
    ):
        column_name = str(fill_operation.get("column") or "")
        if column_name not in available_columns:
            continue
        fill_value = fill_operation.get("value")
        cleaned[column_name] = cleaned[column_name].fillna(fill_value)
        operations.append(
            {
                "operation": "fill_missing",
                "column": column_name,
                "value": fill_value,
                "replayed": True,
            }
        )
    for step in recipe_operations:
        if step.get("operation") != "replace_text_values":
            continue
        column = step["column"]
        if column not in available_columns:
            continue
        series = cleaned[column]
        # Legacy XLS may have object columns mixing strings and typed cells.
        # Never stringify numbers/dates to make a text rule appear applicable.
        if (
            not (
                pd.api.types.is_object_dtype(series.dtype)
                or pd.api.types.is_string_dtype(series.dtype)
            )
            or not series.dropna().map(lambda value: isinstance(value, str)).all()
        ):
            replay_drift.append(f"字段“{column}”已不再是文本，无法统一取值，已保留原值")
            continue
        replacements = {item["from_value"]: item["to_value"] for item in step["replacements"]}
        cleaned[column] = series.map(
            lambda value: replacements.get(value, value) if isinstance(value, str) else value
        )
        operations.append({**step, "replayed": True})
    return cleaned


def _candidate_grain(frame: pd.DataFrame) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for column in frame.columns:
        series = frame[column].dropna()
        if series.empty:
            continue
        unique = int(series.nunique(dropna=True))
        uniqueness = unique / len(series)
        if has_identifier_semantics(column):
            candidates.append(
                {
                    "column": str(column),
                    "non_null": int(len(series)),
                    "unique": unique,
                    "uniqueness": round(uniqueness, 6),
                    "duplicate_values": int(len(series) - unique),
                }
            )
    return candidates


def _schema(frame: pd.DataFrame, candidate_grain: list[dict[str, Any]]) -> dict[str, Any]:
    columns = []
    for column in frame.columns:
        series = frame[column]
        examples = [_json_safe(value) for value in series.dropna().head(3).tolist()]
        columns.append(
            {
                "name": str(column),
                "dtype": str(series.dtype),
                "nullable": bool(series.isna().any()),
                "missing": int(series.isna().sum()),
                "unique": int(series.nunique(dropna=True)),
                "examples": examples,
            }
        )
    return {
        "rows": int(len(frame)),
        "columns": columns,
        "candidate_grain": candidate_grain,
    }


def _preanalysis_brief(
    frame: pd.DataFrame,
    candidate_grain: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a compact, deterministic head start without pretending to know business semantics."""

    grain_columns = {str(item.get("column") or "") for item in candidate_grain}
    roles: list[dict[str, Any]] = []
    for column in list(frame.columns)[:80]:
        column_name = str(column)
        series = frame[column]
        non_null = series.dropna()
        role = infer_semantic_field_role(
            column_name,
            is_numeric=(
                pd.api.types.is_numeric_dtype(series.dtype)
                and not pd.api.types.is_bool_dtype(series.dtype)
            ),
            is_datetime=pd.api.types.is_datetime64_any_dtype(series.dtype),
            is_grain=column_name in grain_columns,
        )

        profile: dict[str, Any] = {
            "column": column_name,
            "role": role,
            "status": "candidate",
            "non_null": int(len(non_null)),
            "missing": int(series.isna().sum()),
            "unique": int(series.nunique(dropna=True)),
        }
        if role == "identifier" and len(non_null):
            profile["uniqueness"] = round(float(series.nunique(dropna=True)) / len(non_null), 6)
        elif role == "time":
            converted = pd.to_datetime(series, errors="coerce")
            if converted.notna().any():
                profile["range"] = {
                    "start": _json_safe(converted.min()),
                    "end": _json_safe(converted.max()),
                }
        elif role == "measure":
            numeric = pd.to_numeric(series, errors="coerce").dropna()
            if not numeric.empty:
                profile["distribution"] = {
                    "min": _json_safe(numeric.min()),
                    "median": _json_safe(numeric.median()),
                    "max": _json_safe(numeric.max()),
                }
        elif not non_null.empty:
            counts = non_null.astype(str).value_counts().head(5)
            profile["top_values"] = [
                {
                    "value": str(value),
                    "count": int(count),
                    "share": round(int(count) / len(non_null), 6),
                }
                for value, count in counts.items()
            ]
        roles.append(profile)
    return {
        "generated_by": "deterministic_preflight",
        "semantic_role_inference_version": SEMANTIC_ROLE_INFERENCE_VERSION,
        "requires_query_verification": True,
        "shape": {"rows": int(len(frame)), "columns": int(len(frame.columns))},
        "candidate_roles": roles,
    }


def _find_outliers(frame: pd.DataFrame) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for column in frame.select_dtypes(include="number").columns:
        series = frame[column].dropna()
        if len(series) < 8:
            continue
        q1, q3 = series.quantile([0.25, 0.75])
        spread = q3 - q1
        if spread == 0:
            continue
        count = int(((series < q1 - 1.5 * spread) | (series > q3 + 1.5 * spread)).sum())
        if count:
            issues.append(
                {
                    "code": "possible_outliers",
                    "title": f"{column} 中有 {count} 个明显偏离的值",
                    "detail": "这些记录已保留，分析时会单独核查，而不是直接删除。",
                    "severity": "warning",
                    "automatic": False,
                    "count": count,
                }
            )
    return issues


def _business_ambiguities(frame: pd.DataFrame) -> list[dict[str, Any]]:
    columns = frame.columns.tolist()
    has_money = any(has_monetary_semantics(column) for column in columns)
    has_refund = any(has_refund_semantics(column) for column in columns)
    if not (has_money and has_refund):
        return []
    strategies = build_revenue_refund_option_strategies(_json_safe(frame.to_dict(orient="records")))
    return _revenue_refund_ambiguities(strategies)


def _revenue_refund_ambiguities(strategies: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    if len(strategies) < 2:
        return []
    return [
        {
            "key": "revenue_refund_policy",
            "presentation_code": "preflight.revenue_refund_policy",
            "question": "计算收入时，退款订单需要扣除吗？",
            "reason": "数据同时包含金额和退款字段，不同口径会改变收入结论。",
            "options": list(strategies),
            "option_codes": {
                option: {
                    "value_filter": "exclude_refunds",
                    "identity": "include_refunds",
                    "metric_column": "use_existing_net_amount",
                }.get(str((definition.get("action") or {}).get("kind") or ""), "")
                for option, definition in strategies.items()
            },
            "option_strategies": strategies,
            "affected_terms": list(REVENUE_INTENT_TERMS),
        }
    ]


def run_preflight(
    source_path: Path,
    output_dir: Path,
    recipe_operations: list[dict[str, Any]] | None = None,
) -> PreflightResult:
    """Inspect and sanitize a source, optionally replaying a verified prior recipe."""

    # Validate the complete persisted recipe before reading or writing user data.  This
    # also strips provenance records and upgrades known legacy omissions to v1.
    replay_steps = _recipe_steps(recipe_operations)
    if _recipe_step(replay_steps, "read_csv") and source_path.suffix.casefold() != ".csv":
        raise ValueError("CSV 读取设置不能用于其他文件格式")
    if _recipe_step(
        replay_steps, "use_generated_headers"
    ) and source_path.suffix.casefold() not in {".csv", ".xls", ".xlsx"}:
        raise ValueError("无表头选项仅适用于 CSV 和 Excel 文件")
    if source_path.suffix.casefold() == ".csv":
        from app.services.csv_preflight import run_csv_preflight

        return run_csv_preflight(source_path, output_dir, replay_steps)
    if source_path.suffix.casefold() == ".xlsx":
        from app.services.xlsx_preflight import run_xlsx_preflight

        return run_xlsx_preflight(source_path, output_dir, replay_steps)
    if source_path.suffix.casefold() == ".parquet":
        from app.services.parquet_preflight import run_parquet_preflight

        return run_parquet_preflight(source_path, output_dir, replay_steps)
    if source_path.suffix.casefold().lstrip(".") in JSON_FILE_FORMATS:
        from app.services.json_preflight import run_json_preflight

        return run_json_preflight(source_path, output_dir, replay_steps)
    input_fingerprint = fingerprint_file(source_path)
    frame, header_row, reader_details = _read_tabular(source_path, replay_steps)
    original_shape = tuple(frame.shape)
    issues: list[dict[str, Any]] = []
    operations: list[dict[str, Any]] = []
    replay_drift = list(reader_details.pop("recipe_replay_drift", []))
    expected_operation_names = {str(item.get("operation")) for item in replay_steps}

    selected_sheet = reader_details.get("selected_sheet")
    if selected_sheet is not None:
        operations.append(
            {
                "operation": "select_sheet",
                "sheet": str(selected_sheet),
                **({"replayed": True} if "select_sheet" in expected_operation_names else {}),
            }
        )

    if reader_details.get("has_header") is False:
        operations.append({"operation": "use_generated_headers", "replayed": True})
    elif header_row > 0 or "select_header" in expected_operation_names:
        if header_row > 0:
            issues.append(
                {
                    "code": "header_offset",
                    "title": f"已找到第 {header_row + 1} 行的真实表头",
                    "detail": "表头之前的说明行未进入分析副本。",
                    "severity": "info",
                    "automatic": True,
                    "count": header_row,
                }
            )
        operations.append(
            {
                "operation": "select_header",
                "row": header_row + 1,
                **({"replayed": True} if "select_header" in expected_operation_names else {}),
            }
        )

    original_columns = list(frame.columns)
    frame.columns = _dedupe_columns(original_columns)
    if (
        list(map(str, original_columns)) != frame.columns.tolist()
        or "normalize_column_names" in expected_operation_names
    ):
        operations.append(
            {
                "operation": "normalize_column_names",
                "columns": frame.columns.tolist(),
                **(
                    {"replayed": True}
                    if "normalize_column_names" in expected_operation_names
                    else {}
                ),
            }
        )

    before_empty = frame.shape
    frame = frame.dropna(axis=0, how="all").dropna(axis=1, how="all")
    removed_empty_rows = before_empty[0] - frame.shape[0]
    removed_empty_columns = before_empty[1] - frame.shape[1]
    if removed_empty_rows or removed_empty_columns or "drop_empty" in expected_operation_names:
        if removed_empty_rows or removed_empty_columns:
            issues.append(
                {
                    "code": "empty_regions",
                    "title": "已移除完全空白的区域",
                    "detail": f"移除 {removed_empty_rows} 行、{removed_empty_columns} 列空白区域。",
                    "severity": "info",
                    "automatic": True,
                    "count": removed_empty_rows + removed_empty_columns,
                }
            )
        operations.append(
            {
                "operation": "drop_empty",
                "rows": removed_empty_rows,
                "columns": removed_empty_columns,
                **({"replayed": True} if "drop_empty" in expected_operation_names else {}),
            }
        )

    if len(frame.columns):
        first_column = frame.columns[0]
        total_mask = frame[first_column].astype(str).str.strip().str.lower().isin(TOTAL_MARKERS)
        total_count = int(total_mask.sum())
        if total_count:
            frame = frame.loc[~total_mask].copy()
            issues.append(
                {
                    "code": "summary_rows",
                    "title": f"已隔离 {total_count} 行合计数据",
                    "detail": "合计行不会与明细重复计算。",
                    "severity": "warning",
                    "automatic": True,
                    "count": total_count,
                }
            )
        if total_count or "exclude_summary_rows" in expected_operation_names:
            operations.append(
                {
                    "operation": "exclude_summary_rows",
                    "count": total_count,
                    **(
                        {"replayed": True}
                        if "exclude_summary_rows" in expected_operation_names
                        else {}
                    ),
                }
            )

    duplicate_count = int(frame.duplicated().sum())
    if duplicate_count:
        frame = frame.drop_duplicates().copy()
        issues.append(
            {
                "code": "duplicate_rows",
                "title": f"发现并隔离 {duplicate_count} 条完全重复记录",
                "detail": "原文件保持不变，分析副本只保留一条。",
                "severity": "warning",
                "automatic": True,
                "count": duplicate_count,
            }
        )
    if duplicate_count or "drop_exact_duplicates" in expected_operation_names:
        operations.append(
            {
                "operation": "drop_exact_duplicates",
                "count": duplicate_count,
                **(
                    {"replayed": True}
                    if "drop_exact_duplicates" in expected_operation_names
                    else {}
                ),
            }
        )

    frame = _infer_and_clean_types(
        frame,
        operations,
        issues,
        recipe_operations=replay_steps,
        replay_drift=replay_drift,
    )
    candidate_grain = _candidate_grain(frame)
    preanalysis = _preanalysis_brief(frame, candidate_grain)
    for candidate in candidate_grain:
        duplicate_values = candidate["duplicate_values"]
        if duplicate_values and has_identifier_semantics(candidate["column"]):
            issues.append(
                {
                    "code": "duplicate_business_keys",
                    "title": f"{candidate['column']} 有 {duplicate_values} 条重复出现",
                    "detail": "可能是一单多商品，也可能是重复记录；系统会按实际分析口径核查，不会自动删除。",
                    "severity": "warning",
                    "automatic": False,
                    "count": duplicate_values,
                }
            )
    missing_count = int(frame.isna().sum().sum())
    if missing_count:
        issues.append(
            {
                "code": "missing_values",
                "title": f"有 {missing_count} 个缺失值需要分析时留意",
                "detail": "系统不会擅自填充可能改变业务含义的空值。",
                "severity": "warning",
                "automatic": False,
                "count": missing_count,
            }
        )
    issues.extend(_find_outliers(frame))

    output_dir.mkdir(parents=True, exist_ok=True)
    working_path = output_dir / "analysis-ready.parquet"
    frame.to_parquet(working_path, index=False)
    output_fingerprint = fingerprint_file(working_path)
    ambiguities = _business_ambiguities(frame)
    return _finish_preflight(
        ready_shape=frame.shape,
        original_shape=original_shape,
        reader_details=reader_details,
        replay_steps=replay_steps,
        replay_drift=replay_drift,
        issues=issues,
        operations=operations,
        ambiguities=ambiguities,
        preanalysis=preanalysis,
        sample=_json_safe(frame.head(8).to_dict(orient="records")),
        inferred_schema=_schema(frame, candidate_grain),
        input_fingerprint=input_fingerprint,
        output_fingerprint=output_fingerprint,
        working_path=working_path,
    )


def _finish_preflight(
    *,
    ready_shape: tuple[int, int],
    original_shape: tuple[int, int],
    reader_details: dict[str, Any],
    replay_steps: list[dict[str, Any]],
    replay_drift: list[str],
    issues: list[dict[str, Any]],
    operations: list[dict[str, Any]],
    ambiguities: list[dict[str, Any]],
    preanalysis: dict[str, Any],
    sample: list[dict[str, Any]],
    inferred_schema: dict[str, Any],
    input_fingerprint: str,
    output_fingerprint: str,
    working_path: Path,
) -> PreflightResult:
    """Keep activation, replay receipts, and business questions identical across readers."""
    sheet_profiles = reader_details.get("sheet_profiles") or []
    credible_sheets = [item for item in sheet_profiles if item.get("credible_table")]
    credible_sheets.sort(key=lambda item: int(item.get("quality_score") or 0), reverse=True)
    selected_quality = next(
        (
            int(item.get("quality_score") or 0)
            for item in credible_sheets
            if item.get("name") == reader_details.get("selected_sheet")
        ),
        0,
    )
    plausible_sheets = [
        item
        for item in credible_sheets
        if selected_quality == 0
        or int(item.get("quality_score") or 0) >= max(4, selected_quality * 0.7)
    ]
    selected_sheet = str(reader_details.get("selected_sheet") or "")
    selected_sheet_step = _recipe_step(replay_steps, "select_sheet")
    explicit_sheet_selection = bool(
        selected_sheet_step
        and selected_sheet_step.get("sheet")
        and str(selected_sheet_step.get("sheet")) == selected_sheet
    )
    if len(plausible_sheets) > 1 and not explicit_sheet_selection:
        ambiguities.append(
            {
                "key": "excel_sheet_selection",
                "presentation_code": "preflight.excel_sheet_selection",
                "presentation_facts": {"selected_sheet": selected_sheet},
                "question": f"这次先分析工作表“{selected_sheet}”，是否正确？",
                "reason": "文件里有多个工作表，选择不同工作表可能改变分析范围。",
                "options": [str(item.get("name")) for item in plausible_sheets[:12]],
            }
        )
    if replay_steps:
        if replay_drift:
            issues.append(
                {
                    "code": "recipe_replay_drift",
                    "title": f"上期整理方法有 {len(replay_drift)} 处需要确认",
                    "detail": "；".join(replay_drift[:8]),
                    "severity": "warning",
                    "automatic": False,
                    "count": len(replay_drift),
                }
            )
        else:
            issues.append(
                {
                    "code": "recipe_replayed",
                    "title": f"已重放并核对 {len(replay_steps)} 步整理方法",
                    "detail": "每一步都在本次工作副本上重新执行，没有直接沿用旧结果。",
                    "severity": "info",
                    "automatic": True,
                    "count": len(replay_steps),
                }
            )

    automatic_count = sum(1 for issue in issues if issue.get("automatic"))
    status = "needs_confirmation" if ambiguities or replay_drift else "ready"
    summary = f"数据已准备好：{ready_shape[0]:,} 行、{ready_shape[1]} 列"
    if automatic_count:
        summary += f"，自动处理了 {automatic_count} 类结构问题"
    if ambiguities:
        summary += f"，有 {len(ambiguities)} 个业务口径需要确认"
    if replay_steps:
        summary += "，整理方法已重放并核对" if not replay_drift else "，整理方法存在漂移"

    snapshot = {
        "summary_code": "file_preflight",
        "summary_facts": {
            "rows": int(ready_shape[0]),
            "columns": int(ready_shape[1]),
            "automatic_issue_count": automatic_count,
            "ambiguity_count": len(ambiguities),
            "recipe_step_count": len(replay_steps),
            "recipe_drift_count": len(replay_drift),
        },
        "original_rows": int(original_shape[0]),
        "original_columns": int(original_shape[1]),
        "ready_rows": int(ready_shape[0]),
        "ready_columns": int(ready_shape[1]),
        "reader": reader_details,
        "recipe_replay": {
            "requested_steps": len(replay_steps),
            "drift": replay_drift,
        },
        "preanalysis": preanalysis,
        "sample": sample,
    }
    return PreflightResult(
        status=status,
        summary=summary,
        issues=issues,
        ambiguities=ambiguities,
        inferred_schema=inferred_schema,
        source_snapshot=json.loads(json.dumps(snapshot, ensure_ascii=False)),
        operations=canonicalize_sanitation_operations(operations),
        input_fingerprint=input_fingerprint,
        output_fingerprint=output_fingerprint,
        working_path=working_path,
    )
