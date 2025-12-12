# QueryGPT v2 API 文档

## 基础信息

- **Base URL**: `http://localhost:8000/api/v1`
- **认证方式**: Bearer Token (JWT)
- **内容类型**: `application/json`

## 通用响应格式

### 成功响应

```json
{
  "success": true,
  "data": { ... },
  "message": "操作成功"
}
```

### 错误响应

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数无效",
    "details": { ... }
  }
}
```

### 错误码

| 错误码 | HTTP 状态码 | 描述 |
|--------|------------|------|
| `UNAUTHORIZED` | 401 | 未认证或 Token 过期 |
| `FORBIDDEN` | 403 | 无权限访问 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `VALIDATION_ERROR` | 422 | 请求参数验证失败 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

---

## 认证 API

### POST /auth/register

注册新用户

**请求体**

```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "display_name": "张三"
}
```

**响应**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "张三",
      "created_at": "2024-01-01T00:00:00Z"
    },
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "token_type": "bearer",
    "expires_in": 3600
  }
}
```

### POST /auth/login

用户登录

**请求体**

```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**响应**

```json
{
  "success": true,
  "data": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "token_type": "bearer",
    "expires_in": 3600
  }
}
```

### POST /auth/refresh

刷新访问令牌

**请求体**

```json
{
  "refresh_token": "eyJ..."
}
```

### GET /auth/me

获取当前用户信息

**请求头**

```
Authorization: Bearer <access_token>
```

**响应**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "display_name": "张三",
    "avatar_url": null,
    "role": "user",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

---

## 聊天 API

### GET /chat/stream

SSE 流式聊天接口

**查询参数**

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `query` | string | ✅ | 用户查询内容 |
| `model` | string | ❌ | 模型 ID，默认使用用户默认模型 |
| `conversation_id` | string | ❌ | 对话 ID，不传则创建新对话 |
| `connection_id` | string | ❌ | 数据库连接 ID |
| `language` | string | ❌ | 语言 (zh/en)，默认 zh |

**请求示例**

```
GET /api/v1/chat/stream?query=查询上月销售额&model=gpt-4o
Authorization: Bearer <token>
Accept: text/event-stream
```

**SSE 事件格式**

```
event: progress
data: {"type": "progress", "stage": "analyzing", "message": "正在分析查询..."}

event: progress
data: {"type": "progress", "stage": "generating_sql", "message": "正在生成 SQL..."}

event: progress
data: {"type": "progress", "stage": "executing", "message": "正在执行查询..."}

event: result
data: {"type": "result", "sql": "SELECT ...", "data": [...], "rows_count": 10}

event: visualization
data: {"type": "visualization", "chart": {"type": "bar", "data": {...}}}

event: done
data: {"type": "done", "conversation_id": "uuid", "message_id": "uuid"}
```

**事件类型**

| 事件 | 描述 |
|------|------|
| `progress` | 执行进度更新 |
| `result` | 查询结果 |
| `visualization` | 可视化数据 |
| `error` | 错误信息 |
| `done` | 执行完成 |

### POST /chat/stop

停止正在执行的查询

**请求体**

```json
{
  "conversation_id": "uuid"
}
```

---

## 对话历史 API

### GET /conversations

获取对话列表

**查询参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| `limit` | int | 返回数量，默认 50 |
| `offset` | int | 偏移量，默认 0 |
| `favorites` | bool | 仅返回收藏 |
| `q` | string | 搜索关键词 |

**响应**

```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "uuid",
        "title": "查询上月销售额",
        "model": "gpt-4o",
        "is_favorite": false,
        "message_count": 4,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:05:00Z"
      }
    ],
    "total": 100,
    "has_more": true
  }
}
```

### GET /conversations/{id}

获取对话详情

**响应**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "查询上月销售额",
    "model": "gpt-4o",
    "connection_id": "uuid",
    "is_favorite": false,
    "messages": [
      {
        "id": "uuid",
        "role": "user",
        "content": "查询上月销售额",
        "created_at": "2024-01-01T00:00:00Z"
      },
      {
        "id": "uuid",
        "role": "assistant",
        "content": "根据查询结果...",
        "metadata": {
          "sql": "SELECT ...",
          "execution_time": 0.5,
          "rows_count": 10,
          "visualization": { ... }
        },
        "created_at": "2024-01-01T00:00:05Z"
      }
    ],
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

### DELETE /conversations/{id}

删除对话

### POST /conversations/{id}/favorite

切换收藏状态

---

## 模型管理 API

### GET /models

获取模型列表

**响应**

```json
{
  "success": true,
  "data": {
    "models": [
      {
        "id": "uuid",
        "name": "GPT-4o",
        "provider": "openai",
        "model_id": "gpt-4o",
        "is_default": true,
        "is_available": true
      }
    ]
  }
}
```

### POST /models

添加模型

**请求体**

```json
{
  "name": "Claude 3.5 Sonnet",
  "provider": "anthropic",
  "model_id": "claude-3-5-sonnet-20241022",
  "base_url": "https://api.anthropic.com",
  "api_key": "sk-ant-...",
  "is_default": false
}
```

### PUT /models/{id}

更新模型配置

### DELETE /models/{id}

删除模型

### POST /models/{id}/test

测试模型连接

---

## 数据库连接 API

### GET /connections

获取数据库连接列表

**响应**

```json
{
  "success": true,
  "data": {
    "connections": [
      {
        "id": "uuid",
        "name": "生产数据库",
        "driver": "mysql",
        "host": "localhost",
        "port": 3306,
        "database": "sales",
        "is_default": true,
        "is_connected": true
      }
    ]
  }
}
```

### POST /connections

添加数据库连接

**请求体**

```json
{
  "name": "生产数据库",
  "driver": "mysql",
  "host": "localhost",
  "port": 3306,
  "username": "root",
  "password": "password",
  "database": "sales",
  "is_default": true
}
```

### POST /connections/{id}/test

测试数据库连接

**响应**

```json
{
  "success": true,
  "data": {
    "connected": true,
    "version": "MySQL 8.0.35",
    "tables_count": 25,
    "message": "连接成功"
  }
}
```

### GET /connections/{id}/schema

获取数据库结构

**响应**

```json
{
  "success": true,
  "data": {
    "tables": [
      {
        "name": "orders",
        "columns": [
          {"name": "id", "type": "int", "nullable": false, "primary": true},
          {"name": "customer_id", "type": "int", "nullable": false},
          {"name": "amount", "type": "decimal(10,2)", "nullable": false},
          {"name": "created_at", "type": "datetime", "nullable": false}
        ],
        "row_count": 10000
      }
    ]
  }
}
```

---

## 配置 API

### GET /config

获取用户配置

**响应**

```json
{
  "success": true,
  "data": {
    "language": "zh",
    "theme": "light",
    "default_model_id": "uuid",
    "default_connection_id": "uuid",
    "view_mode": "user",
    "context_rounds": 3
  }
}
```

### PUT /config

更新用户配置

**请求体**

```json
{
  "language": "en",
  "theme": "dark",
  "view_mode": "developer"
}
```

---

## Prompt 管理 API

### GET /prompts

获取 Prompt 配置

### PUT /prompts

更新 Prompt 配置

### POST /prompts/reset

重置为默认 Prompt
