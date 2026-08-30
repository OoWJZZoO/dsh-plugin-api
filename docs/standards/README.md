# docs/standards — 全局 feature 设计规范

本目录收录所有 feature 设计必须遵守的**全局规范**（跨 feature 的治理口径与设计约束），是 AGENTS.md 之外的规范落脚点。任何 feature 进入 Stage 0–3 时，先检查并按领域分册对照本目录。

规则：

- 新增全局规范按领域落盘为独立分册，并在 AGENTS.md §6/§8 的规范目录指针中登记；AGENTS.md 只承载 constitution 与指针，不承载规范正文。
- 规范修订影响能力边界时，必须同步 AGENTS.md §2/§4 与 `docs/specs/plugin-api-features/feature-list.md`（AGENTS.md §6 既有规则）。
- 分册之间按领域正交；条文冲突时以 `capability-strategy.md`（能力上限）与 AGENTS.md 铁律为准。
- 本目录各分册只写**当前仓库事实**：现在提供什么、现在不提供什么、现在要求什么。未来目标、未立项候选、已结束的项目过程不写入本目录。

## 分册索引

| 分册 | 领域 | 内容 |
|---|---|---|
| `capability-strategy.md` | 能力分类、通道上限与 `services.*` | A/B/C/R 分类、方案一/二/三、安全不变量、R1–R9 硬性规则、已交付 replacement 装配表、组件 owner 与客户端半面判定（§10）、`services.*` 定位与成员分级、runtime-specific availability、公共面减法 |
| `api-shape.md` | 语义三面 | projection / policy registry / durable mutation 边界、数据流单向、一面原则、底座与公开面分离、smell 判据 |
| `public-api-shape.md` | 公共 namespace 与成员形状 | bounded context 组织、host/client 领域树、命名与形状、capability registry、公共面减法、public contract registry |
| `composition-and-authority.md` | 组合与 authority | 兼容四层、composition mode、Composable Profile、owner/key/generation/disposer、authority closure、静态 claim 与 preflight、失败语义 |
| `domain-composition.md` | 领域组合最低要求 | 各公共领域 owner、冲突、顺序、资源与 authority 的最低约束 |
| `ordering.md` | 多插件排序 | 固定 priority vocabulary、注册顺序、领域 reducer 与插件责任边界 |
| `identity-and-lifecycle.md` | 身份与生命周期 | executionId 自生成、owner-specific generation token + owner-local revision、统一终态词汇 |
| `durable-state-and-scope.md` | 持久状态与作用域 | session / workspace / profile 分层、durable mutation 契约、operation 能力声明与 retry 边界、插件私有 storage |
| `visibility-and-redaction.md` | 可见性与脱敏 | 默认最小暴露、policy 显式提升、client 半身受众、脱敏覆盖边界 |
| `concurrency-and-cancellation.md` | 并发与取消 | AbortSignal 传播、终态裁决、stale result 隔离、disposer 所有权、并发策略与 retry 边界 |
| `versioning-and-protocols.md` | 版本与协议 | `<A>-<B>.<C>.<D>` 模型、包装配与 runtime 检查、第三方协商、wire/durable 合同、安装模式与装配等价性 |
| `refactor/README.md` | 公共 API 语义重构（**未来目标**） | 该目录是下一轮公共 API 语义重构的目标规范（idiom 分类与成员级契约），**不是当前仓库事实**，不作为当前 feature 设计的遵守对象 |

## 公共契约的唯一事实源

现行公共 API path、逐成员状态与版本基线以 `docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json` 为准。本目录各分册规定「应当如何设计」，不复制该 registry 的逐成员登记，避免双源漂移；分册条文与 registry 现有登记冲突时，以 registry 为现状事实、以分册为设计判据，并走变更流程修订其中一方。
