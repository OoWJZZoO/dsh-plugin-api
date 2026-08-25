# Stage 3 - Tasks: attachment-pipeline

> feature: `attachment-pipeline`
> worktree: `.worktrees/second-attachments` / branch `feat/second-attachments`
> status: Stage 3 draft only; this document is not authorization to enter Stage 4.

## Stage boundaries and source of truth

- The approved Requirements are `docs/specs/attachment-pipeline/requirements.md`
  (Requirements content committed in `c1739b8ca9bd954e47df00b2113ac143af9512ef`;
  status synchronization is in `68002c43c27f7b590aa5b49fd4590a88ceb712d0`).
  AP-1 through AP-10 are the complete acceptance boundary; this task draft does
  not add, remove, or reinterpret an AP acceptance criterion.
- The submitted Stage 2 Design boundary is
  `8fc3699485944cc94e796cbe099493fba202d3af`, with approved Design metadata
  amended by `c1d49d656beb0770b15483e7adce662d732ba0a4` and the current
  second-batch status baseline at `68002c43c27f7b590aa5b49fd4590a88ceb712d0`.
  The only Design amendment represented by this feature task draft is the
  already-decided duration policy: reliable decoder metadata, finite
  non-negative millisecond values, inclusive comparison, fail-closed missing
  decoder/metadata handling, and repeat validation during transform.
- The parallel-worktree contract is the temporary, non-deliverable
  `temp/second-batch-parallel-contract.md`. This task draft explicitly follows
  its §0 (Stage 3 approval and submitted-boundary gate), §1 (attachment R owner
  and soft interop only), §2 (frozen vocabulary), §3 (naming and shared-file
  ownership), §4 (failure presentation), §5 (merge/integration ownership), §6
  (minimum task-book fields), §7 (verification evidence), and §8 (R1-R9
  constraints). The temporary contract is not edited or promoted to a spec.
- This worktree's Stage 3 write scope is limited to
  `docs/specs/attachment-pipeline/design.md` and this `tasks.md`. No checkbox
  below is executable in the current turn. After this task document is
  explicitly approved and the required Stage 3 document commit is made, a
  separate Stage 4 execution may consume the checklist.

## Frozen vocabulary and minimum contract

The implementation tasks must use the §2 vocabulary from the temporary
contract. `attachmentId` is `sha256:<hex>`; `recordId` is opaque; every record
and registration carries explicit `ownerId + generation`; each durable record
has exactly one `session | workspace | profile` scope; `origin` is only
`original | derived`; and `commitState` is only
`success | error | aborted | denied | superseded`. Admission evidence is
`{ accepted: boolean, source: string, observedAt: string }`; missing or malformed
admission is `unavailable` and is never inferred. `timeout-error`, `settled`,
`closed`, and `disposed` must not become outcome values.

Before adding the pipeline slice, the replacement must preserve at least the
official contract named by AP-1 and the Stage 2 Design: `ctx.attachments`, its
configuration/defaults, `imageLimits`, `validateImage`, `saveImage`,
`readImage`, typed attachment errors, full decode and declared-media-type
matching, `sha256:` content addressing, durable atomic publication,
digest/metadata verification, caller cancellation, disposal behavior, and the
observed zero-event face. The added host surface is the separate
`ctx.attachmentsPipeline` service and the marker-gated `pluginApi.attachments`
facade; it does not change the official package import face.

## Stage 4 file and ownership boundary

After the Stage 3 gate, the attachment leaf may modify only the following
feature-owned implementation and test paths:

- `packages/attachments/**` (replacement package, fork, pipeline, journal,
  apply code, and package-focused tests);
- the attachment-owned row in `packages/full/cordis.patch.yml`;
- attachment-owned append-only slots in `lib/index.js` and
  `lib/plugin-api-service.js`, without reordering or refactoring existing
  feature slots;
- attachment-focused root tests whose names are unambiguously attachment
  owned; and, only when the approved execution requires it, this feature's own
  spec/task synchronization.

The following are forbidden to the attachment leaf: the root package/version
metadata and `lib/version.js`; `lib/guards.js`; frozen event, dispatch, catalog,
freeze, catalog-compose, and wrap-safety modules; client files; another
feature's implementation/spec or patch row; `feature-list.md` rows other than
read-only verification of the existing U10 entry; the temporary contract;
`AGENTS.md`; consumer repositories; and every file under the installed
official DSH packages. The leaf must not add an events catalog slice, a
`FEATURE_MOUNTERS` guard branch, a second replacement owner, or any
cross-component replacement. Main-package version bumps, full-bundle
dependency/version alignment, complete profile equivalence, and final merge
assembly belong to the integration owner under temp contract §5 and are not
leaf edits.

## Stage 4 commit and evidence boundary

The future attachment Stage 4 commit must contain the completed
attachment-owned implementation, focused tests, the attachment-owned full-patch
row, and only this feature's approved spec synchronization. It must not contain
root version bumps, unrelated full-bundle assembly, another feature's changes,
or consumer-repository edits. Before that commit, the executor must pass
`git diff --check`; after it, the worktree must be clean. Stage 3 approval and
the Stage 3 document commit are prerequisites to Stage 4, and this draft does
not waive either gate. No commit is requested or permitted in the current
worktree turn.

## Tasks

Execution order is top to bottom. Every item is an unchecked, testable Stage 4
prompt with its AP references; a later item must not be started before the
earlier item leaves an integrated, tested surface.

### 1. Official R replacement package and contract fork

- [ ] 1.1 Create the attachment auxiliary package and its official patch entry
  under `packages/attachments/`: disable exactly `attachment-local` and insert
  exactly one `plugin-api-attachments` row through the official patch mechanism;
  add only the attachment row to the full-bundle patch. Preserve the main/
  auxiliary full-version and `dsh.api` agreement without changing root version
  metadata. Test patch composition, absent-row behavior, reversibility, and
  duplicate-row rejection. (AP-8, AP-9)
- [ ] 1.2 Add the vendored official local-store fork and local invariant helper
  only after recording the locked official baseline. Preserve the minimum
  `ctx.attachments` service/config/disposal/event face, image limits, full
  decode, declared media-type matching, `sha256:` identity, atomic publication,
  digest/metadata verification, typed errors, and caller cancellation; when the
  official row has no events, the replacement must add no events or catalog
  slice. Test the official behaviors against the audited runtime baseline and
  assert the zero-event face. (AP-1, AP-9)
- [ ] 1.3 Test the import boundary and package manifest: imports of
  `@deepseek-ai/dsh-attachment` and `@deepseek-ai/dsh-attachment-local` remain
  official, the helper does not claim an official package identity, shared host
  packages remain peer dependencies, and no installed official DSH file is
  modified. (AP-1, AP-8, AP-9)

### 2. Attachment record, identity, scope, and source ingestion

- [ ] 2.1 Implement pure record/model validators in
  `packages/attachments/lib/pipeline-core.js`: derive `attachmentId` only from
  verified bytes; keep `recordId` opaque; require `ownerId`, generation, and one
  scope; distinguish `original` and `derived`; restrict `commitState` to the
  five frozen values; and return deep-frozen records with bounded typed
  failures. Test record shape, identity stability, scope, origin, terminal
  vocabulary, and immutability. (AP-2, AP-4, AP-6, AP-7)
- [ ] 2.2 Implement the five source adapters (`file`, `paste`, `data-uri`,
  `remote`, and `mcp-resource`) using only the approved public seams. Record
  bounded provenance, never use path/URL/object URL/display name as identity,
  require explicit owner/generation/scope, and publish only after bytes,
  declared media type, metadata, and digest are verified. Preserve the caller
  signal for the approved remote/MCP/read seams. Test same-bytes/different-source
  identity, all source kinds, source provenance, and cancellation propagation.
  (AP-2, AP-3, AP-6)
- [ ] 2.3 Make source, trust, declaration, deadline, concurrency, and
  unsupported-media failures explicit and side-effect free: return the approved
  typed `error`/`unavailable` result, write no record/journal entry, and expose
  no raw bytes or source secrets. Test redacted bounded reasons and
  no-publication behavior. (AP-2, AP-3, AP-10)

### 3. Media profiles, duration policy, and atomic batch publication

- [ ] 3.1 Implement the approved media profiles and effective policy in
  `pipeline-core.js`: official full-decode raster validation for
  `image/png|jpeg|webp|gif`; bytes-only `application/octet-stream`; and
  `audio/*`/`video/*` only when an approved decoder supplies reliable complete
  media metadata. For timed media, treat `maxDurationMs` and decoder-produced
  `observedDurationMs` as millisecond values that must both be finite and
  non-negative; reject `NaN`, infinities, negatives, strings, and coercion.
  Do not use caller-declared duration, headers, or byte count as decoder
  metadata. Apply official image limits and the configured byte/pixel/media,
  trust, deadline, and concurrency bounds without a bypass path. (AP-1, AP-3)
- [ ] 3.2 Encode the duration failure semantics exactly: a timed profile with
  no configured `maxDurationMs`, no approved decoder, or no reliable decoder
  metadata fails closed without publishing and returns
  `ATTACHMENT_MEDIA_UNSUPPORTED` / `unavailable`; a configured duration
  policy containing `NaN`, infinity, a negative value, a string, or another
  non-finite/non-negative violation returns `ATTACHMENT_POLICY_INVALID` /
  `unavailable`; and
  `observedDurationMs > maxDurationMs` returns
  `ATTACHMENT_DURATION_TOO_LONG` / `denied` without a journal write or new
  generation. The inclusive boundary `observedDurationMs === maxDurationMs`
  and every smaller finite value must pass the duration check. Keep
  `durationMs` optional in record media and absent for raster/blob profiles.
  (AP-3)
- [ ] 3.3 Implement frozen `pipeline.capabilities()` and batch validation.
  Validate every member's media, byte, pixel, and applicable duration policy
  before aggregate limits and before any batch-level publication; a rejected
  member leaves no partial record, object reference, provenance, or journal
  state. Test capabilities immutability, full-decode/type/byte/pixel checks,
  finite/non-negative duration values, equal/under/over duration boundaries,
  missing decoder/metadata, invalid policy, bounded rejection, batch success,
  member duration failure, and retry-after-failure with no partial publish.
  (AP-2, AP-3, AP-7)

### 4. Transform generations and ownership guards

- [ ] 4.1 Implement `pipeline.registerTransform` with explicit
  `ownerId + generation`, input/output media bounds, byte/deadline/concurrency
  policy bounds, async `run` signal propagation, latest-wins keyed by
  `(ownerId, id)`, and an idempotent identity-bound disposer that cannot remove
  a newer registration. Define the effective policy as the most restrictive
  intersection of pipeline config, operation policy, and any caller deadline;
  reject a transform that cannot acquire its bounded concurrency slot with
  typed `ATTACHMENT_TRANSFORM_DENIED` / `denied`. Test duplicate registration,
  media mismatch, deadline/concurrency rejection, old-disposer isolation, and
  disposer idempotence. (AP-3, AP-4, AP-6)
- [ ] 4.2 Implement `pipeline.transform` so a permitted result creates a new
  record/generation, verified content identity, parent record, operation
  metadata, transform provenance, and `origin: derived`. Enforce the effective
  deadline and concurrency policy while running and force a second validation
  immediately before commit: deadline must still be valid, the concurrency
  token/ownership must still be current, and complete media/byte/pixel/
  media-type/trust/digest admission plus the same duration check from task 3.2
  must pass. Internal deadline expiry or concurrency loss returns typed
  `ATTACHMENT_TRANSFORM_DENIED` / `denied`; caller cancellation returns
  `aborted`; neither may write a journal entry or publish a new generation.
  The repeat duration check must use decoder metadata for transformed bytes,
  not inherited source duration. Test equal/under/over duration outcomes,
  deadline expiry, concurrency overflow/loss, pre-commit revalidation, and
  source-generation preservation. (AP-3, AP-4, AP-6)
- [ ] 4.3 Add stale-result and failure containment checks before every
  publish/commit: validate owner, generation, non-terminal state, operation
  ownership, and current target; keep only bounded diagnostics for late
  results; and never publish partial state, append a current reference, or
  invoke a newer disposer. Test transform failure, timeout, abort, policy
  denial, deadline/concurrency races, stale completion, lineage, and
  original/derived/projection labels using only the frozen `commitState` values.
  (AP-3, AP-4, AP-6, AP-7)

### 5. Durable journal, resolve/open, and retention cleanup

- [ ] 5.1 Implement `packages/attachments/lib/journal.js` under the approved
  `attachments/v1/pipeline/records` root with atomic temp-write/rename/fsync,
  read verification, one scope authority per record, and reuse of official
  content-addressed objects for byte dedupe without sharing provenance. Test
  atomicity, read verification, restart fixtures, scope separation, and
  provenance isolation. (AP-2, AP-7)
- [ ] 5.2 Implement `projection.resolve` and `projection.open` with required
  owner/generation identity, the matching record scope, caller AbortSignal,
  digest and metadata revalidation, and explicit unavailable/error results for
  missing, corrupt, path-changed, expired, or mismatched references. A scope or
  owner mismatch must fail closed even when another scope has the same digest or
  bytes; never substitute by display name. Test read isolation, wrong-scope
  lookup, corruption, expiry, metadata mismatch, and cancellation. (AP-1,
  AP-6, AP-7)
- [ ] 5.3 Implement owner-scoped cleanup with explicit retention reason,
  reference/ownership guards, current-generation race protection, idempotence,
  and old-disposer isolation after replacement. Propagate the caller signal to
  cleanup I/O and prevent an aborted cleanup from committing deletion. Test
  repeated cleanup, retained references, cleanup races, cancellation, and
  cross-scope denial without deleting another owner's state. (AP-6, AP-7)

### 6. Read-only projection, admission evidence, and visibility

- [ ] 6.1 Implement `projection.provenance` as a read-only reconstruction of
  original-to-derived-to-projected lineage and implement frozen
  `projection.availability()` with supported media and effective limits. It
  must not write journal state, expose bytes/private source details, or choose
  a route. Test lineage labels, parent links, frozen results, unavailable
  records, and scope/owner guards. (AP-4, AP-5, AP-6, AP-7)
- [ ] 6.2 Implement the separate projection owner and
  `project(ref, { targetRoute, admission })`: require an explicit route and
  exactly `{ accepted, source, observedAt }`, and return only identity,
  generation, route, media metadata, admission, and bounded provenance. Test
  frozen result shape and mutation isolation. (AP-5, AP-6)
- [ ] 6.3 Make projection fail closed: missing/malformed admission, missing
  route, or unavailable upstream evidence returns `unavailable`; explicit
  `accepted: false` or a route that rejects the media returns `denied`; no
  evidence is inferred from media type, model name, prior request, or defaults.
  Projection must not choose a provider/model, retry, mutate, or send provider
  traffic. Test the ok/denied/unavailable matrix and provider-call absence.
  (AP-5, AP-10)
- [ ] 6.4 Apply visibility and redaction at projection and diagnostic
  boundaries: model-visible data contains only approved non-secret summaries;
  paths, URLs, credentials, display paths, and raw bytes are omitted unless a
  separately authorized host-audit policy permits the documented field;
  redaction failure is `redacted/unavailable`. Test projection, error, and log
  output. (AP-3, AP-5, AP-10)

### 7. Replacement apply self-check, identity matrix, and fail-safe behavior

- [ ] 7.1 Implement `packages/attachments/lib/apply.js` to inspect
  `attachment-local` and `plugin-api-attachments`, require the official row to
  be disabled before a replacement runs, reject duplicate insertion and owner
  conflicts, and use only the neutral attachment contract marker. Test enabled,
  disabled, absent, duplicate, competing-provider, reapply, and no-double-run
  states. (AP-8, AP-9)
- [ ] 7.2 Add exact identity/config checks for runtime full identity,
  `@deepseek-ai/dsh-attachment`, `@deepseek-ai/dsh-attachment-local`, main
  facade, and replacement package, including prerelease and `dsh.api` values.
  Preserve valid disabled-row user configuration before insert defaults. On a
  marker, version, provider, or owner mismatch, keep the official contract only
  through the documented fallback when the official row is disabled/absent,
  disable only this pipeline capability, and never guess across versions. Test
  the identity matrix, configuration continuity, fallback, and unavailable
  results. (AP-8, AP-9)
- [ ] 7.3 Complete post-registration contract probing and rollback: verify
  frozen official limits, required methods/error codes, pipeline members, and
  disposal; on probe failure first roll back the replacement, then apply the
  complete matrix—if the official package is resolvable and the official row
  is disabled/absent, register official `LocalAttachmentStore` fallback with
  pipeline closed; if the official row is enabled, remain inert and let the
  official provider continue. Repeated apply, duplicate replacement rows, and
  owner conflicts must converge to one provider/no-double-run. Emit a bounded
  diagnostic, return normally from apply, and leave no partial provider. Use
  fault-injection tests with `assert.doesNotThrow` for every matrix branch.
  (AP-1, AP-8, AP-9)

### 8. Main facade marker gating and official-service continuity

- [ ] 8.1 Wire `pluginApi.attachments` through only the attachment-owned
  append-only slots in `lib/index.js` and `lib/plugin-api-service.js`. Mount it
  only when the replacement marker, active row, pipeline service shape, and
  main/auxiliary version agreement pass; otherwise expose a typed unavailable
  surface. Do not add a guard branch or enter `FEATURE_MOUNTERS`. Test marker,
  loader, provider, and version mismatch independence. (AP-4, AP-8, AP-9)
- [ ] 8.2 Keep `pluginApi.services.attachments` as the official static
  `validateImage/saveImage/readImage/imageLimits` forwarding surface under all
  valid official-provider states. The new capability may be unavailable without
  disabling this static surface or unrelated features; add no events catalog
  slice. Test official forwarding identity/calls and mismatch degradation.
  (AP-1, AP-8, AP-9)
- [ ] 8.3 Test facade lifecycle and teardown, including marker publication and
  removal, replacement disposal, stale facade prevention, and the rule that the
  main facade never exposes an auxiliary capability after version or owner
  mismatch. (AP-6, AP-8, AP-9)

### 9. Boundary, client audit, migration, and governance acceptance

- [ ] 9.1 Exercise source, decoder, transform, journal, projection, cleanup,
  diagnostic, and apply fault boundaries. Ordinary failures use typed
  `error`/`unavailable`; explicit policy rejections use typed `denied`;
  caller cancellation uses `aborted`; stale ownership/generation uses
  `superseded`. No category is collapsed into generic `error`; failures do not
  escape apply, leave no partial durable state, or trigger provider traffic
  after projection rejection. Add negative tests for admission, route/model
  selection, retry, approval bypass, arbitrary path/network access, billing,
  automatic sending, cross-component replacement, and client-owned state.
  (AP-3, AP-5, AP-6, AP-8, AP-10)
- [ ] 9.2 Preserve the host-only client audit with six separate negative
  assertions: no `dsh.client` manifest, remote namespace, slot/settings bridge,
  host/client version negotiation, browser reconnect state, or client-facing
  event/service. Add the approved local migration fixture using a session-scope
  original, explicit owner/generation, verified image bytes, explicit route,
  and accepted evidence; verify identity/media/provenance projection, missing
  admission unavailable, stale-generation rejection, and no path/URL/raw bytes.
  Do not modify consumer repositories. (AP-2, AP-5, AP-6, AP-10)
- [ ] 9.3 Verify the existing U10 entry and retirement condition read-only:
  official attachment packages must eventually expose an equivalent public
  identity/transform/projection-provenance/cancellation/cleanup contract before
  consumers migrate and this replacement retires. Do not add a second U-series
  row or change other feature registrations. (AP-10)

### 10. Verification evidence and handoff checks

- [ ] 10.1 Run the focused attachment tests and record evidence for official
  fork integrity, patch/self-check, five sources, identity, batch atomicity,
  duration policy (finite/non-negative milliseconds, decoder/metadata
  fail-closed, inclusive boundary, over-limit/invalid-policy codes), transform
  repeat duration validation, journal/open/cleanup, projection, redaction,
  fail-safe, and migration assertions. (AP-1, AP-2, AP-3, AP-4, AP-5, AP-6,
  AP-7, AP-8, AP-9, AP-10)
- [ ] 10.2 Run the repository-guarded `npm test` from the plugin-api root, not
  bare `node --test` and not the raw unguarded test script; run `git diff --check`,
  the repository governance-token audit when present, and the official-package
  zero-modification audit. Record exit-zero results and the clean-worktree
  evidence required by temp contract §7. (AP-8, AP-9, AP-10)
- [ ] 10.3 Supply the attachment leaf's row/behavior evidence to the
  integration owner for the §5 merge sequence. The integration owner, not this
  leaf, compares full bundle versus `main + all auxiliary packages` across the
  complete row set, ordering, version gates, fallback behavior, and repeated
  apply; this item does not authorize editing integration-owned files. (AP-8,
  AP-9)

## Requirements coverage

| Requirement | Tasks |
|---|---|
| AP-1 | 1.2-1.3, 3.1, 5.2, 7.3, 8.2, 10.1-10.2 |
| AP-2 | 2.1-2.3, 3.3, 5.1, 9.2, 10.1 |
| AP-3 | 2.2-2.3, 3.1-3.3, 4.1-4.3, 6.4, 9.1, 10.1 |
| AP-4 | 2.1, 4.1-4.3, 6.1, 8.1 |
| AP-5 | 6.1-6.4, 9.1-9.2, 10.1 |
| AP-6 | 2.1-2.2, 4.1-4.3, 5.2-5.3, 6.1-6.2, 8.3, 9.1-9.2 |
| AP-7 | 2.1, 3.3, 4.3, 5.1-5.3, 6.1, 10.1 |
| AP-8 | 1.1-1.3, 7.1-7.3, 8.1-8.3, 9.1, 10.1-10.3 |
| AP-9 | 1.1-1.3, 7.1-7.3, 8.1-8.3, 9.2, 10.1-10.3 |
| AP-10 | 2.3, 6.3-6.4, 8.1-8.2, 9.1-9.3, 10.1-10.3 |

## Stage 3 handoff condition

All checkboxes remain unchecked in this Stage 3 draft. The document can be
submitted for the Stage 3 user gate only after the Design/Requirements/Tasks
consistency check is complete. User approval, `git diff --check`, the required
Stage 3 document commit, and a clean stage boundary are prerequisites before
any Stage 4 implementation work; this file itself grants none of them.
