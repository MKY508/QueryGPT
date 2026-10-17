"""Core module"""

from typing import TYPE_CHECKING, Any

from app.core.config import settings

if TYPE_CHECKING:
    from app.core.security import encryptor, mask_secret

__all__ = [
    "settings",
    "encryptor",
    "mask_secret",
]


def __getattr__(name: str) -> Any:
    if name in {"encryptor", "mask_secret"}:
        from app.core import security

        return getattr(security, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
