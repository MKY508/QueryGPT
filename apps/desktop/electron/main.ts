import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { ProcessManager } from './process-manager.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { setupLogger, type Logger } from './logger.js';
import {
  LegacyDataMigrationRequiredError,
  prepareDesktopDataPaths,
} from './data-migration.js';
import {
  ChunkLoadRecoveryGate,
  isNextStaticScriptUrl,
  isRendererChunkFailureReport,
  RENDERER_CHUNK_FAILURE_CHANNEL,
} from './frontend-reliability.js';

const DESKTOP_MIN_WIDTH = 1180;

const bootstrapLogger: Logger = {
  info: (message, ...args) => console.info(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
  debug: (message, ...args) => console.debug(message, ...args),
};

let logger = bootstrapLogger;
let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;
let desktopInitialization: Promise<void> | null = null;
let brandIconDataUrl: string | null = null;
let frontendChunkRecovery: ChunkLoadRecoveryGate | null = null;
let startupFailureHandled = false;
let quitCleanupStarted = false;
let quitCleanupFinished = false;

const developmentIconPath = path.join(__dirname, '../resources/icon/icon.png');

function brandMarkHtml(iconDataUrl: string | null): string {
  if (!iconDataUrl) return '';
  return `<img class="mark" src="${iconDataUrl}" alt="" aria-hidden="true">`;
}

function loadingHtml(iconDataUrl: string | null): string {
  const brandMark = brandMarkHtml(iconDataUrl);
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>ReceiptBI</title><style>
  :root {
    color-scheme:light dark;
    font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    --background:hsl(60 14% 98%);
    --foreground:hsl(160 35% 14%);
    --muted-foreground:hsl(160 12% 42%);
    --border:hsl(150 12% 88%);
    --primary:hsl(158 42% 26%);
    --primary-foreground:hsl(60 14% 98%);
    --pulse:hsla(158 42% 26% / .28);
  }
  @media (prefers-color-scheme:dark) {
    :root {
      --background:hsl(160 20% 8%);
      --foreground:hsl(150 15% 92%);
      --muted-foreground:hsl(150 10% 58%);
      --border:hsl(160 12% 20%);
      --primary:hsl(158 38% 42%);
      --primary-foreground:hsl(160 20% 8%);
      --pulse:hsla(158 38% 42% / .38);
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--background); color:var(--foreground); }
  .shell { min-height:100vh; display:grid; grid-template-rows:auto 1fr; padding:42px 52px; overflow:hidden; }
  .brand { display:flex; align-items:center; gap:13px; color:var(--muted-foreground); font-size:13px; font-weight:700; letter-spacing:.08em; }
  .mark { width:34px; height:34px; display:block; object-fit:contain; }
  .status { align-self:center; display:grid; grid-template-columns:4px minmax(0,640px); gap:34px; margin-left:8vw; }
  .rail { position:relative; min-height:206px; background:var(--border); overflow:hidden; }
  .rail::after { content:""; position:absolute; inset:0 0 auto; height:72px; background:var(--primary); animation:scan 1.8s cubic-bezier(.65,0,.35,1) infinite alternate; }
  .eyebrow { margin:3px 0 22px; color:var(--primary); font-size:12px; font-weight:800; letter-spacing:.18em; text-transform:uppercase; }
  h1 { max-width:620px; margin:0; font-size:clamp(34px,5vw,58px); line-height:1.1; letter-spacing:-.035em; }
  .copy { max-width:520px; margin:24px 0 0; color:var(--muted-foreground); font-size:16px; line-height:1.8; }
  .pulse { width:7px; height:7px; margin-top:30px; background:var(--primary); border-radius:50%; box-shadow:0 0 0 0 var(--pulse); animation:pulse 1.6s ease-out infinite; }
  @keyframes scan { from { transform:translateY(-30px); } to { transform:translateY(164px); } }
  @keyframes pulse { 70% { box-shadow:0 0 0 9px transparent; } 100% { box-shadow:0 0 0 0 transparent; } }
  @media (max-width:720px) { .shell { padding:32px; } .status { margin-left:0; gap:24px; } }
  @media (prefers-reduced-motion:reduce) { .rail::after,.pulse { animation:none; } .rail::after { top:34%; } }
</style></head><body>
<main class="shell">
  <header class="brand">${brandMark}<span>RECEIPTBI</span></header>
  <section class="status" role="status" aria-live="polite">
    <div class="rail" aria-hidden="true"></div>
    <div>
      <p class="eyebrow">本地分析工作台</p>
      <h1>正在打开 ReceiptBI</h1>
      <p class="copy">稍候片刻，应用会自动显示。</p>
      <div class="pulse" aria-hidden="true"></div>
    </div>
  </section>
</main>
</body></html>`)}`;
}

function errorHtml(
  iconDataUrl: string | null,
  reason: 'startup' | 'frontend-assets' = 'startup'
): string {
  const brandMark = brandMarkHtml(iconDataUrl);
  const copy =
    reason === 'frontend-assets'
      ? '界面资源加载失败。请关闭 ReceiptBI 后重新打开。'
      : '这次没有正常打开。请关闭后重新试一次，你的项目不会因此发生变化。';
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>ReceiptBI 无法启动</title><style>
  :root {
    color-scheme:light dark;
    font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    --background:hsl(60 14% 98%);
    --foreground:hsl(160 35% 14%);
    --muted-foreground:hsl(160 12% 42%);
    --border:hsl(150 12% 88%);
    --primary:hsl(158 42% 26%);
    --primary-foreground:hsl(60 14% 98%);
    --warning:hsl(34 62% 40%);
  }
  @media (prefers-color-scheme:dark) {
    :root {
      --background:hsl(160 20% 8%);
      --foreground:hsl(150 15% 92%);
      --muted-foreground:hsl(150 10% 58%);
      --border:hsl(160 12% 20%);
      --primary:hsl(158 38% 42%);
      --primary-foreground:hsl(160 20% 8%);
      --warning:hsl(38 78% 66%);
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--background); color:var(--foreground); }
  .shell { min-height:100vh; display:grid; grid-template-rows:auto 1fr; padding:42px 52px; }
  .brand { display:flex; align-items:center; gap:13px; color:var(--muted-foreground); font-size:13px; font-weight:700; letter-spacing:.08em; }
  .mark { width:34px; height:34px; display:block; object-fit:contain; }
  .content { align-self:center; width:min(720px,92vw); margin-left:8vw; border-left:4px solid var(--warning); padding:4px 0 4px 34px; }
  .eyebrow { margin:0 0 18px; color:var(--warning); font-size:12px; font-weight:800; letter-spacing:.16em; }
  h1 { margin:0; font-size:clamp(34px,5vw,54px); line-height:1.1; letter-spacing:-.035em; }
  .copy { max-width:590px; margin:22px 0 0; color:var(--muted-foreground); font-size:16px; line-height:1.75; }
  button { margin-top:28px; min-height:42px; padding:0 20px; border:1px solid var(--primary); background:var(--primary); color:var(--primary-foreground); font:inherit; font-weight:800; cursor:pointer; }
  button:hover { filter:brightness(1.08); }
  button:focus-visible { outline:3px solid var(--warning); outline-offset:3px; }
  @media (max-width:720px) { .shell { padding:32px; } .content { margin-left:0; padding-left:24px; } }
</style></head><body>
<main class="shell">
  <header class="brand">${brandMark}<span>RECEIPTBI</span></header>
  <section class="content">
    <p class="eyebrow">启动需要处理</p>
    <h1>ReceiptBI 暂时无法启动</h1>
    <p class="copy">${copy}</p>
    <button type="button" onclick="window.electronAPI?.quitApp?.()">关闭 ReceiptBI</button>
  </section>
</main>
</body></html>`)}`;
}

function loadBrandIconDataUrl(): string | null {
  const runtimeIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon', 'icon.png')
    : developmentIconPath;
  const brandIcon = nativeImage.createFromPath(runtimeIconPath);
  if (brandIcon.isEmpty()) {
    logger.warn('Unable to load the application icon for the startup page');
    return null;
  }
  return brandIcon.resize({ width: 68, height: 68, quality: 'best' }).toDataURL();
}

async function createWindow(): Promise<BrowserWindow> {
  frontendChunkRecovery = new ChunkLoadRecoveryGate();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: DESKTOP_MIN_WIDTH,
    minHeight: 600,
    title: 'ReceiptBI',
    icon: app.isPackaged ? undefined : developmentIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101814' : '#fafaf9',
  });
  const removeChunkRequestMonitor = installChunkRequestMonitor(win);
  win.once('closed', removeChunkRequestMonitor);

  // 立即显示 loading 页面
  await win.loadURL(loadingHtml(brandIconDataUrl));
  win.show();
  logger.info('Loading screen shown');

  return win;
}

function isCurrentFrontendUrl(value: string): boolean {
  if (!processManager) return false;
  try {
    return new URL(value).origin === new URL(processManager.getFrontendUrl()).origin;
  } catch {
    return false;
  }
}

async function showFrontendAssetError(win: BrowserWindow): Promise<void> {
  if (quitCleanupStarted || win.isDestroyed() || mainWindow !== win) return;
  try {
    await win.loadURL(errorHtml(brandIconDataUrl, 'frontend-assets'));
  } catch (error) {
    logger.error('Failed to show the frontend startup error', error);
  }
}

async function recoverFromChunkLoadFailure(
  win: BrowserWindow,
  targetUrl: string,
  recovery: ChunkLoadRecoveryGate
): Promise<void> {
  try {
    await win.webContents.session.clearCache();
    if (
      quitCleanupStarted ||
      win.isDestroyed() ||
      mainWindow !== win ||
      frontendChunkRecovery !== recovery ||
      recovery.terminal
    ) {
      return;
    }

    await win.loadURL(targetUrl);
    if (!recovery.terminal && frontendChunkRecovery === recovery) {
      logger.info('Frontend recovered after clearing a failed chunk load');
    }
  } catch (error) {
    if (
      quitCleanupStarted ||
      win.isDestroyed() ||
      mainWindow !== win ||
      frontendChunkRecovery !== recovery ||
      recovery.terminal
    ) {
      return;
    }

    logger.error('Frontend chunk recovery failed', error);
    if (recovery.terminateRecovery() === 'show-error') {
      await showFrontendAssetError(win);
    }
  }
}

function handleFrontendChunkFailure(
  win: BrowserWindow,
  documentId: string,
  name: string,
  message: string,
  targetUrl: string
): void {
  const recovery = frontendChunkRecovery;
  if (
    win.isDestroyed() ||
    mainWindow !== win ||
    !recovery ||
    !isCurrentFrontendUrl(targetUrl)
  ) {
    return;
  }

  const action = recovery.recordFailure(documentId);
  if (action === 'reload') {
    logger.warn(
      `Frontend chunk failed to load; clearing cache and retrying once (${name}: ${message})`
    );
    void recoverFromChunkLoadFailure(win, targetUrl, recovery);
  } else if (action === 'show-error') {
    logger.error(
      `Frontend chunk failed again after recovery (${name}: ${message})`
    );
    void showFrontendAssetError(win);
  }
}

function installChunkRequestMonitor(win: BrowserWindow): () => void {
  const frontendUrl = processManager?.getFrontendUrl();
  if (!frontendUrl) return () => undefined;

  const webRequest = win.webContents.session.webRequest;
  const filter = { urls: [`${new URL(frontendUrl).origin}/_next/static/*`] };
  let documentGeneration = 0;

  win.webContents.on(
    'did-start-navigation',
    (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace && isCurrentFrontendUrl(url)) {
        documentGeneration += 1;
      }
    }
  );

  const reportNetworkFailure = (url: string, message: string): void => {
    if (!isNextStaticScriptUrl(url, frontendUrl)) return;
    handleFrontendChunkFailure(
      win,
      `network-${win.webContents.id}-${documentGeneration}`,
      'ChunkLoadError',
      message,
      win.webContents.getURL()
    );
  };

  webRequest.onCompleted(filter, (details) => {
    if (
      details.webContentsId === win.webContents.id &&
      details.resourceType === 'script' &&
      details.statusCode >= 400
    ) {
      reportNetworkFailure(details.url, `HTTP ${details.statusCode}: ${details.url}`);
    }
  });
  webRequest.onErrorOccurred(filter, (details) => {
    if (
      details.webContentsId === win.webContents.id &&
      details.resourceType === 'script' &&
      details.error !== 'net::ERR_ABORTED'
    ) {
      reportNetworkFailure(details.url, `${details.error}: ${details.url}`);
    }
  });

  return () => {
    webRequest.onCompleted(null);
    webRequest.onErrorOccurred(null);
  };
}

ipcMain.on(RENDERER_CHUNK_FAILURE_CHANNEL, (event, report: unknown) => {
  const win = mainWindow;
  if (
    !win ||
    win.isDestroyed() ||
    event.sender !== win.webContents ||
    !isRendererChunkFailureReport(report)
  ) {
    return;
  }

  handleFrontendChunkFailure(
    win,
    report.documentId,
    report.name,
    report.message,
    event.sender.getURL()
  );
});

async function showApplicationWindow(): Promise<void> {
  if (quitCleanupStarted) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const win = await createWindow();
  mainWindow = win;
  win.once('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  try {
    if (!processManager) throw new Error('Process manager is not initialized');
    // On macOS activate, an already-ready service pair is reused without restarting.
    if (!processManager.isReady()) await processManager.startAll();
    if (quitCleanupStarted || win.isDestroyed()) return;

    const frontendUrl = processManager.getFrontendUrl();
    await win.loadURL(frontendUrl);
    if (!frontendChunkRecovery?.recoveryAttempted) {
      logger.info(`Frontend loaded: ${frontendUrl}`);
    }
  } catch (error) {
    if (frontendChunkRecovery?.recoveryAttempted) {
      logger.debug('Initial frontend navigation was superseded by chunk recovery');
      return;
    }
    logger.error('Failed to start services', error);
    if (!quitCleanupStarted && !win.isDestroyed()) {
      await win.loadURL(errorHtml(brandIconDataUrl));
    }
  }
}

function handleStartupFailure(error: unknown): void {
  if (startupFailureHandled) return;
  startupFailureHandled = true;
  logger.error('ReceiptBI desktop initialization failed', error);
  if (error instanceof LegacyDataMigrationRequiredError && app.isReady()) {
    dialog.showErrorBox('ReceiptBI data migration required', error.message);
  }
  app.quit();
}

function showAfterInitialization(): void {
  if (!desktopInitialization) return;
  void desktopInitialization.then(showApplicationWindow).catch(handleStartupFailure);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAfterInitialization();
  });

  desktopInitialization = app.whenReady().then(async () => {
    // Hold the Electron singleton before inspecting or creating the current
    // data root. Historical layouts fail closed and are never renamed here.
    const desktopDataPaths = await prepareDesktopDataPaths(os.homedir());
    logger = setupLogger(desktopDataPaths.userDataDir);
    for (const event of desktopDataPaths.events) logger.info(event);
    logger.info('ReceiptBI Desktop starting...');
    brandIconDataUrl = loadBrandIconDataUrl();
    if (process.platform === 'darwin' && !app.isPackaged) {
      app.dock?.setIcon(developmentIconPath);
    }
    processManager = new ProcessManager(logger, desktopDataPaths);
    registerIpcHandlers(ipcMain, processManager, logger);
  });
  showAfterInitialization();

  app.on('activate', () => {
    showAfterInitialization();
  });
}

app.on('before-quit', (event) => {
  if (quitCleanupFinished) return;
  event.preventDefault();
  if (quitCleanupStarted) return;

  quitCleanupStarted = true;
  logger.info('Application quitting...');
  void (async () => {
    try {
      await processManager?.stopAll();
    } catch (error) {
      logger.error('Failed to stop services cleanly', error);
    } finally {
      quitCleanupFinished = true;
      app.quit();
    }
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  app.quit();
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
});
