# Requirements: plugin-api-agent-create-m2

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.agent`（`create/resume/register/provider/availability`） | `pluginApi.agents`（provider 叶子改复数 `providers`） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

> feature_name: `plugin-api-agent-create-m2`
> 状态：已完成（Stage 4）
> 上游：`plugin-api-foundation`、`plugin-api-facade-integrity`、`plugin-api-agent-m1`、`plugin-api-m1-integration`
> 面：仅 host；不新增 client bundle、remote、codec、slot 或 settings bridge
> 分类：A11 的所有公开成员均为 A 类同参直通；不新增 B 类转译、事件 catalog slice 或 C 类 upstream proposal

---

## Introduction

M1 的 `pluginApi.agent` 已提供 `get`、`list`、`roots` 三个注册表读面，以及官方
`agent/*` 生命周期事件的稳定订阅。A11 扩展同一 host 命名空间，使插件不必直接依赖
`dsh-agent` 即可创建、恢复或注册自己负责的 Agent。

本 feature 固定两层公共 API，避免把官方的有序发布原语误导为一般插件的普通创建接口：

| 层级 | 公共成员 | 适用对象 | 支持定位 |
|---|---|---|---|
| Consumer | `agent.create(options)`、`agent.resume(options)`、`agent.register(agent)` | 拥有创建所得 `AgentHandle` 的普通 host 插件，或注册自己已构造 Agent 的基础设施插件 | 推荐、受支持入口 |
| Provider | `agent.provider.enter(agent, owner)`、`agent.provider.announce(agent)`、`agent.provider.setFactory(factory)` | 实现 Agent provider、loop 或受控有序生命周期的高级 host 插件 | 受支持但高级的 provider-only 原语，不是普通创建 API |

A11 的 member availability 通过只读 `agent.availability` 表达，其稳定形状为
`{ create, resume, register, provider: { enter, announce, setFactory } }`，其中每个叶值为 boolean。
`agent.provider.isActive` 仅在三个 provider member 都可用时为 `true`。Factory 是否已经安装、占用或
之后被 disposer 清除是官方运行时槽位状态，不改变任何 A11 member 的 capability availability。成员
不可用时，声明的成员仍存在并走 M1 P2：抛出 `PluginApiFeatureDisabledError('agent')`，其说明必须命名
不可用 member。这个 A11 member availability 是对 mandatory `agent` feature 内部能力的可观察状态，
不是 `services.*` 的 P4 per-member disabled facade，也不引入新的错误类别。

`create`、`resume`、`register`、`enter`、`announce`、`setFactory` 均对应官方
`AgentRegistry` 已公开的 A 类方法。本 feature 不重建 factory，不创建 Agent loop，不改变
`agent/created` 或 `agent/disposed` 的派发语义，也不暴露 subagent provider API（该能力仍属于
`pluginApi.services.subagents`）。

---

## 1. Public surface and capability levels (A11)

**User Story:** As a host plugin author, I want a clearly tiered agent creation surface, so that I
can use ordinary creation APIs without accidentally taking responsibility for provider lifecycle
ordering.

**Acceptance Criteria:**

1. WHEN the core and M1 agent registry read surface are active, THEN `pluginApi.agent` SHALL retain
   its existing `get`、`list`、`roots` members and SHALL additionally declare the consumer members
   `create`、`resume`、`register`, the `provider` namespace, and the read-only `availability` table
   defined in this introduction.
2. WHEN `pluginApi.agent.provider` is read, THEN it SHALL declare exactly the advanced members
   `enter`、`announce`、`setFactory` and the boolean `isActive`, and SHALL NOT expose another alias
   for any provider-only primitive.
3. WHEN a plugin reads the consumer members or their availability state, THEN the public API
   documentation and typed disabled-error diagnostic SHALL identify `create`、`resume`、and `register`
   as supported consumer-facing creation or registration members.
4. WHEN a plugin reads a provider member, `agent.provider.isActive`, or an unavailable provider-member
   error, THEN the public API documentation and typed disabled-error diagnostic SHALL identify
   `enter`、`announce`、and `setFactory` as advanced provider-only primitives and SHALL state that
   ordinary plugins use `create`、`resume`、or `register` instead.
5. WHEN this feature exposes the provider namespace, THEN it SHALL NOT place `enter`、`announce`、or
   `setFactory` directly beside the consumer methods as an undifferentiated recommended API.
6. WHEN a plugin uses any A11 member through the facade, THEN the facade SHALL NOT require an import
   of an official module-private variable or a concrete `dsh-agent-loop` implementation.
7. WHEN this feature is active, THEN it SHALL NOT add an `agent/*` event, alter an existing event
   catalog entry, synthesize a lifecycle notification, or subscribe to replace the official
   registry's publication path.

**Type:** A（官方 `AgentRegistry` 服务公开方法；门面仅稳定化和分级，不转译生命周期。）

---

## 2. Consumer creation and restoration passthrough

**User Story:** As a plugin that owns an agent it creates or restores, I want `create` and `resume`
to preserve official factory, ownership, setup, rollback, and handle semantics exactly.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.agent.create(options)`, THEN the facade SHALL invoke the official
   `agents.create(options)` with the exact supplied `options` value and SHALL return the exact
   Promise returned by that invocation.
2. WHEN a plugin calls `pluginApi.agent.resume(options)`, THEN the facade SHALL invoke the official
   `agents.resume(options)` with the exact supplied `options` value and SHALL return the exact
   Promise returned by that invocation.
3. WHEN either consumer creation Promise resolves to an `AgentHandle`, THEN the facade SHALL return
   that exact `AgentHandle` object without wrapping, cloning, proxying, freezing, or replacing its
   `agent` or `dispose` members.
4. WHEN a consumer calls `AgentHandle.dispose()` obtained through `create` or `resume`, THEN the
   facade SHALL leave the official handle's ownership and exact teardown semantics intact; it SHALL
   NOT call, delay, memoize, replace, or otherwise mediate `dispose()`.
5. WHEN `create` or `resume` is called from an injected third-party plugin context, THEN the facade
   SHALL preserve the official caller-fiber ownership attribution for the factory transaction and
   resulting handle; the facade host/plugin provider SHALL NOT become a replacement consumer owner.
6. WHEN the registered official factory is absent, creation setup fails, a same-id publication loses
   the official collision arbitration, persistence is unavailable, or an official creation signal
   cancels unpublished work, THEN `create` or `resume` SHALL expose the exact official rejection or
   error without changing its value, timing, rollback behavior, or lifecycle publication semantics.
7. WHEN a creation or restoration succeeds, THEN the facade SHALL preserve every official lifecycle
   publication caused by that operation, including applicable session creation, `agent/created`,
   `agent/session-start`, and their official order; it SHALL NOT add a registration, session insertion,
   lifecycle publication, or loop start.
8. WHEN official creation or restoration rolls back after any publication has begun, THEN the facade
   SHALL preserve the official rollback and paired lifecycle-disposal behavior without adding,
   suppressing, or reordering an event.
9. WHEN a plugin holds only a bare Agent obtained from `agent.get`、`list`、or `roots`, THEN the
   facade SHALL NOT provide a replacement disposal capability; consumer teardown SHALL remain
   limited to the `AgentHandle` returned by official `create` or `resume`.

**Type:** A（官方 `AgentRegistry.create` / `resume` 与 `AgentHandle`；factory、setup、rollback
及 consumer ownership 均由官方实现拥有。）

---

## 3. Registration passthrough and disposer identity

**User Story:** As an infrastructure plugin with an already-constructed Agent, I want to register
it through the facade without weakening official registration ordering or disposer identity.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.agent.register(agent)`, THEN the facade SHALL invoke the official
   `agents.register(agent)` with the exact supplied Agent object and SHALL return the exact disposer
   returned by that invocation.
2. WHEN the official `register` disposer is called, THEN the facade SHALL preserve its official
   single-shot, caller-fiber lifecycle, exact-entry removal, and paired `agent/disposed` semantics;
   it SHALL NOT wrap, compose, defer, duplicate, or replace that disposer.
3. WHEN the official registry rejects registration because the supplied Agent conflicts with an
   existing live id or violates another official precondition, THEN the facade SHALL propagate the
   exact official error and SHALL NOT create a partial facade registration or compensating event.
4. WHEN registration succeeds, THEN the facade SHALL preserve the official ordered behavior in
   which the supplied Agent is entered and then announced; it SHALL NOT emit an additional
   `agent/created` notification or independently call a provider primitive.
5. WHEN a plugin registers an Agent through the facade, THEN the facade SHALL NOT clone, freeze,
   proxy, replace, or retain an ownership-equivalent copy of that Agent.

**Type:** A（官方 `AgentRegistry.register`；返回的 Cordis effect disposer identity 和销毁顺序
为 load-bearing 官方契约。）

---

## 4. Advanced ordered lifecycle provider surface

**User Story:** As an Agent provider or loop integration author, I want explicit access to the
official ordered lifecycle primitives, so that I can own an unpublished setup and publication
transaction without the facade inventing a second lifecycle model.

**Acceptance Criteria:**

1. WHEN an advanced provider calls `pluginApi.agent.provider.enter(agent, owner)`, THEN the facade
   SHALL invoke official `agents.enter(agent, owner)` with both exact supplied references, including
   `owner === undefined` for a root, and SHALL return the exact detach disposer from that invocation.
2. WHEN the detach disposer returned by `provider.enter` is called, THEN the facade SHALL preserve
   the official idempotence, exact-entry protection, deferred removal during synchronous
   `agent/created` dispatch, and paired disposal behavior; it SHALL NOT wrap or replace the disposer.
3. WHEN an advanced provider calls `pluginApi.agent.provider.announce(agent)`, THEN the facade SHALL
   invoke official `agents.announce(agent)` with the exact supplied Agent and SHALL preserve its
   return value unchanged.
4. WHEN `provider.enter` succeeds, THEN the facade SHALL leave the Agent unpublished until the
   provider explicitly calls `provider.announce`; the facade SHALL NOT announce automatically or
   insert an implicit lifecycle boundary.
5. WHEN `provider.announce` is called before a matching enter, against a non-exact live entry, or
   after announcement has begun or completed, THEN the facade SHALL propagate the exact official
   error and SHALL NOT retry, suppress, or convert it into a successful lifecycle operation.
6. WHEN a provider calls `pluginApi.agent.provider.setFactory(factory)`, THEN the facade SHALL invoke
   official `agents.setFactory(factory)` with the exact supplied factory reference and SHALL return
   the exact disposer from that invocation.
7. WHEN an official factory is already registered, THEN `provider.setFactory` SHALL preserve the
   official single-provider constraint and exact error; the facade SHALL NOT replace, chain, hide,
   or automatically dispose the existing factory.
8. WHEN the disposer returned by `provider.setFactory` is called, THEN the facade SHALL preserve the
   official factory-slot teardown semantics. Factory-slot teardown SHALL NOT change the availability
   of `provider.setFactory` or any other declared provider member, and the facade SHALL NOT retain a
   wrapper or stale facade-owned provider capability.
9. WHEN an advanced provider uses `enter`、`announce`、or `setFactory`, THEN the facade SHALL NOT
   construct an Agent factory, create a loop, infer an owner from durable session lineage, or alter
   the official `agent/created` / `agent/disposed` dispatch order.

**Type:** A（官方 `AgentRegistry.enter` / `announce` / `setFactory`；这些原语是 provider-owned
有序生命周期，而不是门面重实现。）

---

## 5. Per-member availability and fail-safe behavior

**User Story:** As an operator, I want safe consumer capabilities to remain usable when a higher
risk optional registry member is absent, while unavailable members remain explicit and never fall
through to raw host failures.

**Acceptance Criteria:**

1. GIVEN the official `agents` service or any M1-required registry read member is unavailable,
   malformed, or throws during mandatory guard probing, WHEN the agent feature is evaluated, THEN
   `pluginApi.agent` SHALL retain the M1 P2 disabled surface and every A11 member SHALL raise
   `PluginApiFeatureDisabledError('agent')` before accessing an official registry method.
2. GIVEN the core facade is inactive, WHEN any consumer or provider A11 member is called, THEN it
   SHALL raise `PluginApiInactiveError` before accessing an official registry method.
3. GIVEN the M1 agent registry read surface is active, WHEN one A11 official method is unavailable,
   malformed, or throws during its capability probe, THEN `agent.availability` SHALL report only that
   named member as unavailable, the declared member SHALL remain present, every independently verified
   M1 or A11 member SHALL remain available, and the facade SHALL NOT disable the whole `agent` feature
   solely because of that missing A11 member.
4. WHEN an A11 member reported unavailable by `agent.availability` is called while the core and agent
   feature remain active, THEN it SHALL raise `PluginApiFeatureDisabledError('agent')` with a diagnostic
   that names the unavailable member, SHALL NOT access the official registry, and SHALL NOT be silently
   omitted from the public namespace.
5. WHEN every provider member is available, THEN `agent.provider.isActive` SHALL be `true`; WHEN one
   or more provider members are unavailable, THEN `agent.provider.isActive` SHALL be `false`,
   `agent.availability.provider` SHALL identify the unavailable member or members, and every
   independently verified provider member SHALL retain its defined behavior.
6. WHEN `create` or `resume` is available but no factory is currently registered, THEN the facade
   SHALL keep the member available and SHALL defer to the official call-time no-factory error rather
   than treating temporary factory absence as a facade capability failure.
7. WHEN `setFactory` is available but another factory already occupies the official slot, THEN the
   facade SHALL keep the member available and SHALL defer to the official call-time single-provider
   error rather than treating slot occupancy as a facade capability failure.
8. WHEN a facade-owned A11 guard, mount, capability probe, facade call-time service resolution, or
   facade-owned cleanup path fails internally, THEN the facade SHALL contain that host-lifecycle
   failure, record a readable diagnostic without sensitive Agent/session payload data, and SHALL NOT
   throw through plugin `apply()` or disable an unrelated facade feature. This containment SHALL NOT
   intercept or alter a returned `AgentHandle.dispose()` call, an official registration/factory/enter
   disposer call, or an official A11 method's error or rejection.
9. WHEN a member-specific A11 degradation is recorded repeatedly for the same feature, member, and
   lifecycle phase, THEN the facade SHALL NOT produce duplicate diagnostics for that failure
   identity.

**Type:** 门面基础（继承 M0 fail-safe 与 M1 P1/P2 失败呈现；A11 在 M1 agent feature 内增加
显式的 per-member degradation，不创建新的官方生命周期语义。）

---

## 6. Identity, error, and publication preservation

**User Story:** As a provider and consumer, I want the facade to be observationally transparent,
so that lifecycle ownership and official publication behavior do not change merely because I use
the supported facade.

**Acceptance Criteria:**

1. WHEN any A11 method invokes its official counterpart, THEN the facade SHALL preserve the exact
   supplied argument references, the official receiver/consumer context required for ownership, and
   the exact synchronous return value, Promise, `AgentHandle`, Agent reference, or disposer returned
   by that counterpart.
2. WHEN any A11 method throws synchronously or returns a Promise that rejects, THEN the facade SHALL
   propagate the exact official error or rejection reason without wrapping, translating, logging it
   as a facade containment, or changing settlement timing.
3. WHEN an A11 method returns a disposer or handle, THEN the facade SHALL NOT add a second disposer,
   attach cleanup to a facade-owned lifecycle, or change the official owner that controls agent,
   session, factory, or provider teardown. The facade SHALL NOT intercept calls to that returned
   disposer or handle's `dispose()` method.
4. WHEN official `create`、`resume`、`register`、`enter`、`announce`、or teardown causes an existing
   agent or session lifecycle publication, THEN the facade SHALL preserve every such official dispatch,
   including `agent/created`, `agent/session-start`, `agent/disposed`, and applicable session lifecycle
   events, with the official listener ordering, scope carrier, sync-veto behavior, async rejection
   handling, fault policy, rollback pairing, and relative publication order unchanged.
5. WHEN a direct official caller and a facade caller supply equivalent inputs under equivalent Cordis
   ownership, THEN their observable registry membership, factory-slot behavior, caller-fiber/effect
   ownership, returned identities, lifecycle publication order, and error outcomes SHALL be equivalent.

**Type:** A（A11 是透明的官方服务直通；identity 与 publication preservation 是该稳定门面的
核心验收边界。）

---

## 7. Parallel integration boundary

**User Story:** As an M2 integrator, I want A11's facade extension to coexist with exec-route work,
so that independently delivered agent capabilities do not overwrite each other or create competing
construction paths.

**Acceptance Criteria:**

1. WHEN A11 is implemented in parallel with `plugin-api-exec-route-m2`, THEN A11 SHALL own only the
   consumer creation and provider lifecycle members defined by this specification and SHALL NOT add,
   remove, or implement `agent.routeOf`.
2. WHEN A11 and exec-route are integrated, THEN `pluginApi.agent` SHALL expose both approved feature
   surfaces without either feature reconstructing, replacing, or discarding the other feature's
   facade members.
3. WHEN implementation requires a shared change to the existing agent facade construction boundary,
   guard framework, core error model, event bus, catalog composition, or M1 lifecycle behavior, THEN
   A11 SHALL record a coordinated integration issue and SHALL defer that change to the coordinated
   integration path; during parallel delivery A11 SHALL NOT rewrite the shared agent facade
   construction boundary.
4. WHEN A11 mounts, THEN it SHALL preserve the established M1 mount order and SHALL NOT introduce an
   artificial runtime dependency on exec-route, semantic-hooks, or another unrelated M2 feature.
5. WHEN the A11 implementation is integrated, THEN it SHALL retain M1 `agent.get`、`list`、`roots`
   behavior and SHALL NOT regress any established `agent/*` event contract.

**Type:** 门面整合约束（A11 本身仍为 A 类；本节限定并行开发的 ownership boundary。）

---

## 8. Verification and documentation synchronization

**User Story:** As a maintainer, I want focused regression coverage and accurate documentation, so
that A11 remains a reliable supported boundary as official AgentRegistry details evolve.

**Acceptance Criteria:**

1. WHEN `node --test` runs with mocked Cordis contexts and an official registry double, THEN tests
   SHALL verify that `create` and `resume` forward the exact options reference, preserve returned
   Promise and resolved `AgentHandle` identity, preserve caller ownership attribution, introduce no
   duplicate lifecycle publication or disposal, and preserve applicable session creation,
   `agent/created`, `agent/session-start`, rollback pairing, and official relative publication order.
2. WHEN `node --test` runs, THEN tests SHALL verify that `register` forwards the exact Agent and
   preserves its exact disposer identity, single-shot behavior, caller-fiber/effect ownership,
   official registration error, and official created/disposed pairing.
3. WHEN `node --test` runs, THEN tests SHALL verify `provider.enter` with an explicit owner and
   `undefined` root owner, `provider.announce`, and `provider.setFactory`, including exact argument,
   return/disposer identity, caller-fiber/effect ownership, ordered publication, invalid announce
   error, duplicate-id error, single-factory error propagation, and factory-slot removal without
   changing `setFactory` capability availability.
4. WHEN `node --test` runs, THEN tests SHALL verify the availability matrix: inactive core P1;
   missing M1-required registry surface P2 for all agent members; the defined `agent.availability`
   table; one missing consumer member does not disable verified members; and one missing provider
   member leaves verified consumer and provider members observable with a P2 typed failure that names
   the unavailable `agent` member.
5. WHEN `node --test` runs, THEN tests SHALL verify that a missing factory and an occupied official
   factory slot are propagated as official call-time outcomes rather than incorrectly reported as
   facade capability disablement.
6. WHEN `node --test` runs, THEN tests SHALL verify that a facade-owned A11 guard, mount, capability
   probe, facade call-time service resolution, or facade-owned cleanup failure cannot throw through
   `apply()`, cannot disable unrelated features, and produces at most one redacted diagnostic for a
   repeated member/lifecycle failure identity; tests SHALL also verify that returned
   `AgentHandle.dispose()` and official registry/provider disposer calls are not intercepted by that
   containment path.
7. WHEN `node --test` runs, THEN tests SHALL verify that M1 `get`、`list`、`roots` and the established
   `agent/created` / `agent/disposed` event behavior remain unchanged after A11 is mounted.
8. WHEN this feature reaches Stage 4 delivery, THEN `docs/specs/plugin-api-features/feature-list.md`
   SHALL mark A11 delivered with the approved consumer/provider API shape, and `AGENTS.md` section 8
   SHALL record the delivered feature, its A11 scope, and its ownership/identity constraints.
9. WHEN the full A11 implementation is complete, THEN the complete repository `node --test` suite
   SHALL pass without requiring a real DSH harness boot.

**Type:** 质量门 / 文档同步。

---

## Host / Client coverage

- **Host:** This feature exposes only `pluginApi.agent` host capabilities described in sections 1-6.
- **Client:** This feature SHALL NOT add a client plugin, remote contribution, codec, slot, browser
  dependency, or client-side Agent lifecycle operation.

## Non-goals

- Reimplementing an Agent factory, constructing a new Agent loop, or replacing the official loop.
- Modifying official DSH package files or importing official module-private state.
- Wrapping an `AgentHandle`, its `dispose` method, or an official registry/provider disposer.
- Changing `agent/created`, `agent/disposed`, or any other M1 `agent/*` event semantics.
- Implementing A9/T10 route derivation, A10's upstream route API, subagent provider APIs, or another
  M2 semantic translation.
- Adding a client-side creation, restoration, registration, or provider lifecycle API.
