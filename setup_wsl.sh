#!/bin/bash

# QueryGPT WSL专用安装脚本 v1.0
# 专为Windows Subsystem for Linux优化

set -e  # 错误时退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# 全局变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PYTHON_CMD=""
VENV_DIR="venv_py310"
LOG_FILE="logs/setup_$(date +%Y%m%d_%H%M%S).log"

# 创建日志目录
mkdir -p logs

# 记录日志
log() {
    echo -e "$1" | tee -a "$LOG_FILE"
}

# 打印横幅
print_banner() {
    clear
    log "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    log "${CYAN}║${NC}     ${BOLD}QueryGPT WSL Setup v1.0${NC}                          ${CYAN}║${NC}"
    log "${CYAN}║${NC}     Windows Subsystem for Linux 专用版                ${CYAN}║${NC}"
    log "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
    log ""
}

# WSL环境验证
verify_wsl() {
    log "${BLUE}[步骤 1/8] 验证WSL环境${NC}"
    
    if ! grep -qi microsoft /proc/version 2>/dev/null; then
        log "${RED}✗ 错误: 此脚本仅用于WSL环境${NC}"
        log "  请使用 ./setup.sh 用于其他系统"
        exit 1
    fi
    
    # 获取WSL版本
    local wsl_version="Unknown"
    if command -v wsl.exe &>/dev/null; then
        wsl_version=$(wsl.exe --status 2>/dev/null | grep -i "default version" | grep -o "[0-9]" || echo "Unknown")
    fi
    
    log "${GREEN}✓ WSL环境确认 (版本: $wsl_version)${NC}"
    
    # 检查文件系统位置
    if [[ "$SCRIPT_DIR" == /mnt/* ]]; then
        log "${YELLOW}⚠ 警告: 项目位于Windows文件系统${NC}"
        log "  建议移至Linux文件系统以获得更好性能:"
        log "  ${CYAN}cp -r $SCRIPT_DIR ~/QueryGPT-github${NC}"
        log ""
    fi
}

# 修复文件格式和权限
fix_files() {
    log "${BLUE}[步骤 2/8] 修复文件格式和权限${NC}"
    
    # 修复所有shell脚本的行结束符
    local fixed_count=0
    for file in *.sh; do
        if [ -f "$file" ]; then
            # 检测CRLF
            if file "$file" 2>/dev/null | grep -q "CRLF" || grep -q $'\r' "$file"; then
                log "  修复 $file 的行结束符..."
                # 多种方法确保转换成功
                if command -v dos2unix &>/dev/null; then
                    dos2unix "$file" 2>/dev/null
                elif command -v sed &>/dev/null; then
                    sed -i 's/\r$//' "$file"
                else
                    tr -d '\r' < "$file" > "$file.tmp" && mv "$file.tmp" "$file"
                fi
                ((fixed_count++))
            fi
        fi
    done
    
    # 设置执行权限
    chmod +x *.sh 2>/dev/null || true
    
    if [ $fixed_count -gt 0 ]; then
        log "${GREEN}✓ 修复了 $fixed_count 个文件${NC}"
    else
        log "${GREEN}✓ 文件格式正常${NC}"
    fi
}

# 安装系统依赖
install_system_deps() {
    log "${BLUE}[步骤 3/8] 检查系统依赖${NC}"
    
    local missing_deps=()
    
    # 检查必要的命令
    for cmd in curl git python3; do
        if ! command -v $cmd &>/dev/null; then
            missing_deps+=($cmd)
        fi
    done
    
    # WSL特殊：检查Windows交互工具
    if ! command -v wslview &>/dev/null && ! command -v cmd.exe &>/dev/null; then
        log "${YELLOW}  提示: 安装 wslu 可获得更好的浏览器集成${NC}"
        log "  ${CYAN}sudo apt-get install wslu${NC}"
    fi
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        log "${YELLOW}⚠ 缺少系统依赖: ${missing_deps[*]}${NC}"
        log "  请运行: ${CYAN}sudo apt-get update && sudo apt-get install ${missing_deps[*]}${NC}"
        exit 1
    else
        log "${GREEN}✓ 系统依赖完整${NC}"
    fi
}

# 检查Python版本
check_python() {
    log "${BLUE}[步骤 4/8] 检查Python环境${NC}"
    
    # 按优先级查找Python
    local python_found=false
    
    # 优先查找 Python 3.10
    if command -v python3.10 &>/dev/null; then
        PYTHON_CMD="python3.10"
        local version=$(python3.10 --version 2>&1 | grep -Po '\d+\.\d+\.\d+')
        log "${GREEN}✓ 找到 Python $version (推荐版本)${NC}"
        python_found=true
    elif command -v python3 &>/dev/null; then
        local version=$(python3 --version 2>&1 | grep -Po '\d+\.\d+\.\d+')
        local major=$(echo $version | cut -d. -f1)
        local minor=$(echo $version | cut -d. -f2)
        
        if [ "$major" -eq 3 ] && [ "$minor" -ge 8 ]; then
            PYTHON_CMD="python3"
            log "${GREEN}✓ 找到 Python $version${NC}"
            if [ "$minor" -ne 10 ]; then
                log "${YELLOW}  提示: 推荐使用 Python 3.10.x${NC}"
            fi
            python_found=true
        else
            log "${RED}✗ Python 版本过低: $version (需要 >= 3.8)${NC}"
        fi
    fi
    
    if [ "$python_found" = false ]; then
        log "${RED}✗ 未找到合适的Python版本${NC}"
        log "  请安装Python 3.10:"
        log "  ${CYAN}sudo apt-get update${NC}"
        log "  ${CYAN}sudo apt-get install python3.10 python3.10-venv${NC}"
        exit 1
    fi
    
    # 检查pip和venv
    if ! $PYTHON_CMD -m pip --version &>/dev/null; then
        log "${YELLOW}⚠ pip未安装，正在安装...${NC}"
        $PYTHON_CMD -m ensurepip --default-pip 2>/dev/null || \
        sudo apt-get install python3-pip -y
    fi
    
    if ! $PYTHON_CMD -m venv --help &>/dev/null; then
        log "${YELLOW}⚠ venv未安装，正在安装...${NC}"
        sudo apt-get install python3.10-venv -y 2>/dev/null || \
        sudo apt-get install python3-venv -y
    fi
}

# 创建虚拟环境
setup_venv() {
    log "${BLUE}[步骤 5/8] 配置Python虚拟环境${NC}"
    
    # 删除损坏的虚拟环境
    if [ -d "$VENV_DIR" ] && [ ! -f "$VENV_DIR/bin/activate" ]; then
        log "${YELLOW}  删除损坏的虚拟环境...${NC}"
        rm -rf "$VENV_DIR"
    fi
    
    # 创建虚拟环境
    if [ ! -d "$VENV_DIR" ]; then
        log "  创建新的虚拟环境..."
        $PYTHON_CMD -m venv "$VENV_DIR"
        log "${GREEN}✓ 虚拟环境创建成功${NC}"
    else
        log "${GREEN}✓ 使用现有虚拟环境${NC}"
    fi
    
    # WSL特殊：使用绝对路径激活
    export VIRTUAL_ENV="$SCRIPT_DIR/$VENV_DIR"
    export PATH="$VIRTUAL_ENV/bin:$PATH"
    
    # 验证激活
    if [ -f "$VIRTUAL_ENV/bin/python" ]; then
        log "${GREEN}✓ 虚拟环境激活成功${NC}"
        log "  Python路径: $VIRTUAL_ENV/bin/python"
    else
        log "${RED}✗ 虚拟环境激活失败${NC}"
        exit 1
    fi
    
    # 升级pip（静默）
    "$VIRTUAL_ENV/bin/python" -m pip install --upgrade pip --quiet
}

# 安装Python依赖
install_dependencies() {
    log "${BLUE}[步骤 6/8] 安装Python依赖${NC}"
    
    # 使用虚拟环境中的pip
    local PIP_CMD="$VIRTUAL_ENV/bin/pip"
    
    # 创建requirements.txt如果不存在
    if [ ! -f "requirements.txt" ]; then
        log "  创建默认依赖列表..."
        cat > requirements.txt << 'EOF'
Flask==2.3.3
flask-cors==4.0.0
pymysql==1.1.0
python-dotenv==1.0.0
openai==1.3.0
litellm==1.0.0
pandas==2.0.3
numpy==1.24.3
matplotlib==3.7.2
seaborn==0.12.2
plotly==5.15.0
requests==2.31.0
EOF
    fi
    
    # WSL优化：使用国内镜像源加速
    log "  配置pip镜像源..."
    mkdir -p ~/.pip
    cat > ~/.pip/pip.conf << 'EOF'
[global]
index-url = https://pypi.org/simple
extra-index-url = https://pypi.douban.com/simple
trusted-host = pypi.douban.com
timeout = 120
EOF
    
    # 安装依赖
    log "${YELLOW}  开始安装依赖 (可能需要2-5分钟)...${NC}"
    
    # 分批安装避免内存问题
    local essential_pkgs="Flask flask-cors pymysql python-dotenv"
    local data_pkgs="pandas numpy matplotlib seaborn plotly"
    local api_pkgs="openai litellm requests"
    
    log "  [1/3] 安装核心依赖..."
    $PIP_CMD install $essential_pkgs --quiet --no-cache-dir
    
    log "  [2/3] 安装数据处理库..."
    $PIP_CMD install $data_pkgs --quiet --no-cache-dir
    
    log "  [3/3] 安装API客户端..."
    $PIP_CMD install $api_pkgs --quiet --no-cache-dir
    
    # 如果requirements.txt中有open-interpreter，特殊处理
    if grep -q "open-interpreter" requirements.txt; then
        log "${YELLOW}  注意: open-interpreter需要单独安装${NC}"
        log "  如需安装，请运行:"
        log "  ${CYAN}source $VENV_DIR/bin/activate${NC}"
        log "  ${CYAN}pip install open-interpreter==0.4.3${NC}"
    fi
    
    log "${GREEN}✓ 依赖安装完成${NC}"
}

# 创建配置文件
setup_config() {
    log "${BLUE}[步骤 7/8] 创建配置文件${NC}"
    
    # 创建必要目录
    mkdir -p config logs cache output backend/data
    
    # 创建.env文件
    if [ ! -f ".env" ]; then
        log "  创建环境配置文件..."
        cat > .env << 'EOF'
# API配置
API_KEY=your-api-key-here
API_BASE_URL=https://api.openai.com/v1/
DEFAULT_MODEL=gpt-4

# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_DATABASE=test

# 系统配置
LOG_LEVEL=INFO
LOG_FILE=logs/app.log
CACHE_TTL=3600
OUTPUT_DIR=output
CACHE_DIR=cache

# WSL特殊配置
WSL_BROWSER_PATH=wslview
EOF
        log "${GREEN}✓ .env 文件创建成功${NC}"
    else
        log "${GREEN}✓ 保留现有 .env 配置${NC}"
    fi
    
    # 创建config.json
    if [ ! -f "config/config.json" ]; then
        cat > config/config.json << 'EOF'
{
  "server": {
    "host": "0.0.0.0",
    "port": 5000,
    "debug": false
  },
  "wsl": {
    "enabled": true,
    "browser_command": "wslview",
    "optimize_performance": true
  },
  "features": {
    "smart_routing": {
      "enabled": false
    }
  }
}
EOF
        log "${GREEN}✓ config.json 创建成功${NC}"
    fi
}

# 系统验证
verify_installation() {
    log "${BLUE}[步骤 8/8] 验证安装${NC}"
    
    local checks_passed=0
    local total_checks=5
    
    # 检查虚拟环境
    if [ -d "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/python" ]; then
        log "${GREEN}  ✓ 虚拟环境${NC}"
        ((checks_passed++))
    else
        log "${RED}  ✗ 虚拟环境${NC}"
    fi
    
    # 检查Flask
    if "$VIRTUAL_ENV/bin/python" -c "import flask" 2>/dev/null; then
        log "${GREEN}  ✓ Flask框架${NC}"
        ((checks_passed++))
    else
        log "${RED}  ✗ Flask框架${NC}"
    fi
    
    # 检查配置文件
    if [ -f ".env" ] && [ -f "config/config.json" ]; then
        log "${GREEN}  ✓ 配置文件${NC}"
        ((checks_passed++))
    else
        log "${RED}  ✗ 配置文件${NC}"
    fi
    
    # 检查目录结构
    if [ -d "logs" ] && [ -d "cache" ] && [ -d "output" ]; then
        log "${GREEN}  ✓ 目录结构${NC}"
        ((checks_passed++))
    else
        log "${RED}  ✗ 目录结构${NC}"
    fi
    
    # 检查主程序文件
    if [ -f "backend/app.py" ]; then
        log "${GREEN}  ✓ 主程序${NC}"
        ((checks_passed++))
    else
        log "${RED}  ✗ 主程序${NC}"
    fi
    
    log ""
    if [ $checks_passed -eq $total_checks ]; then
        log "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        log "${GREEN}✓ 安装成功！所有检查通过 ($checks_passed/$total_checks)${NC}"
        log "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    else
        log "${YELLOW}⚠ 安装部分完成 ($checks_passed/$total_checks)${NC}"
    fi
}

# 显示下一步
show_next_steps() {
    log ""
    log "${BOLD}${CYAN}下一步操作:${NC}"
    log ""
    log "1. ${BOLD}配置API密钥${NC}"
    log "   编辑 ${CYAN}.env${NC} 文件，设置你的API密钥"
    log ""
    log "2. ${BOLD}启动服务${NC}"
    log "   运行: ${CYAN}./start_wsl.sh${NC}"
    log "   或:   ${CYAN}./start.sh${NC}"
    log ""
    log "3. ${BOLD}访问应用${NC}"
    log "   浏览器打开: ${BLUE}http://localhost:5000${NC}"
    log ""
    
    # WSL特殊提示
    log "${YELLOW}WSL使用提示:${NC}"
    log "• 如遇权限问题，使用: ${CYAN}chmod +x *.sh${NC}"
    log "• 如遇端口占用，编辑config.json修改端口"
    log "• 建议在Linux文件系统运行以获得最佳性能"
    log ""
    
    # 创建快速启动脚本
    create_start_script
}

# 创建WSL优化的启动脚本
create_start_script() {
    cat > start_wsl.sh << 'EOF'
#!/bin/bash

# QueryGPT WSL快速启动脚本
set -e

# 颜色
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}QueryGPT WSL 启动器${NC}"

# 激活虚拟环境
if [ -d "venv_py310" ]; then
    source venv_py310/bin/activate
elif [ -d "venv" ]; then
    source venv/bin/activate
else
    echo -e "${RED}错误: 虚拟环境不存在${NC}"
    echo "请先运行: ./setup_wsl.sh"
    exit 1
fi

# 查找可用端口
PORT=5000
while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
    PORT=$((PORT + 1))
done

echo -e "${GREEN}使用端口: $PORT${NC}"

# 启动服务
export PORT
export FLASK_APP=backend/app.py

echo -e "${GREEN}启动服务...${NC}"
echo -e "访问: ${BLUE}http://localhost:$PORT${NC}"
echo -e "停止: ${YELLOW}Ctrl+C${NC}"

# 尝试打开浏览器
if command -v wslview >/dev/null 2>&1; then
    sleep 2 && wslview "http://localhost:$PORT" &
elif command -v cmd.exe >/dev/null 2>&1; then
    sleep 2 && cmd.exe /c start "http://localhost:$PORT" &
fi

# 启动Flask
cd backend && python app.py
EOF
    
    chmod +x start_wsl.sh
    log "${GREEN}✓ 创建了WSL优化启动脚本: start_wsl.sh${NC}"
}

# 错误处理
error_exit() {
    log "${RED}错误: $1${NC}"
    log "查看日志: $LOG_FILE"
    exit 1
}

# 清理函数
cleanup() {
    if [ -n "$VIRTUAL_ENV" ]; then
        unset VIRTUAL_ENV
        unset PATH
    fi
}

trap cleanup EXIT

# 主流程
main() {
    print_banner
    verify_wsl
    fix_files
    install_system_deps
    check_python
    setup_venv
    install_dependencies
    setup_config
    verify_installation
    show_next_steps
    
    log "${GREEN}安装日志已保存至: $LOG_FILE${NC}"
}

# 运行主程序
main "$@"