# Stage 2 — Design

> 公共契约现状注（2026-09-02）：本文在 `events.define` 尚未交付的历史设计边界内获批；现行公共契约已由后续 `plugin-api-policy-enforcement-closure` 交付补齐该合作型入口，当前形状与边界以 canonical registry 及该 feature 的 delivery report 为准。本文其余已批准验收边界不变。

## Status

本设计承接已批准的 `goal.md` 与 `requirements.md`。它定义 M8 的目标架构、迁移边界、实现通道、失败路径和验证策略。

**Stage 2 确认门：已通过（用户明确批准，2026-08-31）。**

批准范围为本文件当前版本，包含按当时 API idiom 目标规范完成的契约细化；该规范已在 M8 交付后合并为 `docs/standards/api-idioms.md`：

- coordination 入口全部异步、`acquire` 返回租约句柄、归还是入口动词 `release(handle)`、stale 条件以 `code: 'conflict'` + `reason` 表达、同步有界借用例外不豁免异步；
- 能力矩阵 `status` 为六值封闭词表并作为守恒校验唯一字段，复合信息记入 `qualifiers`；
- 成员记录字段一律存在，不适用者记显式 `null`；
- `services.*` 成员的 `idiom` 固定为 `passthrough-exception`，与非 `services.*` 成员双向互斥；
- 公共 namespace 集合由 registry 的 namespace navigation record 定义，`availabilityMember` 或 `availabilityExemption` 二选一。

批准前未创建实现代码、测试代码、Tasks 或生成 registry 快照。按 AGENTS.md §3.2，Stage 2 完工后创建阶段提交；随后进入 Stage 3，Tasks 不设用户确认门，须经阻塞式只读对抗性审查通过方可进入 Stage 4。

## Overview

M8 是一次全局公共 API 语义重构，而不是新增一个领域 API。M7 已经完成业务领域树 cutover，M8 在该树上继续完成第二个维度的收敛：把每个公共叶子成员按调用方必须掌握的语义套路归入八个 API idiom，并使同一 idiom 跨 namespace、host/client 保持同构。

M8 的核心设计决定如下：

1. **一个公共契约、多个执行 Wave。** 对外只交付一个 `plugin-api-m8-api-idiom-refactor` feature；内部按依赖和风险划分 Wave。一个 idiom 或 namespace 不单独成为公共 feature。
2. **沿用 M7 单一事实源。** `docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json` 继续承载现行公共 path 与版本基线，并扩展为 M8 所需的叶子级 idiom/形状/生命周期/事件字段。不得另造平行 registry，也不把 registry 变成运行时服务。
3. **语义分类先于形状改造。** 先冻结每个 current leaf、target leaf 和公开 handle leaf 的唯一主 idiom，再根据 idiom 目录决定名称、结果、handle、失败和冲突形状。
4. **结构迁移与语义加固分离。** 先完成 registry、公共路径和 surface 结构的可追踪迁移，再对最终保留成员补齐真实需要的 owner、scope、generation、CAS、reducer、取消和 authority closure；不为未保留成员建设机制。
5. **官方边界保持不变。** A 类直接绑定已存在的官方事件/服务，B 类只在已证明的底层 hook 上做有限转译，C 类保持 proposal/gap，R 类只使用已批准的 replacement owner；任何通道都不修改官方 DSH 包文件。
6. **运行时实现仍按现有 mounter owner 组织。** 公共 domain builder 只负责组合和暴露目标 surface，不能把 feature、mounter、package 或 replacement identity 泄漏到 public path。
7. **缺失能力诚实降级。** 成员级 unavailable、typed unavailable result/error 和能力 gap 是有效结果；不得用咨询式入口、silent no-op、空对象或未证明的自动替代掩盖缺失决策点。

### Current-State Anchors

设计基于当前仓库的以下事实：

- `lib/plugin-api-service.js` 是 host `pluginApi` Cordis service 的主要发布面，现有 feature mounter 通过内部 slot/服务组合公共领域；它已包含 disabled surfaces、版本协商和 capability 相关逻辑，但仍有历史入口、形状不统一和成员级元数据不足的问题。
- `lib/client-runtime.js` 是 client facade 的根装配和 caller-bound 解析面，`lib/client.js` 是检入的浏览器 bundle；当前 client 已有 connection、remote、settings、slots、lifecycle、codec 和 official services 适配器，M8 需要按 idiom 重新归类和对齐，而不是重写官方 browser runtime。
- `lib/services.js` 与 `lib/official-service-definitions.js` 提供静态官方服务白名单和 member-level passthrough；M8 继续采用静态白名单，不依赖 runtime introspection。
- `scripts/registry-validate.mjs` 和 `scripts/registry-snapshot.mjs` 已提供纯 Node 的 registry 验证和快照基础设施，但当前字段、校验规则和输出还不足以覆盖 M8 的 idiom、handle、事件和叶子级 parity 要求。
- 本 Design 记录的是 M8 迁移期间的目标和实现边界；交付后的现行公共 idiom 规范见 `docs/standards/api-idioms.md`，具体成员事实见 canonical registry。

## Architecture

```text
                         M8 contract artifacts
  +----------------------------------------------------------------+
  | M7 public-contract.registry.json (extended in place)           |
  | old-to-target map | member leaves | handle leaves | gaps       |
  | idiom contracts | composition | authority | event semantics    |
  +------------------------------+---------------------------------+
                                 |
             pure validation / projection / migration diff
                                 |
       +-----------------+-------+--------+------------------+
       |                 |                |                  |
+------v------+  +-------v-------+ +------v-------+ +--------v--------+
| Contract    |  | Host domain  | | Client root  | | Package/consumer |
| validators  |  | builders     | | builder      | | reconciliation   |
| snapshots   |  | and slices   | | and bundle   | | and boot checks  |
+------+------+  +-------+------+ +------+-------+ +--------+--------+
       |                 |                |                  |
       +-----------------+----------------+------------------+
                                 |
                 existing owners, guards, and adapters
                                 |
              injected official services / approved rows
```

### Contract Artifact Boundary

The canonical registry remains:

```text
docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json
```

M8 extends this artifact in place. The registry is build-time and test-time data only. It is not imported by the runtime facade as a mutable registry service, does not become a permission system, and does not own runtime plugin state.

The registry is divided into these logical sections:

- `contractBaseline`: existing package/runtime/API baseline, unchanged unless a separately approved version decision is made;
- `vocabulary`: runtime, effect, idiom, event semantics, composition, availability, status, terminal, priority, scope, implementation channel and migration actions;
- `hostDomainTree` and `clientDomainTree`: navigation roots only;
- `namespaces`: one navigation record per public namespace, carrying existence, capability path, runtime, contributing features, and the namespace availability member or its recorded exemption;
- `members`: one record per public callable/value leaf, target leaf, and public handle leaf;
- `oldToTargetMapping`: exact path migration records, including merge/split/delete relationships;
- `capabilityMatrix`: one conservation `status` per capability cluster together with `qualifiers`, replacement and gap reason;
- `eventCatalog`: event name, event semantics, observe/producer authority, priority, freeze, scope and containment facts;
- `servicesWhitelist`: official service key/member descriptors and passthrough audit metadata;
- `profiles`: generated recommended/composable member fixture and evidence references;
- `wireProtocols` and `durableRecords`: only actual protocol/schema revisions, independent of package version;
- `verification`: generated snapshot identifiers and evidence links, not runtime state.

Generated artifacts must contain neutral domain/capability names only. Governance labels, requirement numbers, feature names, replacement suffixes and classification tokens are confined to `docs/` artifacts and must not enter `lib/`, `packages/`, `test/`, `scripts/`, package metadata, patch files, or runtime-visible strings.

### Public Surface Assembly

#### Host

`PluginApiService` remains the host lifecycle owner. Its public assembly is reorganized conceptually into:

1. root self-description: `isActive`, `apiVersion`, `assertCompatible`, `capabilities`;
2. target domain surfaces: `events`, `llm`, `agents`, `executions`, `sessions`, `tools`, `skills`, `prompts`, `attachments`, `mcp`, `tasks`, `coordination`, `workspaces`, `security`, `diagnostics`, `settings`, `profiles`, `remotes`, `storage`, and `services`;
3. per-domain composition from internal owner slots published by existing mounters;
4. exact target-shaped disabled/unavailable surfaces for absent optional owners;
5. lazy caller-bound resolution only where required to preserve Cordis fiber identity or official receiver semantics.

The public builder must not expose feature-shaped roots, mounter keys, package identities, replacement row identities, or internal registry objects. A domain may contain multiple idioms; the builder uses the member registry to assign each leaf to its target domain and does not infer idiom from the namespace.

#### Client

`lib/client-runtime.js` remains the source of the client facade. The public root is assembled directly as:

```text
ctx.pluginApi
├── isActive / apiVersion / assertCompatible / capabilities
├── connection
├── events
├── remotes
├── settings
├── slots
├── lifecycle
├── codec
└── services
```

The public `.client` wrapper is absent. Caller-bound context rebinding, root generation and leaf leases remain internal implementation mechanisms. Official browser services remain statically described and are exposed only through audited `services.*` paths. `defineManifest` stays a static bundle helper and is not a runtime API member.

Host-first redaction is authoritative for payloads sent to client. The bundled client codec validates shape after redaction; it does not serve as a second secret policy. Client remotes, slots, settings and lifecycle use the same owner-local generation and stale cleanup rules as host contributions where the semantic pattern is shared.

### Idiom Adapter Model

The runtime does not need eight generic runtime classes. Each domain mounter uses the smallest local adapter needed for its members, while registry and pure validators enforce common outer contracts.

- **Projection adapter:** produces frozen views and standard observe handles. It never writes state or registers policy.
- **Policy adapter:** stores owner-scoped decision registrations and invokes pure `decide(context)` at a real decision point. It owns priority/reducer metadata and callback containment.
- **Mutation adapter:** returns frozen business results with `commitState`, delegates durable writes to the owning authority, and exposes no implicit rollback disposer.
- **Operation adapter:** wraps a caller-visible operation identity or handle, publishes status/observe/terminal outcome, and guards cancellation and stale completion.
- **Contribution adapter:** records owner-scoped reversible assembly input with `seq`, an identity-bound disposer, and observable eviction.
- **Resource registry adapter:** registers data or implementations by owner/id/generation and separates registration from `get/list` projection.
- **Coordination adapter:** owns lease/fencing semantics and uses `acquire/heartbeat/release/takeover/compareAndSet/observe/availability` vocabulary. Every coordination entry is asynchronous. `acquire` returns the lease handle; the handle is a credential, provides no `dispose()`, and is given back through the entry verb `release(handle)`. A synchronous bounded borrow registers the expiry and takeover contract entries as not applicable and keeps the rest of the contract unchanged, including the asynchronous entry requirement.
- **Self-description adapter:** exposes frozen capability presence and current availability without side effects or handles.

A member may have a domain-specific implementation, but its outer result, handle and failure shape is selected from the idiom contract. Cross-domain differences are limited to domain data, explicitly declared `concurrency`, `reducer`, or documented idiom exception.

### Implementation Channel And Hook Exposure

Every member record declares one implementation channel and, where relevant, a hook exposure mechanism:

1. **Official event/service binding (A class).** The adapter obtains an injected official service or binds an already-dispatched event. It preserves receiver, argument, return, error identity and official authority. The facade may type, freeze, contain or rename the outer surface only where the target contract permits.
2. **Lower-level hook simulation (B class).** The adapter enters through a documented lower-level hook such as `llm/stream`, `tools/pre-execute`, `session` events, Typert remote mounting or caller-bound context. The design record must state the re-entry boundary, at-most-once/convergence rule, input/output projection, stale guard and failure fallback. It must not claim that a synthetic event exists in the official catalog.
3. **Upstream proposal (C class).** The target public semantic may be recorded in registry and proposal evidence, but its active member remains unavailable, removed, or absent as specified by the capability matrix. No consultation-shaped public method is added to compensate for a missing decision point.
4. **Approved replacement (R class).** Existing replacement packages may provide a component-local owner where the capability strategy has already approved it. The replacement must preserve the official row contract, pass runtime/package/boot checks, and use only the official patch mechanism. M8 does not add an unapproved replacement or move cross-cutting dispatch semantics into a replacement.

The registry records the per-member channel and source evidence. The design does not duplicate a hand-maintained list of every leaf, which would create a second source of truth.

### Shared Internal Mechanisms

M8 may reuse or extend small internal helpers for:

- frozen result and view construction;
- owner identity derivation from caller context;
- generation/seq/epoch creation and stale checks;
- typed error/result construction;
- cancellation signal composition;
- event listener containment;
- registry projection and snapshot generation;
- domain-specific CAS/fencing or transaction adapters.

These helpers remain private to the facade or owning feature. M8 does not create a runtime global owner graph, universal permission engine, cross-domain transaction platform, universal schema migration framework, or global dependency-order graph.

## Components And Interfaces

### 1. Registry Contract And Validator

Extend the existing pure validator and snapshot generator rather than introducing a runtime registry service.

The validator must check:

- every required member field is present, and a field that does not apply carries an explicit `null` rather than being omitted;
- `idiom` is one of the eight idiom names, or exactly `passthrough-exception` when and only when the public path starts with `services.`;
- unique current/target public paths and capability paths;
- handle member paths are present and may have a different idiom from their parent;
- a `passthrough-exception` member lives only under `services.`, and every retained `services.*` member carries that idiom value;
- public path depth and domain relationship rules;
- vocabulary membership for idiom, effect, composition, runtime, channel, availability, terminal, priority, scope, operation `concurrency` and coordination code;
- naming vocabulary by idiom, with explicit exception records where necessary;
- uniform field names for cross-domain concepts, with the coordination `release(handle)` rule as the only registered `dispose()` exception;
- every member of one idiom shares the same outer `failureSemantics` and conflict result shape, with domain `concurrency` and `reducer` differences explicitly recorded rather than changing the outer shape;
- `generation`/`seq`/`epoch` meaning constraints;
- event authority and event semantic fields;
- every namespace navigation record names an `availabilityMember` whose return shape contains `status`, or carries a non-empty `availabilityExemption`;
- `capabilities.get(path)` maps every capability path in the registry to `active`, `degraded`, or `unavailable`;
- a namespace assembled from several features records every contributing feature, and its namespace entry carries navigation facts only;
- `recommended` members have completed composition/authority evidence;
- every capability cluster carries exactly one `status` from the closed conservation vocabulary, `qualifiers` only from the registered qualifier vocabulary, and no compound label inside `status`;
- every deleted entry has a replacement or gap reason;
- host/client corresponding members have aligned outer contracts where parity is claimed;
- registry member set matches generated host/client surface snapshots and checked-in type declarations.

The snapshot generator produces neutral artifacts for host/client surfaces, idiom groups, handle members, capability statuses, service fixtures, event authority, recommended profile, migration diff and composition matrix. It never inspects arbitrary runtime objects and never discovers undocumented official members.

### 2. Host Domain Builder

Keep `PluginApiService` as the public service provider and add domain assembly boundaries around existing feature mounters.

Conceptual interface:

```js
createHostSurface({
  active,
  callerContext,
  ownerSlots,
  registryProjection,
  officialServices,
  approvedReplacements,
}) -> frozen HostPluginApi
```

The builder resolves a target domain from the internal owner slots assigned to it. It must:

- preserve caller-fiber identity where the official API requires it;
- expose all target namespaces with exact shape, including typed unavailable members;
- prevent old roots and aliases from being recreated by lazy getters;
- freeze read-only composite surfaces while keeping opaque handles owner-bound;
- keep unrelated domains active after an optional mounter failure;
- run no official service call before the relevant guard and availability check.

### 3. Client Root And Bundle Builder

Keep the current client construction strategy and change only the public composition and contract adapters.

Conceptual interface:

```js
createClientApiRoot(ctx, {
  rootBuilder,
  rootGeneration,
  dispose,
}) -> ClientPluginApi
```

The client builder must:

- publish direct root members without `.client`;
- keep official browser service leaves under `services.*`;
- preserve static manifest and checked-in bundle boundaries;
- retain caller-bound connection/remote/slot/settings/lifecycle ownership;
- validate host-redacted wire payloads with the bundled codec;
- invalidate root and leaf generations before late cleanup callbacks can publish;
- keep optional service absence local to the owning member.

### 4. Event Semantic Adapter

The event adapter separates three public idioms:

- `events.catalog()` as a self-description query;
- `events.observe(...)` as a projection subscription;
- authorized dispatch methods as operation outcomes.

The event catalog record contains:

```js
{
  name,
  eventSemantics: 'decision | fact | observation | notification',
  scope,
  payloadShape,
  freeze,
  priority,
  observerFailure,
  producerAuthority,
  implementationChannel,
}
```

Canonical event dispatch is checked against producer authority. An ordinary observer registration never grants dispatch rights.

Dispatch members are the operation-idiom dispatch variant: one dispatch has no independent operation identity and is never retried, so the operation identity and retry contract entries are registered as not applicable, and the return value becomes a discriminated dispatch outcome rather than the current `undefined`.

A decision-carried event belongs to the event-form policy variant and must additionally declare decision precedence, the convergence rule on conflict, and the containment plus default decision applied when a listener throws; it otherwise shares the policy failure and conflict contract.

Custom publisher support is exposed as an owner-scoped `events.define(spec)` handle or remains an explicit unavailable/proposal capability; no global entry able to dispatch arbitrary canonical event names is introduced. At the time of this approved design the current runtime had no owner-scoped publisher; the later policy-enforcement-closure feature delivered the cooperative handle, so the canonical registry and that feature's delivery report are authoritative for current availability.

### 5. Idiom-Specific Domain Adapters

Each domain is migrated by assigning its existing mounter output to one or more idiom adapters:

- `llm`: model/routing projections, request/admission policies, adapter/provider registries and call operations;
- `agents`/`executions`: registry/projection/operation separation, independent execution identity and recovery authority;
- `sessions`: read projections, durable mutations, branch/channel coordination and channel operations;
- `tools`/`skills`: resource registration, policy registration, projections, execution and activation operations;
- `prompts`/`remotes`/client `slots`: contributions separated from projections and resource registration;
- `attachments`/`mcp`/`tasks`/`coordination`/`workspaces.transactions`: operation, projection, coordination and mutation boundaries;
- `security`/`diagnostics`/`settings`/`profiles`/`storage`: policy, projection, mutation, self-description and thin private storage boundaries.

The adapter does not infer public semantics from official method names. For example, `open` may become `acquire`, `schemas` may become `list`, and `validate` may become an operation handle when the target idiom requires it.

### 6. Services Adapter

Extend the static service definitions with M8 registry metadata:

```js
{
  key,
  ctxService,
  member,
  kind: 'method | getter | forward | optional',
  required,
  publicPath,
  implementationChannel: 'passthrough',
  composition,
  authority,
  bypasses,
  visibility,
  cancellation,
  availability,
}
```

Runtime behavior remains member-level:

- declared and available member: frozen one-to-one passthrough preserving official receiver and errors;
- declared but absent member: exact typed unavailable surface;
- absent optional service: disabled parent/member without affecting unrelated domains;
- undocumented official member: never exposed.

A service passthrough does not acquire an idiom contract merely because its method name resembles `register`, `get`, or `open`; its official contract remains the source of truth.

### 7. Migration And Deletion Ledger

Maintain exact current-to-target records in the registry and a human-readable M8 migration ledger under the feature spec directory. The ledger covers:

- rename, merge, split, migrate, delete, internalize and gap actions
  (`internalize` added during execution: the member leaves the public face
  as an internal mechanism, e.g. the recovery classifier and the
  session-channel contract members; the ledger records the sanctioned
  non-enumerable internal forms);
- replacement or gap reason for every deletion;
- affected types, snapshots, tests, package/patch files and consumers;
- expected unavailable/failure consequences;
- evidence that capability trigger, input, output, failure and observability are preserved when a manual path is replaced automatically.

A destructive public removal is not implemented until its registry state, capability-matrix treatment and affected consumer references are known. If implementation reveals that removal changes an approved Goal or Requirements boundary, work pauses for a separate human decision.

### 8. Package And Consumer Reconciliation

Package assembly remains governed by existing patch files and package metadata. M8 does not create a new installer. The reconciliation layer verifies:

- full aggregate bundle versus main plus explicitly selected auxiliary packages;
- runtime identity and package `A.B.C` compatibility;
- optional capability isolation and typed unavailable behavior;
- official row restoration when a replacement is absent or removed;
- no double-running or disabled-official-row holes;
- target paths used by both local consumers;
- consumer behavior and boot evidence at the frozen public-contract baseline.

## Data Models

### Member Contract Entry

Every public leaf and public handle leaf is represented conceptually as:

```js
{
  publicPath: 'sessions.channels.acquire',
  targetPath: 'sessions.channels.acquire',
  capability: 'sessions.channels',
  idiom: 'coordination',
  idiomExceptions: [],
  eventSemantics: null,
  semanticFace: 'projection | policy | durableMutation | null',
  effect: 'execute',
  composition: 'coordinated',
  runtime: 'host',
  implementationChannel: 'facade',
  authority: 'channel authority',
  scope: 'session',
  resourceKey: 'session/channel/device',
  identitySource: 'caller owner + channel generation',
  conflictRule: 'CAS/fencing',
  lifecycle: 'lease expires; release is idempotent',
  failureSemantics: 'discriminated-result',
  idempotency: 'not idempotent',
  retryLayer: 'operation',
  availabilityShape: 'namespace availability()',
  concurrency: 'exclusive',
  reducer: 'none',
  currentShape: 'legacy open result',
  migrationAction: 'rename',
  status: 'recommended',
  verification: ['...'],
}
```

`targetPath` is empty only for a deleted member. `idiomExceptions` is empty for normal entries; a non-empty exception must include `memberPath`, `baseContract`, `exception`, `reason`, `replacementShape`, and `verification`.

Every record carries the complete field set. A field that does not apply to the member carries an explicit `null` and is never omitted, which is what lets the validator tell "not applicable" apart from "not yet recorded". The examples in this document are abridged for readability and do not themselves add a runtime member.

The exact registry vocabulary is normative and validated mechanically.

### Namespace Navigation Record

A public namespace is defined by its navigation record, not by an implicit path-depth rule. The namespace set is therefore exactly the set of `namespaces` records, and Wave 1 enumerates it from the member inventory.

```js
{
  namespace: 'sessions.channels',
  runtime: 'host',
  capabilityPath: 'sessions.channels',
  contributingFeatures: ['...'],
  availabilityMember: 'sessions.channels.availability',
  availabilityExemption: null,
}
```

`availabilityMember` names the namespace `availability()` leaf, or is `null` together with a non-empty `availabilityExemption`; a namespace record with neither is a contract defect. A `services.*` passthrough namespace carries the exemption that official passthrough surfaces acquire no facade availability semantics. Navigation records carry no idiom and no semantic classification; classification lives on leaf records only.

### Handle Leaf Entry

A handle member is a separate registry entry, for example:

```js
{
  publicPath: 'settings.register.handle.get',
  targetPath: 'settings.register.handle.get',
  idiom: 'projection',
  runtime: 'host',
  effect: 'read',
  composition: 'pure',
  authority: 'settings owner',
  scope: 'profile',
  identitySource: 'parent registration handle',
  lifecycle: 'valid only while parent generation is active',
  failureSemantics: 'typed-throw',
  conflictRule: 'not-applicable',
}
```

The parent registration may be `resourceRegistry` while a read-only handle member is `projection`. Parent/handle idiom mismatch is valid when explicitly represented; omission is a registry defect.

### Capability Conservation Record

```js
{
  capabilityCluster: 'tools discovery',
  currentPaths: ['tools.discovery.search'],
  targetPaths: ['tools.discovery.list'],
  status: 'renamed',
  qualifiers: ['split'],
  replacement: null,
  gapReason: null,
  affectedConsumers: ['...'],
  verification: ['registry', 'surface', 'behavior'],
}
```

`status` is a closed vocabulary of `retained`, `renamed`, `merged`, `migrated`, `deleted`, and `gap`, and is the only field a conservation check reads; a compound label is never written into it. `qualifiers` carries the additional shape information drawn from `shape`, `split`, `reclassified`, and `internalized`, and never changes the conservation class. A cluster whose retained part and unproven part cannot be expressed by one status is recorded as two capability rows instead of one compound row. `deleted` requires `replacement` or `gapReason`; `gap` requires a statement of the missing capability property and its expected upstream or replacement nature.

### Result And Handle Shapes

The following outer shapes are selected by idiom:

```text
projection subscription: { current(), subscribe(listener), dispose(), epoch }
policy handle:          { id, ownerId, generation, dispose() }
resource handle:        { id, ownerId, generation, dispose() }
contribution handle:    { id, ownerId, seq, dispose() }
operation handle:       { id, ownerId, status(), observe(), dispose() }
coordination lease:     { id, resource, generation, fencingToken, expiresAt }  # returned by acquire(); no dispose(); give-back verb is release(handle)
```

Handle extensions are registered as documented variants, not as new idioms:

- a transaction handle extends the operation handle with `record`, `preview`, `commit`, and `rollback`;
- a storage binding handle extends the operation handle with `purge()`, registered as an explicit mutation extension that must satisfy the mutation `commitState` contract;
- `close`, `finish`, and `settle` are not valid destruction verbs on any handle.

Business outcomes are frozen discriminated results with `{ ok, code, reason, ... }`. Operation terminal values are `success | error | aborted | denied | superseded`; mutation uses `commitState`; resource lifecycle uses `lifecycleState`. Coordination outcomes additionally use the fixed code vocabulary `inactive | invalid-input | conflict | unavailable | unsupported`. A stale-handle condition is reported as `code: 'conflict'` with the stale condition carried in `reason`; `stale` is never used as a machine code.

Uniform field names are mechanically validated: `ok` is the boolean success flag, `code` is the stable machine code, `reason` is caller-facing text, `id` is identity, `ownerId` is owner, `generation` is the concurrency token, `seq` is registration order, `observedAt` is the observation instant, and `epoch` is freshness. Availability is never embedded in a business outcome and is obtained only from the namespace `availability()` member, or from `availability(scope)` for coordination.

### Owner, Freshness And Scope

- `ownerId` is derived from actual plugin/caller context for registrations, policies, contributions, subscriptions and client bindings;
- coordination may accept an explicit owner only as a value that is checked against the authority, not as an untrusted self-assertion;
- `generation` is an owner-specific opaque concurrency/fencing token;
- `seq` is registration order and is not used for fencing;
- `epoch` is projection freshness and is not used for concurrency;
- durable records use exactly one of `profile`, `workspace`, or `session` scope;
- execution identity is independent from event sequence and remains stable across internal attempts;
- stale disposers/results are bounded typed no-ops or stale outcomes and never mutate a newer generation.

### Event Record

```js
{
  name: 'tools/result',
  eventSemantics: 'observation',
  runtime: 'host',
  payload: 'frozen execution/result observation',
  observer: 'additive projection subscription',
  producerAuthority: 'tools execution authority',
  dispatch: 'operation outcome',
  priority: 'normal',
  listenerFailure: 'contained',
  scope: 'execution',
}
```

Decision events additionally declare their reducer, default decision, failure containment and priority semantics. Fact, observation and notification events do not acquire decision semantics merely because they are dispatched through the same bus.

### Availability And Capability Presence

`availability()` returns a frozen object with `status: active | degraded | unavailable` and bounded domain details. `capabilities.get/list/require` reports public capability presence and current status; it does not expose internal owner slots. Health findings belong to diagnostics and are not substituted for availability.

### Wire And Durable Records

Package version, in-process API version, wire revision and durable record schema remain independent. M8 does not bump the frozen M7 package baseline merely because a public path changes. A real wire boundary uses an integer protocol revision; a real durable record uses schema ID and integer version. Unknown future durable versions return `unsupported-schema`; no generic migration platform is added.

## Domain Composition Design

M8 applies the following minimum composition decisions. These are design boundaries for later Tasks, not claims that every target path is already implemented:

- **Events:** `catalog()` is a self-description query; observe and production are separate; canonical producers are authority-bound; ordinary listeners use fixed priority plus successful registration order; dispatch is the operation variant with identity and retry registered as not applicable; decision events adopt the policy event-form variant with declared precedence, convergence and default decision.
- **LLM:** transforms are owner-scoped and convergent; admission uses fixed decision algebra; adapters/providers use registry ownership; routing query, policy, candidate, health and decision records remain separate.
- **Agents and executions:** provider singleton claims are explicit; execution identity is independent of event sequence; recovery has one consumption authority and projection members stay read-only.
- **Sessions:** branches and channels have independent authority, identity, scope and generation; direct mutation bypasses are explicit; durable append returns mutation results with commit state.
- **Tools and skills:** tool/discovery keys have explicit conflict behavior; restrict/guard are policies; activation registry and session activation are different authorities.
- **Prompts and remotes:** prompt and remote/slot input is contribution where reversible and non-durable; provenance projection and policy are separate; shared names use explicit conflict or claim behavior.
- **Attachments, MCP, tasks and coordination:** pipeline operations, catalog projections, task attempts, and leases expose distinct identities and cancellation/fencing rules.
- **Workspace transactions and storage:** workspace writes use transaction authority; plugin storage is a thin owner-scoped private binding with one durable scope and explicit purge.
- **Security, diagnostics, settings and profiles:** security reducers fail closed; diagnostics cannot mutate diagnosed features; settings/profile writes use explicit scope/revision/CAS where applicable; health and availability remain separate.

A member outside the default Composable Profile may still be available, but its weaker composition or bypass must be explicit in the registry. `recommended` means composition and authority evidence is complete, not merely that the member exists.

## Error Handling And Lifecycle

### Apply And Boot Guard

All host and replacement apply functions retain the fail-safe sequence:

1. validate manifest, runtime identity and package compatibility;
2. run the core guard;
3. provide or reuse an inert `pluginApi` root when the core is inactive;
4. run each optional feature guard without publishing an active surface prematurely;
5. create owner-bound resources and rollback/disposer state;
6. publish a domain slice only after its cleanup and availability state are established;
7. contain optional mounter failures and continue unrelated domains;
8. catch apply-level errors, log a bounded diagnostic, and return normally.

A failed optional mounter may produce an exact target-shaped disabled/unavailable member, but must not leave an official row disabled without a functioning approved replacement. No failed path may fall through to a stale prior generation.

### Failure Precedence

The outer failure decision follows this order:

1. inactive facade core;
2. unavailable capability or member;
3. registration, owner, key or claim conflict;
4. denied, aborted, superseded or stale discriminated outcome;
5. official error identity after a successful passthrough call.

The selected idiom controls whether the outer form is typed throw, discriminated result, or silent no-op. Silent no-op is only valid where the idiom explicitly defines it, such as stale disposer cleanup; it is not a substitute for unavailable registration or failed business mutation.

### Callback, Dispatch And Reducer Containment

A callback failure is contained at its owning decision point:

- a projection listener failure removes or degrades only that listener;
- a policy callback failure uses the policy point's documented default decision and records bounded evidence;
- a contribution provider failure rejects or degrades that contribution without mutating unrelated contributions;
- an operation callback failure becomes the operation's declared error outcome;
- an event dispatch failure returns the documented dispatch outcome and does not throw through unrelated callers.

No containment rule may silently convert a required authority rejection into success.

### Stale And Cancellation Handling

For every async adapter, remote mount, observer, lease, replacement, operation or client rebind:

- preserve the caller's `AbortSignal` and compose only an additional local cancellation source;
- invalidate the owner/generation before cleanup can run late callbacks;
- check owner, generation, resource possession and terminal state before publishing or committing;
- after `aborted`, `superseded` or another terminal outcome, do not begin a retry;
- retain stale events only as bounded diagnostic/audit data, never as current progress;
- dispose only resources created by the current owner/generation.

`dispose()` on an operation handle requests stopping and does not claim completion. A coordination lease is not a generic disposer handle; it is returned through `release(handle)`. A mutation has no implicit disposer for committed facts.

### Availability And Disabled Surfaces

The public namespace set is the set of namespace navigation records, not an implicit path-depth rule; Wave 1 enumerates it from the member inventory. Every namespace in that set has a stable shape and either an `availability()` member named by its navigation record or a recorded exemption. A missing optional backing service produces a frozen unavailable state and typed unavailable behavior at the member level. An explicitly removed member is absent from the target surface and registry status, and its capability conservation record explains the replacement or gap.

Availability is never expressed by returning `undefined`. A member may return `undefined` only for a domain-defined legitimate absence that is explicitly recorded in its registry entry with the member path and the meaning of the absence; that member must still express unavailable or degraded capability through `availability()` or a typed unavailable result.

### Replacement Failure

For an existing replacement bundle, M8 preserves the checks for official row disabled, exactly one replacement row active, runtime identity match, component owner uniqueness, critical contract availability, and client-half presence where required. Any failure logs and safely returns; it never runs both official and replacement rows and does not disable unrelated facade capabilities.

## Implementation Sequence

Stage 4 Tasks will follow this dependency order. Each Wave is one top-level task batch; its implementation, tests, registry updates and required docs are delivered together. The sequence is serial because `PluginApiService`, `client-runtime`, registry snapshots, package assembly and consumer contracts are shared integration surfaces.

### Wave 1: Baseline And Complete Inventory

- Freeze or verify the existing M7 package/runtime/API baseline; do not create a new version boundary solely for M8.
- Enumerate host leaves, client leaves, handle leaves, event operations and audited services from implementation facts and the M7 registry.
- Record current shape, target path, candidate idiom, implementation channel and migration action without changing runtime public paths.
- Resolve inventory gaps before any shape migration begins.

### Wave 2: Registry Contract And Mechanical Evidence

- Extend registry vocabulary and member schema for idiom, event semantics, semantic face, lifecycle, failure, conflict, freshness and handle entries.
- Extend validator and snapshot generator for naming, parity, handle coverage, capability conservation, services exceptions and event authority.
- Generate neutral host/client, idiom, capability, service, event and composition fixtures from the same registry.
- Add negative tests for unregistered leaves, invalid idioms, path aliases, mixed generation semantics, undocumented services and governance-token leakage.

### Wave 3: Shared Outer Contracts And Event Semantics

- Introduce or normalize small private helpers for frozen results/views, typed unavailable/conflict outcomes, owner identity, generation/seq/epoch and listener containment.
- Reclassify event catalog/observe/dispatch according to the target idioms: `events.catalog()` as a self-description query, `observe` as a projection subscription, and dispatch as the operation dispatch variant returning a discriminated outcome.
- Register the operation identity and retry contract entries as not applicable for dispatch, and record the three additions required by decision events: decision precedence, conflict convergence, and containment with a default decision.
- Stabilize producer authority, event semantics and priority vocabulary.
- At M8 design time, keep the owner-scoped `events.define(spec)` publisher active only if the runtime can enforce owner scope; the later policy-enforcement-closure delivery records its cooperative ownership and non-adversarial boundary.

### Wave 4: Projection And Self-Description Surfaces

- Migrate low-risk read and observe paths to `get/list/inspect/history/observe` and standard projection handles.
- Give every public namespace an `availability()` member returning `status`, map every capability path to one of three statuses through `capabilities.get`, separate capability matrices from current availability, and remove availability fields embedded in business outcomes.
- Complete public capability query and disabled/unavailable shape behavior.
- Move or retain official read-only helpers under audited `services.*` where they have no facade semantic guarantee.

### Wave 5: Policy, Resource Registry And Contribution Surfaces

- Convert policy registrations to `register(spec)`/`decide(context)` with real decision points, reducers and default decisions.
- Convert resource registrations to one-table `register/get/list` with owner/generation/conflict semantics.
- Convert reversible assembly, remote and slot inputs to `contribute(spec)` with `seq`, disposal and eviction observability.
- Split mixed members before adding guarantees; do not make registration appear automatically effective when the runtime does not consult it.

### Wave 6: Mutation, Operation And Coordination Surfaces

- Align business writes to frozen discriminated results and `commitState`.
- Align long operations to outcome/terminal/attempt and standard handles.
- Align leases/tasks/channels to coordination vocabulary and fencing/CAS semantics.
- Apply domain-specific authority closure, scope, cancellation, retry and stale-result guards only to retained members.
- Keep durable scope and wire/durable revisions independent from in-process path migration.

### Wave 7: Public Surface Subtraction And Host/Client Reconciliation

- After target shapes are stable, execute approved delete/merge/split/migrate actions and remove old paths, aliases, internal mechanisms and duplicate official forwarding surfaces.
- Rebuild host/client public surface snapshots and types from the registry; remove public `.client` and keep official browser leaves under `services.*`.
- Rebuild and inspect the checked-in client bundle.
- Verify services member-level whitelist, host-first redaction, client shape validation, optional capability isolation, enumerated lifecycle/codec leaves, and no undocumented public leaf.

### Wave 8: Consumer, Installation And Final Evidence

- Migrate `dsh-read-image` and `dsh-pro-ex-ability-anchor` to target paths and remove corresponding private hacks/fallbacks.
- Verify full aggregate and selective installation equivalence, reverse load order, version mismatch, optional unavailability, replacement restoration and no double-running.
- Run composition matrices, consumer headless smoke, documented dev boot, `npm test`, `git diff --check` and official-package modification audit.
- Synchronize feature registration and relevant governance pointers only after the complete public contract is proven.

## Testing Strategy

### Pure Contract Tests

Use harness-free Node tests for:

- registry parsing and required-field validation;
- one-primary-idiom and `services.*` exception rules;
- idiom naming vocabulary, uniform field names and the six-field exception format;
- handle leaf coverage and parent/handle idiom differences;
- one outer `failureSemantics` and conflict result shape per idiom, with domain `concurrency` and `reducer` recorded as registered differences;
- event semantics, producer authority, priority vocabulary, dispatch outcome shape and the operation entries registered as not applicable for dispatch;
- generation/seq/epoch meaning and terminal vocabulary;
- every public namespace exposes `availability()` containing `status`, and `capabilities.get` maps every capability path to one of three statuses;
- current-to-target mapping, deletion replacement/gap records and capability conservation;
- host/client outer-contract parity;
- generated snapshot/fixture equality with the registry;
- services whitelist exclusion of undocumented official members;
- governance-token scans over implementation and generated artifacts.

### Host Surface Tests

Cover:

- root/domain target shape and removal of old paths;
- frozen projections and standard observation handles;
- policy/resource/contribution registration handles, owner derivation and conflict behavior;
- operation terminal outcomes, retry/attempt identity, cancellation and stale completion;
- mutation `commitState`, explicit compensation and CAS/fencing;
- availability versus capability matrix and inactive/unavailable/conflict precedence;
- events observe/producer separation, event semantics, priority, reducers and callback containment;
- `events.catalog()` as a frozen self-description query, discriminated dispatch outcomes, and the event-form policy variant for decision events including precedence, conflict convergence and default decision on listener failure;
- services receiver/argument/return/error fidelity and member-level unavailable behavior;
- domain-specific composition, authority closure and explicit bypasses.

### Client Tests

Cover:

- direct `ctx.pluginApi` root with no public `.client` member;
- parity of names, handles, failures, conflicts and lifecycle with host semantic members;
- remote/slot/settings/lifecycle contribution and projection handles;
- reconnect/HMR root generation, owner-local stale cleanup and callback failure containment;
- host redaction before serialization and client codec validation after redaction;
- checked-in bundle shape, manifest boundary and module-loader identity;
- official browser services exposed only through registry-declared `services.*` paths;
- lifecycle and codec leaves enumerated leaf by leaf with an assigned idiom, and no codec leaf exposing a raw schema library instance as the public API;
- every client namespace exposes `availability()` with the same shape vocabulary as host.

### Composition Matrix

At least two synthetic plugins exercise each applicable shared primitive:

- reverse registration/load order;
- same owner/id idempotency and same/different owner conflict;
- owner and scope isolation;
- repeated registration, missing disposal and stale disposer/generation;
- callback throw/rejection and shared async pipeline failure;
- ordered reducer repeatability and declared order dependence;
- coordinated lease expiry, stale fencing, takeover proof, CAS and transaction rollback;
- exclusive preflight rejection before side effects;
- authority closure and explicit low-level bypass;
- pure projection inability to mutate shared state;
- client remote, slot, settings and lifecycle equivalents.

### Capability Conservation Tests

For every current capability cluster:

- assert exactly one final matrix status;
- assert renamed/merged/migrated capabilities have target paths;
- assert deleted capabilities have replacement or gap reason;
- assert automatic replacement evidence covers trigger, input, output, failure and observability;
- assert no current path remains unexplained in the registry, surface snapshot or consumer references.

### Consumer And Boot Acceptance

The migrated consumers must provide real repository evidence, not facade-only fixtures:

- `dsh-read-image`: target image admission/request/settings/route paths, no dormant private route/request hack, correct route absence and message behavior;
- `dsh-pro-ex-ability-anchor`: target session append/prompt/settings/remote/services/client paths, no hand-authored protocol fallback, correct provenance and panel behavior;
- full installation equals main plus all intended auxiliary bundles;
- main-only and mismatched optional packages report only affected capabilities unavailable;
- removing a replacement restores the official row;
- reverse supported plugin order is deterministic;
- headless smoke and documented dev boot complete without activation errors.

The repository test command remains the guarded `npm test` defined by AGENTS.md. Raw `node --test` is not the default verification command.

## Standards Applicability And Alignment

| Standard | Applicability | Design alignment |
|---|---|---|
| `docs/standards/api-idioms.md` | Applicable | Eight idioms, one primary idiom, uniform outer contracts, event classification, leaf/handle registry checks and capability conservation are recorded in the merged current standard. Historical M8 inventories and migration tables remain in this feature directory. |
| `docs/standards/capability-strategy.md` | Applicable | A/B/C/R implementation channels, facade default, approved replacement boundary, fail-safe and no official package modification are preserved. |
| `docs/standards/api-shape.md` | Applicable | Projection/policy/mutation separation, one-way data flow, one primary face and private shared primitives constrain adapters. |
| `docs/standards/public-api-shape.md` | Applicable as current namespace baseline | M7 registry remains current fact source; M8 changes member idiom/shape without reviving feature-shaped public roots. |
| `docs/standards/composition-and-authority.md` | Applicable | Five composition modes, owner/key/generation/disposer, authority closure, claims/preflight and callback containment drive Wave 5–7. |
| `docs/standards/domain-composition.md` | Applicable | Domain-specific owner, reducer, resource, scope and authority minimums are recorded in member contracts and tested by domain matrices. |
| `docs/standards/ordering.md` | Applicable | Fixed priority plus registration order is used for ordinary listeners; domain reducers/fixed stages handle semantic decisions; no global dependency graph. |
| `docs/standards/identity-and-lifecycle.md` | Applicable | Independent execution identity, owner-specific generation, attempt layering and terminal vocabulary are used in operation/coordination design. |
| `docs/standards/durable-state-and-scope.md` | Applicable | Durable records use one scope, commit/rollback, explicit retry capability and thin private storage only. |
| `docs/standards/visibility-and-redaction.md` | Applicable | Minimum exposure, policy-based visibility, host-first redaction and narrower client audience are enforced before wire publication. |
| `docs/standards/concurrency-and-cancellation.md` | Applicable | Signal propagation, commit eligibility, stale-result guard, disposer ownership and retry boundaries govern async adapters. |
| `docs/standards/versioning-and-protocols.md` | Applicable | Existing package baseline remains independent from wire/durable revisions; installation equivalence and runtime/package checks are retained. |

During M8, the idiom target documents and the then-current standards had different roles. After delivery, their durable public-contract rules are merged into `docs/standards/api-idioms.md`; this feature directory retains the historical migration evidence and does not redefine current runtime facts.

## Key Decisions And Tradeoffs

1. **One feature with Wave-level execution.** This keeps cross-idiom invariants and capability conservation atomic while allowing incremental code changes and focused tests. Splitting by idiom or namespace would duplicate or fragment the shared registry and outer contract rules.
2. **Extend the M7 registry instead of creating M8 registry state.** A second registry would make current path, target path, and status drift; in-place extension preserves one public-contract authority.
3. **Registry-driven evidence, not registry-driven runtime.** Mechanical generation is valuable for a large surface, but a runtime registry service would introduce an out-of-scope owner/permission/schema platform and blur public versus internal state.
4. **Use local adapters, not a universal idiom framework.** The idioms define observable contracts; domains still need different reducers, data types and authorities. Small local adapters preserve semantics without imposing a generic abstraction that the requirements do not need.
5. **Structural migration before semantic hardening.** It is safer to establish target paths and identify retained members before adding CAS, fencing, retries or cancellation guarantees. Otherwise effort is spent strengthening APIs that will be deleted or migrated to services.
6. **Host and client are reconciled after semantic contract definition.** Host and client share vocabulary, but browser transport and official service availability differ. Host-first redaction and static client service descriptors preserve that boundary.
7. **C and R remain explicit boundaries.** A gap is preferable to a consultation API that is known not to work. Existing replacements can participate only through their approved component ownership and self-check rules; M8 does not broaden the replacement strategy.
8. **No compatibility aliases during the local development window.** The repository has no external published compatibility obligation, and keeping aliases would prevent the registry from proving that the target surface is actually complete.

## Design Completion Condition

Stage 2 gate status: approved by the user on 2026-08-31 for the current version of this Design, including the SPEC2 contract refinements listed under Status. Stage 2 is therefore complete, and this approval boundary is the Stage 2 completion commit.

Stage 3 may now produce the dependency-ordered Tasks. Under AGENTS.md, Tasks require a blocking read-only adversarial review and do not require a separate user confirmation gate; Stage 4 proceeds only after that review returns no deviation. No implementation file, package metadata, test code, deletion ledger, or generated registry snapshot was created as part of Stage 2.
