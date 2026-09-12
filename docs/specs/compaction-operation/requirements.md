# Stage 1 Requirements: compaction-operation

> feature_name: `compaction-operation`
> milestone: M10
> status: Stage 1 Requirements 交付（2026-09-12，与 Design 同批交付）
> 上游：[goal.md](./goal.md)；M10 工作纲领 §3.7（OBS-07）；M7 deletion report B4-7 批准记录与「后续 B 类接口义务」；canonical registry eventCatalog `compaction/*`；`packages/compaction-events` 现行实现（forked engine / event-contract）。

## 1. Introduction

本 feature 兑现 M7 删除整键 `services.compaction`（compactIfNeeded / compactNow / compactRegion）时登记的功能义务（B4-7）：为第三方插件提供一个经门面**显式发起一次真实压缩**的受支持公共入口。

压缩引擎仍是唯一执行者与 mutation owner；`compaction/request` 策略 waterfall 仍是唯一决策参与者；`compaction/*` 事实事件仍由 compaction replacement authority 生产。本 feature 新增的是：把请求、策略、引擎、终态、session/provenance 更新接成一条真实链的门面 operation 入口、可区分的统一终态、marker/版本门控投影与降级，以及（经 replacement owner 扩展承载的）跳过原因/拒绝原因判别式结果。

主公开面 idiom 为 **operation**（发起由 authority 主导内部过程的动作并等待确定终态）。全部行为需求以 EARS 表达并逐条标注实现通道分类（A / B / C / R；R 依 `docs/standards/capability-strategy.md`）。

## 2. 实现通道总判定

| 能力 | 分类 | 依据 |
|---|---|---|
| 门面 operation 入口（触发 + 终态映射 + 门控投影） | B 类（方案一门面转译：受控包装既有底层 seam） | 官方冻结 runtime 经 `ctx.compaction` 服务保留三个触发方法；替代行激活时该 provider 已带完整 `compaction/*` 事件词汇；但门面没有受支持公共入口（`services.compaction` 已按 B4-7 删除），本 feature 包装该 seam 并叠加门面语义 |
| 跳过原因 / 拒绝原因的判别式结果 | R 类（在既有 replacement owner 内扩展，组件唯一 owner 不变） | 现有三个方法以重载的 `null` 同时表达"无候选""低于阈值""被否决"等多种跳过；区分它们需要引擎内部知识。按 capability-strategy §2 在唯一 replacement owner（`@deepseek-ai/dsh-plugin-api-compaction-events`）内扩展。**本阶段只作设计陈述，不执行登记** |
| `compaction/*` 事实事件与 `compaction/request` 决策 | A 类（已交付，只消费） | registry eventCatalog 已登记（fact + decision/waterfall，producer authority 为 compaction replacement authority）；本 feature 不新增、不改写 |
| C 类 | 无 | 触发、取消、并发、决策参与均可在现有 seam 上兑现，不需要 upstream proposal |

## 3. 客户端半面判定（capability-strategy §10 六问记录）

按序逐问判定，对象为被替换官方行 `@deepseek-ai/dsh-compaction-basic` 与 replacement 行 `plugin-api-compaction-events`：

| # | 问题 | 判定 | 证据 |
|---|---|---|---|
| 1 | 被替换的官方行是否声明 client manifest？ | 否 | 官方 `dsh-compaction-basic` 是 host 端压缩引擎服务实现（`ctx.compaction` provider），其包不声明 `dsh.client` manifest；replacement 包同样不声明（capability-strategy §5 装配表 client 半面列为「无（host-only）」） |
| 2 | 是否注册 remote namespace？ | 否 | 替代行只提供 `ctx.compaction` 服务面与 `compaction/*` 事件词汇，无任何 remote publication |
| 3 | 是否提供 slot 或 settings bridge？ | 否 | 引擎配置经 Cordis plugin config（loader 配置）传入，不经 settings 桥，不占用 slot |
| 4 | 是否有 client 与 host 之间的版本协商？ | 否 | 现行版本校验是主包↔辅助包装配校验（`A.B.C` 一致性），不是 client/host 协商 |
| 5 | 是否有 browser-side state 或 reconnect 语义？ | 否 | 压缩是 host 进程内的 session durable 事务（durable compaction lock + marker pair），无浏览器侧状态、无重连 |
| 6 | 官方行是否拥有 client-facing event/service？ | 否 | `compaction/*` 为 host 派发事实（registry eventCatalog `runtime: host`）；无任何 client 载体 |

**结论：六问全否 → host-only。** operation 面只落 host 半面；客户端观察压缩进度只能经既有 host 事件转发通道（该转发是既有能力，不属于本 feature）。

## 4. Requirements

### R1 真实触发与执行链（B 类）

**User story**: As a third-party plugin author, I want to explicitly initiate one real compaction through the facade, so that the session actually gets compacted by the existing engine instead of me emitting fake compaction events.

- WHEN a third-party plugin invokes the facade compaction operation entry with a valid target agent reference and trigger mode THEN the facade SHALL route exactly one compaction request to the marked `ctx.compaction` provider and resolve the caller only after the engine reaches a determined terminal.
- WHEN the engine performs the compaction THEN the target session SHALL contain the durable compaction transaction records appended by the engine (opening marker, summary record, closing marker, replacement user message), and the returned lineage compactionId SHALL be resolvable afterwards from the session's existing public durable event surface.
- WHERE the target agent reference does not resolve to a live agent IF the operation is invoked THEN the facade SHALL reject the invocation with a determinate typed outcome before any engine call, and SHALL NOT mint any compaction identity.

### R2 触发语义与范围表达（B 类）

**User story**: As a third-party plugin author, I want trigger semantics with explicit meaning, so that what my request does (and what provenance it produces) is predictable.

- WHEN the plugin requests the "immediate" trigger semantics THEN the facade SHALL run the engine's manual idle-session compaction path (official `compactNow` semantics: standalone marker pair, selected-span stability, durability checkpoint flush, no turn ownership), passing the caller's cancellation signal and the optional source correlation id verbatim.
- WHEN the plugin requests the "range" trigger semantics with an explicit inclusive surface seq range THEN the facade SHALL run the engine's direct regional compaction path (official `compactRegion` semantics: current-turn bracket, whole-surface stability) with the caller-provided start and end seq.
- WHERE the automatic "pressure" / "context-overflow" trigger semantics are concerned IF a caller attempts to reach them through the public operation entry THEN the facade SHALL NOT expose them (they remain engine-internal automatic paths), so that plugin-initiated compaction can never be attributed to an automatic trigger.
- WHEN no explicit range is provided for the immediate semantics THEN the engine's own selection (useful range with nothing force-retained) SHALL determine the compacted span, and the facade SHALL NOT re-implement range selection.

### R3 决策参与衔接（A 类消费；决策面不变）

**User story**: As a compaction policy author, I want my `compaction/request` decisions to govern facade-initiated compaction exactly as they govern automatic compaction, so that there is one decision authority.

- WHEN the engine dispatches the `compaction/request` decision waterfall before any durable marker THEN registered policies SHALL retain their existing ability to proceed, reject with a reason, or replace the range, with unchanged precedence and containment semantics.
- WHEN a policy rejects the request THEN the operation SHALL resolve to a denied terminal carrying the policy reason, the engine SHALL have emitted exactly one `compaction/skipped` fact with that reason, and no compaction transaction SHALL have been started.
- WHEN a policy replaces the range and revalidation succeeds THEN the operation SHALL compact the replacement range; WHEN revalidation fails THEN the engine SHALL fall back to the originally selected range (existing semantics), and the operation result SHALL reflect the range that was actually compacted.
- WHERE the operation entry is concerned THEN the facade SHALL NOT provide a second policy-registration path and SHALL NOT treat the `compaction/request` registry as a trigger.

### R4 结果可区分（B 类终态映射；原因判别由 R 类扩展承载）

**User story**: As a third-party plugin author, I want a single discriminated operation result, so that success, skip, denial, failure and cancellation are distinguishable without parsing events.

- WHEN the operation reaches a terminal THEN the result SHALL distinguish exactly five outcomes — success with lineage, success with skip (carrying a machine reason), denied (policy rejection, carrying a reason), error (carrying a stable machine code and stage), aborted (cancellation) — under the unified operation result contract (`ok` / `code` / `terminal` / outcome fields), and SHALL NOT express any of them by an overloaded `null`.
- WHEN the terminal is success with lineage THEN the result SHALL carry the engine-reported compaction lineage (compactionId, shadowed range, shadowed seqs, shadowed token count, start/summary/end seqs, source correlation id when provided) as frozen data.
- WHEN the engine reports no compactable candidate THEN the operation SHALL resolve success with skip (reason: no-candidate) and SHALL NOT fabricate lineage.
- WHERE a policy veto and an absence of candidate would otherwise be indistinguishable THEN the marked provider's operation sub-face (R 类扩展) SHALL return a discriminated outcome (compacted / skipped / rejected with reason) instead of an overloaded `null`; the discriminating channel SHALL be built inside the replacement's own forked engine (the veto sentinel — carrying the decision reason — and the selection-null are distinguishable on the internal path before the public methods collapse them to `null`), and SHALL NOT rely on reinterpreting the public methods' overloaded `null`.

### R5 引擎唯一执行与事实生产权（B 类约束；事实为 A 类）

**User story**: As a maintainer, I want the compaction engine to remain the single mutation owner and fact producer, so that the facade cannot drift into a second summary model or a fake event emitter.

- WHEN the operation is invoked THEN the facade SHALL NOT emit any `compaction/*` event, SHALL NOT append any session event, and SHALL NOT synthesize a compaction result; fact production SHALL remain exclusively with the compaction replacement authority.
- WHEN the operation completes THEN the facade result SHALL be a faithful mapping of the engine outcome and SHALL NOT reconcile or rewrite the engine's own terminal adjudication into a different story.

### R6 触发来源可辨与 provenance 一致（B 类；词汇为 A 类）

**User story**: As an observer plugin, I want plugin-initiated and automatic compaction to share one event vocabulary while remaining distinguishable, so that provenance is honest.

- WHEN a compaction is initiated through the operation entry THEN the fact payloads SHALL carry the manual / direct trigger vocabulary (distinguishable from the automatic pressure / context-overflow vocabulary) and the optional source correlation id passthrough.
- WHEN automatic compaction runs (engine-internal pressure / overflow paths) THEN its facts SHALL keep the automatic trigger vocabulary, and the facade SHALL NOT alter or forge any trigger or provenance field on either path.

### R7 与活跃压缩 / turn 的并发（B 类）

**User story**: As a third-party plugin author, I want deterministic behavior when a compaction is already active or a turn is open, so that concurrent callers never double-compact or double-report.

- GIVEN a compaction transaction is already active on the target session (the engine's durable compaction lock) WHEN another operation invocation arrives THEN the facade SHALL report a determinate busy outcome for the newcomer without emitting any additional compaction fact and without duplicating the compaction.
- WHEN the immediate mode targets a non-idle agent THEN the operation SHALL report a determinate busy outcome (official idle-bracket semantics) rather than queueing or force-cancelling the active work.
- WHEN the range mode is invoked with no open turn on the session THEN the operation SHALL report a determinate error outcome reflecting the engine's current-turn bracket requirement.
- WHERE concurrent operation invocations are concerned IF both pass validation THEN each SHALL receive its own determinate terminal derived from the engine's serialized execution (the engine's durable lock remains the single concurrency authority), and the facade SHALL NOT add a second lock, queue, or deduplication layer.

### R8 取消（B 类）

**User story**: As a third-party plugin author, I want cancellation to propagate to the running summarization and to end in a definite aborted terminal, so that a cancelled compaction never looks successful.

- WHEN the caller's cancellation signal is already aborted at invocation THEN the operation SHALL resolve aborted without starting any engine work.
- WHEN the cancellation signal aborts while the compaction is running THEN the facade SHALL map the engine's cancellation adjudication to the aborted terminal; the engine SHALL have closed the durable transaction with exactly one closing-marker attempt and emitted exactly one `compaction/failed` fact, and the facade SHALL NOT synthesize a success or partial-lineage outcome.
- WHEN cancellation arrives after the engine has durably committed THEN the terminal SHALL follow the engine's own adjudication (the official manual path may report cancelled after commit) and the already-emitted facts SHALL remain the authority; the facade SHALL NOT rewrite the terminal into success.
- WHEN no cancellation is requested THEN the facade SHALL NOT inject any local cancellation source that could abort the engine work on its own.

### R9 门控与降级（B 类）

**User story**: As a maintainer, I want the operation surface gated on the same marker/version contract as the replacement events, so that a missing or mismatched auxiliary package degrades typed and locally.

- GIVEN the compaction replacement row is active, its package version matches the main facade contract, and the provider carries both the replacement contract marker and the operation sub-face marker WHEN a plugin accesses the operation surface THEN the facade SHALL project the live operation members and availability SHALL report active.
- WHEN the replacement row is absent or inactive, the auxiliary package version mismatches, or the operation sub-face marker is missing THEN the facade SHALL keep the namespace present with availability reporting unavailable and SHALL fail operation invocations with the standard typed feature-disabled error, without affecting unrelated `sessions` members or the already-gated compaction event catalog behavior.
- WHEN the gate state changes THEN degradation SHALL be confined to this operation surface (typed disabled/unavailable), and the engine's official-equivalent fallback contract, if present, SHALL remain untouched.

### R10 host-only 客户端半面（§3 六问记录的结论条目；元约束类——无独立实现通道，A/B/C/R 标注不适用）

- WHERE the client half is concerned IF any client surface is evaluated THEN the facade SHALL NOT expose the compaction operation, its result shapes, or any compaction client member on the client half (per §3 six-question record: all answers negative).

## 5. R 类扩展的 R1–R8 逐条对照（EARS）

R 类扩展（operation 子面）落在既有 replacement owner 内；以下为该扩展在执行阶段必须满足的验收（本阶段不执行登记）：

- WHERE the extension is implemented THEN it SHALL ride the existing replacement row and its existing provider via the official patch mechanism only, and the bundle patch file SHALL remain unchanged (R1).
- GIVEN the extension is active THEN the existing `ctx.compaction` service face and `compaction/*` event face SHALL be fully preserved, with the operation sub-face added as a purely additive interface (R2).
- WHERE the `@deepseek-ai/dsh-compaction-basic` import face is concerned IF a third party imports it THEN the extension SHALL NOT intercept or replace it (R3).
- WHEN the replacement applies THEN the existing boot self-check matrix SHALL continue to assert official-row-disabled / replacement-active / key-contract-usable, and the operation sub-face marker SHALL be part of the post-register verification (R4).
- WHEN the runtime or main-facade identity mismatches THEN the operation sub-face SHALL NOT be published, alongside the existing degradation of the replacement event feature (R5).
- WHEN another provider already owns `ctx.compaction` THEN the extension SHALL stay inert together with the existing conflict handling (R6).
- WHERE the client half is concerned THEN the extension SHALL have no client surface (host-only six-question record above) (R7).
- WHERE boot glue and framework-level dispatch semantics are concerned THEN the extension SHALL NOT touch them (R8).

## 6. 非行为约束（本阶段边界）

- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段；能力在冻结基线内交付。
- 登记义务：执行阶段落实 R 扩展时，按 capability-strategy §9 同步 `AGENTS.md` §2/§4、feature-list 类型标注与装配表；本阶段不执行登记，不修改 canonical registry。
- 公共 path、参数形状与结果码集合由 Design 确定（Goal 阶段边界）；TUI `/compact` 样本的历史服务名一致性在迁移时验证，不作为本阶段事实。
