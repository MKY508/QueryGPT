#!/bin/bash

# Electron 专用启动脚本
# 智能检测并启动后端服务

set -e

# 检查是否已有虚拟环境
if [ -d "venv_py310" ]; then
    echo "[INFO] Virtual environment exists"
    source venv_py310/bin/activate
    
    # 检查核心依赖是否已安装
    if python -c "import flask" 2>/dev/null; then
        echo "[INFO] Dependencies installed"
    else
        echo "[INFO] Installing dependencies..."
        pip install -q -r requirements.txt
    fi
else
    echo "[INFO] Setting up environment..."
    
    # 查找 Python 3.10
    if command -v python3.10 &> /dev/null; then
        PYTHON_CMD="python3.10"
    elif command -v python3 &> /dev/null; then
        PYTHON_CMD="python3"
    else
        echo "[ERROR] Python 3 not found"
        exit 1
    fi
    
    # 创建虚拟环境
    $PYTHON_CMD -m venv venv_py310
    source venv_py310/bin/activate
    
    # 安装依赖
    pip install --upgrade pip -q
    pip install -r requirements.txt
fi

# 创建必要目录
mkdir -p output cache logs backend/data

# 查找可用端口
PORT=${PORT:-5000}
while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
    PORT=$((PORT + 1))
done

export PORT

echo "[INFO] Starting on port $PORT"

# 启动应用
cd backend && python app.py