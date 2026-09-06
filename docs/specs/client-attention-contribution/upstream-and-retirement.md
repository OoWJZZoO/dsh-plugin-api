# Upstream Proposals And Retirement Conditions

> feature_name: `client-attention-contribution`
> milestone: M9
> status: Stage 4 制品（与 tasks.md Wave 3.8/4.8 对应）；feature-list §3.1 的 registry 登记由集成波执行。

本文登记本 feature 两个 R slice 各自的 U-series 上游提案与退役条件（`docs/standards/capability-strategy.md` §4.1）；官方组件提供等价公开 seam 后，对应 slice 进入 deprecation 并按登记条件退役迁移回官方绑定。

## 1. api-remotes slice（`@deepseek-ai/dsh-plugin-api-api-remotes`）

- **归属官方组件**：`@deepseek-ai/dsh-api-remotes`（web profile 行 `api-remotes`）。
- **覆盖能力**：完整复刻官方 `api-remotes` 行契约（11 事件转发白名单常量 + Remote Agent/Session identity BFF + client manifest 半面），并承载 `attention/update` typed 扩展转发——hub 产出的注意力和更新经替换模块自身的复刻转发路径沿官方 host→browser 事件流送达浏览器 runtime；消费者侧 `ctx.remote.$on` 合法键集保持复刻后的 11 键（`attention/update` 不经 `$on`）。
- **U-series 上游提案**：**官方白名单之外的 typed publication seam**——官方组件层提供非白名单语义的、可独立声明的 host→browser typed 事件投递面（接入官方 host 转发机械、浏览器侧原生发现与订阅），使本 slice 的注意力转发扩展成为官方一等语义，替代模块自身复刻转发路径。
- **退役条件**：官方 `dsh-api-remotes`（或该组件聚合面）提供等价的非白名单 typed publication seam 且 browser 侧原生投递到 `ctx.pluginApi.attention` 等价消费者面时，本 slice 的 `attention/update` 扩展迁回官方绑定；白名单/BFF 复刻面随行退役。执行退役时注册官方行重新启用、本包替代行停用，迁移期间消费者满两个面契约等价。

## 2. client-runtime slice（`@deepseek-ai/dsh-plugin-api-client-runtime`）

- **归属官方组件**：`@deepseek-ai/dsh-client-runtime`（web profile 行 `client-runtime`）。
- **覆盖能力**：完整复刻官方 `client-runtime` 行浏览器模块契约（slots / slots/changed、conversationEvents、conversationViews、connection/reset、sessions/workspaces reflect outward face + client manifest 半面），并承载浏览器 attention runtime——转发消息对账/去重、`connection/reset`/HMR 的 epoch 重建、host snapshot 重取、slots 呈现集成；主包 client 面在其上运行，重载后免第三方 `$mount` 胶水。
- **U-series 上游提案**：**官方原生 attention/reconnect seam**——官方 `dsh-client-runtime` 浏览器模块原生提供注意力消息消费与 reconnect/rebind 重建语义（含连接周期内 projection 重建、消息对账与去重），第三方无需 replacement 即可获得当前由本 slice 提供的注意力运行时。
- **退役条件**：官方 `dsh-client-runtime` 提供等价的原生 attention/reconnect seam 时，本 slice 的注意力运行时扩展迁回官方绑定；slots/conversation/reflect 复刻面随行退役（保持官方行 contract 原样）。执行退役时注册官方行重新启用、本包替代行停用，浏览器面在官方连接周期内重建语义等价。

## 3. 残余 C 类（证据与退役说明）

- **原生动态发现**（任意 client 插件免 inject/装配即发现 remote 面）：官方 client loader/module-table 语义横跨多组件、无单一 owner 可替换闭合；两替换行激活后装配面收窄为「注入被替换模块或主包」的受支持路径，官方 loader 提供原生发现后本 feature 直绑并退役该 C 备注。
- **UI 载体**（浏览器 Notification 权限/声音/具体 framework 行为）：始终是 consumer 侧选择，不是门面能力；本 feature 不承诺、不实现。

## 4. Registry 登记（集成波执行）

- 两 slice 在 `docs/specs/plugin-api-features/feature-list.md` §3.1 报备登记（跨组件 R 类），每包唯一官方 owner、完整复刻、boot 自检、版本锁、无双跑、退役条件如本文。
- 本文与 requirements/design 的 R 决策表一致；登记内容与实现包名/行 id 一致。