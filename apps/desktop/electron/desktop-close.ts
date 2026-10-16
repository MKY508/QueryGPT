import { randomUUID } from 'node:crypto';
import type { BrowserWindow, IpcMain, IpcMainEvent, MessageBoxOptions } from 'electron';
import { isTrustedDesktopSender } from './desktop-security.js';
import {
  DESKTOP_CLOSE_READY_CHANNEL, DESKTOP_CLOSE_REQUEST_CHANNEL, DESKTOP_CLOSE_RESPONSE_CHANNEL,
  isDesktopCloseResponse, type DesktopCloseCommand, type DesktopCloseState,
} from './desktop-close-protocol.js';
import type { DesktopLocale } from './desktop-navigation.js';

type PromptKind = 'dirty' | 'settings' | 'busy' | 'uploads' | 'unavailable' | 'save-failed' | 'discard-failed' | 'close-blocked';
export function desktopCloseDialog(kind: PromptKind, locale: DesktopLocale): MessageBoxOptions {
  const t = locale === 'en' ? {
    dirty: 'Save your changes before closing?', save: 'Save and close', cancel: 'Cancel', discard: 'Discard changes',
    settings: 'You have unsaved configuration changes.', settingsDetail: 'Closing will discard unsaved changes. Saved settings will not be affected.',
    discardClose: 'Discard changes and close',
    busy: 'An operation is still in progress. Please close the window after it finishes.',
    uploads: 'Files are still waiting or being imported. Finish importing or cancel the waiting files before closing.',
    blocked: 'New changes or unfinished work prevent closing. The window will stay open.', back: 'Return to ReceiptBI',
    unavailable: 'ReceiptBI could not check for unsaved changes.',
    unavailableDetail: 'Closing now may lose unsaved changes and interrupt file imports.', close: 'Close without saving',
    failed: 'Changes could not be saved. The window will stay open.', ok: 'Keep editing',
    discardFailed: 'The draft could not be discarded. The window will stay open.',
  } : {
    dirty: '关闭前保存修改？', save: '保存后关闭', cancel: '取消', discard: '放弃修改',
    settings: '还有未保存的配置更改。', settingsDetail: '关闭将放弃未保存的修改，已保存的设置不受影响。',
    discardClose: '放弃修改并关闭',
    busy: '当前操作尚未完成，请完成后再关闭窗口。',
    uploads: '仍有文件等待或正在导入，请完成导入或取消等待中的文件后再关闭。',
    blocked: '有新的修改或尚未完成的操作，窗口已保留。', back: '返回应用',
    unavailable: '暂时无法确认是否有未保存的修改。', unavailableDetail: '现在关闭可能丢失未保存的内容并中断文件导入。', close: '不保存并关闭',
    failed: '修改尚未保存，已保留当前窗口。', ok: '继续编辑',
    discardFailed: '暂时无法放弃草稿，已保留当前窗口。',
  };
  const common = { type: 'warning' as const, title: 'ReceiptBI', noLink: true };
  if (kind === 'dirty') return { ...common, message: t.dirty, buttons: [t.save, t.cancel, t.discard], defaultId: 0, cancelId: 1 };
  if (kind === 'settings') return { ...common, message: t.settings, detail: t.settingsDetail, buttons: [t.back, t.discardClose], defaultId: 0, cancelId: 0 };
  if (kind === 'unavailable') return { ...common, message: t.unavailable, detail: t.unavailableDetail, buttons: [t.cancel, t.close], defaultId: 0, cancelId: 0 };
  if (kind === 'uploads' || kind === 'close-blocked') return { ...common, message: kind === 'uploads' ? t.uploads : t.blocked, buttons: [t.back], defaultId: 0, cancelId: 0 };
  return { ...common, message: kind === 'busy' ? t.busy : kind === 'discard-failed' ? t.discardFailed : t.failed, buttons: [t.ok], defaultId: 0, cancelId: 0 };
}

/** Ask the current trusted document before closing; never stop services here. */
export function installDesktopCloseGuard(win: BrowserWindow, ipc: IpcMain, options: {
  locale: () => DesktopLocale;
  showDialog: (options: MessageBoxOptions) => Promise<{ response: number }>;
  quit: () => void;
  onError: (error: unknown) => void;
  inspectTimeoutMs?: number;
  saveTimeoutMs?: number;
}): { requestQuit: () => Promise<void> } {
  let ready = false;
  let disposed = false;
  let approved = false;
  let preparationCancelled = false;
  let quitAfterClose = false;
  let intent: 'close' | 'quit' = 'close';
  let operation: Promise<void> | null = null;
  let pending: { id: string; frame: Electron.WebFrameMain; finish: (state: DesktopCloseState) => void } | null = null;
  const trusted = (event: IpcMainEvent) => event.sender === win.webContents && isTrustedDesktopSender(event);

  const onReady = (event: IpcMainEvent, value: unknown) => {
    if (!trusted(event) || typeof value !== 'boolean') return;
    ready = value;
    if (!value) pending?.finish('unavailable');
  };
  const onResponse = (event: IpcMainEvent, value: unknown) => {
    if (!trusted(event) || !isDesktopCloseResponse(value) || !pending
      || value.id !== pending.id || event.senderFrame !== pending.frame) return;
    pending.finish(value.state);
  };
  ipc.on(DESKTOP_CLOSE_READY_CHANNEL, onReady);
  ipc.on(DESKTOP_CLOSE_RESPONSE_CHANNEL, onResponse);
  win.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    ready = false;
    pending?.finish('unavailable');
  });

  const ask = (command: DesktopCloseCommand): Promise<DesktopCloseState> => {
    if (disposed || win.isDestroyed()) return Promise.resolve('unavailable');
    const sender = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
    if (!win.webContents.getURL() || (!isTrustedDesktopSender(sender) && isTrustedDesktopSender(sender, true))) {
      return Promise.resolve('clean'); // Exact built-in startup/error documents have no editable report.
    }
    if (!ready || !isTrustedDesktopSender(sender)) return Promise.resolve('unavailable');
    return new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => finish('unavailable'), command === 'inspect' ? options.inspectTimeoutMs ?? 3_000 : options.saveTimeoutMs ?? 65_000);
      const finish = (state: DesktopCloseState) => {
        clearTimeout(timer);
        if (pending?.id === id) pending = null;
        resolve(state);
      };
      pending = { id, frame: win.webContents.mainFrame, finish };
      try { win.webContents.send(DESKTOP_CLOSE_REQUEST_CHANNEL, { id, command }); }
      catch { finish('unavailable'); }
    });
  };
  const prompt = async (kind: PromptKind) => {
    if (disposed) return -1;
    return (await options.showDialog(desktopCloseDialog(kind, options.locale()))).response;
  };
  const finishClose = (force: boolean) => {
    if (disposed) return;
    approved = true;
    quitAfterClose = intent === 'quit';
    if (force) win.destroy(); // Only an explicit unavailable-state force close may bypass all guards.
    else win.close(); // Keep beforeunload as a final veto if state changed after the reply.
  };
  const cancelPreparation = () => {
    if (preparationCancelled) return;
    preparationCancelled = true;
    if (disposed || !ready || !isTrustedDesktopSender({ sender: win.webContents, senderFrame: win.webContents.mainFrame })) return;
    try { win.webContents.send(DESKTOP_CLOSE_REQUEST_CHANNEL, { id: randomUUID(), command: 'cancel' }); }
    catch (error) { options.onError(error); }
  };
  const run = async () => {
    const state = await ask('inspect');
    if (disposed) return;
    if (state === 'clean') { finishClose(false); return; }
    if (state === 'busy') { await prompt('busy'); return; }
    if (state === 'uploads') { await prompt('uploads'); return; }
    if (state === 'unavailable') {
      if (await prompt('unavailable') === 1) finishClose(true);
      return;
    }
    if (state === 'settings') {
      if (await prompt('settings') !== 1 || disposed) return;
      const discarded = await ask('discard');
      if (discarded === 'clean') finishClose(false);
      else await prompt(discarded === 'uploads' ? 'uploads' : discarded === 'busy' ? 'busy' : 'discard-failed');
      return;
    }
    const choice = await prompt('dirty');
    if (disposed) return;
    if (choice === 2) {
      const discarded = await ask('discard');
      if (discarded === 'clean') finishClose(false);
      else await prompt(discarded === 'uploads' ? 'uploads' : 'discard-failed');
      return;
    }
    if (choice !== 0) return;
    const saved = await ask('save');
    if (saved === 'clean') finishClose(false);
    else await prompt(saved === 'uploads' ? 'uploads' : 'save-failed');
  };
  const request = (nextIntent: 'close' | 'quit'): Promise<void> => {
    if (nextIntent === 'quit') intent = 'quit';
    else if (!operation) intent = 'close';
    if (disposed) return Promise.resolve();
    if (approved) { quitAfterClose ||= nextIntent === 'quit'; return Promise.resolve(); }
    if (!operation) preparationCancelled = false;
    operation ??= run().catch(options.onError).finally(() => {
      operation = null;
      // Revoke renderer-side discard preparation after Cancel, timeout or a
      // final unload veto. A late save/discard response cannot approve a retry.
      if (!disposed && !approved) cancelPreparation();
    });
    return operation;
  };
  win.on('close', (event) => {
    if (approved) return;
    event.preventDefault();
    void request('close');
  });
  win.webContents.on('will-prevent-unload', () => {
    if (!approved) return;
    approved = false;
    quitAfterClose = false;
    // Electron can report this asynchronously, after run().finally() already
    // observed an approved close. Revoke here too, once per close attempt.
    cancelPreparation();
    void prompt('close-blocked').catch(options.onError);
  });
  win.once('closed', () => {
    disposed = true;
    pending?.finish('unavailable');
    ipc.removeListener(DESKTOP_CLOSE_READY_CHANNEL, onReady);
    ipc.removeListener(DESKTOP_CLOSE_RESPONSE_CHANNEL, onResponse);
    if (quitAfterClose) options.quit();
  });
  return { requestQuit: () => request('quit') };
}
