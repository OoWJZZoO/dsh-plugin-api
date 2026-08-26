# Stage 1 - Requirements

## Status

SPEC1 Stage 1：Requirements 已获用户批准（2026-08-26，M6 第六批次批量确认门）。**2026-08-26 经用户明确指示重构**：`sent` 证据切片改走 R 类实现（扩展现有 agent-loop replacement）。重构后的 Requirements 与 Design 一并待本批确认门；获批前不得进入 Stage 3 Tasks。本件为 Wave B：已消费 Wave A `skill-discovery-activation` 的 exposure 词汇（CP-2，引用 SDA-5 Exposure record）。

## Introduction

`context-provenance` 为第三方插件与诊断/界面消费者提供可解释的上下文组合与 provenance 契约。官方事实（2026-08-26 本机 DSH `0.1.0-rc.6` 源码核实）：最终 system prompt 的组装与渲染发生在 `dsh-agent-loop` 内部（`renderContextSections(assembly)` / `renderPrompt(assembly)`），官方没有任何“本次组装实际包含/丢弃了什么、最终发送了什么”的 dispatch 点。因此：

- 门面本体为 **B 类**组合 facade（contribution 注册、compose、inspect、replacement mapping）；
- `sent` 证据切片为 **R 类**：在既有 `@deepseek-ai/dsh-plugin-api-agent-loop` replacement（owner `@deepseek-ai/dsh-agent-loop`，已交付并锁定 runtime identity）上新增 assembled-context 证据发射，使 `sent` 由真实证据支撑；
- 官方 agent loop **原生消费**带 provenance 的 assembled context（组装点策略消费）仍属 **C 类**，登记上游提案 U19，不伪造官方保证。

## Definitions and Boundaries

- **Contribution**：一次注册 `{ id, owner, scope, phase, priority, content/ref, source, sourceEventSeqs, expiresAt, audience }`。
- **Node lifecycle/visibility states**：`contributed` → `served` → `sent` | `archived` | `redacted` | `superseded`。这些是可见性/生命周期状态，不是操作终态词汇（`identity-and-lifecycle.md` §3）。
- **Assembled-context evidence（R 证据）**：agent-loop replacement 在等价渲染点发射的冻结证据 `{ sessionId, generation, systemSections: [{ sectionKey, sourceTags }], messageRanges: [{ fromSeq, toSeq, count }], dropped: [{ ref, reason }], observedAt }`——只观测，不改变 loop 内组装/策略决策。
- **Compose / Inspect / Replacement mapping**：同重构前定义（冻结贡献图 / session 维度投影 / compaction/prune 旧节点→新节点映射）。
- **与相邻 feature 分工**：execution/session correlation 归 `execution-observation`；attachment provenance 归 `attachment-pipeline` 投影；branch/edit lineage 归 `session-branch-sidechain-edit`；工具暴露来源归 `progressive-tool-discovery`；skill 暴露来源归 `skill-discovery-activation`（SDA-5 Exposure record 与目录 notice 的 `source.kind`）；R 证据切片归 `model-route-policy` 的 replacement 包（同组件第二能力）；memory 来源可选，经 contribution 元数据声明；失败与可见性边界归 `plugin-diagnostics` 与 `visibility-and-redaction`。
- **Host/client boundary**：host-only；不新增 client remote/slot/settings 面。

## Standards Alignment

按 `docs/standards/` 六册对照：

- **capability-strategy**：核心适用——B 类门面 + 单一官方组件的 R 能力切片（`dsh-agent-loop`，唯一 replacement owner 已存在）；requirements 逐条对照 R1–R9（CP-5）；U19 上游提案与退役条件；§10 client 半面判定（本切片为宿主行内证据发射，六项全否 → host-only，与既有 agent-loop 包判定一致）；横切派发语义不走 R。
- **api-shape**：核心适用——主公开面为 projection 面（compose/inspect 冻结只读）；compose 策略为独立 policy registry 面（纯函数）；R 切片只发射证据、不做策略决策（policy 面不在 R 内）。
- **identity-and-lifecycle**：适用——owner-specific generation；节点状态是生命周期/可见性状态而非终态词汇；`superseded` 只作 replacement lineage。
- **durable-state-and-scope**：部分适用——门面不声明 durable mutation 面；bounded 历史与 mapping 若持久化须单档归属（Design 定）；证据 payload 为内存冻结快照，不承诺 durable。
- **visibility-and-redaction**：核心适用——受众包络逐节点强制；证据 payload 只携带 sectionKey/seq 范围/sourceTags，不含 content；secret 默认禁止；脱敏失败 fail-closed。
- **concurrency-and-cancellation**：适用——compose/inspect 尊重 AbortSignal；stale generation 失去提交资格；observer epoch；证据发射与消费的异步竞争按 latest-wins/observedAt 收敛。

## Requirements

### CP-1 Contribution registration and identity

**User Story:** As a plugin maintainer, I want to register context contributions with explicit identity, scope, and provenance, so that later composition can attribute every piece of context to its source.

**Acceptance Criteria:**

1. **WHEN** a caller registers a contribution **THEN** the facade SHALL require a unique id, a non-empty owner, a single scope tier from `{ request, session }`, phase, priority, a source kind, and an audience envelope, and SHALL return a handle with generation token and disposer.
2. **WHEN** a duplicate contribution id is registered within the same owner namespace **THEN** typed conflict; the existing contribution SHALL be preserved.
3. **WHEN** a disposer is invoked more than once **THEN** disposal SHALL be idempotent and SHALL NOT remove contributions owned by other owners.
4. **WHEN** contribution metadata is consumed by any projection **THEN** it SHALL be frozen read-only.

**Classification:** B（facade registry）。

### CP-2 Source vocabulary and seams

**User Story:** As a plugin maintainer, I want each contribution to declare which existing seam produced it, so that the provenance graph names real sources instead of inventing them.

**Acceptance Criteria:**

1. **WHEN** a contribution is registered **THEN** it SHALL declare a source kind from `{ systemPrompt, sessionSurface, attachment, toolExposure, skillExposure, memory, compaction, assembledEvidence }` plus the producing owner.
2. **WHEN** a contribution derives from session surface **THEN** it SHALL carry bounded `sourceEventSeqs` and SHALL NOT synthesize sequence numbers the source did not provide.
3. **WHEN** the facade consumes skill exposure provenance **THEN** it SHALL use the Exposure record vocabulary defined by `skill-discovery-activation` (SDA-5) and the catalog-notice `source.kind` metadata (`skill-catalog` / `skill-catalog-update`), treating the skill feature as source owner.
4. **WHEN** a memory plugin contributes recall content **THEN** the facade SHALL accept it via declared contribution metadata only (optional source) and SHALL NOT depend on any dedicated memory facade.
5. **WHEN** a source seam is unavailable **THEN** evidence from that source SHALL degrade with a typed unavailable/degraded result while other sources SHALL remain unaffected.

**Classification:** B（组合既有公开 seam + R 证据消费）。

### CP-3 Compose and budget

**User Story:** As a plugin maintainer, I want a deterministic, budget-bounded composition of contributions for a request, so that assembly is explainable and cannot silently exceed limits or trigger side effects.

**Acceptance Criteria:**

1. **WHEN** `compose(request, { budget, policy })` is invoked **THEN** the facade SHALL return a frozen contribution graph and SHALL NOT mutate state, trigger retry/route/approval decisions, or bypass prompt injection paths as a side effect.
2. **WHEN** contributions are assembled **THEN** ordering SHALL be deterministic by scope, phase, and priority, with documented tie-breaking.
3. **WHEN** a budget constrains composition **THEN** the facade SHALL truncate with a per-node dropped reason and SHALL NOT silently include over-budget content.
4. **WHEN** a compose policy is registered **THEN** it SHALL be a pure function evaluated only at the compose decision point; a throwing policy SHALL degrade that decision point to its default and SHALL NOT fail the whole composition.
5. **WHEN** one contributor fails during assembly **THEN** the failure SHALL be recorded as degraded evidence for that contributor and SHALL NOT break the assembled graph for the others.

**Classification:** B projection（主公开面）+ policy registry（compose 策略）。

### CP-4 Node states and provenance fields

**User Story:** As a diagnostic or UI consumer, I want every node to carry its lifecycle/visibility state and provenance fields, so that replacement, archival, and redaction are individually explainable.

**Acceptance Criteria:**

1. **WHEN** a node is part of a graph **THEN** it SHALL carry exactly one of `contributed` / `served` / `sent` / `archived` / `redacted` / `superseded` and every state transition SHALL be recorded with a reason.
2. **WHEN** a node is recorded **THEN** it SHALL carry `source`, bounded `sourceEventSeqs`, `supersedes`, `expiresAt`, and an audience envelope.
3. **WHEN** a node is expired or redacted **THEN** it SHALL be excluded from the `served` view with an explicit reason and SHALL remain visible only through archive/dropped projections according to its audience envelope.
4. **WHEN** a node is superseded **THEN** it SHALL be retained as replacement lineage and SHALL NOT be re-served.

**Classification:** B；状态词汇为生命周期/可见性状态，不与 `identity-and-lifecycle.md` §3 终态词汇混用。

### CP-5 Assembled-context evidence slice（R 类）

**User Story:** As a diagnostic or UI consumer, I want authoritative evidence of what was actually sent to the model, so that `sent` is fact-based instead of asserted.

**Acceptance Criteria:**

1. **WHEN** the agent-loop replacement renders the assembled system prompt or prepares the message dispatch (equivalent of official `renderContextSections` / `renderPrompt` call sites) **THEN** it SHALL emit a frozen assembled-context evidence payload `{ sessionId, generation, systemSections, messageRanges, dropped, observedAt }` and SHALL NOT alter the assembled content, ordering, or loop decisions (evidence-only, no policy inside the R slice).
2. **WHEN** the evidence slice is emitted **THEN** it SHALL be delivered only through the official patch mechanism of the existing `plugin-api-agent-loop` replacement (R1), preserve the official `ctx.agentLoop` contract (R2), not cover the `@deepseek-ai/dsh-agent-loop` import surface (R3), and pass the package's existing boot self-check (R4), version lock (R5), sole-owner conflict detection (R6), and cross-cutting-dispatch exclusion (R9).
3. **WHEN** the evidence references content **THEN** it SHALL carry identifiers/seq ranges only (sectionKey, sourceTags, message seq ranges) and SHALL NOT embed content or secrets in the payload.
4. **WHEN** the evidence slice is absent or inactive **THEN** the facade SHALL cap node states at `served` with the `served ≠ sent` disclosure and SHALL NOT synthesize `sent`.
5. **WHEN** evidence matches a graph node **THEN** the facade SHALL transition that node to `sent` with the evidence reference and observedAt; unmatched contributions SHALL remain `served`/`dropped` per their own records.
6. **WHEN** evidence arrives late or for a stale generation **THEN** the facade SHALL apply the stale-result guard and SHALL NOT re-write an already-finalized node state.
7. **WHEN** this feature is delivered **THEN** it SHALL register upstream proposal **U19（官方 assembled-context evidence seam）** with retirement condition: 官方在组装/发送点提供等价 provenance 证据（或 agent loop 原生消费带 provenance 的 assembled context）后，消费者迁移官方 seam，本 R 切片能力退役、只保留门面。

**Classification:** R 能力切片（owner `dsh-agent-loop`，承载于已交付 `@deepseek-ai/dsh-plugin-api-agent-loop`）+ C 类上游提案登记。

### CP-6 Inspect projection

**User Story:** As a diagnostic or UI consumer, I want to inspect a session's served/archive/dropped context with reasons, so that context decisions can be audited after the fact.

**Acceptance Criteria:**

1. **WHEN** `inspect(session)` is invoked **THEN** the facade SHALL return a frozen projection of served, archived, and dropped nodes with per-node reasons.
2. **WHEN** history exceeds bounds **THEN** bounded results with `truncated` / `nextCursor` / `unavailable` metadata; no fabricated history.
3. **WHEN** inspection output is produced **THEN** redaction SHALL be applied before projection and the audience envelope SHALL be enforced per node.
4. **WHEN** the requested session is missing or out of scope **THEN** typed unavailable result; no existence disclosure beyond the caller's scope.

**Classification:** B projection；默认 UI/diagnostic 受众。

### CP-7 Replacement mapping（compaction/prune）

**User Story:** As a diagnostic or UI consumer, I want to know what compaction or pruning replaced, so that disappearing content is explained instead of silently vanishing.

**Acceptance Criteria:**

1. **WHEN** compaction or prune evidence is available through the official seam or the delivered compaction events vocabulary **THEN** the facade SHALL record a bounded replacement mapping `{ oldNodeIds → newNodeId, reason, generation }`.
2. **WHEN** replacement mappings are queried **THEN** frozen read-only views.
3. **WHEN** the compaction seam is unavailable **THEN** explicit unavailable result; no fabricated mappings.

**Classification:** B（消费官方 compaction seam 与已交付 compaction 事件词汇）。

### CP-8 Redaction and audience envelope

**User Story:** As a plugin maintainer, I want secret content to stay out of every projection and evidence payload by default.

**Acceptance Criteria:**

1. **WHEN** a contribution contains secret values **THEN** the facade SHALL NOT include them in any graph or inspector output unless a user/profile policy explicitly allows it, and that policy SHALL default to deny.
2. **WHEN** a node is projected **THEN** its audience envelope (model / UI / diagnostic) SHALL be enforced per audience; model-visible content SHALL be an explicit design decision per node.
3. **WHEN** redaction fails **THEN** fail closed: the node SHALL be excluded or marked `redacted`, and raw content SHALL NEVER be leaked (evidence payloads carry identifiers only, no content).

**Classification:** B；`visibility-and-redaction.md` 全册适用。

### CP-9 Cancellation, stale generation, and degradation

**User Story:** As a plugin maintainer, I want composition and inspection to respect cancellation and staleness, so that slow or replaced sources cannot publish into the current graph.

**Acceptance Criteria:**

1. **WHEN** compose or inspect receives a cancellation signal **THEN** the facade SHALL respect it and SHALL produce a typed aborted outcome for that operation without corrupting other operations.
2. **WHEN** a contribution's generation is stale **THEN** its pending results SHALL lose submission qualification and SHALL be retained only as diagnostics.
3. **WHEN** projections are observed **THEN** observer epoch and stale-callback guard per the projection lifecycle.
4. **WHEN** a source assembly fails **THEN** the failure SHALL degrade only that source with typed evidence, never throw through apply, never kill harness boot.

**Classification:** B；`concurrency-and-cancellation.md` §2–5 适用。

### CP-10 Ownership boundary and client surface

**User Story:** As a maintainer of this repository, I want this facade to stay a read-only explanation layer, so that it never silently becomes the owner of memory, attachment, session, skill, or tool state.

**Acceptance Criteria:**

1. **WHEN** the facade consumes other features **THEN** it SHALL use their public projections only and SHALL NOT own or mutate their durable state.
2. **WHEN** a compose result exists **THEN** it SHALL NOT trigger retry, route, approval, mutation, or prompt-injection bypass.
3. **WHEN** client code interacts with this feature **THEN** the feature SHALL expose no client remote/slot/settings surface.
4. **WHEN** implementation crosses official component boundaries **THEN** the feature SHALL NOT use cross-component R replacement; the single R slice SHALL remain within the `dsh-agent-loop` component.

**Classification:** B boundary；`capability-strategy.md` §4.1（facade + 单一 R 能力切片）。

## Non-Goals

- 替代 token meter 或重建官方 transcript；无限历史导出；secret 进入 inspector。
- 客户端 remote/slot/settings 面；跨组件 R replacement。
- 由 compose 结果自动执行 retry/route/approval/mutation 或 prompt 注入旁路。
- 为 memory 提供专用 facade（memory 为可选来源，经 contribution 元数据声明）。
- 在 R 证据切片内做 loop 组装/策略决策（切片只发射证据；组装点策略消费归 C 类 U19）。
