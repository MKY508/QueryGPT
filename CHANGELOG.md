# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5] - 2025-11-04

### Added
- SSE 思考播报链路：后端解析 `[步骤 x]` 并实时推送，前端逐条渲染
- 全量 Prompt 模板：ANALYSIS 路由预置 pymysql 连接、数据库探索与字段策略示例

### Changed
- 路由体系收敛为 QA / ANALYSIS，移除 SQL_ONLY 独立入口
- 设置页面顶部标签复原，并与侧边导航联动，体验一致
- 数据库守卫告警改为复用思考卡片并提供 8→0 动态倒计时
- 文档、脚本、页面版本号统一为 1.5

### Fixed
- 修复设置页标签无法切换的问题
- 阻止数据库连接失败时生成伪造数据或 HTML 的行为
- 清理最终汇总中的 `[步骤 x]` 前缀，用户视图保持友好

### Known Issues
- 智能路由在极端模糊语境下仍可能回退到 QA 建议

## [1.2] - 2025-09-05

### Changed
- 统一所有组件版本号为 v1.2
- 移除 beta 标识（除智能路由功能外）
- 更新所有文档中的版本信息
- 脚本版本号统一为 1.2

### Fixed
- 虚拟环境兼容性问题
- WSL 环境检测和支持
- 错误处理和日志记录改进
- 进程管理和资源控制优化

### Added
- 完整的版本历史文档
- 改进的新手引导系统
- 多语言支持（10种语言）

### Known Issues
- 智能路由系统仍处于 Beta 阶段
- Gemini 模型可能存在 litellm 兼容性问题

## [1.1] - 2025-08-28

### Added
- AI 智能路由系统（Beta）
- 新手引导系统
- Prompt 自定义功能
- 进程管理优化

### Fixed
- 进程停止按钮问题
- 配置映射不一致
- API 集成错误

## [1.0] - 2025-08-21

### Added
- 初始版本发布
- 基础查询功能
- 数据可视化
- 历史记录管理