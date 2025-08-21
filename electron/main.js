const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const isDev = require('electron-is-dev');
const log = require('electron-log');

// 配置日志
log.transports.file.level = 'info';
log.info('QueryGPT starting...');

let mainWindow;
let pythonProcess = null;
const serverPort = 5000;

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
              detail: '智能数据分析平台\n\n基于自然语言的数据库查询系统\n作者: Mao Kaiyue',
              buttons: ['确定']
            });
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
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' }
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
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 启动 Python 后端
function startPythonServer() {
  return new Promise((resolve, reject) => {
    // 检查是否有虚拟环境
    const venvPath = path.join(__dirname, '..', 'venv', 'bin', 'python');
    const venvPath2 = path.join(__dirname, '..', 'venv', 'bin', 'python3');
    const fs = require('fs');
    
    let pythonExecutable = 'python3';
    if (fs.existsSync(venvPath)) {
      pythonExecutable = venvPath;
    } else if (fs.existsSync(venvPath2)) {
      pythonExecutable = venvPath2;
    }
    
    const scriptPath = isDev 
      ? path.join(__dirname, '..', 'backend', 'app.py')
      : path.join(process.resourcesPath, 'backend', 'app.py');
    
    log.info(`Starting Python server: ${pythonExecutable} ${scriptPath}`);
    
    pythonProcess = spawn(pythonExecutable, [scriptPath], {
      env: { ...process.env, FLASK_ENV: 'production' }
    });

    pythonProcess.stdout.on('data', (data) => {
      log.info(`Python stdout: ${data}`);
      if (data.toString().includes('Running on')) {
        setTimeout(() => resolve(), 2000); // 等待服务器完全启动
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      log.error(`Python stderr: ${data}`);
    });

    pythonProcess.on('error', (error) => {
      log.error(`Failed to start Python server: ${error}`);
      dialog.showErrorBox('启动失败', `无法启动后端服务: ${error.message}`);
      reject(error);
    });

    pythonProcess.on('close', (code) => {
      log.info(`Python process exited with code ${code}`);
    });

    // 设置超时
    setTimeout(() => {
      reject(new Error('Python server startup timeout'));
    }, 30000);
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
      webSecurity: true
    },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false
  });

  // 加载应用
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 窗口关闭时的处理
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 应用准备就绪
app.whenReady().then(async () => {
  try {
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
    await startPythonServer();
    
    // 关闭启动画面
    splash.close();
    
    // 创建主窗口
    createWindow();
    createMenu();
  } catch (error) {
    log.error('Failed to start application:', error);
    dialog.showErrorBox('启动失败', '应用程序启动失败，请检查日志');
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