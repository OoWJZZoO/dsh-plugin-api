# Stage 3 Tasks: plugin-api-migration-assistant

> feature_name: `plugin-api-migration-assistant`
> stage: Tasks
> requirements: `requirements.md` schema 1
> design: `design.md`

## Execution rules

- Implement only the tasks below after this Stage 3 document is committed.
- Each top-level batch is one Stage 4 review unit and one implementation
  commit boundary.
- A batch is not complete until its tests, `git diff --check`, and the required
  adversarial review pass.
- No batch may modify official DSH package files.
- The first release remains conservative: only the explicitly listed SAFE
  receiver projections may produce edits; all other findings are report-only.

## Batch 1 — package boundary, discovery, parser, and core contracts

1.1 Add `lib/migrate/` modules for constants, errors, path discovery, UTF-8
source loading, Babel/ECMA parsing, byte locations, and deterministic sorting.

1.2 Add the immutable rule registry with the frozen A/B/C classifications,
host/client mapping table, protocol checks, specificity selection, and initial
SAFE method metadata.

1.3 Add the direct `@babel/parser` dependency, `scripts/migrate-cli.js`, the
`bin` entry, and `exports["./migrate"]` without changing existing host/client
entry points. Verify the CLI in a clean install.

1.4 Add parser/discovery/rule fixtures covering extensions, exclusions, root
escape/symlink, UTF-8 offsets, Babel/ECMA modes, parse errors, and rule
selection. Add unit tests for these contracts.

## Batch 2 — AST analyzer, findings, reports, and baseline checks

2.1 Implement the generic AST walker and analyzers for static DSH imports,
requires, dynamic imports, injection arrays, apply entries, service aliases,
event calls, private/reflective access, and client markers.

2.2 Implement finding construction, exact classification/severity, canonical
fingerprints, locations, deterministic ordering, and the JSON/human report
schema.

2.3 Implement `scan`, `check`, `--fail-on`, `--baseline`, and added/removed/
unchanged fingerprint comparison with deterministic exit codes.

2.4 Implement the `migrate <root>` dry-run/planning path that connects
discovery, parser, analyzer, rule selection, edit planning, and report/diff
generation. Keep write/rollback dispatch behind a stable store interface to be
implemented and wired in Batch 3.4; this batch SHALL not mutate source files.

2.5 Add positive/negative/dynamic/unknown/monkey-patch/client-C fixtures and
tests for JSON determinism, baseline delta, and parse-error no-write behavior.

## Batch 3 — SAFE codemod, injection guard, and transactional migration store

3.1 Implement immutable service alias projection for the exact mappings:
`agents`, `sessions`, `llm`, `tools`, `systemPrompt`, and `settings` to their
facade namespaces, including the explicitly listed public methods.

3.2 Implement SAFE injection insertion, duplicate prevention, optional-chain
fail-safe guard insertion after directive prologues, entry ambiguity REVIEW,
and idempotence findings.

3.3 Implement source-range edit conflict detection, reverse-order application,
unified diff generation, and no-op behavior for non-SAFE findings.

3.4 Implement staging, manifest creation with original revision and unresolved
fingerprints, persistent patch/report artifacts, atomic multi-file commit,
inverse recovery, `--backup/--no-backup`, and guarded rollback by migration id
or directory. Wire the existing `migrate --write` and rollback CLI dispatch to
the transactional implementation and add the final write-path exit handling.

3.5 Add fixtures/tests for SAFE transforms, comments/format preservation,
overlap, receiver mutation, exported entry ambiguity, directive prologues,
multiple existing injections/exports, idempotence, Promise/handle/disposer
identity, unknown argument shape, exact runtime identity mismatch, and
multi-file commit failure, recovery, rollback hash refusal, and rollback failure
recovery. Include both allowed and rejected `--allow-outside-root` paths and
invalid UTF-8 global no-write cases.

## Batch 4 — audit recorder and client/report integration

4.1 Implement the opt-in audit recorder with default
`.dsh/migrations/audit.jsonl`, RFC 3339 UTC timestamps, explicit null metadata,
append-only canonical JSONL, malformed-line diagnostics, and `audit --read`.

4.2 Include `auditObservations` in the standard report and ensure audit write
failures are reported without changing observed plugin behavior.

4.3 Complete client manifest/remote/codec/slot/settings-scope/forwarded-event/
connection findings, C proposal findings, and client-specific guidance. Keep
wire/ownership changes REVIEW unless an explicit SAFE rule exists.

4.4 Add audit and client fixtures/tests, including malformed JSONL, default
path, missing metadata, dynamic namespace C findings, and report integration.

## Batch 5 — real-plugin acceptance and delivery hardening

5.1 Add an acceptance runner that receives explicit local roots for
`dsh-read-image` and `dsh-pro-ex-ability-anchor`, records their original Git or
fixture revision, runs scan/migrate/check, and records exact verification
commands and exit status.

5.2 Require both acceptance targets to finish with `passed`; missing roots,
failed smoke/dev boot, unresolved ERROR findings, or failed post-migration
checks produce a blocking ERROR report.

5.3 Add migration documentation with CLI examples, rule registry/versioning,
rollback and recovery procedures, baseline CI usage, audit integration, and
known unsupported cases.

5.4 Run the full repository test suite plus migration tests, run `git diff
--check`, verify the branch contains no generated dependency artifacts, and
record final evidence in the delivery document.

## Requirements-to-task traceability

| Requirement area | Task coverage | Required evidence |
|---|---|---|
| Discovery, parser, locations, encoding | 1.1, 1.4, 3.5 | unit fixtures and global no-write assertion |
| Finding schema, fingerprints, rule/version selection | 1.2, 2.1, 2.2, 2.5 | deterministic JSON and mismatch tests |
| Imports, services, events, private/client/C findings | 2.1, 2.5, 4.3, 4.4 | host/client fixture matrix |
| SAFE edits, injection, guard, idempotence | 3.1–3.3, 3.5 | diff, receiver, injection, identity tests |
| Dry-run, write, backup, rollback, recovery | 2.4, 3.4, 3.5 | transactional failure and hash refusal tests |
| Baseline and CLI exit codes | 2.3, 2.5 | added/removed/threshold tests |
| Audit write/read | 4.1, 4.2, 4.4 | JSONL round-trip and malformed-line tests |
| Real plugin host/client acceptance | 5.1–5.3 | two passed acceptance reports |

## Definition of done

- All five batches are committed on `feat/plugin-api-migration-assistant`.
- `node --test` passes the migration fixtures and all existing tests that are
  runnable with the declared peer runtime.
- `scan`, `check`, `migrate <root>` (dry-run), `migrate <root> --write`,
  `migrate --rollback <id-or-dir>`, and `audit --read <jsonl>` are documented
  and exercised.
- No unsafe transform is silently applied.
- Both real-plugin acceptance targets have host/client before/after evidence
  and `passed` verification status.
- The final Stage 4 commit exists with a clean working tree. Remote push is a
  delivery action performed separately when credentials and user policy allow.
