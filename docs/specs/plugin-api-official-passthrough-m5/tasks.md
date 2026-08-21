# M5 Official Passthrough Tasks

Stage 4 starts with the parallel-delivery contract below. M5 owns only the
audited P11 and C26-C32 additions. It shares the existing foundation with M4,
but never imports or requires an M4 implementation. The current package
boundary remains `0.1.0-rc.6-0.5` / `dsh.api: 0.5`; M5 does not independently
advance that protocol boundary. Any protocol-minor bump caused by the combined
M4/M5 delivery is owned by the later integration boundary and must update all
packages together.

## 0. Parallel delivery contract

Before any implementation task starts, the execution owner SHALL create
`docs/specs/plugin-api-official-passthrough-m5/execution/w0-contract.md` as an
execution precondition, not as a coding task. It must record the M5
worktree/branch, the Stage 3 commit baseline, and the intended merge order:
integrate the M4 branch and M5 branch as separate feature units, then reconcile
shared files once. The contract must freeze the following details:

- **Identity and namespace exception:** this is the compound-feature exception
  recorded in the approved Design. The implementation feature identity is
  `officialPassthrough` (camelCase). The host `runFeatureGuard` branch,
  `FEATURE_MOUNTERS` key, and host re-apply check use exactly that key. The
  generic one-feature/one-public-namespace rule is intentionally excepted:
  M5 adds no `pluginApi.officialPassthrough` namespace. Its only public faces
  are the existing `pluginApi.systemPrompt` helper composition and
  `pluginApi.client` leaf composition frozen by the Design. The private
  mounter/owner name must use `officialPassthrough`; an implementation must
  not invent a second alias or expose the private name as API.
- **Mount position:** the complete host order before execution is
  `tools`, `events`, `agent`, `llm`, `llm/request`, `llm/admission`, `session`,
  `sessionDurable`, `execRoute`, `sessionRoute`, `settings`, `systemPrompt`,
  `officialPassthrough`, `services`, `typert`, `settingsRemote`, `remote`.
  M5 inserts its one host mounter immediately after `systemPrompt` and before
  `services`; it must not reorder or rename any existing entry. The client
  `CLIENT_MOUNTERS` order and existing M3 names remain frozen, with M5 leaves
  added only through the client root/bootstrap owner described by the Design.
- **Scope allowlist and exclusions:** the only feature-list rows M5 may mark
  delivered or implement are `P11` and `C26`-`C32`. Explicitly excluded are
  `P1`-`P10`, `C1`-`C25`, every `T*`, `L*`, `A*`, `E*`, `O*`, `S*`, `ST*`,
  `SV*`, `RB*`, and `U*` row, all M4 rows (including already-delivered
  `T11`, `RB1`, `SV19`, and `SV20`), and all M-final C-class proposals or
  consumer migrations. A future row outside the allowlist is excluded by
  default and requires a separate approved feature.
- **Idempotency:** for the host mounter, the sole re-apply signal is
  `featureRegistry.isActive('officialPassthrough')`. Service shape checks,
  `service.isActive`, catalog identity, constant-true shortcuts, and ad hoc
  aliases are forbidden. The client root keeps the approved M3 owner/root
  identity and exact disposer behavior; that client lifecycle check is not a
  second host feature-registry signal.
- **Governance writes:** `AGENTS.md` may receive only one new row appended at
  the end of Section 8. `feature-list.md` may change only the status cells of
  `P11` and `C26`-`C32`; it must not rename, move, duplicate, or edit any M4
  row or any other milestone/status cell. No governance identifiers may enter
  `lib/`, `packages/`, `test/`, generated artifacts, package metadata, or
  runtime diagnostics.
- **Test names:** the required protocol-named tests are
  `test/index-official-passthrough.test.mjs`,
  `test/plugin-api-service-official-passthrough.test.mjs`, and
  `test/official-passthrough-guard.test.mjs`. Additional M5-only tests must
  use `test/official-passthrough-<area>.test.mjs`; frozen shared index/event
  tests are not edited. Since M5 adds no event catalog, no catalog slice or
  catalog test is created.

- **Write boundaries:** the exact M5 write set is the following. New source
  files may only match `lib/official-passthrough-*.js` or
  `lib/client-official-passthrough-*.js`. Existing source edits are limited to
  `lib/guards.js` (append-only feature dispatch branch), `lib/index.js`
  (append-only host mounter and map entry), `lib/plugin-api-service.js`
  (append-only M5 surface assignment path), `lib/system-prompt.js`
  (append-only helper composition), and `lib/client-runtime.js` (M5 root and
  leaf bootstrap integration). The only generated artifact may be
  `lib/client.js`. New tests may only be the three required files
  `test/index-official-passthrough.test.mjs`,
  `test/plugin-api-service-official-passthrough.test.mjs`, and
  `test/official-passthrough-guard.test.mjs`, plus files matching
  `test/official-passthrough-*.test.mjs`. The only existing test file that may
  be edited is `test/client-bundle.test.mjs`, and only for M5 bundle assertions;
  `test/index.test.mjs`, `test/index-events.test.mjs`, and all other existing
  tests are frozen. Governance edits are limited to the M5 status cells in
  `docs/specs/plugin-api-features/feature-list.md`, one appended M5 row in
  `AGENTS.md` Section 8, and
  `docs/specs/plugin-api-official-passthrough-m5/execution/w0-contract.md`;
  this `tasks.md` and the feature-local Design may receive reconciliation
  notes only. Existing M4 modules, M4 rows/statuses, generic event/catalog
  infrastructure, and official DSH package files are frozen. Package metadata,
  including every `package.json` version, `dsh.api`, dependency, and manifest
  field, is read-only for M5; any metadata change belongs to the integration
  owner. All other paths are forbidden unless the execution contract records a
  concrete failure requiring an explicit user decision.
- **Mount order:** the contract names the exact `FEATURE_MOUNTERS` insertion
  position and the resulting complete order before implementation. M5 must
  append at that agreed position without reordering an existing M4 entry.
- **Guard policy:** host required peers and the M5 host helper owner are
  fail-closed where the existing host facade requires them; optional browser
  module/service leaves are fail-open and degrade locally to their typed
  unavailable shells. The contract records the classification per leaf.
- **Failure presentation:** core failure remains P1; a disabled M5 surface
  uses the existing P2 typed feature-disabled path keyed by `surfaceKey`; P3
  and P4 are not introduced for M5. No competing `pluginApi` provider is
  published.
- **Catalog scope:** M5 adds no event catalog entry. The contract records
  catalog schema as N/A for this feature and freezes the existing catalog
  infrastructure.
- **Merge rule:** keep the union of disjoint additions, preserve M4's rows,
  statuses, and feature order, resolve shared metadata at integration, and
  reject any M5 change that imports or calls an M4-specific symbol.

## 1. Host helper owner and system-prompt integration

- [ ] 1.1 Add a pure host helper descriptor/slot module for the two context-rendering exports.
  - Freeze the two surface descriptors with the official package identity, public export name, one-argument contract, and safe diagnostic reasons from the Design inventory.
  - Treat the host record states as exactly `active`, `disabled`, and `retired`; use generation/token checks and do not invent an asynchronous `pending` host state.
  - Freeze the authoritative helper contracts as the two named public namespace exports, not concrete class members; forward the complete original argument list with the official namespace as receiver.
  - Keep the helper owner independent from the existing base `systemPrompt` owner and from the generic feature metadata schema.
  - Cover Requirements 1.1-1.4, 3.1-3.3, and 4.1-4.3.

- [ ] 1.2 Integrate both helper slots into the host `systemPrompt` composition without changing existing members.
  - Preserve the existing base face, reapply identity, feature registry behavior, and fail-safe `apply()` boundary.
  - Mount and clean up each helper independently; make stale cleanup identity-safe across reapply and disposal.
  - Treat a statically missing required host peer as the documented module-evaluation boundary; contain installed-but-malformed exports locally.
  - Cover Requirements 3.1-3.4 and 5.1-5.3.

- [ ] 1.3 Add host helper contract and lifecycle tests.
  - Test exact argument identity/order, receiver, result identity, synchronous throws, and rejected Promise preservation for both helpers.
  - Test missing and invalid exports, missing base service, independent sibling availability, stale references, reapply, disposal, safe diagnostics, and no sensitive values in diagnostics.
  - Run the tests against pure fakes and the installed public `@deepseek-ai/dsh-system-prompt` namespace without modifying the official package.
  - Freeze and test the unique host diagnostic mapping: absent export -> `missing-export`; non-callable export -> `invalid-export`; no other reason is accepted for these helper guards.
  - Cover Requirements 1.1-1.4, 3.1-3.6, and 4.1-4.3.

## 2. Client root, module leases, and M3 compatibility

- [ ] 2.1 Add the finite client contract inventory and lease/diagnostic primitives.
  - Define the seven client descriptors with bare module ID, named constructor export, registered service name, exact direct-member kinds, `parentURL`, and three-argument import attributes.
  - Define each authoritative outward face from its public contract interface. For `commandUi`, the supported inventory is exactly `register`, `decorate`, and `popupFor`; concrete-class helpers such as `bindComposerFocus` are explicitly excluded and must have negative coverage. Apply the same negative-boundary rule to every leaf's non-contract concrete member.
  - Implement safe reason normalization, constructor identity validation, complete static member validation, cache-identity lease checks, and typed unavailable accessors without dynamic member discovery.
  - Freeze the client diagnostic mapping: absent `modules` loader -> `missing-service`; rejected import or non-object namespace -> `invalid-export`; absent constructor/member -> `missing-member`; wrong constructor/member kind -> `invalid-member`; absent provider -> `missing-service`; wrong provider identity -> `invalid-provider`.
  - Keep all governance labels out of runtime identifiers, messages, package metadata, and generated artifacts.
  - Cover Requirements 2.1-2.6, 3.1-3.6, and 4.1-4.3.

- [ ] 2.2 Refactor client publication to a Cordis `Service` root while preserving the delivered M3 contract.
  - Publish the root and all seven pending shells synchronously with `inject = []`; do not make root publication wait on `modules` or any optional import.
  - Preserve the existing M3 root brand, feature list names/order and `isActive` values, member identities, exact reapply disposer, cleanup ordering, connection/codec/remote/settings/slot fallback behavior, and VM bundle handoff.
  - Implement the pre-publication fallback and post-publication containment paths from Design without registering a competing provider.
  - Cover Requirements 2.1-2.5, 3.1-3.5, 5.1-5.3, and 6.1-6.3.

- [ ] 2.3 Add loader bootstrap, caller-scoped resolution, and lease race tests before wiring all leaves.
  - Use deferred `modules.import(specifier, parentURL, attrs)` fakes and assert synchronous root visibility, pending-shell behavior, per-leaf rejection containment, and no unhandled rejection.
  - Use Cordis service tracing with a child consumer context to verify each getter binds to the consuming context, calls `callerCtx.get()` directly, preserves the official receiver, and does not cache a caller composition.
  - Exercise cache invalidation without an invalidation event, disposal/reapply races, old-generation references, and no silent namespace rebinding.
  - Build the independence fixture with a raw `modules` service, seven valid RC.6 namespaces, and matching `modules.loadCache` identities, while deliberately omitting any M4-specific `client.modules` facade; assert all seven M5 leaves become active and forward real values.
  - Cover Requirements 2.3-2.6, 3.1-3.6, 5.1-5.3, and 6.1-6.3.

## 3. Seven client official service faces

- [ ] 3.1 Implement the input-trigger, command-UI, and model-directory leaves.
  - Expose only the inventory members for `inputTriggers`, `commandUi`, and `modelDirectories`, including live opaque controller/directory results and exact registration disposers.
  - Validate the exact named constructors and all required members atomically before activation; preserve caller scope, receiver, arguments, return values, and errors.
  - Add table-driven forwarding and malformed-provider/member tests for these three leaves, including sibling continuity.
  - Cover Requirements 2.1-2.5, 3.1-3.6, and 4.1-4.3.

- [ ] 3.2 Implement the conversation, conversation-events, and conversation-views leaves.
  - Expose conversation `input`/`blocks` live properties and the four Promise-returning methods with their official scope-addressed behavior.
  - Expose registry inherited `entries`/`subscribe` plus event registry `register`/`registerFallback`/`fallbackEntry` and view registry `register`, preserving ordered live entries and exact disposers.
  - Treat definitions, nodes, snapshots, listeners, and registry return values as official opaque/live values; do not recursively clone or freeze them.
  - Add forwarding, live-read, subscription, Promise/rejection, malformed-member, and sibling-continuity tests.
  - Cover Requirements 2.1-2.6, 3.1-3.6, and 4.1-4.3.

- [ ] 3.3 Implement the timer leaf with the complete RC.6 overload contract.
  - Forward callback `setTimeout`/`setInterval`, callback and Promise `timeout`, callback and async-iterator `interval`, and `throttle`/`debounce` with their exact returned disposer or `.dispose()` identity.
  - Preserve Fiber-owned cancellation semantics and explicitly avoid inventing a service-level `dispose()` member.
  - Add tests for callback cancellation, Promise completion/rejection behavior, iterator identity, wrapper disposal, receiver/argument forwarding, and absence of an undocumented service disposer.
  - Cover Requirements 2.1-2.6, 3.1-3.6, and 4.1-4.3.

- [ ] 3.4 Add cross-leaf contract and isolation tests.
  - Verify every listed member of all seven leaves and that unlisted provider members are not surfaced.
  - For each leaf, cover absent loader, rejected import, malformed namespace, missing/invalid constructor, missing/invalid provider, and missing/invalid required member.
  - Assert atomic disabling, typed surface-keyed errors, allowed safe reasons only, and continued availability of the other six leaves plus M3 faces.
  - Assert every excluded concrete member remains absent from the outward face, including `commandUi.bindComposerFocus`, and verify the fixed diagnostic mapping for each malformed condition rather than accepting an arbitrary allowed reason.
  - Cover Requirements 2.1-2.6, 3.1-3.6, 4.1-4.3, and 5.1-5.3.

## 4. Bundle, manifest, and integration wiring

- [ ] 4.1 Wire the host and client implementations into the public facade without expanding unrelated APIs.
  - Keep M4 implementation names, imports, guards, feature records, and lifecycle owners out of the M5 code path.
  - Keep `client.inject = []`, add no hard optional module injection, and ensure the new client descriptors are reachable only through the client facade.
  - Preserve host/client fail-safe outer boundaries and existing public facade behavior when all new surfaces are disabled.
  - Cover Requirements 3.1-3.5, 5.1-5.3, and 6.1-6.3.

- [ ] 4.2 Regenerate the official `lib/client.js` artifact using the repository's existing bundle workflow.
  - Regenerate from source rather than hand-editing the artifact; preserve the `window.__ModuleLoader__` handoff and the no-cross-plugin-runtime-import boundary.
  - Verify that the generated artifact contains the finite M5 descriptors, three-argument loader calls, Service root publication, and no governance tokens or official package value imports.
  - Update only generated output required by the source change and keep unrelated bundle churn out of the commit.
  - Cover Requirements 2.1-2.6, 3.1-3.5, 4.1-4.3, and 6.1-6.3.

- [ ] 4.3 Extend manifest and bundle regression tests.
  - Assert the client entry, immediate behavior, `inject = []`, existing M3 feature list, root brand, reapply/dispose identity, and VM loading behavior.
  - Assert no new package peer or hard injection is introduced solely for the optional client module loader.
  - Cover Requirements 2.1-2.6, 3.1-3.5, 5.1-5.3, and 6.1-6.3.

- [ ] 4.4 Reconcile package protocol metadata without taking ownership of the integration bump.
  - Read and assert that `package.json`, `packages/compaction-events/package.json`, `packages/session-title/package.json`, and `packages/full/package.json` remain mutually consistent at the current `0.1.0-rc.6-0.5` / `dsh.api 0.5` boundary while M5 is delivered; this task must not edit any package metadata.
  - Do not independently bump or partially bump any package. Record that the nine new public faces are protocol-affecting and that the combined M4/M5 integration boundary owns the next numeric minor decision; if that boundary has already advanced before execution, assert the actual committed boundary consistently instead of hard-coding a stale value.
  - Add a regression test that detects a main/auxiliary/full version or `dsh.api` mismatch and verifies that M5 itself leaves the negotiated package boundary atomic.
  - Cover Requirements 5.1-5.3 and 6.1-6.3.

## 5. Final reconciliation, governance, and verification

- [ ] 5.1 Add focused M5 independence and governance tests.
  - Mount valid M5 providers with the shared foundation while omitting M4-specific services and assert all available M5 surfaces operate.
  - The no-M4 fixture must provide the raw `modules` service, all seven valid RC.6 namespaces, and matching `loadCache` entries; it must omit M4's `client.modules` facade and assert all seven M5 leaves are active and truly forwarding, not merely that M3 remains alive.
  - Establish two separate M4 regression runs: (a) shared foundation + representative valid M4 implementation, with M5 absent; and (b) the identical foundation and M4 implementation with M5 present. Compare only these two runs for M4 `isActive` values, member and return identities, fallback behavior, reapply identity, disposer behavior, and lifecycle cleanup. M5 must not alter those observations.
  - Keep the no-M4 + M5 run independent from that comparison: it proves M5 works without M4, while the two M4-present runs prove M5 does not change M4.
  - Add source/artifact audits proving no M4-specific import, alias, feature dependency, package-file modification, dynamic undocumented member forwarding, or governance token leakage into implementation artifacts.
  - Assert only P11 and C26-C32 are implemented and no M4 feature-list assignment is renamed, duplicated, moved, or changed.
  - Cover Requirements 4.1-4.3, 5.1-5.3, and 6.1-6.3.

- [ ] 5.2 Run the complete verification matrix and resolve only in-scope failures.
  - Run focused M5 tests, the full `node --test` suite, `git diff --check`, generated-bundle checks, and official-package immutability checks.
  - Re-run lifecycle race tests after any integration fix and confirm no unhandled rejection or apply-time throw remains.
  - Record residual unsupported boundaries, including physically missing statically imported host peers, in the final delivery report rather than broadening scope.
  - Cover Requirements 1.1-6.3.

- [ ] 5.3 Update the approved feature registrations and commit the complete Stage 4 delivery.
  - Mark P11 and C26-C32 delivered in `docs/specs/plugin-api-features/feature-list.md` without changing M4 rows or their historical delivered notes.
  - Add the M5 feature to `AGENTS.md` Section 8 with its spec directory, scope, independent client lease/root constraints, and fail-safe boundary.
  - Update this task file and any required spec reconciliation notes, stage only task-relevant files, pass `git diff --check`, and create the final Stage 4 commit.
  - Cover Requirements 5.1-5.3 and 6.1-6.3.

## Requirements traceability

| Requirement acceptance criteria | Implementing/test tasks |
|---|---|
| 1.1-1.4 | 1.1-1.3 |
| 2.1-2.6 | 2.1-2.3, 3.1-3.4, 4.1-4.3 |
| 3.1-3.6 | 1.1-1.3, 2.1-2.3, 3.4, 5.2 |
| 4.1-4.3 | 1.1-1.3, 2.1, 3.1-3.4, 5.1-5.2 |
| 5.1-5.3 | execution precondition, 2.2-2.3, 4.1, 4.4, 5.1-5.3 |
| 6.1-6.3 | execution precondition, 4.1-4.4, 5.1-5.3 |
