# QueryGPT API 使用示例

本文档提供QueryGPT API在不同编程语言中的使用示例。

## 目录

- [Python](#python)
- [JavaScript/Node.js](#javascriptnodejs)
- [cURL](#curl)
- [Java](#java)
- [Go](#go)
- [C#/.NET](#cnet)

## 基础配置

### API端点
- 本地开发: `http://localhost:5001`
- 生产环境: `https://api.querygpt.com`

### 认证
如果配置了认证，需要在请求头中包含Bearer Token：
```
Authorization: Bearer <your-token>
```

## Python

### 安装依赖
```bash
pip install requests
```

### 基础客户端类
```python
import requests
import json
from typing import Dict, Any, Optional

class QueryGPTClient:
    def __init__(self, base_url: str = "http://localhost:5001", token: Optional[str] = None):
        self.base_url = base_url
        self.session = requests.Session()
        if token:
            self.session.headers.update({"Authorization": f"Bearer {token}"})
    
    def chat(self, query: str, model: str = None, conversation_id: str = None) -> Dict[str, Any]:
        """执行自然语言查询"""
        payload = {
            "query": query,
            "use_database": True,
            "context_rounds": 3
        }
        if model:
            payload["model"] = model
        if conversation_id:
            payload["conversation_id"] = conversation_id
        
        response = self.session.post(f"{self.base_url}/api/chat", json=payload)
        response.raise_for_status()
        return response.json()
    
    def get_config(self) -> Dict[str, Any]:
        """获取系统配置"""
        response = self.session.get(f"{self.base_url}/api/config")
        response.raise_for_status()
        return response.json()
    
    def execute_sql(self, sql: str) -> Dict[str, Any]:
        """执行SQL查询（只读）"""
        response = self.session.post(
            f"{self.base_url}/api/execute_sql",
            json={"query": sql}
        )
        response.raise_for_status()
        return response.json()
    
    def get_history(self, limit: int = 50, search: str = None) -> Dict[str, Any]:
        """获取对话历史"""
        params = {"limit": limit}
        if search:
            params["q"] = search
        
        response = self.session.get(
            f"{self.base_url}/api/history/conversations",
            params=params
        )
        response.raise_for_status()
        return response.json()

# 使用示例
client = QueryGPTClient()

# 1. 执行查询
result = client.chat("查询上个月的销售总额")
print(f"查询结果: {result['result']}")

# 2. 带上下文的对话
conversation_id = result.get('conversation_id')
follow_up = client.chat("按产品分类显示", conversation_id=conversation_id)

# 3. 执行SQL
sql_result = client.execute_sql("SELECT COUNT(*) FROM sales")
print(f"记录数: {sql_result['data']}")

# 4. 获取历史
history = client.get_history(limit=10)
for conv in history['conversations']:
    print(f"{conv['created_at']}: {conv['title']}")
```

### 流式响应处理
```python
import requests
import json

def stream_chat(query: str, base_url: str = "http://localhost:5001"):
    """处理流式响应"""
    response = requests.post(
        f"{base_url}/api/chat",
        json={"query": query, "stream": True},
        stream=True
    )
    
    for line in response.iter_lines():
        if line:
            # 解析SSE格式
            if line.startswith(b'data: '):
                data = line[6:]
                try:
                    event = json.loads(data)
                    if event.get('type') == 'content':
                        print(event['content'], end='', flush=True)
                    elif event.get('type') == 'done':
                        break
                except json.JSONDecodeError:
                    pass

# 使用流式响应
stream_chat("生成销售报告")
```

## JavaScript/Node.js

### 安装依赖
```bash
npm install axios
```

### 基础客户端类
```javascript
const axios = require('axios');

class QueryGPTClient {
    constructor(baseURL = 'http://localhost:5001', token = null) {
        this.client = axios.create({
            baseURL,
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
    }
    
    async chat(query, options = {}) {
        const { model, conversationId, contextRounds = 3 } = options;
        
        const response = await this.client.post('/api/chat', {
            query,
            model,
            conversation_id: conversationId,
            context_rounds: contextRounds,
            use_database: true
        });
        
        return response.data;
    }
    
    async getConfig() {
        const response = await this.client.get('/api/config');
        return response.data;
    }
    
    async executeSQL(sql) {
        const response = await this.client.post('/api/execute_sql', {
            query: sql
        });
        return response.data;
    }
    
    async getHistory(limit = 50, search = null) {
        const params = { limit };
        if (search) params.q = search;
        
        const response = await this.client.get('/api/history/conversations', {
            params
        });
        return response.data;
    }
    
    async testConnection(config) {
        const response = await this.client.post('/api/database/test', config);
        return response.data;
    }
}

// 使用示例
async function main() {
    const client = new QueryGPTClient();
    
    try {
        // 1. 执行查询
        const result = await client.chat('查询本月销售额');
        console.log('查询结果:', result.result);
        
        // 2. 继续对话
        const conversationId = result.conversation_id;
        const followUp = await client.chat('生成图表', {
            conversationId,
            model: 'gpt-4.1'
        });
        
        // 3. 获取配置
        const config = await client.getConfig();
        console.log('当前模型:', config.default_model);
        
        // 4. 测试数据库连接
        const testResult = await client.testConnection({
            host: '127.0.0.1',
            port: 3306,
            user: 'root',
            password: 'password',
            database: 'test_db'
        });
        console.log('连接状态:', testResult.success ? '成功' : '失败');
        
    } catch (error) {
        console.error('错误:', error.response?.data || error.message);
    }
}

main();
```

### 浏览器端使用 (Fetch API)
```javascript
class QueryGPTWebClient {
    constructor(baseURL = 'http://localhost:5001', token = null) {
        this.baseURL = baseURL;
        this.headers = {
            'Content-Type': 'application/json'
        };
        if (token) {
            this.headers['Authorization'] = `Bearer ${token}`;
        }
    }
    
    async chat(query, conversationId = null) {
        const response = await fetch(`${this.baseURL}/api/chat`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                query,
                conversation_id: conversationId,
                use_database: true
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
    }
    
    async streamChat(query, onContent) {
        const response = await fetch(`${this.baseURL}/api/chat`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                query,
                stream: true
            })
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
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.type === 'content') {
                            onContent(data.content);
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }
    }
}

// 浏览器中使用
const client = new QueryGPTWebClient();

// 普通查询
client.chat('查询销售数据').then(result => {
    console.log('结果:', result);
});

// 流式查询
client.streamChat('生成报告', content => {
    document.getElementById('output').innerHTML += content;
});
```

## cURL

### 基本查询
```bash
# 简单查询
curl -X POST http://localhost:5001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "查询上月销售总额"}'

# 带认证的查询
curl -X POST http://localhost:5001/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"query": "查询上月销售总额", "model": "gpt-4.1"}'

# 带会话ID的查询
curl -X POST http://localhost:5001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "按部门分组",
    "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
    "context_rounds": 5
  }'
```

### 获取配置
```bash
curl -X GET http://localhost:5001/api/config
```

### 执行SQL
```bash
curl -X POST http://localhost:5001/api/execute_sql \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT * FROM sales LIMIT 10"}'
```

### 测试数据库连接
```bash
curl -X POST http://localhost:5001/api/database/test \
  -H "Content-Type: application/json" \
  -d '{
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "password",
    "database": "test_db"
  }'
```

### 获取历史记录
```bash
# 获取最近的对话
curl -X GET "http://localhost:5001/api/history/conversations?limit=10"

# 搜索对话
curl -X GET "http://localhost:5001/api/history/conversations?q=销售&limit=20"

# 获取收藏的对话
curl -X GET "http://localhost:5001/api/history/conversations?favorites=true"
```

### 管理对话
```bash
# 获取对话详情
curl -X GET http://localhost:5001/api/history/conversation/550e8400-e29b-41d4-a716-446655440000

# 切换收藏状态
curl -X POST http://localhost:5001/api/history/conversation/550e8400-e29b-41d4-a716-446655440000/favorite

# 删除对话
curl -X DELETE http://localhost:5001/api/history/conversation/550e8400-e29b-41d4-a716-446655440000
```

## Java

### 使用OkHttp
```java
import okhttp3.*;
import com.google.gson.Gson;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

public class QueryGPTClient {
    private final OkHttpClient client;
    private final String baseUrl;
    private final Gson gson;
    private String token;
    
    public QueryGPTClient(String baseUrl) {
        this.client = new OkHttpClient();
        this.baseUrl = baseUrl;
        this.gson = new Gson();
    }
    
    public void setToken(String token) {
        this.token = token;
    }
    
    public Map<String, Object> chat(String query, String conversationId) throws IOException {
        Map<String, Object> payload = new HashMap<>();
        payload.put("query", query);
        payload.put("use_database", true);
        if (conversationId != null) {
            payload.put("conversation_id", conversationId);
        }
        
        RequestBody body = RequestBody.create(
            gson.toJson(payload),
            MediaType.parse("application/json")
        );
        
        Request.Builder requestBuilder = new Request.Builder()
            .url(baseUrl + "/api/chat")
            .post(body);
            
        if (token != null) {
            requestBuilder.addHeader("Authorization", "Bearer " + token);
        }
        
        try (Response response = client.newCall(requestBuilder.build()).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Unexpected code " + response);
            }
            
            String responseBody = response.body().string();
            return gson.fromJson(responseBody, Map.class);
        }
    }
    
    public static void main(String[] args) {
        try {
            QueryGPTClient client = new QueryGPTClient("http://localhost:5001");
            
            // 执行查询
            Map<String, Object> result = client.chat("查询销售数据", null);
            System.out.println("结果: " + result.get("result"));
            
            // 继续对话
            String conversationId = (String) result.get("conversation_id");
            Map<String, Object> followUp = client.chat("生成图表", conversationId);
            System.out.println("后续结果: " + followUp.get("result"));
            
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

## Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io/ioutil"
    "net/http"
)

type QueryGPTClient struct {
    BaseURL string
    Token   string
    Client  *http.Client
}

type ChatRequest struct {
    Query          string `json:"query"`
    Model          string `json:"model,omitempty"`
    ConversationID string `json:"conversation_id,omitempty"`
    UseDatabase    bool   `json:"use_database"`
    ContextRounds  int    `json:"context_rounds"`
}

type ChatResponse struct {
    Success        bool                   `json:"success"`
    Result         map[string]interface{} `json:"result"`
    Model          string                 `json:"model"`
    ConversationID string                 `json:"conversation_id"`
    Timestamp      string                 `json:"timestamp"`
}

func NewQueryGPTClient(baseURL string) *QueryGPTClient {
    return &QueryGPTClient{
        BaseURL: baseURL,
        Client:  &http.Client{},
    }
}

func (c *QueryGPTClient) Chat(query string, conversationID string) (*ChatResponse, error) {
    request := ChatRequest{
        Query:          query,
        ConversationID: conversationID,
        UseDatabase:    true,
        ContextRounds:  3,
    }
    
    jsonData, err := json.Marshal(request)
    if err != nil {
        return nil, err
    }
    
    req, err := http.NewRequest("POST", c.BaseURL+"/api/chat", bytes.NewBuffer(jsonData))
    if err != nil {
        return nil, err
    }
    
    req.Header.Set("Content-Type", "application/json")
    if c.Token != "" {
        req.Header.Set("Authorization", "Bearer "+c.Token)
    }
    
    resp, err := c.Client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    body, err := ioutil.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }
    
    var response ChatResponse
    err = json.Unmarshal(body, &response)
    if err != nil {
        return nil, err
    }
    
    return &response, nil
}

func main() {
    client := NewQueryGPTClient("http://localhost:5001")
    
    // 执行查询
    response, err := client.Chat("查询销售数据", "")
    if err != nil {
        fmt.Printf("错误: %v\n", err)
        return
    }
    
    fmt.Printf("查询成功: %v\n", response.Result)
    
    // 继续对话
    followUp, err := client.Chat("生成图表", response.ConversationID)
    if err != nil {
        fmt.Printf("错误: %v\n", err)
        return
    }
    
    fmt.Printf("后续查询: %v\n", followUp.Result)
}
```

## C#/.NET

```csharp
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using System.Collections.Generic;

public class QueryGPTClient
{
    private readonly HttpClient httpClient;
    private readonly string baseUrl;
    private string token;

    public QueryGPTClient(string baseUrl = "http://localhost:5001")
    {
        this.baseUrl = baseUrl;
        this.httpClient = new HttpClient();
    }

    public void SetToken(string token)
    {
        this.token = token;
        httpClient.DefaultRequestHeaders.Authorization = 
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
    }

    public async Task<ChatResponse> ChatAsync(string query, string conversationId = null)
    {
        var request = new
        {
            query = query,
            conversation_id = conversationId,
            use_database = true,
            context_rounds = 3
        };

        var json = JsonConvert.SerializeObject(request);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await httpClient.PostAsync($"{baseUrl}/api/chat", content);
        response.EnsureSuccessStatusCode();

        var responseJson = await response.Content.ReadAsStringAsync();
        return JsonConvert.DeserializeObject<ChatResponse>(responseJson);
    }

    public async Task<ConfigResponse> GetConfigAsync()
    {
        var response = await httpClient.GetAsync($"{baseUrl}/api/config");
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        return JsonConvert.DeserializeObject<ConfigResponse>(json);
    }

    public async Task<SqlExecuteResponse> ExecuteSqlAsync(string sql)
    {
        var request = new { query = sql };
        var json = JsonConvert.SerializeObject(request);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await httpClient.PostAsync($"{baseUrl}/api/execute_sql", content);
        response.EnsureSuccessStatusCode();

        var responseJson = await response.Content.ReadAsStringAsync();
        return JsonConvert.DeserializeObject<SqlExecuteResponse>(responseJson);
    }
}

public class ChatResponse
{
    public bool Success { get; set; }
    public Dictionary<string, object> Result { get; set; }
    public string Model { get; set; }
    public string ConversationId { get; set; }
    public DateTime Timestamp { get; set; }
}

public class ConfigResponse
{
    public string ApiKey { get; set; }
    public string ApiBase { get; set; }
    public string DefaultModel { get; set; }
    public DatabaseConfig Database { get; set; }
}

public class DatabaseConfig
{
    public string Host { get; set; }
    public int Port { get; set; }
    public string User { get; set; }
    public string Database { get; set; }
}

public class SqlExecuteResponse
{
    public bool Success { get; set; }
    public List<Dictionary<string, object>> Data { get; set; }
    public int Count { get; set; }
    public DateTime Timestamp { get; set; }
}

// 使用示例
class Program
{
    static async Task Main(string[] args)
    {
        var client = new QueryGPTClient();
        
        try
        {
            // 执行查询
            var result = await client.ChatAsync("查询销售数据");
            Console.WriteLine($"查询成功: {result.Success}");
            Console.WriteLine($"会话ID: {result.ConversationId}");
            
            // 继续对话
            var followUp = await client.ChatAsync("生成图表", result.ConversationId);
            Console.WriteLine($"后续查询: {followUp.Success}");
            
            // 获取配置
            var config = await client.GetConfigAsync();
            Console.WriteLine($"默认模型: {config.DefaultModel}");
            
            // 执行SQL
            var sqlResult = await client.ExecuteSqlAsync("SELECT COUNT(*) FROM sales");
            Console.WriteLine($"记录数: {sqlResult.Count}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"错误: {ex.Message}");
        }
    }
}
```

## 错误处理

所有语言的客户端都应该处理以下常见错误：

### HTTP状态码
- `200`: 成功
- `400`: 请求参数错误
- `401`: 认证失败
- `403`: 禁止访问（如尝试执行写操作）
- `404`: 资源不存在
- `429`: 超过速率限制
- `500`: 服务器内部错误

### 错误响应格式
```json
{
  "success": false,
  "error": "错误描述信息"
}
```

### 重试策略
建议实现指数退避重试策略：
```python
import time
import random

def retry_with_backoff(func, max_retries=3):
    for i in range(max_retries):
        try:
            return func()
        except Exception as e:
            if i == max_retries - 1:
                raise
            
            wait_time = (2 ** i) + random.uniform(0, 1)
            time.sleep(wait_time)
```

## 最佳实践

1. **连接池**: 使用HTTP连接池以提高性能
2. **超时设置**: 设置合理的请求超时（建议30秒）
3. **错误处理**: 实现完善的错误处理和重试机制
4. **日志记录**: 记录所有API调用和响应
5. **会话管理**: 保存conversation_id以维持上下文
6. **速率限制**: 客户端实现速率限制以避免429错误
7. **流式处理**: 对大量数据使用流式响应
8. **缓存**: 缓存配置和模型列表等不常变化的数据