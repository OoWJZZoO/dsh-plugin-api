# Stage 0 Goal: client-attention-contribution

> feature_name: `client-attention-contribution`
> milestone: M9
> status: Stage 0 goal draft; Requirements/Design/Tasks not started

## Goal

为第三方插件提供统一、可撤销、可去重且可重连的 client attention contribution，使插件能够向 Web、TUI 或其他 client consumer 提供 scoped notification、toast、status indicator 和 action，而不必各自手写 remote、slot、browser notification 和 stale cleanup 胶水。

该 feature 的公共面明确拆分为两个 idiom：`publish`/`dismiss` 是 `contribution`，当前 attention 集合与变化订阅是 `projection`。它不拥有 session activity 的事实判断，也不把浏览器权限、声音播放或具体 UI 呈现策略塞进 host 门面。

## Why

`dsh-notification`、`dsh-session-notification`、`dsh-auto-continue`、cost/task UI 和其他 Web/TUI 插件都重复实现 turn 完成通知、失败提示、pending interaction、去重、action 生命周期和 reconnect 后的状态重建。已有 client slots、remotes、settings 和 lifecycle 能力解决了“如何挂载”，但还没有统一的 attention contribution contract。

一个小而明确的 attention 面可以让 `sessions.activity` 成为状态事实来源，让不同 client consumer 自由选择浏览器通知、toast、徽标、TUI 状态栏或桌面通知，同时共享 owner、scope、redaction、dedupe 和 stale cleanup 规则。

## Scope direction

- 提供 owner-scoped `publish(spec)`、`dismiss(id/handle)` 和 projection-style `observe()`；贡献项包含 scope、level、标题/正文、dedupe key、过期时间、可选 action 和 audience。
- contribution handle 使用既有 `{id, ownerId, seq, dispose()}` 形状；同 owner 同 id 冲突、跨 owner 冲突、重复 dispose 和迟到 callback 均按既有 contribution idiom 处理。
- attention view 只返回冻结、脱敏、可重建的 projection；host/client generation 或 remote rebind 后，旧 contribution 不得写回新 client face。
- 支持 client unavailable、partial face、reconnect、HMR、旧 action 和过期条目的局部降级，不因单个 consumer 缺失而停用 host activity 或其他 contribution。
- 优先评估跨组件 R：`dsh-client-runtime`/slots 提供 client contribution owner，`dsh-api-remotes`/gateway 提供 host↔client publication，`dsh-session`/activity owner 提供 session-scoped state correlation；若通知权限或桌面 transport 是独立官方组件，再评估第四个 slice。三至四包协同 replacement 可以形成完整能力，但每个 replacement 包只归属一个官方组件并完整复刻其原 client/host 面。
- 若官方 client loader 的动态发现或 rebind 边界不足，优先以 replacement 扩大能力面，而不是要求每个第三方插件继续手写 `$mount`；若无法证明替换契约，才保留现有 remote/slot facade 的最小可用实现。

## Boundaries

- 不决定何时 session 完成；activity projection 是事实来源，attention 只是消费和呈现贡献。
- 不申请浏览器 Notification permission，不承诺声音、桌面通知或特定 UI framework 行为。
- 不提供通用 client state store、scheduler、message bus 或任意 remote namespace 动态发现的替代品。
- 不把 attention contribution 写入 session durable history；如需审计，应由具体 consumer 或 activity/session feature 负责。
- 不修改官方包文件；任何 R slice 只替换官方 ctx/client service/event 面，不覆盖官方 import 面。

## Expected result

第三方插件可以发布一条带 session/workspace scope 的 attention contribution，并在 Web/TUI/desktop consumer 中以相同的生命周期、去重、redaction 和 rebind 语义呈现。client 缺失或重连时，贡献按 generation 安全降级，旧 action 和 stale disposer 不会影响新 client 状态。

## Stage boundary

本文件只确认 Goal 方向。Requirements 应将 contribution/projection 双面、client generation、scope、redaction、action、R slice 的 host/client 契约写成 EARS；Design 再确定各官方组件 owner、完整 client half、动态发现替代和装配顺序；Tasks 通过审查后才进入实现。