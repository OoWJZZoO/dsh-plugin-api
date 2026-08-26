# Stage 1 - Requirements

## Status

SPEC1 Stage 1：Requirements 草案，基于已批准 Goal，等待用户确认。

## Introduction

`remote-session-channel` 为跨设备 session 访问定义统一的 channel、授权、传输、游标、确认和恢复语义。它采用 R 类 replacement 方向，但具体官方 gateway/remote row、runtime identity、client 半面和唯一 owner 必须在 Stage 2 源码审计中冻结。

## Definitions and Boundaries

- **Channel**：一个设备与宿主之间的受授权连接实例，拥有 channel identity、generation 和生命周期。
- **Cursor**：session 事件流中的客户端消费位置，不作为 channel 或 session identity。
- **Resume token**：绑定设备授权与 channel generation 的恢复凭证；其内容不进入普通日志或模型可见面。
- **Delivery**：默认 at-least-once；重复事件通过稳定 dedupe key 消除，系统不宣称 exactly-once。
- **R boundary**：只替换一个官方 gateway/remote loader 行，保留其完整 ctx service/event/HTTP/auth 契约和 import 边界，不跨组件替换。

## Requirements

### RSC-R1 Official Patch Mechanism

**User Story:** As a maintainer, I want the channel replacement installed only through official patching, so that official packages remain untouched.

**Acceptance Criteria:**

1. WHEN the bundle is assembled THEN it SHALL disable exactly the approved official gateway/remote row and insert exactly one replacement row.
2. WHEN the bundle is uninstalled THEN the official row SHALL be restored by the patch mechanism without manual package edits.
3. WHEN any implementation runs THEN it SHALL NOT modify `/usr/lib/node_modules/@deepseek-ai/dsh/**` or any official package file.

### RSC-R2 Official Contract Fidelity

**User Story:** As a plugin consumer, I want the replacement to preserve the official gateway contract, so that existing callers continue to work.

**Acceptance Criteria:**

1. WHEN the replacement is active THEN it SHALL preserve the approved official row's complete ctx service, event, HTTP route, authentication failure, teardown and ordering semantics.
2. WHEN channel support is inactive or degraded THEN the preserved official surface SHALL continue to operate without the new channel extension.
3. WHEN a third-party module imports the official DSH package THEN the import SHALL resolve to the official package rather than the replacement bundle.

### RSC-R3 Boot Self-Check and Fail-Safe

**User Story:** As an operator, I want broken or duplicate channel assembly detected at boot, so that a bad replacement cannot silently run.

**Acceptance Criteria:**

1. WHEN the replacement applies THEN it SHALL verify the target row is disabled, the replacement row is active, required service/route probes pass, and no duplicate owner is present.
2. WHEN any probe fails THEN the replacement SHALL record a diagnostic, return normally from apply, and leave the host boot alive.
3. WHEN the official row is not disabled or a competing replacement is detected THEN the replacement SHALL not run alongside it.

### RSC-R4 Version and Owner Locking

**User Story:** As a maintainer, I want runtime and component identity mismatches rejected, so that channel semantics are never guessed.

**Acceptance Criteria:**

1. WHEN the installed runtime or target official package identity differs from the identities frozen by the approved Design THEN the replacement SHALL disable itself with an explicit typed diagnostic.
2. WHEN another replacement claims the same official component OR duplicate insertion is observed THEN the replacement SHALL fail-safe and SHALL NOT publish channel capabilities.

### RSC-R5 Channel Lifecycle and Authorization

**User Story:** As a remote client, I want an explicitly authorized channel lifecycle, so that only approved devices can observe a session.

**Acceptance Criteria:**

1. WHEN `channel.open({ device, capabilities, resumeToken })` is requested THEN the system SHALL validate device authorization, token binding, requested capabilities and channel scope before creating a channel.
2. WHEN authorization, capability or token validation fails THEN the system SHALL return a typed `denied` or `unavailable` result without creating a partial channel.
3. WHEN `revoke` is called or a channel expires THEN subsequent subscribe, ack and resume operations SHALL be rejected and the old generation SHALL lose submission qualification.
4. WHEN presence or heartbeat is accepted THEN it SHALL update only the owning channel generation and SHALL NOT revive a revoked or expired channel.

### RSC-R6 Subscription, Delivery and Cursor Semantics

**User Story:** As a client, I want deterministic event delivery and acknowledgement, so that reconnects do not silently lose or duplicate session updates.

**Acceptance Criteria:**

1. WHEN `subscribe({ session, cursor })` is accepted THEN the system SHALL deliver events after the requested cursor with session scope and an explicit delivery mode.
2. WHEN an event is delivered more than once THEN each copy SHALL carry the same stable dedupe key and the client SHALL be able to collapse duplicates.
3. WHEN `ack(cursor)` is received THEN the system SHALL advance acknowledgement only monotonically for the same channel generation.
4. WHEN a cursor is malformed, out of scope or older than the retained replay window THEN the system SHALL return a typed resync-required result and SHALL NOT fabricate missing events.

### RSC-R7 Resume and Transport Negotiation

**User Story:** As a remote client, I want to resume after transport loss, so that a temporary network failure does not require a new pairing.

**Acceptance Criteria:**

1. WHEN `resume(token, cursor)` is requested THEN the system SHALL verify token, device, session scope and channel generation before replaying events.
2. WHEN the cursor is within the retained window THEN the system SHALL replay from that cursor using the negotiated transport.
3. WHEN the cursor cannot be replayed continuously THEN the system SHALL return a bounded snapshot/resync response with an explicit gap reason.
4. WHEN multiple transports are available THEN negotiation SHALL choose only an advertised and authorized transport among SSE, polling, WebSocket and loopback.

### RSC-R8 Visibility, Redaction and Audit

**User Story:** As a host operator, I want remote channel data constrained by audience and authorization, so that secrets and unrelated sessions do not leak.

**Acceptance Criteria:**

1. WHEN a remote projection is produced THEN it SHALL enforce session scope, per-method authorization and audience-specific redaction before serialization.
2. WHEN redaction fails OR a secret/credential field is encountered without explicit user/profile policy THEN the system SHALL fail closed and SHALL omit the field.
3. WHEN channel lifecycle or authorization changes occur THEN the system SHALL append bounded audit evidence containing who/what/when/generation, without raw tokens or session content.

### RSC-R9 Concurrency, Cancellation and Disposer Ownership

**User Story:** As a maintainer, I want stale connections and callbacks isolated, so that an old device cannot mutate a newer channel.

**Acceptance Criteria:**

1. WHEN a newer channel generation supersedes an older one THEN all late subscribe, ack, heartbeat, replay and transport callbacks from the older generation SHALL lose submission qualification.
2. WHEN an `AbortSignal` or revoke cancellation is received THEN the system SHALL stop further delivery effort, mark the operation `aborted` where applicable, and SHALL not rewrite an already committed terminal outcome.
3. WHEN a channel disposer runs THEN it SHALL be idempotent and SHALL revoke only resources owned by that channel identity.
4. WHEN the underlying transport cannot stop immediately THEN stale-result guards SHALL prevent late data publication.

### RSC-R10 Durable Scope and Retry Boundary

**User Story:** As a host maintainer, I want channel persistence and retry boundaries explicit, so that reconnect does not create false durability guarantees.

**Acceptance Criteria:**

1. WHEN channel state is persisted THEN it SHALL be assigned to one declared scope (session, workspace or profile) and SHALL not silently span scopes.
2. WHEN a delivery or resume operation is retried THEN the system SHALL use a bounded retry policy and SHALL preserve channel identity, generation and dedupe semantics.
3. WHEN retry capability is not explicitly declared or the operation is `denied`, `aborted` or `superseded` THEN the system SHALL not automatically retry.

### RSC-R11 Client-Half Decision

**User Story:** As a maintainer, I want the replacement's client surface proven, so that host and browser contracts are not accidentally mixed.

**Acceptance Criteria:**

1. WHEN the target official row is audited THEN Requirements/Design SHALL record evidence for client manifest, remote namespace, slot/settings bridge, host-client version negotiation, browser state/reconnect, and client-facing event/service.
2. WHEN any of the six checks is positive THEN the replacement SHALL specify and test a complete client half under R8; WHEN all six are negative THEN the feature SHALL be host-only and SHALL add no client build surface.

### RSC-R12 Upstream Proposal and Retirement

**User Story:** As a maintainer, I want a clear exit path from the replacement, so that an official channel seam can supersede it.

**Acceptance Criteria:**

1. WHEN this feature is delivered THEN it SHALL register an upstream proposal for an official remote session/channel contract.
2. WHEN the official runtime provides equivalent pairing, authorization, resume, replay and transport semantics THEN consumers SHALL be able to migrate to that seam and the replacement SHALL be marked for retirement.

## Standards Alignment

- `capability-strategy.md`: R1–R9 apply; one official gateway owner; no boot/framework replacement; upstream proposal required.
- `api-shape.md`: primary public face is channel lifecycle/projection; authorization policy is pure and explicit; no hidden mutation in projections.
- `identity-and-lifecycle.md`: channel generation is owner-specific opaque; terminal outcomes use `success|error|aborted|denied|superseded` and timeout is `error` with reason.
- `durable-state-and-scope.md`: any persisted channel/replay record has one declared scope; retry is bounded and capability-declared.
- `visibility-and-redaction.md`: host serialization redacts before wire; tokens, credentials and unrelated session data are never exposed.
- `concurrency-and-cancellation.md`: latest-generation stale guards, cancellation propagation and identity-bound disposers are mandatory.
