# 代码风格和约定

## Python (后端)

### 导入顺序
1. 标准库 (typing, collections.abc 等)
2. 第三方库 (fastapi, sqlalchemy 等)
3. 项目内部模块 (from app.xxx import ...)

### 类型注解
- 使用 Python 3.11+ 的新类型语法: `str | None`, `list[str]`
- 复杂类型使用 `typing.Any` 或 `collections.abc` 中的类型

### 文档字符串
- 使用中文文档字符串
- 函数应包含 Args 和 Returns 说明

### 命名约定
- 类名: PascalCase
- 函数/变量: snake_case
- 常量: UPPER_SNAKE_CASE
- 私有方法: _leading_underscore

### 安全要求
- 所有 SQL 查询必须参数化或使用严格的表名验证
- 使用 AST 分析而非正则表达式进行代码安全检查
- 敏感信息不写入日志

## TypeScript (前端)

### 命名约定
- 组件名: PascalCase
- 函数/变量: camelCase
- 类型/接口: PascalCase

### 类型定义
- 优先使用 interface 而非 type
- 类型定义放在 lib/types/ 目录

## 通用规则
- 行长度限制: 100 字符
- 使用 Ruff 进行代码格式化
