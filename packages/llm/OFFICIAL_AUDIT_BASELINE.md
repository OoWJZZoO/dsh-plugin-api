# Official Fork Audit Baseline — `packages/llm`

This document registers the faithful fork of the official LLM runtime used by
the replacement bundle `@deepseek-ai/dsh-plugin-api-llm`. It is the anchor for
the mechanical integrity test (`test/official-fork-integrity.test.mjs`) and the
evidence source for the contract-fidelity and client-half decisions.

## 1. Fork baseline

| Field | Value |
|---|---|
| Official package | `@deepseek-ai/dsh-llm` |
| Official version | `0.1.0-rc.6` |
| Source file | `lib/index.js` (installed source, 1407 lines) |
| Fork file | `lib/forked-runtime.js` |
| Replacement package | `@deepseek-ai/dsh-plugin-api-llm` `0.1.0-rc.6-0.7` (`dsh.api` `0.7`) |
| Runtime lock | `@deepseek-ai/dsh@0.1.0-rc.6` |

The fork starts as a byte-for-byte copy of the official source and applies only
the differences registered below. The official export surface is preserved
exactly (39 exports: 38 named + `LlmRuntime` as default).

## 2. Difference register

Every difference from the official source is listed here with its reason and
fidelity argument. The mechanical test compares the export set and the
`LlmRuntime.prototype` method set against the installed official package, using
this register as the whitelist for the single permitted prototype addition.

| # | Location | Difference | Reason | Fidelity argument |
|---|---|---|---|---|
| 1 | file header | Added header comment | Records source/version/difference register | Comment only; no behavior |
| 2 | imports | Added `import { runDecorationStream } from './decoration-chain.js'` | The decoration chain executor lives in the replacement bundle | New private module import; official exports untouched |
| 3 | attribution | `createRequire(import.meta.url)("../package.json")` → `createRequire(import.meta.url)("@deepseek-ai/dsh-llm/package.json")` | Wire `User-Agent` must stay byte-identical to the official package; this replacement's own manifest version carries the API-protocol suffix and is not a wire attribution value | The resolved `version` is the official `0.1.0-rc.6`, so `APP_IDENTITY`/`userAgent()`/`attributionHeaders()` render exactly as official |
| 4 | `LlmRuntime` constructor | Added `_decoration = void 0` field | The decoration registry attaches its hook surface here | Default `undefined` means the official behavior is unchanged when decoration is inactive |
| 5 | `registerAdapter` | Added per-registration `ownership` token; dispose closure snapshots owned providers before clearing and calls `_decoration?.onAdapterRoutesDisposed?.(providersSnapshot, ownership)`; initial commit and `handle.replace` pass `ownership` through | The registry needs a stable registration identity and the disposed provider set to revoke only this registration's bindings | The official route mutation order (delete, clear, re-add, `emitAdaptersUpdated`) is unchanged; the hook runs after the official event, never emits a second event |
| 6 | `commitRoutes` | Added optional third `ownership` parameter; after `emitAdaptersUpdated()` calls `_decoration?.onAdapterRoutesCommitted?.(owned, registrations, ownership)` | Topology-commit observation point for the decoration registry | Two-argument callers behave exactly as official; the hook only fires when a registry is attached |
| 7 | `registerConfigurableProviders` | After commit/dispose, calls `_decoration?.onDirectoryCommitted?.(...)` / `onDirectoryDisposed?.(...)` with detached entry snapshots | The registry bumps its epoch on directory mutations (C6) | Official validation, atomic replace, and event emission are unchanged; no decoration is inferred from dormant entries |
| 8 | `registerModelDiscovery` | After commit/dispose, calls `_decoration?.onDiscoveryCommitted?.(settingsNs)` / `onDiscoveryDisposed?.(settingsNs)` | The registry bumps its epoch on discovery mutations (C6) | Official behavior unchanged |
| 9 | `adapterStream` | Iteration loop extracted to module-level `_consumeAdapterIterator(iterator, signal)`; the plain path calls it; when a decoration chain exists, the chain executor drives the same helper as the base invocation | Single source of truth for the official loop (construction failure → terminal failure chunk, iteration throw → terminal chunk, done → return, abandoned stream → `iterator.return()`) | `_consumeAdapterIterator` is byte-equivalent to the original loop (refactoring equivalence); the plain path output is unchanged |
| 10 | `adapterStream` | Added `_decorationChainFor` helper: when `_decoration?.chainFor(...)` returns a non-empty chain, the operation runs through `runDecorationStream`; otherwise the plain official path is used | Decoration chain insertion at the real adapter boundary | `llm/stream` stays the official outer waterfall; no recursive `llm.stream()` call, no second event, no synthetic adapter |
| 11 | module bottom | Added `_failureIterable(chunk)` one-shot iterable | Carries an adapter-construction failure chunk into the decorated path exactly like the plain path does | Same `adapterFailureChunk` shape |

### Prototype whitelist

`_decorationChainFor` is the only method added to `LlmRuntime.prototype`.
`_consumeAdapterIterator` and `_failureIterable` are module-scope functions and
do not appear on the prototype.

## 3. Attribution deviation note

The official source derives `APP_IDENTITY.version` from its own
`../package.json`. The fork derives it from the installed official
`@deepseek-ai/dsh-llm/package.json` so the wire `User-Agent` remains identical
to the official package. This is the only attribution-related deviation; no
other `APP_IDENTITY`/`userAgent()`/`attributionHeaders()` behavior changes.

## 4. Refactoring equivalence

`_consumeAdapterIterator(iterator, signal)` reproduces the official loop from
`adapterStream`:

- iterator construction failure (handled by the caller) → one terminal failure
  chunk;
- an `await iterator.next()` rejection → `completed = true`, one terminal
  failure chunk via `adapterFailureChunk(error, signal)`;
- `next.done` → `completed = true`, clean return;
- otherwise yield the value;
- a stream abandoned before completion calls `iterator.return()` in `finally`.

The plain (no-decoration) path in the fork calls this helper for the same
input, so contract-level output is identical to the official runtime.

## 5. Client-half six-negative evidence (host-only decision)

The six required checks for the target official `dsh-llm` row are all negative:

| Check | Evidence | Result |
|---|---|---|
| client manifest | `@deepseek-ai/dsh-llm/package.json` has no `dsh.client` entry | No |
| remote namespace | no client contribution or remote service in the package | No |
| slot/settings bridge | no slot or settings bridge declaration | No |
| host-client version negotiation | no client half or negotiation contract in the package | No |
| browser state/reconnect | no browser module and no reconnect owner | No |
| client-facing event/service | the service is host-side `ctx.llm`; its events are host Cordis events | No |

Therefore this replacement is host-only. It adds no `lib/client.js`, no
`dsh.client` manifest, no browser bundle, and no client roster row. The
replacement package `package.json` has no `dsh.client` entry, and
`packages/llm/` contains no `lib/client.js`.

## 6. Official import resolution evidence

`import('@deepseek-ai/dsh-llm')` resolves to the installed official package
module, not the replacement implementation. The replacement does not declare an
`exports` entry that shadows `@deepseek-ai/dsh-llm`, does not alter Node module
resolution, and does not modify any official package file under
`/usr/lib/node_modules/@deepseek-ai/dsh/**`. The mechanical integrity test
asserts the fork export set equals the installed official export set, which
only holds when the official import resolves to the official module.
