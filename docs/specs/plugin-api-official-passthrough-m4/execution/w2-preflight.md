# W2.1 Preflight Record — plugin-api-official-passthrough-m4

## Inputs

- Tasks baseline (approved): `aba739f92f1d1f11a53b95788e0cb8ca800d7805`
- W0 contract boundary commit: `f5acd11645f9c16b6307d14462e5ca8d0d2e15c6`
  (`fix(m4): keep W0 service construction static`)
- Integration worktree: `.worktrees/plugin-api-official-passthrough-m4`
- Integration branch: `codex/plugin-api-official-passthrough-m4`

## W1 Wave State

| W1 batch | Commit | Worktree | Blocking review result |
|---|---|---|---|
| host namespaces | `87082b1` | `.worktrees/plugin-api-official-passthrough-m4-host-namespaces` | Approved per `w1-host-namespaces.md`; final Luna(max) review closed after repair rounds; 12 focused tests, `git diff --check` clean |
| host events | `76fd8c1` | `.worktrees/plugin-api-official-passthrough-m4-host-events` | Approved per `w1-host-events.md`; final Luna(max) review closed (evidence-only revision recorded); 10 focused tests, `git diff --check` clean |
| service fragment | `df0c0a7` | `.worktrees/plugin-api-official-passthrough-m4-services` | Approved per `w1-services.md`; Luna(max) review closed without deviation; 6 focused tests + 34 regression tests, `git diff --check` clean |
| client leaves | `40eb88a` | `.worktrees/plugin-api-official-passthrough-m4-client` | Approved per `w1-client.md`; final review found one substantive gap (`sessionLogDownload.store` value classification), fixed in `40eb88a`, repeat review PASS; 29 focused tests, `git diff --check` clean |

All four W1 worktrees were verified clean (`git status --short` empty) before
this preflight. Provenance: each batch's initial status snapshot and final
write-set audit are recorded in its unique execution record; no untracked or
generated files remained in any W1 worktree.

## Scope and Write-Set Audit

Per-branch `git diff --name-only f5acd11..<tip>` equals exactly the allowed
write set declared in Tasks items 2–5:

- host namespaces: `lib/official-host-namespaces.js`,
  `test/official-host-namespaces.test.mjs`, `w1-host-namespaces.md`
- host events: `lib/official-host-events-catalog.js`,
  `test/official-host-events-catalog.test.mjs`, `w1-host-events.md`
- service fragment: `lib/official-service-definitions.js`,
  `test/official-service-definitions.test.mjs`, `w1-services.md`
- client leaves: the three `lib/client-official-*.js` modules, the three
  `test/client-official-*.test.mjs` modules, `w1-client.md`

Frozen-file compliance: re-checked mechanically with `git diff --name-only`
against the frozen list in Tasks (all event-bus/freeze/catalog/compose/feature
files, `lib/index.js`, `lib/plugin-api-service.js`, `lib/client.js`,
`lib/client-runtime.js`, `lib/guards.js`, `lib/services.js`, index tests,
manifests, Requirements/Design/Tasks, and all M4 execution records except the
worker's own): **no W1 branch touched any frozen file**.

## Pairwise Merge Simulation

`git merge-tree --write-tree -m <edge>` for every pairwise W1 edge:

- namespaces ↔ events — clean
- events ↔ services — clean
- services ↔ client — clean
- namespaces ↔ client — clean
- events ↔ client — clean
- namespaces ↔ services — clean

No conflict on any edge; all W1 branches share the single W0 commit as their
common base.

## Neutral Vocabulary Audit

Governance-token scan over all W1 runtime/test modules and this record
(feature-list IDs, classification letters, milestone labels, `r1` suffixes): no
governance identifiers appear in runtime code, test identifiers, fixture data,
error messages, or execution records' implementation descriptions.

## Guard / Failure Mapping

Approved P1–P4 remain the only failure presentation paths:

- P1 inactive root facade — `PluginApiInactiveError` (leaf `active` input is
  bound to `service.isActive` at integration time; root-inactive tests
  exercise the leaf gate).
- P2 disabled feature — `PluginApiFeatureDisabledError` with the owning
  namespace feature name (`llm`, `agent`, `session`, `tools`, `systemPrompt`,
  `settings`) for malformed/missing approved members at call time.
- P3 optional service unavailable — `PluginApiServiceUnavailableError` with
  `service === 'settings'` for the settings optional lookup path (approved
  ST9 split: optional service lookup is P3/fail-open, malformed member is
  P2/local).
- P4 per-service / per-client-leaf disabled facade — unchanged; the approved
  client-leaf P4 wording extension is recorded in `w2-decisions.md`.

## Negative-Boundary Check (Requirements / Design / Tasks)

- L11/L12 exact whitelist: six LLM runtime methods and exactly three public
  artifacts (`contentHasImage`, `createUserMessage`, `BlockAssembler`); no
  other same-package artifact is implied (approved L12 scope correction).
- A12/A13: five initiator/ownership methods and a frozen exact-key
  `{provider, model, maxTokens}` snapshot incl. `undefined` values; no live
  agent/session/context state is exposed (approved A13 scope correction).
- S7/S8: store methods delegate to `ctx.sessions`; `deriveEventMessage`
  delegates to the official public session export; no synthetic durable event,
  projection, or replay is added (see `w2-decisions.md` for the S8 source
  decision).
- T12/T13: `executionMode` reads the official tools runtime member; `defineTool`
  delegates the official `dsh-tools` public export; both degrade P2
  (`tools`) locally and do not reimplement execution.
- P9: `assemble` delegates the official service method; P10 event-waferfall
  semantics are excluded from W2.1 and owned by W2.5.
- ST9: `writable`/`prepareDocument`/`get`/`update`/`replace`/`mutate` follow
  the approved P3/P2 split and do not affect existing settings
  registration/events or unrelated facades.

## Verification Evidence

- `git diff --check` — clean on all branches and on this integration worktree.
- Official DSH package immutability — mtime fingerprint of
  `/usr/lib/node_modules/@deepseek-ai/dsh` (32,959 files) recorded as
  `050fef4aade406185b78daa31827b4cd` before W1 and re-verified unchanged
  before W2.1; no official package path is written by any batch.
- Focused suites: host namespaces 12 passed; host events 10 passed; service
  fragment 6 passed (+34 regression); client leaves 29 passed; W0 contracts
  4 passed. Integration root suite 826 passed before W2.1 joins.

## Deviation Register

No unreported deviation exists. The two documentation-only decisions carried
into `w2-decisions.md` (client-leaf P4 wording extension; S8 session-source
binding) were both pre-approved by W0 and are re-recorded here for the W2
decision log.