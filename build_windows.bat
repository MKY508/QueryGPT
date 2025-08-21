@echo off
echo ========================================
echo   QueryGPT Windows 打包脚本
echo ========================================
echo.

REM 检查 Python 环境
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.10+
    pause
    exit /b 1
)

REM 安装打包依赖
echo [1/5] 安装打包工具...
pip install pyinstaller pillow requests

REM 创建图标（如果不存在）
if not exist "docs\images\icon.ico" (
    echo [2/5] 创建应用图标...
    python -c "from PIL import Image; img = Image.new('RGBA', (256, 256), (66, 135, 245, 255)); img.save('docs/images/icon.ico', 'ICO')"
)

REM 创建版本信息文件
echo [3/5] 创建版本信息...
(
echo # UTF-8
echo VSVersionInfo^(
echo   ffi=FixedFileInfo^(
echo     filevers=^(1, 0, 0, 0^),
echo     prodvers=^(1, 0, 0, 0^),
echo     mask=0x3f,
echo     flags=0x0,
echo     OS=0x40004,
echo     fileType=0x1,
echo     subtype=0x0,
echo     date=^(0, 0^)
echo   ^),
echo   kids=[
echo     StringFileInfo^(
echo       [
echo         StringTable^(
echo           u'040904B0',
echo           [StringStruct^(u'CompanyName', u'Mao Kaiyue'^),
echo            StringStruct^(u'FileDescription', u'QueryGPT - 智能数据分析平台'^),
echo            StringStruct^(u'FileVersion', u'1.0.0'^),
echo            StringStruct^(u'InternalName', u'QueryGPT'^),
echo            StringStruct^(u'LegalCopyright', u'© 2025 Mao Kaiyue. MIT License'^),
echo            StringStruct^(u'OriginalFilename', u'QueryGPT.exe'^),
echo            StringStruct^(u'ProductName', u'QueryGPT'^),
echo            StringStruct^(u'ProductVersion', u'1.0.0'^)]
echo         ^)
echo       ]
echo     ^),
echo     VarFileInfo^([VarStruct^(u'Translation', [1033, 1200]^)]^)
echo   ]
echo ^)
) > version_info.txt

REM 清理旧的构建
echo [4/5] 清理旧的构建文件...
if exist "dist" rmdir /s /q "dist"
if exist "build" rmdir /s /q "build"

REM 开始打包
echo [5/5] 开始打包...
echo.
pyinstaller querygpt.spec --clean --noconfirm

if errorlevel 1 (
    echo.
    echo [错误] 打包失败！
    pause
    exit /b 1
)

REM 创建启动脚本
echo 创建启动脚本...
(
echo @echo off
echo title QueryGPT - 智能数据分析平台
echo echo ========================================
echo echo   QueryGPT 正在启动...
echo echo ========================================
echo echo.
echo echo 访问地址: http://localhost:5000
echo echo 按 Ctrl+C 关闭服务器
echo echo.
echo QueryGPT.exe
echo pause
) > dist\启动QueryGPT.bat

REM 复制配置文件模板
echo 复制配置文件...
if not exist "dist\.env" (
    (
    echo # QueryGPT 配置文件
    echo # 请根据实际情况修改
    echo.
    echo # OpenAI API 配置
    echo OPENAI_API_KEY=your_api_key_here
    echo OPENAI_BASE_URL=https://api.openai.com/v1
    echo.
    echo # 数据库配置
    echo DB_HOST=localhost
    echo DB_PORT=3306
    echo DB_USER=root
    echo DB_PASSWORD=
    echo DB_NAME=test
    ) > dist\.env.example
)

REM 创建 README
(
echo QueryGPT Windows 版本
echo ====================
echo.
echo 使用方法：
echo 1. 双击 "启动QueryGPT.bat" 运行程序
echo 2. 在浏览器中访问 http://localhost:5000
echo 3. 首次使用请修改 .env.example 为 .env 并配置数据库信息
echo.
echo 系统要求：
echo - Windows 10/11
echo - 支持的数据库：MySQL、PostgreSQL、SQLite
echo.
echo 注意事项：
echo - 确保防火墙允许 5000 端口
echo - 如果端口被占用，程序会自动选择其他端口
) > dist\README.txt

echo.
echo ========================================
echo   打包完成！
echo   输出目录: dist\
echo   运行方式: 双击 dist\启动QueryGPT.bat
echo ========================================
pause