# 报表阅读层

本文维护筛选与图表联动的模块合同。报告编辑、保存回执、恢复与冲突处理见 [报告编辑](REPORT_EDITOR_DESIGN.md)；整体布局见 [工作台](WORKBENCH_DESIGN.md)。

## 所有权

- `report-reading.ts` 保存纯阅读状态与 reducer：字段值、图表选择、清除、保存后的身份对齐。它不写报告，不调用 API，不进入文档历史或恢复草稿。
- `useReportReading` 连接当前报告和页面，集中接受阅读动作。会话由工作区的项目／报告 key 隔离；普通切页保留各页选择，重新载入、恢复或合并文档时明确重置。进入编辑清除图表选择，但保留字段筛选。
- `readReportPage` 是画布、PDF 和图片的共用投影。输出筛选后卡片、有效联动、跨页筛选入口和连接数量；保留原始报告内容。当前页面和所选导出页不能先从完整报告中裁掉，否则会丢失其他页面提供的筛选。
- `report-interactions.ts` 维护页内图表连接和精确值匹配；`report-filter-connections.ts` 维护报告级显式字段映射。渲染组件不重复解释规则。
- `report-chart-interactions.tsx` 接收 Recharts 的未知点对象，读取原始 payload；不以绘图近似值、标签或数组位置代替业务值。`chart-source-value.ts` 和 `report-rows.ts` 是无界面、无数值转换依赖的读取边界。

## 动作规则

- 图表选择按页面和来源连接键隔离；重复选同一值取消，选择另一值替换。空值、空文本、布尔值和数字文本不混同；不存在或当前不可见的值不产生新选择。
- 仅明确连接的目标被筛选。来源卡片不因自身选择而消失；来源／目标歧义、字段缺失或规则变化使旧选择不生效，不按同名字段猜测连接。
- 保存回执同时重接筛选卡片身份与联动页面身份；配置连接键不按服务端区块编号重建。导出开始时冻结的阅读快照不受后续点击、保存身份变化影响。
- 阅读筛选针对报告保留的行，不查询来源数据，不宣称筛选覆盖数据库全部记录。完整 Excel 仍使用其原有完整报告路径。

## 参考和验证边界

采用 [React reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer) 的集中动作更新与 [Metabase cross-filtering](https://www.metabase.com/docs/latest/dashboards/interactive#use-a-chart-to-filter-a-dashboard) 的显式目标模式；点对象以本项目安装的 Recharts 2.15.4 源码和类型为准，对照其 [官方渲染源码](https://github.com/recharts/recharts/blob/v2.15.4/src/chart/generateCategoricalChart.tsx)。未复制第三方代码，也未新增依赖。

定向检查涵盖页内／跨页选择、精确标量、保存身份对齐、非法点对象、编辑清除和冻结导出。模拟打印与 API 不证明 PDF 已落盘或真实报告已保存；完整安装包、原生输入和真实指针交互仍需单独验证。
