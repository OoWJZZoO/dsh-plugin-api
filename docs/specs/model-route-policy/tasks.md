# Stage 3 - Tasks

## Status

Stage 3 Tasks: approved and executed for this implementation run. The feature
owner authorized direct execution after the approved Goal, Requirements, and
Design; this task list is the Stage 3/4 boundary for the implementation
sub-agent.

## Execution Contract

- Execute the tasks in order. A task is complete only when its implementation
  and focused tests are green.
- Keep the replacement scoped to the `@deepseek-ai/dsh-agent-loop` component.
  Do not modify installed files under `/usr/lib/node_modules/@deepseek-ai/dsh`.
- Preserve the official import face. New route semantics belong to the loader
  row service/event surface and the conditional main-facade projection.
- All apply, fallback, publication, disposer, and diagnostic paths are
  fail-safe. A malformed optional route capability disables only this feature.
- Keep the existing `pluginApi.routing` composite and existing facade feature
  slots unchanged except for the additive `routePolicy` publication gate.
- Use `node --test` tests and run the complete repository checks after all
  tasks. Mark each task implemented in this file before the Stage 4 commit.

## Tasks

- [x] 1. Add the replacement package boundary and deterministic assembly.
  - Create `packages/agent-loop/package.json` with the unified full version,
    exact locked `@deepseek-ai/dsh-agent-loop` identity, official peer
    dependency surface, and the package-owned patch entry.
  - Create `packages/agent-loop/cordis.patch.yml` to disable `agent-loop` and
    insert exactly one `plugin-api-agent-loop` row with the official default
    config, preserving the official row's config-continuity input.
  - Add the auxiliary package to `packages/full/package.json`,
    `packages/full/cordis.patch.yml`, and `pnpm-lock.yaml` without changing
    the existing Wave A assembly order or versions.
  - Add package-boundary and patch-composition fixtures proving selection and
    full installation have the same replacement row and no double-run.
  - Covers MR-1, MR-7, MR-8, and the Design C1/C2 assembly contract.

- [x] 2. Implement the dependency-free route capability owner.
  - Add `packages/agent-loop/lib/route-policy.js` with frozen candidate and
    decision models, owner/generation identity checks, deterministic priority
    ordering, policy/candidate registration and identity-scoped disposers.
  - Implement policy convergence for `select`, `reject`, and `no-op`, bounded
    diagnostics for throws/rejected thenables/invalid results, explicit
    unknown admission/health handling, and no-route denied decisions.
  - Implement attempt/window memoization, fallback-parent lineage, bounded
    append-only decision history with explicit truncation, cancellation/stale
    guards, and redacted boundary errors. Route policy must not create or
    retry an execution.
  - Implement health evidence, circuit transitions, bounded probe admission,
    independent probe identities, and probe outcome handling without
    rewriting committed route decisions.
  - Add unit tests for MR-2 through MR-6, including concurrency, stale
    generation, unknown evidence, disposer isolation, and out-of-boundary
    rejection behavior.

- [x] 3. Vendor the locked official agent-loop and patch its route boundary.
  - Add `packages/agent-loop/lib/forked-loop.js` from the audited official
    `dsh-agent-loop/lib/index.js`, retaining its license/source notice and
    official exports, config validation, settings registration,
    system-prompt variables, agent factory, driver lifecycle, event timing,
    cancellation, scheduler, and teardown behavior.
  - Mark only route-policy additions as replacement patches. At
    `ReactLoopAgent.buildRequest`, preserve the official seed construction and
    `agent/request` waterfall, then add route-window decision freeze and
    superseded late-proposal diagnostics. Advance the window only at a new
    turn or an explicitly authorized retry/fallback attempt.
  - Keep `agent/request-error` retry ownership with the official loop and
    accept an injected recovery/fallback lineage hint without implementing
    retry, backoff, abort, checkpoint, or execution-terminal policy.
  - Add focused fork-integrity tests against the installed official source and
    invariant/request freezing probes, plus decision-window tests for reuse,
    retry re-evaluation, no-route provider suppression, and waterfall parity.
  - Covers MR-1, MR-2, MR-5, MR-6, and Design C4/C6.

- [x] 4. Implement the replacement apply self-check and fallback behavior.
  - Add `packages/agent-loop/lib/apply.js` and the component contract marker;
    inspect loader composition, official-row state, duplicate replacement
    rows, existing owners/services, and exact package/runtime/main-facade
    versions.
  - Reconcile disabled official-row config with the replacement default using
    the forked official config contract; preserve valid user configuration and
    fall back safely on malformed input.
  - Register the fork only when the replacement row is active and all checks
    pass; verify `ctx.agentLoop`, its complete callable contract, settings
    registration, route-policy service, and owner marker after registration.
  - On identity mismatch with the official row disabled/absent, register the
    official `AgentLoop` fallback with route policy closed; when the official
    row is enabled, stay inert. Roll back malformed registrations and never
    throw through `apply`.
  - Add matrix tests for absent/disabled/enabled rows, owner conflict,
    duplicate insertion, version mismatch, config continuity, contract probe,
    fallback, rollback, and idempotent cleanup.
  - Covers MR-1, MR-7, MR-8, MR-9, and Design C2/C3.

- [x] 5. Publish the conditional main-facade route-policy leaf.
  - Add the marker/loader/version resolver in `lib/index.js` without importing
    the auxiliary package, and pass the resolver into the existing service
    construction path.
  - Add a service-lifetime `pluginApi.routePolicy` surface with the five
    designed leaves and `availability()`, using the existing typed disabled
    surface and feature-registry gating. It must resolve the current marked
    `ctx.routePolicy` owner lazily and preserve main facade behavior when the
    replacement is unavailable.
  - Keep `pluginApi.routing`, `pluginApi.services.agentLoop`, client manifest,
    and generic `agent-loop` settings behavior unchanged. Add no route event
    catalog slice or client bundle.
  - Add facade integration tests for marker activation, active-row/version
    gates, typed unavailable behavior, stale owner cleanup, and isolation from
    unrelated facade leaves.
  - Covers MR-2, MR-3, MR-4, MR-9, MR-10, and Design C3/C7.

- [x] 6. Add complete focused contract and boundary verification.
  - Add tests for official service/event parity, config-driven agents,
    create/resume ownership, settings and system-prompt variables, cancellation
    and reverse teardown using local fixtures around the audited official seam.
  - Add tests for policy convergence, health/circuit/probe, fallback lineage,
    bounded ledger/redaction, cancellation/stale callbacks, and no provider
    call on denied routes.
  - Add explicit negative tests proving the capability cannot mutate
    attachments, billing, approval, retry/execution, boot, or another official
    component, and that direct official package imports remain official.
  - Add package-boundary, patch integrity, official-source zero-modification,
    and full-bundle composition checks.
  - Covers all MR requirements and the Design Testing Strategy items 1–7.

- [x] 7. Complete governance, migration evidence, and repository acceptance.
  - Register the delivered `model-route-policy` feature and its R replacement
    in `docs/specs/plugin-api-features/feature-list.md`, preserving U11 and
    recording the official-equivalent retirement condition.
  - Add the component replacement row to the capability-strategy R/migration
    evidence where required, and add a bounded migration recipe/fixture for
    route-aware consumers that uses `pluginApi.routePolicy` while keeping
    `pluginApi.routing` compatibility queries intact.
  - Mark all completed tasks and record implementation evidence in this spec
    directory only; do not edit consumer repositories or official packages.
  - Run focused tests, full `npm test`, `git diff --check`, governance/range
    audits, package/patch checks, and the official DSH package zero-modification
    check before the Stage 4 commit.
  - Covers MR-7, MR-8, MR-10 and the repository migration/registration rules.

## Stage 4 Implementation Record

- Replacement package: `packages/agent-loop/`; full/selection patch assembly
  and unified package metadata are synchronized at `0.1.0-rc.6-0.5` / `0.5`.
- Route owner tests cover deterministic policy convergence, frozen decisions,
  window reuse, fallback lineage, bounded history, health/circuit/probe state,
  generation-scoped disposal, and typed unavailable behavior.
- Replacement tests cover active/disabled/mismatch/duplicate/owner-conflict
  apply paths, rollback, package/patch composition, and the locked official
  export/config/settings/source boundary. The installed official agent-loop
  source and manifest digests remained unchanged.
- Main facade publication remains additive and lazy: `pluginApi.routing` and
  existing service/client surfaces are unchanged; unavailable replacement
  state exposes the typed disabled route-policy leaf.
- Migration evidence is in `MIGRATION_RECIPE.md`; no consumer repository or
  installed official package was edited.
- Acceptance commands completed for the final boundary: focused route,
  replacement, facade, package-policy, integrity, syntax, diff-check, and
  governance tests; the full repository `npm test` is run before the Stage 4
  commit.
