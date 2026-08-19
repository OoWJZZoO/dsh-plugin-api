# Acceptance evidence

This record is kept with the migration-assistant branch. It records the
original revision, scan evidence, unresolved findings, and verification status
for the first available acceptance repositories.

## `OoWJZZoO/dsh-read-image`

- Original revision: `fa0bab0b1ffbf4b0320fc43d064719ea7276543a`
- Scan command: `node scripts/migrate-cli.js scan <root> --json`
- Scan result: passed; host and client findings were emitted for `lib/index.js`,
  `lib/runtime.js`, `lib/client.js`, `lib/config-remote.js`, and `package.json`.
- Unresolved findings: direct `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-llm`,
  and `@deepseek-ai/dsh-typert-protocol` imports are C-class `UNSUPPORTED`;
  event and client manifest findings remain `REVIEW`.
- Verification: `passed` (`23/23` upstream tests). Peer packages were unpacked
  from their published tarballs without modifying the acceptance repository.

## `OoWJZZoO/dsh-extrapro-anchor`

The specification names `dsh-pro-ex-ability-anchor`; the available repository
is the renamed `dsh-extrapro-anchor` target.

- Original revision: `a126e9440d129676b7b0cc7ea61e5cbb37d64546`
- Scan command: `node scripts/migrate-cli.js scan <root> --json`
- Scan result: passed; host/client findings and `package.json` manifest evidence
  were emitted.
- Unresolved findings: direct host package imports, dynamic service reads,
  injection/entry review, and client boundary review remain in the report.
- Verification: `failed` in this Windows headless environment; 88/93 upstream
  tests passed and the five failures are existing Windows path/Git-Bash
  assumptions, not migration edits.

The assistant never marks unavailable targets as migrated or silently treats a
missing verification command as a pass.
