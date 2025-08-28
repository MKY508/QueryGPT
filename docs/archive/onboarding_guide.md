# 新手引导系统配置指南

## 概述

新手引导系统使用气泡提示方式，在用户首次访问时自动展示系统主要功能。系统高度可配置，可通过配置文件或环境变量控制行为。

## 配置方式

### 方式1：配置文件（推荐）

编辑 `config/onboarding_config.json` 文件：

```json
{
  "onboarding": {
    "enabled": true,           // 是否启用引导功能
    "show_for_new_users": true, // 是否为新用户显示
    "force_show": false         // 强制显示（用于测试）
  }
}
```

### 方式2：环境变量

在 `.env` 文件中添加：

```bash
ONBOARDING_ENABLED=false        # 设为false完全禁用引导
ONBOARDING_AUTO_START=false     # 设为false不自动开始
ONBOARDING_FORCE_SHOW=true      # 强制显示（测试用）
```

## 关键配置项说明

### 基础配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | true | 主开关，设为false完全禁用引导 |
| `show_for_new_users` | boolean | true | 是否对新用户自动显示 |
| `auto_start_delay` | number | 1500 | 自动开始延迟（毫秒） |
| `force_show` | boolean | false | 强制显示，忽略已完成标记 |
| `version` | string | "1.0.0" | 引导版本，更新版本会重新显示 |

### 界面设置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `settings.allow_skip` | boolean | true | 是否允许跳过引导 |
| `settings.show_progress` | boolean | true | 是否显示进度条 |
| `settings.highlight_elements` | boolean | true | 是否高亮目标元素 |
| `settings.overlay_opacity` | number | 0.3 | 遮罩层透明度（0-1） |
| `settings.bubble_max_width` | number | 400 | 气泡最大宽度（像素） |

### 完成行为

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `completion.show_completion_message` | boolean | true | 是否显示完成消息 |
| `completion.completion_message_duration` | number | 3000 | 完成消息显示时长（毫秒） |
| `completion.mark_as_completed_in_storage` | boolean | true | 是否在本地存储标记完成 |

### 调试选项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `debug.enabled` | boolean | false | 启用调试模式 |
| `debug.log_steps` | boolean | false | 控制台输出步骤信息 |

## 使用场景

### 1. 完全禁用引导

```json
{
  "onboarding": {
    "enabled": false
  }
}
```

### 2. 仅手动触发（不自动显示）

```json
{
  "onboarding": {
    "enabled": true,
    "show_for_new_users": false
  }
}
```

### 3. 测试模式（总是显示）

```json
{
  "onboarding": {
    "enabled": true,
    "force_show": true,
    "debug": {
      "enabled": true,
      "log_steps": true
    }
  }
}
```

### 4. 快速演示模式

```json
{
  "onboarding": {
    "enabled": true,
    "auto_start_delay": 500,  // 快速开始
    "settings": {
      "animation_duration": 150  // 加快动画
    }
  }
}
```

## 优先级

配置优先级从高到低：

1. JavaScript 代码中的强制设置
2. 环境变量（.env 文件）
3. 配置文件（onboarding_config.json）
4. 默认值

## 本地存储

系统使用 localStorage 存储以下信息：

- `querygpt_onboarding_completed`：是否已完成引导
- 存储格式：`"true"` 或 `"false"`

### 清除引导记录

在浏览器控制台执行：

```javascript
// 清除引导完成标记，下次访问会重新显示
localStorage.removeItem('querygpt_onboarding_completed');

// 或使用引导对象的方法
onboardingGuide.reset();
```

## 常见问题

### Q: 如何永久关闭引导？
A: 在 `config/onboarding_config.json` 中设置 `"enabled": false`

### Q: 如何为特定用户重新显示引导？
A: 清除该用户浏览器的 localStorage，或临时设置 `"force_show": true`

### Q: 更新引导内容后如何让所有用户重新看到？
A: 修改配置文件中的 `version` 字段，系统会检测版本变化并重新显示

### Q: 引导气泡位置不准确怎么办？
A: 引导系统会自动检测元素位置并智能调整，如果仍有问题，可能是元素选择器需要更新

## 开发调试

启用调试模式查看详细信息：

```json
{
  "onboarding": {
    "debug": {
      "enabled": true,
      "log_steps": true,
      "show_element_boundaries": true
    }
  }
}
```

然后在浏览器控制台可以看到：
- 配置加载信息
- 每个步骤的执行情况
- 元素查找结果
- 定位计算过程