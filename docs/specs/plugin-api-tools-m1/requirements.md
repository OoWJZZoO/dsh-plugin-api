# Feature Requirements: plugin-api-tools-m1

## Introduction

`plugin-api-tools-m1` 是 `dsh-plugin-api` 的 **M1 tools feature**，覆盖 feature-list §2.6 `pluginApi.tools` 命名空间中的：

- **T1**：`tools.register(definition)` —— `defineTool` 的类型化稳定版；
- **T2**：`events.on('tools/change', listener)` —— 工具变更通知（官方为 unfiltered）；
- **T3**：`events.waterfall('tools/pre-execute', exec, next)` —— 执行前 gate 瀑布；
- **T4**：`events.waterfall('tools/execute', exec, next)` —— 执行环绕瀑布；
- **T5**：`events.waterfall('tools/post-execute', exec, result, next)` —— 执行后决策瀑布；
- **T6**：`events.on('tools/result', (exec, result) => {})` —— 结果通知（contained、observe-only）；
- **T7**：`events.waterfall('tools/code-dispatch-log', dispatch, next)` —— 代码分发日志瀑布；
- **T8**：`tools.restrict(filter)` / `tools.guard(guard)` —— 工具限制与守卫稳定直通；
- **T9**：`tools.get(name, scope?)` / `tools.schemas(scope?)` / `tools.execute(input)` / `tools.presentAs(...)` —— 工具查询与执行稳定直通。

本 feature 只覆盖 **host 侧**。client bundle、`client.remote`、slot、settings 可视化配置桥属于 M3；**T10（执行路由注入）属于 M2**，明确不在本 spec 范围；C 类上游提案（U1–U8）不在本 spec 范围。

**类型标注**：T1–T9 全部为 **A 类**（官方已 dispatch / 已提供服务，只需稳定化：类型化、只读 payload、priority、错误隔离、fail-safe）。本 spec 不产生新的 B 类转译，也不产生新的 C 类提案。

**依赖**：

- `plugin-api-foundation`（F0.1–F0.3）：`ctx.pluginApi` 服务、分层 fail-safe guard、版本协商。
- `plugin-api-facade-integrity`（F0.4–F0.5）：门面完整性策略与链安全契约；本 feature 若需要包装官方边界，必须复用其链安全 helper。
- `plugin-api-events-m1`（E1–E12）：`pluginApi.events` 稳定事件总线；T2–T7 的工具事件稳定化统一挂在该总线上，并继承其 priority、deepFreeze 只读 payload、scope 感知、监听器故障隔离与 catalog 只读契约。

**范围边界**：本 spec 的稳定化对象是 feature-list §2.6 已列出的 T1–T9；未列出的 `tools/*` 事件或方法不得借本 spec 夹带实现。官方管线顺序（`tools/pre-execute` → 单调 `guard()` 检查 → `tools/execute` → `tools/post-execute` → 工具 `finalizeContent` → `tools/result`）由官方决定，门面只稳定化、不重排；`timeoutMs` 由官方 `dsh-tool-call-timeout-policy`（`tools/execute` wrapper）执行，不在门面内复制。

---

## Requirements

### 1. `pluginApi.tools` service surface and fail-safe

**User Story:** As a third-party plugin author, I want a supported `pluginApi.tools` namespace, so that I can register, restrict, guard, query, and execute tools through one stable facade instead of importing `dsh-tools` internals.

**Acceptance Criteria:**

1. GIVEN the `plugin-api-foundation` core guard is active and the tools feature guard succeeds, WHEN the facade applies, THEN `pluginApi.tools` SHALL be available with the methods defined in sections 2, 9, and 10.
2. GIVEN the `pluginApi` service is inactive or the tools feature is disabled (per `plugin-api-foundation` fail-safe), WHEN any `pluginApi.tools` method defined in this spec is called, THEN the facade SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT call into the official `tools` service.
3. WHEN the facade applies, THEN it SHALL NOT throw out of `apply`, even when the official `tools` service is unavailable, and SHALL NOT modify any file in the official `@deepseek-ai/dsh-*` packages.
4. WHEN a third-party plugin bypasses the facade and interacts directly with `dsh-tools` internals, THEN the facade SHALL NOT intercept, block, or provide any compatibility guarantee for that unsupported escape-hatch path.
5. WHEN the facade exposes `pluginApi.tools` methods, THEN it SHALL only expose the methods stabilized by T1, T8, and T9; tool event subscriptions (T2–T7) SHALL be exposed through `pluginApi.events`.

**Type:** A（官方 `tools` 服务已存在；AC 1.2–1.5 为门面基础 fail-safe / facade-integrity 约束）

---

### 2. Tool registration (T1)

**User Story:** As a third-party plugin author, I want `pluginApi.tools.register(definition)` as a typed stable equivalent of the official `defineTool` entry, so that I can register tools without importing `dsh-tools`.

**Acceptance Criteria:**

1. WHEN a third-party plugin calls `pluginApi.tools.register(definition)` with a valid tool definition, THEN the facade SHALL invoke the official `tools` service tool-definition entry with the same `definition` object and SHALL return the official return value unchanged.
2. WHEN the value returned by `tools.register` is a disposer function and that disposer is called, THEN the registered tool SHALL be removed with the same semantics as the official `defineTool` return value.
3. WHEN `tools.register` is called with an invalid or unsupported definition, THEN the facade SHALL preserve official validation/rejection behavior and SHALL NOT pre-validate, wrap, cache, or rewrite the definition.
4. WHEN `tools.register` is called while the tools feature is inactive or the official `tools` service is unavailable, THEN AC 1.2 SHALL apply.

**Type:** A（`dsh-tools` `defineTool` 稳定直通；feature-list §2.6 T1）

---

### 3. Tool change notification (T2)

**User Story:** As a third-party plugin author, I want a typed subscription to `tools/change`, so that I can react to tool registry changes without raw Cordis wiring.

**Acceptance Criteria:**

1. WHEN a plugin reads `pluginApi.events.catalog`, THEN `tools/change` SHALL be cataloged as an `emit` event with `scopeFiltered: false` and a payload type reference matching the official `dsh-tools` `tools/change` dispatch point.
2. WHEN `tools/change` is dispatched by the official tools service, THEN a facade-registered listener SHALL receive the official payload deep-frozen per `plugin-api-events-m1` section 4, and the official emit semantics SHALL be preserved.
3. WHEN the facade stabilizes `tools/change`, THEN it SHALL NOT filter, scope, reorder, or alter the official dispatch; the event SHALL remain globally delivered.

**Type:** A（官方 `dsh-tools` 已 dispatch；官方为 unfiltered；feature-list §2.6 T2）

---

### 4. Pre-execute gate waterfall (T3)

**User Story:** As a third-party plugin author, I want to participate in the `tools/pre-execute` waterfall through the typed bus, so that I can allow, deny, or escalate tool executions without bypassing official gate semantics.

**Acceptance Criteria:**

1. WHEN a plugin reads `pluginApi.events.catalog`, THEN `tools/pre-execute` SHALL be cataloged as a `waterfall` event with `scopeFiltered: true`, payload `exec` (the official tool-execution object), and source feature id `T3`.
2. WHEN `tools/pre-execute` is dispatched by the official tools service, THEN facade-registered waterfall listeners SHALL receive the frozen `exec` payload and SHALL participate with the same waterfall semantics as the official `tools/pre-execute` dispatch.
3. WHEN a facade-registered listener returns a decision object, THEN the returned value SHALL be passed along the waterfall unchanged in semantics; the facade SHALL NOT reinterpret, coerce, or default the decision.
4. WHEN no facade-registered listener returns a decision, THEN the official default gate behavior (accept/allow by default, feature-list `{kind:'allow'}`) SHALL be preserved, and the facade SHALL NOT inject its own default decision.
5. WHEN a facade-registered listener returns `{kind:'allow'}`, `{kind:'deny'}`, or `{kind:'ask'}`, THEN the official handling of these gate values SHALL be preserved, including the official routing of `ask` through the approval seam; the facade SHALL NOT implement approval routing itself.
6. WHEN a listener subscribes to `tools/pre-execute` with `opts.scope`, THEN the scope filtering rules of `plugin-api-events-m1` section 5 SHALL apply.

**Type:** A（官方 `dsh-tools` 已 dispatch `tools/pre-execute`；feature-list §2.6 T3）

---

### 5. Execute around-waterfall (T4)

**User Story:** As a third-party plugin author, I want to participate in the `tools/execute` around-waterfall, so that I can observe or wrap tool execution (for example timeout/retry/metrics, or replacing `exec.signal`) through the stable bus.

**Acceptance Criteria:**

1. WHEN a plugin reads `pluginApi.events.catalog`, THEN `tools/execute` SHALL be cataloged as a `waterfall` event with `scopeFiltered: true`, payload `exec` (the official tool-execution object), and source feature id `T4`.
2. WHEN `tools/execute` is dispatched by the official tools service, THEN facade-registered waterfall listeners SHALL receive the official `exec` payload with all properties except `signal` deep-frozen per `plugin-api-events-m1` section 4, and `exec.signal` SHALL remain writable (not frozen) so that the official wrapper signal-replacement contract is preserved.
3. WHEN a facade-registered listener replaces `exec.signal` in place and calls `next()`, THEN the official `tools/execute` chain SHALL observe that replacement with the same semantics as an official wrapper (including caller-signal fusion and signal restoration by the official registry), and the facade SHALL NOT undo or freeze that replacement.
4. WHEN no facade-registered listener replaces `exec.signal`, THEN the official execution path SHALL receive the original `exec` unchanged.
5. WHEN the facade stabilizes `tools/execute`, THEN it SHALL NOT implement timeout, retry, or metrics behavior itself; the official `timeoutMs` policy SHALL remain the sole executor of tool timeout.
6. WHEN a listener subscribes to `tools/execute` with `opts.scope`, THEN the scope filtering rules of `plugin-api-events-m1` section 5 SHALL apply.

**Type:** A（官方 `dsh-tools` 已 dispatch `tools/execute`；feature-list §2.6 T4）

---

### 6. Post-execute decision waterfall (T5)

**User Story:** As a third-party plugin author, I want to participate in the `tools/post-execute` waterfall, so that I can accept or block a completed tool result through the stable bus.

**Acceptance Criteria:**

1. WHEN a plugin reads `pluginApi.events.catalog`, THEN `tools/post-execute` SHALL be cataloged as a `waterfall` event with `scopeFiltered: true`, payload type reference matching the official `dsh-tools` `tools/post-execute` dispatch (arguments `exec` and `result`), and source feature id `T5`.
2. WHEN `tools/post-execute` is dispatched by the official tools service, THEN facade-registered waterfall listeners SHALL receive the frozen `exec` and frozen `result` payloads and SHALL participate with the same waterfall semantics as the official `tools/post-execute` dispatch.
3. WHEN a facade-registered listener returns an `accept`- or `block`-shaped decision (feature-list `accept({content?|value?})` / `block({feedback})`), THEN the returned value SHALL be passed along the waterfall unchanged; the facade SHALL NOT itself accept or block results.
4. WHEN no facade-registered listener returns a decision, THEN the official default behavior (accept by default, feature-list `{kind:'accept'}`) SHALL be preserved, and the facade SHALL NOT inject its own default decision.
5. WHEN a listener subscribes to `tools/post-execute` with `opts.scope`, THEN the scope filtering rules of `plugin-api-events-m1` section 5 SHALL apply.

**Type:** A（官方 `dsh-tools` 已 dispatch `tools/post-execute`；feature-list §2.6 T5）

---

### 7. Tool result notification (T6)

**User Story:** As a third-party plugin author, I want a typed, contained `tools/result` notification, so that I can observe completed tool results without being able to corrupt them.

**Acceptance Criteria:**

1. WHEN a plugin reads `pluginApi.events.catalog`, THEN `tools/result` SHALL be cataloged as an `emit` event with `scopeFiltered: true`, payload type reference matching the official `dsh-tools` `tools/result` dispatch (arguments `exec` and `result`), and source feature id `T6`.
2. WHEN `tools/result` is dispatched by the official tools service, THEN facade-registered listeners SHALL receive the frozen `exec` and frozen `result` payloads and the official emit semantics SHALL be preserved.
3. WHEN a facade-registered `tools/result` listener throws synchronously or returns a rejected promise, THEN the facade SHALL contain the error per `plugin-api-events-m1` section 6, SHALL NOT alter the result, and SHALL NOT prevent the official dispatch or remaining listeners from running.
4. WHEN a facade-registered listener attempts to mutate `exec` or `result`, THEN the mutation SHALL NOT be observable to other listeners or to the official dispatch (read-only, observe-only contract).
5. WHEN a listener subscribes to `tools/result` with `opts.scope`, THEN the scope filtering rules of `plugin-api-events-m1` section 5 SHALL apply.

**Type:** A（官方 `dsh-tools` 已 dispatch `tools/result`；feature-list §2.6 T6）

---

### 8. Code dispatch log waterfall (T7)

**User Story:** As a third-party plugin author, I want to participate in the `tools/code-dispatch-log` waterfall, so that I can rewrite code-dispatch log content through the stable bus.

**Acceptance Criteria:**

1. WHEN a plugin reads `pluginApi.events.catalog`, THEN `tools/code-dispatch-log` SHALL be cataloged as a `waterfall` event with `scopeFiltered: true`, payload `dispatch` (the official code-dispatch log object), and source feature id `T7`.
2. WHEN `tools/code-dispatch-log` is dispatched by the official tools service, THEN facade-registered waterfall listeners SHALL receive the frozen `dispatch` payload and SHALL participate with the same waterfall semantics as the official `tools/code-dispatch-log` dispatch.
3. WHEN a facade-registered listener returns replacement content, THEN the returned content SHALL be passed along the waterfall as the next content value; the facade SHALL NOT edit, transform, or default the content itself.
4. WHEN a listener subscribes to `tools/code-dispatch-log` with `opts.scope`, THEN the scope filtering rules of `plugin-api-events-m1` section 5 SHALL apply.

**Type:** A（官方 `dsh-tools` 已 dispatch `tools/code-dispatch-log`；feature-list §2.6 T7）

---

### 9. Tool restriction and guard passthrough (T8)

**User Story:** As a third-party plugin author, I want `tools.restrict(filter)` and `tools.guard(guard)` as stable passthroughs, so that I can apply official tool restrictions and guards without importing `dsh-tools`.

**Acceptance Criteria:**

1. WHEN a third-party plugin calls `pluginApi.tools.restrict(filter)`, THEN the facade SHALL invoke the official `tools` service `restrict` method with the same `filter` and SHALL return its return value unchanged.
2. WHEN a third-party plugin calls `pluginApi.tools.guard(guard)`, THEN the facade SHALL invoke the official `tools` service `guard` method with the same `guard` and SHALL return its return value unchanged.
3. WHEN `tools.restrict` or `tools.guard` is called while the tools feature is inactive or the official `tools` service is unavailable, THEN AC 1.2 SHALL apply.
4. WHEN the facade handles these calls, THEN it SHALL NOT wrap, cache, reorder, or alter the supplied `filter` or `guard`.

**Type:** A（官方 `ToolRuntime.restrict/guard` 稳定直通；feature-list §2.6 T8）

---

### 10. Tool query and execution passthrough (T9)

**User Story:** As a third-party plugin author, I want stable typed passthroughs for tool lookup, schema listing, execution, and presentation, so that I can drive tools through the facade instead of importing `dsh-tools`.

**Acceptance Criteria:**

1. WHEN a third-party plugin calls `pluginApi.tools.get(name, scope?)`, THEN the facade SHALL invoke the official `tools` service `get` method with the same arguments and SHALL return its return value unchanged.
2. WHEN a third-party plugin calls `pluginApi.tools.schemas(scope?)`, THEN the facade SHALL invoke the official `tools` service `schemas` method with the same arguments and SHALL return its return value unchanged.
3. WHEN a third-party plugin calls `pluginApi.tools.execute(input)`, THEN the facade SHALL invoke the official `tools` service `execute` method with the same `input` and SHALL return its return value unchanged.
4. WHEN a third-party plugin calls `pluginApi.tools.presentAs(...args)`, THEN the facade SHALL invoke the official `tools` service `presentAs` method with the same `...args` and SHALL return its return value unchanged.
5. WHEN any method in this section is called while the tools feature is inactive or the official `tools` service is unavailable, THEN AC 1.2 SHALL apply.
6. WHEN the facade handles these calls, THEN it SHALL NOT wrap, cache, filter, or alter the supplied arguments or return values.

**Type:** A（官方 `ToolRuntime` 公共方法稳定直通；feature-list §2.6 T9）

---

### 11. Tools event catalog extension

**User Story:** As a third-party plugin author, I want the six tools events discoverable in `pluginApi.events.catalog`, so that I can learn their dispatch mode, payload shape, scope filtering, and provenance without reading DSH source.

**Acceptance Criteria:**

1. WHEN `plugin-api-tools-m1` is active, THEN `pluginApi.events.catalog` SHALL contain entries for exactly these six event names in addition to the events stabilized by `plugin-api-events-m1`: `tools/change`, `tools/pre-execute`, `tools/execute`, `tools/post-execute`, `tools/result`, `tools/code-dispatch-log`.
2. WHEN a tool event catalog entry is read, THEN it SHALL contain at least `mode` (`emit` for `tools/change` and `tools/result`; `waterfall` for `tools/pre-execute`, `tools/execute`, `tools/post-execute`, and `tools/code-dispatch-log`), a `payload` type description/reference, `scopeFiltered` boolean, `source` feature id (`T2`–`T7`), and `type` (`A`).
3. WHEN a tool event catalog entry is read, THEN `tools/change` SHALL have `scopeFiltered: false`, and each of `tools/pre-execute`, `tools/execute`, `tools/post-execute`, `tools/result`, and `tools/code-dispatch-log` SHALL have `scopeFiltered: true` with the scope key identified per `plugin-api-events-m1` AC 5.4.
4. WHEN the catalog is read, THEN it SHALL NOT include any `tools/*` event name outside the T1–T9 scope stabilized by this spec.
5. WHEN the catalog object or any of its entries is mutated, THEN the mutation SHALL NOT be observable (the catalog read-only contract of `plugin-api-events-m1` AC 7.5 SHALL continue to apply to the extended catalog).

**Type:** 门面基础（事件目录扩展；仅新增本 spec 的 6 个 tools 事件）

---

### 12. Testability and regression coverage

**User Story:** As a maintainer, I want T1–T9 covered by `node --test` with mocked Cordis/official services, so that the tools facade is regression-safe without booting a real harness.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN tests SHALL cover `tools.register` delegation and disposer behavior using a mocked official `tools` service (T1).
2. WHEN `node --test` runs, THEN tests SHALL cover `tools.restrict`, `tools.guard`, `tools.get`, `tools.schemas`, `tools.execute`, and `tools.presentAs` delegation with a mocked official `tools` service, and SHALL assert that arguments and return values are passed through unchanged (T8, T9).
3. WHEN `node --test` runs, THEN tests SHALL assert that the catalog contains exactly the six tool events required by AC 11.1, that each entry has the metadata required by AC 11.2–11.3, and that the catalog is read-only (T2–T7 catalog extension).
4. WHEN `node --test` runs, THEN tests SHALL dispatch each of `tools/change`, `tools/pre-execute`, `tools/execute`, `tools/post-execute`, `tools/result`, and `tools/code-dispatch-log` through a mocked bus and SHALL assert that listeners receive frozen payloads and that official emit/waterfall semantics are preserved (T2–T7).
5. WHEN `node --test` runs, THEN tests SHALL cover `tools/pre-execute` decision pass-through (including no-decision default), `tools/execute` replacement `exec` propagation, `tools/post-execute` accept/block pass-through, `tools/result` error containment and observe-only payloads, and `tools/code-dispatch-log` content replacement (T3–T7).
6. WHEN `node --test` runs, THEN tests SHALL cover scope filtering for the scope-filtered tool events and global delivery for `tools/change` (T2–T7 scope behavior).
7. WHEN `node --test` runs, THEN tests SHALL cover the inactive/feature-disabled error path for every `pluginApi.tools` method, and SHALL assert that applying the facade never throws (fail-safe).
8. GIVEN a mocked Cordis context and mocked official `tools` service, WHEN `node --test` runs, THEN no test SHALL require booting a real harness.

**Type:** 质量门
