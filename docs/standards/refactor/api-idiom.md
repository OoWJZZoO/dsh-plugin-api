# API idiom 总则与分组方法（M8）

> 本文是 M8 公共 API 语义重构的目标规范，不是当前仓库现状。写作语气为“重构后应当”。
> 目录：[`member-contract-registry.md`](member-contract-registry.md)（登记规则）、[`idiom-catalogue.md`](idiom-catalogue.md)（八个 idiom 的具体契约）、[`events-and-passthrough.md`](events-and-passthrough.md)（边界）。

## 1. 什么是 idiom

**API idiom** = 调用方必须掌握的固定用法套路。它不是本体分类（这个 API 与领域状态是什么关系），而是语用分类（调用方跟这类 API 打交道时脑子里要装哪一套套路）。

> 判据：**如果两个 API 要求调用方遵循的套路相同，它们就是同一类；套路不同就该分开。与它们在领域逻辑上谁包含谁无关。**

因此逻辑上的“包含”不构成并列障碍：一次 operation 在实现上可能内部调用 policy chain 并落一次 commit，但在调用方视角下它与两者是不同套路，可以并列。类比 HTTP 方法：POST 能涵盖 GET/PUT/DELETE 的效果，但分类轴是“这次交互的契约是什么”，不是“这次操作是什么”。

## 2. “最大公共交互契约”的准确含义

每组 idiom 要固定的那份东西称为**公共交互契约**。取“最大”的正确口径是：

> **先综合多个因素形成平衡、可记忆、覆盖真实成员的 idiom 分组；分组确定后，再在每组内部提炼该组成员共同遵守的最大公共交互契约。**

“最大”是**在已定好的分组之内寻求完备**，不是“为了提高契约密度而不断细分，也不是把类别数量推到最多”。

### 2.1 平衡分组的综合判据

分组时至少综合以下因素，不单看其中一项：

- 调用方的主要心智动作和使用套路；
- 入口、返回值、handle/disposer 的交互形状；
- 生命周期、owner、generation 和资源身份；
- 失败、冲突、幂等、retry 和 availability 语义；
- 组合模式、authority 关系和 scope；
- host/client 是否真的要求同构；
- 类别是否足够覆盖真实成员，且不会为少数例外制造无意义的类别。

### 2.2 由平衡判据直接得出的四条纪律

1. **类别数量不是优化目标本身。** 不得为了减少类别把套路不同的成员塞进同一 idiom，也不得为了“契约更完整”无止境拆分。
2. **契约越完整不代表必须继续拆类。** 只有在现有分组无法形成有用、可复用的公共套路时才考虑拆分。
3. **若某个 API 与同类只共享极少约定，优先检查能否调整该 API 的形状以适配已有 idiom**，而不是为它单开一类。本仓库处于纯本地开发阶段（AGENTS.md §3.0.1），API 形状是可改的。
4. **小类别可以合并；无法消除的例外必须在该 idiom 中显式登记**，不得靠隐藏维持表面统一。

### 2.3 最大化的边界

判据：**这条能不能不含任何领域名词地说完？**

- 能 → 公共交互契约。例：“注册返回 identity-bound disposer；重复 dispose 是 typed no-op；disposer 不会移除继任者的注册。”
- 不能 → 领域语义，归各 API 自己的文档。例：“`appendMessage` 的 kind 只接受 `user/message` / `assistant/message` / `tool/result`。”

即：**最大化的边界是领域语义的边界，不是篇幅的边界。**

目标函数不是“契约条目数最多”，而是**可推导性最大**：调用方从 idiom 契约能推出多少，还需要查领域文档的部分有多小。

## 3. 契约条目清单

每个 idiom 的公共交互契约应当覆盖以下九条；不适用者写明“不适用”并说明理由：

| # | 条目 | 说明 |
|---|---|---|
| 1 | 入口形状 | 函数签名套路、参数归类、同步/异步 |
| 2 | 返回值与句柄 | 返回值是判别式结果、冻结视图、handle 还是裸 disposer；句柄携带哪些身份字段 |
| 3 | owner / key / generation | 谁的身份、key 冲突域、generation 的含义（并发控制令牌 vs 注册序号） |
| 4 | 生命周期与 disposer | disposer 是否幂等、stale disposer 的行为、谁负责清理 |
| 5 | 失败语义 | 抛 typed error / 返回 `ok:false` / 静默 no-op，三者只能取一种并统一 |
| 6 | 冲突规则 | 重复 key 抛错 / latest-wins / 拒绝已注册，三者只能取一种并统一 |
| 7 | 组合语义 | 多 owner 并存时的顺序、reducer、containment |
| 8 | 幂等与重试 | 是否幂等、是否允许自动 retry、retry 归属 attempt 还是 execution |
| 9 | availability 形状 | 该 idiom 如何表达不可用与降级 |

## 4. 三个正交维度

idiom 与以下两个维度**正交**，idiom 契约不得泄漏它们的组织方式：

| 维度 | 问题 | 权威 |
|---|---|---|
| 实现通道（官方直通 / 门面转译 / upstream proposal / 已登记替换） | 这个能力**怎么来的** | `../capability-strategy.md` |
| namespace / 心智模型 | 这个能力**在哪找** | `../public-api-shape.md` |
| **API idiom** | 这个 API **怎么用** | 本目录 |

同一 idiom 可以横跨多个 namespace 和多种实现通道；同一 namespace 内部可以同时存在多个 idiom。这是当前仓库的既成事实（`prompts.provenance` 一个 namespace 内就有 contribution、projection、policy 三套套路），也是 registry 必须下沉到 member 级的直接原因。

## 5. 与语义三面的关系

`../api-shape.md` 的三面（projection / policy registry / durable mutation）继续作为**语义权威**保留。idiom 是**交互权威**。二者关系：

- 三面中的 projection、policy、durable mutation 分别对应 idiom 目录中的 projection、policy、mutation 三组的主要来源；
- **operation 在三面中没有对应项**，是 idiom 维度新增的第四组；
- **contribution 必须从 mutation 中分出**：两者在可逆性、写入物的领域事实地位、失败语义和 generation 含义上不同，共用一套契约会使契约稀薄到无约束力（证据见 [`idiom-catalogue.md`](idiom-catalogue.md) §5）；
- **resource/capability registry 必须从 policy 中分出**：两者的区别不是“注册了什么”，而是“注册完谁调用谁”。

## 6. 分组的验证义务

一个 idiom 进入 [`idiom-catalogue.md`](idiom-catalogue.md) 需要两类验证，**二者当前状态不同，不得混为一谈**：

### A. 分组验证（本目录成文时已完成）

1. 至少三个真实公共成员作为样本，且证据落到**叶子成员**与实现位置；
2. 九条契约条目中每一条都已判定“统一值”或“已知例外”，例外登记到具体成员；
3. 已说明该 idiom 与其余 idiom 的差异，且差异可以用不含领域名词的语言表述。

### B. 登记落地（M8 实施的交付物，尚未完成）

4. 每个样本的成员级登记（入口、返回值、失败、冲突、生命周期、idiom）已在公共契约 registry 中落盘，并通过 [`member-contract-registry.md`](member-contract-registry.md) §5 的一致性校验。

### 由两类验证的区分直接得出的表述纪律

- 本目录的 idiom 分组是**按 A 确认的 M8 目标分组**，不是“已实现”或“已验收”的结论。
- 在 B 完成前，不得把任一 idiom 描述为“已在 registry 中落地”“当前 API 已提供该契约”或“已验证的现行能力”。
- 不满足 A 的分组不得进入 [`idiom-catalogue.md`](idiom-catalogue.md)；本目录不留未决条目，也不引用临时研究文档。
