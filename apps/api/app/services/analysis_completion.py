"""One commit for terminal run changes and their user-facing transcript."""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass

from anyio import CancelScope
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SSEEvent


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
            with CancelScope(shield=True):
                task = asyncio.create_task(self._commit())
                cancellation: asyncio.CancelledError | None = None
                while not task.done():
                    try:
                        await asyncio.shield(task)
                    except asyncio.CancelledError as exc:
                        if task.cancelled():
                            raise
                        cancellation = exc
                task.result()
                if cancellation is not None:
                    raise cancellation
        except BaseException:
            if not self.committed:
                with CancelScope(shield=True):
                    await self.db.rollback()
            raise

    async def _commit(self) -> None:
        # Keep the commit alive and observe its outcome before propagating a
        # caller cancellation. Otherwise a committed turn could be marked failed.
        await self.db.commit()
        self.committed = True

    async def stage(self, events: Sequence[SSEEvent]) -> None:
        if self.stage_transcript is not None:
            await self.stage_transcript(events)
