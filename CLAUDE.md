# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QueryGPT v2 是自然语言数据库查询助手，采用前后端分离架构。用户输入自然语言，AI 生成 SQL 并执行，返回数据和可视化图表。

## Commands

### 启动开发环境
```bash
./start.sh          # 同时启动前后端
./start.sh stop     # 停止服务
./start.sh restart  # 重启
```

### 后端 (apps/api)
```bash
cd apps/api
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# 数据库迁移
alembic upgrade head
alembic revision --autogenerate -m "description"

# 代码检查
ruff check .
ruff format .
```

### 前端 (apps/web)
```bash
cd apps/web
npm run dev         # 开发服务器 :3000
npm run build       # 构建
npm run lint        # ESLint
npm run type-check  # TypeScript 检查
```

## Architecture

### 后端 FastAPI (apps/api/app/)
- `api/v1/` - API 路由
  - `auth.py` - 注册/登录/刷新 token
  - `chat.py` - SSE 流式对话接口
  - `config.py` - 模型/数据库连接 CRUD
  - `history.py` - 对话历史
- `core/` - 核心模块
  - `config.py` - Pydantic Settings 配置
  - `security.py` - JWT + Fernet 加密
  - `demo_db.py` - SQLite 示例数据库初始化
- `db/tables.py` - SQLAlchemy 2.0 模型 (User, Model, Connection, Conversation, Message)
- `services/`
  - `execution.py` - 执行服务入口
  - `gptme_engine.py` - gptme AI 引擎封装，获取表结构后执行查询

### 前端 Next.js (apps/web/src/)
- `app/` - App Router 页面
  - `page.tsx` - 主页（登录/对话）
  - `settings/page.tsx` - 设置页
- `components/`
  - `chat/` - ChatArea, Sidebar, DataTable, ChartDisplay, SqlHighlight
  - `settings/` - ModelSettings, ConnectionSettings, PreferencesSettings
- `lib/`
  - `api/client.ts` - Axios 实例 + SSE 流处理
  - `stores/auth.ts` - Zustand 认证状态
  - `stores/chat.ts` - Zustand 对话状态

### 数据流
1. 用户输入 → `ChatArea` → `POST /api/v1/chat/stream` (SSE)
2. 后端 `ExecutionService` → `GptmeEngine` 获取表结构 → 生成 SQL → 执行
3. SSE 事件: `thinking` → `code` → `result` → `chart` → `done`
4. 前端解析事件更新 UI

## Key Patterns

- **认证**: JWT access token (1h) + refresh token (7d)，存 localStorage `querygpt-auth`
- **加密**: API Key 用 Fernet 加密存储，密钥在 `ENCRYPTION_KEY`
- **SSE**: 使用 `sse-starlette`，前端用 `EventSource` 或 fetch ReadableStream
- **状态**: Zustand persist 中间件持久化，TanStack Query 管理服务端状态

## Environment

后端 `apps/api/.env`:
```
DATABASE_URL=postgresql+asyncpg://...
JWT_SECRET_KEY=...
ENCRYPTION_KEY=...  # Fernet key
OPENAI_API_KEY=...
```

前端 `apps/web/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```
