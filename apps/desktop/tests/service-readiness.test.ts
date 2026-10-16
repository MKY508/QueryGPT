import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForServiceReady, BACKEND_READY_TIMEOUT_MS, FRONTEND_READY_TIMEOUT_MS } from '../electron/service-readiness.js';

const never = () => new Promise<void>(() => {});

test('readiness can exceed the old attempt cap and aborts each superseded check', async () => {
  assert.ok(BACKEND_READY_TIMEOUT_MS > 120_000);
  assert.equal(FRONTEND_READY_TIMEOUT_MS, 60_000);
  const signals: AbortSignal[] = [];
  let count = 0;
  const value = await waitForServiceReady({
    name: 'backend', timeoutMs: 2000, intervalMs: 1, exited: never(), assertActive: () => {},
    check: async (signal) => {
      if (signals.length) assert.equal(signals.at(-1)!.aborted, true);
      signals.push(signal);
      if (++count <= 61) throw new Error('backup in progress');
      return { ready: true };
    },
  });
  assert.deepEqual(value, { ready: true });
  assert.equal(count, 62);
  assert.ok(signals.every((signal) => signal.aborted));
});

test('one elapsed deadline stops even a stalled probe and aborts its request signal', async () => {
  let requestSignal: AbortSignal | undefined;
  await assert.rejects(waitForServiceReady({
    name: 'backend', timeoutMs: 15, exited: never(), assertActive: () => {},
    check: (signal) => { requestSignal = signal; return never(); },
  }), /backend failed to become ready within 15 ms/);
  assert.equal(requestSignal?.aborted, true);
});

test('process exit aborts a pending probe without waiting out the startup budget', async () => {
  for (const peer of [false, true]) {
    let exit!: () => void;
    const exited = new Promise<void>((resolve) => { exit = resolve; });
    let requestSignal: AbortSignal | undefined;
    await assert.rejects(waitForServiceReady({
      name: 'frontend', timeoutMs: 2000, exited,
      assertActive: () => { if (peer && requestSignal) throw new Error('backend exited during service startup'); },
      check: (signal) => { requestSignal = signal; exit(); return never(); },
    }), peer ? /backend exited during service startup/ : /frontend exited before becoming ready/);
    assert.equal(requestSignal?.aborted, true);
  }
});

test('a generation cancelled during a successful probe cannot publish readiness', async () => {
  let active = true;
  let checks = 0;
  await assert.rejects(waitForServiceReady({
    name: 'backend', timeoutMs: 2000, exited: never(),
    assertActive: () => { if (!active) throw new Error('cancelled'); },
    check: async () => { checks++; active = false; return 'ready'; },
  }), /cancelled/);
  assert.equal(checks, 1);
});
