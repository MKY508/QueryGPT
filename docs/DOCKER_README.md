# QueryGPT Docker 部署指南

## 快速开始

### 1. 使用 Docker 启动脚本（推荐）

```bash
# 首次使用：构建并启动所有服务
./docker-start.sh

# 或者分步操作：
./docker-start.sh build    # 构建镜像
./docker-start.sh up       # 启动服务（包含 MySQL）
./docker-start.sh up-dev   # 启动开发环境（连接外部数据库）
```

### 2. 使用 Docker Compose 直接操作

```bash
# 生产环境（包含 MySQL 数据库）
docker-compose up -d

# 开发环境（连接外部数据库）
docker-compose -f docker-compose.dev.yml up -d

# 查看日志
docker-compose logs -f querygpt

# 停止服务
docker-compose down
```

## 配置说明

### 环境配置

1. 复制 `.env.example` 为 `.env`：
```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，配置必要的参数：
```env
# API 配置
API_KEY=your-api-key-here
API_BASE_URL=https://api.openai.com/v1/

# 数据库配置
DB_HOST=db  # 使用 Docker 内部 MySQL
DB_PORT=3306
DB_PASSWORD=your_password
```

### 数据库连接方式

#### 方式 1：使用内置 MySQL（默认）
```env
DB_HOST=db
DB_PORT=3306
```

#### 方式 2：连接宿主机数据库
```env
DB_HOST=host.docker.internal
DB_PORT=3306
```

#### 方式 3：连接外部数据库
```env
DB_HOST=your-database-host
DB_PORT=3306
```

## Docker 文件说明

### 核心文件

- **Dockerfile**: 多阶段构建的应用镜像
  - 构建阶段：安装依赖
  - 运行阶段：精简的生产镜像
  - 包含健康检查和非 root 用户

- **docker-compose.yml**: 生产环境配置
  - QueryGPT 应用服务
  - MySQL 数据库服务
  - 持久化卷挂载
  - 网络隔离

- **docker-compose.dev.yml**: 开发环境配置
  - 源代码挂载（支持热重载）
  - 连接外部数据库
  - 调试模式

- **.dockerignore**: 优化构建
  - 排除不必要的文件
  - 减小镜像体积

### 辅助文件

- **docker-start.sh**: 便捷管理脚本
- **init.sql**: 数据库初始化脚本（包含中文示例数据）
- **.env.example**: 环境变量模板

## 常用命令

### 服务管理

```bash
# 查看服务状态
./docker-start.sh status

# 查看日志
./docker-start.sh logs

# 重启服务
./docker-start.sh restart

# 进入容器 shell
./docker-start.sh shell
```

### 故障排查

```bash
# 检查容器状态
docker-compose ps

# 查看详细日志
docker-compose logs --tail=100 querygpt

# 检查健康状态
docker inspect querygpt-app | grep -A 5 Health

# 进入容器调试
docker exec -it querygpt-app /bin/bash
```

### 清理操作

```bash
# 停止并删除容器
docker-compose down

# 清理所有（包括卷和镜像）
docker-compose down -v --rmi all

# 或使用脚本
./docker-start.sh clean
```

## 端口映射

- **5007**: QueryGPT Web 界面
- **3307**: MySQL 数据库（映射到 3307 避免冲突）

## 数据持久化

以下目录会被挂载为卷，数据持久保存：

- `./logs`: 应用日志
- `./cache`: 缓存文件
- `./output`: 输出文件
- `./backend/data`: 应用数据
- `db_data`: MySQL 数据（Docker 卷）

## 性能优化

### 镜像优化

- 使用多阶段构建减小镜像体积
- 使用 slim 基础镜像
- 只安装必要的运行时依赖

### 资源限制（可选）

在 `docker-compose.yml` 中添加资源限制：

```yaml
services:
  querygpt:
    # ... 其他配置
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

## 安全建议

1. **不要提交 .env 文件到版本控制**
2. **使用强密码**（数据库密码）
3. **定期更新基础镜像**
4. **在生产环境使用 HTTPS**
5. **限制容器资源使用**
6. **使用非 root 用户运行**（已配置）

## 常见问题

### Q: 端口 5007 被占用
A: 修改 `docker-compose.yml` 中的端口映射：
```yaml
ports:
  - "5008:5007"  # 改为其他端口
```

### Q: 数据库连接失败
A: 检查以下项：
1. 确认 `.env` 中的数据库配置正确
2. 等待数据库完全启动（约 30 秒）
3. 检查防火墙设置

### Q: 容器无法访问外部 API
A: 检查网络配置和代理设置：
```bash
# 测试网络连接
docker exec querygpt-app curl -I https://api.openai.com
```

### Q: 如何升级应用版本
A: 执行以下步骤：
```bash
# 1. 停止服务
./docker-start.sh down

# 2. 拉取最新代码
git pull

# 3. 重新构建
./docker-start.sh build

# 4. 启动服务
./docker-start.sh up
```

## 支持

如有问题，请查看：
- 项目文档：`docs/` 目录
- 配置说明：`docs/CONFIGURATION.md`
- 部署指南：`docs/DEPLOYMENT.md`