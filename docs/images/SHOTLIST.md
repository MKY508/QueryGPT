# Screenshot Shot List

这个文件用于统一 README 截图替换标准。

## 输出文件名

- `docs/images/chat.png`
- `docs/images/semantic.png`
- `docs/images/schema.png`

> `login.png` 已废弃，单用户模式无登录页。

## 推荐截图内容

### `chat.png`

- 展示聊天主界面
- 左侧有历史列表
- 中间至少显示:
  - 用户问题
  - SQL 结果
  - 图表或 Python 输出
  - 诊断面板
- 顶部状态栏能看到:
  - 数据库连接
  - 模型名称
  - provider
  - 上下文轮数

### `semantic.png`

- 展示语义层配置页
- 至少有 2-3 个术语示例
- 能看出术语名称、类型、SQL 表达式、说明

### `schema.png`

- 展示 Schema 布局 / 表关系视图
- 至少 3 个表节点和关系线
- 使用 Fit View 保持布局居中

## 统一规范

- 推荐浅色主题
- 浏览器宽度: `1440px`
- 截图比例尽量统一
- 示例数据用演示数据，不要出现真实客户名、手机号、地址、API Key
- 保留产品真实状态，不做假数据拼图

## README 截图顺序

1. 聊天工作台（Hero 大图）
2. Schema 关系图（界面一览）
3. 语义层（界面一览）
