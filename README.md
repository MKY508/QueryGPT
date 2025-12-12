<div align="center">

  <img src="docs/images/logo.png" width="400" alt="QueryGPT">

  <p>自然语言数据库查询助手 - v2 重构版</p>

  [![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.11+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
  [![Next.js](https://img.shields.io/badge/Next.js-15-black.svg?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)

  > 📢 **需要旧版？** 请切换到 [v1 分支](https://github.com/MKY508/QueryGPT/tree/v1)

</div>

---

## v2 架构升级

v2 是重构的新版本，前后端分离架构：

| 对比 | v1 | v2 |
|------|-----|-----|
| 后端 | Flask | FastAPI |
| 前端 | Jinja2 | Next.js 15 |
| AI 引擎 | OpenInterpreter | gptme |
| 认证 | 无 | JWT |
| 响应 | 同步 | SSE 流式 |

- 整合启动端为start脚本，上手难度降低
- 增强账号JWT权限管理，不同账号数据库权限使用不同，留出api接口后期可能添加云端
- 密码和api密钥sha256加密，符合企业级应用安全
- 重构降低代码量到2000行+，后端Fastapi异步运行问答反应速度更快
- 数据库嵌套取代prompt工程，寻库速度更快
- gptme核心agengt取代老旧openinterpreter，执行速度更快，容器更小，兼容更高版本python
- 最新react前端，报错处理更明显

---

## 功能

- 自然语言查询数据库，支持中文业务术语
- SSE 流式响应，实时显示思考过程，多轮问答
- Plotly嵌入前端数据可视化
- 多用户、多模型、多数据库支持
- 内置 SQLite 示例数据库，开箱即用

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
      <img src="docs/images/settings.png" width="100%" alt="设置界面"/>
      <b>设置</b>
    </td>
  </tr>
</table>

---

## 快速开始

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

## 配置（用于批量企业用户账号设置，单用户前端可直接设置）

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
>因为端口占用问题在这个版本不明显，故取消端口自动选择功能
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
