<div align="center">

<img src="docs/images/logo.svg" width="320" alt="QueryGPT logo">

### 用自然语言驱动数据库 — 提问、查询、分析、图表，一步到位。

开源 AI 数据库助手 | 中文优先 | 本地部署 | 只读安全

[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000.svg?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![GitHub stars](https://img.shields.io/github/stars/mky508/querygpt?style=for-the-badge)](https://github.com/mky508/querygpt/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/mky508/querygpt?style=for-the-badge)](https://github.com/mky508/querygpt/commits/main)

</div>

---

<img src="docs/images/chat.png" alt="对话工作台" width="100%">

---

## 核心能力

<table>
<tr>
<td width="50%">

**自然语言查询**

用中文描述需求，自动生成并执行只读 SQL，返回结构化结果。

</td>
<td width="50%">

**多模型适配**

支持 OpenAI-compatible、Anthropic、Ollama、Custom 网关，一套配置切换。

</td>
</tr>
<tr>
<td>

**自动分析链路**

查询结果自动衔接 Python 分析与图表生成，一次提问完成完整分析。

</td>
<td>

**诊断与自愈**

展示 provider、连接状态、执行轨迹；SQL 或 Python 执行出错时自动修复。

</td>
</tr>
<tr>
<td>

**语义层**

定义业务术语（GMV、客单价等），AI 查询时自动引用，消除歧义。

</td>
<td>

**Schema 关系视图**

可视化拖拽建立表间 JOIN 关系，AI 自动使用正确的关联路径。

</td>
</tr>
</table>

## 工作流程

```mermaid
graph LR
    A[自然语言提问] --> B[SQL 生成] --> C[执行查询] --> D[Python 分析] --> E[图表输出]
    C -- 出错 --> F[自动修复] --> B
    D -- 出错 --> F
```

## 界面一览

<table>
<tr>
<td width="50%" align="center">

<img src="docs/images/schema.png" alt="Schema 关系视图" width="100%">

**Schema 关系视图**

</td>
<td width="50%" align="center">

<img src="docs/images/semantic.png" alt="语义层配置" width="100%">

**语义层配置**

</td>
</tr>
</table>

## 快速开始

![Python](https://img.shields.io/badge/需要-Python_3.11+-3776AB?logo=python&logoColor=white)
![Node.js](https://img.shields.io/badge/需要-Node.js_LTS-339933?logo=node.js&logoColor=white)

```bash
git clone git@github.com:mky508/querygpt.git
cd querygpt
./start.sh
```

启动后访问 `http://localhost:3000`，首次使用：

1. 在设置页添加模型（填入 provider 和 API Key）
2. 使用内置的 `示例数据库`，或添加自己的 SQLite / MySQL / PostgreSQL 连接
3. 按需设置默认模型、默认连接和上下文轮数
4. 回到聊天页开始提问

> 项目内置 SQLite 示例库 `demo.db`，空工作区启动时会自动补回示例连接。

## 技术栈

**前端**<br>
![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-5-764ABC)
![TanStack Query](https://img.shields.io/badge/TanStack_Query-5-FF4154)

**后端**<br>
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0-D71F00)
![LiteLLM](https://img.shields.io/badge/LiteLLM-latest-blue)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)

**数据库**<br>
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)

<details>
<summary><strong>配置说明</strong></summary>

### 模型

支持 OpenAI-compatible、Anthropic、Ollama、Custom 网关。可配置项：

| 字段 | 说明 |
|------|------|
| `provider` | 模型提供方 |
| `base_url` | API 端点 |
| `model_id` | 模型标识 |
| `api_key` | 密钥（Ollama 或无需鉴权的网关可启用可选模式） |
| `extra headers` | 自定义请求头 |
| `query params` | 自定义查询参数 |
| `api_format` | API 格式 |
| `healthcheck_mode` | 健康检查方式 |

### 数据库

支持 SQLite、MySQL、PostgreSQL。系统只允许执行只读 SQL。

内置 SQLite 示例库：
- 路径：`apps/api/data/demo.db`
- 默认连接名：`示例数据库`

</details>

<details>
<summary><strong>启动脚本</strong></summary>

```bash
./start.sh          # 默认启动（检查环境、安装依赖、初始化数据库、启动前后端）
./start.sh setup    # 仅安装环境
./start.sh stop     # 停止服务
./start.sh restart  # 重启服务
./start.sh status   # 查看状态
./start.sh logs     # 查看日志
./start.sh doctor   # 环境诊断
./start.sh test all # 运行全部测试
./start.sh cleanup  # 清理临时文件
```

补装分析依赖（`scikit-learn`、`scipy`、`seaborn`）：

```bash
./start.sh install analytics
```

可选环境变量：

```bash
QUERYGPT_BACKEND_RELOAD=1 ./start.sh    # 后端热重载
QUERYGPT_BACKEND_HOST=0.0.0.0 ./start.sh # 监听所有网卡
```

</details>

<details>
<summary><strong>本地开发</strong></summary>

### 后端

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 前端

```bash
cd apps/web
npm install
npm run dev
```

### 环境变量

后端 `apps/api/.env`：

```env
DATABASE_URL=sqlite+aiosqlite:///./data/querygpt.db
ENCRYPTION_KEY=your-fernet-key
```

前端 `apps/web/.env.local`：

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 测试

```bash
# 前端
cd apps/web && npm run type-check && npm test && npm run build

# 后端
./apps/api/run-tests.sh
```

</details>

<details>
<summary><strong>部署</strong></summary>

### 后端

仓库自带 [render.yaml](render.yaml)，可直接用于 Render Blueprint 部署。

### 前端

推荐部署到 Vercel：

- Root Directory: `apps/web`
- Environment Variable: `NEXT_PUBLIC_API_URL=<your-api-url>`

</details>

## 已知边界

- 只允许只读 SQL，不支持写操作
- 自动修复覆盖 SQL、Python、图表配置等可恢复错误
- `/chat/stop` 按单实例语义设计
- 开发环境建议使用 Node.js LTS；如 `next dev` 异常，先清理 `apps/web/.next`

## 许可证

MIT
