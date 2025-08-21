# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from pathlib import Path

block_cipher = None

# 获取项目根目录
ROOT_DIR = os.path.abspath('.')

# 收集所有 Python 文件
a = Analysis(
    ['backend/app.py'],  # 主入口文件
    pathex=[ROOT_DIR, os.path.join(ROOT_DIR, 'backend')],
    binaries=[],
    datas=[
        # 包含整个前端目录
        ('frontend', 'frontend'),
        # 包含后端配置和数据文件
        ('backend/semantic_layer.json', 'backend'),
        ('backend/table_classification.json', 'backend'),
        # 包含必要的脚本
        ('setup.sh', '.'),
        ('start.sh', '.'),
        ('quick_start.sh', '.'),
        ('requirements.txt', '.'),
        # 包含文档
        ('README.md', '.'),
        ('LICENSE', '.'),
        ('docs', 'docs'),
    ],
    hiddenimports=[
        'open_interpreter',
        'flask',
        'flask_cors',
        'pymysql',
        'pandas',
        'plotly',
        'numpy',
        'cryptography',
        'sqlite3',
        'json',
        'datetime',
        'hashlib',
        'threading',
        'queue',
        'copy',
        'traceback',
        'logging',
        'typing',
        'pathlib',
        'urllib',
        'urllib.parse',
        'werkzeug',
        'werkzeug.serving',
        'werkzeug.security',
        'jinja2',
        'markupsafe',
        'click',
        'itsdangerous',
        'plotly.graph_objects',
        'plotly.express',
        'pandas.io.sql',
        'sqlalchemy',
        'openai',
        'tiktoken',
        'regex',
        'requests',
        'aiohttp',
        'asyncio',
        'nest_asyncio',
        'rich',
        'inquirer',
        'blessed',
        'readchar',
        'python_editor',
        'six',
        'wcwidth',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'tkinter',
        'PyQt5',
        'PyQt6',
        'PySide2',
        'PySide6',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# 不同平台的配置
if sys.platform == 'darwin':  # macOS
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name='QueryGPT',
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=True,
        console=False,  # macOS 不显示控制台
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon='docs/images/icon.icns' if os.path.exists('docs/images/icon.icns') else None,
    )
    
    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name='QueryGPT',
    )
    
    app = BUNDLE(
        coll,
        name='QueryGPT.app',
        icon='docs/images/icon.icns' if os.path.exists('docs/images/icon.icns') else None,
        bundle_identifier='com.maokaiyue.querygpt',
        info_plist={
            'CFBundleName': 'QueryGPT',
            'CFBundleDisplayName': 'QueryGPT - 智能数据分析平台',
            'CFBundleGetInfoString': '自然语言数据库查询系统',
            'CFBundleIdentifier': 'com.maokaiyue.querygpt',
            'CFBundleVersion': '1.0.0',
            'CFBundleShortVersionString': '1.0.0',
            'NSHighResolutionCapable': True,
            'LSMinimumSystemVersion': '10.13.0',
            'NSRequiresAquaSystemAppearance': False,
            'LSApplicationCategoryType': 'public.app-category.developer-tools',
        },
    )
    
elif sys.platform == 'win32':  # Windows
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.zipfiles,
        a.datas,
        [],
        name='QueryGPT',
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=True,
        upx_exclude=[],
        runtime_tmpdir=None,
        console=True,  # Windows 显示控制台以便查看日志
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon='docs/images/icon.ico' if os.path.exists('docs/images/icon.ico') else None,
        version_file='version_info.txt' if os.path.exists('version_info.txt') else None,
    )
    
else:  # Linux
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.zipfiles,
        a.datas,
        [],
        name='QueryGPT',
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=True,
        upx_exclude=[],
        runtime_tmpdir=None,
        console=True,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
    )