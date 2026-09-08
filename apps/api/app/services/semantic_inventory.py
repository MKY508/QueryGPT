"""Durable, user-consented semantic inventory work for database sources.

The inventory follows the same split used by mature catalog products: build a
metadata-only directory for broad coverage, then inspect values only for tables
the user selected explicitly.  Every table is its own durable work item so a
large database can make partial progress, be cancelled, and retry failures.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import encryptor
from app.db import AsyncSessionLocal
from app.db.tables import (
    Connection,
    Project,
    ProjectDataSource,
    SemanticInventoryJob,
    SemanticInventoryJobItem,
)
from app.models.workspace import (
    RelationshipDefinition,
    SemanticInventoryJobItemPageResponse,
    SemanticInventoryJobItemResponse,
    SemanticInventoryJobProgress,
    SemanticInventoryJobRequest,
    SemanticInventoryJobResponse,
    SemanticRecommendationScope,
)
from app.services.app_settings import get_or_create_app_settings
from app.services.checkpoint_contract import stable_payload_hash
from app.services.database import create_database_manager
from app.services.database_value_preflight import (
    DatabaseValuePreflightBudget,
    bounded_relation_index_snapshot,
    profile_selected_database_relation,
)
from app.services.project_context import load_project_context
from app.services.semantic_recommendation_ai import (
    build_semantic_recommendation_enhancer,
)
from app.services.semantic_recommendation_store import (
    persist_semantic_recommendation_batch,
)
from app.services.semantic_recommendations import (
    SemanticRecommendationBatch,
    SemanticRecommendationError,
    declared_relationship_evidence,
    generate_semantic_recommendations,
)
from app.services.semantic_scopes import SemanticScopeResolutionError

logger = structlog.get_logger()

_RELATION_PAGE_SIZE = 500
_MAX_RELATIONS = 50_000
_MAX_STRUCTURE_COLUMNS = 240
_ITEM_TIMEOUT_SECONDS = 20.0
_LEASE_SECONDS = 120
_ACTIVE_STATUSES = ("queued", "running")
_TERMINAL_STATUSES = (
    "completed",
    "completed_with_errors",
    "cancelled",
    "failed",
)
_NON_RETRYABLE_JOB_CODES = frozenset(
    {
        "semantic_inventory_empty_source",
        "semantic_inventory_snapshot_incomplete",
        "semantic_inventory_snapshot_missing",
        "semantic_inventory_source_changed",
        "semantic_inventory_source_missing",
        "semantic_inventory_source_not_ready",
        "semantic_inventory_table_ambiguous",
        "semantic_inventory_table_unknown",
    }
)

# asyncio keeps only weak references to tasks.  Startup recovery and route-level
# scheduling must retain work until its done callback runs.
_scheduled_tasks: set[asyncio.Task[None]] = set()


class SemanticInventoryError(ValueError):
    """Stable route boundary for an inventory request the service cannot honor."""

    def __init__(self, code: str, message: str, *, status_code: int = 409):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class _InventoryItemError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool,
        cancelled: bool = False,
    ):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.cancelled = cancelled


def _job_error_retryable(exc: Exception) -> bool:
    if isinstance(exc, _InventoryItemError):
        return exc.retryable and not exc.cancelled
    if isinstance(exc, SemanticInventoryError):
        return exc.code not in _NON_RETRYABLE_JOB_CODES
    return True


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _canonical_relation_name(relation: Mapping[str, Any]) -> str:
    name = str(relation.get("name") or "").strip()
    schema = str(relation.get("schema") or "").strip()
    return f"{schema}.{name}" if schema and name else name


def _normalized_relations(relations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = [
        {
            "name": str(item.get("name") or "").strip(),
            "schema": str(item.get("schema") or "").strip() or None,
            "kind": str(item.get("kind") or "unknown").strip() or "unknown",
            "comment": str(item.get("comment") or "").strip() or None,
        }
        for item in relations
        if isinstance(item, Mapping) and str(item.get("name") or "").strip()
    ]
    normalized.sort(
        key=lambda item: (
            str(item.get("schema") or "").casefold(),
            str(item["name"]).casefold(),
        )
    )
    return normalized


def _relation_index(profile: Mapping[str, Any]) -> dict[str, Any]:
    preanalysis = profile.get("preanalysis")
    if isinstance(preanalysis, Mapping):
        value = preanalysis.get("relation_index")
        if isinstance(value, Mapping):
            return dict(value)
    value = profile.get("relation_index")
    return dict(value) if isinstance(value, Mapping) else {}


def _relation_index_hash(relations: list[dict[str, Any]]) -> str:
    return stable_payload_hash(_normalized_relations(relations))


def _relation_contract_hash(entry: Mapping[str, Any]) -> str:
    """Hash only metadata that can change a semantic binding or relationship."""

    return stable_payload_hash(
        {
            "schema": entry.get("schema"),
            "name": entry.get("name"),
            "kind": entry.get("kind"),
            "column_metadata_status": entry.get("column_metadata_status"),
            "constraint_metadata_status": entry.get("constraint_metadata_status"),
            "columns": [
                {
                    key: column.get(key)
                    for key in (
                        "name",
                        "type",
                        "dtype",
                        "nullable",
                        "primary_key",
                        "unique",
                    )
                    if column.get(key) is not None
                }
                for column in entry.get("columns") or []
                if isinstance(column, Mapping)
            ],
            "primary_key": entry.get("primary_key"),
            "unique_constraints": entry.get("unique_constraints"),
            "foreign_keys": entry.get("foreign_keys"),
            "unread_columns_at_least": entry.get("unread_columns_at_least"),
        }
    )


def _source_identity(source: ProjectDataSource) -> str:
    profile = source.profile_data if isinstance(source.profile_data, dict) else {}
    return stable_payload_hash(
        {
            "id": str(source.id),
            "project_id": str(source.project_id),
            "connection_id": str(source.connection_id) if source.connection_id else None,
            "kind": source.kind,
            "fingerprint": source.fingerprint,
            "logical_name": profile.get("logical_name"),
        }
    )


def _connection_identity(connection: Connection) -> str:
    return stable_payload_hash(
        {
            "id": str(connection.id),
            "driver": connection.driver,
            "host": connection.host,
            "port": connection.port,
            "username": connection.username,
            "password": connection.password_encrypted,
            "database": connection.database_name,
            "extra_options": connection.extra_options or {},
        }
    )


def _manager_config(connection: Connection) -> dict[str, Any]:
    return {
        "driver": connection.driver,
        "host": connection.host,
        "port": connection.port,
        "user": connection.username,
        "password": (
            encryptor.decrypt(connection.password_encrypted)
            if connection.password_encrypted
            else ""
        ),
        "database": connection.database_name,
        "extra_options": connection.extra_options or {},
    }


def _resolve_relation(
    requested: str,
    relations: list[dict[str, Any]],
) -> dict[str, Any]:
    marker = requested.strip().casefold()
    if not marker:
        raise SemanticInventoryError(
            "semantic_inventory_table_missing",
            "请选择要整理的表。",
            status_code=422,
        )
    qualified = [item for item in relations if _canonical_relation_name(item).casefold() == marker]
    if qualified:
        if len(qualified) == 1:
            return dict(qualified[0])
        raise SemanticInventoryError(
            "semantic_inventory_table_ambiguous",
            "这张表无法唯一确定，请选择带所属范围的名称。",
            status_code=422,
        )
    bare = [item for item in relations if str(item.get("name") or "").strip().casefold() == marker]
    if len(bare) == 1:
        return dict(bare[0])
    if len(bare) > 1:
        raise SemanticInventoryError(
            "semantic_inventory_table_ambiguous",
            "存在多张同名表，请选择带所属范围的名称。",
            status_code=422,
        )
    raise SemanticInventoryError(
        "semantic_inventory_table_unknown",
        f"没有找到“{requested.strip()}”，请刷新数据目录后再试。",
        status_code=422,
    )


async def _materialize_relation_index(
    connection: Connection,
    *,
    heartbeat: Callable[[], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    manager = create_database_manager(_manager_config(connection))
    after: str | None = None
    relations: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    while True:
        page = await asyncio.wait_for(
            asyncio.to_thread(
                manager.get_bounded_relation_index,
                max_relations=_RELATION_PAGE_SIZE,
                after=after,
            ),
            timeout=_ITEM_TIMEOUT_SECONDS,
        )
        page_relations = _normalized_relations([dict(item) for item in page.relations])
        if heartbeat is not None:
            await heartbeat()
        for relation in page_relations:
            identity = (
                str(relation.get("schema") or "").casefold(),
                str(relation["name"]).casefold(),
            )
            if identity in seen:
                raise SemanticInventoryError(
                    "semantic_inventory_directory_changed",
                    "数据目录在整理时发生变化，请刷新后重试。",
                )
            seen.add(identity)
            relations.append(relation)
        if len(relations) > _MAX_RELATIONS:
            raise SemanticInventoryError(
                "semantic_inventory_directory_too_large",
                "当前数据目录过大，请先选择一部分表。",
                status_code=422,
            )
        if not page.truncated:
            break
        if not page_relations:
            raise SemanticInventoryError(
                "semantic_inventory_directory_changed",
                "数据目录暂时无法完整读取，请稍后重试。",
            )
        next_after = str(page_relations[-1]["name"])
        if after is not None and next_after.casefold() <= after.casefold():
            raise SemanticInventoryError(
                "semantic_inventory_directory_changed",
                "数据目录在整理时发生变化，请刷新后重试。",
            )
        after = next_after
    snapshot = bounded_relation_index_snapshot(
        type(page)(
            relations=relations,
            truncated=False,
            unread_relations_at_least=0,
        )
    )
    return snapshot


def _store_relation_index(
    source: ProjectDataSource,
    snapshot: dict[str, Any],
) -> None:
    profile = dict(source.profile_data or {})
    preanalysis = dict(profile.get("preanalysis") or {})
    preanalysis["relation_index"] = dict(snapshot)
    profile["preanalysis"] = preanalysis
    profile["relation_index"] = dict(snapshot)
    source.profile_data = profile


def _table_reference_candidates(table: Mapping[str, Any]) -> set[str]:
    name = str(table.get("name") or "").strip()
    canonical = _canonical_relation_name(table)
    return {value.casefold() for value in (name, canonical) if value}


def _profile_table_for_reference(
    profile: Mapping[str, Any],
    reference: str,
    *,
    lookup: Mapping[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any] | None:
    marker = reference.strip().casefold()
    resolved_lookup = lookup or _profile_table_lookup(profile)
    matches = list(resolved_lookup.get(marker) or [])
    if len(matches) == 1:
        return matches[0]
    qualified_matches = [
        table for table in matches if _canonical_relation_name(table).casefold() == marker
    ]
    return qualified_matches[0] if len(qualified_matches) == 1 else None


def _profile_table_lookup(
    profile: Mapping[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    lookup: dict[str, list[dict[str, Any]]] = {}
    for raw_table in profile.get("tables") or []:
        if not isinstance(raw_table, Mapping):
            continue
        table = dict(raw_table)
        for alias in _table_reference_candidates(table):
            lookup.setdefault(alias, []).append(table)
    return lookup


def _relationship_scope_tables(
    profile: Mapping[str, Any],
    relation: Mapping[str, Any],
) -> list[str]:
    """Return the current table and only its already-profiled FK neighbors."""

    current = _canonical_relation_name(relation)
    current_aliases = _table_reference_candidates(relation)
    requested = [current]
    table_lookup = _profile_table_lookup(profile)
    relationship_evidence = [
        dict(item)
        for item in (profile.get("preanalysis") or {}).get("relationship_evidence", [])
        if isinstance(item, Mapping)
        and item.get("kind") == "declared_foreign_key"
        and item.get("catalog_verified") is True
        and item.get("binding_complete") is True
    ]
    for evidence in relationship_evidence:
        source = evidence.get("source") or {}
        target = evidence.get("target") or {}
        endpoint_tables = [
            {
                "schema": source.get("schema"),
                "name": source.get("table"),
            },
            {
                "schema": target.get("schema"),
                "name": target.get("table"),
            },
        ]
        if not any(
            current_aliases & _table_reference_candidates(endpoint) for endpoint in endpoint_tables
        ):
            continue
        for endpoint in endpoint_tables:
            canonical = _canonical_relation_name(endpoint)
            table = _profile_table_for_reference(
                profile,
                canonical,
                lookup=table_lookup,
            )
            if table is None or not table.get("columns"):
                continue
            requested.append(_canonical_relation_name(table))
    return list(dict.fromkeys(requested))


def _relationship_scope_batches(table_names: list[str]) -> list[list[str]]:
    if len(table_names) <= 1:
        return []
    current, *neighbors = table_names
    return [[current, *neighbors[offset : offset + 99]] for offset in range(0, len(neighbors), 99)]


def _inventory_context_profile(
    profile: Mapping[str, Any],
    *,
    table_names: list[str],
    include_relation_directory: bool,
) -> dict[str, Any]:
    """Build the bounded metadata view consumed by recommendation generation.

    ``load_project_context`` intentionally compacts ordinary prompt context.  An
    inventory worker has a different, explicit scope, so it restores only the
    requested deep portraits and a metadata-only relation directory.  Business
    rows and connection credentials never enter this view.
    """

    table_lookup = _profile_table_lookup(profile)
    selected_tables = [
        table
        for name in table_names
        if (
            table := _profile_table_for_reference(
                profile,
                name,
                lookup=table_lookup,
            )
        )
        is not None
    ]
    selected_aliases = {
        alias for table in selected_tables for alias in _table_reference_candidates(table)
    }
    raw_preanalysis = dict(profile.get("preanalysis") or {})

    def selected_profile_item(item: Any) -> bool:
        if not isinstance(item, Mapping):
            return False
        reference = str(item.get("table") or "").strip().casefold()
        if not reference:
            return False
        if "." in reference:
            return reference in selected_aliases
        matches = table_lookup.get(reference) or []
        return len(matches) == 1 and bool(
            _table_reference_candidates(matches[0]) & selected_aliases
        )

    relation_index = _relation_index(profile)
    relations = (
        [dict(item) for item in relation_index.get("relations") or [] if isinstance(item, Mapping)]
        if include_relation_directory
        else [
            {
                key: table.get(key)
                for key in ("name", "schema", "kind", "comment", "description")
                if table.get(key) is not None
            }
            for table in selected_tables
        ]
    )
    scoped_index = {
        **relation_index,
        "relations": relations,
        "relations_loaded": (
            relation_index.get("relations_loaded", len(relations))
            if include_relation_directory
            else len(relations)
        ),
    }
    preanalysis = {
        key: value
        for key, value in raw_preanalysis.items()
        if key
        not in {
            "candidate_roles",
            "candidate_grain",
            "relationship_evidence",
            "relation_index",
            "tables",
        }
    }
    preanalysis.update(
        {
            "candidate_roles": [
                dict(item)
                for item in raw_preanalysis.get("candidate_roles") or []
                if selected_profile_item(item)
            ],
            "candidate_grain": [
                dict(item)
                for item in raw_preanalysis.get("candidate_grain") or []
                if selected_profile_item(item)
            ],
            "relationship_evidence": [
                dict(item)
                for item in declared_relationship_evidence(profile)
                if isinstance(item, Mapping)
            ],
            "relation_index": scoped_index,
        }
    )
    return {
        key: value
        for key, value in profile.items()
        if key not in {"tables", "preanalysis", "relation_index"}
    } | {
        "tables": selected_tables,
        "preanalysis": preanalysis,
        "relation_index": scoped_index,
    }


def _install_inventory_context_profile(
    context: Any,
    *,
    source_id: UUID,
    profile: Mapping[str, Any],
    table_names: list[str],
    include_relation_directory: bool = False,
) -> None:
    for source in context.sources:
        if str(source.get("id") or "") != str(source_id):
            continue
        source["profile"] = _inventory_context_profile(
            profile,
            table_names=table_names,
            include_relation_directory=include_relation_directory,
        )
        source["preanalysis"] = source["profile"].get("preanalysis") or {}
        return
    raise SemanticInventoryError(
        "semantic_inventory_source_missing",
        "数据源已不存在，请重新开始。",
        status_code=404,
    )


def _relationship_incident_to(
    definition: RelationshipDefinition,
    relation: Mapping[str, Any],
) -> bool:
    aliases = _table_reference_candidates(relation)
    return any(
        str(endpoint.table_or_view or "").strip().casefold() in aliases
        for endpoint in (definition.left, definition.right)
    )


def _merge_recommendation_batches(
    primary: SemanticRecommendationBatch,
    relationship: SemanticRecommendationBatch,
    *,
    relation: Mapping[str, Any],
    job_table_ordinals: Mapping[str, int],
    current_ordinal: int,
) -> SemanticRecommendationBatch:
    def job_ordinal(reference: str) -> int | None:
        marker = reference.strip().casefold()
        if marker in job_table_ordinals:
            return job_table_ordinals[marker]
        if "." in marker:
            return None
        suffix_matches = [
            ordinal
            for name, ordinal in job_table_ordinals.items()
            if name == marker or name.endswith(f".{marker}")
        ]
        return suffix_matches[0] if len(suffix_matches) == 1 else None

    def owned_by_current(definition: RelationshipDefinition) -> bool:
        endpoint_ordinals = [
            job_ordinal(str(endpoint.table_or_view or ""))
            for endpoint in (definition.left, definition.right)
        ]
        selected_ordinals = [value for value in endpoint_ordinals if value is not None]
        return bool(selected_ordinals) and current_ordinal == max(selected_ordinals)

    incident = [
        item
        for item in relationship.items
        if isinstance(item.definition, RelationshipDefinition)
        and _relationship_incident_to(item.definition, relation)
        and owned_by_current(item.definition)
    ]
    seen = {item.key for item in primary.items}
    merged = [*primary.items]
    merged.extend(item for item in incident if item.key not in seen)
    return SemanticRecommendationBatch(
        batch_id=primary.batch_id,
        generated_by=(
            "ai"
            if primary.generated_by == "ai" or relationship.generated_by == "ai"
            else "preflight"
        ),
        items=merged,
    )


async def create_semantic_inventory_job(
    db: AsyncSession,
    *,
    project_id: UUID,
    source_id: UUID,
    request: SemanticInventoryJobRequest,
) -> SemanticInventoryJob:
    """Validate consent and capture an immutable table selection in one transaction."""

    if await db.get(Project, project_id) is None:
        raise SemanticInventoryError(
            "semantic_inventory_project_missing",
            "项目不存在。",
            status_code=404,
        )
    settings_record = await get_or_create_app_settings(db)
    if not settings_record.self_analysis_enabled:
        raise SemanticInventoryError(
            "semantic_inventory_self_analysis_disabled",
            "请先在设置中允许 ReceiptBI 帮你整理数据含义。",
            status_code=403,
        )
    if request.depth == "sampled" and not settings_record.preprocessing_enabled:
        raise SemanticInventoryError(
            "semantic_inventory_preprocessing_disabled",
            "要查看少量数据内容，请先在设置中允许数据整理。",
            status_code=403,
        )

    source_result = await db.execute(
        select(ProjectDataSource)
        .where(
            ProjectDataSource.id == source_id,
            ProjectDataSource.project_id == project_id,
        )
        .with_for_update()
    )
    source = source_result.scalar_one_or_none()
    if source is None:
        raise SemanticInventoryError(
            "semantic_inventory_source_missing",
            "数据源不存在。",
            status_code=404,
        )
    connection = await _eligible_connection(db, source)

    requested_tables = list(request.tables)
    pending_relation_hash = stable_payload_hash({"state": "pending", "source_id": str(source.id)})
    normalized_selection_tables = sorted(table.strip().casefold() for table in requested_tables)
    selection_hash = stable_payload_hash(
        {
            "source_id": str(source.id),
            "depth": request.depth,
            "locale": request.locale,
            "model_id": str(request.model_id) if request.model_id else None,
            "selection_mode": "selected" if requested_tables else "all",
            "tables": normalized_selection_tables,
        }
    )
    active_result = await db.execute(
        select(SemanticInventoryJob)
        .where(
            SemanticInventoryJob.source_id == source.id,
            SemanticInventoryJob.status.in_(_ACTIVE_STATUSES),
        )
        .order_by(SemanticInventoryJob.created_at.desc())
        .with_for_update()
    )
    active = active_result.scalars().first()
    if active is not None:
        if active.selection_hash == selection_hash:
            return active
        raise SemanticInventoryError(
            "semantic_inventory_already_running",
            "这个数据源正在整理中，请等待完成后再开始新的整理。",
        )

    job = SemanticInventoryJob(
        project_id=project_id,
        source_id=source.id,
        status="queued",
        depth=request.depth,
        locale=request.locale,
        model_id=request.model_id,
        tables=requested_tables,
        relation_index_hash=pending_relation_hash,
        selection_hash=selection_hash,
        details={
            "version": 1,
            "code": "semantic_inventory_queued",
            "source_identity": _source_identity(source),
            "connection_identity": _connection_identity(connection),
            "selection_mode": "selected" if requested_tables else "all",
            "requested_tables": requested_tables,
            "inventory_prepared": False,
            "retryable": False,
        },
    )
    db.add(job)
    await db.flush()
    for ordinal, table_name in enumerate(requested_tables):
        db.add(
            SemanticInventoryJobItem(
                job_id=job.id,
                ordinal=ordinal,
                table_name=table_name,
                status="queued",
                phase="structure",
                attempt_count=0,
                retryable=True,
                profile_result={},
                candidate_count=0,
            )
        )
    await db.flush()
    return job


async def _eligible_connection(
    db: AsyncSession,
    source: ProjectDataSource,
) -> Connection:
    profile = dict(source.profile_data or {})
    if (
        source.kind != "connection"
        or source.status != "ready"
        or profile.get("is_current") is False
        or profile.get("activation_state") == "pending_confirmation"
        or source.connection_id is None
    ):
        raise SemanticInventoryError(
            "semantic_inventory_source_not_ready",
            "这个数据源还没有准备好，请先完成数据检查。",
        )
    connection = await db.get(Connection, source.connection_id)
    if connection is None:
        raise SemanticInventoryError(
            "semantic_inventory_connection_missing",
            "当前无法连接这个数据源，请检查连接后重试。",
        )
    return connection


async def _assert_source_identity(
    source: ProjectDataSource,
    connection: Connection,
    *,
    source_identity: str,
    connection_identity: str,
) -> None:
    profile = dict(source.profile_data or {})
    if (
        source.kind != "connection"
        or source.status != "ready"
        or profile.get("is_current") is False
        or profile.get("activation_state") == "pending_confirmation"
        or source.connection_id != connection.id
        or _source_identity(source) != source_identity
        or _connection_identity(connection) != connection_identity
    ):
        raise SemanticInventoryError(
            "semantic_inventory_source_changed",
            "数据源在整理期间发生了变化，请重新开始。",
        )


async def get_semantic_inventory_job(
    db: AsyncSession,
    *,
    project_id: UUID,
    source_id: UUID,
    job_id: UUID,
) -> SemanticInventoryJob:
    result = await db.execute(
        select(SemanticInventoryJob).where(
            SemanticInventoryJob.id == job_id,
            SemanticInventoryJob.project_id == project_id,
            SemanticInventoryJob.source_id == source_id,
        )
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise SemanticInventoryError(
            "semantic_inventory_job_missing",
            "没有找到这次整理记录。",
            status_code=404,
        )
    return job


async def get_current_semantic_inventory_job(
    db: AsyncSession,
    *,
    project_id: UUID,
    source_id: UUID,
) -> SemanticInventoryJob:
    result = await db.execute(
        select(SemanticInventoryJob)
        .where(
            SemanticInventoryJob.project_id == project_id,
            SemanticInventoryJob.source_id == source_id,
        )
        .order_by(SemanticInventoryJob.created_at.desc())
        .limit(1)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise SemanticInventoryError(
            "semantic_inventory_job_missing",
            "还没有整理记录。",
            status_code=404,
        )
    return job


async def semantic_inventory_job_response(
    db: AsyncSession,
    job: SemanticInventoryJob,
) -> SemanticInventoryJobResponse:
    count_result = await db.execute(
        select(
            SemanticInventoryJobItem.status,
            func.count(SemanticInventoryJobItem.id),
        )
        .where(SemanticInventoryJobItem.job_id == job.id)
        .group_by(SemanticInventoryJobItem.status)
    )
    counts = Counter({status: count for status, count in count_result.all()})
    aggregate_result = await db.execute(
        select(
            func.coalesce(func.sum(SemanticInventoryJobItem.candidate_count), 0),
            func.count(SemanticInventoryJobItem.id).filter(
                SemanticInventoryJobItem.status == "succeeded",
                SemanticInventoryJobItem.recommendation_batch_id.is_not(None),
            ),
        ).where(SemanticInventoryJobItem.job_id == job.id)
    )
    candidate_count, reviewable_count = aggregate_result.one()
    next_review_result = await db.execute(
        select(SemanticInventoryJobItem)
        .where(
            SemanticInventoryJobItem.job_id == job.id,
            SemanticInventoryJobItem.status == "succeeded",
            SemanticInventoryJobItem.recommendation_batch_id.is_not(None),
        )
        .order_by(SemanticInventoryJobItem.ordinal)
        .limit(1)
    )
    next_review_item = next_review_result.scalar_one_or_none()
    failed_result = await db.execute(
        select(SemanticInventoryJobItem)
        .where(
            SemanticInventoryJobItem.job_id == job.id,
            SemanticInventoryJobItem.status == "failed",
        )
        .order_by(SemanticInventoryJobItem.ordinal)
        .limit(3)
    )
    failed_items = list(failed_result.scalars())
    total = sum(counts.values())
    payload: dict[str, Any] = {
        "id": job.id,
        "project_id": job.project_id,
        "source_id": job.source_id,
        "status": job.status,
        "depth": job.depth,
        "locale": job.locale,
        "model_id": job.model_id,
        "candidate_count": int(candidate_count or 0)
        + int((job.details or {}).get("source_recommendation_count") or 0),
        "reviewable_count": int(reviewable_count or 0),
        "next_review_item": (
            SemanticInventoryJobItemResponse.model_validate(next_review_item)
            if next_review_item is not None
            else None
        ),
        "failed_item_preview": [
            SemanticInventoryJobItemResponse.model_validate(item) for item in failed_items
        ],
        "tables": [],
        "progress": SemanticInventoryJobProgress(
            total=total,
            queued=counts["queued"],
            running=counts["running"],
            succeeded=counts["succeeded"],
            failed=counts["failed"],
            cancelled=counts["cancelled"],
        ),
        "items": [],
        "created_at": job.created_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
    }
    if "retryable" in SemanticInventoryJobResponse.model_fields:
        payload["retryable"] = bool((job.details or {}).get("retryable"))
    return SemanticInventoryJobResponse.model_validate(payload)


async def semantic_inventory_job_items_response(
    db: AsyncSession,
    job: SemanticInventoryJob,
    *,
    limit: int = 20,
    after_ordinal: int | None = None,
    table: str | None = None,
    reviewable: bool = False,
) -> SemanticInventoryJobItemPageResponse:
    if not 1 <= limit <= 100:
        raise SemanticInventoryError(
            "semantic_inventory_page_invalid",
            "每次最多查看 100 张表。",
            status_code=422,
        )
    if after_ordinal is not None and after_ordinal < 0:
        raise SemanticInventoryError(
            "semantic_inventory_page_invalid",
            "翻页位置无效。",
            status_code=422,
        )

    resolved_table: str | None = None
    if table is not None and table.strip():
        marker = table.strip()
        if "." in marker:
            exact_result = await db.execute(
                select(SemanticInventoryJobItem.table_name)
                .where(
                    SemanticInventoryJobItem.job_id == job.id,
                    func.lower(SemanticInventoryJobItem.table_name) == marker.casefold(),
                )
                .limit(1)
            )
            resolved_table = exact_result.scalar_one_or_none()
            if resolved_table is None:
                raise SemanticInventoryError(
                    "semantic_inventory_table_unknown",
                    f"没有找到“{marker}”。",
                    status_code=404,
                )
        else:
            suffix_result = await db.execute(
                select(SemanticInventoryJobItem.table_name)
                .where(
                    SemanticInventoryJobItem.job_id == job.id,
                    (func.lower(SemanticInventoryJobItem.table_name) == marker.casefold())
                    | SemanticInventoryJobItem.table_name.iendswith(
                        f".{marker}",
                        autoescape=True,
                    ),
                )
                .distinct()
                .limit(2)
            )
            matches = list(suffix_result.scalars())
            if len(matches) > 1:
                raise SemanticInventoryError(
                    "semantic_inventory_table_ambiguous",
                    "存在多张同名表，请使用带所属范围的完整名称。",
                    status_code=409,
                )
            if not matches:
                raise SemanticInventoryError(
                    "semantic_inventory_table_unknown",
                    f"没有找到“{marker}”。",
                    status_code=404,
                )
            resolved_table = matches[0]

    query = select(SemanticInventoryJobItem).where(SemanticInventoryJobItem.job_id == job.id)
    if after_ordinal is not None:
        query = query.where(SemanticInventoryJobItem.ordinal > after_ordinal)
    if resolved_table is not None:
        query = query.where(
            func.lower(SemanticInventoryJobItem.table_name) == resolved_table.casefold()
        )
    if reviewable:
        query = query.where(
            SemanticInventoryJobItem.status == "succeeded",
            SemanticInventoryJobItem.recommendation_batch_id.is_not(None),
        )
    result = await db.execute(query.order_by(SemanticInventoryJobItem.ordinal).limit(limit + 1))
    rows = list(result.scalars())
    has_more = len(rows) > limit
    page_items = rows[:limit]
    return SemanticInventoryJobItemPageResponse(
        job_id=job.id,
        items=[SemanticInventoryJobItemResponse.model_validate(item) for item in page_items],
        next_after_ordinal=(page_items[-1].ordinal if has_more and page_items else None),
        has_more=has_more,
    )


async def request_semantic_inventory_cancel(
    db: AsyncSession,
    *,
    project_id: UUID,
    source_id: UUID,
    job_id: UUID,
) -> SemanticInventoryJob:
    job = await get_semantic_inventory_job(
        db,
        project_id=project_id,
        source_id=source_id,
        job_id=job_id,
    )
    if job.status in _TERMINAL_STATUSES:
        return job
    job.cancel_requested = True
    item_result = await db.execute(
        select(SemanticInventoryJobItem).where(
            SemanticInventoryJobItem.job_id == job.id,
            SemanticInventoryJobItem.status == "queued",
        )
    )
    now = _utcnow()
    for item in item_result.scalars():
        item.status = "cancelled"
        item.code = "semantic_inventory_cancelled"
        item.message = "已停止整理这张表。"
        item.completed_at = now
    if job.status == "queued":
        job.status = "cancelled"
        job.completed_at = now
        job.lease_owner = None
        job.lease_expires_at = None
    await db.flush()
    return job


async def retry_semantic_inventory_job(
    db: AsyncSession,
    *,
    project_id: UUID,
    source_id: UUID,
    job_id: UUID,
) -> SemanticInventoryJob:
    job = await get_semantic_inventory_job(
        db,
        project_id=project_id,
        source_id=source_id,
        job_id=job_id,
    )
    if job.status not in {"completed_with_errors", "failed"}:
        raise SemanticInventoryError(
            "semantic_inventory_retry_unavailable",
            "当前没有可重试的失败项。",
        )
    if job.status == "failed" and dict(job.details or {}).get("retryable") is False:
        raise SemanticInventoryError(
            "semantic_inventory_retry_unavailable",
            "这次整理所依据的数据已经变化，请重新开始。",
        )
    source = await db.get(ProjectDataSource, source_id)
    if source is None:
        raise SemanticInventoryError(
            "semantic_inventory_source_missing",
            "数据源不存在。",
            status_code=404,
        )
    connection = await _eligible_connection(db, source)
    if dict(job.details or {}).get("inventory_prepared") is True:
        await _assert_job_snapshot(job, source, connection)
    else:
        details = dict(job.details or {})
        await _assert_source_identity(
            source,
            connection,
            source_identity=str(details.get("source_identity") or ""),
            connection_identity=str(details.get("connection_identity") or ""),
        )
    active_result = await db.execute(
        select(SemanticInventoryJob.id).where(
            SemanticInventoryJob.source_id == source_id,
            SemanticInventoryJob.status.in_(_ACTIVE_STATUSES),
            SemanticInventoryJob.id != job.id,
        )
    )
    if active_result.scalar_one_or_none() is not None:
        raise SemanticInventoryError(
            "semantic_inventory_already_running",
            "这个数据源正在整理中，请等待完成后再重试。",
        )
    item_result = await db.execute(
        select(SemanticInventoryJobItem).where(
            SemanticInventoryJobItem.job_id == job.id,
            SemanticInventoryJobItem.status == "failed",
            SemanticInventoryJobItem.retryable.is_(True),
        )
    )
    items = list(item_result.scalars())
    if not items and not (
        job.status == "failed" and dict(job.details or {}).get("retryable") is True
    ):
        raise SemanticInventoryError(
            "semantic_inventory_retry_unavailable",
            "当前没有可重试的失败项。",
        )
    for item in items:
        item.status = "queued"
        item.phase = "structure"
        item.next_attempt_at = None
        item.code = None
        item.message = None
        item.started_at = None
        item.completed_at = None
    job.status = "queued"
    job.cancel_requested = False
    job.lease_owner = None
    job.lease_expires_at = None
    job.heartbeat_at = None
    job.completed_at = None
    retry_details = {
        key: value
        for key, value in dict(job.details or {}).items()
        if key
        not in {
            "source_recommendation_batch_id",
            "source_recommendation_count",
        }
    }
    job.details = {
        **retry_details,
        "code": "semantic_inventory_retry_queued",
        "retryable": False,
    }
    await db.flush()
    return job


def _session_factory(
    supplied: async_sessionmaker[AsyncSession] | None,
) -> async_sessionmaker[AsyncSession]:
    return supplied or AsyncSessionLocal


def schedule_semantic_inventory_job(
    job_id: UUID,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> asyncio.Task[None]:
    task = asyncio.create_task(run_semantic_inventory_job(job_id, session_factory))
    _scheduled_tasks.add(task)
    task.add_done_callback(_scheduled_tasks.discard)
    return task


async def recover_semantic_inventory_jobs(db: AsyncSession) -> list[UUID]:
    """Requeue work abandoned by the previous process and return all runnable IDs."""

    result = await db.execute(
        select(SemanticInventoryJob)
        .where(SemanticInventoryJob.status.in_(_ACTIVE_STATUSES))
        .order_by(SemanticInventoryJob.created_at)
        .with_for_update()
    )
    jobs = list(result.scalars())
    now = _utcnow()
    for job in jobs:
        if job.cancel_requested:
            item_result = await db.execute(
                select(SemanticInventoryJobItem).where(
                    SemanticInventoryJobItem.job_id == job.id,
                    SemanticInventoryJobItem.status.in_(("queued", "running")),
                )
            )
            for item in item_result.scalars():
                item.status = "cancelled"
                item.retryable = False
                item.code = "semantic_inventory_cancelled"
                item.message = "已停止整理这张表。"
                item.completed_at = now
            job.status = "cancelled"
            job.completed_at = now
            job.lease_owner = None
            job.lease_expires_at = None
            job.heartbeat_at = now
            continue
        if job.status == "running":
            item_result = await db.execute(
                select(SemanticInventoryJobItem).where(
                    SemanticInventoryJobItem.job_id == job.id,
                    SemanticInventoryJobItem.status == "running",
                )
            )
            for item in item_result.scalars():
                item.status = "queued"
                item.code = None
                item.message = None
                item.started_at = None
                item.completed_at = None
            job.status = "queued"
            job.details = {
                **dict(job.details or {}),
                "code": "semantic_inventory_recovered",
                "recovered_at": now.isoformat(),
            }
        job.lease_owner = None
        job.lease_expires_at = None
        job.heartbeat_at = None
    await db.flush()
    return [job.id for job in jobs if job.status == "queued"]


async def run_semantic_inventory_job(
    job_id: UUID,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> None:
    """Claim and run one job serially; each table commits independently."""

    factory = _session_factory(session_factory)
    worker_id = f"semantic-inventory:{uuid4()}"
    try:
        claimed = await _claim_job_with_retry(
            factory,
            job_id=job_id,
            worker_id=worker_id,
        )
        if claimed is None:
            return
        item_ids = await _prepare_job_items(
            factory,
            job_id=job_id,
            worker_id=worker_id,
        )
        for item_id in item_ids:
            if await _job_cancelled(factory, job_id):
                break
            await _heartbeat(factory, job_id=job_id, worker_id=worker_id)
            await _run_inventory_item(
                factory,
                job_id=job_id,
                item_id=item_id,
                worker_id=worker_id,
            )
        if not await _job_cancelled(factory, job_id):
            await _finalize_source_presentation(
                factory,
                job_id=job_id,
                worker_id=worker_id,
            )
        await _finish_job(factory, job_id=job_id, worker_id=worker_id)
    except Exception as exc:  # noqa: BLE001 - durable job-level containment
        logger.exception(
            "Semantic inventory job failed",
            job_id=str(job_id),
            error_type=type(exc).__name__,
        )
        async with factory() as db:
            job = await db.get(SemanticInventoryJob, job_id)
            if job is not None and job.status in _ACTIVE_STATUSES:
                cancelled = isinstance(exc, _InventoryItemError) and exc.cancelled
                retryable = _job_error_retryable(exc)
                job.status = "cancelled" if cancelled else "failed"
                job.completed_at = _utcnow()
                job.lease_owner = None
                job.lease_expires_at = None
                item_result = await db.execute(
                    select(SemanticInventoryJobItem).where(
                        SemanticInventoryJobItem.job_id == job.id,
                        SemanticInventoryJobItem.status.in_(("queued", "running")),
                    )
                )
                for item in item_result.scalars():
                    item.status = "cancelled" if cancelled else "failed"
                    item.retryable = retryable
                    item.code = (
                        "semantic_inventory_cancelled"
                        if cancelled
                        else "semantic_inventory_job_failed"
                    )
                    item.message = (
                        "已停止整理这张表。"
                        if cancelled
                        else "这张表暂时没有整理成功，可以稍后重试。"
                    )
                    item.completed_at = job.completed_at
                job.details = {
                    **dict(job.details or {}),
                    "code": (
                        "semantic_inventory_cancelled"
                        if cancelled
                        else getattr(exc, "code", "semantic_inventory_job_failed")
                    ),
                    "error_type": type(exc).__name__,
                    "retryable": retryable,
                }
                await db.commit()
        return


async def _claim_job_with_retry(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    worker_id: str,
) -> list[UUID] | None:
    """Absorb short database contention without abandoning a queued job."""

    delays = (0.0, 0.1, 0.3, 1.0)
    for attempt, delay in enumerate(delays):
        if delay:
            await asyncio.sleep(delay)
        try:
            return await _claim_job(
                factory,
                job_id=job_id,
                worker_id=worker_id,
            )
        except Exception:  # noqa: BLE001 - retry only the short claim boundary
            if attempt == len(delays) - 1:
                raise
            logger.info(
                "Semantic inventory claim will retry",
                job_id=str(job_id),
                attempt=attempt + 1,
            )
    return None


async def _claim_job(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    worker_id: str,
) -> list[UUID] | None:
    async with factory() as db:
        result = await db.execute(
            select(SemanticInventoryJob).where(SemanticInventoryJob.id == job_id).with_for_update()
        )
        job = result.scalar_one_or_none()
        if job is None or job.status != "queued" or job.cancel_requested:
            return None
        now = _utcnow()
        job.status = "running"
        job.started_at = job.started_at or now
        job.lease_owner = worker_id
        job.heartbeat_at = now
        job.lease_expires_at = now + timedelta(seconds=_LEASE_SECONDS)
        job.details = {**dict(job.details or {}), "code": "semantic_inventory_running"}
        item_result = await db.execute(
            select(SemanticInventoryJobItem.id)
            .where(
                SemanticInventoryJobItem.job_id == job.id,
                SemanticInventoryJobItem.status == "queued",
            )
            .order_by(SemanticInventoryJobItem.ordinal)
        )
        item_ids = list(item_result.scalars())
        await db.commit()
        return item_ids


async def _prepare_job_items(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    worker_id: str,
) -> list[UUID]:
    """Discover the fresh directory after the HTTP request has already returned."""

    async with factory() as db:
        job = await db.get(SemanticInventoryJob, job_id)
        if job is None or job.status != "running" or job.lease_owner != worker_id:
            raise _InventoryItemError(
                "semantic_inventory_lease_lost",
                "整理任务已由另一个工作进程接管。",
                retryable=True,
            )
        details = dict(job.details or {})
        if details.get("inventory_prepared") is True:
            item_result = await db.execute(
                select(SemanticInventoryJobItem.id)
                .where(
                    SemanticInventoryJobItem.job_id == job.id,
                    SemanticInventoryJobItem.status == "queued",
                )
                .order_by(SemanticInventoryJobItem.ordinal)
            )
            return list(item_result.scalars())
        existing_result = await db.execute(
            select(SemanticInventoryJobItem)
            .where(SemanticInventoryJobItem.job_id == job.id)
            .order_by(SemanticInventoryJobItem.ordinal)
        )
        existing_items = list(existing_result.scalars())
        requested_tables = [
            str(item).strip() for item in details.get("requested_tables") or [] if str(item).strip()
        ]
        if existing_items and len(existing_items) != len(requested_tables):
            raise SemanticInventoryError(
                "semantic_inventory_snapshot_incomplete",
                "这次整理的准备记录不完整，请重新开始。",
            )
        source = await db.get(ProjectDataSource, job.source_id)
        if source is None:
            raise SemanticInventoryError(
                "semantic_inventory_source_missing",
                "数据源已不存在，请重新开始。",
                status_code=404,
            )
        connection = await _eligible_connection(db, source)
        await _assert_source_identity(
            source,
            connection,
            source_identity=str(details.get("source_identity") or ""),
            connection_identity=str(details.get("connection_identity") or ""),
        )
        connection_id = connection.id

    snapshot = await _materialize_relation_index(
        connection,
        heartbeat=lambda: _heartbeat(
            factory,
            job_id=job_id,
            worker_id=worker_id,
        ),
    )
    relations = _normalized_relations([dict(item) for item in snapshot.get("relations") or []])
    if not relations:
        raise SemanticInventoryError(
            "semantic_inventory_empty_source",
            "当前数据源中没有可整理的表。",
            status_code=422,
        )

    async with factory() as db:
        result = await db.execute(
            select(SemanticInventoryJob).where(SemanticInventoryJob.id == job_id).with_for_update()
        )
        job = result.scalar_one_or_none()
        if job is None or job.status != "running" or job.lease_owner != worker_id:
            raise _InventoryItemError(
                "semantic_inventory_lease_lost",
                "整理任务已由另一个工作进程接管。",
                retryable=True,
            )
        if job.cancel_requested:
            raise _InventoryItemError(
                "semantic_inventory_cancelled",
                "已停止这次整理。",
                retryable=False,
                cancelled=True,
            )
        details = dict(job.details or {})
        source = await db.get(ProjectDataSource, job.source_id)
        connection = await db.get(Connection, connection_id)
        if source is None or connection is None:
            raise SemanticInventoryError(
                "semantic_inventory_source_missing",
                "数据源已不存在，请重新开始。",
                status_code=404,
            )
        await _assert_source_identity(
            source,
            connection,
            source_identity=str(details.get("source_identity") or ""),
            connection_identity=str(details.get("connection_identity") or ""),
        )
        requested_tables = [
            str(item).strip() for item in details.get("requested_tables") or [] if str(item).strip()
        ]
        selected_relations = (
            [_resolve_relation(table, relations) for table in requested_tables]
            if requested_tables
            else relations
        )
        canonical_tables = [_canonical_relation_name(relation) for relation in selected_relations]
        if len({value.casefold() for value in canonical_tables}) != len(canonical_tables):
            raise SemanticInventoryError(
                "semantic_inventory_table_ambiguous",
                "所选表中存在无法区分的同名项。",
                status_code=422,
            )
        relation_hash = _relation_index_hash(relations)
        _store_relation_index(source, snapshot)
        job.tables = canonical_tables
        job.relation_index_hash = relation_hash
        job.details = {
            **details,
            "code": "semantic_inventory_running",
            "inventory_prepared": True,
            "relations_total": len(relations),
        }
        existing_result = await db.execute(
            select(SemanticInventoryJobItem)
            .where(SemanticInventoryJobItem.job_id == job.id)
            .order_by(SemanticInventoryJobItem.ordinal)
        )
        existing_items = list(existing_result.scalars())
        item_ids: list[UUID] = []
        if existing_items:
            if len(existing_items) != len(canonical_tables):
                raise SemanticInventoryError(
                    "semantic_inventory_snapshot_incomplete",
                    "这次整理的准备记录不完整，请重新开始。",
                )
            for item, table_name in zip(existing_items, canonical_tables, strict=True):
                item.table_name = table_name
                item_ids.append(item.id)
        else:
            new_items: list[SemanticInventoryJobItem] = []
            for ordinal, table_name in enumerate(canonical_tables):
                item = SemanticInventoryJobItem(
                    job_id=job.id,
                    ordinal=ordinal,
                    table_name=table_name,
                    status="queued",
                    phase="structure",
                    attempt_count=0,
                    retryable=True,
                    profile_result={},
                    candidate_count=0,
                )
                new_items.append(item)
            db.add_all(new_items)
            await db.flush()
            item_ids.extend(item.id for item in new_items)
        await db.commit()
        return item_ids


async def _heartbeat(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    worker_id: str,
) -> None:
    async with factory() as db:
        job = await db.get(SemanticInventoryJob, job_id)
        if job is None or job.status != "running" or job.lease_owner != worker_id:
            raise _InventoryItemError(
                "semantic_inventory_lease_lost",
                "整理任务已由另一个工作进程接管。",
                retryable=True,
            )
        settings_record = await get_or_create_app_settings(db)
        settings_disabled = not settings_record.self_analysis_enabled or (
            job.depth == "sampled" and not settings_record.preprocessing_enabled
        )
        if job.cancel_requested or settings_disabled:
            job.cancel_requested = True
            await db.commit()
            raise _InventoryItemError(
                "semantic_inventory_cancelled",
                "已按当前设置停止这次整理。",
                retryable=False,
                cancelled=True,
            )
        now = _utcnow()
        job.heartbeat_at = now
        job.lease_expires_at = now + timedelta(seconds=_LEASE_SECONDS)
        await db.commit()


async def _job_cancelled(
    factory: async_sessionmaker[AsyncSession],
    job_id: UUID,
) -> bool:
    async with factory() as db:
        job = await db.get(SemanticInventoryJob, job_id)
        return job is None or job.cancel_requested or job.status != "running"


async def _run_inventory_item(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    item_id: UUID,
    worker_id: str,
) -> None:
    try:
        inputs = await _start_item(factory, job_id=job_id, item_id=item_id)
        if inputs is None:
            return
        (
            relation,
            manager_config,
            depth,
            locale,
            model_id,
            project_id,
            source_id,
        ) = inputs
        manager = create_database_manager(manager_config)
        bare_name = str(relation["name"])
        canonical_name = _canonical_relation_name(relation)
        if depth == "sampled":
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    profile_selected_database_relation,
                    manager,
                    relation,
                    budget=DatabaseValuePreflightBudget(
                        max_tables=1,
                        max_total_columns=80,
                    ),
                ),
                timeout=_ITEM_TIMEOUT_SECONDS,
            )
            catalog_entry = dict(result.catalog_entry)
            portrait: dict[str, Any] | None = dict(result.portrait)
        else:
            catalog_entry = await asyncio.wait_for(
                asyncio.to_thread(
                    manager.get_bounded_relation_schema,
                    bare_name,
                    max_columns=_MAX_STRUCTURE_COLUMNS,
                ),
                timeout=_ITEM_TIMEOUT_SECONDS,
            )
            portrait = None
        catalog_entry.update(
            {
                key: relation.get(key)
                for key in ("name", "schema", "kind", "comment", "description")
                if relation.get(key) is not None
            }
        )
        relation_contract_hash = _relation_contract_hash(catalog_entry)
        await _heartbeat(factory, job_id=job_id, worker_id=worker_id)
        await _persist_profile_result(
            factory,
            job_id=job_id,
            item_id=item_id,
            relation=relation,
            catalog_entry=catalog_entry,
            portrait=portrait,
        )
        # Settings may change while a table is being inspected. Recheck before
        # any model contact so turning the feature off takes effect immediately.
        await _heartbeat(factory, job_id=job_id, worker_id=worker_id)

        async with factory() as db:
            source = await db.get(ProjectDataSource, source_id)
            if source is None:
                raise _InventoryItemError(
                    "semantic_inventory_source_missing",
                    "数据源已不存在，请重新开始。",
                    retryable=False,
                )
            profile = _merged_table_profile_data(
                source.profile_data or {},
                relation=relation,
                catalog_entry=catalog_entry,
                portrait=portrait,
            )
            relationship_tables = _relationship_scope_tables(profile, relation)
            job_item_result = await db.execute(
                select(
                    SemanticInventoryJobItem.table_name,
                    SemanticInventoryJobItem.ordinal,
                ).where(SemanticInventoryJobItem.job_id == job_id)
            )
            job_table_ordinals = {
                str(table_name).casefold(): int(ordinal)
                for table_name, ordinal in job_item_result.all()
            }
            current_item = await db.get(SemanticInventoryJobItem, item_id)
            if current_item is None:
                raise _InventoryItemError(
                    "semantic_inventory_item_changed",
                    "这张表的整理状态发生了变化。",
                    retryable=True,
                )
            current_ordinal = current_item.ordinal
            context = await load_project_context(db, project_id)
            _install_inventory_context_profile(
                context,
                source_id=source_id,
                profile=profile,
                table_names=[canonical_name],
            )
            enhancer = await build_semantic_recommendation_enhancer(
                db,
                locale=locale,
                model_id=model_id,
            )
            await db.commit()
        batch = await generate_semantic_recommendations(
            context,
            [SemanticRecommendationScope(source_id=source_id, tables=[canonical_name])],
            locale=locale,
            limit=242,
            batch_id=uuid4(),
            enhancer=enhancer,
            mode="structure" if depth == "structure" else "full",
            include_source_presentation=False,
        )
        for relationship_scope in _relationship_scope_batches(relationship_tables):
            _install_inventory_context_profile(
                context,
                source_id=source_id,
                profile=profile,
                table_names=relationship_scope,
            )
            relationship_batch = await generate_semantic_recommendations(
                context,
                [
                    SemanticRecommendationScope(
                        source_id=source_id,
                        tables=relationship_scope,
                    )
                ],
                locale=locale,
                limit=242,
                batch_id=batch.batch_id,
                enhancer=enhancer,
                mode="relationships",
                include_source_presentation=False,
                include_table_presentations=False,
            )
            batch = _merge_recommendation_batches(
                batch,
                relationship_batch,
                relation=relation,
                job_table_ordinals=job_table_ordinals,
                current_ordinal=current_ordinal,
            )
        await _heartbeat(factory, job_id=job_id, worker_id=worker_id)
        latest_catalog_entry = await asyncio.wait_for(
            asyncio.to_thread(
                manager.get_bounded_relation_schema,
                bare_name,
                max_columns=_MAX_STRUCTURE_COLUMNS,
            ),
            timeout=_ITEM_TIMEOUT_SECONDS,
        )
        latest_catalog_entry.update(
            {
                key: relation.get(key)
                for key in ("name", "schema", "kind", "comment", "description")
                if relation.get(key) is not None
            }
        )
        if _relation_contract_hash(latest_catalog_entry) != relation_contract_hash:
            raise _InventoryItemError(
                "semantic_inventory_table_changed",
                "这张表在整理期间发生了变化，请重试后再核对建议。",
                retryable=True,
            )
        await _heartbeat(factory, job_id=job_id, worker_id=worker_id)
        await _persist_item_candidates(
            factory,
            job_id=job_id,
            item_id=item_id,
            project_id=project_id,
            batch=batch,
            locale=locale,
            profile_result={
                "table": _canonical_relation_name(relation),
                "columns": len(catalog_entry.get("columns") or []),
                "sampled": depth == "sampled",
            },
            relation=relation,
            catalog_entry=catalog_entry,
            portrait=portrait,
        )
    except _InventoryItemError as exc:
        await _finish_item_error(factory, item_id=item_id, error=exc)
    except (SemanticRecommendationError, SemanticScopeResolutionError) as exc:
        await _finish_item_error(
            factory,
            item_id=item_id,
            error=_InventoryItemError(
                "semantic_inventory_recommendation_unavailable",
                "这张表的业务含义暂时无法整理，请核对后重试。",
                retryable=True,
            ),
        )
        logger.info(
            "Semantic inventory recommendation unavailable",
            item_id=str(item_id),
            error_type=type(exc).__name__,
        )
    except Exception as exc:  # noqa: BLE001 - one table must not stop the job
        await _finish_item_error(
            factory,
            item_id=item_id,
            error=_InventoryItemError(
                "semantic_inventory_table_failed",
                "这张表暂时没有整理成功，可以稍后重试。",
                retryable=True,
            ),
        )
        logger.info(
            "Semantic inventory item failed",
            item_id=str(item_id),
            error_type=type(exc).__name__,
        )


async def _start_item(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    item_id: UUID,
) -> (
    tuple[
        dict[str, Any],
        dict[str, Any],
        str,
        str,
        UUID | None,
        UUID,
        UUID,
    ]
    | None
):
    async with factory() as db:
        job = await db.get(SemanticInventoryJob, job_id)
        item = await db.get(SemanticInventoryJobItem, item_id)
        if job is None or item is None or item.status != "queued":
            return None
        if job.cancel_requested:
            item.status = "cancelled"
            item.code = "semantic_inventory_cancelled"
            item.message = "已停止整理这张表。"
            item.completed_at = _utcnow()
            await db.commit()
            return None
        source = await db.get(ProjectDataSource, job.source_id)
        if source is None:
            raise _InventoryItemError(
                "semantic_inventory_source_missing",
                "数据源已不存在，请重新开始。",
                retryable=False,
            )
        try:
            connection = await _eligible_connection(db, source)
            await _assert_job_snapshot(job, source, connection)
            relation = _resolve_relation(
                item.table_name,
                _normalized_relations(
                    [
                        dict(value)
                        for value in _relation_index(source.profile_data or {}).get("relations", [])
                    ]
                ),
            )
        except SemanticInventoryError as exc:
            raise _InventoryItemError(
                exc.code,
                str(exc),
                retryable=False,
            ) from exc
        item.status = "running"
        item.phase = "structure"
        item.attempt_count += 1
        item.started_at = _utcnow()
        item.completed_at = None
        item.code = None
        item.message = None
        await db.commit()
        return (
            relation,
            _manager_config(connection),
            job.depth,
            job.locale,
            job.model_id,
            job.project_id,
            job.source_id,
        )


async def _assert_job_snapshot(
    job: SemanticInventoryJob,
    source: ProjectDataSource,
    connection: Connection,
) -> None:
    details = dict(job.details or {})
    try:
        await _assert_source_identity(
            source,
            connection,
            source_identity=str(details["source_identity"]),
            connection_identity=str(details["connection_identity"]),
        )
    except (KeyError, SemanticInventoryError) as exc:
        if isinstance(exc, SemanticInventoryError):
            raise
        raise SemanticInventoryError(
            "semantic_inventory_snapshot_missing",
            "这次整理缺少必要的来源记录，请重新开始。",
        ) from exc
    relations = _normalized_relations(
        [dict(item) for item in _relation_index(source.profile_data or {}).get("relations") or []]
    )
    if _relation_index_hash(relations) != job.relation_index_hash:
        raise SemanticInventoryError(
            "semantic_inventory_directory_changed",
            "数据目录在整理期间发生了变化，请重新开始。",
        )


def _merged_table_profile_data(
    profile_data: Mapping[str, Any],
    *,
    relation: dict[str, Any],
    catalog_entry: dict[str, Any],
    portrait: dict[str, Any] | None,
) -> dict[str, Any]:
    profile = dict(profile_data)
    canonical = _canonical_relation_name(relation)
    table_entry = {
        **dict(relation),
        **dict(catalog_entry),
        "name": str(relation["name"]),
        "schema": relation.get("schema"),
        "description": (
            catalog_entry.get("description")
            or relation.get("description")
            or relation.get("comment")
        ),
        "columns": [dict(item) for item in catalog_entry.get("columns") or []],
        "profile_status": "sampled" if portrait is not None else "structure",
    }
    if portrait is not None:
        table_entry["candidate_roles"] = [
            {**dict(item), "table": canonical} for item in portrait.get("candidate_roles") or []
        ]
        table_entry["candidate_grain"] = [
            {**dict(item), "table": canonical} for item in portrait.get("candidate_grain") or []
        ]

    def same_table(value: Mapping[str, Any]) -> bool:
        return (
            str(value.get("schema") or "").casefold()
            == str(relation.get("schema") or "").casefold()
            and str(value.get("name") or "").casefold()
            == str(relation.get("name") or "").casefold()
        )

    tables = [
        dict(item)
        for item in profile.get("tables") or []
        if isinstance(item, Mapping) and not same_table(item)
    ]
    tables.append(table_entry)
    profile["tables"] = tables
    if portrait is not None:
        aliases = {
            str(relation["name"]).casefold(),
            canonical.casefold(),
        }
        preanalysis = dict(profile.get("preanalysis") or {})
        roles = [
            dict(item)
            for item in preanalysis.get("candidate_roles") or []
            if str(item.get("table") or "").casefold() not in aliases
        ]
        roles.extend(table_entry["candidate_roles"])
        grains = [
            dict(item)
            for item in preanalysis.get("candidate_grain") or []
            if str(item.get("table") or "").casefold() not in aliases
        ]
        grains.extend(table_entry["candidate_grain"])
        portraits = [
            dict(item)
            for item in preanalysis.get("tables") or []
            if str(item.get("table") or item.get("name") or "").casefold() not in aliases
        ]
        portraits.append(
            {
                **dict(portrait),
                "table": canonical,
                "candidate_roles": table_entry["candidate_roles"],
                "candidate_grain": table_entry["candidate_grain"],
            }
        )
        preanalysis["candidate_roles"] = roles
        preanalysis["candidate_grain"] = grains
        preanalysis["tables"] = portraits
        profile["preanalysis"] = preanalysis
    preanalysis = dict(profile.get("preanalysis") or {})
    # Rebuild instead of appending so removed/changed constraints cannot leave a
    # stale relationship hint behind. Only fully bound declared FKs survive.
    preanalysis["relationship_evidence"] = []
    profile["preanalysis"] = preanalysis
    preanalysis["relationship_evidence"] = declared_relationship_evidence(profile)
    profile["preanalysis"] = preanalysis
    return profile


def _merge_table_profile(
    source: ProjectDataSource,
    *,
    relation: dict[str, Any],
    catalog_entry: dict[str, Any],
    portrait: dict[str, Any] | None,
) -> None:
    source.profile_data = _merged_table_profile_data(
        source.profile_data or {},
        relation=relation,
        catalog_entry=catalog_entry,
        portrait=portrait,
    )


async def _persist_profile_result(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    item_id: UUID,
    relation: dict[str, Any],
    catalog_entry: dict[str, Any],
    portrait: dict[str, Any] | None,
) -> None:
    async with factory() as db:
        job = await db.get(SemanticInventoryJob, job_id)
        item = await db.get(SemanticInventoryJobItem, item_id)
        if job is None or item is None or item.status != "running":
            raise _InventoryItemError(
                "semantic_inventory_item_changed",
                "这张表的整理状态发生了变化。",
                retryable=True,
            )
        if job.cancel_requested:
            raise _InventoryItemError(
                "semantic_inventory_cancelled",
                "已停止整理这张表。",
                retryable=False,
                cancelled=True,
            )
        source = await db.get(ProjectDataSource, job.source_id)
        if source is None:
            raise _InventoryItemError(
                "semantic_inventory_source_missing",
                "数据源已不存在，请重新开始。",
                retryable=False,
            )
        try:
            connection = await _eligible_connection(db, source)
            await _assert_job_snapshot(job, source, connection)
        except SemanticInventoryError as exc:
            raise _InventoryItemError(
                exc.code,
                str(exc),
                retryable=False,
            ) from exc
        item.phase = "recommend"
        item.profile_result = {
            "table": _canonical_relation_name(relation),
            "columns": len(catalog_entry.get("columns") or []),
            "sampled": portrait is not None,
        }
        await db.commit()


async def _persist_item_candidates(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    item_id: UUID,
    project_id: UUID,
    batch: Any,
    locale: str,
    profile_result: dict[str, Any],
    relation: dict[str, Any],
    catalog_entry: dict[str, Any],
    portrait: dict[str, Any] | None,
) -> None:
    async with factory() as db:
        job = await db.get(SemanticInventoryJob, job_id)
        item = await db.get(SemanticInventoryJobItem, item_id)
        if job is None or item is None or item.status != "running":
            raise _InventoryItemError(
                "semantic_inventory_item_changed",
                "这张表的整理状态发生了变化。",
                retryable=True,
            )
        if job.cancel_requested:
            raise _InventoryItemError(
                "semantic_inventory_cancelled",
                "已停止整理这张表。",
                retryable=False,
                cancelled=True,
            )
        source = await db.get(ProjectDataSource, job.source_id)
        if source is None:
            raise _InventoryItemError(
                "semantic_inventory_source_missing",
                "数据源已不存在，请重新开始。",
                retryable=False,
            )
        try:
            connection = await _eligible_connection(db, source)
            await _assert_job_snapshot(job, source, connection)
        except SemanticInventoryError as exc:
            raise _InventoryItemError(
                exc.code,
                str(exc),
                retryable=False,
            ) from exc
        _merge_table_profile(
            source,
            relation=relation,
            catalog_entry=catalog_entry,
            portrait=portrait,
        )
        entries = await persist_semantic_recommendation_batch(
            db,
            project_id=project_id,
            batch=batch,
            locale=locale,
        )
        item.status = "succeeded"
        item.phase = "complete"
        item.profile_result = profile_result
        item.recommendation_batch_id = batch.batch_id
        item.candidate_count = len(entries)
        item.retryable = False
        item.code = None
        item.message = None
        item.completed_at = _utcnow()
        await db.commit()


async def _finalize_source_presentation(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    worker_id: str,
) -> None:
    """Generate the database-level description once, after table work settles."""

    await _heartbeat(factory, job_id=job_id, worker_id=worker_id)
    async with factory() as db:
        job = await db.get(SemanticInventoryJob, job_id)
        if job is None or job.status != "running" or job.lease_owner != worker_id:
            raise _InventoryItemError(
                "semantic_inventory_lease_lost",
                "整理任务已由另一个工作进程接管。",
                retryable=True,
            )
        if dict(job.details or {}).get("source_recommendation_batch_id"):
            return
        item_result = await db.execute(
            select(SemanticInventoryJobItem.table_name)
            .where(
                SemanticInventoryJobItem.job_id == job.id,
                SemanticInventoryJobItem.status == "succeeded",
            )
            .order_by(SemanticInventoryJobItem.ordinal)
        )
        table_names = list(item_result.scalars())
        if not table_names:
            return
        source = await db.get(ProjectDataSource, job.source_id)
        if source is None:
            raise _InventoryItemError(
                "semantic_inventory_source_missing",
                "数据源已不存在，请重新开始。",
                retryable=False,
            )
        try:
            connection = await _eligible_connection(db, source)
            await _assert_job_snapshot(job, source, connection)
        except SemanticInventoryError as exc:
            raise _InventoryItemError(
                exc.code,
                str(exc),
                retryable=False,
            ) from exc
        context = await load_project_context(db, job.project_id)
        _install_inventory_context_profile(
            context,
            source_id=job.source_id,
            profile=dict(source.profile_data or {}),
            table_names=table_names[:100],
            include_relation_directory=True,
        )
        enhancer = await build_semantic_recommendation_enhancer(
            db,
            locale=job.locale,
            model_id=job.model_id,
        )
        project_id = job.project_id
        source_id = job.source_id
        locale = job.locale
        await db.commit()

    # Consent can be withdrawn while the final context is prepared. Never
    # contact the model or persist its suggestion without one last gate.
    await _heartbeat(factory, job_id=job_id, worker_id=worker_id)
    batch = await generate_semantic_recommendations(
        context,
        [
            SemanticRecommendationScope(
                source_id=source_id,
                tables=table_names[:100],
            )
        ],
        locale=locale,
        limit=1,
        batch_id=uuid4(),
        enhancer=enhancer,
        mode="presentation",
        include_source_presentation=True,
        include_table_presentations=False,
    )
    await _heartbeat(factory, job_id=job_id, worker_id=worker_id)
    async with factory() as db:
        job = await db.get(SemanticInventoryJob, job_id)
        if job is None or job.status != "running" or job.lease_owner != worker_id:
            raise _InventoryItemError(
                "semantic_inventory_lease_lost",
                "整理任务已由另一个工作进程接管。",
                retryable=True,
            )
        source = await db.get(ProjectDataSource, source_id)
        if source is None:
            raise _InventoryItemError(
                "semantic_inventory_source_missing",
                "数据源已不存在，请重新开始。",
                retryable=False,
            )
        try:
            connection = await _eligible_connection(db, source)
            await _assert_job_snapshot(job, source, connection)
        except SemanticInventoryError as exc:
            raise _InventoryItemError(
                exc.code,
                str(exc),
                retryable=False,
            ) from exc
        entries = await persist_semantic_recommendation_batch(
            db,
            project_id=project_id,
            batch=batch,
            locale=locale,
        )
        job.details = {
            **dict(job.details or {}),
            "source_recommendation_batch_id": str(batch.batch_id),
            "source_recommendation_count": len(entries),
        }
        await db.commit()


async def _finish_item_error(
    factory: async_sessionmaker[AsyncSession],
    *,
    item_id: UUID,
    error: _InventoryItemError,
) -> None:
    async with factory() as db:
        item = await db.get(SemanticInventoryJobItem, item_id)
        if item is None or item.status not in {"queued", "running"}:
            return
        item.status = "cancelled" if error.cancelled else "failed"
        item.code = error.code
        item.message = str(error)
        item.retryable = error.retryable
        item.completed_at = _utcnow()
        await db.commit()


async def _finish_job(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    worker_id: str,
) -> None:
    async with factory() as db:
        job = await db.get(SemanticInventoryJob, job_id)
        if job is None or job.status != "running" or job.lease_owner != worker_id:
            return
        if job.cancel_requested:
            item_result = await db.execute(
                select(SemanticInventoryJobItem).where(
                    SemanticInventoryJobItem.job_id == job.id,
                    SemanticInventoryJobItem.status.in_(("queued", "running")),
                )
            )
            for item in item_result.scalars():
                item.status = "cancelled"
                item.code = "semantic_inventory_cancelled"
                item.message = "已停止整理这张表。"
                item.completed_at = _utcnow()
        status_result = await db.execute(
            select(SemanticInventoryJobItem.status).where(SemanticInventoryJobItem.job_id == job.id)
        )
        counts = Counter(status_result.scalars())
        retryable_result = await db.execute(
            select(SemanticInventoryJobItem.id).where(
                SemanticInventoryJobItem.job_id == job.id,
                SemanticInventoryJobItem.status == "failed",
                SemanticInventoryJobItem.retryable.is_(True),
            )
        )
        has_retryable_failure = retryable_result.first() is not None
        if job.cancel_requested:
            status = "cancelled"
        elif counts["failed"]:
            status = "completed_with_errors"
        else:
            status = "completed"
        job.status = status
        job.completed_at = _utcnow()
        job.heartbeat_at = job.completed_at
        job.lease_owner = None
        job.lease_expires_at = None
        job.details = {
            **dict(job.details or {}),
            "code": f"semantic_inventory_{status}",
            "succeeded": counts["succeeded"],
            "failed": counts["failed"],
            "cancelled": counts["cancelled"],
            "retryable": status == "completed_with_errors" and has_retryable_failure,
        }
        await db.commit()


__all__ = [
    "SemanticInventoryError",
    "create_semantic_inventory_job",
    "get_current_semantic_inventory_job",
    "get_semantic_inventory_job",
    "recover_semantic_inventory_jobs",
    "request_semantic_inventory_cancel",
    "retry_semantic_inventory_job",
    "run_semantic_inventory_job",
    "schedule_semantic_inventory_job",
    "semantic_inventory_job_items_response",
    "semantic_inventory_job_response",
]
