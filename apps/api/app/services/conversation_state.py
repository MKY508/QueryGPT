"""Generation-owned writes to the current conversation, independent of its history."""

from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Conversation

ACTIVE_STREAM_ATTEMPT = "active_stream_attempt_id"


@dataclass(frozen=True)
class ConversationTurnState:
    conversation_id: UUID
    attempt_id: str

    async def claim(self, db: AsyncSession, *, is_current: Callable[[], bool]) -> bool:
        """Install this generation only while it still owns the local request slot."""
        conversation = await self._lock(db, owned=False)
        if conversation is None or not is_current():
            return False
        conversation.extra_data = {
            **(conversation.extra_data or {}),
            ACTIVE_STREAM_ATTEMPT: self.attempt_id,
        }
        await self._write(db, conversation)
        return True

    async def apply(
        self,
        db: AsyncSession,
        mutation: Callable[[Conversation], None],
    ) -> bool:
        """Stage a mutation only for the stored owner; the caller commits it."""
        conversation = await self._lock(db, owned=True)
        if conversation is None:
            return False
        mutation(conversation)
        await self._write(db, conversation)
        return True

    async def _lock(self, db: AsyncSession, *, owned: bool) -> Conversation | None:
        statement = update(Conversation).where(Conversation.id == self.conversation_id)
        if owned:
            statement = statement.where(
                Conversation.extra_data[ACTIVE_STREAM_ATTEMPT].as_string() == self.attempt_id
            )
        # A conditional write acquires the row on PostgreSQL and SQLite alike.
        # RETURNING reads the current values under that lock, not a stale ORM
        # identity-map snapshot. No model or tool work runs under this lock.
        result = await db.execute(
            statement.values(updated_at=Conversation.updated_at)
            .returning(
                Conversation.id,
                Conversation.status,
                Conversation.model_id,
                Conversation.connection_id,
                Conversation.extra_data,
            )
            .execution_options(synchronize_session=False)
        )
        row = result.mappings().one_or_none()
        return Conversation(**dict(row)) if row is not None else None

    async def _write(self, db: AsyncSession, conversation: Conversation) -> None:
        await db.execute(
            update(Conversation)
            .where(Conversation.id == self.conversation_id)
            .values(
                status=conversation.status,
                model_id=conversation.model_id,
                connection_id=conversation.connection_id,
                extra_data={
                    **(conversation.extra_data or {}),
                    ACTIVE_STREAM_ATTEMPT: self.attempt_id,
                },
            )
            .execution_options(synchronize_session="fetch")
        )
