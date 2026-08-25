# Stage 0 - Goal

## Feature Name

`task-execution-observation`

## Status

Stage 0 Goal 草案，待用户确认。

## Goal

为第三方插件提供统一的业务 task / workflow run 观察与关联契约，把用户或业务拥有的 durable task、workflow run、agent execution、session transcript 和 jobs service 连接成同一条可恢复的 identity lineage。该 feature 应让 task board、TUI、agent teams 和后台任务消费者在断线后从 durable state 重建 task 状态，而不必各自发明 task、attempt、member 和 execution identity。

它与已交付的 `execution-observation` 有明确分工：`execution-observation` 只读观察运行时 execution；本 feature 管理面向业务的 task identity、attempt/fencing 关联和 run/session/job 投影。它不创建新的 worker scheduler，也不替代官方 jobs/workflows 的执行引擎。

## Batch Order and Dependencies

本 feature 是本批次的第三个 feature，依赖已交付的 `execution-observation`、`recovery-policy` 与本批次的 `coordination-lease`；可消费 `workspace-mutation-transaction` 的变更 provenance。实际执行仍由官方 workflow/jobs/agent 能力承担，task 层只登记、关联、观察和收敛业务状态。

## Scope Boundary

- 包含：task 的 register/start/claim/reassign/settle 生命周期；task 与 workflow run、execution、session、job 的关联；attempt identity、owner/fencing evidence 与终态投影。
- `observe(taskId)` 必须支持断线后的 durable state 重建，并明确 unavailable、truncated、stale 或 superseded 等不确定性；`attach(session)` 与 transcript 查询只消费公开 session 能力。
- task 的 retry/fallback/abort 建议必须保留 recovery 与 execution 的 provenance；task facade 不自行重放工具、不自行选择 route、不绕过 approval。
- task board、TUI、agent teams 和后台任务只作为 consumer；本 feature 不新增 worker scheduler、provider executor、route policy、billing ledger、workspace transaction 或新的 client transport。
- 失败、重复 claim、旧 attempt late completion 和 reassign 冲突必须 fail-safe，不能把旧 attempt 的结果覆盖新 owner 的状态。

## Classification

B 类聚合层，底层消费公开 jobs、workflows、subagents、session、execution、coordination 和 recovery projection；不走 R replacement，因为它跨多个官方 owner。

## Expected Result

业务 task 可以稳定地关联到实际 workflow、execution、session 和 job，并在重连后恢复一致的只读状态与 provenance。task 层不会与官方 jobs 重复实现调度，也不会把观察能力扩张成隐式执行控制器。
