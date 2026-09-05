# Stage 0 Goal: session-activity-projection

> feature_name: `session-activity-projection`
> milestone: M9
> status: Stage 0 goal draft; Requirements/Design/Tasks not started

## Goal

为第三方插件提供统一、可重建、可去重的 session activity projection，把一次真实的 session turn / execution 从 agent、LLM、tool、approval、question 和 session durable 事实中收敛为一个冻结的活动视图。插件应能够可靠判断 session 当前是在运行、等待交互、已经完成、失败、中止还是被新代次取代，而不必各自从多个底层事件猜测状态。

该 feature 的公共主面是 `projection`，建议挂在 `pluginApi.sessions.activity`。它不负责调度、重试、通知或修改 session，只负责提供具有明确 activity identity、execution correlation、cursor、epoch 和终态的只读视图与 `observe()` 订阅面。

## Why

`dsh-notification`、`dsh-session-notification`、`dsh-auto-continue`、`dsh-cost-meter`、TUI 和 Web UI 类插件都重复实现 running edge、tail settle、重连扫描、旧事件去重和终态推断。已有底层事件足以支持若干消费者，但缺少一个由门面统一定义的跨域观察语义。

一个稳定的 activity projection 会成为 M9 其他 feature 的共同观察底座：session interaction operation 需要它表达 request 与 execution 的关联；client attention 需要它决定何时向用户展示状态；checkpoint/restore 需要它记录 checkpoint 来源、提交资格和恢复后的新旧代次。

## Scope direction

- 提供 session-scoped activity identity，并与 facade execution identity、session identity 和可用的 agent/tool/LLM correlation 关联。
- 提供冻结的 `current` / `snapshot` 以及统一 `observe` handle；订阅可在 reconnect 或 owner epoch 重建后安全恢复。
- 统一 activity state、pending interaction、terminal outcome、updated cursor 和 provenance 的词汇。
- 明确区分 observed、reconstructed、unknown 和 unavailable；缺失事件不得被静默推断为成功。
- 对旧 activity 的迟到事件、重复 durable record、重连 replay 和新 generation 进行 stale-result containment。
- 优先评估协同 R 类实现：session projection / durable owner、agent-loop activity boundary、LLM stream settlement、tools/approval interaction evidence 可分别由各自官方组件 replacement slice 承载；若采用三至四个官方组件协同，公共 projection 仍只有一个 facade owner，且每个 replacement 包只替换并完整复刻自己的官方行。
- R 协同不是强行拆包：若某个 slice 无法证明原官方 service/event 契约可完整保留，则该 slice 必须局部降级或回到最小 facade 组合，不以隐藏 C 类假设冒充完整 activity 事实。

## Boundaries

- 不提供 `request`、`cancel`、`retry`、`notify` 或 checkpoint restore 动作；这些由 M9 其他 feature 负责。
- 不把 event sequence 当作 activity identity；cursor 只用于重放、去重和重连。
- 不把 activity projection 变成新的 scheduler、execution authority 或 recovery policy owner。
- 不声称证明模型看到了某段内容，除非已有真实 assembled/send evidence；内容 provenance 与 evidence 只暴露其可证明部分。
- 不修改官方包文件；任何 R slice 只通过官方 patch 机制替换 ctx service/event 面，不覆盖官方 import 面。

## Expected result

第三方插件可以只依赖 `pluginApi.sessions.activity`，在 headless、Web 和 TUI 场景以相同的 projection/observe 语义判断 session activity，并在重连、重复事件、局部官方能力缺失和旧代次迟到时安全降级。后续 M9 feature 可以消费同一套 activity identity、终态和 cursor，而不再各自创建互不兼容的状态机。

## Stage boundary

本文件只确认 Goal 方向。Requirements 应将 activity state machine、identity/cursor/epoch、visibility、R slice 契约和 fail-safe 验收写成 EARS；Design 再确定 facade 与各官方组件 replacement slice 的实际 owner、装配顺序和是否需要完整 client half；Tasks 通过审查后才进入实现。