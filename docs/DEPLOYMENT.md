# 部署指南

## 系统要求

### 硬件要求
- **CPU**: 2核心以上
- **内存**: 4GB以上（推荐8GB）
- **磁盘**: 10GB可用空间
- **网络**: 稳定的互联网连接

### 软件要求
- **操作系统**: Linux/macOS/Windows
- **Python**: 3.10.x（必须）
- **数据库**: Apache Doris或MySQL兼容数据库
- **浏览器**: Chrome/Firefox/Safari最新版本

> Windows 提示：请在 WSL (Windows Subsystem for Linux) 中运行本项目；不要在 PowerShell/CMD 中直接执行脚本。

## 部署方式

### 1. 本地开发部署

#### 1.1 克隆代码
```bash
git clone <repository-url>
cd QueryGPT
```

#### 1.2 环境配置
```bash
# 创建Python虚拟环境
python3.10 -m venv venv_py310
source venv_py310/bin/activate  # Linux/macOS
# 或
venv_py310\Scripts\activate  # Windows

# 安装依赖
pip install -r requirements.txt
```

#### 1.3 配置文件
创建 `.env` 文件：
```env
# API配置
API_BASE_URL=http://localhost:11434/v1
API_KEY=your_api_key_here
DEFAULT_MODEL=gpt-4.1

# 数据库配置
DB_HOST=localhost
DB_PORT=19130
DB_USER=your_db_user
DB_PASSWORD=your_password
DB_DATABASE=center_dws

# 系统配置
DEBUG=False
LOG_LEVEL=INFO
SECRET_KEY=your-secret-key-here
```

#### 1.4 启动服务
```bash
# 使用启动脚本
./start.sh

# 或直接启动
cd backend
python app.py
```

### 2. 生产环境部署

#### 2.1 使用Gunicorn

安装Gunicorn：
```bash
pip install gunicorn
```

创建 `gunicorn_config.py`：
```python
bind = "0.0.0.0:5000"
workers = 4
worker_class = "sync"
worker_connections = 1000
max_requests = 1000
max_requests_jitter = 50
timeout = 120
keepalive = 2
preload_app = True
accesslog = "logs/access.log"
errorlog = "logs/error.log"
loglevel = "info"
```

启动服务：
```bash
gunicorn -c gunicorn_config.py backend.app:app
```

<!-- Docker/Compose 部署方案当前不维护，后续如启用会补充到此处。 -->

### 3. 云平台部署

#### 3.1 AWS EC2

1. **创建EC2实例**
   - 选择Amazon Linux 2或Ubuntu 20.04
   - 实例类型：t3.medium或更高
   - 安全组：开放5000端口

2. **部署步骤**
```bash
# 连接到EC2
ssh -i your-key.pem ec2-user@your-instance-ip

# 安装Python 3.10
sudo yum install python310 python310-pip -y

# 克隆代码并部署
git clone <repository-url>
cd QueryGPT
./start.sh
```

3. **配置负载均衡器（可选）**
   - 创建Application Load Balancer
   - 配置目标组指向EC2实例的5000端口
   - 设置健康检查路径为 `/api/health`

#### 3.2 阿里云ECS

1. **创建ECS实例**
   - 选择CentOS 7.9或Ubuntu 20.04
   - 实例规格：2核4G以上
   - 安全组：添加5000端口入站规则

2. **使用云效部署**
```yaml
# .yunxiao.yml
version: 1.0
stages:
  - name: build
    steps:
      - run: |
          python3.10 -m venv venv
          source venv/bin/activate
          pip install -r requirements.txt
  
  - name: deploy
    steps:
      - run: |
          pm2 start backend/app.py --interpreter python3.10
```

### 4. Nginx反向代理配置

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # 重定向到HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL证书
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    
    # SSL优化
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # 反向代理
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket支持（如需要）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 超时设置
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
    
    # 静态文件
    location /static {
        alias /app/frontend/static;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # 输出文件
    location /output {
        alias /app/output;
        autoindex on;
    }
}
```

### 5. 系统监控

#### 5.1 使用PM2管理进程

```bash
# 安装PM2
npm install -g pm2

# 创建PM2配置
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'data-platform',
    script: 'backend/app.py',
    interpreter: 'python3.10',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      PORT: 5000,
      NODE_ENV: 'production'
    },
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    log_file: 'logs/pm2-combined.log',
    time: true
  }]
};
EOF

# 启动应用
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

#### 5.2 健康检查脚本

```bash
#!/bin/bash
# health_check.sh

URL="http://localhost:5000/api/health"
MAX_RETRIES=3
RETRY_DELAY=5

for i in $(seq 1 $MAX_RETRIES); do
    response=$(curl -s -o /dev/null -w "%{http_code}" $URL)
    if [ $response -eq 200 ]; then
        echo "Health check passed"
        exit 0
    fi
    echo "Health check failed (attempt $i/$MAX_RETRIES)"
    sleep $RETRY_DELAY
done

echo "Health check failed after $MAX_RETRIES attempts"
# 发送告警或重启服务
pm2 restart data-platform
exit 1
```

### 6. 备份与恢复

#### 6.1 数据备份脚本

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backup/data-platform"
DATE=$(date +%Y%m%d_%H%M%S)

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份数据库
sqlite3 backend/data/history.db ".backup $BACKUP_DIR/history_$DATE.db"

# 备份配置文件
cp .env $BACKUP_DIR/env_$DATE
cp -r config $BACKUP_DIR/config_$DATE

# 备份输出文件（可选）
tar -czf $BACKUP_DIR/output_$DATE.tar.gz output/

# 清理30天前的备份
find $BACKUP_DIR -type f -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR"
```

#### 6.2 恢复脚本

```bash
#!/bin/bash
# restore.sh

BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: ./restore.sh <backup_file>"
    exit 1
fi

# 恢复数据库
cp $BACKUP_FILE backend/data/history.db

echo "Restore completed from: $BACKUP_FILE"
```

### 7. 性能优化

#### 7.1 系统优化

```bash
# 增加文件描述符限制
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# 优化TCP参数
cat >> /etc/sysctl.conf << EOF
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
EOF

sysctl -p
```

#### 7.2 应用优化

- 启用Redis缓存
- 使用CDN加速静态资源
- 开启Gzip压缩
- 实施数据库连接池

### 8. 故障排查

#### 常见问题

1. **端口被占用**
```bash
# 查找占用端口的进程
lsof -i :5000
# 杀死进程
kill -9 <PID>
```

2. **数据库连接失败**
- 检查网络连接
- 验证数据库配置
- 确认防火墙规则

3. **内存不足**
```bash
# 查看内存使用
free -h
# 清理缓存
sync && echo 3 > /proc/sys/vm/drop_caches
```

#### 日志位置

- 应用日志：`logs/app.log`
- 访问日志：`logs/access.log`
- 错误日志：`logs/error.log`
- PM2日志：`logs/pm2-*.log`

### 9. 安全建议

1. **使用HTTPS**: 配置SSL证书
2. **限制访问**: 使用防火墙规则
3. **定期更新**: 及时更新依赖包
4. **密码管理**: 使用强密码和密钥管理服务
5. **日志审计**: 定期检查异常访问
6. **备份策略**: 实施3-2-1备份策略

## 部署检查清单

- [ ] Python 3.10.x已安装
- [ ] 所有依赖包已安装
- [ ] .env配置文件已创建
- [ ] 数据库连接已测试
- [ ] 端口5000可访问
- [ ] 日志目录有写权限
- [ ] 备份策略已实施
- [ ] 监控告警已配置
- [ ] SSL证书已配置（生产环境）
- [ ] 防火墙规则已设置
