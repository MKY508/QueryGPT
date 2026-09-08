"""Engine-independent cancellation and wall-clock deadline for one task."""

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from typing import TypeVar

ResultT = TypeVar("ResultT")


class AnalystStoppedError(RuntimeError):
    pass


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
    task = asyncio.ensure_future(operation())
    try:
        while True:
            if stop_checker and stop_checker():
                raise AnalystStoppedError("分析已停止")
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise TimeoutError("分析超时")
            if task.done():
                return task.result()
            await asyncio.wait({task}, timeout=min(0.2, remaining))
    finally:
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        elif not task.cancelled():
            task.exception()
