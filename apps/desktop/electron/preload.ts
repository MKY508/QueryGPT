import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAppInfo } from './app-info.js';
import { STARTUP_ACTION_CHANNEL, type StartupAction, type StartupActionResult } from './startup-protocol.js';
import {
  DESKTOP_CLOSE_READY_CHANNEL, DESKTOP_CLOSE_REQUEST_CHANNEL, DESKTOP_CLOSE_RESPONSE_CHANNEL,
  isDesktopCloseRequest, isDesktopCloseState, type DesktopCloseCommand, type DesktopCloseState,
} from './desktop-close-protocol.js';
import {
  DESKTOP_NAVIGATE_CHANNEL, DESKTOP_NAVIGATION_READY_CHANNEL, isDesktopPage,
  desktopLocale, type DesktopPage,
} from './desktop-navigation.js';
import {
  describeChunkLoadFailure,
  RENDERER_CHUNK_FAILURE_CHANNEL,
} from './frontend-reliability.js';

// The loading/error data documents do not need chunk recovery. Web Crypto's
// randomUUID is available on the trusted localhost frontend (a secure context).
let rendererDocumentId: string | undefined;
let chunkFailureReported = false;
let removeCloseListener: (() => void) | undefined;

function reportChunkLoadFailure(reason: unknown): void {
  if (chunkFailureReported) return;
  const failure = describeChunkLoadFailure(reason);
  if (!failure) return;
  rendererDocumentId ??= globalThis.crypto.randomUUID?.();
  if (!rendererDocumentId) return;

  chunkFailureReported = true;
  ipcRenderer.send(RENDERER_CHUNK_FAILURE_CHANNEL, {
    ...failure,
    documentId: rendererDocumentId,
  });
}

window.addEventListener('error', (event) => {
  // Some browser/isolated-world errors have a useful message but no transferable
  // Error object. Keep the fallback even when event.error is an opaque object.
  reportChunkLoadFailure(event.error);
  reportChunkLoadFailure(event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  reportChunkLoadFailure(event.reason);
});

contextBridge.exposeInMainWorld('electronAPI', {
  getServiceStatus: () => ipcRenderer.invoke('get-service-status'),
  getUserDataDir: () => ipcRenderer.invoke('get-user-data-dir'),
  getAppInfo: (): Promise<DesktopAppInfo> => ipcRenderer.invoke('get-app-info'),
  quitApp: () => ipcRenderer.send('quit-app'),
  startupAction: (action: StartupAction): Promise<StartupActionResult> => ipcRenderer.invoke(STARTUP_ACTION_CHANNEL, action),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  // Main-world errors do not reliably reach listeners in the isolated preload.
  // Expose this specific, validated report only, never ipcRenderer itself.
  reportChunkLoadFailure: (error: { name: string; message: string }) => reportChunkLoadFailure(error),

  onNavigate: (callback: (page: DesktopPage) => void, locale: string) => {
    const listener = (_event: Electron.IpcRendererEvent, page: unknown) => {
      if (isDesktopPage(page)) callback(page);
    };
    ipcRenderer.on(DESKTOP_NAVIGATE_CHANNEL, listener);
    ipcRenderer.send(DESKTOP_NAVIGATION_READY_CHANNEL, desktopLocale(locale));
    return () => ipcRenderer.removeListener(DESKTOP_NAVIGATE_CHANNEL, listener);
  },

  onPrepareClose: (callback: (command: DesktopCloseCommand) => Promise<DesktopCloseState>) => {
    removeCloseListener?.();
    let active = true;
    const listener = (_event: Electron.IpcRendererEvent, request: unknown) => {
      if (!active || !isDesktopCloseRequest(request)) return;
      void (async () => {
        let state: DesktopCloseState = 'unavailable';
        try {
          const result = await callback(request.command);
          if (isDesktopCloseState(result)) state = result;
        } catch { /* A failed renderer callback must never approve a close. */ }
        if (active) ipcRenderer.send(DESKTOP_CLOSE_RESPONSE_CHANNEL, { id: request.id, state });
      })();
    };
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      ipcRenderer.removeListener(DESKTOP_CLOSE_REQUEST_CHANNEL, listener);
      ipcRenderer.send(DESKTOP_CLOSE_READY_CHANNEL, false);
      if (removeCloseListener === unsubscribe) removeCloseListener = undefined;
    };
    removeCloseListener = unsubscribe;
    ipcRenderer.on(DESKTOP_CLOSE_REQUEST_CHANNEL, listener);
    ipcRenderer.send(DESKTOP_CLOSE_READY_CHANNEL, true);
    return unsubscribe;
  },

  onServiceStatusChange: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('service-status-changed', listener);
    return () => ipcRenderer.removeListener('service-status-changed', listener);
  },
});

declare global {
  interface Window {
    electronAPI?: {
      getServiceStatus: () => Promise<{
        backend: { running: boolean; url?: string; pid?: number };
        frontend: { running: boolean; url?: string; pid?: number };
      }>;
      getUserDataDir: () => Promise<string>;
      getAppInfo?: () => Promise<DesktopAppInfo>;
      quitApp?: () => void;
      startupAction?: (action: StartupAction) => Promise<StartupActionResult>;
      openExternal: (url: string) => Promise<void>;
      onNavigate?: (callback: (page: DesktopPage) => void, locale: string) => () => void;
      onPrepareClose?: (callback: (command: DesktopCloseCommand) => Promise<DesktopCloseState>) => () => void;
      reportChunkLoadFailure?: (error: { name: string; message: string }) => void;
      onServiceStatusChange: (callback: (status: unknown) => void) => () => void;
    };
  }
}
