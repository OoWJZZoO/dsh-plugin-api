# Feature Requirements: plugin-api-session-m1

## Introduction

`plugin-api-session-m1` 是 `dsh-plugin-api` 门面的 **M1 会话命名空间 feature**，在 `ctx.pluginApi.session` 下为第三方插件提供官方 `dsh-session` 会话能力的稳定直通，合并 feature-list 中的：

- **S1**：会话生命周期事件类型化订阅（`session/created`、`session/disposed`、`session/event`、`session/flush`）；
- **S3**：会话读面（`session.get(id)`、`session.list()`、`session.fork(source, boundary?, childId?)`）；
- **S4**：会话状态访问器（`header` / `events` / `seq` / `surface`、`requestHeader()`、`requestContext()`、`deriveMessages()` 的稳定只读访问）；
- **S5**：会话事件目录（`sessionEventTypes` / `surfaceEventTypes` 常量与类型守卫）。

**类型标注**：S1、S3、S4、S5 均为 **A 类**（官方已 dispatch / 已提供服务，只需稳定化）。本 feature 不产生新的 B 类转译，也不产生新的 C 类上游提案。

**范围边界**：

- 本 feature 只覆盖 **host 侧**。client bundle、`client.remote`、slot、settings 可视化配置桥属于 M3；`sessionProjections`、`sessionQuery`、`sessionTitle`、`sessionTelemetry`、`sessionReferences`、`tokenMeter` 等 capability seams 属于 `plugin-api-capabilities`（SV11–SV16），不在本 spec 范围。
- **S2**（上屏事件构造 helper，B 类，M2）与 **S6**（官方上屏 helper，C 类 proposal）明确不在本 spec 范围。
- 本 spec 的稳定化对象是 feature-list 已列出的 S1、S3、S4、S5；未列出的会话能力不得借本 spec 夹带实现。

**依赖**：

- `plugin-api-foundation`（F0.1–F0.3）：`ctx.pluginApi` 服务、分层 fail-safe guard、版本协商。
- `plugin-api-facade-integrity`（F0.4–F0.5）：门面完整性策略与链安全契约；本 feature 包装官方会话边界时必须复用其链安全 helper。
- `plugin-api-events-m1`（E1–E12）：稳定事件总线；S1 的会话生命周期事件订阅复用该总线及其 priority、只读 payload、scope 过滤、故障隔离契约，不重复造事件总线。

**命名约定**：本 spec 中 `session` 均指 `pluginApi.session` 命名空间；官方服务用 `sessions` 全称表示，避免混淆。

---

## Requirements

### 1. Session lifecycle event subscriptions (S1)

**User Story:** As a third-party plugin author, I want typed subscriptions for `session/created`, `session/disposed`, `session/event`, and `session/flush` through `pluginApi.session`, so that I can observe session lifecycle events through the supported facade instead of raw Cordis `ctx.on` with unstable payload shapes.

**S1 生命周期事件目录**：本节稳定化的生命周期事件名称**仅**为 `session/created`、`session/disposed`、`session/event`、`session/flush` 四个；它们与 §4 的 `sessionEventTypes`（会话日志事件词汇）不是同一集合。

**Acceptance Criteria:**

1. WHEN a third-party plugin subscribes through `pluginApi.session` to a cataloged session lifecycle event name (`session/created`, `session/disposed`, `session/event`, or `session/flush`), THEN the facade SHALL register that listener on the stable event bus `pluginApi.events` and SHALL return a disposer satisfying the `pluginApi.events.on/once` disposer contract defined in `plugin-api-events-m1` (removal semantics and boolean result).
2. WHEN the official `dsh-session` service dispatches one of the cataloged session lifecycle events, THEN each listener registered through `pluginApi.session` for that event SHALL be invoked exactly once for that dispatch, with the same event arguments as the official dispatch, and SHALL observe the read-only payload guarantee of `plugin-api-events-m1` (E9).
3. WHEN a facade-registered session lifecycle listener throws or returns a rejected promise, THEN the facade SHALL contain the error according to `plugin-api-events-m1` (E11): the error SHALL NOT propagate out of the dispatch, other listeners SHALL still run, and the official dispatch SHALL continue normally.
4. GIVEN the event is marked `scopeFiltered: true` in the `pluginApi.events` catalog, WHEN a session lifecycle listener subscribes with `opts.scope`, THEN the facade SHALL honor the same scope matching rules as `plugin-api-events-m1` (E10).
5. WHEN `pluginApi.session` is inactive or the session feature is disabled (per `plugin-api-foundation` fail-safe), THEN a session lifecycle subscription call SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT register any listener.
6. WHEN `pluginApi.session` receives a session lifecycle event name that is not one of the four S1 lifecycle event names listed above, THEN the subscription SHALL be passed through to the underlying Cordis context as an untyped, unsupported subscription with the same documented no-stability/no-typing guarantee as `plugin-api-events-m1` (AC 1.5).

**Type:** A（S1 基于官方 `dsh-session` 已 dispatch 的 `session/created|disposed|event|flush` 稳定化，复用 `pluginApi.events` 总线；AC 1.5 为门面基础 fail-safe）

---

### 2. Session read surface (S3)

**User Story:** As a third-party plugin author, I want stable `pluginApi.session.get/list/fork` reads, so that I can look up, enumerate, and fork sessions without importing `dsh-session` internals that may change.

**Acceptance Criteria:**

1. WHEN a third-party plugin calls `pluginApi.session.get(id)` with a known session id, THEN the facade SHALL return the same session object that the official `sessions` service returns for that id, without copying or wrapping it.
2. WHEN `pluginApi.session.get(id)` is called with an unknown or invalid session id, THEN the facade SHALL return the same result as the official `sessions` service for the same input, and SHALL NOT throw beyond the official behavior.
3. WHEN `pluginApi.session.list()` is called, THEN the facade SHALL return the same entries and ordering as the official `sessions` service list operation.
4. WHEN `pluginApi.session.fork(source, boundary?, childId?)` is called, THEN the facade SHALL return the same forked session as the official `sessions.fork` operation and SHALL forward `boundary` and `childId` unchanged when provided; WHEN those optional arguments are omitted, THEN the official default behavior SHALL apply.
5. WHEN any `pluginApi.session` read-surface operation is called, THEN it SHALL NOT mutate any session state and SHALL NOT perform side effects beyond the official read operation being wrapped.
6. GIVEN the official `sessions` service is unavailable or the session feature is disabled, WHEN a session read-surface operation is called, THEN the facade SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT fall through to an untyped internal failure.

**Type:** A（S3 基于官方 `sessions` 服务已提供的 `get/list/fork` 稳定直通；AC 2.6 为门面基础 fail-safe）

---

### 3. Session state accessors (S4)

**User Story:** As a third-party plugin author, I want stable read-only accessors for session `header` / `events` / `seq` / `surface`, `requestHeader()`, `requestContext()`, and `deriveMessages()`, so that I can inspect session state without depending on `dsh-session` internal field layout and without risking accidental mutation.

**Acceptance Criteria:**

1. WHEN `pluginApi.session` is active, THEN the facade SHALL expose read accessors for `header`, `events`, `seq`, and `surface`, and SHALL expose `requestHeader()`, `requestContext()`, and `deriveMessages()` callable helpers.
2. WHEN any accessor or helper is called with a session obtained from `pluginApi.session.get/list/fork`, THEN it SHALL return the same value as the corresponding official `dsh-session` API for that session at the time of the call.
3. WHEN an accessor or helper returns an object, array, or nested structure, THEN the returned structure SHALL be read-only with respect to the underlying session state: a third-party plugin SHALL NOT be able to mutate the official session state through the returned value.
4. WHEN any accessor or helper is called, THEN the operation SHALL NOT mutate the underlying session state.
5. WHEN `deriveMessages()` is called with the same options supported by the official `dsh-session` derive-messages API, THEN the facade SHALL forward those options unchanged and return the same derived messages as the official API.
6. WHEN an accessor or helper is called while the session feature is disabled, THEN the facade SHALL produce the foundation-defined typed inactive/feature-disabled error.

**Type:** A（S4 基于官方 `dsh-session` 已提供的会话状态访问 API 稳定化，仅增加只读约束与 fail-safe）

---

### 4. Session event type catalogs and type guards (S5)

**User Story:** As a third-party plugin author, I want stable `sessionEventTypes` / `surfaceEventTypes` catalogs and type guards, so that I can write exhaustive event handling and validate session/surface event type values without hardcoding strings.

**Acceptance Criteria:**

1. WHEN `pluginApi.session` is active, THEN `pluginApi.session.sessionEventTypes` SHALL be a read-only catalog of known session **log** event type names, and SHALL agree with the installed `dsh-session` `KNOWN_SESSION_EVENT_TYPES` set (for example it SHALL include `session/end-seed` and `session/title`; it SHALL NOT include the Cordis lifecycle event names `session/created`, `session/disposed`, `session/event`, or `session/flush`).
2. WHEN `pluginApi.session` is active, THEN `pluginApi.session.surfaceEventTypes` SHALL be a read-only catalog of known surface event type names.
3. GIVEN the installed `dsh-session` version, WHEN the catalogs are built, THEN their contents SHALL agree with the known session/surface event type definitions of that installed version; names not recognized by the installed version SHALL NOT be present in the catalogs.
4. WHEN a third-party plugin attempts to mutate `sessionEventTypes` or `surfaceEventTypes`, THEN the mutation SHALL NOT change the catalog object, and the catalog SHALL remain frozen.
5. WHEN `pluginApi.session.isSessionEventType(value)` is called, THEN it SHALL return `true` if and only if `value` is one of the names in `sessionEventTypes`, and SHALL NOT throw for any input value.
6. WHEN `pluginApi.session.isSurfaceEventType(value)` is called, THEN it SHALL return `true` if and only if `value` is one of the names in `surfaceEventTypes`, and SHALL NOT throw for any input value.
7. WHEN the facade builds a catalog and the official known session/surface event type set cannot be determined, THEN the affected catalog SHALL initialize as an empty frozen catalog and the facade SHALL log a readable diagnostic; the initialization failure SHALL NOT propagate out of `pluginApi` apply.

**Type:** A（S5 基于官方 `dsh-session` known event type 定义稳定化；AC 4.7 为 fail-safe）

---

### 5. Namespace availability and fail-safe (cross-cutting)

**User Story:** As an operator, I want the session namespace to come up safely, so that a missing or broken official session service never kills harness boot or the rest of `pluginApi`.

**Acceptance Criteria:**

1. GIVEN the official `sessions` service is injected and version negotiation passes, WHEN the host plugin applies, THEN `ctx.pluginApi.session` SHALL be available with the S1/S3/S4/S5 surface described in this document.
2. GIVEN the official `sessions` service is missing, unavailable, or the session feature initialization throws, WHEN the host plugin applies, THEN the session namespace SHALL be disabled safely: the failure SHALL be logged, SHALL NOT propagate out of apply, and SHALL NOT disable other `pluginApi` namespaces.
3. WHEN `pluginApi.session` is disabled, THEN every entry point in this document SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT dispatch, read, or return untyped internal results.
4. WHERE a session feature operation wraps an official service boundary, IF the official service throws synchronously or returns a rejected promise, THEN the facade SHALL NOT swallow the error silently; it SHALL propagate it as the official API would, unless the failure occurs during initialization (AC 5.2) or during event dispatch (AC 1.3).
5. WHEN a third-party plugin bypasses the facade and consumes `dsh-session` directly, THEN this feature SHALL NOT intercept that usage and SHALL NOT provide any compatibility guarantee for the bypass path.

**Type:** 门面基础（fail-safe 与 unsupported escape hatch 契约，来自 `plugin-api-foundation` 与 AGENTS.md 第 2 节）

---

## Host / Client coverage

- **Host 侧**：本 feature 全部能力均通过 `ctx.pluginApi.session` 在 host 侧暴露。
- **Client 侧**：本 feature 不新增 client bundle、`client.remote`、slot 或任何浏览器端 API；client 侧无对应需求。

---

## Non-goals

- **S2**：不实现上屏事件构造 helper（`session.appendMessage(kind, payload)` 及其 `surfaceOp` / `sourceEventSeqs` 自动补齐）。
- **S6**：不编写官方上屏 helper 的上游提案。
- 不实现会话投影、查询、标题、遥测、引用、token 计量等 capability seams（属于 `plugin-api-capabilities`）。
- 不在本 feature 中新增任何 B 类转译钩子或 C 类提案。
- 不修改官方 DSH 包文件；不 import 官方包模块私有变量。
