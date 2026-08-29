# Feature Requirements: plugin-api-system-prompt-m1

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.systemPrompt`（P1–P8） | `pluginApi.prompts`（叶子名不变） |
>
> 注意：slash 事件名 `system-prompt/assemble` 是协议名，**保持不变**。现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

## Introduction

`plugin-api-system-prompt-m1` 是 `dsh-plugin-api` 门面在 M1 的 `pluginApi.systemPrompt` 命名空间 feature，覆盖 feature-list §2.7 的 P1–P8：

- **P1 段落注册**：`systemPrompt.section(section): () => void`
- **P2 动态上下文注册**：`systemPrompt.context(context): () => void`
- **P3 变量注册**：`systemPrompt.variable(name, provider): () => void`
- **P4 工具 schema 提供者**：`systemPrompt.tools(provider): () => void`
- **P5 运行时上下文抑制**：`systemPrompt.suppressRuntimeContext(): () => void`
- **P6 组装瀑布**：`pluginApi.events.waterfall('system-prompt/assemble', assembly, context, next)` 及其类型化订阅
- **P7 变更通知**：`pluginApi.events.on('system-prompt/change', listener)`
- **P8 渲染 helper**：`systemPrompt.render(assembly)` / `systemPrompt.renderContextSections(assembly)`

本 feature 只覆盖 **host 侧**。client bundle、slot、settings 可视化配置桥属于 M3；C 类上游提案不在本 spec 范围。

**类型标注**：P1–P8 全部为 **A 类**（官方 `dsh-system-prompt` 已提供服务或已 dispatch，门面只做稳定化）。本 spec 不产生新的 B 类或 C 类。

**依赖**：

- `plugin-api-foundation`（F0.1–F0.3）：`ctx.pluginApi` 服务、分层 fail-safe guard、版本协商。
- `plugin-api-facade-integrity`（F0.4–F0.5）：门面完整性策略与链安全契约；本 feature 对官方边界的任何包装必须复用其链安全 helper。
- `plugin-api-events-m1`（E1–E12）：P6/P7 复用已交付的稳定事件总线契约（类型化订阅/派发、priority、只读 payload、scope 感知、故障隔离、事件目录）；本 feature 扩展其事件目录，新增 2 个事件条目。

**范围边界**：本 spec 只稳定化 P1–P8。`systemPrompt.assemble()` 服务方法本身、`renderContextSnapshot` / `joinContextSections` 等其他未列入 P1–P8 的官方能力，以及任何 C 类上游提案，均不得借本 spec 夹带实现。

---

## Requirements

### 1. Namespace availability and fail-safe activation

**User Story:** As a third-party plugin author, I want to obtain `pluginApi.systemPrompt` through the facade, so that I register prompt sections/contexts/variables/tool schemas and subscribe to assembly events without importing `@deepseek-ai/dsh-system-prompt`.

**Acceptance Criteria:**

1. GIVEN the `dsh-plugin-api` host plugin is loaded before third-party plugins, WHEN a plugin reads `ctx.pluginApi.systemPrompt`, THEN it SHALL expose the P1–P8 API surface described in sections 2–9.
2. WHEN the environment self-check detects that the official `systemPrompt` service, the `system-prompt/assemble` contract, or the `system-prompt/change` contract is missing or changed, THEN the facade SHALL log a readable diagnostic and return from `apply` without throwing and without installing any system-prompt wrapper.
3. WHEN the system-prompt feature guard fails or the feature is disabled, THEN `pluginApi.systemPrompt` SHALL be marked unavailable, and every call into it SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT call into official services.
4. WHERE the feature is evaluated at apply time, IF the official `systemPrompt` service is absent, THEN the facade SHALL treat the feature as unavailable and SHALL NOT block harness boot.
5. WHEN the facade is active and a plugin applies it, THEN no apply path of this feature SHALL throw through plugin `apply`; failures SHALL be logged and contained.

**Type:** 门面基础 / fail-safe（非 A/B/C 钩子）

---

### 2. Prompt section registration (P1)

**User Story:** As a plugin author, I want to register an ordered system-prompt section through `pluginApi.systemPrompt.section`, so that my section is assembled for the calling context's scope without importing the official service.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.systemPrompt.section(section)` with a valid `PromptSection` (`name`, `order`, `text: string | ((context) => string)`, optional `complete`), THEN the facade SHALL forward the same `section` to the official `systemPrompt.section` in the calling context's scope and SHALL return the exact disposer returned by the official method.
2. WHEN the returned disposer is called, THEN the section SHALL be removed from future assemblies, and the facade SHALL NOT keep any hidden reference that would re-register it.
3. WHEN a duplicate `name` within the same layer or a non-finite `order` makes the official `section` method throw, THEN the facade SHALL preserve the original error and SHALL NOT mask or swallow it; the facade SHALL remain active for subsequent calls.
4. WHEN the feature is disabled or unavailable, THEN calls to `section` SHALL follow AC 1.3 and SHALL NOT call into official services.

**Type:** A（官方 `dsh-system-prompt` `SystemPrompt.section` 稳定直通；`lib/types/index.d.ts:187`）

---

### 3. Dynamic context registration (P2)

**User Story:** As a plugin author, I want to register ordered dynamic runtime-context contributions through `pluginApi.systemPrompt.context`, so that my context snapshot is materialized by official assembly without raw service injection.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.systemPrompt.context(context)` with a valid `PromptContext` (`name`, `order`, `text: string | ((context) => string)`), THEN the facade SHALL forward the same `context` to the official `systemPrompt.context` in the calling context's scope and SHALL return the exact disposer returned by the official method.
2. WHEN the returned disposer is called, THEN the contribution SHALL be removed from future assemblies.
3. WHEN a duplicate `name` within the same layer makes the official `context` method throw, THEN the facade SHALL preserve the original error and SHALL remain active for subsequent calls.
4. WHEN the feature is disabled or unavailable, THEN calls to `context` SHALL follow AC 1.3 and SHALL NOT call into official services.

**Type:** A（官方 `SystemPrompt.context` 稳定直通；`lib/types/index.d.ts:194`）

---

### 4. Prompt variable registration (P3)

**User Story:** As a plugin author, I want to register named prompt variables through `pluginApi.systemPrompt.variable`, so that my `{{variable}}` references render correctly in sections and contexts without importing the official service.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.systemPrompt.variable(name, provider)` with a valid `name` matching `[a-z][a-z0-9_]*` and a function `provider`, THEN the facade SHALL forward the same `name` and `provider` to the official `systemPrompt.variable` in the calling context's scope and SHALL return the exact disposer returned by the official method.
2. WHEN the returned disposer is called, THEN the variable SHALL be removed from future assemblies.
3. WHEN an invalid or duplicate `name` makes the official `variable` method throw, THEN the facade SHALL preserve the original error and SHALL remain active for subsequent calls.
4. WHEN the feature is disabled or unavailable, THEN calls to `variable` SHALL follow AC 1.3 and SHALL NOT call into official services.

**Type:** A（官方 `SystemPrompt.variable` 稳定直通；`lib/types/index.d.ts:218`）

---

### 5. Tool schema provider registration (P4)

**User Story:** As a plugin author, I want to register a tool-schema provider through `pluginApi.systemPrompt.tools`, so that my tool schemas participate in assembly and config validation without raw service injection.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.systemPrompt.tools(provider)` with a function provider returning `ToolProviderResult` (`schemas` and optional `knownNames`), THEN the facade SHALL forward the same `provider` to the official `systemPrompt.tools` in the calling context's scope and SHALL return the exact disposer returned by the official method.
2. WHEN the returned disposer is called, THEN the provider SHALL be removed from future assemblies.
3. WHEN the provider returns the reserved `TOOL_ORDER_REST` name and official assembly subsequently fails, THEN the facade SHALL NOT pre-validate, cache, or alter that behavior; the official assembly error SHALL surface unchanged.
4. WHEN the feature is disabled or unavailable, THEN calls to `tools` SHALL follow AC 1.3 and SHALL NOT call into official services.

**Type:** A（官方 `SystemPrompt.tools` 稳定直通；`lib/types/index.d.ts:209`）

---

### 6. Runtime context suppression (P5)

**User Story:** As a plugin author, I want to suppress dynamic runtime-context contributions in the calling scope through `pluginApi.systemPrompt.suppressRuntimeContext`, so that I can opt out of runtime snapshots without changing the services that own those facts.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.systemPrompt.suppressRuntimeContext()`, THEN the facade SHALL call the official `systemPrompt.suppressRuntimeContext` in the calling context's scope and SHALL return the exact disposer returned by the official method.
2. WHEN the returned disposer is called, THEN the suppression SHALL end for that registration only; other independent suppressors SHALL remain in effect.
3. WHEN multiple plugins call `suppressRuntimeContext()`, THEN their suppressions SHALL be independently disposable and disposing one SHALL NOT dispose the others.
4. WHEN the feature is disabled or unavailable, THEN calls to `suppressRuntimeContext` SHALL follow AC 1.3 and SHALL NOT call into official services.

**Type:** A（官方 `SystemPrompt.suppressRuntimeContext` 稳定直通；`lib/types/index.d.ts:201`）

---

### 7. Typed `system-prompt/assemble` waterfall stabilization (P6)

**User Story:** As a plugin author, I want to participate in the system-prompt assembly waterfall through `pluginApi.events`, so that I can observe or replace the assembled prompt with stable typing, priority, read-only inputs, scope filtering, and fault isolation.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.events.waterfall('system-prompt/assemble', assembly, context, next)`, THEN the facade SHALL dispatch with the same waterfall semantics and arguments as the official `ctx.waterfall('system-prompt/assemble', assembly, context, next)`.
2. WHEN a plugin subscribes via `pluginApi.events.on('system-prompt/assemble', listener)` or `once`, THEN the listener SHALL be invoked with `(assembly, context, next)` for each assembly dispatch, and the returned value SHALL be authoritative for the waterfall chain exactly as in the official event.
3. WHEN a plugin reads `pluginApi.events.catalog`, THEN `system-prompt/assemble` SHALL be cataloged with at least: `mode: 'waterfall'`, `scopeFiltered: true`, scope key `args[1].scope` (the `context.scope` field), payload reference to `(assembly: PromptAssembly, context: AssembleContext)`, `source: 'P6'`, and `type: 'A'`.
4. GIVEN a listener subscribes to `system-prompt/assemble` with `opts.scope`, WHEN the event is dispatched, THEN the listener SHALL be invoked only for dispatches whose `context.scope` matches `opts.scope`; WHEN `opts.scope` is omitted, THEN the listener SHALL observe dispatches for all scopes.
5. WHEN `system-prompt/assemble` is dispatched through `pluginApi.events`, THEN the read-only payload, priority ordering, and listener fault isolation guarantees of `plugin-api-events-m1` sections 3–6 SHALL apply unchanged.
6. WHEN the facade stabilizes this event, THEN it SHALL NOT reorder or alter the official waterfall; it SHALL only expose typed subscription/dispatch with the facade guarantees.

**Type:** A（官方 `dsh-system-prompt` `system-prompt/assemble` 已 dispatch；`lib/index.js:283`，`lib/types/index.d.ts:27`；scope 权威表 `dsh-scope/lib/invariant.js:30`）

---

### 8. Typed `system-prompt/change` notification stabilization (P7)

**User Story:** As a plugin author, I want a typed subscription to `system-prompt/change`, so that I can react to prompt provider registration changes without raw Cordis wiring.

**Acceptance Criteria:**

1. WHEN a plugin subscribes via `pluginApi.events.on('system-prompt/change', listener)`, THEN the listener SHALL be invoked for each official `system-prompt/change` emit with the same argument list as the official event (no payload).
2. WHEN a plugin calls `pluginApi.events.emit('system-prompt/change')`, THEN the facade SHALL dispatch with the same semantics as official `ctx.emit('system-prompt/change')`.
3. WHEN a plugin reads `pluginApi.events.catalog`, THEN `system-prompt/change` SHALL be cataloged with at least: `mode: 'emit'`, `scopeFiltered: false`, payload `'none'`, `source: 'P7'`, and `type: 'A'`.
4. WHEN `system-prompt/change` is dispatched through `pluginApi.events`, THEN the priority ordering and listener fault isolation guarantees of `plugin-api-events-m1` SHALL apply unchanged.
5. WHEN the facade stabilizes this event, THEN it SHALL NOT alter the official emit semantics or payload absence.

**Type:** A（官方 `dsh-system-prompt` `system-prompt/change` 已 dispatch；`lib/index.js:160`，`lib/types/index.d.ts:33`）

---

### 9. Render helpers (P8)

**User Story:** As a plugin author, I want stable render helpers on `pluginApi.systemPrompt`, so that I can render an assembly to prompt text or context sections exactly like the official `dsh-system-prompt` exports.

**Acceptance Criteria:**

1. WHEN a plugin calls `pluginApi.systemPrompt.render(assembly)` with a valid `PromptAssembly`, THEN the facade SHALL return exactly the string returned by the official `renderPrompt(assembly)` (strict `{{variable}}` interpolation, empty-section dropping, blank-line joining, malformed/unknown/undefined reference errors unchanged).
2. WHEN a plugin calls `pluginApi.systemPrompt.renderContextSections(assembly)` with a valid `PromptAssembly`, THEN the facade SHALL return exactly the array returned by the official `renderContextSections(assembly)`.
3. WHEN a plugin calls `render` or `renderContextSections` with an invalid assembly, THEN the facade SHALL preserve the original error thrown by the official helper and SHALL NOT pre-validate, cache, or alter the assembly.
4. WHEN the feature is disabled or unavailable, THEN calls to `render` or `renderContextSections` SHALL follow AC 1.3 and SHALL NOT call into official helpers.

**Type:** A（官方 `dsh-system-prompt` 导出的 `renderPrompt` / `renderContextSections` 稳定直通；`lib/types/index.d.ts:147,172`）

---

### 10. Testability and regression coverage

**User Story:** As a maintainer, I want P1–P8 covered by `node --test` with mocked Cordis/official services, so that the system-prompt facade is regression-safe without booting a real harness.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN tests SHALL cover namespace activation and fail-safe behavior: active facade exposes `pluginApi.systemPrompt`; guard failure produces the foundation-defined inactive/feature-disabled error; applying the facade never throws.
2. WHEN `node --test` runs, THEN tests SHALL cover P1–P5 passthrough: each method forwards the same arguments to the mocked official `systemPrompt` service, returns the official disposer, disposes through the official disposer, and preserves official errors.
3. WHEN `node --test` runs, THEN tests SHALL cover P6/P7 catalog entries by asserting `mode`, `scopeFiltered`, scope key, payload description, `source`, and `type` metadata for `system-prompt/assemble` and `system-prompt/change`.
4. WHEN `node --test` runs, THEN tests SHALL cover P6 subscription semantics: waterfall listeners receive `(assembly, context, next)`, a returned assembly is authoritative, scope filtering matches `context.scope`, and read-only/fault-isolation guarantees from the events bus apply.
5. WHEN `node --test` runs, THEN tests SHALL cover P7 subscription semantics: listeners are invoked on `system-prompt/change` emits and the event has no payload.
6. WHEN `node --test` runs, THEN tests SHALL cover P8: `render` returns the official `renderPrompt` result and `renderContextSections` returns the official result for sample assemblies; official helper errors are preserved.
7. WHEN `node --test` runs, THEN tests SHALL cover disabled-feature paths for every public method in sections 2–9.
8. GIVEN a mocked Cordis context and mocked official services, WHEN `node --test` runs, THEN no test SHALL require booting a real harness.

**Type:** 质量门
