@echo off
REM QueryGPT v2 Windows 启动脚本
REM 支持: Windows 10/11

setlocal enabledelayedexpansion

REM 颜色不支持，使用文本标记
set "INFO=[INFO]"
set "OK=[OK]"
set "WARN=[WARN]"
set "ERROR=[ERROR]"

REM 项目根目录
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM 创建日志目录
if not exist "logs" mkdir logs

REM 解析命令
if "%1"=="stop" goto :stop
if "%1"=="restart" goto :restart
if "%1"=="status" goto :status
if "%1"=="logs" goto :logs
if "%1"=="setup" goto :setup
if "%1"=="help" goto :help
if "%1"=="--help" goto :help
if "%1"=="-h" goto :help
if "%1"=="" goto :start
echo %ERROR% 未知命令: %1
echo 运行 'start.bat help' 查看帮助
exit /b 1

:start
echo %INFO% QueryGPT v2 启动中...
echo.

REM 检查依赖
call :check_dependencies
if errorlevel 1 exit /b 1

REM 设置环境
call :setup_python
call :setup_node
call :setup_env

REM 启动数据库
call :start_database

REM 等待数据库
timeout /t 3 /nobreak >nul

REM 启动后端
call :start_backend

REM 等待后端
timeout /t 2 /nobreak >nul

REM 启动前端
call :start_frontend

REM 等待前端
timeout /t 3 /nobreak >nul

REM 显示状态
call :show_status
goto :eof

:check_dependencies
echo %INFO% 检查依赖...

REM 检查 Python
where python >nul 2>&1
if errorlevel 1 (
    echo %ERROR% Python 未安装
    echo 请从 https://www.python.org/downloads/ 下载安装
    exit /b 1
)
set "PYTHON_CMD=python"

REM 检查 Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo %ERROR% Node.js 未安装
    echo 请从 https://nodejs.org/ 下载安装
    exit /b 1
)

REM 检查 npm
where npm >nul 2>&1
if errorlevel 1 (
    echo %ERROR% npm 未安装
    exit /b 1
)
set "NPM_CMD=npm"

REM 检查 Docker (可选)
where docker >nul 2>&1
if errorlevel 1 (
    echo %WARN% Docker 未安装 - 需要手动配置 PostgreSQL
    set "HAS_DOCKER=0"
) else (
    set "HAS_DOCKER=1"
)

echo %OK% 依赖检查通过
exit /b 0

:setup_python
echo %INFO% 设置 Python 环境...

cd /d "%SCRIPT_DIR%apps\api"

if not exist ".venv" (
    echo %INFO% 创建虚拟环境...
    %PYTHON_CMD% -m venv .venv
)

REM 激活虚拟环境
call .venv\Scripts\activate.bat

REM 安装依赖
echo %INFO% 安装 Python 依赖...
pip install --upgrade pip -q
pip install -e . -q

echo %OK% Python 环境设置完成
cd /d "%SCRIPT_DIR%"
exit /b 0

:setup_node
echo %INFO% 设置 Node.js 环境...

cd /d "%SCRIPT_DIR%apps\web"

if not exist "node_modules" (
    echo %INFO% 安装 Node.js 依赖...
    call %NPM_CMD% install
)

echo %OK% Node.js 环境设置完成
cd /d "%SCRIPT_DIR%"
exit /b 0

:setup_env
echo %INFO% 配置环境变量...

if not exist "apps\api\.env" (
    if exist "apps\api\.env.example" (
        copy "apps\api\.env.example" "apps\api\.env" >nul
        echo %WARN% 已创建 apps\api\.env，请编辑填写配置
    )
)

if not exist "apps\web\.env.local" (
    echo NEXT_PUBLIC_API_URL=http://localhost:8000> "apps\web\.env.local"
    echo %OK% 已创建 apps\web\.env.local
)
exit /b 0

:start_database
if "%HAS_DOCKER%"=="0" (
    echo %WARN% Docker 未安装，跳过数据库启动
    echo %WARN% 请确保 PostgreSQL 已在 localhost:5432 运行
    exit /b 0
)

echo %INFO% 启动 PostgreSQL...

REM 检查容器是否存在
docker ps -a --format "{{.Names}}" | findstr /x "querygpt-db" >nul 2>&1
if errorlevel 1 (
    REM 创建新容器
    docker run -d ^
        --name querygpt-db ^
        -e POSTGRES_USER=postgres ^
        -e POSTGRES_PASSWORD=postgres ^
        -e POSTGRES_DB=querygpt ^
        -p 5432:5432 ^
        -v querygpt-pgdata:/var/lib/postgresql/data ^
        postgres:16-alpine
    echo %OK% PostgreSQL 容器已创建并启动
) else (
    REM 检查是否运行中
    docker ps --format "{{.Names}}" | findstr /x "querygpt-db" >nul 2>&1
    if errorlevel 1 (
        docker start querygpt-db
        echo %OK% PostgreSQL 已启动
    ) else (
        echo %OK% PostgreSQL 已在运行
    )
)
exit /b 0

:start_backend
echo %INFO% 启动后端服务...

cd /d "%SCRIPT_DIR%apps\api"
call .venv\Scripts\activate.bat

REM 后台启动
start /b cmd /c "python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > "%SCRIPT_DIR%logs\backend.log" 2>&1"

echo %OK% 后端服务已启动
cd /d "%SCRIPT_DIR%"
exit /b 0

:start_frontend
echo %INFO% 启动前端服务...

cd /d "%SCRIPT_DIR%apps\web"

REM 后台启动
start /b cmd /c "%NPM_CMD% run dev > "%SCRIPT_DIR%logs\frontend.log" 2>&1"

echo %OK% 前端服务已启动
cd /d "%SCRIPT_DIR%"
exit /b 0

:show_status
echo.
echo ==========================================
echo   QueryGPT v2 启动完成!
echo ==========================================
echo.
echo   前端:  http://localhost:3000
echo   后端:  http://localhost:8000
echo   API 文档: http://localhost:8000/api/docs
echo.
echo   日志文件:
echo      - 后端: logs\backend.log
echo      - 前端: logs\frontend.log
echo.
echo   停止服务: start.bat stop
echo ==========================================
exit /b 0

:stop
echo %INFO% 停止所有服务...

REM 停止 Python 进程
taskkill /f /im python.exe /fi "WINDOWTITLE eq uvicorn*" >nul 2>&1
taskkill /f /im uvicorn.exe >nul 2>&1

REM 停止 Node 进程
taskkill /f /im node.exe /fi "WINDOWTITLE eq next*" >nul 2>&1

echo %OK% 服务已停止
goto :eof

:restart
call :stop
timeout /t 2 /nobreak >nul
goto :start

:status
echo 服务状态:

REM 检查后端
netstat -an | findstr ":8000.*LISTENING" >nul 2>&1
if errorlevel 1 (
    echo   [X] 后端: 未运行
) else (
    echo   [V] 后端: 运行中 (端口 8000)
)

REM 检查前端
netstat -an | findstr ":3000.*LISTENING" >nul 2>&1
if errorlevel 1 (
    echo   [X] 前端: 未运行
) else (
    echo   [V] 前端: 运行中 (端口 3000)
)

REM 检查数据库
if "%HAS_DOCKER%"=="1" (
    docker ps --format "{{.Names}}" | findstr /x "querygpt-db" >nul 2>&1
    if errorlevel 1 (
        echo   [X] 数据库: 未运行
    ) else (
        echo   [V] 数据库: 运行中
    )
)
goto :eof

:logs
echo === 后端日志 (最后 20 行) ===
if exist "logs\backend.log" (
    powershell -command "Get-Content logs\backend.log -Tail 20"
) else (
    echo 无日志
)
echo.
echo === 前端日志 (最后 20 行) ===
if exist "logs\frontend.log" (
    powershell -command "Get-Content logs\frontend.log -Tail 20"
) else (
    echo 无日志
)
goto :eof

:setup
call :check_dependencies
if errorlevel 1 exit /b 1
call :setup_python
call :setup_node
call :setup_env
echo %OK% 环境设置完成
goto :eof

:help
echo QueryGPT v2 Windows 启动脚本
echo.
echo 用法: start.bat [命令]
echo.
echo 命令:
echo   (无参数)   启动所有服务
echo   stop       停止所有服务
echo   restart    重启所有服务
echo   status     查看服务状态
echo   logs       查看日志
echo   setup      仅安装依赖
echo   help       显示此帮助
goto :eof
