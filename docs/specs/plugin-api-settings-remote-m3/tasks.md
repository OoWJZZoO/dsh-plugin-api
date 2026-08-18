# Stage 3 Tasks: plugin-api-settings-remote-m3

> feature_name: `plugin-api-settings-remote-m3`
> upstream: `plugin-api-settings-remote-m3` Requirements and Design

## 1. Host leaf

- [x] 1.1 Add `lib/settings-remote.js` with namespace/key validation, official Typert binding and Remote metadata, settings get/set forwarding, JSON-safe boundary checks, owner map, idempotent/stale-safe disposer, and disabled/fail-safe behavior.
- [x] 1.2 Keep the leaf independent of shared composition; export only factory/helpers needed by the integration owner.

## 2. Guard

- [x] 2.1 Add one append-only `settingsRemote` branch to `lib/guards.js` probing settings, registration, and Typert public primitives without importing private DSH modules.

## 3. Focused verification

- [x] 3.1 Test valid default/explicit keys, metadata order, exact get/set wire semantics, JSON-safe rejection, duplicate owner behavior, rollback, repeated disposal, stale replacement, missing primitives, and contained logging.
- [x] 3.2 Run the ST4 focused test set and the guard regression set, then `git diff --check`.

## 4. Delivery

- [x] 4.1 Record any deviation from the approved contract in `DEVIATIONS.md` and a concise delivery report.
- [x] 4.2 Commit all Stage 4 code/tests/spec evidence as one clean ST4 batch.
