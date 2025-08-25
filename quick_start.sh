#!/bin/bash

# 快速启动脚本 - 跨平台版本
# Quick Start Script - Cross-platform version

set -e

# 颜色定义 / Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}QueryGPT - Quick Start${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 检测运行环境 / Detect environment
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

ENV_TYPE=$(detect_environment)
echo -e "${BLUE}[INFO]${NC} 运行环境 / Environment: $ENV_TYPE"

# 激活虚拟环境 / Activate virtual environment
if [ -d "venv_py310" ]; then
    echo -e "${BLUE}[INFO]${NC} 激活Python虚拟环境... / Activating Python virtual environment..."
    source venv_py310/bin/activate
elif [ -d "venv" ]; then
    echo -e "${BLUE}[INFO]${NC} 激活Python虚拟环境... / Activating Python virtual environment..."
    source venv/bin/activate
else
    echo -e "${YELLOW}[WARNING]${NC} 虚拟环境不存在 / Virtual environment not found"
    echo "         请先运行 / Please run: ./setup.sh"
    exit 1
fi

# 清除代理环境变量 / Clear proxy environment variables
unset http_proxy
unset https_proxy
unset HTTP_PROXY
unset HTTPS_PROXY

# 查找可用端口的跨平台方法 / Cross-platform port detection
find_available_port() {
    local port=$1
    local max_port=$2
    
    while [ $port -le $max_port ]; do
        # 跨平台端口检测
        if [[ "$ENV_TYPE" == "WSL" ]] || [[ "$ENV_TYPE" == "Linux" ]]; then
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
        elif [[ "$ENV_TYPE" == "macOS" ]]; then
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
        
        echo -e "${YELLOW}[INFO]${NC} 端口 $port 已被占用，尝试 / Port $port occupied, trying $((port+1))..."
        port=$((port + 1))
    done
    
    return 1
}

# 查找可用端口 / Find available port
PORT=$(find_available_port 5000 5010)
if [ -z "$PORT" ]; then
    echo -e "${RED}[ERROR]${NC} 无法找到可用端口 / No available port found"
    exit 1
fi

# 导出端口环境变量 / Export port environment variable
export PORT

echo -e "${GREEN}[SUCCESS]${NC} 使用端口 / Using port: $PORT"

# 创建必要目录 / Create necessary directories
mkdir -p output cache config logs

# 检查配置文件 / Check configuration files
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo -e "${YELLOW}[INFO]${NC} 创建配置文件 / Creating configuration file from template..."
        cp .env.example .env
    else
        echo -e "${RED}[ERROR]${NC} 配置文件不存在 / Configuration file not found"
        echo "         请运行 / Please run: ./setup.sh"
        exit 1
    fi
fi

if [ ! -f "config/config.json" ]; then
    if [ -f "config/config.example.json" ]; then
        echo -e "${YELLOW}[INFO]${NC} 创建配置文件 / Creating config.json from template..."
        cp config/config.example.json config/config.json
    fi
fi

if [ ! -f "config/models.json" ]; then
    if [ -f "config/models.example.json" ]; then
        echo -e "${YELLOW}[INFO]${NC} 创建模型配置 / Creating models.json from template..."
        cp config/models.example.json config/models.json
    fi
fi

echo ""
echo -e "${GREEN}✓ 启动中... / Starting...${NC}"
echo -e "访问 / Visit: ${BLUE}http://localhost:${PORT}${NC}"
echo -e "停止 / Stop: ${YELLOW}Ctrl+C${NC}"
echo ""

# 自动打开浏览器（根据环境）/ Auto-open browser (environment-specific)
if [[ "$ENV_TYPE" == "macOS" ]]; then
    sleep 2 && open "http://localhost:${PORT}" &
elif [[ "$ENV_TYPE" == "WSL" ]]; then
    # WSL: 使用 Windows 的浏览器
    if command -v cmd.exe >/dev/null 2>&1; then
        sleep 2 && cmd.exe /c start "http://localhost:${PORT}" 2>/dev/null &
    elif command -v wslview >/dev/null 2>&1; then
        sleep 2 && wslview "http://localhost:${PORT}" &
    fi
elif [[ "$ENV_TYPE" == "Linux" ]]; then
    # Linux: 尝试 xdg-open
    if command -v xdg-open >/dev/null 2>&1; then
        sleep 2 && xdg-open "http://localhost:${PORT}" &
    fi
fi

# 启动Flask应用 / Start Flask application
cd backend && python app.py