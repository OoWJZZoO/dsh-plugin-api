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
`key`/`ctxService`/`members` (48 unique keys, 413 members). Existing tests
that hard-coded the 21-key allowlist, the default disabled-namespace count,
fixture `web` shapes, or the "web absence disables services" assumption are
updated to the 48-key surface; the per-service P4 degradation behavior is
unchanged (a missing declared member still disables only its own facade).
