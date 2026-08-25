# Stage 1 - Requirements

## Status

Stage 1 Requirements 草案，待用户确认。

## Introduction

`task-execution-observation` 为第三方插件提供业务 task 与运行时资源之间的统一 identity lineage。它关联 durable task、workflow run、agent execution、session transcript 和 job projection，使 task board、TUI、agent teams 与后台任务消费者能够在断线后重建 task 状态，而不重复实现一套执行引擎。

本 feature 是 **B 类 host aggregation facade**。它依赖已交付的 `execution-observation`、`plugin-diagnostics`、`recovery-policy` 和本批次的 `coordination-lease`；可消费 `workspace-mutation-transaction` 的 provenance。它不走 R replacement，因为 task 语义跨 jobs、workflows、subagents、session 和 execution 多个 owner。Host 拥有 task mutation authority；client 只消费现有 host projection，不新增 task-specific transport。

## Definitions and Boundaries

- **Task**：由用户或业务拥有的 durable work item，不等同于一次 execution 或一个 job。
- **Run**：task 与 workflow/agent execution/session/job 的一次关联实例。
- **Attempt**：task 的一次受 coordination fencing 约束的执行尝试；attempt 可以变化，task identity 不因 retry 改变。
- **Terminal outcome**：复用 execution/recovery 的公开终态语义；task 还可带业务状态和 settlement provenance，但不得发明冲突的 execution outcome 词汇。
- **Host/client boundary**：host 提供 register/start/claim/reassign/settle/observe/attach；client 仅消费冻结、脱敏的 task projection。

## Requirements

### TEO-1 Task identity and registration

**User Story:** As a task consumer, I want a stable durable task identity, so that a business work item survives attempts, reconnects, and changes of execution.

**Acceptance Criteria:**

1. **WHEN** a caller registers a task **THEN** the facade SHALL require a stable task identity, owner/scope, intent or description, and a creation provenance.
2. **WHEN** a task starts a new attempt or run **THEN** the facade SHALL preserve the task identity and create a distinct attempt/run identity linked to its parent task.
3. **WHEN** a caller registers an existing task identity with equivalent immutable metadata **THEN** the facade SHALL return the existing task without duplicating it.
4. **WHEN** a caller registers an existing task identity with conflicting owner, scope, or immutable metadata **THEN** the facade SHALL reject the conflict and SHALL not merge records.

**Classification:** B.

### TEO-2 Run and resource lineage

**User Story:** As a task board maintainer, I want a task linked to its actual run resources, so that a task card can show what execution and session produced the outcome.

**Acceptance Criteria:**

1. **WHEN** a task run is created or attached **THEN** the facade SHALL preserve links to workflow, agent, execution, session, and job identities only when the corresponding public source confirms them.
2. **WHEN** a source identity is unavailable or uncertain **THEN** the task projection SHALL mark the link unavailable/unknown and SHALL not synthesize an identity from an event sequence.
3. **WHEN** a run consumes a workspace transaction **THEN** the facade SHALL retain the transaction identity and bounded mutation summary as provenance without owning workspace mutation state.
4. **WHEN** a run is reattached after reconnect **THEN** the facade SHALL reconcile by stable identity and generation, not by array position or latest arrival time alone.

**Classification:** B aggregation over public projections; C for any lineage requiring a private official seam.

### TEO-3 Start, claim, and fencing

**User Story:** As a task coordinator, I want claims to be fenced, so that a reassigned or stale attempt cannot settle a newer owner’s task.

**Acceptance Criteria:**

1. **WHEN** a task is started or claimed **THEN** the facade SHALL obtain or validate a `coordination-lease` owner/generation/fencing context before publishing the active attempt.
2. **WHEN** a task has an active attempt owned by another valid generation **THEN** a competing claim SHALL return a deterministic conflict and SHALL not silently replace the active attempt.
3. **WHEN** a claim is explicitly reassigned after the prior attempt is released, expired, or approved for takeover **THEN** the facade SHALL create a new attempt/generation and preserve the reassign reason.
4. **WHEN** a stale attempt submits progress, mutation, or settlement **THEN** the facade SHALL reject it or record it only as bounded late provenance and SHALL not change the current task state.

**Classification:** B over `coordination-lease`; C if required fencing is not publicly available.

### TEO-4 Settlement and terminal semantics

**User Story:** As a task consumer, I want one authoritative settlement, so that retries and late events do not produce contradictory task outcomes.

**Acceptance Criteria:**

1. **WHEN** an active attempt settles **THEN** the facade SHALL publish exactly one task/run settlement for that attempt with outcome, reason, source, and bounded provenance.
2. **WHEN** an attempt is retried **THEN** the task SHALL retain its identity, the retry SHALL receive a new attempt identity, and the prior attempt SHALL become superseded/settled according to its confirmed outcome.
3. **WHEN** an old attempt or duplicate callback settles after a terminal task state **THEN** the facade SHALL preserve the existing terminal state and SHALL record late/stale provenance without rewriting it.
4. **WHEN** an execution source reports `success`, `error`, `aborted`, `denied`, or `superseded` **THEN** the task projection SHALL preserve that source outcome and SHALL not reinterpret `aborted` or `denied` as retryable success.
5. **WHEN** settlement evidence is incomplete or contradictory **THEN** the facade SHALL return an explicit `unknown`/`unavailable` task state rather than infer success.

**Classification:** B over `execution-observation` and `recovery-policy`; C for private official settlement boundaries.

### TEO-5 Observe and reconnect reconstruction

**User Story:** As a task board or TUI maintainer, I want to rebuild task state after reconnect, so that the UI does not lose durable work or display stale ownership.

**Acceptance Criteria:**

1. **WHEN** a consumer calls `observe(taskId)` **THEN** the facade SHALL return a frozen task projection containing task state, active/latest attempt, run links, owner/generation, terminal outcome if any, and provenance availability.
2. **WHEN** durable task evidence is available after disconnect or process restart **THEN** the facade SHALL reconstruct the projection from that evidence and SHALL identify the observation epoch/generation used.
3. **WHEN** evidence is truncated, unavailable, stale, or requires resync **THEN** the projection SHALL state that condition explicitly and SHALL not claim a complete history.
4. **WHEN** multiple observers subscribe to one task **THEN** equivalent state windows SHALL be deduplicated per observer epoch, and one observer's failure SHALL not stop the others.
5. **WHEN** an observer is disposed or replaced **THEN** stale callbacks SHALL not mutate or publish into the newer observer generation.

**Classification:** B; a durable source missing the required reconstruction seam is C for that portion.

### TEO-6 Workflow, job, and session attachment

**User Story:** As a task consumer, I want to open the real transcript and job context, so that task status is grounded in the underlying DSH run.

**Acceptance Criteria:**

1. **WHEN** a caller attaches a session, workflow, or job **THEN** the facade SHALL validate the public identity and preserve the source owner and generation.
2. **WHEN** a task requests transcript or session observation **THEN** the facade SHALL delegate to the existing public session/execution observation surface and SHALL not copy or rewrite the official transcript as a second durable store.
3. **WHEN** the referenced session, workflow, or job is missing or disposed **THEN** the task projection SHALL report unavailable/ disposed provenance and SHALL keep the task record intact.
4. **WHEN** an attachment is replaced by a newer generation **THEN** stale attachment callbacks SHALL be ignored and the newer identity SHALL remain authoritative.

**Classification:** B aggregation; C for missing official public attachment/read seams.

### TEO-7 Recovery and workspace integration

**User Story:** As a task coordinator, I want task recovery decisions to use the same evidence as execution and workspace layers, so that task state does not invent its own retry rules.

**Acceptance Criteria:**

1. **WHEN** task recovery is evaluated **THEN** the facade SHALL consume `recovery-policy` decisions, execution outcome, coordination state, and workspace transaction evidence through their public projections.
2. **WHEN** recovery recommends retry, fallback, fork, abort, or stop **THEN** the task facade SHALL preserve the recommendation and provenance but SHALL not execute the action, choose a route, bypass approval, or replay a tool.
3. **WHEN** a task operation is non-idempotent, denied, aborted, superseded, or has an unconfirmed external side effect **THEN** the task projection SHALL retain that safety evidence and SHALL not mark the operation retry-safe.
4. **WHEN** a required source projection is unavailable **THEN** the task facade SHALL fail closed for the affected action/status and SHALL leave the last confirmed task state unchanged.

**Classification:** B integration boundary; C for actions requiring private official retry/scheduler seams.

### TEO-8 Business state and scheduler boundary

**User Story:** As a plugin maintainer, I want task state without a competing execution engine, so that task APIs remain composable with official jobs and workflows.

**Acceptance Criteria:**

1. **WHEN** a task consumer registers or observes a task **THEN** the facade SHALL provide business task identity and state without creating a worker scheduler, provider executor, or hidden polling loop that owns execution.
2. **WHEN** an official jobs/workflows service exposes an execution handle **THEN** the facade SHALL retain that handle as a source link and SHALL not duplicate its scheduling or cancellation contract.
3. **WHEN** a caller requests route choice, provider health mutation, billing, approval bypass, or automatic execution from the task facade **THEN** the facade SHALL reject it as outside the task boundary.

**Classification:** B boundary.

### TEO-9 Visibility, redaction, and immutable projections

**User Story:** As a task board maintainer, I want task projections safe for UI and logs, so that task observations do not leak private prompts, credentials, or tool output.

**Acceptance Criteria:**

1. **WHEN** a task, run, or transcript projection is returned **THEN** the facade SHALL redact secrets, private content, internal diagnostics, and unbounded evidence according to the consumer audience.
2. **WHEN** a projection is exposed to a consumer **THEN** it SHALL be deeply immutable and SHALL distinguish observed, served, unavailable, stale, and inferred-free provenance states.
3. **WHEN** redaction, freezing, or bounded serialization fails **THEN** the facade SHALL fail closed for that projection and SHALL preserve the underlying task state.

**Classification:** B.

### TEO-10 Client boundary and integration

**User Story:** As a client plugin maintainer, I want to render task status without becoming a task authority, so that UI reconnects cannot race host state.

**Acceptance Criteria:**

1. **WHEN** a client consumes a host task projection through an existing supported channel **THEN** it SHALL receive read-only, redacted state with task/run generation and explicit availability.
2. **WHEN** client code attempts register, claim, reassign, settle, or task recovery through a client surface **THEN** this feature SHALL expose no direct mutation authority and SHALL return explicit unsupported/unavailable behavior.
3. **WHEN** the host projection or channel is unavailable **THEN** the client SHALL degrade locally, identify the unavailable surface, and SHALL not prevent unrelated client faces from loading.

**Classification:** B boundary; no new client transport is introduced.

## Non-Goals

- A worker scheduler, workflow engine, provider executor, or replacement for official jobs/workflows.
- A second execution identity system independent from `execution-observation`.
- Automatic retry, route selection, approval bypass, billing, tool replay, or arbitrary side-effect compensation.
- Ownership of workspace transactions, checkpoint storage, lease/CAS implementation, session transcript persistence, or client transport.
- An R replacement, modification of official package files, or a new task-specific remote protocol.
