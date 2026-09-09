# 桌面界面合同

当前目标是只保留桌面产品，并统一所有前端的视觉、控件和交互。中英文切换继续保留；“统一 UI 语言”不是删除翻译。旧文档中的手机抽屉、触屏尺寸和窄屏全屏编辑不再是实现要求。

## 统一规则

- 设计最小宽度 1180px，导航 248px，标题栏 60px。桌面窗口内可以调整内容宽度，不因窗口变窄切换到手机菜单或全屏编辑器。
- 工作台和设置使用同一层次：低对比导航背景、独立的正文面板、单一强调色。浅色与深色都由主题变量决定，设置页不再固定深蓝侧栏。
- 几何值只在 `desktop-tokens.css` 定义：控件 6px、菜单 8px、内容面板 12px。Tailwind 的圆角名称映射到这些语义；胶囊只用于标记，不作为所有按钮的默认形状。
- 普通导航是 `aside`，配置编辑是命名 `section`，不是 dialog。明确折叠导航保留 DOM、草稿和查询，并在必要时返回触发按钮；不锁住整个工作区的 Tab。
- 确认放弃、删除及明确打开的任务窗口仍可使用真正的模态。IME Escape、已处理事件和别的模态不能误触发底层面板关闭。
- 搜索复用 `SearchField`，按钮复用 `Button`。搜索统一清除、组合输入和 Escape 行为；列表可通过 `aria-controls` 关联被过滤内容，不再另写一套搜索输入。
- 已加载内容的水平页签复用 `TabList`，按 [WAI-ARIA Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) 自动激活，统一方向键、Home/End 和单一 Tab 停靠点；来源预览与文本替换已接入。
- 页面入口、列表操作和编辑动作使用同一控件层；避免页面各自维护不同颜色、直角按钮和触控尺寸。表单的提交、错误及草稿合同不因外观修改而改变。

## 已归并与待完成

| 模块 | 已归并的桌面结构 | 尚未完成 |
| --- | --- | --- |
| 共享控件 | Button、SearchField、TabList、确认弹窗、主题与圆角变量 | 继续替换其他页面的重复控件 |
| 工作台与设置 | 导航和配置编辑面板；工作区已有 248px 目录与 420px 编辑区 | 完整页面依赖、草稿会话及离开链路 |
| 关于 | 统一标题栏、产品与版本双栏、三列项目链接 | 工作区里的版本检查行为 |
| 项目理解 | 320px 详情区；工作区已改为 200px 目录与单一表格 | 页面历史、选择及保存恢复的整体归并 |
| 数据来源 | 280px 目录、来源版本解析、字段与样例预览 | 上传、文件准备、来源替换及工作区完整行为 |
| 数据工作区外框 | 60px 标题栏、共享页签；嵌入模式或 900px 桌面侧面板 | 外框提交不包含其余工作区新功能 |
| 文件准备窗口 | Excel 与 CSV 复用 PreparationDialog、共享按钮及样例表；1120px 窗口、224px 工作表目录 | 来源入口、项目存储和真实文件准备联调 |
| 来源更新与方法重用 | 复用文件准备窗口和完整样例查看器；移除另一套截断样例表，保留两期数据标签与明确确认 | 工作区入口、项目存储及真实更新链路的整体归并 |
| 数据窗口 | 表格与 360px 记录详情并排；筛选、排序、列选择、精确值与导出 | 报告和聊天入口的整体归并 |
| 整理编辑器 | 320px 操作目录、草稿历史、步骤选择、规则解析、预览与确认；样例和文本替换固定双栏 | 真实文件处理、后端文本替换及安装包联调 |

### 行为边界

- 数据窗口保留表格、搜索、筛选和分页，不以详情替代表格。表格模型复用已安装的 Decimal 和 Papa Parse。
- 来源预览只使用当前来源保留的快照，不从独立列样例拼造记录；字段名和精确值不改写。
- 整理前后行号是各自样例位置，不假设同一记录。字段消失或切换来源时不恢复旧选列。
- 整理的迟到预览不能恢复已关闭会话；应用期间不能重复提交。项目存储只归并整理请求归属，其他项目操作仍待整理。
- 退出确认初始聚焦继续编辑，Escape 返回草稿；确认框固定 460px，普通工作面板不冒充模态。

## 验证证据

检查使用现有已安装依赖。定向测试与隔离 Chrome 预览不是全量构建、全新安装或真实文件处理的交付证明；预览使用虚构数据，不调用模型、不写真实配置或应用整理。

| 范围 | 已检查内容 | 视觉证据 |
| --- | --- | --- |
| 工作台、设置 | 导航折叠、栏目往返、编辑保留、并排边界、主题；入口为 settings-editor、analysis-workbench、workbench-pane-focus、settings-page | 仍需完整页面验收 |
| 数据工作区外框 | 暂存源码 3 个定向用例及类型检查通过；Chrome 1200px 验证 60px 标题栏、字段搜索与放大样例，无脚本错误或写请求 | 与下行字段搜索共用预览 |
| 文件准备 | 暂存源码 4 个用例覆盖只读预览、迟到响应、明确提交与未确认结果；类型检查、限定 ESLint 通过。Chrome 1200px 验证两种窗口的 12px 圆角、60px 标题栏及 Escape，未写真实数据 | [CSV](images/zh/desktop-ui-csv-import.png)、[Excel](images/zh/desktop-ui-workbook.png) |
| 来源更新与方法重用 | 暂存源码 4 个用例覆盖迟到预览、单次确认、未确认写入、版本锁定和后部字段完整值；限定类型检查与 ESLint 通过。Chrome 1200px 验证两种窗口、完整值及分层 Escape；使用虚构来源与整理方法，未执行应用 | [更新数据](images/zh/desktop-ui-source-replacement.png)、[重新整理](images/zh/desktop-ui-recipe-replay.png) |
| 数据目录与预览 | 1200/1440px 下列表可见、12px 外框、无页面横向溢出；筛选、来源切换、字段定位、页签键盘、样例失效 | [目录](images/zh/desktop-ui-sources.png)、[字段搜索](images/zh/desktop-ui-source-fields.png) |
| 数据窗口 | 8 个定向核心用例；限定类型检查；1200/1440px 下详情并排，1200px 菜单 8px、无溢出 | [列菜单](images/zh/desktop-ui-data-columns.png)、[筛选](images/zh/desktop-ui-data-filters.png) |
| 整理 | 9 个主流程定向用例及子组件检查；限定类型检查；1200px 下编辑、预览、返回、退出确认和草稿保留 | [编辑器](images/zh/desktop-ui-cleaning-editor.png)、[样例](images/zh/desktop-ui-cleaning-samples.png)、[字段对照](images/zh/desktop-ui-cleaning-impact.png)、[确认](images/zh/desktop-ui-cleaning-discard.png) |
| 文本替换 | 样例转草稿、空文本、冲突、确认；原值和目标值同一行，未写真实数据 | [样例选择](images/zh/desktop-ui-text-samples.png)、[逐项编辑](images/zh/desktop-ui-text-editor.png) |
| 关于、项目理解 | 1200/1440px 桌面布局与无横向溢出；理解详情 Escape 返回当前行；截图含待归并行为 | [关于浅色](images/zh/desktop-ui-about.png)、[深色](images/zh/desktop-ui-about-dark.png)、[项目理解](images/zh/desktop-ui-understanding.png) |

## 后续验收

1. 归并上述待完成模块，不以独立控件提交代替完整页面。
2. 覆盖报告阅读与编辑、历史和项目页面，统一标题栏、工具栏、字段、菜单、空态和错误态。
3. 复核全部弹窗、表格的圆角、间距、密度和键盘行为，清除剩余手机样式。
4. 核对桌面窗口约束、全站导航和真实安装包；所有要求都有对应证据后才能认定全站完成。

## 参考

- [Twenty NavigationDrawer 源码](https://github.com/twentyhq/twenty/blob/main/packages/twenty-front/src/modules/ui/navigation/navigation-drawer/components/NavigationDrawer.tsx)：导航、内容和主题变量的职责划分。只采用桌面分工，没有复制源码或新增其依赖。
- [PatternFly inline Drawer](https://www.patternfly.org/components/drawer/)：主从内容并排，不采用手机断点或覆盖式切换。
- [PatternFly Modal](https://www.patternfly.org/components/modal/design-guidelines/)：明确任务采用标题、内容与动作分区；文件准备、来源更新及方法重用复用一个桌面框架。
- [WAI-ARIA Alert Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)：真实模态、标题、描述与确认操作。页签规则见上文。
