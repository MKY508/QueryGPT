# QueryGPT 配置说明

## 配置文件结构

项目使用多层配置管理，按优先级从高到低：

1. 环境变量 (`.env`)
2. 配置文件 (`config/config.json`)
3. 默认配置（代码内置）

## 环境变量配置 (.env)

### 必需配置

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
```

### 可选配置

```env
# 系统配置
DEBUG=False                    # 调试模式
LOG_LEVEL=INFO                # 日志级别: DEBUG, INFO, WARNING, ERROR
SECRET_KEY=your-secret-key    # Flask密钥
PORT=5000                     # 服务端口

# 性能配置
MAX_WORKERS=4                 # 最大工作进程数
CACHE_TTL=3600               # 缓存过期时间（秒）
REQUEST_TIMEOUT=120          # 请求超时时间（秒）

# 安全配置
ALLOWED_ORIGINS=http://localhost:*,http://127.0.0.1:*
MAX_REQUEST_SIZE=10485760    # 最大请求大小（10MB）
RATE_LIMIT=100              # 每分钟请求限制
```

## JSON配置文件 (config/config.json)

```json
{
  "app": {
    "name": "QueryGPT",
    "version": "1.3",
    "debug": false,
    "timezone": "Asia/Shanghai"
  },
  
  "database": {
    "connection_pool": {
      "min_size": 2,
      "max_size": 10,
      "timeout": 30,
      "retry_attempts": 3
    },
    "query": {
      "max_rows": 10000,
      "timeout": 120,
      "cache_enabled": true
    }
  },
  
  "api": {
    "models": [
      {
        "id": "gpt-4.1",
        "name": "GPT-4.1",
        "enabled": true,
        "max_tokens": 4096,
        "temperature": 0.1
      },
      {
        "id": "claude-sonnet-4",
        "name": "Claude Sonnet 4",
        "enabled": true,
        "max_tokens": 4096,
        "temperature": 0.1
      },
      {
        "id": "deepseek-r1",
        "name": "DeepSeek R1",
        "enabled": false,
        "max_tokens": 8192,
        "temperature": 0.2
      }
    ],
    "default_model": "gpt-4.1",
    "retry": {
      "max_attempts": 3,
      "backoff_factor": 2,
      "max_wait": 30
    }
  },
  
  "interpreter": {
    "auto_run": true,
    "safe_mode": "off",
    "max_context_rounds": 3,
    "temperature": 0.1,
    "timeout": 120,
    "memory_limit": "1GB"
  },
  
  "frontend": {
    "port": 5000,
    "host": "0.0.0.0",
    "static_folder": "frontend/static",
    "template_folder": "frontend/templates",
    "max_upload_size": 10485760,
    "session": {
      "timeout": 3600,
      "cookie_secure": false,
      "cookie_httponly": true
    }
  },
  
  "logging": {
    "level": "INFO",
    "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    "file": {
      "enabled": true,
      "path": "logs/app.log",
      "max_size": "10MB",
      "backup_count": 5
    },
    "console": {
      "enabled": true,
      "colorize": true
    }
  },
  
  "cache": {
    "enabled": true,
    "type": "memory",
    "ttl": 3600,
    "max_size": 100,
    "eviction_policy": "LRU"
  },
  
  "security": {
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:*", "http://127.0.0.1:*"],
      "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      "allow_credentials": true
    },
    "sql_injection": {
      "enabled": true,
      "allowed_commands": ["SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"]
    },
    "rate_limiting": {
      "enabled": false,
      "requests_per_minute": 100,
      "burst": 20
    }
  },
  
  "history": {
    "database": "backend/data/history.db",
    "auto_save": true,
    "max_conversations": 1000,
    "cleanup": {
      "enabled": true,
      "retention_days": 90,
      "run_at": "02:00"
    }
  },
  
  "visualization": {
    "output_dir": "output",
    "format": "html",
    "plotly": {
      "theme": "plotly_dark",
      "width": 1000,
      "height": 600
    },
    "cache_charts": true,
    "cleanup_after_days": 7
  }
}
```

## 配置加载顺序

1. **默认值**: 代码中的内置默认配置
2. **JSON文件**: 从 `config/config.json` 加载
3. **环境变量**: 从 `.env` 文件加载
4. **系统环境**: 系统环境变量（最高优先级）

```python
# 配置加载示例
from backend.config_loader import ConfigLoader

config = ConfigLoader()

# 获取API配置
api_config = config.get_api_config()
# {
#   'base_url': 'http://localhost:11434/v1',
#   'api_key': 'your_api_key_here',
#   'model': 'gpt-4.1'
# }

# 获取数据库配置
db_config = config.get_database_config()
# {
#   'host': 'localhost',
#   'port': 19130,
#   'user': 'your_db_user',
#   'password': '...'
# }
```

## 模型配置

### 支持的模型

| 模型ID | 显示名称 | 说明 | 推荐场景 |
|--------|----------|------|----------|
| gpt-4.1 | GPT-4.1 | 最新GPT-4模型 | 复杂查询、数据分析 |
| claude-sonnet-4 | Claude Sonnet 4 | Claude高性能模型 | 长文本处理 |
| deepseek-r1 | DeepSeek R1 | 深度求索模型 | 代码生成 |
| qwen-flagship | 通义千问 | 阿里云模型 | 中文理解 |

### 添加新模型

1. 编辑 `config/config.json`:
```json
{
  "api": {
    "models": [
      {
        "id": "new-model-id",
        "name": "显示名称",
        "enabled": true,
        "max_tokens": 4096,
        "temperature": 0.1,
        "api_base": "https://custom-api.com/v1",  // 可选
        "api_key": "custom-key"  // 可选
      }
    ]
  }
}
```

2. 重启服务使配置生效

## 数据库配置

### 连接池配置

```json
{
  "database": {
    "connection_pool": {
      "min_size": 2,      // 最小连接数
      "max_size": 10,     // 最大连接数
      "timeout": 30,      // 连接超时（秒）
      "idle_time": 300,   // 空闲连接回收时间（秒）
      "retry_attempts": 3 // 重试次数
    }
  }
}
```

### 多数据库支持

```env
# 主数据库
DB_HOST=localhost
DB_PORT=19130
DB_USER=your_db_user
DB_PASSWORD=password1

# 备用数据库（可选）
DB_BACKUP_HOST=10.91.11.28
DB_BACKUP_PORT=19130
DB_BACKUP_USER=your_db_user
DB_BACKUP_PASSWORD=password2
```

## 日志配置

### 日志级别

- `DEBUG`: 详细调试信息
- `INFO`: 一般信息
- `WARNING`: 警告信息
- `ERROR`: 错误信息
- `CRITICAL`: 严重错误

### 日志轮转

```json
{
  "logging": {
    "file": {
      "enabled": true,
      "path": "logs/app.log",
      "max_size": "10MB",     // 单文件最大大小
      "backup_count": 5,      // 保留文件数量
      "rotation": "daily"     // 轮转策略: daily, size, time
    }
  }
}
```

## 缓存配置

### 内存缓存

```json
{
  "cache": {
    "type": "memory",
    "max_size": 100,        // 最大缓存条目
    "ttl": 3600,           // 默认过期时间（秒）
    "eviction_policy": "LRU" // 淘汰策略: LRU, LFU, FIFO
  }
}
```

### Redis缓存（可选）

```json
{
  "cache": {
    "type": "redis",
    "host": "localhost",
    "port": 6379,
    "db": 0,
    "password": null,
    "ttl": 3600,
    "key_prefix": "data_platform:"
  }
}
```

## 安全配置

### CORS配置

```json
{
  "security": {
    "cors": {
      "enabled": true,
      "origins": [
        "http://localhost:*",
        "http://127.0.0.1:*",
        "https://your-domain.com"
      ],
      "methods": ["GET", "POST", "PUT", "DELETE"],
      "headers": ["Content-Type", "Authorization"],
      "credentials": true
    }
  }
}
```

### SQL注入防护

```json
{
  "security": {
    "sql_injection": {
      "enabled": true,
      "allowed_commands": [
        "SELECT", "SHOW", "DESCRIBE", 
        "DESC", "EXPLAIN"
      ],
      "blocked_keywords": [
        "DROP", "DELETE", "INSERT", 
        "UPDATE", "ALTER", "CREATE"
      ],
      "max_query_length": 10000
    }
  }
}
```

## 性能优化配置

### 查询优化

```json
{
  "performance": {
    "query": {
      "cache_enabled": true,
      "cache_ttl": 3600,
      "max_rows": 10000,
      "timeout": 120,
      "parallel_execution": true,
      "batch_size": 1000
    }
  }
}
```

### 响应压缩

```json
{
  "performance": {
    "compression": {
      "enabled": true,
      "level": 6,           // 1-9, 6为默认
      "min_size": 1024,    // 最小压缩大小（字节）
      "types": [
        "text/html",
        "text/css",
        "application/json",
        "application/javascript"
      ]
    }
  }
}
```

## 环境特定配置

### 开发环境

```env
# .env.development
DEBUG=True
LOG_LEVEL=DEBUG
API_BASE_URL=http://localhost:8000/v1
CACHE_ENABLED=False
```

### 测试环境

```env
# .env.test
DEBUG=False
LOG_LEVEL=INFO
API_BASE_URL=https://test-api.example.com/v1
CACHE_ENABLED=True
RATE_LIMIT=50
```

### 生产环境

```env
# .env.production
DEBUG=False
LOG_LEVEL=WARNING
API_BASE_URL=https://api.example.com/v1
CACHE_ENABLED=True
RATE_LIMIT=100
SSL_ENABLED=True
```

## 配置验证

启动时自动验证配置：

```python
# backend/config_validator.py
def validate_config():
    """验证配置完整性"""
    required = [
        'API_BASE_URL',
        'API_KEY',
        'DB_HOST',
        'DB_PORT',
        'DB_USER',
        'DB_PASSWORD'
    ]
    
    missing = []
    for key in required:
        if not os.getenv(key):
            missing.append(key)
    
    if missing:
        raise ValueError(f"缺少必需配置: {', '.join(missing)}")
```

## 配置最佳实践

1. **敏感信息**: 永远不要将密码、API密钥提交到版本控制
2. **环境分离**: 使用不同的配置文件区分环境
3. **默认值**: 为所有配置提供合理的默认值
4. **验证**: 启动时验证所有必需配置
5. **文档**: 记录所有配置项的用途和取值范围
6. **备份**: 定期备份生产环境配置

## 故障排查

### 配置未生效

1. 检查配置文件路径是否正确
2. 验证JSON格式是否有效
3. 确认环境变量已正确设置
4. 重启服务使配置生效

### 配置冲突

优先级：系统环境变量 > .env文件 > config.json > 默认值

### 查看当前配置

```bash
# 通过API查看
curl http://localhost:5000/api/config

# 通过日志查看
grep "Configuration loaded" logs/app.log
```