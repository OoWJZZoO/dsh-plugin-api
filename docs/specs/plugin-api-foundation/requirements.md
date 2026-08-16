# Feature Requirements: plugin-api-foundation

## Introduction

`plugin-api-foundation` 是 `dsh-plugin-api` 的 **M0 基础三件套**，合并了 feature-list 中的 F0.1 / F0.2 / F0.3：

- **F0.1 门面服务**：host 插件注册 Cordis Service `ctx.pluginApi`（`inject: ['pluginApi']`），作为第三方插件的**推荐、受支持**门面入口；第三方插件可绕过门面直接使用 `@deepseek-ai/dsh-*` 内部包，但该路径被明确标记为 **unsupported escape hatch**。
- **F0.2 fail-safe guard**：分层自检——核心基础（服务注册/版本协商）失败时，服务仍注册但保持 inert；仅某个非核心 feature 失败时，门面照常启动、显式报错并只禁用该 feature。任何失败都记录可读诊断，**绝不抛穿 apply**。
- **F0.3 版本协商（双向）**：① 门面对 DSH runtime——`package.json` 增加 `dsh.api` 声明，runtime 不满足时门面安全 inert；② 第三方插件对门面——插件声明所需门面 API 版本，不满足时插件收到显式 typed 错误并 fail-fast，门面保持 active。

本 feature 只覆盖 **host 侧**；client bundle / remote / slot 等属于 M3，不在本 spec 范围内。

类型标注：F0.1–F0.3 均为 **门面基础**（非 A/B/C 钩子）。本 spec 不包含 C 类上游提案；后续命名空间 spec（events/llm/agent/…）再各自标注 A/B/C。

---

## Requirements

### 1. Facade service registration and injection (F0.1)

**User Story:** As a third-party plugin author, I want to obtain the facade by declaring `inject: ['pluginApi']`, so that I use one supported entry point without importing `@deepseek-ai/dsh-*` internal modules.

**Acceptance Criteria:**

1. WHEN the `dsh-plugin-api` host plugin is applied to a Cordis context before third-party plugins, THEN that context SHALL provide a service named `pluginApi` that is injectable as `ctx.pluginApi` via `inject: ['pluginApi']`.
2. WHEN a third-party plugin consumes the facade through `ctx.pluginApi`, THEN it SHALL NOT be required to import any `@deepseek-ai/dsh-*` internal module.
3. WHEN the `dsh-plugin-api` host plugin has not been applied, THEN third-party plugins SHALL observe a normal missing-service condition for `pluginApi` and SHALL NOT receive a partially initialized facade.
4. WHEN the host plugin is applied more than once in the same context (for example reload/HMR), THEN service registration SHALL be idempotent: the effective `ctx.pluginApi` SHALL be equivalent to a single registration.

**Type:** 门面基础

---

### 2. Recommended facade and unsupported escape hatch (F0.1)

**User Story:** As a maintainer, I want the facade to be the recommended and supported entry point while advanced plugins may bypass it, so that the facade only promises what it can actually enforce and does not block legitimate escape routes.

**Acceptance Criteria:**

1. WHEN a third-party plugin obtains `ctx.pluginApi`, THEN the facade documentation SHALL present `ctx.pluginApi` as the recommended, supported entry point with stability, version-negotiation, and fail-safe guarantees.
2. WHEN a third-party plugin directly imports or injects `@deepseek-ai/dsh-*` internal packages, THEN the facade SHALL NOT intercept, patch, block, or otherwise alter that interaction.
3. WHEN a third-party plugin uses the direct internal-package path, THEN that path SHALL be documented as an **unsupported escape hatch** with no compatibility promise, no version-negotiation protection, and no fail-safe guarantee from the facade.
4. WHEN official internal packages change incompatibly, THEN compatibility guarantees SHALL apply only to plugins using `ctx.pluginApi`; plugins on the escape hatch SHALL be expected to adapt or break on their own.

**Type:** 门面基础 / policy

> F0.4 权威定义见 `plugin-api-facade-integrity/requirements.md` §1；本节仅保留政策概述，若冲突以该文件为准。

---

### 3. Layered fail-safe guard: core inert mode and per-feature degradation (F0.2)

**User Story:** As a DeepSeek Harness operator, I want the facade to degrade by feature instead of dying as a whole, so that a broken non-core contract is reported explicitly while the healthy core still boots, and a broken core contract never kills harness boot.

**Acceptance Criteria:**

1. GIVEN the core self-check (facade service contract and version negotiation) passes, WHEN the host plugin applies, THEN `ctx.pluginApi.isActive` SHALL be `true`.
2. GIVEN the core self-check detects a missing or changed official contract required by the facade core, WHEN the host plugin applies, THEN the facade SHALL log a readable diagnostic and return from `apply` without throwing. IF the failed core probe is not `ctx.plugin` or `ctx.reflect.provide`, THEN `ctx.pluginApi` SHALL remain registered with `isActive === false`. IF the failed core probe is `ctx.plugin` or `ctx.reflect.provide`, THEN no `pluginApi` service SHALL be registered, the facade SHALL NOT preset any global state, and consumers SHALL observe Cordis native missing-service behavior.
3. GIVEN the core self-check passes and the self-check reports one or more non-core feature contract failures, WHEN the host plugin applies, THEN the facade SHALL boot active (`ctx.pluginApi.isActive === true`) and SHALL disable only the failed feature(s).
4. WHEN the facade disables a feature under AC 3, THEN the facade SHALL report that failure explicitly through a readable log and an observable per-feature disabled state (for example a feature-level status entry readable by consumers).
5. WHEN a consumer invokes an API of a feature disabled under AC 3, THEN that API SHALL produce a clear, typed feature-disabled error and SHALL NOT call into official services.
6. WHEN `ctx.pluginApi.isActive` is `false`, THEN any facade API method invoked by a consumer SHALL produce a clear, typed inactive-state error (or an equivalent defined inactive signal) and SHALL NOT call into official services.
7. WHEN the core guard fails, THEN the facade SHALL NOT install any official-boundary hook or wrapper. WHEN only a non-core feature guard fails, THEN the facade SHALL NOT install official-boundary hooks or wrappers for that failed feature only.
8. WHEN any guard failure occurs, THEN harness boot SHALL continue and the facade SHALL NOT be the cause of boot failure.

**Type:** 门面基础 / fail-safe

---

### 4. Bidirectional API version negotiation (F0.3)

**User Story:** As a plugin author or operator, I want both mismatch directions to fail explicitly and safely — the facade disables itself when the DSH runtime is incompatible, and a third-party plugin fails fast when the facade does not satisfy the plugin's declared requirement — so that neither side misbehaves on a version mismatch.

**Contract granularity:** In this spec, "satisfies" (both directions) means: each version is normalized to `major.minor` and the two normalized values are equal. Patch and prerelease differences are considered compatible and SHALL NOT be treated as a mismatch.

**Acceptance Criteria — direction ① facade ↔ DSH runtime:**

1. WHEN the `dsh-plugin-api` package is installed, THEN its `package.json` SHALL declare a machine-readable API version contract under the `dsh` field (`dsh.api`) that the facade checks at apply time.
2. GIVEN the runtime satisfies the declared API contract, WHEN the host plugin applies, THEN the facade SHALL treat runtime version negotiation as passed and proceed with the environment guard checks.
3. GIVEN the runtime does not satisfy the declared API contract, WHEN the host plugin applies, THEN the facade SHALL log a readable version-mismatch diagnostic and enter inert mode (`isActive === false`) without throwing through `apply`.
4. GIVEN the `dsh.api` declaration or the runtime version metadata is missing or unparseable, WHEN the host plugin applies, THEN the facade SHALL treat the situation as a mismatch and enter inert mode with a readable diagnostic.
5. WHEN runtime version negotiation fails, THEN the facade SHALL NOT install any official-boundary hook or wrapper.
6. WHEN runtime version negotiation fails, THEN plugins using the unsupported escape hatch SHALL NOT be blocked, patched, or warned by the facade; the runtime version check SHALL govern facade consumers only.

**Acceptance Criteria — direction ② third-party plugin ↔ facade:**

7. WHEN a third-party plugin declares the facade API version it requires, THEN the facade SHALL expose a defined compatibility check that the plugin can invoke at apply time.
8. GIVEN the running facade satisfies the plugin's declared requirement, WHEN the plugin applies, THEN the facade SHALL permit normal use of `ctx.pluginApi`.
9. GIVEN the running facade does not satisfy the plugin's declared requirement, WHEN the plugin applies or first invokes the compatibility check, THEN the facade SHALL produce a typed, readable version error to that plugin and the plugin SHALL NOT proceed with facade API calls.
10. WHEN a plugin-side version mismatch occurs, THEN the facade itself SHALL remain active for other compatible plugins; a plugin-side mismatch SHALL NOT disable or alter the facade.
11. WHEN an incompatible plugin is loaded by the platform, THEN the facade SHALL document that preventing the plugin's load before apply is a platform-level gap and SHALL NOT attempt to unload or terminate the plugin itself.

**Type:** 门面基础（方向 ② 的平台级预加载拦截如需实现，属于 C 类上游提案，本 spec 不展开）

---

### 5. Testability and regression coverage

**User Story:** As a maintainer, I want the foundation behavior to be testable with `node --test` and mocked Cordis/official services, so that regressions in service registration, guard behavior, and version negotiation are caught quickly without booting a real harness.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN service registration/injection, core inert-mode behavior, per-feature degradation, version-negotiation decisions, and escape-hatch non-interference SHALL be covered by automated tests.
2. GIVEN a mocked Cordis context and mocked official services, WHEN the host plugin is applied, THEN tests SHALL assert active core, core inert, and per-feature disabled states without booting a real harness.
3. WHEN the core guard fails, THEN tests SHALL assert that no official-boundary hook is installed, that no error is thrown through `apply`, and that facade methods report the inactive state. WHEN only a non-core feature guard fails, THEN tests SHALL assert that the core stays active, the failed feature is observably disabled, and hooks are installed only for healthy features.
4. WHEN runtime version metadata is mismatched, missing, or unparseable, THEN tests SHALL assert inert mode and a readable diagnostic. WHEN a plugin's declared facade-version requirement is not satisfied, THEN tests SHALL assert that the plugin receives a typed, readable version error, that the facade remains active, and that no facade API call proceeds for that plugin.
5. WHEN a third-party plugin bypasses the facade and interacts with internal packages directly, THEN tests SHALL assert that the facade does not intercept or alter that interaction.

**Type:** 质量门
