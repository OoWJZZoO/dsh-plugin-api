# Stage 1 - Requirements

> feature_name: `scoped-agent-contributions`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12；requirements 与 design 同批产出，承接已确认 goal.md）
> 输入溯源：goal.md（2026-09-12 批量确认）；M10 工作纲领 §3.3 / §4.1；观察报告 §5（owner/作用域/追加与替换边界，含 caller-bound 现状与待运行验证标注）；M8 migration ledger 8.3(b)（read-image 每 agent 工具/提示词保留官方作用域表面的契约外精度登记）；canonical registry `prompts.contribute` 现行登记（无目标 agent 绑定维度）。

## Status

Stage 1 与 Stage 2 同批交付（2026-09-12）。本文把目标选择、贡献种类、生命周期、组合优先级与泄漏防护写成 EARS；scope 表达形状与 fiber probe 结论见 Design（probe 为 Stage 4 验证义务，本文不预下结论）。版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

**Stage 4 修订（2026-09-13，probe 驱动，已登记）**：Req 6.1 原写「目标销毁时从 scoped registry purge 该目标全部贡献」；官方源码 probe 证实**同进程恢复路径在重新 announce 同一 id 之前会先排空旧身份**（`agent/disposed` 与 `session/disposed` 均会发出，官方 `dsh-agent-loop` 的 `restoreOrCreateConfigured`/`waitForDrainingConfiguredIdentity` 为依据），因此销毁时物理 purge 会让 Req 5.2 不可达。Req 6.1 修订为**eviction 语义**（死目标零汇编效果 + 门面簿记保留为同身份重装源），并新增 Req 6.6 约束簿记有界（owner 绑定的 scope handle + owner 卸载全量释放）。Design 生命周期表同步修订。

## Introduction

本 feature 让插件为**具体 agent/session** 创建、查询作用域并安装可撤销贡献：prompt section/context/variable/tool provider 与必要的工具注册/限制。owner（贡献者插件）与 target（被贡献 agent）分开表达；贡献只影响目标，不泄漏到其他 agent/session；覆盖新建与恢复（cold resume）安装，生命周期随目标清理。主公开面是 contribution（含明确 target scope 维度）；工具按键注册仍归 resourceRegistry（tools 面），两者不共享含混状态机。持久 scope 仍只有 session/workspace/profile 三档，不引入第四档 agent durable scope。

## Requirement 1: 目标选择与 scope-bound handle

**User Story:** 作为 agent-teams 类插件的作者，我想取得指向明确 agent 的门面作用域句柄，而不直接 inject 该 agent 的官方 tools/systemPrompt。

### Acceptance Criteria

1. WHEN a plugin calls `pluginApi.agents.scopes.register({ agent })` with a resolvable target agent reference THEN the system SHALL return a frozen scope-bound handle `{ id, ownerId, generation, target, status(), dispose() }` where `ownerId` is the caller-derived contributor identity and `target` identifies the bound agent (owner 与 target 分开表达).
2. WHEN the target reference cannot be resolved (nonexistent agent, disposed agent, or unavailable agents backing) THEN the system SHALL return a typed `unavailable` result and SHALL NOT silently fall back to a global/unscoped surface (不可用 target 不静默回退全局).
3. WHEN the handle's target agent is alive THEN `status()` SHALL report the target's usability state; WHEN the target is destroyed THEN `status()` SHALL report the destroyed state without resurrecting it.
4. WHEN a plugin uses the handle as the scope dimension of a contribution call THEN the facade SHALL NOT require the plugin to hold the target agent's official ctx, official tools service, or official systemPrompt service directly.
5. WHEN the handle is disposed THEN it SHALL release the handle's own bookkeeping per Requirement 6, and stale handle usage SHALL return typed no-op results.

**Classification:** A/B 类门面化（官方 agent registry / setup 面之上的门面表达）；无 R 点位（判定见 Design 通道表）。入口动词用 `register`（resourceRegistry，`api-idioms.md` §3.6），不用 coordination 词表的 `acquire`（本 handle 无 lease/fencing/heartbeat 语义）；handle 的 `target` / `status()` 扩展成员按 §1 六项例外登记（见 Design「scope 表达」）。

## Requirement 2: 作用域化 prompt 贡献

**User Story:** 作为插件作者，我想为目标 agent 安装 prompt section/context/variable/tool provider 贡献，且贡献只进入该目标的汇编。

### Acceptance Criteria

1. WHEN a plugin calls `pluginApi.prompts.contribute(spec)` with a `spec.scope` bound to a scope handle and a supported kind (`section | context | variable | tools | suppressRuntimeContext`) THEN the system SHALL install the contribution into the target agent's assembly context only, and SHALL return the contribution idiom result with handle `{ id, ownerId, seq, dispose() }`.
2. WHEN any agent other than the target assembles its prompt THEN the scoped contribution SHALL NOT appear in that agent's assembly (不泄漏到其他 agent).
3. WHEN global projections of the prompts domain render without a target scope THEN scoped contributions SHALL NOT appear in them.
4. WHEN a scoped variable provider is evaluated THEN it SHALL be evaluated only during the target agent's assembly; other agents' assemblies SHALL NOT invoke it.
5. WHEN a scoped contribution spec is malformed or its kind is unsupported THEN the system SHALL return the existing `prompts.contribute` typed failure shapes; a scope-bearing call SHALL NOT degrade to an unscoped installation on failure (失败不回退全局).

**Classification:** A/B 类门面化（既有 `prompts.contribute` 单一 contribution owner + 新增 target 维度）；不建第二个 prompts 贡献 owner。

## Requirement 3: 作用域化工具注册与限制

**User Story:** 作为 read-image 类插件的作者，我想把工具注册/限制安装到指定 agent 的可见面，而工具按键注册仍走 tools resourceRegistry。

### Acceptance Criteria

1. WHEN a plugin calls `pluginApi.tools.register(definition, { scope })` with a scope handle THEN the tool definition SHALL be registered through the tools resourceRegistry with a target dimension, and the tool SHALL be resolvable only in the target agent's tool resolution.
2. WHEN another agent resolves its tools THEN the scoped tool SHALL NOT be visible or invocable in that agent's context.
3. WHEN a plugin calls `pluginApi.tools.restrict.register(policy, { scope })` THEN the restriction SHALL apply only to the target agent's tool set.
4. WHEN tool keys collide across scopes THEN the existing tools conflict rules SHALL apply per (owner, scope) pair: same owner + same key + same scope follows the existing conflict rule; same key under different scopes or different owners SHALL NOT silently overwrite each other.
5. WHEN a scoped tool registration is disposed THEN only that (owner, scope, key) registration is removed; global registrations and other scopes' registrations SHALL be unaffected, and the tool-key registration shall remain a resourceRegistry concern without sharing a state machine with prompt contributions.

**Classification:** A/B 类门面化（既有 tools 面 + target 维度）；工具按键注册保持 resourceRegistry idiom。

## Requirement 4: 泄漏防护与组合隔离

**User Story:** 作为维护者，我要求两个 agent、两个插件、全局与局部叠加的全部组合互不串扰。

### Acceptance Criteria

1. WHEN the same plugin holds scope handles for two different agents THEN contributions installed through each handle SHALL affect only their own targets (同插件不同目标).
2. WHEN two plugins install contributions to the same target THEN each plugin's contributions SHALL be attributed to their own owner and SHALL coexist under the existing owner-conflict rules (两个插件同目标).
3. WHEN global contributions and scoped contributions coexist THEN the target agent's assembly SHALL contain the global additive contributions plus its scoped contributions, and other agents' assemblies SHALL contain only the global ones (全局与局部叠加).
4. WHEN a scoped contribution is added or removed THEN no other agent's assembly, no other owner's contributions, and no global contribution state SHALL change.
5. WHEN any of the above combinations runs THEN no scenario SHALL reach the target through official business-service bypass, private Symbol, or raw context paths (不访问官方业务服务旁路).

**Classification:** A/B 类门面化；泄漏防护为组合验收核心。

## Requirement 5: 安装时机（新建与恢复）

**User Story:** 作为插件作者，我要求贡献在 agent 新建与恢复（cold resume）后都真实生效。

### Acceptance Criteria

1. WHEN a plugin registers a scope handle via `agents.scopes.register` after creating an agent (including via `agents.create`) and installs contributions THEN the contributions SHALL be effective for the agent's subsequent assemblies.
2. WHEN an agent is resumed within the same host process (含官方 in-process 恢复路径) and the target identity stability of criterion 4 is proven THEN contributions previously installed for that target identity SHALL remain installed and effective for the resumed agent without requiring re-registration by the plugin, provided the contributor owner is still active; WHEN the resume crosses a host process or plugin restart THEN the scoped registry state is runtime state per Requirement 8 and the contributor SHALL re-install after restart (本 feature 不跨重启保持 scoped 贡献).
3. WHEN a contribution is provider-based (variable/tool provider) THEN it SHALL be evaluated per assembly of the target, so that a resumed agent observes current provider results rather than stale snapshots.
4. WHEN the stability of target identity across cold resume cannot be established from the official surface THEN the implementation SHALL be treated as unresolved (probe 义务，见 Design)；this feature SHALL NOT claim cold-resume coverage without the probe evidence.
5. WHEN an agent's own lifecycle (turn/step) advances THEN scoped contributions SHALL persist across steps for the target's lifetime; per-step participation semantics remain owned by the decision-participation feature.

**Classification:** A/B 类门面化；条目 4 为显式 probe 义务（不预先宣称覆盖）。

## Requirement 6: 清理与生命周期

**User Story:** 作为维护者，我要求 agent 销毁清理目标贡献、插件卸载只撤自身、旧 generation 不撤新贡献。

### Acceptance Criteria

1. WHEN a target agent is destroyed THEN the system SHALL evict all contributions installed for that target (across all owners) from participation — the official scoped registrations die with the agent fiber, and the facade records SHALL have zero assembly effect for the destroyed target; the facade bookkeeping SHALL remain the same-identity resume re-installation source of Requirement 5.2 and SHALL be physically removed by the contribution handle disposal, the scope handle disposal, or the owner unload. The official agent lifecycle facts (`agent/disposed` / `session/disposed`) SHALL remain the only destruction signals; the facade SHALL NOT fabricate them. (Stage 4 revision, probe-driven: the official in-process resume path drains the old identity — `agent/disposed` AND `session/disposed` — before it re-announces the same id, so a disposal-time physical purge would make Requirement 5.2 unreachable.)
2. WHEN a contributor plugin is unloaded or reloaded THEN only that owner's contributions (across all its targets) SHALL be removed; other owners' contributions to the same targets SHALL survive.
3. WHEN an owner reloads and re-installs contributions THEN the previous generation's stale handles/disposers SHALL be typed no-ops and SHALL NOT revoke the new generation's contributions (旧 generation 不撤新贡献).
4. WHEN a scope handle or contribution handle is disposed explicitly THEN the removal SHALL be identity-bound (owner + target + contribution id), idempotent, and SHALL NOT affect other owners or other targets.
5. WHEN the agent is destroyed while a contributor is mid-installation THEN the installation SHALL resolve to a typed unavailable/destroyed result without installing orphaned state.
6. WHEN evicted bookkeeping is retained for a destroyed target THEN it SHALL be bounded by the contributor's live scope handles, and the contributor's owner unload SHALL release it in full — including the case where the contributor never disposed its scope handles (the handle is owner-bound).

**Classification:** A/B 类门面化；对齐 `concurrency-and-cancellation.md` §5 disposer 所有权与 `composition-and-authority.md` §9（漏 dispose 与共享集合无界增长）。

## Requirement 7: 组合边界与替换语义归属

**User Story:** 作为维护者，我要求全局贡献、作用域贡献、整体替换的优先/组合边界明确，且替换 owner 唯一。

### Acceptance Criteria

1. WHEN a target agent's prompt is assembled THEN the composition order SHALL be: global additive contributions → target-scoped additive contributions → assembly replacement policies (owned by the decision-participation feature), and the scoped contribution face SHALL NOT provide whole-section replacement or removal semantics.
2. WHEN a plugin needs scoped whole-replacement for a target THEN the supported path SHALL be the assembly policy face of the decision-participation feature with its scope binding; this feature SHALL NOT create a second replacement owner.
3. WHEN tool availability restriction (non-assembly) is needed THEN `tools.restrict.register` remains the authority; scoped restriction per Requirement 3.3 adds the target dimension without changing the restriction algebra.
4. WHEN any contribution face is documented THEN the boundary between contribution (additive, reversible) and replacement (assembly policy) SHALL be stated so that append cannot be mistaken for replace.

**Classification:** 契约边界声明；替换语义归属 decision-participation-contract（交叉引用以 Design「组合顺序」条为准）。

## Requirement 8: 持久 scope 三档不变

**User Story:** 作为维护者，我要求本 feature 不引入第四档 agent durable scope。

### Acceptance Criteria

1. WHEN scoped contributions are installed THEN they SHALL be runtime assembly/registry state bound to the target agent's lifetime, and SHALL NOT create durable records in a new agent scope tier.
2. WHEN a contribution needs persistence across restarts THEN the supported durable scopes remain `session | workspace | profile` (one tier per record), and the plugin SHALL use those existing tiers; the scoped contribution itself is re-installed by the plugin after restart.
3. WHEN the scoped registry state is lost (restart) THEN the loss SHALL be honest runtime-state loss, and cold-resume re-installation follows Requirement 5.

**Classification:** 契约边界声明（`durable-state-and-scope.md` §1/§5 对齐）。

## Requirement 9: 本步模型选择快照的一致消费

**User Story:** 作为 TUI/交互类场景的维护者，我要求本步模型选择快照同时服务 prompt 变量与路由，不出现一半旧值一半新值。

### Acceptance Criteria

1. WHEN a model selection is applied to a target agent and the agent's next step runs THEN the prompt variable projection consumed by that step's assembly AND the route resolution consumed by that step's model call SHALL read the same per-step snapshot value (同一步一致快照).
2. WHEN the selection changes between steps THEN the next step SHALL use the new snapshot for both prompt variables and routing, and the current in-flight step SHALL keep its already-captured snapshot (切换不把一半应用到旧步、一半应用到新步).
3. WHEN a scoped contribution exposes the selection as a prompt variable THEN it SHALL read from the per-step snapshot mechanism and SHALL NOT maintain a parallel selection state.
4. WHEN the external selection state (who set the selection, from which client) is concerned THEN the ownership SHALL remain with the interactive-session-access feature; this feature owns only the contribution/decision consumption side of the snapshot (贡献/决策消费侧同步消费).
5. WHEN this requirement is verified THEN the acceptance SHALL be co-run with the interactive-session-access acceptance scenarios (共同验收).

**Classification:** A/B 类门面化（快照机制绑定官方 prompt-assembly 捕获语义，见 Design）；条目 5 为跨线共同验收义务。

## Requirement 10: 能力自描述、可用性与 fail-safe

**User Story:** 作为维护者，我要求作用域贡献能力诚实自描述且不拖垮宿主。

### Acceptance Criteria

1. WHEN the agents backing or the prompts/tools backing is unavailable THEN `agents.scopes.register` and scoped contribution calls SHALL return typed `unavailable` results and the capability SHALL report degraded/unavailable without affecting unrelated capabilities.
2. WHEN any scoped operation would otherwise throw through the caller's apply THEN the system SHALL convert it to the idiom's typed result/error; scoped contribution SHALL never break harness boot.
3. WHEN capability status is queried THEN it SHALL reflect real backing state (official agents/prompts/tools seams), not object presence.

**Classification:** A/B 类门面化；对齐能力自描述基线。

## Requirement 11: client 半面判定

**User Story:** 作为维护者，我要求本 feature 的 host/client 归属按客户端半面六问显式记录。

### Acceptance Criteria

1. GIVEN the six client-half questions of `capability-strategy.md` §10 THEN the recorded answers SHALL be: no replaced official row declares a client manifest; no remote namespace is registered; no slot or settings bridge is provided; no client↔host version negotiation is introduced; no browser-side state or reconnect semantics exist; no client-facing event/service is owned by this feature — therefore host-only.
2. WHEN a client-facing model selection interacts with scoped contributions THEN the interaction is carried by the interactive-session-access feature's client face, not by this feature.

**Classification:** host-only 判定记录（六问逐项证据见 Design「client 半面」）。

## Requirement 12: 端到端验收场景

**User Story:** 作为维护者，我要求验收覆盖 goal 列出的全部场景。

### Acceptance Criteria

1. WHEN two agents run concurrently and one plugin contributes to each THEN both targets observe only their own contributions (同时两个 agent、同插件不同目标).
2. WHEN two plugins contribute to the same target THEN both contributions coexist with owner attribution and conflict rules (两个插件同目标).
3. WHEN an agent is destroyed and (where identity stability is proven) cold-resumed THEN cleanup and re-install behave per Requirements 5–6 (cold resume).
4. WHEN global and scoped contributions are stacked THEN composition follows Requirement 7.1 and non-targets stay clean (全局与局部叠加).
5. WHEN abort, dispose, and owner reload interleave with active contributions THEN stale handles are no-ops, targets are cleaned, and other owners survive (abort/dispose/reload).
6. WHEN a model selection is applied and a step runs THEN prompt variables and routing agree on one snapshot (同一步选择与 prompt 一致快照；与 interactive 线共同验收).
7. WHEN all scenarios run THEN none SHALL depend on official business-service bypass, private Symbol, or raw context paths (所有场景不访问官方业务服务旁路).

**Classification:** 验收汇总条目；逐条分类随其主条目（A/B 类门面化）。
