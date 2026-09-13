# Stage 3 - Tasks

> feature_name: `compaction-operation`
> milestone: M10
> status: Tasks 已产出并通过 Stage 3 对抗性审查门（第二轮「有意见」仅剩 1 条纯标注错误、按 AGENTS §3.2 小修改规则就地闭合，进入 Stage 4）。第一轮 8 条（1 阻塞 / 2 高 / 3 中 / 2 低）全部修订，处置见文末。
> 输入溯源：`goal.md`（2026-09-11 获批）；`requirements.md`（R1–R8 与实现通道总判定）；`design.md`（§1–§8：触发语义取舍、R 类扩展点位、结果码表、决策衔接、取消并发、装配顺序、绑定汇总、Testing Strategy、standards 逐分册）；Stage 3 源码级探针记录见下。
> 执行口径：Stage 3 以对抗性审查为门（AGENTS.md §3.2），通过后直接进入 Stage 4；版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。**本线是本里程碑唯一的 R 类扩展**（在既有 replacement owner `packages/compaction-events` 内扩展，组件唯一 owner 不变），R1–R8 硬约束全程适用。

## Stage 3 探针记录（源码级事实，Stage 4 以行为测试复核）

- **P1 forked engine 的公开触发面**（`packages/compaction-events/lib/forked-engine.js`，1151 行，vendored fork of `dsh-compaction-basic@0.1.0-rc.6`）：
  - `compactNow(agent, signal, sourceCommandId)`（1120–1140）：**非 async**（返回 maintenance job 的 promise）；`signal.throwIfAborted()` → `agent.runMaintenance(async (agentSignal) => …)`（idle bracket）→ `selectCompactableRange(session, meter.measure(session), 0)` → `null` 即无候选 → `compactRegionInternal(..., COMPACTION_TRIGGERS.manual, operationSignal, sourceCommandId)` → `COMPACTION_REJECTED` 折叠为 `null`。**错误路径（Stage 3 审查修正）**：外层 `try/catch` 只能捕获**同步**抛出——`runMaintenance` 仅在 agent 非 idle 时同步抛裸 `Error('agent ... already has active work')`（`dsh-agent-loop` lib/index.js:412-413），外层 catch 把它包成 `ManualCompactionError('busy', …)`；maintenance job 内的**异步失败以原类型 reject**（内层 catch 重抛的 `ManualCompactionError('cancelled')`、`throwManualFailure` 的 summary/commit/changed），不经外层包装——即「取消以 cancelled 原样抛出、只有非 idle 走 busy 包装」。
  - `compactRegion(start, end, agent, signal)`（1108–1111）：`compactRegionInternal(..., COMPACTION_TRIGGERS.direct, signal)` → 否决折叠为 `null`。
  - `compactIfNeeded(agent, trigger, signal)`（1026–1083）：pressure / context-overflow 自动路径（含 `compactionRetries` 重试环与 toolResultPruner 联动）——**公共面不承载**（design §3.3 的 provenance 论证）。
  - `compactRegionInternal(start, end, agent, trigger, signal, sourceCommandId)`（1091–1107）：**fork 已存在的单一内部路由点**——`manual` 走 idle bracket（`owner: null`、`stability: 'selected-span'`、`flush: () => ctx.sessions.flush(session)`），其余 trigger 走 current-turn bracket（`owner: 'current-turn'`、`stability: 'whole-surface'`）。
- **P2 否决坍缩点与原因可得性**：`compactSurfaceRegion`（forked-engine.js:512 起）在 durable marker **之前**派发 `compaction/request` waterfall；`decision.kind === DECISION.reject` 时构造 `skippedPayload`（含 `reason: decision.reason ?? 'rejected'`）→ `emitSafe(ctx, 'compaction/skipped', …)` → `return COMPACTION_REJECTED`（547–550）。**决策 reason 在否决派发点就在作用域内**，只是被裸 `Symbol` 哨兵吞掉（`COMPACTION_REJECTED = Symbol("dsh-plugin-api.compaction-events.rejected")`，:437）。选择器 `null`（no-candidate）发生在否决**之前**（`compactNow` 的 range 选择处），内部天然可区分。
- **P3 fork 内可见的错误类型**：`ManualCompactionError`（官方 `@deepseek-ai/dsh-compaction`，码值见 653–663 与 1138：`busy` / `cancelled` / `persistence` / `commit` / `changed` / `summary`）；fork 本地 `SurfaceChangedError`（:384）；`assertCompactionInactive` 抛 `ManualCompactionError('busy', …)`（:674）。**range 校验错误与 "no open turn" 目前是裸 `Error` + message**（:522、690–694）——design §3.4 要求 fork 内补 typed 分类（不得依赖 message 匹配）。
- **P4 替代行装配与自检**（`packages/compaction-events/lib/apply.js`，233 行）：`isForkedProvider(service)` 探 `COMPACTION_EVENTS_ACTIVE_SYMBOL`（`Symbol.for("dsh-plugin-api.compaction-events.contract")`，forked-engine.js:443）；`providerCallable(service)` 探四个方法 + symbol；apply 内 `verify = providerCallable(ctx.get('compaction'))`（183–189）——**post-register verification 的扩展点**（R4：增加 operation 子面 marker 断言）。冲突/幂等：最早注册的 provider 拥有 `ctx.compaction`，后来者 inert。
- **P5 主包侧门控与投影先例**：`sessions.branches` 经 `_assignFeature('sessionBranch')` 槽位发布（`this._sessionBranchSlot` / `_sessionBranchSurface` / `createDisabledSessionBranchApi`，`lib/plugin-api-service.js:1691-1692`、`3039-3046`），mounter 在 `lib/index.js` 内解析替代行 marker 后 `prepareFeature`；`sessions` 根 getter（method 风格）经 `composeSessionApi(base, durable, branches, channels, interaction, activity, availabilityOf)` 合成子面（:2000 附近）。**本 feature 的 `sessions.compaction` 采用同一形态**：槽位 + disabled 面 + `availability` 层叠 + 按 marker/版本门控的懒解析。
- **P6 结果与 idiom 例外**：design §3.5 的冻结结果 `{ ok, code, terminal, outcome?, reason?, stage?, lineage? }`；`lineage` 逐字段来自引擎 `CompactionResult`（compactionId / shadowedRange / shadowedSeqs / shadowedTokenCount / startSeq / summarySeq / endSeq / sourceCommandId?）。**外层合同偏差**：省略 operation idiom 的固定成员 `operation`（不铸造门面 operation 身份，`compactionId` 是引擎铸造的资源身份），按 `api-idioms.md` §1 例外六元组登记（memberPath `sessions.compaction.run`）。
- **P7 登记面现状**：registry `eventCatalog` 已含 `compaction/request`（decision/waterfall）与 `compaction/started|completed|failed|skipped`（fact，producer authority = compaction replacement authority）——**本 feature 零新增事件**；`services.compaction` 整键已在 M7 删除（B4-7），白名单**不回流**；`packages/compaction-events/cordis.patch.yml` 现状 = 禁用官方 `compaction-basic` 行 + 插入替代行，**本 feature 不新增 patch 行**。registry 拟新增两条：`sessions.compaction.run`（idiom **operation**、effect **execute**、composition **coordinated**、conflictRule **not-applicable**、scope **session**、authority **compaction replacement authority**）与 `sessions.compaction.availability`（selfDescription/read/pure/**scope facade** + 域 authority）；`capability` 一律 `sessions.compaction`。
- **P8 接线形态与既有断言的同步点（Stage 3 审查修正：采用 feature key 路线）**：`sessions.compaction` 采用 **`sessionBranch` 同款机制**——新增 `FEATURE_MOUNTERS` 条目 `['sessionCompaction', mountSessionCompactionFeature]`（追加在 `credentials` 之后）+ `KNOWN_FEATURES` 增 `sessionCompaction` + `_assignFeature`/`_readSlot`/`_disabledSurfaceFor`/`unmountFeature` 槽位全套（`_sessionCompactionSlot`/`_sessionCompactionSurface`/`createDisabledSessionCompactionApi`）+ `composeSessionApi` 参数 + `_decoratedNamespaces` 名单。**理由**：所有槽位赋值点都在 mounter 内、feature 活动性经 `featureRegistry.mount` 与 `_resolveFeatureStatus` 表达（`attachments` 式无 key 的 provider 门控需要 `_resolveFeatureStatus` 特例，与 design §3.2「同 sessions.branches 模式」不一致）。因此 P8 的同步清单为：feature 总数 **40 → 41** 与尾部顺序断言——`test/index.test.mjs`（快照 + 总数 + 尾部）、`test/index-session.test.mjs`、`test/index-agent.test.mjs`、`test/index-session-durable.test.mjs`、`test/index-tools.test.mjs`、`test/index-events.test.mjs`、`test/index-system-prompt.test.mjs`、`test/index-profile.test.mjs`、`test/index-remote.test.mjs`、`test/index-diagnostics.test.mjs`、`test/official-passthrough-independence.test.mjs`（`BRANCH_ADDED_FEATURES`）、`test/security-policy-assembly.test.mjs`（尾部 pin 全量位移）、`test/host-cutover.test.mjs`（`capabilities.list({ prefix: 'sessions.' })`）、`test/registry*.test.mjs`（两条成员行 + `capabilityMatrix` + `namespaces` 记录的 availability 闭包）。**新增子命名空间 `sessions.compaction` 必须补 `namespaces` 导航记录**（否则 availability 叶子违反前缀闭包）。

## Task 1: 替代行内的 operation 子面（R 类扩展；对应 requirements R1、R2、R4；capability-strategy R1–R8 为硬约束）

**产出**：`packages/compaction-events/lib/operation-subface.js`（新文件）+ `packages/compaction-events/lib/forked-engine.js` 的 fork 内判别通道 + `packages/compaction-events/lib/apply.js` 的自检扩展 + 包级测试 `packages/compaction-events/test/operation-subface.test.mjs`。

- [ ] 1.1 fork 内判别通道（design §3.4）：把裸 `COMPACTION_REJECTED` 哨兵改为**携带 reason 的否决对象**（`{ [COMPACTION_REJECTED]: true, reason }` + `isCompactionRejected(value)` 判定），逐处更新 fork 内 5 个哨兵使用点（`compactSurfaceRegion` 内部的 return :550、`compactIfNeeded` :1047/:1072、`compactRegion` :1110、`compactNow` :1130）；**公开方法行为零改写**（仍折叠为 `null`），仅内部通道携带 reason。
- [ ] 1.2 fork 内 typed 错误分类（R4；不得依赖 message 匹配）：新增 `OpenTurnRequiredError`（替换 :522 的裸 Error，message 不变、仍 `instanceof Error`）与 `InvalidRangeError`（替换 :690–694 的 range 校验裸 Error）；`SurfaceChangedError` 与 `ManualCompactionError` 保持原样。**stage 恢复（Stage 3 审查修正）**：owner !== null（direct/range）路径的失败在 :636–638 以 `throw failure.error` 抛出、stage 在此丢失；fork 在该抛出点给 error **附加不可枚举的 `compactionStage` 属性**（`'summary'|'commit'`，additive、不改变错误类与 message），使子面能在 range 模式下同样产出带 stage 的 `summary-failed`/`commit-failed`。
- [ ] 1.3 operation 子面模块：导出 `OPERATION_SUBFACE_SYMBOL = Symbol.for('dsh-plugin-api.compaction-events.operation')` 与 `createOperationSubface(engine)` → `{ [OPERATION_SUBFACE_SYMBOL]: true, run(spec) }`；`run(spec)` 返回冻结判别式 outcome：
  - `mode: 'now'`：镜像 `compactNow` 的内部序列（`signal.throwIfAborted()` → `agent.runMaintenance` → `selectCompactableRange(..., 0)` → `compactRegionInternal(..., 'manual', operationSignal, sourceCommandId)`），但把三种内部结果**分别**映射为 `{kind:'skipped', reason:'no-candidate'}` / `{kind:'rejected', reason}` / `{kind:'compacted', result}`；**必须复刻外层转换语义**：`runMaintenance` 的同步非 idle 裸 Error（`already has active work`）在子面内以**类型/来源判定**（catch 该同步抛出点，而非 message 匹配）映射为 `{kind:'failed', code:'busy'}`，job 内异步失败按类型分类（P3）；
  - `mode: 'range'`：`compactRegionInternal(start, end, agent, 'direct', signal)` 同映射（无候选不适用于显式 range）；
  - 失败分类（P3 类型判定）：`ManualCompactionError` → `busy` / `aborted`(cancelled) / `summary-failed`(stage summary) / `commit-failed`(stage commit) / `persistence-failed`(stage commit) / `surface-changed`(changed)；`SurfaceChangedError` → `surface-changed`；`OpenTurnRequiredError` → `open-turn-required`；`InvalidRangeError` → `invalid-range`；AbortError / signal.aborted → `aborted`；其余 → `{kind:'failed', code:'internal'}`（**不抛穿**）；
  - 入参形状防御：非对象 spec / 非法 mode / range 缺字段或非整数 → `{kind:'failed', code:'invalid-arguments'}`（门面侧另有前置校验，此为子面自守）。
- [ ] 1.4 装配与自检（R4/R5/R6；design §3.9）：provider 实例上附加子面（`attachOperationSubface`，幂等、additive，不改既有四方法）；`apply.js` 的 `providerCallable` 与 post-register verification 增加 **operation 子面 marker 断言**；版本错配时子面不发布（R5 既有门控）；`ctx.compaction` 被其他 provider 占有时整体 inert（R6 既有冲突检测）。
- [ ] 1.5 测试（包级）：四方法逐一不变（additive 回归）/ 否决 reason 透出（策略 reject 带 reason → `{kind:'rejected', reason}`，且 `compaction/skipped` 事实恰好一条）/ no-candidate 与 rejected 可区分 / range 模式无 open turn → `open-turn-required`（typed，不靠 message）/ 非法 range → `invalid-range` / busy / surface-changed / summary/commit/persistence 失败分类 / abort（invoke 前与 summarization 中）/ marker 断言在自检中生效 / 版本错配与冲突 inert 下子面不发布。

## Task 2: 主包 `sessions.compaction` 门控投影（对应 requirements R1、R5、R9）

**产出**：`lib/sessions-compaction.js`（门控解析器 + 结果映射核心，纯函数可测）+ `lib/sessions-compaction-facade.js`（挂载）+ `lib/plugin-api-service.js` / `lib/index.js` 接线 + 测试。

- [ ] 2.1 门控解析器（design §3.2 四条件）：①辅助包 manifest 版本与主包契约匹配（`parseFacadeVersion` + `dsh.api`）；②loader 中替代行 active 且官方行 `compaction-basic` disabled/absent；③`ctx.get('compaction')` 携带 `COMPACTION_EVENTS_ACTIVE_SYMBOL`；④provider 携带 operation 子面 marker（**不 import 辅助包**，只用 `Symbol.for` 字面量）；任一不满足 → `availability()` 报 `unavailable` + reason，`run()` 抛 typed `PluginApiFeatureDisabledError('sessions.compaction', …)`；版本错配只 warn 一次（report-once 先例）；解析异常 fail-safe（只停用本面）。
- [ ] 2.2 命名空间发布（P5/P8 修正：feature key 路线）：新增 `FEATURE_MOUNTERS` 条目 `['sessionCompaction', mountSessionCompactionFeature]`（追加在 `credentials` 之后）与 `KNOWN_FEATURES` 键 `sessionCompaction`；槽位 `_sessionCompactionSlot` / `_sessionCompactionSurface` / `createDisabledSessionCompactionApi` / `_assignFeature` 分支 / `_readSlot` / `_disabledSurfaceFor` / `unmountFeature` 回退 / `composeSessionApi` 参数 / `_decoratedNamespaces` 名单 / `lib/guards.js` 分支（探替代行 marker 与官方行禁用状态）；mounter 懒解析门控（design §3.9：主包↔替代行解析顺序无关），门控不通过时 feature 仍挂载但成员一律 typed disabled（不抛穿 apply）。**namespace 始终存在**（disabled 面 `run()` 抛 typed `PluginApiFeatureDisabledError('sessions.compaction', …)`、`availability()` 返回 `{status:'unavailable', reason}` 且**永不抛错**，含 inert core——availability 是唯一在 inert core 下仍返回 typed 的成员）。
- [ ] 2.3 结果映射（design §3.5）：`mapCompactionOutcome(outcome)` 全表 → 冻结 `{ ok, code, terminal, outcome?, reason?, stage?, lineage? }`；`terminal` 取统一终态词（`success`/`error`/`aborted`/`denied`，本域无 `superseded`）；**`lineage` 恰为 design 声明的 8 个字段**（`compactionId` / `shadowedRange{start,end}` / `shadowedSeqs` / `shadowedTokenCount` / `startSeq` / `summarySeq` / `endSeq` / `sourceCommandId?`），深冻结、逐字段取值自引擎 `CompactionResult`；**明确剔除 summary 正文**（引擎结果含 `summary` 正文，公共 `compaction/completed` 事实亦经 `buildCompletionResult` 剔除；design §5.4「lineage 只含位置/计数元数据」与 `visibility-and-redaction.md` 输出边界为准）；**不铸造门面 operation 身份**（省略 `operation` 成员，见 Task 5 的 idiom 例外登记）。
- [ ] 2.4 入口校验（R1、R2；引擎调用前拒绝）：`options` 非对象 / `agent` 非 live agent 引用 / `mode` 非 `'now'|'range'` / `range` 缺失或形状非法（`start`/`end` 非整数、逆序）→ typed 结果（`invalid-arguments` / `invalid-target` / `invalid-range`）且**不触引擎、不铸 compactionId**；`signal` 已 aborted → 直接 `aborted`，不调引擎。
- [ ] 2.5 调用与终态（R1）：经门控解析器懒解析 provider 与子面 → `subface.run({agent, mode, range, signal, sourceCommandId})` → 结果映射；门面在引擎 resolve 后才产出结果（无第二异步写点）；子面缺失/形状不符 → typed disabled/unavailable（不抛穿）。
- [ ] 2.6 测试：门控矩阵（四条件逐一失败 → disabled + availability unavailable + 版本错配只 warn 一次）/ 无关 `sessions` 成员不受牵连 / inert core 下 availability 不抛、`run` 抛 typed / 结果映射全表与冻结 / lineage 字段逐一对应 / 入口校验矩阵（不触引擎）/ availability reason 层叠。

## Task 3: 取消、并发与决策衔接（对应 requirements R3、R7、R8）

**产出**：`lib/sessions-compaction-facade.js` 的 signal/并发接线 + 测试。

- [ ] 3.1 signal 原样传播（concurrency §3）：门面不组合本地 signal、不替换上游 signal；`signal` 直接进子面 → 引擎（summarizer signal 与 bracket 检查点）；invoke 前已 aborted → `aborted`（不调引擎）。**提交后取消边沿（requirements R8 第三条；Stage 3 审查修正）**：引擎在 durable commit 之后仍有 `signal?.throwIfAborted()`（forked-engine.js:635），故取消可能在事务提交后到达——此时终态随引擎裁决（`aborted`），既有事实（`compaction/completed`）为准，门面**不改写为 success**、不补发事实；该边沿须有专测（Task 3.4/6.5）。
- [ ] 3.2 并发声明落地（design §3.8；concurrency §6）：`exclusive`——互斥由引擎 durable compaction lock 承载（门面**不建第二把锁/队列/去重**）；并发第二个 `run` 得确定 `busy`（manual 锁/idle bracket）或 `open-turn-required`（range 无 open turn）；不排队、不抢占、不静默合并；两个并发 `run` 各自得到自己的判别式终态。
- [ ] 3.3 决策面零改动（R3）：`compaction/request` waterfall 与既有策略注册面**零改动**（不新增注册入口、不把 registry 当触发器）；reject → denied + 引擎 `compaction/skipped` 恰好一条 + 无事务；replace-range 成功 → 结果反映实际压缩范围，revalidation 失败 → 回落原 range（既有语义）；malformed 决策 → proceed（既有 containment 语义）。
- [ ] 3.4 测试：invoke 前 abort / summarization 中 abort（终态 `aborted`、事务闭合、`compaction/failed` 事实恰好一条）/ **提交后取消边沿**（durable commit 已落、取消在引擎 resolve 前到达 → 终态 `aborted`、`compaction/completed` 事实保持、结果不被改写为 success）/ 活跃压缩时第二调用 → `busy` / 非 idle agent `mode 'now'` → `busy` / 无 open turn `mode 'range'` → `open-turn-required` / 策略 reject 的 denied 链 / replace-range 成功与回落两分支 / 门面零 `compaction/*` emit（事实只来自引擎）。

## Task 4: provenance 与事实一致性（对应 requirements R5、R6；capability-strategy R1–R8 为 R 类硬约束）

- [ ] 4.1 触发词可辨（R6）：operation 两模式分别落 `manual` / `direct`（沿用四值 canon，不增不减）；自动路径保持 `pressure`/`context-overflow`；`sourceCommandId` 从 options 原样透传进请求 payload、started/completed 事实与 lineage（门面不生成、不改写）。
- [ ] 4.2 事实生产权（R5）：门面**零 `compaction/*` emit**、零新增事件登记；事实只由引擎在事务内派发；失败结果只含 code/stage/reason，不携带 summary 正文/消息文本/堆栈（与既有 redacted failure 同一边界）。
- [ ] 4.3 lineage 可查（R1）：compactionId 与 shadowed range 经既有 `sessions` durable 事件面（`compaction/start|summary|end` + replacement user message）回查；门面不新增读路径、不缓存。
- [ ] 4.4 测试：provenance 断言（operation 触发 = manual/direct；自动路径不受影响）/ `sourceCommandId` 透传（请求 payload + 事实 + lineage）/ 门面零 emit（spy）/ 失败结果脱敏（无 summary 正文与堆栈）/ lineage 经既有 session 事件面回查一致。

## Task 5: capability、availability 与登记（对应 requirements R9、R10 与 design §3.4 登记义务）

- [ ] 5.1 运行时 capability：`lib/capability-descriptors.js` 增 `entry('sessions.compaction', 'execute', ['sessionCompaction'])`（effect 取 `execute`：唯一成员是 operation 入口；features 输入即 P8 的 `sessionCompaction` feature key）；`lib/capability-matrix.js` 增 cluster 行；`lib/namespace-availability.js` 增 `'sessions.compaction'` 记录（`{ path: 'compaction', capabilityPath: 'sessions.compaction' }`）。
- [ ] 5.2 canonical registry：
  - 两条成员行：`sessions.compaction.run`（**operation** / **execute** / **coordinated** / **not-applicable** / scope **session** / authority **compaction replacement authority**；`currentShape` 写冻结结果全字段 + 「省略 `operation` 成员（已登记的 idiom 例外）」+「compactionId 由引擎铸造」；`migrationAction: null`、`status: 'advanced'`、`failureSemantics: 'discriminated-result'`）、`sessions.compaction.availability`（selfDescription/read/pure/scope **facade**/authority **compaction replacement authority**）。
  - `namespaces` 增 `sessions.compaction` 导航记录（runtime host、capabilityPath、`contributingFeatures: ['compaction-operation']`、`availabilityMember: 'sessions.compaction.availability'`、`availabilityExemption: null`）；`capabilityMatrix` 增 cluster 行（`status: 'retained'`、两条叶子路径、`affectedConsumers` 按实际、`verification: ['registry-draft','capability-matrix']`）。
  - **`idiomExceptions` 登记**：`sessions.compaction.run` 的六元组（`memberPath` / `baseContract: 'operation'` / `exception: '外层结果省略 operation 成员'` / `reason`（不铸造门面 operation 身份，compactionId 是引擎资源身份）/ `replacementShape`（结果字段表）/ `verification`（结果字段断言 + registry 断言））。
  - `eventCatalog` 不新增；`services.compaction` 白名单不回流（M7 B4-7 删除保持）；validator 全绿。
- [ ] 5.3 治理同步（design §3.4 登记义务）：`docs/standards/capability-strategy.md` §5 装配表（本行 client 半面仍「无」）+ R 扩展登记、`AGENTS.md` §2/§4 与 feature-list §3.1/§7、`public-api-shape.md` §2 host 领域树、`domain-composition.md` §2 领域行、`README.md`；登记覆盖该能力的 upstream proposal 与退役条件（官方提供等价公开触发 seam 时本 operation 面退役为官方直通）。
- [ ] 5.4 测试：capability/availability 镜像一致 + registry validator + P8 的同步点。

## Task 6: 端到端验收与迁移证据（对应 requirements R1–R10 的 Testing Strategy；capability-strategy R5/R6 回归见 Task 6.6，其余 R1–R8 见 Task 1.4/1.5 与执行边界）

**产出**：`test/sessions-compaction-e2e.test.mjs` + 共享基座 `test/sessions-compaction-test-kit.mjs` + `test/compaction-operation-migration-slices.test.mjs`。

- [ ] 6.1 e2e 基座：真实 `@deepseek-ai/cordis` 树上装配 **forked engine**（`packages/compaction-events/lib/forked-engine.js`）+ seam/fake summarizer fixture（不依赖真实模型调用）+ 门面 `apply`；`compaction/request` 策略经既有 `events.on` 注册；session durable 面用官方 `Session`（既有先例）与最小 store 桩。
- [ ] 6.2 真实链（R1）：`mode 'now'` 与 `mode 'range'` 各跑一次真实压缩 → session durable 记录（start/summary/user message/end）真实落盘、lineage 与 compactionId 经既有 session 事件面回查一致、门面零 `compaction/*` emit。
- [ ] 6.3 结果可区分（R4）：五终态逐一（compacted 含 lineage / skipped no-candidate / denied 带策略 reason / error 带 code+stage / aborted）且**无一处用 `null` 表达**。
- [ ] 6.4 决策衔接（R3）：reject → denied + skipped 事实恰好一条 + 无事务；replace-range 成功与 revalidation 失败回落；malformed 决策 → proceed。
- [ ] 6.5 取消/并发（requirements R7/R8）：invoke 前 abort / summarization 中 abort / **提交后取消边沿（事务已提交、终态仍为 aborted、completed 事实不被改写）** / 活跃压缩第二调用 busy / 非 idle `now` busy / 无 open turn `range` open-turn-required。
- [ ] 6.6 门控与降级（requirements R9；capability-strategy R5 版本锁定不匹配安全停用 + R6 组件唯一 owner/冲突 inert）：四条件逐一失败 → typed disabled + availability unavailable + 无关成员不受牵连；版本错配只 warn 一次；`ctx.compaction` 被他方占用 → inert。
- [ ] 6.7 迁移 slices：A——`dsh-tianshu-tui` 的 `/compact`（原：可选服务名直调 `compactIfNeeded`/官方服务；迁：`sessions.compaction.run({ agent, mode: 'now', sourceCommandId })` + 结果码分支渲染）；B——策略插件经既有 `compaction/request` 参与并观察 operation 触发的压缩（原：只看自动压缩；迁：同一决策面同时治理两类来源）。
- [ ] 6.8 design 回写：P1–P8 的运行结论与任何实现期修订（含 fork 内 typed 错误类、否决对象形态、门控解析器的实际条件）按 spec 修订流程同步回 design 并登记。

## Task 7: 全量验证、全局终审与提交

- [ ] 7.1 `npm test`（4G 护栏）全绿（含包级测试）；治理 token 审计不新增泄漏；client bundle `--check` 一致（host-only，预期无 client 产物变化）；**生成物规则**：`packages/compaction-events` 若有检入生成物须走既有重建入口（本 feature 只改源文件与测试，不手工编辑生成物）。
- [ ] 7.2 全局终审（阻塞式、只读）：只审整体交付与 Tasks/Design/Requirements 一致性 + `docs/standards/` 适用分册（尤其 `capability-strategy.md` R1–R8、`concurrency-and-cancellation.md` §6、`api-idioms.md` §1 例外）；返回「无偏差」后才可进入 7.3；有意见则集中修订并再次派审（**纯措辞/登记级小修改就地闭合并登记，不再回派复审**）。
- [ ] 7.3 `git diff --check` 干净；终审通过后按阶段提交规则提交本 Stage 4 交付并完成最终登记。

## 执行边界

- 版本冻结：不步进任何版本字段（AGENTS §3.0.1）。
- R 类硬约束（capability-strategy R1–R8）：组件唯一 owner 不变（`packages/compaction-events`）；不新增 patch 行、不改 `cordis.patch.yml`、不覆盖 `@deepseek-ai/dsh-*` import 面；additive 扩展（既有四方法与事件面逐成员不变）；boot 自检含 marker；冲突 inert；退役条件与 upstream proposal 同批登记。
- 不造第二个 summary 模型/压缩算法；不以 `events.emit('compaction/...')` 假装执行；不把 `compaction/request` 当触发器；不新增 durable scope 档与 wire 协议。
- 入口与运行期 fail-safe：门控解析失败只停用本面并记 bounded diagnostic，绝不抛穿 apply；`availability()` 永不抛错。
- 本线只承载 `now`/`range` 两种公共触发语义；`compactIfNeeded` 的自动路径不外露（provenance 可辨，R6）。

## Stage 3 对抗性审查记录（第一轮）

结论「有意见」八条（1 阻塞 / 2 高 / 3 中 / 2 低），逐条处置：

1. **（阻塞）P1 对 `compactNow` 外层 catch 的语义描述与源码不符** → 修正为：`compactNow` **非 async**，外层 `try/catch` 只能捕获同步抛出——`runMaintenance` 仅在 agent 非 idle 时同步抛裸 `Error('agent ... already has active work')`（`dsh-agent-loop` lib/index.js:412-413），外层 catch 把它包成 `ManualCompactionError('busy')`；maintenance job 内的异步失败（内层重抛的 `cancelled`、`throwManualFailure` 的 summary/commit/changed）以**原类型 reject**，不经外层包装。P1 同时作为 Task 1.3 分类实现的依据。
2. **（高）Task 1.3 失败分类未覆盖 `runMaintenance` 的非 idle 裸 Error** → 子面必须复刻外层转换语义：把该同步抛出点以**来源判定**（catch 位置，非 message 匹配）映射为 `{kind:'failed', code:'busy'}`；job 内异步失败按 P3 类型分类。
3. **（高）P8「不新增 FEATURE_MOUNTERS 条目」与 Task 2.2 槽位机制、Task 5.1 descriptor 不自洽** → 采纳 **feature key 路线**（`sessionCompaction`，与 `sessionBranch` 同款机制）：新增 FEATURE_MOUNTERS 条目 + `KNOWN_FEATURES` 键 + 槽位全套 + guard 分支；P8 的同步清单补全为「feature 总数 40 → 41 + 全部尾部/列表断言（含 `official-passthrough-independence`、`security-policy-assembly`、`host-cutover`、`registry*`）」，Task 2.2/5.1 同步改写（放弃 `attachments` 式无 key 的 provider 门控路线，理由：design §3.2 明示「同 sessions.branches 模式」）。
4. **（中）Task 2.3「lineage 逐字段透传（不改名不删字段）」会把 summary 正文带进公共结果** → 钉死 `lineage` **恰为 design 声明的 8 个字段**（compactionId / shadowedRange / shadowedSeqs / shadowedTokenCount / startSeq / summarySeq / endSeq / sourceCommandId?），**明确剔除 summary 正文**（与既有 `buildCompletionResult` 的剔正文边界、design §5.4 与 visibility-and-redaction 一致）。
5. **（中）range 模式的 `summary-failed`/`commit-failed` 无 stage 落地机制** → fork 在 owner !== null 路径的 `throw failure.error` 抛出点给 error **附加不可枚举的 `compactionStage` 属性**（additive、不改错误类与 message），子面据此在 range 模式同样产出带 stage 的失败码。
6. **（中）requirements R8 的「提交后取消」边沿无任务/测试覆盖** → Task 3.1 增列该边沿的语义（引擎 commit 后仍有 `throwIfAborted`；终态随引擎裁决、事实为准、门面不改写为 success），Task 3.4/6.5 增专测。
7. **（低）任务头 R 编号在 requirements R1–R10 与 capability-strategy R1–R8 两套间混用且 R9/R10 无标注** → 全部任务头改为显式限定（`requirements R…` / `capability-strategy R1–R8`），并补 R9/R10 的追溯标注。
8. **（低）探针行号与使用点枚举误差** → 修正 `compactIfNeeded` 1026–1083、`compactSurfaceRegion` 512 起、`COMPACTION_EVENTS_ACTIVE_SYMBOL` :443，以及五个哨兵使用点的准确位置（:550 位于 `compactSurfaceRegion` 内部、:1047/:1072/:1110/:1130）。

修订后：探针 P2–P8 的事实性经审查方独立复核相符（仅上述行号与 P1 的 catch 语义需更正）；R 类硬约束八项中除第 3 条外均已落实，第 3 条经 feature key 路线闭合；分册对照中除第 4/5 条涉及的字段与脱敏边界外未见其他偏差。

### 第二轮（复审）意见与处置

复审确认第一轮 8 条全部实质闭合（P1 错误语义、Task 1.3 分类、feature key 路线与 12 个同步文件、lineage 8 字段边界、stage 恢复方案、提交后取消边沿、R 编号与行号），另指出 1 条低度标注错误：Task 6.6 的编号标注（门控与降级应为 requirements **R9** + capability-strategy **R5/R6**，而非 R8）→ 已更正，Task 6 头的交叉引用同步修正。该条属**纯标注类小修改**，按 AGENTS §3.2「仅小修改无需再对抗性审查」就地闭合，不再回派复审。
