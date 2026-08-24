# Stage 0 - Goal

## Feature Name

`client-generation-rebind`

## Status

Stage 0 Goal 已由用户确认。

## Goal

为第三方 client 插件提供统一的 host/client contract generation 与 rebind 生命周期，解决 remote、slot、settings contribution 在晚绑定、重连、版本变化或宿主部分不可用时的旧状态写回和资源泄漏问题。插件应能知道某个 face 当前是否可用、何时换代，并让旧 generation 的异步结果和 disposer 自动失去提交资格。

generation 只表达一个明确 owner 的生命周期，不把浏览器刷新、传输重连和 Typert schema version 混成同一个全局计数器。host 仍是权威状态来源，client 不自行创建 execution、usage 或 durable records。

## Scope Boundary

- 包含：face capability/version 注册、owner-local generation、availability 查询、rebind 通知、remote/slot/settings contribution 的 epoch 绑定、旧异步结果隔离、重复 mount/dispose 保护和逐 contribution 降级。
- 复用现有 client manifest、connection、remote、settings 和 slot 面；不重新定义这些官方服务的成员、RPC payload 或事件语义。
- 首版优先作为 B 类 client lifecycle facade；若审计证明某个官方 client loader 是 generation/rebind 的唯一 owner，再单独评估 R 类，不能在 Stage 0 预设 replacement 或复制官方 browser bundle。
- client scope 诊断与 host availability 通过 `plugin-diagnostics` 互操作，但本 feature 不拥有诊断检查状态，也不提供 UI 组件或自动 repair。
- 不包含新的远程 session channel、transport resume/ack 协议、profile mutation、execution/usage authority、跨 owner generation 比较或修改官方包文件。

## Expected Result

Web、TUI 和嵌入式 client 插件在 host 重连、remote face 缺失、模块重新加载或 schema 不兼容时，可以安全地重新绑定并释放旧资源。旧 generation 的 pending call、回调和 disposer 不会污染新状态；单个 contribution 失败只使自身 degraded/unavailable，不会关闭整个 client facade。
