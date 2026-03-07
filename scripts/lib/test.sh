require_backend_test_env() {
  if [ ! -x "$API_DIR/run-tests.sh" ]; then
    error "找不到后端测试入口: apps/api/run-tests.sh"
  fi
}

run_backend_tests() {
  require_backend_test_env
  (cd "$API_DIR" && ./run-tests.sh)
}

require_frontend_test_env() {
  ensure_node_selected
  if [ ! -d "$WEB_DIR/node_modules" ]; then
    error "前端依赖未安装，请先运行 ./start.sh setup"
  fi
}

run_frontend_tests() {
  require_frontend_test_env
  (cd "$WEB_DIR" && "$NPM_CMD" run type-check)
  (cd "$WEB_DIR" && "$NPM_CMD" test)
}

run_test_target() {
  local target="${1:-all}"
  case "$target" in
    backend)
      run_backend_tests
      ;;
    frontend)
      run_frontend_tests
      ;;
    all|"")
      run_backend_tests
      run_frontend_tests
      ;;
    *)
      error "未知测试目标: $target"
      ;;
  esac
}
