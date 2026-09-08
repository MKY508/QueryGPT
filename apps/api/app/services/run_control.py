"""Engine-independent cancellation and wall-clock deadline for one task."""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import TypeVar

from anyio import CancelScope

ResultT = TypeVar("ResultT")
ProgressT = TypeVar("ProgressT")


class AnalystStoppedError(RuntimeError):
    pass


@contextlib.asynccontextmanager
async def owned_task(
    operation: Callable[[], Awaitable[ResultT]],
) -> AsyncIterator[asyncio.Future[ResultT]]:
    """Join child work before its owner exits, even inside an ASGI cancel scope."""
    task = asyncio.ensure_future(operation())
    try:
        yield task
    finally:
        with CancelScope(shield=True):
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            elif not task.cancelled():
                task.exception()


async def next_task_progress(
    task: asyncio.Future[ResultT],
    progress: asyncio.Queue[ProgressT],
) -> ProgressT | None:
    """Wait for a milestone or task completion; None means no progress remains."""
    if task.done():
        task.result()
        return progress.get_nowait() if not progress.empty() else None
    async with owned_task(progress.get) as milestone:
        await asyncio.wait({task, milestone}, return_when=asyncio.FIRST_COMPLETED)
        if task.done():
            task.result()
        if milestone.done():
            return milestone.result()
        return progress.get_nowait() if not progress.empty() else None


async def run_with_controls(
    operation: Callable[[], Awaitable[ResultT]],
    *,
    timeout: float,
    stop_checker: Callable[[], bool] | None = None,
) -> ResultT:
    """Settle the owned task before returning, including on caller cancellation."""

    if stop_checker and stop_checker():
        raise AnalystStoppedError("分析已停止")
    if timeout <= 0:
        raise TimeoutError("分析超时")
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    async with owned_task(operation) as task:
        while True:
            if stop_checker and stop_checker():
                raise AnalystStoppedError("分析已停止")
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise TimeoutError("分析超时")
            if task.done():
                return task.result()
            await asyncio.wait({task}, timeout=min(0.2, remaining))
