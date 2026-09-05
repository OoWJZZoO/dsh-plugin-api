# Stage 0 Goal: session-interaction-operation

> feature_name: `session-interaction-operation`
> milestone: M9
> status: Stage 0 goal draft; Requirements/Design/Tasks not started

## Goal

为第三方插件提供受 authority 约束的 session interaction operation，使插件能够请求宿主处理一条新的 session interaction、请求取消正在进行的处理，并获得稳定的 operation identity、activity/execution correlation、幂等结果和唯一终态，而不必通过 append、flush、事件重入和私有 RPC 猜测 agent loop 行为。

该 feature 的公共主面是 `operation`，建议挂在 `pluginApi.sessions.request` 与 `pluginApi.sessions.cancel`。`appendMessage` 仍然只是受限 durable mutation；本 feature 不把写入消息、启动处理、取消信号和 retry 混成一个动词。

## Why

`dsh-auto-continue` 及多个 Web/TUI 插件需要在失败或中断后重新发起 session interaction、取消请求、处理重复发送和重连扫描。当前插件往往直接调用 client connection API，或组合 session append 与底层事件，因而无法共享一致的 idempotency、attempt、activity、AbortSignal 和 stale-result 语义。

门面需要把“请求宿主开始一次处理”与“把内容写进 session”分开，使第三方插件能够安全实现自动继续、人工控制、交互式 UI 和受控的 session automation。

## Scope direction

- 提供 request operation：输入 session、message/source、idempotency key、可选 parent/cause 和 `AbortSignal`，返回 accepted/duplicate/already-running/rejected/unavailable 等稳定结果或 operation handle。
- 提供 cancel operation：取消是信号，不直接伪造终态；最终 outcome 由 session/agent authority 在提交点裁决为 `aborted`、`superseded` 或其他合法 terminal。
- 每次外部 request 创建独立 execution identity；内部 retry/attempt 不伪造新的外部 request，且必须遵守 activity、recovery 和 operation capability contract。
- request/cancel 必须能与 `sessions.activity` projection 关联，并支持重连、重复调用和旧 operation 迟到结果的安全处理。
- 优先评估协同 R 类实现：session loader 负责 durable interaction、activity/session cursor；agent-loop/agent loader 负责 request acceptance、cancel boundary 和 execution/attempt authority；LLM stream 与 tools/approval 组件仅在其原官方行拥有不可替代的 request/settlement 或 interaction evidence 时增加独立 replacement slice。三至四个官方组件的协同 replacement 具有价值，但每个包仍只替换一个官方组件行并完整复刻其原 service/event 面。
- 若官方 request authority 无法被完整复刻，先交付 capability-gated 的最小 operation projection/typed unavailable 边界；不得以 append→flush→猜事件的方式把 C 类假设伪装成完整 request API。

## Boundaries

- `sessions.appendMessage` 不被改名为 request，也不自动启动 agent loop。
- 本 feature 不拥有 route policy、LLM admission、tool exposure、recovery policy 或 notification presentation；它只消费这些领域已经公开的决定和能力。
- `cancel` 不保证底层 provider 或外部工具立即停止；正确性依赖 operation identity、generation 和提交资格检查。
- 不提供通用 `retry()`；重试由 recovery/agent authority 按 attempt capability 和幂等声明决定。
- 不修改官方包文件；R 实现只替换官方 ctx service/event 面，不替换官方 package import 面。

## Expected result

第三方插件可以通过一个受支持的 session operation 面发起或取消交互，并明确知道请求是否被接受、重复、拒绝、取消或不可用。自动继续、交互 UI、TUI 控制和其他 session automation 不再需要自行拼接多个私有 API；在 authority 不存在或 replacement 缺失时，能力按 typed unavailable 安全降级，而不是静默误报成功。

## Stage boundary

本文件只确认 Goal 方向。Requirements 应将 request/cancel operation、idempotency、activity/execution/attempt 关系、取消传播、R slice 完整契约和 authority closure 写成 EARS；Design 再确定官方 loader owner、三至四包协同是否经济、客户端半面和装配顺序；Tasks 通过审查后才进入实现。