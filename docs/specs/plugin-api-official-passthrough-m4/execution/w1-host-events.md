# W1 Host Event Leaves

## Boundary

- Batch: approved Tasks item 3, host event catalog leaves.
- Worktree: `.worktrees/plugin-api-official-passthrough-m4-host-events`.
- Branch: `codex/plugin-api-official-passthrough-m4-host-events`.
- W0 baseline: `f5acd11645f9c16b6307d14462e5ca8d0d2e15c6`.
- Allowed write set: `lib/official-host-events-catalog.js`,
  `test/official-host-events-catalog.test.mjs`, and this execution record.

The initial status snapshot was clean with no tracked or untracked changes. No
untracked input or generated file was used as implementation provenance. The
implementation was reviewed by a blocking Luna(max) agent; its first review
returned findings, which were repaired in this same three-file batch and are
covered by the follow-up verification below. No child agent or reviewer was
created or called by this leaf worker.

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
The predicate catches missing, malformed, or throwing lookups, rejects empty
provider objects and thenables, and does not invoke provider members.

The implementation adds no producer listener, bridge, replay, re-emission,
synthetic payload, event bus change, or central catalog composition. The
integration owner remains the sole owner of composition and native consumer
registration.

## Review and Revision Note

The first blocking Luna(max) review identified four issues: the focused suite
did not demonstrate native dispatch identity, contained listener failure, or
stale native-hook cleanup; the availability predicate accepted malformed empty
objects and thenables; a runtime comment exposed an internal coordination
marker; and this report lacked separate Requirements/Design revision notes and
accurate export-shape wording. The implementation and tests were revised only
within the allowed three-file write set. No Requirements or Design acceptance
boundary changed.

Requirements revision note: no deviation from the approved nine event rows,
five slices, eight-field schema, optional-producer isolation, or catalog-only
boundary. The added tests now exercise the approved direct-dispatch identity,
contained failure, and stale-cleanup behavior through the existing bus seam.

Design revision note: no producer bridge, replay, re-emission, synthetic
payload, or central composition path was added. The guard now treats an empty
provider object and a thenable as malformed and therefore unavailable, while
remaining fail-open for the affected slice.

## Verification

Focused command:

```text
node --test test/official-host-events-catalog.test.mjs
```

Actual result after review repair: 8 tests passed, 0 failed. The suite covered
exact five-slice/nine-row grouping, exact metadata and field order, recursive
immutability, provider-missing isolation, malformed provider rejection,
direct official dispatch with payload/argument identity, contained listener
failure, stale native-hook cleanup, and absence of producer/central wiring in
the leaf source.

Additional required command:

```text
git diff --check
```

Actual result after review repair: passed with no whitespace errors. No
Requirements or Design acceptance boundary was changed; the minimal export
shape is a frozen `officialHostEventCatalogSlices` array whose five records
expose `name`, `catalog`, and `isAvailable` for the integration owner. The
review-repair commit SHA is reported by the coordinator handoff.
