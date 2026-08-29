# M3 Integration Delivery

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `ctx.pluginApi.client.*`（client 根） | `ctx.pluginApi` 直接根成员（已无 `.client` 子命名空间） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品的交付结论。

> Status: **M3 final acceptance complete**. The post-delivery adversarial review
> findings (2026-08-19) were fixed in reconciliation batch 10 of
> `plugin-api-m3-contract/tasks.md`; the reconciliation evidence below supersedes
> the earlier `reconciliation-pending` boundary and closes the final acceptance.

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

## Reconciliation batch 10 evidence

The four post-delivery review findings were fixed and verified in batch 10 of
`plugin-api-m3-contract/tasks.md`:

1. **C2 namespace validation** now resolves published namespaces through the
   official dynamic-service accessor (`remote[namespace]`), accepting Cordis
   dynamic properties; `in`/own-property enumeration is no longer used. A
   Proxy-based test proves a face that is readable but reports false for `in`
   mounts successfully, and the bundle `$mount` publishes namespaces as dynamic
   properties.
2. **Client composition** no longer declares `connection`, `remote`,
   `settingsScope`, or `slots` as top-level Cordis injections (`inject = []`).
   Each leaf resolves and guards its own substrate; missing, malformed, or
   throwing (`ctx.get`) optional services disable only their owning leaf while
   `pluginApi.client` and unrelated leaves keep publishing.
3. **Pending C2 `$mount` lifecycle** uses `pending → active → stale/disposed`
   records: disposal during a pending mount drops the addressable owner
   immediately, defers the official disposer to settlement (invoked exactly
   once), and late rejection cleanup is record-identity guarded so a newer
   owner is never removed. ST5 rolls back a contribution disposed while its C2
   mount is pending.
4. **C5/C6 listener containment** attaches `Promise.resolve(result).catch(...)`
   to every returned thenable; rejected async listeners are reported and
   contained with no `unhandledRejection`, and snapshot order plus later
   listener delivery are preserved.

Reconciliation verification results:

- Affected leaf tests: `client-remote-contribution` 7/7,
  `client-remote-events` 3/3, `client-slot-events` 2/2,
  `client-settings-remote` 5/5, `client-bundle` 4/4 (including partial boot
  with each optional service absent, malformed, or throwing, and a
  bundle-level `client.mountRemote` case).
- Full `node --test`: **706/706 passed**.
- Consumer migration: `dsh-read-image` **24/24**, `dsh-pro-ex-ability-anchor`
  **123/123** passed.
- `scripts/verify-migration.sh`: `node --test` and `node --check lib/*.js`
  passed; dev boot readiness returned HTTP 200. The headless CLI smoke step is
  blocked by an environment-level failure unrelated to this plugin: the local
  headless profile's `MC Source` MCP server exceeds the upstream provider's
  `tool_count_limit` (`[unsupported_tool_schema]` from Console Go). The
  identical failure reproduces on the pristine pre-reconciliation commit, and
  no `dsh-plugin-api` module or stack frame appears in the failure. No official
  DSH package file was modified.
- `lib/client.js` was regenerated with the same esbuild invocation (iife +
  `window.__ModuleLoader__.load` wrapper, single bundled zod copy) and matches
  the source modules.
- `git diff --check`: passed.
- The earlier `697/697`, consumer counts, headless smoke, and HTTP 200 results
  remain valid baseline evidence and are now subsumed by the figures above.

## Explicit Non-Goals

- C7 native `remote.<namespace>` dynamic discovery remains planned/proposal.
- ST7 dynamic `WEB_SETTINGS_NAMESPACES` remains planned/proposal.
- No M4 implementation or official DSH package patch is included.

## Governance

The unattended run treated the owner authorization as the human confirmation
for Stage 0-3 gates. Each original Stage 4 top-level batch was completed and
adversarially audited before the next merge wave; the post-delivery review adds
reconciliation batch 10, which must be completed and audited before the final
M3 acceptance claim. Deviations are recorded in the owning feature directories.
