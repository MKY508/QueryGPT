# FAQ / 常见问题解答

## 1. Installation / 安装相关问题

### Q: What are the system requirements for QueryGPT? / QueryGPT的系统要求是什么？
**A:** 
- Python 3.8+ (Python 3.10 recommended for OpenInterpreter integration)
- 4GB RAM minimum, 8GB recommended
- MySQL 5.7+ or compatible database
- Modern web browser (Chrome, Firefox, Safari, Edge)

**解答：**
- Python 3.8+（推荐Python 3.10用于OpenInterpreter集成）
- 最少4GB内存，推荐8GB
- MySQL 5.7+或兼容数据库
- 现代浏览器（Chrome、Firefox、Safari、Edge）

**Related Links / 相关链接:**
- [Installation Guide / 安装指南](./installation.md)
- [Python Downloads](https://www.python.org/downloads/)

### Q: How do I install dependencies? / 如何安装依赖？
**A:**
```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

**解答：**
```bash
# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Windows系统: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt
```

**Related Links / 相关链接:**
- [requirements.txt](../requirements.txt)
- [Virtual Environment Guide / 虚拟环境指南](https://docs.python.org/3/tutorial/venv.html)

### Q: Installation fails with permission errors / 安装时出现权限错误
**A:** 
- On Linux/Mac: Use `sudo` for system-wide installation or use virtual environment (recommended)
- On Windows: Run command prompt as Administrator or use virtual environment
- Always prefer virtual environment to avoid system conflicts

**解答：**
- Linux/Mac系统：使用`sudo`进行系统级安装或使用虚拟环境（推荐）
- Windows系统：以管理员身份运行命令提示符或使用虚拟环境
- 始终建议使用虚拟环境以避免系统冲突

## 2. Configuration / 配置相关问题

### Q: How do I configure the database connection? / 如何配置数据库连接？
**A:** 
Edit the `.env` file in the project root:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=your_database
```

**解答：**
编辑项目根目录的`.env`文件：
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=你的用户名
DB_PASSWORD=你的密码
DB_NAME=你的数据库名
```

**Related Links / 相关链接:**
- [Configuration Guide / 配置指南](./configuration.md)
- [Environment Variables / 环境变量说明](./.env.example)

### Q: How do I configure the OpenAI API? / 如何配置OpenAI API？
**A:**
Add to your `.env` file:
```env
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1  # Optional: for custom endpoints
OPENAI_MODEL=gpt-3.5-turbo  # Optional: default model
```

**解答：**
在`.env`文件中添加：
```env
OPENAI_API_KEY=你的API密钥
OPENAI_BASE_URL=https://api.openai.com/v1  # 可选：自定义端点
OPENAI_MODEL=gpt-3.5-turbo  # 可选：默认模型
```

**Related Links / 相关链接:**
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [API Key Management / API密钥管理](https://platform.openai.com/api-keys)

### Q: Where are the configuration files located? / 配置文件在哪里？
**A:**
- Main configuration: `config/config.json`
- Environment variables: `.env`
- Database schema: `config/schema.json`
- Logging configuration: `config/logging.json`

**解答：**
- 主配置文件：`config/config.json`
- 环境变量：`.env`
- 数据库模式：`config/schema.json`
- 日志配置：`config/logging.json`

## 3. Usage / 使用相关问题

### Q: How do I start the application? / 如何启动应用？
**A:**
```bash
# Quick start
python app.py

# With monitoring
python app.py --monitor

# Production mode
python app.py --production
```

**解答：**
```bash
# 快速启动
python app.py

# 带监控启动
python app.py --monitor

# 生产模式
python app.py --production
```

**Related Links / 相关链接:**
- [User Guide / 用户指南](./user-guide.md)
- [CLI Options / 命令行选项](./cli-reference.md)

### Q: How do I query data using natural language? / 如何使用自然语言查询数据？
**A:**
1. Open the web interface at `http://localhost:5000`
2. Type your question in natural language (e.g., "Show me last month's sales")
3. The system will convert it to SQL and execute the query
4. Results will be displayed in table or chart format

**解答：**
1. 打开Web界面 `http://localhost:5000`
2. 输入自然语言问题（例如："显示上个月的销售数据"）
3. 系统将转换为SQL并执行查询
4. 结果将以表格或图表形式显示

### Q: What query formats are supported? / 支持哪些查询格式？
**A:**
- Natural language questions in English or Chinese
- Direct SQL queries (in developer mode)
- Template-based queries
- Multi-step analytical questions

**解答：**
- 中英文自然语言问题
- 直接SQL查询（开发者模式）
- 基于模板的查询
- 多步骤分析问题

## 4. Troubleshooting / 错误排查

### Q: Database connection fails / 数据库连接失败
**A:**
Common causes and solutions:
1. Check database server is running: `sudo service mysql status`
2. Verify credentials in `.env` file
3. Check firewall settings allow connection on port 3306
4. Test connection: `mysql -h localhost -u username -p`

**解答：**
常见原因和解决方案：
1. 检查数据库服务器是否运行：`sudo service mysql status`
2. 验证`.env`文件中的凭据
3. 检查防火墙设置是否允许3306端口连接
4. 测试连接：`mysql -h localhost -u username -p`

**Related Links / 相关链接:**
- [Database Setup / 数据库设置](./database-setup.md)
- [Connection Troubleshooting / 连接故障排除](./troubleshooting.md#database)

### Q: "No module named 'xxx'" error / "没有名为'xxx'的模块"错误
**A:**
```bash
# Ensure virtual environment is activated
source venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt

# For specific module
pip install module_name
```

**解答：**
```bash
# 确保虚拟环境已激活
source venv/bin/activate

# 重新安装依赖
pip install -r requirements.txt

# 安装特定模块
pip install 模块名
```

### Q: Application crashes or freezes / 应用崩溃或卡死
**A:**
1. Check logs in `logs/` directory
2. Increase memory allocation if needed
3. Check for database locks: `SHOW PROCESSLIST;`
4. Restart with debug mode: `python app.py --debug`

**解答：**
1. 检查`logs/`目录中的日志
2. 如需要，增加内存分配
3. 检查数据库锁：`SHOW PROCESSLIST;`
4. 以调试模式重启：`python app.py --debug`

## 5. Performance Optimization / 性能优化

### Q: How to improve query performance? / 如何提高查询性能？
**A:**
1. Enable query caching in `config/config.json`
2. Add database indexes for frequently queried columns
3. Use connection pooling (enabled by default)
4. Optimize SQL queries using EXPLAIN

**解答：**
1. 在`config/config.json`中启用查询缓存
2. 为常查询列添加数据库索引
3. 使用连接池（默认启用）
4. 使用EXPLAIN优化SQL查询

**Related Links / 相关链接:**
- [Performance Tuning / 性能调优](./performance.md)
- [Caching Strategy / 缓存策略](./architecture.md#caching)

### Q: Application is slow to respond / 应用响应缓慢
**A:**
- Check CPU and memory usage: `top` or `htop`
- Review slow query log in MySQL
- Increase cache size in configuration
- Consider using CDN for static assets

**解答：**
- 检查CPU和内存使用：`top`或`htop`
- 查看MySQL慢查询日志
- 在配置中增加缓存大小
- 考虑为静态资源使用CDN

### Q: How to handle large datasets? / 如何处理大数据集？
**A:**
- Enable pagination in query results
- Use streaming responses for large exports
- Implement data sampling for visualizations
- Consider data warehousing solutions

**解答：**
- 在查询结果中启用分页
- 对大量导出使用流式响应
- 为可视化实现数据采样
- 考虑数据仓库解决方案

## 6. Multi-language Support / 多语言支持

### Q: What languages are supported? / 支持哪些语言？
**A:**
- User interface: English, Chinese (Simplified)
- Query languages: English, Chinese
- Database content: UTF-8 encoding supports all languages

**解答：**
- 用户界面：英语、简体中文
- 查询语言：英语、中文
- 数据库内容：UTF-8编码支持所有语言

### Q: How to switch interface language? / 如何切换界面语言？
**A:**
1. Click settings icon in top-right corner
2. Select "Language" or "语言"
3. Choose preferred language
4. Page will reload with new language

**解答：**
1. 点击右上角设置图标
2. 选择"Language"或"语言"
3. 选择偏好语言
4. 页面将以新语言重新加载

### Q: Chinese characters display as "???" / 中文字符显示为"???"
**A:**
- Ensure database charset is UTF-8: `ALTER DATABASE dbname CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
- Check connection encoding in `.env`: `DB_CHARSET=utf8mb4`
- Verify browser encoding settings

**解答：**
- 确保数据库字符集为UTF-8：`ALTER DATABASE dbname CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
- 检查`.env`中的连接编码：`DB_CHARSET=utf8mb4`
- 验证浏览器编码设置

## 7. API Usage / API使用

### Q: How to use the REST API? / 如何使用REST API？
**A:**
```python
import requests

# Query endpoint
response = requests.post('http://localhost:5000/api/query', 
    json={'query': 'Show sales for last month'},
    headers={'Authorization': 'Bearer YOUR_TOKEN'})

data = response.json()
```

**解答：**
```python
import requests

# 查询端点
response = requests.post('http://localhost:5000/api/query', 
    json={'query': '显示上个月销售'},
    headers={'Authorization': 'Bearer YOUR_TOKEN'})

data = response.json()
```

**Related Links / 相关链接:**
- [API Documentation / API文档](./api-reference.md)
- [Authentication Guide / 认证指南](./authentication.md)

### Q: What are the API rate limits? / API速率限制是什么？
**A:**
- Default: 100 requests per minute per IP
- Authenticated users: 1000 requests per minute
- Configurable in `config/config.json`

**解答：**
- 默认：每IP每分钟100个请求
- 认证用户：每分钟1000个请求
- 可在`config/config.json`中配置

### Q: How to handle API errors? / 如何处理API错误？
**A:**
```python
try:
    response = requests.post(url, json=data)
    response.raise_for_status()
except requests.exceptions.HTTPError as e:
    if e.response.status_code == 429:
        # Rate limited, wait and retry
        time.sleep(60)
    elif e.response.status_code == 401:
        # Unauthorized, refresh token
        refresh_token()
```

**解答：**
```python
try:
    response = requests.post(url, json=data)
    response.raise_for_status()
except requests.exceptions.HTTPError as e:
    if e.response.status_code == 429:
        # 速率限制，等待并重试
        time.sleep(60)
    elif e.response.status_code == 401:
        # 未授权，刷新令牌
        refresh_token()
```

## 8. Database Connection / 数据库连接

### Q: Which databases are supported? / 支持哪些数据库？
**A:**
- MySQL 5.7+
- MariaDB 10.2+
- PostgreSQL 12+ (with adapter)
- SQLite (for development only)

**解答：**
- MySQL 5.7+
- MariaDB 10.2+
- PostgreSQL 12+（需要适配器）
- SQLite（仅用于开发）

**Related Links / 相关链接:**
- [Database Compatibility / 数据库兼容性](./databases.md)
- [Migration Guide / 迁移指南](./migration.md)

### Q: How to connect to remote database? / 如何连接远程数据库？
**A:**
1. Update `.env` with remote host:
```env
DB_HOST=remote.server.com
DB_PORT=3306
DB_SSL=true  # Enable SSL for security
```
2. Ensure firewall allows connection
3. Grant remote access in MySQL: `GRANT ALL ON db.* TO 'user'@'%';`

**解答：**
1. 在`.env`中更新远程主机：
```env
DB_HOST=remote.server.com
DB_PORT=3306
DB_SSL=true  # 启用SSL以确保安全
```
2. 确保防火墙允许连接
3. 在MySQL中授予远程访问：`GRANT ALL ON db.* TO 'user'@'%';`

### Q: Connection pool exhausted error / 连接池耗尽错误
**A:**
- Increase pool size in configuration: `"db_pool_size": 20`
- Check for connection leaks in custom code
- Monitor active connections: `SHOW PROCESSLIST;`
- Enable connection recycling: `"db_pool_recycle": 3600`

**解答：**
- 在配置中增加池大小：`"db_pool_size": 20`
- 检查自定义代码中的连接泄漏
- 监控活动连接：`SHOW PROCESSLIST;`
- 启用连接回收：`"db_pool_recycle": 3600`

## 9. Docker Deployment / Docker部署

### Q: How to run with Docker? / 如何使用Docker运行？
**A:**
```bash
# Build image
docker build -t querygpt .

# Run container
docker run -d -p 5000:5000 \
  -e DB_HOST=host.docker.internal \
  -e OPENAI_API_KEY=your_key \
  querygpt
```

**解答：**
```bash
# 构建镜像
docker build -t querygpt .

# 运行容器
docker run -d -p 5000:5000 \
  -e DB_HOST=host.docker.internal \
  -e OPENAI_API_KEY=your_key \
  querygpt
```

**Related Links / 相关链接:**
- [Docker Documentation / Docker文档](https://docs.docker.com/)
- [Deployment Guide / 部署指南](./deployment.md)

### Q: How to use Docker Compose? / 如何使用Docker Compose？
**A:**
```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      - DB_HOST=db
    depends_on:
      - db
  db:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=password
```

Run with: `docker-compose up -d`

**解答：**
```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      - DB_HOST=db
    depends_on:
      - db
  db:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=password
```

运行：`docker-compose up -d`

### Q: Container can't connect to host database / 容器无法连接主机数据库
**A:**
- Use `host.docker.internal` instead of `localhost` on Mac/Windows
- On Linux, use `--network=host` or host IP address
- Ensure database allows connections from Docker network

**解答：**
- 在Mac/Windows上使用`host.docker.internal`替代`localhost`
- 在Linux上，使用`--network=host`或主机IP地址
- 确保数据库允许来自Docker网络的连接

## 10. Contributing / 贡献相关

### Q: How can I contribute? / 如何贡献？
**A:**
1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Make changes and test thoroughly
4. Commit with clear message: `git commit -m "Add feature: description"`
5. Push and create Pull Request

**解答：**
1. Fork仓库
2. 创建功能分支：`git checkout -b feature-name`
3. 进行更改并充分测试
4. 提交清晰的消息：`git commit -m "Add feature: description"`
5. 推送并创建Pull Request

**Related Links / 相关链接:**
- [Contributing Guide / 贡献指南](../CONTRIBUTING.md)
- [Code of Conduct / 行为准则](../CODE_OF_CONDUCT.md)

### Q: What are the coding standards? / 编码标准是什么？
**A:**
- Python: Follow PEP 8, use Black formatter
- JavaScript: ESLint with provided configuration
- Commits: Conventional Commits format
- Tests: Minimum 80% coverage required

**解答：**
- Python：遵循PEP 8，使用Black格式化
- JavaScript：使用提供配置的ESLint
- 提交：常规提交格式
- 测试：需要最少80%覆盖率

### Q: How to report bugs? / 如何报告错误？
**A:**
1. Check existing issues first
2. Create new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - System information
   - Error logs if available

**解答：**
1. 首先检查现有问题
2. 创建新问题包含：
   - 清晰的标题和描述
   - 重现步骤
   - 预期与实际行为
   - 系统信息
   - 可用的错误日志

**Related Links / 相关链接:**
- [Issue Template / 问题模板](.github/ISSUE_TEMPLATE.md)
- [Bug Reports / 错误报告](https://github.com/yourusername/QueryGPT/issues)

---

## Additional Resources / 其他资源

- [Official Documentation / 官方文档](./index.md)
- [Video Tutorials / 视频教程](https://youtube.com/querygpt)
- [Community Forum / 社区论坛](https://forum.querygpt.com)
- [Stack Overflow Tag](https://stackoverflow.com/questions/tagged/querygpt)
- [微信群 / WeChat Group](./wechat-group.md)

## Need More Help? / 需要更多帮助？

If your question isn't answered here:
1. Search the [documentation](./index.md)
2. Check [GitHub Issues](https://github.com/yourusername/QueryGPT/issues)
3. Join our [Discord server](https://discord.gg/querygpt)
4. Contact support: support@querygpt.com

如果您的问题未在此处解答：
1. 搜索[文档](./index.md)
2. 查看[GitHub Issues](https://github.com/yourusername/QueryGPT/issues)
3. 加入我们的[Discord服务器](https://discord.gg/querygpt)
4. 联系支持：support@querygpt.com