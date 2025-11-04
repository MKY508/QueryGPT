#!/bin/bash

set -euo pipefail

VERSION="1.5"
PYTHON_REQUIRED="3.10"
VENV_DIR="venv_py310"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

info() { printf '\033[0;36mℹ %s\033[0m\n' "$1"; }
ok()   { printf '\033[0;32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$1"; }
err()  { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; }

banner() {
    printf '\033[0;36m╔══════════════════════════════╗\033[0m\n'
    printf '\033[0;36m║   QueryGPT Setup  v%-6s     ║\033[0m\n' "$VERSION"
    printf '\033[0;36m╚══════════════════════════════╝\033[0m\n\n'
}

require_project_root() {
    if [ ! -f "backend/app.py" ]; then
        err "请在项目根目录执行 setup.sh"
        exit 1
    fi
}

detect_os() {
    local name="Unknown"
    case "$OSTYPE" in
        darwin*) name="macOS" ;;
        linux*)
        if grep -qi microsoft /proc/version 2>/dev/null; then
                name="WSL"
            else
                name="Linux"
        fi
            ;;
    esac
    info "运行环境：$name"
}

check_python() {
    local candidates=("python3.10" "python3" "python")
    for cmd in "${candidates[@]}"; do
        if command -v "$cmd" >/dev/null 2>&1; then
            local resolved="$(command -v "$cmd")"
            local short_version="$("$resolved" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
            if [[ "$short_version" == "$PYTHON_REQUIRED" ]]; then
                PYTHON_CMD="$resolved"
                ok "检测到 Python ${PYTHON_REQUIRED}：$PYTHON_CMD"
                return
            fi
        fi
    done
    err "需要 Python ${PYTHON_REQUIRED}，请安装对应版本后重试。"
        exit 1
}

activate_venv() {
    local activate="$VENV_DIR/bin/activate"
    if [ ! -f "$activate" ]; then
        err "虚拟环境缺少激活脚本，请删除 $VENV_DIR 后重新执行 setup.sh"
        exit 1
    fi
    # shellcheck disable=SC1091
    source "$activate"
    PIP_BIN="$VIRTUAL_ENV/bin/pip"
}

ensure_venv() {
    if [ ! -d "$VENV_DIR" ]; then
        info "创建虚拟环境：$VENV_DIR"
        "$PYTHON_CMD" -m venv "$VENV_DIR" || {
            err "无法创建虚拟环境，请确认已安装 python3-venv 或 virtualenv。"
            exit 1
        }
    else
        info "使用已有虚拟环境：$VENV_DIR"
    fi

    activate_venv

    info "升级 pip"
    "$PIP_BIN" install --upgrade pip >/dev/null
    ok "虚拟环境已激活：$VIRTUAL_ENV"
}

install_requirements() {
    if [ ! -f "requirements.txt" ]; then
        err "未找到 requirements.txt"
        exit 1
    fi
    info "安装依赖 (requirements.txt)"
    warn "OpenInterpreter 包较大，安装过程可能需要数分钟。"
    "$PIP_BIN" install -r requirements.txt
    ok "依赖安装完成"
}

ensure_directories() {
    info "检查目录结构"
    mkdir -p logs cache output backend/output backend/config config
    ok "目录已就绪"
}

ensure_env_file() {
    if [ -f ".env" ]; then
        info ".env 已存在，跳过生成"
        return
    fi
    if [ -f ".env.example" ]; then
        cp .env.example .env
    else
        cat > .env <<'EOF'
# API配置
API_KEY=
API_BASE_URL=https://api.openai.com/v1/
DEFAULT_MODEL=gpt-4.1

# 数据库配置
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_DATABASE=test

# 系统配置
LOG_LEVEL=INFO
LOG_FILE=logs/app.log
CACHE_TTL=3600
OUTPUT_DIR=output
CACHE_DIR=cache
EOF
    fi
    ok "已生成 .env 配置"
}

copy_if_missing() {
    local source="$1"
    local target="$2"
    if [ -f "$source" ] && [ ! -f "$target" ]; then
        mkdir -p "$(dirname "$target")"
        cp "$source" "$target"
        ok "同步文件：$target"
    fi
}

sync_configs() {
    info "同步模型与系统配置"
    copy_if_missing "config/models.example.json" "config/models.json"
    copy_if_missing "config/config.example.json" "config/config.json"
    copy_if_missing "config/models.json" "backend/config/models.json"
    copy_if_missing "config/config.json" "backend/config/config.json"
    ok "配置检查完成"
}

summary() {
    printf '\n'
    ok "环境配置完成"
    info "虚拟环境：$VIRTUAL_ENV"
    info "下一步：运行 ./start.sh 启动服务"
}

main() {
    banner
    require_project_root
    detect_os
    ensure_directories
    check_python
    ensure_venv
    install_requirements
    ensure_env_file
    sync_configs
    summary
}

trap 'err "执行失败，请检查上方日志。"; exit 1' ERR

main "$@"

