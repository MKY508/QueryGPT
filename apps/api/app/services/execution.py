"""Autonomous analysis execution service."""

import asyncio
import base64
import binascii
import hashlib
import json
import re
from collections.abc import AsyncGenerator, Callable
from contextlib import aclosing
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from inspect import isawaitable
from typing import Any
from uuid import UUID, uuid4

import structlog
from anyio import CancelScope
from pydantic import ValidationError as PydanticValidationError
from pydantic_ai import UnexpectedModelBehavior
from pydantic_ai.exceptions import ToolRetryError
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError, ProgrammingError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.tables import (
    AnalysisCorrection,
    AnalysisRun,
    ArtifactRecord,
    Connection,
    Model,
    Project,
    SemanticEntry,
)
from app.i18n import get_progress_message, t
from app.models import SSEEvent
from app.models.analysis_state import (
    REPORT_ANALYSIS_STATES,
    TERMINAL_ANALYSIS_STATES,
    AnalysisState,
)
from app.services.analysis_checkpoint import (
    load_runtime_checkpoint,
    revalidate_database_replay_journal,
    source_fingerprint_map,
    validate_source_fingerprints,
)
from app.services.analysis_completion import AnalysisCompletion
from app.services.analysis_run_journal import AnalysisRunJournal, AnalysisRunOwnershipError
from app.services.business_decision_slots import canonicalize_decision_key
from app.services.checkpoint_contract import (
    CheckpointDriftError,
    CheckpointError,
    RestoredCheckpoint,
    stable_payload_hash,
)
from app.services.correction_completion import (
    CorrectionCompletionError,
    build_correction_application_receipt,
    is_reusable_full_relationship_evidence,
)
from app.services.engine_diagnostics import build_diagnostic_entry, categorize_sql_error
from app.services.execution_context import ExecutionContextResolver
from app.services.execution_policy import ExecutionPolicy
from app.services.golden_regression import build_golden_contract, find_matching_contract
from app.services.metric_candidate_learning import learn_verified_aggregate_metric_candidate
from app.services.model_runtime import (
    ModelCredentialError,
    ModelRuntimeConfigurationError,
    ResolvedModelConfig,
    categorize_model_exception,
)
from app.services.project_context import (
    load_project_context,
    required_relationship_validation_status,
    resolve_confirmed_ambiguity,
)
from app.services.result_filters import validate_business_rule_strategy_definition
from app.services.run_control import AnalystStoppedError
from app.services.semantic_revisions import (
    SemanticRevisionConflictError,
    append_semantic_revision,
    reset_semantic_execution_proof,
)
from app.services.standing_completion import (
    StandingCompletionError,
    StandingStaleRunError,
    finalize_standing_run,
    mark_standing_run_needs_attention,
)

logger = structlog.get_logger()


class DecisionSlotConflictError(ValueError):
    """Raised when multiple durable rows disagree about one canonical decision slot."""


class SemanticValidationSelectionError(ValueError):
    """Raised when a revision-bound batch validation selection has drifted."""


class _AnalysisFinalizationStoppedError(AnalystStoppedError):
    """Stop won the terminal-state claim before a successful result was durable."""


def _normalize_semantic_validation_selection(
    selection: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    if not selection:
        return []
    if len(selection) > 100:
        raise SemanticValidationSelectionError("一次最多验证 100 条关联候选")
    normalized: list[dict[str, str]] = []
    seen_entry_ids: set[str] = set()
    for item in selection:
        entry_id = str(item.get("entry_id") or item.get("semantic_entry_id") or "")
        revision_id = str(item.get("expected_active_revision_id") or "")
        try:
            entry_id = str(UUID(entry_id))
            revision_id = str(UUID(revision_id))
        except ValueError as exc:
            raise SemanticValidationSelectionError("批量验证包含无效的候选身份") from exc
        if entry_id in seen_entry_ids:
            raise SemanticValidationSelectionError("批量验证不能重复选择同一条候选")
        seen_entry_ids.add(entry_id)
        normalized.append(
            {
                "entry_id": entry_id,
                "expected_active_revision_id": revision_id,
            }
        )
    return normalized


def _decision_entry_meaning(entry: SemanticEntry) -> str:
    return json.dumps(
        {"value": entry.value, "definition": entry.definition},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _select_decision_slot_entry(
    entries: list[SemanticEntry],
    canonical_key: str,
    *,
    allow_reactivation: bool = False,
) -> tuple[SemanticEntry | None, list[SemanticEntry]]:
    """Select the compatible materialized head for a canonical decision slot.

    A single legacy alias remains writable. Multiple equivalent durable rows are
    read-compatible, with locked/canonical rows preferred, while contradictory
    durable meanings fail closed instead of choosing one by query order.
    """

    matches = [
        entry for entry in entries if canonicalize_decision_key(str(entry.key)) == canonical_key
    ]
    if any(entry.entry_type == "relationship" for entry in matches):
        raise DecisionSlotConflictError("同一业务问题存在不兼容的项目知识，不能安全覆盖")
    durable = [
        entry
        for entry in matches
        if entry.state in {"confirmed", "locked"} and entry.is_active and entry.validity != "stale"
    ]
    if len({_decision_entry_meaning(entry) for entry in durable}) > 1:
        raise DecisionSlotConflictError("同一业务问题存在互相冲突的历史答案，请先解决冲突")
    candidates = durable
    if not candidates and allow_reactivation:
        candidates = matches
    if not candidates:
        return None, durable
    selected = sorted(
        candidates,
        key=lambda entry: (
            not (entry.is_active and entry.validity != "stale"),
            entry.key != canonical_key,
            entry.state not in {"confirmed", "locked"},
            not entry.is_active,
            entry.validity == "stale",
            str(entry.id),
        ),
    )[0]
    return selected, durable


async def _capture_current_semantic_evidence_heads(
    db: AsyncSession,
    tool_history: list[dict[str, Any]],
    confirmation_receipt: dict[str, Any] | None,
) -> dict[str, dict[str, str]]:
    """Snapshot evidence heads before result persistence mutates revisions.

    Evidence is eligible only when it already identifies the materialized active
    revision. This keeps a same-value external edit from masquerading as a
    revision transition owned by the current run.
    """

    claims = [
        item
        for item in tool_history
        if item.get("kind")
        in {
            "business_rule_application",
            "relationship_validation",
            "relationship_application",
        }
    ]
    if isinstance(confirmation_receipt, dict):
        claims.append({"kind": "confirmation_receipt", **confirmation_receipt})

    grouped: dict[UUID, list[dict[str, Any]]] = {}
    for claim in claims:
        raw_entry_id = str(claim.get("semantic_entry_id") or "")
        revision_id = str(claim.get("active_revision_id") or "")
        if not raw_entry_id or not revision_id:
            continue
        try:
            parsed_entry_id = UUID(raw_entry_id)
            UUID(revision_id)
        except ValueError:
            continue
        grouped.setdefault(parsed_entry_id, []).append(claim)

    captured: dict[str, dict[str, str]] = {}
    for entry_id, entry_claims in grouped.items():
        revision_ids = {str(claim.get("active_revision_id") or "") for claim in entry_claims}
        if len(revision_ids) != 1:
            continue
        revision_id = next(iter(revision_ids))
        entry = await db.get(SemanticEntry, entry_id)
        if entry is None or str(entry.active_revision_id or "") != revision_id:
            continue
        definition_hash = stable_payload_hash(entry.definition)
        if any(
            str(claim.get("definition_hash") or "") != definition_hash for claim in entry_claims
        ):
            continue
        values: list[str] = []
        for claim in entry_claims:
            if claim.get("kind") == "business_rule_application":
                values.append(str(claim.get("rule_value") or ""))
            elif claim.get("kind") == "confirmation_receipt":
                values.append(str(claim.get("selected_option") or claim.get("value") or ""))
        if any(not value or value != entry.value for value in values):
            continue
        captured[str(entry.id)] = {
            "from_revision_id": revision_id,
            "definition_hash": definition_hash,
            "value_hash": stable_payload_hash(entry.value),
        }
    return captured


async def _build_run_owned_semantic_transitions(
    db: AsyncSession,
    run: AnalysisRun,
    captured_heads: dict[str, dict[str, str]],
    verified_relationship_entry_ids: set[str],
) -> list[dict[str, Any]]:
    """Describe meaning-preserving revision advances verified by this run."""

    transitions: list[dict[str, Any]] = []
    for entry_id, captured in captured_heads.items():
        entry = await db.get(SemanticEntry, UUID(entry_id))
        if entry is None or entry.active_revision_id is None:
            continue
        to_revision_id = str(entry.active_revision_id)
        if to_revision_id == captured["from_revision_id"]:
            continue
        execution_details = (
            entry.execution_details if isinstance(entry.execution_details, dict) else {}
        )
        execution_verified = str(execution_details.get("last_verified_run_id") or "") == str(run.id)
        relationship_observation_verified = entry_id in verified_relationship_entry_ids
        if not execution_verified and not relationship_observation_verified:
            continue
        definition_hash = stable_payload_hash(entry.definition)
        value_hash = stable_payload_hash(entry.value)
        if definition_hash != captured["definition_hash"] or value_hash != captured["value_hash"]:
            continue
        transitions.append(
            {
                "kind": "semantic_revision_transition",
                "analysis_run_id": str(run.id),
                "semantic_entry_id": entry_id,
                "from_revision_id": captured["from_revision_id"],
                "to_revision_id": to_revision_id,
                "definition_hash": definition_hash,
                "value_hash": value_hash,
                "transition": (
                    "execution_verified"
                    if execution_verified
                    else "relationship_observation_verified"
                ),
                "recorded_at": execution_details.get("verified_at"),
            }
        )
    return sorted(
        transitions,
        key=lambda item: (item["semantic_entry_id"], item["from_revision_id"]),
    )


_NEGATED_OPTION_PREFIX = re.compile(
    r"(?:不要|不是|并非|不选(?:择)?|别选(?:择)?|拒绝(?:选择)?|不采用|不使用|没有|未(?:选择)?|不)"
    r"(?:要|选(?:择)?|采用|使用|按)?\s*[\"'“‘「『]?\s*$"
    r"|(?:not|do\s+not|don't)\s+(?:want\s+to\s+)?(?:choose|select|use)?\s*[\"']?\s*$",
    re.IGNORECASE,
)
_UNCERTAIN_OPTION_PREFIX = re.compile(
    r"(?:不确定|未确定|尚未决定|还没决定|没有决定|仍在考虑|还在考虑|犹豫).{0,16}$",
    re.IGNORECASE,
)
_NEGATED_OPTION_SUFFIX = re.compile(
    r"^\s*[\"'”’」』]?\s*(?:不对|不行|不是(?:我的)?选择|不选(?:择)?|不要|不采用|不使用|除外|作废)"
    r"|^\s*[\"']?\s*(?:is\s+not|isn't|not\s+selected)",
    re.IGNORECASE,
)
_AFFIRMATIVE_OPTION_PREFIX = re.compile(
    r"(?:选择|选|确认(?:选择|采用)?|采用|使用|按|同意(?:选择|采用)?)\s*[\"'“‘「『]?\s*$"
    r"|(?:choose|select|confirm|use)\s*[\"']?\s*$",
    re.IGNORECASE,
)
_OPTION_ONLY_PUNCTUATION = " \t\r\n\"'“”‘’「」『』，,。.!！?？;；:："


def _selected_confirmation_option(options: list[str], query: str) -> str | None:
    """Return one explicit affirmative option, or fail closed on ambiguity."""

    matched = [option for option in options if option and option in query]
    if len(matched) != 1:
        return None
    selected = matched[0]
    explicit_choice = query.strip(_OPTION_ONLY_PUNCTUATION) == selected.strip(
        _OPTION_ONLY_PUNCTUATION
    )
    start = 0
    while (index := query.find(selected, start)) >= 0:
        prefix = query[max(0, index - 24) : index]
        suffix = query[index + len(selected) : index + len(selected) + 18]
        if (
            _NEGATED_OPTION_PREFIX.search(prefix)
            or _UNCERTAIN_OPTION_PREFIX.search(prefix)
            or _NEGATED_OPTION_SUFFIX.search(suffix)
        ):
            return None
        explicit_choice = explicit_choice or bool(_AFFIRMATIVE_OPTION_PREFIX.search(prefix))
        start = index + len(selected)
    return selected if explicit_choice else None


def _canonical_strategy_definition(
    definition: Any,
    *,
    canonical_key: str,
    selected_option: str,
) -> dict[str, Any] | None:
    """Canonicalize a safe declarative strategy, or discard an untrusted one."""

    if not isinstance(definition, dict):
        return None
    candidate = {
        **definition,
        "rule_key": canonicalize_decision_key(str(definition.get("rule_key") or "")),
    }
    try:
        return validate_business_rule_strategy_definition(
            candidate,
            expected_key=canonical_key,
            expected_value=selected_option,
        )
    except ValueError:
        return None


def _public_model_error(error: BaseException) -> tuple[str, str, str] | None:
    """Map provider failures to safe, actionable product errors."""

    category = categorize_model_exception(error)
    messages = {
        "auth": ("MODEL_AUTH_ERROR", "模型服务拒绝了凭证，请检查 API Key。"),
        "timeout": ("MODEL_TIMEOUT", "模型服务响应超时，可以直接重试。"),
        "connection": ("MODEL_CONNECTION_ERROR", "无法连接模型服务，请检查网络和服务地址。"),
        "model_endpoint": (
            "MODEL_ENDPOINT_ERROR",
            "模型服务地址不可用；OpenAI-compatible 地址通常需要以 /v1 结尾。",
        ),
        "model_not_found": ("MODEL_NOT_FOUND", "当前服务不支持所配置的模型名称。"),
        "rate_limited": ("MODEL_RATE_LIMITED", "模型服务当前限流，请稍后直接重试。"),
        "provider_format": (
            "MODEL_FORMAT_ERROR",
            "模型服务返回的协议格式不兼容，请检查接口格式设置。",
        ),
    }
    public_error = messages.get(category)
    if public_error is None:
        return None
    code, message = public_error
    return code, message, category


_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_MATERIALIZED_RESULT_KINDS = {
    "structured_query",
    "sql",
    "file_sql",
    "join",
    "aggregate",
    "business_rule_application",
}


def _exception_chain(error: BaseException) -> list[BaseException]:
    """Return one bounded, cycle-safe exception cause chain."""

    chain: list[BaseException] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen and len(chain) < 12:
        chain.append(current)
        seen.add(id(current))
        cause = current.__cause__
        if cause is None and not current.__suppress_context__:
            cause = current.__context__
        current = cause
    return chain


def _is_structured_report_output_error(error: BaseException) -> bool:
    """Accept only exhausted report-schema retries, never tool or business failures."""

    if not isinstance(error, UnexpectedModelBehavior):
        return False
    if re.fullmatch(r"Exceeded maximum output retries \([0-9]+\)", error.message) is None:
        return False
    for cause in _exception_chain(error)[1:]:
        if isinstance(cause, PydanticValidationError):
            return True
        if isinstance(cause, ToolRetryError):
            content = cause.tool_retry.content
            if (
                isinstance(content, list)
                and content
                and all(
                    isinstance(item, dict)
                    and isinstance(item.get("type"), str)
                    and isinstance(item.get("loc"), (list, tuple))
                    for item in content
                )
            ):
                return True
    return False


@dataclass(frozen=True)
class _VerifiedFinalResult:
    """A materialized final table whose validation still matches byte-for-byte."""

    result_name: str
    rows: list[dict[str, Any]]
    columns: list[str]
    result_hash: str
    validation: dict[str, Any]
    tool_history: list[dict[str, Any]]


def _verified_final_result_for_fallback(engine: Any) -> _VerifiedFinalResult | None:
    """Read the runtime's final table only when all deterministic receipts agree."""

    deps = getattr(engine, "deps", None)
    dataframes = getattr(deps, "dataframes", None)
    result_metadata = getattr(deps, "result_metadata", None)
    validated_results = getattr(deps, "validated_results", None)
    raw_history = getattr(deps, "tool_history", None)
    if (
        not isinstance(dataframes, dict)
        or not isinstance(result_metadata, dict)
        or not isinstance(validated_results, (set, list, tuple))
        or not isinstance(raw_history, list)
    ):
        return None
    tool_history = [dict(item) for item in raw_history if isinstance(item, dict)]
    indexed_validation = next(
        (
            (index, item)
            for index, item in reversed(list(enumerate(tool_history)))
            if item.get("kind") == "validation" and isinstance(item.get("profile"), dict)
        ),
        None,
    )
    if indexed_validation is None:
        return None
    validation_index, validation = indexed_validation
    result_name = str(validation.get("result_name") or "").strip()
    result_hash = str(validation.get("result_hash") or "").strip()
    if (
        not result_name
        or _SHA256_PATTERN.fullmatch(result_hash) is None
        or result_name not in validated_results
    ):
        return None
    rows = dataframes.get(result_name)
    metadata = result_metadata.get(result_name)
    profile = validation["profile"]
    profile_rows = profile.get("materialized_rows")
    metadata_rows = metadata.get("materialized_rows") if isinstance(metadata, dict) else None
    if (
        not isinstance(rows, list)
        or not all(isinstance(row, dict) for row in rows)
        or not isinstance(metadata, dict)
        or validation.get("status") not in {None, "passed", "validated"}
        or profile.get("truncated") is not False
        or metadata.get("truncated") is not False
        or type(profile_rows) is not int
        or profile_rows != len(rows)
        or type(metadata_rows) is not int
        or metadata_rows != len(rows)
        or stable_payload_hash(rows) != result_hash
    ):
        return None
    if metadata.get("result_completeness") not in {None, "complete"}:
        return None
    columns = [str(column) for column in profile.get("columns") or []]
    actual_columns = sorted({str(column) for row in rows for column in row})
    if columns != actual_columns:
        return None

    indexed_data_step = next(
        (
            (index, item)
            for index, item in reversed(list(enumerate(tool_history)))
            if item.get("kind") in _MATERIALIZED_RESULT_KINDS
            and str(item.get("result_name") or "").strip()
        ),
        None,
    )
    if indexed_data_step is None:
        return None
    data_step_index, data_step = indexed_data_step
    if (
        validation_index <= data_step_index
        or str(data_step.get("result_name") or "").strip() != result_name
    ):
        return None
    if any(item.get("kind") == "python" for item in tool_history[validation_index + 1 :]):
        return None
    return _VerifiedFinalResult(
        result_name=result_name,
        rows=[dict(row) for row in rows],
        columns=columns,
        result_hash=result_hash,
        validation=dict(validation),
        tool_history=tool_history,
    )


def _required_playbook_receipt_is_satisfied(
    run: AnalysisRun,
    verified: _VerifiedFinalResult,
) -> bool:
    """A claimed standing/playbook run may never bypass its execution receipt."""

    standing = (run.checkpoint or {}).get("standing_analysis")
    if not isinstance(standing, dict):
        return True
    receipts = [
        item
        for item in verified.tool_history
        if item.get("kind") == "analysis_playbook_execution"
        and item.get("status") == "validated"
        and item.get("result_name") == verified.result_name
        and item.get("result_hash") == verified.result_hash
        and item.get("truncated") is False
    ]
    playbook_id = str(standing.get("playbook_id") or "").strip()
    shape_hash = str(standing.get("playbook_shape_hash") or "").strip()
    if playbook_id:
        receipts = [item for item in receipts if item.get("playbook_id") == playbook_id]
    if shape_hash:
        receipts = [item for item in receipts if item.get("playbook_shape_hash") == shape_hash]
    return len(receipts) == 1


@dataclass(frozen=True)
class ExecutionInputs:
    model_config: ResolvedModelConfig
    db_config: dict[str, Any] | None
    history: list[dict[str, Any]]
    language: str = "zh"


@dataclass(frozen=True)
class ResultPersistenceOutcome:
    accepted: bool = True
    error_code: str | None = None
    message: str | None = None
    correction_application: dict[str, Any] | None = None


class ExecutionService:
    """AI 执行服务"""

    def __init__(
        self,
        db: AsyncSession,
        model_name: str | None = None,
        connection_id: UUID | None = None,
        language: str = "zh",
        context_rounds: int = 5,
        settings_data: dict[str, Any] | None = None,
        project_id: UUID | None = None,
        semantic_validation_selection: list[dict[str, Any]] | None = None,
        stream_attempt_id: str | None = None,
    ):
        self.db = db
        self.stream_attempt_id = stream_attempt_id or uuid4().hex
        self.analysis_run_id: UUID | None = None
        self._run_journal: AnalysisRunJournal | None = None
        self.model_name = model_name
        self.connection_id = connection_id
        self.language = language
        self.context_rounds = max(context_rounds, 1)
        self.settings_data = settings_data or {}
        self.execution_policy = ExecutionPolicy.from_settings(self.settings_data)
        self.project_id = project_id
        self.project_scoped = project_id is not None
        self.semantic_validation_selection = _normalize_semantic_validation_selection(
            semantic_validation_selection
        )
        self.resolver = ExecutionContextResolver(
            db,
            model_name=model_name,
            connection_id=connection_id,
            language=language,
            context_rounds=self.context_rounds,
            settings_data=self.settings_data,
            allow_default_connection_fallback=not self.project_scoped,
        )

    def _journal_for(self, run: AnalysisRun) -> AnalysisRunJournal:
        if self._run_journal is None:
            self._run_journal = AnalysisRunJournal(self.db, run, self.stream_attempt_id)
        elif self._run_journal.run is not run:
            raise RuntimeError("An execution service owns exactly one analysis run")
        return self._run_journal

    def _public_event(self, event: SSEEvent) -> SSEEvent | None:
        data = self.execution_policy.public_event_data(event.type.value, event.data)
        if data is None:
            return None
        event.data = data
        return event

    def _checkpoint_payload(
        self,
        run: AnalysisRun,
        *,
        tool_history: list[dict[str, Any]] | None = None,
        updates: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.execution_policy.checkpoint_payload(
            run.checkpoint,
            tool_history=tool_history,
            updates=updates,
        )

    def _technical_details(
        self,
        details: dict[str, Any],
        *,
        tool_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return self.execution_policy.technical_details(
            details,
            tool_history=tool_history,
        )

    def _diagnostic_error(self, error: BaseException) -> str:
        if self.execution_policy.diagnostics_enabled:
            return str(error)
        return type(error).__name__

    async def _resolve_semantic_validation_contract(
        self,
        selection: list[dict[str, Any]] | None,
        *,
        project_id: UUID | None,
    ) -> list[dict[str, Any]]:
        """Resolve exact current candidate heads or fail closed on any drift."""

        normalized = _normalize_semantic_validation_selection(selection)
        if not normalized:
            return []
        if project_id is None:
            raise SemanticValidationSelectionError("批量验证必须绑定到候选所属项目")
        entry_ids = [UUID(item["entry_id"]) for item in normalized]
        result = await self.db.execute(select(SemanticEntry).where(SemanticEntry.id.in_(entry_ids)))
        entries = {str(entry.id): entry for entry in result.scalars()}
        relationship_keys: set[str] = set()
        contract: list[dict[str, Any]] = []
        for item in normalized:
            entry = entries.get(item["entry_id"])
            if entry is None or entry.project_id != project_id:
                raise SemanticValidationSelectionError(
                    "所选关联候选不存在或不属于当前项目，请刷新后重新选择"
                )
            if not entry.is_active:
                raise SemanticValidationSelectionError(f"候选 {entry.key} 已停用，请刷新后重新选择")
            if entry.state != "candidate" or entry.entry_type != "relationship":
                raise SemanticValidationSelectionError(f"{entry.key} 已不是可批量验证的关联候选")
            if entry.execution_state != "needs_validation" or not entry.definition:
                raise SemanticValidationSelectionError(
                    f"候选 {entry.key} 当前不再等待验证，请刷新后重新选择"
                )
            active_revision_id = str(entry.active_revision_id or "")
            if active_revision_id != item["expected_active_revision_id"]:
                raise SemanticValidationSelectionError(
                    f"候选 {entry.key} 的版本已变化，请刷新后重新选择"
                )
            if entry.key in relationship_keys:
                raise SemanticValidationSelectionError(
                    f"多个所选候选共用关系键 {entry.key}，无法逐条绑定验证证据"
                )
            relationship_keys.add(entry.key)
            contract.append(
                {
                    "semantic_entry_id": str(entry.id),
                    "expected_active_revision_id": active_revision_id,
                    "relationship_key": entry.key,
                    "definition_hash": stable_payload_hash(entry.definition),
                }
            )
        return contract

    def _semantic_validation_selection_for_run(
        self,
        run: AnalysisRun | None,
    ) -> list[dict[str, Any]]:
        stored = (
            (run.checkpoint or {}).get("semantic_validation_selection") if run is not None else None
        )
        if not isinstance(stored, list):
            return list(self.semantic_validation_selection)
        stored_selection = _normalize_semantic_validation_selection(stored)
        if (
            self.semantic_validation_selection
            and stored_selection != self.semantic_validation_selection
        ):
            raise CheckpointError("继续调查时不能替换原先选定的关联候选版本")
        return stored_selection

    async def _required_correction_contract(
        self,
        correction: AnalysisCorrection,
    ) -> dict[str, Any]:
        """Resolve the current project definition without trusting checkpoint copies."""

        semantic_entry = None
        if correction.semantic_entry_id is not None:
            semantic_entry = await self.db.get(SemanticEntry, correction.semantic_entry_id)
            if semantic_entry is None or semantic_entry.project_id != correction.project_id:
                raise CheckpointDriftError("这条报告修正对应的业务定义已经不存在")
            if correction.target_key and semantic_entry.key != correction.target_key:
                raise CheckpointDriftError("这条报告修正对应的业务定义已经变化")
        definition = semantic_entry.definition if semantic_entry is not None else None
        standard_executable = bool(
            semantic_entry is not None
            and definition
            and semantic_entry.state in {"confirmed", "locked"}
            and semantic_entry.validity == "active"
            and semantic_entry.execution_state in {"needs_validation", "verified"}
        )
        relationship_trial = bool(
            semantic_entry is not None
            and definition
            and correction.correction_type == "relationship_rule"
            and semantic_entry.entry_type == "relationship"
            and semantic_entry.source == "user"
            and semantic_entry.state in {"candidate", "confirmed", "locked"}
            and semantic_entry.validity in {"active", "unverified"}
            and semantic_entry.execution_state == "needs_validation"
        )
        expected_active_revision_id = (
            str(semantic_entry.active_revision_id)
            if semantic_entry is not None and semantic_entry.active_revision_id is not None
            else None
        )
        executable = bool(
            expected_active_revision_id and (standard_executable or relationship_trial)
        )
        return {
            "id": str(correction.id),
            "target_key": correction.target_key,
            "text": correction.text,
            "correction_type": correction.correction_type,
            "source_run_id": str(correction.analysis_run_id),
            "semantic_entry_id": str(semantic_entry.id) if semantic_entry is not None else None,
            "expected_active_revision_id": expected_active_revision_id,
            "entry_type": semantic_entry.entry_type if semantic_entry is not None else None,
            "definition_hash": stable_payload_hash(definition) if definition else None,
            "execution_state": (
                semantic_entry.execution_state if semantic_entry is not None else "definition_only"
            ),
            "executable": executable,
        }

    async def _get_model_record(self) -> Model | None:
        return await self.resolver.get_model_record()

    async def _get_model_config(self) -> ResolvedModelConfig:
        """获取模型配置"""
        return await self.resolver.get_model_config()

    async def _record_model_failure_safely(self, category: str) -> None:
        """Persist model health without replacing the original provider error."""

        try:
            await self.resolver.record_model_health(
                healthy=False,
                error_category=category,
            )
        except SQLAlchemyError:
            await self.db.rollback()
            logger.exception("Unable to persist model health failure", category=category)

    async def _get_connection_record(self) -> Connection | None:
        return await self.resolver.get_connection_record()

    async def _get_connection_config(self) -> dict[str, Any] | None:
        """获取数据库连接配置"""
        return await self.resolver.get_connection_config()

    async def _get_conversation_history(
        self,
        conversation_id: UUID,
        limit: int = 10,
        exclude_message_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        """获取对话历史消息

        Args:
            conversation_id: 对话 ID
            limit: 最大消息数量（最近的 N 条）

        Returns:
            消息列表 [{"role": "user/assistant", "content": "..."}]
        """
        history = await self.resolver.get_conversation_history(
            conversation_id,
            limit=limit,
            exclude_message_id=exclude_message_id,
        )
        logger.info(
            "Loaded conversation history", count=len(history), conversation_id=str(conversation_id)
        )
        return history

    async def _load_execution_inputs(
        self,
        *,
        conversation_id: UUID,
        exclude_message_id: UUID | None = None,
    ) -> ExecutionInputs:
        history_limit = max(self.context_rounds * 2, 1)
        model_config = await self._get_model_config()
        db_config = await self._get_connection_config()
        history = await self._get_conversation_history(
            conversation_id,
            limit=history_limit,
            exclude_message_id=exclude_message_id,
        )
        logger.info(
            "Execution inputs resolved",
            conversation_id=str(conversation_id),
            model=model_config.model,
            connection_driver=db_config.get("driver") if db_config else None,
            history_count=len(history),
        )
        return ExecutionInputs(
            model_config=model_config,
            db_config=db_config,
            history=history,
            language=self.language,
        )

    async def _build_engine(
        self,
        inputs: ExecutionInputs,
        *,
        run: AnalysisRun | None = None,
        resume_checkpoint: dict[str, Any] | None = None,
    ) -> Any:
        from app.services.analyst_runtime import PydanticAnalystRuntime

        selection = self._semantic_validation_selection_for_run(run)
        validation_contract = await self._resolve_semantic_validation_contract(
            selection,
            project_id=self.project_id,
        )
        project_context = await load_project_context(
            self.db,
            self.project_id,
            fallback_db_config=inputs.db_config,
            semantic_validation_selection=(validation_contract or None),
            conversation_id=run.conversation_id if run is not None else None,
        )
        if validation_contract:
            relationships_by_id = {
                str(item.get("id") or ""): item for item in project_context.candidate_relationships
            }
            required_relationships: list[dict[str, Any]] = []
            for required in validation_contract:
                relationship = relationships_by_id.get(required["semantic_entry_id"])
                if relationship is None:
                    raise SemanticValidationSelectionError(
                        f"候选 {required['relationship_key']} 已无法在当前数据中安全解析"
                    )
                if (
                    str(relationship.get("active_revision_id") or "")
                    != required["expected_active_revision_id"]
                    or str(relationship.get("definition_hash") or "") != required["definition_hash"]
                    or relationship.get("state") != "candidate"
                    or relationship.get("execution_state") != "needs_validation"
                ):
                    raise SemanticValidationSelectionError(
                        f"候选 {required['relationship_key']} 在运行前已变化，请刷新后重试"
                    )
                required_relationships.append(
                    {
                        **required,
                        "value": relationship.get("value"),
                        "definition": relationship.get("definition"),
                    }
                )
            project_context.required_relationship_validations = required_relationships
        standing_checkpoint = (
            (run.checkpoint or {}).get("standing_analysis") if run is not None else None
        )
        if isinstance(standing_checkpoint, dict):
            matching_analyses = [
                item
                for item in project_context.reusable_analyses
                if str(item.get("id") or "") == str(standing_checkpoint.get("playbook_id") or "")
                and str(item.get("shape_hash") or "")
                == str(standing_checkpoint.get("playbook_shape_hash") or "")
            ]
            if len(matching_analyses) != 1:
                raise CheckpointDriftError("持续分析绑定的方法已经变化，不能继续旧运行")
            project_context.required_analysis = matching_analyses[0]
        correction_checkpoint = (
            (run.checkpoint or {}).get("correction_context") if run is not None else None
        )
        if isinstance(correction_checkpoint, dict):
            correction_id = correction_checkpoint.get("correction_id")
            try:
                correction = await self.db.get(
                    AnalysisCorrection,
                    UUID(str(correction_id)),
                )
            except (TypeError, ValueError):
                correction = None
            if correction is None or correction.project_id != project_context.project_id:
                raise CheckpointDriftError("这条报告修正已经不存在，不能假装按它重新调查")
            project_context.required_correction = await self._required_correction_contract(
                correction
            )
        resume_state: RestoredCheckpoint | None = None
        if resume_checkpoint is not None:
            validate_source_fingerprints(
                dict(resume_checkpoint.get("source_fingerprints") or {}),
                project_context.sources,
            )
            resume_state = await load_runtime_checkpoint(
                project_context.project_dir,
                resume_checkpoint,
            )
            await revalidate_database_replay_journal(
                resume_state.manifest,
                project_context.connection_configs,
            )

        checkpoint_callback = None
        if run is not None:
            journal = self._journal_for(run)
            # End the context-read transaction before starting remote model work.
            async with journal.transaction():
                if validation_contract:
                    run.checkpoint = {
                        **(run.checkpoint or {}),
                        "semantic_validation_selection": validation_contract,
                    }
            if self.execution_policy.diagnostics_enabled:
                checkpoint_callback = partial(
                    journal.checkpoint,
                    project_dir=project_context.project_dir,
                    source_fingerprints=source_fingerprint_map(project_context.sources),
                )
        return PydanticAnalystRuntime(
            model_config=inputs.model_config,
            project_context=project_context,
            execution_policy=self.execution_policy,
            language=inputs.language,
            checkpoint_callback=checkpoint_callback,
            resume_state=resume_state,
        )

    async def _prepare_analysis_run(
        self,
        *,
        query: str,
        conversation_id: UUID,
        resume_run_id: UUID | None,
        correction_id: UUID | None = None,
    ) -> tuple[
        AnalysisRun | None,
        str,
        dict[str, Any] | None,
        dict[str, Any] | None,
    ]:
        if resume_run_id is None:
            if self.project_id is None:
                if correction_id is not None:
                    raise CheckpointError("报告修正只能在所属项目中重新调查")
                if self.semantic_validation_selection:
                    raise SemanticValidationSelectionError("批量验证必须绑定到候选所属项目")
                return None, query, None, None
            checkpoint: dict[str, Any] = {"stream_attempt_id": self.stream_attempt_id}
            if self.semantic_validation_selection:
                checkpoint["semantic_validation_selection"] = list(
                    self.semantic_validation_selection
                )
            if correction_id is not None:
                correction = await self.db.get(AnalysisCorrection, correction_id)
                if correction is None or correction.project_id != self.project_id:
                    raise CheckpointError("要应用的报告修正不属于当前项目")
                checkpoint["correction_context"] = {
                    "correction_id": str(correction.id),
                    "source_run_id": str(correction.analysis_run_id),
                    "target_key": correction.target_key,
                }
            run = AnalysisRun(
                project_id=self.project_id,
                conversation_id=conversation_id,
                query=query,
                state="understanding",
                stage="understanding",
                checkpoint=checkpoint,
            )
            async with AnalysisCompletion(self.db).transaction():
                self.db.add(run)
                await self.db.flush()
                self._run_journal = AnalysisRunJournal(self.db, run, self.stream_attempt_id)
                self.analysis_run_id = self._run_journal.run_id
            return run, query, None, None

        if correction_id is not None:
            raise CheckpointError("继续同一次调查时不能同时换用另一条报告修正")
        async with AnalysisRunJournal.resume(
            self.db,
            run_id=resume_run_id,
            project_id=self.project_id,
            conversation_id=conversation_id,
            attempt_id=self.stream_attempt_id,
        ) as (journal, continuation):
            self._run_journal = journal
            self.analysis_run_id = journal.run_id
        return (
            journal.run,
            continuation.query,
            dict(journal.run.checkpoint) if continuation.restore_snapshot else None,
            continuation.receipt,
        )

    async def _persist_explicit_confirmation(
        self,
        history: list[dict[str, Any]],
        query: str,
    ) -> dict[str, Any] | None:
        """Persist a selected business option before asking the model to continue."""

        if self.project_id is None:
            return None
        confirmation_index = next(
            (
                index
                for index in range(len(history) - 1, -1, -1)
                if history[index].get("role") == "assistant" and history[index].get("confirmation")
            ),
            None,
        )
        if confirmation_index is None or confirmation_index != len(history) - 1:
            return None
        confirmation = history[confirmation_index].get("confirmation")
        task_query = next(
            (
                str(item.get("content") or "")
                for item in reversed(history[:confirmation_index])
                if item.get("role") == "user" and item.get("content")
            ),
            query,
        )
        if not isinstance(confirmation, dict):
            return None
        raw_key = str(confirmation.get("key") or "").strip()[:160]
        options = [str(option) for option in confirmation.get("options") or []]
        key = canonicalize_decision_key(
            raw_key,
            question=str(confirmation.get("question") or ""),
            reason=str(confirmation.get("reason") or ""),
            options=options,
        )[:160]
        selected = _selected_confirmation_option(options, query)
        if not raw_key or not key or not selected:
            return None

        try:
            result = await self.db.execute(
                select(SemanticEntry)
                .where(SemanticEntry.project_id == self.project_id)
                .with_for_update()
            )
            entries = list(result.scalars())
            entry, durable_entries = _select_decision_slot_entry(
                entries,
                key,
                allow_reactivation=True,
            )
            if len(durable_entries) > 1 and any(
                item.value != selected or item.validity != "active" for item in durable_entries
            ):
                raise DecisionSlotConflictError("同一业务问题存在多条历史定义，不能只改写其中一条")
            evidence = [
                {
                    "kind": "explicit_confirmation",
                    "question": str(confirmation.get("question") or ""),
                    "answer": selected,
                    "recorded_at": datetime.now(UTC).isoformat(),
                }
            ]
            entry_is_current_lock = bool(
                entry is not None
                and entry.state == "locked"
                and entry.is_active
                and entry.validity != "stale"
            )
            if entry_is_current_lock and entry is not None:
                receipt = {
                    "key": key,
                    "value": entry.value,
                    "selected_value": selected,
                    "semantic_entry_id": str(entry.id),
                    "active_revision_id": (
                        str(entry.active_revision_id) if entry.active_revision_id else None
                    ),
                    "definition_hash": stable_payload_hash(entry.definition),
                    "value_hash": stable_payload_hash(entry.value),
                    "applied": entry.value == selected,
                    "conflict": entry.value != selected,
                    "task_query": task_query,
                }
                await self.db.rollback()
                return receipt
            if entry is None:
                entry = SemanticEntry(
                    project_id=self.project_id,
                    key=key,
                    value=selected,
                    entry_type="business_rule",
                    state="confirmed",
                    confidence=1,
                    evidence=evidence,
                    source="user",
                )
                self.db.add(entry)
                await self.db.flush()
                await append_semantic_revision(
                    self.db,
                    entry,
                    mutation_kind="explicit_confirmation",
                    actor_source="user",
                    reason="用户在调查中确认业务口径",
                )
            else:
                previous_revision_id = entry.active_revision_id
                meaning_changed = (
                    entry.value != selected or entry.validity != "active" or not entry.is_active
                )
                next_definition = (
                    None
                    if meaning_changed
                    else _canonical_strategy_definition(
                        entry.definition,
                        canonical_key=key,
                        selected_option=selected,
                    )
                )
                definition_changed = next_definition != entry.definition
                if entry.key != key and not any(
                    item.id != entry.id and item.key == key for item in entries
                ):
                    entry.key = key
                entry.value = selected
                entry.state = "confirmed"
                entry.confidence = 1
                entry.definition = next_definition
                entry.evidence = evidence
                entry.source = "user"
                entry.is_active = True
                entry.validity = "active"
                if meaning_changed or definition_changed:
                    reset_semantic_execution_proof(entry)
                await append_semantic_revision(
                    self.db,
                    entry,
                    mutation_kind="explicit_confirmation",
                    actor_source="user",
                    reason="用户在调查中确认业务口径",
                    expected_active_revision_id=previous_revision_id,
                )
            await resolve_confirmed_ambiguity(self.db, self.project_id, key)
            await self.db.commit()
        except BaseException:
            await self.db.rollback()
            raise
        return {
            "key": key,
            "value": selected,
            "selected_value": selected,
            "semantic_entry_id": str(entry.id),
            "active_revision_id": (
                str(entry.active_revision_id) if entry.active_revision_id else None
            ),
            "definition_hash": stable_payload_hash(entry.definition),
            "value_hash": stable_payload_hash(entry.value),
            "applied": True,
            "conflict": False,
            "task_query": task_query,
        }

    async def get_runtime_snapshot(self) -> dict[str, Any]:
        model_config = await self._get_model_config()
        connection = await self._get_connection_record()
        snapshot: dict[str, Any] = {
            **model_config.public_snapshot(diagnostics=self.execution_policy.diagnostics_enabled),
            "connection_id": str(connection.id) if connection else None,
            "connection_name": connection.name if connection else None,
            "context_rounds": self.context_rounds,
        }
        if self.execution_policy.diagnostics_enabled:
            snapshot.update(
                {
                    "connection_driver": connection.driver if connection else None,
                    "connection_host": connection.host if connection else None,
                    "database_name": connection.database_name if connection else None,
                }
            )
        if self.project_id:
            snapshot["project_id"] = str(self.project_id)
        return snapshot

    async def _stage_project_result(
        self,
        run: AnalysisRun,
        result_data: dict[str, Any],
    ) -> ResultPersistenceOutcome:
        """Stage the result and related records in the caller's completion transaction."""
        self.execution_policy.validate_result_boundary(result_data)
        report = dict(result_data.get("report") or {})
        state = AnalysisState(result_data.get("analysis_state"))
        if state not in TERMINAL_ANALYSIS_STATES:
            raise ValueError("A final result must carry a terminal investigation state")
        if report.get("status") and REPORT_ANALYSIS_STATES.get(report["status"]) != state:
            raise ValueError("Report status does not match the investigation state")
        tool_history: list[dict[str, Any]] = []
        for raw_item in result_data.get("tool_history") or []:
            if not isinstance(raw_item, dict):
                continue
            item = dict(raw_item)
            if item.get("kind") == "business_rule_application" and item.get("rule_key"):
                item["rule_key"] = canonicalize_decision_key(str(item["rule_key"]))
            tool_history.append(item)
        result_data["tool_history"] = tool_history
        stored_confirmation_receipt = (run.checkpoint or {}).get("confirmation_receipt")
        captured_semantic_heads = await _capture_current_semantic_evidence_heads(
            self.db,
            tool_history,
            (
                stored_confirmation_receipt
                if isinstance(stored_confirmation_receipt, dict)
                else None
            ),
        )
        reusable_relationship_evidence_entry_ids = {
            str(item.get("semantic_entry_id") or "")
            for item in tool_history
            if item.get("kind") in {"relationship_validation", "relationship_application"}
            and is_reusable_full_relationship_evidence(item)
            and str(item.get("semantic_entry_id") or "") in captured_semantic_heads
        }
        verified_relationship_transition_entry_ids: set[str] = set()
        raw_validation_contract = (run.checkpoint or {}).get("semantic_validation_selection")
        required_validation_contract = (
            [dict(item) for item in raw_validation_contract if isinstance(item, dict)]
            if isinstance(raw_validation_contract, list)
            else []
        )
        matched_validation_evidence, missing_validation_contract = (
            required_relationship_validation_status(
                required_validation_contract,
                tool_history,
            )
        )
        if required_validation_contract and (state != "completed" or missing_validation_contract):
            completed_count = len(matched_validation_evidence)
            total_count = len(required_validation_contract)
            missing_labels = [
                str(item.get("relationship_key") or item.get("semantic_entry_id") or "")
                for item in missing_validation_contract[:5]
            ]
            missing_suffix = f"；未完成：{'、'.join(missing_labels)}" if missing_labels else ""
            summary = (
                f"本次批量验证只取得 {completed_count}/{total_count} 条与所选版本完全匹配的"
                f"完整数据证据，未完成项仍保持待验证{missing_suffix}。"
            )
            rejected_report = {
                **report,
                "status": "needs_attention",
                "summary": summary,
            }
            run.state = "needs_attention"
            run.stage = "needs_attention"
            run.error = summary[:4000]
            run.report = rejected_report
            semantic_validation_result = {
                "status": "incomplete",
                "required": total_count,
                "matched": completed_count,
                "missing_semantic_entry_ids": [
                    str(item.get("semantic_entry_id") or "") for item in missing_validation_contract
                ],
            }
            run.checkpoint = self._checkpoint_payload(
                run,
                tool_history=tool_history,
                updates={
                    "semantic_validation_result": semantic_validation_result,
                    "resumable": False,
                    "reason": "semantic_validation_incomplete",
                    "last_error": summary[:4000],
                },
            )
            await self.db.execute(
                delete(ArtifactRecord).where(ArtifactRecord.analysis_run_id == run.id)
            )
            self.db.add(
                ArtifactRecord(
                    project_id=run.project_id,
                    analysis_run_id=run.id,
                    kind="report",
                    title=report.get("title") or run.query[:120],
                    payload=rejected_report,
                    technical_details=self._technical_details(
                        {
                            "rejection_code": "SEMANTIC_VALIDATION_INCOMPLETE",
                            "tool_history": tool_history,
                            "semantic_validation_result": semantic_validation_result,
                        },
                        tool_history=tool_history,
                    ),
                )
            )
            await self.db.flush()
            return ResultPersistenceOutcome(
                accepted=False,
                error_code="SEMANTIC_VALIDATION_INCOMPLETE",
                message=summary,
            )
        if required_validation_contract:
            verified_at = datetime.now(UTC).isoformat()
            for required in required_validation_contract:
                entry_id = str(required.get("semantic_entry_id") or "")
                evidence = matched_validation_evidence[entry_id]
                semantic_entry = await self.db.get(SemanticEntry, UUID(entry_id))
                expected_revision_id = UUID(str(required.get("expected_active_revision_id") or ""))
                if (
                    semantic_entry is None
                    or semantic_entry.project_id != run.project_id
                    or not semantic_entry.is_active
                    or semantic_entry.state != "candidate"
                    or semantic_entry.entry_type != "relationship"
                    or semantic_entry.execution_state != "needs_validation"
                    or semantic_entry.active_revision_id != expected_revision_id
                    or stable_payload_hash(semantic_entry.definition)
                    != str(required.get("definition_hash") or "")
                ):
                    raise SemanticValidationSelectionError(
                        f"候选 {required.get('relationship_key') or entry_id} 在结果写入前已变化"
                    )
                semantic_entry.validity = "active"
                semantic_entry.execution_state = "verified"
                semantic_entry.execution_details = {
                    "version": 1,
                    "status": "verified",
                    "definition_hash": required["definition_hash"],
                    "last_verified_run_id": str(run.id),
                    "verified_at": verified_at,
                    "checks": [
                        "exact_revision_bound",
                        "full_relation_inputs",
                        "relationship_acceptance_passed",
                    ],
                    "evidence_hash": stable_payload_hash(evidence),
                    "summary": "这项关联候选已在当前完整数据上逐项通过验证。",
                }
                semantic_entry.evidence = [
                    *list(semantic_entry.evidence or []),
                    {
                        **evidence,
                        "analysis_run_id": str(run.id),
                        "recorded_at": verified_at,
                    },
                ]
                await append_semantic_revision(
                    self.db,
                    semantic_entry,
                    mutation_kind="execution_verified",
                    actor_source="verified_analysis",
                    reason="批量选择的关联候选已通过当前完整数据验证",
                    expected_active_revision_id=expected_revision_id,
                )
                verified_relationship_transition_entry_ids.add(entry_id)
            result_data["semantic_validation_result"] = {
                "status": "verified",
                "required": len(required_validation_contract),
                "matched": len(matched_validation_evidence),
                "verified_semantic_entry_ids": [
                    str(item.get("semantic_entry_id") or "")
                    for item in required_validation_contract
                ],
            }
        correction_receipt: dict[str, Any] | None = None
        correction: AnalysisCorrection | None = None
        verified_confirmation_proofs: list[tuple[SemanticEntry, dict[str, Any]]] = []
        correction_checkpoint = (run.checkpoint or {}).get("correction_context")
        if isinstance(correction_checkpoint, dict):
            try:
                correction = await self.db.get(
                    AnalysisCorrection,
                    UUID(str(correction_checkpoint.get("correction_id"))),
                )
                if correction is None or correction.project_id != run.project_id:
                    raise CheckpointDriftError("这条报告修正已经不存在")
                required_correction = await self._required_correction_contract(correction)
                correction_receipt = build_correction_application_receipt(
                    required_correction,
                    tool_history,
                    final_result=str(result_data.get("result_name") or "") or None,
                )
            except (CorrectionCompletionError, CheckpointDriftError, TypeError, ValueError) as exc:
                reason = str(exc) or "这次修正没有通过最终核对"
                failed_receipt = {
                    "version": 1,
                    "kind": "correction_application",
                    "status": "failed",
                    "summary_code": "correction_failed",
                    "correction_id": str(correction.id) if correction is not None else None,
                    "source_run_id": (
                        str(correction.analysis_run_id) if correction is not None else None
                    ),
                    "semantic_entry_id": (
                        str(correction.semantic_entry_id)
                        if correction is not None and correction.semantic_entry_id is not None
                        else None
                    ),
                    "rule_key": correction.target_key if correction is not None else None,
                    "checks": [],
                    "summary": reason,
                }
                rejected_report = {
                    **report,
                    "status": "needs_attention",
                    "summary": reason,
                }
                run.state = "needs_attention"
                run.stage = "needs_attention"
                run.error = reason[:4000]
                run.report = rejected_report
                run.checkpoint = self._checkpoint_payload(
                    run,
                    tool_history=tool_history,
                    updates={
                        "correction_application": failed_receipt,
                        "resumable": False,
                        "reason": "correction_result_rejected",
                        "last_error": reason[:4000],
                    },
                )
                self.db.add(
                    ArtifactRecord(
                        project_id=run.project_id,
                        analysis_run_id=run.id,
                        kind="report",
                        title=report.get("title") or run.query[:120],
                        payload=rejected_report,
                        technical_details=self._technical_details(
                            {
                                "rejection_code": "CORRECTION_RESULT_REJECTED",
                                "tool_history": tool_history,
                            },
                            tool_history=tool_history,
                        ),
                    )
                )
                await self.db.flush()
                return ResultPersistenceOutcome(
                    accepted=False,
                    error_code="CORRECTION_RESULT_REJECTED",
                    message=reason,
                    correction_application=failed_receipt,
                )
        failed_confirmation_application: dict[str, Any] | None = None
        for confirmation in result_data.get("confirmed_corrections") or []:
            if not confirmation.get("applied") or confirmation.get("conflict"):
                continue
            confirmation_key = canonicalize_decision_key(str(confirmation.get("key") or "").strip())
            if not confirmation_key:
                continue
            semantic_result = await self.db.execute(
                select(SemanticEntry).where(SemanticEntry.project_id == run.project_id)
            )
            semantic_entry, _durable_entries = _select_decision_slot_entry(
                list(semantic_result.scalars()),
                confirmation_key,
            )
            if (
                semantic_entry is None
                or not semantic_entry.definition
                or semantic_entry.validity != "active"
            ):
                continue
            definition_hash = stable_payload_hash(semantic_entry.definition)
            if state != "completed":
                continue
            try:
                proof = build_correction_application_receipt(
                    {
                        "id": f"confirmation:{confirmation_key}",
                        "source_run_id": str(run.id),
                        "semantic_entry_id": str(semantic_entry.id),
                        "target_key": confirmation_key,
                        "text": semantic_entry.value,
                        "definition_hash": definition_hash,
                        "executable": True,
                    },
                    tool_history,
                    final_result=str(result_data.get("result_name") or "") or None,
                )
            except ValueError as exc:
                failed_confirmation_application = {
                    "version": 1,
                    "kind": "confirmation_application",
                    "status": "failed",
                    "semantic_entry_id": str(semantic_entry.id),
                    "rule_key": confirmation_key,
                    "definition_hash": definition_hash,
                    "checks": [],
                    "summary": str(exc) or "这项已确认口径没有应用到最终结果",
                }
                break
            if proof is not None:
                verified_confirmation_proofs.append((semantic_entry, proof))
        if failed_confirmation_application is not None:
            summary = "已记录业务口径，但这次结果没有证明它已应用到最终结论。请继续或重新调查。"
            rejected_report = {
                **report,
                "status": "needs_attention",
                "summary": summary,
            }
            run.state = "needs_attention"
            run.stage = "needs_attention"
            run.error = str(failed_confirmation_application["summary"])[:4000]
            run.report = rejected_report
            run.checkpoint = self._checkpoint_payload(
                run,
                tool_history=tool_history,
                updates={
                    "confirmation_application": failed_confirmation_application,
                    "continuation_kind": "confirmation",
                    "resumable": True,
                    "reason": "confirmation_result_rejected",
                    "last_error": str(failed_confirmation_application["summary"])[:4000],
                },
            )
            await self.db.execute(
                delete(ArtifactRecord).where(ArtifactRecord.analysis_run_id == run.id)
            )
            self.db.add(
                ArtifactRecord(
                    project_id=run.project_id,
                    analysis_run_id=run.id,
                    kind="report",
                    title=report.get("title") or run.query[:120],
                    payload=rejected_report,
                    technical_details=self._technical_details(
                        {
                            "rejection_code": "CONFIRMATION_RESULT_REJECTED",
                            "tool_history": tool_history,
                            "confirmation_application": failed_confirmation_application,
                        },
                        tool_history=tool_history,
                    ),
                )
            )
            await self.db.flush()
            return ResultPersistenceOutcome(
                accepted=False,
                error_code="CONFIRMATION_RESULT_REJECTED",
                message=summary,
            )
        if correction_receipt is not None:
            tool_history = [
                item
                for item in tool_history
                if not (
                    item.get("kind") == "correction_application"
                    and item.get("correction_id") == correction_receipt.get("correction_id")
                )
            ]
            tool_history.append(correction_receipt)
            result_data["tool_history"] = tool_history
            result_data["correction_application"] = correction_receipt
        awaiting_data = report.get("status") == "needs_data"
        run.state = state
        run.stage = state
        run.report = report
        checkpoint_updates = {
            "semantic_engine": result_data.get("semantic_engine") or "internal",
            "correction_application": correction_receipt,
            "validations": [
                item
                for item in tool_history
                if item.get("kind")
                in {
                    "validation",
                    "relationship_validation",
                    "relationship_application",
                    "golden_regression_validation",
                }
            ],
            "resumable": awaiting_data,
            "reason": "awaiting_data" if awaiting_data else state,
        }
        report_fallback = result_data.get("report_fallback")
        if isinstance(report_fallback, dict):
            checkpoint_updates["report_fallback"] = dict(report_fallback)
        checkpoint = self._checkpoint_payload(
            run,
            tool_history=tool_history,
            updates=checkpoint_updates,
        )
        checkpoint.pop("continuation_kind", None)
        checkpoint.pop("confirmation_application", None)
        if checkpoint.get("confirmation_receipt_status") == "in_progress":
            checkpoint["confirmation_receipt_status"] = "consumed"
        run.checkpoint = checkpoint
        await self.db.execute(
            delete(ArtifactRecord).where(ArtifactRecord.analysis_run_id == run.id)
        )
        standing_result = False
        standing_failure: tuple[str, str] | None = None
        try:
            standing_result = await finalize_standing_run(self.db, run, result_data)
        except StandingStaleRunError as exc:
            standing_failure = ("STANDING_RUN_SUPERSEDED", str(exc))
            logger.info(
                "Ignored a superseded standing analysis run",
                analysis_run_id=str(run.id),
                reason=self._diagnostic_error(exc),
            )
        except StandingCompletionError as exc:
            standing_failure = ("STANDING_RESULT_REJECTED", str(exc))
            logger.warning(
                "Standing analysis baseline was not advanced",
                analysis_run_id=str(run.id),
                reason=self._diagnostic_error(exc),
            )
            try:
                await mark_standing_run_needs_attention(
                    self.db,
                    run,
                    str(exc),
                    reason_code=exc.reason_code,
                    reason_params=exc.reason_params,
                )
            except (StandingCompletionError, ValueError):
                logger.exception(
                    "Unable to preserve standing analysis attention state",
                    run_id=str(run.id),
                )
        if standing_failure is not None:
            error_code, reason = standing_failure
            rejected_report = {
                **report,
                "status": "needs_attention",
                "summary": reason or "这次变化结果未通过可信检查，上一版结果保持不变。",
            }
            run.state = "needs_attention"
            run.stage = "needs_attention"
            run.error = reason[:4000]
            run.report = rejected_report
            run.checkpoint = self._checkpoint_payload(
                run,
                tool_history=tool_history,
                updates={
                    "resumable": False,
                    "reason": error_code.casefold(),
                    "last_error": reason[:4000],
                },
            )
            self.db.add(
                ArtifactRecord(
                    project_id=run.project_id,
                    analysis_run_id=run.id,
                    kind="report",
                    title=report.get("title") or run.query[:120],
                    payload=rejected_report,
                    technical_details=self._technical_details(
                        {
                            "rejection_code": error_code,
                            "tool_history": tool_history,
                        },
                        tool_history=tool_history,
                    ),
                )
            )
            await self.db.flush()
            return ResultPersistenceOutcome(
                accepted=False,
                error_code=error_code,
                message=reason,
            )

        suppress_standing_learning = standing_result and (
            state != "completed" or report.get("status") != "completed"
        )
        self.db.add(
            ArtifactRecord(
                project_id=run.project_id,
                analysis_run_id=run.id,
                kind="report",
                title=report.get("title") or run.query[:120],
                payload=report,
                technical_details=self._technical_details(
                    {
                        "sql": result_data.get("sql"),
                        "python": result_data.get("python"),
                        "tool_history": result_data.get("tool_history") or [],
                        "report_fallback": (
                            dict(report_fallback) if isinstance(report_fallback, dict) else None
                        ),
                    },
                    tool_history=tool_history,
                ),
            )
        )
        for metric in report.get("metrics") or []:
            self.db.add(
                ArtifactRecord(
                    project_id=run.project_id,
                    analysis_run_id=run.id,
                    kind="metric",
                    title=str(metric.get("label") or "关键指标")[:200],
                    payload=metric,
                    technical_details={},
                )
            )

        result_rows = result_data.get("data") or []
        if result_rows or isinstance(report_fallback, dict):
            self.db.add(
                ArtifactRecord(
                    project_id=run.project_id,
                    analysis_run_id=run.id,
                    kind="table",
                    title="分析结果明细",
                    payload={
                        "rows": result_rows[:200],
                        "rows_count": (
                            result_data["rows_count"]
                            if result_data.get("rows_count") is not None
                            else len(result_rows)
                        ),
                        "sampled": len(result_rows) > 200,
                        "columns": (
                            list(report_fallback.get("columns") or [])
                            if isinstance(report_fallback, dict)
                            else sorted({str(column) for row in result_rows for column in row})
                        ),
                    },
                    technical_details={
                        "result_name": result_data.get("result_name") or "latest",
                        "result_hash": (
                            report_fallback.get("result_hash")
                            if isinstance(report_fallback, dict)
                            else None
                        ),
                    },
                )
            )

        visualization = report.get("visualization") or result_data.get("visualization")
        if visualization:
            data_ref = visualization.get("data_ref")
            if not isinstance(data_ref, dict):
                data_ref = {}
            self.db.add(
                ArtifactRecord(
                    project_id=run.project_id,
                    analysis_run_id=run.id,
                    kind="chart",
                    title=str(report.get("title") or "分析图表")[:200],
                    payload={"chart": visualization},
                    technical_details={
                        "source": "structured_visualization",
                        "result_name": data_ref.get("result_name")
                        or visualization.get("result_name"),
                        "result_hash": data_ref.get("result_hash")
                        or visualization.get("result_hash"),
                    },
                )
            )

        chart_dir = settings.WORKSPACE_ROOT / str(run.project_id) / "artifacts" / str(run.id)
        for index, image in enumerate(result_data.get("python_images") or [], start=1):
            image_offset = index - 1
            python_step = next(
                (
                    item
                    for item in reversed(tool_history)
                    if item.get("kind") == "python"
                    and int(item.get("image_start") or 0)
                    <= image_offset
                    < int(item.get("image_start") or 0) + int(item.get("image_count") or 0)
                ),
                None,
            )
            try:
                image_bytes = base64.b64decode(image, validate=True)
                chart_dir.mkdir(parents=True, exist_ok=True)
                image_hash = hashlib.sha256(image_bytes).hexdigest()
                chart_path = chart_dir / f"chart-{index}-{image_hash[:20]}.png"
                existing_matches = bool(
                    chart_path.exists()
                    and hashlib.sha256(chart_path.read_bytes()).hexdigest() == image_hash
                )
                if not existing_matches:
                    temporary_path = chart_dir / f".{chart_path.name}.{uuid4().hex}.tmp"
                    try:
                        temporary_path.write_bytes(image_bytes)
                        temporary_path.replace(chart_path)
                    finally:
                        temporary_path.unlink(missing_ok=True)
            except (binascii.Error, OSError, ValueError) as exc:
                logger.warning(
                    "Unable to persist Python chart",
                    error=self._diagnostic_error(exc),
                )
                continue
            self.db.add(
                ArtifactRecord(
                    project_id=run.project_id,
                    analysis_run_id=run.id,
                    kind="chart",
                    title=f"{report.get('title') or '分析图表'} {index}"[:200],
                    payload={
                        "format": "png",
                        "relative_path": str(chart_path.relative_to(settings.WORKSPACE_ROOT)),
                    },
                    technical_details=self._technical_details(
                        {
                            "source": "python",
                            "purpose": (python_step or {}).get("purpose"),
                            "input_results": (python_step or {}).get("input_results", []),
                            "input_hashes": (python_step or {}).get("input_hashes", {}),
                            "source_refs": (python_step or {}).get("source_refs", []),
                            "code_hash": (python_step or {}).get("code_hash"),
                            "image_hash": image_hash,
                        }
                    ),
                )
            )

        if tool_history:
            evidence_payload = (
                {
                    "validations": [
                        item
                        for item in tool_history
                        if item.get("kind")
                        in {
                            "validation",
                            "relationship_validation",
                            "relationship_application",
                            "golden_regression_validation",
                        }
                    ],
                    "correction_applications": [
                        item
                        for item in tool_history
                        if item.get("kind") == "correction_application"
                    ],
                }
                if self.execution_policy.diagnostics_enabled
                else {"business_evidence": self.execution_policy.business_evidence(tool_history)}
            )
            self.db.add(
                ArtifactRecord(
                    project_id=run.project_id,
                    analysis_run_id=run.id,
                    kind="evidence",
                    title="调查依据",
                    payload=evidence_payload,
                    technical_details=self._technical_details(
                        {"tool_history": tool_history},
                        tool_history=tool_history,
                    ),
                )
            )
        try:
            async with self.db.begin_nested():
                await learn_verified_aggregate_metric_candidate(
                    self.db,
                    run=run,
                    result_data=result_data,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(
                "Verified report persisted without optional metric candidate learning",
                analysis_run_id=str(run.id),
                error_type=type(exc).__name__,
                error=self._diagnostic_error(exc),
            )
        knowledge_proposals = (
            [] if suppress_standing_learning else result_data.get("knowledge_proposals") or []
        )
        selected_validation_keys = {
            str(item.get("relationship_key") or "") for item in required_validation_contract
        }
        if selected_validation_keys:
            knowledge_proposals = [
                proposal
                for proposal in knowledge_proposals
                if not (
                    proposal.get("entry_type") == "relationship"
                    and str(proposal.get("key") or "") in selected_validation_keys
                )
            ]
        confirmed_corrections = [
            item
            for item in (
                [] if suppress_standing_learning else result_data.get("confirmed_corrections") or []
            )
            if item.get("applied") and not item.get("conflict")
        ]
        for proposal in knowledge_proposals:
            existing_result = await self.db.execute(
                select(SemanticEntry).where(
                    SemanticEntry.project_id == run.project_id,
                    SemanticEntry.key == proposal.get("key"),
                )
            )
            existing = existing_result.scalar_one_or_none()
            if existing and (existing.state == "locked" or not existing.is_active):
                continue
            if (
                existing
                and existing.state == "candidate"
                and existing.source == "verified_analysis"
                and isinstance(existing.definition, dict)
                and existing.definition.get("kind") == "aggregate_metric"
            ):
                # This head was derived from system-owned result lineage. Model
                # proposals may suggest adjacent meaning, but cannot rewrite or
                # confirm the verified candidate in place. Promotion goes through
                # the governed semantic update/correction path.
                continue
            if existing:
                proposal_state = str(proposal.get("state") or "candidate")
                proposal_source = str(proposal.get("source") or "inferred")
                proposal_value = str(proposal.get("value") or existing.value)
                same_confirmed_meaning = proposal_value == existing.value
                same_verified_relationship = (
                    proposal_source == "verified_analysis"
                    and existing.entry_type == "relationship"
                    and proposal.get("definition") == existing.definition
                    and same_confirmed_meaning
                )
                explicit_same_value = (
                    proposal_state == "confirmed"
                    and proposal_source == "user"
                    and same_confirmed_meaning
                )
                if existing.state == "confirmed" and not (
                    same_verified_relationship or explicit_same_value
                ):
                    # Model-authored candidates may coexist conceptually, but
                    # they cannot mutate the confirmed materialized head.
                    continue
                previous_revision_id = existing.active_revision_id
                previous_execution_contract = (
                    existing.value,
                    existing.entry_type,
                    existing.definition,
                    existing.validity,
                )
                existing.value = proposal.get("value") or existing.value
                existing.evidence = proposal.get("evidence") or existing.evidence
                if proposal.get("entry_type"):
                    existing.entry_type = proposal["entry_type"]
                if proposal.get("definition"):
                    existing.definition = proposal["definition"]
                if proposal.get("validity") in {"active", "unverified", "stale"}:
                    existing.validity = proposal["validity"]
                existing.confidence = max(
                    existing.confidence, float(proposal.get("confidence", 0.5))
                )
                if proposal.get("state") == "confirmed":
                    existing.state = "confirmed"
                    existing.source = "user"
                    await resolve_confirmed_ambiguity(
                        self.db, run.project_id, str(proposal.get("key") or "")
                    )
                if previous_execution_contract != (
                    existing.value,
                    existing.entry_type,
                    existing.definition,
                    existing.validity,
                ):
                    reset_semantic_execution_proof(existing)
                await append_semantic_revision(
                    self.db,
                    existing,
                    mutation_kind="analysis_proposal",
                    actor_source=("user" if proposal.get("state") == "confirmed" else "inferred"),
                    reason="调查结果更新项目理解",
                    expected_active_revision_id=previous_revision_id,
                )
                if (
                    same_verified_relationship
                    and str(existing.id) in reusable_relationship_evidence_entry_ids
                ):
                    verified_relationship_transition_entry_ids.add(str(existing.id))
            else:
                entry = SemanticEntry(
                    project_id=run.project_id,
                    key=proposal.get("key") or "candidate",
                    value=proposal.get("value") or "",
                    entry_type=proposal.get("entry_type") or "business_rule",
                    state=proposal.get("state") or "candidate",
                    confidence=float(proposal.get("confidence", 0.5)),
                    definition=proposal.get("definition"),
                    validity=proposal.get("validity") or "active",
                    evidence=proposal.get("evidence") or [],
                    source=proposal.get("source") or "inferred",
                )
                self.db.add(entry)
                await self.db.flush()
                await append_semantic_revision(
                    self.db,
                    entry,
                    mutation_kind="analysis_proposal",
                    actor_source=entry.source,
                    reason="调查结果生成项目理解",
                )
                if proposal.get("state") == "confirmed":
                    await resolve_confirmed_ambiguity(
                        self.db, run.project_id, str(proposal.get("key") or "")
                    )

        validations = [
            item
            for item in tool_history
            if item.get("kind")
            in {"validation", "relationship_validation", "relationship_application"}
        ]
        query_step = next(
            (
                item
                for item in reversed(tool_history)
                if item.get("kind") in {"structured_query", "sql", "file_sql"}
            ),
            None,
        )
        has_confirmed_correction = any(
            proposal.get("state") == "confirmed" for proposal in knowledge_proposals
        ) or bool(confirmed_corrections)
        has_verified_report_correction = bool(
            correction_receipt and correction_receipt.get("status") == "verified"
        )
        has_confirmed_correction = has_confirmed_correction or has_verified_report_correction
        audited_rule_keys = {
            canonicalize_decision_key(str(item.get("rule_key") or ""))
            for item in tool_history
            if item.get("kind") == "business_rule_application"
        }
        corrections_requiring_audit = {
            canonicalize_decision_key(str(item.get("key") or ""))
            for item in confirmed_corrections
            if canonicalize_decision_key(str(item.get("key") or "")) == "revenue_refund_policy"
        }
        confirmed_corrections_are_audited = corrections_requiring_audit <= audited_rule_keys
        has_verified_confirmation = has_confirmed_correction and confirmed_corrections_are_audited
        contract_query = next(
            (
                str(item.get("task_query"))
                for item in confirmed_corrections
                if item.get("task_query")
            ),
            run.query,
        )
        if (
            self.execution_policy.diagnostics_enabled
            and state == "completed"
            and validations
            and query_step
        ):
            executed_sql = str(query_step.get("sql") or query_step.get("compiled_sql") or "")
            digest = hashlib.sha256(f"{contract_query}\n{executed_sql}".encode()).hexdigest()[:20]
            verified_key = f"verified_query:{digest}"
            verified_result = await self.db.execute(
                select(SemanticEntry).where(
                    SemanticEntry.project_id == run.project_id,
                    SemanticEntry.key == verified_key,
                )
            )
            verified = verified_result.scalar_one_or_none()
            verified_value = json.dumps(
                {
                    "question": contract_query,
                    "sql": executed_sql,
                    "result_name": query_step.get("result_name"),
                    "tool_plan": tool_history,
                },
                ensure_ascii=False,
            )
            verified_state = "confirmed" if has_verified_confirmation else "candidate"
            if verified is None:
                verified = SemanticEntry(
                    project_id=run.project_id,
                    key=verified_key,
                    value=verified_value,
                    entry_type="verified_query",
                    state=verified_state,
                    confidence=0.95 if has_verified_confirmation else 0.75,
                    evidence=validations,
                    source="verified_analysis",
                )
                self.db.add(verified)
                await self.db.flush()
                await append_semantic_revision(
                    self.db,
                    verified,
                    mutation_kind="verified_query",
                    actor_source="verified_analysis",
                    reason="保存已验证调查路径",
                )
            elif verified.state != "locked":
                previous_revision_id = verified.active_revision_id
                verified.value = verified_value
                verified.evidence = validations
                verified.confidence = max(
                    verified.confidence, 0.95 if has_verified_confirmation else 0.75
                )
                if has_verified_confirmation:
                    verified.state = "confirmed"
                await append_semantic_revision(
                    self.db,
                    verified,
                    mutation_kind="verified_query",
                    actor_source="verified_analysis",
                    reason="更新已验证调查路径",
                    expected_active_revision_id=previous_revision_id,
                )

        if (
            self.execution_policy.diagnostics_enabled
            and state == "completed"
            and has_confirmed_correction
            and validations
            and confirmed_corrections_are_audited
        ):
            project = await self.db.get(Project, run.project_id)
            if project is not None:
                context = await load_project_context(self.db, run.project_id)
                contract = build_golden_contract(
                    query=contract_query,
                    confirmed_knowledge=context.confirmed_knowledge,
                    sources=context.sources,
                    tool_history=tool_history,
                    result_rows=result_rows,
                )
                if contract is not None:
                    fingerprint = hashlib.sha256(
                        json.dumps(
                            {
                                "query_key": contract["query_key"],
                                "confirmed_knowledge": contract["confirmed_knowledge"],
                            },
                            sort_keys=True,
                            ensure_ascii=False,
                        ).encode()
                    ).hexdigest()[:20]
                    extra_data = dict(project.extra_data or {})
                    scenarios = list(extra_data.get("golden_scenarios") or [])
                    if not any(item.get("id") == fingerprint for item in scenarios):
                        scenarios.append(
                            {
                                **contract,
                                "id": fingerprint,
                                "created_at": datetime.now(UTC).isoformat(),
                                "reference_report": {
                                    "metrics": report.get("metrics") or [],
                                    "findings": report.get("findings") or [],
                                },
                            }
                        )
                    extra_data["golden_scenarios"] = scenarios[-100:]
                    project.extra_data = extra_data
        if correction is not None and correction_receipt is not None:
            correction_evidence = [
                item
                for item in (correction.evidence or [])
                if not (
                    item.get("kind") == "correction_application"
                    and item.get("analysis_run_id") == str(run.id)
                )
            ]
            persisted_receipt = {
                **correction_receipt,
                "analysis_run_id": str(run.id),
                "recorded_at": datetime.now(UTC).isoformat(),
            }
            correction.evidence = [*correction_evidence, persisted_receipt]
            if correction_receipt.get("status") == "verified":
                semantic_entry = await self.db.get(SemanticEntry, correction.semantic_entry_id)
                current_hash = (
                    stable_payload_hash(semantic_entry.definition)
                    if semantic_entry is not None and semantic_entry.definition
                    else None
                )
                if (
                    semantic_entry is None
                    or semantic_entry.project_id != run.project_id
                    or current_hash != correction_receipt.get("definition_hash")
                ):
                    raise CheckpointDriftError(
                        "业务定义在结果写入前发生变化，未把旧证据标记为已验证"
                    )
                if semantic_entry.entry_type == "relationship":
                    if semantic_entry.state != "locked":
                        semantic_entry.state = "confirmed"
                    semantic_entry.validity = "active"
                semantic_entry.execution_state = "verified"
                semantic_entry.execution_details = {
                    "version": 1,
                    "status": "verified",
                    "definition_hash": current_hash,
                    "last_verified_run_id": str(run.id),
                    "verified_at": persisted_receipt["recorded_at"],
                    "checks": list(correction_receipt.get("checks") or []),
                    "summary": correction_receipt.get("summary"),
                }
                semantic_entry.evidence = [
                    *list(semantic_entry.evidence or []),
                    persisted_receipt,
                ]
                await append_semantic_revision(
                    self.db,
                    semantic_entry,
                    mutation_kind="execution_verified",
                    actor_source="verified_analysis",
                    reason="报告修正已在最终结果中验证",
                    source_correction_id=str(correction.id),
                    expected_active_revision_id=semantic_entry.active_revision_id,
                )
        for semantic_entry, proof in verified_confirmation_proofs:
            previous_revision_id = semantic_entry.active_revision_id
            verified_at = datetime.now(UTC).isoformat()
            semantic_entry.execution_state = "verified"
            semantic_entry.execution_details = {
                "version": 1,
                "status": "verified",
                "definition_hash": proof.get("definition_hash"),
                "last_verified_run_id": str(run.id),
                "verified_at": verified_at,
                "checks": list(proof.get("checks") or []),
                "summary": "这项业务口径已在当前数据和最终结果中验证。",
            }
            semantic_entry.evidence = [
                *list(semantic_entry.evidence or []),
                {
                    **proof,
                    "kind": "semantic_execution_verification",
                    "analysis_run_id": str(run.id),
                    "recorded_at": verified_at,
                },
            ]
            await append_semantic_revision(
                self.db,
                semantic_entry,
                mutation_kind="execution_verified",
                actor_source="verified_analysis",
                reason="已确认口径在最终结果中通过验证",
                expected_active_revision_id=previous_revision_id,
            )
        semantic_transitions = await _build_run_owned_semantic_transitions(
            self.db,
            run,
            captured_semantic_heads,
            verified_relationship_transition_entry_ids,
        )
        if semantic_transitions:
            tool_history.extend(semantic_transitions)
            result_data["tool_history"] = list(tool_history)
        run.checkpoint = self._checkpoint_payload(
            run,
            tool_history=list(tool_history),
            updates={
                "semantic_revision_transitions": semantic_transitions,
                **(
                    {"semantic_validation_result": result_data["semantic_validation_result"]}
                    if isinstance(result_data.get("semantic_validation_result"), dict)
                    else {}
                ),
            },
        )
        if semantic_transitions:
            artifact_result = await self.db.execute(
                select(ArtifactRecord).where(ArtifactRecord.analysis_run_id == run.id)
            )
            for artifact in artifact_result.scalars():
                technical_details = dict(artifact.technical_details or {})
                if (
                    self.execution_policy.diagnostics_enabled
                    and "tool_history" in technical_details
                ):
                    technical_details["tool_history"] = list(tool_history)
                    artifact.technical_details = technical_details
                if artifact.kind == "evidence":
                    if self.execution_policy.diagnostics_enabled:
                        artifact.payload = {
                            **dict(artifact.payload or {}),
                            "semantic_revision_transitions": semantic_transitions,
                        }
                    else:
                        artifact.payload = {
                            "business_evidence": self.execution_policy.business_evidence(
                                tool_history
                            )
                        }
        await self.db.flush()
        return ResultPersistenceOutcome()

    async def _build_minimal_verified_report(
        self,
        *,
        run: AnalysisRun | None,
        engine: Any,
        error: BaseException,
        confirmation_receipt: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Build a table-only report from verified evidence after a schema failure."""

        if run is None or not _is_structured_report_output_error(error):
            return None
        verified = _verified_final_result_for_fallback(engine)
        if verified is None or not _required_playbook_receipt_is_satisfied(run, verified):
            return None
        project = await self.db.get(Project, run.project_id)
        if project is None:
            return None
        golden_contract = find_matching_contract(
            list((project.extra_data or {}).get("golden_scenarios") or []),
            run.query,
        )
        if golden_contract is not None and not any(
            item.get("kind") == "golden_regression_validation"
            and item.get("status") == "passed"
            and item.get("contract_id") == golden_contract.get("id")
            and item.get("result_name") == verified.result_name
            for item in verified.tool_history
        ):
            return None

        language = self.language if self.language == "en" else "zh"
        column_preview = (", " if language == "en" else "、").join(verified.columns[:12])
        if len(verified.columns) > 12:
            column_preview = t(
                "analysis.fallback_more_columns",
                language,
                columns=column_preview,
                count=len(verified.columns),
            )
        findings = [
            t(
                "analysis.fallback_table_shape",
                language,
                rows=len(verified.rows),
                columns=len(verified.columns),
                row_unit="row" if len(verified.rows) == 1 else "rows",
                column_unit="column" if len(verified.columns) == 1 else "columns",
            )
        ]
        if column_preview:
            findings.append(
                t(
                    "analysis.fallback_columns",
                    language,
                    columns=column_preview,
                )
            )
        report = {
            "status": "completed",
            "title": t("analysis.fallback_title", language),
            "summary": t("analysis.fallback_summary", language),
            "primary_result": verified.result_name,
            "findings": findings,
            "metrics": [],
            "evidence": [t("analysis.fallback_evidence", language)],
            "next_actions": [],
            "follow_ups": [],
            "visualization": None,
        }
        fallback_marker = {
            "version": 1,
            "kind": "minimal_verified_report_fallback",
            "status": "used",
            "reason_code": "MODEL_REPORT_OUTPUT_INVALID",
            "result_name": verified.result_name,
            "result_hash": verified.result_hash,
            "validation_hash": stable_payload_hash(verified.validation),
            "rows_count": len(verified.rows),
            "columns": verified.columns,
            "technical_error": f"{type(error).__name__}: {str(error)}"[:2000],
            "recorded_at": datetime.now(UTC).isoformat(),
        }
        tool_history = [*verified.tool_history, fallback_marker]
        last_sql = next(
            (
                item.get("sql") or item.get("compiled_sql")
                for item in reversed(tool_history)
                if item.get("kind") in {"structured_query", "sql", "file_sql"}
            ),
            None,
        )
        result_data = {
            "analysis_state": "completed",
            "report": report,
            "data": verified.rows,
            "rows_count": len(verified.rows),
            "result_name": verified.result_name,
            "sql": last_sql,
            "python": None,
            "python_images": [],
            "visualization": None,
            "tool_history": tool_history,
            "knowledge_proposals": [],
            "confirmed_corrections": (
                [confirmation_receipt]
                if confirmation_receipt
                and confirmation_receipt.get("applied")
                and not confirmation_receipt.get("conflict")
                else []
            ),
            "semantic_engine": str(
                getattr(getattr(engine, "semantic_adapter", None), "status", "internal")
            ),
            "report_fallback": fallback_marker,
        }
        return result_data

    async def _complete_result(
        self,
        run: AnalysisRun | None,
        result_data: dict[str, Any],
        events: list[SSEEvent],
        completion: AnalysisCompletion,
    ) -> list[SSEEvent]:
        transaction = (
            self._journal_for(run).transaction(completion)
            if run is not None
            else completion.transaction()
        )
        async with transaction:
            outcome = (
                await self._stage_project_result(run, result_data)
                if run is not None
                else ResultPersistenceOutcome()
            )
            if outcome.accepted:
                terminal_events = []
                for event in events:
                    if event.type.value == "result":
                        event.data.update(
                            {
                                key: value
                                for key, value in result_data.items()
                                if key not in {"python_images", "visualization", "report_fallback"}
                            }
                        )
                    public_event = self._public_event(event)
                    if public_event is not None:
                        terminal_events.append(public_event)
            else:
                terminal_events = [
                    SSEEvent.error(
                        outcome.error_code or "VERIFIED_RESULT_REJECTED",
                        outcome.message or "这次结果未通过可信检查",
                        error_category="validation",
                        failed_stage="validation",
                        correction_application=outcome.correction_application,
                        **self._run_event_context(run),
                    )
                ]
            await completion.stage(terminal_events)
        return terminal_events

    async def execute_stream(
        self,
        query: str,
        conversation_id: UUID,
        exclude_message_id: UUID | None = None,
        stop_checker: Callable[[], bool] | None = None,
        finalization_guard: Callable[[], bool] | None = None,
        resume_run_id: UUID | None = None,
        correction_id: UUID | None = None,
        completion: AnalysisCompletion | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """Stream execution results with proper error handling per D-03, D-04.

        Per D-04: Use specific exception types instead of bare except.
        Per D-03: Detailed diagnostic logging via structlog, concise errors to client.
        """
        run: AnalysisRun | None = None
        project_result_data: dict[str, Any] | None = None
        project_python_images: list[str] = []
        project_visualization: dict[str, Any] | None = None
        buffered_terminal_events: list[SSEEvent] = []
        engine: Any | None = None
        confirmation_receipt: dict[str, Any] | None = None
        finalization_claimed = False
        completion = completion or AnalysisCompletion(self.db)

        def claim_finalization() -> bool:
            nonlocal finalization_claimed
            if finalization_claimed:
                return True
            if finalization_guard is not None and not finalization_guard():
                return False
            finalization_claimed = True
            return True

        try:
            inputs = await self._load_execution_inputs(
                conversation_id=conversation_id,
                exclude_message_id=exclude_message_id,
            )
            (
                run,
                effective_query,
                resume_checkpoint,
                stored_confirmation_receipt,
            ) = await self._prepare_analysis_run(
                query=query,
                conversation_id=conversation_id,
                resume_run_id=resume_run_id,
                correction_id=correction_id,
            )
            self.analysis_run_id = run.id if run is not None else None
            if run is not None:
                self._journal_for(run)
            confirmation_receipt = stored_confirmation_receipt
            if confirmation_receipt is None and resume_run_id is None:
                confirmation_receipt = await self._persist_explicit_confirmation(
                    inputs.history,
                    effective_query,
                )
            engine_or_awaitable = self._build_engine(
                inputs,
                run=run,
                resume_checkpoint=resume_checkpoint,
            )
            engine = (
                await engine_or_awaitable
                if isawaitable(engine_or_awaitable)
                else engine_or_awaitable
            )
            logger.info(
                "Starting engine execution",
                conversation_id=str(conversation_id),
                model=inputs.model_config.model,
                analysis_run_id=str(run.id) if run else None,
                resumed=resume_run_id is not None,
            )
            async with aclosing(
                engine.execute(
                    query=effective_query,
                    history=inputs.history,
                    stop_checker=stop_checker,
                )
            ) as events:
                async for event in events:
                    if run:
                        context = self._journal_for(run).event_context
                        for key in ("analysis_run_id", "project_id", "resumable"):
                            event.data[key] = context[key]
                    buffer_event = bool(buffered_terminal_events) or event.is_terminal_progress
                    if run and event.type.value == "progress":
                        if event.is_terminal_progress:
                            buffer_event = True
                        else:
                            await self._journal_for(run).progress(event.data)
                    if event.type.value == "result":
                        if (event.data.get("report") or {}).get("status") == "needs_data":
                            event.data["resumable"] = True
                        event.data["confirmed_corrections"] = (
                            [confirmation_receipt]
                            if confirmation_receipt
                            and confirmation_receipt.get("applied")
                            and not confirmation_receipt.get("conflict")
                            else []
                        )
                        project_result_data = dict(event.data)
                        buffer_event = True
                    if event.type.value == "python_image":
                        image = event.data.get("image")
                        if image:
                            project_python_images.append(str(image))
                    if event.type.value == "visualization":
                        project_visualization = event.data.get("chart")
                    if buffer_event:
                        buffered_terminal_events.append(event)
                    else:
                        public_event = self._public_event(event)
                        if public_event is not None:
                            yield public_event
            # Only the runtime's successful Agent.run marks provider health.
            # Some investigations can stop for deterministic confirmation
            # before any model request, so iterator completion alone is not
            # sufficient evidence.
            if bool(getattr(engine, "model_request_succeeded", False)):
                await self.resolver.record_model_health(healthy=True, commit=False)
            if project_result_data is not None:
                project_result_data["python_images"] = project_python_images
                project_result_data["visualization"] = project_visualization
                if not claim_finalization():
                    raise _AnalysisFinalizationStoppedError("分析已在结果保存前停止")
                terminal_events = await self._complete_result(
                    run, project_result_data, buffered_terminal_events, completion
                )
                for event in terminal_events:
                    yield event
            elif buffered_terminal_events:
                raise RuntimeError("调查结束前没有生成可持久化的最终结果")

        except (asyncio.CancelledError, GeneratorExit) as exc:
            if not completion.committed:
                with CancelScope(shield=True):
                    await self._mark_run_needs_attention(run, exc)
            raise

        except AnalysisRunOwnershipError:
            yield SSEEvent.error(
                "CANCELLED",
                "这次调查已结束或已由新的执行接续",
                error_category="cancelled",
                failed_stage="execution",
                **self._run_event_context(run),
            )
            return

        except _AnalysisFinalizationStoppedError as exc:
            await self._mark_run_needs_attention(run, exc)
            yield SSEEvent.error(
                "CANCELLED",
                "分析已暂停，已保存的安全步骤可以继续使用",
                error_category="cancelled",
                failed_stage="finalization",
                **self._run_event_context(run),
            )
            return

        except (OperationalError, ProgrammingError) as exc:
            # SQL errors with categorization
            error_code, category, _ = categorize_sql_error(str(exc))
            logger.error(
                "SQL error during execution",
                error_code=error_code,
                error_category=category,
                conversation_id=str(conversation_id),
                exception_detail=self._diagnostic_error(exc),
            )
            await self._mark_run_needs_attention(run, exc)
            yield SSEEvent.error(
                error_code,
                "数据库查询执行失败，请检查查询语句",
                error_category="sql",
                failed_stage="execution",
                **self._run_event_context(run),
            )

        except SQLAlchemyError as exc:
            # General SQLAlchemy errors
            logger.error(
                "SQLAlchemy error during execution",
                conversation_id=str(conversation_id),
                exception_detail=self._diagnostic_error(exc),
                error_type=type(exc).__name__,
            )
            await self._mark_run_needs_attention(run, exc)
            yield SSEEvent.error(
                "DB_ERROR",
                "数据库操作失败",
                error_category="database",
                failed_stage="execution",
                **self._run_event_context(run),
            )

        except (ModelCredentialError, ModelRuntimeConfigurationError) as exc:
            # Explicit persisted model boundaries fail closed. In particular,
            # never replace an unreadable key or missing model with process-wide
            # OpenAI environment settings.
            await self._mark_run_needs_attention(run, exc)
            code, message, category = _public_model_error(exc) or (
                "MODEL_CONFIGURATION_ERROR",
                "分析服务配置不可用，请修复或更换服务。",
                "model_endpoint",
            )
            await self._record_model_failure_safely(category)
            yield SSEEvent.error(
                code,
                message,
                error_category=category,
                failed_stage="model_request",
                **self._run_event_context(run),
            )

        except TimeoutError as exc:
            # Timeout errors - these are expected in some scenarios
            logger.warning(
                "Timeout during execution",
                conversation_id=str(conversation_id),
            )
            await self._mark_run_needs_attention(run, exc)
            yield SSEEvent.error(
                "TIMEOUT",
                "执行超时，请重试或简化查询",
                error_category="timeout",
                failed_stage="execution",
                **self._run_event_context(run),
            )

        except SemanticRevisionConflictError:
            await self.db.rollback()
            drift_error = SemanticValidationSelectionError(
                "所选关联候选在调查期间发生了版本变化，旧证据没有被记为已验证"
            )
            await self._mark_run_needs_attention(run, drift_error)
            yield SSEEvent.error(
                "SEMANTIC_VALIDATION_SELECTION_DRIFT",
                str(drift_error),
                error_category="validation",
                failed_stage="validation",
                **self._run_event_context(run),
            )

        except SemanticValidationSelectionError as exc:
            await self._mark_run_needs_attention(run, exc)
            yield SSEEvent.error(
                "SEMANTIC_VALIDATION_SELECTION_DRIFT",
                str(exc),
                error_category="validation",
                failed_stage="validation",
                **self._run_event_context(run),
            )

        except ValueError as exc:
            # Validation errors from input/context resolution
            logger.warning(
                "Validation error during execution",
                conversation_id=str(conversation_id),
                exception_detail=self._diagnostic_error(exc),
            )
            await self._mark_run_needs_attention(run, exc)
            yield SSEEvent.error(
                "VALIDATION_ERROR",
                "输入参数无效",
                error_category="validation",
                failed_stage="execution",
                **self._run_event_context(run),
            )

        except CheckpointError as exc:
            logger.warning(
                "Analysis checkpoint cannot be resumed",
                conversation_id=str(conversation_id),
                analysis_run_id=str(self.analysis_run_id) if self.analysis_run_id else None,
                exception_detail=self._diagnostic_error(exc),
            )
            await self._mark_run_needs_attention(run, exc)
            yield SSEEvent.error(
                "RESUME_UNAVAILABLE",
                str(exc),
                error_category="checkpoint",
                failed_stage="restoring",
                **self._run_event_context(run),
            )

        except RuntimeError as exc:
            # Runtime errors from execution engine
            if isinstance(exc, AnalystStoppedError):
                await self._mark_run_needs_attention(run, exc)
                yield SSEEvent.error(
                    "CANCELLED",
                    "分析已暂停，已保存的安全步骤可以继续使用",
                    error_category="cancelled",
                    failed_stage="execution",
                    **self._run_event_context(run),
                )
                return
            fallback_events: list[SSEEvent] | None = None
            try:
                fallback_result = await self._build_minimal_verified_report(
                    run=run,
                    engine=engine,
                    error=exc,
                    confirmation_receipt=confirmation_receipt,
                )
                if fallback_result is not None:
                    assert run is not None
                    if not claim_finalization():
                        raise _AnalysisFinalizationStoppedError("分析已在结果保存前停止")
                    context = {
                        "analysis_run_id": str(run.id),
                        "project_id": str(run.project_id),
                        "analysis_state": "completed",
                        "resumable": False,
                    }
                    completed_progress = SSEEvent.progress(
                        "completed",
                        get_progress_message("business_explanation_unavailable", self.language),
                        step="business_explanation_unavailable",
                        **context,
                    )
                    report = fallback_result["report"]
                    content = "\n\n".join(
                        [
                            f"## {report['title']}",
                            str(report["summary"]),
                            "\n".join(f"- {finding}" for finding in report.get("findings") or []),
                        ]
                    )
                    result_event = SSEEvent.result(content, **context)
                    fallback_events = await self._complete_result(
                        run, fallback_result, [completed_progress, result_event], completion
                    )
            except _AnalysisFinalizationStoppedError as cancellation:
                await self.db.rollback()
                await self._mark_run_needs_attention(run, cancellation)
                yield SSEEvent.error(
                    "CANCELLED",
                    "分析已暂停，已保存的安全步骤可以继续使用",
                    error_category="cancelled",
                    failed_stage="finalization",
                    **self._run_event_context(run),
                )
                return
            except (asyncio.CancelledError, GeneratorExit) as cancellation:
                with CancelScope(shield=True):
                    await self.db.rollback()
                    await self._mark_run_needs_attention(run, cancellation)
                raise
            except Exception as fallback_error:
                await self.db.rollback()
                logger.exception("Unable to complete the verified table-only report")
                exc = fallback_error
            if fallback_events is not None:
                for event in fallback_events:
                    yield event
                return
            logger.exception(
                "Runtime error during execution",
                conversation_id=str(conversation_id),
                exception_detail=self._diagnostic_error(exc),
            )
            await self._mark_run_needs_attention(run, exc)
            model_error = _public_model_error(exc)
            if model_error is not None:
                code, message, category = model_error
                await self._record_model_failure_safely(category)
                yield SSEEvent.error(
                    code,
                    message,
                    error_category=category,
                    failed_stage="model_request",
                    **self._run_event_context(run),
                )
                return
            resumable = bool(self._run_event_context(run).get("resumable"))
            diagnostic = build_diagnostic_entry(
                attempt=1,
                phase="execution",
                status="error",
                message=f"{type(exc).__name__}: {str(exc) or 'runtime error'}",
                error_code="RUNTIME_ERROR",
                error_category="execution",
                recoverable=resumable,
            )
            yield SSEEvent.error(
                "RUNTIME_ERROR",
                (
                    "分析执行时遇到内部错误，已保存完成的步骤，可以继续调查。"
                    if resumable
                    else "分析执行时遇到内部错误，请重新调查。"
                ),
                error_category="execution",
                failed_stage="execution",
                **(
                    {"diagnostics": [diagnostic]}
                    if self.execution_policy.diagnostics_enabled
                    else {}
                ),
                **self._run_event_context(run),
            )

        except Exception as exc:
            # Unexpected exceptions
            logger.exception(
                "Unexpected error during execution stream",
                conversation_id=str(conversation_id),
                error_type=type(exc).__name__,
                exception_detail=self._diagnostic_error(exc),
            )
            await self._mark_run_needs_attention(run, exc)
            model_error = _public_model_error(exc)
            if model_error is not None:
                code, message, category = model_error
                await self._record_model_failure_safely(category)
                yield SSEEvent.error(
                    code,
                    message,
                    error_category=category,
                    failed_stage="model_request",
                    **self._run_event_context(run),
                )
                return
            diagnostic = build_diagnostic_entry(
                attempt=1,
                phase="execution",
                status="error",
                message=f"{type(exc).__name__}: {str(exc) or 'unexpected error'}",
                error_code="INTERNAL_ERROR",
                error_category="execution",
                recoverable=False,
            )
            yield SSEEvent.error(
                "INTERNAL_ERROR",
                "分析执行时遇到未预期的问题，请重新调查。",
                error_category="execution",
                failed_stage="execution",
                **(
                    {"diagnostics": [diagnostic]}
                    if self.execution_policy.diagnostics_enabled
                    else {}
                ),
                **self._run_event_context(run),
            )

    def _run_event_context(self, run: AnalysisRun | None) -> dict[str, Any]:
        if run is None:
            return self._run_journal.event_context if self._run_journal is not None else {}
        return self._journal_for(run).event_context

    async def _mark_run_needs_attention(
        self,
        run: AnalysisRun | None,
        error: BaseException,
    ) -> None:
        if run is None:
            if self._run_journal is None:
                return
            run = self._run_journal.run
        journal = self._journal_for(run)
        try:
            if isinstance(error, SQLAlchemyError):
                await self.db.rollback()
            async with journal.transaction(include_attention=True):
                if isinstance(error, GeneratorExit):
                    reason = "client_disconnected"
                    stage = "paused"
                elif isinstance(error, (AnalystStoppedError, asyncio.CancelledError)):
                    reason = "user_stopped"
                    stage = "paused"
                elif isinstance(error, CheckpointDriftError):
                    reason = "checkpoint_drift"
                    stage = "needs_attention"
                elif isinstance(error, CheckpointError):
                    reason = "checkpoint_unavailable"
                    stage = "needs_attention"
                elif isinstance(error, SemanticValidationSelectionError):
                    reason = "semantic_validation_selection_drift"
                    stage = "needs_attention"
                elif isinstance(error, TimeoutError):
                    reason = "timeout"
                    stage = "needs_attention"
                else:
                    reason = "execution_error"
                    stage = "needs_attention"
                checkpoint_updates: dict[str, Any] = {}
                if isinstance(error, (CheckpointError, SemanticValidationSelectionError)):
                    checkpoint_updates["resumable"] = False
                persisted_error = (
                    (str(error) or reason)[:4000]
                    if self.execution_policy.diagnostics_enabled
                    else reason
                )
                checkpoint_updates.update({"reason": reason, "last_error": persisted_error})
                checkpoint = self.execution_policy.checkpoint_payload(
                    run.checkpoint,
                    updates=checkpoint_updates,
                )
                run.state = "needs_attention"
                run.stage = stage
                run.error = persisted_error
                run.checkpoint = checkpoint
                try:
                    await mark_standing_run_needs_attention(
                        self.db,
                        run,
                        "这次持续分析未能完成，上一版可信结果保持不变",
                        reason_code="standing_execution_failed",
                    )
                except (StandingCompletionError, ValueError):
                    logger.exception(
                        "Unable to update standing analysis failure state",
                        run_id=str(run.id),
                    )
        except AnalysisRunOwnershipError:
            return
        except SQLAlchemyError:
            logger.exception("Unable to persist failed analysis run", run_id=str(journal.run_id))
