"""Business confirmation identity and restored project proposals."""

from __future__ import annotations

from typing import Any

from app.i18n import t
from app.models.analysis import (
    ConfirmationRequest,
)
from app.services.business_decision_slots import (
    REVENUE_REFUND_POLICY,
    canonicalize_decision_key,
)
from app.services.correction_completion import (
    is_reusable_full_relationship_evidence,
)


def _canonical_confirmation_key(payload: dict[str, Any]) -> str:
    """Canonicalize a persisted/history confirmation without requiring it to be typed."""

    raw_key = str(payload.get("key") or "").strip()
    if not raw_key:
        return ""
    raw_options = payload.get("options")
    options = [str(option) for option in raw_options] if isinstance(raw_options, list) else []
    return canonicalize_decision_key(
        raw_key,
        question=str(payload.get("question") or ""),
        reason=str(payload.get("reason") or ""),
        options=options,
    )


_REFUND_OPTION_CODES = {
    "扣除退款": "exclude_refunds",
    "保留退款订单": "include_refunds",
    "按现有净额字段": "use_existing_net_amount",
    "exclude_refunds": "exclude_refunds",
    "include_refunds": "include_refunds",
    "use_existing_net_amount": "use_existing_net_amount",
}


def _localized_preflight_confirmation(
    raw_ambiguity: dict[str, Any],
    *,
    key: str,
    language: str,
) -> ConfirmationRequest:
    """Localize only system-owned preflight prose while preserving source values."""

    payload = {**raw_ambiguity, "key": key}
    presentation_code = str(payload.get("presentation_code") or "").strip()
    facts = payload.get("presentation_facts")
    presentation_facts = (
        {str(name): str(value) for name, value in facts.items()} if isinstance(facts, dict) else {}
    )
    raw_options = [str(option) for option in payload.get("options") or []]

    if key == REVENUE_REFUND_POLICY:
        presentation_code = "preflight.revenue_refund_policy"
        payload["question"] = t("analysis.preflight_refund_question", language)
        payload["reason"] = t("analysis.preflight_refund_reason", language)
        raw_codes = payload.get("option_codes")
        option_codes = dict(raw_codes) if isinstance(raw_codes, dict) else {}
        payload["option_codes"] = {
            option: str(option_codes.get(option) or _REFUND_OPTION_CODES.get(option) or "")
            for option in raw_options
            if option_codes.get(option) or _REFUND_OPTION_CODES.get(option)
        }
    elif key == "excel_sheet_selection" or key.startswith("excel_sheet_selection:"):
        presentation_code = "preflight.excel_sheet_selection"
        selected_sheet = presentation_facts.get("selected_sheet", "").strip()
        if selected_sheet:
            payload["question"] = t("analysis.preflight_excel_question_selected", language).format(
                sheet=selected_sheet
            )
        else:
            payload["question"] = t("analysis.preflight_excel_question", language)
        payload["reason"] = t("analysis.preflight_excel_reason", language)

    if presentation_code:
        payload["presentation_code"] = presentation_code
    if presentation_facts:
        payload["presentation_facts"] = presentation_facts
    return ConfirmationRequest.model_validate(payload)


_REVENUE_INTENT_TERMS = (
    "收入",
    "营收",
    "销售额",
    "销售",
    "gmv",
    "实付",
    "支付金额",
    "金额",
    "退款",
    "净额",
    "毛利",
    "利润",
    "revenue",
    "sales",
    "refund",
    "amount",
    "profit",
)


def _restore_safe_knowledge_proposals(
    proposals: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Drop legacy relationship proposals that no longer meet the proof contract."""

    restored: list[dict[str, Any]] = []
    for proposal in proposals:
        if not isinstance(proposal, dict):
            continue
        is_relationship = proposal.get("entry_type") == "relationship" or str(
            proposal.get("key") or ""
        ).startswith("relationship:")
        if not is_relationship:
            restored.append(proposal)
            continue
        relationship_evidence = [
            item
            for item in proposal.get("evidence") or []
            if isinstance(item, dict)
            and (
                item.get("kind") == "relationship_observation"
                or item.get("evidence_scope") is not None
            )
        ]
        if relationship_evidence and is_reusable_full_relationship_evidence(
            relationship_evidence[-1]
        ):
            restored.append(proposal)
    return restored
