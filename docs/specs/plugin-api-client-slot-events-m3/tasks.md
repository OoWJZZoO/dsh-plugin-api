# Stage 3 Tasks: plugin-api-client-slot-events-m3

- [x] Baseline: implement `slots/changed` subscriptions and controlled dispatch.
- [x] Baseline: test synchronous listener containment and disposal.
- [x] Reconciliation: add rejected-thenable coverage and assert no `unhandledRejection` while later listeners continue to receive the event. Implemented via `Promise.resolve(result).catch(...)` containment in `lib/client-slot-events.js`; covered by the added rejected-thenable test with an `unhandledRejection` probe.
