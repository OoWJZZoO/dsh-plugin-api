# Stage 1 - Requirements

## Status

Stage 1 Requirements 已获用户批准（e8d4e3c）；Stage 2 Design 落地（3278b5c），Stage 3 Tasks 获批（d24f7f8）；Stage 4 已交付（1c9d23d）并合入 M6 Wave C（merge 8ff0b67 / 12c6ce0）。2026-08-26 复审登记：**待弃用**（pending deprecation，功能组件非门面；弃用动工另行指示，弃用前 API 保持不变）。2026-08-26 已按用户 ANY 指示执行移除（commit `856746f`）：`pluginApi.usage` 整面删除并登记 removed，本 spec 目录保留作历史存档。

## Introduction

`usage-budget-telemetry` 为插件提供统一的 usage sample、execution settle、成本查询和预算阈值通知。它消费 `execution-observation` 的 execution/attempt correlation，但不重新定义 execution 生命周期，也不把本地估算冒充 provider 账单事实。

本 feature 明确分离三类 owner：usage ledger 的 `durable mutation` 负责幂等写入和结算；查询 `projection` 与阈值通知 `projection` 均只读；任何 deny、route、retry 或自动降级动作都不属于本需求的 policy registry。为遵守 `docs/standards/durable-state-and-scope.md`，一条 durable record 只能属于一个 scope；跨 scope 查询通过投影组合，不把 session、workspace、profile 混在同一条记录中。

主公开面是 usage ledger 的受约束写入/查询组合，但 mutation、projection、通知各自拥有独立状态和 disposer。首版为 B 类 host-first facade；client 只消费经过 redaction 的快照和通知。

## Definitions and Classification

- **Usage sample**：来自 provider、model adapter 或本地计量器的一次输入/输出/cache/reasoning 等计量样本，带来源和确定性等级。
- **Provider-confirmed**：provider 或官方 adapter 明确确认的 usage；**estimated**：本地根据内容/流量推导的估算；二者不得静默合并为同一事实。
- **Execution settle**：一个 execution 的最终 usage/cost 结算提交；同一 execution 只允许一个逻辑终态，但可以包含多个 attempt 样本。
- **Ledger record**：带 owner identity、generation、commitState 和明确 scope 的 durable 记录。
- **Budget scope**：一次只属于 `session`、`workspace` 或 `profile` 中的一档；日期、provider、model 是该 scope 内的索引维度，不是额外 scope。
- **Threshold**：预算使用量跨过声明阈值时生成的只读通知；本需求不把阈值转为执行决策。
- **主类型**：B 类门面转译/投影。与现有 `tokenMeter` 的边界是：本 feature 负责统一 ledger、settle、来源和查询；既有 tokenMeter 可作为 estimated source，但不被复制为第二个 ledger owner。

## Requirements

### UB-1 Usage Sample Capture and Provenance

**User Story:** As a cost or telemetry plugin author, I want normalized usage samples, so that different providers and stream shapes can be compared without losing whether a value is confirmed or estimated.

**Acceptance Criteria:**

- **WHEN** a supported provider/model adapter emits usage **THEN** the host SHALL normalize available input, output, cache, reasoning, total, provider, model, timestamp, executionId, attempt, and source fields into a sample without changing the provider's raw value semantics.
- **WHEN** a local meter supplies a value without provider confirmation **THEN** the sample SHALL be marked `estimated` with estimator provenance and SHALL not be reported as provider-confirmed.
- **WHEN** provider-confirmed and estimated values coexist for the same execution/attempt **THEN** the ledger SHALL retain their provenance and SHALL apply an explicit precedence or aggregation rule; it SHALL not silently double-count them.
- **WHEN** a provider or model identity is missing **THEN** the sample SHALL remain queryable with an explicit unknown identity and SHALL not be assigned a guessed provider/model.

Classification: B facade projection into the ledger. Host: required. Client: read-only consumption.

### UB-2 Execution Correlation and Attempt Semantics

**User Story:** As a telemetry consumer, I want usage tied to the same execution identity used by lifecycle observation, so that retries and late chunks cannot create phantom executions.

**Acceptance Criteria:**

- **WHEN** a sample is associated with an observed execution **THEN** it SHALL reference the existing `executionId` and its attempt, and SHALL not create a second execution for an internal retry.
- **WHEN** an external caller starts the same operation again **THEN** its samples SHALL use the new execution identity even if provider, model, and input are identical.
- **GIVEN** a sample has no trustworthy execution correlation **WHEN** it is recorded **THEN** the ledger SHALL mark the correlation unknown and SHALL not infer identity from event sequence, timestamp, or array position.
- **WHEN** a sample arrives after an execution is terminal **THEN** the owner SHALL accept it only under the declared late-sample rule and SHALL expose it as late/provisional; it SHALL not rewrite the execution outcome or start a new attempt.

Classification: B facade projection/mutation boundary; depends on execution-observation. Host: required. Client: no correlation authority.

### UB-3 Idempotent Ledger Mutation and Settle

**User Story:** As a cost meter, I want duplicate chunks and repeated settle calls to be harmless, so that reconnects and provider retries do not inflate usage.

**Acceptance Criteria:**

- **WHEN** a usage sample is committed **THEN** the mutation SHALL require an owner identity, owner-specific generation, operation identity, and explicit `session`, `workspace`, or `profile` scope.
- **WHEN** a ledger mutation completes **THEN** it SHALL expose a separate `commitState` using the standard terminal vocabulary (`success`, `error`, `aborted`, `denied`, or `superseded`), while `settledAt` remains lifecycle metadata and is not treated as an outcome.
- **WHEN** the same sample identity is submitted again with equivalent content **THEN** the ledger SHALL treat it as an idempotent replay and SHALL not add a second charge.
- **WHEN** the same sample identity is submitted with conflicting content **THEN** the ledger SHALL reject the conflict or record a fail-closed conflict diagnostic and SHALL not choose one value silently.
- **WHEN** an execution settle is committed **THEN** the ledger SHALL atomically mark the settle state and totals for that execution/attempt set; a later settle SHALL be a no-op or explicit conflict, never a second charge.
- **WHEN** a multi-step ledger update cannot commit completely **THEN** no partially committed total SHALL be visible as a successful settle, and the mutation SHALL expose a rollback/failed commit state.
- **WHEN** an operation is unknown or its idempotency/commit capability is not declared **THEN** the ledger SHALL reject it by default and SHALL not automatically retry it.

Classification: B facade with a durable mutation face. Host: required. Client: never writes the ledger.

### UB-4 Scope-Safe Storage and Queries

**User Story:** As an operator, I want to query usage by execution, session, workspace, profile, date, provider, and model, so that I can build reports without violating durable scope ownership.

**Acceptance Criteria:**

- **WHEN** a session-scoped sample or settle is stored **THEN** its durable record SHALL belong only to `session` scope; workspace and profile aggregates SHALL be separate records with their own identities and commit states.
- **WHEN** a caller queries by execution, session, workspace, profile, date, provider, or model **THEN** the projection SHALL return only records authorized for the requested scope and SHALL identify which scope each result belongs to.
- **WHEN** a cross-scope report is requested **THEN** the projection MAY combine separately owned records, but no single record or mutation SHALL claim simultaneous ownership of multiple scopes.
- **WHEN** records are missing, truncated, or still provisional **THEN** the query SHALL identify that limitation and SHALL not present an incomplete total as final.

Classification: B durable mutation plus projection. Host: required. Client: read-only query consumer.

### UB-5 Pricing and Cost Determination

**User Story:** As a budget consumer, I want cost derived from an explicit pricing revision, so that historical reports remain explainable when prices change.

**Acceptance Criteria:**

- **WHEN** a sample is converted to cost **THEN** the ledger SHALL record the pricing identity/revision, currency/unit, calculation basis, and whether the result is confirmed or estimated.
- **WHEN** no matching price exists **THEN** the ledger SHALL retain usage while marking cost unavailable/unknown and SHALL not invent a zero or current-price value.
- **WHEN** a pricing revision changes **THEN** existing settled records SHALL remain tied to their original revision; a revaluation, if supported later, SHALL be an explicit new operation and not an in-place rewrite.
- **THEN** pricing registration SHALL not mutate execution routing, provider selection, or approval decisions.

Classification: B facade projection/mutation support. Host: required. Client: displays bounded cost metadata only.

### UB-6 Budget Threshold Projection

**User Story:** As an operator, I want budget threshold notifications, so that I can react before a scope exceeds its declared budget.

**Acceptance Criteria:**

- **WHEN** a committed usage projection crosses a declared threshold for a single budget scope **THEN** the feature SHALL emit a deterministic notification containing scope, threshold identity, observed total, currency/unit, source certainty, and generation.
- **WHEN** the same threshold remains crossed across duplicate samples or repeated queries **THEN** the feature SHALL not emit an unbounded duplicate notification; a new generation or explicitly reset budget MAY emit a new crossing.
- **WHEN** a total is provisional because samples are estimated, late, or incomplete **THEN** the notification SHALL state that uncertainty and SHALL not claim a provider-confirmed bill.
- **THEN** threshold notifications SHALL be observational only; they SHALL not deny, reroute, retry, or automatically degrade an execution under this feature.

Classification: B projection. Host: required. Client: optional consumer.

### UB-7 Partial Streams, Abort, Reconnect, and Stale Results

**User Story:** As a cost meter maintainer, I want incomplete and late streams handled explicitly, so that cancellation and reconnect do not turn partial data into a false final bill.

**Acceptance Criteria:**

- **WHEN** a stream ends by user cancellation **THEN** the feature SHALL preserve the samples observed so far, mark the execution/settle provenance as aborted or partial as applicable, and SHALL not synthesize missing provider usage.
- **WHEN** a deadline expires **THEN** the feature SHALL classify the operation as error with a timeout reason and SHALL not add a new timeout outcome.
- **WHEN** a reconnect replays a chunk or settle signal **THEN** idempotency keys SHALL prevent double counting and the result SHALL retain replay provenance.
- **GIVEN** an asynchronous sample or pricing result arrives after its owner, generation, execution, or ledger commit is no longer current **THEN** the mutation SHALL reject it as stale and SHALL not update current totals or invoke a newer owner's disposer.
- **WHEN** an execution has committed `aborted`, `denied`, or `superseded` **THEN** the ledger SHALL not start a new retry attempt from a late usage callback.

Classification: B durable mutation/projection. Host: required. Client: committed state only.

### UB-8 Visibility and Redaction

**User Story:** As an operator, I want usage reports that are useful but do not leak prompts or credentials, so that cost data can be surfaced to multiple audiences safely.

**Acceptance Criteria:**

- **WHERE** no visibility policy exists **THEN** model/tool output SHALL omit internal usage diagnostics, UI output SHALL omit secrets, and logs SHALL contain bounded usage/cost summaries rather than raw prompts, tool arguments, or credentials.
- **WHEN** a non-secret usage field is exposed to a permitted audience **THEN** it SHALL retain source, timestamp, certainty, pricing revision, and scope metadata.
- **WHEN** a sample contains secret-bearing provider metadata or raw content **THEN** the host SHALL redact it before ledger projection, notification, log, or client publication; redaction failure SHALL fail closed.

Classification: B projection. Host and client: both, audience-specific.

### UB-9 Fail-Safe, Retry Declaration, and Boundary

**User Story:** As a host operator, I want telemetry failure isolated from execution, so that a broken meter never changes the operation being measured.

**Acceptance Criteria:**

- **WHEN** sample normalization, pricing, ledger mutation, or query projection throws or rejects **THEN** the feature SHALL contain the failure, expose a diagnostic, and SHALL not throw through plugin apply or interrupt the provider/tool execution solely because telemetry failed.
- **WHEN** a ledger operation is not explicitly declared idempotent/retryable **THEN** the feature SHALL not automatically retry it.
- **WHEN** a consumer requests deny, route, approval, automatic retry, or degradation through the usage surface **THEN** the feature SHALL reject the request as outside this feature's contract.
- **THEN** the existing `tokenMeter` may supply an estimated sample, but the feature SHALL not create a second hidden token ledger or claim that tokenMeter output is provider-confirmed.

Classification: B facade; policy actions are out of scope. Host: required. Client: inert/degraded on failure.

## Non-Goals

- Enforcing budgets by denial, routing, approval, retry, or automatic degradation.
- Payment, invoicing, provider billing reconciliation, or guaranteed production accounting.
- Reimplementing execution lifecycle or replacing `tokenMeter` as an internal estimator.
- Client cost UI components or profile mutation workflows.

## Requirements Coverage Summary

| Area | Covered by | Host | Client | Classification |
|---|---|---:|---:|---|
| Sample and provenance | UB-1 | Yes | Consumer | B |
| Execution/attempt correlation | UB-2 | Yes | No authority | B |
| Idempotent settle/ledger | UB-3 | Yes | No writes | B |
| Scope-safe storage/query | UB-4 | Yes | Read-only | B |
| Pricing | UB-5 | Yes | Metadata | B |
| Threshold notifications | UB-6 | Yes | Optional | B |
| Partial/abort/reconnect/stale | UB-7 | Yes | Committed state | B |
| Visibility | UB-8 | Yes | Yes | B |
| Fail-safe and policy boundary | UB-9 | Yes | Inert on failure | B |
