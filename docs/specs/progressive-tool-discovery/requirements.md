# Stage 1 - Requirements

## Status

SPEC1 Stage 0 Goal 已确认；Stage 1 Requirements 已确认（2026-08-25，M6 第四批次批量确认门）。
修订注记（2026-08-25，用户指示）：PTD-3.5 确立 R 返工规则——官方 loader 无法支撑可用 toolset 重建的证据成立时，立即返工为 R 类并在第一版交付可用功能。

## Introduction

`progressive-tool-discovery` 为 tools 提供统一的 discover → search → activate → expose 生命周期：工具先以轻量 descriptor 注册，模型按需搜索并激活后才能拿到完整工具定义。它收敛 `dsh-mcp-client-v2`（tool search）、`dsh-vision-toolkit`（activation-gated registration）、`dsh-agent-teams`（prompt 约束调用时机）各自绕过的同一公共缺口——per-turn 的工具暴露策略。

本 feature 初版是 **B 类 host facade**：基于现有 tools registry、systemPrompt assemble 与 skills registry 组合。官方 `dsh-tools` loader 行的 R 化是登记在案的后续选项，是否触发由 Design 阶段可行性结论决定；凡官方面无法支撑的暴露语义（如 turn 内 toolset 重建边界），按 PTD-3.4 如实披露真实生效边界；若证据充分则按 PTD-3.5 立即返工 R 类。Host 是权威面；client 不拥有 activation 权威。

## Definitions and Boundaries

- **Descriptor**：目录条目的轻量描述（id、summary、capabilities、来源 kind），不含完整 tool schema。
- **Catalog entry**：一次 descriptor 注册，带 owner id、generation token 与 disposer。
- **Activation**：把一个 catalog entry 的完整工具定义暴露给特定 session/execution 范围的动作，产出绑定 generation 的 toolset 视图。
- **Generation**：owner-specific opaque token（`identity-and-lifecycle.md` §2），用于判定旧暴露是否已被取代；不得跨 owner 比较。
- **Exposure boundary**：官方 loader 实际允许的生效时机（如下一 turn 边界）；门面必须披露真实边界。
- **与相邻 feature 分工**：MCP server identity/tool generation 归 `mcp-catalog-lifecycle`（本面把 MCP 工具作为 source 消费）；route 决策归 `model-route-policy`（本面只消费其结果作约束）；skill 自身 activation lifetime 属候选池另一 feature，不在本文。
- **Host/client boundary**：host 拥有 catalog/search/activate/deactivate 全部面与审计记录；client 只能消费只读 exposure 信息，无激活权威。

## Standards Alignment

按 `docs/standards/` 六册对照：

- **capability-strategy**:适用——B 类初版通道与 dsh-tools 行 R 化后续选项的判定记录于 Goal/Design；横切派发语义不涉及。
- **api-shape**：核心适用——本 feature 主公开面为 policy registry 面（exposure 策略注册 + 系统决策点调用），search/exposure 查询为冻结只读投影；不做 durable mutation。
- **identity-and-lifecycle**:适用——generation 用 owner-specific opaque token；activation 不引入新终态词汇，被取代的 activation 按 `superseded` 处理。
- **durable-state-and-scope**：部分适用——audit/exposure 记录若持久化须单档归属（session 或 workspace 档，Design 定）；默认不自动 retry。
- **visibility-and-redaction**:适用——descriptor summary 进入模型可见面属显式设计决定；暴露原因与来源对 diagnostic/UI 可见；逐条受众标注见各需求。
- **concurrency-and-cancellation**：适用——deactivate/generation 替换构成 latest-wins 竞争，stale 结果失去提交资格；disposer 按 identity 清理。

## Requirements

### PTD-1 Catalog registration and identity

**User Story:** As a plugin maintainer, I want to register tool descriptors without immediately exposing full tools, so that large tool collections stay lightweight until actually needed.

**Acceptance Criteria:**

1. **WHEN** a caller registers a catalog entry **THEN** the facade SHALL require a unique entry id, a non-empty owner id, a summary bounded to at most 200 characters, at most 16 declared capabilities, an activate callback, and SHALL return a handle with generation token and disposer.
2. **WHEN** a caller registers a duplicate entry id within the same owner namespace **THEN** the facade SHALL reject it with a typed conflict result and SHALL preserve the existing entry.
3. **WHEN** a disposer is invoked more than once **THEN** the facade SHALL make disposal idempotent and SHALL NOT remove entries owned by other owners.
4. **WHEN** a registered entry's summary or capability metadata is consumed by any projection **THEN** the facade SHALL provide it as frozen read-only data.

**Classification:** B (facade registry over existing tools/systemPrompt/skills surfaces).

### PTD-2 Search projection

**User Story:** As a plugin maintainer, I want models to search the catalog and receive only lightweight descriptors, so that discovery does not leak full schemas or cause side effects.

**Acceptance Criteria:**

1. **WHEN** a search is performed for a scope **THEN** the facade SHALL return only matching frozen descriptors (id, summary, capabilities, source kind) and SHALL NOT activate anything as a side effect.
2. **WHEN** a search yields no matches **THEN** the facade SHALL return an explicit empty result rather than fabricating suggestions.
3. **WHERE** a route decision from `model-route-policy` constrains a scope **THEN** the facade SHALL exclude entries the constraint forbids from that scope's results and SHALL record the exclusion reason in the result metadata.
4. **WHEN** search results are surfaced to the model audience **THEN** each descriptor SHALL be identifiable by stable id so that a later activation references exactly one entry.

**Classification:** B; model-visible audience per `visibility-and-redaction.md` (descriptor content is designed to be model-visible).

### PTD-3 Activation and toolset view

**User Story:** As a plugin maintainer, I want on-demand activation scoped to a session/execution, so that full tool definitions appear exactly when justified.

**Acceptance Criteria:**

1. **WHEN** a caller activates an entry with `{ session, execution, reason }` **THEN** the facade SHALL produce a toolset view bound to a new generation and SHALL make the entry's full tool definitions available to that scope's subsequent exposure.
2. **WHEN** an activation succeeds **THEN** the facade SHALL record the activation reason and source kind in queryable audit metadata.
3. **WHEN** an activation is requested for an unknown, disposed, or conflicting entry state **THEN** the facade SHALL reject it with a typed result and SHALL NOT partially expose tools.
4. **WHERE** the official loader constraints prevent intra-turn toolset rebuild **THEN** the facade SHALL apply the exposure at the real effective boundary (such as the next turn) and SHALL report that boundary truthfully instead of claiming immediate effect.
5. **GIVEN** the Design-stage audit produces sufficient evidence that the official `dsh-tools` loader cannot support intra-turn (or otherwise usable) toolset rebuild **THEN** the feature SHALL be reworked onto the R channel—replacing the `dsh-tools` row per capability-strategy R1–R9—and its first delivered version SHALL expose working activation functionality; a disclosure-only degraded facade SHALL NOT serve as the first delivered version.
6. **WHEN** an execution holding a toolset view finishes **THEN** the view's validity ends with its scope and SHALL NOT leak into unrelated sessions or executions.

**Classification:** B; guarantees beyond what official dispatch exposes follow PTD-3.4's truthful boundary disclosure instead of being claimed as immediate.

### PTD-4 Deactivation and generation replacement

**User Story:** As a plugin maintainer, I want to deactivate exposures without breaking in-flight work, so that old executions complete coherently while new ones see the updated set.

**Acceptance Criteria:**

1. **WHEN** an owner deactivates an entry for a scope **THEN** new exposures in that scope SHALL no longer include its tools while executions already holding the previous generation SHALL keep their coherent view until they finish.
2. **WHEN** a newer generation replaces an older one in the same scope **THEN** pending asynchronous results of the older generation SHALL lose submission qualification and SHALL be retained only as diagnostics.
3. **WHEN** a deactivation disposer runs **THEN** it SHALL clean up only the resources created by its own generation and SHALL NOT remove another owner's or newer generation's exposure.
4. **WHEN** deactivate is called with a stale or foreign generation **THEN** the facade SHALL reject or no-op with a typed outcome and SHALL preserve the current active exposure.

**Classification:** B (facade guard); follows `concurrency-and-cancellation.md` §4–5 stale-result and disposer ownership rules.

### PTD-5 Exposure auditability

**User Story:** As a plugin maintainer, I want to query why tools were exposed at a given time, so that behavior differences across turns can be explained and debugged.

**Acceptance Criteria:**

1. **WHEN** an activation, deactivation, or exclusion affects a scope **THEN** the facade SHALL append a bounded audit record containing entry id, owner, reason/kind, generation, and timestamp.
2. **WHEN** audit records are queried **THEN** the facade SHALL return frozen read-only views; records are diagnostic/UI-visible by default and not model-visible.
3. **WHEN** audit storage fails **THEN** the facade SHALL surface the gap explicitly and SHALL NOT fabricate records; exposure itself continues according to PTD-3.

**Classification:** B; persistence tier fixed in Design under `durable-state-and-scope.md` §1.

### PTD-6 Descriptor injection boundary

**User Story:** As a plugin maintainer, I want search affordances injected through the existing system prompt seam, so that models learn discoverable entries without this feature authoring prompt content.

**Acceptance Criteria:**

1. **WHERE** the feature contributes discovery hints to a request **THEN** it SHALL do so via the existing systemPrompt composition seam and SHALL limit content to registered descriptor data and invocation syntax, not authored prose policies.
2. **WHEN** no catalog entries are active or registered for a scope **THEN** the facade SHALL contribute nothing to that scope's prompt composition.
3. **WHEN** descriptor injection fails at the systemPrompt seam **THEN** the failure SHALL degrade only this feature's hint contribution and SHALL NOT break the assembled prompt or other contributors.

**Classification:** B over the existing `systemPrompt` seam.

### PTD-7 Degradation isolation

**User Story:** As a plugin maintainer, I want my catalog entry's failure contained, so that one broken entry cannot take down other entries or the harness.

**Acceptance Criteria:**

1. **WHEN** an entry's activate callback throws or returns malformed output **THEN** the facade SHALL contain the failure, mark that entry failed with owner attribution via plugin diagnostics, and SHALL keep other entries and the hosting operation alive.
2. **WHEN** the feature itself fails setup **THEN** it SHALL degrade to inert availability reporting, SHALL NOT throw through apply, and SHALL NOT kill harness boot.
3. **WHEN** degraded **THEN** availability queries SHALL reflect the true state and previously exposed generations remain governed by their recorded state rather than fabricated defaults.
4. **WHEN** a catalog registration fails or yields an unusable entry **THEN** the facade SHALL contain the failure, report it with owner attribution via plugin diagnostics, and SHALL keep other entries and the hosting operation alive.

**Classification:** B.

### PTD-8 Client boundary

**User Story:** As a client plugin maintainer, I want a truthful client surface, so that browser code can render exposure state but can never activate or deactivate tools.

**Acceptance Criteria:**

1. **WHEN** client code consumes discovery information through existing host projections **THEN** it SHALL receive read-only exposure summaries with explicit availability metadata.
2. **WHEN** client code attempts catalog registration, search on behalf of the host, activation, or deactivation through this feature **THEN** the feature SHALL expose no such client surface.
3. **WHEN** no compatible host projection exists **THEN** the client face SHALL remain inert/degraded and SHALL NOT prevent unrelated client faces from loading.

**Classification:** B boundary; no new client transport is introduced.

## Non-Goals

- Skill activation lifetime management (separate candidate; this face treats skill-sourced tools as ordinary sources).
- Route policy decisions (owned by `model-route-policy`; this face only consumes outcomes as constraints).
- MCP server lifecycle, pagination, reconnect, or tool-generation tracking (owned by `mcp-catalog-lifecycle`).
- Authoring prompt prose or replacing the system-prompt composition strategy.
- Shipping a first version whose activation cannot take effect within the officially supported boundary while sufficient evidence for R rework exists (PTD-3.5 governs escalation instead).
- Any worker scheduling, queueing, or background refresh machinery.
