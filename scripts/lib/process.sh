port_probe_supported() {
  check_command lsof
}

pid_file_value() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    tr -d '[:space:]' < "$pid_file"
  fi
}

pid_is_running_pid() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

pid_is_running() {
  local pid_file="$1"
  local pid
  pid="$(pid_file_value "$pid_file")"
  pid_is_running_pid "$pid"
}

remove_stale_pid_file() {
  local pid_file="$1"
  local pid
  pid="$(pid_file_value "$pid_file")"
  if [ -n "$pid" ] && ! pid_is_running_pid "$pid"; then
    rm -f "$pid_file"
  fi
}

port_pid() {
  local port="$1"
  if port_probe_supported; then
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

service_matches_args() {
  local service="$1"
  local args="$2"
  case "$service" in
    frontend)
      [[ "$args" == *"$WEB_DIR"* ]] ||
        [[ "$args" == *"next dev"* ]] ||
        [[ "$args" == *"next-server"* ]] ||
        [[ "$args" == *"npm run dev"* ]] ||
        [[ "$args" == *"pnpm run dev"* ]]
      ;;
    backend)
      [[ "$args" == *"$API_DIR"* ]] || [[ "$args" == *"uvicorn app.main:app"* ]]
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_project_process() {
  local occupied_pid="$1"
  local service="$2"
  local current_pid="$occupied_pid"
  local matched_pid=""

  for _ in 1 2 3; do
    [ -n "$current_pid" ] || break
    local args
    args="$(process_args "$current_pid")"

    if [ -n "$args" ] && service_matches_args "$service" "$args"; then
      matched_pid="$current_pid"
    fi

    current_pid="$(process_ppid "$current_pid")"
  done

  if [ -n "$matched_pid" ]; then
    echo "$matched_pid"
  fi
  return 0
}

pid_file_state() {
  local pid_file="$1"
  local service="$2"
  local pid
  pid="$(pid_file_value "$pid_file")"

  if [ -z "$pid" ]; then
    echo "missing"
    return 0
  fi

  if ! pid_is_running_pid "$pid"; then
    echo "stale"
    return 0
  fi

  if [ -n "$(resolve_project_process "$pid" "$service")" ]; then
    echo "active"
  else
    echo "foreign"
  fi
}

service_listener_owner() {
  local port="$1"
  local service="$2"

  if ! port_probe_supported; then
    echo "unavailable"
    return 0
  fi

  local listener_pid
  listener_pid="$(port_pid "$port")"
  if [ -z "$listener_pid" ]; then
    echo "none"
    return 0
  fi

  if [ -n "$(resolve_project_process "$listener_pid" "$service")" ]; then
    echo "querygpt"
  else
    echo "external"
  fi
}

summarize_process_args() {
  local pid="$1"
  summarize_command "$(process_args "$pid")"
}

stop_pid_file() {
  local pid_file="$1"
  local name="$2"
  local service="$3"
  local pid
  pid="$(pid_file_value "$pid_file")"

  if [ -z "$pid" ]; then
    rm -f "$pid_file"
    return 0
  fi

  if ! pid_is_running_pid "$pid"; then
    rm -f "$pid_file"
    return 0
  fi

  local owned_pid
  owned_pid="$(resolve_project_process "$pid" "$service")"
  if [ -z "$owned_pid" ]; then
    warn "$name 的 PID 文件指向非项目进程 (PID: $pid)，仅移除 PID 文件"
    rm -f "$pid_file"
    return 0
  fi

  kill "$owned_pid" >/dev/null 2>&1 || true
  rm -f "$pid_file"
  success "$name 已停止 (PID: $owned_pid)"
}

ensure_project_port_available() {
  local port="$1"
  local pid_file="$2"
  local name="$3"
  local service="$4"
  local pid=""

  remove_stale_pid_file "$pid_file"

  if pid_is_running "$pid_file"; then
    pid="$(pid_file_value "$pid_file")"
  fi

  if ! port_probe_supported; then
    warn "未检测到 lsof，跳过 $name 端口占用检查"
    return 0
  fi

  local occupied
  occupied="$(port_pid "$port")"
  if [ -z "$occupied" ]; then
    return 0
  fi

  if [ -n "$pid" ] && [ "$occupied" = "$pid" ]; then
    warn "$name 端口 $port 已被上次的项目进程占用，先停止旧进程"
    stop_pid_file "$pid_file" "$name" "$service"
    sleep 1
    return 0
  fi

  local owned_pid
  owned_pid="$(resolve_project_process "$occupied" "$service")"
  if [ -n "$owned_pid" ]; then
    warn "$name 端口 $port 被残留的项目进程占用，先停止旧进程 (PID: $owned_pid)"
    kill "$owned_pid" >/dev/null 2>&1 || true
    rm -f "$pid_file"
    sleep 1
    occupied="$(port_pid "$port")"
    [ -z "$occupied" ] && return 0
  fi

  error "$name 需要端口 ${port}，但当前被外部进程占用 (PID: $occupied, 命令: $(summarize_process_args "$occupied")).请先释放该端口。"
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

  if ! port_probe_supported; then
    return 0
  fi

  local occupied
  occupied="$(port_pid "$port")"
  [ -n "$occupied" ] || return 0

  local owned_pid
  owned_pid="$(resolve_project_process "$occupied" "$service")"
  [ -n "$owned_pid" ] || return 0

  kill "$owned_pid" >/dev/null 2>&1 || true
  sleep 1
  success "$name 端口进程已停止 (PID: $owned_pid)"
}

cleanup_service_state() {
  local port="$1"
  local pid_file="$2"
  local name="$3"
  local service="$4"
  stop_project_port_process "$port" "$name" "$service"
  stop_pid_file "$pid_file" "$name" "$service"
  remove_stale_pid_file "$pid_file"
}
