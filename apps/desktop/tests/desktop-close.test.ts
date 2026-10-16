import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { BrowserWindow, IpcMain, MessageBoxOptions } from 'electron';
import { configureDesktopWindow } from '../electron/desktop-security.js';
import { desktopCloseDialog, installDesktopCloseGuard } from '../electron/desktop-close.js';
import {
  DESKTOP_CLOSE_READY_CHANNEL, DESKTOP_CLOSE_REQUEST_CHANNEL, DESKTOP_CLOSE_RESPONSE_CHANNEL,
  isDesktopCloseState, type DesktopCloseRequest, type DesktopCloseState,
} from '../electron/desktop-close-protocol.js';

function fixture(states: DesktopCloseState[], choices: number[] = []) {
  const ipc = new EventEmitter();
  const requests: DesktopCloseRequest[] = [];
  const prompts: MessageBoxOptions[] = [];
  const events: string[] = [];
  let destroyed = false;
  let veto = false;
  let deferredVeto = false;
  let respond = true;
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'http://127.0.0.1:13000/report' },
    getURL: () => contents.mainFrame.url,
    isDestroyed: () => destroyed,
    setWindowOpenHandler: () => undefined,
    send: (channel: string, request: DesktopCloseRequest) => {
      assert.equal(channel, DESKTOP_CLOSE_REQUEST_CHANNEL);
      requests.push(request);
      if (request.command === 'cancel') return;
      if (respond) queueMicrotask(() => ipc.emit(DESKTOP_CLOSE_RESPONSE_CHANNEL, sender(), { id: request.id, state: states.shift() }));
    },
  });
  const win = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => destroyed,
    close: () => {
      let prevented = false;
      win.emit('close', { preventDefault: () => { prevented = true; } });
      if (prevented) return;
      if (veto) {
        if (!deferredVeto) contents.emit('will-prevent-unload', { preventDefault: () => assert.fail('Must retain renderer veto') });
        return;
      }
      win.destroy();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      events.push('closed');
      contents.emit('destroyed');
      win.emit('closed');
    },
  });
  const sender = () => ({ sender: contents, senderFrame: contents.mainFrame });
  configureDesktopWindow(win as unknown as BrowserWindow, {
    frontendUrl: 'http://127.0.0.1:13000', startupUrls: new Set(['data:text/html,startup']),
  }, async () => undefined, (error) => { throw error; });
  const guard = installDesktopCloseGuard(win as unknown as BrowserWindow, ipc as unknown as IpcMain, {
    locale: () => 'en',
    showDialog: async (options) => { prompts.push(options); return { response: choices.shift() ?? options.cancelId ?? 0 }; },
    quit: () => events.push('quit'),
    onError: (error) => { throw error; },
    inspectTimeoutMs: 10, saveTimeoutMs: 10,
  });
  ipc.emit(DESKTOP_CLOSE_READY_CHANNEL, sender(), true);
  return { guard, win, contents, ipc, sender, requests, prompts, events,
    veto: () => { veto = true; }, silence: () => { respond = false; },
    delayVeto: () => { veto = true; deferredVeto = true; },
    finishVeto: () => contents.emit('will-prevent-unload', { preventDefault: () => assert.fail('Must retain renderer veto') }) };
}

test('a clean quit closes the window before requesting application quit and removes IPC listeners', async () => {
  const f = fixture(['clean']);
  await f.guard.requestQuit();
  assert.deepEqual(f.events, ['closed', 'quit']);
  assert.equal(f.prompts.length, 0);
  assert.equal(f.ipc.listenerCount(DESKTOP_CLOSE_READY_CHANNEL), 0);
  assert.equal(f.ipc.listenerCount(DESKTOP_CLOSE_RESPONSE_CHANNEL), 0);
});

test('settings cancellation preserves the window and never offers or requests implicit save', async () => {
  const f = fixture(['settings'], [0]);
  await f.guard.requestQuit();
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.requests.map(request => request.command), ['inspect', 'cancel']);
  assert.deepEqual(f.prompts[0].buttons, ['Return to ReceiptBI', 'Discard changes and close']);
  for (const locale of ['en', 'zh'] as const) {
    const prompt = desktopCloseDialog('settings', locale);
    assert.equal(prompt.defaultId, 0); assert.equal(prompt.cancelId, 0); assert.equal(prompt.buttons?.length, 2);
  }
  assert.equal(isDesktopCloseState('settings'), true); assert.equal(isDesktopCloseState('force'), false);
  f.win.destroy();
});

test('settings discard closes only after clean acknowledgement and retains changed, busy or unavailable work', async () => {
  for (const state of ['clean', 'settings', 'busy', 'uploads', 'unavailable'] as const) {
    const f = fixture(['settings', state], [1]);
    await f.guard.requestQuit();
    assert.equal(f.win.isDestroyed(), state === 'clean');
    assert.equal(f.requests.some(request => request.command === 'save'), false);
    if (state === 'clean') assert.deepEqual(f.events, ['closed', 'quit']);
    else { assert.deepEqual(f.events, []); assert.equal(f.requests.at(-1)?.command, 'cancel'); f.win.destroy(); }
  }
});

test('settings discard retains the final renderer veto and coalesces window-close with quit', async () => {
  const f = fixture(['settings', 'clean'], [1]);
  f.veto(); f.win.close();
  await Promise.all([f.guard.requestQuit(), f.guard.requestQuit()]);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.requests.map(request => request.command), ['inspect', 'discard', 'cancel']);
  assert.equal(f.prompts.length, 2); f.win.destroy(); assert.deepEqual(f.events, ['closed']);
});

test('Cancel preserves the window without saving; save-and-close waits for a clean result', async () => {
  const cancel = fixture(['dirty'], [1]);
  await cancel.guard.requestQuit();
  assert.deepEqual(cancel.events, []);
  assert.deepEqual(cancel.requests.map((request) => request.command), ['inspect', 'cancel']);
  cancel.win.destroy();
  const save = fixture(['dirty', 'clean'], [0]);
  await save.guard.requestQuit();
  assert.deepEqual(save.requests.map((request) => request.command), ['inspect', 'save']);
  assert.deepEqual(save.events, ['closed', 'quit']);
});

test('busy, failed saves and newer unsaved edits all keep the window open', async () => {
  for (const states of [['busy'], ['uploads'], ['dirty', 'dirty'], ['dirty', 'unavailable'], ['dirty', 'uploads']] as DesktopCloseState[][]) {
    const f = fixture(states, [0]);
    await f.guard.requestQuit();
    assert.deepEqual(f.events, []);
    assert.equal(f.prompts.at(-1)?.buttons?.length, 1);
    f.win.destroy();
  }
});

test('report discard keeps the final unload veto; only explicit unavailable-state force close bypasses it', async () => {
  const discard = fixture(['dirty', 'clean'], [2]);
  discard.veto();
  await discard.guard.requestQuit();
  assert.deepEqual(discard.events, []);
  assert.deepEqual(discard.requests.map((request) => request.command), ['inspect', 'discard', 'cancel']);
  discard.win.destroy();
  const allowed = fixture(['dirty', 'clean'], [2]);
  await allowed.guard.requestQuit();
  assert.deepEqual(allowed.events, ['closed', 'quit']);
  for (const choice of [0, 1]) {
    const f = fixture([], [choice]);
    f.ipc.emit(DESKTOP_CLOSE_READY_CHANNEL, f.sender(), false);
    await f.guard.requestQuit();
    assert.equal(f.win.isDestroyed(), choice === 1);
    assert.equal(f.prompts[0].cancelId, 0);
    assert.equal(f.requests.length, 0);
    f.win.destroy();
  }
});

test('overlapping window-close and quit share one operation and retain a final renderer veto', async () => {
  const f = fixture(['clean']);
  f.win.close();
  await Promise.all([f.guard.requestQuit(), f.guard.requestQuit()]);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.events, ['closed', 'quit']);
  const veto = fixture(['clean']);
  veto.veto();
  await veto.guard.requestQuit();
  assert.deepEqual(veto.events, []);
  assert.equal(veto.prompts[0].message, 'New changes or unfinished work prevent closing. The window will stay open.');
  veto.win.destroy();
  assert.deepEqual(veto.events, ['closed']); // A canceled quit must not leak into a later close.
  const delayed = fixture(['dirty', 'clean'], [2]);
  delayed.delayVeto();
  await delayed.guard.requestQuit();
  assert.deepEqual(delayed.requests.map((request) => request.command), ['inspect', 'discard']);
  delayed.finishVeto();
  assert.deepEqual(delayed.requests.map((request) => request.command), ['inspect', 'discard', 'cancel']);
  assert.deepEqual(delayed.events, []);
  delayed.win.destroy();
  assert.deepEqual(delayed.events, ['closed']);
});

test('spoofed frames and mismatched IDs cannot approve closing; missing responses time out safely', async () => {
  const f = fixture([]);
  f.silence();
  const operation = f.guard.requestQuit();
  const { id } = f.requests[0];
  f.ipc.emit(DESKTOP_CLOSE_RESPONSE_CHANNEL, { ...f.sender(), senderFrame: { url: f.contents.mainFrame.url } }, { id, state: 'clean' });
  f.ipc.emit(DESKTOP_CLOSE_RESPONSE_CHANNEL, f.sender(), { id: '00000000-0000-0000-0000-000000000000', state: 'clean' });
  await operation;
  assert.deepEqual(f.events, []);
  assert.equal(f.prompts[0].message, 'ReceiptBI could not check for unsaved changes.');
  f.win.destroy();
});

test('navigation invalidates an in-flight check and only exact built-in pages close without a bridge', async () => {
  const f = fixture([]);
  f.silence();
  const operation = f.guard.requestQuit();
  f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  await operation;
  assert.deepEqual(f.events, []);
  f.win.destroy();
  const startup = fixture([]);
  startup.contents.mainFrame.url = 'data:text/html,startup';
  await startup.guard.requestQuit();
  assert.deepEqual(startup.events, ['closed', 'quit']);
  assert.equal(startup.requests.length, 0);
});

test('localized dialogs keep the destructive choice separate from the default and Escape', () => {
  const dirty = desktopCloseDialog('dirty', 'zh');
  assert.deepEqual(dirty.buttons, ['保存后关闭', '取消', '放弃修改']);
  assert.equal(dirty.defaultId, 0);
  assert.equal(dirty.cancelId, 1);
  assert.equal(desktopCloseDialog('unavailable', 'zh').cancelId, 0);
  assert.deepEqual(desktopCloseDialog('uploads', 'zh').buttons, ['返回应用']);
});
