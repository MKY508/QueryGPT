const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let mainWindow;
let backend;

app.whenReady().then(() => {
  // 启动后端
  const backendPath = path.join(process.resourcesPath, 'QueryGPT-Backend');
  backend = spawn(backendPath);
  
  // 等待2秒让后端启动
  setTimeout(() => {
    // 创建窗口
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    // 加载应用
    mainWindow.loadURL('http://localhost:5000');
    
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }, 2000);
});

app.on('window-all-closed', () => {
  if (backend) backend.kill();
  app.quit();
});