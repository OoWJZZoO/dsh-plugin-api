# @deepseek-ai/dsh-plugin-api-profile-manager

Companion executor CLI for `pluginApi.profile` write verbs (delivered with the
dsh-plugin-api monorepo). All profile write logic lives here, out of process;
the host facade is only a safe remote client.

## Install

With a full install, the executor comes along:

```bash
dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-full
```

For selective installs, add the executor alongside the main package when you
want write verbs (`apply` / `snapshot.*`). Without it, write verbs return a
typed `unavailable` result and the read face (`inspect` / `health` /
`planDiff`) keeps working.

```bash
dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-main
dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-profile-manager
```

## Commands

| Command | Purpose |
|---|---|
| `handshake` | report `{ builtForRuntime, apiProtocol }` for the facade's two-direction version check |
| `quick-write <json>` | full prepare → validate → commit pipeline for one change intent |
| `snapshot-create <json>` | near-instant lazy snapshot (config copied; deps materialized at first validate) |
| `snapshot-modify <json>` | unvalidated edit; lifecycle becomes `dirty` |
| `snapshot-validate <json>` | run requested validation level; on pass becomes `validated` bound to the content generation |
| `snapshot-delete <json>` | remove an owned snapshot (ownership-enforced, idempotent) |
| `snapshot-apply <json>` | atomic config swap + backup rotation (hard validated-generation gate) |
| `gc <json>` | boot-init orphan scan: owner absent from runtime view and declared deps, or target profile gone → delete |

Storage lives under `$DSH_HOME/plugin-api/profile-manager/` (snapshots /
cache/seed / backups / audit.log / tmp). Quotas default to 256 MB per owner
and 1 GB total, backup retention N=5; tune via `config.json` in that
directory (fail-closed — missing or invalid values fall back to defaults,
never relax a quota).

## Accepted tradeoff (reinstall cycle)

Snapshots are tied to their owner package. An uninstall → reinstall cycle can
lose snapshots whose owner is no longer present in the runtime view or the
target profile's declared dependencies — they are reaped by the next GC
scan. This is an accepted tradeoff: the rebuild cost of a lazy snapshot is a
single materialization, and keeping stale snapshots would leak storage
without a bounded policy.

## Protocol

stdout carries JSON-lines events: `{type:'progress', operationId, stage,
reason?}` … followed by one terminal `{type:'result', outcome, ...}`. Exit
code mirrors the terminal class (0 success, 1 error, 2 aborted, 3 denied,
4 superseded; timeout recorded as error with a timeout reason).