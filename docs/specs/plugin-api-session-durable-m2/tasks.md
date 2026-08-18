# Tasks: plugin-api-session-durable-m2

> feature_name: `plugin-api-session-durable-m2`
> 状态：已完成（Stage 4）
> 依据：[requirements.md](./requirements.md) 与 [design.md](./design.md)（均已获批准）
> 范围：S2 + O8 + O13 + O14；仅 host。O8/O13/O14 为 A 类观察，S2 为受限 B 类 helper。
>
> 执行规则：按本文件顺序一次执行一个编号任务。每个任务完成后，除仅含一两处文字或单点修正的任务外，必须依据 `AGENTS.md` §3.2 立即阻塞等待一次对抗性审查通过，才能开始下一任务。纯模块保持零 harness 依赖；所有实现和测试使用 `node --test`。除本文件明确列出的内容外，不得加入 client、remote、event catalog slice、synthetic Cordis event、generic append、history mutation 或官方包修改。

---

## 1. Audited durable catalog and contract builders

- [x] **1.1 TDD the static audit catalog in `lib/session-durable-catalog.js`.**
  - First add `test/session-durable-catalog.test.mjs`, then create the pure module.
  - Export the private-by-convention, deeply frozen `SESSION_DURABLE_AUDIT` manifest with the exact `0.1.0-rc.6` runtime and package identities in design §2.4. Do not export an API for callers to alter, widen, or semver-negotiate that audit.
  - Export deeply frozen `DURABLE_EVENT_TYPES` and `DURABLE_EVENT_DESCRIPTORS` with exactly the five lexical kinds and descriptor shapes from design §4.1. Export total `isDurableEventType(value)` and `getDurableEventDescriptor(kind)`; the latter returns `undefined` for every unsupported value.
  - Test exact catalog order, keys, descriptor data, deep immutability, total guards, and that the M1 session type catalogs and all event-catalog objects are neither imported nor changed by the module.
  - References: R1.1–R1.2, R2.1–R2.8, R4.1–R4.2; design §2.2, §2.4, §4.1, §6 item 1.

- [x] **1.2 TDD the installed-contract builders and fail-closed record predicates in `lib/session-durable-catalog.js`.**
  - Add pure, total builders that accept only the public installed `dsh-session` exports and return an explicit non-throwing unavailable result when exports, known vocabulary, surface eligibility, descriptor construction, or the finite S2 contracts cannot be safely established.
  - Build strict durable predicates for all five audited kinds: full committed envelope, exact type/version, absent surface metadata, exact payload keys, JSON primitive constraints, v1 `schedule/change` grammar, and v2 `subagent/descriptor` grammar. They must never normalize, repair, copy, or throw for hostile inputs.
  - Build the three S2 append contracts exactly as design §4.4 describes: `user/message`, `assistant/message`, and `tool/result`; verify all three remain surface eligible and the durable kinds remain non-surface. Do not expose the builders as a generic event-schema validator.
  - Test installed public exports and adversarial dependency inputs, every accepted schedule/descriptor variant, rejected extra/missing/versioned fields, invalid envelope/metadata, and unavailable contract results. Confirm no package-private import or source-file parsing is introduced.
  - References: R2.9, R3.8, R4.1–R4.2, R5.1, R6.3–R6.6, R7.2; design §2.4, §3.2, §4.3–§4.5, §6 item 1.

---

## 2. Explicit live target and durable-observation mechanics

- [x] **2.1 TDD live target validation and epoch-owned registration mechanics in `lib/session-durable-feature.js`.**
  - First add focused `test/session-durable-feature.test.mjs`, then create the host module around injected public `Session`, `sessions`, S1 `eventsApi`, contract builders, logger, and call-time activity predicate. The module must not retrieve an ambient session or inspect official private state.
  - Validate a target solely through the public constructor identity, callable `append` when required, non-negative safe-integer `firstLiveSeq`, and `sessions.get(target.id) === target`. Return the documented `TypeError` with `code: 'invalid-target-session'` before any registration or append on every failure.
  - Provide an epoch registration owner that tracks every underlying S1 disposer in a set, supports an idempotent `() => boolean` individual disposer, and drains the set with per-disposer error containment. Captured callbacks must become inert before user code can run after epoch reset.
  - Test target rejection for id/duck type/foreign `Session` instance/detached seed/missing or invalid `firstLiveSeq`/disposed or replaced object, valid public live target acceptance, disposal return values, disposal failures, and no subscription/write side effects on validation failure.
  - References: R1.2, R1.4–R1.5, R3.9, R6.1–R6.2, R7.6–R7.8; design §3.3, §4.2, §4.3, §4.5.

- [x] **2.2 TDD `onDurable()` and `onceDurable()` in `lib/session-durable-feature.js`.**
  - Implement the active durable facade methods using one unscoped S1 `eventsApi.on('session/event', wrapper)` registration per caller registration. Validate target, exact durable kind, then callable listener; use the stable `invalid-target-session`, `unsupported-durable-kind`, and `invalid-listener` codes.
  - Deliver only future records for the exact Session object that pass the `firstLiveSeq` boundary and strict audited predicate. Pass the original committed official record as the sole listener argument, do not rescan `session.events`, replay seeds, synthesize notifications, or create a second append.
  - On observed seed-boundary or audited-record breach, synchronously fail closed through the injected current-epoch P2 reset with a redacted kind/seq/reason diagnostic. Do not invoke listeners or settle `onceDurable` on such a record.
  - Make `onceDurable()` remove its underlying registration before its first validated listener invocation. Preserve the existing S1 listener throw/rejected-thenable containment by delegating user callbacks through the cataloged bus rather than catching/reclassifying them in this feature.
  - Test exact-target/future/matching delivery, unrelated session and kind exclusion, no historical replay, seeded continuable-style child no-catch-up, immutable record identity, one-shot pre-callback disposal, idempotent individual/global disposal, listener containment, raw-observer independence, malformed direct raw durable append failure to P2 without payload logging, and absent/throwing logger behavior that leaves commit/valid delivery and P2 reset intact.
  - References: R3.1–R3.12, R4.2–R4.3, R7.5–R7.8; design §2.1, §2.2, §3.3, §4.3, §6 items 2–3.

---

## 3. Constrained S2 surface-message append helper

- [x] **3.1 TDD JSON snapshot, message-envelope, options, and provenance preflight helpers in `lib/session-durable-feature.js`.**
  - Add tests before implementation for the finite public S2 contract. Materialize the borrowed payload exactly once with public `snapshotJsonValue()` and use that detached snapshot for all validation; never call `isJsonValue()` on the borrowed payload and never make a second getter pass.
  - Implement only the replay-safe message checks in design §4.4: user role/content/source, assistant model source and turn/step, and tool-result source/call correlation/content/error/meta. Keep official append validation as final authority; do not create a broader message DSL.
  - Accept only omitted options or a plain/null-prototype record with the sole own `sourceEventSeqs` key. Read exactly one `targetSession.events` snapshot for provenance. Validate explicit sequence ordering/cardinality/correlation or derive only the explicitly unambiguous relationship described by the finite contract.
  - Return the stable `unsupported-surface-message-kind`, `non-json-payload`, `invalid-options`, `invalid-source-event-seqs`, or `indeterminate-source-event-seqs` `TypeError.code` before any write. Diagnostics for indeterminate inspection failures must be contained and payload-free.
  - Test JSON/cyclic/exotic/getter failures; message grammar; option-shape rejection; user no-provenance rule; assistant empty/no-candidate and matching-chunk cases; tool result explicit/derived matching-call case; duplicate/sparse/future/wrong-kind/out-of-order refs; all zero/multiple/ambiguous candidate cases; and absent/throwing logger behavior during indeterminate preflight. Assert every rejection leaves log and surface unchanged and performs no append.
  - References: R4.5–R4.6, R5.1, R5.3–R5.8, R6.1–R6.6; design §2.3, §4.4–§4.5, §6 items 4–5.

- [x] **3.2 TDD `appendMessage()` in `lib/session-durable-feature.js`.**
  - Implement the exact synchronous preflight order in design §4.5, construct only `{ surfaceOp: 'append' }` or `{ surfaceOp: 'append', sourceEventSeqs }`, and invoke the target's official `Session.append(kind, payloadSnapshot, intent)` exactly once.
  - Return the unchanged immutable official committed record. Do not retry, catch, patch, roll back, resurface, or append from a `session/event` observer. Propagate every post-preflight official append error unchanged.
  - Test successful user, assistant without chunks, assistant with valid explicit chunks, and tool result with explicit and derived call provenance against an official live session. Assert generated event shapes/metadata, immutable result, input post-return mutation isolation, exactly one write, no modified historical record, direct official append error propagation, and official append re-entry failure from an observer callback.
  - References: R1.3, R4.4–R4.6, R5.2–R5.12, R6.1–R6.8; design §4.4–§4.5, §6 item 4–5.

---

## 4. Reversible publication under the existing session facade

- [x] **4.1 TDD durable P1/P2 stubs and descriptor-preserving session composition in `lib/plugin-api-service.js`.**
  - Add `test/plugin-api-service-session-durable.test.mjs`, then extend the service with P2 durable stubs for exactly `durableEventTypes`, `durableEventDescriptors`, `isDurableEventType`, `getDurableEventDescriptor`, `onDurable`, `onceDurable`, and `appendMessage`. Every durable entry point must first produce foundation P1 while core is inactive, otherwise `PluginApiFeatureDisabledError('sessionDurable')`; it must not touch official services.
  - Replace direct session assignment with service-owned `baseSessionApi` plus durable overlay publication. Compose with property descriptors, not object spread, so an M1 disabled getter cannot be eagerly invoked. Preserve all S1/S3/S4/S5 behavior, descriptors, and P1/P2 semantics while active or disabled.
  - Test initial P1/P2 durable behavior, base-session non-regression, descriptor-preserving composition, no eager getter execution, exact durable overlay ownership, and unsupported `mountFeature` behavior.
  - References: R1.1, R1.7, R2.1–R2.8, R7.3–R7.4; design §3.1, §3.3, §4.1, §6 items 1 and 6.

- [x] **4.2 TDD epoch publication, reset, and stale-cleanup protection in `lib/plugin-api-service.js`.**
  - Add the recognized `mountFeature('sessionDurable', { facade, closeEpoch })` path. Publish an opaque monotonic epoch but retain `closeEpoch` privately; make all active overlay entry points and catalog getters call-time-gated by both core state and `featureRegistry.isActive('sessionDurable')`.
  - Implement `resetSessionDurable(epoch)` as an identity-checked, atomic, idempotent transition: mark the current epoch inactive, call its close hook once with contained logging, restore P2 durable stubs over the current base session API, and report whether it won the current-epoch comparison.
  - Test retained old `pluginApi.session` references, epoch registration drain, repeated cleanup, reapply, failed first mount, later successful epoch, stale cleanup after reapply, close-hook throw/log failure, and preservation of the base session API in every case.
  - References: R7.2–R7.7; design §3.3, §4.1, §6 item 6.

---

## 5. Feature guard, mount, package identity, and host integration

- [x] **5.1 TDD `sessionDurable` feature guard additions in `lib/guards.js`.**
  - Add `test/session-durable-guard.test.mjs`, then add the mandatory fail-closed `sessionDurable` branch immediately before the unknown-feature branch. Probe the cheap public prerequisites: active session/events dependency availability, official sessions `get/list`, public dsh-session exports, required known vocabulary/surface status, and safe public manifest identity evidence supplied by the host integration.
  - Keep the guard non-throwing and keep `DSH_PLUGIN_API_GUARD_DISABLE=1` behavior unchanged. Guard skipping may bypass only cheap probes; the mounter must still reconstruct every authoritative contract before publication.
  - Test all missing/throwing/malformed service/export/identity cases, valid exact audit inputs, unknown feature behavior, and isolation from M1 `session` and `events` guard results.
  - References: R3.8, R4.2, R7.1–R7.2; design §2.4, §3.2, §6 items 1 and 6.

- [x] **5.2 Add audit-only peer identities and package tests.**
  - Modify `package.json` to add exactly `@deepseek-ai/dsh-user-approval`, `@deepseek-ai/dsh-schedule`, `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-subagent-in-process-driver`, and `@deepseek-ai/dsh-agent-loop` as host peer dependencies compatible with the audited runtime. Do not add runtime dependencies or alter `dsh.api`, version, exports, or bundle declarations.
  - Update `test/package.test.mjs` to assert all public-audit manifests are declared as peer dependencies while preserving existing package assertions.
  - References: R4.1–R4.2, R7.1–R7.2; design §2.4, §3.1–§3.2.

- [x] **5.3 TDD host mounter and transactional apply integration.**
  - Extend `lib/index.js` to obtain only public dsh-session exports and public producer `./package.json` manifests; pass these explicit dependencies to the guard and new `mountSessionDurableFeature`. Do not import producer implementation modules or private source state.
  - Add `sessionDurable` immediately after `session` in `FEATURE_MOUNTERS`. The mounter must require active M1 `session` and `events`, repeat all authoritative identity/vocabulary/contract construction, build the epoch-owned facade, publish it through the service, and return one idempotent cleanup closure that resets the captured epoch and disables only `sessionDurable` when it wins.
  - Preserve the existing generic apply protocol. Verify that an exception from `ctx.effect()` or registry mounting after publication invokes that same cleanup before final P2 disablement; a late registered effect cleanup must be harmless and cannot reset a newer epoch.
  - Add/update `test/index-session-durable.test.mjs` and only the existing affected integration tests. Cover success, missing session/events, package/contract mismatch, mounter failure, effect-registration failure, registry-mount failure before/after activation, cleanup/reapply/stale epoch, correct mounter order, P2 retained-facade behavior, M1 session availability, absent/throwing logger on every apply-time failure route, and absence of a durable event catalog or client surface.
  - References: R1.1, R1.7–R1.10, R2.8, R3.8, R7.1–R7.8, R8.2–R8.5; design §3.1–§3.3, §4.1, §6 items 1 and 6.

---

## 6. Regression, deferred consumer migration, and final delivery verification

- [x] **6.1 Add and run the consumer mapping regression fixture.**
  - Add an in-repository fixture/test that executes the exact `dsh-pro-ex-ability-anchor` mapping in design §5: `user/message`, a no-chunk `assistant/message`, raw official `tool/call`, and `tool/result` with the raw call sequence. Assert the facade produces required append metadata without caller-authored `surfaceOp`, retains the raw `tool/call` boundary, and rejects unsupported title/replacement/atomic-turn attempts.
  - Do not modify `../dsh-pro-ex-ability-anchor` in this feature. Its virtual-turn atomicity, title correction, partial-turn recovery, and persistence ordering remain the consumer's separately specified migration responsibilities.
  - References: R8.1–R8.5; design §5, §6 item 7.

- [x] **6.2 Run feature and sibling baseline regression; explicitly record deferred migration acceptance.**
  - Run `node --test` in this worktree after all implementation tasks, resolve failures caused by this feature, and rerun until green. Run `node --test` in `../dsh-pro-ex-ability-anchor` and the established `node --test ../dsh-read-image/test/*.test.mjs` baseline; report their exact outcomes and do not modify either sibling repository as part of this feature.
  - This task is deliberately a baseline regression, not completion of the full `AGENTS.md` §5 consumer migration acceptance: approved design §5 explicitly excludes consumer-repository changes from this feature. The Stage 4 report must label migration acceptance as deferred and identify its independent owner: an approved consumer worktree/spec that deletes or reduces the ability-anchor hand-authored surface metadata, proves the documented mapping in that repository, and runs the required headless smoke and dev-boot acceptance. This task must not claim fixture or sibling-unit-test success as that migration proof.
  - References: R8.1–R8.5; design §5–§6; `AGENTS.md` §5.

- [x] **6.3 Synchronize delivery records, validate the final tree, and commit Stage 4.**
  - Update the Stage 4-required delivery registration: root `AGENTS.md` §8 and `docs/specs/plugin-api-features/feature-list.md` must identify the delivered S2/O8/O13/O14 host capability, its no-client/no-catalog boundary, `sessionDurable` P2 epoch rollback, exact audit identity policy, and the explicitly deferred consumer migration acceptance from task 6.2.
  - After every delivery document is updated, rerun `node --test`, run `git diff --check`, and perform the final scope check: no changes to official DSH packages, event catalog slices, client entry/bundle, remote namespaces, synthetic Cordis-event APIs, or consumer repositories. Resolve feature-caused failures before continuing.
  - Commit the completed Stage 4 implementation, tests, specs, and required registrations only after all final checks pass, as required by `AGENTS.md` §3.2. The commit must not include unrelated worktree changes.
  - References: R1–R8; design §1.1, §3.1–§3.3, §5–§6; `AGENTS.md` §3.2, §5, §6, §8.

---

## Requirements coverage

| Approved requirement area | Implementing task(s) |
| --- | --- |
| §1 Explicit host API and classification | 1.1, 2.1–2.2, 3.2, 4.1, 5.3 |
| §2 Durable catalog, descriptors, and guards | 1.1–1.2, 4.1, 5.3 |
| §3 Explicit-session durable observation | 2.1–2.2, 4.2, 5.1, 5.3 |
| §4 Official-shape and read-only boundary | 1.2, 2.2, 3.1–3.2, 5.1 |
| §5 Constrained S2 append | 1.2, 3.1–3.2, 5.3, 6.1 |
| §6 Preflight and causal metadata | 3.1–3.2, 5.3 |
| §7 Availability, lifecycle, and fail-safe | 2.1–2.2, 4.1–4.2, 5.1–5.3 |
| §8 Migration, client boundary, and non-goals | 1.1–1.2, 5.2–5.3, 6.1–6.2 |

## Stage 4 exit condition

All tasks above must pass their per-task adversarial review. The final implementation must be committed only after the complete test and migration-boundary suite in task 6.2 passes and the mandatory delivery registration is synchronized. A future consumer-repository migration still requires its own approved Goal, Requirements, Design, and Tasks; this feature's mapping fixture does not authorize changing consumer-owned virtual-turn semantics.
