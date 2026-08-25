# Stage 1 - Requirements

## Status

Stage 1 Requirements 已确认；Stage 2 Design 已确认（SPEC2 审查纠偏完成）；Stage 3 对抗性审查通过；Stage 4 交付完成（M6 第三批次）。

## Introduction

`workspace-mutation-transaction` 为第三方插件提供 workspace 变更的统一 transaction、provenance、preview、commit、rollback 与 recover 契约。它把已存在的 file claim、checkpoint、Change Ledger、Git 和 tool/execution 证据组合为可审阅边界，但不声称能够自动回滚未被公开 capability 证明的外部副作用。

本 feature 是 **B 类 host facade / coordination layer**。它依赖已批准的 `recovery-policy`（只消费其决策与 capability 语义）以及本批次先行的 `coordination-lease`（消费其 lease/fencing/CAS 语义）。完整跨 session checkpoint restore 和任意外部系统事务仍是 C 类 upstream boundary。Host 是权威面；client 只消费现有 host projection，不拥有 transaction mutation authority。

## Definitions and Boundaries

- **Transaction**：一个有明确 workspace scope、resource set、intent、owner、generation 与状态的变更边界。
- **Mutation record**：记录 resource、before/after digest、source tool/execution、时间/顺序 provenance 和副作用分类；不以路径本身作为内容 identity。
- **Rollbackable**：由已声明 capability 证明可恢复到指定边界的资源变更；其他变更必须标为 `external` 或 `unknown`。
- **Recovery**：重新读取 transaction 证据并报告可执行/不可执行状态，不等于 facade 自动补偿任意副作用。
- **Host/client boundary**：prepare/record/preview/commit/rollback/recover 均为 host contract；client 不直接改动 workspace 或 transaction ledger。

## Requirements

### WMT-1 Transaction identity and scope

**User Story:** As a plugin maintainer, I want every workspace change to have one bounded transaction identity, so that mutations from one operation are not confused with another.

**Acceptance Criteria:**

1. **WHEN** a caller prepares a transaction **THEN** the facade SHALL require a unique transaction identity, one declared `workspace` scope, a non-empty resource set, an intent, and an owner identity.
2. **WHEN** a transaction references execution, task, session, lease, or checkpoint identities **THEN** the facade SHALL preserve those references as provenance and SHALL not replace them with an event sequence or newly invented execution identity.
3. **WHEN** a caller attempts to combine resources governed by incompatible workspace/profile/session authorities **THEN** the facade SHALL reject the transaction or partition it explicitly before any mutation is published.
4. **WHEN** a transaction identity is reused with a conflicting owner, scope, or intent **THEN** the facade SHALL fail closed and SHALL not merge the records.

**Classification:** B.

### WMT-2 Prepare and capability preconditions

**User Story:** As a plugin maintainer, I want preparation to establish the required ownership and recovery evidence, so that a transaction cannot begin without its declared safeguards.

**Acceptance Criteria:**

1. **WHEN** a caller prepares a transaction **THEN** the facade SHALL acquire or validate the applicable `coordination-lease` handle before accepting a mutation record.
2. **WHEN** a checkpoint or file-claim capability is declared required but unavailable **THEN** preparation SHALL return an explicit unavailable/unsupported result and SHALL not create a transaction that appears commit-ready.
3. **WHEN** preparation succeeds **THEN** the transaction SHALL expose immutable owner, generation, lease/fencing provenance, capability evidence, and an initial state of `prepared`.
4. **WHEN** preparation fails after allocating temporary evidence **THEN** the facade SHALL release only its own temporary resources and SHALL leave no partially active transaction visible.

**Classification:** B; a missing official checkpoint/claim guarantee is C for that capability.

### WMT-3 Mutation recording

**User Story:** As a plugin maintainer, I want each mutation tied to its source and before/after state, so that a reviewer can understand exactly what an execution changed.

**Acceptance Criteria:**

1. **WHEN** a prepared transaction records a mutation **THEN** the facade SHALL require the active transaction identity and fencing evidence and SHALL record resource identity, before digest, after digest or explicit absent state, source tool/execution, and side-effect classification.
2. **WHEN** a mutation is recorded more than once with the same operation identity and equivalent content **THEN** the facade SHALL return an idempotent result without duplicating the ledger entry.
3. **WHEN** a repeated operation identity conflicts with an existing record **THEN** the facade SHALL reject the conflict and SHALL not overwrite the original provenance.
4. **WHEN** a mutation arrives after the transaction is committed, rolled back, failed, or superseded **THEN** the facade SHALL reject it as stale and SHALL preserve the terminal record.
5. **WHEN** a before/after digest cannot be verified **THEN** the facade SHALL mark the evidence unknown/unavailable and SHALL not claim an exact reversible mutation.

**Classification:** B.

### WMT-4 Preview and visibility

**User Story:** As a reviewer, I want to preview a transaction and its side effects before commit, so that I can approve a known change boundary.

**Acceptance Criteria:**

1. **WHEN** a caller previews a prepared or recovering transaction **THEN** the facade SHALL return a frozen projection of resource changes, before/after evidence, source provenance, approval requirements, and current transaction state.
2. **WHEN** a mutation is classified as `external`, `non-rollbackable`, or `unknown` **THEN** the preview SHALL display that limitation explicitly and SHALL not represent it as automatically reversible.
3. **WHEN** current resource state no longer matches the recorded precondition **THEN** the preview SHALL report stale/conflict evidence and SHALL not silently refresh the transaction into a different change.
4. **WHEN** preview redaction or freezing fails **THEN** the facade SHALL fail closed for that projection and SHALL not return a partially protected diff.

**Classification:** B.

### WMT-5 Commit boundary

**User Story:** As a plugin maintainer, I want commit to be explicit and atomic within the supported capability set, so that a transaction is not considered complete merely because one mutation succeeded.

**Acceptance Criteria:**

1. **WHEN** a caller commits a transaction **THEN** the facade SHALL validate active ownership, fencing, required approvals, all declared mutation preconditions, and the capability evidence before publishing `committed`.
2. **WHEN** any required precondition fails **THEN** the facade SHALL leave the transaction non-committed, identify the failed boundary, and SHALL not publish a partial committed state.
3. **WHEN** a transaction contains an explicitly external side effect **THEN** commit SHALL require the declared approval/confirmation and SHALL record that the side effect is not covered by automatic rollback.
4. **WHEN** commit succeeds **THEN** the result SHALL include the final transaction state, bounded mutation summary, provenance references, and the lease/generation used for the commit.
5. **WHEN** commit is retried with the same transaction identity and equivalent terminal evidence **THEN** the facade SHALL return the existing terminal result without duplicating effects.

**Classification:** B for capabilities with an atomic public commit primitive; C for unsupported cross-system atomicity.

### WMT-6 Rollback and recover

**User Story:** As a plugin maintainer, I want rollback and recovery to state exactly what was restored, so that failure handling does not overclaim.

**Acceptance Criteria:**

1. **WHEN** a transaction contains only resources with confirmed rollback capability **THEN** rollback SHALL restore the declared boundary or return a typed failure that identifies the un-restored resource.
2. **WHEN** a transaction contains an external or unknown side effect **THEN** rollback SHALL preserve that classification and SHALL not claim the side effect was undone unless the relevant adapter confirms it.
3. **WHEN** recover is requested after disconnect, process restart, or an interrupted commit **THEN** the facade SHALL reconstruct state only from durable evidence and SHALL return `unavailable`/`unsupported` when the evidence is insufficient.
4. **WHEN** rollback or recovery is applied more than once with equivalent identity **THEN** the facade SHALL be idempotent for already settled resources and SHALL not reverse a newer transaction.
5. **WHEN** a stale owner or fencing token requests rollback/recover **THEN** the facade SHALL reject it or require an explicitly approved recovery takeover; it SHALL not bypass coordination.

**Classification:** B for adapter-confirmed operations; C for complete cross-session/workspace/config/external-side-effect restore.

### WMT-7 State machine and provenance

**User Story:** As a consumer, I want transaction state transitions to be unambiguous, so that a task or execution observer can correlate mutation progress without guessing.

**Acceptance Criteria:**

1. **WHEN** a transaction changes state **THEN** the facade SHALL publish an ordered, immutable projection with transaction identity, previous state, next state, reason, provenance, and observer epoch.
2. **WHEN** a transaction reaches `committed`, `rolled-back`, `failed`, or `superseded` **THEN** the facade SHALL reject later state transitions that would rewrite its terminal outcome, while retaining bounded late-event provenance.
3. **WHEN** a state notification listener throws or returns a rejected thenable **THEN** the facade SHALL contain the listener failure and SHALL keep the transaction service and harness boot alive.
4. **WHEN** a transaction is unavailable after reconnect **THEN** the facade SHALL report `unknown`/`unavailable` rather than infer success from the absence of an error.

**Classification:** B.

### WMT-8 Recovery policy integration

**User Story:** As a recovery-policy consumer, I want mutation evidence to inform a recovery decision without the transaction layer becoming a retry controller, so that policy ownership stays separate.

**Acceptance Criteria:**

1. **WHEN** recovery consumes transaction evidence **THEN** the transaction facade SHALL expose the public state, capability, idempotency, and external-side-effect provenance without invoking retry, fallback, fork, or route selection itself.
2. **WHEN** recovery requests an action outside the transaction's declared capability **THEN** the transaction facade SHALL return an explicit unsupported/C-class result and SHALL not execute the action.
3. **WHEN** an operation is non-idempotent or has an unconfirmed external side effect **THEN** the transaction projection SHALL preserve that evidence for recovery and SHALL not mark it retry-safe.

**Classification:** B boundary; C for missing official recovery proof.

### WMT-9 Security, scope, and redaction

**User Story:** As a plugin maintainer, I want transaction previews and history to be safe to inspect, so that workspace changes do not leak secrets or unrelated resources.

**Acceptance Criteria:**

1. **WHEN** a transaction projection is returned **THEN** the facade SHALL redact credentials, secret values, private content, and unbounded diagnostic detail while preserving bounded change evidence.
2. **WHEN** a caller requests a transaction outside its declared workspace scope **THEN** the facade SHALL deny or return unavailable without revealing private resource existence.
3. **WHEN** redaction, freezing, or bounded serialization fails **THEN** the facade SHALL fail closed for the projection and SHALL not return a partial record.

**Classification:** B.

### WMT-10 Client boundary and integration

**User Story:** As a client plugin maintainer, I want to inspect a host-owned transaction without becoming a second mutation authority, so that UI state cannot race workspace commits.

**Acceptance Criteria:**

1. **WHEN** a client consumes a host-published transaction projection through an existing supported channel **THEN** it SHALL receive read-only, redacted state with explicit availability and transaction generation.
2. **WHEN** a client attempts prepare, record, commit, rollback, or recover through a client surface **THEN** this feature SHALL expose no direct mutation authority and SHALL return explicit unsupported/unavailable behavior.
3. **WHEN** the host projection or channel is unavailable **THEN** the client SHALL degrade locally and SHALL not prevent unrelated client faces from loading.

**Classification:** B boundary; no new client transport is introduced.

## Non-Goals

- A distributed transaction manager for arbitrary external systems.
- Automatic rollback of network, process, publication, or other side effects without adapter proof.
- A replacement for `coordination-lease`, `recovery-policy`, official jobs/workflows, Git, session, checkpoint, approval, or file-claim owners.
- Automatic retry, fallback, route selection, approval bypass, task scheduling, or client-owned mutation.
- Modifying official package files, creating an R replacement, or adding a new client transport protocol.
