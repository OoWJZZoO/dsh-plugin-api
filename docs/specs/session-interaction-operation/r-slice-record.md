# R Slice Record — Shared Loop Boundary Slice（host-only 判定、U-series 与退役条件）

> 本文件是本线 spec 制品，登记既有 `dsh-agent-loop` replacement owner 包内共享 loop boundary slice 的 host-only 判定（capability-strategy §10 六问）、U-series 上游提案与退役条件（capability-strategy §4.1；feature-list §3.1 的 registry 登记由集成波执行，见 tasks.md 任务 11.2）。
> feature_name: `session-interaction-operation`；milestone: M9。

## 1. host-only 判定（capability-strategy §10 六问逐项证据）

被替代官方行：`agent-loop`（replacement 包 `@deepseek-ai/dsh-plugin-api-agent-loop`，row `plugin-api-agent-loop`）。切片扩展为同包加性能力，不新增行、不改 disabled+insert 结构。

| # | 六问 | 判定 | 证据 |
|---|---|---|---|
| 1 | 被替换官方行是否声明 client manifest？ | 否 | 官方 `dsh-agent-loop@0.1.0-rc.6` `package.json` 无 `dsh.client` manifest；既有 replacement 包保持同面 |
| 2 | 是否注册 remote namespace？ | 否 | 官方 `agent-loop` 行无 `dsh-api-remotes`/Typert remote 注册；切片新增方法为内部 symbol-keyed 契约，不注册任何 remote namespace |
| 3 | 是否提供 slot 或 settings bridge？ | 否 | 官方行仅有 `AGENT_LOOP_SETTINGS_NAMESPACE`（host 侧 settings section，`@deepseek-ai/dsh-agent-loop` 既有面），无 client slot/settings bridge；切片不新增 |
| 4 | 是否有 client 与 host 之间的版本协商？ | 否 | 无 client 半面即无版本协商面；host 侧版本锁定由 apply 自检矩阵承载 |
| 5 | 是否有 browser-side state 或 reconnect 语义？ | 否 | 官方 `agent-loop` 为纯 host 驱动；切片 attempt 事实为 host in-memory fact 事件，无 browser/reconnect 状态 |
| 6 | 官方行是否拥有 client-facing event/service？ | 否 | 官方 `agent-loop` 事件面仅 host ctx 事件（`agent-loop/config-start-failed` 等）；切片事实事件 `agent/attempt/start|end` 为 host ctx 事件，不在任何 client forwarded-event allowlist 中 |

**结论：六问全否 ⇒ host-only slice，无 client bundle 义务**（该结论记录于本表即证据；未来任一项转正需重新审计，见 capability-strategy §10）。

## 2. U-series 上游提案与退役条件（capability-strategy §4.1；feature-list 登记在集成波）

- **U-series 提案**：官方 `dsh-agent-loop` / `dsh-agent` 提供等价的外部 request acceptance / cancel / attempt 公开 seam——即官方提供「外部单请求 admission 幂等面 + per-request 稳定 operation identity + 公开 cancel/abort ctx 契约 + attempt 终态/排队事实出口」（或官方 execution identity 常态化），足以承载本 slice 的 engagement 语义。
- **退役条件**：上述官方 seam 落地且消费者迁移官方 seam 后，本切片对应能力退役，facade 公共面保持（退回官方直绑），replacement 的 disabled+insert 结构不变（切片只是 owner 包内冗余能力，随官方 seam 提供后逐步废弃；feature-list §3.1 登记该 U 行与退役条件）。
- **共享切片联合登记**（feature-list §3.1，集成波）：同一条 `packages/agent-loop` loop boundary slice 能力同时被 `session-interaction-operation`（admission/cancel）、`session-activity-projection`（observed 终态/排队）、`checkpoint-restore-contract`（live-attempt 前置/stop-coordination/自动捕获）三线消费；attempt 事实词汇只定义一次（本线实现），三线联合登记同一 owner 包能力，不重复定义词汇。

## 3. Import 面不覆盖（capability-strategy R3）

第三方 `import '@deepseek-ai/dsh-agent-loop'` 仍解析官方原包；切片不宣称拦截或替换该 import 面，也不改变官方包任何文件。

## 4. 跨线契约 marker 说明（tasks.md 任务 4.1 MINOR 落地）

- 共享 attempt 事实词汇的 contract version 由本线切片导出（`ATTEMPT_FACTS_CONTRACT_VERSION = '1'`），切片 apply 自检时对 activity 线定义的观测契约 marker（`Symbol.for('dsh-plugin-api.session-activity.observation-contract')`）做 presence/version 探测；present 且兼容 ⇒ observed 级消费可宣称；absent ⇒ 仅 log，互相兼容性核对由集成波统一装配验证（tasks.md 任务 11.3/11.6），避免两线职责悬空。
- 该 marker 的**定义与导出**属 `session-activity-projection` 线；本线只读消费。activity 线交付前，本线以无关锁方式运行（facts 照常发射，observed 宣称留待 marker 就位）。