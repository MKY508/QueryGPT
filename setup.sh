#!/bin/bash

# QueryGPT 环境配置脚本 v3.0 - WSL兼容版
# Environment Setup Script v3.0 - WSL Compatible
# 支持 WSL/Linux/macOS 环境

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# 全局变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PYTHON_CMD=""
IS_FIRST_RUN=false
IS_DEBUG=false
BACKUP_SUFFIX=$(date +%Y%m%d_%H%M%S)
LOG_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ERROR_LOG="logs/setup_error_${LOG_TIMESTAMP}.log"
DEBUG_LOG="logs/setup_debug_${LOG_TIMESTAMP}.log"

# 三层环境检测变量
IS_LINUX=false       # Linux大类（包括WSL和纯Linux）
IS_WSL=false        # WSL子类
IS_MACOS=false      # macOS
IS_NATIVE_LINUX=false  # 纯Linux（非WSL）
OS_TYPE="Unknown"   # 操作系统类型描述

# 错误处理函数
error_handler() {
    local line_num=$1
    local last_command="${2:-unknown}"
    local error_code="${3:-1}"
    local function_name="${FUNCNAME[1]:-main}"
    
    echo "" >&2
    echo -e "${RED}═══════════════ 错误报告 ═══════════════${NC}" >&2
    echo -e "${RED}脚本:${NC} $(basename $0)" >&2
    echo -e "${RED}位置:${NC} 第 $line_num 行" >&2
    echo -e "${RED}函数:${NC} $function_name" >&2
    echo -e "${RED}命令:${NC} $last_command" >&2
    echo -e "${RED}错误码:${NC} $error_code" >&2
    echo -e "${RED}时间:${NC} $(date '+%Y-%m-%d %H:%M:%S')" >&2
    echo -e "${RED}═══════════════════════════════════════${NC}" >&2
    
    # 确保日志目录存在
    mkdir -p logs
    
    # 保存到错误日志
    {
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 错误发生"
        echo "脚本: $(basename $0)"
        echo "位置: 第 $line_num 行"
        echo "函数: $function_name"
        echo "命令: $last_command"
        echo "错误码: $error_code"
        echo "当前目录: $(pwd)"
        echo "环境信息: $OS_TYPE"
        echo "Python命令: $PYTHON_CMD"
        echo "虚拟环境: ${VIRTUAL_ENV:-未激活}"
        echo "---"
    } >> "$ERROR_LOG"
    
    echo -e "${YELLOW}错误日志已保存: $ERROR_LOG${NC}" >&2
    echo -e "${YELLOW}如需技术支持，请提供此日志文件${NC}" >&2
    
    # 清理并退出
    cleanup_on_error
}

# 调试日志函数
debug_log() {
    if [ "$IS_DEBUG" = true ]; then
        local message="$1"
        local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
        echo -e "${CYAN}[DEBUG $timestamp] $message${NC}" >&2
        
        # 同时记录到调试日志
        mkdir -p logs
        echo "[$timestamp] $message" >> "$DEBUG_LOG"
    fi
}

# 信息日志函数
info_log() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${BLUE}[INFO] $message${NC}" >&2
    
    # 记录到调试日志
    if [ "$IS_DEBUG" = true ]; then
        mkdir -p logs
        echo "[$timestamp] INFO: $message" >> "$DEBUG_LOG"
    fi
}

# 警告日志函数
warning_log() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${YELLOW}[WARNING] $message${NC}" >&2
    
    # 记录到错误日志
    mkdir -p logs
    echo "[$timestamp] WARNING: $message" >> "$ERROR_LOG"
}

# 成功日志函数
success_log() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${GREEN}[SUCCESS] $message${NC}" >&2
    
    if [ "$IS_DEBUG" = true ]; then
        mkdir -p logs
        echo "[$timestamp] SUCCESS: $message" >> "$DEBUG_LOG"
    fi
}

# 错误时的清理函数
cleanup_on_error() {
    debug_log "执行错误清理..."
    
    if [ -n "$VIRTUAL_ENV" ]; then
        debug_log "退出虚拟环境: $VIRTUAL_ENV"
        deactivate 2>/dev/null || true
    fi
    
    # 记录最终状态到错误日志
    {
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 错误清理完成"
        echo "最终目录: $(pwd)"
        echo "剩余进程: $(jobs -p | wc -l)"
        echo "=== 清理结束 ==="
        echo ""
    } >> "$ERROR_LOG"
}

# 正常退出清理函数
cleanup_normal() {
    debug_log "执行正常清理..."
    
    # 只在调试模式记录正常退出
    if [ "$IS_DEBUG" = true ]; then
        {
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] 脚本正常完成"
            echo "最终目录: $(pwd)"
            echo "=== 正常结束 ==="
        } >> "$DEBUG_LOG"
    fi
}

# 中断处理函数
interrupt_handler() {
    echo "" >&2
    echo -e "${YELLOW}[INFO] 用户中断了安装过程${NC}" >&2
    
    # 记录中断信息
    mkdir -p logs
    {
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 用户中断安装"
        echo "中断位置: ${BASH_LINENO[0]}"
        echo "当前函数: ${FUNCNAME[1]:-main}"
    } >> "$ERROR_LOG"
    
    cleanup_on_error
    exit 1
}

# 版本信息
SCRIPT_VERSION="3.1.0"
SCRIPT_DATE="2025-09-04"

# 检测运行环境 - 三层检测系统
detect_environment() {
    debug_log "开始环境检测..."
    info_log "正在检测运行环境..."
    
    # 第一层：检测大类操作系统
    if [[ "$OSTYPE" == "darwin"* ]]; then
        IS_MACOS=true
        IS_LINUX=false
        OS_TYPE="macOS"
        info_log "检测到 macOS 环境 / macOS environment detected"
        
    elif [[ "$OSTYPE" == "linux-gnu"* ]] || [ -f /proc/version ]; then
        IS_LINUX=true
        IS_MACOS=false
        
        # 第二层：检测是否为WSL
        if grep -qi microsoft /proc/version 2>/dev/null; then
            IS_WSL=true
            IS_NATIVE_LINUX=false
            OS_TYPE="WSL"
            info_log "检测到 WSL 环境 / WSL environment detected"
            
            # WSL自动迁移到Linux文件系统
            if [[ "$SCRIPT_DIR" == /mnt/* ]]; then
                echo -e "${YELLOW}检测到Windows文件系统，自动迁移以提升性能...${NC}"
                TARGET_DIR="$HOME/QueryGPT-github"
                
                if [ ! -d "$TARGET_DIR" ]; then
                    cp -r "$SCRIPT_DIR" "$TARGET_DIR" 2>/dev/null
                fi
                
                cd "$TARGET_DIR"
                SCRIPT_DIR="$TARGET_DIR"
                echo -e "${GREEN}✓ 已迁移到Linux文件系统: $TARGET_DIR${NC}"
                echo ""
            fi
        else
            IS_WSL=false
            IS_NATIVE_LINUX=true
            OS_TYPE="Native Linux"
            
            # 检测具体的Linux发行版
            if [ -f /etc/os-release ]; then
                . /etc/os-release
                OS_TYPE="$NAME"
            fi
            
            info_log "检测到纯 Linux 环境 / Native Linux detected: $OS_TYPE"
        fi
    else
        OS_TYPE="Unknown"
        warning_log "未知的操作系统类型 / Unknown OS type: $OSTYPE"
    fi
    
    # 输出详细的环境信息（调试模式）
    debug_log "环境检测结果: IS_LINUX=$IS_LINUX, IS_WSL=$IS_WSL, IS_MACOS=$IS_MACOS, IS_NATIVE_LINUX=$IS_NATIVE_LINUX, OS_TYPE=$OS_TYPE"
}

# 修复文件格式 - 适用于所有Linux环境
fix_line_endings() {
    debug_log "开始修复文件格式..."
    # Linux环境下（包括WSL和纯Linux）都需要检查文件格式
    if [ "$IS_LINUX" = true ] || [ "$IS_WSL" = true ]; then
        info_log "检查文件格式... / Checking file formats..."
        
        # 检查并修复关键文件的行结束符
        for file in setup.sh start.sh requirements.txt .env .env.example diagnostic.sh; do
            if [ -f "$file" ]; then
                # 检测是否有CRLF
                if file "$file" 2>/dev/null | grep -q "CRLF"; then
                    warning_log "修复 $file 的行结束符..."
                    # 使用多种方法尝试转换
                    if command -v dos2unix &> /dev/null; then
                        dos2unix "$file" 2>/dev/null
                    elif command -v sed &> /dev/null; then
                        sed -i 's/\r$//' "$file"
                    else
                        tr -d '\r' < "$file" > "$file.tmp" && mv "$file.tmp" "$file"
                    fi
                    success_log "$file 已修复"
                fi
            fi
        done
        
        # 修复权限 - 所有脚本文件
        chmod +x *.sh 2>/dev/null || true
    fi
}

# 打印带颜色的消息
print_message() {
    local type=$1
    local message=$2
    case $type in
        "success") echo -e "${GREEN}✓${NC} $message" ;;
        "error") echo -e "${RED}✗${NC} $message" ;;
        "warning") echo -e "${YELLOW}⚠${NC} $message" ;;
        "info") echo -e "${BLUE}ℹ${NC} $message" ;;
        "header") echo -e "\n${BOLD}${CYAN}$message${NC}" ;;
        "step") echo -e "${MAGENTA}►${NC} $message" ;;
    esac
}

# 打印横幅
print_banner() {
    clear
    echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}     ${BOLD}QueryGPT Setup v${SCRIPT_VERSION}${NC}                              ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}     环境配置脚本 / Environment Setup                  ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}     ${OS_TYPE} | $(date +%Y-%m-%d)                       ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# 显示进度
show_progress() {
    local current=$1
    local total=$2
    local width=50
    local percentage=$((current * 100 / total))
    local completed=$((width * current / total))
    
    printf "\r["
    printf "%${completed}s" | tr ' ' '='
    printf "%$((width - completed))s" | tr ' ' ' '
    printf "] %d%%" "$percentage"
    
    if [ "$current" -eq "$total" ]; then
        echo ""
    fi
}

# 检查是否首次运行
check_first_run() {
    debug_log "检查是否首次运行..."
    print_message "header" "检查运行状态 / Checking Run Status"
    
    local indicators=0
    
    if [ ! -d "venv_py310" ] && [ ! -d "venv" ]; then
        ((indicators++))
        print_message "info" "未检测到虚拟环境 / No virtual environment detected"
    fi
    
    if [ ! -f ".env" ]; then
        ((indicators++))
        print_message "info" "未检测到配置文件 / No configuration file detected"
    fi
    
    if [ ! -d "logs" ] || [ ! -d "cache" ]; then
        ((indicators++))
        print_message "info" "未检测到必要目录 / Required directories not detected"
    fi
    
    if [ $indicators -ge 2 ]; then
        IS_FIRST_RUN=true
        info_log "检测到首次运行，将执行完整初始化 / First run detected, performing full initialization"
        print_message "info" "检测到首次运行，将执行完整初始化 / First run detected, performing full initialization"
    else
        info_log "检测到现有安装 / Existing installation detected"
        print_message "success" "检测到现有安装 / Existing installation detected"
    fi
    echo ""
}

# 检查Python版本
check_python() {
    debug_log "开始检查Python环境..."
    print_message "header" "检查 Python 环境 / Checking Python Environment"
    
    # 优先检查 python3.10
    if command -v python3.10 &> /dev/null; then
        PYTHON_CMD="python3.10"
        local version=$(python3.10 -V 2>&1 | grep -Po '\d+\.\d+\.\d+')
        success_log "找到 Python 3.10: $version"
        print_message "success" "找到 Python 3.10: $version"
    elif command -v python3 &> /dev/null; then
        local version=$(python3 -V 2>&1 | grep -Po '\d+\.\d+\.\d+')
        local major=$(echo $version | cut -d. -f1)
        local minor=$(echo $version | cut -d. -f2)
        
        if [ "$major" -eq 3 ] && [ "$minor" -eq 10 ]; then
            PYTHON_CMD="python3"
            success_log "找到 Python $version"
            print_message "success" "找到 Python $version"
        else
            warning_log "Python 版本不匹配: $version (推荐 3.10.x)"
            print_message "warning" "Python 版本不匹配: $version (推荐 3.10.x)"
            PYTHON_CMD="python3"
        fi
    else
        error_handler $LINENO "Python 3 not found" 1
        exit 1
    fi
    debug_log "Python检查完成: $PYTHON_CMD"
    echo ""
}

# 设置虚拟环境
setup_venv() {
    debug_log "开始设置虚拟环境..."
    print_message "header" "配置虚拟环境 / Configuring Virtual Environment"
    
    local venv_dir="venv_py310"
    
    if [ -d "$venv_dir" ]; then
        if [ -f "$venv_dir/bin/activate" ]; then
            info_log "使用现有虚拟环境 / Using existing virtual environment"
            print_message "info" "使用现有虚拟环境 / Using existing virtual environment"
        else
            warning_log "虚拟环境损坏，重新创建... / Virtual environment corrupted, recreating..."
            print_message "warning" "虚拟环境损坏，重新创建... / Virtual environment corrupted, recreating..."
            debug_log "删除损坏的虚拟环境: $venv_dir"
            rm -rf "$venv_dir"
            debug_log "执行命令: $PYTHON_CMD -m venv $venv_dir"
            $PYTHON_CMD -m venv "$venv_dir"
        fi
    else
        info_log "创建虚拟环境... / Creating virtual environment..."
        print_message "info" "创建虚拟环境... / Creating virtual environment..."
        debug_log "执行命令: $PYTHON_CMD -m venv $venv_dir"
        $PYTHON_CMD -m venv "$venv_dir"
        success_log "虚拟环境创建成功 / Virtual environment created"
        print_message "success" "虚拟环境创建成功 / Virtual environment created"
    fi
    
    # 激活虚拟环境
    debug_log "激活虚拟环境: $venv_dir/bin/activate"
    source "$venv_dir/bin/activate"
    
    # 验证激活成功
    if [ -z "$VIRTUAL_ENV" ]; then
        error_handler $LINENO "Failed to activate virtual environment" 1
        exit 1
    fi
    
    debug_log "虚拟环境激活成功: $VIRTUAL_ENV"
    
    # 升级pip
    info_log "升级 pip... / Upgrading pip..."
    print_message "info" "升级 pip... / Upgrading pip..."
    debug_log "执行命令: pip install --upgrade pip --quiet"
    pip install --upgrade pip --quiet
    success_log "pip 已升级 / pip upgraded"
    print_message "success" "pip 已升级 / pip upgraded"
    echo ""
}

# 安装依赖
install_dependencies() {
    debug_log "开始安装依赖..."
    print_message "header" "管理项目依赖 / Managing Dependencies"
    
    if [ ! -f "requirements.txt" ]; then
        warning_log "未找到 requirements.txt，创建默认依赖 / Creating default requirements.txt"
        print_message "warning" "未找到 requirements.txt，创建默认依赖 / Creating default requirements.txt"
        cat > requirements.txt << 'EOF'
Flask==2.3.3
flask-cors==4.0.0
pymysql==1.1.0
python-dotenv==1.0.0
openai==1.3.0
litellm==1.0.0
open-interpreter==0.4.3
pandas==2.0.3
numpy==1.24.3
matplotlib==3.7.2
seaborn==0.12.2
plotly==5.15.0
EOF
    fi
    
    # 检查是否需要安装
    local need_install=false
    
    if ! pip show flask &> /dev/null || ! pip show open-interpreter &> /dev/null; then
        need_install=true
    fi
    
    if [ "$need_install" = true ] || [ "$IS_FIRST_RUN" = true ]; then
        info_log "安装依赖包... / Installing dependencies..."
        print_message "info" "安装依赖包... / Installing dependencies..."
        warning_log "这可能需要几分钟，请耐心等待... / This may take a few minutes, please be patient..."
        print_message "warning" "这可能需要几分钟，请耐心等待... / This may take a few minutes, please be patient..."
        
        # 特别处理 OpenInterpreter
        if grep -q "open-interpreter" requirements.txt; then
            warning_log "安装 OpenInterpreter 0.4.3 (较大，需要时间)... / Installing OpenInterpreter 0.4.3 (large, takes time)..."
            print_message "warning" "安装 OpenInterpreter 0.4.3 (较大，需要时间)... / Installing OpenInterpreter 0.4.3 (large, takes time)..."
            debug_log "开始OpenInterpreter安装进程..."
            echo "正在下载和安装，请稍候... / Downloading and installing, please wait..."
            
            # 不使用quiet，显示进度
            pip install "open-interpreter==0.4.3" --progress-bar on 2>&1 | while IFS= read -r line; do
                # 只显示关键信息
                if [[ "$line" == *"Downloading"* ]] || [[ "$line" == *"Installing"* ]] || [[ "$line" == *"Successfully"* ]]; then
                    echo "  $line"
                fi
            done
            success_log "OpenInterpreter 安装完成 / OpenInterpreter installed"
            print_message "success" "OpenInterpreter 安装完成 / OpenInterpreter installed"
        fi
        
        # 安装其他依赖
        info_log "安装其他依赖包... / Installing other dependencies..."
        print_message "info" "安装其他依赖包... / Installing other dependencies..."
        debug_log "执行 pip install -r requirements.txt"
        echo "进度 / Progress:"
        
        # 显示简化的进度
        pip install -r requirements.txt 2>&1 | while IFS= read -r line; do
            if [[ "$line" == *"Collecting"* ]]; then
                package=$(echo "$line" | sed 's/Collecting //' | cut -d' ' -f1)
                echo -n "  📦 安装 / Installing: $package... "
            elif [[ "$line" == *"Successfully installed"* ]]; then
                echo "✓"
            elif [[ "$line" == *"Requirement already satisfied"* ]]; then
                package=$(echo "$line" | sed 's/.*Requirement already satisfied: //' | cut -d' ' -f1)
                echo "  ✓ 已安装 / Already installed: $package"
            fi
        done
        
        echo ""
        success_log "所有依赖安装完成！/ All dependencies installed!"
        print_message "success" "所有依赖安装完成！/ All dependencies installed!"
    else
        info_log "依赖已是最新 / Dependencies up to date"
        print_message "success" "依赖已是最新 / Dependencies up to date"
    fi
    debug_log "依赖安装阶段完成"
    echo ""
}

# 创建目录结构
create_directories() {
    print_message "header" "检查目录结构 / Checking Directory Structure"
    
    local dirs=("logs" "cache" "output" "backend/data" "config" "backup")
    local created=0
    
    for dir in "${dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            ((created++))
            print_message "success" "创建目录 / Created: $dir"
        fi
    done
    
    if [ $created -eq 0 ]; then
        print_message "success" "所有目录已存在 / All directories exist"
    fi
    echo ""
}

# 配置环境变量
setup_env() {
    print_message "header" "管理配置文件 / Managing Configuration"
    
    # 创建 .env.example
    if [ ! -f ".env.example" ]; then
        cat > .env.example << 'EOF'
# API配置
API_KEY=your-api-key-here
API_BASE_URL=https://api.openai.com/v1/
DEFAULT_MODEL=gpt-4

# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=test_db

# 系统配置
LOG_LEVEL=INFO
LOG_FILE=logs/app.log
CACHE_TTL=3600
OUTPUT_DIR=output
CACHE_DIR=cache
EOF
    fi
    
    if [ -f ".env" ]; then
        print_message "success" "检测到现有配置文件，保持不变 / Existing configuration detected, keeping it"
        print_message "info" "如需重置配置，请删除 .env 文件后重新运行"
        print_message "info" "To reset config, delete .env and run again"
    else
        print_message "info" "创建配置文件... / Creating configuration file..."
        
        # 先检查是否有.env.example
        if [ -f ".env.example" ]; then
            print_message "info" "从模板创建配置 / Creating from template"
            cp .env.example .env
            print_message "success" "配置文件已创建 / Configuration created"
            print_message "info" "默认配置已生成，请根据需要编辑 .env 文件"
            print_message "info" "Default configuration created, please edit .env file as needed"
        else
            # 创建默认配置
            cat > .env << 'EOF'
# API配置
API_KEY=sk-YOUR-API-KEY-HERE
API_BASE_URL=https://api.vveai.com/v1/
DEFAULT_MODEL=gpt-4.1

# 数据库配置
DB_HOST=localhost
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
            print_message "success" "配置文件已创建 / Configuration created"
            print_message "warning" "默认配置使用本地Ollama，如需其他API请编辑.env文件"
            print_message "warning" "Default config uses local Ollama, edit .env for other APIs"
        fi
    fi
    
    # 创建模型配置
    setup_models
    echo ""
}

# 配置模型设置
setup_models() {
    print_message "info" "配置模型设置... / Configuring model settings..."
    
    # 创建示例配置
    if [ ! -f "config/models.example.json" ]; then
        cat > config/models.example.json << 'EOF'
{
  "models": [
    {
      "id": "gpt-4.1",
      "name": "GPT-4.1",
      "type": "openai",
      "api_base": "https://api.openai.com/v1/",
      "api_key": "your-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "active"
    }
  ]
}
EOF
    fi
    
    # 如果没有models.json，创建一个
    if [ ! -f "config/models.json" ]; then
        cat > config/models.json << 'EOF'
{
  "models": [
    {
      "id": "ollama-llama2",
      "name": "Ollama Llama2 (本地免费)",
      "type": "ollama",
      "api_base": "http://localhost:11434/v1",
      "api_key": "not-needed",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "active"
    },
    {
      "id": "gpt-4",
      "name": "GPT-4 (需要API密钥)",
      "type": "openai",
      "api_base": "https://api.openai.com/v1/",
      "api_key": "your-openai-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    },
    {
      "id": "claude-3",
      "name": "Claude 3 (需要API密钥)",
      "type": "anthropic",
      "api_base": "https://api.anthropic.com/v1",
      "api_key": "your-anthropic-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    },
    {
      "id": "custom-api",
      "name": "自定义API (配置你的API)",
      "type": "custom",
      "api_base": "https://your-api-endpoint.com/v1",
      "api_key": "your-custom-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    }
  ]
}
EOF
        print_message "success" "模型配置已创建 / Model configuration created"
        print_message "info" "默认启用Ollama本地模型，其他模型需配置API密钥"
    fi
    
    # 创建config.json
    if [ ! -f "config/config.json" ]; then
        cat > config/config.json << 'EOF'
{
  "features": {
    "smart_routing": {
      "enabled": false
    }
  }
}
EOF
    fi
}

# 查找可用端口 - 全平台兼容版本
find_available_port() {
    local port=5000
    local max_port=5010
    
    debug_log "开始查找可用端口 (环境: $OS_TYPE)..."
    
    while [ $port -le $max_port ]; do
        local port_available=false
        
        # 优先使用Python方法（最可靠，跨平台）
        if command -v python3 >/dev/null 2>&1; then
            if python3 -c "import socket; s=socket.socket(); result=s.connect_ex(('127.0.0.1',$port)); s.close(); exit(0 if result != 0 else 1)" 2>/dev/null; then
                port_available=true
                debug_log "使用Python方法检测端口 $port 可用"
            fi
        # macOS专用方法
        elif [ "$IS_MACOS" = true ]; then
            if command -v lsof >/dev/null 2>&1; then
                if ! lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
                    port_available=true
                    [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] 使用lsof方法检测端口 $port${NC}" >&2
                fi
            fi
        # Linux通用方法（包括WSL和纯Linux）
        elif [ "$IS_LINUX" = true ]; then
            if command -v ss >/dev/null 2>&1; then
                if ! timeout 2 ss -tln 2>/dev/null | grep -q ":$port "; then
                    port_available=true
                    [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] 使用ss方法检测端口 $port${NC}" >&2
                fi
            elif command -v netstat >/dev/null 2>&1; then
                if ! timeout 2 netstat -tln 2>/dev/null | grep -q ":$port "; then
                    port_available=true
                    [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] 使用netstat方法检测端口 $port${NC}" >&2
                fi
            else
                # 最后的尝试 - bash内建方法
                if ! timeout 1 bash -c "echo > /dev/tcp/127.0.0.1/$port" 2>/dev/null; then
                    port_available=true
                    [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] 使用bash方法检测端口 $port${NC}" >&2
                fi
            fi
        else
            # 未知系统的默认方法
            if ! (echo > /dev/tcp/127.0.0.1/$port) >/dev/null 2>&1; then
                port_available=true
            fi
        fi
        
        if [ "$port_available" = true ]; then
            debug_log "找到可用端口: $port"
            echo $port
            return 0
        fi
        
        debug_log "端口 $port 被占用"
        port=$((port + 1))
    done
    
    error_handler $LINENO "No available port found" 1
    return 1
}

# 系统健康检查
health_check() {
    print_message "header" "系统健康检查 / System Health Check"
    
    local score=0
    local max_score=5
    
    # 检查虚拟环境
    if [ -d "venv_py310" ] || [ -d "venv" ]; then
        ((score++))
        print_message "success" "虚拟环境 / Virtual environment: OK"
    else
        print_message "error" "虚拟环境 / Virtual environment: Missing"
    fi
    
    # 检查配置文件
    if [ -f ".env" ]; then
        ((score++))
        print_message "success" "配置文件 / Configuration: OK"
    else
        print_message "error" "配置文件 / Configuration: Missing"
    fi
    
    # 检查目录
    if [ -d "logs" ] && [ -d "cache" ] && [ -d "output" ]; then
        ((score++))
        print_message "success" "目录结构 / Directory structure: OK"
    else
        print_message "warning" "目录结构 / Directory structure: Incomplete"
    fi
    
    # 检查依赖
    if pip show flask &> /dev/null; then
        ((score++))
        print_message "success" "核心依赖 / Core dependencies: OK"
    else
        print_message "error" "核心依赖 / Core dependencies: Missing"
    fi
    
    # 检查端口
    if find_available_port &> /dev/null; then
        ((score++))
        print_message "success" "端口可用 / Port available: OK"
    fi
    
    echo ""
    print_message "info" "健康评分 / Health Score: $score/$max_score"
    
    if [ $score -eq $max_score ]; then
        print_message "success" "系统状态完美 / System is perfect!"
    elif [ $score -ge 3 ]; then
        print_message "warning" "系统基本就绪 / System mostly ready"
    else
        print_message "error" "系统需要初始化 / System needs initialization"
    fi
    echo ""
}

# 启动服务
start_server() {
    print_message "header" "启动服务 / Starting Service"
    
    # 查找可用端口
    local PORT=$(find_available_port)
    if [ -z "$PORT" ]; then
        exit 1
    fi
    
    export PORT
    
    # 清除代理环境变量
    unset http_proxy
    unset https_proxy
    unset HTTP_PROXY
    unset HTTPS_PROXY
    
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✓ 系统启动成功！${NC}"
    echo -e "访问地址: ${BLUE}http://localhost:${PORT}${NC}"
    echo -e "停止服务: ${YELLOW}Ctrl+C${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    # 自动打开浏览器 (macOS)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sleep 2 && open "http://localhost:${PORT}" &
    fi
    
    # 启动Flask应用
    cd backend && python app.py
}

# 设置信号处理 - 修复：不在EXIT时执行cleanup
trap 'error_handler $LINENO "$BASH_COMMAND" $?' ERR
trap interrupt_handler INT TERM

# 主函数
main() {
    # 初始化日志系统
    mkdir -p logs
    
    if [ "$IS_DEBUG" = true ]; then
        debug_log "=== 调试模式已启用 ==="
        debug_log "日志文件: $DEBUG_LOG"
        debug_log "错误日志: $ERROR_LOG"
        # 将所有调试输出重定向到日志
        exec 2> >(tee -a "$DEBUG_LOG" >&2)
        set -x  # 显示执行的命令
    fi
    
    debug_log "进入main函数"
    info_log "QueryGPT Setup v${SCRIPT_VERSION} 开始运行"
    
    print_banner
    
    # 检查是否在项目根目录
    if [ ! -f "backend/app.py" ]; then
        error_handler $LINENO "Not in project root directory - backend/app.py not found" 1
        exit 1
    fi
    debug_log "项目根目录检查通过"
    
    # 环境检测和修复
    debug_log "开始环境检测和修复阶段"
    detect_environment
    fix_line_endings
    
    # 完整的设置流程（不启动服务）
    debug_log "开始主设置流程"
    check_first_run
    check_python
    setup_venv
    install_dependencies
    create_directories
    setup_env
    health_check
    
    # 显示完成信息
    success_log "环境配置完成！Environment setup completed!"
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✓ 环境配置完成！${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    success_log "所有依赖已安装 / All dependencies installed"
    print_message "success" "所有依赖已安装 / All dependencies installed"
    success_log "配置文件已生成 / Configuration files created"
    print_message "success" "配置文件已生成 / Configuration files created"
    success_log "虚拟环境已就绪 / Virtual environment ready"
    print_message "success" "虚拟环境已就绪 / Virtual environment ready"
    
    # 环境特定提示
    if [ "$IS_WSL" = true ]; then
        echo ""
        print_message "info" "WSL提示: 如遇到性能问题，建议将项目移至Linux文件系统"
        print_message "info" "WSL Tip: For better performance, move to Linux filesystem"
    elif [ "$IS_NATIVE_LINUX" = true ]; then
        echo ""
        print_message "success" "纯Linux环境已优化 / Native Linux environment optimized"
    elif [ "$IS_MACOS" = true ]; then
        echo ""
        print_message "info" "macOS环境已配置 / macOS environment configured"
    fi
    
    echo ""
    info_log "请运行以下命令启动服务: ./start.sh"
    print_message "info" "请运行以下命令启动服务："
    print_message "info" "Please run the following command to start:"
    echo ""
    echo -e "    ${CYAN}./start.sh${NC}"
    echo ""
    
    # 清理和退出
    debug_log "setup.sh 正常完成"
    cleanup_normal
}

# 处理命令行参数 - 添加调试模式检测
if [ "$1" = "--debug" ] || [ "$DEBUG" = "true" ]; then
    IS_DEBUG=true
    echo -e "${YELLOW}[INFO] 调试模式已启用 - Debug mode enabled${NC}"
fi

case "${1:-}" in
    --help|-h)
        echo "QueryGPT Setup v${SCRIPT_VERSION} - 环境配置脚本 (全平台兼容)"
        echo "用法: ./setup.sh [选项]"
        echo ""
        echo "选项:"
        echo "  无参数              执行环境配置（不启动服务）"
        echo "  --debug             启用调试模式，详细日志保存到 logs/setup_debug.log"
        echo "  --fix-line-endings  修复所有脚本文件的行结束符"
        echo "  --diagnose          运行环境诊断工具"
        echo "  --version           显示版本信息"
        echo "  --help, -h          显示帮助信息"
        echo ""
        echo "支持环境: WSL, Ubuntu, Debian, CentOS, macOS 等"
        echo "配置完成后，请运行 ./start.sh 启动服务"
        echo "错误日志位置: logs/setup_error_*.log"
        echo "调试日志位置: logs/setup_debug_*.log (仅调试模式)"
        echo ""
        exit 0
        ;;
    --version)
        echo "QueryGPT Setup"
        echo "版本: ${SCRIPT_VERSION}"
        echo "日期: ${SCRIPT_DATE}"
        exit 0
        ;;
    --fix-line-endings)
        detect_environment
        fix_line_endings
        success_log "文件格式修复完成"
        echo -e "${GREEN}✓ 文件格式修复完成${NC}"
        exit 0
        ;;
    --diagnose)
        if [ -f "diagnostic.sh" ]; then
            chmod +x diagnostic.sh
            exec ./diagnostic.sh
        else
            echo -e "${RED}诊断工具不存在，请确保 diagnostic.sh 文件存在${NC}"
            exit 1
        fi
        ;;
    --debug)
        IS_DEBUG=true
        main
        ;;
    *)
        main
        ;;
esac