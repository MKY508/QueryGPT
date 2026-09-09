# 配置表单

模型和数据库表单共用 `SettingsForm`、`SettingsDisclosure` 与 `SettingsForm.module.css`。字段仍由各业务表单明确声明，不引入字段配置语言或新的表单依赖。目录见 [分析服务](MODEL_SERVICES.md)，页面会话与离开行为见 [设置工作区](SETTINGS_WORKSPACE_DESIGN.md)。

## 结构与操作

- `SettingsForm` 拥有表单语义、字段滚动区、提交状态、错误数量与底部操作；业务组件只提供字段、验证结果和提交回调。独立页面与侧栏使用同一内容和操作区，`embedded` 仅决定是否显示本地标题、关闭按钮与外框。
- 布局以表单自身为 CSS 查询容器：不足 36rem 用单列，否则两列。长地址、数据库文件路径和跨列选项占满可用宽度。不能以整个窗口宽度判断 460px 侧栏的字段布局。
- 字段可滚动，保存和取消留在滚动区外；提交期间字段及两个操作按钮禁用。底部考虑安全区域，输入字号 16px，颜色沿用主题变量。
- 编辑已有模型时只显示当前服务入口，展开后才显示供应商选择；新建时默认展开。选择后收起并把焦点留在入口。同一服务重复选择不清空填写内容；更换服务重设模型、地址和协议，清空密钥及附加请求参数，但保留名称和默认选项。
- 协议、无需密钥、附加请求头和查询参数在一个原生高级折叠区。服务类型不再出现第二个下拉框，所选协议也不额外重复说明。

## 校验

- `validation.ts` 只返回字段与问题类别，`useSettingsValidation` 负责提交后反馈、双语错误、标签关联和定位。首次填写不报红；失败提交后随修改清除已解决问题，编辑对象变化时重置反馈。
- 错误紧跟字段；底部数量可重新展开含错误的折叠区并定位首个问题。真正的其他模态保留焦点，普通 `open` 面板不阻断定位；自己的模态也不阻断自己的字段。
- 名称长度按 Unicode 码点计算。服务地址检查完整 HTTP(S) 地址、端口、内嵌凭证和片段；Qwen、自定义网关要求地址。JSON 复用已有 `parseJsonMap`，不在父页面重复执行一套表单校验。
- 端口用 `valueAsNumber` 保留空值和小数，验证 1–65535 的整数，不截断输入。SQLite 不要求远程连接字段；其他类型沿用服务端的证书路径、证书配对、CA 和 PostgreSQL 模式规则。
- 校验不检查真实主机、文件、密钥或模型能力；这些结果由既有连接检查和实际分析提供。没有自动保存或新凭证持久化。

## 默认值依据

- [Groq 的 OpenAI 兼容接口](https://console.groq.com/docs/openai)使用 `https://api.groq.com/openai/v1`。当前[模型目录](https://console.groq.com/docs/models)将 Llama 3.3 70B 标为 Enterprise，新选择 Groq 时改填公开目录中的 `openai/gpt-oss-120b`；不修改已保存服务的模型。
- [Qwen 官方接口说明](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)要求密钥与区域匹配，并提供工作空间域名。表单要求用户填写其工作空间地址，不猜测区域或空间身份。
- OrcaRouter 的地址与 `orcarouter/auto` 依据[官方说明](https://docs.orcarouter.ai/introduction)。推广链接沿用项目现有配置并标明推广关系；显示入口不证明新用户归因、抽成或到账。

## 来源与验证边界

结构参考 PatternFly 的 [Drawer](https://www.patternfly.org/components/drawer/design-guidelines/)、[Form](https://www.patternfly.org/components/forms/form/design-guidelines/)以及 [DrawerPanelBody 源码](https://github.com/patternfly/patternfly-react/blob/main/packages/react-core/src/components/Drawer/DrawerPanelBody.tsx)中的内容区分工。只采用组合思路，没有复制其源码或引入组件包。

定向入口：`settings-validation`、`model-settings-form-i18n`、`connection-settings-form`。校验用例覆盖字段规则、实际表单关联、折叠错误定位、忙碌操作及模态焦点边界；组件模拟不能证明浏览器排版。

当前工作区的 Chrome 预览检查 1440×1000 侧栏、1024×768 全屏双列、390×600 和 390×844 单列；验证相同输入节点／选区、字段纠错、服务选择收起和 SQLite 字段切换，无横向溢出，底部操作可见。预览使用虚构配置、拒绝全部写请求，无页面异常；包含中英文和深色截图检查。

预览图：[模型编辑](images/zh/settings-form-layout-model.png)、[英文连接编辑](images/zh/settings-form-layout-connection-en.png)。未验证真实配置写入、供应商请求、系统软键盘、Safari／Firefox、完整读屏、生产构建或已安装桌面程序；页面和桌面退出链路也不是本次表单验证的完成项。
