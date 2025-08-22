# 多阶段构建 - 构建阶段
FROM python:3.10-slim as builder

# 设置工作目录
WORKDIR /app

# 安装系统依赖和构建工具
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    make \
    libffi-dev \
    libssl-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 创建虚拟环境并安装依赖
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 运行阶段
FROM python:3.10-slim

# 设置工作目录
WORKDIR /app

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 从构建阶段复制虚拟环境
COPY --from=builder /opt/venv /opt/venv

# 设置环境变量
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=5007

# 创建非root用户
RUN useradd -m -u 1000 querygpt && \
    mkdir -p /app/logs /app/cache /app/output /app/backend/data && \
    chown -R querygpt:querygpt /app

# 复制应用代码
COPY --chown=querygpt:querygpt . /app/

# 切换到非root用户
USER querygpt

# 暴露端口
EXPOSE 5007

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5007/api/health || exit 1

# 启动命令
CMD ["python", "backend/app.py"]