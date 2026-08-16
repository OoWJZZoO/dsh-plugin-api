# Feature Requirements: plugin-api-events-m1

## Introduction

`plugin-api-events-m1` 是 `dsh-plugin-api` 的 **M1 基底 feature 组合**，合并 feature-list 中的：

- **E1–E12**：`pluginApi.events` 稳定事件总线（类型化订阅/派发、priority、只读 payload、scope 感知、故障隔离、事件目录）；
- **O1–O7, O9–O12, O15, O16**：宿主事件/服务稳定化，统一经 `pluginApi.events`（或 `pluginApi.web`）暴露给第三方插件。

本 feature 只覆盖 **host 侧**。client bundle、`client.remote`、slot、settings 可视化配置桥属于 M3；`O8/O13/O14`（durable/session-log 事件）明确不在本 spec 范围；C 类上游提案（U1–U8）不在本 spec 范围。

**类型标注**：E1–E7、E10、O1–O7、O9–O12、O15、O16 为 **A 类**（官方已 dispatch / 已提供服务，只需稳定化）；E8（priority 排序）、E9（只读 payload）为 **B 类**（门面在 Cordis 原生能力之上模拟/统一，必须幂等收敛 + fail-safe）；E11（监听器故障隔离）为 **A/B 类**（官方各 emit 点多为 per-listener contained；门面统一为总线契约）；E12 为 **门面基础**。本 spec 不产生新的 C 类提案。

**依赖**：

- `plugin-api-foundation`（F0.1–F0.3）：`ctx.pluginApi` 服务、分层 fail-safe guard、版本协商。
- `plugin-api-facade-integrity`（F0.4–F0.5）：门面完整性策略与链安全契约；本 feature 若需要包装官方边界，必须复用其链安全 helper。

**范围边界**：本 spec 的稳定化对象是 feature-list 已列出的 25 个 feature；未列出的官方事件不得借本 spec 夹带实现。E12 目录首版仅覆盖本次 25 个 feature。

---

## Requirements

### 1. Stable typed event bus — subscription surface (E1, E2)

**User Story:** As a third-party plugin author, I want a typed `pluginApi.events.on/once` subscription surface, so that I subscribe to stable host events through one supported facade instead of raw Cordis `ctx.on`.

**Acceptance Criteria:**

1. WHEN a third-party plugin calls `pluginApi.events.on(name, listener, opts?)` with a cataloged event name, THEN the facade SHALL register `listener` for dispatches of `name` and return a disposer of type `() => boolean`.
2. WHEN the returned disposer is called, THEN the listener SHALL be removed from future dispatches, and the disposer SHALL return a boolean indicating whether the removal changed the subscription set. WHEN the disposer is called a second time, THEN it SHALL return `false` and SHALL have no other effect.
3. WHEN a third-party plugin calls `pluginApi.events.once(name, listener, opts?)`, THEN the listener SHALL be invoked at most once for the first matching dispatch after subscription and SHALL be removed before or immediately after that invocation; the returned disposer SHALL satisfy AC 1.2.
4. WHEN `opts.priority` is omitted, THEN the listener SHALL be treated as priority `'normal'`.
5. WHEN `name` is not present in `pluginApi.events.catalog`, THEN the facade SHALL pass the subscription through to the underlying Cordis context as an untyped, unsupported subscription and the returned value SHALL still satisfy AC 1.1–1.2; the facade SHALL document that such names carry no stability or typing guarantee.
6. GIVEN the `pluginApi` service is inactive or the events feature is disabled (per `plugin-api-foundation` fail-safe), WHEN `events.on` or `events.once` is called, THEN the facade SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT register any listener.

**Type:** A（E1/E2 基于 Cordis `Context.on/once` 稳定化；AC 1.6 为门面基础 fail-safe）

---

### 2. Stable typed event bus — dispatch surface (E3–E7)

**User Story:** As a third-party plugin author, I want the five Cordis dispatch modes (`emit`, `serial`, `parallel`, `bail`, `waterfall`) exposed through `pluginApi.events` with stable typing, so that I can produce and consume events without importing Cordis internals.

**Acceptance Criteria:**

1. WHEN `pluginApi.events.emit(name, ...args)` is called, THEN the facade SHALL dispatch synchronously to listeners registered for `name` with the same arguments as the official `ctx.emit(name, ...args)` for that event, and SHALL return `void`.
2. WHEN `pluginApi.events.serial(name, ...args)` is called, THEN the facade SHALL return `Promise<BailValue>` and SHALL evaluate listeners with the same sequential bail semantics as official `ctx.serial(name, ...args)` for that event.
3. WHEN `pluginApi.events.parallel(name, ...args)` is called, THEN the facade SHALL return `Promise<void>` and SHALL invoke listeners with the same concurrent barrier semantics as official `ctx.parallel(name, ...args)` for that event.
4. WHEN `pluginApi.events.bail(name, ...args)` is called, THEN the facade SHALL return a `BailValue` and SHALL use the same synchronous bail semantics as official `ctx.bail(name, ...args)` for that event.
5. WHEN `pluginApi.events.waterfall(name, ...args, next)` is called, THEN the facade SHALL return the final value using the same waterfall semantics as official `ctx.waterfall(name, ...args, next)` for that event.
6. WHEN a listener registered through the facade is invoked by any dispatch mode, THEN it SHALL observe the official event arguments for that event, except that object payloads SHALL be deep-frozen per section 4.
7. WHEN any dispatch method is called while the events feature is disabled, THEN the facade SHALL produce the foundation-defined typed feature-disabled error and SHALL NOT dispatch.

**Type:** A（E3–E7 为 Cordis 五种 dispatch 模式的类型化稳定版；AC 2.7 为门面基础 fail-safe）

---

### 3. Priority ordering (E8)

**User Story:** As a plugin author, I want to register listeners with a stable `priority` option, so that cooperating plugins can express deterministic ordering without relying on Cordis `prepend` tricks.

**Acceptance Criteria:**

1. WHEN `opts.priority` is one of `'lowest' | 'low' | 'normal' | 'high' | 'highest' | 'monitor'`, THEN the facade SHALL accept it and apply the ordering rules below.
2. WHEN `opts.priority` is any other value, THEN the facade SHALL produce a defined typed error and SHALL NOT register the listener.
3. GIVEN multiple listeners are registered for the same event through `pluginApi.events`, WHEN that event is dispatched, THEN facade-registered listeners SHALL be invoked in tier order `lowest → low → normal → high → highest → monitor`, where `monitor` is invoked last.
4. GIVEN two or more listeners with the same priority tier, WHEN the event is dispatched, THEN those listeners SHALL be invoked in their registration order (stable insertion order).
5. WHEN a `monitor` listener returns a value during a `bail`, `serial`, or `waterfall` dispatch, THEN that return value SHALL be ignored and SHALL NOT alter the dispatch outcome; `monitor` listeners SHALL observe-only.
6. WHEN the same event has both facade-registered listeners and listeners registered outside the facade, THEN the facade SHALL NOT reorder the outside listeners; priority ordering SHALL be guaranteed only among listeners registered through `pluginApi.events`.
7. WHEN a listener is removed via its disposer, THEN it SHALL no longer participate in priority ordering for any later dispatch.

**Type:** B（Cordis 原生只有 `prepend`；门面在原生能力之上模拟有序分层，必须幂等收敛）

---

### 4. Read-only event payload (E9)

**User Story:** As a plugin author, I want event payloads to be read-only, so that one observer cannot corrupt the shared object another listener or the official dispatcher relies on.

**Acceptance Criteria:**

1. GIVEN a dispatch carries an object payload, WHEN the first facade-registered listener is invoked, THEN the facade SHALL ensure the payload object graph is deep-frozen (`Object.isFrozen` is `true` for the payload and every reachable object) before listener invocation.
2. WHEN a facade-registered listener attempts to mutate the frozen payload, THEN the mutation SHALL NOT alter the payload object observed by other listeners or by the official dispatch.
3. WHEN the official dispatch already provides a deep-frozen payload, THEN the facade SHALL pass that payload through without observable re-freezing side effects.
4. WHEN a `waterfall` listener returns a new object as the next value, THEN the previous input SHALL remain frozen, and subsequent listeners SHALL receive the returned object (frozen per AC 4.1 before the next listener runs).
5. WHEN a payload value is primitive (string/number/boolean/null/undefined), THEN AC 4.1–4.2 SHALL be vacuously satisfied.

**Type:** B（官方对部分 payload 已 deepFreeze；门面把只读 payload 统一为总线契约）

---

### 5. Scope-aware subscription (E10)

**User Story:** As a plugin author, I want to subscribe to agent-scoped events with an `opts.scope` filter, so that I receive only the dispatches relevant to the agent/session I care about.

**Acceptance Criteria:**

1. GIVEN the event is marked `scopeFiltered: true` in `pluginApi.events.catalog`, WHEN a listener subscribes with `opts.scope` matching a dispatch scope, THEN the listener SHALL be invoked only for dispatches whose scope matches `opts.scope`.
2. GIVEN the event is marked `scopeFiltered: true`, WHEN `opts.scope` is omitted, THEN the listener SHALL observe dispatches for all scopes of that event (equivalent to the official global subscription).
3. GIVEN the event is marked `scopeFiltered: false`, WHEN `opts.scope` is provided, THEN the facade SHALL ignore the scope option and subscribe globally, and SHALL document this behavior.
4. WHEN the catalog marks an event `scopeFiltered: true`, THEN the catalog entry SHALL identify the scope key used for matching (for example the agent id field), so that plugin authors can pass a correct `opts.scope`.
5. WHEN a scope-filtered event is dispatched, THEN the facade SHALL NOT deliver it to listeners whose `opts.scope` does not match the dispatch scope.

**Type:** A（基于官方 `dsh-scope` scope-filtered 派发与 `dsh-agent` `agentEvents()` 稳定包装）

---

### 6. Listener fault isolation (E11)

**User Story:** As an operator, I want a broken third-party listener to be contained, so that it cannot break the event dispatch, other listeners, or harness boot.

**Acceptance Criteria:**

1. WHEN a facade-registered listener throws synchronously during `emit` or `bail` dispatch, THEN the facade SHALL contain the error (readable diagnostic log), SHALL NOT propagate it out of the dispatch call, and SHALL continue dispatching to remaining listeners.
2. WHEN a facade-registered listener returns a rejected promise during `serial` or `parallel` dispatch, THEN the facade SHALL contain the rejection with a readable diagnostic; for `serial`, the listener SHALL be treated as returning no bail value; for `parallel`, the rejection SHALL NOT reject the aggregate promise.
3. WHEN a facade-registered listener throws or rejects during `waterfall` dispatch, THEN the facade SHALL contain the error and SHALL pass the current input value unchanged to the next listener, so the waterfall SHALL continue and SHALL NOT fail because of that listener.
4. WHEN any containment under AC 6.1–6.3 occurs, THEN official listeners (registered outside the facade) and the official dispatcher SHALL continue to run normally, and the facade SHALL NOT be the cause of an unhandled rejection or boot failure.
5. WHEN a `monitor` listener throws or rejects, THEN the containment rules in this section SHALL apply identically.
6. WHEN a dispatch is contained under this section, THEN the facade SHALL expose or log the failure in an observable way (for example a diagnostic record) without throwing.

**Type:** A/B（官方各 emit 点多为 per-listener contained；门面把该行为统一为总线契约）

> **修订注记（`plugin-api-agent-m1`）**：本节“统一 contain”规则在 `agent/*` 事件上被 `plugin-api-agent-m1` 细化为 per-event `fault` 策略：7 个普通 `agent/*` emit 仍 contain；`agent/created` 同步 throw 传播（官方 sync-veto）、异步 rejection contain；`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping` 传播。详见 `docs/specs/plugin-api-agent-m1/requirements.md` §9.1。

---

### 7. Event catalog (E12)

**User Story:** As a plugin author, I want a machine-readable `pluginApi.events.catalog`, so that I can discover event names, dispatch modes, payload shapes, scope-filtering, and A/B/C provenance without reading DSH source.

**Acceptance Criteria:**

1. WHEN the events feature is active, THEN `pluginApi.events.catalog` SHALL be available as a read-only object keyed by event name.
2. WHEN a catalog entry is read, THEN it SHALL contain at least: `mode` (`on` | `emit` | `serial` | `parallel` | `bail` | `waterfall`), `payload` type description/reference, `scopeFiltered` boolean, `source` feature id, and `type` (`A` | `B`).
3. WHEN the catalog is read, THEN it SHALL contain exactly the event names stabilized by this spec plus the M1 LLM extension (`plugin-api-llm-m1`): all event names implied by E1–E12 dispatch coverage plus `fs/write-intent`, `fs/edit-intent`, `fs/observed`, `subagent/start`, `subagent/end`, `subagent/provider-added`, `subagent/provider-removed`, `workflow/start`, `workflow/phase`, `workflow/log`, `workflow/agent-start`, `workflow/agent-end`, `workflow/end`, `approval/request`, `commands/change`, `skills/change`, `credentials/updated`, `goal/changed`, `session-telemetry/record`, `llm/stream`, and `llm/adapters-updated`.
4. WHEN the catalog is read, THEN it SHALL NOT include event names outside this spec's 25-feature scope, except for the two event names added by `plugin-api-llm-m1` (`llm/stream`, `llm/adapters-updated`).
5. WHEN the catalog object or any of its entry objects is mutated, THEN the mutation SHALL NOT be observable (the catalog SHALL be frozen or otherwise read-only at runtime).
6. WHEN a catalog entry's `scopeFiltered` is `true`, THEN the entry SHALL identify the scope key per AC 5.4.

**Type:** 门面基础（事件目录；首版范围仅本次 25 个 feature，后由 `plugin-api-llm-m1` 扩展 `llm/stream` 与 `llm/adapters-updated` 两个事件名）

> **修订注记（`plugin-api-agent-m1`）**：目录 schema 已升级：`subject` 更名为 `scopeKey`，每个 entry 新增 `fault`（`'contain' | 'created' | 'propagate'`）与 `freeze`（`'all' | { deep: string[] }`）字段。`plugin-api-agent-m1` 交付后目录新增 12 个 `agent/*` 条目，运行时总数为 31；AC 7.3/7.4 的“恰好 19 个”仅适用于本 spec 首版，后续 feature 扩展以各自 spec 为准。

---

### 8. File-system event stabilization (O1, O2, O3)

**User Story:** As a plugin author, I want typed, read-only subscriptions to file write/edit intent and file observation notifications, so that I can build file-policy or file-sync features against stable events.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `fs/write-intent` SHALL be cataloged as a `waterfall` event with payload `{target, exec}` where `target = {targetKey, displayPath}`.
2. WHEN a plugin reads the catalog, THEN `fs/edit-intent` SHALL be cataloged as a `waterfall` event with payload `{target, exec}`.
3. WHEN a plugin reads the catalog, THEN `fs/observed` SHALL be cataloged as an `emit` event with payload `{target, observation, actor}` and `observation.kind: 'present' | 'absent'`.
4. WHEN any of `fs/write-intent`, `fs/edit-intent`, `fs/observed` is dispatched, THEN a facade-registered listener SHALL receive the official payload object deep-frozen per section 4, and the official dispatch semantics (waterfall chain or emit) SHALL be preserved.
5. WHEN the facade stabilizes these events, THEN it SHALL NOT reorder or alter the official dispatch; it SHALL only expose typed subscription with the facade guarantees.

**Type:** A（官方 `dsh-tool-fs` 已 dispatch；`fs/write-intent` L658、`fs/edit-intent` L809、`fs/observed` L278）

---

### 9. Subagent lifecycle event stabilization (O4, O5)

**User Story:** As a plugin author, I want typed subscriptions to subagent start/end and provider add/remove events, so that I can track subagent activity without raw Cordis wiring.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `subagent/start` SHALL be cataloged as an `emit` event with payload `{runId, provider, id, local}`.
2. WHEN a plugin reads the catalog, THEN `subagent/end` SHALL be cataloged as an `emit` event with payload `{runId, provider, id, local, stopReason, lastAssistantMessage?}`.
3. WHEN a plugin reads the catalog, THEN `subagent/provider-added` SHALL be cataloged as an `emit` event with payload `provider`.
4. WHEN a plugin reads the catalog, THEN `subagent/provider-removed` SHALL be cataloged as an `emit` event with payload `providerName`.
5. WHEN any event in this section is dispatched, THEN a facade-registered listener SHALL receive the official payload deep-frozen per section 4 and the official emit semantics SHALL be preserved.

**Type:** A（官方 `dsh-subagent` 已 dispatch；`subagent/start|end` L199–250，`provider-added|removed` L2474–2476）

---

### 10. Workflow event stabilization (O6)

**User Story:** As a plugin author, I want typed subscriptions to workflow lifecycle events, so that I can observe workflow runs in a stable way.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN each of `workflow/start`, `workflow/phase`, `workflow/log`, `workflow/agent-start`, `workflow/agent-end`, `workflow/end` SHALL be cataloged as an `emit` event with a payload type reference matching the official `dsh-workflow-worker-thread` emit points.
2. WHEN any workflow event is dispatched, THEN a facade-registered listener SHALL receive the official payload deep-frozen per section 4 and the official emit semantics SHALL be preserved.
3. WHEN the facade stabilizes these events, THEN it SHALL NOT add, remove, or rename any of the six workflow event names.

**Type:** A（官方 `dsh-workflow-worker-thread` 已 dispatch；L895–909）

---

### 11. Approval request waterfall stabilization (O7)

**User Story:** As a plugin author, I want to participate in the approval request waterfall through the typed bus, so that my approval policy receives the same request and fail-closed guarantees as official approval listeners.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `approval/request` SHALL be cataloged as a `waterfall` event with `scopeFiltered: true` and payload `req` of shape `{agent, toolName, callId?, reason?, signal}`.
2. WHEN `approval/request` is dispatched, THEN facade-registered waterfall listeners SHALL receive the frozen `req` payload and SHALL participate with the same waterfall semantics as official `ctx.waterfall('approval/request', req)`.
3. WHEN a facade-registered listener returns an outcome, THEN the outcome SHALL be one of `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`, and SHALL be passed along the waterfall unchanged in semantics.
4. WHEN no facade-registered listener produces an outcome, THEN the facade SHALL NOT alter the official fail-closed default behavior.
5. WHEN a listener subscribes with `opts.scope`, THEN the scope filtering rules of section 5 SHALL apply.

**Type:** A（官方 `dsh-user-approval` L189 已 dispatch；scope 权威表 `dsh-scope/lib/invariant.js`）

---

### 12. Change notification event stabilization (O9–O12)

**User Story:** As a plugin author, I want typed subscriptions to command/skill/credential/goal change notifications, so that my plugin can react to configuration and goal changes without raw event wiring.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `commands/change` SHALL be cataloged as an `emit` event.
2. WHEN a plugin reads the catalog, THEN `skills/change` SHALL be cataloged as an `emit` event.
3. WHEN a plugin reads the catalog, THEN `credentials/updated` SHALL be cataloged as an `emit` event.
4. WHEN a plugin reads the catalog, THEN `goal/changed` SHALL be cataloged as an `emit` event with `scopeFiltered: true` and payload `{agent, change}`.
5. WHEN any event in this section is dispatched, THEN a facade-registered listener SHALL receive the official payload deep-frozen per section 4 and the official emit semantics SHALL be preserved.
6. WHEN a listener subscribes to `goal/changed` with `opts.scope`, THEN the scope filtering rules of section 5 SHALL apply.

**Type:** A（官方 `dsh-commands` L348、`dsh-skill` L404、`dsh-credentials` L45、`dsh-goal` L793 已 dispatch）

---

### 13. Web provider service passthrough (O15)

**User Story:** As a plugin author, I want to register web search/fetch providers through `pluginApi.web`, so that I extend web capabilities through the facade instead of importing the `dsh-web` package.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.web.registerSearchProvider(provider)`, THEN the facade SHALL invoke the official `web` service method `registerSearchProvider` with the same argument and SHALL return its return value unchanged.
2. WHEN a plugin calls `pluginApi.web.registerFetchProvider(provider)`, THEN the facade SHALL invoke the official `web` service method `registerFetchProvider` with the same argument and SHALL return its return value unchanged.
3. WHEN the official `web` service is unavailable or the feature is disabled, THEN these methods SHALL produce the foundation-defined typed error and SHALL NOT call into official services.
4. WHEN the facade handles these calls, THEN it SHALL NOT wrap, cache, or alter the provider objects.

**Type:** A（官方 `dsh-web` 服务直通；`registerSearchProvider` / `registerFetchProvider` L67–77）

---

### 14. Session telemetry record stabilization (O16)

**User Story:** As a plugin author, I want a typed waterfall subscription to `session-telemetry/record`, so that I can observe or transform telemetry records through the facade.

**Acceptance Criteria:**

1. WHEN a plugin reads the catalog, THEN `session-telemetry/record` SHALL be cataloged as a `waterfall` event with payload `{record}`.
2. WHEN `session-telemetry/record` is dispatched, THEN facade-registered waterfall listeners SHALL receive the frozen `{record}` payload and SHALL participate with the same waterfall semantics as official `ctx.waterfall('session-telemetry/record', {record})`.
3. WHEN the facade stabilizes this event, THEN it SHALL NOT alter the official waterfall semantics or the record payload shape.

**Type:** A（官方 `dsh-session-telemetry` L174 已 dispatch）

---

### 15. Testability and regression coverage

**User Story:** As a maintainer, I want all 25 features covered by `node --test` with mocked Cordis/official services, so that the M1 event bus and host event stabilizations are regression-safe without booting a real harness.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN tests SHALL cover subscription/disposal semantics for `on` and `once` (E1/E2) and dispatch delegation for `emit/serial/parallel/bail/waterfall` (E3–E7) using a mocked Cordis context.
2. WHEN `node --test` runs, THEN tests SHALL cover priority ordering across all six tiers, stable order within a tier, monitor observe-only behavior, and invalid-priority rejection (E8).
3. WHEN `node --test` runs, THEN tests SHALL cover deep-frozen payloads for object payloads and waterfall replacement values (E9).
4. WHEN `node --test` runs, THEN tests SHALL cover scope-filtered delivery for catalog events marked `scopeFiltered` and global delivery when `opts.scope` is omitted (E10).
5. WHEN `node --test` runs, THEN tests SHALL cover contained listener errors for every dispatch mode and assert that the dispatch continues and does not reject/throw (E11).
6. WHEN `node --test` runs, THEN tests SHALL assert the catalog contains exactly the event names required by AC 7.3, each entry has the required metadata, and the catalog is read-only (E12).
7. WHEN `node --test` runs, THEN tests SHALL cover each stabilized host event in sections 8–12 and 14 by asserting the catalog entry mode/payload metadata and by dispatching a mocked official event and observing the frozen payload in a facade listener.
8. WHEN `node --test` runs, THEN tests SHALL cover `pluginApi.web` passthrough return values and the unavailable-service error path (O15).
9. WHEN `node --test` runs, THEN tests SHALL cover the inactive/feature-disabled error paths for subscription, dispatch, and service passthrough, and SHALL assert that applying the facade never throws (fail-safe).
10. GIVEN a mocked Cordis context and mocked official services, WHEN `node --test` runs, THEN no test SHALL require booting a real harness.

**Type:** 质量门
