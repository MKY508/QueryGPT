#!/bin/bash

# QueryGPT 中文 Awesome 列表提交脚本
# 专门用于提交到中文开发者社区

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

# GitHub 用户名
GITHUB_USER="MKY508"
WORK_DIR="$HOME/chinese-awesome-submissions"

echo -e "${PURPLE}╔════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║   QueryGPT 中文社区提交助手 v1.0         ║${NC}"
echo -e "${PURPLE}╚════════════════════════════════════════════╝${NC}"
echo ""

mkdir -p "$WORK_DIR"

# 函数：提交到 chinese-independent-developer
submit_to_chinese_indie() {
    echo -e "${YELLOW}📋 正在准备提交到【中国独立开发者项目列表】...${NC}"
    echo ""
    
    cd "$WORK_DIR"
    REPO_NAME="chinese-independent-developer"
    ORIGINAL_OWNER="1c7"
    
    if [ ! -d "$REPO_NAME" ]; then
        echo -e "${RED}⚠️  请先在浏览器中 Fork 这个仓库:${NC}"
        echo -e "${BLUE}https://github.com/$ORIGINAL_OWNER/$REPO_NAME${NC}"
        echo ""
        echo "这是最活跃的中文开发者社区，您的项目很适合这里！"
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
    
    # 创建要添加的内容
    cat > querygpt_entry.md << 'EOF'

### QueryGPT - 自然语言数据库查询系统

- **开发者**: Mao Kaiyue ([@MKY508](https://github.com/MKY508))
- **项目地址**: https://github.com/MKY508/QueryGPT
- **项目简介**: 让非技术人员也能轻松查询数据库的 AI 工具。基于 OpenInterpreter，支持用自然语言对话的方式查询和分析数据。用中文问"上个月销售最好的产品是什么"，系统就会自动查询并生成图表。已在生产环境稳定运行，每天处理 100+ 查询。
- **技术栈**: Python, Flask, OpenInterpreter, MySQL/PostgreSQL
EOF
    
    echo -e "${GREEN}✅ 条目内容已准备好${NC}"
    echo -e "${YELLOW}请手动将以下内容添加到 README.md 的合适位置：${NC}"
    echo ""
    cat querygpt_entry.md
    echo ""
    echo -e "${BLUE}提示：通常添加在【数据分析】或【开发工具】分类下${NC}"
    echo ""
    
    # 尝试自动添加（根据实际文件结构可能需要调整）
    read -p "是否尝试自动添加到文件？(y/n): " auto_add
    if [[ $auto_add =~ ^[Yy]$ ]]; then
        # 备份原文件
        cp README.md README.md.bak
        
        # 查找合适的位置插入
        if grep -q "数据分析" README.md; then
            echo -e "${YELLOW}找到数据分析分类，正在添加...${NC}"
            # 在数据分析部分后添加
            awk '/数据分析/{p=1} p && /^###/{if(!done){system("cat querygpt_entry.md"); done=1}} 1' README.md > README.tmp
            mv README.tmp README.md
        elif grep -q "开发工具" README.md; then
            echo -e "${YELLOW}找到开发工具分类，正在添加...${NC}"
            awk '/开发工具/{p=1} p && /^###/{if(!done){system("cat querygpt_entry.md"); done=1}} 1' README.md > README.tmp
            mv README.tmp README.md
        else
            echo -e "${YELLOW}未找到特定分类，添加到文件末尾...${NC}"
            cat querygpt_entry.md >> README.md
        fi
        
        echo -e "${GREEN}✅ 已添加到 README.md${NC}"
    fi
    
    echo ""
    echo -e "${YELLOW}请检查 README.md 确保格式正确，然后执行：${NC}"
    echo "git add README.md"
    echo "git commit -m \"Add QueryGPT - 自然语言数据库查询系统\""
    echo "git push origin $BRANCH_NAME"
    echo ""
    echo -e "${GREEN}然后访问以下链接创建 PR：${NC}"
    echo "https://github.com/$GITHUB_USER/$REPO_NAME/compare/$BRANCH_NAME?expand=1"
    
    cd ..
}

# 函数：提交到 awesome-toolbox-chinese
submit_to_toolbox() {
    echo -e "${YELLOW}📋 正在准备提交到【优秀工具箱集合】...${NC}"
    echo ""
    
    cd "$WORK_DIR"
    REPO_NAME="awesome-toolbox-chinese"
    ORIGINAL_OWNER="bestxtools"
    
    if [ ! -d "$REPO_NAME" ]; then
        echo -e "${RED}⚠️  请先在浏览器中 Fork 这个仓库:${NC}"
        echo -e "${BLUE}https://github.com/$ORIGINAL_OWNER/$REPO_NAME${NC}"
        echo ""
        read -p "完成 Fork 后按回车继续..." 
        
        git clone "https://github.com/$GITHUB_USER/$REPO_NAME.git"
        cd "$REPO_NAME"
        git remote add upstream "https://github.com/$ORIGINAL_OWNER/$REPO_NAME.git"
    else
        cd "$REPO_NAME"
        git fetch upstream
        git checkout main || git checkout master
        git merge upstream/main || git merge upstream/master
    fi
    
    BRANCH_NAME="add-querygpt-$(date +%Y%m%d)"
    git checkout -b "$BRANCH_NAME"
    
    cat > querygpt_toolbox.md << 'EOF'

## QueryGPT - AI 数据库查询助手

- **简介**：用自然语言查询数据库，自动生成 SQL 和可视化
- **开源地址**：https://github.com/MKY508/QueryGPT
- **主要功能**：
  - 🗣️ 中文自然语言查询
  - 🤖 基于 OpenInterpreter 智能执行
  - 📊 自动数据可视化
  - 🔍 支持复杂业务分析（RFM、用户画像等）
- **适用场景**：数据分析、业务报表、自助查询
- **特色**：不需要懂 SQL，业务人员也能自己查数据
EOF
    
    echo -e "${GREEN}✅ 工具箱条目已准备好${NC}"
    echo -e "${YELLOW}内容已保存在 querygpt_toolbox.md${NC}"
    
    cd ..
}

# 函数：生成 PR 描述
generate_pr_description() {
    cat > "$WORK_DIR/pr_description_chinese.md" << 'EOF'
# 添加 QueryGPT - 自然语言数据库查询系统

您好！

我想推荐 QueryGPT 加入到列表中。这是我们团队开发的一个开源工具，主要解决非技术人员查询数据库的痛点。

## 项目特点

QueryGPT 让数据查询变得像聊天一样简单。业务人员可以直接用中文提问：
- "上个月哪个产品卖得最好？"
- "给我看看用户留存率趋势"
- "做个 RFM 分析"

系统会自动理解需求，生成并执行查询，返回数据和图表。

## 为什么适合这个列表

1. **解决实际问题**：我们公司用它减少了 80% 的临时数据需求工单
2. **技术创新**：基于 OpenInterpreter，能智能选择 SQL 或 Python 处理
3. **完全开源**：MIT 协议，代码完全开放
4. **生产验证**：已稳定运行 3+ 个月，每天 100+ 查询

## 技术实现

- 后端：Python + Flask + OpenInterpreter
- 支持：MySQL、PostgreSQL
- 特色：不只是生成 SQL，还能执行并可视化

项目地址：https://github.com/MKY508/QueryGPT

感谢您的时间和对开源社区的贡献！如有任何问题，我很乐意解答。

祝好！
EOF
    
    echo -e "${GREEN}✅ PR 描述已生成：$WORK_DIR/pr_description_chinese.md${NC}"
}

# 主菜单
show_menu() {
    echo -e "${BLUE}════════════════════════════════════════════${NC}"
    echo -e "${BLUE}请选择要提交的中文社区列表:${NC}"
    echo ""
    echo "1) 🌟 中国独立开发者项目列表 (推荐首选)"
    echo "2) 📦 优秀工具箱集合"
    echo "3) 🚀 两个都准备"
    echo "4) 📝 生成 PR 描述模板"
    echo "5) 📊 查看提交状态"
    echo "6) ❌ 退出"
    echo ""
    read -p "请选择 (1-6): " choice
}

# 查看状态
check_status() {
    echo -e "${BLUE}═══ 提交准备状态 ═══${NC}"
    echo ""
    
    # 检查是否已经 fork
    echo -e "${YELLOW}正在检查 Fork 状态...${NC}"
    
    # 使用 gh 命令检查（如果安装了）
    if command -v gh &> /dev/null; then
        echo -e "${GREEN}已安装 GitHub CLI，正在检查...${NC}"
        gh repo list $GITHUB_USER --limit 100 | grep -E "(chinese-independent-developer|awesome-toolbox-chinese)" || echo "尚未 Fork 相关仓库"
    else
        echo -e "${YELLOW}提示：安装 GitHub CLI 可以更方便地管理${NC}"
        echo "brew install gh"
    fi
    
    echo ""
    if [ -d "$WORK_DIR" ]; then
        echo -e "${GREEN}工作目录存在：$WORK_DIR${NC}"
        ls -la "$WORK_DIR" 2>/dev/null | grep -E "(chinese-independent-developer|awesome-toolbox-chinese)" || echo "尚未克隆仓库"
    else
        echo -e "${YELLOW}工作目录不存在，需要初始化${NC}"
    fi
}

# 主程序
main() {
    while true; do
        show_menu
        
        case $choice in
            1)
                submit_to_chinese_indie
                ;;
            2)
                submit_to_toolbox
                ;;
            3)
                submit_to_chinese_indie
                echo ""
                submit_to_toolbox
                generate_pr_description
                ;;
            4)
                generate_pr_description
                ;;
            5)
                check_status
                ;;
            6)
                echo -e "${GREEN}再见！祝 QueryGPT 获得更多关注！🚀${NC}"
                exit 0
                ;;
            *)
                echo -e "${RED}无效选项${NC}"
                ;;
        esac
        
        echo ""
        read -p "按回车继续..."
        clear
    done
}

# 启动提示
echo -e "${GREEN}═══ 为什么选择中文社区？ ═══${NC}"
echo ""
echo "✅ 更容易被接受（界面是中文）"
echo "✅ 目标用户更精准"
echo "✅ 社区更活跃，反馈更快"
echo "✅ 可以用中文描述，表达更准确"
echo ""
echo -e "${YELLOW}提示：建议先提交到中文社区，获得认可后再考虑国际列表${NC}"
echo ""
read -p "准备好了吗？(y/n): " ready

if [[ $ready =~ ^[Yy]$ ]]; then
    main
else
    echo -e "${YELLOW}好的，准备好后再运行此脚本${NC}"
    exit 0
fi