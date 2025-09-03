#!/bin/bash

# WSL环境修复脚本 - 解决后台进程立即停止的问题
# WSL Environment Fix Script - Resolves background process immediate termination

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      QueryGPT WSL环境修复器            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 检测是否为WSL环境
if ! grep -qi microsoft /proc/version 2>/dev/null; then
    echo -e "${YELLOW}[WARNING] 未检测到WSL环境，该脚本仅适用于WSL${NC}"
    exit 1
fi

echo -e "${CYAN}[INFO] 检测到WSL环境，开始修复...${NC}"

# 1. 修复Python虚拟环境激活问题
fix_venv_activation() {
    echo -e "${BLUE}[1/7] 修复Python虚拟环境激活...${NC}"
    
    # 创建激活辅助脚本
    cat > activate_venv.sh << 'EOF'
#!/bin/bash
# WSL虚拟环境激活辅助脚本

# 优先使用venv_py310
if [ -d "venv_py310" ]; then
    VENV_PATH="$(pwd)/venv_py310"
elif [ -d "venv" ]; then
    VENV_PATH="$(pwd)/venv"
else
    echo "错误: 未找到虚拟环境"
    exit 1
fi

# WSL特殊处理：强制设置环境变量
export VIRTUAL_ENV="$VENV_PATH"
export PATH="$VIRTUAL_ENV/bin:$PATH"
export PYTHONPATH="$(pwd):$(pwd)/backend:$PYTHONPATH"

# 验证Python路径
PYTHON_BIN="$VIRTUAL_ENV/bin/python"
if [ ! -f "$PYTHON_BIN" ]; then
    echo "错误: Python可执行文件不存在: $PYTHON_BIN"
    exit 1
fi

# 输出验证信息
echo "虚拟环境已激活:"
echo "  VIRTUAL_ENV: $VIRTUAL_ENV"
echo "  Python: $(which python)"
echo "  Python版本: $(python --version 2>&1)"
EOF
    
    chmod +x activate_venv.sh
    echo -e "${GREEN}✓ 虚拟环境激活脚本已创建${NC}"
}

# 2. 修复nohup和后台进程问题
fix_background_process() {
    echo -e "${BLUE}[2/7] 修复后台进程管理...${NC}"
    
    # 创建进程管理器脚本
    cat > process_manager.sh << 'EOF'
#!/bin/bash
# WSL进程管理器 - 防止后台进程被终止

start_background_process() {
    local cmd="$1"
    local log_file="$2"
    
    # 方案1: 使用setsid创建新会话组，避免SIGHUP
    if command -v setsid >/dev/null 2>&1; then
        setsid bash -c "exec $cmd > '$log_file' 2>&1 < /dev/null" &
    # 方案2: 使用nohup + disown组合
    elif command -v nohup >/dev/null 2>&1; then
        nohup bash -c "$cmd" > "$log_file" 2>&1 < /dev/null &
        disown
    # 方案3: 使用screen（如果安装）
    elif command -v screen >/dev/null 2>&1; then
        screen -dmS querygpt bash -c "$cmd > '$log_file' 2>&1"
    # 方案4: 基础后台运行 + trap忽略信号
    else
        (
            trap '' HUP INT TERM
            exec $cmd > "$log_file" 2>&1 < /dev/null
        ) &
        disown
    fi
    
    echo $!
}

# 确保进程持续运行
keep_alive() {
    local pid=$1
    local cmd="$2"
    local log_file="$3"
    
    while true; do
        if ! ps -p $pid > /dev/null 2>&1; then
            echo "进程$pid已停止，重新启动..."
            pid=$(start_background_process "$cmd" "$log_file")
            echo "新进程PID: $pid"
        fi
        sleep 5
    done
}
EOF
    
    chmod +x process_manager.sh
    echo -e "${GREEN}✓ 进程管理器已创建${NC}"
}

# 3. 修复信号处理
fix_signal_handling() {
    echo -e "${BLUE}[3/7] 修复信号处理...${NC}"
    
    # 创建信号处理脚本
    cat > signal_handler.sh << 'EOF'
#!/bin/bash
# WSL信号处理器

# 忽略可能导致进程终止的信号
trap '' HUP  # 忽略挂起信号
trap '' TSTP # 忽略终端停止信号

# 只处理必要的信号
cleanup() {
    echo "正在优雅关闭..."
    if [ -n "$FLASK_PID" ]; then
        kill -TERM $FLASK_PID 2>/dev/null
        wait $FLASK_PID 2>/dev/null
    fi
    exit 0
}

trap cleanup INT TERM

# 导出给子进程使用
export -f cleanup
EOF
    
    chmod +x signal_handler.sh
    echo -e "${GREEN}✓ 信号处理器已创建${NC}"
}

# 4. 修复日志重定向问题
fix_log_redirection() {
    echo -e "${BLUE}[4/7] 修复日志重定向...${NC}"
    
    # 创建日志目录
    mkdir -p logs
    
    # 创建日志管理脚本
    cat > log_manager.sh << 'EOF'
#!/bin/bash
# WSL日志管理器

# 创建命名管道避免缓冲问题
setup_logging() {
    local log_file="$1"
    local fifo_path="/tmp/querygpt_log_$$"
    
    # 创建命名管道
    mkfifo "$fifo_path"
    
    # 后台进程处理日志
    tee -a "$log_file" < "$fifo_path" &
    
    # 返回管道路径供重定向使用
    echo "$fifo_path"
}

# 实时日志监控（无缓冲）
monitor_log() {
    local log_file="$1"
    
    # 使用stdbuf去除缓冲
    if command -v stdbuf >/dev/null 2>&1; then
        stdbuf -oL tail -f "$log_file"
    else
        tail -f "$log_file"
    fi
}
EOF
    
    chmod +x log_manager.sh
    echo -e "${GREEN}✓ 日志管理器已创建${NC}"
}

# 5. 修复Python缓冲问题
fix_python_buffering() {
    echo -e "${BLUE}[5/7] 修复Python输出缓冲...${NC}"
    
    # 创建Python启动包装器
    cat > python_wrapper.sh << 'EOF'
#!/bin/bash
# Python启动包装器 - 禁用缓冲

# 设置Python环境变量
export PYTHONUNBUFFERED=1
export PYTHONIOENCODING=utf-8

# 获取虚拟环境Python路径
if [ -n "$VIRTUAL_ENV" ]; then
    PYTHON_CMD="$VIRTUAL_ENV/bin/python"
else
    PYTHON_CMD="python"
fi

# 使用-u参数强制无缓冲模式
exec $PYTHON_CMD -u "$@"
EOF
    
    chmod +x python_wrapper.sh
    echo -e "${GREEN}✓ Python包装器已创建${NC}"
}

# 6. 创建WSL优化的启动脚本
create_wsl_start_script() {
    echo -e "${BLUE}[6/7] 创建WSL优化启动脚本...${NC}"
    
    cat > start_wsl.sh << 'EOF'
#!/bin/bash
# QueryGPT WSL优化启动脚本

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    QueryGPT WSL优化启动器              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 激活虚拟环境
echo -e "${CYAN}[INFO] 激活Python虚拟环境...${NC}"
source ./activate_venv.sh

# 加载信号处理器
source ./signal_handler.sh

# 查找可用端口
find_port() {
    local port=5000
    while ss -tln | grep -q ":$port "; do
        port=$((port + 1))
    done
    echo $port
}

PORT=$(find_port)
export PORT

echo -e "${GREEN}[INFO] 使用端口: $PORT${NC}"

# 创建必要目录
mkdir -p logs output cache config

# 准备日志文件
LOG_FILE="logs/app_$(date +%Y%m%d_%H%M%S).log"

echo -e "${CYAN}[INFO] 启动Flask应用...${NC}"

# 方案1: 使用setsid（最可靠）
if command -v setsid >/dev/null 2>&1; then
    echo -e "${CYAN}[INFO] 使用setsid启动进程...${NC}"
    cd backend
    setsid ./python_wrapper.sh app.py > "../$LOG_FILE" 2>&1 < /dev/null &
    FLASK_PID=$!
    cd ..
    
# 方案2: 使用systemd-run（如果可用）
elif command -v systemd-run >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
    echo -e "${CYAN}[INFO] 使用systemd-run启动进程...${NC}"
    systemd-run --user --uid=$(id -u) --gid=$(id -g) \
        --working-directory=$(pwd)/backend \
        --setenv=PATH="$PATH" \
        --setenv=VIRTUAL_ENV="$VIRTUAL_ENV" \
        --setenv=PORT="$PORT" \
        ./python_wrapper.sh app.py > "$LOG_FILE" 2>&1 &
    FLASK_PID=$!
    
# 方案3: 使用screen（如果安装）
elif command -v screen >/dev/null 2>&1; then
    echo -e "${CYAN}[INFO] 使用screen启动进程...${NC}"
    screen -dmS querygpt bash -c "cd backend && ./python_wrapper.sh app.py > '../$LOG_FILE' 2>&1"
    sleep 2
    FLASK_PID=$(screen -ls | grep querygpt | awk '{print $1}' | cut -d. -f1)
    
# 方案4: 基础方法 + disown
else
    echo -e "${CYAN}[INFO] 使用基础方法启动进程...${NC}"
    cd backend
    (
        trap '' HUP INT TERM TSTP
        exec ./python_wrapper.sh app.py > "../$LOG_FILE" 2>&1 < /dev/null
    ) &
    FLASK_PID=$!
    disown $FLASK_PID
    cd ..
fi

# 等待服务启动
echo -e "${CYAN}[INFO] 等待服务启动...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:$PORT/health >/dev/null 2>&1; then
        echo -e "${GREEN}✓ 服务已启动 (PID: $FLASK_PID)${NC}"
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# 检查进程状态
if ps -p $FLASK_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Flask进程运行正常${NC}"
    echo -e "${BLUE}访问地址: http://localhost:$PORT${NC}"
    echo -e "${BLUE}日志文件: $LOG_FILE${NC}"
    
    # 尝试在Windows中打开浏览器
    if command -v cmd.exe >/dev/null 2>&1; then
        cmd.exe /c start http://localhost:$PORT 2>/dev/null || true
    elif command -v wslview >/dev/null 2>&1; then
        wslview http://localhost:$PORT 2>/dev/null || true
    fi
    
    echo ""
    echo -e "${CYAN}按 Ctrl+C 停止服务${NC}"
    
    # 监控日志
    tail -f "$LOG_FILE"
else
    echo -e "${RED}[ERROR] Flask进程启动失败${NC}"
    echo -e "${YELLOW}查看日志:${NC}"
    [ -f "$LOG_FILE" ] && tail -20 "$LOG_FILE"
    exit 1
fi
EOF
    
    chmod +x start_wsl.sh
    echo -e "${GREEN}✓ WSL优化启动脚本已创建${NC}"
}

# 7. 创建调试脚本
create_debug_script() {
    echo -e "${BLUE}[7/7] 创建调试脚本...${NC}"
    
    cat > debug_wsl.sh << 'EOF'
#!/bin/bash
# WSL调试脚本

echo "=== WSL环境诊断 ==="
echo ""

# 检查WSL版本
echo "WSL版本信息:"
if command -v wsl.exe >/dev/null 2>&1; then
    wsl.exe --version 2>/dev/null || echo "WSL 1"
else
    cat /proc/version
fi
echo ""

# 检查Python环境
echo "Python环境:"
echo "  which python: $(which python)"
echo "  Python版本: $(python --version 2>&1)"
echo "  VIRTUAL_ENV: $VIRTUAL_ENV"
echo "  PATH: $PATH" | head -c 200
echo "..."
echo ""

# 检查进程管理工具
echo "进程管理工具:"
for tool in setsid screen tmux systemd-run nohup; do
    if command -v $tool >/dev/null 2>&1; then
        echo "  ✓ $tool 可用"
    else
        echo "  ✗ $tool 不可用"
    fi
done
echo ""

# 检查网络端口
echo "端口占用情况:"
ss -tln | grep -E ":(500[0-9]|501[0-9])" || echo "  端口5000-5019未被占用"
echo ""

# 检查日志
echo "最近的日志文件:"
ls -la logs/*.log 2>/dev/null | tail -5 || echo "  无日志文件"
echo ""

# 测试Python导入
echo "测试Python模块导入:"
python -c "
try:
    import flask
    print('  ✓ Flask')
except: print('  ✗ Flask')
    
try:
    import openinterpreter
    print('  ✓ OpenInterpreter')  
except: print('  ✗ OpenInterpreter')

try:
    from backend.app import app
    print('  ✓ 应用模块')
except Exception as e: 
    print(f'  ✗ 应用模块: {e}')
" 2>&1

echo ""
echo "=== 诊断完成 ==="
EOF
    
    chmod +x debug_wsl.sh
    echo -e "${GREEN}✓ 调试脚本已创建${NC}"
}

# 主函数
main() {
    fix_venv_activation
    fix_background_process
    fix_signal_handling
    fix_log_redirection
    fix_python_buffering
    create_wsl_start_script
    create_debug_script
    
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         WSL修复完成！                  ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}使用方法:${NC}"
    echo -e "  1. 运行诊断: ${YELLOW}./debug_wsl.sh${NC}"
    echo -e "  2. 启动服务: ${YELLOW}./start_wsl.sh${NC}"
    echo ""
    echo -e "${BLUE}修复内容:${NC}"
    echo -e "  ✓ Python虚拟环境激活问题"
    echo -e "  ✓ 后台进程立即停止问题"
    echo -e "  ✓ 信号处理和进程管理"
    echo -e "  ✓ 日志缓冲和重定向"
    echo -e "  ✓ Python输出缓冲"
    echo ""
    echo -e "${GREEN}提示: 如果仍有问题，请运行 ./debug_wsl.sh 查看诊断信息${NC}"
}

# 运行主函数
main