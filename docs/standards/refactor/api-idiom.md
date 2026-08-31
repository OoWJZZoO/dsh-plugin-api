# API idiom 总则（未来目标）

> 本文规定「一个 API 属于哪一类」的判据，以及「归属确定后它必须长成什么样」。
> 目录：[`idiom-catalogue.md`](idiom-catalogue.md)（八个 idiom 的标准形状）、[`api-migration.md`](api-migration.md)（现状处置对照）、[`events-semantics.md`](events-semantics.md)（事件）、[`member-contract-registry.md`](member-contract-registry.md)（登记规则）。

## 1. 什么是 idiom

**API idiom** = 调用方必须掌握的固定用法套路。它不是本体分类（这个 API 与领域状态是什么关系），而是语用分类（调用方跟这类 API 打交道时要装哪一套套路）。

> 判据：**如果两个 API 要求调用方遵循的套路相同，它们就是同一类；套路不同就该分开。与它们在领域逻辑上谁包含谁、现在叫什么、由哪个包实现，都无关。**

因此逻辑上的「包含」不构成并列障碍：一次 operation 在实现上可能内部调用 policy 链并落一次 commit，但调用方视角下它与两者是不同套路，可以并列。类比 HTTP 方法：分类轴是「这次交互的契约是什么」，不是「这次操作的效果是什么」。

## 2. 判定的唯一依据：语义

判定归属时只问：

> **按这个能力的语义，调用方跟它打交道时，脑子里要装哪一套套路？**

明确**不**作为判据的：

| 不得作为判据 | 为什么 |
|---|---|
| 它现在的形状 | 现状是实现的结果，正是本轮要纠正的对象 |
| 它现在的名字 | 名字由分类决定，不是分类由名字决定 |
| 它由哪个官方包 / 哪个 feature 实现 | 实现通道是正交维度 |
| 它属于哪个 namespace | namespace 是正交维度 |
| 它在领域上「是读还是写」 | 领域读写与交互套路是两个轴；一次「读取」可能是 operation，一次「写入」可能是 contribution |
| 它已经交付 / 已有测试 | 纯本地开发阶段不构成约束（`AGENTS.md` §3.0.1） |

### 2.1 由语义判据直接得出的结论

一个成员的归属可能与其现状归类不同。下表是几个已经判定的典型，完整处置见 [`api-migration.md`](api-migration.md)：

| 成员 | 现状归类 | 语义判据 | 正确归属 |
|---|---|---|---|
| `sessions.branches.graph / plan / preview` | mutation | 它们不写任何东西，只是把已提交事实折叠成冻结视图 | projection |
| `sessions.channels.open / heartbeat / revoke` | operation | 签发 channel 世代、TTL 续期、撤销后不可复活——这是租约的全部语义 | coordination |
| `tasks.claim / reassign` | operation | `reassign` 携带 expected proof 调 takeover，`claim` 写入 fencing token——这是抢占与世代 | coordination |
| `agents.register` | operation | 它登记一个 agent 实现供系统按 id 查用，与同 namespace 的 `providers.*` 同类 | resourceRegistry |
| `profiles.snapshot.validate` | mutation | 它返回带进度订阅与终态的句柄，是发起一次求值 | operation |
| `security.egress.check` | policy 求值面 | 策略注册后不自动生效，才需要一个「你自己来问」的入口——这是能力缺口，不是一类 API | 删除 + 能力缺口登记 |

## 3. 分类决定形状

归属一旦确定，成员必须采用所属 idiom 的**标准形状**。标准形状包括：

1. **入口动词**（见各 idiom 的命名词表）；
2. **返回值与 handle 的成员名**；
3. **判别式结果的字段名**；
4. **失败方式**（抛 typed error / 返回判别式 / 静默 no-op，三选一，由 idiom 统一）；
5. **冲突规则**（拒绝 / latest-wins / CAS，三选一，由 idiom 统一）；
6. **生命周期与 disposer 行为**；
7. **新鲜度 / 世代字段的语义**。

**领域习惯不得对抗标准形状。** 一个领域历史上用 `open`，不构成在 coordination idiom 中保留 `open` 的理由；同理 `claim`、`revoke`、`watch`、`on/once`、`entries` 等都由所属 idiom 的词表统一。

### 3.1 允许的差异

跨领域同构的**唯一**允许差异是领域数据的类型：

- spec 里的领域字段（`channels` 的 `ttlMs`、`tools` 的 `parameters`）；
- 视图里的领域字段（`sessions` 的 `transcript`、`executions` 的 `attempts`）。

除领域数据类型外，动词名、handle 成员名、结果判别字段名、失败方式、冲突规则一律不得因领域而异。

## 4. 跨领域同构

同一 idiom 的成员应当接近同构。目标是：调用方在一个领域学会套路后，能直接在另一个领域复用，**不需要重读文档**。

同构的具体要求由 [`idiom-catalogue.md`](idiom-catalogue.md) 每个 idiom 的「同构要求」小节给出。共同部分：

| 概念 | 统一名 | 禁止的等价名 |
|---|---|---|
| 判别式结果成功标志 | `ok`（布尔） | `success`、`result`、`status`（作成功标志时） |
| 判别式结果原因码 | `code`（字符串，稳定词表） | `reason`（作机器码时）、`errorCode`、`kind` |
| 人类可读说明 | `reason`（字符串） | `message`（面向调用方的说明） |
| 身份 | `id` | `key`、`name`（作身份时） |
| owner | `ownerId` | `owner`、`ownerIdentity`、`ownerName` |
| 并发控制令牌 | `generation` | `revision`、`version`、`channelGeneration`、`leaseGeneration`（作 fencing 时） |
| 注册序号（非并发控制） | `seq` | `generation`（作序号时）、`index` |
| 观察时刻 | `observedAt` | `at`、`timestamp` |
| 新鲜度（只用于判新） | `epoch` | `generation`、`revision`（作新鲜度时） |
| 句柄销毁 | `dispose()` | `close()`（在 handle 上）、`remove()`、`unsubscribe()`（在 handle 上）、`revoke()`（在 handle 上）。例外：coordination 的租约句柄不提供 `dispose()`，其归还是入口动词 `release(handle)`（见 [`idiom-catalogue.md`](idiom-catalogue.md) §7） |

`generation` 与 `seq` 的区分是硬性的：**`generation` 只能是并发控制令牌（可比较、用于 CAS/fencing），`seq` 只能是注册序号（只作身份）。** 把注册序号命名为 `generation` 会让契约第 3 条（owner/key/generation）失去约束力。

## 5. 形状不合时的处置顺序

当一个成员的现状与其 idiom 的标准形状冲突时，按以下顺序选择处置。**不得跳过靠前的选项直接采用靠后的选项**，除非靠前选项被明确记录为不适用。

### 处置 1：对齐

纯包装即可，不动能力边界：

- 改返回值形状（例如裸 disposer → handle 对象）；
- 改命名（动词、字段名）；
- 补 owner 派生（从调用方 context 派生，不接受调用方自报）；
- 补冻结、补 typed error、补 typed no-op。

### 处置 2：重构

需要动能力边界，但能力仍归门面：

- **拆分混合成员**：一个成员横跨两套套路时，拆成两个成员各归各的 idiom（例：`tools.restrict(filter)` 是决策 → 拆为 `tools.restrict.register(spec)` 归 policy；`sessions.channels` 拆为 coordination + projection + policy + resourceRegistry 四组）；
- **合并重复入口**：同一能力两个入口时合并（例：`settings.installSettingsSection` 并入 `settings.register`）；
- **拆散不对称命名**：`on` / `once` 这种不对称对改为 `observe` + 对称变体。

### 处置 3：迁移

能力不属于门面，或门面给不出正确的语义保证：

- **降级为 `services.*` 直通**：该能力是官方工具箱的一部分，门面不该给它一等领域语义（例：`llm.createUserMessage` / `contentHasImage` / `BlockAssembler`、`executions.recovery.adapters.*`、`recovery.classify`）；
- **退为内部机制**：只服务于门面内部流程，不该出现在公共面（例：错误适配、输入归一化）。

### 处置 4：删除

- 重复入口（已有一等领域 API 覆盖）；
- 内部转换泄漏为公共入口；
- **反直觉的咨询式入口**（见 §5.1）。

### 处置 5：登记为能力缺口

语义上该能力正确、但门面在当前实现通道下无法兑现约定时，**规范侧仍然给出确定的结论**，只把兑现手段排除在规范之外。

能力缺口的登记内容是：

1. 该成员按语义属于哪个 idiom；
2. 该 idiom 的哪一条契约当前无法兑现；
3. 兑现需要什么性质的能力迁移（例如「需要在官方出站路径上获得决策点」）。

**规范不登记、也不暗示由哪个官方组件包承载该能力迁移。** 归属包的判定是实施期决策，受 `../capability-strategy.md` 约束。

### 5.1 咨询式入口一律删除

特别列出这一条，因为它最容易被误当成一类 API：

> 若某类「注册」按语义是声明（声明后由系统消费），但系统实际不在任何决策点回调它，因而需要调用方自己来询问或自己来执行——那么**不得**为此提供咨询式入口。

咨询式入口的存在本身就是能力缺口的证据，正确处置是：删除入口 + 按处置 5 登记缺口。当前已知的此类成员见 [`idiom-catalogue.md`](idiom-catalogue.md) §2 的「能力缺口」与 [`api-migration.md`](api-migration.md)。

## 6. passthrough 只保留 `services.*`

严格意义上 passthrough 不是一个 idiom——它共享的恰恰是「**不共享**」：其契约即官方契约，门面不附加任何套路。

**处置：不为 passthrough 设计 idiom 或公共交互契约；passthrough 类别只保留 `services.*` 一项。**

- `services.*` 的定位、分级与白名单纪律见 `../capability-strategy.md` §6。
- 除 `services.*` 外，门面公共面上的任何成员都必须归入某个 idiom。历史上被标为 passthrough 的其余成员（prompt 装配面、tools 面、官方 namespace leaf 等）按 §5 的处置顺序处置，完整清单见 [`api-migration.md`](api-migration.md)。
- 绕过门面直连官方内部包是 **unsupported escape hatch**，与受控的 `services.*` 直通是两个概念，不适用本节。

## 7. 契约条目

每个 idiom 的标准形状应当覆盖以下九条；不适用者写明「不适用」并说明理由：

| # | 条目 | 说明 |
|---|---|---|
| 1 | 入口形状 | 动词、参数归类、同步/异步 |
| 2 | 返回值与句柄 | 判别式结果 / 冻结视图 / handle / 裸值；handle 携带哪些成员 |
| 3 | owner / key / generation | 谁的身份、key 冲突域、generation 的含义 |
| 4 | 生命周期与 disposer | disposer 是否幂等、stale disposer 的行为、谁负责清理 |
| 5 | 失败语义 | 抛 typed error / 返回判别式 / 静默 no-op，三者只能取一种并统一 |
| 6 | 冲突规则 | 拒绝 / latest-wins / CAS，三者只能取一种并统一 |
| 7 | 组合语义 | 多 owner 并存时的顺序、reducer、containment |
| 8 | 幂等与重试 | 是否幂等、retry 归属 attempt 还是 execution |
| 9 | availability 形状 | 该 idiom 如何表达不可用与降级 |

第 5 与第 6 条是全仓库统一性的关键：同一 idiom 内所有成员的这两项必须取到同一个值，例外必须登记到具体成员。

## 8. 一个成员只有一个主 idiom

一个成员只登记**一个主 idiom**；确实横跨两套套路的成员登记主 idiom，并在 `idiomExceptions` 中写明第二套路。不允许双主 idiom——那会使一致性校验失去意义。

横跨两套套路的成员应当优先按处置 2 拆分，而不是长期以「混合成员」形态存在。例外需要说明理由。
