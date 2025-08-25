#!/bin/bash

# 架构兼容性检查脚本
# Architecture Compatibility Check Script

echo "========================================="
echo "QueryGPT 架构兼容性检查"
echo "========================================="
echo ""

# 检测系统架构
ARCH=$(uname -m)
OS=$(uname -s)
echo "1. 系统信息:"
echo "   操作系统: $OS"
echo "   架构: $ARCH"

# 判断架构类型
if [[ "$ARCH" == "x86_64" ]] || [[ "$ARCH" == "amd64" ]]; then
    echo "   ✓ x86_64 架构 (Intel/AMD)"
    ARCH_TYPE="x86"
elif [[ "$ARCH" == "arm64" ]] || [[ "$ARCH" == "aarch64" ]]; then
    echo "   ✓ ARM64 架构"
    ARCH_TYPE="arm"
    
    # 检测是否是 Apple Silicon
    if [[ "$OS" == "Darwin" ]]; then
        if sysctl -n machdep.cpu.brand_string 2>/dev/null | grep -q "Apple"; then
            echo "   ✓ Apple Silicon (M1/M2/M3)"
            ARCH_TYPE="apple_silicon"
        fi
    fi
elif [[ "$ARCH" == "armv7l" ]]; then
    echo "   ⚠ ARM32 架构 (可能有兼容性问题)"
    ARCH_TYPE="arm32"
else
    echo "   ? 未知架构: $ARCH"
    ARCH_TYPE="unknown"
fi

# 检测是否在 WSL
if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "   ✓ 运行在 Windows WSL 中"
    # WSL2 on ARM (Surface Pro X, etc.)
    if [[ "$ARCH_TYPE" == "arm" ]]; then
        echo "   ⚠ 警告: WSL on ARM 可能有额外的兼容性问题"
    fi
fi

# Python 架构检查
echo ""
echo "2. Python 环境:"
if command -v python3 >/dev/null 2>&1; then
    python3 -c "
import platform
import sys
print(f'   Python 版本: {sys.version.split()[0]}')
print(f'   Python 架构: {platform.machine()}')
print(f'   Python 平台: {platform.platform()}')
"
else
    echo "   ✗ Python3 未安装"
fi

# 检查关键依赖的架构兼容性
echo ""
echo "3. 关键依赖架构兼容性:"

# NumPy (对架构敏感)
echo -n "   NumPy: "
if python3 -c "import numpy; print(f'v{numpy.__version__} ✓')" 2>/dev/null; then
    :
else
    echo "✗ 未安装或不兼容"
    if [[ "$ARCH_TYPE" == "arm" ]] || [[ "$ARCH_TYPE" == "apple_silicon" ]]; then
        echo "     提示: ARM 架构可能需要特殊安装方法"
        echo "     尝试: pip install --no-binary :all: numpy"
    fi
fi

# Pandas (依赖 NumPy)
echo -n "   Pandas: "
if python3 -c "import pandas; print(f'v{pandas.__version__} ✓')" 2>/dev/null; then
    :
else
    echo "✗ 未安装或不兼容"
fi

# OpenInterpreter (核心依赖)
echo -n "   OpenInterpreter: "
if python3 -c "import interpreter; print('✓ 已安装')" 2>/dev/null; then
    :
else
    echo "✗ 未安装"
    echo "     注意: OpenInterpreter 0.4.3 需要 Python 3.10.x"
fi

# 架构特定建议
echo ""
echo "4. 架构特定建议:"

case "$ARCH_TYPE" in
    "apple_silicon")
        echo "   Apple Silicon (M1/M2/M3) 用户:"
        echo "   • 建议使用 Miniforge 而不是官方 Python"
        echo "   • 安装: brew install miniforge"
        echo "   • 某些包可能需要 Rosetta 2"
        echo "   • 如遇问题，尝试: arch -x86_64 pip install <package>"
        ;;
    "arm")
        echo "   ARM64 Linux 用户:"
        echo "   • 某些包可能没有预编译的 wheel"
        echo "   • 可能需要从源码编译，安装时间较长"
        echo "   • 建议安装编译工具: sudo apt-get install build-essential"
        echo "   • 对于 NumPy/Pandas: pip install --no-binary :all: numpy pandas"
        ;;
    "x86")
        echo "   x86_64 架构:"
        echo "   • 大部分包都有良好支持"
        echo "   • 标准安装流程应该正常工作"
        ;;
    "arm32")
        echo "   ARM32 架构:"
        echo "   • 可能遇到严重的兼容性问题"
        echo "   • 建议使用 Docker 容器运行"
        echo "   • 或考虑升级到 64 位系统"
        ;;
esac

# 检查是否需要特殊处理
echo ""
echo "5. 安装建议:"

if [[ "$ARCH_TYPE" == "apple_silicon" ]] || [[ "$ARCH_TYPE" == "arm" ]]; then
    echo "   对于 ARM 架构，推荐安装顺序:"
    echo "   1. 先安装系统依赖:"
    if [[ "$OS" == "Darwin" ]]; then
        echo "      brew install python@3.10 openblas gfortran"
    else
        echo "      sudo apt-get install python3.10-dev libopenblas-dev gfortran"
    fi
    echo ""
    echo "   2. 创建虚拟环境:"
    echo "      python3.10 -m venv venv_py310"
    echo "      source venv_py310/bin/activate"
    echo ""
    echo "   3. 升级 pip 和安装工具:"
    echo "      pip install --upgrade pip setuptools wheel"
    echo ""
    echo "   4. 安装科学计算包 (可能需要时间):"
    echo "      pip install numpy==1.24.3"
    echo "      pip install pandas==2.0.3"
    echo ""
    echo "   5. 安装其他依赖:"
    echo "      pip install -r requirements.txt"
    echo ""
    echo "   如果安装失败，尝试:"
    echo "      pip install --no-cache-dir --no-binary :all: <package_name>"
else
    echo "   标准安装流程:"
    echo "   1. python3.10 -m venv venv_py310"
    echo "   2. source venv_py310/bin/activate"
    echo "   3. pip install -r requirements.txt"
fi

# 已知问题
echo ""
echo "6. 已知架构相关问题:"
echo "   • cryptography: ARM 上可能需要 Rust 编译器"
echo "   • numpy/pandas: ARM 上编译时间可能很长 (10-30分钟)"
echo "   • open-interpreter: 某些功能在 ARM 上可能受限"

echo ""
echo "========================================="
echo "检查完成！"
echo "========================================="