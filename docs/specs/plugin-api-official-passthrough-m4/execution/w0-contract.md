# W0 Contract Boundary

## Baseline

- Tasks baseline: `aba739f92f1d1f11a53b95788e0cb8ca800d7805`
- Integration branch: `codex/plugin-api-official-passthrough-m4`
- Integration worktree: `.worktrees/plugin-api-official-passthrough-m4`

No implementation inventory item is owned by this boundary. It establishes
only the immutable contract fixture and a test-only service-definition seam.

## Fixed Inputs

The fixture fixes the catalog row field order to:

```text
name, mode, scopeFiltered, scopeKey, payload, args, fault, freeze
```

All W1 branches derive from this reviewed commit, never from another W1
branch. They may read `test/official-passthrough-contracts.mjs` and its test,
but may not modify either file.

The client branch may use a disabled facade for one unavailable client leaf.
This documents the approved extension of the existing local failure
presentation to client leaves; it creates no new error type or runtime path.
The W2 decision log must carry this as a documentation-only protocol decision
before client work is joined.

## Write Set

- `lib/services.js`: internal supplied-definition seam only; default runtime
  definition behavior remains unchanged.
- `test/official-passthrough-contracts.mjs`: immutable neutral contract data.
- `test/official-passthrough-contracts.test.mjs`: fixture and service-builder
  equivalence tests.
- This record.

## Verification

- `node --test test/official-passthrough-contracts.test.mjs` - 4 passed.
- `node --test test/services-definitions.test.mjs test/services-passthrough.test.mjs test/plugin-api-service.test.mjs` - 34 passed.
- `git diff --check` - passed.
- The W0 boundary is committed on the integration branch before review; the
  commit is the sole source for all W1 worktree derivations.
- Blocking adversarial review: pending Luna(max) review of this boundary.
