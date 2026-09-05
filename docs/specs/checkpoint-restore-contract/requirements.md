# Stage 1 - Requirements

> feature_name: `checkpoint-restore-contract`
> milestone: M9
> status: SPEC1 Stage 1 草案 v2（2026-09-05 批次；v2 按人类指示以 R-first/能力优先修订），与 Design v2 同批提交待用户确认；同批文档均获明确批准后方进入 Stage 3（Tasks）。

## Status

SPEC1 Stage 1 草案 v2（M9 四条线批量交付）。v1 曾以"facade 零 R"定稿，经人类裁决方向为 R-first、能力优先后修订：凡真实能力缺口且组件 owner 明确者一律采纳 R；C 类只保留 R 结构上不可达且附证据的极小集合。本文依据 Stage 0 Goal、M9 共同契约（`temp/m9-parallel-development-contract.md`）与本仓库 `docs/standards/` 编写。本文件与 Design v2 同批提交待批（M9 批量确认门）；同批文档均获明确批准后方进入 Stage 3（Tasks），获批前不写实现代码。

## Introduction

`checkpoint-restore-contract` 为第三方插件提供可审计、可分层降级的 checkpoint / restore contract。公共路径 `pluginApi.executions.recovery.checkpoints`（host）。三个语义面在同一 bounded context 内独立 owner、共享词汇：capture（`create`，durable mutation）、projection/plan（`list`/`inspect`/`planRestore`，只读）、restore（`restore`，operation，单一 authority 提交 terminal）。

**实现通道方向（v2）：facade B 编排 + 两个新增 R 能力切片，另复用已交付的 R 成果（不属本线新增切片）。**

- 共享 loop boundary slice（`dsh-agent-loop` owner 包，与 interaction/activity 共用）：提供 live-attempt 事实与 cancel boundary，支撑 (1) **恢复运行中 session**（stop-then-restore：先经 request authority 协调停止当前 attempt 并等待其 terminal，再回滚——而不是一律 denied）；(2) **自动捕获**（在 attempt 边界按捕获策略打 checkpoint，提供"可回退最近 N 步"的自动化）。
- workspace snapshot slice（新建 `dsh-workspace` owner 包）：交付事务窗口之外的 **workspace 受管状态快照与恢复**（file 级 rescue 的能力通道）；切片契约保真以 Stage 3 probe 为门，不可证明时该 source 诚实 unavailable，既有 transaction-journal source 保持可用。
- session 档 capture/restore 继续复用已交付的 `sessions.branches`（该行本身即 R 成果：`dsh-session` owner 包），本线不重复替换。
- 残余 C 只保留：执行中（in-flight）状态恢复、跨档原子单提交、外部副作用回滚、官方内部 durability checkpoint 引用——各附证据与退役条件。

选择性安装未含某切片或版本错配时，仅该能力降级/停用（typed unavailable/degraded + availability 明示），不波及其他面；full 安装默认交付全能力（`versioning-and-protocols.md` §3/§6）。冻结基线 `0.1.0-rc.6-0.1.0` 内交付，不步进任何版本字段。每条需求标注 A/B/C/R 分类。

## Requirement 1: Checkpoint Identity And Single Scope

**User Story:** As a plugin author, I want every checkpoint to have one stable identity and exactly one durable scope, so that checkpoints never fake cross-scope authority.

### Acceptance Criteria

1. WHEN a checkpoint is created THEN it SHALL carry a facade-generated `checkpointId` that SHALL NOT be an event sequence, cursor, execution identity, activity identity or operation identity, and SHALL NOT be reused.
2. WHEN a checkpoint record is written THEN it SHALL declare exactly one durable scope from `session | workspace | profile` per the M9 contract §2.5 vocabulary and SHALL carry the corresponding `sessionId`/`workspaceId`/`profileId`; v1 sources exist only for session/workspace scopes, so a profile-scope capture SHALL be typed `unavailable` and SHALL produce no record; cross-scope needs SHALL be represented as separate checkpoint records with explicit correlation and SHALL NOT be merged into one record.
3. WHEN a checkpoint references a source execution, activity, attempt or operation THEN the reference fields SHALL use the shared M9 identity vocabulary and SHALL NOT invent identities from event sequences.
4. WHEN a checkpoint record's scope resource no longer exists or is inaccessible THEN the record SHALL remain inspectable and SHALL mark the scope resource `unavailable` rather than deleting or rewriting history.
5. WHEN the same underlying state is captured twice at different times THEN those SHALL be two checkpoint records with distinct identities and shared lineage; SHALL NOT be merged unless an explicit capture-key dedupe contract declares it.

**Classification:** B facade durable-record semantics; `identity-and-lifecycle.md` §1/§3 and `durable-state-and-scope.md` §1.

## Requirement 2: Checkpoint Record, Capture Status And Provenance

**User Story:** As a plugin author, I want to inspect exactly what a checkpoint captured, what it did not, and who/why it was created.

### Acceptance Criteria

1. WHEN a checkpoint record is created THEN it SHALL persist a durable envelope with schema id, integer version, owner provenance, scope, identity and bounded data per `versioning-and-protocols.md` §5; records SHALL be append-only.
2. WHEN capture is recorded THEN the record SHALL carry per-component capture status from `captured | partial | missing | unknown | unavailable`, where `captured` requires the owning authority's proof, `partial` requires a list of what is missing, `missing` means the capture point was declared or expected but produced no data (an enumerable absence), `unknown` means there is no evidence to judge, and `unavailable` means the capture authority was unreachable.
3. WHEN capture status is not `captured` THEN the checkpoint SHALL be inspectable with those statuses exposed and SHALL NOT present itself as a full capture.
4. WHEN a checkpoint is created THEN provenance SHALL record source execution/activity/attempt correlation when available, derived creator owner, creation time and reason, without payload content or secrets.
5. WHEN a checkpoint references content anchors THEN the anchors SHALL be validated against their owning authorities at plan time and SHALL be marked `unavailable`/`stale` when unconfirmable.
6. WHEN an unknown future schema/version is read THEN the reader SHALL return `unsupported-schema` and SHALL NOT guess or silently drop fields.

**Classification:** B durable mutation/projection semantics; `durable-state-and-scope.md` §1-§2, `versioning-and-protocols.md` §5.

## Requirement 3: Capture Create Mutation With Source Capabilities

**User Story:** As a plugin author, I want one authority-governed capture entry that creates a checkpoint only when the capture sources can honestly capture.

### Acceptance Criteria

1. WHEN a caller invokes `create(spec)` with a valid spec THEN the system SHALL route it through the checkpoint capture authority and SHALL return the durable mutation outcome with `commitState` and a frozen result summary.
2. WHEN the spec declares a capture source THEN the system SHALL accept only registered sources; the v1 source table SHALL contain `branch` (session scope, existing `sessions.branches` authority), `workspace-journal` (workspace scope, existing `workspaces.transactions` authority), and `workspace-snapshot` (workspace scope, workspace snapshot slice per Requirement 8, when that slice is active); an unregistered or unavailable source SHALL return the typed `unsupported`/`unavailable` outcome and SHALL NOT create a fake record.
3. WHEN the declared source's owning authority is unavailable or capability-gated THEN create SHALL return the typed unavailable outcome with the concrete missing capability and SHALL NOT write a record pretending the capture happened.
4. WHEN a capture partially succeeds THEN the mutation SHALL commit the record with honest `partial`/`unknown` statuses and expose them in the outcome; partial capture SHALL be a domain result field.
5. WHEN the caller retries with the same capture key before the mutation settles/commits THEN the system SHALL return the existing record reference (dedupe); after settle/commit, a deliberate re-trigger SHALL create a new record with lineage.
6. WHEN a capture would mutate session history, workspace state or any durable domain state THEN it SHALL do so exclusively through the corresponding owning authorities and SHALL NOT bypass them.
7. WHEN capture audit appends fail THEN the mutation SHALL retain its declared effect and expose a bounded audit gap marker; the system SHALL NOT fabricate a record.

**Classification:** B facade durable mutation over A/R anchor authorities (`sessions.branches`、`workspaces.transactions`、workspace snapshot slice); retry/attempt per `durable-state-and-scope.md` §3-§4.

## Requirement 4: Checkpoint Projection Queries

**User Story:** As a plugin author, I want to list and inspect checkpoints with frozen, redacted views.

### Acceptance Criteria

1. WHEN a caller queries checkpoints THEN `list({ scope?, resourceId?, cursor?, limit? })` SHALL return a frozen ordered page with cursor continuation, and `inspect(checkpointId)` SHALL return the full frozen record.
2. WHEN a caller filters by scope or resource THEN the projection SHALL filter by the record's single declared scope and SHALL NOT return cross-scope results under one filter.
3. WHEN a record or scope resource is missing THEN the query SHALL return typed absence/unavailable and SHALL NOT throw (P1/P2 apply to core/capability failure only).
4. WHEN projection content is returned THEN it SHALL be redacted host-side; payload content, anchors' private state and secrets SHALL NOT appear.
5. WHEN a record schema is unknown THEN the projection SHALL surface `unsupported-schema` and SHALL NOT fabricate fields.

**Classification:** B projection; verbs per `api-idioms.md` §3.1 and M9 contract verb list.

## Requirement 5: Restore Planning — Pure Frozen Plan

**User Story:** As a plugin author, I want a side-effect-free restore plan I can review before anything executes.

### Acceptance Criteria

1. WHEN a caller invokes `planRestore(checkpointId)` (pure, no side effects) THEN the system SHALL compute a frozen plan containing: per-slice steps bound to concrete owning authorities, each step's expected effect, required claims and preconditions, per-slice restoreability (`restoreable | partial | unavailable | not-applicable`), the external-effects statement, and the plan fingerprint.
2. WHEN the shared loop boundary slice is active THEN the plan SHALL state the target session's live-attempt status as observed evidence (`running`/`idle`/`queued` with attemptId) and SHALL mark the "stop-then-restore" path available; WHEN the slice is inactive THEN the plan SHALL use the best available activity evidence, mark running-session restore `unavailable`, and state the concrete reason.
3. WHEN a plan step's precondition is not currently satisfiable THEN the plan SHALL mark that step blocked/`unavailable` with the concrete reason and SHALL NOT silently drop it.
4. WHEN the checkpoint contains no restoreable slice THEN `planRestore` SHALL return a plan whose overall restoreability is `unavailable`/`not-applicable` with reasons.
5. WHEN the checkpoint record or its anchors changed, expired or became stale between plan and execution THEN execution SHALL re-validate the plan and SHALL reject a stale plan with a typed conflict outcome.
6. WHEN external effects are present THEN the plan SHALL list them with rollbackability (`rollbackable | external | unknown`) and SHALL NOT execute or promise rollback for `external`/`unknown` effects.
7. WHEN `planRestore` is called THEN it SHALL NOT write anything, acquire anything durably, or change state; repeated calls with the same state SHALL produce the same fingerprint.

**Classification:** B pure plan computation over record + live authority map (projection semantics; `planRestore` prescribed-verb exception registered).

## Requirement 6: Restore Operation — Single Authority Terminal, Stop-Then-Restore

**User Story:** As a plugin author, I want restore to run through one authority that commits exactly one terminal — including restoring a session whose last run is still in flight.

### Acceptance Criteria

1. WHEN a caller invokes `restore(checkpointId, { plan, signal? })` with a valid plan snapshot THEN the system SHALL create one restore operation through the single checkpoint restore authority and SHALL return the operation handle (`{ id, ownerId, status(), observe(), dispose() }`).
2. WHEN the restore executes THEN the authority SHALL first re-validate the plan fingerprint, the checkpoint record, required claims and preconditions; on failure it SHALL return typed `denied`/`conflict`/`unavailable` and SHALL NOT execute any step.
3. WHEN the target session has a live attempt and the plan declares the stop-then-restore path THEN the authority SHALL (a) request stop of the live attempt through the shared request authority's cancel boundary, (b) wait for the attempt's committed terminal (with bounded wait and the caller's cancellation semantics preserved), and (c) only then apply the rewind steps; if the attempt does not reach a terminal in the declared bound THEN the operation SHALL fail closed with `error`/`denied` and SHALL NOT rewind under a live attempt.
4. WHEN restore executes steps THEN it SHALL drive each step exclusively through its declared owning authority (branch restore for session slices; transaction or workspace-snapshot authority for workspace slices), SHALL record each step's typed result, and SHALL stop on the first unrecoverable step failure with `error` terminal and a partial-result domain field (`stepsDone`, `failedStep`, per-slice statuses); partial restore SHALL be a domain result field.
5. WHEN a cancel is requested or the caller's signal aborts THEN the authority SHALL stop starting new steps, let the current step reach its authority's defined boundary, and adjudicate the terminal per the shared priority; a cancellation SHALL NOT forge a step's result.
6. WHEN a step's owning authority returns `denied`, a fencing/CAS conflict, or a stale-anchor result THEN the authority SHALL classify the step result accordingly, SHALL NOT retry beyond the declared capability, and SHALL NOT overwrite the anchor authority's committed outcome.
7. WHEN the operation commits a terminal THEN it SHALL be exactly one of `success | error | aborted | denied | superseded`, final and unique; late step results, stale callbacks and post-terminal signals SHALL be rejected by commit eligibility.
8. WHEN multiple checkpoint records could be restored THEN each SHALL restore as its own operation; there SHALL be no implicit cross-record cascade; combined cross-scope restore SHALL be expressed as multiple explicit operations or typed unavailable where atomicity would be required.
9. WHEN internal retry is needed THEN it SHALL be an attempt under the same restore operation; external re-trigger SHALL create a new operation with lineage; default SHALL be no automatic retry.

**Classification:** B facade operation orchestrating A/R authorities (incl. shared cancel boundary); follows `api-idioms.md` §3.4, `identity-and-lifecycle.md` §3, `durable-state-and-scope.md` §3-§4, `concurrency-and-cancellation.md` §1-§3.

## Requirement 7: Coordination, Fencing And Claims

**User Story:** As a plugin author, I want restore to hold provable authority over what it touches.

### Acceptance Criteria

1. WHEN a restore operation needs exclusive control of a target resource THEN it SHALL acquire the corresponding coordination lease (fencing) BEFORE the stop/rewind sequence and SHALL carry the fencing token through step boundaries.
2. WHEN the lease cannot be acquired or is lost mid-operation THEN the authority SHALL stop starting new steps, fail the affected steps closed, and adjudicate the terminal from still-valid signals; it SHALL NOT continue writing with a stale fence.
3. WHEN a restore step writes through an owning authority with its own CAS/fencing THEN the operation SHALL pass its fencing/claim proof and SHALL NOT bypass it.
4. WHEN two restore operations or a restore and a live process target the same resource THEN the second SHALL receive a typed conflict/denied outcome and SHALL NOT interleave with the first.
5. WHEN required claims are declared in a plan THEN the operation SHALL re-check them before each gated step and SHALL NOT execute a step whose claim is no longer held.

**Classification:** B orchestration over delivered coordination authority; fencing per `composition-and-authority.md` §7 and contract §2.4.

## Requirement 8: Workspace Snapshot Slice Contract (R)

**User Story:** As a plugin author, I want authoritative workspace-state snapshots and restores beyond transaction windows, so that file-level rescue does not depend on open transactions.

### Acceptance Criteria

1. WHEN the workspace snapshot slice is added THEN it SHALL become the replacement owner of the official `workspace` row (web profile) through the official patch mechanism only (`disabled: true` + insert); it SHALL NOT modify official package files and SHALL NOT add unrelated rows.
2. WHEN the slice is active THEN it SHALL reproduce every ctx service, event, timing, payload, receiver, error and disposer contract of the replaced official row (`workspaceRegistry` etc.) before adding the snapshot/restore interfaces (cap-strategy R2); additions SHALL be additive.
3. WHEN the slice provides workspace-managed state snapshots THEN capture SHALL record the authoritative workspace state (as owned by the replaced row's domain) at the capture point with its own per-component status; restore SHALL apply the snapshot through the slice's own authority-bound path within the restore operation's fencing, and SHALL NOT touch state the workspace row does not own.
4. WHEN the slice applies THEN it SHALL verify the official row is disabled, exactly one replacement row is active, runtime and package identities match, and no component-owner conflict exists (cap-strategy R4/R5/R6).
5. WHEN a self-check or contract-parity probe fails THEN the slice SHALL log bounded diagnostics and SHALL NOT claim the snapshot capability; the official-contract behavior of the row SHALL remain functional (fork or official-behavior fallback), the `workspace-snapshot` capture source SHALL report unavailable, and the installation SHALL NEVER be left with the official row disabled and no working official-contract path.
6. WHEN the client-half determination is recorded THEN it SHALL document each of the capability-strategy §10 six questions with evidence and conclude host-only or full-client-half accordingly (the replaced official row's manifest facts are the evidence); a full client half SHALL follow R7 (self-built bundle, `window.__DSH_BOOT__` and HMR verification).
7. WHEN third-party code directly imports the official `@deepseek-ai/dsh-workspace` package THEN the slice SHALL NOT claim to intercept or replace that import surface (cap-strategy R3).
8. WHEN the official workspace component is absent (e.g., headless profile) or version-mismatched THEN the slice and its capture source SHALL be unavailable with typed reporting; the `workspace-journal` source (delivered transaction authority) SHALL remain available where the transactions face is available.
9. WHEN the workspace snapshot slice is delivered THEN it SHALL register its U-series upstream proposal and retirement condition in feature-list §3.1 at the integration wave.
10. WHEN the official component later provides an equivalent public snapshot/restore seam THEN the slice SHALL follow the registered retirement condition to migrate back to official binding.
11. WHEN the Stage 3 contract probe cannot establish that the workspace row's mutations flow through the replaced service in a capturable way THEN the delivery SHALL NOT claim file-level restore; it SHALL record the probe evidence and keep `workspace-snapshot` unavailable (no fake capability).

**Classification:** R（新建 `dsh-workspace` owner 包）；capability-strategy R1–R8 适用条款逐条满足；Stage 3 probe 为能力门。

## Requirement 9: Loop Boundary Consumption And Auto-Capture (R 共享)

**User Story:** As a plugin author, I want automatic rescue points at real attempt boundaries and precise live-run knowledge, so that rewind tools work without manual capture discipline.

### Acceptance Criteria

1. WHEN the shared loop boundary slice (agent-loop owner package, joint with interaction/activity; implementation owned by the `session-interaction-operation` line, this feature consumes it read-only) is active THEN the checkpoint feature SHALL consume its attempt facts (`agent/attempt/start|end`) and cancel boundary through the facade internal contract: (a) live-attempt status becomes observed evidence for restore preconditions (Requirement 5 AC2/Requirement 6 AC3), (b) stop-coordination uses the shared cancel boundary through the interaction request authority — the facade-internal cancel propagation invoked with `by: 'system'` and the restore operation cause attached, not a second cancel path, (c) auto-capture triggers MAY fire on attempt boundaries.
2. WHEN auto-capture is enabled (per declared capture policy) THEN the system SHALL create branch-anchored session checkpoints at the policy's attempt boundaries with honest capture status; the policy SHALL be owner-scoped, bounded, observable and SHALL NOT auto-capture beyond its declared cadence without explicit enablement.
3. WHEN the slice is inactive or version-mismatched THEN auto-capture SHALL be unavailable, restore-while-running SHALL fall back to the denial path with the concrete reason in availability/plan, and manual capture/restore of sessions whose idle state is confirmable via available evidence (activity projection or durable session facts) SHALL remain available; when idle cannot be confirmed, capture/restore SHALL return the typed blocked/denied outcome with the concrete reason (fail-closed direction, per Requirement 5 AC2).
4. WHEN the slice emits facts for the checkpoint feature THEN the checkpoint feature SHALL NOT dispatch, transform or veto those events and SHALL NOT become their producer.
5. WHEN an auto-captured checkpoint is created THEN it SHALL be a normal checkpoint record (Requirement 2/3 semantics) with provenance marking its automatic trigger.

**Classification:** R consumption of the shared loop boundary slice（同 interaction/activity 的 §3.1 联合登记）；auto-capture orchestration is B over R facts.

## Requirement 10: External Effects And Honest Boundaries

**User Story:** As a plugin author, I want the contract to say plainly what it cannot roll back.

### Acceptance Criteria

1. WHEN a checkpoint or plan mentions an external effect THEN the record/plan SHALL classify it `rollbackable | external | unknown` and SHALL NOT execute or auto-rollback `external`/`unknown` effects.
2. WHEN v1 capture sources capture only their declared anchors THEN the checkpoint SHALL NOT claim coverage of state outside those anchors; uncovered state SHALL be `unknown`/`missing`.
3. WHEN a consumer asks to restore something no authority can prove THEN the system SHALL return the typed `unsupported`/`unavailable` result with the missing authority named, and SHALL NOT invent an implicit owner or bypass path.
4. WHEN restore touches a session whose attempt was stopped by stop-coordination THEN the restore operation's record and the resulting branch SHALL carry the lineage-supersession attribution (superseded-by-restore, referencing the pre-restore execution/attempt identities) written through the owning branch authority — not a relabeling of the loop side; the stopped attempt's loop-side terminal SHALL remain the interaction operation authority's adjudication (typically `aborted` via the cancel signal); if the stop or lineage authority cannot be proven (attempt never reached a terminal, branch authority unavailable), the attribution SHALL be typed `unavailable` and SHALL NOT be invented; the in-flight execution state (attempt/tool/provider context) SHALL NOT be claimed as restored — that is a retained C-class boundary.
5. WHEN documentation states the restore boundary THEN it SHALL enumerate the v1 supported sources, their restore semantics, and the retained gaps (in-flight execution state restore, cross-scope atomic single commit, official internal durability checkpoint references, external effects rollback) with the retirement condition of each.

**Classification:** B boundary contract; retained gaps follow `capability-strategy.md` §7 and are registered as U-series at the integration wave.

## Requirement 11: Availability, Capability And Degradation

**User Story:** As a plugin author, I want to know which capture sources and restore slices my installation can serve.

### Acceptance Criteria

1. WHEN a caller queries availability THEN `executions.recovery.checkpoints.availability()` SHALL return frozen `{ status, reason? }` covering the projection, each v1 capture source (`branch`, `workspace-journal`, `workspace-snapshot`), the auto-capture policy, and the restore authority (including its stop-then-restore capability), and SHALL never throw.
2. WHEN a capture source, slice or capability is missing (branch owner inactive, workspace profile absent, workspace snapshot slice inactive/probe-failed, loop boundary slice inactive) THEN the corresponding entry SHALL return typed unavailable/denied, availability SHALL name the concrete cause, and unrelated faces SHALL stay active.
3. WHEN the facade core is inactive or the capability disabled THEN callers SHALL receive uniform P1/P2 errors per contract §6.
4. WHEN capability presence is negotiated THEN `capabilities` SHALL expose the checkpoints capability, the per-source capabilities and the restore capability without package, row or replacement identities.
5. WHEN an installation cannot serve the restore authority at all THEN list/inspect/plan SHALL remain available and restore SHALL report typed unavailable (Goal's minimum-deliverable rule).

**Classification:** B（facade 自述；无独立 A/R 缺口）；taxonomy per contract §6 and `capability-strategy.md` §6.2.

## Requirement 12: Mutation, Plan And Operation Boundaries

**User Story:** As a maintainer, I want checkpoint features to stay inside their own authority.

### Acceptance Criteria

1. WHEN a checkpoint needs durable record persistence THEN it SHALL use the declared single-scope durable record contract with schema envelope and SHALL NOT open a second storage platform, generic scheduler, task registry or memory/context-retrieval system.
2. WHEN restore touches session durable content THEN it SHALL go through the session branch authority's restore semantics only; direct session mutation, append rewriting or durable event splicing SHALL be prohibited.
3. WHEN restore touches workspace state THEN it SHALL go through the workspace transaction authority or the workspace snapshot slice only; the checkpoints feature SHALL NOT own file/workspace mutation paths.
4. WHEN a checkpoint/plan/restore observes execution/recovery state THEN it SHALL NOT consume or double-consume recovery decisions, SHALL NOT change route/admission/approval policy, and SHALL NOT suspend or park an in-flight attempt itself (suspension semantics are not provided; stop-then-restore is the supported boundary).
5. WHEN a caller wants to delete or purge a checkpoint THEN v1 SHALL NOT provide a public purge mutation; records are audit append-only.
6. WHEN the vocabulary is used THEN `terminal`/`commitState`/partial SHALL keep their assigned field roles and SHALL NOT be merged.

**Classification:** Boundary/non-goal across A/B/R; vocabulary per contract §2.3.

## Requirement 13: Verification And Delivery Gates

**User Story:** As a maintainer, I want mechanical evidence that checkpoint semantics never overclaim and slices never break their rows.

### Acceptance Criteria

1. WHEN capture is tested THEN fixtures SHALL prove record identity/scope, per-component statuses, dedupe/lineage, source authority routing, unavailable outcomes and honest partial records on real or contract-faithful fixtures.
2. WHEN planning is tested THEN fixtures SHALL prove pureness, fingerprint stability, precondition marking (including slice-active live-attempt evidence vs slice-inactive denial), stale-plan detection and restoreability classification.
3. WHEN restore is tested THEN fixtures SHALL prove single-authority terminal, stop-then-restore sequencing (cancel request → attempt terminal wait → rewind; bounded-wait failure closes), fencing acquisition/loss, stepwise partial results, cancel adjudication, stale rejection, no cascade and retry/attempt semantics.
4. WHEN slice tests run THEN workspace snapshot slice and loop-boundary consumption SHALL cover official-contract parity, version mismatch, boot self-check, owner-conflict, no double-run, probe-failure degradation, removal/official-row restoration and headless absence.
5. WHEN boundary tests run THEN fixtures SHALL prove no bypass of branch/transaction/workspace/coordination authorities, no recovery double-consume, no attempt suspension, no durable rewrite and append-only records.
6. WHEN two synthetic plugins exercise the same paths in reverse registration order THEN outcomes SHALL be identical and owner isolation SHALL hold.
7. WHEN registry/shape checks run THEN every new member and capability (incl. per-source capabilities, `planRestore` prescribed-verb exception) SHALL be registered with one primary idiom, semantic face, effect, composition, scope, authority and availability shape; surface snapshots SHALL match.
8. WHEN the guarded full test suite, `git diff --check`, registry/surface consistency, official-package zero-modification audit and the required global adversarial review run THEN all SHALL pass before the Stage 4 completion commit.
9. WHEN any required authority, anchor or fixture cannot establish evidence THEN the affected capture source, plan step or restore slice SHALL remain typed unavailable/blocked and the delivery SHALL NOT declare that part complete.

**Classification:** Delivery foundation covering B orchestration and the two R surfaces.

## R 决策与残余 C 类登记（v2）

- 采纳 R：(1) 共享 loop boundary slice（agent-loop owner 包，联合 interaction/activity）——能力：运行中 session 的 stop-then-restore、自动捕获、observed live-attempt 前置条件；(2) workspace snapshot slice（新建 `dsh-workspace` owner 包）——能力：事务窗口外的 workspace 受管状态快照/恢复（file 级 rescue 通道），Stage 3 probe 为门。
- 未采纳 R（证据）：`dsh-session`（branch 锚点/恢复已由既有 owner 包交付，本线复用，不重复替换）；`dsh-agent-loop` 不再新增第二包（共享切片已覆盖）；`dsh-storage`（记录走 facade 单档 scope durable 设施，替换 storage 行等于新开持久化平台，违反 Goal 边界）。
- 残余 C（证据 + 退役条件）：执行中（in-flight）attempt/tool/provider 状态恢复——该状态无 durable 可引用面，stop-then-restore 是可达边界，官方提供 attempt 持久化 seam 后升级；跨档原子单提交——无官方跨组件原子原语（编排存在但崩溃原子性不可证明）；官方内部 durability checkpoint 引用（`session-checkpoint-policy` 行无公开面可复刻，cap-strategy R2 契约不可证明）；外部副作用回滚——非任何官方组件可承诺语义。

## M9 Contract Conformance And Deviation Notes

契约 §1/§2/§3.4/§3.5/§5/§6 采纳。偏离记录（契约 §8）：

1. v1"零 R"废弃，v2 按 R-first 修订（本文件 R 决策节）；`planRestore` 预定 verb 例外保留；v1 host-only 保留；v1 无 purge 保留。
2. park 语义定稿为 **stop-then-restore**（Requirement 6 AC3/Requirement 10 AC4）：本线不提供 attempt 挂起（suspension），其正确性边界不可证明；"停止当前 attempt → 等待 terminal → 回滚 → 由 interaction request 续跑（新血缘，父因标记 checkpoint）"是可证明的恢复运行中 session 语义。补偿测试：stop-then-restore 全时序 fixture + bounded-wait 失败闭合 fixture。
3. 共享 loop boundary slice 与 interaction/activity 联合登记（§3.1；切片实现归 `session-interaction-operation` 线（agent-loop owner 包），本线只读消费其契约、不各建词汇）；workspace snapshot slice 为新建 `dsh-workspace` owner 包（行/包名最终定稿于集成波，运行时命名不携带治理编号）。

## Standards Applicability And Alignment

- `capability-strategy.md`: applicable。两处 R 采纳（既有包扩展 + 新建 owner 包）逐条满足 R1–R8；Stage 3 probe 为能力门；残余 C 附证据；framework 语义不进本 feature。
- `api-shape.md`: applicable。projection/mutation/operation 三面独立 owner；plan 纯读；无 policy 混入。
- `api-idioms.md`: applicable。mutation `commitState`、operation handle/terminal、projection verb、prescribed-verb 例外、availability 全对齐。
- `public-api-shape.md`: applicable。挂 `executions.recovery.checkpoints`；不新增顶层 namespace/alias；不暴露包/行身份。
- `composition-and-authority.md`: applicable。单一 restore authority；claim/lease/fencing；stop 协调经 request authority 唯一 cancel 路径；旁路为零并登记。
- `domain-composition.md`: applicable。branches/transactions/coordination/recovery 领域最低要求复用且不绕过；workspace snapshot slice 只在其行拥有的领域内工作。
- `ordering.md`: applicable。restore 步骤顺序 = plan 内领域固定阶段。
- `identity-and-lifecycle.md`: applicable。checkpointId/executionId/attemptId 分工；terminal 唯一；恢复后血缘显式标记。
- `durable-state-and-scope.md`: applicable。单档 scope + schema envelope + append-only；operation 能力声明；partial 领域字段。
- `visibility-and-redaction.md`: applicable。逐出口脱敏；gap/external effects 可见；secret 不出任何出口。
- `concurrency-and-cancellation.md`: applicable。stop-then-restore 时序、fencing 丢失、取消传播、提交资格、迟到结果、attempt 边界逐条声明。
- `versioning-and-protocols.md`: applicable。冻结基线；新增 workspace owner 包遵循 `A.B.C` 装配契约（错配只停用该 slice）；记录 schema/version 落 envelope。

## 备注（Stage 边界）

本文件只确认 Requirements 方向。Design 将确定：三面数据模型、capture source 表与 owning authority 绑定、workspace snapshot slice 的 probe 门与 fallback、stop-then-restore 时序、auto-capture 策略形状、C 类 gap 登记、registry/包/行拟新增清单。Tasks 通过对抗性审查后才进入实现。
