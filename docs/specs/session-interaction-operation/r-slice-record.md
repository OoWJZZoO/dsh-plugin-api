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
- **marker 字段/类型对齐（终审 MINOR-2 落地）**：activity 线定义的 marker 形状为 `{ version: number }`（`version = 1`）；本线 apply probe 读取 `marker.version` 并按**数字类型统一比较**（`Number(marker.version) === Number(ATTEMPT_FACTS_CONTRACT_VERSION)`）。若集成波安装 marker 时需归一化两线形状（例如 activity 线先行交付的历史形状与 here 不一致），由集成波按此处声明的统一数字语义归一化；本线 probe 对 malformed marker 报 bounded 诊断并等待集成波对齐。

## 5. supersede 终态产生路径（终审 MINOR-3 落地；集成波对齐项）

`superseded` 终态的 loop 侧事实由**明确的生产者沿路径传递标记**产生，绝不由本线凭空标记：

1. **共享 cancelAttempt 直调携带标记**：任何消费方（先例：checkpoint 线 stop-then-restore 经本 request authority 唯一 cancel 路径以 `by:'system' + restore cause` 请求停止）经共享切片 `cancelAttempt(attemptRef, { reason })` 调用时，可在 `reason` 上携带 `superseded: true`（或 `reason.classification === 'superseded'`），切片把该标记写入 loop abort cause（`Symbol.for('dsh-plugin-api.agent-loop.attempt-superseded')`）。
2. **authority 内部 supersede 语义透传**：authority 的 `requestCancel` 接受内部 `supersede: true` 选项（供 superseding 流程 / 未来队列机制使用），设置 `op.supersededRequested`，并在向共享切片传递的 `reason` 中携带 `superseded`；裁决时 `adjudicateTerminal` 依 `supersededRequested` 产出 `superseded`（`aborted > superseded` 竞争优先级仍生效——显式 `aborted` 取消优先）。
3. **loop 侧事实发射**：forked-loop 的 `turn()` 在 turn 关闭提交点把 abort cause 传给 `endAttempt` → `mapTurnEndOutcome` 检测标记 ⇒ `agent/attempt/end` outcome=`superseded`（facts-only，绝不自行写 operation terminal）。
4. **v1 不发生自动 supersede**：exclusive-per-session 下外部 request 不会在既有活操作期间自动顶替；本条把**产生路径与接线方案固定下来**，供 checkpoint stop-then-restore 与未来队列/顶替机制在集成波直接消费，避免另造第二条 cancel 通道。

## 6. operation handle declared-capability 成员登记（终审 MAJOR-2 落地；registry 落表在集成波）

- accepted 返回的 operation handle 新增冻结成员 `capability: { idempotent: boolean, autoRetry: boolean, failClosed: boolean }`：
  - `idempotent` = 调用方是否提供 `idempotencyKey`（Requirement 5 AC1 的 dedupe 前提）；
  - `autoRetry` 恒为 `false`（默认不自动 retry，Requirement 5 AC4）；
  - `failClosed` 恒为 `true`（歧义/不可证明即 error/unavailable，不静默继续）。
- 该成员为 handle 附加只读元数据，不改变 handle `{id, ownerId, status(), observe(), dispose()}` 冻结契约；surface snapshots 与 registry 落表在集成波登记（tasks.md 任务 11.1）。

## 7. 上下文可用性与 capabilities 证据归属（终审 MINOR-4 落地；集成波验收口径）

- **Requirement 8 AC4（headless/web/TUI per-context availability reason）**与 **Requirement 8 AC5（capabilities 不带 package/row/replacement 身份）**的端到端证据由**集成波承担**：本线 focused 测试在 owner 模块层覆盖三态 availability 与 reason 口径（`test/session-interaction-operation-authority.test.mjs` availability 用例），但 per-profile（headless/web/TUI）挂载后的 availabilitity 呈现与根 `capabilities` 词条由集成波在 mount 时装配并断言。
- **集成波验收口径**：a) `sessions.availability()` 在 headless/web/TUI 三个 profile 下返回同一 `{status, reason?}` 语义，per-context 差异只体现在 reason 的 degraded/unavailable 分层（工具/切片可达性不同）；b) 根 `capabilities` 携带 `sessions.request`/`sessions.cancel` 能力词条且不含任何 package/row/replacement 身份字符串。集成波在本线 tasks.md 任务 11.1/11.3 落验，缺失即阻塞。