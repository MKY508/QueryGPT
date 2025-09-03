#!/bin/bash

# WSL Python 3.10安装和项目迁移脚本
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     WSL Python 3.10 安装和优化脚本        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# 1. 安装Python 3.10（如果需要）
install_python310() {
    echo -e "${YELLOW}[1/3] 安装Python 3.10...${NC}"
    
    # 检查是否已安装
    if command -v python3.10 &>/dev/null; then
        echo -e "${GREEN}✓ Python 3.10已安装${NC}"
        return 0
    fi
    
    # 添加deadsnakes PPA（提供Python 3.10）
    echo -e "${BLUE}添加Python 3.10源...${NC}"
    sudo add-apt-repository ppa:deadsnakes/ppa -y
    sudo apt-get update
    
    # 安装Python 3.10和相关包
    echo -e "${BLUE}安装Python 3.10...${NC}"
    sudo apt-get install -y python3.10 python3.10-venv python3.10-dev python3.10-distutils
    
    # 安装pip for Python 3.10
    echo -e "${BLUE}安装pip...${NC}"
    curl -sS https://bootstrap.pypa.io/get-pip.py | python3.10
    
    echo -e "${GREEN}✓ Python 3.10安装完成${NC}"
}

# 2. 迁移项目到Linux文件系统
migrate_to_linux_fs() {
    echo -e "${YELLOW}[2/3] 检查项目位置...${NC}"
    
    CURRENT_DIR=$(pwd)
    
    # 检查是否在Windows文件系统
    if [[ "$CURRENT_DIR" == /mnt/* ]]; then
        echo -e "${YELLOW}⚠ 项目在Windows文件系统，建议迁移以提升性能${NC}"
        echo -e "${BLUE}当前位置: $CURRENT_DIR${NC}"
        
        # 建议的Linux文件系统位置
        LINUX_DIR="$HOME/QueryGPT-github"
        
        echo ""
        echo -e "${CYAN}是否要迁移到Linux文件系统？${NC}"
        echo -e "目标位置: ${GREEN}$LINUX_DIR${NC}"
        echo -e "这将显著提升性能（特别是pip安装和文件操作）"
        echo ""
        read -p "迁移项目？(y/n): " -n 1 -r
        echo ""
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}开始迁移...${NC}"
            
            # 创建目标目录
            mkdir -p "$HOME"
            
            # 复制项目（保留权限和链接）
            if [ -d "$LINUX_DIR" ]; then
                echo -e "${YELLOW}目标目录已存在，备份中...${NC}"
                mv "$LINUX_DIR" "$LINUX_DIR.backup.$(date +%Y%m%d_%H%M%S)"
            fi
            
            echo -e "${BLUE}复制文件（可能需要1-2分钟）...${NC}"
            cp -r "$CURRENT_DIR" "$LINUX_DIR"
            
            # 修复权限
            chmod -R u+rw "$LINUX_DIR"
            find "$LINUX_DIR" -name "*.sh" -exec chmod +x {} \;
            
            echo -e "${GREEN}✓ 项目已迁移到: $LINUX_DIR${NC}"
            echo ""
            echo -e "${CYAN}请运行以下命令进入新目录并继续安装：${NC}"
            echo -e "${GREEN}cd $LINUX_DIR${NC}"
            echo -e "${GREEN}./setup_wsl.sh${NC}"
            
            # 询问是否自动切换
            read -p "是否自动切换到新目录？(y/n): " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                cd "$LINUX_DIR"
                echo -e "${GREEN}✓ 已切换到: $(pwd)${NC}"
            fi
        else
            echo -e "${YELLOW}保持在当前位置${NC}"
        fi
    else
        echo -e "${GREEN}✓ 项目已在Linux文件系统${NC}"
    fi
}

# 3. 创建优化的虚拟环境
create_optimized_venv() {
    echo -e "${YELLOW}[3/3] 创建Python 3.10虚拟环境...${NC}"
    
    # 使用Python 3.10创建虚拟环境
    if command -v python3.10 &>/dev/null; then
        PYTHON_CMD="python3.10"
    else
        echo -e "${RED}错误: Python 3.10未安装${NC}"
        return 1
    fi
    
    # 删除旧的虚拟环境（如果存在）
    if [ -d "venv_py310" ]; then
        echo -e "${YELLOW}删除旧的虚拟环境...${NC}"
        rm -rf venv_py310
    fi
    
    # 创建新的虚拟环境
    echo -e "${BLUE}创建虚拟环境...${NC}"
    $PYTHON_CMD -m venv venv_py310
    
    # 激活并升级pip
    source venv_py310/bin/activate
    python -m pip install --upgrade pip setuptools wheel
    
    echo -e "${GREEN}✓ 虚拟环境创建成功${NC}"
    echo -e "${CYAN}Python路径: $(which python)${NC}"
    echo -e "${CYAN}Python版本: $(python --version)${NC}"
}

# 主流程
main() {
    echo -e "${CYAN}此脚本将帮助您：${NC}"
    echo "1. 安装Python 3.10（如果需要）"
    echo "2. 迁移项目到Linux文件系统（可选但推荐）"
    echo "3. 创建优化的Python虚拟环境"
    echo ""
    
    read -p "继续？(y/n): " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}已取消${NC}"
        exit 0
    fi
    
    # 执行步骤
    install_python310
    migrate_to_linux_fs
    create_optimized_venv
    
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ 优化完成！${NC}"
    echo -e "${GREEN}════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${CYAN}下一步：${NC}"
    echo -e "1. 如果迁移了项目，请先: ${GREEN}cd ~/QueryGPT-github${NC}"
    echo -e "2. 运行安装脚本: ${GREEN}./setup_wsl.sh${NC}"
    echo -e "3. 或直接启动: ${GREEN}./start_wsl.sh${NC}"
}

# 运行主程序
main