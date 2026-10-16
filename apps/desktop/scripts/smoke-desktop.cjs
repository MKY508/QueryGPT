// Manual smoke window using the production preload and IPC handlers. It never
// starts ReceiptBI services or opens an existing project/database.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { createServer } = require('node:http');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { configureDesktopWindow, isTrustedDesktopSender } = require('../dist-electron/desktop-security.js');
const { registerIpcHandlers } = require('../dist-electron/ipc-handlers.js');
const { RENDERER_CHUNK_FAILURE_CHANNEL, isRendererChunkFailureReport } = require('../dist-electron/frontend-reliability.js');
const { installDesktopMenu } = require('../dist-electron/menu.js');
const { installDesktopCloseGuard } = require('../dist-electron/desktop-close.js');
const { DESKTOP_NAVIGATE_CHANNEL, DESKTOP_NAVIGATION_READY_CHANNEL } = require('../dist-electron/desktop-navigation.js');

const dataDir = mkdtempSync(join(tmpdir(), 'receiptbi-desktop-smoke-'));
app.setPath('userData', dataDir);
app.setName('ReceiptBI Desktop Smoke');
const logger = { info: console.log, warn: console.warn, error: console.error, debug: console.debug };
let validChunkReport = false;
let preloadError = null;
let server;
let smokeWindow;
let closeGuard;

const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'nonce-smoke'; style-src 'nonce-smoke'">
<title>ReceiptBI Desktop Smoke</title>
<style nonce="smoke">body{font:16px system-ui;padding:32px;color:#163a2d;background:#fafaf9}button{padding:10px 16px;font:inherit}pre{white-space:pre-wrap;line-height:1.7}</style>
<h1>ReceiptBI desktop check</h1><p>Isolated window. No project data is loaded.</p>
<button id="run">Run desktop check</button> <button id="close">Close</button>
<p><button id="edit">Make unsaved change</button> <label><input id="fail-save" type="checkbox">Simulate save failure</label></p>
<p><label><input id="pending-upload" type="checkbox">Simulate pending upload</label></p>
<p id="edit-status">No unsaved changes</p>
<pre id="result" role="status">Ready</pre><p id="navigation">Choose a page from the application menu.</p>
<script nonce="smoke">
window.electronAPI?.onNavigate((page)=>{document.getElementById('navigation').textContent='Navigation: '+page;}, 'en');
let dirty=false, revision=0, discardApproval=null;
window.electronAPI?.onPrepareClose(async(command)=>{
  if(command==='cancel'){discardApproval=null;return 'unavailable';}
  if(document.getElementById('pending-upload').checked) return 'uploads';
  if(command==='discard'){discardApproval=revision;return 'clean';}
  if(command==='save' && !document.getElementById('fail-save').checked){
    dirty=false;
    document.getElementById('edit-status').textContent='Changes saved';
  }
  return dirty?'dirty':'clean';
});
window.addEventListener('beforeunload',(event)=>{
  const approved=discardApproval===revision;discardApproval=null;
  if(document.getElementById('pending-upload').checked || (dirty && !approved)) event.preventDefault();
});
document.getElementById('edit').onclick=()=>{dirty=true;revision++;document.getElementById('edit-status').textContent='Unsaved changes';};
window.addEventListener('error',(event)=>window.electronAPI?.reportChunkLoadFailure({name:'Error',message:event.message}));
document.getElementById('close').onclick=()=>window.electronAPI?.quitApp();
document.getElementById('run').onclick=async()=>{
  const results={};
  try {
    results.nodeHidden=typeof require==='undefined' && typeof process==='undefined';
    const info=await window.electronAPI.getAppInfo();
    results.appInfo=typeof info.version==='string' && info.platform.length>0;
    const status=await window.electronAPI.getServiceStatus();
    results.serviceStatus=status.backend.running && status.frontend.running;
    results.externalSchemeDenied=false;
    try { await window.electronAPI.openExternal('file:///not-an-allowed-web-link'); }
    catch { results.externalSchemeDenied=true; }
    // Use an actual uncaught browser error, not a synthetic event in one JS world.
    await new Promise((resolve)=>{
      window.addEventListener('error',()=>resolve(),{once:true});
      setTimeout(()=>{throw new Error('Loading chunk 1 failed. /_next/static/chunks/1.js');},0);
    });
    await window.electronAPI.getAppInfo();
    const response=await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(results)});
    const checked=await response.json();
    document.getElementById('result').textContent=(checked.passed?'PASS':'FAIL')+'\\n'+JSON.stringify(checked,null,2);
  } catch(error) { document.getElementById('result').textContent='FAIL: '+error.message; }
};
</script></html>`;

app.whenReady().then(async () => {
  server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/result') {
      let body = '';
      request.on('data', (part) => { body += part; });
      request.on('end', () => {
        const checks = { ...JSON.parse(body), validChunkReport, preloadLoaded: !preloadError };
        const result = { passed: Object.values(checks).every((value) => value === true), electron: process.versions.electron, checks };
        console.log(JSON.stringify(result));
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(result));
      });
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(html);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const frontendUrl = 'http://127.0.0.1:' + server.address().port;
  const window = new BrowserWindow({ width: 760, height: 600, title: 'ReceiptBI Desktop Smoke',
    webPreferences: { preload: join(__dirname, '../dist-electron/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  configureDesktopWindow(window, { frontendUrl, startupUrls: new Set() }, async () => {
    throw new Error('Smoke checks must not launch external applications');
  }, console.error);
  smokeWindow = window;
  closeGuard = installDesktopCloseGuard(window, ipcMain, {
    locale: () => 'en',
    showDialog: (options) => dialog.showMessageBox(window, options),
    quit: () => app.quit(), onError: console.error,
  });
  registerIpcHandlers(ipcMain, {
    getStatus: () => ({ backend: { running: true }, frontend: { running: true } }),
    getUserDataDir: () => dataDir,
  }, logger);
  ipcMain.on(RENDERER_CHUNK_FAILURE_CHANNEL, (event, report) => {
    validChunkReport = isTrustedDesktopSender(event) && isRendererChunkFailureReport(report);
  });
  ipcMain.on(DESKTOP_NAVIGATION_READY_CHANNEL, (event) => {
    if (isTrustedDesktopSender(event)) installDesktopMenu((page) => {
      window.webContents.send(DESKTOP_NAVIGATE_CHANNEL, page);
    }, 'en');
  });
  window.webContents.on('preload-error', (_event, _path, error) => { preloadError = String(error); console.error(preloadError); });
  await window.loadURL(frontendUrl);
}).catch((error) => { console.error(error); app.exit(1); });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (!smokeWindow || smokeWindow.isDestroyed() || !closeGuard) return;
  event.preventDefault();
  void closeGuard.requestQuit();
});
app.on('quit', () => {
  server?.close();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* OS may still be releasing its cache files. */ }
});
