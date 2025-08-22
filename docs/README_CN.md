<div align="center">
  <img src="images/logo.png" width="300" alt="QueryGPT">
</div>

<p align="center">
  <strong>基于 OpenInterpreter 的智能数据分析 Agent</strong><br/>
  用自然语言与数据库对话
</p>

<p align="center">
  <strong>🇨🇳 中文</strong> | 
  <a href="../README.md">🇬🇧 English Documentation</a>
</p>

<div align="center">

[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square&labelColor=black)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg?style=flat-square&labelColor=black)](https://www.python.org/)
[![OpenInterpreter](https://img.shields.io/badge/OpenInterpreter-0.4.3-green.svg?style=flat-square&labelColor=black)](https://github.com/OpenInterpreter/open-interpreter)
[![Stars](https://img.shields.io/github/stars/MKY508/QueryGPT?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/MKY508/QueryGPT/stargazers)

</div>

## 核心优势

**像数据分析师一样思考**
- **自主探索**：遇到问题会主动查看表结构、样本数据
- **多轮验证**：发现异常会重新检查，确保结果准确
- **复杂分析**：不只是 SQL，能执行 Python 做统计分析、机器学习
- **思考可见**：实时显示 Agent 的推理过程（Chain-of-Thought）

## 系统截图

<img src="images/agent-thinking.png" width="100%" alt="QueryGPT Interface"/>

**实时展示 AI 思考过程，用中文对话即可完成复杂数据分析。**

---

<img src="images/data-visualization.png" width="100%" alt="Data Visualization"/>

**自动生成交互式图表，数据洞察一目了然。**

---

<img src="images/developer-view.png" width="100%" alt="Developer View"/>

**完全透明的代码执行，支持 SQL 和 Python 双引擎。**

## 功能特性

### Agent 核心能力
- **自主数据探索**: Agent 会主动了解数据结构、探索数据关系
- **多轮推理迭代**: 像分析师一样，发现问题会深入调查
- **Chain-of-Thought**: 实时展示 Agent 思考过程，可随时介入纠正
- **上下文记忆**: 理解对话历史，支持连续多轮分析

### 数据分析能力
- **SQL + Python**: 不局限于 SQL，能执行复杂 Python 数据处理
- **统计分析**: 自动进行相关性分析、趋势预测、异常检测
- **中文业务术语**: 原生理解环比、同比、留存、复购等概念
- **智能可视化**: 根据数据特征自动选择最佳图表类型

### 系统特性
- **多模型支持**: GPT-5、Claude、Gemini、Ollama 本地模型随意切换
- **灵活部署**: 支持云端 API 或 Ollama 本地部署，数据永不出门
- **历史记录**: 保存分析过程，支持回溯和分享
- **数据安全**: 只读权限、SQL 注入防护、敏感数据脱敏
- **灵活导出**: 支持 Excel、PDF、HTML 等多种格式

## 技术要求

- Python 3.10.x（必需，OpenInterpreter 0.4.3 依赖）
- MySQL 或兼容数据库

## 产品对比

| 对比维度 | **QueryGPT** | Vanna AI | DB-GPT | TableGPT | Text2SQL.AI |
|---------|:------------:|:--------:|:------:|:--------:|:-----------:|
| **费用** | **✅ 免费** | ⭕ 有付费版 | ✅ 免费 | ❌ 收费 | ❌ 收费 |
| **开源** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **本地部署** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **执行 Python 代码** | **✅ 完整环境** | ❌ | ❌ | ❌ | ❌ |
| **可视化能力** | **✅ 可编程** | ⭕ 预设图表 | ✅ 丰富图表 | ✅ 丰富图表 | ⭕ 基础 |
| **中文业务理解** | **✅ 原生** | ⭕ 基础 | ✅ 良好 | ✅ 优秀 | ⭕ 基础 |
| **Agent 自主探索** | **✅** | ❌ | ⭕ 基础 | ⭕ 基础 | ❌ |
| **实时思考展示** | **✅** | ❌ | ❌ | ❌ | ❌ |
| **扩展能力** | **✅ 无限扩展** | ❌ | ❌ | ❌ | ❌ |

### 我们的核心差异
- **完整 Python 环境**：不是预设功能，而是真正的 Python 执行环境，可以写任何代码
- **无限扩展性**：需要新功能？直接安装新库，不用等产品更新
- **Agent 自主探索**：遇到问题会主动调查，不是简单的单次查询
- **思考过程透明**：实时看到 AI 在想什么，可以随时介入指导
- **真正免费开源**：MIT 协议，没有任何付费墙

## 快速开始（懒人模式）

### 首次使用

```bash
# 1. 克隆项目
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# 2. 运行安装脚本（自动配置环境）
./setup.sh

# 3. 启动服务
./start.sh
```

### 后续使用

```bash
# 直接快速启动
./quick_start.sh
```

服务默认运行在 http://localhost:5000

> **注意**: 如果端口 5000 被占用（如 macOS 的 AirPlay），系统会自动选择下一个可用端口（5001-5010），并在启动时显示实际使用的端口。

## 配置说明

### 基础配置

1. **复制环境配置文件**
   ```bash
   cp .env.example .env
   ```

2. **编辑 .env 文件，配置以下内容**
   - `OPENAI_API_KEY`: 您的 OpenAI API 密钥
   - `OPENAI_BASE_URL`: API 端点（可选，默认使用官方端点）
   - 数据库连接信息

### 语义层配置（可选）

语义层用于增强中文业务术语理解，让系统更好地理解您的业务语言。**这是可选配置，不配置不影响基础功能。**

1. **复制示例文件**
   ```bash
   cp backend/semantic_layer.json.example backend/semantic_layer.json
   ```

2. **根据您的业务需求修改配置**
   
   语义层配置包含三个部分：
   - **数据库映射**: 定义数据库的业务含义
   - **核心业务表**: 映射重要业务表和字段
   - **快速搜索索引**: 常用术语的快速查找

3. **配置示例**
   ```json
   {
     "核心业务表": {
       "订单管理": {
         "表路径": "database.orders",
         "关键词": ["订单", "销售", "交易"],
         "必需字段": {
           "order_id": "订单编号",
           "amount": "金额"
         }
       }
     }
   }
   ```

> **说明**: 
> - 语义层文件包含业务敏感信息，已加入 `.gitignore`，不会被提交到版本控制
> - 不配置语义层时，系统使用默认配置，仍可正常进行数据查询
> - 详细配置说明请参考 [backend/SEMANTIC_LAYER_SETUP.md](backend/SEMANTIC_LAYER_SETUP.md)

## 项目结构

```
QueryGPT/
├── backend/              # 后端服务
│   ├── app.py           # Flask 应用主入口
│   ├── database.py      # 数据库连接管理
│   ├── interpreter_manager.py  # 查询解释器
│   ├── history_manager.py      # 历史记录管理
│   └── config_loader.py        # 配置加载器
├── frontend/            # 前端界面
│   ├── templates/       # HTML 模板
│   └── static/          # 静态资源
│       ├── css/         # 样式文件
│       └── js/          # JavaScript
├── docs/                # 项目文档
├── logs/                # 日志目录
├── output/              # 输出文件
├── requirements.txt     # Python 依赖
└── .env.example        # 配置示例
```

## API 接口

### 查询接口

```http
POST /api/chat
Content-Type: application/json

{
  "message": "查询本月销售总额",
  "model": "default"
}
```

### 历史记录

```http
GET /api/history/conversations    # 获取历史列表
GET /api/history/conversation/:id # 获取详情
DELETE /api/history/conversation/:id # 删除记录
```

### 健康检查

```http
GET /api/health
```

## 安全说明

- 仅支持只读查询（SELECT, SHOW, DESCRIBE）
- 自动过滤危险 SQL 语句
- 数据库用户应配置为只读权限

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 作者

- **作者**: Mao Kaiyue
- **GitHub**: [@MKY508](https://github.com/MKY508)
- **创建时间**: 2025年8月

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date&t=202508)](https://star-history.com/#MKY508/QueryGPT&Date)

## 项目统计

![GitHub stars](https://img.shields.io/github/stars/MKY508/QueryGPT?style=social)
![GitHub forks](https://img.shields.io/github/forks/MKY508/QueryGPT?style=social)
![GitHub watchers](https://img.shields.io/github/watchers/MKY508/QueryGPT?style=social)
![GitHub contributors](https://img.shields.io/github/contributors/MKY508/QueryGPT)
![GitHub last commit](https://img.shields.io/github/last-commit/MKY508/QueryGPT)

## 贡献

欢迎提交 Issue 和 Pull Request。

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

---

## ⭐ 支持项目

如果 QueryGPT 对你有帮助，请考虑给这个项目一个 **Star** ⭐

你的支持是我持续改进的动力 💪

---

## 关键词 / Keywords

`AI Agent` `数据分析Agent` `Chain-of-Thought` `自主数据探索` `多轮推理` `自然语言查询` `Natural Language to SQL` `Text to SQL` `数据分析` `Data Analytics` `ChatGPT` `Code Interpreter` `OpenInterpreter` `中文数据库查询` `AI数据分析` `智能BI` `数据可视化` `Business Intelligence` `MySQL` `PostgreSQL` `Python执行` `统计分析` `数据挖掘` `RFM分析` `用户画像` `销售分析` `环比同比` `留存分析` `no-code` `low-code` `chat with database` `conversational AI` `数据库对话` `Autonomous Agent` `Vanna AI 替代` `DB-GPT` `Text2SQL` `TableGPT` `ChatBI` `对话式BI` `Chat2DB` `AI BI`

---

**QueryGPT** © 2025 Mao Kaiyue. MIT License.
