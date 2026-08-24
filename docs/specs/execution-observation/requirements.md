# Stage 1 - Requirements

## Status

Stage 1 Requirements 已获用户批准（e8d4e3c）；Stage 2 Design 落地（3278b5c），Stage 3 Tasks 获批（663e7ec）；Stage 4 已交付（b7626af）并合入 M6 Wave C（merge dc1a7cd / 12c6ce0）。

## Introduction

`execution-observation` 为第三方插件提供一个统一、只读的执行生命周期投影。它把现有 agent、tool、LLM、session 等公开 seam 事件关联到独立的 execution identity，使 telemetry、diagnostics、usage 和业务插件可以在并发、取消、重试、重连和迟到事件下使用同一套关联语义。

本需求文档只定义可观察行为和验收边界，不定义实现模块、具体事件转译算法或新的官方事件。主公开面是 `projection`：它可以订阅和查询冻结只读视图，不注册策略，也不写 durable 状态；EO-7 的可见性 policy 面（`visibility.register`）与 projection 是独立 owner，不改变 projection 的只读边界。需求中的 source adapter 是内部 provider enrollment，不构成对第三方开放的 mutation 面。

## Definitions and Classification

- **Execution**：一次由外部触发的逻辑操作。plugin-api 生成 `executionId`；同一次 execution 的内部 retry 只增加 attempt，不改变 `executionId`。
- **Projection**：由已观察到的公开事件和服务状态组合出的只读视图；缺失事件不得被伪装成已发生事实。
- **Attempt**：execution 下的一次 provider/tool/内部操作尝试。外部再次触发相同操作会创建新的 execution。
- **Terminal outcome**：`success`、`error`、`aborted`、`denied`、`superseded` 五者之一；一个 execution 只能提交一次终态。
- **Generation**：owner-specific opaque token，只用于判断旧 projection、回调或重建结果是否仍有提交资格，不跨 owner 比较。
- **主类型**：B 类门面投影，组合现有公开 `agent/*`、`tools/*`、`llm/stream`、`session/*` seam；官方若需提供真正稳定的 execution identity 或最终因果边界，登记为 C 类 upstream proposal。
- **Host / client**：Host 是权威观察与历史查询面；client 只消费 host 提供的快照/通知，不自行产生权威 execution 生命周期。

## Requirements

### EO-1 Execution Identity and Causality

**User Story:** As a telemetry or task plugin author, I want every logical operation to have a stable identity and causal links, so that events from different subsystems can be correlated without treating event sequence numbers as identity.

**Acceptance Criteria:**

- **WHEN** an eligible logical operation is first observed **THEN** the projection SHALL assign a plugin-api-generated `executionId` that is independent of any event sequence number.
- **WHEN** an internal retry starts within an existing execution **THEN** the projection SHALL retain the same `executionId` and SHALL expose a distinct attempt record or attempt number.
- **WHEN** a user, model, or external plugin triggers the same operation again **THEN** the projection SHALL create a new `executionId`, even when the input is identical, and SHALL preserve `parent` or `cause` metadata when it is available.
- **WHERE** the official source does not provide a stable execution identity or causal parent **IF** the adapter cannot prove one **THEN** the projection SHALL mark that field unavailable and SHALL expose the missing capability as an upstream limitation rather than inventing a value from event order.

Classification: B facade projection; the stable official identity gap is C/upstream. Host: required. Client: consumes the resulting identity only.

### EO-2 Lifecycle and Terminal Semantics

**User Story:** As a plugin author, I want a consistent lifecycle and terminal vocabulary, so that I can distinguish active work, a completed operation, and a stale observation.

**Acceptance Criteria:**

- **WHEN** a recognized source reports a start or phase transition **THEN** the projection SHALL expose the execution start time, current phase, source provenance, and the latest valid observation time without changing the execution identity.
- **WHEN** a recognized source reports completion, failure, cancellation, denial, or replacement **THEN** the projection SHALL map it to exactly one of `success`, `error`, `aborted`, `denied`, or `superseded`, with a separate reason/category field where needed.
- **WHEN** a projection is still active or being rebuilt **THEN** it SHALL keep lifecycle metadata such as `settled`, `closed`, or `disposed` separate from the terminal `outcome` field and SHALL not use those lifecycle words as outcomes.
- **GIVEN** an execution has a committed terminal outcome **WHEN** a later source event arrives **THEN** the projection SHALL not rewrite the outcome, phase, or terminal timestamp; it MAY retain the late event only as diagnostic provenance.
- **WHEN** a timeout is observed **THEN** the projection SHALL use outcome `error` with a timeout reason and SHALL not introduce a new `timeout` outcome.

Classification: B facade projection. Host: required. Client: read-only terminal view.

### EO-3 Source Composition and Provenance

**User Story:** As a plugin author, I want one observation surface over the existing public seams, so that each consumer does not maintain a private event state machine.

**Acceptance Criteria:**

- **WHEN** the host receives compatible `agent/*`, `tools/*`, `llm/stream`, or `session/*` observations **THEN** the adapter SHALL associate them with the best available execution projection and SHALL record the contributing source kind.
- **WHERE** a source is missing, disabled, or only partially available **IF** the remaining sources can still form a projection **THEN** the feature SHALL publish a degraded projection with explicit source availability rather than disabling unrelated observations.
- **WHEN** two source observations describe the same execution **THEN** the projection SHALL merge only fields with a valid identity/generation match and SHALL preserve source provenance for each merged fact.
- **WHEN** the projection is composed from official source observations **THEN** the feature SHALL not require importing private variables or modifying files in an official DSH package.

Classification: B facade projection. Host: required. Client: no direct source binding.

### EO-4 History, Reconnect, and Read Isolation

**User Story:** As a diagnostics or UI consumer, I want to recover a session's execution history after reconnect, so that a transient connection loss does not create a second execution or erase a terminal observation.

**Acceptance Criteria:**

- **WHEN** a caller queries execution history for a session **THEN** the host SHALL return a bounded, read-only collection of projections with explicit ordering metadata and SHALL not imply that collection order is identity.
- **WHEN** an observer is mounted or rebuilt after reconnect **THEN** the projection SHALL use a new observer epoch or equivalent generation guard and SHALL reconcile already-known executions without duplicating identities.
- **GIVEN** a projection is returned to a caller **THEN** its nested data SHALL be immutable to the caller, and caller mutation SHALL not alter host state or another observer's view.
- **WHEN** history is unavailable or truncated **THEN** the result SHALL identify the unavailable/truncated portion and SHALL not synthesize missing lifecycle events.

Classification: B facade projection. Host: required. Client: may consume the bounded snapshot.

### EO-5 Concurrency, Cancellation, and Stale Results

**User Story:** As a plugin author, I want late asynchronous callbacks to be harmless, so that cancelled or superseded work cannot corrupt the current execution projection.

**Acceptance Criteria:**

- **WHEN** an observed parent execution is cancelled **THEN** the projection SHALL mark the applicable execution or child operation as `aborted` only after the owner commits that outcome, and SHALL not treat an AbortSignal alone as proof of terminal state.
- **WHEN** a child operation fails or is cancelled **THEN** the projection SHALL end the child by default and SHALL affect the parent only when the source explicitly identifies the child as required for the parent.
- **GIVEN** an asynchronous source result arrives after its owner, observer epoch, generation, or execution is no longer current **THEN** the adapter SHALL reject it as stale for state publication and SHALL not start a retry or invoke a new owner's disposer.
- **WHEN** an execution is terminal or superseded **THEN** the projection SHALL not create a new attempt from a late callback.

Classification: B facade projection. Host: required. Client: receives only committed state.

### EO-6 Client Consumption Boundary

**User Story:** As a browser or TUI consumer, I want to display the same execution identity and outcome as the host, so that client telemetry and diagnostics do not invent a second lifecycle.

**Acceptance Criteria:**

- **WHEN** a supported client publication path is available **THEN** the client SHALL consume a versioned, read-only, redacted execution snapshot and SHALL receive lifecycle notifications using the host's identity and outcome vocabulary.
- **WHEN** the client publication path is unavailable, stale, or incompatible **THEN** the host observation feature SHALL remain usable and the client surface SHALL report an explicit unavailable/degraded state without claiming authoritative local execution state.
- Client code SHALL not create, settle, retry, or mutate a host execution through this feature's projection surface.

Classification: B facade projection with a bounded client consumer. Host: authoritative. Client: optional consumer; no client-owned lifecycle.

### EO-7 Visibility and Redaction

**User Story:** As an operator, I want execution context to be useful without leaking prompt or secret data, so that diagnostics can be shared safely across model, UI, log, and debug audiences.

**Acceptance Criteria:**

- **WHERE** no visibility policy is registered **THEN** model/tool output SHALL omit internal execution diagnostics, UI output SHALL omit secret fields, and logs SHALL contain only bounded summaries rather than full prompt, tool arguments, or provider credentials.
- **WHEN** a plugin registers a visibility policy for non-secret execution metadata **THEN** the projection SHALL expose the approved fields with source, timestamp, and uncertainty metadata, and SHALL preserve the default denial for fields outside that policy.
- **WHEN** a caller requests secret or credential-bearing fields **THEN** the feature SHALL deny the request unless an explicit secret policy is present, and the denial SHALL not reveal the secret value.

Classification: B facade projection. Host and client: both, with audience-specific redaction.

### EO-8 Fail-Safe and Scope Boundary

**User Story:** As a host operator, I want observation failure to be isolated, so that a missing source or malformed event cannot prevent harness boot or alter execution behavior.

**Acceptance Criteria:**

- **WHEN** an adapter, observer, or projection reducer throws or rejects **THEN** the feature SHALL contain the failure, report the affected source/projection as degraded or unavailable, and SHALL not throw through plugin apply or stop unrelated event dispatch.
- **WHEN** a projection consumer requests retry, route change, checkpoint restore, or task mutation **THEN** the observation surface SHALL reject that operation as outside its contract and SHALL not perform the side effect.
- **GIVEN** a durable history record is written **THEN** it SHALL belong only to the `session` scope and SHALL not simultaneously claim `session`, `workspace`, and `profile` ownership.

Classification: B facade projection; any official execution-identity guarantee not reachable through public seams remains C/upstream. Host: required. Client: inert on failure.

## Non-Goals

- Automatic retry, fallback, routing policy, checkpoint restore, task/workflow management, or durable mutation policy.
- A new official execution event taxonomy that duplicates existing agent, tool, LLM, or session dispatch.
- Treating event sequence numbers, timestamps, or UI row identifiers as execution identity.
- A new R replacement bundle.

## Requirements Coverage Summary

| Area | Covered by | Host | Client | Classification |
|---|---|---:|---:|---|
| Identity, parent/cause, attempt | EO-1 | Yes | Read-only | B; identity gap C |
| Lifecycle and terminal outcome | EO-2 | Yes | Read-only | B |
| Existing source composition | EO-3 | Yes | No direct binding | B |
| History and reconnect | EO-4 | Yes | Consumer | B |
| Cancellation and stale guard | EO-5 | Yes | Committed state only | B |
| Client boundary | EO-6 | Authoritative | Optional | B |
| Visibility and redaction | EO-7 | Yes | Yes | B |
| Fail-safe and scope | EO-8 | Yes | Inert on failure | B/C |
