# Stage 0 - Goal

## Feature Name

`recovery-policy`

## Status

Stage 0 Goal 已由用户确认。

## Goal

为第三方插件提供统一的失败分类与恢复策略注册契约，减少各插件重复实现 transient/permanent/aborted/denied/superseded 判断、退避边界、retry budget 和人工介入条件。该 feature 应让系统在明确的决策点选择 retry、abort、fallback、fork 或 stop，并将决定与 execution/attempt、原因和能力声明关联。

首版是 policy-first：它定义“在什么条件下可以采取哪种恢复动作”，不承诺自动恢复所有底层状态，也不把 checkpoint、workspace mutation 或 task scheduler 合并成一个万能服务。

## Scope Boundary

- 包含：失败分类、operation capability 声明、retryability/idempotency 判断、retry/abort/fallback/fork/stop 决策、退避与次数/期限边界、attempt 与 execution 的关联、决策 reason 和安全默认值。
- 依赖 `execution-observation` 的 execution/attempt projection；依赖 `usage-budget-telemetry` 的预算 evidence；可消费 diagnostics、session branch 和 workspace checkpoint 的公开能力，但不拥有它们的状态。
- `abort`、`denied` 和 `superseded` 默认不可自动 retry；非幂等 tool 或未声明 capability 的 operation 默认 fail-closed。
- 完整请求边界、官方 agent-loop 内置 retry 和跨 session 的 checkpoint restore 若当前公开 seam 无法证明，只登记为 C 类 upstream proposal；不得在 facade 中伪造官方 loop 内部时序。
- 不包含 durable checkpoint backend、workspace transaction、lease/CAS、自动 route 选择、自动 profile 修复、非幂等副作用补偿或修改官方包文件。

## Expected Result

auto-continue、model failover、agent team reassign、rewind 和后台任务插件可以共享同一失败词汇、attempt 语义和 retry safety contract。恢复决策失败或策略抛错时，系统使用安全默认值并保留诊断，不会因为恢复层故障改变原始执行的结果或杀死 harness boot。
