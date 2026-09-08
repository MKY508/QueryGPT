"""Checkpoint values and integrity rules; no storage or model dependencies."""

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

CHECKPOINT_VERSION = 1


class CheckpointError(RuntimeError):
    """Base error for a checkpoint that cannot be resumed safely."""


class CheckpointDriftError(CheckpointError):
    """Raised when sources or deterministic replay outputs have changed."""


@dataclass(slots=True)
class RestoredCheckpoint:
    manifest: dict[str, Any]
    dataframes: dict[str, list[dict[str, Any]]]
    python_output: list[str] = field(default_factory=list)
    python_images: list[str] = field(default_factory=list)


def stable_payload_hash(value: Any) -> str:
    """Return a deterministic digest for tool inputs and outputs."""

    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
