#!/bin/bash

# QueryGPT 一键启动脚本 - 真·懒人模式
# One-Click Start Script - Real Lazy Mode

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        QueryGPT 一键启动中...          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 检测系统类型
detect_and_run() {
    local is_wsl=false
    local is_mac=false
    local is_arm=false
    local arch=$(uname -m)
    
    # 检测 WSL
    if grep -qi microsoft /proc/version 2>/dev/null; then
        is_wsl=true
        echo -e "${GREEN}✓ Windows WSL 环境${NC}"
    # 检测 macOS
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        is_mac=true
        echo -e "${GREEN}✓ macOS 环境${NC}"
        # 检测 Apple Silicon
        if [[ "$arch" == "arm64" ]]; then
            is_arm=true
            echo -e "${GREEN}✓ Apple Silicon (M系列芯片)${NC}"
        fi
    # Linux
    else
        echo -e "${GREEN}✓ Linux 环境${NC}"
        if [[ "$arch" == "aarch64" ]] || [[ "$arch" == "arm64" ]]; then
            is_arm=true
            echo -e "${GREEN}✓ ARM 架构${NC}"
        fi
    fi
    
    echo ""
    
    # WSL 特殊处理
    if [ "$is_wsl" = true ]; then
        # 修复换行符（如果需要）
        if file "$0" 2>/dev/null | grep -q "CRLF"; then
            echo -e "${YELLOW}修复脚本格式...${NC}"
            for script in *.sh; do
                if [ -f "$script" ]; then
                    sed -i 's/\r$//' "$script" 2>/dev/null || true
                fi
            done
        fi
        
        # 确保执行权限
        chmod +x *.sh 2>/dev/null || true
    fi
    
    # 检查虚拟环境
    if [ -d "venv_py310" ] || [ -d "venv" ]; then
        # 环境已存在，快速启动
        echo -e "${GREEN}✓ 检测到已安装环境，直接启动...${NC}"
        echo ""
        
        if [ "$is_wsl" = true ] && [ -f "start_windows.sh" ]; then
            exec ./start_windows.sh
        elif [ -f "quick_start.sh" ]; then
            exec ./quick_start.sh
        else
            echo -e "${RED}错误：找不到启动脚本${NC}"
            exit 1
        fi
    else
        # 首次安装
        echo -e "${YELLOW}⚠ 首次运行，开始自动安装...${NC}"
        echo -e "${YELLOW}  这可能需要 5-30 分钟，请耐心等待${NC}"
        echo ""
        
        # 根据系统选择安装脚本
        if [ "$is_wsl" = true ]; then
            # Windows WSL
            if [ -f "start_windows.sh" ]; then
                echo -e "${BLUE}执行 Windows 安装...${NC}"
                exec ./start_windows.sh
            fi
        elif [ "$is_arm" = true ]; then
            # ARM 架构
            if [ -f "setup_arm.sh" ]; then
                echo -e "${BLUE}执行 ARM 架构安装...${NC}"
                echo -e "${YELLOW}提示：ARM 需要编译，时间较长${NC}"
                exec ./setup_arm.sh
            fi
        else
            # x86 标准安装
            if [ -f "setup.sh" ]; then
                echo -e "${BLUE}执行标准安装...${NC}"
                exec ./setup.sh
            fi
        fi
        
        # 如果没有找到合适的脚本，尝试通用方案
        echo -e "${YELLOW}使用通用安装方案...${NC}"
        
        # 创建虚拟环境
        if command -v python3.10 >/dev/null 2>&1; then
            python3.10 -m venv venv_py310
            source venv_py310/bin/activate
        elif command -v python3 >/dev/null 2>&1; then
            python3 -m venv venv
            source venv/bin/activate
        else
            echo -e "${RED}错误：未找到 Python3${NC}"
            echo "请先安装 Python 3.10"
            exit 1
        fi
        
        # 安装依赖
        pip install --upgrade pip
        pip install -r requirements.txt
        
        # 复制配置文件
        [ ! -f ".env" ] && [ -f ".env.example" ] && cp .env.example .env
        [ ! -f "config/config.json" ] && [ -f "config/config.example.json" ] && cp config/config.example.json config/config.json
        [ ! -f "config/models.json" ] && [ -f "config/models.example.json" ] && cp config/models.example.json config/models.json
        
        echo ""
        echo -e "${GREEN}✓ 安装完成！正在启动...${NC}"
        
        # 启动应用
        cd backend && python app.py
    fi
}

# 运行主程序
detect_and_run