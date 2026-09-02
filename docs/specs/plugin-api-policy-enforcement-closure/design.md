# Stage 2 - Design

## Status

SPEC1 Stage 2：已获用户确认（2026-09-01）。批准包含本次对冻结版本边界的修订；Stage 3 Tasks 只可在本阶段提交完成后开始。

## Overview

本 feature 将 M8 已建立的 policy 形状从“注册后由调用方自行咨询”推进为“官方受支持路径自动消费”，同时保留合作型第三方插件可主动遵守规则的公开入口。

设计遵循三个边界：

1. **官方 authority closure**：官方拥有的副作用、终态提交、重试、fallback、可见性发布和自定义事件生产，在其最后一个稳定决策点自动使用适用 policy；业务调用方不需要记住第二次调用。
2. **合作型第三方入口**：第三方自有路径仍可通过 `security.egress`、`executions.recovery` 和其他领域已有的 policy/operation/coordination API 主动遵守同一 policy authority；这些入口不被删除，也不被当作官方自动执行的证明。
3. **明确排除恶意插件和部署隔离**：第三方主动绕过门面、直接使用底层网络/进程/Event API、伪造 owner 或私自 import 官方内部包是最终保留边界。本 feature 不引入部署级沙箱、全局网络 monkey patch、宿主隔离或恶意插件防护系统。

M8 idiom 契约是本 feature 的公共形状基线。所有新增或改变的公共叶子必须在 canonical registry 中有唯一 idiom、semantic face、失败外形、生命周期、owner/scope、组合模式和 availability 记录；自动执行不得为了实现方便增加混合形状、万能 evaluator、旧 alias 或新的 feature-shaped root。

## Current-State Findings

设计阶段对锁定 runtime、当前 facade、canonical registry 和已有 replacement 的核对得到以下事实：

- 已有 policy-shaped public members 包括 LLM request transform/admission、routing/circuit、execution visibility/recovery、channel auth、tool restrict/guard、skill activation、prompt provenance、security policy/redaction/egress 等；不能只修 egress 和 recovery。
- 已有自动消费点包括 `llm/request` 的 transform/admission、官方 approval/tool seams、route decision、tool restriction/guard、channel verifier/authorizer、execution visibility、context composition policy 和 skill catalog policy。
- `executions.recovery` 当前由 observation/transaction adapters 读取，并提供 `evaluate`，但 agent loop 的 `agent/request-error` 仍主要由官方 retry waterfall 消费，公共 recovery policy 还没有完整的单一自动消费 authority。
- `llm.routing.health` 当前有 circuit policy 的自动 transition；已交付 registry 对手动 probe 的 replacement 文字声称“automatic probe execution”，但实现中存在公开/私有 `probe()` 而没有对应的自动调用者。这一条必须在 inventory 中重新判定，不能沿用无证据的自动执行声明。
- `security.egress` 当前 registry 有 policy registration 和 coordination-shaped lease path；内部 engine 有 `check`，但公共门面没有稳定的自动 transport consumer。当前实现的 lease 结果仍接近旧形状，使用 `revoke` 而不是 M8 coordination 的 `release(handle)`。
- 官方出站原语分散在不同 owner：`dsh-llm-deepseek` / `dsh-llm-pi-ai` 的 provider transport、`dsh-web-search-deepseek` 的 provider fetch、MCP HTTP/stdio transport、`dsh-subprocess-local` 的 `spawn`/`spawnTerminal`、`dsh-client-connection` 的 browser fetch/WebSocket、可选 telemetry exporter，以及 facade replacement 自己的 remote/attachment paths。
- 现有 full patch 替换 `llm`、`mcp`、`attachments`、`agent-loop`、`connection` 等行，但没有统一 egress contract，也没有替换 `web`、`subprocess` 或 provider rows；替换了 `llm` 行不自动证明 provider 内部直接 fetch 已被拦截。
- M8 已删除的 `security.egress.check`、`executions.recovery.consume`、`executions.recovery.visibility.project` 不恢复为咨询式公共入口；自动执行通过后，合作型主动使用仍由符合 idiom 的领域 API 承载。
- 仓库根目录有三个在 M8 Wave 7 提交中误纳入 Git 的 `undefined\dsh-cost-meter-test-*` ledger，属于本 feature 的强制清扫项，不是运行时能力。

## Architecture

```text
                              public facade
      +-------------------------------------------------------------+
      | pluginApi.security.policy/redaction/egress                  |
      | pluginApi.executions.recovery.policy/evaluate               |
      | existing domain policy registrations and operations         |
      | events.define + events.observe + dispatch outcomes          |
      +-------------------------------+-----------------------------+
                                      |
                         typed internal enforcement contract
                                      |
      +-------------------+-----------+-----------+-------------------+
      |                   |                       |                   |
  egress authority   recovery authority    domain policy owners  event owner
  target/admit       classify/consume       route/tool/auth/etc. custom publisher
      |                   |                       |                   |
      +-------------------+-----------+-----------+-------------------+
                                      |
        last stable pre-side-effect / pre-terminal decision point
                                      |
   LLM providers | web | MCP | subprocess | browser connection | agent loop
```

### 1. Main facade and internal authority

The main host facade remains the lifecycle owner. It publishes a private, symbol-keyed internal contract on the root context after its policy owners are initialized. The contract is not a new public namespace, runtime registry service, permission system, or package identity. It contains typed domain methods rather than one unrestricted `evaluate(domain, input)` function:

- `egress.admit(target, context)` — normalize the target, evaluate the security egress registry, and return a bounded internal authorization decision/lease suitable for the owning component;
- `egress.release(handle)` — invalidate a lease through the same coordination authority;
- `recovery.decide(input)` — classify and evaluate recovery policy for one operation window;
- `recovery.commit(decision, operation)` — atomically consume an accepted recovery decision once, subject to operation identity, owner, generation, attempt and terminal-state checks;
- `policy.status(domain/path)` — return internal coverage state to component guards without exposing the internal registry.

The contract is capability-limited and component-neutral only at the transport boundary. Domain reducers remain local: egress keeps egress precedence over its denylist baseline (default allow, so an empty registry reproduces the official outbound behavior), recovery keeps recovery action validation/retry bounds, routing keeps route reducer semantics, and visibility/redaction keep audience/secret rules. Automatic and cooperative calls for the same domain use the same domain registry and reducer; they do not create a second copy of policy state.

Publication and teardown are fail-safe:

1. construct domain owners;
2. validate the internal contract shape;
3. publish the contract before optional component owners attempt to bind;
4. each component reports its own coverage and stays inactive/degraded if binding fails;
5. remove/invalidate the contract before owner teardown can invoke late callbacks.

No component may call an internal method before its guard and availability check. A missing internal contract is a typed unavailable/degraded result, not an implicit allow.

### 2. Policy inventory and enforcement matrix

The feature creates a build-time/test-time inventory derived from the canonical registry plus semantic inspection of implementation facts. It is not imported as mutable runtime state. Each row records:

```text
policyPath
registrationShape          # public registration member
primaryIdiom
policyOwner                # owner of the policy semantics
componentOwner             # official component that owns the protected action
decisionVocabulary
reducer/conflictRule
defaultDecision
automaticDecisionPoint     # last stable pre-action decision point
protectedAction
cooperativeInterface
observableEvidence         # verification reference for the claimed disposition
failureAndCancellation
coverageStatus
verification
retirementCondition        # required only for a retained gap
```

The row field set is a superset of the fields Requirement 1 AC2 requires: `registrationShape` is the public registration member, `policyOwner` separates policy ownership from the official component that owns the protected action, `observableEvidence` names the evidence a disposition is claimed from, and `verification` is the mechanized check id. A row missing any required field is incomplete and fails validation.

The initial disposition is:

| Domain | Existing policy face | Official automatic owner | Cooperative path | Design disposition |
|---|---|---|---|---|
| LLM request transform/admission | `llm.requestTransforms.register`, `llm.admissionPolicies.register` | request owner, RPC admission gateway, and adapter preparation | the same `llm.prepareCall`/request path for cooperative callers | retain current domain policy; verify exact once/convergence and add coverage evidence |
| LLM route policy/circuit | `llm.routing.policies.register`, `llm.routing.health.circuitPolicy.register` | route decision owner and health transition owner | `llm.routing` operations already exposed | retain domain reducers; fix any false automatic-probe claim and add a real scheduler only if the path is promised |
| execution visibility | `executions.visibility.register` | execution projection before audience publication | `executions.get/history/observe` with audience options | retain projection idiom; no mutation or generic policy evaluator |
| recovery | `executions.recovery.policy.register` | agent-loop request-error and facade-owned task/transaction terminal owners | `executions.recovery.evaluate` as a cooperative operation | add automatic single-consumption authority; preserve public evaluate as typed operation, not `consume` |
| recovery visibility | `executions.recovery.visibility.register` | recovery decision projection | recovery decision/history projection | retain policy + projection separation |
| channel auth | `sessions.channels.auth.register` | channel verifier/authorizer before possession-gated action | `sessions.channels` operations | retain automatic authorization and typed remote denial |
| tool restriction/guard | `tools.restrict.register`, `tools.guard.register` | official tools pre-execute and execution preparation | `tools.execute` and related domain operations | retain official policy reducer and preflight order |
| skill activation | `skills.activation.policy.register` | activation/catalog assembly owner | `skills.activation.activate` | retain minimal-update policy semantics and typed outcomes |
| prompt provenance/context | `prompts.provenance.policy.register` | context composition owner | `prompts.provenance.compose` / projection | retain ordered composition and redaction boundaries |
| security policy/redaction | `security.policy.register`, `security.redaction.register` | approval, tool before/after, model request and declared visibility points | corresponding official domain operations | retain domain policy; add coverage rows for each declared point |
| security egress | `security.egress.register` | every supported official outbound owner in the egress matrix | `security.egress.lease.acquire/release` | extend from opt-in lease admission to automatic pre-side-effect enforcement |
| custom event publication | new `events.define` | definition-owned custom publisher | returned publisher handle | make available under cooperative ownership; canonical producer authority remains separate |

A policy-shaped member discovered to be an official passthrough, projection, resource registry, or contribution is reclassified in the registry instead of receiving artificial automatic enforcement. A registration with no automatic owner and no cooperative interface is incomplete unless it is a named edge-path gap with the required evidence.

#### Named edge-path gap record

A retained gap is not free-text justification. Its inventory row is accompanied by a gap record carrying exactly the Requirement 10 AC2 fields:

```text
gapPath                  # public semantic path of the uncovered protected action
component                # official component that owns the action
trigger
protectedAction
missingPreActionPoint
failedChannels           # official binding / facade translation / replacement extension / new replacement, each with why it failed
observableConsequence
affectedInstallationModes
evidence                 # verification reference
retirementCondition
```

Validation accepts a gap record only when every field carries evidence. A gap for a common path, a materially security- or correctness-relevant path, or a path already owned by an approved replacement component is rejected rather than recorded (Requirement 10 AC4), and one path's gap never generalizes to another path whose closure is proven.

## Components And Interfaces

### 1. M8 contract, version boundary, and idiom assignment

#### Frozen version baseline

This feature adds public capability and changes existing public result shapes, but the repository's current API/package/version contract is explicitly frozen (AGENTS.md §3.0.1). This feature SHALL fit the existing frozen contract rather than introduce a version step:

- runtime identity `A` remains the locked `0.1.0-rc.6`;
- main, every auxiliary package and the full aggregate keep their current complete package version `A-B.C.D` — currently `0.1.0-rc.6-0.1.0`, i.e. API generation/increment `B.C` = `0.1` and package-local maintenance number `D` = `0` — and retain `dsh.api: 0.1`;
- no Stage 4 implementation, generated artifact, replacement package, or documentation synchronization may step `A`, `B`, `C`, or `D`;
- new public members and changed semantics are delivered within the frozen local-development contract and MUST be reflected both in the canonical registry and in the capability/availability records (capability descriptors, namespace `availability()`, `capabilityMatrix()`), without changing any version field;
- any future version step requires a separate explicit human version decision and is outside this feature;
- mismatched optional enforcement package disables only its component coverage and never leaves an official row disabled without a working official-contract fallback;
- wire and durable revisions remain independent and are added only if a real host/client or durable boundary needs them.

#### Registry extension and idiom assignment

The canonical public contract registry (`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`, extended in place by M8 — referred to throughout this design as “the canonical registry”) is extended in place. No parallel policy registry is created. New/changed members and their M8 primary idiom:

| Public member | Change | Primary idiom | Notes |
|---|---|---|---|
| `security.egress.register` | registration retained; automatic enforcement added | policy | owner-bound `id` / `ownerId` / `generation`, identity-bound idempotent `dispose()` |
| `security.egress.lease.acquire` | reshaped to an asynchronous coordination entry returning a typed outcome | coordination | lease credential carries `id`, `resource`, `generation`, `fencingToken`, `expiresAt`; no `dispose()` and no legacy `revoke()` |
| `security.egress.lease.release` | new | coordination | `release(handle)` give-back verb, idempotent, typed conflict on stale handle |
| `security.egress.coverage` | new | selfDescription | three-part per-path coverage projection (registration / cooperative / automatic) |
| `executions.recovery.capability.register`, `executions.recovery.policy.register` | retained | policy | unchanged registration shape |
| `executions.recovery.evaluate` | retained as the cooperative operation | operation | frozen `RecoveryOperationOutcome`; not a `consume` acknowledgement |
| `executions.recovery.coverage` | new | selfDescription | the same three-part coverage shape as egress, so recovery also satisfies Requirement 8 AC1 |
| `events.define` | new prescribed verb | contribution or resourceRegistry by its actual registration semantics, plus a registered prescribed-verb exception | dispatch uses the M8 operation-dispatch outcome |
| `events.define(...)` publisher handle | new | resourceRegistry handle | `id`, `ownerId`, `generation`, `emit(payload)`, idempotent `dispose()` |
| `storage.open.handle.close` | accounting correction only | — | old path stays deleted, `replacement` = operation handle `dispose()`, `gapReason` = `null` |

Every row above carries the complete M8 field set in the registry; the `events.define` verb exception records `memberPath`, `baseContract`, `exception`, `reason`, `replacementShape` and `verification`. Registry validation rejects an unregistered leaf, an omitted or invalid idiom, a mixed semantic face without a complete exception, a nonuniform field name, and any legacy alias (Requirement 14 AC1/AC10).

### 2. Egress authority and public cooperative API

#### Public shape

The public egress face follows the M8 policy + coordination split:

```text
pluginApi.security.egress.register(spec)
pluginApi.security.egress.lease.acquire(request) -> Promise<Outcome<Lease>>
pluginApi.security.egress.lease.release(handle) -> Promise<Outcome>
pluginApi.security.egress.coverage() -> FrozenCoverageView
```

- `register(spec)` is the policy idiom: owner is derived from the caller context where available; the handle carries `id`, `ownerId`, `generation`, and idempotent `dispose()`.
- `lease.acquire` and `lease.release` are coordination operations and are asynchronous. A successful acquire returns a frozen lease credential containing `id`, `resource`, `generation`, `fencingToken`, and `expiresAt`; the credential does not expose `dispose()` or `revoke()`.
- `release(handle)` is idempotent. A stale heartbeat/state change/release is a typed `code: 'conflict'` or documented idempotent result with the stale condition in `reason`.
- `coverage()` is a selfDescription projection of registration availability, cooperative invocation availability, and per-path automatic enforcement status. It contains public semantic paths only; it does not expose package, row, mounter or writable registry identities.
- `coverage()` does not replace the availability vocabulary. Namespace-level presence stays on the existing `pluginApi.security.availability()` (and `pluginApi.executions.recovery.availability()`), capability negotiation stays on `capabilities.get/list/require`, and conservation accounting stays on the root `capabilityMatrix()`. `security.egress` therefore gains no second availability member: `coverage()` is the per-path detail layered on those existing members.
- The deleted consultation-style `security.egress.check` is not restored. Internal transport owners use the private `egress.admit` method; cooperative third-party code uses the lease coordination path.

#### Target normalization and authorization

Every automatic owner calls the same egress authority with a normalized target at the latest point where the destination/action is known. The target descriptor is bounded and redacted before audit. The internal authorization is bound to:

```text
kind + destination + operation class + component owner + generation + expiry
```

A redirect, reconnect, retry, transport switch, provider endpoint change, or new child process starts a new admission unless the existing credential explicitly covers that exact action. An authorization never implicitly covers a descendant process, arbitrary URL, or later retry.

#### Official path matrix and owners

The initial matrix uses the following owner strategy:

1. **LLM providers and discovery:** extend the existing `llm` replacement at the adapter registration/decoration boundary so provider stream and model-discovery callbacks are wrapped before their transport begins. The wrapper must derive the final provider endpoint from the adapter-owned request/connection state. If a provider keeps the final endpoint entirely private, add a component-local replacement slice for that provider row rather than claiming the generic `llm` wrapper covers it. Direct imports or self-created provider adapters remain unsupported bypasses.
   - **Wave 3 execution note:** `llm/modelDiscovery` is implemented: `discoverModels` gates the resolved `request.baseURL` through the internal egress contract before the discovery request is sent; only an explicit deny blocks it (denylist baseline). `llm/provider` stream enforcement is **not implemented in this window**: the final provider endpoint lives inside the adapter closure (the forked runtime only sees provider id/name), so a generic wrapper cannot gate the real target; a provider-row replacement would need harness-verified contract parity. The path reports `unavailable` in the matrix and is not claimed as covered.
2. **MCP HTTP and stdio:** extend the existing MCP replacement to gate initial connection, each reconnect, and each transport request that can establish a new outbound target. HTTP targets use the resolved URL; stdio targets use the executable/command descriptor. The wrapper must preserve the official SDK transport contract, cancellation and reconnect behavior.
   - **Wave 3 execution note:** implemented in `packages/mcp`: `connectGeneration` evaluates the egress gate on the normalized transport target (resolved URL / executable descriptor) before transport creation and before `generation.connect`. Streamable HTTP transports also wrap the SDK fetch seam so each request target is re-evaluated, including reconnect/request-level destination changes. A deny blocks the outbound: no transport is established, `egress-denied` is published for connection admission and the reconnect path re-evaluates each attempt. A throwing gate, a malformed decision or a missing main-facade contract cannot deny: the outbound keeps the official behavior on the denylist baseline and the affected path reports `unavailable`, so selective installation changes no official outbound semantics.
3. **Official web and web providers:** place the gate at the web provider boundary immediately before the provider performs a fetch/search. A provider-specific replacement is required when the provider closure does not expose a stable final endpoint to the `web` service wrapper. Attachment remote ingestion and model-facing web tools inherit coverage only after the matrix proves they use the gated `web` service and do not have a direct bypass.
   - **Wave 3 execution note:** not implemented in this window. There is no approved `dsh-web` replacement, the provider closure does not expose a facade-owned pre-fetch seam, and a new web replacement would require harness-verified reproduction of the official web service/event contract. `web` and `web/attachmentRemote` report `unavailable` in the matrix (edge-path disposition with evidence and retirement conditions).
4. **Subprocess, shell and terminal:** place the gate at the lowest common official subprocess service before `spawn` or `spawnTerminal`; terminal and shell owners must use that service for every child-process creation. A new replacement is allowed only for the official subprocess component, must preserve the entire service/event contract, and must not be a deployment sandbox.
   - **Wave 3 execution note:** not implemented in this window. `@deepseek-ai/dsh-subprocess` is a full official Service (`spawn`/`spawnTerminal`, managed process trees, terminal primitives); reproducing its complete service/event contract without harness verification is not safely deliverable, and replacing `ctx.subprocess` would alter the official service for every consumer. `subprocess`, `terminal` and `shell` report `unavailable` in the matrix.
5. **Browser connection:** extend the existing connection replacement at the official browser transport's actual `fetch`/WebSocket attempt. The client half receives a host-produced, redacted coverage/authorization snapshot through the existing connection contract and denies unsupported official transport attempts before invoking the browser primitive. This is not a client policy authority: the host remains the source of policy state, and third-party client code that directly calls browser network APIs remains the explicit bypass gap.
   - **Wave 3 execution note:** not implemented in this window. The connection replacement is a host/client split whose browser transport cannot be exercised under harness-free verification; the path reports `unavailable` in the matrix rather than claiming a client-side gate it cannot prove.
6. **Telemetry and other optional exporters:** inventory each enabled official exporter/provider row. If it is a supported path, its component owner must consume the private egress contract before export; if it cannot be reached without breaking official contract fidelity, it is recorded as a named optional edge path with degraded availability rather than silently included in “all official paths.”
   - **Wave 3 execution note:** recorded as a named edge-path gap (`telemetry`): no approved `dsh-session-telemetry-otel` replacement exists and the exporter row exposes no facade-owned pre-export seam. The path reports `unavailable` in the matrix with a gap record carrying evidence and retirement conditions.
7. **Facade-owned remote/attachment paths:** do not double-evaluate merely because a path is layered. Coverage is proven transitively from the final side-effect owner; an additional direct gate is added only when the layer can perform an independent outbound side effect.
   - **Wave 3 execution note:** `remote` reports `unavailable` and is recorded as a named edge-path gap: coverage must be proven transitively from the final side-effect owner, and the layer currently cannot perform an independent outbound side effect.

The matrix is closed by evidence, not by package naming. A component is not marked covered merely because it is called from a covered component. Paths without completed inventory-and-enforcement verification report `unavailable` (never inherited from a neighbour); `mcp/stdio`, `mcp/http` and `llm/modelDiscovery` are the paths with an implemented, evidence-backed gate in this window.

### 3. Recovery authority and automatic consumption

#### Public shape

```text
pluginApi.executions.recovery.capability.register(spec)
pluginApi.executions.recovery.policy.register(spec)
pluginApi.executions.recovery.evaluate(input) -> Promise<RecoveryOperationOutcome>
pluginApi.executions.recovery.coverage() -> FrozenCoverageView
pluginApi.executions.recovery.availability()
```

`coverage()` mirrors `security.egress.coverage()`: registration availability, cooperative invocation availability, and per-path automatic consumption status for each inventoried official failure owner. It exists because Requirement 8 AC1 requires per-path automatic coverage to be distinguishable whenever policy capability status is queried, and namespace-level `availability()` is not per-path. `availability()` keeps its current namespace-level semantics; neither member exposes package, row, mounter or replacement identities.

`evaluate` remains the cooperative operation for a third-party-owned operation. It returns a frozen M8 operation outcome carrying operation identity, terminal/decision status, normalized action, bounded reason/provenance, execution identity and proposed attempt/bounds where applicable. It does not claim that the caller's private operation was changed; the caller is responsible for honoring the returned action.

Automatic official owners use the private `recovery.decide` + `recovery.commit` pair. There is no public `consume` acknowledgement method. This keeps policy registration, operation evaluation and operation effect separate while making official consumption automatic.

#### Automatic decision points

1. **Agent/model request failures:** the agent-loop owner receives `agent/request-error`, normalizes the failure, evaluates recovery policy once for the current execution/attempt window, and applies retry/fallback/abort/surface before the next attempt or terminal error is committed. The existing official retry provider remains the no-custom-policy/default path; its result is normalized into the same decision window so a custom policy cannot cause a second retry.
2. **Tool-call failures:** the agent-loop scheduler routes dispatch/preparation failures through the same recovery authority before the scheduler commits a terminal step outcome. Started calls preserve their existing operation identity; skipped/aborted calls retain official ordering and result semantics.
3. **Facade-owned tasks and transactions:** task settlement and workspace transaction recovery call the same private authority before terminal commit, retry or rollback. A transaction's `prepare/record/commit/rollback` outer shape remains the M8 operation/mutation split; recovery does not become a hidden mutation or generic rollback disposer.
4. **Other official operation owners:** the inventory records every additional failure/terminal owner. Existing official retry/reconnect policies remain domain policies unless they are explicitly declared to be `executions.recovery`; if a path is governed by recovery, it must join the same operation window and single-consumption guard.

Recovery commit guards verify owner, generation, execution identity, attempt identity, terminal state, cancellation and resource possession. An accepted retry creates a new attempt under the same execution; an aborted, denied, superseded or committed terminal outcome cannot start another attempt. A stale or duplicate failure produces bounded diagnostic evidence and no second effect.

### 4. Other policy domains

The feature does not collapse all policy domains into `security.policy`. Each existing domain retains its M8 public registration and its domain operation as the cooperative path:

- request transforms and admission are automatically consumed by request preparation/gateway and remain callable through the request path;
- route policies and circuit policies are automatically consumed by route decision/health transition; manual probe operation is separately classified and no longer receives an unsupported automatic replacement claim;
- execution visibility and redaction policies are consumed by projection/publication before serialization;
- channel auth policies are consumed by verifier/authorizer gates before possession-gated operations;
- tool restrict/guard policies are consumed by official pre-execute preparation;
- skill activation policy is consumed by the activation/catalog owner;
- prompt provenance policy is consumed by context composition before its projection is published.

Where a cooperative plugin owns a semantically independent operation, it uses that domain's operation or coordination API, not a generic policy evaluator. For example, a cooperative caller uses `tools.execute`, `sessions.channels.acquire`, `skills.activation.activate`, or `prompts.provenance.compose` and receives the domain's normal M8 outcome; the operation itself automatically consumes the registered policy. A domain with no caller-owned side effect exposes no artificial evaluator merely to satisfy symmetry.

Every inventory row explicitly states whether its cooperative path is registration-plus-domain-operation, a typed authorization/lease, or a capability-limited operation outcome.

### 5. `events.define`

#### Public shape

`events.define(spec)` is a prescribed custom-event definition verb. Its definition record is treated as a reversible resource/contribution registration with a documented M8 idiom exception for the required verb; its dispatch method is the M8 operation-dispatch variant.

Conceptual shape:

```js
const publisher = events.define({
  name,
  validate(payload),
  freeze: 'all',
  scope,
})

await publisher.emit(payload)
publisher.dispose()
```

The returned frozen publisher handle exposes:

```text
{id, ownerId, generation, name, emit(payload), dispose()}
```

`emit` returns a frozen discriminated dispatch outcome. One dispatch has no independent operation identity and is never retried, so those operation contract entries are explicitly not applicable as in M8's canonical dispatch members. The publisher handle itself has resource/contribution lifecycle identity and an idempotent disposer.

Rules:

- `name` must be a non-empty custom event identity and must not collide with a canonical event or another active custom definition under the declared conflict key;
- `validate` is a pure payload validator; the public API does not expose a schema library instance;
- payload freezing and listener failure containment follow the declared custom event contract;
- `events.observe(name, ...)` may observe a defined custom event using the standard projection subscription handle;
- a publisher can emit only the event identity it defined and cannot emit canonical official event names through the supported API;
- dispose/reload invalidates the publisher generation and removes it from future dispatch; stale publishers cannot remove or publish through a newer normal definition;
- caller-bound owner information is derived when available for lifecycle and attribution. This is cooperative ownership, not adversarial identity isolation; a malicious plugin can bypass the facade, which remains out of scope;
- custom and canonical event catalogs remain separate semantic categories even though both use the existing bus substrate.

The current `events-bus.js` is extended with a separate custom-definition registry and dispatch path. Canonical event authority, priority, freeze and fault-containment semantics are not moved into a replacement package and are not weakened.

### 6. Storage accounting correction and repository cleanup

The feature includes a narrow repository-maintenance component:

- delete exactly the three tracked files under `undefined\dsh-cost-meter-test-home`, `undefined\dsh-cost-meter-test-legacy-home`, and `undefined\dsh-cost-meter-test-mig-home`, then remove their empty parent directories;
- do not add a broad ignore rule or delete by an unbounded wildcard;
- rescan the exact paths and the root-level `undefined\dsh-cost-meter-test-*` pattern after the guarded test suite;
- if a real in-repository generator is found, fix its temporary-home construction and cleanup; if not, record the files as historical external test products and do not invent a runtime change;
- correct the M8 capability record for `storage.open.handle.close`: keep the old path deleted, set `replacement` to the operation handle `dispose()` contract, set `gapReason` to `null`, and regenerate/synchronize the capability matrix and migration ledger.

### 7. Registry, documentation, and delivery synchronization

Registry, generated-artifact and documentation updates belong to the implementation task, not to a follow-up (Requirement 15). One synchronization set covers:

- **canonical registry**: new/changed member rows and handle rows, the §1 idiom assignment table, the `events.define` prescribed-verb exception, the `storage.open.handle.close` accounting correction, and the two coverage leaves; the `security.egress.lease.acquire` reshape (from the current synchronous `{ lease, decision, revoke }` result to an asynchronous typed `Outcome<Lease>` with `release(handle)`) is recorded as an old-to-target mapping row, not applied silently;
- **M8 generated artifacts**: member inventory, old-to-target mapping, capability matrix, generated host/client snapshots, handle inventory, types and migration ledger — all regenerated from the canonical registry;
- **capability/availability records**: capability descriptors, namespace `availability()` results and `capabilityMatrix()` entries, stated in public semantic paths and never in package, row, mounter or replacement identities;
- **feature registration**: the `docs/specs/plugin-api-features/feature-list.md` row plus the cross-component collaboration record for every R slice;
- **delivery report**: one disposition per policy member, every automatic official path, every cooperative interface and every named edge-path gap, each with its verification reference;
- **public API documentation**: egress states automatic governance of the listed supported official paths plus the cooperative and bypass boundaries; recovery distinguishes automatic consumption from cooperative evaluation; `events.define` states cooperative ownership and canonical/custom separation without claiming adversarial isolation.

A member is not declared delivered until its registry row, generated artifacts, capability/availability record and documentation all state the same boundary.

## Data Models

### 1. Internal enforcement request

```js
{
  domain: 'egress' | 'recovery' | 'visibility' | 'authorization' | 'admission' | 'other',
  path: 'public semantic capability path',
  ownerId,
  generation,
  executionId,
  operationId,
  attemptId,
  scope,
  signal,
  provenance,
  input,
}
```

Only the owning adapter constructs the complete request. Unavailable or unresolvable fields are represented in the domain's bounded unknown form; private credentials, headers, command arguments and full payloads are redacted before diagnostic/audit publication.

### 2. Egress target and lease

```js
EgressTarget {
  kind: 'subprocess' | 'http' | 'mcp' | 'remote',
  destination,
  operation,
  component,
}

EgressLease {
  id,
  resource,
  generation,
  fencingToken,
  expiresAt,
}
```

`resource` is the normalized coordination key; `destination` is the exact bounded target description used for the admission. Redirect/reconnect/retry target changes are not silently included.

### 3. Recovery operation outcome

```js
RecoveryOperationOutcome {
  ok,
  code,
  operation: { id, ownerId, generation },
  terminal: 'success' | 'error' | 'aborted' | 'denied' | 'superseded',
  action: 'retry' | 'fallback' | 'fork' | 'abort' | 'stop' | 'no-op',
  execution,
  attempt,
  reason,
  bounds,
  observedAt,
  provenance,
}
```

Automatic consumption stores a bounded decision-window record keyed by operation/execution/attempt identity. The public outcome does not expose the mutable internal decision registry.

### 4. Bounded decision evidence record

Automatic and cooperative decisions share the domain's bounded audit authority. One record is:

```js
DecisionEvidence {
  decisionId,
  point,             // public semantic capability path of the decision point
  outcome,           // the domain's own decision vocabulary
  channel,           // 'automatic' | 'cooperative'
  policyIds,         // bounded consulted policy identities
  ownerIds,          // owner attribution (non-enumerable where the domain already hides it)
  executionId,
  operationId,
  attemptId,
  observedAt,
  reason,            // bounded caller-facing reason
  redactedContext,   // bounded, redacted input description
}
```

Records never carry credentials, authorization headers, command secrets, private payloads or full provider responses, and host redaction precedes any client serialization. A failed audit append leaves the decision effective and exposes a bounded audit-gap marker instead of a fabricated record; intentionally non-durable audit storage is stated as such in availability and documentation (Requirement 7 AC3–AC6).

### 5. Coverage view

```js
{
  status: 'active' | 'degraded' | 'unavailable',
  registration: 'active' | 'degraded' | 'unavailable',
  cooperative: 'active' | 'degraded' | 'unavailable',
  automatic: {
    'llm/provider': 'active' | 'degraded' | 'unavailable',
    'mcp/http': 'active' | 'degraded' | 'unavailable',
    'mcp/stdio': 'active' | 'degraded' | 'unavailable',
    'web': 'active' | 'degraded' | 'unavailable',
    'subprocess': 'active' | 'degraded' | 'unavailable',
    'connection': 'active' | 'degraded' | 'unavailable',
    // additional named paths appear only after inventory registration
  },
  observedAt,
}
```

The same shape is used by `security.egress.coverage()` and `executions.recovery.coverage()`; only the `automatic` path keys differ, and each key is a public semantic path registered in the inventory. Additional named paths appear only after inventory registration, so a newly observed path reports `unavailable`/unverified rather than inheriting a neighbour's status.

A coverage view is selfDescription, not a security proof against code that bypasses the facade. It must not use a single namespace boolean to hide a missing component path, and it never exposes package, row, mounter or replacement identities.

### 6. Custom event definition and dispatch

```js
CustomEventSpec {
  name,
  validate(payload),
  freeze: 'all' | 'none' | 'payload',
  scope,
}

CustomPublisher {
  id,
  ownerId,
  generation,
  name,
  emit(payload),
  dispose(),
}

DispatchOutcome {
  ok,
  code,
  reason,    // present on failure
  outcome,   // null: a single dispatch carries no independent operation value
  // operation identity/retry fields are explicitly not applicable
}
```

The exact registry member and handle records include the complete M8 field set. `events.define`'s prescribed verb exception records `memberPath`, `baseContract`, `exception`, `reason`, `replacementShape` and `verification` in the canonical registry.

## Hook Exposure And Component Ownership

Every automatic hook is recorded with one of these mechanisms:

| Hook | Mechanism | Channel | Owner |
|---|---|---|---|
| policy registration | existing facade/domain registration, normalized to M8 handle | facade | main/domain owner |
| LLM provider stream/discovery | adapter registration/decoration or provider-row replacement at final endpoint | facade + component-local R where required | LLM/provider owner |
| MCP connect/send/reconnect | existing MCP replacement transport wrapper | component-local R | MCP owner |
| web search/fetch | web provider wrapper or provider-row replacement | facade/R by provider owner | web owner |
| subprocess/terminal | official subprocess service wrapper before spawn | component-local R | subprocess owner |
| browser connection | existing connection replacement before fetch/WebSocket attempt plus host coverage snapshot | component-local R with client half | connection owner |
| agent request failure | existing agent-loop replacement `agent/request-error` boundary | component-local R | agent-loop owner |
| task/transaction terminal | facade-owned operation/transaction methods | facade | task/transaction owner |
| channel auth/tool guard/context policy | existing official dispatch/service seams | facade binding | corresponding domain owner |
| custom publisher | facade-owned custom definition registry and event bus extension | facade | events owner |

No replacement is allowed to modify official package files or import private official variables. Each R slice must reproduce the replaced row's service/event/client contract, run version/boot/owner checks, and fail safe. Cross-component cooperation is recorded in feature registration, but each package remains the sole replacement owner for its official component.

## Error Handling And Lifecycle

### Apply and boot

- Main facade validates runtime/API baseline, constructs policy owners, publishes the internal contract, and reports per-domain availability.
- Each R owner checks official row disabled, exactly one replacement active, runtime/package `A.B.C`, component owner conflict, internal contract compatibility, and critical official contract probes.
- A failed optional enforcement owner disables only its named automatic paths. It must not claim active coverage, leave a disabled official row without a functioning fallback, or kill boot.
- Full aggregate and selective installation use the same order and produce the same selected coverage. Missing optional owners produce path-local `degraded/unavailable` states.

### Automatic decision precedence

1. inactive facade or missing enforcement contract;
2. unavailable component/path;
3. invalid target/input or owner/claim conflict;
4. policy denial or domain-specific terminal decision;
5. official transport/operation error after a successful admission.

Egress is a denylist: for egress paths, internal contract absence or policy callback failure leaves the official outbound behavior unchanged and reports the path unavailable; only an explicit deny blocks the side effect. For non-security policies, the domain's existing documented default remains authoritative and is recorded in the inventory.

### Cancellation and stale completion

- Preserve caller `AbortSignal` and compose only local cancellation sources.
- Invalidate component owner/generation before cleanup callbacks can publish.
- Check target, owner, generation, operation identity, resource possession and terminal eligibility immediately before side effect or commit.
- Redirect, reconnect, retry and provider lazy resolution re-enter admission as required by the matrix.
- After an operation is terminal, no recovery retry starts; late failure/transport callbacks are bounded diagnostic evidence only.
- Lease release and publisher dispose are idempotent; stale releases/disposes cannot touch newer generations.

### Audit and redaction

Automatic and cooperative decisions share the existing bounded audit authority for their domain. Audit records distinguish `automatic` and `cooperative` provenance, but never store raw credentials, authorization headers, command secrets, private event payloads or full provider responses. Host redaction occurs before client serialization. Audit append failure leaves the decision effective and exposes a bounded audit gap rather than fabricating a record.

## Testing Strategy

### 1. Pure contract and registry tests

- inventory completeness: every policy member, automatic path, cooperative path, and named edge gap has one disposition;
- inventory row completeness against the Requirement 1 AC2 field set, including `policyOwner`, `decisionVocabulary` and `observableEvidence`;
- gap-record completeness: every retained gap carries all Requirement 10 AC2 fields, and a gap for a common, materially relevant or already-owned path is rejected;
- M8 idiom validation for every new/changed leaf and handle, including the §1 idiom assignment table and the `events.define` prescribed-verb exception;
- policy register handles, operation outcomes, coordination lease fields, `release(handle)`, uniform names, availability separation and no legacy aliases;
- canonical/custom event separation, `events.define` exception record, publisher handle, custom dispatch outcome and no raw schema object;
- decision-evidence records: `channel` attribution, bounded/redacted fields, no secrets, and a bounded audit-gap marker when the append fails;
- storage removal accounting (`replacement` present, `gapReason` null) and generated artifact equality;
- both coverage views (`security.egress.coverage`, `executions.recovery.coverage`) use per-path statuses, stay in agreement with capability descriptors and `capabilityMatrix()`, and never overclaim an unregistered path;
- registry, generated artifacts, capability/availability records and documentation state the same boundary for every delivered member.

### 2. Egress automatic enforcement tests

Each official owner gets a contract-faithful side-effect spy and proves:

- registered policy is automatically consulted without a caller-side check;
- deny occurs before fetch, WebSocket, transport creation, process spawn or exporter send;
- allow is bound to exact normalized target, owner, generation and expiry;
- redirect/reconnect/retry/new child process re-evaluates when target/action changes;
- policy callback failure and an unavailable authority keep the official outbound behavior on the denylist baseline and report the path unavailable, while an explicit deny still blocks before the side effect;
- MCP stdio/HTTP, LLM provider/discovery, web provider, subprocess/terminal, browser connection and optional exporter rows report independent coverage;
- direct third-party raw network/process calls are not misrepresented as intercepted.

### 3. Recovery automatic consumption tests

- agent request-error policy is automatically evaluated and consumed once;
- official retry fallback remains behaviorally unchanged when no custom recovery policy is registered;
- custom retry preserves execution identity and increments attempt;
- fallback/abort/stop are applied before terminal commit;
- tool scheduler, task settlement and transaction recovery use the same decision window where declared;
- duplicate/stale failures cannot start a second attempt or overwrite terminal state;
- cancellation, deadline, denied and superseded outcomes never trigger an automatic retry;
- cooperative `evaluate` uses the same policy generations/reducer but leaves caller-owned side effect responsibility explicit.

### 4. Other policy regression tests

- existing automatic request transform/admission, route, circuit, visibility, channel auth, tool guard/restrict, skill activation and prompt provenance behavior remains intact;
- each policy registration has a real decision point or a named cooperative operation/gap;
- route health probe accounting no longer claims automatic execution without an actual scheduler;
- callbacks fail according to their domain default and do not break unrelated owners.

### 5. `events.define` tests

Two synthetic normal plugins cover reverse registration order, custom identity conflict, declared payload validation/freeze, publish outcome, custom observation, canonical-event rejection, repeated dispose, stale publisher, reload isolation, observer failure containment and preservation of unrelated canonical/custom events. Tests explicitly do not attempt adversarial owner forgery or raw Cordis bypass prevention.

### 6. Replacement and installation tests

- full aggregate versus selective main-plus-enforcement installation;
- runtime/API mismatch, component owner conflict, official row restoration, no double-run and optional path-local degradation;
- official service/event/client contract parity for every new or extended replacement;
- browser client coverage snapshot, bundle boundary and connection attempt gate where applicable;
- no official package modification.

### 7. Repository and final evidence

- exact artifact deletion and post-test recurrence scan;
- registry/surface/snapshot/type consistency;
- capability/availability records, the delivery report and the runtime coverage projection state the same dispositions;
- consumer or component integration tests at real owner boundaries;
- guarded `npm test`, `git diff --check`, official-package modification audit and clean worktree;
- delivery report distinguishes automatic official coverage, cooperative support, named official edge gaps, third-party bypass, and dev-boot/environment evidence.

## Standards Applicability And Alignment

| Standard | Applicability | Design alignment |
|---|---|---|
| `docs/standards/capability-strategy.md` | Applicable | Facade-first default; component-local R only where the final side-effect seam is owned by one official component; no deployment sandbox, no official package edits, no cross-component global replacement, full R1-R8 checks and retirement conditions. |
| `docs/standards/api-shape.md` | Applicable | Policy registration, operation outcomes, coordination leases, projections and mutations remain separate; no universal evaluator or mixed public face. |
| `docs/standards/public-api-shape.md` | Applicable | Existing bounded contexts remain; new coverage and custom event members use semantic paths, no package/row identities, no old aliases or feature-shaped roots. |
| `docs/standards/composition-and-authority.md` | Applicable | Supported official paths form authority closure; cooperative caller-owned paths are explicit; owner/generation/disposer, conflict, preflight and callback containment are preserved; malicious bypass is excluded. |
| `docs/standards/domain-composition.md` | Applicable | Security keeps policy/redaction fail-closed and egress on its denylist baseline (only an explicit deny blocks, an unavailable authority keeps the official outbound behavior); recovery has one consumption authority; route, tools, auth, visibility and prompt domains retain their own reducers and owners; canonical/custom event production remains separate. |
| `docs/standards/ordering.md` | Applicable | Domain reducers and fixed stages decide policy order; ordinary listener priority remains fixed vocabulary plus registration order; no global dependency graph. |
| `docs/standards/identity-and-lifecycle.md` | Applicable | Policy handles use owner-specific generation; recovery keeps execution identity across attempts; leases and publishers have explicit lifecycle identity; terminal outcomes are final. |
| `docs/standards/durable-state-and-scope.md` | Applicable in part | Recovery retry bounds and any persisted evidence declare scope; egress audit remains bounded/non-durable unless separately specified; no generic storage or migration platform. |
| `docs/standards/visibility-and-redaction.md` | Applicable | Target, failure, policy and event payloads are bounded/redacted; host-first redaction precedes client serialization; secrets never appear in audit or coverage. |
| `docs/standards/concurrency-and-cancellation.md` | Applicable | Async transport, retry, lease, publisher, browser reconnect and replacement lifecycle use signal propagation, commit eligibility, stale guards and owner-only cleanup. |
| `docs/standards/versioning-and-protocols.md` | Applicable | The current package/API/version fields remain frozen; no `A`, `B`, `C`, or `D` step is permitted in this feature. Selective/full coverage is explicit, runtime/package mismatch is path-local, and wire/durable versions remain independent. |
| M8 current contract artifacts (`docs/specs/plugin-api-m8-api-idiom-refactor/` and canonical registry) | Applicable as feature baseline | New/changed members must preserve the eight idioms, uniform names, handle contracts, availability/capability separation and registry-driven conservation; M8's current delivered contract is not bypassed for convenience. |
| `docs/standards/refactor/` future-target documents | Not independently normative | The feature uses the M8-delivered contract already recorded in the canonical registry; unrelated future refactor targets are not treated as current runtime facts. |

## Key Decisions And Tradeoffs

1. **One internal contract, many domain reducers.** A shared internal enforcement contract prevents each replacement from inventing a second egress/recovery registry, while domain-local reducers preserve M8 idiom and semantics.
2. **Last-side-effect owner, not caller stack, is authoritative.** Checking only at `llm.stream`, `web.fetch` or `mcp.connect` is insufficient when a provider/SDK later opens a transport. The matrix follows the owner that actually performs the side effect.
3. **Component-local replacement over global interception.** R slices are acceptable where the missing seam is naturally owned by an official component and the full official contract can be retained. No deployment-level enforcement or global monkey patch is introduced.
4. **Public cooperative APIs remain domain-shaped.** Egress uses coordination lease acquire/release; recovery uses an operation evaluation outcome; other domains use their existing operations. This provides a path for willing plugins without reintroducing a generic consultation API.
5. **`events.define` is cooperative infrastructure, not a security boundary.** It prevents normal accidental cross-owner/canonical-event conflicts and supplies lifecycle cleanup, but it does not attempt to stop malicious same-process code from bypassing the facade.
6. **Coverage is per path.** A missing provider or optional exporter does not erase the coverage proof for unrelated official paths; conversely, a broad namespace flag cannot hide one uncovered official transport.
7. **Accounting is evidence, not implementation.** The cost-meter cleanup and `storage.open.handle.close` correction are included so M8's final report becomes truthful, but neither is used to justify a new runtime abstraction.

## Design Completion Condition

Stage 2 is complete only after the user confirms this Design. After confirmation, Stage 3 may produce the dependency-ordered Tasks. No implementation, package metadata, generated registry artifact, deletion, or test change is authorized before that confirmation and the required Stage 3 review gate.
