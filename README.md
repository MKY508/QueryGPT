<div align="center">
  
  <img src="docs/images/logo.png" width="400" alt="QueryGPT">
  
  <br/>
  
  <p>
    <a href="#">简体中文</a> •
    <a href="docs/README_EN.md">English</a> •
    <a href="docs/README/README_ZH-TW.md">繁體中文</a> •
    <a href="docs/README/README_JA.md">日本語</a> •
    <a href="docs/README/README_ES.md">Español</a> •
    <a href="docs/README/README_FR.md">Français</a> •
    <a href="docs/README_DE.md">Deutsch</a> •
    <a href="docs/README/README_RU.md">Русский</a> •
    <a href="docs/README/README_PT.md">Português</a> •
    <a href="docs/README/README_KO.md">한국어</a>
  </p>
  
  <br/>
  
  [![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.10+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![OpenInterpreter](https://img.shields.io/badge/OpenInterpreter-0.4.3-green.svg?style=for-the-badge)](https://github.com/OpenInterpreter/open-interpreter)
  [![Stars](https://img.shields.io/github/stars/MKY508/QueryGPT?style=for-the-badge&color=yellow)](https://github.com/MKY508/QueryGPT/stargazers)
  
  <br/>
  
  <h3>基于 OpenInterpreter 的智能数据分析 Agent</h3>
  <p><i>用自然语言与数据库对话</i></p>
  
</div>

<br/>

---

## ✨ 核心优势

**像数据分析师一样思考**
- **自主探索**：遇到问题会主动查看表结构、样本数据
- **多轮验证**：发现异常会重新检查，确保结果准确
- **复杂分析**：不只是 SQL，能执行 Python 做统计分析、机器学习
- **思考可见**：实时显示 Agent 的推理过程（Chain-of-Thought）

## 📸 系统截图

<table>
  <tr>
    <td align="center">
      <img src="docs/images/agent-thinking.png" width="100%" alt="QueryGPT Interface"/>
      <b>实时 AI 思考过程</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/data-visualization.png" width="100%" alt="Data Visualization"/>
      <b>交互式数据可视化</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/developer-view.png" width="100%" alt="Developer View"/>
      <b>透明代码执行</b>
    </td>
  </tr>
</table>

## 🌟 功能特性

### 智能路由系统 🆕
- **AI 查询分类**: 使用 LLM 智能判断查询意图，自动选择最优执行路径
- **四种执行模式**:
  - `DIRECT_SQL`: 简单查询直接转 SQL，毫秒级响应
  - `SIMPLE_ANALYSIS`: SQL + 轻量数据处理，秒级完成
  - `COMPLEX_ANALYSIS`: 完整 Agent 流程，深度分析
  - `VISUALIZATION`: 自动生成交互式图表
- **性能提升**: 简单查询响应速度提升 80%+，复杂查询保持原有能力
- **灵活配置**: 每种模式独立 Prompt，可根据业务需求精准调优

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
- **智能路由系统**: 🆕 AI 自动判断查询类型，选择最优执行路径（Beta）
- **多模型支持**: GPT-5、Claude、Gemini、Ollama 本地模型随意切换
- **灵活部署**: 支持云端 API 或 Ollama 本地部署，数据永不出门
- **历史记录**: 保存分析过程，支持回溯和分享
- **数据安全**: 只读权限、SQL 注入防护、敏感数据脱敏
- **灵活导出**: 支持 Excel、PDF、HTML 等多种格式
- **Prompt 自定义**: 前端可视化编辑查询提示词，支持导入导出配置

## 📦 环境要求

- Python 3.10.x（必需，OpenInterpreter 0.4.3 依赖）
- MySQL 协议兼容的数据库（详见下方支持列表）

<br/>

## 📊 产品对比

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

## 🚀 快速开始（懒人模式）

### 方式一：智能启动（推荐）
```bash
# 克隆项目
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# 智能启动（自动判断是否需要安装）
./start.sh
```

`start.sh` 会自动：
- ✅ 首次运行 → 调用 `setup.sh` 完成安装并启动
- ✅ 已安装 → 调用 `quick_start.sh` 秒级启动
- ✅ Windows WSL → 自动修复换行符
- ✅ ARM 架构 → 自动选择 `setup_arm.sh`

### 方式二：标准流程
```bash
# 首次使用（安装并启动）
./setup.sh        # x86 架构
./setup_arm.sh    # ARM 架构（M1/M2/树莓派）

# 后续使用（快速启动）
./quick_start.sh
```

---

### 💡 进阶用户（可选）

<details>
<summary>🪟 Windows WSL 手动安装</summary>

```bash
dos2unix *.sh  # 修复换行符
chmod +x *.sh  # 添加权限
./start_windows.sh  # Windows 专用脚本
```
</details>

<details>
<summary>🍎 macOS 手动安装</summary>

```bash
# Intel Mac
./setup.sh

# Apple Silicon (M1/M2/M3)
./setup_arm.sh
```
</details>

<details>
<summary>🐧 Linux 手动安装</summary>

```bash
# x86_64
./setup.sh

# ARM (树莓派等)
./setup_arm.sh
```
</details>

<details>
<summary>🔧 诊断工具</summary>

```bash
./check_arch.sh   # 检查架构
./diagnose.sh     # 环境诊断
./test_windows.sh # Windows 测试
```
</details>

系统会自动查找可用端口（5000-5010），启动后会显示访问地址。

### 环境要求
- Python 3.10.x（必需，OpenInterpreter 0.4.3 依赖）
- MySQL 或兼容数据库

### 架构兼容性
| 平台 | 架构 | 安装脚本 | 说明 |
|------|------|----------|------|
| Windows WSL | x86_64 | `./start_windows.sh` | 最佳兼容性 |
| Windows WSL | ARM64 | `./setup_arm.sh` | Surface Pro X |
| macOS | Intel | `./setup.sh` | 标准安装 |
| macOS | Apple Silicon | `./setup_arm.sh` | M1/M2/M3 |
| Linux | x86_64 | `./setup.sh` | 标准安装 |
| Linux | ARM64 | `./setup_arm.sh` | 树莓派等 |

📖 详细兼容性说明请查看 [兼容性文档](COMPATIBILITY.md)

## 💡 使用示例

### 基础查询(后续会改进路由系统)       
- "显示最近一个月的销售数据"
- "分析产品类别的销售占比"
- "查找销售额最高的前10个客户"

### 高级分析
- "对比今年和去年同期的销售增长"
- "预测下个季度的销售趋势"
- "找出异常的订单数据"
- "分析客户购买行为模式"

### 复杂任务
- "生成月度销售报告，包含环比、同比和趋势图"
- "分析客户流失原因并给出建议"
- "构建 RFM 客户分层模型"

## 🔧 配置说明

### 支持的模型(选一个能力强的模型是成功出表的关键条件)
- **OpenAI**: GPT-5, GPT-4.1(经济)
- **Anthropic**: Claude 4 Opus, Sonnet(评分最高,最智能的模型,调用工具频繁)
- **Google**: Gemini 2.5pro(litellm可能兼容性有点问题)
- **国产模型**:qwen,deepseek(包括思考模型,但不建议)
- **本地模型**: 通过 Ollama 支持 Llama, Mistral, Qwen 等(基准线为qwen2.5 7b以上,否则代码能力几乎不支持完成agent过程)
- 实践证明成功率最高是Claude4系列模型,gpt-5是比较经济下还很强的选择(甚至由于输入token价格比4.1低),开源模型通用通常比coder模型表现好(不过请自测,这里针对于qwen),思考模型的花费时间太长尤其是deepseek长think-chain,所以不推荐.

### 数据库支持

系统使用标准 MySQL 协议，支持以下数据库：

#### ✅ 完全兼容
- **Apache Doris** / **StarRocks** - OLAP 分析型数据库（推荐用于大数据分析）
- **MySQL 5.7+** / **MariaDB 10.3+** - 传统关系型数据库
- **TiDB** - 分布式 NewSQL 数据库
- **OceanBase** - 分布式数据库（MySQL 模式）
- **PolarDB** - 阿里云原生数据库

#### ⚠️ 需要注意
- 本系统使用**只读查询**（SELECT、SHOW、DESCRIBE）
- 不依赖存储过程、触发器、外键等特性
- 支持跨库查询（配置时不指定数据库名即可）

#### 🔧 连接配置
```bash
# .env 配置示例
DB_HOST=localhost
DB_PORT=9030      # Doris/StarRocks: 9030, MySQL: 3306, TiDB: 4000
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=          # 留空支持跨库查询
```

## 📚 文档

- [完整文档](docs/)
- [API 文档](docs/API.md)
- [部署指南](docs/DEPLOYMENT.md)
- [常见问题](docs/FAQ.md)
- [配置说明](docs/CONFIGURATION.md)

## 最新更新

### 2025-08-25 - AI 智能路由系统上线（Beta）
- **智能分类**: AI 自动识别查询类型（直接SQL、简单分析、复杂分析、可视化）
- **性能优化**: 简单查询直接执行 SQL，响应速度提升 80%+
- **独立配置**: 每种路由类型配备专属 Prompt，精准控制行为
- **灵活控制**: 基础设置中可一键开关智能路由功能
- **完整监控**: 实时统计路由分布，优化系统性能

> 进入 `设置` → `基础设置` → `智能路由` 开启 Beta 功能体验！

### 2025-08-24 - Prompt 自定义功能
- **可视化编辑**: 在设置页面直接编辑 AI 查询提示词
- **配置管理**: 支持保存、恢复默认、导入导出配置
- **灵活定制**: 根据业务需求调整探索策略、表选择规则、字段映射等
- **多语言支持**: 完整的中英文 i18n 支持
- **实时生效**: 修改后立即应用到查询过程

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

## 🙏 致谢

- [OpenInterpreter](https://github.com/OpenInterpreter/open-interpreter) - 核心 AI 引擎
- [Flask](https://flask.palletsprojects.com/) - Web 框架
- [Plotly](https://plotly.com/) - 数据可视化

## 📧 联系方式

- GitHub Issues: [提交问题](https://github.com/MKY508/QueryGPT/issues) 
- Email: mky369258@gmail.com
- 这是作者第一个作品,有任何疑问或者可能需要的改动,都可以提交issue或者pr,我会尽可能进行调整

## ⭐ Star History

<div align="center">
  <a href="https://star-history.com/#MKY508/QueryGPT&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date" />
    </picture>
  </a>
</div>

---

<div align="center">
  <sub>如果觉得有用，请给个 ⭐ Star 支持一下！</sub>
</div>
