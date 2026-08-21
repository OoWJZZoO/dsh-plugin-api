# W1 Host Event Leaves

## Boundary

- Batch: approved Tasks item 3, host event catalog leaves.
- Worktree: `.worktrees/plugin-api-official-passthrough-m4-host-events`.
- Branch: `codex/plugin-api-official-passthrough-m4-host-events`.
- W0 baseline: `f5acd11645f9c16b6307d14462e5ca8d0d2e15c6`.
- Allowed write set: `lib/official-host-events-catalog.js`,
  `test/official-host-events-catalog.test.mjs`, and this execution record.

The initial status snapshot was clean with no tracked or untracked changes. No
untracked input or generated file was used as implementation provenance. No
child agent or reviewer was created or called; the parent integration owner
handles the required batch review.

## Delivered Leaf

The leaf module declares five independent frozen slices containing exactly nine
event rows. Each row uses only the existing fields, in the required order:
`name`, `mode`, `scopeFiltered`, `scopeKey`, `payload`, `args`, `fault`, and
`freeze`. Every row is an `emit` event with `scopeFiltered: false`,
`scopeKey: undefined`, `fault: 'contain'`, and `freeze: 'all'`.

The five slices are agent-loop configuration failure, agent preset selection,
dynamic Cordis lifecycle, Cordis inspection lifecycle, and storage-domain
change. Each slice provides only its frozen catalog and a narrow fail-open
availability predicate that resolves the owning provider through `ctx.get`.
The predicate catches missing, malformed, or throwing lookups and does not
inspect or invoke provider members.

The implementation adds no producer listener, bridge, replay, re-emission,
synthetic payload, event bus change, or central catalog composition. W2 remains
the sole owner of composition and native consumer registration.

## Verification

Focused command:

```text
node --test test/official-host-events-catalog.test.mjs
```

Actual result: 5 tests passed, 0 failed. The suite covered exact
five-slice/nine-row grouping, exact metadata and field order, recursive
immutability, provider-missing isolation, and absence of producer/central
wiring in the leaf source.

Additional required command:

```text
git diff --check
```

Actual result: passed with no whitespace errors. No Requirements or Design
acceptance boundary was changed; the minimal export shape is a frozen
`officialHostEventCatalogSlices` array whose five records expose `name`,
`catalog`, and `isAvailable` for W2 consumption. The final leaf-only commit SHA
is reported by the worker handoff.
