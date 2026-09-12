# Stage 1 - Requirements

> feature_name: `llm-adapter-registration`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12；requirements 与 design 同批产出，承接已确认 goal.md）
> 输入溯源：goal.md（2026-09-12 批量确认）；M10 工作纲领 §3.2 / §4.1；观察报告 §5（adapter/decoration 语义碰撞，含消费者锚点）；M8 migration ledger 第 41–43 行（rename/split 记录）；canonical registry `llm.adapters.register`（currentShape 为 decoration registration）、`llm.providers.register`、`llm.models.register` 现行登记；`packages/llm` replacement owner 现状（decoration registry 不创建 synthetic adapter）。

## Status

Stage 1 与 Stage 2 同批交付（2026-09-12）。本文把注册/查询/冲突/装饰分离/在途生命周期写成 EARS；公共 path 采用 Design 同批确定的拆分方案（`llm.adapters.register` 归真实登记、装饰迁至 `llm.adapters.decorations.*`），集成波以 canonical registry 修订为准。版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Introduction

本 feature 把「登记新的可调用 adapter/provider route」与「装饰既有 adapter」在门面内彻底分开：真实 adapter 登记是 resourceRegistry（登记可调用的模型路由与调用实现），模型目录是独立只读 projection，decoration 保留独立 registry 身份。四种动作——configurable provider 登记、model discovery、adapter 登记、decoration——在 API 树上各有可辨认的归属，不因「都叫 register」混在一起。实现通道优先稳定适配官方 `registerAdapter` 的真实登记动作（A 类），复用既有 llm replacement owner，不新建第二个 llm owner。

## Requirement 1: 真实 adapter 路由登记

**User Story:** 作为 vision-toolkit 类插件的作者，我想在门面内登记一个新的可调用 adapter/provider route（含真实调用实现），使我注册的图片变体成为模型选择器中的独立可选路由。

### Acceptance Criteria

1. WHEN a plugin calls `pluginApi.llm.adapters.register(spec)` with a spec declaring a route identity (provider id + model entries), real model capabilities, and a callable stream implementation as a plain object THEN the system SHALL register a callable adapter route through the official adapter registration action, and SHALL return the registry handle `{ id, ownerId, generation, dispose() }`.
2. WHEN the spec supplies the stream implementation THEN the system SHALL accept a plain object/function contract and SHALL NOT require the implementation to extend any SDK base class or import any official internal module.
3. WHEN a registered adapter route is selected for a model call THEN the registered stream implementation SHALL be the backend actually invoked for that call (从登记到真实调用全链路), and the stream chunks SHALL conform to the official stream chunk contract.
4. WHEN the official adapter registration seam is unavailable (llm 行未激活或版本错配) THEN registration SHALL return the typed `unavailable` result, and the facade SHALL NOT simulate registration through decoration or directory entries.
5. WHEN a registered route is exercised THEN the registration SHALL NOT mutate official model truth values (官方模型真值不被伪造或改写).

**Classification:** A 类稳定化（官方 registerAdapter 已存在，门面绑定其真实登记动作）；条目 4 为 fail-safe 边界。

## Requirement 2: 模型目录与选择投影可见性

**User Story:** 作为插件作者，我想让模型查询与选择器看到我注册的 provider/model/capability，同时原始官方模型仍然存在。

### Acceptance Criteria

1. WHEN a plugin registers an adapter route THEN the model catalog projection `pluginApi.llm.models.list()` SHALL include the registered provider and its models with the declared capability fields (真实 capability 投影), merged after (and without mutating) the official provider/model directory.
2. WHEN an image variant is registered as an independent route THEN the catalog SHALL present it as a selectable independent entry AND the original model SHALL remain present and selectable (普通模型与图片变体并存).
3. WHEN a capability field is not a real capability of the registered route (for example an overlay label) THEN the projection SHALL NOT present it as a native official model truth field: label overlay SHALL remain label metadata and SHALL NOT be reported as native `inputModality` or any other official capability value.
4. WHEN the official directory changes (discovery results, configurable provider updates) THEN the projection SHALL reflect the merged current state on each read (frozen snapshot), and reads SHALL be pure and side-effect free.
5. WHEN any caller uses `services.llm.listProviders` / `services.llm.listModels` THEN those official passthrough members SHALL keep their official shapes and SHALL NOT be merged with facade-registered routes (官方直通与门面投影不混写).

**Classification:** A 类稳定化（官方目录 + 登记投影合并）；条目 3 为真值边界（不伪造官方模型真值）。

## Requirement 3: 冲突、幂等、原子替换与撤销

**User Story:** 作为插件作者，我要求重复登记、内容冲突、跨 owner 冲突、原子替换与撤销各有确定结果。

### Acceptance Criteria

1. WHEN the same owner re-registers the same route id with content-equivalent spec THEN the system SHALL idempotently return the existing entry's handle without creating a duplicate.
2. WHEN the same owner re-registers the same route id with different content THEN the system SHALL return a typed `conflict` result and SHALL NOT partially apply the new content.
3. WHEN a different owner registers a route id already owned by another owner THEN the system SHALL return a typed owner-conflict result and SHALL NOT silently overwrite or namespace-mangle the user-visible route identity.
4. WHEN the same owner performs an explicit replacement with the expected current generation supplied THEN the system SHALL atomically swap the registration in one operation (atomic replace), and a mismatched expected generation SHALL return a typed stale/conflict result without swapping.
5. WHEN a handle is disposed THEN the route SHALL be revoked from future selection and the catalog projection SHALL stop listing it; disposal SHALL be idempotent and a stale disposer SHALL be a typed no-op that does not revoke another owner's or a newer generation's registration.

**Classification:** A 类稳定化；遵循 `api-idioms.md` §3.6 resourceRegistry 冲突规则 + 显式 CAS 式替换（`composition-and-authority.md` §2 coordinated 语义的最小机制）。

## Requirement 4: 登记与查询一致性

**User Story:** 作为维护者，我要求列表变化与实际可调用状态一致，不出现「列表有、调用无」或反向的漂移。

### Acceptance Criteria

1. WHEN a registration, replacement, or revocation completes THEN the catalog projection and the adapter query face (`llm.adapters.list` 的真实 adapter 语义，见 Design) SHALL reflect the new state for all subsequent reads.
2. WHEN the official topology reports adapter changes THEN the official change event (`llm/adapters-updated`) SHALL remain the producer's fact; the facade SHALL NOT emit a second synthetic change event for the same topology commit.
3. WHEN a listed route's backing is not actually callable (registration seam degraded mid-flight) THEN the projection SHALL mark that entry's availability honestly rather than listing it as fully active.

**Classification:** A 类稳定化；条目 2 沿用 decoration registry 已有约束（不重复发官方事实事件）。

## Requirement 5: 装饰与登记分离

**User Story:** 作为维护者，我要求装饰器可以绑定新 adapter，但不拥有 adapter 路由；两个 registry 的卸载与 generation 互不牵连。

### Acceptance Criteria

1. WHEN a plugin decorates an adapter binding (including a newly registered adapter route) THEN decoration SHALL continue to be registered through the decoration registry's own entry (拆分后为 `llm.adapters.decorations.register`，见 Design) and SHALL NOT be reachable through the real-adapter registration entry.
2. WHEN a real adapter registration is revoked or replaced THEN decorations bound to it SHALL follow the decoration registry's own binding lifecycle (superseded/revoked per its existing contract), and the decoration owners' handles SHALL NOT be torn down by the adapter registration's disposer.
3. WHEN a decoration is disposed THEN the underlying adapter route SHALL remain registered and callable.
4. WHEN the two registries assign generation tokens THEN each registry SHALL maintain its own owner-specific generation namespace, and one registry's generation SHALL NOT be comparable to or invalidated by the other's.
5. WHEN both actions are performed by the same plugin THEN the plugin SHALL observe two independent handles with independent lifecycles (decorate + route replace + dispose 交叉执行正确).

**Classification:** A 类稳定化（decoration registry 已交付，保留独立身份）；本条为边界合同而非新机制。

## Requirement 6: 替换/卸载时的在途处置

**User Story:** 作为插件作者，我要求替换或卸载 adapter 时，在途流、prepared call、取消与旧 handle 按官方及门面合同处理。

### Acceptance Criteria

1. WHEN a route is revoked or replaced while a stream from its previous implementation is in flight THEN the in-flight stream SHALL be allowed to run to its natural completion under its existing cancellation and commit rules (停止努力不等于正确性保证), and the revocation SHALL NOT corrupt the in-flight stream's identity.
2. WHEN a prepared call references a route that has since been revoked THEN the call SHALL fail with a typed stale/unavailable result at execution time rather than silently routing to a different implementation.
3. WHEN a caller cancels an in-flight stream THEN cancellation SHALL propagate through the official signal path of that stream, and the adapter's own contract SHALL decide how promptly the backend stops; the facade SHALL NOT forge an `aborted` terminal from the cancel request alone.
4. WHEN a route is replaced with a new implementation THEN new selections SHALL use the new implementation, and the old implementation SHALL NOT receive new calls after the swap point.
5. WHEN any of the above occurs THEN other owners' registrations and decorations SHALL be unaffected (不拆其他 owner 的 wrapper).

**Classification:** A 类稳定化；遵循 `concurrency-and-cancellation.md` §1–§5 与 `identity-and-lifecycle.md` §3。

## Requirement 7: 四种动作在 API 树上可辨认

**User Story:** 作为插件作者，我要求 configurable provider、model discovery、adapter 登记、decoration 四种动作各有明确归属，不因「都叫 register」混义。

### Acceptance Criteria

1. WHEN a plugin needs to add directory entries for a configurable provider (catalog metadata, no stream backend) THEN `llm.providers.register` SHALL be the supported action, and it SHALL NOT bind a callable stream backend.
2. WHEN a plugin needs dynamic model discovery THEN `llm.models.register` SHALL be the supported action, and it SHALL NOT bind a callable stream backend.
3. WHEN a plugin needs a new callable route with a real stream backend THEN `llm.adapters.register` SHALL be the supported action per Requirement 1.
4. WHEN a plugin needs to wrap/transform an existing adapter's behavior THEN the decoration entry (拆分后 `llm.adapters.decorations.register`) SHALL be the supported action, and its metadata SHALL keep the decoration vocabulary (labels; execution phase stream).
5. WHEN any of the four actions is attempted through the wrong entry (for example a stream backend via `llm.providers.register`, or a decoration via `llm.adapters.register`) THEN the system SHALL reject with a typed validation result naming the correct entry, rather than accepting and misinterpreting the spec.

**Classification:** A 类稳定化（形状判别）；本条与 Design 的 registry 拆分共同消除现行语义碰撞。

## Requirement 8: 能力自描述与降级

**User Story:** 作为维护者，我要求本域 capability 状态反映真实 authority/carrier，缺失只局部降级。

### Acceptance Criteria

1. WHEN the llm replacement row is inactive or version-mismatched THEN the adapter registration and decoration capabilities SHALL report degraded/unavailable per their real backing state, and unrelated llm capabilities (routing, requestTransforms, admissionPolicies) SHALL NOT be affected.
2. WHEN the capability status is queried THEN it SHALL reflect the actual seam state rather than the presence of an object.
3. WHEN any member of this feature is called while its backing is unavailable THEN it SHALL return the typed unavailable result and SHALL NOT throw through the caller's apply.

**Classification:** A 类稳定化；对齐 MAINT-02 后的能力自描述基线（对象存在性 ≠ active）。

## Requirement 9: client 半面判定

**User Story:** 作为维护者，我要求本 feature 的 host/client 归属按客户端半面六问显式记录，且 client 模型选择复用本线目录语义。

### Acceptance Criteria

1. GIVEN the six client-half questions of `capability-strategy.md` §10 THEN the recorded answers SHALL be: the replaced official llm row declares no client manifest; no remote namespace is registered by this feature; no slot or settings bridge is provided; no client↔host version negotiation is introduced; no browser-side state or reconnect semantics are owned here; no client-facing event/service is owned by this feature — therefore host-only.
2. WHEN a client (browser plugin, TUI remote, independent front end) needs model selection THEN it SHALL reuse the catalog semantics defined by this feature (route identity, capability projection, coexistence of original and variant models) through its own existing channels, and the facade SHALL NOT build a second model catalog for the client side.

**Classification:** host-only 判定记录；条目 2 为语义复用边界（第二目录禁止）。

## Requirement 10: 端到端验收场景

**User Story:** 作为维护者，我要求验收覆盖 goal 列出的全部场景。

### Acceptance Criteria

1. GIVEN a synthetic provider registered through the public path with a mock stream implementation WHEN the full chain is exercised THEN registration → catalog projection → model selection → real invocation of the mock stream SHALL all work without any official `inject`/`import` bypass (synthetic provider 全链路).
2. WHEN an image variant route and the original model coexist THEN both SHALL be selectable and the variant SHALL route to its own implementation.
3. WHEN two owners conflict on one route id THEN the outcome SHALL be the deterministic owner-conflict of Requirement 3.3.
4. WHEN decoration, route replacement, and disposal are interleaved across two owners THEN every handle's effect SHALL match Requirements 5–6 (decorate + route replace + dispose 交叉).
5. WHEN the registered set changes THEN the catalog projection and actual callability SHALL stay consistent per Requirement 4 (列表变化和调用一致).

**Classification:** 验收汇总条目；逐条分类随其主条目（A 类稳定化）。
