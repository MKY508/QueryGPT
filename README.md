<div align="center">

  <h1>🚀 QueryGPT v2</h1>

  <p><strong>自然语言数据库查询助手 - 全新架构重构版本</strong></p>

  <p>
    <a href="#-快速开始">快速开始</a> •
    <a href="#-架构升级">架构升级</a> •
    <a href="#-功能特性">功能特性</a> •
    <a href="#-技术栈">技术栈</a> •
    <a href="#-配置说明">配置说明</a>
  </p>

  [![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.11+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
  [![Next.js](https://img.shields.io/badge/Next.js-15-black.svg?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
  [![React](https://img.shields.io/badge/React-19-61DAFB.svg?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)

</div>

---

## 🆕 v2 架构升级

QueryGPT v2 是对原版的**完全重构**，采用现代化的前后端分离架构：

| 对比项 | v1 (原版) | v2 (新版) |
|--------|-----------|-----------|
| **后端框架** | Flask | FastAPI (异步) |
| **前端框架** | Jinja2 模板 | Next.js 15 + React 19 |
| **AI 引擎** | OpenInterpreter | gptme |
| **数据库 ORM** | SQLAlchemy 1.x | SQLAlchemy 2.0 (异步) |
| **用户认证** | 无 | JWT (access + refresh token) |
| **状态管理** | 无 | Zustand + TanStack Query |
| **响应模式** | 同步 | SSE 流式响应 |
| **类型安全** | 无 | TypeScript + Pydantic v2 |
| **API 文档** | 无 | OpenAPI (Swagger) |

### 为什么重构？

- **性能提升**: FastAPI 异步架构，支持高并发
- **用户体验**: 流式响应，实时显示 AI 思考过程
- **多用户支持**: 完整的认证系统，数据隔离
- **可维护性**: 前后端分离，TypeScript 类型安全
- **可扩展性**: 模块化设计，易于添加新功能

---

## ✨ 功能特性

### 🗣️ 自然语言查询
- 用自然语言与数据库交互
- 支持复杂的多表关联查询
- 智能理解中文业务术语（环比、同比、留存等）

### ⚡ 流式响应
- SSE 实时推送 AI 思考过程
- 代码执行结果即时展示
- 支持中断正在执行的查询

### 📊 数据可视化
- 使用 Plotly 自动生成交互式图表
- 根据数据特征智能选择图表类型
- 支持导出图表和数据

### 🔐 多用户支持
- JWT 双 Token 认证 (access + refresh)
- 用户数据完全隔离
- 支持多数据库连接管理

### 🤖 多模型支持
- **OpenAI**: GPT-4o, GPT-4, GPT-3.5
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Opus
- **本地模型**: 通过 Ollama 支持 Llama, Qwen 等

### 🗄️ 多数据库支持
- **PostgreSQL** - 推荐用于生产环境
- **MySQL / MariaDB** - 完全兼容
- **SQLite** - 内置示例数据库，开箱即用

---

## 📸 系统截图

<table>
  <tr>
    <td align="center">
      <img src="docs/images/login.png" width="100%" alt="登录界面"/>
      <b>登录与账号管理</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/chat.png" width="100%" alt="对话界面"/>
      <b>AI 对话与数据分析</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/settings.png" width="100%" alt="设置界面"/>
      <b>设置界面</b>
    </td>
  </tr>
</table>

---

## 🚀 快速开始

### 前置要求

- **Python 3.11+**
- **Node.js 18+**
- **Docker** (可选，用于 PostgreSQL)

### 一键启动

```bash
# 克隆项目
git clone https://github.com/your-repo/querygpt-v2.git
cd querygpt-v2

# 一键启动 (macOS / Linux)
./start.sh

# Windows PowerShell
.\start.ps1

# Windows CMD
start.bat
```

### 启动命令

| 命令 | 说明 |
|------|------|
| `./start.sh` | 启动所有服务 |
| `./start.sh stop` | 停止服务 |
| `./start.sh restart` | 重启服务 |
| `./start.sh status` | 查看状态 |
| `./start.sh logs` | 查看日志 |
| `./start.sh setup` | 仅安装依赖 |

### 访问服务

| 服务 | 地址 |
|------|------|
| 🌐 前端 | http://localhost:3000 |
| 🔧 后端 API | http://localhost:8000 |
| 📚 API 文档 | http://localhost:8000/api/docs |

### 🎯 开箱即用

v2 内置了 **SQLite 示例数据库**，包含：
- 📦 产品数据 (20+ 产品)
- 👥 客户数据 (50+ 客户)
- 💰 销售数据 (500+ 记录，12个月)
- 📋 订单数据 (100+ 订单)

注册后即可直接体验，无需配置外部数据库！

---

## 🐳 Docker 部署

```bash
# 启动所有服务
docker compose -f docker/docker-compose.yml up -d

# 查看日志
docker compose -f docker/docker-compose.yml logs -f

# 停止服务
docker compose -f docker/docker-compose.yml down
```

---

## ⚙️ 配置说明

### 后端配置 (`apps/api/.env`)

```env
# ===== 数据库配置 =====
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/querygpt

# ===== JWT 配置 =====
# 生产环境请使用: openssl rand -hex 32
JWT_SECRET_KEY=your-secret-key-change-in-production

# ===== 加密配置 =====
# 生成方法: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ENCRYPTION_KEY=your-fernet-key

# ===== LLM 配置 =====
DEFAULT_MODEL=gpt-4o
OPENAI_API_KEY=sk-your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1

# 可选: Anthropic
# ANTHROPIC_API_KEY=sk-ant-your-key
```

### 前端配置 (`apps/web/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 📁 项目结构

```
querygpt-v2/
├── apps/
│   ├── api/                    # FastAPI 后端
│   │   ├── app/
│   │   │   ├── api/v1/         # API 路由
│   │   │   │   ├── auth.py     # 认证接口
│   │   │   │   ├── chat.py     # 对话接口 (SSE)
│   │   │   │   └── config.py   # 配置接口
│   │   │   ├── core/           # 核心模块
│   │   │   │   ├── config.py   # 配置管理
│   │   │   │   ├── security.py # 安全 & 加密
│   │   │   │   └── demo_db.py  # 示例数据库
│   │   │   ├── db/             # 数据库
│   │   │   │   └── tables.py   # SQLAlchemy 模型
│   │   │   ├── models/         # Pydantic 模型
│   │   │   └── services/       # 业务逻辑
│   │   │       ├── execution.py    # 执行服务
│   │   │       └── gptme_engine.py # AI 引擎
│   │   └── alembic/            # 数据库迁移
│   │
│   └── web/                    # Next.js 前端
│       └── src/
│           ├── app/            # App Router 页面
│           ├── components/     # React 组件
│           │   ├── chat/       # 对话组件
│           │   └── settings/   # 设置组件
│           └── lib/            # 工具库
│               ├── api/        # API 客户端
│               └── stores/     # Zustand 状态
│
├── docker/                     # Docker 配置
├── docs/                       # 文档
│   ├── api/                    # API 文档
│   ├── architecture/           # 架构文档
│   └── images/                 # 截图
├── start.sh                    # 启动脚本
└── README.md
```

---

## 🔧 技术栈详解

### 后端 (FastAPI)

| 技术 | 用途 |
|------|------|
| **FastAPI** | 异步 Web 框架，自动生成 OpenAPI 文档 |
| **SQLAlchemy 2.0** | 异步 ORM，支持类型提示 |
| **Pydantic v2** | 数据验证，序列化 |
| **gptme** | AI 执行引擎，支持代码执行 |
| **LiteLLM** | 统一的 LLM API 接口 |
| **Alembic** | 数据库迁移 |
| **Fernet** | 敏感数据加密 |

### 前端 (Next.js)

| 技术 | 用途 |
|------|------|
| **Next.js 15** | React 全栈框架，App Router |
| **React 19** | UI 库 |
| **TypeScript** | 类型安全 |
| **Tailwind CSS** | 原子化 CSS |
| **shadcn/ui** | UI 组件库 |
| **Zustand** | 轻量状态管理 |
| **TanStack Query** | 服务端状态管理 |
| **Axios** | HTTP 客户端 |

---

## 💡 使用示例

### 基础查询
```
"显示最近一个月的销售数据"
"分析产品类别的销售占比"
"查找销售额最高的前10个客户"
```

### 高级分析
```
"对比今年和去年同期的销售增长"
"预测下个季度的销售趋势"
"找出异常的订单数据"
"分析客户购买行为模式"
```

### 可视化
```
"用柱状图展示各产品的销量"
"绘制销售额的月度趋势图"
"生成客户地区分布饼图"
```

---

## 🔒 安全特性

- **JWT 双 Token**: Access Token (1h) + Refresh Token (7d)
- **密码加密**: bcrypt 哈希存储
- **API Key 加密**: Fernet 对称加密
- **SQL 注入防护**: 参数化查询
- **只读 SQL**: 仅允许 SELECT/SHOW/DESCRIBE
- **CORS 配置**: 可配置允许的域名

---

## 🐛 常见问题

### 端口被占用

```bash
# 查看占用端口的进程
lsof -i :8000  # macOS/Linux
netstat -ano | findstr :8000  # Windows

# 杀死进程
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

### 数据库连接失败

1. 确保 PostgreSQL 正在运行
2. 检查 `.env` 中的 `DATABASE_URL` 配置
3. 如果使用 Docker: `docker ps` 确认容器运行

### API Key 丢失

如果保存的 API Key 无法使用：
1. 检查 `.env` 中的 `ENCRYPTION_KEY` 是否为有效的 Fernet key
2. 生成新 key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
3. 更新 `.env` 后重新保存 API Key

---

## 📖 API 文档

详细 API 文档请查看：
- [API 接口文档](docs/api/API.md)
- [数据库设计](docs/api/DATABASE.md)
- [架构设计](docs/architecture/ARCHITECTURE.md)

或访问在线文档: http://localhost:8000/api/docs

---

## 🔄 从 v1 迁移

如果你正在使用 QueryGPT v1：

1. **数据不兼容**: v2 使用全新的数据库结构
2. **配置迁移**: 需要重新配置模型和数据库连接
3. **功能增强**: v2 支持多用户，需要注册账号

详细迁移指南请参考 [迁移文档](docs/MIGRATION.md)。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

## 📧 联系方式

- GitHub Issues: [提交问题](https://github.com/your-repo/querygpt-v2/issues)
- Email: mky369258@gmail.com

---

<div align="center">
  <sub>如果觉得有用，请给个 ⭐ Star 支持一下！</sub>
</div>
