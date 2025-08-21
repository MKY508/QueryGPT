#!/bin/bash

# GitHub 推送脚本
# 使用方法: ./push_to_github.sh <github_username> <repository_name>

set -e

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}     QueryGPT GitHub 推送助手${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查参数
if [ $# -lt 2 ]; then
    echo -e "${YELLOW}使用方法:${NC}"
    echo "  ./push_to_github.sh <github_username> <repository_name>"
    echo ""
    echo -e "${YELLOW}示例:${NC}"
    echo "  ./push_to_github.sh MKY508 QueryGPT"
    echo ""
    exit 1
fi

GITHUB_USER=$1
REPO_NAME=$2

echo -e "${BLUE}配置信息：${NC}"
echo "  GitHub 用户名: $GITHUB_USER"
echo "  仓库名称: $REPO_NAME"
echo ""

# 构建仓库 URL
REPO_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"
echo -e "${BLUE}仓库地址:${NC} $REPO_URL"
echo ""

# 检查是否已有远程仓库
if git remote | grep -q "origin"; then
    echo -e "${YELLOW}检测到已存在的 origin 远程仓库，正在更新...${NC}"
    git remote set-url origin $REPO_URL
else
    echo -e "${GREEN}添加远程仓库...${NC}"
    git remote add origin $REPO_URL
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${YELLOW}请确保您已经在 GitHub 上完成以下操作：${NC}"
echo ""
echo "1. 登录 GitHub: https://github.com"
echo "2. 创建新仓库: https://github.com/new"
echo "   - Repository name: ${REPO_NAME}"
echo "   - Description: 自然语言数据库查询系统"
echo "   - Public (公开)"
echo "   - 不要初始化 README、.gitignore 或 License"
echo ""
echo -e "${BLUE}========================================${NC}"
echo ""

read -p "确认已在 GitHub 创建空仓库？(y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}已取消推送${NC}"
    echo ""
    echo "请先在 GitHub 创建仓库，然后重新运行此脚本"
    exit 1
fi

echo ""
echo -e "${GREEN}开始推送到 GitHub...${NC}"
echo ""

# 推送代码
git push -u origin main

echo ""
echo -e "${GREEN}✅ 推送成功！${NC}"
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}项目已成功推送到 GitHub！${NC}"
echo ""
echo "仓库地址: ${BLUE}https://github.com/${GITHUB_USER}/${REPO_NAME}${NC}"
echo ""
echo "您可以："
echo "1. 访问仓库: https://github.com/${GITHUB_USER}/${REPO_NAME}"
echo "2. 添加 README 徽章"
echo "3. 设置 GitHub Pages（如需要）"
echo "4. 邀请协作者"
echo ""
echo -e "${BLUE}========================================${NC}"