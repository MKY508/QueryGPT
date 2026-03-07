#!/usr/bin/env bash
# QueryGPT 单工作区启动脚本
set -euo pipefail

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
BACKEND_HOST="${QUERYGPT_BACKEND_HOST:-127.0.0.1}"
BACKEND_RELOAD="${QUERYGPT_BACKEND_RELOAD:-0}"
NO_BROWSER="${QUERYGPT_NO_BROWSER:-0}"

mkdir -p "$LOG_DIR"
cd "$SCRIPT_DIR"

source "$SCRIPT_DIR/scripts/lib/common.sh"
source "$SCRIPT_DIR/scripts/lib/env.sh"
source "$SCRIPT_DIR/scripts/lib/python.sh"
source "$SCRIPT_DIR/scripts/lib/process.sh"
source "$SCRIPT_DIR/scripts/lib/service.sh"
source "$SCRIPT_DIR/scripts/lib/doctor.sh"
source "$SCRIPT_DIR/scripts/lib/test.sh"

main() {
  detect_os

  case "${1:-}" in
    setup)
      setup_workspace
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
    cleanup)
      cleanup_services
      ;;
    restart)
      restart_services
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
    test)
      run_test_target "${2:-all}"
      ;;
    db)
      start_database
      ;;
    help|--help|-h)
      show_help
      ;;
    "")
      start_default_services
      ;;
    *)
      error "未知命令: $1"
      ;;
  esac
}

main "$@"
