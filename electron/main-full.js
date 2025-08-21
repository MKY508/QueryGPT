const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const isDev = require('electron-is-dev');
const log = require('electron-log');

// 配置日志
log.transports.file.level = 'info';
log.info('QueryGPT Desktop starting...');

let mainWindow;
let pythonProcess = null;
let setupWindow = null;
const serverPort = 5000;

// 检查 Python 环境
async function checkPythonEnvironment() {
  return new Promise((resolve) => {
    // 检查虚拟环境
    const venvPath = isDev 
      ? path.join(__dirname, '..', 'venv_py310')
      : path.join(process.resourcesPath, 'venv_py310');
    
    if (fs.existsSync(venvPath)) {
      log.info('Python virtual environment found');
      resolve(true);
    } else {
      log.warn('Python virtual environment not found');
      resolve(false);
    }
  });
}

// 创建安装窗口
function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  setupWindow.loadFile(path.join(__dirname, 'setup.html'));
}

// 执行安装
async function runSetup() {
  return new Promise((resolve, reject) => {
    const setupScript = isDev
      ? path.join(__dirname, '..', 'setup.sh')
      : path.join(process.resourcesPath, 'setup.sh');
    
    log.info(`Running setup script: ${setupScript}`);
    
    const setupProcess = spawn('bash', [setupScript], {
      cwd: isDev ? path.join(__dirname, '..') : process.resourcesPath
    });

    setupProcess.stdout.on('data', (data) => {
      log.info(`Setup: ${data}`);
      if (setupWindow) {
        setupWindow.webContents.send('setup-progress', data.toString());
      }
    });

    setupProcess.stderr.on('data', (data) => {
      log.error(`Setup error: ${data}`);
    });

    setupProcess.on('close', (code) => {
      if (code === 0) {
        log.info('Setup completed successfully');
        resolve();
      } else {
        log.error(`Setup failed with code ${code}`);
        reject(new Error('Setup failed'));
      }
    });
  });
}

// 启动 Python 后端
function startPythonServer() {
  return new Promise((resolve, reject) => {
    // 使用 start.sh 脚本启动
    const startScript = isDev
      ? path.join(__dirname, '..', 'start.sh')
      : path.join(process.resourcesPath, 'start.sh');
    
    // 如果 start.sh 不存在，使用 quick_start.sh
    const quickStartScript = isDev
      ? path.join(__dirname, '..', 'quick_start.sh')
      : path.join(process.resourcesPath, 'quick_start.sh');
    
    let scriptToRun = fs.existsSync(startScript) ? startScript : quickStartScript;
    
    log.info(`Starting backend with: ${scriptToRun}`);
    
    pythonProcess = spawn('bash', [scriptToRun], {
      cwd: isDev ? path.join(__dirname, '..') : process.resourcesPath,
      env: { ...process.env, PORT: serverPort }
    });

    pythonProcess.stdout.on('data', (data) => {
      log.info(`Backend: ${data}`);
      if (data.toString().includes('Running on') || data.toString().includes('启动成功')) {
        setTimeout(() => resolve(), 3000); // 等待服务器完全启动
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      log.error(`Backend error: ${data}`);
    });

    pythonProcess.on('error', (error) => {
      log.error(`Failed to start backend: ${error}`);
      reject(error);
    });

    pythonProcess.on('close', (code) => {
      log.info(`Backend process exited with code ${code}`);
    });

    // 设置超时
    setTimeout(() => {
      // 即使没有明确的启动信号，也尝试继续
      resolve();
    }, 10000);
  });
}

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    titleBarStyle: 'hiddenInset', // macOS 风格标题栏
    backgroundColor: '#f0f2f5'
  });

  // 加载应用
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // 错误处理
  mainWindow.webContents.on('did-fail-load', () => {
    log.error('Failed to load app from server');
    // 加载错误页面
    mainWindow.loadFile(path.join(__dirname, 'error.html'));
  });

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // 窗口关闭时的处理
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 创建菜单
function createMenu() {
  const template = [
    {
      label: 'QueryGPT',
      submenu: [
        {
          label: '关于 QueryGPT',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 QueryGPT',
              message: 'QueryGPT v1.0.0',
              detail: '智能数据分析平台\n\n基于自然语言的数据库查询系统\n作者: Mao Kaiyue\n\n完整功能版',
              buttons: ['确定']
            });
          }
        },
        { type: 'separator' },
        {
          label: '检查更新',
          click: () => {
            shell.openExternal('https://github.com/MKY508/QueryGPT/releases');
          }
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: '开发者工具',
          accelerator: 'F12',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.toggleDevTools();
            }
          }
        }
      ]
    },
    {
      label: '工具',
      submenu: [
        {
          label: '配置数据库',
          click: () => {
            // 打开配置对话框
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '配置数据库',
              message: '数据库配置',
              detail: '请编辑 .env 文件配置数据库连接\n位置：应用目录/.env',
              buttons: ['打开配置目录', '取消']
            }).then(result => {
              if (result.response === 0) {
                shell.showItemInFolder(path.join(app.getPath('userData'), '.env'));
              }
            });
          }
        },
        {
          label: '查看日志',
          click: () => {
            shell.showItemInFolder(log.transports.file.getFile().path);
          }
        },
        { type: 'separator' },
        {
          label: '重启后端服务',
          click: async () => {
            if (pythonProcess) {
              pythonProcess.kill();
              pythonProcess = null;
            }
            await startPythonServer();
            mainWindow.reload();
          }
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '使用文档',
          click: () => {
            shell.openExternal('https://github.com/MKY508/QueryGPT#readme');
          }
        },
        {
          label: '报告问题',
          click: () => {
            shell.openExternal('https://github.com/MKY508/QueryGPT/issues');
          }
        },
        { type: 'separator' },
        {
          label: 'GitHub 仓库',
          click: () => {
            shell.openExternal('https://github.com/MKY508/QueryGPT');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 应用准备就绪
app.whenReady().then(async () => {
  try {
    // 检查 Python 环境
    const hasEnv = await checkPythonEnvironment();
    
    if (!hasEnv && !isDev) {
      // 生产环境且没有环境，显示安装窗口
      createSetupWindow();
      await runSetup();
      if (setupWindow) {
        setupWindow.close();
      }
    }
    
    // 显示启动画面
    const splash = new BrowserWindow({
      width: 400,
      height: 300,
      frame: false,
      alwaysOnTop: true,
      transparent: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    
    splash.loadFile(path.join(__dirname, 'splash.html'));
    
    // 启动 Python 服务器
    try {
      await startPythonServer();
    } catch (error) {
      log.error('Failed to start Python server:', error);
      dialog.showErrorBox('启动失败', '无法启动后端服务\n请确保已安装 Python 3.10 和所需依赖');
    }
    
    // 关闭启动画面
    setTimeout(() => {
      splash.close();
      
      // 创建主窗口
      createWindow();
      createMenu();
    }, 2000);
  } catch (error) {
    log.error('Failed to start application:', error);
    dialog.showErrorBox('启动失败', '应用程序启动失败\n' + error.message);
    app.quit();
  }
});

// 所有窗口关闭时的处理
app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用激活时的处理（macOS）
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// 应用退出前的清理
app.on('before-quit', () => {
  if (pythonProcess) {
    log.info('Terminating Python process...');
    pythonProcess.kill();
  }
});