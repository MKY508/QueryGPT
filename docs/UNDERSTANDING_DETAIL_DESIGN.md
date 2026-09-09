# 项目理解

桌面布局与尚未归并的范围见 [桌面界面合同](DESKTOP_UI.md)。本文件只维护已归并模块的交互约束。

## 保存冲突与结果核对

交互参考 [VS Code 冲突选择](https://code.visualstudio.com/docs/configure/settings-sync#conflicts)、[React 身份隔离会话](https://react.dev/learn/preserving-and-resetting-state#resetting-state-with-a-key)及 [PatternFly 内容卡片](https://www.patternfly.org/components/card/design-guidelines/)，沿用现有依赖，不自动覆盖或合并。

- 保存结果核对项目、条目／键、新版本及提交的名称、说明、类型和采用状态；不明确结果保留表单。新建沿用首次提交的目标键，不随名称编辑另建目标。返回校验不是全部派生字段的等价证明。
- SemanticSaveRecovery 按项目、定义键／身份及预期版本重建会话；读取为互斥状态，同步锁阻止重复读取。目标改变／卸载取消原请求，迟到响应不能污染新目标。语言与草稿文字改变保留当前比较；读取完成仅在用户仍停留于原操作时交接焦点。
- 仅明确点击才读取：已有定义按项目／ID，新建按原始键精确 lookup。当前已保存与我的输入固定双栏，卡片 12px、动作复用 Button；读取不修改表单，不表示此前保存已成功。
- 未变版本或未找到创建目标才允许返回编辑，按钮本身不写入；未找到不保证旧写入已终止。载入需二次确认替换整个表单；取消保留草稿，确认交回读取的完整定义，编辑器更新基线／版本并聚焦名称。移除、错归属与失败结果不可载入。
- 仅比较业务名称与说明，不提供字段级差异、三方合并、强制覆盖、持久回执或跨重启恢复。真实保存／lookup 接口及全页面行为仍需联调；历史模拟测试不能证明已部署。

当前桌面验证与截图见 [桌面界面合同](DESKTOP_UI.md)。
