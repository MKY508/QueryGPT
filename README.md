<div align="center">

  <img src="docs/images/logo.svg" width="400" alt="QueryGPT">

  <p>自然语言数据库查询助手 - 用中文问数据，AI 自动生成 SQL</p>

  [![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.11+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
  [![Next.js](https://img.shields.io/badge/Next.js-15-black.svg?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)

</div>

## ✨ 功能特性

- 🗣️ **自然语言查询** - 用中文描述需求，AI 自动生成 SQL
- 📊 **数据可视化** - 自动生成图表展示查询结果
- 🧠 **语义层** - 定义业务术语，AI 自动理解转换
- ⚡ **流式响应** - 实时显示 AI 思考过程
- 🔐 **多用户支持** - JWT 认证，数据隔离
- 🎯 **开箱即用** - 内置示例数据库

## 🚀 一键部署

无需本地环境，3 分钟完成部署：

### Step 1: 部署后端

[![Deploy Backend](https://img.shields.io/badge/部署后端-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://render.com/deploy?repo=https://github.com/MKY508/QueryGPT)

1. 点击上方按钮，使用 GitHub 登录 Render
2. 点击 **"Create New Resources"**
3. 等待部署完成 (约 2-3 分钟)
4. 复制生成的 URL，如 `https://querygpt-api-xxxx.onrender.com`

### Step 2: 部署前端

[![Deploy Frontend](https://img.shields.io/badge/部署前端-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMKY508%2FQueryGPT&root-directory=apps/web&env=NEXT_PUBLIC_API_URL&envDescription=填入Step1获取的后端URL&project-name=querygpt-web)

1. 点击上方按钮，使用 GitHub 登录 Vercel
2. 在 `NEXT_PUBLIC_API_URL` 填入 Step 1 的后端 URL
3. 点击 **"Deploy"**
4. 部署完成后访问生成的前端 URL

### Step 3: 开始使用

1. 访问前端 URL，注册账号
2. 进入 **设置 → 模型配置**，添加 AI API Key
3. 开始用自然语言查询数据！

> 💡 **免费额度**: Render 750h/月，Vercel 无限制

---

## 📸 截图

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/chat.png" alt="对话界面"/>
      <b>对话界面</b>
    </td>
    <td align="center" width="50%">
      <img src="docs/images/schema.png" alt="表关系配置"/>
      <b>表关系配置</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/login.png" alt="登录界面"/>
      <b>登录界面</b>
    </td>
    <td align="center">
      <img src="docs/images/semantic.png" alt="语义层配置"/>
      <b>语义层配置</b>
    </td>
  </tr>
</table>

---

## 💻 本地开发

需要 Python 3.11+、Node.js 18+

```bash
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# macOS / Linux
./start.sh

# Windows
start.bat
```

访问：前端 http://localhost:3000 | API http://localhost:8000/api/docs

<details>
<summary>📝 环境变量配置</summary>

后端 `apps/api/.env`:
```env
DATABASE_URL=sqlite+aiosqlite:///./data/querygpt.db
JWT_SECRET_KEY=your-secret-key
ENCRYPTION_KEY=your-fernet-key
```

前端 `apps/web/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

</details>

---

## 🛠️ 技术栈

| 后端 | 前端 |
|------|------|
| FastAPI | Next.js 15 |
| SQLAlchemy 2.0 | React 19 |
| gptme + LiteLLM | TypeScript |
| Pydantic v2 | Tailwind CSS |

---

## 📄 许可证

MIT License

---

<div align="center">

  ⭐ 觉得有用就给个 Star 吧

  > 📢 需要旧版单体架构？请切换到 [v1 分支](https://github.com/MKY508/QueryGPT/tree/v1)

</div>
