#!/usr/bin/env bash
# QueryGPT 单工作区启动脚本
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$SCRIPT_DIR/apps/api"
WEB_DIR="$SCRIPT_DIR/apps/web"
LOG_DIR="$SCRIPT_DIR/logs"
BACKEND_PID_FILE="$SCRIPT_DIR/.backend.pid"
FRONTEND_PID_FILE="$SCRIPT_DIR/.frontend.pid"
PYTHON_CORE_FINGERPRINT="$API_DIR/.venv/.core.fingerprint"
PYTHON_ANALYTICS_FINGERPRINT="$API_DIR/.venv/.analytics.fingerprint"
PYTHON_DEV_FINGERPRINT="$API_DIR/.venv/.dev.fingerprint"
NODE_FINGERPRINT="$WEB_DIR/node_modules/.fingerprint"
mkdir -p "$LOG_DIR"

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

OS="unknown"
PYTHON_CMD=""
NPM_CMD=""
BACKEND_HOST="${QUERYGPT_BACKEND_HOST:-127.0.0.1}"
BACKEND_RELOAD="${QUERYGPT_BACKEND_RELOAD:-0}"
NO_BROWSER="${QUERYGPT_NO_BROWSER:-0}"

cd "$SCRIPT_DIR"

detect_os() {
  case "$(uname -s)" in
    Darwin*) OS="macos" ;;
    Linux*)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        OS="wsl"
      else
        OS="linux"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
  esac
}

check_command() {
  command -v "$1" >/dev/null 2>&1
}

checksum_file() {
  local file="$1"
  if check_command shasum; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif check_command sha256sum; then
    sha256sum "$file" | awk '{print $1}'
  else
    cksum "$file" | awk '{print $1}'
  fi
}

find_python() {
  for candidate in python3.11 python3.12 python3.13 python3 python; do
    if check_command "$candidate"; then
      if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
        PYTHON_CMD="$candidate"
        return 0
      fi
    fi
  done
  return 1
}

set_node_command() {
  if check_command pnpm; then
    NPM_CMD="pnpm"
  elif check_command npm; then
    NPM_CMD="npm"
  else
    error "找不到 npm 或 pnpm"
  fi
}

venv_python() {
  if [ "$OS" = "windows" ]; then
    echo "$API_DIR/.venv/Scripts/python"
  else
    echo "$API_DIR/.venv/bin/python"
  fi
}

venv_pip() {
  if [ "$OS" = "windows" ]; then
    echo "$API_DIR/.venv/Scripts/pip"
  else
    echo "$API_DIR/.venv/bin/pip"
  fi
}

python_profile_fingerprint() {
  local profile="$1"
  local version
  version="$($PYTHON_CMD --version 2>&1)"
  echo "$profile|$version|$(checksum_file "$API_DIR/pyproject.toml")"
}

node_fingerprint() {
  echo "$(node --version)|$NPM_CMD|$(checksum_file "$WEB_DIR/package-lock.json")"
}

ensure_python_selected() {
  if [ -z "$PYTHON_CMD" ]; then
    find_python || error "需要 Python 3.11 或更高版本"
    info "使用 Python: $PYTHON_CMD ($($PYTHON_CMD --version 2>&1))"
  fi
}

ensure_node_selected() {
  if [ -z "$NPM_CMD" ]; then
    set_node_command
    info "使用 Node: $(node --version 2>&1) / $NPM_CMD"
  fi
}

create_venv_if_needed() {
  ensure_python_selected
  if [ ! -d "$API_DIR/.venv" ]; then
    info "创建 Python 虚拟环境..."
    (cd "$API_DIR" && "$PYTHON_CMD" -m venv .venv)
  fi
}

install_python_profile() {
  local profile="$1"
  local fingerprint_file="$2"
  local install_target="$3"
  local force="${4:-0}"

  create_venv_if_needed
  local expected_fingerprint
  expected_fingerprint="$(python_profile_fingerprint "$profile")"

  if [ "$force" != "1" ] && [ -f "$fingerprint_file" ] && [ "$(cat "$fingerprint_file")" = "$expected_fingerprint" ]; then
    info "Python $profile 依赖未变化，跳过安装"
    return 0
  fi

  info "安装 Python $profile 依赖..."
  (cd "$API_DIR" && "$(venv_pip)" install -e "$install_target")
  mkdir -p "$(dirname "$fingerprint_file")"
  echo "$expected_fingerprint" > "$fingerprint_file"
  success "Python $profile 依赖已就绪"
}

setup_python_core() {
  install_python_profile "core" "$PYTHON_CORE_FINGERPRINT" "." "${1:-0}"
}

install_python_analytics() {
  install_python_profile "analytics" "$PYTHON_ANALYTICS_FINGERPRINT" ".[analytics]" "${1:-0}"
}

install_python_dev() {
  install_python_profile "dev" "$PYTHON_DEV_FINGERPRINT" ".[dev]" "${1:-0}"
}

setup_node_env() {
  ensure_node_selected
  local expected_fingerprint
  expected_fingerprint="$(node_fingerprint)"

  if [ -d "$WEB_DIR/node_modules" ] && [ -f "$NODE_FINGERPRINT" ] && [ "$(cat "$NODE_FINGERPRINT")" = "$expected_fingerprint" ]; then
    info "前端依赖未变化，跳过安装"
    return 0
  fi

  info "安装前端依赖..."
  (cd "$WEB_DIR" && "$NPM_CMD" install)
  mkdir -p "$(dirname "$NODE_FINGERPRINT")"
  echo "$expected_fingerprint" > "$NODE_FINGERPRINT"
  success "前端依赖已就绪"
}

setup_env_files() {
  if [ ! -f "$API_DIR/.env" ] && [ -f "$API_DIR/.env.example" ]; then
    cp "$API_DIR/.env.example" "$API_DIR/.env"
    warn "已创建 apps/api/.env，请按需修改"
  fi

  if [ ! -f "$WEB_DIR/.env.local" ]; then
    echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > "$WEB_DIR/.env.local"
    success "已创建 apps/web/.env.local"
  fi
}

pid_is_running() {
  local pid_file="$1"
  [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" >/dev/null 2>&1
}

remove_stale_pid_file() {
  local pid_file="$1"
  if [ -f "$pid_file" ] && ! pid_is_running "$pid_file"; then
    rm -f "$pid_file"
  fi
}

stop_pid_file() {
  local pid_file="$1"
  local name="$2"
  if pid_is_running "$pid_file"; then
    kill "$(cat "$pid_file")" >/dev/null 2>&1 || true
    rm -f "$pid_file"
    success "$name 已停止"
  elif [ -f "$pid_file" ]; then
    rm -f "$pid_file"
  fi
}

port_pid() {
  local port="$1"
  if check_command lsof; then
    lsof -ti :"$port" 2>/dev/null | head -n 1
  fi
  return 0
}

process_args() {
  local pid="$1"
  ps -o args= -p "$pid" 2>/dev/null | sed 's/^[[:space:]]*//'
  return 0
}

process_ppid() {
  local pid="$1"
  ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]'
  return 0
}

resolve_project_process_for_port() {
  local occupied_pid="$1"
  local service="$2"
  local current_pid="$occupied_pid"
  local matched_pid=""

  for _ in 1 2 3; do
    [ -n "$current_pid" ] || break
    local args
    args="$(process_args "$current_pid")"

    case "$service" in
      frontend)
        if [[ "$args" == *"$WEB_DIR"* ]] || [[ "$args" == *"next dev"* ]] || [[ "$args" == next-server* ]]; then
          matched_pid="$current_pid"
        fi
        ;;
      backend)
        if [[ "$args" == *"$API_DIR"* ]] || [[ "$args" == *"uvicorn app.main:app"* ]]; then
          matched_pid="$current_pid"
        fi
        ;;
    esac

    current_pid="$(process_ppid "$current_pid")"
  done

  if [ -n "$matched_pid" ]; then
    echo "$matched_pid"
  fi
  return 0
}

ensure_project_port_available() {
  local port="$1"
  local pid_file="$2"
  local name="$3"
  local service="$4"
  local pid=""

  remove_stale_pid_file "$pid_file"

  if pid_is_running "$pid_file"; then
    pid="$(cat "$pid_file")"
  fi

  local occupied
  occupied="$(port_pid "$port")"
  if [ -z "$occupied" ]; then
    return 0
  fi

  if [ -n "$pid" ] && [ "$occupied" = "$pid" ]; then
    warn "$name 端口 $port 已被上次的项目进程占用，先停止旧进程"
    stop_pid_file "$pid_file" "$name"
    sleep 1
    return 0
  fi

  local owned_pid
  owned_pid="$(resolve_project_process_for_port "$occupied" "$service")"
  if [ -n "$owned_pid" ]; then
    warn "$name 端口 $port 被残留的项目进程占用，先停止旧进程 (PID: $owned_pid)"
    kill "$owned_pid" >/dev/null 2>&1 || true
    rm -f "$pid_file"
    sleep 1
    occupied="$(port_pid "$port")"
    [ -z "$occupied" ] && return 0
  fi

  error "$name 需要端口 ${port}，但当前被外部进程占用 (PID: $occupied)。请先释放该端口。"
}

record_listener_pid() {
  local port="$1"
  local pid_file="$2"
  local name="$3"
  local listener_pid
  listener_pid="$(port_pid "$port")"
  if [ -n "$listener_pid" ]; then
    echo "$listener_pid" > "$pid_file"
    info "$name 监听进程 PID: $listener_pid"
  fi
}

stop_project_port_process() {
  local port="$1"
  local name="$2"
  local service="$3"
  local occupied
  occupied="$(port_pid "$port")"
  [ -n "$occupied" ] || return 0

  local owned_pid
  owned_pid="$(resolve_project_process_for_port "$occupied" "$service")"
  [ -n "$owned_pid" ] || return 0

  kill "$owned_pid" >/dev/null 2>&1 || true
  sleep 1
  success "$name 端口进程已停止 (PID: $owned_pid)"
}

start_database() {
  if ! check_command docker; then
    warn "Docker 未安装，跳过数据库容器启动"
    return 0
  fi

  if ! docker info >/dev/null 2>&1; then
    warn "Docker daemon 未运行，跳过数据库容器启动"
    return 0
  fi

  if docker ps --format '{{.Names}}' | grep -q '^querygpt-db$'; then
    success "PostgreSQL 容器已运行"
    return 0
  fi

  if docker ps -a --format '{{.Names}}' | grep -q '^querygpt-db$'; then
    info "启动已有 PostgreSQL 容器..."
    docker start querygpt-db >/dev/null
    success "PostgreSQL 容器已启动"
    return 0
  fi

  info "创建 PostgreSQL 容器..."
  docker run -d \
    --name querygpt-db \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=querygpt \
    -p 5432:5432 \
    -v querygpt-pgdata:/var/lib/postgresql/data \
    postgres:16-alpine >/dev/null
  success "PostgreSQL 容器已创建"
}

ensure_aiosqlite() {
  local py
  py="$(venv_python)"
  if ! "$py" -c "import aiosqlite" >/dev/null 2>&1; then
    info "补装 aiosqlite..."
    "$(venv_pip)" install aiosqlite >/dev/null
  fi
}

switch_to_sqlite() {
  local sqlite_url="sqlite+aiosqlite:///./data/querygpt.db"
  mkdir -p "$API_DIR/data"
  if [ -f "$API_DIR/.env" ]; then
    if grep -q '^DATABASE_URL=' "$API_DIR/.env"; then
      perl -0pi -e "s|^DATABASE_URL=.*$|DATABASE_URL=${sqlite_url}|m" "$API_DIR/.env"
    else
      printf '\nDATABASE_URL=%s\n' "$sqlite_url" >> "$API_DIR/.env"
    fi
  else
    printf 'DATABASE_URL=%s\n' "$sqlite_url" > "$API_DIR/.env"
  fi
  ensure_aiosqlite
  warn "数据库不可达，已切换到 SQLite: $sqlite_url"
}

reset_legacy_sqlite_if_needed() {
  [ -f "$API_DIR/.env" ] || return 0
  local db_url
  db_url="$(grep '^DATABASE_URL=' "$API_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
  [[ "$db_url" == sqlite* ]] || return 0

  local db_path="${db_url#sqlite+aiosqlite:///}"
  if [[ "$db_path" != /* ]]; then
    db_path="$API_DIR/${db_path#./}"
  fi
  [ -f "$db_path" ] || return 0

  if DB_PATH="$db_path" "$PYTHON_CMD" - <<'PY' >/dev/null 2>&1
import os
import sqlite3

db_path = os.environ["DB_PATH"]
conn = sqlite3.connect(db_path)
try:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).fetchone()
    raise SystemExit(0 if row else 1)
finally:
    conn.close()
PY
  then
    local backup_path="${db_path}.legacy.$(date +%Y%m%d%H%M%S).bak"
    mv "$db_path" "$backup_path"
    warn "检测到旧版多用户 SQLite 结构，已备份到 ${backup_path}，并准备重建单工作区数据库。"
  fi
}

check_database_connection() {
  [ -f "$API_DIR/.env" ] || return 0
  local db_url
  db_url="$(grep '^DATABASE_URL=' "$API_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
  [ -n "$db_url" ] || return 0

  if [[ "$db_url" == sqlite* ]]; then
    ensure_aiosqlite
    return 0
  fi

  local pg_url="${db_url/postgresql+asyncpg:\/\//postgresql://}"
  if PG_URL="$pg_url" "$(venv_python)" - <<'PY' >/dev/null 2>&1
import asyncio
import os
import asyncpg

async def main():
    conn = await asyncpg.connect(os.environ["PG_URL"], timeout=3)
    await conn.close()

asyncio.run(main())
PY
  then
    success "PostgreSQL 连接正常"
  else
    switch_to_sqlite
  fi
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local attempts="$3"
  for _ in $(seq 1 "$attempts"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      success "$name 已就绪"
      return 0
    fi
    sleep 1
  done
  return 1
}

start_backend() {
  ensure_project_port_available 8000 "$BACKEND_PID_FILE" "后端" "backend"
  setup_python_core
  setup_env_files
  reset_legacy_sqlite_if_needed
  check_database_connection

  local py
  py="$(venv_python)"
  info "启动后端服务..."
  if [ "$BACKEND_RELOAD" = "1" ]; then
    (cd "$API_DIR" && nohup "$py" -m uvicorn app.main:app --host "$BACKEND_HOST" --port 8000 --reload > "$LOG_DIR/backend.log" 2>&1 & echo $! > "$BACKEND_PID_FILE")
  else
    (cd "$API_DIR" && nohup "$py" -m uvicorn app.main:app --host "$BACKEND_HOST" --port 8000 > "$LOG_DIR/backend.log" 2>&1 & echo $! > "$BACKEND_PID_FILE")
  fi
  success "后端已启动 (PID: $(cat "$BACKEND_PID_FILE"))"
  wait_for_http "http://localhost:8000/health" "后端" 20 || error "后端启动失败，查看 logs/backend.log"
  record_listener_pid 8000 "$BACKEND_PID_FILE" "后端"
}

start_frontend() {
  ensure_project_port_available 3000 "$FRONTEND_PID_FILE" "前端" "frontend"
  setup_node_env
  setup_env_files

  info "启动前端服务..."
  (cd "$WEB_DIR" && nohup "$NPM_CMD" run dev > "$LOG_DIR/frontend.log" 2>&1 & echo $! > "$FRONTEND_PID_FILE")
  success "前端已启动 (PID: $(cat "$FRONTEND_PID_FILE"))"
  if ! wait_for_http "http://localhost:3000" "前端" 40; then
    warn "前端启动超时，请查看 logs/frontend.log"
  else
    record_listener_pid 3000 "$FRONTEND_PID_FILE" "前端"
  fi
}

open_browser() {
  [ "$NO_BROWSER" = "1" ] && return 0
  local url="http://localhost:3000"
  case "$OS" in
    macos) open "$url" >/dev/null 2>&1 || true ;;
    linux) xdg-open "$url" >/dev/null 2>&1 || true ;;
    wsl) cmd.exe /c start "$url" >/dev/null 2>&1 || true ;;
    windows) start "$url" >/dev/null 2>&1 || true ;;
  esac
}

show_status() {
  echo
  echo "=========================================="
  echo "  QueryGPT 启动完成"
  echo "=========================================="
  echo "  前端:  http://localhost:3000"
  echo "  后端:  http://localhost:8000"
  echo "  文档:  http://localhost:8000/api/docs"
  echo "  后端日志: logs/backend.log"
  echo "  前端日志: logs/frontend.log"
  echo "=========================================="
}

show_logs() {
  echo "=== 后端日志 ==="
  tail -20 "$LOG_DIR/backend.log" 2>/dev/null || echo "无日志"
  echo
  echo "=== 前端日志 ==="
  tail -20 "$LOG_DIR/frontend.log" 2>/dev/null || echo "无日志"
}

show_doctor() {
  detect_os
  ensure_python_selected
  ensure_node_selected
  echo "系统: $OS"
  echo "Python: $($PYTHON_CMD --version 2>&1)"
  echo "Node: $(node --version 2>&1)"
  echo "包管理器: $NPM_CMD"
  echo "后端虚拟环境: $([ -d "$API_DIR/.venv" ] && echo 已创建 || echo 未创建)"
  echo "前端 node_modules: $([ -d "$WEB_DIR/node_modules" ] && echo 已安装 || echo 未安装)"
  echo "后端端口 8000: $(port_pid 8000 || true)"
  echo "前端端口 3000: $(port_pid 3000 || true)"

  if [ -x "$(venv_python)" ]; then
    echo
    echo "系统能力:"
    (cd "$API_DIR" && "$(venv_python)" - <<'PY'
from app.services.app_settings import detect_system_capabilities
print(detect_system_capabilities(None).model_dump_json(indent=2))
PY
    ) || true
  fi
}

stop_services() {
  stop_project_port_process 8000 "后端" "backend"
  stop_project_port_process 3000 "前端" "frontend"
  stop_pid_file "$BACKEND_PID_FILE" "后端"
  stop_pid_file "$FRONTEND_PID_FILE" "前端"
}

show_help() {
  cat <<HELP
QueryGPT 单工作区启动脚本

用法:
  ./start.sh                 快启动，按依赖指纹跳过重复安装
  ./start.sh setup          初始化基础依赖
  ./start.sh install analytics  安装高级分析扩展
  ./start.sh install dev    安装开发依赖
  ./start.sh backend        仅启动后端
  ./start.sh frontend       仅启动前端
  ./start.sh stop           停止当前项目服务
  ./start.sh restart        重启服务
  ./start.sh status         查看运行状态
  ./start.sh logs           查看日志
  ./start.sh doctor         输出环境与能力诊断
  ./start.sh db             启动 PostgreSQL 容器（可选）

环境变量:
  QUERYGPT_BACKEND_HOST=0.0.0.0
  QUERYGPT_BACKEND_RELOAD=1
  QUERYGPT_NO_BROWSER=1
HELP
}

show_runtime_status() {
  local backend_pid frontend_pid
  backend_pid="$(port_pid 8000)"
  frontend_pid="$(port_pid 3000)"
  echo "后端: $([ -n "$backend_pid" ] && echo "运行中 (PID: $backend_pid)" || echo 未运行)"
  echo "前端: $([ -n "$frontend_pid" ] && echo "运行中 (PID: $frontend_pid)" || echo 未运行)"
}

main() {
  detect_os

  case "${1:-}" in
    setup)
      setup_python_core
      setup_node_env
      setup_env_files
      ;;
    install)
      case "${2:-}" in
        analytics)
          setup_python_core
          install_python_analytics
          ;;
        dev)
          setup_python_core
          install_python_dev
          ;;
        *)
          error "未知安装目标: ${2:-<empty>}"
          ;;
      esac
      ;;
    backend)
      start_backend
      ;;
    frontend)
      start_frontend
      ;;
    stop)
      stop_services
      ;;
    restart)
      stop_services
      start_backend
      start_frontend
      show_status
      open_browser
      ;;
    status)
      show_runtime_status
      ;;
    logs)
      show_logs
      ;;
    doctor)
      show_doctor
      ;;
    db)
      start_database
      ;;
    help|--help|-h)
      show_help
      ;;
    "")
      setup_python_core
      setup_node_env
      setup_env_files
      reset_legacy_sqlite_if_needed
      start_database
      start_backend
      start_frontend
      show_status
      open_browser
      ;;
    *)
      error "未知命令: $1"
      ;;
  esac
}

main "$@"
