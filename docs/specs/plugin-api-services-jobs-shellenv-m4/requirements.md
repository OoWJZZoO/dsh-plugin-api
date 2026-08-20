# Feature Requirements: plugin-api-services-jobs-shellenv-m4

## Introduction

`plugin-api-services-jobs-shellenv-m4` extends the delivered 19-key
`pluginApi.services` static passthrough namespace with two additional
A-class capability seams: the official background-job registry (`ctx.jobs`)
and the official managed `DSH_*` environment registry (`ctx.shellEnv`). The
namespace grows from 19 to 21 keys.

Today a third-party plugin author who wants to write a background-task tool,
a shell-tool extension, or a managed `DSH_*` environment-fact contributor can
only reach these two seams through the unsupported escape hatch
(`ctx.get('jobs')` / `ctx.get('shellEnv')`). This feature makes both seams
first-class members of `pluginApi.services`, so that community tool authors
can write these plugin shapes against the stable facade contract with the
same fail-safe and typed-error guarantees as every other capability service.

Source research against the installed DSH runtime (`0.1.0-rc.6`) establishes
the two official service faces:

- `ctx.jobs` — the background-job Service Definition. The abstract contract
  lives in `@deepseek-ai/dsh-jobs` (`JobRegistry`), and the process-local
  provider is `@deepseek-ai/dsh-jobs-local` (`LocalJobRegistry`). Its public
  surface is exactly the nine operations `start`, `list`, `get`, `read`,
  `kill`, `wait`, `onJobDone`, `onJobsChanged`, and `attachController`.
- `ctx.shellEnv` — the shell-environment registry from
  `@deepseek-ai/dsh-shell-env` (`ShellEnvRegistry`). Its public surface is
  exactly the three operations `register`, `collect`, and `list`.

Both services are host-plane services (the `shell-env` composition note and
the background-job registry note in the official agent presets keep them on
the host plane), so a facade mounted in the host plugin reaches them through
`ctx.get`.

This feature depends on `plugin-api-capabilities-m1` (the services namespace,
common A-class passthrough contract, typed errors, fail-safe guard, and
per-service/per-member disabled-facade presentation) and extends it exactly
the way `plugin-api-compaction-m2` did for SV17. It introduces no new client
API, no new event-catalog entry, no top-level namespace, no generic background
job executor, and no change to official `jobs`/`shellEnv` behavior.

**Type:** A (official service direct binding; no semantic translation).

**Scope boundary:** The `jobs` seam's `onJobDone`, `onJobsChanged`, and
`attachController` are ordinary passthrough service operations (each returns a
disposer, as the abstract contract declares). They become facade *methods*,
NOT entries in the `pluginApi.events` catalog. No `jobs/*` or `shellEnv/*`
name is subscribed to, emitted, re-emitted, or added to any event catalog.

---

## Requirements

### 1. `services.jobs` and `services.shellEnv` namespace integration and read-only shape

**User Story:** As a third-party plugin author, I want discoverable, read-only
`pluginApi.services.jobs` and `pluginApi.services.shellEnv` facades, so that I
can use the official background-job and managed-environment capabilities
without binding to a concrete provider shape or reaching through the escape
hatch.

**Acceptance Criteria:**

1. GIVEN the `pluginApi` service and the `services` feature are active, WHEN a third-party plugin reads `ctx.pluginApi.services`, THEN it SHALL expose exactly these 21 keys and no others: `fs`, `codeRuntime`, `workspaces`, `subagents`, `workflows`, `approval`, `userQuestions`, `attachments`, `skills`, `storage`, `sessionProjections`, `sessionQuery`, `sessionTitle`, `sessionTelemetry`, `sessionReferences`, `tokenMeter`, `agentDefaultModel`, `web`, `compaction`, `jobs`, and `shellEnv`.
2. GIVEN the `pluginApi` service is active, all existing 19 capability services are unavailable, and complete `ctx.jobs` and `ctx.shellEnv` services are available, WHEN the `services` feature mounts, THEN it SHALL remain active and expose active `pluginApi.services.jobs` and `pluginApi.services.shellEnv` facades while each existing unavailable service facade follows its delivered disabled-facade contract.
3. GIVEN the `pluginApi` service and the `services` feature are active, WHEN a third-party plugin reads `ctx.pluginApi.services.jobs`, THEN it SHALL receive a stable facade object with observable `isActive === true` and exactly the nine callable members `start`, `list`, `get`, `read`, `kill`, `wait`, `onJobDone`, `onJobsChanged`, and `attachController`.
4. GIVEN the `pluginApi` service and the `services` feature are active, WHEN a third-party plugin reads `ctx.pluginApi.services.shellEnv`, THEN it SHALL receive a stable facade object with observable `isActive === true` and exactly the three callable members `register`, `collect`, and `list`.
5. WHEN a third-party plugin attempts to assign to, delete, extend, or otherwise mutate `pluginApi.services`, `pluginApi.services.jobs`, or `pluginApi.services.shellEnv`, THEN that mutation SHALL NOT be observable by any consumer.
6. WHEN the facade is created, THEN it SHALL NOT freeze, seal, proxy, or otherwise mutate the official `ctx.jobs` or `ctx.shellEnv` service objects.
7. GIVEN a third-party plugin reads any existing service member of `pluginApi.services`, WHEN this feature is active, THEN that member's key, facade identity, passthrough surface, and disabled-state behavior SHALL remain governed by the delivered `plugin-api-capabilities-m1` contract.

**Type:** Facade foundation plus A-class service direct binding.

---

### 2. Stable jobs passthrough contract

**User Story:** As a background-job consumer, I want the `jobs` facade to
expose only the operations the official `JobRegistry` service definition
declares, so that my plugin remains independent of a concrete provider while
retaining exact official semantics.

**Acceptance Criteria:**

1. WHEN a third-party plugin calls `pluginApi.services.jobs.start(spec)`, THEN the facade SHALL invoke `ctx.jobs.start(spec)` with the same argument and SHALL return the exact official `JobId`.
2. WHEN a third-party plugin calls `pluginApi.services.jobs.list()`, `pluginApi.services.jobs.list(caller)`, `pluginApi.services.jobs.get(id)`, `pluginApi.services.jobs.get(id, caller)`, `pluginApi.services.jobs.read(id)`, or `pluginApi.services.jobs.read(id, caller)`, THEN the facade SHALL invoke the corresponding `ctx.jobs` operation with the exact argument list, preserving whether the trailing `caller` argument was omitted, and SHALL return the exact official return value.
3. WHEN a third-party plugin calls `pluginApi.services.jobs.kill(id)`, `pluginApi.services.jobs.kill(id, caller)`, or `pluginApi.services.jobs.kill(id, caller, reason)`, THEN the facade SHALL invoke `ctx.jobs.kill` with the exact corresponding argument list, preserving whether optional `caller`/`reason` were omitted, and SHALL return the exact `'requested' | 'already-finished'` result.
4. WHEN a third-party plugin calls `pluginApi.services.jobs.wait(id, timeoutMs)`, `pluginApi.services.jobs.wait(id, timeoutMs, caller)`, or `pluginApi.services.jobs.wait(id, timeoutMs, caller, signal)`, THEN the facade SHALL invoke `ctx.jobs.wait` with the exact corresponding argument list, preserving whether optional `caller`/`signal` were omitted, and SHALL return the exact official `Promise<JobSnapshot>`.
5. WHEN a third-party plugin calls `pluginApi.services.jobs.onJobDone(listener)`, `pluginApi.services.jobs.onJobsChanged(listener)`, or `pluginApi.services.jobs.attachController(name)`, THEN the facade SHALL invoke the corresponding `ctx.jobs` operation with the same argument and SHALL return the exact disposer returned by the official service.
6. WHEN any stable jobs operation throws synchronously or returns a rejected promise, THEN the facade SHALL propagate the exact error or rejection unchanged and SHALL NOT catch, wrap, suppress, retry, or substitute it.
7. WHEN a third-party plugin supplies an agent (`caller`), job id, timeout, abort signal, listener, label, spec, or any other argument to a stable jobs operation, THEN the facade SHALL pass that value through without cloning, freezing, caching, wrapping, validation, or alteration.
8. WHEN a stable jobs operation returns an object, promise, value, error, disposer, or other result, THEN the facade SHALL preserve its identity and observable timing and SHALL NOT proxy, clone, cache, or attach facade-specific side effects to it.
9. WHEN the facade delegates a stable jobs operation, THEN it SHALL preserve the official `ctx.jobs` object as the method's `this` binding.
10. WHEN this feature exposes `onJobDone`, `onJobsChanged`, or `attachController`, THEN it SHALL NOT add any `jobs/*` name to `pluginApi.events` or any event catalog; these operations remain service methods with official listener/disposer semantics.

**Type:** A (official `@deepseek-ai/dsh-jobs` Service Definition passthrough,
live provider `@deepseek-ai/dsh-jobs-local`).

---

### 3. Stable shellEnv passthrough contract

**User Story:** As a managed-environment contributor, I want the `shellEnv`
facade to expose exactly the official `ShellEnvRegistry` operations, so that I
can register `DSH_*` facts and let the shell executors collect them without
binding to a concrete registry shape.

**Acceptance Criteria:**

1. WHEN a third-party plugin calls `pluginApi.services.shellEnv.register(contributor)`, THEN the facade SHALL invoke `ctx.shellEnv.register(contributor)` with the same argument and SHALL return the exact disposer returned by the official service.
2. WHEN a third-party plugin calls `pluginApi.services.shellEnv.collect(execution)`, THEN the facade SHALL invoke `ctx.shellEnv.collect(execution)` with the same argument and SHALL return the exact official immutable `DshEnvironment` overlay.
3. WHEN a third-party plugin calls `pluginApi.services.shellEnv.list()`, THEN the facade SHALL invoke `ctx.shellEnv.list()` and SHALL return the exact official declaration array.
4. WHEN any stable shellEnv operation throws synchronously or returns a rejected promise, THEN the facade SHALL propagate the exact error or rejection unchanged and SHALL NOT catch, wrap, suppress, retry, or substitute it.
5. WHEN a third-party plugin supplies a contributor, tool execution, or any other argument to a stable shellEnv operation, THEN the facade SHALL pass that value through without cloning, freezing, caching, wrapping, validation, or alteration.
6. WHEN a stable shellEnv operation returns an object, value, disposer, or other result, THEN the facade SHALL preserve its identity and observable timing and SHALL NOT proxy, clone, cache, or attach facade-specific side effects to it.
7. WHEN the facade delegates a stable shellEnv operation, THEN it SHALL preserve the official `ctx.shellEnv` object as the method's `this` binding.

**Type:** A (official `@deepseek-ai/dsh-shell-env` `ShellEnvRegistry` direct
passthrough).

---

### 4. Per-service and per-member degradation

**User Story:** As a plugin author, I want jobs/shellEnv availability to be
explicit and locally contained, so that a missing or incomplete `jobs` or
`shellEnv` provider cannot disable other capability facades or crash harness
boot.

**Acceptance Criteria:**

1. GIVEN the `services` feature is active and `ctx.get('jobs')` is unavailable or throws while the services namespace is built, WHEN a third-party plugin reads `pluginApi.services.jobs`, THEN it SHALL receive an observable disabled facade with `isActive === false`; calls to each declared operation SHALL produce the foundation-defined typed feature-disabled error for `services.jobs` and SHALL NOT call an official service.
2. GIVEN the `services` feature is active and `ctx.get('shellEnv')` is unavailable or throws while the services namespace is built, WHEN a third-party plugin reads `pluginApi.services.shellEnv`, THEN it SHALL receive an observable disabled facade with `isActive === false`; calls to each declared operation SHALL produce the foundation-defined typed feature-disabled error for `services.shellEnv` and SHALL NOT call an official service.
3. GIVEN the `services` feature is active and `ctx.get('jobs')` resolves to a value missing a declared operation or where a declared operation is not callable, WHEN the services namespace is built, THEN the jobs facade SHALL be observably disabled through the existing per-member disabled-facade path; it SHALL expose `isActive === false`, each declared operation SHALL produce the foundation-defined typed feature-disabled error for `services.jobs`, and the facade SHALL NOT expose a partially active surface.
4. GIVEN the `services` feature is active and `ctx.get('shellEnv')` resolves to a value missing a declared operation or where a declared operation is not callable, WHEN the services namespace is built, THEN the shellEnv facade SHALL be observably disabled through the existing per-member disabled-facade path; it SHALL expose `isActive === false`, each declared operation SHALL produce the foundation-defined typed feature-disabled error for `services.shellEnv`, and the facade SHALL NOT expose a partially active surface.
5. GIVEN the `pluginApi` core is inactive, WHEN any declared `services.jobs` or `services.shellEnv` operation is called from either an active or disabled facade, THEN it SHALL produce the foundation-defined typed inactive error before touching an official service.
6. GIVEN the `services` feature is disabled before the jobs/shellEnv facades mount, WHEN any declared `pluginApi.services.jobs` or `pluginApi.services.shellEnv` operation is called, THEN it SHALL produce the foundation-defined typed feature-disabled error for `services` and SHALL NOT call an official service.
7. GIVEN the `services` feature is active and the official jobs or shellEnv service is missing, incomplete, or cannot be probed, WHEN the host plugin applies, THEN only the corresponding `services.jobs` / `services.shellEnv` facade SHALL be disabled for that cause; all other independently available `pluginApi.services.*` facades SHALL remain available according to their own contracts, and `apply` SHALL NOT throw through.
8. GIVEN construction of the jobs or shellEnv facade fails for an unexpected reason, WHEN the host plugin applies, THEN the failure SHALL be contained by the existing fail-safe path, logged through the existing diagnostic mechanism where available, and SHALL NOT disable unrelated services or throw through `apply`.

**Type:** Facade foundation (P1 inactive core, P2 services disabled, P4 per-member disabled facade).

---

### 5. No event, behavior, or namespace changes

**User Story:** As a harness maintainer, I want these two seams to remain
narrow A-class capability seams, so that exposing them cannot alter official
jobs/shellEnv behavior or create an unsupported event contract.

**Acceptance Criteria:**

1. WHEN this feature mounts, THEN it SHALL NOT register, subscribe to, emit, re-emit, translate, or add catalog entries for any `jobs/*` or `shellEnv/*` name through `pluginApi.events`, `baseEventsCatalog`, or the Cordis event bus.
2. WHEN a third-party plugin invokes a stable jobs operation through the facade, THEN the facade SHALL NOT alter ownership/isolation fencing, id issuance, lifecycle settlement, listener containment, owner cleanup, teardown cancellation, or access semantics beyond the official service's own behavior.
3. WHEN a third-party plugin invokes a stable shellEnv operation through the facade, THEN the facade SHALL NOT alter built-in key reservation, duplicate detection, per-execution resolution, immutable overlay construction, or effect-scoped disposal beyond the official service's own behavior.
4. WHEN a third-party plugin directly injects `ctx.jobs`, `ctx.shellEnv`, imports an official jobs/shellEnv package, or otherwise interacts with the official services outside this facade, THEN the facade SHALL NOT intercept, patch, block, or alter that interaction; that path remains the unsupported escape hatch defined by the foundation contract.
5. WHEN this feature is implemented, THEN it SHALL NOT create a new top-level `pluginApi` namespace or a parallel namespaced duplicate (`pluginApi.jobs`, `pluginApi.shellEnv`, or similar) for these seams; they SHALL appear only as `pluginApi.services.jobs` and `pluginApi.services.shellEnv`.
6. WHEN this feature is implemented, THEN it SHALL NOT provide a generic background-job executor, a task scheduler, a replacement jobs provider, a replacement shell-env registry, or any job/shellEnv management API beyond the declared passthrough members.
7. WHEN this feature is implemented, THEN it SHALL NOT modify, replace, disable, or re-register the official `ctx.jobs`, `ctx.shellEnv`, `dsh-jobs`, `dsh-jobs-local`, `dsh-shell-env`, or related official packages or rows.

**Type:** A boundary; no event stabilization, no semantic translation, no R-ization.

---

### 6. Migration acceptance evidence

**User Story:** As the maintainer of `dsh-pro-ex-ability-anchor`, I want the
Git Bash tool's background-job and managed-environment wiring to be expressible
through `pluginApi.services.jobs` / `pluginApi.services.shellEnv`, so that the
community's reference tool author proves the same wiring path is available to
them.

**Acceptance Criteria:**

1. WHEN `dsh-pro-ex-ability-anchor` migrates its Git Bash tool, THEN its supported path SHALL resolve the background-job registry and the managed environment registry through `pluginApi.services.jobs` and `pluginApi.services.shellEnv`, respectively, and SHALL remove the direct `ctx.get('jobs')` / `ctx.get('shellEnv')` wiring for those seams.
2. GIVEN the migrated Git Bash tool, WHEN it runs a background execution, THEN the tool SHALL call the facade's `jobs.start` passthrough and SHALL not reach the official registry through an escape-hatch capture.
3. GIVEN the migrated Git Bash tool, WHEN it builds the model-facing environment for a shell call, THEN the tool SHALL call the facade's `shellEnv.collect` passthrough and SHALL not reach the official registry through an escape-hatch capture.
4. WHEN the migration is complete, THEN the migration acceptance SHALL confirm that the Git Bash tool's `ctx.get('jobs')` / `ctx.get('shellEnv')` direct wiring is deleted or reduced to a documented facade call, and that the relevant `dsh-pro-ex-ability-anchor` tests pass.

**Type:** 质量门 / 迁移验收（证据，非本 feature 的目的语义）。

---

### 7. Testability and regression coverage

**User Story:** As a maintainer, I want focused automated coverage for the two
new facades and the changed namespace cardinality, so that the passthrough
boundaries and fail-safe degradation remain regression-safe without a real
harness boot.

**Acceptance Criteria:**

1. WHEN `node --test` runs with mocked Cordis context and official services, THEN tests SHALL assert that the services namespace exposes exactly the 21 keys in section 1, including `jobs` and `shellEnv`, and remains read-only and frozen.
2. WHEN `node --test` runs with a complete mock `ctx.jobs`, THEN tests SHALL assert that the jobs facade is frozen, `isActive === true`, exposes exactly the nine declared operations, preserves the official `this` binding, forwards all arguments unchanged (including omitted trailing optionals), preserves returned-value and disposer identity, and propagates thrown and rejected official errors unchanged.
3. WHEN `node --test` runs with a complete mock `ctx.shellEnv`, THEN tests SHALL assert that the shellEnv facade is frozen, `isActive === true`, exposes exactly the three declared operations, preserves the official `this` binding, forwards all arguments unchanged, preserves returned-value and disposer identity, and propagates thrown and rejected official errors unchanged.
4. GIVEN the `services` feature is active, WHEN `node --test` runs with `ctx.get('jobs')` and/or `ctx.get('shellEnv')` absent or throwing while one or more other services are available, THEN tests SHALL assert that only the affected facade(s) is/are disabled; their declared operations produce the correct typed error without official calls; any available jobs/shellEnv sibling remains active; other available service facades remain active; and apply does not throw.
5. GIVEN the `services` feature is active, WHEN `node --test` runs with a mock jobs/shellEnv service missing or making non-callable one declared operation, THEN tests SHALL assert that the corresponding facade is disabled through the per-member disabled-facade path, exposes no partially active operation surface, leaves other available service facades active, and does not throw through apply.
6. WHEN `node --test` runs with an inactive `pluginApi` core or a disabled `services` feature, THEN tests SHALL assert that every declared `services.jobs` or `services.shellEnv` operation reports the foundation-defined typed error before touching the mock official service: an inactive core SHALL produce the typed inactive error, and a disabled `services` feature SHALL produce the typed feature-disabled error for `services`.
7. GIVEN facade construction of `services.jobs` or `services.shellEnv` fails for an unexpected reason, WHEN `node --test` runs, THEN tests SHALL assert that the failure is contained by the fail-safe path (the affected facade reports the typed disabled error), unrelated service facades remain active, and apply does not throw.
8. WHEN `node --test` runs, THEN tests SHALL assert that no `jobs/*` or `shellEnv/*` name is added to any event catalog, and that the event-catalog cardinality from the delivered integration boundary is unchanged.
9. GIVEN all existing capability services are unavailable and complete mock `ctx.jobs`/`ctx.shellEnv` are available, WHEN `node --test` runs, THEN tests SHALL assert that the `services` feature remains active, both new facades report `isActive === true`, and every existing unavailable service facade preserves its delivered disabled-facade behavior.
10. GIVEN mocked Cordis context and mocked official services, WHEN `node --test` runs, THEN no test SHALL require booting a real harness, a real jobs producer, a real shell executor, or a real shell-environment collection.

**Type:** Quality gate.

---

## Host / Client coverage

- **Host:** `pluginApi.services.jobs` and `pluginApi.services.shellEnv` are
  host-only passthrough service facades backed by the static
  `SERVICE_DEFINITIONS` table. Both resolve the official host-plane services at
  namespace-construction time.
- **Client:** This feature SHALL NOT introduce a client bundle, remote
  namespace, codec, slot, settings section, or browser-side translation.

## Non-goals

- Providing a generic background-job executor, task scheduler, or job
  management API (the seam exposes only the official passthrough members).
- Exposing `jobs` / `shellEnv` as R-class replacement bundles
  (`disabled: true` official-row replacement) or via any official patch
  mechanism.
- Adding tool-abort error helpers (`createAbortedError` or equivalent) — that
  belongs to the separate `plugin-api-tools-abort-helper-m4` feature.
- Reclassifying `onJobDone` / `onJobsChanged` / `attachController` as
  `pluginApi.events` catalog entries or Cordis events.
- Intercepting, patching, or altering official jobs/shellEnv services, or
  changing their official behavior.
- Adding any client-side or browser-facing jobs/shellEnv API.
