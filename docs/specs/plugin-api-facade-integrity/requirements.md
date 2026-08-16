# Feature Requirements: plugin-api-facade-integrity

## Introduction

`plugin-api-facade-integrity` 合并 feature-list 中的 **F0.4 符号解析门面** 与 **F0.5 包装链安全**，把门面的完整性契约显式化：

- **F0.4**：`ctx.pluginApi` 是第三方插件**推荐、受支持**的符号解析/inject 面；直连 `@deepseek-ai/dsh-*` 内部包属于 unsupported escape hatch（门面不拦截、不保障）。
- **F0.5**：门面安装的任何包装必须链安全——dispose 用 identity-guard；目标被其他插件包装时降级透传，绝不拆别人的链；重复安装不嵌套。当前 `lib/admission-bridge.js` 的 identity-guard 将正式化为可复用契约/模块并重构接入。

### Dependencies

- 依赖 **`plugin-api-foundation`（F0.1–F0.3）**：`ctx.pluginApi` 服务、分层 fail-safe guard、双向版本协商是本 feature 的前置基础。
- 依赖 **`llm-image-admission`**：其 `lib/admission-bridge.js` 已交付 identity-guard 包装链行为，是本 feature F0.5 正式化/重构的迁移基线。
- **F0.4 定义关系**：本文件是 **F0.4 的权威定义**。`plugin-api-foundation/requirements.md` §2 仅保留政策概述，并应在 Stage 4 增加指向本文件的引用，不再重复定义 F0.4 验收标准；若两者冲突，以本文件为准。

本 feature 只覆盖 host 侧的门面完整性策略与链安全机制，不新增任何命名空间（events/llm/agent/…）的 API，也不实现 client 侧。F0.4 中“随各命名空间逐步覆盖”的符号解析扩展属于后续命名空间 spec 的交付范围，本 spec 只确立解析策略与可验收的文档/测试约束。

类型标注：F0.4 / F0.5 均为 **门面基础**（非 A/B/C 钩子）。本 spec 不包含 C 类上游提案。

---

## Requirements

### 1. Recommended symbol-resolution facade (F0.4)

**User Story:** As a third-party plugin author, I want all stable facade symbols to be reachable through `ctx.pluginApi`, so that I use one supported resolution surface instead of importing internal packages.

**Acceptance Criteria:**

1. WHEN a third-party plugin resolves facade symbols, THEN `ctx.pluginApi` SHALL be the recommended and supported resolution surface, and the user-facing documentation SHALL present it as such.
2. WHEN a third-party plugin directly imports or injects `@deepseek-ai/dsh-*` internal packages, THEN the facade SHALL NOT intercept, patch, block, or otherwise alter that interaction.
3. WHEN a third-party plugin uses the direct internal-package path, THEN that path SHALL be documented as an **unsupported escape hatch** with no compatibility promise, no version-negotiation protection, and no fail-safe guarantee from the facade.
4. WHEN official internal packages change incompatibly, THEN compatibility guarantees SHALL apply only to plugins that resolve symbols through `ctx.pluginApi`; plugins on the escape hatch SHALL be expected to adapt or break on their own.
5. WHEN a facade symbol is not yet exposed in the running facade version, THEN the facade SHALL produce a defined absent/inactive signal (such as a typed error or a documented `undefined` path) and SHALL NOT return a partially initialized symbol.

**Type:** 门面基础 / policy

---

### 2. Chain-safety contract for facade wrappers (F0.5)

**User Story:** As an operator or maintainer, I want every wrapper the facade installs to be chain-safe, so that multiple plugins can wrap the same official boundary without tearing down each other's wrappers.

**Acceptance Criteria:**

1. WHEN the facade wraps an official boundary (method or service property), THEN the install SHALL record the original target reference at install time.
2. WHEN the facade disposes a wrapper and the current target is still the facade's own wrapper, THEN the facade SHALL restore the recorded original target.
3. WHEN the facade disposes a wrapper and the current target is NOT the facade's own wrapper (another plugin wrapped after the facade), THEN the facade SHALL NOT restore the recorded original target; the facade's own wrapper SHALL remain in the chain but SHALL pass the call through unchanged (no observable alteration), and SHALL NOT remove or restore any target reference; the facade SHALL log a warning.
4. WHEN the facade wraps a target that is already wrapped by the facade itself (repeated install or re-apply), THEN the facade SHALL NOT nest a second wrapper; it SHALL treat the existing wrapper as its own and return an idempotent no-op disposer.
5. WHEN a wrapper disposer is called more than once, THEN the second and subsequent calls SHALL be no-ops.
6. WHEN a wrapper target is missing or malformed, THEN the facade SHALL NOT install a partial wrapper and SHALL report the affected feature as disabled with a readable diagnostic.

**Equivalence baseline:** 本节以及第 4 节中“行为等价 / 行为不变”的断言基准是 `docs/specs/llm-image-admission/requirements.md` §5（尤其 AC 5.2 与 AC 5.4）以及现有 `test/admission-bridge.test.mjs` 中对应的回归测试；Stage 4 重构必须让这些测试原样通过。

**Type:** 门面基础 / chain-safety

---

### 3. Reusable chain-safety helper (F0.5 formalization)

**User Story:** As a maintainer, I want a shared chain-safety helper for identity-guarded wrapping and disposal, so that every current and future facade feature reuses the same contract instead of reimplementing it ad hoc.

**Acceptance Criteria:**

1. WHEN a facade feature needs to wrap an official boundary, THEN it SHALL use the shared chain-safety helper.
2. GIVEN a target object, a property name, and a wrapper factory, WHEN the helper installs a wrapper, THEN it SHALL return a disposer that satisfies all chain-safety criteria in section 2.
3. WHEN the target property is already marked as wrapped by the facade brand, THEN the helper SHALL return an idempotent no-op disposer and SHALL NOT nest a second wrapper.
4. WHEN the target is not an object or the property is not a function, THEN the helper SHALL refuse to wrap, SHALL NOT partially install, and SHALL report failure through its defined return value (not by throwing through `apply`).
5. WHEN the helper is used by more than one feature in the future, THEN each feature SHALL receive independent brand/identity handling so disposing one feature's wrapper SHALL NOT affect another feature's wrapper.

**Type:** 门面基础 / reusable module

---

### 4. Migrate `llm/admission` chain safety to the shared helper (F0.5)

**User Story:** As the maintainer of `llm-image-admission`, I want `admission-bridge` to become a client of the shared chain-safety helper, so the already-delivered identity-guard behavior is an instance of the formal contract instead of ad-hoc code.

**Acceptance Criteria:**

1. GIVEN `lib/admission-bridge.js` is refactored to use the shared helper, WHEN it installs and disposes its wrappers, THEN its observable behavior SHALL remain identical to the delivered identity-guard semantics.
2. WHEN the `llm/admission` feature guard passes and the bridge installs, THEN all its wrappers SHALL satisfy the chain-safety contract in section 2.
3. WHEN the existing `admission-bridge` regression tests run, THEN they SHALL pass without weakening any assertion.
4. WHEN another plugin wraps the same boundary after the facade, THEN the refactored bridge SHALL still degrade to transparent instead of tearing down the other plugin's wrapper.

**Type:** 门面基础 / migration

---

### 5. Testability and regression coverage

**User Story:** As a maintainer, I want the symbol-resolution policy and chain-safety helper to be testable with `node --test`, so that wrapper-chain regressions are caught without booting a real harness.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN the shared chain-safety helper SHALL be covered by automated tests for: own-wrapper restore, foreign-wrapper degrade, repeated-install no-nest, double-dispose no-op, and malformed-target refusal.
2. WHEN `node --test` runs, THEN the symbol-resolution documentation SHALL be covered by a package/manifest test that asserts the recommended-entry and escape-hatch policy are present in the user-facing documentation.
3. WHEN `node --test` runs, THEN the existing `admission-bridge`, `admission-registry`, and `projection-guard` regression tests SHALL pass.
4. WHEN a wrapper-chain failure is simulated with mocked boundaries, THEN tests SHALL assert that no partial wrapper remains installed and that the facade does not throw through `apply`.

**Type:** 质量门
