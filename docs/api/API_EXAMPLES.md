# QueryGPT API 使用示例

本文档提供了 QueryGPT API 的详细使用示例，包括 Python、JavaScript 和 cURL 的代码示例。

## 目录

- [认证](#认证)
- [聊天查询 API](#聊天查询-api)
- [配置管理 API](#配置管理-api)
- [模型管理 API](#模型管理-api)
- [数据库操作 API](#数据库操作-api)
- [历史记录 API](#历史记录-api)
- [健康检查 API](#健康检查-api)
- [错误处理](#错误处理)
- [流式响应](#流式响应)
- [WebSocket 支持](#websocket-支持)

## 认证

如果配置了 `API_ACCESS_SECRET` 环境变量，所有 API 请求需要在 Authorization 头中提供 Bearer 令牌。

### Python 示例

```python
import requests

# 配置
API_BASE_URL = "http://localhost:5001"
API_TOKEN = "your-api-token"  # 如果启用了认证

# 创建会话
session = requests.Session()
if API_TOKEN:
    session.headers.update({
        "Authorization": f"Bearer {API_TOKEN}"
    })
```

### JavaScript 示例

```javascript
// 配置
const API_BASE_URL = 'http://localhost:5001';
const API_TOKEN = 'your-api-token'; // 如果启用了认证

// 创建请求函数
async function apiRequest(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (API_TOKEN) {
        headers['Authorization'] = `Bearer ${API_TOKEN}`;
    }
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers
    });
    
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
}
```

### cURL 示例

```bash
# 不带认证
curl -X GET http://localhost:5001/api/health

# 带认证
curl -X GET http://localhost:5001/api/health \
  -H "Authorization: Bearer your-api-token"
```

## 聊天查询 API

### POST /api/chat - 执行自然语言查询

#### Python 示例

```python
import requests
import json

def execute_nl_query(query, model="gpt-4.1", conversation_id=None, stream=False):
    """
    执行自然语言查询
    
    Args:
        query: 自然语言查询字符串
        model: 使用的AI模型
        conversation_id: 会话ID（可选）
        stream: 是否使用流式响应
    
    Returns:
        查询结果
    """
    endpoint = f"{API_BASE_URL}/api/chat"
    
    payload = {
        "query": query,
        "model": model,
        "use_database": True,
        "language": "zh",
        "stream": stream
    }
    
    if conversation_id:
        payload["conversation_id"] = conversation_id
        payload["context_rounds"] = 3  # 包含最近3轮对话
    
    if stream:
        # 流式响应处理
        response = session.post(
            endpoint, 
            json=payload,
            stream=True
        )
        
        for line in response.iter_lines():
            if line:
                line_data = line.decode('utf-8')
                if line_data.startswith('data: '):
                    data = json.loads(line_data[6:])
                    print(data.get('content', ''), end='', flush=True)
    else:
        # 普通响应
        response = session.post(endpoint, json=payload)
        return response.json()

# 使用示例
result = execute_nl_query("查询上个月的销售总额")
print(json.dumps(result, indent=2, ensure_ascii=False))

# 带上下文的查询
result = execute_nl_query(
    "按产品类别分组", 
    conversation_id=result.get('conversation_id')
)

# 流式查询
execute_nl_query("生成销售趋势分析报告", stream=True)
```

#### JavaScript 示例

```javascript
async function executeNLQuery(query, options = {}) {
    const {
        model = 'gpt-4.1',
        conversationId = null,
        contextRounds = 3,
        stream = false,
        language = 'zh'
    } = options;
    
    const payload = {
        query,
        model,
        use_database: true,
        language,
        stream
    };
    
    if (conversationId) {
        payload.conversation_id = conversationId;
        payload.context_rounds = contextRounds;
    }
    
    if (stream) {
        // 处理流式响应
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(API_TOKEN && { 'Authorization': `Bearer ${API_TOKEN}` })
            },
            body: JSON.stringify(payload)
        });
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6));
                    console.log(data.content);
                }
            }
        }
    } else {
        // 普通请求
        return await apiRequest('/api/chat', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }
}

// 使用示例
(async () => {
    // 简单查询
    const result = await executeNLQuery('查询本月销售前10的产品');
    console.log(result);
    
    // 带上下文的查询
    const followUp = await executeNLQuery('生成柱状图', {
        conversationId: result.conversation_id
    });
    
    // 流式查询
    await executeNLQuery('分析销售趋势并生成报告', { stream: true });
})();
```

#### cURL 示例

```bash
# 简单查询
curl -X POST http://localhost:5001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "查询销售总额",
    "model": "gpt-4.1",
    "use_database": true,
    "language": "zh"
  }'

# 带会话上下文的查询
curl -X POST http://localhost:5001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "按月份分组",
    "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
    "context_rounds": 3
  }'

# 流式响应
curl -X POST http://localhost:5001/api/chat \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "query": "生成详细的数据分析报告",
    "stream": true
  }'
```

## 配置管理 API

### GET /api/config - 获取系统配置

#### Python 示例

```python
def get_system_config():
    """获取系统配置"""
    response = session.get(f"{API_BASE_URL}/api/config")
    return response.json()

# 使用示例
config = get_system_config()
print(f"默认模型: {config['default_model']}")
print(f"数据库: {config['database']['host']}:{config['database']['port']}")
```

#### JavaScript 示例

```javascript
async function getSystemConfig() {
    return await apiRequest('/api/config');
}

// 使用示例
const config = await getSystemConfig();
console.log('Available models:', config.models);
```

### POST /api/config - 更新系统配置

#### Python 示例

```python
def update_system_config(config_updates):
    """更新系统配置"""
    response = session.post(
        f"{API_BASE_URL}/api/config",
        json=config_updates
    )
    return response.json()

# 使用示例
result = update_system_config({
    "default_model": "claude-sonnet-4",
    "interface_theme": "dark",
    "show_thinking": True
})
```

## 模型管理 API

### GET /api/models - 获取可用模型列表

#### Python 示例

```python
def get_available_models():
    """获取所有可用的AI模型"""
    response = session.get(f"{API_BASE_URL}/api/models")
    return response.json()

# 使用示例
models_data = get_available_models()
for model in models_data['models']:
    print(f"{model['id']}: {model['name']} - {model['status']}")
```

### POST /api/test_model - 测试模型连接

#### Python 示例

```python
def test_model_connection(model_id, api_key=None):
    """测试模型连接"""
    payload = {"model": model_id}
    if api_key:
        payload["api_key"] = api_key
    
    response = session.post(
        f"{API_BASE_URL}/api/test_model",
        json=payload
    )
    return response.json()

# 使用示例
result = test_model_connection("gpt-4.1")
if result['success']:
    print(f"模型测试成功: {result['message']}")
```

## 数据库操作 API

### POST /api/execute_sql - 执行SQL查询

#### Python 示例

```python
def execute_sql(query):
    """
    执行SQL查询（仅支持只读操作）
    
    Args:
        query: SQL查询语句
    
    Returns:
        查询结果
    """
    response = session.post(
        f"{API_BASE_URL}/api/execute_sql",
        json={"query": query}
    )
    return response.json()

# 使用示例
result = execute_sql("SELECT * FROM sales ORDER BY sale_date DESC LIMIT 10")
if result['success']:
    print(f"返回 {result['count']} 条记录")
    for row in result['data']:
        print(row)
```

#### JavaScript 示例

```javascript
async function executeSQL(query) {
    return await apiRequest('/api/execute_sql', {
        method: 'POST',
        body: JSON.stringify({ query })
    });
}

// 使用示例
const result = await executeSQL('SHOW TABLES');
console.log('Tables:', result.data);
```

### GET /api/schema - 获取数据库结构

#### Python 示例

```python
def get_database_schema():
    """获取数据库表结构"""
    response = session.get(f"{API_BASE_URL}/api/schema")
    return response.json()

# 使用示例
schema = get_database_schema()
for table_name, columns in schema['schema'].items():
    print(f"\n表: {table_name}")
    for col in columns:
        print(f"  - {col['name']} ({col['type']}) {'NOT NULL' if not col['nullable'] else ''}")
```

### POST /api/database/test - 测试数据库连接

#### Python 示例

```python
def test_database_connection(host, port, user, password, database):
    """测试数据库连接"""
    response = session.post(
        f"{API_BASE_URL}/api/database/test",
        json={
            "host": host,
            "port": port,
            "user": user,
            "password": password,
            "database": database
        }
    )
    return response.json()

# 使用示例
result = test_database_connection(
    host="localhost",
    port=3306,
    user="root",
    password="password",
    database="sales_db"
)
print(f"连接{'成功' if result['success'] else '失败'}: {result['message']}")
```

## 历史记录 API

### GET /api/history/conversations - 获取对话历史

#### Python 示例

```python
def get_conversation_history(search_query=None, limit=50, favorites_only=False):
    """
    获取对话历史列表
    
    Args:
        search_query: 搜索关键词
        limit: 返回数量限制
        favorites_only: 仅返回收藏的对话
    
    Returns:
        对话列表
    """
    params = {"limit": limit}
    if search_query:
        params["q"] = search_query
    if favorites_only:
        params["favorites"] = "true"
    
    response = session.get(
        f"{API_BASE_URL}/api/history/conversations",
        params=params
    )
    return response.json()

# 使用示例
history = get_conversation_history(search_query="销售", limit=10)
for conv in history['conversations']:
    print(f"{conv['title']} - {conv['created_at']}")
```

### GET /api/history/conversation/{id} - 获取对话详情

#### Python 示例

```python
def get_conversation_detail(conversation_id):
    """获取对话详细信息"""
    response = session.get(
        f"{API_BASE_URL}/api/history/conversation/{conversation_id}"
    )
    return response.json()

# 使用示例
detail = get_conversation_detail("550e8400-e29b-41d4-a716-446655440000")
for msg in detail['conversation']['messages']:
    print(f"{msg['message_type']}: {msg['content'][:100]}...")
```

### DELETE /api/history/conversation/{id} - 删除对话

#### JavaScript 示例

```javascript
async function deleteConversation(conversationId) {
    return await apiRequest(`/api/history/conversation/${conversationId}`, {
        method: 'DELETE'
    });
}

// 使用示例
const result = await deleteConversation('550e8400-e29b-41d4-a716-446655440000');
console.log(result.message);
```

### POST /api/history/conversation/{id}/favorite - 切换收藏状态

#### Python 示例

```python
def toggle_favorite(conversation_id):
    """切换对话的收藏状态"""
    response = session.post(
        f"{API_BASE_URL}/api/history/conversation/{conversation_id}/favorite"
    )
    return response.json()

# 使用示例
result = toggle_favorite("550e8400-e29b-41d4-a716-446655440000")
print(f"收藏状态: {'已收藏' if result['is_favorite'] else '未收藏'}")
```

### GET /api/history/statistics - 获取统计信息

#### Python 示例

```python
def get_history_statistics():
    """获取历史记录统计信息"""
    response = session.get(f"{API_BASE_URL}/api/history/statistics")
    return response.json()

# 使用示例
stats = get_history_statistics()
print(f"总对话数: {stats['statistics']['total_conversations']}")
print(f"总消息数: {stats['statistics']['total_messages']}")
print("\n模型使用统计:")
for model, count in stats['statistics']['models_usage'].items():
    print(f"  {model}: {count}次")
```

### POST /api/history/cleanup - 清理历史记录

#### Python 示例

```python
def cleanup_history(days_to_keep=90):
    """清理指定天数之前的历史记录"""
    response = session.post(
        f"{API_BASE_URL}/api/history/cleanup",
        json={"days": days_to_keep}
    )
    return response.json()

# 使用示例
result = cleanup_history(30)  # 保留最近30天的记录
print(result['message'])
```

## 健康检查 API

### GET /api/health - 健康检查

#### Python 示例

```python
def check_health():
    """检查服务健康状态"""
    response = session.get(f"{API_BASE_URL}/api/health")
    return response.json()

# 使用示例
health = check_health()
print(f"状态: {health['status']}")
print(f"版本: {health['version']}")
print("服务状态:")
for service, status in health['services'].items():
    print(f"  {service}: {'正常' if status else '异常'}")
```

#### JavaScript 示例

```javascript
async function checkHealth() {
    const response = await fetch(`${API_BASE_URL}/api/health`);
    return response.json();
}

// 使用示例
const health = await checkHealth();
if (health.status === 'healthy') {
    console.log('所有服务运行正常');
} else {
    console.warn('部分服务可能存在问题');
}
```

#### cURL 示例

```bash
curl -X GET http://localhost:5001/api/health
```

## 错误处理

### Python 错误处理示例

```python
import requests
from requests.exceptions import RequestException

def safe_api_call(func, *args, **kwargs):
    """
    安全的API调用包装器
    
    Args:
        func: API调用函数
        *args, **kwargs: 函数参数
    
    Returns:
        API响应或错误信息
    """
    try:
        result = func(*args, **kwargs)
        if isinstance(result, requests.Response):
            result.raise_for_status()
            return result.json()
        return result
    except requests.exceptions.HTTPError as e:
        error_data = e.response.json() if e.response else {}
        print(f"HTTP错误 {e.response.status_code}: {error_data.get('error', str(e))}")
        return None
    except requests.exceptions.ConnectionError:
        print("连接错误: 无法连接到API服务器")
        return None
    except requests.exceptions.Timeout:
        print("请求超时")
        return None
    except RequestException as e:
        print(f"请求错误: {e}")
        return None
    except Exception as e:
        print(f"未知错误: {e}")
        return None

# 使用示例
result = safe_api_call(execute_nl_query, "查询销售数据")
if result:
    print("查询成功")
```

### JavaScript 错误处理示例

```javascript
class APIError extends Error {
    constructor(message, status, data) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

async function safeAPICall(apiFunc, ...args) {
    try {
        return await apiFunc(...args);
    } catch (error) {
        if (error instanceof APIError) {
            console.error(`API错误 (${error.status}): ${error.message}`);
            console.error('错误详情:', error.data);
        } else if (error.name === 'NetworkError') {
            console.error('网络错误: 无法连接到服务器');
        } else if (error.name === 'TimeoutError') {
            console.error('请求超时');
        } else {
            console.error('未知错误:', error);
        }
        return null;
    }
}

// 使用示例
const result = await safeAPICall(executeNLQuery, '查询数据');
if (result) {
    console.log('查询成功');
}
```

## 流式响应

### Python 流式响应处理

```python
import json

def stream_nl_query(query, callback=None):
    """
    执行流式自然语言查询
    
    Args:
        query: 查询字符串
        callback: 处理每个数据块的回调函数
    """
    response = session.post(
        f"{API_BASE_URL}/api/chat",
        json={
            "query": query,
            "stream": True
        },
        stream=True
    )
    
    for line in response.iter_lines():
        if line:
            line_str = line.decode('utf-8')
            if line_str.startswith('data: '):
                try:
                    data = json.loads(line_str[6:])
                    if callback:
                        callback(data)
                    else:
                        print(data.get('content', ''), end='', flush=True)
                except json.JSONDecodeError:
                    pass
            elif line_str.startswith('event: '):
                event_type = line_str[7:]
                if event_type == 'done':
                    print("\n查询完成")
                    break
                elif event_type == 'error':
                    print("\n查询出错")
                    break

# 使用示例
def handle_stream_data(data):
    if 'content' in data:
        print(f"[内容] {data['content']}")
    if 'sql' in data:
        print(f"[SQL] {data['sql']}")
    if 'visualization' in data:
        print(f"[可视化] 类型: {data['visualization'].get('type')}")

stream_nl_query("生成销售分析报告", callback=handle_stream_data)
```

### JavaScript 流式响应处理

```javascript
async function streamNLQuery(query, onData) {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(API_TOKEN && { 'Authorization': `Bearer ${API_TOKEN}` })
        },
        body: JSON.stringify({
            query,
            stream: true
        })
    });
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留不完整的行
        
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.slice(6));
                    onData(data);
                } catch (e) {
                    console.error('解析错误:', e);
                }
            } else if (line.startsWith('event: ')) {
                const event = line.slice(7);
                if (event === 'done') {
                    console.log('查询完成');
                    return;
                } else if (event === 'error') {
                    console.error('查询出错');
                    return;
                }
            }
        }
    }
}

// 使用示例
await streamNLQuery('分析最近一年的销售趋势', (data) => {
    if (data.content) {
        process.stdout.write(data.content);
    }
    if (data.sql) {
        console.log('\nSQL:', data.sql);
    }
    if (data.visualization) {
        console.log('\n可视化配置:', data.visualization);
    }
});
```

## WebSocket 支持

### Python WebSocket 客户端

```python
import websocket
import json
import threading

class QueryGPTWebSocket:
    def __init__(self, url="ws://localhost:5001/ws"):
        self.url = url
        self.ws = None
        self.conversation_id = None
        
    def connect(self):
        """建立WebSocket连接"""
        self.ws = websocket.WebSocketApp(
            self.url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        
        # 在新线程中运行
        wst = threading.Thread(target=self.ws.run_forever)
        wst.daemon = True
        wst.start()
    
    def on_open(self, ws):
        print("WebSocket连接已建立")
    
    def on_message(self, ws, message):
        data = json.loads(message)
        if data.get('type') == 'result':
            print(f"结果: {data.get('content')}")
        elif data.get('type') == 'thinking':
            print(f"思考中: {data.get('content')}")
        elif data.get('type') == 'error':
            print(f"错误: {data.get('error')}")
    
    def on_error(self, ws, error):
        print(f"WebSocket错误: {error}")
    
    def on_close(self, ws):
        print("WebSocket连接已关闭")
    
    def send_query(self, query, model="gpt-4.1"):
        """发送查询"""
        if self.ws:
            message = {
                "type": "query",
                "query": query,
                "model": model,
                "conversation_id": self.conversation_id
            }
            self.ws.send(json.dumps(message))
    
    def close(self):
        """关闭连接"""
        if self.ws:
            self.ws.close()

# 使用示例
client = QueryGPTWebSocket()
client.connect()

import time
time.sleep(1)  # 等待连接建立

client.send_query("查询本月销售额")
time.sleep(5)  # 等待响应

client.close()
```

### JavaScript WebSocket 客户端

```javascript
class QueryGPTWebSocket {
    constructor(url = 'ws://localhost:5001/ws') {
        this.url = url;
        this.ws = null;
        this.conversationId = null;
        this.handlers = {};
    }
    
    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);
            
            this.ws.onopen = () => {
                console.log('WebSocket连接已建立');
                resolve();
            };
            
            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket错误:', error);
                reject(error);
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket连接已关闭');
            };
        });
    }
    
    handleMessage(data) {
        switch (data.type) {
            case 'result':
                console.log('结果:', data.content);
                if (this.handlers.onResult) {
                    this.handlers.onResult(data);
                }
                break;
            case 'thinking':
                console.log('思考中:', data.content);
                if (this.handlers.onThinking) {
                    this.handlers.onThinking(data);
                }
                break;
            case 'visualization':
                console.log('可视化:', data.config);
                if (this.handlers.onVisualization) {
                    this.handlers.onVisualization(data);
                }
                break;
            case 'error':
                console.error('错误:', data.error);
                if (this.handlers.onError) {
                    this.handlers.onError(data);
                }
                break;
        }
    }
    
    sendQuery(query, options = {}) {
        const message = {
            type: 'query',
            query,
            model: options.model || 'gpt-4.1',
            conversation_id: this.conversationId,
            ...options
        };
        
        this.ws.send(JSON.stringify(message));
    }
    
    on(event, handler) {
        this.handlers[`on${event.charAt(0).toUpperCase() + event.slice(1)}`] = handler;
    }
    
    close() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// 使用示例
(async () => {
    const client = new QueryGPTWebSocket();
    
    // 注册事件处理器
    client.on('result', (data) => {
        document.getElementById('result').innerHTML += data.content;
    });
    
    client.on('thinking', (data) => {
        document.getElementById('thinking').innerText = data.content;
    });
    
    client.on('visualization', (data) => {
        renderChart(data.config);
    });
    
    // 连接并发送查询
    await client.connect();
    client.sendQuery('分析销售数据并生成图表');
    
    // 稍后关闭连接
    setTimeout(() => client.close(), 30000);
})();
```

## 批量操作示例

### Python 批量查询

```python
import asyncio
import aiohttp
import json

async def batch_queries(queries, max_concurrent=5):
    """
    批量执行查询
    
    Args:
        queries: 查询列表
        max_concurrent: 最大并发数
    
    Returns:
        结果列表
    """
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def execute_query(session, query):
        async with semaphore:
            async with session.post(
                f"{API_BASE_URL}/api/chat",
                json={"query": query},
                headers={"Authorization": f"Bearer {API_TOKEN}"} if API_TOKEN else {}
            ) as response:
                return await response.json()
    
    async with aiohttp.ClientSession() as session:
        tasks = [execute_query(session, q) for q in queries]
        return await asyncio.gather(*tasks)

# 使用示例
queries = [
    "查询本月销售额",
    "查询上月销售额",
    "查询本季度销售额",
    "查询去年同期销售额",
    "计算销售增长率"
]

results = asyncio.run(batch_queries(queries))
for query, result in zip(queries, results):
    print(f"{query}: {result.get('result', {}).get('content', [''])[0]}")
```

### JavaScript 批量查询

```javascript
async function batchQueries(queries, maxConcurrent = 5) {
    const results = [];
    const executing = [];
    
    for (const query of queries) {
        const promise = executeNLQuery(query).then(result => ({
            query,
            result
        }));
        
        results.push(promise);
        
        if (queries.length >= maxConcurrent) {
            executing.push(promise);
            
            if (executing.length >= maxConcurrent) {
                await Promise.race(executing);
                executing.splice(executing.findIndex(p => p.settled), 1);
            }
        }
    }
    
    return Promise.all(results);
}

// 使用示例
const queries = [
    '查询本月销售额',
    '查询上月销售额',
    '查询本季度销售额',
    '查询去年同期销售额',
    '计算销售增长率'
];

const results = await batchQueries(queries, 3);
results.forEach(({ query, result }) => {
    console.log(`${query}: ${result?.result?.content?.[0] || '无结果'}`);
});
```

## 高级用例

### 复杂分析流程

```python
class DataAnalysisWorkflow:
    """数据分析工作流"""
    
    def __init__(self, api_base_url, api_token=None):
        self.api_base_url = api_base_url
        self.session = requests.Session()
        if api_token:
            self.session.headers.update({
                "Authorization": f"Bearer {api_token}"
            })
        self.conversation_id = None
    
    def analyze_sales_performance(self, time_period="本月"):
        """完整的销售业绩分析流程"""
        
        # 步骤1: 获取销售数据
        print(f"正在分析{time_period}销售数据...")
        sales_data = self._query(f"查询{time_period}的销售总额和订单数量")
        
        # 步骤2: 对比分析
        print("进行对比分析...")
        comparison = self._query("与上个时期对比，计算增长率")
        
        # 步骤3: 产品分析
        print("分析产品表现...")
        product_analysis = self._query("找出销售额前10的产品")
        
        # 步骤4: 生成可视化
        print("生成可视化图表...")
        charts = []
        charts.append(self._query("生成销售趋势折线图"))
        charts.append(self._query("生成产品销售占比饼图"))
        charts.append(self._query("生成每日销售柱状图"))
        
        # 步骤5: 生成报告
        print("生成分析报告...")
        report = self._query(
            f"基于以上数据，生成一份{time_period}销售分析报告，"
            "包括关键发现、趋势分析和改进建议"
        )
        
        return {
            "sales_data": sales_data,
            "comparison": comparison,
            "product_analysis": product_analysis,
            "charts": charts,
            "report": report
        }
    
    def _query(self, query):
        """执行查询并保持会话上下文"""
        payload = {
            "query": query,
            "use_database": True
        }
        if self.conversation_id:
            payload["conversation_id"] = self.conversation_id
            payload["context_rounds"] = 5
        
        response = self.session.post(
            f"{self.api_base_url}/api/chat",
            json=payload
        )
        result = response.json()
        
        # 保存会话ID
        if not self.conversation_id:
            self.conversation_id = result.get("conversation_id")
        
        return result

# 使用示例
workflow = DataAnalysisWorkflow(API_BASE_URL, API_TOKEN)
analysis_result = workflow.analyze_sales_performance("2024年第一季度")

# 输出报告
print("\n=== 分析报告 ===")
print(analysis_result["report"]["result"]["content"][0])
```

### 自动化报表生成

```javascript
class ReportGenerator {
    constructor(apiBaseUrl, apiToken) {
        this.apiBaseUrl = apiBaseUrl;
        this.apiToken = apiToken;
        this.conversationId = null;
    }
    
    async generateDailyReport() {
        const report = {
            date: new Date().toISOString().split('T')[0],
            sections: []
        };
        
        // 销售概况
        const salesOverview = await this.query('生成今日销售概况');
        report.sections.push({
            title: '销售概况',
            content: salesOverview.result.content
        });
        
        // 关键指标
        const kpis = await this.query('计算今日关键业务指标（销售额、订单数、客单价、转化率）');
        report.sections.push({
            title: '关键指标',
            content: kpis.result.content,
            visualization: kpis.visualization
        });
        
        // 异常检测
        const anomalies = await this.query('检测今日是否有异常数据或趋势');
        if (anomalies.result.content[0] !== '无异常') {
            report.sections.push({
                title: '异常警报',
                content: anomalies.result.content,
                priority: 'high'
            });
        }
        
        // 生成HTML报告
        const htmlReport = this.formatAsHTML(report);
        
        // 发送邮件（如果配置了邮件服务）
        // await this.sendEmail(htmlReport);
        
        return report;
    }
    
    async query(queryText) {
        const payload = {
            query: queryText,
            use_database: true
        };
        
        if (this.conversationId) {
            payload.conversation_id = this.conversationId;
            payload.context_rounds = 3;
        }
        
        const response = await fetch(`${this.apiBaseUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.apiToken && { 'Authorization': `Bearer ${this.apiToken}` })
            },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (!this.conversationId) {
            this.conversationId = result.conversation_id;
        }
        
        return result;
    }
    
    formatAsHTML(report) {
        let html = `
        <html>
        <head>
            <title>日报 - ${report.date}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h1 { color: #333; }
                h2 { color: #666; border-bottom: 1px solid #ddd; }
                .section { margin: 20px 0; }
                .high-priority { color: red; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>业务日报 - ${report.date}</h1>
        `;
        
        for (const section of report.sections) {
            html += `
            <div class="section ${section.priority === 'high' ? 'high-priority' : ''}">
                <h2>${section.title}</h2>
                <div>${section.content.join('<br>')}</div>
            </div>
            `;
        }
        
        html += '</body></html>';
        return html;
    }
}

// 使用示例
const generator = new ReportGenerator(API_BASE_URL, API_TOKEN);
const report = await generator.generateDailyReport();
console.log('报告已生成:', report);
```

## 性能优化建议

### 1. 使用连接池

```python
# Python - 使用连接池提高性能
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

def create_session_with_retries():
    session = requests.Session()
    retry = Retry(
        total=3,
        read=3,
        connect=3,
        backoff_factor=0.3,
        status_forcelist=(500, 502, 504)
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    return session
```

### 2. 缓存查询结果

```javascript
// JavaScript - 实现简单的查询缓存
class CachedAPIClient {
    constructor(cacheTime = 300000) { // 5分钟缓存
        this.cache = new Map();
        this.cacheTime = cacheTime;
    }
    
    async query(queryText, options = {}) {
        const cacheKey = JSON.stringify({ queryText, ...options });
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTime) {
            console.log('使用缓存结果');
            return cached.data;
        }
        
        const result = await executeNLQuery(queryText, options);
        this.cache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });
        
        return result;
    }
    
    clearCache() {
        this.cache.clear();
    }
}
```

### 3. 批量处理优化

```python
# Python - 优化的批量处理
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

def optimized_batch_process(items, process_func, max_workers=10, rate_limit=None):
    """
    优化的批量处理，支持速率限制
    
    Args:
        items: 待处理项目列表
        process_func: 处理函数
        max_workers: 最大并发数
        rate_limit: 每秒最大请求数
    """
    results = []
    last_request_time = 0
    min_interval = 1.0 / rate_limit if rate_limit else 0
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []
        
        for item in items:
            # 速率限制
            if rate_limit:
                current_time = time.time()
                time_since_last = current_time - last_request_time
                if time_since_last < min_interval:
                    time.sleep(min_interval - time_since_last)
                last_request_time = time.time()
            
            futures.append(executor.submit(process_func, item))
        
        for future in as_completed(futures):
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                print(f"处理失败: {e}")
                results.append(None)
    
    return results
```

## 安全最佳实践

### 1. API密钥管理

```python
# Python - 安全的API密钥管理
import os
from cryptography.fernet import Fernet

class SecureAPIClient:
    def __init__(self):
        # 从环境变量读取加密的API密钥
        encrypted_key = os.getenv('ENCRYPTED_API_KEY')
        encryption_key = os.getenv('ENCRYPTION_KEY')
        
        if encrypted_key and encryption_key:
            f = Fernet(encryption_key.encode())
            self.api_key = f.decrypt(encrypted_key.encode()).decode()
        else:
            self.api_key = os.getenv('API_KEY')
    
    def get_headers(self):
        return {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
```

### 2. 输入验证

```javascript
// JavaScript - 输入验证和清理
function sanitizeQuery(query) {
    // 移除潜在的SQL注入尝试
    const dangerousPatterns = [
        /;\s*DROP/gi,
        /;\s*DELETE/gi,
        /;\s*INSERT/gi,
        /;\s*UPDATE/gi,
        /;\s*ALTER/gi,
        /--/g,
        /\/\*/g
    ];
    
    let sanitized = query;
    for (const pattern of dangerousPatterns) {
        sanitized = sanitized.replace(pattern, '');
    }
    
    // 限制查询长度
    if (sanitized.length > 1000) {
        sanitized = sanitized.substring(0, 1000);
    }
    
    return sanitized.trim();
}

// 使用示例
const userInput = document.getElementById('query').value;
const sanitizedQuery = sanitizeQuery(userInput);
const result = await executeNLQuery(sanitizedQuery);
```

### 3. 日志记录

```python
# Python - 安全的日志记录
import logging
import hashlib
from datetime import datetime

class SecureLogger:
    def __init__(self, log_file='api_audit.log'):
        logging.basicConfig(
            filename=log_file,
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s'
        )
        self.logger = logging.getLogger(__name__)
    
    def log_api_call(self, endpoint, user_id, query, response_status):
        # 对敏感数据进行哈希处理
        query_hash = hashlib.sha256(query.encode()).hexdigest()[:8]
        
        log_entry = {
            'timestamp': datetime.now().isoformat(),
            'endpoint': endpoint,
            'user_id': user_id,
            'query_hash': query_hash,
            'response_status': response_status
        }
        
        self.logger.info(json.dumps(log_entry))
```

## 故障排查

### 常见问题和解决方案

| 问题 | 可能原因 | 解决方案 |
|------|---------|----------|
| 连接被拒绝 | API服务未启动 | 检查服务状态，启动API服务 |
| 401 未授权 | API密钥错误或过期 | 验证API密钥，更新认证信息 |
| 429 请求过多 | 超过速率限制 | 实施重试逻辑，降低请求频率 |
| 500 服务器错误 | 数据库连接失败 | 检查数据库配置和连接 |
| 超时错误 | 查询太复杂或网络问题 | 优化查询，增加超时时间 |

### 调试工具

```python
# Python - API调试工具
class APIDebugger:
    def __init__(self, api_base_url):
        self.api_base_url = api_base_url
    
    def test_connectivity(self):
        """测试API连接性"""
        try:
            response = requests.get(f"{self.api_base_url}/api/health", timeout=5)
            return response.status_code == 200
        except:
            return False
    
    def test_authentication(self, api_token):
        """测试认证"""
        headers = {'Authorization': f'Bearer {api_token}'}
        response = requests.get(
            f"{self.api_base_url}/api/config",
            headers=headers
        )
        return response.status_code == 200
    
    def test_database(self):
        """测试数据库连接"""
        response = requests.get(f"{self.api_base_url}/api/test_connection")
        data = response.json()
        return data.get('connected', False)
    
    def run_diagnostics(self, api_token=None):
        """运行完整诊断"""
        print("=== API诊断 ===")
        print(f"连接性: {'✓' if self.test_connectivity() else '✗'}")
        if api_token:
            print(f"认证: {'✓' if self.test_authentication(api_token) else '✗'}")
        print(f"数据库: {'✓' if self.test_database() else '✗'}")

# 使用示例
debugger = APIDebugger(API_BASE_URL)
debugger.run_diagnostics(API_TOKEN)
```

## 总结

QueryGPT API 提供了完整的自然语言数据查询和分析功能。通过本文档的示例，您可以：

1. **快速集成** - 使用提供的代码示例快速集成API到您的应用
2. **处理各种场景** - 从简单查询到复杂的批量分析
3. **优化性能** - 使用缓存、连接池和批量处理提高效率
4. **确保安全** - 实施最佳安全实践保护数据和API
5. **故障排查** - 使用调试工具快速定位和解决问题

更多信息请参考：
- [OpenAPI规范文档](./openapi.yaml)
- [API参考文档](./README.md)
- [项目主页](https://github.com/your-repo/querygpt)