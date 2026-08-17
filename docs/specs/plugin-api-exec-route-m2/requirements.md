# Requirements: plugin-api-exec-route-m2

> feature_name: `plugin-api-exec-route-m2`
> 状态：草案（Stage 1，待用户评审）
> 上游：`plugin-api-semantic-hooks-m2`（共同 B 类契约）、`plugin-api-agent-m1`、`plugin-api-tools-m1`、`plugin-api-session-m1`
> 面：仅 host；不新增 client bundle、remote、codec 或 settings bridge
> 分类：A9 + T10 为 B 类语义转译；既有 `tools/*` 生命周期事件保持 A 类

---

## Introduction

DSH 的 `ToolExecution` 没有官方的 `exec.route` 字段。插件直接读取
`exec.agent.session.requestContext()`、`requestHeader()` 或 `agent.options`，会把官方
对象布局当作 API，也容易使 agent 查询面与 tools 事件面形成两个不同的推导规则。

本 feature 建立一个权威、只读的 `RouteSnapshot`，并通过
`pluginApi.agent.routeOf(exec)`（A9）和 `pluginApi.tools.routeOf(exec)`（T10）提供同一
执行期快照。两个入口是同一能力在各自领域命名空间的查询面，不是两套路由算法。
`exec` 本身不获得新字段或其他可见变更。

本能力是 **B 类**：它在已存在的 A 类 `tools/pre-execute` 生命周期中，读取公开的
`Session.requestContext()` 读面以构造门面语义。它不创建新的原生 DSH dispatch，
也不声称 DSH 已提供官方 `exec.route`。A10（官方 route API）仍为 M4 的 C 类上游
proposal，不由本 feature 实施。

### Fidelity boundary

`Session.requestContext()` 仅表示一个 session **最近已提交**的 `request/context`。
DSH 的公开接口没有将某个 `ToolExecution` 因果绑定到某一条 request-context 记录的
字段。因此本 feature 的快照仅陈述“在该执行首次进入受支持工具生命周期时可读取的
最近已提交 route”；它不是永久模型配置，也不得被表述为已证明的逐调用因果归属。
没有可用 route 时，门面不得从 `requestHeader()`、`Agent.options`、配置默认值或其他
私有形状臆造一个 route。

---

## 1. Public route surface and snapshot shape (A9, T10)

**User Story:** As a plugin author, I want one stable route-query API on the agent and tools
surfaces, so that I can inspect the model route of a current tool execution without reading
DSH internals.

**Acceptance Criteria:**

1. GIVEN the core and exec-route feature are active, WHEN a plugin calls
   `pluginApi.agent.routeOf(exec)` or `pluginApi.tools.routeOf(exec)` with an execution
   observed by a supported tools lifecycle event, THEN the facade SHALL return either the
   execution's `RouteSnapshot` or `undefined` according to sections 2 and 4.
2. WHEN either public entry point returns a route, THEN the route SHALL have exactly the
   public shape `Readonly<{ provider: string, model: string }>` and SHALL NOT expose a live
   `Session`, `Agent`, `RequestContext`, request header, model-info object, credential, or
   additional route/configuration field.
3. WHEN the facade creates a `RouteSnapshot`, THEN `provider` and `model` SHALL each be a
   non-empty string from the public resolved request-context route, and the facade SHALL NOT
   coerce a missing, non-string, or empty value into a partial or default route.
4. WHEN a `RouteSnapshot` is returned, THEN the snapshot and its reachable data SHALL be
   read-only, and a caller's attempted mutation SHALL NOT alter any later result, official
   object, or other listener's observation.
5. WHEN both public entry points are queried for the same execution during its supported
   lifecycle, THEN they SHALL return the same route outcome; when that outcome is present,
   they SHALL return the same frozen snapshot instance.
6. WHEN a plugin calls either entry point with an execution that was not observed in a
   supported tools lifecycle, THEN the facade SHALL return `undefined`, SHALL NOT inspect
   arbitrary object paths to derive a route, and SHALL NOT throw merely because that input is
   unknown or malformed.
7. WHEN the facade exposes these entry points, THEN it SHALL NOT expose `exec.route`, a
   writable route setter, a route-rewrite operation, or another route-query alias.

**Type:** B（A9 + T10；门面从公开 session read surface 转译稳定 snapshot，官方没有
`exec.route` dispatch 或字段。）

---

## 2. Single source of truth and capture timing

**User Story:** As a plugin author, I want agent and tools consumers to observe one execution
snapshot captured at a defined time, so that later session changes cannot make the two surfaces
disagree.

**Acceptance Criteria:**

1. WHEN an eligible official tool execution first reaches `tools/pre-execute`, THEN the
   facade SHALL attempt route resolution once before a facade-registered listener can query
   that execution in that lifecycle stage.
2. WHEN the same eligible execution is observed again at `tools/pre-execute`, THEN the facade
   SHALL reuse its already captured route outcome, SHALL NOT re-read its request context or
   re-run route resolution, and SHALL NOT create a duplicate diagnostic; this capture path
   SHALL NOT re-enter the `tools/pre-execute` substrate.
3. GIVEN an eligible execution has an official `exec.agent` with a readable public session
   request context, WHEN that context supplies valid `provider` and `model` values, THEN the
   facade SHALL capture one `RouteSnapshot` from those values for that execution.
4. GIVEN an eligible execution has no agent, no readable session, no request context, or a
   request context without valid values for both required fields, WHEN it first reaches
   `tools/pre-execute`, THEN the facade SHALL capture the missing-route outcome `undefined`
   for that execution and SHALL NOT derive a fallback route from another source.
5. WHEN an execution's route outcome has been captured, THEN every later query for that
   execution in `tools/execute`, `tools/post-execute`, and `tools/result` SHALL reuse that
   outcome and SHALL NOT re-read the session or independently re-derive provider/model.
6. WHEN the session's latest request context changes after an execution's route outcome was
   captured, THEN the captured outcome for that execution SHALL remain unchanged.
7. WHEN two executions share an agent or session, THEN the facade SHALL capture and retain
   each execution's route outcome independently, and one execution's capture SHALL NOT
   overwrite, suppress, or become the result for the other.
8. WHEN an execution never reaches `tools/pre-execute`, including an official path that
   bypasses that event, THEN the facade SHALL NOT manufacture a route during a later tools
   stage, and both query entry points SHALL return `undefined` for that execution.
9. WHEN the facade documents or reports a non-`undefined` route, THEN it SHALL describe the
   value as an execution-time snapshot of the latest publicly committed request context and
   SHALL NOT claim that the value is a permanent agent configuration or a proven causal binding
   to a particular model request.

**Type:** B（公开 substrate 为 A 类 `tools/pre-execute` 与 `Session.requestContext()`；
capture timing 和跨阶段缓存是门面转译语义。）

---

## 3. Tools lifecycle availability without official-object mutation (T10)

**User Story:** As a tools-event listener author, I want to query a route snapshot at every
supported execution stage without mutating the official execution object or changing tool
pipeline semantics.

**Acceptance Criteria:**

1. GIVEN a facade listener receives an eligible `exec` in `tools/pre-execute`, WHEN it calls
   either route-query entry point, THEN the facade SHALL make the captured route outcome
   available during that listener invocation.
2. GIVEN a facade listener receives the same eligible execution in `tools/execute`,
   `tools/post-execute`, or `tools/result`, WHEN it calls either route-query entry point,
   THEN the facade SHALL make the same previously captured route outcome available during that
   listener invocation.
3. WHEN the facade provides route availability to tools listeners, THEN it SHALL NOT assign,
   define, delete, proxy, clone, or otherwise mutate a property or symbol on `exec`,
   `exec.agent`, the agent session, or the request-context object.
4. WHEN `tools/pre-execute`, `tools/execute`, `tools/post-execute`, or `tools/result` is
   dispatched, THEN the facade SHALL preserve the existing official dispatch mode, ordering,
   scope filtering, freeze policy, signal-replacement contract, result semantics, and listener
   fault policy specified by `plugin-api-tools-m1` and `plugin-api-events-m1`.
5. WHEN this feature is active, THEN `pluginApi.events.catalog` SHALL NOT gain an
   `exec.route`, `agent/route`, `tools/route`, or other synthetic route-event entry; the four
   existing tools lifecycle events SHALL remain cataloged as their established A-class events.
6. WHEN a route query returns `undefined` in a tools listener, THEN the facade SHALL not deny,
   ask, block, replace, retry, or otherwise alter the official tool operation or result.

**Type:** B（T10 暴露为 helper 查询，不把 B 类投影伪装成新的官方 event 或写入官方
`ToolExecution`。）

---

## 4. Missing route, failure, diagnostics, and disabled surface

**User Story:** As an operator and plugin author, I want missing or unavailable route data to
degrade safely and diagnostically, so that route inspection cannot break tool execution or
hide a feature outage.

**Acceptance Criteria:**

1. GIVEN a normal eligible execution has no agent, session, request context, or complete
   route, WHEN the facade captures its route outcome, THEN both public entry points SHALL
   return `undefined`, SHALL leave the official operation unchanged, and SHALL NOT emit a
   diagnostic solely for that expected absence.
2. WHEN route resolution for one eligible execution encounters an unexpected access,
   validation, or internal translation failure before a route is captured, THEN the facade
   SHALL contain that failure, SHALL record one redacted diagnostic for that execution and
   lifecycle phase, SHALL capture `undefined`, and SHALL continue the official tools operation
   unchanged.
3. WHEN the same captured missing-route or contained-failure outcome is queried repeatedly for
   one execution, THEN the facade SHALL return `undefined` without retrying route derivation
   or producing duplicate diagnostics.
4. WHEN diagnostics are recorded for this feature, THEN they SHALL identify
   `plugin-api-exec-route-m2`, a lifecycle phase, and a failure category, and SHALL NOT include
   request content, prompt text, credentials, raw request-context payloads, or private object
   dumps.
5. WHEN diagnostic logging is unavailable or itself throws, THEN the facade SHALL ignore that
   logging failure and SHALL preserve the route outcome and official tool operation behavior
   required by this section.
6. WHEN the plugin API core is inactive, THEN either route-query entry point SHALL raise
   `PluginApiInactiveError` before accessing an official service or execution object.
7. WHEN the exec-route feature is disabled because a mandatory guard, substrate probe, or mount
   step failed, THEN the feature SHALL record one redacted diagnostic for that feature and
   lifecycle failure identity, and either route-query entry point SHALL raise
   `PluginApiFeatureDisabledError('execRoute')`, SHALL not attempt route derivation, and SHALL
   not alter tool execution.
8. WHEN the same P2 disablement is re-observed for its feature and lifecycle failure identity,
   THEN the facade SHALL not produce a duplicate diagnostic.
9. WHEN the feature guard, registration, translation, cleanup, or re-apply path throws, THEN
   the feature SHALL contain the failure, SHALL not throw through host `apply()`, and SHALL not
   disable unrelated facade features or official tools behavior.

**Type:** 门面基础 / B 类 fail-safe（P1、P2 和 `plugin-api-semantic-hooks-m2` 的
default fail-open contract；不创建新的 P3/P4 路径。）

---

## 5. Lifecycle, ownership, and integration boundary

**User Story:** As a maintainer, I want one owner for route translation and an explicit first-B
facade activation gate, so that duplicate subscriptions, stale cleanup, and partial publication
cannot create conflicting route truths.

**Acceptance Criteria:**

1. WHEN the exec-route feature passes all mandatory guards and mounts, THEN it SHALL have one
   named feature owner responsible for its route capture, per-execution outcomes, diagnostics,
   public entry points, and disposer.
2. WHEN `apply()` re-enters while `featureRegistry.isActive('execRoute')` is true, THEN the
   feature SHALL not register a second route-capture path, SHALL not replace existing captured
   outcomes, and SHALL return an idempotent no-op lifecycle result.
3. WHEN the feature is disposed or disabled, THEN it SHALL detach each registration it owns,
   prevent future capture by that owner, release no longer reachable feature-owned state, and
   ensure that a stale disposer cannot detach a later active instance.
4. WHEN either `pluginApi.agent.routeOf` or `pluginApi.tools.routeOf` is invoked, THEN both
   entry points SHALL obtain their result from the same feature-owned route-resolution authority,
   and neither entry point SHALL contain an independent `requestContext()` read or fallback
   derivation branch.
5. WHEN the feature is considered for mounting, THEN its mandatory dependencies SHALL include
   the established tools lifecycle support and session request-context read surface, and a
   missing, malformed, or throwing mandatory dependency probe SHALL select the P2 disabled
   surface.
6. WHEN the feature would publish its new public facade members for the first time, THEN a
   coordinated M2 integration design SHALL first define and test a transaction/rollback boundary
   that prevents a facade member, active signal, or route-capture registration from remaining
   published after a later mount or cleanup-registration failure.
7. UNTIL the transaction/rollback boundary in AC 5.6 is approved and verified, WHEN this
   feature's implementation encounters that unresolved activation path, THEN it SHALL remain
   P2-disabled rather than publishing a partially active route API.
8. WHEN this feature is implemented in parallel with A11, THEN it SHALL own only its route
   translation and route facade additions, SHALL NOT rewrite the A11 agent-creation module, and
   SHALL record any required shared-infrastructure change as a coordinated integration issue.
9. WHEN this feature mounts, THEN it SHALL preserve existing M1 mount order and mount only after
   its declared tools and session dependencies; it SHALL not introduce an artificial ordering
   dependency on A11 or another unrelated M2 feature.

**Type:** B（owner-local lifecycle；继承 `plugin-api-semantic-hooks-m2` 的 re-apply、
disposer、P2 和首个 B facade transaction 约束。）

---

## 6. Migration and verification

**User Story:** As the maintainer of `dsh-read-image`, I want its A6 route lookup to rely on the
facade, so that it no longer depends on private Agent or Session layout while preserving safe
image-routing behavior.

**Acceptance Criteria:**

1. WHEN `dsh-read-image` migrates its A6 route lookup, THEN its supported route path SHALL call
   one documented exec-route facade entry point and SHALL NOT directly read
   `exec.agent.session.requestContext()`, `exec.agent.session.requestHeader()`,
   `exec.agent.options`, or an equivalent private nested layout to obtain provider/model.
2. GIVEN an execution with a captured `RouteSnapshot`, WHEN the migrated A6 path decides whether
   the route is image-capable, THEN it SHALL receive the same `provider` and `model` values from
   the facade snapshot that the exec-route feature captured from the public request context.
3. GIVEN an execution whose route outcome is `undefined`, WHEN the migrated A6 path runs, THEN
   it SHALL retain its documented safe missing-route behavior and SHALL NOT make tool execution
   fail merely because route data is unavailable.
4. WHEN the exec-route implementation is tested with `node --test`, THEN focused tests SHALL
   prove the exact snapshot shape and freeze guarantee, shared-entry-point identity, valid route
   capture, every missing-route condition, malformed/unexpected read failure containment, P1/P2
   behavior, and the redacted deduplicated P2 disablement diagnostic.
5. WHEN the exec-route implementation is tested with `node --test`, THEN focused lifecycle tests
   SHALL prove availability in `tools/pre-execute`, `tools/execute`, `tools/post-execute`, and
   `tools/result`; single capture despite repeated queries and repeated observation of the same
   execution at `tools/pre-execute`; no re-read or duplicate diagnostic after either repetition
   or a session context change; and independent outcomes for concurrent executions sharing a
   session.
6. WHEN the exec-route implementation is tested with `node --test`, THEN focused regression tests
   SHALL prove that official `exec`, agent, session, and request-context objects receive no route
   property or other mutation, and that each existing tools event retains its M1 fault, scope,
   freeze, signal, and dispatch semantics.
7. WHEN the exec-route implementation is tested with `node --test`, THEN focused lifecycle tests
   SHALL prove duplicate apply idempotency, disposer idempotency, stale-disposer isolation,
   contained registration failure, and no duplicate route-capture registration or diagnostic.
8. WHEN the A6 migration is complete, THEN the migration acceptance SHALL confirm that the
   obsolete deep route lookup is deleted or reduced to the documented facade call, and that the
   relevant `dsh-read-image` headless smoke test and development boot both pass.
9. WHEN implementation cannot satisfy the declared snapshot timing, shared-source, read-only,
   or fail-open guarantees using only supported public substrate, THEN it SHALL stop before
   weakening these requirements silently and SHALL request a requirements decision or classify
   the unsupported portion as C for an upstream proposal.

**Type:** 质量门 / 迁移验收。

---

## Host / Client coverage

- **Host:** `pluginApi.agent.routeOf(exec)` and `pluginApi.tools.routeOf(exec)` are host-only
  query entry points backed by one B-class route snapshot owner.
- **Client:** This feature SHALL NOT introduce a client bundle, remote namespace, codec, slot,
  settings section, or browser-side route translation. A client/wire route contract requires a
  separately approved M3 specification.

## Non-goals

- Modifying model selection, provider registration, request configuration, or route choice.
- Providing route rewriting, forcing a provider/model, or a writable `exec.route` field.
- Exposing live `Session`, `Agent`, `RequestContext`, request-header, or model-info objects as
  part of the route API.
- Falling back to `requestHeader()`, `Agent.options`, config defaults, or private official
  object layout when no public request-context route is available.
- Modifying official DSH package files, importing official module-private state, or modifying
  the official `ToolExecution` type definition.
- Adding a synthetic route event or changing the established A-class `tools/*` event catalog.
- Implementing A10's official DSH route API or its M4 upstream proposal.
- Rewriting the A11 agent-creation implementation or introducing a dependency on it.
