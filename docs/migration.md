# Plugin API migration assistant

The migration assistant is deliberately conservative: it reports every direct
DSH dependency, but it edits only proven immutable service receivers and adds a
`pluginApi` injection/activation guard when one unambiguous `apply` entry is
available.

## Inspect and plan

Run from the plugin repository:

```bash
npx dsh-plugin-api-migrate scan . --json > migration-scan.json
npx dsh-plugin-api-migrate check . --baseline migration-scan.json --fail-on error
npx dsh-plugin-api-migrate migrate . --json > migration-plan.json
```

`--include`, `--exclude`, `--parser babel|ecma`, and
`--allow-outside-root` are available for explicit fixture or workspace layouts.
The plan is dry-run by default and contains a deterministic unified diff. A
computed service/event name, reflection, monkey patch, direct host package, or
client wire operation remains a finding for manual review.

## Write and rollback

Only a successful plan can be written. The transaction records a manifest,
patch, report, and (unless `--no-backup` is selected) byte-for-byte originals in
`.dsh/migrations/<migration-id>/`:

```bash
npx dsh-plugin-api-migrate migrate . --write --report migration-report.json
npx dsh-plugin-api-migrate migrate . --write --no-backup
npx dsh-plugin-api-migrate migrate --rollback <migration-id>
npx dsh-plugin-api-migrate migrate --rollback ./.dsh/migrations/<migration-id>
```

Rollback refuses files whose post-migration hash changed. A failed commit or
rollback writes a recovery record and attempts inverse restoration; inspect
`recovery.json` or `rollback-recovery.json` before continuing.

`--report` is collision-protected against plugin source files, including files
excluded from discovery. Reports are written atomically before a write
transaction starts when `migrate --write` is used.

## Baselines and audit

`check --baseline` compares finding fingerprints and records added, removed, and
unchanged sets. The optional audit recorder appends canonical JSONL with
explicit null metadata:

```js
import { createAuditRecorder } from '@deepseek-ai/dsh-plugin-api/migrate'
const audit = createAuditRecorder()
audit.record({ plugin: 'my-plugin', operation: 'ctx.get', ruleId: 'host.service.alias' })
```

Read it through the standard report schema:

```bash
npx dsh-plugin-api-migrate audit --read .dsh/migrations/audit.jsonl --json
```

Client wire/ownership changes and dynamic client namespaces are C-class
unsupported proposals. They are intentionally report-only until an explicit
facade contract exists.
