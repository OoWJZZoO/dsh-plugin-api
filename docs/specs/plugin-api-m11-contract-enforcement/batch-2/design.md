# Stage 2 Design: plugin-api-m11-contract-enforcement（batch-2 实效收口）

> feature_name: `plugin-api-m11-contract-enforcement`（批次：**batch-2「实效收口」**）
> milestone: M11
> status: Stage 2 Design（2026-09-21 交付）。本文与同目录 `goal.md`、`requirements.md` 同日由 SPEC1 一口气产出并提交；不创建 `tasks.md`、不写实现代码。
> 上游输入：同目录 `goal.md`（十条 Scope direction）、`requirements.md`（Req 1–12）；`../batch-1/` 的 Design（K1–K8 内核、S1–S15 分册修订）与交付台账（已交付事实与基线）；`temp/m11-effectiveness-review-and-fix-guide.md`（**临时只读实效审查结论，仅存 `temp/`、永不提交**；其 F1–F7、5 个未登记成员与 §6 观察项已逐条固化进本文 §2）；`docs/standards/*` 十二册；canonical registry（`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`）。
> 本文的只读复核基线：`cbbc29b`（batch-1 收尾提交，本批开工时 HEAD，工作区干净）。§2 各行的锚点均按**符号**定位并在开工时逐条复核；与指引原文不一致处按本文 §2.9 订正，**不照抄**。
> 执行口径：版本冻结基线内交付（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`），不步进任何版本字段；**不新增 R 点**，仅允许在既有替代包（`packages/mcp`、`packages/api-remotes`）自身的扩展面内修订并维持被替代官方行的契约复刻与 boot 自检；官方包文件零修改；所有入口 fail-safe；`lib/client.js` 只经 `npm run build:client` 重建。
> 决策口径：本文 §1 的 B 系列是本批的契约增量（对 batch-1 K 系列的补充，不推翻 K）；§2 是逐项处置映射；**§9 列出需人类复核的决策与替代方案**——本批按 SPEC1 决策推进，人类可在 Stage 3 前复核或推翻（推翻时回改本文、`requirements.md` 后重走）。
> 纠偏记录：2026-09-21 由 SPEC2 复审并就地修订——settings 注册 effect 归属与冲突口径（§1-B2、§2.2、§8-3、§9-1）、`settings.scope` 决策条目（新增 §9-6）、观察 handle 行登记缺口（§2.1、§2.9-4、§6）、交叉引用与处置词表；不改立项依据、验收边界与 §9 的默认决策。

## §0 衔接索引

编号约定：本文的 **F1–F7** 沿用 `temp/m11-effectiveness-review-and-fix-guide.md` §5 的缺口编号（只在本批制品内使用，不进入实现产物）；**B1–B7** 是本批契约增量；**S16–S26** 是本批分册修订（编号接续 batch-1 的 S1–S15）；**§2.x** 的「修复 / 保留例外 / 登记订正 / 已合规 / 需人类复核 / 误报」是处置结论词表（术语按本批需要扩展，与 batch-1 同口径）。

| 本文章节 | 承载需求 | 说明 |
|---|---|---|
| §1 契约增量 B1–B7 | Req 2–8 | 先补标准、再改实现；B 系列是 batch-1 K1–K8 的补齐，不推翻 K |
| §2 逐项处置映射（F1–F7 / 5 未登记成员 / §6 观察项 / 事实订正） | Req 1、Req 2–8 | 指引条目的唯一落盘去向 |
| §3 分册修订清单 S16–S26 | Req 9.1、Req 9.2 | 一条规则一个来源 |
| §4 例外与净额 | Req 9.3 | 三口径不高于 batch-1 收口实测 |
| §5 失败路径与 guard | Req 2、Req 3、Req 5、Req 11.4、Req 12.2 | fail-safe 与 typed 失败分界 |
| §6 装配影响与落点 | Req 9.4–9.6、Req 11 | 热点文件、R 落点、bundle、validator、三表 |
| §7 验收与证据映射 | Req 11 | 验收句 → 可执行证据 |
| §8 风险、取舍与排除 | Req 12 | 不做的事与理由 |
| §9 需人类复核的决策清单 | 全部形状决定 | 决策 + 替代方案 + 回退动作 |
| §10 分册适用性与对齐结论 | 全册 | AGENTS §3.4 |
| §11 交付物与阶段边界 | — | 本阶段产出与后续阶段入口 |

---

## §1 契约增量（Design 冻结项）

B 系列是 batch-1 K 系列**没有写到的半步**。每条给出：现状事实（复核后，附锚点）、目标合同、理由、反方案与判定规则。实现 SHALL 先按本节落标准，再按 §2 逐成员映射。

### B1 观察面单一外层合同

**现状**（实测 / 源码复核）：

- 同一动词 `observe` 在 host 面有 **4 种外层返回**：标准四成员 handle（`events`、`executions`、`tasks`、`activity`、`channels`、`planMode`、`permissionPresets`、`diagnostics`、`attention`、`llm.routing`）、带扩展成员的 handle（`workspaces.transactions` 含 `transactionId` / `initialState`）、async 入口（`tasks` / `workspaces.transactions` 返回 Promise\<handle>，`coordination.watch` 名义 async 但同步返回）、以及 `prompts.provenance.observe(listener)` 的 `{ ok, disposer }` 信封（`lib/context-engine.js:767-782`）。
- **3 个成员的 handle 违反 K5 合同**：`attention.observe` 的 `dispose()` 返回 `undefined`（`lib/attention-hub.js:519-543` 与禁用分支 `:503-508`；registry 的 handle 行却登记 `failureSemantics: discriminated-result`）；`coordination.observe` / `workspaces.transactions.observe` 的 `dispose()` 返回布尔、释放后 `subscribe()` 抛裸 `TypeError`（`lib/coordination-lease.js:400/450-469`、`lib/workspace-mutation-transaction.js:1343/1382-1418`）。
- **入参 6 种形态**：事件名（`events.observe(name)`）、id 字符串（`tasks.observe(taskId)`）、options 对象（`executions.observe({sessionId,since,signal})`、`sessions.activity.observe({sessionId})`、`diagnostics.observe({scope,ownerId}[,listener])`）、领域对象（`sessions.planMode.observe(agent)`、`llm.routing.observe(session)`）、资源对象（`coordination.observe(resource)`）、纯 listener（`sessions.channels.observe(listener)`、`prompts.provenance.observe(listener)`、`mcp.observe(listener)`）。
- 另有本批新纳入的两个越界成员：`sessions.durable.observe(targetSession, kind, listener)` 返回**官方 disposer 函数**而非任何 handle（`lib/plugin-api-service.js:1436-1439`）；`sessions.activity.observe` 对非法输入抛**裸 `TypeError`**（`lib/session-activity-observe.js:76-82`）。
- `current()` 的调用形态同样分裂：多数同步，`coordination` / `workspaces.transactions` / `tasks` 返回 Promise（后者经内核 `createObserverHandle` 的 `current` 闭包，`lib/task-execution-observation.js:1312/1333-1343`）。

**目标合同**（一条，适用于全部观察入口与全部降级形态）：

1. **入口**：`observe(subject?)`，返回 handle，或该 handle 的 Promise（异步成员的 `callShape` 由 registry 声明）。
2. **subject 规范形态是 options 对象**（字段名与该命名空间同类动词一致，如 `coordination.observe({ resource })` 与 `acquire({ resource })`）；成员 MAY 额外接受裸主题便捷形态（字符串 id / name、领域对象或 handle），但两形态 SHALL 语义一致并在登记写明；无主题的投影接受零参；**一律不接受订阅回调参数**。
3. **handle**：唯一四成员 `{ current(), subscribe(listener), dispose(), epoch }` + 已登记领域扩展（冻结或等价不可变）；内部监听集合与可变记录永不外泄。
4. **`dispose()`**：幂等，返回冻结判别式 `{ ok, code, reason? }`——成功 `revoked`、no-op `stale`；绝不返回 `undefined` / 布尔 / Promise。
5. **释放后**：`subscribe` 为 no-op（返回 no-op 退订函数）、`current()` 返回降级视图；**非函数 listener 一律不注册且不抛穿**（统一为内核的宽容语义；`lib/events-bus.js:606-611` 的 typed 抛错与 `lib/attention-hub.js:519-543` 的 `TypeError` 收口为 no-op）。
6. **`current()` 的调用形态按成员声明**：允许同步视图或 Promise 视图；合同写明调用方用 `const h = await ns.observe(s); const v = await h.current()` 的 `await` 统一写法（`await` 对同步值透明）。SHALL NOT 把异步读面伪造成同步。
7. **降级路径同形**：域降级（已释放 / 无法回答）返回同形降级 handle；命名空间未挂载抛既有 typed error；**非法输入用 typed 结果或带 `code` 的 typed error**；任何观察入口不抛裸 `TypeError`。

**理由**：调用方需要能写出一段 `observe → current → subscribe → dispose` 的通用代码；实测的 4 种返回 / 6 种输入使这段代码无法复制（指引 §5.3-F1）。**反方案**：把异步 `current()` 一律改同步（否：会伪造同步语义或引入陈旧缓存，违反 batch-1 §9-4 与 `concurrency-and-cancellation` §1）；保留纯 listener 形态（否：它与「订阅一律经 handle」冲突，且使降级路径无法同形）；只在分册写清差异（否：指引已证「文档统一不解决第二次学习的成本」）。

**判定规则（可机械检查）**：遍历 registry 中全部 `effect: subscribe` 的 leaf 与**在册的**对应 handle 行，逐行断言 §5（成员集）、§4（dispose 形状）、§5 释放后行为、`callShape` 声明；subject 形态记入该行 `currentShape` 文案（本批不新增 registry 字段），`.observe` 叶缺失的 handle 行按 §2.9-4 与 §6 的补齐清单处理。运行时由观察矩阵测试（Req 10.4）在挂载面上逐成员取证。

### B2 登记面单一外层合同与冲突口径

**现状**（实测 / 源码复核）：

- 门面自有 `register` 族有 **5 种成功结果**：标准 handle（多数）、判别式信封（`prompts.contribute` 之外的 `events.define`）、**领域 scope 对象**（`settings.register`，`lib/settings.js:59-72`：返回未冻结的 `{ get, watch, update, replace, mutate }`，无 `dispose`）、官方裸 disposer（`agents.register`，已登记例外）、**查询返回值**（`tools.executionMode.register`，`lib/plugin-api-service.js:619-623` 直通 `tools().executionMode(exec)`）。
- `settings.register` 的释放能力缺口：门面把官方 scope 包成自己的对象，**丢掉了任何释放维度**。官方实现已核实为 **ctx effect**（`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js:311-344`：`this.ctx.effect(() => { registrations.set(ns, registration); return () => registrations.delete(ns) }, ...)`；重复注册直接抛错），且 cordis 把服务方法里的 `this.ctx` 解析为**发起调用的 ctx**（service traceable 语义）——门面以自身 ctx 代调用方注册，因此官方注册随**门面（与 settings 服务）**的挂载期存续：**第三方插件卸载不会移除它，也没有按 handle 的显式释放路径**；同 ns 重复注册由官方抛错（门面只做 typed 映射，不改写该事实）——释放边界必须如实披露，而不是假装有。
- `tools.executionMode.register` 的 registry 行自相矛盾：`idiom: resourceRegistry` / `effect: register` / `resourceKey: execution mode id` / `lifecycle: new lifecycle after dispose`，而同一行的 `currentShape` 明说它是「classification query, not a registration」。
- 冲突口径多于词表：实测 `tools.register` 全局路径不判冲突（真实官方 verb 拒绝重名，`registry` 行明说「typed duplicate」）、scoped 路径按 `(owner, target, id)` typed 冲突（`lib/plugin-api-service.js:519-521`）；`diagnostics.register` 是 per-owner latest-wins 且跨 owner 同 id **并存**；`tools.guard` / `tools.presentation` 只包裹官方注册、门面不判冲突。词表已有 `latest-wins` / `content-conflict` / `owner-conflict` / `owner-scoped` / `fencing` / `not-applicable`。

**目标合同**：

1. **门面自有注册只有一种成功形状**：所属 idiom 的标准 handle。`policy` / `resourceRegistry` 一律 `{ id, ownerId, generation, dispose() }` + 已登记扩展成员。
2. **不是 register 的动作不占 register 名**：实为**查询**（只读取既有状态）的动作一律使用 `api-idioms` §3.1 的查询动词；旧名退役。门面自有的真注册（`settings.register` 是「向官方登记 namespace schema」）保留其名与语义；其取回面 `settings.scope` 本就不占 `register` 名。
3. **释放边界如实披露**：门面铸造 handle（`generation` 由门面按 owner 铸造），`dispose()` 释放门面拥有的部分；官方持有、门面无法撤销的部分（`settings.register`：官方注册随门面与 settings 服务存续，调用方卸载不移除）在 `dispose()` 的 `reason`、registry 的 `lifecycle` 与 `currentShape` 中写明。**禁止**两种规避：以虚假 `revoked` 掩盖未释放的官方副作用；以「不返回 handle」回避合同。
4. **官方动词原样透传类**（`agents.register` 等）是**唯一**的 register 例外类：判定规则 = ①该成员的 authority 是官方组件包且官方显式要求原样转发注册动词；②门面不铸第二身份（不派生 owner、不铸造 generation、不包装结果）；③如果官方返回 disposer，原样返回；④在 registry 登记六项例外，且 `currentShape` 写明官方动词名。该类成员**不得**与门面自有 handle 混列在同一名字面下（读者必须能据登记分辨）。
5. **冲突口径**：每个注册成员的 `conflictRule` SHALL 取封闭词表值，且值与实现一致；由官方权威裁决的成员在 `currentShape` 写明「官方裁决」，其词表值 SHALL 与官方行为一致——`settings.register` 的同 ns 重复注册由官方直接抛错，门面不得把它声明为 `latest-wins`（同 owner 也须由官方裁决）；跨 owner 同 key 一律不静默覆盖；验证必须使用与官方行为一致的 owner 桩（permissive 桩不得充当证据）。

**理由**：指引 F2 的判据是「学会一种 register 后仍要记住 5 种结果」，其中 `settings.register` 的不可释放是**能力缺口**。**反方案**：把 `settings.register` 整体改名成绑定成员（指引候选 (b)）——被否：它在语义上确实是「向官方登记 namespace schema」，改名后仍要学一个无释放能力的特例，且丢掉 `register` 族的统一；把官方注册的生命周期说成「可释放」——被否：与官方源码事实相反（B2-3 用披露代替假装）。

### B3 host/client 同 path 规则（含 `events.observe` 与 `settings.scope`）

**现状**：`events.observe(name)` host 直接返回 handle（`lib/events-bus.js:553-643`，非 catalog 名经 `subscribe` 落到 `ctx.on` 无类型透传，`:466-470`），client 返回 `{ ok:true, code:'observed', handle }`（`lib/client-official-events.js:52-63`，未知名 `{ok:false, code:'unsupported', names}`）；`settings.scope` host 返回门面 handle（`{get,watch,update,replace,mutate}`，`lib/settings.js:19-37`），client 返回**官方 scope 原样**（`{getSnapshot,subscribe,set,unset}`，`lib/client-settings-scope.js:19-30`），成员集不相交。

**目标规则（「同 path 同形到什么程度」）**：

同一公共 path 在两端的语义成员 SHALL 满足：

1. **成功形状同层**：要么都是「直接结果」，要么都是「承载结果的判别式信封」；不得一端封套、一端裸值。
2. **失败呈现同规则**：typed 结果 / typed error 的选择按 idiom 分界（`api-idioms` §2），不因端而异。
3. **共同语义成员同名同义**：至少读与订阅成员（`get` / `watch` / `observe`）在两端同名；写面与释放面的差异必须登记（含每个差异成员与理由）。
4. **差异可判定**：读者必须能仅凭返回值 + registry 判断自己处在哪一端、能做什么；不得要求读者记住「client 那边不一样」。

按此规则收敛两处实测分歧：

- **`events.observe`**：两端统一为**判别式信封 + handle**（`api-idioms` §3.1 已为事件面留下信封形态）。host 对 catalog 名答 `{ok:true, code:'observed', handle}`，对**非 catalog 名**答 `{ok:true, code:'untyped', handle, reason}`——如实表达既有的无类型透传通道（`events.define` 的 publisher 只有 `emit` / `dispose`，不带订阅能力，因此该通道是自定义事件的既有观察路径，**不关闭**）；client 保持 `{ok:false, code:'unsupported', names}`（其面只有 4 个官方事件，无透传通道）。两端信封同形、未知名都 typed，`code` 的差异即两端真实环境差异并登记。
- **`settings.scope`**：两端接受**同一对象形态**（`{ namespace, ... }`；host 另保留 `ns` 字符串便捷形态），返回该命名空间的 scope 视图；视图的 `get` / `watch` 在两端**同名同义**（client 在其官方 scope 外包一层别名：`get → getSnapshot`、`watch → subscribe`，官方成员作为扩展成员保留），写成员（host `update` / `replace` / `mutate`；client `set` / `unset`）与释放面差异登记为环境差异并保留。

**理由**：双端插件在这两处必须写两套代码且无法从返回值判断所在端（指引 F3）。**反方案**：两端都用裸 handle（client 则丢失未知名 typed 结果，违反 `api-idioms` §3.1 对事件面的既有条款）；把 host 的 `settings.scope` 对齐到官方 scope 形状（host 侧 scope 由门面 + `ctx.settings` 组合而成，官方 client 的 `getSnapshot/subscribe/set/unset` 在 host 没有对应语义，机械对齐会造假）。

### B4 capability 解析规则（两端同源）

**现状**：host `capabilities.get/list/require` 只接受 `lib/capability-descriptors.js:27-80` 派生的 **49 条**路径（`CAPABILITY_PATHS`），未知 path 抛 `PLUGIN_API_CAPABILITY_UNAVAILABLE`（`lib/plugin-api-service.js:1892-1929`）；client 接受 14 个根 + 单层成员（`lib/client-runtime.js:191-235`），成员存在性由活面 `namespaceMembers(root)` 判定，**状态取所属根探针**，未知 path 也抛。`public-api-shape.md` §5 已写「client 面与 host 面接受同一套公共语义 dot path（含成员级 path），并按真实叶子状态报告」，host 实现未对齐。

**目标规则**：

1. 两端 `get(path)` 接受：①该端登记的能力路径；②**活面上可解析的公共成员 path**（`<root>.<member...>`，任意深度，逐段解析活面）。
2. 成员 path 的状态 = 该成员所属**最近能力簇**的实时探针状态（host：`resolveFeatureStatus` 的 feature 集；client：`capabilityProbes` 的根 / 组合探针）。「最近」= 已登记能力路径中最长的前缀；无前缀时用该命名空间自身的声明路径；再无可解析声明则该成员不在能力面内 → 按未知处理。
3. **未知 path 在 `get` 上不抛**：返回冻结 `{ capability, status:'unavailable', reason:'unknown capability' }`。`require` 保持 capability-unavailable typed throw（未知与不可用都计入 missing）——与 `api-idioms` §3.8「探针不抛、require 抛」的分工一致。
4. `list({prefix})` 两端同形（冻结路径列表 + 前缀过滤）；**内容粒度不做统一**（host 列能力簇路径，client 列根），差异登记。
5. 成员存在性只以**该端活面**为准；不以「对象存在」冒充 `active`。

**理由**：同一段「先探活再调用」的代码必须两端可用（指引 F4），而 host 侧对「我依赖的某个成员是否可用」不可问。**反方案**：把 host 的 49 条扩成「全量成员路径枚举」（否：静态枚举会随活面漂移；活面解析才是单一事实源）；`get` 保持抛错（否：探针抛错使通用预检代码必须包 try/catch，违背 §3.8 的探针语义）。

### B5 availability 聚合与字段语义

**现状**：三值词汇与领域 detail 保留已由 batch-1 落地（`lib/namespace-availability.js`），但**聚合口径未定义**：

- `tasks.availability` 的域 caps 状态是 `available`（`packages` 侧的 `task-execution-adapters.js` 内存 registry），不在三值也不在映射表 → 装饰层**静默回落到描述符状态**（`lib/namespace-availability.js:192-196` 丢弃 token、无 reason），于是「有 `sources.jobs: unavailable` 的来源」却报 `active`（`lib/task-execution-observation.js:274/286-294/1415`）。
- `coordination.availability` 跨 scope 请求报 `unavailable` + `reason:'unsupported'`，而 `operations.*` 全 `available`（域后端能力声明，`lib/coordination-lease.js:224-250`）——两者语义不同却并列，读者易误读。
- `security.availability` 任一 face `inert` ⇒ `degraded`（`lib/security-owner.js:550-571`），口径与前者不同。
- `workspaces.transactions.availability` 走专用探针：域 token `available` 不落三值 → 只答 `{status:'active'}`，`scope/durability/operations/backend/epoch` 全丢（`lib/plugin-api-service.js:3808-3829`）。

**目标合同**：

1. **聚合规则**：`availability().status` = 该 namespace **声明的当前可用性口径**的最小值——全部在册部分可用 ⇒ `active`；任一在册部分不可用 ⇒ `degraded`；命名空间整体不可用，或请求的目标 / scope 超出其后端能力 ⇒ `unavailable`。
2. **字段语义分离**：`operations` / `durability` / `backend` 表达**后端能力声明**（能做什么），不参与 `status` 聚合；当前可用性由 `status`（+ `reason`）承担。各 namespace 的「在册部分」集合（`sources` / `faces` 等）与聚合方式 SHALL 在 registry 的 `availabilityShape` / 行 `currentShape` 中声明。
3. **归一不得静默回落**：映射表补 `available → active`；不在三值也不在映射表的 token 一律以 `degraded` + `reason`（含原 token）呈现，**禁止**回落到描述符状态。
4. **降级指明部分**：局部降级 SHALL 在 detail 中指明降级部分并附 `reason`。
5. **禁用形态同形**：未挂载命名空间的 `availability()` 返回 `unavailable` + `reason`，并保留与非禁用形态**同一 detail 字段集**（含 `epoch`）。

**理由**：`status` 必须是可跨 namespace 比较的量，通用探针 `if (status === 'active')` 不得被误导（指引 F6）；同时不得为对齐而丢弃 `operations` / `durability` 等决策信息（`api-idioms` §3.7）。**反方案**：把所有 detail 字段都拉进 status（否：`operations` 是能力声明，拉入会改变 coordination 的领域语义）；只改分册不改实现（否：实测四处张力仍在）。

### B6 内部缝与可见性

**现状**：`attention.hubSnapshot` 挂在 caller-bound attention 面上（`lib/index.js:2547-2560`），实现忽略 caller：`hub.snapshotAll(kind)` 只按 kind 裁剪（`lib/attention-hub.js:480-497`），而 hub 的 caller 级过滤在 `current` / `list`（`:451` / `:459`）——该成员公开可达且**绕过调用者范围**；它无 registry 行，且注释自述为 "internal forwarding seam"。消费方为 `packages/api-remotes/lib/apply.js:127-138` 的默认 snapshot resolver。

**目标合同**：

1. **公共读面必须按调用者范围过滤**；绕过调用者范围的聚合读面**不得**出现在公共面。
2. 跨组件内部缝经**内部通道**传递：`Symbol.for('dsh-plugin-api.attention.snapshot-seed')` 键（与 client 侧 `Symbol.for('dsh-plugin-api.attention.runtime')` 同型）或等价非枚举成员；内部缝**不登记**为公共成员。
3. 消费方（api-remotes 替代包）改经内部缝取得 snapshot；kind 裁剪与脱敏语义**不变**（fail-closed 的跨受众裁剪保留在 hub 侧）。
4. 该路径移除按公共面减法登记（`removed` + `oldToTargetMapping`），并在交付报告单列「公共面变化」。

**理由**：这是真实、可复现的可见性例外（任何插件可枚举全部在存条目），且该成员从未登记、注释即自述为内部缝。**反方案**：保留公开并补 caller 参数（否：门面内唯一的消费方是同仓替代包，为它造一个公开的、需要 caller 才能安全的聚合读面属过度设计）；保留公开并补登记（否：把越权读面合法化，违反 `visibility-and-redaction` 与 `composition-and-authority` §5）。

### B7 client 降级路径与命名收敛

**现状**：

- attention runtime 未安装时，`client.attention.observe()` 返回冻结 `{current, subscribe, dispose, epoch}`，但 `dispose() {}` → `undefined`、`current()` → 数组、`subscribe` 忽略参数（`lib/client-runtime.js:372-388`）；安装态由 `lib/client-attention-face.js:103-159` 返回**合规** handle（判别式 `dispose()`）。同一段调用代码在两态下行为不同。
- client `slots` 槽位读面有两个成员读同一事实：`declaration(key)`（batch-1 新增的声明投影，含 `declared/missing/unavailable` 三态 + `spec`/`specDynamic`/`declarationEpoch`/`snapshot`/`entries`，`lib/client-slots.js:45-84`）与 `list(key)`（裁剪视图 `{key,status,entries}`，`:44`）。`list` 必须带 key、占用「枚举资源」的兄弟语义。
- client `remotes.observe` / `remotes.dispatch`（`lib/client-remote-events.js:6-13/58-99`）与 host `events.*` 的命名分工只存在于 registry 的 authority 说明里。

**目标合同**：

1. **降级 handle 与安装态同形**：用内核 `createObserverHandle`（或同形实现）铸造；`current()` 返回冻结降级视图（空数组合法）、`subscribe` 返回 no-op 退订函数、`dispose()` 返回判别式。
2. **槽位读面收敛为一个成员**：`slots.inspect(key)`（标准查询动词），返回声明事实与条目（三态保留）；`slots.list` 与 `slots.declaration` 退役并落 `removed` + `oldToTargetMapping`（`list → inspect`、`declaration → inspect`，不得自环）。`slots.contribute` / `slots.observe` / `slots.availability` 不变。
3. **命名分工写入分册**：client `remotes.*` = 远端转发事件通道的观察与载体派发；host `events.*` = 官方事件总线的投影与受生产权约束的派发。

**理由**：降级路径用的就是同一份调用代码（指引 F7-1）；`list` 的名字与职责不符（指引 F7-2）。**反方案**：保留 `list` 并改名 `entriesOf`（否：新增一个不在 `api-idioms` §3.1 查询动词表内的名字，而同一事实已有 `declaration`；收敛为一个成员更符合「一个规则来源」）；保留两个成员（否：重复 authority，读者要记两个名字读同一事实）。

---

## §2 逐项处置映射

处置列含义：**修复**＝本批改实现或改形状；**保留例外**＝保留并登记；**登记订正**＝实现不变、登记/文档对齐；**已合规**＝当前实现已符合目标合同，本批只补登记 / 声明（括号内注明补齐面）；**需人类复核**＝本批按 §9 的默认决策推进，人类可推翻；**误报**＝复核不成立。锚点按符号定位，行号随开发漂移。

### §2.1 F1 观察面逐成员处置（承载 Req 2）

| 成员 | 复核后锚点 | 当前实际形状（复核结论） | 目标（B1） | 处置 |
|---|---|---|---|---|
| `attention.observe`（host） | `lib/index.js:2547-2560`（caller-bound 装配）；`lib/attention-hub.js:499-543`、禁用分支 `:503-508` | 四成员 handle，但 `dispose()` 返回 `undefined`（两条分支）；registry handle 行却登记判别式 | 内核同形 handle，`dispose()` 判别式 | 修复 |
| `prompts.provenance.observe(listener)` | `lib/context-engine.js:767-782`；通知帧 `:227-237` | `{ok:true, disposer}` / `{ok:false, code:'INACTIVE'\|'CONTRIBUTION_INVALID', detail}`；无 `current`/`subscribe`/`epoch`；无 handle 行 | `observe()` 零参 → 标准 handle；`current()` = 最近一次已投递的冻结通知帧，未投递 → 冻结降级视图；补 handle 行 | 修复 |
| `coordination.observe(resource)` | `lib/coordination-lease.js:357/375/400/450-469/487-493`；facade `lib/plugin-api-service.js:3782` | 手工 `deepFreeze` handle（含 `resource` 扩展）；`current()` async；`dispose()` 布尔；释放后 `subscribe` 抛裸 `TypeError` | 入参收敛 `{resource}`；内核同形 handle（保留 `resource` 扩展）；`dispose()` 判别式；释放后 no-op；`current()` async 声明 | 修复 |
| `workspaces.transactions.observe(id)` | `lib/workspace-mutation-transaction.js:1301/1320/1343/1382-1418` | 同形手工 handle（含 `transactionId`/`initialState`）；`current()` async；`dispose()` 布尔；释放后抛裸 `TypeError`；无 handle 行 | 内核同形 + 扩展保留；对象形态 `{transactionId}`；async 声明；补 handle 行 | 修复 |
| `tasks.observe(taskId)` | `lib/task-execution-observation.js:1281/1312/1333-1343/1364-1370` | 内核 handle（含 `taskId`/`initialState`）；`current()` 为 Promise；`dispose()` 已判别式 | 保持 async（声明）；补 `{taskId}` 对象形态 | 已合规（声明/形态补全） |
| `sessions.activity.observe({sessionId})` | `lib/session-activity-observe.js:76-82` | handle 合规；非法输入抛裸 `TypeError`（无 code） | 非法输入 → typed 结果 / 带 `code` 的 typed error | 修复 |
| `sessions.channels.observe(listener)` | `lib/session-channel.js:167-186` | 内核 handle；入参为纯 listener（经 `handle.subscribe` 挂上） | 零参 `observe()`；listener 经 handle | 修复（入参） |
| `diagnostics.observe(options, listener)` | `lib/diagnostics.js:625-647/664-670` | 内核 handle；两参形态；scope 词表 typed 抛错；降级视图合规 | 单参 `observe(options)` | 修复（入参） |
| `events.observe(name)`（host） | `lib/events-bus.js:553-643`；非 catalog 透传 `:466-470` | 内联四成员 handle（行为符合 B1，未复用内核）；非 catalog 名可订阅（无类型透传） | 信封 + handle；catalog `observed`、非 catalog `untyped`（B3） | 修复（与 F3 合并） |
| `events.observe(name)`（client） | `lib/client-official-events.js:52-63` | 信封 + handle；未知名 typed `unsupported` + 目录 | 保持；登记订正（handle 行/形状） | 登记订正 |
| `sessions.durable.observe(targetSession, kind, listener)` | `lib/plugin-api-service.js:1436-1439`；`lib/session-durable-feature.js:262-322` | 三参；返回官方风格 disposer（`() => boolean`），**无 handle** | `observe({ targetSession, kind })` → 标准 handle（`current()` = 最近一条已投递 durable 记录 / 降级视图）；旧三参形态退役 | 修复 |
| `llm.routing.observe(session)`（R 包） | `lib/session-route.js:379-394`；facade `lib/plugin-api-service.js:2907` | 源码成员为 `on(session, listener)`，公共别名 `observe`；内核 handle（本环境 route-plane 未挂载，源码级） | 保留；补 `{session}` 对象形态与声明 | 已合规（形态/登记补全） |
| `mcp.observe(listener)`（R 包） | `packages/mcp/lib/catalog.js:219/299-311`；facade `lib/plugin-api-service.js:1191` | 本地复刻 handle（形状与内核一致）+ listener 参数 | 零参 `observe()`；本地复刻保留（不 import host 内核） | 修复（入参） |
| `sessions.planMode.observe(agent)` / `sessions.permissionPresets.observe(agent)` | `lib/sessions-plan-mode.js:461-494`、`lib/sessions-permission-presets.js:550-575` | 手工冻结四成员 handle，行为合规（形状基准）；非函数 listener 静默 no-op | 保留；补 `{agent}` 对象形态与声明 | 已合规（形态/登记补全） |
| `executions.observe(options)` | `lib/execution-observation.js:111-163`；facade `lib/plugin-api-service.js:3685-3688` | 内核 handle；`current()` 同步；入参 `{sessionId, since, signal}` | 保持（见 §2.9 事实订正） | 登记订正 |

**合计**：修复 10 项、已合规 / 登记订正 5 项，另含全部 disabled 形态与降级形态的同形义务（Req 2.10）。**入参形态的统一按 B1-2 适用于上表全部成员**：每个成员一律接受 options 对象形态（规范形态，如 `events.observe({ name, scope? })`、`tasks.observe({ taskId })`、`sessions.planMode.observe({ agent })`、`coordination.observe({ resource, ...options })`、`sessions.durable.observe({ targetSession, kind })`），已接受裸主题（字符串 / 领域对象 / handle）的成员保留裸形态为便捷形态；纯 listener 形态一律移除。**handle 行**：本批形状变更涉及的观察成员随本批补齐（`prompts.provenance.observe`、`workspaces.transactions.observe`）；其余缺失行按 §2.9-4 的登记现状处理。

### §2.2 F2 登记面逐项处置（承载 Req 3）

| 成员 | 复核后锚点 | 当前实际形状 | 目标（B2） | 处置 |
|---|---|---|---|---|
| `settings.register` | `lib/settings.js:19-72`；官方 `dsh-settings/lib/index.js:311-344` | 返回未冻结 `{get,watch,update,replace,mutate}`，无 `dispose`；官方注册是 ctx effect（门面代调用方发起，随门面与服务存续；无按 handle 的释放路径） | 标准 handle `{id(=ns), ownerId(派生), generation, dispose()}` + 上述成员作为扩展成员（按 handle 扩展登记，不消耗例外）；冲突由官方权威裁决——同 ns 重复注册官方直接抛错（门面映射为 typed conflict，不得声明为 `latest-wins`），跨 owner 由门面先判 typed owner-conflict 并在 `currentShape` 写明「官方裁决」；`dispose()` 释放门面绑定并在 `reason` 披露官方注册随门面与 settings 服务存续；`settings.scope(ns)` 保留为取回同一 handle | 修复 + **需人类复核**（§9-1） |
| `tools.executionMode.register` | `lib/plugin-api-service.js:619-623`；registry `:15699-15730` | 直通查询 `(exec) => tools().executionMode(exec)`；registry 行的 idiom/effect/lifecycle 与其 `currentShape` 自相矛盾 | `tools.executionMode.get(exec)`（projection、pure、sync）；旧名退役 + mapping；订正该组行 | 修复 |
| `agents.register` | `lib/agent-create-api.js:146-151/268-270`；registry 例外 `:2823-2873` | 原样透传官方注册动词与其 disposer；门面不铸身份 | 保留；按 B2-4 的判定规则核对例外措辞与 `currentShape` | 保留例外（分册补规则） |
| `tools.register`（全局） | `lib/plugin-api-service.js:574-590`；registry `:6692-6724` | 门面不判冲突；真实官方 verb 拒绝重名（typed duplicate）；scoped 分支 `:519-521` 判 `(owner,target,id)` typed 冲突 | 声明与实现一致；验证桩与官方行为一致 | 登记订正 + 验证口径 |
| 其余注册行（`diagnostics.register` 等） | registry 逐行 | per-owner latest-wins / 跨 owner 并存 / 官方裁决混用 | 词表枚举逐行核对，`conflictRule` 与实现一致 | 登记订正 |
| 官方动词透传类判定规则 | `api-idioms` §1/§3.6 | 只对 `agents.register` 个案登记，无类规则 | 写入类规则（B2-4），读者可判定 | 分册（S18） |

### §2.3 F3 host/client 同 path 处置

| path | host | client | 目标（B3） | 处置 |
|---|---|---|---|---|
| `events.observe(name)` | 直接 handle；非 catalog 名可订阅（透传） | `{ok:true, code:'observed', handle}`；未知名 typed `unsupported` | 两端统一信封 + handle；host 非 catalog 名 `{ok:true, code:'untyped', handle, reason}` | 修复（host）+ 登记订正（client） |
| `settings.scope` | `scope(ns)` → 门面 handle | `scope(spec)` → 官方 scope 原样 | 两端接受 `{ namespace, ... }`；`get` / `watch` 同名同义（client 加别名层）；写面与释放面差异登记 | 修复 + 登记 + **需人类复核**（§9-6） |

### §2.4 F4 capability 预检处置

| 端 | 复核后锚点 | 当前实际形状 | 目标（B4） | 处置 |
|---|---|---|---|---|
| host | `lib/plugin-api-service.js:1892-1929`；`lib/capability-descriptors.js:27-80` | 49 条精选路径；成员级 path 多数不可问；未知 path 抛 | 活面成员 path 可解析、映射最近簇；`get` 未知不抛；`require` 保持抛 | 修复 + **需人类复核**（§9-5） |
| client | `lib/client-runtime.js:191-235/604-657` | 14 根 + 单层成员；状态取根探针；未知抛 | 与 host 同规则；深度成员 path 逐段解析活面 | 修复 |
| registry 三行 | registry `:396-496` | `selfDescription`，`currentShape` 未含解析规则 | 补 `currentShape` 描述与 `callShape` | 登记订正 |

### §2.5 F5 未登记成员与 `attention.hubSnapshot` 处置

| 成员 | 复核后锚点 | 当前实际形状 | 目标 | 处置 |
|---|---|---|---|---|
| `events.decisions.availability` | `lib/decision-participation-facade.js:284-288`；装配 `lib/plugin-api-service.js:2050-2053` | `{status:'active'\|'degraded'}`（无 reason），**无 registry 行、无 namespace 记录** | 补 leaf 行 + 所属子命名空间记录；degraded 时附 `reason` | 登记订正（+ reason） |
| `tools.executionPolicies.availability` | `lib/decision-participation-facade.js:249-253`；装配 `:2256-2258` | 同上 | 同上 | 登记订正（+ reason） |
| `agents.decisions.availability` | 同上；装配 `:2282-2284` | 同上 | 同上 | 登记订正（+ reason） |
| `prompts.assemblyPolicies.availability` | 同上；装配 `:2808-2815` | 同上 | 同上 | 登记订正（+ reason） |
| `attention.hubSnapshot` | `lib/index.js:2557-2559`；消费 `packages/api-remotes/lib/apply.js:127-138`；hub 过滤 `lib/attention-hub.js:451/459/480` | 公开可达、无 caller 参数、只按 kind 裁剪、无 registry 行 | 移出公共面，改经内部缝（B6）；`removed` 行 + mapping | 修复 + **需人类复核**（§9-3） |

### §2.6 F6 availability 处置

| 对象 | 复核后锚点 | 当前实际形状 | 目标（B5） | 处置 |
|---|---|---|---|---|
| 装饰层归一 | `lib/namespace-availability.js:30-34/178-250`（未映射 token 静默回落 `:192-196`） | 三值 + 映射表；未映射 token 丢字段 | 补 `available → active`；未映射 token → `degraded` + reason；禁止静默回落 | 修复 |
| `tasks.availability` | `lib/task-execution-observation.js:274/286-294/1415`；`task-execution-adapters.js:109-115/483-489` | 域 caps token `available` → 靠回落报 `active`；`sources.jobs` 可 `unavailable` | `available → active` 归一；`sources` 参与聚合（有不可用来源 ⇒ `degraded` + `reason`）；detail 保留 | 修复 |
| `coordination.availability` | `lib/coordination-lease.js:224-250`；`coordination-normalize.js:231-252` | 跨 scope：`unavailable` + `reason:'unsupported'`，`operations.*` 全 available；同 scope：`active` | 语义不变；`operations`/`durability`/`backend` 声明为能力声明，聚合口径写入分册与登记 | 修复（分册 + 登记） |
| `security.availability` | `lib/security-owner.js:550-571` | 全 inert ⇒ `unavailable`；否则非全 active ⇒ `degraded`；`faces` detail 保留 | 与聚合规则一致（faces 为在册部分）；保持 | 已合规（登记补口径） |
| `storage.availability` | `lib/storage-binding.js:231-239`；禁用 `:153-158` | 活面 `{status, scope, durability, epoch}`；禁用形态缺 `epoch` | 禁用形态同字段集 | 修复（小） |
| `workspaces.transactions.availability` | `lib/plugin-api-service.js:3808-3829` | 专用探针：域 token `available` → 只答 `{status:'active'}`（detail 全丢） | 走通用归一（`available → active`）并保留 `scope/durability/operations/backend/epoch` | 修复 |
| `workspaces.availability` | `lib/plugin-api-service.js:2129-2134`；`namespace-availability.js:149-157/180` | 二值（`active` / `unavailable`），永不 `degraded` | 与聚合规则一致（单一在册部分 ⇒ 二值合法）；登记写明口径 | 登记订正 |

### §2.7 F7 client 降级路径与命名处置

| 对象 | 复核后锚点 | 当前实际形状 | 目标（B7） | 处置 |
|---|---|---|---|---|
| client `attention.observe()` 降级 | `lib/client-runtime.js:372-388` | 冻结四成员，但 `dispose(){}`→`undefined`、`current()`→数组、`subscribe` 忽略参数 | 内核同形 handle | 修复 |
| client `slots.list(key)` / `slots.declaration(key)` | `lib/client-slots.js:44-50/55-84`；公共面 `lib/client-runtime.js:486-487` | 两个成员读同一事实；`list` 名不符实 | 收敛为 `slots.inspect(key)`；两旧名退役 + mapping | 修复 + **需人类复核**（§9-4） |
| client `remotes.*` 与 host `events.*` 分工 | `lib/client-remote-events.js:6-13/58-99`；`lib/client-runtime.js:408-416`；registry `:19331-19396` | 分工只存在于 registry authority 说明 | 写入分册（S22 / B7-3） | 分册（不改实现） |

### §2.8 指引 §6 低优先观察项的去向

| 观察项 | 去向 | 理由 |
|---|---|---|
| `sessions.views` 公开 12 个成员混合 projection 与构造 helper | **不纳入本批** | 非 F1–F7；成员均已登记，改名面横跨多个消费者且收益低于迁移成本；如人类要求，另立批次 |
| 同 namespace 内 `facade idiom` / `official passthrough` / 领域动词混排，读者难辨 | **纳入** | 由 B2-4 的透传判定规则 + S18 承载（登记可判定） |
| `llm.models.list` async 而 `llm.adapters.list` sync；`tasks.*` async 而 `executions.*` sync | **不纳入** | 同步/异步差异本身是 batch-1 明文排除项，且已由 `callShape` 声明；为每个 async 行补理由属登记膨胀 |
| `coordination.acquire({resource})` 与 `observe(resource)` 入参不一致 | **纳入** | 由 Req 2.5 / B1-2 承载（同命名空间同义入参一致） |
| `sessions.activity.observe({sessionId})` vs `executions.observe(options)` vs `tasks.observe(id)` | **纳入** | 由 Req 2.4 / B1-2 承载（对象形态规范 + 裸主题便捷） |

### §2.9 对指引结论的事实订正（复核结论优先）

1. **`executions.observe` 的入参**：指引 F1 表记为 `observe(execId)`（id 字符串）。复核为 `observe(options)`（`{ sessionId, since, signal }`），**无 per-execution 目标**，且 handle 与 `current()` 均已合规（`lib/execution-observation.js:111-163`）。本批不把它列入修复项。
2. **`sessions.durable.observe` 的形态**：指引记为「本环境未取到 handle」。复核（源码级）为**三参 + 官方 disposer**（`lib/plugin-api-service.js:1436-1439`），比指引的保守描述更严重；本批纳入 F1 修复（§2.1）。
3. **registry 与实现的反向行**：指引未覆盖的、由本轮复核发现的登记反向事实，一并按 Req 9.4 订正——`attention.observe.handle` 行登记 `discriminated-result` 而实现 `dispose()` 返回 `undefined`；`tools.executionMode.register` 行的 idiom/effect/lifecycle 与自身 `currentShape` 矛盾；`settings.scope` 行登记 `discriminated-result` 而实现对未知 ns 抛 typed error（本批订正为 `typed-throw`）。
4. **观察 handle 行的登记缺口**：复核发现 6 个 `.observe` 叶没有对应 `.observe.handle` 行——`prompts.provenance.observe`、`workspaces.transactions.observe`、`llm.routing.health.observe`、client `slots.observe` / `remotes.observe` / `lifecycle.observe`。本批为形状变更涉及的两个（`prompts.provenance.observe`、`workspaces.transactions.observe`）补行；其余四处不在本批形状变更面（client 三处的 `currentShape` 已声明标准四成员 handle，host `llm.routing.health.observe` 未在本批核验范围内），保持登记现状——Req 10.1 的 handle 行断言只覆盖在册行与本批补齐行。 **现状注（2026-09-22，batch-2 追加修补）**：`llm.routing.health.observe` 已由 `llm.routing.health.report` 取代（该成员是健康证据写入，按 mutation 惯用判别式结果收场），旧 path 在 registry 记 `removed` + `oldToTargetMapping`；本条对它的排除表述不再代表现行状态，其余表述不改写。

---

## §3 分册修订清单（S16–S26）

每条给出：分册与条款 → 问题（证据） → 修订方向 → 同步面 → 是否需人类确认。**纪律同 batch-1：修订未落盘前，实现不得先落新形状**。

| 编号 | 分册 · 条款 | 问题（证据） | 修订方向 | 同步面 | 人类确认 |
|---|---|---|---|---|---|
| S16 | `api-idioms.md` §3.1 | 只写了「订阅入口统一 `observe` + 四成员 handle + 释放后 no-op」，未定入参合同与 `current()` 形态，实测 6 种输入、4 种返回（F1） | 补观察入口合同：subject 规范形态 options 对象 + 裸主题便捷；禁止 listener 参数；同一命名空间同义入参一致；`current()` 允许 async 并写明 `await` 统一写法；非函数 listener 不抛穿；降级 handle 同形；非法输入 typed | registry 观察行与 handle 行、`scripts/registry-validate.mjs` | 否 |
| S17 | `api-idioms.md` §3.1（事件面信封段） | 只授权了信封形态，未定两端同形与「host 非 catalog 名」的事实表达 | 写明事件面 `observe` 两端同形（信封 + handle）；host 非 catalog 名以 `untyped` 结果如实表达无类型透传；client 未知名 `unsupported` + 目录 | registry `events.observe` 两侧行 | 否 |
| S18 | `api-idioms.md` §1、§3.6 | 「官方动词原样透传」只有个案登记，无类规则；读者无法判定哪些 register 可以不给 handle | 补类判定规则（B2-4 四条），并要求登记六项例外 + `currentShape` 写明官方动词 | registry `agents.register` 等行 | 否 |
| S19 | `api-idioms.md` §2、§3.6 | 冲突口径多于词表；「官方裁决」形态无处登记 | 封闭 `conflictRule` 词表（`latest-wins` / `content-conflict` / `owner-conflict` / `owner-scoped` / `fencing` / `not-applicable`）+ 逐成员声明义务 + 官方裁决的登记方式 + 验证桩要求 | registry 全部注册行 + `scripts/registry-validate.mjs` | 否 |
| S20 | `api-idioms.md` §3.1 | 未定义「返回领域绑定对象 / 带写面前缀的成员」的登记义务，`settings.scope` 一类成员的 shape 只能靠个案理解 | 补绑定 / 访问器型成员的登记义务：必须登记对象成员集、读写面、lifecycle 与释放边界（含「为何无 `dispose()`」或「`dispose()` 释放的是什么」） | registry `settings.register` / `settings.scope` 行 | 否 |
| S21 | `api-idioms.md` §2、§3.7 | 三值词汇已统一但**聚合口径未定义**，`status` 不可跨 namespace 比较；归一表缺 `available` 且允许静默回落（F6） | 写死聚合规则（B5-1）+ 字段语义分离（B5-2）+ 归一表补 `available → active`、未映射 token 必须 `degraded` + reason + 降级指明部分 + 禁用形态同形 | registry `availabilityShape` / namespace 记录 + 各域实现 | 否 |
| S22 | `public-api-shape.md` §4、§5 | 只写了「client 与 host 同名/同类面使用同一套外层合同」，没有可判定的「同到什么程度」；capability 段要求成员级 path 与真实叶子状态，但未定未知 path 与解析规则；client `remotes.*` 与 host `events.*` 的命名分工只存在于 registry authority 说明 | 补同 path 同形四条规则（B3）+ capability 解析规则（B4）：成员级 path、最近簇状态、`get` 未知不抛、`require` 抛、`list` 同形；并在 §4 写明命名分工（client `remotes.*` = 远端事件通道的观察与载体派发；host `events.*` = 官方事件总线的投影与受生产权约束的派发，B7-3） | registry capability 相关行、`clientDomainTree` / `hostDomainTree` | 否 |
| S23 | `visibility-and-redaction.md` §3 | 未写「公共读面必须按调用者范围过滤」与「内部缝不得占用公共成员名」 | 补一条：绕过调用者范围的聚合读面不得进入公共面；跨组件内部缝经内部通道（符号键 / 非枚举）且不登记为公共成员 | `attention.hubSnapshot` 的 `removed` 行 + 实现 | 否 |
| S24 | `public-api-shape.md` §2、§4（树图） | 树图将随本批改名 / 退役 / 内部化漂移（`settings`、`tools.executionMode`、client `slots`、`attention`） | 按 registry 现状逐名刷新（含删除已 `removed` 的名字） | 树图 + registry | 否 |
| S25 | `docs/standards/README.md` | 索引与各册适用范围未随本轮修订更新 | 索引同步 | 索引表 | 否 |
| S26 | `domain-composition.md` §2 | `settings` 行未写 namespace 绑定的释放边界；`tasks` / `coordination` / `security` 行未写 availability 口径 | 补最小领域约束一句（与 S21 一致，不复制 registry） | 该册 + registry | 否 |

> 说明：S16–S26 全部为分册维护性修订（补上 batch-1 未写的半步），不涉及 `capability-strategy.md` 的能力上限条款，因此**均无需人类确认**；若 Stage 4 发现某项实际触及能力上限或新增公共能力，必须停下并请求人类裁决（Req 9.2）。

---

## §4 例外与净额

- **本批不新增六项例外**：`settings.register` 的 handle 化是补齐 `resourceRegistry` 的既有合同（扩展成员按 `api-idioms` §1 单独登记、不消耗例外）；`events.observe` 的信封形态由 §3.1 既有条款授权；`slots.inspect` 是改名；`attention.hubSnapshot` 是减法。
- **保留**：batch-1 收口的全部真实例外继续有效（`agents.register` 的 2 条记录、`sessions.interactions.respond` 的 host/client 两条、`tasks.start/settle/attach` + `tasks.register`、`events.define`、`tools.executionPolicies.register`、`events.decisions.register`、`profiles.snapshot.validate`、`sessions.compaction.run`、`executions.recovery.checkpoints.planRestore`、`sessions.selection.set/get`、`sessions.channels.ack` 等）。
- **净额上限（batch-1 收口实测）**：成员行 **17** / 例外记录 **19** / 公共 path **16**；本批目标为**持平或下降**（记录口径允许因 §2.2 的官方透传类措辞订正而不变，不得新增）。
- **三口径核算义务**：Stage 4 交付时须给出执行后实测值与取样口径（Req 9.3）。

---

## §5 失败路径与 guard

1. **typed 失败分界（承 batch-1 S2，本批补一格）**：注册类抛 typed error；contribution / mutation / operation / coordination 返回判别式；**探针类（`availability` / `capabilities.get`）永不抛穿**；`capabilities.require` 保持 typed throw；观察入口不得抛裸 `TypeError`。
2. **stale 与并发**：所有 `dispose()` 按身份判定（owner + key + generation）；旧 handle 不得撤销新 generation / 新 owner 的资源；释放后到达的回调失去发布能力（`concurrency-and-cancellation` §4/§5）。
3. **回调 containment**：观察 handle 的 listener 异常只降级该监听者；handle 已释放时 `subscribe` 为 no-op；非函数 listener 不抛穿。
4. **fail-safe 不回归**：门面 entry 的 apply 不抛穿；client 根面懒挂载逐叶隔离不变；新增的探针与解析不得抛穿（`capabilities.get` 未知路径返回结果而非抛错）。
5. **R 包修订守卫**：`packages/mcp`（`observe` 入参）与 `packages/api-remotes`（snapshot 内部缝）修订后，必须复核替代行对被替代官方行的 ctx 服务面 / 事件面复刻完整、boot 自检仍通过、组件 owner 唯一；不得改动被禁用的官方行 id 与插入顺序。
6. **client 生成物**：任何 client 侧源改动后必须 `npm run build:client` 重建并核对产物 diff 仅含预期变更，`--check` 一致；不得手编 bundle。
7. **官方零修改**：`/usr/lib/node_modules/@deepseek-ai/dsh/**` 零改动；本轮对官方 settings 实现的阅读只用于事实取证，不 patch、不写回。
8. **阻塞登记**：无法达成的必需行为按 Req 11.4 登记（原因 + 最小解除动作 + 是否需人类授权 + 日期），不以降级呈现充当完成。

---

## §6 装配影响与落点

**热点共享文件**（建议集中串行修改）：`lib/plugin-api-service.js`（公共根装配与逐成员转发）、`lib/index.js`（attention 面与内部缝）、`lib/client-runtime.js`（client 根）、`lib/namespace-availability.js`（归一装饰器）、`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`（事实源）。

| 落点 | 涉及的处置项 |
|---|---|
| `lib/contract-kernel.js` | B1 的 handle 铸造复用（`createObserverHandle`；`current` 已支持 async 闭包，无需改内核；非函数 listener 语义已符合 B1-5） |
| `lib/index.js` | `attention.observe` 的 dispose 收口、`attention.hubSnapshot` 内部化（符号键）、`tools.executionMode` 装配 |
| `lib/attention-hub.js` | `observe` handle 的 `dispose()` 判别式与禁用分支同形 |
| `lib/plugin-api-service.js` | `coordination` / `executions` / `tasks` / `workspaces.transactions` 观察装配、`sessions.durable.observe`、`capabilities.*`、`workspaces.transactions.availability` |
| `lib/settings.js` | `settings.register` 的 handle 化 + `settings.scope` 取回同一 handle |
| `lib/context-engine.js` | `prompts.provenance.observe` 形状与 handle 行 |
| `lib/coordination-lease.js`、`lib/workspace-mutation-transaction.js` | observe 的 dispose / 释放后订阅 / 入参对象形态 |
| `lib/task-execution-observation.js` | `current()` async 声明、`{taskId}` 对象形态 |
| `lib/session-activity-observe.js` | 非法输入 typed 化 |
| `lib/session-channel.js` | `observe()` 零参 |
| `lib/diagnostics.js` | `observe(options)` 单参 |
| `lib/events-bus.js` | `events.observe` 信封（catalog / untyped 两态）+ 非函数 listener 语义 |
| `lib/client-runtime.js` | 降级 handle 同形、`slots.inspect` 暴露、`settings.scope` 对象形态 |
| `lib/client-slots.js` | `inspect` 收敛（`list` / `declaration` 退役） |
| `lib/client-settings-scope.js` | `get` / `watch` 别名层 + 冻结 |
| `lib/decision-participation-facade.js` | 四个 `*.availability` 的 `reason` 补全 |
| `lib/namespace-availability.js` | 归一表补 `available`、禁止静默回落、禁用形态同形 |
| `lib/security-owner.js`、`lib/storage-binding.js` | availability 口径与字段集对齐 |
| `lib/capability-descriptors.js` | 仅当需要为「成员级 path 解析」补数据（不新增能力路径时零改动） |
| `packages/mcp/lib/catalog.js` | `observe` 入参（**R 包**） |
| `packages/api-remotes/lib/apply.js` | snapshot resolver 改经内部缝（**R 包**） |
| `scripts/registry-validate.mjs` | Req 10.1 的校验扩展 |
| `scripts/convergence-table-sync.mjs` + `docs/specs/plugin-api-m10-contract-convergence/convergence/*` | 成员表机械重建；行为表口径复核；装配表 token 可解析 |
| `docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json` | 全部形状变更 + `removed` / `oldToTargetMapping` / `statusByPath` / 新增 availability 行 / 反向行订正 / 观察 handle 行补齐（`prompts.provenance.observe`、`workspaces.transactions.observe`）/ 观察行 `currentShape` 写明 subject 形态 |
| `docs/standards/*`（S16–S26） | 分册修订 |
| `docs/specs/plugin-api-features/feature-list.md`、`README.md` | 登记与治理同步 |
| `test/*` | 观察矩阵、冲突矩阵、capability 预检、availability 聚合、client 降级、运行时↔registry 对账 |

**装配等价性**：本批不改变 full 与选择性安装的行集合，不新增 R 行；替代包内部修订后仍满足「全量与选择性装配同一组主包行与替代行」。

---

## §7 验收与证据映射

验收句（goal，承 M11）：*开发者学会一种登记、贡献、观察或操作套路后，能在 host/client 的其他同类接口上直接复用，而不必重新学习身份、返回值和清理方式。*

| # | 验收场景 | 证据形态（可复跑） |
|---|---|---|
| 1 | 观察套路跨成员、跨端成立 | 观察矩阵测试：逐成员断言 handle 成员集、`dispose()` 判别式、释放后 `subscribe`/`current`、非法输入 typed；host 与 client 各一份 |
| 2 | 释放后订阅不抛、非函数 listener 不抛 | 同上矩阵的失败面用例 |
| 3 | 登记成功只有一种形状 | 注册族枚举测试：逐行断言返回值形状（handle / 已登记例外）；`settings.register` 的 handle + 扩展成员断言 |
| 4 | 冲突行为 = 声明词表 | 双 synthetic owner 冲突矩阵（词表各值 + stale 不得撤销新资源） |
| 5 | `events.observe` 两端同形 | host/client 各一组：catalog / 非 catalog / 未知名三态的冻结信封 + handle 形状断言 |
| 6 | `settings.scope` 两端可复用同一段代码 | 两端同构的调用片段测试（`scope({namespace})` → `get` → `watch` → 退订） |
| 7 | capability 预检可迁移 | 两端 `get` 对能力路径 / 成员级 path / 未知 path 的三态断言；`require` 的 typed throw 断言 |
| 8 | 未登记成员清零 | 运行时↔registry 对账测试（host + client），输出缺口清单为空 |
| 9 | `attention.hubSnapshot` 不在公共面 | 公共面成员集断言 + api-remotes 经内部缝的端到端用例（保留 kind 裁剪断言） |
| 10 | availability 可比较 | 四域（`tasks` / `coordination` / `security` / `workspaces.transactions`）的 status + detail 断言；`storage` 禁用形态字段集（含 `epoch`）；归一表正反例（含未映射 token） |
| 11 | client 降级同形 | 未安装态的 handle 断言（与安装态同形）+ `slots.inspect` 三态断言 |
| 12 | F1–F7 与 5 个未登记成员逐项有去向 | 交付报告中的逐项矩阵（含本批 §2 的复核订正）与登记的 `removed` / mapping 对账 |

**机械校验**：`node scripts/registry-validate.mjs`（含 Req 10.1 的扩展）、`node scripts/convergence-verify.mjs`、`capability-matrix-sync --check`、`npm run build:client:check`、`npm test`（4G 护栏内）、`git diff --check`；版本冻结审计与官方包零修改审计。

**跑测口径**：证据必须来自真实公共入口执行（挂载门面 / 真实 bundle），不得以 import 扫描、路径计数、测试总数充当等价证据（承 batch-1 §8）。

---

## §8 风险、取舍与排除

**主要风险与对策**：

1. **「统一」做成「强行同形」**：只统一外层（成功形状、handle、失败呈现、共同成员名），领域差异走登记（写面成员、`current()` 异步、`operations` 能力声明）。不得为了表格好看改领域语义。
2. **减法伤到真实能力**：`attention.hubSnapshot` 内部化前必须确认门面内唯一消费方（api-remotes 替代包）已改经内部缝；`slots.list` / `declaration` 退役前必须确认无其他消费方（含 test 与文档）。
3. **`settings.register` 的释放语义被误读**：`dispose()` 必须返回判别式并在 `reason`、registry `lifecycle`、`currentShape` 三处写明「官方注册随门面与 settings 服务存续（调用方卸载不移除），无按 handle 的显式释放路径」；不得让作者以为官方注册被撤销。
4. **`capabilities.get` 的行为变更**：`get` 对未知 path 由抛错改为返回 `unavailable`，属公共行为变更；`require` 的抛错语义不变；测试与文档同步，并在交付报告单列。
5. **R 包修订触碰替代契约**：`packages/mcp` 只改公共别名入参、`packages/api-remotes` 只改 resolver 来源；改动后跑既有替代包测试与 boot 自检；无法在不破坏契约复刻的前提下完成时登记阻塞项，不自行扩大 R 范围。
6. **热点文件冲突**：`plugin-api-service.js` / `index.js` / `client-runtime.js` / `namespace-availability.js` / registry 集中串行修改；并行开发按 `AGENTS.md` §3.5 契约先行。

**明确排除**（本批不予处置）：batch-1 的全部排除项继续适用；此外不加 SDET 工程、不为 `sessions.views` 改名、不为同步/异步差异做形态同化、不新增公共能力、不新增 R 点、不改官方包文件、不做假想恶意插件的加固。

**取舍记录**：`settings.register` 选择「补 handle + 如实披露释放边界」而非「改名成绑定成员」或「登记为透传例外」（§9-1）；`events.observe` 选择两端统一信封而非两端统一裸 handle（§9-2）；`attention.hubSnapshot` 选择内部化而非「补 caller 参数后公开」（§9-3）；client `slots` 选择「双旧名收敛为一个 `inspect`」而非「保留两个成员」或「改名 `entriesOf`」（§9-4）；`capabilities.get` 选择「未知不抛」而非「两端统一抛」（§9-5）；`settings.scope` 选择「两端统一对象形态 + 读 / 订阅成员同名」而非「保持两端现状只登记差异」（§9-6）。

---

## §9 需人类复核的决策清单

本批按下列默认决策推进；人类可在 Stage 3 前复核。推翻任一项时，回改 `requirements.md` / 本文对应条款，再进入 Stage 3（不改变本批的 Stage 0–2 交付与提交成立）。

| # | 决策 | 替代方案 | 若被推翻的回退动作 |
|---|---|---|---|
| 1 | `settings.register` **保留名与语义**，铸标准 handle（`id`=ns、派生 owner、门面铸造 generation）+ 扩展成员；冲突由官方权威裁决（同 ns 重复注册抛错，门面只做 typed 映射）；`dispose()` 释放门面绑定并如实披露官方注册随门面与 settings 服务存续 | ①改名 `settings.open` / `settings.scope.register` 并登记为绑定成员；②登记为官方透传例外（无 handle） | 改 Req 3.1/3.3 与 §2.2；registry 落对应 `removed` / 例外行；`settings.scope` 的取回语义随之一并复核 |
| 2 | `events.observe` 两端统一为**判别式信封 + handle**；host 非 catalog 名 `ok:true, code:'untyped'` | ①两端统一为裸 handle（client 用 typed throw 表达未知名，违反 §3.1 既有条款）；②保持现状并只做登记 | 改 Req 4.2 与 §2.3；S17 条款随之改写 |
| 3 | `attention.hubSnapshot` **移出公共面**、改经内部符号缝（api-remotes 同仓消费方随之改） | ①保留公开并补 caller 参数 + 登记；②保留公开并补登记 | 改 Req 6.2/6.3 与 §2.5；S23 条款降级为「登记 + caller 过滤」 |
| 4 | client `slots.list` + `slots.declaration` **收敛为 `slots.inspect(key)`**（两旧名退役 + mapping） | ①只退役 `list`、保留 `declaration`；②`list` 改名 `entriesOf` 并保留 `declaration` | 改 Req 8.2 与 §2.7；registry 落对应 `removed` / 保留行 |
| 5 | `capabilities.get` 对未知 path **返回 `unavailable` + reason**（不抛）；`require` 保持 typed throw | ①两端统一为抛 typed error；②host 抛、client 返回（维持现状差异并登记） | 改 Req 5.2 与 §2.4；`test/host-cutover.test.mjs` 的既有抛错断言随回退保留 |
| 6 | `settings.scope` 两端统一为**对象形态**（`{ namespace, ... }`；host 另保留 `ns` 字符串便捷形态），读 / 订阅成员同名同义（client 在官方 scope 外包 `get` / `watch` 别名层，官方成员作扩展成员保留），写面与释放面差异登记 | ①保持两端现状（host 门面 handle vs client 官方 scope 原样）并只登记差异；②host 对齐官方 scope 形状（`getSnapshot` / `subscribe` / `set` / `unset`） | 改 Req 4.3 与 §2.3；S22 的两端对象形态条款随之改写；client 别名层不落 |

---

## §10 分册适用性与对齐结论（AGENTS §3.4）

| 分册 | 适用性 | 对齐结论 |
|---|---|---|
| `capability-strategy.md` | 适用（R 类边界、`services.*`、公共面减法） | 本批不新增 R 点、不改白名单成员集合；两处 R 包修订只动公共别名入参与内部 resolver 来源；`attention.hubSnapshot` 属公共面减法（不涉能力上限条款） |
| `api-shape.md` | 适用（三面边界与投影纯度） | 本批不改面归属；`settings.register` 保持 `resourceRegistry`（不伪装为纯投影）；`settings.scope` 的绑定型对象按 S20 登记义务处理 |
| `api-idioms.md` | 核心适用 | 本批主战场：观察合同（S16/S17）、登记合同（S18/S19/S20）、availability 聚合（S21）；不改 batch-1 的 K1–K3、K6–K8 内核决策 |
| `public-api-shape.md` | 适用 | 不新增顶层 namespace、不重画领域树；同 path 规则与 capability 解析（S22）、树图刷新（S24） |
| `composition-and-authority.md` | 适用 | 冲突词表与跨 owner 不覆盖（S19）、owner 派生不变、authority closure 复核（`settings` 的官方权威边界如实登记） |
| `domain-composition.md` | 适用 | `events` / `settings` / `tasks` / `coordination` / `security` 行补最小约束（S26） |
| `ordering.md` | 部分适用 | 观察 handle 的 listener containment 边界不变；不新增排序设施 |
| `identity-and-lifecycle.md` | 适用 | `dispose()` 契约、handle 生命周期面（S16）；`generation` 语义不变 |
| `durable-state-and-scope.md` | 部分适用 | availability 的能力声明与 detail（S21）；不改 scope 分层 |
| `visibility-and-redaction.md` | 适用 | 调用者范围过滤与内部缝（S23） |
| `concurrency-and-cancellation.md` | 适用 | 释放后订阅 no-op、stale disposer、异步 `current()` 的声明与语义 |
| `versioning-and-protocols.md` | 适用（冻结基线） | 不步进任何版本字段；装配等价与 `dsh.api` 协商不变 |

---

## §11 交付物与阶段边界

**本阶段（Stage 0–2）交付**：`goal.md`、`requirements.md`、`design.md`（本文）三份制品，与「M11 制品按批次分目录」的重排（第一批次移入 `../batch-1/`）同一提交落盘。

**后续阶段入口**：Stage 3（Tasks）按 §1 契约增量 → §2 逐项映射 → §3 分册修订的依赖顺序编排；Tasks 必须覆盖 F1–F7 全部子项、5 个未登记成员与 §2.8 的纳入项，并逐项对应 Req 1–12；Stage 3 经阻塞对抗性审查通过后直接进入 Stage 4，全部完成后做一次全局终审。

**本线不产出**：`tasks.md`、任何实现代码、任何分册正文修订（S16–S26 按阶段落盘）、`temp/` 依赖。
