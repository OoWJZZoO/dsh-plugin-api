# Stage 0 - Goal

## Feature Name

`coordination-lease`

## Status

Stage 0 Goal 草案，待用户确认。

## Goal

为第三方插件提供统一的 durable coordination / lease 契约，收敛多 agent 协作、跨 session handoff、文件 claim 和任务重派中重复实现的 owner、generation、过期、接管与并发写入语义。该 feature 应让共享资源的持有者能够证明当前 ownership，并让旧持有者在 lease 过期、接管或换代后无法继续写入。

首版是横切的 B 类门面服务：它定义 lease、heartbeat、release、takeover、watch 与 compare-and-set 的公共语义，但不假设所有 backend 都具备相同的持久性或跨进程能力。内存 fallback 必须明确标记为非 durable，不能伪装成跨进程协调。

## Batch Order and Dependencies

本 feature 是本批次的第一个基础 feature。`workspace-mutation-transaction` 依赖它提供的 lease/fencing/CAS 语义；`task-execution-observation` 依赖它提供的 attempt ownership 与 stale-holder 防护。它可以读取 execution/task 的公开 identity，但不拥有 execution、task 或 workspace 的业务状态。

## Scope Boundary

- 包含：按 resource 作用域 acquire、heartbeat、release、显式条件 takeover、watch，以及带 expected version 的 compare-and-set 记录操作。
- 每个 lease handle 至少表达 `ownerId`、`generation`、`expiresAt` 和 `fencingToken`；受保护写入必须携带当前 fencing token，旧 generation 或 stale token 必须被拒绝。
- 明确区分 storage backend、workspace/session scope、durable 能力和内存 fallback；能力不可用或状态不确定时返回显式 unavailable/unsupported，不把本地成功扩大解释为分布式成功。
- 失败路径必须 fail-safe：失去 ownership、heartbeat 失败、重复 disposer、stale watch 或 backend 错误不得让 harness boot 失败，也不得静默接受旧持有者写入。
- 不包含 worker scheduler、任务编排、自动 retry、route 选择、checkpoint restore、workspace mutation transaction、任意外部副作用补偿或官方包替换。

## Classification

B 类门面服务；若未来官方提供等价统一 lease service，优先直通官方能力并保留兼容 facade。该 feature 不走 R replacement，因为 ownership 语义横跨任务、文件和 agent。

## Expected Result

agent teams、task relay、file claim 和后续 workspace/task feature 可以共享同一 ownership 与 fencing contract，减少 late result、重复执行和 stale takeover 导致的数据覆盖；协调 backend 不可用时，调用方能明确降级，而不是得到虚假的 durable 保证。
