# Stage 1 - Requirements

## Status

Stage 1 Requirements 已由用户确认；按用户要求暂停，不进入 Design。

## Introduction

`recovery-policy` 为第三方插件提供 policy-first 的失败分类与恢复决策契约。它统一 transient、permanent、aborted、denied、superseded 词汇，要求 operation 声明幂等性、retryability 和副作用边界，并在明确决策点收敛 retry、abort、fallback、fork 或 stop 的建议。

本 feature 是 **B 类门面策略层，并包含 C 类 upstream proposal 边界**，不是 R replacement。恢复策略横跨 execution、agent loop、route、session、checkpoint、workspace 和 budget 多个 owner；没有单一官方组件能够在不跨组件 fork 的前提下完整承载它。首版不承诺自动恢复底层状态，也不伪造官方 agent-loop 内部 retry、完整请求边界、durable checkpoint backend、workspace transaction 或 lease/CAS。

## Definitions, Evidence, and Classification

- **Operation capability**：一个 operation 对幂等性、可重试性、可中止性、可 fork 性、外部副作用和 budget 的显式声明。
- **Failure classification**：`transient`、`permanent`、`aborted`、`denied`、`superseded`；timeout 作为 `error` 的 reason，不新增终态词汇。
- **Recovery decision**：针对一个 execution/attempt 的不可变建议，动作只能是 `retry`、`abort`、`fallback`、`fork` 或 `stop`，并包含 reason、bounds、source 和 capability evidence。
- **Execution/attempt**：execution identity 在内部 retry 中保持不变；每个 retry/fallback attempt 获得新的 attempt identity。外部重新触发创建新的 execution。
- **Safe default**：无 capability、分类不确定、策略失败或决策上下文不完整时的 fail-closed `stop` 或 `abort`。
- **主类型**：B 类 facade policy registry。完整请求边界、官方 agent-loop 内部 retry 选择和跨 session checkpoint restore 标为 C 类 upstream proposal。
- **Host/client surface**：host 提供分类、注册和决策权威面；当前不声明 package-owned client bundle、remote、slot 或 settings 面。client 只能消费经显式批准的 redacted recovery projection。

## Requirements

### RP-1 Failure Classification and Terminal Vocabulary

**User Story:** As a recovery policy author, I want one typed failure vocabulary, so that plugins do not guess whether an operation can be retried.

**Acceptance Criteria:**

- **WHEN** an operation failure reaches a supported recovery decision point **THEN** the classifier SHALL return exactly one primary class from `transient`, `permanent`, `aborted`, `denied` or `superseded`, plus bounded reason and source evidence.
- **WHEN** a deadline expires **THEN** the classifier SHALL return an `error` outcome with a `timeout` reason rather than inventing a new terminal class.
- **WHEN** a caller, owner or generation has already cancelled or replaced the operation **THEN** the classifier SHALL prefer `aborted` or `superseded` over a late provider error according to the shared concurrency priority.
- **WHEN** classification is missing, contradictory or throws **THEN** the recovery layer SHALL use the safe default and SHALL retain a bounded diagnostic without changing the original operation outcome.

Classification: B. Host: authoritative. Client: redacted projection only.

### RP-2 Operation Capability Declaration

**User Story:** As an operation owner, I want to declare retry safety, so that non-idempotent side effects are not replayed by guesswork.

**Acceptance Criteria:**

- **WHEN** an owner registers an operation capability **THEN** it SHALL declare operation identity/scope, idempotency, allowed actions, side-effect class, deadline, retry budget and whether fork or manual approval is required.
- **WHEN** an operation has no declaration or declares an unsupported capability **THEN** the recovery layer SHALL treat it as non-retryable and SHALL not automatically replay, fork or compensate it.
- **WHEN** an operation capability is disposed or replaced by a newer owner generation **THEN** its old registration SHALL lose decision eligibility and SHALL not remove a newer registration with the same public id.

Classification: B policy registry. Host: required. Client: none.

### RP-3 Ordered Policy Registration and Pure Decision Input

**User Story:** As a plugin author, I want multiple recovery policies to compose deterministically, so that listener order does not decide recovery accidentally.

**Acceptance Criteria:**

- **WHEN** a plugin registers a recovery policy **THEN** registration SHALL require a stable id, owner identity, owner-local generation, explicit match scope and a disposer that is idempotent and identity-scoped.
- **WHEN** multiple policies match one decision point **THEN** the registry SHALL evaluate them in one documented deterministic order and SHALL converge to one bounded decision without invoking a policy more than once for that decision.
- **WHEN** a policy runs **THEN** all error classification, operation capability, attempt, budget, route and checkpoint evidence it may use SHALL be supplied explicitly in the input; the policy SHALL not privately read mutable state, start retry, mutate a checkpoint or call a provider.
- **WHEN** a policy throws, returns an invalid decision or returns a rejected thenable **THEN** the recovery layer SHALL contain that failure, record a bounded diagnostic and continue with the remaining valid policies or safe default.

Classification: B. Host: required. Client: none.

### RP-4 Explicit Recovery Decision Actions

**User Story:** As an execution owner, I want recovery decisions to name the permitted action, so that the caller remains responsible for actually changing execution state.

**Acceptance Criteria:**

- **WHEN** a supported decision point receives a classified failure and capability evidence **THEN** the system SHALL return one immutable action from `retry`, `abort`, `fallback`, `fork` or `stop`, with reason, source, execution/attempt correlation and applicable bounds.
- **WHEN** the decision is `retry` **THEN** it SHALL identify the same execution and a proposed new attempt boundary, and SHALL not mint a new execution identity.
- **WHEN** the decision is `fallback` **THEN** it SHALL reference the failed attempt and defer candidate selection to `model-route-policy` or the official loop; recovery SHALL not choose a provider/model itself.
- **WHEN** the decision is `fork` **THEN** it SHALL require an explicitly declared fork capability and SHALL identify the parent/cause; it SHALL not claim that a session/workspace/checkpoint was copied unless an official public service confirms that fact.
- **WHEN** the decision is `abort` **THEN** it SHALL require an active cancellable operation and SHALL not classify the cancellation request itself as a completed `aborted` outcome before the execution owner settles it.
- **WHEN** the decision is `stop` **THEN** it SHALL prohibit further automatic attempts for that decision window and SHALL not rewrite the failure outcome that triggered the decision.

Classification: B; fallback route selection interoperates with `model-route-policy`. Host: authoritative. Client: optional redacted decision.

### RP-5 Retry Bounds, Backoff, and Budget

**User Story:** As an operator, I want retries bounded, so that a transient failure cannot become an unbounded loop or budget leak.

**Acceptance Criteria:**

- **WHEN** a policy proposes `retry` **THEN** the decision SHALL include a finite attempt count/remaining budget, deadline boundary, and bounded backoff/jitter description or an explicit `immediate` reason.
- **WHEN** the retry budget, deadline, approval or usage budget is exhausted **THEN** the recovery layer SHALL return `stop` or `abort` and SHALL preserve the exhaustion reason.
- **WHEN** a failure is `aborted`, `denied` or `superseded`, or the operation is non-idempotent without an explicit override **THEN** the recovery layer SHALL not return an automatic `retry`.
- **WHEN** a retry decision is consumed **THEN** the caller SHALL create a new attempt only once and SHALL not re-enter the same policy decision as a second attempt for the same identity.

Classification: B. Host: required. Client: none.

### RP-6 Execution, Attempt, and Terminal Outcome Integrity

**User Story:** As a telemetry or audit consumer, I want recovery decisions correlated with lifecycle identities, so that retry history remains explainable.

**Acceptance Criteria:**

- **WHEN** an internal retry or fallback attempt is authorized **THEN** the decision SHALL retain the parent execution identity, allocate/accept a distinct attempt identity and link the cause to the prior attempt.
- **WHEN** an external caller starts the same logical operation again **THEN** the system SHALL treat it as a new execution even when the input is byte-for-byte identical.
- **WHEN** an execution reaches `success`, `error`, `aborted`, `denied` or `superseded` **THEN** later recovery callbacks SHALL not change that terminal outcome or start another attempt.
- **WHEN** execution/attempt evidence is unavailable **THEN** the policy layer SHALL return a safe default rather than minting an identity from event sequence, object identity or a private retry counter alone.

Classification: B, consuming `execution-observation`. Host: authoritative. Client: projection only.

### RP-7 Cancellation, Stale Results, and Disposer Ownership

**User Story:** As an execution owner, I want cancelled recovery work to lose commit eligibility, so that late policy results cannot revive an operation.

**Acceptance Criteria:**

- **WHEN** the caller AbortSignal, parent execution, current attempt or policy owner generation is cancelled **THEN** the recovery layer SHALL propagate cancellation where supported and SHALL guard every later callback by owner, generation, execution and attempt identity.
- **GIVEN** a policy result arrives after its decision window, generation or execution is no longer current **WHEN** the late result attempts to publish or trigger work **THEN** the result SHALL be classified as stale and SHALL not publish a current decision, invoke a newer disposer or start retry/fallback/fork work.
- **WHEN** a recovery registry or policy disposer runs more than once **THEN** cleanup SHALL be idempotent and SHALL remove only resources owned by that registration generation.

Classification: B lifecycle requirement. Host: required. Client: none.

### RP-8 Integration Boundaries and Public Failure Semantics

**User Story:** As a plugin maintainer, I want recovery to consume other capabilities without owning them, so that one policy layer does not become a cross-domain state manager.

**Acceptance Criteria:**

- **WHEN** recovery consumes budget, route, diagnostics, session branch or checkpoint evidence **THEN** it SHALL use the documented public projection/service and SHALL preserve each source's provenance and uncertainty.
- **WHEN** recovery needs a durable checkpoint backend, workspace transaction, lease/CAS, automatic profile repair or non-idempotent compensation **THEN** the feature SHALL return an explicit unsupported/C-class result and SHALL not emulate that capability in memory as if it were durable.
- **WHEN** a recovery policy fails or is unavailable **THEN** the original operation SHALL retain its existing outcome, the system SHALL select the safe default, and harness boot SHALL continue without the policy.
- **WHEN** a caller requests automatic route selection, provider billing, approval bypass or boot mutation through recovery **THEN** the request SHALL be rejected as outside the recovery boundary.

Classification: B/C boundary. Host: authoritative. Client: no mutation face.

### RP-9 Upstream Proposals and Retirement Conditions

**User Story:** As a runtime maintainer, I want missing official seams recorded, so that the facade does not claim unsupported internal behavior.

**Acceptance Criteria:**

- **WHEN** Design/Tasks registration begins **THEN** governance SHALL register C-class upstream proposals for any missing complete request boundary, official agent-loop retry seam and cross-session checkpoint restore contract.
- **WHEN** an official component later provides an equivalent public recovery seam **THEN** the corresponding facade capability SHALL prefer that seam and SHALL enter deprecation/retirement rather than retaining duplicate policy semantics.
- **WHEN** an upstream proposal is not implementable through a public seam **THEN** the requirements SHALL retain it as proposal-only and SHALL not create a hidden replacement or mutate official package files.

Classification: C governance plus B facade. Host: governance/diagnostic. Client: none.

### RP-10 Visibility and Client Surface

**User Story:** As an operator, I want recovery explanations without secret leakage, so that diagnostics are useful and safe across host and client surfaces.

**Acceptance Criteria:**

- **WHERE** no visibility policy exists **THEN** model-visible recovery data SHALL be absent by default, UI/debug projections SHALL expose only bounded non-secret action/reason/source fields, and logs SHALL omit prompts, credentials, request bodies and private error causes.
- **WHEN** a policy explicitly elevates non-secret recovery evidence **THEN** the projection SHALL retain source, observation time and uncertainty and SHALL not present a proposed action as a completed execution outcome.
- **WHEN** the current official client graph is audited **THEN** the feature SHALL record no package-owned client manifest, remote, slot, settings or reconnect state; any client consumer SHALL be a separate redacted projection and SHALL not become a second recovery owner.

Classification: B shared visibility rule. Host: authoritative. Client: projection only.

## Classification and Coverage Summary

| Area | Covered by | Host | Client | Classification |
|---|---|---:|---:|---|
| Failure vocabulary | RP-1 | Yes | Redacted | B |
| Operation capability | RP-2 | Yes | No | B |
| Policy registry | RP-3 | Yes | No | B |
| Action decision | RP-4 | Yes | Optional projection | B |
| Retry bounds/budget | RP-5 | Yes | No | B |
| Execution/attempt integrity | RP-6 | Yes | Projection | B |
| Cancellation/stale/disposer | RP-7 | Yes | No | B |
| Cross-feature boundary | RP-8 | Yes | No | B/C |
| Upstream seam/retirement | RP-9 | Governance | No | C |
| Visibility/client surface | RP-10 | Yes | Redacted only | B |

## C-Class Upstream Boundary

The following remain proposal-only until an official public seam is available:

1. Complete request-boundary interception that can reproduce official agent-loop retry timing and caller provenance.
2. An official agent-loop retry/fallback decision hook with full internal lifecycle and failure semantics.
3. Cross-session checkpoint restore that proves session, workspace, configuration and external-side-effect recovery as one public contract.

## Non-Goals

- Durable checkpoint backend, workspace mutation transaction, lease/CAS or scheduler ownership.
- Automatic route choice, provider/model health state, billing, approval bypass or profile repair.
- Replaying non-idempotent tools, compensating arbitrary external side effects or treating `aborted`, `denied` or `superseded` as transient.
- Modifying official package files, replacing an official component row or claiming private official loop timing.
- A client-owned retry controller or a new transport/reconnect protocol.
