# 能力边界与 Services 标准（M7）

> 适用范围：feature 是否由门面长期拥有、实现通道如何选择、发布前公共面减法，以及 `services.*` 官方低层 passthrough。
> 关联：A/B/C/R 能力上限以 [`../capability-strategy.md`](../capability-strategy.md) 为准；公共形状见 [`public-api-shape.md`](public-api-shape.md)；组合和 authority 见 [`composition-and-authority.md`](composition-and-authority.md)。

## 1. Feature admission 与 retirement

Feature admission 与 retirement 是软性评估方向，不设置可机械判定的硬门槛或量化评分。消费者数量、共享 arbiter、官方 seam 稳定性、owner/scope/lifecycle 价值和长期维护成本用于帮助维护者判断，不因单项未满足而自动批准或拒绝。

评估必须分开回答两个问题：

1. **归属判断**：该能力是否值得由门面长期拥有，是否保护真实的插件共享边界。
2. **实现通道判断**：获准进入后，应使用一等语义 API、`services.*` passthrough、upstream proposal 还是 replacement。

A/B/C/R 是实现分类，不能代替归属判断。技术上可以包装或替换，不代表门面应当长期拥有该能力。

## 2. 发布前减法

正式发布前，应主动删除会制造较大兼容负担但缺乏稳定价值的成员或 feature；“已经实现”不是必须保留的理由。重点候选包括：

- 泄漏 writable live authority、裸 singleton setter、底层 registry 或未经协调的 shared mutation 的 `services.*` 成员。
- 只能复刻当前 runtime 形状、无法提供可说明稳定语义的 passthrough。
- 已有一等领域 API 覆盖的重复入口。
- 只减少少量样板、没有真实消费者或本应由单一产品插件拥有的 feature。
- 无法闭合 authority、无法给出清楚组合语义且保留为 supported API 会产生误导的成员。
- 官方等价 seam 已使 adapter 或 replacement 失去独立价值的实现。

减法必须安排在目标 namespace 重组之后：旧结构阶段只清点和标记；domain-first 重组后不为候选建立新 alias；新结构稳定后逐成员删除不保留的 API；只对最终保留面做 composition 加固、conformance、文档和发布验收。

`1.0` 前可直接删除不合格 API。正式发布后的删除才需要 deprecation 和协议破坏版本。

## 3. Retirement

- 官方 seam 已能承载现有公共语义时，优先退役 adapter 或 replacement；公共 capability 只有在 wrapper 仍提供独立稳定价值时才保留。
- capability 语义继续存在时保留 identity；能力本身退出时同步移除 identity，不保留空壳 capability。
- 每个新 feature 在对应 spec 中简短说明 admission rationale 和可预见的 retirement trigger，不建立独立治理平台。

## 4. `services.*` 定位

`services.*` 是受支持、静态白名单、runtime-shaped 的低层官方 service 适配层。它不是杂物箱，也不是默认推荐层；保持官方 service key 的一比一命名，不按人为领域再次分组。组合保证按成员登记，不能按整个 service 推断。

每个新增 passthrough 必须具备明确第三方用例、静态白名单、composition 分类和 authority map；不得自动吸收官方新增成员。

## 5. Services 成员分级

| 官方成员类型 | 门面处理 |
|---|---|
| 只读查询、纯计算、冻结投影 | 可以列入 pure services |
| 有稳定 owner/key/disposer 的加性注册 | 补齐调用方 owner 与 stale guard 后列入 additive |
| 多策略/transform 决策点 | 不裸透传，由领域 namespace 提供 ordered registry/reducer |
| 共享资源 mutation | 要求 coordinated authority，或移出 Composable Profile |
| singleton setter/provider slot | 由领域 registry 多路复用，或要求 exclusive claim |
| 返回 live 可写对象 | 改为只读 view/受限 handle，或明确排除 pure |
| 无法证明官方组合语义 | 保持 advanced supported passthrough，不宣传组合保证 |

若 service mutator 能绕过同仓库高层 authority，必须包装、claim 化或移出 Composable Profile；不能只靠文档提醒“谨慎使用”。

`services.attachments` 与 `attachments.pipeline` 等低层 service 和门面语义能力可以共存，但推荐工作流不得要求第三方自行拼接多个 `services.*` 才能维持关键不变量。直接 import/inject 官方内部包是 unsupported escape hatch，与 supported-but-tiered 的 `services.*` 区分。

## 6. Runtime-specific availability

某个 `services.*` 成员若因官方 runtime identity 差异无法稳定兑现：

- 保留公共 API path，不静默从公共树删除；
- 对该成员返回可识别的 `disabled/unavailable` 结果；
- 在开发者文档和 capability 状态中说明适用 runtime 条件；
- 不要求所有插件使用者预先把 runtime identity 绑定为安装前置条件，但建议使用者在使用该成员时考虑 runtime 和 availability。

这条规则只针对 runtime-specific 不稳定，不阻止发布前删除没有独立长期价值的成员。两者判断必须分开：公共面减法决定是否值得保留，availability 决定在当前 runtime 上是否可用。

## 7. 与语义 API 的关系

- 带门面附加语义的能力应进入领域 namespace，不因底层实现属于哪个官方组件而改变公共路径。
- 门面可以组合多个官方组件的公开能力。
- 一个 replacement capability slice 可以与 facade translation 并存；每个 replacement 仍遵守 `capability-strategy.md` 的组件归属、完整契约、版本、自检和退役要求。
- 无法提供 authority closure 的成员不得进入推荐面；可以继续作为 advanced passthrough，但必须明确其不具备默认组合保证。
