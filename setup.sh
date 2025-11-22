#!/bin/bash

set -euo pipefail

VERSION="1.6"
PYTHON_REQUIRED_MAJOR=3
PYTHON_MIN_MINOR=10
PYTHON_MAX_MINOR=12
VENV_DIR="venv_py310"
PYTHON_CMD=""
PYTHON_VERSION=""
RESET_CONFIG=false

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
    if [ "$name" = "WSL" ]; then
        warn "检测到 WSL：建议将仓库放在 Linux 文件系统中 (例如 /home/<user>)，以避免路径与权限问题。"
    fi
}

check_python() {
    local candidates=("python3.10" "python3.11" "python3.12" "python3" "python")
    for cmd in "${candidates[@]}"; do
        if command -v "$cmd" >/dev/null 2>&1; then
            local resolved="$(command -v "$cmd")"
            local version_tuple
            version_tuple="$("$resolved" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")' 2>/dev/null || true)"
            if [[ "$version_tuple" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
                local major="${BASH_REMATCH[1]}"
                local minor="${BASH_REMATCH[2]}"
                if (( major == PYTHON_REQUIRED_MAJOR && minor >= PYTHON_MIN_MINOR )); then
                    PYTHON_CMD="$resolved"
                    PYTHON_VERSION="$version_tuple"
                    if (( minor > PYTHON_MAX_MINOR )); then
                        warn "检测到 Python ${PYTHON_VERSION}，高于推荐范围 (3.${PYTHON_MIN_MINOR}~3.${PYTHON_MAX_MINOR})，将尝试继续。"
                    elif (( minor > PYTHON_MIN_MINOR )); then
                        warn "检测到 Python ${PYTHON_VERSION}，与推荐版本 (3.${PYTHON_MIN_MINOR}) 略有不同，若遇兼容问题请切换到 3.${PYTHON_MIN_MINOR}."
                    else
                        ok "检测到 Python ${PYTHON_VERSION}：$PYTHON_CMD"
                    fi
                    if (( minor != PYTHON_MIN_MINOR )); then
                        ok "使用 Python ${PYTHON_VERSION}：$PYTHON_CMD"
                    fi
                    return
                fi
            fi
        fi
    done
    err "需要 Python 3.${PYTHON_MIN_MINOR}+ (推荐 3.${PYTHON_MIN_MINOR}~3.${PYTHON_MAX_MINOR})，请安装对应版本后重试。"
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
    PYTHON_BIN="$VIRTUAL_ENV/bin/python"
    PIP_BIN="$VIRTUAL_ENV/bin/pip"
}

ensure_pip() {
    if [ -z "${PYTHON_BIN:-}" ] || [ ! -x "$PYTHON_BIN" ]; then
        err "虚拟环境缺少 python 可执行文件，请删除 $VENV_DIR 后重试。"
        exit 1
    fi

    if [ ! -x "$PIP_BIN" ]; then
        warn "虚拟环境中未找到 pip，尝试使用 ensurepip 安装..."
        "$PYTHON_BIN" -m ensurepip --upgrade >/dev/null 2>&1 || true
        PIP_BIN="$VIRTUAL_ENV/bin/pip"
        if [ ! -x "$PIP_BIN" ]; then
            err "仍无法在虚拟环境中找到 pip，请手动安装 python3-venv 或 pip 后重试。"
            exit 1
        fi
    fi

    info "升级 pip"
    "$PIP_BIN" install --upgrade pip >/dev/null
}

ensure_venv() {
    if [ ! -d "$VENV_DIR" ]; then
        info "创建虚拟环境：$VENV_DIR (使用 $PYTHON_CMD)"
        if ! "$PYTHON_CMD" -m venv "$VENV_DIR"; then
            warn "首次创建虚拟环境失败，尝试运行 ensurepip 后重试..."
            "$PYTHON_CMD" -m ensurepip --upgrade >/dev/null 2>&1 || true
            if ! "$PYTHON_CMD" -m venv "$VENV_DIR"; then
                err "无法创建虚拟环境，请安装 python3-venv 或 virtualenv 后重试。"
                exit 1
            fi
        fi
    else
        info "使用已有虚拟环境：$VENV_DIR"
    fi

    activate_venv
    ensure_pip
    ok "虚拟环境已激活：$VIRTUAL_ENV"
}

install_requirements() {
    if [ ! -f "requirements.txt" ]; then
        err "未找到 requirements.txt"
        exit 1
    fi
    info "安装依赖 (requirements.txt)"
    warn "OpenInterpreter 包较大，安装过程可能需要数分钟。"
    "$PIP_BIN" install --upgrade setuptools wheel >/dev/null || true

    # 智能跳过：仅当依赖缺失时才安装
    if "$PIP_BIN" freeze | grep -q "DBUtils"; then
        info "检测到关键依赖已安装，尝试执行增量更新..."
        # 使用 --upgrade-strategy only-if-needed 避免不必要的重装
        if "$PIP_BIN" install -r requirements.txt --upgrade-strategy only-if-needed; then
            ok "依赖检查通过"
            return
        fi
    fi

    # 预先安装 tiktoken，优先使用 binary wheel 避免编译
    if ! "$PIP_BIN" freeze | grep -q "tiktoken"; then
        if ! "$PIP_BIN" install tiktoken; then
            warn "tiktoken 安装失败，尝试升级 pip 后重试..."
            "$PIP_BIN" install --upgrade pip
            "$PIP_BIN" install tiktoken || true # 允许 tiktoken 失败以便后续尝试
        fi
    fi

    if "$PIP_BIN" install --upgrade -r requirements.txt; then
        ok "依赖安装完成"
        return
    fi

    warn "依赖安装失败，尝试使用官方源重新安装..."
    if "$PIP_BIN" install --no-cache-dir --default-timeout=120 -r requirements.txt -i https://pypi.org/simple; then
        ok "依赖安装完成"
        return
    fi

    warn "使用官方源仍失败，尝试使用清华镜像..."
    if "$PIP_BIN" install --no-cache-dir --default-timeout=120 -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple; then
        ok "依赖安装完成"
        return
    fi

    err "依赖安装失败，请检查网络或系统依赖。"
    exit 1
}

verify_dependencies() {
    info "验证核心依赖"
    local missing_packages
    missing_packages="$($PYTHON_BIN <<'PY'
import importlib, sys
targets = [
    ("pymysql", "pymysql", None),
    ("plotly", "plotly", None),
    ("pandas", "pandas", None),
    ("DBUtils", "dbutils", "dbutils.pooled_db"),
    ("cachetools", "cachetools", None),
    ("psutil", "psutil", None),
]
failed = []
for pkg, module, submodule in targets:
    try:
        importlib.import_module(module)
        if submodule:
            # 验证子模块也能导入（如 PooledDB）
            importlib.import_module(submodule)
    except Exception as e:
        failed.append(pkg)
if failed:
    print(" ".join(failed))
PY
)"

    if [ -n "$missing_packages" ]; then
        warn "检测到缺失或导入失败的依赖: $missing_packages"
        for pkg in $missing_packages; do
            info "尝试重新安装 $pkg"
            if ! "$PIP_BIN" install --no-cache-dir --default-timeout=120 "$pkg"; then
                err "自动安装 $pkg 失败，请手动检查网络或系统依赖。"
                exit 1
            fi
        done

        # 重新验证
        missing_packages="$($PYTHON_BIN <<'PY'
import importlib, sys
targets = [
    ("pymysql", "pymysql", None),
    ("plotly", "plotly", None),
    ("pandas", "pandas", None),
    ("DBUtils", "dbutils", "dbutils.pooled_db"),
    ("cachetools", "cachetools", None),
    ("psutil", "psutil", None),
]
failed = []
for pkg, module, submodule in targets:
    try:
        importlib.import_module(module)
        if submodule:
            # 验证子模块也能导入（如 PooledDB）
            importlib.import_module(submodule)
    except Exception as e:
        failed.append(pkg)
if failed:
    print(" ".join(failed))
PY
)"
        if [ -n "$missing_packages" ]; then
            err "依赖验证失败，请手动安装: $missing_packages"
            exit 1
        fi
    fi

    ok "核心依赖验证通过"
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
        if ! cp .env.example .env; then
            err "复制 .env.example 失败，请检查文件权限或路径。"
            exit 1
        fi
    else
        cat > .env <<'EOF'
# API配置
API_KEY=
API_BASE_URL=https://api.openai.com/v1/
DEFAULT_MODEL=gpt-5

# 数据库配置
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_DATABASE=

# 系统配置
LOG_LEVEL=INFO
LOG_FILE=logs/app.log
CACHE_TTL=3600
OUTPUT_DIR=output
CACHE_DIR=cache
EOF
    fi
    chmod 600 .env 2>/dev/null || true
    if [ ! -f ".env" ]; then
        err "生成 .env 失败，请手动创建并重试。"
        exit 1
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

    if [ "$RESET_CONFIG" = true ]; then
        info "重置系统配置为默认模板"
        if cp "config/config.example.json" "config/config.json"; then
            ok "已重置 config/config.json"
        else
            err "重置 config/config.json 失败"
        fi
        if cp "config/config.json" "backend/config/config.json"; then
            ok "已同步 backend/config/config.json"
        else
            err "同步 backend/config/config.json 失败"
        fi
    fi

    ok "配置检查完成"
}

setup_frontend() {
    info "检查前端构建环境"
    if command -v npm >/dev/null 2>&1; then
        info "检测到 npm，尝试构建 React 前端..."
        if [ -d "frontend/react-app" ]; then
            (
                cd frontend/react-app
                info "正在安装前端依赖..."
                npm install >/dev/null 2>&1 || {
                    warn "npm install 失败，跳过前端构建。你可能需要手动进入 frontend/react-app 安装依赖。"
                    return
                }
                info "正在构建前端..."
                npm run build >/dev/null 2>&1 || {
                    warn "npm run build 失败，将使用传统模板。"
                    return
                }
                ok "React 前端构建成功"
            )
        else
            warn "未找到 frontend/react-app 目录，跳过构建"
        fi
    else
        warn "未检测到 npm，跳过 React 前端构建，将使用传统模版"
    fi
}

summary() {
    printf '\n'
    ok "环境配置完成"
    info "虚拟环境：$VIRTUAL_ENV"
    info "已生成配置文件：.env、config/models.json、backend/config/models.json（均为占位值，请替换为实际凭据）"
    info "下一步：运行 ./start.sh 启动服务"
}

usage() {
    cat <<'EOF'
用法: ./setup.sh [--reset-config]

  --reset-config   强制使用示例模板重置 config/config.json 与 backend/config/config.json
  -h, --help       显示此帮助信息
EOF
}

parse_args() {
    while (($#)); do
        case "$1" in
            --reset-config)
                RESET_CONFIG=true
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                err "未知参数: $1"
                usage
                exit 1
                ;;
        esac
        shift
    done
}

main() {
    banner
    require_project_root
    detect_os
    ensure_directories
    ensure_env_file
    sync_configs
    check_python
    ensure_venv
    install_requirements
    verify_dependencies
    setup_frontend
    summary
}

trap 'err "执行失败，请检查上方日志。"; exit 1' ERR

parse_args "$@"
main

