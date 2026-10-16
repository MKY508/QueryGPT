"""Safe hierarchical scope resolution for governed project semantics.

Scope is system-owned metadata.  Executable definitions are bound only when a
current source and table can be identified uniquely from an existing profile;
ambiguous logical names never fall back to a best-effort guess.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Project, ProjectDataSource, SemanticEntry, SemanticScopeNode
from app.models.workspace import (
    ScopePresentationDefinition,
    SemanticScopeNodeResponse,
    SemanticScopePathItem,
    semantic_definition_variant,
)
from app.services.semantic_revisions import (
    append_semantic_revision,
)
from app.services.source_activation import is_current_source

SemanticResolvedScopeKind = Literal["project", "source", "table"]


class SemanticScopeResolutionError(ValueError):
    """A physical semantic scope cannot be proven uniquely."""


@dataclass(frozen=True, slots=True)
class ResolvedDefinitionScope:
    kind: SemanticResolvedScopeKind
    source: ProjectDataSource | None = None
    table_or_view: str | None = None


def _normalized(value: str) -> str:
    text = unicodedata.normalize("NFKC", value).strip().casefold()
    return re.sub(r"\s+", " ", text)


def _source_profile(source: ProjectDataSource) -> dict[str, Any]:
    return source.profile_data if isinstance(source.profile_data, dict) else {}


def source_logical_name(source: ProjectDataSource) -> str:
    profile = _source_profile(source)
    return str(profile.get("logical_name") or source.name or "").strip()


def _source_business_name(source: ProjectDataSource) -> str:
    profile = _source_profile(source)
    return str(profile.get("business_name") or source.name or source_logical_name(source)).strip()


def _source_description(source: ProjectDataSource) -> str | None:
    profile = _source_profile(source)
    value = profile.get("description") or profile.get("summary")
    return str(value).strip() if value else None


def _table_candidates(source: ProjectDataSource) -> list[dict[str, Any]]:
    profile = _source_profile(source)
    if source.kind == "file":
        logical_name = source_logical_name(source)
        source_name = str(source.name or "").strip()
        readable_name = source_name.rsplit(".", 1)[0] if "." in source_name else source_name
        return (
            [
                {
                    "name": logical_name,
                    "business_name": (
                        profile.get("table_business_name")
                        or readable_name
                        or source_name
                        or logical_name
                    ),
                    "description": profile.get("table_description"),
                    "schema": None,
                    "kind": "file",
                    "columns": list((profile.get("schema") or {}).get("columns") or []),
                }
            ]
            if logical_name
            else []
        )
    if source.kind != "connection":
        return []
    deep_tables = [
        dict(table)
        for table in profile.get("tables") or []
        if isinstance(table, Mapping) and str(table.get("name") or "").strip()
    ]
    relation_index = (profile.get("preanalysis") or {}).get("relation_index") or {}
    indexed_tables = [
        dict(table)
        for table in relation_index.get("relations") or []
        if isinstance(table, Mapping) and str(table.get("name") or "").strip()
    ]

    def identity(table: Mapping[str, Any]) -> tuple[str, str]:
        return (
            _normalized(str(table.get("schema") or "")),
            _normalized(str(table.get("name") or "")),
        )

    merged: dict[tuple[str, str], dict[str, Any]] = {}
    order: list[tuple[str, str]] = []
    for table in [*indexed_tables, *deep_tables]:
        key = identity(table)
        if key not in merged:
            order.append(key)
            merged[key] = {
                **table,
                "description": table.get("description") or table.get("comment"),
                "columns": list(table.get("columns") or []),
                "profile_status": "catalog_only",
            }
            continue
        previous = merged[key]
        merged[key] = {
            **previous,
            **table,
            "description": (
                table.get("description") or table.get("comment") or previous.get("description")
            ),
            "columns": list(table.get("columns") or previous.get("columns") or []),
            "profile_status": (
                "profiled" if table.get("columns") or previous.get("columns") else "catalog_only"
            ),
        }
    return [merged[key] for key in order]


def _table_names(table: Mapping[str, Any]) -> tuple[str, ...]:
    name = str(table.get("name") or "").strip()
    schema = str(table.get("schema") or "").strip()
    return tuple(item for item in (name, f"{schema}.{name}" if schema and name else "") if item)


def _canonical_table_name(table: Mapping[str, Any]) -> str:
    name = str(table.get("name") or "").strip()
    schema = str(table.get("schema") or "").strip()
    return f"{schema}.{name}" if schema and name else name


def _years_in_names(values: Sequence[str]) -> set[int]:
    years: set[int] = set()
    for value in values:
        for match in re.finditer(r"(?<!\d)(19\d{2}|20\d{2}|2100)(?!\d)", value):
            year = int(match.group(1))
            if 1900 <= year <= 2100:
                years.add(year)
    return years


def _time_roles(
    source: ProjectDataSource,
    table: Mapping[str, Any] | None,
) -> list[Mapping[str, Any]]:
    profile = _source_profile(source)
    if source.kind == "file":
        return [
            item
            for item in (profile.get("preanalysis") or {}).get("candidate_roles") or []
            if isinstance(item, Mapping) and item.get("role") == "time"
        ]
    if table is None:
        return []
    direct = [
        item
        for item in table.get("candidate_roles") or []
        if isinstance(item, Mapping) and item.get("role") == "time"
    ]
    if direct:
        return direct
    table_name = str(table.get("name") or "")
    portraits = [
        item
        for item in (profile.get("preanalysis") or {}).get("tables") or []
        if isinstance(item, Mapping)
        and _normalized(str(item.get("table") or item.get("name") or "")) == _normalized(table_name)
    ]
    if len(portraits) != 1:
        return []
    return [
        item
        for item in portraits[0].get("candidate_roles") or []
        if isinstance(item, Mapping) and item.get("role") == "time"
    ]


def _single_time_range_facts(
    source: ProjectDataSource,
    table: Mapping[str, Any] | None,
) -> dict[str, Any]:
    roles = _time_roles(source, table)
    ranged = [item.get("range") for item in roles if isinstance(item.get("range"), Mapping)]
    if len(ranged) != 1:
        return {}
    start = str(ranged[0].get("start") or "")
    end = str(ranged[0].get("end") or "")
    start_match = re.match(r"^(19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])-([0-3]\d)", start)
    end_match = re.match(r"^(19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])-([0-3]\d)", end)
    if not start_match or not end_match or start_match.group(1) != end_match.group(1):
        return {}
    year = int(start_match.group(1))
    if not 1900 <= year <= 2100:
        return {}
    facts: dict[str, Any] = {
        "year": year,
        "period_start": start,
        "period_end": end,
        "period_evidence": "preanalysis_time_range",
    }
    if start_match.group(2) == end_match.group(2):
        facts["month"] = int(start_match.group(2))
    return facts


def _temporal_context_facts(
    source: ProjectDataSource,
    table: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    profile = _source_profile(source)
    range_facts = _single_time_range_facts(source, table)
    names = [source.name, source_logical_name(source)]
    if table is not None:
        names.extend(_table_names(table))
    name_years = _years_in_names([str(value) for value in names if value])
    if range_facts and name_years and name_years != {range_facts["year"]}:
        # Conflicting filename and profiled dates are evidence of ambiguity, not
        # permission to pick whichever value looks more plausible.
        return {"temporal_context_status": "conflicting_evidence"}
    facts = dict(range_facts)
    if not facts and len(name_years) == 1:
        facts = {
            "year": next(iter(name_years)),
            "period_evidence": "source_or_table_name",
        }
    if not facts:
        return {}

    explicit_topic = None
    if table is not None:
        explicit_topic = table.get("business_topic")
    explicit_topic = explicit_topic or profile.get("business_topic")
    if explicit_topic:
        facts["business_topic"] = str(explicit_topic).strip()
        facts["business_topic_status"] = "explicit"
    else:
        facts["business_topic_status"] = "unconfirmed"
    year = facts["year"]
    month = facts.get("month")
    period = f"{year} 年{f' {month} 月' if month else ''}"
    topic = str(facts.get("business_topic") or "").strip()
    facts["period_label"] = f"{period}{topic}数据" if topic else f"{period}数据 · 业务主题待确认"
    return facts


def _resolve_table(source: ProjectDataSource, requested: str) -> dict[str, Any]:
    requested_key = _normalized(requested)
    matches = [
        table
        for table in _table_candidates(source)
        if requested_key in {_normalized(name) for name in _table_names(table)}
    ]
    if len(matches) != 1:
        raise SemanticScopeResolutionError(f"数据源“{source.name}”中无法唯一确认表“{requested}”")
    return matches[0]


def _definition_bindings(definition: Any) -> list[dict[str, Any]]:
    if not isinstance(definition, Mapping):
        model_dump = getattr(definition, "model_dump", None)
        definition = model_dump(mode="python") if callable(model_dump) else None
    if not isinstance(definition, Mapping):
        return []
    variant = semantic_definition_variant(definition)
    if variant in {"aggregate_metric", "dimension"}:
        binding = definition.get("source")
        return [dict(binding)] if isinstance(binding, Mapping) else []
    if variant == "derived_metric":
        return [dict(item) for item in definition.get("sources") or [] if isinstance(item, Mapping)]
    if variant == "business_rule_strategy":
        applies_to = definition.get("applies_to")
        if isinstance(applies_to, Mapping):
            return [dict(applies_to)]
        return [dict(item) for item in applies_to or [] if isinstance(item, Mapping)]
    if variant == "relationship":
        return [
            dict(item)
            for item in (definition.get("left"), definition.get("right"))
            if isinstance(item, Mapping)
        ]
    return []


def _resolve_binding_source(
    sources: Sequence[ProjectDataSource],
    binding: Mapping[str, Any],
) -> ProjectDataSource:
    logical_name = str(binding.get("source_logical_name") or "").strip()
    source_kind = str(binding.get("source_kind") or "").strip()
    if not logical_name or source_kind not in {"file", "connection"}:
        raise SemanticScopeResolutionError("类型化定义缺少稳定的数据源绑定")
    matches = [
        source
        for source in sources
        if source.kind == source_kind
        and _normalized(source_logical_name(source)) == _normalized(logical_name)
    ]
    if len(matches) != 1:
        raise SemanticScopeResolutionError(
            f"逻辑数据源“{logical_name}”当前不存在或不唯一，不能猜测语义作用域"
        )
    return matches[0]


def resolve_definition_scope(
    sources: Sequence[ProjectDataSource],
    definition: Any,
) -> ResolvedDefinitionScope:
    """Resolve an executable definition to one direct node without guessing."""

    variant = semantic_definition_variant(definition)
    if variant == "raw":
        return ResolvedDefinitionScope(kind="project")
    if variant == "scope_presentation":
        try:
            presentation = ScopePresentationDefinition.model_validate(definition)
        except (TypeError, ValueError) as exc:
            raise SemanticScopeResolutionError("数据范围名称缺少稳定的物理绑定") from exc
        source = _resolve_binding_source(
            sources,
            {
                "source_logical_name": presentation.source_logical_name,
                "source_kind": presentation.source_kind,
            },
        )
        if presentation.scope_kind == "source":
            return ResolvedDefinitionScope(kind="source", source=source)
        table = _resolve_table(source, presentation.table_or_view or "")
        return ResolvedDefinitionScope(
            kind="table",
            source=source,
            table_or_view=_canonical_table_name(table),
        )
    bindings = _definition_bindings(definition)
    if not bindings:
        raise SemanticScopeResolutionError("类型化定义缺少可验证的物理作用域")

    resolved: list[tuple[ProjectDataSource, str]] = []
    for binding in bindings:
        source = _resolve_binding_source(sources, binding)
        requested_table = str(binding.get("table_or_view") or "").strip()
        if not requested_table:
            raise SemanticScopeResolutionError("类型化定义缺少表或视图绑定")
        table = _resolve_table(source, requested_table)
        resolved.append((source, _canonical_table_name(table)))

    source_ids = {source.id for source, _table in resolved}
    table_keys = {(source.id, _normalized(table_or_view)) for source, table_or_view in resolved}
    if len(source_ids) == 1 and len(table_keys) == 1:
        source, table_or_view = resolved[0]
        return ResolvedDefinitionScope(
            kind="table",
            source=source,
            table_or_view=table_or_view,
        )
    if len(source_ids) == 1:
        return ResolvedDefinitionScope(kind="source", source=resolved[0][0])
    # A cross-source relationship is genuinely project-level. It remains
    # globally visible only after confirmation; each table-local definition is
    # still hidden until its table scope is explicitly opened.
    return ResolvedDefinitionScope(kind="project")


async def _current_sources(
    db: AsyncSession,
    project_id: UUID,
) -> list[ProjectDataSource]:
    result = await db.execute(
        select(ProjectDataSource)
        .where(
            ProjectDataSource.project_id == project_id,
            ProjectDataSource.status != "superseded",
        )
        .order_by(ProjectDataSource.created_at, ProjectDataSource.id)
    )
    return [source for source in result.scalars() if is_current_source(source)]


async def ensure_project_scope(
    db: AsyncSession,
    project: Project,
) -> SemanticScopeNode:
    stable_key = f"project:{project.id}"
    result = await db.execute(
        select(SemanticScopeNode).where(
            SemanticScopeNode.project_id == project.id,
            SemanticScopeNode.stable_key == stable_key,
        )
    )
    node = result.scalar_one_or_none()
    if node is None:
        node = SemanticScopeNode(
            project_id=project.id,
            parent_id=None,
            kind="project",
            stable_key=stable_key,
            business_name=project.name,
            description=project.description,
            context_facts={},
            is_active=True,
        )
        db.add(node)
        await db.flush()
    else:
        node.business_name = project.name
        node.description = project.description
        node.is_active = True
    return node


async def ensure_source_scope(
    db: AsyncSession,
    root: SemanticScopeNode,
    source: ProjectDataSource,
) -> SemanticScopeNode:
    logical_name = source_logical_name(source)
    logical_digest = hashlib.sha256(_normalized(logical_name).encode("utf-8")).hexdigest()[:24]
    stable_key = f"source:{source.kind}:{logical_digest}"
    result = await db.execute(
        select(SemanticScopeNode).where(
            SemanticScopeNode.project_id == root.project_id,
            SemanticScopeNode.stable_key == stable_key,
        )
    )
    node = result.scalar_one_or_none()
    facts = {
        "source_id": str(source.id),
        "source_kind": source.kind,
        "format": source.format,
        "status": source.status,
        **_temporal_context_facts(source),
    }
    description = (
        _source_description(source) or str(facts.get("period_label") or "").strip() or None
    )
    if node is None:
        node = SemanticScopeNode(
            project_id=root.project_id,
            parent_id=root.id,
            kind="source",
            stable_key=stable_key,
            business_name=_source_business_name(source) or source.name,
            description=description,
            source_logical_name=logical_name,
            table_or_view=None,
            context_facts=facts,
            is_active=True,
        )
        db.add(node)
        await db.flush()
    else:
        node.parent_id = root.id
        node.business_name = _source_business_name(source) or source.name
        node.description = description
        node.source_logical_name = logical_name
        node.context_facts = facts
        node.is_active = True
    return node


def _table_stable_key(source_node: SemanticScopeNode, table_or_view: str) -> str:
    source_digest = hashlib.sha256(source_node.stable_key.encode("utf-8")).hexdigest()[:24]
    table_digest = hashlib.sha256(_normalized(table_or_view).encode("utf-8")).hexdigest()[:24]
    return f"table:{source_digest}:{table_digest}"


async def ensure_table_scope(
    db: AsyncSession,
    source_node: SemanticScopeNode,
    source: ProjectDataSource,
    table: Mapping[str, Any],
) -> SemanticScopeNode:
    table_or_view = _canonical_table_name(table)
    if not table_or_view:
        raise SemanticScopeResolutionError("数据画像中的表缺少名称")
    stable_key = _table_stable_key(source_node, table_or_view)
    result = await db.execute(
        select(SemanticScopeNode).where(
            SemanticScopeNode.project_id == source_node.project_id,
            SemanticScopeNode.stable_key == stable_key,
        )
    )
    node = result.scalar_one_or_none()
    facts = {
        "source_id": str(source.id),
        "source_kind": source.kind,
        "schema": table.get("schema"),
        "table_kind": table.get("kind"),
        "column_count": len(table.get("columns") or []),
        "profile_status": table.get("profile_status")
        or ("profiled" if table.get("columns") else "catalog_only"),
        **_temporal_context_facts(source, table),
    }
    business_name = str(table.get("business_name") or table.get("name") or table_or_view).strip()
    description = (
        str(table.get("description") or "").strip()
        or str(facts.get("period_label") or "").strip()
        or None
    )
    if node is None:
        node = SemanticScopeNode(
            project_id=source_node.project_id,
            parent_id=source_node.id,
            kind="table",
            stable_key=stable_key,
            business_name=business_name,
            description=description,
            source_logical_name=source_logical_name(source),
            table_or_view=table_or_view,
            context_facts=facts,
            is_active=True,
        )
        db.add(node)
        await db.flush()
    else:
        node.parent_id = source_node.id
        node.business_name = business_name
        node.description = description
        node.source_logical_name = source_logical_name(source)
        node.table_or_view = table_or_view
        node.context_facts = facts
        node.is_active = True
    return node


async def _apply_confirmed_scope_presentations(
    db: AsyncSession,
    project_id: UUID,
    *,
    nodes: Sequence[SemanticScopeNode] | None,
) -> None:
    """Overlay only adopted presentation metadata onto physical scope nodes."""

    if nodes is None:
        node_result = await db.execute(
            select(SemanticScopeNode).where(SemanticScopeNode.project_id == project_id)
        )
        nodes = list(node_result.scalars())
    entry_result = await db.execute(
        select(SemanticEntry)
        .where(
            SemanticEntry.project_id == project_id,
            SemanticEntry.entry_type == "scope_presentation",
            SemanticEntry.state.in_({"confirmed", "locked"}),
            SemanticEntry.validity == "active",
            SemanticEntry.is_active.is_(True),
        )
        .order_by(
            SemanticEntry.state.desc(),
            SemanticEntry.revision_number.desc(),
            SemanticEntry.id,
        )
    )
    selected: dict[UUID, tuple[SemanticEntry, ScopePresentationDefinition]] = {}
    for entry in entry_result.scalars():
        try:
            presentation = ScopePresentationDefinition.model_validate(entry.definition)
        except (TypeError, ValueError):
            continue
        matches = [
            node
            for node in nodes
            if node.kind == presentation.scope_kind
            and _normalized(str(node.source_logical_name or ""))
            == _normalized(presentation.source_logical_name)
            and (
                presentation.scope_kind == "source"
                or _normalized(str(node.table_or_view or ""))
                == _normalized(str(presentation.table_or_view or ""))
            )
        ]
        if len(matches) != 1 or matches[0].id in selected:
            # Competing adopted labels are not resolved by guessing. The first
            # deterministic, highest-governance head wins; all candidates remain
            # visible in history for explicit user repair.
            continue
        selected[matches[0].id] = (entry, presentation)

    for node in nodes:
        adopted = selected.get(node.id)
        if adopted is None:
            continue
        entry, presentation = adopted
        node.business_name = presentation.business_name
        if presentation.description is not None:
            node.description = presentation.description
        node.context_facts = {
            **dict(node.context_facts or {}),
            "synonyms": list(presentation.synonyms),
            "presentation_entry_id": str(entry.id),
            "presentation_revision_id": str(entry.active_revision_id or ""),
        }


async def ensure_semantic_scope_tree(
    db: AsyncSession,
    project_id: UUID,
    *,
    tolerate_ambiguous_sources: bool = False,
) -> list[SemanticScopeNode]:
    project = await db.get(Project, project_id)
    if project is None:
        raise SemanticScopeResolutionError("项目不存在")
    root = await ensure_project_scope(db, project)
    sources = await _current_sources(db, project_id)
    active_keys = {root.stable_key}
    source_identity_counts: dict[tuple[str, str], int] = {}
    for source in sources:
        identity = (source.kind, _normalized(source_logical_name(source)))
        source_identity_counts[identity] = source_identity_counts.get(identity, 0) + 1
    for source in sources:
        logical_identity = (source.kind, _normalized(source_logical_name(source)))
        if not logical_identity[1] or source_identity_counts[logical_identity] != 1:
            if tolerate_ambiguous_sources:
                # Runtime readers can still use unrelated, uniquely identified
                # sources.  Ambiguous sources receive no scope node and their
                # semantic definitions remain non-executable with diagnostics.
                continue
            raise SemanticScopeResolutionError("当前数据源的逻辑名称缺失或重复，不能猜测层级作用域")
        source_node = await ensure_source_scope(db, root, source)
        active_keys.add(source_node.stable_key)
        tables = _table_candidates(source)
        table_identity_counts: dict[str, int] = {}
        for table in tables:
            identity = _normalized(_canonical_table_name(table))
            table_identity_counts[identity] = table_identity_counts.get(identity, 0) + 1
        for table in tables:
            table_identity = _normalized(_canonical_table_name(table))
            if not table_identity or table_identity_counts[table_identity] != 1:
                if tolerate_ambiguous_sources:
                    continue
                raise SemanticScopeResolutionError(
                    f"数据源“{source.name}”的表名称缺失或重复，不能猜测层级作用域"
                )
            table_node = await ensure_table_scope(db, source_node, source, table)
            active_keys.add(table_node.stable_key)

    await _apply_confirmed_scope_presentations(db, project_id, nodes=None)

    result = await db.execute(
        select(SemanticScopeNode)
        .where(SemanticScopeNode.project_id == project_id)
        .order_by(SemanticScopeNode.created_at, SemanticScopeNode.id)
    )
    nodes = list(result.scalars())
    for node in nodes:
        if node.kind in {"project", "source", "table"}:
            node.is_active = node.stable_key in active_keys
    await db.flush()
    return nodes


async def _node_for_resolved_scope(
    db: AsyncSession,
    project_id: UUID,
    resolved: ResolvedDefinitionScope,
    *,
    nodes: Sequence[SemanticScopeNode] | None = None,
) -> SemanticScopeNode:
    if nodes is None:
        nodes = await ensure_semantic_scope_tree(db, project_id)
    if resolved.kind == "project":
        matches = [node for node in nodes if node.kind == "project" and node.parent_id is None]
    elif resolved.kind == "source" and resolved.source is not None:
        matches = [
            node
            for node in nodes
            if node.kind == "source"
            and str((node.context_facts or {}).get("source_id") or "") == str(resolved.source.id)
        ]
    elif (
        resolved.kind == "table"
        and resolved.source is not None
        and resolved.table_or_view is not None
    ):
        matches = [
            node
            for node in nodes
            if node.kind == "table"
            and str((node.context_facts or {}).get("source_id") or "") == str(resolved.source.id)
            and _normalized(str(node.table_or_view or "")) == _normalized(resolved.table_or_view)
        ]
    else:
        matches = []
    if len(matches) != 1:
        raise SemanticScopeResolutionError("无法唯一建立类型化定义的作用域节点")
    return matches[0]


async def resolve_semantic_entry_scope(
    db: AsyncSession,
    *,
    project_id: UUID,
    definition: Any,
    requested_scope_id: UUID | None,
    allow_unresolved_project_fallback: bool = False,
) -> SemanticScopeNode:
    """Resolve and validate one create/update payload's direct scope."""

    sources = await _current_sources(db, project_id)
    try:
        resolved = resolve_definition_scope(sources, definition)
    except SemanticScopeResolutionError:
        if not allow_unresolved_project_fallback:
            raise
        requested = (
            await get_semantic_scope_node(db, project_id, requested_scope_id)
            if requested_scope_id is not None
            else None
        )
        if requested_scope_id is not None and (requested is None or requested.kind != "project"):
            raise SemanticScopeResolutionError(
                "尚未匹配到当前物理数据的候选定义只能暂存在项目根作用域"
            )
        # Unverified candidates are not executable or model-visible. Keeping
        # them at the project root preserves imported/inferred work until a
        # current source can be proven; reconciliation moves them later.
        resolved = ResolvedDefinitionScope(kind="project")
    expected = await _node_for_resolved_scope(db, project_id, resolved)
    if requested_scope_id is None:
        return expected
    requested = await get_semantic_scope_node(db, project_id, requested_scope_id)
    if requested is None:
        raise SemanticScopeResolutionError("所选语义作用域不属于当前项目")
    if semantic_definition_variant(definition) != "raw" and requested.id != expected.id:
        raise SemanticScopeResolutionError("所选作用域与类型化定义的数据源或表不一致")
    return requested


async def get_semantic_scope_node(
    db: AsyncSession,
    project_id: UUID,
    scope_id: UUID,
    *,
    include_inactive: bool = False,
) -> SemanticScopeNode | None:
    statement = select(SemanticScopeNode).where(
        SemanticScopeNode.id == scope_id,
        SemanticScopeNode.project_id == project_id,
    )
    if not include_inactive:
        statement = statement.where(SemanticScopeNode.is_active.is_(True))
    result = await db.execute(statement)
    return result.scalar_one_or_none()


def semantic_scope_path_from_nodes(
    node: SemanticScopeNode,
    nodes: Sequence[SemanticScopeNode],
) -> list[SemanticScopePathItem]:
    by_id = {item.id: item for item in nodes}
    path: list[SemanticScopeNode] = []
    current: SemanticScopeNode | None = node
    seen: set[UUID] = set()
    while current is not None:
        if current.id in seen:
            raise SemanticScopeResolutionError("语义作用域层级存在循环")
        if current.project_id != node.project_id:
            raise SemanticScopeResolutionError("语义作用域父节点跨越了项目边界")
        seen.add(current.id)
        path.append(current)
        current = by_id.get(current.parent_id) if current.parent_id else None
    if not path or path[-1].kind != "project":
        raise SemanticScopeResolutionError("语义作用域缺少项目根节点")
    return [SemanticScopePathItem.model_validate(item) for item in reversed(path)]


async def semantic_scope_path(
    db: AsyncSession,
    node: SemanticScopeNode,
) -> list[SemanticScopePathItem]:
    result = await db.execute(
        select(SemanticScopeNode).where(SemanticScopeNode.project_id == node.project_id)
    )
    return semantic_scope_path_from_nodes(node, list(result.scalars()))


async def read_direct_scope_entries(
    db: AsyncSession,
    *,
    project_id: UUID,
    scope_id: UUID,
    states: set[str] | None = None,
) -> list[SemanticEntry]:
    """Read only entries attached directly to one node, never descendants."""

    node = await get_semantic_scope_node(db, project_id, scope_id)
    if node is None:
        raise SemanticScopeResolutionError("语义作用域不存在")
    statement = select(SemanticEntry).where(
        SemanticEntry.project_id == project_id,
        SemanticEntry.scope_id == scope_id,
        SemanticEntry.is_active.is_(True),
    )
    if states:
        statement = statement.where(SemanticEntry.state.in_(states))
    result = await db.execute(statement.order_by(SemanticEntry.key, SemanticEntry.id))
    return list(result.scalars())


async def reconcile_unscoped_semantic_entries(
    db: AsyncSession,
    project_id: UUID,
    *,
    tolerate_ambiguous_sources: bool = False,
) -> int:
    """Safely migrate legacy NULL scopes and record the move as a new revision.

    This is a deterministic metadata backfill: the executable definition and
    physical binding do not change, so an existing validation proof remains
    valid. Explicit user/API moves still reset proof in the update path.
    """

    nodes = await ensure_semantic_scope_tree(
        db,
        project_id,
        tolerate_ambiguous_sources=tolerate_ambiguous_sources,
    )
    root = next(node for node in nodes if node.kind == "project" and node.parent_id is None)
    sources = await _current_sources(db, project_id)
    result = await db.execute(
        select(SemanticEntry)
        .where(
            SemanticEntry.project_id == project_id,
            or_(
                SemanticEntry.scope_id.is_(None),
                ((SemanticEntry.scope_id == root.id) & (SemanticEntry.state == "candidate")),
            ),
        )
        .order_by(SemanticEntry.id)
        .with_for_update()
    )
    moved = 0
    for entry in result.scalars():
        if (
            entry.state == "candidate"
            and entry.source == "verified_analysis"
            and entry.execution_state == "verified"
        ):
            # A report-derived, system-verified candidate is an immutable
            # observation.  Backfilling presentation scope must not append
            # evidence/revisions that make a later model proposal look like it
            # changed the verified candidate.
            continue
        try:
            resolved = resolve_definition_scope(sources, entry.definition)
            target = await _node_for_resolved_scope(
                db,
                project_id,
                resolved,
                nodes=nodes,
            )
        except SemanticScopeResolutionError:
            # Ambiguous executable definitions remain hidden and unbound until
            # the user fixes their source/table identity.
            continue
        if target.id == entry.scope_id:
            continue
        entry.scope_id = target.id
        entry.evidence = [
            *list(entry.evidence or []),
            {
                "kind": "semantic_scope_reconciled",
                "scope_id": str(target.id),
                "scope_stable_key": target.stable_key,
            },
        ]
        await append_semantic_revision(
            db,
            entry,
            mutation_kind="scope_reconciled",
            actor_source="system",
            reason="将历史业务定义绑定到唯一可验证的层级作用域",
            expected_active_revision_id=entry.active_revision_id,
        )
        moved += 1
    return moved


async def semantic_scope_node_responses(
    db: AsyncSession,
    project_id: UUID,
) -> list[SemanticScopeNodeResponse]:
    await ensure_semantic_scope_tree(db, project_id)
    await reconcile_unscoped_semantic_entries(db, project_id)
    result = await db.execute(
        select(SemanticScopeNode)
        .where(
            SemanticScopeNode.project_id == project_id,
            SemanticScopeNode.is_active.is_(True),
        )
        .order_by(SemanticScopeNode.created_at, SemanticScopeNode.id)
    )
    nodes = list(result.scalars())
    entry_counts = dict(
        (
            await db.execute(
                select(SemanticEntry.scope_id, func.count(SemanticEntry.id))
                .where(
                    SemanticEntry.project_id == project_id,
                    SemanticEntry.is_active.is_(True),
                    SemanticEntry.scope_id.is_not(None),
                )
                .group_by(SemanticEntry.scope_id)
            )
        ).all()
    )
    child_counts = dict(
        (
            await db.execute(
                select(SemanticScopeNode.parent_id, func.count(SemanticScopeNode.id))
                .where(
                    SemanticScopeNode.project_id == project_id,
                    SemanticScopeNode.is_active.is_(True),
                    SemanticScopeNode.parent_id.is_not(None),
                )
                .group_by(SemanticScopeNode.parent_id)
            )
        ).all()
    )
    responses: list[SemanticScopeNodeResponse] = []
    for node in nodes:
        response = SemanticScopeNodeResponse.model_validate(node)
        response.synonyms = [
            str(value)
            for value in (node.context_facts or {}).get("synonyms") or []
            if str(value).strip()
        ][:20]
        response.direct_entry_count = int(entry_counts.get(node.id, 0))
        response.child_count = int(child_counts.get(node.id, 0))
        response.path = semantic_scope_path_from_nodes(node, nodes)
        responses.append(response)
    return responses


def semantic_scope_runtime_payload(
    node: SemanticScopeNode | None,
    nodes: Sequence[SemanticScopeNode],
) -> dict[str, Any]:
    if node is None:
        return {
            "scope_id": None,
            "scope_kind": None,
            "scope_source_logical_name": None,
            "scope_table_or_view": None,
            "scope_context_facts": {},
            "scope_path": [],
        }
    return {
        "scope_id": str(node.id),
        "scope_kind": node.kind,
        "scope_source_logical_name": node.source_logical_name,
        "scope_table_or_view": node.table_or_view,
        "scope_context_facts": dict(node.context_facts or {}),
        "scope_path": [
            item.model_dump(mode="json") for item in semantic_scope_path_from_nodes(node, nodes)
        ],
    }
