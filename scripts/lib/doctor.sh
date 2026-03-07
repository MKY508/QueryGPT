show_status_banner() {
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

print_service_status() {
  local name="$1"
  local port="$2"
  local pid_file="$3"
  local service="$4"
  local pid_state
  local pid_value
  local listener_pid
  local listener_owner
  local command_pid
  local command_summary

  pid_state="$(pid_file_state "$pid_file" "$service")"
  pid_value="$(pid_file_value "$pid_file")"
  listener_pid="$(port_pid "$port")"
  listener_owner="$(service_listener_owner "$port" "$service")"

  command_pid="$listener_pid"
  if [ -z "$command_pid" ] && [ -n "$pid_value" ] && pid_is_running_pid "$pid_value"; then
    command_pid="$pid_value"
  fi
  if [ -n "$command_pid" ]; then
    command_summary="$(summarize_process_args "$command_pid")"
  else
    command_summary="-"
  fi

  echo "$name:"
  if [ -n "$pid_value" ]; then
    echo "  pid 文件: $pid_file -> $pid_value ($pid_state)"
  else
    echo "  pid 文件: $pid_file -> 未记录 ($pid_state)"
  fi

  case "$listener_owner" in
    querygpt)
      echo "  监听端口: $port -> PID ${listener_pid:-unknown} (querygpt)"
      ;;
    external)
      echo "  监听端口: $port -> PID ${listener_pid:-unknown} (external)"
      ;;
    unavailable)
      echo "  监听端口: $port -> 不可检测 (缺少 lsof)"
      ;;
    *)
      echo "  监听端口: $port -> 未监听"
      ;;
  esac

  echo "  命令: $command_summary"
}

show_runtime_status() {
  print_service_status "后端" 8000 "$BACKEND_PID_FILE" "backend"
  echo
  print_service_status "前端" 3000 "$FRONTEND_PID_FILE" "frontend"
}

show_doctor() {
  detect_os
  ensure_python_selected
  ensure_node_selected

  echo "系统: $OS"
  echo "系统 Python: $PYTHON_CMD ($(selected_python_version))"
  if [ -x "$(venv_python)" ]; then
    echo "后端运行 Python: $(venv_python) ($(venv_python_version))"
  else
    echo "后端运行 Python: 未创建 .venv"
  fi
  echo "Node: $(node --version 2>&1)"
  echo "包管理器: $NPM_CMD"
  echo "Node 指纹基准: $(basename "$(node_lock_file)")"
  echo "后端虚拟环境: $([ -d "$API_DIR/.venv" ] && echo 已创建 || echo 未创建)"
  echo "前端 node_modules: $([ -d "$WEB_DIR/node_modules" ] && echo 已安装 || echo 未安装)"
  echo "端口探测: $([ "$(port_probe_supported && echo yes || echo no)" = "yes" ] && echo lsof || echo 不可用)"
  echo
  show_runtime_status

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

show_help() {
  cat <<HELP
QueryGPT 单工作区启动脚本

用法:
  ./start.sh                 快启动，按依赖指纹跳过重复安装
  ./start.sh setup           初始化基础依赖
  ./start.sh install analytics  安装高级分析扩展
  ./start.sh install dev     安装开发依赖
  ./start.sh backend         仅启动后端
  ./start.sh frontend        仅启动前端
  ./start.sh stop            停止当前项目服务
  ./start.sh cleanup         清理 stale PID 和残留项目端口进程
  ./start.sh restart         重启服务
  ./start.sh status          查看运行状态
  ./start.sh logs            查看日志
  ./start.sh doctor          输出环境与能力诊断
  ./start.sh test [backend|frontend|all]
  ./start.sh db              启动 PostgreSQL 容器（可选）

环境变量:
  QUERYGPT_BACKEND_HOST=0.0.0.0
  QUERYGPT_BACKEND_RELOAD=1
  QUERYGPT_NO_BROWSER=1
HELP
}
