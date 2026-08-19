# Stage 2 Design: plugin-api-migration-assistant

> feature_name: `plugin-api-migration-assistant`
> stage: Design
> requirements: `requirements.md` schema 1

## 1. Architecture

The migration assistant is a source-analysis tool layered beside the runtime
facade. It has no import path from `lib/index.js` and is never mounted as a
Cordis service.

```text
scripts/migrate-cli.js
        |
lib/migrate/index.js  -- orchestration and command contracts
        |
  discovery -> parser -> rules -> findings -> edits -> report/store
                                      |
                                audit recorder
```

The implementation uses source ranges rather than a source generator. Parsing
is performed by `@babel/parser`; a small generic AST walker records nodes and
the codemod applies reverse-sorted byte-range replacements. This preserves all
bytes outside an accepted edit, including comments and formatting.

The runtime package remains fail-safe because the migration modules are loaded
only by the CLI or the explicit `./migrate` export. No official DSH package is
imported by the scanner.

## 2. Package and CLI boundary

`package.json` SHALL expose:

- `bin.dsh-plugin-api-migrate` → `scripts/migrate-cli.js`;
- `exports["./migrate"]` → `lib/migrate/index.js`;
- a direct dependency on `@babel/parser` for the scanner only;
- the existing host/client exports unchanged.

The CLI commands are:

```text
scan <root>                         scan and print findings
check <root> [--baseline file]      enforce findings threshold/delta
migrate <root> [--write]            show or apply SAFE edits
migrate --rollback <migration-id-or-dir> restore a guarded migration
audit --read <jsonl>                validate and report audit observations
```

All commands accept `--json`, `--parser babel|ecma`, `--include`,
`--exclude`, `--allow-outside-root`, and `--report`. `migrate` additionally accepts `--backup` and
`--no-backup`; `check` accepts `--fail-on info|warn|error` and `--baseline`.

## 3. Discovery and parsing

`discovery.js` resolves the root with `realpath`, rejects an escaping explicit
path by default, applies include then exclude filters, and returns sorted
POSIX-relative file records. `--allow-outside-root` is the explicit opt-in that
permits an existing file outside the root; the report records that choice and
the file's realpath. Symlinked files are checked after realpath resolution, so a
symlink escape is rejected unless the opt-in is present. Default exclusions are
the exact directories frozen in Requirements 1.

`parser.js` reads raw bytes, validates UTF-8 with a fatal `TextDecoder`, and
parses:

- `babel`: `sourceType: 'unambiguous'` plus `jsx`, `typescript`,
  `decorators-legacy`, `classProperties`, and `importAttributes` plugins;
- `ecma`: `sourceType: 'unambiguous'` with latest ECMAScript grammar.

The parser returns the AST, raw bytes, decoded source, and a byte-offset line
index. Babel offsets are converted to UTF-8 byte offsets before findings are
created. Parse and encoding failures become file-local findings and set a
global no-write guard for `migrate --write`.

## 4. Rule registry and finding model

`rules.js` exports an immutable `RULE_REGISTRY` and `RULE_REGISTRY_VERSION`.
Each rule has:

```js
{
  id,
  registryVersion,
  surface: 'host' | 'client',
  aClass: 'A' | 'B' | 'C' | 'infrastructure' | 'unknown',
  classification: 'SAFE' | 'REVIEW' | 'MANUAL' | 'UNSUPPORTED',
  source: { packages?, services?, methods?, events?, nodeKinds? },
  target: { namespace?, method? },
  minApiProtocol,
  exactRuntimeIdentity,
  guidance,
  specificity,
}
```

Initial rule families:

| Rule family | Examples | Default class |
|---|---|---|
| host service receiver | `ctx.get('tools')`, `ctx.get('llm')`, injected `agents`/`sessions` | A / SAFE when binding is immutable |
| host facade methods | tools, agent, session, llm, systemPrompt, settings methods listed in Requirements | A / SAFE |
| host event access | static `on/once/emit/serial/parallel/bail/waterfall` names | A / REVIEW until callback shape is proven |
| LLM admission/request or route simulation | image policy, `resolveModelInfo` wrapper, route probing | B / REVIEW |
| durable/session surface construction | append/provenance and durable log manipulation | B / REVIEW |
| client wire and ownership surfaces | manifest, remote, codec, slot, connection | A/B / REVIEW |
| client dynamic namespace gaps | remote discovery and settings allowlist | C / UNSUPPORTED |
| dynamic/private/reflection use | computed access, prototype mutation | unknown / MANUAL |

Rule selection filters by surface and static source pattern, then chooses the
highest `specificity` and stable id. Protocol checks downgrade SAFE to REVIEW;
exact runtime identity mismatches also downgrade and never produce edits.

## 5. AST analysis

`analyze.js` performs one generic AST walk per file and invokes rule matchers for:

1. `ImportDeclaration`, `ExportNamedDeclaration`, `CallExpression` with
   `require()` or `import()`;
2. Cordis injection arrays and exported `apply` functions;
3. `ctx.get('name')`, `ctx.service('name')`, and static member calls;
4. event calls whose first argument is a string literal;
5. assignment/update expressions targeting a known service or official method;
6. `MemberExpression` with computed, unknown, prototype, or reflection access;
7. client manifest/remote/codec/slot/settings/connection markers.

The analyzer tracks only local constant aliases that are initialized from a
known service and never reassigned. It does not perform whole-program or
inter-file dataflow. A computed name or an alias with mutation is a deterministic
MANUAL finding.

Each finding is created through `createFinding()`, which normalizes the path,
converts the source range, sets the exact A/B/C classification, and computes
the canonical SHA-256 fingerprint. Findings are sorted before report output.

## 6. SAFE transforms

`edits.js` contains pure transforms that return source-range edits and an
equivalence proof record. The first SAFE transforms are deliberately narrow:

### 6.1 Immutable service alias projection

Given:

```js
const tools = ctx.get('tools')
tools.register(definition)
```

when `tools` is a `const`, initialized exactly once from a literal known service,
and never reassigned, rewrite only the receiver/member range to:

```js
ctx.pluginApi.tools.register(definition)
```

The declaration is removed only when its complete range is an isolated variable
declaration with no initializer side effects. Otherwise the declaration remains
and the use is REVIEW, preventing accidental changes in service lookup timing.

The source-to-facade mapping is frozen as follows:

| Native source service/injection | Facade namespace |
|---|---|
| `agents` injection or `ctx.get('agents')` | `pluginApi.agent` |
| `sessions` injection or `ctx.get('sessions')` | `pluginApi.session` |
| `llm` injection or `ctx.get('llm')` | `pluginApi.llm` |
| `tools` injection or `ctx.get('tools')` | `pluginApi.tools` |
| `systemPrompt` injection or `ctx.get('systemPrompt')` | `pluginApi.systemPrompt` |
| `settings` injection or `ctx.get('settings')` | `pluginApi.settings` |

The rule does not map singular `agent` or `session` service names unless a
versioned rule explicitly declares that runtime identity; those names are
MANUAL by default. The exact public method lists are the ones frozen in
Requirements.

### 6.2 Injection and guard

When a host entry has a static `ctx` parameter and a SAFE receiver projection
introduces `pluginApi`, add `'pluginApi'` once to an existing exported inject
array or add `export const inject = ['pluginApi']` immediately before the entry
function. Add the guarded statement
`if (!ctx?.pluginApi?.isActive) return` as the first non-directive body
statement, preserving any existing directive prologue. If an equivalent guard
already exists, no guard edit is emitted.

If the entry is ambiguous, the transform produces a REVIEW finding and no edit.

### 6.3 Idempotence

The transform recognizes an existing `ctx.pluginApi.<namespace>` receiver and
returns an INFO/SAFE `idempotence` finding in the report's `findings` array with
no edit. It never nests facade calls.

All other rule families produce findings and guidance only in the first release.

## 7. Report, diff, and migration store

`report.js` emits human output and JSON schema 1. JSON arrays are sorted by
normalized file, start byte, end byte, and fingerprint. Unified diffs are
generated from original and proposed text without invoking an external diff
binary.

`migration-store.js` creates:

```text
.dsh/migrations/<migrationId>/
  manifest.json
  migration.patch
  report.json
```

The manifest records root, original revision (`{kind: 'git'|'fixture'|'unknown',
value}`), tool/rule versions, command options, file hashes, edit ownership, and
unresolved finding fingerprints. `--write` first creates a staging directory
containing the complete proposed file set, manifest, patch, and report. It then
commits each file through a temporary sibling plus atomic rename while retaining
originals in the staging backup. If any commit fails, the tool restores every
already committed file from its backup, verifies pre-hashes, and exits non-zero.
If restoration itself fails, it writes an emergency recovery manifest and
refuses to claim success. Rollback accepts either a bare migration id, resolved
under `.dsh/migrations/<id>`, or an explicit migration directory. It compares
every current hash with its recorded post hash before restoring any file; a
mismatch aborts the whole rollback. Rollback itself uses a second temporary
transaction backup. If restoring multiple files fails midway, it records every
restored and unrestored path in `rollback-recovery.json`, attempts to restore
the temporary backup, and exits non-zero with the recovery path; no partial
success is claimed.

`--no-backup` suppresses only persistent original-file copies in the migration
directory. The temporary staging backup and `migration.patch` remain mandatory
for atomic commit and guarded rollback; the patch is the persistent rollback
source when file copies are disabled.

The optional baseline is a report or a JSON object containing `fingerprints`.
`check --baseline` reports added/removed/unchanged fingerprints and fails only
for added findings at or above the inclusive threshold.

## 8. Development audit recorder

`audit.js` exports `createAuditRecorder({ file = '.dsh/migrations/audit.jsonl', clock = Date })` and
`readAuditFile(file)`. The recorder accepts explicit observations from a host or
test harness, normalizes missing metadata to `null`, writes one canonical JSON
object per line, and uses RFC 3339 UTC timestamps. It never patches imports,
installs a loader, or wraps an observed function.

`audit --read` validates each line, preserves valid-record order, returns
malformed-line diagnostics, and exposes records as `auditObservations` in the
standard report shape.

## 9. Host/client and fail-safe boundaries

The scanner is independent of the host runtime and can run with no DSH
installation. It does not import `@deepseek-ai/dsh-*`. The runtime facade's
existing fail-safe behavior is unchanged.

Host and client findings share the same schema but use distinct `surface` and
rule ids. Client wire/ownership transforms remain REVIEW unless an explicit
one-to-one rule is added later. Client C gaps are reported as UNSUPPORTED with
proposal ids.

## 10. Verification strategy

Tests are pure Node tests over fixtures and temporary directories. They cover:

- discovery order, root escape, extensions, and exclusions;
- Babel/ECMA parsing, UTF-8, locations, and parse errors;
- rule selection, protocol downgrade, A/B/C classification, and fingerprints;
- SAFE alias projection, injection, guard, overlap, no-write, and idempotence;
- JSON/diff determinism, baseline/delta, backup, rollback and hash refusal;
- audit write/read and malformed-line diagnostics;
- client markers and C proposal findings;
- real-plugin acceptance reports for `dsh-read-image` and
  `dsh-pro-ex-ability-anchor`. The acceptance command SHALL receive explicit
  local roots; if either root is absent, it emits an ERROR and the acceptance
  batch fails. Each target must run its documented headless smoke/dev boot or
  test command, and the report records the exact command and exit status.

The design intentionally does not include a runtime module loader or transparent
proxy. Such an interception layer would violate the facade's unsupported
escape-hatch policy and could change receiver, lifecycle, or error identity.
