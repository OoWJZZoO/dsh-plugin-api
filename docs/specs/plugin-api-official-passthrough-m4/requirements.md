# Requirements: plugin-api-official-passthrough-m4

> feature_name: `plugin-api-official-passthrough-m4`
> stage: 1 (Requirements)
> status: revised after adversarial review; pending user confirmation
> milestone: M4

## Introduction

本 feature 为 `docs/specs/plugin-api-features/feature-list.md` 中 M4 登记的全部 feature 建立统一、可测试的验收契约。范围包括核心 host namespace 补面、host service seam、host event catalog、client service/event/API，以及已经标记 delivered 的 M4 条目的状态核验和回归保护。

本文件只规定外部行为和验收边界，不规定具体模块、文件、worktree 或实现算法。后续 Design 再决定各需求由现有 facade、service definition、catalog slice 或 client leaf 如何承载。

### Classification

- **A 类**：M4 的主要范围。官方已经提供 service、公开方法或 dispatch 点，本 feature 只稳定化其公开面并保持官方语义。
- **B 类**：M4 中仅包含已交付的 `RB1` host remote publish 能力。本阶段只要求状态核验和回归保护，不新增 B 类能力。
- **C 类**：不属于本 feature。M4 不实现任何 C 类 upstream proposal。

### Common Terms

- **官方公开面**：feature-list 及其来源文件所登记的官方 service、method、getter、event 或 client provider/API；不包括模块私有变量和 concrete provider 私有成员。
- **透传语义**：保持调用参数、参数数量、receiver、同步/异步返回、Promise、disposer、异常、rejection 和对象 identity，除非本文件明确要求只读快照、事件 catalog 元数据或既有 fail-safe 降级。
- **局部降级**：缺失或形状不完整的单个能力只使其所属 namespace member、service、event slice 或 client leaf 不可用，不影响无关能力和基础 facade。
- **M4 inventory**：本文件“Feature-list Coverage”表列出的全部 M4 ID；该表是需求追踪基线，不改变 feature-list 的权威性。
- **失败呈现映射**：P1 表示 `PluginApiInactiveError`；P2 表示 `PluginApiFeatureDisabledError`，其 `code === 'PLUGIN_API_FEATURE_DISABLED'` 且 `feature` 为所属 feature 名；P3 表示 `PluginApiServiceUnavailableError`，其 `code === 'PLUGIN_API_SERVICE_UNAVAILABLE'` 且 `service` 为缺失服务名；P4 表示逐成员或逐 client-leaf disabled facade，要求该 facade 的 `isActive === false`，其可调用操作抛出对应 `PluginApiFeatureDisabledError`。除非某条需求明确指定，任何“按既有 guard 降级”均必须落入上述四种路径之一。

### Stage 1 scope corrections recorded for M4

本 Requirements 对 feature-list 中两个开放表述作出可审计的范围收窄，作为本 feature 的显式 scope correction。它们不新增 feature-list ID，也不扩展运行时能力：

- L12 的“同组官方公开工件”固定为 `contentHasImage`、`createUserMessage` 和 `BlockAssembler` 三项；不隐含同 package 的其他导出。该修订对应 feature-list L12 的歧义，后续 feature-list 状态同步必须保留这三个明确成员。
- A13 的“至少 provider/model，保留其他官方声明配置字段”按当前审计到的官方 `AgentOptions` 完整集合固定为 `provider`、`model`、`maxTokens`；不暴露 Agent、Session、Context、Inbox 或私有 registry 状态。若官方后续新增声明字段，必须先更新 M4 inventory/Requirements，再改变门面范围。

## User Stories and Acceptance Criteria

### Requirement 1: M4 inventory completeness

**User Story:** As the plugin API maintainer, I want every M4 feature-list entry represented in the M4 contract and verification plan, so that the milestone cannot silently omit a listed feature.

#### Acceptance Criteria

1. WHEN the M4 contract is reviewed THEN the feature SHALL include every ID listed in the Feature-list Coverage table, including entries already marked delivered.
2. WHEN a listed M4 entry is already delivered THEN the feature SHALL verify its current public shape and regression behavior without reimplementing or renaming it.
3. WHEN the M4 implementation and integration evidence is completed THEN the evidence SHALL identify the result for every M4 ID as delivered, intentionally unavailable through a named P1/P2/P3/P4 guard path, or an explicitly approved scope correction; no ID SHALL remain unaccounted for.
4. WHERE an M4 entry is classified as A THEN the entry SHALL be handled as an official passthrough or official event stabilization requirement; WHERE an M4 entry is classified as B THEN the entry SHALL remain limited to the already delivered capability and its regression contract.
5. WHEN a delivered M4 entry is verified THEN the verification SHALL assert its exact approved public members and its negative boundary, rather than treating a passing boot or aggregate test as proof of coverage.

### Requirement 2: Core host namespace passthrough

**User Story:** As a third-party host plugin author, I want the remaining core host APIs exposed through `pluginApi`, so that I can use the official runtime public surface without importing private implementation modules.

#### Acceptance Criteria

1. WHEN the official dependency for an in-scope core namespace is present and exposes the required public surface THEN `pluginApi` SHALL expose the corresponding M4 methods, getters, constants, constructors, or helpers listed for L11, L12, A12, A13, S7, S8, T12, T13, P9, and ST9.
2. WHEN a consumer invokes an in-scope core passthrough method THEN the facade SHALL preserve the official argument values, argument count, receiver semantics, synchronous or asynchronous return behavior, returned object identity, Promise identity where applicable, disposer identity where applicable, and thrown or rejected error behavior.
3. WHEN a consumer reads an in-scope read-only state or configuration surface THEN the facade SHALL preserve the declared official shape and SHALL NOT expose mutable private registry state beyond the feature-list contract.
4. WHEN a required core dependency or required member is unavailable or malformed THEN the affected core capability SHALL fail closed as P2 (`PluginApiFeatureDisabledError` with the owning feature name), while the root `pluginApi` facade and unrelated active capabilities SHALL remain available; when the root facade itself is inactive, the affected operation SHALL use P1 (`PluginApiInactiveError`).
5. WHEN the official session API creates, prepares, enters, announces, flushes, appends, or derives session data through S7 or S8 THEN the facade SHALL preserve the official durable event and projection behavior and SHALL NOT add synthetic projection or business semantics.

### Requirement 3: LLM public provider and construction surface

**User Story:** As a host plugin author, I want the remaining official LLM provider queries and public construction artifacts available from `pluginApi.llm`, so that provider-aware integrations can use the runtime contract directly.

#### Acceptance Criteria

1. WHEN an active official LLM service exposes the L11 operations THEN `pluginApi.llm` SHALL expose `listProviders`, `listConfigurableProviders`, `discoverModels`, `providerRetryPolicy`, `listModels`, and `resolveCallConfig` with their official parameters, optional signal behavior, return values, and errors.
2. WHEN a consumer uses an L12 public LLM artifact THEN `pluginApi.llm` SHALL expose exactly the official `contentHasImage`, `createUserMessage`, and `BlockAssembler` artifacts listed by the M4 contract, without cloning, rewriting, or changing their identity semantics; the Stage 1 scope correction above SHALL be treated as the complete L12 member whitelist.
3. WHEN an L11 or L12 official member is unavailable THEN only the affected LLM capability SHALL be reported unavailable through P2 (`PluginApiFeatureDisabledError` with the owning LLM feature name), and existing M1/M2 LLM APIs SHALL continue to follow their current behavior.

### Requirement 4: Agent and session lifecycle surface

**User Story:** As a host plugin author, I want the remaining official agent and session lifecycle operations available through stable namespaces, so that integrations can create, inspect, and control runtime objects without depending on private registries.

#### Acceptance Criteria

1. WHEN the official agent registry exposes A12 operations THEN `pluginApi.agent` SHALL expose `currentInitiator`, `requireInitiator`, `withInitiator`, `withoutInitiator`, and `isOwnedBy` with official callback, owner, return, error, and lifecycle semantics.
2. WHEN a consumer reads A13 configuration THEN `pluginApi.agent` SHALL expose an immutable, stable snapshot containing exactly the approved current `AgentOptions` fields `provider`, `model`, and `maxTokens` (each with its official value, including `undefined` when absent), and SHALL NOT expose live agent, session, context, inbox, or private registry state through this member; the Stage 1 scope correction above SHALL be treated as the complete A13 member whitelist.
3. WHEN the official session store exposes S7 operations THEN `pluginApi.session` SHALL expose `create`, `prepare`, `enter`, `announce`, and `flush` without changing the official session identity or lifecycle ordering.
4. WHEN the official session store exposes S8 operations THEN `pluginApi.session` SHALL expose `append` and `deriveEventMessage` while preserving official durable event, projection, sequence, and error behavior.
5. WHEN an agent or session dependency is unavailable or malformed THEN its affected M4 member or feature SHALL degrade locally through P2 (`PluginApiFeatureDisabledError` with the owning feature name), and existing delivered agent/session capabilities SHALL remain usable when their own guards pass; an inactive root facade SHALL use P1.

### Requirement 5: Tools and system prompt surface

**User Story:** As a host plugin author, I want the remaining official tool and system-prompt operations available through the facade, so that tool definitions and prompt assembly can use the same public runtime semantics as first-party plugins.

#### Acceptance Criteria

1. WHEN the official tools service exposes T12 THEN `pluginApi.tools.executionMode(exec)` SHALL return the official execution mode for the supplied execution and preserve official missing, invalid, synchronous, and error outcomes.
2. WHEN the official tools package exposes T13 THEN `pluginApi.tools.defineTool(options)` SHALL produce the official tool definition semantics, including schema conversion, validation, presentation, timeout metadata, and concurrency metadata, without duplicating or reinterpreting tool execution.
3. WHEN the official system-prompt service exposes P9 THEN `pluginApi.systemPrompt.assemble(context?)` SHALL preserve the official assembly result, arguments, context semantics, and error behavior.
4. WHEN a listener participates in the in-scope `system-prompt/assemble` waterfall THEN the listener SHALL be able to observe and modify the assembly fields permitted by the official waterfall contract before and after `await next()`, and the facade SHALL NOT apply a read-only freeze policy that prevents those official writes.
5. WHEN T12, T13, P9, or P10 dependencies are unavailable or malformed THEN the affected capability SHALL degrade locally through P2 (`PluginApiFeatureDisabledError` with `tools` or `systemPrompt` as applicable), without disabling unrelated tools, system-prompt, events, or facade capabilities.
6. WHEN a consumer calls the already delivered `tools.toolAbortedError()` with the official `HarnessError` and `TOOL_ABORTED` dependencies available THEN the result SHALL be an instance of that exact `HarnessError` constructor with `code === TOOL_ABORTED`, `name === 'AbortError'`, and `message === 'tool call aborted'`; WHEN either dependency is unavailable or malformed THEN the result SHALL be a plain `Error` with `name === 'AbortError'` and `message === 'tool call aborted'`, without an invented error code; WHEN the `tools` feature is disabled THEN the operation SHALL throw `PluginApiFeatureDisabledError` with `code === 'PLUGIN_API_FEATURE_DISABLED'`, `feature === 'tools'`, and default message `dsh-plugin-api feature "tools" is disabled and its API is unavailable`.

### Requirement 6: Settings document and writable operations

**User Story:** As a settings-integrating plugin author, I want the remaining official writable settings document operations exposed through `pluginApi.settings`, so that I can use the official settings lifecycle without direct service access.

#### Acceptance Criteria

1. WHEN the official settings scope exposes ST9 THEN `pluginApi.settings` SHALL expose `writable`, `prepareDocument`, `get`, `update`, `replace`, and `mutate` with official argument, return, Promise, revision, validation, and error semantics.
2. WHEN a consumer obtains an ST9 writable settings object THEN the facade SHALL preserve the official read/write boundary and SHALL NOT expose settings internals outside the approved public contract.
3. WHEN the official settings service is unavailable THEN the ST9 capability SHALL report P3 (`PluginApiServiceUnavailableError` with `service === 'settings'`); WHEN the settings service is present but the ST9 member is unavailable or malformed THEN it SHALL report P2 (`PluginApiFeatureDisabledError` with `feature === 'settings'`); neither path SHALL disable unrelated settings registration, settings events, or the root facade.

### Requirement 7: Host event stabilization

**User Story:** As a host plugin author, I want the remaining official host events available through the typed event catalog, so that I can observe runtime changes without binding directly to private event producers.

#### Acceptance Criteria

1. WHEN the official host event producer is active THEN `pluginApi.events` SHALL expose these exact O17-O20 event names and payload signatures: `agent-loop/config-start-failed(payload: {sessionId, error})`; `agent-preset/selected(sessionId, agentPreset)`; `cordis/dynamic-package(pkg)`; `cordis/dynamic-retract(retracted)`; `cordis/request-run(request)`; `cordis/request-run-resolved(resolved)`; `cordis/inspect-query(request)`; `cordis/inspect-query-resolved(resolved)`; and `domain/changed(change: DomainChanged)`. No additional event name or payload member is implied by the grouping.
2. WHEN a consumer subscribes to an in-scope host event THEN dispatch SHALL preserve the official event mode, argument order, payload identity, scope behavior, and contained or propagated failure behavior declared by the approved event contract; an unavailable owning slice SHALL remain guarded/inert rather than synthesize a payload.
3. WHEN an in-scope event producer is absent or malformed THEN its event slice SHALL be excluded or inert as a guarded catalog slice (no synthetic producer and no error required for unrelated slices), without disabling unrelated event slices; if a consumer invokes a feature-level event API whose owning feature is disabled, that API SHALL use P2.
4. WHEN the composed host catalog is inspected THEN it SHALL contain exactly the approved M4 event additions for active dependencies, with no governance classification identifiers or unapproved event names leaking into the runtime catalog.

### Requirement 8: Host service seam catalog

**User Story:** As a host plugin author, I want the remaining official service seams available through `pluginApi.services`, so that I can consume approved public services through a read-only, provider-independent facade.

#### Acceptance Criteria

1. WHEN an official service listed in SV21–SV48 is available with its required public members THEN `pluginApi.services` SHALL expose the corresponding namespace and only the members listed for that service.
2. WHEN a consumer invokes an SV21–SV48 method or reads an approved getter THEN the facade SHALL preserve official arguments, receiver semantics, return and Promise identity, disposer identity, thrown or rejected errors, and lifecycle behavior.
3. WHEN an official service contains extra concrete-provider members, mutable registry state, or unrelated methods THEN the facade SHALL NOT expose those members.
4. WHEN one service is missing or incomplete THEN only that service facade SHALL be disabled through P4 (`isActive === false`, with its operations throwing `PluginApiFeatureDisabledError` whose `feature` is `services.<service>`); other complete services and the root `services` namespace SHALL remain available.
5. WHEN all active service definitions are composed THEN the namespace SHALL include every M4 service listed in the Feature-list Coverage table, in addition to previously delivered services, without duplicate keys or changed semantics for M1/M2 services.
6. WHEN the already delivered SV19 or SV20 service is exercised THEN its nine or three declared operations, exact argument forwarding, receiver behavior, disposer identity, and local degradation behavior SHALL remain protected by regression coverage.

### Requirement 9: Client service, event, and connection surface

**User Story:** As a browser-side plugin author, I want the remaining official client services, events, and LLM connection catalog APIs available through `pluginApi.client`, so that browser integrations can use the runtime's outward face without duplicating provider discovery or event wiring.

#### Acceptance Criteria

1. WHEN an official browser service listed in C10–C20 is available and valid THEN `pluginApi.client` SHALL expose the corresponding service with exactly these approved member whitelists and official argument, return, Promise, disposer, and error semantics: `modules`: `version`, `loadCache`, `import`, `registerStatic`, `prefetch`, `invalidate`; `locale`: `getLocale`, `getSnapshot`, `subscribe`, `setLocale`, `register`, `bind`; `sessions`: `list`, `currentProvideInfo`, `searchResultLimit`, `open`, `openSubagent`, `subagentAddress`, `setSubagentCatalogOpen`, `refreshSubagents`, `noteAgentPreset`, `clear`, `search`, `fork`, `provide`, `scope`, `scopeOf`, `sessionOf`, `binding`; `workspaces`: `list`, `connectWorkspace`, `startSession`, `create`, `pickDirectory`, `listDirectory`, `createDirectory`, `openPath`, `rename`, `delete`, `insertBefore`, `insertSessionBefore`, `archiveSession`; `chatFileMentions`: `forClosing`; `layout`: `toggleSidebar`, `openDetails`, `closeDetails`; `theme`: `getTheme`, `exportInspectTokens`, `setTheme`, `register`, `overrideTokens`; `appShell`: `renderApp`; `sessionLogDownload`: `store`, `download`, `dismiss`, `dispose`; `cordisInspect`: `register`, `publish`, `query`, `close`; and `dynamicCordisRunner`: `activeRuns`, `lastRunError`, `renderFailures`, `reconcileApprovals`, `approve`, `decline`, `startUserRun`, `subscribe`, `getSnapshot`, `isLoaded`. The listed contract members are the complete C12, C13, and C20 outward-face scope; constructors, concrete-provider members, and additional same-package exports are excluded.
2. WHEN an official browser event listed in C21–C24 is dispatched THEN the client event facade SHALL preserve its event name, argument order, payload identity, dispatch timing, listener lifecycle, and contained failure behavior.
3. WHEN the official client connection exposes C25 THEN `pluginApi.client.connection.api.llm` SHALL expose `providers`, `models`, and `discoverModels` while preserving official RPC endpoint, payload, signal, return, and error semantics.
4. WHEN an optional client service or event dependency is absent, malformed, or throws during resolution THEN only its owning client leaf SHALL degrade, while unrelated client leaves and the client facade SHALL still publish when their own guards pass.
5. WHEN the client bundle is applied more than once or disposed out of order THEN client service publication, event subscriptions, and cleanup SHALL remain idempotent and identity-safe, and a stale disposer SHALL NOT remove a newer active registration.
6. WHEN a client service returns a cleanup handle or controller THEN the facade SHALL preserve its official identity and lifecycle behavior, and SHALL NOT wrap it in an incompatible local abstraction.

### Requirement 10: Delivered remote publish regression contract

**User Story:** As a maintainer of the already delivered remote publication capability, I want RB1 regression coverage retained while M4 is integrated, so that the unified feature does not silently weaken the existing host/client boundary.

#### Acceptance Criteria

1. WHEN the delivered `remote.publish(serviceKey, service)` capability is active THEN it SHALL continue to publish only the declared JSON-safe service endpoints through the official Typert remote contract, preserving wire parameter names and owner-scoped disposer behavior.
2. WHEN the delivered remote capability is unavailable or malformed THEN it SHALL degrade through P2 (`PluginApiFeatureDisabledError` with `feature === 'remote'`) without disabling unrelated M4 host or client capabilities.
3. WHEN M4 integration is reviewed THEN RB1 SHALL be recorded as verified or explicitly corrected, and SHALL NOT be reimplemented under a new name or silently treated as an untracked new requirement.

### Requirement 11: Fail-safe, compatibility, and no scope leakage

**User Story:** As a harness operator, I want M4 failures isolated and the existing facade stable, so that an optional official capability cannot turn a local compatibility problem into a boot failure or an unrelated regression.

#### Acceptance Criteria

1. WHEN any M4 host or client entry encounters a missing dependency, malformed public surface, throwing getter, synchronous exception, or rejected Promise during activation or cleanup THEN the entry SHALL fail safe by logging or reporting through the established path and SHALL NOT throw through the plugin apply boundary.
2. WHEN one M4 capability is disabled THEN unrelated M0–M3 and already delivered M4 capabilities SHALL retain their prior public shape and behavior.
3. WHEN M4 is applied repeatedly, disposed, or reactivated after a partial failure THEN active publication, event hooks, catalog slices, and client leaves SHALL not duplicate, leak, or remove a newer owner.
4. WHEN M4 verification is complete THEN no implementation or runtime-facing identifier SHALL introduce C-class proposals, R-class replacement behavior, governance magic identifiers, or imports of official private module state.
5. WHEN the official runtime provides a public method or value with a falsey, undefined, null, rejected, or thrown result THEN the facade SHALL preserve that official result unless the approved local guard contract explicitly defines a degradation boundary.

### Requirement 12: Verification and traceability

**User Story:** As a reviewer, I want machine-checkable coverage evidence for every M4 feature and every failure boundary, so that the milestone can be accepted without relying on aggregate green tests alone.

#### Acceptance Criteria

1. WHEN each Stage 4 top-level batch is completed THEN its focused tests SHALL cover the batch's listed feature IDs, exact public shape, success path, missing/incomplete dependency path, and relevant lifecycle or identity behavior.
2. WHEN M4 integration is completed THEN verification SHALL include the exact host namespace, host service, host event, and client surface cardinalities derived from the approved inventory, plus negative assertions for unapproved members and event names.
3. WHEN M4 integration is completed THEN verification SHALL include full existing regression tests and targeted host/client boot checks, while distinguishing unit, integration, and deployed-runtime evidence in the delivery report.
4. WHEN the final M4 traceability report is produced THEN every ID in the Feature-list Coverage table SHALL map to a requirement, an implementation or existing delivered owner, focused verification evidence, and a final status.

### Requirement 13: Parallel worktree delivery

**User Story:** As the M4 implementation coordinator, I want the task plan to support safe parallel development in multiple worktrees, so that independent work can proceed concurrently without creating merge ambiguity, hidden semantic divergence, or weaker verification.

#### Acceptance Criteria

1. WHEN `tasks.md` is approved THEN it SHALL define the M4 top-level batches, their worktree or integration owner, feature-list IDs in scope, IDs explicitly out of scope, prerequisites, dependency edges, and the critical-path order.
2. WHEN two top-level batches are assigned to run in parallel THEN their write sets SHALL be disjoint, or the task plan SHALL assign a single owner and a mechanically composable edit protocol for every shared file; shared infrastructure with semantic ownership SHALL be frozen for parallel leaf work and changed only by the designated integration owner.
3. WHEN a top-level batch is assigned to a worktree THEN its task contract SHALL specify the allowed files, forbidden files, public vocabulary and contract inputs, focused tests, expected commit boundary, and the evidence required before the batch can be considered complete.
4. WHEN a later batch depends on an earlier batch THEN the later worktree SHALL be derived only from the earlier batch's committed boundary after the prerequisite batch has passed its focused review and quality gate.
5. WHEN a parallel wave is started THEN the task plan SHALL identify the wave's independent batches, the exact join point, and the conditions that make the next wave eligible; no batch SHALL begin against an uncommitted or partially reviewed prerequisite.
6. WHEN a top-level batch is completed THEN it SHALL receive one blocking adversarial review against the approved Requirements, Design, and Tasks before the next dependent batch or merge step begins; substantive deviations SHALL be corrected or explicitly recorded before integration.
7. WHEN parallel worktrees are ready to merge THEN the integration batch SHALL perform a read-only preflight covering scope/file ownership, uncommitted and untracked provenance, official-package diff, whitespace checks, and pairwise `git merge-tree` conflict edges before changing the integration branch.
8. WHEN the merge wave begins THEN branches SHALL be merged in the declared dependency order, focused tests SHALL run after each top-level batch, and the merge wave SHALL resolve conflicts and align the approved contract without introducing coordinator-wide refactors or unplanned feature work.
9. WHEN a shared semantic change is discovered during parallel implementation THEN the owning batch SHALL report it as an integration decision or deviation instead of independently changing the shared contract; the integration owner SHALL settle it once and record the resulting evidence.
10. WHEN the parallel implementation and merge process is complete THEN the full suite, affected host/client boot checks, exact inventory/cardinality checks, and final traceability report SHALL demonstrate that parallelization did not omit an M4 ID, duplicate an owner, weaken a fail-safe boundary, or change previously delivered behavior.
11. WHEN a task contract assigns a batch to a worktree THEN the contract SHALL use `.worktrees/<feature_name>-<batch-slug>` for the worktree and `codex/<feature_name>-<batch-slug>` for its branch, SHALL name the single integration owner, and SHALL record the baseline commit used to derive the worktree.
12. WHEN a parallel batch edits a catalog slice, facade leaf, service definition, or guard THEN its task contract SHALL state the neutral runtime names, exact public member/event lists, catalog schema (`name`, `mode`, `scopeFiltered`, `scopeKey`, `payload`, `args`, `fault`, `freeze`), allowed failure path (`P1` core inactive, `P2` feature disabled, `P3` optional service unavailable, or `P4` per-member disabled facade), and guard classification (required fail-closed or optional fail-open); runtime code SHALL NOT introduce governance classification letters or feature-list IDs as identifiers, strings, row names, or error text.
13. WHEN two batches are declared independent THEN the task contract SHALL list disjoint write sets and frozen files explicitly; the frozen set SHALL include shared event-bus/freeze semantics and centralized order/cardinality assertions, and any shared file with multiple mechanical append owners SHALL specify its insertion point and allowed edit form.
14. WHEN the integration preflight audits a branch THEN it SHALL independently check the branch against its task contract and approved Requirements/Design/Tasks, including naming/schema/failure-path/guard compliance, feature coverage, negative scope, official-package immutability, `git diff --check`, and untracked-file provenance; an unreported contract deviation SHALL fail preflight and block merge until corrected or explicitly accepted by the integration owner.
15. WHEN a batch intentionally deviates from its task contract or discovers a required shared semantic change THEN the deviation SHALL be recorded in the owning worktree's Requirements or Design revision note, the batch delivery report, and the integration decision log; the record SHALL state the reason, affected IDs/files, compatibility impact, and verification evidence.
16. WHEN a parallel wave reaches its join point THEN every branch in the wave SHALL have a committed boundary, focused tests, an independent audit result, a blocking adversarial review result, and a clean provenance/preflight record before any dependent wave or merge begins.

## Feature-list Coverage

本表逐项锁定 M4 范围。`planned` 项需要在本 feature 中实现并验收；`delivered` 项需要回归核验，不得遗漏或重复认领。

| ID | Surface | Class | Status in feature-list | Requirement coverage |
|---|---|---|---|---|
| L11 | Core host namespace | A | planned | R2, R3 |
| L12 | Core host namespace | A | planned | R2, R3 |
| A12 | Core host namespace | A | planned | R2, R4 |
| A13 | Core host namespace | A | planned | R2, R4 |
| S7 | Core host namespace | A | planned | R2, R4 |
| S8 | Core host namespace | A | planned | R2, R4 |
| T11 | Core host namespace | A | delivered | R1, R5, R11, R12 |
| T12 | Core host namespace | A | planned | R2, R5 |
| T13 | Core host namespace | A | planned | R2, R5 |
| P9 | Core host namespace | A | planned | R2, R5 |
| P10 | Core host namespace/event semantics | A | planned | R5, R7 |
| RB1 | Host remote publication | B | delivered | R1, R10, R11, R12 |
| ST9 | Core host namespace | A | planned | R2, R6 |
| C10 | Client service | A | planned | R9 |
| C11 | Client service | A | planned | R9 |
| C12 | Client service | A | planned | R9 |
| C13 | Client service | A | planned | R9 |
| C14 | Client service | A | planned | R9 |
| C15 | Client service | A | planned | R9 |
| C16 | Client service | A | planned | R9 |
| C17 | Client service | A | planned | R9 |
| C18 | Client service | A | planned | R9 |
| C19 | Client service | A | planned | R9 |
| C20 | Client service | A | planned | R9 |
| C21 | Client event | A | planned | R9 |
| C22 | Client event | A | planned | R9 |
| C23 | Client event | A | planned | R9 |
| C24 | Client event | A | planned | R9 |
| C25 | Client connection API | A | planned | R9 |
| O17 | Host event catalog | A | planned | R7 |
| O18 | Host event catalog | A | planned | R7 |
| O19 | Host event catalog | A | planned | R7 |
| O20 | Host event catalog | A | planned | R7 |
| SV19 | Host service seam | A | delivered | R1, R8, R11, R12 |
| SV20 | Host service seam | A | delivered | R1, R8, R11, R12 |
| SV21 | Host service seam | A | planned | R8 |
| SV22 | Host service seam | A | planned | R8 |
| SV23 | Host service seam | A | planned | R8 |
| SV24 | Host service seam | A | planned | R8 |
| SV25 | Host service seam | A | planned | R8 |
| SV26 | Host service seam | A | planned | R8 |
| SV27 | Host service seam | A | planned | R8 |
| SV28 | Host service seam | A | planned | R8 |
| SV29 | Host service seam | A | planned | R8 |
| SV30 | Host service seam | A | planned | R8 |
| SV31 | Host service seam | A | planned | R8 |
| SV32 | Host service seam | A | planned | R8 |
| SV33 | Host service seam | A | planned | R8 |
| SV34 | Host service seam | A | planned | R8 |
| SV35 | Host service seam | A | planned | R8 |
| SV36 | Host service seam | A | planned | R8 |
| SV37 | Host service seam | A | planned | R8 |
| SV38 | Host service seam | A | planned | R8 |
| SV39 | Host service seam | A | planned | R8 |
| SV40 | Host service seam | A | planned | R8 |
| SV41 | Host service seam | A | planned | R8 |
| SV42 | Host service seam | A | planned | R8 |
| SV43 | Host service seam | A | planned | R8 |
| SV44 | Host service seam | A | planned | R8 |
| SV45 | Host service seam | A | planned | R8 |
| SV46 | Host service seam | A | planned | R8 |
| SV47 | Host service seam | A | planned | R8 |
| SV48 | Host service seam | A | planned | R8 |

## Out of Scope

- C 类 proposal：官方 `llm/admission`、异步完整 `llm/request`、官方 `exec.route` / prepared route、boot 故障隔离、动态 settings namespace、client 原生动态 remote discovery，以及其他 feature-list 中标记为 M-final 的 proposal。
- 新的 R 类 replacement bundle 或官方包文件修改。
- 未在 M4 inventory 中登记的官方私有成员、concrete provider 扩展成员、UI 内部对象和仅有类型声明而无运行时 service 的对象。
- 与 M4 透传无关的业务逻辑、数据投影、请求改写、跨域编排或消费者迁移；迁移和 M-final proposal 仍按独立范围处理。
