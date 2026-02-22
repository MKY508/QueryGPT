#!/usr/bin/env bash
#
# QueryGPT v2 一键启动脚本
# 支持: macOS, Linux, Windows (Git Bash/WSL)
#
set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 打印带颜色的消息
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# 检测操作系统
detect_os() {
    case "$(uname -s)" in
        Darwin*)  OS="macos" ;;
        Linux*)
            if grep -qi microsoft /proc/version 2>/dev/null; then
                OS="wsl"
            else
                OS="linux"
            fi
            ;;
        MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
        *)        OS="unknown" ;;
    esac
    info "检测到操作系统: $OS"
}

# 检查命令是否存在
check_command() {
    command -v "$1" &> /dev/null
}

# 激活 Python 虚拟环境
activate_venv() {
    if [ "$OS" = "windows" ]; then
        source "$SCRIPT_DIR/apps/api/.venv/Scripts/activate"
    else
        source "$SCRIPT_DIR/apps/api/.venv/bin/activate"
    fi
}

# 检查端口是否被占用
check_port() {
    local port=$1
    local pid=""

    if [ "$OS" = "macos" ]; then
        pid=$(lsof -ti:$port 2>/dev/null || true)
    else
        pid=$(lsof -ti:$port 2>/dev/null || ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K\d+' || true)
    fi

    if [ -n "$pid" ]; then
        echo "$pid"
        return 0
    fi
    return 1
}

# 检查所有需要的端口（自动终止冲突进程，无需交互）
check_ports() {
    for port in 8000 3000; do
        if pid=$(lsof -ti:$port 2>/dev/null); then
            warn "端口 $port 已占用 (PID: $pid)，自动终止..."
            kill -9 $pid 2>/dev/null || true
        fi
    done
    sleep 1
}

# 打开浏览器
open_browser() {
    local url="http://localhost:3000"

    info "正在打开浏览器..."

    case "$OS" in
        macos)
            open "$url" 2>/dev/null || true
            ;;
        linux)
            xdg-open "$url" 2>/dev/null || sensible-browser "$url" 2>/dev/null || true
            ;;
        wsl)
            cmd.exe /c start "$url" 2>/dev/null || true
            ;;
        windows)
            start "$url" 2>/dev/null || true
            ;;
    esac
}

# 智能 Python 版本选择（优先 3.11，确保 >= 3.11）
find_python() {
    for candidate in python3.11 python3.12 python3.13 python3.14 python3 python; do
        if command -v "$candidate" &>/dev/null; then
            local ver
            ver=$($candidate -c "import sys; print(sys.version_info >= (3,11))" 2>/dev/null)
            if [ "$ver" = "True" ]; then
                PYTHON_CMD="$candidate"
                return 0
            fi
        fi
    done
    return 1
}

# 检查依赖
check_dependencies() {
    info "检查依赖..."

    local missing=()

    # Docker (可选，用于数据库)
    if ! check_command docker; then
        warn "Docker 未安装 - 需要手动配置 PostgreSQL"
    fi

    # Python（优先 3.11，确保 >= 3.11）
    if ! find_python; then
        missing+=("python3 (>=3.11)")
    else
        info "使用 Python: $PYTHON_CMD ($($PYTHON_CMD --version 2>&1))"
    fi

    # Node.js
    if ! check_command node; then
        missing+=("node")
    fi

    # npm 或 pnpm
    if check_command pnpm; then
        NPM_CMD="pnpm"
    elif check_command npm; then
        NPM_CMD="npm"
    else
        missing+=("npm")
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        error "缺少依赖: ${missing[*]}\n请先安装这些依赖后再运行此脚本"
    fi

    success "依赖检查通过"
}

# 设置 Python 虚拟环境
setup_python_env() {
    info "设置 Python 环境..."

    cd "$SCRIPT_DIR/apps/api"

    if [ ! -d ".venv" ]; then
        info "创建虚拟环境..."
        $PYTHON_CMD -m venv .venv
    fi

    activate_venv

    # 安装依赖
    info "安装 Python 依赖..."
    pip install --upgrade pip -q
    pip install -e . -q

    success "Python 环境设置完成"
    cd "$SCRIPT_DIR"
}

# 设置 Node.js 环境
setup_node_env() {
    info "设置 Node.js 环境..."

    cd "$SCRIPT_DIR/apps/web"

    if [ ! -d "node_modules" ]; then
        info "安装 Node.js 依赖..."
        $NPM_CMD install
    fi

    success "Node.js 环境设置完成"
    cd "$SCRIPT_DIR"
}

# 配置环境变量
setup_env_files() {
    info "配置环境变量..."

    # 后端 .env
    if [ ! -f "apps/api/.env" ]; then
        if [ -f "apps/api/.env.example" ]; then
            cp apps/api/.env.example apps/api/.env
            warn "已创建 apps/api/.env，请编辑填写配置"
        fi
    fi

    # 前端 .env.local
    if [ ! -f "apps/web/.env.local" ]; then
        echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > apps/web/.env.local
        success "已创建 apps/web/.env.local"
    fi
}

# 启动 PostgreSQL (Docker)
start_database() {
    if ! check_command docker; then
        warn "Docker 未安装，跳过数据库启动"
        warn "请确保 PostgreSQL 已在 localhost:5432 运行"
        return
    fi

    # 检查 Docker daemon 是否运行
    if ! docker info &>/dev/null; then
        warn "Docker daemon 未运行，跳过数据库启动"
        warn "请确保 PostgreSQL 已在 localhost:5432 运行"
        return
    fi

    info "启动 PostgreSQL..."

    # 检查容器是否已存在
    if docker ps -a --format '{{.Names}}' | grep -q "^querygpt-db$"; then
        if docker ps --format '{{.Names}}' | grep -q "^querygpt-db$"; then
            success "PostgreSQL 已在运行"
        else
            docker start querygpt-db
            success "PostgreSQL 已启动"
        fi
    else
        if docker run -d \
            --name querygpt-db \
            -e POSTGRES_USER=postgres \
            -e POSTGRES_PASSWORD=postgres \
            -e POSTGRES_DB=querygpt \
            -p 5432:5432 \
            -v querygpt-pgdata:/var/lib/postgresql/data \
            postgres:16-alpine; then
            success "PostgreSQL 容器已创建并启动"
        else
            warn "PostgreSQL 容器创建失败，请手动配置数据库"
            return
        fi
    fi

    # 等待数据库就绪
    info "等待数据库就绪..."
    for i in {1..30}; do
        if docker exec querygpt-db pg_isready -U postgres &>/dev/null; then
            success "数据库已就绪"
            return
        fi
        sleep 1
    done
    warn "数据库启动超时，请检查 Docker 日志"
}

# 确保 aiosqlite 已安装
ensure_aiosqlite() {
    if ! "$SCRIPT_DIR/apps/api/.venv/bin/python" -c "import aiosqlite" 2>/dev/null; then
        info "安装 SQLite 驱动 aiosqlite..."
        "$SCRIPT_DIR/apps/api/.venv/bin/pip" install aiosqlite -q
    fi
}

# 切换为 SQLite 数据库
switch_to_sqlite() {
    local sqlite_url="sqlite+aiosqlite:///./data/querygpt.db"
    mkdir -p apps/api/data
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=${sqlite_url}|" apps/api/.env
    rm -f apps/api/.env.bak
    success "已切换为 SQLite: $sqlite_url"
    ensure_aiosqlite
}

# 检测数据库连通性，必要时自动回退 SQLite
check_database_connection() {
    local db_url
    db_url=$(grep "^DATABASE_URL=" apps/api/.env 2>/dev/null | cut -d= -f2-)

    if [ -z "$db_url" ]; then
        warn "未找到 DATABASE_URL 配置，跳过数据库连接检测"
        return 0
    fi

    # 已经是 SQLite，确保驱动已安装
    if [[ "$db_url" == sqlite* ]]; then
        ensure_aiosqlite
        return 0
    fi

    info "检测 PostgreSQL 连通性..."
    # 将 SQLAlchemy URL 格式转换为 asyncpg 可用格式
    local pg_url="${db_url/postgresql+asyncpg:\/\//postgresql:\/\/}"

    if "$SCRIPT_DIR/apps/api/.venv/bin/python" -c "
import asyncio, asyncpg
async def test():
    conn = await asyncpg.connect('${pg_url}', timeout=3)
    await conn.close()
asyncio.run(test())
" 2>/dev/null; then
        success "PostgreSQL 连接正常"
    else
        warn "PostgreSQL 不可达，自动切换为 SQLite..."
        switch_to_sqlite
    fi
}

# 等待后端就绪（健康检查轮询，最多 20 秒）
wait_for_backend() {
    info "等待后端就绪..."
    for i in $(seq 1 20); do
        if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
            echo ""
            success "后端已就绪 ✓"
            return 0
        fi
        sleep 1
        printf "."
    done
    echo ""
    error "后端启动失败！最后 20 行日志：\n$(tail -20 "$SCRIPT_DIR/logs/backend.log" 2>/dev/null || echo '无日志')"
}

# 等待前端就绪（轮询，最多 40 秒）
wait_for_frontend() {
    info "等待前端就绪..."
    for i in $(seq 1 40); do
        if curl -sf http://localhost:3000 > /dev/null 2>&1; then
            echo ""
            success "前端已就绪 ✓"
            return 0
        fi
        sleep 1
        printf "."
    done
    echo ""
    warn "前端启动超时，请手动访问 http://localhost:3000"
}

# 启动后端
start_backend() {
    info "启动后端服务..."

    cd "$SCRIPT_DIR/apps/api"
    activate_venv

    # 后台启动（显式使用 venv 内的 Python，避免解析到系统解释器）
    nohup "$SCRIPT_DIR/apps/api/.venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > "$SCRIPT_DIR/logs/backend.log" 2>&1 &
    echo $! > "$SCRIPT_DIR/.backend.pid"

    success "后端服务已启动 (PID: $(cat "$SCRIPT_DIR/.backend.pid"))"
    cd "$SCRIPT_DIR"
}

# 启动前端
start_frontend() {
    info "启动前端服务..."

    cd "$SCRIPT_DIR/apps/web"

    # 后台启动
    nohup $NPM_CMD run dev > "$SCRIPT_DIR/logs/frontend.log" 2>&1 &
    echo $! > "$SCRIPT_DIR/.frontend.pid"

    success "前端服务已启动 (PID: $(cat "$SCRIPT_DIR/.frontend.pid"))"
    cd "$SCRIPT_DIR"
}

# 停止所有服务
stop_services() {
    info "停止所有服务..."

    if [ -f ".backend.pid" ]; then
        kill $(cat .backend.pid) 2>/dev/null || true
        rm .backend.pid
        success "后端服务已停止"
    fi

    if [ -f ".frontend.pid" ]; then
        kill $(cat .frontend.pid) 2>/dev/null || true
        rm .frontend.pid
        success "前端服务已停止"
    fi

    # 停止可能的残留进程
    pkill -f "uvicorn app.main:app" 2>/dev/null || true
    pkill -f "next dev" 2>/dev/null || true
}

# 显示状态
show_status() {
    echo ""
    echo "=========================================="
    echo "  QueryGPT v2 启动完成!"
    echo "=========================================="
    echo ""
    echo "  🌐 前端:  http://localhost:3000"
    echo "  🔧 后端:  http://localhost:8000"
    echo "  📚 API 文档: http://localhost:8000/api/docs"
    echo ""
    echo "  📝 日志文件:"
    echo "     - 后端: logs/backend.log"
    echo "     - 前端: logs/frontend.log"
    echo ""
    echo "  🛑 停止服务: ./start.sh stop"
    echo "=========================================="
}

# 显示帮助
show_help() {
    echo "QueryGPT v2 启动脚本"
    echo ""
    echo "用法: ./start.sh [命令]"
    echo ""
    echo "命令:"
    echo "  (无参数)   启动所有服务"
    echo "  stop       停止所有服务"
    echo "  restart    重启所有服务"
    echo "  status     查看服务状态"
    echo "  logs       查看日志"
    echo "  db         仅启动数据库"
    echo "  backend    仅启动后端"
    echo "  frontend   仅启动前端"
    echo "  setup      仅安装依赖"
    echo "  help       显示此帮助"
}

# 查看日志
show_logs() {
    echo "=== 后端日志 (最后 20 行) ==="
    tail -20 logs/backend.log 2>/dev/null || echo "无日志"
    echo ""
    echo "=== 前端日志 (最后 20 行) ==="
    tail -20 logs/frontend.log 2>/dev/null || echo "无日志"
}

# 查看状态
check_status() {
    echo "服务状态:"

    if [ -f ".backend.pid" ] && kill -0 $(cat .backend.pid) 2>/dev/null; then
        echo "  ✅ 后端: 运行中 (PID: $(cat .backend.pid))"
    else
        echo "  ❌ 后端: 未运行"
    fi

    if [ -f ".frontend.pid" ] && kill -0 $(cat .frontend.pid) 2>/dev/null; then
        echo "  ✅ 前端: 运行中 (PID: $(cat .frontend.pid))"
    else
        echo "  ❌ 前端: 未运行"
    fi

    if check_command docker && docker ps --format '{{.Names}}' | grep -q "^querygpt-db$"; then
        echo "  ✅ 数据库: 运行中"
    else
        echo "  ❌ 数据库: 未运行"
    fi
}

# 判断环境是否已完成初始化
is_initialized() {
    [ -d "$SCRIPT_DIR/apps/api/.venv" ] &&
    [ -d "$SCRIPT_DIR/apps/web/node_modules" ] &&
    [ -f "$SCRIPT_DIR/apps/api/.env" ] &&
    [ -f "$SCRIPT_DIR/apps/web/.env.local" ]
}

# 二次启动时仅设置 NPM_CMD（start_frontend 需要）
set_run_commands() {
    if check_command pnpm; then
        NPM_CMD="pnpm"
    elif check_command npm; then
        NPM_CMD="npm"
    else
        error "找不到 npm/pnpm，请检查 Node.js 安装"
    fi
}

# 主函数
main() {
    # 创建日志目录
    mkdir -p logs

    case "${1:-}" in
        stop)
            stop_services
            ;;
        restart)
            stop_services
            sleep 2
            main
            ;;
        status)
            check_status
            ;;
        logs)
            show_logs
            ;;
        db)
            detect_os
            start_database
            ;;
        backend)
            detect_os
            check_dependencies
            setup_python_env
            setup_env_files
            check_database_connection
            start_backend
            wait_for_backend
            ;;
        frontend)
            detect_os
            check_dependencies
            setup_node_env
            setup_env_files
            start_frontend
            wait_for_frontend
            ;;
        setup)
            detect_os
            check_dependencies
            setup_python_env
            setup_node_env
            setup_env_files
            success "环境设置完成"
            ;;
        help|--help|-h)
            show_help
            ;;
        "")
            if is_initialized; then
                # 二次启动：跳过所有安装，直接启动
                info "环境已就绪，直接启动服务..."
                detect_os
                set_run_commands
                check_ports
                start_database
                check_database_connection
                start_backend
                wait_for_backend
                start_frontend
                wait_for_frontend
                show_status
                open_browser
            else
                # 首次启动：完整安装流程
                detect_os
                check_dependencies
                check_ports
                setup_python_env
                setup_node_env
                setup_env_files
                start_database
                check_database_connection
                start_backend
                wait_for_backend
                start_frontend
                wait_for_frontend
                show_status
                open_browser
            fi
            ;;
        *)
            error "未知命令: $1\n运行 './start.sh help' 查看帮助"
            ;;
    esac
}

main "$@"
