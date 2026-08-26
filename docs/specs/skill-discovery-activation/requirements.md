# Stage 1 - Requirements

## Status

SPEC1 Stage 1：Requirements 已产出，与 Stage 0 Goal 一并提交 M6 第六批次批量确认门，**尚未获批**。获批前不得进入 Stage 2 Design。

## Introduction

`skill-discovery-activation` 为 skill 提供 discover → activate → expose → deactivate 的可组合生命周期：skill 先以轻量 descriptor 被发现，再按 session/agent/turn 范围显式激活，激活结果携带 generation，暴露面（工具、prompt sections、resources）可查询且随停用/替换失效。它收敛 `dsh-vision-toolkit`（runtime ready 后按 skill 激活 visual tools）、`dsh-tianshu-tui`（skills browser、user-invocable gesture、`skills/change` 刷新）各自实现的同一缺口——官方 `pluginApi.services.skills` 只是 registry 直通，不拥有 activation lifetime。

本 feature 初版是 **B 类 host facade**：组合官方 skills registry 直通、`progressive-tool-discovery`、systemPrompt assemble 与 execution/session scope。**完整工具 schema 与 per-turn 可见性全部委托 `pluginApi.tools.discovery`**，本 feature 不再建第二套工具目录。官方 skill loader 的 R 类评估不在本 feature 内执行（见 SDA-11）。Host 是权威面；client 没有激活权威，初版不新增 client wire。

## Definitions and Boundaries

- **Skill descriptor**：目录条目的轻量描述（skillId、owner、summary、capabilities、source kind 与激活来源绑定），不含完整 tool schema。
- **Activation**：把 skill 的暴露绑定到 scope（session / agent / turn）与 generation 的动作；TTL 到期是显式降级路径，不静默延长。
- **Exposure record（本 feature 定义的公开词汇，供 `context-provenance` 消费）**：冻结只读视图 `{ skillId, owner, sourceKind, scope, generation, tools, promptSections, resources, degraded[], availability }`；其中 `tools` 只承载 `tools.discovery` 的 descriptor/toolset 引用，不复刻完整 schema。
- **Generation**：owner-specific opaque token（`identity-and-lifecycle.md` §2），只判定旧暴露是否被取代，不得跨 owner 比较。
- **与相邻 feature 分工**：完整 tool schema 与 per-turn 可见性归 `progressive-tool-discovery`；MCP server/tool identity 归 `mcp-catalog-lifecycle`；route/recovery/approval 决策归各自 owner；client 面生命周期降级词汇归 `client-generation-rebind`；官方 skills registry 直通（`pluginApi.services.skills`）仅作发现来源，不拥有 activation lifetime。
- **Host/client boundary**：host 拥有 descriptor/activate/deactivate/audit 全部面；client 只能消费只读 exposure 信息，无激活权威，无新 client wire。

## Standards Alignment

按 `docs/standards/` 六册对照：

- **capability-strategy**：适用——初版 B 类通道；官方 skill loader 是否构成唯一一致性 owner 的 R 类评估边界记录于 SDA-11；横切派发语义不涉及。
- **api-shape**：核心适用——主公开面是 activation lifecycle mutation 面（descriptor/activation/deactivation 单一 owner registry，latest-wins generation）；discover/exposure 查询为冻结只读投影；无 durable mutation 面。
- **identity-and-lifecycle**：适用——generation 用 owner-specific opaque token；被取代的 activation 按 `superseded` 处理；不引入新终态词汇，激活超时归 `error` + `timeout` reason。
- **durable-state-and-scope**：部分适用——activation 状态为 memory-resident（随 scope 结束），不声明 durable mutation 面；bounded audit 若持久化须单档归属（Design 定）；默认不自动 retry。
- **visibility-and-redaction**：适用——descriptor summary/source kind 进入模型可见面属显式设计决定；audit 默认 diagnostic/UI 可见、不进入模型；secret 永不进入 exposure 投影；逐条受众标注见各需求。
- **concurrency-and-cancellation**：适用——activate/deactivate 构成 latest-wins 竞争，旧 generation 异步结果失去提交资格；disposer 按 identity 清理；激活回调异常 containment。

## Requirements

### SDA-1 Descriptor registration and identity

**User Story:** As a skill provider plugin, I want to register lightweight skill descriptors without exposing full tool schemas, so that discovery stays cheap and registration is contained.

**Acceptance Criteria:**

1. **WHEN** a caller registers a skill descriptor **THEN** the facade SHALL require a unique skillId, a non-empty owner id, a summary bounded to at most 200 characters, declared capabilities, a source kind, and an activation source (explicit invocation entry, auto-match condition, or provider callback), and SHALL return a handle with generation token and disposer.
2. **WHEN** a duplicate skillId is registered within the same owner namespace **THEN** the facade SHALL reject it with a typed conflict result and SHALL preserve the existing descriptor.
3. **WHEN** a disposer is invoked more than once **THEN** the facade SHALL make disposal idempotent and SHALL NOT remove descriptors owned by other owners.
4. **WHEN** descriptor metadata is consumed by any projection **THEN** the facade SHALL provide it as frozen read-only data.

**Classification:** B（facade registry；官方 skills registry 直通仅作发现来源，不拥有 activation lifetime）。

### SDA-2 Discovery search projection

**User Story:** As a plugin maintainer, I want to search skill descriptors and receive only lightweight summaries, so that discovery does not leak full tool schemas or cause side effects.

**Acceptance Criteria:**

1. **WHEN** a discovery search is performed for a scope **THEN** the facade SHALL return only matching frozen descriptors and SHALL NOT activate anything as a side effect.
2. **WHEN** a search yields no matches **THEN** the facade SHALL return an explicit empty result rather than fabricating suggestions.
3. **WHEN** search results are surfaced to the model audience **THEN** each descriptor SHALL contain only designed model-visible fields (skillId, summary, capabilities, source kind) and SHALL NOT include full tool schemas.
4. **WHERE** a `tools.discovery` constraint forbids an entry in a scope **THEN** the facade SHALL exclude that entry from the scope's results and SHALL record the exclusion reason in the result metadata.

**Classification:** B；descriptor summary/source kind 为显式设计的模型可见受众（`visibility-and-redaction.md` §1）。

### SDA-3 Activation lifecycle

**User Story:** As a plugin maintainer, I want on-demand activation scoped to a session/agent/turn, so that a skill's exposure appears exactly when justified and expires when it should.

**Acceptance Criteria:**

1. **WHEN** a caller activates a skill with `{ scope, reason, ttl }` **THEN** the facade SHALL produce an activation bound to a new generation and valid in that scope; activation state is memory-resident and SHALL NOT claim durable persistence.
2. **WHEN** the owning scope ends or the TTL expires **THEN** the facade SHALL produce a typed degraded/expired outcome for that activation and SHALL NOT silently extend it.
3. **WHEN** activation is requested for an unknown, disposed, or conflicting entry **THEN** the facade SHALL reject it with a typed result and SHALL NOT partially expose the skill.
4. **WHEN** a newer activation for the same skill and scope arrives **THEN** the facade SHALL apply latest-wins semantics and the previous generation SHALL be treated as superseded.
5. **WHEN** activation exceeds its deadline **THEN** the outcome SHALL be `error` with reason `timeout`; no new terminal vocabulary is introduced.

**Classification:** B（host lifecycle mutation；latest-wins 与终态裁决按 `concurrency-and-cancellation.md` §2/§6）。

### SDA-4 Invocation source classification

**User Story:** As a plugin maintainer, I want every activation to record exactly how it was triggered, so that user-invocable, explicit, auto-match, and provider-sourced activations are never conflated in audit or exposure.

**Acceptance Criteria:**

1. **WHEN** an activation is recorded **THEN** it SHALL carry exactly one source kind from `userInvocable` / `explicit` / `auto-match` / `provider-sourced` and the kind SHALL be preserved in audit and exposure metadata.
2. **WHEN** an auto-match or provider-sourced activation occurs **THEN** it SHALL be driven by a declared condition or capability, and that condition SHALL be queryable; silent unconditional activation is not permitted.
3. **WHEN** an activation records its source **THEN** the facade SHALL NOT conflate `userInvocable` with `explicit` or `auto-match`; the exact kind SHALL remain distinguishable end to end.

**Classification:** B；来源分类元数据对 diagnostic/UI 可见，按需进入模型受众须经显式 policy。

### SDA-5 Exposure projection

**User Story:** As a plugin maintainer, I want to query exactly what a skill exposes at its current generation, so that tools, prompt sections, and resources are attributable and verifiable.

**Acceptance Criteria:**

1. **WHEN** exposure is queried for `(skill, generation)` **THEN** the facade SHALL return the frozen exposure record defined in Definitions and SHALL NOT mutate any state as a side effect.
2. **WHEN** an exposure record references tools **THEN** the `tools` field SHALL carry only `tools.discovery` descriptor/toolset references and SHALL NOT duplicate full tool schemas.
3. **WHEN** the requested generation is stale or foreign **THEN** the facade SHALL return a typed result and SHALL NOT fabricate a current exposure.
4. **WHEN** exposure metadata is consumed by another feature (notably `context-provenance`) **THEN** the exposure record shape defined in this document SHALL be the stable public vocabulary for that consumption.

**Classification:** B projection；exposure 元数据默认 diagnostic/UI 可见，`promptSections` 内容按官方 seam 进入模型受众，secret 永不进入投影。

### SDA-6 Tool exposure delegation

**User Story:** As a plugin maintainer, I want skill-declared tools to flow through the shared tool discovery pipeline, so that there is exactly one tool catalog and one per-turn visibility authority.

**Acceptance Criteria:**

1. **WHERE** a skill declares tools **THEN** the facade SHALL delegate full schema registration and per-turn visibility to `pluginApi.tools.discovery` and SHALL NOT maintain a second tool catalog.
2. **WHEN** `tools.discovery` is unavailable or a delegated entry fails activation **THEN** only the tools portion of that skill's exposure SHALL degrade with a typed unavailable result, while prompt sections and resources degrade independently, and other skills SHALL be unaffected.
3. **WHEN** a skill is deactivated **THEN** its delegated tool exposure SHALL be withdrawn through the same `tools.discovery` path for new exposures while in-flight executions keep their previous generation view.

**Classification:** B（消费已交付 `progressive-tool-discovery` seam，不重造工具目录）。

### SDA-7 Deactivation and generation replacement

**User Story:** As a plugin maintainer, I want to deactivate or replace skills without breaking in-flight work, so that old executions complete coherently while new ones see the updated set.

**Acceptance Criteria:**

1. **WHEN** an owner deactivates a skill for a scope **THEN** new exposures in that scope SHALL no longer include the skill while executions already holding the previous generation SHALL keep their coherent view until they finish.
2. **WHEN** a newer generation replaces an older one in the same scope **THEN** pending asynchronous results of the older generation SHALL lose submission qualification and SHALL be retained only as diagnostics.
3. **WHEN** a deactivation disposer runs **THEN** it SHALL clean up only the resources created by its own generation and SHALL NOT remove another owner's or a newer generation's exposure.
4. **WHEN** deactivate is called with a stale or foreign generation **THEN** the facade SHALL return a typed no-op/reject outcome and SHALL preserve the current active exposure.

**Classification:** B（facade guard）；按 `concurrency-and-cancellation.md` §4–5 的 stale-result 与 disposer 所有权规则。

### SDA-8 Dependency and failure isolation

**User Story:** As a plugin maintainer, I want one broken or under-provisioned skill contained, so that it cannot take down other skills, the hosting operation, or harness boot.

**Acceptance Criteria:**

1. **WHEN** a skill declares dependencies and any dependency is missing **THEN** the facade SHALL degrade only that skill with a typed degraded result and owner-attributed plugin diagnostics, while other registry entries SHALL remain unaffected.
2. **WHEN** an activate callback or provider throws or returns malformed output **THEN** the facade SHALL contain the failure, mark that skill failed with owner attribution, and SHALL keep the hosting operation alive.
3. **WHEN** the feature itself fails setup **THEN** it SHALL degrade to inert availability reporting, SHALL NOT throw through apply, and SHALL NOT kill harness boot.
4. **WHEN** degraded **THEN** availability queries SHALL reflect the true state and SHALL NOT fabricate defaults for previously recorded exposures.

**Classification:** B。

### SDA-9 Bounded audit

**User Story:** As a plugin maintainer, I want to query why skills were activated, degraded, replaced, or deactivated, so that behavior differences across turns can be explained and debugged.

**Acceptance Criteria:**

1. **WHEN** an activation, deactivation, degradation, or supersede event affects a scope **THEN** the facade SHALL append a bounded audit record containing skillId, owner, sourceKind, reason, generation, and timestamp.
2. **WHEN** audit records are queried **THEN** the facade SHALL return frozen read-only views; records are diagnostic/UI-visible by default and not model-visible.
3. **WHEN** audit storage fails **THEN** the facade SHALL surface the gap explicitly and SHALL NOT fabricate records; the lifecycle operations themselves SHALL continue.

**Classification:** B；持久化档位在 Design 阶段按 `durable-state-and-scope.md` §1 定档。

### SDA-10 Client boundary

**User Story:** As a client plugin maintainer, I want a truthful client surface, so that browser code can render exposure state but can never activate or deactivate skills.

**Acceptance Criteria:**

1. **WHEN** client code consumes exposure information through existing host projections **THEN** it SHALL receive read-only exposure summaries with explicit availability metadata.
2. **WHEN** client code attempts descriptor registration, discovery authority, activation, or deactivation through this feature **THEN** the feature SHALL expose no such client surface.
3. **WHEN** the client face is unavailable **THEN** host activation SHALL remain active and truthful, and client-side degradation SHALL use the `client-generation-rebind` vocabulary rather than disabling the host feature.

**Classification:** B boundary；不新增 client transport/remote/slot/settings 面。

### SDA-11 Channel boundary（B 初版 + R 评估分离）

**User Story:** As a maintainer of this repository, I want the B-class facade delivered without touching official rows, while the official skill loader's ownership question stays a recorded, separately gated evaluation.

**Acceptance Criteria:**

1. **WHEN** this feature is delivered in its first version **THEN** it SHALL NOT replace or disable any official loader row, and the official skills registry pass-through SHALL remain unchanged.
2. **GIVEN** Design-stage evidence proves the official skill loader is the unique consistency owner of skill→exposure **THEN** that finding SHALL be recorded as a separate R-class evaluation entry under `capability-strategy.md` R1–R9 and SHALL NOT be implemented inside this feature's first version.
3. **WHEN** cross-cutting dispatch semantics (priority / deepFreeze / fault containment) are involved **THEN** this feature SHALL NOT route them through R.

**Classification:** B / 通道治理边界（C/R 判定记录，不在本 feature 内落地）。

## Non-Goals

- 完整 tool schema 注册与 per-turn 可见性（归 `progressive-tool-discovery`）。
- MCP server identity、transport 与生命周期（归 `mcp-catalog-lifecycle`）。
- route / recovery / approval 决策。
- 自动执行 skill action；编写 prompt 文案。
- 新 client wire / remote / slot / settings 面。
- 在本 feature 内替换官方 skill loader 行（SDA-11 只记录评估边界）。
