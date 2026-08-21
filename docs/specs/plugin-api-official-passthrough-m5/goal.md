# Stage 0 — Goal

## Feature Name

`plugin-api-official-passthrough-m5`

## Goal

为第三方插件稳定暴露 M4 范围冻结后审计确认的剩余 A 类官方透传接口，覆盖 system-prompt 的上下文渲染辅助函数（P11）以及客户端输入触发器、命令 UI、模型目录、会话、会话事件、会话视图和计时器服务（C26-C32）。门面应保持官方参数、返回值、错误、生命周期和可用性语义，并在官方服务或导出缺失时按现有 fail-safe 约束局部降级，不影响其他能力。

M5 是独立于 M4 的 feature：实现只依赖已存在的 plugin-api 基础设施和对应官方公开服务/导出，不依赖 M4 的具体接口、实现、提交或完成状态；M4 与 M5 可以在独立 worktree 中并行推进。

## Scope Boundary

- 仅包含 `feature-list.md` 中归入 M5 的 `P11`、`C26-C32`。
- 不修改、不重命名、不重新纳入 M4 已登记的 feature。
- 不实现 C 类上游提案、R 类 replacement bundle 或消费者迁移；这些事项仍按各自里程碑处理。
