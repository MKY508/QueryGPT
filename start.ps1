# QueryGPT v2 PowerShell 启动脚本
# 支持: Windows 10/11 PowerShell 5.1+

param(
    [Parameter(Position=0)]
    [string]$Command = "start"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# 颜色输出
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Blue }
function Write-OK { Write-Host "[OK] $args" -ForegroundColor Green }
function Write-Warn { Write-Host "[WARN] $args" -ForegroundColor Yellow }
function Write-Err { Write-Host "[ERROR] $args" -ForegroundColor Red; exit 1 }

# 检查命令是否存在
function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# 检查依赖
function Test-Dependencies {
    Write-Info "检查依赖..."

    $missing = @()

    # Python
    if (Test-Command "python") {
        $script:PythonCmd = "python"
    } elseif (Test-Command "python3") {
        $script:PythonCmd = "python3"
    } else {
        $missing += "python"
    }

    # Node.js
    if (-not (Test-Command "node")) {
        $missing += "node"
    }

    # npm
    if (Test-Command "pnpm") {
        $script:NpmCmd = "pnpm"
    } elseif (Test-Command "npm") {
        $script:NpmCmd = "npm"
    } else {
        $missing += "npm"
    }

    # Docker (可选)
    $script:HasDocker = Test-Command "docker"
    if (-not $script:HasDocker) {
        Write-Warn "Docker 未安装 - 需要手动配置 PostgreSQL"
    }

    if ($missing.Count -gt 0) {
        Write-Err "缺少依赖: $($missing -join ', ')"
    }

    Write-OK "依赖检查通过"
}

# 设置 Python 环境
function Setup-Python {
    Write-Info "设置 Python 环境..."

    Push-Location "$ScriptDir\apps\api"

    if (-not (Test-Path ".venv")) {
        Write-Info "创建虚拟环境..."
        & $script:PythonCmd -m venv .venv
    }

    # 激活虚拟环境
    & .\.venv\Scripts\Activate.ps1

    # 安装依赖
    Write-Info "安装 Python 依赖..."
    pip install --upgrade pip -q
    pip install -e . -q

    Write-OK "Python 环境设置完成"
    Pop-Location
}

# 设置 Node.js 环境
function Setup-Node {
    Write-Info "设置 Node.js 环境..."

    Push-Location "$ScriptDir\apps\web"

    if (-not (Test-Path "node_modules")) {
        Write-Info "安装 Node.js 依赖..."
        & $script:NpmCmd install
    }

    Write-OK "Node.js 环境设置完成"
    Pop-Location
}

# 配置环境变量
function Setup-Env {
    Write-Info "配置环境变量..."

    if (-not (Test-Path "apps\api\.env")) {
        if (Test-Path "apps\api\.env.example") {
            Copy-Item "apps\api\.env.example" "apps\api\.env"
            Write-Warn "已创建 apps\api\.env，请编辑填写配置"
        }
    }

    if (-not (Test-Path "apps\web\.env.local")) {
        "NEXT_PUBLIC_API_URL=http://localhost:8000" | Out-File -FilePath "apps\web\.env.local" -Encoding utf8
        Write-OK "已创建 apps\web\.env.local"
    }
}

# 启动数据库
function Start-Database {
    if (-not $script:HasDocker) {
        Write-Warn "Docker 未安装，跳过数据库启动"
        Write-Warn "请确保 PostgreSQL 已在 localhost:5432 运行"
        return
    }

    Write-Info "启动 PostgreSQL..."

    $containerExists = docker ps -a --format "{{.Names}}" | Select-String -Pattern "^querygpt-db$"

    if ($containerExists) {
        $containerRunning = docker ps --format "{{.Names}}" | Select-String -Pattern "^querygpt-db$"
        if ($containerRunning) {
            Write-OK "PostgreSQL 已在运行"
        } else {
            docker start querygpt-db
            Write-OK "PostgreSQL 已启动"
        }
    } else {
        docker run -d `
            --name querygpt-db `
            -e POSTGRES_USER=postgres `
            -e POSTGRES_PASSWORD=postgres `
            -e POSTGRES_DB=querygpt `
            -p 5432:5432 `
            -v querygpt-pgdata:/var/lib/postgresql/data `
            postgres:16-alpine
        Write-OK "PostgreSQL 容器已创建并启动"
    }
}

# 启动后端
function Start-Backend {
    Write-Info "启动后端服务..."

    Push-Location "$ScriptDir\apps\api"
    & .\.venv\Scripts\Activate.ps1

    $job = Start-Job -ScriptBlock {
        param($dir, $python)
        Set-Location $dir
        & "$dir\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    } -ArgumentList "$ScriptDir\apps\api", $script:PythonCmd

    $job.Id | Out-File -FilePath "$ScriptDir\.backend.pid"

    Write-OK "后端服务已启动 (Job ID: $($job.Id))"
    Pop-Location
}

# 启动前端
function Start-Frontend {
    Write-Info "启动前端服务..."

    Push-Location "$ScriptDir\apps\web"

    $job = Start-Job -ScriptBlock {
        param($dir, $npm)
        Set-Location $dir
        & $npm run dev
    } -ArgumentList "$ScriptDir\apps\web", $script:NpmCmd

    $job.Id | Out-File -FilePath "$ScriptDir\.frontend.pid"

    Write-OK "前端服务已启动 (Job ID: $($job.Id))"
    Pop-Location
}

# 停止服务
function Stop-Services {
    Write-Info "停止所有服务..."

    if (Test-Path ".backend.pid") {
        $jobId = Get-Content ".backend.pid"
        Stop-Job -Id $jobId -ErrorAction SilentlyContinue
        Remove-Job -Id $jobId -Force -ErrorAction SilentlyContinue
        Remove-Item ".backend.pid"
        Write-OK "后端服务已停止"
    }

    if (Test-Path ".frontend.pid") {
        $jobId = Get-Content ".frontend.pid"
        Stop-Job -Id $jobId -ErrorAction SilentlyContinue
        Remove-Job -Id $jobId -Force -ErrorAction SilentlyContinue
        Remove-Item ".frontend.pid"
        Write-OK "前端服务已停止"
    }

    # 停止残留进程
    Get-Process -Name "python", "node" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "uvicorn|next" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

# 显示状态
function Show-Status {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  QueryGPT v2 启动完成!" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  前端:  " -NoNewline; Write-Host "http://localhost:3000" -ForegroundColor Green
    Write-Host "  后端:  " -NoNewline; Write-Host "http://localhost:8000" -ForegroundColor Green
    Write-Host "  API 文档: " -NoNewline; Write-Host "http://localhost:8000/api/docs" -ForegroundColor Green
    Write-Host ""
    Write-Host "  日志文件:"
    Write-Host "     - 后端: logs\backend.log"
    Write-Host "     - 前端: logs\frontend.log"
    Write-Host ""
    Write-Host "  停止服务: " -NoNewline; Write-Host ".\start.ps1 stop" -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Cyan
}

# 显示帮助
function Show-Help {
    Write-Host "QueryGPT v2 PowerShell 启动脚本"
    Write-Host ""
    Write-Host "用法: .\start.ps1 [命令]"
    Write-Host ""
    Write-Host "命令:"
    Write-Host "  (无参数)   启动所有服务"
    Write-Host "  stop       停止所有服务"
    Write-Host "  restart    重启所有服务"
    Write-Host "  status     查看服务状态"
    Write-Host "  setup      仅安装依赖"
    Write-Host "  help       显示此帮助"
}

# 检查状态
function Check-Status {
    Write-Host "服务状态:"

    if ((Test-Path ".backend.pid") -and (Get-Job -Id (Get-Content ".backend.pid") -ErrorAction SilentlyContinue)) {
        Write-Host "  [V] 后端: 运行中" -ForegroundColor Green
    } else {
        Write-Host "  [X] 后端: 未运行" -ForegroundColor Red
    }

    if ((Test-Path ".frontend.pid") -and (Get-Job -Id (Get-Content ".frontend.pid") -ErrorAction SilentlyContinue)) {
        Write-Host "  [V] 前端: 运行中" -ForegroundColor Green
    } else {
        Write-Host "  [X] 前端: 未运行" -ForegroundColor Red
    }

    if ($script:HasDocker) {
        $dbRunning = docker ps --format "{{.Names}}" | Select-String -Pattern "^querygpt-db$"
        if ($dbRunning) {
            Write-Host "  [V] 数据库: 运行中" -ForegroundColor Green
        } else {
            Write-Host "  [X] 数据库: 未运行" -ForegroundColor Red
        }
    }
}

# 主逻辑
New-Item -ItemType Directory -Force -Path "logs" | Out-Null

switch ($Command.ToLower()) {
    "stop" {
        Stop-Services
    }
    "restart" {
        Stop-Services
        Start-Sleep -Seconds 2
        & $MyInvocation.MyCommand.Path
    }
    "status" {
        Test-Dependencies
        Check-Status
    }
    "setup" {
        Test-Dependencies
        Setup-Python
        Setup-Node
        Setup-Env
        Write-OK "环境设置完成"
    }
    { $_ -in "help", "--help", "-h" } {
        Show-Help
    }
    "start" {
        Test-Dependencies
        Setup-Python
        Setup-Node
        Setup-Env
        Start-Database
        Start-Sleep -Seconds 3
        Start-Backend
        Start-Sleep -Seconds 2
        Start-Frontend
        Start-Sleep -Seconds 3
        Show-Status
    }
    default {
        Write-Err "未知命令: $Command`n运行 '.\start.ps1 help' 查看帮助"
    }
}
