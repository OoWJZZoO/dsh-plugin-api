# Stage 3 - Tasks

## Status

Stage 3 Tasks 已通过阻塞式对抗性审查（三轮：第一轮 2 blocking / 5 advisory，第二轮
1 blocking / 1 advisory，第三轮“无偏差”，全部意见已就地修订）。本清单承接已确认的
Goal / Requirements（WMT-1..WMT-10）与 Design；按 SPEC3 规则直接进入 Stage 4，
不设用户确认门。

## Execution Contract

- Execute the tasks in order. A task is complete only when its implementation
  and focused tests are green.
- Keep this feature host-only and facade-first.
  `pluginApi.workspaceTransactions` provides an explicit transaction boundary
  (prepare / record / preview / commit / rollback / recover / get / observe)
  for workspace changes and never becomes a distributed transaction manager,
  automatic retry controller, route selector, task scheduler, lease/CAS owner,
  recovery policy owner, session branch owner, or official package replacement.
- Consume only public host surfaces through public reads and documented events:
  `pluginApi.coordination` (lease/fencing), `pluginApi.recovery` (decision and
  capability vocabulary, read-only), `fs/write-intent` + `fs/edit-intent`
  (sidecar waterfall observers that call `next()` and pass its result through),
  `tools/pre-execute` (source tool/approval provenance observation), and the
  optional public services (`storageDomain`, `storage`, workspaces/checkpoint/
  file-claim/Git/approval seams) via capability adapters. Never import private
  official modules; never infer durability or atomicity from a domain name or
  service presence alone.
- Every expected outcome is a discriminated typed result value, not an
  exception thrown through a plugin callback. Expected conflicts, stale
  fencing, unavailable capabilities, and unsupported guarantees are stable
  `code` values. A disposed surface returns `inactive`. Input validation
  happens before any adapter or backend contact.
- Every apply/mount/adapter/listener/disposer/observer/redaction path is
  fail-safe: a failure only disables or degrades this feature with a bounded
  diagnostic and never escapes plugin apply or kills harness boot. Preserve
  the existing service lifetime, feature registry, typed disabled surfaces,
  version/assembly state, and all unrelated feature slots.
- Terminal states are immutable. `committed`, `rolled-back`, `failed`,
  `superseded`, and the terminal observation state `unknown` reject later
  transitions that would rewrite them while retaining bounded late-event
  provenance. `superseded` only results from an explicit fenced replacement,
  never from a timeout.
- No new client transport, remote namespace, client mutation surface, events
  catalog slice, package, or version bump in this feature.
- Use the repository `npm test` scripts only (never bare `node --test`).
  Mark each completed task in this file before the final Stage 4 commit.

## Tasks

- [ ] 1. Implement the dependency-free normalization, state machine, and
    validation module.
  - Add a pure `lib/workspace-transaction-normalize.js` module (zero harness
    dependencies) that normalizes and validates transaction identity:
    unique bounded `transactionId`, exactly one declared workspace scope
    (`session` | `workspace` | `profile` | `process`) with canonical bounded
    non-empty `key` and display-only `label`, owner identity, non-empty
    resource set, and intent `{ kind, summary }`; invalid or omitted fields
    yield a typed `invalid-input` result before any adapter is contacted
    (WMT-1.1). Scope + canonical key is the resource identity; a display label
    is never used for lookup. Sibling-supplied identities (execution, task,
    session, lease, checkpoint) referenced by a transaction are preserved as
    bounded provenance and never replaced by an event sequence or minted
    execution/task identity (WMT-1.2).
  - Define the frozen state vocabulary (`prepared | committing | committed |
    rolling-back | rolled-back | recovering | failed | unknown | superseded`),
    the legal-transition table from the design (including
    `rolling-back -> recovering` continuation, `rolling-back -> failed`, and
    explicit-fenced-only `superseded`), and a `canTransition(from, to)` helper
    that treats terminal states as immutable with exactly one encoded
    exception: `unknown` may be reclassified only by a new explicit
    `recover()` with sufficient durable evidence (the table also carries the
    design's `recovering -> unknown` observation edge) (WMT-7.2).
  - Normalize mutation records: resource `{ kind, key, scope }`, operation,
    before/after evidence where each side is either `{ digest?, version?,
    evidence? }` or an explicit `absent: true` marker (a missing field is
    never accepted as absent state, per the design's data-model rule),
    source `{ toolId?, executionId?, sessionId?, eventSeq? }`,
    side-effect classification fixed to
    `none | read-only | rollbackable | external | unknown`, capability
    `{ owner, name, version?, status }`, idempotent flag, order, and
    observed time (WMT-3.1). Unverifiable digests normalize to
    `unknown`/`unavailable` evidence rather than exact reversible claims
    (WMT-3.5).
  - Add the availability projection builder
    (`available | unavailable | unsupported | unknown`; scope; durability
    `durable | memory | unknown`; per-operation capability map
    `{ prepare, record, preview, commit, rollback, recover, get, observe }`;
    backend `{ id, reason? }`; epoch) shared with the coordination projection
    shape — the durability vocabulary here is a deliberate truth-subset:
    when the host reports a session- or workspace-tier durable domain, the
    projection merges it to `durable` and the tier is carried by the `scope`
    field — plus bounded clone/redact helpers that drop secret keys, raw file
    contents, credentials, prompts, and unbounded tool output while keeping
    bounded change evidence.
  - Add focused tests (`test/workspace-transaction-normalize.test.mjs`) for
    scope/key/owner/intent/resource-set validation, label-vs-key identity,
    sibling identity preservation, absent-marker enforcement, side-effect
    classification bounds, transition-table legality including terminal
    protection and fenced-only `superseded`, availability capability truth,
    redaction, deep freeze, and redaction-failure fail-closed behavior. Cover
    the normalization/validation portions of WMT-1, WMT-3, WMT-7, and WMT-9.

- [ ] 2. Implement the capability adapters and the transaction registry with
    serialized lanes.
  - Add `lib/workspace-transaction-adapters.js` implementing the internal
    adapter boundary from the design: `registry` (`read`, `writeCas`, plus an
    internal `queryEvents(transactionId)` primitive that backs the bounded
    late-event provenance retention of the state machine — a non-public
    support surface, not extra API), a `workspace` adapter
    (`capabilities(scope)` over the public workspace seam whose evidence
    feeds prepare's incompatible-authority rejection and preview's
    precondition/stale detection), plus small capability adapters for file
    claim (`claim/release` against the applicable public seam), checkpoint
    (`describe/create/restore`), Git/workspace restore
    (`preview/apply/restore`), ledger (`append/query(transactionId)`),
    approval (`confirm`), and — only when a public session-branch capability
    exists on the host — a conditional `sessionBranch`
    (`preview/apply/restore(boundary)`) adapter following the same degradation
    rules as checkpoint and file claim (explicit `unavailable`/
    `unsupported` when no public capability is present; never a local
    simulation). Each adapter returns capability provenance and a
    bounded evidence reference, and refuses an operation when it cannot prove
    the requested guarantee; no adapter may report an external effect as
    rollbackable merely because a local command completed (WMT-2.2, WMT-6.1,
    WMT-6.2). A missing optional official seam yields an explicit
    `unavailable`/`unsupported` capability status for that adapter only and
    degrades nothing else.
  - Implement the registry as (a) a default memory-scoped registry explicitly
    labeled non-durable, and (b) a storage-domain bridge used only when the
    host explicitly reports a usable durable scope and conditional write
    primitive on the public storage service (same evidence standard as the
    coordination bridge; never inferred from the domain name). The bridge
    performs record writes as one atomic compare-and-swap when that
    capability is confirmed and returns explicit `unavailable`/`unknown`
    otherwise (WMT-6.3 durability boundary).
  - Maintain one serialized operation lane per transaction identity and one
    per resource claim key. The lane is an in-process ordering mechanism only
    and is never presented as cross-process locking; stale writers are
    rejected by the coordination fencing token, not by lane position.
  - Add the fs/tool evidence intake helpers used by the mounter: sidecar
    listeners for `fs/write-intent` and `fs/edit-intent` that call `next()`,
    return its result unchanged, and record bounded before/after observation
    evidence; and a `tools/pre-execute` observer that records source tool /
    execution provenance. A missing optional hook disables only the
    corresponding evidence field and never pretends a mutation was observed.
  - Add focused tests (`test/workspace-transaction-adapters.test.mjs`) with
    scripted public-service doubles: capability refusal truthfulness, memory
    registry labeled non-durable, storage-domain bridge persistence and CAS
    atomicity under confirmed evidence, explicit
    `unavailable`/`unsupported`/`unknown` without confirmed capability,
    domain-name-only evidence never upgrading the projection, the `workspace`
    adapter's per-scope capability evidence driving an authority rejection
    under a scripted double, conditional
    sessionBranch adapter enabled only by a confirmed public capability and
    degrading explicitly otherwise, lane serialization, listener passthrough
    fidelity (`next()` result preserved), `tools/pre-execute` source tool /
    execution provenance recorded on the mutation evidence, missing-hook
    degradation, and idempotent disposer ownership. Cover the adapter
    portions of WMT-2, WMT-3, WMT-5, and WMT-6.

- [ ] 3. Implement the host owner facade core: typed outcomes, adapter
    selection, `prepare`, and `record`.
  - Add `lib/workspace-mutation-transaction.js` exporting
    `createWorkspaceMutationTransaction({ ctx, coordination, recovery, logger,
    now, idFactory })` — the design-frozen dependency set including the
    read-only `pluginApi.recovery` decision/capability vocabulary source
    (`idFactory` stays an injectable test knob, matching the coordination
    owner precedent) — returning `{ api, dispose, availability }`; the public
    API is a frozen object: `prepare({ transactionId, workspace, ownerId,
    intent, resources, lease, checkpoint?, approval?, provenance? })`,
    `record(transactionId, { resource, operation, before, after, capability,
    source, sideEffectClass, idempotent? })`, `preview(transactionId,
    { audience?, includeExternal? })`, `commit(transactionId,
    { confirmation?, expectedRevision? })`, `rollback(transactionId,
    { confirmation?, takeover? })`, `recover(transactionId,
    { takeover?, audience? })`, `get(transactionId, { audience? })`, and
    `observe(transactionId, { signal?, audience? })`. The `availability`
    property on the mount result is the mount-time snapshot, distinct from
    live projections returned by operations. The runtime feature key is the
    neutral `workspaceTransactions`; governance naming stays in spec docs.
  - Implement the discriminated outcome vocabulary as frozen typed values
    carrying stable codes (`invalid-input`, `conflict`, `stale-fencing`,
    `unsupported`, `unavailable`, `unknown`, `inactive`, and success shapes
    per operation), always carrying transaction identity, operation, current
    state, revision, and availability; expected outcomes are never thrown. A
    disposed surface returns `inactive` without contacting adapters.
  - Adapter selection at mount resolves the optional public services through
    public reads, probes their capability, selects the storage-domain registry
    bridge only on explicit durable+conditional-write evidence, and otherwise
    falls back to the memory registry labeled memory-scoped and non-durable;
    durable-requiring operations then return explicit `unsupported`/
    `unavailable` instead of pretending durability (design §Architecture).
  - `prepare` validates identity, single workspace scope, non-empty resource
    set, intent, and owner first; acquires or validates the applicable
    coordination lease handle and binds its generation/fencing provenance
    before accepting any mutation record (WMT-2.1); rejects resources governed
    by incompatible workspace/profile/session authorities outright before any
    mutation is published (WMT-1.3); fails closed on a reused transaction
    identity with conflicting owner, scope, or intent without merging records
    (WMT-1.4); and returns an explicit `unsupported`/`unavailable` result when
    a declared-required capability (e.g. checkpoint, file claim) is
    unavailable so no commit-ready transaction appears (WMT-2.2). On
    preparation failure after allocating temporary evidence, release only its
    own temporary resources and leave no partially active transaction visible
    (WMT-2.4). Success exposes immutable owner, generation, lease/fencing
    provenance, capability evidence, and initial state `prepared` (WMT-2.3).
  - `record` requires the active transaction identity plus fencing evidence
    and records resource identity, before digest, after digest or explicit
    absent state, source tool/execution, and side-effect classification
    (WMT-3.1); equivalent repeated operation identities return an idempotent
    result without duplicating the ledger entry (WMT-3.2); conflicting
    repeated identities are rejected without overwriting original provenance
    (WMT-3.3); mutations arriving after a terminal state are rejected as
    stale with the terminal record preserved (WMT-3.4); resources outside the
    declared resource set or workspace scope are rejected; unverifiable
    digests mark evidence `unknown`/`unavailable` and never claim an exact
    reversible mutation (WMT-3.5).
  - Add focused tests (`test/workspace-transaction-lifecycle.test.mjs`) for
    the full prepare/record matrix above, including lease-binding failure,
    checkpoint binding recorded on a prepared transaction, incompatible-
    authority rejection, duplicate-identity conflict, cleanup
    after failed preparation, fencing rejection, idempotent replay,
    conflicting replay, post-terminal staleness, out-of-scope resource
    denial, and unverifiable-digest downgrades. Cover WMT-1, WMT-2, and
    WMT-3.

- [ ] 4. Implement the settlement paths — preview, commit, rollback, recover —
    and the ordered immutable state-machine projection.
  - `preview` returns a frozen projection of resource changes, before/after
    evidence, source provenance, required approvals, rollback boundary, and
    current transaction state for prepared or recovering transactions
    (WMT-4.1); effects classified `external`/`unknown` are labeled explicitly
    as not covered by automatic rollback (WMT-4.2); when current resource
    state no longer matches the recorded precondition, preview reports
    stale/conflict evidence and never silently refreshes the transaction into
    a different change (WMT-4.3).
  - `commit` validates active ownership, the lease generation/fencing token,
    declared approvals, all mutation preconditions, and capability evidence
    before publishing `committed` (WMT-5.1); any failed precondition leaves
    the transaction non-committed, identifies the failed boundary, and never
    publishes partial committed state (WMT-5.2); an explicitly external side
    effect commits only with the declared approval/confirmation recorded in
    `approvals`, with the result stating the effect is not covered by
    automatic rollback (WMT-5.3); the success result carries final state,
    bounded mutation summary, provenance references, and the lease generation
    used (WMT-5.4); retrying commit with the same transaction identity and
    equivalent terminal evidence returns the existing terminal result without
    duplicating effects (WMT-5.5). A partial adapter success leaves the
    transaction `failed` or `recovering`, never `committed`.
  - `rollback` restores only adapter-confirmed rollbackable resources
    (WMT-6.1); preserves `external`/`unknown` classification and never claims
    an undone external effect unless the relevant adapter confirms it
    (WMT-6.2); publishes `rolled-back` only after every confirmed rollbackable
    resource is restored — a partial restore leaves `failed` or `recovering`
    (design §State machine); repeated calls with equivalent identity are
    idempotent for settled resources and never reverse a newer transaction
    (WMT-6.4); a stale owner or fencing token is rejected unless an explicit,
    fenced takeover recovery path is requested (WMT-6.5).
  - `recover` reconstructs state only from durable evidence after disconnect,
    restart, or interrupted commit, returning explicit `unavailable`/
    `unsupported` when evidence is insufficient (WMT-6.3); it reports what was
    found, which resources are settled, and which actions remain unavailable;
    it never invokes retry, fallback, fork, route choice, or approval bypass
    itself and preserves the public state/capability/idempotency/external-side-effect
    provenance for recovery-policy consumers (WMT-8.1–WMT-8.3).
  - Every accepted transition publishes an ordered, immutable event with
    transaction identity, previous state, next state, reason, revision,
    observer epoch, lease generation, and evidence references (WMT-7.1);
    later transitions cannot rewrite a terminal outcome, while bounded late
    provenance is retained (WMT-7.2); `superseded` arises only from an
    explicit fenced replacement, never inferred from a timeout (design);
    `unknown` is a terminal observation state upgradeable only by a new
    explicit `recover()` with sufficient durable evidence (design).
  - Add focused tests (`test/workspace-transaction-settlement.test.mjs`) for
    the full settlement matrix, including external-approval gating, partial
    restore truthfulness (`failed`/`recovering`, never `rolled-back`),
    precondition/CAS conflicts leaving non-committed state, terminal retry
    idempotency, stale-owner takeover requirements, durable-evidence
    reconstruction with insufficient-evidence `unavailable`, transition
    ordering/immutability, late-provenance retention, and a backend double
    that completes a local write but reports no atomic/durable guarantee so
    the facade returns `unsupported`/`unknown` instead of claiming success.
    Cover WMT-5, WMT-6, WMT-7, and WMT-8.

- [ ] 5. Implement observation, visibility, redaction, scope denial, and the
    client boundary.
  - `observe(transactionId)` returns a frozen subscription object with
    `current()` and `subscribe(fn)` plus an idempotent `dispose()`; delivered
    transitions are deep-frozen and carry the WMT-7 metadata; each subscriber
    has an epoch so callbacks from a disposed or replaced subscription can
    never publish into a newer generation; one observer throwing or returning
    a rejected thenable is contained without affecting others or the host
    (WMT-7.3, the same observer containment as the delivered
    `execution-observation` facade). When the registry is unavailable,
    `get`/`observe` return an explicit unavailable projection rather than
    inferring state from silence (WMT-7.4).
  - All projections crossing the public boundary are bounded, deeply frozen,
    and redacted: credentials, secret values, raw private content, prompts,
    and unbounded diagnostic detail never appear while bounded change evidence
    is preserved (WMT-9.1); lookups outside the caller's declared workspace
    scope return the same unavailable shape as a missing transaction and never
    reveal whether a private transaction exists (WMT-9.2); redaction,
    freezing, or bounded serialization failure fails closed for that
    projection and never returns a partially protected record (WMT-9.3,
    WMT-4.4).
  - Enforce the client boundary by explicit absence: zero client code, zero
    client manifest/remote/slot/settings entries, and no prepare/record/
    commit/rollback/recover entry point reachable from client code; the
    documented contract for any mutation attempt reaching this feature's
    client boundary is the typed unsupported/unavailable result asserted by
    absence in tests — no client-side emulation exists (WMT-10.2). Client
    consumers render read-only redacted host-published projections through
    existing supported channels with explicit availability and transaction
    generation (WMT-10.1); when the host projection or channel is unavailable
    the client stays inert/degraded and unrelated client faces keep loading
    (WMT-10.3).
  - Add focused tests (`test/workspace-transaction-visibility.test.mjs`) for
    redaction coverage (secrets, nested objects, log summaries), deep freeze,
    scope denial without existence leakage, fail-closed redaction, observer
    epoch guarding and isolation, unavailable-registry projections, and the
    absence of every client mutation surface. Cover WMT-4 visibility portions,
    WMT-9, and WMT-10.

- [ ] 6. Mount the host facade with fail-safe lifecycle and typed disabled
    behavior.
  - Add the `workspaceTransactions` feature guard branch in `lib/guards.js`
    (public substrate probes; optional service resolution degrades per source
    and never disables unrelated features), a `mountWorkspaceTransactionsFeature`
    mounter in `lib/index.js` registered in `FEATURE_MOUNTERS` after
    `coordination` (batch order), and the full service wiring in
    `lib/plugin-api-service.js`: `workspaceTransactions` in `KNOWN_FEATURES`,
    a frozen live surface slot wiring
    `prepare/record/preview/commit/rollback/recover/get/observe`,
    `createDisabledWorkspaceTransactionsApi` with the standard typed inactive/
    disabled errors, and matching `_readSlot`/`_disabledSurfaceFor`/
    `unmountFeature` handling. Use `service.prepareFeature` with the same
    idempotent mount transaction as other B-class features.
  - The mounter constructs the owner, binds the `coordination` handle source
    and the read-only `recovery` vocabulary source,
    installs the fs/tool evidence listeners, and prepares the surface; missing
    optional primitives disable only `workspaceTransactions` with a bounded
    diagnostic; a core guard failure leaves the existing inert `pluginApi`
    service intact; `apply()` catches all setup errors and returns normally.
  - Update the shared feature-order assertions that shift when the new feature
    mounts (the pre-existing integration-owned deltas across
    `test/index.test.mjs`, `test/index-agent.test.mjs`,
    `test/index-events.test.mjs`, `test/index-remote.test.mjs`,
    `test/index-session.test.mjs`, `test/index-session-durable.test.mjs`,
    `test/index-system-prompt.test.mjs`, `test/index-tools.test.mjs`, and
    `test/official-passthrough-independence.test.mjs`).
  - Add focused tests (`test/workspace-transaction-guard.test.mjs` and
    `test/index-workspace-transactions.test.mjs`) for active/inert/guard-
    failure states, repeated apply/unapply, owner-replacement stale-call
    rejection, typed unavailable/disabled behavior, fail-safe logger failures,
    malformed backend handling, and isolation from coordination/recovery/
    usage/routing and client surfaces.

- [ ] 7. Complete cross-feature integration, governance, and repository
    acceptance evidence.
  - Add integration evidence (`test/workspace-transaction-integration.test.mjs`,
    local fixtures with scripted public-service doubles — no test may assert
    cross-process durability from a memory registry): end-to-end
    prepare → record → preview → commit and rollback flows over a confirmed
    capability set; capability-gated degradation when checkpoint/file-claim/
    session-branch
    seams are absent; coordination lease binding consumed from the same-batch
    first feature without owning its state; recovery decision vocabulary
    exposed as read-only provenance; sibling identity provenance preserved and
    never minted; negative tests asserting no scheduler/poller creation, no
    automatic external rollback claims, no R replacement, and no official
    package modification.
  - Update only this feature's entries in registration documents: append the
    §7 delivery row for `workspace-mutation-transaction` in
    `docs/specs/plugin-api-features/feature-list.md` and update the feature
    status row plus intro narrative sentence in
    `docs/specs/plugin-api-features/dsh-plugin-api-heuristic-feature-proposals-2026-08-20.md`
    so only this feature reflects delivery while `task-execution-observation`
    keeps its stage wording; refresh the three spec artifacts' status lines.
  - Mark all tasks complete, then run the focused workspace-transaction tests,
    the full `npm test`, `git diff --check`, the governance-token audit,
    syntax/package checks, and an installed official DSH package
    zero-modification check before the Stage 4 commit.
