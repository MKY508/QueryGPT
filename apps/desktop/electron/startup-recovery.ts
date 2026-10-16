import { lstat } from 'node:fs/promises';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { isTrustedDesktopSender } from './desktop-security.js';
import { isStartupAction, type StartupActionResult } from './startup-protocol.js';

/** Recheck window ownership across both awaits; a closed window must not restart services. */
export async function retryStartup(options: {
  pending: Promise<void> | null;
  isErrorPage: () => boolean;
  isCurrent: () => boolean;
  reset: () => void;
  showLoading: () => Promise<void>;
  start: () => Promise<void>;
}): Promise<void> {
  if (options.pending) await options.pending;
  if (!options.isCurrent() || !options.isErrorPage()) return;
  options.reset();
  await options.showLoading();
  if (options.isCurrent()) await options.start();
}

/** A folder reveal only: never create missing backups, restore them or accept a renderer path. */
export async function openStartupFolder(
  directory: string,
  openPath: (directory: string) => Promise<string>,
): Promise<StartupActionResult> {
  try {
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return 'failed';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
  const error = await openPath(directory);
  if (error) throw new Error(`Unable to open startup folder: ${error}`);
  return 'ok';
}

export function createStartupRecoveryHandler(options: {
  currentWindow: () => BrowserWindow | null;
  errorUrls: (win: BrowserWindow) => ReadonlySet<string>;
  retry: (win: BrowserWindow) => Promise<void>;
  openFolder: (folder: 'backups' | 'logs') => Promise<StartupActionResult>;
  onError: (error: unknown) => void;
}): (event: IpcMainInvokeEvent, action: unknown) => Promise<StartupActionResult> {
  const busy = new WeakSet<BrowserWindow>();
  return async (event, action) => {
    const win = options.currentWindow();
    if (!isStartupAction(action) || !win || win.isDestroyed()
      || event.sender !== win.webContents || !isTrustedDesktopSender(event, true)
      || !options.errorUrls(win).has(event.senderFrame!.url)) return 'unavailable';
    if (busy.has(win)) return 'busy';
    busy.add(win);
    try {
      if (action === 'retry') {
        await options.retry(win);
        return 'ok';
      }
      return await options.openFolder(action);
    } catch (error) {
      options.onError(error);
      return 'failed';
    } finally {
      busy.delete(win);
    }
  };
}
