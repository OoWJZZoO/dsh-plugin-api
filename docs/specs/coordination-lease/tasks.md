# Stage 3 - Tasks

## Status

Stage 3 Tasks: 待执行。本清单承接已确认的 Goal / Requirements (CL-1..CL-10) 与 Design；经对抗性审查（返回“无偏差”）后直接进入 Stage 4，不设用户确认门。

## Execution Contract

- Execute the tasks in order. A task is complete only when its implementation
  and focused tests are green.
- Keep this feature host-only and facade-first. `pluginApi.coordination`
  provides bounded ownership (acquire/heartbeat/release/takeover/CAS/watch) for
  a logical resource and never becomes a worker scheduler, task queue,
  workflow engine, retry controller, route selector, checkpoint restorer,
  workspace transaction owner, or official package replacement.
- Consume only public host services (`storageDomain`, `storage`, `workspaces`,
  session/workspace scope metadata when available) through public reads. Never
  import private official modules and never infer backend durability or
  atomicity from a domain name alone.
- Every outcome is a discriminated typed result value, not an exception thrown
  through a plugin callback. Expected conflicts, stale handles, unavailable
  backends, and unsupported guarantees are stable `code` values. A disposed
  surface returns `inactive`. Input validation returns `invalid-input` before
  the backend is contacted.
- Every apply/mount/adapter/disposer/watch/redaction path is fail-safe: a
  failure only disables or degrades `coordination` with a bounded diagnostic
  and never escapes plugin apply or kills harness boot. Preserve the existing
  service lifetime, feature registry, typed disabled surfaces, version/
  assembly state, and all unrelated feature slots (execution, recovery,
  usage, routing, client faces).
- No new client transport, remote namespace, client mutation surface, events
  catalog slice, package, or version bump in this feature.
- Use the repository `npm test` scripts only (never bare `node --test`).
  Mark each completed task in this file before the final Stage 4 commit.

## Tasks

- [x] 1. Implement the dependency-free identity normalization and validation.
  - Add a pure `lib/coordination-normalize.js` module (zero harness
    dependencies) that normalizes resource identity (`scope` in
    session/workspace/profile/process, canonical bounded non-empty `key`,
    display-only `label`, bounded `provenance`), validates owner identity,
    lease duration (finite, positive, bounded; negative/zero/unbounded
    rejected), and validates `expectedProof` for takeover: exactly one member
    of `{ generation }`, `{ expiresAt }`, or a backend staleness proof;
    omitting or supplying more than one member returns `invalid-input` before
    the backend is contacted (CL-5.1).
  - Enforce that scope + canonical key are the identity and a display label is
    never used for lookup (CL-1.1, CL-1.2); reject invalid/omitted/mutated
    identity fields with a typed `invalid-input` result (CL-1.3); preserve
    sibling-supplied identities (execution/task/session/workspace) as bounded
    provenance and never mint a replacement execution or task identity
    (CL-1.4).
  - Add the availability projection builder (`available | unavailable |
    unsupported | unknown`; scope; durability `durable | session | workspace |
    memory | unknown`; per-operation capability map `{ acquire, heartbeat,
    release, takeover, compareAndSet, watch }`; backend `{ id, reason? }`;
    epoch) and a bounded clone/redact helper that drops secret keys and
    private value contents.
  - Add focused tests (`test/coordination-normalize.test.mjs`) for scope/key/
    owner validation, label collision treated as distinct resources, invalid
    identity fields, duration rejection, expectedProof exactly-one
    enforcement, provenance preservation, availability capability truth
    (durable vs memory vs unsupported vs unknown), redaction and deep freeze,
    and redaction-failure fail-closed. Cover CL-1, the projection portions of
    CL-8, and the normalization portions of CL-9.

- [x] 2. Implement the adapters (memory-scoped default + storage-domain bridge)
    with per-resource serialized lanes.
  - Add `lib/coordination-adapters.js` implementing the internal adapter
    contract from the design (`capabilities`, `read`, `acquire`, `heartbeat`,
    `release`, `takeover`, `compareAndSet`, `watch`, `dispose`), with:
    (a) the default `createMemoryCoordinationAdapter({ now, idFactory })`, and
    (b) `createStorageDomainCoordinationAdapter({ storageDomain, storage,
    workspaces, now, idFactory })`: a bridge that persists records and
    versions in a domain only when the host explicitly reports durable scope
    and atomic operation support; the bridge performs takeover/CAS as one
    atomic domain operation when the domain proves that capability, and
    returns explicit `unavailable`/`unknown` when the capability is not
    confirmed (CL-5.4, CL-6.5, CL-8.3). Never infer durability or atomicity
    from a domain name alone.
  - Maintain one serialized operation lane per canonical resource key. The
    lane is an in-process ordering mechanism only and is never presented as
    cross-process locking (CL-8.2).
  - Records carry `ownerId`, `generation` (strictly newer on every successful
    acquisition/takeover), unique per-generation `fencingToken`, `expiresAt`,
    `state` (active/expired/released/superseded/uncertain), backend identity
    and capability provenance. Acquire succeeds only when unowned or
    confirmed-expired; heartbeat extends expiry only for the exact active
    handle and never revives an expired/superseded lease; release is
    identity-bound and idempotent; takeover and CAS require the atomic proof
    within the lane and publish only on exact match. A successful takeover
    creates a new generation and fencing token, invalidates the previous
    handle, and preserves the caller-supplied `reason`/`provenance` as bounded
    takeover provenance on the new record — never minted, never dropped
    (CL-5.3).
  - The capability projection for these adapters must label the memory backend
    memory-scoped and non-durable, mark cross-process atomic takeover/CAS as
    `unsupported` (never emulated with an in-memory flag), and return explicit
    `unavailable`/`unknown` when a result cannot be confirmed (CL-3.3,
    CL-5.4, CL-6.5, CL-8.2). The storage-domain bridge labels durable/atomic
    only on host-confirmed evidence (CL-8.3).
  - Add focused tests (`test/coordination-adapters.test.mjs`) for generation
    monotonicity, unique fencing tokens, duration bounds, foreign conflict,
    expiry and heartbeat stale rejection, idempotent identity-bound disposer,
    takeover proof mismatch leaving the record unchanged, takeover provenance
    preservation (CL-5.3), CAS version conflict leaving the prior value
    unchanged with bounded observed provenance, watch transition immutability,
    and truthful memory capability claims. Add scripted public-service double
    tests for the storage-domain bridge: host-confirmed durable+atomic
    persistence and atomic takeover/CAS; host not reporting or reporting the
    capability unavailable yields explicit `unavailable`/`unsupported`/
    `unknown` without pretending durability; domain-name-only evidence never
    upgrades the capability projection. Cover CL-2..CL-6 and CL-8 adapter
    portions.

- [x] 3. Implement the host owner facade with typed outcomes and adapter
    selection.
  - Add `lib/coordination-lease.js` exporting `createCoordinationLease({ ctx,
    logger, now, idFactory })` returning `{ api, dispose, availability }`; the
    public API is a frozen object: `availability(scope?)`, `acquire({ resource,
    ownerId, leaseMs, provenance? })`, `heartbeat(handle, { leaseMs? })`,
    `release(handle)`, `takeover({ resource, ownerId, leaseMs, expectedProof,
    reason?, provenance? })`, `compareAndSet({ resource, handle,
    expectedVersion, value, visibility? })`, `watch(resource, { signal?,
    sinceGeneration?, audience? })`. The `availability` property on the mount
    result is the mount-time snapshot, distinct from live
    `api.availability(scope?)`.
  - Implement the documented result vocabulary (`invalid-input`, `conflict`,
    `stale-holder`, `expired`, `released`, `superseded`, `compare-conflict`,
    `unsupported`, `unavailable`, `unknown`, `inactive`) as frozen typed
    values that always carry resource identity, operation, availability, and
    bounded observed generation/version where safe; expected outcomes are
    never thrown. A disposed surface returns `inactive` without contacting the
    backend.
  - Enforce the invariants: acquire never replaces an unexpired foreign lease
    (CL-2.2); heartbeat never revives an expired lease (CL-3.2, CL-3.4);
    release is identity-bound and idempotent with the typed `released` no-op
    (CL-4); takeover requires exactly one `expectedProof` and exactly one
    atomic backend operation (CL-5); CAS requires the active fencing token,
    the handle's expected generation, and the expected version all matching
    the current record (CL-6.1); stale/foreign/missing/malformed tokens are
    rejected before any state change is published (CL-6.2).
  - Adapter selection: at mount, resolve the optional public services
    (`storageDomain`, `storage`, `workspaces`, scope metadata) through public
    reads and probe their capability. Use the storage-domain bridge adapter
    (implemented in Task 2) only when the host explicitly reports durable
    scope and atomic operation support; otherwise fall back to the memory
    adapter labeled memory-scoped and non-durable. Never infer durability or
    atomicity from a domain name (CL-8.3).
  - Add focused tests (`test/coordination-lease.test.mjs`) for the full
    outcome matrix (conflict/stale/expired/released/superseded/compare-conflict/
    unsupported/unavailable/unknown/inactive), uncertain-backend behavior
    (CL-3.3: never upgraded to claimed ownership), disposed-surface behavior,
    adapter selection with scripted public-service doubles (durable+atomic
    confirmed vs absent), backend failure containment (CL-8.4), and mount-time
    availability snapshot. Cover CL-2..CL-6 and CL-8.

- [x] 4. Implement the watch surface with epoch, resync truthfulness, and
    observer containment.
  - The watch subscription object, epoch guarding, and observer containment
    are implemented in `lib/coordination-lease.js` (the owner module that also
    exports `createCoordinationLease`), keeping the `watch(resource, { signal?,
    sinceGeneration?, audience? })` signature consistent with Task 3.
  - `watch()` returns a frozen subscription object with `current()`,
    `subscribe(fn)`, and idempotent `dispose()`; subscriptions are delivered
    deep-frozen immutable transitions carrying `previous`, `current`,
    `generation`, `version`, `expiresAt`, `fencingValid` (boolean only; the
    fencing token value never leaves the host), `reason`, `observedAt`,
    `epoch`, and bounded backend provenance, subject to the caller's scope
    (CL-7.1).
  - Disposing a watch stops delivery for that subscription only and never
    disposes another owner's or another subscription's observer (CL-7.2).
    Reconnect, missed events, or uncertain backend state are reported as
    explicit resync/unavailable information; silence is never inferred as a
    healthy active lease (CL-7.3). `sinceGeneration` filters delivered
    transitions to generations at or after the value; when the backend cannot
    resync from that generation the watch reports an explicit
    resync/unavailable state instead of skipping silently.
  - Observer callbacks that throw or return rejected thenables are contained
    per subscription; the coordination service and harness boot stay alive
    (CL-7.4). Stale callbacks from a disposed or replaced subscription cannot
    publish into a newer subscription's generation.
  - Add focused tests (`test/coordination-watch.test.mjs`) for transition
    immutability and metadata, disposal isolation, resync/unavailable
    reporting (never silence-as-healthy), `sinceGeneration` filtering with
    unavailable resync, throwing/rejected observer containment, and
    stale-callback epoch guarding. Cover CL-7.

- [x] 5. Implement visibility, redaction, scope denial, and boundary
    truthfulness (host and client).
  - All values crossing the public boundary are bounded, deeply frozen, and
    redacted: credentials, secret tokens not intended for observation, and
    private value contents never appear in projections (CL-9.1). A lookup
    outside the caller's declared scope returns the same unavailable shape as
    a missing resource and never reveals whether a private resource exists
    (CL-9.2). Redaction or freezing failure fails closed for that projection
    and never returns a partially protected object (CL-9.3).
  - Add no client transport, remote namespace, or client mutation surface. The
    implementation carrier for the CL-10.2 typed contract is an explicit
    absence: this feature adds zero client code, zero client manifest/remote/
    slot/settings entries, and no acquire/heartbeat/release/takeover/CAS entry
    point reachable from client code; the typed
    `{ code: 'unsupported', kind: 'client-mutation', availability }` result is
    the documented boundary contract that governs any mutation attempt
    reaching this feature's client boundary (asserted by absence in tests —
    no local emulation is ever provided) (CL-10.2). When no compatible host
    projection exists the client remains inert/degraded and unrelated client
    faces keep loading (CL-10.3).
  - Add focused tests (`test/coordination-visibility.test.mjs`) for redaction
    of credentials/tokens/private contents, deep freeze, scope denial without
    existence leakage, redaction-failure fail-closed, absence of any client
    mutation surface or client manifest/remote entry, and inert client
    degradation. Cover CL-9 and CL-10.

- [x] 6. Mount the host facade with fail-safe lifecycle and typed disabled
    behavior.
  - Add the `coordination` feature guard branch in `lib/guards.js` (public
    substrate probes; optional service resolution degrades per source and
    never disables unrelated features), a `mountCoordinationFeature` mounter
    in `lib/index.js` registered in `FEATURE_MOUNTERS` after `recovery`
    (batch order), and the full service wiring in `lib/plugin-api-service.js`:
    `coordination` in `KNOWN_FEATURES`, a frozen live surface slot wiring
    `availability/acquire/heartbeat/release/takeover/compareAndSet/watch`,
    `createDisabledCoordinationApi` with the standard typed inactive/disabled
    errors, and matching `_readSlot`/`_disabledSurfaceFor`/`unmountFeature`
    handling with stale-owner cleanup. Use `service.prepareFeature` with the
    same idempotent mount transaction as other B-class features.
  - The mounter constructs the owner, probes the adapter, and prepares the
    surface; missing optional primitives disable only `coordination` with a
    bounded diagnostic; a core guard failure leaves the existing inert
    `pluginApi` service intact; `apply()` catches all setup errors and returns
    normally (CL-8.4).
  - Add focused tests (`test/coordination-guard.test.mjs` and
    `test/index-coordination.test.mjs`) for active/inert/guard-failure states,
    repeated apply/unapply, owner-replacement stale-call rejection, typed
    unavailable behavior, fail-safe logger/diagnostic failures, malformed
    backend handling, and isolation from execution/recovery/usage/routing and
    client surfaces. Cover the mounting portions of CL-8 and CL-10.

- [x] 7. Complete cross-feature integration, governance, and repository
    acceptance evidence.
  - Add integration evidence (local fixtures with scripted public-service
    doubles — no test may assert cross-process durability from a memory
    adapter): capability probe of public `storageDomain`/`storage`/`workspaces`
    surfaces where available, no claim when unavailable; sibling identity
    provenance (execution/task/session/workspace) preserved and never minted
    (CL-1.4); the public `pluginApi.coordination` face consumable by the
    same-batch sibling features (`workspace-mutation-transaction`,
    `task-execution-observation`) without the facade owning their state.
  - Add negative tests for scheduler/task-queue/retry-controller absence,
    cross-process lock claims, durable-CAS claims from the memory adapter,
    client mutation authority, R replacement, and official package
    modification.
  - Update only this feature's entry and evidence in
    `docs/specs/plugin-api-features/feature-list.md` (append the §7 delivery
    row and mark the feature delivered), and update the status for
    `coordination-lease` in
    `docs/specs/plugin-api-features/dsh-plugin-api-heuristic-feature-proposals-2026-08-20.md`:
    the feature status table row (line ~22) becomes Stage 4 delivered, and the
    intro narrative sentence that describes the third-batch trio as "已完成
    Stage 2 Design 确认，待 Stage 3" is revised in place so that only the
    `coordination-lease` statement reflects delivery while the other two
    features (workspace-mutation-transaction, task-execution-observation)
    keep their current stage wording; keep proposal #2's original channel
    analysis and retirement condition text intact.
  - Mark all tasks complete, then run focused coordination tests, the full
    `npm test`, `git diff --check`, governance/range checks, syntax/package
    checks, and an installed official DSH package zero-modification check
    before the Stage 4 commit.

## Stage 4 Implementation Record

Completed 2026-08-25 after all implementation tasks and repository acceptance
checks passed.

- **Final host surface**: `pluginApi.coordination` with frozen methods
  `availability(scope?)`, `acquire`, `heartbeat`, `release`, `takeover`,
  `compareAndSet`, `watch` (all async, discriminated typed results); runtime
  feature key `coordination` (guard branch in `lib/guards.js`,
  FEATURE_MOUNTERS entry after `recovery`, service slot + disabled surface in
  `lib/plugin-api-service.js`). No client transport/remote/mutation surface.
- **Implementation files**: `lib/coordination-normalize.js` (pure
  normalization/validation/availability/redaction, zero harness deps),
  `lib/coordination-adapters.js` (memory-scoped default + storage-domain
  bridge with explicit capability gating), `lib/coordination-lease.js` (host
  owner with adapter selection, typed outcome vocabulary, watch epoch/resync/
  containment).
- **Focused tests**: `test/coordination-normalize.test.mjs` (14),
  `test/coordination-adapters.test.mjs` (19), `test/coordination-lease.test.mjs`
  (11), `test/coordination-watch.test.mjs` (10), `test/coordination-visibility.test.mjs`
  (6), `test/coordination-guard.test.mjs` (3), `test/index-coordination.test.mjs`
  (6), `test/coordination-integration.test.mjs` (5) — 74/74 green in isolation.
- **Shared assertions**: pre-existing feature-list/order assertions across
  `test/index.test.mjs`, `test/index-agent.test.mjs`, `test/index-events.test.mjs`,
  `test/index-remote.test.mjs`, `test/index-session.test.mjs`,
  `test/index-session-durable.test.mjs`, `test/index-system-prompt.test.mjs`,
  `test/index-tools.test.mjs`, `test/official-passthrough-independence.test.mjs`
  updated to include the `coordination` feature.
- **Full suite**: `npm test` = 1634/1634 pass (memory-guarded).
- **Governance evidence**: `git diff --check` clean; governance-token audit
  clean (no governance labels/tokens in implementation files or tests —
  runtime naming is neutral); no private official imports and no official
  package paths in the diff (verified by
  `test/coordination-integration.test.mjs`); official DSH package untouched.
- **Registration**: `docs/specs/plugin-api-features/feature-list.md` §7 row
  appended (delivered); status rows and intro narrative updated in
  `docs/specs/plugin-api-features/dsh-plugin-api-heuristic-feature-proposals-2026-08-20.md`
  for `coordination-lease` only; proposal #2's channel analysis preserved.
- **Version**: no bump (stays `0.1.0-rc.6-0.5` / `dsh.api 0.5`; integration
  owner aligns).
- **Final commit**: recorded in the delivery report after global final review
  returned "无偏差". Worktree clean after the Stage 4 completion commit.