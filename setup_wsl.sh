#!/bin/bash

# QueryGPT WSL专用安装脚本 v2.0 - 全自动版本
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
AUTO_MODE=true  # 默认自动模式
TARGET_DIR="$HOME/QueryGPT-github"

# 创建日志目录
mkdir -p logs

# 记录日志
log() {
    echo -e "$1" | tee -a "$LOG_FILE"
}

# 静默日志（仅写入文件）
silent_log() {
    echo -e "$1" >> "$LOG_FILE"
}

# 打印横幅
print_banner() {
    clear
    log "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    log "${CYAN}║${NC}     ${BOLD}QueryGPT WSL Setup v2.0 - 全自动版${NC}              ${CYAN}║${NC}"
    log "${CYAN}║${NC}     🤖 自动检测并优化所有设置                         ${CYAN}║${NC}"
    log "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
    log ""
}

# WSL环境验证（自动版）
verify_wsl() {
    log "${BLUE}[步骤 1/8] 自动检测环境${NC}"
    
    if ! grep -qi microsoft /proc/version 2>/dev/null; then
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            log "${GREEN}✓ Linux环境，继续安装${NC}"
        else
            log "${RED}✗ 错误: 不支持的操作系统${NC}"
            exit 1
        fi
    else
        log "${GREEN}✓ WSL环境确认${NC}"
    fi
    
    # 自动迁移到Linux文件系统（如果需要）
    if [[ "$SCRIPT_DIR" == /mnt/* ]]; then
        log "${YELLOW}检测到Windows文件系统，自动迁移以提升性能...${NC}"
        
        # 自动迁移
        if [ ! -d "$TARGET_DIR" ]; then
            log "  正在复制文件到 $TARGET_DIR ..."
            cp -r "$SCRIPT_DIR" "$TARGET_DIR" 2>/dev/null
            chmod -R u+rw "$TARGET_DIR" 2>/dev/null
            find "$TARGET_DIR" -name "*.sh" -exec chmod +x {} \; 2>/dev/null
            
            cd "$TARGET_DIR"
            SCRIPT_DIR="$TARGET_DIR"
            log "${GREEN}✓ 已自动迁移到Linux文件系统${NC}"
        else
            # 如果目标已存在，直接使用
            cd "$TARGET_DIR"
            SCRIPT_DIR="$TARGET_DIR"
            log "${GREEN}✓ 使用现有Linux文件系统目录${NC}"
        fi
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

# 安装系统依赖（自动版）
install_system_deps() {
    log "${BLUE}[步骤 3/8] 自动安装系统依赖${NC}"
    
    # 自动更新包列表（静默）
    sudo apt-get update -qq 2>/dev/null || true
    
    # 必要的包
    local required_packages="curl git python3 build-essential"
    
    # 自动安装缺失的包
    for package in $required_packages; do
        if ! dpkg -l | grep -q "^ii.*$package"; then
            log "  安装 $package..."
            sudo apt-get install -y -qq "$package" 2>/dev/null || true
        fi
    done
    
    # WSL特殊：自动安装wslu（如果可用）
    if command -v wsl.exe &>/dev/null; then
        if ! command -v wslview &>/dev/null; then
            sudo apt-get install -y -qq wslu 2>/dev/null || true
        fi
    fi
    
    log "${GREEN}✓ 系统依赖已自动配置${NC}"
}

# 检查Python版本（自动版）
check_python() {
    log "${BLUE}[步骤 4/8] 自动配置Python环境${NC}"
    
    # 自动安装Python 3.10（如果需要）
    if ! command -v python3.10 &>/dev/null; then
        log "  自动安装Python 3.10..."
        
        # 尝试添加deadsnakes PPA（Ubuntu/Debian）
        if command -v add-apt-repository &>/dev/null; then
            sudo add-apt-repository ppa:deadsnakes/ppa -y 2>/dev/null || true
            sudo apt-get update -qq 2>/dev/null || true
        fi
        
        # 安装Python 3.10
        sudo apt-get install -y -qq python3.10 python3.10-venv python3.10-dev 2>/dev/null || {
            # 如果3.10不可用，使用默认Python 3
            sudo apt-get install -y -qq python3 python3-venv python3-dev python3-pip 2>/dev/null || true
        }
    fi
    
    # 确定Python命令
    if command -v python3.10 &>/dev/null; then
        PYTHON_CMD="python3.10"
        log "${GREEN}✓ 使用 Python 3.10${NC}"
    elif command -v python3 &>/dev/null; then
        PYTHON_CMD="python3"
        local version=$(python3 --version 2>&1 | grep -Po '\d+\.\d+\.\d+')
        log "${GREEN}✓ 使用 Python $version${NC}"
    else
        log "${RED}✗ 无法安装Python${NC}"
        exit 1
    fi
    
    # 自动安装pip和venv（如果需要）
    if ! $PYTHON_CMD -m pip --version &>/dev/null; then
        sudo apt-get install -y -qq python3-pip 2>/dev/null || true
    fi
    
    if ! $PYTHON_CMD -m venv --help &>/dev/null; then
        sudo apt-get install -y -qq python3-venv 2>/dev/null || true
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

# 显示下一步（自动版）
show_next_steps() {
    log ""
    log "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log "${GREEN}✓ 安装完成！${NC}"
    log "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    if [[ "$(pwd)" != "$SCRIPT_DIR" ]]; then
        log "${CYAN}项目已自动优化到: $(pwd)${NC}"
    fi
    
    # 创建快速启动脚本
    create_start_script
    
    log ""
    log "${CYAN}10秒后自动启动服务...${NC}"
    log "${YELLOW}按 Ctrl+C 取消自动启动${NC}"
    
    # 10秒倒计时自动启动
    local count=10
    while [ $count -gt 0 ]; do
        printf "\r${CYAN}%2d秒后启动...${NC}" $count
        if ! sleep 1; then
            log ""
            log "${YELLOW}已取消自动启动${NC}"
            log "手动启动: ${GREEN}./start_wsl.sh${NC}"
            return
        fi
        ((count--))
    done
    
    log ""
    log "${GREEN}正在启动服务...${NC}"
    
    # 自动启动
    if [ -f "start_wsl.sh" ]; then
        exec ./start_wsl.sh
    else
        # 备用启动
        source venv_py310/bin/activate 2>/dev/null || source venv/bin/activate
        export PYTHONUNBUFFERED=1
        export PORT=5000
        cd backend && python app.py
    fi
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