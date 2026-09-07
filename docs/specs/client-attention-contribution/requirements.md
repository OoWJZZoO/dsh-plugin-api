# Stage 1 - Requirements

> feature_name: `client-attention-contribution`
> milestone: M9
> status: SPEC1 Stage 1 已确认（v2，2026-09-06 人类批准；与 Design v2 同批）；Stage 3（Tasks）待进行——Tasks 经对抗性审查门通过后进入 Stage 4。
> 现状注（2026-09-07 核对）：Tasks（Stage 3）已通过对抗性审查门，Stage 4 已交付并合入 main（实现提交 `de1e2ed`、终审修订 `2da4564`）；本线随 M9 集成波在 `85c0dd9` 收尾。本行之上的历史批准记录原样保留，不代表当前仍在进行。

## Status

SPEC1 Stage 1 v2（M9 四条线批量交付；2026-09-06 人类批准）。v1 曾以"facade 零 R + 主包集中 $mount"定稿，与 Goal"优先以 replacement 扩大 client loader 能力面、而不是要求手写 $mount 胶水"的方向相悖；v2 按人类裁决修订为 **R-first**：host contribution hub 为 facade B（单一 authority），host→client 传输与浏览器侧运行时由两个 R slice 承载（`dsh-api-remotes`、`dsh-client-runtime`，均为新建 owner 包）。本文依据 Stage 0 Goal、M9 共同契约（`temp/m9-parallel-development-contract.md`）与本仓库 `docs/standards/` 编写。本文件与 Design v2 同批并于 2026-09-06 获人类批准（M9 批量确认门）；批次 Stage 0–2 完成，进入 Stage 3（Tasks）后按 SPEC3 工作流推进（Tasks 以对抗性审查为门）。

## Introduction

`client-attention-contribution` 为第三方插件提供统一、可撤销、可去重且可重连的 attention contribution：向 Web/TUI/desktop consumer 提供 scoped notification、toast、status indicator 与 action。公共面拆为两个 idiom：**contribution**（`contribute` 加内容；`dismiss`/`invoke` 为贡献域内受控动作）+ **projection**（两侧冻结投影与 `observe`）。公共路径：host `pluginApi.attention`；client `ctx.pluginApi.attention`（web profile）。

**实现通道方向（v2）：**

- **host attention hub（facade B）= 唯一条目 authority**：条目生命周期、seq、epoch、dedupe、expiry、容量、action handler、dismiss/invoke 裁决都在 host hub；条目不写任何 durable 记录（非 durable、非 session fact）。
- **api-remotes slice（R，新建 `dsh-api-remotes` owner 包）**：完整复刻官方行契约（11 事件转发白名单 + Remote Agent/Session identity BFF + client manifest 全半面），并让 attention 更新沿**官方 host→browser 转发管线**送达（typed、脱敏、冻结），取代 facade 私有的平行通道。
- **client-runtime slice（R，新建 `dsh-client-runtime` owner 包）**：完整复刻官方 browser 模块契约（`slots`/`conversationEvents`/`conversationViews`/`connection/reset`/`slots/changed` + reflect 面），并承载浏览器侧 attention runtime（native rebind/HMR 生命周期、slots 呈现集成、消息对账/去重/epoch），供主包 client 面（`ctx.pluginApi.attention`）消费。
- **纯浏览器插件可以发布**（client `contribute` 经管线转发到 host hub；host 不可达 ⇒ typed unavailable，不排队）；v1 的"client-only 生产者 excluded"废除。

选择性安装未含某 slice、或版本错配时，仅对应能力降级（typed unavailable/degraded + availability 明示）；full 安装默认交付全能力。host hub 是单一条目 authority，任何 slice 都不产生第二个条目权威（无双 hub、无双跑）。冻结基线 `0.1.0-rc.6-0.1.0` 内交付。每条需求标注 A/B/C/R 分类。

## Requirement 1: Contribution Entry, Owner And Handle

**User Story:** As a plugin author, I want one contribution entry that returns a stable, owner-scoped handle.

### Acceptance Criteria

1. WHEN a host plugin invokes `pluginApi.attention.contribute(spec)` with a valid spec THEN the system SHALL register one attention item in the host hub and SHALL return a discriminated outcome with a handle `{ id, ownerId, seq, dispose() }`, where `ownerId` is derived from the caller context and is not caller-reportable.
2. WHEN the same owner contributes the same item `id` again before removal THEN the system SHALL return the stable same-owner same-id conflict code and SHALL NOT silently replace the live item.
3. WHEN two different owners contribute the same item `id` THEN the system SHALL reject the second with the cross-owner conflict code.
4. WHEN the spec is malformed, empty, oversized or uses unsupported scope/audience/level vocabulary THEN the system SHALL return the typed invalid-input outcome and SHALL NOT register anything.
5. WHEN a producer calls `dispose()` on its live handle THEN the item SHALL be withdrawn; a stale or cross-owner handle SHALL return the typed stale/no-op result and SHALL NOT remove the current item.
6. WHEN contribution capacity is exhausted THEN the hub SHALL evict the oldest removable items observably or return the typed capacity outcome when none is removable; every eviction SHALL be observable as a removal with its reason.

**Classification:** B facade contribution hub; entry verb `contribute` follows the delivered contribution idiom（`docs/standards/api-idioms.md` §contribution，入口 `contribute(spec)` + 判别式结果 + `{id, ownerId, seq, dispose()}`）——偏离 Goal 措辞 `publish` 已登记。

## Requirement 2: Item Content Contract And Redaction Envelope

**User Story:** As a plugin author, I want one frozen content contract for what an attention item may carry.

### Acceptance Criteria

1. WHEN an item is registered THEN its public shape SHALL carry at most: `id`, `ownerId`, `seq`, scope association (`{sessionId?}`/`{workspaceId?}`; association only, never a durable scope claim), `level` (`info | warning | error`), `title`, bounded `body`, `dedupeKey`, `expiresAt`, `audience` (fixed client-kind vocabulary), optional `actions` (`[{id,label}]`), optional `correlation` (`{activityId?, executionId?}` from the shared projection), hub-assigned `observedAt`, and bounded non-secret `meta`.
2. WHEN content is contributed THEN redaction SHALL be applied host-side before the item enters any projection, forwarded payload or log exit; secret/owner-private values SHALL be rejected or stripped at the host boundary and SHALL NOT reach the client under any field name.
3. WHEN an item references a session/activity correlation THEN the system SHALL validate the reference against the shared projection vocabulary and SHALL mark an unverifiable reference `unknown`.
4. WHEN an item has no session/workspace association THEN it SHALL be presented as unscoped and SHALL NOT be attributed to any session durable record.
5. WHEN the same owner contributes two items with the same `dedupeKey` inside the live window THEN the later contribution SHALL return the duplicate result referencing the live item and SHALL NOT re-register or re-notify.

**Classification:** B facade data contract; visibility per `visibility-and-redaction.md` §1/§4 and contract §2.5.

## Requirement 3: Host Projection Of Current Attention

**User Story:** As a host-side consumer (TUI, desktop, operator UI), I want a frozen view and subscription of current attention items.

### Acceptance Criteria

1. WHEN a host caller queries the attention set THEN `attention.current()` SHALL return a frozen snapshot for the caller's reachable scope and `list({ scope?, audience?, cursor?, limit? })` SHALL return a frozen ordered page with cursor continuation.
2. WHEN a host caller subscribes THEN `observe({ scope?, audience? })` SHALL return `{ current(), subscribe(listener), dispose(), epoch }`; listeners SHALL receive frozen changes (add/update/remove with removal reason) and listener exceptions SHALL be contained.
3. WHEN an item expires, is dismissed, withdrawn or evicted THEN the projection SHALL remove it and SHALL expose the removal with its reason (`expired | dismissed | withdrawn | evicted-capacity`).
4. WHEN a consumer is not authorized for an item's audience or scope THEN the projection SHALL NOT include that item and SHALL NOT leak its existence beyond a bounded aggregate.
5. WHEN the hub is degraded or unavailable THEN queries/subscriptions SHALL return the typed degraded/unavailable view and SHALL NOT throw (P1/P2 apply to core/capability failure only).

**Classification:** A/B projection face; shapes per `api-idioms.md` §3.1/§2.

## Requirement 4: Dismiss, Expiry And Cleanup Semantics

**User Story:** As a consumer and producer, I want dismiss, expiry and cleanup to follow one lifecycle.

### Acceptance Criteria

1. WHEN a consumer dismisses an item (host or client `dismiss(itemId, { by })`) THEN the hub SHALL remove it with reason `dismissed`, return a typed result, and SHALL NOT require producer consent for dismissing items legitimately visible to that consumer.
2. WHEN an item reaches `expiresAt` THEN the hub SHALL remove it with reason `expired`; items without expiry SHALL remain until withdrawn, dismissed or evicted.
3. WHEN cleanup runs (expiry scan, capacity eviction, owner teardown) THEN it SHALL be observable through projection removals and SHALL NOT write any durable record or session fact.
4. WHEN a producer's owner context ends or reloads THEN the hub SHALL dispose that owner's live items with reason `withdrawn`; a contribution after reload SHALL be a new registration; stale producer disposers SHALL NOT remove newer-generation items.

**Classification:** B facade lifecycle; disposer ownership per `concurrency-and-cancellation.md` §5.

## Requirement 5: Client Face — Projection, Contribute, Dismiss And Action

**User Story:** As a Web UI plugin author — including a pure-browser plugin — I want the attention face on the client with contribute, dismiss and action round-trips.

### Acceptance Criteria

1. WHEN a client plugin accesses the attention face THEN `ctx.pluginApi.attention.current()/list()/observe()` SHALL present the same frozen shape semantics as the host projection for items whose audience includes that client, delivered through the official host→browser pipeline (api-remotes slice) and the browser attention runtime (client-runtime slice).
2. WHEN a client plugin contributes an attention item THEN `ctx.pluginApi.attention.contribute(spec)` SHALL forward the validated spec to the host hub through the supported client→host request channel (delivered session-channel transport; consumed, not replaced — see the R decision table for `dsh-client-connection`/`dsh-api-gateway`) and SHALL return the same typed outcome/handle semantics as the host face, with owner derived from the client caller context; the host hub SHALL remain the single item authority.
3. WHEN a client consumer dismisses an item or invokes an action THEN `dismiss(itemId, {by})`/`invoke(itemId, actionId)` SHALL forward the typed request to the host hub and return the same typed outcome as the host face.
4. WHEN the pipeline, host connection or hub is unavailable (offline, rebind, headless profile without the client rows) THEN client calls SHALL return typed `unavailable` outcomes and the client projection SHALL report its own availability truthfully; the client SHALL NOT queue requests invisibly in any revision.
5. WHEN client payloads are delivered THEN redaction SHALL already be applied host-side; the client SHALL validate shape only and SHALL NOT receive secret/owner-private/diagnostic material; the client SHALL NOT be able to inject arbitrary host-visible fields.
6. WHEN no client consumer is present in the profile THEN the host hub SHALL remain active and report the client delivery path as degraded/unavailable; host-side consumers (TUI/desktop/operator) stay served.

**Classification:** B client face + R transport/browser-runtime surfaces; client-half audience/redaction per `visibility-and-redaction.md` §4.

## Requirement 6: Reconnect, Rebind And Generation Containment

**User Story:** As a plugin author, I want attention state to survive connection rebind and HMR without old faces writing over new ones.

### Acceptance Criteria

1. WHEN a client connection rebinds, reconnects or hot-reloads THEN the browser attention runtime SHALL rebuild its projection from the host hub's current snapshot with a new epoch and SHALL NOT carry live items from the old epoch as current.
2. WHEN the host hub epoch changes or a caller's owner generation becomes stale THEN old client faces, disposers and callbacks SHALL lose commit eligibility: they SHALL NOT write to the new hub state, SHALL NOT remove new-generation items, and SHALL NOT be delivered as current events on the new face.
3. WHEN a client call or callback from a stale connection generation arrives at the host THEN the host SHALL return the typed stale/conflict outcome and SHALL NOT apply it to the current hub state.
4. WHEN the browser runtime itself reloads (module HMR) THEN the runtime SHALL re-establish the projection from the host snapshot under the official connection lifecycle rather than requiring third-party `$mount` glue; the client face SHALL be present again after reload without manual remount by consumers.
5. WHEN duplicate or reordered deliveries occur across a rebind THEN the client SHALL dedupe by item `id`/`seq` and SHALL NOT double-render one item.

**Classification:** R for the native rebind/HMR lifecycle (client-runtime slice) plus B guards; stale containment per `concurrency-and-cancellation.md` §4.

## Requirement 7: Action Invocation

**User Story:** As a plugin author, I want optional actions on my items to be invocable by consumers with owner-scoped guards.

### Acceptance Criteria

1. WHEN a contribution declares `actions` THEN the producer SHALL provide, per action id, a bounded owner-bound handler registered with the item; handlers SHALL NOT be replaceable by another owner.
2. WHEN a consumer invokes `attention.invoke(itemId, actionId)` THEN the hub SHALL verify the item is live and visible, the action exists, execute the owner's handler with bounded context, and return a typed outcome (`invoked | not-found | conflict | unavailable`); handler exceptions SHALL be contained and surfaced with owner attribution.
3. WHEN an action targets a session/activity that has moved on THEN the hub SHALL NOT invoke the handler and SHALL return the typed stale/conflict outcome.
4. WHEN the invoking consumer lacks visibility or the item is not live THEN the hub SHALL return `not-found`/`conflict` typed outcomes and SHALL NOT leak whether the item exists.
5. WHEN a producer disposes the item or its owner context ends THEN pending handlers SHALL be disabled with the item.

**Classification:** B facade operation-within-contribution (producer-owned handler execution with containment); no generic unrestricted executor.

## Requirement 8: Availability, Degradation And Capability

**User Story:** As a plugin author, I want to know exactly what attention can do in my installation.

### Acceptance Criteria

1. WHEN a caller queries availability THEN host `attention.availability()` and client `ctx.pluginApi.attention.availability()` SHALL return frozen `{ status: active | degraded | unavailable, reason?: string }` covering the hub, the pipeline (api-remotes slice), the browser runtime (client-runtime slice) and the local consumer path respectively, and SHALL never throw.
2. WHEN the facade core is inactive or the capability disabled THEN callers SHALL receive uniform P1/P2 typed errors per contract §6; partial absence of a slice/transport/carrier SHALL be a P3 degraded/unavailable view, not a boot failure.
3. WHEN one slice is inactive or version-mismatched THEN only its covered portion SHALL degrade (e.g., pipeline slice inactive ⇒ host→client delivery unavailable; browser runtime slice inactive ⇒ client face unavailable) while the host hub and host consumers stay active; availability SHALL name the concrete cause and SHALL NOT leave the official row disabled without a working official-contract path.
4. WHEN capability presence is negotiated THEN `capabilities` SHALL expose the attention capability without package, row, remote key or replacement identities.
5. WHEN a consumer or producer is entirely absent THEN the hub SHALL NOT disable itself or other features.

**Classification:** B（facade selfDescription）；taxonomy per contract §6 and `capability-strategy.md` §6.2.

## Requirement 9: Scope, Durability And Privacy Boundaries

**User Story:** As a maintainer, I want attention never to become a durable fact store or session-history writer.

### Acceptance Criteria

1. WHEN an attention item is registered, changed or removed THEN the system SHALL NOT write the item into session durable history, session records, or any scope-backed durable domain state; items SHALL live only in hub/runtime memory.
2. WHEN a consumer needs an audit trail THEN it SHALL keep its own owner-scoped audit; the hub documentation SHALL state its non-durable nature.
3. WHEN a session or workspace association is attached THEN it SHALL be an association only and SHALL NOT grant durable scope authority, content access or mutation ability.
4. WHEN items could be visible to a model-facing consumer THEN model visibility SHALL require an explicit visibility decision; by default attention is UI/consumer-only and SHALL NOT leak into model context.
5. WHEN a consumer or producer is removed THEN its attention state SHALL be cleaned without affecting other owners.

**Classification:** B facade boundary; non-durable design per `durable-state-and-scope.md` §5 and `api-shape.md` §1.

## Requirement 10: Boundaries — No Activity Judgment, No UI Policy

**User Story:** As a maintainer, I want attention to stay a presentation contribution.

### Acceptance Criteria

1. WHEN a session activity changes THEN attention SHALL NOT judge turn settle or meaning; it SHALL only consume derived signals from the shared activity projection and present producer-authored items.
2. WHEN an item could be shown as a browser notification, sound, toast, badge or TUI status THEN the hub/slices SHALL NOT request browser permissions, play sounds, or enforce concrete UI framework behavior; carriers and permissions are consumer-side choices.
3. WHEN a producer wants a specific carrier or framework THEN it SHALL use the audience/level/content contract; the hub SHALL NOT offer a generic client state store, scheduler, message bus or arbitrary remote namespace.
4. WHEN interaction and attention observe the same session event THEN `session-interaction-operation` SHALL NOT publish UI notifications through this hub implicitly, and attention SHALL NOT send request/cancel signals to the session authority.
5. WHEN a pure-browser plugin wants to publish attention THEN the supported path is client `contribute` forwarded to the host hub (Requirement 5); offline/unreachable states return typed `unavailable` rather than a second local-only authority — the host hub remains the single item authority.

**Classification:** Boundary/non-goal across A/B/R; no framework dispatch semantics are moved into this feature (`capability-strategy.md` §2).

## Requirement 11: Api-Remotes Replacement Slice Contract (R)

**User Story:** As a maintainer, I want the host→browser attention transport to ride the official forwarding pipeline without breaking the forwarded-event contract.

### Acceptance Criteria

1. WHEN the api-remotes slice is added THEN it SHALL become the replacement owner of the official `api-remotes` row (web profile) through the official patch mechanism only; SHALL NOT modify official package files and SHALL NOT add unrelated rows.
2. WHEN the slice is active THEN it SHALL reproduce the full official contract of the replaced row — the forwarded-event allowlist semantics for every currently forwarded host event (the eleven allowlisted event names), the Remote Agent/Session identity BFF behavior, receiver/error/disposer shapes and the client manifest half (cap-strategy R2); parity fixtures SHALL assert the eleven official event keys and their per-event semantics one-to-one against the official implementation.
3. WHEN attention updates travel host→browser THEN they SHALL be routed through the same official forwarding machinery extended by the slice (typed, frozen, host-redacted messages with item `id`/`seq`/epoch), and SHALL NOT bypass or duplicate the official pipeline with a parallel private channel; `attention/update` SHALL be a typed extension key added only after full reproduction (cap-strategy R2 ordering) and SHALL NOT participate in official parity assertions; the extension SHALL NOT expand the consumer-side `ctx.remote.$on` legal key set (kept at the eleven allowlisted events) — `attention/update` is delivered through the replaced module's own reproduced forwarding path to the browser runtime and reaches third-party consumers via `ctx.pluginApi.attention`, not via `$on`; the Stage 3 parity probe SHALL pin this boundary.
4. WHEN the slice applies THEN it SHALL verify the official row is disabled, exactly one replacement row is active, runtime/package identities match, and no component-owner conflict exists (cap-strategy R4/R5/R6).
5. WHEN a self-check or parity fixture fails THEN the slice SHALL log bounded diagnostics and SHALL NOT claim the attention route; official forwarding behavior SHALL remain functional (官方原行为照常，不启用扩展) and the installation SHALL NEVER be left with the official row disabled and no working official-contract path.
6. WHEN the replaced row's client half is reproduced THEN it SHALL follow capability-strategy R7: self-built client bundle registered under the official module id, with `window.__DSH_BOOT__` assembly and HMR verification.
7. WHEN third-party code directly imports the official `@deepseek-ai/dsh-api-remotes` package THEN the slice SHALL NOT claim to intercept or replace that import surface (cap-strategy R3).
8. WHEN the api-remotes slice is delivered THEN it SHALL register its U-series upstream proposal and retirement condition in feature-list §3.1 at the integration wave (capability-strategy §4.1).
9. WHEN the official component later provides an equivalent typed publication seam THEN the slice SHALL follow the registered retirement condition to migrate back to official binding.
10. WHEN the official row is absent (e.g., headless profile) THEN no replacement row SHALL be inserted and the client delivery path SHALL report unavailable per Requirement 8 AC3.

**§10 六问证据（capability-strategy §10；任何一项命中即要求完整 client 半面）：**

| §10 问 | verdict | 证据 |
|---|---|---|
| 1 client manifest | 命中 | 官方 `dsh-api-remotes` 声明 `dsh.client` manifest（inject `[dsh-api-gateway]`；Stage 3 probe 复核） |
| 2 remote namespace | 未命中 | 转发/网关角色，无独立 remote namespace 注册面 |
| 3 slot/settings bridge | 未命中 | 无 slot/settings bridge 面 |
| 4 版本协商 | 未命中 | 无 host↔client 版本协商 |
| 5 browser state/reconnect | 未命中 | 该行无 browser state/reconnect 语义 |
| 6 client-facing event/service | 命中 | `ctx.remote.$on` 合法键集（= 11 事件白名单）即 consumer 端事件面 |

**Classification:** R（新建 `dsh-api-remotes` owner 包；§10 六问命中第 1/6 问 ⇒ 完整 client 半面，落地按 capability-strategy R7）；capability-strategy R1–R8 适用条款逐条满足。

## Requirement 12: Client-Runtime Replacement Slice Contract (R)

**User Story:** As a maintainer, I want the browser attention runtime to live in the replaced client module with native lifecycle, without breaking slots/conversation services.

### Acceptance Criteria

1. WHEN the client-runtime slice is added THEN it SHALL become the replacement owner of the official `client-runtime` row (web profile) through the official patch mechanism only; SHALL NOT modify official package files and SHALL NOT add unrelated rows.
2. WHEN the slice is active THEN it SHALL reproduce the full official browser-module contract — `slots` (with `slots/changed`), `conversationEvents`, `conversationViews`, `connection/reset`, the outward `sessions`/`workspaces` reflect faces, and the `dsh.client` manifest half (inject list `[dsh-client-connection, dsh-typert-registry, dsh-api-remotes]` and assembly semantics) — before adding the attention runtime (cap-strategy R2).
3. WHEN the attention runtime is active THEN it SHALL own the browser-side attention state machine (message reconciliation, item `id`/`seq` dedupe, epoch rebuild on `connection/reset`/HMR, host snapshot re-fetch), SHALL expose the internal runtime consumed by the main facade client face, and SHALL integrate presentation mounting through the reproduced `slots` contract where consumers choose to use slots.
4. WHEN the slice applies THEN it SHALL verify the official row is disabled, exactly one replacement row is active, runtime/package identities match, and no component-owner conflict exists (cap-strategy R4/R5/R6).
5. WHEN a self-check or parity fixture fails THEN the slice SHALL log bounded diagnostics and SHALL NOT claim the attention runtime; slots/conversation/reflect official behavior SHALL remain functional and the installation SHALL NEVER be left with the official row disabled and no working official-contract path.
6. WHEN the client half is reproduced THEN it SHALL follow capability-strategy R7 (self-built bundle under the official module id, `window.__DSH_BOOT__` and HMR verification).
7. WHEN third-party code directly imports the official `@deepseek-ai/dsh-client-runtime` package THEN the slice SHALL NOT claim to intercept or replace that import surface (cap-strategy R3).
8. WHEN the client-runtime slice is delivered THEN it SHALL register its U-series upstream proposal and retirement condition in feature-list §3.1 at the integration wave (capability-strategy §4.1).
9. WHEN the official component later provides an equivalent native attention/reconnect seam THEN the slice SHALL follow the registered retirement condition to migrate back to official binding.

**§10 六问证据（capability-strategy §10；任何一项命中即要求完整 client 半面）：**

| §10 问 | verdict | 证据 |
|---|---|---|
| 1 client manifest | 命中 | 官方 `dsh-client-runtime` 声明 `dsh.client` manifest（inject `[dsh-client-connection, dsh-typert-registry, dsh-api-remotes]`；Stage 3 probe 复核） |
| 2 remote namespace | 未命中 | reflect 面为 outward 服务，无独立 remote namespace 注册语义 |
| 3 slot/settings bridge | 未命中 | `slots` 属被复刻行自身服务契约，非另行提供的 bridge |
| 4 版本协商 | 未命中 | 无 host↔client 版本协商 |
| 5 browser state/reconnect | 命中 | `connection/reset` 与模块 HMR 即 browser-side state/reconnect 语义（被复刻契约；attention runtime 重建依赖） |
| 6 client-facing event/service | 命中 | `slots/changed`、`connection/reset` 等浏览器服务/事件面 |

**Classification:** R（新建 `dsh-client-runtime` owner 包；§10 六问命中第 1/5/6 问 ⇒ 完整 client 半面，落地按 capability-strategy R7）；capability-strategy R1–R8 适用条款逐条满足。

## Requirement 13: Multi-Owner Composition And Consumer Safety

**User Story:** As a plugin author, I want many concurrent producers and consumers to behave deterministically.

### Acceptance Criteria

1. WHEN several producers contribute and several consumers observe at the same time THEN all SHALL receive the same hub-ordered view semantics and SHALL NOT observe each other's private state or handlers.
2. WHEN a producer registers invalid input THEN the system SHALL return the typed invalid-input outcome and SHALL NOT corrupt other registrations.
3. WHEN a plugin is disposed or reloaded THEN its items, observers and handlers SHALL be cleaned up without affecting other owners; owner-bound cleanup SHALL be identity-based.
4. WHEN two synthetic plugins register in reverse order (host and client faces) THEN conflicts, dedupe, disposal isolation, callback containment and scope isolation SHALL behave identically.
5. WHEN a consumer's view is handed out THEN it SHALL be frozen; callers SHALL NOT mutate shared hub state through returned objects.

**Classification:** A/B additive/pure composition; `composition-and-authority.md` §3/§5/§11.

## Requirement 14: Verification And Delivery Gates

**User Story:** As a maintainer, I want mechanical evidence that attention stays non-durable, redacted and contained, and that the two client slices preserve their official rows.

### Acceptance Criteria

1. WHEN delivery tests run THEN two synthetic plugins SHALL cover reverse registration order, same-owner/cross-owner conflict, dedupe, expiry, dismiss, withdraw, capacity eviction, callback containment and stale disposer isolation on host and client faces.
2. WHEN slice tests run THEN api-remotes and client-runtime slices SHALL cover official-contract parity (allowlist forwarding/BFF for api-remotes; slots/conversation/reflect for client-runtime), version mismatch, boot self-check, owner-conflict, no double-run, module-id registration, HMR behavior, removal/official-row restoration and headless absence.
3. WHEN rebind/HMR tests run THEN fixtures SHALL cover connection reset, host epoch change, stale client generation writes rejected, item id/seq dedupe, snapshot reconciliation, and client-face presence after reload without consumer `$mount`.
4. WHEN redaction tests run THEN host projection, forwarded payloads and logs SHALL be mechanically asserted free of secret/owner-private material; client shape-only validation SHALL be asserted.
5. WHEN non-durability tests run THEN fixtures SHALL prove no attention item ever enters session durable history or any scope-backed durable record.
6. WHEN registry/shape checks run THEN every new host/client member, namespace row, capability and event/catalog entry SHALL be registered with one primary idiom, semantic face, effect, composition, scope and availability shape; surface snapshots SHALL match.
7. WHEN the guarded full test suite, `git diff --check`, registry/surface consistency, official-package zero-modification audit and the required global adversarial review run THEN all SHALL pass before the Stage 4 completion commit.

**Classification:** Delivery foundation covering B faces and the two R slices.

## R 决策与残余 C 类登记（v2）

- 采纳 R：(1) `dsh-api-remotes` owner 包 slice——attention 更新沿官方 host→browser 管线送达（单一管线，取代 facade 平行通道）；(2) `dsh-client-runtime` owner 包 slice——浏览器侧 attention runtime（native rebind/HMR、slots 集成、消息对账），并按 Goal 指示以 replacement 取代"主包集中 $mount + 第三方手写胶水"路径。能力：纯浏览器插件可发布（client contribute → host hub）、跨插件一致呈现、官方生命周期内重连/重载后自动恢复。
- 未采纳 R（证据）：`dsh-api-gateway`/`dsh-client-connection`（已有 session-channel owner 包；本 feature 是其消费者，不重复替换）；`dsh-session`/activity（事实来源消费，A/B）；notification carrier（浏览器权限/声音属 consumer/UI 层，不是 host authority）。
- 残余 C（证据 + 退役条件）：浏览器**原生动态发现**（任意 client 插件免 inject/装配即发现 remote 面）——官方 client loader/module-table 语义横跨多组件、无单一 owner 可替换闭合；两个被替换行的激活已把装配面收窄为"注入被替换模块或主包"的受支持路径，官方 loader 提供原生发现后本 feature 直绑并退役说明。UI 载体（Notification 权限/声音/具体 framework）始终是 consumer 侧选择，不是门面能力。

## M9 Contract Conformance And Deviation Notes

契约 §2/§5/§6 采纳；契约 §2.5 attention 条款落实为 hub/运行时非 durable + scope 关联语义。偏离记录（契约 §8）：

1. contribution verb 定稿为 `contribute`（偏离 Goal 措辞 `publish`）：依据既有 delivered contribution idiom（`docs/standards/api-idioms.md` §contribution，入口 `contribute(spec)` + 判别式结果 + `{id, ownerId, seq, dispose()}`）；M8 动词归并先例为 `remotes publish→register`，与本面不混淆。
2. v1"零 R + 主包集中 $mount"废弃：v2 采纳 api-remotes/client-runtime 两个 R slice（requirements 偏离注于 R 决策节；动机与 Goal"优先 replacement 而非手写 $mount"对齐）。
3. client-only 生产者 v1 排除废除：受支持路径 = client contribute 转发 host hub（Requirement 5/10 AC5）；host 不可达 typed unavailable，不建第二 authority。
4. 契约 §7.1 共享文件边界：本线在并行期只写 `docs/specs/client-attention-contribution/**` 与两个新建 owner 包目录（api-remotes、client-runtime 的官方组件 owner 属本线）；registry/feature-list/README/full 聚合装配由集成波统一更新（行/包名集成波定稿，运行时命名中性）。
5. 内容字段扩展：public item 形状在 Goal 枚举（scope/level/标题/正文/dedupeKey/expiresAt/action/audience）之外增加 `correlation`（依据 M9 契约 §2.1 身份词表）、`meta` 与 hub 指派的 `observedAt`（依据契约 §2.5 可见性档位）——扩展依据登记于此；`observedAt` 由 hub 指派、不可 caller 自报（Requirement 2 AC1）。

## Standards Applicability And Alignment

- `capability-strategy.md`: applicable。两个 R slice（新建 owner 包；§10 六问任一命中即完整 client 半面（cap-strategy R7），逐问证据见 R11/R12 各表）；framework 横切语义不进本 feature；残余 C 附证据。
- `api-shape.md`: applicable。contribution 不写领域事实 + projection 只读双面；无 mutation/策略混入。
- `api-idioms.md`: applicable。`contribute`/判别式结果/`{id,ownerId,seq,dispose()}`/`current/list/observe` handle/availability 全对齐。
- `public-api-shape.md`: applicable。host/client 各挂 `attention` 领域根；不暴露 remote key/包/行身份。
- `composition-and-authority.md`: applicable。host hub 单一条目 authority；owner 派生（含 client 侧）；跨 owner 冲突；stale disposer；容量驱逐可观测。
- `domain-composition.md`: applicable。不拥有 activity/session 事实；不旁路 durable authority；client 半身受众规则更保守。
- `ordering.md`: applicable。hub seq 投递；无跨领域排序图。
- `identity-and-lifecycle.md`: partially applicable。item id/seq 领域内身份；不用 generation/terminal 词汇伪装条目状态。
- `durable-state-and-scope.md`: applicable（非 durable 边界；scope 关联非 durable claim）。
- `visibility-and-redaction.md`: applicable。host 侧脱敏先行（进入转发管线前）；client 形状校验；fail-closed。
- `concurrency-and-cancellation.md`: applicable。rebind/HMR/旧代次提交资格、disposer 所有权、handler containment 逐条声明。
- `versioning-and-protocols.md`: applicable。冻结基线；新增两个 owner 包遵循 `A.B.C` 装配契约（错配只停用对应 slice）；attention 协议经官方管线转发（wire revision 集成波登记）。

## 备注（Stage 边界）

本文件只确认 Requirements 方向。Design 将确定：hub/transport/browser runtime 三层职责、两个 R slice 的契约复刻清单与 parity fixture、转发协议形状、rebind/HMR 状态机、registry/包/行拟新增清单。Tasks 通过对抗性审查后才进入实现。
