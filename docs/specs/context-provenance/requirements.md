# Stage 1 - Requirements

## Status

SPEC1 Stage 1：Requirements 已产出，与 Stage 0 Goal 一并提交 M6 第六批次批量确认门，**尚未获批**。获批前不得进入 Stage 2 Design。本件为 Wave B：已消费 Wave A `skill-discovery-activation` 的 exposure 词汇（见 CP-2，引用 SDA-5 exposure record）。

## Introduction

`context-provenance` 为第三方插件与诊断/界面消费者提供可解释的上下文组合与 provenance 契约：回答一段内容从哪里来、是否实际服务给模型、何时被压缩/替换/归档、以及为什么不可见。它把 systemPrompt 注入、session surface、attachment projection、tool/skill exposure、memory 插件产出与 compaction 产生的碎片关联成一个有界、只读可审阅的贡献图（contribution graph），但绝不把“已贡献”伪装成“模型一定看到了”。

本 feature 初版按 **B/C 边界**推进：现有 systemPrompt/session surface 可支撑有界 facade（B 类）；要求官方 agent loop 在组装点原生消费带 provenance 的 assembled context 属于 **C 类**，只登记 upstream proposal、不伪造官方保证（CP-5）。组合结果是只读解释面：不拥有 memory/attachment/session/skill/tool 的持久状态，不得因 compose 结果自动执行 retry、route、approval、mutation 或 prompt 注入旁路。

## Definitions and Boundaries

- **Contribution**：一次注册 `{ id, owner, scope, phase, priority, content/ref, source, sourceEventSeqs, expiresAt, audience }`；content/ref 只承载引用或已脱敏内容。
- **Node lifecycle/visibility states**：`contributed` → `served` → `sent` | `archived` | `redacted` | `superseded`。这些是可见性/生命周期状态，不是操作终态词汇；有终态的操作对象仍使用 `identity-and-lifecycle.md` §3 的统一终态词汇。
- **Compose**：把当前请求范围内的 contributions 按 scope/phase/priority 组装为冻结贡献图；纯读解释面。
- **Inspect**：session 维度的 served / archive / dropped 只读投影。
- **Replacement mapping**：compaction/prune 证据驱动的旧节点 → 新节点映射。
- **与相邻 feature 分工**：execution/session correlation 归 `execution-observation`；attachment identity/generation 归 `attachment-pipeline`；branch boundary/edit lineage 归 `session-branch-sidechain-edit`；工具暴露来源归 `progressive-tool-discovery`；skill 暴露来源归 `skill-discovery-activation`（本 feature 消费其 SDA-5 exposure record 词汇，不重实现其生命周期）；失败与可见性边界归 `plugin-diagnostics` 与 `visibility-and-redaction`；memory 来源可选，由具体插件经 contribution 元数据声明，不依赖专用 memory facade。
- **Host/client boundary**：host-only；不新增 client remote/slot/settings 面。

## Standards Alignment

按 `docs/standards/` 六册对照：

- **capability-strategy**：适用——初版 B 类组合 facade；官方 assembled-context seam 的 C 类边界记录于 CP-5；不涉及 R replacement；横切派发语义不走 R。
- **api-shape**：核心适用——主公开面为 projection 面（compose/inspect 冻结只读、无副作用）；compose 策略为独立 policy registry 面（纯函数、输入显式传入）；无 durable mutation 面。
- **identity-and-lifecycle**：适用——贡献与节点使用 owner-specific generation；节点状态是生命周期/可见性状态而非终态词汇；`superseded` 只作被替换节点的状态与 replacement lineage，不开启旧结果补写通道。
- **durable-state-and-scope**：部分适用——本 feature 不声明 durable mutation 面；bounded 历史与 replacement mapping 若持久化须单档归属（Design 定）；默认不自动 retry。
- **visibility-and-redaction**：核心适用——受众包络（模型/UI/diagnostic）逐节点强制；secret 默认禁止进入 graph/inspector；脱敏失败 fail-closed；逐条受众标注见各需求。
- **concurrency-and-cancellation**：适用——compose/inspect 尊重 AbortSignal；stale generation 失去提交资格；projection observer epoch；单贡献源失败只降级该来源。

## Requirements

### CP-1 Contribution registration and identity

**User Story:** As a plugin maintainer, I want to register context contributions with explicit identity, scope, and provenance, so that later composition can attribute every piece of context to its source.

**Acceptance Criteria:**

1. **WHEN** a caller registers a contribution **THEN** the facade SHALL require a unique id, a non-empty owner, a single scope tier from `{ request, session }`, phase, priority, a source kind, and an audience envelope, and SHALL return a handle with generation token and disposer.
2. **WHEN** a duplicate contribution id is registered within the same owner namespace **THEN** the facade SHALL reject it with a typed conflict result and SHALL preserve the existing contribution.
3. **WHEN** a disposer is invoked more than once **THEN** the facade SHALL make disposal idempotent and SHALL NOT remove contributions owned by other owners.
4. **WHEN** contribution metadata is consumed by any projection **THEN** the facade SHALL provide it as frozen read-only data.

**Classification:** B（facade registry）；content 的受众按 CP-8 包络强制执行。

### CP-2 Source vocabulary and seams

**User Story:** As a plugin maintainer, I want each contribution to declare which existing seam produced it, so that the provenance graph names real sources instead of inventing them.

**Acceptance Criteria:**

1. **WHEN** a contribution is registered **THEN** it SHALL declare a source kind from `{ systemPrompt, sessionSurface, attachment, toolExposure, skillExposure, memory, compaction }` plus the producing owner.
2. **WHEN** a contribution derives from session surface **THEN** it SHALL carry bounded `sourceEventSeqs` and SHALL NOT synthesize sequence numbers that the source did not provide.
3. **WHEN** the facade consumes skill exposure provenance **THEN** it SHALL use the exposure record vocabulary defined by `skill-discovery-activation` (SDA-5) via that feature's public projection, and SHALL treat the skill feature as the source owner without re-implementing its lifecycle.
4. **WHEN** a memory plugin contributes recall content **THEN** the facade SHALL accept it via declared contribution metadata only (optional source) and SHALL NOT depend on any dedicated memory facade.
5. **WHEN** a source seam is unavailable **THEN** evidence from that source SHALL degrade with a typed unavailable/degraded result while other sources SHALL remain unaffected.

**Classification:** B（组合既有公开 seam）；skill 词汇为 Wave A 契约消费，memory 为可选来源。

### CP-3 Compose and budget

**User Story:** As a plugin maintainer, I want a deterministic, budget-bounded composition of contributions for a request, so that assembly is explainable and cannot silently exceed limits or trigger side effects.

**Acceptance Criteria:**

1. **WHEN** `compose(request, { budget, policy })` is invoked **THEN** the facade SHALL return a frozen contribution graph and SHALL NOT mutate state, trigger retry/route/approval decisions, or bypass prompt injection paths as a side effect.
2. **WHEN** contributions are assembled **THEN** ordering SHALL be deterministic by scope, phase, and priority, with documented tie-breaking.
3. **WHEN** a budget constrains composition **THEN** the facade SHALL truncate with a per-node dropped reason and SHALL NOT silently include over-budget content.
4. **WHEN** a compose policy is registered **THEN** it SHALL be a pure function evaluated only at the compose decision point; a throwing policy SHALL degrade that decision point to its default and SHALL NOT fail the whole composition.
5. **WHEN** one contributor fails during assembly **THEN** the failure SHALL be recorded as degraded evidence for that contributor and SHALL NOT break the assembled graph for the others.

**Classification:** B projection（主公开面）+ policy registry（compose 策略）；无 durable mutation。

### CP-4 Node states and provenance fields

**User Story:** As a diagnostic or UI consumer, I want every node to carry its lifecycle/visibility state and provenance fields, so that replacement, archival, and redaction are individually explainable.

**Acceptance Criteria:**

1. **WHEN** a node is part of a graph **THEN** it SHALL carry exactly one of `contributed` / `served` / `sent` / `archived` / `redacted` / `superseded` and every state transition SHALL be recorded with a reason.
2. **WHEN** a node is recorded **THEN** it SHALL carry `source`, bounded `sourceEventSeqs`, `supersedes`, `expiresAt`, and an audience envelope.
3. **WHEN** a node is expired or redacted **THEN** it SHALL be excluded from the `served` view with an explicit reason and SHALL remain visible only through archive/dropped projections according to its audience envelope.
4. **WHEN** a node is superseded **THEN** it SHALL be retained as replacement lineage and SHALL NOT be re-served.

**Classification:** B；状态词汇为生命周期/可见性状态，不与 `identity-and-lifecycle.md` §3 终态词汇混用。

### CP-5 Served/sent evidence boundary（B/C）

**User Story:** As a plugin maintainer, I want the facade to claim only what the available evidence supports, so that "served" is never presented as "the model saw it" without proof.

**Acceptance Criteria:**

1. **WHEN** the facade marks a node `sent` **THEN** it SHALL do so only on supported official dispatch evidence; otherwise the ceiling SHALL be `served` with an explicit disclosure that `served ≠ sent`.
2. **WHEN** no send evidence exists **THEN** the facade SHALL NOT claim model visibility for that node.
3. **GIVEN** native consumption of provenance-carrying assembled context at the official agent loop assembly point is required **THEN** the requirement SHALL be registered as a C-class upstream proposal; the facade SHALL NOT fabricate that guarantee.
4. **WHEN** the upstream seam is unavailable **THEN** the facade SHALL return bounded unavailable/degraded evidence and SHALL NOT affect harness boot.

**Classification:** B/C 边界；upstream proposal 在 Design 阶段登记（U-series），本 feature 不伪造官方保证。

### CP-6 Inspect projection

**User Story:** As a diagnostic or UI consumer, I want to inspect a session's served/archive/dropped context with reasons, so that context decisions can be audited after the fact.

**Acceptance Criteria:**

1. **WHEN** `inspect(session)` is invoked **THEN** the facade SHALL return a frozen projection of served, archived, and dropped nodes with per-node reasons.
2. **WHEN** history exceeds bounds **THEN** the facade SHALL return bounded results with `truncated` / `nextCursor` / `unavailable` metadata and SHALL NOT fabricate missing history.
3. **WHEN** inspection output is produced **THEN** redaction SHALL be applied before projection and the audience envelope SHALL be enforced per node.
4. **WHEN** the requested session is missing or out of scope **THEN** the facade SHALL return a typed unavailable result and SHALL NOT disclose resource existence beyond the caller's scope.

**Classification:** B projection；默认 UI/diagnostic 受众，模型受众须经显式 policy（`visibility-and-redaction.md` §2）。

### CP-7 Replacement mapping（compaction/prune）

**User Story:** As a diagnostic or UI consumer, I want to know what compaction or pruning replaced, so that disappearing content is explained instead of silently vanishing.

**Acceptance Criteria:**

1. **WHEN** compaction or prune evidence is available through the official seam or the delivered compaction events vocabulary **THEN** the facade SHALL record a bounded replacement mapping `{ oldNodeIds → newNodeId, reason, generation }`.
2. **WHEN** replacement mappings are queried **THEN** the facade SHALL return frozen read-only views.
3. **WHEN** the compaction seam is unavailable **THEN** the facade SHALL return an explicit unavailable result and SHALL NOT fabricate mappings or claim a replacement that did not happen.

**Classification:** B（消费官方 compaction seam 与已交付 compaction 事件词汇）。

### CP-8 Redaction and audience envelope

**User Story:** As a plugin maintainer, I want secret content to stay out of every projection by default, so that provenance graphs cannot become an exfiltration channel.

**Acceptance Criteria:**

1. **WHEN** a contribution contains secret values **THEN** the facade SHALL NOT include them in any graph or inspector output unless a user/profile policy explicitly allows it, and that policy SHALL default to deny.
2. **WHEN** a node is projected **THEN** its audience envelope (model / UI / diagnostic) SHALL be enforced per audience; model-visible content SHALL be an explicit design decision per node.
3. **WHEN** redaction fails **THEN** the facade SHALL fail closed: the node SHALL be excluded or marked `redacted`, and raw content SHALL NEVER be leaked.

**Classification:** B；`visibility-and-redaction.md` 全册适用（含 §4 client 半身受众——本 feature 不新增 client 产物）。

### CP-9 Cancellation, stale generation, and degradation

**User Story:** As a plugin maintainer, I want composition and inspection to respect cancellation and staleness, so that slow or replaced sources cannot publish into the current graph.

**Acceptance Criteria:**

1. **WHEN** compose or inspect receives a cancellation signal **THEN** the facade SHALL respect it and SHALL produce a typed aborted outcome for that operation without corrupting other operations.
2. **WHEN** a contribution's generation is stale **THEN** its pending results SHALL lose submission qualification and SHALL be retained only as diagnostics.
3. **WHEN** projections are observed **THEN** the facade SHALL provide an observer epoch and stale-callback guard per the projection lifecycle.
4. **WHEN** a source assembly fails **THEN** the failure SHALL degrade only that source with typed evidence, SHALL never throw through apply, and SHALL never kill harness boot.

**Classification:** B；`concurrency-and-cancellation.md` §2–5 适用。

### CP-10 Ownership boundary and client surface

**User Story:** As a maintainer of this repository, I want this facade to stay a read-only explanation layer, so that it never silently becomes the owner of memory, attachment, session, skill, or tool state.

**Acceptance Criteria:**

1. **WHEN** the facade consumes other features **THEN** it SHALL use their public projections only and SHALL NOT own or mutate their durable state.
2. **WHEN** a compose result exists **THEN** it SHALL NOT trigger retry, route, approval, mutation, or prompt-injection bypass.
3. **WHEN** client code interacts with this feature **THEN** the feature SHALL expose no client remote/slot/settings surface.
4. **WHEN** implementation crosses official component boundaries **THEN** the feature SHALL NOT use cross-component R replacement.

**Classification:** B boundary；`capability-strategy.md` §4.1 组件边界与 facade 组合。

## Non-Goals

- 替代 token meter 或重建官方 transcript。
- 无限历史导出；secret 进入 inspector。
- 客户端 remote/slot/settings 面。
- 跨组件 R replacement。
- 由 compose 结果自动执行 retry/route/approval/mutation 或 prompt 注入旁路。
- 为 memory 提供专用 facade（memory 为可选来源，经 contribution 元数据声明）。
