# Stage 1 - Requirements

## Status

Stage 1 Requirements 已由用户确认；按用户要求暂停，不进入 Design。

## Introduction

`client-generation-rebind` 为第三方 client 插件提供 host/client contract generation 与 rebind 生命周期。它解决 remote、slot、settings contribution 在晚绑定、重连、HMR、版本变化或宿主部分不可用时的旧状态写回、重复 mount 和资源泄漏问题。

本 feature 首版保持 **B 类 client lifecycle facade**。当前 `0.1.0-rc.6` 能力由多个官方组件共同拥有：`dsh-client-runtime` 管理 slot/session/workspace 生命周期，`dsh-client-connection` 管理连接 generation 和 readiness，`dsh-api-remotes` 管理 remote contribution mount，`dsh-client-modules` 管理 browser module arrival/HMR，`dsh-client-ui-slots` 管理 declaration epoch 与 slot registration，`dsh-client-ui-settings` 管理 settings scope bind/reload。没有单一官方 loader 能在不跨组件 replacement 的情况下完整拥有“face availability + generation + contribution binding + stale cleanup”全生命周期，因此本 feature 不预设 R replacement，也不复制官方 browser bundle。

Host 是 availability 与 capability metadata 的权威来源；client 负责绑定和投影。generation 是 owner-local opaque token，不把浏览器刷新、transport reconnect、remote schema revision、slot declaration epoch 和 settings namespace revision 合并成一个全局计数器。

## Definitions, Evidence, and Classification

- **Face**：一个可绑定的 remote namespace、slot declaration、settings scope 或其他已声明 client capability。
- **Owner**：拥有该 face 注册和资源的插件/组件 identity；generation 只能在同一 owner 内判定新旧。
- **Contract generation**：owner 对 host/client capability contract 的一次生命周期版本；它不等同于 transport generation 或 schema revision。
- **Contribution epoch**：某个具体 remote/slot/settings contribution 的绑定代次；同一 generation 可以包含多个独立 contribution epoch。
- **Availability**：`available`、`pending`、`unavailable`、`degraded`、`disposed` 等 face 状态；不得与 execution outcome 混用。
- **Rebind**：在旧 contribution 失去提交资格后，根据当前 capability/connection/slot/settings 状态建立新绑定的过程。
- **当前分类**：B 类；host/client facade 组合公开官方服务，不替换单一官方 row。C 类 proposal 是未来由官方 client lifecycle owner 提供统一 rebind seam。
- **Evidence**：`dsh-client-runtime` 有 `ctx.slots`/session runtime；`dsh-client-connection` 有 connection readiness generation；`dsh-api-remotes` 通过 `ctx.remote.$mount()` 管理固定 build-time contributions；`dsh-client-modules` 管理 `window.__DSH_BOOT__` module graph 与 HMR invalidate；`dsh-client-ui-slots` 有 declaration epoch；`dsh-client-ui-settings` 有 settings scope bind/reload。上述能力分散而非同一 owner。
- **公开面边界**：registration/bind lifecycle 是主公开面；availability 是只读 projection。projection 不注册 contribution、不触发 rebind、不修改 host capability，bind callback 也不得私下改写 availability authority。

## Requirements

### CG-1 Owner-Local Generation Semantics

**User Story:** As a client plugin author, I want generation tokens with explicit ownership, so that stale state can be rejected without inventing a global clock.

**Acceptance Criteria:**

- **WHEN** an owner registers or rebinds a face **THEN** the lifecycle facade SHALL associate the face with an owner identity, an owner-local opaque generation token and a contribution identity.
- **WHEN** two owners expose generations **THEN** the facade SHALL not compare their tokens as ordered values or infer that one owner supersedes another owner.
- **WHEN** an owner requires ordering within its own lifecycle **THEN** it SHALL expose an owner-local revision separately from the opaque generation and SHALL not use transport generation or settings schema revision as a substitute.

Classification: B. Host: supplies capability identity/metadata. Client: owns binding lifecycle.

### CG-2 Face Registration and Availability Projection

**User Story:** As a client plugin author, I want to know whether a face can be bound, so that one missing remote or slot does not disable unrelated contributions.

**Acceptance Criteria:**

- **WHEN** a plugin registers a remote, slot or settings face **THEN** registration SHALL require a stable face id, owner identity, required contract version/capabilities, bind callback, disposer and explicit scope.
- **WHEN** host connection readiness, remote mount availability, slot declaration or settings transport changes **THEN** the facade SHALL publish the affected face's availability with bounded reason/provenance and SHALL leave unrelated faces unchanged.
- **WHEN** a face is absent, incompatible or temporarily unavailable **THEN** the facade SHALL return `unavailable` or `degraded` for that face and SHALL not fabricate a host service or silently bind against a different namespace.
- **WHEN** a caller queries face availability **THEN** the facade SHALL return a read-only current snapshot containing face id, owner, generation, capability/version evidence, lifecycle state, reason and observation time.
- **WHEN** an availability listener throws or rejects **THEN** the facade SHALL contain that listener failure and SHALL preserve the face state and client boot.

Classification: B policy/projection facade. Host: authoritative capability source. Client: required consumer.

### CG-3 Independent Epochs for Connection, Remote, Slot, and Settings

**User Story:** As a client maintainer, I want lifecycle epochs to retain their domain meaning, so that reconnect does not incorrectly invalidate a stable slot or schema revision.

**Acceptance Criteria:**

- **WHEN** the transport connection is replaced **THEN** the facade SHALL advance or replace only the connection generation and SHALL re-evaluate dependent contributions.
- **WHEN** a remote namespace is mounted/unmounted, a slot declaration collapses/redeclares, or a settings scope revision changes **THEN** the facade SHALL update only that face's contribution epoch and SHALL preserve the independent identities of other domains.
- **WHEN** a browser refresh, HMR invalidation, transport reconnect and Typert schema revision occur in the same interval **THEN** the facade SHALL retain separate causes and epochs rather than collapsing them into one numeric generation.

Classification: B. Host: connection/capability source. Client: epoch composition and binding.

### CG-4 Bind and Rebind Lifecycle

**User Story:** As a client plugin author, I want a single bind/rebind contract, so that a contribution can recover after a late host or face becomes available.

**Acceptance Criteria:**

- **WHEN** all required face capabilities are available **THEN** the facade SHALL invoke the contribution's bind callback once for the current generation/epoch and SHALL record the returned disposer as owned by that contribution.
- **WHEN** a required face becomes unavailable or a newer generation supersedes the current one **THEN** the facade SHALL invalidate the old contribution, invoke its disposer at most once, and SHALL make a later bind eligible only for the current capability set.
- **WHEN** a face becomes available again **THEN** the facade SHALL permit a new bind with the new generation/epoch and SHALL preserve the reason for the prior degraded/unavailable state.
- **WHEN** bind setup partially succeeds and then fails **THEN** the facade SHALL clean up only resources created by that contribution and SHALL mark that contribution degraded without shutting down the client facade.
- **WHEN** a contribution is invalidated, disposed or successfully rebound **THEN** the facade SHALL publish one owner-scoped lifecycle notification containing the affected face, old/new generation or epoch where applicable, and bounded reason.
- **WHEN** the facade binds through official connection, remote, slot or settings services **THEN** it SHALL preserve their public member names, RPC payloads, event ordering, cancellation, return values, errors and disposer ownership without redefining those official contracts.

Classification: B client lifecycle. Host: availability authority. Client: bind/rebind owner.

### CG-5 Stale Async Result Guard

**User Story:** As a client plugin author, I want late remote calls and callbacks discarded, so that old generations cannot write into current UI or settings state.

**Acceptance Criteria:**

- **WHEN** a contribution starts an asynchronous call **THEN** the facade SHALL associate the operation with owner, generation, face, contribution epoch and caller AbortSignal where provided.
- **GIVEN** a call, promise rejection, event callback or HMR completion arrives after owner disposal, generation replacement, face unavailability or contribution disposal **WHEN** the late result attempts to publish or mutate lifecycle state **THEN** the result SHALL fail its stale guard and SHALL not publish current state, invoke a newer disposer, register a duplicate contribution or start a new bind.
- **WHEN** cancellation cannot stop an underlying network or Promise operation **THEN** identity/epoch guards SHALL still prevent the late result from becoming current state.
- **WHEN** a stale result is useful for diagnostics **THEN** it SHALL be retained only as a bounded stale diagnostic and SHALL not be presented as current availability or success.

Classification: B lifecycle/concurrency. Host: supplies current generation evidence. Client: required stale guard.

### CG-6 Repeated Mount, Dispose, and Ownership Safety

**User Story:** As a client runtime maintainer, I want repeated mount/dispose operations to be safe, so that HMR and reconnect do not leak listeners or remove another owner's resource.

**Acceptance Criteria:**

- **WHEN** the same contribution is mounted more than once for one owner/generation **THEN** the facade SHALL either return the existing identity-scoped handle or reject the duplicate without creating a second live registration.
- **WHEN** a contribution disposer runs **THEN** it SHALL be idempotent and SHALL remove only resources created or explicitly adopted by that contribution identity.
- **WHEN** an old disposer runs after a new contribution with the same public key is active **THEN** the old disposer SHALL not remove, disable or mutate the newer contribution.
- **WHEN** a plugin unloads **THEN** all pending binds, availability listeners, remote/slot/settings registrations and timers owned by that plugin SHALL lose publication eligibility and be cleaned up according to their official service contract.

Classification: B. Host: official service owners retain resource semantics. Client: contribution ownership facade.

### CG-7 Contract Compatibility and Diagnostics

**User Story:** As a plugin maintainer, I want incompatible faces to fail locally and visibly, so that version drift cannot corrupt a running client.

**Acceptance Criteria:**

- **WHEN** a face is registered **THEN** the facade SHALL compare the required API/contract version and capabilities with the host-provided description before binding.
- **WHEN** a required version or capability is incompatible **THEN** only that contribution SHALL become `unavailable` or `degraded`, with a bounded diagnostic containing face id, owner, required/provided version and reason; unrelated contributions SHALL remain active.
- **WHEN** host availability or contract metadata is missing **THEN** the facade SHALL not infer compatibility from package names, browser module arrival or a stale cached description.
- **WHEN** diagnostic emission fails **THEN** the lifecycle result SHALL remain unchanged and client boot SHALL continue.

Classification: B, interoperating with `plugin-diagnostics` and `dsh-client-connection`. Host: authoritative metadata. Client: diagnostic consumer.

### CG-8 Client Surface, Unsupported R Boundary, and Upstream Exit

**User Story:** As a runtime maintainer, I want the classification and retirement path explicit, so that a cross-component lifecycle facade does not become an oversized replacement fork.

**Acceptance Criteria:**

- **WHEN** the current official graph is audited **THEN** the requirements SHALL record that generation/rebind ownership is distributed across `dsh-client-runtime`, `dsh-client-connection`, `dsh-api-remotes`, `dsh-client-modules`, `dsh-client-ui-slots` and `dsh-client-ui-settings`, and SHALL classify the feature B rather than R for the first version.
- **WHEN** a proposed implementation would disable or replace more than one official component row, copy the complete browser bundle of a non-owner component, or own transport plus remote plus slot plus settings lifecycle together **THEN** the feature SHALL reject that implementation as an invalid R boundary.
- **WHEN** the official client graph later exposes one component-owned public contract covering face availability, generation, contribution binding and stale cleanup **THEN** governance MAY reopen an R evaluation for that single owner after a fresh contract and client-surface audit.
- **WHEN** Design/Tasks registration begins **THEN** governance SHALL register a C-class upstream proposal for an official client lifecycle/rebind seam and SHALL state the retirement condition for this facade.
- **WHEN** the official seam becomes equivalent **THEN** the facade SHALL prefer the official contract and SHALL enter deprecation/retirement rather than maintain competing generation semantics.

Classification: B with C-class upstream proposal; no current R. Host: capability authority. Client: required binding surface.

### CG-9 Visibility and Scope Boundary

**User Story:** As a client operator, I want lifecycle diagnostics without leaking payloads, so that rebind failures can be debugged safely.

**Acceptance Criteria:**

- **WHERE** no visibility policy exists **THEN** UI/debug projections SHALL expose only face id, availability, bounded reason, generation metadata and capability versions, and SHALL omit remote payloads, settings values, credentials and request content.
- **WHEN** a visibility policy elevates non-secret capability evidence **THEN** the projection SHALL retain source, observation time and uncertainty and SHALL not present an availability snapshot as a host mutation or execution outcome.
- **WHEN** a caller requests execution identity creation, usage authority, durable records, transport resume/ack, profile mutation or cross-owner generation comparison through this feature **THEN** the facade SHALL reject it as outside the client lifecycle boundary.

Classification: B shared visibility boundary. Host: authoritative projection source. Client: redacted projection.

## Classification and Coverage Summary

| Area | Covered by | Host | Client | Classification |
|---|---|---:|---:|---|
| Owner-local generations | CG-1 | Metadata | Yes | B |
| Face availability | CG-2 | Yes | Yes | B |
| Independent domain epochs | CG-3 | Evidence | Yes | B |
| Bind/rebind | CG-4 | Trigger | Yes | B |
| Stale async results | CG-5 | Evidence | Yes | B |
| Mount/dispose ownership | CG-6 | Official services | Yes | B |
| Compatibility/diagnostics | CG-7 | Yes | Yes | B |
| R boundary/upstream exit | CG-8 | Governance | Yes | B/C |
| Visibility/scope | CG-9 | Yes | Redacted | B |

## R-Class Assessment

The first version should remain **B class**. An R replacement would need one official component to be the sole owner of all of the following: face discovery/availability, contract generation, transport or host readiness, remote binding, slot declaration epochs, settings rebind, HMR invalidation and stale disposer cleanup. Current evidence assigns those responsibilities to six different official packages. Replacing one row cannot preserve the complete contract of the other five, while replacing several rows would violate the single-component R boundary and create a large client fork with a high browser-build and upgrade burden.

R should be reconsidered only if a future official package becomes the single owner of face availability, generation, contribution binding and stale cleanup, and its client bundle/build contract can be completely reproduced under R8. Until then, the B facade should compose existing official lifecycles and keep the C proposal for a native upstream seam.

## Non-Goals

- Replacing `dsh-client-runtime`, `dsh-client-connection`, `dsh-api-remotes`, `dsh-client-modules`, `dsh-client-ui-slots` or `dsh-client-ui-settings` rows.
- A new transport reconnect/resume/ack protocol, remote namespace discovery protocol, settings wire schema or slot rendering API.
- Creating execution, usage or durable identities in the browser.
- Treating browser refresh, transport reconnect, remote schema revision, slot declaration epoch and settings revision as one global counter.
- Automatically repairing an unavailable host, changing profile composition or supplying UI components.
