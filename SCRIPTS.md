# 脚本说明文档

## 脚本关系图

```
用户
 │
 ├─ 运行 ./start.sh （智能启动器）
 │   │
 │   ├─ 首次运行？
 │   │   ├─ 是 → 调用 setup.sh 或 setup_arm.sh
 │   │   │       （完成安装 + 启动服务）
 │   │   │
 │   │   └─ 否 → 调用 quick_start.sh
 │   │           （快速启动服务）
 │   │
 │   └─ Windows WSL？→ 自动修复换行符
 │
 └─ 或直接运行
     ├─ setup.sh         # 标准安装（x86）+ 启动
     ├─ setup_arm.sh     # ARM 安装 + 启动
     └─ quick_start.sh   # 快速启动（已安装）
```

## 核心脚本说明

### 🎯 start.sh - 智能启动器
- **功能**：自动检测环境，选择合适的脚本
- **适用**：所有用户，不知道该用哪个脚本时
- **特点**：
  - 检测是否首次运行
  - 自动识别 ARM/x86 架构
  - Windows WSL 自动修复
  - 智能路由到正确脚本

### 📦 setup.sh - 完整安装脚本
- **功能**：环境配置 + 依赖安装 + 启动服务
- **适用**：x86_64 架构（Intel/AMD）
- **时间**：3-10 分钟
- **特点**：
  - 检测 Python 版本
  - 创建虚拟环境
  - 安装所有依赖
  - 配置文件初始化
  - 完成后自动启动

### 🔧 setup_arm.sh - ARM 安装脚本  
- **功能**：ARM 特殊处理 + 安装 + 启动
- **适用**：ARM 架构（Apple M1/M2/M3、树莓派）
- **时间**：10-30 分钟（需要编译）
- **特点**：
  - NumPy/Pandas 源码编译
  - 处理 Rust 依赖
  - Apple Silicon 优化

### ⚡ quick_start.sh - 快速启动
- **功能**：快速启动已安装的服务
- **适用**：已完成安装的用户
- **时间**：秒级启动
- **特点**：
  - 激活虚拟环境
  - 端口自动检测
  - 配置文件检查
  - 直接启动服务

## Windows 专用脚本

### 🪟 start_windows.sh
- **功能**：Windows WSL 专用启动
- **特点**：
  - 处理 WSL 特殊问题
  - 使用 netstat 代替 lsof
  - 调用 Windows 浏览器

## 诊断工具

### 🔍 diagnose.sh
- **功能**：环境问题诊断
- **输出**：
  - Python 版本检查
  - 虚拟环境状态
  - 配置文件检查
  - 端口工具可用性

### 🏗️ check_arch.sh
- **功能**：架构兼容性检查
- **输出**：
  - 系统架构信息
  - 库兼容性状态
  - 安装建议

### 🧪 test_windows.sh
- **功能**：Windows WSL 测试
- **输出**：
  - WSL 环境确认
  - 依赖库测试
  - 启动测试

### ✅ verify_libs.py
- **功能**：Python 库验证
- **输出**：
  - 所有依赖库状态
  - 架构敏感库测试
  - 兼容性报告

## 使用建议

### 新用户（推荐）
```bash
./start.sh  # 让脚本自动处理一切
```

### 明确知道自己系统的用户
```bash
# Intel/AMD x86_64
./setup.sh           # 首次
./quick_start.sh     # 后续

# Apple M1/M2/M3 或 ARM Linux
./setup_arm.sh       # 首次
./quick_start.sh     # 后续
```

### 遇到问题
```bash
./diagnose.sh        # 诊断环境
./check_arch.sh      # 检查架构
./test_windows.sh    # Windows 测试
```

## 脚本执行流程

1. **start.sh** 判断环境
2. 首次运行 → **setup.sh** 或 **setup_arm.sh**
3. 已安装 → **quick_start.sh**
4. 服务启动 → 访问 http://localhost:5000-5010

## 注意事项

- Windows WSL 用户：脚本会自动修复换行符
- ARM 用户：首次安装需要编译，耐心等待
- 所有脚本都会自动查找可用端口（5000-5010）
- 配置文件会从 .example 模板自动创建