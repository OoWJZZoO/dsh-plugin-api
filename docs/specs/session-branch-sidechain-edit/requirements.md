# Stage 1 - Requirements

## Status

SPEC1 Stage 0 Goal 已确认；R 类通道经用户于 2026-08-25 明确批准；Stage 1 Requirements 已确认（2026-08-25，M6 第四批次批量确认门）。
修订注记（2026-08-25，用户指示）：SBE-7.4 明确 client-half 判定出现偏差时必须返工，不以返工成本为由弱化判定。
修订注记（2026-08-26，Stage 4 执行期人类裁决）：对官方 `@deepseek-ai/dsh-session@0.1.0-rc.6` 实证发现设计补偿机制与运行时两处不兼容（自定义类型不能携带 surfaceOp；surface replace 只能折叠/1:1 交换、不能展开恢复 N 节点形状）。用户裁决采用 **路线 B**：保留多节点折叠 commit，rollback 改为**内容级恢复**（SBE-11.1 相应放宽）；commit 审计块**可由调用方自定义 `kind` 分类**（适配 user / 调用方 plugin id / goal 等场景）。SBE-10.3/11.1 已按裁决修订，其余验收不变。

## Introduction

`session-branch-sidechain-edit` 在 session durable semantics 上提供高层 branch/edit 契约：named branch（retry / sidechain / experiment / rescue）、branch graph 查询、edit plan（plan → preview → commit → rollback，expectedVersion CAS）与 restore 前置验证。官方 `@deepseek-ai/dsh-session` 只有低层 `fork(source, boundary?, childSessionId?)` 与 typed 拒绝码，没有 branch identity、branch graph、编辑计划与回滚语义；rewind 类插件各自重造同一套状态机即本 feature 的证据来源。

本 feature 是 **R 类 replacement bundle**（通道经用户 2026-08-25 批准）：替代包禁用官方 loader 行 `id: session` 并插入唯一替代行，在完整复刻被替代行 ctx 服务面与事件面的前提下增加 branch 契约。按 `docs/standards/capability-strategy.md` §4，本 requirements 对 R1–R9 逐条给出可测试验收。凡复刻无法覆盖的官方面差异，一律 fail-safe 停用并显式报错，绝不静默双跑或尽力而为猜测。

## Definitions and Boundaries

- **Owner row**：官方 `dsh-base/cordis.patch.yml` 中 `id: session`、name `@deepseek-ai/dsh-session` 的 loader 行。
- **Branch**：一个具名分支记录，绑定 parent session、inclusive boundary event seq、kind（`retry | sidechain | experiment | rescue`）、child session id、visibility 与 retention 元数据。Branch 记录归属 session 存储档（`durable-state-and-scope.md` §1）。
- **Edit plan**：对某一 branch/session 事件范围的结构化变更声明（如截断、替换尾段），以 expectedVersion CAS 提交；plan 有且仅有一个终态（`success | error | aborted | denied | superseded`）。
- **External side effect**：不可由 session 状态恢复的副作用；沿用 `workspace-mutation-transaction` 的 external 标记词汇，必须显式 approval，不得假装可回滚。
- **Import face**：第三方 `import '@deepseek-ai/dsh-session'` 的包导入面——R 类明确不覆盖（R3）。
- **Host/client boundary**：初判 host-only（owner 包无 dsh.client manifest、无 client exports）；SBE-7 给出判定验收。Client 继续通过既有 client 面消费 session 数据，本 feature 不新增 client 权威。

## Standards Alignment

按 `docs/standards/` 六册对照：

- **capability-strategy**：核心适用——R1–R9 逐条落实（R1→SBE-4.4、R2→SBE-2、R3→SBE-3、R4→SBE-4、R5→SBE-1、R6→SBE-5、R7→SBE-6、R8→SBE-7、R9→SBE-15.4）；组件唯一 owner、boot 自检、版本锁定、上游提案退役均为硬性验收。
- **api-shape**：适用——branch graph 查询为 projection 面（冻结只读）；edit plan 为 durable mutation 面（identity + generation + commitState、fail-closed、审计）；branch kind 注册若开放策略化则属 policy 面，首版不开放（一面原则：主面为 durable mutation）。
- **identity-and-lifecycle**：适用——branch id 与 generation 用 owner 域内命名（opaque token）；终态词汇统一且 final；不用生命周期词冒充终态。
- **durable-state-and-scope**：核心适用——branch/edit 记录单档归属 session 层；多步变更 commit/rollback 不允许半提交可见；操作能力按 operation 声明（rollback 幂等性、restore 是否可自动 retry 默认否）。
- **visibility-and-redaction**：适用——branch 元数据默认 diagnostic/UI 可见、非模型可见；restore/preview 输出中的敏感内容沿用既有 redaction 底线。
- **concurrency-and-cancellation**：适用——stale plan 失去提交资格、abort 语义、disposer 按 identity 清理、并发策略声明为 compare-and-swap（Design 中细化 scope 与冲突判定）。

## Requirements

### SBE-1 Replacement identity and version lock (R5)

**User Story:** As a harness user, I want the replacement bundle to activate only against the exact runtime and owner package it was built for, so that an upgraded or mismatched environment degrades safely instead of misbehaving.

**Acceptance Criteria:**

1. **WHEN** the replacement bundle applies **THEN** it SHALL verify that the installed runtime full version (including prerelease suffix) and the `@deepseek-ai/dsh-session` package identity exactly equal its locked values.
2. **WHEN** either identity mismatches **THEN** the bundle SHALL deactivate only its own feature surface with an explicit error report and SHALL NOT load the replacement row.
3. **GIVEN** the auxiliary bundle's version differs from the main facade package's negotiated version **THEN** the assembly SHALL disable only this replacement feature and SHALL keep the main facade and unrelated features active.
4. **WHEN** identity verification succeeds **THEN** the bundle SHALL record the verified identities in its boot diagnostics.

**Classification:** R.

### SBE-2 Official contract replication before extension (R2)

**User Story:** As an existing consumer of the sessions service, I want every official service member and event preserved with its original shape, so that the replacement is indistinguishable at the contract level until branch features are used.

**Acceptance Criteria:**

1. **WHEN** the replacement row activates **THEN** the `sessions` ctx service SHALL expose at least every member exposed by the official row's public surface (`create`, `prepare`, `enter`, `announce`, `flush`, `get`, `list`, `fork`) with matching call signatures, timing, and error semantics.
2. **WHEN** session lifecycle transitions occur under the replacement row **THEN** the events `session/created`, `session/disposed`, `session/event`, and `session/flush` SHALL be dispatched with payloads matching the official shapes and ordering guarantees.
3. **WHEN** the official `fork` rejection codes (`SESSION_NOT_FOUND`, `SESSION_NOT_LIVE`, `SESSION_ALREADY_EXISTS`, `INVALID_BOUNDARY`, `OPEN_TURN`) apply to a fork attempt **THEN** the replacement SHALL reject identically and SHALL NOT loosen or swallow them.
4. **WHERE** the Design-stage replacement identity audit discovers additional public members or events on the locked owner version **THEN** the replication set SHALL be extended to cover them before any branch interface is added.

**Classification:** R.

### SBE-3 Import face boundary (R3)

**User Story:** As a plugin author importing official packages directly, I want my imports to keep resolving to the official package, so that the unsupported escape hatch keeps working unchanged.

**Acceptance Criteria:**

1. **WHEN** any code resolves `import '@deepseek-ai/dsh-session'` (or its subpath exports) in a profile where the replacement is active **THEN** resolution SHALL yield the official original package files.
2. **WHEN** the replacement bundle is packaged **THEN** it SHALL NOT re-export, shim, or alias the owner package's import face.
3. **WHERE** documentation describes the replacement boundary **THEN** it SHALL explicitly state that only the ctx service/event face is replaced.

**Classification:** R.

### SBE-4 Boot self-check and no double-run (R4)

**User Story:** As a harness user, I want the replacement to verify its installation at boot, so that a partially applied patch can never cause the official row and the replacement to run simultaneously.

**Acceptance Criteria:**

1. **WHEN** the replacement row applies **THEN** it SHALL assert that the official `session` row is disabled, that its own row is active, and that key contracts (a representative sessions service call and event receipt) are usable.
2. **WHEN** any self-check assertion fails **THEN** the bundle SHALL log a bounded diagnostic and return normally without throwing through apply, and SHALL NOT leave partial branch interfaces registered.
3. **WHEN** both the official behavior and the replacement behavior would be reachable for the same session operation **THEN** the configuration SHALL be treated as a fault condition detected by SBE-5 checks and SHALL fail safe rather than double-run.
4. **WHEN** the replacement is applied through the official patch mechanism **THEN** the patch SHALL use only the official `disabled: true` + `insert` replacement form and SHALL NOT modify any official package file (R1).

**Classification:** R.

### SBE-5 Component unique-owner conflict detection (R6)

**User Story:** As a profile maintainer, I want conflicts between replacement owners of the same component detected, so that two bundles never fight over the same official row.

**Acceptance Criteria:**

1. **WHEN** another installed bundle already replaces the official `session` row or inserts a competing row for it **THEN** the replacement SHALL detect the conflict, refuse to activate, and report the conflicting identity.
2. **WHEN** the patch application encounters a target row that is not present as expected, or a duplicate insert id **THEN** the replacement SHALL fail safe with an explicit diagnostic and normal return.
3. **GIVEN** no competing owner exists **THEN** activation SHALL proceed and record sole-ownership status in boot diagnostics.

**Classification:** R.

### SBE-6 Upstream proposal and retirement registration (R7)

**User Story:** As a maintainer, I want the replacement's upstream proposal and retirement condition registered, so that the bundle can be retired when officials ship an equivalent seam.

**Acceptance Criteria:**

1. **WHEN** the feature enters Stage 2 **THEN** its spec SHALL register at least one U-series upstream proposal covering the branch/edit contract and an explicit retirement condition (official equivalent branch/edit API ships and consumers migrate).
2. **WHEN** the replacement activates **THEN** its diagnostics metadata SHALL reference the registered proposal so operators can trace why the replacement exists.

**Classification:** R (governance acceptance verified via spec artifacts and boot diagnostics).

### SBE-7 Client-half determination (capability-strategy §10)

**User Story:** As a maintainer, I want the client-half decision recorded with evidence, so that host-only scope is a proven conclusion rather than an assumption.

**Acceptance Criteria:**

1. **GIVEN** the Stage 0 audit found no dsh.client manifest and no client exports in the owner package **THEN** the requirements/design SHALL record the six-item §10 determination with per-item evidence.
2. **WHERE** all six items resolve negative on the locked owner version **THEN** the replacement SHALL be host-only and SHALL NOT register client manifest entries or client-side replacements.
3. **WHEN** the identity audit finds any positive item on the locked version **THEN** the client half SHALL be replicated per R8 and this requirement's scope SHALL be revised before Stage 4.
4. **WHEN** a determination deviation is discovered at any later stage (audit, review, execution) **THEN** the scope SHALL be reworked per the evidence; rework cost SHALL NOT be treated as a reason to weaken or defer the determination（2026-08-25 用户指示：判定偏差必须返工，无返工负担）.

**Classification:** R (scope determination).

### SBE-8 Branch creation and parent immutability

**User Story:** As a rewind-plugin author, I want to create named branches from a parent session boundary, so that retry, side-question, experiment, and rescue flows share one identity model instead of bespoke forks.

**Acceptance Criteria:**

1. **WHEN** a caller creates a branch with a parent source, inclusive boundary, kind, and options **THEN** the replacement SHALL validate the boundary with the same strictness as the official fork primitive (including `OPEN_TURN` and `INVALID_BOUNDARY` rejections) and SHALL produce a new child session plus a branch record binding parent id, boundary, kind, child id, visibility, and retention.
2. **WHEN** a branch is created **THEN** the parent session's existing events SHALL remain unmodified, and the child SHALL be represented everywhere as a distinct session—not as an in-place modification of the parent.
3. **WHEN** branch creation succeeds **THEN** the branch record SHALL carry causal provenance (parent boundary seq and referenced source event seqs) and an owner-domain branch identity.
4. **WHEN** a caller supplies an unknown kind **THEN** the replacement SHALL reject with a typed validation result.
5. **WHEN** branch creation fails after the child session was prepared **THEN** the replacement SHALL clean up or mark the partial child explicitly and SHALL NOT leave an untracked half-created branch.
6. **WHEN** a branch operation forks, replaces, or rewinds a session's event stream **THEN** the replacement SHALL define explicit handling for existing client cursor positions on that session (typed invalidation or migration) and SHALL NOT let them fail silently.

**Classification:** R (core branch contract over the replicated fork primitive).

### SBE-9 Branch graph queries

**User Story:** As a UI or TUI author, I want to query current/ancestor/child branches, so that fork lineage is explorable without reconstructing it from raw events.

**Acceptance Criteria:**

1. **WHEN** a caller queries branches for a session **THEN** the replacement SHALL return frozen read-only views of matching branch records including kind, boundary, provenance, visibility, and retention metadata, and SHALL identify the current/active branch view.
2. **WHEN** a caller walks ancestors or children from a branch **THEN** the returned graph SHALL be consistent with committed branch records and SHALL NOT fabricate links from heuristics.
3. **WHEN** queried records contain sensitive content references **THEN** views SHALL follow the default audience policy: diagnostic/UI-visible, not injected into model context.

**Classification:** R (projection face).

### SBE-10 Edit plan lifecycle with CAS commit

**User Story:** As a rewind-plugin author, I want planned edits with preview and compare-and-swap commit, so that concurrent editors cannot apply stale changes silently.

**Acceptance Criteria:**

1. **WHEN** a caller plans an edit against a target with an expectedVersion **THEN** the replacement SHALL bind the plan to that version and reject planning when the expectation does not match current durable state.
2. **WHEN** a caller previews a plan **THEN** the preview SHALL describe the affected event range and resulting shape without mutating durable state.
3. **WHEN** a plan is committed **THEN** the commit SHALL be atomic from observers' perspective—no intermediate half-committed state visible—and SHALL record who/what/when/generation plus a **caller-provided `kind` classification** (e.g. `user`, the caller's plugin id, or `goal`) in audit metadata; the same caller-provided `kind` SHALL apply to both replace-form and append-form commits.
4. **WHEN** commit finds the expectedVersion stale or the plan already terminal **THEN** the replacement SHALL reject with a typed conflict result and SHALL leave current state untouched.
5. **WHEN** a plan reaches any terminal outcome (`success | error | aborted | denied | superseded`) **THEN** the outcome SHALL be final and unique; late results SHALL lose submission qualification.

**Classification:** R (durable mutation face per `api-shape.md` §1 and `durable-state-and-scope.md` §2).

### SBE-11 Rollback and external side effects

**User Story:** As a user, I want rollbacks to restore exactly what they claim, so that non-session side effects are never pretended away.

**Acceptance Criteria:**

1. **WHEN** a committed plan is rolled back by its commitId **THEN** the replacement SHALL restore the pre-commit **readable content** of the affected range (roles and boundaries annotated truthfully, never fabricating the original per-message shape) and mark the rollback durably.
   - 附注（2026-08-26 人类裁决，路线 B）：官方 surface replace 只支持折叠/1:1 交换且被 shadow 节点不能恢复可见性，逐条恢复多节点原始形状在 append-only 补偿机制下不可实现；内容级恢复即本验收的公认语义。
2. **WHEN** a plan declares or encounters effects outside session state **THEN** those effects SHALL be marked external, excluded from automatic rollback, and surfaced for explicit approval.
3. **WHEN** rollback is invoked twice **THEN** it SHALL be idempotent and SHALL NOT revert newer legitimate commits.
4. **WHEN** rollback cannot complete **THEN** the replacement SHALL fail closed with explicit state reporting and SHALL NOT present a partially restored session as recovered.

**Classification:** R.

### SBE-12 Restore verification

**User Story:** As a user, I want restores to verify consistency before completing, so that I am never told a restore succeeded when evidence says otherwise.

**Acceptance Criteria:**

1. **WHEN** a restore into a session is requested **THEN** the replacement SHALL verify restored session integrity (contiguity of the restored event range against declared plan/boundary) before reporting success.
2. **WHEN** declared external side effects exist for the restored range **THEN** restore completion SHALL require their explicit acknowledgment path and SHALL enumerate them in the result.
3. **WHEN** verification fails **THEN** the restore SHALL terminate with a typed error, leave the prior state flagged for recovery attention, and SHALL NOT auto-retry by default (operation capability declaration governs any retry).

**Classification:** R.

### SBE-13 Sidechain inheritance declaration

**User Story:** As a side-question author, I want to declare what a sidechain inherits from its parent, so that route, memory, attachments, and tool state carry-over is explicit instead of accidental.

**Acceptance Criteria:**

1. **WHEN** a sidechain branch is created **THEN** the creation options SHALL accept explicit inheritance choices for route, memory, attachments, and tool state.
2. **WHEN** inheritance is not declared **THEN** the replacement SHALL apply a documented minimal default and record the effective inheritance in the branch record.
3. **WHEN** inherited resources are unavailable in the child context **THEN** the child SHALL start degraded with the gap recorded, and SHALL NOT silently fabricate inherited state.

**Classification:** R.

### SBE-14 Concurrency, stale plans, and cancellation

**User Story:** As a plugin author, I want branch operations to observe unified concurrency and cancellation rules, so that aborts and supersessions behave like the rest of the platform.

**Acceptance Criteria:**

1. **WHEN** multiple plans target overlapping ranges **THEN** submission SHALL follow the declared compare-and-swap strategy; losers receive typed conflicts without corrupting winners.
2. **WHEN** a cancel signal arrives for an in-flight plan operation **THEN** the operation's terminal outcome SHALL be decided at a single submission point honoring `aborted > superseded > error` within the same window (timeout recorded as an `error` cause annotation, terminal vocabulary unchanged), and once atomically submitted SHALL NOT be rewritten.
3. **WHEN** an execution holding plan/branch handles is aborted or superseded **THEN** its pending async completions SHALL lose submission qualification and be retained only as diagnostics.
4. **WHEN** branch or plan disposer runs **THEN** cleanup SHALL be idempotent and identity-bound, never removing a newer owner's records.

**Classification:** R (facade/replacement guards per `concurrency-and-cancellation.md`).

### SBE-15 Facade compatibility and diagnostics

**User Story:** As an existing facade consumer, I want previously delivered session capabilities to keep working over the replaced row, so that installing the branch bundle changes nothing else.

**Acceptance Criteria:**

1. **WHEN** the replacement row is active **THEN** existing facade session capabilities (durable observation, restricted append, fork passthrough probes) SHALL operate over the replaced surface without semantic change.
2. **WHEN** the replacement degrades or fails any SBE check **THEN** the event SHALL be reported through plugin diagnostics with owner attribution, and availability surfaces SHALL reflect the true state.
3. **WHEN** the replacement is removed from the profile **THEN** the official row SHALL resume unchanged (reversibility), with no residual branch state required for official operation.
4. **WHERE** cross-cutting dispatch semantics (priority / deepFreeze / fault containment) or boot glue would be implicated **THEN** this feature SHALL NOT carry them on the replacement channel and SHALL keep its R slice bounded to the single `dsh-session` component (R9).

**Classification:** R (facade composition compatibility); this feature adds no B-class emulation hooks—existing facade capabilities run over the replaced surface as consumers only.

## Non-Goals

- Checkpoint quota/retention policies (owned by `recovery-policy`).
- Workspace file rollback or cross-system transaction coordination (owned by `workspace-mutation-transaction`; only its external-effect vocabulary is reused).
- Re-inventing fork mechanics beyond faithful replication (official fork remains the construction primitive).
- Policy-driven or third-party extensible branch kinds in the first version (four fixed kinds; extensibility deferred).
- Any client manifest, remote namespace, or browser-side authority (host-only per SBE-7).
- Modifying official package files; everything goes through the official patch mechanism.
