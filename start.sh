#!/bin/bash

# QueryGPT 启动脚本
# 自动环境配置和服务启动

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的信息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示启动横幅
show_banner() {
    echo -e "${BLUE}QueryGPT v1.0.0-beta${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# 检查Python版本
check_python() {
    print_info "检查Python环境..."
    
    # 检查是否存在虚拟环境
    if [ ! -d "venv_py310" ]; then
        print_warning "虚拟环境不存在，正在创建..."
        
        # 尝试使用python3.10
        if command -v python3.10 &> /dev/null; then
            python3.10 -m venv venv_py310
            print_success "虚拟环境创建成功"
        else
            print_error "未找到Python 3.10，请先安装Python 3.10"
            echo "Mac用户可以使用: brew install python@3.10"
            exit 1
        fi
    fi
    
    # 激活虚拟环境
    source venv_py310/bin/activate
    
    # 验证Python版本
    PYTHON_VERSION=$(python --version 2>&1 | grep -o '3\.[0-9]*\.[0-9]*')
    if [[ ! "$PYTHON_VERSION" == 3.10.* ]]; then
        print_error "Python版本不正确: $PYTHON_VERSION (需要3.10.x)"
        exit 1
    fi
    
    print_success "Python环境检查通过: $PYTHON_VERSION"
}

# 安装或更新依赖
install_dependencies() {
    print_info "检查并安装依赖..."
    
    # 检查requirements.txt是否存在
    if [ ! -f "requirements.txt" ]; then
        print_error "requirements.txt不存在"
        exit 1
    fi
    
    # 升级pip
    print_info "升级pip..."
    pip install --upgrade pip --quiet
    
    # 检查是否需要安装依赖
    print_info "检查依赖包..."
    
    # 检查核心包是否已安装
    if ! python -c "import flask" 2>/dev/null; then
        NEED_INSTALL=true
    elif ! python -c "import interpreter" 2>/dev/null; then
        NEED_INSTALL=true
    else
        NEED_INSTALL=false
    fi
    
    if [ "$NEED_INSTALL" = true ]; then
        print_warning "检测到缺失的依赖，开始安装..."
        
        # 安装依赖
        pip install -r requirements.txt
        
        print_success "依赖安装完成"
    else
        print_success "所有依赖已安装"
    fi
}

# 查找可用端口
find_available_port() {
    local port=$1
    local max_port=$((port + 10))
    
    while [ $port -le $max_port ]; do
        if ! lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo $port
            return 0
        fi
        # 警告信息输出到stderr，不影响返回值
        print_warning "端口 $port 已被占用，尝试下一个..." >&2
        port=$((port + 1))
    done
    
    print_error "无法找到可用端口（尝试了 $1 到 $max_port）" >&2
    return 1
}

# 创建必要的目录
setup_directories() {
    print_info "创建必要的目录..."
    mkdir -p output
    mkdir -p cache
    mkdir -p backend/data
}

# 启动Flask服务器
start_server() {
    print_info "准备启动服务器..."
    
    # 查找可用端口
    DEFAULT_PORT=5000
    AVAILABLE_PORT=$(find_available_port $DEFAULT_PORT)
    
    if [ -z "$AVAILABLE_PORT" ]; then
        print_error "无法找到可用端口"
        exit 1
    fi
    
    # 导出端口环境变量
    export PORT=$AVAILABLE_PORT
    if [ "$AVAILABLE_PORT" != "$DEFAULT_PORT" ]; then
        print_info "使用备用端口: $AVAILABLE_PORT"
    fi
    
    # 清除代理环境变量（避免LiteLLM冲突）
    unset http_proxy
    unset https_proxy
    unset HTTP_PROXY
    unset HTTPS_PROXY
    
    echo ""
    echo -e "${GREEN}✓ 启动成功${NC}"
    echo -e "访问: ${BLUE}http://localhost:${PORT}${NC}"
    echo -e "停止: 按 ${YELLOW}Ctrl+C${NC}"
    echo ""
    
    # 尝试自动打开浏览器（macOS）
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sleep 2 && open "http://localhost:${PORT}" &
    fi
    
    # 启动Flask应用
    cd backend && python app.py
}

# 清理函数
cleanup() {
    echo ""
    print_info "服务器已停止"
    exit 0
}

# 捕获退出信号
trap cleanup INT TERM

# 主函数
main() {
    show_banner
    
    # 检查当前目录
    if [ ! -f "backend/app.py" ]; then
        print_error "请在项目根目录运行此脚本"
        exit 1
    fi
    
    check_python
    install_dependencies
    setup_directories
    start_server
}

# 运行主函数
main