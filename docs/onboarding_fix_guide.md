# 新手引导系统修复说明

## 问题分析

新手引导未在第一次访问时显示的原因：

### 1. 版本控制机制问题
- **原因**：`hasCompletedOnboarding()` 函数中有兼容旧版本的逻辑，会检查旧的存储标记
- **影响**：如果之前有任何测试数据残留，会导致系统认为用户已完成引导
- **修复**：简化逻辑，只检查版本号匹配

### 2. 会话存储检查
- **原因**：`sessionStorage` 防止页面刷新时重复显示，但在同一会话中不会再显示
- **影响**：如果用户在同一浏览器会话中多次访问，引导只会在第一次尝试显示
- **正常行为**：这是设计预期，避免干扰用户

### 3. 配置文件加载
- **状态**：配置文件能正常通过 `/config/onboarding_config.json` 路径加载
- **默认设置**：
  - `enabled: true` - 启用引导
  - `show_for_new_users: true` - 为新用户显示
  - `force_show: false` - 不强制显示

## 解决方案

### 立即修复（已完成）
1. ✅ 简化 `hasCompletedOnboarding()` 逻辑，移除旧版本兼容代码
2. ✅ 创建调试页面 `/debug_onboarding` 用于检查和重置状态
3. ✅ 添加路由支持调试页面

### 使用调试工具

访问 `/debug_onboarding` 页面可以：
- 查看当前存储状态（localStorage/sessionStorage）
- 查看配置文件设置
- 清除所有存储数据
- 强制显示引导
- 测试配置文件加载

### 手动重置方法

#### 方法一：使用调试页面（推荐）
1. 访问 `http://localhost:5000/debug_onboarding`
2. 点击"重置引导状态"或"清除所有存储"
3. 返回主页面，引导会自动显示

#### 方法二：浏览器控制台
```javascript
// 在主页面打开浏览器控制台（F12）
// 清除引导相关存储
localStorage.removeItem('querygpt_onboarding_version');
localStorage.removeItem('querygpt_onboarding_completed');
sessionStorage.removeItem('querygpt_onboarding_shown_session');

// 刷新页面
location.reload();
```

#### 方法三：使用全局命令
```javascript
// 在控制台执行
window.OnboardingGuide.reset();
window.OnboardingGuide.start();
```

## 配置选项

### 强制显示引导（用于测试）

编辑 `config/onboarding_config.json`：
```json
{
  "onboarding": {
    "force_show": true  // 改为 true
  }
}
```

### 修改引导版本（触发重新显示）

更改版本号会让所有用户重新看到引导：
```json
{
  "onboarding": {
    "version": "1.0.1"  // 修改版本号
  }
}
```

### 禁用引导

如果需要完全禁用：
```json
{
  "onboarding": {
    "enabled": false
  }
}
```

## 测试步骤

1. **清理测试**
   - 访问调试页面，清除所有存储
   - 刷新主页面，应该看到引导

2. **版本更新测试**
   - 修改配置文件中的版本号
   - 刷新页面，即使已完成旧版本，也应看到新版本引导

3. **会话测试**
   - 完成引导后刷新页面，不应重复显示
   - 关闭浏览器标签页，重新打开，也不应显示（因为已完成）

## 最佳实践

1. **发布新功能时**：更新版本号，让用户看到新功能引导
2. **测试环境**：使用 `force_show: true` 进行测试
3. **生产环境**：确保 `force_show: false`，让版本控制正常工作

## 监控和诊断

在浏览器控制台查看引导状态：
```javascript
window.OnboardingGuide.getStatus()
```

输出示例：
```javascript
{
  completed: false,        // 是否已完成
  shownInSession: false,   // 本会话是否已显示
  version: "none",         // 已完成的版本
  currentVersion: "1.0.0", // 当前版本
  enabled: true,           // 是否启用
  forceShow: false         // 是否强制显示
}
```