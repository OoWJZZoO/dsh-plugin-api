# Stage 3 Tasks: plugin-api-client-settings-remote-m3

- [x] Baseline: implement descriptor/face validation, C2 reuse, degradation, and idempotent cleanup.
- [x] Baseline: add active and degraded-path tests.
- [x] Reconciliation: cover the shared C2 dynamic-namespace and pending-mount lifecycle contract and ST5's own pending-dispose rollback. ST5 now rolls back a contribution disposed while its C2 mount is pending (new gated-mount test in `test/client-settings-remote.test.mjs` asserting `degraded('remote-unavailable')` and exactly-once official disposal); the C2 dynamic-accessor and pending-lifecycle tests in `test/client-remote-contribution.test.mjs`, the bundle-level `client.mountRemote` case in `test/client-bundle.test.mjs`, and the bundle partial-boot cases exercise the shared owner.
