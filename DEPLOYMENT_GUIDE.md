# QueryGPT 完整部署指南

## 📋 目录

1. [项目概述](#项目概述)
2. [快速部署](#快速部署)
3. [源码部署](#源码部署)
4. [桌面应用部署](#桌面应用部署)
5. [服务器部署](#服务器部署)
6. [配置说明](#配置说明)
7. [故障排除](#故障排除)
8. [性能优化](#性能优化)

---

## 项目概述

QueryGPT 是一个基于 AI 的智能数据分析平台，通过自然语言交互实现数据库查询和可视化。

### 核心特性
- 🗣️ **自然语言查询**：支持中英文自然语言数据库查询
- 🤖 **AI 驱动**：基于 OpenInterpreter 0.4.3 的智能解析
- 📊 **自动可视化**：自动生成专业的数据图表
- 🎨 **现代化 UI**：全新设计系统，支持深色模式
- 📦 **一键部署**：提供打包好的桌面应用

### 技术栈
- **后端**：Python 3.10.x + Flask + OpenInterpreter
- **前端**：HTML5 + CSS3 + JavaScript (现代化设计系统)
- **数据库**：MySQL / PostgreSQL / SQLite / Apache Doris
- **打包**：PyInstaller + DMG (macOS) / EXE (Windows)

---

## 快速部署

### 方法一：使用打包好的应用（推荐）

#### macOS 用户

1. **下载应用**
   ```bash
   # 已生成的 DMG 文件位于：
   QueryGPT-1.0.0.dmg (115MB)
   ```

2. **安装应用**
   - 双击 `QueryGPT-1.0.0.dmg`
   - 将 QueryGPT 拖动到 Applications 文件夹
   - 首次运行时，右键点击选择"打开"（绕过 Gatekeeper）

3. **配置数据库**
   - 应用会在 `~/Library/Application Support/QueryGPT/` 创建配置文件
   - 编辑 `.env` 文件添加数据库连接信息

#### Windows 用户

1. **运行打包脚本**
   ```cmd
   build_windows.bat
   ```

2. **安装应用**
   - 运行 `dist/启动QueryGPT.bat`
   - 系统会自动打开浏览器

### 方法二：Docker 部署（开发中）

```bash
# 即将支持
docker pull querygpt/querygpt:latest
docker run -p 5000:5000 querygpt/querygpt
```

---

## 源码部署

### 环境要求

- **Python**: 3.10.x（必须，OpenInterpreter 0.4.3 依赖）
- **Node.js**: v18+ （可选，用于前端开发）
- **数据库**: MySQL 5.7+ / PostgreSQL 12+ / SQLite 3

### 步骤说明

#### 1. 克隆项目

```bash
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT
```

#### 2. 创建虚拟环境

```bash
# macOS/Linux
python3.10 -m venv venv_py310
source venv_py310/bin/activate

# Windows
python -m venv venv_py310
venv_py310\Scripts\activate
```

#### 3. 安装依赖

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

#### 4. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_user
DB_PASSWORD=your_password
DB_DATABASE=your_database

# API 配置（如果使用外部 LLM）
API_BASE_URL=https://api.openai.com/v1
API_KEY=your_api_key
DEFAULT_MODEL=gpt-4

# 应用配置
FLASK_PORT=5000
DEBUG_MODE=false
LOG_LEVEL=INFO
```

#### 5. 初始化目录

```bash
mkdir -p output cache logs backend/data
```

#### 6. 启动应用

```bash
# 使用启动脚本
./start.sh

# 或直接运行
python backend/app.py
```

#### 7. 访问应用

打开浏览器访问：http://localhost:5000

---

## 桌面应用部署

### 构建流程

#### 通用构建（推荐）

```bash
# 使用统一构建脚本
python build.py
```

#### macOS 特定构建

```bash
# 确保安装了打包工具
pip install pyinstaller pillow dmgbuild

# 运行构建脚本
./build_macos.sh

# 输出文件
# - dist/QueryGPT.app (应用程序包)
# - QueryGPT-1.0.0.dmg (安装镜像)
```

#### Windows 特定构建

```cmd
:: 运行构建脚本
build_windows.bat

:: 输出文件
:: - dist\QueryGPT.exe (可执行文件)
:: - dist\启动QueryGPT.bat (启动脚本)
```

### 签名和公证（可选）

#### macOS 代码签名

```bash
# 需要 Apple Developer ID
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Your Name" \
  dist/QueryGPT.app

# 公证应用
xcrun altool --notarize-app \
  --primary-bundle-id "com.yourname.querygpt" \
  --username "your@email.com" \
  --password "@keychain:AC_PASSWORD" \
  --file QueryGPT-1.0.0.dmg
```

---

## 服务器部署

### 生产环境配置

#### 1. 使用 Gunicorn

```bash
# 安装 Gunicorn
pip install gunicorn

# 启动服务
gunicorn -w 4 -b 0.0.0.0:5000 backend.app:app
```

#### 2. 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name querygpt.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static {
        alias /path/to/QueryGPT/frontend/static;
        expires 30d;
    }
}
```

#### 3. 使用 Systemd 服务

创建 `/etc/systemd/system/querygpt.service`：

```ini
[Unit]
Description=QueryGPT Data Analysis Platform
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/QueryGPT
Environment="PATH=/opt/QueryGPT/venv_py310/bin"
ExecStart=/opt/QueryGPT/venv_py310/bin/gunicorn -w 4 -b 127.0.0.1:5000 backend.app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable querygpt
sudo systemctl start querygpt
```

---

## 配置说明

### 数据库配置

#### MySQL/MariaDB

```sql
-- 创建数据库
CREATE DATABASE querygpt CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建只读用户
CREATE USER 'querygpt_ro'@'%' IDENTIFIED BY 'secure_password';
GRANT SELECT ON querygpt.* TO 'querygpt_ro'@'%';
FLUSH PRIVILEGES;
```

#### PostgreSQL

```sql
-- 创建数据库
CREATE DATABASE querygpt WITH ENCODING 'UTF8';

-- 创建只读用户
CREATE USER querygpt_ro WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE querygpt TO querygpt_ro;
GRANT USAGE ON SCHEMA public TO querygpt_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO querygpt_ro;
```

### 安全配置

#### 1. 环境变量加密

```python
# 使用 python-dotenv 和加密
from cryptography.fernet import Fernet

# 生成密钥
key = Fernet.generate_key()

# 加密敏感信息
cipher = Fernet(key)
encrypted_password = cipher.encrypt(b"your_password")
```

#### 2. HTTPS 配置

```python
# Flask HTTPS 配置
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
```

#### 3. 防火墙规则

```bash
# 只允许特定端口
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 故障排除

### 常见问题

#### 1. 端口被占用

```bash
# macOS - AirPlay 占用 5000 端口
# 解决方案：系统会自动尝试 5001-5010

# 查找占用端口的进程
lsof -i :5000

# 修改配置使用其他端口
export FLASK_PORT=5001
```

#### 2. OpenInterpreter 版本问题

```bash
# 必须使用 Python 3.10.x
# 检查版本
python --version

# 使用 pyenv 管理版本
pyenv install 3.10.11
pyenv local 3.10.11
```

#### 3. 数据库连接失败

```python
# 测试连接
python -c "
import pymysql
conn = pymysql.connect(
    host='localhost',
    user='your_user',
    password='your_password',
    database='your_database'
)
print('连接成功')
conn.close()
"
```

#### 4. 依赖安装失败

```bash
# 清理缓存
pip cache purge

# 使用国内镜像
pip install -r requirements.txt -i https://pypi.douban.com/simple/

# 分步安装
pip install open-interpreter==0.4.3
pip install flask flask-cors
pip install pandas plotly
```

### 日志查看

```bash
# 应用日志
tail -f logs/app.log

# 系统日志 (macOS)
tail -f ~/Library/Logs/QueryGPT/app.log

# 调试模式
DEBUG_MODE=true python backend/app.py
```

---

## 性能优化

### 1. 数据库优化

```sql
-- 添加索引
ALTER TABLE your_table ADD INDEX idx_date (date_column);
ALTER TABLE your_table ADD INDEX idx_user (user_id);

-- 分析表
ANALYZE TABLE your_table;
```

### 2. 缓存配置

```python
# Redis 缓存（可选）
CACHE_TYPE = 'redis'
CACHE_REDIS_HOST = 'localhost'
CACHE_REDIS_PORT = 6379
CACHE_DEFAULT_TIMEOUT = 300
```

### 3. 并发优化

```python
# 连接池配置
DB_POOL_SIZE = 10
DB_MAX_OVERFLOW = 20
DB_POOL_TIMEOUT = 30
```

### 4. 前端优化

- 启用 Gzip 压缩
- 使用 CDN 加速静态资源
- 实施浏览器缓存策略
- 延迟加载非关键资源

---

## 监控和维护

### 健康检查

```bash
# API 健康检查
curl http://localhost:5000/api/health

# 数据库连接测试
curl http://localhost:5000/api/test_connection
```

### 备份策略

```bash
# 数据库备份
mysqldump -u root -p querygpt > backup_$(date +%Y%m%d).sql

# 配置文件备份
tar -czf config_backup_$(date +%Y%m%d).tar.gz .env *.json
```

### 更新流程

```bash
# 拉取最新代码
git pull origin main

# 更新依赖
pip install -r requirements.txt --upgrade

# 重启服务
sudo systemctl restart querygpt
```

---

## 支持和贡献

### 获取帮助

- 📖 [文档](https://github.com/MKY508/QueryGPT/wiki)
- 🐛 [报告问题](https://github.com/MKY508/QueryGPT/issues)
- 💬 [讨论区](https://github.com/MKY508/QueryGPT/discussions)

### 贡献代码

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

---

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

**作者**: Mao Kaiyue (@MKY508)  
**创建时间**: 2025年8月  
**版本**: 1.0.0