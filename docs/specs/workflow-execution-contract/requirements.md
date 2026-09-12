# Stage 1 Requirements: workflow-execution-contract

> feature_name: `workflow-execution-contract`
> milestone: M10
> status: Stage 1 Requirements 交付（2026-09-12，与 Design 同批交付）
> 上游：[goal.md](./goal.md)；M10 工作纲领 §3.8（OBS-08）；M7 deletion report B4-8 批准记录与「后续 B 类接口义务」；canonical registry eventCatalog `workflow/*`；官方 `dsh-workflow` / `dsh-workflow-worker-thread` 类型（`workflowEngine` seam）。

## 1. Introduction

本 feature 兑现 M7 删除整键 `services.workflows`（start）时登记的功能义务（B4-8）：让第三方插件经门面**发起并控制真实 workflow run**——启动既有引擎支持的工作流、取得实际 run identity、经既有 `workflow/*` 事实事件与 run handle 观测进度与唯一终态、在引擎支持边界传播取消，并与 tasks / agents / executions 的关系闭合。

主公开面 idiom 为 **operation**（发起由 authority 主导内部过程的动作并等待确定终态）。owner 分工保持官方现状：workflow engine 执行、tasks 管关系、executions 管观测/recovery；门面不拥有其中任何一域，只做受控包装与门面语义叠加（owner 归因、判别式终态、scope/authority 检查、可用性自描述）。

全部行为需求以 EARS 表达并逐条标注实现通道分类（A / B / C / R；R 依 `docs/standards/capability-strategy.md`）。

## 2. 实现通道总判定

| 能力 | 分类 | 依据 |
|---|---|---|
| workflow 启动 operation 与 run handle（受控包装） | B 类（方案一门面转译：官方 `workflowEngine` seam 受控包装） | 官方冻结 runtime 保留 `workflowEngine.start(request): WorkflowRun` 完整 seam（校验、事件、result never rejects、cancel/dispose）；门面没有受支持公共入口（`services.workflows` 已按 B4-8 删除），本 feature 包装该 seam 并叠加 owner/终态/检查语义 |
| `workflow/*` 进度事实事件 | A 类（已交付，只消费） | registry eventCatalog 已登记 start/phase/log/agent-start/agent-end/end（producer authority：workflow authority）；官方引擎经 ctx 事件系统派发，门面事件总线为既有承载，本 feature 零改动 |
| C 类 | 无 | 官方 seam 覆盖启动、身份、终态、取消、dispose；无需要 upstream proposal 的缺口 |
| R 类 | 本阶段判定不需要（见 design §3.7；Goal 阶段不预批） | seam 已提供全部所需组件能力；「拓展能力」在 goal 边界内落为生命周期/审计/取消/关联的门面语义，不扩组件 |

## 3. 客户端半面判定（capability-strategy §10 六问记录）

按序逐问判定，对象为官方 `dsh-workflow`（seam 类型 + Service Definition）与 `dsh-workflow-worker-thread`（引擎实现行）：

| # | 问题 | 判定 | 证据 |
|---|---|---|---|
| 1 | 被替换的官方行是否声明 client manifest？ | 否 | 两包均不声明 `dsh.client` manifest；官方类型明示 "Host-only workflow request and live-run handles. The browser-safe durable vocabulary remains in ./types so Client programs never import Agent or host Cordis context declarations."（`dsh-workflow/lib/types/runtime-types.d.ts`） |
| 2 | 是否注册 remote namespace？ | 否 | 引擎只提供 `workflowEngine` host 服务，无任何 remote publication |
| 3 | 是否提供 slot 或 settings bridge？ | 否 | 引擎配置（子 agent provider、并发/总量上限等）经 plugin config 传入，不经 settings 桥，不占用 slot |
| 4 | 是否有 client 与 host 之间的版本协商？ | 否 | 无任何 client/host 协商面 |
| 5 | 是否有 browser-side state 或 reconnect 语义？ | 否 | run 是 host 进程内 holder-owned live handle（worker 线程 + 子 agent registry）；浏览器侧只有展示消费（`dsh-client-ui-workflow-run` 经既有 client 事件转发读取 `workflow/*` 展示），该消费不属于被替换行拥有 |
| 6 | 官方行是否拥有 client-facing event/service？ | 否 | `workflow/*` 为 host 派发事实（registry eventCatalog `runtime: host`）；事件不含 live run，仅携带 borrowed immutable info |

**结论：六问全否 → host-only。** operation 面与 run handle 只落 host 半面；浏览器/独立客户端对 run 的观察继续走既有 host 事件转发（既有能力，不属于本 feature）。

## 4. Requirements

### R1 启动真实 run（B 类）

**User story**: As a third-party plugin author, I want to start a workflow the existing engine supports, so that a real orchestration run executes instead of my plugin simulating success.

- WHEN a third-party plugin invokes the facade workflow operation entry with a script, a meta identity block, and a parent agent reference issued by the facade agents surface THEN the facade SHALL forward the request to the official workflow engine seam and return a facade run handle wrapping the engine-minted run.
- WHEN the engine accepts the request THEN the run SHALL execute the script inside the official engine (real worker/child execution as the engine provides), and the facade SHALL NOT implement, simulate, or reinterpret any orchestration semantics.
- WHEN the script spawns child agents THEN each child SHALL be attributed by the engine to the resolved live parent Agent (official contract), and the facade SHALL NOT fabricate or reassign parent attribution.
- WHEN the request carries optional engine parameters (args, child provider override, per-run child ceiling) THEN the facade SHALL pass them through as plain data without interpretation.

### R2 run identity（B 类）

**User story**: As a third-party plugin author, I want the run identity to be the engine's own, so that facade-observed and officially-observed references to the same run always agree.

- WHEN a run is started THEN the public run identity SHALL be the official engine-minted `WorkflowRunId`, and the facade SHALL NOT mint, alias, namespace, or translate a second run identity.
- WHEN the same logical workflow is started again externally (even with byte-identical requests) THEN a new run with a new identity SHALL be created, and identities SHALL NOT be merged or reused.
- WHERE internal retry is concerned IF the official seam settles each run exactly once (no engine-level re-execution) THEN the facade SHALL NOT introduce an attempt layer or automatic retry of its own; the distinction is: one start = one run, an external re-start = a new run, and no facade path reuses a settled identity.

### R3 进度观测（A 类事件 + B 类 handle）

**User story**: As an observer plugin, I want run progress through the existing workflow/* facts, and as the run holder I want the handle itself to expose state and terminal, so that observation needs no new event system.

- WHEN a run progresses THEN the existing `workflow/*` fact events (start / phase / log / agent-start / agent-end / end) SHALL remain the observation vocabulary, dispatched by the engine with unchanged payload shapes, freeze policy, and producer authority.
- WHEN a holder inspects its run handle THEN the handle SHALL expose the run identity, the frozen validated meta block (available before the script body runs), and a derived status view, without creating a second projection owner over the event feed.
- WHEN a holder subscribes on the run handle THEN the handle SHALL offer a run-scoped observation over the same engine-dispatched event feed (filtered by run identity) with standard listener containment and a disposer that only ends this subscription.

### R4 唯一终态（B 类）

**User story**: As a third-party plugin author, I want the official never-rejecting result to map to one honest discriminated terminal, so that cancellation and failure can never masquerade as success.

- WHEN a run settles THEN the official result (which never rejects) SHALL be mapped exactly once to a facade discriminated terminal: completed → success carrying the frozen return value; cancelled → aborted carrying the engine's settlement message; error → error carrying the engine's failure message and the agentsStarted count.
- WHEN the terminal is resolved THEN it SHALL be final and unique; late cancel, error, or success signals SHALL NOT rewrite it, and the facade SHALL NOT synthesize pseudo-terminals (no fabricated success on cancellation, no fabricated failure on completion).
- WHERE the run's return value is concerned IF the script returns no value THEN the terminal SHALL faithfully carry the engine's no-value representation without substituting a fabricated one.

### R5 取消（B 类）

**User story**: As a run holder, I want cancellation to propagate to the engine boundary and the terminal to stay engine-adjudicated, so that cancel is a signal, not a verdict.

- WHEN the holder cancels a run THEN the facade SHALL forward the cancellation to the official run handle (cancellation at the engine-supported boundary), and the terminal SHALL be adjudicated by the engine (its stopReason), not by the facade.
- WHEN the start request carries a caller AbortSignal THEN the facade SHALL pass it verbatim to the engine (no local replacement signal, no dropped upstream cancellation semantics).
- WHEN cancellation arrives after settlement THEN it SHALL remain a no-op at the engine boundary and the settled terminal SHALL stay unchanged.
- WHEN the run is disposed THEN dispose SHALL request cancellation if needed and await bounded settlement exactly as the official handle defines, and repeated dispose SHALL be idempotent.

### R6 handle 生命周期与隔离（B 类）

**User story**: As a maintainer, I want holder-owned handles with stale guards and cross-owner isolation, so that two runs and two owners never interfere.

- WHEN a run handle is created THEN it SHALL be holder-owned by the calling plugin, carrying an owner identity derived from the caller context for attribution (audit vocabulary).
- WHEN dispose is called multiple times THEN it SHALL be idempotent and SHALL NOT affect any other run.
- GIVEN two runs held by two owners WHEN one owner cancels or disposes its run THEN the other owner's run SHALL be unaffected (per-run isolation at the engine seam, verified through the facade).
- WHEN a stale handle reference is used after its holder reloaded, the facade feature degraded, or the run settled THEN the stale usage SHALL NOT cancel, dispose, or rewrite another owner's or a newer run's state; handle operations remain bound to the run identity they were created with.

### R7 parent 归因与 scope/authority 检查（B 类）

**User story**: As a maintainer, I want every run to be attributed to a verified live parent Agent, so that child-agent attribution is real and not forged.

- WHEN the operation validates a start request THEN the parent SHALL be expressed as an agent reference issued by the facade agents domain, and the facade SHALL resolve it through the official agent registry and verify identity against the live Agent before any engine call.
- WHEN the parent reference cannot be resolved to the same live Agent (missing, stale, or fabricated reference) THEN the operation SHALL reject with a determinate no-run outcome carrying a stable code, no run identity SHALL be minted, and no engine call SHALL be made.
- WHERE parent attribution is concerned IF the engine starts children THEN the facade SHALL NOT pass any parent object other than the verified live Agent.

### R8 tasks 关联（消费既有面，不扩权）

**User story**: As a task-observing plugin, I want business tasks to reference real workflow runs, so that task/agent/run linkage is closed without a second executor.

- WHEN a plugin links a business task to a workflow run THEN the existing tasks surface (attach / start source references) SHALL reference the real run identity carried by the facade handle, and the existing workflow source adapter SHALL confirm it as evidence.
- WHERE task identity and run identity are concerned THEN they SHALL remain distinct identities; the facade SHALL NOT map one onto the other.
- WHERE `task.start` is concerned IF an execution would be implied THEN the tasks surface SHALL NOT gain a second executor through this feature: tasks keep relationship/observation ownership, and execution authority remains exclusively the workflow engine.

### R9 启动期失败与降级（B 类）

**User story**: As a third-party plugin author, I want cannot-begin requests and a missing engine to fail determinately, so that I never see a fake run or a swallowed failure.

- WHEN the engine rejects a request that cannot begin (invalid meta, script parse failure, invalid argument, no registered subagent provider — the official synchronous error taxonomy) THEN the operation SHALL surface a determinate no-run outcome preserving the official machine-routable code, with no run identity and no lifecycle events emitted for it.
- WHEN the workflow engine seam is absent or unusable THEN the namespace SHALL remain present with availability reporting unavailable and invocation SHALL fail with the standard typed feature-disabled / capability-unavailable error, and unrelated capabilities SHALL be unaffected.
- WHEN the engine becomes available or unavailable at runtime THEN `availability()` SHALL reflect the actual seam state (not mere object presence), consistent with the capability self-description rules.

### R10 host-only 客户端半面（§3 六问记录的结论条目）

- WHERE the client half is concerned IF any client surface is evaluated THEN the facade SHALL NOT expose the workflow operation, run handles, their result shapes, or any workflow client member on the client half (per §3 six-question record: all answers negative).

## 5. 非行为约束（本阶段边界）

- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段；能力在冻结基线内交付。
- 「拓展能力」边界：本 feature 只落实生命周期 / 审计（owner 归因与终态证据）/ 取消 / 关联；不解释为新的 DAG language、工作流定义市场或分布式调度平台（goal Boundary）。
- R 点位判定：Goal 阶段不预批；本阶段 design 给出判定（§design），若执行中证实必须扩组件能力，须回到规格流程明确点位与最小证明，不得在实现中夹带。
- 公共 path、handle 形状与结果码集合由 Design 确定（Goal 阶段边界）；registry / capability 登记在执行阶段同步，本阶段不修改 canonical registry。
