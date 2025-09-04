#!/bin/bash

# QueryGPT 智能启动脚本 v3.0 - WSL兼容版
# Smart Start Script v3.0 - WSL Compatible
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

# 三层环境检测变量
IS_LINUX=false       # Linux大类（包括WSL和纯Linux）
IS_WSL=false        # WSL子类
IS_MACOS=false      # macOS
IS_NATIVE_LINUX=false  # 纯Linux（非WSL）
OS_TYPE="Unknown"   # 操作系统类型描述

# 版本信息
SCRIPT_VERSION="3.1.0"
SCRIPT_DATE="2025-09-04"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        QueryGPT 智能启动器 v${SCRIPT_VERSION}        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 检测运行环境 - 三层检测系统
detect_environment() {
    [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] 开始环境检测...${NC}" >&2
    
    # 第一层：检测大类操作系统
    if [[ "$OSTYPE" == "darwin"* ]]; then
        IS_MACOS=true
        IS_LINUX=false
        OS_TYPE="macOS"
        echo -e "${CYAN}[INFO] 检测到 macOS 环境${NC}" >&2
        
    elif [[ "$OSTYPE" == "linux-gnu"* ]] || [ -f /proc/version ]; then
        IS_LINUX=true
        IS_MACOS=false
        
        # 第二层：检测是否为WSL
        if grep -qi microsoft /proc/version 2>/dev/null; then
            IS_WSL=true
            IS_NATIVE_LINUX=false
            OS_TYPE="WSL"
            echo -e "${CYAN}[INFO] 检测到 WSL 环境${NC}" >&2
            
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
            
            echo -e "${CYAN}[INFO] 检测到纯 Linux 环境: $OS_TYPE${NC}" >&2
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
        echo -e "${YELLOW}[WARNING] 未知的操作系统类型: $OSTYPE${NC}" >&2
    fi
    
    # 调试模式输出
    if [ "$IS_DEBUG" = true ]; then
        echo -e "${CYAN}[DEBUG] 环境检测结果:${NC}" >&2
        echo -e "${CYAN}  IS_LINUX=$IS_LINUX${NC}" >&2
        echo -e "${CYAN}  IS_WSL=$IS_WSL${NC}" >&2
        echo -e "${CYAN}  IS_MACOS=$IS_MACOS${NC}" >&2
        echo -e "${CYAN}  IS_NATIVE_LINUX=$IS_NATIVE_LINUX${NC}" >&2
        echo -e "${CYAN}  OS_TYPE=$OS_TYPE${NC}" >&2
    fi
    
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
    
    [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] 查找可用端口 (环境: $env_desc)...${NC}" >&2
    
    # 静默模式，只在找到端口时输出
    local port=$start_port
    
    while [ $port -le $max_port ]; do
        local port_available=false
        
        # 优先使用Python方法（最可靠，跨平台）
        if command -v python3 >/dev/null 2>&1; then
            if python3 -c "import socket; s=socket.socket(); r=s.connect_ex(('127.0.0.1',$port)); s.close(); exit(0 if r!=0 else 1)" 2>/dev/null; then
                port_available=true
                [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] Python方法检测端口 $port 可用${NC}" >&2
            fi
        # macOS专用方法
        elif [ "$IS_MACOS" = true ]; then
            if command -v lsof >/dev/null 2>&1; then
                if ! lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
                    port_available=true
                    [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] lsof方法检测端口 $port 可用${NC}" >&2
                fi
            fi
        # Linux通用方法（包括WSL和纯Linux）
        elif [ "$IS_LINUX" = true ]; then
            if command -v ss >/dev/null 2>&1; then
                if ! timeout 1 ss -tln 2>/dev/null | grep -q ":$port "; then
                    port_available=true
                    [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] ss方法检测端口 $port 可用${NC}" >&2
                fi
            elif command -v netstat >/dev/null 2>&1; then
                if ! timeout 1 netstat -tln 2>/dev/null | grep -q ":$port "; then
                    port_available=true
                    [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] netstat方法检测端口 $port 可用${NC}" >&2
                fi
            else
                # 使用/dev/tcp测试
                if ! timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" 2>/dev/null; then
                    port_available=true
                    [ "$IS_DEBUG" = true ] && echo -e "${CYAN}[DEBUG] bash方法检测端口 $port 可用${NC}" >&2
                fi
            fi
        fi
        
        if [ "$port_available" = true ]; then
            [ "$IS_DEBUG" = true ] && echo -e "${GREEN}[DEBUG] 找到可用端口: $port${NC}" >&2
            echo $port
            return 0
        fi
        
        [ "$IS_DEBUG" = true ] && echo -e "${YELLOW}[DEBUG] 端口 $port 被占用${NC}" >&2
        port=$((port + 1))
    done
    
    # 如果前100个端口都占用，使用随机端口
    local random_port=$((RANDOM % 10000 + 20000))
    echo $random_port
    return 0
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
            echo -e "${RED}[ERROR] 未知的环境类型: $env_type${NC}"
            exit 1
            ;;
    esac
    
    echo -e "${GREEN}✓ 检测到已安装环境${NC}"
    echo -e "${BLUE}[INFO]${NC} 运行环境: $env_type"
    echo -e "${BLUE}[INFO]${NC} 版本: ${SCRIPT_VERSION} (${SCRIPT_DATE})"
    
    # 查找虚拟环境（优先当前目录，其次home目录）
    VENV_FOUND=false
    
    # 检查当前目录
    if [ -d "venv_py310" ]; then
        echo -e "${BLUE}[INFO]${NC} 使用当前目录虚拟环境..."
        source venv_py310/bin/activate
        VENV_FOUND=true
    elif [ -d "venv" ]; then
        echo -e "${BLUE}[INFO]${NC} 使用当前目录虚拟环境..."
        source venv/bin/activate
        VENV_FOUND=true
    # 检查home目录（WSL情况）
    elif [ -d "$HOME/venv_py310" ]; then
        echo -e "${BLUE}[INFO]${NC} 使用home目录虚拟环境..."
        source "$HOME/venv_py310/bin/activate"
        VENV_FOUND=true
    elif [ -d "$HOME/venv" ]; then
        echo -e "${BLUE}[INFO]${NC} 使用home目录虚拟环境..."
        source "$HOME/venv/bin/activate"
        VENV_FOUND=true
    fi
    
    if [ "$VENV_FOUND" = false ]; then
        echo -e "${YELLOW}[WARNING]${NC} 未找到虚拟环境"
        echo "         请先运行: ./setup.sh"
        exit 1
    fi
    
    # 验证激活是否成功（仅在调试模式下显示）
    if [ "$IS_DEBUG" = true ]; then
        echo -e "${CYAN}[DEBUG] Python路径: $(which python)${NC}"
        echo -e "${CYAN}[DEBUG] VIRTUAL_ENV: $VIRTUAL_ENV${NC}"
    fi
    
    # 清除代理环境变量
    unset http_proxy
    unset https_proxy
    unset HTTP_PROXY
    unset HTTPS_PROXY
    
    # 自动查找可用端口（静默且快速）
    echo -e "${BLUE}[INFO]${NC} 自动查找可用端口..."
    PORT=$(find_available_port 5000 5100)  # 使用新的三层检测系统
    
    # 总是能找到端口（最坏情况使用随机高位端口）
    
    # 导出端口环境变量
    export PORT
    echo -e "${GREEN}[SUCCESS]${NC} 使用端口: $PORT"
    
    # 创建必要目录
    mkdir -p output cache config logs
    
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
        
        # 等待服务函数移到前面定义
        wait_for_service
        open_browser
        
        echo -e "${GREEN}启动服务...${NC}"
        echo -e "${YELLOW}按 Ctrl+C 停止服务${NC}"
        
        # 直接前台运行（WSL最稳定的方式）
        cd backend
        exec python app.py
    elif [ "$IS_NATIVE_LINUX" = true ]; then
        echo -e "${CYAN}[INFO] 纯Linux环境启动${NC}"
        
        # 纯Linux环境：可以使用后台模式
        cd backend && python app.py &
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
        cd backend && python app.py &
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
    # 检测运行环境
    local env_type=$(detect_environment)
    
    # 检测是否首次运行（没有虚拟环境）
    if [ ! -d "venv_py310" ] && [ ! -d "venv" ]; then
        echo -e "${YELLOW}⚠ 首次运行检测${NC}"
        echo ""
        
        # 检测系统架构
        local is_arm=false
        local arch=$(uname -m)
        
        # 输出环境信息
        if [ "$IS_WSL" = true ]; then
            echo -e "${GREEN}✓ Windows WSL 环境${NC}"
        elif [ "$IS_NATIVE_LINUX" = true ]; then
            echo -e "${GREEN}✓ 纯 Linux 环境 ($OS_TYPE)${NC}"
        elif [ "$IS_MACOS" = true ]; then
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
            echo -e "${GREEN}➜ 执行 ARM 安装脚本...${NC}"
            exec ./setup_arm.sh
        elif [ -f "setup.sh" ]; then
            echo -e "${GREEN}➜ 执行标准安装脚本...${NC}"
            exec ./setup.sh
        else
            echo -e "${RED}错误：找不到安装脚本${NC}"
            exit 1
        fi
    else
        # 环境已存在，执行快速启动
        quick_start "$env_type"
    fi
}

# 处理命令行参数
case "${1:-}" in
    --help|-h)
        echo "QueryGPT Start v${SCRIPT_VERSION} - 智能启动脚本"
        echo "用法: ./start.sh [选项]"
        echo ""
        echo "选项:"
        echo "  无参数        自动检测并启动服务"
        echo "  --debug       启用调试模式"
        echo "  --diagnose    运行环境诊断"
        echo "  --version     显示版本信息"
        echo "  --help, -h    显示帮助信息"
        echo ""
        echo "支持环境: WSL, Ubuntu, Debian, CentOS, macOS 等"
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
            chmod +x diagnostic.sh
            exec ./diagnostic.sh
        else
            echo -e "${RED}诊断工具不存在，请确保 diagnostic.sh 文件存在${NC}"
            exit 1
        fi
        ;;
    *)
        main
        ;;
esac