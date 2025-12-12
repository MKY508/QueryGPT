<div align="center">

  <img src="docs/images/logo.svg" width="400" alt="QueryGPT">

  <p>自然语言数据库查询助手chatbi - v2 重构版</p>

  [![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.11+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
  [![Next.js](https://img.shields.io/badge/Next.js-15-black.svg?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)

  > 📢 **需要旧版？** 请切换到 [v1 分支](https://github.com/MKY508/QueryGPT/tree/v1)

  ### 一键部署 (免费)

  [![Deploy Backend](https://img.shields.io/badge/1.%20部署后端-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://render.com/deploy?repo=https://github.com/MKY508/QueryGPT)
  [![Deploy Frontend](https://img.shields.io/badge/2.%20部署前端-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMKY508%2FQueryGPT&root-directory=apps/web&env=NEXT_PUBLIC_API_URL&envDescription=填入上一步获取的后端URL&project-name=querygpt-web)

  <sub>👆 先点左边部署后端，获取 URL 后再点右边部署前端</sub>

</div>

---

## v2 架构升级

v2 是完全重构版本，前后端分离架构：

| 对比 | v1 | v2 |
|------|-----|-----|
| 后端 | Flask | FastAPI |
| 前端 | Jinja2 | Next.js 15 |
| AI 引擎 | OpenInterpreter | gptme |
| 认证 | 无 | JWT |
| 响应 | 同步 | SSE 流式 |

**主要改进**：一键启动脚本、JWT 多用户权限、密钥加密存储、异步高性能后端、gptme 替代 OpenInterpreter（更快更轻量）、模块化 React 前端

---

## 功能

-  **自然语言查询** - 用中文描述需求，AI 自动生成 SQL
-  **语义层** - 定义业务术语（如"月活用户"、"GMV"），AI 自动理解并转换为 SQL 表达式
-  **SSE 流式响应** - 实时显示思考过程，支持多轮问答
-  **数据可视化** - Plotly 图表嵌入前端展示
-  **多租户** - 多用户、多模型、多数据库支持
-  **开箱即用** - 内置 SQLite 示例数据库

### 语义层特性

语义层让 AI 更懂你的业务数据：

| 术语类型 | 说明 | 示例 |
|---------|------|------|
| **指标** | 可计算的数值 | 月活用户 → `COUNT(DISTINCT user_id)` |
| **维度** | 分组依据 | 地区 → `region` |
| **筛选条件** | 常用过滤 | 活跃用户 → `last_active >= DATE_SUB(NOW(), 30)` |
| **别名** | 表/字段映射 | 订单表 → `orders` |

在设置页面的"语义层"标签中配置术语，AI 生成 SQL 时会自动参考这些定义。

---

## 截图

<table>
  <tr>
    <td align="center">
      <img src="docs/images/login.png" width="100%" alt="登录界面"/>
      <b>登录</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/chat.png" width="100%" alt="对话界面"/>
      <b>对话</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/schema.png" width="100%" alt="表关系配置"/>
      <b>表关系配置</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/semantic.png" width="100%" alt="语义层配置"/>
      <b>语义层配置</b>
    </td>
  </tr>
</table>

---

## 云端部署 (推荐)

无需本地环境，3 分钟完成部署：

### Step 1: 部署后端 (Render)

1. 点击上方 **"1. 部署后端"** 按钮
2. 使用 GitHub 登录 Render
3. 点击 **"Create New Resources"**
4. 等待部署完成 (约 2-3 分钟)
5. 复制生成的 URL，如 `https://querygpt-api-xxxx.onrender.com`

### Step 2: 部署前端 (Vercel)

1. 点击上方 **"2. 部署前端"** 按钮
2. 使用 GitHub 登录 Vercel
3. 在 `NEXT_PUBLIC_API_URL` 填入 Step 1 的后端 URL
4. 点击 **"Deploy"**
5. 部署完成后访问生成的前端 URL

### Step 3: 配置 AI 模型

1. 访问前端 URL，注册账号
2. 进入 **设置 → 模型配置**
3. 添加 OpenAI/Anthropic/DeepSeek 等 API Key
4. 开始使用！

> 💡 **免费额度**: Render 750h/月，Vercel 无限制

---

## 本地开发

需要 Python 3.11+、Node.js 18+

```bash
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# macOS / Linux
./start.sh

# Windows
start.bat
```

访问：
- 前端: http://localhost:3000
- API: http://localhost:8000
- 文档: http://localhost:8000/api/docs

---

## 配置

后端 `apps/api/.env`:
```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/querygpt
JWT_SECRET_KEY=your-secret-key
ENCRYPTION_KEY=your-fernet-key
OPENAI_API_KEY=sk-your-key
```

前端 `apps/web/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 技术栈

**后端**: FastAPI, SQLAlchemy 2.0, Pydantic v2, gptme, LiteLLM

**前端**: Next.js 15, React 19, TypeScript, Tailwind CSS, Zustand

---

## 常见问题

**端口占用**: `lsof -i :8000` 查看，`kill -9 <PID>` 杀掉

**API Key 丢失**: 检查 `.env` 的 `ENCRYPTION_KEY` 是否有效，重新生成后需重新保存 Key

---

## 许可证

MIT License

## 联系

- Issues: https://github.com/MKY508/QueryGPT/issues
- Email: mky369258@gmail.com

---

<div align="center">
  <sub>觉得有用就给个 ⭐ 吧</sub>
</div>
