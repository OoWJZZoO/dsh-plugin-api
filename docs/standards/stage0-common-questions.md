# Stage 0 共同问题（正式 Goal 前须统一口径）

> 状态：候选 feature 立项时逐项回填「当前口径」。
> 来源：提取自 `docs/specs/plugin-api-features/dsh-plugin-api-heuristic-feature-proposals-2026-08-20.md`「Stage 0 前需要共同确认的问题」（2026-08-20 启发式候选调研）；该表单保留为历史快照，**本文件为权威列表**。
> 规则：任何 feature 进入 Stage 0（Goal）之前，凡与本表相关的问题必须先给出项目口径并回填下表；回填结论需在对应 feature 的 requirements/design 中可追溯，且不得与已回填的其他条目冲突。

| # | 问题 | 当前口径 |
|---|---|---|
| 1 | `executionId` 是否由 plugin-api 生成，还是必须等待官方提供稳定 execution identity？ | |
| 2 | durable record 的最小存储 contract 是 session、workspace 还是 profile-scoped storage？ | |
| 3 | 所有 generation 是否都采用单调整数，还是使用 owner-specific opaque token？ | |
| 4 | `settled`、`committed`、`closed`、`disposed` 是否需要严格区分，避免把生命周期词混用？ | |
| 5 | 哪些语义需要模型可见，哪些只允许 UI/diagnostic 可见，哪些必须 redacted？ | |
| 6 | R bundle 是否按现有 full/selection install 模式作为独立辅助包发布？ | |
| 7 | replacement 是否需要提供官方行的完整 client half，还是只替 host 行？必须按具体 owner 的原始契约决定，不能一概而论。 | |
| 8 | 所有恢复和 retry 是否默认 fail-closed；对 non-idempotent tool 是否强制要求 capability declaration？ | |
| 9 | 纯 projection、policy registry、durable mutation 的边界在哪里，避免把每个候选都做成一个万能 service？ | |
| 10 | 当前仓库仍处于纯本地开发窗口，合理的 API 形状重构应尽早纳入，而不能用“已 delivered”作为拒绝理由；但仍必须遵守每个 feature 的 Stage 0–4 gate。 | |