# Feature Requirements: plugin-api-llm-m1

## Introduction

`plugin-api-llm-m1` 是 `dsh-plugin-api` 的 **M1 LLM 命名空间 feature**，合并 feature-list 中的：

- **L3 模型请求瀑布**：`pluginApi.events.waterfall('llm/stream', options, next)` 的类型化稳定版；
- **L6 adapter 拓扑通知**：`pluginApi.events.on('llm/adapters-updated', listener)` 类型化稳定版；
- **L7 模型信息只读查询**：`pluginApi.llm.modelInfo(provider, model, signal?)`；
- **L8 调用准备与流式入口**：`pluginApi.llm.prepareCall(config, signal?)` / `pluginApi.llm.stream(options)`；
- **L9 provider 注册直通**：`pluginApi.llm.registerAdapter(providers, adapter)` / `registerConfigurableProviders(entries)` / `registerModelDiscovery(settingsNs, discover)`。

本 feature 只覆盖 **host 侧**。client bundle、`client.remote`、slot、settings 可视化配置桥属于 M3；`L1` 已交付、`L2/L4/L5/L10` 属于 M2/M4，均**不在本 spec 范围**。

**类型标注**：L3、L6、L7、L8、L9 均为 **A 类**（官方已 dispatch / 已提供服务，只需稳定化直通）；本 spec 不产生新的 B 类模拟或 C 类上游提案。

**依赖**：

- `plugin-api-foundation`（F0.1–F0.3）：`ctx.pluginApi` 服务、分层 fail-safe guard、版本协商。
- `plugin-api-facade-integrity`（F0.4–F0.5）：门面完整性策略与链安全契约；本 feature 只做服务方法直通，不包装官方边界，不新增包装链。
- `plugin-api-events-m1`（E1–E12）：`pluginApi.events` 稳定事件总线与只读目录；L3/L6 通过向该目录追加两个 LLM 事件完成类型化稳定化。
- `llm-image-admission`（L1）：`pluginApi.llm.admission` 已存在；本 feature 在同一个 `pluginApi.llm` 命名空间上追加 L7/L8/L9 服务面，不得破坏或移除 `admission`。

**范围边界**：本 spec 的稳定化对象是 feature-list 已列出的 L3、L6、L7、L8、L9；未列出的官方 LLM 能力不得借本 spec 夹带实现。`pluginApi.events.catalog` 首版由 `plugin-api-events-m1` 冻结为 19 个事件；本 spec 仅追加 `llm/stream` 与 `llm/adapters-updated` 两个条目，不新增其他事件名。L3/L6 的 catalog 条目在 `plugin-api-events-m1` AC 7.2 的条目 schema 基础上**新增 `args` 字段**（描述 listener 实际收到的位置参数形状）；该扩展保持目录只读契约不变。追加后目录为 21 个事件，`plugin-api-events-m1` 的目录清单 AC 7.3/7.4 需按本 spec 第 8 节同步修订。

---

## Requirements

### 1. Typed `llm/stream` model-request waterfall (L3)

**User Story:** As a third-party plugin author, I want `llm/stream` to be a first-class typed waterfall event in `pluginApi.events`, so that I can subscribe to or participate in the model-request boundary through the supported facade instead of raw Cordis `ctx.on('llm/stream')`.

**Acceptance Criteria:**

1. GIVEN `pluginApi.events` is active, WHEN a plugin reads `pluginApi.events.catalog`, THEN the catalog SHALL contain an entry named `llm/stream` with at least: `mode: 'waterfall'`, `scopeFiltered: false`, `payload` describing the official `GenerateOptions` request object, `args` describing listener arguments `(options, next)`, `source: 'L3'`, and `type: 'A'`.
2. WHEN a third-party plugin calls `pluginApi.events.on('llm/stream', listener, opts?)`, THEN the facade SHALL register the listener for the official `llm/stream` waterfall with the same subscription/disposal/priority/fault-isolation guarantees as other cataloged waterfall events in `plugin-api-events-m1`.
3. GIVEN a listener registered through `pluginApi.events.on('llm/stream', listener)`, WHEN the official `dsh-llm` dispatches `llm/stream`, THEN the listener SHALL receive the official listener arguments `(options, next)`, the `options` object SHALL be deep-frozen before listener invocation per `plugin-api-events-m1` section 4, and the official waterfall semantics SHALL be preserved.
4. WHEN a plugin calls `pluginApi.events.waterfall('llm/stream', options, next)`, THEN the facade SHALL delegate to the underlying Cordis waterfall for `llm/stream` with the same `options` and `next` arguments and SHALL return its return value unchanged.
5. WHEN this feature is active, THEN the facade SHALL NOT install its own runtime `llm/stream` listener and SHALL NOT reorder or alter the official `llm/stream` dispatch chain; the L3 stabilization SHALL be limited to catalog/typing exposure plus the existing `pluginApi.events` subscription/dispatch contracts.
6. GIVEN the `pluginApi` service is inactive or the `events` feature is disabled, WHEN `pluginApi.events.on('llm/stream', ...)` or `pluginApi.events.waterfall('llm/stream', ...)` is called, THEN the facade SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT register or dispatch any listener.

**Type:** A（官方 `dsh-llm` 已 dispatch `llm/stream` waterfall；`dsh-llm/lib/index.js:1389`；`dsh-llm/lib/types/index.d.ts` `Events['llm/stream']`）

---

### 2. Typed `llm/adapters-updated` topology notification (L6)

**User Story:** As a third-party plugin author, I want `llm/adapters-updated` to be a first-class typed `emit` event in `pluginApi.events`, so that I can react to adapter topology changes through the facade without raw Cordis wiring or reading DSH source.

**Acceptance Criteria:**

1. GIVEN `pluginApi.events` is active, WHEN a plugin reads `pluginApi.events.catalog`, THEN the catalog SHALL contain an entry named `llm/adapters-updated` with at least: `mode: 'emit'`, `scopeFiltered: false`, `payload` documenting that the official event carries no payload, `args` describing listener arguments `()`, `source: 'L6'`, and `type: 'A'`.
2. WHEN a third-party plugin calls `pluginApi.events.on('llm/adapters-updated', listener, opts?)`, THEN the facade SHALL register the listener for the official `llm/adapters-updated` emit with the same subscription/disposal/priority/fault-isolation guarantees as other cataloged emit events in `plugin-api-events-m1`.
3. GIVEN a listener registered through `pluginApi.events.on('llm/adapters-updated', listener)`, WHEN the official `dsh-llm` emits `llm/adapters-updated`, THEN the listener SHALL be invoked with no payload arguments, and the official emit semantics SHALL be preserved.
4. WHEN this feature is active, THEN the facade SHALL NOT emit or synthesize `llm/adapters-updated` on its own, and SHALL NOT reorder or alter the official emit; the L6 stabilization SHALL be limited to catalog/typing exposure plus the existing `pluginApi.events` subscription contract.
5. GIVEN the `pluginApi` service is inactive or the `events` feature is disabled, WHEN `pluginApi.events.on('llm/adapters-updated', ...)` is called, THEN the facade SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT register any listener.

**Type:** A（官方 `dsh-llm` 已 emit `llm/adapters-updated` 且无 payload；`dsh-llm/lib/index.js:929`）

---

### 3. Read-only model-info query (L7)

**User Story:** As a third-party plugin author, I want `pluginApi.llm.modelInfo(provider, model, signal?)` to query the authoritative resolved model info through the facade, so that I can make routing/display decisions without importing `dsh-llm` internals or being able to mutate the model registry.

**Acceptance Criteria:**

1. GIVEN the `pluginApi.llm` feature is active, WHEN a plugin calls `pluginApi.llm.modelInfo(provider, model)`, THEN the facade SHALL delegate to the official `llm` service model-info resolution capability (`resolveModelInfo`) with the same `provider` and `model`, and SHALL return a `Promise` that resolves to the authoritative `LlmResolvedModelInfo` returned by the official service.
2. GIVEN the `pluginApi.llm` feature is active, WHEN a plugin calls `pluginApi.llm.modelInfo(provider, model, signal)`, THEN the facade SHALL forward the same `signal` value to the official resolution call.
3. WHEN the official resolution call returns an info object, THEN the object returned by the facade SHALL be read-only at runtime: the top-level object and every reachable object in its graph SHALL be deep-frozen (or the facade SHALL return a deep-frozen copy), and a caller mutation SHALL NOT alter the object observed by the official `llm` service or by other callers.
4. WHEN the official resolution call throws synchronously or rejects, THEN the facade SHALL rethrow/reject with the same error object and SHALL NOT mask, wrap, or replace it.
5. WHEN the `pluginApi.llm` feature is active, THEN `pluginApi.llm` SHALL NOT expose `resolveModelInfo` directly and SHALL NOT expose any method that modifies model info; the only model-info capability SHALL be the read-only `modelInfo` query.
6. GIVEN the `pluginApi` service is inactive or the `llm` feature is disabled, WHEN `pluginApi.llm.modelInfo(...)` is called, THEN the facade SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT call into the official `llm` service.

**Type:** A（官方 `dsh-llm` 已提供 `resolveModelInfo`；本仓库既有 design 已声明“不公开 ModelInfo 变更”，L7 只做只读查询）

---

### 4. Call preparation and streaming entry passthrough (L8)

**User Story:** As a third-party plugin author, I want `pluginApi.llm.prepareCall(config, signal?)` and `pluginApi.llm.stream(options)` as stable passthroughs to the official `llm` service, so that I can prepare model calls and start streams through the supported facade without importing `dsh-llm`.

**Acceptance Criteria:**

1. GIVEN the `pluginApi.llm` feature is active, WHEN a plugin calls `pluginApi.llm.prepareCall(config, signal?)`, THEN the facade SHALL delegate to the official `llm` service `prepareCall` method with the same `config` and, when provided, the same `signal`, and SHALL return the official return value unchanged.
2. GIVEN the `pluginApi.llm` feature is active, WHEN a plugin calls `pluginApi.llm.stream(options)`, THEN the facade SHALL delegate to the official `llm` service `stream` method with the same `options`, and SHALL return the official return value unchanged.
3. WHEN either official method throws synchronously or rejects, THEN the facade SHALL rethrow/reject with the same error object and SHALL NOT mask, wrap, or replace it.
4. WHEN the facade handles these calls, THEN it SHALL NOT wrap, cache, alter, or re-dispatch the request/stream; in particular `pluginApi.llm.stream(options)` SHALL NOT inject an extra `llm/stream` dispatch or listener around the official call.
5. GIVEN the `pluginApi` service is inactive or the `llm` feature is disabled, WHEN `pluginApi.llm.prepareCall(...)` or `pluginApi.llm.stream(...)` is called, THEN the facade SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT call into the official `llm` service.

**Type:** A（官方 `dsh-llm` 已提供 `prepareCall` / `stream`；`dsh-llm/lib/index.js:1271/1384`）

---

### 5. Provider registration passthrough (L9)

**User Story:** As a provider/adapter plugin author, I want `registerAdapter`, `registerConfigurableProviders`, and `registerModelDiscovery` exposed through `pluginApi.llm`, so that I can register providers, configurable provider entries, and model-discovery hooks through the supported facade instead of importing `dsh-llm`.

**Acceptance Criteria:**

1. GIVEN the `pluginApi.llm` feature is active, WHEN a plugin calls `pluginApi.llm.registerAdapter(providers, adapter)`, THEN the facade SHALL delegate to the official `llm` service `registerAdapter` method with the same `providers` and `adapter`, and SHALL return the official return value unchanged.
2. GIVEN the `pluginApi.llm` feature is active, WHEN a plugin calls `pluginApi.llm.registerConfigurableProviders(entries)`, THEN the facade SHALL delegate to the official `llm` service `registerConfigurableProviders` method with the same `entries`, and SHALL return the official return value unchanged.
3. GIVEN the `pluginApi.llm` feature is active, WHEN a plugin calls `pluginApi.llm.registerModelDiscovery(settingsNs, discover)`, THEN the facade SHALL delegate to the official `llm` service `registerModelDiscovery` method with the same `settingsNs` and `discover`, and SHALL return the official return value unchanged.
4. WHEN the facade handles these calls, THEN it SHALL NOT wrap, cache, clone, or alter the provider/adapter/entries/discover arguments, and SHALL NOT change the disposer/error semantics of the official methods.
5. WHEN any of these official methods throws synchronously, THEN the facade SHALL rethrow the same error object and SHALL NOT mask, wrap, or replace it.
6. GIVEN the `pluginApi` service is inactive or the `llm` feature is disabled, WHEN any of `pluginApi.llm.registerAdapter(...)`, `pluginApi.llm.registerConfigurableProviders(...)`, or `pluginApi.llm.registerModelDiscovery(...)` is called, THEN the facade SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT call into the official `llm` service.

**Type:** A（官方 `dsh-llm` 已提供这些 provider 注册方法；`dsh-llm/lib/index.js:960` 起，面向 provider/adapter 插件）

---

### 6. Feature guard and fail-safe behavior

**User Story:** As an operator, I want the LLM namespace to fail safe when official `llm` capabilities are missing or malformed, so that a broken profile never kills harness boot and third-party plugins get a clear typed error instead of a missing-service crash.

**Acceptance Criteria:**

1. WHEN the `llm` feature guard runs, THEN it SHALL probe the official `llm` service and the methods required by sections 3–5 (`resolveModelInfo`, `prepareCall`, `stream`, `registerAdapter`, `registerConfigurableProviders`, `registerModelDiscovery`) before exposing `pluginApi.llm`.
2. GIVEN one or more required `llm` methods are missing or not functions, WHEN the facade applies, THEN `pluginApi.llm` service methods SHALL be disabled and SHALL produce the feature-disabled typed error; `pluginApi` itself SHALL remain in the active/inert state defined by `plugin-api-foundation`, and the apply SHALL NOT throw.
3. GIVEN the `llm` feature is disabled, WHEN a plugin reads `pluginApi.events.catalog`, THEN the catalog SHALL still contain the `llm/stream` and `llm/adapters-updated` entries as long as `pluginApi.events` itself is active, because these entries are pure subscription metadata and do not require the `llm` service to be present.
4. WHEN the facade exposes `pluginApi.llm`, THEN it SHALL preserve the already-delivered `pluginApi.llm.admission` surface from `llm-image-admission`; the L7/L8/L9 additions SHALL NOT remove, rename, or change the return type of `admission.register` or `admission.isActive`.
5. WHEN any `pluginApi.llm` method is called while `pluginApi.llm` is disabled, THEN the facade SHALL produce the foundation-defined typed inactive/feature-disabled error before touching the official `llm` service.
6. WHEN this feature is implemented, THEN no file under the official DSH checkout (`/usr/lib/node_modules/@deepseek-ai/dsh/`，实际官方包位于其 `node_modules/@deepseek-ai/` 下，见 feature-list §1.4) SHALL be modified, and the facade SHALL only consume the injected official `llm` service through its public methods.

**Type:** 门面基础 + A（fail-safe 来自 foundation 铁律；guard 探针针对 A 类官方服务）

---

### 7. Testability and regression coverage

**User Story:** As a maintainer, I want all five LLM features covered by `node --test` with mocked Cordis/official services, so that the LLM namespace stabilizations are regression-safe without booting a real harness.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN tests SHALL assert that `pluginApi.events.catalog` contains `llm/stream` and `llm/adapters-updated` with the exact metadata required by AC 1.1 and AC 2.1, and SHALL assert the catalog remains read-only.
2. WHEN `node --test` runs, THEN tests SHALL cover `events.on('llm/stream', ...)` receiving frozen `(options, next)` from a mocked official waterfall dispatch, and `events.waterfall('llm/stream', ...)` delegating to the mocked context with the same arguments and return value (L3).
3. WHEN `node --test` runs, THEN tests SHALL cover `events.on('llm/adapters-updated', ...)` being invoked with no arguments from a mocked official emit dispatch (L6).
4. WHEN `node --test` runs, THEN tests SHALL cover `pluginApi.llm.modelInfo(provider, model, signal?)` delegation, deep-frozen/read-only returned info, signal forwarding, and same-error rethrow on official failure (L7).
5. WHEN `node --test` runs, THEN tests SHALL cover `pluginApi.llm.prepareCall(config, signal?)` and `pluginApi.llm.stream(options)` passthrough return values, argument identity, and same-error rethrow on official failure (L8).
6. WHEN `node --test` runs, THEN tests SHALL cover `registerAdapter`, `registerConfigurableProviders`, and `registerModelDiscovery` passthrough return values, argument identity, and same-error rethrow on official failure (L9).
7. WHEN `node --test` runs, THEN tests SHALL cover the inactive/feature-disabled error paths for every method in sections 3–5, the `llm` feature-guard probe matrix, and SHALL assert that applying the facade never throws.
8. WHEN `node --test` runs, THEN tests SHALL assert that `pluginApi.llm` does not expose `resolveModelInfo` or any model-info mutation method (L7 read-only guarantee).
9. WHEN `node --test` runs, THEN all existing regression tests for `plugin-api-foundation`, `plugin-api-facade-integrity`, `llm-image-admission`, and `plugin-api-events-m1` SHALL remain passing.
10. GIVEN a mocked Cordis context and mocked official `llm` service, WHEN `node --test` runs, THEN no test SHALL require booting a real harness.

**Type:** 质量门

---

### 8. Documentation synchronization (governance)

**User Story:** As a maintainer, I want the repository-wide feature list and AGENTS.md to reflect the delivered LLM namespace feature, so that documentation does not drift from code.

**Acceptance Criteria:**

1. GIVEN `plugin-api-llm-m1` has been delivered, WHEN a maintainer reads `AGENTS.md` section 8, THEN it SHALL contain an entry with feature name `plugin-api-llm-m1`, scope `L3, L6, L7, L8, L9`, status `delivered`, spec directory `docs/specs/plugin-api-llm-m1/`, and the key design constraints of this feature.
2. GIVEN `plugin-api-llm-m1` has been delivered, WHEN a maintainer reads `docs/specs/plugin-api-features/feature-list.md`, THEN the status of L3, L6, L7, L8, and L9 SHALL be updated to `delivered`, and any public API shape changes decided in this feature SHALL be reflected in the feature-list table.
3. GIVEN `plugin-api-llm-m1` has been delivered, WHEN a maintainer reads `docs/specs/plugin-api-events-m1/requirements.md` AC 7.3/7.4, THEN the repository SHALL have amended those catalog statements to reflect the extension introduced by this feature: AC 7.3 SHALL list the two additional event names `llm/stream` and `llm/adapters-updated`, and AC 7.4 SHALL be adjusted so those two names are no longer treated as outside-scope.

**Type:** 治理要求（AGENTS.md 第 8 节防过期规则）
