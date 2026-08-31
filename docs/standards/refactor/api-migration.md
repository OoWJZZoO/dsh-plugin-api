# 现状 API → 目标形状 处置对照（未来目标）

> 本文是 [`idiom-catalogue.md`](idiom-catalogue.md) 标准形状的配套表格，也是本目录的**迁移决策记录**；实现事实清单见 [`member-inventory.md`](member-inventory.md)，能力覆盖见 [`capability-matrix.md`](capability-matrix.md)。
> 判据与处置顺序见 [`api-idiom.md`](api-idiom.md) §2、§5。
>
> **本文只给验收目标，不给实施顺序。** 谁先改、分几批、由哪个 feature 承接，都不属于本目录的范围。
> 本文的「现状」一列是对当前实现的记录，用于落地时定位，不构成对现状的认可。

## 1. 删除

| 公共 path | 理由 |
|---|---|
| `security.egress.check` | 咨询式入口。策略注册后必须自动生效（[`idiom-catalogue.md`](idiom-catalogue.md) §2 强制生效要求），不提供「你自己来问」的入口；缺口登记见 §7 |
| `sessions.append`（官方 store leaf） | 与 `sessions.appendMessage` 能力重复，属「已有一等领域 API 覆盖的重复入口」 |
| `settings.installSettingsSection` | 与 `settings.register` 能力重复，且是官方包导出转发 |
| `executions.recovery.consume` | 策略自动执行落地后，「调用方自己签收决定」的语义消失 |
| `executions.recovery.visibility.project` | 自动投影落地后，手动投影入口消失 |
| `llm.routing.health.probe / startProbe / completeProbe` | 手动三段驱动探针。改为登记制：只保留 `health.probe.register` + 观察面 |
| `sessions.channels.dispatchChannelMethod` / `channelGenerationOf` | 内部派发与内部字段读取泄漏为公共入口 |

## 2. 迁移

### 2.1 降级为 `services.*` 直通

这些是官方工具箱的一部分，门面不该给它们一等领域语义：

| 公共 path | 说明 |
|---|---|
| `llm.contentHasImage` / `createUserMessage` / `BlockAssembler` | 官方内容词汇与构造器，服务 `llm` 调用的入参准备 |
| `executions.recovery.adapters.fromAgentRequestError` / `fromToolResult` / `unsupported` | 错误适配，属官方类型到门面输入的转换工具 |

### 2.2 退为内部机制

| 公共 path | 说明 |
|---|---|
| `executions.recovery.classify` | 输入归一化，只服务于 recovery 求值流程内部 |

## 3. 重命名

按目标 idiom 分组。只列需要改名的成员；形状要改但名字已合规的不在此列（见 §5、§6）。

### 3.1 → projection（统一 `get / list / inspect / history / observe`）

| 现状 | 目标 |
|---|---|
| `sessions.on` / `once` | `sessions.observe` |
| `sessions.onDurable` / `onceDurable` | `sessions.durable.observe` |
| `sessions.channels.observe` + `channels.onChange` | `channels.observe`（合二为一） |
| `sessions.channels.ack` | `channels.ack` |
| `sessions.channels.resume` | `channels.resume` |
| `mcp.onChange` | `mcp.observe` |
| `coordination.watch` | `coordination.observe` |
| `diagnostics.onChange` | `diagnostics.observe` |
| `tools.schemas` | `tools.list` |
| `tools.discovery.search` | `tools.discovery.list` |
| `tools.discovery.audit.query` | `tools.discovery.audit.list` |
| `security.audit.query` | `security.audit.list` |
| `skills.activation.exposure` | `skills.activation.inspect` |
| `skills.activation.audit` | `skills.activation.audit.list` |
| `settings.describe` | `settings.inspect` |
| `client.slots.entries` | `client.slots.list` |
| `client.slots.subscribe` | `client.slots.observe` |
| `client.connection.api` | `client.connection.get` |
| `events.catalog`（getter） | `events.catalog()` |

### 3.2 → policy（统一 `register` + `decide`）

| 现状 | 目标 |
|---|---|
| `tools.restrict(filter)` | `tools.restrict.register(spec)` |
| `tools.guard(guard)` | `tools.guard.register(spec)` |
| `sessions.channels.auth.registerVerifier` / `registerAuthorizer` | `channels.auth.register({ kind: 'verifier' \| 'authorizer' })` |
| `llm.routing.health.registerCircuitPolicy` | `llm.routing.health.circuitPolicy.register` |
| `llm.routing.health.registerProbe` | `llm.routing.health.probe.register` |
| `skills.activation.policy.registerMinimalCatalogUpdate` | `skills.activation.policy.register({ kind: 'minimal-catalog-update' })` |
| `executions.recovery.visibility.register` | 名字合规，形状需对齐（见 §6） |

### 3.3 → resourceRegistry（统一 `register`）

| 现状 | 目标 |
|---|---|
| `tools.presentAs(mode)` | `tools.presentation.register` |
| `tools.executionMode(exec)` | `tools.executionMode.register` |
| `agents.providers.enter` / `announce` / `setFactory` | `agents.providers.register({ kind: 'enter' \| 'announce' \| 'factory' })` |
| `executions.recovery.capability.declare` | `executions.recovery.capability.register` |
| `sessions.channels.redaction.registerProfile` | `sessions.channels.redaction.register` |
| `sessions.channels.auth.registerPairingProvider` | `sessions.channels.auth.pairingProvider.register`（并拆出决策部分，见 §4） |
| `skills.activation.registerDescriptor` / `registerSkill` | `skills.activation.register({ kind: 'descriptor' \| 'skill' })` |
| `remotes.publish` | `remotes.register` |
| `attachments.pipeline.registerTransform` | `attachments.pipeline.transforms.register` |
| `llm.adapters.decorate` | `llm.adapters.register` |

### 3.4 → contribution（统一 `contribute`）

| 现状 | 目标 |
|---|---|
| `prompts.section` / `context` / `variable` / `tools` / `suppressRuntimeContext` | `prompts.contribute({ kind: 'section' \| 'context' \| 'variable' \| 'tools' \| 'suppressRuntimeContext', ... })` |
| `client.slots.register` / `client.slots.inject` | `client.slots.contribute({ kind: 'define' \| 'inject' })` |
| `client.remotes.mountRemote` | `client.remotes.contribute` |
| `client.settings.remote.mountRemoteContribution` | `client.settings.remote.contribute` |

### 3.5 → coordination（动词跨领域不得改写）

| 现状 | 目标 |
|---|---|
| `sessions.channels.open` | `sessions.channels.acquire` |
| `sessions.channels.revoke` | `sessions.channels.release` |
| `sessions.channels.heartbeat` | 名字合规，形状需对齐（见 §6） |
| `tasks.claim` | `tasks.acquire` |
| `tasks.reassign` | `tasks.takeover` |
| `security.egress.lease.acquire` | 名字合规，形状需对齐（见 §6） |
| `security.egress.lease.acquire` 返回值中的 `revoke()` | `security.egress.lease.release(handle)`（提为独立成员） |

### 3.6 → selfDescription（可用性与能力矩阵分离）

| 现状 | 目标 |
|---|---|
| `security.availability`（faces / seams / …矩阵） | `security.capabilityMatrix()` |
| `agents.availability`（六叶布尔矩阵） | `agents.capabilityMatrix()` |
| 各 namespace `availability()` 返回 `{ active: boolean, ... }` | 返回 `{ status: active \| degraded \| unavailable, ... }` |
| `coordination` 判别式结果内嵌的 `availability` 字段 | 移除；可用性只由 `coordination.availability(scope)` 表达 |
| `mcp`（无可用性成员） | 补 `mcp.availability()` |

## 4. 重构：拆分混合成员

一个成员横跨两套套路时拆分，各归各的 idiom，不长期保留「混合成员」形态。

| 成员 | 拆分为 |
|---|---|
| `sessions.branches` | `graph` / `plan` / `preview` → projection；`create` / `commit` / `rollback` / `restore` → mutation |
| `sessions.channels` | `acquire` / `heartbeat` / `release` → coordination；`observe` / `list` → projection；`ack` / `resume` → operation；`auth.register` → policy；`auth.pairingProvider.register` / `redaction.register` → resourceRegistry |
| `workspaces.transactions` | `prepare` / `commit` / `rollback` / `recover` → operation；`record` → mutation；`get` / `observe` → projection |
| `tasks` | `acquire` / `takeover` → coordination；`register` / `start` / `settle` / `attach` → operation；`get` / `list` / `history` / `observe` → projection |
| `agents` | `register` → resourceRegistry；`create` / `resume` → operation；`get` / `list` / `roots` → projection |
| `security.egress` | `register` → policy；`lease.acquire` / `lease.release` → coordination；`check` → 删除 |
| `settings` | `register` → resourceRegistry；`get` / `inspect` / `scope` → projection；`update` / `replace` / `mutate` → mutation |
| `tools` | `register` / `presentation.register` / `executionMode.register` → resourceRegistry；`restrict.register` / `guard.register` → policy；`get` / `list` → projection；`execute` → operation |
| `sessions.channels.auth.registerPairingProvider` | 决策部分 → policy；实现登记部分 → resourceRegistry |
| `attachments.pipeline` | `ingest` / `transform` / `cleanup` → operation；`transforms.register` → resourceRegistry；`capabilities` → selfDescription |
| `executions.recovery` | `policy.register` → policy；`capability.register` → resourceRegistry；`decisions.get` → projection |

## 5. 归类纠正

现状归类与语义判据不符的成员。这一节是本轮重构中「按语义重判」的直接产物。

| 成员 | 现状归类 | 语义判据 | 正确归类 |
|---|---|---|---|
| `sessions.branches.graph / plan / preview` | mutation | 不写任何东西，只把已提交事实折叠成冻结视图 | projection |
| `sessions.channels.open / heartbeat / revoke` | operation | 签发世代、TTL 续期、撤销后不可复活 | coordination |
| `tasks.claim / reassign` | operation | 携带 expected proof 抢占、写入 fencing token | coordination |
| `agents.register` | operation | 登记实现供系统按 id 查用，与同 namespace 的 `providers.*` 同类 | resourceRegistry |
| `profiles.snapshot.validate` | mutation | 返回带进度订阅与终态的句柄，是发起一次求值 | operation |
| `attachments.pipeline.registerTransform` | operation | 登记实现，系统消费，不在决策点回调 | resourceRegistry |
| `llm.adapters.decorate` | （未登记） | 登记装饰实现 + typed conflict error + 可 dispose，与 `catalog.register` 同套路 | resourceRegistry |
| `diagnostics.register` | （未登记） | `run` 返回报告不是决定，系统消费其产出 | resourceRegistry（非 policy） |
| `prompts.section / context / variable / tools` | passthrough | 往 prompt 装配里投内容，可撤销，不进 transcript | contribution |
| `tools.restrict / guard` | passthrough | 在决策点被回调返回决定 | policy |
| `tools.get / schemas` | passthrough | 查询冻结视图 | projection |
| `llm.listProviders / listModels / …` | passthrough | 查询冻结视图 | projection |
| `llm.registerAdapter / registerConfigurableProviders / registerModelDiscovery` | passthrough | 登记实现供系统消费 | resourceRegistry |
| `settings.writable / prepareDocument / get / update / replace / mutate` | passthrough | 分别归 projection 与 mutation | 见 §4 |
| `sessions.create / prepare / enter / announce / flush / deriveEventMessage` | passthrough | 分别归 mutation 与 projection | 见 §4 |
| `events.on / once` | event-mechanism | 订阅，返回 identity-bound disposer | projection |
| `events.emit / serial / parallel / bail / waterfall` | event-mechanism | 发起一次派发，内部由 bus 主导，返回收敛结果 | operation（派发型） |
| `events.catalog` | event-mechanism | 门面提供哪些事件的自述 | selfDescription |

## 6. 形状对齐

名字已合规但形状需改造的成员（共性改造，逐条不重复列）：

- **所有 handle**：统一 `dispose()`；policy / resourceRegistry 的 handle 统一 `{ id, ownerId, generation, dispose }`；contribution 的 handle 统一 `{ id, ownerId, seq, dispose }`；operation 的 handle 统一 `{ id, ownerId, status, observe, dispose }`。
- **所有 `register`**：`ownerId` 由调用方 context 派生，不接受调用方自报；失败一律抛 typed error，禁止 `ok:false` 与静默 `() => false`。
- **所有返回结果**：冻结；判别式结果统一 `{ ok, code, ... }`。
- **所有订阅**：返回 `{ current, subscribe, dispose, epoch }`，取代当前的「裸 disposer / `{ ok, disposer }` / `{ current, subscribe, dispose }`」三种变体。
- **`generation` 语义收敛**：凡是注册序号一律改名 `seq`；凡是新鲜度一律改名 `epoch`；`generation` 只保留并发控制令牌一义。
- **`security.egress.lease.acquire`**：由抛 typed error 改为返回判别式结果（coordination 契约第 5 条：绝不抛穿）。
- **`sessions.appendMessage`**：返回值改为本 idiom 的判别式结果并携带 `commitState`（当前直接返回官方写入结果）。
- **priority 词表**：统一为 `lowest | low | normal | high | highest | monitor`，含默认值。

## 7. 能力缺口登记

按 [`api-idiom.md`](api-idiom.md) §5 处置 5 登记。**本表只写「需要什么性质的迁移」，不写由哪个官方组件包承载。**

| 成员 | 所属 idiom | 无法兑现的契约 | 需要的迁移 |
|---|---|---|---|
| `security.egress` | policy | 强制生效：注册后不在官方出站路径被咨询 | 官方出站路径需要决策点 |
| `security.redaction` | policy | 强制生效：当前只有 model/ui 内容通道咨询规则 | 其余出口通道需接入规则引擎 |
| `executions.recovery` | policy | 强制生效：注册后不在失败路径被咨询 | 失败路径需要决策点 |

上表对应的公共入口一律按 §1 删除，不留咨询式入口。
