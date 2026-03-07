OS="unknown"
PYTHON_CMD=""
NPM_CMD=""

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
  check_command node || error "找不到 node"
  if check_command pnpm; then
    NPM_CMD="pnpm"
  elif check_command npm; then
    NPM_CMD="npm"
  else
    error "找不到 npm 或 pnpm"
  fi
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

selected_python_version() {
  ensure_python_selected
  "$PYTHON_CMD" --version 2>&1
}

venv_python_version() {
  if [ -x "$(venv_python)" ]; then
    "$(venv_python)" --version 2>&1
  fi
}

node_lock_file() {
  if [ "$NPM_CMD" = "pnpm" ] && [ -f "$WEB_DIR/pnpm-lock.yaml" ]; then
    echo "$WEB_DIR/pnpm-lock.yaml"
  elif [ -f "$WEB_DIR/package-lock.json" ]; then
    echo "$WEB_DIR/package-lock.json"
  elif [ -f "$WEB_DIR/pnpm-lock.yaml" ]; then
    echo "$WEB_DIR/pnpm-lock.yaml"
  else
    echo "$WEB_DIR/package.json"
  fi
}

python_profile_fingerprint() {
  local profile="$1"
  local selected_version
  local venv_version
  selected_version="$(selected_python_version)"
  venv_version="$(venv_python_version || true)"
  echo "$profile|selected=${selected_version}|venv=${venv_version:-none}|$(checksum_file "$API_DIR/pyproject.toml")"
}

node_fingerprint() {
  ensure_node_selected
  local lock_file
  lock_file="$(node_lock_file)"
  echo "$(node --version)|$NPM_CMD|$(basename "$lock_file")|$(checksum_file "$lock_file")"
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
