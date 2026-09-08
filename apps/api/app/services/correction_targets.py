"""Opaque, run-bound targets for report corrections.

The browser receives only a display label and an opaque reference.  The
reference is resolved by rebuilding the target set from persisted, system-owned
run evidence; no internal semantic key is accepted from or disclosed to the UI.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from hmac import compare_digest
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, SemanticEntry
from app.services.business_decision_slots import canonicalize_decision_key
from app.services.checkpoint_contract import stable_payload_hash
from app.services.correction_completion import is_reusable_full_relationship_evidence
from app.services.semantic_learning import discover_metric_column_correction_candidates

_TARGET_REF_DOMAIN = "receiptbi.report-correction-target.v1"
_METRIC_FIELD_REF_DOMAIN = "receiptbi.report-correction.metric-column.v1"
_TYPE_PRIORITY = {
    "business_rule": 0,
    "interpretation": 0,
    "filter_rule": 1,
    "metric_definition": 2,
    "relationship_rule": 3,
}
_DESCRIPTIONS = {
    "business_rule": "本次调查已经应用或确认的业务口径",
    "filter_rule": "本次调查已经应用的筛选口径",
    "metric_definition": "本次调查已经应用的指标口径",
    "relationship_rule": "本次调查已用完整数据验证的关联关系",
    "interpretation": "本次调查中的结论解释",
}


@dataclass(frozen=True)
class ReportCorrectionTarget:
    """Internal target; ``target_key`` must never be serialized to ordinary UI."""

    target_ref: str
    label: str
    description: str
    correction_type: str
    target_key: str


@dataclass(frozen=True)
class MetricColumnCorrectionOption:
    """Server-resolved metric field; ``column`` must never be serialized."""

    field_ref: str
    label: str
    description: str
    column: str
    binding: dict[str, str]


def _clean_text(value: Any, *, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _metric_column_display_label(column: str) -> str:
    """Turn a schema identifier into a presentation label, not an API identity."""

    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", column)
    spaced = re.sub(r"[_\-.]+", " ", spaced)
    return _clean_text(spaced, limit=120) or "数值字段"


def _metric_field_ref(
    run: AnalysisRun,
    *,
    target_ref: str,
    column: str,
    binding: dict[str, str],
) -> str:
    material = {
        "domain": _METRIC_FIELD_REF_DOMAIN,
        "project_id": str(run.project_id),
        "run_id": str(run.id),
        "target_ref": target_ref,
        "column": column,
        "binding": binding,
    }
    encoded = json.dumps(
        material,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"mcf1_{hashlib.sha256(encoded).hexdigest()}"


def _validated_run_owned_transition(
    run: AnalysisRun,
    entry: SemanticEntry,
    from_revision_id: str,
    transitions: list[dict[str, Any]],
) -> dict[str, str] | None:
    """Accept only a meaning-preserving head advance finalized by this run."""

    if not from_revision_id or entry.active_revision_id is None:
        return None
    expected = {
        "analysis_run_id": str(run.id),
        "semantic_entry_id": str(entry.id),
        "from_revision_id": from_revision_id,
        "to_revision_id": str(entry.active_revision_id),
        "definition_hash": stable_payload_hash(entry.definition),
        "value_hash": stable_payload_hash(entry.value),
    }
    for item in transitions:
        if item.get("kind") != "semantic_revision_transition":
            continue
        transition = str(item.get("transition") or "")
        if transition not in {
            "execution_verified",
            "relationship_observation_verified",
        }:
            continue
        if all(str(item.get(key) or "") == value for key, value in expected.items()):
            return {**expected, "transition": transition}
    return None


def _target_ref(
    run: AnalysisRun,
    *,
    target_key: str,
    correction_type: str,
    evidence: list[dict[str, Any]],
    semantic_identity: dict[str, Any] | None,
) -> str:
    """Return a stable opaque identity that survives process/desktop restarts."""

    material = {
        "domain": _TARGET_REF_DOMAIN,
        "project_id": str(run.project_id),
        "run_id": str(run.id),
        "target_key": target_key,
        "correction_type": correction_type,
        "semantic_identity": semantic_identity,
        "evidence": sorted(
            evidence,
            key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True),
        ),
    }
    encoded = json.dumps(
        material,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"crt1_{hashlib.sha256(encoded).hexdigest()}"


def _relationship_label(item: dict[str, Any]) -> str:
    endpoints = []
    for ref in item.get("source_refs") or []:
        if not isinstance(ref, dict):
            continue
        label = _clean_text(
            ref.get("source_logical_name") or ref.get("table_or_view"),
            limit=80,
        )
        if label and label not in endpoints:
            endpoints.append(label)
    if len(endpoints) == 2:
        return f"{endpoints[0]} 与 {endpoints[1]} 的关联"
    return _clean_text(item.get("purpose"), limit=240) or "已验证的数据关联"


def _entry_correction_type(entry: SemanticEntry, fallback: str) -> str:
    if entry.entry_type == "relationship":
        return "relationship_rule"
    if entry.entry_type == "metric":
        return "metric_definition"
    action_kind = str(((entry.definition or {}).get("action") or {}).get("kind") or "")
    if action_kind in {"metric_column", "metric_formula"}:
        return "metric_definition"
    if action_kind == "value_filter":
        return "filter_rule"
    return fallback


def _add_candidate(
    candidates: dict[str, dict[str, Any]],
    *,
    target_key: Any,
    correction_type: str,
    label: Any,
    evidence: dict[str, Any],
    source_kind: str,
) -> None:
    key = _clean_text(target_key, limit=161)
    if not key or len(key) > 160:
        return
    candidate = candidates.setdefault(
        key,
        {
            "correction_type": correction_type,
            "labels": [],
            "evidence": [],
            "source_kinds": set(),
        },
    )
    if _TYPE_PRIORITY[correction_type] > _TYPE_PRIORITY[candidate["correction_type"]]:
        candidate["correction_type"] = correction_type
    clean_label = _clean_text(label, limit=240)
    if clean_label and clean_label not in candidate["labels"]:
        candidate["labels"].append(clean_label)
    if evidence not in candidate["evidence"]:
        candidate["evidence"].append(evidence)
    candidate["source_kinds"].add(source_kind)


async def discover_report_correction_targets(
    db: AsyncSession,
    run: AnalysisRun,
) -> list[ReportCorrectionTarget]:
    """Discover only targets proven by persisted system-owned run evidence."""

    report = run.report if isinstance(run.report, dict) else {}
    if run.state != "completed" or report.get("status") != "completed":
        return []
    checkpoint = run.checkpoint if isinstance(run.checkpoint, dict) else {}
    semantic_transitions = [
        item
        for item in checkpoint.get("semantic_revision_transitions") or []
        if isinstance(item, dict)
    ]
    tool_history = [item for item in checkpoint.get("tool_history") or [] if isinstance(item, dict)]
    candidates: dict[str, dict[str, Any]] = {}

    for item in tool_history:
        if item.get("kind") == "business_rule_application":
            rule_key = _clean_text(item.get("rule_key"), limit=161)
            action_kind = _clean_text(item.get("action_kind"), limit=40)
            if not rule_key:
                continue
            rule_key = canonicalize_decision_key(rule_key)
            correction_type = (
                "metric_definition"
                if action_kind in {"metric_column", "metric_formula"}
                else "filter_rule"
                if action_kind == "value_filter"
                else "business_rule"
            )
            _add_candidate(
                candidates,
                target_key=rule_key,
                correction_type=correction_type,
                label=item.get("rule_value"),
                evidence={
                    "kind": "business_rule_application",
                    "rule_key": rule_key,
                    "rule_value": _clean_text(item.get("rule_value"), limit=1000),
                    "action_kind": action_kind,
                    "semantic_entry_id": _clean_text(item.get("semantic_entry_id"), limit=36),
                    "active_revision_id": _clean_text(item.get("active_revision_id"), limit=36),
                    "definition_hash": _clean_text(item.get("definition_hash"), limit=64),
                    "column": _clean_text(
                        item.get("metric_output_column")
                        or item.get("required_metric_column")
                        or item.get("column"),
                        limit=160,
                    ),
                    "formula_hash": _clean_text(item.get("formula_hash"), limit=64),
                },
                source_kind="business_rule_application",
            )
            continue

        if item.get("kind") in {
            "relationship_validation",
            "relationship_application",
        } and is_reusable_full_relationship_evidence(item):
            relationship_key = _clean_text(
                item.get("candidate_relationship_key") or item.get("relationship_key"),
                limit=161,
            )
            if not relationship_key:
                continue
            endpoints = sorted(
                [
                    {
                        "source_id": _clean_text(ref.get("source_id"), limit=64),
                        "table_or_view": _clean_text(ref.get("table_or_view"), limit=160),
                    }
                    for ref in item.get("source_refs") or []
                    if isinstance(ref, dict)
                ],
                key=lambda ref: (ref["source_id"], ref["table_or_view"]),
            )
            _add_candidate(
                candidates,
                target_key=relationship_key,
                correction_type="relationship_rule",
                label=_relationship_label(item),
                evidence={
                    "kind": str(item.get("kind")),
                    "relationship_key": relationship_key,
                    "semantic_entry_id": _clean_text(item.get("semantic_entry_id"), limit=36),
                    "active_revision_id": _clean_text(item.get("active_revision_id"), limit=36),
                    "definition_hash": _clean_text(item.get("definition_hash"), limit=64),
                    "endpoints": endpoints,
                },
                source_kind="validated_relationship",
            )

    receipt = checkpoint.get("confirmation_receipt")
    if isinstance(receipt, dict) and receipt.get("applied") is True and not receipt.get("conflict"):
        receipt_key = _clean_text(receipt.get("key"), limit=161)
        if receipt_key:
            receipt_key = canonicalize_decision_key(receipt_key)
            _add_candidate(
                candidates,
                target_key=receipt_key,
                correction_type="business_rule",
                label=receipt.get("selected_option") or receipt.get("value"),
                evidence={
                    "kind": "confirmation_receipt",
                    "key": receipt_key,
                    "selected_option": _clean_text(
                        receipt.get("selected_option") or receipt.get("value"),
                        limit=1000,
                    ),
                    "semantic_entry_id": _clean_text(receipt.get("semantic_entry_id"), limit=36),
                    "active_revision_id": _clean_text(receipt.get("active_revision_id"), limit=36),
                    "definition_hash": _clean_text(receipt.get("definition_hash"), limit=64),
                    "value_hash": _clean_text(receipt.get("value_hash"), limit=64),
                },
                source_kind="confirmation_receipt",
            )

    if not candidates:
        return []

    entry_result = await db.execute(
        select(SemanticEntry).where(
            SemanticEntry.project_id == run.project_id,
        )
    )
    project_entries = list(entry_result.scalars())
    targets: list[ReportCorrectionTarget] = []
    for canonical_target_key, candidate in candidates.items():
        is_relationship = "validated_relationship" in candidate["source_kinds"]
        matching_entries = [
            entry
            for entry in project_entries
            if (
                entry.key == canonical_target_key
                if is_relationship
                else canonicalize_decision_key(entry.key) == canonical_target_key
            )
        ]
        active_matching_entries = [entry for entry in matching_entries if entry.is_active]
        if matching_entries and not active_matching_entries:
            # A run must not resurrect a definition that was deliberately
            # deactivated after the report completed.
            continue
        matching_entries = active_matching_entries
        if not is_relationship and any(
            entry.entry_type == "relationship" for entry in matching_entries
        ):
            continue
        meanings = {
            json.dumps(
                {"value": entry.value, "definition": entry.definition},
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            for entry in matching_entries
            if entry.validity != "stale"
        }
        if len(meanings) > 1:
            continue
        entry = (
            sorted(
                matching_entries,
                key=lambda item: (
                    item.validity == "stale",
                    item.state not in {"locked", "confirmed"},
                    item.key != canonical_target_key,
                    str(item.id),
                ),
            )[0]
            if matching_entries
            else None
        )

        evidence_conflicts = False
        for claim in candidate["evidence"]:
            if claim.get("kind") == "business_rule_application":
                evidence_entry_id = str(claim.get("semantic_entry_id") or "")
                evidence_revision_id = str(claim.get("active_revision_id") or "")
                evidence_definition_hash = str(claim.get("definition_hash") or "")
                evidence_value = _clean_text(claim.get("rule_value"), limit=1000)
                transition = (
                    _validated_run_owned_transition(
                        run,
                        entry,
                        evidence_revision_id,
                        semantic_transitions,
                    )
                    if entry is not None
                    and evidence_revision_id != str(entry.active_revision_id or "")
                    else None
                )
                revision_matches = bool(
                    entry is not None
                    and entry.active_revision_id
                    and (
                        evidence_revision_id == str(entry.active_revision_id)
                        or transition is not None
                    )
                )
                if entry is not None and (
                    not evidence_entry_id
                    or evidence_entry_id != str(entry.id)
                    or not revision_matches
                    or not evidence_definition_hash
                    or evidence_definition_hash != stable_payload_hash(entry.definition)
                    or not evidence_value
                    or evidence_value != _clean_text(entry.value, limit=1000)
                ):
                    evidence_conflicts = True
                    break
                if transition is not None:
                    claim["revision_transition"] = transition
                if entry is None and (evidence_entry_id or evidence_revision_id):
                    evidence_conflicts = True
                    break
            if claim.get("kind") in {
                "relationship_validation",
                "relationship_application",
            }:
                evidence_definition_hash = str(claim.get("definition_hash") or "")
                evidence_entry_id = str(claim.get("semantic_entry_id") or "")
                evidence_revision_id = str(claim.get("active_revision_id") or "")
                transition = (
                    _validated_run_owned_transition(
                        run,
                        entry,
                        evidence_revision_id,
                        semantic_transitions,
                    )
                    if entry is not None
                    and evidence_revision_id != str(entry.active_revision_id or "")
                    else None
                )
                revision_matches = bool(
                    entry is not None
                    and entry.active_revision_id
                    and (
                        evidence_revision_id == str(entry.active_revision_id)
                        or transition is not None
                    )
                )
                if entry is not None and (
                    not evidence_entry_id
                    or evidence_entry_id != str(entry.id)
                    or not revision_matches
                    or not evidence_definition_hash
                    or evidence_definition_hash != stable_payload_hash(entry.definition)
                ):
                    evidence_conflicts = True
                    break
                if transition is not None:
                    claim["revision_transition"] = transition
                if entry is None and (evidence_entry_id or evidence_revision_id):
                    evidence_conflicts = True
                    break
            if claim.get("kind") == "confirmation_receipt" and entry is not None:
                selected_option = _clean_text(claim.get("selected_option"), limit=1000)
                evidence_revision_id = str(claim.get("active_revision_id") or "")
                transition = (
                    _validated_run_owned_transition(
                        run,
                        entry,
                        evidence_revision_id,
                        semantic_transitions,
                    )
                    if evidence_revision_id != str(entry.active_revision_id or "")
                    else None
                )
                revision_matches = bool(
                    entry.active_revision_id
                    and (
                        evidence_revision_id == str(entry.active_revision_id)
                        or transition is not None
                    )
                )
                if (
                    not selected_option
                    or _clean_text(entry.value, limit=1000) != selected_option
                    or str(claim.get("semantic_entry_id") or "") != str(entry.id)
                    or not revision_matches
                    or str(claim.get("definition_hash") or "")
                    != stable_payload_hash(entry.definition)
                    or str(claim.get("value_hash") or "") != stable_payload_hash(entry.value)
                ):
                    evidence_conflicts = True
                    break
                if transition is not None:
                    claim["revision_transition"] = transition
            if claim.get("kind") == "confirmation_receipt" and entry is None:
                if claim.get("semantic_entry_id") or claim.get("active_revision_id"):
                    evidence_conflicts = True
                    break
        if evidence_conflicts:
            continue

        correction_type = candidate["correction_type"]
        if entry is not None:
            correction_type = _entry_correction_type(entry, correction_type)
        # A relationship is reusable only after the strict full-relation proof,
        # even if a confirmation receipt happens to reference a relationship key.
        if (
            correction_type == "relationship_rule"
            and "validated_relationship" not in candidate["source_kinds"]
        ):
            continue
        label = (
            _clean_text(entry.value, limit=240)
            if entry is not None
            else next(iter(candidate["labels"]), "")
        )
        if not label:
            label = {
                "metric_definition": "已应用的指标口径",
                "filter_rule": "已应用的筛选口径",
                "relationship_rule": "已验证的数据关联",
            }.get(correction_type, "已确认的业务口径")
        semantic_identity = (
            {
                "semantic_entry_id": str(entry.id),
                "active_revision_id": (
                    str(entry.active_revision_id) if entry.active_revision_id else None
                ),
                "definition_hash": stable_payload_hash(entry.definition),
                "value_hash": stable_payload_hash(entry.value),
            }
            if entry is not None
            else None
        )
        targets.append(
            ReportCorrectionTarget(
                target_ref=_target_ref(
                    run,
                    target_key=canonical_target_key,
                    correction_type=correction_type,
                    evidence=candidate["evidence"],
                    semantic_identity=semantic_identity,
                ),
                label=label,
                description=_DESCRIPTIONS[correction_type],
                correction_type=correction_type,
                target_key=entry.key if entry is not None else canonical_target_key,
            )
        )
    return sorted(targets, key=lambda item: (item.label.casefold(), item.target_ref))


async def resolve_report_correction_target(
    db: AsyncSession,
    run: AnalysisRun,
    target_ref: str,
) -> ReportCorrectionTarget | None:
    """Resolve by exact membership in the freshly recomputed run target set."""

    for target in await discover_report_correction_targets(db, run):
        if compare_digest(target.target_ref, target_ref):
            return target
    return None


async def discover_metric_column_correction_options(
    db: AsyncSession,
    run: AnalysisRun,
    target_ref: str,
    *,
    allow_unlisted_metric_target: bool = False,
) -> list[MetricColumnCorrectionOption]:
    """Project trusted metric fields through run-bound opaque references."""

    target = await resolve_report_correction_target(db, run, target_ref)
    if target is None and not allow_unlisted_metric_target:
        return []
    if target is not None and target.correction_type != "metric_definition":
        return []
    candidates = await discover_metric_column_correction_candidates(db, run)
    options: list[MetricColumnCorrectionOption] = []
    for candidate in candidates:
        logical_name = _clean_text(
            candidate.binding.get("source_logical_name"),
            limit=100,
        )
        field_label = _metric_column_display_label(candidate.column)
        label = f"{field_label} · {logical_name}" if logical_name else field_label
        options.append(
            MetricColumnCorrectionOption(
                field_ref=_metric_field_ref(
                    run,
                    target_ref=target.target_ref if target is not None else target_ref,
                    column=candidate.column,
                    binding=candidate.binding,
                ),
                label=label,
                description=(
                    f"来自 {logical_name} 的可核对数值字段"
                    if logical_name
                    else "本次调查已核对的数据来源中的数值字段"
                ),
                column=candidate.column,
                binding=candidate.binding,
            )
        )
    return sorted(options, key=lambda item: (item.label.casefold(), item.field_ref))


async def resolve_metric_column_correction_option(
    db: AsyncSession,
    run: AnalysisRun,
    target_ref: str,
    field_ref: str,
    *,
    allow_unlisted_metric_target: bool = False,
) -> MetricColumnCorrectionOption | None:
    """Resolve only exact membership in the freshly rebuilt option set."""

    for option in await discover_metric_column_correction_options(
        db,
        run,
        target_ref,
        allow_unlisted_metric_target=allow_unlisted_metric_target,
    ):
        if compare_digest(option.field_ref, field_ref):
            return option
    return None
