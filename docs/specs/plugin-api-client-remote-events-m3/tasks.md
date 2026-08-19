# Stage 3 Tasks: plugin-api-client-remote-events-m3

- [x] Baseline: implement C6 allowlisted subscriptions, carrier dispatch, and synchronous listener failure containment.
- [x] Baseline: add focused lifecycle tests.
- [x] Reconciliation: test rejected asynchronous listeners and assert no `unhandledRejection` while preserving snapshot order and unrelated listener delivery. Implemented via `Promise.resolve(result).catch(...)` containment in `lib/client-remote-events.js`; covered by the added rejected-thenable test with an `unhandledRejection` probe.
