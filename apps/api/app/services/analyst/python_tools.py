"""Optional Python analysis, package repair and deterministic chart rendering."""

from __future__ import annotations

import ast
import json
import re
from typing import Any, Literal

from pydantic_ai import ModelRetry, RunContext

from app.services.analysis_checkpoint import stable_payload_hash
from app.services.analyst.session import (
    AnalystSession,
)
from app.services.python_runtime import validate_python_code
from app.services.python_sandbox import PythonSandbox

_PYTHON_JOIN_PATTERN = re.compile(r"(?:\.merge\s*\(|pd\.merge\s*\(|\.join\s*\()")


def _python_uses_join(code: str) -> bool:
    return _PYTHON_JOIN_PATTERN.search(code) is not None


def _python_referenced_results(code: str, available: set[str]) -> list[str]:
    """Return retained result names referenced directly or through ``dfs[name]``."""

    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []
    referenced: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id in available:
            referenced.add(node.id)
            continue
        if not isinstance(node, ast.Subscript):
            continue
        if not isinstance(node.value, ast.Name) or node.value.id != "dfs":
            continue
        value = node.slice.value if isinstance(node.slice, ast.Constant) else None
        if isinstance(value, str) and value in available:
            referenced.add(value)
    return sorted(referenced)


def _build_result_chart_code(
    rows: list[dict[str, Any]],
    *,
    chart_type: Literal["heatmap", "bar", "line", "scatter", "histogram", "box"],
    x: str,
    y: str | None,
    value: str | None,
    color: str | None,
    title: str,
) -> str:
    """Build deterministic, reviewable chart code from validated rows."""

    columns = {str(column) for row in rows for column in row}
    required = [x]
    if chart_type in {"heatmap", "bar", "line", "scatter", "box"}:
        if not y:
            raise ValueError(f"{chart_type} 图需要 y 字段")
        required.append(y)
    if chart_type == "heatmap":
        if not value:
            raise ValueError("热力图需要 value 字段")
        required.append(value)
    if color:
        required.append(color)
    missing = [column for column in required if column not in columns]
    if missing:
        raise ValueError(f"绘图字段不存在：{'、'.join(missing)}")

    x_literal = json.dumps(x, ensure_ascii=False)
    y_literal = json.dumps(y, ensure_ascii=False)
    value_literal = json.dumps(value, ensure_ascii=False)
    color_literal = "None" if color is None else json.dumps(color, ensure_ascii=False)
    title_literal = json.dumps(title, ensure_ascii=False)
    if chart_type == "heatmap":
        body = f"""
matrix = chart_source.pivot_table(index={y_literal}, columns={x_literal}, values={value_literal}, aggfunc='sum', fill_value=0)
sns.heatmap(matrix, annot=True, fmt='.2g', cmap='YlGnBu', linewidths=.5)
"""
    elif chart_type == "histogram":
        body = f"sns.histplot(data=chart_source, x={x_literal}, hue={color_literal}, kde=True)"
    else:
        function_name = {
            "bar": "barplot",
            "line": "lineplot",
            "scatter": "scatterplot",
            "box": "boxplot",
        }[chart_type]
        body = (
            f"sns.{function_name}(data=chart_source, x={x_literal}, y={y_literal}, "
            f"hue={color_literal})"
        )
    return f"""
import seaborn as sns
import matplotlib.pyplot as plt
plt.figure(figsize=(10, 6))
{body}
plt.title({title_literal})
plt.tight_layout()
""".strip()


async def _render_result_chart(
    sandbox: PythonSandbox,
    rows: list[dict[str, Any]],
    *,
    chart_type: Literal["heatmap", "bar", "line", "scatter", "histogram", "box"],
    x: str,
    y: str | None,
    value: str | None,
    color: str | None,
    title: str,
) -> tuple[str | None, list[str], str]:
    """Render a bounded chart from validated rows using generated, reviewable Python."""

    code = _build_result_chart_code(
        rows,
        chart_type=chart_type,
        x=x,
        y=y,
        value=value,
        color=color,
        title=title,
    )
    output, images = await sandbox.execute(
        code,
        sql_data={"chart_source": rows},
        timeout=90,
    )
    return output, images, code


async def render_chart(
    ctx: RunContext[AnalystSession],
    result_name: str,
    chart_type: Literal["heatmap", "bar", "line", "scatter", "histogram", "box"],
    x: str,
    title: str,
    purpose: str,
    y: str | None = None,
    value: str | None = None,
    color: str | None = None,
) -> dict[str, Any]:
    """Render a common business chart from a retained result."""

    ctx.deps.policy.require_python("Python 图表")
    ctx.deps.queue_progress("render_chart")
    rows = ctx.deps.dataframes.get(result_name)
    if rows is None:
        raise ModelRetry("绘图只能使用实际存在的 result_name")
    try:
        output, images, code = await _render_result_chart(
            ctx.deps.python_sandbox,
            rows,
            chart_type=chart_type,
            x=x,
            y=y,
            value=value,
            color=color,
            title=title,
        )
    except (ValueError, RuntimeError, SyntaxError) as exc:
        raise ModelRetry(f"绘图失败，请修正字段或图表类型：{exc}") from exc
    if not images:
        raise ModelRetry("绘图没有生成可验证的图像，请调整图表参数后重试")
    chart_output = output or ""
    output_index = len(ctx.deps.python_output)
    image_start = len(ctx.deps.python_images)
    ctx.deps.python_output.append(chart_output)
    ctx.deps.python_images.extend(images)
    code_hash = stable_payload_hash(code)
    ctx.deps.tool_history.append(
        {
            "kind": "python",
            "purpose": purpose,
            "code": code,
            "generated": True,
            "chart_type": chart_type,
            "result_name": result_name,
            "input_results": [result_name],
            "input_hashes": {result_name: stable_payload_hash(rows)},
            "source_refs": list(
                (ctx.deps.result_metadata.get(result_name) or {}).get("source_refs", [])
            ),
            "images": len(images),
            "image_start": image_start,
            "image_count": len(images),
            "image_hashes": [stable_payload_hash(image) for image in images],
            "output": chart_output[-2000:],
            "code_hash": code_hash,
        }
    )
    ctx.deps.replay_journal.append(
        {
            "op": "render_chart",
            "purpose": purpose,
            "result_name": result_name,
            "chart_type": chart_type,
            "x": x,
            "y": y,
            "value": value,
            "color": color,
            "title": title,
            "input_hash": stable_payload_hash(rows),
            "code_hash": code_hash,
            "output_index": output_index,
            "output_hash": stable_payload_hash(chart_output),
            "image_start": image_start,
            "image_count": len(images),
            "image_hashes": [stable_payload_hash(image) for image in images],
        }
    )
    await ctx.deps.checkpoint()
    return {"images_created": len(images), "chart_type": chart_type}


async def analyze_with_python(
    ctx: RunContext[AnalystSession],
    code: str,
    purpose: str,
    input_results: list[str] | None = None,
) -> dict[str, Any]:
    """Run free Python over retained results and record any outputs it actually creates."""

    ctx.deps.policy.require_python("Python 分析")
    available_results = set(ctx.deps.dataframes)
    selected_results = list(dict.fromkeys(input_results or []))
    unknown_results = [name for name in selected_results if name not in available_results]
    if unknown_results:
        raise ModelRetry("Python 输入结果不存在：" + "、".join(unknown_results))
    if not selected_results:
        selected_results = _python_referenced_results(code, available_results)
    if not selected_results and len(available_results) == 1:
        selected_results = [next(iter(available_results))]
    if not selected_results and "dfs" in code:
        selected_results = sorted(available_results)

    source_ids = {
        str(ref.get("source_id") or "")
        for name in selected_results
        for ref in (ctx.deps.result_metadata.get(name) or {}).get("source_refs", [])
        if ref.get("source_id")
    }
    already_joined = any(
        (ctx.deps.result_metadata.get(name) or {}).get("relationship") for name in selected_results
    )
    if _python_uses_join(code) and len(source_ids) > 1 and not already_joined:
        raise ModelRetry(
            "这段 Python 正在直接合并多个独立来源。请先用 join_results 生成一个经过"
            "覆盖率和基数检查的结果，再自由使用 Python。"
        )

    python_inputs = {
        name: ctx.deps.dataframes[name] for name in selected_results if name in ctx.deps.dataframes
    }
    if not python_inputs:
        python_inputs = ctx.deps.dataframes
    ctx.deps.queue_progress("supplemental_analysis")
    try:
        output, images, auto_installed = await execute_python_code(
            ctx.deps,
            code,
            sql_data=python_inputs,
            timeout=90,
        )
    except (ValueError, RuntimeError, SyntaxError) as exc:
        dataframe_hint = (
            "dfs[name] 是 pandas DataFrame，请使用 df['字段']、itertuples() 或 "
            "to_dict('records')，不能把它当作字典列表逐行下标。"
        )
        raise ModelRetry(f"Python 分析失败，请修正代码后重试。{dataframe_hint}错误：{exc}") from exc
    if auto_installed:
        ctx.deps.tool_history.append(
            {
                "kind": "dependency",
                "purpose": "Python 执行前自动补齐缺失模块",
                "packages": auto_installed,
                "automatic": True,
            }
        )
    python_output = output or ""
    output_index = len(ctx.deps.python_output)
    image_start = len(ctx.deps.python_images)
    ctx.deps.python_output.append(python_output)
    ctx.deps.python_images.extend(images)
    source_refs = {
        (str(ref.get("source_id") or ""), str(ref.get("source_logical_name") or "")): ref
        for name in selected_results
        for ref in (ctx.deps.result_metadata.get(name) or {}).get("source_refs", [])
    }
    ctx.deps.tool_history.append(
        {
            "kind": "python",
            "purpose": purpose,
            "code": code,
            "code_hash": stable_payload_hash(code),
            "input_results": selected_results,
            "input_hashes": {
                name: stable_payload_hash(ctx.deps.dataframes[name]) for name in selected_results
            },
            "source_refs": list(source_refs.values()),
            "images": len(images),
            "image_start": image_start,
            "image_count": len(images),
            "image_hashes": [stable_payload_hash(image) for image in images],
            "output_index": output_index,
            "output": python_output[-2000:],
        }
    )
    await ctx.deps.checkpoint(
        resumable=False,
        reason="python_state_not_replayable",
    )
    return {
        "output": python_output[-4000:],
        "images_created": len(images),
        "input_results": selected_results,
        "auto_installed": auto_installed,
    }


async def install_python_packages(
    ctx: RunContext[AnalystSession], packages: list[str], reason: str
) -> str:
    """Install missing long-tail analysis packages into this project's isolated import path."""

    ctx.deps.policy.require_python("Python 依赖安装")
    ctx.deps.policy.require_auto_repair("Python 依赖安装")
    ctx.deps.queue_progress("prepare_capabilities")
    try:
        result = await ctx.deps.dependency_manager.install(packages)
    except (ValueError, RuntimeError) as exc:
        raise ModelRetry(f"依赖安装失败，请改用已有库或修正包名：{exc}") from exc
    ctx.deps.python_sandbox.cleanup()
    ctx.deps.tool_history.append({"kind": "dependency", "purpose": reason, "packages": packages})
    return result


async def execute_python_code(
    session: AnalystSession,
    code: str,
    *,
    sql_data: dict[str, Any],
    timeout: int = 90,
) -> tuple[str | None, list[str], list[str]]:
    """Install straightforward missing imports once, then execute the original code."""

    session.policy.require_python("Python 分析")
    is_safe, safety_error = validate_python_code(code)
    if not is_safe:
        raise ValueError(safety_error)
    missing_modules = session.python_sandbox.missing_modules(code)
    if missing_modules:
        if not session.policy.auto_repair_enabled:
            raise RuntimeError(
                "当前已关闭自动修复，Python 环境缺少模块：" + "、".join(missing_modules)
            )
        try:
            await session.dependency_manager.install(missing_modules)
        except (ValueError, RuntimeError) as exc:
            raise RuntimeError(
                "自动安装缺失模块失败："
                + "、".join(missing_modules)
                + f"。如导入名与发行包名不同，请改用对应发行包：{exc}"
            ) from exc
        # A previous stateful worker may cache directory contents. Restart
        # only that worker so the atomically replaced project environment
        # is visible before retrying the exact same analysis code.
        session.python_sandbox.cleanup()
    output, images = await session.python_sandbox.execute(
        code,
        sql_data=sql_data,
        timeout=timeout,
    )
    return output, images, missing_modules
