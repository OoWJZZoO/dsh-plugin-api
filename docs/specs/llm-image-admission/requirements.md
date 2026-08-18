# Feature Requirements: llm-image-admission

> **Historical supersession:** This Stage 1 contract is retained as an audit record only.
> Its old `{ id, match, project }` registration, independent projection listener, and
> consumer-owned `resolveModelInfo` wrapper are superseded by the delivered
> `plugin-api-llm-request-m2` L2/L4 contract. The current authority is
> `llm.admission.register({ id, match, input: 'image', process, validate })`; the scoped
> gateway owns the single hidden resolver wrapper. Do not implement the historical shape.

## Introduction

`llm-image-admission` 是 `dsh-plugin-api` 门面的第一个垂直切片。它给第三方插件提供一个**语义化的图片输入准入钩子**：插件声明“某个会话/请求需要携带图片，并且交出同步投影器负责在模型请求发出前处理图片块”，由门面负责通过 DeepSeek Harness 的 API 准入闸门，并在模型请求最后边界强制执行投影。

当前官方 `dsh-host-apiproxy` 在 `selectModel` 与 `prompt` 两个入口直接调用 `ctx.llm.resolveModelInfo()` 检查模型是否声明 `image` 输入；官方没有与“准入/输入策略”对应的事件。第三方插件（以 `dsh-read-image` 的 M1 为代表）因此只能自行 monkey-patch `resolveModelInfo`，造成全局 ModelInfo 谎言、多插件互相覆盖等架构债。

本 feature 不公开 ModelInfo 变更能力；`resolveModelInfo` 的包装只能作为门面内部实现存在。准入与投影是一份安全契约的两半：**门面既负责在官方闸门处放行，也负责在 `llm/stream` 边界执行投影并校验无图片残留；校验失败必须 fail-closed，绝不把像素漏给文本 API。**

每个可被外部“引出”的钩子均按仓库规范标注类型：

- **A 类**：官方已 dispatch，只需稳定化。
- **B 类**：官方没有 dispatch 点，用底层钩子/服务边界模拟。
- **C 类**：不改官方做不到，只能写 upstream proposal。

---

## Requirements

### 1. Facade service availability and fail-safe startup

**User Story:** As a third-party plugin author, I want to obtain the facade through `ctx.pluginApi`, so that I do not depend on internal `@deepseek-ai/dsh-*` packages.

**Acceptance Criteria:**

1. WHEN the `dsh-plugin-api` host plugin is loaded before third-party plugins, THEN the host context SHALL provide a `ctx.pluginApi` service that exposes the `llm/admission` API described in this document.
2. WHEN the environment self-check detects a missing or changed official contract that this feature depends on, THEN the facade SHALL log a readable diagnostic and return from `apply` without throwing and without installing any hook.
3. WHEN the facade is inactive due to a failed guard, THEN any third-party plugin consuming the facade SHALL receive a clear inactive-state signal rather than an undefined service error.
4. IF the official `llm` service is absent at apply time, THEN the facade SHALL treat the feature as unavailable and SHALL NOT block harness boot.

**Type:** 门面基础 / fail-safe（非 A/B/C 钩子）

---

### 2. Admission intent registration

**User Story:** As a plugin author, I want to register an image-admission intent with a match predicate and a synchronous projector, so that a text-only model session can accept image blocks while the facade enforces my projection.

**Acceptance Criteria:**

1. WHEN a plugin registers an admission intent with a valid synchronous boolean `match` predicate and a valid synchronous `project` function, THEN the facade SHALL accept the registration and return a dispose handle.
2. WHEN a plugin registers an admission intent whose `match` or `project` is missing or not a function, THEN the facade SHALL reject it with a readable `AdmissionIntentError` and SHALL NOT partially install it.
3. WHEN a plugin disposes a registration, THEN the facade SHALL remove that registration; IF no other registration matches the same scope, THEN subsequent admission checks and model-boundary projection SHALL revert to official behavior.
4. WHEN multiple plugins register admission intents, THEN the facade SHALL evaluate them independently, and disposing one registration SHALL NOT affect the others.
5. WHEN no admission intent is registered, THEN the facade SHALL NOT alter any official behavior.
6. WHEN a plugin registers an intent with a duplicate `id`, THEN the facade SHALL reject it with a readable `AdmissionIntentError`.

**Type:** B 类（官方无对应事件，由门面模拟）

---

### 3. Scoped admission effect without global ModelInfo mutation

**User Story:** As a DeepSeek Harness user or plugin author, I want the admission effect to apply only to the API admission gate, so that other consumers of `resolveModelInfo` keep observing authoritative model metadata.

**Acceptance Criteria:**

1. GIVEN a registered admission intent matches the session or request, WHEN the API gateway checks whether the selected model accepts image input, THEN that check SHALL pass.
2. GIVEN the same registered admission intent, WHEN any consumer other than the API admission gate calls `llm.resolveModelInfo`, THEN the result SHALL be identical to the result without the facade; in particular, no `image` input modality SHALL be injected into general model-info queries.
3. WHEN no admission intent matches the session or request, THEN the API admission gate SHALL behave exactly as official (image-carrying prompts for text-only models SHALL be refused).
4. WHEN the official model info already declares `image` input, THEN the facade SHALL NOT alter the result.
5. WHEN the official model info has no `inputModalities` field, THEN the facade SHALL NOT add one.
6. WHEN the facade cannot guarantee a scoped effect, THEN it SHALL fail safe by keeping official behavior unchanged and logging a warning; it SHALL NOT leak a global ModelInfo mutation.

**Type:** B 类（核心语义；不可安全实现时降级为 fail-safe，见第 3.6 条）

---

### 4. Model-boundary projection enforcement

**User Story:** As a DeepSeek Harness operator, I want the facade to enforce the projector at the model-request boundary, so that an admitted image request can never reach a text-only model with image blocks still present.

**Acceptance Criteria:**

1. GIVEN an admitted session whose request reaches the `llm/stream` boundary and still contains image blocks, WHEN the facade's model-boundary guard runs, THEN it SHALL apply the matching intent's synchronous `project` function to the request.
2. WHEN the projector returns a request that contains no image blocks, THEN the facade SHALL forward that projected request.
3. WHEN the projector throws, THEN the facade SHALL log an error and fail closed; the original image-carrying request SHALL NOT be forwarded.
4. WHEN the projector returns a request that still contains image blocks, THEN the facade SHALL log an error and fail closed; the image-carrying request SHALL NOT be forwarded.
5. WHEN a request reaches the `llm/stream` boundary and no admission intent matches its session, THEN the facade SHALL NOT apply any projector and SHALL NOT modify the request.
6. WHEN multiple admission intents match the same request, THEN the facade SHALL apply their projectors in registration order and SHALL fail closed if any projector throws or if image blocks remain after all projectors have run.
7. WHEN a request contains no image blocks, THEN the facade SHALL pass it through unchanged.

**Type:** B 类（在官方 `llm/stream` 边界上执行；`llm/stream` 本身是 A 类事件，本需求是对它的门面化使用）

---

### 5. Internal wrapping chain safety and idempotence

**User Story:** As a DeepSeek Harness operator, I want the facade's internal wrapping to be chain-safe and idempotent, so that repeated loads, HMR, or coexistence with other plugins cannot corrupt official behavior or cause unbounded nesting.

**Acceptance Criteria:**

1. WHEN the facade is applied more than once in the same process (e.g. HMR reload), THEN the wrapping SHALL be idempotent: no unbounded nesting, and the effective behavior SHALL be equivalent to a single application.
2. WHEN another plugin wraps the same official boundary after the facade, THEN the facade's dispose path SHALL NOT tear down that other plugin's wrapper; the facade SHALL degrade its own effect to transparent and log a warning.
3. WHEN a wrapped official method throws, THEN the facade SHALL preserve the original error and SHALL NOT mask or swallow it unless the guard semantics explicitly require a safe fallback.
4. WHEN the facade is disposed, THEN all official boundaries SHALL be restored to the state they had when the facade applied, unless doing so would destroy another plugin's wrapper (see 5.2).

**Type:** B 类 / fail-safe

---

### 6. Upstream proposal for an official `llm/admission` event

**User Story:** As a maintainer, I want a written proposal for an official `llm/admission` event, so that this B 类 simulation can eventually be retired in favor of a native hook.

**Acceptance Criteria:**

1. WHEN this feature is delivered, THEN the specification SHALL include a C-class upstream proposal describing the event name, payload shape, dispatch location, and the behavior the official event would replace.
2. WHEN the upstream event becomes available, THEN the public `ctx.pluginApi.llm.admission` API SHALL have a documented migration path that removes the hidden internal wrapping while preserving the public API shape.

**Type:** C 类（proposal，不写实现）

---

### 7. Migration acceptance for `dsh-read-image`

**User Story:** As the maintainer of `dsh-read-image`, I want to replace the A1 monkey-patch (`resolveModelInfo` wrapping) and hand off the A2 projection to the facade, so that the plugin no longer owns model-info patch code or the projection boundary.

**Acceptance Criteria:**

1. GIVEN `dsh-read-image` is migrated to use `ctx.pluginApi.llm.admission.register({ match, project })`, WHEN a text-only model session sends image content, THEN the official admission gates SHALL pass exactly as they did under the A1 hack.
2. WHEN the migrated `dsh-read-image` sends an image-bearing request to a text-only model, THEN the facade SHALL execute the registered projector at the `llm/stream` boundary, and the model request SHALL contain no image blocks.
3. WHEN the migrated `dsh-read-image` runs under the headless profile with a plain smoke prompt, THEN the prompt SHALL succeed with no stack traces and no degraded tool scheduling.
4. WHEN the migrated `dsh-read-image` boots under the dev profile, THEN the web boot SHALL be ready (HTTP 200) with no plugin activation errors.
5. IF the facade is unavailable or its guard fails, THEN `dsh-read-image` SHALL retain a safe fallback path (official refusal of image content) and SHALL NOT crash the harness boot.

**Type:** B 类迁移验收 / fail-safe

---

### 8. Testability and regression coverage

**User Story:** As a maintainer, I want the pure logic to be testable without a harness, so that `node --test` can validate the behavior quickly and catch regressions.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN admission-policy matching, registration lifecycle, projector selection, and chain-safety pure functions SHALL be covered by automated tests.
2. GIVEN test fixtures with mocked official boundaries, WHEN admission intents are registered and disposed, THEN the tests SHALL verify the scoped admission effect, the model-boundary projection, and the absence of leaked model-info mutation.
3. WHEN a projector throws or returns a request that still contains image blocks, THEN the tests SHALL verify that the facade fails closed and does not forward the image-carrying request.
4. WHEN a guard-failure scenario is simulated, THEN the tests SHALL verify that the facade logs and stays inert without throwing.
5. WHEN the official behavior is compared with the facade inactive, THEN tests SHALL assert byte-equivalent passthrough behavior.

**Type:** 质量门（跨 A/B/C）
