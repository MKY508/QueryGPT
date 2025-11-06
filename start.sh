#!/bin/bash

set -euo pipefail

VERSION="1.5"
VENV_DIR="venv_py310"
DEFAULT_PORT=${PORT:-5000}
APP_PID=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

info() { printf '\033[0;36mℹ %s\033[0m\n' "$1"; }
ok()   { printf '\033[0;32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$1"; }
err()  { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; }

banner() {
    printf '\033[0;36m╔══════════════════════════════╗\033[0m\n'
    printf '\033[0;36m║  QueryGPT Start  v%-6s      ║\033[0m\n' "$VERSION"
    printf '\033[0;36m╚══════════════════════════════╝\033[0m\n\n'
}

require_project_root() {
    if [ ! -f "backend/app.py" ]; then
        err "请在项目根目录执行 start.sh"
        exit 1
    fi
}

ensure_venv() {
    if [ ! -f "$VENV_DIR/bin/activate" ]; then
        err "未找到虚拟环境，请先运行 ./setup.sh"
        exit 1
    fi
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
    PYTHON_BIN="$VIRTUAL_ENV/bin/python"
    ok "虚拟环境已激活：$VIRTUAL_ENV"
}

ensure_env_files() {
    if [ ! -f ".env" ]; then
        err "缺少 .env 配置，请先运行 ./setup.sh"
        exit 1
    fi
    [ -f "config/models.json" ] || warn "未检测到 config/models.json，可在设置页面补全模型配置。"
}

find_free_port() {
    local candidate="$1"
    while true; do
        if "$PYTHON_BIN" - "$candidate" <<'PY' 2>/dev/null
import socket, sys
port = int(sys.argv[1])
with socket.socket() as s:
    sys.exit(0 if s.connect_ex(("127.0.0.1", port)) else 1)
PY
        then
            echo "$candidate"
            return
        fi
        candidate=$((candidate + 1))
        if [ "$candidate" -gt 5100 ]; then
            break
        fi
    done
    echo $((RANDOM % 10000 + 20000))
}

wait_for_ready() {
    local attempts=0
    local max_attempts=5  # 减少等待时间，最多等待5秒
    printf '等待后端服务启动'
    while [ $attempts -lt $max_attempts ]; do
        if "$PYTHON_BIN" - "$PORT" <<'PY' 2>/dev/null
import socket, sys
port = int(sys.argv[1])
with socket.socket() as s:
    s.settimeout(0.2)  # 减少超时时间
    try:
        s.connect(("127.0.0.1", port))
    except OSError:
        sys.exit(1)
sys.exit(0)
PY
        then
            printf '\n'
            ok "后端服务已启动"
            return 0
        fi
        sleep 0.5  # 减少等待间隔
        printf '.'
        attempts=$((attempts + 1))
    done
    printf '\n'
    warn "后端服务仍在启动中，稍候请手动访问 http://localhost:${PORT}"
    return 1
}

open_browser() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "http://localhost:${PORT}" >/dev/null 2>&1 || true
    fi
}

start_service() {
    export PORT="$(find_free_port "$DEFAULT_PORT")"
    info "服务端口：$PORT"
    info "访问地址：http://localhost:$PORT"
    warn "按 Ctrl+C 停止服务"
    info "首次启动可能需要约 10-20 秒完成初始化，请耐心等待后端就绪。"

    ( cd backend && "$PYTHON_BIN" app.py ) &
    APP_PID=$!

    # 快速检查端口是否就绪，然后立即打开浏览器
    # 后端会在首次请求时完成初始化，不会阻塞启动
    if wait_for_ready; then
        open_browser
    else
        warn "已跳过自动打开浏览器，可稍后手动访问：http://localhost:${PORT}"
    fi
    
    local status=0
    wait "$APP_PID" || status=$?
    return $status
}

main() {
    banner
    require_project_root
    ensure_venv
    ensure_env_files
    unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
    start_service
}

cleanup() {
    if [ -n "${APP_PID:-}" ] && kill -0 "$APP_PID" >/dev/null 2>&1; then
        kill "$APP_PID" >/dev/null 2>&1 || true
        wait "$APP_PID" >/dev/null 2>&1 || true
    fi
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

main "$@"

