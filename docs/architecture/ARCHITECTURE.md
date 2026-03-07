# QueryGPT 当前架构

> 以当前仓库实现为准。项目已经收口为单工作区、本地优先模式；旧版多用户 / JWT 叙述已不再适用。

## Summary

QueryGPT 现在是一个两层应用:

- 前端: Next.js 15 App Router，负责聊天工作台、设置页、历史记录和可视化展示
- 后端: FastAPI，负责配置管理、执行编排、SSE 输出、元数据持久化和目标数据库访问

核心原则:

- 对外协议保持稳定，内部实现允许持续重构
- 路由层和页面层尽量薄，只做 HTTP / UI 适配
- 复杂逻辑拆到明确的服务、helper 和 hook 中
- 聊天执行链路按“解析上下文 -> 生成 -> SQL -> Python -> 可视化 -> 持久化”推进

## Backend

当前后端主干分成四层:

1. API 路由
   - `app/api/v1/chat.py` 负责请求解析、SSE 包装、会话生命周期和停止控制
   - 其他 `config` / `history` / `schema` 路由负责资源 CRUD

2. 服务编排
   - `execution.py` 负责装配模型配置、连接配置、语义上下文、关系上下文和系统能力
   - `gptme_engine.py` 负责执行工作流编排，不再承载所有纯算法细节
   - `chat_runtime.py` 负责聊天会话辅助、事件累积和 metadata 合并

3. 纯 helper / 运行时模块
   - `model_runtime.py` 负责 provider 解析和运行时配置归一化
   - `system_prompt_builder.py` 负责系统提示词拼装
   - `engine_content.py` / `engine_prompts.py` / `engine_visualization.py` / `engine_workflow.py`
     负责输出解析、修复提示、图表构建和执行状态对象
   - `python_runtime.py` 负责 Python 代码安全检查与执行
   - `engine_diagnostics.py` 负责错误分类和诊断条目

4. 数据访问
   - 应用自身元数据走 SQLAlchemy async 模型
   - 目标数据库访问走 `DatabaseManager`
   - `database.py` 只保留连接、只读校验和 schema 拼装
   - `database_adapters.py` 按驱动拆分 MySQL / PostgreSQL / SQLite 适配器

### Chat Execution Flow

一次聊天请求的内部顺序:

1. 路由创建或恢复对话，并保存用户消息
2. `ExecutionService` 解析模型、连接、默认提示词、上下文轮数、语义层和关系
3. `GptmeEngine` 创建执行状态并开始流式生成
4. 如果模型缺 SQL 或 SQL / Python 执行失败，按诊断规则触发自动修复
5. 产出 `result`、`visualization`、`python_output`、`python_image` 等 SSE 事件
6. 路由累积结果、更新会话 metadata、保存 assistant 消息并结束对话

### Backend Boundaries

后端重构的边界要求:

- 外部 SSE 事件形状不变
- `/api/v1/*` 路由不变
- 数据库 schema 不变
- 新逻辑优先做成纯 helper 或显式状态对象，避免再次长回“大而全 service”

## Frontend

前端当前按三类职责组织:

1. 页面和容器组件
   - `components/chat/*` 负责聊天展示和交互
   - `components/settings/*` 负责配置页面

2. 状态与数据获取
   - `lib/stores/chat.ts` 管理聊天本地状态
   - `lib/stores/chat-helpers.ts` 负责 SSE 事件应用
   - 设置页的数据请求逐步收敛到资源 hook

3. 共享类型与 helper
   - `lib/types/api.ts` / `lib/types/chat.ts` / `lib/types/schema.ts`
   - `lib/settings/*` 存放设置页表单序列化、导出、Schema 布局 helper

### Settings Structure

设置页的目标结构是:

- 容器组件: 管理少量页面状态和组合布局
- 资源 hook: 管理 query / mutation / API 错误
- 表单组件: 只渲染字段和提交事件
- 列表组件: 只渲染卡片、操作按钮和空态

当前已经先对 `ModelSettings`、`ConnectionSettings` 做了这一层拆分；`SchemaSettings` 先抽离了节点、边和布局快照的纯 helper。

## Quality Gates

默认回归基线:

- 后端: `./apps/api/run-tests.sh`
- 前端: `npm run lint`
- 前端: `npm run type-check`
- 前端: `npm test`
- 前端构建: `npm run build`

对“无功能优化重构”的要求:

- 先扩测试和类型护栏，再动大文件
- 主流程文件只保留编排职责
- 纯函数优先提到共享 helper，避免 JSX / 路由 / service 内联复杂分支
