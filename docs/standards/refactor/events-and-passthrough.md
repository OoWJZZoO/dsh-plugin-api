# 事件与 passthrough 边界（M8）

> 本文是 M8 公共 API 语义重构的目标规范，不是当前仓库现状。
> 关联：[`api-idiom.md`](api-idiom.md)（分组方法）、[`idiom-catalogue.md`](idiom-catalogue.md)（八个 idiom）。

## 1. 事件机制不是一个 idiom

`events` 面提供的 `on / once / emit / serial / parallel / bail / waterfall` 是**调用机制**，不是一套统一的用法套路：`emit`、`bail`、`waterfall` 三者要求调用方掌握的东西互不相同，把它们合成一个 idiom 只会得到一句稀薄到无约束力的“可以派发和监听”。

**因此：不为事件机制单设 idiom。**

M8 对事件面的处理应当分两层：

1. **机制层**继续由 `events` 面提供，并在公共契约 registry 中按机制成员逐个登记（每个机制成员单独登记其返回值、失败语义与 producer authority 要求），不套用任一 idiom 的契约。
2. **语义层**按事件本身的语义分类，决定它承载的是哪一种 idiom 语义：

| 事件语义 | 含义 | 挂靠位置 |
|---|---|---|
| decision | 事件携带一个待收敛的决定，监听者返回决定/改写值 | policy idiom 的事件式变体（瀑布/ bail） |
| fact | 事件记录已发生的领域事实，不可撤销 | 由 mutation idiom 的写入方派发，监听者属 projection idiom |
| observation | 事件是诊断/观测信号，丢失不影响正确性 | projection idiom |
| notification | 事件只是告知，不携带决定也不构成事实 | 单独标记，不构成 idiom |

事件语义分类是**事件面自己的分类轴**，与 idiom 分类轴正交：同一个事件语义可以被不同 idiom 的成员派发或消费。

## 2. 事件成员必须登记的生产权约束

- 订阅权与生产权分离：`on/once` 是 additive consumer 面；canonical system event 的 `emit/serial/parallel/bail/waterfall` 只授予该事件的 producer authority（`../composition-and-authority.md` §8）。
- 第三方自定义事件应当通过 owner-scoped `events.define` 取得能力受限的 publisher handle，而不是依赖一个可派发任意系统事件名的全局入口。
- **当前事实**：`events` 面当前只提供 `catalog / on / once / emit / serial / parallel / bail / waterfall`（`lib/plugin-api-service.js:89-104`），**没有 owner-scoped `define` / publisher handle**。因此第三方自定义事件目前没有受支持的派发入口。M8 应当补齐该入口，并在补齐前不得把它描述为已有能力。

## 3. Passthrough 不建 idiom

严格意义上 passthrough 不是一个 idiom——它共享的恰恰是“**不共享**”：其契约就是官方契约，门面不附加任何套路。

**处置：不为 passthrough 单设 idiom，也不为其设计公共交互契约。** 只在第三方文档中注明：“这类成员共享的是不共享：其契约即官方契约，门面不包装、不校验、不改写错误。”

### 3.1 判定与边界

一个成员属于 passthrough 当且仅当它同时满足：

1. 直接转发到官方 service 或官方公开包导出，参数与 receiver 完全一致；
2. 门面不做校验、不缓存、不包装返回值；
3. 官方错误原样传播；
4. 官方 disposer 原样返回。

当前正面样本：

- `prompts.section / context / variable / tools / suppressRuntimeContext`：同参转发官方 `systemPrompt` 服务并返回**精确的官方 disposer**，不做任何包装，官方错误原样传播（`lib/system-prompt.js:1-69`）。
- `tools.register / restrict / guard / get / schemas / execute / presentAs / executionMode`：转发官方 tools service（`lib/plugin-api-service.js:189-233`）。
- `services.*` 静态白名单成员（`../capability-strategy.md` §6）。

### 3.2 passthrough 与 idiom 的关系

- passthrough 成员**不登记 idiom**，在 registry 中以 `idiom: "passthrough"` 标记，表示“不适用 idiom 契约”。
- 不得为了让 passthrough 成员“看起来统一”而给它套上某个 idiom 的形状；那会同时破坏官方契约与 idiom 契约。
- 绕过门面直连官方内部包是 **unsupported escape hatch**，与经 `services.*` 的受控 passthrough 是两个不同概念（`../capability-strategy.md` §6）。

## 4. 由事件语义派生的已知问题

- 压缩事件词汇与会话标题候选资格在当前实现中是**事件瀑布式决策**：第三方通过监听事件返回决定，而不是通过 `register` 注册策略。它们与 policy idiom 的“注册 + 系统回调”不是同一套路。
- **处置：归入 policy idiom 的事件式变体，不保留“独立历史形态”作为长期形态。** 理由是同一 idiom 内不能并存两套冲突规则与两套失败语义；若保留独立形态，policy idiom 的冲突规则契约就会有名无实。M8 应当在该变体中补齐三件事：决策的优先顺序（不得由监听注册顺序隐式决定）、冲突时的收敛规则、以及监听者抛错时的 containment 与默认决定。
