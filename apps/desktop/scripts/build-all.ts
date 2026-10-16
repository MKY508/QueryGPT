#!/usr/bin/env tsx
/**
 * 一键构建脚本
 *
 * 依次执行:
 * 1. TypeScript 编译 Electron 主进程
 * 2. 构建 Python 后端 (PyInstaller)
 * 3. 构建 Next.js 前端
 *
 * 本脚本也是所有本地 build:electron:* 命令的资源准备入口，避免
 * electron-builder 直接复用 apps/desktop/next 中的历史产物。
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const DESKTOP_DIR = resolve(__dirname, '..');
const requireFromDesktop = createRequire(resolve(DESKTOP_DIR, 'package.json'));

function run(args: string[]) {
  execFileSync(process.execPath, args, {
    cwd: DESKTOP_DIR,
    stdio: 'inherit',
    encoding: 'utf-8',
    env: process.env,
  });
}

async function main() {
  console.log('=== ReceiptBI Desktop Build ===\n');

  run(['../../scripts/version.mjs', '--check']);

  // 1. TypeScript 编译
  console.log('[1/3] Building Electron main process...');
  run(['scripts/build-electron.mjs']);

  // 2. 构建 Python 后端
  console.log('\n[2/3] Building Python backend (PyInstaller)...');
  run([requireFromDesktop.resolve('tsx/cli'), 'scripts/build-pyinstaller.ts']);

  // 3. 构建 Next.js 前端
  console.log('\n[3/3] Building Next.js frontend...');
  run([requireFromDesktop.resolve('tsx/cli'), 'scripts/build-next.ts']);

  console.log('\n=== Build Complete ===');
  console.log('Desktop resources are ready.');
  console.log('Use build:electron:* directly for normal local packaging; those commands');
  console.log('always rerun this resource build before electron-builder.');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
