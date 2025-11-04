@echo off
setlocal enabledelayedexpansion

set VERSION=1.5
set PYTHON_REQUIRED=3.10
set VENV_DIR=venv_py310

cd /d "%~dp0"

echo.
echo ╔══════════════════════════════╗
echo ║   QueryGPT Setup  v%VERSION%     ║
echo ╚══════════════════════════════╝
echo.

if not exist "backend\app.py" (
    echo ✗ 请在项目根目录执行 setup.bat
    exit /b 1
)

echo ℹ 运行环境：Windows
echo.

echo ℹ 检查目录结构
if not exist "logs" mkdir logs
if not exist "cache" mkdir cache
if not exist "output" mkdir output
if not exist "backend\output" mkdir backend\output
if not exist "backend\config" mkdir backend\config
if not exist "config" mkdir config
echo ✓ 目录已就绪
echo.

echo ℹ 检测 Python 环境
set PYTHON_CMD=
for %%p in (python3.10 python3 python) do (
    where %%p >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        for /f "delims=" %%i in ('where %%p') do set PYTHON_PATH=%%i
        for /f "delims=" %%v in ('%%p -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do set PYTHON_VERSION=%%v
        if "!PYTHON_VERSION!"=="%PYTHON_REQUIRED%" (
            set PYTHON_CMD=!PYTHON_PATH!
            echo ✓ 检测到 Python %PYTHON_REQUIRED%：!PYTHON_CMD!
            goto :found_python
        )
    )
)

echo ✗ 需要 Python %PYTHON_REQUIRED%，请安装对应版本后重试。
exit /b 1

:found_python

if not exist "%VENV_DIR%" (
    echo ℹ 创建虚拟环境：%VENV_DIR%
    "%PYTHON_CMD%" -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo ✗ 无法创建虚拟环境，请确认已安装 Python %PYTHON_REQUIRED%
        exit /b 1
    )
) else (
    echo ℹ 使用已有虚拟环境：%VENV_DIR%
)

set ACTIVATE_SCRIPT=%VENV_DIR%\Scripts\activate.bat
if not exist "%ACTIVATE_SCRIPT%" (
    echo ✗ 虚拟环境缺少激活脚本，请删除 %VENV_DIR% 后重新执行 setup.bat
    exit /b 1
)

call "%ACTIVATE_SCRIPT%"
set PIP_BIN=%VENV_DIR%\Scripts\pip.exe

echo ℹ 升级 pip
"%PIP_BIN%" install --upgrade pip --quiet >nul 2>&1
echo ✓ 虚拟环境已激活：%VIRTUAL_ENV%
echo.

if not exist "requirements.txt" (
    echo ✗ 未找到 requirements.txt
    exit /b 1
)

echo ℹ 安装依赖 (requirements.txt)
echo ⚠ OpenInterpreter 包较大，安装过程可能需要数分钟。
"%PIP_BIN%" install -r requirements.txt
if errorlevel 1 (
    echo ✗ 依赖安装失败
    exit /b 1
)
echo ✓ 依赖安装完成
echo.

if exist ".env" (
    echo ℹ .env 已存在，跳过生成
) else (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
    ) else (
        (
            echo # API配置
            echo API_KEY=
            echo API_BASE_URL=https://api.openai.com/v1/
            echo DEFAULT_MODEL=gpt-4.1
            echo.
            echo # 数据库配置
            echo DB_HOST=127.0.0.1
            echo DB_PORT=3306
            echo DB_USER=root
            echo DB_PASSWORD=
            echo DB_DATABASE=test
            echo.
            echo # 系统配置
            echo LOG_LEVEL=INFO
            echo LOG_FILE=logs\app.log
            echo CACHE_TTL=3600
            echo OUTPUT_DIR=output
            echo CACHE_DIR=cache
        ) > .env
    )
    echo ✓ 已生成 .env 配置
)

echo.
echo ℹ 同步模型与系统配置
if exist "config\models.example.json" if not exist "config\models.json" (
    copy /y "config\models.example.json" "config\models.json" >nul
    echo ✓ 同步文件：config\models.json
)
if exist "config\config.example.json" if not exist "config\config.json" (
    copy /y "config\config.example.json" "config\config.json" >nul
    echo ✓ 同步文件：config\config.json
)
if exist "config\models.json" if not exist "backend\config\models.json" (
    if not exist "backend\config" mkdir backend\config
    copy /y "config\models.json" "backend\config\models.json" >nul
    echo ✓ 同步文件：backend\config\models.json
)
if exist "config\config.json" if not exist "backend\config\config.json" (
    if not exist "backend\config" mkdir backend\config
    copy /y "config\config.json" "backend\config\config.json" >nul
    echo ✓ 同步文件：backend\config\config.json
)
echo ✓ 配置检查完成

echo.
echo ✓ 环境配置完成
echo ℹ 虚拟环境：%VIRTUAL_ENV%
echo ℹ 下一步：运行 start.bat 启动服务
echo.

