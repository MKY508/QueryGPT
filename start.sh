#!/bin/bash

# QueryGPT 智能启动脚本 - 自动选择最佳启动方式
# Smart Start Script - Auto-select best launch method

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        QueryGPT 智能启动器             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 检测系统并启动
main() {
    # 检测是否首次运行（没有虚拟环境）
    if [ ! -d "venv_py310" ] && [ ! -d "venv" ]; then
        echo -e "${YELLOW}⚠ 首次运行检测${NC}"
        echo ""
        
        # 检测系统类型
        local is_wsl=false
        local is_arm=false
        local arch=$(uname -m)
        
        # 检测 WSL
        if grep -qi microsoft /proc/version 2>/dev/null; then
            is_wsl=true
            echo -e "${GREEN}✓ Windows WSL 环境${NC}"
            
            # WSL 自动修复
            echo -e "${BLUE}自动修复脚本格式...${NC}"
            for script in *.sh; do
                if [ -f "$script" ]; then
                    sed -i 's/\r$//' "$script" 2>/dev/null || true
                fi
            done
            chmod +x *.sh 2>/dev/null || true
        fi
        
        # 检测架构
        if [[ "$arch" == "arm64" ]] || [[ "$arch" == "aarch64" ]]; then
            is_arm=true
            echo -e "${GREEN}✓ ARM 架构检测${NC}"
        fi
        
        echo ""
        echo -e "${BLUE}═══════════════════════════════════════${NC}"
        echo -e "${YELLOW}首次安装需要 5-30 分钟，请耐心等待${NC}"
        echo -e "${BLUE}═══════════════════════════════════════${NC}"
        echo ""
        
        # 根据系统选择安装脚本
        if [ "$is_arm" = true ] && [ -f "setup_arm.sh" ]; then
            echo -e "${GREEN}➜ 执行 ARM 安装脚本...${NC}"
            exec ./setup_arm.sh
        elif [ -f "setup.sh" ]; then
            echo -e "${GREEN}➜ 执行标准安装脚本...${NC}"
            exec ./setup.sh
        else
            echo -e "${RED}错误：找不到安装脚本${NC}"
            exit 1
        fi
    else
        # 环境已存在，快速启动
        echo -e "${GREEN}✓ 检测到已安装环境${NC}"
        echo -e "${GREEN}➜ 快速启动...${NC}"
        echo ""
        
        if [ -f "quick_start.sh" ]; then
            exec ./quick_start.sh
        else
            echo -e "${RED}错误：找不到快速启动脚本${NC}"
            
            # 备用方案：直接启动
            echo -e "${YELLOW}尝试直接启动...${NC}"
            
            # 激活虚拟环境
            if [ -d "venv_py310" ]; then
                source venv_py310/bin/activate
            elif [ -d "venv" ]; then
                source venv/bin/activate
            fi
            
            # 查找端口
            PORT=5000
            for p in 5000 5001 5002 5003 5004 5005; do
                if ! nc -z localhost $p 2>/dev/null; then
                    PORT=$p
                    break
                fi
            done
            
            export PORT
            echo -e "${GREEN}使用端口: $PORT${NC}"
            echo ""
            
            # 启动
            cd backend && python app.py
        fi
    fi
}

# 运行主程序
main