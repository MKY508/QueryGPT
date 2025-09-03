#!/bin/bash

# 快速修复pip网络问题脚本
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}修复pip网络连接问题${NC}"

# 激活虚拟环境
if [ -d "venv_py310" ]; then
    source venv_py310/bin/activate
elif [ -d "venv" ]; then
    source venv/bin/activate
else
    echo "使用系统Python"
fi

# 方案1: 使用国内镜像源
echo -e "${YELLOW}配置国内镜像源...${NC}"
pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/
pip config set install.trusted-host mirrors.aliyun.com

# 清除pip缓存
echo -e "${YELLOW}清除pip缓存...${NC}"
pip cache purge 2>/dev/null || rm -rf ~/.cache/pip/*

# 测试连接
echo -e "${YELLOW}测试镜像源连接...${NC}"
if pip install pip --upgrade; then
    echo -e "${GREEN}✓ 阿里云镜像可用${NC}"
else
    echo -e "${YELLOW}尝试清华源...${NC}"
    pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
    pip config set install.trusted-host pypi.tuna.tsinghua.edu.cn
    
    if pip install pip --upgrade; then
        echo -e "${GREEN}✓ 清华源可用${NC}"
    else
        echo -e "${YELLOW}尝试豆瓣源...${NC}"
        pip config set global.index-url https://pypi.douban.com/simple
        pip config set install.trusted-host pypi.douban.com
        pip install pip --upgrade
    fi
fi

# 安装基础包
echo -e "${GREEN}开始安装依赖...${NC}"

# 核心依赖
pip install Flask flask-cors pymysql python-dotenv

# 数据包（分开安装避免超时）
pip install pandas
pip install numpy
pip install matplotlib
pip install seaborn
pip install plotly

# API包
pip install openai
pip install litellm
pip install requests

echo -e "${GREEN}✓ 依赖安装完成！${NC}"
echo -e "${BLUE}现在可以运行: ./start.sh${NC}"