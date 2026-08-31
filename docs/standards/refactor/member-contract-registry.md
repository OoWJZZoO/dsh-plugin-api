# 成员级契约登记规则（未来目标）

> 总则见 [`api-idiom.md`](api-idiom.md)；标准形状见 [`idiom-catalogue.md`](idiom-catalogue.md)；处置对照见 [`api-migration.md`](api-migration.md)。

## 1. 为什么必须下沉到 member 级

「每个公共成员属于且仅属于一个 idiom」只有在叶子级才成立。namespace 级标注必然失真：一个 `sessions` 内部同时存在 projection、mutation、coordination、policy、resourceRegistry 五套套路；`effect` 词表整条标 `execute`，尽管它主要成员是读。

**登记粒度必须从 namespace 下沉到叶子成员。这不是分类工作的副产品，是它的前置条件。**

## 2. 登记粒度规则

1. registry 的登记单位是**可被调用的叶子成员**（函数或取值成员），不是 namespace。
2. namespace 条目只保留导航信息（存在性、capability path、runtime），不再承担语义标注。
3. **handle 上的成员是独立的叶子成员**，按其公开 dot path 单独登记，idiom 可以与其父成员不同。
   - 例：`settings.register` 是 resourceRegistry，其 handle 的 `mutate` 是 mutation、handle 的 `get` 是 projection。
   - handle 成员不登记，则一致性校验无法覆盖门面公共面的相当一部分。
4. 一个叶子成员登记**一个主 idiom**；确实横跨两套套路的成员登记主 idiom 并在 `idiomExceptions` 中说明第二套路，且应当优先按 [`api-idiom.md`](api-idiom.md) §5 处置 2 拆分。不允许双主 idiom。
5. **一个 namespace 的成员可以来自多个 feature。** registry 必须能表达这一点，否则跨 feature 合并的 namespace（如 `llm` = 门面转译面 + 官方 namespace leaf）会漏登半边。

## 3. 必登字段

```text
publicPath             # 叶子级公共 dot path（含 handle 成员）
idiom                  # projection | policy | mutation | operation |
                       # contribution | resourceRegistry | coordination |
                       # selfDescription | passthrough
idiomExceptions        # 第二套路与处理方式（无则空）
eventSemantics         # decision | fact | observation | notification（非事件成员为空）
semanticFace           # projection | policy | durableMutation（语义三面，可为空）
effect                 # read | subscribe | register | decide | mutate | execute
composition            # pure | additive | ordered | coordinated | exclusive
runtime                # host | client | both
implementationChannel  # facade | passthrough | proposal | replacement
authority              # 该成员的 state owner
scope                  # profile | workspace | session | facade | 领域自定义
resourceKey            # 冲突判定的 key
identitySource         # owner / id / generation 从哪里来
conflictRule           # 拒绝 | latest-wins | CAS/fencing | 不适用
lifecycle              # 生命周期与 disposer 行为
failureSemantics       # typed-throw | discriminated-result | silent-no-op
idempotency            # 幂等 / 不幂等 / 终态幂等
retryLayer             # attempt | operation | 不适用
availabilityShape      # 该成员如何表达不可用
bypasses               # 是否绕过其它高层 authority
status                 # removed | disabled | advanced | recommended
```

`failureSemantics` 与 `conflictRule` 是全仓库统一性的关键：同一 idiom 内所有成员的这两项必须取到同一个值，例外必须登记到具体成员。

`idiom` 取 `passthrough` 时，该成员的 `publicPath` 必须位于 `services.` 之下（见 §4 校验 3）。

`effect` 只描述动作类型，**不承担套路区分**——套路区分由 `idiom` 承担，两者不得互相替代。

## 4. 一致性校验

registry 应当提供（或由测试提供）以下机械校验，任一不通过即为契约缺陷：

1. 每个叶子成员都有 `idiom` 且取值在枚举内。
2. 同一 `idiom` 内所有成员的 `failureSemantics` 与 `conflictRule` 一致，或该成员已在 `idiomExceptions` 中登记例外。
3. **标为 `passthrough` 的成员，其 `publicPath` 一律以 `services.` 开头；非 `services.*` 成员不得标 `passthrough`。**
4. **每个 idiom 内所有成员的入口动词都取自该 idiom 的命名词表**（[`idiom-catalogue.md`](idiom-catalogue.md) 各 §命名词表），或已在 `idiomExceptions` 中登记例外。
5. **`generation` 只出现在承担并发控制令牌语义的成员上**；注册序号必须登记为 `seq`，新鲜度必须登记为 `epoch`。三者不得混用。
6. handle 成员已按其 dot path 登记，且其 `idiom` 不因与父成员不同而报错。
7. 每个公共 namespace 都有 `availability()` 成员，且其返回形状含 `status` 字段。
8. `capabilities.get(path)` 对 registry 中每个 capability path 都返回 `active | degraded | unavailable` 之一。
9. 事件成员都登记了 `eventSemantics`。
10. registry 的叶子成员集合与 `HostPluginApi` / `ClientPluginApi` 类型、active/disabled surface 快照一致。

校验 3–6 是本轮新增：它们把 [`api-idiom.md`](api-idiom.md) §3、§4 的「同构」要求变成可机械判定的条件，否则「同构」只是口号。

## 5. 与生成物的关系

registry 继续作为单一事实源，可生成或验证：`HostPluginApi` / `ClientPluginApi` 类型、capability/claim 类型、API reference、active/disabled surface snapshot、多插件组合测试矩阵，以及本目录要求的 idiom 一致性报告。

运行时实现可以继续手写；公共结构不得在多个构造器、测试和文档中各自维护一份。
