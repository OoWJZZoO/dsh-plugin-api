# Stage 0 — Goal

## Feature Name

`plugin-api-m7-public-contract-refactor`

## Goal

在正式发布前，将 `dsh-plugin-api` 的 host/client 受支持的公共 API 面按第三方开发者理解的业务领域统一，建立单一的 public contract registry，完成旧公共路径与兼容 alias 的一次性迁移和公共面减法，再对最终保留的 API 补齐所需的 composition、authority、scope、generation、生命周期与 `services.*` 分级语义，并完成消费者迁移与组合验收。

本重构作为一个宏观 feature 统一治理，按“清点 → 契约基础 → namespace 一次性迁移 → 公共面减法 → 语义组合加固 → Services 分级与生态验收”的顺序串行推进。C 类能力只保留 upstream proposal；R 类能力仅沿用已批准的官方组件替换边界和现行 R 类规则，不修改官方 DSH 包文件。

## Scope Boundary

- 覆盖 host/client 受支持公共 API 的业务领域 namespace、capability path、类型、错误/result vocabulary、组合模式、owner、scope、resource、generation、lifecycle、authority map 与 `services.*` 静态白名单。
- 覆盖旧 public path 到目标 path 的完整映射、一次性移除旧路径和兼容 alias，以及发布前不保留成员的公共面减法。
- 覆盖包版本、插件协商、wire revision 与 durable schema 的边界重整；本次重构的公共 API 基线版本采用 `0.1.0-rc.6-0.1.0`，`dsh.api` 采用 `0.1`，遵守 `<A>-<B>.<C>.<D>` 版本模型。主包、辅助包和全量聚合包在本次重构中统一采用该约定的冻结基线；完成基线版本锁定（即各包 `package.json` 写入该版本并提交）后，整个 M7 执行期间不得再次 bump 任何包版本或 `dsh.api` 版本。
- 覆盖最终保留 API 的最小组合语义加固、host/client 对齐、full bundle 与选择性安装的装配等价性、反向加载顺序、冲突/失败/重载/scope/claim/cleanup 测试。
- 覆盖 `dsh-read-image` 与 `dsh-pro-ex-ability-anchor` 的消费者迁移验收，以及 headless 冒烟和 dev boot 验证。
- 遵守 `docs/standards/` 全局规范、AGENTS.md 的 spec coding 确认门、fail-safe、阶段提交和干净工作区要求。
- 本 feature 适用交付时 `docs/standards/` 下的现行分册规范。

> **规范路径迁移注**：本 feature 交付时的分册位于 `docs/standards/refactor/`（`public-api-shape.md`、`composition-and-authority.md`、`domain-composition.md`、`versioning-and-protocols.md`、`ordering.md`、`capability-and-services.md`、`plugin-state-and-lifecycle.md`、`sdk-and-conformance.md`）。这些规范已并入 `docs/standards/` 现行分册：前五个同名收录，`capability-and-services.md` 并入 `capability-strategy.md`，`plugin-state-and-lifecycle.md` 并入 `durable-state-and-scope.md`，`sdk-and-conformance.md` 已删除。现 `docs/standards/refactor/` 是后续 API 语义重构的未来目标规范，与本 feature 无关。

## Out Of Scope

- 不在本 feature 中新增脱离目标契约的业务能力或 SDK/conformance kit；SDK 仅在出现真实第三方接入问题后重新评估。
- 不保留旧路径、兼容 alias、按内部 feature/mounter/package/replacement 组织的公共命名空间。
- 不把 C 类上游提案伪装成已实现能力；不把横切事件派发语义转为 R 类。
- 不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 或任何官方包文件；R 类仍只通过官方 patch 机制完成替换。
- 不预建通用权限系统、全局 owner graph、跨 feature 分布式事务、全局 before/after 依赖图或通用 schema migration 平台。

## Success Criteria

- 第三方可以按业务领域定位主要 API，公共面不泄漏 feature、mounter、package 或 replacement 的组织方式。
- 每个保留公共成员都有明确的 capability、runtime、effect、composition，以及适用时的 authority map、scope、resource 和失败语义。
- Composable Profile 边界明确且可测试，推荐面不存在未登记的 singleton、silent last-wins 或高层 authority 旁路。
- host/client 遵循统一的领域 API 与低层 `services.*` passthrough 分层规则，公共契约由同一 registry 约束。
- 发布前不保留的 API 已直接删除。本地开发阶段（API 未发布），`services.*` 中经审计确认无独立长期价值的成员同样**直接删除 PATH**（删除前按本条报备批准）；「保留路径并呈现可识别的 `disabled/unavailable` 状态」仅适用于**发布并进入运维阶段后**、因 runtime identity 失配或可选安装缺失而不可用的已保留成员。任何不保留的公共 API 删除在执行删除前必须向人类报备，明确列出删除项、影响范围、替代路径（如有）和删除理由；报备不等于默认保留，批准后仍按公共面减法原则执行。
- 组合测试覆盖顺序、冲突、失败、重载、scope、claim、generation、stale disposer 和 cleanup；消费者迁移与 headless/dev boot 验收通过。
- 所有实现、测试、规格和登记均按 Stage 4 全局终审通过后提交，工作区恢复干净。
