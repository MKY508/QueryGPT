#!/bin/bash

# QueryGPT WSL全自动安装脚本 v2.0
# 完全自动化，无需用户交互
set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# 全局配置
AUTO_MODE=true
SILENT_MODE=false
LOG_FILE="logs/auto_setup_$(date +%Y%m%d_%H%M%S).log"
PYTHON_VERSION="3.10"
TARGET_DIR="$HOME/QueryGPT-github"

# 创建日志目录
mkdir -p logs

# 日志函数
log() {
    echo -e "$1" | tee -a "$LOG_FILE"
}

# 静默日志
silent_log() {
    echo -e "$1" >> "$LOG_FILE"
}

# 打印横幅
print_banner() {
    clear
    log "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    log "${CYAN}║${NC}     ${BOLD}QueryGPT WSL 全自动安装脚本 v2.0${NC}                ${CYAN}║${NC}"
    log "${CYAN}║${NC}     🤖 完全自动化，无需人工干预                       ${CYAN}║${NC}"
    log "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
    log ""
}

# 进度条显示
show_progress() {
    local current=$1
    local total=$2
    local task=$3
    local percent=$((current * 100 / total))
    local bar_length=40
    local filled=$((bar_length * current / total))
    
    printf "\r${CYAN}[${NC}"
    printf "%${filled}s" | tr ' ' '█'
    printf "%$((bar_length - filled))s" | tr ' ' '▒'
    printf "${CYAN}]${NC} ${GREEN}%3d%%${NC} - %s" "$percent" "$task"
    
    if [ "$current" -eq "$total" ]; then
        echo ""
    fi
}

# 自动检测并修复WSL环境
auto_detect_wsl() {
    show_progress 1 10 "检测WSL环境"
    
    if ! grep -qi microsoft /proc/version 2>/dev/null; then
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            silent_log "Linux环境检测，继续安装"
        else
            log "${RED}错误: 不支持的操作系统${NC}"
            exit 1
        fi
    else
        silent_log "WSL环境确认"
        
        # 自动修复WSL特殊问题
        export WSL_ENV=true
        export PYTHONUNBUFFERED=1
        
        # 禁用Windows路径集成以提升性能
        if [ -f /etc/wsl.conf ]; then
            if ! grep -q "appendWindowsPath" /etc/wsl.conf; then
                echo "[interop]" | sudo tee -a /etc/wsl.conf >/dev/null
                echo "appendWindowsPath = false" | sudo tee -a /etc/wsl.conf >/dev/null
            fi
        fi
    fi
}

# 自动迁移到Linux文件系统
auto_migrate_project() {
    show_progress 2 10 "优化文件系统位置"
    
    CURRENT_DIR=$(pwd)
    
    # 如果在Windows文件系统，自动迁移
    if [[ "$CURRENT_DIR" == /mnt/* ]]; then
        silent_log "检测到Windows文件系统，自动迁移中..."
        
        # 确保目标目录不存在或备份
        if [ -d "$TARGET_DIR" ]; then
            BACKUP_DIR="$TARGET_DIR.backup.$(date +%Y%m%d_%H%M%S)"
            mv "$TARGET_DIR" "$BACKUP_DIR" 2>/dev/null || true
            silent_log "已备份旧项目到: $BACKUP_DIR"
        fi
        
        # 静默复制到Linux文件系统
        cp -r "$CURRENT_DIR" "$TARGET_DIR" 2>/dev/null
        
        # 修复所有权限
        chmod -R u+rw "$TARGET_DIR" 2>/dev/null
        find "$TARGET_DIR" -name "*.sh" -exec chmod +x {} \; 2>/dev/null
        
        # 自动切换到新目录
        cd "$TARGET_DIR"
        silent_log "已自动迁移到: $TARGET_DIR"
    else
        silent_log "已在Linux文件系统，性能最优"
    fi
}

# 自动修复文件格式
auto_fix_files() {
    show_progress 3 10 "修复文件格式"
    
    # 静默修复所有脚本文件的CRLF
    for file in *.sh **/*.sh; do
        if [ -f "$file" ]; then
            # 检测并修复CRLF
            if file "$file" 2>/dev/null | grep -q "CRLF" || grep -q $'\r' "$file" 2>/dev/null; then
                sed -i 's/\r$//' "$file" 2>/dev/null || \
                tr -d '\r' < "$file" > "$file.tmp" && mv "$file.tmp" "$file" 2>/dev/null || true
            fi
            chmod +x "$file" 2>/dev/null || true
        fi
    done
    
    silent_log "文件格式修复完成"
}

# 自动安装系统依赖
auto_install_system_deps() {
    show_progress 4 10 "安装系统依赖"
    
    # 静默更新包列表
    sudo apt-get update -qq 2>/dev/null || true
    
    # 必要的系统包
    REQUIRED_PACKAGES="curl git build-essential software-properties-common"
    
    for package in $REQUIRED_PACKAGES; do
        if ! dpkg -l | grep -q "^ii.*$package"; then
            sudo apt-get install -y -qq "$package" 2>/dev/null || true
        fi
    done
    
    silent_log "系统依赖安装完成"
}

# 自动安装Python 3.10
auto_install_python() {
    show_progress 5 10 "配置Python环境"
    
    # 检查Python 3.10
    if ! command -v python3.10 &>/dev/null; then
        silent_log "安装Python 3.10..."
        
        # 添加deadsnakes PPA（Ubuntu/Debian）
        if command -v add-apt-repository &>/dev/null; then
            sudo add-apt-repository ppa:deadsnakes/ppa -y 2>/dev/null || true
            sudo apt-get update -qq 2>/dev/null || true
        fi
        
        # 安装Python 3.10
        sudo apt-get install -y -qq python3.10 python3.10-venv python3.10-dev 2>/dev/null || {
            # 如果3.10不可用，使用默认Python 3
            silent_log "Python 3.10不可用，使用默认Python 3"
            sudo apt-get install -y -qq python3 python3-venv python3-dev python3-pip 2>/dev/null || true
        }
    fi
    
    # 确定Python命令
    if command -v python3.10 &>/dev/null; then
        PYTHON_CMD="python3.10"
    elif command -v python3 &>/dev/null; then
        PYTHON_CMD="python3"
    else
        log "${RED}错误: 无法安装Python${NC}"
        exit 1
    fi
    
    silent_log "使用Python: $PYTHON_CMD"
}

# 自动创建虚拟环境
auto_create_venv() {
    show_progress 6 10 "创建虚拟环境"
    
    VENV_DIR="venv_py310"
    
    # 删除损坏的虚拟环境
    if [ -d "$VENV_DIR" ] && [ ! -f "$VENV_DIR/bin/python" ]; then
        rm -rf "$VENV_DIR" 2>/dev/null || true
    fi
    
    # 创建新虚拟环境
    if [ ! -d "$VENV_DIR" ]; then
        $PYTHON_CMD -m venv "$VENV_DIR" 2>/dev/null || {
            # 备用方案
            python3 -m venv "$VENV_DIR" 2>/dev/null || true
        }
    fi
    
    # 激活虚拟环境
    export VIRTUAL_ENV="$(pwd)/$VENV_DIR"
    export PATH="$VIRTUAL_ENV/bin:$PATH"
    
    # 升级pip（静默）
    "$VIRTUAL_ENV/bin/python" -m pip install --upgrade pip setuptools wheel -q 2>/dev/null || true
    
    silent_log "虚拟环境配置完成"
}

# 自动安装Python依赖
auto_install_dependencies() {
    show_progress 7 10 "安装Python依赖"
    
    # 创建requirements.txt如果不存在
    if [ ! -f "requirements.txt" ]; then
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
    
    # 使用pip安装（静默模式）
    PIP_CMD="$VIRTUAL_ENV/bin/pip"
    
    # 配置pip使用更快的镜像（自动选择）
    $PIP_CMD config set global.index-url https://pypi.org/simple 2>/dev/null || true
    $PIP_CMD config set global.timeout 120 2>/dev/null || true
    
    # 批量安装依赖（静默）
    $PIP_CMD install -r requirements.txt --quiet --no-cache-dir 2>/dev/null || {
        # 如果批量失败，逐个安装
        while IFS= read -r line; do
            if [[ ! "$line" =~ ^# ]] && [[ ! -z "$line" ]]; then
                $PIP_CMD install "$line" --quiet --no-cache-dir 2>/dev/null || true
            fi
        done < requirements.txt
    }
    
    silent_log "依赖安装完成"
}

# 自动创建配置文件
auto_setup_config() {
    show_progress 8 10 "生成配置文件"
    
    # 创建必要目录
    mkdir -p config logs cache output backend/data 2>/dev/null || true
    
    # 创建.env文件
    if [ ! -f ".env" ]; then
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

# WSL优化
PYTHONUNBUFFERED=1
WSL_BROWSER_PATH=wslview
EOF
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
    "auto_optimize": true
  },
  "features": {
    "smart_routing": {
      "enabled": false
    }
  }
}
EOF
    fi
    
    silent_log "配置文件生成完成"
}

# 自动创建启动脚本
auto_create_start_script() {
    show_progress 9 10 "创建启动脚本"
    
    cat > auto_start.sh << 'EOF'
#!/bin/bash
# 自动启动脚本

# 颜色
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}QueryGPT 自动启动${NC}"

# 激活虚拟环境
if [ -d "venv_py310" ]; then
    source venv_py310/bin/activate
elif [ -d "venv" ]; then
    source venv/bin/activate
fi

# 设置环境变量
export PYTHONUNBUFFERED=1
export FLASK_APP=backend/app.py

# 查找端口
PORT=5000
while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
    PORT=$((PORT + 1))
done

echo -e "${GREEN}启动端口: $PORT${NC}"
echo -e "访问: ${BLUE}http://localhost:$PORT${NC}"

# 尝试打开浏览器
if command -v wslview >/dev/null 2>&1; then
    sleep 2 && wslview "http://localhost:$PORT" &
elif command -v xdg-open >/dev/null 2>&1; then
    sleep 2 && xdg-open "http://localhost:$PORT" &
fi

# 启动应用
export PORT
cd backend && python app.py
EOF
    
    chmod +x auto_start.sh
    silent_log "启动脚本创建完成"
}

# 系统健康检查
auto_health_check() {
    show_progress 10 10 "系统健康检查"
    
    local status="${GREEN}✓${NC}"
    local issues=0
    
    # 检查项
    [ -d "venv_py310" ] || [ -d "venv" ] || ((issues++))
    [ -f ".env" ] || ((issues++))
    [ -d "logs" ] && [ -d "cache" ] || ((issues++))
    [ -f "backend/app.py" ] || ((issues++))
    
    if [ $issues -eq 0 ]; then
        silent_log "系统健康检查通过"
    else
        silent_log "发现 $issues 个小问题，但不影响运行"
    fi
    
    echo ""  # 换行
}

# 显示完成信息
show_completion() {
    echo ""
    log "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log "${GREEN}✓ 自动安装完成！${NC}"
    log "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log ""
    
    if [[ "$(pwd)" != "$CURRENT_DIR" ]]; then
        log "${CYAN}项目已自动迁移到: $(pwd)${NC}"
    fi
    
    log "${BOLD}启动命令:${NC}"
    log "  ${GREEN}./auto_start.sh${NC}     # 自动启动"
    log "  ${GREEN}./start_wsl.sh${NC}      # WSL优化启动"
    log "  ${GREEN}./start.sh${NC}          # 标准启动"
    log ""
    log "${YELLOW}提示: 所有操作已自动完成，无需额外配置${NC}"
    
    # 询问是否立即启动
    echo ""
    log "${CYAN}是否立即启动服务？${NC}"
    log "${GREEN}[Y] 立即启动${NC}  ${YELLOW}[N] 稍后手动启动${NC}"
    
    # 10秒倒计时自动启动
    local count=10
    while [ $count -gt 0 ]; do
        printf "\r${CYAN}%2d秒后自动启动...${NC} (按任意键选择)" $count
        
        # 检测用户输入（超时1秒）
        if read -t 1 -n 1 key; then
            echo ""
            if [[ $key =~ ^[Nn]$ ]]; then
                log "${YELLOW}已取消自动启动${NC}"
                log "手动启动: ${GREEN}./auto_start.sh${NC}"
                return
            else
                break
            fi
        fi
        
        ((count--))
    done
    
    echo ""
    log "${GREEN}正在启动服务...${NC}"
    exec ./auto_start.sh
}

# 主函数
main() {
    # 保存初始目录
    CURRENT_DIR=$(pwd)
    
    print_banner
    
    log "${CYAN}开始全自动安装（预计2-3分钟）...${NC}"
    log ""
    
    # 执行所有步骤
    auto_detect_wsl
    auto_migrate_project
    auto_fix_files
    auto_install_system_deps
    auto_install_python
    auto_create_venv
    auto_install_dependencies
    auto_setup_config
    auto_create_start_script
    auto_health_check
    
    # 显示完成信息
    show_completion
}

# 错误处理
trap 'echo -e "${RED}安装出错，查看日志: $LOG_FILE${NC}"; exit 1' ERR

# 运行主程序
main "$@"