# ST4 Stage 4 Delivery

Implemented the host `settingsRemote` leaf in `lib/settings-remote.js` and its append-only `settingsRemote` guard branch in `lib/guards.js`.

The leaf validates settings namespace and Typert service key segments, publishes `get`/`set` through official Remote metadata and `bindTypertRemote`, converts validated patch/unset input to official settings mutation operations, enforces JSON-safe values, and owns idempotent/stale-safe provider cleanup. `get()` returns a detached `{ value }` snapshot taken from `settings.describe({ redactSecrets: true })`, so schema-declared secrets never cross the Typert boundary. Its Remote methods are hosted on a feature-local prototype, which prevents marker metadata from leaking to `Object.prototype`. Missing primitives produce a disabled P2 face; publication errors are logged and do not escape the host boundary.

Shared composition (`lib/index.js`, `lib/plugin-api-service.js`), client files, event catalogs, package metadata, and official DSH files were not modified.

The implementation uses the documented `bindTypertRemote` alternative with a plain service object and `ctx.reflect.provide`; no new Typert peer dependency is introduced.

## Verification

- `node --test test/settings-remote.test.mjs test/settings-guard.test.mjs test/guards.test.mjs` (47 passing)
- `git diff --check`
