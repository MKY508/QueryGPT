create_venv_if_needed() {
  ensure_python_selected
  command -v uv >/dev/null 2>&1 || error "需要 uv 来安装锁定依赖，安装说明见 docs/DEVELOPMENT.md"
  if [ ! -d "$API_DIR/.venv" ] || [ ! -x "$(venv_python)" ]; then
    info "创建 Python 虚拟环境..."
    (cd "$API_DIR" && uv venv .venv --python "$PYTHON_CMD")
  fi
}

install_python_profile() {
  local profile="$1"
  local fingerprint_file="$2"
  local force="${3:-0}"

  create_venv_if_needed
  local expected_fingerprint
  expected_fingerprint="$(python_profile_fingerprint "$profile")"

  if [ "$force" != "1" ] && [ -f "$fingerprint_file" ] && [ "$(cat "$fingerprint_file")" = "$expected_fingerprint" ]; then
    info "Python $profile 依赖未变化，跳过安装"
    return 0
  fi

  info "安装 Python $profile 锁定依赖..."
  # Positional arguments also work with nounset on macOS's Bash 3.2, where an
  # empty array expansion can otherwise be treated as an unbound variable.
  set --
  case "$profile" in
    core) ;;
    analytics|dev) set -- --extra "$profile" ;;
    *) error "未知 Python 依赖配置: $profile" ;;
  esac
  local requirements_file
  requirements_file="$(mktemp "${TMPDIR:-/tmp}/receiptbi-requirements.XXXXXX")" || return 1
  # Install, not sync: preserve user-added analysis packages and other enabled
  # profiles in this shared environment. Every managed dependency is pinned.
  if ! (cd "$API_DIR" && uv export --locked --package receiptbi-api --no-dev \
      --no-emit-workspace --no-hashes "$@" --output-file "$requirements_file" \
      && uv pip install --python "$(venv_python)" -r "$requirements_file" \
      && uv pip install --python "$(venv_python)" --no-deps -e .); then
    rm -f "$requirements_file"
    return 1
  fi
  rm -f "$requirements_file"
  mkdir -p "$(dirname "$fingerprint_file")"
  echo "$expected_fingerprint" > "$fingerprint_file"
  success "Python $profile 依赖已就绪"
}

setup_python_core() {
  install_python_profile "core" "$PYTHON_CORE_FINGERPRINT" "${1:-0}"
}

install_python_analytics() {
  install_python_profile "analytics" "$PYTHON_ANALYTICS_FINGERPRINT" "${1:-0}"
}

install_python_dev() {
  install_python_profile "dev" "$PYTHON_DEV_FINGERPRINT" "${1:-0}"
}

ensure_aiosqlite() {
  local py
  py="$(venv_python)"
  if ! "$py" -c "import aiosqlite" >/dev/null 2>&1; then
    info "修复 Python 核心依赖..."
    setup_python_core 1
    "$py" -c "import aiosqlite" >/dev/null 2>&1 || error "aiosqlite 不可用，请检查 Python 环境"
  fi
}
