# Stage 1 - Requirements

> feature_name: `session-plan-mode-control`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）。Goal 于 2026-09-11 获批；Requirements 与 Design 同批交付（2026-09-12）。
> 上游输入：`docs/specs/session-plan-mode-control/goal.md`（已批准）；M10 工作纲领 §3.4（OBS-04）；观察报告 §5 OBS-04；M7 deletion report B4-3 批准记录与「后续 B 类接口义务」。

## Status

Stage 1 Requirements（2026-09-12 与 Design 同批交付，Stage 0–2 已交付；Goal 于 2026-09-11 获批）。本文件依据已批准的 Stage 0 Goal 与本仓库 `docs/standards/` 各分册编写。每条需求标注 A/B/C 实现通道分类。

## Introduction

`session-plan-mode-control` 为第三方插件提供受控、可追溯的目标计划模式（Plan Mode）切换面：对明确目标进入/退出官方 Plan Mode、读取实际状态并观察变化，且切换真实影响官方 prompt / 工具 / 执行行为。主公开面是 mutation（受控状态写入）；实际状态读取与变化观察是同一官方 authority 之上的只读成员。

实现通道方向：**A 类受控包装（方案一门面转译）**。官方 `dsh-plan-mode` 组件在冻结 runtime 中保留写入 seam（类型含 `set(agent, active): 'committed' | 'queued' | 'cancelled' | 'noop'`），门面 `services.planMode` 白名单现仅 `get`。本 feature 包装官方服务并补齐 owner 归因、审计与结果映射，不恢复裸 singleton setter，不涉及 R slice 评估，不新建与官方模式无关的状态机。

公共面为 host 面：client 端交互经插件自身 remote 调用 host 面（既有 remotes/codec 机制承载），本 feature 不新增公共 client 半面；完整交互接入的 client 编排归 `interactive-session-access`。Plan Mode 与权限预设正交，各归唯一 owner。

本 feature 在 AGENTS.md §3.0.1 冻结基线内交付：不步进 `A`/`B.C`/`D`（现行 `0.1.0-rc.6-0.1.0`，`dsh.api: 0.1`）；公共成员与语义在交付时同步 canonical registry 与 capability/availability 记录。

## Requirement 1: Controlled Plan-Mode Switch Entry

**User Story:** As a plugin author, I want one supported entry to switch a target into or out of Plan Mode, so that I never call the raw official setter or fake the mode with a UI flag.

### Acceptance Criteria

1. WHEN a caller invokes the controlled switch for an existing target with a requested mode THEN the system SHALL invoke the official plan-mode write seam with the caller's intent and SHALL return a frozen discriminated result `{ ok, code, reason?, ... }` per the mutation idiom.
2. WHEN the official seam reports the switch committed THEN the result SHALL report success with the resulting mode recorded in its bounded fields.
3. WHEN the official seam reports a non-committed outcome (`queued`, `cancelled`, `noop` or their runtime equivalents) THEN the system SHALL map each official outcome to a distinct public result code, `cancelled` SHALL NOT be reported as a successful switch, and the complete mapping SHALL be declared in the design.
4. WHEN the switch request is malformed, or the target does not exist or is closed THEN the system SHALL return a typed rejected result with bounded reason before any side effect, and the official mode state SHALL remain unchanged.
5. WHERE a caller supplies a reason or context string THEN the system SHALL keep it bounded and owner-attributed, and SHALL NOT treat caller-supplied context as authorization.

**Classification:** A（官方写入 seam 存在，受控稳定化 + 包装）；mutation idiom shape per `api-idioms.md` §3.3；target semantics follow the official `set(agent, active)` signature as verified in the design.

## Requirement 2: Faithful Read Of Actual State

**User Story:** As a plugin author, I want to read the real plan-mode state of a target, so that UI and automation agree with what the runtime will actually do.

### Acceptance Criteria

1. WHEN a caller reads the plan mode of a target THEN the system SHALL return a frozen view sourced from the official plan-mode authority — including the actual active/inactive mode — and SHALL NOT return facade-local bookkeeping as the state.
2. WHEN the target has no plan-mode state, or the official service is unavailable or degraded THEN the system SHALL return a typed unavailable/degraded view and SHALL NOT throw across the caller.
3. WHEN the read view is served THEN it SHALL be attributable to the official source (no second state owner), so two readers of the same target never disagree about the official state.

**Classification:** A projection over the official service; projection shape per `api-idioms.md` §3.1.

## Requirement 3: Observation Of Mode Changes From Any Official Path

**User Story:** As a plugin author, I want to observe plan-mode changes no matter which path caused them — my facade switch, the official TUI toggle, or official internals — so that my UI never shows a stale mode.

### Acceptance Criteria

1. WHEN plan mode changes for any target through any official path THEN the public observation face SHALL deliver the change to subscribers with the new state and an observed-at time, and SHALL NOT require the change to originate from the facade.
2. WHEN a subscriber callback throws or rejects THEN containment SHALL affect only that listener; other subscribers and the source state SHALL be unaffected, and a disposed subscription SHALL stop callbacks without affecting other subscribers.
3. WHEN the observation cannot be sourced from an official event point THEN the system SHALL derive it through the design-declared mechanism, record the B-class derivation and its fail-safe degradation in the design, and the observed facts SHALL be verified against the official state; when verification or the source is unavailable the observation SHALL degrade typed rather than guess.

**Classification:** A where an official event point exists; B（底层模拟）only if the design verifies no official event point exists and records the derivation; public shape is projection-observe per `api-idioms.md` §3.1.

## Requirement 4: Single Source Of Truth — No Split State

**User Story:** As a maintainer, I want the facade to add owner/audit semantics on top of the official mode state without ever maintaining a competing one, so that "UI says planning" always means the runtime agrees.

### Acceptance Criteria

1. WHEN any supported path changes plan mode THEN the facade read and observation faces SHALL reflect the official state, and the facade SHALL NOT maintain a second authoritative mode state that can diverge from it.
2. WHEN a caller's own switch result reports committed success THEN the official state SHALL evidence the committed mode for that target, absent a later competing change.
3. WHEN a switch commits THEN official consumers of plan mode (prompt assembly, tool constraints, execution side) SHALL observe the new mode through their official mechanisms; the facade SHALL NOT mirror, replay or re-express mode state into prompts, policies or projections of its own.

**Classification:** A consistency/authority-closure requirement per `composition-and-authority.md` §6; the facade's guarantee is faithful submission and faithful observation, not reimplementation.

## Requirement 5: Audit And Traceability

**User Story:** As a maintainer, I want every controlled switch attributable to a real owner with bounded evidence, so that mode changes are diagnosable without leaking content.

### Acceptance Criteria

1. WHEN a switch attempt reaches the official seam, or is rejected before submission THEN the system SHALL record a bounded audit entry containing who (derived owner), what (target and requested mode), when, and the outcome code; v1 audit records SHALL be authority-internal bounded in-memory diagnostics (not durable, no new storage scope) unless the design explicitly declares a durable tier per `durable-state-and-scope.md` §1–2.
2. WHEN audit record writes fail THEN the switch SHALL retain its declared effect, bounded diagnostics SHALL expose a gap marker, and the system SHALL NOT fabricate a record.
3. WHEN a caller attempts to claim an owner that is not its own THEN the system SHALL derive owner identity from the actual caller context and SHALL NOT accept caller-reported ownership for authority decisions.
4. WHEN audit content or reasons are exposed THEN they SHALL be bounded, redacted and free of payload content and owner-private state.

**Classification:** Facade authority foundation; owner derivation per `composition-and-authority.md` §5; storage tier (if any) per `durable-state-and-scope.md`.

## Requirement 6: Concurrency, Repeats And Official Arbitration

**User Story:** As a plugin author, I want concurrent and repeated switches to resolve deterministically under the official arbitration, so that no caller ever believes two different things happened.

### Acceptance Criteria

1. WHEN multiple callers switch the same target concurrently or repeatedly THEN the official arbitration outcomes (`committed`/`queued`/`cancelled`/`noop`) SHALL surface as distinct public results, and the system SHALL NOT invent silent latest-wins semantics that override official arbitration.
2. WHEN a queued switch later settles (committed or cancelled) THEN the settlement SHALL be observable through the observation face of Requirement 3, and the earlier queued result SHALL NOT be retroactively rewritten into a different outcome.
3. WHEN the same caller repeats a switch while the mode already equals the request THEN the system SHALL return the design-declared idempotent mapping of the official `noop` outcome, and SHALL NOT record it as a second committed switch.

**Classification:** A（官方仲裁语义保留并如实映射）；concurrency declaration per `concurrency-and-cancellation.md` §6; terminal/result vocabulary per `identity-and-lifecycle.md` §3.

## Requirement 7: Availability, Capability And Degradation

**User Story:** As a plugin author, I want to know whether plan-mode control can actually be served in my installation, so that automation fails loudly instead of silently.

### Acceptance Criteria

1. WHEN a caller queries availability THEN the feature namespace SHALL expose `availability()` returning a frozen `{ status: active | degraded | unavailable, reason? }` reflecting the official plan-mode service reachability, and availability SHALL never throw.
2. WHEN the official service is absent, version-mismatched or disabled THEN the switch, read and observation faces SHALL return typed unavailable results, SHALL NOT fabricate success, SHALL NOT disable the whole main facade or unrelated capabilities, and SHALL NOT silently fall back to a facade-local mode flag.
3. WHEN capability presence is negotiated THEN `capabilities` SHALL carry the capability without exposing package, row or replacement identities.

**Classification:** selfDescription per `api-idioms.md` §3.8; degradation per `capability-strategy.md` §6.2 and `public-api-shape.md` §5.

## Requirement 8: Orthogonality From Adjacent Domains

**User Story:** As a plugin author, I want plan mode, permission presets and approvals to stay independent states, so that switching one never silently changes another.

### Acceptance Criteria

1. WHEN plan mode is switched THEN permission preset state, approval decisions and security policy SHALL be unchanged by this feature, and vice versa.
2. WHEN a caller needs preset, approval or policy changes THEN the system SHALL route them to their owning faces and SHALL NOT provide cross-domain setters in this feature.

**Classification:** Domain boundary per `domain-composition.md`; Plan Mode 与权限预设正交、各归唯一 owner。

## Requirement 9: Authority Closure — No Raw Setter Regression

**User Story:** As a maintainer, I want the controlled face to remain the only supported write path for plan mode, so that the M7 subtraction is not quietly undone by a side door.

### Acceptance Criteria

1. WHEN the services whitelist is audited THEN `services.planMode` SHALL NOT re-gain a raw write member (`set` or equivalent), and the controlled face of this feature SHALL be the only supported plan-mode write path through the facade.
2. WHEN third-party code injects or imports the official plan-mode component directly THEN that unsupported escape hatch SHALL remain outside the facade's guarantees, and the facade SHALL NOT claim to intercept it.

**Classification:** Authority closure per `composition-and-authority.md` §6; public-surface subtraction state per `capability-strategy.md` §7.

## Requirement 10: Verification And Delivery Gates

**User Story:** As a maintainer, I want end-to-end evidence that switches commit faithfully, observe honestly and degrade safely, so that delivery cannot regress the mode semantics.

### Acceptance Criteria

1. WHEN switch semantics are tested THEN evidence SHALL cover the committed/queued/cancelled/noop result mapping, pre-submit rejection, invalid and closed targets, official-state readback after success, and audit content.
2. WHEN observation is tested THEN evidence SHALL include a mode change initiated outside the facade (official path) reaching subscribers, callback containment, and stale disposer isolation.
3. WHEN composition is tested THEN evidence SHALL cover two synthetic plugins in reverse registration order, concurrent switches with deterministic outcomes, owner derivation and repeat/noop idempotency.
4. WHEN degradation is tested THEN evidence SHALL cover unavailable service reporting, isolation of unrelated capabilities, and honest availability.
5. WHEN registry and shape checks run THEN every new host member SHALL be registered with one primary idiom, semantic face, effect, composition, scope, authority and availability shape; surface snapshots SHALL match; the guarded full test suite, `git diff --check`, registry/surface consistency and the global adversarial review SHALL pass before the Stage 4 completion commit.

**Classification:** Delivery gates for the A-class wrapped face.

## Standards Applicability And Alignment

- `docs/standards/capability-strategy.md`: applicable。A 类受控包装（官方 seam 存在，方案一）；不评估 R slice；`services.planMode` 白名单不减不增（写路径不回流）；冻结基线内交付。
- `docs/standards/api-shape.md`: applicable。主面 mutation；read/observe 为同 authority 之上的只读成员，不注册策略、不做汇总投影；一面原则满足。
- `docs/standards/api-idioms.md`: applicable。mutation 单步写入动词 + 判别式结果；projection 查询/observe 形状；availability/selfDescription 形状；不新增第九种 idiom。
- `docs/standards/public-api-shape.md`: applicable。挂靠最近既有领域，最终 path 由 Design 依总树一致性确定；不引入 package/row 身份；公共 namespace 始终存在。
- `docs/standards/composition-and-authority.md`: applicable。owner 派生不可伪造；受支持写路径 authority closure（Req9）；composition mode 与冲突规则在 Design 声明；两个 synthetic plugin 反向顺序验证。
- `docs/standards/domain-composition.md`: applicable。Plan Mode 与 permissionPresets/approval/security 正交，各归唯一 owner；不建跨域状态机。
- `docs/standards/ordering.md`: applicable（有限）。本 feature 无多 owner 顺序决策；事件监听排序模型不承载业务语义；无跨领域排序图。
- `docs/standards/identity-and-lifecycle.md`: applicable。结果/终态词汇统一（mutation 用判别式结果，不新造终态词）；queued 结算经观察面呈现，不改写已提交结果。
- `docs/standards/durable-state-and-scope.md`: applicable（有限）。v1 审计为 bounded in-memory diagnostics；如 Design 声明 durable 审计档位，则逐条遵守 §1–2 且只归一档。
- `docs/standards/visibility-and-redaction.md`: applicable。审计与 reason 最小暴露、bounded、无 payload；无 secret 面。
- `docs/standards/concurrency-and-cancellation.md`: applicable。并发策略（composition mode/冲突判定/取消行为/提交条件）在 Design 声明；官方仲裁优先；stale 结果不补写。
- `docs/standards/versioning-and-protocols.md`: applicable。冻结基线内交付；无新 wire/durable 协议（如 Design 引入需单独论证 revision）。

## 备注（Stage 边界）

本文件只确认 Requirements 方向。Design 将确定：namespace 放置与公共 path、官方服务绑定与真实签名核对、`queued/cancelled/noop` 完整结果映射、观察通道的官方事件点核实（A/B 定案）、composition mode 与冲突规则、审计载体与档位、registry/catalog 拟新增行与失败/guard 策略。Tasks 以对抗性审查为门（AGENTS.md §3.2），通过后进入 Stage 4。
