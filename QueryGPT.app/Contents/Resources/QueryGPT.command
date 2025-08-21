#!/bin/bash

# QueryGPT 启动脚本
# 解决打包应用的依赖问题

echo "================================"
echo "  QueryGPT 智能数据分析平台"
echo "================================"
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 检查 Python 环境
if ! command -v python3.10 &> /dev/null; then
    echo "⚠️  需要 Python 3.10"
    echo "请先安装 Python 3.10："
    echo "brew install python@3.10"
    exit 1
fi

# 检查虚拟环境
if [ ! -d "venv_py310" ]; then
    echo "📦 首次运行，正在创建环境..."
    python3.10 -m venv venv_py310
    source venv_py310/bin/activate
    pip install --upgrade pip
    echo "📦 安装依赖包..."
    pip install -r requirements.txt
else
    source venv_py310/bin/activate
fi

# 检查 .env 文件
if [ ! -f ".env" ]; then
    echo "⚠️  未找到配置文件"
    echo "正在创建默认配置..."
    cat > .env << 'EOF'
# QueryGPT 配置文件
# 请根据实际情况修改

# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_DATABASE=test

# API 配置（可选）
API_BASE_URL=https://api.openai.com/v1
API_KEY=your_api_key_here
DEFAULT_MODEL=gpt-4

# 应用配置
FLASK_PORT=5000
DEBUG_MODE=false
EOF
    echo "✅ 已创建 .env 文件，请编辑后重新运行"
    echo "位置: $SCRIPT_DIR/.env"
    open .env
    exit 0
fi

# 创建必要的目录
mkdir -p output cache logs backend/data

# 查找可用端口
PORT=5000
while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; do
    echo "端口 $PORT 被占用，尝试下一个..."
    PORT=$((PORT + 1))
done

echo "✅ 使用端口: $PORT"
echo ""
echo "🚀 启动服务..."
echo "📱 浏览器将自动打开"
echo "🛑 按 Ctrl+C 停止服务"
echo ""
echo "================================"
echo ""

# 设置环境变量
export FLASK_PORT=$PORT
export FLASK_APP=backend/app.py
export PYTHONPATH=$SCRIPT_DIR:$PYTHONPATH

# 自动打开浏览器
(sleep 2 && open "http://localhost:$PORT") &

# 启动 Flask 应用
python backend/app.py