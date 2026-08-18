# M3 Integration Delivery

## Boundary

M3 integrates the eleven contracted features from `plugin-api-m3-contract`:

| Wave | Features | Worktree role |
|---|---|---|
| W1 | C1 `clientManifest`, C8 `typert` | package contract |
| W2a | ST4 `settingsRemote` | host settings publication |
| W2b | C9 `clientConnection`, ST6 `clientCodec` | client foundation |
| W2c | C6 `clientRemoteEvents` | client event bridge |
| W3a | C2 `clientRemoteContribution` | generic remote mount owner |
| W3b | C3 `clientSettingsScope` | settings scope adapter |
| W3c | C4 `clientSlots`, C5 `clientSlotEvents` | slots and mutation events |
| W4 | ST5 `clientSettingsRemote` | settings-specific client adapter |

The integration worktree is `codex/m3-integration`. The contract author was
the first prerequisite and worked on `main`; all leaf worktrees were derived
from committed stage boundaries and merged in the order above.

## Integration Evidence

- All W1-W4 committed boundaries were merged and audited for shared-file
  ownership, feature identity, official API usage, and recorded deviations.
- Host composition appends `typert` then `settingsRemote`; the frozen
  `pluginApi.services` parent remains single-owner.
- Client composition order is:
  `clientManifest`, `clientConnection`, `clientCodec`,
  `clientRemoteContribution`, `clientSettingsRemote`, `clientSettingsScope`,
  `clientSlots`, `clientSlotEvents`, `clientRemoteEvents`.
- `lib/client.js` is the official module-loader artifact and contains one
  bundled zod copy. Positive and negative real-zod descriptor checks pass;
  forged, loose, and cross-bundle schemas are rejected.
- C2 remains the sole generic `$mount` owner. ST5 only validates settings
  descriptors and exposes a degraded result when the host face is absent.
- C4 and C5 share one `client.slots` parent. C5 is client-only and does not
  expand the host event catalog.
- `node --test`: **697/697 passed** in the integration worktree.
- `git diff --check`: passed.
- `dsh-read-image`: migration commits `0ff1c58`, `8818fd1`, and guard-sweep
  maintenance commit `0034ddc`; focused migration evidence is **24/24**,
  client syntax and descriptor checks pass.
- `dsh-pro-ex-ability-anchor`: migration commit `e61dc28`; full test evidence
  is **123/123**, panel syntax and diff checks pass.
- Official DSH package files were not edited. The installed package tree is
  outside the repository and was inspected without any write operation.
- Guard and boot checks remain fail-safe. The consumer guard sweep was updated
  to remove its obsolete check for the deleted `lib/config-remote.js`; the
  remaining headless/dev boot checks are retained for the deployed profile.

## Explicit Non-Goals

- C7 native `remote.<namespace>` dynamic discovery remains planned/proposal.
- ST7 dynamic `WEB_SETTINGS_NAMESPACES` remains planned/proposal.
- No M4 implementation or official DSH package patch is included.

## Governance

The unattended run treated the owner authorization as the human confirmation
for Stage 0-3 gates. Each Stage 4 top-level batch was completed and adversarially
audited before the next merge wave; deviations are recorded in the owning
feature directories.
