# 常用命令

## 后端开发

```bash
# 进入后端目录
cd apps/api

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖 (开发模式)
pip install -e ".[dev]"

# 运行开发服务器
uvicorn app.main:app --reload --port 8000

# 运行测试
pytest tests/ -v

# 运行特定测试
pytest tests/test_gptme_engine.py -v

# 代码格式化
ruff check . --fix
ruff format .

# 数据库迁移
alembic revision --autogenerate -m "description"
alembic upgrade head
```

## 前端开发

```bash
# 进入前端目录
cd apps/web

# 安装依赖
npm install

# 运行开发服务器
npm run dev

# 构建
npm run build

# 运行测试
npm test

# 代码检查
npm run lint
```

## Docker 部署

```bash
# 构建和启动所有服务
docker-compose up -d

# 仅启动 API
docker-compose up -d api

# 仅启动前端
docker-compose up -d web
```

## Git 工作流

```bash
# 创建功能分支
git checkout -b feature/your-feature

# 提交更改
git add .
git commit -m "feat: description"

# 推送分支
git push -u origin feature/your-feature
```

## 环境变量

后端需要以下环境变量 (在 .env 文件中):
- `DATABASE_URL`: PostgreSQL 连接字符串
- `SECRET_KEY`: JWT 密钥
- `OPENAI_API_KEY`: OpenAI API 密钥
- `GPTME_MODEL`: 默认模型 (如 gpt-4o-mini)
