# Stage 3 Tasks: plugin-api-client-remote-contribution-m3

- [x] Baseline: add contribution validation, exact-once mount, rollback, and idempotent disposal.
- [x] Baseline: add focused mount/face/lifecycle tests.
- [x] Reconciliation: replace property-presence validation with real official gateway dynamic-namespace resolution, add pending mount dispose/reapply race coverage, and verify late rejection cannot remove a newer owner. Implemented via `remote[namespace]` dynamic-service accessor, `pending → active → stale/disposed` records, and record-identity-guarded cleanup; covered by the three added tests in `test/client-remote-contribution.test.mjs`.
