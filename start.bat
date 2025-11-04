@echo off
setlocal EnableDelayedExpansion

set VERSION=1.5
set VENV_DIR=venv_py310

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

set ACTIVATE_BAT=%VENV_DIR%\Scripts\activate.bat
if not exist "%ACTIVATE_BAT%" (
    echo ✗ 未找到虚拟环境，请先运行 setup.bat
    exit /b 1
)

call "%ACTIVATE_BAT%"
set PYTHON_BIN=%VENV_DIR%\Scripts\python.exe
echo ✓ 虚拟环境已激活：%VIRTUAL_ENV%
echo.

if not exist ".env" (
    echo ✗ 缺少 .env 配置，请先运行 setup.bat
    exit /b 1
)

if not defined PORT set PORT=5000
for /f "usebackq tokens=*" %%p in (`powershell -NoProfile -Command "param([int]$start,[int]$max) function Get-FreePort([int]$s,[int]$m){ for($p=$s;$p -le $m;$p++){ $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback,$p); try { $listener.Start(); $listener.Stop(); return $p } catch { $listener.Stop() } } return Get-Random -Minimum 20000 -Maximum 30000 } Get-FreePort $env:PORT 5100"`) do set PORT=%%p

echo ℹ 服务端口：%PORT%
echo ℹ 访问地址：http://localhost:%PORT%
echo ⚠ 按 Ctrl+C 停止服务
echo.

set PROJECT_ROOT=%CD%
for /f "usebackq tokens=*" %%p in (`powershell -NoProfile -Command "$env:PORT=%PORT%; $psi = New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName = '%PYTHON_BIN%'; $psi.Arguments = 'backend\app.py'; $psi.WorkingDirectory = '%PROJECT_ROOT%'; $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $false; $psi.RedirectStandardError = $false; $proc = [System.Diagnostics.Process]::Start($psi); Write-Output $proc.Id"`) do set APP_PID=%%p

if not defined APP_PID (
    echo ✗ 无法启动后端服务
    exit /b 1
)

set /a ATTEMPTS=0
set /a MAX_ATTEMPTS=30
echo ℹ 等待后端就绪

:WAIT_HEALTH
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/api/health' -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    set /a ATTEMPTS+=1
    if !ATTEMPTS! lss !MAX_ATTEMPTS! (
        timeout /t 1 /nobreak >nul
        goto :WAIT_HEALTH
    )
    echo ⚠ 未检测到健康检查响应，可手动访问 http://localhost:%PORT% 验证。
) else (
    echo ✓ 后端服务已启动
    start "" "http://localhost:%PORT%"
)

echo ℹ 正在监听后端日志，按 Ctrl+C 停止
powershell -NoProfile -Command "try { Wait-Process -Id %APP_PID% } finally { if (Get-Process -Id %APP_PID% -ErrorAction SilentlyContinue) { Stop-Process -Id %APP_PID% -Force } }"

endlocal

