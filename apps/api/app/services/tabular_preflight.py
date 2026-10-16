"""Shared disk-backed preparation for bounded tabular readers.

Readers stage values and evidence; this module owns whole-table transformations,
profiles, recipe validation, and publication of a completed analysis copy.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal, InvalidOperation, localcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import duckdb
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from app.services.result_filters import build_revenue_refund_option_strategies
from app.services.semantic_field_roles import (
    SEMANTIC_ROLE_INFERENCE_VERSION,
    has_identifier_semantics,
    has_monetary_semantics,
    has_refund_semantics,
    has_time_semantics,
    infer_semantic_field_role,
)

if TYPE_CHECKING:
    from app.services.data_preflight import PreflightResult

_BATCH_ROWS = 8192
_BATCH_CELLS = 65536
_BATCH_BYTES = 4 * 1024 * 1024
_RECORD_CHARACTERS = 1024 * 1024
_MAX_COLUMNS = 500
_MAX_REFUND_VALUES = 512
_NULL_VALUES = frozenset(
    (
        "",
        "#N/A",
        "#N/A N/A",
        "#NA",
        "-1.#IND",
        "-1.#QNAN",
        "-NaN",
        "-nan",
        "1.#IND",
        "1.#QNAN",
        "<NA>",
        "N/A",
        "NA",
        "NULL",
        "NaN",
        "None",
        "n/a",
        "nan",
        "null",
    )
)
_WHITESPACE = " \t\n\r\v\f\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"
_DATE_FORMATS = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%Y年%m月%d日",
    "%Y%m%d",
    "%m/%d/%Y",
    "%Y-%m-%d %H:%M:%S",
    "%Y/%m/%d %H:%M:%S",
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%d %H:%M",
)


@dataclass
class StagedTable:
    rows: int
    columns: list[str]
    reader: dict[str, Any]
    operations: list[dict[str, Any]] = field(default_factory=list)
    issues: list[dict[str, Any]] = field(default_factory=list)
    drift: list[str] = field(default_factory=list)
    native_dates: frozenset[str] = frozenset()
    native_types: dict[str, pa.DataType] = field(default_factory=dict)
    preserve_string_types: bool = False
    literal_strings: bool = False
    identity_column: str | None = None


_NUMBER_TYPES = frozenset(
    {
        "TINYINT",
        "SMALLINT",
        "INTEGER",
        "BIGINT",
        "HUGEINT",
        "UTINYINT",
        "USMALLINT",
        "UINTEGER",
        "UBIGINT",
        "UHUGEINT",
        "FLOAT",
        "DOUBLE",
    }
)


def _numeric(dtype: str) -> bool:
    return dtype in _NUMBER_TYPES or dtype.startswith("DECIMAL(")


def _temporal(dtype: str) -> bool:
    return dtype == "DATE" or dtype.startswith("TIMESTAMP") or dtype in {"TIME", "TIME_NS"}


def _present(expression: str, dtype: str, native_type: pa.DataType | None = None) -> str:
    # Fetching a SQL timestamp as a Python datetime would truncate nanoseconds.
    if _temporal(dtype):
        if native_type is not None and pa.types.is_time(native_type):
            return f"split_part(cast({expression} AS VARCHAR), ' ', 2)"
        rendered = f"replace(cast({expression} AS VARCHAR), ' ', 'T')"
        if native_type is not None and pa.types.is_timestamp(native_type) and native_type.tz:
            rendered += " || 'Z'"  # Staging has retained the exact UTC epoch.
        return rendered
    return expression


def _restore_array(array: pa.Array, target: pa.DataType) -> pa.Array:
    if pa.types.is_time(target):
        timestamp = pc.cast(array, pa.timestamp(target.unit), safe=True)
        integer = pa.int32() if target.bit_width == 32 else pa.int64()
        return pc.cast(pc.cast(pc.cast(timestamp, pa.int64()), integer, safe=True), target)
    return pc.cast(array, target, safe=True)


def _native_expression(
    db, column: str, dtype: str, target: pa.DataType, steps, operations, drift
) -> str:
    quoted = _q(column)
    expression = quoted
    for step in steps:
        if step.get("column") != column:
            continue
        operation = step["operation"]
        if operation == "fill_missing":
            try:
                if pa.types.is_time(target) and isinstance(step["value"], str):
                    value = pc.cast(
                        pa.scalar("1970-01-01T" + step["value"]),
                        pa.timestamp(target.unit),
                        safe=True,
                    )
                    epoch = pc.cast(value, pa.int64()).as_py()
                    if (
                        not 0
                        <= epoch
                        < 86400
                        * {"s": 1, "ms": 1000, "us": 1_000_000, "ns": 1_000_000_000}[target.unit]
                    ):
                        raise ValueError("time outside one day")
                elif pa.types.is_decimal(target):
                    # Treat the recipe's decimal spelling as exact; Arrow's
                    # float-to-decimal cast may round even with safe=True.
                    value = pc.cast(pa.scalar(Decimal(str(step["value"]))), target, safe=True)
                else:
                    value = pc.cast(pa.scalar(step["value"]), target, safe=True)
                if pa.types.is_timestamp(target) or pa.types.is_time(target):
                    epoch = pc.cast(value, pa.int64()).as_py()
                    if target.unit == "ns":
                        literal = f"make_timestamp_ns({epoch})"
                    else:
                        literal = f"make_timestamp({epoch * {'s': 1_000_000, 'ms': 1000, 'us': 1}[target.unit]})"
                else:
                    scalar = value.as_py()
                    if isinstance(scalar, float) and not math.isfinite(scalar):
                        raise ValueError("non-finite fill")
                    # DuckDB rounds some casts; Arrow's safe cast above must run first.
                    literal = f"cast({_literal(scalar)} AS {dtype})"
            except (
                pa.ArrowException,
                ValueError,
                OverflowError,
                TypeError,
                InvalidOperation,
            ) as exc:
                raise ValueError(f"字段“{column}”的填充值无法保留原来的类型或精度") from exc
            expression = f"coalesce({expression}, cast({literal} AS {dtype}))"
            operations.append({**step, "replayed": True})
        elif (
            operation == "trim_text"
            or (operation == "normalize_currency" and _numeric(dtype))
            or (operation == "normalize_datetime" and _temporal(dtype))
        ):
            operations.append({**step, "replayed": True})
        else:
            drift.append(f"字段“{column}”已有明确类型，无法重放 {operation}，已保留原值")
    return f"{expression} AS {quoted}"


class StringBatchWriter:
    """Explicit string staging with one source ordinal and bounded row batches."""

    def __init__(
        self, path: Path, columns: list[str], ordinal: str, *, max_rows: int | None = None
    ):
        self.schema = pa.schema([(name, pa.string()) for name in columns] + [(ordinal, pa.int64())])
        self.width = len(columns)
        self.limit = max(1, min(max_rows or _BATCH_ROWS, _BATCH_CELLS // self.width))
        self.rows: list[list[str | None]] = []
        self.count = 0
        self.batch_bytes = 0
        self.writer = pq.ParquetWriter(path, self.schema, compression="zstd")

    def __enter__(self):
        return self

    def append(self, row: list[str | None]) -> None:
        if len(row) != self.width:
            raise ValueError("记录的列数与表头不一致，请检查文件内容")
        if sum(len(value) for value in row if value is not None) > _RECORD_CHARACTERS:
            raise ValueError("文件中有过长的记录，请缩短单元格内容后重试")
        self.batch_bytes += sum(len(value.encode("utf-8")) for value in row if value is not None)
        self.rows.append(row)
        self.count += 1
        if len(self.rows) >= self.limit or self.batch_bytes >= _BATCH_BYTES:
            self.flush()

    def flush(self) -> None:
        if not self.rows:
            return
        arrays = [
            pa.array([row[index] for row in self.rows], type=pa.string())
            for index in range(self.width)
        ]
        arrays.append(pa.array(range(self.count - len(self.rows), self.count), type=pa.int64()))
        self.writer.write_batch(pa.RecordBatch.from_arrays(arrays, schema=self.schema))
        self.rows.clear()
        self.batch_bytes = 0

    def __exit__(self, exc_type, exc, traceback):
        try:
            if exc_type is None:
                self.flush()
        finally:
            self.writer.close()


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("整理方法包含无法使用的数值")
        return format(value, "f")
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError("整理方法包含无法使用的数值")
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _safe(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, int) and abs(value) > 9007199254740991:
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None if math.isnan(value) else "Infinity" if value > 0 else "-Infinity"
    return value


def _count(db: duckdb.DuckDBPyConnection, sql: str) -> int:
    return int(db.execute(sql).fetchone()[0] or 0)


def _issue(
    issues: list[dict[str, Any]],
    code: str,
    title: str,
    detail: str,
    count: int,
    *,
    automatic: bool = False,
) -> None:
    if count:
        issues.append(
            {
                "code": code,
                "title": title,
                "detail": detail,
                "severity": "warning",
                "automatic": automatic,
                "count": count,
            }
        )


def _typed_expressions(
    db: duckdb.DuckDBPyConnection,
    columns: list[str],
    steps: list[dict[str, Any]],
    operations: list[dict[str, Any]],
    issues: list[dict[str, Any]],
    drift: list[str],
    *,
    native_dates: frozenset[str] = frozenset(),
    native_types: dict[str, pa.DataType] | None = None,
    preserve_string_types: bool = False,
    literal_strings: bool = False,
) -> list[str]:
    physical = {
        name: str(dtype) for name, dtype, *_ in db.execute("DESCRIBE distinct_rows").fetchall()
    }
    expected = {(str(step["operation"]), str(step.get("column", ""))) for step in steps}
    for operation, column in sorted(expected):
        if column and column not in columns:
            drift.append(f"字段“{column}”已不存在，无法执行 {operation}")
    expressions = []
    for column in columns:
        if physical[column] != "VARCHAR":
            expressions.append(
                _native_expression(
                    db, column, physical[column], native_types[column], steps, operations, drift
                )
            )
            continue
        identifier = has_identifier_semantics(column)
        time_field = has_time_semantics(column) or column in native_dates
        quoted = _q(column)
        trimmed = f"trim({quoted}, {_literal(_WHITESPACE)})"
        non_null = _count(db, f"SELECT count({quoted}) FROM distinct_rows")
        changed = _count(db, f"SELECT count(*) FROM distinct_rows WHERE {quoted} != {trimmed}")
        if changed or ("trim_text", column) in expected:
            operations.append(
                {
                    "operation": "trim_text",
                    "column": column,
                    "replayed": ("trim_text", column) in expected,
                }
            )
        expression, dtype = trimmed, "VARCHAR"
        number = f"try_cast({trimmed} AS DOUBLE)"
        integers = f"CASE WHEN regexp_full_match({trimmed}, '[-+]?[0-9]+') THEN try_cast({trimmed} AS BIGINT) END"
        unsafe_integer = (
            f"regexp_full_match({trimmed}, '[-+]?[0-9]+') AND "
            f"({integers} IS NULL OR {integers} NOT BETWEEN -9007199254740991 AND 9007199254740991)"
        )
        replay_currency = ("normalize_currency", column) in expected
        replay_date = ("normalize_datetime", column) in expected
        currency_done = False
        zero_padding_count = (
            f"count(*) FILTER (WHERE regexp_full_match({trimmed}, '[-+]?0[0-9]+'))"
            if literal_strings and not preserve_string_types
            else "0"
        )
        numeric, integer_count, unsafe_integers, boolean_count, zero_padded = db.execute(
            f"SELECT count(*) FILTER (WHERE isfinite({number})), count({integers}), "
            f"count(*) FILTER (WHERE {unsafe_integer}), "
            f"count(*) FILTER (WHERE lower({trimmed}) IN ('true', 'false')), "
            f"{zero_padding_count} FROM distinct_rows"
        ).fetchone()
        # Automatic inference preserves keys even when names also contain money
        # or date hints (payment_id/date_key). Explicit recipe steps still apply.
        if (
            non_null
            and not identifier
            and not time_field
            and not preserve_string_types
            and not (literal_strings and zero_padded)
        ):
            if integer_count == non_null:
                expression, dtype = integers, "BIGINT"
            elif numeric == non_null and not unsafe_integers:
                expression, dtype = number, "DOUBLE"
            elif boolean_count == non_null:
                expression, dtype = f"cast({trimmed} AS BOOLEAN)", "BOOLEAN"

        if (
            has_monetary_semantics(column)
            and not identifier
            and not time_field
            and not literal_strings
        ) or replay_currency:
            money_text = f"regexp_replace({trimmed}, '[￥¥$€£,\\s]', '', 'g')"
            money_text = f"regexp_replace({money_text}, '^\\((.*)\\)$', '-\\1')"
            money = f"CASE WHEN isfinite(try_cast({money_text} AS DOUBLE)) THEN try_cast({money_text} AS DOUBLE) END"
            money_integer = f"CASE WHEN regexp_full_match({money_text}, '[-+]?[0-9]+') THEN try_cast({money_text} AS BIGINT) END"
            unsafe_money = (
                f"regexp_full_match({money_text}, '[-+]?[0-9]+') AND "
                f"({money_integer} IS NULL OR {money_integer} NOT BETWEEN -9007199254740991 AND 9007199254740991)"
            )
            valid, integral, unsafe = db.execute(
                f"SELECT count({money}), count({money_integer}), count(*) FILTER (WHERE {unsafe_money}) FROM distinct_rows"
            ).fetchone()
            if non_null and valid / non_null >= 0.85:
                if unsafe and integral != valid:
                    expression, dtype = trimmed, "VARCHAR"
                    _issue(
                        issues,
                        "numeric_precision_review",
                        f"{column} 中有较长的数值需要核对",
                        "暂时保留文本，避免转换后改变原来的数值。",
                        unsafe,
                    )
                    if replay_currency:
                        drift.append(f"字段“{column}”包含无法无损转换的长整数，已保留文本")
                else:
                    currency_done = True
                if currency_done and (dtype == "VARCHAR" or replay_currency):
                    if dtype == "VARCHAR":
                        expression, dtype = (
                            (money_integer, "BIGINT")
                            if unsafe and integral == valid
                            else (money, "DOUBLE")
                        )
                    operations.append(
                        {
                            "operation": "normalize_currency",
                            "column": column,
                            "replayed": replay_currency,
                        }
                    )
                    _issue(
                        issues,
                        "invalid_currency_values",
                        f"{column} 中有 {non_null - valid} 个金额无法识别",
                        "这些值在分析副本中标记为空。",
                        non_null - valid,
                    )
            elif replay_currency:
                drift.append(f"字段“{column}”的金额格式变化过大，未强制转换以免改变结论")
        if (
            (time_field and not identifier and (not literal_strings or column in native_dates))
            or replay_date
        ) and not currency_done:
            formats = "[" + ", ".join(_literal(value) for value in _DATE_FORMATS) + "]"
            parsed = f"try_strptime({trimmed}, {formats})"
            valid = _count(db, f"SELECT count({parsed}) FROM distinct_rows")
            if non_null and valid / non_null >= 0.8:
                expression, dtype = parsed, "TIMESTAMP"
                operations.append(
                    {"operation": "normalize_datetime", "column": column, "replayed": replay_date}
                )
                _issue(
                    issues,
                    "invalid_date_values",
                    f"{column} 中有 {non_null - valid} 个日期无法识别",
                    "这些值在分析副本中标记为空。",
                    non_null - valid,
                )
            elif replay_date:
                drift.append(f"字段“{column}”的日期格式变化过大，未强制转换以免改变结论")
            elif non_null:
                _issue(
                    issues,
                    "date_format_review",
                    f"{column} 的日期格式需要核对",
                    "暂时保留原来的文本值。",
                    non_null - valid,
                )
        elif replay_date:
            drift.append(f"字段“{column}”已按金额整理，无法同时重放日期转换")

        for step in steps:
            if step["operation"] == "fill_missing" and step["column"] == column:
                # An incompatible fill value raises instead of silently adding
                # more nulls or changing a numeric column to an unrelated type.
                expression = f"coalesce({expression}, cast({_literal(step['value'])} AS {dtype}))"
                operations.append(
                    {
                        "operation": "fill_missing",
                        "column": column,
                        "value": step["value"],
                        "replayed": True,
                    }
                )
        for step in steps:
            if step["operation"] != "replace_text_values" or step["column"] != column:
                continue
            if dtype != "VARCHAR":
                drift.append(f"字段“{column}”已不再是文本，无法统一取值，已保留原值")
                continue
            # One CASE compares every original value to the same prepared value:
            # A→B and B→C never cascade. _literal quotes all untrusted text.
            branches = " ".join(
                f"WHEN {_literal(item['from_value'])} THEN {_literal(item['to_value'])}"
                for item in step["replacements"]
            )
            expression = f"CASE {expression} {branches} ELSE {expression} END"
            operations.append({**step, "replayed": True})
        expressions.append(f"{expression} AS {quoted}")
    return expressions


def _profile(
    db: duckdb.DuckDBPyConnection,
    columns: list[str],
    ordinal: str,
    issues: list[dict[str, Any]],
    *,
    native_types: dict[str, pa.DataType] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    native_types = native_types or {}
    rows = _count(db, "SELECT count(*) FROM prepared")
    types = dict(
        (name, str(dtype)) for name, dtype, *_ in db.execute("DESCRIBE prepared").fetchall()
    )
    schema_columns, roles, grains = [], [], []
    missing_total = 0
    for column in columns:
        quoted, dtype = _q(column), types[column]
        non_null, unique = db.execute(
            f"SELECT count({quoted}), count(DISTINCT {quoted}) FROM prepared"
        ).fetchone()
        missing = rows - non_null
        missing_total += missing
        numeric = _numeric(dtype)
        temporal = _temporal(dtype)
        presented = _present(quoted, dtype, native_types.get(column))
        examples = [
            _safe(row[0])
            for row in db.execute(
                f"SELECT {presented} FROM prepared WHERE {quoted} IS NOT NULL ORDER BY {_q(ordinal)} LIMIT 3"
            ).fetchall()
        ]
        schema_columns.append(
            {
                "name": column,
                "dtype": str(native_types[column])
                if column in native_types and dtype != "VARCHAR"
                else {
                    "BIGINT": "int64",
                    "DOUBLE": "float64",
                    "TIMESTAMP": "datetime64[us]",
                    "BOOLEAN": "bool",
                    "VARCHAR": "str",
                }.get(dtype, dtype.casefold()),
                "nullable": bool(missing),
                "missing": missing,
                "unique": unique,
                "examples": examples,
            }
        )
        if has_identifier_semantics(column) and non_null:
            grains.append(
                {
                    "column": column,
                    "non_null": non_null,
                    "unique": unique,
                    "uniqueness": round(unique / non_null, 6),
                    "duplicate_values": non_null - unique,
                }
            )
            _issue(
                issues,
                "duplicate_business_keys",
                f"{column} 有 {non_null - unique} 条重复出现",
                "可能是一单多商品，也可能是重复记录，需要按实际分析口径核查。",
                non_null - unique,
            )
        role = infer_semantic_field_role(
            column,
            is_numeric=numeric,
            is_datetime=temporal,
            is_grain=has_identifier_semantics(column) and bool(non_null),
        )
        profile: dict[str, Any] = {
            "column": column,
            "role": role,
            "status": "candidate",
            "non_null": non_null,
            "missing": missing,
            "unique": unique,
        }
        if numeric and non_null and role != "identifier":
            non_finite = (
                _count(db, f"SELECT count(*) FROM prepared WHERE NOT isfinite({quoted})")
                if dtype in {"FLOAT", "DOUBLE"}
                else 0
            )
            finite_filter = f" FILTER (WHERE isfinite({quoted}))" if non_finite else ""
            minimum, median, maximum, q1, q3 = db.execute(
                f"SELECT min({quoted}), median({quoted}){finite_filter}, max({quoted}), quantile_cont({quoted}, .25){finite_filter}, "
                f"quantile_cont({quoted}, .75){finite_filter} FROM prepared"
            ).fetchone()
            if role == "measure":
                profile["distribution"] = {
                    "min": _safe(minimum),
                    "median": _safe(median),
                    "max": _safe(maximum),
                }
                if non_finite:
                    profile["distribution"]["non_finite"] = non_finite
            outliers = non_finite
            if non_null - non_finite >= 8 and q3 != q1:
                if dtype.startswith("DECIMAL("):
                    with localcontext() as context:
                        context.prec = 100
                        spread = q3 - q1
                        scale = int(dtype.rstrip(")").split(",")[1])
                        unit = Decimal(1).scaleb(-scale)
                        lower = (q1 - Decimal("1.5") * spread).quantize(
                            unit, rounding=ROUND_CEILING
                        )
                        upper = (q3 + Decimal("1.5") * spread).quantize(unit, rounding=ROUND_FLOOR)
                        predicates = (
                            [f"{quoted} < {_literal(lower)}"] if lower > minimum else []
                        ) + ([f"{quoted} > {_literal(upper)}"] if upper < maximum else [])
                else:
                    spread = float(q3 - q1)
                    lower, upper = float(q1) - 1.5 * spread, float(q3) + 1.5 * spread
                    predicates = [
                        f"{quoted} {operator} {_literal(bound)}"
                        for operator, bound in (("<", lower), (">", upper))
                        if math.isfinite(bound)
                    ]
                if non_finite:
                    predicates.append(f"NOT isfinite({quoted})")
                outliers = (
                    _count(db, "SELECT count(*) FROM prepared WHERE " + " OR ".join(predicates))
                    if predicates
                    else 0
                )
            _issue(
                issues,
                "possible_outliers",
                f"{column} 中有 {outliers} 个明显偏离的值",
                "这些记录已保留，分析时会单独核查。",
                outliers,
            )
        if role == "identifier" and non_null:
            profile["uniqueness"] = round(unique / non_null, 6)
        elif role == "time" and temporal and non_null:
            start, end = db.execute(
                f"SELECT {_present(f'min({quoted})', dtype, native_types.get(column))}, "
                f"{_present(f'max({quoted})', dtype, native_types.get(column))} FROM prepared"
            ).fetchone()
            profile["range"] = {"start": _safe(start), "end": _safe(end)}
        elif role not in {"time", "measure"} and non_null:
            top = db.execute(
                f"SELECT {quoted}, count(*) AS n FROM prepared WHERE {quoted} IS NOT NULL "
                f"GROUP BY {quoted} ORDER BY n DESC, min({_q(ordinal)}) LIMIT 5"
            ).fetchall()
            profile["top_values"] = [
                {"value": str(value), "count": count, "share": round(count / non_null, 6)}
                for value, count in top
            ]
        if len(roles) < 80:
            roles.append(profile)
    _issue(
        issues,
        "missing_values",
        f"有 {missing_total} 个缺失值需要分析时留意",
        "未擅自填充可能改变业务含义的空值。",
        missing_total,
    )
    sample = [
        dict(zip(columns, map(_safe, row), strict=True))
        for row in db.execute(
            f"SELECT {', '.join(_present(_q(name), types[name], native_types.get(name)) for name in columns)} "
            f"FROM prepared ORDER BY {_q(ordinal)} LIMIT 8"
        ).fetchall()
    ]
    return (
        {"rows": rows, "columns": schema_columns, "candidate_grain": grains},
        {
            "generated_by": "deterministic_preflight",
            "semantic_role_inference_version": SEMANTIC_ROLE_INFERENCE_VERSION,
            "requires_query_verification": True,
            "shape": {"rows": rows, "columns": len(columns)},
            "candidate_roles": roles,
        },
        sample,
    )


def run_staged_preflight(
    source_path: Path,
    output_dir: Path,
    steps: list[dict[str, Any]],
    stage: Callable[[Path, Path, str, list[dict[str, Any]]], StagedTable],
) -> PreflightResult:
    from app.services import data_preflight as common

    input_fingerprint = common.fingerprint_file(source_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".preflight-", dir=output_dir) as scratch:
        temporary = Path(scratch)
        staged = temporary / "raw.parquet"
        ordinal = "__receiptbi_row_" + uuid4().hex
        table = stage(source_path, staged, ordinal, steps)
        original_rows, columns = table.rows, table.columns
        issues, operations, drift = table.issues, table.operations, table.drift
        expected = {step["operation"] for step in steps}

        def operation(name: str, **facts: Any) -> None:
            operations.append({"operation": name, **facts, "replayed": name in expected})

        with duckdb.connect(
            str(temporary / "prepare.duckdb"),
            config={
                "memory_limit": "256MB",
                "threads": "2",
                "temp_directory": str(temporary / "spill"),
                "max_temp_directory_size": "2GB",
                "autoinstall_known_extensions": "false",
                "autoload_known_extensions": "false",
            },
        ) as db:
            db.read_parquet(str(staged)).create_view("raw_input")
            non_nulls = db.execute(
                "SELECT "
                + ", ".join(f"count({_q(column)})" for column in columns)
                + " FROM raw_input"
            ).fetchone()
            kept = [column for column, count in zip(columns, non_nulls, strict=True) if count]
            if not kept:
                raise ValueError("文件中没有可分析的数据")
            selected_columns = ", ".join(map(_q, kept))
            nonempty = " OR ".join(f"{_q(column)} IS NOT NULL" for column in kept)
            db.execute(f"CREATE VIEW nonempty AS SELECT * FROM raw_input WHERE {nonempty}")
            nonempty_rows = _count(db, "SELECT count(*) FROM nonempty")
            empty_rows, empty_columns = original_rows - nonempty_rows, len(columns) - len(kept)
            if empty_rows or empty_columns or "drop_empty" in expected:
                operation("drop_empty", rows=empty_rows, columns=empty_columns)
                _issue(
                    issues,
                    "empty_regions",
                    "已移除完全空白的区域",
                    f"移除 {empty_rows} 行、{empty_columns} 列空白区域。",
                    empty_rows + empty_columns,
                    automatic=True,
                )
            first = f"lower(trim(cast({_q(kept[0])} AS VARCHAR), {_literal(_WHITESPACE)}))"
            markers = ", ".join(_literal(value) for value in sorted(common.TOTAL_MARKERS))
            total_count = _count(db, f"SELECT count(*) FROM nonempty WHERE {first} IN ({markers})")
            if total_count or "exclude_summary_rows" in expected:
                operation("exclude_summary_rows", count=total_count)
                _issue(
                    issues,
                    "summary_rows",
                    f"已隔离 {total_count} 行合计数据",
                    "合计行不会与明细重复计算。",
                    total_count,
                    automatic=True,
                )
            db.execute(
                f"CREATE TABLE distinct_rows AS SELECT {selected_columns}, min({_q(ordinal)}) AS {_q(ordinal)} "
                f"FROM nonempty WHERE {first} IS NULL OR {first} NOT IN ({markers}) GROUP BY {selected_columns}"
                + (f", {_q(table.identity_column)}" if table.identity_column else "")
            )
            unique_rows = _count(db, "SELECT count(*) FROM distinct_rows")
            duplicates = nonempty_rows - total_count - unique_rows
            if duplicates or "drop_exact_duplicates" in expected:
                operation("drop_exact_duplicates", count=duplicates)
                _issue(
                    issues,
                    "duplicate_rows",
                    f"发现并隔离 {duplicates} 条完全重复记录",
                    "分析副本只保留第一条记录。",
                    duplicates,
                    automatic=True,
                )
            expressions = _typed_expressions(
                db,
                kept,
                steps,
                operations,
                issues,
                drift,
                native_dates=table.native_dates,
                native_types=table.native_types,
                preserve_string_types=table.preserve_string_types,
                literal_strings=table.literal_strings,
            )
            db.execute(
                f"CREATE TABLE prepared AS SELECT {', '.join(expressions)}, {_q(ordinal)} FROM distinct_rows"
            )
            if table.native_types:
                schema, preanalysis, sample = _profile(
                    db, kept, ordinal, issues, native_types=table.native_types
                )
            else:
                schema, preanalysis, sample = _profile(db, kept, ordinal, issues)

            # Policy inference needs column presence and distinct marker values,
            # never every transaction row or unrelated customer fields.
            observations: list[dict[str, Any]] = [dict.fromkeys(kept)]
            for column in kept:
                if not has_refund_semantics(column):
                    continue
                values = db.execute(
                    f"SELECT DISTINCT {_q(column)} FROM prepared WHERE {_q(column)} IS NOT NULL "
                    f"LIMIT {_MAX_REFUND_VALUES + 1}"
                ).fetchall()
                if len(values) + len(observations) > _MAX_REFUND_VALUES + 1:
                    _issue(
                        issues,
                        "refund_values_review",
                        "退款字段的取值较多，需要核对计算口径",
                        "未根据不完整的取值生成退款处理选项。",
                        1,
                    )
                    observations = []
                    break
                observations.extend({column: _safe(value)} for (value,) in values)
            strategies = (
                build_revenue_refund_option_strategies(observations) if observations else {}
            )
            ambiguities = (
                common._revenue_refund_ambiguities(strategies)
                if any(has_monetary_semantics(column) for column in kept)
                else []
            )
            candidate = temporary / "analysis-ready.parquet"
            if table.native_types:
                with db.execute(
                    f"SELECT {selected_columns} FROM prepared ORDER BY {_q(ordinal)}"
                ).to_arrow_reader(_BATCH_ROWS) as batches:
                    output_schema = pa.schema(
                        [
                            pa.field(item.name, table.native_types.get(item.name, item.type))
                            for item in batches.schema
                        ]
                    )
                    with pq.ParquetWriter(candidate, output_schema, compression="zstd") as writer:
                        for batch in batches:
                            writer.write_batch(
                                pa.RecordBatch.from_arrays(
                                    [
                                        _restore_array(array, output_schema[index].type)
                                        for index, array in enumerate(batch.columns)
                                    ],
                                    schema=output_schema,
                                )
                            )
            else:
                db.execute(
                    f"COPY (SELECT {selected_columns} FROM prepared ORDER BY {_q(ordinal)}) "
                    f"TO {_literal(candidate)} (FORMAT PARQUET, COMPRESSION ZSTD)"
                )
            result = common._finish_preflight(
                ready_shape=(schema["rows"], len(kept)),
                original_shape=(original_rows, len(columns)),
                reader_details={
                    **table.reader,
                    "memory_limit": "256MB",
                    "statistics_scope": "full_file",
                    "refund_values_complete": bool(observations),
                },
                replay_steps=steps,
                replay_drift=drift,
                issues=issues,
                operations=operations,
                ambiguities=ambiguities,
                preanalysis=preanalysis,
                sample=sample,
                inferred_schema=schema,
                input_fingerprint=input_fingerprint,
                output_fingerprint=common.fingerprint_file(candidate),
                working_path=candidate,
            )
            if common.fingerprint_file(source_path) != input_fingerprint:
                raise ValueError("整理期间文件发生变化，请重新打开文件后再试")
            target = output_dir / "analysis-ready.parquet"
            candidate.replace(target)
            result.working_path = target
            return result
