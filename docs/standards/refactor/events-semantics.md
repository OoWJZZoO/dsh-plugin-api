# 事件语义（未来目标）

> 总则见 [`api-idiom.md`](api-idiom.md)；八个标准形状见 [`idiom-catalogue.md`](idiom-catalogue.md)；处置对照见 [`api-migration.md`](api-migration.md)。

## 1. 事件机制不是一个 idiom，但也不单列

`events` 面提供的 `catalog / on / once / emit / serial / parallel / bail / waterfall` 历史上被当作一个独立类别。按语义判据重新判定后：

> **事件机制层不单列类别。** 它的成员分别归入三个已有的 idiom；此前用于标记它们的 `event-mechanism` 取值取消。

| 成员 | idiom | 判据 |
|---|---|---|
| `catalog` | selfDescription | 它回答「门面提供哪些事件」，是门面自身能力清单，不是领域视图 |
| `on` / `once` → `observe` | projection | 订阅；identity-bound disposer、幂等 dispose、回调抛错只降级该监听者——projection 契约逐条命中 |
| `emit` / `serial` / `parallel` / `bail` / `waterfall` | operation | 发起一次派发，内部阶段由 bus 主导，返回收敛结果 |

「events 不是一个 idiom」的结论不变，但理由要表述准确：它不是一个 idiom，是因为它**横跨三个 idiom**，合成一类只会得到一句稀薄到无约束力的「可以派发和监听」。

### 1.1 派发型 operation 的两条不适用

归入 operation 后，两条契约条目对派发不适用，需显式登记：

- 第 3 条（owner / key / generation）：一次派发没有 operation identity，也不产生 attempt 层级；
- 第 8 条（幂等与重试）：一次派发不重试。

其余七条照常适用。特别地，`emit` 当前返回 `undefined`，按 operation 契约第 2 条必须改造为判别式结果。

## 2. 事件语义分类轴

事件语义是**事件自己的分类轴**，与 idiom 分类轴正交：同一个事件语义可以被不同 idiom 的成员派发或消费。

| 语义 | 含义 | 挂靠 |
|---|---|---|
| `decision` | 事件携带一个待收敛的决定，监听者返回决定或改写值 | policy 的事件式变体（见 §4） |
| `fact` | 事件记录已发生的领域事实，不可撤销 | 由 mutation 的写入方派发；监听者属 projection |
| `observation` | 事件是诊断/观测信号，丢失不影响正确性 | projection |
| `notification` | 事件只是告知，不携带决定也不构成事实 | 单独标记，不构成 idiom |

每个事件成员必须额外登记其事件语义分类。

## 3. 生产权约束

- **订阅权与生产权分离**：`observe` 是 additive consumer 面；canonical system event 的 `emit / serial / parallel / bail / waterfall` 只授予该事件的 producer authority（`../composition-and-authority.md` §8）。
- 第三方自定义事件应当通过 owner-scoped `events.define` 取得能力受限的 publisher handle，而不是依赖一个可派发任意系统事件名的全局入口。
- **当前事实**：`events` 面当前没有 owner-scoped `define` / publisher handle，因此第三方自定义事件目前没有受支持的派发入口。本目录要求补齐该入口；在补齐前不得把它描述为已有能力。

## 4. decision 语义的事件归入 policy

以事件瀑布形式做决策的能力（监听事件、返回决定）不是独立历史形态，归入 **policy 的事件式变体**。

理由：同一 idiom 内不能并存两套冲突规则与两套失败语义。若保留「事件瀑布决策」作为独立形态，policy 的冲突规则契约就会有名无实。

该变体必须在标准形状之外补齐三件事：

1. **决策的优先顺序**：不得由监听注册顺序隐式决定；
2. **冲突时的收敛规则**；
3. **监听者抛错时的 containment 与默认决定**。

补齐后，事件式 policy 与 `register` 形式的策略共享同一外层失败和冲突契约：决策失败返回该策略点定义的默认决定并隔离监听者；注册冲突仍按 policy 的 typed registration error 处理（同 owner 同 id latest-wins、跨 owner 拒绝）。事件派发本身仍是 operation outcome，不得把监听者异常直接抛穿。
