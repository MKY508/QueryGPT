import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import type { DesktopLocale, DesktopPage } from './desktop-navigation.js';

const labels = {
  zh: {
    about: '关于 ReceiptBI', settings: '设置…', workspace: '工作台', file: '文件',
    edit: '编辑', view: '显示', window: '窗口', help: '帮助', undo: '撤销', redo: '重做',
    cut: '剪切', copy: '拷贝', paste: '粘贴', pastePlain: '粘贴并匹配样式',
    selectAll: '全选', delete: '删除', actualSize: '实际大小', zoomIn: '放大', zoomOut: '缩小',
    fullscreen: '切换全屏', minimize: '最小化', zoom: '缩放', close: '关闭窗口',
    quit: '退出 ReceiptBI', hide: '隐藏 ReceiptBI', hideOthers: '隐藏其他', showAll: '全部显示',
    services: '服务', front: '全部置于顶层', reload: '重新加载', devtools: '开发者工具',
  },
  en: {
    about: 'About ReceiptBI', settings: 'Settings…', workspace: 'Workspace', file: 'File',
    edit: 'Edit', view: 'View', window: 'Window', help: 'Help', undo: 'Undo', redo: 'Redo',
    cut: 'Cut', copy: 'Copy', paste: 'Paste', pastePlain: 'Paste and Match Style',
    selectAll: 'Select All', delete: 'Delete', actualSize: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out',
    fullscreen: 'Toggle Full Screen', minimize: 'Minimize', zoom: 'Zoom', close: 'Close Window',
    quit: 'Quit ReceiptBI', hide: 'Hide ReceiptBI', hideOthers: 'Hide Others', showAll: 'Show All',
    services: 'Services', front: 'Bring All to Front', reload: 'Reload', devtools: 'Developer Tools',
  },
} as const;

// Standard editing/window actions use Electron roles so native keyboard and
// accessibility behavior remain intact. App pages use the existing SPA router.
export function installDesktopMenu(navigate: (page: DesktopPage) => void, locale: DesktopLocale): void {
  const t = labels[locale];
  const mac = process.platform === 'darwin';
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  const settings: MenuItemConstructorOptions = {
    id: 'receiptbi-settings', label: t.settings, accelerator: 'CmdOrCtrl+,',
    click: () => navigate('/settings'),
  };
  const about: MenuItemConstructorOptions = {
    id: 'receiptbi-about', label: t.about, click: () => navigate('/about'),
  };
  const template: MenuItemConstructorOptions[] = [];
  if (mac) {
    template.push({ label: 'ReceiptBI', submenu: [
      about, separator, settings, separator, { role: 'services', label: t.services }, separator,
      { role: 'hide', label: t.hide }, { role: 'hideOthers', label: t.hideOthers },
      { role: 'unhide', label: t.showAll }, separator, { role: 'quit', label: t.quit },
    ] });
  }
  template.push(
    { label: t.file, submenu: [
      { id: 'receiptbi-workspace', label: t.workspace, click: () => navigate('/') },
      ...(!mac ? [separator, settings] : []),
      separator, { role: 'close', label: t.close },
      ...(!mac ? [{ role: 'quit' as const, label: t.quit }] : []),
    ] },
    { label: t.edit, submenu: [
      { role: 'undo', label: t.undo }, { role: 'redo', label: t.redo }, separator,
      { role: 'cut', label: t.cut }, { role: 'copy', label: t.copy },
      { role: 'paste', label: t.paste }, { role: 'pasteAndMatchStyle', label: t.pastePlain },
      { role: 'delete', label: t.delete }, separator, { role: 'selectAll', label: t.selectAll },
    ] },
    { label: t.view, submenu: [
      ...(!app.isPackaged ? [
        { role: 'reload' as const, label: t.reload },
        { role: 'toggleDevTools' as const, label: t.devtools }, separator,
      ] : []),
      { role: 'resetZoom', label: t.actualSize }, { role: 'zoomIn', label: t.zoomIn },
      { role: 'zoomOut', label: t.zoomOut }, separator, { role: 'togglefullscreen', label: t.fullscreen },
    ] },
    { label: t.window, submenu: [
      { role: 'minimize', label: t.minimize }, { role: 'zoom', label: t.zoom },
      ...(mac ? [separator, { role: 'front' as const, label: t.front }] : []),
    ] },
  );
  if (!mac) template.push({ role: 'help', label: t.help, submenu: [about] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
