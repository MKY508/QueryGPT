#!/bin/bash

# QueryGPT 系统环境诊断工具 v1.0
# System Environment Diagnostic Tool v1.0
# 用于准确识别和诊断运行环境

# 不使用 set -e，改用错误处理器
# set -e  # 已移除，使用trap ERR替代

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# 版本信息
SCRIPT_VERSION="1.0.0"
SCRIPT_DATE="2025-09-04"

# 环境变量初始化
IS_LINUX=false
IS_WSL=false
IS_MACOS=false
IS_UBUNTU=false
IS_NATIVE_LINUX=false
LINUX_DISTRO=""
KERNEL_VERSION=""
ARCH_TYPE=""

# 调试模式
DEBUG_MODE=false
if [ "$1" = "--debug" ] || [ "$DEBUG" = "true" ]; then
    DEBUG_MODE=true
    echo -e "${YELLOW}[调试模式已启用]${NC}" >&2
    # 启用命令追踪
    set -x
    PS4='+(${BASH_SOURCE}:${LINENO}): ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
fi

# 错误处理函数
error_handler() {
    local line_num=$1
    local last_command="${2:-unknown}"
    local error_code="${3:-1}"
    
    echo "" >&2
    echo -e "${RED}════════════════ 错误报告 ═══════════════${NC}" >&2
    echo -e "${RED}错误位置:${NC} 第 $line_num 行" >&2
    echo -e "${RED}失败命令:${NC} $last_command" >&2
    echo -e "${RED}错误代码:${NC} $error_code" >&2
    echo -e "${RED}调用堆栈:${NC}" >&2
    local frame=0
    while caller $frame >&2; do
        frame=$((frame + 1))
    done
    echo -e "${RED}═══════════════════════════════════════════${NC}" >&2
    
    # 保存到日志文件
    mkdir -p logs
    {
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 诊断工具错误"
        echo "位置: 第 $line_num 行"
        echo "命令: $last_command"
        echo "代码: $error_code"
        echo "---"
    } >> logs/diagnostic_error.log 2>/dev/null
    
    echo -e "${YELLOW}错误日志已保存到: logs/diagnostic_error.log${NC}" >&2
    exit 1
}

# 设置错误陷阱
trap 'error_handler $LINENO "$BASH_COMMAND" $?' ERR

# 打印分隔线
print_separator() {
    echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
}

# 打印标题
print_header() {
    clear
    print_separator
    echo -e "${BOLD}${CYAN}  QueryGPT 系统环境诊断报告${NC}"
    echo -e "${CYAN}  System Environment Diagnostic Report${NC}"
    echo -e "${CYAN}  版本: ${SCRIPT_VERSION} | 日期: ${SCRIPT_DATE}${NC}"
    print_separator
    echo ""
}

# 检测操作系统类型
detect_os() {
    echo -e "${BOLD}${BLUE}[1/7] 操作系统检测 / OS Detection${NC}"
    echo ""
    
    # 检测 macOS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        IS_MACOS=true
        OS_NAME="macOS"
        OS_VERSION=$(sw_vers -productVersion 2>/dev/null || echo "Unknown")
        ARCH_TYPE=$(uname -m)
        echo -e "  ${GREEN}✓${NC} 操作系统: macOS $OS_VERSION"
        echo -e "  ${GREEN}✓${NC} 架构类型: $ARCH_TYPE"
        
    # 检测 Linux 系统
    elif [[ "$OSTYPE" == "linux-gnu"* ]] || [ -f /proc/version ]; then
        IS_LINUX=true
        KERNEL_VERSION=$(uname -r)
        ARCH_TYPE=$(uname -m)
        
        # 检测是否为 WSL
        if grep -qi microsoft /proc/version 2>/dev/null; then
            IS_WSL=true
            IS_NATIVE_LINUX=false
            OS_NAME="WSL"
            
            # 获取 WSL 版本
            if command -v wsl.exe &> /dev/null; then
                WSL_VERSION=$(wsl.exe --version 2>/dev/null | grep -i "WSL version" | awk '{print $NF}' || echo "2")
            else
                WSL_VERSION="Unknown"
            fi
            
            echo -e "  ${GREEN}✓${NC} 环境类型: Windows Subsystem for Linux (WSL)"
            echo -e "  ${GREEN}✓${NC} WSL 版本: $WSL_VERSION"
        else
            IS_WSL=false
            IS_NATIVE_LINUX=true
            OS_NAME="Native Linux"
            echo -e "  ${GREEN}✓${NC} 环境类型: 原生 Linux (非WSL)"
        fi
        
        # 检测 Linux 发行版
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            LINUX_DISTRO="$NAME"
            DISTRO_VERSION="$VERSION"
            
            # 检测是否为 Ubuntu
            if [[ "$ID" == "ubuntu" ]] || [[ "$ID_LIKE" == *"ubuntu"* ]]; then
                IS_UBUNTU=true
            fi
            
            echo -e "  ${GREEN}✓${NC} 发行版本: $LINUX_DISTRO $DISTRO_VERSION"
        else
            LINUX_DISTRO="Unknown Linux"
            echo -e "  ${YELLOW}⚠${NC} 发行版本: 未知 Linux 发行版"
        fi
        
        echo -e "  ${GREEN}✓${NC} 内核版本: $KERNEL_VERSION"
        echo -e "  ${GREEN}✓${NC} 架构类型: $ARCH_TYPE"
        
    else
        OS_NAME="Unknown"
        echo -e "  ${RED}✗${NC} 未知的操作系统类型: $OSTYPE"
    fi
    
    echo ""
}

# 检测 Python 环境
detect_python() {
    echo -e "${BOLD}${BLUE}[2/7] Python 环境检测 / Python Environment${NC}"
    echo ""
    
    # 检测 Python 3.10
    if command -v python3.10 &> /dev/null; then
        PYTHON310_VERSION=$(python3.10 -V 2>&1 | sed -n 's/Python \([0-9]\+\.[0-9]\+\.[0-9]\+\).*/\1/p' || echo "Unknown")
        PYTHON310_PATH=$(which python3.10)
        echo -e "  ${GREEN}✓${NC} Python 3.10: $PYTHON310_VERSION"
        echo -e "    路径: $PYTHON310_PATH"
    else
        echo -e "  ${YELLOW}⚠${NC} Python 3.10: 未安装"
    fi
    
    # 检测默认 Python 3
    if command -v python3 &> /dev/null; then
        PYTHON3_VERSION=$(python3 -V 2>&1 | sed -n 's/Python \([0-9]\+\.[0-9]\+\.[0-9]\+\).*/\1/p' || echo "Unknown")
        PYTHON3_PATH=$(which python3)
        echo -e "  ${GREEN}✓${NC} Python 3: $PYTHON3_VERSION"
        echo -e "    路径: $PYTHON3_PATH"
    else
        echo -e "  ${RED}✗${NC} Python 3: 未安装"
    fi
    
    # 检测虚拟环境
    if [ -n "$VIRTUAL_ENV" ]; then
        echo -e "  ${GREEN}✓${NC} 虚拟环境: 已激活"
        echo -e "    路径: $VIRTUAL_ENV"
    else
        echo -e "  ${YELLOW}⚠${NC} 虚拟环境: 未激活"
    fi
    
    echo ""
}

# 检测网络端口工具
detect_network_tools() {
    echo -e "${BOLD}${BLUE}[3/7] 网络工具检测 / Network Tools${NC}"
    echo ""
    
    # 检测端口检测工具
    local tools_found=0
    
    [ "$DEBUG_MODE" = true ] && echo -e "${CYAN}[DEBUG] 开始检测网络工具...${NC}" >&2
    
    if command -v lsof &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} lsof: 已安装"
        tools_found=$((tools_found + 1))
    else
        echo -e "  ${YELLOW}⚠${NC} lsof: 未安装"
    fi
    
    if command -v ss &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} ss: 已安装"
        tools_found=$((tools_found + 1))
    else
        echo -e "  ${YELLOW}⚠${NC} ss: 未安装"
    fi
    
    if command -v netstat &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} netstat: 已安装"
        tools_found=$((tools_found + 1))
    else
        echo -e "  ${YELLOW}⚠${NC} netstat: 未安装"
    fi
    
    if [ $tools_found -eq 0 ]; then
        echo -e "  ${RED}✗${NC} 警告: 没有可用的端口检测工具"
        echo -e "  ${YELLOW}  建议安装: sudo apt install net-tools${NC}"
    fi
    
    echo ""
}

# 检测项目环境
detect_project() {
    echo -e "${BOLD}${BLUE}[4/7] 项目环境检测 / Project Environment${NC}"
    echo ""
    
    # 检测当前路径
    CURRENT_DIR=$(pwd)
    echo -e "  ${GREEN}✓${NC} 当前路径: $CURRENT_DIR"
    
    # 检测是否在项目根目录
    if [ -f "backend/app.py" ]; then
        echo -e "  ${GREEN}✓${NC} 项目检测: QueryGPT 项目根目录"
    else
        echo -e "  ${RED}✗${NC} 项目检测: 不在 QueryGPT 项目根目录"
    fi
    
    # 检测虚拟环境目录
    if [ -d "venv_py310" ]; then
        echo -e "  ${GREEN}✓${NC} 虚拟环境: venv_py310 存在"
    elif [ -d "venv" ]; then
        echo -e "  ${GREEN}✓${NC} 虚拟环境: venv 存在"
    else
        echo -e "  ${YELLOW}⚠${NC} 虚拟环境: 未创建"
    fi
    
    # 检测配置文件
    if [ -f ".env" ]; then
        echo -e "  ${GREEN}✓${NC} 配置文件: .env 存在"
    else
        echo -e "  ${YELLOW}⚠${NC} 配置文件: .env 不存在"
    fi
    
    # WSL 特殊检查
    if [ "$IS_WSL" = true ]; then
        if [[ "$CURRENT_DIR" == /mnt/* ]]; then
            echo -e "  ${YELLOW}⚠${NC} WSL 警告: 在 Windows 文件系统中 (性能较差)"
            echo -e "    建议移动到: ~/QueryGPT-github"
        else
            echo -e "  ${GREEN}✓${NC} WSL 优化: 在 Linux 文件系统中 (性能最佳)"
        fi
    fi
    
    echo ""
}

# 测试端口检测
test_port_detection() {
    echo -e "${BOLD}${BLUE}[5/7] 端口检测测试 / Port Detection Test${NC}"
    echo ""
    
    local test_port=5000
    echo -e "  测试端口 $test_port 的检测能力..."
    
    # 使用不同方法测试端口
    local methods_working=0
    
    # 方法1: Python (最可靠)
    if command -v python3 &> /dev/null; then
        if python3 -c "import socket; s=socket.socket(); r=s.connect_ex(('127.0.0.1',$test_port)); s.close(); exit(0 if r!=0 else 1)" 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} Python socket 方法: 可用"
            methods_working=$((methods_working + 1))
        else
            echo -e "  ${YELLOW}⚠${NC} Python socket 方法: 端口 $test_port 可能被占用"
        fi
    fi
    
    # 方法2: ss (Linux/WSL)
    if [ "$IS_LINUX" = true ] && command -v ss &> /dev/null; then
        if ! ss -tln 2>/dev/null | grep -q ":$test_port "; then
            echo -e "  ${GREEN}✓${NC} ss 命令方法: 可用"
            methods_working=$((methods_working + 1))
        else
            echo -e "  ${YELLOW}⚠${NC} ss 命令方法: 端口 $test_port 可能被占用"
        fi
    fi
    
    # 方法3: lsof (macOS/Linux)
    if command -v lsof &> /dev/null; then
        if ! lsof -Pi :$test_port -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} lsof 命令方法: 可用"
            methods_working=$((methods_working + 1))
        else
            echo -e "  ${YELLOW}⚠${NC} lsof 命令方法: 端口 $test_port 可能被占用"
        fi
    fi
    
    if [ $methods_working -eq 0 ]; then
        echo -e "  ${RED}✗${NC} 警告: 没有可用的端口检测方法"
    fi
    
    echo ""
}

# 检测文件格式问题
check_file_formats() {
    echo -e "${BOLD}${BLUE}[6/7] 文件格式检查 / File Format Check${NC}"
    echo ""
    
    local has_crlf=false
    
    for file in *.sh; do
        if [ -f "$file" ]; then
            if file "$file" 2>/dev/null | grep -q "CRLF"; then
                echo -e "  ${YELLOW}⚠${NC} $file: 包含 Windows 行结束符 (CRLF)"
                has_crlf=true
            elif file "$file" 2>/dev/null | grep -q "shell script"; then
                echo -e "  ${GREEN}✓${NC} $file: Unix 格式 (LF)"
            fi
        fi
    done
    
    if [ "$has_crlf" = true ]; then
        echo ""
        echo -e "  ${YELLOW}建议修复: ./setup.sh --fix-line-endings${NC}"
    fi
    
    echo ""
}

# 生成诊断报告
generate_report() {
    echo -e "${BOLD}${BLUE}[7/7] 诊断总结 / Diagnostic Summary${NC}"
    echo ""
    
    # 环境类型总结
    echo -e "${BOLD}环境类型识别:${NC}"
    if [ "$IS_WSL" = true ]; then
        echo -e "  ${CYAN}► WSL Ubuntu 环境${NC}"
        echo -e "    - 需要特殊的文件系统优化"
        echo -e "    - 端口检测需要特殊处理"
        echo -e "    - 建议使用 Linux 文件系统提升性能"
    elif [ "$IS_NATIVE_LINUX" = true ]; then
        if [ "$IS_UBUNTU" = true ]; then
            echo -e "  ${CYAN}► 纯 Ubuntu Linux 环境${NC}"
        else
            echo -e "  ${CYAN}► 纯 Linux 环境 ($LINUX_DISTRO)${NC}"
        fi
        echo -e "    - 原生性能，无需特殊优化"
        echo -e "    - 标准 Linux 工具链可用"
    elif [ "$IS_MACOS" = true ]; then
        echo -e "  ${CYAN}► macOS 环境${NC}"
        echo -e "    - 使用 lsof 进行端口检测"
        echo -e "    - 可能需要 Rosetta 2 (ARM Mac)"
    else
        echo -e "  ${RED}► 未知环境${NC}"
    fi
    
    echo ""
    echo -e "${BOLD}环境变量设置建议:${NC}"
    echo -e "  export IS_LINUX=$IS_LINUX"
    echo -e "  export IS_WSL=$IS_WSL"
    echo -e "  export IS_MACOS=$IS_MACOS"
    echo -e "  export IS_NATIVE_LINUX=$IS_NATIVE_LINUX"
    
    echo ""
    echo -e "${BOLD}推荐的启动命令:${NC}"
    if [ "$IS_WSL" = true ] && [[ "$(pwd)" == /mnt/* ]]; then
        echo -e "  ${YELLOW}# 先移动到 Linux 文件系统${NC}"
        echo -e "  ${GREEN}cp -r . ~/QueryGPT-github${NC}"
        echo -e "  ${GREEN}cd ~/QueryGPT-github${NC}"
        echo -e "  ${GREEN}./setup.sh && ./start.sh${NC}"
    else
        echo -e "  ${GREEN}./setup.sh && ./start.sh${NC}"
    fi
    
    echo ""
}

# 保存诊断报告到文件
save_report() {
    local report_file="diagnostic_report_$(date +%Y%m%d_%H%M%S).txt"
    
    {
        echo "QueryGPT 系统环境诊断报告"
        echo "生成时间: $(date)"
        echo "=================================="
        echo ""
        echo "环境信息:"
        echo "  OS_TYPE: $OSTYPE"
        echo "  IS_LINUX: $IS_LINUX"
        echo "  IS_WSL: $IS_WSL"
        echo "  IS_MACOS: $IS_MACOS"
        echo "  IS_NATIVE_LINUX: $IS_NATIVE_LINUX"
        echo "  IS_UBUNTU: $IS_UBUNTU"
        echo "  LINUX_DISTRO: $LINUX_DISTRO"
        echo "  KERNEL: $KERNEL_VERSION"
        echo "  ARCH: $ARCH_TYPE"
        echo ""
        echo "Python 环境:"
        echo "  Python3: $(python3 -V 2>&1 || echo 'Not installed')"
        echo "  Python3.10: $(python3.10 -V 2>&1 || echo 'Not installed')"
        echo "  VIRTUAL_ENV: ${VIRTUAL_ENV:-Not activated}"
        echo ""
        echo "项目状态:"
        echo "  当前目录: $(pwd)"
        echo "  backend/app.py: $([ -f backend/app.py ] && echo 'Exists' || echo 'Missing')"
        echo "  venv_py310: $([ -d venv_py310 ] && echo 'Exists' || echo 'Missing')"
        echo "  .env: $([ -f .env ] && echo 'Exists' || echo 'Missing')"
    } > "$report_file"
    
    echo ""
    echo -e "${GREEN}诊断报告已保存: $report_file${NC}"
}

# 主函数
main() {
    print_header
    
    detect_os
    detect_python
    detect_network_tools
    detect_project
    test_port_detection
    check_file_formats
    generate_report
    
    # 询问是否保存报告
    echo ""
    read -p "是否保存诊断报告到文件? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        save_report
    fi
    
    echo ""
    print_separator
    echo -e "${GREEN}诊断完成 / Diagnostic Complete${NC}"
    print_separator
}

# 处理命令行参数
case "${1:-}" in
    --json)
        # JSON 输出模式（供脚本调用）
        # 先运行检测
        detect_os >/dev/null 2>&1
        
        # 确保OS_TYPE有值
        if [ -z "$OS_NAME" ]; then
            OS_NAME="Unknown"
        fi
        
        cat <<EOF
{
  "is_linux": $IS_LINUX,
  "is_wsl": $IS_WSL,
  "is_macos": $IS_MACOS,
  "is_native_linux": $IS_NATIVE_LINUX,
  "is_ubuntu": $IS_UBUNTU,
  "os_type": "$OS_NAME"
}
EOF
        ;;
    --help|-h)
        echo "QueryGPT 系统环境诊断工具"
        echo "用法: ./diagnostic.sh [选项]"
        echo ""
        echo "选项:"
        echo "  无参数        运行完整诊断"
        echo "  --json       输出 JSON 格式结果"
        echo "  --help, -h   显示帮助信息"
        echo ""
        ;;
    *)
        main
        ;;
esac