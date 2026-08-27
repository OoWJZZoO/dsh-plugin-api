# docs/standards — 全局 feature 设计规范

本目录收录所有 feature 设计必须遵守的**全局规范**（跨 feature 的治理口径与设计约束），是 AGENTS.md 之外的规范落脚点。任何 feature（含 M4/M5/M6 及后续）进入 Stage 0–3 时，先检查并按领域分册对照本目录。

规则：

- 新增全局规范按领域落盘为独立分册，并在 AGENTS.md §6/§8 的规范目录指针中登记；AGENTS.md 只承载 constitution 与指针，不承载规范正文。
- 规范修订影响能力边界时，必须同步 AGENTS.md §2/§4 与 `docs/specs/plugin-api-features/feature-list.md`（AGENTS.md §6 既有规则）。
- 分册之间按领域正交；条文冲突时以 `capability-strategy.md`（能力上限）与 AGENTS.md 铁律为准。

| 分册 | 领域 | 内容 |
|---|---|---|
| `capability-strategy.md` | 能力分类与上限 | A/B/C/R 分类、方案一/二/三、安全不变量、R1–R9 硬性规则、B 类迁移矩阵、R 辅助包边界（§9）、客户端半面判定（§10） |
| `api-shape.md` | API 形状 | 投影 / 策略 / 变更三面边界、数据流单向、一面原则、底座与公开面分离、smell 判据 |
| `identity-and-lifecycle.md` | 身份与生命周期 | executionId 自生成、owner-specific generation token + owner-local revision、统一终态词汇 |
| `durable-state-and-scope.md` | 持久状态与作用域 | session / workspace / profile 分层、durable mutation 契约、operation 能力声明、失败分类与 retry 边界 |
| `visibility-and-redaction.md` | 可见性 | 默认最小暴露、policy 显式提升、脱敏覆盖边界 |
| `concurrency-and-cancellation.md` | 并发与取消 | AbortSignal 传播、终态裁决、stale result 隔离、disposer 所有权、并发策略与 retry 边界 |
| `refactor/README.md` | M7 API 重构 | 公共 API 形状、组合与 authority、能力边界、版本协议、插件私有状态、多插件排序和 SDK 后续参考；按领域拆分为子分册 |
| `stage0-common-questions.md` | 历史溯源（已弃用） | 溯源映射 + 历史问答快照，不再作为 feature 设计入口或权威 |

现行权威分册为前六项及 M7 重构分册；`stage0-common-questions.md` 仅供追溯历史决议。
