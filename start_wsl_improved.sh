#!/bin/bash

# QueryGPT WSL改进版启动脚本
# 修复了原start.sh在WSL环境下的所有已知问题

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    QueryGPT WSL改进版启动器            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 全局变量
FLASK_PID=""
LOG_FILE=""
PORT=""
VENV_PATH=""

# 错误处理函数
handle_error() {
    local error_code=$1
    local error_msg=$2
    echo -e "${RED}[ERROR] ${error_msg}${NC}"
    
    case $error_code in
        1)  # 虚拟环境激活失败
            echo -e "${YELLOW}解决方案:${NC}"
            echo "  1. 运行: ./setup.sh 创建虚拟环境"
            echo "  2. 或手动创建: python3 -m venv venv_py310"
            echo "  3. 安装依赖: pip install -r requirements.txt"
            ;;
        2)  # 端口占用
            echo -e "${YELLOW}解决方案:${NC}"
            echo "  1. 查看占用: ss -tlnp | grep :500"
            echo "  2. 终止进程: kill -9 <PID>"
            echo "  3. 或使用其他端口: export PORT=5001"
            ;;
        3)  # 进程启动失败
            echo -e "${YELLOW}可能原因:${NC}"
            echo "  1. Python模块缺失"
            echo "  2. 配置文件错误"
            echo "  3. 数据库连接失败"
            echo ""
            echo -e "${YELLOW}查看详细日志:${NC}"
            [ -f "$LOG_FILE" ] && tail -20 "$LOG_FILE"
            ;;
        4)  # 信号处理错误
            echo -e "${YELLOW}WSL已知问题，使用替代方案...${NC}"
            ;;
    esac
    
    exit $error_code
}

# 检测WSL环境
detect_wsl() {
    if grep -qi microsoft /proc/version 2>/dev/null; then
        echo -e "${CYAN}[INFO] 检测到WSL环境${NC}"
        
        # 检测WSL版本
        if [ -f /proc/sys/fs/binfmt_misc/WSLInterop ]; then
            echo -e "${CYAN}[INFO] WSL2环境${NC}"
            return 2
        else
            echo -e "${CYAN}[INFO] WSL1环境${NC}"
            return 1
        fi
    fi
    return 0
}

# 修复WSL特定问题
fix_wsl_issues() {
    echo -e "${CYAN}[INFO] 应用WSL修复...${NC}"
    
    # 1. 修复行结束符
    for file in *.sh backend/*.py; do
        if [ -f "$file" ] && file "$file" 2>/dev/null | grep -q "CRLF"; then
            echo -e "${YELLOW}  修复 $file 的行结束符${NC}"
            sed -i 's/\r$//' "$file" 2>/dev/null || true
        fi
    done
    
    # 2. 确保执行权限
    chmod +x *.sh 2>/dev/null || true
    
    # 3. 清理Windows路径（避免冲突）
    PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "/mnt/c" | tr '\n' ':')
    export PATH="${PATH%:}"
    
    # 4. 设置WSL特定环境变量
    export PYTHONUNBUFFERED=1  # 禁用Python缓冲
    export PYTHONIOENCODING=utf-8
    
    # 5. 检查并安装必要工具
    if ! command -v setsid >/dev/null 2>&1; then
        echo -e "${YELLOW}[WARNING] setsid未安装，后台进程可能不稳定${NC}"
        echo -e "${CYAN}建议安装: sudo apt-get install util-linux${NC}"
    fi
}

# 激活Python虚拟环境（改进版）
activate_venv() {
    echo -e "${CYAN}[INFO] 激活Python虚拟环境...${NC}"
    
    # 查找虚拟环境
    if [ -d "venv_py310" ]; then
        VENV_PATH="$(pwd)/venv_py310"
    elif [ -d "venv" ]; then
        VENV_PATH="$(pwd)/venv"
    else
        handle_error 1 "未找到虚拟环境"
    fi
    
    # WSL特殊激活方式
    export VIRTUAL_ENV="$VENV_PATH"
    export PATH="$VIRTUAL_ENV/bin:$PATH"
    
    # 验证Python路径
    local python_bin="$VIRTUAL_ENV/bin/python"
    if [ ! -f "$python_bin" ]; then
        handle_error 1 "Python可执行文件不存在: $python_bin"
    fi
    
    # 验证激活成功
    local actual_python=$(which python)
    if [[ "$actual_python" != "$VIRTUAL_ENV"* ]]; then
        echo -e "${YELLOW}[WARNING] 虚拟环境可能未正确激活${NC}"
        echo "  期望: $VIRTUAL_ENV/bin/python"
        echo "  实际: $actual_python"
    fi
    
    echo -e "${GREEN}✓ 虚拟环境已激活${NC}"
    echo "  Python: $(which python)"
    echo "  版本: $(python --version 2>&1)"
}

# 查找可用端口（改进版）
find_available_port() {
    local start_port=${1:-5000}
    local end_port=${2:-5010}
    
    echo -e "${CYAN}[INFO] 查找可用端口 ($start_port-$end_port)...${NC}"
    
    for port in $(seq $start_port $end_port); do
        # WSL优化：使用多种方法检查端口
        local port_used=false
        
        # 方法1: ss命令（最快）
        if command -v ss >/dev/null 2>&1; then
            if ss -tln 2>/dev/null | grep -q ":$port "; then
                port_used=true
            fi
        # 方法2: netstat命令
        elif command -v netstat >/dev/null 2>&1; then
            if netstat -tln 2>/dev/null | grep -q ":$port "; then
                port_used=true
            fi
        # 方法3: Python检查
        else
            python -c "
import socket
s = socket.socket()
try:
    s.bind(('', $port))
    s.close()
    exit(0)
except:
    exit(1)
" 2>/dev/null || port_used=true
        fi
        
        if [ "$port_used" = false ]; then
            PORT=$port
            echo -e "${GREEN}✓ 找到可用端口: $PORT${NC}"
            return 0
        fi
    done
    
    handle_error 2 "无法找到可用端口"
}

# 启动Flask应用（核心修复）
start_flask_app() {
    echo -e "${CYAN}[INFO] 启动Flask应用...${NC}"
    
    # 创建日志目录
    mkdir -p logs
    LOG_FILE="logs/app_$(date +%Y%m%d_%H%M%S).log"
    
    # 准备启动命令
    local python_cmd="$VIRTUAL_ENV/bin/python"
    local app_cmd="$python_cmd -u app.py"
    
    # 导出必要的环境变量
    export PORT
    export PYTHONUNBUFFERED=1
    
    cd backend
    
    # WSL启动策略（按优先级尝试）
    local started=false
    
    # 策略1: 使用setsid（最可靠）
    if command -v setsid >/dev/null 2>&1; then
        echo -e "${CYAN}  使用setsid启动...${NC}"
        setsid bash -c "exec $app_cmd > '../$LOG_FILE' 2>&1 < /dev/null" &
        FLASK_PID=$!
        started=true
        
    # 策略2: 使用nohup + disown
    elif command -v nohup >/dev/null 2>&1; then
        echo -e "${CYAN}  使用nohup启动...${NC}"
        nohup $app_cmd > "../$LOG_FILE" 2>&1 < /dev/null &
        FLASK_PID=$!
        disown $FLASK_PID
        started=true
        
    # 策略3: 基础后台运行 + trap
    else
        echo -e "${CYAN}  使用基础方法启动...${NC}"
        (
            # 忽略可能导致终止的信号
            trap '' HUP TSTP
            exec $app_cmd > "../$LOG_FILE" 2>&1 < /dev/null
        ) &
        FLASK_PID=$!
        disown $FLASK_PID
        started=true
    fi
    
    cd ..
    
    if [ "$started" = false ]; then
        handle_error 3 "无法启动Flask进程"
    fi
    
    echo -e "${CYAN}[INFO] 进程已启动 (PID: $FLASK_PID)${NC}"
    
    # 等待并验证进程
    sleep 3
    
    # 多次检查进程状态（WSL可能延迟）
    local max_checks=10
    local check_count=0
    local process_alive=false
    
    while [ $check_count -lt $max_checks ]; do
        if ps -p $FLASK_PID > /dev/null 2>&1; then
            process_alive=true
            break
        fi
        sleep 1
        check_count=$((check_count + 1))
    done
    
    if [ "$process_alive" = false ]; then
        echo -e "${RED}[ERROR] Flask进程已终止${NC}"
        echo -e "${YELLOW}查看错误日志:${NC}"
        [ -f "$LOG_FILE" ] && tail -20 "$LOG_FILE"
        
        # 尝试前台运行以便调试
        echo ""
        echo -e "${YELLOW}尝试前台运行模式进行调试...${NC}"
        echo -e "${CYAN}提示: 使用 Ctrl+C 停止${NC}"
        cd backend
        exec $python_cmd app.py
    fi
    
    echo -e "${GREEN}✓ Flask进程运行正常${NC}"
}

# 等待服务就绪
wait_for_service() {
    echo -e "${CYAN}[INFO] 等待服务就绪...${NC}"
    
    local max_wait=30
    local wait_count=0
    
    while [ $wait_count -lt $max_wait ]; do
        # 尝试连接服务
        if curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/health 2>/dev/null | grep -q "200\|404"; then
            echo -e "${GREEN}✓ 服务已就绪${NC}"
            return 0
        fi
        
        # 检查进程是否还在运行
        if [ -n "$FLASK_PID" ] && ! ps -p $FLASK_PID > /dev/null 2>&1; then
            echo -e "${RED}[ERROR] Flask进程已停止${NC}"
            return 1
        fi
        
        sleep 1
        wait_count=$((wait_count + 1))
        echo -n "."
    done
    echo ""
    
    echo -e "${YELLOW}[WARNING] 服务启动超时${NC}"
    return 1
}

# 打开浏览器（WSL特定）
open_browser() {
    local url="http://localhost:$PORT"
    
    echo -e "${CYAN}[INFO] 尝试打开浏览器...${NC}"
    
    # WSL: 使用Windows浏览器
    if command -v cmd.exe >/dev/null 2>&1; then
        cmd.exe /c start $url 2>/dev/null && \
            echo -e "${GREEN}✓ 已在Windows浏览器中打开${NC}" || \
            echo -e "${YELLOW}请手动访问: $url${NC}"
    elif command -v wslview >/dev/null 2>&1; then
        wslview $url 2>/dev/null && \
            echo -e "${GREEN}✓ 已打开浏览器${NC}" || \
            echo -e "${YELLOW}请手动访问: $url${NC}"
    elif command -v explorer.exe >/dev/null 2>&1; then
        explorer.exe $url 2>/dev/null && \
            echo -e "${GREEN}✓ 已打开浏览器${NC}" || \
            echo -e "${YELLOW}请手动访问: $url${NC}"
    else
        echo -e "${YELLOW}请手动访问: $url${NC}"
    fi
}

# 监控服务（改进版）
monitor_service() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo -e "${GREEN}服务运行信息:${NC}"
    echo -e "  地址: ${BLUE}http://localhost:$PORT${NC}"
    echo -e "  进程: PID $FLASK_PID"
    echo -e "  日志: $LOG_FILE"
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo ""
    echo -e "${YELLOW}按 Ctrl+C 停止服务${NC}"
    echo ""
    
    # 设置信号处理
    cleanup() {
        echo -e "\n${CYAN}[INFO] 正在停止服务...${NC}"
        if [ -n "$FLASK_PID" ]; then
            # 优雅关闭
            kill -TERM $FLASK_PID 2>/dev/null
            
            # 等待进程结束
            local wait_count=0
            while [ $wait_count -lt 5 ] && ps -p $FLASK_PID > /dev/null 2>&1; do
                sleep 1
                wait_count=$((wait_count + 1))
            done
            
            # 如果还在运行，强制终止
            if ps -p $FLASK_PID > /dev/null 2>&1; then
                kill -9 $FLASK_PID 2>/dev/null
            fi
        fi
        echo -e "${GREEN}✓ 服务已停止${NC}"
        exit 0
    }
    
    trap cleanup INT TERM
    
    # 监控日志（使用无缓冲tail）
    if [ -f "$LOG_FILE" ]; then
        # WSL优化：使用stdbuf减少缓冲
        if command -v stdbuf >/dev/null 2>&1; then
            stdbuf -oL tail -f "$LOG_FILE"
        else
            tail -f "$LOG_FILE"
        fi
    else
        # 如果日志文件不存在，持续检查进程状态
        while true; do
            if [ -n "$FLASK_PID" ] && ps -p $FLASK_PID > /dev/null 2>&1; then
                sleep 5
            else
                echo -e "${YELLOW}[WARNING] Flask进程已停止${NC}"
                break
            fi
        done
    fi
}

# 主函数
main() {
    # 检测WSL环境
    detect_wsl
    local wsl_version=$?
    
    if [ $wsl_version -gt 0 ]; then
        fix_wsl_issues
    fi
    
    # 清除代理（避免冲突）
    unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
    
    # 激活虚拟环境
    activate_venv
    
    # 查找可用端口
    find_available_port
    
    # 创建必要目录
    mkdir -p output cache config logs
    
    # 启动Flask应用
    start_flask_app
    
    # 等待服务就绪
    if wait_for_service; then
        open_browser
    fi
    
    # 监控服务
    monitor_service
}

# 运行主函数
main "$@"