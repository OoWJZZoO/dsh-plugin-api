# Feature Requirements: plugin-api-settings-m1

## Introduction

`plugin-api-settings-m1` 是 `dsh-plugin-api` 的 **M1 settings 命名空间 feature**，覆盖 feature-list 第 6 行任务：

- **ST1**：`pluginApi.settings.register(ns, schema, {base, applies, validate})` 类型化命名空间注册；
- **ST2**：`pluginApi.settings.scope<T>(ns)` 设置作用域（`get/watch/update/replace/mutate`）；
- **ST3**：`settings/updated`、`settings/document-updated` 设置事件类型化订阅；
- **ST8**：`settings.describe({redactSecrets})` 稳定直通与 `installSettingsSection` 安装 helper。

本 feature 只覆盖 **host 侧**。client 侧 settings scope（C3）、settings 可视化配置桥（ST4/ST5/ST6）与 `WEB_SETTINGS_NAMESPACES` 动态化（ST7）明确不在本 spec 范围；本 spec 不产生新的 C 类上游提案。

**类型标注**：ST1/ST2/ST3/ST8 均为 **A 类**（官方 `dsh-settings` 已提供服务 / 已 dispatch，只需稳定化）。其中 ST2 有两处对 feature-list 形状的**忠实性修正**，均不改官方语义、不发明新行为：

1. **`mutate` 的归属**：官方 `SettingsScope<T>`（`dsh-settings/lib/types/index.d.ts:85-111`）只有 `get/watch/update/replace`；`mutate(ns, ops, expectedRevision?)` 是官方 `SettingsProvider` 的 provider 级方法（同文件 `:275`）。本 spec 把 `mutate(ops, expectedRevision?)` 作为**绑定便利方法**暴露在门面返回的 scope handle 上，底层调用官方 `ctx.settings.mutate(ns, ops, expectedRevision?)`，语义不变。
2. **`scope(ns)` 的来源**：官方 `SettingsProvider` 没有 `scope(ns)` 访问器，只有 `get(ns)`（同文件 `:239`）。本 spec 定义 `pluginApi.settings.scope(ns)` 为**门面便利访问器**：返回此前通过 `pluginApi.settings.register` 注册同一 `ns` 时创建的那个 scope handle；对未通过门面注册的 `ns` 产生门面定义的 typed error，绝不返回半初始化 handle。

**可选 settings 服务模式**：官方 `settings` 服务是可选 seam（`installSettingsSection` 在服务缺失时保持 no-op fallback）。因此当 core 活跃时，本 feature **不因 `ctx.settings` 缺失而整体禁用**；`register` / `scope` / `describe` 在调用时若服务不可用则产生门面定义的 typed service-unavailable error，`installSettingsSection` 则保持官方的可选装配语义（服务缺失时 fallback 到 `entry`，不注册、不抛错）。仅当官方 `settings` 服务存在但形状不完整（缺 `register`/`describe`/`get`/`mutate`）时，feature guard 才在启动期禁用本 feature。

**依赖**：

- `plugin-api-foundation`（F0.1–F0.3）：`ctx.pluginApi` 服务、分层 fail-safe guard、版本协商；本 feature 的 disabled/inactive 错误行为遵循其定义。
- `plugin-api-facade-integrity`（F0.4–F0.5）：直通与包装链安全；本 feature 不包装官方服务方法，只做直通，不触碰其他插件可能存在的包装链。
- `plugin-api-events-m1`：ST3 复用 `pluginApi.events.on/once` 的订阅面与故障隔离；本 feature 把 `settings/updated`、`settings/document-updated` 两个事件**追加进** `pluginApi.events.catalog`（即对 events-m1 “首版 19 个事件”的快照做一次范围扩展，events-m1 已有条目保持不变）。

**源码依据**：`@deepseek-ai/dsh-settings` `lib/types/index.d.ts` 与 `lib/index.js`（`register` L311、`describe` L352、`mutate` L430、`settings/document-updated` L523、`settings/updated` L561、`installSettingsSection` L618）。

---

## Requirements

### 1. Settings namespace registration (ST1)

**User Story:** As a third-party plugin author, I want a typed `pluginApi.settings.register(ns, schema, options?)` that delegates to the official `ctx.settings.register`, so that I can declare my settings namespace once and receive an owner scope without importing `@deepseek-ai/dsh-settings`.

**Acceptance Criteria:**

1. GIVEN the settings feature is active and the official `settings` service is available, WHEN a third-party plugin calls `pluginApi.settings.register(ns, schema, options?)`, THEN the facade SHALL delegate to the official `ctx.settings.register(ns, schema, options)` exactly once and SHALL return a facade scope handle for `ns`.
2. WHEN the returned scope handle is used, THEN its `watch`, `update`, and `replace` methods SHALL have the same observable semantics as the official `SettingsScope<T>` returned by `ctx.settings.register`; its `get` method SHALL delegate to the official provider read `ctx.settings.get(ns)` (so a disposed registration reads as unregistered); and its `mutate(ops, expectedRevision?)` method SHALL have the same observable semantics as `ctx.settings.mutate(ns, ops, expectedRevision?)` for that namespace.
3. WHEN `options` is omitted, THEN the facade SHALL call the official `register` with `undefined` options, preserving the official defaults (no composition `base`, `applies: 'live'`).
4. WHEN `options` supplies `base`, `applies`, or `validate`, THEN the facade SHALL pass each of them through to the official `register` unchanged and SHALL NOT add, remove, or transform them.
5. WHEN `ns` fails the official namespace pattern or is already registered, THEN the official error SHALL surface to the caller unchanged; the facade SHALL NOT pre-validate, catch, translate, or partially register the namespace.
6. GIVEN the registration is an effect on the calling plugin's fiber, WHEN that fiber is disposed, THEN the official registration effect SHALL remove the namespace, and later reads/writes through the returned handle SHALL surface the official not-registered/disposed behavior.
7. WHEN the settings feature is disabled or `pluginApi` is inactive, THEN `register` SHALL produce the foundation-defined typed feature-disabled/inactive error and SHALL NOT call into the official `settings` service.
8. GIVEN the settings feature is active and the official `settings` service is unavailable at call time, WHEN `register` is called, THEN the facade SHALL produce a defined typed service-unavailable error and SHALL NOT call into any official service.

**Type:** A（官方 `dsh-settings` 已提供 `register`；AC 1.7/1.8 为门面基础 fail-safe）

---

### 2. Settings scope access (ST2)

**User Story:** As a third-party plugin author, I want `pluginApi.settings.scope<T>(ns)` to reacquire the scope handle for a namespace I registered through the facade, so that I can read, watch, and write my settings namespace without storing the registration return value.

**Acceptance Criteria:**

1. GIVEN `ns` was registered through `pluginApi.settings.register`, WHEN the plugin calls `pluginApi.settings.scope(ns)`, THEN the facade SHALL return the same scope handle that the matching `register` call returned for that namespace.
2. WHEN `ns` was not registered through `pluginApi.settings.register`, THEN the facade SHALL produce a defined typed error and SHALL NOT return a partial or half-initialized scope handle.
3. WHEN `handle.get()` is called, THEN it SHALL return the current resolved value for `ns` as produced by the official settings resolution (schema defaults, then composition `base`, then the user layer), with the same read-only/frozen guarantees as the official scope.
4. WHEN `handle.watch(callback)` is called, THEN `callback` SHALL be invoked after each committed resolved-value change for `ns` with the official `(next, prev)` arguments, one callback invocation at a time in commit order; the returned disposer SHALL remove the observer, and after the disposer returns no further invocation SHALL start.
5. WHEN a watcher callback throws or returns a rejected promise, THEN the failure SHALL be contained and logged exactly as the official `SettingsScope.watch` containment does; it SHALL NOT reject or throw through the commit path.
6. WHEN `handle.update(patch)` is called, THEN the facade SHALL delegate to the official scope's `update` for `ns` and SHALL preserve the official JSON-compatibility validation, serialized write queue, persistence, and `SettingsConflictError` behavior.
7. WHEN `handle.replace(section)` is called, THEN the facade SHALL delegate to the official scope's `replace` for `ns` and SHALL preserve the official wholesale-reset semantics (`replace({})` re-inherits `base` and schema defaults).
8. WHEN `handle.mutate(ops, expectedRevision?)` is called, THEN the facade SHALL delegate to the official provider method `ctx.settings.mutate(ns, ops, expectedRevision?)` for that namespace and SHALL preserve the official ordered path-op semantics, JSON validation, and `SettingsConflictError` behavior.
9. WHEN the settings feature is disabled or `pluginApi` is inactive, THEN `scope`, and every method on a scope handle obtained from it, SHALL produce the foundation-defined typed feature-disabled/inactive error and SHALL NOT call into the official `settings` service.
10. GIVEN the settings feature is active and the official `settings` service is unavailable at call time, WHEN `scope` is called, THEN the facade SHALL produce a defined typed service-unavailable error and SHALL NOT call into any official service.

**Type:** A（`get/watch/update/replace` 直通官方 `SettingsScope`；`mutate` 直通官方 provider 方法；scope 访问器为门面便利层，不新增设置语义）

---

### 3. Settings change events (ST3)

**User Story:** As a third-party plugin author, I want typed subscriptions to `settings/updated` and `settings/document-updated` through `pluginApi.events`, so that I can react to committed setting changes and document revisions using the same stable event bus as other M1 features.

**Acceptance Criteria:**

1. GIVEN the settings feature is active, WHEN a plugin subscribes with `pluginApi.events.on('settings/updated', listener)`, THEN `listener` SHALL be invoked whenever the official `settings/updated` event is dispatched, with the official positional arguments `(ns, next, prev, source)`, where `ns` is the settings namespace, `next`/`prev` are the new/previous resolved values, and `source` is `'update' | 'provider'`.
2. WHEN a plugin subscribes with `pluginApi.events.once('settings/updated', listener)`, THEN `listener` SHALL be invoked at most once for the first matching dispatch after subscription, with the arguments required by AC 3.1.
3. GIVEN the settings feature is active, WHEN a plugin subscribes with `pluginApi.events.on('settings/document-updated', listener)`, THEN `listener` SHALL be invoked whenever the official `settings/document-updated` event is dispatched, with the official positional arguments `(ns, revision)`.
4. WHEN `pluginApi.events.once('settings/document-updated', listener)` is used, THEN the listener SHALL be invoked at most once for the first matching dispatch after subscription, with the arguments required by AC 3.3.
5. WHEN `pluginApi.events.catalog` is read while the settings feature is active, THEN it SHALL contain a `settings/updated` entry with at least: `mode: 'emit'`, `scopeFiltered: false`, `source: 'ST3'`, `type: 'A'`, and a payload signature describing `(ns, next, prev, source)`.
6. WHEN `pluginApi.events.catalog` is read while the settings feature is active, THEN it SHALL contain a `settings/document-updated` entry with at least: `mode: 'emit'`, `scopeFiltered: false`, `source: 'ST3'`, `type: 'A'`, and a payload signature describing `(ns, revision)`.
7. WHEN the settings feature is active, THEN the two catalog entries in AC 3.5 and AC 3.6 SHALL be added to the delivered `plugin-api-events-m1` catalog without removing or altering any existing catalog entry.
8. WHEN a facade-registered settings event listener throws or returns a rejected promise, THEN the failure SHALL be contained per the `plugin-api-events-m1` listener fault isolation contract; it SHALL NOT prevent remaining listeners or the official dispatch from running, except that official `INVARIANT`-coded failures retain their official rethrow behavior.
9. WHEN the settings feature is disabled or `pluginApi` is inactive, THEN `pluginApi.events.on/once` for these two event names SHALL produce the foundation-defined typed feature-disabled/inactive error and SHALL NOT register any listener.

**Type:** A（官方 `dsh-settings` 已 dispatch 两个事件；`pluginApi.events` 提供类型化订阅与故障隔离）

---

### 4. Settings describe and install helper (ST8)

**User Story:** As a third-party plugin author, I want `pluginApi.settings.describe({redactSecrets})` and `pluginApi.settings.installSettingsSection(...)` as stable helpers, so that I can describe settings for configuration surfaces and wire optional-settings consumers without importing `@deepseek-ai/dsh-settings`.

**Acceptance Criteria:**

1. GIVEN the settings feature is active, WHEN a plugin calls `pluginApi.settings.describe(options?)`, THEN the facade SHALL delegate to the official `ctx.settings.describe(options)` exactly once and SHALL return the official descriptor array unchanged.
2. WHEN `describe` is called with `{redactSecrets: true}`, THEN each returned descriptor SHALL contain the official redaction results: `role('secret')` fields SHALL be stripped from `value`/`base`/`user`, and each descriptor SHALL include the `secrets` sidecar; the facade SHALL NOT add, remove, or reorder descriptors or descriptor fields.
3. WHEN `describe` is called without options, THEN each returned descriptor SHALL contain the official verbatim `value` (and `base`/`user` when present) without a `secrets` field, exactly as the official `describe` does.
4. GIVEN the settings feature is active, WHEN a plugin calls `pluginApi.settings.installSettingsSection(ctx, ns, schema, entry, hooks)`, THEN the facade SHALL provide behavior equivalent to the official `installSettingsSection`: while the official `settings` service exists, the facade SHALL register `ns` with `base: entry` (and `validate` when `hooks.validate` is provided) and SHALL drive `hooks.setSource` with a thunk returning the currently authoritative resolved value, and SHALL call `hooks.onChange` after attach and after each committed change.
5. WHEN the settings service is not mounted, or is disposed/reloaded while `installSettingsSection` wiring is active, THEN the wiring SHALL fall back to the consumer's `entry` value and SHALL continue calling `hooks.setSource(() => entry)` and `hooks.onChange()` without throwing.
6. WHEN the settings service has never been mounted, THEN `installSettingsSection` SHALL NOT register anything, SHALL NOT call `hooks.setSource` or `hooks.onChange` for a settings attach, and SHALL NOT throw.
7. WHEN the settings feature is disabled or `pluginApi` is inactive, THEN `describe` and `installSettingsSection` SHALL produce the foundation-defined typed feature-disabled/inactive error and SHALL NOT call into the official `settings` service.
8. GIVEN the settings feature is active and the official `settings` service is unavailable at call time, WHEN `describe` is called, THEN the facade SHALL produce a defined typed service-unavailable error and SHALL NOT call into any official service; `installSettingsSection` SHALL keep the official no-op fallback behavior described in AC 4.5 and AC 4.6.

**Type:** A（`describe` 直通官方 provider 方法；`installSettingsSection` 行为等价于官方 helper；AC 4.7/4.8 为门面基础 fail-safe）

---

### 5. Testability and regression coverage

**User Story:** As a maintainer, I want ST1/ST2/ST3/ST8 covered by `node --test` with mocked Cordis/official settings services, so that the settings facade is regression-safe without booting a real harness.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN tests SHALL cover `register` delegation arguments, returned scope-handle methods (`get/watch/update/replace/mutate`), duplicate/invalid namespace error passthrough, and fiber-disposal behavior (ST1).
2. WHEN `node --test` runs, THEN tests SHALL cover `scope(ns)` returning the same handle for a facade-registered namespace, the typed error for a non-facade-registered namespace, watcher invocation/disposal/containment, and `update`/`replace`/`mutate` delegation including `SettingsConflictError` passthrough (ST2).
3. WHEN `node --test` runs, THEN tests SHALL cover `pluginApi.events.on/once` delivery for both `settings/updated` and `settings/document-updated` with the official positional arguments, catalog entries for both events, and listener fault containment (ST3).
4. WHEN `node --test` runs, THEN tests SHALL cover `describe` passthrough with and without `redactSecrets`, including the `secrets` sidecar, and `installSettingsSection` attach/fallback/validate/no-settings behavior (ST8).
5. WHEN `node --test` runs, THEN tests SHALL cover the disabled-feature, inactive-`pluginApi`, and service-unavailable error paths for every public method in this spec, and SHALL assert that applying the settings feature never throws (fail-safe).
6. GIVEN a mocked Cordis context, a mocked official `settings` service, and a mocked `pluginApi.events` surface, WHEN `node --test` runs, THEN no test SHALL require booting a real harness.

**Type:** 质量门
