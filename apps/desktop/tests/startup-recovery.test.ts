import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { configureDesktopWindow } from '../electron/desktop-security.js';
import { createStartupPages } from '../electron/startup-pages.js';
import { createStartupRecoveryHandler, openStartupFolder, retryStartup } from '../electron/startup-recovery.js';

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

test('built-in pages localize actions, authorize only their script and reject injected icons', () => {
  for (const locale of ['zh', 'en'] as const) {
    const pages = createStartupPages('data:image/png;base64,abc" onerror="alert(1)', locale);
    const loading = decodeURIComponent(pages.loading.split(',').slice(1).join(','));
    assert.match(loading, /role="status"/);
    assert.match(loading, /prefers-reduced-motion/);
    assert.doesNotMatch(loading, /<script>|data-action/);
    for (const url of [pages.error, pages.assetsError]) {
      const html = decodeURIComponent(url.slice(url.indexOf(',') + 1));
      assert.match(html, new RegExp(`<html lang="${locale === 'zh' ? 'zh-CN' : 'en'}"`));
      for (const action of ['retry', 'backups', 'logs']) assert.match(html, new RegExp(`data-action="${action}"`));
      assert.doesNotMatch(html, /onerror=|onclick=|<img|项目不会因此发生变化/);
      const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
      const hash = createHash('sha256').update(script).digest('base64');
      assert.ok(html.includes(`script-src 'sha256-${hash}'`));
      assert.ok(html.includes("default-src 'none'"));
    }
  }
});

test('error-page buttons surface missing folders, prevent duplicate clicks and keep quit usable', async () => {
  const html = decodeURIComponent(createStartupPages(null, 'zh').error.split(',').slice(1).join(','));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const buttons = ['retry', 'backups', 'logs'].map((action) => ({
    dataset: { action }, disabled: false, click: async () => {},
    addEventListener(_event: string, callback: () => Promise<void>) { this.click = callback; },
  }));
  const notice = { textContent: '' };
  let quit = () => {};
  let quitCount = 0;
  let calls = 0;
  const pending = deferred<string>();
  runInNewContext(script, {
    document: {
      querySelectorAll: () => buttons,
      getElementById: (id: string) => id === 'notice' ? notice : { addEventListener: (_event: string, fn: () => void) => { quit = fn; } },
    },
    window: { electronAPI: { startupAction: () => { calls++; return pending.promise; }, quitApp: () => { quitCount++; } } },
  });
  const operation = buttons[1].click();
  await buttons[0].click();
  assert.equal(calls, 1);
  assert.ok(buttons.every((button) => button.disabled));
  quit();
  assert.equal(quitCount, 1);
  pending.resolve('missing');
  await operation;
  assert.equal(notice.textContent, '尚未找到升级前备份。');
  assert.ok(buttons.every((button) => !button.disabled));
});

test('recovery IPC accepts only the current registered error main frame and allowlisted actions', async () => {
  const pages = createStartupPages(null, 'en');
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: pages.error }, isDestroyed: () => false, setWindowOpenHandler: () => {},
  });
  const win = { webContents: contents, isDestroyed: () => false } as unknown as BrowserWindow;
  configureDesktopWindow(win, { frontendUrl: 'http://127.0.0.1:13000', startupUrls: new Set(Object.values(pages)) }, async () => {}, () => {});
  let current: BrowserWindow | null = win;
  let retryCount = 0;
  const pending = deferred();
  const opened: string[] = [];
  const handler = createStartupRecoveryHandler({
    currentWindow: () => current,
    errorUrls: () => new Set([pages.error, pages.assetsError]),
    retry: async () => { retryCount++; await pending.promise; },
    openFolder: async (folder) => { opened.push(folder); return 'ok'; },
    onError: (error) => { throw error; },
  });
  const event = () => ({ sender: contents, senderFrame: contents.mainFrame }) as unknown as IpcMainInvokeEvent;
  for (const action of ['restore', '/tmp', 'file:///tmp', { folder: 'logs' }, undefined]) {
    assert.equal(await handler(event(), action), 'unavailable');
  }
  assert.equal(await handler({ ...event(), senderFrame: { url: pages.error } } as IpcMainInvokeEvent, 'logs'), 'unavailable');
  assert.equal(await handler({ ...event(), sender: {} } as IpcMainInvokeEvent, 'logs'), 'unavailable');
  for (const url of [pages.loading, 'http://127.0.0.1:13000/settings', 'data:text/html,evil']) {
    contents.mainFrame.url = url;
    assert.equal(await handler(event(), 'retry'), 'unavailable');
  }
  contents.mainFrame.url = pages.assetsError;
  assert.equal(await handler(event(), 'logs'), 'ok');
  assert.deepEqual(opened, ['logs']);
  const operation = handler(event(), 'retry');
  assert.equal(await handler(event(), 'retry'), 'busy');
  assert.equal(retryCount, 1);
  pending.resolve();
  assert.equal(await operation, 'ok');
  current = null; // Includes the application's quit-in-progress gate.
  assert.equal(await handler(event(), 'logs'), 'unavailable');
});

test('retry waits for prior cleanup, resets before loading and cannot restart a closed/replaced window', async () => {
  for (const closeAt of ['pending', 'loading', 'recovered', 'never']) {
    const pending = deferred();
    const events: string[] = [];
    let current = true;
    const result = retryStartup({
      pending: pending.promise, isCurrent: () => current,
      isErrorPage: () => closeAt !== 'recovered',
      reset: () => { events.push('reset'); },
      showLoading: async () => { events.push('loading'); if (closeAt === 'loading') current = false; },
      start: async () => { events.push('start'); },
    });
    assert.deepEqual(events, []);
    if (closeAt === 'pending') current = false;
    pending.resolve();
    await result;
    assert.deepEqual(events, closeAt === 'pending' || closeAt === 'recovered' ? [] : closeAt === 'loading' ? ['reset', 'loading'] : ['reset', 'loading', 'start']);
  }
});

test('folder reveal does not create missing backups, follow directory links or hide shell failures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'receiptbi-startup-test-'));
  try {
    const directory = path.join(root, '.receiptbi-backups');
    const opened: string[] = [];
    const open = async (value: string) => { opened.push(value); return ''; };
    assert.equal(await openStartupFolder(directory, open), 'missing');
    assert.deepEqual(await readdir(root), []);
    await mkdir(directory, { mode: 0o700 });
    assert.equal(await openStartupFolder(directory, open), 'ok');
    assert.deepEqual(opened, [directory]);
    await assert.rejects(openStartupFolder(directory, async () => 'file manager unavailable'), /file manager unavailable/);
    const link = path.join(root, 'linked');
    await symlink(directory, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await openStartupFolder(link, open), 'failed');
    assert.deepEqual(opened, [directory]);
  } finally {
    await rm(root, { recursive: true, force: true }); // This test's fresh, isolated fixture only.
  }
});
