# Stage 1 - Requirements

> feature_name: `session-permission-preset-control`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）。Goal 于 2026-09-11 获批；Requirements 与 Design 同批交付（2026-09-12）。
> 上游输入：`docs/specs/session-permission-preset-control/goal.md`（已批准）；M10 工作纲领 §3.5（OBS-05）；观察报告 §5 OBS-05；M7 deletion report B4-4 批准记录与「后续 B 类接口义务」。

## Status

Stage 1 Requirements（2026-09-12 与 Design 同批交付，Stage 0–2 已交付；Goal 于 2026-09-11 获批）。本文件依据已批准的 Stage 0 Goal 与本仓库 `docs/standards/` 各分册编写。每条需求标注 A/B/C 实现通道分类。

## Introduction

`session-permission-preset-control` 为受信操作方提供受控、可追溯的目标权限预设选择面：查询可用预设与当前生效选择、为明确目标选择预设，并使官方权限判定、状态投影与真实工具审批行为随之一致变化。主公开面是 mutation（受控状态写入，官方 preset authority 保留）；预设查询与选择读取是只读面。

实现通道方向：**A 类受控包装（方案一门面转译）**。官方 `dsh-permission-presets` 组件在冻结 runtime 中保留写入 seam（类型含 `set(session, name)`），门面 `services.permissionPresets` 白名单现仅 `current`/`resolve`/`optionOf`。观察报告已明确：本轮样本中直接 setter 调用的消费者证据弱于 Plan Mode，本 feature 不伪造消费者；立项与验收依据是 M7 人类裁决登记的替代义务本身，验收必须证明官方 preset 状态与真实执行判定变化，而非只新增门面自有登记。观察通道若 Design 核实无官方事件点，则按 B 类模拟并记录 fail-safe。

公共面为 host 面：client 端经插件自身 remote 调用 host 面，本 feature 不新增公共 client 半面；低信任 client/remote 不得借本面扩大权限。选择预设、一次批准（approval）与注册 security policy 是三种不同行为，本 feature 不混义。Plan Mode 与权限预设正交，各归唯一 owner。

本 feature 在 AGENTS.md §3.0.1 冻结基线内交付：不步进 `A`/`B.C`/`D`（现行 `0.1.0-rc.6-0.1.0`，`dsh.api: 0.1`）；公共成员与语义在交付时同步 canonical registry 与 capability/availability 记录。

## Requirement 1: Preset Query Projection

**User Story:** As a plugin author, I want to query the available permission presets and the current effective selection of a target, so that my UI offers real choices instead of guessed names.

### Acceptance Criteria

1. WHEN a caller queries the available presets THEN the system SHALL return a frozen view of the official preset options — each with its identity and a bounded, non-sensitive description — sourced from the official authority, and SHALL NOT fabricate or locally rename options.
2. WHEN a caller queries the current effective selection of a target THEN the system SHALL return the official current selection (or its typed absence) for that target.
3. WHEN the official service is unavailable or degraded THEN the query faces SHALL return typed unavailable/degraded views and SHALL NOT throw across the caller.

**Classification:** A projection over the official service; projection shape per `api-idioms.md` §3.1; target/inheritance semantics follow the official service as verified in the design.

## Requirement 2: Controlled Preset Selection Entry

**User Story:** As an authorized operator, I want one supported entry to select a permission preset for a target, so that I never call the raw official setter and every selection is attributable.

### Acceptance Criteria

1. WHEN an authorized caller selects a preset by name for an existing target THEN the system SHALL invoke the official selection seam with the caller's intent and SHALL return a frozen discriminated result `{ ok, code, reason?, ... }` per the mutation idiom.
2. WHEN the selection commits THEN the official selection state SHALL evidence the change; a result claiming success without official-state evidence SHALL be a contract violation.
3. WHEN the preset name is unknown to the official options, or the target is invalid or closed THEN the system SHALL return a typed rejected result before any state change, SHALL NOT fall back silently to a default preset, and the official state SHALL remain unchanged.
4. WHEN the official seam rejects or cannot complete the selection THEN the result SHALL report the typed failure and the official state SHALL remain unchanged.

**Classification:** A（官方写入 seam 存在，受控稳定化 + 包装）；mutation idiom per `api-idioms.md` §3.3.

## Requirement 3: Pre-Submit Authority, Scope And Trust Checks

**User Story:** As a maintainer, I want authorization decided before any side effect and low-trust callers unable to widen permissions, so that the selection face cannot become an escalation path.

### Acceptance Criteria

1. WHEN a selection request arrives THEN authority and scope checks SHALL complete before any side effect; unauthorized or out-of-scope requests SHALL yield typed `denied`/`rejected` results with bounded reason and no state change.
2. WHEN a request originates from a low-trust client/remote context THEN the trust boundary (user/profile policy and official trust checks) SHALL apply, and the request SHALL NOT expand the caller's permissions; the mechanism SHALL reuse the owning authorities and SHALL NOT create a parallel permission system.
3. WHEN authorization cannot be determined THEN the system SHALL fail closed (typed denied/unavailable), never open.
4. WHEN a caller attempts to claim an owner that is not its own THEN the system SHALL derive owner identity from the actual caller context and SHALL NOT accept caller-reported ownership.

**Classification:** A consumption of official trust/policy seams; owner derivation per `composition-and-authority.md` §5; 不通过任何高优先级 hook 自动绕过用户/profile 的拒绝。

## Requirement 4: Read / Event / Real-Behavior Consistency

**User Story:** As a plugin author, I want the read face, change events and the actual tool-approval behavior to agree, so that "preset X is active" means approvals really follow preset X.

### Acceptance Criteria

1. WHEN a selection commits THEN the read face, the change observation and the real tool-approval behavior SHALL all reflect the selected preset; delivery evidence SHALL verify at least one real approval decision changing per the selected preset.
2. WHEN the preset changes through any official path (official UI, official internals) THEN the observation SHALL deliver it and the read face SHALL reflect it — the observation SHALL NOT be limited to facade-initiated changes.
3. WHEN the facade cannot evidence the official selection change THEN it SHALL report the typed failure instead of claiming success.

**Classification:** A consistency requirement; observation channel A/B per design verification of official event points (B derivation recorded with fail-safe if needed); authority closure per `composition-and-authority.md` §6.

## Requirement 5: Observation Face

**User Story:** As a plugin author, I want to observe preset changes for any target, so that multi-surface UIs stay in sync with the runtime.

### Acceptance Criteria

1. WHEN a preset selection changes for any target THEN subscribers SHALL receive the new selection with an observed-at time via the projection-observe idiom `{ current(), subscribe(listener), dispose(), epoch }` shape declared by the design.
2. WHEN a subscriber callback throws or rejects THEN containment SHALL affect only that listener; disposed subscriptions SHALL stop callbacks without affecting other subscribers.
3. WHEN no official event point exists THEN the design SHALL declare the derivation mechanism and its B-class classification; the observed facts SHALL be verified against the official state and SHALL degrade typed when the source is unavailable.

**Classification:** A where an official event point exists; B（底层模拟）only if the design verifies none exists; projection shape per `api-idioms.md` §3.1.

## Requirement 6: Concurrency And Conflicts

**User Story:** As a plugin author, I want racing selections for the same target to resolve deterministically and explicitly, so that no two callers both believe they won.

### Acceptance Criteria

1. WHEN two or more owners submit selections for the same target within a race window THEN the outcomes SHALL be deterministic per the design-declared conflict rule; at most one racing result SHALL claim committed success, the others SHALL receive typed `superseded`/`conflict` outcomes, and the final official state SHALL be one of the declared legal resolutions.
2. WHEN the same owner repeats an identical selection THEN the system SHALL return the design-declared idempotent result and SHALL NOT record it as a second distinct selection.
3. WHEN official arbitration already resolves a race THEN the facade SHALL preserve and faithfully surface it instead of overlaying its own winner.

**Classification:** A（官方仲裁保留）+ Design 声明的冲突规则；concurrency declaration per `concurrency-and-cancellation.md` §6; terminal vocabulary per `identity-and-lifecycle.md` §3.

## Requirement 7: Audit And Traceability

**User Story:** As a maintainer, I want every selection attempt attributable with bounded evidence, so that preset changes are diagnosable without leaking content.

### Acceptance Criteria

1. WHEN a selection attempt reaches the official seam, or is rejected before submission THEN the system SHALL record a bounded audit entry containing who (derived owner), what (target and preset), when, and the outcome code; v1 audit records SHALL be authority-internal bounded in-memory diagnostics (not durable, no new storage scope) unless the design explicitly declares a durable tier per `durable-state-and-scope.md` §1–2.
2. WHEN audit record writes fail THEN the selection SHALL retain its declared effect, bounded diagnostics SHALL expose a gap marker, and the system SHALL NOT fabricate a record.
3. WHEN audit content or reasons are exposed THEN they SHALL be bounded, redacted and free of payload content and owner-private state.

**Classification:** Facade authority foundation; same v1 audit precedent as the sibling M10 mutation features; `composition-and-authority.md` §5.

## Requirement 8: Availability, Capability And Degradation

**User Story:** As a plugin author, I want to know whether preset control can actually be served in my installation, so that automation fails loudly instead of silently.

### Acceptance Criteria

1. WHEN a caller queries availability THEN the feature namespace SHALL expose `availability()` returning a frozen `{ status: active | degraded | unavailable, reason? }` reflecting the official permission-presets service reachability, and availability SHALL never throw.
2. WHEN the official service is absent, version-mismatched or disabled THEN the selection, query and observation faces SHALL return typed unavailable results, SHALL NOT fabricate success, SHALL NOT disable the whole main facade or unrelated capabilities, and SHALL NOT silently fall back to a facade-local preset record.
3. WHEN capability presence is negotiated THEN `capabilities` SHALL carry the capability without exposing package, row or replacement identities.

**Classification:** selfDescription per `api-idioms.md` §3.8; degradation per `capability-strategy.md` §6.2.

## Requirement 9: Orthogonality And Domain Boundaries

**User Story:** As a plugin author, I want preset selection, one-time approvals and security-policy registration to stay distinct actions, so that no verb ever does another verb's job.

### Acceptance Criteria

1. WHEN a preset selection commits THEN plan mode state SHALL be unchanged by this feature, and vice versa — the two states combine independently.
2. WHEN a caller needs a one-time approval or a security-policy registration THEN the system SHALL route the need to the owning approval/security faces and SHALL NOT provide approval grants or policy registration in this feature.
3. WHEN the facade evaluates nothing about preset internals THEN it SHALL preserve the official preset decision logic untouched — no reordering, re-weighting or overriding of preset rules.

**Classification:** Domain boundary per `domain-composition.md`; official preset authority retained.

## Requirement 10: Authority Closure — No Raw Setter Regression

**User Story:** As a maintainer, I want the controlled face to remain the only supported write path for preset selection, so that the M7 subtraction is not quietly undone by a side door.

### Acceptance Criteria

1. WHEN the services whitelist is audited THEN `services.permissionPresets` SHALL NOT re-gain raw `set`/`selectFor` members, and the controlled face of this feature SHALL be the only supported preset-selection write path through the facade.
2. WHEN the design's authority map identifies other supported write paths reaching the official preset state (for example official client-UI paths) THEN they SHALL be unified under the same authority or declared explicitly mutually exclusive in the design — the facade SHALL NOT coordinate only its own new path.
3. WHEN third-party code injects or imports the official permission-presets component directly THEN that unsupported escape hatch SHALL remain outside the facade's guarantees, and the facade SHALL NOT claim to intercept it.

**Classification:** Authority closure per `composition-and-authority.md` §6; public-surface subtraction state per `capability-strategy.md` §7.

## Requirement 11: Verification And Delivery Gates

**User Story:** As a maintainer, I want end-to-end evidence that selections commit, behave and degrade honestly, so that delivery cannot regress permission semantics.

### Acceptance Criteria

1. WHEN selection semantics are tested THEN evidence SHALL cover query, selection, unknown-preset and invalid-target rejection, official-state readback, and audit content.
2. WHEN consistency is tested THEN evidence SHALL verify the read face, observation and at least one real tool-approval decision agree after a selection, including a preset change initiated outside the facade.
3. WHEN composition is tested THEN evidence SHALL cover two synthetic plugins in reverse registration order, racing selections with deterministic outcomes, owner derivation, repeat idempotency, and a low-trust context being denied without state change.
4. WHEN degradation is tested THEN evidence SHALL cover unavailable service reporting, isolation of unrelated capabilities, and honest availability.
5. WHEN registry and shape checks run THEN every new host member SHALL be registered with one primary idiom, semantic face, effect, composition, scope, authority and availability shape; surface snapshots SHALL match; the guarded full test suite, `git diff --check`, registry/surface consistency and the global adversarial review SHALL pass before the Stage 4 completion commit.

**Classification:** Delivery gates for the A-class wrapped face.

## Standards Applicability And Alignment

- `docs/standards/capability-strategy.md`: applicable。A 类受控包装（官方 seam 存在，方案一）；不评估 R slice；`services.permissionPresets` 白名单写路径不回流；冻结基线内交付。
- `docs/standards/api-shape.md`: applicable。主面 mutation；query/observe 为同 authority 之上的只读成员；策略判定留在官方 preset authority，门面不注册平行策略；一面原则满足。
- `docs/standards/api-idioms.md`: applicable。mutation 判别式结果、projection 形状、availability/selfDescription 形状、统一词汇（`ok/code/reason`，不新造终态词）。
- `docs/standards/public-api-shape.md`: applicable。挂靠最近既有领域，最终 path 由 Design 依总树一致性确定；不引入 package/row 身份。
- `docs/standards/composition-and-authority.md`: applicable。owner 派生不可伪造；authority closure（Req10，含其他受支持写路径的统一或互斥声明）；composition mode 与冲突规则在 Design 声明；claim/preflight 词汇仅作声明，不替代运行时检查。
- `docs/standards/domain-composition.md`: applicable。permissionPresets/approval/security/planMode 各归唯一 owner；选择预设 ≠ 一次批准 ≠ 注册 policy。
- `docs/standards/ordering.md`: applicable（有限）。无多 owner 顺序决策；冲突由 authority/冲突规则处理，不以 priority 绕过。
- `docs/standards/identity-and-lifecycle.md`: applicable。判别式结果承载终态语义；racing 中败方 `superseded` 是终态而非补写通道。
- `docs/standards/durable-state-and-scope.md`: applicable（有限）。v1 审计 bounded in-memory；如 Design 声明 durable 审计档位则只归一档；不新增 preset 的第四档持久 scope。
- `docs/standards/visibility-and-redaction.md`: applicable。预设描述为 bounded、非敏感；审计与 reason 最小暴露；低信任 client 半身按 §4 默认更保守。
- `docs/standards/concurrency-and-cancellation.md`: applicable。并发策略声明（scope、冲突判定、提交条件）；官方仲裁优先；stale 结果不补写。
- `docs/standards/versioning-and-protocols.md`: applicable。冻结基线内交付；无新 wire/durable 协议（如 Design 引入需单独论证 revision）。

## 备注（Stage 边界）

本文件只确认 Requirements 方向。Design 将确定：namespace 放置与公共 path、官方服务绑定与真实签名核对（含 `set(session, name)` 与继承/覆盖语义）、观察通道的官方事件点核实（A/B 定案）、authority map 与其他受支持写路径的统一/互斥结论、composition mode 与冲突规则、审计载体、registry/catalog 拟新增行与失败/guard 策略。Tasks 以对抗性审查为门（AGENTS.md §3.2），通过后进入 Stage 4。
