import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { BrowserWindow, IpcMainEvent } from 'electron';
import { configureDesktopWindow, externalWebUrl, isFrontendUrl, isTrustedDesktopSender } from '../electron/desktop-security.js';

const frontendUrl = 'http://127.0.0.1:13000';
const startupUrl = 'data:text/html;charset=utf-8,ReceiptBI%20starting';

function fixture() {
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: `${frontendUrl}/about` },
    isDestroyed: () => false,
    setWindowOpenHandler: (handler: (details: { url: string }) => unknown) => { popup = handler; },
  });
  let popup: (details: { url: string }) => unknown = () => undefined;
  const external: string[] = [];
  const loaded: string[] = [];
  const win = { webContents: contents, loadURL: async (url: string) => { loaded.push(url); } };
  configureDesktopWindow(win as unknown as BrowserWindow, { frontendUrl, startupUrls: new Set([startupUrl]) },
    async (url) => { external.push(url); }, (error) => { throw error; });
  const event = () => ({ sender: contents, senderFrame: contents.mainFrame }) as unknown as IpcMainEvent;
  return { contents, event, external, loaded, popup: (url: string) => popup({ url }) };
}

test('frontend URLs require the exact origin; external links only accept HTTP(S)', () => {
  assert.equal(isFrontendUrl(`${frontendUrl}/settings`, frontendUrl), true);
  for (const url of ['http://127.0.0.1:18080', 'http://127.0.0.1.evil.example:13000', 'http://user@127.0.0.1:13000', 'data:text/html,x']) {
    assert.equal(isFrontendUrl(url, frontendUrl), false);
  }
  assert.equal(externalWebUrl('https://github.com/MoonMao42/ReceiptBI'), 'https://github.com/MoonMao42/ReceiptBI');
  for (const url of ['file:///tmp/x', 'javascript:alert(1)', 'ms-msdt:abc', 'https://user:secret@example.com', {}, null]) {
    assert.equal(externalWebUrl(url), null);
  }
});

test('only the registered main frame can use the bridge; startup pages require explicit opt-in', () => {
  const { contents, event } = fixture();
  assert.equal(isTrustedDesktopSender(event()), true);
  assert.equal(isTrustedDesktopSender({ ...event(), senderFrame: { url: `${frontendUrl}/about` } } as IpcMainEvent), false);
  contents.mainFrame.url = startupUrl;
  assert.equal(isTrustedDesktopSender(event()), false);
  assert.equal(isTrustedDesktopSender(event(), true), true);
  contents.mainFrame.url = 'data:text/html,untrusted';
  assert.equal(isTrustedDesktopSender(event(), true), false);
  contents.mainFrame.url = 'https://example.com';
  assert.equal(isTrustedDesktopSender(event()), false);
  contents.emit('destroyed');
  contents.mainFrame.url = `${frontendUrl}/about`;
  assert.equal(isTrustedDesktopSender(event()), false);
});

test('external navigation preserves the workspace and redirects cannot leave it', () => {
  const { contents, external, loaded, popup } = fixture();
  let prevented = false;
  contents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.com/');
  assert.equal(prevented, true);
  assert.deepEqual(external, ['https://example.com/']);
  assert.deepEqual(loaded, []);
  prevented = false;
  contents.emit('will-redirect', { preventDefault: () => { prevented = true; } }, 'https://example.org/');
  assert.equal(prevented, true);
  assert.equal(external.length, 1);
  assert.deepEqual(popup('file:///tmp/x'), { action: 'deny' });
  assert.deepEqual(popup(`${frontendUrl}/settings`), { action: 'deny' });
  assert.deepEqual(loaded, [`${frontendUrl}/settings`]);
});
