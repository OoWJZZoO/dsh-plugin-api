# Stage 2 Design: plugin-api-m11-contract-enforcement

> feature_name: `plugin-api-m11-contract-enforcement`
> milestone: M11
> status: Stage 0–2 已交付（2026-09-14）。本文与同目录 `goal.md`、`requirements.md` 同日由 SPEC1 一口气产出并提交；不创建 `tasks.md`、不写实现代码。
> 上游输入：本目录 `goal.md`（十条 Scope direction）、`requirements.md`（Req 1–14）；`temp/m11-api-contract-convergence-handoff.md`（临时指引，结论已固化进本文 §2）；`docs/standards/*` 十二册；canonical registry（`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`，537 成员 / 52 namespace / 100 能力簇行 / 69 事件目录行 / 17 条 idiom 例外）；本线开工时的只读证据核验（本文 §2 各行锚点均按符号复核；核验结论与指引原文的差异在行内注明）。
> 执行口径：版本冻结基线内交付（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`），不步进任何版本字段；**不新增 R 点**，仅允许在既有替代包自身的扩展面内修订并维持被替代官方行的契约复刻与 boot 自检；官方包文件零修改；所有入口 fail-safe。

## §0 衔接索引

| 本文章节 | 承载需求 | 说明 |
|---|---|---|
| §1 契约内核 K1–K8 | Req 2–8 | 先冻结外层层合同，再逐领域映射 |
| §2 逐成员处置映射 | Req 1、Req 9、Req 10 | 22 项 + 子审追加线索的逐条去向 |
| §3 idiom 归类与例外变更 | Req 11.5、Req 14.3 | 回收 / 保留 / 新增（净额 ≤ 0） |
| §4 分册修订清单 S1–S11 | Req 11 | 双向对齐的正式载体 |
| §5 owner / authority / 生产权模型 | Req 3、Req 8 | 身份双角色与 producer 判定 |
| §6 失败路径与 guard | Req 2.4、Req 6、Req 13.6、Req 14.4 | fail-safe、stale、containment、R 自检 |
| §7 装配影响与落点 | Req 12、Req 14 | 热点文件、R 落点、bundle 重建 |
| §8 验收与证据映射 | Req 13 | 验收句 → 可执行证据 |
| §9 风险、取舍与排除 | Req 14 | 不做的事与理由 |
| §10 分册适用性与对齐结论 | 全册 | 逐分册适用性声明（AGENTS §3.4） |
| §11 交付物与阶段边界 | — | 本阶段产出与后续阶段入口 |

---

## §1 契约内核（Design 冻结项）

内核是本次收口的「唯一规则来源」。每个 K 项给出：现状事实、目标合同、理由与反方案。**实现必须先按本节落内核，再逐领域映射（§2）**；§2 任何一行与本节冲突时以本节为准并按 §4 修订分册。

### K1 注册 handle 统一

**现状**：同一树内注册成功返回五种形状——裸函数（`llm.requestTransforms`、`llm.admissionPolicies`、`llm.routing.*` 四类、`llm.models`、`remotes`、`diagnostics`、`attachments.pipeline.transforms`）、官方可调用 handle 附带 `.replace`（`llm.providers`）、`{id, ownerId, targetId, dispose()}`（`tools.register` 的 scoped 分支，`lib/plugin-api-service.js:513`）、`{generation, dispose()}`（`tools.discovery.catalog`，`lib/tool-discovery.js:228`）、标准六元组（`llm.adapters`、`agents.scopes`）。

**目标**：门面自有（非 `services.*`）注册成员一律返回其 idiom 规定的 handle：`policy` 与 `resourceRegistry` 为 `{ id, ownerId, generation, dispose() }`；`contribution` 见 K7。官方必要附加能力（`.replace`）作为 handle 的**显式成员**保留并登记；领域附加成员（`targetId`、`status()`、`snapshot()`）保留并走 §3 例外。

**理由**：调用方需要能写出一段通用清理代码；「改安装目标范围」不应改变外层合同（`tools.register` 双形态是当前最刺眼的一例）。**反方案**：保留各成员原生形状、只做文档统一（被否：指引 §2 已证同一套路在 9 个注册成员上分叉，文档统一不解决第二次学习的成本）。

### K2 `dispose()` 返回合同统一

**现状**：普通 handle 的 `dispose()` 返回四种——布尔（`tools` scoped、`events.observe`、`diagnostics`）、`Promise`（`workflows.start.handle`、client `settings.remote`）、`{ok, code}`（`checkpoints.restore.handle`、`storage` purge）、`{status: 'ok'|'stale'}`（`agents.scopes`、`llm.adapters`）。

**目标**：普通 handle 的 `dispose()` 返回冻结判别式结果 `{ ok, code, reason? }`；资源类 handle（policy / registry / contribution / projection observer）成功码 `revoked`、no-op 码 `stale`（已释放、被新 generation 取代、资源已不存在）；operation handle 的 `dispose()` 语义是「请求停止」，成功码 `requested`、no-op 码 `stale`，终态由 `status()` / 结果承载（`concurrency-and-cancellation` §1「取消是信号，终态是裁决」）。coordination lease 保持 `release(handle)`。

**理由**：布尔表达不出「stale 与已释放的区别」，而 `composition-and-authority` §5.5 要求 stale disposer 返回类型化 no-op；`{status:...}` 与 `{ok,...}` 两套成功位并存正是「同一 idiom 两套惯例」的根因。**反方案**：统一布尔（否：丢失 stale 信息，且与 operation 的 `requested` 语义无法共存）；按 idiom 保留多种返回（否：dispose 属 §2「共用词汇」而非领域字段）。

### K3 owner 身份双角色

**现状**：`llm.routing` 四类注册要求调用方自报 `ownerId` **与** `generation`（`packages/agent-loop/lib/route-policy.js:154`，缺失即抛 `ROUTE_POLICY_INVALID_REGISTRATION`），且注册表按 `id` 单键存储、跨 owner 同 id 静默覆盖（`:238`）；`security.policy/redaction/egress.register(ownerId, spec)`（`lib/security-owner.js:376`）、`diagnostics.register({ownerId})`（`lib/diagnostics.js:462`）、`storage.open({owner})`（`lib/storage-binding.js:76`）、`workspaces.transactions.prepare({ownerId})`（`lib/workspace-mutation-transaction.js:486`）、client `lifecycle.register({ownerId})`（`lib/client-generation-rebind.js:173`）同样自报；`prompts.contribute` 的显式 `spec.ownerId` 覆盖派生 owner（`lib/plugin-api-service.js:2229`）。仓内已有派生机制：`callerIdentityOf`（`lib/profile-mutation.js:98`）、`deriveAdapterRegistrationOwner`（`lib/llm-adapter-registration.js:180`）、`deriveLlmAdaptersOwner` 与 `FACADE_OWNER_IDS`（`lib/plugin-api-service.js:1037/1043`）。

**目标**：`ownerId` 一律由调用上下文派生；调用方自报的 owner 参数按下述二分处置——(a) 若其语义是「调用者身份」，删除该参数并改为派生（`llm.routing.*`、`security.*.register`、`diagnostics.register`、`workspaces.transactions.prepare`、client `lifecycle.register`、`prompts.contribute` 的 `spec.ownerId`、`tools.discovery.catalog.register` 的 `owner`）；(b) 若其语义是「资源所属者 / 目标 scope」，改名为领域参数并保留语义（`storage.open` 的 owner 即「本插件私有存储命名空间」，语义等同调用者身份 ⇒ 归 (a)，由派生值参与官方 `{scope}__{owner}__{name}` 命名；门面自身的 `mountStorageFeature` 内部挂载路径继续显式传门面 owner，不经公共入口）。generation 由门面铸造（owner-specific opaque token，不跨 owner 比较）；同 owner 同 id 为 latest-wins，跨 owner 同 id 为 typed owner-conflict。不可追踪时使用根 token 并在 registry 如实登记。

**理由**：`composition-and-authority` §5.1 与 `api-idioms` §2 都禁止伪造 owner，但两册都没有为「资源所属者」保留维度，导致实现被机械套用。**反方案**：保留自报并只改登记（否：登记与实现继续互相矛盾，且跨 owner 顶替是真实组合缺陷）；把所有 owner 参数一律删除（否：会删掉真实的资源归属语义，指引 §4-B2 明确禁止）。

### K4 availability 归一与领域 detail 保留

**现状**：装饰器 `lib/namespace-availability.js:130-174` 依次尝试四条分支，只有 `status` 与字符串 `reason` 存活；非标准状态与「函数解析成功」都落到「有对象即 active」分支（`:140`）。实测：`coordination.availability(scope)`（async，领域返回 `{status, scope, durability, operations, backend, epoch}`）公共面返回 `{status:'active'}`；`security.availability` 是 getter 且顶层无 `status`（`lib/security-owner.js:546`），公共面恒为 `active`；`tasks.availability` 的 `unknown`/`unsupported` 同样折叠为 `active`；`workspaces.transactions.availability` 在运行时与 registry 中都不存在。

**目标**：(1) 标准三值直接透传；(2) 非标准状态按固定映射——`unsupported` → `unavailable`，`unknown` / `inert` → `degraded`，并保留领域 token 作为 `reason`；(3) 领域对象的其余字段（`scope` / `durability` / `operations` / `backend` / `epoch` / `faces` 等）一并保留在同一冻结对象中，装饰器只做状态归一不做裁剪；(4) 删除「解析成功即 active」分支，无法判定时按 capability 描述符回退；(5) 公共 `availability()` 必须同步返回——异步领域解析（coordination）改为在挂载期完成并缓存，`availability()` 只读缓存。

**理由**：`api-idioms` §3.7 明文要求 coordination 的 availability 说明 durability / operations / backend / epoch，而 §2 的「至少含 status」被实现读成了「只留 status」，两册在同一成员上正面冲突——这是分册缺陷而非实现偷懒，故 §4-S4 同步修订分册。**反方案**：保持统一外形并把 detail 移到新成员（否：新增成员即新增能力，且违反 §3.7 对 `availability` 本身的字段要求）。

### K5 观察面分层与公共 handle

**现状**：`events.observe`（host）、`planMode` / `permissionPresets` 已返回标准四成员 handle 且 dispose 后订阅为 no-op；client `events.observe`、`llm.routing.observe`、`mcp.observe`、`diagnostics.observe` 返回裸退订函数；`sessions.activity.observe` / `executions.observe` 直接返回**内部可变记录**（含 `listeners` Set、`disposed`、`stale`、`signal`、`abortHandler`，未冻结，dispose 后订阅抛 `TypeError`）；`tasks.observe` 返回冻结 handle 但 dispose 后订阅抛错；`sessions.channels.observe()` 没有订阅语义（见 C4）。

**目标**：(1) 订阅入口统一 `observe`，返回冻结的 `{ current(), subscribe(listener), dispose(), epoch }`；(2) `subscribe(listener)` 返回退订函数；handle 已释放时 `subscribe` 为 no-op（返回 no-op 退订函数），回调异常只降级该监听者；(3) 观察 handle 只含公共成员，内部记录私有；(4) 查询与订阅分离（快照成员用 `get` / `list` / `inspect` / `history` / `current`）；(5) `epoch` 语义保持「订阅代次」，不用于业务排序。

**理由**：跨端同名不同形（host 有 handle、client 只有裸函数）会让 host 写法在 client 直接崩；内部记录外泄使调用方能静默断流。**反方案**：冻结内部记录后原样返回（否：指引 §5-C5 已证会破坏内部 dispose / epoch 更新，故必须另建外部 handle）。

### K6 operation 结果、handle 与控制对象

**现状**：`sessions.request` 用 `operation` 承载 handle（对齐 registry）；`workflows.start` 用 `handle`；`executions.recovery.checkpoints.restore` 同时给出 `handle`（真 handle）与 `operation`（只读状态快照），且成功码为 `started`（registry 记录为 `accepted|completed`），`handle.observe` 返回对象而非退订函数；`tasks.start/settle/attach` 的 `operation` 字段是**动词字符串**且不返回任何操作身份；四个域的 `status()` 词汇各不相同（`phase/terminal`、`state`、`phase/attempts`）。

**目标**：(1) 发起结果统一 `{ ok, code, operation, ... }`，`operation` 是控制对象 handle；`terminal` 仅在发起时已可裁决时出现（缺失走已登记例外）；(2) handle 统一 `{ id, ownerId, status(), observe(), dispose() }` 加已登记领域扩展；(3) `tasks.start/settle/attach` 的动词串字段改名为 `action`，并按语义归类为**带例外的 operation**（控制对象是 durable task/attempt 身份，经 `tasks.get/observe` 观察；不铸造第二套操作身份）；(4) `checkpoints.restore` 的 `operation` 快照并入 `handle.status()`，成功码与 registry 对齐，`handle.observe` 返回退订函数；(5) 领域 `status()` 词汇可以不同，但字段名与终态词汇统一（终态使用 `success | error | aborted | denied | superseded`）。

**理由**：通用「取控制对象 → observe → dispose」代码要在三个域成立；`tasks` 的 `operation` 字符串会让 `res.operation.status()` 直接抛 `TypeError`。**反方案**：给 `tasks` 硬造长操作 handle（否：指引 §4-B1 明确禁止凭字段名造长操作；task 的 authority 在任务注册表，门面不铸造第二身份）。

### K7 contribution 结果与 pending handle

**现状**：四种形状并存——client `slots.contribute` 返回官方裸 disposer（同步）；client `remotes.contribute` 返回 `Promise<裸退订函数>`；client `settings.remote.contribute` 返回 `Promise<{status, face, render, dispose}>`（`status` 充当成功标志）；host `settings.remote.contribute` 返回裸 disposer；`prompts.contribute` 与两处 `attention.contribute` 已符合标准（判别式结果 + `{id, ownerId, seq, dispose()}`）。

**目标**：`contribute(spec)` 一律返回冻结判别式结果 `{ ok, code, reason?, handle }`，handle 为 `{ id, ownerId, seq, dispose() }`；生效异步的贡献（client remotes / settings.remote）在调用返回时即给出 pending handle，其 `status()` 扩展成员报告 `{ state: 'pending' | 'active' | 'failed' | 'revoked', reason? }`，`dispose()` 在任一状态下安全（该扩展按 §3 登记例外）；同步生效的官方挂载入口内部保留原挂载 / 租约 / 重绑定逻辑。

**理由**：`api-idioms` §3.5 要求异步贡献「完成前提供可安全 dispose 的 pending handle」；当前 client 两处迫使调用方用 Promise 链承担撤销责任，host/client 又不同形。**反方案**：保持 `Promise<handle>`（否：pending 期无法撤销，且与 host 不同形）；把 client 语义拉平成同步（否：官方挂载本身异步，会伪造同步语义）。

### K8 canonical producer 判定

**现状**：`lib/events-bus.js:639` 的 `dispatch(mode, name, args)` 只校验事件名是否在目录内，随后直接调用 `ctx[mode]`，无任何 producer 判定；registry 为 `events.emit/serial/parallel/bail/waterfall` 登记 `authority: "event producer authority"` 但运行时未落实。`events.define` 已是 owner-scoped publisher（拒绝 canonical 名与重名、owner 由调用上下文派生、stale 返回 `{ok:false, code:'stale'}`）。

**目标**：派发前按事件目录条目声明的 producer 归属判定——调用者若为该事件的 producer owner 才放行；否则返回冻结 `{ ok:false, code:'denied', reason }`（保持 `operation` 派发变体不产生独立 operation 身份、不重试的既有语义）。事件目录中未声明 producer 的条目默认 fail-closed（第三方不可派发），并与 `observation` / `notification` 语义区分登记。门面自身的事实生产路径（转译官方事件、replacement 行派发官方事件）经内部 owner 身份取得权限，不走第三方路径。

**理由**：`api-idioms` §4、`composition-and-authority` §8、`domain-composition` 的 `events` 行三处都要求「订阅权不等于生产权」，但没有任何一册定义 producer 映射的承载方式——这是分册只写了半句的地方，故 §4-S9 补模型。**反方案**：把派发入口下沉到 `services.*` 规避判定（否：指引 §4-B3 明确禁止「靠移动入口规避问题」）；保持现状并登记 bypass（否：registry 已声明 authority，登记会与实现永久矛盾）。

**能力边界变化声明**：K8 使第三方经门面派发 canonical 系统事件从「可用」变为「typed denied」，属能力边界收紧；第三方自定义事件路径（`events.define`）不受影响。该变化须在交付报告中单列，并同步 `AGENTS.md` §4 第 3 条与 feature-list（§4-S9）。

---

## §2 逐成员处置映射

处置列含义：**修复**＝本线改实现；**例外**＝保留并登记六项；**已修复**＝公开面已符合、仅剩登记或内部残留；**误报**＝核验不成立。锚点均按符号定位，行号随开发漂移。

### §2.1 主线 A（注册 / 贡献 / 观察）

| 编号 | 公共 path | 证据锚点 | 当前实际形状 | 目标（K 项） | 处置 / 落点 |
|---|---|---|---|---|---|
| A1 | `tools.register` / `tools.restrict.register` | `lib/plugin-api-service.js:470-531`（scoped）、`:528-531`（global） | 全局分支透传官方裸 disposer；scoped 分支返回冻结 `{id, ownerId, targetId, dispose()}`，`dispose()` 返回布尔；scope 失败已无全局退化 | K1/K2：两分支同形 `{id, ownerId, generation, dispose()}`；`targetId` 作为领域扩展保留并登记 | 修复 / `lib/plugin-api-service.js`（+ `lib/scoped-agent-contributions.js` 记录 token） |
| A2 | `llm.requestTransforms.register` | `lib/llm-request.js:153`、`:702`；facade `lib/plugin-api-service.js:2375` | 裸身份绑定 disposer；同 id 重复注册直接抛错（无 owner 维度，与登记 `owner-conflict`/latest-wins 不符） | K1/K3：门面派生 owner、铸造 generation、返回标准 handle；同 owner 同 id latest-wins、跨 owner typed conflict | 修复 / `lib/llm-request.js`（facade 包装） |
| A2 | `llm.admissionPolicies.register` | `lib/llm-input-policy.js:53`；facade `:2378` | 同上（裸 disposer、重复 id 抛错） | 同上 | 修复 / `lib/llm-input-policy.js` |
| A2 | `llm.routing.policies/candidates/health.circuitPolicy/health.probe.register` | `packages/agent-loop/lib/route-policy.js:154`（identityOf）、`:238`（createRegistrationRegistry）；facade `:2320`、`:2325`、`:2333`、`:2335`、`:948` | 调用方自报 `id`/`ownerId`/`generation`；注册表单键 `id` 存储，跨 owner 同 id 静默覆盖；返回裸布尔 disposer | K1/K3：facade 注入派生 owner 与铸造 generation；注册表增加 owner 维度与跨 owner 冲突判定 | 修复 / **R 落点**：`packages/agent-loop/lib/route-policy.js` + facade 注入 |
| A2 | `llm.providers.register` | `lib/index.js:868` | 官方可调用 handle，附未登记成员 `.replace` | K1/K2：包装为标准 handle，`.replace` 作为显式成员保留并登记 | 修复 / `lib/index.js` |
| A2 | `llm.models.register` | `lib/index.js:874` | 官方裸 disposer（签名 `(settingsNs, discover)`） | K1：标准 handle；官方签名与错误映射保留 | 修复 / `lib/index.js` |
| A2 | `attachments.pipeline.transforms.register` | `packages/attachments/lib/pipeline-service.js:673`；facade `invoke` 策略 `lib/plugin-api-service.js:1025` | 成功返回裸 disposer、失败返回 `failure(...)` 对象；facade 的兜底 catch 把一切异常折叠为 `ATTACHMENT_UNAVAILABLE`（公共面**永不抛**） | K1 + 失败边界（§6）：注册失败一律 typed throw；同 owner 同 key 静默覆盖改为冲突判定 | 修复 / `packages/attachments`（R 包扩展面）+ facade 调用策略 |
| A2 | `remotes.register`（host） | `lib/host-remote.js:45`、`lib/remote-publication.js:198` | 裸幂等 disposer；同 key 不同 service 已抛冲突 | K1/K2：标准 handle | 修复 / `lib/remote-publication.js` |
| A2 | `diagnostics.register` | `lib/diagnostics.js:462` | 裸 disposer；`ownerId` 必填自报；非法输入抛裸 `TypeError` | K1/K3：派生 owner、标准 handle、typed 输入错误（错误信息列出合法 scope 的既有优点保留） | 修复 / `lib/diagnostics.js` |
| A2 | `tools.discovery.catalog.register` | `lib/tool-discovery.js:196`、`:228` | 返回 `{generation, dispose()}`（缺 `id`/`ownerId`）；`owner` 由调用方自报字符串并进入 generation | K1/K3：标准 handle；owner 派生 | 修复 / `lib/tool-discovery.js` |
| A3 | `prompts.provenance.policy.register` | `lib/context-engine.js:753`（`registerPolicy`）、`:193`（priority 排序） | `(fn, {priority, name})`；返回 `{ok:true, disposer}` / `{ok:false, code:'INACTIVE'|'CONTRIBUTION_INVALID', detail}`；未知 priority 静默按默认档 | K1 + policy idiom（`register(spec)` 含 `id`/`priority`/`decide`）、typed throw、priority 词表校验、owner 派生 | 修复 / `lib/context-engine.js` |
| A4 | client `slots.contribute` | `lib/client-slots.js:21`、`lib/client-runtime.js:309` | 同步返回官方裸 disposer | K7：判别式结果 + 标准 contribution handle | 修复 / `lib/client-slots.js`（+ 重建 `lib/client.js`） |
| A4 | client `remotes.contribute` | `lib/client-remote-contribution.js:22` | 同步返回 `Promise<裸退订函数>` | K7：pending handle | 修复 / `lib/client-remote-contribution.js` |
| A4 | client `settings.remote.contribute` | `lib/client-settings-remote.js:46` | `Promise<{status, face, render, dispose}>`；`status` 充当成功标志 | K7：判别式结果 + handle（`face`/`render` 作为领域扩展成员保留） | 修复 / `lib/client-settings-remote.js` |
| A4 | host `settings.remote.contribute` | `lib/settings-remote.js:56`；facade `:2197` | 同步返回裸 disposer | K7：判别式结果 + handle | 修复 / `lib/settings-remote.js` |
| A4 | `prompts.contribute`、client/host `attention.contribute` | `lib/plugin-api-service.js:1315`、`lib/client-attention-face.js:151`、`lib/attention-hub.js:365` | 已是判别式结果 + `{id, ownerId, seq, dispose()}` | K7：保持；client `attention.contribute` 外层结果改为冻结 | 已修复（仅冻结外层结果）/ `lib/client-attention-face.js` |
| A5 | host `events.observe` | `lib/events-bus.js:541`、`:588` | 标准四成员冻结 handle；dispose 后订阅 no-op | K5：保持（handle 行登记文案按 K5 更新） | 已修复 / 登记同步 |
| A5 | client `events.observe` | `lib/client-official-events.js:41`、`lib/client-runtime.js:294` | 裸退订函数；目录仅 4 个事件；未知名抛 `TypeError` | K5：标准 handle + 可查询事件目录 + typed 未知结果 | 修复 / `lib/client-official-events.js` |
| A5 | `llm.routing.observe` | `lib/session-route.js:329`；facade `:2348` | 裸退订函数（需 `session` 参数，名称易被读成命名空间级订阅） | K5：标准 handle；`forExecution` 语义保留，成员名与参数保持 | 修复 / `lib/session-route.js` |
| A5 | `mcp.observe` | `packages/mcp/lib/catalog.js:206`；facade `:1021` | 裸 cordis disposer | K5：标准 handle | 修复 / **R 落点**：`packages/mcp/lib/catalog.js` |
| A5 | `diagnostics.observe` | `lib/diagnostics.js:653`、`:582` | 裸 disposer；owner 释放后订阅静默失效 | K5：标准 handle；失效以 `degraded`/epoch 语义表达 | 修复 / `lib/diagnostics.js` |
| A5 | `sessions.activity.observe` / `executions.observe` | `lib/session-activity-observe.js:67`、`:121`；`lib/execution-observation.js:92` | 返回内部可变记录（`listeners` Set / `disposed` / `stale` / `signal` / `abortHandler`）；dispose 后订阅抛 `TypeError` | K5：另建外部冻结 handle；内部记录私有；dispose 后订阅 no-op | 修复 / `lib/session-activity-observe.js`、`lib/execution-observation.js` |
| A5 | `sessions.planMode.observe` / `sessions.permissionPresets.observe` | `lib/sessions-plan-mode.js:437`、`lib/sessions-permission-presets.js:531` | 标准 handle；dispose 后 no-op | K5：保持，作为全树订阅语义基准 | 已修复（基准） |
| A5 | `tasks.observe` | `lib/task-execution-observation.js:1249` | 冻结 handle（含 `taskId`/`initialState` 扩展），但 dispose 后订阅抛错 | K5：订阅语义对齐（no-op） | 修复 / `lib/task-execution-observation.js` |

### §2.2 主线 B（操作 / 身份 / 权限）

| 编号 | 公共 path | 证据锚点 | 当前实际形状 | 目标 | 处置 / 落点 |
|---|---|---|---|---|---|
| B1 | `sessions.request` | `lib/session-interaction-operation-normalize.js:337`、`lib/session-interaction-operation-authority.js:292` | `operation` 为 handle，`observe` 返回退订函数，`dispose()` 返回 `{ok, code:'accepted'|'stale'|'unavailable'}` | K6：外层补 `terminal` 缺失例外登记；`dispose()` 改为「请求停止」码 `requested`/`stale` | 修复（轻）/ `lib/session-interaction-operation-authority.js` |
| B1 | `workflows.start` | `lib/workflows-facade.js:135`、`lib/workflows-operation.js:60` | `handle` 承载句柄；`status()` 用 `state`；`dispose()` 返回 `Promise`；`cancel` 返回 `undefined` | K6/K2：字段名改 `operation`；`dispose()` 返回 `{ok, code:'requested'|'stale'}`；run authority 与 `meta`/`result`/`cancel` 扩展保留（已登记例外） | 修复（轻）/ `lib/workflows-operation.js` |
| B1 | `executions.recovery.checkpoints.restore` | `lib/checkpoint-restore.js:366`、`:392`、`:411` | `handle` 为句柄、`operation` 为只读快照；成功码 `started`（登记为 `accepted|completed`）；`handle.observe` 返回 `{ok, current, subscribe, dispose}` 对象 | K6：字段名改 `operation`；快照并入 `status()`；成功码对齐；`observe` 返回退订函数；恢复阶段与资格控制保留 | 修复 / `lib/checkpoint-restore.js` |
| B1 | `tasks.start` / `tasks.settle` / `tasks.attach` | `lib/task-execution-observation.js:511`、`:596`、`:916`、`:973`、`:1148`、`:1215` | `operation` 为动词字符串；无操作身份；结果含 `taskId` 与领域 payload | K6：动词串改名 `action`；归类为带例外的 operation（控制对象 = durable task/attempt，经 `tasks.get/observe` 观察） | 修复 + 例外 / `lib/task-execution-observation.js` |
| B2 | 身份自报面（见 K3 清单） | 同 K3 各锚点 | 自报 owner / 自报 generation；跨 owner 同 id 静默覆盖（routing）或并存（security） | K3：派生 + 铸造 + 冲突判定 + `identitySource` 如实登记 | 修复 / 各属主模块 |
| B3 | `events.emit/serial/parallel/bail/waterfall` | `lib/events-bus.js:639`、`:854`；wiring `lib/index.js:667`、`lib/plugin-api-service.js:1542`、`:2748` | 仅校验事件名在目录内即派发，无 producer 判定；返回冻结 `{ok, code:'dispatched'|'unsupported'|'error', outcome}`（registry `currentShape` 记为 "returns undefined"，已漂移） | K8：producer 判定 + typed `denied`；目录条目承载 producer 归属；`observation`/`notification` 条目 fail-closed | 修复 / `lib/events-bus.js`（+ `lib/capability-matrix.js` 事件目录登记） |
| B3 | `events.define` | `lib/events-bus.js:686` | owner-scoped publisher；拒绝 canonical 名与重名；stale 返回 `{ok:false, code:'stale'}` | K8：保持；作为第三方自定义事件的唯一受支持派发路径在分册中固定 | 已修复（基准） |

### §2.3 局部必修与修剪 C1–C14

| 编号 | 主题 | 证据锚点 | 当前实际形状 | 目标 | 处置 / 落点 |
|---|---|---|---|---|---|
| C1 | availability 归一失真 | `lib/namespace-availability.js:130-174`；`lib/coordination-lease.js:222`；`lib/security-owner.js:546`；`lib/plugin-api-service.js:3057` | 非标准状态与「解析成功」都报 `active`；领域 detail 全丢；coordination 为 async、security 顶层无 `status` | K4 全项 | 修复 / `lib/namespace-availability.js`（+ coordination 缓存、security 状态化） |
| C1b | `workspaces.transactions.availability` 缺席 | `lib/plugin-api-service.js:2993`、`:3007` | 运行时与 registry 均无该成员（`workspaces.availability` 存在） | 子命名空间补齐 `availability()` 并登记 namespace 记录 | 修复 / `lib/plugin-api-service.js` + registry |
| C2 | client 自描述失真 | `lib/client-runtime.js:57`、`:410`、`:283` | capability 仅认 14 个根名；非 `sessions`/`attention`/`services` 一律「对象存在即 active」；`connection`/`events`/`remotes`/`settings`/`slots`/`codec` 六个已登记 `availability` 成员运行时缺失；client `sessions`/`attention` 反有成员而未登记；`lifecycle.availability(faceId, ownerId)` 返回 face 快照而非三值 | K4/Req 10.3：补齐六命名空间 availability、接受成员级 dot path、按真实叶子状态报告、登记对齐 | 修复 / `lib/client-runtime.js` + 各 client 模块 |
| C3 | slots 白名单拒绝真实槽位 | `lib/client-slots.js:82` | 前缀正则仅接受 `root`/`details`/`shell.overlay`/`settings.*`/`sidebar.*`/`conversation.*`；官方 `tool.call.toolview`（`dsh-client-ui-tool/lib/client.js:1606`）被 `TypeError` 拒绝；`list` 对「未声明」与「已声明为空」同返回 `[]`；官方 `spec`/`specDynamic`/`declarationEpoch`/`snapshot` 未暴露 | Req 10.1/10.2：准入交官方声明判定；暴露只读声明投影（含 `declarationEpoch`） | 修复 / `lib/client-slots.js`（+ 重建 `lib/client.js`） |
| C4 | `sessions.channels` 名不符实 | `lib/session-channel-project.js:25`、`:32`；`lib/session-channel-core.js:290`；facade `:3343` | `observe()` 返回一次性深度冻结快照 `{channels, subscriptions, connectionState}`（无订阅、无 handle）；内部 `onChange` 未公开；`list` 实为需 channel/subscription 身份 + cursor 的事件帧拉取 | Req 5.4/5.5：快照 → `current()`；订阅 → `observe(listener)` 标准 handle；事件帧拉取改名（建议 `history({...})`，属 api-idioms §3.1 允许的查询动词）；`ack` 与订阅身份保留 | 修复 / `lib/session-channel-project.js` + facade |
| C5 | 观察 handle 泄漏内部记录 | `lib/session-activity-observe.js:67`、`lib/execution-observation.js:92` | 见 A5 行 | K5 | 修复 / 同 A5 |
| C6 | `agents.providers.register` 键嗅探 | `lib/agent-create-api.js:146` | 依 `factory`/`announce`/`agent` 键存在性分派，返回官方 effect disposer / `undefined` / detach closure 三态；未知键无稳定错误 | Req 9.4：显式变体判别（形如 `kind`）、非法输入列出合法变体、各变体返回标准 handle 或登记例外；官方 factory/announce/enter 语义与 owner 传参保留 | 修复 / `lib/agent-create-api.js` |
| C7 | client `connection.get` 实为设置 API | `lib/client-runtime.js:288`、`lib/client-connection.js:26` | 门面自建 `Proxy({})`，逐属性转发官方 settings，`Object.keys()` 为空、同名属性每次返回新闭包 | Req 10.5：改名为反映对象角色的导航成员（`connection.api.settings`），与 `pluginApi.settings` 职责区分；不新增重复 authority | 修复 / `lib/client-runtime.js`（+ registry `connection.api.settings` 行） |
| C8 | `settings.scope` 双端结构不同 | `lib/settings.js:59`；`lib/client-settings-scope.js:5` | host：`scope(ns)` → 门面 handle（需先 `settings.register`）；client：`scope.bind({namespace, decode})` → 官方 scope（`getSnapshot/subscribe/set/unset`） | Req 10.6：统一**调用套路**为可调用成员（client 暴露 `scope(spec)`，内部沿用 `bind`）；返回对象差异（门面 handle vs 官方 scope）作为环境差异显式登记，不做机械抹平 | 修复（调用套路）+ 登记（返回差异）/ `lib/client-settings-scope.js` |
| C9 | prompts 匿名 id 与错误词表 | `lib/plugin-api-service.js:1340`、`:2446`、`:1321`、`:1337` | 全局匿名 id `anonymous:<seq>`、scoped 匿名 id `scoped:<kind>`（同 owner/target 第二个同 kind 必冲突）；kind 非法时错误不列合法值 | Req 9.6：两条路径共用同一匿名 id 规则；错误列出合法 kind 词表 | 修复 / `lib/plugin-api-service.js` |
| C10a | `registerMinimalCatalogUpdate` 残留 | `lib/index.js:1974`、`:1979`；facade `:3273` | **公开面已不含该名**（只暴露 `policy.register`）；内部 owner 对象仍保留该名，且 `packages/tool-skill/lib/apply.js:308` 只提供该名，facade 回退分支为实际承载 | 保持公开面现状；内部残留与回退分支显式登记，不删除（删除会切断 tool-skill 替代行） | 已修复（公开面）/ 登记同步 |
| C10b | active/disabled 成员集合漂移 | `lib/decision-participation-facade.js:444`（disabled）、`:228`（active） | disabled 形态含 `admitted()`，active 形态没有；`events.decisions` 两形态都有；registry 无任何 `*.admitted` 行 | Req 9.5：两形态成员集合一致；`admitted` 补登记或内化 | 修复 + 登记 / `lib/decision-participation-facade.js` + registry |
| C10c | `agents.scopes` handle 与登记关系 | `lib/scoped-agent-contributions.js:275`、`:329` | handle `{id, ownerId, generation, target, status(), dispose()}`，`status()`→`usable`/`destroyed`，`dispose()`→`{status:'ok'|'stale'}` | K2 统一 `dispose()` 结果码；`status()` 领域词汇保留并登记；**leaf 行 `failureSemantics: typed-throw` 与自身 `currentShape` 矛盾** ⇒ 登记修正 | 修复（dispose 结果）+ 登记修正 / `lib/scoped-agent-contributions.js` |
| C11 | 缺位 / 不可用词汇 | `lib/session-activity-view.js:15`、`:92`；`lib/execution-observation.js:140`；`lib/sessions-interactions-facade.js:276`；`lib/task-execution-observation.js:1224`、`:1369` | `absent`（activity，且与非法输入合并）、`undefined`（executions.get）、`missing`（interactions.get，已正确区分 unavailable）、`{ok:true, found:false}`（tasks.get）、`unavailable`（tasks.history 对「不存在」） | 统一：确定不存在 → `missing`；无法得知 → `unavailable`；成功只读视图不带 `ok` 合法（`activity.list/history` 保持） | 修复 / 四个属主模块 |
| C12 | settings mutation 呈现 | `lib/official-host-namespaces.js:318`；registry 三行记为 `discriminated-result` | 直通官方 `Promise<void>` 并抛官方错误，无 `commitState` | mutation idiom：包装为冻结 `{ok, code, commitState, generation}`；官方 revisions/CAS 语义与错误映射保留 | 修复 / `lib/official-host-namespaces.js` |
| C13 | `storage.open.handle.domain` | `lib/storage-binding.js:201`；`:205`；registry 行 `removed/migrate` | 运行时 handle 仍含 `domain`（官方 domain handle，`table()`/`keys()`/`delete()`），且 `purge` 依赖它；registry 记「已删除、迁往 `services.storage`」；`storage.availability` 只返回 `{status:'active'}` 与自身 `currentShape` 不符 | 判定：**保留** `domain` 并把 registry 行改回 retained，理由登记为「owner-scoped 记录访问面，无等价公共替代」；`storage.availability` 按 K4 补齐 scope/durability/epoch | 修复（登记 + availability）/ `lib/storage-binding.js` + registry |
| C14 | `capabilityMatrix` 内容模型 | `lib/capability-matrix.js`；facade `:2047`；registry 行 `selfDescription` | 100 行静态矩阵，含 `renamed`/`merged`/`migrated`/`deleted`/`internalized` 迁移词汇与已删除旧 path | Req 4：保留成员（api-idioms §2 已授权），**改内容模型**为「当前能力簇 + 当前状态 + 限制/缺口原因」，迁移词汇移出运行时可见输出（保留在 registry 的登记面） | 修复 / `lib/capability-matrix.js` |

### §2.4 核验补充（registry 自身缺口）

| 编号 | 缺口 | 锚点 | 处置 |
|---|---|---|---|
| R1 | `lifecycle.register.handle` 有行，但无 `lifecycle.register` leaf 行（`lifecycle.registerFace` 记为 removed） | registry members / `lib/client-generation-rebind.js:1045` | 补 leaf 行并核对旧路径映射 |
| R2 | 三个 domain namespace 的 `admitted()` 无 registry 行 | `lib/decision-participation-facade.js:228`、`:444` | 随 C10b 一并补登记或内化 |
| R3 | `diagnostics.register.handle` 的 `currentShape` 为 `null` | registry members | 随 A2 修复补齐 |
| R4 | `events.emit` 的 `currentShape` 记为 "returns undefined"，实际返回判别式结果 | `lib/events-bus.js:854` | 随 B3 修复同步登记 |
| R5 | `storage.availability` 的 `currentShape` 与实现不符 | `lib/storage-binding.js:205` | 随 C13 同步 |
| R6 | `capabilityMatrix` 行 `currentShape` 为 `null`；client 面 `events.observe` 无独立行（仅 host 行） | registry members | 随 C14 与 A5（client 行）同步补齐 |

---

## §3 idiom 归类与例外变更

现状：registry 共 **17 行**带六项例外的成员记录，对应 **16 个**公共 path（`sessions.interactions.respond` 的 host 与 client 两行各带一条同文案例外，属合法双运行时登记，非重复）。本线原则：**例外净额不增加**（Req 11.5）。为使该原则可判定，本线随 §4-S1/S6 明确一条分类规则：**handle 上的领域扩展成员按公共 path 单独登记即可，不再需要六项例外；六项例外只保留给「外层合同偏离」（入口动词、结果形状、失败呈现、身份成员集与 baseContract 不一致）**。据此：

**重分类（3 条，从例外降为扩展成员登记）**：

- `workflows.start.handle.meta`：现例外理由是「handle 携带 engine-validated meta block」——这是附加数据成员而非外层合同偏离，改为普通 handle 成员行。
- `agents.scopes.register.handle`：现例外理由是「scope-bound handle extension members target / status()」——同上；`status()` 的领域词汇（`usable`/`destroyed`）按 S6 保留并登记。
- `llm.adapters.decorations.register.handle`：按 S1 的新分层规则（`additive` ⇒ `{ id, ownerId, seq, dispose() }`）补齐身份成员，`snapshot()` 作为扩展成员登记，例外理由「caller-bound facet」不再成立。

**保留（其余 14 条记录）**：`events.define` 与 `events.define.handle`、`agents.register`、`sessions.channels.ack`、`tools.executionPolicies.register`、`events.decisions.register`、`profiles.snapshot.validate`、`sessions.compaction.run`（外层结果缺 operation 身份）、`workflows.start`（terminal 缺失）、`executions.recovery.checkpoints.planRestore`、`sessions.interactions.respond`（host/client 两条）、`sessions.selection.get`、`sessions.selection.set`。

**新增（2 条）**：

- `tasks.start` / `tasks.settle` / `tasks.attach`（合一条）：operation idiom，但外层结果不含 `operation` handle 与 `terminal`；理由为「控制对象是 durable task/attempt 身份，由 `tasks.get/observe` 提供，门面不铸造第二套操作身份」；`replacementShape` 记录 `{ ok, code, action, taskId, task, terminal? }`；`verification` 指向任务语义分类测试。
- 异步 contribution handle 的 `status()` 扩展（client `remotes.contribute` / `settings.remote.contribute`，合一条）：handle 为 `{ id, ownerId, seq, dispose(), status() }`，`status()` 取 `pending|active|failed|revoked`；理由为 api-idioms §3.5 要求 pending 期可撤销且失败可观察。

**净额**：17 − 3 + 2 = **16**，不高于现状。

---

## §4 分册修订清单（双向对齐正式载体）

每条给出：分册与条款 → 问题（证据） → 修订方向 → 同步面 → 是否需人类确认。**本清单与实现必须一致（Req 11.2）**：修订未落盘前，实现不得先落新形状；修订落盘后，实现不得保留未登记的反向例外。

| 编号 | 分册 · 条款 | 问题（证据） | 修订方向 | 同步面 | 人类确认 |
|---|---|---|---|---|---|
| S1 | `api-idioms.md` §2、§3.2、§3.6 | §2 说 `generation` 只是并发控制令牌、注册顺序用 `seq`，§3.2/§3.6 却要求所有 policy/registry handle 必含 `generation`；纯 additive 注册无代次可比（`llm.adapters.decorations.register.handle` 直接放弃身份成员） | handle 必备成员按 composition 分层：`coordinated`/`ordered` ⇒ `{ id, ownerId, generation, dispose() }`；`additive`/`pure` 注册 ⇒ `{ id, ownerId, seq, dispose() }` | registry handle 行 + `scripts/registry-validate.mjs` entry 级校验 | 否 |
| S2 | `api-idioms.md` §3.2/§3.6 与 `public-api-shape.md` §5 | §3.2 说注册错误「不返回 `ok:false`」，§5 说不可用成员「返回或抛出」；实现因此分裂（registry 42 个注册入口登记 typed-throw，`prompts.provenance.policy.register` 却返回 `{ok:false, code, detail}`） | 定一条可判定分界：**注册（policy / resourceRegistry）失败一律 typed throw**；**contribution / mutation / operation / coordination 失败一律判别式结果**（环境不可用在该 idiom 下映射为 `inactive`/`unavailable` 码）。两册写入同一句话 | registry `failureSemantics` 词表 | 否 |
| S3 | `api-idioms.md` §2、`composition-and-authority.md` §5.1 | 两册只承认「派生的 owner」一个维度，被机械套用到所有名为 owner 的参数（security/diagnostics/storage/transactions/client lifecycle/prompts 覆盖位） | 区分并命名两个概念：`ownerId`（调用者身份，一律派生）；资源所属者 / 目标 scope 以领域参数命名并单独登记。`identitySource` 词表增加 `derived-caller` / `declared-resource-scope` 两值 | registry `identitySource` 词表 + 各成员行 | 否 |
| S4 | `api-idioms.md` §2、§3.7；`namespace-availability` 实现契约 | §2「至少含 status」被实现读成「只留 status」，与 §3.7「coordination 的 availability 必须说明 durability/operations/backend/epoch」正面冲突，导致 `unknown`/`unsupported` 报 `active` | 写明：外层三值 + **领域 detail 保留**；非标准状态映射表（`unsupported`→`unavailable`、`unknown`/`inert`→`degraded`，附 `reason`）；禁止「有对象/解析成功即 active」；异步领域解析须在挂载期完成 | registry `availabilityShape` 字段 + 各 namespace 记录 | 否 |
| S5 | `api-idioms.md` §2 | 只说「幂等 dispose()、stale 返回 no-op 或结果」，未定返回形状，实现出现四种（布尔 / Promise / `{ok,code}` / `{status}`） | 统一：普通 handle `dispose()` 返回冻结 `{ ok, code, reason? }`，资源类码 `revoked`/`stale`，operation 类码 `requested`/`stale`；coordination `release(handle)` 例外保留 | registry `lifecycle` 字段文案 | 否 |
| S6 | `identity-and-lifecycle.md` §3、`api-idioms.md` §2 | §3 规定了 `outcome`/`commitState`/`lifecycleState` 字段名，但未定义 handle `status()` 的取值域，实现出现 `usable`/`destroyed`、`ok`/`stale`、`phase`/`state` 多套 | 补 handle 生命周期小节：`status()` 承载资源/操作生命周期（领域词汇可不同，但字段名与终态词汇统一）；`lifecycleState` 与 `terminal` 不得混用 | registry `lifecycle` 文案 + §3 例外复核 | 否 |
| S7 | `api-idioms.md` §3.1 | 只写「缺位或降级返回降级视图或 typed unavailable result」，未定缺失词汇，实现出现 `absent`/`missing`/`undefined`/`found:false` 四套 | 补缺位词汇表：确定不存在 ⇒ `missing`；无法得知 ⇒ `unavailable`；成功只读视图不带 `ok` 合法 | registry `failureSemantics` 与相关行 | 否 |
| S8 | `public-api-shape.md` §2、§3.6、§4 | host 树仍列 20 个已 `removed` 的 `on`/`once`/`onChange` 成员；client 树只有 8 个领域（运行时 14 个，缺 `sessions`/`attention`）；§3.6「最多两层 namespace 后接方法」与现实的 4 层领域（`llm.routing.health.circuitPolicy` 等）不符，且未说明 handle 成员是否占层级预算 | 树图按 registry 现状刷新；层级规则改为「叶子路径总段数上限 + 强领域关系白名单」，并明确 handle 成员（`*.register.handle`）不占领域层级预算 | §2 树图、§4 client 树、§9 registry 指针 | 否 |
| S9 | `api-idioms.md` §4、`composition-and-authority.md` §8、`domain-composition.md` events 行 | 三册都要求「订阅权不等于生产权」，但没有一册定义 event → producer owner 的映射承载、门面自身生产路径如何取得权限、无声明 producer 事件的行为 | 补 producer 模型：映射由 canonical 事件目录条目承载（`producerAuthority`）；未声明者 fail-closed；门面内部生产路径以内部 owner 身份取得权限；第三方一律 `events.define` | registry `eventCatalog` 行 + `AGENTS.md` §4 第 3 条 + feature-list §3.1 | **是**（能力边界收紧，见 K8） |
| S10 | `capability-strategy.md` §6、`api-idioms.md` §2 | `services.*` 用官方 `isActive`、语义面用 `availability().status`，两套口径未在分册承认（registry 已有 4 条 `availabilityExemption`）；`capabilityMatrix()` 被 §2 授权保留，但内容为迁移账本 | §6 写明 passthrough 存在性口径为例外；§2 为 `capabilityMatrix()` 补内容定义（只表达当前能力与限制，迁移账本留在 registry） | registry `servicesWhitelist`、`capabilityMatrix` 行 | **是**（该册 §9 要求实质修订经人类确认） |
| S11 | `docs/standards/README.md` | 分册索引与各册适用范围未随本轮修订更新 | 索引同步（如新增/改写条款涉及范围描述） | 索引表 | 否 |

> 说明：S9 与 S10 的「人类确认」是分册治理条款自身的要求（`capability-strategy.md` §9、K8 能力边界变化），不是本线新增的范围请求。其余修订属分册维护，按 AGENTS §6 的规范目录义务落盘。

---

## §5 owner / authority / 生产权模型

**身份三层**（本线固定，取代现状的混合用法）：

1. **caller identity**（`ownerId`）：由调用上下文派生（fiber / 插件装配身份 / loader entry），门面内部经 `callerIdentityOf` / `deriveAdapterRegistrationOwner` 一类机制解析；不可追踪时用根 token，并在 registry 记 `identitySource: derived-caller (root-fallback)`。
2. **resource scope / 目标**：领域参数（如 scoped tools 的 `targetId`、`storage` 的 `scope`、contributions 的 `target`），显式、可读、不冒充身份。
3. **generation**：由拥有该资源的 owner 铸造的 owner-specific opaque token，只用于判定「旧状态/旧回调是否已被取代」，不跨 owner 比较，不承载排序（排序用 `seq`）。

**冲突规则**：同 owner 同 id 按成员 idiom 决定（policy/registry = latest-wins 或内容等价幂等；contribution = 稳定冲突码）；**跨 owner 同 id 一律 typed owner-conflict**（含 routing 注册表，见 §2 A2）。stale handle 的 `dispose()` 返回 `{ok:false, code:'stale'}` 且绝不撤销新 generation 的资源。

**生产权**：canonical 事件的 producer 归属由事件目录条目承载；派发判定见 K8。门面自身的转译生产路径（例如把官方事件映射为门面事实、replacement 行派发官方事件）以内部 owner 身份登记，不占用第三方路径。订阅侧（`observe` / `events.define` 的消费）保持 additive。

**authority closure**：本线不新增写路径；对 `storage.open`（保留 `domain`）、`settings` mutation（包判别式结果）、events 派发（加 producer 判定）三条路径，按 `composition-and-authority` §6 在 registry 的 `bypasses` 字段写明是否旁路高层 authority，无旁路者记录「闭合」。

---

## §6 失败路径与 guard

1. **注册 vs 结果的失败分界**（S2）：注册成员（policy / resourceRegistry）失败抛 typed error（输入非法、owner-conflict、环境不可用）；contribution / mutation / operation / coordination 返回判别式结果。`attachments` 的泛化 `invoke` 兜底 catch 必须收窄到操作类调用，注册类调用不得被折叠为 `ATTACHMENT_UNAVAILABLE`。
2. **stale 与并发**：所有 `dispose()` / `release` / 注册撤销按身份判定（owner + key + generation），旧 handle 不得删除新 owner 的资源（`concurrency-and-cancellation` §5）。
3. **回调 containment**：观察 handle 的 listener 异常只降级该监听者；domain reducer 的策略回调异常只降级该决策点（现状保持）。
4. **fail-safe 不回归**：门面 entry 的 apply 仍不得抛穿；client 根面懒挂载逐叶隔离不变；新增的 availability / capability 探针不得抛穿（`availability()` 无副作用、不抛）。
5. **R 包修订的守卫**：`packages/agent-loop`（routing 注册表 owner 维度）、`packages/attachments`（注册返回与冲突）、`packages/mcp`（observe handle）三处修订后，必须复核替代行对被替代官方行的 ctx 服务面 / 事件面复刻完整（R2）、boot 自检仍通过（R4）、组件 owner 唯一（R6）；不得改动被禁用的官方行 id 或插入顺序。
6. **client 生成物**：`lib/client.js` 为生成物，任何 client 侧源改动后必须经 `npm run build:client` 重建并核对产物 diff 仅含预期变更；`--check` 必须一致。
7. **阻塞登记**：无法达成的必需行为按 Req 13.6 登记（原因 + 最小解除动作 + 是否需人类授权 + 日期），不以降级呈现充当完成。

---

## §7 装配影响与落点

**热点共享文件**（建议集中串行修改，避免多线并行改同一 root 时丢能力）：`lib/plugin-api-service.js`（4017 行，公共根装配与逐成员转发）、`lib/index.js`（3220 行，replacement/facade 装配）、`lib/client-runtime.js`（500 行，client 根）、`lib/namespace-availability.js`（归一装饰器）、`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`（事实源，825KB）。

**逐成员落点汇总**（详表见 §2）：

| 落点 | 涉及的处置项 |
|---|---|
| `lib/plugin-api-service.js` | A1、C1b、C9、C14 装配面、B3 wiring、`prompts.contribute` 冻结 |
| `lib/llm-request.js`、`lib/llm-input-policy.js` | A2（llm transforms / admission） |
| `lib/index.js` | A2（providers / models）、C10a 登记 |
| `lib/tool-discovery.js`、`lib/diagnostics.js`、`lib/remote-publication.js`、`lib/host-remote.js`、`lib/settings-remote.js` | A2 注册面 |
| `lib/context-engine.js` | A3 |
| `lib/session-activity-observe.js`、`lib/execution-observation.js`、`lib/session-route.js` | A5、C5、C11 |
| `lib/task-execution-observation.js` | B1（tasks）、A5（tasks.observe）、C11 |
| `lib/session-interaction-operation-authority.js`、`lib/workflows-operation.js`、`lib/checkpoint-restore.js` | B1 |
| `lib/events-bus.js` | B3/K8 |
| `lib/namespace-availability.js`、`lib/coordination-lease.js`、`lib/security-owner.js`、`lib/storage-binding.js`、`lib/official-host-namespaces.js` | C1、C12、C13 |
| `lib/decision-participation-facade.js`、`lib/scoped-agent-contributions.js`、`lib/agent-create-api.js` | C10b、C10c、C6 |
| `lib/client-runtime.js`、`lib/client-slots.js`、`lib/client-official-events.js`、`lib/client-remote-contribution.js`、`lib/client-settings-remote.js`、`lib/client-settings-scope.js`、`lib/client-connection.js` | A4、A5、C2、C3、C7、C8（全部含 `lib/client.js` 重建） |
| `packages/agent-loop/lib/route-policy.js` | A2（routing，**R 包**） |
| `packages/attachments/lib/pipeline-service.js` | A2（attachments，**R 包**） |
| `packages/mcp/lib/catalog.js` | A5（mcp，**R 包**） |
| `docs/standards/*`（12 册） | §4-S1–S11 |
| `public-contract.registry.json` | 全部形状变更 + §2.4 的 R1–R5 缺口 |
| `scripts/registry-validate.mjs`（扩展） | §8 的 entry 级机械校验 |
| `docs/specs/plugin-api-features/feature-list.md`、`README.md`、`AGENTS.md` §4 | 登记与治理同步（S9/S10 确认后） |

**装配等价性**：本线不改变 full 与选择性安装的行集合，不新增 R 行；替代包内部修订后仍满足「全量与选择性装配同一组主包行与替代行」。

---

## §8 验收与证据映射

验收句（goal）：*开发者学会一种登记、贡献、观察或操作套路后，能在 host/client 的其他同类接口上直接复用，而不必重新学习身份、返回值和清理方式。*

| # | 验收场景（指引 §8） | 证据形态 |
|---|---|---|
| 1 | 同一工具从全局改为 agent scope，外层 handle 与清理方式不变 | 组合测试：同一定义两条路径断言 handle 成员集与 `dispose()` 结果一致 |
| 2 | 两个插件登记同名资源时冲突行为明确，旧 handle 不能撤销新资源 | 双 synthetic 插件组合测试（owner 冲突 + stale dispose） |
| 3 | 同一策略在 llm / prompts / security 以可迁移方式登记 | 三个域共用一段注册→释放代码的迁移切片 |
| 4 | host/client 观察对象与释放层次可预测 | 观察 handle 形状断言（含 client） + 内部记录不外泄断言 |
| 5 | client remote/slot/settings 贡献同一外层合同，pending 阶段可撤销 | client 贡献三成员结果形状 + pending dispose 测试 |
| 6 | session request / workflow start / checkpoint restore 取控制对象方式一致 | 三域 `res.operation` + `status()/observe()/dispose()` 的形状矩阵测试 |
| 7 | 真实工具视图槽位可经门面使用 | `tool.call.toolview` 的 contribute/list 通过测试 + 声明投影 |
| 8 | channels 快照 / 订阅 / 事件帧不误导 | `current()` / `observe()` / `history()` 三成员语义测试 |
| 9 | 能力缺席/不支持/未知不报 active；协调 durability/operations 可达 | availability 矩阵测试（含 `unknown`/`unsupported` 映射与 detail 保留） |
| 10 | 公共观察 handle 不暴露内部 listeners/可变状态 | 冻结与成员集断言（activity/executions） |
| 11 | canonical 系统事实与第三方自定义事件生产角色明确 | producer denied 测试 + `events.define` 正向测试 |
| 12 | C1–C14 每项都有处置结论 | 处置表（§2）与交付台账核对，无误报未标注 |

**机械校验**：`scripts/registry-validate.mjs` 扩展 entry 级断言——入口动词与 idiom 一致、handle 成员集按 composition 一致（S1 规则）、`dispose()` 结果形状与登记一致、`generation`/`seq`/`epoch` 未混用、每个 namespace 的 `availability` 存在性（`availabilityExemption` 除外）、失败呈现与 `failureSemantics` 一致。不做反射式的全树运行时一致性引擎（避免过度设计）；运行时形状断言只覆盖本线触及成员。

**跑测口径**：`npm test`（4G 内存护栏内）全绿；`node scripts/convergence-verify.mjs` 通过；`npm run build:client:check` 一致；`git diff --check` 干净；治理 token 审计、官方包零修改审计、版本冻结审计通过。

---

## §9 风险、取舍与排除

**主要风险与对策**

1. **「统一」做成「强行同形」**：领域差异（coordination `release`、`services.*`、workflow run authority、checkpoint 恢复阶段、task 生命周期词汇、`status()` 领域取值）必须走六项例外机制，逐条附 `reason` 与 `verification`；例外总数不增（§3）。
2. **分册修订先于实现**：修订未落盘前不落新形状，避免「改标准迁就实现」；S9/S10 需人类确认，确认前两者保持现状并在处置表标注为待确认阻塞。
3. **R 包修订触碰替代契约**：三处 R 落点改动后必须复核 R2/R4/R6 并跑既有替代包测试；若某处无法在不破坏契约复刻的前提下完成，登记为阻塞项（不自行扩大 R 范围）。
4. **availability 透传导致装饰器变「第二实现」**：装饰器只做状态归一与字段保留，不解释、不合成领域字段；领域必须自己给出标准状态或可映射状态。
5. **热点文件冲突**：`plugin-api-service.js` / `index.js` / `client-runtime.js` / registry 集中串行修改；并行开发按 AGENTS §3.5 契约先行，共享文件编辑边界与合并顺序随任务书下发。
6. **验收退化为「测试总数」**：证据必须是真实公共入口执行（含双插件组合与迁移切片），不以 import 扫描、路径计数、测试总数充当等价证据。

**明确排除（指引 §6，本线不予处置）**：SDK、TS 化、API reference 生成、发布包装、开发者培训、测试完备性工程；同步/异步差异本身；接受结果没有终态；operation 内部阶段与领域 payload 差异；coordination `release(handle)`；`services.*` 保留官方习惯；question pending/answer seam、per-session grant、pairing-required 等受官方能力限制的场景；不默认新增 MCP 注册平台、异步完整请求改写、凭据系统、动态 remote 发现；不做假想攻击的安全加固；不新增 R 点。

**取舍记录**：本线唯一的加性成员是 C3 的 slots 只读声明投影（承载官方已有的 `spec`/`declarationEpoch`/`snapshot` 事实，用于区分「未声明」与「已声明为空」），不新增根、不新增注册平台，登记为 projection 成员；`tasks.*` 不铸造操作 handle（保留 domain authority，登记例外）；`storage.open.handle.domain` 保留而非删除（无等价公共替代，删除会切断唯一记录访问面）；`connection.get` 改名而非保留（消除与 `pluginApi.settings` 的重复 authority）；`settings.scope` 只统一调用套路、不强行统一返回对象（环境差异真实存在）；`capabilityMatrix` 改内容模型而非内化（api-idioms §2 已授权该成员，内化反而需要改两册）。

---

## §10 standards 分册适用性与对齐结论（AGENTS §3.4）

| 分册 | 适用性 | 对齐结论 |
|---|---|---|
| `capability-strategy.md` | 适用（R 类边界、`services.*`、公共面减法、客户端半面） | 本线不新增 R 点、不改白名单成员集合；`services.*` 存在性口径与 `capabilityMatrix` 内容模型列入 S10（需人类确认）；替代包内部修订按 R2/R4/R6 复核 |
| `api-shape.md` | 适用（三面边界与一面原则） | 逐成员归类复核：注册面收口不改变各 feature 的主面；`tasks` 归类与 `checkpoints.restore` 字段修正不新增 mutation authority |
| `api-idioms.md` | 核心适用 | 本线主战场：入口动词、handle、失败呈现、availability、owner、generation/seq/epoch、终态、事件语义；修订见 S1/S2/S5/S6/S7/S9 |
| `public-api-shape.md` | 适用（namespace 与 capability 粒度） | 不新增顶层 namespace；client 能力路径提升到成员级；树图与层级规则修订见 S8 |
| `composition-and-authority.md` | 适用（组合模式、owner、authority closure、preflight） | owner 双角色（S3）、跨 owner 冲突、`bypasses` 登记、双插件组合验收 |
| `domain-composition.md` | 适用（各领域最低要求） | 逐领域对照：`events`（生产权）、`llm.routing`（owner/id 隔离与 reducer）、`agents.providers`（多 owner 与 singleton）、`tools`、`prompts`、`sessions.channels`、`tasks`、`storage`、`security`、`diagnostics`、`settings`、`remotes`、`mcp` |
| `ordering.md` | 部分适用 | 本线只涉及 priority 词表校验（provenance policy）与事件 producer 边界，不新增排序基础设施 |
| `identity-and-lifecycle.md` | 适用 | 身份三层模型（§5）、generation 语义、终态词汇与 `status()` 字段关系（S6） |
| `durable-state-and-scope.md` | 部分适用 | 涉及 `tasks` / `checkpoints` / `settings` mutation 的 operation 能力声明与 `commitState`；本线不改 scope 分层 |
| `visibility-and-redaction.md` | 部分适用 | 观察 handle 不外泄内部状态、注册与诊断不泄漏他人状态；不新增可见性规则 |
| `concurrency-and-cancellation.md` | 适用 | `dispose()` 语义（K2）、stale 结果、取消与终态分离、R 包异步生命周期 |
| `versioning-and-protocols.md` | 适用（冻结基线） | 不步进任何版本字段；装配等价与 `dsh.api` 协商不变 |

---

## §11 交付物与阶段边界

**本阶段（Stage 0–2）交付**：`goal.md`、`requirements.md`、`design.md`（本文），作为**一个** feature 的一次提交。

**后续阶段入口**：Stage 3（Tasks）按 §1 内核 → §2 映射 → §4 分册修订的依赖顺序编排；Tasks 必须覆盖 A/B 主线与 C1–C14 及 §2.4 的 R1–R5，合理例外与误报写明排除理由，不得静默漏项；Stage 3 经阻塞对抗性审查通过后直接进入 Stage 4，全部完成后做一次全局终审。

**本线不产出**：`tasks.md`、任何实现代码、任何分册正文修订（S9/S10 待人类确认；其余按阶段落盘）、`temp/` 依赖。
