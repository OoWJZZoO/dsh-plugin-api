# API idiom 目录（M8）

> 本文是 M8 公共 API 语义重构的目标规范，不是当前仓库现状。每条契约以“重构后应当”表述。
> 总则与分组方法见 [`api-idiom.md`](api-idiom.md)；登记规则见 [`member-contract-registry.md`](member-contract-registry.md)；边界见 [`events-and-passthrough.md`](events-and-passthrough.md)。
>
> **证据说明**：本文每个 idiom 的“当前形状差异”小节记录的是**现在代码里实际存在的形状**，取自 `lib/` 与 `packages/` 的实现，用于证明该分组确有必要、并标出需要统一的地方。这些差异是 M8 要消除的对象，不是规范要求。

## 0. 目录一览

| # | idiom | 调用方心智动作 | 谁主导 | 典型成员 |
|---|---|---|---|---|
| 1 | projection | 订阅 / 查询 | 调用方拉取 | `executions.observe/get/history`、`sessions.get/list`、`tasks.observe`、`coordination.watch` |
| 2 | policy / decision | 声明 | 系统在决策点回调你 | `security.policy.register`、`llm.requestTransforms.register`、`executions.recovery.policy.register` |
| 3 | mutation / commit | 刻石 | 调用方主导写 | `sessions.appendMessage`、`sessions.branches.*`、`workspaces.transactions.*` |
| 4 | operation / invocation | 发起 | authority 主导内部阶段 | `agents.create/resume`、`tasks.start/claim/settle`、`sessions.channels.open` |
| 5 | contribution | 投稿 | 调用方投入装配，系统可驱逐 | `prompts.provenance.contribute`、`client.remotes.mountRemote` |
| 6 | resource / capability registry | 登记 | 系统消费你交的数据/实现 | `tools.discovery.catalog.register`、`executions.recovery.capability.declare`、`sessions.channels.redaction.registerProfile` |
| 7 | coordination / lease | 借 / 占 / 放 | 租约 + 世代比较 | `coordination.acquire/heartbeat/release/takeover/compareAndSet/watch` |
| 8 | self-description | 查询门面自身 | 门面 | `capabilities.get/list/require`、`isActive`、`apiVersion`、`assertCompatible`、各 namespace `availability()` |

**本目录的分组状态**：八个 idiom 是按 [`api-idiom.md`](api-idiom.md) §6 **A 类（分组验证）确认的 M8 目标分组**——每个都有至少三个叶子成员样本与实现位置证据。按 §6 **B 类的成员级 registry 登记尚未完成**，是 M8 实施的交付物；因此在 B 完成前，本文任何 idiom 都不得被读作“当前 API 已提供该契约”。

类别数量不是优化目标（[`api-idiom.md`](api-idiom.md) §2.2）：没有真实成员证明其套路不同的候选并入最接近的 idiom 并登记例外。据此本目录已就两个候选作出结论，不单列新类别：

- **不单列 client 专属 idiom**：host 与 client 共用同一套 idiom，client 成员按套路归并——`client.slots.register` / `inject` 与 `client.settings.remote.mountRemoteContribution`、`client.remotes.mountRemote` 归 contribution（§5）；`client.codec` 与 codec 登记、`client.lifecycle` 的 face 登记归 resource registry（§6）；`client.slots.entries` / `subscribe`、`client.connection`、`client.events` 归 projection（§1）。差异以“已知例外”形式登记，不为浏览器环境另立一套契约。
- **不单列异步挂载 idiom**：`client.remotes.mountRemote` 的异步挂载与多租约共享并入 contribution，作为该 idiom 的已知例外（见 §5）。

一个成员只登记**一个主 idiom**；确实横跨两套套路的成员（如 `tools.discovery.catalog.register` 的 descriptor + `activate`）登记主 idiom，并在 `idiomExceptions` 中写明第二套路。不允许双主 idiom——那会使一致性校验失去意义（见 [`member-contract-registry.md`](member-contract-registry.md) §2）。

---

## 1. projection（订阅 / 查询）

**心智动作**：调用方拉取或订阅一份冻结视图；视图缺位或降级不抛穿。

**应当遵守的公共交互契约**

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | 查询为 `get/list/inspect/history`；订阅为 `observe/onChange/on/once/watch`；返回同步值或冻结快照 |
| 2 | 返回值与句柄 | 返回冻结只读视图；订阅返回 identity-bound disposer 或 `{ current, subscribe, dispose }` 句柄 |
| 3 | owner / key / generation | 视图不带 owner；只携带足以判断新鲜的 `generation` / `epoch` / `observedAt`，且该字段只用于判新，不用于并发控制 |
| 4 | 生命周期与 disposer | disposer 幂等；重复 dispose 是 typed no-op；dispose 后不再收到回调；disposer 不影响其他订阅者 |
| 5 | 失败语义 | 视图缺位/降级返回降级视图或 typed unavailable result，**不抛穿调用方**；监听者回调抛错只降级该监听者 |
| 6 | 冲突规则 | 不适用（无写入）；同名订阅互不冲突 |
| 7 | 组合语义 | `additive` 或 `pure`；订阅顺序不是业务语义，业务顺序由领域 reducer 负责 |
| 8 | 幂等与重试 | 查询天然幂等；订阅重复注册是不同订阅 |
| 9 | availability | 通过本 idiom 自己的降级视图或第 8 组 self-description 的 `availability()` 表达 |

**真实成员样本**

- `executions.observe / get / history / onChange`
- `sessions.get / list / on / once / events / seq / header / requestContext / deriveMessages`
- `prompts.provenance.compose / inspect / mapping / observe`
- `attachments.projection.resolve / open / project / provenance`
- `mcp.servers / tools / onChange`
- `tasks.get / observe / history`
- `coordination.watch`
- `client.slots.entries / subscribe`
- `profiles.inspect / health / planDiff`

**当前形状差异（M8 需统一）**

- 订阅入口命名不统一：`observe`、`onChange`、`on/once`、`watch`、`subscribe` 并存。
- 订阅返回形状不统一：`prompts.provenance.observe(listener)` 返回 `{ ok, disposer() → { ok, already } }`（`lib/context-engine.js:736-751`），而 `coordination.watch(resource)` 返回 `{ current, subscribe, dispose, epoch, resource }`（`lib/coordination-lease.js` watch 尾段）。一个返回“是否成功的判别式”，一个返回“句柄对象”。
- disposer 返回形状不统一：`{ ok, already }` 对象 vs `boolean` vs `void`。

**已知例外**

- `coordination.watch` 的句柄带有 `epoch`，且该 epoch 会随后端重连变化；这是 coordination idiom 的租约语义外溢到 projection 句柄上。**处置：登记为已知例外，并把句柄上的新鲜度字段统一为 `epoch`，语义固定为“后端或装配代次，只用于判新与失效重取，不参与并发控制、不跨后端可比”。** 各领域不得再自造 `generation` / `revision` / `composeGeneration` 等同义字段承载这一语义（当前 `prompts.provenance` 用的是 `composeGenerations` 计数器，`lib/context-engine.js:433`）。

---

## 2. policy / decision（声明）

**心智动作**：你是被系统调用的纯函数；系统在你看不见的决策点调用你，你返回决定或改写值。

**应当遵守的公共交互契约**

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | 统一为 `register(spec) → handle` 一种形状；`spec` 显式携带身份与顺序字段 |
| 2 | 返回值与句柄 | 统一为一种 identity-bound handle（建议 `{ generation, dispose }`），不用裸 disposer 函数 |
| 3 | owner / key / generation | owner 由调用方 context 派生，**不接受调用方自报 owner**；`id` 只在 owner namespace 内唯一；`generation` 是该注册的并发控制令牌 |
| 4 | 生命周期与 disposer | disposer 幂等；stale disposer 返回 typed no-op，不删除继任者或其他 owner 的注册 |
| 5 | 失败语义 | 统一为抛 typed registration error；**禁止静默 no-op 和 `ok:false` 两种风格** |
| 6 | 冲突规则 | 统一为“跨 owner 同名拒绝、同 owner 同名 latest-wins 并立即退役旧 generation”之一，全仓库只能选一种 |
| 7 | 组合语义 | `ordered`：固定 priority vocabulary + 同 priority 注册顺序；多策略结果由领域 reducer 收敛 |
| 8 | 幂等与重试 | 策略函数必须是纯函数且可重复调用；系统在同一次决策内对同一策略至多调用一次 |
| 9 | availability | 策略注册点不可用时由 self-description 的 `availability()` 表达；策略本身不表达可用性 |

**真实成员样本**

- `security.policy.register` / `security.redaction.register` / `security.egress.register`
- `llm.requestTransforms.register` / `llm.admissionPolicies.register`
- `llm.routing.policies.register` / `llm.routing.health.registerCircuitPolicy` / `registerProbe`
- `executions.recovery.policy.register`
- `executions.visibility.register`
- `prompts.provenance.policy.register`
- `skills.activation.policy.registerMinimalCatalogUpdate`

**当前形状差异（M8 需统一）**

同叫“策略注册”，当前至少有五种返回值形态、三种失败语义、四套身份要求：

| 成员 | 入口 | 返回值 | 失败语义 | 身份要求 | 冲突规则 | 证据 |
|---|---|---|---|---|---|---|
| `security.policy.register` | `(ownerId, spec)` | `{ generation, dispose() → boolean }` | 抛 `SecurityPolicyRegistrationError` | `ownerId` 必填 | 同 owner+id latest-wins，旧 generation 立即退役 | `lib/security-policy.js:228-269` |
| `executions.recovery.policy.register` | `(input)` | disposer `() => boolean` | 抛 `RecoveryPolicyRegistrationError` | `id` + `ownerId` + `generation` **全部必填** | 重复 id latest-wins | `lib/recovery-policy.js:415-450` |
| `executions.visibility.register` | `(spec)` | disposer `() => boolean` | 抛 `TypeError` | `id` + `ownerId` 必填，`generation` 可选（默认 `'1'`） | 重复 id 抛错 | `lib/execution-visibility.js:39-64` |
| `llm.requestTransforms.register` | `(spec)` | disposer `() => boolean` | 抛 `LlmRequestTransformRegistrationError` | 无 owner 参数，`id` 全局唯一 | 重复 id 抛错 | `lib/llm-request.js:153-177` |
| `prompts.provenance.policy.register` | `(fn, options)` | `{ ok, disposer() → { ok, already } }` | 返回 `ok:false`，**不抛** | 无 ownerId | 追加，无冲突概念 | `lib/context-engine.js:753-771` |

此外还有两种“策略”根本不叫 `register`：压缩事件与会话标题候选资格是**事件瀑布式决策**（监听事件返回决定），应归入事件语义而非本 idiom（见 [`events-and-passthrough.md`](events-and-passthrough.md)）。

另有两点必须纠正：

- **顺序字段并非只有一个成员拥有。** `executions.recovery.policy.register` 有 `priority` 与 `scope`，`llm.requestTransforms.register` 有 `priority`（`TRANSFORM_PRIORITIES`），`prompts.provenance.policy.register` 也有 `priority`。真正不一致的是**priority vocabulary 与默认值**是否统一，而不是“有没有 priority”。
- **静默失败确实存在。** `sessions.channels.auth.registerVerifier / registerPairingProvider / registerAuthorizer` 在参数非法时返回 `() => false`（`lib/session-channel-auth.js:58-74`），调用方无法区分“注册成功”与“注册被丢弃”。这与本 idiom 的失败语义契约直接冲突。

**已知例外**

- `sessions.channels.auth.*` 的注册项同时是“决策函数”（`verify` / `authorize` 会被回调）与“能力登记”（`registerPairingProvider` 登记一组 initiate/approve/reject 实现）。M8 应把它拆成 policy 注册与 resource registry 两个成员，或明确登记为混合成员。

---

## 3. mutation / commit（刻石）

**心智动作**：调用方主导写入不可逆的领域事实；提交即持久，不会被系统以“太多”为由删除。

**应当遵守的公共交互契约**

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | 单步写入直接调用；多步写入为 `prepare → record → commit/rollback` |
| 2 | 返回值与句柄 | 单步写入返回提交结果并携带 `commitState`；事务返回判别式结果，**不返回可撤销句柄** |
| 3 | owner / key / generation | 记录身份 = identity + generation + commitState；`generation` 是**并发控制令牌**（CAS/fencing 可比），不是注册序号 |
| 4 | 生命周期与 disposer | **不提供 disposer**；已提交事实不可撤销。清理只能由显式补偿操作（如 rollback/restore）完成 |
| 5 | 失败语义 | fail-closed + typed failure；未声明的操作默认拒绝；审计可追溯（who / what / when / generation） |
| 6 | 冲突规则 | CAS/fencing on generation；跨 owner 同 key 拒绝；同 key 已有终态时拒绝改写 |
| 7 | 组合语义 | `coordinated`：所有受保证的同资源写路径必须纳入同一 transaction authority，旁路写路径显式登记 |
| 8 | 幂等与重试 | 按 operation 声明能力（幂等？可自动 retry？）；未声明默认不自动 retry；终态重试返回既有终态并标注 `idempotent: true` |
| 9 | availability | 通过 self-description 的 `availability()` 表达；不允许用“返回 undefined”表达不可用 |

**真实成员样本**

- `sessions.appendMessage(targetSession, kind, payload, options)`
- `sessions.branches.create / graph / plan / preview / commit / rollback / restore`
- `workspaces.transactions.prepare / record / preview / commit / rollback / recover`
- `profiles.snapshot.create / modify / validate / delete / apply`、`profiles.apply`
- `settings` document mutation

**当前形状差异（M8 需统一）**

- **失败语义分裂为“抛”与“返回判别式”两派**：`sessions.appendMessage` 抛 typed preflight error（`non-json-payload` / `invalid-options` / `invalid-source-event-seqs` / `indeterminate-source-event-seqs`，`lib/session-durable-feature.js:372-376` 及其 preflight 分支），而 `workspaces.transactions.*` 返回判别式结果（`{ ok, code, operation, ... }`，`lib/workspace-mutation-transaction.js:429/751/822/968`）。
- **返回值携带的终态字段分裂**：`sessions.appendMessage` 直接返回官方 `targetSession.append()` 的结果，既无 `commitState` 也无 generation；`workspaces.transactions.commit` 返回带 `transactionId`、`leaseGeneration`、`idempotent` 的判别式结果。
- `sessions.branches` 已经具备 CAS/fencing on generation 与 typed disabled 降级，是本 idiom 的正面样本。

**已知例外**

- `sessions.appendMessage` 是**受限的单步写入 helper**（只支持 `user/message` / `assistant/message` / `tool/result`，且只做一次官方 append），不承担事务与审计。**归属判定为 mutation idiom 的最小成员，不归入 operation**：它写的是不可逆领域事实（进 transcript → 计入 token → 成为标题候选 → 进 provenance），没有 handle、没有 attempt、内部阶段也不由某个 authority 主导，不符合 operation idiom 的判据。M8 应当保留该归属，并把它的形状补齐到本 idiom 契约：返回值改为本 idiom 的判别式结果并携带 `commitState`（当前直接返回官方 `targetSession.append()` 结果，见上文「当前形状差异」）。

---

## 4. operation / invocation（发起）

**心智动作**：调用方发起一次动作，内部阶段由 authority 主导；调用方不参与内部阶段，只拿结果与终态。

**应当遵守的公共交互契约**

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | `verb(args, options?) → handle | outcome`；options 可携带 `signal` |
| 2 | 返回值与句柄 | 返回 identity-bound handle（携带 operation identity 与当前状态）或判别式终态结果；handle 提供 `status` / `dispose` / 订阅入口 |
| 3 | owner / key / generation | operation identity 独立于事件序列；`attempt` 是 operation 之下的层级，重试只增加 attempt、不换 operation identity |
| 4 | 生命周期与 disposer | handle 的 disposer 只请求停止，不保证已停止；正确性由 generation guard 保证 |
| 5 | 失败语义 | 判别式 typed result；取消 → `aborted`，取代 → `superseded`，故障 → `error`，超时归 `error` 并以原因字段标记 timeout |
| 6 | 冲突规则 | 同一逻辑资源的并发操作按领域声明的并发策略（`exclusive` / `latest-wins` / `queue` / `compare-and-swap` / `deduplicate`）裁决 |
| 7 | 组合语义 | `coordinated` 或 `exclusive`；多调用方同时发起时结果确定 |
| 8 | 幂等与重试 | 内部 retry 不创建新 operation，只新增 attempt；外部重新发起即创建新 operation，即使参数相同 |
| 9 | availability | operation 入口不可用时返回 typed unavailable result，不抛穿 |

**真实成员样本**

- `agents.create / resume / register`（返回 `AgentHandle`，生命周期由官方 AgentRegistry 主导）
- `tasks.register / start / claim / reassign / settle / attach`（记录带 `attempts[]` 与 `revision`，CAS 写入，`identity-conflict` 为显式冲突码）
- `sessions.channels.open / subscribe / fetchEvents / heartbeat / ack / resume / revoke`（channel 带 generation possession）
- `attachments.pipeline.ingest / transform / cleanup`（多阶段管道）
- `tools.execute(input)`

**当前形状差异（M8 需统一）**

- **operation 契约目前尚不统一**：当前仓库没有一套跨领域一致的 handle + 终态 + 取消约定。`tasks` 用判别式结果 + `attempts` + `revision`（`lib/task-execution-observation.js:353+`），`agents.create` 直接返回官方 `AgentHandle`（官方生命周期，门面不包装），`sessions.channels.*` 用 channel generation possession，三者形状互不相同。
- `tasks` 与 `agents` 在公共契约 registry 中的 `effect` 标注都是 `execute`，但 `sessions` 整条 namespace 也标 `execute`，而它的主要成员是读——这说明现有 `effect` 词表是 namespace 级粗标，无法支撑本 idiom（详见 [`member-contract-registry.md`](member-contract-registry.md)）。

**已知例外**

- `workspaces.transactions.commit` 同时是 mutation 的提交动作与一次 operation 调用：它既落领域事实，又返回判别式终态并支持终态幂等重试。M8 应把它登记为 mutation idiom 的提交动作，operation idiom 只借用其“调用方发起、authority 主导内部阶段”的一面，不为它单开类别。

---

## 5. contribution（投稿）

**心智动作**：往装配里加内容；可撤销、可被系统驱逐、**不产生领域事实**。

**与 mutation 的分界证据**（这是本 idiom 必须独立的直接理由）

用 `../durable-state-and-scope.md` §2 的 durable mutation 契约五条去量 `prompts.provenance.contribute`：

| mutation 契约要求 | `sessions.appendMessage` | `prompts.provenance.contribute` |
|---|---|---|
| identity + generation + commitState | 有 | 有 id/owner/generation，**无 commitState**（结果只有 `ok` / `code`） |
| 事务性 commit/rollback，不允许半提交对外可见 | 单次 append 原子提交 | **无事务**，登记即生效 |
| fail-closed + 审计 | 是 | **无审计**；失败是返回 `ok:false` 而非 fail-closed 拒绝 |
| 副作用可证明 | 是（transcript / token / title / provenance） | 是（只写装配节点） |
| 按 operation 声明能力 | 不幂等、不自动 retry | **无此类声明** |

五条里 contribution 只满足两条。四个代码级差异：

1. **可逆性**：`contribute` 返回 handle，`handle.dispose()` 可撤销（`lib/context-engine.js:300-319`）；系统也会在容量上界处静默驱逐最旧的 contributed 节点并派发 `node-dropped`（`lib/context-engine.js:289-291, 321-329`）。mutation 无 disposer，也不会因“太多”被删。
2. **写入物的本体地位**：contribution 写的是装配节点，只被 `compose` / `inspect` 消费，**不进 transcript**；`appendMessage` 写的是领域事实，进 transcript → 计入 token → 成为标题候选 → 进 provenance。
3. **失败语义相反**：contribution 不抛，返回 `{ ok: false, code: 'CONTRIBUTION_CONFLICT' | 'CONTRIBUTION_INVALID' | 'INACTIVE' }`（`lib/context-engine.js:267-286`）；`appendMessage` 抛 typed preflight error。
4. **同名 `generation` 是两个东西**：contribution 的 `generation = String(node.registrationSeq)` 是**注册序号**，只作 handle 身份，不参与并发控制（`lib/context-engine.js:298`）；mutation 的 generation 是**并发控制令牌**（`sessions.branches` 的 `conflictRule: "CAS/fencing on generation"`）。

若把两者塞进同一 idiom，`generation` 这条的公共契约只能写成“有个 generation 字段”，稀薄到无约束力。

**应当遵守的公共交互契约**

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | `contribute(spec) → { ok, handle }`；注册与内容在同一调用中提交 |
| 2 | 返回值与句柄 | 返回可撤销 handle，携带 id / owner / **registration 序号**；序号字段**不得**命名为 generation |
| 3 | owner / key / generation | owner 派生；`id` 在 owner namespace 内唯一；不使用并发控制令牌 |
| 4 | 生命周期与 disposer | handle 可撤销且 disposer 幂等；系统可在容量上界驱逐，**驱逐必须派发可观测事件**，不得静默 |
| 5 | 失败语义 | 返回判别式结果（`ok:false` + 稳定 code），**不抛**；冲突码与无效码区分 |
| 6 | 冲突规则 | 同 owner 同 id 拒绝（换 id 或先 dispose），不 latest-wins |
| 7 | 组合语义 | `additive`；多个贡献者互不感知，由装配器统一消费 |
| 8 | 幂等与重试 | 贡献可重复提交不同 id；同 id 重复提交是冲突，不是更新 |
| 9 | availability | 装配点不可用时由 self-description 的 `availability()` 表达 |

**真实成员样本**

- `prompts.provenance.contribute`（正面样本，上述证据均取自它）
- `client.remotes.mountRemote(contribution, leaseKey)`（浏览器侧 remote 装配挂载）
- `client.slots.register(options, component)` / `client.slots.inject(key, callback)`

**已知例外**

- `client.remotes.mountRemote` 返回 `Promise<disposer>`，且同一 package 的挂载记录被多个 identity-bound lease 共享，记录有 `pending / active / stale / disposed` 四态，官方 disposer 在最后一个 lease 释放后才执行（`lib/client-remote-contribution.js:22-80`）。这引入了“异步挂载 + 多租约共享”语义，超出基础 contribution 契约。**处置：并入本 idiom，登记为已知例外，不单列异步挂载 idiom**——按 [`api-idiom.md`](api-idiom.md) §2.2 纪律 2 与 4，为单个成员引入新类别会制造无意义的类别，无法消除的差异应显式登记。M8 应当在本 idiom 契约中补一条：当贡献的生效是异步的，入口返回 `Promise<handle>`，且必须在挂载结果到达前就给出可安全 dispose 的句柄（`pending` 态下 dispose 须使记录进入 `stale`，不泄漏官方 disposer）。

---

## 6. resource / capability registry（登记）

**心智动作**：你把数据或实现交给系统；系统消费它，**不在决策点回调你**。

**与 policy 的分界判据**：注册之后**谁调用谁**。policy 是系统调用你拿决定；registry 是系统读你交的数据/实现。两者当前共用 `register` 动词而未被标准区分，这是必须分开的直接原因。

**应当遵守的公共交互契约**

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | `register(spec) → handle`；spec 是数据/实现描述，不是决策函数 |
| 2 | 返回值与句柄 | 返回 identity-bound handle（建议 `{ generation, dispose }`），与 policy idiom 的句柄形状一致 |
| 3 | owner / key / generation | owner 派生；`id` 在 owner namespace 内唯一；`generation` 是该条登记的并发控制令牌 |
| 4 | 生命周期与 disposer | disposer 幂等；dispose 后可重新注册为全新生命周期（明确登记为受支持的恢复路径） |
| 5 | 失败语义 | 抛 typed registration error（与 policy idiom 统一）；冲突使用独立 typed conflict error |
| 6 | 冲突规则 | 重复 id 抛 conflict；**不 latest-wins**（覆盖一个被他人引用的实现是不可见的破坏） |
| 7 | 组合语义 | `additive`；多 owner 条目互不覆盖；用户可见全局名（tool 名、remote service key）走共享/claim 规则，不静默改名 |
| 8 | 幂等与重试 | 登记幂等（同 owner 同 id 同内容重复登记返回既有条目）；不自动重试 |
| 9 | availability | 登记表不可用时由 self-description 的 `availability()` 表达 |

**真实成员样本**

- `tools.discovery.catalog.register(spec)`（登记 descriptor + `activate` 实现）
- `executions.recovery.capability.declare(spec)`
- `sessions.channels.redaction.registerProfile({ id, allowlist })`（登记数据，系统用 `allowlistOf` / `combinedAllowlist` 消费，**无回调**）
- `skills.activation.registerDescriptor / registerSkill`
- `agents.providers.enter / announce / setFactory`（登记实现）
- `client.codec` 的 codec 登记

**当前形状差异（M8 需统一）**

- `tools.discovery.catalog.register` 返回 `{ generation, dispose }`，重复 id 抛 `ToolDiscoveryEntryConflictError`，并明确“dispose + register 是受支持的恢复路径”（`lib/tool-discovery.js:196-232`）——这是本 idiom 的正面样本。
- `sessions.channels.redaction.registerProfile` 与 `sessions.channels.auth.register*` 的返回值/失败语义与 policy 成员混在一起（`lib/session-channel-redact.js:95`；`lib/session-channel-auth.js:58-74`），无法从签名判断归属哪个 idiom。
- `tools.discovery.catalog.register` 的 spec 同时携带一个 `activate` 回调，是“登记 + 一个阶段动作”的混合体。

**已知例外**

- `tools.discovery.catalog.register` 的 `activate` 回调会被系统调用，但它不是在决策点返回决定，而是执行一次激活；判定仍属 resource registry，`activate` 登记为该成员的领域扩展。

---

## 7. coordination / lease（借 / 占 / 放）

**心智动作**：生命周期是**租约**不是注册；要处理租约过期、世代比较与抢占。

**应当遵守的公共交互契约**

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | `acquire(input) → result{handle}` / `heartbeat(handle)` / `release(handle)` / `takeover(input)` / `compareAndSet(input)` / `watch(resource)`；全部异步 |
| 2 | 返回值与句柄 | 状态变更类操作（`acquire` / `heartbeat` / `release` / `takeover` / `compareAndSet`）返回统一判别式结果 `{ ok, code, operation, observedAt, ... }`；订阅类入口（`watch`）返回订阅句柄 `{ current, subscribe, dispose, epoch, resource }`。handle 携带 resource + generation + fencing proof |
| 3 | owner / key / generation | owner 显式传入并校验；generation 是**并发控制令牌**，跨持有时必须递增且不可比较旧值 |
| 4 | 生命周期与 disposer | 租约到期即失效；`release` 幂等；stale handle 的 `heartbeat` 返回 typed stale/conflict，不抛 |
| 5 | 失败语义 | 判别式 typed result，绝不抛穿调用方；`inactive` / `invalid-input` / `conflict` / `unavailable` 是固定码 |
| 6 | 冲突规则 | CAS/fencing；`takeover` 必须携带 expected proof；跨 owner 抢占显式记录 reason 与 provenance |
| 7 | 组合语义 | `coordinated`；同一逻辑资源同时只有一个有效持有者 |
| 8 | 幂等与重试 | `acquire` 不幂等；`release` 幂等；后端不支持的操作返回 `unsupported` 码而不是假装成功 |
| 9 | availability | `availability(scope)` 返回 `{ status, scope, durability, operations, backend, epoch }`，**并显式声明后端是否真的提供 durability** |

**真实成员样本**

- `coordination.acquire / heartbeat / release / takeover / compareAndSet / watch / availability`

`coordination` 是本 idiom 唯一成型的样本，但它**内部并非单一返回形状**，四种形状并存（`lib/coordination-lease.js`）：

| 成员 | 返回形状 | 位置 |
|---|---|---|
| `acquire` / `heartbeat` / `release` / `takeover` / `compareAndSet` | 统一判别式结果 `{ ok, code, operation, observedAt, availability, ... }`，`inactive` / `invalid-input` / `conflict` 等码固定 | `:172-212` 与各方法体 |
| `availability(scope)` | 自身描述形状 `{ status, scope, durability, operations, backend, epoch }`，显式区分 `durability` 与 `backend` | `:152-159`、`:216` 起 |
| `watch(resource, options)` | 订阅句柄 `{ current, subscribe, dispose, epoch, resource }` | `watch` 尾段 |
| `watch` 句柄的 `current()` | 投影 + `fencingValid` / `observedAt` / `epoch` / `resync` / `availability` | `:382-390` |

**当前形状差异（M8 需统一）**

- `security.egress.lease.acquire` 是同一个套路在另一个领域的实例，但它的结果形状与 `coordination.acquire` 不同，未共享判别式词汇。
- 判别式结果**内嵌** `availability` 字段，而其它领域只在单独的 `availability()` 上提供可用性。**处置：M8 统一为“不可用与降级只由该 namespace 的 `availability()` 表达”，判别式结果不再内嵌 `availability` 字段**——同一事实两个来源必然漂移，且会让调用方在每次调用时都承担解析可用性快照的负担。

**已知例外**

- 当宿主未提供 durable scope 与原子操作支持时，当前实现退化为内存作用域适配器并**在 `availability` 中标注**（`lib/coordination-lease.js` 头部注释与 `buildAvailability`）。这个“诚实降级”行为是本 idiom 的正面样本，M8 应把它推广为 coordination 的强制契约。

---

## 8. self-description（查询门面自身）

**心智动作**：查询的不是领域，而是门面自己的状态、版本与能力。

**为什么单列**：它覆盖每一个 namespace，复用价值最高；且当前形状最不统一——这正是“无法在既有 idiom 内形成有用套路，只能单列并统一”的情形。

**应当遵守的公共交互契约**

| # | 条目 | 契约 |
|---|---|---|
| 1 | 入口形状 | 门面根：`isActive` / `apiVersion` / `assertCompatible(req, pluginName?)` / `capabilities.{get,list,require}`；每个 namespace：`availability()` |
| 2 | 返回值与句柄 | 冻结状态对象，**不返回句柄、不返回 disposer** |
| 3 | owner / key / generation | 不适用（门面自身状态，无 owner 与并发控制）；`epoch` 只用于判新 |
| 4 | 生命周期与 disposer | 不适用；`availability()` 无副作用、可任意重复调用 |
| 5 | 失败语义 | `capabilities.require` 抛 capability-unavailable typed error；`availability()` **永不抛**，不可用即返回冻结的不可用状态 |
| 6 | 冲突规则 | 不适用 |
| 7 | 组合语义 | `pure`；任何插件调用都不改变门面状态 |
| 8 | 幂等与重试 | 幂等；调用方可在任何时刻轮询 |
| 9 | availability | 本 idiom 就是 availability 的定义者：`capabilities.get` 返回 `{ capability, status }`，`status ∈ active \| degraded \| unavailable` |

**真实成员样本**

- `pluginApi.isActive` / `apiVersion` / `assertCompatible` / `capabilities`（host 与 client 同构：`lib/plugin-api-service.js:956-995`，`lib/client-runtime.js:72-105`）
- 各 namespace 的 `availability()`

**当前形状差异（M8 需统一）**

当前至少有六种 availability 形状并存：

| 成员 | 返回形状 | 证据 |
|---|---|---|
| `prompts.provenance.availability()` | `{ active: boolean, ...sourceStatuses }` | `lib/context-engine.js:773-776` |
| `sessions.branches.availability()` | `{ active, contract, versionMatch, ...inner }` | `lib/index.js:1766-1775` |
| `sessions.branches` / `skills.activation` 的 disabled 面 | `{ active: false, contract: false }` | `lib/plugin-api-service.js:407, 425` |
| `executions.recovery.availability()` | `{ status: 'active' \| 'unavailable', hostOnly, capabilities, policies, decisions, diagnostics }` | `lib/recovery-policy.js:845-852` |
| `coordination.availability(scope)` | `{ status, scope, durability, operations, backend: { id, reason? }, epoch }` | `lib/coordination-lease.js:152-159` |
| `executions.availability` | `{ sources, epoch }` | `lib/plugin-api-service.js:441` |
| `security.availability` | `{ faces, seams, secretPolicy, reportChannel, audit }` —— **既无 `active` 也无 `status`** | `lib/security-owner.js:447-455` |
| `agents.availability` | `{ create, resume, register, providers: { enter, announce, setFactory } }` 六叶布尔矩阵 | `lib/plugin-api-service.js:297-306` |
| `llm.routing.availability` | `{ execution, session }` | README 记载：`pluginApi.llm.routing.availability` |
| `capabilities.get(capability)` | `{ capability, status }` | `lib/plugin-api-service.js:977` |
| `mcp` | **完全没有 availability 成员** | `lib/plugin-api-service.js:659-681` |

此外，coordination 的每一个判别式结果都内嵌一个 `availability` 字段（`lib/coordination-lease.js:172-212`），与其它领域的“单独调用 `availability()`”是两种不同做法。

**M8 的统一边界（必须明确，不得假设它们已经一致）**

1. **门面级 presence 与成员级 availability 是两个层次**：`capabilities.get(path)` 回答“这个 capability 在不在、可不可用”，`status` 词表固定为 `active | degraded | unavailable`；namespace 的 `availability()` 回答“这个 namespace 当前能用哪些能力”。
2. `availability()` 的**最小公共形状**应当统一为：`{ status, ...领域扩展 }`，其中 `status` 使用与 `capabilities.get` 相同的词表。`{ active: boolean }` 形状在重构后应当退役。
3. **能力矩阵不是 availability**。`security.availability`（`{ faces, seams, secretPolicy, reportChannel, audit }`）与 `agents.availability`（六叶布尔矩阵）回答的是“这个 namespace 提供哪些能力面”，不是“现在可不可用”。**处置：M8 把它们改名为 `capabilityMatrix` 并归入本 idiom 的矩阵变体，`availability()` 这个名字只留给 presence 查询**——同一个名字承载两种语义，调用方无法在不读领域文档的前提下判断该读哪个字段。
4. **可用性的唯一入口是 `availability()`**：判别式结果不再内嵌 `availability` 字段（见 §7「当前形状差异」的处置）。
5. 每个公共 namespace 都必须提供 `availability()`；`mcp` 当前的缺失是缺陷，不是设计。
