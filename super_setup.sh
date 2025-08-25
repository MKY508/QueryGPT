#!/bin/bash

# QueryGPT 超级安装启动脚本 - 一键配置并运行
# Super Setup & Start Script - One-click Setup and Run
# Version: 3.0.0

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# 全局变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PYTHON_CMD=""
VENV_DIR="venv_py310"
PORT=5000

# 打印带颜色的消息
print_msg() {
    local type=$1
    local msg=$2
    case $type in
        "success") echo -e "${GREEN}✓${NC} $msg" ;;
        "error") echo -e "${RED}✗${NC} $msg" ;;
        "warning") echo -e "${YELLOW}⚠${NC} $msg" ;;
        "info") echo -e "${BLUE}ℹ${NC} $msg" ;;
        "header") echo -e "\n${BOLD}${CYAN}$msg${NC}" ;;
    esac
}

# 打印横幅
print_banner() {
    clear
    echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}     ${BOLD}QueryGPT Super Setup v3.0.0${NC}                      ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}     一键安装配置并启动 / One-Click Setup & Run        ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# 检查并安装Python
check_python() {
    print_msg "header" "步骤 1/6: 检查 Python 环境"
    
    # 优先使用 Python 3.10
    if command -v python3.10 &> /dev/null; then
        PYTHON_CMD="python3.10"
        print_msg "success" "找到 Python 3.10"
    elif command -v python3 &> /dev/null; then
        PYTHON_CMD="python3"
        version=$(python3 -V 2>&1 | grep -Po '\d+\.\d+')
        print_msg "info" "找到 Python $version"
    else
        print_msg "error" "未找到 Python 3，请先安装 Python"
        exit 1
    fi
}

# 创建虚拟环境
setup_venv() {
    print_msg "header" "步骤 2/6: 配置虚拟环境"
    
    if [ -d "$VENV_DIR" ]; then
        print_msg "info" "虚拟环境已存在，跳过创建"
    else
        print_msg "info" "创建虚拟环境..."
        $PYTHON_CMD -m venv "$VENV_DIR"
        print_msg "success" "虚拟环境创建成功"
    fi
    
    # 激活虚拟环境
    source "$VENV_DIR/bin/activate"
    
    # 升级 pip
    pip install --upgrade pip --quiet
    print_msg "success" "pip 已升级到最新版本"
}

# 安装依赖
install_dependencies() {
    print_msg "header" "步骤 3/6: 安装项目依赖"
    
    if [ ! -f "requirements.txt" ]; then
        print_msg "warning" "requirements.txt 不存在，创建默认依赖文件"
        cat > requirements.txt << 'EOF'
Flask==2.3.3
flask-cors==4.0.0
pymysql==1.1.0
python-dotenv==1.0.0
openai==1.3.0
litellm==1.0.0
open-interpreter==0.4.3
pandas==2.0.3
numpy==1.24.3
matplotlib==3.7.2
seaborn==0.12.2
plotly==5.15.0
EOF
    fi
    
    print_msg "info" "安装依赖包..."
    pip install -r requirements.txt --quiet
    print_msg "success" "所有依赖安装完成"
}

# 创建目录结构
create_directories() {
    print_msg "header" "步骤 4/6: 创建项目目录"
    
    mkdir -p logs cache output backend/data config backup
    print_msg "success" "目录结构创建完成"
}

# 配置环境变量
setup_env() {
    print_msg "header" "步骤 5/6: 配置环境变量"
    
    # 如果.env不存在，创建默认配置
    if [ ! -f ".env" ]; then
        print_msg "info" "创建默认配置文件..."
        cat > .env << 'EOF'
# API配置 - 使用你提供的密钥
API_KEY=sk-It6GYaJHoajzLt1i7f3463Ae8223491cA81bF258B55a4529
API_BASE_URL=https://api.vveai.com/v1/
DEFAULT_MODEL=gpt-4.1

# 数据库配置
DB_HOST=localhost
DB_PORT=9030
DB_USER=root
DB_PASSWORD=root
DB_DATABASE=demo

# 日志配置
LOG_LEVEL=INFO
LOG_FILE=logs/app.log
LOG_MAX_SIZE=10485760
LOG_BACKUP_COUNT=5

# 缓存配置
CACHE_TTL=3600
CACHE_MAX_SIZE=104857600
OUTPUT_DIR=output
CACHE_DIR=cache

# 开发模式
DEBUG=false
TESTING=false
EOF
        print_msg "success" "配置文件已创建并预设API密钥"
    else
        print_msg "info" "使用现有配置文件"
    fi
    
    # 创建模型配置
    if [ ! -f "config/models.json" ]; then
        print_msg "info" "创建模型配置文件..."
        cat > config/models.json << 'EOF'
{
  "models": [
    {
      "id": "gpt-4.1",
      "name": "GPT-4.1",
      "type": "openai",
      "api_base": "https://api.vveai.com/v1/",
      "api_key": "sk-It6GYaJHoajzLt1i7f3463Ae8223491cA81bF258B55a4529",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "active"
    },
    {
      "id": "claude-sonnet-4",
      "name": "Claude Sonnet 4",
      "type": "anthropic",
      "api_base": "https://api.vveai.com/v1/",
      "api_key": "sk-It6GYaJHoajzLt1i7f3463Ae8223491cA81bF258B55a4529",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "active"
    },
    {
      "id": "deepseek-r1",
      "name": "DeepSeek R1",
      "type": "deepseek",
      "api_base": "https://api.vveai.com/v1/",
      "api_key": "sk-It6GYaJHoajzLt1i7f3463Ae8223491cA81bF258B55a4529",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "active"
    },
    {
      "id": "qwen-flagship",
      "name": "Qwen 旗舰模型",
      "type": "qwen",
      "api_base": "https://api.vveai.com/v1/",
      "api_key": "sk-It6GYaJHoajzLt1i7f3463Ae8223491cA81bF258B55a4529",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "active"
    }
  ]
}
EOF
        print_msg "success" "模型配置文件已创建"
    fi
    
    # 创建config.json
    if [ ! -f "config/config.json" ]; then
        cat > config/config.json << 'EOF'
{
  "features": {
    "smart_routing": {
      "enabled": false
    }
  }
}
EOF
        print_msg "success" "功能配置文件已创建"
    fi
}

# 查找可用端口
find_available_port() {
    PORT=5000
    while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
        print_msg "info" "端口 $PORT 已被占用，尝试 $((PORT+1))..."
        PORT=$((PORT + 1))
        if [ $PORT -gt 5010 ]; then
            print_msg "error" "无法找到可用端口"
            exit 1
        fi
    done
    export PORT
    print_msg "success" "使用端口: $PORT"
}

# 启动应用
start_app() {
    print_msg "header" "步骤 6/6: 启动应用"
    
    # 查找可用端口
    find_available_port
    
    # 加载环境变量
    if [ -f ".env" ]; then
        export $(cat .env | grep -v '^#' | xargs)
    fi
    
    # 清除代理环境变量
    unset http_proxy
    unset https_proxy
    unset HTTP_PROXY
    unset HTTPS_PROXY
    
    echo ""
    print_msg "success" "初始化完成！应用启动中..."
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "访问地址: ${BLUE}http://localhost:${PORT}${NC}"
    echo -e "停止服务: ${YELLOW}Ctrl+C${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    # 自动打开浏览器 (macOS)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sleep 2 && open "http://localhost:${PORT}" &
    fi
    
    # 启动 Flask 应用
    cd backend && python app.py
}

# 快速启动模式（跳过安装步骤）
quick_start() {
    print_banner
    print_msg "info" "快速启动模式"
    
    # 激活虚拟环境
    if [ -d "$VENV_DIR" ]; then
        source "$VENV_DIR/bin/activate"
    elif [ -d "venv" ]; then
        source "venv/bin/activate"
    else
        print_msg "error" "未找到虚拟环境，请先运行完整安装"
        exit 1
    fi
    
    # 直接启动
    find_available_port
    
    # 加载环境变量
    if [ -f ".env" ]; then
        export $(cat .env | grep -v '^#' | xargs)
    fi
    
    # 清除代理
    unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
    
    echo ""
    echo -e "${GREEN}✓ 快速启动中...${NC}"
    echo -e "访问: ${BLUE}http://localhost:${PORT}${NC}"
    echo -e "停止: ${YELLOW}Ctrl+C${NC}"
    echo ""
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sleep 1 && open "http://localhost:${PORT}" &
    fi
    
    cd backend && python app.py
}

# 主函数
main() {
    case "${1:-}" in
        --quick|-q)
            quick_start
            ;;
        --help|-h)
            echo "QueryGPT 超级安装启动脚本"
            echo "用法: ./super_setup.sh [选项]"
            echo ""
            echo "选项:"
            echo "  无参数        完整安装并启动"
            echo "  --quick, -q   快速启动（跳过安装）"
            echo "  --help, -h    显示帮助"
            echo ""
            exit 0
            ;;
        *)
            print_banner
            check_python
            setup_venv
            install_dependencies
            create_directories
            setup_env
            start_app
            ;;
    esac
}

# 错误处理
trap 'echo -e "\n${RED}错误：脚本执行失败${NC}"; exit 1' ERR

# 退出时清理
trap 'if [ -n "$VIRTUAL_ENV" ]; then deactivate 2>/dev/null; fi' EXIT

# 运行主函数
main "$@"