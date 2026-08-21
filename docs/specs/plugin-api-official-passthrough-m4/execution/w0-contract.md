# W0 Contract Boundary

## Baseline

- Tasks baseline: `aba739f92f1d1f11a53b95788e0cb8ca800d7805`
- Integration branch: `codex/plugin-api-official-passthrough-m4`
- Integration worktree: `.worktrees/plugin-api-official-passthrough-m4`

No implementation inventory item is owned by this boundary. It establishes
only the immutable contract fixture and focused coverage through the existing
internal service facade builders. No runtime definition-table injection is
part of the boundary.

## Fixed Inputs

The fixture fixes the catalog row field order to:

```text
name, mode, scopeFiltered, scopeKey, payload, args, fault, freeze
```

All W1 branches derive from the committed corrected W0 tip, never from another
W1 branch. They may read `test/official-passthrough-contracts.mjs` and its
test, but may not modify either file.

For every client service, event, and connection leaf in the approved client
surface, the client branch may use a local disabled facade when that optional
provider is unavailable or malformed. This documents the approved M4-specific
extension of the older service-only P4 wording to all client leaf kinds; it
creates no new error type or runtime path. The W2 decision log must carry this
as a documentation-only protocol decision before client work is joined.

## Write Set

- `lib/services.js`: retained existing static definition construction; no new
  runtime seam or public table injection.
- `test/official-passthrough-contracts.mjs`: immutable neutral contract data.
- `test/official-passthrough-contracts.test.mjs`: fixture, shared-builder, and
  per-service failure-path tests.
- This record.

## Requirements/Design Revision Note

No approved Requirements or Design acceptance boundary changed. The first W0
draft briefly added a supplied definition-table option to
`createServicesNamespace`; that option was removed before the corrected W0 tip
so the runtime retains one static definition table. The existing
`buildActiveFacade` and `buildDisabledFacade` functions provide the narrow
internal builder seam needed by focused fragment tests and by the later service
fragment integration.

## Verification

- `node --test test/official-passthrough-contracts.test.mjs` - 4 passed.
- `node --test test/services-definitions.test.mjs test/services-passthrough.test.mjs test/plugin-api-service.test.mjs` - 34 passed.
- `git diff --check` - passed.
- Initial blocking Luna(max) review of `92ee169` reported two low-risk issues:
  the temporary definition-table injection was too open, and the client-leaf
  P4 wording was too narrow. Both are resolved in the corrected tip and the
  focused tests above pass.
- Per the user's explicit approval, no second adversarial review is requested
  for these non-substantive corrections. The corrected W0 commit is the sole
  source for all W1 worktree derivations.
