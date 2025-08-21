#!/bin/bash

# 快速启动脚本

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}QueryGPT - Quick Start${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 激活虚拟环境
if [ -d "venv_py310" ]; then
    echo -e "${BLUE}[INFO]${NC} 激活Python虚拟环境..."
    source venv_py310/bin/activate
else
    echo -e "${YELLOW}[WARNING]${NC} 虚拟环境不存在，请先运行 ./start.sh 进行完整安装"
    exit 1
fi

# 清除代理环境变量
unset http_proxy
unset https_proxy
unset HTTP_PROXY
unset HTTPS_PROXY

# 查找可用端口（简化版）
PORT=5000
while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
    echo -e "${YELLOW}[INFO]${NC} 端口 $PORT 已被占用，尝试 $((PORT+1))..."
    PORT=$((PORT + 1))
    if [ $PORT -gt 5010 ]; then
        echo -e "${RED}[ERROR]${NC} 无法找到可用端口"
        exit 1
    fi
done

# 导出端口环境变量
export PORT

echo -e "${GREEN}[SUCCESS]${NC} 使用端口: $PORT"

# 创建必要目录
mkdir -p output cache config

echo ""
echo -e "${GREEN}✓ 启动中...${NC}"
echo -e "访问: ${BLUE}http://localhost:${PORT}${NC}"
echo -e "停止: 按 ${YELLOW}Ctrl+C${NC}"
echo ""

# 自动打开浏览器（macOS）
if [[ "$OSTYPE" == "darwin"* ]]; then
    sleep 2 && open "http://localhost:${PORT}" &
fi

# 启动Flask应用
cd backend && python app.py