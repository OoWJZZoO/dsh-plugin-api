# Stage 2 Design: plugin-api-typert-m3

> feature_name: `plugin-api-typert-m3`
> upstream: `plugin-api-m3-contract` Design
> review: adversarial reviewer unavailable in the unattended W1 slot; coordinator self-audit required

## Overview

C8 is an A-class host leaf. It resolves the official `ctx.get('typert')`
contract and builds a frozen namespace of bound forwarding methods. The
integration owner later inserts this leaf into the sole `pluginApi.services`
parent and host mounter order. C8 itself never edits those shared composition
files.

## Architecture

```text
ctx.get('typert') -> createTypertFacade -> pluginApi.services.typert (W5)
exports["./typert"] ------------------> official Typert loader artifact path
```

The facade contains no registry state. Each method is a closure that calls the
captured official object with its original receiver. Nested contract objects are
similarly frozen wrappers with one closure per public method; getters are read
through the official object at call/read time where the contract requires live
state.

## Components and Interfaces

### `lib/typert.js`

Export:

- `TYPERT_FEATURE = 'typert'`;
- `createTypertFacade({ ctx, active, logger })` for integration;
- `isTypertRegistry(value)` for guard/mount probes;
- `createDisabledTypertFacade(active, reason)` for standard P3/P4 behavior.

The active facade forwards top-level `register`, `get`, `resolve`, `list`,
`getPackage`, `listPackages`, and `toJSONSchema`, plus the official `local`,
`remotes`, `lookups`, and `contexts` sub-registries. Each required method is
checked before activation. `Object.freeze` protects only the facade shell; the
official registry remains authoritative and owns all live results/disposers.

The disabled facade exposes the same declared members and throws
`PluginApiInactiveError` when the core is inactive, otherwise
`PluginApiFeatureDisabledError('services.typert', reason)`.

### `lib/guards.js`

Append a `featureName === 'typert'` branch. It probes `ctx.get`, the official
Typert registry object, top-level schema/reflection methods, and every required
nested registry method. It does not import private official state or synthesize
a fallback registry. The branch is append-only; integration may mechanically
resolve ordering conflicts.

### `package.json`

Add `exports["./typert"]: "./lib/typert.js"`. Add official Typert registry and
protocol packages as peer dependencies because host and facade must share the
same service/protocol identity. C8 does not add runtime copies of those packages.

## Data Models

The active facade mirrors the official public shape:

```js
{
  register, get, resolve, list, getPackage, listPackages, toJSONSchema,
  local, remotes, lookups, contexts,
}
```

`local`, `remotes`, `lookups`, and `contexts` each retain the official public
methods. No C8-owned aliases or descriptor types are introduced.

## Error Handling

Guard and construction probes catch getter/method failures. A failed probe
disables only C8. Forwarded calls intentionally do not catch or translate
official call-time errors. Apply/boot integration catches mount failures at the
host boundary; C8's pure factory has no global side effects.

## Testing Strategy

- registry shape guard and disabled facade behavior;
- exact receiver/argument/return/disposer identity for top-level and nested
  methods;
- registration order and duplicate/error identity delegated to an official-like
  registry double;
- missing/malformed registry containment;
- `exports["./typert"]` metadata and absence of official package edits.

## Key Decisions

- The public placement is `services.typert`; no `pluginApi.typert` is added.
- No generated artifact parsing or loader patching is performed in this leaf.
- The facade freezes its shells but never clones live official results.
