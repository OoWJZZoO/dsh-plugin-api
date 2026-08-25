# Stage 1 - Requirements

## Status

Stage 1 Requirements 草案，待用户确认。

## Introduction

`coordination-lease` 为第三方插件提供共享资源的 ownership、lease、generation、fencing 与 compare-and-set 契约。它收敛 agent team、task handoff、file claim 和后续 workspace/task feature 的重复并发控制语义，但不拥有业务 task、execution 或 workspace mutation 状态。

本 feature 是 **B 类 host facade**：当前以可用的公开 storage/workspace 能力为基础提供统一语义；若某个能力必须依赖未来官方统一 lease seam，则返回显式 C 类 `upstream-required`/`unavailable` 结果。首版不走 R replacement。Host 是权威面；client 不拥有 lease，也不提供写入或接管面。

## Definitions and Boundaries

- **Resource**：被协调的逻辑资源，必须带明确 scope，不以未验证的任意路径字符串作为全局 identity。
- **Lease handle**：一次 ownership 观察，至少包含 `resource`、`ownerId`、`generation`、`expiresAt`、`fencingToken` 和 backend capability provenance。
- **Stale holder**：generation、fencing token 或 expiry 已不再有效的旧持有者。
- **Durable**：backend 明确确认可在约定 scope 内跨调用/重连恢复的能力；内存 fallback 不得标记为 durable。
- **Host/client boundary**：host 提供 acquire/heartbeat/release/takeover/CAS；client 只可消费已有 host 投影（若调用方自行提供传输），本 feature 不新增 client transport、remote namespace 或 client mutation API。

## Requirements

### CL-1 Resource and owner identity

**User Story:** As a plugin maintainer, I want a stable resource and owner identity, so that different coordination participants do not accidentally share or overwrite one another's lease.

**Acceptance Criteria:**

1. **WHEN** a caller requests coordination for a resource **THEN** the facade SHALL require a non-empty owner identity, an explicit resource scope, and a canonical resource key.
2. **WHEN** two requests use different scopes or canonical resource keys **THEN** the facade SHALL treat them as distinct resources even when their display labels match.
3. **WHEN** a caller omits, mutates, or supplies an invalid identity field **THEN** the facade SHALL reject the request with a typed validation result before contacting the backend.
4. **WHERE** an operation is associated with `execution-observation`, `recovery-policy`, or `workspace-mutation-transaction` **THEN** the coordination record SHALL preserve those supplied identities as provenance and SHALL NOT mint a replacement execution or task identity.

**Classification:** B (host facade validation and projection).

### CL-2 Acquire and lease state

**User Story:** As a plugin maintainer, I want to acquire a lease with explicit expiry, so that ownership is bounded and observable.

**Acceptance Criteria:**

1. **WHEN** an eligible resource is unowned or its existing lease is confirmed expired **THEN** the facade SHALL return a lease handle containing `ownerId`, a strictly newer `generation`, `expiresAt`, and a unique `fencingToken` for that acquisition.
2. **WHEN** a resource has an unexpired lease owned by another owner **THEN** the facade SHALL return a deterministic conflict/unavailable result and SHALL NOT silently replace the current owner.
3. **WHEN** a caller requests an invalid, negative, or unbounded lease duration **THEN** the facade SHALL reject it before acquisition and SHALL not create a partial lease.
4. **WHEN** acquisition succeeds **THEN** the returned state SHALL identify the backend and whether the lease is durable, session-scoped, workspace-scoped, or memory-scoped.

**Classification:** B (host facade over public coordination/storage capability).

### CL-3 Heartbeat and expiry

**User Story:** As a lease holder, I want to renew ownership without changing its identity, so that long-running work does not lose its fencing context.

**Acceptance Criteria:**

1. **WHEN** the current holder heartbeats with the exact active handle **THEN** the facade SHALL extend expiry according to the accepted policy while preserving `ownerId`, `generation`, and `fencingToken`.
2. **WHEN** a heartbeat uses an old generation, wrong owner, wrong fencing token, or an already expired handle **THEN** the facade SHALL reject it as stale and SHALL NOT revive the lease.
3. **WHEN** the backend cannot confirm heartbeat success **THEN** the facade SHALL report the lease as uncertain/unavailable and SHALL not claim continued ownership.
4. **WHEN** a lease expires or is superseded **THEN** later heartbeats from that handle SHALL remain rejected, including after reconnect.

**Classification:** B; a backend lacking the required compare/expiry guarantee is C (`upstream-required`) for that operation.

### CL-4 Release and identity-bound disposal

**User Story:** As a lease holder, I want to release only my own active lease, so that cleanup cannot revoke a newer owner's lease.

**Acceptance Criteria:**

1. **WHEN** the holder releases an active lease using its exact identity **THEN** the facade SHALL mark that generation released and SHALL make subsequent writes with its fencing token invalid.
2. **WHEN** a disposer is called more than once **THEN** the facade SHALL make the operation idempotent and SHALL not affect an unrelated or newer generation.
3. **WHEN** a stale or foreign holder attempts release **THEN** the facade SHALL reject or report no-op according to the documented typed outcome and SHALL preserve the current active owner.
4. **WHEN** release fails at the backend **THEN** the facade SHALL expose the failure and SHALL not claim that the resource was released.

**Classification:** B.

### CL-5 Conditional takeover

**User Story:** As a coordinator, I want takeover to require an expiry or version proof, so that a live owner is not displaced by an arbitrary caller.

**Acceptance Criteria:**

1. **WHEN** a caller requests takeover **THEN** the facade SHALL require an explicit expected expiry, expected generation, or equivalent backend proof of staleness.
2. **WHEN** the expected staleness proof does not match the current record **THEN** the facade SHALL reject the takeover without changing the current lease.
3. **WHEN** takeover succeeds **THEN** the facade SHALL create a new generation and fencing token, invalidate the previous handle, and preserve takeover provenance.
4. **WHEN** the backend cannot atomically verify staleness and publish the new generation **THEN** the facade SHALL return `unsupported`/`upstream-required` and SHALL not emulate takeover with an in-memory flag.

**Classification:** B where the backend supplies the atomic primitive; otherwise C.

### CL-6 Fenced writes and compare-and-set

**User Story:** As a plugin maintainer, I want stale holders to be unable to write, so that delayed or replayed work cannot corrupt shared state.

**Acceptance Criteria:**

1. **WHEN** a protected write carries the active fencing token and expected generation **THEN** the facade SHALL allow the write only if both match the current record.
2. **WHEN** a protected write carries a stale, foreign, missing, or malformed fencing token **THEN** the facade SHALL reject it before publishing a state change.
3. **WHEN** a caller performs compare-and-set **THEN** the facade SHALL publish the new value only when the expected version exactly matches and SHALL return the committed version.
4. **WHEN** compare-and-set detects a conflict **THEN** the facade SHALL leave the prior value unchanged and SHALL return the observed conflict provenance without leaking secret value contents.
5. **WHEN** the backend cannot provide atomic compare-and-set **THEN** the facade SHALL report `unsupported`/`upstream-required` rather than claim a durable CAS guarantee.

**Classification:** B for an authoritative public atomic backend; C otherwise.

### CL-7 Watch and stale notification

**User Story:** As a coordinator, I want to observe ownership changes, so that waiting participants can stop stale work promptly.

**Acceptance Criteria:**

1. **WHEN** a caller subscribes to a valid resource watch **THEN** the facade SHALL deliver immutable state transitions with generation, expiry, fencing and provenance metadata, subject to the caller's scope.
2. **WHEN** a watch is disposed **THEN** the facade SHALL stop delivering events for that subscription and SHALL not dispose another owner's or another subscription's observer.
3. **WHEN** a watch observes reconnect, missed events, or an uncertain backend state **THEN** the facade SHALL report resync/unavailable information explicitly and SHALL not infer a healthy active lease from silence.
4. **WHEN** an observer callback throws or returns a rejected thenable **THEN** the facade SHALL contain the observer failure and SHALL keep the coordination service and harness boot alive.

**Classification:** B; any missing official event/reconnect guarantee is C for that portion.

### CL-8 Scope, durability, and capability truthfulness

**User Story:** As a plugin maintainer, I want to know what coordination guarantee is actually available, so that local fallback is not mistaken for distributed safety.

**Acceptance Criteria:**

1. **WHEN** a caller queries availability **THEN** the facade SHALL distinguish `available`, `unavailable`, `unsupported`, and `unknown` and SHALL identify the applicable scope and durability.
2. **WHEN** only an in-memory backend is available **THEN** the facade SHALL label it non-durable and SHALL not claim cross-process, cross-restart, or cross-session recovery.
3. **WHEN** a scope or backend boundary prevents a requested operation **THEN** the facade SHALL fail closed for that operation and SHALL preserve unrelated plugin features.
4. **WHEN** a backend returns malformed state or throws during apply-time setup **THEN** the feature SHALL record a bounded diagnostic and SHALL return without killing harness boot.

**Classification:** B for projection/guard; C for guarantees not exposed by the official backend.

### CL-9 Security and visibility

**User Story:** As a plugin maintainer, I want coordination observations to be safe to inspect, so that ownership diagnostics do not expose secrets or private resource contents.

**Acceptance Criteria:**

1. **WHEN** a lease or CAS record is returned to a consumer **THEN** the facade SHALL expose identity, state, expiry, version, and bounded provenance but SHALL redact credentials, tokens not intended for observation, and private value contents.
2. **WHEN** a caller requests a resource outside its declared scope **THEN** the facade SHALL deny or return unavailable without revealing whether a private resource exists.
3. **WHEN** redaction or freezing fails **THEN** the facade SHALL fail closed for that projection and SHALL not return a partially protected object.

**Classification:** B.

### CL-10 Client boundary and integration

**User Story:** As a client plugin maintainer, I want a truthful boundary, so that browser code cannot accidentally act as a lease authority.

**Acceptance Criteria:**

1. **WHEN** a client consumer receives coordination information through an existing host projection **THEN** it SHALL receive read-only, redacted state with explicit availability and generation metadata.
2. **WHEN** client code attempts acquire, heartbeat, release, takeover, or CAS through this feature's client surface **THEN** the feature SHALL expose no such mutation surface and SHALL return an explicit unavailable/unsupported result rather than inventing a client authority.
3. **WHEN** no compatible host projection exists **THEN** the client SHALL remain inert/degraded and SHALL not prevent unrelated client faces from loading.

**Classification:** B facade boundary; no C client transport is introduced in this feature.

## Non-Goals

- A worker scheduler, task queue, workflow engine, provider executor, or automatic retry controller.
- A general-purpose distributed database or a promise of cross-process locking when the backend cannot prove it.
- Automatic checkpoint restore, workspace transaction semantics, route selection, approval bypass, or external-side-effect compensation.
- Any R replacement, official package modification, or new client transport/remote protocol.
