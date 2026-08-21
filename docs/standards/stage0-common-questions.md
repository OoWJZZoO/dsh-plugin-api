# Stage 0 共同问题（正式 Goal 前须统一口径）

> 状态：2026-08-21 用户已答复 1–8 与 10（NO.9 讨论中）。候选 feature 立项时逐项核对本表口径；口径修订必须在本表回填并说明理由。
> 来源：提取自 `docs/specs/plugin-api-features/dsh-plugin-api-heuristic-feature-proposals-2026-08-20.md`「Stage 0 前需要共同确认的问题」（2026-08-20 启发式候选调研）；该表单保留为历史快照，**本文件为权威列表**。
> 规则：任何 feature 进入 Stage 0（Goal）之前，凡与本表相关的问题必须先给出项目口径并回填下表；回填结论需在对应 feature 的 requirements/design 中可追溯，且不得与已回填的其他条目冲突。

| # | 问题 | 当前口径 |
|---|---|---|
| 1 | `executionId` 是否由 plugin-api 生成，还是必须等待官方提供稳定 execution identity？ | **由 plugin-api 自己生成**（不等待官方提供）。 |
| 2 | durable record 的最小存储 contract 是 session、workspace 还是 profile-scoped storage？ | **明确分层**（scope 即存储契约）：session = 对话、turn、execution observation、session branch、prompt provenance；workspace = 文件 lease、项目任务、checkpoint、跨 session coordination；profile = 插件配置、能力状态、用户预算、profile 安装状态。持久化记录必须归属且只归属其中一档。 |
| 3 | 所有 generation 是否都采用单调整数，还是使用 owner-specific opaque token？ | **owner-specific opaque token**；若某个 owner 确实需要排序，再额外提供 **owner-local revision**（不全局统一单调序号）。 |
| 4 | `settled`、`committed`、`closed`、`disposed` 是否需要严格区分，避免把生命周期词混用？ | **不同对象仍使用不同字段，但提供统一的 terminal outcome 词汇**：`success` / `error` / `aborted` / `denied` / `superseded`。执行可以有 outcome；mutation 可以有 commitState；resource 可以有 lifecycleState；任务可复用统一 terminal outcome（语义统一，字段不合并）。 |
| 5 | 哪些语义需要模型可见，哪些只允许 UI/diagnostic 可见，哪些必须 redacted？ | **默认最小暴露，显式提升可见性**。默认：模型看不到 execution 内部诊断、UI 看不到 secret、日志只保留摘要。只有经过 policy：某些 route reason 可进入模型、某些 attachment metadata 可进入 UI、某些 error detail 可进入 debug mode。 |
| 6 | R bundle 是否按现有 full/selection install 模式作为独立辅助包发布？ | **每个 R 能力一个独立辅助包**（每个被替换的官方包对应一个独立辅助包），例如 `@deepseek-ai/dsh-plugin-api-mcp`、`@deepseek-ai/dsh-plugin-api-session-branch`、`@deepseek-ai/dsh-plugin-api-attachments`；沿用现有 full/selection install 模式与版本协商。 |
| 7 | replacement 是否需要提供官方行的完整 client half，还是只替 host 行？必须按具体 owner 的原始契约决定，不能一概而论。 | **按序判定，任何一项命中即要求完整复制其客户端能力**：① 被替换的官方行是否声明 client manifest？② 是否注册 remote namespace？③ 是否提供 slot 或 settings bridge？④ 是否有 client 与 host 之间的版本协商？⑤ 是否有 browser-side state 或 reconnect 语义？⑥ 官方行是否拥有 client-facing event/service？全部为否则 host-only。 |
| 8 | 所有恢复和 retry 是否默认 fail-closed；对 non-idempotent tool 是否强制要求 capability declaration？ | **按 operation 声明能力，未知默认禁止**。未声明时默认不自动 retry。retry ≠ 重新执行同一 execution：必须区分「execution-1 的 attempt-1 → error、attempt-2 → success」与「execution-1 内部一次 operation 的重试」，否则 usage、budget、route、audit 会混乱。失败分类：**transient**（暂时网络断开、provider 503、MCP server 临时不可用）允许 retry 但必须有边界；**permanent**（参数错误、权限不足、schema 不匹配、文件不存在）通常不应自动 retry；**aborted**（用户取消或 AbortSignal 触发）不能当 transient failure；**denied**（approval 拒绝）不能自动绕过；**superseded**（旧 generation 或旧 attempt 已被新操作取代）通常不能继续补写结果。 |
| 9 | 纯 projection、policy registry、durable mutation 的边界在哪里，避免把每个候选都做成一个万能 service？ | **待定**（2026-08-21 讨论中；草案方向：投影 / 策略注册 / durable 变更三面分离 + 一面原则 + 共享底座）。 |
| 10 | 当前仓库仍处于纯本地开发窗口，合理的 API 形状重构应尽早纳入，而不能用“已 delivered”作为拒绝理由；但仍必须遵守每个 feature 的 Stage 0–4 gate。 | **确认成立**：AGENTS.md §3.0.1 已明文此规则（纯本地开发窗口、API 重构尽早纳入、不得以"已 delivered"否决、仍须守 Stage 0–4 确认门），本条不构成问题。 |