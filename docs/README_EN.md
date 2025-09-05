<div align="center">
  
  <img src="images/logo.png" width="400" alt="QueryGPT">
  
  <br/>
  
  <p>
    <a href="../README.md">简体中文</a> •
    <a href="#">English</a> •
    <a href="README/README_ZH-TW.md">繁體中文</a> •
    <a href="README/README_JA.md">日本語</a> •
    <a href="README/README_ES.md">Español</a> •
    <a href="README/README_FR.md">Français</a> •
    <a href="README_DE.md">Deutsch</a> •
    <a href="README/README_RU.md">Русский</a> •
    <a href="README/README_PT.md">Português</a> •
    <a href="README/README_KO.md">한국어</a>
  </p>
  
  <br/>
  
  [![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](../LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.10+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![OpenInterpreter](https://img.shields.io/badge/OpenInterpreter-0.4.3-green.svg?style=for-the-badge)](https://github.com/OpenInterpreter/open-interpreter)
  [![Stars](https://img.shields.io/github/stars/MKY508/QueryGPT?style=for-the-badge&color=yellow)](https://github.com/MKY508/QueryGPT/stargazers)
  
  <br/>
  
  <h3>An intelligent data analysis Agent based on OpenInterpreter</h3>
  <p><i>Chat with your database in natural language</i></p>
  
</div>

<br/>

---

## ✨ Core Advantages

**Think Like a Data Analyst**
- **Autonomous Exploration**: Proactively examines table structures and sample data when encountering issues
- **Multi-round Validation**: Re-checks when anomalies are found to ensure accurate results
- **Complex Analysis**: Not just SQL, can execute Python for statistical analysis and machine learning
- **Visible Thinking**: Real-time display of Agent's reasoning process (Chain-of-Thought)

## 📸 System Screenshots

<table>
  <tr>
    <td align="center">
      <img src="images/agent-thinking-en.png" width="100%" alt="QueryGPT Interface"/>
      <b>Real-time AI Thinking Process</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="images/data-visualization-en.png" width="100%" alt="Data Visualization"/>
      <b>Interactive Data Visualization</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="images/developer-view-en.png" width="100%" alt="Developer View"/>
      <b>Transparent Code Execution</b>
    </td>
  </tr>
</table>

## 🌟 Key Features

### Agent Core Capabilities
- **Autonomous Data Exploration**: Agent proactively understands data structure and explores relationships
- **Multi-round Reasoning**: Like an analyst, investigates deeply when issues arise
- **Chain-of-Thought**: Real-time display of Agent's thinking process, intervention possible anytime
- **Context Memory**: Understands conversation history, supports continuous multi-round analysis

### Data Analysis Capabilities
- **SQL + Python**: Not limited to SQL, can execute complex Python data processing
- **Statistical Analysis**: Automatic correlation analysis, trend prediction, anomaly detection
- **Chinese Business Terms**: Native understanding of YoY, MoM, retention, repurchase concepts
- **Smart Visualization**: Automatically selects best chart type based on data characteristics

### System Features
- **Multi-model Support**: Switch freely between GPT-5, Claude, Gemini, Ollama local models
- **Flexible Deployment**: Supports cloud API or Ollama local deployment, data never leaves premises
- **History Records**: Saves analysis process, supports backtracking and sharing
- **Data Security**: Read-only permissions, SQL injection protection, sensitive data masking
- **Flexible Export**: Supports Excel, PDF, HTML and other formats

## 📦 Technical Requirements

- Python 3.10.x (Required, OpenInterpreter 0.4.3 dependency)
- MySQL or compatible database

> Windows: Run inside WSL (do not run scripts from PowerShell/CMD).

<br/>

## 📊 Product Comparison

| Comparison | **QueryGPT** | Vanna AI | DB-GPT | TableGPT | Text2SQL.AI |
|------------|:------------:|:--------:|:------:|:--------:|:-----------:|
| **Cost** | **✅ Free** | ⭕ Has paid version | ✅ Free | ❌ Paid | ❌ Paid |
| **Open Source** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **Local Deployment** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **Execute Python Code** | **✅ Full environment** | ❌ | ❌ | ❌ | ❌ |
| **Visualization** | **✅ Programmable** | ⭕ Preset charts | ✅ Rich charts | ✅ Rich charts | ⭕ Basic |
| **Chinese Business Understanding** | **✅ Native** | ⭕ Basic | ✅ Good | ✅ Excellent | ⭕ Basic |
| **Agent Autonomous Exploration** | **✅** | ❌ | ⭕ Basic | ⭕ Basic | ❌ |
| **Real-time Thinking Display** | **✅** | ❌ | ❌ | ❌ | ❌ |
| **Extensibility** | **✅ Unlimited** | ❌ | ❌ | ❌ | ❌ |

### Our Core Differences
- **Complete Python Environment**: Not preset features, but a real Python execution environment where you can write any code
- **Unlimited Extensibility**: Need new features? Just install new libraries, no need to wait for product updates
- **Agent Autonomous Exploration**: Proactively investigates when encountering issues, not just simple one-time queries
- **Transparent Thinking Process**: See what AI is thinking in real-time, can intervene and guide anytime
- **Truly Free and Open Source**: MIT license, no paywalls

## 🚀 Quick Start

### Environment Requirements
```bash
# Python 3.10.x (Required)
python --version  # Should show 3.10.x

# MySQL or compatible database
mysql --version
```

### Installation Steps

#### 1. Clone the Project
```bash
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT
```

#### 2. Install Dependencies
```bash
# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or
venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt
```

#### 3. Configure System

Create `.env` file:
```bash
# LLM API Configuration (choose one)
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1  # Or other compatible API

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=your_database  # Optional, leave empty for cross-database queries
```

#### 4. Start System
```bash
# Start the system
./start.sh

# Or manual start
python backend/app.py
```

Visit `http://localhost:5000` to start using!

<!-- Docker deployment is currently not maintained for this project. -->

## 💡 Usage Examples

### Basic Queries
- "Show sales data for the last month"
- "Analyze sales distribution by product category"
- "Find top 10 customers by sales amount"

### Advanced Analysis
- "Compare this year's sales growth with the same period last year"
- "Predict next quarter's sales trend"
- "Find anomalous order data"
- "Analyze customer purchasing behavior patterns"

### Complex Tasks
- "Generate monthly sales report with MoM, YoY and trend charts"
- "Analyze customer churn reasons and provide recommendations"
- "Build RFM customer segmentation model"

## 🔧 Configuration

### Supported Models (Choose a powerful model for best results)
- **OpenAI**: GPT-5, GPT-4.1 (economical)
- **Anthropic**: Claude 4 Opus, Sonnet (highest rated, most intelligent, frequent tool use)
- **Google**: Gemini 2.5 Pro (may have litellm compatibility issues)
- **Domestic Models**: Qwen, DeepSeek (including thinking models, but not recommended)
- **Local Models**: via Ollama - Llama, Mistral, Qwen etc. (baseline: qwen2.5 7b+, otherwise insufficient for agent processes)

### Database Support
- MySQL 5.7+
- MariaDB 10.3+
- TiDB
- OceanBase
- Other MySQL protocol compatible databases

## 📚 Documentation

- [Full Documentation](.)
- [API Documentation](API.md)
- [Deployment Guide](DEPLOYMENT.md)
- [FAQ](FAQ.md)
- [Configuration Guide](CONFIGURATION.md)

## 🤝 Contributing

Issues and Pull Requests are welcome!

## 📄 License

MIT License - see [LICENSE](../LICENSE) for details

## 🆕 Latest Updates

- 2025-09-05 – Startup speed optimization: removed first-visit model auto test to reduce initial requests and avoid unintended state changes.

## 🙏 Acknowledgments

- [OpenInterpreter](https://github.com/OpenInterpreter/open-interpreter) - Core AI engine
- [Flask](https://flask.palletsprojects.com/) - Web framework
- [Plotly](https://plotly.com/) - Data visualization

## 📧 Contact

- GitHub Issues: [Submit Issues](https://github.com/MKY508/QueryGPT/issues)
- Email: mky369258@gmail.com

## ⭐ Star History

<div align="center">
  <a href="https://star-history.com/#MKY508/QueryGPT&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date" />
    </picture>
  </a>
</div>

---

<div align="center">
  <sub>If you find this useful, please give it a ⭐ Star!</sub>
</div>
