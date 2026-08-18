# Requirements: plugin-api-llm-request-m2

> feature_name: `plugin-api-llm-request-m2`
> 状态：已完成（Stage 4）
> 上游：`plugin-api-semantic-hooks-m2`、`plugin-api-llm-m1`、`llm-image-admission`
> 面：仅 host；不创建 client bundle、remote、codec 或 settings bridge
> 范围：L4 synchronous compatibility transform + constrained L2 image admission policy

---

## Introduction

`plugin-api-llm-request-m2` centralizes the request-reentry hack that third-party plugins otherwise each own. It exposes synchronous, composable request transforms and constrained image admission policies under `pluginApi.llm`, using DSH's public `llm/stream` waterfall as a B-class substrate.

The installed DSH waterfall continuation cannot accept a replacement request. A candidate request therefore uses one owner-marked public `llm.stream(candidate)` compatibility re-entry instead of the original continuation. This is useful and materially safer than independently maintained hacks: the facade owns registration order, callback isolation, recursion suppression, terminal image checks, diagnostics, and fail-closed rejection. It is not a native replacement continuation and cannot preserve private prepared-call adapter binding or prove loop request reconstruction. Those limits are explicit C/M4 boundaries in this specification.

`dsh-read-image` shall migrate from its A2 raw listener to the L2 policy surface. When the facade observes non-native image input at the stream boundary, it must never invoke its original continuation or compatibility re-entry with that input unless its terminal processing and validation path has accepted the candidate. A universal guarantee across later waterfall listeners or all adapter paths requires a native final pre-adapter dispatch and is C/M4.

### L2 M2/M4 boundary decision

M2 supports only `image`. It is the only input class with a real consumer and public synchronous classifier at the admission and stream boundaries. A policy may select its scope and synchronously process validated message content, but it may not provide a custom detector, arbitrary modality name, or asynchronous callback.

A new input class requires a separately approved feature that proves a concrete consumer, synchronous entry detection, target-capability determination, boundary detection, processing, and terminal elimination. Until then, it is C/M4. Async transforms, arbitrary/full request replacement, response rewriting, adapter-private interception, shared `ModelInfo` mutation, and transforms that need strict native-operation equivalence are also C/M4.

### Terms

- **compat transform**: a transform using the bounded compatibility re-entry specified here. It is opt-in through `mode: 'compat'` and has the limitations in section 8.
- **logical operation**: one observed `llm/stream` entry through its original continuation, compatibility re-entry, rejection, cancellation, or terminal error. Concurrent and nested calls are independent.
- **owner marker**: an owner-and-logical-operation scoped internal marker. It is not exposed in callback values, catalog payloads, durable records, or public request fields.
- **native image**: image is included in the pre-overlay authoritative target-model `inputModalities` result for the operation.
- **terminal classifier**: the facade-owned public `contentHasImage` based scan. It alone determines image presence. Missing or unparseable message/content shapes are `unknown`, never image-absent.
- **image progress**: a policy `replace-messages` result has a strictly lower terminal-classifier image-bearing content count than its `process` input.
- **normal-form assertion**: an L4 transform's synchronous boolean assertion about the terminal candidate. The facade proves at-most-once application and at-most-one owner re-entry; plugin authors remain responsible for the semantic truth of their assertion.

---

## 1. Classification, Availability, and Public Surface

**User Story:** As a plugin author, I want a clearly classified compatibility API, so that I can use one supported facade instead of maintaining an undocumented re-entry hack.

**Acceptance Criteria:**

1. WHEN the facade exposes `pluginApi.llm.request.transform`, THEN it SHALL classify the API as B-class compatibility translation over public `llm/stream`, SHALL document its `compat` limitations, and SHALL NOT present it as native DSH `llm/request` dispatch.
2. WHEN the facade exposes `pluginApi.llm.admission.register`, THEN it SHALL classify the API as B-class constrained image policy and SHALL document that any scoped gateway overlay is not a public `ModelInfo` mutation API.
3. WHEN the guard cannot establish a synchronous raw `llm/stream` listener, owner marker, callback snapshot boundary, public terminal image classifier, or identity-safe cleanup, THEN `llm/request` SHALL be P2-disabled, dependent `llm/admission` SHALL be P2-disabled, no partial hook or gateway relaxation SHALL be installed, and `apply()` SHALL not throw.
4. GIVEN the core facade is inactive, WHEN a plugin calls either registration API, THEN the facade SHALL present P1 `PluginApiInactiveError` before inspecting the supplied value or accessing official services.
5. GIVEN an applicable feature is P2-disabled, WHEN a plugin calls its registration API, THEN the facade SHALL present P2 `PluginApiFeatureDisabledError` before inspecting the supplied value or partially registering state.
6. WHEN `pluginApi.llm.modelInfo(provider, model, signal?)` is called through the facade, THEN it SHALL return the authoritative pre-overlay L7 result even while an admission gateway operation is active.
7. WHEN a plugin calls `pluginApi.llm.prepareCall(config, signal?)`, THEN the facade SHALL preserve L8 argument, return, and error semantics and SHALL not add a separate dispatch around that call.
8. WHEN a plugin calls `pluginApi.llm.stream(options)`, THEN the facade SHALL preserve its public argument, return, and error interface; WHERE active compat transforms observe the resulting public `llm/stream` waterfall, THEN its message content MAY be transformed under this specification because DSH exposes no public provenance that distinguishes this call from other stream callers.
9. WHEN a plugin calls an L9 provider-registration member, THEN the facade SHALL preserve its direct registration/disposer/error semantics and SHALL not transform its arguments.
10. WHEN this feature is active, THEN it SHALL expose no client bundle, remote contribution, codec, settings namespace, or client-side translator.

**Type:** L4/L2 B class; L7/L9 preserved, L8 compatibility limitation explicitly documented

---

## 2. L4 Compatibility Transform Registration

**User Story:** As a host-plugin author, I want one deterministic transform registration API, so that transforms compose without raw listener ordering or recursive self-processing.

**Acceptance Criteria:**

1. GIVEN `pluginApi`, `llm`, and `llm/request` are active, WHEN a plugin calls `pluginApi.llm.request.transform({ id, mode: 'compat', priority?, apply, isConverged })` with a valid specification, THEN the facade SHALL register it and return an identity-bound disposer whose first successful call returns `true` and later calls return `false`.
2. WHEN a transform omits `priority`, THEN the facade SHALL use `normal`; WHEN transforms execute for an unmarked operation, THEN the facade SHALL order them `highest`, `high`, `normal`, `low`, `lowest`, with successful registration order as the tie-breaker.
3. WHEN a transform id is empty or duplicate, `mode` is not exactly `compat`, priority is unsupported, or `apply` or `isConverged` is absent/non-function, THEN the facade SHALL throw `LlmRequestTransformRegistrationError` and SHALL not partially register it.
4. WHEN a transform disposer is called, THEN it SHALL remove only its exact registration, SHALL not remove a newer registration with the same id, and SHALL preserve other transforms and policies.
5. WHEN an L4 callback receives a candidate request, THEN `apply` SHALL synchronously return exactly `{ kind: 'pass' }` or `{ kind: 'replace-messages', messages }`, and `isConverged` SHALL synchronously return exactly `true` or `false`.
6. WHEN `apply` returns `replace-messages`, THEN its messages SHALL preserve message count, message order, and every existing message field other than `content`; replacement content SHALL satisfy the public `llm/stream` message-content contract and SHALL not introduce or alter a non-text input class other than M2 image.
7. WHEN a result changes another request field, changes message metadata, removes/reorders a message, supplies invalid content, introduces another non-text input class, returns a thenable, or supplies a non-boolean assertion, THEN the facade SHALL reject the logical operation and SHALL not invoke either its original continuation or compatibility re-entry with the original or partial candidate.

**Type:** L4 B-class compatibility API

---

## 3. Read-only Callback and Cancellation Boundary

**User Story:** As a transform or policy author, I want callbacks isolated from official mutable objects, so that registration code cannot corrupt a shared request or cancellation state.

**Acceptance Criteria:**

1. WHEN an L4 or L2 callback receives a request, THEN the facade SHALL provide a recursively immutable plugin-isolated snapshot, rather than an official live request.
2. WHEN a callback attempts top-level or nested snapshot mutation, THEN it SHALL not affect the official request, any other callback snapshot, the candidate, or adapter input.
3. WHEN the facade invokes a successor callback, THEN it SHALL provide a newly derived immutable snapshot sharing no mutable request, message, or result object with an earlier callback.
4. WHEN the official request carries an `AbortSignal`, THEN every callback snapshot, validated candidate, and compatibility re-entry SHALL retain that exact unfrozen signal object and its cancellation semantics.
5. WHEN the facade enforces callback immutability, THEN it SHALL not freeze or mutate the official live request for that purpose.

**Type:** L4/L2 B-class data boundary

---

## 4. Deterministic Compatibility Pipeline

**User Story:** As multiple plugins share the model boundary, I want one bounded pipeline, so that a registered transformation executes predictably and does not recurse indefinitely.

**Acceptance Criteria:**

1. WHEN an unmarked `llm/stream` operation is observed, THEN the facade SHALL snapshot currently mounted L4 transform identities/order and L2 policy identities/order before any L4 or L2 callback runs; later registration, disposal, or replacement SHALL not alter either snapshot for that operation.
2. WHEN the L4 phase runs, THEN the facade SHALL invoke each snapshot transform's `apply` exactly once in deterministic order; `pass` retains the candidate and a valid replacement becomes the next candidate.
3. WHEN the L4 phase completes, THEN the facade SHALL run the L2 terminal image-policy phase before evaluating normal-form assertions.
4. WHEN L2 is bypassed for image-absent or native-image input, or after L2 completes its required processing and validation, THEN the facade SHALL invoke every operation-start L4 `isConverged` assertion exactly once against the terminal candidate in deterministic order.
5. WHEN any normal-form assertion is false or non-boolean, THEN the facade SHALL reject the operation, SHALL not invoke its original continuation or compatibility re-entry, and SHALL not restart either phase to seek another result.
6. WHEN no transform or policy produces a valid replacement and all terminal checks pass, THEN the facade SHALL invoke the original continuation exactly once with the original official request and SHALL not create a compatibility re-entry.
7. WHEN one or more transforms or policies produce valid replacements and all terminal checks pass, THEN the facade SHALL establish an owner marker and SHALL call public `llm.stream(candidate)` at most once as a compatibility re-entry instead of invoking the original continuation.
8. WHEN the owner observes its marker on the compatibility re-entry, THEN it SHALL bypass its own L4/L2 pipeline, SHALL not repeat callbacks, assertions, validators, synthetic effects, or durable effects, and SHALL continue the marked candidate once.
9. WHEN another B-class owner observes this owner marker, THEN it SHALL preserve the marker and remain eligible for its independently applicable translation.
10. WHEN concurrent, nested, retried, or aborted calls are distinct logical operations, THEN their markers, snapshots, candidates, diagnostics, and cleanup state SHALL remain isolated.
11. WHEN an operation reaches success, rejection, abort, original-continuation failure, or compatibility-re-entry failure, THEN the owner SHALL clear its marker and operation state in a contained cleanup path before it can affect another operation.
12. WHEN the facade cannot establish an owner marker or cannot safely call the public compatibility re-entry, THEN it SHALL reject the operation rather than invoke the original continuation with an unsafe or partial candidate.

**Type:** L4 B-class bounded compatibility translation; follows `plugin-api-semantic-hooks-m2` Requirements 2, 4, 7, and 9

---

## 5. Fail-closed Error Handling

**User Story:** As an operator, I want a bad transform to reject only its model call while ensuring the facade does not continue unsafe input through its controlled execution paths.

**Acceptance Criteria:**

1. WHEN an L4 `apply` or `isConverged` callback throws, returns asynchronously, or violates its contract, THEN the facade SHALL reject only that logical operation with typed `LlmRequestTransformError` and SHALL not invoke its original continuation or compatibility re-entry with the original or partial candidate.
2. WHEN a transform result is malformed, changes a protected field, or introduces an unvalidated modality, THEN the facade SHALL reject only that operation with a typed invalid-result error and SHALL not invoke its original continuation or compatibility re-entry with the original or partial candidate.
3. WHEN the facade cannot establish its marker or compatibility re-entry, THEN it SHALL reject only that operation with a typed marker-or-re-entry error and SHALL not invoke the original continuation.
4. WHEN the original continuation or compatibility re-entry has become the terminal official execution path and it throws or rejects, THEN the facade SHALL clean up in `finally` and SHALL preserve the exact original error object or rejection reason.
5. WHEN the feature rejects or contains an operation, THEN it SHALL record no more than one redacted diagnostic for that failure identity and SHALL not log prompt text, request content, credentials, raw messages, or raw callback results.
6. WHEN logging is absent or throws, THEN the facade SHALL preserve the defined operation outcome and SHALL not throw through `apply()` or host lifecycle handling.

**Type:** L4 B-class fail-closed operation path

---

## 6. L2 Constrained Image Admission Policy

**User Story:** As a plugin author needing input projection, I want one image policy surface, so that the facade will not continue image content it observed as unsafe through its controlled execution paths.

**Acceptance Criteria:**

1. GIVEN `pluginApi`, `llm/request`, and `llm/admission` are active, WHEN a plugin calls `pluginApi.llm.admission.register({ id, match, input: 'image', process, validate })` with a valid policy, THEN the facade SHALL register it and return an identity-bound disposer with first-call `true` and later-call `false` semantics.
2. WHEN a policy has a duplicate/invalid id, `input` other than `image`, a separate `detector` or `inspector` field, or a missing/non-function `match`, `process`, or `validate`, THEN the facade SHALL throw `LlmInputPolicyRegistrationError` without partial registration or gateway relaxation.
3. WHEN a policy is selected, THEN `match` SHALL receive only facade-provided scope context and SHALL select policy applicability without determining image presence; `process` SHALL synchronously return the L4 result union, and `validate` SHALL synchronously return exactly a boolean.
4. WHEN a policy `match` throws, returns asynchronously, or returns non-boolean, THEN the facade SHALL treat it as no-match, record one redacted diagnostic, and SHALL not relax a gateway because of that policy.
5. WHEN an admission decision is required, THEN the facade SHALL evaluate `match` exactly once in the pre-callback L2 policy snapshot's successful-registration order and SHALL snapshot the matching policy identities for that logical operation; it SHALL not infer or reuse a selection from sessionId, provider, model, or another operation.
6. WHEN a policy is added, disposed, or replaced after the operation-start snapshot, THEN it SHALL not alter that operation's selection; WHEN a selected policy is unavailable when non-native image processing is required, THEN the facade SHALL reject and SHALL not invoke its original continuation or compatibility re-entry with the unsafe candidate.
7. WHEN a supported scoped gateway mechanism is available and a matching policy is selected, THEN the facade MAY relax only the named official image-admission check for that operation. WHEN that mechanism cannot establish the scope or preserve its owner-local in-flight safety path, THEN it SHALL not relax the gateway and SHALL preserve official refusal.
8. WHEN `pluginApi.llm.modelInfo()` is called while a gateway overlay is active, THEN the facade SHALL bypass its own overlay and return authoritative pre-overlay metadata. This guarantee applies to the facade API; it SHALL NOT claim to alter or control raw third-party `ctx.llm.resolveModelInfo()` calls made within the same host async scope.
9. WHEN the terminal classifier finds image input for a non-native target, THEN the facade SHALL require a matching selected policy to process and validate before it invokes its original continuation or compatibility re-entry with the candidate.
10. WHEN no matching selected policy exists for non-native terminal image input, THEN the facade SHALL reject and SHALL not invoke its original continuation or compatibility re-entry with that input; it SHALL not treat no policy as permission to bypass the boundary.
11. WHEN terminal classification of a non-native target is unknown, THEN the facade SHALL reject and SHALL not invoke its original continuation or compatibility re-entry with that candidate.
12. WHEN selected policies process non-native image input, THEN the facade SHALL process in selection order only while image input remains, SHALL invoke `validate` only for policies whose `process` ran, SHALL require image progress from every replacement, and SHALL require every invoked validator to return `true` plus a final image-absent classifier result.
13. WHEN a processor throws, returns asynchronously, produces an invalid/non-progressing replacement, a validator fails, or image remains/has unknown status at the non-native terminal boundary, THEN the facade SHALL reject with a typed unsafe-input or invalid-result error and SHALL not invoke its original continuation or compatibility re-entry with the unsafe or partial candidate.
14. WHEN the terminal classifier finds no image, or the target is native-image, THEN the facade SHALL bypass image-policy processing and validation and preserve the L4 candidate.
15. WHEN L4 introduces or reintroduces image input for a non-native target, THEN the facade SHALL apply the same terminal checks and fail-closed rejection.
16. WHEN a future input class lacks separately approved synchronous consumer, detection, capability, processing, and terminal-elimination proof, THEN the facade SHALL reject its registration and classify it C/M4.
17. WHEN final M2 delivery replaces L1 admission, THEN `pluginApi.llm.admission` SHALL expose only `register(policy)` and SHALL retire legacy `{ id, match, project }`, `admission.isActive`, and inactive no-op registration behavior; `featureRegistry.isActive('llm/admission')` SHALL be the sole active signal.

**Type:** L2 B-class constrained image policy; other input classes C/M4

---

## 7. Lifecycle, Wrapping, and In-flight Safety

**User Story:** As an operator, I want teardown to stop new unsafe work without making an already admitted operation silently lose its terminal protection.

**Acceptance Criteria:**

1. WHEN `apply()` re-enters while `featureRegistry.isActive('llm/request')` is true, THEN the feature SHALL not install a duplicate listener, registry, marker owner, or wrapper layer and SHALL return an idempotent lifecycle result.
2. WHEN a feature guard, mount transaction, registration, or disposer setup fails, THEN the feature SHALL contain the failure, detach only resources it owns on a best-effort basis, remain P2-disabled, and SHALL not throw through `apply()`.
3. WHEN L2 disposal begins, THEN the facade SHALL stop accepting new policy registrations and new gateway relaxation before removing its gateway wrapper.
4. WHEN a logical operation has acquired an L4/L2 selection or marker before a relevant disposal request, THEN the owner SHALL either complete it through its existing bounded compatibility path or reject it without invoking its original continuation or compatibility re-entry with an unsafe candidate; it SHALL not let that owner-controlled path fall through unguarded.
5. WHEN immediate wrapper removal would violate criterion 4, THEN the owner SHALL retain only the minimum owned terminal guard/state needed to settle its active operation and SHALL detach it after settlement; it SHALL not claim immediate restoration when doing so would permit unsafe pass-through.
6. WHEN the host cannot preserve criteria 3 through 5 for scoped gateway-relaxed operations, THEN `llm/admission` SHALL be P2-disabled and SHALL preserve official gateway refusal. It SHALL NOT require an unproven global scheduler, host-wide drain, or quiescence primitive as an M2 capability.
7. WHEN implementation wraps an official boundary, THEN it SHALL use an identity guard. WHEN a later wrapper replaces that boundary, THEN disposal SHALL preserve the later chain and safely degrade only this feature's owned effect.
8. WHEN an owner has completed disposal, THEN it SHALL prevent future unmarked translation, invalidate stale operation state, and never reactivate because a stale disposer runs.

**Type:** B-class lifecycle; follows `plugin-api-semantic-hooks-m2` Requirements 2, 3, and 4

---

## 8. Compatibility Limits and Native Upstream Boundary

**User Story:** As a facade consumer, I want the compatibility re-entry limits made explicit, so that I can evaluate whether it is sufficient for my plugin.

**Acceptance Criteria:**

1. WHEN a compat transform replaces messages, THEN the facade SHALL call a new public `llm.stream(candidate)` operation and SHALL document that it suppresses the original continuation; it SHALL not claim that DSH continued the same native request object.
2. WHEN a request was loop-built, used a private prepared call, or depends on private adapter-registration identity, THEN the facade SHALL document that compat re-entry may not preserve that hidden binding, routing equivalence, or loop durable reconstruction.
3. WHEN a caller requires strict same-prepared-call adapter identity, exact loop request reconstruction, caller provenance distinction, universal caller interception, or a replacement-capable official continuation, THEN the facade SHALL classify that requirement as C/M4 and SHALL not represent compat mode as satisfying it.
4. WHEN a transform requires asynchronous work, arbitrary request-field replacement, response rewriting, adapter-private interception, or loop/frozen request mutation, THEN the facade SHALL classify it as C/M4 and SHALL not expose it through this API.
5. WHEN a plugin calls `pluginApi.llm.stream()` or an otherwise indistinguishable public caller triggers `llm/stream`, THEN active compat transforms MAY observe it; the facade SHALL document that no public provenance discriminator exists.
6. WHEN a plugin attempts to subscribe to, emit, or waterfall a synthetic `llm/request` event, THEN the feature SHALL not expose a parallel event-bus name without separately approved subscriber requirements.
7. WHEN this feature is delivered, THEN its Design SHALL include upstream proposals for native `llm/request` and `llm/admission` dispatches that name a replacement-capable continuation/request envelope, prepared-call and routing identity preservation, request ownership, cancellation semantics, caller provenance, async/full-replacement boundaries, and the B-class compatibility bridge to retire.
8. WHEN DSH later provides native dispatches with the required fidelity, THEN migration SHALL preserve the public transform/policy registration and disposer shapes while retiring compat re-entry and scoped gateway wrappers.

**Type:** B-class compatibility disclosure + C/M4 boundary

---

## 9. L1 Image Projection Migration

**User Story:** As the maintainer of image admission, I want image projection centralized in the facade, so that third-party plugins do not independently own unsafe re-entry behavior.

**Acceptance Criteria:**

1. WHEN final delivery activates the L2 image policy, THEN image projection SHALL execute only through the unified L4 compatibility pipeline and SHALL not retain an independent L1 `llm/stream` projection listener.
2. WHEN selected non-native image policy processing reaches the terminal phase, THEN its ordering, snapshot, marker, compatibility re-entry, validation, diagnostic, and fail-closed behavior SHALL be exactly the L2/L4 behavior in this specification.
3. WHEN a request targets a native image model, THEN the facade SHALL preserve its request content and SHALL not call an image policy merely because image input exists.
4. WHEN `dsh-read-image` migrates, THEN it SHALL register `{ id, match, input: 'image', process, validate }`, SHALL not register a legacy `project` callback, and SHALL not own either a raw A2 projection listener or an A1 `resolveModelInfo` monkey-patch.
5. WHEN the legacy L1 intent shape is submitted after final delivery, THEN the facade SHALL reject it as an invalid L2 policy and SHALL not retain a compatibility projector path.
6. WHEN final delivery activates the L2 image policy, THEN no independent L1 `llm/stream` projection listener or non-public legacy admission bridge SHALL remain; image projection SHALL execute only through the unified L4 compatibility pipeline.

**Type:** L1/L4/L2 B-class migration

---

## 10. Verification and Governance

**User Story:** As a maintainer, I want direct proof of the facade-controlled no-leak guarantee and the documented compat limits, so that the facade never relies on accidental listener behavior.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN tests SHALL cover L4/L2 validation, duplicate ids, deterministic ordering, disposer idempotency, removal isolation, and P1/P2-before-validation precedence.
2. WHEN `node --test` runs, THEN tests SHALL prove isolated immutable snapshots, absence of official-live-request freezing, exact `AbortSignal` identity through compatibility re-entry, and an already-aborted signal case.
3. WHEN `node --test` runs, THEN tests SHALL cover owner-marked self-reentry, concurrent and nested operations, operation-start snapshots, all-pass original-continuation behavior, one-at-most compat re-entry, normal-form rejection, callback failure, thenable result, invalid result, marker failure, and terminal cleanup.
4. WHEN `node --test` runs, THEN tests SHALL prove exact original error/rejection propagation after original continuation and marked compatibility re-entry become terminal paths.
5. WHEN `node --test` runs, THEN tests SHALL cover image-absent, native-image, matching non-native image, no matching policy, disposed selected policy, invalid/throwing/asynchronous match, processor failure, validator failure, image-progress failure, residual image, unknown image content, unsupported non-text content introduced by L4, and an L4 callback that registers or disposes a policy without changing the current operation's policy snapshot; every unsafe terminal input case SHALL prove no facade-controlled original continuation or compatibility re-entry call occurs with unsafe input.
6. WHEN `node --test` runs, THEN tests SHALL prove facade `modelInfo()` bypasses a scoped overlay, unavailable scoped admission preserves official refusal, owner-local teardown rejects or completes an already selected unsafe operation, wrapper cleanup is identity-safe, and reapply does not duplicate listeners.
7. WHEN `node --test` runs, THEN tests SHALL prove that compat re-entry suppresses the original continuation, preserves documented public candidate fields and `AbortSignal`, and does not claim prepared-call, loop reconstruction, or caller-provenance equivalence.
8. WHEN `dsh-read-image` migration acceptance runs, THEN it SHALL prove the plugin no longer registers A1 or A2, a legacy `project`, or a `resolveModelInfo` monkey-patch; it SHALL use a valid message-only `process`, validate image-free terminal candidates, and pass documented headless smoke and dev boot checks without activation errors.
9. WHEN this feature is delivered, THEN the implementation SHALL formally supersede `plugin-api-llm-m1` requirements that preserve L1 `admission.isActive` and inactive no-op registration, and SHALL supersede its L8 requirement that `pluginApi.llm.stream()` neither participates in an added `llm/stream` listener nor re-dispatches when active compat transforms observe its indistinguishable public waterfall. This supersession is limited to the documented L8 compat behavior in section 1 criterion 8; all other L8 argument, return, and error interface guarantees remain. It SHALL formally supersede `llm-image-admission` Requirements 2, 4, and 7 insofar as they require `{ id, match, project }`, an independent projection listener, a plugin-owned `resolveModelInfo` monkey-patch, or the old dsh-read-image migration. The amendments SHALL retain scoped-gateway and terminal-safety outcomes through final L2/L4 contracts and SHALL update `AGENTS.md` section 8 and `docs/specs/plugin-api-features/feature-list.md` with delivered API, compat limits, and C/M4 boundary.
10. WHEN the full repository suite runs after implementation, THEN all unaffected foundation, facade-integrity, LLM M1, semantic-hooks M2, and image-admission tests SHALL remain passing; tests whose assertions are intentionally superseded by criterion 9 SHALL be updated or removed in the same migration, with replacement coverage for the L2/L4 behavior in this specification.

**Type:** quality gate + B-class migration acceptance

---

## Out of Scope

- Official native `llm/request` or `llm/admission` dispatch, or modifications to official DSH packages.
- A guarantee of same `PreparedLlmCall`, adapter-registration, routing, loop reconstruction, or caller provenance after compat re-entry.
- Async transforms/policies, response rewriting, arbitrary/full request replacement, or adapter-private interception.
- Shared official `ModelInfo` mutation, a public mutation API, or controlling raw third-party resolver calls in a gateway async scope.
- Arbitrary modality, detector, or projector registration without separately approved synchronous dual-boundary proof.
- A synthetic `llm/request` event catalog entry without separately approved subscription requirements.
- Client bundle, browser remote/codec, settings UI, and L9 public behavior changes.
