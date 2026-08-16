# Feature Requirements: plugin-api-agent-m1

## Introduction

`plugin-api-agent-m1` 是 `dsh-plugin-api` 的 **M1 agent 命名空间 feature**，合并 feature-list §2.4 中的 **A1–A8**：

- **A1–A2, A7**：`agent/*` 生命周期、inbox、错误事件的类型化订阅；
- **A3–A6**：`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping` 的语义化 waterfall/serial 稳定化；
- **A8**：`pluginApi.agent` 注册表读面（`get` / `list` / `roots`）的稳定直通。

本 feature 只覆盖 **host 侧**。不新增 client bundle、不新增 client remote、不涉及设置可视化桥。

**类型标注**：A1–A8 八个 feature 本体全部为 **A 类**（官方 `dsh-agent` / `dsh-agent-loop` 已 dispatch 或已提供服务，门面只做稳定化，不发明语义）。本 spec 不产生新的 B/C 类语义钩子，不产生新的 C 类 upstream proposal；§9 的只读/故障策略是对已交付 `plugin-api-events-m1` 总线契约（E9/E11）在 `agent/*` 事件上的细化与例外声明，不是新的 B 类语义钩子。

**依赖**：

- `plugin-api-foundation`（F0.1–F0.3）：`ctx.pluginApi` 服务、分层 fail-safe guard、版本协商。
- `plugin-api-facade-integrity`（F0.4–F0.5）：门面完整性与链安全契约；本 feature 若需要包装官方边界，必须复用其链安全 helper。
- `plugin-api-events-m1`（E1–E12）：`pluginApi.events` 稳定事件总线、priority、只读 payload、scope 感知、故障隔离与事件目录。本 feature 通过扩展事件目录与（如必要）扩展总线策略来稳定化 `agent/*` 事件。

**对已交付 `plugin-api-events-m1` 总线契约的细化与例外**：本 spec §9 在 `agent/*` 事件上对 E11 故障语义声明例外（A 类语义 `waterfall`/`serial` 事件由 contain 改为 propagate，以保留 Cordis 原生传播），并对 E9 只读策略声明按字段冻结（live object `agent`/`signal` 不 deepFreeze）。Stage 3 tasks 必须包含同步修订 `plugin-api-events-m1` 目录 schema 与总线策略的任务，确保两条 spec 与实现一致。

**范围边界**：

- 事件面只覆盖官方 `dsh-agent/lib/types/runtime-types.d.ts` 中 `agent/created`、`agent/disposed`、`agent/status`、`agent/session-start`、`agent/inbox/inserted`、`agent/inbox/claimed`、`agent/inbox/discarded`、`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping`、`agent/error` 这 12 个事件，不夹带其他 `agent/*` 或非 agent 事件。
- 服务面只覆盖 `pluginApi.agent.get(id)`、`agent.list()`、`agent.roots()` 三个只读注册表方法。
- **明确不在本 spec 范围**：A9（B 类 `agent.routeOf` / `execRoute`）、A10（C 类官方路由 API proposal）、A11（Agent 创建/注册高级面，M2）。

---

## Requirements

### 1. Agent event catalog extension (A1–A7)

**User Story:** As a third-party plugin author, I want the 12 official `agent/*` events listed in `pluginApi.events.catalog`, so that I can discover their names, dispatch modes, payload shapes, scope filtering, and fault policy without reading DSH source.

**Acceptance Criteria:**

1. WHEN the events feature is active and `pluginApi.agent` feature is active, THEN `pluginApi.events.catalog` SHALL contain exactly the following 12 `agent/*` entries in addition to the events already cataloged by `plugin-api-events-m1`, and SHALL NOT contain any other `agent/*` entry:

| name | mode | scopeFiltered | payload shape | listener args |
|---|---|---|---|---|
| `agent/created` | `emit` | `true` | `{ agent }` | `(payload)` |
| `agent/disposed` | `emit` | `true` | `{ agent }` | `(payload)` |
| `agent/status` | `emit` | `true` | `{ agent, status }` | `(payload)` |
| `agent/session-start` | `emit` | `true` | `{ agent, source }` | `(payload)` |
| `agent/inbox/inserted` | `emit` | `true` | `{ agent, message }` | `(payload)` |
| `agent/inbox/claimed` | `emit` | `true` | `{ agent, message, turn }` | `(payload)` |
| `agent/inbox/discarded` | `emit` | `true` | `{ agent, message }` | `(payload)` |
| `agent/pre-step` | `waterfall` | `true` | `{ agent, messages, turn, step, signal }` | `(payload, next)` |
| `agent/request` | `waterfall` | `true` | `{ agent, turn, step, signal }` | `(payload, next)` |
| `agent/request-error` | `waterfall` | `true` | `{ agent, turn, step, provider, failure, retryPolicy, signal }` | `(payload, next)` |
| `agent/turn-stopping` | `serial` | `true` | `{ agent, turn, signal }` | `(payload)` |
| `agent/error` | `emit` | `true` | `{ agent, turn, step, error }` | `(payload)` |

2. WHEN a catalog entry from AC 1.1 is read, THEN it SHALL contain at least `mode`, `payload`, `scopeFiltered: true`, `scopeKey: 'args[0].agent'`（与 `plugin-api-events-m1` 的 scope key 概念一致，`agent/*` 事件统一使用该 key）, `source`（对应 feature id：A1–A7）, and `type: 'A'`.
3. WHEN a catalog entry from AC 1.1 is read, THEN it SHALL contain a fault-policy marker with value `'created'` for `agent/created`, `'contain'` for the other seven `emit` events (`agent/disposed`, `agent/status`, `agent/session-start`, `agent/inbox/inserted`, `agent/inbox/claimed`, `agent/inbox/discarded`, `agent/error`), and `'propagate'` for `agent/pre-step`, `agent/request`, `agent/request-error`, `agent/turn-stopping`; the marker SHALL be a new catalog field added by this spec and SHALL be backfilled consistently for the pre-existing events cataloged by `plugin-api-events-m1`.
4. WHEN a catalog entry from AC 1.1 is read, THEN it SHALL contain a freeze-policy marker that identifies which payload fields are deep-frozen and which are passed live (`agent`, `signal`); the marker SHALL be a new catalog field added by this spec and SHALL be backfilled consistently for the pre-existing events cataloged by `plugin-api-events-m1`.
5. WHEN the facade stabilizes these 12 events, THEN it SHALL NOT rename, add, remove, or alter the dispatch mode of any official `agent/*` event; the catalog SHALL mirror the official `dsh-agent/lib/types/runtime-types.d.ts` declarations.
6. WHEN a third-party plugin calls `pluginApi.events.on/once` with one of the 12 names, THEN the facade SHALL apply the same subscription, priority, scope, and read-only/fault rules as for any other cataloged event, except as refined by sections 8 and 9 of this spec.

**Type:** A（官方 `dsh-agent/lib/types/runtime-types.d.ts` L134–321 已声明；catalog 扩展为门面基础元数据）

---

### 2. Agent lifecycle event stabilization (A1)

**User Story:** As a plugin author, I want typed subscriptions to `agent/created`, `agent/disposed`, `agent/status`, and `agent/session-start`, so that I can react to agent lifecycle changes through the facade.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `agent/created`, `agent/disposed`, `agent/status`, and `agent/session-start` SHALL be cataloged as `emit` events with `scopeFiltered: true` and payload shapes per section 1.
2. WHEN the official `dsh-agent` dispatches any event in this section, THEN a facade-registered listener SHALL receive the official payload object, with the official `agent` field passed live and the remaining data fields handled per the catalog freeze policy, and the official `emit` semantics SHALL be preserved.
3. WHEN a facade-registered listener for `agent/created` throws synchronously, THEN the facade SHALL propagate that throw to the official `agent/created` dispatch exactly as if the listener were registered directly with Cordis, preserving the official sync-veto publication semantics; WHEN a facade-registered listener for `agent/created` returns a rejected promise, THEN the facade SHALL contain that rejection per section 9.1 and SHALL NOT reject the aggregate dispatch.
4. WHEN a facade-registered listener for `agent/disposed`, `agent/status`, or `agent/session-start` throws synchronously or returns a rejected promise, THEN the facade SHALL contain that failure per section 9.1 and SHALL continue dispatching to remaining listeners.
5. WHEN a listener subscribes with `opts.scope`, THEN the scope filtering rules of section 9.2 SHALL apply.
6. WHEN the facade stabilizes these events, THEN it SHALL NOT wrap, clone, or replace the `agent` object and SHALL NOT alter the set or order of official listeners.

**Type:** A（官方 `dsh-agent` 对 `agent/created` 同步抛错 veto 发布、异步 rejection 只报告；`agent/disposed` 与 `agentEvents().emit` 对普通 emit 事件逐 listener 包含错误。门面保持这些官方差异。）

---

### 3. Agent inbox event stabilization (A2)

**User Story:** As a plugin author, I want typed subscriptions to `agent/inbox/inserted`, `agent/inbox/claimed`, and `agent/inbox/discarded`, so that I can observe inbox activity through the facade.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN the three inbox events SHALL be cataloged as `emit` events with `scopeFiltered: true` and payload shapes per section 1.
2. WHEN the official `dsh-agent` dispatches any inbox event, THEN a facade-registered listener SHALL receive the official payload with the official `agent` field passed live, the data fields handled per the catalog freeze policy, and the official `emit` semantics preserved.
3. WHEN a facade-registered listener for an inbox event throws or rejects, THEN the facade SHALL contain that failure per section 9.1 and SHALL continue dispatching to remaining listeners.
4. WHEN a listener subscribes with `opts.scope`, THEN the scope filtering rules of section 9.2 SHALL apply.

**Type:** A（官方 `dsh-agent/lib/types/runtime-types.d.ts` L180–208 已声明；门面只稳定化）

---

### 4. `agent/pre-step` waterfall stabilization (A3)

**User Story:** As a plugin author, I want a typed `waterfall` subscription to `agent/pre-step`, so that I can reject a proposed step or replace the messages entering it with the same semantics as an official listener.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `agent/pre-step` SHALL be cataloged as a `waterfall` event with `scopeFiltered: true` and payload `{ agent, messages, turn, step, signal }`.
2. WHEN `agent/pre-step` is dispatched, THEN facade-registered waterfall listeners SHALL receive `(payload, next)` with `payload.agent` and `payload.signal` passed live, and SHALL participate with the same waterfall semantics as official `ctx.waterfall('agent/pre-step', payload, next)`.
3. WHEN a facade-registered listener returns a `PreStepDecision` without calling `next()`, THEN that decision SHALL be the waterfall result exactly as if the listener were registered directly with Cordis.
4. WHEN a facade-registered listener calls `next()`, THEN it SHALL receive the downstream decision and SHALL be able to return a replacement decision; the replacement SHALL be handled with the same semantics as an official listener return.
5. WHEN a facade-registered listener throws or returns a rejected promise, THEN the facade SHALL propagate that throw/rejection to the official `agent/pre-step` dispatch exactly as if the listener were registered directly with Cordis; the facade SHALL NOT contain it and SHALL NOT convert it into a successful `next()` continuation.
6. WHEN a listener subscribes with `opts.scope`, THEN the scope filtering rules of section 9.2 SHALL apply; a non-matching waterfall listener SHALL call `next()` and return its value, so it cannot veto the official chain.

**Type:** A（官方 `dsh-agent-loop/lib/index.js` L501 已 dispatch；门面只稳定化，不改写 reject/replace 语义）

---

### 5. `agent/request` waterfall stabilization (A4)

**User Story:** As a plugin author, I want a typed `waterfall` subscription to `agent/request`, so that I can replace the frozen provider/model call configuration with the same semantics as an official listener.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `agent/request` SHALL be cataloged as a `waterfall` event with `scopeFiltered: true` and payload `{ agent, turn, step, signal }`.
2. WHEN `agent/request` is dispatched, THEN facade-registered waterfall listeners SHALL receive `(payload, next)` with `payload.agent` and `payload.signal` passed live, and SHALL participate with the same waterfall semantics as official `ctx.waterfall('agent/request', payload, next)`.
3. WHEN a facade-registered listener returns an `LlmCallConfig` without calling `next()`, THEN that config SHALL be the waterfall result exactly as if the listener were registered directly with Cordis.
4. WHEN a facade-registered listener calls `next()`, THEN it SHALL receive the downstream config and SHALL be able to return a replacement config; the replacement SHALL be handled with the same semantics as an official listener return.
5. WHEN a facade-registered listener throws or returns a rejected promise, THEN the facade SHALL propagate that throw/rejection to the official `agent/request` dispatch; the facade SHALL NOT contain it and SHALL NOT convert it into a successful `next()` continuation.
6. WHEN a listener subscribes with `opts.scope`, THEN the scope filtering rules of section 9.2 SHALL apply; a non-matching waterfall listener SHALL call `next()` and return its value.

**Type:** A（官方 `dsh-agent-loop/lib/index.js` L685 已 dispatch；门面只稳定化）

---

### 6. `agent/request-error` waterfall stabilization (A5)

**User Story:** As a plugin author, I want a typed `waterfall` subscription to `agent/request-error`, so that I can handle failed model-request attempts and own retry/recovery decisions with official semantics.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `agent/request-error` SHALL be cataloged as a `waterfall` event with `scopeFiltered: true` and payload `{ agent, turn, step, provider, failure, retryPolicy, signal }`.
2. WHEN `agent/request-error` is dispatched, THEN facade-registered waterfall listeners SHALL receive `(payload, next)` with `payload.agent` and `payload.signal` passed live, and SHALL participate with the same waterfall semantics as official `ctx.waterfall('agent/request-error', payload, next)`.
3. WHEN a facade-registered listener returns `{ kind: 'retry' }` without calling `next()`, THEN that action SHALL be the waterfall result exactly as if the listener were registered directly with Cordis.
4. WHEN a facade-registered listener calls `next()`, THEN it SHALL receive the downstream action and SHALL be able to return a replacement action; the replacement SHALL be handled with the same semantics as an official listener return.
5. WHEN a facade-registered listener throws or returns a rejected promise, THEN the facade SHALL propagate that throw/rejection to the official `agent/request-error` dispatch; the facade SHALL NOT contain it and SHALL NOT convert it into a successful `next()` continuation.
6. WHEN a listener subscribes with `opts.scope`, THEN the scope filtering rules of section 9.2 SHALL apply; a non-matching waterfall listener SHALL call `next()` and return its value.

**Type:** A（官方 `dsh-agent-loop/lib/index.js` L630 已 dispatch；门面只稳定化）

---

### 7. `agent/turn-stopping` serial stabilization (A6)

**User Story:** As a plugin author, I want a typed `serial` subscription to `agent/turn-stopping`, so that I can observe or steer at the turn boundary with the same ordering and bail semantics as an official listener.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `agent/turn-stopping` SHALL be cataloged as a `serial` event with `scopeFiltered: true` and payload `{ agent, turn, signal }`.
2. WHEN `agent/turn-stopping` is dispatched, THEN facade-registered listeners SHALL receive `(payload)` with `payload.agent` and `payload.signal` passed live, and SHALL participate with the same sequential bail semantics as official `ctx.serial('agent/turn-stopping', payload)`.
3. WHEN a facade-registered listener returns a bailed value, THEN the official serial chain SHALL short-circuit exactly as if the listener were registered directly with Cordis.
4. WHEN a facade-registered listener throws or returns a rejected promise, THEN the facade SHALL propagate that throw/rejection to the official `agent/turn-stopping` dispatch; the facade SHALL NOT contain it and SHALL NOT treat it as a non-bail `undefined`.
5. WHEN a listener subscribes with `opts.scope`, THEN the scope filtering rules of section 9.2 SHALL apply; a non-matching serial listener SHALL return `undefined` and SHALL NOT short-circuit the chain.

**Type:** A（官方 `dsh-agent-loop/lib/index.js` L565 已 dispatch；门面只稳定化）

---

### 8. `agent/error` event stabilization (A7)

**User Story:** As a plugin author, I want a typed subscription to `agent/error`, so that I can observe agent step/turn failures through the facade.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `agent/error` SHALL be cataloged as an `emit` event with `scopeFiltered: true` and payload `{ agent, turn, step, error }`.
2. WHEN the official `dsh-agent-loop` dispatches `agent/error`, THEN a facade-registered listener SHALL receive the official payload with `agent` passed live and the official `emit` semantics preserved.
3. WHEN a facade-registered listener for `agent/error` throws or rejects, THEN the facade SHALL contain that failure per section 9.1 and SHALL continue dispatching to remaining listeners.
4. WHEN a listener subscribes with `opts.scope`, THEN the scope filtering rules of section 9.2 SHALL apply.

**Type:** A（官方 `dsh-agent-loop/lib/index.js` L470 已 dispatch；门面只稳定化）

---

### 9. Cross-cutting policies for `agent/*` events

#### 9.1 Fault policy (revises E11 for `agent/*` events)

**User Story:** As an operator, I want agent event fault handling to match official behavior, so that observer events remain contained while semantic control events keep their official reject/throw semantics.

**Acceptance Criteria:**

1. GIVEN the catalog fault-policy marker from AC 1.3, WHEN a facade-registered listener for an `agent/*` event with marker `'contain'` throws synchronously, THEN the facade SHALL contain the error with a readable diagnostic, SHALL NOT propagate it out of the dispatch, and SHALL continue dispatching to remaining listeners.
2. GIVEN the catalog fault-policy marker from AC 1.3, WHEN a facade-registered listener for an `agent/*` event with marker `'contain'` returns a rejected promise, THEN the facade SHALL contain the rejection with a readable diagnostic and SHALL NOT reject the aggregate dispatch.
3. GIVEN the catalog fault-policy marker from AC 1.3, WHEN a facade-registered listener for an `agent/*` event with marker `'created'` throws synchronously, THEN the facade SHALL NOT contain it; the throw SHALL reach the official dispatcher exactly as if the listener were registered directly with Cordis, preserving the official `agent/created` sync-veto publication semantics.
4. GIVEN the catalog fault-policy marker from AC 1.3, WHEN a facade-registered listener for an `agent/*` event with marker `'created'` returns a rejected promise, THEN the facade SHALL contain the rejection with a readable diagnostic and SHALL NOT reject the aggregate dispatch, matching the official `agent/created` promise-rejection reporting behavior.
5. GIVEN the catalog fault-policy marker from AC 1.3, WHEN a facade-registered listener for an `agent/*` event with marker `'propagate'` throws or returns a rejected promise, THEN the facade SHALL NOT contain it; the throw/rejection SHALL reach the official dispatcher exactly as if the listener were registered directly with Cordis.
6. WHEN containment under AC 9.1.1–9.1.2 or AC 9.1.4 occurs, THEN official listeners and the official dispatcher SHALL continue normally, and the facade SHALL NOT be the cause of an unhandled rejection or boot failure.
7. WHEN propagation under AC 9.1.3 or AC 9.1.5 occurs, THEN the facade SHALL NOT log or wrap the error as a facade containment; it SHALL let the official dispatch/caller handle it.

**Type:** A（官方 `agent/created` 同步抛错 veto 发布、异步 rejection 只报告；`agent/disposed` 与 `agentEvents.emit` 对普通 emit 事件逐 listener 包含；官方 `waterfall`/`serial` 保持 Cordis 原生传播语义。门面不得改变这些差异；本 AC 将 `plugin-api-events-m1` E11 的 contain 规则明确修订为：按事件 fault-policy marker 保留官方故障语义。）

#### 9.2 Scope-filtered subscription (applies E10)

**User Story:** As a plugin author, I want all 12 `agent/*` events to follow the facade's scope-filtered subscription rules, so that I can subscribe to exactly one agent's events.

**Acceptance Criteria:**

1. WHEN a listener subscribes to any of the 12 cataloged `agent/*` events with `opts.scope`, THEN the facade SHALL deliver the event only when the dispatch scope matches `opts.scope`, using the same scope-key resolution as official `dsh-scope` for `agent/*` events (`args[0].agent`).
2. WHEN `opts.scope` is omitted, THEN the listener SHALL observe dispatches for all agents of that event, equivalent to the official global subscription.
3. WHEN a scope-filtered listener does not match the dispatch scope, THEN for `emit` events the listener SHALL NOT be invoked; for `serial` events the listener SHALL return `undefined` and SHALL NOT short-circuit the chain; for `waterfall` events the listener SHALL call `next()` and return its value, so it cannot veto or alter the official chain.
4. WHEN a listener subscribes to an `agent/*` event without `opts.scope` but from a scope-tagged context, THEN the official `dsh-scope` semantics SHALL continue to apply unchanged; the facade SHALL NOT widen or narrow that visibility.

**Type:** A（官方 `dsh-scope` 对 `agent/*` 事件 scope-filtered 派发；`dsh-agent` `agentEvents()` 融合 carrier 与 payload）

#### 9.3 Read-only payload policy for live agent events (extends E9)

**User Story:** As a plugin author, I want read-only guarantees for agent event data without the facade freezing live objects that the official runtime still owns, so that the agent loop keeps working after my listener runs.

**Acceptance Criteria:**

1. WHEN a facade-registered listener is invoked for any of the 12 `agent/*` events, THEN `payload.agent` SHALL be the official live `Agent` object passed by reference; the facade SHALL NOT clone, wrap, replace, proxy, or deep-freeze it.
2. WHEN a facade-registered listener is invoked for an `agent/*` event whose payload contains `signal`, THEN `payload.signal` SHALL be the official `AbortSignal` passed by reference; the facade SHALL NOT clone, wrap, replace, proxy, or deep-freeze it.
3. WHEN a facade-registered listener is invoked for an `agent/*` event, THEN every payload field that the catalog freeze-policy marks as frozen SHALL be deep-frozen before listener invocation (`Object.isFrozen` is `true` for that field and its reachable data objects).
4. WHEN a facade-registered listener attempts to mutate a field marked as frozen, THEN the mutation SHALL NOT alter the object observed by other listeners or by the official dispatch.
5. WHEN a facade-registered listener is invoked, THEN the catalog freeze policy SHALL NOT mark `agent` or `signal` as frozen; the design SHALL justify the freeze boundary for every other field with reference to official ownership and mutation behavior.
6. WHEN the official dispatch already provides a deep-frozen field, THEN the facade SHALL pass it through without observable re-freezing side effects.
7. WHEN a primitive field is involved, THEN the freeze requirements SHALL be vacuously satisfied.

**Type:** A（官方对部分 `dsh-llm` 请求配置已 deepFreeze；门面把只读策略按字段细化，对 live object 不做 deepFreeze。这是对已交付 `plugin-api-events-m1` E9（B 类只读策略）在 `agent/*` 事件上的细化，不构成本 spec 新增的 B 类语义钩子。）

---

### 10. `pluginApi.agent` registry read passthrough (A8)

**User Story:** As a plugin author, I want `pluginApi.agent.get/list/roots` as a stable read-only facade over the official `agents` registry, so that I can look up live agents without importing `dsh-agent` internals.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.agent.get(id)`, THEN the facade SHALL invoke the official `agents` service method `get(id)` with the same argument and SHALL return its return value unchanged.
2. WHEN a plugin calls `pluginApi.agent.list()`, THEN the facade SHALL invoke the official `agents` service method `list()` and SHALL return its return value unchanged (a fresh array; mutating it does not affect the registry).
3. WHEN a plugin calls `pluginApi.agent.roots()`, THEN the facade SHALL invoke the official `agents` service method `roots()` and SHALL return its return value unchanged (a fresh array).
4. WHEN the `pluginApi` service is inactive or the `agent` feature is disabled, THEN `agent.get/list/roots` SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT call into the official `agents` service.
5. WHEN the official `agents` service is unavailable, THEN `agent.get/list/roots` SHALL produce the foundation-defined typed feature-disabled error and SHALL NOT throw any other error.
6. WHEN the facade handles these calls, THEN it SHALL NOT cache, clone, sort, filter, or otherwise alter the returned `Agent` objects or arrays; it SHALL pass the official return value through.
7. WHEN a plugin mutates the array returned by `list()` or `roots()`, THEN the official registry SHALL NOT be affected (official contract preserved).

**Type:** A（官方 `dsh-agent` `AgentRegistry.get/list/roots`，`dsh-agent/lib/types/index.d.ts` L349–370；服务键 `ctx.agents`。门面只做直通。）

---

### 11. Inactive / disabled surface

**User Story:** As an operator, I want a consistent inactive/disabled surface for the new agent namespace, so that fail-safe behavior is identical to other facade features.

**Acceptance Criteria:**

1. WHEN the `pluginApi` service is inactive, THEN `pluginApi.agent` SHALL be present as a disabled stub whose methods (`get`, `list`, `roots`) throw the foundation-defined inactive typed error.
2. WHEN the `agent` feature guard fails but the core facade is active, THEN `pluginApi.agent` SHALL be present as a disabled stub whose methods throw the foundation-defined feature-disabled typed error, and all other facade features SHALL remain active.
3. WHEN the `agent` feature is active, THEN `pluginApi.agent.get/list/roots` SHALL be callable functions and SHALL return per section 10.
4. WHEN any mount or call in this feature fails, THEN the facade SHALL contain the failure and SHALL NOT throw out of `apply` (fail-safe per `plugin-api-foundation`).

**Type:** 门面基础（fail-safe guard）

---

### 12. Testability and regression coverage

**User Story:** As a maintainer, I want all A1–A8 behaviors covered by `node --test` with mocked Cordis/official services, so that the agent namespace is regression-safe without booting a real harness.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN tests SHALL assert the catalog contains exactly the 12 `agent/*` entries of section 1 with their `mode`, `scopeFiltered`, `payload`, `scopeKey`, `source`, `type`, fault-policy, and freeze-policy markers, and SHALL assert no other `agent/*` entry exists.
2. WHEN `node --test` runs, THEN tests SHALL cover the eight `emit` events (A1, A2, A7): a mocked official `agentEvents().emit` dispatch invokes facade listeners with the official payload; for the seven `'contain'` emit events listener throw/rejection is contained while remaining listeners run; for `agent/created` a synchronous throw propagates to the mocked official dispatch and a rejected promise is contained while remaining listeners run.
3. WHEN `node --test` runs, THEN tests SHALL cover `agent/pre-step`, `agent/request`, and `agent/request-error` waterfall semantics: listener return without `next()` becomes the result, listener `next()` composition works, non-matching scope calls `next()`, and listener throw/rejection propagates to the mocked official dispatch.
4. WHEN `node --test` runs, THEN tests SHALL cover `agent/turn-stopping` serial semantics: sequential order, official bail short-circuit, non-matching scope returns `undefined`, and listener throw/rejection propagates.
5. WHEN `node --test` runs, THEN tests SHALL cover scope filtering for all 12 events using the official scope-key resolution (`args[0].agent`) and global visibility when `opts.scope` is omitted.
6. WHEN `node --test` runs, THEN tests SHALL cover the freeze policy: fields marked frozen are `Object.isFrozen` at listener invocation, `payload.agent` and `payload.signal` are passed by reference and are not frozen by the facade, and mutations to frozen fields do not leak.
7. WHEN `node --test` runs, THEN tests SHALL cover `pluginApi.agent.get/list/roots` passthrough with a mocked `agents` service, including return-value identity, fresh-array behavior, and the inactive/feature-disabled/unavailable error paths.
8. WHEN `node --test` runs, THEN tests SHALL cover the fail-safe mount path: a failing `agent` feature guard disables only `pluginApi.agent`, leaves the rest of the facade active, and `apply` never throws.
9. WHEN `node --test` runs, THEN the pre-existing `plugin-api-events-m1` tests SHALL be updated where they asserted a closed catalog count (19 events) and SHALL remain green together with the new agent-event tests.
10. GIVEN a mocked Cordis context and mocked official `agents` service, WHEN `node --test` runs, THEN no test SHALL require booting a real harness.

**Type:** 质量门
