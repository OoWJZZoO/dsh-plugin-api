# Stage 3 - Tasks

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.execution` | `pluginApi.executions` |
> | `pluginApi.recovery` | `pluginApi.executions.recovery` |
> | `pluginApi.workspaceTransactions` | `pluginApi.workspaces.transactions` |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

## Status

Stage 3 Tasks 已通过阻塞式对抗性审查（两轮：第一轮无 blocking / 3 advisory，已就地修订；第二轮“无偏差”）。
本清单承接已确认的 Goal / Requirements（TEO-1..TEO-10）与 Design；按 SPEC3 规则
直接进入 Stage 4，不设用户确认门。全部任务已实现并标记完成（Stage 4 交付完成，M6 第三批次）。

## Execution Contract

- Execute the tasks in order. A task is complete only when its implementation
  and focused tests are green.
- Keep this feature host-only, facade-first, and observation-only.
  `pluginApi.tasks` preserves a business task identity while linking each run
  and attempt to the actual workflow, agent, execution, session, job, and
  workspace transaction evidence. It never becomes a worker scheduler,
  workflow engine, provider executor, retry loop, route selector, transcript
  store, lease implementation, billing ledger, workspace transaction owner,
  approval bypass, or official package replacement.
- The host is the only task mutation authority; the client consumes only
  frozen, redacted projections through existing supported channels. A
  mutation attempt through this feature's client surface is answered by an
  explicit typed `unsupported`/`unavailable` result asserted by absence — no
  client-side emulation exists.
- Consume only public surfaces through public reads and documented events:
  `pluginApi.execution` (observe/get/history/onChange), `pluginApi.recovery`
  (classify/evaluate/availability, read-only), `pluginApi.coordination`
  (acquire/heartbeat/release/takeover/compareAndSet/availability),
  `pluginApi.diagnostics` (get/onChange when the public projection is
  present), `pluginApi.workspaceTransactions` (get/observe when the
  same-batch feature is present), the public `jobs` service and its change
  notification, the documented `workflow/*` and `subagent/*` catalog events,
  and the public session read/observation surface. Never import private
  official modules; never infer durability or atomicity from a domain name or
  service presence alone. A missing optional seam disables only the
  corresponding source link with an explicit `unavailable`/`unknown`
  availability and degrades nothing else; the task layer never mints a
  replacement execution or task identity.
- Every expected outcome is a discriminated typed result value, not an
  exception thrown through a plugin callback. Expected conflicts, stale
  fencing, unavailable sources, and unsupported guarantees are stable `code`
  values. A disposed surface returns `inactive`. Input validation happens
  before any adapter or source contact.
- Every apply/mount/adapter/listener/disposer/observer/redaction path is
  fail-safe: a failure only disables or degrades this feature with a bounded
  diagnostic and never escapes plugin apply or kills harness boot. Preserve
  the existing service lifetime, feature registry, typed disabled surfaces,
  version/assembly state, and all unrelated feature slots.
- Terminal states are immutable. `settled`, `failed`, and `unknown` reject
  later transitions that would rewrite them while retaining bounded late-event
  provenance; a stale or duplicate callback can never settle a newer attempt,
  and a prior attempt can become `superseded` while the task record stays
  intact.
- No new client transport, remote namespace, client mutation surface, events
  catalog slice, package, or version bump in this feature.
- Use the repository `npm test` scripts only (never bare `node --test`).
  Mark each completed task in this file before the final Stage 4 commit.

## Tasks

- [x] 1. Implement the dependency-free normalization, state machine, and
    validation module.
  - Add a pure `lib/task-execution-normalize.js` module (zero harness
    dependencies) that normalizes and validates task identity: unique bounded
    `taskId`, exactly one task scope (`session` | `workspace` | `profile` |
    `process`) with canonical bounded non-empty `key`, owner identity, intent
    `{ kind, summary }`, and bounded creation provenance; invalid or omitted
    fields yield a typed `invalid-input` result before any source is contacted
    (TEO-1.1). Registration is idempotent only for equivalent immutable
    metadata; conflicting owner/scope/intent metadata yields `identity-conflict`
    without merging records (TEO-1.3, TEO-1.4).
  - Define the frozen task state vocabulary (`registered | active |
    reassigning | settling | settled | failed | unknown`) and attempt state
    vocabulary (`registered | active | settling | settled | superseded |
    unknown`), the legal-transition table from the design (including
    `registered --start--> registered` with an attempt link, `registered
    --claim(fenced)--> active`, `active --settle--> settling --confirmed-->
    settled`, `registered/active --reassign(fenced takeover)--> reassigning -->
    active`, `active --failure or uncertain evidence--> failed | unknown`), and
    a `canTransition(from, to)` helper that treats terminal task states as
    immutable and allows a prior attempt to become `superseded` or retain its
    confirmed outcome while the task identity and immutable registration
    metadata remain unchanged (TEO-2.2, TEO-4.2, TEO-4.3).
  - Normalize run/attempt records: distinct bounded `attemptId` and `runId`
    linked to the parent task, owner, generation, fencing token, attempt
    state, run links `{ workflow?, agent?, execution?, session?, job?,
    transaction? }` where each link carries the source's own identity and
    generation when available plus `certainty` fixed to
    `observed | served | stale | unavailable | unknown`, started/settled
    times, outcome, reason, and bounded provenance (TEO-2.1). A task ID is
    never used as an execution ID and an execution ID is never rewritten as a
    task ID; a link whose source lacks a public identity is
    `unavailable`/`unknown`, never synthesized from an event sequence
    (TEO-2.2).
  - Normalize settlement evidence: source outcome from the unified terminal
    vocabulary (`success | error | aborted | denied | superseded`, timeout
    carried as `error` plus a reason/classification field), source identity,
    attempt/generation, observed time, recovery safety classification
    (consumed read-only from `pluginApi.recovery`), and a bounded late-event
    list (TEO-4.1, TEO-4.4, TEO-7.1). Contradictory or incomplete evidence
    yields an explicit `unknown`/`unavailable` state, never an inferred
    success (TEO-4.5); `aborted`/`denied` are never reinterpreted as retryable
    success (TEO-4.4).
  - Add the availability projection builder (`available | unavailable |
    unsupported | unknown`; scope; durability `durable | memory | unknown`;
    per-operation capability map `{ register, start, claim, reassign, settle,
    attach, get, observe, history }`; source availability map
    `{ execution, recovery, coordination, diagnostics, workspaceTransactions,
    jobs, workflow, subagent, session }`; backend `{ id, reason? }`; epoch)
    sharing the projection shape of the same-batch coordination facade; the
    durability vocabulary is a deliberate truth-subset — a process-memory
    registry is always labeled `memory` (non-durable) and can never satisfy a
    reconnect-after-process-loss claim, and a durable tier is merged to
    `durable` only when the host explicitly reports it (TEO-5.3). Plus bounded
    clone/redact helpers that drop secret keys, credentials, prompts, raw
    tool output, and unbounded transcript content while keeping bounded
    provenance.
  - Add focused tests (`test/task-execution-normalize.test.mjs`) for
    task/scope/owner/intent/provenance validation, equivalent-idempotency vs
    identity-conflict, task-vs-execution identity separation, attempt/run
    lineage normalization, link certainty bounds, transition-table legality
    including terminal protection and attempt supersession, settlement
    outcome preservation (aborted/denied never success), contradictory
    evidence to `unknown`, availability capability truth (memory never
    durable), redaction, deep freeze, and redaction-failure fail-closed
    behavior. Cover the normalization/validation portions of TEO-1, TEO-2,
    TEO-4, and TEO-9.

- [x] 2. Implement the source adapters, the durable task registry with
    serialized lanes, and the connect/reconnect evidence path.
  - Add `lib/task-execution-adapters.js` implementing the internal source
    boundary from the design: `registry` (`read`, `writeCas`, plus an internal
    `queryEvents(taskId)` primitive that backs bounded late-event provenance —
    a non-public support surface, not extra API), `execution`
    (`observe/get/history` against the public `pluginApi.execution`
    projection), `recovery` (`classify`/`evaluate`/`availability` consumed
    read-only), `coordination` (`acquire/heartbeat/release/takeover/
    compareAndSet/availability` delegation), `diagnostics` (`get/onChange`
    when the public projection is present), `workspaceTransactions`
    (`get/observe` when the same-batch feature is present), `jobs`
    (`get/list/read` plus `onJobDone`/`onJobsChanged` change notification when
    the public service is available), `workflow` and `subagent` (documented
    `workflow/*` and `subagent/*` catalog events plus the public
    `services.workflows`/`services.subagents` members when available), and
    `session` (read-only `get`/observation/`requestContext` delegation).
    Each adapter returns source identity, generation, certainty, observed
    time, and bounded provenance, and degrades per source — a missing optional
    seam yields `unavailable`/`unknown` for that adapter only and never
    pretends a link was observed (TEO-2.1, TEO-2.2, TEO-6.1, TEO-6.3).
  - Implement the registry as (a) a default memory-scoped registry explicitly
    labeled non-durable, and (b) a storage-domain bridge used only when the
    host explicitly reports a usable durable scope and conditional write
    primitive on the public storage service (same evidence standard as the
    coordination bridge; never inferred from the domain name). The bridge
    performs record writes as one atomic compare-and-swap when that capability
    is confirmed and returns explicit `unavailable`/`unknown` otherwise
    (TEO-5.2 durability boundary). A process-memory registry is reported as
    non-durable and can never satisfy a reconnect-after-process-loss
    assertion (design Testing Strategy).
  - Maintain one serialized operation lane per task identity. The lane is an
    in-process ordering mechanism only and is never presented as cross-process
    locking; attempt claims additionally carry the coordination generation and
    fencing token, and event arrivals are reconciled by stable identity and
    generation, never by latest-arrival order or array position (TEO-2.4).
  - Add the connect/reconnect evidence intake used by the mounter: an
    `execution.observe/onChange` bridge that maps execution transitions to
    task run/attempt evidence, a `jobs` change-notification bridge
    (`onJobDone`/`onJobsChanged`), `workflow/*` and `subagent/*` catalog-event
    listeners that record source provenance, and a session read-only
    observation delegate. A missing optional hook disables only the
    corresponding evidence field and never pretends a source was observed;
    stale attachment callbacks from a replaced generation are ignored and the
    newer identity remains authoritative (TEO-6.4).
  - Add focused tests (`test/task-execution-adapters.test.mjs`) with scripted
    public-surface doubles: per-source availability truthfulness (execution/
    recovery/coordination/jobs/workflow/subagent/session), memory registry
    labeled non-durable, storage-domain bridge persistence and CAS atomicity
    under confirmed evidence, explicit `unavailable`/`unsupported`/`unknown`
    without confirmed capability, domain-name-only evidence never upgrading
    the projection, lane serialization, event-bridge mapping fidelity,
    missing-hook degradation, stale-callback epoch rejection on replaced
    generations, and idempotent disposer ownership. Cover the adapter portions
    of TEO-2, TEO-5, TEO-6, and TEO-7.

- [x] 3. Implement the host owner facade core: typed outcomes, source
    selection, `register`, `start`, and `claim`.
  - Add `lib/task-execution-observation.js` exporting
    `createTaskExecutionObservation({ ctx, execution, recovery, coordination,
    diagnostics, workspaceTransactions, logger, now, idFactory })` — the
    design dependency set plus the injectable `idFactory` test knob (matching
    the coordination owner precedent) — returning
    `{ api, dispose, availability }`; the public API is a frozen object:
    `register({ taskId, ownerId, scope, intent, provenance })`,
    `start(taskId, { runId?, workflowId?, agentId?, sessionId?, jobId?,
    provenance? })`, `claim(taskId, { ownerId, lease, reason? })`,
    `reassign(taskId, { ownerId, expectedGeneration, reason, approval? })`,
    `settle(taskId, { attemptId, outcome, reason?, source?, evidence? })`,
    `attach(taskId, { workflowId?, agentId?, executionId?, sessionId?, jobId?,
    transactionId? })`, `get(taskId, { audience? })`,
    `observe(taskId, { signal?, audience? })`, and
    `history(taskId, { cursor?, limit?, audience? })`. The `availability`
    property on the mount result is the mount-time snapshot, distinct from
    live projections returned by operations. The runtime feature key is the
    neutral `tasks`; governance naming stays in spec docs.
  - Implement the discriminated outcome vocabulary as frozen typed values
    carrying stable codes (`invalid-input`, `identity-conflict`,
    `conflict`, `stale-fencing`, `unsupported`, `unavailable`, `unknown`,
    `inactive`, and success shapes per operation), always carrying task
    identity, operation, current state, revision, and availability; expected
    outcomes are never thrown. A disposed surface returns `inactive` without
    contacting sources.
  - Source selection at mount resolves the public dependency surfaces through
    public reads, probes the coordinate/diagnostic/workspace/jobs/service
    availability, and selects the storage-domain registry bridge only on
    explicit durable+conditional-write evidence, otherwise falling back to the
    memory registry labeled memory-scoped and non-durable; durable-requiring
    reconstruction then returns explicit `unsupported`/`unavailable` instead
    of pretending durability (TEO-5.2, design §Architecture).
  - `register` validates task identity, single scope, owner, intent, and
    creation provenance first; equivalent immutable metadata returns the
    existing task without duplication (TEO-1.3), and conflicting metadata
    returns `identity-conflict` without merging records (TEO-1.4). Success
    exposes immutable task identity, owner, scope, intent, creation
    provenance, initial state `registered`, and revision.
  - `start` creates a run and attempt link in the `registered` attempt state
    with its own distinct `attemptId`/`runId` under the parent task identity
    (TEO-1.2) and preserves all sibling-supplied links only when the
    corresponding public source confirms them (TEO-2.1); it does not execute
    anything and does not publish an active attempt (design §Components).
    Missing/unconfirmed source links are recorded `unavailable`/`unknown`,
    never synthesized (TEO-2.2).
  - `claim` validates the coordination owner/generation/fencing context
    through the public `pluginApi.coordination` surface before publishing the
    attempt as `active` (TEO-3.1); a competing claim on a task with an active
    attempt owned by another valid generation returns a deterministic
    `conflict` and never silently replaces the active attempt (TEO-3.2); a
    stale attempt submitting progress is rejected or recorded only as bounded
    late provenance and never changes the current task state (TEO-3.4).
  - Add focused tests (`test/task-execution-lifecycle.test.mjs`) for the full
    register/start/claim matrix above, including conflicting-registration
    rejection, equivalent idempotency, attempt/run lineage distinctness,
    missing-source link degradation, fencing validation failure,
    foreign-generation claim conflict, stale-attempt late provenance, and
    coordination/execution double-degradation isolation. Cover TEO-1, TEO-2,
    and TEO-3.

- [x] 4. Implement settlement, reassign/takeover, observe, and history with
    immutable projections and epoch guards.
  - `settle` accepts only the current fenced attempt (TEO-4.1); the unified
    outcome (`success | error | aborted | denied | superseded`) is preserved
    without reinterpretation (TEO-4.4), incomplete/contradictory evidence
    yields explicit `unknown`/`unavailable` (TEO-4.5), and exactly one
    authoritative task/run settlement is published per attempt with outcome,
    reason, source, and bounded provenance (TEO-4.1). Retried attempts get a
    new attempt identity while the prior attempt becomes `superseded` or
    retains its confirmed outcome (TEO-4.2); an old attempt or duplicate
    callback after a terminal state is recorded as late/stale provenance
    without rewriting the terminal record (TEO-4.3). Non-idempotent, denied,
    aborted, superseded, or unconfirmed-external-side-effect operations are
    never marked retry-safe (TEO-7.3).
  - `reassign` calls `pluginApi.coordination.takeover` with the expected
    generation first; only after the takeover succeeds does the facade publish
    the new attempt and generation, preserving the reassign reason (TEO-3.3);
    a failed/conflicting takeover returns the typed coordination outcome and
    leaves the current attempt authoritative (TEO-3.2). Reassign requires the
    prior attempt released, expired, or approved for takeover (TEO-3.3) and
    never bypasses coordination (TEO-7.2).
  - `observe(taskId)` returns a frozen subscription object with `current()`
    and `subscribe(fn)` plus an idempotent `dispose()`; delivered projections
    are deep-frozen, redacted, and carry task state, active/latest attempt,
    run links, owner/generation, terminal outcome if any, and provenance
    availability (TEO-5.1). Each subscriber has an epoch so callbacks from a
    disposed or replaced subscription can never publish into a newer
    generation (TEO-5.5); one observer throwing or returning a rejected
    thenable is contained without affecting others or the host (TEO-5.4);
    equivalent state windows are deduplicated per observer epoch (TEO-5.4).
    When the registry is unavailable, `get`/`observe` return an explicit
    unavailable projection rather than inferring state from silence (TEO-5.3).
  - `history(taskId, { cursor?, limit?, audience? })` returns bounded,
    truncated-aware events with `truncated`/`nextCursor`/`unavailable`
    vocabulary; when evidence is truncated, unavailable, stale, or requires
    resync, the projection states that condition explicitly and never claims a
    complete history (TEO-5.3).
  - Add focused tests (`test/task-execution-settlement.test.mjs` and
    `test/task-execution-observe.test.mjs`) for the full settlement and
    observation matrix, including exactly-one settlement, outcome preservation
    without reinterpretation, contradictory-evidence `unknown`, retry
    attempt identity, late/stale callback terminal protection, takeover-gated
    reassign with conflict outcomes, duplicate/late settlement idempotency,
    observer epoch guarding and isolation, stale-callback generation drop,
    truncated history, unavailable-registry projections, and restart
    reconstruction over a memory registry asserted non-durable. Cover TEO-3,
    TEO-4, and TEO-5.

- [x] 5. Implement attach, visibility, redaction, scope denial, and the client
    boundary.
  - `attach` validates the public identity of session/workflow/job/execution/
    transaction references and preserves the source owner and generation
    (TEO-6.1); transcript or session observation delegates to the existing
    public session/execution observation surface and never copies or rewrites
    the official transcript as a second durable store (TEO-6.2); a missing or
    disposed referenced source reports `unavailable`/`disposed` provenance and
    keeps the task record intact (TEO-6.3); an attachment replaced by a newer
    generation ignores stale callbacks and keeps the newer identity
    authoritative (TEO-6.4).
  - All projections crossing the public boundary are bounded, deeply frozen,
    and redacted: credentials, secret values, raw private content, prompts,
    internal diagnostics, unbounded tool output, and unbounded transcript
    content never appear while bounded change evidence is preserved
    (TEO-9.1); the projection is deeply immutable and distinguishes
    `observed`, `served`, `stale`, `unavailable`, and `unknown` provenance
    states explicitly (TEO-9.2); redaction, freezing, or bounded serialization
    failure fails closed for that projection and never returns a partially
    protected record, preserving the underlying task state (TEO-9.3).
  - Enforce the client boundary by explicit absence: zero client code, zero
    client manifest/remote/slot/settings entries, and no
    register/start/claim/reassign/settle/recover entry point reachable from
    client code; the documented contract for any mutation attempt reaching
    this feature's client boundary is the typed unsupported/unavailable result
    asserted by absence in tests — no client-side emulation exists (TEO-10.2).
    Client consumers render read-only redacted host-published projections
    through existing supported channels with explicit availability and
    task/run generation (TEO-10.1); when the host projection or channel is
    unavailable the client degrades locally, identifies the unavailable
    surface, and unrelated client faces keep loading (TEO-10.3).
  - Add focused tests (`test/task-execution-visibility.test.mjs`) for
    redaction coverage (secrets, nested objects, log summaries), deep freeze,
    provenance-state distinction, scope denial without existence leakage,
    fail-closed redaction, observer epoch guarding and isolation,
    unavailable-registry projections, and the absence of every client mutation
    surface. Cover the visibility portions of TEO-5, TEO-9, and TEO-10.

- [x] 6. Mount the host facade with fail-safe lifecycle and typed disabled
    behavior.
  - Add the `tasks` feature guard branch in `lib/guards.js` (public substrate
    probes; optional service resolution degrades per source and never disables
    unrelated features), a `mountTasksFeature` mounter in `lib/index.js`
    registered in `FEATURE_MOUNTERS` after the same-batch facade
    `workspaceTransactions` and after `diagnostics` (the task facade consumes
    the diagnostics projection as provenance evidence and the workspace
    transaction projection when the same-batch feature is present, so it
    mounts after both), and the full service wiring in
    `lib/plugin-api-service.js`: `tasks` in `KNOWN_FEATURES`, a frozen live
    surface slot wiring
    `register/start/claim/reassign/settle/attach/get/observe/history`,
    `createDisabledTasksApi` with the standard typed inactive/disabled errors,
    and matching `_readSlot`/`_disabledSurfaceFor`/`unmountFeature` handling.
    Use `service.prepareFeature` with the same idempotent mount transaction as
    other B-class features.
  - The mounter constructs the owner with the resolved execution/recovery/
    coordination/diagnostics/workspaceTransactions dependency sources, binds
    the execution/jobs/workflow/subagent/session evidence bridges, and
    prepares the surface; missing optional primitives disable only `tasks`
    with a bounded diagnostic; a core guard failure leaves the existing inert
    `pluginApi` service intact; `apply()` catches all setup errors and returns
    normally.
  - Update the shared feature-order assertions that shift when the new feature
    mounts (the pre-existing integration-owned deltas across
    `test/index.test.mjs`, `test/index-agent.test.mjs`,
    `test/index-events.test.mjs`, `test/index-remote.test.mjs`,
    `test/index-session.test.mjs`, `test/index-session-durable.test.mjs`,
    `test/index-system-prompt.test.mjs`, `test/index-tools.test.mjs`, and
    `test/official-passthrough-independence.test.mjs` — the same set the
    coordination feature owned, plus any feature-count assertions those files
    carry).
  - Add focused tests (`test/task-execution-guard.test.mjs` and
    `test/index-tasks.test.mjs`) for active/inert/guard-failure states,
    repeated apply/unapply, owner-replacement stale-call rejection, typed
    unavailable/disabled behavior, fail-safe logger failures, malformed
    source handling, and isolation from coordination/recovery/execution/
    usage/routing, workspace-transaction, and client surfaces.

- [x] 7. Complete cross-feature integration, governance, and repository
    acceptance evidence.
  - Add integration evidence (`test/task-execution-integration.test.mjs`,
    local fixtures with scripted public-surface doubles — no test may assert
    cross-process durability from a memory registry): end-to-end
    register → start → claim → settle with a fenced coordination double;
    reassign via gated takeover; attach with session/workflow/job link
    provenance; observe reconstruction from durable evidence; recovery
    decision vocabulary consumed read-only as provenance; workspace
    transaction provenance consumed when the same-batch feature is present;
    negative tests asserting no scheduler/poller creation, no retry/route/
    approval-bypass execution, no replacement of official execution identity,
    no R replacement, no new events catalog slice, and no official package
    modification.
  - Update only this feature's entries in registration documents: append the
    §7 delivery row for `task-execution-observation` in
    `docs/specs/plugin-api-features/feature-list.md`, and update the feature
    status row plus intro narrative sentence in
    `docs/specs/plugin-api-features/dsh-plugin-api-heuristic-feature-proposals-2026-08-20.md`
    so this feature's own row/status reflects delivery; the
    `workspace-mutation-transaction` row reflects delivery from its own Stage 4
    task, so both third-batch rows read delivered after this update and the
    sibling feature's entries are not edited here; refresh the three spec
    artifacts' status lines.
  - Mark all tasks complete, then run the focused task-execution tests, the
    full `npm test`, `git diff --check`, the governance-token audit,
    syntax/package checks, and an installed official DSH package
    zero-modification check before the Stage 4 commit.