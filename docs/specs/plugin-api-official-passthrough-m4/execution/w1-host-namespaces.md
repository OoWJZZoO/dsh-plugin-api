# W1 Host Namespace Execution Record

## Baseline and Scope

- W0 baseline SHA: `f5acd11645f9c16b6307d14462e5ca8d0d2e15c6`
- Branch: `codex/plugin-api-official-passthrough-m4-host-namespaces`
- Worktree: `.worktrees/plugin-api-official-passthrough-m4-host-namespaces`
- Assigned scope: L11, L12, A12, A13, S7, S8, T12, T13, P9, and ST9.
- Write set: `lib/official-host-namespaces.js`, `test/official-host-namespaces.test.mjs`, and this record only.

The initial `git status --short --untracked-files=all` snapshot was:

```text
?? docs/specs/plugin-api-official-passthrough-m4/execution/w1-host-namespaces.md
?? lib/official-host-namespaces.js
?? test/official-host-namespaces.test.mjs
```

These three untracked paths were the declared W1 write set; no other tracked,
untracked, generated, or provenance-bearing changes were present.

## Implementation

The leaf module exports six explicit factories for the approved host
namespaces. Each factory creates an exact frozen outward face with explicit
member construction, direct `Reflect.apply` forwarding, local disabled-member
failures, and an owner-scoped disposer. Retained facades invalidate before
cleanup; a stale disposer cannot invoke the newer owner's cleanup callback.

The LLM public helpers retain the official function or constructor identity.
Agent options are captured as a frozen exact `{ provider, model, maxTokens }`
snapshot, including absent values as `undefined`. Session target helpers,
tools execution and definition helpers, system-prompt assembly, and settings
operations preserve the official receiver and returned value identity. Settings
lookup failures remain service-unavailable, while malformed members remain
feature-disabled.

No shared event dispatch, freeze, or waterfall behavior is imported or changed.
No central namespace, guard, manifest, service, client, event, or official
package file was modified.

## Verification

- `node --test test/official-host-namespaces.test.mjs` - 10 passed.
- `git diff --check` - passed.
- Final staged write-set audit - passed; the staged name list contains exactly
  the three declared write-set paths.
- Final worktree cleanliness audit - passed after commit; `git status --short
  --untracked-files=all` is empty.

## Requirements and Design Revision Note

No Requirements or Design deviation is known. Dynamic settings lookup and
owner-token lifecycle checks follow the approved failure and cleanup boundary;
integration into existing M0-M3 namespace wiring remains assigned to W2.
