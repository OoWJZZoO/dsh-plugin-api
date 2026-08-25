# Stage 1 - Requirements

## Status

SPEC1 Stage 0 Goal 已确认；Stage 1 Requirements 已确认（2026-08-25，M6 第四批次批量确认门）。

## Introduction

`security-policy-egress-guard` 为第三方插件提供统一的 security policy 门面：approval 前置决策（policy）、结果与内容可见性控制（redaction）、出站目标策略（egress）三个策略注册面。它收敛 `dsh-secret-redactor`（post-execute 递归脱敏）、`dsh-approve-for-me`（approval 前置 allow/deny/ask）、`dsh-system-proxy`（子进程出站）各自为政的重复 workaround。

本 feature 是 **B 类 host facade**，组合既有官方 seam（`approval/request`、`tools/pre-execute|post-execute` 等）。Host 是权威面；所有 deny fail-closed；横切安全语义不转 R。凡必须依赖官方不存在的强制拦截点的部分，显式标注 C 类 `upstream-required`，不在门面内伪造强制力。

## Definitions and Boundaries

- **Decision point（决策点）**：系统内明确定义的三类调用时机——模型请求前、工具执行前、工具结果后；决策评估可携带 tool/session/workspace/route/user-approval 上下文（goal 层上下文清单），上下文无法解析时按 SEC-2.5 标记 unknown。
- **Policy**：纯函数式注册项；输入由门面显式传入，返回 `allow | deny | ask` 决定与理由；不做 mutation。
- **Redaction rule**：对内容片段的可见性改写声明，按受众（模型可见 / UI 可见 / 日志可见 / debug 可见）分别定义。debug-visible 是 log-visible 的实现级子集，不构成第四种独立可见性语义（goal 层"三种 visibility"即 model/UI/log 三层）。
- **Egress target**：一次出站意图的 destination 描述（subprocess 命令、HTTP 目标、MCP server、remote channel）；**egress 允许策略不是系统 proxy 配置**，"检测到 proxy"不得当作"允许出站"。
- **Secret material**：凭据、认证材料、私钥、安全 token 及同等敏感值（见 `docs/standards/visibility-and-redaction.md` §2）。
- **Host/client boundary**：host 拥有全部三个策略面与审计记录；client 只能消费既有 host 投影的只读、脱敏视图，不新增 client transport 或 client 端策略权威。

## Standards Alignment

按 `docs/standards/` 六册对照：

- **capability-strategy**：适用——B 类通道判定、横切语义永不 R（本文 Classification 逐条落实）。
- **api-shape**：适用——三面均为 policy registry 面，遵循单一 register 入口、纯函数策略、抛错只降级该决策点、disposer 所有权；本 feature 无 durable mutation 主面。
- **identity-and-lifecycle**：适用——policy 注册身份用 owner id + generation opaque token；decision 记录终态不复用生命周期词。
- **durable-state-and-scope**：部分适用——audit 是唯一需要 durable 落档考虑的对象（档位/持久层级由 Design 定——v1 定档为内存有界队列，如实标注），遵循 fail-closed 与 who/what/when/generation 审计字段。
- **visibility-and-redaction**：核心适用——默认最小暴露、非 secret 提升走插件 policy 无需中央审批、secret 提升默认拒绝且仅 user/profile policy 可放行、脱敏覆盖边界须在 Design 写清。
- **concurrency-and-cancellation**：部分适用——决策评估为同步收敛，无异步竞争主面；observer/audit 订阅沿用既有 disposer 语义。

## Requirements

### SEC-1 Policy registration and identity

**User Story:** As a plugin maintainer, I want to register security policies with stable identity, so that my policy can be audited, updated, and disposed without affecting other plugins' policies.

**Acceptance Criteria:**

1. **WHEN** a caller registers a policy on any supported face **THEN** the facade SHALL require a non-empty owner id and SHALL return a handle carrying an owner-specific generation token and a disposer.
2. **WHEN** a caller omits required fields, supplies a malformed matcher, or registers under an invalid face **THEN** the facade SHALL reject the registration with a typed validation result before the policy becomes eligible for evaluation.
3. **WHEN** a disposer is invoked more than once **THEN** the facade SHALL make disposal idempotent and SHALL NOT remove policies owned by other owners.
4. **WHEN** a policy is replaced by its owner with a newer generation **THEN** the facade SHALL retire the older generation at the next evaluation and SHALL keep the audit attribution of past decisions unchanged.

**Classification:** B (facade registry).

### SEC-2 Decision points and deterministic composition

**User Story:** As a plugin maintainer, I want policies evaluated at well-defined moments in a deterministic order, so that coexisting policies compose predictably instead of silently overriding one another.

**Acceptance Criteria:**

1. **WHERE** the system reaches a declared decision point (before model request, before tool execute, after tool result) **THEN** the facade SHALL evaluate all active policies registered for that point and SHALL produce a single converged decision carrying the winning `policyId`, `reason`, `expiresAt`, and the associated `auditId`.
2. **WHEN** multiple policies return conflicting decisions **THEN** the facade SHALL resolve them according to a documented deterministic precedence (deny > ask > allow) and SHALL record every consulted policy id in the decision record.
3. **WHEN** a policy throws or returns a malformed result **THEN** the facade SHALL degrade only that policy to the point's default decision and SHALL keep the remaining policies and the hosting operation alive.
4. **WHERE** the default decision for a security decision point is unspecified by configuration **THEN** the facade SHALL default to fail-closed (`deny` for egress, `ask` for approval-context policy) and SHALL NOT default to allow.
5. **WHEN** a policy evaluation is requested outside a resolvable execution/session context **THEN** the facade SHALL still evaluate with provenance marked unknown and SHALL NOT refuse the decision merely because provenance is missing.

**Classification:** B over officially dispatched seams (`approval/request`, `tools/*`) plus the facade-owned synchronous `llm/request` re-entry translation point; any additional mandatory interception point that official dispatches do not expose is C (`upstream-required`) and SHALL be surfaced as such instead of emulated. (The C-claim of this requirement resides in this Classification paragraph; AC 5 itself is a provenance-tolerance behavior.)

### SEC-3 Approval-context policy

**User Story:** As a plugin maintainer, I want to decide approval requests by declarative rule before the interactive approval flow, so that read-only operations can proceed without user friction and dangerous ones cannot slip through.

**Acceptance Criteria:**

1. **WHEN** an official approval request is dispatched **THEN** the facade SHALL offer registered policies the request context before the default approval handling proceeds.
2. **WHEN** a policy returns `deny` or `allow` **THEN** the facade SHALL apply that outcome through the official approval mechanism's own result semantics and SHALL attribute the outcome to the policy in the audit record.
3. **WHEN** a policy returns `ask` **THEN** the facade SHALL fall through to the normal interactive approval flow unchanged.
4. **WHEN** no policy is registered for a request **THEN** the facade SHALL leave the official approval behavior completely unchanged.
5. **WHERE** the official runtime offers no dispatch point for a category of approval-like decision **THEN** the facade SHALL mark that category C (`upstream-required`) and SHALL NOT invent a parallel approval channel.

**Classification:** B on top of the official `approval/request` dispatch (A-class base); C for categories lacking an official dispatch point.

### SEC-4 Redaction faces and audience separation

**User Story:** As a plugin maintainer, I want to declare what is visible to models, UI, logs, and debug independently, so that one audience's need does not leak content into another's view.

**Acceptance Criteria:**

1. **WHEN** a redaction rule is registered **THEN** the facade SHALL require an explicit audience set among model-visible, UI-visible, log-visible, and debug-visible, and SHALL apply the rule only to the declared audiences.
2. **WHEN** tool results cross the after-tool-execute decision point **THEN** the facade SHALL offer registered redaction rules the result content and SHALL publish the transformed result to downstream consumers together with a redaction provenance marker.
3. **WHEN** redaction transforms content **THEN** the facade SHALL preserve enough structure for consumers to know that redaction occurred (marker/count), and SHALL NOT silently replace content with unrelated data.
4. **WHEN** redaction of an object fails partway (binary payload, unreadable nesting) **THEN** the facade SHALL fail closed for that content—substituting a redacted marker—rather than returning the partially unprotected original.
5. **WHERE** the coverage boundary differs by content type (nested objects, binary, exception causes, MCP resources, log streams) **THEN** the facade SHALL apply the boundary declared in the Design document, and undeclared content types SHALL be treated conservatively (redacted marker) until declared.

**Classification:** B (facade transformation at official seams).

### SEC-5 Secret elevation constraint

**User Story:** As a user, I want credential material to stay hidden by default regardless of what third-party policies request, so that no plugin can leak secrets into models, UI, or logs.

**Acceptance Criteria:**

1. **WHEN** a plugin registers a visibility policy whose effect would expose secret material to any audience **THEN** the facade SHALL subject that exposure to the user/profile secret policy, which defaults to deny, and the plugin registration alone SHALL NOT suffice.
2. **WHEN** the user/profile secret policy denies an exposure **THEN** the facade SHALL keep the secret redacted across all audiences and SHALL record a bounded audit note without the secret value.
3. **WHEN** a redaction rule matches secret-shaped material incidentally **THEN** the facade SHALL treat it under the secret constraint even if the rule was registered for a narrower audience.

**Classification:** B; enforcement relies on the user/profile policy plane defined by `visibility-and-redaction.md` §2 (no central approver beyond that plane).

### SEC-6 Egress check and lease

**User Story:** As a plugin maintainer about to perform an outbound operation, I want to consult a destination policy and optionally hold a time-bounded allowance, so that egress intent is explicit, auditable, and expiring.

**Acceptance Criteria:**

1. **WHEN** a caller checks an egress target **THEN** the facade SHALL evaluate matching egress policies and SHALL return a converged decision with `policyId`, `reason`, `expiresAt`, and the associated `auditId`.
2. **WHEN** a caller holds an egress lease **THEN** the lease SHALL be scoped to the granted target description, SHALL expire at its `expiresAt`, and SHALL NOT authorize targets outside its grant.
3. **WHEN** an egress lease has expired or been revoked **THEN** subsequent checks SHALL fail closed and pending operations SHALL NOT extend the lease retroactively.
4. **WHEN** proxy environment configuration is detected **THEN** the facade SHALL NOT interpret that detection as an egress allowance.
5. **WHERE** an outbound operation originates from official runtime paths that do not consult this facade **THEN** enforcement of egress policy over those paths is C (`upstream-required`) and the facade SHALL document the enforcement boundary truthfully instead of claiming mandatory interception.

**Classification:** B as an opt-in consultation/lease API at plugin call sites; C for mandatory interception of paths lacking official hooks.

### SEC-7 Audit records

**User Story:** As a plugin maintainer, I want decisions to be queryable afterwards, so that denials, redactions, and egress grants can be explained and debugged.

**Acceptance Criteria:**

1. **WHEN** a converged decision, redaction application, or egress grant is produced **THEN** the facade SHALL append a bounded audit record keyed by that decision's `auditId` and containing who (owner/policy ids), what (target/audience summary), when, generation, and outcome.
2. **WHEN** audit records are queried **THEN** the facade SHALL return frozen read-only views scoped to the caller's access, with secret values and private content redacted.
3. **WHEN** audit storage is unavailable or its append fails **THEN** the facade SHALL report the audit gap on subsequent queries and SHALL NOT fabricate missing records; the underlying decision itself remains effective according to SEC-2.

**Classification:** B; durability tier (profile-persistent / workspace-persistent / non-durable) follows `durable-state-and-scope.md` §1 and is fixed in Design (v1: non-durable in-memory bounded ledger, truthfully labeled).

### SEC-8 Diagnostics and fail-safe containment

**User Story:** As a plugin maintainer, I want my policy's failures to be observable without endangering the harness, so that degraded security posture is visible instead of silent.

**Acceptance Criteria:**

1. **WHEN** a registered policy throws repeatedly or fails registration-time validation **THEN** the facade SHALL report the failing policy through the existing plugin diagnostics facility with owner attribution and SHALL continue operating the remaining policies.
2. **WHEN** the security facade itself encounters an internal error during setup **THEN** the feature SHALL degrade to its fail-safe state (no policy enforcement, explicit availability reporting), SHALL NOT throw through apply, and SHALL NOT kill harness boot.
3. **WHEN** the facade is degraded or inactive **THEN** availability queries SHALL reflect the true state and SHALL NOT report enforced protection.

**Classification:** B.

### SEC-9 Client boundary

**User Story:** As a client plugin maintainer, I want a truthful client surface, so that browser code can display decision state but can never act as a policy authority.

**Acceptance Criteria:**

1. **WHEN** client code consumes security information through existing host projections **THEN** it SHALL receive read-only, redacted summaries with explicit availability metadata.
2. **WHEN** client code attempts to register policies, decide, grant egress, or mutate audit records through this feature **THEN** the feature SHALL expose no such client surface.
3. **WHEN** no compatible host projection exists for a client consumer **THEN** the client face SHALL remain inert/degraded and SHALL NOT prevent unrelated client faces from loading.

**Classification:** B boundary; no new client transport is introduced.

## Non-Goals

- Replacing the official approval loader row or re-implementing the approval flow.
- Owning system proxy configuration or interpreting proxy presence as egress permission.
- A regex-only redaction promise; coverage boundaries are declared per Design, not implied.
- Mandatory interception of official runtime paths lacking dispatch points (C `upstream-required`, documented, not emulated).
- Re-implementing cross-cutting dispatch semantics (priority / deepFreeze / fault containment).
- A central approval authority beyond the user/profile secret policy plane.
