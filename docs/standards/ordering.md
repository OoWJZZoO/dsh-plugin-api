# 多插件排序标准

> 适用范围：普通事件监听、确实需要串行的 transform/waterfall，以及领域内的策略组合。
> 关联：组合模式和 callback containment 见 `composition-and-authority.md`；各领域的 reducer/fixed stages 边界见 `domain-composition.md`；事件 producer/consumer 权限见 `capability-strategy.md`。

## 1. 普通排序模型

普通事件监听采用简单、开放的固定 priority 模型：固定 priority vocabulary，加上同一 priority 内的成功注册顺序。现行 priority vocabulary：

```text
lowest | low | normal | high | highest | monitor
```

- 同一 priority 按成功注册顺序执行。
- `monitor` 是只读观察约定，不是隔离机制；门面不替插件阻止其副作用。
- 不建设全局 `before/after` 依赖图、跨领域排序图或通用循环检测。
- 真实存在插件依赖时，由具体 feature 文档、插件依赖声明或宿主加载顺序表达。
- A→B 与 B→A 的差异在普通事件监听中可以是插件作者必须承担的顺序后果；不要求所有监听获得顺序无关结果。

插件作者对自己声明的 priority、依赖和顺序后果负责。门面提供确定的调用规则，但不替插件推断业务意图，也不把所有插件强行纳入全局排序系统。

## 2. 领域策略

事件 priority 不是所有语义策略的统一组合算法：

- 需要顺序的串行 transform 或 waterfall 才使用 priority。
- 本质上是合并、筛选或仲裁的 policy 优先使用领域自身的 reducer、固定阶段或无序组合规则。
- 特定领域确实需要额外顺序语义时，在该领域内部定义最小规则，不把它提升为全局排序基础设施。
- 领域 reducer、固定阶段或 ordered pipeline 必须在对应公共契约中声明输入、输出、冲突和 callback 失败行为。

排序模型只解决调用顺序，不替插件证明业务语义正确，也不限制插件在自己的内部状态和流程中自由组织逻辑。

## 3. 与其他组合规则的边界

- `ordered` 表示该成员存在明确的多 owner 顺序合同；它不自动意味着顺序无关，也不授权调用方修改其他 owner 的状态。
- `coordinated` 和 `exclusive` 的资源冲突必须由 authority/claim 处理，不能通过提高 priority 绕过。
- 普通 event consumer 的注册不等于 canonical event producer authority；派发权仍按事件领域契约授予。
- 若某个 feature 的业务正确性必须依赖跨领域全局排序，优先拆解为领域内 reducer/fixed stages，或将该需求作为 upstream proposal；本册不新增全局 dependency graph。
