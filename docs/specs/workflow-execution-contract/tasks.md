# Stage 3 - Tasks

> feature_name: `workflow-execution-contract`
> milestone: M10
> status: Stage 4 已交付（2026-09-14）。Stage 3 审查门两轮（7 条 → 无偏差）；Stage 4 全局终审见文末执行注。全量 `npm test` 绿（用例数随终审处置增长）；registry validator `registry valid`；client bundle `--check` 一致；`git diff --check` 干净。Stage 3 审查记录：第一轮 7 条（1 高 / 2 中 / 4 低）全部修订，处置见文末。
> 输入溯源：`goal.md`（2026-09-11 获批）；`requirements.md`；`design.md`（§1–§8：namespace 放置、seam 包装、start 结果与 run handle 形状、parent 检查、tasks/executions 关联、终态映射、R 点位判定、取消并发、装配、绑定汇总、Testing Strategy、standards 逐分册）；Stage 3 源码级探针记录见下。
> 执行口径：Stage 3 以对抗性审查为门（AGENTS.md §3.2），通过后直接进入 Stage 4；版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。**本线判定为纯 B 类门面转译，无 R 点位**（design §3.7）。

## Stage 3 探针记录（源码级事实，Stage 4 以行为测试复核）

- **P1 seam 定义**（`@deepseek-ai/dsh-workflow@0.1.0-rc.6`，`lib/index.js`，92 行）：`WorkflowEngine extends Service`，服务名 `workflowEngine`；`WorkflowRunId(id)` 是 brand 工厂（引擎铸 UUID）；`WorkflowError extends HarnessError`，`code` 为 machine-routable taxonomy，`fatal` 默认 `true`（组合子据此 rethrow 而非 null 化）；`isFatalWorkflowError(error)` 按 `instanceof` 判定。`emitWorkflowEvent(name, ...args)` 经 `ctx.events.dispatch('emit', …)` 派发并对每个 listener 的同步 throw 与异步 rejection 做 containment（只 warn）。模块文档：**invalid request 在发布前抛错；live run 为 holder-owned，其 `result` never rejects；cancel 与 dispose 有界，dispose 在该界内等待子清理；`workflow/end` 在 result 结算时恰好一次**。
- **P2 默认引擎 `start`**（`@deepseek-ai/dsh-workflow-worker-thread@0.1.0-rc.6`，`lib/index.js`，919 行）：`start(request)`（:869–918）**同步**执行：①`validateMeta(request.meta)`（shape 校验，失败抛 `WorkflowError('META_INVALID')`）；②`assertBodyParses(request.script, meta.name)`（脚本体在 host 侧 parse，失败抛 `SCRIPT_PARSE`；meta 语句写在 body 里也抛 `SCRIPT_PARSE`）；③`resolveSubagentProvider(ctx, config.provider, request.subagentProvider)`（非规范化字符串 → `INVALID_ARGUMENT`；provider 未注册 → `AGENT_START`）；④`resolveMaxTotalAgents(...)`（非正安全整数或超引擎上限 → `INVALID_ARGUMENT`）；⑤`WorkflowRunId(randomUUID())` 铸 id；⑥构造 `WorkerRun(ctx, subagents, id, meta, request.parent, init, provider, disposeGraceMs, observer, request.signal)`（**parent 原样进 run**；`runCtx` 在 start 时捕获——引擎卸载只移除「再启动」能力，已启动 run 仍能启动与清理子 agent）；⑦`emitWorkflowEvent('workflow/start', info)`（info = `{id, meta}`）；⑧`workerRun.result.then(settled => emitWorkflowEvent('workflow/end', info, {stopReason, error?, agentsStarted}))`；⑨返回 `workerRun`。**默认引擎同步抛错集恰为四值**：`META_INVALID` / `SCRIPT_PARSE` / `INVALID_ARGUMENT` / `AGENT_START`（seam 契约本身不限定同步码集——官方 `WorkflowErrorCode` 共 11 值，门面须**开映射**原样透传）。
- **P3 run handle**（`WorkerRun`，:258 起）：字段/成员 `id`（官方 id）、`meta`、`parent`、`provider`、`result`（**never rejects**，settle 恰好一次）、`cancel(reason)`（:343；`signal?.aborted` 时构造期即 `cancel('workflow start signal already aborted')`）、`dispose()`（:371；内部先 `cancel('workflow disposed')` 再按 `disposeGraceMs` 有界等待子清理）。run 是 **holder-owned**：引擎不保留全局 run 注册表（模块文档），handle 即所有权凭证。
- **P4 meta 块 shape**（`validateMetaShape`，:730–779；:789 起为 `validateMeta`）：必须是对象；仅接受 `name` / `description` / `whenToUse` / `phases` 四个字段（未知字段即 violation）；`name`、`description` 非空字符串必需；`whenToUse` 可选字符串；`phases` 逐项校验。门面**不重复校验** meta（引擎是唯一校验者，门面只做请求形状检查）。
- **P5 门面既有资产**：registry `eventCatalog` 已登记 `workflow/start`、`workflow/phase`、`workflow/log`、`workflow/agent-start`、`workflow/agent-end`、`workflow/end`（producer authority = workflow authority，facade 直绑）；`services.workflows` 整键已在 M7 删除（B4-8）；**`workflowEngine` 不在 `services.*` 白名单**（`lib/services.js` / registry `servicesWhitelist` 均无），故门面经 `ctx.get('workflowEngine')` 内部消费、不新增直通面（design §3.2）；`workflows` 在 registry `members` / `namespaces` / `hostDomainTree` 中**均不存在**（新顶层领域）。
- **P6 接线落点（顶层新领域，与 `credentials` 同型）**：`pluginApi.workflows` 根 namespace（method 风格 getter + 按访问合成 caller-bound `start`，per-caller 缓存）、feature key `workflows`（`FEATURE_MOUNTERS` 追加 + `KNOWN_FEATURES` + `_workflowsSlot`/`_workflowsSurface`/`createDisabledWorkflowsApi` + `_assignFeature`/`_readSlot`/`_disabledSurfaceFor`/`unmountFeature` + `lib/guards.js` 分支（探 `ctx.get('workflowEngine')` 的 `start` 形状 + `ctx.get('agents')` 的 `get`））；`availability()` 探测引擎 provider 是否可用（`typeof start === 'function'` 且非 thenable），**不用对象存在性冒充**（design §3.1/R9）。
- **P7 owner 与 parent**：owner 由 caller fiber 派生（既有 `deriveAdapterRegistrationOwner`）；parent 必须是门面 agents 面发出的 live agent 引用，经 `ctx.get('agents').get(id)` 解析并做**身份一致性比对**（`live === 传入引用`），失败 → `{ ok:false, code:'parent-unresolved' }`（无 engine 调用、无 id、无事件）；通过后传 verified live Agent 本体，子 agent 归因由引擎承担（门面不改写）。
- **P8 既有精确列表断言的同步点（非穷尽，Stage 4 以 `npm test` 全量失败为准逐一收敛）**：feature 总数 **41 → 42**（`workflows` 追加在 `sessionCompaction` 之后）+ 尾部顺序断言（`index.test`/`index-session`/`index-agent`/`index-session-durable`/`index-tools`/`index-events`/`index-system-prompt`/`index-profile`/`index-remote`/`index-diagnostics`/`official-passthrough-independence`/`security-policy-assembly`）；registry `hostDomainTree` 补 `workflows` + `namespaces` 记录 + `capabilityMatrix` 行。（`test/host-cutover.test.mjs` 的 capabilities 断言与 `lib/capability-descriptors.js` 的 `CAPABILITY_PATHS` 同源、自动一致，**不在同步清单内**；真正的镜像同步点是 registry mirror 与 capability-matrix 全量镜像测试，由 Task 5.1/5.2 覆盖。）

## Task 1: workflows 核心模块（对应 req R1–R5）

**产出**：`lib/workflows-operation.js`（纯函数模块，零 harness 依赖可测）+ 单元测试 `test/workflows-operation.test.mjs`。

- [x] 1.1 请求校验（req R1 的 cannot-begin 前置；design §3.3）：`validateStartRequest(request)` → 非对象 / 缺 `script`（非字符串）或 `meta`（非对象）/ `parent` 非对象 / `args`、`subagentProvider`、`maxTotalAgents`、`signal` 形状不符 → `{ ok:false, code:'invalid-request', reason }`（**门面自有码，引擎调用前返回**）；合法则 `null`（透传）。门面**不校验 meta 内容**（引擎是唯一校验者，P4）。
- [x] 1.2 start 结果映射（design §3.3；**门面码集修订登记**）：`mapStartRejection(error)` → 官方 `WorkflowError`（`instanceof`，P1）→ `{ ok:false, code: error.code, reason }`（**开映射**：任何官方码原样透传，不改名转译）；非 `WorkflowError` 的包装层异常 → `{ ok:false, code:'internal', reason }` + bounded diagnostic（contain，不抛穿）；成功 → `{ ok:true, code:'started', handle }`。**no-run 结果不铸造 id、不产生任何 `workflow/*` 事件**。**design 修订（登记）**：门面自有码由两类（`parent-unresolved`/`invalid-request`）扩为**三类**，新增 `internal` 承载「包装层异常被 contain 为判别式失败」（design §3.10 已声明该 contain 行为但未给码）；随 Task 6.8 回写 design §3.3/§3.10。
- [x] 1.3 run handle 工厂（design §3.3）：`createWorkflowRunHandle({ run, ownerId, subscribeFeed })` → 冻结 `{ id, ownerId, meta, status(), observe(listener), result, cancel(reason?), dispose() }`：
  - `id` 官方 `WorkflowRunId` 原样；`meta` 引擎验证后的块（冻结）；
  - `status()` 纯派生（`{ state:'running'|'settled', stopReason?, error?, agentsStarted? }`，冻结；settle 后反映终态）；
  - `observe(listener)` run-scoped 过滤订阅（按 `run.id` 过滤既有 `workflow/*` feed；返回 disposer；listener 失败按总线 containment；dispose 只结束本订阅）；
  - `result` getter → 判别式终态 Promise（**never rejects**，恰好 resolve 一次）；
  - `cancel(reason?)` 原样委托官方 `run.cancel`（settle 后官方 no-op）；`dispose()` 幂等、委托官方 `dispose()`（不另设宽限期）。
- [x] 1.4 终态映射（req R4/R5；design §3.6 表）：官方 `WorkflowResult`（never rejects）→ `{ ok, terminal, stopReason, value?/error?, agentsStarted }` 冻结判别式：`completed → terminal:'success', ok:true, value`（脚本无返回值时如实携带官方 no-value 表示）、`cancelled → 'aborted', ok:false, error`、`error → 'error', ok:false, error`；**不产生 `denied`/`superseded`**（本域无策略否决点与 generation 取代）；映射异常（理论不可达）fail-closed 为 `error` 终态 + bounded diagnostic。
- [x] 1.5 stale guard 与并发（req R5/R6；design §3.8）：handle 操作绑定创建时的 run identity（`cancel`/`dispose`/`observe`/`status` 只作用于该 run；旧引用无法触及新 run 或他人 run）；`parallel` 语义（不同 run 互不影响，无共享可变状态、无 CAS/fencing 需求）；`dispose` 幂等（重复调用不再触达引擎）。
- [x] 1.6 测试：请求校验矩阵（引擎调用前拒绝，无 id 无事件）/ 官方码开映射（四值 + 构造的第五值原样透传）/ 包装层异常 → `internal` 且不抛穿 / handle 形状与冻结 / `status()` 三态 / `observe` 过滤与 containment 与 disposer 只结束本订阅 / `result` never rejects 且恰好一次 / 终态三行映射逐字段 / `cancel` settle 后 no-op / `dispose` 幂等 / stale guard。

## Task 2: 门面接入顶层 `pluginApi.workflows`（对应 req R9、R10）

**产出**：`lib/workflows-facade.js` / `lib/plugin-api-service.js` / `lib/index.js` / `lib/guards.js` 接线 + surface 测试。

- [x] 2.1 命名空间发布（design §3.1；P6）：顶层 `workflows` 根，method 风格 getter 内按访问合成 caller-bound 子面（`start` 需调用方上下文派生 owner）；feature key `workflows`（`FEATURE_MOUNTERS` 追加、`KNOWN_FEATURES`、槽位全套、`lib/guards.js` 分支）；namespace 在任何状态下存在（inert core 下 `start` 抛 `PluginApiInactiveError`、`availability()` 返回 typed 且永不抛错）。
- [x] 2.2 `start(request)`（req R1、R2、R7）：单同步跨度 = availability 检查 → 请求校验（Task 1.1）→ owner 派生（不可归因 → typed `denied`？**按 design：owner 派生用于 handle 归因，不阻断启动**——本线不设 owner 拒绝分支，仅如实记录 ownerId；若 Stage 4 实测发现 design 需要拒绝，须先修 spec）→ parent 校验（Task 3）→ `ctx.get('workflowEngine').start(verifiedRequest)` → 结果映射 + handle 包装；引擎抛错 → 判别式 no-run（Task 1.2），绝不抛穿。
- [x] 2.3 availability（req R9）：`{ status:'active'|'degraded'|'unavailable', reason? }` 冻结、永不抛错；active = `ctx.get('workflowEngine')` 提供可用 `start`（`typeof === 'function'` 且非 thenable）；unavailable = 缺失/形状不符；不因引擎对象存在就报 active。
- [x] 2.4 fail-safe 挂载与降级隔离（req R9）：guard 分支探 `workflowEngine.start` 形状与 `agents.get`；挂载异常只记日志并停用；运行期引擎消失 → `start` 抛 typed feature-disabled（与 `sessions.branches` 同型）、availability unavailable，无关能力不受连带。
- [x] 2.5 测试：surface 形状（`start`/`availability`）/ 未挂载与 inert core 的 typed 呈现 / 无关能力隔离 / caller-bound 子面（真实 cordis：两个调用方各自子面 + handle.ownerId 归因）/ 引擎缺失与形状不符的降级 / availability 不用存在性冒充。

## Task 3: parent 校验与关联契约（对应 req R2、R7、R8）

**产出**：`lib/workflows-facade.js` 的 parent 校验 + 测试。

- [x] 3.1 parent 校验（design §3.4；P7）：必须是由门面 agents 面发出的 live agent 引用——`ctx.get('agents').get(id)` 解析并对**身份一致性**比对（`live === 传入引用`）；失败/不一致/`agents` 面不可达 → `{ ok:false, code:'parent-unresolved', reason }`（无 engine 调用、无 id、无事件）；通过后传 verified live Agent 本体。
- [x] 3.2 tasks/executions 关联（req R8；design §3.5）：**本 feature 不修改 tasks 面任何成员**；run handle 暴露官方 `id` 供插件作为 `workflowId` 传入既有 `tasks.attach/start` 的 workflow source adapter（证据链由既有面承担）；task identity 与 run identity 不互换；`task.start` 维持关系/观测语义；子 agent 观测由既有 `subagent/*`/`executions` 覆盖，零改动。
- [x] 3.3 测试：parent 矩阵（**裸 id 字符串属于请求形状违规 → `invalid-request`**；自造对象 / 旧引用 / 非一致对象 / agents 面缺失 → `parent-unresolved`；全部无副作用、不触引擎）/ verified parent 原样进引擎（引擎收到的是同一对象）/ tasks 面零改动回归（既有 tasks 测试全绿）/ run id 可作为 workflowId 证据引用（e2e 切片）。

## Task 4: 取消、并发与装配（对应 req R5、R6、R9）

- [x] 4.1 取消传播（concurrency §3）：`request.signal` **原样**入引擎（不组合、不替换）；`handle.cancel(reason)` 原样委托；取消是信号不是终态（终态由官方 `stopReason` 裁决）；settle 后 `cancel` 为官方 no-op。
- [x] 4.2 并发声明（concurrency §6）：`parallel`；两个 run、两个 owner 隔离（引擎 per-run worker/子 agent registry/id）经门面验收；run 内并发上限是引擎配置语义，门面不复制。
- [x] 4.3 装配（design §3.9）：纯主包 facade translation，**不依赖任何 replacement 行**；full 与仅 main 的装配行为一致；无新 wire/durable 协议；浏览器侧展示继续走既有 client 事件转发（host-only）。
- [x] 4.4 测试：pre-aborted signal → 引擎侧取消语义（run 终态 aborted）/ cancel 后终态与 `workflow/end` stopReason 一致 / settle 后 cancel no-op / 两个并发 run 隔离（各自 id、各自终态、事件按 id 归属）/ dispose 幂等且等待子清理（bounded）。

## Task 5: capability、availability 与登记（对应 req R9 与 design §3.1/§3.3 登记义务）

- [x] 5.1 运行时 capability：`lib/capability-descriptors.js` 增 `entry('workflows', 'execute', ['workflows'])`；`lib/capability-matrix.js` 增 cluster 行；`lib/namespace-availability.js` 增 `workflows`（`{ path: '', capabilityPath: 'workflows' }`）。
- [x] 5.2 canonical registry：
  - 成员行（字段值须在 registry 词表内；`concurrency-and-cancellation.md` 的 `parallel` 是 design 层策略声明，不是 registry 字段值）：
    - `workflows.start`：`idiom: operation` / `effect: execute` / `composition: **additive**`（design §7；多 owner 各自创建相互隔离的 run）/ `conflictRule: not-applicable` / `concurrency: null`（无共享可变状态，无需 CAS/fencing；`parallel` 策略见 design §3.8）/ `scope: profile`（run 由进程级引擎持有）/ `authority: workflow authority` / `runtime: host` / `failureSemantics: discriminated-result` / `migrationAction: null` / `status: advanced`。
    - `workflows.start.handle`：`kind: handle` / `idiom: operation` / `effect: execute` / `composition: additive` / `conflictRule: not-applicable` / `concurrency: null` / `scope: profile` / `authority: workflow authority` / `identitySource: 'the official workflow run identity'` / `currentShape: '{ id, ownerId, meta, status(), observe(listener), result, cancel(reason?), dispose() }'` + 四条 idiomExceptions（见下）/ 其余字段按 validator 必填显式 `null`。
    - `workflows.availability`：`idiom: selfDescription` / `effect: read` / `composition: pure` / `scope: facade` / `authority: workflow authority` / `availabilityShape: leaf` / 其余显式 `null`。
  - **idiom 例外六元组**（逐条，`memberPath` 按实际 dot path 单列，不与彼此合并；每条含 `memberPath`/`baseContract`/`exception`/`reason`/`replacementShape`/`verification`）：
    - (i) `memberPath: 'workflows.start'`，`baseContract: 'operation'`，`exception: '外层结果省略 terminal 成员'`，reason：cannot-begin/no-run 没有可携带终态的 operation 实例（不铸造 run/operation 身份），真正终态由 holder-owned run 经 `handle.result` 恰好一次交付；
    - (ii) `memberPath: 'workflows.start.handle.meta'`，`baseContract: 'operation'`，reason：引擎验证后的 meta 块在脚本运行前即可用（官方契约），是 holder 渲染/关联所需；
    - (iii) `memberPath: 'workflows.start.handle.result'`，`baseContract: 'operation'`，reason：官方 result promise（never rejects）是唯一终态交付点，不可转译；
    - (iv) `memberPath: 'workflows.start.handle.cancel'`，`baseContract: 'operation'`，reason：cancel 是官方 seam 的第一类动作（取消信号），handle 如实映射。
  - `hostDomainTree` 增 `workflows` 根；`namespaces` 增 `workflows` 记录（`contributingFeatures: ['workflow-execution-contract']`、`availabilityMember: 'workflows.availability'`）；`capabilityMatrix` 增 cluster 行；`eventCatalog` **不新增**（`workflow/*` 六事件已登记）；`servicesWhitelist` 不变（`workflowEngine` 不进白名单）；validator 全绿。
- [x] 5.3 治理同步（design §3.1）：`public-api-shape.md` §2 host 领域树增 `workflows` 块；`domain-composition.md` §2 增 `workflows` 领域行；`README.md` 增小节；feature-list §7 交付条目（含 host-only 六问、与 tasks/executions 的分工交叉引用、无 R 点位的判定与退役触发）；registry 登记记录「官方未来提供等价公开 seam 时本包装面退役为官方直通」。
- [x] 5.4 测试：capability/availability 镜像一致 + registry validator + P8 精确列表断言同步（41 → 42）。

## Task 6: 端到端验收与迁移证据（对应 req R1–R10 的 Testing Strategy）

**产出**：`test/workflows-e2e.test.mjs` + 共享基座 `test/workflows-test-kit.mjs` + `test/workflow-execution-migration-slices.test.mjs`。

- [x] 6.1 e2e 基座：真实 `@deepseek-ai/cordis` 树 + **真实 `@deepseek-ai/dsh-workflow-worker-thread` 引擎**（`start` 为同步校验 + worker 线程；脚本用最小可运行 fixture，不依赖真实模型调用——子 agent 经 seam/fake `subagents` provider）+ 门面 `apply`；`workflow/*` 事件经真实 ctx 派发。
- [x] 6.2 启动链（req R1）：`start` 成功 → run id 为官方 UUID、`meta` 冻结可用、`workflow/start` 恰好一条；脚本真实执行（fixture 的 worker 结果可见）；`handle.result` 终态与 `workflow/end` 的 stopReason 一致。
- [x] 6.2b 重复启动与子 agent 归因（design §6 前两条）：**同一请求重复 `start` → 两个不同 run id、两 run 各自独立终态**（外部重发创建新 run，不合并身份，req R2）；**子 agent 实际被调用且 child 归因到 verified parent**（fixture 的 fake subagents provider 记录 parent，断言与门面传入的 verified live Agent 同一）。
- [x] 6.3 cannot-begin（req R1/R2）：meta 非法 → `META_INVALID`；脚本不可 parse → `SCRIPT_PARSE`；provider 未注册 → `AGENT_START`；`maxTotalAgents` 非法 → `INVALID_ARGUMENT`；四者均无 run id、无 `workflow/*` 事件；parent 不可解析 → `parent-unresolved` 同款。
- [x] 6.4 终态与取消（req R4/R5）：completed → `success` + value；cancelled（signal 与 `handle.cancel` 两路）→ `aborted` + error；脚本错误 → `error`；settle 后 `cancel` no-op；`status()` 与 `observe` 反映终态。
- [x] 6.5 隔离与生命周期（req R6）：两个 run 并发（不同 owner）各自 id/终态/事件归属；`dispose()` 幂等并等待子 agent 清理；引擎卸载后已启动 run 仍可结算（P2 的 runCtx 捕获语义）。
- [x] 6.6 降级与恢复（req R9；design §6 的「恢复 → active」）：引擎缺失/形状不符 → typed disabled + availability unavailable + 无关能力隔离；**引擎在运行期出现后 `availability()` 由 unavailable 恢复为 active**（懒探测，不缓存失败结论）。
- [x] 6.6b 事件面与 stale handle（design §6 其余两条）：**`workflow/*` 六事件经既有 events 面可达且 payload 与登记一致**（本 feature 零新增事件）；**feature 降级/重载后旧 handle 不影响他人 run**（旧 handle 的 `cancel`/`dispose` 只作用于其自身 run；`cancel`/`dispose` 交叉调用幂等且不互相影响）。
- [x] 6.7 迁移 slices（外部仓库不在工作区；**不伪造消费者**——goal 记录 TUI 目前只读取 workflowEngine 展示事件、未发现实际调用 start）：A——TUI/编排插件（原：只能读 `workflow/*` 事件做展示、无受支持的启动入口；迁：`pluginApi.workflows.start` + `handle.observe/result` 驱动进度与终态）；B——tasks 关联（原：无 run 身份证据；迁：以 `handle.id` 作为 `workflowId` 传入既有 `tasks.attach/start` 的 source adapter，证据链闭合）。
- [x] 6.8 design 回写：P1–P8 的运行结论（含引擎同步抛错集与开映射、runCtx 捕获、handle 语义、终态映射实测）按 spec 修订流程同步回 design 并登记。

## Task 7: 全量验证、全局终审与提交

- [x] 7.1 `npm test`（4G 护栏）全绿；治理 token 审计不新增泄漏；client bundle `--check` 一致（host-only，预期无 client 产物变化）。
- [x] 7.2 全局终审（阻塞式、只读）：只审整体交付与 Tasks/Design/Requirements 一致性 + `docs/standards/` 适用分册（尤其 `api-idioms.md` §1 例外六元组、`concurrency-and-cancellation.md` §3/§6、`identity-and-lifecycle.md` 资源身份、`public-api-shape.md` §1 一等领域）；返回「无偏差」后才可进入 7.3；有意见则集中修订并再次派审（**纯措辞/登记级小修改就地闭合并登记，不再回派复审**）。
- [x] 7.3 `git diff --check` 干净；终审通过后按阶段提交规则提交本 Stage 4 交付并完成最终登记。

## 执行边界

- 版本冻结：不步进任何版本字段（AGENTS §3.0.1）。
- 无 R 点位（design §3.7）：不新增/禁用任何官方行、不改 `cordis.patch.yml`、不 import 官方 workflow 包模块（只经 `ctx.get('workflowEngine')` 消费服务）。
- 不造通用 DAG language / 分布式调度平台；不在 `task.start` 隐藏第二执行器；不伪造 run identity/进度/终态；不缓存 run、不建全局 run 注册表（holder-owned）。
- 不新增 `services.*` 直通面（`workflowEngine` 不进白名单）；不新增 `workflow/*` 事件；无新 wire/durable 协议。
- 入口与运行期 fail-safe：挂载失败只记日志并停用；成员一律 typed 结果（`start` 的 no-run 判别式 / `availability` 永不抛），绝不抛穿 apply/dispatch。
- 本线无审计环（design 未声明 durable/内部审计载体）；如 Stage 4 发现需要，须先修 spec 并登记。

## Stage 3 对抗性审查记录（第一轮）

结论「有意见」七条（1 高 / 2 中 / 4 低），逐条处置：

1. **（高）Task 5.2 把 registry `composition` 记为 `parallel`**（不在 registry 词表内，且与 design §7 的 `additive` 冲突，照字面执行 validator 会报错）→ 改为 `composition: additive`（design §7）、`concurrency: null`（无共享可变状态，无需 CAS/fencing；`parallel` 是 design §3.8 的策略声明，不是 registry 字段值），并在 Task 5.2 显式说明该分界。
2. **（中）Task 1.2 新增门面码 `internal` 超出 design 自有码闭集** → 保留该码并把「门面自有码由两类扩为三类」登记为 design 修订（§3.3/§3.10 回写，Task 6.8），理由：design §3.10 已声明包装层异常 contain 为判别式失败但未给码。
3. **（中）design §6 Testing Strategy 多条断言在 Task 6 无对应条目** → 新增 Task 6.2b（同请求重复 start → 两个不同 id、两 run 独立终态；子 agent 实际被调用且归因到 verified parent）、6.6 扩为「降级与恢复」（引擎运行期出现后 availability 恢复 active）、6.6b（`workflow/*` 六事件可达且 payload 一致；feature 降级/重载后旧 handle 不影响他人 run、cancel/dispose 交叉幂等）。
4. **（低）P8 把 host-cutover 的 capabilities 前缀列表列为同步点**（实际与 `CAPABILITY_PATHS` 同源、自动一致）→ 更正为不在同步清单内，并点名真正的镜像同步点（registry mirror 与 capability-matrix 全量镜像，Task 5.1/5.2 覆盖）。
5. **（低）探针行号偏移** → `WorkerRun` 更正为 :258 起；`validateMetaShape` 更正为 :730–779（:789 起为 `validateMeta`）。
6. **（低）`workflows.start.handle` 登记行未给字段值、三个六元组未写 `memberPath`** → 补齐 handle 行全字段（kind/idiom/effect/composition/conflictRule/concurrency/scope/authority/identitySource/currentShape + 显式 null）与四条六元组的 `memberPath`（`workflows.start`、`workflows.start.handle.meta`、`...handle.result`、`...handle.cancel`）。
7. **（低）Task 6.7 slice A 的「原状」与 goal 记录冲突**（TUI 未发现实际调用 start）→ 改写为「原：只能读 `workflow/*` 事件做展示、无受支持启动入口」，并显式标注不伪造消费者。

修订后：P1–P8 事实经审查方独立复核通过（除上述行号外全部相符），分册对照除第 1 条的字段值错误外未见其他偏差。

## Stage 4 执行注（2026-09-14）

**交付物**：`lib/workflows-operation.js`（核心：请求校验、官方拒绝码开映射、终态三行映射、holder-owned run handle）、`lib/workflows-facade.js`（挂载、owner 派生、parent 校验、run-scoped 观察订阅）、`lib/index.js`（`workflows` FEATURE_MOUNTERS 条目）、`lib/guards.js` 分支（`workflowEngine.start` + `agents.get`）、`lib/plugin-api-service.js`（disabled 面、顶层 `workflows` 根的方法式 getter、槽位全套、`KNOWN_FEATURES`）、`lib/capability-descriptors.js`/`capability-matrix.js`/`namespace-availability.js`（运行时镜像）、canonical registry（三条成员行含四条 idiom 例外六元组 + `hostDomainTree` + `namespaces` + `capabilityMatrix`）、`README.md`/feature-list/`public-api-shape.md`/`domain-composition.md`、design「Stage 4 修订登记」与「Stage 4 运行结论」；测试 `test/workflows-operation.test.mjs`、`test/workflows-e2e.test.mjs`、`test/workflow-execution-migration-slices.test.mjs`。

**与 Task 文字的偏离（逐条登记理由）**：
1. **e2e 分层**：真实 `@deepseek-ai/dsh-workflow-worker-thread` 引擎承载核心链（启动/真实 worker 执行/终态/同步拒绝码/**child 归因与子输出拍平**），其 worker 线程在 run 结算后仍存活、会让测试进程挂起，故每个真实链用例都在 `finally` 中 `dispose()`；其余确定性场景（终态三分支、重复启动、cancel 绑定、观察隔离、事实面）用**探针形状引擎替身**（复刻官方同步校验词表与 holder-owned run 契约，无线程）。
2. **handle 的 `meta` 为冻结副本**：公开视图冻结（design §3.3 声明「冻结」），不冻结/不改写引擎自身的 meta 对象。
3. **门面自有码 `internal`**：design 原闭集为两类，Stage 4 扩为三类并登记（§3.10 已声明包装层异常 contain 为判别式失败但未给码）。
4. **`observe` 的接线形态**：对既有 `workflow/*` 六个登记事件名逐一订阅并按 run identity 过滤（不是单一通配订阅），保持既有事件的 payload/containment 契约不变。
5. **owner 语义**：owner 派生如实记录（访问上下文 fiber；root 访问得 `root`），**不阻断启动**——design 未声明 owner 拒绝分支（Task 2.2 已按 design 收口）。

**登记的 design 修订**：见 design 文末「Stage 4 修订登记」（门面码三类、meta 冻结副本、observe 过滤形态）与「Stage 4 运行结论（P1–P8 回写）」。

### Stage 4 全局终审（第一轮）意见与处置（2026-09-14）

终审返回「有意见」10 条（2 高 / 4 中 / 4 低），全部修订：

1. **（高）Task 6.2b「子 agent 实际被调用且归因到 verified parent」无证据** → 当轮按「引擎边界取证 + 替身模拟」落地：新增用例断言**引擎收到的 parent 即 verified live agent**，并以替身派发 `workflow/agent-start`/`agent-end` 事实。**⚠ 本条的「真实 worker 的 `agent()` 桥接需要完整官方 subagent provider 协议、实测子启动不会到达 host seam」结论已被第二轮复核证伪**（真因是 harness 未传全量 Config，不是引擎限制）；child 归因与子输出拍平现由真实引擎用例承载，见下「第二轮」第 1 条。
2. **（高）design「Stage 4 运行结论」把四个同步拒绝码记为真实引擎实测（实际只实测 `SCRIPT_PARSE`）** → 新增真实引擎用例逐一实测 `META_INVALID`/`SCRIPT_PARSE`/`AGENT_START`/`INVALID_ARGUMENT`（含超上限 `maxTotalAgents`），design 措辞同步为实测口径。
3. **（中）R5 取消两路与 signal 传播无证据** → 新增：pre-aborted signal 的取消结算用例；`handle.cancel` 后由引擎裁决为 `aborted` 的用例；**settle 后 cancel 为 no-op 且终态不被改写**的用例。
4. **（中）降级/恢复/owner 证据缺失** → 新增：形状不符（`start` 非函数）与 **thenable 拒绝**用例；**引擎运行期出现 → availability 恢复 active**用例；未挂载态成员集合与 typed 呈现用例；**两个调用方各自子面 + `CallerA`/`CallerB` owner 归因 + 各自 run 隔离（cancel 不越界）**用例。
5. **（中）终态保真两处偏差** → 官方结算/失败消息**不再截断**（原样保留，§3.6）；`value` 做**深冻结**（R4）。
6. **（中）reconcile 至 inert core 后 namespace 形状与 availability 破坏** → `createDisabledWorkflowsApi` 改为提供 `surfaceFor`（与 credentials 同型），inert core 下成员集合恒为 `{start, availability}`、`availability()` 返回 typed `unavailable`；实测复现路径已修。
7. **（低）`engine()`/guard 缺「非 thenable」检查** → 两处均补 `typeof then !== 'function'` ✓（design §3.1）。
8. **（低）`mapStartRejection` 用结构判定替代 `instanceof`** → 保留等价实现并登记（执行边界禁止 import 官方包，`instanceof` 不可用）。
9. **（低）Task 6.1「门面 apply」与共享基座未落实** → 登记为偏离：e2e 经 `createPluginApiService` + mounter 挂载（apply 循环路径由 `test/index.test.mjs` 的桩引擎用例覆盖）；未单独抽出 kit（两个测试文件各自内联 harness）。
10. **（低）弱断言与 parent 矩阵文字** → 六事实用例标题与注记改为「门面订阅六个登记事实名并按 run 过滤（替身不派发事实，真实引擎的 start/end 派发证据在真实链用例中）」；`args` 到达引擎、真实引擎 run id 为官方 UUID 均加断言；裸 id parent 归入 `invalid-request`（Task 3.3 文字同步）。

### Stage 4 全局终审（第二轮）意见与处置（2026-09-14）

第二轮返回「有意见」5 条（1 阻塞 / 4 低），全部修订：

1. **（阻塞）登记的 child 取证边界是错误事实** → 复核属实：真实 worker 的 `agent()` 桥接在最小 fake provider 下即可到达 host seam 并完成子 run；此前失败的真因是 harness **直接构造引擎时未传全量 Config**（缺 `maxConcurrentAgents` 使真实子启动在并发槽等待而挂起），不是引擎限制。已补齐 Config（`maxConcurrentAgents`/`maxItemsPerCall`/`syncTimeoutMs`）、把 fake provider 的 child result 改为 blocks 形状，并以**真实引擎**新增用例取证：子 agent 实际被调用（`childStarts === 1`）、归因到 verified parent、子输出拍平回到脚本（`childText === 'child 1 says hi'`）、引擎派发 `workflow/agent-start`/`agent-end`、`agentsStarted === 1`；design 与执行注的措辞同步更正，删除错误限制。
2. **（低）design P5/P7 仍把裸 id 记为 `parent-unresolved`** → 更正为「裸 id 属请求形状违规 → `invalid-request`；自造对象/幽灵 id/agents 面缺失 → `parent-unresolved`」（与实现与用例一致）。
3. **（低）处置记录 #10 与文件不符** → 六事实用例改为「门面订阅六个登记事实名并按 run 过滤」的诚实表述（替身不派发事实；真实引擎的派发证据在真实链用例），记录同步更正。
4. **（低）pre-aborted signal 的「原样入引擎」无断言** → 新增断言 `request.signal === controller.signal` 且 `aborted === true`。
5. **（低）降级/重载后旧 handle 与 inert core 呈现缺用例** → 新增两个用例：slot rollback 后命名空间 typed、旧 handle 仍能结算自己的 run 且不越界；inert core 下成员集合恒为 `{start, availability}`、`availability()` 返回 typed `unavailable`、`start` 抛 `PluginApiInactiveError`。

### Stage 4 全局终审（第三轮）意见与处置（2026-09-14）

第三轮返回「有意见」2 条（均低，纯记录/文字级；实质交付项与前两轮全部修订均判通过），按 AGENTS §3.2「仅小修改无需再对抗性审查」就地闭合并登记：

1. **（低）第一轮处置记录 #1 保留已证伪的旧结论** → 该条就地加上更正指针：明确「真实桥接需要完整官方 subagent provider 协议、子启动不会到达 host seam」已被第二轮复核证伪，真因是 harness 未传全量 Config，child 归因现由真实引擎用例承载。
2. **（低）design/执行注的 e2e 分层仍把 child 归因算在替身名下，替身 child 分支成死代码** → design 实现期修订第 4 条与执行注偏离第 1 条的「真实引擎承载」清单加入「child 归因与子输出拍平」，替身清单删除该项；`test/workflows-e2e.test.mjs` 删除无人调用的 `behaviour === 'child'` 分支（该文件 22/22 复跑通过）。

处置后正式关闭 Stage 4 全局终审门，进入完成提交。
