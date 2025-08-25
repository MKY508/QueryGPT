# Windows WSL 安装指南

## 前提条件

1. **安装 WSL2**（如果还没有）
   ```powershell
   # 在 PowerShell（管理员）中运行
   wsl --install
   ```

2. **安装 Ubuntu**
   ```powershell
   wsl --install -d Ubuntu
   ```

## 快速开始

### 1. 克隆项目
```bash
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT
```

### 2. 修复脚本格式（重要！）
Windows 的换行符可能导致脚本无法运行：
```bash
# 安装 dos2unix（如果没有）
sudo apt-get update
sudo apt-get install dos2unix

# 转换所有脚本为 Unix 格式
dos2unix *.sh

# 或者使用 sed
sed -i 's/\r$//' *.sh

# 添加执行权限
chmod +x *.sh
```

### 3. 运行诊断工具
先检查环境是否正确配置：
```bash
./diagnose.sh
```

### 4. 安装 Python 3.10（如果需要）
```bash
# 检查当前 Python 版本
python3 --version

# 如果不是 3.10.x，安装它
sudo apt update
sudo apt install python3.10 python3.10-venv python3.10-dev
```

### 5. 首次运行 - 使用 Windows 专用脚本
```bash
./start_windows.sh
```

这个脚本会：
- 自动创建虚拟环境（如果不存在）
- 安装必要的依赖
- 配置环境变量
- 启动服务

### 6. 后续运行
```bash
# 快速启动
./quick_start.sh

# 或使用 Windows 专用版本
./start_windows.sh
```

## 常见问题

### 问题 1: 脚本运行出错 "bad interpreter"
**原因**: Windows 换行符问题
**解决**:
```bash
dos2unix *.sh
# 或
sed -i 's/\r$//' *.sh
```

### 问题 2: 端口检测失败
**原因**: WSL 缺少网络工具
**解决**:
```bash
sudo apt-get install net-tools
```

### 问题 3: Python 包安装失败
**原因**: 缺少开发工具
**解决**:
```bash
sudo apt-get install python3-pip python3-dev build-essential
```

### 问题 4: 无法访问 localhost:5000
**原因**: Windows 防火墙或 WSL 网络问题
**解决**:
1. 检查 Windows 防火墙设置
2. 尝试访问 WSL 的 IP：
   ```bash
   # 获取 WSL IP
   ip addr show eth0 | grep inet | awk '{print $2}' | cut -d/ -f1
   ```
3. 使用该 IP 访问，如：`http://172.x.x.x:5000`

### 问题 5: OpenInterpreter 安装失败
**原因**: Python 版本不兼容
**解决**: 必须使用 Python 3.10.x
```bash
python3.10 -m venv venv_py310
source venv_py310/bin/activate
pip install open-interpreter==0.4.3
```

## 配置文件

### 1. 配置 API
编辑 `.env` 文件：
```bash
nano .env
```

修改以下内容：
```
API_KEY=你的API密钥
API_BASE_URL=https://api.vveai.com/v1/
DEFAULT_MODEL=gpt-4.1
```

### 2. 配置数据库
如果需要连接数据库，修改：
```
DB_HOST=你的数据库地址
DB_PORT=3306
DB_USER=你的用户名
DB_PASSWORD=你的密码
DB_DATABASE=数据库名
```

## 推荐工具

1. **Windows Terminal**: 更好的终端体验
2. **VSCode with WSL Extension**: 在 Windows 中编辑 WSL 文件
3. **Docker Desktop for Windows**: 如果需要容器化部署

## 获取帮助

如果仍有问题：
1. 运行诊断工具：`./diagnose.sh`
2. 查看错误日志：`cat logs/app.log`
3. 提交 Issue：https://github.com/MKY508/QueryGPT/issues