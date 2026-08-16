# Feature Requirements: plugin-api-capabilities-m1

## Introduction

`plugin-api-capabilities-m1` 是 `dsh-plugin-api` 的 **M1 capability seams 稳定直通 feature**，覆盖 feature-list §2.11 中的：

- **SV1–SV16**：官方 capability seam 服务的稳定直通；
- **SV18**：`agentDefaultModel` 默认模型选择服务的稳定直通。

本 feature 把上述 17 个官方服务统一挂载到门面的 **`pluginApi.services.<name>`** 子对象下（Stage 0 已确认的形状），给第三方插件一个受支持的、类型化的、fail-safe 的服务直通面。

本 feature 只覆盖 **host 侧**。client bundle / remote / slot / settings 可视化配置桥属于 M3；**SV17 `compaction`**（M2）明确不在本 spec 范围；C 类上游提案（U1–U8）不在本 spec 范围。

**类型标注**：SV1–SV16、SV18 均为 **A 类**（官方已提供服务，门面只做稳定直通 + 类型化 + fail-safe，不发明新语义）。`pluginApi.services` 命名空间本身属于 **门面基础**（遵循 `plugin-api-foundation` 的 fail-safe 与版本协商规则）。

**依赖**：

- `plugin-api-foundation`（F0.1–F0.3）：`ctx.pluginApi` 服务、分层 fail-safe guard、版本协商；本 feature 的所有禁用/错误行为都复用 foundation 定义的 typed error 与 observable disabled state。
- `plugin-api-facade-integrity`（F0.4–F0.5）：符号解析门面与包装链安全；本 feature 若需要对官方服务对象做任何包装，必须复用其 chain-safety / identity-guard 规则。

**范围边界**：

- 稳定化对象是 feature-list §2.11 已列出的 SV1–SV16、SV18 共 17 个服务；未列出的官方服务不得借本 spec 夹带实现。
- SV14 `sessionTelemetry` 只覆盖服务 seam 直通；`session-telemetry/record` 事件已在 `plugin-api-events-m1`（O16）交付，本 spec 不重复纳入。
- 本 spec 不包含 C 类上游提案，不修改官方 DSH 包，不 import 官方包的模块私有变量。

---

## Requirements

### 1. `pluginApi.services` namespace and read-only shape（公共面）

**User Story:** As a third-party plugin author, I want all official capability seams reachable through one read-only `pluginApi.services.<name>` namespace, so that I can discover and use capability seams through the supported facade instead of importing `@deepseek-ai/dsh-*` internal packages.

**Acceptance Criteria:**

1. GIVEN the `pluginApi` service is active and the capabilities feature is active, WHEN a third-party plugin reads `ctx.pluginApi.services`, THEN it SHALL be a read-only namespace object.
2. WHEN a third-party plugin reads `ctx.pluginApi.services`, THEN it SHALL expose exactly the following 17 keys and no others: `fs`, `codeRuntime`, `workspaces`, `subagents`, `workflows`, `approval`, `userQuestions`, `attachments`, `skills`, `storage`, `sessionProjections`, `sessionQuery`, `sessionTitle`, `sessionTelemetry`, `sessionReferences`, `tokenMeter`, `agentDefaultModel`. In particular it SHALL NOT expose `compaction` (SV17, M2) or any service outside this spec.
3. WHEN a third-party plugin attempts to assign to, delete, or otherwise mutate `pluginApi.services` or any of its service facade values, THEN the mutation SHALL NOT be observable to any other consumer (the namespace SHALL be frozen or otherwise read-only at runtime).
4. WHEN a third-party plugin reads `pluginApi.services.<name>` for any of the 17 keys, THEN it SHALL receive a stable facade object exposing the passthrough surface defined in sections 2–19 for that service.
5. WHEN the `pluginApi` service is inactive or the capabilities feature is disabled, THEN every method of every `pluginApi.services.<name>` facade SHALL produce the foundation-defined typed inactive/feature-disabled error and SHALL NOT call into official services.
6. GIVEN one or more official capability services are unavailable at apply time, WHEN the facade applies, THEN the corresponding `pluginApi.services.<name>` facade(s) SHALL be observably disabled (per-service degradation), the remaining available service facades and the rest of `ctx.pluginApi` SHALL remain active, and the facade SHALL NOT throw through `apply`.

**Type:** 门面基础（命名空间与 fail-safe 遵循 `plugin-api-foundation`）

---

### 2. Common passthrough contract for A-class services（SV1–SV16, SV18 通用）

**User Story:** As a maintainer, I want one uniform passthrough rule for all 17 capability seams, so that each service facade behaves predictably and does not invent semantics beyond the official service.

**Acceptance Criteria:**

1. GIVEN a method `m` belongs to the passthrough surface declared for `pluginApi.services.<name>`, WHEN a third-party plugin calls `pluginApi.services.<name>.m(...args)`, THEN the facade SHALL invoke the official service method `m` with the same arguments in the same order and SHALL return the official method's return value unchanged.
2. WHEN the official service method throws or returns a rejected promise, THEN the facade SHALL propagate that error/rejection unchanged; the facade SHALL NOT catch, wrap, or suppress errors produced by the official service during a passthrough call.
3. WHEN a third-party plugin passes provider/callback/object arguments to a passthrough method, THEN the facade SHALL pass those arguments through without wrapping, cloning, freezing, caching, or altering them, unless a later section explicitly states otherwise for that service.
4. WHEN a passthrough method returns an object, function, disposer, or subscription handle, THEN the facade SHALL return the exact official return value (identity preserved) and SHALL NOT proxy it or attach facade-specific side effects to it.
5. WHEN the facade handles any passthrough call, THEN it SHALL NOT change the observable timing, ordering, or `this`-binding semantics of the official service method beyond the minimum necessary to delegate from `services.<name>` to the official service object.
6. GIVEN the corresponding official service is unavailable or the facade is inactive/feature-disabled, WHEN a passthrough method is called, THEN the facade SHALL produce the foundation-defined typed error and SHALL NOT call into official services (this overrides AC 2.1–2.2 for disabled states).
7. WHEN a third-party plugin directly imports or injects `@deepseek-ai/dsh-*` internal services, THEN the facade SHALL NOT intercept, patch, block, or alter that interaction (unsupported escape hatch; authoritative policy per `plugin-api-facade-integrity`, summarized in `plugin-api-foundation`).

**Type:** A（直通契约，适用于本 spec 全部 17 个 A 类服务）

---

### 3. SV1 filesystem seam — `services.fs`

**User Story:** As a third-party plugin author, I want a stable `services.fs` passthrough to the official filesystem service, so that I can read, write, edit, and observe files through the facade instead of importing `dsh-fs`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.fs` passthrough surface, THEN the facade SHALL delegate to the official `fs` service per section 2.
2. WHEN a plugin reads the `services.fs` surface, THEN it SHALL include at least `resolve`, `processPath`, `fileUrl`, `contains`, `stat`, `lstat`, `readText`, `streamText`, `readBytes`, `listDir`, `writeText`, `editText`, and the `sandboxMode` getter with the official `FileSystem` service's public signatures; the exact member list SHALL be finalized in design from the official `fs` service's public injectable surface.
3. WHEN the facade handles an `fs` passthrough call, THEN it SHALL NOT pre-validate, filter, or alter file paths, content, targets, or observation semantics beyond the official service behavior.

**Type:** A（官方 `dsh-fs` 服务 `fs` 直通）

---

### 4. SV2 code runtime seam — `services.codeRuntime`

**User Story:** As a third-party plugin author, I want a stable `services.codeRuntime` passthrough to the official program-execution seam, so that I can use code execution capability through the facade instead of importing `dsh-code-runtime`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.codeRuntime` passthrough surface, THEN the facade SHALL delegate to the official `codeRuntime` service per section 2.
2. WHEN a plugin reads the `services.codeRuntime` surface, THEN it SHALL expose the official `codeRuntime` service's public injectable methods; the exact method list SHALL be finalized in design from the official `codeRuntime` service's public surface.
3. WHEN the facade handles a `codeRuntime` passthrough call, THEN it SHALL NOT alter program source, runtime selection, signal handling, or execution-result semantics beyond the official service behavior.

**Type:** A（官方 `dsh-code-runtime` 服务 `codeRuntime` 直通）

---

### 5. SV3 workspace registry — `services.workspaces`

**User Story:** As a third-party plugin author, I want a stable `services.workspaces` passthrough to the official workspace registry, so that I can create, resolve, and attach workspaces through the facade instead of importing `dsh-workspace`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.workspaces` passthrough surface, THEN the facade SHALL delegate to the official `workspaceRegistry` service per section 2.
2. WHEN a plugin reads the `services.workspaces` surface, THEN it SHALL include at least `create`, `get`, `list`, `delete`, `insertBefore`, `archiveSession`, `resolveByPath`, and the `archivedSessionIds` getter with the official `workspaceRegistry` service's public signatures; the exact member list SHALL be finalized in design from the official `workspaceRegistry` service's public injectable surface.
3. WHEN the facade handles a `workspaces` passthrough call, THEN it SHALL NOT remap workspace identities, paths, or session attachments beyond the official service behavior.

**Type:** A（官方 `dsh-workspace` 服务 `workspaceRegistry` 直通；门面键名为 `workspaces`）

---

### 6. SV4 subagent runtime — `services.subagents`

**User Story:** As a third-party plugin author, I want a stable `services.subagents` passthrough to the official subagent runtime, so that I can register subagent providers through the facade instead of importing `dsh-subagent`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.subagents` passthrough surface, THEN the facade SHALL delegate to the official `subagents` service per section 2.
2. WHEN a plugin reads the `services.subagents` surface, THEN it SHALL include at least `registerProvider(provider)` with the official `subagents` service's public signature; the exact method list SHALL be finalized in design from the official `subagents` service's public injectable surface.
3. WHEN the facade handles a `subagents` passthrough call, THEN it SHALL NOT wrap, validate, or alter the registered provider object or its lifecycle.

**Type:** A（官方 `dsh-subagent` 服务 `subagents` 直通）

---

### 7. SV5 workflow engine — `services.workflows`

**User Story:** As a third-party plugin author, I want a stable `services.workflows` passthrough to the official workflow engine, so that I can start workflows through the facade instead of importing `dsh-workflow`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.workflows` passthrough surface, THEN the facade SHALL delegate to the official `workflowEngine` service per section 2.
2. WHEN a plugin reads the `services.workflows` surface, THEN it SHALL include at least `start(request)` with the official `workflowEngine` service's public signature; the exact method list SHALL be finalized in design from the official `workflowEngine` service's public injectable surface.
3. WHEN the facade handles a `workflows` passthrough call, THEN it SHALL NOT alter workflow request objects, run identity, or scheduling semantics beyond the official service behavior.

**Type:** A（官方 `dsh-workflow` 服务 `workflowEngine` 直通；门面键名为 `workflows`）

---

### 8. SV6 approval service — `services.approval`

**User Story:** As a third-party plugin author, I want a stable `services.approval` passthrough to the official approval service, so that I can request approvals and manage policy through the facade without changing the official fail-closed behavior.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.approval` passthrough surface, THEN the facade SHALL delegate to the official `approval` service per section 2.
2. WHEN a plugin reads the `services.approval` surface, THEN it SHALL include at least `request()` and `setPolicy()` with the official `approval` service's public signatures; the exact method list SHALL be finalized in design from the official `approval` service's public injectable surface.
3. WHEN the facade handles an `approval` passthrough call, THEN it SHALL preserve the official fail-closed default behavior exactly; the facade SHALL NOT add, remove, or soften any approval outcome (`allowed-once`, `rejected`, `cancelled`, `unavailable`) or policy semantics.
4. WHEN no approval outcome is produced through official semantics, THEN the facade SHALL NOT substitute its own outcome.

**Type:** A（官方 `dsh-user-approval` 服务 `approval` 直通，fail-closed 不变）

---

### 9. SV7 user questions service — `services.userQuestions`

**User Story:** As a third-party plugin author, I want a stable `services.userQuestions` passthrough to the official user-questions service, so that I can register question providers and ask questions through the facade instead of importing `dsh-user-questions`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.userQuestions` passthrough surface, THEN the facade SHALL delegate to the official `userQuestions` service per section 2.
2. WHEN a plugin reads the `services.userQuestions` surface, THEN it SHALL include at least `registerProvider()` and `ask()` with the official `userQuestions` service's public signatures; the exact method list SHALL be finalized in design from the official `userQuestions` service's public injectable surface.
3. WHEN the facade handles a `userQuestions` passthrough call, THEN it SHALL preserve the official fail-closed behavior and SHALL NOT wrap, validate, or alter question providers, question payloads, or answer delivery semantics.

**Type:** A（官方 `dsh-user-questions` 服务 `userQuestions` 直通）

---

### 10. SV8 attachment storage — `services.attachments`

**User Story:** As a third-party plugin author, I want a stable `services.attachments` passthrough to the official immutable binary attachment storage, so that I can store and retrieve attachments through the facade instead of importing `dsh-attachment`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.attachments` passthrough surface, THEN the facade SHALL delegate to the official `attachments` service per section 2.
2. WHEN a plugin reads the `services.attachments` surface, THEN it SHALL expose the official `attachments` service's public injectable methods; the exact method list SHALL be finalized in design from the official `attachments` service's public surface.
3. WHEN the facade handles an `attachments` passthrough call, THEN it SHALL NOT alter binary content, immutability guarantees, or attachment identity semantics beyond the official service behavior.

**Type:** A（官方 `dsh-attachment` 服务 `attachments` 直通）

---

### 11. SV9 skills registry — `services.skills`

**User Story:** As a third-party plugin author, I want a stable `services.skills` passthrough to the official skills registry, so that I can list, snapshot, get, and collect skills through the facade instead of importing `dsh-skill`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.skills` passthrough surface, THEN the facade SHALL delegate to the official `skills` service per section 2.
2. WHEN a plugin reads the `services.skills` surface, THEN it SHALL include at least `registerProvider`, `register`, `list`, `snapshot`, and `get` with the official `skills` service's public signatures; the exact member list SHALL be finalized in design from the official `skills` service's public injectable surface.
3. WHEN the facade handles a `skills` passthrough call, THEN it SHALL NOT filter, reorder, or otherwise alter skill entries beyond the official service behavior.

**Type:** A（官方 `dsh-skill` 服务 `skills` 直通）

---

### 12. SV10 storage backends registry — `services.storage`

**User Story:** As a third-party plugin author, I want a stable `services.storage` passthrough to the official named-backend storage registry, so that I can use storage backends through the facade instead of importing `dsh-storage`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.storage` passthrough surface, THEN the facade SHALL delegate to the official `storage` service per section 2.
2. WHEN a plugin reads the `services.storage` surface, THEN it SHALL expose the official `storage` service's public injectable methods; the exact method list SHALL be finalized in design from the official `storage` service's public surface.
3. WHEN the facade handles a `storage` passthrough call, THEN it SHALL NOT remap backend names, namespace registrations, or persistence semantics beyond the official service behavior.

**Type:** A（官方 `dsh-storage` 服务 `storage` 直通）

---

### 13. SV11 session projections — `services.sessionProjections`

**User Story:** As a third-party plugin author, I want a stable `services.sessionProjections` passthrough to the official session-projection registry, so that I can register projections, observe changes, and read snapshots through the facade instead of importing `dsh-session-projection`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.sessionProjections` passthrough surface, THEN the facade SHALL delegate to the official `sessionProjections` service per section 2.
2. WHEN a plugin reads the `services.sessionProjections` surface, THEN it SHALL include at least `register({key, stateVersion, init, apply, view, schema})`, `onChanged`, and `snapshot(session)` with the official `sessionProjections` service's public signatures; the exact method list SHALL be finalized in design from the official `sessionProjections` service's public injectable surface.
3. WHEN the facade handles a `sessionProjections` passthrough call, THEN it SHALL NOT alter projection keys, state versions, apply/view functions, schemas, change notifications, or snapshot semantics beyond the official service behavior.

**Type:** A（官方 `dsh-session-projection` 服务 `sessionProjections` 直通）

---

### 14. SV12 session query — `services.sessionQuery`

**User Story:** As a third-party plugin author, I want a stable `services.sessionQuery` passthrough to the official session-query service, so that I can list, read, and filter sessions through the facade instead of importing `dsh-session-query`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.sessionQuery` passthrough surface, THEN the facade SHALL delegate to the official `sessionQuery` service per section 2.
2. WHEN a plugin reads the `services.sessionQuery` surface, THEN it SHALL include at least `listSessions`, `readSession`, and `filterSessions` with the official `sessionQuery` service's public signatures; the exact method list SHALL be finalized in design from the official `sessionQuery` service's public injectable surface.
3. WHEN the facade handles a `sessionQuery` passthrough call, THEN it SHALL NOT alter query filters, read projections, or session identity semantics beyond the official service behavior.

**Type:** A（官方 `dsh-session-query` 服务 `sessionQuery` 直通）

---

### 15. SV13 session title provider — `services.sessionTitle`

**User Story:** As a third-party plugin author, I want a stable `services.sessionTitle` passthrough to the official session-title service, so that I can register a title provider through the facade instead of importing `dsh-session-title`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.sessionTitle` passthrough surface, THEN the facade SHALL delegate to the official `sessionTitle` service per section 2.
2. WHEN a plugin reads the `services.sessionTitle` surface, THEN it SHALL include at least `register(provider)` with the official `sessionTitle` service's public signature; the exact method list SHALL be finalized in design from the official `sessionTitle` service's public injectable surface.
3. WHEN the facade handles a `sessionTitle` passthrough call, THEN it SHALL preserve the official single-provider semantics; the facade SHALL NOT invent multi-provider registration, fallback ordering, or title-merge behavior.

**Type:** A（官方 `dsh-session-title` 服务 `sessionTitle` 直通；官方为单 provider）

---

### 16. SV14 session telemetry backend seam — `services.sessionTelemetry`

**User Story:** As a third-party plugin author, I want a stable `services.sessionTelemetry` passthrough to the official telemetry backend seam, so that I can interact with the telemetry backend through the facade instead of importing `dsh-session-telemetry`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.sessionTelemetry` passthrough surface, THEN the facade SHALL delegate to the official `sessionTelemetry` service per section 2.
2. WHEN a plugin reads the `services.sessionTelemetry` surface, THEN it SHALL expose the official `sessionTelemetry` service's public injectable methods; the exact method list SHALL be finalized in design from the official `sessionTelemetry` service's public surface.
3. WHEN the facade handles a `sessionTelemetry` passthrough call, THEN it SHALL NOT alter telemetry record shapes, backend selection, or recording semantics beyond the official service behavior.
4. This spec SHALL NOT stabilize the `session-telemetry/record` event; that event is delivered as O16 in `plugin-api-events-m1` and is outside the scope of this feature.

**Type:** A（官方 `dsh-session-telemetry` 服务 `sessionTelemetry` 直通；事件 O16 不在本 spec 范围）

---

### 17. SV15 session reference resolver — `services.sessionReferences`

**User Story:** As a third-party plugin author, I want a stable `services.sessionReferences` passthrough to the official session-reference resolver, so that I can list candidates and encode/decode references through the facade instead of importing `dsh-session-reference`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.sessionReferences` passthrough surface, THEN the facade SHALL delegate to the official `sessionReferenceResolver` service per section 2.
2. WHEN a plugin reads the `services.sessionReferences` surface, THEN it SHALL include at least `listCandidates` and `prepare` delegated to the official `sessionReferenceResolver` service, and SHALL include `encodeSessionReferenceUri` and `decodeSessionReferenceUri` forwarded from the official `dsh-session-reference` package's public exports with the official function signatures; the exact member list SHALL be finalized in design.
3. WHEN the facade handles a `sessionReferences` passthrough call, THEN it SHALL NOT alter reference URI encoding/decoding, candidate selection, or resolution semantics beyond the official service behavior.

**Type:** A（官方 `dsh-session-reference` 服务 `sessionReferenceResolver` 直通；门面键名为 `sessionReferences`）

---

### 18. SV16 token meter — `services.tokenMeter`

**User Story:** As a third-party plugin author, I want a stable `services.tokenMeter` passthrough to the official token meter, so that I can measure token usage through the facade instead of importing `dsh-token-meter`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.tokenMeter` passthrough surface, THEN the facade SHALL delegate to the official `tokenMeter` service per section 2.
2. WHEN a plugin reads the `services.tokenMeter` surface, THEN it SHALL include at least `measure(session, requestHeader)` with the official `tokenMeter` service's public signature; the exact method list SHALL be finalized in design from the official `tokenMeter` service's public injectable surface.
3. WHEN the facade handles a `tokenMeter` passthrough call, THEN it SHALL NOT alter session/request-header inputs, tokenization, or measurement results beyond the official service behavior.

**Type:** A（官方 `dsh-token-meter` 服务 `tokenMeter` 直通）

---

### 19. SV18 agent default model — `services.agentDefaultModel`

**User Story:** As a third-party plugin author, I want a stable `services.agentDefaultModel` passthrough to the official default-model selection service, so that I can read and save the agent default model through the facade instead of importing `dsh-agent-default-model`.

**Acceptance Criteria:**

1. WHEN a plugin calls any method in the `services.agentDefaultModel` passthrough surface, THEN the facade SHALL delegate to the official `agentDefaultModel` service per section 2.
2. WHEN a plugin reads the `services.agentDefaultModel` surface, THEN it SHALL include at least `currentSelection()` and `saveSelection(next)` with the official `agentDefaultModel` service's public signatures; the exact method list SHALL be finalized in design from the official `agentDefaultModel` service's public injectable surface.
3. WHEN the facade handles an `agentDefaultModel` passthrough call, THEN it SHALL NOT alter model selection values, persistence, or default-resolution semantics beyond the official service behavior.

**Type:** A（官方 `dsh-agent-default-model` 服务 `agentDefaultModel` 直通）

---

### 20. Testability and regression coverage

**User Story:** As a maintainer, I want all 17 capability seams covered by `node --test` with mocked Cordis/official services, so that the passthrough behavior and fail-safe degradation are regression-safe without booting a real harness.

**Acceptance Criteria:**

1. WHEN `node --test` runs, THEN tests SHALL cover the `pluginApi.services` namespace: exactly the 17 required keys, no `compaction`, and read-only behavior for the namespace and service facade values.
2. WHEN `node --test` runs, THEN tests SHALL cover the common passthrough contract of section 2: same-argument delegation, unchanged return values (including object identity), unchanged error propagation, and no wrapping of provider/callback arguments.
3. WHEN `node --test` runs, THEN tests SHALL cover every one of the 17 service facades (sections 3–19) by mounting a mock official service, invoking each declared passthrough method, and asserting 1:1 delegation with unchanged arguments and return values.
4. WHEN `node --test` runs, THEN tests SHALL cover the disabled paths: inactive `pluginApi` and per-service disabled state produce the foundation-defined typed error and do not call into official services.
5. WHEN `node --test` runs, THEN tests SHALL cover per-service degradation: given one mock official service missing at apply time, the facade applies without throwing, only that service facade is disabled, and the other 16 remain active.
6. WHEN `node --test` runs, THEN tests SHALL assert that `services.approval` and `services.userQuestions` preserve fail-closed behavior (the facade does not substitute outcomes or soften official semantics).
7. GIVEN mocked Cordis context and mocked official services, WHEN `node --test` runs, THEN no test SHALL require booting a real harness.

**Type:** 质量门
