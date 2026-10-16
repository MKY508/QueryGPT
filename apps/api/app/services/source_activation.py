"""One activation boundary for source discovery, semantics and analysis.

Being current is not proof of readiness: ordinary business ambiguities still
use the existing confirmation gate. This only excludes retired versions and
file versions whose activation or cleaning-method compatibility is unresolved.
"""

from collections.abc import Mapping
from typing import Any

from app.db.tables import ProjectDataSource

BLOCKING_FILE_DRIFT_ISSUE_CODES = frozenset({"recipe_replay_drift", "recipe_input_changed"})


def file_source_blockers(kind: str, profile: Mapping[str, Any]) -> set[str]:
    if kind != "file":
        return set()
    issues = profile.get("issues")
    blockers = (
        {
            str(item.get("code") or "")
            for item in issues
            if isinstance(item, Mapping)
            and str(item.get("code") or "") in BLOCKING_FILE_DRIFT_ISSUE_CODES
        }
        if isinstance(issues, list)
        else set()
    )
    if str(profile.get("activation_state") or "") == "pending_confirmation":
        blockers.add("activation_pending")
    return blockers


def is_current_source(source: ProjectDataSource) -> bool:
    profile = source.profile_data if isinstance(source.profile_data, Mapping) else {}
    return (
        source.status != "superseded"
        and profile.get("is_current") is not False
        # Legacy snapshots may carry only a blocking issue, without either
        # is_current or activation_state. They must not compete with the last
        # accepted version for the same logical binding.
        and not file_source_blockers(source.kind, profile)
    )
