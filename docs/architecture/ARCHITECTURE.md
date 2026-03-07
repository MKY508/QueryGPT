# QueryGPT v2 架构设计文档

> 注: 当前实现已经从多用户 JWT 架构收口为单用户、本地优先工作区。本文档尚未完成全量重写，架构总览请优先参考 `README.md` 与当前代码。

## 1. 项目概述

QueryGPT 是一个自然语言数据库查询助手，允许用户通过自然语言与数据库交互，获取数据分析和可视化结果。

### 1.1 核心功能

| 功能 | 描述 |
|------|------|
| 自然语言查询 | 用户输入自然语言，系统生成并执行 SQL |
| 流式响应 | 实时显示 AI 思考过程和执行步骤 |
| 数据可视化 | 自动生成图表（柱状图、折线图、饼图等） |
| 多模型支持 | 支持 OpenAI、Anthropic、本地模型等 |
| 多数据库支持 | MySQL、PostgreSQL、SQLite |
| 历史记录 | 保存和管理对话历史 |
| 多用户 | 用户注册、登录、权限管理 |
| 双视图模式 | 用户视图（简洁）和开发者视图（详细） |

### 1.2 技术栈

```
┌─────────────────────────────────────────────────────────────┐
│                     前端 (Next.js 15)                        │
├─────────────────────────────────────────────────────────────┤
│  Framework    │ Next.js 15 (App Router)                     │
│  UI Library   │ shadcn/ui + Tailwind CSS 4                  │
│  State        │ Zustand + TanStack Query v5                 │
│  Charts       │ Recharts / ECharts                          │
│  i18n         │ next-intl                                   │
│  Language     │ TypeScript 5.x                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ REST API + SSE
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     后端 (FastAPI)                           │
├─────────────────────────────────────────────────────────────┤
│  Framework    │ FastAPI 0.115+                              │
│  ORM          │ SQLAlchemy 2.0 (async)                      │
│  Validation   │ Pydantic v2                                 │
│  AI Engine    │ gptme + LiteLLM                             │
│  Auth         │ JWT + OAuth2                                │
│  Database     │ PostgreSQL (主) / MySQL / SQLite            │
│  Cache        │ Redis (可选)                                │
│  Language     │ Python 3.11+                                │
└─────────────────────────────────────────────────────────────┘
```

## 2. 系统架构

### 2.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                           客户端层                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Web App   │  │  Mobile App │  │   CLI Tool  │              │
│  │  (Next.js)  │  │   (Future)  │  │   (Future)  │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
          └────────────────┼────────────────┘
                           │ HTTPS
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                          API 网关层                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    FastAPI Application                      │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │ │
│  │  │   Auth   │ │   Chat   │ │  History │ │  Config  │      │ │
│  │  │  Router  │ │  Router  │ │  Router  │ │  Router  │      │ │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘      │ │
│  └───────┼────────────┼────────────┼────────────┼─────────────┘ │
└──────────┼────────────┼────────────┼────────────┼───────────────┘
           │            │            │            │
           ▼            ▼            ▼            ▼
┌──────────────────────────────────────────────────────────────────┐
│                          服务层                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │   Auth   │ │Execution │ │  History │ │  Config  │            │
│  │ Service  │ │ Service  │ │ Service  │ │ Service  │            │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘            │
│       │            │            │            │                   │
│       │      ┌─────┴─────┐      │            │                   │
│       │      │   gptme   │      │            │                   │
│       │      │  Engine   │      │            │                   │
│       │      └─────┬─────┘      │            │                   │
└───────┼────────────┼────────────┼────────────┼───────────────────┘
        │            │            │            │
        ▼            ▼            ▼            ▼
┌──────────────────────────────────────────────────────────────────┐
│                          数据层                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  PostgreSQL  │  │ Target DBs   │  │    Redis     │           │
│  │  (App Data)  │  │ (User Query) │  │   (Cache)    │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
用户输入 "查询上月销售额"
         │
         ▼
┌─────────────────┐
│  1. 前端发送    │ POST /api/v1/chat/stream
│     SSE 请求    │ { query: "查询上月销售额", model: "gpt-4o" }
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  2. 认证中间件  │ 验证 JWT Token
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  3. Chat Router │ 解析请求，创建会话
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  4. Execution   │ 调用 gptme 执行
│     Service     │
└────────┬────────┘
         │
         ├──► SSE: { type: "progress", data: { stage: "analyzing" } }
         │
         ├──► SSE: { type: "progress", data: { stage: "generating_sql" } }
         │
         ├──► SSE: { type: "progress", data: { stage: "executing" } }
         │
         ▼
┌─────────────────┐
│  5. 执行 SQL    │ 连接目标数据库执行查询
└────────┬────────┘
         │
         ├──► SSE: { type: "result", data: { sql: "...", data: [...] } }
         │
         ▼
┌─────────────────┐
│  6. 生成可视化  │ 根据数据生成图表
└────────┬────────┘
         │
         ├──► SSE: { type: "visualization", data: { chart: {...} } }
         │
         ▼
┌─────────────────┐
│  7. 保存历史    │ 存储到 PostgreSQL
└────────┬────────┘
         │
         └──► SSE: { type: "done", data: { conversation_id: "..." } }
```

## 3. 数据库设计

### 3.1 ER 图

```
┌─────────────────┐       ┌─────────────────┐
│      users      │       │   connections   │
├─────────────────┤       ├─────────────────┤
│ id (PK)         │──┐    │ id (PK)         │
│ email           │  │    │ user_id (FK)    │──┐
│ hashed_password │  │    │ name            │  │
│ display_name    │  │    │ driver          │  │
│ avatar_url      │  │    │ host            │  │
│ role            │  │    │ port            │  │
│ is_active       │  │    │ username        │  │
│ created_at      │  │    │ password_enc    │  │
│ updated_at      │  │    │ database        │  │
└─────────────────┘  │    │ is_default      │  │
                     │    │ created_at      │  │
                     │    └─────────────────┘  │
                     │                         │
                     │    ┌─────────────────┐  │
                     │    │  conversations  │  │
                     │    ├─────────────────┤  │
                     └───►│ id (PK)         │  │
                          │ user_id (FK)    │◄─┘
                          │ connection_id   │
                          │ title           │
                          │ model           │
                          │ is_favorite     │
                          │ status          │
                          │ created_at      │
                          │ updated_at      │
                          └────────┬────────┘
                                   │
                                   │ 1:N
                                   ▼
                          ┌─────────────────┐
                          │    messages     │
                          ├─────────────────┤
                          │ id (PK)         │
                          │ conversation_id │
                          │ role            │
                          │ content         │
                          │ metadata        │
                          │ created_at      │
                          └─────────────────┘

┌─────────────────┐       ┌─────────────────┐
│     models      │       │     prompts     │
├─────────────────┤       ├─────────────────┤
│ id (PK)         │       │ id (PK)         │
│ user_id (FK)    │       │ user_id (FK)    │
│ name            │       │ name            │
│ provider        │       │ type            │
│ model_id        │       │ content_zh      │
│ base_url        │       │ content_en      │
│ api_key_enc     │       │ is_default      │
│ is_default      │       │ created_at      │
│ created_at      │       │ updated_at      │
└─────────────────┘       └─────────────────┘
```

### 3.2 表结构详情

见 `docs/api/DATABASE.md`

## 4. API 设计

### 4.1 API 版本策略

- 所有 API 以 `/api/v1/` 为前缀
- 重大变更时增加版本号 `/api/v2/`
- 旧版本保持兼容至少 6 个月

### 4.2 API 端点概览

| 模块 | 端点 | 方法 | 描述 |
|------|------|------|------|
| **认证** | `/api/v1/auth/register` | POST | 用户注册 |
| | `/api/v1/auth/login` | POST | 用户登录 |
| | `/api/v1/auth/refresh` | POST | 刷新 Token |
| | `/api/v1/auth/me` | GET | 获取当前用户 |
| **聊天** | `/api/v1/chat/stream` | GET | SSE 流式聊天 |
| | `/api/v1/chat/stop` | POST | 停止执行 |
| **历史** | `/api/v1/conversations` | GET | 获取对话列表 |
| | `/api/v1/conversations/{id}` | GET | 获取对话详情 |
| | `/api/v1/conversations/{id}` | DELETE | 删除对话 |
| **模型** | `/api/v1/models` | GET | 获取模型列表 |
| | `/api/v1/models` | POST | 添加模型 |
| | `/api/v1/models/{id}` | PUT | 更新模型 |
| | `/api/v1/models/{id}` | DELETE | 删除模型 |
| **连接** | `/api/v1/connections` | GET | 获取数据库连接 |
| | `/api/v1/connections` | POST | 添加连接 |
| | `/api/v1/connections/{id}/test` | POST | 测试连接 |
| **配置** | `/api/v1/config` | GET | 获取配置 |
| | `/api/v1/config` | PUT | 更新配置 |

详细 API 文档见 `docs/api/API.md`

## 5. 安全设计

### 5.1 认证流程

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│  Client │                    │   API   │                    │   DB    │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
     │  POST /auth/login            │                              │
     │  { email, password }         │                              │
     │─────────────────────────────►│                              │
     │                              │  查询用户                     │
     │                              │─────────────────────────────►│
     │                              │◄─────────────────────────────│
     │                              │                              │
     │                              │  验证密码 (bcrypt)            │
     │                              │                              │
     │  { access_token,             │                              │
     │    refresh_token }           │                              │
     │◄─────────────────────────────│                              │
     │                              │                              │
     │  GET /chat/stream            │                              │
     │  Authorization: Bearer xxx   │                              │
     │─────────────────────────────►│                              │
     │                              │  验证 JWT                    │
     │                              │                              │
     │  SSE Response                │                              │
     │◄─────────────────────────────│                              │
```

### 5.2 安全措施

| 措施 | 实现 |
|------|------|
| 密码存储 | bcrypt 哈希 |
| Token | JWT (RS256) |
| API 密钥存储 | AES-256 加密 |
| SQL 注入防护 | 参数化查询 + 只读限制 |
| XSS 防护 | 输出转义 + CSP |
| CORS | 白名单域名 |
| 速率限制 | 滑动窗口算法 |

## 6. 部署架构

### 6.1 Docker Compose (开发/小规模)

```yaml
services:
  web:
    build: ./apps/web
    ports: ["3000:3000"]

  api:
    build: ./apps/api
    ports: ["8000:8000"]
    depends_on: [db, redis]

  db:
    image: postgres:16
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
```

### 6.2 Kubernetes (生产)

```
┌─────────────────────────────────────────────────────────────┐
│                        Ingress                               │
│                    (nginx-ingress)                           │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ Web Pod  │   │ API Pod  │   │ API Pod  │
    │ (Next.js)│   │(FastAPI) │   │(FastAPI) │
    └──────────┘   └────┬─────┘   └────┬─────┘
                        │              │
                        └──────┬───────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
              ┌──────────┐         ┌──────────┐
              │PostgreSQL│         │  Redis   │
              │ (Primary)│         │ Cluster  │
              └──────────┘         └──────────┘
```

## 7. 开发规范

### 7.1 代码风格

- **Python**: Ruff (格式化 + Lint)
- **TypeScript**: ESLint + Prettier
- **提交信息**: Conventional Commits

### 7.2 分支策略

```
main ─────────────────────────────────────────►
  │
  └─► develop ────────────────────────────────►
        │
        ├─► feature/xxx ──► PR ──► develop
        │
        └─► fix/xxx ──► PR ──► develop
```

### 7.3 测试要求

| 类型 | 覆盖率要求 | 工具 |
|------|-----------|------|
| 单元测试 | ≥80% | pytest |
| 集成测试 | 关键路径 | pytest + httpx |
| E2E 测试 | 核心流程 | Playwright |

## 8. 迁移计划

### Phase 1: 基础设施 ✅
- [x] 创建项目结构
- [x] 设置 FastAPI 框架
- [x] 定义数据模型 (SQLAlchemy 2.0)
- [x] 数据库迁移脚本 (Alembic)

### Phase 2: 核心功能 ✅
- [x] 用户认证 (JWT + OAuth2)
- [x] gptme 集成 (GptmeEngine)
- [x] 聊天 API (SSE 流式响应)
- [x] 历史记录 (对话/消息 CRUD)

### Phase 3: 前端 ✅
- [x] Next.js 15 项目 (App Router)
- [x] 核心组件 (ChatArea, Sidebar, DataTable, ChartDisplay)
- [x] API 集成 (Axios + SSE)
- [x] 状态管理 (Zustand + TanStack Query)

### Phase 4: 完善 🔄
- [x] 模型管理 (CRUD + 测试连接)
- [x] 数据库连接管理 (MySQL/PostgreSQL/SQLite)
- [ ] 国际化 (next-intl)
- [x] 主题切换 (7 个艺术主题)

### Phase 5: 部署 🔄
- [x] Docker 配置 (docker-compose + Dockerfile)
- [ ] CI/CD (GitHub Actions)
- [x] 文档完善 (API/架构文档)
- [x] 示例数据库 (demo_db.py)

## 9. 待开发功能

### 高优先级
- [ ] 国际化 (i18n) - 中英文切换
- [ ] CI/CD 流水线 - 自动测试/部署
- [ ] 单元测试覆盖 - pytest + vitest

### 中优先级
- [ ] 提示词模板管理
- [ ] 查询结果导出 (CSV/Excel)
- [ ] 对话分享功能

### 低优先级
- [ ] Mobile App (React Native)
- [ ] CLI Tool
- [ ] Redis 缓存集成
