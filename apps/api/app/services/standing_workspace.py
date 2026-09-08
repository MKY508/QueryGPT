"""Persistent workspace helpers for project-level standing analyses.

The API and execution layers both use this module.  It deliberately has no dependency on
FastAPI routers so a completed analysis can be finalized without creating an API import cycle.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    AnalysisRun,
    ArtifactRecord,
    Project,
    ProjectDataSource,
    SanitationRecipeRecord,
    SemanticEntry,
)
from app.models.workspace import (
    AnalysisPlaybookResponse,
    AnalysisPlaybookStructuredQueryPlan,
    RelationshipDefinition,
    StandingAnalysisResponse,
    StandingAttentionReasonCode,
    StandingBaselineRef,
    ValidatedResultSnapshot,
)
from app.services.checkpoint_contract import stable_payload_hash
from app.services.metric_lineage import prove_metric_application_lineage
from app.services.standing_analysis import canonical_input_token

MAX_STANDING_ANALYSES = 20


class StandingWorkspaceError(ValueError):
    """A user-correctable standing-analysis workspace contract failure."""


class StandingWorkspaceCorruptError(RuntimeError):
    """Stored project state cannot be parsed safely."""


@dataclass(frozen=True, slots=True)
class StandingInputState:
    token: str | None
    attention_reason: str | None
    attention_reason_code: StandingAttentionReasonCode | None = None
    attention_reason_params: dict[str, str] | None = None


@dataclass(frozen=True, slots=True)
class CompleteResultArtifact:
    artifact: ArtifactRecord
    rows: list[dict[str, Any]]
    columns: list[str]
    key_columns: list[str]
    numeric_columns: list[str]


def _attention(
    reason: str,
    code: StandingAttentionReasonCode,
    **params: str,
) -> StandingInputState:
    return StandingInputState(
        token=None,
        attention_reason=reason,
        attention_reason_code=code,
        attention_reason_params=params,
    )


def canonical_hash(value: Any) -> str:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
            default=str,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise StandingWorkspaceError("持续分析输入包含不可序列化的内容") from exc
    return hashlib.sha256(encoded).hexdigest()


def standing_analysis_id(project_id: UUID, playbook_id: str) -> str:
    digest = hashlib.sha256(f"{project_id}:{playbook_id}".encode()).hexdigest()
    return f"standing_{digest[:20]}"


def load_standing_analyses(project: Project) -> list[StandingAnalysisResponse]:
    raw_items = (project.extra_data or {}).get("standing_analyses") or []
    if not isinstance(raw_items, list) or len(raw_items) > MAX_STANDING_ANALYSES:
        raise StandingWorkspaceCorruptError("项目中的持续分析定义已损坏")
    try:
        return [StandingAnalysisResponse.model_validate(item) for item in raw_items]
    except (ValidationError, TypeError, ValueError) as exc:
        raise StandingWorkspaceCorruptError("项目中的持续分析定义已损坏") from exc


def save_standing_analyses(
    project: Project,
    definitions: list[StandingAnalysisResponse],
) -> None:
    if len(definitions) > MAX_STANDING_ANALYSES:
        raise StandingWorkspaceError(f"每个项目最多保存 {MAX_STANDING_ANALYSES} 个持续分析")
    # Validate before mutating the JSON column.  This also makes accidental raw snapshot rows in
    # the definition impossible: the public model forbids every undeclared field.
    validated = [StandingAnalysisResponse.model_validate(item) for item in definitions]
    project.extra_data = {
        **(project.extra_data or {}),
        "standing_analyses": [item.model_dump(mode="json") for item in validated],
    }


def load_analysis_playbooks(project: Project) -> list[AnalysisPlaybookResponse]:
    raw_items = (project.extra_data or {}).get("analysis_playbooks") or []
    if not isinstance(raw_items, list):
        raise StandingWorkspaceCorruptError("项目中的可复用分析记录已损坏")
    try:
        return [AnalysisPlaybookResponse.model_validate(item) for item in raw_items]
    except (ValidationError, TypeError, ValueError) as exc:
        raise StandingWorkspaceCorruptError("项目中的可复用分析记录已损坏") from exc


def _logical_name(source: ProjectDataSource) -> str:
    return str((source.profile_data or {}).get("logical_name") or source.name).strip()


def _profile_schema_signature(profile: dict[str, Any]) -> str:
    columns: list[dict[str, str]] = []
    for column in (profile.get("schema") or {}).get("columns") or []:
        columns.append(
            {
                "name": str(column.get("name") or ""),
                "type": str(column.get("type") or column.get("dtype") or "unknown"),
            }
        )
    for table in profile.get("tables") or []:
        for column in table.get("columns") or []:
            columns.append(
                {
                    "name": str(column.get("name") or ""),
                    "type": str(column.get("type") or column.get("dtype") or "unknown"),
                }
            )
    return canonical_hash(sorted(columns, key=lambda item: (item["name"], item["type"])))


def _semantic_version(entry: SemanticEntry) -> str:
    return canonical_hash(
        {
            "state": entry.state,
            "validity": entry.validity,
            "value": entry.value,
            "definition": entry.definition,
        }
    )


def _relationship_definition_hash(definition: dict[str, Any] | None) -> str:
    parsed = RelationshipDefinition.model_validate(definition)
    return canonical_hash(parsed.model_dump(mode="json"))


def _after_analysis(value: datetime, run: AnalysisRun) -> bool:
    run_updated_at = run.updated_at
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    if run_updated_at.tzinfo is None:
        run_updated_at = run_updated_at.replace(tzinfo=UTC)
    return value > run_updated_at


async def evaluate_standing_input(
    db: AsyncSession,
    *,
    project: Project,
    standing_id: str,
    playbook_id: str,
    expected_playbook_shape_hash: str,
    baseline_run: AnalysisRun | None = None,
) -> StandingInputState:
    """Bind the current safe project state or return a stable attention reason."""

    playbooks = load_analysis_playbooks(project)
    matching_playbooks = [item for item in playbooks if item.id == playbook_id]
    if len(matching_playbooks) != 1:
        return _attention(
            "对应的可复用分析不存在或不唯一，请重新保存分析方法",
            "standing_playbook_unavailable",
        )
    playbook = matching_playbooks[0]
    if playbook.shape_hash != expected_playbook_shape_hash:
        return _attention(
            "可复用分析的方法结构已变化，需要重新建立持续分析",
            "standing_playbook_changed",
        )
    if not playbook.source_roles:
        return _attention(
            "可复用分析没有绑定数据来源",
            "standing_playbook_sources_unbound",
        )

    source_result = await db.execute(
        select(ProjectDataSource).where(
            ProjectDataSource.project_id == project.id,
            ProjectDataSource.status != "superseded",
        )
    )
    stored_sources = list(source_result.scalars())
    source_versions: dict[str, str] = {}
    recipe_versions: dict[str, str] = {}
    for role in playbook.source_roles:
        role_sources = [
            source
            for source in stored_sources
            if source.kind == role.source_kind and _logical_name(source) == role.logical_name
        ]
        pending = [
            source
            for source in role_sources
            if (source.profile_data or {}).get("is_current") is False
            or (source.profile_data or {}).get("activation_state") == "pending_confirmation"
            or bool((source.profile_data or {}).get("replacement_of"))
        ]
        if pending:
            return _attention(
                f"{role.logical_name} 有待核对的新数据版本，确认前不会自动继续",
                "standing_source_pending_confirmation",
                source=role.logical_name,
            )
        active = [
            source
            for source in role_sources
            if (source.profile_data or {}).get("is_current") is not False
        ]
        if len(active) != 1:
            return _attention(
                f"找不到唯一的当前数据来源：{role.logical_name}",
                "standing_source_not_unique",
                source=role.logical_name,
            )
        source = active[0]
        if baseline_run is not None and _after_analysis(source.updated_at, baseline_run):
            return _attention(
                f"数据来源 {role.logical_name} 在这次调查完成后已经变化，请先重新运行分析",
                "standing_source_changed_since_baseline",
                source=role.logical_name,
            )
        profile = dict(source.profile_data or {})
        if source.status != "ready":
            return _attention(
                f"数据来源 {role.logical_name} 尚未准备好",
                "standing_source_not_ready",
                source=role.logical_name,
            )
        if source.kind == "file" and not source.working_uri:
            return _attention(
                f"数据来源 {role.logical_name} 缺少可分析工作副本",
                "standing_source_working_copy_missing",
                source=role.logical_name,
            )
        schema_signature = _profile_schema_signature(profile)
        if schema_signature != role.schema_signature:
            return _attention(
                f"数据来源 {role.logical_name} 的字段结构已经变化",
                "standing_source_schema_changed",
                source=role.logical_name,
            )
        try:
            profile_version = int(profile.get("version") or 1)
        except (TypeError, ValueError):
            return _attention(
                f"数据来源 {role.logical_name} 的版本标识无效",
                "standing_source_version_invalid",
                source=role.logical_name,
            )
        source_versions[role.logical_name] = canonical_hash(
            {
                "source_id": str(source.id),
                "fingerprint": source.fingerprint or "",
                "profile_version": profile_version,
                "schema_signature": schema_signature,
            }
        )

        recipe_result = await db.execute(
            select(SanitationRecipeRecord)
            .where(SanitationRecipeRecord.data_source_id == source.id)
            .order_by(SanitationRecipeRecord.created_at.desc())
        )
        recipe = recipe_result.scalars().first()
        if (
            baseline_run is not None
            and recipe is not None
            and _after_analysis(recipe.updated_at, baseline_run)
        ):
            return _attention(
                f"数据来源 {role.logical_name} 的整理方法在调查完成后已经变化，请先重新运行分析",
                "standing_source_recipe_changed_since_baseline",
                source=role.logical_name,
            )
        recipe_versions[role.logical_name] = canonical_hash(
            {
                "output_fingerprint": recipe.output_fingerprint if recipe else None,
                "operations": recipe.operations if recipe else [],
            }
        )

    required_keys = set(playbook.confirmed_knowledge_keys) | set(playbook.relationship_keys)
    knowledge_result = await db.execute(
        select(SemanticEntry).where(
            SemanticEntry.project_id == project.id,
            SemanticEntry.key.in_(required_keys) if required_keys else False,
        )
    )
    knowledge_by_key = {item.key: item for item in knowledge_result.scalars()}
    semantic_versions: dict[str, str] = {}
    relationship_hashes = {
        str(step.relationship_key): str(step.definition_hash)
        for step in playbook.steps
        if getattr(step, "relationship_key", None) and getattr(step, "definition_hash", None)
    }
    for key in sorted(required_keys):
        entry = knowledge_by_key.get(key)
        if entry is None or entry.state not in {"confirmed", "locked"}:
            return _attention(
                f"持续分析依赖的业务定义已缺失：{key}",
                "standing_semantic_definition_missing",
                key=key,
            )
        if entry.validity != "active":
            return _attention(
                f"持续分析依赖的业务定义已失效：{key}",
                "standing_semantic_definition_inactive",
                key=key,
            )
        if baseline_run is not None and _after_analysis(entry.updated_at, baseline_run):
            return _attention(
                f"业务定义 {key} 在这次调查完成后已经变化，请先重新运行分析",
                "standing_semantic_definition_changed_since_baseline",
                key=key,
            )
        if key in playbook.relationship_keys:
            if entry.entry_type != "relationship" or not isinstance(entry.definition, dict):
                return _attention(
                    f"持续分析依赖的关联定义不可用：{key}",
                    "standing_relationship_definition_unavailable",
                    key=key,
                )
            expected_hash = relationship_hashes.get(key)
            try:
                current_hash = _relationship_definition_hash(entry.definition)
            except ValidationError:
                return _attention(
                    f"持续分析依赖的关联定义不可用：{key}",
                    "standing_relationship_definition_unavailable",
                    key=key,
                )
            if expected_hash and current_hash != expected_hash:
                return _attention(
                    f"持续分析依赖的关联定义已经变化：{key}",
                    "standing_relationship_definition_changed",
                    key=key,
                )
        semantic_versions[key] = _semantic_version(entry)

    token = canonical_input_token(
        standing_analysis_id=standing_id,
        playbook_id=playbook.id,
        playbook_shape_hash=playbook.shape_hash,
        source_fingerprints=source_versions,
        semantic_versions=semantic_versions,
        recipe_fingerprints=recipe_versions,
    )
    return StandingInputState(token, None)


def _tool_result_dependencies(step: dict[str, Any]) -> list[str]:
    dependencies = [
        str(step.get(key) or "").strip()
        for key in ("source_result", "left_result", "right_result")
        if str(step.get(key) or "").strip()
    ]
    dependencies.extend(
        str(value).strip() for value in step.get("input_results") or [] if str(value).strip()
    )
    return dependencies


def _tool_result_is_ancestor(
    tool_history: list[dict[str, Any]], *, ancestor: str, descendant: str
) -> bool:
    if not ancestor or not descendant:
        return False
    if ancestor == descendant:
        return True
    producers = {
        str(step.get("result_name")): step
        for step in tool_history
        if step.get("result_name") and _tool_result_dependencies(step)
    }
    pending = [descendant]
    visited: set[str] = set()
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        for dependency in _tool_result_dependencies(producers.get(current) or {}):
            if dependency == ancestor:
                return True
            pending.append(dependency)
    return False


def _portable_structured_query_plan(
    evidence: dict[str, Any],
) -> AnalysisPlaybookStructuredQueryPlan | None:
    raw_plan = evidence.get("query_plan")
    if not isinstance(raw_plan, dict):
        return None
    try:
        return AnalysisPlaybookStructuredQueryPlan.model_validate(
            {
                "table": raw_plan.get("table") or raw_plan.get("table_or_view"),
                "dimensions": raw_plan.get("dimensions") or [],
                "metrics": raw_plan.get("metrics") or [],
                "filters": raw_plan.get("filters") or [],
                "sort": raw_plan.get("sort") or [],
                "limit": raw_plan.get("limit", 1000),
            }
        )
    except ValidationError:
        return None


def _v3_evidence_source_roles(
    evidence: dict[str, Any],
    *,
    playbook: AnalysisPlaybookResponse,
    final_source_refs: list[dict[str, Any]],
) -> set[tuple[str, str]]:
    """Resolve the logical roles a read/query receipt actually used."""

    refs = [item for item in evidence.get("source_refs") or [] if isinstance(item, dict)]
    source_id = str(evidence.get("source_id") or "")
    if source_id:
        refs.extend(
            item for item in final_source_refs if str(item.get("source_id") or "") == source_id
        )
    resolved = {
        (
            str(item.get("source_logical_name") or ""),
            str(item.get("source_kind") or ""),
        )
        for item in refs
        if item.get("source_logical_name") and item.get("source_kind")
    }
    if resolved:
        return resolved

    # Legacy free-form file SQL receipts do not carry source_refs. Capture used the
    # same logical/table names to bind the read step, so retain that compatibility
    # without accepting a role that is absent from the SQL text.
    sql = str(evidence.get("sql") or evidence.get("compiled_sql") or "").casefold()
    if not sql:
        return set()
    for role in playbook.source_roles:
        names = {role.logical_name.casefold(), *(item.casefold() for item in role.tables)}
        if any(name and name in sql for name in names):
            resolved.add((role.logical_name, role.source_kind))
    return resolved


def _validate_v3_agent_alias_dag(
    playbook: AnalysisPlaybookResponse,
    tool_history: list[dict[str, Any]],
    validation: dict[str, Any],
) -> None:
    """Bind every v3 playbook alias to one current runtime result and its lineage."""

    final_result = str(validation.get("result_name") or "")
    profile = dict(validation.get("profile") or {})
    final_source_refs = [
        item for item in profile.get("source_refs") or [] if isinstance(item, dict)
    ]
    roles = {role.logical_name: role for role in playbook.source_roles}
    aliases: dict[str, str] = {}
    used_evidence: set[int] = set()

    def bound_inputs(step: Any) -> list[str]:
        values: list[str] = []
        for alias in step.input_results:
            actual = aliases.get(str(alias))
            if not actual:
                raise StandingWorkspaceError(f"持续分析步骤缺少已绑定的输入结果：{step.summary}")
            values.append(actual)
        return values

    def select_evidence(
        step: Any,
        predicate: Any,
        *,
        produces_result: bool,
    ) -> dict[str, Any]:
        candidates: list[tuple[int, dict[str, Any]]] = []
        for index, item in enumerate(tool_history):
            if index in used_evidence or not predicate(item):
                continue
            result_name = str(item.get("result_name") or "")
            if produces_result and not _tool_result_is_ancestor(
                tool_history,
                ancestor=result_name,
                descendant=final_result,
            ):
                continue
            candidates.append((index, item))
        if len(candidates) != 1:
            raise StandingWorkspaceError(f"本次调查没有重新执行持续分析步骤：{step.summary}")
        index, evidence = candidates[0]
        used_evidence.add(index)
        if produces_result:
            output_alias = str(step.output_result or "")
            result_name = str(evidence.get("result_name") or "")
            if not output_alias or not result_name:
                raise StandingWorkspaceError(f"持续分析步骤缺少输出结果绑定：{step.summary}")
            aliases[output_alias] = result_name
        return evidence

    for step in sorted(playbook.steps, key=lambda item: item.order):
        if step.kind == "structured_query":
            role = roles.get(step.source_role)

            def matches_structured_query(item: dict[str, Any]) -> bool:
                source_roles = _v3_evidence_source_roles(
                    item,
                    playbook=playbook,
                    final_source_refs=final_source_refs,
                )
                return bool(
                    role is not None
                    and item.get("kind") == "structured_query"
                    and item.get("truncated") is False
                    and item.get("result_completeness") == "complete"
                    and _portable_structured_query_plan(item) == step.plan
                    and (step.source_role, role.source_kind) in source_roles
                )

            select_evidence(step, matches_structured_query, produces_result=True)
            continue

        if step.kind == "read_data":
            expected_roles = {
                (logical_name, roles[logical_name].source_kind)
                for logical_name in step.source_roles
                if logical_name in roles
            }

            def matches_read(item: dict[str, Any]) -> bool:
                actual_roles = _v3_evidence_source_roles(
                    item,
                    playbook=playbook,
                    final_source_refs=final_source_refs,
                )
                return bool(
                    item.get("kind") in {"structured_query", "sql", "file_sql"}
                    and item.get("truncated") is not True
                    and actual_roles == expected_roles
                )

            select_evidence(step, matches_read, produces_result=True)
            continue

        inputs = bound_inputs(step)
        if step.kind == "apply_rule":

            def matches_rule(item: dict[str, Any]) -> bool:
                return bool(
                    item.get("kind") == "business_rule_application"
                    and str(item.get("source_result") or "") == inputs[0]
                    and str(item.get("rule_key") or "") == step.rule_key
                    and str(item.get("action_kind") or "") == step.action_kind
                    and str(item.get("column") or "") == step.column
                    and (str(item.get("operator") or "") or None) == step.operator
                    and ([str(value) for value in item.get("values") or []] or None) == step.values
                    and (
                        not step.definition_hash
                        or str(item.get("definition_hash") or "") == step.definition_hash
                    )
                )

            evidence = select_evidence(step, matches_rule, produces_result=True)
            if step.action_kind in {"metric_column", "metric_formula"} and (
                prove_metric_application_lineage(
                    tool_history,
                    evidence,
                    final_result=final_result,
                    final_columns=set(str(item) for item in profile.get("columns") or []),
                )
                is None
            ):
                raise StandingWorkspaceError(f"本次调查没有重新执行持续分析步骤：{step.summary}")
            continue

        if step.kind == "validate_relationship":

            def matches_relationship(item: dict[str, Any]) -> bool:
                item_profile = item.get("profile") or {}
                return bool(
                    item.get("kind") in {"relationship_validation", "relationship_application"}
                    and str(item.get("left_result") or "") == inputs[0]
                    and str(item.get("right_result") or "") == inputs[1]
                    and (
                        not step.relationship_key
                        or str(item.get("relationship_key") or "") == step.relationship_key
                    )
                    and (
                        not step.definition_hash
                        or str(item.get("definition_hash") or "") == step.definition_hash
                    )
                    and (
                        not step.left_key
                        or str(item.get("left_key") or item_profile.get("left_key") or "")
                        == step.left_key
                    )
                    and (
                        not step.right_key
                        or str(item.get("right_key") or item_profile.get("right_key") or "")
                        == step.right_key
                    )
                    and str(item.get("normalization") or item_profile.get("normalization") or "")
                    == step.normalization
                )

            select_evidence(step, matches_relationship, produces_result=False)
            continue

        if step.kind == "join":

            def matches_join(item: dict[str, Any]) -> bool:
                item_profile = item.get("profile") or {}
                return bool(
                    item.get("kind") == "join"
                    and str(item.get("left_result") or "") == inputs[0]
                    and str(item.get("right_result") or "") == inputs[1]
                    and str(item.get("how") or "") == step.join_mode
                    and (
                        not step.relationship_key
                        or str(item.get("relationship_key") or "") == step.relationship_key
                    )
                    and (
                        not step.definition_hash
                        or str(item.get("definition_hash") or "") == step.definition_hash
                    )
                    and (
                        not step.left_key
                        or str(item.get("left_key") or item_profile.get("left_key") or "")
                        == step.left_key
                    )
                    and (
                        not step.right_key
                        or str(item.get("right_key") or item_profile.get("right_key") or "")
                        == step.right_key
                    )
                    and str(item.get("normalization") or item_profile.get("normalization") or "")
                    == step.normalization
                )

            select_evidence(step, matches_join, produces_result=True)
            continue

        if step.kind == "aggregate":

            def matches_aggregate(item: dict[str, Any]) -> bool:
                return bool(
                    item.get("kind") == "aggregate"
                    and str(item.get("source_result") or "") == inputs[0]
                    and str(item.get("operation") or "") == step.operation
                    and [str(value) for value in item.get("group_by") or []] == step.group_by
                    and (str(item.get("value_column") or "") or None) == step.value_column
                    and str(item.get("output_column") or "") == step.output_column
                )

            select_evidence(step, matches_aggregate, produces_result=True)
            continue

        if step.kind == "analyze":
            select_evidence(
                step,
                lambda item: (
                    item.get("kind") == "python"
                    and not item.get("generated")
                    and [str(value) for value in item.get("input_results") or []] == inputs
                ),
                produces_result=False,
            )
            continue

        if step.kind == "visualize":
            select_evidence(
                step,
                lambda item: (
                    item.get("kind") == "python"
                    and item.get("generated")
                    and str(item.get("chart_type") or "") == step.chart_type
                    and int(item.get("images") or 0) > 0
                    and str(item.get("result_name") or "") == inputs[0]
                ),
                produces_result=False,
            )
            continue

        if step.kind == "validate_result":
            if inputs != [final_result]:
                raise StandingWorkspaceError(f"本次调查没有重新执行持续分析步骤：{step.summary}")
            continue

        raise StandingWorkspaceError(f"本次调查没有重新执行持续分析步骤：{step.summary}")

    if aliases.get(playbook.validation.input_result) != final_result:
        raise StandingWorkspaceError("最终校验没有绑定持续分析的结果别名链")


def validate_playbook_execution_evidence(
    playbook: AnalysisPlaybookResponse,
    tool_history: list[dict[str, Any]],
    validation: dict[str, Any],
) -> None:
    """Require a Standing run to prove the bound playbook contract on current data."""

    if playbook.schema_version == 3 and playbook.execution_mode == "system_structured_query":
        _validate_system_playbook_execution_evidence(playbook, tool_history, validation)
        return

    profile = dict(validation.get("profile") or {})
    source_refs = [item for item in profile.get("source_refs") or [] if isinstance(item, dict)]
    actual_roles = {
        (
            str(item.get("source_logical_name") or ""),
            str(item.get("source_kind") or ""),
        )
        for item in source_refs
    }
    missing_roles = [
        role.logical_name
        for role in playbook.source_roles
        if (role.logical_name, role.source_kind) not in actual_roles
    ]
    if missing_roles:
        raise StandingWorkspaceError(
            "最终结果没有证明使用了持续分析绑定的数据来源：" + "、".join(missing_roles)
        )

    columns = [str(item) for item in profile.get("columns") or []]
    keys = [str(item) for item in (profile.get("keys") or {})]
    numeric = [str(item) for item in (profile.get("numeric") or {})]
    if (
        columns != playbook.validation.columns
        or keys != playbook.validation.key_columns
        or numeric != playbook.validation.numeric_columns
    ):
        raise StandingWorkspaceError("最终校验没有遵守持续分析绑定的结果结构")

    final_result = str(validation.get("result_name") or "")
    final_columns = set(columns)

    if playbook.schema_version == 3:
        _validate_v3_agent_alias_dag(playbook, tool_history, validation)
        return

    for step in playbook.steps:
        if step.kind in {"read_data", "validate_result"}:
            continue
        if step.kind == "structured_query":
            role = next(
                (item for item in playbook.source_roles if item.logical_name == step.source_role),
                None,
            )
            matching_queries: list[dict[str, Any]] = []
            for item in tool_history:
                if item.get("kind") != "structured_query" or item.get("truncated") is not False:
                    continue
                raw_plan = item.get("query_plan")
                if not isinstance(raw_plan, dict):
                    continue
                try:
                    current_plan = AnalysisPlaybookStructuredQueryPlan.model_validate(
                        {
                            "table": raw_plan.get("table") or raw_plan.get("table_or_view"),
                            "dimensions": raw_plan.get("dimensions") or [],
                            "metrics": raw_plan.get("metrics") or [],
                            "filters": raw_plan.get("filters") or [],
                            "sort": raw_plan.get("sort") or [],
                            "limit": raw_plan.get("limit", 1000),
                        }
                    )
                except ValidationError:
                    continue
                refs = [ref for ref in item.get("source_refs") or [] if isinstance(ref, dict)]
                role_bound = role is not None and any(
                    str(ref.get("source_logical_name") or "") == step.source_role
                    and str(ref.get("source_kind") or "") == role.source_kind
                    for ref in refs
                )
                result_name = str(item.get("result_name") or "")
                if (
                    current_plan == step.plan
                    and role_bound
                    and item.get("result_completeness") == "complete"
                    and _tool_result_is_ancestor(
                        tool_history,
                        ancestor=result_name,
                        descendant=final_result,
                    )
                ):
                    matching_queries.append(item)
            matched = len(matching_queries) == 1
        elif step.kind == "apply_rule":
            matching_applications = [
                item
                for item in tool_history
                if (
                    item.get("kind") == "business_rule_application"
                    and str(item.get("rule_key") or "") == step.rule_key
                    and str(item.get("action_kind") or "") == step.action_kind
                    and str(item.get("column") or "") == step.column
                    and (
                        not step.definition_hash
                        or str(item.get("definition_hash") or "") == step.definition_hash
                    )
                    and _tool_result_is_ancestor(
                        tool_history,
                        ancestor=str(item.get("result_name") or ""),
                        descendant=final_result,
                    )
                )
            ]
            matched = bool(matching_applications)
            if matched and step.action_kind in {"metric_column", "metric_formula"}:
                matched = any(
                    prove_metric_application_lineage(
                        tool_history,
                        application,
                        final_result=final_result,
                        final_columns=final_columns,
                    )
                    is not None
                    for application in matching_applications
                )
        elif step.kind == "validate_relationship":
            matched = any(
                item.get("kind") in {"relationship_validation", "relationship_application"}
                and (
                    not step.relationship_key
                    or str(item.get("relationship_key") or "") == step.relationship_key
                )
                and (
                    not step.definition_hash
                    or str(item.get("definition_hash") or "") == step.definition_hash
                )
                for item in tool_history
            )
        elif step.kind == "join":
            matched = any(
                item.get("kind") == "join"
                and (
                    not step.relationship_key
                    or str(item.get("relationship_key") or "") == step.relationship_key
                )
                and (
                    not step.definition_hash
                    or str(item.get("definition_hash") or "") == step.definition_hash
                )
                and str(item.get("how") or "") == step.join_mode
                for item in tool_history
            )
        elif step.kind == "aggregate":
            matched = any(
                item.get("kind") == "aggregate"
                and str(item.get("operation") or "") == step.operation
                and [str(value) for value in item.get("group_by") or []] == step.group_by
                and (str(item.get("value_column") or "") or None) == step.value_column
                and str(item.get("output_column") or "") == step.output_column
                for item in tool_history
            )
        elif step.kind == "analyze":
            matched = any(
                item.get("kind") == "python" and not item.get("generated") for item in tool_history
            )
        elif step.kind == "visualize":
            matched = any(
                item.get("kind") == "python"
                and item.get("generated")
                and str(item.get("chart_type") or "") == step.chart_type
                and int(item.get("images") or 0) > 0
                and str(item.get("result_name") or "") == str(validation.get("result_name") or "")
                for item in tool_history
            )
        else:  # pragma: no cover - discriminated model keeps this exhaustive
            matched = False
        if not matched:
            raise StandingWorkspaceError(f"本次调查没有重新执行持续分析步骤：{step.summary}")


def validate_playbook_baseline_evidence(
    playbook: AnalysisPlaybookResponse,
    tool_history: list[dict[str, Any]],
    validation: dict[str, Any],
) -> None:
    """Validate the completed analysis used to establish the first baseline.

    A v3 system playbook is captured *from* an ordinary typed-query run, so that
    originating run cannot already contain a receipt bound to the playbook id and
    shape hash that were created afterwards.  The initial baseline may therefore
    use the exact typed query and validation contract from which the playbook was
    captured.  Every later automatic run still goes through
    ``validate_playbook_execution_evidence`` and requires the system receipt.
    """

    if not (playbook.schema_version == 3 and playbook.execution_mode == "system_structured_query"):
        validate_playbook_execution_evidence(playbook, tool_history, validation)
        return

    execution_receipts = [
        item for item in tool_history if item.get("kind") == "analysis_playbook_execution"
    ]
    if execution_receipts:
        validate_playbook_execution_evidence(playbook, tool_history, validation)
        return

    profile = dict(validation.get("profile") or {})
    if profile.get("truncated") is not False:
        raise StandingWorkspaceError("初始结果不是完整结果，不能建立持续分析")

    source_refs = [item for item in profile.get("source_refs") or [] if isinstance(item, dict)]
    actual_roles = {
        (
            str(item.get("source_logical_name") or ""),
            str(item.get("source_kind") or ""),
        )
        for item in source_refs
    }
    missing_roles = [
        role.logical_name
        for role in playbook.source_roles
        if (role.logical_name, role.source_kind) not in actual_roles
    ]
    if missing_roles:
        raise StandingWorkspaceError(
            "初始结果没有证明使用了保存方法绑定的数据来源：" + "、".join(missing_roles)
        )

    columns = [str(item) for item in profile.get("columns") or []]
    keys = [str(item) for item in (profile.get("keys") or {})]
    numeric = [str(item) for item in (profile.get("numeric") or {})]
    if (
        columns != playbook.validation.columns
        or keys != playbook.validation.key_columns
        or numeric != playbook.validation.numeric_columns
    ):
        raise StandingWorkspaceError("初始结果与保存方法的结果结构不一致")

    _validate_v3_agent_alias_dag(playbook, tool_history, validation)


def _validate_system_playbook_execution_evidence(
    playbook: AnalysisPlaybookResponse,
    tool_history: list[dict[str, Any]],
    validation: dict[str, Any],
) -> None:
    """Accept v3 only when the system receipt exactly binds this current result."""

    from app.services.analysis_playbook_runner import AnalysisPlaybookExecutionReceipt

    receipts = [
        item
        for item in tool_history
        if item.get("kind") == "analysis_playbook_execution"
        and item.get("playbook_id") == playbook.id
        and item.get("playbook_shape_hash") == playbook.shape_hash
    ]
    if len(receipts) != 1:
        raise StandingWorkspaceError("本次调查缺少唯一的系统执行回执")
    try:
        receipt = AnalysisPlaybookExecutionReceipt.model_validate(receipts[0])
    except ValidationError as exc:
        raise StandingWorkspaceError("本次调查的系统执行回执无效") from exc

    query_steps = [step for step in playbook.steps if step.kind == "structured_query"]
    if len(query_steps) != 1 or len(playbook.source_roles) != 1:
        raise StandingWorkspaceError("持续分析的系统执行合同已经损坏")
    query_step = query_steps[0]
    role = playbook.source_roles[0]
    if receipt.source_role != role.logical_name or receipt.source_kind != role.source_kind:
        raise StandingWorkspaceError("系统执行回执没有绑定持续分析的数据角色")
    if receipt.source_schema_signature != role.schema_signature:
        raise StandingWorkspaceError("系统执行回执的数据结构与保存的方法不一致")
    if receipt.plan_hash != stable_payload_hash(query_step.plan.model_dump(mode="json")):
        raise StandingWorkspaceError("系统执行回执没有绑定保存的查询计划")

    final_result = str(validation.get("result_name") or "")
    profile = dict(validation.get("profile") or {})
    if final_result != receipt.result_name or final_result != playbook.validation.input_result:
        raise StandingWorkspaceError("系统执行结果与最终校验没有绑定到同一份数据")
    if str(validation.get("result_hash") or "") != receipt.result_hash:
        raise StandingWorkspaceError("系统执行结果与最终校验的数据指纹不一致")
    if stable_payload_hash(profile) != receipt.profile_hash:
        raise StandingWorkspaceError("系统执行结果的校验摘要与回执不一致")
    if stable_payload_hash(validation) != receipt.validation_hash:
        raise StandingWorkspaceError("系统执行回执没有绑定最终校验记录")

    metadata_keys = (
        "materialized_rows",
        "truncated",
        "request_limit",
        "source_id",
        "table_or_view",
        "query_scope",
        "result_completeness",
        "query_plan",
        "execution_backend",
        "execution_metadata",
        "source_refs",
    )
    metadata = {key: profile.get(key) for key in metadata_keys}
    if stable_payload_hash(metadata) != receipt.metadata_hash:
        raise StandingWorkspaceError("系统执行回执与当前结果的来源信息不一致")
    if (
        profile.get("truncated") is not False
        or profile.get("result_completeness") != "complete"
        or profile.get("materialized_rows") != receipt.row_count
        or str(profile.get("execution_backend") or "") != receipt.execution_backend
    ):
        raise StandingWorkspaceError("持续分析没有得到完整且可核对的当前结果")

    columns = [str(item) for item in profile.get("columns") or []]
    keys = [str(item) for item in (profile.get("keys") or {})]
    numeric = [str(item) for item in (profile.get("numeric") or {})]
    if (
        columns != playbook.validation.columns
        or keys != playbook.validation.key_columns
        or numeric != playbook.validation.numeric_columns
    ):
        raise StandingWorkspaceError("最终校验没有遵守持续分析绑定的结果结构")

    source_refs = [item for item in profile.get("source_refs") or [] if isinstance(item, dict)]
    if not any(
        str(item.get("source_id") or "") == receipt.source_id
        and str(item.get("source_logical_name") or "") == receipt.source_role
        and str(item.get("source_kind") or "") == receipt.source_kind
        for item in source_refs
    ):
        raise StandingWorkspaceError("最终结果没有证明使用了持续分析绑定的数据来源")

    query_evidence = [
        item
        for item in tool_history
        if item.get("kind") == "structured_query"
        and item.get("result_name") == receipt.result_name
        and item.get("source_id") == receipt.source_id
        and item.get("source_schema_signature") == receipt.source_schema_signature
        and item.get("truncated") is False
    ]
    if len(query_evidence) != 1:
        raise StandingWorkspaceError("系统执行回执缺少唯一的类型化查询依据")


async def validate_playbook_run_freshness(
    db: AsyncSession,
    *,
    playbook: AnalysisPlaybookResponse,
    run: AnalysisRun,
) -> None:
    """Reject binding current project definitions to a result produced before they changed."""

    source_result = await db.execute(
        select(ProjectDataSource).where(
            ProjectDataSource.project_id == run.project_id,
            ProjectDataSource.status != "superseded",
        )
    )
    sources = list(source_result.scalars())
    for role in playbook.source_roles:
        active = [
            source
            for source in sources
            if source.kind == role.source_kind
            and _logical_name(source) == role.logical_name
            and (source.profile_data or {}).get("is_current") is not False
        ]
        if len(active) != 1:
            raise StandingWorkspaceError(f"找不到调查当时唯一的数据来源：{role.logical_name}")
        source = active[0]
        if _after_analysis(source.updated_at, run):
            raise StandingWorkspaceError(
                f"数据来源 {role.logical_name} 在这次调查完成后已经变化，请先重新运行分析"
            )
        recipe_result = await db.execute(
            select(SanitationRecipeRecord)
            .where(SanitationRecipeRecord.data_source_id == source.id)
            .order_by(SanitationRecipeRecord.created_at.desc())
        )
        recipe = recipe_result.scalars().first()
        if recipe is not None and _after_analysis(recipe.updated_at, run):
            raise StandingWorkspaceError(
                f"数据来源 {role.logical_name} 的整理方法在调查完成后已经变化，请先重新运行分析"
            )

    required_keys = set(playbook.confirmed_knowledge_keys) | set(playbook.relationship_keys)
    if required_keys:
        knowledge_result = await db.execute(
            select(SemanticEntry).where(
                SemanticEntry.project_id == run.project_id,
                SemanticEntry.key.in_(required_keys),
            )
        )
        for entry in knowledge_result.scalars():
            if _after_analysis(entry.updated_at, run):
                raise StandingWorkspaceError(
                    f"业务定义 {entry.key} 在这次调查完成后已经变化，请先重新运行分析"
                )


def _profile_columns(profile: dict[str, Any], key: str) -> list[str]:
    raw = profile.get(key)
    values = list(raw) if isinstance(raw, dict) else list(raw or [])
    return [str(item) for item in values if str(item).strip()]


async def read_complete_result_artifact(
    db: AsyncSession,
    *,
    project_id: UUID,
    run: AnalysisRun,
    result_name: str,
    validation_profile: dict[str, Any],
) -> CompleteResultArtifact:
    artifacts_result = await db.execute(
        select(ArtifactRecord).where(
            ArtifactRecord.project_id == project_id,
            ArtifactRecord.analysis_run_id == run.id,
            ArtifactRecord.kind == "table",
        )
    )
    matches = [
        artifact
        for artifact in artifacts_result.scalars()
        if str((artifact.technical_details or {}).get("result_name") or "") == result_name
    ]
    if len(matches) != 1:
        raise StandingWorkspaceError("找不到唯一且与最终校验一致的完整结果表")
    artifact = matches[0]
    payload = artifact.payload or {}
    rows = payload.get("rows")
    if payload.get("sampled") is not False or not isinstance(rows, list):
        raise StandingWorkspaceError("持续分析只能使用完整、未抽样的结果表")
    if not all(isinstance(row, dict) for row in rows):
        raise StandingWorkspaceError("最终结果表包含无效记录")
    if payload.get("rows_count") != len(rows):
        raise StandingWorkspaceError("结果表记录数与完整结果不一致")

    columns = _profile_columns(validation_profile, "columns")
    key_columns = _profile_columns(validation_profile, "keys")
    numeric_columns = _profile_columns(validation_profile, "numeric")
    if not columns or not key_columns or not numeric_columns:
        raise StandingWorkspaceError("最终校验缺少键字段或数值字段，不能建立持续分析")
    materialized_rows = validation_profile.get("materialized_rows")
    if materialized_rows is not None:
        try:
            validated_row_count = int(materialized_rows)
        except (TypeError, ValueError) as exc:
            raise StandingWorkspaceError("最终校验记录数无效") from exc
        if validated_row_count != len(rows):
            raise StandingWorkspaceError("最终校验记录数与完整结果不一致")
    return CompleteResultArtifact(
        artifact=artifact,
        rows=rows,
        columns=columns,
        key_columns=key_columns,
        numeric_columns=numeric_columns,
    )


async def persist_snapshot_artifact(
    db: AsyncSession,
    *,
    project_id: UUID,
    run: AnalysisRun,
    standing_id: str,
    playbook_id: str,
    snapshot: ValidatedResultSnapshot,
) -> ArtifactRecord:
    artifact = ArtifactRecord(
        project_id=project_id,
        analysis_run_id=run.id,
        kind="result_snapshot",
        title="持续分析基线快照",
        payload=snapshot.model_dump(mode="json"),
        technical_details={
            "standing_analysis_id": standing_id,
            "playbook_id": playbook_id,
            "validation_state": "validated",
        },
    )
    db.add(artifact)
    await db.flush()
    return artifact


async def read_snapshot_artifact(
    db: AsyncSession,
    *,
    project_id: UUID,
    baseline: StandingBaselineRef,
) -> ValidatedResultSnapshot:
    artifact = await db.get(ArtifactRecord, baseline.artifact_id)
    if (
        artifact is None
        or artifact.project_id != project_id
        or artifact.analysis_run_id != baseline.analysis_run_id
        or artifact.kind != "result_snapshot"
    ):
        raise StandingWorkspaceCorruptError("持续分析基线产物不存在")
    try:
        snapshot = ValidatedResultSnapshot.model_validate(artifact.payload)
    except ValidationError as exc:
        raise StandingWorkspaceCorruptError("持续分析基线产物已损坏") from exc
    if (
        snapshot.snapshot_id != baseline.snapshot_id
        or snapshot.input_token != baseline.input_token
        or snapshot.shape_hash != baseline.shape_hash
    ):
        raise StandingWorkspaceCorruptError("持续分析基线引用不一致")
    return snapshot


def baseline_ref(
    *,
    snapshot: ValidatedResultSnapshot,
    artifact: ArtifactRecord,
    evidence: list[str],
    accepted_at: datetime | None = None,
) -> StandingBaselineRef:
    return StandingBaselineRef(
        snapshot_id=snapshot.snapshot_id,
        analysis_run_id=snapshot.analysis_run_id,
        artifact_id=artifact.id,
        input_token=snapshot.input_token,
        shape_hash=snapshot.shape_hash,
        validation_evidence=evidence,
        accepted_at=accepted_at or datetime.now(UTC),
    )


__all__ = [
    "CompleteResultArtifact",
    "MAX_STANDING_ANALYSES",
    "StandingInputState",
    "StandingWorkspaceCorruptError",
    "StandingWorkspaceError",
    "baseline_ref",
    "canonical_hash",
    "evaluate_standing_input",
    "load_analysis_playbooks",
    "load_standing_analyses",
    "persist_snapshot_artifact",
    "read_complete_result_artifact",
    "read_snapshot_artifact",
    "save_standing_analyses",
    "standing_analysis_id",
    "validate_playbook_baseline_evidence",
    "validate_playbook_execution_evidence",
    "validate_playbook_run_freshness",
]
