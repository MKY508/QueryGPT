const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const log = require('electron-log');

// 应用配置
const APP_CONFIG = {
  name: 'QueryGPT',
  version: '1.0.0',
  serverPort: 5000,
  serverHost: '127.0.0.1'
};

// 全局变量
let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let isQuitting = false;

// 配置日志
log.transports.file.level = 'info';
Object.assign(console, log.functions);

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

// 第二个实例启动时聚焦主窗口
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

/**
 * 创建启动窗口
 */
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 360,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash-pro.html'));
  splashWindow.center();
}

/**
 * 创建主窗口
 */
function createMainWindow() {
  // 窗口配置
  const windowConfig = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f5f5f5',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  };

  // 设置图标
  if (process.platform === 'darwin') {
    windowConfig.icon = path.join(__dirname, '..', 'build', 'icon.icns');
  } else if (process.platform === 'win32') {
    windowConfig.icon = path.join(__dirname, '..', 'build', 'icon.ico');
  } else {
    windowConfig.icon = path.join(__dirname, '..', 'build', 'icon.png');
  }

  mainWindow = new BrowserWindow(windowConfig);

  // 加载应用
  const startUrl = `http://${APP_CONFIG.serverHost}:${APP_CONFIG.serverPort}`;
  
  // 等待服务器启动
  let retries = 0;
  const maxRetries = 30;
  
  const loadApp = () => {
    mainWindow.loadURL(startUrl).catch(err => {
      if (retries < maxRetries) {
        retries++;
        setTimeout(loadApp, 1000);
      } else {
        console.error('Failed to connect to backend server');
        mainWindow.loadFile(path.join(__dirname, 'error.html'));
      }
    });
  };

  // 窗口事件
  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      setTimeout(() => {
        splashWindow.close();
        mainWindow.show();
      }, 1500);
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 开始加载
  setTimeout(loadApp, 2000);
}

/**
 * 启动后端服务
 */
async function startBackend() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(app.getAppPath(), 'electron_start.sh');
    
    console.log('Starting backend service...');
    
    backendProcess = spawn('bash', [scriptPath], {
      cwd: app.getAppPath(),
      env: { ...process.env, PORT: APP_CONFIG.serverPort }
    });

    backendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Backend:', output);
      
      if (output.includes('Starting on port') || output.includes('Running on')) {
        resolve();
      }
    });

    backendProcess.stderr.on('data', (data) => {
      console.error('Backend error:', data.toString());
    });

    backendProcess.on('error', (error) => {
      console.error('Failed to start backend:', error);
      reject(error);
    });

    // 超时处理
    setTimeout(() => resolve(), 5000);
  });
}

/**
 * 创建应用菜单
 */
function createMenu() {
  const isMac = process.platform === 'darwin';
  
  const template = [
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://github.com/MKY508/QueryGPT#readme');
          }
        },
        {
          label: 'Report Issue',
          click: () => {
            shell.openExternal('https://github.com/MKY508/QueryGPT/issues');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * 应用初始化
 */
app.whenReady().then(async () => {
  // 创建启动窗口
  createSplashWindow();
  
  try {
    // 启动后端
    await startBackend();
    
    // 创建主窗口
    createMainWindow();
    
    // 创建菜单
    createMenu();
  } catch (error) {
    console.error('Initialization failed:', error);
    app.quit();
  }
});

/**
 * 应用事件处理
 */
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  } else {
    mainWindow.show();
  }
});

app.on('will-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});