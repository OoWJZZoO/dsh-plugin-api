# Feature Tasks: plugin-api-compaction-m2

> Stage 4 (Execute) execution checklist. Tasks are dependency ordered and must be
> completed one at a time. For every non-trivial task, write or update the
> focused test first, implement only the stated behavior, run the task's focused
> test command, then obtain the blocking adversarial review required by
> `AGENTS.md` before starting the next task.
>
> Test constraints: use `node --test`, mocked Cordis contexts, and mocked
> official service objects. Do not boot a real harness, load a concrete Basic
> compaction backend, or execute a real compaction transaction.
>
> Migration acceptance: `feature-list.md` §4 contains no existing
> `dsh-read-image` or `dsh-pro-ex-ability-anchor` compaction escape hatch. This
> feature therefore has no consumer-plugin migration code task. Record that
> conclusion during delivered-feature registration; if execution discovers such
> a dependency, stop and report it as an out-of-spec migration input.

---

## Tasks

### 1. Define the static SV17 contract and baseline namespace shape

- [x] 1.1 Update `test/services-definitions.test.mjs` and
  `test/services-namespace.test.mjs` first to declare the 19-key namespace
  contract.
  - Assert the stable key order ends with `compaction`, and that no additional
    namespace keys or runtime-discovered service members appear.
  - Assert the `compaction` definition maps `key: 'compaction'` to
    `ctxService: 'compaction'`, carries the diagnostic package label
    `dsh-compaction`, and declares exactly three non-optional `method` members:
    `compactIfNeeded`, `compactNow`, and `compactRegion`.
  - Assert a complete mocked compaction service yields a frozen active facade
    with only `isActive` and those three callable methods; confirm the official
    mock service is not frozen or otherwise altered.
  - Attempt assignment, deletion, and extension against both the namespace and
    the active compaction facade, then verify the original keys, methods, and
    values remain observable to every consumer.
  - References: `requirements.md` §1 AC 1, 3-6; §2; §3 AC 1-2; `design.md`
    §3.1, §6.

- [x] 1.2 Update `lib/services.js` by appending the approved static
  `compaction` definition to `SERVICE_DEFINITIONS`.
  - Reuse the existing generic definition/facade machinery. Do not add a
    compaction-specific builder, runtime property enumeration, class/package
    detection, official package import, or peer dependency.
  - Preserve all pre-existing definition order and members. The derived
    `SERVICES_NAMESPACE_KEYS` and default disabled namespace must become
    19-key surfaces through the existing derivation.
  - Run the focused service-definition and namespace tests.
  - References: `requirements.md` §1 AC 1-6; §2; §3; `design.md` §3.1,
    §4.1.

### 2. Preserve transparent compaction passthrough behavior

- [x] 2.1 Extend `test/services-passthrough.test.mjs` with compaction-specific
  call-recording mocks before relying on the generic implementation.
  - Verify each declared operation delegates with the official service as
    `this`, forwards all supplied values by identity and in order, and returns
    the exact official result or promise.
  - Verify `compactNow(agent, signal)` calls the official method with exactly
    two arguments, while the three-argument form preserves the supplied
    `sourceCommandId` identity.
  - Verify `compactRegion(start, end, agent)` calls the official method with
    exactly three arguments, while the four-argument form preserves the
    supplied `signal` identity.
  - Verify an official synchronous throw and a rejected promise propagate
    unchanged, without logging, wrapping, retrying, or recovery behavior.
  - References: `requirements.md` §2 AC 1-7, §6 AC 2; `design.md` §2.2,
    §3.1, §5.

- [x] 2.2 Confirm the generic `buildActiveFacade()` method delegation satisfies
  the new tests; make only the narrowly required shared-factory correction if
  the test demonstrates a gap.
  - Preserve rest-argument delegation so omitted optional trailing arguments
    stay omitted. Do not add validation, cloning, freezing, caching, or
    compaction policy behavior.
  - Run `node --test test/services-passthrough.test.mjs`.
  - References: `requirements.md` §2, §5 AC 2; `design.md` §2.2, §5.

### 3. Implement per-definition build containment and disabled facades

- [x] 3.1 Extend `test/services-optional-member.test.mjs`,
  `test/services-disabled.test.mjs`, and `test/services-namespace.test.mjs`
  with SV17 degradation cases before implementation.
  - With active `services`, verify a missing or non-callable declared method
    produces one frozen P4 `services.compaction` facade with `isActive ===
    false`, all three declared methods observable, and no partially active
    surface.
  - Verify a compaction object containing `summarize`, `config`, automatic
    state, or arbitrary members exposes none of those extras.
  - Verify a missing/throwing `ctx.get('compaction')` while another service is
    available disables only compaction as P4 and makes no official call through
    its disabled methods.
  - Verify hostile declared-member access or other active-facade construction
    failure disables only that service, is best-effort logged where a logger is
    supplied, and leaves independently complete service facades active.
  - Verify P1 precedence for every declared operation on both an already mounted
    active facade and an already mounted P4-disabled facade after core
    deactivation: each call raises the typed inactive error before any official
    method access.
  - References: `requirements.md` §3 AC 1-6; §4 AC 1-3, 5-6; §6 AC 3-6;
    `design.md` §3.2, §5-6.

- [x] 3.2 Strengthen `createServicesNamespace()` in `lib/services.js` with the
  approved per-definition active-facade construction boundary.
  - Keep `safeGet()` as the resolution boundary. For each resolved service,
    contain member inspection or facade-construction exceptions, issue a
    non-throwing diagnostic when possible, and substitute the existing P4
    `buildDisabledFacade(def, active, reason)` result for that definition.
  - Continue constructing and freezing the namespace. Preserve existing P2
    behavior when `ctx.get` is unavailable or no definition resolves, and P1
    precedence when the core is inactive.
  - Do not contain official method calls after successful facade construction:
    call-time throws and rejections remain transparent passthrough behavior.
  - Run the focused namespace, disabled-facade, and optional-member tests.
  - References: `requirements.md` §4 AC 1-6; `design.md` §3.2, §5.

### 4. Exercise definition-derived guard, pre-mount, and apply behavior

- [x] 4.1 Update `test/guards.test.mjs` and `test/plugin-api-service.test.mjs`
  for the 19-definition services contract.
  - Verify a complete compaction service as the only resolvable official
    capability makes `runFeatureGuard('services')` pass.
  - Retain P2 failures when `ctx.get` is absent or every one of the 19
    definitions is unavailable.
  - Verify the pre-mount default disabled namespace includes compaction, calls
    report P2 `services` (or P1 when core inactive), and do not invoke
    `ctx.get('compaction')`.
  - References: `requirements.md` §1 AC 2; §4 AC 3-4; §6 AC 6-7;
    `design.md` §3.3-3.4, §5-6.

- [x] 4.2 Make only the test/cardinality expectation updates required by the
  existing definition-driven `lib/guards.js` and `lib/plugin-api-service.js`
  behavior to satisfy Task 4.1.
  - The added static definition updates their derived behavior automatically;
    do not change either module's production behavior for SV17. Do not
    introduce `runFeatureGuard('compaction')`, a compaction feature registry
    record, a dedicated mounter, or mount-order/lifecycle changes.
  - Run `node --test test/guards.test.mjs test/plugin-api-service.test.mjs`.
  - References: `requirements.md` §1, §4; `design.md` §3.3-3.4.

- [x] 4.3 Extend `test/index-services.test.mjs` with host-apply isolation
  coverage and implement only corrections exposed by that test.
  - With only a complete compaction mock available, assert `services` mounts
    active, compaction is active, all other 18 unavailable capability facades
    retain their P4 behavior, and `apply()` does not throw.
  - With a hostile or incomplete compaction mock and another complete service,
    assert compaction is P4-disabled while the other service remains active and
    `apply()` does not throw.
  - Preserve the existing single `services` mounter and feature registry path;
    do not add a compaction event/catalog, client contribution, or backend
    registration behavior.
  - Run `node --test test/index-services.test.mjs`.
  - References: `requirements.md` §4 AC 5-6; §5 AC 1-4; §6 AC 4-5, 7;
    `design.md` §2.1, §3.4, §5-6.

### 5. Run full regression suite and register the delivered feature

- [x] 5.1 Run `node --test` for the entire repository after Tasks 1-4 pass.
  - Resolve only regressions caused by the approved SV17 implementation. Keep
    the work limited to the design's existing services infrastructure and
    listed tests.
  - Confirm no package metadata change is required: production code accesses
    the injected service only and imports neither compaction package.
  - References: `requirements.md` §5; §6 AC 1-8; `design.md` §3.5, §6.

- [x] 5.2 After the full suite passes, update the delivered-feature records.
  - Update `docs/specs/plugin-api-features/feature-list.md`: mark SV17
    `delivered`, replace the stale Basic-only `summarize()` sketch with the
    three public abstract operations, state that `compaction/*` is not exposed
    as an events API, and retain its A-class/M2 placement.
  - Update `AGENTS.md` §8 with the `plugin-api-compaction-m2` delivered row,
    including its 19-entry services namespace, three-operation abstract
    contract, Basic-member exclusion, and P4 construction containment.
  - Record that no migration target exists because neither acceptance-object
    plugin currently contains an SV17 workaround.
  - Run `git diff --check` and rerun `node --test` if documentation changes
    affect checked repository artifacts.
  - References: `AGENTS.md` §8; `requirements.md` §3, §5-6; `design.md`
    §8.

---

## Coverage Traceability

| Requirements | Tasks |
|---|---|
| §1 namespace integration and read-only shape | 1, 4 |
| §2 three-operation transparent passthrough | 2 |
| §3 backend-neutral provider boundary | 1, 3, 5 |
| §4 P1/P2/P4 degradation and local isolation | 3, 4 |
| §5 no event, policy, or backend behavior changes | 2, 4, 5 |
| §6 focused tests and full regression coverage | 1-5 |
