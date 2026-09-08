# 分析服务目录

更新：2026-09-09。本文维护服务目录与连接检查的当前合同；模型协议、能力探测和执行引擎以 [架构](architecture/ARCHITECTURE.md) 为准。

## 交互

- 每项服务集中显示名称、提供方、所用模型、默认标记、检查状态和操作。名称打开原有编辑流程；选择、填写、放弃与保存沿用现有表单会话，不建立另一套配置。
- 连接地址、协议、耗时和错误分类只在该服务的原生「连接详情」中展开；不显示后端自由文本错误。不再有脱离服务身份的全局检查摘要。
- 目录复用 SettingsCollection 的显式字段搜索、状态筛选和 12 项分页。服务名称、提供方和模型名可搜索，其他配置字段不参与。筛选依据与服务项的健康状态一致；通过检查的项目可以离开「需要处理」筛选。
- 布局采用容器宽度响应，而非仅看窗口宽度；并排编辑压窄目录时同样换行。外观复用现有主题变量和字体；服务标记是文字标识，不冒充供应商品牌图形。

## 所有权

| 模块 | 职责 |
|---|---|
| model-service.ts | 凭证与健康状态的区分、结构化检查结果到业务文案的映射 |
| useModelServiceChecks | 按服务隔离的在途请求、结果及失效处理 |
| useModelSettingsResource | 配置读取／写入，保存后发起检查，成功写入前撤销旧读取 |
| ModelSettingsList / ModelServiceCard | 目录筛选与服务项呈现，不拥有网络请求 |
| ModelProviderIdentity | 提供方的名称与文字标记 |

- 同一服务的重复检查在事件入口合并，不依赖按钮下一次渲染。不同服务可分别检查，先后完成互不覆盖；请求返回的身份不能改写其所属服务。
- 修改或删除一项配置只让该项旧检查失效；迟到结果不能覆盖新检查或复活已删除的结果。卸载后不再发布结果；忽略前端结果不等于终止服务端模型调用。
- 检查未完成与检查返回失败是不同状态。保存成功后检查失败仍是「已保存」，不变成保存失败。错误状态只存语义类别，显示时按当前语言翻译。
- 已保存密钥不是服务可用的证明。当前检查回执优先于尚未刷新到的健康记录，但缺失／不可读取的凭证仍需要处理。
- 回执只存在于当前设置组件中；重新加载使用服务端已有健康记录，不新增跨页面日志或凭证持久化。所有检查仍使用原有接口，没有安装新依赖。

## 来源与验证边界

参考 Cherry Studio 的 [ProviderListItem](https://github.com/CherryHQ/cherry-studio/blob/e6abc60412ed40fbdba193776d902da963a4a352/src/renderer/pages/settings/ProviderSettings/components/ProviderListItem.tsx) 与 [行级操作分工](https://github.com/CherryHQ/cherry-studio/blob/main/src/renderer/pages/settings/ProviderSettings/ProviderList/ProviderListItemWithContextMenu.tsx)。采用身份、选择与行级操作分离的结构；没有复制其 UI 包、菜单框架或拖动逻辑。

定向验证入口是 model-settings-list、model-settings-resource、model-settings-form-i18n，以及 settings-collection 中的服务筛选和编辑草稿检查。浏览器使用正在运行的隔离工作台预览，检查响应全部模拟；实际模型可达性、账号额度、生产构建与桌面安装包不在这些检查的证明范围内。

当前工作区的虚构数据预览：[桌面目录](images/zh/model-services-directory-desktop.png)、[英文窄屏详情](images/zh/model-services-directory-mobile-en.png)。Chrome 覆盖并行检查、详情键盘展开、搜索、编辑草稿跨宽度保留和深色主题；未模拟真实手机软键盘或完整读屏。
