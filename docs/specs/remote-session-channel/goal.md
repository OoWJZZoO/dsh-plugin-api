# Stage 0 - Goal

## Feature Name

`remote-session-channel`

## Status

SPEC1 Stage 0：Goal 草案，等待用户确认。用户已明确批准本 feature 采用 R 类通道（2026-08-26）。

## Goal

为第三方客户端、移动端和远程 Web UI 提供统一的跨设备 session channel 契约，覆盖配对、授权、连接能力协商、事件订阅、确认、心跳、断线恢复和撤销。

当前生态插件各自实现 pairing、authorized devices、SSE/polling fallback、ack/heartbeat、session RPC、tunnel status 和 replay。已有 `remote.publish`、client `$mount` 等能力主要解决插件 UI/config bridge，不提供跨设备 session 的 resume、cursor、幂等投递和权限边界。因此同一 session 在断线、重复投递或设备撤销时缺少一致行为。

本 feature 通过 R 类 replacement bundle，替换负责远程通道与认证边界的官方 gateway/remote loader 行，在保真复刻官方 HTTP route、认证、服务和事件契约后，增加规范化 remote session channel 能力。

## Primary Users

- 实现移动端或远程 Web UI 的插件作者；
- 需要跨设备观察、控制或恢复 session 的客户端作者；
- 负责设备授权、审计和连接故障诊断的宿主维护者。

## Scope Summary

- channel 打开与设备能力协商：`SSE`、polling、WebSocket、loopback；
- pairing、授权设备、撤销和 presence/heartbeat；
- 按 session 与 cursor 订阅事件，支持 `ack`、resume token 和 snapshot resync；
- 明确定义 at-least-once delivery、dedupe key、游标失配和重放边界；
- 每方法的 authorization、redaction、rate limit 与 bounded audit；
- generation/epoch 与 stale connection 防护，避免旧设备连接向新状态写回；
- R 类只替换一个官方 gateway/remote owner 行，保留官方服务/事件面和 import 面；
- 失败时按 fail-safe 降级，不因远程通道不可用而杀死宿主 boot。

## Expected Result

客户端可以打开一个受授权的 session channel，订阅指定 cursor 之后的事件，并在断线后使用 resume token 与最后确认 cursor 恢复。重复投递可由稳定 dedupe key 消除；游标无法连续恢复时，客户端得到明确的 snapshot resync，而不是静默丢事件。设备被撤销、权限不足、transport 不可用或连接过期时，系统返回有界、可审计的 typed 结果。

示例流程：手机完成 pairing 后调用 `channel.open({ device, capabilities, resumeToken })`，随后 `subscribe({ session, cursor })`；收到事件后调用 `ack(cursor)`。网络中断后调用 `resume(token, cursor)`，若服务端发现 cursor 已超出保留窗口，则返回 `resync-required` 与新的受限 snapshot。

## R-Class Boundary

- 替换单位是官方 gateway/remote loader 的完整行，不跨组件替换；具体官方 row id、runtime identity 与唯一 owner 在 Requirements/Design 阶段经源码核实后冻结；
- replacement 必须保真复刻被替代行的 ctx service/event 面、HTTP route 和授权失败语义，再增加 channel contract；
- 不覆盖 `@deepseek-ai/dsh-*` 包 import 面，不修改官方安装目录；
- 必须具备 boot 自检、runtime/package 版本锁定、组件唯一 owner 冲突检测和 fail-safe 停用；
- R bundle 不拥有横切 priority、deepFreeze 或 fault-containment 语义；
- 若源码核实无法证明稳定的官方 auth/transport owner，Requirements 阶段应暂停并将该部分登记为 C 类上游提案，而不是伪造 replacement 边界。

## Non-Goals

- 不重新实现通用 `pluginApi.remote.publish`、client `$mount` 或普通设置/配置桥；
- 不承诺 exactly-once 网络投递，默认采用明确的 at-least-once + dedupe 语义；
- 不提供任意远程 shell、文件系统或工具执行授权；这些权限仍由既有 approval/security/tool owner 决定；
- 不把远程 channel 变成新的 durable session store，不复制官方 transcript；
- 不在本阶段确定具体 transport 实现、认证协议或 wire schema，待 Requirements/Design 源码核实后冻结。
