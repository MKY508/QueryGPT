#!/bin/bash

# QueryGPT 快速提交脚本
# 一键准备所有需要的内容

set -e

echo "🚀 QueryGPT Awesome 列表快速提交准备"
echo "====================================="
echo ""

# 创建提交内容目录
SUBMIT_DIR="$HOME/Desktop/QueryGPT_Awesome_提交"
mkdir -p "$SUBMIT_DIR"

# 1. 为中国独立开发者项目列表准备内容
cat > "$SUBMIT_DIR/1_中国独立开发者_添加内容.md" << 'EOF'
### QueryGPT - 自然语言数据库查询系统

- **开发者**: Mao Kaiyue ([@MKY508](https://github.com/MKY508))
- **项目地址**: https://github.com/MKY508/QueryGPT
- **项目简介**: 让非技术人员也能轻松查询数据库的 AI 工具。基于 OpenInterpreter，支持用自然语言对话的方式查询和分析数据。用中文问"上个月销售最好的产品是什么"，系统就会自动查询并生成图表。已在生产环境稳定运行，每天处理 100+ 查询。
- **技术栈**: Python, Flask, OpenInterpreter, MySQL/PostgreSQL
EOF

# 2. PR 描述
cat > "$SUBMIT_DIR/2_PR描述_中文社区.md" << 'EOF'
# 添加 QueryGPT - 自然语言数据库查询系统

您好！

我想推荐 QueryGPT 加入到列表中。这是一个让非技术人员也能轻松查询数据库的开源工具。

## 解决的问题

在我们公司，业务团队每天都要找技术拉数据，双方都很痛苦。QueryGPT 让他们可以直接用中文问：
- "上个月哪个产品卖得最好？"
- "给我看看最近的用户增长趋势"
- "帮我做个客户价值分析"

系统会自动理解、查询、生成图表，整个过程不到一分钟。

## 技术特点

- 基于 OpenInterpreter，不只是生成 SQL，还能执行 Python 做复杂分析
- 支持 MySQL、PostgreSQL 等主流数据库
- 完全开源，MIT 协议

目前已经稳定运行 3 个多月，每天处理 100+ 查询，为我们节省了大量时间。

项目地址：https://github.com/MKY508/QueryGPT

感谢您维护这个优秀的列表！
EOF

# 3. 为优秀工具箱集合准备
cat > "$SUBMIT_DIR/3_优秀工具箱_添加内容.md" << 'EOF'
## QueryGPT - AI 数据库查询助手

- **简介**：用自然语言查询数据库，自动生成 SQL 和可视化
- **开源地址**：https://github.com/MKY508/QueryGPT
- **主要功能**：
  - 🗣️ 中文自然语言查询："上个月销售额多少"
  - 🤖 基于 OpenInterpreter 智能执行
  - 📊 自动数据可视化
  - 🔍 支持复杂业务分析（RFM、用户画像等）
- **适用场景**：数据分析、业务报表、自助查询
- **特色**：不需要懂 SQL，业务人员也能自己查数据
EOF

# 4. 操作步骤
cat > "$SUBMIT_DIR/README_操作步骤.md" << 'EOF'
# QueryGPT Awesome 列表提交步骤

## 第一步：Fork 仓库（在浏览器中操作）

1. 打开 https://github.com/1c7/chinese-independent-developer
2. 点击右上角 "Fork" 按钮
3. 同样 Fork https://github.com/bestxtools/awesome-toolbox-chinese

## 第二步：克隆到本地

```bash
cd ~/Desktop
git clone https://github.com/MKY508/chinese-independent-developer.git
cd chinese-independent-developer
```

## 第三步：创建分支

```bash
git checkout -b add-querygpt
```

## 第四步：添加内容

1. 打开 README.md
2. 找到合适的分类（如"数据分析"或"开发工具"）
3. 将 `1_中国独立开发者_添加内容.md` 的内容添加进去
4. 保持格式一致

## 第五步：提交更改

```bash
git add README.md
git commit -m "Add QueryGPT - 自然语言数据库查询系统"
git push origin add-querygpt
```

## 第六步：创建 Pull Request

1. 打开你 Fork 的仓库页面
2. 点击 "Compare & pull request"
3. 使用 `2_PR描述_中文社区.md` 的内容作为 PR 描述
4. 提交 PR

## 提交顺序建议

1. **今天**：提交到 chinese-independent-developer
2. **3天后**：提交到 awesome-toolbox-chinese
3. **1周后**：如果反馈好，考虑国际列表

## 注意事项

- 保持谦虚，不要过度推销
- 如果被拒绝，礼貌询问原因
- 根据反馈改进项目或描述
EOF

echo "✅ 所有文件已准备完成！"
echo ""
echo "📁 文件位置：$SUBMIT_DIR"
echo ""
echo "包含以下文件："
ls -la "$SUBMIT_DIR"
echo ""
echo "📋 下一步："
echo "1. 先去 GitHub 上 Fork 这两个仓库："
echo "   - https://github.com/1c7/chinese-independent-developer"
echo "   - https://github.com/bestxtools/awesome-toolbox-chinese"
echo ""
echo "2. 按照 README_操作步骤.md 的说明进行操作"
echo ""
echo "祝您提交成功！🎉"

# 打开文件夹
open "$SUBMIT_DIR"