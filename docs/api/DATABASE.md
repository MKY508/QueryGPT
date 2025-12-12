# QueryGPT v2 数据库设计文档

## 概述

QueryGPT v2 使用 PostgreSQL 作为主数据库，存储用户数据、对话历史、配置等信息。

## 数据库配置

```python
# 连接字符串格式
DATABASE_URL = "postgresql+asyncpg://user:password@localhost:5432/querygpt"
```

## 表结构

### 1. users - 用户表

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    avatar_url VARCHAR(500),
    role VARCHAR(20) DEFAULT 'user',  -- user, admin
    is_active BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_is_active ON users(is_active);
```

**字段说明**

| 字段 | 类型 | 描述 |
|------|------|------|
| id | UUID | 主键 |
| email | VARCHAR(255) | 邮箱，唯一 |
| hashed_password | VARCHAR(255) | bcrypt 哈希密码 |
| display_name | VARCHAR(100) | 显示名称 |
| avatar_url | VARCHAR(500) | 头像 URL |
| role | VARCHAR(20) | 角色：user/admin |
| is_active | BOOLEAN | 是否激活 |
| settings | JSONB | 用户设置 |

### 2. connections - 数据库连接表

```sql
CREATE TABLE connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    driver VARCHAR(20) NOT NULL,  -- mysql, postgresql, sqlite
    host VARCHAR(255),
    port INTEGER,
    username VARCHAR(100),
    password_encrypted TEXT,  -- AES-256 加密
    database_name VARCHAR(100),
    extra_options JSONB DEFAULT '{}',
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_connections_user_id ON connections(user_id);
CREATE INDEX idx_connections_is_default ON connections(user_id, is_default);
```

**字段说明**

| 字段 | 类型 | 描述 |
|------|------|------|
| driver | VARCHAR(20) | 数据库类型：mysql/postgresql/sqlite |
| password_encrypted | TEXT | AES-256 加密的密码 |
| extra_options | JSONB | 额外连接选项（SSL、charset 等） |

### 3. models - 模型配置表

```sql
CREATE TABLE models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,  -- openai, anthropic, ollama, etc.
    model_id VARCHAR(100) NOT NULL,  -- gpt-4o, claude-3-5-sonnet, etc.
    base_url VARCHAR(500),
    api_key_encrypted TEXT,  -- AES-256 加密
    extra_options JSONB DEFAULT '{}',
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_models_user_id ON models(user_id);
CREATE INDEX idx_models_is_default ON models(user_id, is_default);
```

### 4. conversations - 对话表

```sql
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    model_id UUID REFERENCES models(id) ON DELETE SET NULL,
    title VARCHAR(200),
    status VARCHAR(20) DEFAULT 'active',  -- active, completed, error
    is_favorite BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_created_at ON conversations(user_id, created_at DESC);
CREATE INDEX idx_conversations_is_favorite ON conversations(user_id, is_favorite);
CREATE INDEX idx_conversations_title_search ON conversations USING gin(to_tsvector('simple', title));
```

### 5. messages - 消息表

```sql
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,  -- user, assistant, system
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(conversation_id, created_at);
```

**metadata 结构（assistant 消息）**

```json
{
  "sql": "SELECT * FROM orders WHERE ...",
  "execution_time": 0.5,
  "rows_count": 100,
  "steps": [
    {"stage": "analyzing", "message": "分析查询意图"},
    {"stage": "generating_sql", "message": "生成 SQL"},
    {"stage": "executing", "message": "执行查询"}
  ],
  "visualization": {
    "type": "bar",
    "data": { ... }
  },
  "error": null
}
```

### 6. prompts - Prompt 配置表

```sql
CREATE TABLE prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL 表示系统默认
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,  -- system, routing, analysis, qa, etc.
    content_zh TEXT,
    content_en TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_prompts_user_id ON prompts(user_id);
CREATE INDEX idx_prompts_type ON prompts(type);
CREATE UNIQUE INDEX idx_prompts_user_type ON prompts(user_id, type) WHERE user_id IS NOT NULL;
```

### 7. refresh_tokens - 刷新令牌表

```sql
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,  -- SHA-256 哈希
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
```

### 8. audit_logs - 审计日志表（可选）

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,  -- login, query, config_change, etc.
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

## 迁移脚本

使用 Alembic 管理数据库迁移：

```bash
# 创建迁移
alembic revision --autogenerate -m "initial tables"

# 执行迁移
alembic upgrade head

# 回滚
alembic downgrade -1
```

## 数据加密

### API Key / Password 加密

使用 AES-256-GCM 加密敏感数据：

```python
from cryptography.fernet import Fernet

# 生成密钥（存储在环境变量）
ENCRYPTION_KEY = Fernet.generate_key()

def encrypt(plaintext: str) -> str:
    f = Fernet(ENCRYPTION_KEY)
    return f.encrypt(plaintext.encode()).decode()

def decrypt(ciphertext: str) -> str:
    f = Fernet(ENCRYPTION_KEY)
    return f.decrypt(ciphertext.encode()).decode()
```

## 索引策略

| 表 | 索引 | 用途 |
|---|------|------|
| users | email | 登录查询 |
| conversations | (user_id, created_at DESC) | 历史列表 |
| conversations | title (GIN) | 全文搜索 |
| messages | (conversation_id, created_at) | 消息列表 |

## 数据保留策略

| 数据类型 | 保留期限 | 清理方式 |
|---------|---------|---------|
| 对话历史 | 永久（用户可删除） | 用户手动删除 |
| 审计日志 | 90 天 | 定时任务清理 |
| 刷新令牌 | 过期后 7 天 | 定时任务清理 |

## 备份策略

```bash
# 每日备份
pg_dump -Fc querygpt > backup_$(date +%Y%m%d).dump

# 恢复
pg_restore -d querygpt backup_20240101.dump
```
