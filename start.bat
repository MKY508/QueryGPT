@echo off
setlocal enabledelayedexpansion

set VERSION=1.5
set VENV_DIR=venv_py310
if defined PORT (
    set DEFAULT_PORT=%PORT%
) else (
    set DEFAULT_PORT=5000
)

cd /d "%~dp0"

echo.
echo ╔══════════════════════════════╗
echo ║  QueryGPT Start  v%VERSION%      ║
echo ╚══════════════════════════════╝
echo.

if not exist "backend\app.py" (
    echo ✗ 请在项目根目录执行 start.bat
    exit /b 1
)

set ACTIVATE_SCRIPT=%VENV_DIR%\Scripts\activate.bat
if not exist "%ACTIVATE_SCRIPT%" (
    echo ✗ 未找到虚拟环境，请先运行 setup.bat
    exit /b 1
)

call "%ACTIVATE_SCRIPT%"
set PYTHON_BIN=%VENV_DIR%\Scripts\python.exe
echo ✓ 虚拟环境已激活：%VIRTUAL_ENV%
echo.

if not exist ".env" (
    echo ✗ 缺少 .env 配置，请先运行 setup.bat
    exit /b 1
)

if not exist "config\models.json" (
    echo ⚠ 未检测到 config\models.json，可在设置页面补全模型配置。
)

echo ℹ 查找可用端口
set PORT=%DEFAULT_PORT%
:find_port
python -c "import socket; s=socket.socket(); result=s.connect_ex(('127.0.0.1', %PORT%)); s.close(); exit(0 if result != 0 else 1)" >nul 2>&1
if errorlevel 1 (
    set /a PORT+=1
    if %PORT% leq 5100 goto :find_port
    set /a PORT=%RANDOM% %% 10000 + 20000
)
echo ℹ 服务端口：%PORT%
echo ℹ 访问地址：http://localhost:%PORT%
echo ⚠ 按 Ctrl+C 停止服务
echo.

start /b "" "%PYTHON_BIN%" backend\app.py
set APP_PID=%ERRORLEVEL%

timeout /t 2 /nobreak >nul

echo ℹ 等待后端就绪
set ATTEMPTS=0
set MAX_ATTEMPTS=30
:wait_loop
powershell -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/api/health' -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    set /a ATTEMPTS+=1
    if !ATTEMPTS! lss %MAX_ATTEMPTS% (
        timeout /t 1 /nobreak >nul
        goto :wait_loop
    )
    echo ⚠ 未检测到健康检查响应，可手动访问 http://localhost:%PORT% 验证。
) else (
    echo ✓ 后端服务已启动
    start "" "http://localhost:%PORT%"
)

cd backend
"%PYTHON_BIN%" app.py

