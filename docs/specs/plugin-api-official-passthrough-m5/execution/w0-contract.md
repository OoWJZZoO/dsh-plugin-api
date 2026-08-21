# M5 W0 Parallel Delivery Contract

## Boundary

- Feature: `plugin-api-official-passthrough-m5`
- Worktree: `.worktree/plugin-api-official-passthrough-m5`
- Branch: `codex/plugin-api-official-passthrough-m5`
- Stage 3 baseline: commit `27f3a11`
- Current package boundary: `0.1.0-rc.6-0.5` / `dsh.api: 0.5`
- Runtime feature identity: `officialPassthrough`
- Public surfaces: the two existing `pluginApi.systemPrompt` helpers and
  seven `pluginApi.client` leaves; no `pluginApi.officialPassthrough` namespace

## Delivery Order

M4 and M5 remain separate feature units. The M4 branch is integrated first as
its own unit, the M5 branch is integrated second, and shared files are
reconciled once after both units are present. M5 does not import, call, or
require an M4-specific symbol.

The host `FEATURE_MOUNTERS` order is frozen as:

`tools`, `events`, `agent`, `llm`, `llm/request`, `llm/admission`, `session`,
`sessionDurable`, `execRoute`, `sessionRoute`, `settings`, `systemPrompt`,
`officialPassthrough`, `services`, `typert`, `settingsRemote`, `remote`.

The M5 host mounter is inserted immediately after `systemPrompt` and before
`services`. Existing client M3 feature names and order remain unchanged; M5
client leaves are owned by the client root/bootstrap path.

## Scope

M5 may implement and mark delivered only `P11` and `C26-C32`. It excludes
`P1-P10`, `C1-C25`, every `T*`, `L*`, `A*`, `E*`, `O*`, `S*`, `ST*`, `SV*`,
`RB*`, and `U*` row, all M4 rows including `T11`, `RB1`, `SV19`, `SV20`, and
all M-final proposals and consumer migrations.

## File Ownership

New source files are limited to `lib/official-passthrough-*.js` and
`lib/client-official-passthrough-*.js`. Existing source edits are limited to
`lib/guards.js`, `lib/index.js`, `lib/plugin-api-service.js`,
`lib/system-prompt.js`, and `lib/client-runtime.js`. The only generated output
is `lib/client.js`.

New tests are limited to the required protocol files and
`test/official-passthrough-*.test.mjs`. `test/client-bundle.test.mjs` may only
receive M5 bundle assertions. Shared index/event tests are frozen.

Governance writes are limited to the M5 status cells in
`docs/specs/plugin-api-features/feature-list.md`, one appended Section 8 row in
`AGENTS.md`, and this execution file. Package metadata and official DSH package
files are read-only.

## Shared-File Rules

- `lib/guards.js`: append only the `officialPassthrough` branch before the
  unknown-feature fallback.
- `lib/index.js`: append the M5 mounter and insert its map entry at the frozen
  position; do not reorder existing entries.
- `lib/plugin-api-service.js`: append only the M5 surface assignment path.
- `lib/system-prompt.js` and `lib/client-runtime.js`: preserve existing M3/M1
  behavior and add only the M5 composition/ownership paths.
- `lib/events-catalog.js`, shared freeze/bus infrastructure, package metadata,
  official package files, and M4 implementation files are frozen.
- `featureRegistry.isActive('officialPassthrough')` is the only host mounter
  re-apply signal. No service-shape or ad hoc alias signal is allowed.

## Failure and Catalog Policy

Required host peers and the host helper owner are fail-closed according to the
existing host facade guard. Optional browser module/service leaves are fail-open
and degrade locally to typed unavailable shells. Core failure remains P1;
disabled surfaces use the existing P2 surface-keyed typed error. M5 introduces
no P3/P4 path and no event catalog entry.

## Merge Rule

Keep disjoint additions, preserve M4 rows/statuses/order, resolve package
metadata only at the integration boundary, and reject any M5 change outside
this contract unless the execution contract is amended through an explicit
user decision.
