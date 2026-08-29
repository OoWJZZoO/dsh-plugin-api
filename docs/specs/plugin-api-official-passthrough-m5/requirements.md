# M5 Official Passthrough Requirements

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.systemPrompt.renderContextSnapshot` / `joinContextSections` | `pluginApi.prompts.renderContextSnapshot` / `pluginApi.prompts.joinContextSections` |
> | `pluginApi.client.inputTriggers` / `commandUi` / `modelDirectories` / `conversation` / `conversationEvents` / `conversationViews` / `timer` | 纯官方 client 直通，归 `pluginApi.services.*`（client 根成员已直接位于 `ctx.pluginApi`） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

## Introduction

`plugin-api-official-passthrough-m5` 为 M4 范围冻结后审计发现的 A 类官方公开面提供稳定门面。范围包括：

- `pluginApi.systemPrompt` 的 `renderContextSnapshot(assembly)` 与 `joinContextSections(sections)`（P11）；
- `pluginApi.client.inputTriggers`、`commandUi`、`modelDirectories`、`conversation`、`conversationEvents`、`conversationViews` 与 `timer`（C26-C32）。

这些能力均属于 A 类：官方已经提供公开导出或已注册服务，M5 只负责稳定暴露，不模拟不存在的官方 dispatch，也不改变官方语义。M5 复用已有 plugin-api 基础设施，但不得依赖 M4 的具体 API、实现、提交或完成状态。

## Definitions

- **Official face**：官方公开类型或已注册服务对插件可见的完整 outward surface，包括方法、属性、事件/订阅入口和返回的 disposer；不包含模块私有成员。
- **Surface key**：用于 availability、diagnostic 和 feature-unavailable 结果关联的稳定语义键。M5 的九个 key 固定为：`systemPrompt.renderContextSnapshot`、`systemPrompt.joinContextSections`、`client.inputTriggers`、`client.commandUi`、`client.modelDirectories`、`client.conversation`、`client.conversationEvents`、`client.conversationViews`、`client.timer`。
- **Contract inventory**：M5 design 必须冻结的一份 9 项 surface 契约矩阵，并建立以下一对一映射：`P11.renderContextSnapshot` -> `systemPrompt.renderContextSnapshot`、`P11.joinContextSections` -> `systemPrompt.joinContextSections`、`C26` -> `client.inputTriggers`、`C27` -> `client.commandUi`、`C28` -> `client.modelDirectories`、`C29` -> `client.conversation`、`C30` -> `client.conversationEvents`、`C31` -> `client.conversationViews`、`C32` -> `client.timer`。矩阵必须包含每个 surface 的官方包 identity、服务注册点或 public export、完整成员名、成员类型/签名，以及事件、observable、handle 和 disposer 语义。实现和测试只能以这份矩阵为准，不动态吸收运行时后来出现的成员。
- **Malformed official face**：官方 helper/export 缺失、服务 provider 缺失、provider 类型不符合契约，或契约矩阵中的任一成员缺失/类型不匹配。契约矩阵中的成员对对应的 supported runtime 均为必需成员，不使用未定义的 optional-member 例外；一个 surface 校验失败时，该 surface 原子停用，不得发布声明完整但实际缺成员的半成品 surface。
- **Local degradation**：某个官方导出或 client service 不可用时，只停用对应 M5 surface，并保留其他已可用 surface。
- **Feature-unavailable contract**：被停用 surface 的调用必须沿用现有 plugin-api 的 feature-unavailable typed error 类别和 inactive feature 标识，并关联该 surface key；不得返回伪造的官方值，也不得把不可用状态转换为成功的空结果。具体错误构造和呈现方式由 Stage 2 Design 对照现有 facade contract 冻结，但 surface key 和原因分类不得改变。
- **Diagnostic reason**：surface guard 失败时使用的稳定原因分类，限定为 `missing-export`、`invalid-export`、`missing-service`、`invalid-provider`、`missing-member`、`invalid-member`。诊断至少包含 `surfaceKey` 和 `reason` 两个稳定字段；可包含实现无关的阶段字段，但不得包含 provider、assembly、调用参数、返回值、原始异常对象或其未脱敏消息等输入/敏感数据。
- **Semantic identity**：参数转发、`this` receiver、同步/异步返回、错误、Promise、订阅和 disposer 的官方可观察行为与身份关系。

## Requirements

### Requirement 1: Context rendering helpers (A)

**User Story:** As a plugin author, I want the official context rendering helpers available through `pluginApi.systemPrompt`, so that I can build context output without importing official package internals.

#### Acceptance Criteria

1. WHEN the official `renderContextSnapshot(assembly)` export is available THEN the host facade SHALL expose `pluginApi.systemPrompt.renderContextSnapshot(assembly)` and SHALL return the exact official result for the same input.
2. WHEN the official `joinContextSections(sections)` export is available THEN the host facade SHALL expose `pluginApi.systemPrompt.joinContextSections(sections)` and SHALL return the exact official result for the same input.
3. WHEN either helper throws or returns a rejected Promise THEN the facade SHALL preserve the official error and rejection behavior without replacing it with a facade-specific success value.
4. WHEN the helpers are available THEN the facade SHALL pass arguments without normalizing, cloning, reordering, or mutating the caller's input.

### Requirement 2: Client service exposure (A)

**User Story:** As a client plugin author, I want the remaining official browser services available through one stable client facade, so that I can use official UI and runtime capabilities without reaching into raw Cordis context.

#### Acceptance Criteria

1. WHEN an official client service passes the contract inventory for `inputTriggers`, `commandUi`, `modelDirectories`, `conversation`, `conversationEvents`, `conversationViews`, or `timer` THEN the client facade SHALL expose the corresponding named service according to the explicit `C26`-`C32` mapping in the contract inventory.
2. WHERE a service appears in the contract inventory WHEN M5 is implemented THEN the facade SHALL expose every required member in that service's frozen matrix, including methods, properties, events, observables, lifecycle operations, handles, and disposers; it SHALL not expose an ad hoc subset or dynamically add undocumented members.
3. WHEN a plugin invokes a forwarded method or accessor listed in the contract inventory THEN the facade SHALL preserve the official arguments, argument order, receiver behavior, synchronous or asynchronous return behavior, and error behavior.
4. WHEN an official operation listed in the contract inventory returns a Promise, subscription, handle, or disposer THEN the facade SHALL preserve its completion, cancellation, disposal, and identity semantics.
5. WHEN an official service listed in the contract inventory exposes live state or observable values THEN the facade SHALL preserve the official live-read and subscription behavior instead of returning an initialization snapshot.
6. WHEN the contract inventory is updated for a supported runtime variant THEN the corresponding member-level tests SHALL be updated before that variant is accepted as supported; runtime-discovered undocumented members SHALL not silently expand the facade.

### Requirement 3: Per-surface availability and fail-safe behavior (cross-cutting)

**User Story:** As a plugin author, I want unavailable official capabilities to degrade locally, so that one optional service cannot prevent unrelated plugin-api capabilities from loading.

#### Acceptance Criteria

1. GIVEN one M5 official export or client service is missing or malformed WHEN M5 initializes THEN the system SHALL mark only the corresponding helper or atomic client-service surface unavailable and SHALL keep unrelated available M5 surfaces usable.
2. GIVEN one M5 official export or client service is missing or malformed WHEN the host or client plugin applies THEN the plugin SHALL emit a safe diagnostic containing the corresponding stable `surfaceKey` and one permitted `Diagnostic reason`, SHALL omit sensitive input data from the diagnostic, and SHALL not throw the failure through plugin apply.
3. WHEN a disabled M5 surface is called THEN the facade SHALL report the feature-unavailable contract with the corresponding stable `surfaceKey` and SHALL not fabricate an official result.
4. GIVEN an existing system-prompt or client facade is available WHEN a P11 helper or one C26-C32 service is unavailable THEN the unavailable M5 surface SHALL not disable unrelated pre-existing facade members.
5. GIVEN one member in a client service's contract inventory is missing or has the wrong kind WHEN that service is guarded THEN the system SHALL disable the whole named service surface while leaving the other six M5 client services independently guardable.
6. WHEN the initial 9-surface contract inventory is accepted THEN baseline contract tests SHALL cover every surface and every listed member for availability and declared forwarding or helper-result semantics, and SHALL also cover a malformed provider, a missing required member, an invalid required-member type, atomic disabling of the malformed surface, continued availability of the other eight surfaces, the disabled surface's typed feature-unavailable result with its surface key, and a safe diagnostic with an allowed reason and no input or sensitive data.

### Requirement 4: Official boundary and unsupported surface control (A)

**User Story:** As a plugin author, I want the facade to reflect only supported official public surfaces, so that my plugin does not accidentally depend on private implementation details.

#### Acceptance Criteria

1. WHEN M5 constructs a surface THEN it SHALL use only the corresponding official public export or registered service face and SHALL not expose module-private variables or undocumented implementation objects.
2. WHEN the official face changes between supported runtime variants THEN M5 SHALL use a predeclared contract inventory for the active supported variant, SHALL treat any missing or mismatched member required by that inventory as a malformed surface under Requirement 3, and SHALL not expose undocumented runtime members.
3. WHEN a member is not part of the official public face THEN M5 SHALL not add it as an undocumented compatibility alias or silently reinterpret another member as that operation.

### Requirement 5: M4 independence and parallel delivery (cross-cutting)

**User Story:** As a maintainer working on M4 and M5 in parallel, I want M5 to have an independent implementation boundary, so that either milestone can progress without waiting for the other.

#### Acceptance Criteria

1. WHEN M5 is initialized with the existing shared plugin-api foundation but without M4-specific implementations THEN each available M5 surface SHALL still mount and operate according to Requirements 1-4.
2. WHEN M4-specific services, APIs, or commits are absent, incomplete, or changed THEN M5 SHALL not require them for its own guards, mounting, or forwarding behavior.
3. WHEN M5 is integrated with an M4 implementation THEN M5 SHALL not change the behavior or availability contract of M4 surfaces outside the explicitly shared plugin-api foundation.

### Requirement 6: Scope containment (cross-cutting)

**User Story:** As a maintainer, I want M5 to remain limited to the audited additions, so that the frozen M4 plan is not reopened during parallel implementation.

#### Acceptance Criteria

1. WHEN M5 work is executed THEN it SHALL cover only P11 and C26-C32 from the approved feature list.
2. WHEN an API is already assigned to M4 THEN M5 SHALL not rename, duplicate, move, or change that API's milestone assignment.
3. WHEN an issue requires a C-class upstream change, an R-class replacement bundle, or consumer migration THEN M5 SHALL record it outside this feature's implementation scope rather than silently adding it to M5.

## Classification and Non-Goals

P11 and C26-C32 are **A 类** capabilities: the official public exports and services already exist and M5 only stabilizes their exposure. Requirements 3, 5, and 6 are cross-cutting governance and fail-safe constraints; they are not additional A/B/C/R capabilities. M5 does not introduce B 类 simulation, C 类 upstream proposals, or R 类 replacement bundles. It also does not include consumer migrations, changes to official DSH package files, or completion of any M4 task.

## Governance Constraints

- The contract inventory must be completed during Stage 2 Design before Stage 3 Tasks can be approved.
- The M4 independence boundary is a delivery constraint: M5 may share existing plugin-api foundation code, but it may not import, call, or require an M4-specific API or implementation for its own guards, mounting, or forwarding behavior.
- The scope boundary is a delivery constraint: M5 covers only P11 and C26-C32; an already-assigned M4 API must not be renamed, duplicated, moved, or reclassified by M5.
