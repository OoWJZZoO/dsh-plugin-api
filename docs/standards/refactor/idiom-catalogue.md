# API idiom 目录：八个标准形状（未来目标）

> 本文是 [`api-idiom.md`](api-idiom.md) 的配套规范。每个 idiom 给出**标准形状**——命名词表与结构契约。
> 本文的「领域实例」列出的是**目标形状**，不是现状；现状到目标的处置对照见 [`api-migration.md`](api-migration.md)。
> 通用命名（判别式字段、owner、generation/seq/epoch 的区分）见 [`api-idiom.md`](api-idiom.md) §4，各 idiom 不再重复。

## 0. 目录一览

| # | idiom | 心智动作（不含领域名词） | 主导方 |
|---|---|---|---|
| 1 | projection | 拉取或订阅一份冻结视图 | 调用方拉取 |
| 2 | policy | 你是被回调的纯函数；你返回决定；注册即自动生效 | 系统在决策点回调你 |
| 3 | mutation | 写入不可逆的事实；提交即持久 | 调用方主导写 |
| 4 | operation | 发起一次动作；内部阶段不由你参与 | authority 主导内部阶段 |
| 5 | contribution | 往一个装配里投内容；可撤销、可被驱逐 | 调用方投入，装配器消费 |
| 6 | resourceRegistry | 把数据或实现交给系统；系统消费它 | 系统读你交的东西 |
| 7 | coordination | 借一个资源、占住它、还回去 | 租约 + 世代比较 |
| 8 | selfDescription | 查询的不是领域，而是门面自己 | 门面 |

八个 idiom 之外不存在其他类别（passthrough 只剩 `services.*`，见 [`api-idiom.md`](api-idiom.md) §6；事件机制层不再单列，见 [`events-semantics.md`](events-semantics.md)）。

---

## 1. projection（订阅 / 查询）

**心智动作**：拉取或订阅一份冻结视图；视图缺位或降级时不抛穿调用方。

### 命名词表

| 用途 | 统一名 | 取代 |
|---|---|---|
| 按 id 取一个 | `get(id, options?)` | `read`、`fetch`、`resolve`（查询义） |
| 取集合 | `list(filter?)` | `entries`、`catalog`、`all`、`search`、`query`、`schemas` |
| 检查 / 体检 | `inspect(options?)` | `health`、`describe`、`check`（查询义） |
| 历史 | `history(filter?)` | — |
| 订阅 | `observe(filter?, listener?)` | `on`、`once`、`onChange`、`watch`、`subscribe` |
| 读当前值 | `current()` | — |

### 标准形状

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | 查询同步或异步返回；订阅统一 `observe` |
| 2 | 返回值与句柄 | 查询返回冻结只读视图；订阅返回句柄 `{ current(), subscribe(listener), dispose(), epoch }` |
| 3 | owner / key / generation | 视图不带 owner；只携带 `epoch` 用于判新 |
| 4 | 生命周期与 disposer | `dispose()` 幂等；重复 dispose 是 typed no-op；dispose 后不再收到回调；不影响其他订阅者 |
| 5 | 失败语义 | 视图缺位/降级返回降级视图或 typed unavailable result，**不抛穿**；监听者回调抛错只降级该监听者 |
| 6 | 冲突规则 | 不适用（无写入）；同名订阅互不冲突 |
| 7 | 组合语义 | `additive` 或 `pure`；订阅顺序不是业务语义 |
| 8 | 幂等与重试 | 查询天然幂等；重复注册订阅是不同订阅 |
| 9 | availability | 由 selfDescription 的 `availability()` 表达；判别式结果不内嵌可用性 |

### 同构要求

- 订阅入口一律 `observe`，返回句柄一律 `{ current, subscribe, dispose, epoch }`。**不得**有「返回裸 disposer」「返回 `{ ok, disposer }`」「返回句柄但字段名不同」三种变体。
- `epoch` 语义固定为「后端或装配代次，只用于判新与失效重取，不参与并发控制、不跨后端可比」。各领域不得自造 `generation` / `revision` / `composeGeneration` 承载这一语义。
- 一次性读取不是 `once`，而是 `observe` 句柄上 `subscribe` 的一次性变体。

### 领域实例（目标形状）

- `executions.get / list / history / observe`
- `sessions.get / list / inspect / observe / events / seq / header / requestContext / deriveMessages / surface`
- `sessions.branches.graph / plan / preview`
- `sessions.channels.observe / list`（原 `fetchEvents`）
- `prompts.provenance.compose / inspect / mapping / observe`
- `prompts.render / renderContextSections / renderContextSnapshot / joinContextSections / assemble`
- `attachments.projection.get / open / project`
- `mcp.servers / tools / resolvePublicName / observe`
- `tasks.get / list / history / observe`
- `tools.get / schemas → list`
- `llm.modelInfo / prepareCall / listProviders / listConfigurableProviders / listModels / resolveCallConfig / discoverModels / providerRetryPolicy`
- `agents.get / list / roots`
- `settings.get / describe / scope`
- `security.audit.list`
- `diagnostics.get / observe`
- `skills.activation.exposure / audit → list`
- `tools.discovery.list`（原 `search`）/ `audit.list`
- `coordination.observe`
- `executions.recovery.capability.list`、`recovery.decisions.get`
- client：`slots.list`（原 `entries`）/ `slots.observe`（原 `subscribe`）/ `connection.get`（原 `api`）

### 能力缺口

无。

---

## 2. policy（声明 / 决策）

**心智动作**：你是被系统在决策点回调的纯函数；你返回决定或改写值；**注册即自动生效**。

### 命名词表

| 用途 | 统一名 | 取代 |
|---|---|---|
| 注册 | `register(spec)` | `add`、`declare`、`contribute`（决策义）、`registerXxx` |
| 决策函数字段 | `decide(context)` | `verify`、`authorize`、`check`、`filter`、`guard`、`policy`（作回调字段时） |
| 顺序 | `priority`（固定词表） | `order`、`weight`、`index` |
| 冲突码 | `conflict`（typed error 子类） | `duplicate`、`already-registered`、`identity-conflict` |

### 标准形状

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | `register(spec) → handle`；`spec` 显式携带 `id`、`priority`、`decide` |
| 2 | 返回值与句柄 | handle `{ id, ownerId, generation, dispose() }` |
| 3 | owner / key / generation | `ownerId` 由调用方 context 派生，**不接受调用方自报**；`id` 只在 owner namespace 内唯一；`generation` 是并发控制令牌 |
| 4 | 生命周期与 disposer | `dispose()` 幂等；stale disposer 返回 typed no-op，不删除继任者或其他 owner 的注册 |
| 5 | 失败语义 | **抛** typed registration error；冲突抛其 `conflict` 子类；**禁止判别式 `ok:false` 与静默 no-op** |
| 6 | 冲突规则 | **同 owner 同 id latest-wins（旧 generation 立即退役）；跨 owner 同 id 拒绝** |
| 7 | 组合语义 | `ordered`：固定 priority 词表 + 同 priority 注册顺序；多策略结果由领域 reducer 收敛 |
| 8 | 幂等与重试 | `decide` 必须是纯函数且可重复调用；系统在同一次决策内对同一策略至多调用一次 |
| 9 | availability | 由 `availability()` 表达；策略本身不表达可用性 |

### 强制生效要求（本 idiom 特有）

> 每个策略点必须声明其决定被**强制执行**。若某策略点在实际运行时不被咨询，因而不生效，**不得**为此提供咨询式入口；该策略点必须登记为能力缺口（[`api-idiom.md`](api-idiom.md) §5 处置 5）。

这条是硬约束：一旦允许「注册了但要调用方自己来问」，policy idiom 的冲突规则与失败语义契约就同时失去意义。

### 同构要求

- 所有注册入口一律 `register`，决策回调字段一律 `decide`。
- 所有策略 handle 一律 `{ id, ownerId, generation, dispose }`，与 resourceRegistry 的 handle **完全同构**（两者只在「注册后谁调用谁」上不同）。
- priority 词表全仓库唯一：`lowest | low | normal | high | highest | monitor`，含默认值。

### 领域实例（目标形状）

- `security.policy.register` / `security.redaction.register` / `security.egress.register`
- `llm.requestTransforms.register` / `llm.admissionPolicies.register`
- `llm.routing.policies.register` / `llm.routing.health.registerCircuitPolicy → health.circuitPolicy.register` / `registerProbe → health.probe.register`
- `executions.recovery.policy.register`
- `executions.visibility.register`
- `prompts.provenance.policy.register`
- `skills.activation.policy.registerMinimalCatalogUpdate → policy.register({ kind: 'minimal-catalog-update' })`
- `tools.restrict.register`（原 `tools.restrict(filter)`）/ `tools.guard.register`（原 `tools.guard(guard)`）
- `sessions.channels.auth.register({ kind: 'verifier' | 'authorizer' })`
- `executions.recovery.visibility.register`

### 能力缺口

| 策略点 | 无法兑现的契约 | 需要的迁移 |
|---|---|---|
| `security.egress` | 强制生效要求：注册后不在官方出站路径被咨询 | 官方出站路径需要决策点 |
| `security.redaction` | 强制生效要求：当前只有 model/ui 内容通道咨询规则，其余通道不咨询 | 其余出口通道需要接入规则引擎 |
| `executions.recovery` | 强制生效要求：注册后不在失败路径被咨询，需要调用方自行求值 | 失败路径需要决策点 |

> 上表只登记「需要什么性质的迁移」，不登记由哪个官方组件包承载。

---

## 3. mutation（刻石）

**心智动作**：写入不可逆的领域事实；提交即持久，不会被系统以「太多」为由删除。

### 命名词表

| 用途 | 统一名 |
|---|---|
| 单步写入 | 领域动词（如 `appendMessage`） |
| 事务内记录 | `record(op)` |
| 提交 | `commit()` |
| 回滚 | `rollback()` |
| 补偿恢复 | `restore(...)` |
| 提交状态字段 | `commitState` |

### 标准形状

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | 单步写入直接调用（返回判别式）；多步写入走 operation 的 `prepare` 拿句柄后 `record → commit/rollback` |
| 2 | 返回值与句柄 | 判别式结果 `{ ok, code, commitState, generation, ... }`；**不返回可撤销句柄** |
| 3 | owner / key / generation | 记录身份 = `id` + `generation` + `commitState`；`generation` 是并发控制令牌，可 CAS 比较 |
| 4 | 生命周期与 disposer | **不提供 disposer**；已提交事实不可撤销，清理只能由显式补偿操作完成 |
| 5 | 失败语义 | 业务失败返回冻结判别式结果；契约破坏/编程错误才抛 typed error；默认拒绝并可审计 |
| 6 | 冲突规则 | CAS/fencing on `generation`；同 key 已有终态时拒绝改写 |
| 7 | 组合语义 | `coordinated`：所有受保证的同资源写路径纳入同一 authority，旁路写路径显式登记 |
| 8 | 幂等与重试 | 终态重试返回既有终态并标注 `idempotent: true`；未声明默认不自动 retry |
| 9 | availability | 由 `availability()` 表达；**不允许用「返回 undefined」表达不可用** |

### 同构要求

- 所有写入的业务失败统一返回冻结判别式结果并携带 `commitState`；契约破坏或编程错误才抛 typed error。
- 事务的三段动词全仓库一致：`prepare`（operation）→ `record`（mutation）→ `commit` / `rollback`（operation）。

### 领域实例（目标形状）

- `sessions.appendMessage(target, kind, payload, options)`
- `sessions.fork`
- `sessions.branches.create / commit / rollback / restore`
- `workspaces.transactions.record`
- `profiles.snapshot.create / modify / delete / apply`、`profiles.apply`
- `settings.update / replace / mutate`

### 能力缺口

无。

---

## 4. operation（发起）

**心智动作**：发起一次动作；内部阶段由 authority 主导；调用方不参与内部阶段，只拿结果与终态。

### 命名词表

| 用途 | 统一名 | 取代 |
|---|---|---|
| 发起 | 领域动词（`start` / `ingest` / `activate` / `validate` / `emit` …） | — |
| 终态 | `terminal` | `status`（作终态时）、`outcome`（作终态时） |
| 重试层级 | `attempt` | — |
| 事务开启 | `prepare` | — |
| 终态收敛 | `commit` / `rollback` | — |

### 标准形状

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | `verb(input, options?) → outcome \| handle`；`options` 可携带 `signal` |
| 2 | 返回值与句柄 | outcome 为判别式 `{ ok, code, operation, terminal, ... }`；handle 为 `{ id, ownerId, status(), observe(), dispose() }` |
| 3 | owner / key / generation | operation 身份独立于事件序列；`attempt` 是 operation 之下的层级，重试只加 attempt、不换 operation 身份 |
| 4 | 生命周期与 disposer | handle 的 `dispose()` 只请求停止，不保证已停止；正确性由 generation guard 保证 |
| 5 | 失败语义 | 判别式 typed result；取消 → `aborted`，取代 → `superseded`，故障 → `error`，超时归 `error` 并以原因字段标记 timeout |
| 6 | 冲突规则 | 外层统一返回确定 outcome；领域在 `concurrency` 中声明 `exclusive` / `latest-wins` / `queue` / `compare-and-swap` / `deduplicate`，不得改变 outcome 形状 |
| 7 | 组合语义 | `coordinated` 或 `exclusive`；多调用方同时发起时结果确定 |
| 8 | 幂等与重试 | 内部 retry 不创建新 operation，只新增 attempt；外部重新发起即创建新 operation，即使参数相同 |
| 9 | availability | 入口不可用时返回 typed unavailable result，不抛穿 |

`terminal` 词表全仓库唯一：`success | error | aborted | denied | superseded`。

### 同构要求

- 所有 handle 一律 `{ id, ownerId, status(), observe(), dispose() }`；事务 handle 追加 `record / preview / commit / rollback`，不得另造 `close` / `finish` / `settle`（作销毁时）。
- operation 的外层冲突结果和失败呈现统一；领域并发策略登记在 `concurrency`，不得新增领域专用 outcome 形状。

### 领域实例（目标形状）

- `agents.create / resume`
- `tasks.register / start / settle / attach`
- `tools.execute`
- `sessions.channels.resume / ack`
- `attachments.pipeline.ingest / transform / cleanup`
- `workspaces.transactions.prepare / commit / rollback / recover`
- `profiles.snapshot.validate`（`handleVerb`，带进度订阅与终态）
- `storage.open` → handle `{ id, ownerId, status(), observe(), dispose(), purge() }`；其中 `dispose()` 只结束本次绑定，`purge()` 是显式 mutation 扩展，必须单独登记并遵守 mutation 的 commitState 契约。
- `skills.activation.activate / deactivate`
- `tools.discovery.activate / deactivate`
- `sessions.channels.auth.initiatePairing / approvePairing / rejectPairing`
- `client.connection.rpc`
- 事件派发：`events.emit / serial / parallel / bail / waterfall`——**派发型 operation**，第 3 条（operation identity / attempt）与第 8 条不适用：一次派发没有独立身份，也不重试。返回值一律改造为判别式结果。

### 能力缺口

无。

---

## 5. contribution（投稿）

**心智动作**：往一个装配里投内容；可撤销、可被系统驱逐、**不产生领域事实**。

### 命名词表

| 用途 | 统一名 | 取代 |
|---|---|---|
| 投稿 | `contribute(spec)` | `register`（装配义）、`mount`、`inject`、`add`、`section` / `context` / `variable`（装配动词） |
| 注册序号 | `seq` | `generation`（作序号时） |

### 标准形状

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | `contribute(spec) → { ok, handle }`；注册与内容在同一调用中提交 |
| 2 | 返回值与句柄 | 判别式 + handle `{ id, ownerId, seq, dispose() }` |
| 3 | owner / key / generation | `ownerId` 派生；`id` 在 owner namespace 内唯一；**不使用并发控制令牌** |
| 4 | 生命周期与 disposer | handle 可撤销且 `dispose()` 幂等；系统可在容量上界驱逐，**驱逐必须派发可观测事件**，不得静默 |
| 5 | 失败语义 | 返回判别式结果（`ok:false` + 稳定 `code`），**不抛**；冲突码与无效码区分 |
| 6 | 冲突规则 | 同 owner 同 id 拒绝（换 id 或先 dispose），不 latest-wins |
| 7 | 组合语义 | `additive`；多个贡献者互不感知，由装配器统一消费 |
| 8 | 幂等与重试 | 贡献可重复提交不同 id；同 id 重复提交是冲突，不是更新 |
| 9 | availability | 由 `availability()` 表达 |

### 与 mutation 的分界

两者都「往里加东西」，分界是三条硬判据，任一条成立即为 contribution：

1. **可逆**：有 `dispose()`，且系统可因容量驱逐；
2. **不产生领域事实**：写入物只被装配器消费，不进 transcript、不计入 token、不成为领域历史的一部分；
3. **无并发控制令牌**：身份用 `seq`，不用 `generation`。

### 与 resourceRegistry 的分界

contribution 是「加入集合后被统一消费」（装配器把所有人投的东西编进一份产物）；resourceRegistry 是「登记到表里被按 key 检索后单独使用」。前者无人按 id 点名取用，后者有。

### 领域实例（目标形状）

- `prompts.provenance.contribute`（正面样本）
- `prompts.contribute({ kind: 'section' \| 'context' \| 'variable' \| 'tools' \| 'suppressRuntimeContext', ... })`——合并原 `section` / `context` / `variable` / `tools` / `suppressRuntimeContext` 五个入口，与 `provenance.contribute` 完全同构
- `client.slots.contribute({ kind: 'define' \| 'inject', ... })`——合并原 `slots.register` / `slots.inject`
- `client.remotes.contribute`（原 `mountRemote`）
- `client.settings.remote.mountRemoteContribution` → `contribute`

### 已知例外

- 异步生效的 contribution：入口返回 `Promise<handle>`，且必须在结果到达前就给出可安全 `dispose()` 的句柄（pending 态下 `dispose()` 使记录进入 stale，不泄漏官方 disposer）。

### 能力缺口

无。

---

## 6. resourceRegistry（登记）

**心智动作**：把数据或实现交给系统；系统消费它，**不在决策点回调你**。

### 命名词表

| 用途 | 统一名 | 取代 |
|---|---|---|
| 登记 | `register(spec)` | `declare`、`announce`、`enter`、`setFactory`、`define`（登记义）、`publish`、`mount`（登记义） |
| 取回 | `get(id)` / `list(filter?)` | 与 projection 同词表 |

### 标准形状

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | `register(spec) → handle`；`spec` 是数据/实现描述，不是决策函数 |
| 2 | 返回值与句柄 | handle `{ id, ownerId, generation, dispose() }`，与 policy handle **完全同构** |
| 3 | owner / key / generation | `ownerId` 派生；`id` 在 owner namespace 内唯一；`generation` 是该条登记的并发控制令牌 |
| 4 | 生命周期与 disposer | `dispose()` 幂等；dispose 后可重新注册为全新生命周期（**受支持的恢复路径**） |
| 5 | 失败语义 | **抛** typed registration error；冲突使用独立 typed conflict error 子类 |
| 6 | 冲突规则 | 同 owner + 同 id + 同内容幂等返回既有条目；同 owner + 同 id + 不同内容返回 typed `conflict`；跨 owner 返回 owner-conflict |
| 7 | 组合语义 | `additive`；多 owner 条目互不覆盖；用户可见全局名（tool 名、remote service key）走共享/claim 规则，不静默改名 |
| 8 | 幂等与重试 | 登记幂等（同 owner 同 id 同内容重复登记返回既有条目）；不自动重试 |
| 9 | availability | 由 `availability()` 表达 |

### 与 policy 的分界

**注册之后谁调用谁。** policy 是系统在决策点回调你拿**决定**；resourceRegistry 是系统读你交的**数据或实现**。若注册的项含一个会被系统调用的动作，但该动作不返回决定（例如 `activate` 执行一次激活、`run` 跑一次探测），则该动作是本成员的**领域扩展**，成员本身仍归 resourceRegistry。

### 同构要求

- 所有登记入口一律 `register`，handle 一律 `{ id, ownerId, generation, dispose }`。
- 一个语义上的「登记表」只暴露 `register` / `get` / `list` 三个入口，不得按登记物的种类裂成多个动词。

### 领域实例（目标形状）

- `tools.register`（工具实现）
- `tools.discovery.catalog.register`
- `tools.presentation.register`（原 `tools.presentAs`）
- `tools.executionMode.register`（原 `tools.executionMode(exec)`）
- `tools.defineTool`——保留为 `register` 的 spec 构造器，属本 idiom 的构造前置，不单独归 idiom
- `llm.registerAdapter` / `registerConfigurableProviders` / `registerModelDiscovery`
- `llm.adapters.register`（原 `adapters.decorate`）
- `agents.register`
- `agents.providers.register({ kind: 'enter' \| 'announce' \| 'factory', ... })`——合并原 `enter` / `announce` / `setFactory`
- `executions.recovery.capability.register`（原 `capability.declare`）
- `sessions.channels.redaction.register`（原 `redaction.registerProfile`）
- `sessions.channels.auth.pairingProvider.register`（原 `registerPairingProvider`）
- `skills.activation.register({ kind: 'descriptor' \| 'skill' })`——合并原 `registerDescriptor` / `registerSkill`
- `remotes.register`（原 `remotes.publish`）
- `settings.register`
- `diagnostics.register`（`run` 是探针，系统消费其报告，不是决策点回调）
- `attachments.pipeline.transforms.register`（原 `registerTransform`）
- client：`codec.register`、`lifecycle.register`

### 能力缺口

无。

---

## 7. coordination（借 / 占 / 放）

**心智动作**：借一个资源、占住它、还回去；要处理过期、世代比较与抢占。

### 命名词表

本 idiom 的动词**跨领域完全一致，不得因领域改写**（这是全目录同构要求最严的一处）：

| 用途 | 统一名 | 取代 |
|---|---|---|
| 取得 | `acquire(input)` | `open`、`claim`、`lease`、`mount`（占用义） |
| 续期 | `heartbeat(handle)` | — |
| 归还 | `release(handle)` | `revoke`、`close`、`unlock` |
| 抢占 | `takeover(input)` | `reassign`、`force-acquire` |
| 条件写 | `compareAndSet(input)` | — |
| 订阅 | `observe(resource, options?)` | `watch` |
| 可用性 | `availability(scope)` | — |
| 世代 | `generation` | `channelGeneration`、`leaseGeneration`、`revision`（作 fencing 时） |
| fencing 证明 | `fencingToken` | — |

### 标准形状

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | `acquire` / `heartbeat` / `release` / `takeover` / `compareAndSet` / `observe` / `availability`；全部异步 |
| 2 | 返回值与句柄 | 状态变更类返回判别式 `{ ok, code, operation, observedAt, ... }`；handle 携带 `{ id, resource, generation, fencingToken, expiresAt }`；`observe` 返回 projection 的标准订阅句柄。handle 是**租约凭证**不是 disposer 句柄，其归还是入口动词 `release(handle)`，handle 本身不提供 `dispose()`——通用命名表中「句柄销毁统一 `dispose()`」对本 idiom 不适用 |
| 3 | owner / key / generation | `ownerId` 显式传入并校验；`generation` 是并发控制令牌，跨持有时必须递增且不可比较旧值 |
| 4 | 生命周期与 disposer | 到期即失效；`release` 幂等；stale handle 的 `heartbeat` 返回 typed stale/conflict，**不抛** |
| 5 | 失败语义 | 判别式 typed result，**绝不抛穿调用方**；固定码 `inactive` / `invalid-input` / `conflict` / `unavailable` / `unsupported` |
| 6 | 冲突规则 | CAS/fencing；`takeover` 必须携带 expected proof；跨 owner 抢占显式记录 reason 与 provenance |
| 7 | 组合语义 | `coordinated`；同一逻辑资源同时只有一个有效持有者 |
| 8 | 幂等与重试 | `acquire` 不幂等；`release` 幂等；后端不支持的操作返回 `unsupported` 码，不假装成功 |
| 9 | availability | `availability(scope)` 返回 `{ status, scope, durability, operations, backend, epoch }`，**并显式声明后端是否真的提供 durability** |

### 同构要求

- 七个动词与 handle 的五个字段在任何领域都不得改名。这是本 idiom 同构的硬要求：调用方在 `coordination` 学会 `acquire/heartbeat/release`，就必须能在 channel 与 task 上直接复用。
- 可用性**只**由 `availability(scope)` 表达；判别式结果不内嵌 `availability` 字段。

### 已知例外

- **同步有界借用**：作用域类借用（进入执行即借、退出即还）不存在过期与抢占，第 4 条的「到期失效」与第 6 条的「抢占」登记为不适用，其余照常。形状仍为 `acquire → handle → release`。
- **「诚实降级」**：当宿主未提供 durable scope 与原子操作支持时，退化为内存作用域适配器并**在 `availability` 中标注**。这是本 idiom 的正面样本，应当推广为强制契约。

### 领域实例（目标形状）

- `coordination.acquire / heartbeat / release / takeover / compareAndSet / observe / availability`
- `sessions.channels.acquire / heartbeat / release`（原 `open` / `heartbeat` / `revoke`）
- `tasks.acquire`（原 `claim`）/ `tasks.takeover`（原 `reassign`）
- `security.egress.lease.acquire / release`

### 能力缺口

无（本 idiom 的能力由门面自有实现提供，不依赖官方 seam）。

---

## 8. selfDescription（查询门面自身）

**心智动作**：查询的不是领域，而是门面自己的状态、版本与能力。

### 命名词表

| 用途 | 统一名 | 取代 |
|---|---|---|
| 能力查询 | `capabilities.get(path)` / `list({ prefix })` / `require(paths)` | — |
| 可用性 | `availability()` → `{ status, ... }` | `isActive`（作 namespace 可用性查询时）、`health`（作可用性时） |
| 能力矩阵 | `capabilityMatrix()` | 占用 `availability` 名的矩阵（如 `security.availability`、`agents.availability`） |
| 状态词表 | `status: active \| degraded \| unavailable` | `active: boolean` |

### 标准形状

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | 门面根：`isActive` / `apiVersion` / `assertCompatible(req, pluginName?)` / `capabilities.*`；每个 namespace：`availability()` |
| 2 | 返回值与句柄 | 冻结状态对象，**不返回句柄、不返回 disposer** |
| 3 | owner / key / generation | 不适用（门面自身状态，无 owner 与并发控制）；`epoch` 只用于判新 |
| 4 | 生命周期与 disposer | 不适用；`availability()` 无副作用、可任意重复调用 |
| 5 | 失败语义 | `capabilities.require` 抛 capability-unavailable typed error；`availability()` **永不抛**，不可用即返回冻结的不可用状态 |
| 6 | 冲突规则 | 不适用 |
| 7 | 组合语义 | `pure`；任何插件调用都不改变门面状态 |
| 8 | 幂等与重试 | 幂等；调用方可在任何时刻轮询 |
| 9 | availability | 本 idiom 就是 availability 的定义者 |

### 可用性 vs 能力矩阵（必须分离）

两者回答不同的问题，不得共用一个名字：

- `availability()` 回答「这个 namespace **现在**能不能用」，返回 `{ status, ...领域扩展 }`，`status` 用三值词表；
- `capabilityMatrix()` 回答「这个 namespace **提供哪些**能力面」，返回冻结的布尔/枚举矩阵。

同一个名字承载两种语义时，调用方无法在不读领域文档的前提下判断该读哪个字段。

### 同构要求

- 每个公共 namespace 都必须提供 `availability()`，且返回形状含 `status` 字段。缺失是缺陷，不是设计。
- **可用性的唯一入口是 `availability()`**：任何判别式结果不得内嵌 `availability` 字段。同一事实两个来源必然漂移，且会让调用方在每次调用时都承担解析可用性快照的负担。
- 门面级 presence（`capabilities.get`）与成员级 availability（`availability()`）是两个层次，不得互相替代。

### 领域实例（目标形状）

- `isActive` / `apiVersion` / `assertCompatible` / `capabilities.get / list / require`（host 与 client 同构）
- 各 namespace 的 `availability()`
- `security.capabilityMatrix()` / `agents.capabilityMatrix()`
- `events.catalog()`——门面事件词汇清单，归本 idiom（它是「门面提供哪些事件」的自述，不是领域视图）
- `attachments.projection.availability()` / `attachments.pipeline.capabilities()`
- `llm.routing.availability()`
- `mcp.availability()`（当前缺失，是缺陷）

### 能力缺口

无。
