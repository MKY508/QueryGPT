#!/bin/bash

# QueryGPT Awesome 列表自动提交脚本
# 自动化 Fork、编辑和创建 PR 的流程

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# GitHub 用户名（需要修改为您的）
GITHUB_USER="MKY508"
WORK_DIR="$HOME/awesome-submissions"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   QueryGPT Awesome 列表提交助手 v1.0   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 创建工作目录
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# 函数：提交到 awesome-oss-data-analytics
submit_to_analytics() {
    echo -e "${YELLOW}📋 正在处理 awesome-oss-data-analytics...${NC}"
    
    REPO_NAME="awesome-oss-data-analytics"
    ORIGINAL_OWNER="Aleyasen"
    
    # 检查是否已经 fork
    if [ ! -d "$REPO_NAME" ]; then
        echo -e "${YELLOW}正在克隆仓库...${NC}"
        # 注意：需要先在 GitHub 上手动 fork
        echo -e "${RED}⚠️  请先在浏览器中 Fork 这个仓库:${NC}"
        echo "https://github.com/$ORIGINAL_OWNER/$REPO_NAME"
        echo ""
        read -p "完成 Fork 后按回车继续..." 
        
        git clone "https://github.com/$GITHUB_USER/$REPO_NAME.git"
        cd "$REPO_NAME"
        git remote add upstream "https://github.com/$ORIGINAL_OWNER/$REPO_NAME.git"
    else
        cd "$REPO_NAME"
        echo -e "${YELLOW}更新本地仓库...${NC}"
        git fetch upstream
        git checkout main || git checkout master
        git merge upstream/main || git merge upstream/master
    fi
    
    # 创建新分支
    BRANCH_NAME="add-querygpt-$(date +%Y%m%d)"
    git checkout -b "$BRANCH_NAME"
    
    echo -e "${YELLOW}正在查找合适的插入位置...${NC}"
    
    # 查找 README.md 中的合适位置
    if grep -q "QueryGPT" README.md; then
        echo -e "${GREEN}✅ QueryGPT 已经在列表中${NC}"
        return
    fi
    
    # 准备要添加的内容
    ADDITION="- [QueryGPT](https://github.com/MKY508/QueryGPT) - Natural language data analytics platform. Ask questions in plain English/Chinese, get SQL queries, Python analysis, and visualizations. Built on OpenInterpreter for flexible execution. Great alternative to expensive conversational BI tools."
    
    # 寻找数据分析工具部分并添加
    # 这里需要根据实际文件结构调整
    echo -e "${YELLOW}添加 QueryGPT 到列表...${NC}"
    
    # 临时文件
    cp README.md README.md.bak
    
    # 查找合适的位置插入（这里需要根据实际格式调整）
    # 示例：在 "Data Analysis" 或类似部分添加
    if grep -q "Data Analysis" README.md; then
        # 在 Data Analysis 部分的列表末尾添加
        awk '/Data Analysis/{p=1} p && /^$/{print "'"$ADDITION"'"; p=0} 1' README.md > README.tmp
        mv README.tmp README.md
    else
        # 如果没找到特定部分，添加到文件末尾的列表部分
        echo "$ADDITION" >> README.md
    fi
    
    # 提交更改
    git add README.md
    git commit -m "Add QueryGPT - Natural language data analytics platform"
    
    echo -e "${GREEN}✅ 更改已提交到分支 $BRANCH_NAME${NC}"
    echo -e "${YELLOW}推送到 GitHub...${NC}"
    git push origin "$BRANCH_NAME"
    
    echo -e "${GREEN}✅ 完成! 现在请访问以下链接创建 PR:${NC}"
    echo "https://github.com/$GITHUB_USER/$REPO_NAME/compare/$BRANCH_NAME?expand=1"
    echo ""
    echo -e "${YELLOW}PR 描述已保存在: $HOME/QueryGPT-github/pr_analytics.md${NC}"
    
    cd ..
}

# 函数：提交到 Awesome-BI
submit_to_bi() {
    echo -e "${YELLOW}📋 正在处理 Awesome-BI...${NC}"
    
    REPO_NAME="Awesome-BI"
    ORIGINAL_OWNER="NajiElKotob"
    
    if [ ! -d "$REPO_NAME" ]; then
        echo -e "${YELLOW}正在克隆仓库...${NC}"
        echo -e "${RED}⚠️  请先在浏览器中 Fork 这个仓库:${NC}"
        echo "https://github.com/$ORIGINAL_OWNER/$REPO_NAME"
        echo ""
        read -p "完成 Fork 后按回车继续..." 
        
        git clone "https://github.com/$GITHUB_USER/$REPO_NAME.git"
        cd "$REPO_NAME"
        git remote add upstream "https://github.com/$ORIGINAL_OWNER/$REPO_NAME.git"
    else
        cd "$REPO_NAME"
        echo -e "${YELLOW}更新本地仓库...${NC}"
        git fetch upstream
        git checkout main || git checkout master
        git merge upstream/main || git merge upstream/master
    fi
    
    BRANCH_NAME="add-querygpt-$(date +%Y%m%d)"
    git checkout -b "$BRANCH_NAME"
    
    if grep -q "QueryGPT" README.md; then
        echo -e "${GREEN}✅ QueryGPT 已经在列表中${NC}"
        return
    fi
    
    # BI 列表的格式
    ADDITION="- **[QueryGPT](https://github.com/MKY508/QueryGPT)** - Conversational BI platform that turns natural language into data insights. Powered by OpenInterpreter for intelligent query execution. Supports MySQL, PostgreSQL. Great for teams wanting ChatGPT-like simplicity for their data. \`open-source\` \`self-hosted\` \`natural-language\`"
    
    echo -e "${YELLOW}添加 QueryGPT 到列表...${NC}"
    cp README.md README.md.bak
    
    # 添加到合适位置
    if grep -q "Open Source" README.md; then
        awk '/Open Source/{p=1} p && /^$/{print "'"$ADDITION"'"; p=0} 1' README.md > README.tmp
        mv README.tmp README.md
    else
        echo "$ADDITION" >> README.md
    fi
    
    git add README.md
    git commit -m "Add QueryGPT - Conversational BI platform"
    
    echo -e "${GREEN}✅ 更改已提交到分支 $BRANCH_NAME${NC}"
    git push origin "$BRANCH_NAME"
    
    echo -e "${GREEN}✅ 完成! 现在请访问以下链接创建 PR:${NC}"
    echo "https://github.com/$GITHUB_USER/$REPO_NAME/compare/$BRANCH_NAME?expand=1"
    echo ""
    echo -e "${YELLOW}PR 描述已保存在: $HOME/QueryGPT-github/pr_bi.md${NC}"
    
    cd ..
}

# 函数：显示菜单
show_menu() {
    echo -e "${BLUE}请选择要提交的列表:${NC}"
    echo "1) awesome-oss-data-analytics (推荐首选)"
    echo "2) Awesome-BI (推荐)"
    echo "3) 两个都提交"
    echo "4) 查看提交状态"
    echo "5) 退出"
    echo ""
    read -p "请输入选项 (1-5): " choice
}

# 函数：查看状态
show_status() {
    echo -e "${BLUE}=== 提交状态 ===${NC}"
    echo ""
    
    if [ -d "$WORK_DIR/awesome-oss-data-analytics" ]; then
        echo -e "${GREEN}✅ awesome-oss-data-analytics 已处理${NC}"
        cd "$WORK_DIR/awesome-oss-data-analytics"
        echo "  分支: $(git branch --show-current)"
        cd - > /dev/null
    else
        echo -e "${YELLOW}⏳ awesome-oss-data-analytics 未处理${NC}"
    fi
    
    if [ -d "$WORK_DIR/Awesome-BI" ]; then
        echo -e "${GREEN}✅ Awesome-BI 已处理${NC}"
        cd "$WORK_DIR/Awesome-BI"
        echo "  分支: $(git branch --show-current)"
        cd - > /dev/null
    else
        echo -e "${YELLOW}⏳ Awesome-BI 未处理${NC}"
    fi
    
    echo ""
}

# 主流程
main() {
    while true; do
        show_menu
        
        case $choice in
            1)
                submit_to_analytics
                ;;
            2)
                submit_to_bi
                ;;
            3)
                submit_to_analytics
                echo ""
                echo -e "${YELLOW}等待3秒后继续下一个...${NC}"
                sleep 3
                submit_to_bi
                ;;
            4)
                show_status
                ;;
            5)
                echo -e "${GREEN}再见! 祝您的项目获得更多关注! 🚀${NC}"
                exit 0
                ;;
            *)
                echo -e "${RED}无效选项，请重试${NC}"
                ;;
        esac
        
        echo ""
        read -p "按回车继续..."
        clear
    done
}

# 检查必要工具
check_requirements() {
    if ! command -v git &> /dev/null; then
        echo -e "${RED}错误: 未找到 git${NC}"
        exit 1
    fi
    
    if ! command -v gh &> /dev/null; then
        echo -e "${YELLOW}提示: 安装 GitHub CLI (gh) 可以自动创建 PR${NC}"
        echo "安装命令: brew install gh"
    fi
}

# 运行前检查
check_requirements

# 提示
echo -e "${YELLOW}⚠️  重要提示:${NC}"
echo "1. 请确保您已经登录 GitHub"
echo "2. 需要先手动 Fork 目标仓库"
echo "3. 建议每次提交间隔 2-3 天"
echo ""
read -p "准备好了吗? (y/n): " ready

if [[ $ready =~ ^[Yy]$ ]]; then
    main
else
    echo -e "${YELLOW}好的，准备好后再运行此脚本${NC}"
    exit 0
fi