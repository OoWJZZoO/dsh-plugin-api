# docs/standards/refactor — 公共 API 语义重构规范（未来目标）

> **本目录不是当前仓库的现状标准。**
> `docs/standards/`（本目录的父目录）回答「当前仓库实际提供什么、当前 API 实际长什么样」；本目录回答「公共 API 应当长什么样」。
> 本目录的条文一律是**未来目标**，写成「应当 / 必须 / 不得」，不得描述成当前 runtime 已具备的能力。
> 当前 feature 的设计不得把本目录当作已具备的能力（`AGENTS.md` §3.4）。

## 1. 本目录是政策规范，不是实施计划

本目录只回答一个问题：**公共 API 的正确形状是什么。**

它**不**回答、也不得承载：

- 哪个官方组件包承载某项能力迁移（实现通道的归属判定属于实施期决策，政策上只登记「需要能力迁移」，见 [`api-idiom.md`](api-idiom.md) §5）；
- 重构的批次、顺序、排期；
- 某个具体成员的迁移由哪个 feature 承接。

本目录给出的是**验收条件**：重构完成时，公共 API 必须长成这里规定的样子。至于怎么走到那里，由实施期的任务书决定。

## 2. 三条核心原则

1. **语义优先。** 一个 API 属于哪个 idiom，判据是「按它的语义，调用方跟它打交道时脑子里要装哪一套套路」，**不是**「它现在长什么样」。现状形状是实现的结果，不是分类的依据。
2. **分类决定形状。** 归属一旦确定，该成员的形状——**包括结构、字段、handle 成员与名称**——由所属 idiom 的标准形状决定，不由领域习惯决定。一个领域历史上叫 `open`，不构成保留 `open` 的理由。
3. **形状可改。** 为了让 API 对齐标准形状，允许重命名、重构、迁移能力、删除 API。本仓库处于纯本地开发阶段（`AGENTS.md` §3.0.1），不存在外部兼容承诺；「这个 API 已经交付所以不能动」在本目录内不成立。

原则 2 与 3 合起来推出本轮重构的**目标形态**：

> 同一 idiom 的成员应当接近同构。跨领域时，它们的入口动词、返回字段、handle 成员、失败方式与冲突规则应当一致；允许不同的只有**领域数据的类型**。

## 3. 分册索引

| 分册 | 回答什么 |
|---|---|
| [`api-idiom.md`](api-idiom.md) | idiom 总则：判定判据、形状由分类决定、跨领域同构与统一命名、契约条目、形状不合时的处置顺序、passthrough 的边界 |
| [`idiom-catalogue.md`](idiom-catalogue.md) | 八个 idiom 的**标准形状**：命名词表、结构契约、同构要求、领域实例、能力缺口 |
| [`api-migration.md`](api-migration.md) | 现状 API → 目标形状的迁移决策（重命名 / 删除 / 迁移 / 重构）；实现事实见成员清单 |
| [`member-contract-registry.md`](member-contract-registry.md) | 成员级契约登记规则、host/client parity 与机械校验 |
| [`member-inventory.md`](member-inventory.md) | 基于实现事实的 host/client 逐叶子成员清单与目标归属 |
| [`capability-matrix.md`](capability-matrix.md) | 能力覆盖、删除替代和能力守恒验收矩阵 |
| [`anti-intuitive-inventory.md`](anti-intuitive-inventory.md) | 绑定具体 public path 的反直觉结构与 M8 目标清单 |

## 4. 与其他维度的关系

| 维度 | 回答什么 | 权威 |
|---|---|---|
| 实现通道（官方直通 / 门面转译 / upstream proposal / 已登记替换） | 这个能力**怎么来的** | `../capability-strategy.md` |
| namespace / 心智模型 | 这个能力**在哪找** | `../public-api-shape.md` |
| 语义三面（projection / policy / durable mutation） | 这个能力与领域状态**是什么关系** | `../api-shape.md` |
| **API idiom** | 这个 API **长什么样、怎么用** | 本目录 |

三者正交，idiom 契约不得泄漏它们的组织方式。同一 idiom 横跨多个 namespace 与多种实现通道；同一 namespace 内部可以同时存在多个 idiom。这是本目录要求登记粒度下沉到成员的直接原因。

## 5. M8 使用方式

M8 的目标设计必须同时满足：

- [`member-inventory.md`](member-inventory.md) 中的每个 current 叶子都有唯一目标归属；
- [`capability-matrix.md`](capability-matrix.md) 中没有未说明的删除或能力损失；
- [`anti-intuitive-inventory.md`](anti-intuitive-inventory.md) 中的每个问题都有目标形状和验证证据；
- [`member-contract-registry.md`](member-contract-registry.md) 的叶子级 registry 能机械验证 host/client parity、handle 覆盖、命名、失败和冲突外层契约。

八个 idiom 的公共契约只统一跨领域可观察的调用套路；领域数据、领域 reducer 和 operation 的内部并发策略通过显式字段登记。这样新增 B/R 能力时可以扩展能力，不必为每个领域重新发明一套调用方式。


- 本目录不留未决条目。每一条要么是明确结论，要么不写。
- **「能力缺口」不是未决条目**：它记录的是已经确定的政策结论（例如「策略注册后必须自动生效」），只是兑现它需要能力迁移。缺口的**规范结论**是确定的，只有**实现路径**不在本目录范围内。
- 未决取舍、候选方向、研究清单不进入本目录，也不引用本目录之外的临时文档。
