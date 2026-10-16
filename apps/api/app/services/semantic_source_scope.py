"""Resolve project-understanding entries to their current project data sources.

The resolver deliberately keeps source ownership out of display text.  Executable
semantic definitions bind to stable logical source roles; legacy evidence remains
readable for entries created before those typed contracts existed.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from app.db.tables import ProjectDataSource
from app.services.file_formats import JSON_FILE_FORMATS
from app.services.source_activation import is_current_source

SemanticSourceScope = Literal[
    "project",
    "local_database",
    "remote_database",
    "csv",
    "excel",
    "parquet",
    "json",
    "other_file",
    "cross_source",
    "unresolved",
]
SemanticSourceScopeFilter = SemanticSourceScope | Literal["file"]

_LOCAL_DATABASE_FORMATS = {"sqlite", "sqlite3", "duckdb"}
_EXCEL_FORMATS = {"excel", "xls", "xlsb", "xlsm", "xlsx"}


@dataclass(frozen=True)
class SemanticSourceRefValue:
    source_id: UUID
    logical_name: str
    name: str
    kind: Literal["file", "connection"]
    format: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "logical_name": self.logical_name,
            "name": self.name,
            "kind": self.kind,
            "format": self.format,
        }


@dataclass(frozen=True)
class SemanticSourceResolution:
    source_refs: tuple[SemanticSourceRefValue, ...]
    source_scope: SemanticSourceScope
    # Includes legacy evidence identifiers even when the physical source no
    # longer exists, preserving the existing exact source_id query contract.
    matching_source_ids: frozenset[str]


@dataclass(frozen=True)
class _CatalogSource:
    ref: SemanticSourceRefValue
    scope: SemanticSourceScope


class SemanticSourceCatalog:
    """A request-scoped, current-source index shared by filtering and responses."""

    def __init__(self, sources: Iterable[_CatalogSource]):
        current = tuple(sources)
        self._by_id = {str(item.ref.source_id): item for item in current}
        by_role: dict[tuple[str, str], list[_CatalogSource]] = {}
        for item in current:
            role = (item.ref.kind, _normalize_logical_name(item.ref.logical_name))
            by_role.setdefault(role, []).append(item)
        self._by_role = {key: tuple(value) for key, value in by_role.items()}

    @classmethod
    def from_rows(
        cls,
        rows: Iterable[tuple[ProjectDataSource, str | None]],
    ) -> SemanticSourceCatalog:
        indexed: list[_CatalogSource] = []
        for source, connection_driver in rows:
            if not is_current_source(source) or source.kind not in {"file", "connection"}:
                continue
            kind: Literal["file", "connection"] = "file" if source.kind == "file" else "connection"
            profile_logical_name = str(
                (source.profile_data or {}).get("logical_name") or ""
            ).strip()
            logical_name = profile_logical_name or source.name.strip()
            source_format = (
                connection_driver or source.format if kind == "connection" else source.format
            )
            raw_format = str(source_format or "").strip().casefold()
            display_format = raw_format or None
            ref = SemanticSourceRefValue(
                source_id=source.id,
                logical_name=logical_name,
                name=source.name,
                kind=kind,
                format=display_format,
            )
            indexed.append(
                _CatalogSource(
                    ref=ref,
                    scope=_classify_source_scope(kind, raw_format),
                )
            )
        return cls(indexed)

    def by_id(self, source_id: str) -> _CatalogSource | None:
        return self._by_id.get(source_id)

    def by_role(self, source_kind: str, logical_name: str) -> tuple[_CatalogSource, ...]:
        return self._by_role.get(
            (source_kind, _normalize_logical_name(logical_name)),
            (),
        )


def resolve_semantic_source_scope(
    entry: Any,
    catalog: SemanticSourceCatalog,
) -> SemanticSourceResolution:
    """Resolve one semantic entry without guessing from labels or prose."""

    definition = entry.definition if isinstance(entry.definition, Mapping) else {}
    compatibility_ids = _all_evidence_source_ids(entry.evidence or [])
    has_typed_binding, typed_roles, typed_binding_is_valid = _typed_source_roles(definition)
    if has_typed_binding:
        if not typed_binding_is_valid:
            return _unresolved(compatibility_ids)
        resolved: list[_CatalogSource] = []
        for source_kind, logical_name in typed_roles:
            matches = catalog.by_role(source_kind, logical_name)
            if len(matches) != 1:
                return _unresolved(compatibility_ids)
            resolved.append(matches[0])
        current_ids = {str(item.ref.source_id) for item in resolved}
        return _resolution_from_sources(
            resolved,
            matching_source_ids=current_ids | compatibility_ids,
        )

    evidence = [item for item in (entry.evidence or []) if isinstance(item, Mapping)]
    declarations = [item for item in evidence if item.get("kind") == "user_declaration"]
    if declarations:
        declaration = declarations[-1]
        declared_ids = _evidence_source_ids(declaration)
        if declaration.get("scope") == "project" or not declared_ids:
            return _project()
        return _resolution_from_evidence_ids(declared_ids, catalog)

    evidence_ids = _all_evidence_source_ids(evidence)
    if not evidence_ids:
        return _project()
    return _resolution_from_evidence_ids(evidence_ids, catalog)


def resolution_matches_scope(
    resolution: SemanticSourceResolution,
    source_scope: SemanticSourceScopeFilter,
) -> bool:
    if source_scope == "file":
        return resolution.source_scope in {"csv", "excel", "parquet", "json", "other_file"}
    return resolution.source_scope == source_scope


def _normalize_logical_name(value: str) -> str:
    return value.strip().casefold()


def _classify_source_scope(
    kind: Literal["file", "connection"],
    source_format: str,
) -> SemanticSourceScope:
    if kind == "connection":
        return "local_database" if source_format in _LOCAL_DATABASE_FORMATS else "remote_database"
    if source_format == "csv":
        return "csv"
    if source_format in _EXCEL_FORMATS:
        return "excel"
    if source_format == "parquet":
        return "parquet"
    if source_format in JSON_FILE_FORMATS:
        return "json"
    return "other_file"


def _typed_source_roles(
    definition: Mapping[str, Any],
) -> tuple[bool, tuple[tuple[str, str], ...], bool]:
    kind = definition.get("kind")
    if kind == "relationship" or (kind is None and ("left" in definition or "right" in definition)):
        roles = [_role_from_binding(definition.get(side)) for side in ("left", "right")]
        valid = all(role is not None for role in roles)
        return True, tuple(role for role in roles if role is not None), valid
    if kind in {"aggregate_metric", "dimension"}:
        role = _role_from_binding(definition.get("source"))
        return True, (role,) if role is not None else (), role is not None
    if kind == "derived_metric":
        raw_bindings = definition.get("sources")
        if not isinstance(raw_bindings, list) or not raw_bindings:
            return True, (), False
        roles = [_role_from_binding(binding) for binding in raw_bindings]
        valid = all(role is not None for role in roles)
        return True, tuple(role for role in roles if role is not None), valid
    if kind == "business_rule_strategy":
        applies_to = definition.get("applies_to")
        if applies_to is None or applies_to == []:
            return False, (), True
        bindings = applies_to if isinstance(applies_to, list) else [applies_to]
        roles = [_role_from_binding(binding) for binding in bindings]
        valid = bool(bindings) and all(role is not None for role in roles)
        return True, tuple(role for role in roles if role is not None), valid
    return False, (), True


def _role_from_binding(value: Any) -> tuple[str, str] | None:
    if not isinstance(value, Mapping):
        return None
    source_kind = str(value.get("source_kind") or "").strip()
    logical_name = str(value.get("source_logical_name") or "").strip()
    if source_kind not in {"file", "connection"} or not logical_name:
        return None
    return source_kind, logical_name


def _evidence_source_ids(value: Any) -> set[str]:
    found: set[str] = set()

    def visit(item: Any) -> None:
        if isinstance(item, Mapping):
            for key, nested in item.items():
                if key in {"source_id", "physical_source_id"}:
                    if nested is not None and str(nested).strip():
                        found.add(str(nested).strip())
                elif key == "source_ids" and isinstance(nested, (list, tuple, set)):
                    found.update(
                        str(source_id).strip() for source_id in nested if str(source_id).strip()
                    )
                visit(nested)
        elif isinstance(item, (list, tuple)):
            for nested in item:
                visit(nested)

    visit(value)
    return found


def _all_evidence_source_ids(evidence: Any) -> set[str]:
    found: set[str] = set()
    if not isinstance(evidence, (list, tuple)):
        return found
    for item in evidence:
        if isinstance(item, Mapping):
            found.update(_evidence_source_ids(item))
    return found


def _resolution_from_evidence_ids(
    source_ids: set[str],
    catalog: SemanticSourceCatalog,
) -> SemanticSourceResolution:
    sources = [catalog.by_id(source_id) for source_id in sorted(source_ids)]
    resolved = [source for source in sources if source is not None]
    if len(resolved) != len(source_ids):
        return SemanticSourceResolution(
            source_refs=_dedupe_refs(resolved),
            source_scope="unresolved",
            matching_source_ids=frozenset(source_ids),
        )
    return _resolution_from_sources(resolved, matching_source_ids=source_ids)


def _resolution_from_sources(
    sources: Iterable[_CatalogSource],
    *,
    matching_source_ids: Iterable[str] | None = None,
) -> SemanticSourceResolution:
    current = tuple(sources)
    refs = _dedupe_refs(current)
    resolved_ids = {str(ref.source_id) for ref in refs}
    filter_ids = frozenset(matching_source_ids if matching_source_ids is not None else resolved_ids)
    if not refs:
        return SemanticSourceResolution((), "unresolved", filter_ids)
    if len(refs) > 1:
        scope: SemanticSourceScope = "cross_source"
    else:
        only_id = str(refs[0].source_id)
        scope = next(item.scope for item in current if str(item.ref.source_id) == only_id)
    return SemanticSourceResolution(refs, scope, filter_ids)


def _dedupe_refs(sources: Iterable[_CatalogSource]) -> tuple[SemanticSourceRefValue, ...]:
    by_id = {str(item.ref.source_id): item.ref for item in sources}
    return tuple(
        sorted(
            by_id.values(),
            key=lambda ref: (ref.logical_name.casefold(), ref.name.casefold(), str(ref.source_id)),
        )
    )


def _project() -> SemanticSourceResolution:
    return SemanticSourceResolution((), "project", frozenset())


def _unresolved(
    matching_source_ids: Iterable[str] = (),
) -> SemanticSourceResolution:
    return SemanticSourceResolution((), "unresolved", frozenset(matching_source_ids))
