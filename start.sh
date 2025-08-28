#!/bin/bash

# QueryGPT 智能启动脚本 - 统一启动入口
# Smart Start Script - Unified launch entry point

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        QueryGPT 智能启动器             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 检测运行环境
detect_environment() {
    if grep -qi microsoft /proc/version 2>/dev/null; then
        echo "WSL"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macOS"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Linux"
    else
        echo "Unknown"
    fi
}

# 查找可用端口的跨平台方法
find_available_port() {
    local port=$1
    local max_port=$2
    local env_type=$3
    
    while [ $port -le $max_port ]; do
        # 跨平台端口检测
        if [[ "$env_type" == "WSL" ]] || [[ "$env_type" == "Linux" ]]; then
            # WSL/Linux: 使用 netstat 或 ss
            if command -v ss >/dev/null 2>&1; then
                if ! ss -tln | grep -q ":$port "; then
                    echo $port
                    return 0
                fi
            elif command -v netstat >/dev/null 2>&1; then
                if ! netstat -tln 2>/dev/null | grep -q ":$port "; then
                    echo $port
                    return 0
                fi
            else
                # 如果都没有，尝试直接连接测试
                if ! (echo > /dev/tcp/127.0.0.1/$port) >/dev/null 2>&1; then
                    echo $port
                    return 0
                fi
            fi
        elif [[ "$env_type" == "macOS" ]]; then
            # macOS: 使用 lsof
            if ! lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
                echo $port
                return 0
            fi
        else
            # 默认方法
            if ! (echo > /dev/tcp/127.0.0.1/$port) >/dev/null 2>&1; then
                echo $port
                return 0
            fi
        fi
        
        # 输出信息到 stderr，避免污染函数返回值
        echo -e "${YELLOW}[INFO]${NC} 端口 $port 已被占用，尝试 $((port+1))..." >&2
        port=$((port + 1))
    done
    
    return 1
}

# 快速启动函数
quick_start() {
    local env_type=$1
    
    echo -e "${GREEN}✓ 检测到已安装环境${NC}"
    echo -e "${BLUE}[INFO]${NC} 运行环境: $env_type"
    
    # 激活虚拟环境
    if [ -d "venv_py310" ]; then
        echo -e "${BLUE}[INFO]${NC} 激活Python虚拟环境..."
        source venv_py310/bin/activate
    elif [ -d "venv" ]; then
        echo -e "${BLUE}[INFO]${NC} 激活Python虚拟环境..."
        source venv/bin/activate
    else
        echo -e "${YELLOW}[WARNING]${NC} 虚拟环境不存在"
        echo "         请先运行: ./setup.sh"
        exit 1
    fi
    
    # 清除代理环境变量
    unset http_proxy
    unset https_proxy
    unset HTTP_PROXY
    unset HTTPS_PROXY
    
    # 查找可用端口
    PORT=$(find_available_port 5000 5010 "$env_type")
    if [ -z "$PORT" ]; then
        echo -e "${RED}[ERROR]${NC} 无法找到可用端口"
        exit 1
    fi
    
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
    
    # 打开浏览器的函数
    open_browser() {
        echo -e "${GREEN}➜ 正在打开浏览器...${NC}"
        echo -e "访问: ${BLUE}http://localhost:${PORT}${NC}"
        echo -e "停止: ${YELLOW}Ctrl+C${NC}"
        
        if [[ "$env_type" == "macOS" ]]; then
            open "http://localhost:${PORT}"
        elif [[ "$env_type" == "WSL" ]]; then
            # WSL: 使用 Windows 的浏览器
            if command -v cmd.exe >/dev/null 2>&1; then
                cmd.exe /c start "http://localhost:${PORT}" 2>/dev/null
            elif command -v wslview >/dev/null 2>&1; then
                wslview "http://localhost:${PORT}"
            fi
        elif [[ "$env_type" == "Linux" ]]; then
            # Linux: 尝试 xdg-open
            if command -v xdg-open >/dev/null 2>&1; then
                xdg-open "http://localhost:${PORT}"
            fi
        fi
    }
    
    # 在后台启动Flask应用
    cd backend && python app.py &
    FLASK_PID=$!
    
    # 等待服务可用
    if wait_for_service; then
        # 服务就绪，打开浏览器
        open_browser
    else
        # 服务启动失败或超时
        echo -e "${YELLOW}请手动访问: http://localhost:${PORT}${NC}"
        echo -e "${YELLOW}或检查日志文件了解详情${NC}"
    fi
    
    # 等待Flask进程（前台运行）
    wait $FLASK_PID
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