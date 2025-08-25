#!/bin/bash

# Windows WSL 专用启动脚本
# Windows WSL Specific Start Script

echo "QueryGPT - Windows WSL 启动脚本"
echo "================================"

# 简单的颜色定义（WSL 兼容）
RED='\e[31m'
GREEN='\e[32m'
YELLOW='\e[33m'
NC='\e[0m'

# 检查是否在 WSL 环境
if ! grep -qi microsoft /proc/version 2>/dev/null; then
    echo -e "${YELLOW}警告：这个脚本是为 Windows WSL 设计的${NC}"
fi

# 激活虚拟环境
if [ -d "venv_py310" ]; then
    echo "激活 Python 虚拟环境..."
    source venv_py310/bin/activate
elif [ -d "venv" ]; then
    echo "激活 Python 虚拟环境..."
    source venv/bin/activate
else
    echo -e "${RED}错误：虚拟环境不存在！${NC}"
    echo "请先运行以下命令创建虚拟环境："
    echo "  python3 -m venv venv_py310"
    echo "  source venv_py310/bin/activate"
    echo "  pip install -r requirements.txt"
    exit 1
fi

# 检查 Python 版本
python_version=$(python --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
echo "Python 版本: $python_version"

# 创建必要的目录
echo "创建必要目录..."
mkdir -p output cache config logs

# 检查并创建配置文件
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "从模板创建 .env 配置文件..."
        cp .env.example .env
        echo -e "${YELLOW}请编辑 .env 文件，填入你的 API 密钥和数据库配置${NC}"
    else
        echo -e "${RED}错误：找不到 .env.example 文件${NC}"
        exit 1
    fi
fi

if [ ! -f "config/config.json" ]; then
    if [ -f "config/config.example.json" ]; then
        cp config/config.example.json config/config.json
    fi
fi

if [ ! -f "config/models.json" ]; then
    if [ -f "config/models.example.json" ]; then
        cp config/models.example.json config/models.json
    fi
fi

# 简单的端口查找（WSL 兼容）
PORT=5000
for try_port in 5000 5001 5002 5003 5004 5005; do
    # 使用 netstat 检查端口（WSL 通常有这个命令）
    if command -v netstat >/dev/null 2>&1; then
        if ! netstat -tln 2>/dev/null | grep -q ":$try_port "; then
            PORT=$try_port
            break
        fi
    else
        # 如果没有 netstat，尝试直接连接测试
        if ! timeout 1 bash -c "echo > /dev/tcp/127.0.0.1/$try_port" 2>/dev/null; then
            PORT=$try_port
            break
        fi
    fi
done

export PORT
echo -e "${GREEN}使用端口: $PORT${NC}"

# 安装缺失的依赖（如果需要）
echo "检查依赖..."
if ! python -c "import flask" 2>/dev/null; then
    echo "安装 Flask..."
    pip install flask
fi

if ! python -c "import openai" 2>/dev/null; then
    echo "安装 OpenAI..."
    pip install openai
fi

# 清除代理（有时会影响本地连接）
unset http_proxy
unset https_proxy
unset HTTP_PROXY
unset HTTPS_PROXY

echo ""
echo -e "${GREEN}启动服务...${NC}"
echo "访问地址: http://localhost:${PORT}"
echo "按 Ctrl+C 停止服务"
echo ""

# 尝试在 Windows 中打开浏览器
if command -v cmd.exe >/dev/null 2>&1; then
    (sleep 3 && cmd.exe /c start "http://localhost:${PORT}") 2>/dev/null &
elif command -v wslview >/dev/null 2>&1; then
    (sleep 3 && wslview "http://localhost:${PORT}") &
fi

# 启动应用
cd backend && python app.py