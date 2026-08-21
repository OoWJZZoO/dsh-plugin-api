# W1 Services Execution Record

## Baseline and Scope

- W0 baseline SHA: `f5acd11645f9c16b6307d14462e5ca8d0d2e15c6`
- Branch: `codex/plugin-api-official-passthrough-m4-services`
- Worktree: `.worktrees/plugin-api-official-passthrough-m4-services`
- Approved top-level task: W1 services fragment
- Write set: `lib/official-service-definitions.js`, `test/official-service-definitions.test.mjs`, and this record only.

The initial `git status --short --untracked-files=all` snapshot was clean. No
pre-existing tracked edits, untracked files, generated files, or other
provenance-bearing changes were present in this worktree. The batch contains no
edits to frozen files, official package paths, manifests, the central service
table, or other documentation.

## Implementation

The fragment contains the 28 approved service keys and 113 approved members.
Each service definition contains only `key`, `ctxService`, and `members`; each
member contains only `kind` and `name`. The complete fragment is deeply frozen,
uses only method and getter entries, and does not infer or proxy any service
surface.

Focused tests use the existing `buildActiveFacade` and `buildDisabledFacade`
seam. They cover exact names and kinds, immutable data, negative private-member
boundaries, receiver and argument identity, getter identity, falsey values,
Promise identity, disposer identity, thrown and rejected error identity,
per-service missing-member degradation, missing-service degradation, and root
namespace availability with one unavailable service.

## Verification

- `node --check lib/official-service-definitions.js && node --check test/official-service-definitions.test.mjs` - passed.
- `node --test test/official-service-definitions.test.mjs` - 6 passed.
- `node --input-type=module -e "import { OFFICIAL_SERVICE_DEFINITIONS } from './lib/official-service-definitions.js'; import { SERVICE_DEFINITION_CONTRACTS } from './test/official-passthrough-contracts.mjs'; const normalize = (xs) => xs.map(({ key, ctxService, members }) => [key, ctxService, members.map(({ name, kind }) => [name, kind])]); if (JSON.stringify(normalize(OFFICIAL_SERVICE_DEFINITIONS)) !== JSON.stringify(normalize(SERVICE_DEFINITION_CONTRACTS))) process.exit(1); console.log('fragment matches W0 service contract: 28 definitions, 113 members')"` - exact match: 28 definitions, 113 members.
- `node --test test/official-service-definitions.test.mjs test/official-passthrough-contracts.test.mjs` - 10 passed.
- `node --test test/services-definitions.test.mjs test/services-passthrough.test.mjs test/plugin-api-service.test.mjs` - 34 passed.
- `git diff --check` - passed.
- Governance/metadata token audit over the three allowed paths - no runtime fragment metadata or generic proxy implementation; exact object-key assertions cover the neutral shape.
- Pre-commit write-set audit: only the three allowed paths were changed.
- Final worktree audit after commit: clean; no untracked files remained.

## Requirements and Design Revision Note

No Requirements or Design deviation occurred. The implementation follows the
approved neutral static fragment contract and leaves integration of the central
definition table to the parent W2 batch.
