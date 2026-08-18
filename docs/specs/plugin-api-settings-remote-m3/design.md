# Stage 2 Design: plugin-api-settings-remote-m3

> feature_name: `plugin-api-settings-remote-m3`
> upstream: `plugin-api-m3-contract` Design

## Shape

`createSettingsRemoteApi({ ctx, settings, protocol, logger })` returns a leaf facade with `isActive`, `remote(namespace, serviceKey?)`, and `dispose()`. The integration owner is responsible for exposing this leaf as `pluginApi.settings.remote`; this worktree does not edit shared composition.

The leaf uses the official `isTypertRemoteSegment`, `bindTypertRemote`, and `remoteMethods` exports. The remote service is a plain object registered with `ctx.reflect.provide`, so the returned disposer is the official fiber-owned provider disposer. The object carries the frozen `typertRemote` binding and two marked methods:

- `get()` reads `settings.get(namespace)` and validates the returned JSON-safe value.
- `set(request)` accepts `{ patch?: object, unset?: string[] }`, converts it to official `{ op: 'set'|'unset', path, value? }` operations, calls `settings.mutate(namespace, ops)`, and returns a JSON-safe `{ ok: true }` result.

Remote methods are marked with the official decorator function through a standard decorator context initializer, which works in the Node host without decorator syntax. `remoteMethods(service)` is checked before registration and its declaration order is stable (`get`, then `set`).

## Lifecycle and guard

`remote()` resolves the settings namespace via the M1 settings facade (`settings.scope(namespace)`), then validates the protocol and registration primitives. A per-context owner map records active service keys. The publication sequence is `validate -> create service -> bind -> metadata check -> reflect.provide -> commit`; any failure leaves the map and provider unchanged. The disposer checks its epoch and identity before invoking the provider disposer, then removes only its own map entry. Repeated calls with the same namespace/key return the existing owner disposer rather than duplicate publication.

The `settingsRemote` guard is append-only in `lib/guards.js` and probes `ctx.get`, the settings service (`get`/`mutate`), `ctx.reflect.provide`, and the official Typert protocol (`isTypertRemoteSegment`, `bindTypertRemote`, `remoteMethods`, `Remote`). Guard failures are P2 and do not alter the optional M1 settings service behavior.

All guard, registration, metadata, and logger operations are wrapped so no ST4 failure escapes host apply. Official call-time settings errors remain unchanged after the adapter has validated its own request boundary.

## JSON safety

The leaf accepts JSON values only: null, booleans, finite numbers, strings, arrays, and plain objects with string keys. It rejects `undefined`, functions, symbols, bigint, non-finite numbers, class instances, cycles, and non-enumerable/host objects. Returned settings snapshots and mutation results are checked before they cross the Typert boundary.

## Ownership

Allowed implementation files are `lib/settings-remote.js`, its focused tests, and one append-only `settingsRemote` branch in `lib/guards.js`. Shared mounters, service composition, client files, event catalogs, package metadata, and official DSH files are integration-owned or excluded.
