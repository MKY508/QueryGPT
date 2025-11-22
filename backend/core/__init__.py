"""Core application scaffolding and shared runtime state."""

from .container import ServiceContainer, service_container

__all__ = [
    "ServiceContainer",
    "service_container",
]
