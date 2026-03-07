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

ensure_aiosqlite() {
  local py
  py="$(venv_python)"
  if ! "$py" -c "import aiosqlite" >/dev/null 2>&1; then
    info "补装 aiosqlite..."
    "$(venv_pip)" install aiosqlite >/dev/null
  fi
}
