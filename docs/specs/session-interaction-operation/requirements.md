# Stage 1 - Requirements

> feature_name: `session-interaction-operation`
> milestone: M9
> status: SPEC1 Stage 1 草案（2026-09-05 批次），待用户确认；Stage 2 Design 只可在本阶段获批后开始。

## Status

SPEC1 Stage 1 草案（M9 四条线批量交付）。本版依据已提交的 Stage 0 Goal（`docs/specs/session-interaction-operation/goal.md`）、M9 共同契约（`temp/m9-parallel-development-contract.md`）与本仓库 `docs/standards/` 各分册编写。用户确认本文件后进入 Stage 2；本文档获批前不写实现代码。

## Introduction

`session-interaction-operation` 为第三方插件提供受 authority 约束的 session interaction operation：插件请求宿主处理一条新的 session interaction（`pluginApi.sessions.request`）或请求取消正在进行的处理（`pluginApi.sessions.cancel`），并获得稳定 operation identity、activity/execution correlation、幂等结果与唯一终态。`appendMessage` 仍然只是受限 durable mutation；本 feature 不把写入消息、启动处理、取消信号与 retry 混成一个动词。

实现通道方向：**facade B 公共 operation 面（host + client）+ 一个 R 能力切片**——在 `dsh-agent-loop` 既有 replacement owner 包（`plugin-api-agent-loop`）内扩展 request admission / cancel boundary 与 attempt 事实（同组件同包第二 feature 先例：U19 assembled-context evidence）；扩展不新建 replacement 包、不新增被禁用官方行，官方行契约整面保留。若 Stage 3 probe 证明官方 seam 已足以支撑同样语义，按 Design 决策规则退回纯 facade 并登记修订。每条需求标注 A/B/C/R 分类。

本 feature 使用 `session-activity-projection` 冻结的 activity 词汇表达 request/execution/attempt 关联，不另造 activity state machine；不拥有 route policy、LLM admission、tool exposure、recovery policy 或 notification presentation；`cancel` 不保证底层 provider 或外部工具立即停止。

本 feature 在 AGENTS.md §3.0.1 冻结基线内交付：不步进 `A`/`B.C`/`D`（现行 `0.1.0-rc.6-0.1.0`，`dsh.api: 0.1`）；公共成员与语义在集成波同步 canonical registry 与 capability/availability 记录。

## Requirement 1: Request Operation Entry And Acceptance Outcomes

**User Story:** As a plugin author, I want one supported entry to ask the host to process a new session interaction, so that I never guess the agent loop through append, flush or private RPC.

### Acceptance Criteria

1. WHEN a caller invokes `pluginApi.sessions.request(spec)` with a valid session, a supported source/message payload, and caller-derived owner context THEN the system SHALL route the request through the single session request authority and SHALL return a typed outcome selecting one of `accepted`, `duplicate`, `already-running`, `rejected`, `denied` or `unavailable` as the primary code.
2. WHEN the outcome is `accepted` THEN the system SHALL create one operation with a facade-generated `operationId`, an associated facade execution identity when the underlying execution exists, and SHALL return the operation handle; the caller SHALL NOT observe any activity change before the authority commits acceptance.
3. WHEN the spec is malformed, targets a nonexistent session, carries an unsupported message kind, or violates the audited source rules of the durable mutation layer THEN the system SHALL return the typed `rejected`/invalid-input outcome with a bounded reason and SHALL NOT start processing or append anything.
4. WHEN the request cannot be served because the session request authority or its loop boundary is unavailable (for example the agent-loop capability is inactive or version-mismatched) THEN the system SHALL return a typed `unavailable` outcome and SHALL NOT silently report success, queue the work invisibly, or fall back to an append-and-guess path.
5. WHEN the request is admissible THEN the underlying durable user/source content SHALL be appended through the existing audited durable mutation contract with its source provenance recorded; the request authority SHALL NOT bypass that contract and SHALL NOT invent content the caller did not provide.

**Classification:** B facade operation over the official/forked loop seams (A where official seams exist) plus the R admission boundary on the agent-loop owner slice; all acceptance variants are discriminated results, never boot failures (contract §6).

## Requirement 2: Operation Handle And Lifecycle

**User Story:** As a plugin author, I want a stable handle to follow my request to one deterministic end, so that auto-continue and UI code do not re-derive state from raw events.

### Acceptance Criteria

1. WHEN a request is accepted THEN the returned operation handle SHALL be shaped `{ id, ownerId, status(), observe(), dispose() }` where `id` is the `operationId`, `ownerId` is derived from the caller context, `status()` returns the frozen current operation status, `observe()` subscribes to operation progress/terminal updates, and `dispose()` requests stop of the caller's own operation.
2. WHEN an operation reaches a terminal THEN `status()` and observers SHALL report exactly one frozen terminal drawn from `success | error | aborted | denied | superseded`; a terminal SHALL be final and SHALL NOT be rewritten by later signals, retries or late results.
3. WHEN a caller calls `dispose()` on its own operation handle THEN the system SHALL treat it as a stop request only; the terminal SHALL be adjudicated by the operation authority at its commit point and SHALL NOT be forged as `aborted` by the dispose call itself.
4. WHEN a stale handle (after terminal, dispose, owner reload or generation replacement) calls `status()`, `observe()`, or `dispose()` THEN the system SHALL return the idiom's typed stale/no-op result and SHALL NOT affect a newer operation or another owner.
5. WHEN an operation observes timeout THEN its terminal SHALL be `error` with reason/classification marking the timeout, and SHALL NOT create a new terminal word.

**Classification:** B operation idiom; handle and terminal vocabulary follow `api-idioms.md` §3.4 and `identity-and-lifecycle.md` §3; cross-feature vocabulary uses `session-activity-projection`'s frozen activity record semantics for correlation.

## Requirement 3: Single Request Authority — No Append-Flush Guessing

**User Story:** As a maintainer, I want every external session request committed by exactly one operation authority, so that plugins can never race the loop into double processing.

### Acceptance Criteria

1. WHEN any external session interaction request arrives through a supported public path THEN it SHALL be serialized through the one session request authority of this feature, which SHALL own acceptance, dedupe, cancellation propagation and terminal adjudication for external requests.
2. WHEN a third-party plugin appends content directly through `sessions.durable.appendMessage` THEN the system SHALL NOT interpret that append as an implicit processing request; starting processing SHALL require an explicit request operation or the session's own official driving path.
3. WHEN the request authority accepts a request THEN it SHALL hand the accepted work to the loop boundary exactly once (the admission contract of the agent-loop slice), and a crash, retry or reconnect SHALL NOT cause a second admission of the same request unless a new external request was made.
4. WHEN an admission or commit attempt fails with ambiguity THEN the authority SHALL fail closed: the operation SHALL report `error`/`unavailable` with the ambiguity in its bounded reason and SHALL NOT let a consumer infer processing started.
5. WHEN the same external request reaches the authority twice with the same idempotency key before a terminal THEN the second call SHALL return the `duplicate` outcome referencing the existing operation and SHALL NOT admit the work twice.

**Classification:** B authority + R admission boundary; the framework dispatch semantics (priority/deepFreeze/fault containment) stay outside any slice (`capability-strategy.md` §2/§8).

## Requirement 4: Cancel Is A Signal, Terminal Is An Adjudication

**User Story:** As a plugin author, I want cancellation to stop the loop's effort without faking its outcome, so that aborted and error never blur.

### Acceptance Criteria

1. WHEN a caller invokes `pluginApi.sessions.cancel({ sessionId?, operationId?, reason? })` or aborts an accepted request's signal THEN the system SHALL propagate a cancellation request to the still-live operation, its current attempt and the owned provider/tool work where the loop boundary exposes them, and SHALL NOT itself write a terminal.
2. WHEN the cancellation reaches the operation's commit point THEN the authority SHALL adjudicate the terminal from the still-valid competing signals using the shared priority (`aborted` > `superseded` > `error` > timeout-`error`) within the commit window, and SHALL atomically commit exactly one terminal.
3. WHEN a cancel request arrives after the operation already committed a terminal THEN the system SHALL return a typed stale/conflict outcome and SHALL NOT rewrite the committed terminal or start a new attempt.
4. WHEN a parent operation or execution is cancelled THEN cancellation SHALL propagate to its still-live child operations and attempts; a child's own cancellation or failure SHALL NOT reverse-cancel the parent execution unless the operation contract declares the child required.
5. WHEN a cancel request aborts an AbortSignal derived from the caller THEN the system SHALL preserve upstream cancellation semantics and SHALL NOT replace the caller's signal with an unrelated local signal; combined sources SHALL keep upstream semantics.
6. WHEN the loop boundary cannot stop an underlying provider or external tool immediately THEN cancellation SHALL still complete the operation correctly through commit-eligibility checks; stopping effort SHALL NOT be presented as proof of terminal.

**Classification:** B operation semantics with R cancel-boundary propagation; follows `concurrency-and-cancellation.md` §1-§3 and contract §2.4.

## Requirement 5: Idempotency, Duplicate And Re-Trigger Semantics

**User Story:** As a plugin author, I want repeated sends and deliberate re-sends to be distinguishable, so that auto-continue never double-charges one intent.

### Acceptance Criteria

1. WHEN a caller supplies an idempotency key on request THEN the authority SHALL deduplicate same-owner same-key requests that are still live by returning the existing operation reference, and SHALL NOT merge external identities or share a single underlying execution across different external requests.
2. WHEN a caller re-triggers the same action after a terminal with a new request (with or without the same parameters) THEN the system SHALL create a new operation and SHALL record `parent`/`cause` correlation when the caller or the recovery evidence provides it.
3. WHEN internal retry happens inside the loop or the operation authority THEN it SHALL be an attempt under the same operation/execution identity and SHALL NOT create a new operation or new external request identity.
4. WHEN the caller does not declare idempotency or retry capability THEN the system SHALL default to no automatic retry and SHALL expose the operation's declared retry capability (idempotent? auto-retry? fail-closed?) with the operation metadata.
5. WHEN a duplicate or already-running outcome is returned THEN it SHALL carry enough typed reference to locate the live operation or its activity correlation and SHALL NOT expose private content of another owner.

**Classification:** B facade semantics + R admission dedupe; retry/attempt rules follow `durable-state-and-scope.md` §3-§4 and `identity-and-lifecycle.md` §1.

## Requirement 6: Activity Correlation And Shared Vocabulary

**User Story:** As a plugin author, I want my operation to speak the same activity language as the projection, so that status UIs and automation agree without translation layers.

### Acceptance Criteria

1. WHEN an accepted request maps to an activity THEN the operation SHALL expose its `activityId`/`executionId` correlation once the activity projection evidences it, and SHALL NOT invent an activity identity from event sequences.
2. WHEN the operation status or terminal changes THEN the corresponding activity projection updates SHALL come from the shared projection owner; this feature SHALL NOT maintain a second activity state machine or publish conflicting status vocabulary.
3. WHEN the activity projection is unavailable or degraded THEN the operation SHALL still return its own typed status/terminal and SHALL mark the activity correlation `unknown`/`unavailable` rather than guessing.
4. WHEN a superseded or aborted operation's late result arrives THEN it SHALL be rejected by commit eligibility (owner, generation, operation terminal, resource possession) and kept only as bounded diagnostic/audit material, and SHALL NOT be published as the current operation's result.

**Classification:** B facade correlation over the shared activity projection; stale containment follows `concurrency-and-cancellation.md` §4.

## Requirement 7: Domain Gates Stay Owned By Their Domains

**User Story:** As a plugin author, I want requests to respect route, admission, tool exposure, approval and recovery decisions made by their owning domains, so that the operation cannot bypass policy.

### Acceptance Criteria

1. WHEN a request would trigger a model/tool path governed by route, admission, exposure, approval or security policy THEN the loop boundary SHALL apply those domains' own authorities and SHALL return to the operation a typed `denied`/`rejected` outcome carrying the domain's decision code and bounded reason.
2. WHEN an approval decision is pending THEN the operation SHALL report a waiting/interaction status consistent with the shared activity vocabulary (approval waiting evidence) and SHALL NOT resolve the approval itself or emit its own UI notification.
3. WHEN a failure occurs in an operation THEN recovery policy SHALL be consumed by the owning recovery authority according to its declared automatic consumption contract; this feature SHALL NOT re-evaluate or double-consume recovery decisions and SHALL NOT auto-retry beyond the operation's declared capability.
4. WHEN a request cannot start because an owned domain capability is missing THEN the operation SHALL surface the typed unavailable code of that capability SHALL NOT pretend the gate does not exist.

**Classification:** A/B consumption of delivered domain authorities; no policy logic is duplicated or moved into this feature or its slice.

## Requirement 8: Availability, Capability And Degradation

**User Story:** As a plugin author, I want to know whether request/cancel can actually be served in my installation, so that automation fails loudly instead of silently.

### Acceptance Criteria

1. WHEN a caller queries availability THEN `pluginApi.sessions.request`/`cancel` faces SHALL expose a frozen `{ status: active | degraded | unavailable, reason?: string }` reflecting the operation authority, the loop admission boundary (R slice active and version-matched), and the client transport where applicable, and SHALL never throw.
2. WHEN the agent-loop admission slice is inactive or mismatched THEN the public faces SHALL remain available with typed `unavailable` results for execute admission/cancel and SHALL report `degraded` with the reason, SHALL NOT silently double-run, and SHALL NOT disable the whole main facade or unrelated features.
3. WHEN the facade core is inactive or the capability disabled THEN callers SHALL receive the uniform P1 `PluginApiInactiveError` / P2 `PluginApiFeatureDisabledError` and SHALL NOT observe partial operation state.
4. WHEN headless, web-host and TUI-host contexts serve the same runtime identity THEN each SHALL report the same operation semantics for what it can reach, with per-context degraded/unavailable reporting where sources or the loop slice differ.
5. WHEN capability presence is negotiated THEN `capabilities` SHALL carry the capability without exposing package, row or replacement identities.

**Classification:** Facade self-description; failure taxonomy and availability shape follow contract §6, `capability-strategy.md` §6.2 and `api-idioms.md` §2.

## Requirement 9: Client Half For Interactive UIs

**User Story:** As a Web UI plugin author, I want to request and cancel interactions from the browser with the same typed semantics as the host, so that interactive UIs do not reinvent RPC.

### Acceptance Criteria

1. WHEN a client plugin invokes `ctx.pluginApi.sessions.request`/`cancel` (client face) with valid inputs and an established host connection THEN the client face SHALL forward the request to the host operation authority over the supported client transport and SHALL return the same typed outcome and operation reference semantics as the host face.
2. WHEN the client transport, host connection or operation authority is unavailable (offline, rebind in progress, headless profile without the client channel) THEN the client call SHALL return the typed `unavailable` outcome and SHALL NOT queue the request invisibly or silently drop it.
3. WHEN a client observer or handle belongs to an older connection generation, epoch or rebind THEN its callbacks and disposers SHALL be stale-guarded and SHALL NOT write into the new client face or a new host generation.
4. WHEN host payloads are delivered to the client THEN redaction SHALL be completed host-side before serialization; the client SHALL validate shape only and SHALL NOT receive secret, owner-private or diagnostic material.
5. WHEN no interactive client consumer is present THEN the client face SHALL report its own availability truthfully and SHALL NOT affect the host operation authority.

**Classification:** B client face over the delivered host↔client transport patterns; visibility follows `visibility-and-redaction.md` §4 (client-half audience, host-side redaction, fail-closed).

## Requirement 10: Audit, Owner And Bounded Evidence

**User Story:** As a maintainer, I want every external request/cancel attributable to a real owner with bounded evidence, so that misbehavior is diagnosable without leaking content.

### Acceptance Criteria

1. WHEN an operation is created or a cancel is accepted THEN the authority SHALL record bounded audit material (owner, operation id, session, timestamps, outcome codes, attempt counts, correlation ids) without payload content or secrets.
2. WHEN audit appends fail THEN the operation SHALL retain its declared effect, the audit projection SHALL expose a bounded gap marker, and the system SHALL NOT fabricate a record.
3. WHEN a caller attempts to claim an owner that is not its own THEN the system SHALL derive owner identity from the actual caller context and SHALL NOT accept caller-reported ownership for authority decisions.
4. WHEN a reason string or error detail is exposed THEN it SHALL be bounded, redacted and free of payload content, credentials and owner-private state.

**Classification:** Facade authority foundation; owner derivation follows `composition-and-authority.md` §5 and `durable-state-and-scope.md` §2.

## Requirement 11: Agent-Loop Replacement Slice Contract

**User Story:** As a maintainer, I want the loop-side admission/cancel slice to preserve the official agent-loop contract completely, so that enforcement never breaks the runtime it extends.

### Acceptance Criteria

1. WHEN the slice is added to the agent-loop replacement package THEN it SHALL extend the already-replaced `agent-loop` official row through the existing replacement package and patch mechanism only; it SHALL NOT modify official package files and SHALL NOT add, disable or re-insert rows.
2. WHEN the slice is active THEN the replacement SHALL reproduce every ctx service, event, timing, payload, receiver, error and disposer contract of the replaced official row before adding the admission/cancel boundary; the added boundary SHALL be additive on that full contract.
3. WHEN the slice applies THEN it SHALL verify the official row is disabled, exactly one replacement row is active, runtime and package identities match (`A.B.C` and the locked runtime), the facade's internal operation contract is compatible, and no component-owner conflict exists.
4. WHEN a slice self-check fails THEN it SHALL log bounded diagnostics and stay inert (the official-contract behavior of the replacement remains, the extended admission/cancel boundary is not claimed), and SHALL NOT double-run, kill boot, or partially half-serve the boundary.
5. WHEN the slice emits new attempt/end facts for the operation authority and optional activity evidence THEN those SHALL be registered canonical event vocabulary with a producer authority owned by the slice, with frozen payload shapes and owner-scoped semantics.
6. WHEN the official component later provides an equivalent request-acceptance/cancel seam THEN the slice SHALL have a registered upstream proposal and retirement condition allowing migration back to official binding.
7. WHEN third-party code directly imports the official `@deepseek-ai/dsh-agent-loop` package THEN the slice SHALL NOT claim to intercept or replace that import surface.
8. WHEN the client-half determination is recorded for the slice THEN it SHALL document each of the six capability-strategy §10 questions with evidence and conclude host-only (the replaced official row declares no client manifest and exposes no client namespace/slot/settings/host-client negotiation/browser state/client event).
9. WHEN the slice is inactive or removed THEN the public operation faces SHALL keep honest typed `unavailable` reporting and the official row SHALL remain functional (never an official row disabled without a working official-contract path).

**Classification:** R（扩展既有 replacement owner 包的同组件第二 feature 切片）; all of `capability-strategy.md` R1–R8 that apply to an owner-package extension are satisfied and tested.

## Requirement 12: Verification And Delivery Gates

**User Story:** As a maintainer, I want end-to-end evidence that requests are admitted once, cancelled correctly and never guessed, so that delivery cannot regress the loop.

### Acceptance Criteria

1. WHEN request acceptance is tested THEN evidence SHALL distinguish acceptance, duplicate, already-running, rejected, denied, unavailable, single admission, append provenance, and terminal outcome on real or contract-faithful loop fixtures.
2. WHEN cancellation is tested THEN evidence SHALL distinguish signal propagation, adjudication priority within the commit window, post-terminal stale cancel, child/parent propagation, provider non-stop best effort, and absence of forged terminals.
3. WHEN idempotency/retry is tested THEN evidence SHALL prove same-key dedupe, new-operation on external re-trigger, attempt under one execution, and default no-auto-retry without declared capability.
4. WHEN the slice is tested THEN full and selective installation SHALL cover official-contract parity, version mismatch, boot self-check, owner-conflict, no double-run, removal and official-row restoration, and optional-absence isolation.
5. WHEN the client face is tested THEN offline/unavailable, rebind stale guards, host-side redaction and typed outcome parity SHALL be covered with two synthetic plugins in reverse registration order.
6. WHEN registry and shape checks run THEN every new host/client member and handle member SHALL be registered with one primary idiom, semantic face, effect, composition, scope, authority, availability shape and event catalog entry; surface snapshots SHALL match.
7. WHEN the guarded full test suite, `git diff --check`, registry/surface consistency, official-package zero-modification audit and the required global adversarial review run THEN all SHALL pass before the Stage 4 completion commit.
8. WHEN any required evidence cannot be established THEN the affected operation face SHALL remain typed `unavailable` and the delivery SHALL NOT declare that part complete.

**Classification:** Delivery foundation covering B facade, client face and the R slice.

## M9 Contract Conformance And Deviation Notes

- M9 共同契约 §2 词汇（identity、generation/epoch/cursor/revision/seq、terminal/lifecycle、cancellation/stale、scope/visibility）逐条采纳；operation/execution 统一 `terminal`、retry=attempt、外部重触发=新 operation、AbortSignal≠`aborted` 均按契约成文。
- 契约 §5 动词规则采纳：`request`、`cancel` 保持 operation 动词，不改写为 `register`。
- 偏离记录（契约 §8；含原因与补偿测试）：
  1. **v1 采纳一个 R 切片且其为既有 owner 包的扩展**：Goal/feature-list 的"三至四包协同"经评估收敛为单一组件（`dsh-agent-loop` 既有 owner 包）的边界切片；`dsh-session`/`dsh-llm`/`dsh-tools`/approval 未新增切片（理由见 Design R-Slice Evaluation）。补偿测试：切片激活/未激活两态的官方契约 parity 与 unavailable 报告测试。
  2. **client 半面 v1 交付**：Goal 未强制但 Expected result 隐含 Web 交互 UI；v1 提供 client face（B 传输封装），transport 细节与既有 channels 传输路径对齐（见 Design），若既有通道不足以承载则按 degraded 报告并登记修订。
- 与本线共享词汇/路径有关的其余 M9 决策见 Design 的 Contract Conformance 节。

## Standards Applicability And Alignment

- `docs/standards/capability-strategy.md`: applicable。R slice 为既有 owner 包的扩展（R1–R8 适用条款逐条满足）；不新增包/行；framework 横切语义不进 slice；client-half 判定按 §10 六问并记录证据。
- `docs/standards/api-shape.md`: applicable。operation 面与 durable mutation（appendMessage）边界分明；projection 消费（activity）为只读；无策略注册混入；smell 判据自查通过。
- `docs/standards/api-idioms.md`: applicable。operation 入口动词、handle `{id, ownerId, status(), observe(), dispose()}`、判别式结果 `{ok, code, reason, ...}`、terminal 词汇、availability 形状按 §2-§4；`cancel` 为 signal 型 operation 语义，不伪造终态。
- `docs/standards/public-api-shape.md`: applicable。host/client 同形成员挂 `sessions` 领域；client 根成员按 client 领域树规则登记；不建 alias、不引入 package/row 身份。
- `docs/standards/composition-and-authority.md`: applicable。单一 operation authority；owner 派生不可伪造；跨 owner 冲突与 stale disposer 纪律；所有受支持写路径经同一 authority（authority closure 仅对受支持路径声明）。
- `docs/standards/domain-composition.md`: applicable。`sessions`/`executions`/`llm`/`tools`/approval 领域 gate 各归其主；本 feature 不新增对 appendMessage/loop 的旁路。
- `docs/standards/ordering.md`: applicable。operation/attempt 顺序由 authority 声明；无跨领域排序图；事件监听同 priority 注册顺序不承载业务语义。
- `docs/standards/identity-and-lifecycle.md`: applicable。operationId/executionId facade 生成；attempt 不换 identity；terminal 五值唯一；裁决优先级照抄 §3。
- `docs/standards/durable-state-and-scope.md`: applicable。append 走既有 audited durable mutation；operation 能力声明（幂等/自动 retry/fail-closed）显式；retry 与 execution/attempt 分层遵守 §3-§4。
- `docs/standards/visibility-and-redaction.md`: applicable。request/cancel 负载、reason、审计与 client 半身 payload 逐出口脱敏；client 侧只校验形状不承担脱敏；secret 不出任何出口。
- `docs/standards/concurrency-and-cancellation.md`: applicable。取消=信号、终态=裁决；传播方向、提交资格、stale 结果、disposer 所有权、attempt timeout 与 execution 终态边界逐条声明。
- `docs/standards/versioning-and-protocols.md`: applicable。冻结基线内交付；R 切片所在既有包与主包 `A.B.C` 装配契约不变；新增 wire revision 仅当 client 传输确有真实协议边界时引入。

## 备注（Stage 边界）

本文件只确认 Requirements 方向。Design 将确定：官方 loader owner 证据、R 切片边界与内部契约形状、client 半面传输路径、装配顺序、registry/catalog 拟新增行与失败/guard 策略。Tasks 通过对抗性审查后才进入实现。
