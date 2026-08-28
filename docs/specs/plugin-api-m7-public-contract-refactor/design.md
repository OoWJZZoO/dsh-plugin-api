# Design: plugin-api-m7-public-contract-refactor

> feature_name: `plugin-api-m7-public-contract-refactor`
> 阶段：Stage 2 Design（已获用户明确批准）
> 上游：已批准的 `requirements.md`
> 目标：在不修改官方 DSH 包文件的前提下，把现有按历史 feature 累积的门面重组为领域优先的 host/client 公共契约，并在公共面稳定后完成最小必要的组合与 authority 加固。
> 本文档中 "M7" 均指本 feature：`plugin-api-m7-public-contract-refactor`。

## Overview

M7 采用一次公共形状切换、内部实现分层保留的设计。

- 对外只有目标 domain-first namespace；旧 public path、兼容 alias、feature-shaped root（按内部 feature/mounter 命名的公共根）和 replacement-shaped root（按 replacement 包组织方式命名的公共根）不再发布。
- 对内继续保留现有 feature mounter、guard、slot、prepared mount transaction 等成熟机制，除非它们阻碍最终公共契约。
- `feature-registry` 只表示内部 mounter 的启用/停用状态，不直接等同于 capability registry，也不承担 owner、claim 或业务冲突仲裁。
- `public contract registry` 是公共 API、capability、类型、disabled surface、服务白名单、组合矩阵和迁移文档的单一事实源；它是构建期/测试期数据，不建设新的运行时 registry 服务。
- M7 的实现阶段严格串行：先冻结 registry 和删除报告，再做 host cutover、client cutover、公共面减法、语义加固和生态验收。
- R 类只保留已批准 replacement 的现有组件边界；门面对 replacement 只做条件投影，不在公共 path 中暴露 package、row 或治理身份。

## Current-State Findings

调研当前仓库和两个真实消费者得到以下结论：

1. host apply 在 `lib/index.js` 中先执行 core/feature guards，再按 `FEATURE_MOUNTERS` 两遍结果装配 feature；失败路径已有正常返回、局部 disable、prepared rollback 和 logger containment。
2. `lib/plugin-api-service.js` 当前通过大量 getter 和 slot 发布 `agent`、`session`、`execution`、`routing`、`systemPrompt`、`sessionChannel`、`workspaceTransactions` 等历史公共根，并把内部 feature key 与公共名称紧密耦合。
3. 当前 `lib/feature-registry.js` 以内部 feature name 为 key，并具有 last-write-wins 的内部状态写入；该结构不能直接作为 M7 的公共 capability/claim registry。
4. 当前 `lib/services.js` 已采用静态 service definition 表，并按服务/成员提供冻结 passthrough 或 member-level disabled surface；这可以作为 services 迁移的实现基础，但仍需补充 registry 中的组合和 authority 元数据。
5. 当前 `lib/version.js` 只解析 `<runtime-full-version>-<B.C>`，而 M7 需要解析 `<runtime-full-version>-<B.C.D>`，同时第三方协商仍只比较 `B.C`。
6. 当前主包和辅助包均使用 `0.1.0-rc.6-0.7` / `dsh.api: 0.7`；M7 首次执行的 metadata cutover 将统一改为 `0.1.0-rc.6-0.1.0` / `dsh.api: 0.1`，之后整个 M7 不再 bump。
7. client 侧 `lib/client-runtime.js` 目前通过 root `.client` getter 构造客户端面，真实消费者的 `dsh-pro-ex-ability-anchor/panel` 也使用 `ctx.pluginApi.client`；M7 必须改为直接从客户端 `ctx.pluginApi` 读取环境专属成员。
8. `dsh-read-image` 当前仍有旧形状的 `llm.resolveModelInfo` 包装、`llm/stream` 重入和内部 route 访问代码，尽管仓库已有 facade 迁移基线；`dsh-pro-ex-ability-anchor` 当前主要使用 `pluginApi.events`、`pluginApi.session`、`pluginApi.remote`、`pluginApi.tools` 和 `pluginApi.services`，其 panel 仍使用 `ctx.pluginApi.client`。
9. `packages/full/cordis.patch.yml` 已有确定的主包及 replacement row 装配顺序。M7 需要保持 full/selective 装配等价和官方行可恢复，不把 row id 变成公共 API。

这些事实分别由以下当前文件支持：

- `lib/index.js`
- `lib/plugin-api-service.js`
- `lib/feature-registry.js`
- `lib/services.js`
- `lib/version.js`
- `lib/client-runtime.js`
- `packages/full/cordis.patch.yml`
- `../dsh-read-image/docs/known-hacks.md`
- `../dsh-read-image/AGENTS.md`
- `../dsh-pro-ex-ability-anchor/AGENTS.md`

## Architecture

### Logical Layers

```text
                    +------------------------------+
                    | docs/specs/.../public-       |
                    | contract.registry.json       |
                    | deletion report / mappings   |
                    +---------------+--------------+
                                    |
                    validate / generate / snapshot
                                    |
        +---------------------------+---------------------------+
        |                           |                           |
+-------v--------+          +-------v--------+          +-------v--------+
| Host domain    |          | Client domain  |          | Package/patch |
| surface        |          | surface        |          | assembly      |
| builder        |          | builder        |          | and version   |
+-------+--------+          +-------+--------+          +-------+--------+
        |                           |                           |
        +---------------------------+---------------------------+
                                    |
                    +---------------v--------------+
                    | Existing internal mounters   |
                    | guards / slots / transactions |
                    | feature registry              |
                    +---------------+--------------+
                                    |
                    +---------------v--------------+
                    | Official injected services  |
                    | and approved replacement rows|
                    +------------------------------+
```

### Registry Boundary

Canonical registry location:

```text
docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json
```

The registry is a spec/governance artifact and may contain implementation-channel and migration metadata. Generated or hand-maintained runtime modules must use neutral capability and domain names; governance classification, requirement numbers, and feature identifiers must not leak into `lib/`, `packages/`, `test/`, package metadata, row ids, or runtime error strings.

The registry contains:

- contract baseline and frozen package metadata;
- host and client domain tree;
- public member entries;
- capability and availability granularity;
- composition mode and authority fields;
- static services whitelist and member descriptors;
- event catalog and producer/consumer authority;
- wire protocol families and revisions actually in use;
- durable record schema IDs and versions actually requiring upgrade reads;
- removed/disabled/advanced/recommended status;
- old-to-target path mapping;
- implementation channel (`facade`, `passthrough`, `proposal`, or `replacement`), without runtime classification tokens;
- migration and deletion-report references.

Per-member hook exposure mechanism (direct official event binding, low-level hook simulation, upstream proposal, or registered replacement projection) is recorded by the registry in the `implementationChannel` field of each public member entry; the design body does not repeat the full per-member classification. §Domain Composition Rules states domain composition semantics and representative conclusions only, and §Error Handling And Lifecycle covers failure paths and guards.

A small validator/generator is allowed to produce:

- neutral host/client surface descriptors;
- API shape snapshots;
- capability and disabled-surface fixtures;
- services audit fixtures;
- composition test matrix input;
- documentation/reference fragments where useful.

It must not become a runtime schema registry, migration daemon, permission system, or global owner graph.

### Host Surface Assembly

`PluginApiService` remains the lifecycle owner of the published `pluginApi` service. Its internal assembly is reorganized into domain builders:

1. root metadata: `isActive`, `apiVersion`, `assertCompatible`, `capabilities`;
2. domain surfaces: `events`, `llm`, `agents`, `executions`, `sessions`, `tools`, `skills`, `prompts`, `attachments`, `mcp`, `tasks`, `coordination`, `workspaces`, `security`, `diagnostics`, `settings`, `profiles`, `remotes`, `storage`, `services`;
3. each feature mounter publishes an internal owner slot, not a public feature-shaped root;
4. each public domain getter resolves only the current slot(s) assigned to that domain;
5. disabled surfaces use the exact target member shape and typed errors, regardless of whether the underlying owner is absent or replaced;
6. composed domain surfaces are frozen and built from descriptors, while caller-bound handles remain opaque and owner-scoped.

The service may keep lazy getters to preserve caller-fiber identity capture, especially for `llm.adapters`, profile mutation, and client-bound operations. Lazy access must not reintroduce old public paths.

### Client Surface Assembly

`lib/client-runtime.js` remains the source of the browser facade and `lib/client.js` remains the checked-in browser artifact.

The client root will publish directly:

```text
ctx.pluginApi
├── isActive
├── apiVersion
├── assertCompatible
├── capabilities
├── connection
├── events
├── remotes
├── settings
├── slots
├── lifecycle
├── codec
└── services
```

The `.client` getter is removed from the public client root. Existing caller-bound construction and leaf leases are retained behind the root builder. Official client leaves are still statically described; runtime module discovery never widens the public surface. `defineManifest` remains a static export and is not placed under the runtime root.

Host-side redaction remains authoritative. Client-side codecs validate shape only after a host payload has been redacted. Client remote/slot/settings/lifecycle disposers remain bound to owner-local generation and root lifetime.

## Target Namespace Design

### Host Domains

The following target tree is the default contract. Exact members are populated from the registry after the inventory pass; no member is promoted merely because an old feature currently exposes it.

```text
pluginApi
├── isActive / apiVersion / assertCompatible / capabilities
├── events
│   ├── on / once / catalog
│   ├── define
│   └── dispatch.emit / serial / parallel / bail / waterfall
├── llm
│   ├── modelInfo / prepareCall / stream
│   ├── providers
│   ├── requestTransforms.register
│   ├── admissionPolicies.register
│   ├── adapters.decorate / snapshot
│   └── routing
├── agents
│   ├── get / list / roots / create / resume / register
│   ├── providers
│   ├── initiators
│   ├── options
│   └── availability
├── executions
│   ├── observe / get / history / onChange / visibility
│   └── recovery
├── sessions
│   ├── get / list / create / fork / append / appendMessage
│   ├── branches
│   └── channels
├── tools
│   ├── register / restrict / guard / get / schemas / execute
│   └── discovery
├── skills.activation
├── prompts
│   ├── section / context / variable / tools / assemble / render
│   └── provenance
├── attachments.pipeline / projection
├── mcp.catalog / lifecycle
├── tasks
├── coordination
├── workspaces.transactions
├── security
├── diagnostics
├── settings
├── profiles
├── remotes
├── storage
└── services.<static-member-whitelist>
```

Important semantic moves:

- `agent` becomes `agents`.
- `session` becomes `sessions`; branch and channel owners become `sessions.branches` and `sessions.channels`.
- `execution` becomes `executions`; recovery is nested under `executions.recovery`.
- `routing` and `routePolicy` become `llm.routing`; `agent.routeOf` and `tools.routeOf` are reviewed as duplicate delegates and are removed or retained only when the registry gives them an independent supported use case. Any removal is subject to the deletion report gate.
- `systemPrompt` becomes `prompts`.
- `context` becomes `prompts.provenance`.
- `workspaceTransactions` becomes `workspaces.transactions`.
- `tools.discovery`, `skills.activation`, and `llm.adapters` remain under their semantic domains.
- generic remote publication becomes `remotes`; a settings-specific convenience is retained only if it has independent public value and a registry entry.
- pure official low-level services remain under `services.*`, even where their names resemble a semantic domain.
- slash event names such as `system-prompt/assemble` remain protocol/event names; dot paths are used only for capabilities and public members.

### Capability Query Surface

The target root includes a capability read surface:

```js
pluginApi.capabilities.get('llm.routing')
pluginApi.capabilities.list({ prefix: 'llm.' })
pluginApi.capabilities.require(['llm.routing', 'sessions.channels'])
```

This surface reads registry-backed capability descriptors and current availability. It does not expose internal mounter snapshots, package names, replacement rows, or writable live registry objects. The old `features` snapshot is a candidate for the deletion report (see §Deletion Report Gate) because the target contract uses capability descriptors; its removal must be listed in that report and approved before implementation.

## Components And Interfaces

### Registry And Validation

Planned neutral components:

- registry data under the feature spec directory;
- a pure validator for required fields, duplicate public paths, duplicate capability IDs, path depth, and domain/member consistency;
- a build/test adapter that turns registry entries into host/client snapshots and services fixtures;
- a migration mapper that compares old public paths with target paths and identifies removed members.

The validator is pure and harness-free. It does not inspect arbitrary runtime objects and does not auto-discover official members.

### Internal Host Adapter

The host adapter keeps the existing apply contract:

```js
export function apply(ctx) {
  // core guard -> feature guards -> ordered mounters -> contained cleanup
}
```

Changes are isolated behind these responsibilities:

- `PluginApiService`: publishes the final root/domain surface and current owner slots;
- existing feature mounters: create owners and official hook bindings;
- domain composition builders: merge independent slices into target domains;
- capability query builder: exposes frozen availability descriptors;
- version utilities: parse full package versions and compare API `B.C` contracts;
- registry validator/snapshot fixtures: verify public shape against the design registry.

The implementation must not make `PluginApiService` access private official package state. Official services continue to be obtained through injected/context service boundaries, and replacement facets remain marker- and loader-gated.

### Internal Client Adapter

The client adapter keeps:

- static official leaf descriptors;
- one root generation and leaf lease per client root;
- owner-local lifecycle/rebind handling;
- one bundled real codec implementation;
- explicit remote/slot/settings failure containment;
- checked-in generated browser bundle.

It changes only the public composition location: direct root members replace `.client.*`; official low-level browser faces move to `services.*`; facade-owned client semantics remain in `connection`, `events`, `remotes`, `settings`, `slots`, and `lifecycle`.

### Services Adapter

`SERVICE_DEFINITIONS` remains static and is expanded with registry metadata rather than runtime introspection. Each member records:

- official service key and member;
- method/getter/forward kind;
- required or optional status;
- public capability path;
- composition mode;
- authority/bypass notes;
- runtime availability rule;
- visibility and cancellation notes where applicable.

Runtime behavior remains member-level:

- available declared member: frozen 1:1 passthrough;
- missing service/member: declared disabled surface with typed unavailable error;
- no official service at all: parent namespace disabled while preserving shape;
- undocumented official member: never exposed.

Semantic policy, shared mutation, singleton setter, and writable live objects are not made safe by documentation alone; they are wrapped, claim-gated, converted to restricted handles, or excluded from the recommended profile.

### Version And Assembly Adapter

The version layer will use one parsed record:

```js
{
  runtime: '0.1.0-rc.6',
  api: '0.1',
  maintenance: '0'
}
```

Package metadata cutover:

```text
main and all local auxiliary/full packages: 0.1.0-rc.6-0.1.0
dsh.api:                                0.1
```

M7 requires the local package set (main, auxiliary, and full aggregation packages) to share the same maintenance component `D=0` in this baseline, even though the general standard permits package-local maintenance values to differ. After this cutover no M7 task may modify any package version or `dsh.api` value. A required deviation stops the sequence and is reported to the human maintainer.

Runtime matching compares the full `runtime` identity. Plugin negotiation compares only `api` generation/increment using the standard same-generation, actual-increment-at-least-required rule. Wire and durable contracts are independent of this package version.

### Deletion Report Gate

The deletion report is a human-facing governance artifact:

```text
docs/specs/plugin-api-m7-public-contract-refactor/deletion-report.md
```

Before any implementation or test change that removes a public namespace, member, capability, alias, service member, or public behavior, the report must list:

- exact old public path/member;
- whether it is a duplicate, historical shape, unsupported authority, or no-value surface;
- current repository and consumer references;
- affected package, patch, client, and documentation surfaces;
- target replacement path or explicit absence;
- expected typed failure/availability consequence;
- reason under the target registry;
- test and migration updates required.

The report is shown to the human maintainer and the implementation pauses until explicit approval. This is an additional M7 gate and is not replaced by Stage 3 task review or Stage 4 global review. The report does not create a presumption that an unsuitable API should be retained.

## Data Models

### Public Contract Entry

```js
{
  publicPath: 'llm.routing.forExecution',
  capability: 'llm.routing',
  runtime: 'host',
  effect: 'read',
  composition: 'pure',
  stateOwner: 'routing facade',
  scope: 'execution',
  resourceKey: 'execution identity',
  identitySource: 'plugin-api execution registry',
  conflictRule: 'none',
  lifecycle: 'facade lifetime',
  bypasses: ['none'],
  availability: 'active',
  implementationChannel: 'facade',
  status: 'recommended'
}
```

The exact values are registry data, not runtime governance labels. The `availability`
entry field uses the frozen status vocabulary (`active | degraded | unavailable`,
freeze decision 7); the per-member granularity of the availability query result is
expressed by the member-level status map in the Availability data model below,
not by the entry field. Read surfaces must return frozen projections; mutation surfaces return opaque owner-bound handles or typed results.

### Composition Contract

Each retained member has one primary mode:

- `pure`: frozen read/projection, no shared mutation or registration;
- `additive`: owner-scoped entries/observers and identity-bound disposer;
- `ordered`: fixed priority/registration order and domain reducer/pipeline;
- `coordinated`: resource/scope/generation with CAS, fencing, or transaction as required;
- `exclusive`: preflight claim before side effects.

Mechanisms such as waterfall, latest-wins, or transaction are recorded as conflict/lifecycle rules, not as additional composition modes.

### Availability

```js
{
  capability: 'sessions.channels',
  status: 'active | degraded | unavailable',
  members: {
    open: { status: 'active', reason: undefined },
    resume: { status: 'unavailable', reason: '...' }
  }
}
```

Health is not embedded in capability status; health belongs to `diagnostics`. A runtime-specific unavailable member remains observable at its public path.

### Version Contract

```js
{
  packageVersion: '0.1.0-rc.6-0.1.0',
  runtime: '0.1.0-rc.6',
  api: '0.1',
  maintenance: 0,
  dshApi: '0.1'
}
```

Wire and durable records use independent records only where real boundaries exist:

```js
{
  schema: 'sessions.branch',
  version: 1,
  owner: 'derived owner',
  scope: { session: '...' },
  id: 'owner-local-id',
  data: {}
}
```

No durable record is rewritten solely because an in-process public path moved. If an actual reader compatibility need exists, its local decoder/upcaster stays next to that record; unknown future versions return `unsupported-schema`.

### Owner And Generation

- owner derives from the actual caller/plugin assembly context;
- caller-provided local IDs are only owner-local;
- machine association keys are owner-qualified automatically;
- user-visible global names use explicit conflict or claim behavior;
- generation is an owner-specific opaque token;
- owner-local revision is used only when the same owner needs ordering;
- stale disposer/callback is a typed no-op or stale result;
- generation is never compared across owners and never globally monotonic by facade convention.

### Terminal Outcome

Execution uses `outcome`; mutation uses `commitState`; resource lifecycle uses `lifecycleState`. The terminal vocabulary is:

```text
success | error | aborted | denied | superseded
```

`settled`, `closed`, `committed`, and `disposed` remain lifecycle words and are not substituted for terminal outcomes.

## Domain Composition Rules

### Events

`events.on` and `events.once` are observe-only by default. Canonical dispatch is available only to the producer authority recorded for that event. Custom events use `events.define` and an owner-scoped publisher handle. Ordinary listener order is fixed priority plus successful registration order, with the priority vocabulary `lowest`/`low`/`normal`/`high`/`highest`/`monitor` (see `docs/standards/refactor/ordering.md`); no global dependency graph is added.

### LLM

- `llm.requestTransforms.register` is owner-scoped and ordered; rewrite scope, priority, registration order, at-most-once, and convergence are explicit.
- `llm.admissionPolicies.register` uses a fixed decision algebra; deny/ask/allow is not determined by listener accident.
- `llm.adapters` forwards the existing replacement-owned decoration facet only when its component gates pass; the facade keeps no second decoration registry.
- `llm.routing` is the semantic route plane. Execution route, committed session route, policy, candidates, health and decisions have separate records and do not silently share mutation authority.
- Current sync `llm/request` re-entry via `llm/stream`, `llm.admissionPolicies` wrapping, and `llm.routing.forExecution` route capture remain facade translation unless an approved future component seam changes the capability decision.

### Agents, Executions, Sessions

- `agents` owns agent registry queries and creation/provider leaves; provider singleton behavior requires claim or official multiplexing.
- `executions` is projection-first; execution identity is plugin-generated and independent of event sequence; recovery consumption has one authority.
- `sessions` owns session read and append semantics; durable append remains finite and scope-bound.
- `sessions.branches` and `sessions.channels` have independent owners and identity/generation/CAS or fencing requirements.
- Direct session mutation that would bypass branch/channel guarantees is either routed through the owning authority or registered as an explicit bypass outside the default Composable Profile.

### Tools, Skills, Prompts

- tool names and discovery keys have explicit conflict semantics; execution carries scope and execution identity;
- static skill registry and session activation are separate authorities;
- prompt sections, context, variables and providers are additive with declared order;
- `prompts.provenance` projection and contribution/mapping registration are separate faces and cannot bypass prompt policy;
- raw official `services.*` methods are not combined manually to recreate a semantic invariant already owned by one of these domains.

### Attachments, MCP, Tasks, Coordination, Workspace

- attachment pipeline stages have owner, content identity, cleanup and cancellation;
- MCP catalog/lifecycle is read-only and generation-aware;
- tasks have task/attempt/resource identity, claim/fencing and one terminal outcome;
- coordination exposes resource key, owner, generation, fencing and backend availability without pretending process memory is durable;
- workspace transactions are the authority for guaranteed workspace mutation and list any supported bypass.

### Security, Diagnostics, Settings, Profiles, Remotes, Storage

- security reducers fail closed; supported egress paths must form authority closure;
- diagnostics reads health and availability but cannot mutate the diagnosed feature;
- settings namespace/key conflicts and document revision are explicit;
- profile reads are projections; writes use validation/CAS/claim where applicable;
- remotes use owner-scoped service keys and reject cross-owner same-key conflicts;
- storage is only a thin owner-scoped private binding over official storage domain services, with exactly one of `profile`, `workspace`, or `session` scope; it is never shared domain state, secret storage, or a transaction platform. Concrete thin-binding shape (spec revision 2026-08-28, Task 9.3):
  - `pluginApi.storage.open({ scope, owner, schema, version, name, tables, global })` — validates the owner/scope/schema envelope (scope ∈ `profile | workspace | session`, `owner`/`name` match the official unit-name grammar, `version` non-negative integer), namespaces the official unit name as `<scope>__<owner>__<name>` so cross-owner same-name conflicts cannot occur by construction, and delegates to the official storage domain facility with the plugin-supplied domain spec (including its zod table schemas) untouched — the facade itself carries no zod dependency;
  - typed results: `opened` + frozen handle `{ close, purge, domain }` on success; `invalid-input` for envelope violations before any facility call; official `version-mismatch` maps to `unsupported-schema` (unknown future version), `already-open` to `conflict`, `backend-not-found` to `backend-unavailable`, `facet-unsupported`/`invalid-record`/`malformed-medium` pass through, and other failures degrade to `unavailable` with the official discriminant preserved;
  - lifecycle: `handle.close()` closes the official domain without deleting data; `handle.purge()` is the explicit deletion operation (deletes every record across the domain's tables); facility unmount closes still-open domains without implicit purge;
  - availability: member-level; the binding is disabled (typed `storage` feature error) when the official storage domain facility is absent, without blocking any other mounter.

### Composable Profile

The default Composable Profile is the set of public members third-party plugins may rely on as safely composable without additional arbitration, covering pure queries, additive registrations, ordered transforms, and coordinated mutations with explicit claim as defined by `docs/standards/refactor/composition-and-authority.md` §3.

- A member SHALL enter the default Composable Profile only after its composition and authority audit records are complete in the registry; members with incomplete audits SHALL NOT be labelled `recommended` and SHALL NOT enter the profile. `status: 'recommended'` in a public member entry therefore implies profile membership.
- The profile boundary is a registry marker and a test/evidence fixture, not a runtime service; the composition matrix (see §Composition Matrix) exercises every applicable shared primitive inside the profile.
- Members outside the default profile remain available with their declared composition mode and conflict rules; explicit bypasses (for example direct session mutation outside branch/channel guarantees) are registered as such and are not silent.

## Error Handling And Lifecycle

### Host Apply

The existing fail-safe sequence is retained and reorganized around target domains:

1. read/validate manifest and runtime identity;
2. run core guard;
3. register or reuse inert `pluginApi` service;
4. run feature guards without publishing active surfaces;
5. construct owners and prepared transactions;
6. publish domain slices and activate internal feature state only after cleanup authority exists;
7. continue unrelated mounters after an isolated failure;
8. catch all apply-level failures and return normally.

No public member is considered active before its required owner, rollback/disposer, and capability state are committed.

### Typed Failure Precedence

1. inactive core: `PluginApiInactiveError`;
2. unavailable capability/member: typed capability-unavailable error/result;
3. conflict/owner conflict/claim conflict: stable conflict result/error;
4. denied, aborted, superseded, and stale: discriminated typed outcomes;
5. official call failure after successful passthrough construction: preserve official error identity unless the member contract explicitly normalizes it.

`undefined` is reserved for domain-defined legitimate absence, such as no committed route, and never means unavailable or conflict.

### Stale And Cancellation Handling

For async re-entry, remote mount, browser rebind, replacement apply/dispose, observers, leases, and background work:

- preserve the caller's `AbortSignal` identity and compose local cancellation only as an additional source;
- invalidate owner/generation before cleanup can run late callbacks;
- check owner, generation, terminal state, and resource possession before publishing or committing;
- do not start retries after `aborted`, `superseded`, or another terminal outcome;
- retain stale events only as bounded diagnostic/audit evidence, never as current progress;
- dispose only resources created by the current owner/generation.

### Replacement Failure

Existing replacement packages continue to validate:

- official row disabled;
- exactly one replacement row active;
- no component owner conflict;
- runtime identity exact match;
- critical service/event contract available;
- client half present when any of the six client checks applies.

Failure logs a bounded diagnostic and returns normally. It never silently runs both official and replacement rows. The main facade keeps unrelated capability slices active.

## Implementation Sequence

The Stage 4 tasks will follow this exact serial order:

1. **Freeze baseline and inventory:** apply the agreed package metadata baseline once, create the registry skeleton, enumerate host/client surfaces, and capture old-to-target mappings. No version bump follows.
2. **Build contract validation:** validate registry uniqueness/depth/metadata, generate neutral snapshots and the initial composition/services matrix, and add negative checks for governance-token leakage.
3. **Prepare and report deletions:** complete `deletion-report.md` for old roots, aliases, duplicate delegates, and other substantial removals; pause for explicit human approval before changing implementation or tests for those removals.
4. **Host namespace cutover:** reorganize `PluginApiService`, domain builders, disabled surfaces, capability query, and internal feature-to-domain bindings. Publish only target paths. Update host tests and docs in the same cutover.
5. **Client namespace cutover:** remove the public `.client` root, publish direct client members, move pure official leaves under `services.*`, rebuild the checked-in client bundle, and migrate the client consumer panel.
6. **Public surface minimization:** after the target tree is stable, delete approved non-retained members and service members, update snapshots/types/docs/tests, and verify runtime-specific unavailable paths remain present.
7. **Composition and authority hardening:** add only the minimum owner, scope, resource, generation, claim/preflight, reducer, CAS/fencing/transaction, redaction, and cancellation mechanisms required by the retained registry entries. Do not create global infrastructure.
8. **Consumer and installation reconciliation:** migrate both reference consumers, update manifests and requirement declarations, verify full/selective patch equivalence, reverse order, disable/uninstall restoration, runtime mismatch, and no double-running.
9. **Final verification and registration:** run the prescribed test suite and boot/smoke checks, synchronize feature registry/AGENTS/spec links, run the global review, then commit the complete Stage 4 delivery.

The sequence is serial. No parallel worktree is planned for M7 because `lib/index.js`, `lib/plugin-api-service.js`, public snapshots, package manifests, patch files, and consumer migration contracts are shared integration surfaces.

## Testing Strategy

### Pure Contract Tests

- registry schema, duplicate path/capability detection, domain depth, status vocabulary, and required-field validation;
- old-to-target mapping and negative assertion that old public paths are absent;
- capability snapshot and disabled-surface shape derived from the same registry;
- full version parsing, exact runtime match, API `B.C` negotiation, maintenance freeze, and unknown wire/durable version handling;
- governance-token scan for implementation and runtime-visible strings.

### Host Shape And Lifecycle Tests

- target namespace and public member cardinality;
- root/domain surface freezing and no writable live projection leakage;
- inactive core versus unavailable member versus conflict/stale typed outcomes;
- repeated apply, repeated disposal, owner isolation, stale disposer, replacement generation, rollback at every publication boundary, and unrelated-feature survival;
- events consumer/producer separation, priority/registration order, reducer behavior, callback containment, and no global ordering graph;
- LLM transform convergence, admission decision algebra, route authority identity, adapter topology isolation, and no second raw owner;
- session branch/channel scope, append provenance, durable schema handling, coordinated stale fencing/CAS, and terminal outcome uniqueness;
- services static whitelist, member-level availability, official receiver/argument/return/error preservation, and exclusion of runtime-discovered members.

### Client Tests

- direct `ctx.pluginApi` root with no public `.client` member;
- host/client domain vocabulary and separate host/client types;
- remote, slot, settings, lifecycle, reconnect/HMR, owner-local generation, stale cleanup, and callback failure;
- host redaction before serialization and client codec shape validation;
- checked-in bundle shape, manifest, module-loader identity, and no client pending failure;
- pure official client leaves are exposed only through declared `services.*` entries.

### Composition Matrix

At least two synthetic plugins must exercise each applicable shared primitive:

- reverse registration order;
- same key conflict and deterministic claim rejection;
- owner and scope isolation;
- repeated registration, missing disposal, stale disposer/generation;
- callback throw/rejection and shared async pipeline failure;
- ordered reducer repeatability and explicit order dependence;
- coordinated stale fencing/CAS/transaction behavior;
- exclusive preflight before side effects;
- authority closure and explicit bypasses;
- pure view inability to mutate shared state.

The same matrix applies to client slot/remote/settings/lifecycle primitives where applicable.

### Consumer And Boot Acceptance

- `dsh-read-image`: no migrated private request/route hack remains; facade paths use the target domain tree; message/image/route absence behavior remains correct.
- `dsh-pro-ex-ability-anchor`: append, prompt, remote, services, and panel client use target paths; removed hand-authored protocol glue does not remain as dormant fallback.
- full bundle equals main plus all auxiliary packages in rows, behavior, and failure semantics;
- selective main-only install leaves optional capabilities explicitly unavailable;
- mismatched auxiliary version disables only that capability and never leaves an official row disabled without a functioning replacement;
- removing the installation restores official rows;
- reverse supported plugin order is deterministic;
- prescribed `npm test`, `git diff --check`, official-package modification audit, headless smoke, and dev boot pass.

## Standards Applicability And Alignment

| Standard | Applicability | Design alignment |
|---|---|---|
| `refactor/public-api-shape.md` | Applicable | Domain-first host/client tree, plural resources, no aliases, capability path/event name separation, static services boundary, contract registry. |
| `refactor/composition-and-authority.md` | Applicable | Five composition modes, owner-derived identity, claims/preflight, authority closure, producer gating, callback containment, typed failure vocabulary. |
| `refactor/domain-composition.md` | Applicable | Domain-specific owner, reducer, scope, resource, conflict and lifecycle rules are defined above; pure passthroughs stay in services. |
| `refactor/capability-and-services.md` | Applicable | Admission/retirement, post-namespace subtraction, member-level services classification, runtime-specific unavailable behavior, no automatic absorption. |
| `refactor/versioning-and-protocols.md` | Applicable | Full package version parsing, frozen M7 baseline, API-only plugin negotiation, independent wire/durable revisions, full/selective equivalence. |
| `refactor/plugin-state-and-lifecycle.md` | Applicable | Thin owner-scoped storage only, profile/workspace/session scopes, schema envelope, handle close without implicit purge. |
| `refactor/ordering.md` | Applicable | Fixed priority plus registration order for ordinary events; domain reducers for policy; no global dependency graph. |
| `refactor/sdk-and-conformance.md` | Not currently applicable | No SDK or conformance kit is designed or implemented; registry and tests remain reusable evidence for future evaluation. |
| `capability-strategy.md` | Applicable | A/B/C/R channel decisions, facade default, existing replacement boundary, R self-checks, no framework-level R, no official file patch. |
| `api-shape.md` | Applicable | Projection/policy/mutation separation, one primary face, one-way data flow, private shared primitives only. |
| `identity-and-lifecycle.md` | Applicable | Independent execution identity, owner-specific opaque generation, owner-local revision, final terminal outcomes. |
| `durable-state-and-scope.md` | Applicable | Single scope per record, operation capability, retry/attempt split, fail-closed mutation, local decoder only. |
| `visibility-and-redaction.md` | Applicable | Minimum exposure, secret policy, diagnostic provenance, host-first redaction, browser-half narrower visibility. |
| `concurrency-and-cancellation.md` | Applicable | Signal propagation, commit eligibility, stale-result guard, disposer ownership, replacement/client lifecycle and retry boundaries. |

> 本表仅声明各分册的适用性与对齐结论；具体设计内容在各对应章节体现。

## Key Decisions And Tradeoffs

1. **One public cutover, retained internal mounters.** This removes compatibility debt without forcing an unnecessary rewrite of every mature owner implementation. The registry-to-domain binding is the boundary that prevents internal names from leaking back into public paths.
2. **Spec-local machine-readable registry, not runtime platform.** It provides one source for shape and evidence while avoiding a new generic registry service, migration framework, or permission layer.
3. **Host first, client second.** Host semantic paths and capability availability define the contract; the client then adopts the same vocabulary and moves official browser-only faces to services.
4. **Subtraction after structural migration.** This preserves enough context to decide whether a member is redundant, unsupported, or merely runtime-unavailable. Deletions still require the explicit human report gate.
5. **Freeze the agreed version baseline for the whole M7.** This makes all intermediate local artifacts part of one pre-release contract and prevents implementation batches from inventing additional version boundaries.
6. **No universal composition machinery.** Each member receives only its actual mode's minimum mechanism; ordering, claims, coordinated mutation, and pure projection are not collapsed into one generic abstraction.

## Design Completion Condition

Stage 2 is complete only after the user explicitly approves this Design. Stage 3 may then convert this architecture into dependency-ordered coding tasks. No implementation file, package metadata, test code, deletion report, or generated registry is created as part of this Design stage.
