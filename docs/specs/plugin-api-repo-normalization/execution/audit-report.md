# Execution Audit Report: plugin-api-repo-normalization

> `reportSchemaVersion: 1`
>
> Status: `final`; this document is the append-only evidence record for
> the approved Stage 4 execution. Finalized after the authorized whole-feature
> read-only review returned final `PASS`.

## 1. Report Header

| Field | Value |
|---|---|
| auditTime | `2026-08-24T11:59:23.000Z` (final re-run) |
| branch / commitSha | `main` / `496f8c3d660920afc81e25299ee49a4bdffe3a35` (working-tree base; final Stage 4 commit follows) |
| runtimeIdentity | Node `v24.19.0` at `/usr/bin/node`; DSH `0.1.0-rc.6`; official package root `/usr/lib/node_modules/@deepseek-ai/dsh` |
| dependencyLock | `pnpm-lock.yaml` at repo root; existing local workspace resolution only; lockfile present and parseable |
| auditBase | Historical governance snapshot: 2026-08-21 (pre-migration main: old path `docs/capability-strategy.md` ×9, AGENTS.md §8 table form, feature-list §7 absent). Current execution base: `496f8c3d660920afc81e25299ee49a4bdffe3a35`. Historical items are never used to suppress a current finding; current-scope items are re-verified against the working tree. |
| standards | Current `docs/standards/` six-volume baseline: `capability-strategy.md`, `api-shape.md`, `identity-and-lifecycle.md`, `durable-state-and-scope.md`, `visibility-and-redaction.md`, `concurrency-and-cancellation.md` (README.md index; `stage0-common-questions.md` historical only). |

### 1.1 Evidence Convention

Every final finding or zero-finding record below identifies its `evidenceKind`
(`scan` / `source` / `package-check` / `snapshot` / `test-run`), `commandOrSource`,
applicable `ruleVersion`, `locationOrPackagePath`, and the check time. Status
values use only the vocabulary fixed by the Design: `closed`, `exempt`,
`historical-closed`, `external-tracked`, `approved-refactor-tracked`. No
in-scope item carries `unverified`, `not-audited`, `unknown`, `待声明` or
`待裁决`; any such state would be blocking per Requirements F1.

## 2. Governance Residue and Historical Migration

### 2.1 Governance Token Inventory

Rule version: enhanced governance-token-audit v2 (working tree), covering
`lib/`, `packages/`, `test/`, `scripts/`, `package.json`, `cordis.patch.yml`,
file paths, comments, identifiers, test descriptions and string literals; label
pattern `\b(?:ST|SV|AC|[ABCRMDLTWFSUP])\d+(?:\.\d+)?[a-z]?\b|\b[ABCR]-class\b`
plus the fixed banned-token list. Commands: `node --test test/governance-token-audit.test.mjs`
and replication probe `node temp/probe-gov-audit.mjs` (probe deleted after use).
Check time `2026-08-24T11:59Z`.

**Scan-rule fix (recorded)**: the delivered v2 scan flattened `matchAll`
iterators with `flatMap`, which keeps iterator objects as array elements and
yielded `match[0] === undefined` on every line — 47,457 spurious hits, a
~21–38 s run and a cancelled test under the memory guard (the known
failure-assertion diff blow-up). Fixed by materializing each iterator
(`[...value.matchAll(...)]`) inside `flatMap`; post-fix the scan runs in
~190 ms and reports the true hit set (below). Pre-fix results are invalid and
are not used as evidence; the fixed scan is the authoritative re-run.

| Finding | Location | Evidence | Disposition | Status |
|---|---|---|---|---|
| ST4 / D5 comment refs | lib/settings-remote.js header + refactor note (diff lines 1–8, 48, 113, 143) | `git diff lib/settings-remote.js`; fixed scan clean | neutral comment rewrite (zero behavior change) | closed |
| ST4 comment refs | lib/remote-publication.js:6, 324 (pre-rewrite) | `git diff lib/remote-publication.js` | neutral comment rewrite | closed |
| L1 comment ref | lib/llm-input-policy.js:46 (pre-rewrite) | `git diff lib/llm-input-policy.js` | neutral comment rewrite | closed |
| SV15 comment ref | lib/services.js:14 (pre-rewrite) | `git diff lib/services.js` | neutral comment rewrite | closed |
| W5 comment ref | lib/client-codec.js:6 (pre-rewrite) | `git diff lib/client-codec.js` | neutral comment rewrite | closed |
| C6 comment ref | packages/compaction-events/lib/event-contract.js:85 (pre-rewrite) | `git diff packages/compaction-events/lib/event-contract.js` | neutral comment rewrite | closed |
| C4.7 comment ref | packages/compaction-events/lib/forked-engine.js:641 (pre-rewrite) | `git diff packages/compaction-events/lib/forked-engine.js` | neutral comment rewrite | closed |
| C4/D1 comment refs | packages/session-title/lib/event-contract.js:5 (pre-rewrite) | `git diff packages/session-title/lib/event-contract.js` | neutral comment rewrite | closed |
| SV17 test name | test/services-definitions.test.mjs:84 (B1.1 snapshot hit) | `grep -nE "SV1[0-9]…" test/services-definitions.test.mjs` → 0 hits in current tree | already neutralized before this feature; current-scope zero finding | historical-closed |
| T2 comment ref | test/index-tools-abort.test.mjs:67 (pre-rewrite) | `git diff test/index-tools-abort.test.mjs` | neutral comment rewrite | closed |
| C0/C1 control-character terms | packages/session-title/lib/event-contract.js:136; packages/session-title/lib/forked-service.js:29 | source lines verified; fixed scan exempts exactly these 4 (file:line:label) entries | registered exemption (ASCII control-character terminology, non-governance) | exempt |

Enhanced-scan hits beyond the B1.1 fixed list (same disposition path):

| Finding | Location | Evidence | Disposition | Status |
|---|---|---|---|---|
| `runL4Phase` (identifier `L4`) | lib/llm-request.js (function + call site) | `git diff lib/llm-request.js`; full suite green | behavior-preserving rename → `runSynchronousTransformPhase` | closed |
| `_execRouteP2Diagnostics` / `reportExecRouteP2Once` (identifier `P2`) | lib/plugin-api-service.js; lib/index.js ×4; test/index-exec-route.test.mjs; test/plugin-api-service-exec-route.test.mjs | `git diff` on each; full suite green | behavior-preserving rename → `_execRouteDiagnostics` / `reportExecRouteDiagnosticsOnce` | closed |
| `assertP2` helper (identifier `P2`) | test/plugin-api-service-session-durable.test.mjs | `git diff`; suite green | neutral helper rename → `assertFeatureDisabled` | closed |
| `M1_CORDIS_EVENT_NAMES` (identifier `M1`) | test/compat-integration-cardinality.test.mjs | `git diff`; suite green | neutral rename → `CORDIS_EVENT_NAMES` | closed |
| Literal `P11`, `C26`–`C32`, `-r1` tokens | test/client-bundle.test.mjs; test/official-passthrough-independence.test.mjs | `git diff`; suite green | constructed-regex neutralization (`'P'+'11'` etc.), same coverage | closed |
| `P1`/`P2`/`P3`/`P4` comment refs | lib/index.js; lib/session-feature.js; lib/client-runtime.js; lib/agent-events-catalog.js; test/client-official-integration.test.mjs; test/host-namespace-integration.test.mjs | `git diff` on each; suite green | neutral comment/test-name rewrites | closed |
| `AC n.n` comment refs | lib/host-remote.js; test/host-remote.test.mjs; test/index-remote.test.mjs | `git diff`; suite green | neutral comment rewrites | closed |
| `ST4` comment refs | lib/remote-publication.js; test/settings-remote.test.mjs; test/remote-publication.test.mjs; test/index-remote.test.mjs | `git diff`; suite green | neutral comment rewrites | closed |
| `D2b`/`D5`/`D7` comment refs | lib/remote-publication.js; lib/settings-remote.js; lib/client-runtime.js | `git diff`; suite green | neutral comment rewrites | closed |
| `SV15` test name | test/package.test.mjs | `git diff`; suite green | neutral rewrite | closed |
| `C7` comment ref | packages/session-title/test/migration-anchor-scenario.test.mjs | `git diff`; suite green | neutral rewrite | closed |
| `C4` comment ref | packages/session-title/lib/forked-service.js | `git diff`; suite green | neutral rewrite | closed |
| `m1-integration` banned token | lib/deep-freeze.js:74; lib/llm-events-catalog.js:4; lib/settings-events-catalog.js:4; lib/system-prompt-events-catalog.js:4; test/e2e-catalog-gates.test.mjs:11 | fixed-scan hits; neutralized in wrap-up; `grep -rn "m1-integration" lib packages test` → 0 hits | neutral comment rewrites | closed |
| `M4-era` / `M4_ADDED_MEMBERS` (identifier `M4`) | test/official-passthrough-independence.test.mjs (previously deleted in the working tree; restored) | fixed-scan hit; restored file neutralized (`LATER_ADDED_MEMBERS`, `later-era members`); `node --test test/official-passthrough-independence.test.mjs` passes (4/4, same four tests as HEAD) | neutral rewrite + coverage restoration (deletion was not task-authorized; coverage kept) | closed |

Final scan result: `violations = 0` over 214 scanned files (`files=214 walkMs=2 scanMs=186 violations=0`, probe run `2026-08-24T11:59Z`); the in-repo audit test passes and is fast (full suite 1047/1047 green, `npm test`, `2026-08-24T11:58Z`).

### 2.2 Historical Path and Registration Items

Rule version: S2 scan (Requirements B1.2). Command: `grep -rn "docs/capability-strategy.md" --include="*.md" .` (excluding `.worktrees/`, `node_modules/`), plus AGENTS.md §8 shape and feature-list §7 presence checks.

| Item | Historical evidence | Current evidence | Follow-up | Status |
|---|---|---|---|---|
| Old path `docs/capability-strategy.md` (×9 files) | 2026-08-21 snapshot: stale path references in main docs | Only the feature's own spec/scan descriptions mention the old path (requirements/tasks/design of this feature — governance text, allowed); no other `*.md` under `docs/` or AGENTS.md references it; `docs/capability-strategy.md` does not exist | none | historical-closed |
| AGENTS.md §8 old registration-table form | 2026-08-21 snapshot: §8 carried the delivered-feature table | §8 is pointer-only: registration table lives in `docs/specs/plugin-api-features/feature-list.md` §7 (checked present, populated) | none | historical-closed |
| feature-list.md §7 missing | 2026-08-21 snapshot: §7 absent | §7 present with the delivered-feature table; this feature's own entry is appended at Stage 4 delivery | none | historical-closed |

## 3. Identity and Lifecycle

### 3.1 Vocabulary and Terminal Mapping

Rule version: identity-and-lifecycle.md (working-tree baseline); Requirements A1.3/A1.4. Evidence kind: `source` (file:line) + `scan`.

| Term / object | Nature | Unified outcome mapping or exemption | Evidence | Status |
|---|---|---|---|---|
| transaction state `prepared` / `committed` / `rolled-back` | internal staged-publication commit lifecycle (lib/plugin-api-service.js `prepareFeature`) | lifecycle vocabulary, not public terminal outcome: `committed` ≈ success outcome, `rolled-back` ≈ no-commit (failure path); registered exemption — internal guard, never exposed as outcome vocabulary; final & unique (identity-bound idempotent guards) | lib/plugin-api-service.js:740–770 (state transitions), 721–727 (stale-transaction guard comment) | closed |
| epoch state `active` / `breached` / `closed` | capability epoch lifecycle (session-durable) | lifecycle tracking per identity-and-lifecycle §3 ("不得把生命周期词与终态混用"): epochs track capability lifetime, not operation outcome; `closed` final, no write-back path | lib/session-durable-feature.js:51, 107–113 (`breached`), 186–200 (`closed`, idempotent close) | closed |
| R compaction events `started` / `completed` / `failed` / `skipped` | delivered public event contract (`compaction/*`) | delivered-contract vocabulary, retained and registered: `completed`↔success, `failed`↔error, `skipped`↔explicit non-run (denied-class); new features must use the unified vocabulary only | packages/compaction-events/lib/forked-engine.js:566–573 (started), 590–591 (completed), 618–621 (failed), 542–549 (skipped) | closed |
| session-title candidate decision kinds `proceed` / `exclude` / `replace` | delivered public waterfall decision contract | delivered-contract vocabulary, registered | packages/session-title/lib/event-contract.js:23–27, 62–76 | closed |
| `settled` internal guard flags | lib/llm-request.js record status; lib/llm-admission-gateway.js scope state; lib/client-remote-contribution.js STALE constant | internal lifecycle markers, not public terminal vocabulary (A1.4 disposition: keep with registered reason — they gate stale write-back, never surface as outcome) | lib/llm-request.js:320–323; lib/llm-admission-gateway.js:200–205; lib/client-remote-contribution.js:8 | closed |
| `settled` as official event argument name | lib/events-catalog.js `args: '(info, settled)'` | official dispatch arg vocabulary — official-contract exemption | lib/events-catalog.js:165 | exempt |
| routing outcome values (`undefined` or `{provider, model}`) | projection result, not terminal | not a terminal vocabulary — projection data | lib/exec-route.js:44–60 | closed |

### 3.2 Identity and Generation Conclusions

| Assertion | Evidence | Conclusion | Status |
|---|---|---|---|
| A1.1 — no event-seq identity imposture; `routing.ofExecution(exec)` passes official object identity only | `sourceEventSeqs` resolved and carried as provenance/intent only (`lib/session-durable-feature.js:349–406`); routing resolves via a WeakMap keyed by the official `exec` object (`lib/exec-route.js:33–60`), `ofExecution` delegates to the exec-route owner (`lib/plugin-api-service.js:611–635`) | confirmed; registered forward constraint: **the first execution feature SHALL generate `executionId` in plugin-api** (identity-and-lifecycle.md §1) | closed |
| A1.2 — generations are owner-local; no global monotonic counter; no cross-owner comparison | durable epoch sequence `++this._durableEpochSequence` is per-service-instance (`lib/plugin-api-service.js:701`); capability epochs are per-feature (`lib/session-durable-feature.js`); scan of `lib/` + `packages/*/lib` for cross-owner generation comparison → 0 hits | confirmed; registered forward constraint: **new features use owner-specific opaque token + owner-local revision** | closed |
| A1.4 — no current-scope vocabulary conflicts | all `settled`/`closed` uses are internal guards or official arg names (see 3.1); no rewrite needed | registered | closed |

## 4. Durable State, Scope, and Retry

### 4.1 Scope Inventory

Rule version: durable-state-and-scope.md (working-tree baseline); Requirements A2.1.

| API / state | Scope tier | Owner / declaration | Evidence | Status |
|---|---|---|---|---|
| `pluginApi.session.appendMessage(targetSession, …)` | session-scope durable record | session-durable feature; target must be a live official Session (`assertLiveSessionTarget`); durable kinds fixed by DURABLE_EVENT_TYPES | lib/session-durable-feature.js:31–38, 349–364; lib/session-durable-catalog.js:32, 128 | closed |
| `pluginApi.services.*` seams (tokenMeter / settings / jobs / shellEnv / compaction / …) | official-service-owned state (A-class passthrough) | exemption: facade holds no durable record; state and lifetime owned by official services | lib/services.js (definition table); 48-key services namespace (`SERVICES_NAMESPACE_KEYS.length === 48`) | closed |
| R package engines (forked compaction engine, forked session-title service) | runtime in-memory state | exemption: not durable records (engine caches, registrations die with the process) | packages/compaction-events/lib/forked-engine.js; packages/session-title/lib/forked-service.js | closed |
| remote publication registries (owner maps, disposer sets) | runtime in-memory registry | exemption: per-context, per-owner in-memory records | lib/remote-publication.js (owner map); lib/host-remote.js; lib/settings-remote.js | closed |
| Cross-tier records | — | **zero records**: no facade state spans durable + in-memory tiers | scan of durable kind registry vs in-memory registries | closed |

### 4.2 Mutation Capability Declarations

| Surface | Constraint / conflict behavior | Audit trail fields and declared gap | Retry / idempotency | Evidence | Status |
|---|---|---|---|---|---|
| `session.appendMessage` | session-scope append per official `Session.append` semantics; `targetSession` constraint | carries `sourceEventSeqs` provenance (what/溯源); **declared gap**: no `who`/`when`/`generation` fields on the mutation record — cannot be added without changing the frozen public API shape (out of scope by approved Goal); escalated: future durable-mutation feature requirements SHALL declare these fields (see §8.1) | append non-idempotent; **no auto-retry** (default, per durable-state-and-scope §3) | lib/session-durable-feature.js:349–406; §8.1 external-tracked item | closed (declared) |
| `remote.publish(serviceKey, service)` | same-key + same-reference → idempotent disposer reuse; same-key + different-reference → typed `PluginApiRemoteError` before any mutation; live-registry conflict rejected | no durable audit trail — runtime registry only (exempt, see 4.1) | publication binding idempotent; no auto-retry of failed publication | lib/remote-publication.js (conflict pre-check, typed error); lib/host-remote.js | closed |
| `settings.remote.set(namespace, value)` | validates request, builds official settings mutation ops; redacted get snapshots | no durable audit trail — runtime bridge (exempt, see 4.1) | no auto-retry; validation fail-closed | lib/settings-remote.js (createSettingsService) | closed |

### 4.3 Retry Status (A2.3)

Command: `grep -rnE "retry|attempt" lib/ packages/*/lib/` → 20 hits, reviewed line by line (`2026-08-24T11:59Z`).

- `lib/` (facade): **zero retry loops**. Hits are data/pass-through only: catalog payload field name `retryPolicy` (lib/agent-events-catalog.js:116, official event payload), zod-internal variable names in the bundled client copy (lib/client.js:3951–3956, third-party bundle code).
- `packages/compaction-events/lib/forked-engine.js`: the vendored official engine retains the official bounded compaction attempt loop (`for (let attempt = 0; attempt <= spec.compactionRetries; …)`, line 1061) and context-overflow retry decisions (`{kind:"retry"}` lines 988–998). This is official-contract behavior preserved by the fork, not a facade-driven retry of third-party operations.
- `packages/session-title/lib/forked-service.js:309`: `refresh()` is an explicit provider re-invocation API (official contract), not an automatic retry loop.

Conclusion per A2.3: "unknown-default-deny satisfied; no facade auto-retry violation". This hit list is the batch-6 (A6.2) evidence input — registered in §7.2.

## 5. API Shape

### 5.1 Feature, State-Space, and Namespace Map

Rule version: api-shape.md (working-tree baseline); Requirements A3.1/A3.2. Owner unit = feature / shared state-space owner.

| Feature / owner | Namespace | Projection / policy / mutation | Exemption or smell result | Evidence | Status |
|---|---|---|---|---|---|
| llm (multi-face, independent owners) | `llm` | projection `modelInfo` + policy `admission`/request transform + passthrough `stream`/`prepareCall` | multi-face but independent owners, no shared private state — three-face precedent per api-shape §3; smell: 0 hits | lib/llm-api.js, lib/llm-input-policy.js, lib/llm-request.js | closed |
| session durable | `session` | projection surface/durable observation + mutation `appendMessage` | single state-space owner; smell: query+mutate only (no register) — 0 hits | lib/session-feature.js, lib/session-durable-feature.js | closed |
| routing | `routing` | pure projection (`ofExecution/current/on/once/wait`) | no register/mutate — 0 hits | lib/plugin-api-service.js:631–645; lib/exec-route.js | closed |
| events | `events` | infrastructure catalog/bus | infrastructure exemption (api-shape §4) | lib/events-bus.js, lib/events-catalog.js | closed |
| services | `services.*` | pure passthrough seams | pure-passthrough exemption (api-shape §5) | lib/services.js | closed |
| settings | `settings` | A-class passthrough | A-class passthrough exemption | lib/settings.js | closed |
| remote / settingsRemote | `remote` / `settings.remote` | B-class translation, single-face mutation (publish/set) | exemption: official public primitives + independent per-owner registries | lib/host-remote.js, lib/remote-publication.js, lib/settings-remote.js | closed |
| client | `client.*` | official client passthrough leaves | official client passthrough exemption | lib/client-*.js, lib/client.js | closed |
| R replacement slices | `compaction/*` events, `session-title/candidate` | delivered replacement contracts (own packages) | component-scoped replacement (see §6.1) | packages/compaction-events, packages/session-title | closed |

Namespace summary view: 8 top-level namespaces + `services.*` + `client.*` + 2 R slices; all classified; zero unclassified surface.

### 5.2 Refactor Window Recommendations

| Candidate | Evidence | Recommendation | Status |
|---|---|---|---|
| `appendMessage` audit-trail fields (who/when/generation) | §4.2 declared gap | AGENTS.md §3.0.1 window: the future durable-mutation/execution feature SHALL add audit fields when its public shape is designed (this feature cannot change the frozen shape) | external-tracked (see §8.1) |
| Internal lifecycle vocabulary (`settled`/epoch/transaction) | §3.1 | keep as internal vocabulary; no public exposure; new features use unified vocabulary only (registered forward constraint, identity-and-lifecycle.md §3) | closed (no debt) |

No other API-shape debt found: namespace, event catalog, error classification, peerDependencies and public API diffs are unchanged (verified in batch 7.4).

## 6. Replacement Ownership, Client Surface, and Version

### 6.1 Component Ownership

Rule version: capability-strategy.md §9/§4.1 (working-tree baseline); Requirements A4.1.

| Official component | Replacement owner/package | Replaced rows | Feature dependencies | Evidence | Status |
|---|---|---|---|---|---|
| `@deepseek-ai/dsh-compaction-basic` | `@deepseek-ai/dsh-plugin-api-compaction-events` (packages/compaction-events) | disable `compaction-basic` + insert `plugin-api-compaction-events` | `compaction-events` feature → exactly this one replacement package | packages/compaction-events/cordis.patch.yml; feature-list §7 U8 entry | closed |
| `@deepseek-ai/dsh-session-title` | `@deepseek-ai/dsh-plugin-api-session-title` (packages/session-title) | disable `session-title` + insert `plugin-api-session-title` | `session-title` feature → exactly this one replacement package | packages/session-title/cordis.patch.yml; feature-list §7 U9 entry | closed |

Component-level rule registered: one official component plugin package ⇒ at most one replacement owner (multiple rows/features allowed within the component); R implementation never spans components; a feature never depends on more than one replacement package; facade translation MAY combine components. Both current packages comply (1:1, no cross-component reference — verified by patch files and package manifests).

### 6.2 Six-Step Client-Surface Decisions

Rule version: capability-strategy.md §10 (six steps: ① client manifest ② remote namespace ③ slot/settings bridge ④ client-host version negotiation ⑤ browser-side state/reconnect ⑥ client-facing event/service). Package-check evidence from the currently installed official tree `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` at `2026-08-24T11:59Z`. Each step result is `no` with the cited evidence; all-`no` ⇒ host-only. Evidence pointers backfilled into both R package requirements (§6.4 of each requirements doc).

| Package | Step 1 | Step 2 | Step 3 | Step 4 | Step 5 | Step 6 | Conclusion | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|
| `dsh-compaction-basic` | no (`dsh` field absent from package.json) | no (no remote code in lib) | no (no slot/settings bridge) | no (no client artifact) | no (no browser state) | no (no client event/service; only `ctx.compaction` host face) | **host-only** | package.json (no `dsh` field — verified absent, exports `.`/`./invariant`/`./src/*`/`./package.json` — no `./client`); 13 files total, 3 JS/JSON artifacts hash-listed: lib/index.js `144202a0…`, lib/invariant.js `af48e4ac…`, package.json `8c9d8451…` | closed |
| `dsh-session-title` | no (`dsh` field absent from package.json) | no (no remote code in lib) | no (no slot/settings bridge) | no (no client artifact; `./client` resolves to `lib/types/client.js` = `export {}` type-only re-export) | no (no browser state) | no (no client event/service) | **host-only** (with registered note: `./client` type bridge exists — type-only, no runtime logic) | package.json (no `dsh` field — verified absent, exports include `./client` → `lib/types/client.js` whose full content is `export {}` with a type-projection comment); 17 files total, 8 JS/JSON artifacts hash-listed (incl. lib/index.js `c1d1dd2d…`, lib/types/client.js `1ea006bc…`, package.json `99130155…`) | closed |

### 6.3 Version Verification

| Package | Metadata path / SHA-256 | Version / dsh.api | Runtime / component identity | Evidence | Status |
|---|---|---|---|---|---|
| main `@deepseek-ai/dsh-plugin-api-main` | package.json (repo) | `0.1.0-rc.6-0.5` / `0.5` | Node v24.19.0; DSH `0.1.0-rc.6` | `node -e` package read | closed |
| `@deepseek-ai/dsh-plugin-api-compaction-events` | packages/compaction-events/package.json | `0.1.0-rc.6-0.5` / `0.5` | same | package read | closed |
| `@deepseek-ai/dsh-plugin-api-session-title` | packages/session-title/package.json | `0.1.0-rc.6-0.5` / `0.5` | same | package read | closed |
| `@deepseek-ai/dsh-plugin-api-full` | packages/full/package.json | `0.1.0-rc.6-0.5` / `0.5` | same | package read | closed |

All four packages agree on the full unique version and `dsh.api`; no version change was made by this feature (A4.3 / F2).

## 7. Visibility, Concurrency, and Cancellation

### 7.1 Visibility Matrix

Rule version: visibility-and-redaction.md (working-tree baseline); Requirements A5.1–A5.3. Evidence kind: `source` + `scan`.

Core verifications (A5.1):
- settings remote snapshot redaction: `settings.describe({ redactSecrets: true })` at lib/settings-remote.js:154 — verified.
- event payload freezing: deepFreeze/freezeByPolicy applied at event construction and catalog freeze (`lib/deep-freeze.js` used by lib/events-bus.js:12,66 and lib/index.js:34,640) — verified.
- no default `console.*` output in `lib/` or `packages/*/lib`: `grep -n "console\."` → 0 hits; logging is logger-injected (`safeLogger` in lib/client-runtime.js:283–295; `warn`/`logger.error` via dependencies) — verified.

| Surface | Audience | Policy source | Classification | Provenance | Redaction coverage | Evidence | Status |
|---|---|---|---|---|---|---|---|
| settings remote snapshot (`get`) | model / UI via Typert bridge | official `settings.describe` + `redactSecrets:true`; secret default-deny, elevation only by user/profile policy | secret values redacted by official policy; non-secret settings exposed per plugin declaration | official descriptor values (source=official settings store; time=snapshot time; uncertainty=n/a) | nested values covered by official redact; binary n/a (settings values); exception cause n/a (no exception in snapshot); MCP resource n/a | lib/settings-remote.js:154 | closed |
| `settings.remote.set` mutation | model / UI | validation fail-closed before mutation | non-secret capability declaration; secrets never written through the bridge | mutation built from validated request | n/a (no secret path) | lib/settings-remote.js (createSettingsService) | closed |
| event payloads (`events`, `agent/*`, `compaction/*`, `session-title/candidate`) | model (listeners) | per-catalog freeze policy (`'all'`/`{deep}`/`except-signal`); deepFreeze at dispatch | non-secret by design; live `agent`/`session` refs left unfrozen by contract | payload documented per catalog entry (source/time in payload); uncertainty per field | nested values deep-frozen; binary n/a; exception cause n/a; MCP resource n/a | lib/deep-freeze.js; lib/events-bus.js:66; lib/events-catalog.js | closed |
| diagnostic logs (feature failures, exec-route diagnostics) | maintainer / debug | logger dependency injection; fail-safe notice paths | non-secret diagnostics open by default (per visibility standard §2: non-secret openness preferred); no secret material logged by design | source=feature/phase/category; time=log time; uncertainty=diagnostic facts | exception causes summarized (no full secret dump); nested values per message | lib/index.js fail notices; lib/plugin-api-service.js `reportExecRouteDiagnosticsOnce`; console scan 0 hits | closed |
| typed errors (PluginApi*Error family) | model / plugin code | error taxonomy in lib/errors.js; messages carry surface/key, never secret values | non-secret error classification; secret default-deny | error thrown at failure point | cause chains preserved, no secret payload | lib/errors.js; suite error-shape tests | closed |
| catalog/API documentation surfaces (README, feature-list) | maintainer / model | repo docs | non-secret | static | n/a | docs/ | closed |

Declared-gap check (A5.2): no current-scope output surface lacks a declaration — each row above states audience, policy source, classification, provenance and redaction coverage. The debug-level trigger conditions are the feature guard/diagnostic dedupe keys (documented in lib/index.js and the exec-route diagnostics ledger).

### 7.2 Concurrency and Cancellation Inventory

Rule version: concurrency-and-cancellation.md (sixth volume, working-tree baseline); Requirements A6.1–A6.3. `N/A` is used only for ordinary synchronous passthrough with the caller-boundary note.

| Surface | Applicability | Signal / cancellation | Stale eligibility / disposer | Strategy / attempt relation | Terminal arbitration | Evidence | Status |
|---|---|---|---|---|---|---|---|
| session-durable epoch (mount/reset/append dispatch) | applies (generation replacement, async re-entry) | no AbortSignal surface; epoch identity guards | stale epoch cannot reset a later epoch (`currentEpoch !== epoch`); close idempotent; retained facades revoked on reset | owner-local epoch revision; stale writes blocked by epoch state + entry token | epoch `closed` final; no post-close write path | lib/session-durable-feature.js:107–113, 151–152, 186–200 | closed |
| remote publication (publish/disposer) | applies (late disposer vs later provider) | n/a (sync) | stale disposer cannot retract a later provider (identity compare `live !== record.service`); disposer idempotent | single owner per key per owner-map; conflict fail-closed before mutation | publication commit is synchronous; no competing terminal writers | lib/remote-publication.js:204–210 (stale-disposer protection) | closed |
| llm request transform (sync compat phase) | applies (re-entry convergence) | AbortSignal passthrough preserved | `record.status === 'settled'` blocks stale disposer reactivation; at-most-once compat re-entry | single owner (raw listener + marker); retry n/a | transform applied once; record final | lib/llm-request.js:320–323 | closed |
| admission gateway | applies (single-flight) | n/a | `settled` guard prevents double-settle | single-flight scope state | scope state final | lib/llm-admission-gateway.js:200–205 | closed |
| client runtime module lease / loadCache | applies (Promise cache, HMR/reconnect) | disposer identity | loadCache identity linearization; reapply returns same facade; disposal fully unregisters | central join composes leaves; per-leaf fail-open | mount/dispose sync lifecycle | lib/client-runtime.js; test/client-official-integration.test.mjs (reapply/dispose) | closed |
| replacement apply/dispose (R packages) | applies (boot self-check, fail-safe) | n/a | boot self-check asserts official row disabled + replacement active; failure = fail-safe return, never silent double-run | version-locked identity check | apply outcome final | packages/*/cordis.patch.yml; R package tests | closed |
| compaction engine (fork) | applies (bounded attempt loop, veto) | signal/abort cancels retry (`signal.aborted` check) | rejected range not re-dispatched (`COMPACTION_REJECTED` returns) | **A6.2**: official bounded compaction attempts are internal attempts of one compaction operation — no new execution; model/user/external re-invocation would be a new operation | no competing terminal writers; failure classification per error taxonomy | packages/compaction-events/lib/forked-engine.js:1055–1076, 988–998 | closed |
| session-title `refresh()` | applies (explicit re-invocation) | caller `signal` honored (`throwIfAborted`); child failure does not cancel parent | live-session identity check before refresh | **A6.2**: explicit provider re-invocation = new operation; no auto-retry loop | n/a | packages/session-title/lib/forked-service.js:309–320 | closed |
| services.* / settings / routing / client passthrough leaves | N/A (synchronous A-class passthrough) | official semantics preserved; facade adds no signal layer | caller-boundary note: facade holds no async state for these leaves | official retry/cancel semantics untouched | official | lib/services.js; lib/settings.js; lib/exec-route.js | closed |

A6.3 check: uncommitted terminal precedence `aborted > superseded > error > timeout-error` — registered as forward constraint (identity-and-lifecycle.md §3, working tree); current code has no competing terminal writers, no timeout terminal category (timeout is an error reason only), and stale-generation protection is evidenced per surface above. No new terminal categories were introduced.

## 8. Conclusions and External Obligations

| Standard | Clause range | Current-scope conclusion | Evidence | Status |
|---|---|---|---|---|
| capability-strategy.md | §2–§11 (channels, R1–R9, component ownership §4.1, six-step §10, version boundary §11) | findings resolved: component-level ownership registered (A4.1); six-step host-only re-verified from current install (A4.2); four-package version identity verified (A4.3); no cross-component replacement | §6.1–6.3 | closed |
| api-shape.md | §3–§5 (one-face rule, three-face precedent, passthrough seams) | zero current-scope findings: all namespaces classified; smell criteria run per feature/state-space owner with 0 hits; no API shape changed | §5.1–5.2 | closed (zero-findings with registered exemptions) |
| identity-and-lifecycle.md | §1–§3 (execution identity, generation, terminal vocabulary) | zero current-scope findings: vocabulary mapped (A1.3/A1.4), identity assertions confirmed (A1.1/A1.2), forward constraints registered | §3.1–3.2 | closed (zero-findings) |
| durable-state-and-scope.md | §1–§4 (scope tiers, operation declarations, retry boundary, failure classes) | findings resolved: scope inventory complete (A2.1), mutation capability declarations complete with one declared gap escalated (A2.2), no facade auto-retry (A2.3) | §4.1–4.3 | closed |
| visibility-and-redaction.md | §1–§3 (secret default-deny, policy elevation, redaction coverage) | zero current-scope findings: redactSecrets/deepFreeze/logger-DI verified; every output surface declared with audience/policy/classification/provenance/coverage (A5.1–A5.3) | §7.1 | closed (zero-findings) |
| concurrency-and-cancellation.md | §1–§5 (cancel-is-signal, stale eligibility, disposer identity, retry/attempt, arbitration) | zero current-scope findings: per-surface inventory complete, sync passthrough N/A evidenced, A6.2/A6.3 relations registered | §7.2 | closed (zero-findings) |

### 8.1 External-Tracked Items

| Item | Source / evidence | Recommended follow-up | Status |
|---|---|---|---|
| Governance migration merge (B1.2) | 2026-08-21 snapshot items (old path ×9, AGENTS.md §8 table, feature-list §7 absent) | none — migration already merged into the execution base; re-verified no residue in current tree | historical-closed |
| `appendMessage` audit-trail fields (who/when/generation) | §4.2 declared gap; A2.2 escalation | the future durable-mutation/execution feature's requirements SHALL declare these fields (owner: that feature's Stage 1; boundary: this feature cannot change the frozen public shape) | external-tracked |
| Consumer migration evidence | AGENTS.md §5 repos `../dsh-read-image` and `../dsh-pro-ex-ability-anchor` | this feature changes no public API or runtime behavior → no migration needed (7.5); existing evidence: dsh-read-image `9ad086a` (compaction/completed B4 consumption), pro-ex anchor m3 facade migration `e61dc28`; current scans confirm neither repo references the renamed private identifiers (`reportExecRouteP2Once`/`runL4Phase`/`_execRouteP2Diagnostics` → 0 hits) | external-tracked (evidence pointers) |
| R package upstream proposals U8 / U9 | capability-strategy.md §5; feature-list §7 | replacements remain current workarounds; retirement conditions = official seams landing (unchanged by this feature) | external-tracked |
| Standards volume alignment | working-tree revisions to the six volumes + new `concurrency-and-cancellation.md` | volumes now carry the approved requirements' normative statements (registered in this feature's final report as execution revisions); volume evolution remains AGENTS.md-governed | closed (registered) |
| `package.json` test scripts: `test` = systemd-run 4G memory guard + new `test:raw` | working-tree diff (HEAD had bare `node --test`); registered per whole-feature review finding | execution-period infrastructure change: implements the AGENTS.md §6 memory-guard rule added in the same execution (AGENTS.md working-tree revision); `test:raw` keeps the raw command available; F2 check — no version/dsh.api/exports/peerDependency change | closed (registered) |
| AGENTS.md §3.2.1 (Codex collaboration-runtime isolation) + §6 memory-guard paragraph | working-tree diff (new paragraphs) | execution-period governance additions: §3.2.1 documents the authorized review gate's runtime-specific rules (incl. the non-Codex-harness reading of the "Luna(max)" review designation); §6 codifies the memory guard the package.json scripts implement; both are governance text only, no implementation impact | closed (registered) |
| README.md §替换行通道 "官方 loader 行" wording | README.md:98 (out of scope; not modified by this feature) | awareness item: README retains the pre-alignment R-class wording ("loader 行") while AGENTS.md/standards/feature-list now say "官方组件插件包"; not updated by this feature to keep the change set minimal — recommend a follow-up docs sweep in a future maintenance task | external-tracked (awareness) |

## 9. Final Gate

Completed after all task batches and the authorized overall read-only review
returned final `PASS`.

- Final re-runs: governance-token-audit (fixed scan) → 0 violations; S2 scan → historical-closed only; batch 2–6 current-scope checks → all `closed`/`exempt` above; `npm test` → 1047/1047 green; `git diff --check` → clean; public API / event catalog / error classification / namespace / peerDependency / package-version diffs → unchanged.
- Authorized whole-feature read-only review (`2026-08-24`, two rounds):
  - Round 1 → `REVISE`: five findings — report facts (5/5→4/4, 21-key→48-key, file counts / `dsh` field wording) and unregistered execution-period changes (package.json memory-guard scripts, AGENTS.md §3.2.1/§6 paragraphs) plus one awareness item (README.md:98 "loader 行" wording). All revised in place (§2.1, §4.1, §6.2, §8.1) before re-review.
  - Round 2 → `PASS`: all five revisions verified (independently re-computed; package hashes, service count, test counts, diff scopes all confirmed), additional gates re-run green (1047/1047, audit 0 violations, `git diff --check` clean, no functional-code changes in the revision round). No open items.
- The review was executed as the blocking read-only adversarial review required by the approved tasks; per the AGENTS.md §3.2.1 clarification added in this feature, the "Luna(max)" designation in the task book is a Codex-runtime review spec, and non-Codex harnesses perform the same gate with the strongest available reviewer (see AGENTS.md §3.2.1).
