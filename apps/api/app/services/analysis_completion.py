"""One commit for terminal run changes and their user-facing transcript."""

from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SSEEvent
from app.services.run_control import finish_before_cancellation


@dataclass
class AnalysisCompletion:
    db: AsyncSession
    stage_transcript: Callable[[Sequence[SSEEvent]], Awaitable[None]] | None = None
    committed: bool = False

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        """Own the current session transaction; never yield events from this block."""
        if self.committed:
            raise RuntimeError("This investigation already has a durable completion")
        try:
            yield
            await finish_before_cancellation(self._commit())
        except BaseException:
            if not self.committed:
                await finish_before_cancellation(self.db.rollback())
            raise

    async def _commit(self) -> None:
        # Keep the commit alive and observe its outcome before propagating a
        # caller cancellation. Otherwise a committed turn could be marked failed.
        await self.db.commit()
        self.committed = True

    async def stage(self, events: Sequence[SSEEvent]) -> None:
        if self.stage_transcript is not None:
            await self.stage_transcript(events)
