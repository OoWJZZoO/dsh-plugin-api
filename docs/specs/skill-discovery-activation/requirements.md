# Stage 1 - Requirements

## Status

SPEC1 Stage 1：Requirements 已获用户批准（2026-08-26，M6 第六批次批量确认门，含 R 类通道重构版）。Stage 3–4 已完成（tasks 经对抗性审查、Stage 4 已交付并在 tasks.md 回写）。

## Introduction

`skill-discovery-activation` 经 R 类通道替换官方 `tool-skill` 行（owner `@deepseek-ai/dsh-tool-skill`），把官方模型侧 skill 暴露（`skill` 工具、`agent/pre-step` 用户调用注入、`<available_skills>` 目录）升级为 **session 内动态策略感知**，并改变目录变化通知行为：默认与官方对齐（全量重发 catalog），注册最小更新政策后切换为英文最小更新信息。

官方事实（2026-08-26 本机 DSH `0.1.0-rc.6` 源码核实）：`dsh-skill` 拥有 `ctx.skills` registry 与 `skills/change` 失效通知，不渲染模型指引；`dsh-tool-skill` 拥有模型侧暴露——三条路径均只查静态 `modelInvocable`/`userInvocable` 布尔，不感知 activation 状态；其 `agent/pre-step` 目录机制按 session 维护 digest 历史，且变化时全量重发 catalog（官方默认行为）。本 feature 的替代行保真复刻上述契约面，之后增加 activation 语义与可政策切换的目录变化告知行为（默认官方全量重发、政策开启英文最小更新）。

## Definitions and Boundaries

- **Skill descriptor**：官方 registry 条目的**激活政策覆盖层**（skillId、owner、summary ≤200 字符、capabilities、source kind 与激活来源绑定），不含完整 tool schema，**不是第二内容源**——内容解析永远走官方 `ctx.skills.list/get`。
- **registerSkill 语法糖**：一次调用组合官方 `ctx.skills.register()`（运行时内嵌内容注册，内存态）与 descriptor overlay，返回统一句柄；语义 = 纯组合，不缓存、不复刻官方内容校验。
- **Activation**：把 skill 的暴露绑定到 scope（session / agent / turn）与 generation 的动作；TTL 到期是显式降级路径。
- **Exposure record（公开词汇，供 `context-provenance` 消费）**：冻结只读 `{ skillId, owner, sourceKind, scope, generation, tools, promptSections, resources, degraded[], availability }`；`tools` 只承载 `tools.discovery` 引用。
- **Catalog diff notice（最小更新，政策开启时）**：目录变化时注入的英文增量 CONTEXT：「Skill `<name>` has been removed」「Skill `<name>` has been added」「Skill `<name>` has changed; its new shape is: `<summary>`」；仅当最小更新政策注册后启用，文案语言与 DSH 惯用 prompt 对齐。
- **Minimal-update policy（最小更新政策）**：注册后，该 session 目录变化切换为英文最小更新信息；未注册或 policy 抛错时保持官方默认全量 replacement catalog 消息（stock DSH 行为）。
- **Replacement boundary**：只替换官方 `tool-skill` 行（运行时名 `plugin-api-tool-skill`，源码 `packages/tool-skill/`）；官方 `dsh-skill` registry 行保持原样；不覆盖 `@deepseek-ai/dsh-tool-skill` 包 import 面；不得跨组件替换。
- **Host/client boundary**：host-only（§10 六项判定见 SDA-R8）；主门面 `pluginApi.skills.activation` 为 marker/版本门控条件投影，替代行自含状态机；client 无激活权威、无新 wire。
- **与相邻 feature 分工**：完整 tool schema 与 per-turn 可见性归 `progressive-tool-discovery`；MCP server identity 归 `mcp-catalog-lifecycle`；route/recovery/approval 归各自 owner；官方 skills registry 直通仅作发现来源。

## Standards Alignment

按 `docs/standards/` 六册对照：

- **capability-strategy**：核心适用——R 类通道，requirements 逐条对照 R1–R9（SDA-R1…R9）；§10 client 半面判定逐项证据（SDA-R8）；U18 上游提案与退役条件（SDA-R7）；横切派发语义不走 R。
- **api-shape**：适用——主公开面是 activation lifecycle mutation 面（单一 owner：替代行内 registry，latest-wins generation）；exposure/discover 为冻结只读投影；minimal-update 政策为独立 policy registry 面（纯函数、显式输入）；`registerSkill` 为 thin composition 语法糖，不引入新语义 owner、不建第二内容源。
- **identity-and-lifecycle**：适用——generation 用 owner-specific opaque token；被取代的 activation 按 `superseded`；不新增终态词汇，超时归 `error` + `timeout`。
- **durable-state-and-scope**：部分适用——activation 状态为 session 内内存态，不声明 durable mutation 面；bounded audit 若持久化须单档归属（Design 定）；默认不自动 retry。
- **visibility-and-redaction**：适用——descriptor summary/source kind 进入模型可见面属显式设计决定；diff notice 内容 = 英文最小更新信息（skillId + 变更种类 + summary），与官方 catalog 文案语言对齐，不携带完整 skill 内容；audit 默认 diagnostic/UI 可见；secret 永不进入 exposure/diff。
- **concurrency-and-cancellation**：适用——activate/deactivate 构成 latest-wins；目录 digest 计算与 pre-step 注入有并发竞争，旧 generation 结果失去提交资格；disposer 按 identity 清理。

## Requirements

### Part A — R 通道硬约束（逐条对照 R1–R9）

### SDA-R1 官方 patch 机制

**User Story:** As a repository maintainer, I want the replacement delivered only through the official patch mechanism, so that official package files are never modified.

**Acceptance Criteria:**

1. **WHEN** the bundle is assembled **THEN** it SHALL disable the official row `tool-skill` and insert exactly one replacement row `plugin-api-tool-skill`, and SHALL NOT modify `/usr/lib/node_modules/@deepseek-ai/dsh/**` or any official package file.
2. **WHEN** the bundle is uninstalled **THEN** the official `tool-skill` row SHALL be restored by the official patch mechanism without manual intervention.

**Classification:** R（capability-strategy R1）。

### SDA-R2 官方契约保真复刻

**User Story:** As a plugin consumer, I want the replacement to preserve the official row's ctx surface exactly, so that no downstream behavior changes before activation semantics are added.

**Acceptance Criteria:**

1. **WHEN** the replacement applies **THEN** it SHALL preserve the official `tool-skill` ctx contract: the `skill` tool definition (name/schema/output/render), `execute()` resolution via `ctx.skills.list/get` with lookup `{ cwd, signal, scope }`, the `agent/pre-step` user-invocation injection, and the session catalog digest/history machinery, before adding any activation gating.
2. **WHEN** activation semantics are absent or the feature is degraded **THEN** official-behavior parity SHALL hold for the `skill` tool and `agent/pre-step` paths.
3. **WHEN** the replacement is active **THEN** it SHALL NOT alter official service surfaces it consumes (`ctx.skills`, `ctx.tools`) and SHALL NOT cover the `@deepseek-ai/dsh-tool-skill` import surface.

**Classification:** R（R2/R3）。

### SDA-R3 包 import 面不覆盖

**User Story:** As a repository maintainer, I want the replacement to leave the official package's import surface untouched.

**Acceptance Criteria:**

1. **WHEN** third-party code imports `@deepseek-ai/dsh-tool-skill` **THEN** it SHALL still resolve to the official package, and the replacement SHALL only replace the ctx service/event surface of the `tool-skill` row.

**Classification:** R（R3）。

### SDA-R4 Boot 自检

**User Story:** As an operator, I want the replacement to verify its own assembly at boot, so that silent double-running or broken contracts are impossible.

**Acceptance Criteria:**

1. **WHEN** the replacement applies **THEN** it SHALL assert: official `tool-skill` row disabled, replacement row `plugin-api-tool-skill` active, and the replicated contract probes pass (skill tool registered, pre-step hooks registered, catalog provider resolvable).
2. **WHEN** any self-check fails **THEN** the replacement SHALL log a fail-safe diagnostic and return normally, and SHALL NOT silently double-run alongside the official row.

**Classification:** R（R4）。

### SDA-R5 版本锁定

**User Story:** As an operator, I want mismatched runtime/package identities to disable the replacement safely.

**Acceptance Criteria:**

1. **WHEN** the installed runtime full identity differs from the locked `0.1.0-rc.6` **OR** the replaced package identity differs from `@deepseek-ai/dsh-tool-skill@0.1.0-rc.6` **THEN** the replacement SHALL disable itself with an explicit diagnostic and SHALL NOT guess.

**Classification:** R（R5）。

### SDA-R6 组件唯一 owner 冲突检测

**User Story:** As a repository maintainer, I want competing replacements of the same official component rejected.

**Acceptance Criteria:**

1. **WHEN** another replacement of the `dsh-tool-skill` component is present **OR** the target official row is not disabled **OR** a duplicate insertion exists **THEN** the replacement SHALL detect the conflict and fail-safe.

**Classification:** R（R6）。

### SDA-R7 上游提案与退役条件

**User Story:** As a repository maintainer, I want a registered upstream proposal and a clear retirement condition for the replacement.

**Acceptance Criteria:**

1. **WHEN** the feature is delivered **THEN** it SHALL register upstream proposal **U18（官方 session 内动态 skill activation/exposure seam）** and a retirement condition: 官方 `tool-skill` 路径原生提供 activation-aware 目录过滤、加载门控与注入门控（或等价公开 seam）后，消费者迁移官方 seam，本 replacement deprecate/退役。

**Classification:** R（R7）。

### SDA-R8 Client 半面判定

**User Story:** As a repository maintainer, I want the client-half decision recorded with per-item evidence.

**Acceptance Criteria:**

1. **GIVEN** the official `tool-skill` row **THEN** the six client-half checks SHALL be recorded with evidence: ① 无 client manifest（package.json 无 `dsh.client` 字段）；② 不注册 remote namespace；③ 不提供 slot/settings bridge；④ 无 client↔host 版本协商；⑤ 无 browser-side state/reconnect 语义；⑥ 无 client-facing event/service —— **全部为否 → host-only**，不产生 client 构建面。

**Classification:** R（R8 + capability-strategy §10）。

### SDA-R9 横切派发语义不 R 化

**User Story:** As a repository maintainer, I want cross-cutting dispatch semantics to stay out of the replacement.

**Acceptance Criteria:**

1. **WHEN** the replacement implements catalog/injection behavior **THEN** it SHALL NOT own or alter cross-cutting dispatch semantics (priority / deepFreeze / fault containment) and SHALL NOT replace boot glue or launcher rows.

**Classification:** R（R9）。

### Part B — Session 内动态 skill 策略

### SDA-0 Descriptor↔registry overlay 契约

**User Story:** As a plugin maintainer, I want the activation layer to reference real skills in the official registry, so that activation policy never fabricates content that cannot be loaded.

**Acceptance Criteria:**

1. **WHEN** a descriptor is registered **THEN** its `skillId` SHALL be an official registry identity; the descriptor SHALL be an activation-policy overlay and SHALL NOT constitute a second content source.
2. **WHEN** activation is requested for a `skillId` that cannot be resolved through the official `ctx.skills` registry (`list/get`) **THEN** the replacement SHALL return a typed degraded result (skill not present in the official registry) and SHALL NOT create an empty activation shell.
3. **WHEN** the `skill` tool resolves content **THEN** it SHALL resolve only through the official `ctx.skills.list/get` path; the activation layer SHALL NOT own or supply content.
4. **WHERE** a plugin needs a non-persistent in-memory skill **THEN** content SHALL be registered through the official `ctx.skills.register()` runtime path (memory-resident, disposed with its official disposer), and activation SHALL act as visibility/lifecycle policy on top of it.

**Classification:** R（overlay 契约；内容 owner 保持官方 registry）。

### SDA-1 Activation lifecycle mutation

**User Story:** As a plugin maintainer, I want on-demand activation scoped to a session/agent/turn, so that a skill's exposure appears exactly when justified and expires when it should.

**Acceptance Criteria:**

1. **WHEN** a caller activates a skill with `{ scope, reason, ttl }` **THEN** the replacement SHALL produce an activation bound to a new generation and valid in that scope; activation state is session 内内存态 and SHALL NOT claim durable persistence.
2. **WHEN** the owning scope ends or the TTL expires **THEN** the replacement SHALL produce a typed degraded/expired outcome and SHALL NOT silently extend it.
3. **WHEN** activation is requested for an unknown, disposed, or conflicting entry **THEN** typed reject with no partial exposure.
4. **WHEN** a newer activation for the same skill and scope arrives **THEN** latest-wins; the previous generation SHALL be `superseded`.
5. **WHEN** activation exceeds its deadline **THEN** outcome SHALL be `error` with reason `timeout`; no new terminal vocabulary.

**Classification:** R（替代行内 mutation owner）。

### SDA-2 动态策略在官方三路径强制执行

**User Story:** As a plugin maintainer, I want activation state to actually gate the model-facing paths, so that deactivated/expired skills disappear from the official catalog and cannot be loaded or injected.

**Acceptance Criteria:**

1. **WHEN** the `<available_skills>` catalog is rendered for a session **THEN** the replacement SHALL include only skills active (and not degraded for catalog purposes) in that session's activation state.
2. **WHEN** the `skill` tool executes for a session **THEN** the replacement SHALL reject skills that are not active in that session with a typed failure, in addition to the official `modelInvocable` check.
3. **WHEN** `agent/pre-step` considers user-invocation injection **THEN** the replacement SHALL inject only skills active in that session and satisfying the recorded source-kind policy, in addition to the official `userInvocable` check.
4. **WHEN** activation state cannot be resolved (missing session/scope) **THEN** the replacement SHALL fail closed for the gated path (exclude from catalog / reject load / skip injection) and record a diagnostic, rather than defaulting to allow.

**Classification:** R（R2 之上新增接口）。

### SDA-3 Invocation source classification and enforcement

**User Story:** As a plugin maintainer, I want every activation to record exactly how it was triggered and to have the official injection path respect it.

**Acceptance Criteria:**

1. **WHEN** an activation is recorded **THEN** it SHALL carry exactly one source kind from `userInvocable` / `explicit` / `auto-match` / `provider-sourced`, preserved in audit and exposure metadata.
2. **WHEN** a skill is restricted to `explicit` invocation **THEN** the `agent/pre-step` user-invocation injection SHALL NOT inject it, and only an explicit activation SHALL open the loading path.
3. **WHEN** an auto-match or provider-sourced activation occurs **THEN** it SHALL be driven by a declared, queryable condition; silent unconditional activation is not permitted.

**Classification:** R。

### SDA-4 Deactivation, TTL, and generation replacement

**User Story:** As a plugin maintainer, I want to deactivate or replace skills without breaking in-flight work.

**Acceptance Criteria:**

1. **WHEN** an owner deactivates a skill for a scope **THEN** subsequent catalog renders, `skill` tool loads, and pre-step injections in that scope SHALL exclude it, while in-flight executions keep their previous generation view.
2. **WHEN** a newer generation replaces an older one **THEN** pending asynchronous results of the older generation SHALL lose submission qualification and be retained only as diagnostics.
3. **WHEN** a disposer runs **THEN** it SHALL clean up only resources created by its own generation.
4. **WHEN** deactivate is called with a stale or foreign generation **THEN** typed no-op/reject, preserving the current active state.

**Classification:** R；`concurrency-and-cancellation.md` §4–5。

### SDA-5 Exposure projection

**User Story:** As a plugin maintainer, I want to query exactly what a skill exposes at its current generation.

**Acceptance Criteria:**

1. **WHEN** exposure is queried for `(skill, generation)` **THEN** the frozen Exposure record (Definitions) SHALL be returned with no side effects.
2. **WHEN** the replacement marker/version gate fails in the main facade **THEN** `pluginApi.skills.activation` SHALL be a disabled typed surface and only this feature SHALL be stopped (main facade and other features unaffected).
3. **WHEN** the requested generation is stale or foreign **THEN** typed result, no fabricated current exposure.
4. **WHEN** exposure metadata is consumed by `context-provenance` **THEN** the Exposure record shape SHALL be the stable public vocabulary.

**Classification:** R（替代行 ctx 服务投影 + 主门面 marker 门控条件投影）。

### SDA-6 Tool exposure delegation

**User Story:** As a plugin maintainer, I want skill-declared tools to flow through the shared tool discovery pipeline.

**Acceptance Criteria:**

1. **WHERE** a skill declares tools **THEN** the replacement SHALL delegate full schema registration and per-turn visibility to `pluginApi.tools.discovery` and SHALL NOT maintain a second tool catalog.
2. **WHEN** `tools.discovery` is unavailable or a delegated entry fails **THEN** only the tools portion degrades (typed unavailable); prompt sections and resources degrade independently; other skills unaffected.
3. **WHEN** a skill is deactivated **THEN** its delegated tool exposure SHALL be withdrawn for new exposures via the same `tools.discovery` path.

**Classification:** R（消费已交付 seam）。

### SDA-7 Dependency and failure isolation

**User Story:** As a plugin maintainer, I want one broken or under-provisioned skill contained.

**Acceptance Criteria:**

1. **WHEN** a skill declares dependencies and any is missing **THEN** degrade only that skill (typed degraded + owner-attributed diagnostics); other entries unaffected.
2. **WHEN** an activation callback or provider throws or returns malformed output **THEN** contain the failure and keep the hosting operation alive.
3. **WHEN** the replacement itself fails setup **THEN** degrade to inert availability, never throw through apply, never kill boot.

**Classification:** R。

### SDA-8 Bounded audit

**User Story:** As a plugin maintainer, I want to query why skills were activated, degraded, replaced, or deactivated.

**Acceptance Criteria:**

1. **WHEN** an activation/deactivation/degradation/supersede/catalog-change event occurs **THEN** append a bounded audit record `{ skillId, owner, sourceKind, reason, generation, kind, timestamp }`.
2. **WHEN** audit records are queried **THEN** frozen read-only; diagnostic/UI-visible by default, not model-visible.
3. **WHEN** audit storage fails **THEN** surface the gap explicitly; lifecycle operations continue.

**Classification:** R；持久化档位 Design 定。

### SDA-9 Availability

**User Story:** As an operator, I want truthful availability for the replacement and each seam.

**Acceptance Criteria:**

1. **WHEN** availability is queried **THEN** it SHALL reflect the true state (official row disabled, replacement active, seams status) and SHALL NOT fabricate defaults.

**Classification:** R。

### SDA-10 registerSkill 快捷注册语法糖

**User Story:** As a plugin maintainer, I want a single call to register a runtime in-memory skill together with its activation overlay, so that the common two-step composition cannot be assembled incorrectly.

**Acceptance Criteria:**

1. **WHEN** `registerSkill({ name, summary, content, capabilities?, sourceKind, activation? })` is invoked **THEN** the replacement SHALL compose exactly two operations — the official `ctx.skills.register()` content registration and the activation overlay descriptor registration, in that order — and SHALL return a single handle `{ skillId, owner, generation, activate, deactivate, exposure, dispose }`.
2. **WHEN** the optional `activation` is provided **THEN** the replacement SHALL apply it immediately after registration; without `activation`, the skill SHALL be registered and describable but not active.
3. **WHEN** the official registration returns a no-op disposer (first-wins duplicate) **THEN** the replacement SHALL preserve the official first-wins semantics and SHALL NOT fabricate ownership of the existing content registration.
4. **WHEN** `dispose()` is invoked **THEN** it SHALL dispose both halves idempotently and by identity, and SHALL NOT remove content or overlays owned by other owners; repeated dispose SHALL be a no-op.
5. **WHEN** the official content registration fails or the overlay registration fails **THEN** the replacement SHALL roll back the half it already completed (or record the exact gap), return a typed result, and SHALL NOT leave a half-registered skill visible.
6. **WHEN** the skill is active **THEN** the `skill` tool load path SHALL resolve its content through the official registry entry created by this composition; when inactive or expired **THEN** the load SHALL be denied with the typed activation failure (content remains owned by the official registry, not duplicated).

**Classification:** R（语法糖；内容 owner 官方 registry，糖不建第二内容源、不做缓存、不复刻官方内容校验）。

### Part C — 目录变化告知（默认官方全量重发；政策切换英文最小更新）

### SDA-C1 默认全量重发（官方对齐）

**User Story:** As a user, I want the default catalog-change behavior to stay aligned with stock DSH, so that behavior without any registered policy is indistinguishable from official.

**Acceptance Criteria:**

1. **WHEN** the effective skill catalog of a session changes and no minimal-update policy is registered **THEN** the replacement SHALL resend the complete replacement catalog message exactly as the official `dsh-tool-skill` does (`source.kind: 'skill-catalog'`, official message vocabulary).
2. **WHEN** the session's first catalog is published (no history) **THEN** the replacement SHALL emit the official complete catalog message regardless of policy.
3. **WHEN** no effective change exists **THEN** no CONTEXT SHALL be injected.

**Classification:** R（官方目录机制行为保真）。

### SDA-C2 最小更新政策入口（英文）

**User Story:** As a plugin maintainer, I want a policy entry to switch a session to minimal English update notices, so that token cost stays bounded for sessions that opt in.

**Acceptance Criteria:**

1. **WHEN** a caller registers a minimal-update policy for a session **THEN** subsequent catalog changes in that session SHALL inject only the delta, in English, aligned with DSH prompt conventions: 「Skill `<name>` has been removed」「Skill `<name>` has been added」「Skill `<name>` has changed; its new shape is: `<summary>`」, and SHALL NOT resend the full catalog for those changes.
2. **WHEN** a skill's summary or invocation policy changes **THEN** the notice SHALL use the changed form with the new English summary (≤200 characters), without embedding full skill content.
3. **WHEN** multiple skills change in one digest revision **THEN** the delta notices SHALL be aggregated into one bounded CONTEXT message in English.
4. **WHEN** the policy is disposed **THEN** the default full-resend behavior SHALL resume for subsequent changes.
5. **WHEN** policy evaluation throws **THEN** the decision point SHALL fall back to the default full-resend behavior and record a diagnostic.

**Classification:** R（policy registry 面；api-shape policy 契约；英文词汇与 DSH 官方 prompt 惯例对齐）。

### SDA-C3 注入机制与官方机制兼容

**User Story:** As a repository maintainer, I want the CONTEXT injection to reuse the official catalog message machinery, so that session history semantics stay intact.

**Acceptance Criteria:**

1. **WHEN** the session's first catalog is published (no history) **THEN** the replacement SHALL emit the official complete catalog message (delta is undefined without history).
2. **WHEN** a later digest change occurs **THEN** the replacement SHALL replace the previous catalog/notice message in the session surface (same machinery as official `catalogHistory`/`catalogMessage`) and SHALL carry `source.kind` metadata distinguishing `skill-catalog`（全量，默认）与 `skill-catalog-update`（英文最小更新，政策开启时）.
3. **WHEN** the official `agent/pre-step` decision rejects the turn **THEN** the replacement SHALL NOT inject and SHALL leave the decision unchanged.

**Classification:** R（官方 `agent/pre-step` 目录机制的行为变更）。

### SDA-C4 注入失败 containment

**User Story:** As an operator, I want catalog-notice failures to never break the message flow.

**Acceptance Criteria:**

1. **WHEN** delta computation or CONTEXT injection throws **THEN** the replacement SHALL contain the failure, log an owner-attributed diagnostic, and leave the pre-step decision otherwise unchanged.
2. **WHEN** the injected notice is malformed **THEN** it SHALL NOT corrupt the message array and subsequent turns SHALL recompute from stored digest history.

**Classification:** R。

## Non-Goals

- 完整 tool schema 注册与 per-turn 可见性（归 `progressive-tool-discovery`）。
- MCP server identity、transport 与生命周期（归 `mcp-catalog-lifecycle`）。
- route / recovery / approval 决策；自动执行 skill action；编写 prompt 文案（最小更新文案由本 feature 定义的英文最小更新词汇模板构成，与 DSH 官方 prompt 语言对齐，不含自定义 prose policy）。
- 新 client wire / remote / slot / settings 面。
- 替换官方 `dsh-skill` registry 行或跨组件 replacement。
- 把英文最小更新设为默认（默认 = 官方全量重发对齐；英文最小更新仅经政策入口）。
- `registerSkill` 复制官方内容校验/缓存/持久化（糖只做组合与原子 dispose，官方语义逐字透传）。
