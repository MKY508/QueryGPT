"""Own the analysis event stream for the complete ASGI response lifetime."""

from collections.abc import AsyncGenerator

from anyio import CancelScope
from sse_starlette.sse import EventSourceResponse
from starlette.types import Receive, Scope, Send


class AnalysisStreamResponse(EventSourceResponse):
    def __init__(self, events: AsyncGenerator[dict[str, str], None]):
        self._events = events
        super().__init__(
            events,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            # The consumer can stop while sending a yielded event, outside the
            # generator. Join the response tasks before closing its producer.
            with CancelScope(shield=True):
                await self._events.aclose()
