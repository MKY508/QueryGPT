#!/usr/bin/env tsx
/**
 * 构建 Python 后端 (PyInstaller --onedir)
 *
 * 流程:
 * 1. 从 apps/api 生成 requirements.txt
 * 2. 创建临时 venv 并安装依赖
 * 3. 生成 PyInstaller spec 文件
 * 4. 运行 PyInstaller 打包
 * 5. 复制输出到 apps/desktop/backend/
 */

import { execFileSync, execSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { assertNoBundledRuntimeData } from './packaging-policy.js';

const ROOT = resolve(__dirname, '../../..');
const API_DIR = join(ROOT, 'apps/api');
const DESKTOP_DIR = join(ROOT, 'apps/desktop');
const BUILD_DIR = join(DESKTOP_DIR, 'build');
const BACKEND_OUT = join(DESKTOP_DIR, 'backend');
const SQLITE_EXECUTOR_WORKSPACE = ROOT;
const SQLITE_SIDECAR_PACKAGE = 'receiptbi-sqlite-executor-sidecar';
const SQLITE_SIDECAR_NAME = process.platform === 'win32'
  ? 'receiptbi-sqlite-executor-sidecar.exe'
  : 'receiptbi-sqlite-executor-sidecar';

function run(cmd: string, opts?: { cwd?: string; stdio?: 'inherit' | 'pipe' }) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, {
    cwd: opts?.cwd ?? ROOT,
    stdio: opts?.stdio ?? 'inherit',
    encoding: 'utf-8',
    env: process.env,
    shell: true,
  });
}

function runFile(file: string, args: string[]): void {
  execFileSync(file, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
}

function fixSymlinks(dir: string) {
  const { readdirSync, lstatSync, existsSync, copyFileSync, unlinkSync, readlinkSync, symlinkSync } = require('node:fs');
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') fixSymlinks(full);
    } else if (entry.isSymbolicLink()) {
      const target = readlinkSync(full);
      if (target.startsWith('/')) {
        const dirOfLink = dirname(full);
        const resolved = resolve(dirOfLink, target);
        if (existsSync(resolved)) {
          if (lstatSync(resolved).isDirectory()) {
            // 目录符号链接：绝对路径转为相对路径
            unlinkSync(full);
            const rel = relative(dirOfLink, resolved);
            symlinkSync(rel, full);
            console.log(`  Fixed dir symlink: ${entry.name} -> ${rel}`);
          } else {
            unlinkSync(full);
            copyFileSync(resolved, full);
            console.log(`  Replaced symlink with file: ${entry.name}`);
          }
        } else {
          console.warn(`  Warning: symlink target not found: ${target}`);
          unlinkSync(full);
          const rel = relative(dirOfLink, resolved);
          symlinkSync(rel, full);
          console.log(`  Fixed symlink (target missing): ${entry.name} -> ${rel}`);
        }
      }
    }
  }
}

async function main() {
  console.log('=== Building Python Backend ===\n');

  mkdirSync(BUILD_DIR, { recursive: true });

  // 1. 生成 requirements.txt
  console.log('[1/5] Generating requirements.txt...');
  const requirementsPath = join(BUILD_DIR, 'requirements.txt');
  try {
    execFileSync('uv', ['--version'], { stdio: 'pipe' });
  } catch {
    throw new Error('Desktop packaging requires uv to install the committed uv.lock. See docs/DEVELOPMENT.md.');
  }
  const exportArgs = [
    'export', '--locked', '--package', 'receiptbi-api', '--no-dev',
    '--no-emit-workspace', '--no-hashes', '--no-annotate', '--no-header',
  ];
  runFile('uv', [...exportArgs, '--output-file', requirementsPath]);
  const buildRequirementsPath = join(BUILD_DIR, 'build-requirements.txt');
  runFile('uv', [...exportArgs, '--extra', 'desktop-build', '--output-file', buildRequirementsPath]);

  // 2. Build with the same Python minor version as the release runners.
  console.log('\n[2/5] Creating build venv with Python 3.13...');
  const venvDir = join(BUILD_DIR, '.build-venv');
  if (existsSync(venvDir)) rmSync(venvDir, { recursive: true });
  runFile('uv', ['venv', venvDir, '--python', '3.13']);

  const python = join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');

  // 安装 pyinstaller 和依赖
  console.log('Installing PyInstaller and dependencies...');
  runFile('uv', ['pip', 'sync', '--python', python, buildRequirementsPath]);

  // Generate the exact distribution inventory from the build environment. The
  // runtime dependency installer uses importlib.metadata to decide which
  // bundled packages it can reuse, so every runtime distribution needs its
  // .dist-info metadata in the frozen application (not just packages that call
  // metadata.version() during import).
  console.log('Generating bundled distribution inventory...');
  const inventoryPath = join(BUILD_DIR, 'builtin-distributions.json');
  const inventoryWriterPath = join(BUILD_DIR, 'write-distribution-inventory.py');
  writeFileSync(inventoryWriterPath, `
import json
import platform
import sys
from importlib import metadata
from pathlib import Path

from packaging.requirements import InvalidRequirement, Requirement
from packaging.utils import canonicalize_name


inventory_path = Path(sys.argv[1])
requirements_path = Path(sys.argv[2])
required_names = {}

# requirements.txt is exported from uv.lock without build-only tools, so it
# is the authoritative runtime dependency closure on the current platform.
for line_number, raw_line in enumerate(
    requirements_path.read_text(encoding="utf-8").splitlines(),
    start=1,
):
    line = raw_line.strip()
    if not line or line.startswith("#"):
        continue
    try:
        requirement = Requirement(line)
    except InvalidRequirement as error:
        raise RuntimeError(
            f"Invalid compiled requirement on line {line_number}: {line}"
        ) from error
    if requirement.marker is None or requirement.marker.evaluate():
        required_names[str(canonicalize_name(requirement.name))] = requirement.name

distributions = []
for canonical_name, requested_name in sorted(required_names.items()):
    distribution = metadata.distribution(requested_name)
    name = distribution.metadata["Name"]
    distributions.append({
        "name": name,
        "canonical_name": canonical_name,
        "version": distribution.version,
    })

payload = {
    "schema_version": 1,
    "python_version": platform.python_version(),
    "distributions": distributions,
}
inventory_path.write_text(
    json.dumps(payload, ensure_ascii=False, indent=2) + "\\n",
    encoding="utf-8",
)
`);
  runFile(python, [inventoryWriterPath, inventoryPath, requirementsPath]);

  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf-8')) as {
    distributions?: Array<{ name?: string; canonical_name?: string; version?: string }>;
  };
  if (!Array.isArray(inventory.distributions) || inventory.distributions.length === 0) {
    throw new Error('Bundled distribution inventory is empty');
  }
  for (const item of inventory.distributions) {
    if (!item.name || !item.canonical_name || !item.version) {
      throw new Error(`Invalid bundled distribution inventory entry: ${JSON.stringify(item)}`);
    }
  }
  console.log(`  Recorded ${inventory.distributions.length} runtime distributions`);

  // 3. 收集可能动态导入的模块
  console.log('\n[3/5] Collecting dynamic imports...');
  const hiddenImports = [
    'uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto',
    'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan', 'uvicorn.lifespan.on',
    'fastapi', 'fastapi.applications', 'fastapi.routing',
    'pydantic', 'pydantic_settings',
    'sqlalchemy', 'sqlalchemy.ext', 'sqlalchemy.ext.asyncio',
    'aiosqlite', 'sqlalchemy.dialects.sqlite.aiosqlite', 'sqlalchemy.dialects.sqlite',
    'pydantic_ai', 'pydantic_ai.models.openai', 'pydantic_ai.models.anthropic',
    'pydantic_ai.providers.openai', 'pydantic_ai.providers.anthropic',
    'openai', 'anthropic', 'wren_core',
    'pandas', 'numpy', 'matplotlib', 'matplotlib.backends.backend_agg',
    'seaborn', 'duckdb', 'polars', 'pyarrow', 'plotly', 'openpyxl', 'xlrd', 'IPython',
    'ijson', 'ijson.backends.yajl2_c', 'ijson.backends._yajl2', 'ijson.backends.python',
    'pip', 'pip._internal', 'pip._internal.cli.main',
    'slowapi', 'httpx', 'structlog', 'cryptography', 'alembic',
    'sse_starlette', 'asyncpg', 'pymysql', 'psycopg2',
    'charset_normalizer', 'idna', 'certifi', 'urllib3', 'jinja2',
    'python_multipart', 'dotenv', 'email_validator',
    'click', 'anyio', 'sniffio',
    'tiktoken', 'tiktoken_ext', 'tiktoken_ext.openai_public',
  ];

  // 4. 运行 PyInstaller
  console.log('\n[4/5] Running PyInstaller...');
  // 使用桌面专用入口（直接传 app 对象给 uvicorn，避免字符串 import 在 frozen 环境失败）
  const desktopEntry = join(DESKTOP_DIR, 'scripts', 'desktop-entry.py');
  const apiMainPy = desktopEntry;

  const assetsSrc = join(API_DIR, 'app', 'assets');
  const assetsExist = existsSync(assetsSrc);
  const alembicSrc = join(API_DIR, 'alembic');
  const alembicIni = join(API_DIR, 'alembic.ini');
  if (!existsSync(join(alembicSrc, 'versions')) || !existsSync(alembicIni)) {
    throw new Error('Alembic migration resources are missing');
  }

  const specPath = join(BUILD_DIR, 'receiptbi-api.spec');
  const outDir = join(ROOT, 'dist', 'receiptbi-api');
  const distDir = join(BUILD_DIR, 'dist').replace(/\\/g, '\\\\');

  // 生成 runtime hook：强制导入 aiosqlite（hiddenimport 无法保证纯 Python 包被打包）
  const runtimeHookContent = 'import aiosqlite  # noqa: F401\n';
  const runtimeHookPath = join(BUILD_DIR, 'runtime-hook.py');
  writeFileSync(runtimeHookPath, runtimeHookContent);

  const spec = `
# -*- mode: python ; coding: utf-8 -*-
import json, os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata
block_cipher = None
distpath = '${distDir}'

# 收集需要数据文件的包
_extra_datas = []
for _pkg in ['tiktoken_ext', 'certifi', 'charset_normalizer', 'plotly', 'pip']:
    try:
        _extra_datas += collect_data_files(_pkg)
    except Exception:
        pass

# Preserve metadata for every runtime distribution installed from the compiled
# API requirements. This lets importlib.metadata and pip's resolver see the
# packages already bundled with the desktop application.
_inventory_path = '${inventoryPath.replace(/\\/g, '\\\\')}'
with open(_inventory_path, encoding='utf-8') as _inventory_file:
    _runtime_distributions = json.load(_inventory_file)['distributions']
for _distribution in _runtime_distributions:
    _name = _distribution['name']
    try:
        _extra_datas += copy_metadata(_name)
    except Exception as _error:
        raise RuntimeError(f'Unable to bundle metadata for {_name}') from _error
_extra_datas.append((_inventory_path, '.'))

a = Analysis(
    ['${apiMainPy.replace(/\\/g, '\\\\')}'],
    pathex=['${API_DIR.replace(/\\/g, '\\\\')}'],
    binaries=[],
    datas=[
${assetsExist ? `        ('${assetsSrc.replace(/\\/g, '\\\\')}', 'app\\\\assets'),` : ''}
        ('${alembicSrc.replace(/\\/g, '\\\\')}', 'alembic'),
        ('${alembicIni.replace(/\\/g, '\\\\')}', '.'),
    ] + _extra_datas,
    hiddenimports=[${hiddenImports.map(s => `'${s}'`).join(', ')}] + collect_submodules('pip') + collect_submodules('alembic'),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['${runtimeHookPath.replace(/\\/g, '\\\\')}'],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='receiptbi-api',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='receiptbi-api',
)
`;

  writeFileSync(specPath, spec);

  runFile(python, ['-m', 'PyInstaller', '--clean', '-y', specPath]);
  assertNoBundledRuntimeData(outDir, 'PyInstaller output');

  // 5. 复制输出到 backend/
  console.log('\n[5/5] Copying to apps/desktop/backend/...');
  const backendStaging = join(BUILD_DIR, 'backend-staging');
  if (existsSync(backendStaging)) rmSync(backendStaging, { recursive: true });
  mkdirSync(backendStaging, { recursive: true });

  // 先在原始输出目录修复绝对符号链接（此时绝对路径仍然有效，existsSync 能正确判断目标类型）
  if (process.platform !== 'win32') {
    fixSymlinks(outDir);
  }

  if (process.platform === 'win32') {
    cpSync(outDir, backendStaging, { recursive: true });
  } else {
    // cp -a 保留符号链接原样，不会触发 ENOTSUP
    run(`cp -a "${outDir}/." "${backendStaging}/"`, { cwd: ROOT });
  }

  // 复制 .env.example
  const envExample = join(API_DIR, '.env.example');
  if (existsSync(envExample)) {
    copyFileSync(envExample, join(backendStaging, '.env.example'));
  }

  // The packaged desktop is the trusted execution environment. Build the
  // low-coupling Rust sidecar into the same resource directory as the frozen
  // API; non-desktop development intentionally keeps the Python fallback.
  console.log('\nBuilding trusted SQLite sidecar...');
  runFile('cargo', ['build', '--locked', '--release', '-p', SQLITE_SIDECAR_PACKAGE]);
  const configuredTargetDir = process.env.CARGO_TARGET_DIR;
  const rustTargetDir = configuredTargetDir
    ? resolve(SQLITE_EXECUTOR_WORKSPACE, configuredTargetDir)
    : join(SQLITE_EXECUTOR_WORKSPACE, 'target');
  const sqliteSidecarSource = join(rustTargetDir, 'release', SQLITE_SIDECAR_NAME);
  if (!existsSync(sqliteSidecarSource)) {
    throw new Error(`Trusted SQLite sidecar was not built: ${sqliteSidecarSource}`);
  }
  const sqliteSidecarDestination = join(backendStaging, SQLITE_SIDECAR_NAME);
  copyFileSync(sqliteSidecarSource, sqliteSidecarDestination);
  if (process.platform !== 'win32') chmodSync(sqliteSidecarDestination, 0o755);

  assertNoBundledRuntimeData(backendStaging, 'desktop backend resources');
  if (existsSync(BACKEND_OUT)) rmSync(BACKEND_OUT, { recursive: true });
  renameSync(backendStaging, BACKEND_OUT);

  console.log(`\n✓ Backend built at: ${BACKEND_OUT}`);
  console.log(`  (Next step: run scripts/build-next.ts to build the frontend)`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
