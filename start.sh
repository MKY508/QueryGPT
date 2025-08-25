#!/bin/bash

# 智能启动脚本 - 自动检测平台并选择最佳启动方式
# Smart Start Script - Auto-detect platform and choose best method

echo "========================================="
echo "   QueryGPT 智能启动器"
echo "========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 检测系统和架构
detect_system() {
    local os_type=""
    local arch_type=""
    local is_wsl=false
    
    # 检测操作系统
    if [[ "$OSTYPE" == "darwin"* ]]; then
        os_type="macOS"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        os_type="Linux"
    else
        os_type="Unknown"
    fi
    
    # 检测 WSL
    if grep -qi microsoft /proc/version 2>/dev/null; then
        is_wsl=true
        os_type="Windows WSL"
    fi
    
    # 检测架构
    arch_type=$(uname -m)
    
    # 检测 Apple Silicon
    if [[ "$os_type" == "macOS" ]] && [[ "$arch_type" == "arm64" ]]; then
        if sysctl -n machdep.cpu.brand_string 2>/dev/null | grep -q "Apple"; then
            arch_type="Apple Silicon"
        fi
    fi
    
    echo -e "${CYAN}检测到的系统信息：${NC}"
    echo -e "  操作系统: ${GREEN}$os_type${NC}"
    echo -e "  架构: ${GREEN}$arch_type${NC}"
    echo ""
    
    # 返回检测结果
    echo "$os_type|$arch_type|$is_wsl"
}

# 主程序
main() {
    # 获取系统信息
    system_info=$(detect_system)
    IFS='|' read -r os_type arch_type is_wsl <<< "$system_info"
    
    # 检查是否首次运行
    first_run=false
    if [ ! -d "venv_py310" ] && [ ! -d "venv" ]; then
        first_run=true
        echo -e "${YELLOW}⚠ 检测到首次运行${NC}"
        echo ""
    fi
    
    # 根据系统选择启动脚本
    echo -e "${CYAN}推荐的启动方式：${NC}"
    echo ""
    
    if [[ "$os_type" == "Windows WSL" ]]; then
        # Windows WSL
        echo -e "${GREEN}➜ Windows WSL 用户${NC}"
        
        if [ "$first_run" = true ]; then
            echo "  首次运行，需要初始化环境..."
            echo ""
            echo "  请执行以下步骤："
            echo -e "  1. 修复脚本格式: ${YELLOW}dos2unix *.sh${NC}"
            echo -e "  2. 添加执行权限: ${YELLOW}chmod +x *.sh${NC}"
            echo -e "  3. 运行安装: ${YELLOW}./start_windows.sh${NC}"
        else
            echo "  正在启动..."
            echo -e "  执行: ${GREEN}./start_windows.sh${NC}"
            echo ""
            exec ./start_windows.sh
        fi
        
    elif [[ "$os_type" == "macOS" ]]; then
        # macOS
        if [[ "$arch_type" == "Apple Silicon" ]]; then
            echo -e "${GREEN}➜ Apple Silicon Mac (M1/M2/M3)${NC}"
            
            if [ "$first_run" = true ]; then
                echo "  首次运行，需要安装依赖..."
                echo -e "  执行: ${YELLOW}./setup_arm.sh${NC}"
                echo "  ⚠️ ARM 编译可能需要 10-30 分钟"
            else
                echo "  正在启动..."
                echo -e "  执行: ${GREEN}./quick_start.sh${NC}"
                echo ""
                exec ./quick_start.sh
            fi
        else
            echo -e "${GREEN}➜ Intel Mac${NC}"
            
            if [ "$first_run" = true ]; then
                echo "  首次运行，需要安装依赖..."
                echo -e "  执行: ${YELLOW}./setup.sh${NC}"
                echo "  预计 3-10 分钟"
            else
                echo "  正在启动..."
                echo -e "  执行: ${GREEN}./quick_start.sh${NC}"
                echo ""
                exec ./quick_start.sh
            fi
        fi
        
    elif [[ "$os_type" == "Linux" ]]; then
        # Linux
        if [[ "$arch_type" == "aarch64" ]] || [[ "$arch_type" == "arm64" ]]; then
            echo -e "${GREEN}➜ ARM Linux（树莓派等）${NC}"
            
            if [ "$first_run" = true ]; then
                echo "  首次运行，需要安装依赖..."
                echo -e "  执行: ${YELLOW}./setup_arm.sh${NC}"
                echo "  ⚠️ ARM 编译可能需要 10-30 分钟"
            else
                echo "  正在启动..."
                echo -e "  执行: ${GREEN}./quick_start.sh${NC}"
                echo ""
                exec ./quick_start.sh
            fi
        else
            echo -e "${GREEN}➜ Linux x86_64${NC}"
            
            if [ "$first_run" = true ]; then
                echo "  首次运行，需要安装依赖..."
                echo -e "  执行: ${YELLOW}./setup.sh${NC}"
                echo "  预计 3-10 分钟"
            else
                echo "  正在启动..."
                echo -e "  执行: ${GREEN}./quick_start.sh${NC}"
                echo ""
                exec ./quick_start.sh
            fi
        fi
        
    else
        # 未知系统
        echo -e "${YELLOW}⚠ 无法识别的系统${NC}"
        echo ""
        echo "请手动选择："
        echo "  1. Windows WSL: ./start_windows.sh"
        echo "  2. macOS/Linux x86: ./setup.sh 或 ./quick_start.sh"
        echo "  3. ARM (M1/树莓派): ./setup_arm.sh 或 ./quick_start.sh"
        echo ""
        echo "运行诊断工具获取更多信息："
        echo "  ./diagnose.sh"
    fi
    
    echo ""
    echo "========================================="
    echo "其他有用的工具："
    echo "  ./check_arch.sh   - 检查架构兼容性"
    echo "  ./diagnose.sh     - 环境诊断"
    echo "  ./test_windows.sh - Windows 测试"
    echo "========================================="
}

# 运行主程序
main