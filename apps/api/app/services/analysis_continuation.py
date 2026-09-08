"""Choose a continuation from durable business state, without IO or engine code."""

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from app.services.business_decision_slots import canonicalize_decision_key
from app.services.checkpoint_contract import CheckpointError


@dataclass(frozen=True)
class AnalysisContinuation:
    query: str
    stage: str
    checkpoint: dict[str, Any]
    receipt: dict[str, Any] | None = None
    restore_snapshot: bool = False


def plan_analysis_continuation(
    *, state: str, stage: str, query: str, checkpoint: dict[str, Any], started_at: str
) -> AnalysisContinuation:
    checkpoint = deepcopy(checkpoint)
    standing = checkpoint.get("standing_analysis")
    if state == "understanding" and stage == "prepared" and isinstance(standing, dict):
        checkpoint.update(
            standing_analysis={**standing, "started_at": started_at},
            reason="standing_analysis_started",
        )
        return AnalysisContinuation(query, "understanding", checkpoint)

    receipt = checkpoint.get("confirmation_receipt")
    if isinstance(receipt, dict):
        key = str(receipt.get("key") or "").strip()
        if key:
            receipt["key"] = canonicalize_decision_key(key)
    valid_receipt = (
        isinstance(receipt, dict) and receipt.get("applied") and not receipt.get("conflict")
    )
    kind = checkpoint.get("continuation_kind")
    if state == "waiting_confirmation":
        if (
            stage != "confirmation_received"
            or checkpoint.get("confirmation_receipt_status") != "pending"
            or not valid_receipt
        ):
            raise CheckpointError("这次调查尚未收到可用的业务确认")
        kind = "confirmation"
        checkpoint["confirmation_consumed_at"] = started_at
    elif state == "needs_attention":
        if checkpoint.get("reason") == "awaiting_data":
            kind = "data"
        elif kind not in {"confirmation", "data"}:
            kind = None
            if not checkpoint.get("resumable"):
                raise CheckpointError("这次调查当前没有可恢复的安全检查点")
    else:
        raise CheckpointError("这次调查已在运行或已经完成")

    if kind == "confirmation" and not valid_receipt:
        raise CheckpointError("这次调查没有可重新使用的业务确认")
    if kind in {"confirmation", "data"}:
        checkpoint.update(continuation_kind=kind, resumable=True, reason=f"{kind}_in_progress")
        if kind == "confirmation":
            checkpoint["confirmation_receipt_status"] = "in_progress"
        next_stage = "confirmation_received" if kind == "confirmation" else "data_received"
    else:
        next_stage = "restoring"

    used_receipt = receipt if valid_receipt and kind != "data" else None
    if used_receipt is not None:
        selected = str(used_receipt.get("selected_value") or used_receipt.get("value") or "")
        query = f"{query}\n\n用户已确认业务口径：{used_receipt.get('key')} = {selected}"
    return AnalysisContinuation(query, next_stage, checkpoint, used_receipt, kind is None)
