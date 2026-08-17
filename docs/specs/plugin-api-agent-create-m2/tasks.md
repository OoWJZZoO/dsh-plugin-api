# Tasks: plugin-api-agent-create-m2

> feature_name: `plugin-api-agent-create-m2`
> 状态：草案（Stage 3，待用户评审）
> 上游：`requirements.md`（Stage 1 已批准）、`design.md`（Stage 2 已批准）
> 执行规则：本任务书获批后，Stage 4 按顺序执行；每项非小修改任务完成后，必须阻塞等待一次仅核对该任务与本任务书一致性的对抗性审查通过，才可开始下一项。

---

## Execution Boundaries

- 本 feature 仅提供 host `pluginApi.agent` A11 surface；不创建 client bundle、remote、codec、slot、settings bridge、B 类 hook 或 event catalog slice。
- 不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**`，不导入官方 module-private state，不重建 `AgentRegistry`、factory、Agent loop、session 或 lifecycle dispatch。
- A11 member 调用必须以消费者 context-bound `agents` service 为 receiver，直接返回官方 invocation 的原始返回值；禁止 `async`、`await`、`Promise.resolve`、调用包装、错误翻译或 disposer/handle 包装。
- A11 不得独立重写共享 `pluginApi.agent` facade composition、disabled view 或 `mountAgentFeature()`；该变更由任务 4 的协调 M2 integration 完成，并合并 exec-route 已批准 surface 时不得丢失任一 extension。
- M1 `agents.get/list/roots` guard 保持 whole-agent P2 的唯一 mandatory gate。A11 六个 leaves 缺失只能使对应 member P2，不得关闭已验证 M1 或 A11 siblings。
- 每项非小 Stage 4 任务完成后立即执行仅核对该任务与本任务书一致性的阻塞对抗性审查。审查返回偏差时，先集中修订该项并再次阻塞审查；通过前不得开始后续任务。

---

## 1. Add A11 API contract documentation

- [ ] 1.1 In the package public API documentation, add the host-only A11 surface:
  - consumer `agent.create(options)`, `agent.resume(options)`, and `agent.register(agent)`;
  - advanced `agent.provider.enter(agent, owner)`, `announce(agent)`, and `setFactory(factory)`;
  - immutable `agent.availability` with exact six-leaf shape and `provider.isActive` rule.
- [ ] 1.2 State the tiering, including that provider primitives are supported advanced ordered-lifecycle APIs rather than ordinary creation APIs.
- [ ] 1.3 State the A-class transparency contract: exact caller context, arguments, raw synchronous result/official registry Promise, handle, disposer, official errors, lifecycle publication, and teardown behavior pass through unchanged.
- [ ] 1.4 State member-local degradation and P1/P2 behavior, including that factory absence and provider-slot occupancy are official call-time outcomes rather than availability changes.
- [ ] 1.5 Do not document unimplemented route helpers, client APIs, synthetic lifecycle behavior, or a public generic extension registry.

**Verification:** Documentation names every declared A11 member and agrees with `requirements.md` and `design.md` without expanding scope.

---

## 2. Implement and test the isolated A11 adapter

- [ ] 2.1 Add `lib/agent-create-api.js` as a zero-harness-dependency internal module accepting injected probe, active-state, and safe-logger operations.
- [ ] 2.2 Implement six independent non-invoking probes for `create`, `resume`, `register`, `enter`, `announce`, and `setFactory`, run only after the existing M1 agent guard passes.
- [ ] 2.3 Persist private per-member capability state and expose a stable frozen `availability` snapshot whose outer and nested provider objects are frozen and whose leaves are booleans. Make `provider.isActive` true exactly when its three leaves are true.
- [ ] 2.4 Build consumer-context-bound closures which narrowly contain only service/member resolution failures. On such a failure, mark only that member unavailable, write one redacted deduplicated adapter-owned diagnostic, and throw a named `PluginApiFeatureDisabledError('agent', ...)` before official invocation.
- [ ] 2.5 For a resolved official member, execute exactly one `Reflect.apply(member, registry, exactArgs)` and return its raw output. Do not catch official method errors/rejections or observe/wrap returned promises, handles, or disposers.
- [ ] 2.6 Keep factory absence, factory-slot occupancy, duplicate ID, invalid announce, setup/persistence/signal/rollback errors, and all official runtime state outside capability state and facade containment.
- [ ] 2.7 Add `test/agent-create-api.test.mjs` focused adapter tests for:
  - exact argument, receiver-context, synchronous result, official registry Promise, `AgentHandle`, Agent, `undefined`, and disposer identity for all six members;
  - direct-versus-facade consumer-context/effect ownership observations for `create`, `resume`, `register`, and `setFactory`;
  - direct propagation of official thrown values and rejection reasons without adapter logging or timing changes;
  - no wrapping/interception of returned registry/provider disposers and `AgentHandle.dispose()` after probe/resolution containment paths;
  - every independent missing/non-function/throwing probe result, frozen availability shape, provider `isActive`, and retained siblings;
  - member-local late resolver failure, one redacted deduplicated diagnostic, inert logger failure, no implicit retry, and no official invocation;
  - factory absence and factory slot occupation remaining available while producing direct official call-time outcomes.

**Verification:** Run `node --test test/agent-create-api.test.mjs` successfully.

---

## 3. Extend inactive and disabled agent views

- [ ] 3.1 In the integration-owned `lib/plugin-api-service.js` composition work, extend the core-inactive and whole-agent P2 views to declare all A11 consumer members, the provider namespace and its exact three members plus `isActive`, and a frozen all-false availability matrix.
- [ ] 3.2 Ensure disabled calls check core inactive first, otherwise use existing `PluginApiFeatureDisabledError('agent')`; disabled views must not resolve `agents`.
- [ ] 3.3 Preserve current P1/P2 behavior and all non-agent facade surfaces unchanged. Do not introduce an error class, a general P4 convention, or a public extension registration API.
- [ ] 3.4 Extend `test/plugin-api-service-agent.test.mjs` to verify declared A11 disabled shape, P1/P2 precedence, named member errors, frozen all-false availability, provider `isActive === false`, and absence of official service access.

**Verification:** Run `node --test test/plugin-api-service-agent.test.mjs` successfully.

---

## 4. Coordinate context-bound agent facade composition and activation

- [ ] 4.1 In the coordinated M2 integration path, replace the host-captured M1 agent object with one Cordis-traceable accessor/composer that receives the consuming plugin context when `pluginApi.agent` is read.
- [ ] 4.2 Compose M1 `get/list/roots`, A11 consumer/provider views, and each separately approved agent extension without reconstructing, overwriting, or removing another active extension. Do not add `routeOf` unless the separately approved exec-route integration provides it.
- [ ] 4.3 Route M1 reads through the same consumer-context-aware service-resolution pattern while preserving their existing direct behavior: no cache, clone, sort, filtering, freeze, or disposal capability.
- [ ] 4.4 Keep existing M1 mandatory guard semantics intact. Only after it passes, prepare the A11 extension with independent probes; a missing A11 leaf must not alter featureRegistry whole-agent activation.
- [ ] 4.5 Implement a reversible, extension-local activation transaction: prepare candidate state, establish cleanup/rollback ability, publish the composed view, then finalize feature state. Candidate A11 or later extension publication, cleanup-registration, or cleanup failure after the M1 base is active restores the exact prior composed view and removes or marks unavailable only that candidate.
- [ ] 4.6 Reserve whole-agent P2 for initial M1 base-agent activation failure before an active agent view exists. A candidate extension failure must preserve M1 reads, all already-active agent extensions, their registry state, and every unrelated facade feature; `apply()` must return normally with at most one redacted diagnostic per failure identity.
- [ ] 4.7 Make feature-owned cleanup idempotent and generation-safe so stale cleanup cannot remove a later active extension.
- [ ] 4.8 Extend `test/index-agent.test.mjs` with active composed API coverage: per-member A11 absence; preserved M1 reads; consumer context ownership; raw return/error identity; and lifecycle doubles comparing direct official and facade paths for `create`, `resume`, `register`, `enter`, `announce`, and `setFactory`. Those doubles must prove no duplicate facade invocation or dispatch and preserve official applicable session creation/events, `agent/created`, `agent/session-start`, `agent/disposed`, listener order, scope carrier, synchronous veto, fault/rejection behavior, rollback/disposal pairing, and M1 event-bus behavior. For `setFactory`, they must also prove caller-fiber effect ownership, exact disposer identity, official factory-slot removal, and unchanged `provider.setFactory` availability after disposal. Cover cleanup-registration failure, candidate publication failure, and later candidate-cleanup failure individually; each must restore the exact prior view, keep `apply()` non-throwing, preserve unrelated features, and emit at most one redacted diagnostic for its repeated identity. Also cover stale cleanup protection and duplicate-apply idempotence.
- [ ] 4.9 Treat A11/exec-route agent-facade coexistence as a coordinated M2 integration prerequisite before Stage 4 delivery: add combined coverage proving the approved A11 surface and the separately approved `agent.routeOf` surface coexist, and that disposal, publication failure, or cleanup failure of either extension does not remove the other. This task does not implement, redefine, or broaden route behavior; if the exec-route branch is not ready for integration, record the blocking coordinated integration issue and do not mark this feature's Stage 4 delivery complete.

**Verification:** Run the focused agent integration tests successfully; confirm all agent composition changes are made through the coordinated integration boundary rather than by either parallel feature alone.

---

## 5. Run feature and repository verification

- [ ] 5.1 Run all new and modified focused tests from tasks 2-4 with `node --test`.
- [ ] 5.2 Run the complete repository `node --test` suite.
- [ ] 5.3 Inspect test failures, if any, and correct only A11-spec-conformant implementation or test defects. If an issue changes approved Goal or Requirements acceptance criteria, stop and request human direction; otherwise synchronize the affected requirements/design/tasks wording before final reporting.
- [ ] 5.4 Run `git diff --check` and inspect `git status --short` to ensure the deliverable contains only A11 implementation, tests, approved specs, and required documentation/register updates.

**Verification:** Focused and complete `node --test` suites pass; `git diff --check` has no output.

---

## 6. Finalize delivery records and Stage 4 commit

- [ ] 6.1 Update `docs/specs/plugin-api-features/feature-list.md` to mark `plugin-api-agent-create-m2` delivered with the approved consumer/provider shape, six-leaf availability, caller-context forwarding, identity, and coordinated facade constraints.
- [ ] 6.2 Update `AGENTS.md` section 8 with the delivered A11 entry and its scope, A-class passthrough, member-local availability, exact identity, caller-fiber ownership, and integration boundary constraints.
- [ ] 6.3 Re-run the focused documentation assertions or relevant test suite after record updates.
- [ ] 6.4 Run final `git diff --check`, review the final status, and commit all Stage 4 implementation, tests, specs, and delivery records on the feature branch before reporting completion or cleaning any worktree.

**Verification:** The final branch contains a committed Stage 4 delivery; delivery registry and feature list match the implemented public API.

---

## Requirement Traceability

| Requirements | Tasks |
|---|---|
| §1 Public surface and capability levels | 1, 2, 3, 4 |
| §2 Consumer creation and restoration | 1, 2, 4, 5 |
| §3 Registration and disposer identity | 1, 2, 4, 5 |
| §4 Provider ordered lifecycle | 1, 2, 4, 5 |
| §5 Per-member availability and fail-safe | 2, 3, 4, 5 |
| §6 Identity, error, and publication preservation | 1, 2, 4, 5 |
| §7 Parallel integration boundary | 4, 5 |
| §8 Verification and documentation synchronization | 1, 2, 3, 4, 5, 6 |

## Out of Scope

- Agent factory or loop implementation, `AgentRegistry` reimplementation, session creation or lifecycle rewrites.
- Wrapping, composing, observing, delaying, or replacing `AgentHandle.dispose()` or an official registry/provider disposer.
- New `agent/*` events, catalog entries, synthetic publications, B-class semantic hooks, route derivation, client/remote/codec/settings APIs.
- Official DSH package edits, private official-module imports, or independently changing the shared agent facade construction during parallel delivery.
