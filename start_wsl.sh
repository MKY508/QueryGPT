#!/bin/bash

# QueryGPT WSL启动脚本
set -e

# 颜色
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}QueryGPT 启动器${NC}"

# 激活虚拟环境
if [ -d "venv_py310" ]; then
    source venv_py310/bin/activate
elif [ -d "venv" ]; then
    source venv/bin/activate
else
    echo -e "${RED}错误: 虚拟环境不存在${NC}"
    echo "请先运行: ./setup_wsl.sh 或 ./setup.sh"
    exit 1
fi

# 设置环境变量
export PYTHONUNBUFFERED=1
export FLASK_ENV=development

# 简单的端口查找
PORT=5000
for i in {0..100}; do
    if python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',$((PORT+i)))); s.close()" 2>/dev/null; then
        PORT=$((PORT+i))
        break
    fi
done

export PORT
echo -e "${GREEN}使用端口: $PORT${NC}"
echo -e "访问: ${BLUE}http://localhost:$PORT${NC}"
echo -e "停止: ${YELLOW}Ctrl+C${NC}"
echo ""

# WSL浏览器打开（可选）
if command -v wslview >/dev/null 2>&1; then
    (sleep 2 && wslview "http://localhost:$PORT") &
elif command -v cmd.exe >/dev/null 2>&1; then
    (sleep 2 && cmd.exe /c start "http://localhost:$PORT") &
fi

# 前台运行Flask（WSL最稳定的方式）
cd backend
exec python app.py