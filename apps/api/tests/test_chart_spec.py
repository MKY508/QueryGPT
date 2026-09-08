"""Focused contract tests for the deterministic ChartSpec v1 boundary."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.models import SSEEvent, SSEEventType
from app.models.analysis import AnalysisReport
from app.services.analyst.report_validation import _bind_structured_visualization
from app.services.checkpoint_contract import stable_payload_hash


def _deps_with_result(
    result_name: str,
    rows: list[dict],
    *,
    validated: bool = True,
) -> SimpleNamespace:
    tool_history = []
    validated_results: set[str] = set()
    if validated:
        validated_results.add(result_name)
        tool_history.append(
            {
                "kind": "validation",
                "result_name": result_name,
                "result_hash": stable_payload_hash(rows),
            }
        )
    return SimpleNamespace(
        dataframes={result_name: rows},
        validated_results=validated_results,
        tool_history=tool_history,
    )


def _report(visualization: dict) -> AnalysisReport:
    return AnalysisReport(
        status="completed",
        title="月度销售趋势",
        summary="销售额已按月汇总。",
        visualization=visualization,
    )


def test_chart_spec_binds_exact_numeric_strings_without_rewriting_values_or_hash() -> None:
    rows = [{"category": "001", "amount": "9007199254740993.0123"}]
    deps = _deps_with_result("amounts", rows)
    report = _report(
        {
            "type": "bar",
            "result_name": "amounts",
            "encoding": {"x": {"field": "category"}, "y": [{"field": "amount"}]},
        }
    )
    bound = _bind_structured_visualization(deps, report, "amounts")
    assert bound is not None
    assert bound.data == rows
    assert bound.data_ref.result_hash == stable_payload_hash(rows)
    report.visualization.encoding.y[0].field = "category"
    assert _bind_structured_visualization(deps, report, "amounts") is None


def test_chart_spec_replaces_model_rows_and_result_hash() -> None:
    rows = [
        {"月份": "2026-06", "销售额": 120.0},
        {"月份": "2026-07", "销售额": 180.0},
    ]
    deps = _deps_with_result("monthly_sales", rows)
    report = _report(
        {
            "version": 1,
            "type": "bar",
            "title": "月度销售",
            "data_ref": {"result_name": "monthly_sales", "result_hash": "model-fake"},
            "encoding": {
                "x": {"field": "月份", "kind": "temporal"},
                "y": [{"field": "销售额", "format": "currency"}],
            },
            "presentation": {
                "orientation": "vertical",
                "stack": "none",
                "palette": "receiptbi",
            },
            "data": [{"月份": "伪造", "销售额": 999999}],
        }
    )

    # Input rows are never retained before the system-owned binding step.
    assert report.visualization is not None
    assert report.visualization.data == []

    bound = _bind_structured_visualization(deps, report, "monthly_sales")

    assert bound is not None
    payload = bound.model_dump()
    assert payload["version"] == 1
    assert payload["data"] == rows
    assert payload["data_ref"] == {
        "result_name": "monthly_sales",
        "result_hash": stable_payload_hash(rows),
    }
    assert "xKey" not in payload
    assert "yKeys" not in payload
    assert "result_name" not in payload


def test_chart_spec_drops_unknown_measures_and_rejects_unknown_x_field() -> None:
    rows = [{"月份": "2026-07", "销售额": 180.0}]
    deps = _deps_with_result("monthly_sales", rows)
    report = _report(
        {
            "type": "line",
            "result_name": "monthly_sales",
            "encoding": {
                "x": {"field": "月份"},
                "y": [{"field": "销售额"}, {"field": "不存在的指标"}],
            },
        }
    )

    bound = _bind_structured_visualization(deps, report, "monthly_sales")

    assert bound is not None
    assert [item.field for item in bound.encoding.y] == ["销售额"]

    report.visualization.encoding.x.field = "不存在的维度"
    assert _bind_structured_visualization(deps, report, "monthly_sales") is None


def test_chart_spec_rejects_non_numeric_measures_and_scatter_categories() -> None:
    rows = [{"品类": "办公用品", "文本金额": "180元", "是否有效": True, "销售额": 180.0}]
    deps = _deps_with_result("category_sales", rows)
    report = _report(
        {
            "type": "bar",
            "result_name": "category_sales",
            "xKey": "品类",
            "yKeys": ["文本金额", "是否有效"],
        }
    )
    assert _bind_structured_visualization(deps, report, "category_sales") is None

    scatter = _report(
        {
            "type": "scatter",
            "result_name": "category_sales",
            "xKey": "品类",
            "yKeys": ["销售额"],
        }
    )
    assert _bind_structured_visualization(deps, scatter, "category_sales") is None


@pytest.mark.parametrize(("chart_type", "x_key"), [("pie", "品类"), ("scatter", "序号")])
def test_single_series_charts_keep_only_the_first_measure(
    chart_type: str,
    x_key: str,
) -> None:
    rows = [{"序号": 1, "品类": "办公用品", "销售额": 180.0, "订单量": 4}]
    deps = _deps_with_result("category_sales", rows)
    report = _report(
        {
            "type": chart_type,
            "result_name": "category_sales",
            "xKey": x_key,
            "yKeys": ["销售额", "订单量"],
        }
    )

    bound = _bind_structured_visualization(deps, report, "category_sales")

    assert bound is not None
    assert [item.field for item in bound.encoding.y] == ["销售额"]


@pytest.mark.parametrize(
    ("chart_type", "x_key", "orientation", "stack", "expected_orientation", "expected_stack"),
    [
        ("bar", "品类", "horizontal", "percent", "horizontal", "percent"),
        ("horizontal_bar", "品类", "vertical", "normal", "horizontal", "normal"),
        ("line", "品类", "horizontal", "normal", "vertical", "none"),
        ("area", "品类", "horizontal", "percent", "vertical", "percent"),
        ("pie", "品类", "horizontal", "normal", "vertical", "none"),
        ("scatter", "序号", "horizontal", "percent", "vertical", "none"),
    ],
)
def test_chart_spec_canonicalizes_orientation_and_stack_for_each_chart_family(
    chart_type: str,
    x_key: str,
    orientation: str,
    stack: str,
    expected_orientation: str,
    expected_stack: str,
) -> None:
    rows = [{"序号": 1, "品类": "办公用品", "销售额": 180.0, "订单量": 4}]
    deps = _deps_with_result("category_sales", rows)
    y_keys = ["销售额", "订单量"] if chart_type in {"bar", "horizontal_bar", "area"} else ["销售额"]
    report = _report(
        {
            "type": chart_type,
            "result_name": "category_sales",
            "xKey": x_key,
            "yKeys": y_keys,
            "presentation": {
                "orientation": orientation,
                "stack": stack,
                "palette": "receiptbi",
            },
        }
    )

    bound = _bind_structured_visualization(deps, report, "category_sales")

    assert bound is not None
    assert bound.presentation.orientation == expected_orientation
    assert bound.presentation.stack == expected_stack


def test_single_measure_chart_disables_stacking() -> None:
    rows = [{"品类": "办公用品", "销售额": 180.0}]
    deps = _deps_with_result("category_sales", rows)
    report = _report(
        {
            "type": "bar",
            "result_name": "category_sales",
            "xKey": "品类",
            "yKeys": ["销售额"],
            "presentation": {
                "orientation": "vertical",
                "stack": "percent",
                "palette": "receiptbi",
            },
        }
    )

    bound = _bind_structured_visualization(deps, report, "category_sales")

    assert bound is not None
    assert bound.presentation.stack == "none"


def test_chart_spec_normalizes_legacy_field_bindings_to_v1() -> None:
    rows = [{"品类": "办公用品", "销售额": 62.0}]
    deps = _deps_with_result("category_sales", rows)
    report = _report(
        {
            "type": "horizontal_bar",
            "title": "品类销售额",
            "result_name": "category_sales",
            "xKey": "品类",
            "yKeys": ["销售额"],
            "stack": False,
        }
    )

    bound = _bind_structured_visualization(deps, report, None)

    assert bound is not None
    payload = bound.model_dump()
    assert payload["version"] == 1
    assert payload["encoding"]["x"]["field"] == "品类"
    assert payload["encoding"]["y"][0]["field"] == "销售额"
    assert payload["presentation"] == {
        "orientation": "horizontal",
        "stack": "none",
        "palette": "receiptbi",
    }
    assert payload["data_ref"]["result_name"] == "category_sales"


def test_chart_spec_is_removed_when_result_is_not_currently_validated() -> None:
    rows = [{"月份": "2026-07", "销售额": 180.0}]
    deps = _deps_with_result("monthly_sales", rows, validated=False)
    report = _report(
        {
            "type": "bar",
            "result_name": "monthly_sales",
            "xKey": "月份",
            "yKeys": ["销售额"],
        }
    )

    assert _bind_structured_visualization(deps, report, "monthly_sales") is None


def test_chart_spec_rejects_more_than_one_thousand_bound_rows() -> None:
    rows = [{"序号": index, "销售额": float(index)} for index in range(1001)]
    deps = _deps_with_result("raw_sales", rows)
    report = _report(
        {
            "type": "scatter",
            "result_name": "raw_sales",
            "xKey": "序号",
            "yKeys": ["销售额"],
        }
    )

    assert _bind_structured_visualization(deps, report, "raw_sales") is None


def test_chart_spec_rejects_model_authored_colors_and_code() -> None:
    with pytest.raises(ValueError):
        _report(
            {
                "type": "bar",
                "xKey": "月份",
                "yKeys": ["销售额"],
                "colors": ["#16836b"],
            }
        )

    with pytest.raises(ValueError):
        _report(
            {
                "type": "bar",
                "xKey": "月份",
                "yKeys": ["销售额"],
                "javascript": "alert('no')",
            }
        )


def test_visualization_sse_preserves_v1_and_keeps_legacy_compatibility() -> None:
    spec = {
        "version": 1,
        "type": "scatter",
        "title": "客单价与订单量",
        "data_ref": {"result_name": "store_summary", "result_hash": "abc"},
        "encoding": {
            "x": {"field": "客单价", "label": None, "kind": "number"},
            "y": [
                {
                    "field": "订单量",
                    "label": None,
                    "kind": "number",
                    "aggregate": None,
                    "format": "integer",
                }
            ],
        },
        "presentation": {
            "orientation": "vertical",
            "stack": "none",
            "palette": "categorical",
        },
        "data": [{"客单价": 42.0, "订单量": 10}],
    }

    event = SSEEvent.visualization("scatter", spec)

    assert event.type == SSEEventType.VISUALIZATION
    assert event.data["chart"] == spec

    legacy = SSEEvent.visualization(
        "bar",
        {
            "type": "bar",
            "title": "旧图表",
            "xKey": "月份",
            "yKeys": ["销售额"],
            "data": [{"月份": "7月", "销售额": 100}],
        },
    )
    assert legacy.data["chart"] == {
        "type": "bar",
        "title": "旧图表",
        "xKey": "月份",
        "yKeys": ["销售额"],
        "data": [{"月份": "7月", "销售额": 100}],
    }
