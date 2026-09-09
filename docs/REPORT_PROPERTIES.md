# 报表属性

属性栏只编辑当前报告草稿，不读取接口、执行聚合或保存文档。桌面尺寸、圆角与共享控件以 [DESKTOP_UI.md](DESKTOP_UI.md) 为准；页面联动规则以 [REPORT_READING.md](REPORT_READING.md) 为准。

## 模块归属

| 模块 | 职责 |
| --- | --- |
| ReportPropertyPanel | 页面／内容范围、选中身份、通用标题和布局，编排适用的属性 |
| ChartPropertySettings | 图表类型、坐标、数值序列、方向、堆叠、配色和显示格式；只产生当前区块更新 |
| MetricFormatSettings | 指标显示方式和预览，复用精确数字格式化，不重算指标 |
| ReportInteractionSettings / ReportFilterConnections | 页内图表联动及跨页筛选映射，交给现有文档编辑回调 |
| ReportPropertySection | 折叠及可访问名称；隐藏保留字段，折叠本身不修改报告 |

图表字段识别复用 `report-interactions.ts` 与 `report-rows.ts`，不只查看第一行，也不维护第二套行集合解析。图片图表只有类型说明，不显示不能生效的字段／格式控件。切换图表类型同步约束单序列与堆叠；其他配置保持原值。切换选中区块重建该区块的折叠状态，普通编辑不重建。

组织方式参考 [Metabase 可视化设置](https://www.metabase.com/docs/latest/questions/visualizations/visualizing-results)：按当前图表呈现适用设置。只参考交互分工，不复制其源码或增加依赖。

## 当前验证

5 条图表属性定向用例、限定 ESLint 与前端类型检查通过。Chrome 1180×800 中英文验证实际报告进入编辑、选择图表、改配色及折叠重开：属性栏 320px，字段 6px 圆角，无页面横向溢出、运行时错误或服务写入。输入来自虚构只读预览，不证明真实保存、所有报表类型或发布构建可用。
