#!/bin/bash

# Windows x86 快速测试脚本
# Quick test script for Windows x86 WSL

echo "========================================="
echo "Windows x86 WSL 快速测试"
echo "========================================="
echo ""

# 颜色定义
GREEN='\e[32m'
RED='\e[31m'
YELLOW='\e[33m'
NC='\e[0m'

# 1. 环境检测
echo "1. 环境检测..."
ARCH=$(uname -m)
if [[ "$ARCH" == "x86_64" ]] || [[ "$ARCH" == "amd64" ]]; then
    echo -e "   ${GREEN}✓ x86_64 架构确认${NC}"
else
    echo -e "   ${YELLOW}⚠ 架构: $ARCH (非 x86_64)${NC}"
fi

if grep -qi microsoft /proc/version 2>/dev/null; then
    echo -e "   ${GREEN}✓ Windows WSL 环境确认${NC}"
    
    # 获取 Windows 版本
    if command -v cmd.exe >/dev/null 2>&1; then
        win_ver=$(cmd.exe /c ver 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        echo "   Windows 版本: $win_ver"
    fi
else
    echo -e "   ${YELLOW}⚠ 非 WSL 环境${NC}"
fi

# 2. Python 环境测试
echo ""
echo "2. Python 环境测试..."

# 检查 Python
if command -v python3 >/dev/null 2>&1; then
    py_version=$(python3 --version 2>&1)
    echo -e "   ${GREEN}✓ $py_version${NC}"
    
    # 检查是否是 3.10.x
    if echo "$py_version" | grep -q "3\.10\."; then
        echo -e "   ${GREEN}✓ 版本符合要求 (3.10.x)${NC}"
    else
        echo -e "   ${YELLOW}⚠ OpenInterpreter 需要 3.10.x${NC}"
    fi
else
    echo -e "   ${RED}✗ Python3 未安装${NC}"
    exit 1
fi

# 3. 虚拟环境测试
echo ""
echo "3. 虚拟环境测试..."

if [ -d "venv_py310" ] || [ -d "venv" ]; then
    echo -e "   ${GREEN}✓ 虚拟环境存在${NC}"
    
    # 激活虚拟环境
    if [ -d "venv_py310" ]; then
        source venv_py310/bin/activate
    else
        source venv/bin/activate
    fi
    
    echo -e "   ${GREEN}✓ 虚拟环境已激活${NC}"
else
    echo -e "   ${RED}✗ 虚拟环境不存在${NC}"
    echo "   请运行: python3 -m venv venv_py310"
fi

# 4. 运行 Python 验证脚本
echo ""
echo "4. 库兼容性测试..."

if [ -f "verify_libs.py" ]; then
    python verify_libs.py
else
    # 简单的内联测试
    python3 -c "
import sys
print(f'   Python 路径: {sys.executable}')
print(f'   Python 版本: {sys.version.split()[0]}')

# 测试关键库
libs = ['flask', 'numpy', 'pandas', 'pymysql']
for lib in libs:
    try:
        __import__(lib)
        print(f'   ✓ {lib} 可导入')
    except ImportError:
        print(f'   ✗ {lib} 未安装')
"
fi

# 5. 网络端口测试
echo ""
echo "5. 端口检测测试..."

# 测试端口检测命令
if command -v ss >/dev/null 2>&1; then
    echo -e "   ${GREEN}✓ ss 命令可用${NC}"
elif command -v netstat >/dev/null 2>&1; then
    echo -e "   ${GREEN}✓ netstat 命令可用${NC}"
else
    echo -e "   ${YELLOW}⚠ 端口检测工具缺失${NC}"
    echo "   安装: sudo apt-get install net-tools"
fi

# 测试端口 5000
PORT=5000
if command -v netstat >/dev/null 2>&1; then
    if netstat -tln 2>/dev/null | grep -q ":$PORT "; then
        echo -e "   ${YELLOW}⚠ 端口 $PORT 已被占用${NC}"
    else
        echo -e "   ${GREEN}✓ 端口 $PORT 可用${NC}"
    fi
fi

# 6. 配置文件测试
echo ""
echo "6. 配置文件检查..."

configs=(".env" "config/config.json" "config/models.json")
for config in "${configs[@]}"; do
    if [ -f "$config" ]; then
        echo -e "   ${GREEN}✓ $config 存在${NC}"
    else
        echo -e "   ${YELLOW}⚠ $config 不存在${NC}"
        
        # 检查模板
        if [ -f "${config}.example" ]; then
            echo "     可以复制: cp ${config}.example $config"
        fi
    fi
done

# 7. 启动测试
echo ""
echo "7. 快速启动测试..."

# 测试是否可以启动 Flask
echo -e "   测试 Flask 导入..."
python3 -c "
try:
    from flask import Flask
    app = Flask(__name__)
    print('   ✓ Flask 可以创建应用')
except Exception as e:
    print(f'   ✗ Flask 错误: {e}')
"

# 8. 浏览器测试
echo ""
echo "8. 浏览器打开测试..."

if command -v cmd.exe >/dev/null 2>&1; then
    echo -e "   ${GREEN}✓ 可以调用 Windows 命令${NC}"
    echo "   命令: cmd.exe /c start http://localhost:5000"
elif command -v wslview >/dev/null 2>&1; then
    echo -e "   ${GREEN}✓ wslview 可用${NC}"
    echo "   命令: wslview http://localhost:5000"
else
    echo -e "   ${YELLOW}⚠ 需要手动打开浏览器${NC}"
fi

# 总结
echo ""
echo "========================================="
echo "测试总结"
echo "========================================="

echo ""
echo "✅ 关于库的兼容性:"
echo "   • 所有 Python 库的 API 在 x86 和 ARM 上完全相同"
echo "   • 用法没有任何区别，代码可以直接运行"
echo "   • 唯一的区别是底层二进制实现"
echo ""
echo "✅ Windows x86 WSL 优势:"
echo "   • 所有库都有预编译的 wheel 包"
echo "   • 安装速度快（不需要编译）"
echo "   • 兼容性最好"
echo ""

# 给出建议
echo "推荐启动命令:"
echo "   1. ./start_windows.sh  (Windows 专用)"
echo "   2. ./quick_start.sh    (通用版本)"
echo ""
echo "如果遇到问题:"
echo "   1. 确保换行符正确: dos2unix *.sh"
echo "   2. 添加执行权限: chmod +x *.sh"
echo "   3. 运行诊断: ./diagnose.sh"
echo "========================================="