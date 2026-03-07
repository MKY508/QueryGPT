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

setup_workspace() {
  setup_python_core
  setup_node_env
  setup_env_files
}

stop_services() {
  cleanup_service_state 8000 "$BACKEND_PID_FILE" "后端" "backend"
  cleanup_service_state 3000 "$FRONTEND_PID_FILE" "前端" "frontend"
}

cleanup_services() {
  stop_services
}

restart_services() {
  stop_services
  start_backend
  start_frontend
  show_status_banner
  open_browser
}

start_default_services() {
  setup_workspace
  reset_legacy_sqlite_if_needed
  start_database
  start_backend
  start_frontend
  show_status_banner
  open_browser
}
