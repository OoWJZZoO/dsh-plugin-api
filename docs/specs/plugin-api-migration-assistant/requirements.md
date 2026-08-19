# Feature Requirements: plugin-api-migration-assistant

> feature_name: `plugin-api-migration-assistant`
> stage: Requirements
> parent goal: `goal.md`
> requirements schema: `1`

## Introduction

The migration assistant is a build-time and development-time tool for moving
third-party DeepSeek Harness plugins from direct DSH API usage to the supported
`pluginApi` facade. It is deliberately conservative: an automatic transform is
allowed only when the rule proves that the source call shape and lifecycle
semantics remain equivalent.

The tool is not a runtime interception layer. It does not change official DSH
packages and does not claim that an arbitrary plugin can be migrated without
human review.

## Terminology and frozen enums

- `SAFE`: a registered, semantics-preserving source transform permitted by
  `migrate --write`.
- `REVIEW`: a likely facade mapping that requires human confirmation.
- `MANUAL`: a finding with guidance but no generated source transform.
- `UNSUPPORTED`: a direct use outside the current facade contract or a C-class
  upstream proposal.
- `INFO`, `WARN`, `ERROR`: report severity, ordered by ERROR > WARN > INFO.
- `host`: the Cordis plugin entry and host-side facade/services.
- `client`: `exports["./client"]`, `dsh.client` manifest, remote, codec, slot,
  settings-scope, forwarded-event, and connection surfaces.
- `rule registry version`: a `major.minor` decimal version. Minor versions are
  numeric (`0.9` precedes `0.10`); it is independent of the full DSH runtime
  identity.
- `classification`: exactly one of `SAFE`, `REVIEW`, `MANUAL`, or
  `UNSUPPORTED`.
- `aClass`: exactly one of `A`, `B`, `C`, `infrastructure`, or `unknown`.
- Static parsing uses UTF-8 source bytes. A location is
  `{line, column, byte}` with one-based line/column and zero-based byte offset.

## A/B/C coverage matrix

| Surface | Initial rule class | Automatic scope |
|---|---|---|
| Host A-class service and event pass-through | A | SAFE where the call and receiver are statically proven |
| Host B-class semantic hooks | B | REVIEW guidance only |
| Host C-class proposals | C | UNSUPPORTED/proposal report only |
| Client manifest/remote/codec/slot/connection | A/B | scan all; SAFE only for explicit one-to-one helpers |
| Client C-class gaps (dynamic namespace discovery, dynamic settings namespaces) | C | UNSUPPORTED/proposal report only |
| Dynamic access, reflection, private fields | unknown | MANUAL; never SAFE |

The initial SAFE rule set SHALL cover only the following public host calls when
their static receiver and arguments are proven:

`agent.get/list/roots`, `session.get/list/fork`, `session.header/events/seq/surface`,
`session.requestHeader/requestContext/deriveMessages`,
`tools.register/restrict/guard/get/schemas/execute/presentAs`,
`llm.modelInfo/prepareCall/stream/registerAdapter/`
`registerConfigurableProviders/registerModelDiscovery`,
`systemPrompt.section/context/variable/tools/suppressRuntimeContext/render/`
`renderContextSections`,
and `settings.register/scope/describe/installSettingsSection`.

The initial client rule set SHALL scan manifest, remote, codec, slot, settings
scope, forwarded event, and connection usage, but SHALL classify any transform
that changes wire shape or ownership as REVIEW until an explicit rule proves
equivalence.

## Requirements

### 1. Source discovery and deterministic configuration

**WHEN** the user runs `scan`, `check`, or `migrate` on a plugin root
**THEN** the tool SHALL discover files with extensions `.js`, `.mjs`, `.cjs`,
`.ts`, `.mts`, and `.cts`, excluding `node_modules`, `.git`, `dist`, `build`,
`coverage`, and `.dsh/migrations` by default.

**WHEN** include or exclude paths are supplied
**THEN** the tool SHALL resolve them relative to the requested root, reject a
path that escapes that root unless `--allow-outside-root` is supplied, and apply
include filters before exclude filters.

**WHEN** no explicit file order is supplied
**THEN** the tool SHALL sort normalized POSIX-relative paths lexicographically
and use that order for parsing, reporting, edit application, and fingerprints.

**WHEN** no parser mode is supplied
**THEN** the tool SHALL use `babel` mode with ECMAScript modules, JSX,
TypeScript, decorators, class properties, and import attributes enabled; the
only other mode SHALL be `ecma`, which parses JavaScript using the latest
supported ECMAScript grammar and does not claim TypeScript support.

**WHEN** source bytes are read
**THEN** the tool SHALL decode UTF-8 without lossy replacement and SHALL report
an `encoding-error` rather than guessing for invalid input.

### 2. Parsing and parse failures

**WHEN** a discovered source file is valid JavaScript or TypeScript supported by
the selected parser mode
**THEN** the tool SHALL parse it and attach one-based line, column, and byte
offset locations to every finding.

**WHEN** a source file cannot be parsed
**THEN** the tool SHALL emit exactly one `parse-error` finding for that file,
continue scanning other files, and set the command result to unsuccessful for
`check` and `migrate`.

### 3. Finding identity and report schema

**WHEN** the tool emits a finding
**THEN** it SHALL include `schemaVersion: 1`, stable `ruleId`, `classification`,
`severity`, `kind`, normalized `file`, `start`, `end`, `message`, and
`suggestion` fields, and `fingerprint` whenever the finding has a source range.

**WHEN** a finding has a stable source range
**THEN** its fingerprint SHALL be the lowercase SHA-256 digest of the canonical
JSON array `[ruleId, normalizedFile, start.byte, end.byte, symbolOrNull]`, where
`normalizedFile` is a POSIX-relative path and `symbolOrNull` is the static
symbol name or JSON `null`.

**WHEN** a JSON report is written
**THEN** it SHALL include `toolVersion`, `ruleRegistryVersion`, `root`,
`files`, `findings`, `edits`, `counts`, `diagnostics`, and `success`; arrays
SHALL use the deterministic order `(file, start.byte, end.byte, fingerprint)`.

### 4. Direct DSH import and require detection

**WHEN** a plugin statically imports or requires an `@deepseek-ai/dsh-*`
package
**THEN** the tool SHALL emit a finding containing the package name, imported
symbols when statically known, host/client surface, and the selected registry
rule.

**WHEN** a plugin uses a dynamic or computed package specifier
**THEN** the tool SHALL emit `dynamic-import` with `MANUAL` classification and
SHALL not rewrite the expression.

**WHEN** a direct package has no facade mapping
**THEN** the tool SHALL emit `UNSUPPORTED` with either a named upstream proposal
or an explicit “no mapping” reason.

### 5. Service, injection, and event detection

**WHEN** a plugin statically resolves a known DSH service through `ctx.get`, a
known Cordis injection declaration, or a supported public context accessor
**THEN** the tool SHALL emit a finding for the service and the corresponding
facade namespace when one exists.

**WHEN** a service name is computed, unknown, or read through reflection
**THEN** the tool SHALL emit `dynamic-service-access` with `MANUAL` classification
and SHALL leave the source unchanged.

**WHEN** a plugin subscribes to or dispatches a known DSH event through `on`,
`once`, `emit`, `serial`, `parallel`, `bail`, or `waterfall`
**THEN** the tool SHALL emit a finding containing the event name, host/client
surface, catalog status, A/B/C class, and rule classification.

**WHEN** an event name is computed or not present in the catalog
**THEN** the tool SHALL emit `dynamic-event` or `unknown-event` as `MANUAL` and
SHALL not rewrite it.

### 6. Private behavior and monkey-patch detection

**WHEN** a plugin assigns to, replaces, or wraps a known official method or a
private-looking property
**THEN** the tool SHALL emit `monkey-patch` with `REVIEW` classification
and SHALL never rewrite it in SAFE mode.

**WHEN** a plugin reads an unknown property from an official DSH object or uses
prototype/reflection operations on it
**THEN** the tool SHALL emit `dynamic-access` with `MANUAL` classification and
preserve the source.

### 7. Versioned rule registry

**WHEN** the tool loads a migration rule
**THEN** the rule SHALL declare `id`, `registryVersion`, `source` pattern,
`surface`, `aClass` (`A`, `B`, `C`, `infrastructure`, or `unknown`), `classification`,
`target` or guidance, `minApiProtocol` (`major.minor`), and an equivalence
explanation.

The registry SHALL use `aClass: unknown` for dynamic, unclassified, or
reflection-based findings; those findings SHALL always use
`classification: MANUAL`. Static unknown packages or proposals without a
facade target SHALL use `aClass: C` and `classification: UNSUPPORTED`.

**WHEN** the installed facade API protocol does not satisfy `minApiProtocol`
**THEN** the tool SHALL downgrade a SAFE rule to REVIEW and SHALL report the
declared and required protocols.

**WHEN** a rule depends on an exact DSH runtime identity
**THEN** the rule SHALL declare that identity separately from `minApiProtocol`
and the tool SHALL refuse SAFE application when the identity is unknown or
does not match.

**WHEN** multiple rules match one finding
**THEN** the tool SHALL select the highest-specificity rule, break ties by
stable rule id, and record both the selected rule and rejected candidates.

### 8. SAFE codemod contract

**WHEN** the user runs `migrate --write` and a finding is classified `SAFE`
**THEN** the tool SHALL apply only the registered source-range edits for that
finding, preserve all unedited bytes, and record `ruleId`, before/after text
hashes, and source ranges.

**WHEN** edits overlap or a precondition is not satisfied
**THEN** the tool SHALL apply none of the edits for that file, emit
`edit-conflict` or `edit-precondition-failed`, and leave the file byte-for-byte
unchanged.

**WHEN** a transformation would alter an exported symbol, callback receiver,
Promise/handle/disposer identity, or an argument whose static shape is unknown
**THEN** the tool SHALL classify it as REVIEW and SHALL not rewrite it in SAFE
mode.

**WHEN** a file has already been migrated by the same rule registry
**THEN** a second run SHALL produce zero edits and one `idempotence` finding
with `INFO` severity and `SAFE` classification for each already-converged file.

### 9. Facade injection and entry identification

**WHEN** a SAFE host transform introduces a `pluginApi` reference
**THEN** the tool SHALL add exactly one `inject` declaration containing
`'pluginApi'`, preserve all existing injection entries and exports, and add a
guard equivalent to `if (!ctx?.pluginApi?.isActive) return` only when the entry
function has a statically provable `ctx` parameter; when a directive prologue is
present, the guard SHALL be the first non-directive statement.

**WHEN** a plugin entry is identified by `package.json.main`, an exported
`apply` function, or a `dsh.client` declaration
**THEN** the tool SHALL record the selected entry kind in the report.

**WHEN** multiple possible host entries exist or the injection edit cannot be
proven safe
**THEN** the tool SHALL emit `facade-injection-required` as REVIEW and leave
the source unchanged.

### 10. Client boundary

**WHEN** a client file exposes `exports["./client"]`, `dsh.client`, remote,
codec, slot, settings-scope, forwarded-event, or connection usage
**THEN** the tool SHALL scan it, label it `client`, and include the relevant
wire/lifecycle contract in the finding.

**WHEN** a client transform would change a descriptor, RPC endpoint, remote
namespace, slot key, or disposer ownership
**THEN** the tool SHALL classify it as REVIEW and SHALL not apply it in SAFE
mode unless a rule explicitly declares the exact wire equivalence.

**WHEN** a client uses dynamic remote namespace discovery or a third-party
settings namespace that depends on an official hard-coded allowlist
**THEN** the tool SHALL classify it as `UNSUPPORTED`, `aClass: C`, and include
the corresponding upstream proposal id when one is registered.

### 11. Dry-run, backup, and rollback

**WHEN** the user runs `migrate` without `--write`
**THEN** the tool SHALL produce a deterministic unified diff and JSON report
without modifying any source file.

**WHEN** the user runs `migrate --write`
**THEN** the tool SHALL create `.dsh/migrations/<migrationId>/manifest.json`
and a patch artifact before the first mutation, recording pre/post SHA-256
hashes for every changed file.

**WHEN** the user runs `migrate --rollback <migrationId>`
**THEN** the tool SHALL restore only files whose current hash equals the
recorded post hash and SHALL refuse the entire rollback if any owned file has
changed since migration. `<migrationId>` MAY be a bare id resolved below
`.dsh/migrations/` or an explicit migration directory.

**WHEN** a write or rollback transaction fails after one or more files have been
replaced
**THEN** the tool SHALL attempt inverse restoration, record restored and
unrestored paths in a recovery manifest, exit non-zero, and SHALL not report a
partial success.

### 12. CLI behavior and exit codes

**WHEN** `scan` completes without infrastructure failure
**THEN** it SHALL exit zero regardless of findings and SHALL report counts.

**WHEN** `check` finds a parse error, an ERROR finding, or a finding at or above
the configured `--fail-on` threshold (the threshold is inclusive and defaults
to `ERROR`)
**THEN** it SHALL exit non-zero; otherwise it SHALL exit zero.

**WHEN** `check --baseline <path>` is supplied
**THEN** the tool SHALL compare finding fingerprints against the baseline and
fail only for new fingerprints at or above the inclusive threshold; removed or
unchanged findings SHALL be reported but SHALL not fail the check.

**WHEN** a parse or encoding error exists during `migrate --write`
**THEN** the tool SHALL create no source mutation, even in files that otherwise
have SAFE edits.

**WHEN** `migrate --write` applies no edits because all findings require review
or are unsupported
**THEN** it SHALL exit zero if parsing and report writing succeeded and SHALL
state that no automatic changes were made.

**WHEN** an internal exception, invalid configuration, or unsafe path occurs
**THEN** the command SHALL exit non-zero without partial source mutation.

### 13. Development audit recorder

**WHEN** a host or test harness explicitly submits a direct-access observation
to the audit recorder
**THEN** the recorder SHALL persist plugin, module, operation, normalized
location when available, rule id when known, timestamp, and audit schema
version without modifying the observed call. Timestamps SHALL be RFC 3339 UTC
strings and the default persistence target SHALL be
`.dsh/migrations/audit.jsonl`.

**WHEN** audit metadata is missing
**THEN** the recorder SHALL use explicit `null` fields rather than guessing and
SHALL remain usable in a headless test.

The first implementation SHALL provide this recorder as an opt-in development
API; it SHALL not install a module loader, Proxy, or runtime interception hook.

The JSONL file is the append-only read contract: `audit --read <path>` SHALL
parse every valid line, preserve the recorded order, report malformed lines as
diagnostics, and include the observations in the standard JSON report under
`auditObservations`.

### 14. Verification and migration evidence

**WHEN** a SAFE rule is added or changed
**THEN** the repository SHALL include positive, negative, overlap,
parse-error, and idempotence fixtures, and `node --test` SHALL exercise them.

**WHEN** a real plugin is migrated
**THEN** the migration record SHALL include original revision, tool version,
rule registry version, generated diff, unresolved findings, and verification
status (`passed`, `failed`, or `not-run`).

The first real-plugin acceptance targets SHALL be `dsh-read-image` and
`dsh-pro-ex-ability-anchor`, with direct host and client findings listed before
and after migration. Client evidence SHALL include manifest, remote, codec,
slot, settings-scope, forwarded-event, connection, or panel-bundle findings
when present, plus the generated diff and verification result; unresolved B/C
findings SHALL be explicitly reviewed. Both acceptance targets SHALL finish
with verification status `passed`; `not-run` is permitted only for non-
acceptance plugins.

## Explicit non-requirements

- The tool does not promise to migrate arbitrary plugins automatically.
- The tool does not create missing upstream DSH semantics.
- The tool does not rewrite direct internal imports that have no facade mapping.
- The tool does not patch official DSH package files or intercept already-loaded
  modules at runtime.
