# M7 API 重构规范

> 状态：M7 仓库重构的正式标准来源。
> 适用范围：`dsh-plugin-api` 门面的 host/client 公共形状、能力组合、官方 service passthrough、版本与协议、插件私有状态，以及多插件排序。
> 维护边界：本目录规定跨 feature 的架构约束；具体 feature 仍须通过仓库规定的 spec coding 流程。feature 登记和交付状态由 [`docs/specs/plugin-api-features/feature-list.md`](../../specs/plugin-api-features/feature-list.md) 独立维护，本目录不复制该登记表。

## 1. 规范地位

本目录将 M7 重构讨论中已经确定的架构方向按领域拆分为独立分册。它与 `docs/standards/` 的其他规范共同构成后续 feature 设计和 M7 重构实现的标准来源；分册之间发生冲突时，以 `AGENTS.md` 铁律和 `capability-strategy.md` 的能力上限为准。

本目录中的“必须”“不得”“应”是规范性要求；“可以”“建议”表示允许或推荐，但不把推荐写成运行时硬门槛。`sdk-and-conformance.md` 中的内容全部是后续参考，不是当前实现计划。

## 2. 分册索引

| 分册 | 领域 | 主要内容 |
|---|---|---|
| [`public-api-shape.md`](public-api-shape.md) | 公共 API 形状 | bounded context、host/client namespace、命名、capability、公共面减法 |
| [`composition-and-authority.md`](composition-and-authority.md) | 组合与 authority | composition mode、Composable Profile、owner/key/lifecycle、authority closure、善意插件故障模型 |
| [`domain-composition.md`](domain-composition.md) | 语义领域组合 | 各目标 namespace 的 owner、冲突、顺序、资源与 authority 最低要求 |
| [`capability-and-services.md`](capability-and-services.md) | 能力边界与 services | feature admission/retirement、发布前减法、`services.*` 分级、可用性与实现通道 |
| [`versioning-and-protocols.md`](versioning-and-protocols.md) | 版本与协议 | 包版本模型、插件协商、wire revision、durable schema |
| [`plugin-state-and-lifecycle.md`](plugin-state-and-lifecycle.md) | 插件私有状态 | owner-scoped storage、scope、schema envelope、停用/卸载生命周期 |
| [`ordering.md`](ordering.md) | 多插件排序 | 固定 priority、注册顺序、领域 reducer 与插件责任边界 |
| [`sdk-and-conformance.md`](sdk-and-conformance.md) | 后续参考 | SDK 与 conformance kit 的暂缓判断和未来评估方向 |

## 3. M7 重构原则

1. 公共 API 按第三方开发者理解的业务领域组织，不按内部 feature、mounter、官方组件包、交付批次或 replacement 方式组织。
2. 公共 capability path、内部 feature/mounter key 和安装 bundle/package identity 必须分别建模，不能默认同名或一一对应。
3. 门面是共享扩展点的 arbiter，负责 owner、scope/resource、冲突、组合、generation、可用性和失败语义；纯官方直通不自动获得这些保证。
4. 门面不承诺任意两个插件的业务目标永远一致；它必须把受支持边界内的冲突变成确定的组合、仲裁、拒绝或明确的顺序后果。
5. 只为真实的共享边界增加机制。不得为完整覆盖检查清单而引入通用权限系统、跨 feature 分布式事务、全 callback retry/quota/recovery 状态机、同步代码抢占或全局 owner graph。
6. 插件自己的私有计算、私有状态和业务流程不受门面沙箱式限制；门面只约束插件接触共享资源和其他 owner 的边界。

## 4. 推荐的重构顺序

跨 feature 的实施按以下顺序组织；每个实施批次仍需单独遵守仓库 spec coding 确认、审查、测试和提交规则：

1. **清点**：建立旧 public path 到目标 path 的映射，完成公共成员的 effect、composition 和 authority map，找出 singleton、silent last-wins、shared mutation 及 authority 旁路。
2. **契约基础**：建立 public contract registry，定义 capability、composition、claim、scope 和失败词汇，锁定 wire/durable 的最小版本模型以及 host/client surface snapshot。
3. **Namespace 一次性迁移**：按目标领域树重组 host/client，删除旧路径和兼容 alias，解耦公共 capability path、内部 key 与 package identity。
4. **公共面减法**：在目标 namespace 稳定后逐成员审计并删除不保留的 API；对仅因 runtime 差异不稳定的 `services.*` 成员优先使用 `disabled/unavailable`，不把路径静默删除。
5. **语义组合加固**：仅对最终保留的 API 补 owner、generation、顺序/reducer、scope、resource identity、CAS/fencing/transaction 和 authority closure。
6. **Services 分级与生态验收**：逐成员审计 `services.*`，完成 client namespace 整理、开发期双插件测试、消费者迁移和反向顺序测试；SDK 相关工作只有在真实接入问题证明需要时再评估。

## 5. 完成定义

M7 重构完成时，应同时满足：

- 第三方可以按业务领域找到主要 API，公共面不泄漏 feature、mounter、package 或 replacement 组织方式。
- 每个保留公共成员都有 capability、runtime、effect、composition，以及需要时的 authority map、scope、resource 和失败语义。
- Composable Profile 的边界明确且可测试；推荐面不存在未登记的 singleton、silent last-wins 或高层 authority 旁路。
- `services.*` 已按成员分级，不再被整体视为天然可组合。
- host/client 遵循同一套领域 API 与低层直通分层规则。
- wire/durable 数据只使用实际需要的 revision/schema ID/version 和局部 decoder，不预建通用迁移框架。
- 开发期组合测试覆盖顺序、冲突、失败、重载、scope、claim 和 cleanup；运行时只保留契约要求的廉价检查。
- API、类型、文档、disabled surface 和测试可以由同一个 public contract registry 约束，而不是各自维护互相漂移的公共形状。

目标不是消除所有业务冲突，而是让冲突变成可预测、可归因、可组合或可提前拒绝的公共契约。
