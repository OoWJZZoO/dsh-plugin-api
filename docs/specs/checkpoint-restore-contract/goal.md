# Stage 0 Goal: checkpoint-restore-contract

> feature_name: `checkpoint-restore-contract`
> milestone: M9
> status: Stage 0 goal draft; Requirements/Design/Tasks not started

## Goal

为第三方插件提供一个可审计、可分层降级的 checkpoint / restore contract，把 session、execution、workspace transaction、branch、coordination 和 recovery 关联成可解释的状态引用与恢复操作；同时明确哪些内容已捕获、哪些不可用、哪些外部副作用不可回滚，避免不同插件各自声称拥有“万能 rewind”。

本 feature 在一个公共 bounded context 内拆分三个独立 semantic face：

- checkpoint inspection/list：`projection`；
- checkpoint capture 与 restore：由 authority 主导的 `operation`，内部可产生 `mutation`；
- restore planning：无副作用的冻结计划 projection/纯 operation。

建议归于 `pluginApi.executions.recovery.checkpoints`，复用现有 executions、recovery、sessions.branches、coordination 和 workspaces.transactions，而不新增通用 scheduler 或第二套 storage 平台。

## Why

`dsh-turn-rewind`、`dsh-checkpoint-rewind`、`dsh-agent-teams`、file-claim 和 Web/TUI 工作区插件分别实现 rescue point、session fork、workspace snapshot、config snapshot、stale plan、restore verification 和外部副作用说明。现有 recovery policy、workspace transaction、coordination、branch/edit 和 storage 已提供必要底座，但缺少统一的 checkpoint identity、capture state、restoreability、required claim 和 restore terminal outcome。

没有这个 contract，插件无法区分“已保存的 session 记录”“可恢复的 workspace 状态”“仅供审计的 checkpoint 元数据”和“实际上无法回滚的外部副作用”，也无法安全处理旧 attempt、旧 client cursor 或另一个 owner 已取得资源后的迟到 restore。

## Scope direction

- 定义 session/workspace/profile 单一 scope 的 checkpoint identity、source execution、component capture status、restoreability、external-effects 和 provenance；跨 scope 状态拆成关联记录，不用一条记录伪装跨 scope durable authority。
- 提供 checkpoint `create`、`list`、`inspect`、`planRestore` 和 `restore` 的初步公共语义；`planRestore` 不产生副作用，`restore` 必须先有可审阅 plan 或等价提交资格。
- restore 必须使用 coordination lease、generation/CAS/fencing 或等价 authority，复用 workspace transaction、session branch/edit 和 recovery policy；未知能力、冲突、部分捕获和不可回滚副作用必须 fail-closed 或明确返回 partial/unavailable，不得伪装 full restore。
- 统一 checkpoint/operation 的 source execution、attempt、activity、cursor 和 terminal outcome；内部 retry 属于同一 operation/execution 的 attempt，外部重新发起是新 operation/execution。
- 优先评估三至四个官方组件协同的 R 类方案：`dsh-session`/session branch owner、`dsh-workspace`/workspace transaction owner、`dsh-agent-loop`/execution-recovery boundary，以及必要时 `dsh-storage`/persistence owner 各承载独立 replacement slice；跨组件协同不违反 R 规则，只要每个包单一官方 owner、完整复刻原行并通过组合层的 fencing/transaction authority closure。
- 若完整 restore 的官方 authority 无法证明，仍可交付 checkpoint projection 与 restore plan；不可把 C 类“跨 session、workspace、configuration 和 external side effect 全量恢复”隐藏成 facade promise。M9 优先扩大可用能力面，但 restore 的可证明边界必须高于表面 API 数量。

## Boundaries

- 不提供任意外部副作用的自动回滚；网络、进程、MCP、Git push 等必须标记为 external/unknown，并按 policy 要求人工处理。
- 不把 checkpoint 变成新的 scheduler、task registry、storage backend、route policy 或 memory system。
- 不允许直接 session mutation 绕过 branch、workspace transaction、coordination、security 或 recovery authority；旁路能力必须在最终 contract 中显式登记。
- 不把 `aborted`、`superseded`、`error`、`partial` 和 `committed` 混成一个字段；沿用 terminal、commitState、lifecycleState 的既有分工。
- 不修改官方包文件；R slice 只替换官方 ctx service/event/client 面，不覆盖官方 import 面，并需满足 boot 自检、runtime/package identity、唯一 owner 和无双跑约束。

## Expected result

第三方插件可以创建和检查一个带来源与捕获边界的 checkpoint，先取得冻结 restore plan，再通过受 authority 约束的 operation 执行可证明的恢复。恢复失败、冲突、旧代次、部分捕获或外部副作用存在时，结果明确、可审计、可重连，不会误报为完整回滚。

## Stage boundary

本文件只确认 Goal 方向。Requirements 应将 scope、checkpoint record、capture/plan/restore outcome、R 协同 slice、transaction/fencing、visibility、cancellation 和 partial restore 写成 EARS；Design 再确定三至四个官方 owner 是否具备经济性与完整契约保留证据，以及 host/client 半面；Tasks 通过审查后才进入实现。