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
IS_WSL=false
IS_DEBUG=false
ENV_TYPE="Unknown"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        QueryGPT 智能启动器             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 检测运行环境
detect_environment() {
    if grep -qi microsoft /proc/version 2>/dev/null; then
        IS_WSL=true
        ENV_TYPE="WSL"
        echo -e "${CYAN}[INFO] 检测到WSL环境${NC}"
        
        # 修复WSL文件权限和格式
        fix_wsl_issues
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        ENV_TYPE="macOS"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        ENV_TYPE="Linux"
    else
        ENV_TYPE="Unknown"
    fi
    
    echo "$ENV_TYPE"
}

# 修复WSL问题
fix_wsl_issues() {
    # 修复行结束符
    for file in setup.sh start.sh; do
        if [ -f "$file" ] && file "$file" 2>/dev/null | grep -q "CRLF"; then
            echo -e "${YELLOW}[INFO] 修复 $file 的行结束符...${NC}"
            if command -v dos2unix &> /dev/null; then
                dos2unix "$file" 2>/dev/null
            else
                sed -i 's/\r$//' "$file" 2>/dev/null || true
            fi
        fi
    done
    
    # 确保脚本有执行权限
    chmod +x setup.sh start.sh 2>/dev/null || true
}

# 查找可用端口 - 全自动版
find_available_port() {
    local start_port=${1:-5000}
    local max_port=${2:-5100}  # 扩大搜索范围到100个端口
    local env_type=${3:-"auto"}
    
    # 自动检测环境
    if [ "$env_type" = "auto" ]; then
        if grep -q Microsoft /proc/version 2>/dev/null; then
            env_type="WSL"
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            env_type="macOS"
        else
            env_type="Linux"
        fi
    fi
    
    # 静默模式，只在找到端口时输出
    local port=$start_port
    
    while [ $port -le $max_port ]; do
        local port_available=false
        
        # 最快速的端口检测方法
        if command -v python3 >/dev/null 2>&1; then
            # Python方法最可靠且跨平台
            if python3 -c "import socket; s=socket.socket(); r=s.connect_ex(('127.0.0.1',$port)); s.close(); exit(0 if r!=0 else 1)" 2>/dev/null; then
                port_available=true
            fi
        elif [[ "$env_type" == "WSL" ]] || [[ "$env_type" == "Linux" ]]; then
            # Linux/WSL备选方案
            if command -v ss >/dev/null 2>&1; then
                if ! timeout 1 ss -tln 2>/dev/null | grep -q ":$port "; then
                    port_available=true
                fi
            else
                # 使用/dev/tcp测试
                if ! timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" 2>/dev/null; then
                    port_available=true
                fi
            fi
        elif [[ "$env_type" == "macOS" ]]; then
            # macOS: 使用 lsof
            if ! lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
                port_available=true
            fi
        fi
        
        if [ "$port_available" = true ]; then
            echo $port
            return 0
        fi
        
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
    
    echo -e "${GREEN}✓ 检测到已安装环境${NC}"
    echo -e "${BLUE}[INFO]${NC} 运行环境: $env_type"
    
    # 激活虚拟环境 - WSL特殊处理
    if [ -d "venv_py310" ]; then
        echo -e "${BLUE}[INFO]${NC} 激活Python虚拟环境 (venv_py310)..."
        if [ "$IS_WSL" = true ]; then
            # WSL: 显式设置环境变量而不仅依赖source
            export VIRTUAL_ENV="$(pwd)/venv_py310"
            export PATH="$VIRTUAL_ENV/bin:$PATH"
            # 仍然source以获取所有设置
            source venv_py310/bin/activate 2>/dev/null || true
        else
            source venv_py310/bin/activate
        fi
    elif [ -d "venv" ]; then
        echo -e "${BLUE}[INFO]${NC} 激活Python虚拟环境 (venv)..."
        if [ "$IS_WSL" = true ]; then
            export VIRTUAL_ENV="$(pwd)/venv"
            export PATH="$VIRTUAL_ENV/bin:$PATH"
            source venv/bin/activate 2>/dev/null || true
        else
            source venv/bin/activate
        fi
    else
        echo -e "${YELLOW}[WARNING]${NC} 虚拟环境不存在"
        echo "         请先运行: ./setup.sh"
        exit 1
    fi
    
    # 验证激活是否成功
    echo -e "${CYAN}[DEBUG] Python路径: $(which python)${NC}"
    echo -e "${CYAN}[DEBUG] VIRTUAL_ENV: $VIRTUAL_ENV${NC}"
    
    # 清除代理环境变量
    unset http_proxy
    unset https_proxy
    unset HTTP_PROXY
    unset HTTPS_PROXY
    
    # 自动查找可用端口（静默且快速）
    echo -e "${BLUE}[INFO]${NC} 自动查找可用端口..."
    PORT=$(find_available_port 5000 5100)  # 自动检测环境，扩大搜索范围
    
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
        
        if [[ "$env_type" == "macOS" ]]; then
            open "http://localhost:${PORT}" 2>/dev/null &
        elif [[ "$env_type" == "WSL" ]]; then
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
        elif [[ "$env_type" == "Linux" ]]; then
            # Linux: 尝试 xdg-open
            if command -v xdg-open >/dev/null 2>&1; then
                xdg-open "http://localhost:${PORT}" 2>/dev/null &
            fi
        fi
    }
    
    # WSL特殊处理：直接前台运行（最稳定）
    if [ "$IS_WSL" = true ]; then
        echo -e "${CYAN}[INFO] WSL环境检测${NC}"
        
        # 等待服务函数移到前面定义
        wait_for_service
        open_browser
        
        echo -e "${GREEN}启动服务（前台模式）...${NC}"
        echo -e "${YELLOW}按 Ctrl+C 停止服务${NC}"
        
        # 直接前台运行（WSL最稳定的方式）
        cd backend
        exec python app.py
    else
        # 非WSL环境：可以使用后台模式
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
        
        # 检测系统类型
        local is_arm=false
        local arch=$(uname -m)
        
        # 检测 WSL
        if [[ "$env_type" == "WSL" ]]; then
            echo -e "${GREEN}✓ Windows WSL 环境${NC}"
            
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

# 运行主程序
main