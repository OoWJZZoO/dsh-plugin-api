# 成员级契约登记规则（M8）

> 本文是 M8 公共 API 语义重构的目标规范，不是当前仓库现状。
> 关联：[`api-idiom.md`](api-idiom.md)（分组方法）、[`idiom-catalogue.md`](idiom-catalogue.md)（idiom 目录）、[`events-and-passthrough.md`](events-and-passthrough.md)（边界）。

## 1. 为什么必须下沉到 member 级

当前公共契约 registry 的 33 个成员条目**绝大多数是 namespace 级**。典型证据：

- `sessions` 一条的 `inventorySource` 自陈为 `base+durable+branches+channels`，内部至少混了四套套路：`get/list/on/once` 是 projection，`appendMessage` 是 mutation，`channels.auth.registerVerifier` 是 policy，`channels.redaction.registerProfile` 是 resource registry。
- 只有极少数是叶子级（`llm.requestTransforms`、`llm.admissionPolicies`）。
- `effect` 词表（`read / subscribe / register / decide / mutate / execute`）是 namespace 级粗标：`sessions` 整条标 `execute`，尽管它主要成员是读。

**结论：要做到“每个公共成员属于且仅属于一个 idiom”，registry 登记粒度必须从 namespace 下沉到 member。这不是分类工作的副产品，是它的前置条件。**

## 2. 登记粒度规则

1. registry 的登记单位是**可被调用的叶子成员**（函数或取值成员），不是 namespace。
2. namespace 条目只保留导航信息（存在性、capability path、runtime），不再承担 effect / composition / conflictRule 的语义标注。
3. 一个叶子成员登记**一个主 idiom**；确实横跨两套套路的成员登记一个主 idiom 并在 `idiomExceptions` 中说明第二套路。
4. passthrough 成员登记 `idiom: "passthrough"`，表示 idiom 契约不适用（见 [`events-and-passthrough.md`](events-and-passthrough.md) §3）。
5. 事件机制成员（`on / once / emit / serial / parallel / bail / waterfall`）登记 `idiom: "event-mechanism"` 并额外登记事件语义分类（`decision | fact | observation | notification`）。

## 3. 必登字段

每个叶子成员应当登记：

```text
publicPath          # 叶子级公共 dot path
idiom               # projection | policy | mutation | operation |
                    # contribution | resourceRegistry | coordination |
                    # selfDescription | event-mechanism | passthrough
idiomExceptions     # 存在的第二套路与处理方式（无则空）
semanticFace        # projection | policy | durableMutation（语义三面，可为空）
effect              # read | subscribe | register | decide | mutate | execute
composition         # pure | additive | ordered | coordinated | exclusive
runtime             # host | client | both
implementationChannel  # facade | passthrough | proposal | replacement
authority           # 该成员的 state owner
scope               # profile | workspace | session | facade | 领域自定义
resourceKey         # 冲突判定的 key
identitySource      # owner / id / generation 从哪里来
conflictRule        # 拒绝 | latest-wins | CAS/fencing | 不适用
lifecycle           # 生命周期与 disposer 行为
failureSemantics    # typed-throw | discriminated-result | silent-no-op
idempotency         # 幂等 / 不幂等 / 终态幂等
retryLayer          # attempt | operation | 不适用
availabilityShape   # 该成员如何表达不可用（含 availability() 返回字段名）
bypasses            # 是否绕过其它高层 authority
status              # removed | disabled | advanced | recommended
```

`failureSemantics` 与 `conflictRule` 是全仓库统一性的关键：M8 验收时，同一 idiom 内所有成员的这两项必须取到同一个值，例外必须登记到具体成员。

## 4. effect 词表的修正

当前 `effect` 词表不足以表达调用套路，有两处必须修正：

1. **`register` 一项同时装了 policy 与 resource registry 两类**，区分不出“注册完谁调用谁”。M8 应当不再用 `effect` 承担这个区分——区分由 `idiom` 字段承担，`effect` 只描述该成员的动作类型。
2. **`execute` 词表项目前空置**：标注为 `execute` 的三条是 `agents` / `sessions` / `services`，其中 `sessions` 是 namespace 级粗标、`services` 是 passthrough 误标。operation idiom 的真实成员（`tasks.*`、`agents.create/resume`、`sessions.channels.open`）没有被标出来。

修正方向：`effect` 保留为动作类型枚举，`idiom` 承担套路分类，二者不得互相替代。

## 5. 一致性校验

registry 应当提供（或由测试提供）以下机械校验，任一不通过即为契约缺陷：

1. 每个叶子成员都有 `idiom` 且取值在枚举内。
2. 同一 `idiom` 内所有成员的 `failureSemantics` 与 `conflictRule` 一致，或该成员已在 `idiomExceptions` 中登记例外。
3. 标为 `passthrough` 的成员不声明 `conflictRule` / `idempotency` / `retryLayer`（门面不附加契约）。
4. 每个公共 namespace 都有 `availability()` 成员，且其返回形状含 `status` 字段。
5. `capabilities.get(path)` 对 registry 中每个 capability path 都返回 `active | degraded | unavailable` 之一。
6. registry 的叶子成员集合与 `HostPluginApi` / `ClientPluginApi` 类型、active/disabled surface 快照一致。

## 6. 与生成物的关系

registry 继续作为单一事实源，可生成或验证：`HostPluginApi` / `ClientPluginApi` 类型、capability/claim 类型、API reference、active/disabled surface snapshot、多插件组合测试矩阵，以及本目录要求的 idiom 一致性报告。

运行时实现可以继续手写；公共结构不得在多个构造器、测试和文档中各自维护一份。
