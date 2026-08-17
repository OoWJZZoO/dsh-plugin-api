# Requirements: plugin-api-semantic-hooks-m2

> feature_name: `plugin-api-semantic-hooks-m2`
> 状态：已批准（Stage 1）
> 上游：M0、M1、`plugin-api-m1-integration`
> 面：host 为主；仅定义条件性的 client companion 契约，不实现 M3 bridge
> 分类：门面基础 / B 类语义转译契约；本 feature 不交付具体业务 hook。

---

## Introduction

M2 的 B 类能力利用公开的底层 hook 模拟官方未直接 dispatch 的语义。后续 `llm/request`、`exec.route`、durable session helper 若独立定义 re-entry、幂等、失败、catalog 或挂载规则，将产生不兼容的并行实现。

本规格固定最小共同契约，并复用 M1 的 `featureRegistry.isActive`、catalog slice、`type`、`scopeKey`、`fault`、`freeze` 与 P1-P4 失败呈现。它不创建通用转译引擎，不实现任何具体 M2 业务能力。

**术语**：B 类转译是以公开底层 hook 映射逻辑操作的门面语义；转译所有者是唯一负责该语义 re-entry 和收敛的 feature；synthetic hook 是瞬时可订阅事件；durable session event 是遵循 session 持久化/surface 生命周期的记录。

## 1. Classification Boundary

**User Story**: As an M2 feature author, I want translated semantics to have an unambiguous classification, so that plugins never confuse emulation with a native DSH dispatch point.

**Acceptance Criteria**:

1. WHEN an M2 feature exposes a hook or helper, THEN it SHALL classify the capability as A, B, or C in its Requirements and Design.
2. WHEN a capability is B, THEN its Design SHALL name the supported public substrate, translated semantic operation, and material fidelity limitations.
3. WHEN an official dispatch has the required timing, payload, and lifecycle, THEN the feature SHALL classify it as A and SHALL NOT add a parallel B hook for the same public semantic.
4. WHEN public services and documented lower-level hooks cannot preserve the required behavior, THEN the feature SHALL classify it as C, SHALL NOT present an emulation as supported, and SHALL record an upstream-proposal boundary.
5. WHEN this foundation feature is delivered, THEN it SHALL NOT itself register `llm/request`, `exec.route`, durable-session helpers, or another concrete M2 business capability.

## 2. Guard, Active Signal, and Lifecycle

**User Story**: As a facade maintainer, I want every B translation to follow one mount and disposal lifecycle, so that availability is predictable during boot and re-apply.

**Acceptance Criteria**:

1. WHEN a B feature is considered for mounting, THEN it SHALL finish its feature guard before publishing an active facade or registering a translation hook.
2. WHEN a B feature is active, THEN `featureRegistry.isActive(featureName)` SHALL be its only authoritative active signal.
3. WHEN `apply()` re-enters against a reused service and that signal is true, THEN the B feature SHALL avoid duplicate registration and SHALL return an idempotent no-op lifecycle result.
4. WHEN a guard, mount, or registration step fails, THEN the feature SHALL remain inactive, SHALL expose its documented disabled behavior, and SHALL NOT throw through plugin `apply()`.
5. WHEN a B feature registers resources, THEN it SHALL own an idempotent disposer that never throws through host lifecycle execution.
6. WHEN the feature is disposed or disabled, THEN it SHALL detach each registration it owns, prevent future translation, and SHALL NOT be reactivated by a stale disposer.
7. WHEN a B feature depends on M1 or an official service, THEN integration SHALL mount it after its dependencies without reordering existing M1 dependency order.

## 3. Failure Presentation and Fail-Safe Policy

**User Story**: As a third-party plugin author, I want unavailable B capabilities to use M1's typed failures, so that I never have to interpret raw host errors.

| Path | Condition | Observable result |
|---|---|---|
| P1 | inactive core | `PluginApiInactiveError` |
| P2 | mandatory dependency or feature guard disabled | `PluginApiFeatureDisabledError(featureName)` |
| P3 | optional service unavailable while feature remains active | `PluginApiServiceUnavailableError(serviceName)` at call time |
| P4 | declared unavailable `pluginApi.services.*` member | `isActive === false`; call throws `PluginApiFeatureDisabledError(memberName)` |

**Acceptance Criteria**:

1. WHEN the core is inactive, THEN every B entry point SHALL present P1 and SHALL not expose a partial hook.
2. WHEN a mandatory dependency is absent, malformed, or its guard access throws, THEN the affected B feature SHALL present P2, SHALL not register, and SHALL preserve fail-safe `apply()`.
3. WHEN an optional service is absent or its guard access throws for an M2 B feature, THEN the feature SHALL present P2 and SHALL NOT create a new P3 case.
4. WHEN an existing M1-approved capability contract assigns an optional service to P3, THEN that capability SHALL retain its established P3 behavior.
5. WHEN a declared service member is unavailable, THEN it SHALL present P4 and SHALL NOT be silently omitted.
6. WHEN a disabled facade is called, THEN it SHALL raise the applicable typed facade error rather than a raw service, context, or hook error.
7. WHEN translation cannot safely inspect one logical operation, THEN it SHALL fail open by preserving the official operation unchanged and logging a contained diagnostic, unless the concrete feature declares a fail-closed safety invariant.
8. WHEN a concrete B feature declares fail-closed behavior, THEN its Requirements SHALL name the invariant, its Design SHALL justify why pass-through violates it, and it SHALL reject or deactivate only the operation through a typed path without throwing through `apply()`.
9. WHEN any internal guard, mount, translation, logging, or disposer path throws, THEN the owner SHALL contain it without aborting boot or unrelated feature mounting.

## 4. Re-entry Marker and Idempotent Convergence

**User Story**: As an implementer of translated hooks, I want one recursion and convergence contract, so that re-entry cannot recurse or duplicate work while concurrent operations remain independent.

**Acceptance Criteria**:

1. WHEN a B translation begins a logical operation that can re-enter its substrate, THEN it SHALL establish an owner-and-operation-scoped marker before re-entry is possible.
2. WHEN the same owner observes its own marker for the same logical operation, THEN it SHALL bypass its translation path and SHALL NOT duplicate transformation, synthetic emission, or durable effect.
3. WHEN another owner observes that marker, THEN it SHALL preserve it and SHALL remain eligible for its own independently applicable translation.
4. WHEN independent logical operations execute concurrently, THEN a marker for one SHALL NOT suppress translation of another.
5. WHEN a nested call is a distinct logical operation, THEN it SHALL remain eligible for translation.
6. WHEN translation completes, aborts, or throws, THEN marker state SHALL reach a terminal cleanup state that cannot suppress later unrelated work or mark a failed attempt as successful.
7. WHEN marker state is represented in or alongside an operation, THEN it SHALL remain internal and SHALL NOT appear in public catalog payloads, persisted session events, or plugin-visible mutation.
8. WHEN translation is applied repeatedly to the same logical operation, THEN the semantic result after its first successful application SHALL be stable and SHALL cause no additional material change.
9. WHEN a successful translation is re-observed, THEN it SHALL emit at most one synthetic occurrence and create at most one durable effect for its semantic transition unless the feature documents distinct logical operations.
10. WHEN translation fails before commit, THEN it SHALL not mark success and SHALL not leave a partial synthetic or durable duplicate for retry.
11. WHEN the feature declines to transform, THEN it SHALL preserve the operation and SHALL NOT emit a success-form synthetic event.

## 5. Synthetic Hook Catalog Contract

**User Story**: As a plugin author, I want synthetic hooks cataloged consistently, so that their translated nature and event-bus behavior are inspectable.

**Acceptance Criteria**:

1. WHEN a B feature exposes a synthetic hook for third-party subscription, THEN it SHALL contribute the hook through its own catalog slice with `type: 'B'`.
2. WHEN an entry has `type: 'B'`, THEN its documentation SHALL identify its owner and public lower-level substrate and SHALL NOT imply native DSH dispatch.
3. WHEN a B feature contributes a catalog entry, THEN it SHALL use M1's schema: `name`, `mode`, `scopeFiltered`, `scopeKey`, `payload`, `args`, `source`, `type`, plus only optional `fault` and `freeze`.
4. WHEN a translated observation has no stable third-party subscription contract, THEN it SHALL remain internal and SHALL NOT enter `pluginApi.events.catalog`.
5. WHEN a B feature's guard fails at catalog composition time, THEN its slice SHALL be excluded and subscriptions to those names SHALL use M1 non-cataloged pass-through behavior.
6. WHEN a B feature passes its guard but becomes inactive because its later mount fails, THEN its Design SHALL prove that its slice cannot remain cataloged while inactive or SHALL record the case as a coordinated integration issue.
7. WHEN two slices declare one synthetic name, THEN composition SHALL fail loud inside a contained mount boundary, SHALL disable the `events` feature through its M1 P2 path, and SHALL not choose a silent winner.
8. WHEN a B hook dispatches, THEN it SHALL retain M1 priority, read-only payload, scope, `fault`, and `freeze` semantics.

## 6. Synthetic-versus-Durable Boundary

**User Story**: As a session and event consumer, I want transient hooks and durable session records to remain distinct, so that replay and surface state retain reliable meanings.

**Acceptance Criteria**:

1. WHEN a B translation emits a synthetic hook, THEN the hook SHALL be transient and SHALL NOT by itself persist a session record, execute a surface operation, or create replay history.
2. WHEN a durable session helper writes or updates a record, THEN it SHALL follow session durability and causal-metadata conventions and SHALL NOT classify that record as a synthetic hook.
3. WHEN one operation needs both a synthetic hook and a durable event, THEN the concrete feature SHALL document them separately, preserve causal order, and prevent re-entry/retry duplication of either.
4. WHEN a durable event is surfaced, THEN its surface intent and source-event relationship SHALL come from the durable session contract rather than a catalog entry.
5. WHEN a downstream feature needs subscriber notification for a durable event, THEN its Requirements SHALL declare the required timing, payload, scope, and lifecycle characteristics.
6. WHEN an official A-class session event provides every characteristic declared under criterion 5, THEN the feature SHALL use that event and SHALL NOT add a parallel B hook.
7. WHEN no official A-class session event provides every characteristic declared under criterion 5, THEN the feature MAY add a separately cataloged B hook for the new semantic subscription contract.

## 7. Diagnostics and Conditional Client Boundary

**User Story**: As an operator and dual-sided plugin maintainer, I want failures observable and host translation authoritative, so that diagnostics do not leak data and client code cannot become a second translator.

**Acceptance Criteria**:

1. WHEN a B feature disables, degrades, declines translation, or contains failure, THEN it SHALL record a diagnostic with feature identity, lifecycle phase, and category.
2. WHEN retry or re-entry repeats the same failure for the same feature, lifecycle phase, and logical operation, THEN the feature SHALL record no more than one diagnostic for that failure identity.
3. WHEN diagnostics describe a translated operation, THEN they SHALL NOT include request content, credentials, prompt text, or payload data without an independently approved redaction policy.
4. WHEN logging is absent or throws, THEN handling it SHALL remain fail-safe and SHALL not affect the operation or `apply()`.
5. WHEN a B capability translates DSH behavior, THEN the host SHALL own its guard, lifecycle, marker, convergence, catalog, and durable-session decisions.
6. WHEN a B feature needs a client companion, THEN this B-class specification SHALL remain limited to host translation behavior, its client and wire failure contract SHALL be deferred to a separately approved M3 feature, and that client SHALL NOT independently translate host behavior.
7. WHEN a B feature has no client need, THEN it SHALL NOT introduce a client bundle, remote namespace, or settings bridge solely for this contract.

## 8. Minimal Shared Foundation and Parallel Ownership

**User Story**: As the M2 coordinator, I want shared code justified by real use and shared-file edits constrained before worktrees begin, so that merge is mechanical rather than semantic arbitration.

**Acceptance Criteria**:

1. WHEN a B feature proposes shared runtime code, THEN it SHALL demonstrate that at least two concrete M2 feature specifications need the same behavior and failure semantics; otherwise the behavior SHALL remain feature-local.
2. WHEN that shared need is proven, THEN the abstraction SHALL contain only the proven common contract and SHALL NOT become a generic translation engine.
3. WHEN M2 worktrees are prepared, THEN each brief SHALL declare kebab-case feature name, camelCase runtime key, owned modules and catalog slice, allowed shared-file edits, mount dependencies, and P1-P4 route.
4. WHEN a B feature contributes a catalog slice, THEN it SHALL use `lib/<kebab-runtime-key>-events-catalog.js`, export `<camelRuntimeKey>EventsCatalog`, and test it in `test/<kebab-runtime-key>-events-catalog.test.mjs`.
5. WHEN a B feature uses a feature-local host adapter, THEN its module and focused test names SHALL use the same kebab runtime key; extra names SHALL be specified before coding rather than invented as aliases.
6. WHEN a worktree touches `lib/guards.js`, `lib/index.js`, or `lib/plugin-api-service.js`, THEN it SHALL make only its pre-agreed additive change and SHALL not reorder or refactor existing entries.
7. WHEN a worktree would change event-bus, freeze, registry, core error, catalog-composition, or existing M1 lifecycle semantics, THEN it SHALL record an integration issue and defer that change to coordinated integration.
8. WHEN a B feature mounts, THEN it SHALL preserve M1 order and follow its official/facade dependencies; unrelated B features SHALL not receive an artificial ordering dependency.
9. WHEN M2 branches merge, THEN the coordinator SHALL run the M1 parallel-workflow pre-merge audit, resolve semantic/catalog conflicts in one integration pass, and require the full suite to pass.

## 9. Downstream Specification and Verification

**User Story**: As an integrator, I want later M2 specs to inherit this contract mechanically, so that each feature proves its own translated behavior without redefining shared policy.

**Acceptance Criteria**:

1. WHEN the G2/G3/G4 downstream features (`plugin-api-llm-request-m2`, `plugin-api-exec-route-m2`, or `plugin-api-session-durable-m2`) enter Requirements or Design, THEN they SHALL cite this specification and conform to Requirements 1-8 unless they record a concrete conflict for human review.
2. WHEN a downstream B feature defines tests, THEN it SHALL cover success, same-operation re-entry, concurrent independent operations, repeated substrate observation, contained failure, disposer idempotency, and assigned P1-P4 presentation.
3. WHEN a feature exposes a B hook, THEN its tests SHALL cover active catalog presence, inactive exclusion, `type: 'B'`, exactly-once emission, and M1 event-bus policies.
4. WHEN a feature writes a durable effect, THEN its tests SHALL prove re-entry/retry cannot duplicate it and that synthetic notification, if any, stays separate.
5. WHEN implementation cannot preserve official behavior while meeting its declared semantic contract, THEN it SHALL stop before silently weakening the contract and SHALL request a requirements decision or reclassify the behavior as C.

---

## Out of Scope

- Implementing L2, L4, A9, T10, S2, or another concrete M2 capability.
- Modifying official DSH packages or importing their private state.
- A universal B-class translation engine.
- M3 settings/client bridge or M4 upstream proposal implementation.
