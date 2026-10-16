"""Export scalar values and their presentation choices without coercing exact text."""

from typing import Any

_STYLES = {"raw": "原样", "number": "数字", "currency": "货币", "percent": "百分比（0.1 → 10%）"}
_CURRENCIES = {"CNY", "USD", "EUR", "GBP", "JPY", "HKD"}


def _scalar(content: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in content:
            value = content[key]
            if value is None or type(value) in {str, int, float}:
                return value
    return None


def metric_export_rows(
    content: dict[str, Any], config: dict[str, Any]
) -> tuple[list[str], list[list[Any]]]:
    candidate = config.get("metric_display")
    display = candidate if isinstance(candidate, dict) else {}
    style = display.get("style")
    style = style if isinstance(style, str) and style in _STYLES else "raw"
    currency = display.get("currency")
    currency = currency if isinstance(currency, str) and currency in _CURRENCIES else "CNY"
    decimals = display.get("decimals")
    decimals = (
        int(decimals)
        if type(decimals) in {int, float} and 0 <= decimals <= 8 and int(decimals) == decimals
        else "自动"
    )
    suffix = display.get("suffix")
    suffix = suffix[:32].strip() if isinstance(suffix, str) else ""
    # Excel data export is deliberately not a screenshot: keep the unrounded
    # value and display choices in separate columns, including exact text cells.
    # No user-authored Excel format codes or formulas are evaluated.
    return ["原始数值", "数值格式", "小数位数", "币种", "千分位分隔", "单位后缀", "补充说明"], [
        [
            _scalar(content, ("value", "metric", "amount", "result")),
            _STYLES[style],
            decimals if style != "raw" else "",
            currency if style == "currency" else "",
            ("否" if display.get("grouping") is False else "是") if style != "raw" else "",
            suffix,
            _scalar(content, ("context", "note", "summary", "description")),
        ]
    ]
