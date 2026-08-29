# Requirements: plugin-api-host-remote-m4

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.remote`（`publish/isActive`） | `pluginApi.remotes`（叶子名不变） |
> | `ctx.pluginApi.client.*`（client 根） | `ctx.pluginApi` 直接根成员（已无 `.client` 子命名空间） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

> feature_name: `plugin-api-host-remote-m4`
> 状态：Stage 1 草案（待对抗性审查与用户批准）
> 上游：Stage 0 Goal（已批准）、`AGENTS.md` §2/§4/§6、`docs/specs/plugin-api-features/feature-list.md` §2.8（ST4 `settings.remote`）与 §3.1（`typert-gateway` R 类观察项）、`docs/standards/capability-strategy.md`（R 类登记与观察项）、`docs/specs/plugin-api-settings-remote-m3/`（ST4 既有绑定/回滚实现）、`dsh-pro-ex-ability-anchor/lib/config-remote.js` 与 `lib/index.js`（当前手工桥接路径）
> 类型：B 类（门面转译；官方 `bindTypertRemote` / `ctx.reflect.provide` 为公开原语，门面负责稳定封装）；host-only，无 client bundle。

---

## Introduction

`pluginApi.settings.remote`（ST4，M3 delivered）只覆盖**官方 settings 命名空间**：它要求服务即“settings 命名空间”，并把 `get`/`set` 的语义硬编码进门面。凡是有**自己持久化语义**的插件（自定义磁盘配置店、运行时状态、健康端点），web client 想读/写就得**每插件重写一遍** dsh-read-image A3 / pro-ex `lib/config-remote.js` 同款桥接代码：

```js
// dsh-pro-ex-ability-anchor/lib/config-remote.js（95 行，当前社区重复度最高的 hack）
class ExtraproAnchorConfigService extends TypertRemoteService {          // 手搓子类
  constructor(ctx) { super(ctx, 'extraproAnchorConfig'); markRemote(...) } // 手搓 @Remote marker
  async get() { return { value: store.snapshot(), host } }
  async set(settings) { /* wire 参数名必须与 client descriptor 逐字一致 */ }
}
ctx.plugin(createExtraproAnchorConfigBridge(typertProtocol, store, { platform, gitBashInstalled })) // 手搓装配
```

这段代码的 wire 约束最隐晦：**方法参数名即 wire 名**（gateway 用 `Function.prototype.toString` 派生 endpoint 参数名，见下 §3.3）。

本 feature 在 host 侧提供**通用 Typert Remote 服务发布入口** `pluginApi.remote.publish(serviceKey, service)`（形状本 Stage 定稿，§1），使**任意 JSON-safe 的配置/状态服务**都能以官方认可的 remote 形式发布给 Web client，而无需每个插件手搓 `@Remote` marker、`TypertRemoteService` 子类与 `ctx.plugin` 装配。

门面只消费官方公开协议原语（`isTypertRemoteSegment`、`bindTypertRemote`、`Remote`、`remoteMethods`，均出自 `@deepseek-ai/dsh-typert-protocol` 公开导出）与公开装配点 `ctx.reflect.provide`，把 ST4 已验证的绑定 + 回滚 + 稳定 disposer 语义**泛化复用**；同时保持 `settings.remote`（ST4）与新的 `remote.publish` 各自 owner 语义完全独立（§5.6）。client 侧继续复用 M3 已交付的 C2/ST5 `mountRemote` 消费面，**不新增**动态发现语义（`remote.<ns>` 原生发现仍为 C7 上游提案）。

官方机制事实（源码出处，B 类判定依据）：官方 `dsh-api-gateway` 以 **source-mode 自动发现**任何 Cordis service —— 遍历 `ctx.reflect.props` 的 `type: 'service'` 条目，取 `ctx.get(serviceKey)` 的 `original`，读其可见 `typertRemote` binding，再读 `remoteMethods(original)` 的 marker 集合成 endpoint claim（`dsh-api-gateway/lib/index.js:75-88,143-156`）。因此只要发布的服务带 `typertRemote` binding + `Remote` marker + 经 `ctx.reflect.provide` 注册为 Cordis service，gateway 即自动发现，无需改 `dsh-api-remotes` 任何硬编码。

**形状（Stage 1 定稿）**：`pluginApi.remote.publish(serviceKey: string, service: object): () => boolean` —— 返回一个 owner 作用域、幂等、stale-safe 的 publication disposer；`serviceKey` 同时充当 Cordis service key 与默认 wire namespace；`service` 为社区作者提供的普通对象，其**公开方法即 remote endpoint**。

---

## 1. `pluginApi.remote.publish` 表面形状（Stage 1 定稿）

**User Story**: As a community host plugin author, I want one stable host-side call `pluginApi.remote.publish(serviceKey, service)` that publishes my own JSON-safe config/state service to the web client through the official Typert gateway, so that I do not hand-roll `@Remote` markers, a `TypertRemoteService` subclass, or `ctx.plugin` assembly.

**Acceptance Criteria**

1.1. WHEN the `remote` feature is active AND a plugin calls `pluginApi.remote.publish(serviceKey, service)` THEN the facade SHALL return a publication disposer function and the call SHALL NOT throw for a valid publication. （B）

1.2. WHEN the call provides `serviceKey` THEN it SHALL be used as both the Cordis service key and the default wire namespace, AND SHALL be validated against the official Typert remote-segment grammar（`isTypertRemoteSegment`）; an invalid key SHALL be rejected with a facade-typed error before any registration. （B）

1.3. WHEN the call provides `service` THEN it SHALL be validated as a publishable service shape（§3）; a malformed service SHALL be rejected with a facade-typed error before any registration. （B）

1.4. WHEN the feature is mounted THEN its public placement SHALL be a new top-level host namespace `pluginApi.remote` exposing `isActive` and `publish`, justified by the feature-list 命名空间安置规则（header block，经 `plugin-api-m1-integration` 确立：**带门面附加语义的 feature 自建顶层命名空间**——本 feature 有校验/绑定/disposer 门面语义，非 1:1 纯直通，故不落入 `pluginApi.services.*` 的纯直通安置）; no member SHALL collide with an existing `pluginApi` name（`settings.remote` 仍属 settings 子面、`client.remote` 为 client bundle 面，均不同 owner）. （B + 门面基础）

1.5. GIVEN the same owner calls `publish` again with an identical `serviceKey` AND an identical（reference-equal）`service` THEN the facade SHALL return the existing publication disposer without duplicating the Typert binding, marker, or provider registration（幂等同键）. （B）

1.6. GIVEN the same owner calls `publish` with the same `serviceKey` but a different `service` object THEN the facade SHALL throw a facade-typed duplicate error and SHALL leave the existing owner unchanged. （B）

**Type**: B（消费官方公开原语做稳定封装；AC 1.4 为门面基础命名空间安置，AC 1.5–1.6 为 owner 幂等/冲突契约）

---

## 2. 绑定、标记与注册（官方公开原语）

**User Story**: As a repository maintainer, I want the published service to be registered exclusively through official public primitives, so that the official gateway discovers it as-is and no official package file or private symbol is touched.

**Acceptance Criteria**

2.1. WHEN `publish` runs the binding step THEN it SHALL create one binding with the official `bindTypertRemote(service, serviceKey)`（本形状无独立 namespace 参数，wire namespace 恒等于 `serviceKey`，即官方 `options.namespace ?? serviceKey` 的缺省语义），SHALL verify the returned binding shape（`service` 指向传入对象、`serviceKey`/`namespace` 匹配）, and SHALL expose it as the service's visible `typertRemote` property. （B）

2.2. WHEN the binding step succeeds THEN the facade SHALL mark every published public method with the official `Remote` marker（具体 marking 机制为 design 决策，ST4 已有等价实现可复用；Node 无 decorator 语法环境亦须可用）, SHALL verify via official `remoteMethods(service)` that exactly the declared method set is present, and SHALL fail before registration if the marker set is missing or malformed; the marker snapshot order SHALL be deterministic per publication（marker 表按原型 Map 插入序返回）. （B）

2.3. WHEN marker validation succeeds THEN the facade SHALL register the service with the official `ctx.reflect.provide(serviceKey, service)` AND SHALL require the returned disposer to be a function; a missing/undisposable provider SHALL be treated as a publication failure（§4.4）. （B）

2.4. WHEN markers are attached THEN the marker table（official `Remote` private state, keyed by prototype）SHALL be attached to a prototype dedicated to this publication, NEVER `Object.prototype` or any shared/foreign prototype（防 marker 泄漏到每个无关 plain object，同 ST4 设计）; a test SHALL lock the no-cross-object-leak invariant. （B + 硬约束）

2.5. GIVEN the publication committed（binding + markers + `ctx.reflect.provide`）WHEN the official gateway runs source-mode discovery for `serviceKey`/namespace THEN the service SHALL be discoverable and its published methods SHALL be callable through the official gateway（无需修改 `dsh-api-remotes` 任何硬编码）.（B）

**Type**: B（全部落在官方公开原语上；AC 2.4 为 marker 隔离硬约束，AC 2.5 为端到端可发现性验收）

---

## 3. service 形状校验与 JSON-safe / wire 契约

**User Story**: As a community author, I want the facade to fail early on a malformed service and to preserve the implicit "method parameter name is the wire name" contract, so that a published endpoint never silently breaks at call time.

**Acceptance Criteria**

3.1. WHEN `service` is a non-plain-object, `null`, an array, or an object exposing NO callable method THEN the facade SHALL reject it with a facade-typed error before any registration; a service exposing at least one callable method SHALL be accepted as a candidate. （B）

3.2. WHEN a service method name does not satisfy the official Typert remote-segment grammar（`isTypertRemoteSegment`）THEN the facade SHALL reject the publication before registration. （B）

3.3. WHEN a published method is declared with a parameter list that the official gateway cannot derive — destructuring, default values, rest parameters, or duplicated/non-identifier parameter names — THEN the facade SHALL reject the publication before registration（官方 gateway 会在调用期以 `signature-invalid` 拒绝此类签名——`methodParameterNames` 于 descriptor 解析/调用时解析方法签名，`dsh-api-gateway/lib/index.js:299-329`；门面在注册前提前 fail-closed 是本 feature 的稳定化价值）; otherwise the facade SHALL preserve each business parameter's exact name as the wire name（SHALL NOT rename, alias, or reorder them）. （B）

3.4. WHEN a published method's ARGUMENT is not JSON-safe（cycles、functions、`undefined`、`bigint`、non-finite numbers、class instances、host objects、non-string keys）THEN the invocation SHALL fail at the official boundary BEFORE the business method runs（参数解码先于方法调用）, the service's own state SHALL NOT be mutated, and the gateway and other endpoints SHALL remain unaffected. （B）

3.4b. WHEN a published method's RESULT is not JSON-safe THEN the invocation SHALL fail at the official boundary AFTER the method body has run（结果解码在方法调用之后）; the facade SHALL NOT promise rollback of business-side effects（transactional semantics 由调用方方法自身负责，AC 3.6）, the failure SHALL be contained, and the gateway and other endpoints SHALL remain unaffected. （B）

3.5. WHEN a published method declares an optional trailing `signal` parameter THEN the facade SHALL preserve it as the official gateway cancellation parameter（not a business wire argument）；if `signal` appears in a non-final position the facade SHALL reject the publication before registration（官方 gateway 在调用期要求 `signal` 为最末参数——`SRC cancellation parameter signal must be the final parameter`，`dsh-api-gateway/lib/index.js:162-165`；门面提前 fail-closed）. （B）

3.6. WHEN this feature is delivered THEN the facade SHALL NOT re-implement or intercept the service's business semantics beyond the JSON-safe boundary and signature validation: the caller's method bodies SHALL remain the single source of truth for read/write behavior. （B）

3.7. GIVEN the supplied `service` is a plain object literal（prototype === `Object.prototype`）or any object whose prototype is a shared/foreign prototype WHEN the facade publishes it THEN it SHALL attach the official `Remote` markers ONLY to a prototype dedicated to this publication（re-home the plain object's methods onto that dedicated prototype before marking, or equivalent）, SHALL NOT mutate `Object.prototype` or any foreign/shared prototype, and SHALL preserve each method's wire-visible identity and parameter names through the re-homing（满足 AC 2.4 隔离不变量与 AC 3.1 接受形状的联合契约；具体 re-homing 机制为 design 决策）. （B + 硬约束）

**Type**: B（wire 契约完全对齐官方 source-mode descriptor 派生；JSON-safety 为边界行为契约，实现机制（是否包装方法）为 design 决策）

---

## 4. fail-safe 失败路径（duplicate / stale disposer / 协议缺失 / 回滚）

**User Story**: As a repository maintainer, I want duplicate/service-collisions, stale disposers, missing protocol, and mid-publication failures to be unified fail-safe with typed errors, never escaping host `apply`.

**Acceptance Criteria**

4.1. GIVEN an active owner already exists for `serviceKey`（本 feature 或共享同键的 ST4 `settings.remote`）WHEN `publish` is called with a different service/owner THEN the facade SHALL throw a facade-typed conflict error and SHALL NOT replace, disable, or otherwise alter the existing owner（同行冲突）; AC 1.5's identical-case idempotence SHALL remain the only same-key non-throw path. （B）

4.1b. WHEN `publish` must decide whether a same-key active owner exists THEN the facade SHALL detect it through a READ-ONLY probe of the official service registry（e.g. guarded `ctx.get(serviceKey)` / `ctx.reflect.props`, the same registry the official gateway sources claims from）without writing the provider and WITHOUT coupling the shared binding/rollback helper's owner maps between `settingsRemote` and `remote`（与 AC 5.6 的各自 owner 语义相容）; the probe SHALL treat an unresolved probe as "no existing owner"（fail-open for absence, fail-closed for a live conflicting owner）. （B + 机制）

4.2. WHEN the returned publication disposer runs more than once THEN each additional run SHALL be a no-op（幂等）and SHALL return a stable boolean. （B）

4.3. GIVEN a later provider replaced the same `serviceKey`（e.g. disposer ran, then another publication took the key）WHEN the earlier owner's disposer runs after the replacement THEN it SHALL NOT unregister or disable the later provider（stale disposer protection，identity/epoch-guard，同 ST4）.（B）

4.4. WHEN any step of the publish sequence（binding → marker validation → `ctx.reflect.provide`）fails after a partial registration THEN the facade SHALL roll back only its own completed registrations in reverse order, SHALL log a contained diagnostic with the host feature boundary, and SHALL NOT throw through host `apply`（失败只记录日志并安静停用）. （B + fail-safe 硬约束）

4.5. GIVEN the official typert protocol（`bindTypertRemote`/`Remote`/`remoteMethods`/`isTypertRemoteSegment`/`TypertRemoteService`）or `ctx.reflect.provide` is missing or malformed WHEN the `remote` feature is mounted THEN it SHALL fail closed as P2（`pluginApi.remote.isActive === false`，`publish` 抛 `PluginApiFeatureDisabledError('remote')`) and SHALL leave unrelated features — including `settingsRemote`, `settings`, and the rest of the host facade — operating; it SHALL NOT monkey-patch any official file. （B + P2 失败呈现）

4.6. WHEN this feature's `apply` runs THEN it SHALL always return normally（fail-safe）；no failure in guard probing, validation, registration, or disposal SHALL propagate an exception out of `apply`. （门面基础）

**Type**: B + 门面基础（P1/P2 失败呈现沿用既有词汇；此处 P2 为协议/原语缺失，P1 为 core inactive 既有语义）

---

## 5. 范围边界与非目标

**User Story**: As a repository maintainer, I want crystal-clear boundaries so that this generic publish entry never becomes a client API, a C7 discovery, an R-class replacement, or an override of ST4.

**Acceptance Criteria**

5.1. WHEN this feature is delivered THEN it SHALL be host-only: it SHALL add no client bundle, no `pluginApi.client` member, and no change to the client consumption path; web clients SHALL continue to consume published services through the delivered ST5/C2 `mountRemote` face with their own hand-written contribution descriptors（如 pro-ex panel 现状）. （非目标）

5.2. WHEN this feature is delivered THEN it SHALL NOT implement client-side native `remote.<namespace>` dynamic discovery（U6/C7 仍为上游提案，不改 `dsh-api-remotes` 硬编码）. （非目标）

5.3. WHEN this feature is delivered THEN it SHALL NOT register any R-class replacement：the `typert-gateway`（396 行）and typert-related official rows SHALL remain R-class **observation items** in `docs/standards/capability-strategy.md`（ST4 观察项状态保持不变）; B 类门面转译 SHALL remain the delivery channel. （硬约束）

5.4. WHEN this feature is delivered THEN it SHALL NOT override, shadow, or extend `pluginApi.settings.remote`（ST4）; the settings namespace remains the settings-specific owner, and this feature adds the generic `pluginApi.remote` sibling. （硬约束）

5.5. WHEN this feature consumes official capabilities THEN it SHALL consume only official PUBLIC exports（`isTypertRemoteSegment`/`bindTypertRemote`/`Remote`/`remoteMethods` from `@deepseek-ai/dsh-typert-protocol`、`ctx.reflect.provide`）and SHALL NOT import official module-private symbols or modify any official package file. （硬约束）

5.6. WHEN this feature shares binding/rollback implementation with ST4（既有绑定/回滚实现）THEN the shared helper SHALL be parameterized by owner identity so that `settingsRemote` and the new `remote` feature each keep their OWN owner map, disposer identity, duplicate detection, feature guard, and P2 fail-closed surface; sharing SHALL NOT couple their owner semantics. （硬约束）

5.7. WHEN this feature is delivered THEN it SHALL add no new error category beyond the facade-typed errors needed for its own validation/conflict/disability paths（沿用 `PluginApiError` 家族，precise classes 为 design 决策）; it SHALL NOT create a new top-level feature outside `pluginApi.remote`（无新 guard schema 词汇、无新 catalog slice、无合成 Cordis 事件）. （工程约束）

**Type**: 硬约束 / 工程与治理约束

---

## 6. 治理与登记（交付动作）

**User Story**: As a repository maintainer, I want this feature registered in the canonical governance surfaces at delivery time, so that no registry goes stale（AGENTS.md §8 防过期规则）.

**Acceptance Criteria**

6.1. WHEN this feature is delivered THEN the feature-list SHALL add one item under §2.8 或新增 `pluginApi.remote` 小节（拟行号 `RB1 通用 Typert Remote host 发布`，最终编号以 feature-list 登记为准），type 标注 `B`，milestone `M4`，status `delivered`，并附官方源码出处。 （Governance）

6.2. WHEN this feature is delivered THEN the feature-list §4 迁移验收表 SHALL add one row for `dsh-pro-ex-ability-anchor` 的 `lib/config-remote.js`（95 行）→ `pluginApi.remote.publish('extraproAnchorConfig', …)`（see §7）. （Governance）

6.3. WHEN this feature is delivered THEN the delivered-feature registry in AGENTS.md §8 SHALL append one entry for `plugin-api-host-remote-m4`（范围 / 状态 / spec 目录 / 关键约束），and the corresponding feature-list status SHALL be kept consistent. （Governance）

6.4. WHEN this feature is delivered THEN its API 协议版本号 SHALL NOT be bumped by this feature alone；任何 minor 升级 SHALL 由 M4 integration 统一定界并记录（并行 `plugin-api-compaction-events-r1` 已规划承接 `0.1.0-rc.6-0.4` / `dsh.api` `0.4`；本 feature 不提前断言版本，最终 boundary 以 M4 integration 批准记录为准）. （Governance）

**Type**: Governance

---

## 7. dsh-pro-ex-ability-anchor 迁移验收证据（非目的）

**User Story**: As a community author of a custom-persisted service, I want proof that the generic publish entry is directly reusable, demonstrated by the existing hand-rolled `lib/config-remote.js`（95 行）being deleted in favor of `pluginApi.remote.publish(...)` with the panel's read/write surviving.

**Acceptance Criteria**

7.1. GIVEN `dsh-pro-ex-ability-anchor` is migrated WHEN its `lib/config-remote.js`（95 行）is deleted and the `ctx.plugin(createExtraproAnchorConfigBridge(...))` block（`lib/index.js`）is replaced by one `pluginApi.remote.publish('extraproAnchorConfig', service)` call THEN the panel's read/write SHALL be preserved: `get` returns the `{ value: store.snapshot(), host }` JSON-safe snapshot, `set` persists one full settings document atomically（内含 `store.update` 校验）, and the `settings` parameter name stays the wire name（panel 的 `{ name: "settings", wire: "settings" }` contribution 不变）. （验收证据）

7.2. GIVEN `dsh-pro-ex-ability-anchor` is migrated per AC 7.1 WHEN its headless smoke, dev boot, and panel checks run THEN they SHALL pass with no loss of panel save/read behavior.【非目的】：该 migration 是验收证据、不是本 feature 的实现目标；其执行按获批 Tasks 进行。 （验收证据）

7.3. WHEN the migration per AC 7.1 cannot be completed within this feature's delivery window THEN the deleted-file evidence SHALL be waived only with an explicit record in the delivery report explaining why（e.g. consumer repo unavailable）; the wire/JSON-safe contract（§2–§3）SHALL remain fully locked by this repo's own tests regardless. （验收证据）

**Type**: B 验收证据（非本 feature 的目的）

---

## 8. 需求覆盖检查

| Stage 0 Goal 关键承诺 | 覆盖需求 |
|---|---|
| 门面提供 host 侧发布原语：校验 serviceKey/service 形状 → 官方 `bindTypertRemote` → `ctx.reflect.provide` → 返回稳定 disposer | §1（1.1–1.3）、§2（2.1–2.3）、§3（3.1–3.7） |
| duplicate/同行冲突、stale disposer、协议缺失统一 fail-safe + typed error，不抛穿 apply | §4（4.1–4.1b, 4.2–4.6）+ §1（1.5–1.6） |
| client 侧继续复用已 delivered 的 ST5/C2 消费，不新增动态发现语义（C7 仍为上游提案） | §5（5.1–5.2） |
| 不 R 化 `typert-gateway` 行（保持 capability-strategy 观察项状态） | §5（5.3） |
| 只消费官方公开协议 API、不 import 官方私有模块、不覆盖 `settings.remote`、不修改官方包文件 | §5（5.4–5.5）、§2（2.1–2.3、2.5） |
| 与 ST4 共享既有绑定/回滚实现时保持两个 API 各自 owner 语义 | §5（5.6）、§4（4.1） |
| 方法参数名即 wire 名（社区最隐晦约束）提前显式化 | §3（3.3、3.5） |
| JSON-safe 边界契约 | §3（3.4） |
| 验收证据：pro-ex 删除 `lib/config-remote.js`（95 行）并迁移面板读写 | §7（7.1–7.3） |
| 登记与文档新鲜度 | §6（6.1–6.4） |

> 非目标（与 AGENTS.md §6 一致，本 spec 不实现）：不做客户端 `remote.<ns>` 原生动态发现（U6/C7）；不把"任意服务发布"做成 R 类；不提供 client 侧新 API；不新增合成 Cordis 事件 / catalog slice；不 patch 官方包。
