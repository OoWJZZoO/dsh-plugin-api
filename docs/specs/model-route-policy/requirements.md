# Stage 1 - Requirements

## Status

Stage 1 Requirements: approved / completed（已由用户确认）；基于该批准的 Design 已进入并完成 Stage 2。

## Introduction

`model-route-policy` 为一次明确的 agent request attempt 提供有序、可解释的模型 route 决策。用户已明确批准本 feature 按 **R 类 replacement** 推进；唯一官方组件 owner 是 `@deepseek-ai/dsh-agent-loop`，当前目标 row 是 `agent-loop`。replacement 必须先完整复刻该 row 在锁定 runtime 中的服务、factory/driver、配置、settings、system-prompt variables、agent 生命周期、事件和失败时序，再增加 route policy capability slice。

当前安装基线是 `@deepseek-ai/dsh-agent-loop@0.1.0-rc.6`。官方 loop 已在 `agent/request` 决策点组合 provider/model request config，并在 `agent/request-error` 决策点处理失败动作；本 feature 不把这些既有行为误写成全新能力，也不把 retry ownership 从 `recovery-policy` 或官方 loop 偷移到 route registry。它解决的是多个 route 插件竞争 listener 顺序、缺少稳定 decision identity、健康/circuit/probe 语义不统一，以及 fallback lineage 不可审计的问题。

R replacement 只替换官方 row 的插件行为与 `ctx` 服务/事件面，不替换 package import 面；第三方直接 import `@deepseek-ai/dsh-agent-loop` 仍解析官方包。具体 replacement package/row 名、完整源码组件划分和 patch 装配留到获批 Requirements 后的 Design。

## Definitions, Evidence, and Classification

- **Route candidate**：一次决策中可被选择的 provider/model 及官方 request config 候选；不得包含凭据值。
- **Route decision**：在一个明确 request attempt 的 route decision point 收敛得到的唯一、不可变结果，包含 owner-local decision identity、execution/attempt correlation、候选 identity、reason、source 和时间。
- **Attempt stability**：同一 request attempt 一旦提交 route decision，后续 policy、health update 或 late callback 不得改写该 decision；新的 retry attempt 可以请求新的 decision。
- **Health observation**：带来源、时间和置信边界的 provider/model 可用性证据，不等同于 provider authoritative billing、用户准入或 retry 决定。
- **Circuit state**：route owner 对一个明确 provider/model scope 的 `closed`、`open` 或 `half-open` 状态；未知状态不得被伪装为 healthy。
- **Probe**：受限、可识别、不得冒充用户 request 的健康探测 operation。
- **主类型**：R 类 replacement；唯一官方组件 owner 为 `@deepseek-ai/dsh-agent-loop`。有序 route policy 是该 replacement 提供的 capability slice；priority、deepFreeze 与 fault containment 仍复用主 facade 的横切语义，不由 replacement 重新定义。
- **公开面边界**：route policy registry 是主公开面；health/circuit/probe evidence 由独立的 component-local evidence owner 管理并作为显式输入进入 policy，policy 不直接写 health/circuit 状态，projection 不注册 policy。
- **当前 client 证据**：官方 package 没有 `dsh.client` manifest、package-owned browser bundle、remote namespace 或 slot；但 host row 通过通用 settings 基础设施注册 `agent-loop` settings，因此 replacement 不是“完全无 client-visible 能力”，必须保留该 settings 能力。

### Current Official Row Contract Baseline

The replacement requirements SHALL preserve, at minimum, the following observed contract before adding route policy:

| Official behavior | Current evidence |
|---|---|
| `ctx.agentLoop` service and `AgentFactory` behavior | `@deepseek-ai/dsh-agent-loop` `AgentLoop` service |
| create/resume, setup/publication, ownership and reverse-order teardown | `AgentLoop.createAgent` / `resume` lifecycle |
| configured agent identity, restore-or-create and startup failure reporting | row config plus `configuredAgentIdentities` |
| `maxParallelToolCalls` config and `agent-loop` settings namespace | package config and `installSettingsSection` |
| provider/model/cwd system-prompt variables | `AgentLoop` constructor registrations |
| agent inbox, turn, step, tool, request and error event timing | `ReactLoopAgent` driver |
| `agent/request` route proposal and `agent/request-error` failure action | official waterfall decision points |
| cancellation, maintenance, wakeup and disposal semantics | driver phase/AbortController ownership |

## Requirements

### MR-1 Complete Official Contract Replication

**User Story:** As a runtime or plugin maintainer, I want the replacement to preserve the complete official agent-loop contract, so that route policy does not break agent creation, execution or teardown.

**Acceptance Criteria:**

- **WHEN** the replacement row loads for a supported runtime **THEN** it SHALL preserve the official row's accepted configuration shape, defaults, validation, injected services, `ctx.agentLoop` service members, agent factory contract, configured-agent startup behavior, settings registration, system-prompt variables, event timing, cancellation and disposal behavior before publishing the route policy slice.
- **WHEN** the official row creates or resumes an agent **THEN** the replacement SHALL preserve caller ownership, exact session identity, setup ordering, publication, returned agent/handle identity, failure identity and reverse teardown semantics.
- **WHEN** the official loop dispatches any existing `agent/*` or `agent-loop/*` event **THEN** the replacement SHALL preserve its mode, payload shape, ordering, return semantics and failure behavior unless an approved route requirement explicitly adds an orthogonal field or event.
- **WHEN** any required official behavior is absent, malformed or not provable for the locked runtime/package identity **THEN** the replacement SHALL fail its boot self-check and SHALL not silently approximate a partial agent loop.

Classification: R, covering R2. Host: authoritative. Client: preserve generic settings visibility.

### MR-2 Route Decision Identity and Attempt Stability

**User Story:** As a route-aware plugin author, I want one immutable decision per request attempt, so that usage, diagnostics and fallback history refer to the same route.

**Acceptance Criteria:**

- **GIVEN** an execution and request attempt reach the route decision point **WHEN** route selection begins **THEN** the system SHALL create or accept one owner-local decision identity and SHALL correlate it with the supplied execution and attempt identities without minting a new execution.
- **WHEN** a route decision is committed **THEN** the system SHALL expose a frozen snapshot containing at least provider/model identity, relevant non-secret request configuration, decision reason/source, fallback parent if present, and observation time.
- **GIVEN** a route decision is committed for an attempt **WHEN** a policy, health event, circuit transition or late callback arrives **THEN** the system SHALL retain the committed route and SHALL not change model/provider within that attempt.
- **WHEN** the official loop starts a new turn or an explicitly new attempt **THEN** the system MAY evaluate a new route decision and SHALL link it to the prior decision when the new attempt is a fallback.

Classification: R capability slice. Host: authoritative. Client: read-only visibility only if separately exposed by policy.

### MR-3 Ordered Route Policy Registration and Convergence

**User Story:** As a routing plugin author, I want policies to compose at one decision point, so that listener prepend order no longer determines the winner accidentally.

**Acceptance Criteria:**

- **WHEN** a plugin registers a route policy **THEN** it SHALL provide a stable policy id, owner identity, owner-specific generation, explicit scope/match conditions and a pure decision function, and registration SHALL return an idempotent owner-scoped disposer.
- **WHEN** multiple policies match one decision **THEN** the registry SHALL evaluate them in one documented deterministic order and SHALL converge to one allow/select/reject/no-op result without invoking the same policy more than once for that decision.
- **WHEN** a policy runs **THEN** all health, budget, admission, execution and candidate evidence it may use SHALL be passed explicitly in the decision input; the policy SHALL not mutate shared state or privately create a retry, probe or attachment projection.
- **WHEN** a policy throws, returns a rejected thenable, returns an invalid candidate or attempts an out-of-scope mutation **THEN** the system SHALL contain that policy failure, record a bounded diagnostic and continue with the documented safe default or remaining valid policy result.
- **WHEN** a policy disposer from an old owner generation runs **THEN** it SHALL remove only that generation's registration and SHALL not remove a newer policy with the same public id.

Classification: R capability slice using the main facade's policy semantics. Host: required. Client: none.

### MR-4 Health, Circuit and Probe Semantics

**User Story:** As a provider health plugin author, I want shared health and circuit vocabulary, so that route selection can distinguish evidence from guesswork.

**Acceptance Criteria:**

- **WHEN** health evidence is recorded **THEN** it SHALL identify provider/model scope, source, observed time, bounded reason and freshness; unknown or stale evidence SHALL not be represented as healthy.
- **WHEN** repeated qualifying failures satisfy a registered circuit policy **THEN** the circuit owner SHALL transition the affected scope from `closed` to `open` with an explicit reason and expiry/re-evaluation boundary; unrelated provider/model scopes SHALL remain unaffected.
- **WHEN** an open circuit becomes eligible for a probe **THEN** at most the configured bounded probe work SHALL enter `half-open`; ordinary user traffic SHALL not be relabeled as a probe and concurrent probes SHALL not bypass the bound.
- **WHEN** a probe succeeds, fails, is aborted or is superseded **THEN** the circuit state SHALL transition according to the declared policy, preserve the probe's separate operation identity and SHALL not rewrite a committed user route decision.
- **WHEN** no reliable health evidence exists **THEN** route policy SHALL use an explicit unknown-state rule rather than silently excluding or preferring the candidate.

Classification: R capability slice. Host: authoritative. Client: projection only if separately approved.

### MR-5 Fallback Lineage and Recovery Boundary

**User Story:** As a recovery or diagnostics plugin author, I want route fallback lineage without route policy owning retry, so that failure and recovery responsibilities remain separable.

**Acceptance Criteria:**

- **GIVEN** an attempt fails on a committed route **WHEN** the official loop or `recovery-policy` authorizes a new fallback attempt **THEN** the route system SHALL evaluate the new attempt independently and SHALL link its decision to the failed decision and classified cause.
- **WHEN** route selection returns no eligible candidate **THEN** the route system SHALL return an explicit no-route/denied decision with bounded reasons and SHALL not create an attempt, call the provider or choose an undeclared emergency route.
- **WHEN** a retry, abort, fork or stop decision is required **THEN** route policy SHALL defer that action to the official loop or `recovery-policy`; it may supply route evidence but SHALL not own retry count, backoff, checkpoint or execution terminal outcome.
- **WHEN** a budget policy or modality admission rejects a candidate **THEN** route policy SHALL preserve that reason and SHALL not bypass the rejection by selecting an equivalent route outside the supplied candidate/admission set.

Classification: R route slice interoperating with B/C recovery and admission features. Host: required. Client: none.

### MR-6 Cancellation, Stale Results and Disposer Ownership

**User Story:** As an operator, I want late route work to lose commit eligibility, so that cancelled or superseded attempts cannot contaminate current routing state.

**Acceptance Criteria:**

- **WHEN** a caller AbortSignal, agent disposal or attempt cancellation occurs **THEN** the replacement SHALL propagate cancellation to current route-policy work where supported while still guarding every later callback by owner, generation, execution and attempt identity.
- **GIVEN** policy, health or probe work completes after its owner generation or attempt is no longer current **WHEN** the late result attempts to commit or publish **THEN** it SHALL not commit a route, change current circuit state without a valid circuit operation, publish current success or invoke a newer disposer.
- **WHEN** an attempt has settled as `aborted` or `superseded` **THEN** the route system SHALL not start a new probe or fallback attempt on its behalf.
- **WHEN** route resources are disposed **THEN** cleanup SHALL be idempotent, identity-scoped and SHALL not remove policy/health state owned by a newer generation.

Classification: R lifecycle requirement. Host: required. Client: no package-owned state.

### MR-7 Official Patch Assembly and Boot Self-Check

**User Story:** As a profile maintainer, I want replacement activation to be reversible and auditable, so that official and replacement loops never run silently together.

**Acceptance Criteria:**

- **WHEN** the replacement is installed **THEN** assembly SHALL use only the official patch mechanism to disable row `agent-loop` and insert exactly one replacement row; it SHALL not modify any official package file.
- **WHEN** the replacement applies **THEN** its boot self-check SHALL verify that the official row is disabled, the replacement row is active, the complete official contract is available, required dependencies are the locked identities, and no competing `@deepseek-ai/dsh-agent-loop` replacement owner or duplicate insertion exists.
- **WHEN** any activation or contract check fails **THEN** the replacement SHALL emit a structured fail-safe diagnostic, return normally from apply and SHALL not publish a partial `agentLoop` service or route policy slice.
- **WHEN** the replacement is active **THEN** it SHALL not replace launcher, `dsh-app-boot`, Cordis dispatch, `dsh-agent`, `dsh-llm`, settings infrastructure or any other official component.

Classification: R, covering R1, R4, R6 and R9. Host: required. Client: generic client graph remains official.

### MR-8 Runtime Identity, Import Boundary and Version Isolation

**User Story:** As a runtime maintainer, I want incompatible agent-loop replacements to fail closed, so that route semantics are never guessed across upgrades.

**Acceptance Criteria:**

- **WHEN** the replacement is evaluated **THEN** it SHALL compare the runtime full identity, `@deepseek-ai/dsh-agent-loop` package identity/version, main facade version and replacement version against an exact supported matrix including prerelease components.
- **WHEN** any required identity or version mismatches **THEN** only this replacement and its route capability SHALL be unavailable; the main facade and unrelated replacement features SHALL remain active.
- **WHEN** a consumer imports `@deepseek-ai/dsh-agent-loop` or another official package **THEN** module resolution SHALL continue to return the official package; the replacement SHALL cover only the loader row's plugin behavior and `ctx` contract.
- **WHEN** another package claims the same official component owner **THEN** both replacements SHALL not run together and the new replacement SHALL fail safe with an owner-conflict diagnostic.

Classification: R, covering R3, R5 and R6. Host: required. Client: version evidence visible only through bounded diagnostics.

### MR-9 Client-Surface Determination and Preservation

**User Story:** As a client maintainer, I want the replacement to preserve the real settings-facing behavior without copying unrelated browser runtime code.

**Acceptance Criteria:**

- **WHEN** the locked official identity is audited **THEN** the evidence SHALL record: no `dsh.client` manifest, no package-owned browser bundle, no remote namespace, no slot, no component-specific host/client negotiation and no component-owned reconnect state; it SHALL also record the positive generic settings capability created by `installSettingsSection` for namespace `agent-loop`.
- **WHEN** the replacement is active **THEN** the `agent-loop` settings schema, validation, current values, update behavior and generic Web settings visibility SHALL remain equivalent to the official row.
- **WHEN** preserving that settings capability requires only the official host settings bridge **THEN** the replacement SHALL reuse that bridge and SHALL not create an unrelated browser bundle; **IF** Design evidence shows a package-owned client artifact is required **THEN** the replacement SHALL self-build it and verify `window.__DSH_BOOT__`, HMR and full client behavior under R8.
- **WHEN** a future supported official identity adds any package-owned client capability **THEN** Requirements/Design SHALL re-run all six client checks before enabling that identity.

Classification: R with a client-visible settings capability; not classified as fully host-only. Host: authoritative settings owner. Client: official generic settings consumer.

### MR-10 Upstream Retirement, Visibility and Scope Boundary

**User Story:** As a runtime maintainer, I want route decisions to be diagnosable and the replacement to have an exit path, so that it does not become an unbounded private agent-loop fork.

**Acceptance Criteria:**

- **WHEN** the replacement enters Design/Tasks registration **THEN** the governance registry SHALL add a U-series proposal for an official ordered route-policy/health/fallback seam at the agent-loop decision boundary and SHALL link an explicit retirement condition.
- **WHEN** official `dsh-agent-loop` provides an equivalent public contract covering deterministic policy composition, immutable per-attempt decision identity, health/circuit/probe evidence and fallback lineage **THEN** the replacement SHALL enter deprecation/retirement instead of maintaining duplicate semantics indefinitely.
- **WHERE** no visibility policy exists **THEN** model output SHALL not expose internal circuit diagnostics or credentials, UI/debug views SHALL omit secrets, and logs SHALL contain bounded route identities/reasons without API keys or full request payloads.
- **WHEN** a visibility policy explicitly elevates non-secret route evidence **THEN** the projection SHALL retain source, observation time and uncertainty so the model or UI cannot mistake stale evidence for current fact.
- **WHEN** a consumer requests attachment mutation, provider billing, retry execution, approval bypass, boot mutation or cross-component service replacement through this feature **THEN** the system SHALL reject it as outside the route component boundary.

Classification: R/upstream governance plus shared visibility rules. Host: authoritative. Client: optional redacted projection only.

## R1-R9 Compliance Matrix

| `docs/standards/capability-strategy.md` rule | Requirement |
|---|---|
| R1 official patch only | MR-7 |
| R2 complete official row contract before extension | MR-1 |
| R3 import face remains official | Introduction, MR-8 |
| R4 boot self-check and fail-safe | MR-7 |
| R5 runtime/package identity lock | MR-8 |
| R6 component-level unique owner | MR-7, MR-8 |
| R7 upstream proposal and retirement | MR-10 |
| R8 preserve or self-build client capability | MR-9 |
| R9 no boot/framework replacement | MR-7 |

## Non-Goals

- Modifying official package files or replacing official package import surfaces.
- A replacement spanning `dsh-agent-loop`, `dsh-agent`, `dsh-llm`, settings, boot or Cordis components.
- Owning retry attempts, backoff, checkpoint, execution identity generation or terminal outcome.
- Changing provider/model after a request attempt has committed its route.
- Treating health probes as user requests or bypassing admission, approval, budget or credential policy.
- Reimplementing priority, deepFreeze or fault containment inside the replacement.

## Requirements Coverage Summary

| Area | Covered by | Host | Client | Classification |
|---|---|---:|---:|---|
| Official agent-loop contract | MR-1 | Yes | Generic settings | R |
| Decision identity/stability | MR-2 | Yes | Optional projection | R |
| Ordered route policy | MR-3 | Yes | No | R |
| Health/circuit/probe | MR-4 | Yes | Optional projection | R |
| Fallback/recovery boundary | MR-5 | Yes | No | R/B |
| Cancellation/stale cleanup | MR-6 | Yes | No | R |
| Patch/self-check/version | MR-7, MR-8 | Yes | No | R |
| Client settings preservation | MR-9 | Yes | Generic official client | R |
| Upstream/visibility/scope | MR-10 | Yes | Redacted projection | R/C |
