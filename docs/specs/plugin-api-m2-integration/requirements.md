# Requirements: plugin-api-m2-integration

> feature_name: `plugin-api-m2-integration`
> 状态：草案（Stage 1，待用户评审）
> 类型标注：本 feature 为整合基础；不新增 A/B/C 能力，保持并统一已批准的 A 类直通、B 类转译与 C 类边界
> 面：host 整合 + 两个目标插件迁移验收；不新增 client 面
> 上游：已完成 Stage 4 的 `plugin-api-llm-request-m2`、`plugin-api-exec-route-m2`、`plugin-api-agent-create-m2`、`plugin-api-session-durable-m2`、`plugin-api-compaction-m2`，以及已交付的 `plugin-api-semantic-hooks-m2`

---

## Introduction

`plugin-api-m2-integration` 是 M2 的串行收敛点。它整合 L2、L4、A9、A11、S2、T10、O8、O13、O14、SV17 以及 semantic-hooks 共同契约，集中仲裁共享 facade、挂载依赖、guard、active signal、失败呈现、事务回滚、catalog 边界、版本和交付文档。

本 feature 不重新设计各上游 Spec 已批准的公开语义，也不把分支局部实现原样叠加视为完成。整合必须先证明每个输入分支可接纳，再分为“冲突合并波”和“统一波”，最后以全量回归、真实消费者迁移、headless 冒烟和 dev boot 证明 M2 可替代目标 hack，同时保持未被明确取代的 M0/M1 行为。

分类边界如下：A11 与 SV17 为 A 类稳定直通；A9/T10、L2/L4 和 S2 为 B 类转译或受限 helper；O8/O13/O14 为 A 类 durable-record 观察；完整异步请求改写、精确 route 因果、任意 durable 写入、compaction 后端扩展、M3 client/settings bridge 与 M4 proposal 仍在范围外。本整合 feature 自身不新增任何 A/B/C 能力。

---

## 1. 整合输入准入与只读预检（整合基础）

**User Story**: As an M2 integration maintainer, I want every feature branch audited before merge, so that incomplete, divergent, or out-of-scope work cannot enter the integration base unnoticed.

**Acceptance Criteria**:

1. GIVEN an M2 feature branch is proposed for integration, WHEN its admission is evaluated, THEN the integration SHALL require a committed Stage 4 boundary, completed Tasks state, required delivery registration, and a clean worktree before that branch enters the principal merge wave.
2. WHEN pre-merge inspection begins, THEN the integration SHALL perform a read-only audit of naming and API isomorphism, approved feature coverage, shared-file ownership, unreported deviations, out-of-scope smuggling, official-package modifications, and implementation-to-Spec consistency for every input branch.
3. WHEN the branch set is known, THEN the integration SHALL produce a pairwise conflict map covering shared production files, shared tests, package metadata, registries, migration repositories, and semantic ownership conflicts before the first merge.
4. IF a deviation from an approved feature Spec is found, THEN the integration SHALL record the deviation and SHALL NOT silently normalize it during merge.
5. IF an implementation-detail conflict can preserve all approved Goal and Requirements acceptance criteria, THEN the integration SHALL defer its resolution to the Design/Tasks-governed merge or unification wave and SHALL record the resolution.
6. IF a conflict changes an approved Goal, requirement classification, public acceptance criterion, or migration acceptance boundary, THEN the integration SHALL stop and request human adjudication before that branch is admitted.
7. WHEN preflight completes, THEN the integration SHALL preserve an auditable result that identifies every admitted branch, its Stage 4 commit, reported deviations, conflict edges, and admission decision.

## 2. 两波整合与变更归属（整合基础）

**User Story**: As an integration maintainer, I want conflict resolution separated from contract unification, so that feature semantics and coordinator-owned refactors remain reviewable.

**Acceptance Criteria**:

1. WHEN principal integration starts, THEN the integration SHALL execute a predetermined, dependency-aware merge order recorded in the approved Design/Tasks.
2. WHERE the principal merge wave is active, IF a conflict occurs, THEN the integration SHALL make only the changes necessary to preserve approved feature semantics and obtain the step's required focused regression result.
3. WHERE the principal merge wave is active, THEN the integration SHALL NOT introduce coordinator-wide API reshaping, shared abstractions, version updates, or unrelated cleanup.
4. WHEN all admitted branches have completed the merge wave, THEN the integration SHALL execute a separate unification wave for shared facade composition, host publication, mount order, guards, gating, disabled surfaces, disposer ownership, tests, versioning, and documentation.
5. WHEN duplicate or parallel implementations claim the same semantic owner, THEN the integration SHALL select one authoritative owner and SHALL remove or fold the duplicate without changing the approved external contract.
6. WHEN any merge or unification step completes, THEN the integration SHALL run the focused tests associated with every affected feature before proceeding.
7. WHEN a step cannot retain both upstream contracts, THEN the integration SHALL treat the condition according to Requirement 1.5 or 1.6 rather than choosing a branch by merge order.

## 3. 全局 facade 形状与组合（整合基础）

**User Story**: As a third-party plugin author, I want one coherent facade after M2 integration, so that additive features never overwrite or hide each other.

**Acceptance Criteria**:

1. WHEN M2 integration completes, THEN `pluginApi.agent` SHALL expose the unchanged M1 read surface, the approved A11 consumer/provider surface, and A9 `routeOf(exec)` through one composed namespace.
2. WHEN M2 integration completes, THEN `pluginApi.tools` SHALL preserve the unchanged M1 tools surface and expose T10 `routeOf(exec)` with the same route authority and result semantics as `pluginApi.agent.routeOf(exec)`.
3. GIVEN a route snapshot exists for an execution, WHEN either route helper is called, THEN both helpers SHALL return the same frozen `{ provider, model }` snapshot identity; WHEN no snapshot exists, both SHALL return `undefined`.
4. WHEN A11 methods are invoked, THEN their exact official receiver, argument, return, promise, handle, disposer, timing, ordering, and error semantics SHALL remain unchanged by A9/T10 composition.
5. WHEN M2 integration completes, THEN `pluginApi.session` SHALL preserve the M1 lifecycle/read/state surface and add only the approved durable catalog, observation, and constrained `appendMessage` members; it SHALL NOT create a second public `sessionDurable` namespace.
6. WHEN M2 integration completes, THEN `pluginApi.llm` SHALL preserve unaffected L7/L8/L9 behavior and expose the approved L4 transform and constrained L2 image-policy surfaces, with superseded legacy admission members absent as required by the L2/L4 contract.
7. WHEN M2 integration completes, THEN `pluginApi.services` SHALL contain exactly the approved 19 static service keys, including `compaction`, and SHALL expose no additional top-level namespace or runtime-discovered service member.
8. WHEN any composed facade is mutated, THEN the mutation SHALL NOT alter its observable member set or approved immutable data.
9. WHEN a feature is unavailable, THEN every declared public member owned by that feature SHALL remain observable through its approved disabled presentation; another feature SHALL NOT erase, replace, or partially publish it.

## 4. 挂载顺序与依赖（整合基础）

**User Story**: As a facade maintainer, I want one tested dependency order, so that features never observe uninitialized substrates or publish half-built surfaces.

**Acceptance Criteria**:

1. WHEN `apply()` mounts features, THEN it SHALL preserve every M1 dependency, including `tools` before `events` and `events` before `session`.
2. WHEN the LLM M2 features mount, THEN the order SHALL satisfy `llm` before `llm/request` and `llm/request` before `llm/admission`, using the approved feature-registry keys exactly.
3. WHEN `sessionDurable` mounts, THEN the `session` and `events` features SHALL already be active.
4. WHEN `execRoute` mounts, THEN the approved tools lifecycle substrate and session request-context substrate SHALL already be active.
5. WHEN A11 mounts, THEN it SHALL depend only on its approved agent substrate and SHALL NOT acquire a runtime dependency on `execRoute` or semantic-hooks infrastructure.
6. WHEN SV17 is integrated, THEN `compaction` SHALL remain a member derived by the existing `services` feature and SHALL NOT create a separate feature mounter, registry key, guard branch, or lifecycle.
7. IF a mandatory dependency is inactive or malformed, THEN the dependent feature SHALL remain P2-disabled without changing the dependency's own state or preventing unrelated later mounters from running.
8. WHEN `apply()` re-runs against a reused service, THEN every M2 owner SHALL avoid duplicate hooks, wrappers, facade publication, registry state, and cleanup ownership.
9. WHEN integration completes, THEN the complete M2 partial order and each dependency failure SHALL be covered by combined host-apply tests.

## 5. Guard、gating 与失败呈现（整合基础）

**User Story**: As a plugin author, I want consistent availability and typed failures, so that I can distinguish inactive core, disabled features, optional services, and disabled capability members.

**Acceptance Criteria**:

1. WHEN an M2 feature initializes, THEN all mandatory guards SHALL complete before its facade becomes active or its translation hook, wrapper, observer, or execution capture becomes externally usable.
2. WHEN runtime availability is queried, THEN `featureRegistry.isActive(featureName)` SHALL be the single authoritative active signal for every independently mounted M2 feature.
3. WHERE an M2 feature requires a mandatory service or public substrate, IF that dependency is missing, malformed, throwing, or fails its identity/audit proof, THEN the feature SHALL fail closed as P2 and SHALL NOT publish a partially active surface.
4. WHERE an existing M1 service is approved as optional, IF it is absent or throws during resolution, THEN its previously approved P3 or P4 behavior SHALL remain unchanged; M2 integration SHALL NOT invent a new optional-service failure category.
5. WHEN a facade call occurs, THEN failure precedence SHALL remain P1 inactive core before P2 disabled feature, before an approved P3 optional-service or P4 per-service-member result.
6. WHEN SV17's official service is missing, incomplete, or hostile during facade construction, THEN only `services.compaction` SHALL be P4-disabled and every independently valid service facade SHALL retain its state.
7. WHEN a route cannot be resolved for an expected reason, THEN A9/T10 SHALL return `undefined`; WHEN unexpected route resolution fails, THEN it SHALL contain and diagnose the failure without changing the tool operation.
8. WHEN diagnostics are emitted for M2 failures, THEN they SHALL be redacted, best-effort, and deduplicated according to the owning feature contract; an absent or throwing logger SHALL NOT change control flow.
9. WHEN any guard, mount, registration, wrapper, diagnostic, rollback, or disposer operation fails, THEN `apply()` SHALL contain the failure, disable only the affected capability where its contract permits isolation, continue unrelated mounting, and SHALL NOT throw through harness boot.

## 6. B 类事务发布、回滚与 disposer（B 类共同契约）

**User Story**: As a maintainer of translated semantics, I want publication and teardown to be transactional, so that failed or stale mounts cannot leave externally visible residue.

**Acceptance Criteria**:

1. WHEN a B-class facade owner first becomes externally visible, THEN its cleanup and rollback authority SHALL already exist, and activation SHALL be committed through an identity- or epoch-bound transaction.
2. IF facade publication, substrate registration, `ctx.effect()` registration, active marking, or any later step in the same mount transaction fails, THEN rollback SHALL remove that transaction's facade overlay, hooks, wrappers, captured state, registrations, catalog contribution if any, and active signal before failure containment completes.
3. WHEN a transaction rolls back, THEN retained facade references SHALL observe the approved P2 state rather than a stale active implementation.
4. WHEN cleanup is invoked more than once, THEN it SHALL be idempotent and SHALL NOT repeat user-visible effects.
5. WHEN cleanup from an older mount runs after a newer mount is active, THEN its identity or epoch check SHALL prevent it from disabling, unwrapping, draining, or replacing the newer owner.
6. WHEN one B-class feature fails or is disposed, THEN it SHALL NOT dispose or disable another B-class feature unless the other feature's own approved mandatory dependency has become unavailable.
7. WHEN L4 request ownership and L2 admission ownership are integrated, THEN they SHALL retain their approved atomic publication/degradation relationship and SHALL NOT create a second raw `llm/stream` owner or legacy projection path.
8. WHEN A9/T10 is integrated, THEN `agent.routeOf` and `tools.routeOf` SHALL be published and rolled back as one shared route authority rather than two independently drifting owners.
9. WHEN S2/O8/O13/O14 is integrated, THEN `sessionDurable` epoch cleanup SHALL restore only its durable overlay and SHALL preserve the current M1 session facade.

## 7. B 类执行顺序、重入与收敛（B 类共同契约）

**User Story**: As a plugin author, I want translated operations to converge deterministically, so that multiple M2 owners cannot recurse, duplicate effects, or leak state across operations.

**Acceptance Criteria**:

1. WHEN an LLM operation starts, THEN L4 transform registrations and L2 image-policy registrations SHALL be snapshotted according to their approved operation boundary.
2. WHEN an LLM candidate is processed, THEN L4 transforms SHALL run before constrained L2 image processing, and convergence assertions SHALL run before an accepted candidate reaches the official continuation or owner re-entry.
3. WHEN an LLM candidate remains unchanged, THEN the original official continuation SHALL run exactly once; WHEN it changes, THEN the original continuation SHALL be suppressed and at most one owner-marked public re-entry SHALL occur.
4. WHEN an owner observes its own re-entry marker, THEN it SHALL bypass itself while preserving foreign owner markers and exact live `AbortSignal` identity.
5. WHEN nested or concurrent translated operations execute, THEN their registration snapshots, route captures, markers, policy selections, diagnostics, and cleanup state SHALL remain isolated.
6. IF a transform, policy, validator, classifier, marker, or convergence check cannot prove a request candidate safe under the approved L2/L4 contract, THEN that operation SHALL reject through its approved typed fail-closed path and SHALL NOT forward the original or partial candidate.
7. WHEN an official terminal LLM error occurs after an accepted request path, THEN its object identity and rejection semantics SHALL propagate unchanged.
8. WHEN a tool execution first reaches the approved pre-execute capture point, THEN route authority SHALL capture at most one snapshot before facade listeners and SHALL reuse that immutable result across later lifecycle stages without rewriting the execution.
9. WHEN `appendMessage` accepts a message, THEN it SHALL perform exactly one official append with the approved causal metadata; WHEN preflight cannot prove the finite message contract or provenance, THEN it SHALL fail before persistence without appending or mutating history.
10. WHEN M2 integration completes, THEN no translated operation SHALL produce more than its approved one request continuation/re-entry, one route capture, or one durable append.

## 8. Catalog、durable record 与瞬态事件边界（A/B 边界）

**User Story**: As an event consumer, I want transient Cordis events and durable session records kept distinct, so that catalog membership accurately describes subscription semantics.

**Acceptance Criteria**:

1. WHEN M2 branches are integrated, THEN `pluginApi.events.catalog` SHALL retain the M1 schema, composition, freeze, scope, fault, and duplicate-name contracts for all existing entries.
2. WHEN M2 integration completes, THEN none of L2, L4, A9, A11, S2, T10, O8, O13, O14, or SV17 SHALL add an event catalog slice or synthetic Cordis event name.
3. WHEN L4 executes, THEN `llm/request` SHALL remain a facade operation/translation and SHALL NOT be exposed as a subscription event.
4. WHEN route data is captured, THEN it SHALL remain query-only through `routeOf(exec)` and SHALL NOT appear as `exec.route`, an execution mutation, or a synthetic route event.
5. WHEN an O8/O13/O14 record commits, THEN it SHALL remain a durable official session record observed through the approved `session.onDurable` or `session.onceDurable` API over the existing A-class `session/event` substrate.
6. WHEN a durable record is observed, THEN the integration SHALL NOT replay history, poll session state, synthesize a second notification, or re-dispatch it through `pluginApi.events`.
7. WHEN a `compaction/*` record exists in session history, THEN its name SHALL remain durable session-log data and SHALL NOT imply a Cordis event or a `pluginApi.events` catalog entry.
8. WHEN catalog composition or duplicate validation fails, THEN the events feature SHALL follow its existing contained P2 behavior without reclassifying durable APIs or disabling unrelated M2 facades.
9. WHEN integration completes, THEN tests and documentation SHALL distinguish event catalog cardinality from the five-entry durable-event catalog and the 19-entry services namespace.

## 9. A 类直通与 services.compaction（A 类稳定化）

**User Story**: As a facade consumer, I want A-class additions to remain transparent, so that integration adds stability without mediating official behavior.

**Acceptance Criteria**:

1. WHEN any A11 consumer or provider method is called, THEN the integration SHALL forward exactly to the approved official agent registry service with no argument cloning, promise adoption, return wrapping, retry, error translation, or disposer wrapping.
2. WHEN an A11 member is unavailable on an otherwise valid registry, THEN only that declared member SHALL use its approved disabled presentation; other M1 and A11 agent members SHALL remain available.
3. WHEN `services.compaction.compactIfNeeded`, `compactNow`, or `compactRegion` is called, THEN the integration SHALL preserve the official receiver, exact supplied argument count and identity, omitted optional arguments, return identity and timing, and thrown or rejected error identity.
4. WHEN `services.compaction` is inspected, THEN it SHALL expose only `isActive` and the three approved abstract operations; backend-specific `summarize`, configuration, automatic state, and arbitrary runtime members SHALL be absent.
5. WHEN compaction is the only resolvable official capability service, THEN the parent `services` feature SHALL be active and the other 18 unavailable service members SHALL retain their approved disabled behavior.
6. WHEN an official A-class call fails after successful facade construction, THEN the error SHALL propagate according to the owning feature contract and SHALL NOT be reclassified as mount or guard failure.
7. WHEN M2 integration completes, THEN no A11 or SV17 behavior SHALL depend on B-class translation infrastructure.

## 10. API 协议与包契约（整合基础）

**User Story**: As a plugin author, I want the protocol version to identify the integrated M2 surface, so that compatibility checks cannot confuse M1 and M2 contracts.

**Acceptance Criteria**:

1. WHEN M2 integration delivers, THEN `package.json.dsh.api` SHALL advance from `0.2` to `0.3`.
2. WHEN M2 integration delivers against official runtime `0.1.0-rc.6`, THEN `package.json.version` SHALL be `0.1.0-rc.6-0.3` and SHALL remain the repository's unique full version.
3. WHEN runtime-to-facade compatibility is checked, THEN it SHALL require the facade version's full runtime portion (including patch and prerelease) to exactly equal the installed audited runtime, independently from plugin-to-facade API protocol comparison.
4. WHEN API protocol minor versions advance, THEN they SHALL continue numeric progression and SHALL NOT promote to `1.0`; protocol `1.0` SHALL remain reserved for first public release.
5. WHEN package metadata is unified, THEN every approved host package identity required by all M2 features SHALL be declared through peer dependencies or the existing approved package surface, and no facade-unrelated runtime dependency SHALL be introduced.
6. WHEN version assertions, compatibility tests, docs, examples, or sibling-plugin requirements refer to the facade version, THEN they SHALL agree on the integrated `0.3` protocol and full version.
7. IF the installed official runtime full version differs from the audited M2 runtime, THEN the facade SHALL retain its existing fail-safe runtime incompatibility behavior rather than silently accepting the mismatch.

## 11. 增量验证、全量回归与 fail-safe（整合基础）

**User Story**: As a maintainer of delivered behavior, I want evidence at every integration boundary, so that regressions are localized and final success is reproducible.

**Acceptance Criteria**:

1. WHEN an admitted branch is merged, THEN the integration SHALL run that feature's focused tests and every directly affected shared-facade or host-apply test before the next branch merge.
2. WHEN a unification task changes a shared contract, THEN the integration SHALL run focused tests for all feature owners of that contract before proceeding.
3. WHEN M2 integration completes, THEN the full `node --test` suite SHALL pass on the integrated branch.
4. WHEN tests from an earlier feature conflict with an explicitly superseded L2/L4 requirement, THEN the integration SHALL update or remove only the superseded assertion and SHALL provide replacement coverage for the new contract in the same change.
5. WHEN integration completes, THEN all unaffected M0/M1 requirements, facade shapes, event treatment, scope behavior, failure paths, version negotiation directions, and lifecycle semantics SHALL retain regression coverage.
6. WHEN combined lifecycle tests run, THEN they SHALL cover guard failure, mount failure at every publication boundary, registration failure, rollback, P1-P4 precedence, retained facade references, repeated apply, repeated disposal, stale disposal, nested/concurrent B operations, and unrelated-feature survival.
7. WHEN combined shape tests run, THEN they SHALL cover additive `agent`, `tools`, `session`, and `llm` composition; 19-key services cardinality; unchanged event catalog membership; five-kind durable catalog membership; and absence of duplicate facade construction.
8. WHEN any M2 feature's dependencies or logger are absent, malformed, or throwing, THEN fail-safe tests SHALL prove harness boot continues and the affected feature reaches its approved disabled state.
9. WHEN final verification runs, THEN `git diff --check` SHALL pass and the integration SHALL verify that no official DSH package file was modified.

## 12. `dsh-read-image` 迁移验收（整合基础）

**User Story**: As the maintainer of `dsh-read-image`, I want the integrated facade to replace its LLM and route hacks, so that the plugin no longer depends on official internals for those semantics.

**Acceptance Criteria**:

1. WHEN `dsh-read-image` is migrated, THEN it SHALL register only the approved constrained L2 image policy and any approved L4 transform required by its message projection behavior.
2. WHEN migration completes, THEN the plugin SHALL contain no A1 `resolveModelInfo` monkey-patch, A2 raw `llm/stream` projection owner, recursive `this.stream(projected)` path, legacy `project` registration field, or dependency on the superseded admission active signal.
3. WHEN route access is migrated, THEN the plugin SHALL use the supported A9/T10 `routeOf(exec)` facade and SHALL remove its A6 private traversal of agent/session request state.
4. WHEN no route snapshot is available, THEN the migrated plugin SHALL preserve its approved safe missing-route behavior without recreating an unsupported fallback inference path.
5. WHEN migration tests run, THEN they SHALL preserve message-only ordering, nested tool-result projection, image-free terminal validation, route-based behavior, and exact disabled/failure behavior required by the consumer Spec.
6. WHEN migration acceptance runs, THEN the plugin's full relevant test suite, documented headless smoke, and documented dev boot SHALL pass against the integrated facade with no activation error.
7. WHEN migration completes, THEN removed hacks SHALL NOT remain as dormant fallback code or an unsupported direct-package escape hatch.

## 13. `dsh-pro-ex-ability-anchor` 迁移验收（整合基础）

**User Story**: As the maintainer of `dsh-pro-ex-ability-anchor`, I want the session facade to construct supported surface-message metadata, so that the plugin no longer hand-authors the migrated durable append details.

**Acceptance Criteria**:

1. WHEN the target plugin appends an approved user, assistant, or tool-result surface message, THEN it SHALL use `pluginApi.session.appendMessage` for the finite S2 contract instead of hand-authoring migrated `surfaceOp` or `sourceEventSeqs` metadata.
2. WHEN migration completes, THEN the plugin SHALL preserve raw official `tool/call` boundaries and SHALL NOT force unsupported title correction, replacement, atomic-turn, arbitrary event, or history-mutation semantics through `appendMessage`.
3. WHEN provenance is explicit or unambiguously derivable, THEN the migrated plugin SHALL produce the approved surface result through one official append; WHEN provenance is ambiguous or unsupported, THEN it SHALL preserve the facade's fail-before-persistence behavior.
4. WHEN migration acceptance runs, THEN tests SHALL prove the consumer's actual repository path uses the facade; an in-facade mapping fixture alone SHALL NOT satisfy migration acceptance.
5. WHEN migration acceptance runs, THEN the plugin's full relevant test suite, documented headless smoke, and documented dev boot SHALL pass against the integrated facade.
6. IF consumer behavior requires semantics outside the finite S2 contract, THEN the integration SHALL leave that behavior on its existing supported official path or report it as a separate Spec input; it SHALL NOT widen S2 during integration.
7. WHEN migration completes, THEN removed hand-authored metadata logic SHALL NOT remain as a dormant fallback for the migrated message kinds.

## 14. 文档、状态与交付登记（整合基础）

**User Story**: As a future maintainer, I want every source of truth synchronized, so that delivered M2 behavior and its limits can be reconstructed without reading branch history.

**Acceptance Criteria**:

1. WHEN M2 integration completes, THEN root `AGENTS.md` §8 SHALL register `plugin-api-m2-integration` and every integrated concrete M2 feature with their final scopes, classifications, feature keys, failure boundaries, and critical constraints.
2. WHEN M2 integration completes, THEN `docs/specs/plugin-api-features/feature-list.md` SHALL mark L2, L4, A9, A11, S2, T10, O8, O13, O14, and SV17 delivered with final public shapes and SHALL retain C/M3/M4 items as planned or proposal-only.
3. WHEN integration changes a public contract or intentionally supersedes an earlier requirement, THEN every affected upstream Spec, supersession record, test assertion, and migration note SHALL identify the final authority without contradictory active wording; specifically, M1 integration Requirement 7.2's `resolveModelInfo` wrapper ownership SHALL move from the retired `admission-bridge.js` to the approved L2 scoped gateway while retaining the exactly-one-wrapper invariant.
4. WHEN documentation states catalog or namespace counts, THEN it SHALL distinguish the composed Cordis event catalog, five-kind durable catalog, and 19-key services namespace and SHALL derive changing totals from delivered slices where applicable.
5. WHEN package or peer-dependency facts change, THEN package tests, public API documentation, examples, and compatibility guidance SHALL be synchronized.
6. WHEN migration acceptance completes, THEN both target plugin repositories SHALL document their supported facade dependency and SHALL remove or revise hack inventories that describe deleted code as current.
7. WHEN final delivery is recorded, THEN no Stage status, task checkbox, feature-list row, AGENTS registry entry, version assertion, or supersession statement SHALL contradict the committed integration state.

## 15. 范围控制与上游边界（整合基础 / C 类边界）

**User Story**: As the M2 coordinator, I want the integration scope closed, so that merge pressure cannot introduce unapproved behavior or new compatibility debt.

**Acceptance Criteria**:

1. WHEN integration work is performed, THEN it SHALL NOT add a feature, public member, alias, event, catalog slice, remote, codec, client bundle, setting bridge, or service operation absent from the approved upstream feature Specs and this integration Spec.
2. WHEN an official extension point is insufficient for full fidelity, THEN the integration SHALL preserve the approved constrained behavior or C-class boundary and SHALL NOT import module-private state, patch official DSH files, or silently emulate unsupported semantics.
3. WHEN LLM behavior is unified, THEN full or asynchronous request replacement, response rewriting, same prepared-call identity, arbitrary modality admission, and adapter-private interception SHALL remain outside M2.
4. WHEN route behavior is unified, THEN exact per-request causality, route rewriting, fallback inference from headers/options/defaults, execution mutation, and route events SHALL remain outside M2.
5. WHEN session behavior is unified, THEN generic append, arbitrary durable types, history mutation, persistence implementation, polling/replay, synthetic redispatch, and client durable APIs SHALL remain outside M2.
6. WHEN compaction behavior is unified, THEN backend creation, registration, replacement, configuration, policy changes, backend-specific summarization, and compaction events SHALL remain outside M2.
7. WHEN M2 integration completes, THEN it SHALL NOT implement M3 client/settings bridge work or M4 upstream proposals.
8. IF quality-preserving integration requires a new shared runtime abstraction, THEN it SHALL be introduced only when at least two approved consumers require the same semantics and SHALL remain private unless a separately approved public contract exists.
9. WHEN an out-of-scope requirement is discovered during migration or verification, THEN the integration SHALL report it as a separate Spec input and SHALL NOT hide it in conflict resolution or unrelated cleanup.

---

## Host / Client Coverage

- **Host:** All integrated runtime APIs and semantic translations remain in the host Cordis tree.
- **Client:** No browser-facing namespace, remote contribution, codec, slot, bundle, or settings bridge is introduced.
- **Consumers:** `dsh-read-image` and `dsh-pro-ex-ability-anchor` are changed only where Requirements 12 and 13 require migration and acceptance.

## Success Condition

Stage 4 is complete only when every admitted M2 branch is integrated through both waves, the combined facade and lifecycle contracts satisfy Requirements 1-11, both consumer migrations satisfy Requirements 12-13, governance satisfies Requirement 14, scope boundaries satisfy Requirement 15, all required tests and boot checks pass, and the final Stage 4 delivery is committed.
