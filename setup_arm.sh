#!/bin/bash

# ARM 架构专用安装脚本
# ARM Architecture Specific Setup Script

set -e

echo "========================================="
echo "QueryGPT ARM 架构安装脚本"
echo "========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 检测架构
ARCH=$(uname -m)
OS=$(uname -s)

if [[ "$ARCH" != "arm64" ]] && [[ "$ARCH" != "aarch64" ]]; then
    echo -e "${YELLOW}警告: 此脚本专为 ARM 架构设计${NC}"
    echo "您的架构: $ARCH"
    read -p "是否继续? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 检测是否是 Apple Silicon
IS_APPLE_SILICON=false
if [[ "$OS" == "Darwin" ]] && [[ "$ARCH" == "arm64" ]]; then
    IS_APPLE_SILICON=true
    echo -e "${GREEN}✓ 检测到 Apple Silicon Mac${NC}"
fi

# 1. 安装系统依赖
echo ""
echo -e "${BLUE}步骤 1: 安装系统依赖${NC}"

if [ "$IS_APPLE_SILICON" = true ]; then
    # macOS Apple Silicon
    if command -v brew >/dev/null 2>&1; then
        echo "使用 Homebrew 安装依赖..."
        brew install python@3.10 openblas gfortran 2>/dev/null || true
    else
        echo -e "${YELLOW}请先安装 Homebrew: https://brew.sh${NC}"
        exit 1
    fi
else
    # Linux ARM
    if command -v apt-get >/dev/null 2>&1; then
        echo "使用 apt-get 安装依赖..."
        sudo apt-get update
        sudo apt-get install -y python3.10 python3.10-venv python3.10-dev \
            build-essential gfortran libopenblas-dev liblapack-dev \
            libssl-dev libffi-dev
    elif command -v yum >/dev/null 2>&1; then
        echo "使用 yum 安装依赖..."
        sudo yum install -y python3.10 python3.10-devel gcc gcc-c++ \
            gcc-gfortran openblas-devel lapack-devel
    fi
fi

# 2. 检查 Python 3.10
echo ""
echo -e "${BLUE}步骤 2: 检查 Python 3.10${NC}"

if command -v python3.10 >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Python 3.10 已安装${NC}"
    PYTHON_CMD=python3.10
elif command -v python3 >/dev/null 2>&1; then
    version=$(python3 --version | grep -oE '[0-9]+\.[0-9]+')
    if [[ "$version" == "3.10" ]]; then
        echo -e "${GREEN}✓ Python 3.10 已安装${NC}"
        PYTHON_CMD=python3
    else
        echo -e "${RED}✗ 需要 Python 3.10，当前版本: $version${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ Python 3.10 未安装${NC}"
    exit 1
fi

# 3. 创建虚拟环境
echo ""
echo -e "${BLUE}步骤 3: 创建虚拟环境${NC}"

if [ -d "venv_py310" ]; then
    echo "虚拟环境已存在，跳过创建"
else
    echo "创建虚拟环境..."
    $PYTHON_CMD -m venv venv_py310
fi

# 激活虚拟环境
source venv_py310/bin/activate

# 4. 升级 pip
echo ""
echo -e "${BLUE}步骤 4: 升级 pip 和安装工具${NC}"
pip install --upgrade pip setuptools wheel

# 5. 安装 NumPy (ARM 关键依赖)
echo ""
echo -e "${BLUE}步骤 5: 安装 NumPy (这可能需要几分钟)${NC}"

# 尝试安装预编译版本
if ! pip install numpy==1.24.3 2>/dev/null; then
    echo -e "${YELLOW}预编译版本安装失败，尝试从源码编译...${NC}"
    echo "这可能需要 10-30 分钟，请耐心等待..."
    
    # 设置编译优化
    if [ "$IS_APPLE_SILICON" = true ]; then
        export OPENBLAS_NUM_THREADS=1
        export VECLIB_MAXIMUM_THREADS=1
    fi
    
    # 从源码编译
    pip install --no-binary :all: --no-cache-dir numpy==1.24.3
fi

# 6. 安装 Pandas
echo ""
echo -e "${BLUE}步骤 6: 安装 Pandas${NC}"

if ! pip install pandas==2.0.3 2>/dev/null; then
    echo -e "${YELLOW}预编译版本安装失败，尝试从源码编译...${NC}"
    pip install --no-binary :all: --no-cache-dir pandas==2.0.3
fi

# 7. 安装 cryptography (ARM 可能需要 Rust)
echo ""
echo -e "${BLUE}步骤 7: 安装 cryptography${NC}"

if ! pip install cryptography==41.0.3 2>/dev/null; then
    echo -e "${YELLOW}需要 Rust 编译器${NC}"
    
    if ! command -v rustc >/dev/null 2>&1; then
        echo "安装 Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source $HOME/.cargo/env
    fi
    
    pip install cryptography==41.0.3
fi

# 8. 安装 OpenInterpreter
echo ""
echo -e "${BLUE}步骤 8: 安装 OpenInterpreter${NC}"

# OpenInterpreter 可能有复杂的依赖
pip install open-interpreter==0.4.3 || {
    echo -e "${YELLOW}标准安装失败，尝试逐个安装依赖...${NC}"
    
    # 安装核心依赖
    pip install litellm
    pip install tiktoken
    pip install rich
    pip install yaspin
    
    # 再次尝试
    pip install open-interpreter==0.4.3
}

# 9. 安装其余依赖
echo ""
echo -e "${BLUE}步骤 9: 安装其余依赖${NC}"

# 逐个安装以便识别问题
for package in flask==2.3.3 flask-cors==4.0.0 flasgger==0.9.7.1 pymysql==1.1.0 \
               plotly==5.17.0 pyyaml==6.0.1 aiohttp; do
    echo "安装 $package..."
    pip install $package || echo -e "${YELLOW}警告: $package 安装失败${NC}"
done

# 10. 配置文件设置
echo ""
echo -e "${BLUE}步骤 10: 配置文件设置${NC}"

# 复制配置文件
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo "已创建 .env 配置文件"
fi

if [ ! -f "config/config.json" ] && [ -f "config/config.example.json" ]; then
    cp config/config.example.json config/config.json
    echo "已创建 config.json"
fi

if [ ! -f "config/models.json" ] && [ -f "config/models.example.json" ]; then
    cp config/models.example.json config/models.json
    echo "已创建 models.json"
fi

# 11. 验证安装
echo ""
echo -e "${BLUE}步骤 11: 验证安装${NC}"

python -c "
import sys
print(f'Python: {sys.version}')

try:
    import numpy
    print(f'✓ NumPy {numpy.__version__}')
except: print('✗ NumPy')

try:
    import pandas
    print(f'✓ Pandas {pandas.__version__}')
except: print('✗ Pandas')

try:
    import flask
    print(f'✓ Flask {flask.__version__}')
except: print('✗ Flask')

try:
    import interpreter
    print('✓ OpenInterpreter')
except: print('✗ OpenInterpreter')
"

echo ""
echo "========================================="
echo -e "${GREEN}安装完成！${NC}"
echo ""
echo "下一步:"
echo "1. 编辑 .env 文件配置 API 密钥"
echo "2. 运行: ./quick_start.sh"
echo ""
echo "如遇问题:"
echo "- 运行: ./check_arch.sh"
echo "- 查看: ./diagnose.sh"
echo "========================================="