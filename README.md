# QueryGPT

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![OpenInterpreter](https://img.shields.io/badge/OpenInterpreter-0.4.3-green.svg)](https://github.com/OpenInterpreter/open-interpreter)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![中文支持](https://img.shields.io/badge/中文-支持-red.svg)](README.md)
[![Awesome](https://awesome.re/badge.svg)](https://github.com/1c7/chinese-independent-developer)
[![收录于中国独立开发者项目列表](https://img.shields.io/badge/收录于-中国独立开发者项目列表-red.svg)](https://github.com/1c7/chinese-independent-developer)
![Stars](https://img.shields.io/github/stars/MKY508/QueryGPT?style=flat-square&color=brightgreen)
![Forks](https://img.shields.io/github/forks/MKY508/QueryGPT?style=flat-square&color=brightgreen)
![Issues](https://img.shields.io/github/issues/MKY508/QueryGPT?style=flat-square)

像聊天一样查询数据库 - LLM for Database | 中文数据分析助手

直接用中文问："上个月卖得最好的产品是什么？" "哪些客户消费最多？" 不用写SQL，秒出数据和图表。支持复杂分析，比Chatbi更懂你的数据库。

## 系统截图

<table>
  <tr>
    <td align="center">
      <img src="docs/images/main-interface.png" alt="主界面" width="100%"/>
      <br/>
      <b>主界面</b>
      <br/>
      <sub>智能数据查询与分析平台</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/data-visualization.png" alt="数据可视化" width="100%"/>
      <br/>
      <b>数据可视化分析</b>
      <br/>
      <sub>对复杂任务的精准执行</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/developer-view.png" alt="开发者视图" width="100%"/>
      <br/>
      <b>开发者视图</b>
      <br/>
      <sub>代码执行与调试信息展示</sub>
    </td>
  </tr>
</table>

## 功能特性

- **自然语言查询**: 使用自然语言（中文/英文）查询数据库
- **SQL 生成**: 将自然语言转换为 SQL 查询语句
- **数据可视化**: 自动生成交互式图表展示查询结果
- **数据导出**: 支持将分析结果导出为 PNG、HTML 等格式
- **历史记录**: 保存和管理所有查询历史
- **安全防护**: SQL 注入防护，只读查询限制

## 技术要求

- Python 3.10.x（必需，OpenInterpreter 0.4.3 依赖）
- MySQL 或兼容数据库

## 快速开始（懒人模式）

### 首次使用

```bash
# 1. 克隆项目
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# 2. 运行安装脚本（自动配置环境）
./setup.sh

# 3. 启动服务
./start.sh
```

### 后续使用

```bash
# 直接快速启动
./quick_start.sh
```

服务默认运行在 http://localhost:5000

> **注意**: 如果端口 5000 被占用（如 macOS 的 AirPlay），系统会自动选择下一个可用端口（5001-5010），并在启动时显示实际使用的端口。

## 项目结构

```
QueryGPT/
├── backend/              # 后端服务
│   ├── app.py           # Flask 应用主入口
│   ├── database.py      # 数据库连接管理
│   ├── interpreter_manager.py  # 查询解释器
│   ├── history_manager.py      # 历史记录管理
│   └── config_loader.py        # 配置加载器
├── frontend/            # 前端界面
│   ├── templates/       # HTML 模板
│   └── static/          # 静态资源
│       ├── css/         # 样式文件
│       └── js/          # JavaScript
├── docs/                # 项目文档
├── logs/                # 日志目录
├── output/              # 输出文件
├── requirements.txt     # Python 依赖
└── .env.example        # 配置示例
```

## API 接口

### 查询接口

```http
POST /api/chat
Content-Type: application/json

{
  "message": "查询本月销售总额",
  "model": "default"
}
```

### 历史记录

```http
GET /api/history/conversations    # 获取历史列表
GET /api/history/conversation/:id # 获取详情
DELETE /api/history/conversation/:id # 删除记录
```

### 健康检查

```http
GET /api/health
```

## 使用示例

1. **基础查询**
   - "显示所有产品信息"
   - "查询销售额大于1000的订单"

2. **聚合查询**
   - "统计每个部门的员工数量"
   - "计算本月销售总额"

3. **复杂查询**
   - "找出销售额最高的前10个客户"
   - "对比上月和本月的销售数据"

## 安全说明

- 仅支持只读查询（SELECT, SHOW, DESCRIBE）
- 自动过滤危险 SQL 语句
- 数据库用户应配置为只读权限

## 故障排除

### 数据库连接失败

1. 检查数据库服务是否运行
2. 验证连接参数是否正确
3. 确认防火墙设置

### 依赖安装失败

```bash
# 升级 pip
pip install --upgrade pip

# 清理缓存
pip cache purge

# 重新安装
pip install -r requirements.txt --no-cache-dir
```

## 开发

### 运行测试

```bash
pytest tests/
```

### 代码规范

```bash
# Python 代码格式化
black backend/

# 代码检查
pylint backend/
```

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 作者

- **作者**: Mao Kaiyue
- **GitHub**: [@MKY508](https://github.com/MKY508)
- **创建时间**: 2025年8月

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date)](https://star-history.com/#MKY508/QueryGPT&Date)

## 项目统计

![GitHub contributors](https://img.shields.io/github/contributors/MKY508/QueryGPT)
![GitHub last commit](https://img.shields.io/github/last-commit/MKY508/QueryGPT)

## 贡献

欢迎提交 Issue 和 Pull Request。

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

---

## ⭐ 支持项目

如果 QueryGPT 对你有帮助，请考虑给这个项目一个 **Star**！

你的支持是我持续改进的动力 💪

---

## 关键词 / Keywords

`自然语言查询` `Natural Language to SQL` `Text to SQL` `数据分析` `Data Analytics` `ChatGPT` `OpenInterpreter` `中文数据库查询` `AI数据分析` `智能BI` `数据可视化` `Business Intelligence` `MySQL` `PostgreSQL` `Python` `Flask` `数据挖掘` `RFM分析` `用户画像` `销售分析` `no-code` `low-code` `chat with database` `conversational AI` `数据库对话` `SQL生成器` `query builder`

---

**QueryGPT** © 2025 Mao Kaiyue. MIT License.
