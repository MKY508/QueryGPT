#!/bin/bash

# QueryGPT 智能启动脚本 v1.5 - 正式版本
# Smart Start Script v1.5 - Stable Release
# 支持 WSL/Linux/macOS 环境

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'

# 全局变量
IS_DEBUG=false
PYTHON_BIN=""
LOG_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ERROR_LOG="logs/start_error_${LOG_TIMESTAMP}.log"
DEBUG_LOG="logs/start_debug_${LOG_TIMESTAMP}.log"

# 三层环境检测变量
IS_LINUX=false       # Linux大类（包括WSL和纯Linux）
IS_WSL=false        # WSL子类
IS_MACOS=false      # macOS
IS_NATIVE_LINUX=false  # 纯Linux（非WSL）
OS_TYPE="Unknown"   # 操作系统类型描述

# 版本信息
SCRIPT_VERSION="1.5"
SCRIPT_DATE="2025-11-04"

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
    
    # 停止后台进程
    if [ -n "$FLASK_PID" ]; then
        debug_log "停止Flask进程: $FLASK_PID"
        kill $FLASK_PID 2>/dev/null || true
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
    echo -e "${YELLOW}[INFO] 用户中断了服务启动${NC}" >&2
    
    # 记录中断信息
    mkdir -p logs
    {
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 用户中断服务启动"
        echo "中断位置: ${BASH_LINENO[0]}"
        echo "当前函数: ${FUNCNAME[1]:-main}"
    } >> "$ERROR_LOG"
    
    cleanup_on_error
    exit 1
}

# 设置信号处理 - 不在EXIT时执行cleanup
trap 'error_handler $LINENO "$BASH_COMMAND" $?' ERR
trap interrupt_handler INT TERM

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        QueryGPT 智能启动器 v${SCRIPT_VERSION}        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 检测运行环境 - 三层检测系统
detect_environment() {
    debug_log "开始环境检测..."
    info_log "正在检测运行环境..."
    
    # 第一层：检测大类操作系统
    if [[ "$OSTYPE" == "darwin"* ]]; then
        IS_MACOS=true
        IS_LINUX=false
        OS_TYPE="macOS"
        info_log "检测到 macOS 环境"
        
    elif [[ "$OSTYPE" == "linux-gnu"* ]] || [ -f /proc/version ]; then
        IS_LINUX=true
        IS_MACOS=false
        
        # 第二层：检测是否为WSL
        if grep -qi microsoft /proc/version 2>/dev/null; then
            IS_WSL=true
            IS_NATIVE_LINUX=false
            OS_TYPE="WSL"
            info_log "检测到 WSL 环境"
            
            # WSL：如果在Windows文件系统，提示用户
            CURRENT_DIR=$(pwd)
            if [[ "$CURRENT_DIR" == /mnt/* ]]; then
                echo -e "${YELLOW}[警告] 在Windows文件系统运行，性能较差${NC}" >&2
                
                # 检查Linux文件系统是否有安装
                if [ -d "$HOME/QueryGPT-github" ]; then
                    echo -e "${GREEN}[提示] 检测到Linux文件系统安装:${NC}" >&2
                    echo -e "${GREEN}       cd ~/QueryGPT-github && ./start.sh${NC}" >&2
                    echo ""
                    read -t 3 -p "是否切换到Linux文件系统？[Y/n] " -n 1 -r || REPLY="Y"
                    echo ""
                    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                        cd ~/QueryGPT-github
                        exec ./start.sh
                    fi
                fi
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
            
            info_log "检测到纯 Linux 环境: $OS_TYPE"
        fi
        
        # Linux环境下（包括WSL和纯Linux）修复文件格式
        for file in setup.sh start.sh diagnostic.sh; do
            if [ -f "$file" ] && file "$file" 2>/dev/null | grep -q "CRLF"; then
                sed -i 's/\r$//' "$file" 2>/dev/null || true
            fi
        done
        chmod +x *.sh 2>/dev/null || true
    else
        OS_TYPE="Unknown"
        warning_log "未知的操作系统类型: $OSTYPE"
    fi
    
    # 调试模式输出
    debug_log "环境检测结果: IS_LINUX=$IS_LINUX, IS_WSL=$IS_WSL, IS_MACOS=$IS_MACOS, IS_NATIVE_LINUX=$IS_NATIVE_LINUX, OS_TYPE=$OS_TYPE"
    
    echo "$OS_TYPE"
}


# 查找可用端口 - 全平台兼容版
find_available_port() {
    local start_port=${1:-5000}
    local max_port=${2:-5100}  # 扩大搜索范围到100个端口
    
    # 确定环境类型用于调试输出
    local env_desc="Unknown"
    if [ "$IS_MACOS" = true ]; then
        env_desc="macOS"
    elif [ "$IS_WSL" = true ]; then
        env_desc="WSL"
    elif [ "$IS_NATIVE_LINUX" = true ]; then
        env_desc="Linux"
    fi
    
    debug_log "查找可用端口 (环境: $env_desc)..."
    
    # 静默模式，只在找到端口时输出
    local port=$start_port
    
    while [ $port -le $max_port ]; do
        local port_available=false
        
        # 优先使用Python方法（最可靠，跨平台）
        local python_for_port="${PYTHON_BIN:-${PYTHON_CMD:-python3}}"
        if ! command -v "$python_for_port" >/dev/null 2>&1; then
            python_for_port="python"
        fi
        if command -v "$python_for_port" >/dev/null 2>&1; then
            if "$python_for_port" -c "import socket, sys; s=socket.socket(); r=s.connect_ex(('127.0.0.1', $port)); s.close(); sys.exit(0 if r != 0 else 1)" 2>/dev/null; then
                port_available=true
                debug_log "Python方法检测端口 $port 可用"
            fi
        # macOS专用方法
        elif [ "$IS_MACOS" = true ]; then
            if command -v lsof >/dev/null 2>&1; then
                if ! lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
                    port_available=true
                    debug_log "lsof方法检测端口 $port 可用"
                fi
            fi
        # Linux通用方法（包括WSL和纯Linux）
        elif [ "$IS_LINUX" = true ]; then
            if command -v ss >/dev/null 2>&1; then
                local ss_output=""
                if command -v timeout >/dev/null 2>&1; then
                    ss_output=$(timeout 1 ss -tln 2>/dev/null || true)
                else
                    ss_output=$(ss -tln 2>/dev/null || true)
                fi
                if ! echo "$ss_output" | grep -q ":$port "; then
                    port_available=true
                    debug_log "ss方法检测端口 $port 可用"
                fi
            elif command -v netstat >/dev/null 2>&1; then
                local netstat_output=""
                if command -v timeout >/dev/null 2>&1; then
                    netstat_output=$(timeout 1 netstat -tln 2>/dev/null || true)
                else
                    netstat_output=$(netstat -tln 2>/dev/null || true)
                fi
                if ! echo "$netstat_output" | grep -q ":$port "; then
                    port_available=true
                    debug_log "netstat方法检测端口 $port 可用"
                fi
            else
                # 使用/dev/tcp测试
                if command -v timeout >/dev/null 2>&1; then
                    if ! timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" 2>/dev/null; then
                        port_available=true
                        debug_log "bash方法检测端口 $port 可用"
                    fi
                else
                    if ! bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" 2>/dev/null; then
                        port_available=true
                        debug_log "bash方法检测端口 $port 可用"
                    fi
                fi
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
    
    # 如果前100个端口都占用，使用随机端口
    local random_port=$((RANDOM % 10000 + 20000))
    echo $random_port
    return 0
}

resolve_activate_path() {
    local venv_dir="$1"
    if [ -f "$venv_dir/bin/activate" ]; then
        echo "$venv_dir/bin/activate"
    elif [ -f "$venv_dir/Scripts/activate" ]; then
        echo "$venv_dir/Scripts/activate"
    else
        echo ""
    fi
}

# 快速启动函数
quick_start() {
    local env_type=$1
    
    # 根据env_type参数设置全局变量（修复环境检测问题）
    case "$env_type" in
        "macOS")
            IS_MACOS=true
            IS_LINUX=false
            IS_WSL=false
            IS_NATIVE_LINUX=false
            ;;
        "WSL")
            IS_WSL=true
            IS_LINUX=true
            IS_MACOS=false
            IS_NATIVE_LINUX=false
            ;;
        *Linux*|Ubuntu*|Debian*|CentOS*)
            IS_NATIVE_LINUX=true
            IS_LINUX=true
            IS_WSL=false
            IS_MACOS=false
            ;;
        *)
            error_handler $LINENO "Unknown environment type: $env_type" 1
            exit 1
            ;;
    esac
    
    success_log "检测到已安装环境"
    echo -e "${GREEN}✓ 检测到已安装环境${NC}"
    info_log "运行环境: $env_type"
    echo -e "${BLUE}[INFO]${NC} 运行环境: $env_type"
    info_log "版本: ${SCRIPT_VERSION} (${SCRIPT_DATE})"
    echo -e "${BLUE}[INFO]${NC} 版本: ${SCRIPT_VERSION} (${SCRIPT_DATE})"
    
    # 查找虚拟环境（优先当前目录，其次home目录）
    VENV_FOUND=false
    local venv_candidates=("venv_py310" "venv" "$HOME/venv_py310" "$HOME/venv")

    for candidate in "${venv_candidates[@]}"; do
        if [ "$VENV_FOUND" = true ]; then
            break
        fi
        if [ -d "$candidate" ]; then
            local activate_path
            activate_path=$(resolve_activate_path "$candidate")
            if [ -n "$activate_path" ]; then
                if [[ "$candidate" == "$HOME"* ]]; then
                    echo -e "${BLUE}[INFO]${NC} 使用home目录虚拟环境..."
                    info_log "使用home目录虚拟环境: $candidate"
                else
                    echo -e "${BLUE}[INFO]${NC} 使用当前目录虚拟环境..."
                    info_log "使用当前目录虚拟环境: $candidate"
                fi
                debug_log "激活虚拟环境: $activate_path"
                # shellcheck disable=SC1090
                source "$activate_path"
                VENV_FOUND=true
            fi
        fi
    done
    
    if [ "$VENV_FOUND" = false ]; then
        warning_log "未找到虚拟环境"
        echo -e "${YELLOW}[WARNING]${NC} 未找到虚拟环境"
        echo "         请先运行: ./setup.sh"
        error_handler $LINENO "Virtual environment not found" 1
        exit 1
    fi
    
    # 验证激活是否成功
    if [ -z "$VIRTUAL_ENV" ]; then
        error_handler $LINENO "Failed to activate virtual environment" 1
        exit 1
    fi
    
    PYTHON_BIN="$VIRTUAL_ENV/bin/python"
    if [ ! -x "$PYTHON_BIN" ]; then
        if [ -x "$VIRTUAL_ENV/Scripts/python" ]; then
            PYTHON_BIN="$VIRTUAL_ENV/Scripts/python"
        elif [ -x "$VIRTUAL_ENV/Scripts/python.exe" ]; then
            PYTHON_BIN="$VIRTUAL_ENV/Scripts/python.exe"
        fi
    fi
    local python_exec="$PYTHON_BIN"
    if [ -z "$python_exec" ]; then
        python_exec="$(command -v python3 2>/dev/null || command -v python 2>/dev/null)"
    fi

    debug_log "Python路径: $python_exec"
    debug_log "VIRTUAL_ENV: $VIRTUAL_ENV"
    success_log "虚拟环境激活成功: $VIRTUAL_ENV"
    
    # 清除代理环境变量
    unset http_proxy
    unset https_proxy
    unset HTTP_PROXY
    unset HTTPS_PROXY
    
    # 自动查找可用端口（静默且快速）
    info_log "自动查找可用端口..."
    echo -e "${BLUE}[INFO]${NC} 自动查找可用端口..."
    debug_log "开始查找端口 5000-5100"
    PORT=$(find_available_port 5000 5100)  # 使用新的三层检测系统
    
    # 总是能找到端口（最坏情况使用随机高位端口）
    debug_log "获得端口: $PORT"
    
    # 导出端口环境变量
    export PORT
    success_log "使用端口: $PORT"
    echo -e "${GREEN}[SUCCESS]${NC} 使用端口: $PORT"
    debug_log "导出 PORT=$PORT"
    
    # 创建必要目录
    mkdir -p output cache config logs backend/config backend/output
    
    # 检查配置文件
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            echo -e "${YELLOW}[INFO]${NC} 创建配置文件..."
            cp .env.example .env
        else
            echo -e "${RED}[ERROR]${NC} 配置文件不存在"
            echo "         请运行: ./setup.sh"
            exit 1
        fi
    fi
    
    if [ ! -f "config/config.json" ]; then
        if [ -f "config/config.example.json" ]; then
            echo -e "${YELLOW}[INFO]${NC} 创建 config.json..."
            cp config/config.example.json config/config.json
        fi
    fi
    
    if [ ! -f "config/models.json" ]; then
        if [ -f "config/models.example.json" ]; then
            echo -e "${YELLOW}[INFO]${NC} 创建 models.json..."
            cp config/models.example.json config/models.json
        fi
    fi

    if [ -f "config/config.json" ] && [ ! -f "backend/config/config.json" ]; then
        cp "config/config.json" "backend/config/config.json"
        debug_log "已复制 config/config.json 到 backend/config"
    fi
    if [ -f "config/models.json" ] && [ ! -f "backend/config/models.json" ]; then
        cp "config/models.json" "backend/config/models.json"
        debug_log "已复制 config/models.json 到 backend/config"
    fi
    
    echo ""
    echo -e "${GREEN}✓ 启动中...${NC}"
    echo -e "${YELLOW}⚠ 首次启动可能需要5-10秒，请耐心等待${NC}"
    echo ""
    
    # 等待服务可用的函数
    wait_for_service() {
        local max_attempts=30
        local attempt=0
        local url="http://localhost:${PORT}/api/health"
        
        echo -n "正在启动服务"
        while [ $attempt -lt $max_attempts ]; do
            # 检查健康端点
            if curl -s "$url" > /dev/null 2>&1; then
                echo -e "\n${GREEN}✅ 服务已就绪！${NC}"
                return 0
            fi
            
            # 显示进度点
            echo -n "."
            sleep 1
            attempt=$((attempt + 1))
            
            # 每10秒显示一次提示
            if [ $((attempt % 10)) -eq 0 ]; then
                echo -e "\n${BLUE}[INFO]${NC} 初始化中，请稍候..."
                echo -n "正在启动服务"
            fi
        done
        
        echo -e "\n${RED}❌ 服务启动超时${NC}"
        return 1
    }
    
    # 打开浏览器的函数 - WSL优化版
    open_browser() {
        echo -e "${GREEN}➜ 正在打开浏览器...${NC}"
        echo -e "访问: ${BLUE}http://localhost:${PORT}${NC}"
        
        if [ "$IS_WSL" = true ]; then
            # WSL特殊处理：获取Windows访问地址
            local wsl_ip=$(hostname -I | cut -d' ' -f1)
            echo -e "WSL访问: ${BLUE}http://${wsl_ip}:${PORT}${NC} (从Windows访问)"
        fi
        
        echo -e "停止: ${YELLOW}Ctrl+C${NC}"
        
        if [ "$IS_MACOS" = true ]; then
            open "http://localhost:${PORT}" 2>/dev/null &
        elif [ "$IS_WSL" = true ]; then
            # WSL: 多种方法尝试打开Windows浏览器
            if command -v wslview >/dev/null 2>&1; then
                wslview "http://localhost:${PORT}" 2>/dev/null &
            elif command -v cmd.exe >/dev/null 2>&1; then
                cmd.exe /c start "http://localhost:${PORT}" 2>/dev/null &
            elif command -v powershell.exe >/dev/null 2>&1; then
                powershell.exe -Command "Start-Process 'http://localhost:${PORT}'" 2>/dev/null &
            elif command -v explorer.exe >/dev/null 2>&1; then
                explorer.exe "http://localhost:${PORT}" 2>/dev/null &
            else
                echo -e "${YELLOW}[INFO] 无法自动打开浏览器，请手动访问上述URL${NC}"
            fi
        elif [ "$IS_NATIVE_LINUX" = true ]; then
            # 纯Linux: 尝试 xdg-open
            if command -v xdg-open >/dev/null 2>&1; then
                xdg-open "http://localhost:${PORT}" 2>/dev/null &
            else
                echo -e "${YELLOW}[INFO] 请手动打开浏览器访问上述URL${NC}"
            fi
        fi
    }
    
    # 检查backend目录是否存在
    if [ ! -d "backend" ] || [ ! -f "backend/app.py" ]; then
        echo -e "${RED}[ERROR]${NC} backend目录不存在于当前位置"
        echo -e "${YELLOW}当前目录: $(pwd)${NC}"
        
        # 提示正确的运行位置
        if [ -d "$HOME/QueryGPT-github/backend" ]; then
            echo -e "${GREEN}请运行:${NC}"
            echo -e "  cd ~/QueryGPT-github"
            echo -e "  ./start.sh"
        elif [ -d "/mnt/d/QueryGPT-main/backend" ]; then
            echo -e "${GREEN}或从源目录运行:${NC}"
            echo -e "  cd /mnt/d/QueryGPT-main"
            echo -e "  ./start.sh"
        fi
        exit 1
    fi
    
    # 根据环境选择启动方式
    if [ "$IS_WSL" = true ]; then
        echo -e "${CYAN}[INFO] WSL环境启动${NC}"
        
        echo -e "${GREEN}启动服务...${NC}"
        echo -e "${YELLOW}按 Ctrl+C 停止服务${NC}"
        
        # WSL环境：后台启动Flask，然后等待服务可用
        cd backend && "$python_exec" app.py &
        FLASK_PID=$!
        
        # 等待服务可用
        if wait_for_service; then
            open_browser
        else
            echo -e "${YELLOW}请手动访问: http://localhost:${PORT}${NC}"
        fi
        
        # 等待Flask进程（前台等待，使得Ctrl+C可以正常工作）
        wait $FLASK_PID
    elif [ "$IS_NATIVE_LINUX" = true ]; then
        echo -e "${CYAN}[INFO] 纯Linux环境启动${NC}"
        
        # 纯Linux环境：可以使用后台模式
        cd backend && "$python_exec" app.py &
        FLASK_PID=$!
        
        # 等待服务可用
        if wait_for_service; then
            open_browser
        else
            echo -e "${YELLOW}请手动访问: http://localhost:${PORT}${NC}"
        fi
        
        # 等待Flask进程
        wait $FLASK_PID
    elif [ "$IS_MACOS" = true ]; then
        echo -e "${CYAN}[INFO] macOS环境启动${NC}"
        
        # macOS环境：使用后台模式
        cd backend && "$python_exec" app.py &
        FLASK_PID=$!
        
        # 等待服务可用
        if wait_for_service; then
            open_browser
        else
            echo -e "${YELLOW}请手动访问: http://localhost:${PORT}${NC}"
        fi
        
        # 等待Flask进程
        wait $FLASK_PID
    else
        echo -e "${RED}[ERROR] 未知的环境类型${NC}"
        exit 1
    fi
}

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
    info_log "QueryGPT Start v${SCRIPT_VERSION} 开始运行"
    
    # 检测运行环境
    debug_log "开始检测运行环境"
    local env_type=$(detect_environment)
    
    # 检测是否首次运行（没有虚拟环境）
    debug_log "检查虚拟环境是否存在"
    if [ ! -d "venv_py310" ] && [ ! -d "venv" ]; then
        warning_log "首次运行检测 - 未找到虚拟环境"
        echo -e "${YELLOW}⚠ 首次运行检测${NC}"
        echo ""
        
        # 检测系统架构
        local is_arm=false
        local arch=$(uname -m)
        
        # 输出环境信息
        if [ "$IS_WSL" = true ]; then
            success_log "Windows WSL 环境检测成功"
            echo -e "${GREEN}✓ Windows WSL 环境${NC}"
        elif [ "$IS_NATIVE_LINUX" = true ]; then
            success_log "纯 Linux 环境检测成功 ($OS_TYPE)"
            echo -e "${GREEN}✓ 纯 Linux 环境 ($OS_TYPE)${NC}"
        elif [ "$IS_MACOS" = true ]; then
            success_log "macOS 环境检测成功"
            echo -e "${GREEN}✓ macOS 环境${NC}"
            
            # WSL 自动修复
            echo -e "${BLUE}自动修复脚本格式...${NC}"
            for script in *.sh; do
                if [ -f "$script" ]; then
                    sed -i 's/\r$//' "$script" 2>/dev/null || true
                fi
            done
            chmod +x *.sh 2>/dev/null || true
        fi
        
        # 检测架构
        if [[ "$arch" == "arm64" ]] || [[ "$arch" == "aarch64" ]]; then
            is_arm=true
            echo -e "${GREEN}✓ ARM 架构检测${NC}"
        fi
        
        echo ""
        echo -e "${BLUE}═══════════════════════════════════════${NC}"
        echo -e "${YELLOW}首次安装需要 5-30 分钟，请耐心等待${NC}"
        echo -e "${BLUE}═══════════════════════════════════════${NC}"
        echo ""
        
        # 根据系统选择安装脚本
        if [ "$is_arm" = true ] && [ -f "setup_arm.sh" ]; then
            info_log "执行 ARM 安装脚本..."
            echo -e "${GREEN}➜ 执行 ARM 安装脚本...${NC}"
            debug_log "转移到 setup_arm.sh"
            cleanup_normal
            exec ./setup_arm.sh
        elif [ -f "setup.sh" ]; then
            info_log "执行标准安装脚本..."
            echo -e "${GREEN}➜ 执行标准安装脚本...${NC}"
            debug_log "转移到 setup.sh"
            cleanup_normal
            exec ./setup.sh
        else
            error_handler $LINENO "Setup script not found" 1
            exit 1
        fi
    else
        # 环境已存在，执行快速启动
        debug_log "环境已存在，执行快速启动"
        quick_start "$env_type"
        cleanup_normal
    fi
}

# 处理命令行参数 - 添加调试模式检测
if [ "$1" = "--debug" ] || [ "$DEBUG" = "true" ]; then
    IS_DEBUG=true
    echo -e "${YELLOW}[INFO] 调试模式已启用 - Debug mode enabled${NC}"
fi

case "${1:-}" in
    --help|-h)
        echo "QueryGPT Start v${SCRIPT_VERSION} - 智能启动脚本"
        echo "用法: ./start.sh [选项]"
        echo ""
        echo "选项:"
        echo "  无参数        自动检测并启动服务"
        echo "  --debug       启用调试模式，详细日志保存到 logs/start_debug.log"
        echo "  --diagnose    运行环境诊断"
        echo "  --version     显示版本信息"
        echo "  --help, -h    显示帮助信息"
        echo ""
        echo "支持环境: WSL, Ubuntu, Debian, CentOS, macOS 等"
        echo "错误日志位置: logs/start_error_*.log"
        echo "调试日志位置: logs/start_debug_*.log (仅调试模式)"
        echo ""
        exit 0
        ;;
    --version)
        echo "QueryGPT Start"
        echo "版本: ${SCRIPT_VERSION}"
        echo "日期: ${SCRIPT_DATE}"
        exit 0
        ;;
    --debug)
        IS_DEBUG=true
        main
        ;;
    --diagnose)
        if [ -f "diagnostic.sh" ]; then
            info_log "启动诊断工具"
            chmod +x diagnostic.sh
            cleanup_normal
            exec ./diagnostic.sh
        else
            echo -e "${RED}诊断工具不存在，请确保 diagnostic.sh 文件存在${NC}"
            error_handler $LINENO "diagnostic.sh not found" 1
            exit 1
        fi
        ;;
    *)
        main
        ;;
esac