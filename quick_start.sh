#!/bin/bash

# 快速启动脚本 / Quick Start Script

set -e

# 颜色定义 / Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}QueryGPT - Quick Start${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 激活虚拟环境 / Activate virtual environment
if [ -d "venv_py310" ]; then
    echo -e "${BLUE}[INFO]${NC} 激活Python虚拟环境... / Activating Python virtual environment..."
    source venv_py310/bin/activate
else
    echo -e "${YELLOW}[WARNING]${NC} 虚拟环境不存在 / Virtual environment not found"
    echo "         请先运行 / Please run: ./start.sh"
    exit 1
fi

# 清除代理环境变量 / Clear proxy environment variables
unset http_proxy
unset https_proxy
unset HTTP_PROXY
unset HTTPS_PROXY

# 查找可用端口 / Find available port (简化版 / simplified)
PORT=5000
while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
    echo -e "${YELLOW}[INFO]${NC} 端口 $PORT 已被占用，尝试 / Port $PORT occupied, trying $((PORT+1))..."
    PORT=$((PORT + 1))
    if [ $PORT -gt 5010 ]; then
        echo -e "${RED}[ERROR]${NC} 无法找到可用端口 / No available port found"
        exit 1
    fi
done

# 导出端口环境变量 / Export port environment variable
export PORT

echo -e "${GREEN}[SUCCESS]${NC} 使用端口 / Using port: $PORT"

# 创建必要目录 / Create necessary directories
mkdir -p output cache config

echo ""
echo -e "${GREEN}✓ 启动中... / Starting...${NC}"
echo -e "访问 / Visit: ${BLUE}http://localhost:${PORT}${NC}"
echo -e "停止 / Stop: ${YELLOW}Ctrl+C${NC}"
echo ""

# 自动打开浏览器 / Auto-open browser (macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    sleep 2 && open "http://localhost:${PORT}" &
fi

# 启动Flask应用 / Start Flask application
cd backend && python app.py