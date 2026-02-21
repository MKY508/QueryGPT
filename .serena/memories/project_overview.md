# QueryGPT 项目概述

## 项目简介
QueryGPT 是一个 AI 驱动的数据库查询和分析平台。它允许用户通过自然语言与数据库进行交互，自动生成和执行 SQL 查询，并提供数据可视化功能。

## 技术栈

### 后端 (apps/api)
- **框架**: FastAPI + Python 3.11+
- **数据库**: PostgreSQL (主数据库) + SQLAlchemy (ORM)
- **AI 引擎**: LiteLLM (支持多种 LLM 提供商)
- **认证**: JWT + Argon2 密码哈希
- **SSE**: Server-Sent Events 用于流式响应

### 前端 (apps/web)
- **框架**: Next.js 14 + React + TypeScript
- **样式**: Tailwind CSS
- **状态管理**: Zustand
- **UI组件**: Radix UI

## 项目结构
```
querygpt/
├── apps/
│   ├── api/          # FastAPI 后端
│   │   ├── app/
│   │   │   ├── api/v1/     # API 路由
│   │   │   ├── core/       # 配置、安全
│   │   │   ├── db/         # 数据库模型和会话
│   │   │   ├── models/     # Pydantic 模型
│   │   │   └── services/   # 业务逻辑
│   │   └── tests/
│   └── web/          # Next.js 前端
│       ├── src/
│       │   ├── app/        # Next.js 页面
│       │   ├── components/ # React 组件
│       │   └── lib/        # 工具函数和类型
│       └── tests/
├── docs/             # 文档
└── docker/           # Docker 配置
```

## 核心功能
1. **自然语言转 SQL**: AI 将用户问题转换为 SQL 查询
2. **数据可视化**: 自动生成图表展示查询结果
3. **Python 分析**: 支持使用 pandas/matplotlib 进行数据分析
4. **多数据库支持**: MySQL, PostgreSQL, SQLite
5. **对话历史**: 保存和恢复对话上下文
