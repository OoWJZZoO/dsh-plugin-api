# Stage 1 - Requirements

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.sessionChannel`（B 门面：`open/subscribe/fetchEvents/heartbeat/ack/resume/revoke` + `observe/onChange` + `auth.*`） | `pluginApi.sessions.channels`（叶子名不变） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

## Status

SPEC1 Stage 0–2 修订稿：原确认稿按"纯 R 单行替换"方向（Stage 2 R no-go 后转入 U21）；2026-08-27 用户指示改为 **B+R 混合设计**——B 类门面 `pluginApi.sessionChannel` 承载认证抽象与 session 游标/重放机械层，`connection`/`gateway` 两个 R 替换包在各官方组件内复刻契约并增加 transport 与 RPC 派发切片。本批仅修订 goal/requirements/design 三份制品，不产出 Tasks；**修订稿已获用户确认（2026-08-27）**。

ANY 维护修订（2026-08-27，用户指示）：Stage 4 只读审查发现实现未满足本文件多条 AC（RSC-R5 AC1/AC3、RSC-R6 AC1/AC2、RSC-R7 AC1、RSC-R16 的调用方维度）。本批修订**不改动任何 EARS 验收条款**——修复属于实现回归已获批边界；对 RSC-R16 的"declared per-method rate limit"补充澄清性读法（按方法声明的界施加于每个调用方桶，匿名调用方共享一个桶），该读法与原文字面一致，不构成边界变更。

## Introduction

`remote-session-channel` 为跨设备 session 访问定义统一的 channel、授权、传输、游标、确认和恢复语义。实现路径为 **B+R 混合**：认证与 session 机械层由 B 类门面承载（可插拔认证抽象，不依赖任何官方行的 replacement 边界），transport 载波与 channel RPC 派发由两个 R 替换包承载（每包只归属唯一官方组件）。具体 row、runtime identity、client 半面与唯一 owner 在 Stage 2 源码审计中冻结。

## Definitions and Boundaries

- **Channel**：一个设备与宿主之间的受授权连接实例，拥有 channel identity、generation 和生命周期。
- **Cursor**：session 事件流中的客户端消费位置，不作为 channel 或 session identity。
- **Resume token**：绑定设备授权与 channel generation 的恢复凭证；其内容不进入普通日志或模型可见面。
- **Delivery**：默认 at-least-once；重复事件通过稳定 dedupe key 消除，系统不宣称 exactly-once。
- **B+R boundary**：认证抽象与 session 游标/重放机械层由 B 类门面承载（可插拔 verifier/pairing/authorizer 抽象）；transport 载波与 channel RPC 派发由 `connection`/`gateway` 两个 R 替换包承载（每包只归属唯一官方组件、只替换该组件官方行并完整保留其契约）。跨组件协同在 feature-list §3.1.1 报备登记。

## Requirements

### RSC-R1 Official Patch Mechanism

**User Story:** As a maintainer, I want the channel replacement installed only through official patching, so that official packages remain untouched.

**Acceptance Criteria:**

1. WHEN the bundle is assembled THEN it SHALL disable exactly the approved official `connection` and `typert-gateway` rows and insert exactly the corresponding replacement rows (one per official component).
2. WHEN the bundle is uninstalled THEN the official rows SHALL be restored by the patch mechanism without manual package edits.
3. WHEN any implementation runs THEN it SHALL NOT modify `/usr/lib/node_modules/@deepseek-ai/dsh/**` or any official package file.
4. WHEN the full aggregate bundle and the selective-install assembly are compared THEN they SHALL assemble the same set of replacement rows with the same behavior.

### RSC-R2 Official Contract Fidelity

**User Story:** As a plugin consumer, I want each replacement to preserve its official component contract, so that existing callers continue to work.

**Acceptance Criteria:**

1. WHEN a replacement package is active THEN it SHALL preserve its own approved official row's complete ctx service, event, HTTP route, teardown and ordering semantics, plus the failure semantics as actually present in that official contract (for the `connection` row this includes its non-authenticating `trustedHosts` fence behavior; nothing is invented where the official row has no authentication).
2. WHEN channel support is inactive or degraded THEN the preserved official surface of each replacement SHALL continue to operate without the new channel extension.
3. WHEN a third-party module imports the official DSH package THEN the import SHALL resolve to the official package rather than the replacement bundle.
4. WHEN the B facade is absent or inert THEN the replacement packages SHALL NOT publish channel capabilities and SHALL keep their replicated official surface unchanged.
5. WHEN contract fidelity for an official row cannot be proven against the installed runtime THEN the corresponding replacement SHALL pause and the affected slice SHALL be registered as a C-class upstream proposal instead of fabricating a boundary.

### RSC-R3 Boot Self-Check and Fail-Safe

**User Story:** As an operator, I want broken or duplicate channel assembly detected at boot, so that a bad replacement cannot silently run.

**Acceptance Criteria:**

1. WHEN a replacement applies THEN it SHALL verify its target row is disabled, its replacement row is active, required service/route probes pass, and no duplicate owner is present.
2. WHEN any probe fails THEN the replacement SHALL record a diagnostic, return normally from apply, and leave the host boot alive.
3. WHEN an official row is not disabled or a competing replacement is detected THEN the replacement SHALL not run alongside it.
4. WHEN the B facade applies THEN it SHALL verify the required auth abstraction and session observation hooks are available; WHEN any is missing THEN the facade SHALL stay inert with a typed diagnostic and SHALL NOT mount channel capabilities.

### RSC-R4 Version and Owner Locking

**User Story:** As a maintainer, I want runtime and component identity mismatches rejected, so that channel semantics are never guessed.

**Acceptance Criteria:**

1. WHEN the installed runtime or target official package identity differs from the identities frozen by the approved Design THEN the corresponding replacement SHALL disable itself with an explicit typed diagnostic.
2. WHEN another replacement claims the same official component OR duplicate insertion is observed THEN the replacement SHALL fail-safe and SHALL NOT publish channel capabilities.
3. WHEN the two replacement packages or the B facade use different runtime/API versions THEN the assembly SHALL stop the affected R feature and SHALL NOT silently mix versions.

### RSC-R5 Auth Abstraction and Channel Lifecycle

**User Story:** As a remote client, I want an explicitly authorized channel lifecycle, so that only approved devices can observe a session.

**Acceptance Criteria:**

1. WHEN `sessionChannel.open({ device, capabilities, resumeToken })` is requested THEN the facade SHALL require a registered verifier/authorizer chain to validate device authorization, token binding, requested capabilities and channel scope before creating a channel.
2. WHEN authorization, capability or token validation fails OR no verifier is registered THEN the facade SHALL return a typed `denied` or `unavailable` result without creating a partial channel.
3. WHEN `revoke` is called or a channel expires THEN subsequent subscribe, ack and resume operations SHALL be rejected and the old generation SHALL lose submission qualification.
4. WHEN presence or heartbeat is accepted THEN it SHALL update only the owning channel generation and SHALL NOT revive a revoked or expired channel.
5. WHEN a third-party plugin registers a verifier, pairing provider or authorizer THEN the facade SHALL invoke only the registered chain and SHALL NOT impose a fixed authentication paradigm.

### RSC-R6 Subscription, Delivery and Cursor Semantics

**User Story:** As a client, I want deterministic event delivery and acknowledgement, so that reconnects do not silently lose or duplicate session updates.

**Acceptance Criteria:**

1. WHEN `subscribe({ session, cursor })` is accepted THEN the facade SHALL deliver events after the requested cursor with session scope and an explicit delivery mode.
2. WHEN an event is delivered more than once THEN each copy SHALL carry the same stable dedupe key and the client SHALL be able to collapse duplicates.
3. WHEN `ack(cursor)` is received THEN the facade SHALL advance acknowledgement only monotonically for the same channel generation.
4. WHEN a cursor is malformed, out of scope or older than the retained replay window THEN the facade SHALL return a typed resync-required result and SHALL NOT fabricate missing events.

### RSC-R7 Resume and Transport Negotiation

**User Story:** As a remote client, I want to resume after transport loss, so that a temporary network failure does not require a new pairing.

**Acceptance Criteria:**

1. WHEN `resume(token, cursor)` is requested THEN the facade SHALL verify token, device, session scope and channel generation before replaying events.
2. WHEN the cursor is within the retained window THEN the facade SHALL replay from that cursor over the transport negotiated by the connection replacement.
3. WHEN the cursor cannot be replayed continuously THEN the facade SHALL return a bounded snapshot/resync response with an explicit gap reason.
4. WHEN multiple transports are available THEN the connection replacement SHALL negotiate only an advertised and authorized transport among SSE, polling, WebSocket and loopback, and SHALL NOT fall back to an unadvertised transport.

### RSC-R8 Visibility, Redaction and Audit

**User Story:** As a host operator, I want remote channel data constrained by audience and authorization, so that secrets and unrelated sessions do not leak.

**Acceptance Criteria:**

1. WHEN a remote projection is produced THEN the facade SHALL enforce session scope, per-method authorization and audience-specific redaction before serialization.
2. WHEN redaction fails OR a secret/credential field is encountered without explicit user/profile policy THEN the facade SHALL fail closed and SHALL omit the field.
3. WHEN channel lifecycle or authorization changes occur THEN the facade SHALL append bounded audit evidence containing who/what/when/generation, without raw tokens or session content.
4. WHEN a channel payload is serialized for a client half THEN the host SHALL redact before wire and the client SHALL re-validate shape only without redaction responsibility; secret material SHALL NOT enter channel-remote payloads, console output or generic fields (visibility-and-redaction §4).

### RSC-R9 Concurrency, Cancellation and Disposer Ownership

**User Story:** As a maintainer, I want stale connections and callbacks isolated, so that an old device cannot mutate a newer channel.

**Acceptance Criteria:**

1. WHEN a newer channel generation supersedes an older one THEN all late subscribe, ack, heartbeat, replay and transport callbacks from the older generation SHALL lose submission qualification.
2. WHEN an `AbortSignal` or revoke cancellation is received THEN the facade SHALL stop further delivery effort, mark the operation `aborted` where applicable, and SHALL not rewrite an already committed terminal outcome.
3. WHEN a channel disposer runs THEN it SHALL be idempotent and SHALL revoke only resources owned by that channel identity.
4. WHEN the underlying transport cannot stop immediately THEN stale-result guards SHALL prevent late data publication.
5. WHEN an operation times out THEN the facade SHALL return a typed `error` result with reason `timeout` and SHALL NOT introduce a new terminal outcome category.
6. WHEN a child subscription fails or is cancelled THEN the facade SHALL NOT revoke the parent channel/device unless the registered auth owner explicitly declares that relationship.

### RSC-R10 Durable Scope and Retry Boundary

**User Story:** As a host maintainer, I want channel persistence and retry boundaries explicit, so that reconnect does not create false durability guarantees.

**Acceptance Criteria:**

1. WHEN channel state is persisted THEN it SHALL be assigned to one declared scope (session, workspace or profile) and SHALL not silently span scopes.
2. WHEN a delivery or resume operation is retried THEN the facade SHALL use a bounded retry policy and SHALL preserve channel identity, generation and dedupe semantics.
3. WHEN retry capability is not explicitly declared or the operation is `denied`, `aborted` or `superseded` THEN the facade SHALL not automatically retry.

### RSC-R11 Client-Half Decision

**User Story:** As a maintainer, I want each replacement's client surface proven, so that host and browser contracts are not accidentally mixed.

**Acceptance Criteria:**

1. WHEN the target official rows are audited THEN Design SHALL record evidence for client manifest, remote namespace, slot/settings bridge, host-client version negotiation, browser state/reconnect, and client-facing event/service for each replacement package and the B facade.
2. WHEN any of the six checks is positive for a package THEN that package SHALL specify and test a complete client half under R8; WHEN all six are negative THEN it SHALL be host-only and SHALL add no client build surface.
3. WHEN a channel operation crosses host and client THEN the B facade SHALL own the channel contract and the replacement packages SHALL own only their carrier/RPC plumbing, without duplicating channel state on both sides.

### RSC-R12 Upstream Proposal and Retirement

**User Story:** As a maintainer, I want a clear exit path, so that an official channel contract can supersede the facade.

**Acceptance Criteria:**

1. WHEN this feature is delivered THEN it SHALL register per-package upstream proposals covering each replacement package's capability (feature-level authenticated channel owner U21, connection transport/fencing seam U22, gateway RPC/remote dispatch seam U23) with explicit retirement conditions, per capability-strategy R7.
2. WHEN the official runtime provides equivalent pairing, authorization, resume, replay and transport semantics THEN consumers SHALL be able to migrate to that seam, the B facade SHALL be marked for retirement, and each replacement package SHALL deprecate/retire when its own slice is covered by the official contract.

### RSC-R13 B+R Composition

**User Story:** As a maintainer, I want the B facade and the R slices to compose without duplicating semantics, so that each layer owns only its scope.

**Acceptance Criteria:**

1. WHEN the feature is delivered THEN it SHALL consist of exactly one B facade (`sessionChannel`) and exactly two replacement packages (`connection`, `gateway`), registered together in feature-list §3.1.1.
2. WHEN a semantic area has no genuine official owner in any component (device pairing, device authentication, resume credential, per-method device authorization, revocation authorization) THEN that area SHALL be implemented by the B facade's pluggable abstraction and SHALL NOT be fabricated into any replacement package.
3. WHEN a semantic area genuinely belongs to an official component (transport carrier, RPC dispatch) THEN that area SHALL be implemented by that component's replacement package and SHALL NOT be reimplemented in the B facade.
4. WHEN the B facade or a replacement package is disabled THEN the remaining packages SHALL fail-safe and SHALL NOT publish incomplete channel capabilities.

### RSC-R14 Cross-Package Coordination and Registration

**User Story:** As a maintainer, I want multi-package assembly coordinated, so that channel identity and generation stay consistent across packages.

**Acceptance Criteria:**

1. WHEN the feature is assembled THEN the B facade and both replacement packages SHALL share one channel identity/generation vocabulary and one feature registration in feature-list §3.1.1.
2. WHEN any replacement package is missing or inactive THEN the B facade SHALL report the missing slice as `unavailable` and SHALL NOT claim a complete channel.
3. WHEN the B facade is missing or inactive THEN the replacement packages SHALL stay silent on channel semantics and SHALL keep their replicated official surface unchanged.
4. WHEN the feature exposes typed results THEN the facade and both replacement packages SHALL share one terminal vocabulary (`success|error|aborted|denied|superseded`, timeout maps to `error`+reason) and typed codes SHALL map 1:1 into that vocabulary without introducing a second terminal category.

### RSC-R15 Trust Model and Auth Abstraction

**User Story:** As a host operator, I want the channel's trust model explicit, so that carrier trust is never mistaken for device authentication.

**Acceptance Criteria:**

1. WHEN a channel is opened THEN the facade SHALL require an explicit registered verifier/authorizer chain and SHALL NOT treat `trustedHosts`/`authority: trusted-host` or any carrier trust as device authentication.
2. WHEN no verifier is registered THEN opening a channel SHALL return typed `unavailable` (fail-closed) and SHALL NOT fall back to unauthenticated delivery.
3. WHEN the facade documents its auth abstraction THEN it SHALL state that authentication strength is determined by the third-party registered chain and SHALL NOT claim a built-in security guarantee.
4. WHEN pairing/verifier/authorizer registration interfaces are exposed THEN they SHALL be paradigm-agnostic and SHALL support multiple flows (approval, PIN, QR, token, custom) without the facade coupling to any one.
5. WHEN multiple verifiers or authorizers are registered THEN the facade SHALL compose them fail-closed (all must accept) by default, replace a prior registration on duplicate `id`, and invoke the chain in registration order; a third-party MAY register a single verifier that implements its own internal composition.
6. WHEN an authentication or authorization check fails THEN the returned error SHALL NOT reveal the existence or state of unrelated devices or sessions.

### RSC-R16 Per-Method Rate Limiting

**User Story:** As a host operator, I want per-method call rates bounded, so that a misbehaving device cannot flood the channel.

**Acceptance Criteria:**

1. WHEN a caller exceeds the declared per-method rate limit THEN the facade SHALL return a bounded typed `rate-limited` result and SHALL NOT create a channel or advance a cursor.
2. WHEN the rate limit is not declared for a method THEN the facade SHALL apply a documented default bound and SHALL NOT fail open.

## Standards Alignment

> 本 feature 全部 16 条需求（RSC-R1–RSC-R16）均为本仓库可外部实现；无 must-upstream 项。U21/U22/U23 为上游登记与退役依据，不构成需求阻塞。

- `capability-strategy.md`: R1–R9 apply per replacement package (two packages, one per component); B facade is not a replacement and follows facade rules; multi-package feature registered in feature-list §3.1.1; cross-cutting dispatch semantics never R.
- `api-shape.md`: primary public face is channel lifecycle/control (B) with a read-only projection face; authorization is pluggable and pure; no hidden mutation in projections.
- `identity-and-lifecycle.md`: channel generation is owner-specific opaque; terminal outcomes use `success|error|aborted|denied|superseded`; timeout is `error` with reason.
- `durable-state-and-scope.md`: any persisted channel/replay record has one declared scope; retry is bounded and capability-declared.
- `visibility-and-redaction.md`: host serialization redacts before wire; tokens, credentials and unrelated session data are never exposed; fail-closed redaction.
- `concurrency-and-cancellation.md`: latest-generation stale guards, cancellation propagation and identity-bound disposers are mandatory.
