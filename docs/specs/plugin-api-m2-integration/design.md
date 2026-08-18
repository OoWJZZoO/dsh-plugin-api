# Design: plugin-api-m2-integration

> feature_name: `plugin-api-m2-integration`
> 状态：Stage 2 草案，待批准
> 上游：`plugin-api-m2-integration/requirements.md`（Stage 1 已批准）、`plugin-api-m1-integration`、`plugin-api-semantic-hooks-m2`
> 范围：集中整合已交付的 M2 worktree；本阶段只定义整合设计，不修改实现代码

---

## Overview

本设计把五个已完成的 M2 worktree 组装为一棵唯一的 `dsh-plugin-api` host facade：

- `plugin-api-llm-request-m2`：L4 `llm/request` 有界同步 transform，以及依赖它的 L2 `llm/admission`；
- `plugin-api-exec-route-m2`：A9/T10 的单一 route snapshot authority；
- `plugin-api-agent-create-m2`：A11 AgentRegistry 创建、恢复、注册和 provider lifecycle 直通；
- `plugin-api-session-durable-m2`：S2 constrained append 与 O8/O13/O14 durable observation；
- `plugin-api-compaction-m2`：SV17 `services.compaction` 三个官方抽象操作。

这些 worktree 的 feature-local 模块和测试已经各自完成 Stage 4，但它们同时复制修改了 `lib/index.js`、`lib/plugin-api-service.js`、`lib/guards.js`、部分 `lib/services.js`、`package.json` 和共享测试入口。故本 feature 不把某个 worktree 的共享文件作为权威版本，而采用两波整合：先按预定顺序合并分支并只处理冲突，再由整合协调者统一重建共享协调层。最终行为以本设计和已批准 Requirements 为准。

本设计的核心结果是：

1. `pluginApi` 只有一个 host service 实例和一个 facade composition authority；
2. `featureRegistry.isActive(name)` 是所有 feature 的唯一活动信号；
3. M1 的 catalog、事件总线和失败分类保持不变，M2 不新增 catalog slice 或 synthetic Cordis event；
4. 所有 B 类公开面在 cleanup 注册、发布和 registry 激活之间具有可回滚的事务边界；
5. A11、exec-route、durable overlay 的组合使用 identity/epoch-bound disposer，旧实例不能清理新实例；
6. 版本从 `0.1.0-rc.6-0.2` / `dsh.api: 0.2` 升至 `0.1.0-rc.6-0.3` / `dsh.api: 0.3`；
7. Stage 4 结束前必须完成全套测试、headless smoke、dev boot 和两项迁移验收。

M2 仍是 host-only 集成。没有 client bundle、remote namespace、codec、slot、settings bridge 或客户端语义转译；这些属于 M3 或明确的 upstream proposal。

## Architecture

### 1. Integration waves and ownership

#### 1.1 Read-only pre-merge audit

在任何合并操作前，协调者对五个 worktree 做只读审计，不重新审查已经按用户指示确认完成 Stage 4 的 feature 实现。审计只记录整合事实：

- 每个 worktree 的实现、focused tests 和 Stage 4 metadata 是否存在且 clean；
- 每个分支的 feature key、公开 namespace、mounter position、guard branch、service member 和 package metadata；
- feature-list 编号覆盖与明确排除范围；
- 两两 `git merge-tree` 冲突文件矩阵；
- 共享文件中各分支引入的 mounter、disabled facade、mount/unmount token、guard 和测试断言；
- catalog 是否有 M2 越界条目；M2 的预期结论是没有新的 catalog slice。

该审计不把 worktree 的共享实现直接判定为最终形状，也不在合并前修改任何分支。

已知共享冲突矩阵如下：

| 文件 | 冲突来源 | 整合所有权 |
|---|---|---|
| `lib/index.js` | 五个分支各自复制 `FEATURE_MOUNTERS`、apply 两遍流程和 mounter | 整合协调者；最终唯一 mounter registry 与 staged lifecycle |
| `lib/plugin-api-service.js` | L2/L4 staged feature、exec-route delegate、A11 agent composer、session durable overlay、services namespace 各自追加 | 整合协调者；最终唯一 facade composer、assignment、rollback/token 语义 |
| `lib/guards.js` | 各分支追加 guard branch，session durable 还带 runtime/audit probes | 整合协调者；保留所有 feature 分支并统一 P2 结果 |
| `lib/services.js` | compaction 分支扩展 static definition，其他分支带自身基线 | 整合协调者；唯一 19-key static table |
| `package.json` | session durable audit-only peer dependencies 和 M2 protocol bump | 整合协调者；按已批准 version contract 写入一次 |
| 共享 index/service/guard tests | 各分支顺序、组合和 rollback 断言互相重叠 | 整合协调者；冻结入口集中更新，feature-local tests 保留 |
| catalog 入口 | M2 设计禁止新增 slice，但旧分支基线可能包含旧 admission 结构 | 整合协调者；保留 M1 catalog，删除/退役不再拥有者的旧入口 |

#### 1.2 Conflict-only merge wave

在整合分支上按以下顺序合并已交付分支：

1. `plugin-api-compaction-m2`：先取得 `services.js` 的 SV17 static definition；
2. `plugin-api-llm-request-m2`：取得 L2/L4 feature-local owner、errors 和 staged API 依据；
3. `plugin-api-agent-create-m2`：取得 A11 adapter 和 agent composition 依据；
4. `plugin-api-session-durable-m2`：取得 durable catalog、owner、append/observation API 和 audit manifest；
5. `plugin-api-exec-route-m2`：取得 route owner、single authority 和 native capture 行为。

该顺序只为减少依赖和使冲突可定位，不改变最终 `FEATURE_MOUNTERS` 顺序。每次合并只处理 git 冲突、保留 feature-local 文件和对应 focused tests，不借机重构共享入口。每一步都必须运行该分支 focused tests 和所有被当前共享入口直接影响的测试，并在继续下一分支前恢复通过。若互不兼容的共享 transaction 形态无法通过局部冲突解决形成兼容超集，则合并波暂停并按 Requirement 1.5/1.6 记录和裁决，不允许携带红测进入下一步或无界延后到最终验收。

#### 1.3 Unification wave

合并波结束后，统一波由协调者按本设计集中处理：

1. 重建 `lib/plugin-api-service.js` 的单一 facade composition 和所有 feature token；
2. 重建 `lib/index.js` 的最终 mounter registry、两遍 guard/apply 和 staged publication；
3. 合并 `lib/guards.js` 的所有分支，统一缺失 substrate、runtime audit 和 dependency failure 的 P2 语义；其中 `execRoute` guard 明确只探测 native hook registration、official tools lifecycle 和 sessions/request-context substrate，不保留 feature worktree 中额外的 `agents` mandatory probe；
4. 以 compaction static definition 生成唯一 19-key services namespace，并保留每 service-member 的 P4 degradation；
5. 删除或停止使用已无 owner 的旧 admission bridge/projection 入口，确保 `resolveModelInfo` 只有 L2 gateway 一个 wrapper；
6. 统一 package version、`dsh.api`、peerDependencies、feature-list 和 `AGENTS.md` 登记；
7. 集中维护 mounter-order assertions、catalog regression assertions、facade composition/rollback tests；
8. 每个统一步骤后运行对应 focused tests，最后执行全量验证。

统一波不得引入 Requirements 未声明的功能、client API、事件条目、通用 semantic-hooks engine 或官方包修改。

### 2. Final host topology

```mermaid
flowchart TB
  A[host apply(ctx)] --> C[core guard]
  C --> G[pass-1 feature guards]
  G --> K[guard results]
  K --> E[events catalog selection]
  E --> M[ordered feature mounters]
  M --> P[prepared publication / cleanup registration]
  P --> R[featureRegistry active signal]
  R --> F[one PluginApiService facade]

  F --> AG[agent base + A11 + route extension]
  F --> TG[tools base + routeOf]
  F --> LL[llm base + request + admission]
  F --> SS[session base + durable overlay]
  F --> SV[static services namespace + compaction]

  L4[llm/stream] --> LR[llm/request owner]
  LR -->|bounded marked re-entry| LS[public llm.stream]
  L2[scoped prompt/selectModel/resolver] --> LA[llm/admission gateway]
  ER[tools/pre-execute] --> RO[exec-route owner]
  SE[official session/event] --> DO[durable observer]
  AP[official Session.append] --> DO
```

The host remains a normal Cordis plugin. It consumes only injected official services and public exports. No feature imports private variables from official DSH packages, and no feature mutates an official service or execution object to attach facade state.

### 3. Exact mounter order and dependency graph

The final registry is:

```text
tools
  -> events
  -> agent                 (M1 reads + A11 extension)
  -> llm
  -> llm/request            (L4 owner)
  -> llm/admission          (L2 gateway; requires llm/request)
  -> session
  -> sessionDurable        (S2/O8/O13/O14; requires events and session)
  -> execRoute             (A9/T10; requires tools and session request-context substrates)
  -> settings
  -> systemPrompt
  -> services              (SV1-SV17, including compaction)
```

`tools < events < session` remains the M1 invariant. `llm/request` is inserted after `llm`, and `llm/admission` after `llm/request`; these are the exact registry keys. `sessionDurable` is immediately after `session`. `execRoute` is after durable session support and therefore after its tools lifecycle and session request-context substrates. Its pass-1 guard probes only `ctx.on`, the official tools service, and the official sessions/request-context substrate; its mounter requires only active `tools` and `session`. It does not fail closed merely because the M1 `agent` facade or `events` facade is inactive. Route capture reads the execution's public `agent.session` object at operation time, and the service-owned route delegate is included in both active and disabled agent view construction so A9 and T10 remain one independently gated `execRoute` capability. This supersedes both the feature worktree's `agents` guard probe and its broader `['tools', 'events', 'agent', 'session']` mounter check to match approved integration Requirement 4.4; Stage 4 must record that supersession in the exec-route spec and replace the affected guard/apply assertions. A11 has no separate mounter or registry key: it is composed during the `agent` mount. SV17 has no mounter or feature key: it is one static entry in `services`.

Pass 1 executes every guard in this order before any feature mounter runs. Pass 2 mounts only features whose guard passed. The events catalog is composed from pass-1 outcomes, so a later M2 failure cannot leave a new M2 catalog slice; M2 contributes none. Dependency checks are repeated at mounter time using `featureRegistry.isActive`, because a prior mounter may have failed after its guard passed.

### 4. Shared facade composition

`PluginApiService` remains the only public facade owner. Its constructor creates stable disabled surfaces and private assignment tokens. A feature mounter may prepare or mount a slot, but no feature mounter may replace the entire `pluginApi.agent`, `pluginApi.session`, `pluginApi.llm`, `pluginApi.tools`, or `pluginApi.services` object independently.

#### 4.1 Agent composition

The agent surface is produced by one context-bound factory:

```text
agent base (get/list/roots)
  + A11 extension (create/resume/register/provider/availability)
  + exec-route extension (routeOf)
```

The base and extensions are private registrations in the service. Each `ctx.pluginApi.agent` read creates a view bound to the consumer fiber context. A11 resolves `ctx.get('agents')` from that consumer context for every official call, preserving official receiver, argument identity, return/Promise/disposer identity, timing and errors. The route extension delegates to the service-owned exec-route authority and does not make A11 depend on the `execRoute` feature for A11 lifecycle calls. When route is inactive, only `routeOf` is disabled; A11 members remain independently available.

The agent composer keeps M1 reads even when an A11 member probe fails. Extension registration uses a token containing feature identity and epoch. Removing A11 or route removes only that extension and cannot replace a later extension.

#### 4.2 Tools composition

The existing tools facade remains the owner of official tools method resolution. `routeOf(exec)` is injected as a second, service-owned delegate and does not resolve `ctx.get('tools')` at query time. Thus A9/T10 use one route authority, while existing tools calls preserve caller-fiber service resolution and all M1 lifecycle behavior.

#### 4.3 LLM composition

The existing `pluginApi.llm` surface retains L3/L6-L9. `request` and `admission` are staged slots. L4 owns the sole raw `llm/stream` listener, operation marker, transform snapshot, bounded public re-entry, convergence and terminal cleanup. L2 owns the policy registry and gateway and consumes the private pipeline handle; it does not install a second stream listener or wrap `resolveModelInfo` outside the gateway. The L2 scoped gateway is the sole owner of the `resolveModelInfo` wrapper, explicitly superseding M1 `admission-bridge.js` ownership while retaining exactly one wrapper.

If L4 cannot publish, L2 is not activated. If L2 is unavailable, L4 remains active but never relaxes official image admission. Existing direct `prepareCall`, `stream`, and provider registration calls retain their official forwarding behavior.

#### 4.4 Session composition

The M1 session facade remains the base owner of lifecycle, read, state and event helpers. `sessionDurable` is a service-owned overlay that contributes durable descriptors, `onDurable`, `onceDurable`, and constrained `appendMessage`. The overlay is composed without reconstructing or dropping M1 members. Its epoch token controls private observer registrations, append validation and reset. A stale durable disposer can only close an observer entry owned by its epoch. During M2 integration this overlay is changed from the feature worktree's immediate `mountFeature('sessionDurable', ...)` publication to the common prepared transaction: the mounter builds the epoch and facade privately, `ctx.effect()` registers cleanup, and only then does commit install the overlay. Rollback before or after commit closes that epoch and restores the durable P2 stubs without changing the M1 session base. This integration design explicitly supersedes the session-durable feature design's earlier publish-before-effect wording and requires that spec and its tests to record the supersession in Stage 4.

Durable observation uses one service-lifetime observation hub over the M1 `session/event` path. The hub installs exactly one native events-bus entry, owns a private `currentEpoch` delegate and stores consumer observers in epoch-local insertion order; `onDurable` and `onceDurable` never add or remove native events-bus entries. On each event, the hub snapshots `currentEpoch`, validates the explicit live `Session` identity and audited record type once, and then visits only that epoch's observer snapshot. Immediately before every user-listener invocation it rechecks `hub.currentEpoch === capturedEpoch`, `capturedEpoch.state === 'active'`, and that the observer entry is still live; a failed check terminates that snapshot's remaining delivery. `onceDurable` removes its private entry before invoking the listener. Synchronous throws and asynchronous rejections are independently contained and diagnosed with the approved S1 listener-failure policy, and do not prevent later live observers in registration order from running. A consumer disposer removes only its identity-bound private map entry. The hub does not replay history, poll, synthesize events, or re-dispatch through `pluginApi.events`. `appendMessage` validates the finite contract, snapshots payload/provenance, and calls the official `Session.append` exactly once.

#### 4.5 Services composition

`SERVICE_DEFINITIONS` is the sole static allowlist. The final namespace contains 19 keys, with `compaction` last. Its three members are exactly `compactIfNeeded`, `compactNow`, and `compactRegion`, forwarded to injected `ctx.compaction` with the existing generic service facade rules. Missing or incomplete compaction produces one definition-level P4-disabled `services.compaction` facade whose three declared methods remain present as typed-error stubs; it does not create a partially active method set, disable other services, or create a `compaction` feature.

### 5. Guard, active signal, and failure paths

All feature guards are pure probes over public services/exports and are executed inside the existing fail-safe diagnostic boundary. Missing mandatory substrates are fail-closed. Optional members inside the existing `services` namespace retain P4 behavior; M2 feature substrates do not invent a new P3 path.

The only activity test is:

```js
featureRegistry.isActive(featureName)
```

Mounters use it for idempotent re-apply, owner epochs and dependency checks. Facade shape inspection is never used as an activity signal.

| Path | Condition | Host result | Public result |
|---|---|---|---|
| P1 | core guard inactive | no feature publication | `PluginApiInactiveError` before official access |
| P2 | feature guard, dependency, registration, publication, activation, runtime audit, or contract failure | contained diagnostic, rollback, registry disabled | `PluginApiFeatureDisabledError(featureName)` |
| P3 | existing M1-approved optional service call unavailable | preserve existing behavior | `PluginApiServiceUnavailableError(serviceName)` |
| P4 | one declared `services.*` member unavailable/incomplete | preserve other service facades | disabled member facade with existing services error |

A11 member probe failure only disables that A11 member. Route absence during an observed execution is normal `undefined`, not P2. Durable malformed-record detection synchronously compare-and-swaps the observation hub's `currentEpoch` from the captured epoch to `null`, marks only that epoch breached, clears its private observer map and disables `sessionDurable`; the invalid record is never delivered and retained facade references immediately observe P2. The service-lifetime native hub entry remains installed and inert, so breach handling performs no native disposer call or events-bus reconciliation during synchronous, asynchronous, parallel or nested `session/event` dispatch. L4/L2 operation errors are contained at the operation boundary according to their approved typed error rules and never escape `apply()`.

### 6. Publication transaction and rollback

The integration adopts one prepared publication protocol for B-class facade slots and any A-class candidate whose shared facade composition must be reversible. This is the selected transaction boundary required by `plugin-api-semantic-hooks-m2`: all such candidates, including `sessionDurable`, remain private until cleanup registration succeeds. Feature-local owners still keep their approved token/epoch cleanup semantics, but immediate public publication before `ctx.effect()` is not retained in the integrated host.

```text
1. pass-1 guard succeeds
2. mounter verifies featureRegistry dependencies
3. owner allocates epoch and registers native hooks/wrappers
4. mounter prepares, but does not publish, the facade slot
5. host registers ctx.effect(() => disposer)
6. host commits the prepared facade publication
7. host marks featureRegistry active
```

Failure at steps 2-7 performs, in order:

```text
prepared.rollback()
owner/epoch disposer()
service unmount/reset for the matching token
featureRegistry.disable(featureName, reason)
contained diagnostic
```

Every operation is idempotent. Publication tokens and epoch identities are compared before unmount/reset. A rollback from an old mount cannot restore a disabled surface over a newer committed mount. Partial native registrations are disposed best effort. `apply()` catches remaining host failures and continues to the next feature.

L4/L2 use `prepareFeature` for `llm/request` and `llm/admission`. Exec-route uses a single owner and route token; its prepared result publishes the delegate only after cleanup registration. Session durable is adapted to the same prepared publication order. The first successful preparation creates the observation hub and its single native subscription; the host registers one service-owned composite disposer with `ctx.effect()` before committing either the hub or facade. If that initial transaction fails, its identity-bound rollback disposes the unpublished hub. If facade commit or registry activation fails in that same first transaction, rollback closes the candidate epoch, resets the facade/registry and disposes the newly created hub entry. Once a transaction is fully active, the hub belongs to the service/context lifetime rather than to an individual durable epoch and is reused by later epochs. `prepareFeature('sessionDurable', overlay)` captures a private epoch/overlay; commit compare-and-swaps that epoch into an idle hub and installs the facade, while rollback/reset detaches and closes only the matching epoch and preserves the M1 session base. Failure of a later remount against an already committed idle hub rolls back only its candidate epoch/facade/registry and leaves that inert hub available for a future explicit apply.

A contract breach after activation runs entirely against private hub state: the callback captures epoch E, validates the record, and on failure compare-and-swaps `hub.currentEpoch` from E to `null` before marking E breached/P2, clearing E's observer map and disabling E's registry entry. A stale callback, disposer or reset whose epoch no longer matches is a no-op. Every observer-snapshot iteration repeats the epoch/current/entry check before entering user code; therefore an observer that causes a nested breach terminates delivery of the outer snapshot before its next observer. The hub's native hook and the events-bus hook set are never changed by breach handling, so no dispatch-depth counter, microtask/macrotask guess or official dispatch-completion signal is required. A later explicit `apply()` may prepare epoch E+1 only while the hub is idle; commit atomically installs E+1, and callbacks that captured E cannot detach or deliver through E+1. Re-apply is never initiated by breach handling, does not replay the breaching record and never revives E or facade references bound to E.

Context/effect teardown invokes the one composite disposer. Its non-throwing state invalidation first atomically changes the hub to `closed` and detaches `currentEpoch`; it then marks that epoch disposed and clears its observers, resets the matching durable facade token to P2, disables the matching `sessionDurable` registry epoch, and finally invokes the one native disposer best effort. All steps are attempted even if a later diagnostic or native disposer throws. Because epoch state is invalidated first, retained facade methods and captured callbacks observe P2 before any fallible external disposal. Repeated teardown is idempotent, and a closed hub cannot accept a new epoch. This stable-hub protocol supersedes the session-durable worktree's per-epoch native subscription and synchronous in-callback disposer/reconcile sequence and must be recorded in its spec/tests during Stage 4. A11 extension publication is staged independently from the M1 agent base, so failure removes only the A11 candidate. Services is an existing immediate M1-style mount; compaction member failure is contained inside its per-definition P4 construction and does not require a new transaction.

### 7. Hook classification and durable/event boundary

| Capability | Class | Mechanism | Boundary |
|---|---|---|---|
| A11 AgentRegistry methods | A | injected official `agents` service, receiver-preserving direct calls | no synthetic event or catalog |
| SV17 compaction | A | injected official `compaction` service, static member forwarding | durable official names are not `pluginApi.events` entries |
| A9/T10 route | B | one prepended `tools/pre-execute` capture plus `Session.requestContext()` | query-only `routeOf`; no `exec.route` mutation/event |
| L4 request transform | B | one raw `llm/stream` owner and bounded marked `llm.stream(candidate)` re-entry | operation facade, not a Cordis `llm/request` event |
| L2 image admission | B | scoped prompt/selectModel/resolver gateway plus L4 terminal policy handle | private gateway; no public ModelInfo mutation |
| S2 append | B | validated `Session.append()` with fixed finite surface recipes | durable official session record only |
| O8/O13/O14 observation | A over official substrate | filtered future `session/event` observation | no replay, polling, synthetic dispatch or catalog slice |
| full async request rewrite, exact causal route, arbitrary durable writes, client wire | C | no implementation in M2 | upstream proposal/M3 boundary |

M2 adds no `pluginApi.events` catalog slice. Existing M1 `session/event` remains the A-class event used to observe committed durable records. Durable records are not re-labeled as Cordis events merely because they are observed by the facade.

## Components and Interfaces

### 1. Coordinator-owned shared modules

| Module | Final responsibility |
|---|---|
| `lib/index.js` | core guard, pass-1 results, exact mounter order, prepared mount protocol, contained diagnostics, registry activation and apply fail-safe |
| `lib/plugin-api-service.js` | stable disabled surfaces, feature slots, agent composer, route delegate, durable overlay, staged assignment/unmount/reset tokens |
| `lib/guards.js` | all M2 guard probes, mandatory/fail-closed classification, runtime audit checks and redacted problem descriptions |
| `lib/services.js` | one 19-entry static service definition table and generic per-definition P4 construction |
| `package.json` | full facade version and API protocol `0.3`, required peer dependency declarations |

### 2. Feature-local modules retained from worktrees

- `lib/llm-request.js` and related L2 gateway/policy modules retain owner-local re-entry, scope and convergence state;
- `lib/exec-route.js` retains the route owner and native capture implementation;
- `lib/agent-create-api.js` retains the context-bound A11 adapter and immutable availability matrix;
- `lib/session-durable-feature.js` plus its pure audit/catalog module retain durable validation, append and observation logic;
- existing `lib/services.js` generic builders retain forwarding and freezing logic, with SV17 added to the definition table.

Each feature-local module exports narrow constructors/mounters. None exports a second public `pluginApi` service or writes another shared facade object.

### 3. Public facade shape

The final host shape is additive to M1:

```text
pluginApi.events
pluginApi.tools.routeOf(exec)
pluginApi.agent.routeOf(exec)
pluginApi.agent.create(options)
pluginApi.agent.resume(options)
pluginApi.agent.register(agent)
pluginApi.agent.provider.enter/announce/setFactory
pluginApi.agent.availability
pluginApi.llm.request.transform(...)
pluginApi.llm.admission.register(...)
pluginApi.session.onDurable/onceDurable/appendMessage
pluginApi.session.durableEventTypes/durableEventDescriptors/isDurableEventType/getDurableEventDescriptor
pluginApi.services.compaction.compactIfNeeded/compactNow/compactRegion
```

No M2 member is client-callable, remotely discoverable or represented by an events catalog entry.

## Data Models

### 1. Feature registry and publication records

These are private runtime records, not public payloads:

```ts
type FeatureMountToken = {
  feature: string
  epoch: object
  api: object
  state: 'prepared' | 'committed' | 'rolled-back' | 'disposed'
}

type PreparedMount = {
  commit(): boolean
  rollback(): boolean
  disposer(): void
}
```

The implementation may use equivalent records, but each token must be identity-bound, idempotent and epoch-aware.

### 2. Route snapshot

```ts
type RouteSnapshot = Readonly<{
  provider: string
  model: string
}>
```

The route owner stores one outcome per observed execution in private weak state. Missing route is a cached `undefined`; it is not retried or diagnosed as an error.

### 3. LLM operation and admission state

L4 operation records, owner markers, transform snapshots and L2 admission scopes remain private to the single `llm/request` owner epoch. They are never attached to official request objects, callback snapshots, catalog payloads or durable records. A self marker bypasses exactly one owner re-entry; foreign markers remain untouched.

### 4. Durable record contract

Durable observation accepts only the five audited session-log types and their exact public payload grammar. `appendMessage` accepts only `user/message`, `assistant/message`, and `tool/result`, detached JSON payloads, and approved provenance. The official immutable record returned by `Session.append` is the only committed value delivered to observers.

The private observation hub has the following equivalent state model:

```ts
type DurableObservationHub = {
  state: 'idle' | 'active' | 'closed'
  currentEpoch: DurableEpoch | null
  nativeDisposer: () => void
  compositeDisposer: () => void
}

type DurableEpoch = {
  identity: object
  state: 'prepared' | 'active' | 'breached' | 'disposed'
  observers: Map<object, DurableObserver>
}
```

Hub and epoch transitions are identity-checked compare-and-swap operations. `idle -> active(E)` is allowed only for a prepared current candidate; `active(E) -> idle` is allowed only to E's rollback, ordinary disposal or breach; context teardown atomically changes either live state to `closed`, invalidates the detached epoch/facade/registry, and disposes the single native entry. Before each observer call, the hub verifies the captured epoch, current hub delegate and live observer entry again; a failed check stops that snapshot. Promise settlement from an asynchronous consumer does not control hub cleanup or native hook registration.

### 5. Services namespace

The services namespace is a frozen object whose key order is the static definition order, ending with `compaction`. The compaction facade exposes exactly three methods and no backend-specific state or members.

## Error Handling

All error-prone paths are nested inside fail-safe boundaries: guard probes, service resolution, member inspection, owner registration, gateway wrapping, transaction commit/rollback, diagnostics, and disposal. A feature implementation must not rely on the outermost `apply()` catch for ordinary cleanup.

The design preserves official errors whenever the approved facade contract is a direct passthrough. A11 does not catch errors thrown by a resolved official method. SV17 forwards return, rejection, argument and receiver behavior. Existing M1 event fault policies remain unchanged. B translators contain only their own operation-level failures and never replace an official continuation error with an unrelated facade error.

Diagnostics are redacted and deduplicated. They may include feature, phase, category and opaque identity, but never request content, prompts, credentials, raw execution objects, durable payloads or thrown object serialization. A logger failure is swallowed. Normal route absence, a non-selected admission policy and an observer that has no historical catch-up record do not generate failure diagnostics.

The following invariants are checked in integration tests:

- no public B member remains after cleanup-registration, publication or activation failure;
- no duplicate `llm/stream` owner listener, gateway wrapper, route capture or durable observer after re-apply;
- no stale disposer disables a newer feature epoch;
- a malformed durable record immediately detaches and P2-disables only the captured `sessionDurable` epoch, does not invoke a durable listener, does not add/remove/reconcile the `session/event` hook set in synchronous, asynchronous, parallel or nested dispatch, and leaves unrelated M1/M2 listeners and surfaces intact;
- explicit re-apply can attach one fresh epoch only to the idle stable hub, creates no second native observer, and does not revive retained references or callbacks from the old epoch;
- a valid observer that triggers a nested breach prevents every later observer in the outer captured snapshot from entering user code;
- composite context teardown invalidates the epoch, facade and registry before best-effort native disposal, leaves retained references at P2, and attempts every cleanup step even when disposal or diagnostics fail;
- an unavailable compaction target disables only `services.compaction`;
- A11 member unavailability does not disable M1 agent reads or route queries;
- all `apply()` failure paths return without killing host boot.

## Testing Strategy

All repository tests use `node --test`. Testing is staged with the two integration waves.

### 1. Pre-merge and focused tests

Before the unified implementation, retain and run each worktree's focused tests against its own feature-local modules. At each merge step the required set is the current branch's focused tests plus the integrated repository's frozen shared host/apply, facade, guard, catalog and version tests touched by the conflict resolution; all must pass before the next branch. The coordinator also verifies the conflict matrix, expected branch coverage, and no M2 catalog additions. This is a structural preflight, not a second full implementation audit.

### 2. Unification tests

Add or update centralized tests for:

- exact `FEATURE_MOUNTERS` order and pass-1/pass-2 behavior;
- all P1/P2/P3/P4 failure paths;
- staged publication, cleanup-registration failure, commit failure, activation failure, rollback and stale-epoch disposal;
- exec-route guard and mounter accept healthy tools/session substrates without requiring active `events` or `agent`, while both facade entries share one route authority;
- durable breach invalidation is immediate and changes only private hub/epoch state, with zero native hook disposal/reconciliation during synchronous, asynchronous, parallel and nested dispatch;
- initial hub transaction failure disposes its unpublished native entry, later breach/re-apply reuses exactly one committed hub entry, and context teardown closes it idempotently;
- observer delivery rechecks epoch/current/entry identity before every callback, including a nested-breach case, while preserving once-before-call, registration order and contained sync/async listener failures;
- composite teardown removes the active epoch, facade overlay and registry signal before best-effort native disposal, including throwing-disposer and retained-reference cases;
- one composed agent facade containing M1 reads, A11 members and route extension;
- one tools route delegate shared by tools and agent;
- L4 before L2 and exactly one `resolveModelInfo` wrapper;
- session base plus durable overlay without dropping M1 methods;
- exact M1 event catalog membership remains the same 47-name set, with no M2 slice or synthetic name;
- durable metadata remains the exact five-kind audited catalog, asserted independently from event catalog count;
- 19-key services namespace and definition-level compaction P4 behavior;
- idempotent re-apply and no duplicate subscriptions/wrappers.

Feature-local tests remain authoritative for detailed LLM convergence, route capture, A11 receiver/identity forwarding, durable validation and compaction forwarding.

### 3. Regression and migration gates

Run, in order:

1. focused tests for the changed coordinator module;
2. all M2 feature-local tests;
3. all existing M0/M1 tests with no unrelated baseline changes;
4. full `node --test` from repository root;
5. `dsh-read-image` migration tests, headless smoke and development boot;
6. `dsh-pro-ex-ability-anchor` migration tests, headless smoke and development boot;
7. `git diff --check` and a final clean-tree/status audit.

Migration acceptance must demonstrate:

- `dsh-read-image` removes A1/A2/A6 hack ownership and uses `pluginApi.llm.admission`, `pluginApi.llm.request`, and `pluginApi.tools.routeOf` while preserving safe missing-route/admission behavior;
- `dsh-pro-ex-ability-anchor` uses the durable session helper/observation and supported facade services instead of private session or compaction access; it reads the composed session facade at operation/registration boundaries rather than relying on a breached epoch's retained durable methods to become active again;
- both consumers boot with the same official DSH installation and remain fail-safe when an optional M2 capability is unavailable.

No user-facing delivery occurs until all gates pass and Stage 4 registration updates `AGENTS.md` §8 and `docs/specs/plugin-api-features/feature-list.md` consistently.
