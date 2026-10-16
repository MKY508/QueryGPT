import type { IpcMain } from 'electron';
import { app, BrowserWindow, shell } from 'electron';
import { externalWebUrl, isTrustedDesktopSender } from './desktop-security.js';
import type { DesktopAppInfo } from './app-info.js';
import type { ProcessManager } from './process-manager.js';
import type { Logger } from './logger.js';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  processManager: ProcessManager,
  logger: Logger
): void {
  const assertTrusted = (event: Electron.IpcMainInvokeEvent): void => {
    if (!isTrustedDesktopSender(event)) throw new Error('Untrusted desktop request');
  };
  ipcMain.handle('get-service-status', (event) => {
    assertTrusted(event);
    return processManager.getStatus();
  });
  ipcMain.handle('get-user-data-dir', (event) => {
    assertTrusted(event);
    return processManager.getUserDataDir();
  });
  ipcMain.handle('get-app-info', (event): DesktopAppInfo => {
    assertTrusted(event);
    return {
      version: app.getVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged,
    };
  });
  ipcMain.on('quit-app', (event) => {
    // The exact built-in failure page must retain its Close button.
    if (isTrustedDesktopSender(event, true)) app.quit();
  });

  ipcMain.handle('open-external', async (event, value: unknown) => {
    assertTrusted(event);
    const url = externalWebUrl(value);
    if (!url) throw new Error('Unsupported external URL');
    await shell.openExternal(url);
  });

  // 每 10 秒广播一次服务状态
  const statusTimer = setInterval(() => {
    const status = processManager.getStatus();
    BrowserWindow.getAllWindows().forEach((win) => {
      const contents = win.webContents;
      if (isTrustedDesktopSender({ sender: contents, senderFrame: contents.mainFrame })) {
        contents.send('service-status-changed', status);
      }
    });
  }, 10000);
  statusTimer.unref();
  app.once('will-quit', () => clearInterval(statusTimer));

  logger.info('IPC handlers registered');
}
