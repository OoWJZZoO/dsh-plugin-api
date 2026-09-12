# Stage 1 - Requirements

> feature_name: `decision-participation-contract`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12；requirements 与 design 同批产出，承接已确认 goal.md，确认门按 2026-09-12 修订的工作流以批量交付承载）
> 输入溯源：goal.md（2026-09-12 批量确认）；M10 工作纲领 §3.1 / §4.1；观察报告 §5（决策参与缺口，含最小运行复现）；M8 migration ledger 第 30 行（侧向决策注册不再公共、汇编改写由 `prompts.contribute` 承载）与 8.3(a)（整体 sections 替换提案登记）；canonical registry eventCatalog 现行 decision 语义条目（含 `decisionPrecedence` / `conflictConvergence` / `listenerFailureDefault`）。

## Status

Stage 1 与 Stage 2 同批交付（2026-09-12）。本文承接已确认 Stage 0 Goal，把逐点位保真清单写成 EARS；公共 path 采用 Design 同批确定的候选（见 design.md「公共面与 path 决定」），集成波以 canonical registry 同步为准。版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Introduction

本 feature 为第三方插件提供**参与官方真实决策点与必要执行边界**的稳定公共契约：纯 decision、串行 transform、异步执行前屏障与 around middleware 各按真实 idiom 表达，保留返回值、异步顺序与作用域语义。只读观察（`events.observe`，monitor feed，返回值不参与决定）与本 feature 的参与面明确分界。

参与面按领域放置（policy idiom 为主，around/barrier 以显式登记的 idiom 例外表达），既有等价面（`llm.requestTransforms` / `llm.admissionPolicies` / `llm.routing.policies`、`tools.guard` / `tools.restrict`、`security.redaction`、`prompts.contribute`）优先承载并只补不足；没有领域归属的 catalog decision 点位由统一的 typed decision registry 承载（只接受 catalog decision 事件名，不是无语义约束的万能订阅入口）。横切派发语义（priority / deepFreeze / fault containment）保持门面承载，不走替换通道。本 feature 的唯一 R 点位是 `agent/turn-stopping`（2026-09-12 人类裁决：经既有 agent-loop owner 替代包的能力切片提供决策参与）；其余点位维持无 R 判定。

## Requirement 1: 决策参与登记面与 idiom 合同

**User Story:** 作为插件作者，我想在领域命名空间内按点位登记参与策略，使我的回调在官方真实决策点被调用并保留返回值语义。

### Acceptance Criteria

1. WHEN a plugin calls `pluginApi.agents.decisions.register(spec)` with `spec.point` selected from `pre-step | request | request-error | turn-stopping` and a spec containing `id`、`priority`、`decide(context)` THEN the system SHALL install the policy at the corresponding official decision dispatch point and SHALL return the policy handle `{ id, ownerId, generation, dispose() }`.
2. WHEN a plugin calls `pluginApi.tools.executionPolicies.register(spec)` with `spec.point` selected from `execute | post-execute` THEN the system SHALL install the policy at the corresponding official tools dispatch point with the same handle contract as Requirement 1.1.
3. WHEN a plugin calls `pluginApi.prompts.assemblyPolicies.register(spec)` THEN the system SHALL install the policy at the `system-prompt/assemble` decision point with the same handle contract as Requirement 1.1.
4. WHEN a plugin calls `pluginApi.events.decisions.register(name, spec)` with `name` in the admitted set enumerated in Requirement 10 THEN the system SHALL install the policy at the corresponding catalog decision dispatch point with the same handle contract as Requirement 1.1.
5. WHEN any participation entry is registered THEN the registration SHALL be automatically effective for subsequent dispatches without a separate activation call, and the owner identity SHALL be derived from the caller context and SHALL NOT be forgeable by the caller.
6. GIVEN a decision point whose equivalent domain face already exists (`tools/pre-execute` → `tools.guard.register`; tool result content rewrite → `security.redaction.register`; request mutation → `llm.requestTransforms.register`; route/health decisions → `llm.routing.policies` / `llm.routing.health.*`) WHEN a plugin needs to participate at that point THEN the system SHALL present only the existing face as the supported path and SHALL NOT expose a second registration entry for the same decision point.
7. WHEN a caller attempts to register at a decision point that has no supported public participation in this generation (including `approval/request`, `session-telemetry/record`, `tools/code-dispatch-log`) THEN the system SHALL return a typed `unsupported` result whose reason names the catalog status of the point, and SHALL NOT install any listener.

**Classification:** A 类稳定化为主（官方已 dispatch 的决策点由门面重新引出参与登记）；条目 7 为契约边界声明。R 类判定：**唯一 R 点位为 `agent/turn-stopping`（人类裁决 2026-09-12，agent-loop owner 切片，见 design.md「R slice 设计」）**；其余点位维持无 R 判定（逐点位通道判定表见 design.md）；横切派发语义（priority / deepFreeze / fault containment）永不转 R。

## Requirement 2: `agent/pre-step` 参与保真

**User Story:** 作为 agent-teams 类插件的作者，我想在每步开始前等待后续决策、保留 reject 并追加激活消息、返回新的 enter 决策，使激活真实生效。

### Acceptance Criteria

1. WHEN the official agent runtime dispatches the `agent/pre-step` decision THEN each registered policy SHALL be invoked with the declared payload `{ agent, messages, turn, step, signal }` and a `next` continuation, and the payload SHALL be frozen per the catalog freeze policy (`deep: ['messages']`) before the policy sees it.
2. WHEN a policy returns `{ kind: 'reject', reason? }` without calling `next` THEN the step SHALL NOT enter: the producer SHALL observe the reject decision as the converged result of the dispatch, and no downstream consumer SHALL overwrite it with an enter decision.
3. WHEN a policy awaits `next()` THEN the system SHALL preserve the await chain (the dispatch SHALL NOT settle before the policy's returned promise resolves) and the policy SHALL observe the terminal decision produced by the rest of the chain; the policy MAY then return a modified decision (for example appending an activation message to a preserved reject and returning a new enter decision) and the modified decision SHALL be the one the producer consumes for this step.
4. WHEN a policy returns `{ kind: 'enter', messages }` THEN the message set it returns SHALL be the message set that reaches this step (改写到达本步), not a parallel copy stored elsewhere.
5. WHEN the policy's `decide` throws, rejects, or its returned promise settles after the dispatch was aborted via `signal` THEN the failure SHALL be contained per Requirement 11 and the documented default decision (proceed with the current chain decision) SHALL apply; other owners' policies and the official step SHALL NOT be broken.
6. WHERE a policy was registered with an agent scope binding IF the dispatching step's agent does not match the binding THEN the system SHALL NOT invoke that policy for the step.

**Classification:** A 类稳定化（官方 waterfall 已 dispatch；门面补参与登记与返回值保真）。

## Requirement 3: `agent/request` 参与保真

**User Story:** 作为插件作者，我想在 agent 请求决策点按官方语义给出决定，使决定真实影响本次请求处理。

### Acceptance Criteria

1. WHEN the official agent runtime dispatches the `agent/request` decision THEN each registered policy SHALL be invoked with `{ agent, turn, step, signal }` and `next`, frozen per the catalog freeze policy.
2. WHEN a policy returns a decision THEN the producer SHALL consume the converged decision of the waterfall for this request (last decision wins along the waterfall per the catalog `conflictConvergence`), and a deny-shaped decision SHALL NOT be silently overwritten by a later default.
3. WHEN a policy needs the chain's outcome THEN it MAY await `next()` under the same await/containment rules as Requirement 2.3.
4. WHEN the policy fails or the dispatch is aborted THEN the default decision per Requirement 11 SHALL apply and other owners SHALL NOT be affected.
5. WHERE a policy carries a scope binding THEN it SHALL only be invoked for matching agents.

**Classification:** A 类稳定化；决策词汇以官方 producer 消费语义为准，Stage 4 以契约 probe 复核后固化到 registry（design.md「逐点位保真表」）。

## Requirement 4: `agent/request-error` 参与保真

**User Story:** 作为 model-failover 类插件的作者，我想在请求错误决策点参与重试/切换决定，且 provider 故障处理不与既有 routing/health 职责重复。

### Acceptance Criteria

1. WHEN the official agent runtime dispatches `agent/request-error` THEN each registered policy SHALL be invoked with `{ agent, turn, step, provider, failure, retryPolicy, signal }` and `next`, frozen per the catalog freeze policy (`deep: ['failure']`).
2. WHEN a policy returns a decision (retry, fail over, or abort the attempt per the official consumption semantics) THEN the producer SHALL consume the converged decision for this error handling pass.
3. WHEN the participation need is provider route/health policy (circuit, probe, failover candidate selection) THEN the system SHALL present `llm.routing.policies.register` / `llm.routing.health.circuitPolicy.register` / `llm.routing.health.probe.register` as the supported faces, and `agents.decisions('request-error')` SHALL NOT duplicate those route-domain decisions.
4. WHEN a policy fails or is stale THEN containment per Requirement 11 applies and other owners are unaffected.

**Classification:** A 类稳定化；条目 3 为既有面分工义务（不制造第二个 route 决策 owner）。

## Requirement 5: `agent/turn-stopping` 参与保真（R 类切片，2026-09-12 人类裁决）

**User Story:** 作为 auto-continue 类插件的作者，我想在 turn 即将停止的官方派发点声明「以一条 next-step 消息继续本 turn」的决定，使停止可以被受控延续而不中断官方循环。

### Acceptance Criteria

1. GIVEN the official dispatch semantics verified against the locked runtime source (the loop dispatches `agent/turn-stopping` via the official fused serial dispatcher with payload `{ turn, signal }` fused with `agent`, awaits the dispatch, re-checks abort, and then re-checks the stop condition against the next-step pending inbox before breaking) WHEN the replacement row runs that dispatch point THEN the official serial fact dispatch (payload shape `{ agent, turn, signal }`, catalog freeze policy, timing between the abort checks, and the loop's stop re-check) SHALL be preserved unmodified, and the participation slice SHALL only add the participant-chain invocation and the decision application.
2. WHEN a participant registered via `agents.decisions.register({ point: 'turn-stopping', ... })` is invoked THEN it SHALL receive the frozen payload `{ agent, turn, signal }` plus the dispatch context, and its decision vocabulary SHALL be exactly: proceed (no return / `{ kind: 'proceed' }`) or `{ kind: 'continue', message }`.
3. WHEN the converged decision is `continue` with a message conforming to the official next-step pending inbox contract THEN the slice SHALL insert the message through the official next-step inbox channel (durable splice; the official `agent/inbox/*` facts are emitted by the official path), so the loop's own stop re-check observes the pending item and the turn continues into a next step; the slice SHALL NOT bypass or reimplement the re-check.
4. WHEN no participant is registered, all participants make no decision, or the converged decision is proceed THEN the point SHALL behave exactly as the official row: the serial fact dispatch completes, the loop re-check governs, and the turn stops as officially determined (无参与者默认官方等价行为).
5. WHEN a participant's callback throws, rejects, or settles late THEN the failure SHALL be contained at the facade participation boundary per Requirement 11: that slot takes the documented default (proceed), the loop's stop flow SHALL NOT be broken, and the remaining participants SHALL still be consumed.
6. WHEN multiple participants are registered THEN they SHALL be invoked in the fixed priority vocabulary order with same-priority successful-registration order, and the converged decision SHALL follow the point's declared convergence rule (last decision wins along the participation order); a malformed decision SHALL be treated as no decision with a bounded diagnostic (family precedent), never throwing through the dispatch.
7. WHERE a participant declares an agent scope binding IF the stopping agent does not match the binding THEN the system SHALL NOT invoke that participant.
8. WHEN the replacement row is inactive, its version identity does not match, or the component owner check fails THEN registration of a turn-stopping participant SHALL return the typed `unavailable` result; the official row's fact semantics and the `events.observe('agent/turn-stopping')` read-only path SHALL be unchanged, and unrelated decision points SHALL NOT be affected (可用性门控).
9. WHEN the turn-stopping participation slice is inactive or fails its boot self-check THEN the other capability slices of the same replacement package (loop-boundary interaction facts, assembled-context evidence, route policy) SHALL be unaffected, and each slice's availability SHALL be reported independently (同包切片隔离).
10. WHEN a participant is disposed or its owner reloads THEN the participation registry removal SHALL be identity-bound and idempotent, and the loop SHALL NOT observe a partially-removed participant chain on the next dispatch.

**Classification:** R 类（人类裁决 2026-09-12）：agent-loop 组件唯一 owner `@deepseek-ai/dsh-plugin-api-agent-loop` 的能力切片；R1–R8 逐条对照、与同包既有切片的行级关系及登记义务清单见 design.md「R slice 设计」。

## Requirement 6: `system-prompt/assemble` 参与保真（整体替换与筛选）

**User Story:** 作为 anchor 类插件的作者，我想在汇编决策点整体替换 sections 并过滤 tools，而不只追加贡献。

### Acceptance Criteria

1. WHEN the official system prompt authority assembles a prompt THEN each registered assembly policy SHALL be invoked with the assembly `{ sections, contexts, tools, variables }` and context `{ scope?, signal? }` frozen per the catalog freeze policy, plus `next`.
2. WHEN a policy returns a modified assembly (whole section replacement, section removal, or tools filtering) THEN the modified assembly SHALL be the input of the next stage (改写进入下一阶段), and the finally consumed assembly SHALL be the waterfall-converged result, not a copy stored alongside.
3. WHEN additive contributions exist (via `prompts.contribute`, including target-scoped contributions from the scoped-contribution feature) THEN the system SHALL compose additive contributions into the assembly BEFORE assembly policies are invoked, and a policy SHALL observe the merged assembly.
4. WHEN a policy deletes or replaces content THEN no requirement of this feature SHALL oblige the policy to be side-effect free beyond the assembly value itself; assembly policies are value transforms on the assembly, and side-effecting work (persistence, snapshots) SHALL use the proper lifecycle/operation contracts of the owning features (for example snapshot execution belongs to the checkpoint owner).
5. WHEN a policy fails, is aborted via the context signal, or is stale THEN the assembly SHALL proceed unchanged per Requirement 11 and other owners SHALL NOT be affected.
6. WHERE a policy carries a scope binding THEN it SHALL only be invoked for matching assembly scopes.

**Classification:** A 类稳定化；本条与 `prompts.contribute`（追加）分工显式（条目 3），不建第二个汇编改写 owner。

## Requirement 7: `tools/execute` 与 `tools/post-execute` 参与保真

**User Story:** 作为 checkpoint-rewind / secret-redactor 类插件的作者，我想在工具执行边界做执行前捕获（around）与结果改写/阻断决定。

### Acceptance Criteria

1. WHEN the tools execution authority dispatches the `tools/execute` boundary THEN each registered execution policy (point `execute`) SHALL be invoked with `exec` and `next`, and the policy MAY await `next()` to wrap the execution (around middleware); the call identity of `exec` SHALL be immutable and only `exec.signal` MAY be replaced in place, per the catalog payload contract.
2. WHEN an around policy awaits `next()` THEN the actual tool side effects SHALL NOT begin before the policy has obtained the `next` continuation, and an asynchronous pre-execution capture performed before calling `next()` SHALL complete before the tool's side effects begin (异步快照在副作用前完成).
3. WHEN the tools execution authority dispatches `tools/post-execute` THEN each registered execution policy (point `post-execute`) SHALL be invoked with `{ exec, result }` (result read-only) and SHALL be able to return the official decision algebra `{ kind: 'accept', content? | value? } | { kind: 'block', feedback }`; a returned content/value rewrite SHALL be the result that reaches the model.
4. WHEN the participation need is pure content redaction of tool results THEN the system SHALL present `security.redaction.register` as the supported face, and the post-execute face SHALL NOT duplicate redaction authority (secret-redactor's rewrite migrates to redaction; the block-with-feedback decision is the gap this face fills).
5. WHEN a `tools/pre-execute` participation need arises (allow/deny/ask) THEN `tools.guard.register` SHALL be the supported face, and its decision algebra SHALL cover the official `PreToolDecision` `{ allow } | { deny, reason } | { ask, reason? }`; this feature SHALL NOT register a second pre-execute entry point.
6. WHEN a policy fails, is aborted, or is stale THEN containment per Requirement 11 applies; for point `execute` the default is to proceed with `next()` unchanged, and for point `post-execute` the default is to accept the current result.

**Classification:** A 类稳定化（官方 dispatch 存在；门面补 around/post-execute 参与登记）。around 语义按 `api-idioms.md` §1 的 idiom 例外机制在 registry 登记为 policy baseContract 的显式例外（见 design.md「idiom 归类与例外登记」）。

## Requirement 8: `llm/stream` 点位归属（既有面等价证明）

**User Story:** 作为维护者，我要求 llm 流变换继续由 adapter decoration 与 request transforms 承载，不出现第二个流改写 owner。

### Acceptance Criteria

1. WHEN a plugin needs to wrap or transform the stream of an existing adapter binding (request transform, chunk transform) THEN `llm.adapters` decoration（现行 `llm.adapters.decorate` 语义，路径拆分见 llm-adapter-registration feature）SHALL be the supported face, and this feature SHALL NOT open a separate raw `llm/stream` participation entry.
2. WHEN a plugin needs to transform the request of a model call THEN `llm.requestTransforms.register` SHALL be the supported face with its at-most-once convergence contract.
3. WHEN the decision registry is asked to participate at `llm/stream` THEN the system SHALL return the typed `unsupported` result naming the owning faces per Requirement 1.7.
4. GIVEN the catalog records `llm/stream` as a decision waterfall owned by the llm authority WHEN this feature's coverage is audited THEN the audit SHALL record the decoration + requestTransforms mapping as the equivalence evidence for the point (逐点证明已有领域 API 承载).

**Classification:** A/B 类既有面（decoration 已由 replacement owner 交付；requestTransforms 为门面 policy）；本 feature 只做归属证明，不新增流改写面。

## Requirement 9: fs 写/编辑意图屏障参与

**User Story:** 作为 checkpoint-rewind 类插件的作者，我想在文件写入/编辑发生前执行异步捕获屏障，并保证屏障先于副作用完成。

### Acceptance Criteria

1. WHEN the filesystem authority dispatches `fs/write-intent` or `fs/edit-intent` THEN each registered policy (via `events.decisions`) SHALL be invoked with the logical payload `{ target: { targetKey, displayPath }, exec }` frozen per the catalog freeze policy (`all`), plus `next`.
2. WHEN a policy performs asynchronous capture work before its decision THEN the filesystem producer SHALL NOT apply the write/edit until every policy's decision has settled (await 语义先于副作用), and a deny-shaped decision SHALL prevent the write/edit from being applied.
3. WHEN a policy fails, is aborted, or is stale THEN the default decision (proceed) SHALL apply per Requirement 11, and the write/edit SHALL proceed as if the policy had made no decision.
4. WHEN the participation need is executing a snapshot or restore THEN the snapshot execution SHALL remain owned by the checkpoint owner; this feature provides only the participation mechanism and its ordering guarantee (本线不承载快照执行).

**Classification:** A 类稳定化（catalog decision 点位，producer 为 filesystem authority；门面补参与登记）。

## Requirement 10: 统一 typed decision registry 的准入与约束

**User Story:** 作为维护者，我要求统一参与机制只承载没有领域归属的 catalog decision 点位，且不是无语义约束的万能订阅入口。

### Acceptance Criteria

1. GIVEN the admitted point set of the unified registry is enumerated as `fs/write-intent`, `fs/edit-intent`, `compaction/request`, `session-title/candidate` WHEN `events.decisions.register` is called THEN the system SHALL accept exactly those catalog names (plus additive future catalog decision points that no domain face owns) and SHALL validate each registration against the catalog entry's decision semantics before installing.
2. WHEN a caller passes a non-catalog name, a fact/observation/notification event name, or a decision point owned by a domain face THEN the system SHALL return the typed `unsupported`/`conflict` result of Requirement 1.7 and SHALL NOT install any listener.
3. WHEN a policy at a unified-registry point returns a decision THEN the decision SHALL conform to that point's typed vocabulary (compaction/request: proceed | `{ kind: 'reject', reason? }` | `{ kind: 'replace-range', range }`; session-title/candidate: proceed | exclude with optional reason | replace referencing `{ seq }`), and a malformed decision SHALL be treated as no decision per the owning producer's contract.
4. WHEN the compaction/request participation interacts with an explicit compaction operation THEN the operation authority (compaction-operation feature) SHALL own triggering and results, and the decision registry SHALL only carry participation at the request decision point (策略 registry 不是主动触发器).
5. WHEN the session-title/candidate participation is exercised THEN the title replacement authority SHALL remain the decision's producer and consumer of record, and participation SHALL NOT create a second title provider authority.

**Classification:** A 类稳定化（两条点位的 producer 由已交付 replacement 承载，参与登记为门面侧补足）。

## Requirement 11: 排序、收敛与失败 containment

**User Story:** 作为插件作者，我要求多插件参与同一决策点时结果确定、一个插件的缺陷不破坏他人。

### Acceptance Criteria

1. WHEN multiple policies are registered at the same decision point THEN they SHALL be invoked in the fixed priority vocabulary order (`lowest | low | normal | high | highest`; `monitor` is reserved for read-only observation and SHALL NOT be accepted as a participation priority) with same-priority successful-registration order, per the catalog `decisionPrecedence`.
2. WHEN two policies produce competing decisions THEN convergence SHALL follow the catalog `conflictConvergence` (last decision wins along the waterfall) for the points where that rule is declared, and the convergence rule SHALL be part of each point's public contract rather than an emergent property of registration order.
3. WHEN any policy's callback throws, rejects, or settles late THEN the failure SHALL be contained at the participation boundary: the point's documented default decision SHALL apply for that policy's slot, a bounded diagnostic SHALL be recorded, and no other owner's policy, the official producer, or the harness apply SHALL be broken.
4. WHEN a policy's disposer is stale (after owner reload, dispose, or generation replacement) THEN invoking it SHALL be a typed no-op that neither revokes a newer generation's participation nor touches another owner's entries.
5. WHEN a policy registration conflicts (same owner, same id, still active) THEN the system SHALL return a typed conflict result; cross-owner same-id registrations SHALL NOT silently overwrite.

**Classification:** 门面承载的横切语义（永不转 R）；遵循 `ordering.md` / `composition-and-authority.md` §10。

## Requirement 12: observer 与参与的分界

**User Story:** 作为插件作者，我要求只读订阅永远不获得决策权，决策登记永远不被 observe 偷偷替代。

### Acceptance Criteria

1. WHEN a listener is registered through `events.observe` THEN its return value SHALL be discarded (non-null return values and rejections contained), and the listener SHALL NOT affect any producer decision (现行最小复现行为保持).
2. WHEN a decision-participation registration is active THEN the monitor feed of the same event SHALL continue to observe the dispatch without participating, and monitor entries SHALL be invoked last per the priority vocabulary.
3. WHEN the two surfaces are documented THEN each point's registry entry SHALL name exactly one supported participation face (or none), so that observe cannot be mistaken for participation.

**Classification:** 门面语义分界声明；`events.observe` 行为保持现状（A 类，无变更）。

## Requirement 13: 作用域、生命周期与可用性

**User Story:** 作为插件作者，我要求参与登记具备明确 scope、自动生效、可撤销且不拖垮宿主。

### Acceptance Criteria

1. WHERE a decision point is scope-filtered in the catalog (`agent/*`, `system-prompt/assemble`, `tools/*`) IF a registration declares a scope binding THEN the system SHALL invoke the policy only for dispatches whose scope subject matches the binding.
2. WHEN an owning plugin is unloaded or reloaded THEN only its own participation entries SHALL be removed, and entries of other owners SHALL remain effective.
3. WHEN the backing dispatch of a point is unavailable (for example the owning replacement row is inactive or version-mismatched) THEN registration at that point SHALL return the typed `unavailable` result and the facade SHALL report the point's capability as degraded/unavailable without affecting unrelated capabilities.
4. WHEN a registration call would otherwise throw through the caller's apply THEN the system SHALL convert it to the typed error/result of the policy idiom; participation registration SHALL never break harness boot.
5. WHEN a participation handle is disposed THEN subsequent dispatches SHALL NOT invoke the policy, and disposal SHALL be idempotent.

**Classification:** A 类稳定化；遵循 `api-idioms.md` §3.2 handle 合同与 fail-safe 底线。

## Requirement 14: 端到端验收场景

**User Story:** 作为维护者，我要求本 feature 的验收覆盖 goal 列出的全部场景。

### Acceptance Criteria

1. WHEN two policies are registered at the same point with different priorities THEN they SHALL compose in the declared order and the final consumed decision SHALL reflect both (两策略有序组合).
2. WHEN a pre-step policy returns reject THEN the step SHALL not enter this turn (pre-step reject 实际阻止).
3. WHEN a policy rewrites the step messages, the assembly, or a tool result THEN the rewrite SHALL reach the producing stage of this step (改写到达本步).
4. WHEN a barrier policy performs asynchronous capture at an execution boundary THEN the capture SHALL complete before the side effect begins (异步快照在副作用前完成).
5. WHEN a policy throws, rejects, is aborted, or holds a stale disposer THEN the remaining owners' decisions SHALL still be consumed and the producer SHALL complete this dispatch (不破坏其他 owner).
6. WHEN an observer returns a reject-shaped value through `events.observe` THEN the decision result SHALL be unchanged (observer 返回值不参与决定).

**Classification:** 验收汇总条目；逐条分类随其点位（A 类稳定化为主）。

## Requirement 15: client 半面判定

**User Story:** 作为维护者，我要求本 feature 的 host/client 归属按客户端半面六问显式记录。

### Acceptance Criteria

1. GIVEN the six client-half questions of `capability-strategy.md` §10 are asked for every mechanism of this feature THEN the recorded answers SHALL be: no replaced official row declares a client manifest; no remote namespace is registered; no slot or settings bridge is provided; no client↔host version negotiation is introduced; no browser-side state or reconnect semantics exist; no client-facing event/service is owned by this feature — therefore the feature SHALL be host-only.
2. WHEN decision callbacks execute THEN they SHALL execute in the host process at the official dispatch points, and no decision payload SHALL be replicated to a client surface by this feature.

**Classification:** host-only 判定记录（六问逐项证据见 design.md「client 半面」）。
