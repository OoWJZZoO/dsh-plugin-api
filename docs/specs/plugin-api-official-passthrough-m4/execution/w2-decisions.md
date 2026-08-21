# W2 Decision Log — plugin-api-official-passthrough-m4

## D1. Client-leaf P4 protocol extension (records W0 decision)

The approved Tasks W0 record extends the older parallel-workflow P4 wording
(service-only) to every optional client leaf kind: client services, client
events, and the client connection face each publish a local disabled facade
with the existing P1–P4 runtime semantics. This is a documentation-only
protocol decision; it introduces no new error type and no central runtime
path. Recorded at W2.1 before any client work joins (task 9).

## D2. S8 session-source binding

`append` and `deriveEventMessage` are Session instance methods in the official
runtime (`dsh-session` types at `lib/types/index.d.ts:212,261-266`; the
`SessionStore` service does not expose them). The approved Requirements R4.4
is vacuous for `append` because the official session store does not expose a
store-level append in runtime `0.1.0-rc.6`.

Integration decision (W2.1): the session leaf is bound with the official
`dsh-session` public export module as its session source. `deriveEventMessage`
therefore delegates to the official public export exactly per Design
(`deriveEventMessage delegates to the official public session
export/instance method`). `append` keeps the leaf's default behavior
(source-absent → P2 `PluginApiFeatureDisabledError('session')`) until the
official runtime exposes a public session-source path; the leaf factory
already supports a configured session/sessionSource input, so no runtime
change is needed when such a path appears. This is recorded as a documented
limitation, not a deviation: no approved acceptance boundary is changed.

## D3. Leaf activation binding

All host namespace leaves are created with `active: () => service.isActive`,
so the leaf gates follow the host root P1 boundary and never outlive the
facade. Token/lifecycle inputs remain at the leaf defaults (a single active
epoch per feature mount); host re-apply is already idempotent through
`featureRegistry.isActive` early returns in each mounter, so no host-side
token rotation is introduced in W2.1.

## D4. Official artifact resolution (L12 / T13) and tools member wiring

The LLM public artifacts (`contentHasImage`, `createUserMessage`,
`BlockAssembler`) and the tools `defineTool` export resolve lazily through the
existing `createRequire` path used by `buildToolAbortedErrorFactory`
(`lib/index.js`). When the official package is absent, the leaf artifact
member degrades P2 (`llm` / `tools`) at access time; the rest of the facade
remains active. `dsh-llm` and `dsh-tools` are not added as new
runtime dependencies (the former already is a peerDependency; the latter is
resolved only through the pre-existing lazy path).

The `tools` leaf members (`executionMode`, `defineTool`) are wired as explicit
call-time forwards inside `createToolsApi` rather than through the
`createOfficialToolsLeaf` factory. Rationale: the tools facade already uses
call-time service resolution for every M1 member (each access to
`pluginApi.tools` builds a fresh view and resolves `ctx.get('tools')` at
invocation), and an eager leaf binding would resolve the official tools
service during view construction, which the existing tools contract
prohibits ("accessing the facade must not touch the tools service"). Both
members preserve the official leaf semantics: receiver/argument forwarding
and P2 (`tools`) degradation at call time for a missing service or missing
public export. This is a mechanical integration decision, not a new API or
failure path.

## D5. P10 exclusion

W2.1 does not touch the `system-prompt/assemble` writable waterfall. The
`assemble` namespace member added by the host-namespaces leaf is a plain
service passthrough; P10's `fault`/`freeze` event-catalog semantics are owned
exclusively by W2.5 (tasks item 10).
## D6. Services table integration (W2.3)

The reviewed fragment is imported into `lib/services.js` as the static union:
delivered definitions keep their order with provenance (`pkg`) metadata
removed, `web` uses the fragment's complete four-member version
(`registerSearchProvider`/`registerFetchProvider`/`search`/`fetch` — the
latter two are confirmed official `ctx.web` members), and the remaining 27
fragment keys append in fragment order. The runtime table retains exactly
`key`/`ctxService`/`members` (48 unique keys, 220 members). Existing tests
that hard-coded the 21-key allowlist, the default disabled-namespace count,
fixture `web` shapes, or the "web absence disables services" assumption are
updated to the 48-key surface; the per-service P4 degradation behavior is
unchanged (a missing declared member still disables only its own facade).

## D7. Client official leaves join surface (W2.4)

The reviewed client-leaf results expose aggregate namespaces and disposers
already (`api`/`leaves`/`dispose` per result, per-leaf record with owner-table
supersede), so the join mounts them directly instead of routing through each
leaf's optional `publish` callback. The leaf-level `publish` contract remains
tested by the W1 batch; the central join is epoch-scoped (a fresh apply builds
a fresh outer client), so no surface mutation registry is needed and stale
owners are unreachable by construction.

Public surface additions on the frozen outer client:

- `services`: the official services namespace `{ isActive, modules, locale,
  sessions, workspaces, chatFileMentions, layout, theme, appShell,
  sessionLogDownload, cordisInspect, dynamicCordisRunner }`; key order is
  `CLIENT_SERVICE_NAMES` order, which matches the approved design order.
- `events`: `{ isActive, localeChange, themeChange, connectionReset,
  commandExecuted, on }`; per-event public faces expose only `isActive` and
  `on` (dispose stays leaf-internal, matching the slots precedent).
- `connection`: the existing connection face plus `api.llm`
  (`providers`, `models`, `discoverModels`) mounted from the official
  connection leaf; an unavailable official `api.llm` keeps the llm face
  present in its failing (leaf-disabled) shape, so `api.settings` semantics
  and `connection.isActive` from the existing face are unchanged.

`CLIENT_MOUNTERS` gains exactly one entry, `clientOfficialServices`, between
`clientCodec` and `clientRemoteContribution` (design join order). Client
events and the connection face are not separate mounters; they ride the
existing outer lifecycle. Dispose order is LIFO relative to construction:
the three official leaves dispose after `remoteContribution` and before the
existing connection face. No manifest, codec, remote-contribution, slot, or
settings-remote semantics change.

D7 note (bundle regeneration): `lib/client.js` is a checked-in esbuild
artifact rebuilt from `lib/client-runtime.js` (esbuild 0.28.2, iife bundle,
`DSHPluginApiClientBundle` global, manual loader wrapper). The rebuilt zod
section was byte-identical to the previously delivered copy except for four
whitespace-only lines inside zod template literals (the current official zod
file indents those blank lines where the delivered copy had empty lines);
they were collapsed to the delivered bytes so the vendored zod copy stays
byte-identical across the milestone boundary. All other zod region code
bytes match (module path comment banners vary only by relative-path depth,
a build-root artifact), and the new leaf modules plus the join changes are
the only additions.

## D8 — W2.5 shared semantics, delivered regressions, neutral integration surface

D8.1 — Waterfall freeze policy (shared semantic unit). The approved
`system-prompt/assemble` writable waterfall is expressed as one new neutral
catalog freeze value: `freeze: 'waterfall'` means the events bus leaves the
dispatch arguments unfrozen (`freezeByPolicy` returns the payload untouched).
The catalog entry moves from `fault: 'contain'` to `fault: 'propagate'` to
match the official Cordis waterfall while `monitor`-priority listeners keep
containment. `events-bus.js` now recognizes the trailing `next` callback
before freezing: when present, only the leading arguments are candidates for
freezing; when absent (emit/serial/parallel/bail) the pre-existing behavior
is byte-identical. Unrelated entries keep their exact freeze/fault policies;
the legacy cardinality test's schema whitelist now accepts `'waterfall'`
alongside `'all' | 'except-signal' | deep-array`.

D8.2 — Delivered-regression tests. `test/delivered-regression.test.mjs`
re-proves, through the integrated facade, the tool aborted-error contract
(typed identity, degraded factory, feature-disabled isolation), the generic
host remote publication (publication through the official boundary, wire
parameter validation, idempotent/owner-isolated disposer, same-key conflict,
missing-prerequisite degradation), and the jobs / shellEnv seams (exact
member lists, official receiver identity through `apply`, per-service
degradation with `services.<key>` feature codes). The fixture parameter is
named `services` (matching the reviewed `index-remote` fixture); recording
methods are regular functions so receiver identity is observable.

D8.3 — Neutral integration surface. `test/integration-surface.test.mjs`
asserts, from the reviewed contract fixtures only: the nine host event
contracts with exact `catalogFields` values in the mounted facade catalog
(plus the 47-name baseline union intact), the 48-key service table with the
reviewed member-kind/name order for all 28 fragment inputs, the mounted
namespace surface (all 48 seams active with exact member keys, getter value
forwarding, method receiver identity), and the bundled client public faces
(exact 11-service namespace and per-service member surfaces — 70 members —
the four event faces with slim `isActive`/`on`, and the nested connection
llm face with its three approved members). The mounted `pluginApi.services`
surface composes the 48-key namespace with the pre-existing `typert` seam,
so the runtime `Object.keys` total is 49 while the passthrough table stays
48; tests slice the first 48 keys.

Evidence (labeled): unit `node --test` full suite 926/926 pass; focused host
and client boot checks within `integration-surface.test.mjs` (host `apply`
with all capability stubs + VM-bundled client `apply` with faithful browser
service shapes); `git diff --check` clean; official-package immutability
re-check clean (no file under the official install modified since the
previous boundary); governance-token audit on every changed file clean
(no inventory IDs or classifications in implementation or test code).
