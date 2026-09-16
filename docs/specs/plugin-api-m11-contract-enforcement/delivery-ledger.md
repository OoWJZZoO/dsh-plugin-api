# Stage 4 交付台账: plugin-api-m11-contract-enforcement

> feature_name: `plugin-api-m11-contract-enforcement`
> milestone: M11
> 状态：**Stage 4 续做中（in progress，未收口）**。Stage 3 审查门四轮闭合（见 `tasks.md`「Stage 3 审查门记录」）；Stage 4 按 `tasks.md` 顺序推进：§1 记第一轮交付范围，**§3.0 记本轮（2026-09-15 续做）的完成与未完成清单**，§3 的 B1–B20 逐条登记随之更新。本线**未达到 Stage 4 完成判定**；全局终审结论见 §7。
> 执行口径：版本冻结基线内（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`），**未步进任何版本字段**；未新增 R 点；官方包零修改。
> 工作流纪律（`AGENTS.md` §3.2「Stage 4 连续执行纪律」，本轮落盘）：Stage 3 审查门通过后，除**硬停机点**与**环境 / 工具链 / 权限缺失**两类因素外，不得以批次边界、会话长度、上下文占用、任务规模或已交付部分成果为由终止未完成的主体工作；未完成项不得登记为「阻塞项」。

## 1. 已交付范围（本轮提交，逐项可复核）

基线与计数口径：`tasks.md` P1 的 `3469` 是本线**开工时**（提交 `cf2a2d1`）的测试总数；本线自身新增契约内核测试 11 条，故台账 §2 记「本线实现批次前的 3480」为**含内核批次的中间基线**。交付时的总数见 §2。

| 交付块 | 内容 | 落地 | 台账声称的边界 |
|---|---|---|---|
| 契约内核 | `lib/contract-kernel.js`：判别式结果、资源/贡献/操作 handle、观察 handle（K1/K2/K5/K6/K7 的共用形状）。**零 harness 依赖**（全文零 `import`、纯函数） | 新增 + `test/contract-kernel.test.mjs`（11 断言） | 仅覆盖「可释放对象」的共用形状；**不含**异步 contribution 的 pending `status()` 状态机（见 B7） |
| 分册修订 S1–S15 | `api-idioms`（generation 定义、身份双角色、dispose 结果、availability detail 与归一表、缺位词汇、失败呈现分界、扩展成员/例外边界、terminal 在场条件、异步 contribution `status()`、同步/异步声明、生产者模型）、`public-api-shape`（host/client 树逐名刷新、层级预算、capability 示例修正）、`identity-and-lifecycle`（handle 生命周期面）、`composition-and-authority`（owner 双角色、producer 判定）、`domain-composition`（events 行）、`capability-strategy`（`services.*` 存在性口径例外）、`README`（索引） | `docs/standards/*` | 分册条款**已全部落盘**；S1/S2 在**未收口成员**上的实现一致性按 §4 与 B2 处理 |
| canonical 事件生产权 | 运行时事件目录条目携带 producer 声明（facade / official 两态）；`dispatch()` 在派发前判定——非 producer 返回冻结 `{ok:false, code:'denied'}` 且**不派发**，未声明者 fail-closed；门面转译路径以内部 owner 身份取得权限；官方原生 `ctx.emit` 不经 `dispatch()` 不受影响；`events.define` 语义不变 | `lib/events-bus.js` + 全部 `lib/*-events-catalog.js` + `test/events-producer-authority.test.mjs`（15 断言） | 见 §6 的**能力边界变化**单列 |
| host 注册面收口 | `tools.register` 双形态同形、`tools.restrict`、`tools.guard`、`tools.presentation`、`llm.requestTransforms`、`llm.admissionPolicies`、`llm.routing` 四类（**R 包**）、`remotes`、`tools.discovery.catalog`、`prompts.provenance.policy`（policy 形状 + typed throw + priority 词表校验）、`agents.providers`（显式变体判别）、`attachments.pipeline.transforms`（**R 包**，含把 facade 的注册类兜底 catch 收窄为 typed throw 穿透）、`diagnostics.register` —— 一律冻结标准 handle + 派生 owner + 铸造 generation | `lib/{plugin-api-service,llm-request,llm-input-policy,host-remote,remote-publication,tool-discovery,context-engine,agent-create-api,diagnostics}.js` + `packages/{agent-loop,attachments}` | 冲突规则**按各成员 idiom，逐成员如实**：`llm.requestTransforms` / `llm.admissionPolicies` / `llm.routing` 四类 / `prompts.provenance.policy` 跨 owner 同 id 为 typed owner-conflict；`tools.register` 的 **scoped** 路径冲突键是 `(owner, target, id)`（跨 owner 同 id 不受 owner 维度判定），**全局**路径保留官方内容语义；`tools.discovery.catalog` 按 entry id 冲突；`diagnostics.register` 为 per-owner latest-wins（跨 owner 同 checkId **并存**）；`tools.guard`/`tools.presentation` 仅包裹官方注册、**门面不做冲突判定**；`remotes.register` 的冲突键是 key |
| 观察面收口 | `sessions.activity.observe`、`executions.observe`、`tasks.observe`、`llm.routing.observe`、`mcp.observe`（**R 包**）、`diagnostics.observe` —— 冻结四成员 handle；内部可变记录闭包私有；释放后订阅 no-op；listener 异常只降级自身；`current()` 释放后返回降级视图 | `lib/{session-activity-observe,execution-observation,session-route,task-execution-observation,diagnostics}.js` + `packages/mcp` | **不含** host `events.observe`、`sessions.planMode.observe`、`sessions.permissionPresets.observe`、`events.define.handle` 的 dispose 收口（见 B8） |
| 操作控制对象 | `sessions.request`、`workflows.start`、`executions.recovery.checkpoints.restore` —— 控制对象统一在 `operation`，`dispose()` 返回 `requested`/`stale`，只读快照并入 `status()`，`observe` 返回退订函数并首投当前状态，`terminal` 仅在返回时可裁决时出现 | `lib/{session-interaction-operation-authority,workflows-operation,workflows-facade,checkpoint-restore}.js` | `tasks.start/settle/attach` 的动词串改名**未做**（见 B1） |
| availability 归一（装饰层） | 领域 detail 保留、非标准状态映射（`unsupported`→`unavailable`、`unknown`/`inert`→`degraded`，原 token 作 `reason`）、删除「解析成功即 active」、异步领域解析**首次探针惰性启动并缓存**（该次返回 descriptor 回退，其后读缓存）使公共探针始终同步 | `lib/namespace-availability.js` | **域侧子项未做**：`coordination.availability` 的缓存化、`security.availability` 的状态化（两文件本轮零改动），见 B9 |
| 缺位词汇（部分） | `executions.get`、`tasks.get`、`tasks.history` 按「确定不存在 ⇒ `missing` / 无法得知 ⇒ `unavailable`」 | `lib/{execution-observation,task-execution-observation}.js` | 余下点位（如 `lib/session-activity-view.js` 的 `absent`）**未做**，见 B10 |
| registry 与机械校验 | **共 57 行**随之落盘（56 改 + 1 增；可复核口径：以 `cf2a2d1` 的 `members` 为基线逐行比对 `runtime|publicPath` 与字段，实测注册面 **32** + 观察面 **10** + 贡献面 **2** + 操作面 **9** + 缺位词汇 **4** = 57）：注册面 32 行（`tools.register`/`restrict`/`guard`/`presentation`、`llm.requestTransforms`/`admissionPolicies`/`routing` 四类、`agents.providers`、`remotes`、`tools.discovery.catalog`、`prompts.provenance.policy`、`attachments.pipeline.transforms`、`diagnostics.register` 的 leaf 与 handle 行）、观察面 10 行（`executions`/`tasks`/`llm.routing`/`mcp`/`diagnostics` 的 `observe` 及其 handle 行，并**补入缺失的 `tasks.observe.handle` 行**）、贡献面 2 行（`prompts.contribute` 及其 handle 行）、操作面 9 行（`events.{emit,serial,parallel,bail,waterfall}` 的判别式结果与 producer 判定 = 5、`executions.recovery.checkpoints.restore` 及其 handle 行 = 2、`workflows.start` 及其 handle 行 = 2）、缺位词汇 4 行（`executions.get` / `tasks.get` / `tasks.history` / `storage.availability`）；`scripts/registry-validate.mjs` 新增两条 entry 级校验；差异表 `docs/specs/plugin-api-m10-contract-convergence/convergence/public-member-table.md` 随 registry 机械重建（**538 行**），并新增其重建入口 `scripts/convergence-table-sync.mjs` | registry + `scripts/*` | 校验面仅新增两条（见 §4）；**例外台账重分类（Task 3.3）未做**，见 B4；成员行数由 537 增至 538 是**补入缺失的 handle 行**，不新增公共能力（`oldToTargetMapping` 同步补行） |

## 2. 跑测与审计（本轮实际结果）

| 项目 | 结果 |
|---|---|
| `npm test`（4G 内存护栏内） | **3562 / 3562 通过**（开工基线 3469；第二轮交付 3524；第三轮 3549；复审修订轮 3556）。复审修订轮新增的断言集中在 `test/client-observation-handles.test.mjs`（新：三个 client 观察入口的 handle 形状、`current()` 语义、释放后行为与缺服务时的 typed 拒绝）、`test/client-self-description.test.mjs`（成员级 capability path 与未知成员的 typed 拒绝）、`test/client-slots.test.mjs`（抛错的声明查询判 `unavailable`）、`test/client-remote-events.test.mjs`（`dispatch` 判别式结果与缺载体拒绝）、`test/dual-plugin-composition.test.mjs`（真实 diagnostics owner 的检查回调查错隔离）、`test/migration-slices.test.mjs`（第二身份与伪造 ownerId 的派生断言）、`test/host-namespace-integration.test.mjs`（settings mutation 的 `invalid-input` 分支）、`test/policy-inventory.test.mjs`（matrix 状态由已发布 path 派生） |
| `node scripts/registry-validate.mjs <registry>` | `registry valid`（exit 0） |
| `node scripts/convergence-verify.mjs` | `559 member rows, 37 behavior rows, 37 fully linked behavior rows`（exit 0；行数演进 538 → 539 → 546 → 551 → 559：546 来自补入七个 client 现行 leaf 行，551 来自第三轮补入四个 decision `admitted()` 行与 `workspaces.transactions.availability` 行，559 来自复审修订轮一次性补入的**八**行——`slots.declaration` 与另外七条 client 现行行 `remotes.observe` / `remotes.dispatch` / `lifecycle.observe` / `lifecycle.list` / `codec.validate` / client `sessions.availability` / client `attention.availability`；中间不存在 552 行状态；行为表 37 行冻结、装配表 token 未变） |
| `npm run build:client:check` | `client bundle is up to date with its sources`（exit 0；复审修订轮 client 侧源码有改动——`client-runtime`（成员级 capability path、`slots.observe` 门禁）、`client-slot-events` / `client-remote-events`（标准观察 handle、`dispatch` 判别式结果）、`client-generation-rebind`（变化 epoch + 观察 handle）、`client-slots`（声明查询抛错判 `unavailable`）——bundle 已重建，产物 diff 仅含预期变更） |
| 治理 token 审计 | `node --test test/governance-token-audit.test.mjs` 2/2 通过。复审修订轮把审计从「代号/标签」扩展到 **prose 形态的工作流编号**（`Req` / `Task` / `Stage` / `SPEC` + 数字），并据此清掉实现与测试里 16 处历史泄漏（checkpoints、session-interaction 两族注释与测试头），另把两处包级 bundle 自审计词表改为拼接写法；registry 自身作为治理制品保留其 provenance 字段（审计对该文件只跑「代号 + 标签 + catalog 字段」三面） |
| 版本冻结审计 | `package.json` 与 registry `contractBaseline` 零 diff |
| 官方包零修改审计 | `/usr/lib/node_modules/@deepseek-ai/dsh/**` 本轮无修改 |
| R 落点契约复刻 / boot 自检 | `packages/agent-loop` 45/45、`packages/attachments` 39/39、`packages/mcp` 103/103 全绿 |

**顺带修复（工程前置）**：`test/session-channel-rate-limit.test.mjs` 的 `windowMs: 1` 与调度器竞速，属**本线开工前既有的偶发失败**（同一提交上 3 次运行中 1 次失败）；已把窗口放宽到 100ms / 等待 200ms，语义不变。该项与本 feature 无关，仅用于保证交付门的可重复性。

## 3.0.2 处置结论表（Task 10.1(a) / B16a）

按输入编号全集逐项给出四态结论（**修复** / **合理例外** / **已修复（开工前即为正确形态）** / **误报**）与锚点。未闭合者指向 §3.0.1 的余项。

| 编号 | 结论 | 证据锚点 |
|---|---|---|
| A1 同步 `llm/request` | 已修复（开工前） | `llm.requestTransforms.register` 返回标准 handle + 派生 owner；本轮把 caller 绑定从共享 slot 改为 per-caller leaf |
| A2 `llm/admission` | 已修复（开工前） | `llm.admissionPolicies.register` 同上；`resolveModelInfo` 包装保留为隐藏实现 |
| A3 / A4 / A5 Remote 与设置桥 | 已修复（开工前） | `remotes.register` / `settings.remote.contribute` / client `settings.remote.contribute`（本轮改为 pending handle + 惰性 `face`/`render`） |
| A6 `routeOf` 深挖 | 已修复（开工前） | `exec.route` 经 `agent.session.requestContext()`；`executions.recovery.*` 与 routing 四类在本线收口 |
| B1 `sessions.request` | 已修复 | 控制对象统一在 `operation`，`dispose()` 返回 `requested` / `stale` |
| B2 `workflows.start` | 修复 + 合理例外 | 字段改名 + `dispose()` 判别式；`meta` / `result` / `cancel` 作为已登记领域扩展（例外已按 S12 回收，见 §3.0.1） |
| B3 `executions.recovery.checkpoints.restore` | 已修复 | 字段名 `operation`、只读快照并入 `status()`、`observe` 返回退订函数 |
| C1 availability 归一 | 已修复 | `lib/namespace-availability.js` 三值 + detail 保留；域侧 `coordination` / `security` / `storage` 均已状态化 |
| C1b `workspaces.transactions.availability` | 已修复（第三轮） | `lib/plugin-api-service.js` + registry 行 + 测试 |
| C2 client 自描述失真 | 已修复（第三轮） | 七个 namespace 的 `availability()` 与 `capabilities.*` 同源 probe 表 |
| C3 slots 白名单 + 投影 | 已修复（两轮） | 准入交官方声明判定（前轮）+ `declaration` / `list` 状态（第三轮） |
| C4 client 面重复与语义 | **部分完成** | client 侧三成员语义前轮交付；host `sessions.channels` 的 `current` / `history` / `observe` 映射仍未收敛（见 §3.0.1 未完成清单） |
| C5 client `remotes` / `slots` 观察面 | 已修复 | 标准观察 handle + `slots.observe` |
| C6 `agents.providers.register` | 已修复 | 显式变体判别 + 标准 handle + 派生 owner |
| C7 client `connection.get` | 修复（回滚） | 改回 `connection.api.settings`，三处登记同步（见 §3.0.1 回滚记录） |
| C8 `settings.scope` 双端套路 | 已修复（第三轮） | client `scope(spec)` 与 host 同套路，环境差异登记 |
| C9 `prompts` 匿名 id 与错误词表 | 已修复（第三轮） | scoped kind 拒绝列出合法词表；匿名 id 规则两端一致 |
| C10a `registerMinimalCatalogUpdate` | 合理例外 | 公开面已不含该名；内部回退分支保留并登记（删除会切断 tool-skill 替代行） |
| C10b `admitted()` 登记 | 已修复（第三轮） | 四个 decision namespace 的 `admitted()` 补实现 + 补行 |
| C10c `agents.scopes` | 已修复 | typed throw 失败呈现 + 判别式 dispose + 扩展成员改行登记 |
| C11 缺位词汇 | 已修复 | `missing` / `unavailable` 分界落 `executions.get` / `tasks.*` / `sessions.activity.*` |
| C12 settings mutation 呈现 | **已修复**（第三轮） | `facadeSettingsMutation`：冻结判别式 + `commitState`，官方 revisions/CAS 与错误映射保留 |
| C13 `storage.open.handle.domain` | 已修复（第三轮） | registry 行改回 retained + 理由；实现本就保留 |
| C14 `capabilityMatrix` 内容模型 | **已修复**（第三轮） | 当前能力投影 + 生成物重建入口 `scripts/capability-matrix-sync.mjs` |
| C15 handle 行互指 | 已修复（第三轮） | 两行 `currentShape` 互指 |
| C16 `events.compaction` 示例 | 已修复 | `public-api-shape` §5 示例改为真实 capability path |
| C17 `async` 声明 | **未完成** | 依赖 §3.0.1 的 B5 |
| R1 `lifecycle.register` leaf 行 | 已修复 | registry 现行 leaf 行已补 |
| R2 三个 domain namespace 的 `admitted()` | 已修复（第三轮） | 与 C10b 同一件工作 |
| R3 `diagnostics.register.handle` | 已修复 | `currentShape` 随实现更新 |
| R4 `events.emit` 等五行的 `currentShape` | 已修复 | 判别式结果 + producer 判定已登记 |
| R5 `storage.availability` | 已修复 | 补 `scope` / `durability` / `epoch` |
| R6 `capabilityMatrix` / client `events.observe` 行 | 已完成 | client `events.observe` 现行行已补；`capabilityMatrix` 行随 C14 落盘，复审修订轮再按「状态由已发布 path 派生」改写 |

## 3.0.3 复审修订轮（2026-09-15 续做，第四轮）完成与未完成清单

本轮自 `70d1f72`（第三轮端到端复核通过点）起执行，修订对象是第三轮交付的**阻塞级与中低级别评审意见**，以及评审过程中暴露出的同类缺口。**已完成**（实现 + 测试 + registry/validator 同步；每项都可按文件复核）：

| 评审项 | 内容 | 落地 |
|---|---|---|
| **阻塞 B1**（`settings.scope` 两行错位） | host `settings.scope` 行被写成了 client 语义、client 行仍是旧文本：host 行恢复为「按命名空间名查询已登记 handle，未知命名空间以 typed namespace 错误拒绝」，client 行改写为 `scope(spec)` 的真实形状（绑定官方 scope 对象并原样返回；非法 spec 抛 typed `TypeError`；host/client 差异作为环境差异登记） | registry |
| **阻塞 B2**（`client|slots.declaration` 无行） | 补 `client|slots.declaration` 现行行，成员表机械重建 | registry + `convergence/public-member-table.md` |
| **B2 同类缺口（评审未列，本轮全量枚举发现）** | 对 client 公共面做「实现 → registry」逐路径枚举，补入 7 条缺失的现行 leaf 行：`remotes.observe`、`remotes.dispatch`、`lifecycle.observe`、`lifecycle.list`、`codec.validate`、client `sessions.availability`、client `attention.availability`；client `sessions` / `attention` 两条 namespace 记录的 `availabilityMember` 由 `null` 改为实名（原 `availabilityExemption: "client root availability()"` 与 `AGENTS.md` §4「该例外只适用于 `services.*`」冲突，已清除）；成员行 551 → 559 | registry + 成员表 + `test/convergence-capability-sweep.test.mjs` 覆盖面随之扩大 |
| **Req 5.1 合规（评审未列，本轮枚举时发现）** | 三个 client 观察入口原先返回**裸退订函数**，与「`observe` 返回 `{ current(), subscribe(listener), dispose(), epoch }`」不符（若按例外登记会顶破 Req 11.5 的例外上限），故改实现：`slots.observe(event)` / `remotes.observe(event)` / `lifecycle.observe()` 一律回答标准观察 handle（`current()` 是真实读面、native 源随 handle 存活、内部记录不外泄、释放后不再投递）；`remotes.dispatch` 按「派发型 operation」改为返回判别式结果（官方结果进 `outcome`、载体拒绝报 typed 码而非抛出）；缺载体时 `dispatch` / `observe` 一律 typed 拒绝，不再静默吞帧 | `lib/{client-slot-events,client-remote-events,client-generation-rebind,client-runtime}.js` + client bundle + `test/client-observation-handles.test.mjs`（新，4 条）+ 相关套件改断言 |
| **Req 4.5 / Task 8.4（评审 M2）** | client `capabilities.get/require` 由「只认 14 个根名」改为同时接受**成员级 path**（`slots.contribute`、`remotes.observe`、`codec.validate`…）：成员存在性由 namespace 的**活面**判定，未知成员以 typed capability-unavailable 拒绝（不继承状态）；`services` 与四个自描述根不参与成员寻址（前者是官方 passthrough 聚合、成员的 `isActive` 属官方口径）；`list()` 仍回答命名空间根清单并在 `currentShape` 写明成员 path 由 registry 登记面清单承载 | `lib/client-runtime.js` + client bundle + registry 三行 + `test/client-self-description.test.mjs`（新增 1 条） |
| **M1（治理编号 prose 泄漏）** | 审计新增 prose 编号模式并清除实现/测试内 16 处 `Requirement N` / `Task N` 注释；两处包级 bundle 自审计词表改拼接写法 | `test/governance-token-audit.test.mjs` + 12 个源文件 |
| **M3（两处断言不具有鉴别力）** | ① `test/dual-plugin-composition.test.mjs` 的「回调失败隔离」原先只是在测试体内 `try/catch` 抛错，现改为挂**真实 diagnostics owner**：plugin-a 的检查回调抛错 → 该检查落 `failed` + `probe-failed`（不穿透门面），plugin-b 的检查保持 `healthy/active`，释放 plugin-a 后只剩 plugin-b 的检查；② `test/migration-slices.test.mjs` 第二切片的 owner 断言原先对 llm 侧是桩里**写死的常量**，现改为桩从门面传入的调用者上下文读取，并追加「第二个身份得到自己的 owner」与「声明 `ownerId` 被忽略」两组反例 | 两个套件 |
| **M4（幻影 handle 行）** | `tasks.acquire.handle` 行自述「不返回 lease handle」，属幻影登记：按既有两处幻影行的处置退役（`status: removed` + `migrationAction: delete` + `oldToTargetMapping` 退役说明），成员表随之重建 | registry + 成员表 |
| **L1（不可达分支）** | `facadeSettingsMutation` 的 `invalid-input` 分支比较的是不存在的错误码（实际的类是 `PLUGIN_API_SETTINGS_NAMESPACE_NOT_FOUND`），改为按错误类型判定；补断言：未登记命名空间的写回答 `{ ok: false, code: 'invalid-input' }` 而非泛化 `error` | `lib/index.js` + `test/host-namespace-integration.test.mjs` |
| **L2（声明查询抛错被误判）** | client `slots.declaration` 原先吞掉 `slots.spec(key)` 的异常并报 `missing`（把「无法得知」说成「确定不存在」）：改为 `unavailable`，且失败查询不贡献任何官方事实 | `lib/client-slots.js` + `test/client-slots.test.mjs`（新增断言） |
| **L4（matrix 状态是常量）** | `capabilityMatrix()` 的状态/限制改为**由已发布 path 派生**：簇的设计 path 全部已发布 ⇒ `active`；部分未发布 ⇒ `degraded` 且 `limitations` 精确列出未发布的 path；全部未发布 ⇒ `unavailable` 且带 `gapReason`；无任何 path 证据的簇不再冒充 `active`（不进入运行时投影）。同时补入 12 个已交付簇的空缺 path 证据（`sessions.request` / `sessions.cancel` / `attention` / `executions.recovery.checkpoints*` / `sessions.activity.attempt-facts` / `client.sessions` / `client.attention`），修正 `client.connection` 簇仍指向已退役 `connection.get` 的设计目标，并把 `connection.get → connection.api.settings` 补进 `oldToTargetMapping` / `statusByPath`；生成器补 main 守卫以便单测导入 | `lib/capability-matrix.js`（生成物，89 簇）+ `scripts/capability-matrix-sync.mjs` + `test/policy-inventory.test.mjs`（派生断言 + 合成 registry 的 degraded/unavailable 分支单测）+ registry |

**同轮 spec 订正（Stage 4 发现 spec 与实测不符，按 §3.2 就地修订对应文档）**：

| 文档 | 订正 |
|---|---|
| `docs/specs/plugin-api-m11-contract-enforcement/design.md` §3 净额段 | 例外台账的执行实测值与设计预测不同：实测为记录 20 − 6 + 4 = 18、成员行 17 − 4 + 4 = 17、公共 path 16 − 4 + 4 = 16（预测是 20 → 17 / 17 → 16 / 16 → 15）。多出的一条是 `tasks.register`——Task 3.4 新增的 entry 级校验要求注册类 leaf 的失败呈现为 typed throw，而它返回判别式结果且不铸造 handle，故与 `tasks.start`/`tasks.settle`/`tasks.attach` 同批登记；三口径仍**不高于** Req 11.5 上限（17 行 / 20 记录 / 16 path）。（**第十四轮注**：该行是订正当时的记录；复核轮随后为 `agents.register` 追加了第 19 条例外记录，HEAD 实测为 19 记录 / 17 行 / 16 path） |
| `docs/specs/plugin-api-m11-contract-enforcement/tasks.md` Task 3.3 | 同步上述实测净额与「新增 4 条记录 / 4 行」 |
| `public-contract.registry.json`（`tasks.start` / `tasks.settle` / `tasks.attach` 三条例外记录） | `replacementShape` 的成功码由 `accepted` 订正为各成员真实的领域码 `started` / `settled` / `attached`（实现 `lib/task-execution-observation.js` 的 `succeeded('started' \| 'settled' \| 'attached', …)`；公开面不重写码）。例外的实质（不铸造 operation 身份、动作名走 `action`、控制对象是 durable task/attempt、经 `tasks.get`/`tasks.observe` 观察）不变，六项字段齐全 |
| `public-contract.registry.json`（`executions.recovery.checkpoints.planRestore`、`tasks.register` 两条例外记录） | `replacementShape` 与实现对齐：planRestore 的形状改为计划对象真实字段（`slices` 携带每片的 steps / restoreability / bounded reasons，锚点未确认经 reasons 呈现，不存在 `anchorStatus` 字段）；`tasks.register` 的拒绝枚举补上可达的 `unavailable`（registry 写回失败）与身份冲突携带的 `observed` |
| `public-contract.registry.json`（`tasks.settle`、`sessions.selection.get` 两条例外记录） | 同批收紧：`tasks.settle` 说明「已终态任务的重复结算按幂等回答并报出终态词（settled / failed / unknown）」；`sessions.selection.get` 补上非法主体按 `rejected` 拒绝（不裁剪为「| typed unavailable」） |
| `public-contract.registry.json`（`executions.recovery.checkpoints.planRestore`、`tasks.register`、`sessions.interactions.respond` 三条例外记录） | 第三批复核的细节订正：planRestore 补全拒绝码（`invalid-input` / `missing` / `unsupported-schema` / `unavailable`）与「无 restorable authority」分支的计划级 `reasons`；`tasks.register` 说明身份冲突只在读检分支携带 `observed`（CAS 竞态分支不带）；`sessions.interactions.respond` 的拒绝枚举改为该面真实产出的 `stale` / `rejected` / `unavailable`，并注明 `denied` 仍属领域发布的 respond 词表（本面无产者） |
| `public-contract.registry.json`（`sessions.selection.set`、`sessions.selection.get` 两条例外记录） | 第四批复核的细节订正：`set` 的 `reason` 由「报告观察到的官方 revision」改为「报告门面 owner-local 的提交计数」（revision 仅随门面自身成功提交步进，官方 seam 不暴露 revision）；`get` 的形状说明收窄为「副作用在 README 记录；availability 成员报告的是 seam 状态，不是该副作用」 |
| **第十四轮（第十三轮复核的登记面残留）** | 收口轮：① `settings.register` / `settings.register.handle` / `settings.scope.handle` 三行改准——运行时 `lib/settings.js` 的 `createScopeHandle` **新建并缓存门面 handle**（探针实测：`register(...) !== 官方 scope 对象`、own keys 恰为五项、非冻结），三行原写「回答的就是官方 scope 对象 / 非门面铸造」系写反，现改为「门面包裹官方 scope 铸出的 handle，五项域成员，无 id / ownerId / generation / dispose」；② B2 的 `settings.register` 描述同批改准，「已收口」清单里 client `lifecycle.register` 的尾巴（「其 handle 行 prose 形态仍待」）删除（该行 `currentShape` 已 itemize）；③ §4 的「实测口径」按 HEAD registry 重测刷新（`kind === 'handle' && status !== 'removed'`：policy/resourceRegistry handle **34** 行、`currentShape: null` **0** 行、prose 且无例外 **2** 行 = `skills.activation.register.handle` + `skills.activation.policy.register.handle`），并写明「开工前既有的 `currentShape: null` 缺口已在本线清零」；④ B2 解除动作里「把 16 行 `currentShape: null` 一并补齐」的前置随之删除；⑤ spec 制品的例外台账净额同步到实测（`design.md` §3 的「新增」标题由 3 条改为 **4 条 / 4 行**并把 `tasks.register` 补进表内，净额段与 `tasks.md` Task 3.3 记录重分类后的 18、并写明 HEAD 实测 **19 记录 / 17 行 / 16 path**——第 19 条是复核轮为 `agents.register` 追加的 handle 形状记录）；⑥ §4 历史注里「design §2.4 的 R 系列只覆盖其中六条」改为可核实的措辞（R 系列是该缺口的抽样，不是全量清单） | registry + 成员表 + 台账 + design/tasks |
| **第十三轮（第十二轮复核的登记面残留）** | ① feature-list 不再把 `sessions.channels.auth.*` 计入已收口（该族 owner 仍是常量 root token）；② B2 清单按实现重核（去掉已收口的 client `lifecycle.register`，补入 `skills.activation.policy.register` 与 `settings.register`，并统一 `tools.executionMode.register` 的措辞）；③ `settings.register` 与其两行 handle 的文本删去不存在的 generation / revision / lifecycle 字段合同，改为运行时真实的五项域成员（第十四轮追加订正：本轮的「回答的就是官方 scope 对象 / 非门面铸造」写法与运行时的 `createScopeHandle` 包裹相反，见下一行）；④ `sessions.channels.redaction.register.handle` 的 owner token 措辞与同族一致（root）；⑤ feature-list 的测试总数刷到 3562 | registry + 成员表 + feature-list + 台账 |
| **第十二轮（第十一轮复核的低级残留）** | ① B2 的「未收口成员族」按实测重核（只留确实未收口的四类，另注 `tools.executionMode.register` 是行文字漂移）；② `packages/agent-loop/test/recovery-slice.test.mjs` 的「引擎接受声明」断言改为 `availability().capabilities === 1`（原断言在引擎拒绝时同样为真，不具鉴别力）；③ `test/index-recovery-policy.test.mjs` 的夹具去掉会被门面覆盖的死字段；④ `recovery-slice.js` 的注释改准（缺声明时的码是 `retry-capability-missing`，不是 bounds 错误）；⑤ 台账 §2 的 live totals 刷新（3562、agent-loop 45） | `packages/agent-loop/{lib,test}` + `test/index-recovery-policy.test.mjs` + 台账 |
| **第十一轮（第十轮复核的阻塞项）** | ① **R 包回归修复**：`packages/agent-loop/lib/recovery-slice.js` 的能力声明与 decide 三元组仍在用旧参数名，改名后被引擎拒绝（best-effort catch 吞掉），自动恢复的实际行为退化为终局 stop；已同步更名，并给该包的套件加两条**鉴别性**断言（声明必须用作用域参数名、decide 必须引用同一对，且真实引擎必须接受该声明）；② **handle 成员名回到标准身份成员**：`capability.register.handle` 的成员集仍为 `{ id, ownerId, generation, dispose() }`，其中 `ownerId`/`generation` **承载**声明的 `scopeOwner`/`scopeGeneration`（改名只作用于输入参数与 evaluate 引用），registry 两行文本随之改准；③ 台账第十轮 ⑥ 的措辞更正（`namingDecisions` 的 note 是**替换**而非撤回）；④ `packages/agent-loop/test/recovery-slice.test.mjs` 的 authority double 补记 decide 输入 | `packages/agent-loop/lib/recovery-slice.js` + `packages/agent-loop/test/recovery-slice.test.mjs` + `lib/recovery-policy.js` + registry + 台账 |
| **第十轮（第九轮复核的中级项：recovery 平面 K3）** | 按 Req 3.1/3.2/3.4 与 design K3 实施（不再以登记代替实现）：① `executions.recovery.policy.register` / `visibility.register` 由门面**派生 owner + 铸造 generation**（声明的 `ownerId` / `generation` 被覆盖），引擎对**跨 owner 同 id** 抛 typed `RecoveryPolicyRegistrationError`（同 owner 仍 latest-wins）；② `executions.recovery.capability.register` 的声明身份按 K3(b) 更名为领域参数 `scopeOwner` / `scopeGeneration`（`evaluate` 的 capability 引用同步更名），不再借用 `ownerId`/`generation` 命名，也不做派生（该对命名的是被恢复操作，`evaluate` 正是按它匹配）；③ 内部调用方（`lib/task-execution-observation.js` 的能力声明与 decide 三元组）同步更名；④ 新增鉴别性测试：两调用者两 owner、声明值被忽略、跨 owner 同 id typed conflict、同 owner latest-wins；⑤ registry 六行（两族 leaf/handle + evaluate + capability）随之改写；⑥ `namingDecisions` 那条 note 由「保留参数名」**替换**为描述已交付形状的新 note（第十一轮加注：此处原写「撤回」，措辞不准） | `lib/{recovery-policy,plugin-api-service,task-execution-observation}.js` + registry + `test/{caller-derived-owner,recovery-policy,policy-authority-contract,recovery-single-consumption,recovery-policy-acceptance,index-recovery-policy}.test.mjs` |
| **第九轮（第八轮复核的残留）** | ① 三行 recovery 注册的 `conflictRule` / `idempotency` 与引擎对齐（按 id 或 (ownerId, operationId) **静默取代** ⇒ `latest-wins`；能力声明的内容相同也取代 ⇒ `not idempotent`），相关 handle 行同步；② 三行 `currentShape` 按各自真实读侧重写——只有 `capability.register` 的 `(ownerId, operationId, generation)` 会被 `evaluate` 匹配，policy / visibility 两个声明的身份是**读侧不消费的注册元数据**（第八轮的统一措辞对这两行失实）；③ 命名决定落盘：recovery 平面的参数名沿用模型自身的 `ownerId`/`generation`（`namingDecisions` 记一条，并说明预发布窗口内仍可改用独立的作用域词汇）；④ `test/caller-derived-owner.test.mjs` 的 generation 断言改为跨视图的序列断言（原断言对视图级实现同样通过）；⑤ feature-list 的 M11 行不再把 `executions.recovery.*` 归入「派生 owner」 | registry + 测试 + feature-list + 台账 |
| **第八轮（第七轮复核的残留）** | ① `executions.visibility` 的 generation 计数改为**真服务级**（闭包在构造函数里，方法式 getter 的 `this` 是访问者视图，原先的 `this._x` 落在视图上）；② 第七轮复核指出的 `executions.recovery.{policy,visibility,capability}.register` 身份问题**按资源作用域定性**：该平面的 `ownerId`/`generation` 是「被恢复操作」这一资源的作用域参数（`evaluate` 正是按这一对匹配能力声明），不是注册插件的身份，因此不做调用者派生（实测：派生会破坏 `evaluate` 的匹配），改为把 registry 三行与其 handle 行的 `identitySource` 由 `caller plugin context` 更正为 `declared-resource-scope` 并在 `currentShape` 写明该区分；③ 台账中「`executions.recovery.*` 逐项收口」的表述按上述定性收紧（K2 的判别式 dispose 已交付，K3 的「自报 owner」实为资源作用域，非缺陷） | `lib/plugin-api-service.js` + registry + 台账 |
| **第七轮（第六轮复核的残留）** | ① `executions.visibility.register.handle` 行的 `conflictRule` / `idempotency` / `lifecycle` 与 leaf 行及引擎对齐（任意重复 id 抛 typed error ⇒ `content-conflict` / `not idempotent`，不再沿用同族的 `owner-conflict` / `latest-wins`）；② `test/caller-derived-owner.test.mjs` 的 generation 断言改为「同一调用者两次注册得到不同 generation」（第九轮进一步改成跨视图的 1→2→3 序列，才真正区分服务级与视图级）；③ `test/index-context.test.mjs` 的 owner 断言加注说明其只证明「声明的 owner 被忽略」，派生本身由前者取证 | registry + 两个套件 |
| **第六轮（第五轮复核的阻塞项）**：`executions.visibility.register` 的 owner 绑定未真正派生 | 该命名空间的 getter 原为**箭头函数**（Cordis 只在方法式 getter 上把访问上下文作为 receiver，箭头 getter 闭包捕获门面自身），故第五轮的「派生调用者身份」实际绑定的是门面自己。已改为方法式 `get() {}`（与 `llm`/`events`/`security`/`storage`/`workspaces`/`prompts` 一致），generation 改用服务级单调计数，wrapper 对非法 spec 保持「先交给 owner/禁用面按原顺序拒绝」的次序，并把注释中关于禁用面的措辞改准；`test/caller-derived-owner.test.mjs` 新增两个**鉴别性**用例（`executions.visibility.register` 与 `prompts.provenance.contribute` 各由两个不同调用者读到两个不同 owner） | `lib/plugin-api-service.js` + `test/caller-derived-owner.test.mjs` |
| 同轮：`executions.visibility.register` 行语义字段与实际不符（M1） | `conflictRule` / `idempotency` / `lifecycle` 由从同族抄来的 `owner-conflict` / `latest-wins` / 「新 generation 取代旧的」改为真实语义：重复 policy id 一律抛 typed error（`content-conflict` / `not idempotent` / 「重复 id 被拒绝而非取代」），`currentShape` 补上「省略 ownerId 不是绕过引擎的方式」 | registry |
| 同轮：`agents.register` 的 handle 形状差异改按例外登记（M2） | 第五轮以「例外行/path 已在上限」为由只在台账披露，该算术不成立（同一行追加记录不增加行/path）：现按 idiom 例外追加第二条记录（记录数 18 → 19，仍 ≤ 上限 20），台账措辞同步更正 | registry + 台账 |
| **第五轮（阻塞项处置）**：`agents.register.handle` / `sessions.channels.acquire.handle` / `executions.visibility.register.handle` / `prompts.provenance.contribute.handle` 四条 handle 行与实际返回不一致 | ① `agents.register`：**退役** `.handle` 行（该成员按 `plugin-api-agent-create-m2` 的要求原样转发官方注册动词并返回官方 disposer，门面不铸第二身份；退役需 `oldToTargetMapping`）并改写 leaf 行说明；② `sessions.channels.acquire`：**退役** `.handle` 行（获取回答判别式结果，身份是结果里的 `(channelId, channelGeneration)` 对，归还动词接收该对而非 handle），cluster `sessions.channels` 的设计 path 同步去掉该 handle 项；③ `executions.visibility.register`：**改实现**——门面按派生调用者身份绑定该注册（声明的 `ownerId` 被忽略）并铸造标准 resource handle（`dispose()` 判别式，归还是引擎自己的 disposer），leaf 行与 handle 行随之改写；④ `prompts.provenance.contribute`：**改实现**——同一套路（派生 owner + 标准 contribution handle，拒绝码收敛为 `invalid-input` / `conflict` / `unavailable`），leaf 行与 handle 行随之改写 | registry + `lib/plugin-api-service.js`（`bindExecutionVisibility`、`createProvenanceContributeEntry`）+ `test/plugin-api-service-execution.test.mjs`、`test/index-context.test.mjs`（新增/加严断言） |
| `docs/standards/api-idioms.md` §3.1 | 补一条呈现口径：同一订阅入口既要订阅、又要对「未知名」给出 typed 结果时（事件面的订阅入口），成功形状是承载标准 handle 的判别式信封 `{ ok, code, handle }`，未知名返回 typed `unsupported`（含可查询目录）而非裸 `TypeError`；两种呈现都以同一个四成员 handle 为契约本体，成员行按各运行时真实形状登记，不消耗例外。依据 Req 10.4 与 Req 5.1 在该成员上无法字面同时成立 |

**本线登记的形态差异（保持可见，不静默）**：

| 位置 | 差异与理由 |
|---|---|
| `agents.register`（leaf，`resourceRegistry`） | 该成员**按设计不铸标准 handle**：上游 `plugin-api-agent-create-m2` 的要求是「原样返回官方 disposer、SHALL NOT wrap」。该差异**已按 idiom 例外登记**（该行原本就有 provider 分家的例外；本轮为 handle 形状追加第二条记录，行/path 两口径不变，记录数 18 → 19，仍不高于上限 20），同时退役其 `.handle` 行并在 leaf 行的 `currentShape` 写明透传形状 |
| `sessions.channels` 家族的 `coordination` 形状 | 该家族按 Task 5.12 / C4-C5 仍属**未完成**（公开面是 `list` + `observe`，且获取回答判别式结果而非 §3.7 的 lease handle）；本线只退役了不存在的 `.handle` 行，家族级的 idiom 收敛仍在既登记未完成项内，不另开例外 |

**本线登记的外部差异（不属本线待办，供后续处理）**：

| 位置 | 差异 |
|---|---|
| `docs/specs/interactive-session-access/tasks.md` 5.6 / `design.md` §3 第 7 条 | 该条要求 `selection.get` 的官方 resume 副作用「在 availability **与** README 披露」。实测：README 已披露（`README.md` 的 `pluginApi.sessions.selection` 段），`sessions.selection.availability()` 只报告 seam 状态（`active` / `degraded` / `unavailable` + `reason`），不含该副作用。本线按「登记必须与实现一致」把 registry 措辞收窄为 README，并在此登记该差异；若要兑现该条的 availability 披露，应作为 `interactive-session-access` 线的形状增补（会涉及该行的 `availabilityShape` 与套件断言），不在本线的收敛范围内 |

**本轮未完成**（**不是阻塞项**：无硬停机点、无环境 / 工具链 / 权限缺失，全部是同一工作序列中尚未执行的主体工作）：

| Task | 未完成内容 |
|---|---|
| 4.14/4.15 余项（B2 余项 · generation 校验提升） | 与上一轮同因：两处**委派型**注册（`skills.activation.register.handle`、`skills.activation.policy.register.handle`）仍无门面身份，提升规则会新增 2 条例外并顶破基线（17 / 16）。解除动作：为该 owner 契约补 unregister 语义并把两行包装为标准 handle |
| 3.1（B5 · `async` 回填） | registry 现 559 行成员中 `async` 字段回填 **0 行**，validator 仍无该校验；采集入口方案未实施 |
| 5.12 / C4/C5（通道半） | `sessions.channels` 的 `current` / `history` / `observe` 成员映射仍未收敛（公开面现状是 `list` + `observe`） |
| 8.13（C17） | `tasks.*` 全域的 `async` 抽样复核依赖 B5，未做 |
| 3.6（B6） | 行为表 / 装配表本轮未被触及（成员表已重建为 **559 行**）；历史现状注待与上述余项同批处理 |

## 3.0.1 第三轮（2026-09-15 续做）完成与未完成清单

本轮自 `4d6d549`（第二轮交付的全局终审通过点）起连续执行。**已完成**（实现 + 测试 + registry/validator 同步）：

| Task | 内容 | 落地 |
|---|---|---|
| 4.14 余项（B2 臂 · callerAware 别名） | `llm.requestTransforms` / `llm.admissionPolicies` 改为按派生身份键控的 leaf，且 leaf 在调用时解析当前 slot（保留「跨重挂载身份稳定」的既有契约）；`tools.discovery.catalog` / `diagnostics.register` 改为按 (slot, identity) 键控的 per-caller 视图。末次访问者胜的共享 `record.callerCtx` 已删除，`createFeatureSlot` 不再有 `callerAware` 选项 | `lib/plugin-api-service.js` + `test/caller-derived-owner.test.mjs`（新增 5 条：两族 leaf、两族视图、以及「同 id 不同 owner 不互相覆盖」的反例） |
| 3.4 / prepareFeature 余项（B2 臂 · staged 回滚） | `_restoreDisabledSurface` 改为返回「是否真的恢复了」并新增 execRoute / typert / officialPassthrough 的退役路径；recovery / coordination / tasks / toolDiscovery / sessionChannel 的禁用候选改为 **owner 形状**（published 形状无法通过自己的挂载守卫）；`createDisabledSecurityApi` 补 `egress.lease.release` / `egress.coverage`；`_readSlot` 补 storage / execRoute；`unmountFeature` 补 storage 分支；无 slot 可替换的 9 个 feature 改为 `prepareFeature` 明确拒绝（`UNSTAGEABLE_FEATURES`）而非静默 no-op | `lib/plugin-api-service.js` + `test/feature-staging-contract.test.mjs`（全量 feature 契约测试：43 个 feature 逐个验证「可暂存且能恢复」或「带说明拒绝」） |
| 4.14 余项（冲突口径，B2 臂） | `security.policy / redaction / egress` 三族的 6 行（3 leaf + 3 handle）改为 `conflictRule: owner-scoped`（实现按 (owner, id) 键控、跨 owner 并存），registry `vocabulary.conflictRule` 增该值，`api-idioms` §3.2 把「注册键决定冲突维度」写成分界（id 全局限定 ⇒ `owner-conflict`；(owner, id) 键控 ⇒ `owner-scoped`），两册一致 | registry + `docs/standards/api-idioms.md` |
| 4.15（B2 臂） | `llm.adapters.decorations.register.handle` 补齐 `id` / `ownerId` / `generation`，`dispose()` 改判别式（`revoked` / `stale` / `unavailable`）且幂等，`snapshot()` 转为已登记领域扩展 | `lib/plugin-api-service.js` + 相关套件 |
| 5.3（B3 余项） | client `settings.remote.contribute` 改为 contribution idiom：同步返回冻结判别式 + pending handle，`face` / `render` 作为**延迟解析**的领域扩展（内核的 extensions 改为按属性描述符复制，accessor 保持惰性），任一阶段可安全撤销、迟到落地被回滚 | `lib/{client-settings-remote,contract-kernel}.js` + client bundle 重建 + `test/client-settings-remote.test.mjs`（重写为 6 条） |
| 8.4（B3 余项） | client 自描述收口：`connection` / `events` / `remotes` / `settings` / `slots` / `codec` / `lifecycle` 七个 namespace 提供零参 `availability()`；`capabilities.*` 与 namespace 成员读**同一张 probe 表**（不再「对象存在即 active」）；缺失 backing 报 `unavailable`、部分缺失报 `degraded` 且保留领域 reason；命名空间对象按底层对象缓存（身份稳定） | `lib/client-runtime.js` + `lib/client-generation-rebind.js` + client bundle + `test/client-self-description.test.mjs`（新增 3 条） |
| 8.7（C8） | client `settings.scope(spec)` 与 host 同一调用套路（client 原样返回官方 scope 对象），环境差异显式登记 | `lib/client-settings-scope.js` + registry |
| C3 投影半 | slots 暴露只读声明投影 `declaration(key)`（`status: declared / missing / unavailable` + 官方 `spec` / `specDynamic` / `declarationEpoch` / `snapshot` 事实），`list(key)` 回答同源 `{ key, status, entries }`，「未声明」与「已声明为空」不再同形 | `lib/client-slots.js` + client bundle + `test/client-slots.test.mjs`（新增 2 条） |
| 6.6 余项（B11 余项） | client `lifecycle.register` 的 owner 改为派生（`callerOwnerOf`：loader entry name → fiber name → root），调用方自报 `ownerId` 被忽略；host 侧无调用者的内部面保留显式绑定并如实登记 | `lib/client-generation-rebind.js` + client bundle + `test/client-generation-rebind.test.mjs`（新增 1 条） |
| 3.3 / 3.4（B4） | 例外台账重分类：回收 6 条记录 / 4 行（workflows 三处扩展成员、agent-scope 扩展成员、decoration handle、workflows.start 的 terminal），新增 4 条记录 / 4 行（`tasks.register` + 三个 durable-task 操作）；三条新的 entry 级校验（入口动词与 idiom 一致、注册类 leaf 的 typed-throw 失败呈现、已 itemize 的成员不得再消耗例外）落 validator，并补 3 条反例测试 | registry + `scripts/registry-validate.mjs` + `test/registry-negative.test.mjs` |
| 3.2-R / B2 余项（登记面） | 24 行 `currentShape: null` 全部补齐（14 个 availability、9 个 handle、capabilityMatrix）；两处**幻影** handle 行退役（`tasks.register.handle`、`tools.executionMode.register.handle`，含 `oldToTargetMapping`）；C13 `storage.open.handle.domain` 改回 retained；C15 两行互指；C10b 四个 decision namespace 的 `admitted()` 补行 | registry + 成员表（**551 行**） |
| 8.3 / C10b（代码半） | 三个 domain decision namespace（agents/tools/prompts）补 `admitted()`，四族的 active/disabled 成员集合一致 | `lib/decision-participation-facade.js` + `test/decision-participation-facade.test.mjs`（新增 1 条） |
| 8.2 / C1b | `workspaces.transactions.availability()` 补齐（优先 owner probe 并保留其领域 detail，否则读 slot 活态；禁用形态同成员），namespace 记录落 registry | `lib/plugin-api-service.js` + registry + `test/mutation-operation-coordination-surface.test.mjs`（新增 1 条） |
| 4.11（C9） | `prompts.contribute` scoped 路径的 kind 非法拒绝列出合法 kind 词表；全局 `anonymous:<seq>` 与 scoped `scoped:<kind>` 共用同一命名规则（已满足，复核通过） | `lib/plugin-api-service.js` |
| 9.1 / 9.2（B13） | 双 synthetic 插件组合验收（加载顺序、同 key 各自登记、卸载隔离、**旧 handle 不得撤销新资源**、callback 失败隔离）与两个迁移切片（同一工具全局→agent scope 的 handle 与清理方式、同一策略跨 llm / prompts / security 的可迁移登记），文件头写明「原行为 → 现行公共调用 → 运行结果」矩阵，证据全部来自真实公共入口执行 | `test/dual-plugin-composition.test.mjs`、`test/migration-slices.test.mjs`（新增） |
| 8.12（C14） | `capabilityMatrix()` 改为**当前能力**投影：一行 = 能力簇 + 当前状态（`active` / `degraded` / `unavailable`）+ 限制 + 缺口原因；迁移词汇（`renamed` / `merged` / `migrated` / `deleted` / `internalized` 与 `replacement` 文本）不再出现在运行时输出（保留在 registry 登记面）。新增可检入的重建入口 `scripts/capability-matrix-sync.mjs`（`--check` 可校验），并在两处套件改为断言「由 registry 派生」而非逐字镜像 | `lib/capability-matrix.js`（生成物，89 簇）+ `scripts/capability-matrix-sync.mjs` + `test/{policy-inventory,read-surface-projection}.test.mjs` |
| 8.10（C12） | `settings.update / replace / mutate` 改为门面 mutation idiom：冻结判别式 `{ ok, code, commitState, generation? }`（官方答复为 thenable 时 await），官方 revisions/CAS 语义与错误映射保留，namespace 级状态失败（inactive / disabled / service unavailable）仍为 typed throw；registry 三行与套件同步 | `lib/index.js`（`facadeSettingsMutation`）+ registry + `test/host-namespace-integration.test.mjs` |
| client 侧登记同步 | `settings.remote.contribute`（client 行）、七个 `*.availability`（client 行）、`settings.scope`、`slots.list`、`lifecycle.register`、`lifecycle.availability` 的 `currentShape` 按实现改写；成员表随之重建 | registry + `convergence/public-member-table.md` |

**本轮未完成**（**不是阻塞项**：无硬停机点、无环境 / 工具链 / 权限缺失，全部是同一工作序列中尚未执行的主体工作）：

| Task | 未完成内容 |
|---|---|
| 3.6（B6） | M10 三表中，行为表与装配表在第十五轮按受影响面就地复核（见下）；两表均保持冻结行数与 token 可解析，无需改写内容 |

**第十五轮（续做，2026-09-15/16）已完成**：上表五项余项全部收口（逐项见 §3.0.4）。

**C7 回滚记录（Task 10.1(d)）**：client `connection.get` → `connection.api.settings` 的改名回滚已在上一轮交付（registry / `oldToTargetMapping` / `statusByPath` 三处同步，避免自环），本轮无新增回滚。

## 3.0.4 第十五轮（续做收口轮，2026-09-15/16）—— 上一轮清单的五项余项全部交付

本轮的起点是第十四周复核通过后的「仍未完成」清单；五项全部按 `tasks.md` 的对应任务落地，不再有未完成主体工作。

| Task | 交付内容 | 落点 |
|---|---|---|
| 5.12 / C4/C5（通道成员映射） | `sessions.channels` 按 Task 5.12 收敛：事件帧读取 `list` 改名 `history`（api-idioms §3.1 允许的查询动词；旧名留 `removed` 行 + `oldToTargetMapping`），一次性快照由 `observe()` 移到 `current()`，`observe(listener)` 改为内核铸造的标准观察 handle（冻结 `{ current(), subscribe(listener), dispose(), epoch }`，变更时投递冻结投影，释放后 `current()` 给降级视图、`subscribe` 为 no-op、`dispose()` 判别式 `revoked` / `stale`）；网关 R 包的远端投影改读 `current()`（其 wire 成员名不变）；`skill`/gateway 两处套件与 `test/interactive-session-consumption.test.mjs` 同步 | `lib/session-channel.js`、`lib/plugin-api-service.js`、`packages/session-channel-gateway/lib/slices.js`、registry（`history` 新增 / `current` 新增 / `observe` 改写 / `observe.handle` 新增 / `list` 退役）+ 成员表（**562 行**） |
| 4.14/4.15 余项（B2 · generation 校验提升） | 两处**委派型**注册收口为标准 handle：`skills.activation.register` 由门面**派生 owner**（spec 自报 owner 被覆盖）、**铸造 generation** 并返回 `{ id, ownerId, generation, dispose() }`（含已登记扩展成员 `skillId` / `activate` / `deactivate` / `exposure`），拒绝按注册类呈 typed throw（非法 spec 同步抛、owner 拒绝以 rejection 表达）；`skills.activation.policy.register` 同形返回标准 handle（id 为会话 scope 键）；owner 契约补 `unregisterDescriptor` 释放路径并支持**按发行 generation 释放**——实测修复了一个真实缺陷：同 owner 重新登记后，**旧 handle 的释放会撤销新登记**（探针复现，现由 `UNREGISTER_STALE_GENERATION` 拒绝并如实报 `stale`）；`skills` 命名空间改为方法式 getter（箭头 getter 会把访问者身份丢掉，与 storage/workspaces/security 同类）；策略面补跨 owner 冲突（`policyRegister(scope, owner)`，跨 owner 同 scope 抛 typed conflict）；**generation 校验提升为「覆盖全部在册 policy / resourceRegistry handle 行」**（不再限于 itemize 的行），并补两条反例测试 | `lib/plugin-api-service.js`（`bindSkillsActivation`）、`lib/index.js`（owner 包装的释放入口）、`packages/tool-skill/lib/{apply,skill-activation-engine,register-skill-sugar}.js`、`scripts/registry-validate.mjs`、registry 四行、`test/skill-activation-facade.test.mjs`、`packages/tool-skill/test/{engine,register-skill-sugar}.test.mjs`、`test/registry-negative.test.mjs` |
| 3.1（B5 · S15 调用形态回填） | 全 **562** 行成员回填 `callShape`（`sync` / `async` / `not-applicable`，词表同步）；判定以**实现现状**为准、两种证据形态：①在挂载的门面（真实 in-repo owner 服务）上调用成员、以是否答复 thenable 判定（in-repo 实现的族）；②读 owner 实现（official seam 与 R 包 owner）。实测 77 行 async / 258 行 sync / 227 行 `not-applicable`（handle 行、数据叶、已退役行）。validator 增加该校验（缺字段或词表外的值一律拒绝），并新增 `test/call-shape.test.mjs`：对可观测的族断言「登记值 = 挂载面实测值」、对 official-seam / R 包 owner 的族显式登记为不可观测边界 | registry（全体成员行 + `vocabulary.callShape`）、`scripts/registry-validate.mjs`、`test/call-shape.test.mjs`（新增） |
| 8.13（C17） | `tasks.*` 全域的调用形态抽样复核：9 个成员（register / start / settle / attach / get / observe / history / acquire / takeover）全部登记为 `async` 并在挂载面上逐条实测为答复 Promise；`tasks.availability` 等同步成员作为对照登记为 `sync`。`test/call-shape.test.mjs` 固定该断言 | registry + `test/call-shape.test.mjs` |
| 3.6（B6） | M10 三表按受影响面复核：成员表 1:1 重建（562 行）；行为表保持 37 行冻结清单、逐行内容复核（受影响的行为行只引用 `sessions.channels.*` 泛名与已更新的套件，无需改写）；装配表 token 未变、可解析（`convergence-verify` 硬判据全绿）。历史现状注：M8 迁移账本追加「M11 续做的 channels 映射现状注」（旧 path 保留 removed 行与 `oldToTargetMapping`，历史措辞不改写） | `docs/specs/plugin-api-m10-contract-convergence/convergence/*`、`docs/specs/plugin-api-m8-api-idiom-refactor/migration-ledger.md` |

**第十五轮的判定口径补记（S15）**：`callShape` 的「async」定义为**调用会得到 Promise**（不限于 `async` 函数声明）——门面的转发函数本身是同步函数，把 owner 的 Promise 原样交回调用者，因此按函数声明判定会漏判（这正是 C17 的成因）。可观测族（tasks / executions / coordination / workspaces / security / diagnostics / events / prompts / attention / capabilities）由测试逐条断言；official seam（llm / tools / sessions / settings / agents / web / apiProxy）与 R 包 owner（attachments / mcp / profiles / storage / remotes / credentials / workflows / skills）两族的登记值取自各自 owner 实现，测试把这两族列为**不可观测边界**并在测试文件头写明理由。

## 3.0 本轮（2026-09-15 续做）完成与未完成清单

本轮自 `ab15065` 起连续执行。**已完成**（实现 + 测试 + registry 登记同步）：

| Task | 内容 | 落地 |
|---|---|---|
| 1.6 / 1.7（B7） | 异步 contribution 的 pending handle 状态机（`pending/active/failed/revoked`、任一状态安全 dispose、迟到的落地被回滚而非复活） | `lib/contract-kernel.js` + `test/contract-kernel.test.mjs` |
| 5.13（host 半，B8） | host `events.observe` / `events.define.handle` / `sessions.planMode.observe` / `sessions.permissionPresets.observe` 及其 disabled 安装态、client `attention.observe`、client `lifecycle.register.handle` 的 `dispose()` 判别式收口 | `lib/{events-bus,sessions-plan-mode,sessions-permission-presets,plugin-api-service,client-attention-face,client-generation-rebind}.js` |
| —（attention 码集） | `attention.contribute` 的 dispose 码集由 `noop`/`withdrawn` 收敛为 K2 的 `stale`/`revoked` | `lib/attention-hub.js` |
| 6.4（B1） | `tasks` 全域与 `workspaces.transactions` 的动作名字段 `operation` → `action`（Req 6.3 的无条件条款，覆盖全树同类字段） | `lib/{task-execution-observation,workspace-mutation-transaction}.js` |
| 6.6（B11） | `storage.open` 的 owner、`workspaces.transactions.prepare` 的 ownerId、`prompts.contribute`（全局与 scoped）的 ownerId 覆盖位改为**派生**；facade 侧 stamp callerCtx 并按 caller 注入 | `lib/{storage-binding,workspace-mutation-transaction,plugin-api-service}.js` |
| 8.8（C10c） | `agents.scopes.register` 的失败改 typed throw（S2 注册类分界）、handle 冻结、`dispose()` 判别式、补 `id`/`ownerId` | `lib/scoped-agent-contributions.js` |
| 4.3（B20） | `llm.routing` 四类注册的调用者绑定**接通**（facade 的 per-caller 视图注入派生身份）；registry 四行 `identitySource` 改回 `derived-caller` | `lib/plugin-api-service.js`（`_routingForCaller`）+ `test/route-policy-facade.test.mjs`（真实派生与跨 owner 冲突可达断言） |
| 4.4（B14） | `llm.providers.register` / `llm.models.register` 包装为标准 handle（`.replace` 作为扩展成员保留），per-caller owner 派生 | `lib/{index,plugin-api-service}.js` |
| 4.5（B19） | attachments 注册类失败呈现统一为 **typed throw**（选方案 (a)）；R 包 boot 自检随之校验「注册类抛 typed / 操作类判别式」 | `packages/attachments/lib/{pipeline-service,apply}.js` |
| 4.14 / 4.15（B2 主臂） | `executions.recovery.*`、`decision-participation` 四族、`security.{policy,redaction,egress}`（含 facade 注入派生 owner）、`sessions.channels.auth.*`、`sessions.channels.redaction.register`、`tools.guard`/`presentation`（复核为已合格）、`llm.adapters.register.handle`（dispose 判别式）逐项收口 | `lib/{recovery-policy,decision-participation,security-owner,session-channel-auth,session-channel-redact,llm-adapter-registration}.js` |
| 8.1 / 8.11（B9、B18） | `coordination.availability` 改同步（挂载期已解析，不再返回 Promise）；`security.availability` 补外层三值 `status`（领域 detail 保留）；`storage.availability` 补 `scope`/`durability`/`epoch` | `lib/{coordination-lease,security-owner,storage-binding}.js` |
| 8.9（B10） | `sessions.activity.current`/`get` 的缺位词汇由 `absent` 拆为「确定不存在 ⇒ `missing`」与「非法输入 ⇒ `invalid-input`」 | `lib/session-activity-view.js` |
| 3.2-R1（B16b） | 补 `lifecycle.register` 现行 leaf 行；client lifecycle handle 补 `id`/`ownerId` | registry + `lib/client-generation-rebind.js` |
| 3.1（词表半，B17） | `vocabulary` 增 `identitySource`（含 `derived-caller`）与 `callShape` | registry |
| 3.5 尾项（B15） | `bypasses` 字段首次落盘：`storage.open`、settings 五个成员行、`events.{emit,serial,parallel,bail,waterfall}` 共 11 行写明 transaction / security policy / audit / branch-routing 的旁路判定 | registry |
| 5.12 / 8.5（C3 的准入半） | slots 准入门槛由前缀白名单改为**交官方声明判定**（真实官方槽位不再被门面拒绝） | `lib/client-slots.js` |
| 5.1 / 5.2 / 5.4 / 5.5 / 5.6 / 8.6（B3 主臂） | client `slots.contribute`（判别式 + 标准 contribution handle）、`remotes.contribute`（**pending handle**：任一状态可安全撤销、迟到落地被回滚）、host `settings.remote.contribute`（判别式 + handle，官方同步挂载/租约逻辑不变）、client `attention.contribute`（外层结果冻结）、client `events.observe`（标准观察 handle + 可查询目录 + 未知名 typed 结果）、`connection.api.settings` 恢复为 settings 命名空间访问器（与 `connection.api.llm` 对称，`connection.get` 名不再存在——这是对 M3 期 rename 的回滚，见 §3.0 取舍记录） | `lib/{client-runtime,client-official-events,client-attention-face,settings-remote}.js` + client bundle 重建 |
| 3.2-R 系列（client 登记缺口） | 补入七个缺失的 client 现行 leaf 行（`slots.contribute` / `slots.list` / `slots.observe` / `events.observe` / `events.list` / `remotes.contribute` / `settings.remote.contribute`）；C7 的 `connection.api.settings` 行由 `removed` 改回 `advanced` | registry + 成员表（**551 行**） |
| 3.5 / 3.6（登记同步） | 本轮全部实现改动同步 registry（B1/B2/B9/B10/B11/B14/B18/B19/B20/C3 的 `currentShape`、`identitySource`、`bypasses`）；成员表机械重建（**551 行**） | registry + `convergence/public-member-table.md` |
| 全局终审修订（第一轮意见） | ① **实质缺陷**：`storage` / `workspaces` / `security` 三处 caller 捕获用的是箭头 getter（`get: () => {}`），闭包捕获门面服务自身——Cordis 只在**方法式** getter 上把访问上下文作为 receiver，三处已改为 `get() {}` 并以 `test/caller-derived-owner.test.mjs` 取证；② 登记修正：client `settings.remote.contribute` 行改回描述现状、host `events.observe` 两行改回 host 形状、`agents.scopes.register` 行补 typed-throw 现状、`connection.api.settings` 的 `targetPath` / `oldToTargetMapping` / `statusByPath` 三处随回滚同步（避免自环）、`sessions.activity.*` 行清除已不存在的 `absent`、`slots.observe` 行修正首参、新增 client 行的 `identitySource` 改为 `derived-caller (root-fallback)`；③ 代码修正：观察 handle 的 `dispose()` 在领域 teardown 抛错时返回 typed failure（与资源 handle 一致）、host `settings.remote.contribute` 的同 key 冲突返回稳定 `conflict` 码、删除一处死调试代码 | `lib/{plugin-api-service,contract-kernel,settings-remote}.js` + registry + `test/caller-derived-owner.test.mjs` |

**本轮未完成**（**不是阻塞项**：无硬停机点、无环境 / 工具链 / 权限缺失，全部是同一工作序列中尚未执行的主体工作；清单即下一轮的起点）：

| Task | 未完成内容 |
|---|---|
| 5.3、8.4、8.7、C3 的投影半（B3 余项） | client `settings.remote.contribute` 的 pending handle 与判别式（`face`/`render` 作为**延迟解析**的领域扩展成员需要内核支持 lazy 扩展，本轮未做）；client 六个 `availability` 成员与 `capabilities.*` 的真实叶子状态（本轮尝试后回滚——见下方取舍记录）；`settings.scope` 调用套路统一；slots 的只读声明投影与 `list` 的「未声明 / 已声明为空」区分 |
| 3.3 / 3.4 / 10.1(e)（B4） | 例外台账重分类（回收 6 条记录 / 4 行、新增 3 条）与 validator 的三条 entry 级校验 |
| 3.1（registry 半，B5） | 538 行 `async` 回填与 validator 校验 |
| 3.6（B6） | M10 行为表 / 装配表与历史现状注（成员表已随 registry 重建并全链通过） |
| 8.x 余项（B12） | C1b、C4/C5 通道半、C7、C8、C9、C10a、C12、C13 保留判定、C14 内容模型、C15、C17 抽样复核 |
| 9.1 / 9.2（B13） | 双 synthetic 插件组合验收与迁移切片的新增证据 |
| 10.1(a)（B16a） | A1–A5 / B1–B3 / C1–C17 / R1–R6 的四态结论表 |
| 4.14/4.15 余项（B2 余项） | registry 驱动的静态枚举未跑完；16 行 `currentShape: null` 未补（**第十四轮注：该子项已由 `6f62bd9` 清零，此处为登记时措辞**）；generation 校验未从「itemize 成员集」提升为覆盖全部 policy / resourceRegistry handle 行 |
| 6.6 余项（B11 余项） | client `lifecycle.register({ownerId})`（`lib/client-generation-rebind.js`）仍接受调用方自报 ownerId，未改派生 |
| 4.14 余项（callerAware 别名，既有缺陷） | `llm.requestTransforms` / `llm.admissionPolicies` / `tools.discovery.catalog` / `diagnostics.register` 四族仍以 `createFeatureSlot` 的 `callerAware` + 共享 `record.callerCtx` 绑定调用者（末次访问者胜），与 registry 声称的 `identitySource: caller plugin context` 不符——应同 storage / workspaces / security 一样改为按 (slot, identity) 键控的 per-caller 视图；同批处理「调用者 ctx 链上 `.loader` 不可解析时 root 回退被跨调用者共享」一条（正常 DSH profile 下不可复现） |
| 3.4/prepareFeature 余项（既有缺陷） | `prepareFeature(...).rollback()` 在 `storage` / `security` 上无法恢复禁用面：`_readSlot` / `unmountFeature` 缺 `storage` 分支（rollback 静默 no-op），`createDisabledSecurityApi` 缺 `egress.lease.release` / `egress.coverage` 使挂载守卫抛错（异常在 apply 的 `close()` 中被吞）。非本轮引入、可达性窄，建议下一轮择一处理 |
| 4.14 余项（冲突口径澄清） | `security.policy.register` 的 `conflictRule: owner-conflict` 与实测口径存在张力：实现为「同 owner 同 id latest-wins、跨 owner 同 id 两名 owner 并存」，而 `api-idioms` §3.2 的 policy 条目要求跨 owner 同 id 抛 typed conflict。需下一轮择一统一（改实现或改该行的 `conflictRule` 与分册措辞） |

**8.4 的取舍记录**：本轮实现了「六个命名空间的 `availability()` + `capabilities` 按真实叶子状态报告」，但它与既有客户面契约的交互面比预期大（命名空间成员集合的精确断言、`services` 聚合状态、passthrough inventory 的成员清单、capability 探针语义），一次性改动触发 12 条既有验收失败。为避免在未充分设计的情况下改动客户面自描述语义，**该改动已整体回滚**（`lib/client-runtime.js` 回到 `d783539` 的形态），8.4 保持未完成并登记为下一轮的设计项——先定清「命名空间 availability 与 `capabilities.*` 的职责边界」，再落实现。

**B5 的取舍记录**：两条路径均已评估——运行时逐叶采集需完整 harness（(a) 方案的本意即为此建采集入口）；静态扫描对 471 个可判定成员命中 413（88%），其余 58 个为 getter、别名与 removed 行。**用启发式结果回填会产生与运行时不符的登记**，故本轮不落该字段，留待 (a) 的采集入口，避免以失实登记充数。

---

## 3. 未完成项登记（Req 13.6；历史条目保留，状态见索引）

按 `tasks.md` 的 **Task 编号**逐条登记。每条给出：未完成子项、解除所需的**具体可执行动作**、是否需要人类授权。**原因**在不言自明（单一未完成子项 + 明确动作）的条目中从略，在需要解释取舍或依赖关系的条目（B6、B9、B11、B12、B13）中写出。登记日期 2026-09-14；**本轮（2026-09-15）续做后的状态索引如下，各条正文保留其登记时的措辞**。

> **口径**：本清单是**未完成项**登记，不是「阻塞项」——按 `AGENTS.md` §3.2 的连续执行纪律，阻塞项的判定标准是代理**无法**完成（硬停机点、环境 / 工具链 / 权限缺失），而非**尚未**完成。

**本轮续做后的 B1–B20 状态索引**（正文见下，逐条按登记时措辞保留）：

| 条目 | 状态 |
|---|---|
| B1（Task 6.4） | **已完成** — `tasks` 全域与 `workspaces.transactions` 的动作名字段改为 `action` |
| B2（Task 4.14/4.15） | **大部分完成**（第三轮 + 复审修订轮）— 第三轮追加交付：callerAware 别名改为 per-caller leaf/view 四族、staged 回滚全树收口、`llm.adapters.decorations.register.handle` 身份成员 + 判别式 dispose、`security.*` 冲突口径改 `owner-scoped`、24 行 `currentShape: null` 补齐、两处幻影 handle 行退役；复审修订轮再补：`slots.declaration` 与另外七条 client 现行行补登记、`tasks.acquire.handle` 幻影行退役、client 面「实现 → registry」全量枚举；**余项**：generation 校验提升（受阻于两处委派型注册，见 §3.0.1 / §3.0.3） |
| B3（Task 5.1–5.6、5.13 client 半、8.4–8.7） | **已完成**（第三轮）— 5.3（pending handle + 惰性 `face`/`render`）、8.4（七个 namespace 的 `availability()` 与 `capabilities.*` 同源）、8.7（`settings.scope(spec)`）、C3 的投影半（`declaration` + `list` 状态）、client `lifecycle.register` 派生 owner 全部交付；8.4 上一轮的整体回滚已在本轮以「probe 表 + 身份稳定缓存」的方式落地 |
| B4（Task 3.3/3.4/10.1(e)） | **已完成**（第三轮 + 第五轮追加）— 回收 6 条 / 新增 5 条（第四条在第三轮，第五条为 `agents.register` 的 handle 形状记录，第五轮追加），净额 17 行 / 19 记录 / 16 path（≤ 基线 17/20/16）；三条 entry 级校验 + 3 条反例测试落盘 |
| B5（Task 3.1 registry 半） | **未完成** — `async` 回填仍未做（第三轮评估的采集路径见 §3.0.1） |
| B6（Task 3.6 收尾） | **部分完成** — 成员表已随 registry 机械重建（**559 行**，复审修订轮补入 client 现行行）并全链通过；行为表 / 装配表未被触及，历史现状注待与余项同批 |
| B7（Task 1.6/1.7） | **已完成** — 异步 contribution 的 pending handle 状态机 |
| B8（Task 5.13 host 半） | **已完成** — 含 disabled 安装态、client `attention.observe`、client `lifecycle.register.handle` |
| B9（Task 8.1 域侧） | **已完成** — coordination `availability` 改同步、security `availability` 状态化 |
| B10（Task 8.9 余项） | **已完成** — `sessions.activity.current/get` 的 `missing` / `invalid-input` 拆分 |
| B11（Task 6.6 余项） | **已完成**（storage / transactions / prompts 三处派生；**注**：本轮修复了三处 getter 的 caller 捕获——必须是方法式 getter，箭头 getter 会闭包门面自身） |
| B12（Task 8.x 余项） | **大部分完成**（第三轮 + 复审修订轮）— 第三轮追加交付 C1b、C8、C9、C10b、C12、C13、C14、C15（C10a 以「合理例外 + 内部回退分支」结论落台账）；复审修订轮把 C14 的 matrix 内容模型从「常量状态」升级为「由已发布 path 派生 + 精确限制清单」并补齐 12 个簇的 path 证据，C2 的 client 自描述按 Req 4.5 补齐成员级 path；**余项**：C4/C5 通道半（`current` / `history` / `observe` 成员映射）、C17 抽样复核（依赖 B5） |
| B13（Task 9.1/9.2） | **已完成**（第三轮交付，复审修订轮加固）— `test/dual-plugin-composition.test.mjs`（4 场景）与 `test/migration-slices.test.mjs`（2 切片，含「原行为 → 现行公共调用 → 运行结果」矩阵）交付；复审修订轮把两处不具鉴别力的断言改为真实边界（真实 diagnostics owner 的回调查错隔离；第二身份与伪造 `ownerId` 的派生反例），证据全部来自真实公共入口执行 |
| B14（Task 4.4） | **已完成** — `llm.providers.register` / `llm.models.register` 标准 handle（`.replace` 保留） |
| B15（Task 3.5 尾项） | **已完成** — `bypasses` 首次落盘（11 行） |
| B16（Task 10.1(a) / 3.2-R1） | **部分完成** — R1 已补；四态结论表见 §3.0.2（本轮落盘） |
| B17（Task 3.1 词表半） | **已完成** — `vocabulary` 增 `identitySource` 与 `callShape` |
| B18（Task 3.2-R5 / 8.11） | **已完成** — `storage.availability` 补 `scope` / `durability` / `epoch` |
| B19（Task 4.5 R 包半） | **已完成** — attachments 注册类失败统一为 typed throw（方案 (a)），boot 自检随契约更新 |
| B20（Task 4.3 接线半） | **已完成** — routing 四类注册接通调用者绑定，跨 owner 冲突在公共面可达（`test/route-policy-facade.test.mjs`） |

> 上述每条正文的「人类授权」字段均保持登记时取值（全部为**否**）；本轮没有新增需要人类裁决的项。

### B1 Task 6.4 —— `tasks` 动词串字段改名与三个例外
- **未完成子项**：`tasks.start` / `settle` / `attach` 的外层结果字段仍为 `operation`（承载动作名）；三条新增例外（`baseContract: operation`）六项未落 registry。
- **解除动作**：改 `lib/task-execution-observation.js` 三处字段名为 `action`；加 `tasks.{start,settle,attach}` 三条六项例外；registry 三行同步。
- **人类授权**：否（design §2 B1 已授权）。

### B2 Task 4.14 / 4.15 —— K1/K2/K3 全树一致性收口
- **状态（第十五轮）**：**该条已收口**——`skills.activation.*` 两处委派型注册已包装为标准 handle，generation 校验已提升为覆盖全部在册 policy / resourceRegistry handle 行；下一段保留登记时的未收口清单供对账，其判定不再成立。
- **未完成子项**（登记时措辞，已被第十五轮取代）：registry 驱动的静态枚举未执行完。**仍未收口**的成员族（第十三轮按实现重核）：`sessions.channels.auth.{register,pairingProvider.register}` 与 `sessions.channels.redaction.register`（owner 仍是常量 root token，facade 原样透传）、`skills.activation.register`（owner 取 spec 自报，返回 `{ ok, generation, replaced }`）与 `skills.activation.policy.register`（返回 `{ ok, dispose }`）、`settings.register`（facade 自有 `resourceRegistry` leaf，回答的是门面**包裹**官方 scope 铸出的 handle（成员 `{ get, watch, update, replace, mutate }`，无 id / ownerId / generation / dispose）而非标准 handle；三行文本已按运行时改写，收敛方式（改铸标准 handle 或登记例外）待定，例外路径受 Req 11.5 上限约束）、`tools.executionMode.register`（该官方动词是分类查询、不是注册，属行文字漂移，见 §5）。已收口且不再列出：`executions.recovery.*`、`executions.visibility.register`、四族 `*.decisions.register` / `*.executionPolicies.register` / `*.assemblyPolicies.register`、`security.{policy,redaction,egress}.register`、`llm.adapters.*`、client `lifecycle.register`（leaf 与 handle 两行均已收口：派生 owner + 标准 handle 成员，其 handle 行 `currentShape` 已 itemize）。generation 校验提升仍受阻于 `skills.activation.*` 两处委派型 handle——§4 实测的形状为 prose 且未登记例外的两行正是它们。
- **解除动作**：按 `tasks.md` Task 4.14 的两臂枚举（`idiom ∈ {policy, resourceRegistry, contribution}` 的现行行 + handle 行；`currentShape` 描述 disposer/handle 的行）逐项就地收口；随后把 §4 的 generation 校验从「itemize 成员集」提升为**覆盖全部 policy/resourceRegistry handle 行**（`currentShape: null` 的登记缺口已在本线清零，不再是该提升的前置）。
- **人类授权**：否（goal Scope direction 2 与 Req 2.1 无条件条款已授权）。

### B3 Task 5.1–5.6、5.13（client 半）、8.4–8.7 —— client 公共面收口
- **未完成子项**：client `slots.contribute` / `remotes.contribute` / `settings.remote.contribute` 仍是裸 disposer 或 `Promise`；client `events.observe` 仍是裸退订函数、事件目录不可查询、未知名抛裸 `TypeError`；client 六个已登记 `availability` 成员运行时仍缺失、`capabilities.*` 仍按对象存在性报 active；`connection.get` 未改名；`settings.scope` 调用套路未统一；slots 白名单未交官方声明判定、无声明投影；client `lifecycle.register` 的 handle 未收口。
- **解除动作**：按 `tasks.md` Task 5.1–5.6、8.4–8.7 逐项实施；改源后必须 `npm run build:client` 重建 `lib/client.js` 并核对 `--check`。
- **人类授权**：否。

### B4 Task 3.3 / 3.4 / 10.1(e) —— 例外台账重分类与其余机械校验
- **未完成子项**：(a) **回收 6 条记录 / 4 行**未执行（`workflows.start.handle` 的 `.meta`/`.result`/`.cancel` 3 条、`agents.scopes.register.handle` 1 条、`llm.adapters.decorations.register.handle` 1 条、`workflows.start` 的 `terminal` 例外 1 条）；(b) 例外台账三口径净额**仍为开工基线 17 行 / 20 记录 / 16 path，未下降**；(c) Task 3.4 的另三条机械校验（扩展成员登记、`dispose()`/失败呈现与登记一致、入口动词与 idiom 一致）未实现。
- **解除动作**：按 design §3 的明细执行回收并同步 registry 例外清单，核算三口径净额；在 `scripts/registry-validate.mjs` 补上 (c) 的三条 entry 级校验。
- **人类授权**：否。

### B5 Task 3.1 的 registry 面 —— S15 的全量 `async` 回填
- **未完成子项**：`api-idioms` §5 已把 `async` 列为必需字段，但 registry 538 行**未回填**，validator 也**未加**该校验。
- **解除动作**：二选一——(a) 新增构建期/测试期的成员调用形态采集入口（mount facade 后按 `constructor.name === 'AsyncFunction'` 逐叶判定）生成 `async` 投影；(b) 按模块分组人工回填并在 validator 中加「`async` 必填且为 boolean」的 entry 级校验。
- **人类授权**：否（S15 已随分册修订落盘）。

### B6 Task 3.6 收尾 —— M10 行为表 / 装配表与历史现状注
- **未完成子项**：成员表已随 registry 机械重建；**行为表与装配表未被本轮变更触及**（行为表 37 行冻结、装配表 token 未变），故未重写。
- **解除动作**：B1–B4/B7/B8 完成后重跑 `node scripts/convergence-verify.mjs`，按报错逐行修表并保持三方互链。
- **人类授权**：否。

### B7 Task 1.6 / 1.7 —— 异步 contribution 的 pending handle 状态机
- **未完成子项**：`lib/contract-kernel.js` 未提供异步 contribution 的 `status()` 状态机（`pending | active | failed | revoked`），`test/contract-kernel.test.mjs` 亦无该断言；S14 的分册条款已落盘，但对应的内核构造器与消费方（client `remotes.contribute` / `settings.remote.contribute`，属 B3）均未落。
- **解除动作**：在 `lib/contract-kernel.js` 增补异步 contribution handle 构造（pending 可安全 dispose、`status()` 四态），加内核断言；消费方随 B3 落地。
- **人类授权**：否。

### B8 Task 5.13（host 半）—— 既有基准成员的 K2 dispose 收口
- **未完成子项**：host `events.observe`（`lib/events-bus.js`）、`events.define.handle`（同文件）、`sessions.planMode.observe`（`lib/sessions-plan-mode.js`）、`sessions.permissionPresets.observe`（`lib/sessions-permission-presets.js`）**及其 disabled 安装态的同一 `observe()` 实现**（`lib/plugin-api-service.js`）、client/host `attention.contribute` 的 `dispose()` 仍返回布尔；对应 handle 行的登记文案未同步。
- **解除动作**：按 `tasks.md` Task 5.13 逐处改用内核结果；保留各自的保留例外（`events.define.handle` 的外层偏离例外继续保留，只收口返回形状）；同步 registry handle 行。
- **人类授权**：否。

### B9 Task 8.1（域侧）—— availability 的域侧子项
- **未完成子项**：`lib/coordination-lease.js` 的 `availability(scope)` 未做挂载期缓存化、`lib/security-owner.js` 的 `availability`（顶层无 `status` 的 getter）未状态化。装饰层已归一，但这两处领域实现仍会先命中 descriptor 回退/需要异步解析。
- **解除动作**：按 design §1-K4 与 `tasks.md` Task 8.1 改两个属主模块，使领域同步给出三值状态并保留 durability / operations / backend / epoch。
- **人类授权**：否。

### B10 Task 8.9（余项）—— 其余缺位词汇点位
- **未完成子项**：`lib/session-activity-view.js` 的 `absent`（且与非法输入合并）等余下点位未统一为 `missing` / `unavailable`。
- **解除动作**：按 `tasks.md` Task 8.9 的四个属主模块清单逐处收口。
- **人类授权**：否。

### B11 Task 6.6（余项）—— 其余身份自报面改派生
- **未完成子项**：`workspaces.transactions.prepare({ownerId:})`（`lib/workspace-mutation-transaction.js`）、`storage.open` 的 `owner`（`lib/storage-binding.js`，与 C13 同批）、`prompts.contribute` 的显式 `spec.ownerId` 覆盖位（`lib/plugin-api-service.js`）三处仍接受调用方自报；`security.*.register` 的自报 owner 随 B2 的成员族一并与处置；client `lifecycle.register({ownerId})` 随 B3。
- **解除动作**：按 `tasks.md` Task 6.6 的 (a)/(b) 二分逐处处置——语义为「调用者身份」者删参改派生，语义为「资源所属者 / 目标 scope」者改名保留并登记 `identitySource: declared-resource-scope`；不可追踪时用根 token 并如实登记根回退。
- **人类授权**：否。

### B12 Task 8.x（余项）—— C1b / C3 / C4 / C7 / C8 / C9 / C10a / C10b / C10c / C12 / C13 / C14 / C15 / C17
- **未完成子项**：`workspaces.transactions.availability`（C1b）、slots 白名单与声明投影（C3，需重建 client bundle）、`sessions.channels` 三成员语义（C4/C5 的通道半）、client `connection.get` 改名与 registry 回滚登记（C7）、`settings.scope` 调用套路（C8）、`prompts` 匿名 id 与错误词表（C9）、`registerMinimalCatalogUpdate` 登记（C10a）、`admitted()` 补登记（C10b）、`agents.scopes` dispose 与登记矛盾（C10c）、settings mutation 判别式呈现（C12）、`storage.open.handle.domain` 保留判定（C13）、`capabilityMatrix` 内容模型（C14）、`C15` 互指说明与 `C17` 的 `async` 抽样复核（C17 的实际回填见 B5）。
- **解除动作**：按 `tasks.md` Task 8.x 逐条实施（C13/C14 只改登记与内容模型，风险最低，可优先）。
- **人类授权**：否。

### B13 Task 9.1 / 9.2 —— 组合验收与迁移切片
- **未完成子项**：双 synthetic 插件组合验收（反向加载顺序、卸载隔离、**旧 handle 不得撤销新资源**、callback 失败隔离）与迁移切片（同一工具全局→agent scope 的外层 handle 一致性、同一策略在 llm / prompts / security 的可迁移登记）**未新增证据**；现有相关测试只是被适配到新形状，不等价于本项要求的组合与迁移证据。
- **解除动作**：按 `tasks.md` Task 9.1/9.2 新增测试文件，文件头写明「原行为 → 现行公共调用 → 运行结果」矩阵，证据须来自真实公共入口执行（不得以 import 扫描、路径计数或测试总数充当）。
- **人类授权**：否。

### B14 Task 4.4 —— `llm.providers.register` / `llm.models.register` 的标准 handle
- **未完成子项**：两者仍是官方原样透传（`lib/index.js` 本轮零 diff）：`llm.providers.register` 透传官方可调用 handle 且 `.replace` 是未登记成员，`llm.models.register` 透传官方裸 disposer。
- **解除动作**：改 `lib/index.js` 把两者包装为标准资源 handle（`.replace` 作为显式扩展成员保留并登记），registry 两 leaf 行与两 handle 行同步。
- **人类授权**：否。

### B15 Task 3.5 尾项 —— authority closure（`bypasses`）登记
- **未完成子项**：design §5 末段要求为 `storage.open`（保留 `domain`）、`settings` mutation、`events` 派发三条路径在 registry 的 `bypasses` 字段写明是否旁路高层 authority，**无旁路者记录「闭合」**；registry 实测 `bypasses` 字段**零行**。
- **解除动作**：在上述三类成员行新增 array 形 `bypasses`，按 `composition-and-authority` §6 逐条写明旁路判定或「闭合」。
- **人类授权**：否。

### B16 Task 10.1(a) 与 Task 3.2-R1 —— 处置台账与 `lifecycle.register` leaf 行
- **未完成子项**：(a) `tasks.md` Task 10.1(a) 要求逐项记录 A1–A5 / B1–B3 / C1–C17 / R1–R6 的最终去向（证据锚点 + 落地提交）；本台账 §1/§3 记录了**本轮实际处置**，但未按该编号全集逐项给出「修复 / 合理例外 / 已修复 / 误报」四态结论与锚点。(b) Task 3.2-R1 要求补 `lifecycle.register` 的**现行 leaf 行**（现 registry 只有旧名 `lifecycle.registerFace` 的 removed 行与 `lifecycle.register.handle`），未做。
- **解除动作**：(a) 按编号全集补一张四态结论表（未处置者指向本节的 B 编号）；(b) 补 `lifecycle.register` 现行 leaf 行并核对旧路径映射。
- **人类授权**：否。

### B17 Task 3.1（词表半）—— registry `vocabulary` 增补
- **未完成子项**：Task 3.1 第一句要求 `vocabulary` 增 `identitySource` 两值（`derived-caller` / `declared-resource-scope`）与 `async` 相关词表；registry `vocabulary` 与基线逐字节相同（22 键），两处均无。
- **解除动作**：在 `vocabulary` 增 `identitySource: ['derived-caller','declared-resource-scope', ...]` 与 `async` 词表，并在 `scripts/registry-validate.mjs` 加对应字段校验；与 B5 的成员行回填同批完成。
- **人类授权**：否。

### B18 Task 3.2-R5 / Task 8.11（availability 半）—— `storage.availability` 的领域 detail
- **未完成子项**：`lib/storage-binding.js` 的 `storage.availability` 仍只返回 `{status:'active'}`，未按 K4 披露 `scope` / `durability` / `epoch`。
- **解除动作**：改 `lib/storage-binding.js` 使 `availability()` 同步返回三值状态 + 该三项领域 detail；registry 行同步（本版已先把该行改为描述**现状**，避免登记与实现不符）。
- **人类授权**：否。

### B19 Task 4.5（R 包输入校验半）—— `attachments.pipeline.transforms.register` 的失败呈现仍有两套
- **未完成子项**：facade 侧四条失败路径已 typed（见 §7.2），但 R 包 `packages/attachments/lib/pipeline-service.js` 自身的输入校验与「已释放」路径仍以**冻结判别式结果**返回（`packages/attachments/lib/pipeline-core.js` 的 `{status:'unavailable', …, error:{code:'ATTACHMENT_TRANSFORM_INVALID' | 'ATTACHMENT_OWNER_REQUIRED' | 'ATTACHMENT_POLICY_INVALID'}}`），facade 对非 thenable 结果原样透出；故该成员的公共失败呈现是「冲突：typed throw + 输入非法：判别式结果」两套，与本轮修订的 S2「注册类失败一律 typed throw」不一致，registry 行的 `failureSemantics: typed-throw` 只覆盖前者。
- **解除动作**：二选一——(a) 改 R 包使注册类输入校验**抛 typed error**（与 idiom 一致，需复核替代行的被替代契约与 boot 自检）；(b) 按 Req 11.5 补一条完整六项例外并在 registry 登记该 carve-out。**不得**两套并存而不登记。
- **人类授权**：否。

### B20 Task 4.3（接线半）—— `llm.routing` 注册的调用者绑定未接通
- **未完成子项**：routing 的四类注册表（`packages/agent-loop/lib/route-policy.js` 的 `createRegistrationRegistry`）已按 `(owner, id)` 键建表、支持注入 `resolveOwnerId`、跨 owner 同 id 抛 `ROUTE_POLICY_OWNER_CONFLICT`；但 facade 未把调用者绑定转发进去（`lib/plugin-api-service.js` 的 `invokeRoutePolicy` 原样转发实参，R 包 owner 创建时也未注入解析器），因此**经公共路径注册时 owner 恒为根 token**：跨 owner typed conflict 在公共面上不可达，两个插件同 id 会走同 owner latest-wins 静默替换。registry 四行已把 `identitySource` 如实改为 `derived-caller (root-fallback)` 并在 `currentShape` 写明该事实；本线**不声称**该族已达成派生 owner。
- **解除动作**：按 facade 对 `diagnostics.register` 的既有机制（`callerAware` + getter 内 stamp `callerCtx`）给 routing 四类注册补调用者绑定，并让 `packages/agent-loop` 的 owner 创建接受 facade 注入的 `resolveOwnerId`（走该包既有的门面契约符号，保持替代行契约复刻与 boot 自检）；接通后把 registry 四行的 `identitySource` 改回 `derived-caller`。
- **人类授权**：否。
- **备注**：同批已接通的三族（`llm.requestTransforms` / `llm.admissionPolicies`、`tools.discovery.catalog`）不再有该缺口（`tools.discovery.catalog` 的接线在第六轮补齐，见 §7.6）。

## 4. registry 校验规则的现状说明（如实登记）

`scripts/registry-validate.mjs` 本轮新增两条 entry 级校验：

1. **policy / resourceRegistry handle 的 generation 成员**。第十五轮起，规则**覆盖全部在册（`status !== 'removed'`）的 policy / resourceRegistry handle 行**，只**豁免带 `idiomExceptions` 的行**（该行的偏离已登记）。实测口径（第十五轮按 HEAD registry）：该类 handle 行 **34** 行（`advanced`），其中 `currentShape` 为 `null` 的 **0** 行、形状不提及 generation 的 **0** 行；两处委派型注册（`skills.activation.register.handle`、`skills.activation.policy.register.handle`）已在第十五轮包装为标准 handle，`currentShape` 相应 itemize 并含 generation，提升的最后屏障随之消失。规则从「只对 itemize 成员集生效」提升的判据：`currentShape` 为 `null` 的登记缺口已清零，且两类在册 handle 行全部写出成员集——**没有任何一行**还需要靠「prose 形态」豁免。
2. **例外记录的 `baseContract` 必属八类 idiom**。
3. **`callShape` 已回填**（Task 3.1/S15）：每行的 `callShape` 必须取自 `vocabulary.callShape`（`sync` / `async` / `not-applicable`），值为 `not-applicable` 表示该行描述的是值（handle、数据叶、已退役行）而非调用。

**为什么规则 1 曾一度不是全量**：登记缺口未清零时对全部行强制，等于要求为未改动的成员填写与其运行时不符的 `currentShape`——那是伪造登记，比漏报更有害。**登记缺口的历史**（供后续读者对账，非现行待办）：规则落盘时（`cb55e94`）registry 有 **42** 行成员的 `currentShape` 为 `null`（其中 handle 行 **21** 行，policy/resourceRegistry 子集 **16** 行；design §2.4 的 R 系列只列了六条同类缺口，是该缺口的抽样而非全量清单）；本线期间已由 registry 缺口收口提交（`6f62bd9`，registry 空形状清零）把这些行逐条补齐，HEAD 下 `currentShape` 为 `null` 的成员行为 **0**。

## 5. 未纳入本线的排除项（无变化）

design §9「明确排除」清单原样保持：SDK、TS 化、API reference 生成、发布包装、开发者培训、测试完备性工程；同步/异步差异本身；接受结果没有终态；operation 内部阶段与领域 payload 差异；coordination `release(handle)`；`services.*` 保留官方习惯；假想攻击的安全加固；不新增 R 点。

另记两条**设计取舍**（非阻塞，供后续记录）：

- **R 包各自复刻 handle 构造**：`packages/agent-loop`、`packages/attachments`、`packages/mcp` 三个替代包各有一份本地 handle 构造器，因为它们**不能 import 门面私有模块**（R 包必须自包含）。语义与内核一致（冻结、幂等、`revoked`/`stale`），但**释放失败的码不齐**——内核用 `unavailable`，`packages/attachments` 用 `stale`。统一该码集属后续维护项。
- **`tools.executionMode.register`**：其官方动词是**分类查询**（返回 `{kind}`），不是注册，registry 行文字「official execution mode registration disposer」是漂移。本线把它原样透传、未包装成 handle（包装会凭空制造官方契约没有的生命周期）；行文字修正并入 B2。

## 6. 能力边界变化（design K8 / S9）

**第三方经门面派发 canonical 系统事件，由「可用」变为 typed `denied`。** 具体：`pluginApi.events.emit / serial / parallel / bail / waterfall` 派发 canonical 系统事件前，门面按调用者身份与该事件的 producer 归属判定；非 producer 得到冻结 `{ok:false, code:'denied', reason}` 且**事件不被派发**；事件目录中未声明 producer 的条目 fail-closed（第三方与门面身份一并拒绝）。

**不受影响**：(a) 第三方自定义事件的唯一受支持路径 `events.define`，其名称空间、owner 归因与 stale 语义不变；(b) 官方插件经原生 `ctx.emit` 的派发（不经门面的 `dispatch()`）；(c) 门面自身的转译生产路径，以内部 owner 身份取得权限。

该变化已同步至 `AGENTS.md` §4 第 3 条、`README.md` 与 `docs/specs/plugin-api-features/feature-list.md` §7 的本 feature 条目；按人类 2026-09-14 的预授权执行。

## 7. 全局终审

见 §7.1。

### 7.1 全局终审记录（第一轮）

终审对象：相对 `cf2a2d1` 的全量 Stage 4 交付。第一轮结论 **有偏差**，三条阻塞级意见**全部集中在诚实性与一致性**（已交付代码主体经抽查与台账声称一致，可采信）：

1. 台账 §1「registry 与校验」声称「本轮全部形状变更落 registry」，实际 `events.{emit,serial,parallel,bail,waterfall}` 五行仍写 `returns undefined`、`executions.recovery.checkpoints.restore` 仍写 `handle:`、`workflows.start` 未随字段改名更新。→ **已就地闭合**：五行 events 派发成员、`checkpoints.restore`（含 handle 行）、`workflows.start`（含 handle 行）均已更新，成员表随之重建。
2. 台账 §3 阻塞项不穷尽，多处 tasks 子项「未完成且未登记」，且有一处悬空引用。→ **已就地闭合**：§3 重写为按 Task 编号的 B1–B13 逐条登记，悬空引用消除。
3. `attachments.pipeline.transforms.register` 的公共失败路径仍被 facade 的兜底 catch 折叠为 `ATTACHMENT_UNAVAILABLE`，与 §1 声称的收口及新落盘的 S2 相悖。→ **已就地闭合**：`lib/plugin-api-service.js` 的 `invoke` 增加操作/注册二分，注册类调用的 typed error 直接穿透，操作类仍降级为可用性结果。

中度/低度意见（§4 计数口径、§1 通栏冲突措辞、availability 缓存措辞、测试基线两个数字、R 包码集、K8 单列）亦已在本版逐条修正。

第二轮终审结论见 §7.2。

### 7.2 全局终审记录（第二轮）

第二轮结论 **有偏差**，四条阻塞级意见（同样集中在诚实性与一致性）：

1. **Task 4.4 未完成且未登记**（`llm.providers.register` / `llm.models.register` 仍为官方透传）→ **已闭合**：补登为 B14。
2. **Task 3.5 的 authority closure（`bypasses`）未完成且未登记** → **已闭合**：补登为 B15。
3. **§1 声称「观察面成员行已落 registry」但实际未落**：程序化 diff 显示 45 个变化行中 observe 行为 0；`prompts.contribute.handle` 与缺失的 `tasks.observe.handle` 同型。→ **已闭合**：观察面 9 行（含补入的 `tasks.observe.handle`）与 `prompts.contribute.handle` 均已落盘，成员表重建为 **538 行**；§1 的措辞改为逐面列举变化行数。
4. **本轮修订新引入的不符**：`executions.recovery.checkpoints.restore` 的失败形状被我写成单一形态，而实现有「无控制对象的前置拒绝」与「带控制对象的 stop-then-restore 拒绝」两态。→ **已闭合**：registry 行改为四态枚举（含 `invalid-input` 无 `observedAt` 的前置拒绝）。

中度/低度意见（attachments 注册类「环境不可用」仍折叠、`feature-list` 通栏冲突措辞、Task 10.1(a) 与 3.2-R1 未登记、B 条目缺「原因」、events 异步变体的 Promise 返回未注明）亦已处置：`invoke` 的注册类在 `!active()` / 缺成员两条 early return 上改为 **typed disabled throw**（不再是可用性结果），并新增两条断言钉住注册类抛错与操作类降级；`feature-list` 措辞改为「按各成员 idiom 的冲突规则」；补登 B16；§3 抬头改为如实说明「原因」在何处写出；events 异步变体的 Promise 返回并入 B5 的 `async` 回填。

第三轮终审结论见 §7.3。

### 7.3 全局终审记录（第三轮）

第三轮结论 **有偏差**，五条阻塞级意见（前两轮的同类：覆盖与登记的一致性），全部已就地闭合或补登：

1. **`checkpoints.restore` 的失败枚举仍不完整**（漏了 owner 派生不可用的无 `observedAt` 分支，且未提 planner 码透传）→ **已闭合**：registry 行改为五态枚举，含两条无 `observedAt` 的前置拒绝与 planner 码透传说明。
2. **新增的 `tasks.observe.handle` 行漏记已登记的扩展成员**（`taskId` / `initialState`），父行同源 → **已闭合**：两行的 `currentShape` 均写明这两个扩展成员。另记一处非阻塞的字段级差异：该行 `effect: 'subscribe'`（其余 projection handle 行多为 `read`）、`identitySource: 'caller plugin context'`（同类带值行多为 `parent handle generation`），与其父行一致而与同类 handle 行不一致，属既有口径，随 B2 一并对齐。
3. **Task 3.1 的 `vocabulary` 增补未做且未登记** → **已闭合**：补登为 B17。
4. **Task 3.2-R5 / 8.11 的 `storage.availability` 未做且未登记，且 registry 行与实现不符** → **已闭合**：补登为 B18，并先把 registry 行改为描述**现状**（不再声称披露 `scope/durability/epoch`），避免登记与实现不符。
5. **attachments 的 `failureSemantics: typed-throw` 在 R 包自身的输入校验路径上不成立** → **已闭合**：补登为 B19（两套失败呈现并存，须改 R 或登记 carve-out，不得静默）。

中度/低度（§1 行数与面别计数不符且内部不自洽、§2 与成员表 prose 的 537、`tools.register` 的冲突规则陈述、`feature-list` 的 B1–B13、三处 `conflictRule` 字段与实现相左）亦已处置：§1 改为「56 改 + 1 增 = 57」并按实测给出 32/10/2/9/4 的面别分解；§2 与成员表 prose 均改为 538（`scripts/convergence-table-sync.mjs` 现在同时维护该计数行）；`tools.register` 的冲突规则按 scoped `(owner, target, id)` 与全局官方内容语义分开陈述；`feature-list` 的阻塞项编号改为 B1–B19；`tools.guard`/`tools.presentation` 的两处 `conflictRule` 改为 `not-applicable`（门面不做冲突判定）、`diagnostics.register` 的两处改为 `latest-wins`（per-owner latest-wins、跨 owner 并存）。

第四轮终审结论见 §7.4。

### 7.4 全局终审记录（第四轮）

第四轮结论 **有偏差**，但只剩**一条**阻塞级意见与一条中度、两条低度；第三轮的五条阻塞与全部中度/低度**已确认闭合**。

阻塞（`llm.routing.candidates` / `llm.routing.health.probe` 四行的 `conflictRule` / `idempotency` 与实现及同族两行不符）→ **已闭合**：四类 routing 注册共用同一个 `(owner, id)` 键实现的表，本轮恰好就是把它改成 owner 维度的提交，但只有 `policies` 与 `health.circuitPolicy` 两行跟上了字段；四行已统一为 `conflictRule: owner-conflict`，两 leaf 行的 `idempotency` 改为 `latest-wins`。同类的相邻行一并核对并同步：`agents.providers.register`（provider slot 一个 owner 一个槽位，第二 owner 为 typed conflict）与 `tools.discovery.catalog.register`（重复 entry id 无论 owner 一律拒绝）的 `conflictRule` 改为 `owner-conflict`。

中度（`llm.requestTransforms.register` / `llm.admissionPolicies.register` 的 `currentShape` 声称了一条不存在的官方安装路径）→ **已闭合**：两行改写为「门面自有注册表 + 经 `llm/stream` 重入 / 解析模型信息包装消费」，与实现一致。

低度（B5 仍写 537；`agents.providers.register.handle` 的 announce no-op reason 文案）→ **已闭合**：B5 改为 538；该行改为「always answers the typed stale no-op」，不再声称 reason 文案。

第五轮终审结论见 §7.5。

### 7.5 全局终审记录（第五轮）

第五轮结论 **有偏差**，两条阻塞级意见，均已在**代码层**（而非只改登记）闭合：

1. **五行注册类 leaf 的 `idempotency` 与实现相左**（`tools.discovery.catalog.register`、`agents.providers.register`、`diagnostics.register`、`tools.guard.register`、`tools.presentation.register`）→ **已闭合**：按实现逐行改正（重复即拒 / 每次重新委派 / per-owner latest-wins / 每次追加 / 同 scope 第二次拒绝），handle 行同步。
2. **三个 llm 注册族与 `tools.discovery.catalog` 的公开路径 owner 恒为根 token**，与我方「派生 owner」的声称不符（routing 四类的跨 owner conflict 在公共面不可达）→ **已闭合（分两半）**：`llm.requestTransforms` / `llm.admissionPolicies` / `tools.discovery.catalog` 三族按与 `diagnostics.register` 相同的机制**接通了调用者绑定**（slot 的 `callerAware` + getter 内 stamp `callerCtx`；`invokeNested` 的 caller-bound 选项）；**routing 四类未接通**（需 R 包 owner 创建接受 facade 注入的解析器），已把 registry 四行的 `identitySource` 如实改为 `derived-caller (root-fallback)`、`currentShape` 写明现状，并**补登为 B20**——本线不再声称该族已达成派生 owner。

低度意见（`agents.providers.register` leaf 的 announce 文案残留；Task 8.15 的 availability 映射测试缺席）→ **已闭合**：文案不再声称不存在的 reason；新增一条矩阵断言（`unsupported`→`unavailable`、`unknown`/`inert`→`degraded`、原 token 作 `reason`、领域 detail 保留）。

第六轮终审结论见 §7.6。

### 7.6 全局终审记录（第六轮）

第六轮结论 **有偏差**，两条阻塞 + 两条中度，均已在**代码层或登记层**闭合：

1. **`tools.discovery.catalog.register` 经公开路径仍未从调用者派生 owner**（`invokeNested` 转发的是挂载期的门面上下文，不是注册时的调用者）→ **已闭合**：按 `llm` / `diagnostics` 的同一机制，在 `tools` getter 内为该 slot stamp `callerCtx`，`invokeNested` 转发该 stamped 上下文。`test/index-tool-discovery.test.mjs` 的「this facade surface forwards no caller binding」注释已失真，同步改写为「无 loader entry 的 harness 上下文不可追踪，故由根 token 归因」。
2. **`tools.register` 的 `idempotency: content-idempotent` 与官方动词相左**（官方 `NamedEntries.insert` 对同名一律抛错，不比较内容）→ **已闭合**：两行改为 `not idempotent`，`currentShape` 改写明「官方全局动词对重复 tool 名直接拒绝（无内容比较、无替换），故重复登记是 typed duplicate 而非幂等 no-op」。该口径来自 M10 期的旧表述，本线改写该行时保留，现已一并修正。
3. **中度：`tools.restrict.register` 的 `latest-wins` 与两条路径都不符**（官方 `restrict` 是追加/交集语义、facade scoped 同键是 typed conflict）→ **已闭合**：两行改为 `not idempotent`，`currentShape` 写明「官方动词每次追加一条 restriction、从不替换」。
4. **中度：四个注册 handle 行的 `idempotency` 未与其 leaf 对齐**（这四行正是第五轮「handle 行同步」要求的两行 + 第四轮遗留的两行）→ **已闭合**：`agents.providers.register.handle` 改 `not idempotent`，`diagnostics.register.handle`、`llm.routing.candidates.register.handle`、`llm.routing.health.probe.register.handle` 改 `latest-wins`，与各自 leaf 一致。

第七轮终审结论见 §7.7。

### 7.7 全局终审记录（第七轮）

第七轮结论 **有偏差**，只剩**一条**阻塞（治理同步面）+ 三条低度；第六轮的四条意见**全部确认闭合**，且「57 个改动行逐行核对未再发现登记与实现不符」。

阻塞（**Task 10.3 的 S10 半：`AGENTS.md` §2/§4 未落盘且未登记**）→ **已闭合**：`AGENTS.md` §4 第 6 条补两项——(a) `services.*` 的官方存在性口径（`isActive`）为**受支持例外**、语义面一律 `availability().status`（外层三值 + 领域 detail 保留）、不得把 `isActive` 口径扩散或以对象存在性冒充 `active`；(b) `capabilityMatrix()` 的内容模型只表达**当前**能力与限制、迁移账本留在 registry。S10 的分册修订此前已落盘（`capability-strategy.md` §6、`api-idioms.md` §2），至此治理同步面补齐。

低度（`tools.restrict.register` / `tools.presentation.register` 丢失官方 scoped-context 前置条件）→ **已闭合**：两行的 `currentShape` 恢复该前置条件说明（实现未变）。另两条低度按**维护项**记录、不影响本线结论：① 三处 handle 行的 `idempotency` 与其 leaf 措辞不齐（`settings.register.handle`、`workflows.start.handle`、`sessions.cancel.handle`，均非本线改动行的实现矛盾，建议下一维护批次统一 handle 行口径）；② registry 在本轮若干次落盘中出现非 ASCII 转义序列化的编码转换（`JSON.parse` 等价、validator 与三表校验均不受影响），已在本次收口时统一为带转义的可复现序列化。

第八轮终审结论见 §7.8。

### 7.8 全局终审记录（第八轮）

**第八轮结论：无偏差** —— 第七轮的唯一阻塞与三条低度全部闭合或如实记为维护项；`cf2a2d1..HEAD` 的 57 个成员行逐行复核、Task 1–10 全子项对账、四项机械门只读复跑、版本冻结与无夹带面**均未发现实质问题**。终审确认的要点：

- 第七轮阻塞（Task 10.3 的 S10 半）已闭合：`AGENTS.md` §4 第 6 条新增的两个子条与 `capability-strategy.md` §6、`api-idioms.md` §2 逐句一致；registry 的 `services` namespace 记录确带 `availabilityExemption`。
- 57 行改动（56 改 + 1 增）逐行与实现相符，面别分解 32/10/2/9/4 零未归类；本轮新改的两行（`tools.restrict.register`、`tools.presentation.register`）与官方 `dsh-tools` 的 scoped-context 前置条件一致。
- 未完成项**全部**可落位 B1–B20，无「未完成且未登记」项；B1/B5/B9/B10/B11/B14/B15/B17/B18/B19/B20 的描述经抽验与实现相符。
- 四项机械门全绿；版本冻结、`servicesWhitelist` 54 键、官方包零修改、R 点零变化实测成立；`843791d` 的改动面精确（4 文件）。
- 终审另记一条**不构成偏差**的备注：B8 括注中关于 `attention.contribute` 失效形态的措辞略不精确（该 handle 的 dispose 已返回判别式结果，偏离在**码集**用了 `noop`/`withdrawn` 而非 K2 的 `stale`/`revoked`；client `attention.observe` 的 dispose 返回 `undefined` 未在该枚举中点名，但已落入 Task 4.14 的第二臂 → B2）。登记本身成立、无工作被隐匿，属措辞级；按收敛轮纪律不计偏差，随 B2/B8 的收口一并对齐。

**终审范围声明**：本轮终审通过的是**已交付范围**（§1）与**登记面**（§3 的阻塞项穷尽性与诚实性）的一致性。本 feature **仍未达到完成判定**：Stage 4 的验收义务由 B1–B20 承载，其中 B2（K1/K2/K3 全树一致性收口）、B3（client 公共面）、B12（C 系列余项）、B13（组合验收与迁移切片）是范围最大的四项。**本线不声称 M11 已收口**。

---

### 7.9 第二轮交付的全局终审（第一轮，对象 `ab15065..a42481a`）

结论 **有偏差**，6 条阻塞、4 条中度、3 条低度；四项机械门、版本冻结与官方包零修改成立。意见与处置：

1. **B1（阻塞，实质缺陷）**：`storage` / `workspaces` / `security` 三处 facade getter 用的是**箭头函数**（`get: () => {}`），闭包捕获门面服务自身；Cordis 只在**方法式** getter 上把访问上下文作为 receiver，故三族的 owner 派生实际未接通。→ 三处改为 `get() {}`。
2. **B2（阻塞）**：registry 的 `client|settings.remote.contribute` 行写成判别式 + handle，实现是 Promise。→ 改回描述现状并标注未交付。
3. **B3（阻塞）**：`host|events.observe` 的 leaf 与 handle 行被写成 client 形状。→ 改回 host 形状。
4. **B4（阻塞）**：`agents.scopes.register` 行未随实现（typed throw）更新。→ 更新（第二轮审查复验时又发现旧文本未删净，见 §7.10）。
5. **B5（阻塞）**：C7 回滚的 registry 同步只做了一半（`targetPath` / `oldToTargetMapping` / `statusByPath`）。→ 三处同步，消除自环。
6. **B6（阻塞）**：台账 §3 未更新（12 条已不成立 + 若干漏项），抬头「阻塞项」与新纪律口径冲突。→ §3 改为「未完成项登记」并加 B1–B20 状态索引；§3.0 未完成表补入 B2 余项与 client `lifecycle.register({ownerId})` 派生。
7. 中度 M1–M4（`sessions.activity.*` 行残留 `absent`、`slots.observe` 首参、`events.list` 的新增属性措辞、新增 client 行的 `identitySource` 应记 root-fallback）与低度 L1–L3（host `settings.remote.contribute` 的冲突码、观察 handle teardown 失败的返回形状、一处死调试代码）全部处置。

### 7.10 第二轮交付的全局终审（第二轮，收敛验证，对象至 `84fa236`）

结论 **有偏差**：第一轮 6 条阻塞中 **5 条确认闭合**（B2/B3/B5/B6 完整、B4 部分），但 B1 的修复**引入新的阻塞级缺陷**：

- **B1′（阻塞，别名）**：三处 getter 改为方法式后，仍以「共享可变字段 + 末次访问者胜」实现（`record.callerCtx = …` 在访问时写、在调用时读）。后果：(a) 先取面后使用的调用会被记到最后访问者的 owner；(b) 门面自身的内部挂载（`lib/index.js` 捕获的 `service.storage` 用于 checkpoint 记录、`service.workspaces?.transactions`）会被归因到"最后访问该命名空间的插件"，且随访问顺序漂移（修复前稳定为门面身份，属回归）。
  → **已就地闭合**：三处改为 **per-caller 视图**（`_storageForCaller` / `_workspacesForCaller` / `_securityForCaller`，按派生身份缓存绑定成员），与既有的 `_routingForCaller`、`prompts` 的按 owner 缓存一致；slot surface 不再注入共享字段。`test/caller-derived-owner.test.mjs` 增加「先取面、后使用」的别名回归断言。
- **中度（已闭合）**：`agents.scopes.register` 行的旧文本未删净（同一行既写 discriminated results 又写 never discriminated results）→ 删除旧文本；L1 的修复过宽（`PluginApiRemoteError` 一律映射为 `conflict`，语法校验也被误判）→ 收窄为「带 `serviceKey` 的冲突」，语法错误保持 `invalid-input`。
- **低度（已闭合）**：§2 测试计数刷新为 3522；§3.0 中 `connection` 改名的措辞方向修正（回滚语义）；§7 补入本轮终审记录（本节）。
- **低度（登记为下一轮项）**：`security.policy.register` 的 `conflictRule: owner-conflict` 与实测口径（同 owner latest-wins / 跨 owner 并存）存在张力，已记入 §3.0 未完成表待下一轮择一统一。

### 7.11 第二轮交付的全局终审（第三轮，收敛验证，对象至 `75bbc91`）

结论 **有偏差**：§7.9 的 6 条阻塞与 §7.10 的别名缺陷经独立探针**确认闭合**（含真实 cordis 树的跨 caller 与 host→plugin 两条反例），两条中度与三条低度亦闭合；但本轮修复引入一条**新的阻塞回归**：

- **阻塞（新回归）**：per-caller 视图缓存以 owner 身份为键、**无 slot 代次**且无失效点，slot 被替换后同一 caller 仍拿到旧视图，对活着的 feature 抛 `disabled`（storage / workspaces / security 三处；disable→enable 循环亦不自愈）。
  → **已就地闭合**：三处视图缓存改为 **`WeakMap<slot, Map<identity, view>>`**（`_callerView` 统一实现），slot 被替换即自然失效，旧 slot 与其视图可被回收；`test/caller-derived-owner.test.mjs` 增加「重挂载后视图跟随新 slot」的回归断言。
- **中度（既有缺陷，登记为下一轮项）**：`llm.requestTransforms` / `llm.admissionPolicies` / `tools.discovery.catalog` / `diagnostics.register` 四族仍走 `createFeatureSlot` 的 `callerAware` + 共享 `record.callerCtx`（末次访问者胜），与 registry 声称的 `identitySource: caller plugin context` 不符。**这不是本轮引入的回归**（该机制自 M11 首轮交付起存在），已记入 §3.0 未完成表。
- **中度（环境相关）**：调用者 ctx 链上 `.loader` 不可解析时，身份回退为 root token，per-caller 视图随之被跨调用者共享（先到者胜）。正常 DSH profile（官方 loader 在场）不可复现，已记入 §3.0 未完成表，与上一项同批处理（统一改为按 caller 视图 + 显式 root 回退登记）。
- **已排除**：`Object.freeze` 后的视图仍可被 `_decoratedNamespaces` 正常装饰（`mergeSurface` 克隆到新对象，不写原对象）。

### 7.12 第二轮交付的全局终审（第四轮，收敛验证，对象至 `59f273a`）

结论 **有偏差**：§7.11 的阻塞回归经独立探针与**反例对照**（临时以旧的身份键实现回放，确认新实现不抛、旧实现抛 `disabled`）**确认闭合**；`storage` / `workspaces` / `security` 三处在重挂载与 disable→enable 循环后均跟随新 slot。新增 1 条中度与 1 条既有低度：

- **中度（本轮新引入，已就地闭合）**：新增的「重挂载后视图跟随新 slot」断言**不具判别力**——测试的 `forCaller` 每次读取都新建接收者，旧的身份键实现把缓存在该一次性接收者上，因而同样通过（虚假保证）。
  → 已改为**复用同一 caller 接收者**取两次面（`test/caller-derived-owner.test.mjs` 的该用例），旧实现下 `viewAfter === viewBefore` 会失败，断言自此具备判别力。
- **低度（既有缺陷，已登记为下一轮项）**：`prepareFeature(...).rollback()` 在 `storage` / `security` 上无法恢复禁用面——`_readSlot` 与 `unmountFeature` 都没有 `storage` 分支（rollback 静默 no-op），`createDisabledSecurityApi` 缺少 `egress.lease.release` / `egress.coverage` 导致 `_assignFeature('security')` 的挂载守卫抛错（异常在 apply 的 `close()` 中被吞，feature 已销毁而门面仍发布其 api）。经 `git show 75bbc91:lib/plugin-api-service.js` 比对确认**非本轮引入**，可达性窄（host 无 `unmountFeature('storage')` 调用点）。已记入 §3.0 未完成表。
- **已确认无问题**：三处 getter 仍为方法式；`_callerView` 的三个字段无其他读写路径（无残留身份键缓存）；`slot.callerCtx` 的 4 处写点恰为 §3.0 已登记的下一轮四族，与三处 slot 无交集；`_promptsSurfaceCache` 有显式失效点、`_routingCallerSurfaceCache` 绑定 service-lifetime surface，均非同型问题；`Object.freeze` 与 `_decoratedNamespaces` 的装饰互不干扰。

### 7.13 第二轮交付的全局终审（第五轮，收敛验证）—— **无偏差**

**结论：无偏差（无阻塞、无中度）。** 第四轮的 1 条中度（重挂载断言不具判别力）经**回放实验**确认已建立判别力：审查代理以 data-URL loader 在内存中把三处 caller 视图替换为旧的身份键实现（worktree 零改动），`test/caller-derived-owner.test.mjs` 中「重挂载后视图跟随新 slot」一条**如实失败**（`assert.notEqual(viewAfter, viewBefore)`），其余四条只验身份绑定、本不承担该职责；反向对照探针显示 HEAD 下 `viewFollowsNewSlot: true` 且新 slot 收到调用，旧实现下为 `false` 且对活 slot 报 `disabled`——即 §7.11 阻塞语义确已消除。第四轮登记的既有低度缺陷（`prepareFeature(...).rollback()` 在 storage / security 上无法恢复禁用面）已入 §3.0 未完成表，其代码事实（`_readSlot` / `unmountFeature` 缺 `storage` 分支、`createDisabledSecurityApi` 缺 `egress.lease.release` / `coverage`、异常在 apply 的 `close()` 中被吞、`ab15065` 与 `75bbc91` 两版本均如此）经逐条核对成立；审查另说明「可达性窄」的准确依据是**影响面**而非零调用点（`ctx.effect` 的宿主拆除会调到 `rollback()`），登记已覆盖同一根因。

本轮 diff（`59f273a..HEAD`）仅测试与台账，**实现零改动**；三处 getter 仍为方法式、`_callerView` 仍为 `WeakMap<slot, Map<identity, view>>`、无残留身份键 slot 缓存（其余按 identity 键控的缓存各有显式失效点或绑定 service-lifetime surface，均非同型问题）；六项机械门全绿；工作区干净。

**终审范围声明（第五轮）**：本轮通过的是**第二轮交付的实现与登记面**同 `tasks.md` / `design.md` / `requirements.md` 的一致性，以及按 `docs/standards/` 适用分册的符合性。**M11 仍未收口**——交付义务由 §3.0 的未完成清单与 §3 的状态索引承载（最大余项：B3 的 client 自描述与贡献面余项、B12 的 C 系列余项、B4 的例外台账重分类与三条校验、B5 的 `async` 回填、B13 的组合验收与迁移切片、B16a 的四态结论表、以及 §3.0 新登记的三条既有缺陷）。
