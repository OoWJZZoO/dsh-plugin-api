# Stage 0 - Goal

## Feature Name

`remote-session-channel`

## Status

SPEC1 Stage 0–2 修订稿：本 feature 原按"纯 R 单行替换"方向确认，Stage 2 源码审计得出 R no-go（无官方 auth owner），结论为转 C 类上游提案（U21）。2026-08-27 用户指示改为 **B+R 混合设计**：认证抽象与 session 游标/重放机械层为 B 类门面，transport 载波与 channel RPC 派发为两个 R 替换包（`connection`、`gateway`），跨组件协同在 feature-list §3.1.1 报备登记。本批仅修订 goal/requirements/design 三份制品，不产出 Tasks；修订稿待用户确认。

## Goal

为第三方客户端、移动端和远程 Web UI 提供统一的跨设备 session channel 契约，覆盖配对、授权、连接能力协商、事件订阅、确认、心跳、断线恢复和撤销。

当前生态插件各自实现 pairing、authorized devices、SSE/polling fallback、ack/heartbeat、session RPC、tunnel status 和 replay。已有 `remote.publish`、client `$mount` 等能力主要解决插件 UI/config bridge，不提供跨设备 session 的 resume、cursor、幂等投递和权限边界。因此同一 session 在断线、重复投递或设备撤销时缺少一致行为。

本 feature 采用 **B+R 混合设计**：

- **B 类门面（`pluginApi.sessionChannel`）**：认证抽象层（可插拔配对/设备认证/逐方法授权，接口尽量通用以兼容尽可能多的范式，具体范式由第三方插件经注册接口决定）+ session 游标/ack/重放/resume 机械层（B 类实现）+ 投递去重、脱敏、审计与代次围栏；
- **两个 R 替换包**：`connection`（复刻官方 `dsh-client-connection` 行契约，增加 transport 协商与连接层 channel 代次围栏）与 `gateway`（复刻官方 `dsh-api-gateway` typert-gateway 行契约，增加 channel 方法 RPC 派发与 remote 命名空间扩展）。

## Primary Users

- 实现移动端或远程 Web UI 的插件作者；
- 需要跨设备观察、控制或恢复 session 的客户端作者；
- 负责设备授权、审计和连接故障诊断的宿主维护者。

## Scope Summary

- channel 打开与设备能力协商：`SSE`、polling、WebSocket、loopback（由 connection R 包在官方载波上协商）；
- 认证抽象：配对、授权设备、撤销（B 门面提供注册接口，范式由第三方插件决定）；presence/heartbeat 为 B 门面机械层行为（只更新本 channel generation）；
- 按 session 与 cursor 订阅事件，支持 `ack`、resume token 和 snapshot resync（B 门面）；
- 明确定义 at-least-once delivery、dedupe key、游标失配和重放边界（B 门面）；
- 每方法的 authorization、redaction、rate limit 与 bounded audit（B 门面）；
- generation/epoch 与 stale connection 防护，避免旧设备连接向新状态写回（B 门面 + connection R 连接层代次围栏）；
- channel 方法经 gateway R 的 RPC 派发面进出；
- 失败时按 fail-safe 降级，不因远程通道不可用而杀死宿主 boot。

## Expected Result

客户端可以打开一个受授权的 session channel，订阅指定 cursor 之后的事件，并在断线后使用 resume token 与最后确认 cursor 恢复。重复投递可由稳定 dedupe key 消除；游标无法连续恢复时，客户端得到明确的 snapshot resync，而不是静默丢事件。设备被撤销、权限不足、transport 不可用或连接过期时，系统返回有界、可审计的 typed 结果。配对/认证的具体范式由第三方插件经 B 门面注册接口决定；未配置任何认证范式时，channel 打开显式 `unavailable`（fail-closed），绝不退回未认证通道。

## B+R Architecture Boundary

- **B 类门面（认证 + session 机械层）**：
  - 提供可插拔认证抽象：`registerVerifier`（设备凭证验证）、`registerPairingProvider`（配对流程）、`registerAuthorizer`（逐方法授权）——接口尽量通用，兼容 approval/PIN/二维码/token 等多种范式，具体使用由第三方插件决定；
  - 认证语义只由已注册的 verifier/pairing/authorizer 链提供；未注册任何 verifier 时 channel 打开 fail-closed 为 `unavailable`；
  - B 门面实现 session 游标/ack/重放/resume 机械层、at-least-once 投递与 dedupe、脱敏、审计、代次围栏与取消传播；
  - B 门面不使用任何官方行的 replacement 边界，不把 `trustedHosts`/carrier 信任解释为设备认证。
- **R 替换包（每包只归属唯一官方组件，跨组件协同在 feature-list §3.1.1 报备登记）**：
  - `connection` 替换包：复刻 `dsh-client-connection` 行的完整 ctx/event/HTTP-up/WS-down/reconnect/trustedHosts 契约后，增加 transport 协商、连接层 channel 代次围栏与 carrier 级 resume 传输再附着；
  - `gateway` 替换包：复刻 `dsh-api-gateway` typert-gateway 行的完整 descriptor/RPC/remote mount 契约后，增加 channel 方法 RPC 派发与 remote 命名空间扩展；
  - 两个包各自具备 boot 自检、runtime/package 版本锁定、组件唯一 owner 冲突检测和 fail-safe 停用；R 包不实现认证语义。
- 不覆盖 `@deepseek-ai/dsh-*` 包 import 面，不修改官方安装目录。
- 若源码核实无法证明 `connection`/`gateway` 行的契约可保真复刻，对应 R 切片暂停并登记为 C 类上游提案；认证部分由 B 门面以注册抽象实现，不伪造 replacement 边界。
- **U21/U22/U23 上游提案登记**：U21（官方 authenticated remote session/channel owner）登记为 feature 级上游提案，不再阻塞交付——B 门面在 upstream 到来前提供可用通道；U22/U23 分别对应 connection 与 gateway R 包的 seam，官方提供等价契约后各包按自身切片覆盖情况退役。

## Non-Goals

- 不重新实现通用 `pluginApi.remote.publish`、client `$mount` 或普通设置/配置桥；
- 不承诺 exactly-once 网络投递，默认采用明确的 at-least-once + dedupe 语义；
- 不提供任意远程 shell、文件系统或工具执行授权；这些权限仍由既有 approval/security/tool owner 决定；
- 不把远程 channel 变成新的 durable session store，不复制官方 transcript；
- B 门面不固定任何具体认证范式（approval/PIN/二维码/token 等）——范式由第三方插件经注册接口决定；
- 不在本阶段确定具体 transport 实现、认证协议或 wire schema，待 Requirements/Design 确认后冻结。
