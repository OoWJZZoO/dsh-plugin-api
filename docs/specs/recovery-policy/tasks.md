# Stage 3 - Tasks

## Status

Stage 3 Tasks: approved and executed for this implementation run. The feature
owner authorized direct execution after the approved Goal, Requirements, and
Design; this task list is the Stage 3/4 boundary for the implementation
sub-agent.

## Execution Contract

- Execute the tasks in order. A task is complete only when its implementation
  and focused tests are green.
- Keep this feature host-only and policy-first. `pluginApi.recovery` may
  classify, register, normalize, evaluate, consume, and redact decisions, but
  it must never execute retry/fallback/fork/abort work or own execution,
  route, budget, session, workspace, checkpoint, scheduler, or provider state.
- Consume only explicit public evidence supplied by callers or audited local
  fixtures. Do not add global official-event listeners, private official
  imports, event catalog entries, client manifest/remote/slot/settings faces,
  or replacement bundles.
- Every apply, mount, registry, policy, adapter, disposer, diagnostic, and
  redaction path is fail-safe. A recovery failure selects the bounded safe
  default and leaves the original operation outcome unchanged; it must never
  escape plugin apply or kill harness boot.
- Preserve the existing service lifetime, feature registry, typed disabled
  surfaces, version/assembly state, `pluginApi.routing`, `pluginApi.execution`,
  `pluginApi.usage`, and all unrelated feature slots.
- Use `node --test` through the repository's `npm test` scripts. Mark each
  completed task in this file before the final Stage 4 commit.

## Tasks

- [ ] 1. Implement the dependency-free failure classifier and bounded models.
  - Add a pure recovery classifier/model module and focused tests for the five
    terminal classes, `error` plus `timeout` reason, bounded reason/source
    evidence, cancellation/supersession precedence, contradictory or missing
    input, and late provider errors that cannot override a stronger signal.
  - Normalize only documented public failure shapes; cap diagnostic/detail
    strings and tolerate hostile getters/cause chains without exposing private
    error data or changing the caller's original error/outcome.
  - Keep returned classification/reason/source structures immutable and free of
    harness dependencies. Cover RP-1 and the classifier portion of RP-8/RP-10.

- [ ] 2. Implement operation capability ownership and ordered policy registry.
  - Add the host-side capability registry with validation for operation/scope,
    idempotency, retryability, allowed actions, side-effect class, deadline,
    retry budget, fork capability, and approval requirement; reject malformed
    declarations through typed, bounded errors.
  - Add policy registration with stable id, owner identity, owner-local
    generation, explicit match scope, priority order, at-most-once evaluation,
    latest-wins replacement, and idempotent identity-bound disposers. Old
    generations must not remove newer registrations.
  - Add focused tests for unregistered/unsupported capabilities, non-idempotent
    defaults, latest-wins/disposer isolation, deterministic priority plus
    registration ordering, and hostile registration callbacks. Cover RP-2 and
    RP-3 registration criteria.

- [ ] 3. Implement explicit decision convergence, bounds, and single-use state.
  - Add the recovery owner/engine that accepts only explicit decision input,
    snapshots applicable capability/policy registrations, and converges valid
    `retry`, `abort`, `fallback`, `fork`, `stop`, and `no-op` results using the
    documented conservative precedence. Contain throws, rejected thenables,
    invalid results, stale generations, cancellation, and incomplete evidence.
  - Validate action-specific contracts: retry keeps execution identity and has
    finite bounds/deadline/backoff or an explicit immediate reason; fallback
    preserves failed-attempt parentage without selecting a route; fork needs
    declared capability/approval and never claims copied state; abort requires
    an active cancellable operation; stop preserves the triggering outcome.
  - Produce fresh deeply immutable decisions with decision id, execution/
    attempt/parent correlation, capability evidence, evidence provenance,
    bounded diagnostics, and fail-closed `stop` when no valid result remains.
  - Add focused tests for precedence, at-most-once policy invocation, action
    validation, unsupported-boundary rejection, evidence unavailability,
    policy failure containment, cancellation/stale result suppression, and
    immutable decision snapshots. Cover RP-3, RP-4, RP-5, RP-7, and RP-8.

- [ ] 4. Implement execution/attempt integrity and compare-and-swap consume.
  - Add explicit execution/attempt correlation checks that accept identities
    only from supplied public projections, preserve execution identity across
    internal retry/fallback attempts, require distinct proposed attempt
    boundaries, and treat an external repeat as a new execution.
  - Guard terminal outcomes (`success`, `error`, `aborted`, `denied`,
    `superseded`) and late evaluations; never mint identities from event
    sequence, object identity, timestamps, or private retry counters, and never
    start work from a terminal execution.
  - Implement `consume(decisionId, { attemptId })` as idempotent only for the
    first identity-guarded consumer, with typed rejection for a second or
    mismatched consume and no attempt creation. Add bounded decision history or
    consumption evidence only as needed by the approved design.
  - Add focused tests for internal/external identity behavior, terminal
    protection, missing identity safe default, same-decision double consume,
    attempt mismatch, concurrent consume, and cancellation races. Cover RP-4,
    RP-5, RP-6, and RP-7.

- [ ] 5. Implement pure integration adapters and visibility/redaction helpers.
  - Add `fromAgentRequestError(payload)` and `fromToolResult(exec, result)`
    normalizers for documented public shapes; keep them pure, zero-harness,
    non-listening, and free of retry/provider/checkpoint side effects.
  - Add explicit evidence/provenance normalization for budget, route,
    diagnostics, branch, and checkpoint inputs. Missing dependencies become
    `unavailable` evidence and never trigger fabricated identity or durable
    behavior; unsupported durable checkpoint/workspace/lease/compensation
    requests return explicit typed C-class/out-of-boundary results.
  - Add redacted host/debug projection helpers whose default is omission from
    model-visible data, which retain only bounded non-secret action/reason/
    source/time/uncertainty fields, and which fail closed if redaction fails.
  - Add focused tests for adapter shape normalization, malformed payloads,
    source provenance/uncertainty, unsupported boundaries, secret/private
    field omission, explicit non-secret elevation, and no client-owned surface.
    Cover RP-8, RP-9, and RP-10.

- [ ] 6. Mount the host facade with fail-safe lifecycle and typed unavailable
  behavior.
  - Add a `recovery` feature guard and mounter using the existing feature
    registry/service lifecycle. The mounter must construct the recovery owner,
    prepare/publish `pluginApi.recovery`, and roll back only its own resources
    on failure; core/other feature behavior and boot must continue.
  - Extend `lib/plugin-api-service.js` with a fixed host-only recovery surface
    (`classify`, `capability.declare`, `policy.register`, `evaluate`,
    `consume`, `adapters`, `visibility`, and `availability`) plus the standard
    typed inactive/disabled surface and stale-owner cleanup. Preserve service
    identity and all existing namespaces.
  - Add no recovery events catalog slice, package-owned client bundle,
    manifest, remote, slot, settings, reconnect protocol, global event
    subscription, official import, or package/version/assembly change.
  - Add facade integration tests for active/inert/guard-failure states,
    repeated apply/unapply, owner replacement and stale calls, typed
    unavailable behavior, fail-safe logger/diagnostic failures, and isolation
    from routing/execution/usage/client surfaces. Cover the mounting portions
    of RP-8 and RP-10.

- [ ] 7. Complete cross-feature boundary, governance, migration, and repository
  acceptance evidence.
  - Add local-fixture tests proving explicit interoperability with public
    execution, budget, route, diagnostics, branch, and checkpoint projections
    without owning or mutating their state; prove fallback delegates candidate
    choice to `model-route-policy`/the official loop and that recovery never
    executes an action.
  - Add negative tests for automatic route choice, billing, approval bypass,
    boot mutation, non-idempotent replay/compensation, durable checkpoint
    restore, workspace transaction, lease/CAS, scheduler ownership, private
    official imports, and official package zero modification.
  - Update only this feature's entry and evidence in
    `docs/specs/plugin-api-features/feature-list.md`, retaining U13/U14/U15 as
    proposal-only with their documented retirement conditions; record bounded
    migration evidence for consumers to call the explicit recovery surface
    while keeping execution/route/budget owners authoritative.
  - Mark all tasks complete and run focused recovery tests, full `npm test`,
    `git diff --check`, governance/range checks, syntax/package checks, and an
    installed official DSH package zero-modification check before the Stage 4
    commit.
  - Covers the complete Requirements/Design testing strategy and migration
    acceptance without editing consumer repositories or official packages.

## Stage 4 Implementation Record

To be completed after all implementation tasks and repository acceptance checks
pass. Record the final host surface, focused/full test commands, governance and
official-package integrity evidence, migration evidence, commit hash, and clean
worktree state in the final delivery report.
