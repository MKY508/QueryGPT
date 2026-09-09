# 桌面界面合同

当前目标是只保留桌面产品，并统一所有前端的视觉、控件和交互。中英文切换继续保留；“统一 UI 语言”不是删除翻译。旧文档中的手机抽屉、触屏尺寸和窄屏全屏编辑不再是实现要求。

## 统一规则

- 设计最小宽度 1180px，导航 248px，标题栏 60px。桌面窗口内可以调整内容宽度，不因窗口变窄切换到手机菜单或全屏编辑器。
- Electron 主窗口最小尺寸为 1180×600；窗口恢复逻辑不得重新打开窄于 1180px 的工作区。安装包及其他平台的窗口行为仍需最终验收。
- 工作台和设置使用同一层次：低对比导航背景、独立的正文面板、单一强调色。浅色与深色都由主题变量决定，设置页不再固定深蓝侧栏。
- 几何值只在 `desktop-tokens.css` 定义：控件 6px、菜单 8px、内容面板 12px。Tailwind 的圆角名称映射到这些语义；胶囊只用于标记，不作为所有按钮的默认形状。
- 工作台与报告编辑器的原生 CSS 同样引用上述变量，不另设 5／7／10px 控件圆角。报告编辑器最低宽度引用桌面下限；保留桌面内工具栏换行，移除 639px、359px 手机工具栏和正文缩排规则。
- 普通导航是 `aside`，配置编辑是命名 `section`，不是 dialog。明确折叠导航保留 DOM、草稿和查询，并在必要时返回触发按钮；不锁住整个工作区的 Tab。
- 确认放弃、删除及明确打开的任务窗口仍可使用真正的模态。IME Escape、已处理事件和别的模态不能误触发底层面板关闭。
- 搜索复用 `SearchField`，按钮复用 `Button`。搜索统一清除、组合输入和 Escape 行为；列表可通过 `aria-controls` 关联被过滤内容，不再另写一套搜索输入。
- 已加载内容的水平页签复用 `TabList`，按 [WAI-ARIA Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) 自动激活，统一方向键、Home/End 和单一 Tab 停靠点；来源预览与文本替换已接入。
- 页面入口、列表操作和编辑动作使用同一控件层；避免页面各自维护不同颜色、直角按钮和触控尺寸。表单的提交、错误及草稿合同不因外观修改而改变。

## 已归并与待完成

| 模块 | 已归并的桌面结构 | 尚未完成 |
| --- | --- | --- |
| 共享控件 | Button、SearchField、TabList、TaskDialog、确认弹窗、主题与圆角变量 | 继续替换其他页面的重复控件 |
| 项目切换 | 760px 桌面窗口、共享搜索与按钮；目录搜索、分批浏览、新建与重命名、请求结果确认统一归并 | 全站入口及真实项目服务联调 |
| 工作台与设置 | 导航和配置编辑面板；工作区已有 248px 目录与 420px 编辑区 | 完整页面依赖、草稿会话及离开链路 |
| 外观偏好 | AppearancePreferences 接回原偏好入口；语言即时切换和失败重试独立维护。主题固定双栏、原生单选、12px 预览卡，配色直接引用应用变量；保存与重试复用 Button | 设置工作区完整导航、持久草稿及原生离开链路仍待整体归并 |
| 模型与连接目录 | 共用 SettingsResourceCard 的标题、状态、反馈与操作分区；移除模型 480px 和连接 sm 布局分支，12px 卡片、6px 控件。检查与二次删除复用 Button；删除确认遇到搜索或筛选即取消 | 连接列表已在工作区入口接入；完整连接资源、表单与设置离开链路仍待整体归并 |
| 关于 | 统一标题栏、产品与版本双栏、三列项目链接 | 工作区里的版本检查行为 |
| 项目理解 | 320px 详情区；工作区已改为 200px 目录与单一表格 | 页面历史、选择及保存恢复的整体归并 |
| 数据来源 | 280px 目录、来源版本解析、字段与样例预览 | 上传、文件准备、来源替换及工作区完整行为 |
| 数据工作区 | 60px 标题栏、共享页签与按钮、12px 内容卡片；嵌入模式或 900px 桌面侧面板。界面状态按项目重建，数据说明独立维护 | 来源操作、上传队列和项目存储仍需整体归并 |
| 上传队列与活动窗口 | UploadQueueView 接收快照和动作；固定文件／状态列、共享按钮、主题进度条。UploadActivityWindow 复用 1120px 桌面任务框架，关闭仅结束查看 | 工作区已接入项目操作入口和活动窗口；上传引擎、恢复记录、全局入口及离开链路尚未整体归并 |
| 文件准备窗口 | Excel、CSV、来源替换与方法重用复用 TaskDialog、共享按钮及样例表；1120px 窗口、224px 工作表目录 | 来源入口、项目存储和真实文件准备联调 |
| 报告版本与刷新 | 版本历史复用 TaskDialog，240px 目录与报告预览并排；会话跟随报告及当前版本重建。工作区刷新确认已改为 760px 窗口、固定双栏来源对照 | 版本入口与真实服务联调；刷新协议及编辑器整体归并；回收站、冲突与恢复窗口 |
| 报告目录 | ReportDirectoryList 接收报告与动作；标题、内容数量、更新时间和常驻操作按行对齐。筛选复用 SearchField 与 Button，保留明确提交。工作区页面已改为 60px 标题栏和桌面列表 | 页面请求、复制恢复、回收站及路由整体归并；真实服务联调 |
| 报告冲突与恢复 | 冲突窗口复用 TaskDialog 与 Button，320px 选择栏和报告预览固定并排；三方合并模型独立于窗口。工作区回收站与草稿恢复也已接入该框架 | 编辑器合并与保存链路；回收站读写、草稿存储及恢复入口整体归并 |
| 报告查找与移动 | 两者使用 760px 原生 TaskDialog、共享搜索与结果按钮；查找索引与原文高亮独立维护。页面编辑模型统一移动、复制与排序，移动选择会话按报告及内容身份重建 | 编辑器入口、滚动定位、撤销、保存和草稿恢复链路的整体归并 |
| 报告编辑布局 | 248px 页面目录、弹性画布、320px 属性区并排；面板状态与窗口宽度无关。工作区入口已移除遮罩、焦点圈闭与移动断点隐藏文字，收起保留搜索和面板状态 | 完整编辑器、属性表单及保存依赖仍需整体归并；不是独立组件提交即完成页面 |
| 来源更新与方法重用 | 复用文件准备窗口和完整样例查看器；移除另一套截断样例表，保留两期数据标签与明确确认 | 工作区入口、项目存储及真实更新链路的整体归并 |
| 数据窗口 | 表格与 360px 记录详情并排；筛选、排序、列选择、精确值与导出 | 报告和聊天入口的整体归并 |
| 整理编辑器 | 320px 操作目录、草稿历史、步骤选择、规则解析、预览与确认；样例和文本替换固定双栏 | 真实文件处理、后端文本替换及安装包联调 |

### 行为边界

- 数据窗口保留表格、搜索、筛选和分页，不以详情替代表格。表格模型复用已安装的 Decimal 和 Papa Parse。
- 来源预览只使用当前来源保留的快照，不从独立列样例拼造记录；字段名和精确值不改写。
- 整理前后行号是各自样例位置，不假设同一记录。字段消失或切换来源时不恢复旧选列。
- 整理的迟到预览不能恢复已关闭会话；应用期间不能重复提交。项目存储只归并整理请求归属，其他项目操作仍待整理。
- `DataWorkspacePanel` 只在项目身份变化时重建内部工作区；同项目收起保留栏目，项目往返不复用旧界面状态。数据说明、字段摘要、问题文案与时间格式统一在 `useDataWorkspacePresentation`，不混入页面操作处理。
- 上传快照类型集中在 `upload-state`，不依赖传输实现；队列视图不保存 File 对象。调用方绑定项目并以项目为 key；未确认记录改变后必须重新确认清除，上传至 100% 不等于已经保存成功。
- 任务窗口隔离底层键盘事件，组合输入期间的 Escape 不关闭窗口；导入查看窗口不锁住传输，关闭不取消上传，打印时不显示任务窗口。
- TaskDialog 统一任务标题栏、两种桌面宽度、关闭与键盘边界，不接管请求。报告版本预览复用只读报告排版；选择不执行恢复，未确认的恢复只能先重新读取，不重复写入。
- 报告目录视图不读写服务或维护删除确认；复制与删除向调用方传递完整报告身份及版本，导航链接不包含操作按钮。清除报告搜索保留状态与排序，清除筛选重置搜索与状态；两者回到第一页。
- 冲突选择只对当前三份报告快照有效；任一快照改变后重新选择。预览不写入报告，应用只把结果交回编辑器；仍需独立保存，不能把窗口关闭视为保存成功。
- 报告查找只索引展示文本，不遍历表格原始行或内部引用；规范化搜索保留原文字素边界。每批 60 个结果，加载更多后定位新增结果；结果移除时焦点回到搜索。TaskDialog 的可选 Escape 动作承接“先清除、再关闭”，不绕过忙碌及输入法保护。
- 页面编辑模型不直接保存：跨页移动保留内容身份、来源及报告级关联，只清除受影响的页内关联；新位置排在目标内容下方。复制生成新身份并重建内部关联，不使原本歧义的关联变成有效关联。不存在或未改变的目标保持原对象。
- 报告目录默认展开、属性默认收起，两侧独立开关；选择页面不关闭目录，打开属性不关闭目录。普通面板不设置模态或使画布 inert；面板内 Escape 关闭后返回对应工具栏按钮，目录搜索先清除再关闭。明确任务窗口仍保持模态。
- 项目搜索等待组合输入完成再过滤；编辑返回原操作位置。目录请求不能覆盖较新的修改；未确认的新建结果不切换项目，不确定的写入只允许先刷新目录核对，迟到的新建不跳离后续导航。
- 退出确认初始聚焦继续编辑，Escape 返回草稿；确认框固定 460px，普通工作面板不冒充模态。

## 验证证据

模型与连接目录：暂存代码 1 个用例验证编辑／检查／确认删除隔离及搜索取消删除，限定类型检查与 ESLint 通过；Chrome 1180px 中英文检查列表与右侧编辑器打开后的 422px 列表，卡片 12px、按钮 36px 高和 6px 圆角，操作不越界，无页面错误或服务写入。[连接编辑](images/zh/desktop-ui-connection-card.png)、[模型编辑](images/zh/desktop-ui-model-card.png)。截图使用虚构配置，不是服务连通证明。

外观偏好：暂存入口 3 个用例验证语言完成后刷新、失败重试及主题选择不写运行设置；限定类型检查与 ESLint 通过。工作区额外验证跨栏目保留草稿。Chrome 在 1180px 下查看中英文、浅色和深色，双栏卡片 12px、无横向溢出或页面错误，未写服务数据。[中文浅色](images/zh/desktop-ui-appearance.png)、[英文深色](images/zh/desktop-ui-appearance-en-dark.png)。没有运行全量构建。

检查使用现有已安装依赖。定向测试与隔离 Chrome 预览不是全量构建、全新安装或真实文件处理的交付证明；预览使用虚构数据，不调用模型、不写真实配置或应用整理。

| 范围 | 已检查内容 | 视觉证据 |
| --- | --- | --- |
| 原生窗口约束 | 从暂存 main.ts 提取构造尺寸，隔离 Electron 隐藏窗口验证默认 1280×800、最小 1180×600；另用工作区恢复逻辑验证 900px 历史宽度提升至 1180px。未启动应用后端或构建安装包 | 原生 API 返回尺寸，未修改用户窗口记录 |
| 工作台与报告几何 | Chrome 工作区预览：报告阅读 1200／1440px、编辑 1200px 无页面横向溢出，最小宽度 1180px、按钮 6px、正文及卡片 12px；工作台按钮和导航 6px、正文 12px。使用虚构报告，无脚本错误或写请求；仅样式检查，未运行编译或业务测试 | [报告编辑](images/zh/desktop-ui-report-editor-geometry.png) |
| 项目切换 | 暂存源码 4 个用例覆盖分批搜索、组合输入、中英文草稿、重命名失败保留输入和新建确认；限定类型检查、ESLint 通过。Chrome 1200px 验证 760px 窗口、12px 圆角、60px 标题栏、两级 Escape、焦点返回及保存快捷键不传至 window；使用虚构目录，无写请求 | [项目目录](images/zh/desktop-ui-project-switcher.png)、[重命名](images/zh/desktop-ui-project-rename.png) |
| 报告版本与刷新 | 暂存源码 3 个用例覆盖版本预览覆盖关系、未确认恢复及共享框架键盘边界；工作区另验证版本身份重建和刷新会话。限定类型检查与 ESLint 通过。中英文隔离 Chrome 验证版本 1120px／刷新 760px、12px 圆角、60px 标题栏、可操作按钮、IME Escape 与关闭；虚构数据，未执行恢复或刷新 | [版本历史](images/zh/desktop-ui-report-versions.png)、[刷新确认](images/zh/desktop-ui-report-refresh.png) |
| 报告目录 | 暂存源码 2 个用例覆盖操作归属、禁用边界、明确查询与两种清除范围；限定类型检查通过。工作区 3 个用例覆盖服务分页与导航上下文、删除失败后保留报告、返回原分析；ESLint 通过。Chrome 1200px 验证 60px 标题栏、12px 列表、搜索及单次删除确认，无横向溢出或写请求；目录为虚构数据 | [桌面目录](images/zh/desktop-ui-report-directory.png) |
| 报告冲突与恢复 | 暂存源码验证明确冲突选择、快照更换失效、快捷键隔离、IME 与忙碌关闭；限定类型检查通过。工作区 3 个用例覆盖卡片归属、删除二次确认与未确认恢复，ESLint 通过。中英文隔离 Chrome 验证三种 1120px 窗口、60px 标题栏、12px 圆角与 Escape，无实际应用／删除；草稿恢复只检查空状态 | [冲突处理](images/zh/desktop-ui-report-conflict.png)、[回收站](images/zh/desktop-ui-report-trash.png) |
| 报告查找与移动 | 查找暂存源码 3 个用例覆盖高亮、分批结果、输入法、两级 Escape 与焦点恢复；页面操作暂存源码 3 个用例覆盖身份保留、复制排序、禁用与跨报告搜索重置，工作区另验证关联清除和歧义关联保留。限定类型检查与 ESLint 通过。已有中英文 Chrome 证据覆盖 760px 窗口、60px 标题栏、12px 圆角及选择标识，未执行真实保存 | [查找](images/zh/desktop-ui-report-find.png)、[移动](images/zh/desktop-ui-report-move.png) |
| 工作台、设置 | 导航折叠、栏目往返、编辑保留、并排边界、主题；入口为 settings-editor、analysis-workbench、workbench-pane-focus、settings-page | 仍需完整页面验收 |
| 数据工作区 | 外框、字段搜索与放大样例已验证；本次暂存源码 3 个用例覆盖项目往返、同项目收起及中英文数据说明，限定类型检查与 ESLint 通过。Chrome 1200px：6px 按钮、12px 卡片、60px 标题栏，无横向溢出、脚本错误或写请求 | [数据工作区](images/zh/desktop-ui-data-workspace.png) |
| 文件准备 | 暂存源码 4 个用例覆盖只读预览、迟到响应、明确提交与未确认结果；类型检查、限定 ESLint 通过。Chrome 1200px 验证两种窗口的 12px 圆角、60px 标题栏及 Escape，未写真实数据 | [CSV](images/zh/desktop-ui-csv-import.png)、[Excel](images/zh/desktop-ui-workbook.png) |
| 来源更新与方法重用 | 暂存源码 4 个用例覆盖迟到预览、单次确认、未确认写入、版本锁定和后部字段完整值；限定类型检查与 ESLint 通过。Chrome 1200px 验证两种窗口、完整值及分层 Escape；使用虚构来源与整理方法，未执行应用 | [更新数据](images/zh/desktop-ui-source-replacement.png)、[重新整理](images/zh/desktop-ui-recipe-replay.png) |
| 上传队列视图 | 暂存源码 3 个用例覆盖保存／成功、暂缓、重新选文件和清除确认失效；工作区额外 1 个用例验证项目动作归属。限定类型检查与 ESLint 通过；隔离 Chrome 中英文虚构队列验证 6px 按钮、12px 外框、主题进度条及无横向溢出，未执行上传 | [中文](images/zh/desktop-ui-upload-queue.png)、[英文](images/zh/desktop-ui-upload-queue-en.png) |
| 导入活动窗口 | 暂存源码验证快捷键、组合输入与关闭；工作区 2 个用例验证跨项目操作、清空与关闭不影响队列。限定类型检查与 ESLint 通过；中英文隔离 Chrome 验证 1120px 窗口、60px 标题栏和 Escape，未执行上传 | [桌面窗口](images/zh/desktop-ui-upload-window.png) |
| 数据目录与预览 | 1200/1440px 下列表可见、12px 外框、无页面横向溢出；筛选、来源切换、字段定位、页签键盘、样例失效 | [目录](images/zh/desktop-ui-sources.png)、[字段搜索](images/zh/desktop-ui-source-fields.png) |
| 数据窗口 | 8 个定向核心用例；限定类型检查；1200/1440px 下详情并排，1200px 菜单 8px、无溢出 | [列菜单](images/zh/desktop-ui-data-columns.png)、[筛选](images/zh/desktop-ui-data-filters.png) |
| 整理 | 9 个主流程定向用例及子组件检查；限定类型检查；1200px 下编辑、预览、返回、退出确认和草稿保留 | [编辑器](images/zh/desktop-ui-cleaning-editor.png)、[样例](images/zh/desktop-ui-cleaning-samples.png)、[字段对照](images/zh/desktop-ui-cleaning-impact.png)、[确认](images/zh/desktop-ui-cleaning-discard.png) |
| 文本替换 | 样例转草稿、空文本、冲突、确认；原值和目标值同一行，未写真实数据 | [样例选择](images/zh/desktop-ui-text-samples.png)、[逐项编辑](images/zh/desktop-ui-text-editor.png) |
| 关于、项目理解 | 1200/1440px 桌面布局与无横向溢出；理解详情 Escape 返回当前行；截图含待归并行为 | [关于浅色](images/zh/desktop-ui-about.png)、[深色](images/zh/desktop-ui-about-dark.png)、[项目理解](images/zh/desktop-ui-understanding.png) |

## 后续验收

报告桌面布局本轮验证：暂存组件 2 个用例及限定类型检查，工作区额外验证菜单键盘操作；Chrome 使用虚构只读报告，1180／1440／1600px 验证三栏并排、无整页横向溢出、无模态或 inert；验证收起后搜索保留及 Escape 焦点返回。ESLint 无错误，编辑器既有会话初始化和图片能力探测仍有 2 条 effect 警告。未执行真实写入、全量测试或构建。[1180px 编辑器](images/zh/desktop-ui-report-desktop-panes.png)。

1. 归并上述待完成模块，不以独立控件提交代替完整页面。
2. 覆盖报告阅读与编辑、历史和项目页面，统一标题栏、工具栏、字段、菜单、空态和错误态。
3. 复核全部弹窗、表格的圆角、间距、密度和键盘行为，清除剩余手机样式。
4. 原生最小宽度已做隔离验证；继续核对窗口恢复的整体归并、全站导航和真实安装包，不能用构造参数检查代替产品运行验收。

## 参考

- [PatternFly selectable Card](https://www.patternfly.org/components/card/design-guidelines/)：主题以可选择预览卡呈现；使用现有组件与原生单选，不引入已废弃的 Tile 或新依赖。

- [Twenty NavigationDrawer 源码](https://github.com/twentyhq/twenty/blob/main/packages/twenty-front/src/modules/ui/navigation/navigation-drawer/components/NavigationDrawer.tsx)：导航、内容和主题变量的职责划分。只采用桌面分工，没有复制源码或新增其依赖。
- [PatternFly inline Drawer](https://www.patternfly.org/components/drawer/)：主从内容并排，不采用手机断点或覆盖式切换。
- [PatternFly Modal](https://www.patternfly.org/components/modal/design-guidelines/)：明确任务采用标题、内容与动作分区；文件准备、来源更新及方法重用复用一个桌面框架。
- [PatternFly Multiple file upload](https://www.patternfly.org/components/file-upload/multiple-file-upload/)：上传入口、逐文件状态和传输处理分开组合；只采用分工，未引入依赖或复制源码。
- [React 状态归属](https://react.dev/learn/preserving-and-resetting-state)：项目身份作为工作区 key，直接重建该项目的局部状态，不为每个反馈和弹窗单独追加项目切换补丁。
- [Electron 窗口尺寸参数](https://www.electronjs.org/docs/latest/api/structures/base-window-options)：窗口宽度与最小宽度分别设置，保存尺寸不能覆盖当前桌面布局下限。
- [WAI-ARIA Alert Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)：真实模态、标题、描述与确认操作。页签规则见上文。
