"""Core application scaffolding and shared runtime state."""

from .service_container import ServiceContainer, service_container

__all__ = [
    "ServiceContainer",
    "service_container",
]
