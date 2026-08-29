# Stage 3 - Tasks

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.profile` | `pluginApi.profiles` |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

## Status

Stage 3 Tasks: 待执行。本清单承接已确认的 Goal / Requirements (PPM-1..PPM-12) 与 Design；经对抗性审查（返回"无偏差"）后直接进入 Stage 4，不设用户确认门。

## Execution Contract

- Execute the tasks in order. A task is complete only when its implementation
  and focused tests are green.
- Keep this feature **facade-first and executor-only-write**: the in-process
  facade (inspection mounter + mutation mounter) never implements profile
  write logic; every write lands through the out-of-process companion CLI
  (handshake-verified, "先验证后落盘 / CAS / 原子替换" pipeline). Read verbs
  remain fully functional when the executor is absent or mismatched
  (typed `unavailable` write results only, PPM-4.3).
- Consume only public host surfaces: `ctx.loader.entries()` (runtime view,
  captured once at apply), `ctx.baseUrl`-derived current profile path, node:fs
  reads for disk/other views, `llm.registerAdapter` contract (L2 mock row via
  the official `LlmAdapter` type of `@deepseek-ai/dsh-llm`). Never import
  private official modules and never modify `/usr/lib/node_modules/@deepseek-ai/dsh/**`.
- Every entry point is G1 fail-safe: failures degrade to typed results or
  quiet deactivation with a bounded diagnostic and never throw through plugin
  apply. Write verbs never throw; expected conflicts are stable `code` values.
- All public payloads are deeply frozen; audience rules follow
  `visibility-and-redaction.md` (paths/env-derived default UI/diagnostic
  visible, model-visible requires an explicit policy decision; secrets
  redacted in all audiences; progress events expose stage names and reasons
  only). Redaction/freeze failure fails closed for that payload.
- No new events catalog slice, no client transport/remote/slot/settings
  bridge, no R replacement row, no upstream proposal registration, no
  governance tokens or requirement IDs in implementation code (neutral
  runtime naming only), no version bump (stays `0.1.0-rc.6-0.5` / `dsh.api 0.5`).
- Use the repository `npm test` scripts only (never bare `node --test`).
  Mark each completed task in this file before the final Stage 4 commit.
- Shared test-count/order assertions (`features.length` across
  `test/index*.test.mjs`), package policy tests (`test/package.test.mjs`,
  `test/package-policy.test.mjs`) and the baseline installed
  `@deepseek-ai/dsh-llm` identity (0.1.0-rc.6, runtime guard) are
  integration-owned deltas: update them deliberately and document the change
  in the Stage 4 record.

## Tasks

- [x] 1. Implement the shared tolerant folding parser and its pure test suite.
  - Change the main package runtime surface: add `js-yaml@^4.3.1` to
    `package.json` `dependencies` (the single justified runtime dependency —
    the YAML dialect of profile patch layers is the official `js-yaml`
    `JSON_SCHEMA` + `!!js` custom type; this is the format-coupling single
    point the design mandates), and add an internal-shared subpath export
    `"./profile-fold": "./lib/profile-fold.js"` to `exports`. Update
    `test/package.test.mjs` (the "no runtime dependencies" assertion becomes
    "the only runtime dependency is js-yaml" and the expected-entry-points
    assertion gains `./profile-fold`). The `test/package-policy.test.mjs`
    unified version-policy loop is extended to include
    `@deepseek-ai/dsh-plugin-api-profile-manager` **only in Task 9, after the
    executor package exists** (Task 4) — do not attempt it here; keep
    `full.dependencies` exactness changes for Task 9 too. Note that the
    "auxiliary packages do not declare the main package as a runtime
    dependency" test iterates only the five replacement bundles and stays
    unchanged: the executor is a plain npm package (not a replacement
    bundle) and per the design it intentionally depends on the main package
    (`workspace:*`) to import the same `./profile-fold` implementation — do
    not add the executor to that replacement-only test. Verify after editing
    that `npm install`-level state is irrelevant: the worktree keeps the
    known-green rc.6 installed tree, and `require('js-yaml')` resolves from
    the fold module (mirror the pnpm layout with the already-present
    `node_modules/.pnpm/js-yaml@4.3.1` store link if needed; do not re-run a
    bare `pnpm install` that would reconcile the drifted lockfile and break
    the runtime guard — reconcile the lockfile with `pnpm install
    --lockfile-only` and update the running node_modules by hand if required).
  - Add `lib/profile-fold.js`, a pure-function module with **zero harness
    dependencies** (only `js-yaml`), exporting:
    `foldLayers(files) → ResolvedView`, `healthFindings(view) → Finding[]`,
    `planConfigOverlay(intent)`, `planDependencySet(intent)`.
    `foldLayers` folds profile layers in official composition order
    (`package.json` `dsh.profile.bundles` → `cordis.patch.yml` → supplied
    overlay contents) into `ResolvedView { view, profile?, rows[{id,name,
    bundle,source}], layers[{kind,status:'folded'|'unavailable',reason?}],
    packages[{name,version,scope:'core'|'user',dependencies}], capturedAt }`
    (PPM-1.1, PPM-1.2 shape). It is tolerant: unknown fields are preserved in
    the frozen view; a layer that cannot be parsed or folded is marked
    `unavailable` with a reason code while successfully folded portions are
    still returned (PPM-1.4); `!!js` expressions are preserved verbatim
    (parsed with the official `js-yaml` `JSON_SCHEMA` extended by the
    `tag:yaml.org,2002:js` type mirrored from `dsh-app-boot`, kept raw and
    never evaluated); duplicate row ids from overlays are detected at fold
    time; `packages[].dependencies` holds the declared dependency map when
    available (unavailable mark when the layer is not foldable).
  - `healthFindings(view)` produces findings with codes
    `duplicate-row-id / missing-package / row-package-mismatch /
    version-inconsistent / unknown-layer`, each `{ code, severity, subject,
    detail }`, where version consistency vocabulary mirrors constitution §4
    (runtime part + `dsh.api` part per package row) read-only (PPM-2.1,
    PPM-2.2). `health` findings are computed with zero side effects.
  - `planConfigOverlay(intent)` returns the candidate overlay content in
    memory as a YAML string (never written to any file) for configuration-type
    intents; `planDependencySet(intent)` returns `{ targetSet, delta }` for
    dependency-type intents without installing anything (PPM-3.1, PPM-3.2).
    Both are pure computations over the same fold result and never mutate
    snapshots, cache, or real profiles (PPM-3.3).
  - Add `test/profile-fold.test.mjs` (pure, zero harness deps): golden
    folding samples (real `dev`/`headless` profile shapes: bundles from
    package.json, cordis.patch.yml with `!!js` scalars and block scalars,
    overlay entries), unknown/duplicate/unparseable layer degradation,
    `!!js` raw preservation, health finding codes each triggered, planDiff
    config overlay correctness, dependency target-set calculation, and a
    zero-side-effect assertion (directory hash unchanged after planDiff).
    Cover PPM-1.1/1.2/1.4, PPM-2.1/2.2, PPM-3.1/3.2/3.3.

- [x] 2. Implement the inspection mounter (projection face) with the
    runtime-view snapshot and typed/frozen results.
  - Add `lib/profile-inspection.js` exporting
    `createProfileInspection({ ctx, logger, fold, now })` returning
    `{ api, dispose }`; the API is a frozen object with `inspect({view,
    profile?})`, `health(target)`, `planDiff(intent)`.
  - `inspect` supports three views: `runtime` returns the boot-time
    composition snapshot captured **once at apply time** from
    `ctx.loader.entries()` (observed fields only: row id, name/package,
    enabled, fiber phase when observable; never re-reads disk at call time,
    never tracked post-init — PPM-1.3, PPM-1.7); `disk` folds the current
    profile's disk files in official composition order (PPM-1.1) — the
    current profile path is derived from `ctx.baseUrl` (fallback: `DSH_HOME`
    env then default home, `profiles/<basename>`; unresolved → typed
    `unavailable` with reason); `other` reads an explicit profile directory
    **strictly read-only** with an identical result shape (PPM-1.2). Any
    layer failure marks that layer `unavailable` and keeps the successful
    portions (PPM-1.4); runtime-view fields not observable at init time are
    reported `unavailable` and never fabricated from disk (PPM-1.5).
  - All returned payloads are deep-frozen read-only views (PPM-1.6);
    filesystem paths and environment-derived values follow the audience
    rules (UI/diagnostic visible by default; model-visible only through an
    explicit non-secret visibility decision), credentials/tokens/secrets
    discovered in profile files are redacted in all audiences
    (PPM-12.1, PPM-12.2). Freeze/redaction failure fails closed for that
    payload.
  - `health(target)` accepts the same view targets and returns a frozen
    `{ findings }` report (PPM-2); `planDiff(intent)` returns a frozen
    `PlanDiff { intentType:'config'|'deps', overlayYaml?, depSetDelta?,
    warnings[] }` (PPM-3).
  - The whole mounter is a G1 container: any internal failure degrades the
    affected result and never throws through apply (PPM-4.1).
  - Add `test/profile-inspection.test.mjs`: three-view inflation with a
    fixture profile directory (temp dir), runtime-view snapshot from a mock
    loader (entries with id/name/disabled/fiber), unavailable-layer
    tolerance, unexpected profile path behavior, redaction/freeze
    guarantees, zero side effects on the fixture directory, and G1
    containment (throwing loader/fs degrades, never throws).

- [x] 3. Implement the facade guard, service slot, and fail-safe mounting for
    the `pluginApi.profile` namespace.
  - Add the `profile` feature guard branch in `lib/guards.js`: probe
    `ctx.get` and `ctx.loader.entries` (the runtime view is a mandatory
    deliverable; a boot without the loader cannot serve it) with the same
    isolated-probe style as sibling features. **Task-level decision (recorded
    for the global review)**: a missing loader disables the whole `profile`
    feature with a bounded diagnostic — guarded-quiet-deactivation per
    PPM-4.1 is the minimal implementation; per-layer `unavailable`
    degradation of disk/other views without the loader is deferred and out
    of scope. Executor presence is NOT part of the guard (PPM-4.3: absence
    degrades write verbs at call time, read side unaffected).
  - Register the feature in `lib/plugin-api-service.js`: add `profile` to
    `KNOWN_FEATURES`; wire `_readSlot('profile')`, a disabled surface
    (`createDisabledProfileApi` with the standard typed inactive/disabled
    errors for every member), and the `unmountFeature('profile', token)`
    branch; expose `pluginApi.profile` as a service getter (agent-style)
    that composes the inspection surface (Task 2) and the mutation surface
    (Task 8) with per-caller context capture, or as a `createFeatureSlot`
    when the caller-context capture is not needed for a member — choose the
    minimal mechanism that lets the mutation mounter resolve the calling
    plugin's package identity at access time (PPM-6.8, binding level decided
    by the design: identity comes from the caller's fiber/loader entry, never
    from a bare caller-supplied string).
  - Add `mountProfileFeature` in `lib/index.js`, registered in
    `FEATURE_MOUNTERS` after `tasks` (batch order; profile has no dependency
    on sibling features). The mounter builds the inspection owner (capturing
    the runtime-view snapshot at mount), lazily constructs the mutation
    remote client (Task 8), registers cleanup via `ctx.effect`, and uses the
    standard prepared-mount transaction pattern; any construction failure
    degrades only `profile` with a bounded diagnostic (PPM-4.1).
  - Update shared integration-owned assertions: `features.length` 23 → 24
    with `profile` last and the affected exact-order blocks across
    `test/index.test.mjs`, `test/index-agent.test.mjs`,
    `test/index-events.test.mjs`, `test/index-session.test.mjs`,
    `test/index-system-prompt.test.mjs`, `test/index-tools.test.mjs`,
    `test/index-remote.test.mjs` (tail-order relative assertions),
    `test/index-diagnostics.test.mjs` (last-item `tasks` assertion), and
    `test/index-session-durable.test.mjs` (full ordered features-name list)
    — mirror the coordination-lease precedent where the shared assertions
    were updated in the same feature commit. Mock contexts used by these
    suites gain a minimal `loader.entries()` stub returning an empty list
    (or the profile feature is asserted as guard-disabled where the mock
    lacks `ctx.get`).
  - Add `test/profile-guard.test.mjs` and `test/index-profile.test.mjs`:
    active mount with loader present, guard failure (loader missing) disables
    only `profile` and keeps the facade active, disabled surface throws
    typed inactive/disabled errors, repeated apply/unapply idempotence, and
    isolation from execution/recovery/usage/routing/client surfaces.

- [x] 4. Implement the executor package skeleton: CLI, handshake, protocol,
    storage scope, config, and audit.
  - Add `packages/profile-manager/` as a plain npm package (NOT a Cordis
    bundle, NOT a replacement row): `package.json` with name
    `@deepseek-ai/dsh-plugin-api-profile-manager`, the unified full unique
    version `0.1.0-rc.6-0.5` / `dsh.api: "0.5"` (same version scheme as the
    main package — the handshake compares these), `bin` entry, `type:
    module`, and a dependency on the main package (`workspace:*` in-repo) for
    the shared `./profile-fold` module (design: same fold implementation on
    both sides). Do NOT add it to `full.dependencies` yet (Task 8 decides the
    aggregate wiring).
  - Implement the CLI entry with subcommands: `handshake`, `quick-write`,
    `snapshot-create`, `snapshot-modify`, `snapshot-validate`,
    `snapshot-delete`, `snapshot-apply`, `gc`. Arguments are JSON intents on
    stdin or argv (choose one, keep it stable across commands). stdout is
    JSON-lines: for handle-bearing operations, zero or more
    `{type:'progress', operationId, stage, reason?}` events followed by one
    terminal `{type:'result', outcome, ...}`; for instant operations, one
    terminal `{type:'result', ...}`. Exit code mirrors the terminal class
    (0 success, 1 error, 2 aborted, 3 denied, 4 superseded; timeout reported
    as error outcome with a timeout reason classification).
  - `handshake` prints `{ builtForRuntime, apiProtocol }` derived from the
    executor's own `package.json` (runtime part of the full version +
    `dsh.api`) and resolves nothing else.
  - Storage scope (all under the resolved `$DSH_HOME`, default
    `resolveDshHome()` semantics, respecting the `DSH_HOME` env var):
    `plugin-api/profile-manager/{snapshots,cache/seed,backups,audit.log,tmp}`
    (profile scope per `durable-state-and-scope.md` §1). Initialize
    directories lazily and defensively.
  - `config.json` in the storage scope: `{ quotaPerOwnerMb: 256,
    quotaTotalMb: 1024, backupRetentionN: 5 }` (defaults applied when
    missing or partial; fail-closed — never relax an existing quota).
  - Audit appends a JSONL `audit.log` record on every terminal state:
    `{ at, owner, op, target, outcome, reasons[], generation? }`
    (PPM-9.1); append-only infrastructure with no public write entry
    (PPM-9.2); an audit failure degrades the `auditability` flag on the
    result, never crashes the operation after commit (PPM-9.3).
  - Add `packages/profile-manager/test/executor-skeleton.test.mjs`
    (offline, temp `$DSH_HOME` fixtures): version policy fields, CLI arg
    parsing per subcommand, handshake output shape, JSON-lines result
    envelope per command class, exit-code mapping, storage scope
    initialization, config.json defaults and fail-closed overrides, audit
    append shape and append-only behavior, audit-failure degradation.

- [x] 5. Implement executor snapshot lifecycle and storage governance.
  - `snapshot-create` takes `{ owner, source: 'runtime'|'disk', sourceProfile?,
    name? }`, creates a snapshot as a **near-instant atomic step** using lazy
    materialization: configuration files are copied now; dependencies are
    materialized only at the first `validate` (hardlink clone from the seed
    cache — see below) (PPM-6.1). Returns the typed result with the durable
    `snapshotId` (persisted UUID, distinct from content generation — PPM-6.9),
    owner, `lifecycleState: 'clean'`, and path.
  - `snapshot-modify` applies edits (config overlay / dependency-intent)
    without validation and flips the snapshot to `dirty` (PPM-6.2).
  - `snapshot-delete` removes only snapshots whose recorded owner matches the
    provided owner handle; a different owner gets a typed `ownership-conflict`
    result (PPM-6.7). Deletion is idempotent on already-deleted snapshots.
  - Seed cache: on the first-ever quick-write/snapshot-create, create the
    system-owned global seed by hardlink-cloning the target profile's
    `node_modules` into `cache/seed/` (PPM-8.1). Subsequent dependency
    materializations clone from the seed via hardlinks and reconcile
    dependency deltas inside the snapshot only (PPM-8.2). When the source
    profile's dependency fingerprint changes, rebuild the seed atomically
    (PPM-8.3).
  - Quotas: account apparent bytes of snapshot directories; default
    256 MB per owner and 1 GB total (PPM-8.4); the seed cache is
    system-owned and excluded from owner quotas (PPM-8.4). A create/modify
    that would exceed quota returns a typed `quota-exceeded` result;
    existing non-orphan data is never auto-deleted to free space (PPM-8.5).
  - Concurrency strategy (design KDD #4, requirements declaration): different
    owners' snapshot operations may run in parallel (owner-bounded
    parallelism); **operations on the same snapshotId are mutually
    exclusive** (executor-side serialization, e.g. a directory-level lock or
    atomic rename-based ownership claim — never in-process only, since each
    operation is a separate subprocess); seed-cache rebuilds are exclusive
    single-writer. The state machine (clean/dirty/validated, PPM-6.2/6.3/6.4)
    must be race-safe under concurrent validate/modify on the same snapshot.
  - `gc` classifies snapshots whose owner is absent from both the supplied
    runtime view (passed by the facade) and the target profile's declared
    dependencies, or whose target profile no longer exists, as orphaned and
    deletes them immediately (PPM-8.6); the reinstall-cycle loss tradeoff is
    documented in user-facing docs (Task 9, PPM-8.7). Test shorthand: owner
    absent from BOTH runtime view and declared deps → delete; owner still a
    declared dependency (reinstall cycle) → keep; target profile no longer
    exists → delete.
  - Add `packages/profile-manager/test/snapshot-lifecycle.test.mjs` and
    `test/storage-governance.test.mjs` (temp `$DSH_HOME` fixtures, offline):
    create/modify/delete states and direct typed results, ownership-conflict,
    lazy materialization (no node_modules work before first validate), seed
    cache creation and hardlink reuse, fingerprint-driven atomic rebuild,
    quota rejection with config.json override coverage, GC orphan
    classification per the full criteria above, and a concurrency case
    (concurrent modify+validate on the same snapshotId → deterministic
    terminal state, state machine uncorrupted; different-owner parallelism
    does not block).

- [x] 6. Implement the executor validation pipeline: L1, L2 mock-first, and
    client-half mechanical validation.
  - `snapshot-validate { operationId, snapshotId, level }` runs the requested
    level and returns a handle-bearing operation (progress events then
    verdict). `level` accepts `'basic'` (structural, L1) and/or `'boot'`
    (isolated boot, L2) with a neutral runtime vocabulary (no L1/L2 literal
    tokens in code).
  - **Validation-pass state transition (PPM-6.3)**: WHEN the requested level
    passes THEN the executor SHALL persist the snapshot's `lifecycleState`
    as `validated`, bound to the snapshot's current content generation
    (recorded as `validatedGeneration`), atomically with the verdict
    publication — this is the state the apply gate (Task 7) reads. A partial
    or failed validation leaves the state unchanged (`clean` or `dirty`
    stays as-is). The verdict result carries the resulting
    `lifecycleState`/`validatedGeneration` so the facade can present it.
    The subsequent `validate`-pass → `apply`-success happy path must be
    acceptance-tested (see Task 7 test list).
  - L1: run `dsh --dump-config` against the staged profile (structural
    health: parseable composed tree, no fold conflicts, no duplicate row
    ids); a crash before completion fails validation (PPM-5.5).
  - L2 mock-first flow: stage the snapshot under a disposable DSH_HOME
    (`<storage>/tmp/profiles/l2check-<id>/`); seed `settings.yaml` so the
    default agent model points at the mock provider; append a validation
    overlay that pins ports (the `webserver` row port override) and inserts
    the bundled mock row; run `DSH_HOME=<tmp> dsh --profile l2check-<id>
    <task>` with the `dsh` binary resolved from PATH (env override seam for
    hermetic tests: `DSH_PLUGIN_API_PROFILE_DSH_BIN`). The mock row is a tiny
    bundle shipped inside the executor package that registers the official
    `llm.registerAdapter` contract (`@deepseek-ai/dsh-llm` `LlmAdapter`
    type) for a fixed provider/model returning deterministic completions; it
    exists only inside the disposable validation environment and is never
    written to any real profile or shipped as a replacement row (PPM-5.3).
    Mock-first requires zero network access and zero real credentials seeded
    (PPM-11.2).
  - Verdict object (frozen): `{ bootHealthy, rowsApplied, caveats[],
    clientWarnings[] }` — the judged object is boot health and row apply,
    NOT inference success (PPM-11.1). If the mock strategy is unavailable and
    execution falls back to a real-model call, provider-layer failures
    (credit/auth/rate-limit/network) occurring after boot completion are
    recorded as caveats and the verdict passes (PPM-5.4, PPM-11.3);
    boot-phase crashes always fail validation in either strategy (PPM-5.5,
    PPM-11.4).
  - Client-half mechanical validation (`level` always runs it when the
    staged content contains client code): blocking (`client-blocking`)
    → syntax errors, forbidden import-boundary violations (e.g. node
    built-ins in client entries), `dsh.client` manifest conformance failures
    (PPM-10.1); non-blocking warnings → dangerous-sink heuristics (eval,
    unsafe innerHTML patterns, wildcard postMessage) using a warning
    vocabulary **shared** with the threat-model checklist deliverable
    (PPM-10.2). Mechanical validation stops at the package layer — no
    browser runtime behavior validation. Blocking results fail the verdict;
    warnings never veto the boot.
  - Add the bundled mock row module under the executor package with its own
    focused test (official `llm.registerAdapter` shape: providers array,
    adapter implementing the official `LlmAdapter` contract against the
    installed `0.1.0-rc.6` dsh-llm types).
  - Add `packages/profile-manager/test/validate-pipeline.test.mjs` with an
    injectable fake `dsh` (the env seam) simulating: clean boot (exit 0),
    boot crash (non-zero before completion), provider-layer failure after
    boot (caveat path, pass verdict), and L1 dump failures; verdict
    classification matrix per PPM-11; offline zero-network assertions; port
    pinning and mock-insert overlay contents; and
    `test/client-mechanical-validation.test.mjs` covering
    `dsh.client`-manifest conformance failure, forbidden import, syntax
    error → blocking; eval/unsafe-innerHTML/wildcard-postMessage → warning
    with shared vocabulary; pure client content isolation (never touches
    real profiles or the browser side).

- [x] 7. Implement the executor commit path and both write pipelines.
  - `quick-write { operationId, owner, intent, profile? }` runs the full
    pipeline automatically: prepare (config-type: generate the candidate
    patch overlay with the shared fold module; dependency-type: clone/lazy
    materialize + pnpm reconciliation inside the staging area) → validate
    L1 + L2 (Task 6, both levels once) → commit (PPM-5.1). It returns a
    handle-bearing operation for the whole pipeline.
  - `snapshot-apply { owner, snapshotId }` performs fast dependency
    reconciliation against the warmed store, then atomic config swap, then
    backup rotation; any failure aborts the whole apply with the real
    profile unchanged (PPM-6.6). It is a hard gate: applying a snapshot
    whose current content generation is not `validated` returns a typed
    `gate-conflict` result (PPM-6.5); a later modification reverts state to
    `dirty` and invalidates the validated generation (PPM-6.4).
  - Commit semantics shared by both pipelines: verify the real profile's
    baseline hash (computed at prepare time) — a differing hash returns a
    typed `cas-conflict` with the profile byte-identical and a rebase
    notice (PPM-5.6); config swap is atomic (official dsh-atomic-write
    paradigm: write sibling temp + rename; a partial-write state is never
    externally visible — PPM-5.7); backups rotate with bounded retention
    `backupRetentionN` (default 5, config-tunable) into
    `backups/<profile>/<generation>/` with owner-local monotonic
    generations, dropping the oldest (PPM-5.8); on success the terminal
    result carries an explicit `restartRequired: true` notice when config
    or dependencies actually changed (PPM-5.8/6.6, UI-visible); any failed
    pipeline stage leaves the real profile byte-identical to its
    pre-operation state (PPM-5.9). Rollback source is the created backup
    generation.
  - Add `packages/profile-manager/test/commit-pipeline.test.mjs` (temp
    `$DSH_HOME` fixtures): quick-write happy path with fake `dsh` (mock L2,
    fully offline), CAS conflict after prepare-time tampering, atomic swap
    no-partial-write (kill mid-commit check), backup rotation bounded N and
    rollback restore, `gate-conflict` on unvalidated/dirty snapshots,
    validated-generation invalidation after modify, the full manual-snapshot
    happy chain — `snapshot-create` → `snapshot-modify` → `snapshot-validate`
    (fake `dsh`, mock L2 offline) → state becomes `validated` with the
    bound `validatedGeneration` (PPM-6.3) → `snapshot-apply` succeeds
    (PPM-6.5/6.6) — plus byte-identical real-profile guarantee on every
    failure path, restartRequired truth on config/dependency change and
    false on no-op.

- [x] 8. Implement the mutation mounter (facade remote client) with handle
    semantics, executor resolution, and degradation.
  - Add `lib/profile-mutation.js` exporting
    `createProfileMutation({ ctx, logger, resolveExecutor, fold })` returning
    `{ api, dispose }`. Executor resolution order: explicit env override
    (`DSH_PLUGIN_API_PROFILE_EXECUTOR`, the same hermetic-test seam used on
    the executor side), then `require.resolve` of
    `@deepseek-ai/dsh-plugin-api-profile-manager/package.json` → its `bin`
    entry (production install), else absent → all write verbs return typed
    `unavailable` (PPM-4.3) while the read face stays fully functional.
  - At access/mount of the mutation face, resolve the calling plugin's
    package identity from the caller's fiber/loader entry (never from a bare
    caller-supplied string) and mint the scoped owner handle that snapshot
    and quick-write operations carry (PPM-6.8); unresolvable identity in a
    real boot resolves to the root/unknown owner token rather than guessing.
  - Handshake: on mount and on lazy retry (per failed write-verb
    invocation), spawn `handshake` and validate both directions — ①
    `builtForRuntime` equals the installed official runtime full identity,
    ② `apiProtocol` equals the main package `dsh.api` `major.minor`; a
    mismatch returns typed `unavailable` write results and never touches
    reads (PPM-4.2/4.3). Persist the handshake outcome with the typed code
    vocabulary.
  - Public surface: `apply(intent)` → operation handle; `snapshot.create`,
    `snapshot.modify`, `snapshot.delete`, `snapshot.apply` → direct typed
    results (near-instant atomic steps); `snapshot.validate(snapshotId,
    level)` → operation handle (PPM-7.1). Handle-bearing operations spawn
    the executor per operation, parse JSON-lines progress
    (`{operationId, stage, reason?}` — stage names and reasons only, no raw
    file contents, PPM-12.3), and settle to the unified terminal outcome
    vocabulary `success / error / aborted / denied / superseded` (timeout
    recorded as `error` with a timeout reason classification) on a single
    immutable terminal result carrying `restartRequired` and
    `auditability` (PPM-7.5).
  - Cancellation: `cancel()` before the commit stage sends SIGTERM and the
    operation settles `aborted` at the unified commit point with real
    profile and snapshot state consistent (PPM-7.3); cancel arriving after
    commit began receives a typed `too-late` rejection and the operation
    runs to its terminal outcome (PPM-7.4). Host shutdown kills and cleans
    up in-flight child processes (v1 kill-and-cleanup); orphaned staging
    artifacts are reclaimed by the GC rules (PPM-7.6).
  - All typed code values use the design's directory:
    `invalid-input / unavailable / quota-exceeded / ownership-conflict /
    gate-conflict / cas-conflict / too-late / layer-unavailable /
    client-blocking / internal`; expected conflicts are never thrown.
  - Add `test/profile-mutation.test.mjs` and
    `test/profile-handle-semantics.test.mjs` using a scripted fake executor
    (env-override seam): handshake ok/mismatch/absent matrix (reads intact,
    writes typed unavailable), owner binding from caller ctx, progress event
    sequence, cancel-before-commit → `aborted`, cancel-after-commit →
    `too-late`, terminal outcomes five-word exclusivity and immutability,
    timeout → error+reason, kill-and-cleanup on dispose, invalid-input
    validation before executor contact, and G1 containment on spawn/protocol
    failures.

- [x] 9. Complete integration, governance, and repository acceptance
    evidence.
  - Wire the mutation surface into the `pluginApi.profile` getter composed
    in Task 3; verify the composed namespace against the design surface
    (`inspect/health/planDiff` + `apply/snapshot.*`) and freeze all
    composed outputs.
  - Decide and land the aggregate wiring: add `@deepseek-ai/
    dsh-plugin-api-profile-manager` to `packages/full/package.json`
    dependencies (full install must carry the write-capable tooling; it
    adds no row — profile-manager is not a Cordis bundle), update
    `test/package-policy.test.mjs` `full.dependencies` exactness and the
    unified version-policy loop, and re-run the lockfile alignment per
    Task 1's notes.
  - Add a user-facing note on the executor install mode and the
    reinstall-cycle snapshot-loss tradeoff (PPM-8.7) in the feature docs;
    add the client-half threat-model checklist
    (`docs/specs/plugin-profile-management/client-threat-model-checklist.md`)
    with the shared warning vocabulary used by Task 6's mechanical
    validation, and append the client-audience section to
    `docs/standards/visibility-and-redaction.md` (design KDD #7 companion
    deliverables).
  - Update `docs/specs/plugin-api-features/feature-list.md`: add the
    `pluginApi.profile` namespace row under §2 (host-only, dual-face,
    executor-remote writes) and append the §7 delivery row; add the
    `plugin-profile-management` status row to the "当前立项状态" table in
    `docs/specs/plugin-api-features/dsh-plugin-api-heuristic-feature-proposals-2026-08-20.md`
    **and** synchronize that document's intro narrative in place (the
    "共 N 个候选正式立项 / 其余 M 个候选仍处于候选池" count sentence gains
    this feature and keeps its batch/status wording consistent with the
    table), while preserving candidate #20's original channel analysis and
    retirement-condition text.
  - E2E smoke: with the executor and the installed `dsh` (0.1.0-rc.6), run
    one real `quick-write` against a scratch profile under a temporary
    `$DSH_HOME` (temp script under `temp/`, deleted after use), verify the
    result carries `restartRequired`, and confirm the real profile files are
    atomically swapped; document the restart-then-verify manual checklist in
    the Stage 4 report. Mark slow integration cases so they do not drag the
    daily feedback loop.
  - Mark all tasks complete, then run focused profile tests, `npm test`
    (memory-guarded), `git diff --check`, the governance token audit
    (neutral runtime naming — no requirement IDs, no class letters, no
    workflow tokens in implementation files), a syntax/package check, and an
    installed official DSH package zero-modification check before the
    Stage 4 commit.

## Stage 4 Implementation Record

Completed 2026-08-25 (M6 第五批次, SPEC3) after all implementation tasks,
verification and the global final review passed.

- **Final host surface**: `pluginApi.profile` with frozen members `inspect`
  (views runtime / disk / other), `health`, `planDiff` (inspection mounter,
  `lib/profile-inspection.js`) and `apply` / `snapshot.create|modify|
  validate|delete|apply` (mutation mounter, `lib/profile-mutation.js`, wired
  as a lazy provider). Runtime feature key `profile` (guard branch in
  `lib/guards.js`; `FEATURE_MOUNTERS` entry after `tasks`; service slot +
  disabled surface + `KNOWN_FEATURES` in `lib/plugin-api-service.js`).
- **Shared fold parser**: `lib/profile-fold.js` (pure, zero harness deps,
  `js-yaml` as the main package's only runtime dependency; `./profile-fold`
  subpath export serves both the facade and the executor). Tolerance
  contract (unknown fields preserved, un-foldable layers marked unavailable,
  `!!js` raw), health finding codes, planDiff pure computations.
- **Executor**: `packages/profile-manager/` (plain npm package + bin; NOT a
  Cordis bundle / replacement row; full visible version `0.1.0-rc.6-0.5`,
  `dsh.api 0.5`; workspace dependency on the main package for the shared
  fold module). Commands `handshake` / `quick-write` / `snapshot-create|
  modify|validate|delete|apply` / `gc`; JSON-lines protocol; exit code maps
  the terminal class; storage under `$DSH_HOME/plugin-api/profile-manager/`
  (snapshots / cache/seed / backups / audit.log / tmp); config.json quotas
  256MB/1GB + backupRetentionN=5 (fail-closed); append-only JSONL audit in
  the executor process.
- **Validation**: level tokens `basic` / `boot` (neutral runtime vocabulary);
  L1 = `dsh --dump-config` structural health; L2 = disposable DSH_HOME with
  seeded settings.yaml + port-pinned/mock-insert overlay + headless boot;
  verdict `{ bootHealthy, rowsApplied, caveats[], clientWarnings[] }` judges
  boot health, never inference success; provider-layer failures after boot
  are caveats (pass), boot-phase crashes block. Bundled mock row
  (`lib/mock-row.js`, official `llm.registerAdapter` + `inject: ['llm']`)
  exists only in the disposable environment. Client-half mechanical
  validation (`lib/client-check.js`): syntax / forbidden node built-ins /
  `dsh.client` manifest conformance block; eval / unsafe-inner-html /
  wildcard-postmessage are non-blocking shared-vocabulary warnings.
- **Commit path** (`lib/commit.js` + `lib/pipelines.js`): CAS baseline hash
  -> atomic sibling-temp+rename swap -> bounded backup generations with
  rollback source; quick-write (prepare -> validate basic+boot -> commit)
  and snapshot-apply (validated-generation gate) both leave the real
  profile byte-identical on every failure path; `restartRequired` truth on
  config/dependency change.
- **Focused tests**: `test/profile-fold.test.mjs` (13),
  `test/profile-inspection.test.mjs` (11), `test/profile-guard.test.mjs`
  (7), `test/profile-mutation.test.mjs` (9) and executor package tests
  (executor-skeleton 10, snapshot-lifecycle 9, storage-governance 7,
  validate-pipeline 9, client-mechanical-validation 7, commit-pipeline 13)
  — 95/95 profile-focused green in isolation.
- **Shared suites**: `features.length` 23 -> 24 + order assertions updated
  across `test/index*.test.mjs` (incl. the three extra suites identified in
  review); `test/package.test.mjs` (entry points + single js-yaml runtime
  dependency); `test/package-policy.test.mjs` (version-policy loop +
  `full.dependencies`); `packages/full/test/patch-composition.test.mjs`;
  `test/official-passthrough-independence.test.mjs` (branch-added features
  list gains `profile`).
- **Full suite**: `npm test`（memory-guarded）= 1877/1877 pass.
- **Governance**: `git diff --check` clean; governance-token audit clean
  (neutral runtime naming incl. `basic`/`boot` level tokens and the mock
  package name); no private official imports; official DSH packages
  untouched; no version bump (`0.1.0-rc.6-0.5` / `dsh.api 0.5`).
- **Registration**: `feature-list.md` §2.13 `pluginApi.profile` namespace
  row + §7 delivery row; heuristic proposals status table row + intro
  count sentence synchronized; `visibility-and-redaction.md` §4 client-half
  audience section; `client-threat-model-checklist.md` (shared warning
  vocabulary); executor `README.md` (install modes + reinstall-cycle
  tradeoff).
- **E2E smoke**: one real quick-write against a scratch profile under a
  temporary `$DSH_HOME` (installed dsh 0.1.0-rc.6, mock L2 fully offline):
  success with `restartRequired: true`, atomic swap verified, 81 composed
  rows, backup + audit present; manual restart checklist documented and the
  temp script deleted after use.
- **Global-final-review revisions (2026-08-25, whole-delivery fix round)**:
  - owner binding minted from the caller fiber/loader entry per access
    (never from a bare caller-supplied string; root/unknown fallback);
  - runtime view captured once at mounter construction (boot-time snapshot,
    post-init registrations never tracked) + explicit unavailable markers
    for loader-unobservable package fields;
  - seed-cache creation / hardlink materialization wired into quick-write
    and the disposable L2 environment (empty-seed tolerated);
  - client-half mechanical check auto-discovers staged client content in the
    real validate path (blocking code fix);
  - boot-init GC trigger from the facade with the runtime-view owner set;
    GC target resolves from the snapshot's recorded source profile (never
    the owner name) + tmp/ staging reclamation;
  - inspect/health outputs redacted before freeze (fail-closed);
  - auditability now authoritative from the append outcome (append failure
    degrades the flag in the result) + degradation test;
  - executor emits prepare/validate/commit stage progress; SIGTERM captured
    (ignored) inside the commit window so atomic swaps finish; recoverSwap
    heals hard-kill mid-swap on the next executor start + kill-mid-commit
    test;
  - facade-minted operation ids (never caller-supplied) + bounded executor
    timeout mapped to error+timeout reason; dispose() aborts all in-flight
    children (kill-and-cleanup);
  - governance token scrub (no requirement IDs in implementation/tests) +
    audit pattern extended with the PPM prefix; executor package test script
    uses the repository glob convention;
  - tests split to the task-named files (index-profile, profile-handle-
    semantics).
- **Second global-final-review fix round (2026-08-25)**: scoped package
  owners (`@scope/name`) now pass the executor storage containment check
  (nested owner scopes allowed; traversal/absolute/backslash segments still
  rejected) with a full-chain scoped-owner test; orphan GC no longer guesses
  the target profile from the owner name — runtime-source snapshots without a
  recorded target are kept while the owner is in the runtime view and only
  orphaned when the owner is absent everywhere (conservative); timeout →
  error+reason classification, dispose() kill-and-cleanup, and commit-window
  SIGTERM capture now have direct tests (signal-guard suite).
- **Final commit**: recorded in the delivery report after the global final
  review returned "无偏差"; worktree clean after the Stage 4 completion
  commit.