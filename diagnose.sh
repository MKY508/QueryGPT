#!/bin/bash

# 诊断脚本 - 检查环境配置问题
# Diagnostic Script - Check environment configuration issues

echo "========================================="
echo "QueryGPT 环境诊断工具"
echo "========================================="
echo ""

# 检测运行环境
echo "1. 检测运行环境..."
if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "   ✓ Windows WSL 环境"
    WSL_ENV=true
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "   ✓ macOS 环境"
    WSL_ENV=false
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "   ✓ Linux 环境"
    WSL_ENV=false
else
    echo "   ? 未知环境: $OSTYPE"
    WSL_ENV=false
fi

# 检查 Python
echo ""
echo "2. 检查 Python 环境..."
if command -v python3 >/dev/null 2>&1; then
    python_version=$(python3 --version 2>&1)
    echo "   ✓ Python3 已安装: $python_version"
    
    # 检查版本是否为 3.10.x
    if echo "$python_version" | grep -q "3\.10\."; then
        echo "   ✓ Python 版本正确 (3.10.x)"
    else
        echo "   ⚠ 警告: OpenInterpreter 需要 Python 3.10.x"
    fi
else
    echo "   ✗ Python3 未安装"
fi

# 检查虚拟环境
echo ""
echo "3. 检查虚拟环境..."
if [ -d "venv_py310" ]; then
    echo "   ✓ 虚拟环境 venv_py310 存在"
elif [ -d "venv" ]; then
    echo "   ✓ 虚拟环境 venv 存在"
else
    echo "   ✗ 虚拟环境不存在"
    echo "   建议运行: python3 -m venv venv_py310"
fi

# 检查配置文件
echo ""
echo "4. 检查配置文件..."
if [ -f ".env" ]; then
    echo "   ✓ .env 文件存在"
    # 检查关键配置
    if grep -q "API_KEY=sk-YOUR-API-KEY-HERE" .env; then
        echo "   ⚠ 警告: API_KEY 还是默认值，需要配置"
    fi
else
    echo "   ✗ .env 文件不存在"
    if [ -f ".env.example" ]; then
        echo "   建议运行: cp .env.example .env"
    fi
fi

if [ -f "config/config.json" ]; then
    echo "   ✓ config/config.json 存在"
else
    echo "   ✗ config/config.json 不存在"
fi

if [ -f "config/models.json" ]; then
    echo "   ✓ config/models.json 存在"
else
    echo "   ✗ config/models.json 不存在"
fi

# 检查端口工具
echo ""
echo "5. 检查端口检测工具..."
if [ "$WSL_ENV" = true ]; then
    # WSL 环境检查
    if command -v ss >/dev/null 2>&1; then
        echo "   ✓ ss 命令可用"
    elif command -v netstat >/dev/null 2>&1; then
        echo "   ✓ netstat 命令可用"
    else
        echo "   ⚠ 警告: 没有端口检测工具"
        echo "   建议安装: sudo apt-get install net-tools"
    fi
else
    # macOS/Linux 检查
    if command -v lsof >/dev/null 2>&1; then
        echo "   ✓ lsof 命令可用"
    else
        echo "   ⚠ 警告: lsof 不可用"
    fi
fi

# 检查关键 Python 包
echo ""
echo "6. 检查 Python 依赖（在虚拟环境外）..."
packages=("flask" "openai" "pymysql" "python-dotenv")
missing_packages=()

for package in "${packages[@]}"; do
    if python3 -c "import $package" 2>/dev/null; then
        echo "   ✓ $package 已安装"
    else
        echo "   ✗ $package 未安装"
        missing_packages+=($package)
    fi
done

if [ ${#missing_packages[@]} -gt 0 ]; then
    echo ""
    echo "   缺失的包可以通过以下命令安装："
    echo "   pip install ${missing_packages[*]}"
fi

# 检查文件权限
echo ""
echo "7. 检查脚本执行权限..."
scripts=("setup.sh" "quick_start.sh" "start_windows.sh")
for script in "${scripts[@]}"; do
    if [ -f "$script" ]; then
        if [ -x "$script" ]; then
            echo "   ✓ $script 有执行权限"
        else
            echo "   ✗ $script 没有执行权限"
            echo "   修复: chmod +x $script"
        fi
    fi
done

# 检查换行符格式（WSL 重要）
echo ""
echo "8. 检查脚本换行符格式..."
if [ "$WSL_ENV" = true ]; then
    for script in "${scripts[@]}"; do
        if [ -f "$script" ]; then
            if file "$script" | grep -q "CRLF"; then
                echo "   ✗ $script 使用 Windows 换行符 (CRLF)"
                echo "   修复: dos2unix $script 或 sed -i 's/\r$//' $script"
            else
                echo "   ✓ $script 使用 Unix 换行符 (LF)"
            fi
        fi
    done
fi

# 总结
echo ""
echo "========================================="
echo "诊断完成！"
echo ""
echo "推荐的启动命令:"
if [ "$WSL_ENV" = true ]; then
    echo "  ./start_windows.sh  (Windows WSL 专用)"
else
    echo "  ./quick_start.sh    (标准启动)"
fi
echo ""
echo "如果遇到问题:"
echo "1. 确保所有脚本有执行权限: chmod +x *.sh"
echo "2. 确保使用 Unix 换行符: dos2unix *.sh"
echo "3. 确保配置文件存在并正确配置"
echo "4. 确保 Python 3.10.x 已安装"
echo "========================================="