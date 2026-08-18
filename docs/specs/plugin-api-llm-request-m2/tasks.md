# Tasks: plugin-api-llm-request-m2

> feature_name: `plugin-api-llm-request-m2`
> 状态：草案（Stage 3）
> 上游：已批准的 `requirements.md` 与 `design.md`
> 执行约束：Tasks 获批后按顺序执行；Stage 4 才允许修改 `lib/`、`test/`、`package.json` 及 sibling plugin。

## 1. Foundation and error contracts

- [ ] 1.1 Extend `lib/errors.js` with the approved L4/L2 registration, operation, invalid-result, compatibility, and policy error subclasses, preserving `PluginApiError` codes and existing error behavior.
- [ ] 1.2 Add focused error tests proving stable codes, causes where applicable, and no user-value inspection on P1/P2 disabled entry points.

## 2. Candidate and callback isolation primitives

- [ ] 2.1 Implement harness-free request/message snapshot helpers for detached recursive immutability, exact `AbortSignal` retention, protected request-field comparison, message count/order/metadata preservation, and M2-only content validation.
- [ ] 2.2 Implement thenable detection, strict result-union validation, terminal image classification, unknown-content fail-closed handling, and strict image-progress checks around public `contentHasImage`.
- [ ] 2.3 Add tests for callback isolation, official-request non-mutation/non-freezing, successor snapshot separation, exact and already-aborted `AbortSignal` identity, malformed content, unsupported modalities, and invalid/thenable results.

## 3. L4 request owner

- [ ] 3.1 Implement the private transform registry with validation, priority/registration ordering, token-isolated disposal, duplicate detection, and mount-epoch availability checks.
- [ ] 3.2 Implement `LlmRequestCompatibilityOwner` over the public synchronous `llm/stream` waterfall, including operation records, operation-start snapshots, authoritative pre-overlay capability lookup, L4 processing, post-L2 convergence assertions, typed rejection, redacted deduplicated diagnostics, and contained terminal cleanup.
- [ ] 3.3 Implement owner markers and bounded compatibility re-entry: suppress the original continuation only for accepted replacements, call public `llm.stream(candidate)` at most once, bypass the owner on its own marker, preserve foreign markers, and isolate nested/concurrent operations.
- [ ] 3.4 Ensure stream capability lookup shares the owner-controlled pre-overlay bypass used by `pluginApi.llm.modelInfo()` and rejects safely if bypass or authoritative resolution fails.
- [ ] 3.5 Add owner integration tests covering pass-through, replacement, self-reentry, foreign markers, nested/concurrent operations, operation snapshots, disposal during processing, callback/assertion failures, exact terminal error propagation, marker failure, and no unsafe continuation/re-entry.

## 4. L2 policy registry and admission gateway

- [ ] 4.1 Replace the legacy admission registry path with `lib/llm-input-policy.js`, implementing the image-only `{ id, match, input, process, validate }` contract, identity-bound disposal, forbidden detector/inspector rejection, and synchronous match/processing rules.
- [ ] 4.2 Implement `lib/llm-admission-gateway.js` with owner-local `AsyncLocalStorage` scopes, frozen policy selections, current-epoch/token availability checks, prompt/selectModel wrappers, and identity-safe wrapper disposal/degradation.
- [ ] 4.3 Require and validate a public identity-safe confinement proof for the named official image-admission resolver invocation; P2-disable admission and preserve official refusal when that proof is unavailable.
- [ ] 4.4 Implement scoped image overlay only for a proven official admission check, with authoritative original resolution first, no mutation of official metadata, active/settling/settled lifecycle states, and safe in-flight teardown.
- [ ] 4.5 Add gateway tests for selected-policy overlays, no-match/invalid-match behavior, stale/disposed scopes, active gateway teardown, unavailable confinement, wrapper-chain replacement, facade model-info bypass, raw resolver limitation, and official refusal preservation.

## 5. Facade API and staged publication

- [ ] 5.1 Extend `lib/llm-api.js` with the shared authoritative resolver/bypass hook while preserving direct `prepareCall`, `stream`, and L9 provider-registration argument/return/disposer/error semantics.
- [ ] 5.2 Add private staged feature preparation, commit, rollback, and identity/epoch checks to `lib/plugin-api-service.js` without changing existing M1 immediate mount behavior.
- [ ] 5.3 Update `lib/index.js` to mount `llm/request` before `llm/admission`, install cleanup before publication, handle `ctx.effect`, prepared commit, and `featureRegistry.mount()` failures transactionally, and retain fail-safe unrelated-feature mounting.
- [ ] 5.4 Extend guards for request-owner substrate, snapshot/cancellation support, gateway confinement, and cleanup primitives; ensure request failure independently leaves admission P2-disabled.
- [ ] 5.5 Add lifecycle and facade tests for prepare-before-publish, rollback at each failure point, disabled facade visibility, stale transaction/disposer isolation, reapply idempotency, M1 regression behavior, P1/P2 precedence, and full L7/L8/L9 direct semantics.

## 6. Unified L2/L4 integration

- [ ] 6.1 Connect admission policy snapshots and owner-local pipeline handles without adding a second raw stream listener, synthetic `llm/request` catalog, or legacy projector path.
- [ ] 6.2 Prove native-image and image-absent bypass, matching non-native processing, validator and terminal-image enforcement, L4-introduced image handling, unknown/residual image rejection, and no-policy rejection.
- [ ] 6.3 Add integration tests proving active gateway scopes cannot make stream classification observe overlay metadata, policy mutation cannot affect the current operation, and owner-controlled paths never forward unsafe candidates.

## 7. dsh-read-image migration

- [ ] 7.1 Migrate registration to `{ id, match, input: 'image', process, validate }`, retaining message-only ordering and nested `tool-result` projection behavior.
- [ ] 7.2 Remove the plugin's A1 resolver monkey-patch, A2 raw `llm/stream` listener, `this.stream(projected)` re-entry, legacy `project` field, and `admission.isActive` dependency.
- [ ] 7.3 Update sibling-plugin structural and behavior tests for the new registration and validate image-free terminal candidates.
- [ ] 7.4 Run documented headless smoke and dev-boot checks, including no activation errors and expected HTTP behavior.

## 8. Governance, supersession, and full verification

- [ ] 8.1 Formally record supersession of the named `plugin-api-llm-m1` L1/L8 contracts and `llm-image-admission` Requirements 2, 4, and 7, retaining unaffected guarantees and documenting the replacement L2/L4 contracts.
- [ ] 8.2 Update `AGENTS.md` section 8 and `docs/specs/plugin-api-features/feature-list.md` with delivered API shape, compatibility limits, active signal, and C/M4 boundary.
- [ ] 8.3 Remove or rewrite only intentionally superseded tests; retain unaffected foundation, facade-integrity, LLM M1, semantic-hooks M2, and image-admission coverage.
- [ ] 8.4 Add diagnostic tests for disable/decline/containment deduplication, redaction, logger absence/throwing, and fail-safe `apply()` behavior.
- [ ] 8.5 Run `git diff --check`, the full `node --test` suite, migration smoke/dev-boot checks, and verify no official DSH package files were modified.
- [ ] 8.6 Commit the complete Stage 4 delivery, including implementation, tests, migrated sibling plugin, specifications, and required feature registries.

## Dependency order

`1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8`

Tasks 3 and 4 are feature-local owners but share the staged facade and authoritative resolver integration in Task 5. Task 6 is blocked until both owners and the publication transaction are available. Task 7 is blocked until the unified API is executable. Task 8 is the final delivery and verification gate.
