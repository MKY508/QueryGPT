"""Evidence-based completion and report validation, independent of agent construction."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

import structlog
from pydantic_ai import ModelRetry, RunContext

from app.i18n import t
from app.models.analysis import (
    AnalysisReport,
    ChartDataRef,
    ChartSpec,
    ReportAction,
    ReportNextAction,
)
from app.services.analysis_checkpoint import stable_payload_hash
from app.services.analyst.confirmation import (
    _canonical_confirmation_key,
)
from app.services.analyst.relationships import (
    _current_runtime_relationship,
)
from app.services.analyst.result_store import (
    _is_result_currently_validated,
    _protected_result_profile,
)
from app.services.analyst.session import (
    AnalystSession,
)
from app.services.business_decision_slots import (
    canonicalize_decision_key,
)
from app.services.correction_completion import (
    CorrectionCompletionError,
    build_correction_application_receipt,
)
from app.services.golden_regression import evaluate_golden_contract, find_matching_contract
from app.services.metric_lineage import prove_metric_application_lineage
from app.services.project_context import (
    required_relationship_validation_status,
)
from app.services.result_values import is_chart_number

logger = structlog.get_logger()


def _business_evidence_from_tools(
    tool_history: list[dict[str, Any]],
    *,
    latest_result: str | None,
) -> list[str]:
    """Turn verified tool facts into concise, non-technical report evidence."""

    evidence: list[str] = []
    kinds = {str(item.get("kind") or "") for item in tool_history}
    structured_kinds = {
        str(item.get("source_kind") or "")
        for item in tool_history
        if item.get("kind") == "structured_query"
    }
    used_file = "file_sql" in kinds or "file" in structured_kinds
    used_connection = "sql" in kinds or "connection" in structured_kinds
    if used_file:
        evidence.append("结论使用了项目文件中的实际明细记录。")
    if used_connection:
        conjunction = "同时" if used_file else ""
        evidence.append(f"结论{conjunction}使用了已连接业务数据库中的实际记录。")

    rule = next(
        (
            item
            for item in reversed(tool_history)
            if item.get("kind") == "business_rule_application"
        ),
        None,
    )
    if rule is not None:
        evidence.append(
            f"已按“{rule.get('rule_value') or '已确认口径'}”处理 "
            f"{int(rule.get('before_rows') or 0)} 条记录，其中排除 "
            f"{int(rule.get('excluded_rows') or 0)} 条。"
        )

    relationship = next(
        (
            item
            for item in reversed(tool_history)
            if item.get("kind") in {"relationship_validation", "relationship_application", "join"}
            and isinstance(item.get("profile"), dict)
        ),
        None,
    )
    if relationship is not None:
        profile = relationship.get("profile") or {}
        evidence.append(
            "跨来源记录的关联覆盖率为 "
            f"{float(profile.get('left_match_rate') or 0):.1%}，"
            f"关联后行数为原来的 {float(profile.get('expansion_ratio') or 0):.2f} 倍。"
        )

    validation = next(
        (
            item
            for item in reversed(tool_history)
            if item.get("kind") == "validation"
            and (not latest_result or item.get("result_name") == latest_result)
        ),
        None,
    )
    if validation is not None:
        profile = validation.get("profile") or {}
        evidence.append(
            f"最终汇总共 {int(profile.get('materialized_rows') or 0)} 行，"
            f"{'未发生截断' if not profile.get('truncated') else '存在截断'}。"
        )
    return evidence


_SAMPLE_SCOPE_PATTERN = re.compile(
    r"(?:样本|样例|抽样|采样|有限(?:样本|数据)|部分(?:数据|记录)|"
    r"(?:前|最多|至多|不超过)\s*\d+\s*行|"
    r"不(?:做|要|需|需要)?(?:全表|全量)(?:扫描|读取)?|"
    r"无需(?:全表|全量)(?:扫描|读取)|"
    r"\b(?:sample|sampled|sampling|limited\s+(?:sample|subset)|partial\s+data|"
    r"preview|first\s+\d+\s+rows|up\s+to\s+\d+\s+rows|"
    r"no\s+full(?:-table)?\s+scan)\b)"
)
_DATA_QUALITY_OVERVIEW_PATTERN = re.compile(
    r"(?:数据质量(?:概览|总览|检查|评估|审查|报告)?|质量(?:概览|总览|检查)|"
    r"(?:检查|概览|查看|识别)[^。；;,.]{0,12}(?:空值|缺失值|重复(?:值|行|记录)|异常值|字段类型)|"
    r"\bdata\s+quality(?:\s+(?:overview|check|assessment|review|report))?\b)"
)
_FULL_SCOPE_PATTERN = re.compile(
    r"(?:全量|全部(?:数据|记录|订单|客户|门店|行)|所有(?:数据|记录|订单|客户|门店|行)|"
    r"全表|全库|完整(?:数据|数据集|结果)|整体(?:数据|结果|指标)|总体(?:数据|结果|指标)|"
    r"不(?:要|能|可)?抽样|禁止抽样|"
    r"\b(?:all\s+rows|entire\s+(?:dataset|table)|full\s+(?:dataset|table)|"
    r"whole\s+table|complete\s+dataset|population-wide|no\s+sampling|"
    r"without\s+sampling)\b)"
)
_FULL_OUTPUT_PATTERN = re.compile(
    r"(?:(?:全量|全部|整体|总体|所有|全(?:公司|平台|业务|门店|客户|订单))"
    r"(?:数据|记录|订单|客户|门店|行)?(?:的)?[^。；;,.]{0,10}"
    r"(?:总计|总数|总额|总量|总和|收入|营收|销售额|订单数|指标|排名|排行|"
    r"占比|比例|份额|结论|结果)|"
    r"\b(?:population|overall|full|all)\b[^.;,]{0,16}"
    r"\b(?:total|revenue|sales|metric|ranking?|share|percentage|percent|result)\b)"
)
_POPULATION_METRIC_PATTERN = re.compile(
    r"(?:总(?:计|数|额|量|和|收入|销售额|订单数|客户数)|合计|累计|收入|营收|"
    r"销售额|订单数|订单量|排名|排行|名次|"
    r"占比|比例|份额|前\s*\d+\s*名|后\s*\d+\s*名|最高|最低|最多|最少|"
    r"\b(?:total|totals|ranking?|share|percentage|percent|top\s+\d+|"
    r"bottom\s+\d+|highest|lowest|most|least)\b)"
)
_NEGATED_SCOPE_PATTERN = re.compile(
    r"(?:不|非|未|无需|不要|不用|避免|不能|不可|并非|并不|"
    r"\b(?:not|no|without|does\s+not|do\s+not)\b).{0,24}$"
)


def _normalized_scope_text(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).casefold()).strip()


def _has_unnegated_match(text: str, pattern: re.Pattern[str]) -> bool:
    """Find a scope claim while preserving phrases such as “不代表全量数据”."""

    for match in pattern.finditer(text):
        prefix = text[max(0, match.start() - 32) : match.start()]
        if _NEGATED_SCOPE_PATTERN.search(prefix):
            continue
        return True
    return False


def _report_claim_text(report: AnalysisReport) -> str:
    visualization_title = str(report.visualization.title or "") if report.visualization else ""
    return _normalized_scope_text(
        " ".join(
            [
                report.title,
                report.summary,
                *report.findings,
                *(metric.label for metric in report.metrics),
                *(metric.value for metric in report.metrics),
                *(metric.context or "" for metric in report.metrics),
                *report.evidence,
                visualization_title,
            ]
        )
    )


def _allows_honest_partial_report(query: str, report: AnalysisReport) -> bool:
    """Allow truncated evidence only when its user-facing scope is genuinely partial.

    Authorization comes from the user's request, never from a model-authored disclaimer.
    Explicit population requests win over sample wording. A limited sample request may
    still contain sample-local metrics, rankings or percentages, but neither the request
    nor the report may claim that the retained rows cover the full population.
    """

    query_text = _normalized_scope_text(query)
    report_claim_text = _report_claim_text(report)
    explicit_sample_request = bool(_SAMPLE_SCOPE_PATTERN.search(query_text))
    data_quality_overview = bool(_DATA_QUALITY_OVERVIEW_PATTERN.search(query_text))

    if _has_unnegated_match(query_text, _FULL_OUTPUT_PATTERN):
        return False
    if _has_unnegated_match(report_claim_text, _FULL_OUTPUT_PATTERN):
        return False
    if _has_unnegated_match(query_text, _FULL_SCOPE_PATTERN) and not explicit_sample_request:
        return False
    if _has_unnegated_match(report_claim_text, _FULL_SCOPE_PATTERN):
        return False
    if _has_unnegated_match(query_text, _POPULATION_METRIC_PATTERN) and not explicit_sample_request:
        return False
    return explicit_sample_request or data_quality_overview


def _mark_report_as_partial_sample(
    report: AnalysisReport,
    metadata: dict[str, Any],
) -> None:
    """Make the accepted partial scope visible even when the model omitted a disclaimer."""

    try:
        materialized_rows = max(0, int(metadata.get("materialized_rows") or 0))
    except (TypeError, ValueError):
        materialized_rows = 0
    sample_scope = (
        f"当前返回的 {materialized_rows:,} 行有限样本"
        if materialized_rows
        else "当前返回的有限样本"
    )
    summary_scope = _normalized_scope_text(report.summary)
    has_sample_scope = bool(_SAMPLE_SCOPE_PATTERN.search(summary_scope))
    has_population_limit = bool(
        re.search(
            r"(?:不|不能|不可|并非|并不).{0,12}(?:全量|全部|整体|总体|所有)|"
            r"\b(?:not|cannot|can't|does\s+not).{0,24}\b(?:full|all|population)\b",
            summary_scope,
        )
    )
    if not (has_sample_scope and has_population_limit):
        disclosure = f"本报告仅基于{sample_scope}，结论只描述该样本，不能外推为全量数据结论。"
        report.summary = f"{disclosure}{report.summary.strip()}"

    for metric in report.metrics:
        metric_scope = _normalized_scope_text(" ".join([metric.label, metric.context or ""]))
        if _SAMPLE_SCOPE_PATTERN.search(metric_scope):
            continue
        qualifier = f"仅基于{sample_scope}"
        metric.context = (
            f"{metric.context.rstrip('。；; ')}；{qualifier}" if metric.context else qualifier
        )

    if report.visualization:
        title = str(report.visualization.title or report.title)
        if not _SAMPLE_SCOPE_PATTERN.search(_normalized_scope_text(title)):
            report.visualization.title = f"{title}（有限样本）"


def _primary_report_result(
    deps: AnalystSession,
    report: AnalysisReport,
) -> str | None:
    """Select an actual validated result without interpreting words in the request."""

    requested = str(report.primary_result or "")
    if requested and _is_result_currently_validated(deps, requested):
        return requested
    for item in reversed(deps.tool_history):
        if item.get("kind") != "python" or int(item.get("images") or 0) <= 0:
            continue
        candidates = item.get("input_results") or (
            [item.get("result_name")] if item.get("result_name") else []
        )
        for candidate in reversed(candidates):
            name = str(candidate or "")
            input_hash = str((item.get("input_hashes") or {}).get(name) or "")
            if (
                _is_result_currently_validated(deps, name)
                and input_hash
                and input_hash == stable_payload_hash(deps.dataframes[name])
            ):
                return name
    validated = next(
        (
            str(item.get("result_name") or "")
            for item in reversed(deps.tool_history)
            if item.get("kind") == "validation"
            and _is_result_currently_validated(deps, str(item.get("result_name") or ""))
        ),
        None,
    )
    if validated:
        return validated
    return next(
        (
            str(item.get("result_name") or "")
            for item in reversed(deps.tool_history)
            if item.get("kind")
            in {
                "sql",
                "file_sql",
                "structured_query",
                "join",
                "aggregate",
                "business_rule_application",
            }
            and item.get("result_name")
        ),
        None,
    )


def _bind_structured_visualization(
    deps: AnalystSession,
    report: AnalysisReport,
    primary_result: str | None,
) -> ChartSpec | None:
    """Replace model-authored chart rows with rows from a current validated result."""

    requested = report.visualization
    if requested is None:
        return None
    requested_result_name = requested.data_ref.result_name if requested.data_ref else ""
    result_name = str(requested_result_name or primary_result or "")
    if not result_name or not _is_result_currently_validated(deps, result_name):
        return None
    rows = deps.dataframes[result_name]
    # A raw high-cardinality table is not a useful or honest structured chart.
    # Keep the report and let Python or a later aggregate provide the visual instead.
    if not rows or len(rows) > 1000:
        return None
    columns = {str(column) for row in rows for column in row}
    requested_x = requested.encoding.x
    if requested_x is None or requested_x.field not in columns:
        return None
    requested_y = requested.encoding.y
    existing_y = [
        item
        for item in requested_y
        if item.field in columns and any(is_chart_number(row.get(item.field)) for row in rows)
    ]
    if not existing_y:
        return None
    if requested.type in {"pie", "scatter"}:
        existing_y = existing_y[:1]
    if requested.type == "scatter" and not any(
        is_chart_number(row.get(requested_x.field)) for row in rows
    ):
        return None
    orientation = requested.presentation.orientation
    if requested.type == "horizontal_bar":
        orientation = "horizontal"
    elif requested.type not in {"bar", "horizontal_bar"}:
        orientation = "vertical"
    stack = requested.presentation.stack
    if requested.type in {"line", "pie", "scatter"} or len(existing_y) < 2:
        stack = "none"

    return requested.model_copy(
        update={
            "title": str(requested.title or report.title),
            "data_ref": ChartDataRef(
                result_name=result_name,
                result_hash=stable_payload_hash(rows),
            ),
            "encoding": requested.encoding.model_copy(update={"y": existing_y}),
            "presentation": requested.presentation.model_copy(
                update={"orientation": orientation, "stack": stack}
            ),
            "data": rows,
        },
        deep=True,
    )


def _trusted_reference_revalidation_failure(
    deps: AnalystSession,
    report: AnalysisReport,
    *,
    latest_result: str | None,
) -> str | None:
    """Prevent a validated historical snapshot from becoming a current answer."""

    if not deps.project.active_trusted_references or report.status != "completed":
        return None
    evidence_kinds = {str(item.get("kind") or "") for item in deps.tool_history}
    has_current_read = bool(evidence_kinds.intersection({"sql", "file_sql", "structured_query"}))
    has_final_validation = bool(
        latest_result
        and _is_result_currently_validated(deps, latest_result)
        and any(
            item.get("kind") == "validation" and str(item.get("result_name") or "") == latest_result
            for item in deps.tool_history
        )
    )
    if has_current_read and has_final_validation:
        return None
    return (
        "项目依据中的数字和结论都是 historical，只能作为调查假设；"
        "请重新查询当前项目数据，并对本次最终结果调用 validate_result。"
    )


async def _validate_report(
    ctx: RunContext[AnalystSession], report: AnalysisReport
) -> AnalysisReport:
    if report.status == "waiting_confirmation":
        golden_contract = find_matching_contract(
            ctx.deps.project.golden_scenarios,
            ctx.deps.current_query,
        )
        has_execution_evidence = any(
            item.get("kind")
            in {
                "business_rule_application",
                "join",
                "relationship_application",
                "relationship_validation",
            }
            for item in ctx.deps.tool_history
        )
        if golden_contract is not None and has_execution_evidence:
            raise ModelRetry(
                "该任务已有用户确认过的分析基线，且本次已经取得执行证据；"
                "不能把内部校验失败改写成新的业务确认。请继续修复查询、关联或汇总并提交报告"
            )
        if report.confirmation is None:
            raise ModelRetry("需要确认时必须提供一个业务语言的确认问题")
        confirmation = report.confirmation
        confirmation.key = confirmation.key.strip()
        confirmation.question = confirmation.question.strip()
        confirmation.reason = confirmation.reason.strip()
        confirmation.options = [option.strip() for option in confirmation.options]
        if not confirmation.key or not confirmation.question or not confirmation.reason:
            raise ModelRetry("确认问题的 key、问题和影响说明都不能为空")
        if any(not option for option in confirmation.options):
            raise ModelRetry("确认选项不能为空")
        if len(set(confirmation.options)) != len(confirmation.options):
            raise ModelRetry("确认选项必须互斥且不能重复")
        confirmation.key = canonicalize_decision_key(
            confirmation.key,
            question=confirmation.question,
            reason=confirmation.reason,
            options=confirmation.options,
        )
        evidence_kinds = {str(item.get("kind") or "") for item in ctx.deps.tool_history}
        structured_source_kinds = {
            str(item.get("source_kind") or "")
            for item in ctx.deps.tool_history
            if item.get("kind") == "structured_query"
        }
        technical_confirmation = " ".join(
            [confirmation.key, confirmation.question, confirmation.reason]
        ).casefold()
        technical_tokens = (
            "字段",
            "关联键",
            "标准化",
            "正规化",
            "格式",
            "schema",
            "column",
            "主键",
            "id ",
        )
        has_relationship_hypothesis = bool(
            ctx.deps.project.executable_relationships
            or any(item.get("definition") for item in ctx.deps.project.candidate_relationships)
        )
        if (
            ("file_sql" in evidence_kinds or "file" in structured_source_kinds)
            and ("sql" in evidence_kinds or "connection" in structured_source_kinds)
            and has_relationship_hypothesis
            and any(token in technical_confirmation for token in technical_tokens)
        ):
            raise ModelRetry(
                "字段格式和关联键属于系统应自行验证的技术问题，不能询问用户。"
                "请使用系统的关系验收能力继续调查；"
                "候选关系及 ID 格式差异会在后台处理"
            )
        known_keys = {
            canonicalize_decision_key(str(item.get("key") or ""))
            for item in ctx.deps.project.confirmed_knowledge
            if str(item.get("key") or "")
        }
        if confirmation.key in known_keys:
            raise ModelRetry("该口径已经确认，请直接复用已有知识继续分析")
        if report.action is not None and report.action.kind != "confirm":
            raise ModelRetry("等待业务确认时只能提供确认动作")
        report.action = ReportAction(
            kind="confirm",
            label=t("analysis.confirmation_action", ctx.deps.language),
            reason=confirmation.reason,
            confirmation_key=confirmation.key,
            options=confirmation.options,
        )
        report.next_actions = []
        report.follow_ups = []
        return report

    if report.status == "needs_data":
        if report.confirmation is not None:
            raise ModelRetry("缺少数据和业务口径确认是两种不同动作，不能混在一起")
        if report.action is None or report.action.kind != "add_data":
            raise ModelRetry("需要数据时必须提供 add_data 动作")
        if not report.action.requested_data:
            raise ModelRetry("请用业务语言列出完成任务最少需要的资料")
        if report.metrics or report.visualization:
            raise ModelRetry("没有相关数据时不能生成指标或图表")
        report.next_actions = []
        report.follow_ups = []
        return report

    if report.confirmation is not None:
        raise ModelRetry("已完成的报告不能同时要求用户确认")
    if report.action is not None:
        raise ModelRetry("已完成的报告不应再要求用户执行阻塞动作")

    required_relationships = ctx.deps.project.required_relationship_validations
    if required_relationships:
        matched_relationships, missing_relationships = required_relationship_validation_status(
            required_relationships,
            ctx.deps.tool_history,
        )
        if missing_relationships:
            labels = "、".join(
                str(item.get("relationship_key") or item.get("semantic_entry_id") or "")
                for item in missing_relationships[:8]
            )
            raise ModelRetry(
                "批量关系验证尚未逐条完成："
                f"当前只有 {len(matched_relationships)}/{len(required_relationships)} "
                f"条取得与所选版本匹配的完整数据证据；请继续验证 {labels}"
            )

    if report.next_actions:
        unique_actions: list[ReportNextAction] = []
        seen_prompts: set[str] = set()
        kept_recommendation = False
        for action in report.next_actions:
            prompt = action.prompt.strip()
            marker = re.sub(r"\s+", "", prompt).casefold()
            if not marker or marker in seen_prompts:
                continue
            seen_prompts.add(marker)
            if action.recommended and not kept_recommendation:
                kept_recommendation = True
            else:
                action.recommended = False
            unique_actions.append(action)
        report.next_actions = unique_actions
        report.follow_ups = [item.prompt.strip() for item in unique_actions]
    elif report.follow_ups:
        report.follow_ups = list(
            dict.fromkeys(item.strip() for item in report.follow_ups if item.strip())
        )

    queryable_sources = any(
        source.get("kind") == "connection" or source.get("working_uri") or source.get("source_uri")
        for source in ctx.deps.project.sources
    )
    evidence_kinds = {item.get("kind") for item in ctx.deps.tool_history}
    pending_confirmation = ctx.deps.pending_confirmation or {}
    pending_key = _canonical_confirmation_key(pending_confirmation)
    pending_definition = next(
        (
            item
            for item in ctx.deps.project.confirmed_knowledge
            if canonicalize_decision_key(str(item.get("key") or "")) == pending_key
            and item.get("definition")
        ),
        None,
    )
    if queryable_sources and ctx.deps.user_confirmation and pending_definition:
        applied_rule_keys = {
            canonicalize_decision_key(str(item.get("rule_key") or ""))
            for item in ctx.deps.tool_history
            if item.get("kind") == "business_rule_application"
        }
        if pending_key not in applied_rule_keys:
            raise ModelRetry(
                "这项业务口径已经确认，请调用 apply_confirmed_rule 实际应用并保留执行证据"
            )
    if ctx.deps.protected_results:
        if len(ctx.deps.protected_results) != 1:
            raise ModelRetry("系统执行产生了多个受保护结果，不能混用")
        latest_result = next(iter(ctx.deps.protected_results))
        try:
            _protected_result_profile(
                ctx.deps,
                latest_result,
                ctx.deps.protected_results[latest_result],
            )
        except ValueError as exc:
            raise ModelRetry("系统执行结果与校验回执不一致，不能生成完成报告") from exc
    else:
        latest_result = _primary_report_result(ctx.deps, report)
    report.primary_result = str(latest_result) if latest_result else None
    report.visualization = _bind_structured_visualization(
        ctx.deps,
        report,
        str(latest_result) if latest_result else None,
    )
    makes_quantitative_claim = bool(report.metrics or report.visualization)
    trusted_reference_failure = _trusted_reference_revalidation_failure(
        ctx.deps,
        report,
        latest_result=str(latest_result) if latest_result else None,
    )
    if trusted_reference_failure:
        raise ModelRetry(trusted_reference_failure)
    latest_metadata = (
        ctx.deps.result_metadata.get(str(latest_result)) or {} if latest_result else {}
    )
    if latest_result and latest_metadata.get("truncated"):
        if not _allows_honest_partial_report(ctx.deps.current_query, report):
            raise ModelRetry(
                "最终结果来自被截断的数据，请先在来源查询中完成汇总；"
                "只有明确的有限样本或数据质量概览才能提交样本范围内的报告"
            )
        if not _is_result_currently_validated(ctx.deps, str(latest_result)):
            raise ModelRetry("提交有限样本报告前，请先调用 validate_result 核对最终样本")
        _mark_report_as_partial_sample(report, latest_metadata)
    report_claim_text = " ".join(
        [
            ctx.deps.current_query,
            report.title,
            report.summary,
            *report.findings,
            *(metric.label for metric in report.metrics),
            *(metric.context or "" for metric in report.metrics),
        ]
    ).casefold()
    metric_applications = [
        item
        for item in ctx.deps.tool_history
        if item.get("kind") == "business_rule_application"
        and item.get("action_kind") in {"metric_column", "metric_formula"}
        and item.get("column")
    ]
    missing_metric_columns: list[str] = []
    if latest_result:
        latest_rows = ctx.deps.dataframes.get(str(latest_result)) or []
        latest_columns = {str(key) for row in latest_rows for key in row}
        latest_metadata = ctx.deps.result_metadata.get(str(latest_result)) or {}
        for application in metric_applications:
            column = str(application.get("column") or "")
            definition_hash = str(application.get("definition_hash") or "")
            final_metric_state = prove_metric_application_lineage(
                ctx.deps.tool_history,
                application,
                final_result=str(latest_result),
                final_columns=latest_columns,
            )
            consumed = bool(final_metric_state) and (
                bool(latest_metadata.get("metric_policy_satisfied"))
                and str(latest_metadata.get("metric_output_column") or "")
                == str((final_metric_state or {}).get("metric_output_column") or "")
                and str(latest_metadata.get("required_metric_definition_hash") or "")
                == definition_hash
            )
            if not consumed:
                missing_metric_columns.append(column)
    if missing_metric_columns:
        metric_label = (
            "收入结论"
            if any(token in report_claim_text for token in ("收入", "营收", "销售额", "revenue"))
            else "指标结论"
        )
        raise ModelRetry(
            f"{metric_label}必须在最终结果链路中实际汇总当前已确认字段："
            + "、".join(sorted(set(missing_metric_columns)))
        )
    if queryable_sources and latest_result and not report.evidence:
        report.evidence = _business_evidence_from_tools(
            ctx.deps.tool_history,
            latest_result=str(latest_result),
        )
    if queryable_sources and makes_quantitative_claim:
        if not evidence_kinds.intersection(
            {"structured_query", "sql", "file_sql", "join", "aggregate", "python"}
        ):
            raise ModelRetry("数字和图表必须来自实际查询或 Python 分析")
        if "validation" not in evidence_kinds:
            raise ModelRetry("引用数字或生成图表前，请先调用 validate_result 核对结果")
        if not report.evidence:
            raise ModelRetry("报告需要用业务语言说明结论依据")
        if latest_result and not _is_result_currently_validated(ctx.deps, str(latest_result)):
            raise ModelRetry("请对最终用于结论的结果调用 validate_result，而不是只验证中间表")

    required_correction = ctx.deps.project.required_correction
    try:
        correction_receipt = build_correction_application_receipt(
            required_correction,
            ctx.deps.tool_history,
            final_result=str(latest_result) if latest_result else None,
        )
    except CorrectionCompletionError as exc:
        raise ModelRetry(f"这次修正还没有作用到最终结论：{exc}") from exc
    if correction_receipt is not None:
        ctx.deps.tool_history = [
            item
            for item in ctx.deps.tool_history
            if not (
                item.get("kind") == "correction_application"
                and item.get("correction_id") == correction_receipt.get("correction_id")
            )
        ]
        ctx.deps.tool_history.append(correction_receipt)

    for item in ctx.deps.tool_history:
        if item.get("kind") != "join" or not item.get("relationship_key"):
            continue
        relationship = _current_runtime_relationship(
            ctx.deps.project,
            str(item["relationship_key"]),
        )
        if relationship is None or item.get("definition_hash") != relationship.get(
            "definition_hash"
        ):
            raise ModelRetry("本次关联没有使用当前有效的确认关系定义，请重新执行")

    golden_contract = find_matching_contract(
        ctx.deps.project.golden_scenarios,
        ctx.deps.current_query,
    )
    if golden_contract is not None:
        final_rows = ctx.deps.dataframes.get(str(latest_result), []) if latest_result else []
        regression_failures = evaluate_golden_contract(
            golden_contract,
            confirmed_knowledge=ctx.deps.project.confirmed_knowledge,
            sources=ctx.deps.project.sources,
            tool_history=ctx.deps.tool_history,
            result_rows=final_rows,
        )
        if regression_failures:
            raise ModelRetry(
                "这次结果没有通过项目中已确认的检查："
                + "；".join(regression_failures[:4])
                + "。请修正查询、关联或最终汇总后再提交报告。"
            )
        regression_evidence = {
            "kind": "golden_regression_validation",
            "status": "passed",
            "contract_id": golden_contract.get("id"),
            "query_key": golden_contract.get("query_key"),
            "result_name": latest_result,
            "required_rule_count": len(golden_contract.get("required_rule_applications") or []),
            "required_relationship_count": len(golden_contract.get("relationships") or []),
        }
        if not any(
            item.get("kind") == "golden_regression_validation"
            and item.get("contract_id") == regression_evidence["contract_id"]
            and item.get("result_name") == latest_result
            for item in ctx.deps.tool_history
        ):
            ctx.deps.tool_history.append(regression_evidence)
    return report


async def validate_report(
    ctx: RunContext[AnalystSession], report: AnalysisReport
) -> AnalysisReport:
    try:
        return await _validate_report(ctx, report)
    except ModelRetry as exc:
        logger.warning(
            "Analysis report rejected for self-repair",
            reason=ctx.deps.diagnostic_error(exc),
            report_status=report.status,
            tool_kinds=[str(item.get("kind") or "") for item in ctx.deps.tool_history[-20:]],
        )
        raise
