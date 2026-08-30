# docs/standards/refactor — 公共 API 语义重构规范（M8，未来目标）

> **本目录不是当前仓库的现状标准。**
> `docs/standards/`（本目录的父目录）回答“当前仓库实际上遵守什么、当前公共 API 实际提供什么”；本目录回答“进行 M8 公共 API 语义重构时，公共 API 应当如何组织”。
> 本目录的条文一律是**未来目标**：写成“重构后应当”，不得描述成当前 runtime 已经具备的能力。
> 本目录**不保留**没有结论的“待定规范”。每一项只有形成明确结论后才写入规范正文；未决取舍、候选方向和研究清单不进入本目录，也不引用本目录之外的临时文档。

## 1. M8 要解决什么

当前公共 API 已按业务 bounded context 组织（`../public-api-shape.md`），但第三方仍缺少一层：**门面有几套交互套路、每套套路怎么用**。缺少这层时，调用方面对一个新 namespace 只能逐个读领域文档，无法复用已学到的用法。

M8 的目标：

> 门面给第三方的不只是“有哪些 API”，而是“有几套 idiom、每套怎么用”。第三方学会一个 idiom，就应能在同类 API 上直接复用。

## 2. 分册索引

| 分册 | 领域 | 主要内容 |
|---|---|---|
| [`api-idiom.md`](api-idiom.md) | idiom 总则与分组方法 | 平衡分组的多维判据、组内最大公共交互契约、例外登记、与三面/namespace/实现通道的正交关系 |
| [`idiom-catalogue.md`](idiom-catalogue.md) | idiom 目录 | 八个**已确认的 M8 目标分组** idiom 的公共交互契约、真实成员样本、已知例外、待统一形状清单（成员级 registry 登记尚未完成，见 `api-idiom.md` §6） |
| [`events-and-passthrough.md`](events-and-passthrough.md) | 事件与 passthrough 边界 | 事件机制为何不建为 idiom、事件语义如何归类、passthrough 为何不附加门面套路 |
| [`member-contract-registry.md`](member-contract-registry.md) | 成员级契约登记 | registry 下沉到 member 级的登记字段、idiom 归属规则与一致性校验 |

## 3. 与既有标准的关系

- **与语义三面（`../api-shape.md`）**：三面是语义/本体维度（谁读、谁决定、谁写），idiom 是调用方交互维度。二者**正交**，idiom 不取代三面。
- **与 namespace（`../public-api-shape.md`）**、**实现通道（`../capability-strategy.md`）**：三者是三个独立维度。idiom 不得泄漏 namespace 组织方式或实现通道分类。
- **与组合/authority（`../composition-and-authority.md`）**：composition mode 描述多 owner 并存时的状态影响；idiom 描述单个调用方要掌握的套路。同一个 idiom 可以承载多种 composition mode。
- **与公共契约 registry**：registry 是成员级事实源；本目录定义 idiom 判据与登记规则，不复制成员清单。

## 4. 规范语气

本目录中的“应当”是 M8 重构目标；“必须”表示该条是重构验收的必要条件。任何一条只有在**真实公共成员**上得到样本验证后才写入本目录；未验证的候选不进入规范正文。
