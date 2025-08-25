#!/bin/bash

# QueryGPT 智能初始化脚本 / Intelligent Setup Script
# 作者 / Author: MKY508
# 版本 / Version: 2.0.0

# 颜色定义 / Color Definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# 全局变量 / Global Variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PYTHON_CMD=""
IS_FIRST_RUN=false
BACKUP_SUFFIX=$(date +%Y%m%d_%H%M%S)
ERRORS_FOUND=false
WARNINGS_FOUND=false

# 进度条函数 / Progress Bar Function
show_progress() {
    local current=$1
    local total=$2
    local width=50
    local percentage=$((current * 100 / total))
    local completed=$((width * current / total))
    
    printf "\r["
    printf "%${completed}s" | tr ' ' '='
    printf "%$((width - completed))s" | tr ' ' ' '
    printf "] %d%%" "$percentage"
    
    if [ "$current" -eq "$total" ]; then
        echo ""
    fi
}

# 显示旋转动画 / Show Spinner
spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='|/-\'
    while [ "$(ps a | awk '{print $1}' | grep $pid)" ]; do
        local temp=${spinstr#?}
        printf " [%c]  " "$spinstr"
        local spinstr=$temp${spinstr%"$temp"}
        sleep $delay
        printf "\b\b\b\b\b\b"
    done
    printf "    \b\b\b\b"
}

# 打印带颜色的消息 / Print Colored Message
print_message() {
    local type=$1
    local message=$2
    case $type in
        "success")
            echo -e "${GREEN}✓${NC} $message"
            ;;
        "error")
            echo -e "${RED}✗${NC} $message"
            ERRORS_FOUND=true
            ;;
        "warning")
            echo -e "${YELLOW}⚠${NC} $message"
            WARNINGS_FOUND=true
            ;;
        "info")
            echo -e "${BLUE}ℹ${NC} $message"
            ;;
        "header")
            echo -e "${BOLD}${CYAN}$message${NC}"
            ;;
        "step")
            echo -e "${MAGENTA}►${NC} $message"
            ;;
    esac
}

# 打印横幅 / Print Banner
print_banner() {
    echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}           ${BOLD}QueryGPT v1.0.0-beta${NC}                       ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}           智能初始化脚本 v2.0.0                       ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}           Intelligent Setup Script                    ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# 检查是否首次运行 / Check if First Run
check_first_run() {
    print_message "header" "检查运行状态 / Checking Run Status"
    
    local first_run_indicators=0
    local total_indicators=3
    
    if [ ! -d "venv_py310" ] && [ ! -d "venv" ]; then
        ((first_run_indicators++))
        print_message "info" "未检测到虚拟环境 / No virtual environment detected"
    fi
    
    if [ ! -f ".env" ]; then
        ((first_run_indicators++))
        print_message "info" "未检测到配置文件 / No configuration file detected"
    fi
    
    if [ ! -d "logs" ] || [ ! -d "cache" ]; then
        ((first_run_indicators++))
        print_message "info" "未检测到必要目录 / Required directories not detected"
    fi
    
    if [ $first_run_indicators -ge 2 ]; then
        IS_FIRST_RUN=true
        print_message "info" "检测到首次运行，将执行完整初始化 / First run detected, performing full initialization"
    else
        print_message "success" "检测到现有安装，将执行智能更新 / Existing installation detected, performing smart update"
    fi
    echo ""
}

# 检查 Python 版本 / Check Python Version
check_python() {
    print_message "header" "检查 Python 环境 / Checking Python Environment"
    
    local python_found=false
    local python_version=""
    
    # 优先检查 python3.10
    if command -v python3.10 &> /dev/null; then
        PYTHON_CMD="python3.10"
        python_version=$(python3.10 -V 2>&1 | grep -Po '\d+\.\d+\.\d+')
        python_found=true
        print_message "success" "找到 Python 3.10: $python_version"
    elif command -v python3 &> /dev/null; then
        python_version=$(python3 -V 2>&1 | grep -Po '\d+\.\d+\.\d+')
        local major=$(echo $python_version | cut -d. -f1)
        local minor=$(echo $python_version | cut -d. -f2)
        
        if [ "$major" -eq 3 ] && [ "$minor" -eq 10 ]; then
            PYTHON_CMD="python3"
            python_found=true
            print_message "success" "找到 Python $python_version"
        else
            print_message "warning" "Python 版本不匹配: $python_version (需要 3.10.x)"
            print_message "info" "OpenInterpreter 0.4.3 需要 Python 3.10.x"
            
            read -p "$(echo -e ${YELLOW}是否继续？这可能导致兼容性问题 / Continue? This may cause compatibility issues [y/N]: ${NC})" -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                PYTHON_CMD="python3"
                python_found=true
                print_message "warning" "使用 Python $python_version 继续"
            else
                print_message "error" "安装已取消 / Installation cancelled"
                exit 1
            fi
        fi
    fi
    
    if [ "$python_found" = false ]; then
        print_message "error" "未找到 Python 3 / Python 3 not found"
        print_message "info" "请安装 Python 3.10.x: https://www.python.org/downloads/"
        exit 1
    fi
    
    # 检查 pip
    if ! $PYTHON_CMD -m pip --version &> /dev/null; then
        print_message "warning" "pip 未安装，尝试安装... / pip not installed, attempting to install..."
        $PYTHON_CMD -m ensurepip --default-pip
    fi
    
    echo ""
}

# 创建或更新虚拟环境 / Create or Update Virtual Environment
setup_venv() {
    print_message "header" "配置虚拟环境 / Configuring Virtual Environment"
    
    local venv_dir="venv_py310"
    
    if [ -d "$venv_dir" ]; then
        print_message "info" "检查现有虚拟环境... / Checking existing virtual environment..."
        
        # 检查虚拟环境是否可用
        if [ -f "$venv_dir/bin/activate" ]; then
            source "$venv_dir/bin/activate"
            local venv_python_version=$(python -V 2>&1 | grep -Po '\d+\.\d+')
            
            if [[ "$venv_python_version" == "3.10" ]]; then
                print_message "success" "虚拟环境有效 (Python $venv_python_version)"
            else
                print_message "warning" "虚拟环境 Python 版本不匹配: $venv_python_version"
                read -p "$(echo -e ${YELLOW}是否重新创建虚拟环境？/ Recreate virtual environment? [Y/n]: ${NC})" -n 1 -r
                echo
                if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                    rm -rf "$venv_dir"
                    $PYTHON_CMD -m venv "$venv_dir"
                    print_message "success" "虚拟环境已重新创建 / Virtual environment recreated"
                fi
            fi
        else
            print_message "error" "虚拟环境损坏，重新创建... / Virtual environment corrupted, recreating..."
            rm -rf "$venv_dir"
            $PYTHON_CMD -m venv "$venv_dir"
            print_message "success" "虚拟环境已重新创建 / Virtual environment recreated"
        fi
    else
        print_message "info" "创建新的虚拟环境... / Creating new virtual environment..."
        $PYTHON_CMD -m venv "$venv_dir" &
        spinner $!
        print_message "success" "虚拟环境创建成功 / Virtual environment created"
    fi
    
    # 激活虚拟环境
    source "$venv_dir/bin/activate"
    echo ""
}

# 智能安装依赖 / Smart Install Dependencies
install_dependencies() {
    print_message "header" "管理项目依赖 / Managing Dependencies"
    
    if [ ! -f "requirements.txt" ]; then
        print_message "warning" "未找到 requirements.txt / requirements.txt not found"
        return
    fi
    
    print_message "info" "升级 pip... / Upgrading pip..."
    pip install --upgrade pip --quiet
    
    # 检查已安装的包
    print_message "info" "检查依赖状态... / Checking dependency status..."
    
    local total_deps=$(grep -c "^[^#]" requirements.txt)
    local current=0
    local need_install=false
    
    while IFS= read -r line; do
        if [[ ! "$line" =~ ^#.*$ ]] && [[ -n "$line" ]]; then
            ((current++))
            package_name=$(echo "$line" | sed 's/[<>=!].*//')
            
            if ! pip show "$package_name" &> /dev/null; then
                need_install=true
                break
            fi
        fi
    done < requirements.txt
    
    if [ "$need_install" = true ] || [ "$IS_FIRST_RUN" = true ]; then
        print_message "info" "安装/更新依赖包... / Installing/updating dependencies..."
        
        # 特别处理 OpenInterpreter
        if grep -q "open-interpreter" requirements.txt; then
            print_message "warning" "检测到 OpenInterpreter，确保使用 0.4.3 版本"
            pip install "open-interpreter==0.4.3" --quiet
        fi
        
        # 安装其他依赖
        pip install -r requirements.txt --quiet &
        local pip_pid=$!
        
        # 显示进度
        while kill -0 $pip_pid 2>/dev/null; do
            printf "."
            sleep 1
        done
        echo ""
        
        wait $pip_pid
        local pip_status=$?
        
        if [ $pip_status -eq 0 ]; then
            print_message "success" "依赖安装完成 / Dependencies installed"
        else
            print_message "error" "部分依赖安装失败 / Some dependencies failed to install"
            print_message "info" "请检查 requirements.txt 并手动安装失败的包"
        fi
    else
        print_message "success" "所有依赖已是最新 / All dependencies up to date"
    fi
    
    # 版本兼容性检查
    print_message "info" "检查版本兼容性... / Checking version compatibility..."
    
    if pip show open-interpreter &> /dev/null; then
        local oi_version=$(pip show open-interpreter | grep Version | awk '{print $2}')
        if [[ "$oi_version" != "0.4.3" ]]; then
            print_message "warning" "OpenInterpreter 版本不匹配: $oi_version (需要 0.4.3)"
        else
            print_message "success" "OpenInterpreter 版本正确: 0.4.3"
        fi
    fi
    
    echo ""
}

# 创建必要的目录 / Create Necessary Directories
create_directories() {
    print_message "header" "检查目录结构 / Checking Directory Structure"
    
    local dirs=("logs" "cache" "output" "backend/data" "config" "backup")
    local created=0
    
    for dir in "${dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            ((created++))
            print_message "success" "创建目录 / Created: $dir"
        fi
    done
    
    if [ $created -eq 0 ]; then
        print_message "success" "所有必要目录已存在 / All required directories exist"
    fi
    
    # 检查目录权限
    print_message "info" "检查目录权限... / Checking directory permissions..."
    
    for dir in "${dirs[@]}"; do
        if [ -d "$dir" ]; then
            if [ ! -w "$dir" ]; then
                print_message "warning" "目录不可写 / Directory not writable: $dir"
                chmod u+w "$dir"
                print_message "success" "已修复权限 / Permissions fixed: $dir"
            fi
        fi
    done
    
    echo ""
}

# 智能配置管理 / Smart Configuration Management
setup_env() {
    print_message "header" "管理配置文件 / Managing Configuration"
    
    local env_file=".env"
    local env_example=".env.example"
    
    # 创建示例文件
    cat > "$env_example" << 'EOF'
# API配置 (默认使用 GPT-4.1)
API_KEY=your-api-key-here
API_BASE_URL=https://api.openai.com/v1/
DEFAULT_MODEL=gpt-4.1

# 数据库配置（请修改为您的实际配置）
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=test_db

# 日志配置
LOG_LEVEL=INFO
LOG_FILE=logs/app.log
LOG_MAX_SIZE=10485760
LOG_BACKUP_COUNT=5

# 缓存配置
CACHE_TTL=3600
CACHE_MAX_SIZE=104857600

# 输出目录
OUTPUT_DIR=output
CACHE_DIR=cache

# 开发模式
DEBUG=false
TESTING=false
EOF
    
    if [ -f "$env_file" ]; then
        print_message "info" "检测到现有配置文件 / Existing configuration detected"
        
        # 备份现有配置
        local backup_file="backup/.env.backup.$BACKUP_SUFFIX"
        mkdir -p backup
        cp "$env_file" "$backup_file"
        print_message "success" "配置已备份至 / Configuration backed up to: $backup_file"
        
        # 智能合并配置
        print_message "info" "更新缺失的配置项... / Updating missing configuration items..."
        
        # 读取现有配置
        declare -A existing_config
        while IFS='=' read -r key value; do
            if [[ ! "$key" =~ ^#.*$ ]] && [[ -n "$key" ]]; then
                existing_config["$key"]="$value"
            fi
        done < "$env_file"
        
        # 检查并添加缺失的配置
        local updated=false
        while IFS='=' read -r key default_value; do
            if [[ ! "$key" =~ ^#.*$ ]] && [[ -n "$key" ]]; then
                if [ -z "${existing_config[$key]}" ]; then
                    echo "$key=$default_value" >> "$env_file"
                    print_message "info" "添加配置项 / Added config: $key"
                    updated=true
                fi
            fi
        done < "$env_example"
        
        if [ "$updated" = false ]; then
            print_message "success" "配置文件已是最新 / Configuration is up to date"
        else
            print_message "success" "配置文件已更新 / Configuration updated"
        fi
    else
        print_message "info" "创建新配置文件... / Creating new configuration file..."
        cp "$env_example" "$env_file"
        print_message "success" "配置文件已创建 / Configuration file created"
        print_message "warning" "请编辑 .env 文件配置您的 API 密钥和数据库信息"
        print_message "warning" "Please edit .env file to configure your API keys and database"
    fi
    
    echo ""
}

# 配置模型设置 / Configure Model Settings
setup_models() {
    print_message "header" "配置模型设置 / Configuring Model Settings"
    
    local models_file="config/models.json"
    
    if [ -f "$models_file" ]; then
        print_message "info" "检测到现有模型配置 / Existing model configuration detected"
        
        # 备份现有配置
        local backup_file="backup/models.json.backup.$BACKUP_SUFFIX"
        mkdir -p backup
        cp "$models_file" "$backup_file"
        print_message "success" "模型配置已备份至 / Model config backed up to: $backup_file"
    else
        print_message "info" "创建默认模型配置... / Creating default model configuration..."
        
        mkdir -p config
        cat > "$models_file" << 'EOF'
{
  "models": [
    {
      "id": "gpt-4.1",
      "name": "GPT-4.1",
      "type": "openai",
      "api_base": "https://api.openai.com/v1/",
      "api_key": "your-openai-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    },
    {
      "id": "claude-sonnet-4",
      "name": "Claude Sonnet 4",
      "type": "anthropic",
      "api_base": "https://api.anthropic.com/v1",
      "api_key": "your-anthropic-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    },
    {
      "id": "deepseek-r1",
      "name": "DeepSeek R1",
      "type": "deepseek",
      "api_base": "https://api.deepseek.com/v1",
      "api_key": "your-deepseek-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    },
    {
      "id": "ollama-local",
      "name": "Ollama (Local)",
      "type": "ollama",
      "api_base": "http://localhost:11434/v1",
      "api_key": "not_needed_for_local",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    },
    {
      "id": "custom-model",
      "name": "Custom Model",
      "type": "custom",
      "api_base": "http://localhost:8000/v1",
      "api_key": "your-custom-api-key-here",
      "max_tokens": 4096,
      "temperature": 0.7,
      "status": "inactive"
    }
  ]
}
EOF
        print_message "success" "模型配置已创建 / Model configuration created"
    fi
    
    echo ""
}

# 验证数据库连接 / Validate Database Connection
test_database_connection() {
    print_message "header" "测试数据库连接 / Testing Database Connection"
    
    if [ ! -f ".env" ]; then
        print_message "warning" "跳过数据库测试（配置文件不存在）/ Skipping database test (no config file)"
        return
    fi
    
    # 读取数据库配置
    source .env 2>/dev/null
    
    if [ -z "$DB_HOST" ] || [ "$DB_PASSWORD" = "your_password" ]; then
        print_message "warning" "数据库未配置 / Database not configured"
        print_message "info" "请在 .env 文件中配置数据库信息"
        return
    fi
    
    # 测试连接
    print_message "info" "连接到 $DB_HOST:$DB_PORT... / Connecting to $DB_HOST:$DB_PORT..."
    
    python3 -c "
import os
import sys
try:
    import pymysql
    conn = pymysql.connect(
        host='$DB_HOST',
        port=int('$DB_PORT'),
        user='$DB_USER',
        password='$DB_PASSWORD',
        database='$DB_DATABASE'
    )
    conn.close()
    print('success')
except ImportError:
    print('no_pymysql')
except Exception as e:
    print(f'error:{e}')
" 2>/dev/null | while read result; do
    if [[ "$result" == "success" ]]; then
        print_message "success" "数据库连接成功 / Database connection successful"
    elif [[ "$result" == "no_pymysql" ]]; then
        print_message "warning" "PyMySQL 未安装，跳过数据库测试 / PyMySQL not installed, skipping test"
    else
        print_message "error" "数据库连接失败 / Database connection failed"
        print_message "info" "请检查数据库配置和服务状态"
    fi
done
    
    echo ""
}

# 验证 API 密钥 / Validate API Keys
test_api_keys() {
    print_message "header" "验证 API 密钥 / Validating API Keys"
    
    if [ ! -f ".env" ]; then
        print_message "warning" "跳过 API 验证（配置文件不存在）/ Skipping API validation (no config file)"
        return
    fi
    
    source .env 2>/dev/null
    
    if [ "$API_KEY" = "your-api-key-here" ]; then
        print_message "warning" "API 密钥未配置 / API key not configured"
        print_message "info" "请在 .env 文件中配置您的 API 密钥"
    else
        print_message "info" "检测到 API 密钥配置 / API key configured"
        
        # 简单验证密钥格式
        if [[ ${#API_KEY} -lt 20 ]]; then
            print_message "warning" "API 密钥格式可能不正确 / API key format may be incorrect"
        else
            print_message "success" "API 密钥格式正确 / API key format valid"
        fi
    fi
    
    echo ""
}

# 系统健康检查 / System Health Check
system_health_check() {
    print_message "header" "系统健康检查 / System Health Check"
    
    local health_score=0
    local max_score=5
    
    # 检查虚拟环境
    if [ -d "venv_py310" ] || [ -d "venv" ]; then
        ((health_score++))
        print_message "success" "虚拟环境 / Virtual environment: OK"
    else
        print_message "error" "虚拟环境 / Virtual environment: Missing"
    fi
    
    # 检查配置文件
    if [ -f ".env" ]; then
        ((health_score++))
        print_message "success" "配置文件 / Configuration: OK"
    else
        print_message "error" "配置文件 / Configuration: Missing"
    fi
    
    # 检查必要目录
    if [ -d "logs" ] && [ -d "cache" ] && [ -d "output" ]; then
        ((health_score++))
        print_message "success" "目录结构 / Directory structure: OK"
    else
        print_message "warning" "目录结构 / Directory structure: Incomplete"
    fi
    
    # 检查依赖
    if pip show flask &> /dev/null; then
        ((health_score++))
        print_message "success" "核心依赖 / Core dependencies: OK"
    else
        print_message "error" "核心依赖 / Core dependencies: Missing"
    fi
    
    # 检查磁盘空间
    local available_space=$(df -h . | awk 'NR==2 {print $4}')
    print_message "info" "可用磁盘空间 / Available disk space: $available_space"
    ((health_score++))
    
    echo ""
    print_message "info" "健康评分 / Health Score: $health_score/$max_score"
    
    if [ $health_score -eq $max_score ]; then
        print_message "success" "系统状态良好 / System is healthy"
    elif [ $health_score -ge 3 ]; then
        print_message "warning" "系统基本就绪，部分组件需要配置 / System mostly ready, some configuration needed"
    else
        print_message "error" "系统未就绪，需要完成初始化 / System not ready, initialization needed"
    fi
    
    echo ""
}

# 生成启动脚本 / Generate Start Script
generate_start_script() {
    if [ ! -f "start.sh" ]; then
        print_message "info" "生成启动脚本... / Generating start script..."
        
        cat > start.sh << 'EOF'
#!/bin/bash

# 激活虚拟环境
if [ -d "venv_py310" ]; then
    source venv_py310/bin/activate
elif [ -d "venv" ]; then
    source venv/bin/activate
else
    echo "错误：未找到虚拟环境 / Error: Virtual environment not found"
    exit 1
fi

# 加载环境变量
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# 启动应用
echo "启动 QueryGPT... / Starting QueryGPT..."
python backend/app.py
EOF
        
        chmod +x start.sh
        print_message "success" "启动脚本已创建 / Start script created"
    fi
}

# 显示最终报告 / Show Final Report
show_final_report() {
    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}              ${BOLD}初始化完成报告${NC}                          ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}              Installation Complete                    ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    if [ "$ERRORS_FOUND" = true ]; then
        print_message "error" "发现错误，请查看上方详细信息 / Errors found, please review details above"
    fi
    
    if [ "$WARNINGS_FOUND" = true ]; then
        print_message "warning" "发现警告，建议处理 / Warnings found, recommended to address"
    fi
    
    if [ "$ERRORS_FOUND" = false ] && [ "$WARNINGS_FOUND" = false ]; then
        print_message "success" "初始化成功完成！/ Setup completed successfully!"
    fi
    
    echo ""
    print_message "header" "下一步操作 / Next Steps:"
    echo ""
    
    if [ "$API_KEY" = "your-api-key-here" ] || [ ! -f ".env" ]; then
        echo "  1. 配置 API 密钥 / Configure API keys:"
        echo "     编辑 / Edit: .env"
        echo ""
    fi
    
    if [ "$DB_PASSWORD" = "your_password" ] || [ ! -f ".env" ]; then
        echo "  2. 配置数据库 / Configure database:"
        echo "     编辑 / Edit: .env"
        echo ""
    fi
    
    echo "  3. 启动服务 / Start service:"
    echo "     ${GREEN}./start.sh${NC}"
    echo ""
    echo "  4. 访问应用 / Access application:"
    echo "     ${BLUE}http://localhost:5007${NC}"
    echo ""
    
    if [ "$IS_FIRST_RUN" = true ]; then
        print_message "info" "首次安装提示 / First Installation Tips:"
        echo "  • 查看文档 / View docs: README.md"
        echo "  • 运行测试 / Run tests: pytest"
        echo "  • 查看日志 / View logs: tail -f logs/app.log"
    fi
    
    echo ""
    print_message "header" "技术支持 / Support:"
    echo "  GitHub: https://github.com/MKY508/QueryGPT"
    echo "  作者 / Author: MKY508"
    echo ""
}

# 清理函数 / Cleanup Function
cleanup() {
    if [ -n "$VIRTUAL_ENV" ]; then
        deactivate 2>/dev/null
    fi
}

# 错误处理 / Error Handler
error_handler() {
    local line_no=$1
    print_message "error" "脚本在第 $line_no 行出错 / Script failed at line $line_no"
    cleanup
    exit 1
}

# 设置错误处理
trap 'error_handler $LINENO' ERR
trap cleanup EXIT

# 主函数 / Main Function
main() {
    # 清屏并显示横幅
    clear
    print_banner
    
    # 检查是否首次运行
    check_first_run
    
    # 检查 Python 环境
    check_python
    
    # 设置虚拟环境
    setup_venv
    
    # 安装依赖
    install_dependencies
    
    # 创建目录
    create_directories
    
    # 配置环境
    setup_env
    
    # 配置模型
    setup_models
    
    # 生成启动脚本
    generate_start_script
    
    # 运行测试
    if [ "$IS_FIRST_RUN" = false ]; then
        test_database_connection
        test_api_keys
    fi
    
    # 系统健康检查
    system_health_check
    
    # 显示最终报告
    show_final_report
}

# 处理命令行参数
case "${1:-}" in
    --help|-h)
        echo "QueryGPT 智能安装脚本"
        echo "用法: ./setup.sh [选项]"
        echo ""
        echo "选项:"
        echo "  --help, -h      显示帮助信息"
        echo "  --force, -f     强制重新安装"
        echo "  --check, -c     仅执行健康检查"
        echo "  --update, -u    仅更新依赖"
        echo ""
        exit 0
        ;;
    --force|-f)
        print_message "warning" "强制重新安装模式 / Force reinstall mode"
        IS_FIRST_RUN=true
        main
        ;;
    --check|-c)
        print_banner
        system_health_check
        ;;
    --update|-u)
        print_banner
        setup_venv
        install_dependencies
        print_message "success" "依赖更新完成 / Dependencies updated"
        ;;
    *)
        main
        ;;
esac