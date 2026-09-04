# 公共 API idiom 标准

> 适用范围：所有门面 host/client 公共叶子成员、公开 handle 与事件面。
> 关联：namespace 放置见 `public-api-shape.md`；语义三面见 `api-shape.md`；组合和 authority 见 `composition-and-authority.md`；身份、生命周期和并发见 `identity-and-lifecycle.md` 与 `concurrency-and-cancellation.md`；能力来源与 `services.*` 例外见 `capability-strategy.md`。

## 1. 分类原则与登记边界

**API idiom** 是调用方必须掌握的固定交互套路。成员按语义分类：调用方与它交互时需要遵循相同套路的成员属于同一 idiom；现有名字、实现包、namespace、领域读写属性和历史交付状态都不是分类依据。

除 `services.*` 外，每个公共叶子成员必须有且仅有一个主 idiom。namespace 只提供 bounded-context 导航，不能替成员承担语义标注；公开 handle 上的成员也必须按实际 dot path 单独登记。一个成员确实横跨两套套路时，应先拆为各自 idiom 的成员；不能拆时，registry 必须记录唯一主 idiom 和六项例外：`memberPath`、`baseContract`、`exception`、`reason`、`replacementShape`、`verification`。

现行逐成员事实、host/client runtime、能力路径、组合模式、authority、可用性、旧路径状态和 `services.*` 白名单均以 [public-contract.registry.json](../specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json) 为唯一事实源。本册规定成员应满足的公共契约，不复制 registry 的逐叶子清单。

公共成员只使用下列八类 idiom：

| Idiom | 调用方心智动作 | 系统主导方 |
|---|---|---|
| `projection` | 取得或订阅冻结视图 | 调用方读取 |
| `policy` | 声明纯决策，由系统在决策点回调 | 系统调用策略 |
| `mutation` | 写入持久或半持久事实 | 调用方提交写入 |
| `operation` | 发起动作并等待确定终态 | authority 主导内部阶段 |
| `contribution` | 向装配器投入可撤销内容 | 装配器消费 |
| `resourceRegistry` | 登记数据或实现供系统按键使用 | 系统消费登记项 |
| `coordination` | 获得、续期、归还或抢占受控资源 | 租约与 fencing 规则 |
| `selfDescription` | 查询门面自身状态和能力 | 门面 |

`services.*` 是唯一 passthrough exception：其语义和兼容保证由官方契约及审计白名单决定，不套用八类 idiom；任何非 `services.` 路径不得标为 passthrough exception。直接 import 官方内部包仍是 unsupported escape hatch，不是 `services.*`。

## 2. 共用词汇和外层契约

- 判别式结果统一使用 `ok: boolean`、稳定机器码 `code` 与面向人类的 `reason`；`status` 不作成功标志。
- `id` 是资源身份，`ownerId` 是派生的 owner 身份。调用方不得伪造 owner。
- `generation` 仅表示可比较的并发控制令牌；注册顺序使用 `seq`；只用于判新的后端或装配代次使用 `epoch`。三者不得互换。
- 需要销毁的普通 handle 使用幂等 `dispose()`；stale disposer 只能返回其 idiom 规定的 no-op 或结果，绝不能撤销新 generation 或其他 owner 的资源。coordination lease 是例外，归还只能通过 `release(handle)`。
- `terminal` 统一使用 `success | error | aborted | denied | superseded`。timeout 归入 `error` 并由原因字段标记；mutation 使用 `commitState` 承载其终态，资源生命周期使用 `lifecycleState`，不得混用字段语义。
- 每个公共 namespace 提供无副作用的 `availability()`，返回冻结对象且至少含 `status: active | degraded | unavailable`。能力存在性由根 `capabilities.*` 表达；能力矩阵使用 `capabilityMatrix()`，不得占用 `availability` 名称。
- 同一 idiom 的外层失败呈现、冲突结果、handle 名称与生命周期语义必须一致。领域参数、reducer 和并发选择只能在显式领域字段中变化，不能另造外层合同。

## 3. 八类标准形状

### 3.1 `projection`

用于冻结视图与订阅。查询使用 `get`、`list`、`inspect`、`history` 或 `current`；订阅统一使用 `observe`，不以 `on`、`once`、`watch`、`subscribe` 或 `onChange` 作为公开入口。

- 查询返回冻结只读视图；缺位或降级返回降级视图或 typed unavailable result，不抛穿调用方。
- `observe` 返回 `{ current(), subscribe(listener), dispose(), epoch }`。回调异常只降级该监听者；dispose 后不再回调且不影响其他订阅者。
- 查询天然幂等；订阅是 additive 或 pure，不以订阅注册顺序表达业务语义。

### 3.2 `policy`

用于声明在明确决策点由系统调用的纯决策。入口为 `register(spec)`；`spec` 明确含 `id`、`priority` 与 `decide(context)`。

- handle 固定为 `{ id, ownerId, generation, dispose() }`；owner 由调用上下文派生。
- 同 owner 同 id 采用 latest-wins，跨 owner 同 id 抛 typed conflict；注册错误以 typed error 表达，不返回 `ok:false` 或静默 no-op。
- priority 词表固定为 `lowest | low | normal | high | highest | monitor`，同 priority 按成功注册顺序；领域 reducer 负责收敛策略结果并隔离策略回调错误。
- 注册必须自动生效。没有系统决策点的策略不得暴露让调用方自行咨询的入口；应在 registry 记录不可用能力及所需决策点性质。

### 3.3 `mutation`

用于写入不可逆领域事实。单步写入使用领域动词；事务中的事实写入使用 `record(op)`，并由 operation 的 `prepare`、`commit`、`rollback` 驱动。

- 业务结果返回冻结 `{ ok, code, commitState, generation, ... }`；公共契约破坏和不可恢复编程错误才抛 typed error。
- 已提交事实不提供 disposer；补偿必须是显式领域操作，例如 `restore`。
- 同资源写入使用 CAS/fencing 或等价 authority；终态重试返回既有终态并表明幂等性。

### 3.4 `operation`

用于发起由 authority 主导内部过程的动作。入口使用领域动词，接收 `options.signal` 时必须保留上游取消语义。

- 结果形状为 `{ ok, code, operation, terminal, ... }`；长操作 handle 固定为 `{ id, ownerId, status(), observe(), dispose() }`。事务 handle 可附加 `record`、`preview`、`commit` 与 `rollback`。
- `dispose()` 只请求停止，正确性依赖提交资格与 generation guard。内部 retry 只增加 attempt，不创建新 operation；外部重发始终创建新 operation。
- 冲突统一返回确定 outcome。领域只可声明 `exclusive`、`latest-wins`、`queue`、`compare-and-swap` 或 `deduplicate` 等并发策略，不能改变外层结果形状。

### 3.5 `contribution`

用于把可撤销内容交给装配器，且不产生领域事实。入口为 `contribute(spec)`，返回判别式结果与 `{ id, ownerId, seq, dispose() }` handle。

- 同 owner 同 id 冲突返回稳定码；不使用 latest-wins，不使用 generation。
- 系统可在明确容量上界驱逐贡献，但必须可观测；异步生效的 contribution 必须在完成前提供可安全 dispose 的 pending handle。
- 与 mutation 的分界是可逆、不写领域历史且不使用并发控制令牌；与 registry 的分界是内容由装配器统一消费，而非按 key 独立取用。

### 3.6 `resourceRegistry`

用于登记由系统按键消费的数据或实现。入口为 `register(spec)`；查询面使用 `get` 与 `list`。

- handle 固定为 `{ id, ownerId, generation, dispose() }`，与 policy handle 同构。
- 同 owner、同 id、同内容的重复登记幂等返回既有条目；同 owner、同 id、不同内容抛 typed conflict；跨 owner 冲突抛 owner-conflict。
- 资源登记不等于策略：系统调用登记项的动作但不取得决定时，仍属 registry；只有在决策点取得决定的纯回调属于 policy。

### 3.7 `coordination`

用于租约、占用、抢占与条件写。公开动词固定为 `acquire`、`heartbeat`、`release`、`takeover`、`compareAndSet`、`observe` 与 `availability`，且状态变更入口全部异步。

- 状态变更返回 `{ ok, code, operation, observedAt, ... }`；lease handle 固定含 `{ id, resource, generation, fencingToken, expiresAt }`，不是 disposer handle。
- `generation` 是 fencing 令牌。`takeover` 必须带 expected proof，并记录跨 owner 抢占的 reason 与 provenance。
- 失败不抛穿：使用 `inactive`、`invalid-input`、`conflict`、`unavailable`、`unsupported` 等稳定码。`release` 幂等；过期或 stale handle 的 heartbeat 返回 typed result。
- `availability(scope)` 必须说明 durability、支持的 operations、backend 与 epoch；宿主不能提供 durable/atomic 语义时，只能诚实降级并报告。

### 3.8 `selfDescription`

用于查询门面自身的版本、能力与当前状态。根面包含 `isActive`、`apiVersion`、`assertCompatible` 与 `capabilities.get/list/require`；namespace 面使用 `availability()`。

- `availability()` 永不抛错，返回冻结状态；`capabilities.require` 在 capability 不可用时抛 capability-unavailable typed error。
- 此 idiom 无 owner、冲突或 disposer，调用应为 pure、幂等且无副作用。
- `events.catalog()` 属 selfDescription：它描述门面支持的事件词汇，不是领域投影。

## 4. 事件面

事件机制不是第九种 idiom：`events.catalog()` 属 selfDescription，`events.observe` 属 projection，`emit`、`serial`、`parallel`、`bail`、`waterfall` 属派发型 operation。派发型 operation 不产生独立 operation identity，也不重试；其余外层 operation 合同仍适用，并必须返回可表达 containment 的判别式结果。

每个事件成员在 registry 中额外登记 `decision`、`fact`、`observation` 或 `notification`：decision 是 policy 的事件式变体；fact 是 mutation 写入后不可撤销的领域事实；observation 是可丢失的诊断信号；notification 只作告知，不构成 idiom。

订阅权不等于生产权。canonical system event 的派发只授予相应 producer authority。第三方自定义事件只能通过 owner-scoped 的 `events.define(spec)` 获取能力受限 publisher，不能依赖全局任意事件派发；事件式 policy 必须明确优先顺序、冲突收敛、监听者故障 containment 与默认决定。

## 5. Registry 与一致性检查

成员 registry 必须至少保存：

```text
publicPath, idiom, idiomExceptions, eventSemantics, semanticFace, effect,
composition, runtime, implementationChannel, authority, scope, resourceKey,
identitySource, conflictRule, lifecycle, failureSemantics, idempotency,
retryLayer, availabilityShape, concurrency, reducer, currentShape,
targetPath, migrationAction
```

验证必须确保：每个公共叶子与 handle 成员已登记；每个成员有八类 idiom 或受限 `services.*` 例外；入口动词、失败/冲突形状和 handle 与所属 idiom 一致；generation/seq/epoch 语义未混用；每个 namespace 有 `availability()`；所有事件登记事件语义；registry、host/client 类型与 active/disabled surface snapshot 的成员集合一致。能力删减、迁移、合并或缺口必须保持能力守恒，并在相应 feature 的迁移账本中留下替代或 gap 证据。
