# Requirements: plugin-api-session-durable-m2

> feature_name: `plugin-api-session-durable-m2`
> 状态：已完成（Stage 4）
> 范围：S2 + O8 + O13 + O14
> 上游：`plugin-api-session-m1`、`plugin-api-semantic-hooks-m2`
> 面：仅 host
> 分类：O8/O13/O14 为 A 类 durable-record observation；S2 为 B 类 constrained surface-append helper

---

## Introduction

`plugin-api-session-durable-m2` 在既有 `ctx.pluginApi.session` 命名空间中补齐两类彼此明确分离的 host 能力：

1. 对指定 `Session` 的受限 durable session-log 记录进行类型化观察，范围仅为 O8、O13、O14：`approval/policy`、`approval/asked`、`approval/decided`、`schedule/change`、`subagent/descriptor`。
2. 通过受约束的 `appendMessage()` helper 向指定 `Session` 追加合法的 surface message durable 记录，而不要求插件作者手写 `surfaceOp`、`sourceEventSeqs` 或直接绕过官方 `Session.append()`。

本 feature 中的 durable record 是已写入 session log 的记录；它不是 Cordis 生命周期事件。`session/created`、`session/disposed`、`session/event`、`session/flush` 仍是 `plugin-api-session-m1` 的生命周期事件，尤其 `session/event` 只是本 feature 的官方观察基底，不能被重新命名、重新派发或加入 `pluginApi.events`。

### Terms

- **target session**：调用者显式传入的 live 官方 `Session` 对象。API 不从当前 fiber、agent、session id 或隐式上下文猜测目标。
- **durable event kind**：本 feature 白名单中的 session-log `type` 字符串，不是 Cordis event name。
- **surface message kind**：官方定义为可 surface 的 message 型 session-log event kind；它与 durable-observation 白名单是不同的集合。
- **committed record**：已由官方 `Session.append()` 同步提交到目标 session log 的记录。
- **preflight validation**：调用官方 `Session.append()` 前进行的门面输入和元数据校验。官方 append validator 始终是最终权威。
- **source-audited append contract**：由 Stage 2 对安装版本的官方 event map 与实际生产点共同核定的有限 `SurfaceMessageKind` 表；每个条目固定输入 payload 语法、允许的 source-reference 关系、构造的 surface metadata 与返回 snapshot 形状。未核定的 kind 不属于 API。

---

## Requirements

### 1. Explicit host API and classification boundary

**User Story:** As a host-plugin author, I want an explicit, session-targeted durable API under `pluginApi.session`, so that I can distinguish durable records from Cordis lifecycle events and cannot accidentally write to an inferred session.

**Acceptance Criteria:**

1. WHEN the `sessionDurable` feature is active, THEN `pluginApi.session` SHALL expose `durableEventTypes`, `durableEventDescriptors`, `isDurableEventType(value)`, `getDurableEventDescriptor(kind)`, `onDurable(targetSession, kind, listener)`, `onceDurable(targetSession, kind, listener)`, and `appendMessage(targetSession, kind, payload, { sourceEventSeqs?: readonly number[] }?)`.
2. GIVEN valid durable-observation arguments, WHEN a plugin calls `onDurable` or `onceDurable`, THEN the call SHALL synchronously return an idempotent `() => boolean` disposer.
3. GIVEN valid append arguments and a successful official append, WHEN a plugin calls `appendMessage`, THEN the call SHALL synchronously return the immutable committed-record snapshot specified for that appendable kind by the source-audited append contract.
4. WHEN a durable observation or append API is called, THEN its first argument SHALL be an explicit target `Session` object, and the API SHALL NOT accept a session id, infer a target from ambient context, or default to another session.
5. WHEN `onDurable` or `onceDurable` accepts a `kind`, THEN the kind SHALL be one of the feature's `durableEventTypes`; wildcard, prefix, array, and unknown-kind subscriptions SHALL NOT be supported.
6. WHEN `appendMessage` accepts a `kind`, THEN the kind SHALL be a member of the finite source-audited `SurfaceMessageKind` subset of S5 `surfaceEventTypes`, and its payload and return snapshot SHALL conform to that kind's published append contract; an arbitrary session-log type SHALL NOT become appendable merely because it is a string.
7. WHEN a caller uses `pluginApi.session.on/once` with a lifecycle event name, THEN the delivered S1 lifecycle behavior SHALL remain unchanged; durable observation SHALL require `onDurable` or `onceDurable` and SHALL NOT overload lifecycle subscription semantics.
8. WHEN this feature exposes durable observation, THEN it SHALL classify O8, O13, and O14 as A-class observation backed by an official `session/event` publication that supplies the required target, timing, and committed-record identity; the target session log MAY be read only to form a snapshot.
9. WHEN this feature exposes `appendMessage`, THEN it SHALL classify S2 as a B-class helper over the official append contract.
10. WHEN a durable record is observed or appended through this feature, THEN the feature SHALL NOT add that record to `pluginApi.events`, `baseEventsCatalog`, or any synthetic Cordis-event namespace.

---

### 2. Durable event catalog, descriptors, and type guards

**User Story:** As a host-plugin author, I want a narrow immutable catalog of supported durable records, so that my code can handle approval, schedule, and subagent state without treating unknown session-log types as supported API.

**Acceptance Criteria:**

1. WHEN the durable catalog initializes successfully, THEN `durableEventTypes` SHALL be an immutable catalog containing exactly `approval/policy`, `approval/asked`, `approval/decided`, `schedule/change`, and `subagent/descriptor`.
2. WHEN `durableEventDescriptors` is exposed, THEN it SHALL be immutable and SHALL provide a descriptor for every and only every kind in `durableEventTypes`.
3. WHEN a descriptor is published, THEN it SHALL identify the durable event kind, its official session-log source, its verified payload shape, and its verified surface eligibility without claiming an unverified producer field or event version.
4. WHEN `pluginApi.session.isDurableEventType(value)` is called, THEN it SHALL return `true` if and only if `value` is a durable event kind in `durableEventTypes`, and SHALL return `false` without throwing for every other input.
5. GIVEN a supported durable kind, WHEN `pluginApi.session.getDurableEventDescriptor(kind)` is called, THEN it SHALL return that kind's immutable descriptor.
6. GIVEN an unsupported durable kind, WHEN `pluginApi.session.getDurableEventDescriptor(kind)` is called, THEN it SHALL return `undefined` and SHALL NOT widen the supported catalog.
7. WHEN a plugin attempts to mutate the durable event type catalog or a descriptor, THEN the attempted mutation SHALL NOT change any exposed catalog or descriptor value.
8. WHEN the existing S5 `sessionEventTypes` or `surfaceEventTypes` catalog is read, THEN this feature SHALL preserve its approved M1 meaning and SHALL NOT add, remove, or silently reinterpret an S5 catalog entry to represent this O8/O13/O14 subset.
9. WHEN a descriptor is published for `schedule/change`, THEN it SHALL expose only the version and operation variants verified by both the installed official event map and an actual official production point.

---

### 3. Durable observation for a specified session

**User Story:** As a host-plugin author, I want to observe a supported durable record for one specified session, so that approval, scheduling, and subagent state can be handled after official commit without observing unrelated sessions or replaying ambiguous history.

**Acceptance Criteria:**

1. GIVEN an active feature, a valid target session, a supported durable event kind, and a callable listener, WHEN a plugin calls `onDurable(targetSession, kind, listener)`, THEN the facade SHALL synchronously register one live observation and SHALL return an idempotent `() => boolean` disposer that prevents subsequent delivery for that registration.
2. GIVEN an active feature, a valid target session, a supported durable event kind, and a callable listener, WHEN a plugin calls `onceDurable(targetSession, kind, listener)`, THEN the facade SHALL synchronously register one live observation, SHALL return an idempotent `() => boolean` disposer, and SHALL remove that observation before any second matching record can be delivered.
3. WHEN the target session commits a matching durable record after an observation is registered, THEN the observer SHALL receive that committed record exactly once for that registration after the official commit point.
4. WHEN another session commits an otherwise matching durable record, THEN an observation registered for a different target session SHALL NOT receive it.
5. WHEN the target session has a matching record that was committed before an observation is registered, THEN the observation SHALL NOT replay that historical record or synthesize a catch-up notification.
6. WHEN the target session commits a durable record with a kind outside `durableEventTypes`, THEN the feature SHALL preserve the official record and SHALL NOT deliver it through this feature's typed observation API.
7. GIVEN the official `session/event` publication provides the required target, timing, and committed-record identity, WHEN durable observation is registered, THEN the feature SHALL use that official publication as its live observation substrate and MAY read the target session log only to form the read-only record snapshot.
8. GIVEN the official `session/event` publication does not provide every required target, timing, or committed-record identity characteristic, WHEN the feature applies, THEN `sessionDurable` SHALL remain inactive through P2 and SHALL NOT poll, rescan, or synthesize a session-log notification.
9. WHEN `onDurable` or `onceDurable` receives an invalid target session, unsupported kind, or non-callable listener while the feature is active, THEN it SHALL synchronously throw a `TypeError` with a stable validation code and SHALL not register an observation.
10. WHEN a durable observer is invoked, THEN the listener SHALL receive exactly one positional argument: the read-only committed-record snapshot whose kind, sequence identity, payload, and surface metadata agree with the official record at dispatch time.
11. WHEN a durable observer listener throws or rejects, THEN the facade SHALL contain and diagnose that listener failure using the established S1 facade listener-failure policy, SHALL continue other facade durable observers, and SHALL NOT change the commit, return, or raw-observer failure behavior of official `Session.append()`.
12. WHEN a raw official `session/event` observer outside this facade throws or rejects, THEN this feature SHALL NOT intercept, reclassify, or alter that observer's official failure behavior.

---

### 4. Official shape conformance and read-only data boundary

**User Story:** As a plugin author, I want durable payloads and append results to be trustworthy read-only values, so that handling session records cannot mutate official state or depend on a guessed event schema.

**Acceptance Criteria:**

1. WHEN the feature supports any O8, O13, or O14 kind, THEN its descriptor, observer payload type, and validation behavior SHALL be derived from both the installed official event map and at least one actual official production point for that kind.
2. WHEN the installed official event map and a production point disagree about a supported durable record's discriminator, payload, or metadata contract, THEN `sessionDurable` SHALL remain inactive through P2 until the discrepancy is resolved.
3. WHEN an observer receives an object, array, or nested payload from a committed record, THEN mutation through that received value SHALL NOT mutate the target session log, the official surface state, or a later observer's view.
4. WHEN `appendMessage` succeeds, THEN it SHALL return an immutable snapshot of the committed surface message record without exposing a mutable path back into the target session.
5. WHEN a caller mutates the input payload or options after a successful append, THEN that mutation SHALL NOT mutate the durable record that was committed by the helper.
6. WHEN `appendMessage` receives a live host object, service, signal, function, or other non-data value as payload, THEN it SHALL synchronously throw a `TypeError` with a stable validation code before persistence and SHALL NOT expose that value as a durable event payload.

---

### 5. Constrained surface message append helper (S2)

**User Story:** As a plugin author who needs to surface a session message, I want a helper that builds a legal append record for a named target session, so that I can stop hand-authoring fragile surface metadata while retaining official append behavior.

**Acceptance Criteria:**

1. WHEN `sessionDurable` activates, THEN it SHALL have a finite source-audited append contract for every accepted `SurfaceMessageKind`, and each contract entry SHALL specify the accepted JSON payload grammar, permitted `sourceEventSeqs` relationship, generated official surface metadata, and immutable committed-record snapshot shape.
2. GIVEN an active feature, a valid target session, and inputs conforming to one source-audited append contract entry, WHEN a plugin calls `appendMessage(targetSession, kind, payload, { sourceEventSeqs?: readonly number[] }?)`, THEN the helper SHALL construct one surface message event for that target session and SHALL invoke the official `Session.append()` exactly once for that construction.
3. WHEN `appendMessage` accepts options, THEN the only caller-controlled option SHALL be `sourceEventSeqs`, and the helper SHALL NOT accept a caller-supplied full event body, arbitrary event metadata, or an alternate surface operation.
4. WHEN the helper constructs an appendable surface message event, THEN it SHALL set `surfaceOp` to `'append'` and SHALL NOT permit the caller to replace it with another surface operation.
5. WHEN source event sequences are supplied through the documented option, THEN the helper SHALL preserve their intended causal order only after validating them against the target session and the applicable source-audited append contract.
6. GIVEN source event sequences are omitted and the applicable source-audited append contract yields one unambiguous valid derivation, WHEN `appendMessage` is called, THEN the helper SHALL derive those source event sequences before calling official `Session.append()`.
7. GIVEN source event sequences are omitted and the applicable source-audited append contract does not yield one unambiguous valid derivation, WHEN `appendMessage` is called, THEN the helper SHALL synchronously throw a `TypeError` with a stable validation code before writing rather than fabricate a causal relationship.
8. GIVEN a requested kind has no source-audited append contract, is not in the audited `SurfaceMessageKind` subset, or is not surface eligible under the installed official contract, WHEN `appendMessage` is called, THEN it SHALL synchronously throw a `TypeError` with `code: 'unsupported-surface-message-kind'` before calling `Session.append()`.
9. WHEN the helper successfully returns, THEN exactly one new durable record SHALL have been appended to the target session, the returned immutable snapshot SHALL conform to the applicable source-audited append contract and agree with that record, and no existing durable record or surface history SHALL have been modified.
10. WHEN an `appendMessage` commit is re-observed through an official session substrate, THEN the helper SHALL NOT re-enter `Session.append()` or create a duplicate durable record for that logical append.
11. WHEN a third-party plugin bypasses `appendMessage` and calls an official session API directly, THEN this feature SHALL neither intercept nor provide a compatibility guarantee for that unsupported escape path.

---

### 6. Preflight validation and causal metadata

**User Story:** As an operator, I want malformed surface messages rejected before persistence, so that plugin input cannot silently serialize incorrectly, reference invalid causes, or create an illegal surface operation.

**Acceptance Criteria:**

1. GIVEN the feature is active, WHEN `appendMessage` receives an invalid target session, unsupported kind, invalid payload, invalid option shape, or invalid source-event sequence reference, THEN it SHALL synchronously throw a `TypeError` with a stable validation code before calling official `Session.append()` and SHALL leave the target session log and surface state unchanged.
2. WHEN the facade throws a durable-input validation `TypeError`, THEN its `code` SHALL be one of `invalid-target-session`, `unsupported-durable-kind`, `unsupported-surface-message-kind`, `invalid-listener`, `non-json-payload`, `invalid-options`, `invalid-source-event-seqs`, or `indeterminate-source-event-seqs`.
3. WHEN an append payload is accepted, THEN it SHALL be losslessly JSON-serializable: it SHALL contain only JSON-compatible data, SHALL contain no cyclic reference, and SHALL not rely on coercion, omission, or replacement of `undefined`, functions, symbols, bigints, non-finite numbers, or other non-JSON values.
4. WHEN source event sequences are accepted, THEN every sequence SHALL identify an existing permitted source record in the same target session and SHALL satisfy the official ordering, uniqueness, and eligibility rules for the requested surface message kind.
5. WHEN the helper derives or validates source event sequences, THEN it SHALL verify the generated `surfaceOp: 'append'` and source-reference metadata before the append call while leaving the official append validator as final authority.
6. GIVEN the feature is active, WHEN a preflight check cannot establish whether a requested append is legal, THEN the helper SHALL synchronously throw a `TypeError` with `code: 'indeterminate-source-event-seqs'` before persistence and SHALL record a contained diagnostic without exposing payload content.
7. WHEN official `Session.append()` throws after an event has passed facade preflight, THEN the helper SHALL synchronously propagate that official failure unchanged and SHALL NOT retry, patch the event, or write an alternate record.
8. WHEN official `Session.append()` commits a record and an official observer subsequently fails, THEN the helper SHALL preserve the official synchronous commit and raw-observer failure semantics and SHALL NOT roll back, duplicate, or hide the committed record.

---

### 7. Availability, lifecycle, and fail-safe behavior

**User Story:** As an operator, I want the durable extension to fail independently of the existing session facade, so that a missing official durable substrate never prevents harness boot or disables M1 session features.

**Acceptance Criteria:**

1. GIVEN the required official session services, public durable-observation substrate, and complete source-audited append contract are available, WHEN the host plugin applies, THEN the feature SHALL activate its `sessionDurable` capability without changing the approved lifecycle of the existing `pluginApi.session` namespace.
2. GIVEN a required official dependency is missing, malformed, or throws during guard or mount, or the source audit cannot establish a complete append contract, WHEN the host plugin applies, THEN the `sessionDurable` capability SHALL remain inactive through P2, SHALL record a contained diagnostic, and SHALL NOT throw through `apply()` or disable other `pluginApi` features.
3. WHEN the core is inactive, THEN every durable entry point SHALL present the foundation P1 inactive-core failure.
4. WHEN the `sessionDurable` capability is inactive after a mandatory dependency or feature guard failure, THEN every durable entry point SHALL present the foundation P2 feature-disabled failure for `sessionDurable`, and already delivered S1/S3/S4/S5 session capabilities SHALL remain governed by their own M1 availability contract.
5. WHEN the feature is active, THEN `featureRegistry.isActive('sessionDurable')` SHALL be its only authoritative active signal.
6. WHEN host apply re-enters, the feature is disposed, or a returned observer disposer is invoked repeatedly, THEN the feature SHALL prevent duplicate observation registrations and SHALL not throw through host lifecycle disposal.
7. WHEN internal feature logging fails or is absent, THEN that failure SHALL NOT affect observation, append behavior, or host apply.
8. WHEN the feature cannot safely validate a source record or append input, THEN it SHALL fail closed for that requested append while preserving unrelated official session operations unchanged.

---

### 8. Migration, client boundary, and non-goals

**User Story:** As a maintainer of a host plugin, I want this feature to replace only the documented surface-metadata hack, so that migration does not add a browser API, mutate history, or broaden access to arbitrary session events.

**Acceptance Criteria:**

1. WHEN `dsh-pro-ex-ability-anchor` migrates an S2 surface-message write to this facade, THEN it SHALL be able to delegate `surfaceOp: 'append'` construction and `sourceEventSeqs` validation or derivation to `pluginApi.session.appendMessage()` rather than hand-authoring that metadata.
2. WHEN this feature is implemented, THEN it SHALL NOT add an O8, O13, or O14 event entry to `pluginApi.events` or `baseEventsCatalog`.
3. WHEN this feature is implemented, THEN it SHALL NOT offer a generic append API for unknown durable event kinds, modification of existing durable history, a persistence backend, or a fake replayable Cordis event.
4. WHEN this feature is implemented, THEN it SHALL NOT create a client bundle, remote namespace, browser event bridge, or client-side translation path.
5. WHEN a durable record requires an unsupported official data shape or surface behavior that cannot be safely implemented through public APIs, THEN the feature SHALL stop at its declared boundary and SHALL not present an emulation as supported.

---

## Host / Client Coverage

- **Host:** All capabilities in this feature are exposed through `ctx.pluginApi.session` in the host Cordis tree.
- **Client:** No browser-facing API, client bundle, remote contribution, slot, or settings bridge is introduced.

---

## Parallel-worktree Contract Note

This feature deliberately extends the already approved public `pluginApi.session` namespace rather than creating a parallel `pluginApi.sessionDurable` namespace. Its runtime feature key is `sessionDurable`; this is a necessary, recorded deviation from the generic parallel-workflow naming guideline because a second public session namespace would make the target-session API less coherent. The Stage 2 design must identify the additive ownership boundary, mount dependency, allowed shared-file edits, and P1/P2 failure presentation before any implementation task is planned. No implementation work is authorized by this note.

---

## Non-goals

- Reclassifying O8, O13, or O14 as ordinary `pluginApi.events` / Cordis events.
- Re-dispatching durable records as synthetic lifecycle events.
- Bypassing, replacing, monkey-patching, or duplicating official `Session.append()` persistence, freeze, or observer behavior.
- Providing arbitrary unknown event-type writes, history mutation, or persistence implementation.
- Extending S5's existing catalogs beyond their approved M1 meaning.
- Adding a client-side durable observer or append API.
