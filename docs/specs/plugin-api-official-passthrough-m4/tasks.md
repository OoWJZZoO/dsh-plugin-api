# Tasks: plugin-api-official-passthrough-m4

> feature_name: plugin-api-official-passthrough-m4
> stage: 3 (Tasks)
> status: approved for Stage 4 execution
> approved inputs: Requirements at 2c2da4b; Design at 61f5937
> historical design baseline: 2c2da4b

## Execution Model

This plan implements every one of the 63 M4 IDs in the approved feature-list
inventory. "Complete" means every listed ID has exactly one implementation or
delivered-regression owner and final evidence. It does not claim coverage of a
larger set of A-class capabilities outside that inventory.

Stage 4 begins only after this Tasks artifact is explicitly approved and the
approved artifact is committed on the integration branch. No Stage 4 worktree
is created before the following W0 boundary is committed and reviewed.

The top-level numbered tasks below are the Stage 4 review units. Each completed
top-level task requires one blocking adversarial review with gpt-5.6-luna at
max reasoning before a dependent task, merge, or delivery proceeds. No other
model is used for those reviews. A substantive correction is followed by a
fresh Luna(max) review of the same top-level task.

The execution DAG is fixed:

~~~text
approved Tasks commit
  -> W0 shared contract boundary (commit + Luna(max))
  -> W1 parallel wave, all derived from the W0 commit:
       host-namespaces
       host-events
       services
       client
  -> W2.1 all-branch preflight + host-namespaces join (commit + Luna(max))
  -> W2.2 host-events join (commit + Luna(max))
  -> W2.3 services join (commit + Luna(max))
  -> W2.4 client join (commit + Luna(max))
  -> W2.5 shared semantics, regressions, and neutral integration checks
           (commit + Luna(max))
  -> W3 inventory reconciliation, final verification, and delivery commit
~~~

The single integration owner is:

| Role | Worktree | Branch | Derivation |
|---|---|---|---|
| integration owner | .worktrees/plugin-api-official-passthrough-m4 | codex/plugin-api-official-passthrough-m4 | current approved Design tip; then approved Tasks commit |

The W1 worktrees are independent only after W0 has a clean, committed, reviewed
tip. They all derive from that same W0 commit, never from a sibling W1 branch:

| W1 batch | Worktree | Branch | Join position |
|---|---|---|---|
| host namespaces | .worktrees/plugin-api-official-passthrough-m4-host-namespaces | codex/plugin-api-official-passthrough-m4-host-namespaces | first leaf merge |
| host events | .worktrees/plugin-api-official-passthrough-m4-host-events | codex/plugin-api-official-passthrough-m4-host-events | second leaf merge |
| service fragment | .worktrees/plugin-api-official-passthrough-m4-services | codex/plugin-api-official-passthrough-m4-services | third leaf merge |
| client leaves | .worktrees/plugin-api-official-passthrough-m4-client | codex/plugin-api-official-passthrough-m4-client | fourth leaf merge |

### ID Owner Matrix

This compact matrix is the mechanical coverage ledger. A range in a task
description is only shorthand; the matrix is the authoritative one-to-one
assignment used by W2 preflight and W3 reconciliation.

| IDs | Sole owner |
|---|---|
| L11, L12, A12, A13, S7, S8, T12, T13, P9, ST9 | task 2 host-namespaces |
| O17, O18, O19, O20 | task 3 host-events |
| SV21, SV22, SV23, SV24, SV25, SV26, SV27, SV28, SV29, SV30, SV31, SV32, SV33, SV34, SV35, SV36, SV37, SV38, SV39, SV40, SV41, SV42, SV43, SV44, SV45, SV46, SV47, SV48 | task 4 services |
| C10, C11, C12, C13, C14, C15, C16, C17, C18, C19, C20, C21, C22, C23, C24, C25 | task 5 client |
| T11, RB1, SV19, SV20, P10 | task 10 W2.5 integration/regression owner |

The matrix has 63 entries. The delivered entries T11, RB1, SV19, and SV20
remain regression-only; they are not reimplemented by a W1 worker. P10 is the
single shared semantic unit and is owned exclusively by W2.

### Parallel Contract

All W1 workers use these non-negotiable integration inputs:

- Public names are the neutral capability names in the approved Design. Runtime
  code, test code, package metadata, and filenames must not contain feature-list
  IDs, capability classification letters, milestone labels, or other governance
  identifiers.
- Existing P1 through P4 failure paths are the only allowed failure presentation:
  P1 inactive root facade, P2 disabled feature, P3 optional service unavailable,
  and P4 per-service or per-client-leaf disabled facade. Guards are required
  fail-closed unless the task explicitly calls a service/provider optional
  fail-open.
- Existing event catalog vocabulary is fixed to name, mode, scopeFiltered,
  scopeKey, payload, args, fault, and freeze. Source provenance and feature
  classification are documentation-only and never catalog or fixture fields.
  No parallel branch adds a synonym or a second composition mechanism.
- Official operation failures, receiver behavior, argument count, return,
  Promise, disposer, and error identity pass through after a successful guard.
  A branch must not eagerly invoke official methods or getters solely to probe
  availability.
- Any need to edit a frozen file is a blocking integration deviation. The
  worker records the W0 baseline SHA, affected files, scope IDs, rationale,
  compatibility impact, focused evidence, and a Requirements/Design revision
  note in its unique batch report; it does not widen its write set. W2 records
  the preflight result and any acceptance or rejection in its decision log.
- Each worker snapshots git status with untracked files before work, stages
  only its declared files, runs git diff --check, commits its batch, and leaves
  a clean worktree. Generated or untracked provenance is preserved rather than
  assumed.

Frozen for all W1 workers. The integration owner is the sole modifier: W0 may
make only its declared pre-parallel test-seam extraction, and W2 owns all
central composition and final-definition changes.

- lib/index.js
- lib/plugin-api-service.js
- lib/client.js
- lib/client-runtime.js
- lib/catalog-compose.js
- lib/events-bus.js
- lib/deep-freeze.js
- lib/system-prompt-events-catalog.js
- lib/feature-registry.js
- lib/errors.js
- lib/guards.js
- lib/services.js
- test/index.test.mjs
- test/index-events.test.mjs
- test/services-definitions.test.mjs
- package.json, package manifests, and bundle patch files
- docs/specs/plugin-api-official-passthrough-m4/requirements.md
- docs/specs/plugin-api-official-passthrough-m4/design.md
- docs/specs/plugin-api-official-passthrough-m4/tasks.md
- all M4 execution records except the unique W1 batch report explicitly
  assigned to that worker below

W1 workers may read the W0 contract fixtures but may not modify them:

- test/official-passthrough-contracts.mjs
- test/official-passthrough-contracts.test.mjs

Only the integration owner updates the checkboxes in this file, after the
corresponding batch has reached its committed, reviewed join boundary. A W1
worker may create only its assigned immutable execution report under
`docs/specs/plugin-api-official-passthrough-m4/execution/`; it never edits
Requirements, Design, Tasks, the feature list, AGENTS.md, or another batch's
report. Each pre-review report records the actual W0 baseline SHA, scope and
write-set audit, focused evidence, and a Requirements/Design revision-note
section. W2 preflight records each committed batch tip, independent audit, and
blocking Luna(max) result. A substantive upstream-spec revision remains
integration-owned and follows the confirmation rules in AGENTS.md.

## Tasks

- [x] 1. W0 - establish the shared, neutral contract and test-fixture boundary on the integration branch.

  Owner and prerequisite: the integration owner performs this after the approved
  Tasks commit and before any W1 worktree exists. Its source baseline is that
  approved Tasks commit. It implements no feature-list ID and creates no public
  pluginApi member.

  Allowed files: test/official-passthrough-contracts.mjs,
  test/official-passthrough-contracts.test.mjs, lib/services.js, narrowly
  scoped tests needed to prove a backwards-compatible internal service-builder
  extraction, and
  docs/specs/plugin-api-official-passthrough-m4/execution/w0-contract.md. The
  extraction must preserve every existing service facade behavior and only let
  a focused test exercise a supplied static definition fragment. It must not
  become a new public export or a generic runtime proxy.

  Forbidden files: every W1 leaf file named below; all client entry files;
  index/mounter files; event bus/freeze/catalog files; guards; manifests; all
  M4 spec documents except its assigned W0 execution record; and any official
  DSH package path.

  Work:

  - Build immutable neutral fixture data containing approved public names,
    member lists, event metadata, and cardinality expectations without embedding
    governance IDs in implementation/test identifiers or runtime strings.
  - Add the smallest internal service-builder seam needed for the services
    worker to test its definition fragment through the existing P4 construction
    behavior. Prove the existing definition table produces an equivalent
    namespace before and after the extraction.
  - Test fixture immutability, exact data shape, and the preserved existing
    services behavior. Do not introduce host/client leaves, feature guards,
    catalog slices, mount registration, or package changes.
  - Create the W0 contract record with the committed Tasks baseline SHA, the
    fixed eight-field catalog schema, the branch/worktree derivation rule, and
    the approved M4-specific client-leaf P4 extension. The record states that
    the older parallel-workflow service-only P4 wording is a documented
    protocol deviation for this feature, not a new runtime failure path; W2
    must carry that decision into its decision log before joining client work.

  Verification and join: run the focused fixture/service-builder tests and
  git diff --check; commit one W0 boundary; obtain blocking Luna(max) review.
  W1 may begin only from the reviewed W0 commit. Requirements: R11-R13.

- [x] 2. W1 - implement the disjoint host namespace leaf factories in the host-namespaces worktree.

  Owner and prerequisite: .worktrees/plugin-api-official-passthrough-m4-host-namespaces
  on codex/plugin-api-official-passthrough-m4-host-namespaces, derived directly
  from the reviewed W0 commit. This task runs concurrently with tasks 3, 4,
  and 5.

  In scope: L11, L12, A12, A13, S7, S8, T12, T13, P9, and ST9.
  Explicitly excluded: P10; T11; RB1; C10-C25; O17-O20; SV19-SV48; all new
  replacement or upstream-proposal work.

  Allowed files: lib/official-host-namespaces.js,
  test/official-host-namespaces.test.mjs, and
  docs/specs/plugin-api-official-passthrough-m4/execution/w1-host-namespaces.md
  only. The files may import existing errors and the W0 read-only fixtures,
  but must not modify them.

  Forbidden files: all frozen files, existing namespace modules, event catalog
  files, package files, every documentation path except its assigned execution
  report, official package files, and every file owned by another W1 worker.

  Work:

  - Export leaf factories that W2 can compose into the existing llm, agent,
    session, tools, systemPrompt, and settings facades without changing the
    existing M0-M3 members.
  - Stabilize the official LLM methods listProviders,
    listConfigurableProviders, discoverModels, providerRetryPolicy, listModels,
    and resolveCallConfig. Expose exactly the three public artifacts
    contentHasImage, createUserMessage, and BlockAssembler; no other same-package
    artifact is implied.
  - Stabilize currentInitiator, requireInitiator, withInitiator,
    withoutInitiator, and isOwnedBy on the agent leaf. Provide options as a
    frozen exact-key snapshot containing provider, model, and maxTokens,
    including undefined values; it must not retain live agent, session, context,
    inbox, or registry state.
  - Stabilize create, prepare, enter, announce, flush, append, and
    deriveEventMessage on the session leaf without adding synthetic durable
    events, projection, replay, or business semantics.
  - Stabilize executionMode and defineTool on the tools leaf, and assemble on
    the systemPrompt leaf. Do not touch the shared writable waterfall work
    assigned to P10 in task 6.
  - Stabilize writable, prepareDocument, get, update, replace, and mutate on
    the settings leaf. A missing or throwing optional settings lookup must
    preserve P3 service-unavailable behavior; a present but malformed approved
    member set must use P2 settings-disabled behavior. Neither failure affects
    existing settings registration/events or unrelated facades.

  Tests: prove exact whitelists and negative boundaries, official receiver and
  argument forwarding, falsey/sync/async/error/Promise/disposer identity,
  frozen A13 snapshot shape, P1/P2/P3 split, partial activation, retained
  reference invalidation, reapply, and stale cleanup. Verify no P10 event
  semantics are imported or changed.

  Execution record: create the assigned batch report with the actual W0
  baseline SHA, branch/worktree identity, allowed-write-set and untracked
  provenance audit, focused commands/results, and a Requirements/Design
  revision-note section. When no deviation exists, state
  that explicitly; otherwise record the reason, affected scope/files,
  compatibility impact, and evidence without editing frozen specs.

  Verification and join: run the focused tests and git diff --check; commit a
  leaf-only boundary; obtain blocking Luna(max) review. The task joins W2 only
  after write-set/provenance preflight. Requirements: R2-R6, R11-R13.

- [x] 3. W1 - implement catalog-only host event slices in the host-events worktree.

  Owner and prerequisite: .worktrees/plugin-api-official-passthrough-m4-host-events
  on codex/plugin-api-official-passthrough-m4-host-events, derived directly
  from the reviewed W0 commit. This task runs concurrently with tasks 2, 4,
  and 5.

  In scope: O17, O18, O19, and O20. Explicitly excluded: L11, L12, A12, A13,
  S7, S8, T11, T12, T13, P9, P10, RB1, ST9, C10-C25, and SV19-SV48; and any
  producer-side bridge implementation.

  Allowed files: lib/official-host-events-catalog.js,
  test/official-host-events-catalog.test.mjs, and
  docs/specs/plugin-api-official-passthrough-m4/execution/w1-host-events.md
  only.

  Forbidden files: all frozen files; base/existing catalog slices; event bus;
  freeze utilities; compose helper; host indexes; manifests; every documentation
  path except its assigned execution report; official package files; and all
  files owned by the other W1 workers.

  Work:

  - Declare five catalog-only slices whose combined exact event rows are:
    agent-loop/config-start-failed; agent-preset/selected;
    cordis/dynamic-package; cordis/dynamic-retract; cordis/request-run;
    cordis/request-run-resolved; cordis/inspect-query;
    cordis/inspect-query-resolved; and domain/changed.
  - Set each row to the approved existing schema: emit mode,
    scopeFiltered false, fault contain, freeze all, exact official argument
    order, and no invented payload fields.
  - Supply only declarative catalog metadata and any narrow availability
    predicate consumed by W2. The existing events bus remains the sole native
    subscription owner. Do not call ctx.on as a producer, create a bridge
    listener, re-emit, replay, synthesize a payload, or add a second catalog
    composition path.
  - Treat an unavailable producer as omission/inert behavior for only that
    slice. It must not disable unrelated event slices or change the existing
    native hook owner.

  Tests: prove exact nine names and five-slice grouping, row metadata and
  cardinality, payload/argument identity through the existing bus test seam,
  one native delivery per official dispatch, contained listener failure,
  missing-producer isolation, and stale native-hook cleanup. Assert no
  unapproved name or governance label becomes runtime catalog data.

  Execution record: create the assigned batch report with the actual W0
  baseline SHA, branch/worktree identity, allowed-write-set and untracked
  provenance audit, focused commands/results, and a Requirements/Design
  revision-note section. When no deviation exists, state
  that explicitly; otherwise record the reason, affected scope/files,
  compatibility impact, and evidence without editing frozen specs.

  Verification and join: run the focused tests and git diff --check; commit a
  slice-only boundary; obtain blocking Luna(max) review. The task joins W2 only
  after write-set/provenance preflight. Requirements: R1, R7, R11-R13.

- [x] 4. W1 - create the neutral static service-definition fragment in the services worktree.

  Owner and prerequisite: .worktrees/plugin-api-official-passthrough-m4-services
  on codex/plugin-api-official-passthrough-m4-services, derived directly from
  the reviewed W0 commit. This task runs concurrently with tasks 2, 3, and 5.

  In scope: SV21-SV48. Explicitly excluded: L11, L12, A12, A13, S7, S8, T11,
  T12, T13, P9, P10, RB1, ST9, C10-C25, O17-O20, SV19, and SV20; and any
  modification of the existing central definition table.

  Allowed files: lib/official-service-definitions.js,
  test/official-service-definitions.test.mjs, and
  docs/specs/plugin-api-official-passthrough-m4/execution/w1-services.md only.

  Forbidden files: lib/services.js, test/services-definitions.test.mjs, all
  other frozen files, manifests, every documentation path except its assigned
  execution report, official package files, and every file owned by another W1
  worker.

  Work:

  - Export a neutral immutable fragment containing only key, ctxService, and
    members. Each member uses only the existing method, getter, or forward
    kind. The fragment has no package-provenance metadata, generic proxy,
    object spread, concrete-provider inference, or service-level P3 policy.
  - Define the approved service/member contract:

    | Service key | Approved members |
    |---|---|
    | agentLoop | config; create; createAgent; resume |
    | agentPresets | list; resolve; mount; composeFrom; composedPreset; read; copy; remove; serviceFor; recompose; standingKeyFor |
    | apiProxy | downloads; respond |
    | clientModules | graph; clientPath; rebuilt; onRebuilt; onGraphChanged |
    | commands | register; list; find; execute |
    | credentials | resolve; describe; set; unset |
    | directoryPicker | capability |
    | e2b | cwd; runtimeRoot; getSandbox |
    | goals | get; disarm; create; edit; pause; resume; complete; block; clear; remoteExportCreate |
    | invariants | register |
    | lsp | registerProvider; query |
    | messageFeedback | list; put; delete |
    | permissionPresets | current; selectFor; resolve; optionOf; set |
    | planMode | get; set |
    | sandbox | confine |
    | sandboxPolicy | defaultMode; workspaceRoot; resolve; overrideOf |
    | sessionPersistence | locate; supportsRawArtifacts; readRaw; create; append; prepare; load; inspect; readFrom; list; listSnapshots |
    | sessionProjectionCache | cachedSnapshot; write; coldSnapshot |
    | shell | resolve; run; start |
    | spillStore | saveText |
    | storageDomain | open; get; closeAll |
    | subprocess | resolveExecutable; spawn; spawnTerminal |
    | terminals | registerBackend; listBackends; spawn; hasOwnerActivity; startSend; read; signal; kill; list |
    | timer | timeout; interval; throttle; debounce |
    | toolResultPruner | config; measureContent; pruneContent; pruneSession |
    | typertGateway | invoke |
    | webServer | register; registerUpgrade; registerFallback; tapIndex; applyIndexTaps |
    | web | registerSearchProvider; registerFetchProvider; search; fetch |

  - Use getter entries exactly for agentLoop.config, apiProxy.downloads,
    e2b.cwd, e2b.runtimeRoot, sandboxPolicy.defaultMode,
    sandboxPolicy.workspaceRoot, sessionPersistence.supportsRawArtifacts, and
    toolResultPruner.config. Every other listed member is a method entry; no
    member is optional in this fragment.
  - Use the W0 service-builder seam to prove active facade exact shape,
    receiver preservation, getter behavior, returned handle/error identity,
    per-service P4 degradation for a missing service or required member, and
    absence of private/concrete-provider members. The root namespace remains
    usable when one optional service is absent.

  Execution record: create the assigned batch report with the actual W0
  baseline SHA, branch/worktree identity, allowed-write-set and untracked
  provenance audit, focused commands/results, and a Requirements/Design
  revision-note section. When no deviation exists, state
  that explicitly; otherwise record the reason, affected scope/files,
  compatibility impact, and evidence without editing frozen specs.

  Verification and join: run the focused tests and git diff --check; commit
  one fragment-only boundary; obtain blocking Luna(max) review. The task joins
  W2 only after write-set/provenance preflight. Requirements: R1, R8, R11-R13.

- [x] 5. W1 - implement client leaf adapters in the client worktree.

  Owner and prerequisite: .worktrees/plugin-api-official-passthrough-m4-client
  on codex/plugin-api-official-passthrough-m4-client, derived directly from
  the reviewed W0 commit. This task runs concurrently with tasks 2, 3, and 4.

  In scope: C10-C25. Explicitly excluded: L11, L12, A12, A13, S7, S8, T11,
  T12, T13, P9, P10, RB1, ST9, O17-O20, and SV19-SV48; changes to the existing
  client outer facade; and dynamic remote discovery.

  Allowed files: lib/client-official-services.js,
  lib/client-official-events.js, lib/client-official-connection.js,
  test/client-official-services.test.mjs, test/client-official-events.test.mjs,
  test/client-official-connection.test.mjs, and
  docs/specs/plugin-api-official-passthrough-m4/execution/w1-client.md only.

  Forbidden files: lib/client.js, lib/client-runtime.js, all host/shared frozen
  files, manifests, every documentation path except its assigned execution
  report, official package files, and every file owned by another W1 worker.

  Work:

  - Export leaf-scoped adapter factories for the approved client services,
    preserving the exact outward lists below and exposing no generic proxy,
    constructor, UI internal, concrete-provider member, or cloned return
    handle:

    | Client leaf | Approved members |
    |---|---|
    | modules | version; loadCache; import; registerStatic; prefetch; invalidate |
    | locale | getLocale; getSnapshot; subscribe; setLocale; register; bind |
    | sessions | list; currentProvideInfo; searchResultLimit; open; openSubagent; subagentAddress; setSubagentCatalogOpen; refreshSubagents; noteAgentPreset; clear; search; fork; provide; scope; scopeOf; sessionOf; binding |
    | workspaces | list; connectWorkspace; startSession; create; pickDirectory; listDirectory; createDirectory; openPath; rename; delete; insertBefore; insertSessionBefore; archiveSession |
    | chatFileMentions | forClosing |
    | layout | toggleSidebar; openDetails; closeDetails |
    | theme | getTheme; exportInspectTokens; setTheme; register; overrideTokens |
    | appShell | renderApp |
    | sessionLogDownload | store; download; dismiss; dispose |
    | cordisInspect | register; publish; query; close |
    | dynamicCordisRunner | activeRuns; lastRunError; renderFailures; reconcileApprovals; approve; decline; startUserRun; subscribe; getSnapshot; isLoaded |

  - Add direct official event adapters for locale/change, theme/change,
    connection/reset, and command/executed. Preserve official event order,
    payload identity, timing, listener disposal, and contained failure behavior;
    do not synthesize an event when its producer is absent.
  - Add the nested client.connection.api.llm face with exactly providers,
    models, and discoverModels. It delegates to the official connection API and
    preserves endpoint, payload, optional signal, Promise/rejection, and error
    behavior.
  - Make every client service, event, and connection face a locally guarded P4
    leaf. This is the approved M4-specific extension recorded by W0 because the
    older parallel-workflow table illustrates P4 only for `services.*`; it does
    not change the existing P1-P4 runtime semantics. Optional provider
    resolution is fail-open. Use per-epoch owner tokens and stale-safe disposers
    so delayed cleanup cannot remove a newer registration. The outer client
    facade stays publishable when a leaf fails.

  Tests: prove every approved client whitelist and negative boundary, official
  receiver/return/Promise/disposer identity, client event argument order and
  contained failures, connection signal/error forwarding, absent/malformed or
  throwing provider isolation, repeated apply, partial activation,
  out-of-order cleanup, and newer-owner preservation.

  Execution record: create the assigned batch report with the actual W0
  baseline SHA, branch/worktree identity, allowed-write-set and untracked
  provenance audit, focused commands/results, and a Requirements/Design
  revision-note section. Record the approved client-leaf
  P4 protocol deviation and any additional deviation's reason, affected
  scope/files, compatibility impact, and evidence without editing frozen specs.

  Verification and join: run the focused tests and git diff --check; commit
  one leaf-only boundary; obtain blocking Luna(max) review. The task joins W2
  only after write-set/provenance preflight. Requirements: R1, R9, R11-R13.

- [x] 6. W2.1 - preflight the whole W1 wave and join the host namespace batch.

  Owner and prerequisite: the integration owner executes this only after tasks
  2 through 5 each have a clean committed boundary, focused evidence, and
  blocking Luna(max) approval. This is the first serial W2 join batch; no W2
  edit occurs until the complete preflight has passed.

  Allowed files: lib/index.js, lib/plugin-api-service.js, lib/guards.js,
  lib/llm-api.js, lib/session-feature.js, lib/system-prompt.js, lib/settings.js,
  central host integration tests, mechanical resolution in task 2 files, and
  docs/specs/plugin-api-official-passthrough-m4/execution/w2-preflight.md plus
  docs/specs/plugin-api-official-passthrough-m4/execution/w2-decisions.md.

  Forbidden files: unrelated refactors, non-M4 feature work, official package
  paths, any task 3-5 leaf redesign, and runtime/test identifiers or fixture
  data containing feature-list IDs or governance classifications.

  Read-only preflight before any integration edit:

  - Record in `w2-preflight.md` the committed W0 SHA, each W1 branch tip, each
    unique batch report, focused evidence, blocking Luna(max) result, tracked/
    untracked/generated provenance, scope and write-set audit, frozen-file
    compliance, neutral vocabulary, guard/failure mapping, and negative-boundary
    check against the approved Requirements, Design, and Tasks.
  - Run `git diff --check`, verify no official DSH package changed, and simulate
    every pairwise W1 merge edge with `git merge-tree`. An unreported deviation
    blocks every join until corrected or explicitly accepted in `w2-decisions.md`.
  - Record the approved client-leaf P4 protocol extension from W0 in
    `w2-decisions.md`; it must remain documentation-only and must not introduce
    a new runtime error path or a governance-labelled runtime artifact.

  Join work:

  - Merge only the reviewed host-namespaces commit, then wire its leaf factories
    into the existing stable namespaces and guards without reordering M0-M3
    mounters. Preserve P1/P2/P3 behavior and retained-reference invalidation.
  - Run the affected focused tests. Resolve only mechanical conflicts and
    approved contract alignment; do not perform a coordinator-wide refactor.

  Verification and join: run focused tests, `git diff --check`, official-package
  immutability, and provenance checks; commit this host-namespaces join boundary
  and obtain a blocking Luna(max) review before task 7. Requirements: R1-R6,
  R11-R13.

- [x] 7. W2.2 - join and compose the host event catalog batch.

  Owner and prerequisite: the integration owner executes this only after task 6
  is committed, clean, and blocking-reviewed. It is a separate top-level join
  batch, not an extension of task 6.

  Allowed files: lib/catalog-compose.js, lib/index.js, the existing central
  catalog/integration tests, mechanical resolution in task 3 files, and the
  W2 decision log. W2 is the sole owner of central catalog composition.

  Forbidden files: event-producer bridges, replay/synthetic producer logic,
  unrelated refactors, official package paths, and runtime/test identifiers or
  fixture data containing feature-list IDs or governance classifications.

  Work:

  - Merge only the reviewed host-events commit and compose its five catalog-only
    slices through the existing `composeCatalogs` path. The existing events bus
    remains the sole native subscription owner for the nine rows.
  - Preserve the exact eight-field catalog schema and the host-event policies:
    `emit`, `scopeFiltered: false`, `fault: 'contain'`, and `freeze: 'all'`.
    No `source`, `type`, classification, or traceability field enters a runtime
    catalog object or test fixture.
  - Run affected focused tests and record any mechanical conflict decision in
    the W2 decision log.

  Verification and join: run focused tests, `git diff --check`, official-package
  immutability, and provenance checks; commit this host-events join boundary and
  obtain a blocking Luna(max) review before task 8. Requirements: R1, R7,
  R11-R13.

- [x] 8. W2.3 - join the service fragment and integrate the central service table.

  Owner and prerequisite: the integration owner executes this only after task 7
  is committed, clean, and blocking-reviewed. It is a separate top-level join
  batch.

  Allowed files: lib/services.js, test/services-definitions.test.mjs, central
  service/integration tests, mechanical resolution in task 4 files, and the W2
  decision log.

  Forbidden files: unrelated refactors, new service abstractions beyond the
  approved fragment, official package paths, and runtime/test identifiers or
  fixture data containing feature-list IDs or governance classifications.

  Work:

  - Merge only the reviewed service-fragment commit and import it into
    `lib/services.js`. Remove `pkg` metadata from every old and new runtime
    definition, retaining only key, ctxService, and members.
  - Update central tests for the final 48 unique service keys: delivered keys,
    27 new keys, and the existing `web` key extended with `search` and `fetch`.
    Every service remains independently P4 and tests use only neutral service
    names, member lists, and counts.
  - Run affected focused tests and record any mechanical conflict decision in
    the W2 decision log.

  Verification and join: run focused tests, `git diff --check`, official-package
  immutability, and provenance checks; commit this services join boundary and
  obtain a blocking Luna(max) review before task 9. Requirements: R1, R8,
  R11-R13.

- [x] 9. W2.4 - join and wire the client leaf batch.

  Owner and prerequisite: the integration owner executes this only after task 8
  is committed, clean, and blocking-reviewed. It is a separate top-level join
  batch.

  Allowed files: lib/client.js, lib/client-runtime.js, central client/integration
  tests, mechanical resolution in task 5 files, and the W2 decision log.

  Forbidden files: client manifest, codec, remote-contribution, slot, or
  settings-remote semantic changes; unrelated host refactors; official package
  paths; and runtime/test identifiers or fixture data containing feature-list
  IDs or governance classifications.

  Work:

  - Merge only the reviewed client-leaves commit. Wire client leaf adapters
    through the single `clientOfficialServices` join point in this order:
    modules, locale, sessions, workspaces, chatFileMentions, layout, theme,
    appShell, sessionLogDownload, cordisInspect, dynamicCordisRunner.
  - Integrate client events and the nested LLM connection through the existing
    outer lifecycle. Preserve the approved client-leaf P4 protocol extension,
    optional-provider fail-open behavior, and stale-owner cleanup rules without
    altering any existing client feature semantics.
  - Run affected focused tests and record any mechanical conflict decision in
    the W2 decision log.

  Verification and join: run focused tests, `git diff --check`, official-package
  immutability, and provenance checks; commit this client join boundary and
  obtain a blocking Luna(max) review before task 10. Requirements: R1, R9,
  R11-R13.

- [x] 10. W2.5 - complete shared semantics, delivered regressions, and neutral integration verification.

  Owner and prerequisite: the integration owner executes this only after tasks
  6 through 9 are committed, clean, and blocking-reviewed. This is the final
  W2 top-level integration batch and owns the sole shared P10 semantic unit.

  Allowed files: lib/events-bus.js, lib/deep-freeze.js,
  lib/system-prompt-events-catalog.js, central integration/cardinality tests,
  delivered-regression tests, package manifests/bundle wiring only when an
  audited public import requires it, and the W2 decision log.

  Forbidden files: new inventory IDs, C-class proposals, R-class replacements,
  consumer migrations, official package paths, leaf redesign, and runtime/test
  identifiers or fixture data containing feature-list IDs or governance
  classifications.

  Work:

  - Implement P10 as one atomic semantic unit. The `system-prompt/assemble`
    waterfall keeps official writable assembly sections, contexts, tools, and
    variables writable before and after `await next()`; normal listener throws
    and rejections propagate according to the official waterfall, while monitor
    containment and unrelated catalog freeze policies remain unchanged.
  - Add delivered-regression tests for the tool aborted-error contract, host
    remote discovery/wire parameter/owner disposer/P2 isolation, and the two
    previously delivered service seams' exact member, receiver, identity, and
    local degradation behavior.
  - Add central integration assertions using only neutral capability names,
    event names, service keys, client member whitelists, and cardinalities:
    nine host event names, 48 service keys, exact service member lists, and all
    approved client public faces. The one-to-one inventory-ID-to-evidence map is
    excluded from runtime and test code and belongs only in W3 Markdown.
  - Run `node --test` and targeted host/client boot checks with evidence type
    clearly labeled. Record material integration decisions and evidence in the
    W2 decision log; do not infer browser or deployed acceptance from unit or
    HTTP success.

  Verification and join: run full and focused tests, `git diff --check`,
  official-package immutability, lifecycle/stale-cleanup/fail-safe checks, and
  clean provenance checks; commit this final W2 boundary and obtain a blocking
  Luna(max) review before task 11. Requirements: R1-R12 and R13.

- [ ] 11. W3 - reconcile the final inventory, record delivery evidence, and close Stage 4 on the integration branch.

  Owner and prerequisite: the integration owner performs this only after task
  10 is committed, clean, and blocking-reviewed. W3 is serial and adds no
  runtime production behavior.

  In scope: all 63 M4 inventory IDs as final reconciliation records, feature-list
  status changes, required delivered-feature registration, traceability evidence,
  and verification-documentation or test-evidence gaps only. Explicitly
  excluded: any production behavior fix, new leaf API, host/client refactor,
  C-class proposal, R-class replacement, consumer migration, or official package
  change. A production behavior defect discovered here returns to its affected
  W2 join batch (or a new explicitly scoped W2 integration batch) for a commit
  and Luna(max) review before W3 restarts.

  Allowed files: docs/specs/plugin-api-features/feature-list.md, AGENTS.md
  delivered-feature registration, M4 execution/delivery records under
  docs/specs/plugin-api-official-passthrough-m4/, and central verification tests
  only when they close a missing assertion or evidence gap without changing
  runtime behavior.

  Work:

  - Reconcile every ID exactly once in
    `docs/specs/plugin-api-official-passthrough-m4/delivery-report.md`: L11/L12;
    A12/A13; S7/S8; T11-T13; P9/P10; RB1; ST9; C10-C25; O17-O20; and SV19-SV48.
    Mark each as implemented or delivered regression evidence, preserving the
    approved L12 and A13 scope corrections. No ID may be omitted, duplicated,
    or represented by a broader unbounded claim.
  - Record the owning batch, public whitelist/event/service contract, negative
    boundary, focused test evidence, integration evidence, and status for each
    inventory entry. State browser, headless, dev-boot, and deployed-runtime
    evidence separately; no browser or deployed conclusion is inferred from
    unit tests or HTTP success.
  - Run final full-suite, neutral cardinality, provenance, immutability,
    lifecycle, stale-cleanup, and fail-safe checks. Confirm no governance
    identifiers leaked into runtime/test code or package artifacts and no
    official DSH package changed.
  - Commit all required Stage 4 code/spec/governance changes before delivery.
    Run `git diff --check` on the final commit range and leave the integration
    worktree clean.

  Verification and delivery gate: obtain one blocking Luna(max) review of the
  completed W3 reconciliation. Address substantive findings and re-review the
  same batch before reporting final delivery. Requirements: R1, R10-R13.

## Execution Checklist

A top-level task can be marked complete only when all of the following are
present for that task:

- its declared commit boundary and clean worktree;
- focused tests and git diff --check;
- a write-set and untracked-provenance audit;
- a blocking Luna(max) adversarial review with no unresolved substantive finding;
- its assigned pre-review batch report, or for W2/W3 its integration record,
  identifying any approved deviation and its evidence.

W2.1 additionally requires successful read-only preflight for all W1 branches;
each W2 join then requires its own commit and Luna(max) review before the next
join. W3 additionally requires full-suite evidence and the one-to-one 63-ID
reconciliation. These gates make parallel work an input to integration rather
than a substitute for integration.
