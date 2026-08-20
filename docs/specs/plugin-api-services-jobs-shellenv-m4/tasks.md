# Feature Tasks: plugin-api-services-jobs-shellenv-m4

> Stage 4 (Execute) execution checklist. Tasks are dependency ordered and must be
> completed one top-level batch at a time. For every batch, write or update the
> focused test first, implement only the stated behavior, run the batch's focused
> test command, then obtain the blocking adversarial review required by
> `AGENTS.md` before starting the next batch.
>
> Test constraints: use `node --test`, mocked Cordis contexts, and mocked
> official service objects. Do not boot a real harness, start a real background
> job, run a real shell executor, or perform a real shell-environment collection.
>
> Migration acceptance: The one consumer migration target is the Windows Git Bash tool
> in `../dsh-pro-ex-ability-anchor` (requirements §6). Everything else must stay
> untouched; if execution discovers another escape-hatch dependency on
> `ctx.get('jobs')` / `ctx.get('shellEnv')`, stop and report it as an out-of-spec
> migration input.

---

## Tasks

### 1. Define the static jobs/shellEnv contract and baseline namespace shape

#### 1.1 Contract-first tests

- [x] Update `test/services-definitions.test.mjs` and
  `test/services-namespace.test.mjs` first to declare the 21-key namespace
  contract.
  - Assert the stable key order ends with `jobs` then `shellEnv`, and that no
    additional namespace keys or runtime-discovered service members appear.
  - Assert the `jobs` definition maps `key: 'jobs'` to `ctxService: 'jobs'`,
    carries the diagnostic package label `dsh-jobs`, and declares exactly nine
    non-optional `method` members in this order: `start`, `list`, `get`,
    `read`, `kill`, `wait`, `onJobDone`, `onJobsChanged`, `attachController`.
  - Assert the `shellEnv` definition maps `key: 'shellEnv'` to
    `ctxService: 'shellEnv'`, carries the diagnostic package label
    `dsh-shell-env`, and declares exactly three non-optional `method` members:
    `register`, `collect`, `list`.
  - Assert both facades are non-optional: the existing `only sessionTelemetry.flush
    is marked optional` test must still hold (the new definitions add no
    optional, getter, or forward member).
  - Assert a complete mocked jobs service yields a frozen active facade with
    only `isActive` and the nine callable methods; a complete mocked shellEnv
    service yields a frozen active facade with only `isActive` and the three
    callable methods; confirm the official mock services are not frozen or
    otherwise altered.
  - Attempt assignment, deletion, and extension against both the namespace and
    each active facade, then verify the original keys, methods, and values
    remain observable to every consumer.
  - References: `requirements.md` §1 AC 1, 3–6; §7 AC 1—3; `design.md` §3.1,
    §4.2.1, §6.

#### 1.2 Implementation

- [x] Update `lib/services.js` by appending the approved static `jobs` and
  `shellEnv` definitions to `SERVICE_DEFINITIONS` (after `compaction`).
  - Reuse the existing generic definition/facade machinery. Do not add a
    special-purpose builder, runtime property enumeration, class/package
    detection, official package import, or peer dependency.
  - Preserve all pre-existing definition order and members. The derived
    `SERVICES_NAMESPACE_KEYS` and default disabled namespace must become
    21-key surfaces through the existing derivation.
  - Do not change `lib/guards.js` message text yet (reserved for Task 4.2).
  - Run the focused service-definition and namespace tests.
  - References: `requirements.md` §1 AC 1–6; `design.md` §3.1, §4.1.

---

### 2. Preserve transparent jobs/shellEnv passthrough behavior

#### 2.1 Contract-first tests

- [x] Extend `test/services-passthrough.test.mjs` with jobs/shellEnv-specific
  call-recording mocks before relying on the generic implementation.
  - Reword the generic test that iterates `SERVICE_DEFINITIONS` (its title
    currently says "all 19 services") to "all 21 services"; the loop
    auto-covers the new definitions.
  - Verify each declared operation delegates with the official service as
    `this`, forwards all supplied values by identity and in order, and returns
    the exact official result or promise.
  - Verify omitted trailing optional arguments stay omitted:
    `jobs.kill(id)`, `jobs.wait(id, timeoutMs)`, `jobs.get(id)`,
    `jobs.read(id)`, and `jobs.list()` forward exactly the supplied argument
    list; the fully-specified forms (`kill(id, caller, reason)`,
    `wait(id, timeoutMs, caller, signal)`) preserve supplied identities.
  - Verify `onJobDone`, `onJobsChanged`, `attachController`, and
    `shellEnv.register` return the exact disposer the official service
    returns, and that the facade never disposes, caches, or wraps it.
  - Verify `shellEnv.collect(execution)` and `shellEnv.list()` preserve
    returned-value identity.
  - Verify an official synchronous throw and a rejected promise propagate
    unchanged, without logging, wrapping, retrying, or recovery behavior.
  - References: `requirements.md` §2 AC 1–9, AC 10; §3 AC 1–7; §7 AC 2–3;
    `design.md` §2.2, §3.1, §5.

#### 2.2 Implementation

- [x] Confirm the generic `buildActiveFacade()` method delegation satisfies the
  new tests; make only the narrowly required shared-factory correction if the
  test demonstrates a gap.
  - Preserve rest-argument delegation so omitted optional trailing arguments
    stay omitted. Do not add validation, cloning, freezing, caching, or job/
    environment policy behavior.
  - Run `node --test test/services-passthrough.test.mjs`.
  - References: `requirements.md` §2, §3; `design.md` §2.2, §5.

---

### 3. Implement per-definition build containment and disabled facades

#### 3.1 Contract-first tests

- [x] Extend `test/services-optional-member.test.mjs`,
  `test/services-disabled.test.mjs`, and `test/services-namespace.test.mjs`
  with jobs/shellEnv degradation cases before implementation.
  - With active `services`, verify a missing or non-callable declared member on
    a mock jobs service produces one frozen P4 `services.jobs` facade with
    `isActive === false`, all nine declared members observable, and no partially
    active surface. Same for each declared member of `services.shellEnv`.
  - Verify targets carrying extras (private fields, `LocalJobRegistry`-style
    internals, `ShellEnvRegistry`-style internals, arbitrary members, and
    `ctx.shell`-style irrelevant methods) expose none of those extras.
  - Verify a missing/throwing `ctx.get('jobs')` or `ctx.get('shellEnv')` while
    another service is available disables only the affected facade as P4 and
    makes no official call through its disabled methods.
  - Verify hostile declared-member access or other active-facade construction
    failure disables only that service, is best-effort logged where a logger is
    supplied, and leaves independently complete service facades active.
  - Verify P1 precedence for every declared operation on both an already mounted
    active facade and an already mounted P4-disabled facade after core
    deactivation: each call raises the typed inactive error before any official
    method access.
  - Verify the both-missing case: with active `services` and both
    `ctx.get('jobs')` and `ctx.get('shellEnv')` absent while other services are
    available, only those two facades are disabled and every available sibling
    (including a present one of the two) remains active.
  - References: `requirements.md` §4 AC 1–8; §7 AC 4–5, 7; `design.md` §3.3,
    §5–6.

#### 3.2 Implementation

- [x] Confirm `createServicesNamespace()` in `lib/services.js` already
  enforces per-definition containment for the two new definitions (the SV17
  boundary is generic). Make only the narrowly required correction if the new
  tests demonstrate a gap.
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
  - References: `requirements.md` §4 AC 1–8; `design.md` §3.3, §5.

---

### 4. Exercise definition-derived guard, pre-mount, apply, and cardinality behavior

#### 4.1 Contract-first tests

- [x] Update `test/guards.test.mjs` and `test/plugin-api-service.test.mjs`
  for the 21-definition services contract.
  - Verify a complete jobs service as the only resolvable official capability
    makes `runFeatureGuard('services')` pass; same for a complete shellEnv
    service alone.
  - Retain P2 failures when `ctx.get` is absent or every one of the 21
    definitions is unavailable.
  - Verify the pre-mount default disabled namespace includes jobs and shellEnv,
    calls report P2 `services` (or P1 when core inactive), and do not invoke
    `ctx.get('jobs')` / `ctx.get('shellEnv')`.
  - References: `requirements.md` §1 AC 2; §4 AC 5–6; §7 AC 6–7; `design.md`
    §3.3–3.4, §5–6.

#### 4.2 Implementation

- [x] Make the narrowly required updates: update the `services` guard
  diagnostic message text in `lib/guards.js` from "19" to "21", and update
  `test/guards.test.mjs` wording/counts accordingly. Do not change either
  module's production behavior for jobs/shellEnv beyond that text.
  - Do not introduce `runFeatureGuard('jobs')` / `runFeatureGuard('shellEnv')`,
    a dedicated mounter, a feature-registry record, or mount-order/lifecycle
    changes.
  - Run `node --test test/guards.test.mjs test/plugin-api-service.test.mjs`.
  - References: `requirements.md` §1, §4; `design.md` §3.4.

#### 4.3 Apply and cardinality tests

- [x] Extend `test/index-services.test.mjs`, `test/m2-integration-cardinality.test.mjs`,
  and `test/m2-integration-lifecycle.test.mjs` with host-apply isolation and
  exact-cardinality coverage.
  - With only complete jobs/shellEnv mocks available, assert `services` mounts
    active, both new facades are active, all other 19 unavailable capability
    facades retain their P4 behavior, and `apply()` does not throw.
  - With a hostile or incomplete jobs/shellEnv mock and another complete
    service, assert the affected facade is P4-disabled while the other service
    remains active and `apply()` does not throw.
  - Update `SERVICES_NAMESPACE_KEYS` cardinality to 21 and resequence the
    21-key allowlist in `m2-integration-cardinality.test.mjs`; the event catalog
    (47) and durable-record (5) cardinalities remain unchanged. Add an explicit
    negative assertion that no `jobs/*` or `shellEnv/*` name appears in the
    composed catalog (mirroring the existing `compaction/*` negative check).
  - Update the services-namespace key-count assertion in
    `m2-integration-lifecycle.test.mjs` to 21.
  - Preserve the existing single `services` mounter and feature registry path;
    do not add a jobs/shellEnv event/catalog, client contribution, or provider
    registration behavior.
  - Run `node --test test/index-services.test.mjs test/m2-integration-cardinality.test.mjs test/m2-integration-lifecycle.test.mjs`.
  - References: `requirements.md` §4 AC 7–8; §5 AC 1–7; §7 AC 1, 6, 8;
    `design.md` §2.1, §3.4, §6.

---

### 5. Migrate pro-ex Windows Git Bash tool and run migration acceptance

> Acceptance evidence per requirements §6 (not the feature's purpose semantics).
> Scope is limited to the Git Bash tool wiring; unrelated pro-ex code must not
> change.

#### 5.1 Migration implementation

- [x] In `../dsh-pro-ex-ability-anchor`, rewire the Windows Git Bash tool's two
  seams through the facade:
  - In `lib/index.js`, resolve `pluginApi.services.jobs` and
    `pluginApi.services.shellEnv` from `ctx.get('pluginApi')` and pass them (or
    facade-bound accessors) into `createGitBashToolDefinition`, removing the
    direct `ctx.get('shellEnv')` and `ctx.get('jobs')` wiring for these seams.
  - In `lib/windows-gitbash.js`, switch both feature-detection sites from
    `typeof`/null checks to the facade's `isActive` signal:
    - The build-time `managedDshEnv` claim (`shellEnv && typeof
      shellEnv.collect === 'function'`) becomes an `isActive` probe on the
      facade's `shellEnv` member.
    - The execution-time background-availability branch (`jobs === undefined ||
      jobs === null`) becomes an `isActive` probe on the `jobs` member, and the
      "background jobs unavailable" error path is preserved.
  - Keep `jobs.start({...})` returning the facade-provided job id and
    `shellEnv.collect(exec)` returning the facade-provided environment overlay.
  - Do not change foreground behavior, schema, timeout, or abort semantics.
  - References: `requirements.md` §6 AC 1–4; `design.md` §6.1.

#### 5.2 Migration tests

- [x] Update `test/windows-gitbash.test.mjs`:
  - Extend `makeCtx()` (or the relevant fixtures) to inject facade doubles for
    `pluginApi.services.jobs` and `pluginApi.services.shellEnv` with
    `isActive: true` and recording `start`/`collect`/`list`/`register` methods
    that satisfy the existing producer-contract expectations (background
    registration → job id; `collect(exec)` → environment overlay).
  - Update the direct unit constructions of
    `createGitBashToolDefinition({ ..., getJobs: () => jobs })` (the 6 sites
    built against the raw `makeJobs()` fake) so the supplied jobs object
    carries `isActive: true` — e.g. `makeJobs()` gains `isActive: true`, or the
    call sites pass a facade double — so the migration's `isActive` gate keeps
    the producer-contract tests green. The existing "background jobs
    unavailable" test (built with no `getJobs`) stays correct because a missing
    accessor still trips the gate.
  - Add or update a test proving the migrated tool obtains `$DSH_*` claims only
    via the facade's `shellEnv.collect`. Add a test proving the background path
    registers the process handle through the facade's `jobs.start`.
  - Add a test proving an `isActive: false` facade yields the same graceful
    degradation as before (managed-env claim omitted; background-unavailable
    error) without touching a direct `ctx.get`.
  - Run the focused Windows Git Bash tests in `../dsh-pro-ex-ability-anchor`.
  - References: `requirements.md` §6 AC 1–4; `design.md` §6.1.

#### 5.3 Migration acceptance verification

- [x] Run the relevant `dsh-pro-ex-ability-anchor` test command (its repository
  convention) and confirm it passes; report exact output if it fails.
  - Verify no supported Git Bash path still reaches `ctx.get('jobs')` /
    `ctx.get('shellEnv')` for these seams.
  - Run `git diff --check` in `../dsh-pro-ex-ability-anchor` and confirm only
    task-scoped changes remain.
  - References: `requirements.md` §6 AC 1–4; `design.md` §6.1.

---

### 6. Run full verification and synchronize feature records

- [x] 6.1 Run `node --test` for the entire `dsh-plugin-api` repository after
  Tasks 1–5 pass.
  - Resolve only regressions caused by the approved implementation. Keep the
    work limited to the design's existing services infrastructure and listed
    tests.
  - Confirm no package metadata change is required: production code accesses
    the injected services only and imports neither `dsh-jobs`,
    `dsh-jobs-local`, nor `dsh-shell-env`.
  - References: `requirements.md` §5, §7; `design.md` §3.5–3.6, §8.

- [x] 6.2 After the full suite passes, update the delivered-feature records.
  - Update `docs/specs/plugin-api-features/feature-list.md`:
    - Add source rows in §1.4 for `dsh-jobs`/`dsh-jobs-local` and
      `dsh-shell-env`.
    - Mark the two new capability seams delivered under §2.11: `services.jobs`
      (nine public abstract `JobRegistry` operations, live provider
      `dsh-jobs-local`) and `services.shellEnv` (three public
      `ShellEnvRegistry` operations).
    - State that neither seam is exposed as an events API.
  - Update `AGENTS.md` §8 with the `plugin-api-services-jobs-shellenv-m4`
    delivered row, including its 21-entry services namespace, the nine/three
    member contracts, scope-neutrality, and P4 construction containment.
  - Run `git diff --check` and rerun `node --test` if documentation changes
    affect checked repository artifacts.
  - References: `AGENTS.md` §8; `requirements.md` §1, §5–7; `design.md` §8.

- [x] 6.3 Final clean-up and commit.
  - Run `git diff --check` in both `dsh-plugin-api` and
    `../dsh-pro-ex-ability-anchor`.
  - Commit all Stage 4 code, tests, specs, migration, and registry updates in
    this worktree before final delivery or worktree cleanup.
  - References: AGENTS.md §3.2 (Stage 4 completion commit).

---

## Coverage Traceability

| Requirements | Tasks |
|---|---|
| §1 namespace integration and read-only shape (21 keys) | 1, 4 |
| §2 nine-operation jobs transparent passthrough | 2 |
| §3 three-operation shellEnv transparent passthrough | 2 |
| §4 P1/P2/P4 degradation and local isolation | 3, 4 |
| §5 no event, behavior, or namespace changes | 2, 4, 6 |
| §6 migration acceptance evidence (pro-ex Git Bash) | 5 |
| §7 focused tests and full regression coverage | 1–6 |

---

## Execution revision notes (Stage 4)

- **Parallel shared-file interaction (pro-ex, Task 5):** the sibling
  `plugin-api-tools-abort-helper-m4` feature (an explicit non-goal here) owns
  an in-flight, uncommitted migration in the same
  `../dsh-pro-ex-ability-anchor/lib/index.js` Git Bash block (its
  `makeAbortedError` / `fallbackPlainAbortError` region, lines ~289–295 and
  ~374–384). This feature's migration touched only the disjoint
  `shellEnv`/`getJobs` region. Both edits coexist in the shared working tree
  and the combined pro-ex suite (126 tests) passes. Per parallel-workflow
  protocol §2.3/§2.5, this is recorded and reported; the pro-ex commit is
  intentionally deferred to integration coordination so neither feature's
  uncommitted work is swept into the other's commit. No dsh-plugin-api shared
  production file is at risk (this feature changes only `lib/services.js` and
  the `lib/guards.js` message text).
- Tasks 1–5 completed with blocking adversarial review per batch (PASS;
  non-blocking suggestions folded in). Task 6 finalizes docs/registry and
  commits the dsh-plugin-api worktree.
