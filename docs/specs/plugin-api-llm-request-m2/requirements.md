# Requirements: plugin-api-llm-request-m2

> feature_name: `plugin-api-llm-request-m2`
> 状态：草案（Stage 1，待审）
> 上游：`plugin-api-semantic-hooks-m2`、`plugin-api-llm-m1`、`llm-image-admission`
> 面：仅 host；不创建 client bundle、remote、codec 或 settings bridge
> 范围：L4 同步 request transform + 受约束的 L2 同步 admission policy

---

## Introduction

`plugin-api-llm-request-m2` 在 `pluginApi.llm` 下提供同步、可组合的模型请求转译注册面。它以官方公开的 `llm/stream` waterfall 为 **B 类 substrate**，在不修改官方 DSH、不开设官方不存在的 `llm/request` dispatch、也不修改共享 `ModelInfo` 的前提下，对已证明可安全重入的官方内部 stream-entry 操作执行受限的 message-content 改写。

本 feature 将已交付的 `llm-image-admission` 的图片投影迁移到同一管线。`dsh-read-image` 等插件只声明图片准入及投影承诺，不得保留或新建自己的 A2 `llm/stream` 重入 listener。对于目标模型未原生支持的受支持输入类别，门面必须在适配器边界证明其已被处理；不能证明时必须拒绝该操作，而不是传递原始输入。

### L2 M2/M4 boundary decision

M2 交付的是受限的同步 policy 生命周期和执行位置，不是任意 modality 框架。M2 的唯一受支持输入类别为 `image`：它已有具体消费者，且可以使用公开同步契约在请求入口、目标能力判定和适配器边界三处识别及验证。policy 不得提供自定义 detector、任意 modality 名称或异步处理器。`match` 只根据门面提供的 scope context 选择 policy，不得替代门面终态 classifier 对 image 存在与否的判定。

每个新增输入类别必须先由独立 feature 证明存在具体消费者、公开的同步入口检测、目标能力判定、边界检测、处理和末端消除验证；在该 feature 获批前，该类别是 M4 C 类。异步或完整请求改写、任意 caller 或 adapter 拦截、loop-built/frozen request 改写、共享 `ModelInfo` 改写，以及不能证明候选内容抵达同一适配器调用的改写，同样是 C 类。

### Terms

- **supported stream operation**：由官方内部模型调用路径发出的、可由实现证明安全重入的 `llm/stream` waterfall 操作。它不包括 `pluginApi.llm.stream(options)` 的 L8 直通调用、adapter-private 调用和任何未观察到的官方路径。
- **logical operation**：一次 supported stream operation，从其未标记 stream entry 到适配器调用成功、失败、取消或被门面拒绝为止；并发及嵌套操作彼此独立。
- **native input**：根据该 logical operation 的预覆盖、权威目标模型能力结果，目标模型明确声明支持的输入类别。
- **policy-managed input**：M2 中为 `image` 的受支持输入，且由 matching L2 policy 承诺同步处理及验证。
- **normal-form assertion**：L4 transform 对最终候选请求作出的同步布尔断言。M2 可证明的是完整管线最多执行一次及最多一次 owner-marked re-entry；门面不能在不限制插件语言的情况下证明任意插件函数的数学幂等性，因此 transform 作者对断言的语义正确性负责。
- **image progress**：一个 image policy 的有效 `replace-messages` 结果使门面终态 classifier 计算出的 image-bearing content count 严格小于该 policy `process` 输入快照的 count。

---

## 1. Classification, Availability, and Preserved M1 Semantics

**User Story:** As a host-plugin author, I want the translated capability to have a clear supported boundary and fail-safe availability behavior, so that I do not mistake it for a universal native request hook.

**Acceptance Criteria:**

1. WHEN this feature exposes `pluginApi.llm.request.transform`, THEN it SHALL classify that capability as B class, name the public `llm/stream` waterfall as its substrate, and SHALL NOT present it as an official `llm/request` dispatch.
2. WHEN this feature exposes `pluginApi.llm.admission.register`, THEN it SHALL classify that capability as B class and SHALL document that scoped gateway relaxation is an implementation of the policy contract rather than an authoritative `ModelInfo` mutation API.
3. WHEN the feature guard cannot establish the public substrate, safe operation-local state, bounded re-entry, or a public terminal image classifier, THEN `llm/request` SHALL remain P2-disabled, SHALL not register a partial listener, and SHALL not throw through host `apply()`.
4. WHEN `llm/request` is P2-disabled, THEN dependent `llm/admission` SHALL remain P2-disabled, SHALL not relax an official admission gateway, and SHALL preserve official refusal behavior.
5. GIVEN the core facade is inactive, WHEN a plugin calls an L4 or L2 registration entry point, THEN the facade SHALL present P1 `PluginApiInactiveError` before inspecting the supplied registration value or accessing an official service.
6. GIVEN the applicable feature is P2-disabled, WHEN a plugin calls its registration entry point, THEN the facade SHALL present P2 `PluginApiFeatureDisabledError` before inspecting the supplied registration value or partially registering state.
7. WHEN this feature is active, THEN `pluginApi.llm.modelInfo(provider, model, signal?)` SHALL retain L7's authoritative read-only query semantics in every scope, including a scoped admission gateway operation.
8. WHEN a plugin calls `pluginApi.llm.prepareCall(config, signal?)` or `pluginApi.llm.stream(options)`, THEN the facade SHALL retain L8's existing argument-identity, return-value, error, and no-extra-dispatch semantics; these direct passthrough calls SHALL NOT be a supported L4 transform domain.
9. WHEN a plugin calls an L9 provider-registration member, THEN the facade SHALL retain its existing direct registration/disposer/error semantics and SHALL not involve it in L4 or L2 processing.
10. WHEN this feature is active, THEN it SHALL expose no client-only entry point, remote contribution, codec, settings namespace, or client-side request translator.

**Type:** L4/L2 B 类 + M1 preservation

---

## 2. L4 Synchronous Transform Registration

**User Story:** As a host-plugin author, I want a stable synchronous transform registration API, so that I can rewrite message content at a supported model-call entry without maintaining a raw `llm/stream` re-entry listener.

**Acceptance Criteria:**

1. GIVEN `pluginApi`, `llm`, and `llm/request` are active, WHEN a plugin calls `pluginApi.llm.request.transform({ id, priority?, apply, isConverged })` with a valid specification, THEN the facade SHALL register the transform and return an identity-bound disposer whose first successful call returns `true` and whose later calls return `false`.
2. WHEN a transform is registered without `priority`, THEN the facade SHALL use `normal`; WHEN multiple transforms are applicable, THEN the facade SHALL execute them from `highest` through `lowest` priority and use successful registration order as the tie-breaker.
3. WHEN a plugin supplies an empty or duplicate id, an unsupported priority, or a missing/non-function `apply` or `isConverged`, THEN the facade SHALL throw `LlmRequestTransformRegistrationError` without partially registering the transform.
4. WHEN a transform disposer is called, THEN it SHALL remove only its exact registration, SHALL not remove a newer registration with the same id, and SHALL preserve other transforms and admission policies.
5. WHEN an L4 transform callback receives a candidate request, THEN `apply` SHALL synchronously return exactly `{ kind: 'pass' }` or `{ kind: 'replace-messages', messages }`, and `isConverged` SHALL synchronously return exactly `true` or `false`.
6. WHEN `apply` returns `replace-messages`, THEN its `messages` SHALL preserve message count, message order, and every existing message field other than `content`; each replacement content value SHALL satisfy the public `llm/stream` message-content contract and SHALL not introduce or alter a non-text input class other than M2 `image`; the facade SHALL preserve every other request field, including routing, provider, model, session identity, tools, configuration, history semantics, and the exact `AbortSignal` object.
7. WHEN a transform returns any other result, changes a protected field, removes/reorders a message, introduces an unvalidated or unsupported non-text input class, returns a thenable, or supplies a non-boolean normal-form assertion, THEN the facade SHALL reject that logical operation before adapter invocation.
8. WHEN the final candidate does not satisfy every operation-start transform's `isConverged` assertion, THEN the facade SHALL reject that logical operation before adapter invocation and SHALL not restart the pipeline to seek another fixed point.

**Type:** L4 B 类

---

## 3. Read-only Callback and Cancellation Boundary

**User Story:** As a transform or policy author, I want an explicit read-only boundary, so that callbacks cannot mutate a shared live request or change cancellation behavior.

**Acceptance Criteria:**

1. WHEN an L4 transform or L2 policy callback receives a request, THEN the facade SHALL provide a recursively immutable, plugin-isolated snapshot rather than the mutable official live request.
2. WHEN a callback attempts top-level or nested mutation of its snapshot, THEN that mutation SHALL not change the request observed by the official runtime, another callback, or the adapter.
3. WHEN the facade supplies a successor callback with a validated candidate, THEN that callback SHALL receive a newly derived immutable snapshot that shares no mutable request, message, or result object with an earlier callback.
4. WHEN the official request carries an `AbortSignal`, THEN every callback snapshot, validated candidate, and bounded re-entry SHALL retain the exact same unfrozen signal object and cancellation semantics.
5. WHEN the facade enforces callback read-only behavior, THEN it SHALL not freeze, clone for replacement, or otherwise mutate the official live request solely for that purpose.

**Type:** L4/L2 B 类数据边界

---

## 4. Deterministic Pipeline and Bounded Operational Convergence

**User Story:** As multiple plugin authors share one model boundary, I want deterministic composition and bounded re-entry, so that callbacks do not recursively duplicate work and independent operations do not interfere.

**Acceptance Criteria:**

1. WHEN an unmarked supported stream operation begins, THEN the facade SHALL snapshot the identities and order of currently mounted L4 transforms before invoking any callback, and later registration, disposal, or replacement SHALL not alter that operation's L4 snapshot.
2. WHEN the L4 phase runs, THEN the facade SHALL invoke each snapshot transform's `apply` exactly once in deterministic order; a `pass` result SHALL retain the current candidate, and a valid replacement SHALL become the candidate for the next transform.
3. WHEN the L4 phase completes, THEN the facade SHALL run the L2 terminal image-policy phase before evaluating normal-form assertions; after that phase has either been bypassed for image-absent/native input or completed all required processing and validation, the facade SHALL evaluate each operation-start transform's normal-form assertion exactly once against the post-L2 terminally validated candidate that will be passed to continuation or bounded re-entry, in the same deterministic order.
4. WHEN no transform or policy produces a valid message replacement and every terminal image and normal-form check succeeds, THEN the facade SHALL invoke the official continuation exactly once with the unmodified official operation and SHALL not create a synthetic re-entry.
5. WHEN one or more valid transform or policy results replace messages and every terminal image and normal-form check succeeds, THEN the facade SHALL establish an owner-and-operation-scoped marker and SHALL perform at most one bounded re-entry carrying the validated candidate.
6. WHEN the owner observes its own marker on that bounded re-entry, THEN it SHALL bypass its own L4 and L2 pipeline, SHALL not repeat a callback, normal-form assertion, validator, synthetic effect, or durable effect, and SHALL continue only with the validated candidate.
7. WHEN another B-class owner observes the L4 marker, THEN it SHALL preserve the marker and SHALL remain eligible for its independently applicable translation.
8. WHEN concurrent, nested, retried, or aborted calls are distinct logical operations, THEN their markers, candidate values, callback snapshots, diagnostics, and cleanup state SHALL remain isolated.
9. WHEN a logical operation succeeds, fails, aborts, or its bounded re-entry returns or throws, THEN the feature SHALL clear its operation-local marker and state in a contained cleanup path before that state can affect a later operation.
10. WHEN the public substrate cannot prove that the validated candidate's message contents, protected fields, session/history semantics, and exact `AbortSignal` reach the same adapter operation after bounded re-entry, THEN the facade SHALL reject that operation as unsupported rather than re-enter an unproven candidate.

**Type:** L4 B 类；遵循 `plugin-api-semantic-hooks-m2` Requirements 2、4、7、9

---

## 5. Fail-closed Operation Handling

**User Story:** As an operator responsible for model safety, I want a malformed or non-convergent rewrite to stop only its unsafe model call, so that boot, unrelated calls, and other features remain available.

**Acceptance Criteria:**

1. WHEN an L4 `apply` or `isConverged` callback throws, returns asynchronously, or violates its public contract, THEN the facade SHALL reject only that logical operation with a typed `LlmRequestTransformError` and SHALL not invoke the adapter with the original or a partial candidate.
2. WHEN a transform result is malformed or changes a protected field, THEN the facade SHALL reject only that logical operation with a typed invalid-result error and SHALL not invoke the adapter.
3. WHEN a final normal-form assertion is `false` or non-boolean, THEN the facade SHALL reject only that logical operation with a typed non-convergent error and SHALL not invoke the adapter.
4. WHEN the facade cannot establish its marker or prove safe bounded re-entry for an otherwise valid replacement, THEN it SHALL reject only that logical operation with a typed marker-or-re-entry error and SHALL not invoke the adapter.
5. WHEN an original official continuation or adapter invocation throws or rejects after it becomes the operation's terminal path, THEN the facade SHALL clean up in `finally` and SHALL preserve the exact original error object or rejection reason.
6. WHEN the feature rejects or contains a logical operation, THEN it SHALL record at most one redacted diagnostic for that failure identity and SHALL not log prompt text, request content, credentials, raw messages, or raw callback results.
7. WHEN logging is unavailable or throws, THEN the facade SHALL preserve the operation's defined result and SHALL not throw through `apply()` or host lifecycle handling.

**Type:** L4 B 类 fail-closed operation path

---

## 6. L2 Constrained Image Admission Policy

**User Story:** As a plugin author who needs an approved input-processing path, I want admission registration to express a bounded synchronous image-processing promise, so that text-only models never receive unprocessed image input.

**Acceptance Criteria:**

1. GIVEN `pluginApi`, `llm/request`, and `llm/admission` are active, WHEN a plugin calls `pluginApi.llm.admission.register({ id, match, input: 'image', process, validate })` with a valid policy, THEN the facade SHALL register it and return an identity-bound disposer whose first successful call returns `true` and whose later calls return `false`.
2. WHEN a plugin supplies a duplicate or invalid id, a value other than `input: 'image'`, a separate `detector`/`inspector` field, or a missing/non-function `match`, `process`, or `validate`, THEN the facade SHALL throw `LlmInputPolicyRegistrationError` without partially registering the policy or relaxing an admission gateway.
3. WHEN a policy callback receives a request, THEN `match` SHALL receive only facade-provided scope context and SHALL select policy applicability without determining image presence; `process` SHALL synchronously return the exact L4 result union, `validate` SHALL synchronously return exactly `true` or `false`, and both SHALL receive the same read-only and `AbortSignal` guarantees as L4 callbacks.
4. WHEN a policy's `match` callback throws, returns asynchronously, or returns a non-boolean value, THEN the facade SHALL treat that policy as no-match for that operation, SHALL record one redacted diagnostic, and SHALL not relax an admission gateway because of that policy.
5. WHEN an admission decision is required for a logical operation, THEN the facade SHALL snapshot matching policy registration identities in successful registration order exactly once and SHALL not infer or reuse that selection from `sessionId`, provider, model, or another operation.
6. WHEN a policy registration is added, disposed, or replaced after an operation's selection snapshot is created, THEN it SHALL not alter that operation's selection; WHEN a selected policy is no longer available when non-native image processing is required, THEN the facade SHALL reject that operation before adapter invocation.
7. WHEN a supported public mechanism can establish a scoped admission-gateway operation and a matching image policy is selected, THEN the facade SHALL relax only that named gateway check for that operation; every unrelated consumer, including `pluginApi.llm.modelInfo`, SHALL continue to observe the pre-overlay authoritative `ModelInfo`.
8. WHEN the facade cannot safely establish that exact scoped gateway effect, THEN it SHALL preserve official gateway refusal, SHALL not globally mutate or advertise `inputModalities`, and SHALL not simulate admission success.
9. WHEN the terminal classifier reports image input for a target whose pre-overlay authoritative capability is not native, THEN the facade SHALL require a matching selected policy to process and validate the input before adapter invocation.
10. WHEN no matching selected policy exists for non-native image input at the terminal boundary, THEN the facade SHALL reject the logical operation before adapter invocation; it SHALL never treat the absence of a policy as image-absent or as permission to bypass the boundary.
11. WHEN the public terminal classifier cannot safely determine whether a non-native target request contains image input, THEN the facade SHALL reject the logical operation before adapter invocation.
12. WHEN matching selected policies process non-native image input, THEN the facade SHALL run them in their selection order only while image input remains, SHALL run `validate` only for policies whose `process` ran, and SHALL require every invoked validator to return `true` plus a final classifier result proving no image input remains.
13. WHEN a policy processor throws, returns asynchronously, produces an invalid replacement or a replacement without image progress, a validator fails, or image input remains or is indeterminate at the non-native terminal boundary, THEN the facade SHALL reject the logical operation with a typed unsafe-input or invalid-result error and SHALL not invoke the adapter.
14. WHEN the terminal classifier reports no image input, or the target capability is genuinely native for image, THEN the facade SHALL bypass all image-policy `process` and `validate` callbacks and SHALL preserve the L4 candidate.
15. WHEN an ordinary L4 transform introduces or reintroduces image input for a non-native target, THEN the facade SHALL apply the same terminal policy and fail-closed checks before adapter invocation.
16. WHEN a future input class has not separately proved a concrete consumer and synchronous detection, capability, processing, and terminal-elimination contracts, THEN the facade SHALL reject its registration as unsupported and SHALL classify it as C class/M4.
17. WHEN final M2 L2 delivery replaces L1 admission, THEN `pluginApi.llm.admission` SHALL expose only `register(policy)` and SHALL retire the former `{ id, match, project }` registration form, `admission.isActive`, and inactive no-op registration behavior; `featureRegistry.isActive('llm/admission')` SHALL remain the owner's sole authoritative active signal.

**Type:** L2 B 类；任意/未证明 input class 为 C 类/M4

---

## 7. Lifecycle, Wrapping, and In-flight Safety

**User Story:** As an operator, I want registration and teardown to be idempotent without allowing an admitted unsafe operation to escape the policy boundary.

**Acceptance Criteria:**

1. WHEN the feature reapplies while `featureRegistry.isActive('llm/request')` is true, THEN it SHALL not install a second substrate listener, registry, marker owner, or wrapping layer and SHALL return an idempotent lifecycle result.
2. WHEN a feature guard, mount transaction, registration, or disposer setup fails, THEN the feature SHALL contain the failure, best-effort detach only resources it owns, remain P2-disabled, and SHALL not throw through host `apply()`.
3. WHEN an operation has already acquired L4/L2 selection or marker state and a relevant disposal request arrives, THEN the owner SHALL either complete that operation through its original bounded safety path or reject it before adapter invocation; it SHALL not let the operation fall through to an unguarded adapter call.
4. WHEN a disposer takes effect, THEN it SHALL prevent future unmarked translation by its owner, SHALL clear state after every affected operation reaches a terminal outcome, and SHALL not reuse stale state for a later operation.
5. WHEN public lifecycle behavior cannot preserve criterion 3 for a scoped gateway-relaxed operation, THEN the feature SHALL classify that gateway relaxation as C class, keep `llm/admission` P2-disabled, and preserve official gateway refusal; it SHALL not require an unproven host-wide scheduler, global operation drain, or quiescence primitive as an M2 capability.
6. WHEN implementation wraps an official boundary, THEN it SHALL use an identity guard; WHEN a later wrapper replaces that boundary, THEN disposal SHALL preserve the later wrapper chain and safely degrade only this feature's owned effect.
7. WHEN a feature is disabled or disposed, THEN it SHALL detach each registration it owns, prevent future translation, invalidate its stale owner state, and never reactivate because a stale disposer runs.

**Type:** B 类 lifecycle；遵循 `plugin-api-semantic-hooks-m2` Requirements 2、3、4

---

## 8. L1 Image Projection Migration

**User Story:** As the maintainer of image admission, I want projection to use the unified pipeline, so that there is one ordering, re-entry, and fail-closed model boundary.

**Acceptance Criteria:**

1. WHEN `llm-image-admission` is active after final delivery, THEN its image projection SHALL execute only as an L2 participant in the unified L4 pipeline and SHALL not retain an independently registered `llm/stream` projection listener.
2. WHEN a selected non-native image policy reaches the terminal phase, THEN its processing, validation, read-only boundary, ordering, marker, re-entry, and failure behavior SHALL be exactly the L2 and L4 behavior defined in this specification.
3. WHEN an image-bearing request targets a genuinely native image model, THEN the facade SHALL preserve official request semantics and SHALL not invoke L2 image processing solely because image input exists.
4. WHEN `dsh-read-image` migrates to the delivered facade, THEN it SHALL use `pluginApi.llm.admission.register({ id, match, input: 'image', process, validate })`, SHALL not register a legacy `project` callback, and SHALL not own an A2 raw `llm/stream` projection listener.
5. WHEN the former L1 admission-intent shape is submitted after final M2 delivery, THEN the facade SHALL reject it as an invalid L2 policy and SHALL not retain a compatibility projector path.
6. WHEN the repository performs the required migration sequence, THEN it SHALL establish and verify the L4 base before routing L1 image projection through it, and SHALL complete the L2 public-policy evolution only after that migration is verified.
7. WHEN final delivery is complete, THEN the temporary migration bridge, if one is needed during execution, SHALL be non-public and removed; no legacy registration surface or second projection listener SHALL remain.

**Type:** L1/L4/L2 B 类迁移；图片 safety invariant uses fail-closed behavior

---

## 9. Fidelity Limits and Upstream Boundaries

**User Story:** As a facade consumer, I want the emulation limits named explicitly, so that I can distinguish supported message transformation from functionality that requires DSH support.

**Acceptance Criteria:**

1. WHEN a caller reaches an adapter through `pluginApi.llm.stream`, an adapter-private call, a future unobserved official path, or another unsupported boundary, THEN the facade SHALL NOT claim that L4 intercepted or transformed that call.
2. WHEN a requested transform requires asynchronous work, arbitrary request-field replacement, response rewriting, universal caller or adapter interception, or a loop-built/frozen request rewrite, THEN the facade SHALL classify it as C class and SHALL not emulate it through the L4 API.
3. WHEN a requested transform cannot prove same-operation delivery of validated message content, protected fields, and the original `AbortSignal` through the public substrate, THEN the facade SHALL classify it as C class and SHALL reject the requested behavior.
4. WHEN a plugin attempts to subscribe to, emit, or waterfall a synthetic `llm/request` event through this feature, THEN the facade SHALL not expose a parallel event-bus name without a separately approved subscriber contract.
5. WHEN this feature delivers a B-class L4 or L2 capability, THEN its Design SHALL include an upstream proposal for a native `llm/request` and `llm/admission` dispatch that names the missing dispatch timing, request ownership, cancellation semantics, full-replacement/async boundary, and the B-class bridge it would retire.
6. WHEN DSH later provides native dispatches with the required fidelity, THEN the migration SHALL preserve the public L4 transform and L2 policy registration/disposer contracts while retiring the B-class re-entry and scoped gateway bridge.

**Type:** B 类 fidelity statement + C 类/M4 boundary

---

## 10. Verification, Migration, and Governance

**User Story:** As a maintainer, I want focused proof and synchronized specifications, so that transform safety and the image-policy transition do not rely on accidental listener order or stale documentation.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN tests SHALL cover L4 and L2 registration validation, duplicate ids, priority/tie ordering, disposer idempotency, removal isolation, and P1/P2-before-validation precedence.
2. WHEN `node --test` runs, THEN tests SHALL prove callback snapshot immutability and isolation, absence of official-live-request freezing, and exact `AbortSignal` identity preservation through a valid replacement and bounded re-entry, including an already-aborted signal.
3. WHEN `node --test` runs, THEN tests SHALL cover same-operation re-entry, concurrent independent operations, nested distinct operations, operation-start snapshots, all-pass passthrough, false/non-boolean normal-form assertions, callback failures, asynchronous results, invalid results, marker failure, unsupported re-entry, and operation-local cleanup.
4. WHEN `node --test` runs, THEN tests SHALL prove that official continuation or adapter errors preserve their exact error/rejection identity and are not replaced by a transform or policy error.
5. WHEN `node --test` runs, THEN tests SHALL cover image-absent, native-image, matching non-native-image, no-policy non-native-image, disposed-selected-policy, invalid/throwing/asynchronous match, processor failure, validator failure, image-progress failure, residual image, indeterminate image content, and an L4 replacement that introduces an unsupported non-text input class; every unsafe non-native or unsupported-input case SHALL prove no adapter invocation.
6. WHEN `node --test` runs, THEN tests SHALL prove that a scoped gateway effect cannot alter `pluginApi.llm.modelInfo` or another unrelated authoritative model-info consumer, and that unavailable scoped admission preserves official gateway refusal.
7. WHEN lifecycle and wrapper failures are simulated, THEN tests SHALL prove idempotent reapply, P2 containment, identity-safe wrapper cleanup, no duplicate listener, no stale operation-state reuse, and no unsafe in-flight operation reaches the adapter.
8. WHEN the `dsh-read-image` migration acceptance runs, THEN it SHALL prove that the plugin no longer registers an A2 `llm/stream` projection listener or legacy `project` callback, that its `process` returns only valid message replacement, that its `validate` accepts only image-free terminal candidates, and that the documented headless smoke and dev boot checks pass without activation errors.
9. WHEN this feature is delivered, THEN the implementation SHALL amend `docs/specs/plugin-api-llm-m1/requirements.md` to formally supersede its preserved L1 `admission.isActive` and inactive no-op registration clauses, and SHALL formally supersede `llm-image-admission` Requirements 2, 4, and 7 insofar as they require the legacy `{ id, match, project }` registration form, an independent `llm/stream` projection listener, or the former `dsh-read-image` migration form. The amendment to `docs/specs/llm-image-admission/requirements.md` and `design.md` SHALL map their retained scoped-gateway and terminal image-safety outcomes to the final L2 policy form and unified L4 pipeline. It SHALL also update `AGENTS.md` section 8 plus `docs/specs/plugin-api-features/feature-list.md` with the L4/L2 scope, B/C limits, and image-projection migration.
10. WHEN the existing repository suite runs after implementation, THEN all pre-existing tests for foundation, facade integrity, LLM M1, semantic-hooks M2, and image admission SHALL remain passing.

**Type:** 质量门 + B 类迁移验收

---

## Out of Scope

- An official native `llm/request` dispatch or modification of official DSH packages.
- Async transforms, async policy functions, response rewriting, or arbitrary/full request replacement.
- Mutation of shared official `ModelInfo`, a public ModelInfo mutation API, or a global model-capability lie.
- Transforming the L8 `pluginApi.llm.stream()` passthrough, adapter-private calls, or other unsupported caller paths.
- A synthetic `llm/request` event catalog entry without a separately approved subscriber contract.
- An open-ended modality, detector, or projector registration API without a concrete consumer and proof of synchronous dual-boundary validation.
- Client bundle, browser remote/codec, settings UI, and any change to L7-L9 A-class public semantics.
