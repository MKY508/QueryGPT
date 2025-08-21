# API 接口文档

## 基础信息

- **基础URL**: `http://localhost:5000`
- **协议**: HTTP/HTTPS
- **数据格式**: JSON
- **字符编码**: UTF-8

## 认证

当前版本暂无认证要求，所有接口开放访问。生产环境建议添加认证机制。

## 接口列表

### 1. 执行查询

执行自然语言查询并返回结果。

**接口地址**: `POST /api/chat`

**请求参数**:

| 参数 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| message | string | 是 | 查询内容 | "统计本月销售额" |
| conversation_id | string | 否 | 对话ID | "uuid-string" |
| mode | string | 否 | 视图模式 | "user" 或 "developer" |
| model | string | 否 | 模型选择 | "gpt-4.1" |
| stream | boolean | 否 | 是否流式返回 | false |
| auto_run | boolean | 否 | 自动执行代码 | true |

**请求示例**:
```json
{
    "message": "查询2024年各部门的销售总额",
    "model": "gpt-4.1",
    "mode": "user",
    "auto_run": true
}
```

**响应参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| success | boolean | 请求是否成功 |
| response | string | 查询结果文本 |
| sql | string | 生成的SQL语句 |
| data | array | 查询结果数据 |
| visualization | string | 图表HTML路径 |
| conversation_id | string | 对话ID |
| error | string | 错误信息（失败时） |

**响应示例**:
```json
{
    "success": true,
    "response": "2024年各部门销售总额统计如下...",
    "sql": "SELECT department, SUM(amount) FROM sales...",
    "data": [
        {"department": "销售部", "total": 1000000},
        {"department": "市场部", "total": 800000}
    ],
    "visualization": "/output/chart_12345.html",
    "conversation_id": "abc-def-123"
}
```

### 2. 健康检查

检查服务运行状态。

**接口地址**: `GET /api/health`

**响应示例**:
```json
{
    "status": "healthy",
    "version": "1.0.0-beta",
    "database": "connected",
    "timestamp": "2025-08-21T10:00:00Z"
}
```

### 3. 获取配置

获取系统配置信息。

**接口地址**: `GET /api/config`

**响应示例**:
```json
{
    "api_base": "http://localhost:11434/v1",
    "default_model": "gpt-4.1",
    "available_models": ["gpt-4.1", "claude-sonnet-4"],
    "max_context_rounds": 3
}
```

### 4. 模型管理

#### 4.1 获取模型列表

**接口地址**: `GET /api/models`

**响应示例**:
```json
{
    "models": [
        {
            "id": "gpt-4.1",
            "name": "GPT-4.1",
            "status": "active"
        },
        {
            "id": "claude-sonnet-4",
            "name": "Claude Sonnet 4",
            "status": "active"
        }
    ]
}
```

#### 4.2 测试模型

**接口地址**: `POST /api/models/test`

**请求参数**:
```json
{
    "model": "gpt-4.1",
    "api_key": "your_api_key_here",
    "api_base": "http://localhost:11434/v1"
}
```

### 5. 历史记录管理

#### 5.1 获取历史列表

**接口地址**: `GET /api/history/conversations`

**查询参数**:
- `limit`: 返回数量限制（默认50）
- `offset`: 偏移量（分页）
- `q`: 搜索关键词
- `start_date`: 开始日期
- `end_date`: 结束日期

**响应示例**:
```json
{
    "success": true,
    "conversations": [
        {
            "id": "conv-123",
            "title": "销售数据查询",
            "last_query": "查询本月销售额",
            "created_at": "2025-08-20T10:00:00Z",
            "updated_at": "2025-08-20T10:05:00Z",
            "message_count": 3,
            "model": "gpt-4.1"
        }
    ],
    "total": 100,
    "has_more": true
}
```

#### 5.2 获取对话详情

**接口地址**: `GET /api/history/conversation/:id`

**响应示例**:
```json
{
    "success": true,
    "conversation": {
        "id": "conv-123",
        "title": "销售数据查询",
        "messages": [
            {
                "role": "user",
                "content": "查询本月销售额",
                "timestamp": "2025-08-20T10:00:00Z"
            },
            {
                "role": "assistant",
                "content": "本月销售额为...",
                "sql": "SELECT SUM(amount)...",
                "timestamp": "2025-08-20T10:00:05Z"
            }
        ]
    }
}
```

#### 5.3 删除对话

**接口地址**: `DELETE /api/history/conversation/:id`

**响应示例**:
```json
{
    "success": true,
    "message": "对话已删除"
}
```

#### 5.4 获取统计信息

**接口地址**: `GET /api/history/statistics`

**响应示例**:
```json
{
    "success": true,
    "statistics": {
        "total_conversations": 150,
        "total_messages": 450,
        "today_queries": 10,
        "this_week_queries": 35,
        "most_used_model": "gpt-4.1",
        "average_response_time": 2.5
    }
}
```

### 6. 数据库管理

#### 6.1 测试数据库连接

**接口地址**: `POST /api/database/test`

**请求参数**:
```json
{
    "host": "localhost",
    "port": 19130,
    "user": "your_db_user",
    "password": "******",
    "database": ""
}
```

**响应示例**:
```json
{
    "success": true,
    "message": "数据库连接成功",
    "table_count": 25,
    "databases": ["center_dws", "center_ods"]
}
```

## 错误处理

### 错误响应格式

```json
{
    "success": false,
    "error": "错误描述",
    "error_code": "ERROR_CODE",
    "details": "详细错误信息"
}
```

### 常见错误码

| 错误码 | HTTP状态码 | 说明 |
|--------|------------|------|
| INVALID_REQUEST | 400 | 请求参数错误 |
| UNAUTHORIZED | 401 | 未授权访问 |
| FORBIDDEN | 403 | 禁止访问 |
| NOT_FOUND | 404 | 资源不存在 |
| METHOD_NOT_ALLOWED | 405 | 请求方法不允许 |
| INTERNAL_ERROR | 500 | 服务器内部错误 |
| SERVICE_UNAVAILABLE | 503 | 服务暂时不可用 |

## 使用示例

### Python

```python
import requests

# 执行查询
response = requests.post('http://localhost:5000/api/chat', json={
    'message': '查询本月销售数据',
    'model': 'gpt-4.1'
})

if response.status_code == 200:
    data = response.json()
    print(f"查询结果: {data['response']}")
    if data.get('visualization'):
        print(f"图表路径: {data['visualization']}")
```

### JavaScript

```javascript
// 使用Fetch API
async function queryData(message) {
    const response = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: message,
            model: 'gpt-4.1'
        })
    });
    
    if (response.ok) {
        const data = await response.json();
        console.log('查询结果:', data.response);
        return data;
    }
}

// 调用
queryData('查询本月销售数据').then(data => {
    console.log(data);
});
```

### cURL

```bash
# 执行查询
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "查询本月销售数据",
    "model": "gpt-4.1"
  }'

# 获取历史记录
curl http://localhost:5000/api/history/conversations?limit=10

# 健康检查
curl http://localhost:5000/api/health
```

## 注意事项

1. **SQL注入防护**: 系统自动过滤危险SQL操作，只允许SELECT、SHOW、DESCRIBE
2. **超时设置**: 默认查询超时时间为120秒
3. **并发限制**: 建议单用户并发请求不超过5个
4. **数据量限制**: 单次查询返回数据不超过10000条
5. **缓存机制**: 相同查询会使用缓存，缓存时间为1小时

## 版本历史

- v1.0.0-beta (2025-08-21): Beta版本发布
  - 完整的API接口
  - 历史记录管理
  - 数据可视化
  - 错误处理机制