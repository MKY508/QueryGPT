#!/bin/bash

# QueryGPT 初始化脚本 / Setup Script
# 作者 / Author: MKY508

echo "================================================"
echo "  QueryGPT v1.0.0-beta"
echo "  初始化脚本 / Setup Script"
echo "================================================"
echo ""

# 检查 Python 版本 / Check Python Version
check_python() {
    if command -v python3.10 &> /dev/null; then
        echo "✓ Python 3.10 已安装 / Python 3.10 installed"
        PYTHON_CMD="python3.10"
    elif command -v python3 &> /dev/null; then
        version=$(python3 -V 2>&1 | grep -Po '(?<=Python )\d+\.\d+')
        if [[ "$version" == "3.10" ]]; then
            echo "✓ Python 3.10 已安装 / Python 3.10 installed"
            PYTHON_CMD="python3"
        else
            echo "⚠️  警告 / Warning: 需要 Python 3.10，当前版本为 / Requires Python 3.10, current version: $version"
            echo "   OpenInterpreter 0.4.3 需要 / requires Python 3.10"
            read -p "是否继续？/ Continue? (y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
            PYTHON_CMD="python3"
        fi
    else
        echo "❌ 错误 / Error: 未找到 Python 3 / Python 3 not found"
        echo "   请先安装 / Please install Python 3.10"
        exit 1
    fi
}

# 创建虚拟环境 / Create Virtual Environment
setup_venv() {
    if [ ! -d "venv_py310" ]; then
        echo "创建虚拟环境... / Creating virtual environment..."
        $PYTHON_CMD -m venv venv_py310
        echo "✓ 虚拟环境创建成功 / Virtual environment created"
    else
        echo "✓ 虚拟环境已存在 / Virtual environment exists"
    fi
    
    # 激活虚拟环境 / Activate virtual environment
    source venv_py310/bin/activate
}

# 安装依赖 / Install Dependencies
install_dependencies() {
    echo "安装项目依赖... / Installing dependencies..."
    pip install --upgrade pip
    pip install -r requirements.txt
    echo "✓ 依赖安装完成 / Dependencies installed"
}

# 创建必要的目录 / Create Necessary Directories
create_directories() {
    echo "创建必要的目录... / Creating directories..."
    mkdir -p logs
    mkdir -p cache
    mkdir -p output
    mkdir -p backend/data
    echo "✓ 目录创建完成 / Directories created"
}

# 配置 .env 文件 / Configure .env File
setup_env() {
    if [ ! -f ".env" ]; then
        echo ""
        echo "创建默认配置文件... / Creating default configuration..."
        
        # 创建 .env 文件 / Create .env file
        cat > .env << EOF
# API配置 (默认使用 GPT-4.1)
API_KEY=your-api-key-here
API_BASE_URL=https://api.openai.com/v1/
DEFAULT_MODEL=gpt-4.1

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
        echo "✓ 已创建 .env 配置文件 / .env configuration created"
        echo ""
        echo "⚠️  重要 / Important:"
        echo "   请编辑 .env 文件配置您的 API 密钥和数据库信息"
        echo "   Please edit .env file to configure your API keys and database"
    else
        echo "✓ .env 文件已存在 / .env file exists"
    fi
}

# 配置模型设置 / Configure Model Settings
setup_models() {
    if [ ! -f "config/models.json" ]; then
        echo "创建默认模型配置... / Creating default model configuration..."
        
        # 确保config目录存在 / Ensure config directory exists
        mkdir -p config
        
        # 创建models.json文件，包含5个预配置模型
        cat > config/models.json << 'EOF'
{
  "models": [
    {
      "id": "gpt-4.1",
      "name": "GPT-4.1",
      "type": "openai",
      "api_base": "https://api.openai.com/v1/",
      "api_key": "your-openai-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    },
    {
      "id": "claude-sonnet-4",
      "name": "Claude Sonnet 4",
      "type": "anthropic",
      "api_base": "https://api.anthropic.com/v1",
      "api_key": "your-anthropic-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    },
    {
      "id": "deepseek-r1",
      "name": "DeepSeek R1",
      "type": "deepseek",
      "api_base": "https://api.deepseek.com/v1",
      "api_key": "your-deepseek-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    },
    {
      "id": "ollama-local",
      "name": "Ollama (Local)",
      "type": "ollama",
      "api_base": "http://localhost:11434/v1",
      "api_key": "not_needed_for_local",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    },
    {
      "id": "custom-model",
      "name": "Custom Model",
      "type": "custom",
      "api_base": "http://localhost:8000/v1",
      "api_key": "your-custom-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    }
  ]
}
EOF
        echo "✓ 已创建默认模型配置 / Default model configuration created"
        echo ""
        echo "配置的模型 / Configured Models:"
        echo "  1. GPT-4.1 (OpenAI)"
        echo "  2. Claude Sonnet 4 (Anthropic)"
        echo "  3. DeepSeek R1 (DeepSeek)"
        echo "  4. Ollama (本地模型 / Local Model)"
        echo "  5. Custom Model (自定义 / Custom)"
        echo ""
        echo "⚠️  请在 config/models.json 中配置各模型的 API 密钥"
        echo "   Please configure API keys in config/models.json"
    else
        echo "✓ models.json 文件已存在 / models.json file exists"
    fi
}

# 主流程 / Main Process
main() {
    echo "开始初始化... / Starting initialization..."
    echo ""
    
    check_python
    setup_venv
    install_dependencies
    create_directories
    setup_env
    setup_models
    
    echo ""
    echo "================================================"
    echo "  初始化完成！/ Setup Complete!"
    echo "================================================"
    echo ""
    echo "启动服务 / Start Service:"
    echo "  ./start.sh"
    echo ""
    echo "或手动运行 / Or manually run:"
    echo "  source venv_py310/bin/activate"
    echo "  python backend/app.py"
    echo ""
    echo "访问 / Visit: http://localhost:5007"
    echo ""
}

# 运行主流程
main