import { setTimeout as delay } from 'node:timers/promises';

// A pre-upgrade backup alone may take 120 seconds, followed by transactional copies.
export const BACKEND_READY_TIMEOUT_MS = 5 * 60_000;
export const FRONTEND_READY_TIMEOUT_MS = 60_000;

/** One elapsed deadline covers polling, HTTP bodies and parallel asset checks. */
export async function waitForServiceReady<T>(options: {
  name: string;
  timeoutMs: number;
  intervalMs?: number;
  assertActive: () => void;
  exited: Promise<void>;
  check: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  options.assertActive();
  const controller = new AbortController();
  const { signal } = controller;
  let finished = false;
  let lastError: unknown;
  const timer = setTimeout(() => controller.abort(
    new Error(`${options.name} failed to become ready within ${options.timeoutMs} ms`, { cause: lastError }),
  ), options.timeoutMs);
  const onExit = () => {
    if (finished) return;
    try { options.assertActive(); }
    catch (error) { controller.abort(error); return; }
    controller.abort(new Error(`${options.name} exited before becoming ready`));
  };
  void options.exited.then(onExit, onExit);
  let removeAbortListener = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = () => reject(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', listener);
  });
  const poll = async (): Promise<T> => {
    for (;;) {
      signal.throwIfAborted();
      options.assertActive();
      // A failed group of asset requests must not keep running during the next attempt.
      const attempt = new AbortController();
      try {
        const payload = await options.check(AbortSignal.any([signal, attempt.signal]));
        signal.throwIfAborted();
        options.assertActive();
        return payload;
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        options.assertActive();
        lastError = error;
      } finally {
        attempt.abort();
      }
      await delay(options.intervalMs ?? 500, undefined, { signal });
    }
  };
  try {
    return await Promise.race([poll(), aborted]);
  } finally {
    finished = true;
    clearTimeout(timer);
    removeAbortListener();
    controller.abort();
  }
}
