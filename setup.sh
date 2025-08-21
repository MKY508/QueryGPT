#!/bin/bash

# QueryGPT 初始化脚本
# 作者: MKY508

echo "================================================"
echo "  QueryGPT v1.0.0-beta 初始化脚本"
echo "================================================"
echo ""

# 检查 Python 版本
check_python() {
    if command -v python3.10 &> /dev/null; then
        echo "✓ Python 3.10 已安装"
        PYTHON_CMD="python3.10"
    elif command -v python3 &> /dev/null; then
        version=$(python3 -V 2>&1 | grep -Po '(?<=Python )\d+\.\d+')
        if [[ "$version" == "3.10" ]]; then
            echo "✓ Python 3.10 已安装"
            PYTHON_CMD="python3"
        else
            echo "⚠️  警告: 需要 Python 3.10，当前版本为 $version"
            echo "   OpenInterpreter 0.4.3 需要 Python 3.10"
            read -p "是否继续？(y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
            PYTHON_CMD="python3"
        fi
    else
        echo "❌ 错误: 未找到 Python 3"
        echo "   请先安装 Python 3.10"
        exit 1
    fi
}

# 创建虚拟环境
setup_venv() {
    if [ ! -d "venv_py310" ]; then
        echo "创建虚拟环境..."
        $PYTHON_CMD -m venv venv_py310
        echo "✓ 虚拟环境创建成功"
    else
        echo "✓ 虚拟环境已存在"
    fi
    
    # 激活虚拟环境
    source venv_py310/bin/activate
}

# 安装依赖
install_dependencies() {
    echo "安装项目依赖..."
    pip install --upgrade pip
    pip install -r requirements.txt
    echo "✓ 依赖安装完成"
}

# 创建必要的目录
create_directories() {
    echo "创建必要的目录..."
    mkdir -p logs
    mkdir -p cache
    mkdir -p output
    mkdir -p backend/data
    echo "✓ 目录创建完成"
}

# 配置 .env 文件
setup_env() {
    if [ ! -f ".env" ]; then
        echo ""
        echo "未找到 .env 文件，需要创建配置"
        echo "请选择 LLM 服务类型："
        echo "1) Ollama (本地免费)"
        echo "2) 自定义 OpenAI 兼容 API"
        echo "3) 稍后手动配置"
        
        read -p "请选择 (1-3): " choice
        
        case $choice in
            1)
                echo "配置 Ollama..."
                cat > .env << EOF
# Ollama 配置（本地免费）
API_BASE_URL=http://localhost:11434/v1
API_KEY=not_needed_for_local
DEFAULT_MODEL=llama2

# 数据库配置（请修改为您的实际配置）
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=test_db

# 日志配置
LOG_LEVEL=INFO
LOG_FILE=logs/app.log
LOG_MAX_SIZE=10485760
LOG_BACKUP_COUNT=5

# 缓存配置
CACHE_TTL=3600
CACHE_MAX_SIZE=104857600

# 输出目录
OUTPUT_DIR=output
CACHE_DIR=cache
EOF
                echo "✓ 已创建 Ollama 配置"
                echo ""
                echo "提示: 请安装并运行 Ollama:"
                echo "  brew install ollama"
                echo "  ollama run llama2"
                ;;
            2)
                echo "配置自定义 API..."
                read -p "API 地址 (例如: https://api.example.com/v1): " api_url
                read -p "API 密钥: " api_key
                read -p "模型名称 (例如: gpt-3.5-turbo): " model_name
                
                cat > .env << EOF
# 自定义 API 配置
API_BASE_URL=$api_url
API_KEY=$api_key
DEFAULT_MODEL=$model_name

# 数据库配置（请修改为您的实际配置）
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=test_db

# 日志配置
LOG_LEVEL=INFO
LOG_FILE=logs/app.log
LOG_MAX_SIZE=10485760
LOG_BACKUP_COUNT=5

# 缓存配置
CACHE_TTL=3600
CACHE_MAX_SIZE=104857600

# 输出目录
OUTPUT_DIR=output
CACHE_DIR=cache
EOF
                echo "✓ 配置已创建"
                ;;
            3)
                cp .env.example .env
                echo "✓ 已复制 .env.example 到 .env"
                echo "  请手动编辑 .env 文件配置您的环境"
                ;;
        esac
        
        echo ""
        echo "⚠️  重要: 请编辑 .env 文件中的数据库配置"
    else
        echo "✓ .env 文件已存在"
    fi
}

# 主流程
main() {
    echo "开始初始化..."
    echo ""
    
    check_python
    setup_venv
    install_dependencies
    create_directories
    setup_env
    
    echo ""
    echo "================================================"
    echo "  初始化完成！"
    echo "================================================"
    echo ""
    echo "启动服务:"
    echo "  ./start.sh"
    echo ""
    echo "或手动运行:"
    echo "  source venv_py310/bin/activate"
    echo "  python backend/app.py"
    echo ""
    echo "访问: http://localhost:5007"
    echo ""
}

# 运行主流程
main