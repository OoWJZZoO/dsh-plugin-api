# Stage 3 Tasks: plugin-api-m11-contract-enforcement（batch-2 实效收口）

> feature_name: `plugin-api-m11-contract-enforcement`（批次：**batch-2「实效收口」**）
> milestone: M11
> status: Stage 3 已产出（2026-09-21）。Stage 0–2 已交付（`ecdb920`、`8cc1a25`）。
> 输入溯源：同目录 `goal.md` / `requirements.md` / `design.md`；`../batch-1/` 的 Tasks 与交付台账（本批基线与既往事实）；`temp/m11-effectiveness-review-and-fix-guide.md`（**临时只读输入，仅存 `temp/`、永不提交**；其 F1–F7、5 个未登记成员与 §6 观察项已全部固化进 `design.md` §2，实现与验收 **SHALL NOT** 依赖 `temp/`）。
> 编排依据：design §11 的依赖顺序（§1 契约增量 → §2 逐项映射 → §3 分册修订），并把 §3 分册修订提前到 Task 3–9 的实现之前，依据是 design §3 表下注的明文纪律「修订未落盘前，实现不得先落新形状」。检查门：本文经**阻塞式只读对抗性审查**（`run_in_background: false`）通过后，**先提交 tasks.md（Stage 3 阶段提交，AGENTS §3.2「阶段提交（强制）」）**，再进入 Stage 4；不提交用户评审。
> 决策口径（design §9）：六条公共形状决定（`settings.register` handle 化、`events.observe` 两端信封、`attention.hubSnapshot` 内部化、client `slots` 收敛 `inspect`、`capabilities.get` 未知不抛、`settings.scope` 两端对象形态）由 SPEC1 列明决策与替代方案；人类于 2026-09-21 指示以 SPEC3 工作流推进本批，**未推翻**任一项 ⇒ 按 §9 默认决策执行。执行中若发现任一项需推翻、或触及版本与发布 / milestone 范围，停下并请求人类裁决（AGENTS §3.2 硬停机点）。
> 人类授权记录：本批立项与规格编写授权见 `goal.md`「立项依据」；本次 Stage 3–4 推进授权为人类 2026-09-21 的 SPEC3 开工指示。两者共用同一条范围授权（M11 内新增一个修复批次），不改变本批验收边界。
> 执行口径（承 batch-1）：版本冻结基线内交付（runtime `0.1.0-rc.6`、主包及全部辅助/聚合包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`），不步进任何版本字段；**不新增 R 点**（仅允许在既有替代包 `packages/mcp`、`packages/api-remotes` 自身的扩展面内修订，并维持被替代官方行的契约复刻与 boot 自检）；官方包文件零修改（`/usr/lib/node_modules/@deepseek-ai/dsh/**` 零改动）；`lib/client.js` 只经 `npm run build:client` 重建；所有入口 fail-safe（apply 不抛穿）。
> 连续执行纪律（AGENTS §3.2「Stage 4 连续执行纪律」）：Stage 3 审查门通过后，本线 SHALL 在同一工作序列内完成全部顶层任务直至 Stage 4 完成判定（全局终审通过 + 完成提交）；**只有两类因素可以合法停下**——触及硬停机点（版本与发布、milestone 范围），或因环境 / 工具链 / 权限缺失而确实无法完成的已授权工作。不得以批次边界、会话长度、上下文占用、任务规模或「已交付部分成果」为由终止未完成的主体工作；未完成项不得登记为「阻塞项」——「阻塞项」的判定标准是代理**无法**完成，而非**尚未**完成。
> 执行纪律（design §6）：**本线单线串行执行，不并行派工**。`lib/plugin-api-service.js`、`lib/index.js`、`lib/client-runtime.js`、`lib/namespace-availability.js` 与 `public-contract.registry.json` 为热点共享文件，按 Task 编号顺序集中串行修改；任一热点文件在多个 Task 出现时，以本文件编排的先后为编辑边界与合并顺序。
> 登记落点约定：Task 3–9 各自完成实现与测试，并把形状变更的 registry 同步项写成本任务的「登记清单（交 Task 10）」；registry 数据、`removed` / `oldToTargetMapping` / `statusByPath`、校验扩展与三表镜像统一在 **Task 10** 落盘（同一件工作只做一次，避免两处各改一次）。
> 治理 token 边界（AGENTS §6、Req 12.4）：本文在 `docs/` 下使用 F/B/S/Req 编号是允许的，但**实现产物不得携带这些编号**——`lib/`、`packages/`、`test/`、`package.json` 与 bundle patch 中的命名、错误文案、Symbol 键、目录 / 文件名一律使用中立、面向能力或语义的名字。各 Task 实现者在动手时即须遵守。

## Stage 3 探针记录（开工时基线，Stage 4 以对账与测试复核）

- **P1 基线全绿**（开工时工作区干净，HEAD = `8cc1a25`）：`npm test` **3577/3577** 通过（fail 0，约 5.3s，4G 护栏内）；`node scripts/registry-validate.mjs <registry>` 输出 `registry valid`；`node scripts/convergence-verify.mjs` 输出 `563 member rows, 37 behavior rows, 37 fully linked behavior rows`；`npm run build:client:check` 输出 `client bundle is up to date with its sources`；`node scripts/capability-matrix-sync.mjs --check` 输出 `capability matrix is in sync with the registry`。**基线复用核对（Req 1.5）**：指引基线 `cbbc29b..HEAD` 仅两个 docs 提交（`ecdb920` spec 按批次分目录 + batch-2 Stage 0–2；`8cc1a25` SPEC2 纠偏）与 `feature-list.md` 一行，**零代码变更、无已实施修复需要复用**；若执行中发现遗漏，按 Req 1.5 复核并复用。
- **P2 registry 骨架实测**：`members` 563、`namespaces` 53、`eventCatalog` 69、`oldToTargetMapping` 394、`statusByPath` 177、`capabilityMatrix` 100、`servicesWhitelist` 54；成员行 29 字段（含 `callShape`）。`namespaces` 记录结构为 `{namespace, runtime, capabilityPath, contributingFeatures, availabilityMember, availabilityExemption}`。
- **P3 观察面登记现状实测**：在册 `.observe` 叶 **22** 行（host 17 + client 5），全部 `idiom: projection`（Req 10.1 的该断言现状即满足），`callShape` 取值 ∈ {`sync`, `async`}。**handle 行缺失 6 个**：`llm.routing.health.observe`、`prompts.provenance.observe`、`workspaces.transactions.observe`、client `lifecycle.observe` / `slots.observe` / `remotes.observe`（与 design §2.9-4 一致；本批补 2 个形状变更涉及行）。**反向行实测**：host `attention.observe` 行 `failureSemantics: discriminated-result` 而实现 `dispose()` 无返回；`settings.scope` 行 `discriminated-result` 而实现对未知 ns 抛 typed error；`tools.executionMode.register` 行 `idiom: resourceRegistry` / `effect: register` / `lifecycle: new lifecycle after dispose` 与自身 `currentShape`（classification query）矛盾；`coordination.observe` / `sessions.observe` / `sessions.durable.observe` 的 handle 行 `currentShape` 为「new target handle without a current counterpart」。client `slots.list` / `slots.declaration` 均在册（本批收敛为 `slots.inspect`）。
- **P4 关键锚点抽样复核**（与 design §1/§2 逐项一致，无事实订正）：`lib/settings.js:19-37/59-72`、`lib/namespace-availability.js:30-34/182-208`、`lib/attention-hub.js:480-497/499-543`、`lib/index.js:2547-2560`、`lib/plugin-api-service.js:619-623/1436-1439/1892-1931/3782/3808-3849`、`lib/events-bus.js:553-643`、`lib/coordination-lease.js:357-494`、`lib/context-engine.js:767-782`、`lib/client-runtime.js:372-388/590-658`、`lib/client-slots.js:44-84`、`lib/client-settings-scope.js:19-30`、`lib/storage-binding.js:146-160/231-239`、`lib/decision-participation-facade.js:246-253/284-288`、`lib/security-owner.js:550-571`、`lib/task-execution-observation.js:274-304/1405-1438`、`packages/mcp/lib/catalog.js:219-311`、`packages/api-remotes/lib/apply.js:127-138`。
- **P5 capability 现状实测**：host `CAPABILITY_PATHS` **49** 条（`lib/capability-descriptors.js` 派生），未知 path 抛 `PLUGIN_API_CAPABILITY_UNAVAILABLE`，`get` 返回 `{ capability, status }`（无 `reason`）；client `CLIENT_CAPABILITY_PATHS` **14** 条，成员级 path **仅单层**（`member.includes('.')` 即拒），状态取所属根探针，未知 path 抛。
- **P6 availability 现状实测**：装饰层映射表缺 `available` 且未映射 token 静默回落描述符状态（`lib/namespace-availability.js:192-196`）；`storage` 禁用形态缺 `epoch`（`lib/storage-binding.js:151-159`；活面 `:231-239` 有）；`workspaces.transactions.availability` 手写 status 分支（`lib/plugin-api-service.js:3808-3829`）；`security.availability` 按 `faces` 口径（`lib/security-owner.js:550-571`）；四个 `*.availability` 无 registry 行（P2/P4）。
- **P7 client 现状实测**：attention 降级 handle `dispose(){}` → `undefined`、`current()` → 数组、`subscribe` 忽略参数（`lib/client-runtime.js:372-388`）；`slots.list` + `slots.declaration` 双成员读同一事实（`lib/client-slots.js:44-84`）；`settings.scope` 返回官方 scope 原样（`lib/client-settings-scope.js:19-30`）；client capabilities 见 P5。
- **P8 R 包落点现状**：`packages/mcp/lib/catalog.js:293-311` 的 `onChange(listener)`（本地复刻 handle + listener 直参；公共别名装配在 `lib/plugin-api-service.js:1191`）；`packages/api-remotes/lib/apply.js:127-138` 的 snapshot resolver 经 `pluginApi.attention.hubSnapshot`（跨组件内部缝的既有消费点）。
- **P9 受影响的既有测试（Stage 4 须同步更新；不得以改测试代替改实现）**：`test/observation-surface.test.mjs`（`llm.routing.observe(session, listener)` 裸 listener 直参与「直接 handle」断言）、`test/client-observation-handles.test.mjs`、`test/attention-hub.test.mjs`、`test/client-slots.test.mjs`、`test/client-settings-scope.test.mjs`、`test/events-observe-production.test.mjs`、`test/namespace-availability.test.mjs`、`test/client-capability-availability.test.mjs`、`test/task-execution-observe.test.mjs`、`test/session-activity-observe.test.mjs`、`test/registry.test.mjs`、`test/settings.test.mjs` 等（Stage 4 逐项复核；更新理由一律为「形状按本批合同变更」）。
- **P10 挂载 harness 现状**：host 门面内存挂载可用 `createFeatureRegistry` + `createPluginApiService`（`test/observation-surface.test.mjs:13-22`）或 `test/call-shape.test.mjs` 的 harness 桩模式；registry 纯校验可在测试内直接 `import { validateRegistry }`（`test/registry.test.mjs:15-19`）；client 侧以源码 + 轻量桩驱动（无浏览器运行时）。

---

## Task 1: 输入固化与开工对账（对应 Req 1）

- [ ] 1.1 探针 P1–P10 落盘（本文件）；Stage 4 各任务开工时逐项复核，全部结论在交付台账对账。
- [ ] 1.2 F1–F7 全部子项、指引 §3.2 的 5 个未登记运行时成员、指引 §6 的低优先观察项逐项在 `design.md` §2 处置表有编号 / 实际公共 path / 证据锚点 / 当前实际形状 / 目标形状 / 处置结论 / 依据；本批开工复核锚点（P4 已抽样，Stage 4 逐条）。（Req 1.1–1.2）
- [ ] 1.3 核对指引基线 `cbbc29b` 之后的提交：`ecdb920`、`8cc1a25` 均为 docs 变更（P1），无已实施修复需要复用；若执行中发现遗漏，停止并回改去向表。（Req 1.5）
- [ ] 1.4 `design.md` §2.8 的「纳入 / 不纳入（附理由）」在交付台账逐项复核；纳入项（`coordination` 同义入参、`sessions.activity` / `executions` / `tasks` 入参形态、官方动词透传判定规则）分别由 Task 3、Task 4 与分册 S18（Task 2）承载。（Req 1.1）
- [ ] 1.5 若复核发现指引结论与源码不一致，以源码事实为准更新去向表并在台账标注差异（design §2.9 已订正三类，执行中如再发现同规则处理）；不得照抄指引。（Req 1.3）

## Task 2: 分册修订落盘（S16–S26，对应 Req 9.1/9.2）

**纪律**：design §3 明文「修订未落盘前，实现不得先落新形状」。本 Task 在 Task 3–9 之前完成；每条同时标注 registry 影响点（留 Task 10 落盘）。

- [ ] 2.1 S16 `api-idioms.md` §3.1 观察入口合同：subject 规范形态 options 对象 + 裸主题便捷；禁止 listener 参数；同一命名空间同义入参一致；`current()` 允许 async 并写明 `await` 统一写法；非函数 listener 不抛穿；降级 handle 同形；非法输入 typed。
- [ ] 2.2 S17 `api-idioms.md` §3.1 事件面信封段：事件面 `observe` 两端同形（信封 + handle）；host 非 catalog 名 `untyped` 如实表达无类型透传；client 未知名 `unsupported` + 目录。
- [ ] 2.3 S18 `api-idioms.md` §1、§3.6：官方动词原样透传类判定规则（B2-4 四条）；该类成员逐条登记六项例外并在 `currentShape` 写明官方动词名。
- [ ] 2.4 S19 `api-idioms.md` §2、§3.6：封闭 `conflictRule` 词表 + 逐成员声明义务 + 官方裁决的登记方式 + 验证桩要求（桩必须与官方行为一致）。
- [ ] 2.5 S20 `api-idioms.md` §3.1：绑定 / 访问器型成员的登记义务（对象成员集、读写面、lifecycle 与释放边界，含「为何无 `dispose()`」或「`dispose()` 释放的是什么」）。
- [ ] 2.6 S21 `api-idioms.md` §2、§3.7：availability 聚合规则（B5-1）+ 字段语义分离（B5-2）+ 归一表补 `available → active`、未映射 token 必须 `degraded` + `reason` + 降级指明部分 + 禁用形态同形。
- [ ] 2.7 S22 `public-api-shape.md` §4、§5：同 path 同形四条规则（B3）+ capability 解析规则（B4：成员级 path、最近簇、`get` 未知不抛、`require` 抛、`list` 同形）+ 命名分工（client `remotes.*` = 远端事件通道的观察与载体派发；host `events.*` = 官方事件总线的投影与受生产权约束的派发）。
- [ ] 2.8 S23 `visibility-and-redaction.md` §3：公共读面必须按调用者范围过滤；绕过调用者范围的聚合内部缝不得占用公共成员名（经符号键 / 非枚举通道且不登记为公共成员）。
- [ ] 2.9 S25 `docs/standards/README.md`：索引与各册适用范围随本轮修订同步。
- [ ] 2.10 S26 `domain-composition.md` §2：`settings` 行补 namespace 绑定的释放边界；`tasks` / `coordination` / `security` 行补 availability 口径（与 S21 一致，不复制 registry）。
- [ ] 2.11 修订落盘后复核「每个成员只有一条规则来源」，并核对 Task 3–9 的实现无分册外新形状；S24（树图刷新）与 Task 10.7 是**同一件工作，只做一次**（在 Task 10 按 registry 现状刷新）。
- [ ] 2.12 任一条实际触及 `capability-strategy.md` 的能力上限或新增公共能力时，停下并请求人类裁决（Req 9.2）；未触及则记录「均无需人类确认」的复核结论。

## Task 3: 观察面单一外层合同（B1 / F1，对应 Req 2、Req 4.2 的 handle 部分、Req 8.4）

- [ ] 3.1 内核复核：`lib/contract-kernel.js` 的 `createObserverHandle` 已支持 async `current`、判别式 `dispose()`、释放后 no-op、非函数 listener 宽容语义、内部记录不外泄；缺口就地补齐并以单测覆盖（不改内核已有的对外语义）。
- [ ] 3.2 host `attention.observe`：`dispose()` 改判别式（活面分支与禁用分支两条都收口）；非函数 listener 不抛穿。
- [ ] 3.3 `prompts.provenance.observe`：零参 `observe()` → 标准 handle；`current()` = 最近一次已投递的冻结通知帧（未投递 → 冻结降级视图）；`{ ok, disposer }` 信封退役（path 不变、形态变更）；补 handle 行（Task 10）。
- [ ] 3.4 `coordination.observe`：入参收敛 `{ resource, ...options }`（保留裸资源便捷形态、与 `acquire({ resource })` 同义）；handle 改内核铸造（保留 `resource` 扩展）；`dispose()` 判别式；释放后 `subscribe` no-op；`current()` async 按声明。
- [ ] 3.5 `workspaces.transactions.observe`：入参对象形态 `{ transactionId }`（保留裸 id 便捷）；内核 handle + `transactionId` / `initialState` 扩展；`dispose()` 判别式；释放后 no-op；async 声明；补 handle 行（Task 10）。
- [ ] 3.6 `sessions.durable.observe`：三参 `(targetSession, kind, listener)` → `observe({ targetSession, kind })` 返回标准 handle（`current()` = 最近一条已投递 durable 记录 / 降级视图）；旧三参形态退役；登记同步（Task 10）。
- [ ] 3.7 `sessions.activity.observe`：非法输入（缺 `sessionId` / 非法 scope）改 typed 结果或带 `code` 的 typed error，不抛裸 `TypeError`。
- [ ] 3.8 `sessions.channels.observe`：零参 `observe()`（listener 一律经 `handle.subscribe`）。
- [ ] 3.9 `diagnostics.observe`：单参 `observe(options)`（原两参形态的 listener 退役）；scope 词表 typed 抛错保持。
- [ ] 3.10 `mcp.observe`（R 包）：零参（不再接受 listener 直参）；本地复刻 handle 保留（不 import host 内核）；替代行契约复刻与 boot 自检复核。
- [ ] 3.11 `llm.routing.observe`：`observe({ session })`（保留裸 session 便捷）直接返回标准 handle，不再接受 listener 直参；`forExecution` 语义、成员名与参数保持。
- [ ] 3.12 `tasks.observe`：补 `{ taskId }` 对象形态（保留裸 id）；`callShape: async` 与声明一致；handle 扩展（`taskId` / `initialState`）保留。
- [ ] 3.13 `sessions.planMode.observe` / `sessions.permissionPresets.observe`：补 `{ agent }` 对象形态（保留裸 agent）；其余保持（形状基准）。
- [ ] 3.14 `executions.observe`：登记订正（`observe(options)` 事实）与声明复核，不改实现。
- [ ] 3.15 全部成员的 disabled / 降级形态同形：同形降级 handle（合同齐备、`current()` 降级、`subscribe` no-op、`dispose()` 判别式）；命名空间未挂载抛既有 typed error；**任何观察入口不抛裸 `TypeError`**。
- [ ] 3.16 观察矩阵测试（host）：逐成员断言 handle 成员集、`dispose()` 结果形状、释放后 `subscribe` / `current()` 行为、非法输入 typed 呈现；含失败面（释放后订阅不抛、非函数 listener 不抛）；`events.observe` 的 catalog / 非 catalog 两态信封 + handle 一并纳入（其入参与形态收口见 5.1）。
- [ ] 3.17 既有测试更新：P9 清单中 host 侧测试按新合同改写（`test/observation-surface.test.mjs` 的 `llm.routing.observe(session, listener)` 形态必须改为 `observe({ session })` + `handle.subscribe(...)`）。
- [ ] 3.18 登记清单（交 Task 10）：各观察行 `currentShape` 写明 subject 形态（含 `events.observe` 两端行的 `{ name, ... }` 形态）、`callShape` 声明 `current()` 形态；补齐 `prompts.provenance.observe.handle` 与 `workspaces.transactions.observe.handle`；订正反向行。

## Task 4: 登记面单一外层合同与冲突口径（B2 / F2，对应 Req 3）

- [ ] 4.1 `settings.register` handle 化：标准 handle `{ id(=ns), ownerId(派生), generation, dispose() }` + 扩展成员 `{ get, watch, update, replace, mutate }`（冻结）；`settings.scope(ns)` 取回**同一** handle（互指登记）；`dispose()` 释放门面绑定，并在 `reason` 如实披露「官方注册随门面与 settings 服务存续（调用方卸载不移除），无按 handle 的显式释放路径」；不虚假 `revoked`、不以「无 handle」回避。
- [ ] 4.2 `settings.register` 冲突口径：同 ns 重复注册由**官方权威裁决**（门面只做 typed 映射，不得声明 `latest-wins`）；跨 owner 同 ns 由门面先判 typed `owner-conflict`；`currentShape` 写明「官方裁决」；验证桩与官方行为一致（重复注册抛错）。
- [ ] 4.3 `tools.executionMode.get(exec)`：新成员（projection / pure / sync）；旧名 `tools.executionMode.register` 退役（removed + mapping 交 Task 10）。
- [ ] 4.4 `agents.register`：保留例外；按 B2-4 判定规则核对 `currentShape` 与例外措辞（写明官方动词名，与门面自有 handle 分界清晰）。
- [ ] 4.5 全部注册行逐行核对 `conflictRule` 与实现一致（含 `tools.register` 全局 / scoped、`diagnostics.register`、`tools.guard` / `presentation`、`llm.*`、`security.*`、`prompts.provenance.policy.register`、`attachments.pipeline.transforms.register` 等）；官方裁决行不得声明 `latest-wins`；跨 owner 同 key 不得静默覆盖；不符者就地收口或订正声明（Task 10 落盘）。
- [ ] 4.6 冲突矩阵测试：两个 synthetic owner 覆盖词表各值，断言 stale disposer 不能撤销新资源、跨 owner 拒绝、同 owner `latest-wins` 使旧 handle 返回 typed `stale`。
- [ ] 4.7 注册族枚举测试：逐成员断言成功返回形状（标准 handle / 已登记官方透传例外）；`settings.register` 的 handle + 扩展成员断言。
- [ ] 4.8 既有测试更新（`test/settings.test.mjs`、`test/index-settings.test.mjs`、`test/registry.test.mjs` 等）。
- [ ] 4.9 登记清单（交 Task 10）：`settings.register` / `settings.scope` 行（`failureSemantics`、`lifecycle`、`currentShape`、互指）、`tools.executionMode.*` 组行、`agents.register` 措辞、冲突口径行。

## Task 5: host/client 同 path 同形（B3 / F3，对应 Req 4）

- [ ] 5.1 `events.observe`（host）入参收敛 + 信封化：入参改为单一 subject——`observe({ name, scope?, ... })` 对象形态（原 `opts` 语义并入 subject），保留裸事件名便捷形态且两形态语义一致；返回 catalog 名 `{ ok:true, code:'observed', handle }`，非 catalog 名 `{ ok:true, code:'untyped', handle, reason }`（如实表达既有无类型透传通道，不关闭）；非函数 listener 收口为 no-op（不再 typed 抛错）；`events.define` 的 publisher 语义不变。（Req 2.4、Req 4.2）
- [ ] 5.2 `events.observe`（client）：接受与 host 同一 subject 形态（`{ name }` 对象形态 + 裸事件名便捷），保持 `{ ok:true, code:'observed', handle }` / 未知名 `{ ok:false, code:'unsupported', names }`；登记订正（Task 10）。
- [ ] 5.3 `settings.scope`（host）：接受 `{ namespace, ... }` 对象形态（保留 ns 字符串便捷形态）；返回同一 handle（与 4.1 互指）。
- [ ] 5.4 `settings.scope`（client）：接受 `{ namespace, ... }` 对象形态；在官方 scope 外包别名层（`get → getSnapshot`、`watch → subscribe`），官方成员（`getSnapshot` / `subscribe` / `set` / `unset`）作为扩展成员保留；视图冻结；写面与释放面差异登记。
- [ ] 5.5 两端同段调用代码测试：`scope({ namespace }) → get → watch → 退订` 在 host / client 各自挂载下逐字复用同一段代码体。
- [ ] 5.6 登记清单（交 Task 10）：`events.observe` 两端行（`currentShape` 写明 `{ name, ... }` subject 形态；host 行 catalog / untyped 两态、client 行 observed / unsupported 两态）、`settings.scope` 两端行（含 client 别名层成员与 host 对象形态登记）。
- [ ] 5.7 既有测试更新与新增：host `test/events-observe-production.test.mjs` 与 client `test/client-official-events.test.mjs` 覆盖 catalog / 非 catalog（host）/ 未知名（client）三态的冻结信封 + handle 形状断言（含失败面）；`test/client-settings-scope.test.mjs`、`test/events-bus-settings-gating.test.mjs`、`test/client-observation-handles.test.mjs` 等同批更新。

## Task 6: capability 预检可迁移（B4 / F4，对应 Req 5）

- [ ] 6.1 host `capabilities.get`：接受该端活面上可解析的公共成员 path（逐段解析、任意深度），解析到**最近能力簇**（已登记能力路径的最长前缀；无前缀时用命名空间自身声明路径；再无可解析声明 ⇒ 按未知处理）；无法解析 ⇒ 冻结 `{ capability, status:'unavailable', reason:'unknown capability' }`（不抛）；`require` 保持 `PluginApiCapabilityUnavailableError` typed throw（未知与不可用一律计入 missing）。
- [ ] 6.2 client 同规则：成员 path 逐段解析活面（现仅单层需扩展）；最近簇状态；未知 path 不抛同形结果；`require` 保持 typed throw；两端规则同源（S22 分册）。
- [ ] 6.3 `list({ prefix })` 两端同形复核（冻结路径列表 + 前缀过滤；内容粒度差异继续登记）。
- [ ] 6.4 测试：两端 `get` 对「能力路径 / 成员级 path / 未知 path」三态断言（client `caps.get('slots.contribute')`；host `caps.get('workspaces.transactions.observe')`、`caps.get('llm.routing')`）；「不存在的成员不继承根状态」反例；`require` typed throw。
- [ ] 6.5 既有测试更新（既有「未知 path 抛错」断言按 §9-5 默认决策改写为返回 `unavailable` + reason）。
- [ ] 6.6 登记清单（交 Task 10）：capability 相关三行 `currentShape` / `callShape` 补解析规则与未知语义。

## Task 7: availability 聚合与诚实（B5 / F6，对应 Req 7）

- [ ] 7.1 `lib/namespace-availability.js` 归一重写：映射表补 `available → active`；未映射 token 一律以 `degraded` + `reason`（含原 token）呈现，**禁止静默回落**；领域 detail 保留；禁用形态与非禁用形态同一 detail 字段集（含 `epoch`）。
- [ ] 7.2 `tasks.availability`：`available → active` 归一；`sources` 参与聚合（任一在册来源不可用 ⇒ `degraded` + `reason`）；detail（`scope` / `durability` / `operations` / `sources` / `backend` / `epoch`）保留。
- [ ] 7.3 `coordination.availability`：跨 scope `unavailable` + `reason` 语义不变；`operations` / `durability` / `backend` 定位为后端能力声明（不参与 `status` 聚合）；口径写入分册与登记。
- [ ] 7.4 `security.availability`：`faces` 口径与聚合规则一致（局部缺失 ⇒ `degraded`；全 inert ⇒ `unavailable`）；补登记口径与 `reason` 完整性。
- [ ] 7.5 `storage.availability`：禁用形态补 `epoch`（与非禁用形态同字段集）。
- [ ] 7.6 `workspaces.transactions.availability`：改走通用归一（`available → active`）并保留 `scope` / `durability` / `operations` / `backend` / `epoch`。
- [ ] 7.7 `workspaces.availability`：二值口径与聚合规则一致（单一在册部分 ⇒ 二值合法），登记写明。
- [ ] 7.8 测试：四域（`tasks` / `coordination` / `security` / `workspaces.transactions`）`status` + detail 逐条断言；`storage` 禁用形态字段集（含 `epoch`）；归一表正反例（含未映射 token → `degraded` + `reason`）。
- [ ] 7.9 登记清单（交 Task 10）：`availabilityShape` / 各 namespace 记录与实现一致。

## Task 8: 登记完整性与可见性（B6 / F5，对应 Req 6）

- [ ] 8.1 四个 `*.availability`（`events.decisions` / `tools.executionPolicies` / `agents.decisions` / `prompts.assemblyPolicies`）：`degraded` 时补 `reason`；leaf 行与所属子命名空间记录交 Task 10 补齐。
- [ ] 8.2 `attention.hubSnapshot` 内部化：`lib/index.js:2547-2560` 公共成员移除；改经内部通道（`Symbol.for('dsh-plugin-api.attention.snapshot-seed')` 或等价非枚举成员）发布；kind 裁剪与脱敏（fail-closed）语义不变。
- [ ] 8.3 `packages/api-remotes/lib/apply.js` 的 snapshot resolver 改经内部缝（R 包，门面内唯一消费方）；替代行契约复刻、boot 自检、组件 owner 唯一复核（Req 12.2）。
- [ ] 8.4 测试：公共面成员集断言（`hubSnapshot` 不在）+ 内部缝端到端用例（保留 kind 裁剪断言与「非消费方不可达」断言）。
- [ ] 8.5 登记清单（交 Task 10）：`removed` 行 + `oldToTargetMapping`（内部化目标或 gap 说明）；交付报告单列「公共面变化」。

## Task 9: client 降级路径与命名（B7 / F7，对应 Req 8）

- [ ] 9.1 client `attention.observe()` 降级路径：与安装态**同形** handle（内核 `createObserverHandle` 或同形实现：`dispose()` 判别式、`subscribe` 返回 no-op 退订函数、`current()` 冻结降级视图）；`contribute` / `dismiss` / `invoke` 降级判别式保持。
- [ ] 9.2 client `slots` 收敛：`slots.inspect(key)` 为唯一槽位读面（三态 `declared` / `missing` / `unavailable` + `spec` / `snapshot` / `declarationEpoch` / `entries`）；`slots.list` 与 `slots.declaration` 退役（removed + mapping 交 Task 10，不得自环）；`slots.contribute` / `observe` / `availability` 不变。
- [ ] 9.3 client 观察入口全条款复核（Req 2 条款逐条适用）：`attention.observe` / `events.observe` / `slots.observe` / `remotes.observe` 与 `lifecycle` 观察面；与 host 同 path 者按 Task 5 收敛；产出 **client 观察矩阵测试**（与 Task 3.16 同口径）。
- [ ] 9.4 `lib/client.js` 重建：`npm run build:client` 后核对产物 diff 仅含预期变更，`npm run build:client:check` 一致；不得手编 bundle。
- [ ] 9.5 既有 client 测试更新（`test/client-observation-handles.test.mjs`、`test/client-slots.test.mjs`、`test/client-attention-face.test.mjs`、`test/client-capability-availability.test.mjs` 等）。
- [ ] 9.6 登记清单（交 Task 10）：client 行同步（`slots.inspect` 新行、两旧名 removed、`attention.observe` 降级形态声明、client 三处缺失 handle 行的登记现状复核）。

## Task 10: registry 落盘、机械校验扩展与镜像同步（对应 Req 9.4–9.6、Req 10.1）

- [ ] 10.1 registry 形状同步：Task 3–9 的「登记清单」逐条落盘（`idiom` / `failureSemantics` / `identitySource` / `conflictRule` / `lifecycle` / handle 行 / `currentShape` / `callShape` / `availabilityShape`），registry 保持唯一事实源；`currentShape` 已与实现相反的旧行一并订正。
- [ ] 10.2 减法登记：`tools.executionMode.register` → `get`、`slots.list` / `slots.declaration` → `inspect`、`attention.hubSnapshot` 内部化——各落 `removed` 行 + `oldToTargetMapping` + `statusByPath`，**映射不得自环**；能力守恒。
- [ ] 10.3 新增 / 补齐行：四个 `*.availability` leaf 行 + 所属子命名空间记录；`prompts.provenance.observe.handle`、`workspaces.transactions.observe.handle`。
- [ ] 10.4 反向行订正（design §2.9-3 等实测）：`attention.observe.handle`、`tools.executionMode.*`、`settings.scope`（`failureSemantics` → `typed-throw`）、`coordination.observe` / `sessions.durable.observe` 的 handle 行；`sessions.observe.handle` 行按实现事实复核（标准 handle ⇒ 订正 `currentShape`；非标准且不在本批成员面 ⇒ 记录排除理由，与 §2.9-4 同口径）。
- [ ] 10.5 `scripts/registry-validate.mjs` 扩展（Req 10.1）：① `.observe` 叶行必须 `projection`，覆盖范围内的 handle 行必须登记四成员；② 注册类行必须为标准 handle 或登记完备的官方透传例外；③ 每个 namespace / 子命名空间的 `availability` 成员在册；④ `conflictRule` 取值在封闭词表内且官方裁决行不得声明 `latest-wins`；⑤ `*.observe` 的 subject 形态记入 `currentShape`、`current()` 形态由 `callShape` 声明。断言范围须显式表达（不得反射式全树运行时引擎）。
- [ ] 10.6 M10 三表：成员表由 `scripts/convergence-table-sync.mjs` 机械重建并逐字对账；行为表保持 37 行冻结口径与全链；装配表 token 可解析；`node scripts/convergence-verify.mjs` 全绿。不得为通过校验改 `EXPECTED_BEHAVIOR_ROWS`。
- [ ] 10.7 S24 树图刷新：`docs/standards/public-api-shape.md` host / client 树图按 registry 现状逐名刷新（含删除已 `removed` 的名字）。
- [ ] 10.8 `node scripts/capability-matrix-sync.mjs --check` 通过。

## Task 11: 组合验收、跑测与边界审计（对应 Req 10.2–10.4、Req 11、Req 12）

- [ ] 11.1 运行时 ↔ registry 对账测试：在挂载的 host 与 client 门面上枚举公共叶（跳过 `_` 前缀与 `services.*`）并断言每个成员有 registry 行；交付报告记录本批前后的缺口清单（目标：非 `services.*` 缺口为零）。
- [ ] 11.2 F1–F7 全部子项、5 个未登记成员与 §2.8 纳入项逐项「可复跑证据」矩阵（含失败面），证据来自真实公共入口执行；不得以台账自洽、import 扫描、路径计数或测试总数充当。
- [ ] 11.3 全量跑测：`npm test`（4G 护栏内）全绿且总数不低于 P1 基线 3577（新增测试为净增）；`node scripts/registry-validate.mjs <registry>`、`node scripts/convergence-verify.mjs`、`node scripts/capability-matrix-sync.mjs --check`、`npm run build:client:check`、`git diff --check` 全部通过。
- [ ] 11.4 边界审计：版本冻结未步进；官方包文件零修改；`servicesWhitelist` 键集合与基线一致（54）；未新增 R 点；治理 token 不出现在 `lib/`、`packages/`、`test/`、`package.json`；两处 R 包修订的替代行契约复刻 / boot 自检 / owner 唯一复核通过。
- [ ] 11.5 例外净额三口径核算（执行后实测）：不高于 batch-1 收口实测（成员行 17 / 例外记录 19 / 公共 path 16）；新增例外（若有）附完整六项与 `verification`。
- [ ] 11.6 真实差异保留复核（Req 12.3、design §4 保留清单）：逐条复核 `services.*` 存在性口径（`isActive`）、coordination `release(handle)`、workflow run authority、checkpoint 恢复阶段、领域 detail 字段、official seam 原样透传、`agents.register` 官方动词透传、同步 / 异步差异本身未被机械抹平；结论落台账。

## Task 12: 交付台账与治理同步（对应 Req 1、Req 11.4、Req 12.5）

- [ ] 12.1 `docs/specs/plugin-api-m11-contract-enforcement/batch-2/delivery-ledger.md`：逐项记录 (a) F1–F7 全部子项与 5 个未登记成员的最终去向（修复 / 保留例外 / 需人类复核 / 误报 + 证据锚点 + 落地提交）；(b) 实际 API 变化清单（含公共面减法与 `capabilities.get` 行为变更单列）；(c) §2.8 观察项去向与 Req 12.3 保留差异（含 design §4 保留清单）的逐条复核结论；(d) 例外净额三口径；(e) 计数型结论的计量单位与取样口径；(f) spec 就地修订记录。
- [ ] 12.2 `docs/specs/plugin-api-features/feature-list.md` §7 与受影响的 `README.md` 表述同步；历史制品若有旧 path 受影响，以文首「公共契约现状注」追加映射，**不改写**已获批验收边界。
- [ ] 12.3 阻塞项登记：未达成的必需行为逐条登记（原因 + 最小解除动作 + 是否需人类授权 + 日期），不以降级呈现充当完成；无阻塞项时显式记录「无」。
- [ ] 12.4 全局终审：对整个 Stage 4 交付调用**一次**阻塞式只读对抗性审查（`run_in_background: false`），只核对交付物与 Tasks / Design / Requirements 的一致性、并按 `docs/standards/` 适用分册比对规范符合性，不向上溯源；返回「无偏差」后进入 12.5；有意见则在整个交付范围内集中修订后再次派发（只审整体、不退回逐任务审查）。
- [ ] 12.5 阶段收口与完成提交：确认工作区无 `temp/` 依赖、无临时脚本残留、无未提交成果；按 AGENTS §3.2「Stage 4 完成提交」提交实现、测试、规格与必要登记。

---

## 需求覆盖对照（Req → Task）

| 需求 | 承载 Task |
|---|---|
| Req 1 输入固化与逐项去向 | 1.1–1.5、12.1 |
| Req 2 观察面单一外层合同（含 Req 2.10 的 15 个成员） | 3.1–3.18、5.1–5.2、9.3、9.6 |
| Req 3 登记面单一外层合同与冲突口径 | 4.1–4.9 |
| Req 4 host/client 同 path 同形 | 5.1–5.7、3.17（`events.observe` 的 handle 部分） |
| Req 5 capability 预检可迁移 | 6.1–6.6 |
| Req 6 登记完整性与可见性 | 8.1–8.5 |
| Req 7 availability 聚合与诚实 | 7.1–7.9 |
| Req 8 client 降级路径与命名 | 9.1–9.6 |
| Req 9 分册修订与治理同步 | 2.1–2.12、10.1–10.8、11.5、12.2 |
| Req 10 机械校验与对账 | 3.16、4.6、9.3、10.5、11.1 |
| Req 11 验收与证据 | 9.4、11.1–11.3、12.1、12.4 |
| Req 12 边界与不回归 | 11.4、11.5、11.6、12.3、12.5 |

## 指引条目与分册修订去向（F1–F7 / 5 未登记成员 / S16–S26 → Task）

| 条目 | 处置承载 |
|---|---|
| F1 观察面（Req 2） | Task 2.1–2.2、Task 3 全部、Task 5.1–5.2（`events.observe` 入参 + 形态）、Task 9.1/9.3 |
| F2 登记面（Req 3） | Task 2.3–2.5、Task 4 全部 |
| F3 host/client 同 path（Req 4） | Task 2.7、Task 5 全部 |
| F4 capability 预检（Req 5） | Task 2.7、Task 6 全部 |
| F5 5 个未登记成员 + `attention.hubSnapshot`（Req 6） | Task 2.8、Task 8 全部、Task 10.3 |
| F6 availability（Req 7） | Task 2.6、Task 7 全部 |
| F7 client 降级与命名（Req 8） | Task 2.7、Task 9 全部 |
| 指引 §6 观察项 | Task 1.4（去向复核）；纳入项由 Task 3.4 / 3.7 / 3.12 / 3.14、Task 4.4、Task 2.3 承载 |
| S16–S23、S25、S26 | Task 2.1–2.10 |
| S24 树图 | Task 10.7 |

## Stage 3 审查门记录

本文经**两轮**阻塞式只读对抗性审查（`run_in_background: false`，只读子 agent，无写权限、无子派发）收敛。各轮结果与闭合方式：

| 轮次 | 结论 | 实质意见与闭合方式 |
|---|---|---|
| 1 | 有偏差（1 阻塞 + 4 低度） | ① 【阻塞】Task 5 缺 `events.observe` 的单一 subject 入参收敛落点 → 5.1 增补 `observe({ name, scope?, ... })` 对象形态 + 裸事件名便捷（两形态语义一致）、5.2 增补 client 同形形态、3.16 纳入两态信封 + handle、3.18 与 5.6 增补 `currentShape` 义务、映射表 F1 行与 Req 2 行补 5.1–5.2；② 【低】§6 观察项行编号改为 3.4 / 3.7 / 3.12 / 3.14、Req 9 行补 11.5、Req 11 行补 9.4；③ 【低】5.7 明列事件面三态测试文件与断言；④ 【低】新增 11.6（Req 12.3 保留差异逐条复核）并同步 Req 12 行与 12.1(c)；⑤ 【低】提交引用统一为 `ecdb920`。 |
| 2 | 有偏差（0 阻塞 / 0 中度 / 1 低度） | 5.6 的「catalog / untyped 两态」措辞会误导 client 行登记 → 按端改写为「host 行 catalog / untyped 两态、client 行 observed / unsupported 两态」；该修正属单点文字修正，按 AGENTS §3.2「仅小修改无需再对抗性审查」口径就地闭合。 |

**门结论**：第 2 轮确认 5 条意见全部闭合、修订未引入新的阻塞 / 中度不一致；唯一低度项为单点文字修正，已就地闭合。审查门通过，先提交本文（Stage 3 阶段提交），随后进入 Stage 4。

## 阶段边界

本 Task 清单只规划 Stage 4 的执行顺序与验收义务，不批准任何超出 `goal.md` / `requirements.md` / `design.md` 的范围，不改变 batch-1 已获批的验收边界表述。Tasks 经阻塞对抗性审查通过后**先提交 tasks.md**，随后直接进入 Stage 4 自主执行；执行中的 spec 错误按 AGENTS §3.2「Stage 4 通用规则」就地修订并登记，触及硬停机点（版本与发布、milestone 范围）时暂停并请求人类裁决。
