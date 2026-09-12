# Stage 0 Goal: workflow-execution-contract

> feature_name: `workflow-execution-contract`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）
> 输入溯源：M10 工作纲领 §3.8（OBS-08）；观察报告 §5 OBS-08；M7 deletion report B4-8 批准记录与「后续 B 类接口义务」；canonical registry eventCatalog `workflow/*` 现状；官方 `dsh-workflow` 类型（`workflowEngine` seam）。

## Goal

兑现 M7 删除 `services.workflows` 整键时登记的功能义务：让第三方插件通过门面**发起并控制真实 workflow run**——启动既有引擎支持的工作流、取得实际 run identity、观测进度与唯一终态、在引擎支持的边界传播取消，并与 tasks / agent / executions 的关系闭合。不在 `task.start` 中隐藏第二个执行器，不自造只存在于门面中的执行成功。

主公开面是 operation（发起由 authority 主导内部过程的动作并等待确定终态）；workflow engine 执行、tasks 管关系、executions 管观测/recovery，owner 分工明确。

## Why

B4-8 批准删除整键 `services.workflows`（start），理由是单方法、无真实消费者，同时登记了「后续须提供可追溯、可记录封装的 B 类接口且拓展能力（workflow 编排语义）」义务。官方冻结 runtime 的 `dsh-workflow` 组件保留 `workflowEngine` 服务：`start(request): WorkflowRun`——request 含 script、meta（工作流 identity 块）、args、subagentProvider、maxTotalAgents、**必需的 parent Agent**（每个子 agent 归因到该 live Agent）与可选 signal；run handle 为 holder-owned `{ id: WorkflowRunId, meta, result: Promise<WorkflowResult>（never rejects）, cancel(reason?), dispose(): Promise<void> }`。registry eventCatalog 已登记 `workflow/start`、`phase`、`agent-start`、`agent-end`、`end`、`log` 事实事件（producer authority：workflow authority，facade 直绑）。当前 `tasks` 面（task-execution-observation）明确不实现 workflow engine，task-execution-adapters 只消费 workflow identity/事件。TUI 目前只读取 workflowEngine 展示事件，未发现实际调用 start——**不伪造消费者**，立项依据是 M7 人类裁决；最低闭环是调用底层已有 engine、获得可追踪 run、真实终态/取消能力与 tasks 关联，不另造通用 DAG 平台。

## Scope direction

- 主面 operation：启动已有 engine 支持的工作流 → 实际 run identity（官方 `WorkflowRunId`）→ 进度经既有 `workflow/*` 事实事件与 run handle 可观测 → 唯一终态。
- 身份语义遵守 `identity-and-lifecycle.md`：官方 run id 是资源身份，门面不另造第二套 run 身份；内部 attempt 与外部再次启动区分；外部重发创建新 run，不合并身份。
- 取消：`run.cancel` / signal 在引擎支持边界传播；取消是信号，终态由引擎裁决（`workflow/end` 的 stopReason）；官方 `result` never rejects 的语义如实映射为门面判别式终态，无伪终态。
- holder-owned run handle 生命周期：幂等 `dispose()` 等待脚本与子 agent 静默；stale guard；两个 run、两个 owner 隔离。
- parent 归因：官方 request.parent 为必需 Agent；门面表达 parent 目标语义并经 scope/authority 检查后落到真实 Agent，不伪造 parent。
- tasks attach/link 引用真实 run；不把 task identity 当 run identity，不在 `task.start` 中隐藏第二个 executor。
- 通道方向：官方 `workflowEngine` seam 受控包装为主（方案一门面转译）；「拓展能力」首先落实生命周期/审计/取消/关联，不解释为任意新 DAG language 或分布式调度平台。若 Design 证实必须扩组件能力，按 SPEC1 明确点位与最小 R 证明——Goal 阶段不预批 R。
- client 半面：官方 runtime 类型明确 workflow 为 host-only live handle（browser-safe 词汇另置）；按 `capability-strategy.md` §10 六问在 Requirements 记录判定。

## Boundaries

- 不造通用 DAG language、工作流定义市场或分布式调度平台；script/meta 业务由插件实现。
- 不在 `task.start` 中隐藏第二个执行器；不伪造 run identity、进度或终态。
- 不吞并 workflow 展示/UI；TUI 展示不是 start 的实证，也不因展示存在而跳过启动能力的验收。
- 不拥有 tasks/executions 领域；只消费它们的既有公开面。
- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Expected result

门面启动真实测试 workflow 并实际调用 worker；阶段/结果经既有 `workflow/*` 事件与 run handle 可观测；取消/失败无伪终态；两个 run、两个 owner 隔离；tasks/agent 关联与回收准确；官方 browser 插件与门面消费者对同一 run 的观察一致。

## Stage boundary

本文件只确认 Goal 方向，不批准具体公共 path、参数形状、结果码集合或可能的 R 点位。Requirements 应把启动、run 身份、进度观测、终态、取消、关联、幂等/重复启动与降级写成 EARS；Design 再确定 namespace 放置、官方绑定细节、parent/scope 检查、是否需要 R slice 与装配。
