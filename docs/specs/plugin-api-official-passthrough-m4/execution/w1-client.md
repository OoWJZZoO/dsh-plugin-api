# W1 Client Leaf Execution Record

## Boundary

- W0 baseline: `f5acd11` (`fix(m4): keep W0 service construction static`)
- Worktree: `.worktrees/plugin-api-official-passthrough-m4-client`
- Branch: `codex/plugin-api-official-passthrough-m4-client`
- Owner: W1 client leaf batch
- Scope: C10-C25

The batch implements only the client service, event, and connection leaf
factories assigned by Tasks. It does not wire the leaves into the existing
client outer facade; that central composition remains owned by W2.

## Write-set and provenance audit

The only changes in this batch are the following files:

- `lib/client-official-services.js`
- `lib/client-official-events.js`
- `lib/client-official-connection.js`
- `test/client-official-services.test.mjs`
- `test/client-official-events.test.mjs`
- `test/client-official-connection.test.mjs`
- this execution record

The worktree was checked with `git status --short --untracked-files=all`
before the batch was recorded. All six implementation/test files were newly
untracked batch files; no pre-existing user or generated changes were
reclassified or removed. No frozen file, manifest, official DSH package path,
or another worker's execution record was modified.

## Implementation summary

- Added exact whitelist adapters for the approved client services. Value
  members remain lazy getters, callable members retain the official receiver,
  and no generic proxy or extra provider members are exposed.
- Added independent client event leaves for the four approved event names.
  The adapters support the official source subscription forms used by the
  client runtime, preserve argument identity and order, contain observer
  failures, and use stale-safe owner/disposer handling.
- Added the nested client connection LLM face with exactly `providers`,
  `models`, and `discoverModels`, forwarding receiver, arguments, signal,
  Promise, and error behavior.
- Applied per-leaf optional resolution and P4 degradation. A missing or
  malformed optional provider disables only its owning leaf; repeated apply
  and out-of-order cleanup cannot remove a newer owner.

## P4 protocol decision

W0 records the approved M4-specific extension of the existing P4 wording from
service leaves to all optional client leaf kinds: client services, client
events, and the client connection face each have a local disabled facade.
This is a protocol/documentation decision only. It introduces no new error
type or central runtime path and does not change the existing P1-P4 failure
semantics.

## Verification

Focused command:

```text
node --test test/client-official-services.test.mjs test/client-official-events.test.mjs test/client-official-connection.test.mjs
```

Result: 25 passed, 0 failed, including regression coverage for native event
disposer failures, malformed method/value accessors, EventTarget cleanup, and
connection method revalidation.

Additional checks:

- `git diff --check`: passed before commit.
- Luna(max) review found two local fail-safe gaps: native event disposer failures
  were silently swallowed, and method accessors were not validated at the call
  boundary. The repeat review found four additional accessor/lifecycle gaps;
  all six findings were corrected with focused regression tests. The next
  repeat review found two lifecycle/fallback gaps: stale aggregate disposal
  reported success instead of a no-op, and disabled event leaves reported a
  shared feature name. Both were corrected with focused regression tests; the
  corrected batch is pending the required repeat review.
- Official client declarations and implementations were inspected for the
  approved provider member shapes and connection LLM methods.
- The official DSH installation under `/usr/lib/node_modules/@deepseek-ai/dsh`
  was read-only during this batch.

## Requirements/Design revision note

No Requirements or Design acceptance boundary changed. The implementation
follows the approved exact whitelists, direct event adaptation, nested LLM
connection face, optional-provider fail-open resolution, per-leaf P4
degradation, and stale-safe cleanup rules. No additional deviation is
recorded.
