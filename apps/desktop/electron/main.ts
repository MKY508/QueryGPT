import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import windowStateKeeper from 'electron-window-state';
import { ProcessManager } from './process-manager.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { createStartupPages, type StartupPages } from './startup-pages.js';
import { createStartupRecoveryHandler, openStartupFolder, retryStartup } from './startup-recovery.js';
import { STARTUP_ACTION_CHANNEL } from './startup-protocol.js';
import { configureDesktopWindow, isTrustedDesktopSender } from './desktop-security.js';
import { installDesktopCloseGuard } from './desktop-close.js';
import { installDesktopMenu } from './menu.js';
import {
  DESKTOP_NAVIGATE_CHANNEL, DESKTOP_NAVIGATION_READY_CHANNEL, desktopLocale,
  type DesktopLocale, type DesktopPage,
} from './desktop-navigation.js';
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
let openingWindow: Promise<void> | null = null;
let pendingNavigation: DesktopPage | null = null;
let rendererNavigationReady = false;
let menuLocale: DesktopLocale = 'zh';
const closeGuards = new WeakMap<BrowserWindow, ReturnType<typeof installDesktopCloseGuard>>();

const developmentIconPath = path.join(__dirname, '../resources/icon/icon.png');

const windowPages = new WeakMap<BrowserWindow, Record<DesktopLocale, StartupPages>>();

function startupPage(win: BrowserWindow, kind: keyof StartupPages): string {
  const pages = windowPages.get(win);
  if (!pages) throw new Error('Startup pages are not initialized');
  return pages[menuLocale][kind];
}

function startupErrorUrls(win: BrowserWindow): ReadonlySet<string> {
  return new Set(Object.values(windowPages.get(win) ?? {})
    .flatMap((pages) => [pages.error, pages.assetsError]));
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
  if (!processManager) throw new Error('Process manager is not initialized');
  frontendChunkRecovery = new ChunkLoadRecoveryGate();
  rendererNavigationReady = false;
  const windowState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 800,
    path: processManager.getUserDataDir(),
  });
  const win = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: Math.max(DESKTOP_MIN_WIDTH, windowState.width),
    height: windowState.height,
    minWidth: DESKTOP_MIN_WIDTH,
    minHeight: 600,
    title: 'ReceiptBI',
    icon: app.isPackaged ? undefined : developmentIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101814' : '#fafaf9',
  });
  const pages = {
    zh: createStartupPages(brandIconDataUrl, 'zh'),
    en: createStartupPages(brandIconDataUrl, 'en'),
  };
  windowPages.set(win, pages);
  const startupUrl = startupPage(win, 'loading');
  configureDesktopWindow(win, {
    frontendUrl: processManager.getFrontendUrl(),
    startupUrls: new Set(Object.values(pages).flatMap((locale) => Object.values(locale))),
  }, (url) => shell.openExternal(url), (error) => logger.warn('Unable to open link', error));
  closeGuards.set(win, installDesktopCloseGuard(win, ipcMain, {
    locale: () => menuLocale,
    showDialog: (options) => dialog.showMessageBox(win, options),
    quit: () => app.quit(),
    onError: (error) => logger.error('Unable to finish closing the window', error),
  }));
  const removeChunkRequestMonitor = installChunkRequestMonitor(win);
  win.once('closed', removeChunkRequestMonitor);
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) rendererNavigationReady = false;
  });

  // 立即显示 loading 页面
  await win.loadURL(startupUrl);
  windowState.manage(win);
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
    await win.loadURL(startupPage(win, 'assetsError'));
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
    !isTrustedDesktopSender(event) ||
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

async function openApplicationWindow(): Promise<void> {
  if (quitCleanupStarted) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const win = await createWindow();
  if (quitCleanupStarted || win.isDestroyed()) return;
  mainWindow = win;
  win.once('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      rendererNavigationReady = false;
    }
  });

  await startWindowServices(win);
}

async function startWindowServices(win: BrowserWindow): Promise<void> {
  const recovery = frontendChunkRecovery;
  try {
    if (!processManager) throw new Error('Process manager is not initialized');
    // Window reopening and a UI-only retry reuse the already-ready service pair.
    if (!processManager.isReady()) await processManager.startAll();
    if (quitCleanupStarted || win.isDestroyed() || mainWindow !== win
      || frontendChunkRecovery !== recovery || recovery?.terminal) return;

    const frontendUrl = processManager.getFrontendUrl();
    await win.loadURL(frontendUrl);
    if (!recovery?.recoveryAttempted) {
      logger.info(`Frontend loaded: ${frontendUrl}`);
    }
  } catch (error) {
    if (frontendChunkRecovery !== recovery || recovery?.recoveryAttempted) {
      logger.debug('Initial frontend navigation was superseded by chunk recovery');
      return;
    }
    logger.error('Failed to start services', error);
    if (!quitCleanupStarted && !win.isDestroyed() && mainWindow === win) {
      await win.loadURL(startupPage(win, 'error'));
    }
  }
}

function showApplicationWindow(): Promise<void> {
  if (openingWindow) return openingWindow;
  openingWindow = openApplicationWindow().finally(() => { openingWindow = null; });
  return openingWindow;
}

ipcMain.handle(STARTUP_ACTION_CHANNEL, createStartupRecoveryHandler({
  currentWindow: () => quitCleanupStarted ? null : mainWindow,
  errorUrls: startupErrorUrls,
  retry: (win) => retryStartup({
    pending: openingWindow,
    isErrorPage: () => startupErrorUrls(win).has(win.webContents.getURL()),
    isCurrent: () => !quitCleanupStarted && !win.isDestroyed() && mainWindow === win,
    reset: () => {
      frontendChunkRecovery = new ChunkLoadRecoveryGate();
      rendererNavigationReady = false;
    },
    showLoading: () => win.loadURL(startupPage(win, 'loading')),
    start: () => startWindowServices(win),
  }),
  openFolder: (folder) => {
    if (!processManager) return Promise.resolve('unavailable');
    return openStartupFolder(processManager.getStartupFolder(folder), (directory) => shell.openPath(directory));
  },
  onError: (error) => logger.error('Startup recovery action failed', error),
}));

function flushDesktopNavigation(): void {
  const win = mainWindow;
  if (!pendingNavigation || !rendererNavigationReady || !win || win.isDestroyed() || quitCleanupStarted) return;
  if (!isCurrentFrontendUrl(win.webContents.getURL())) return;
  const page = pendingNavigation;
  pendingNavigation = null;
  win.webContents.send(DESKTOP_NAVIGATE_CHANNEL, page);
}

function navigateFromDesktop(page: DesktopPage): void {
  if (quitCleanupStarted || !desktopInitialization) return;
  // Keep the most recent user intent while services/the renderer are starting.
  pendingNavigation = page;
  void desktopInitialization.then(showApplicationWindow).then(flushDesktopNavigation).catch(handleStartupFailure);
}

ipcMain.on(DESKTOP_NAVIGATION_READY_CHANNEL, (event, locale: unknown) => {
  if (event.sender !== mainWindow?.webContents || !isTrustedDesktopSender(event)) return;
  rendererNavigationReady = true;
  const nextLocale = desktopLocale(locale);
  if (nextLocale !== menuLocale) {
    menuLocale = nextLocale;
    installDesktopMenu(navigateFromDesktop, menuLocale);
  }
  flushDesktopNavigation();
});

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
    menuLocale = desktopLocale(app.getLocale());
    installDesktopMenu(navigateFromDesktop, menuLocale);
  });
  showAfterInitialization();

  app.on('activate', () => {
    showAfterInitialization();
  });
}

app.on('before-quit', (event) => {
  if (quitCleanupFinished) return;
  // Include a window still showing the startup page, before mainWindow is set.
  const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && closeGuards.has(candidate));
  const guard = win && closeGuards.get(win);
  if (!guard) return;
  event.preventDefault();
  void guard.requestQuit();
});

app.on('will-quit', (event) => {
  if (quitCleanupFinished) return;
  // before-quit can be canceled by an unsaved report. Only stop services after
  // every window has really closed, so Cancel always leaves a usable workspace.
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
