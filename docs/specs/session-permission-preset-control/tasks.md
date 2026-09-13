# Stage 3 - Tasks

> feature_name: `session-permission-preset-control`
> milestone: M10
> status: Stage 4 已交付（2026-09-13）。Stage 3 对抗性审查七轮（7 → 4 → 2 → 3 → 3 → 1 → 无偏差）全部就地闭合；Stage 4 全局终审见文末执行注。全量 `npm test` 绿（用例数随各轮终审意见处置增长，最新口径见文末执行注/终审记录）；registry validator `registry valid`；client bundle `--check` 一致（host-only，无 client 产物变化）；治理 token 审计绿；`git diff --check` 干净。Stage 3 审查记录：七轮结论依次为：7 条（1 高 / 3 中 / 3 低）→ 4 条（1 中 / 3 低）→ 2 条（1 中 / 1 低）→ 3 条（低）→ 3 条（低）→ 1 条（低）→ 无偏差；全部就地修订，处置见文末各节。
> 输入溯源：`goal.md`（2026-09-11 获批）；`requirements.md`（Reqs 1–11）；`design.md`（C1–C6、Data Models、Concurrency、Authority Closure、Orthogonality、Registry 拟新增行、Testing Strategy）；Stage 3 源码级探针记录见下。
> 执行口径：Stage 3 以对抗性审查为门（AGENTS.md §3.2），通过后直接进入 Stage 4；版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Stage 3 探针记录（源码级事实，Stage 4 以行为测试复核）

- **P1 官方服务与写入 seam**（`@deepseek-ai/dsh-permission-presets@0.1.0-rc.6`，`lib/index.js`）：`PermissionPresetService extends Service`，服务名 `permissionPresets`，`inject = ['shell', 'approval', 'sessions']`；构造期若 `ctx.shell.sandboxMode === undefined` 直接抛错（无 confine 的执行器上组合 = 误配）。
  - `set(session, name)`（266–270）：**同步、无返回值**；实现 = `this.apply(session, name, (policy) => setApprovalPolicy(session, policy))`。
  - `apply(session, name, setApproval)`（271–278）：①`resolve(name)` 对未知名**抛错**；②`this.current(session.events) !== name` 时 `session.append('permission/preset', { preset: name })`；③`spec.sandbox !== (effectiveSandboxMode(events) ?? ctx.shell.sandboxMode)` 时 `setSandboxMode(session, spec.sandbox)`；④`spec.approval !== (effectiveApprovalPolicy(events) ?? ctx.approval.config.policy ?? 'ask')` 时调用传入的 `setApproval(policy)`。**重复选择当前生效预设不 append 任何事件**（knob 亦一致 → 完全无副作用）。
  - `current(events)`（201–215）：`derive(foldKnobs(events))` → 官方预设名或 `CUSTOM_PRESET = 'custom'`（派生态；永不作为切换目标与事件 payload，见模块文档 8–15、19–23）。
  - 选项表：`names` getter（声明序，183–185）；`optionOf(name)`（247–259）→ `{ value, name, description? }`（`custom` → `{ value:'custom', name:'Custom', description:'Current sandbox and approval settings do not match a preset.' }`）；`selectFor(state)`（222–228）→ `{ options: [...names.map(optionOf), ...(currentValue === 'custom' ? [optionOf('custom')] : [])], currentValue }`。
  - `resolve(name)`（235–239）：未知名抛 `Error('permission: unknown preset "..." (known: ...)')`。
- **P2 官方读取载体**：`ctx.inject(['sessionProjections'], …)` 注册投影 `key: 'permissions'`（`schema: { options: [{value,name,description?}], currentValue }`，`init: () => EMPTY_KNOBS`，`apply: applyKnobEvent`，`view: (state) => this.selectFor(state)`）。官方 `@deepseek-ai/dsh-session-projection` 的 `snapshot(session)`（lib/index.js:105–115）返回 `{ asOfSeq: session.seq - 1, values: { <key>: <view> } }`；投影未注册时该 key 缺席（**不是抛错**）。`sessionProjections` 白名单成员含 `snapshot`（`lib/services.js:140-150`）。
- **P3 官方事实流**：状态唯一事实源 = session 日志的三种 knob 事件（`permission/preset{preset}`、`sandbox/mode{mode}`、`approval/policy{policy}`，last wins）；`session.append` 即 `session/event` 派发点（plan-mode 线 P3 同源结论）。`set` 的 knob 写入经 `setSandboxMode(session, mode)`（`dsh-sandbox-policy` lib/index.js:54–56，append `sandbox/mode`）与 `setApprovalPolicy(session, policy)`（`dsh-user-approval` lib/index.js:76–79，append `approval/policy`，非法策略抛 TypeError）。
- **P4 相邻写路径与真实审批行为**：官方 `/permission` command handler（153–177）自校验 `this.names.includes(name)` 后走 `this.apply(agent.session, name, (policy) => this.ctx.approval.setPolicy(agent, policy))`；`ApprovalService.setPolicy(agent, policy)`（`dsh-user-approval` lib/index.js:111–125）在值变化时同样 `setApprovalPolicy(agent.session, policy)`（durable append）+ `agent.inject(narration)` —— **两条官方写路径最终落同一组 durable knob 事件**，门面观察面均可达（Req 4.2）。**真实审批判定**：`ApprovalService.decide(req, session)`（`dsh-user-approval` lib/index.js:185–202）在 `signal?.aborted` → `'cancelled'`（:187）之后判 `this.effectivePolicy(session) === 'never'` → 直接返回 `'rejected'`（:188，不派发 waterfall、不询问 answerer）；`'ask'` 时派发 `approval/request` waterfall。`effectivePolicy(session)`（:168–170）= `overrideOf(session) ?? config.policy ?? 'ask'`，`overrideOf`（:176–178）`= effectiveApprovalPolicy(session.events)` —— 即**预设选择经日志 fold 直接改变真实审批判定**（Req 4.1 的证据链：`select` → `approval/policy` 事件 → `effectivePolicy` → `decide` 返回值）。**session 日志载体（第五/八轮终审复核）**：日志对象是**真实官方 `Session`**（`@deepseek-ai/dsh-session` 的 `Session.create(id)`，与仓库既有 durable 测试同构造）；唯一替身是「派发跳」——无 store 挂载的 session 其 `append` 不自行到达 `session/event`，由 harness 转发（Task 6.1 原文即如此描述）。**可导入性实测与依赖归属（如实登记）**：六个官方包（`dsh-user-approval`、`dsh-sandbox-policy`、`dsh-permission-presets`、`dsh-session`、`dsh-settings`、`dsh-session-projection`）在当前环境均可直接 `import`（版本均为 `0.1.0-rc.6`），但**可导入的原因是环境 `node_modules` 携带整套官方 rc.6 组件**，不是本仓库的依赖声明：根 `package.json` 的 peerDependencies 仅含 `dsh-user-approval`/`dsh-session`/`dsh-settings`（`dsh-session-projection` 只在 `packages/session-title/package.json` 声明，`dsh-permission-presets`/`dsh-sandbox-policy` 未被任何包声明）；仓库既有测试同样按该环境假设直接 import 官方组件（如 `@deepseek-ai/dsh-agent-loop`、`@deepseek-ai/dsh-llm`）。**因此证据链的选型按依赖归属取舍**：真实审批判定证据只用**已声明依赖**——真实 `@deepseek-ai/dsh-user-approval` 的 `ApprovalService`/`effectiveApprovalPolicy` 读取**真实 `@deepseek-ai/dsh-session` 的 `Session`** 日志（`Session.create`）；`permissionPresets` 服务与 `sessionProjections` 读数用**探针形状忠实替身**（与 plan-mode 线对 `dsh-plan-mode` 的处理一致——那条线同样未 import 官方包而是按 P1 语义构造替身；`installSettingsSection` 因需挂官方 settings 服务而保持桩面，且本 feature 不消费 settings 面）；若环境已携带真实 `dsh-permission-presets`，Stage 4 可在附加用例中直接使用而不作为必需前提。
- **P5 白名单现状**：`services.permissionPresets` 现存成员仅 `current`/`resolve`/`optionOf`（`lib/official-service-definitions.js:125-132` + `lib/services.js` 纯直通声明 + registry `servicesWhitelist`）；本 feature 不回流任何写成员（Req 10.1）。`services.sessionProjections` 白名单已含 `snapshot`。
- **P6 门面 sessions 子面接线落点**（**以已交付的 `sessions.planMode` 实现为准，不照抄任务书原文字**）：子面经 `_assignFeature(name)` 内联分支（`createFeatureSlot({ active, feature, api, methods, isCurrent })`）发布；`_unmountFeature` 回退；`_readSlot`/`_disabledSurfaceFor` 必须同步补映射（`_restoreDisabledSurface` 事务回滚路径的唯一依赖）；`KNOWN_FEATURES` 增键。**已交付先例的两处「未采用」必须遵守**：(i) **不**给 `composeSessionApi` 增静态子面参数、**不**把 `sessions.permissionPresets` 加入 `_decoratedNamespaces([...])` 名单——plan-mode 线执行注第 1 条（`docs/specs/session-plan-mode-control/tasks.md`「Stage 4 执行注」偏离 1）记录：静态合成会把 caller-bound owner 归因钉死在门面自身；(ii) 子面改为 sessions getter 内**按访问合成**（`surfaceFor(callerCtx)` + per-caller WeakMap 缓存），**且 getter 必须是 method 风格**（`get() {}`）才能取得调用方 shadow 上下文（该线第四轮阻塞终审：箭头 getter 下 owner 派生失效，回归测试 `test/sessions-plan-mode-caller-binding.test.mjs`）；命名空间在任何状态下都存在（inert core 回退到 typed disabled 面，plan-mode 线**第三轮第 2 条**口径，非第四/八轮）。
- **P7 owner 派生与 caller fiber**：既有 `deriveAdapterRegistrationOwner(callerCtx)`（`lib/llm-adapter-registration.js`，按 `callerCtx.fiber` 在 `loader.entries()` 中匹配，回退 `fiber.name`），plan-mode 线与 `agents.scopes`/`llm.adapters` 同源；不可归因 → typed `denied`（fail-closed），caller 自报 owner 一律不接受。
- **P8 目标存活判定**：与 plan-mode 线同源——`ctx.get('sessions').get(sessionId)` 在场性为**唯一**事实源（三态：在场 / 已消失 / 不可核验），`session/disposed` 为通知源。session 参数语义以官方 `set(session, name)` 为准：**接受官方 session 句柄**（`{ id, events, seq }`），不是 agent handle（与 plan-mode 线 `agent` 目标语义不同，须在成员文档写清）。
- **P9 既有精确列表断言的同步点（非穷尽，Stage 4 以 `npm test` 全量失败为准逐一收敛）**：`test/host-cutover.test.mjs`（`capabilities.list({ prefix: 'sessions.' })`）、`test/index-session.test.mjs`、`test/index-agent.test.mjs`、`test/index-profile.test.mjs`、`test/index.test.mjs`（feature registry 快照与总数，当前 38）、`test/index-session-durable.test.mjs`、`test/index-tools.test.mjs`、`test/index-events.test.mjs`、`test/index-system-prompt.test.mjs`、`test/index-remote.test.mjs`、`test/index-diagnostics.test.mjs`、`test/official-passthrough-independence.test.mjs`、`test/security-policy-assembly.test.mjs`。新增 feature 的尾部位置取 `sessionPlanMode` 之后、`sessionInteraction` 之前（与 plan-mode 同域就近），总数 38 → 39。

## Task 1: permission-preset 核心模块（对应 Req 1、2、6、7）

**产出**：`lib/sessions-permission-presets.js`（纯函数模块，零 harness 依赖可测）+ 单元测试 `test/sessions-permission-presets.test.mjs`。

- [x] 1.1 结果映射（Req 2.1、2.4、6.2；design C3 表）：`mapSelectOutcome({ before, after, requested, appliedAt })` 全表实现——`before !== requested && after === requested` → `{ ok:true, code:'committed', commitState:'success', preset, appliedAt }`；`before === requested` → `{ ok:false, code:'unchanged', reason:'preset already effective', preset }`（**无 commitState**）；`after !== requested` → `{ ok:false, code:'not-applied', reason }`（官方状态不能证实变更）；返回全部冻结，字段集**恰为** design Data Models 的 `{ ok, code, reason?, commitState?, preset?, appliedAt? }`。
- [x] 1.2 参数与前置拒绝（Req 2.3、3.1）；拒绝码与 design C3 一致：非字符串 `name` / 缺 session → `invalid-input`；`name === 'custom'` → `invalid-preset`；非官方选项（在官方 `names` 之外）→ `unknown-preset`；服务不可用 → `unavailable`；owner 不可归因 → `denied`；目标缺失/已关闭/不可核验 → `invalid-target`（不可核验时按 plan-mode 线口径取 `unavailable`）；**全部在任何副作用之前返回**，官方状态不变，**不静默回退默认预设**。
- [x] 1.3 读面视图（Req 1.1–1.3）：`presetView(session, official)` → 冻结 `{ target, preset, observedAt, source:'official' }`；`optionsView(session, snapshot)` → 冻结 `{ target, options, currentValue, observedAt, source }`（`options` 深冻结，每项 `{ value, name, description? }` 原样透传官方，**不增删改名**；`description` 经 bounded/脱敏防御）；投影缺位 → `{ target, options: [], currentValue: null, observedAt, source:'degraded', reason }`（`target` 恒在场，**不伪造选项**）；官方抛错/服务缺失 → typed `degraded`/`unavailable` 视图，不抛穿。**形状与 design 的对齐**：`options` 视图的 `source`（乃至降级 reason）为 design C2「投影缺位/降级 → typed degraded」的机器可读承载，design Data Models 原表未列——Task 6.8 一并把 `options 视图 { target, options, currentValue, observedAt, source }` 与 `reason?` 语义回写 design 并登记。
- [x] 1.4 观察 cell 与去重（Req 5）：**去重粒度 = 每个 observe handle 各自持有 `lastDelivered`**；投递前经官方 `current` + `options` 重读核验；投递快照深冻结 `{ target, preset, options, currentValue, observedAt }`；`preset` 或 `currentValue`/`options` 任一变化即投递；同 target 多 handle 互不抑制。
- [x] 1.5 订阅者 containment 与 dispose（Req 5.2）：监听者 throw/rejection 只降级该监听者（bounded 诊断）；`dispose()` 幂等；stale disposer 不影响其他订阅者；dispose 后到达的事件不投递；不可解析身份的 session → unbound handle（`current()` 返回诚实读视图、`subscribe` no-op，plan-mode 线第八轮口径）。
- [x] 1.6 epoch 语义（api-idioms §2；plan-mode 线同构）：feature 持有 hub epoch；handle 创建时捕获；hub 换代后旧 handle 的 `current()`/`subscribe()` 返回 typed stale/unavailable，绝不复用旧投递状态。
- [x] 1.7 目标存活三态（Req 3.1；P8）：`resolveTargetPresence(sessionId)` → `true|false|null`；`false` 即时退休 handle（`closed` + 清空监听者）并**停止投递**；`null` 只跳过本次投递并置 degraded（**绝不推断关闭**）；`true` 才投递。
- [x] 1.8 边界断言（Req 9）：模块不注册任何 prompt section / hook、不 append/emit 任何 session 事件（仅官方 seam 写日志）、不读不写 approval/security/planMode 面；以「零注册、零事件、零跨域调用」断言承载（模块层 + e2e 层各一）。
- [x] 1.9 测试：结果映射全表 + 前置拒绝矩阵 + 读视图/选项视图形状与冻结 + 选项透传不增删 + 投影缺位降级 + 去重与 per-handle 独立 + 监听者隔离 + dispose 幂等/stale + epoch 换代 + 三态在场性（含 store 恢复续投）+ 零注册零事件零跨域。

## Task 2: 门面接入 `sessions.permissionPresets`（对应 Req 1、3、8）

**产出**：`lib/sessions-permission-presets-facade.js` / `lib/plugin-api-service.js` / `lib/index.js` / `lib/guards.js` 接线 + surface 测试。

- [x] 2.1 命名空间放置（design「Namespace 放置」；P6）：`sessions.permissionPresets` 作为 sessions 域子面——`_assignFeature('sessionPermissionPresets')` 分支（成员形状校验 `surfaceFor`/`availability`）→ `this._sessionPermissionPresetsSlot` + surface + `_publishSessionApi()`；`_unmountFeature` 回退（清 slot + `createDisabledSessionPermissionPresetsApi(this._active)` + 重发布）；`_readSlot`/`_disabledSurfaceFor` 映射（回滚路径唯一依赖）；`KNOWN_FEATURES` 增 `sessionPermissionPresets`；sessions getter（**method 风格**）按访问合成该子面（`surfaceFor(callerCtx)` + per-caller WeakMap 缓存）；**namespace 始终存在**，inert core 下回退到 typed disabled 面（plan-mode 线**第三轮第 2 条**口径）。
  - **未挂载态的呈现**：disabled 面**返回** typed 结果而不抛——`current` → 带 reason 的 degraded view、`options` → `{ target: null, options: [], currentValue: null, observedAt: null, source:'unavailable', reason }`（与 live/降级视图同形，**不省略任何声明字段**）、`select` → `{ ok:false, code:'unavailable', reason }`、`observe` → dead handle（`current()` 带 reason、`subscribe` 立即以该视图回调一次并返回 no-op disposer、`dispose()` 幂等返回 false）、`availability()` → `{ status:'unavailable', reason }`；**唯一抛错路径是核心 inactive**（`PluginApiInactiveError`，availability 除外——Req 8.1「永不抛错」，plan-mode 线第二轮终审口径）。
  - **内部 feature key 命名**：`sessionPermissionPresets`（与 `sessionPlanMode`/`sessionActivity` 词表一致，不带治理后缀）。
- [x] 2.2 写面 `select(session, name)`（Req 2、3、6；design C3 三步）：单同步跨度，**前置检查顺序严格按 design C3 声明**：请求参数（`name` 非字符串 / session 缺位 → `invalid-input`）→ availability（服务不可用 → `unavailable`）→ owner 归因（不可归因 → `denied`）→ 目标（三态在场性：已消失/畸形 → `invalid-target`，不可核验 → `unavailable`）→ 预设名（`custom` → `invalid-preset`；在官方 `names` 之外 → `unknown-preset`）→ 审计 attempt → 官方 `set(session, name)` → **官方读回**（`before`/`after` 两次 `current`）→ 结果映射；任何拒绝都记审计（plan-mode 线第一轮终审口径）；官方抛错 → typed `internal`（不抛穿）。多前置同时失败时的结果码由该声明顺序唯一决定，并有用例固化。
- [x] 2.3 查询面 `current(session)`/`options(session)`（Req 1）：转发官方 `current(session.events)` 与 `sessionProjections.snapshot(session).values.permissions`（P2），冻结视图；投影缺失只降级 `options`（`select`/`current` 不受影响，design C1/C4）。
- [x] 2.4 availability（Req 8.1、8.2）：冻结 `{ status:'active'|'degraded'|'unavailable', reason? }`——active = 官方服务在场且 `current`/`set` 形状完整；**degraded = 读/观基底部分降级且写面仍可用**，列举且仅列举两种成因：(i) 投影读载体缺失（`options` 降级、`select`/`current` 可用）；(ii) 观察通道不可用（`session/event` 订阅建立失败或事实流缺失，`select`/`current`/`options` 仍可用）；unavailable = 服务缺失/错配；**永不抛错**；`sessions.availability()` 的 reason 层叠纳入本面降级（plan-mode 线先例）。**(ii) 为 design C1 未列出的成因**（design 只把 availability 输入限定为服务与投影载体），Task 6.8 一并回写 design C1 的 availability 输入定义并登记。
- [x] 2.5 fail-safe 挂载（AGENTS §2.6）：`lib/guards.js` 新增 `else if (featureName === 'sessionPermissionPresets')` 分支——探 `ctx.get('permissionPresets')` 的 `current`/`set` 成员形状与 `ctx.on`；任何挂载异常只记日志并停用，绝不抛穿 apply；运行期服务消失 → typed unavailable，不影响主门面与无关能力。
- [x] 2.6 authority closure（Req 10.1）：不向 `services.permissionPresets` 白名单回流 `set`/`selectFor`；门面不拦截官方 `/permission` 命令与官方 native 路径（Req 10.3）；settings `permission.defaultPreset` 不读不写（design Authority Closure 表）。
- [x] 2.7 测试：surface 形状 / 未挂载 typed 降级 / inert core 成员在场且 availability 不抛 / 无关能力隔离 / 白名单无写成员回归 / `sessions.availability()` reason 层叠 / caller-bound 子面（真实 cordis：两个调用方各自子面 + owner 归因，参照 `test/sessions-plan-mode-caller-binding.test.mjs`）。

## Task 3: 观察面 `observe(session)`（对应 Req 4、5）

**产出**：`lib/sessions-permission-presets-facade.js` 内 firehose 订阅接线 + 测试。

- [x] 3.1 firehose 订阅（design C4；P3）：feature 挂载时建立**单条** `ctx.on('session/event', (session, event) => …)` 订阅（facade 级共享，cleanup owner = feature disposer）；按 session 匹配已绑定 target → 官方 `current` + `options` 重读 → 逐 handle 比对 `lastDelivered` → 变化才投递；订阅失败 → availability `degraded`，读/写面不受影响（Req 5.3）。
- [x] 3.2 生命周期订阅：自建 `ctx.on('session/disposed', (session) => …)`，把已绑定 target 的 handle 置 degraded/closed 并**停止投递**（close 事实不投递，plan-mode 线第一轮终审口径），`current()` 返回带 reason 的 degraded 视图。
- [x] 3.3 官方路径可达（Req 4.2）：直调官方 `set`、官方 `/permission` 语义（`apply` + `approval.setPolicy`）、knob 直写（`sandbox/mode`/`approval/policy`）三种来源的变更都经 firehose 到达订阅者（P3/P4）。
- [x] 3.4 observe handle（Req 5.1；api-idioms §3.1）：`observe(session)` → target 绑定 handle `{ current(), subscribe(listener), dispose(), epoch }`（**无 idiom 例外**）；`current()` 返回该目标的读视图（与 `current` 同形，每次调用经官方重读核验——plan-mode 线第七轮口径）；**design C4 原写「最新投递视图」，须按 Task 6.8(f) 同步修订并登记**；跨目标各自建 handle。
- [x] 3.5 测试：官方路径变更到达订阅者 / 三事件类型各自触发 / 无变化不投递 / 同 target 两 handle 互不抑制 / 回调 throw 隔离 / stale disposer 隔离 / epoch 换代 / session 关闭降级 / **订阅建立失败（`ctx.on` 抛错）时 `availability()` 记 `degraded` 且读/写面不受影响** / feature 卸载清理。

## Task 4: 审计与可追溯（对应 Req 7）

**产出**：模块内有界审计环 + 测试。

- [x] 4.1 载体（design C6；durable-state-and-scope §1–2）：feature-authority 内部有界内存环（容量 512、非 durable、不新增/不跨存储档位），记录字段 `{ seq, at, ownerId, action: 'permission-preset.select', target, preset, outcome, reason? }`（`reason` bounded ≤240——与 plan-mode 线一致，**design C6/Data Models 的 `reason?` 修订随 Task 6.8 回写登记**）；不含 payload/owner 私有状态。
- [x] 4.2 记录时机（Req 7.1）：**触达官方 seam 的尝试与提交前拒绝都记录**（拒绝也记 outcome 与 bounded reason）；写失败 → `gapSince` + bounded 日志，官方效果保留（**不回滚官方提交**），不伪造记录（Req 7.2）。
- [x] 4.3 owner 归因（Req 7.1、3.4）：owner 由 caller fiber 派生；caller 自报 owner 一律不接受；不可归因 → typed `denied` 且不产生未归因提交记录。
- [x] 4.4 测试：记录形状与 bounded / 拒绝也记录 / 环溢出丢弃最旧并置 truncated / 写失败 gap 标记与效果保留 / owner 不可伪造 / 无 payload 泄漏（含超长 preset/target 的截断）。

## Task 5: capability、availability 与登记（对应 Req 8.3、11.5）

- [x] 5.1 运行时 capability：`lib/capability-descriptors.js` 增 `entry('sessions.permissionPresets', 'mutate', ['sessionPermissionPresets'])`（effect 取 `mutate`：承载 `select` 写成员，先例 `sessions.planMode`/`attention`）；`lib/capability-matrix.js` 增同名 cluster 行；`lib/namespace-availability.js` 的 `HOST_NAMESPACE_RECORDS` 增 `'sessions.permissionPresets'`（`{ path: 'permissionPresets', capabilityPath: 'sessions.permissionPresets' }`）。**覆盖边界（登记在案）**：descriptor 输入来自挂载期 guard；运行期官方服务消失由成员自身 typed 结果呈现。
- [x] 5.2 canonical registry 新增行（design「Registry 拟新增行」六条）：
  - 六条行：`sessions.permissionPresets.current`（projection/read/pure/not-applicable）、`.options`（projection/read/pure）、`.select`（mutation/mutate/**coordinated**/**compare-and-swap**）、`.observe`（projection/**subscribe**/**additive**）、`.observe.handle`（projection/read/**additive**——handle 承载 `subscribe(listener)`，与 `sessions.activity.observe.handle`/`sessions.planMode.observe.handle` 先例一致）、`.availability`（selfDescription/read/pure；**scope 取 `facade`**、authority 取域 authority「official permission-presets authority」——与仓库 39 条 `*.availability` 行的主流惯例一致，见 plan-mode 线全局终审第一轮第 5 条 / 第二轮第 5 条）。
  - 每行携带完整字段集（未适用字段显式 `null`）、`failureSemantics: 'discriminated-result'`、`migrationAction: null`（新成员）、`capability: 'sessions.permissionPresets'`、`status: 'advanced'`（与同域 `sessions.planMode.*` 五行（`get`/`select`/`observe`/`observe.handle`/`availability`）及 registry 全部 mutation 行一致；projection 行在 registry 中同时存在 `advanced` 与 `recommended` 两档——`recommended` 对非 read 成员须声明 `bypasses`，本 feature 不取）、`authority: 'official permission-presets authority'`（availability 行同域 authority）。
  - `capabilityMatrix` 增同名 cluster 行：`status: 'retained'`（能力守恒词表）、`currentPaths`/`targetPaths` **不含** `observe.handle`（对齐 `sessions.activity`/`sessions.planMode` 口径）、`affectedConsumers` 填已登记相关线（`interactive-session-access`；如 Stage 4 发现更准确集合按实际更新并说明）、`verification: ['registry-draft','capability-matrix']`。
  - `namespaces` 增 `sessions.permissionPresets` 导航记录（`runtime: 'host'`、`capabilityPath`、`contributingFeatures: ['session-permission-preset-control']`、`availabilityMember: 'sessions.permissionPresets.availability'`、`availabilityExemption: null`）。
  - `eventCatalog` 不新增事件（复用 `session/event`）；`servicesWhitelist` 的 `permissionPresets` 条目**不变**（不回流写成员）；validator 全绿。
  - **design 表修订登记（承 plan-mode 线先例）**：本 tasks 对两行取与仓库惯例/已交付先例一致的值，**design「Registry 拟新增行」表须同步修订并登记**（否则 registry 与 design 直接冲突）：(i) `sessions.permissionPresets.observe.handle` 的 composition 取 **`additive`**——handle 承载 `subscribe(listener)`，`composition-and-authority.md` §4 的 `pure` 强定义禁止注册 listener，先例 `sessions.activity.observe.handle`/`sessions.planMode.observe.handle` 均为 `additive`（design 原表写 `pure`）；(ii) `sessions.permissionPresets.availability` 的 scope 取 **`facade`**、authority 取域 authority **`official permission-presets authority`**——与仓库 39 条 `*.availability` 行的主流惯例（scope 分布 facade 30 / session 4 / profile 3 / workspace 2）及 `sessions.planMode.availability` 先例一致（该判定与精确统计登记于 plan-mode 线**全局终审第一轮第 5 条**与**第二轮第 5 条**）（design 原表写 `session` + `facade`）。两处修订在交付报告与 tasks 执行注中逐条登记，不改写任何已交付的验收边界。
- [x] 5.3 文档同步：`docs/specs/plugin-api-features/feature-list.md` §7 追加交付条目（含 host-only 六问记录、与 planMode/interactive 的分工交叉引用、官方 `/permission` 与 settings `defaultPreset` 两条相邻路径的 authority 边界说明）；`README.md` 的 M10 域小节追加 `sessions.permissionPresets`（AGENTS §8 文档同步面）。
- [x] 5.4 测试：capability/availability 镜像一致（registry validator + capability 测试 + namespace availability 测试）+ P9 精确列表断言同步（38 → 39）。

## Task 6: 端到端验收与迁移证据（对应 Req 4.1、11.1–11.4）

**产出**：`test/sessions-permission-presets-e2e.test.mjs` + 共享基座 `test/session-permission-presets-test-kit.mjs` + `test/session-permission-presets-migration-slices.test.mjs`。

- [x] 6.1 e2e 基座（按 P4 的依赖归属取舍；**settings 面见执行注偏离 1**）：在真实 `@deepseek-ai/cordis` 树上装配**已声明依赖的真实官方组件**——`@deepseek-ai/dsh-user-approval` 的 `ApprovalService`（真实审批判定链；审批判定证据即由此承载）与 `@deepseek-ai/dsh-session` 的 `Session`（真实日志对象，`Session.create(id)`；harness 只转发 append → `session/event` 的派发跳）；settings 面为桩（`installSettingsSection` 须挂官方 settings 服务，本 feature 不消费）；`permissionPresets` 服务与 `sessionProjections.snapshot` 用**探针形状忠实替身**（严格按 P1/P2 语义：`set`→`apply` 三段 append、`resolve` 抛错、`current` fold+derive、`names`/`optionOf`/`selectFor`、`custom` 派生态；`snapshot` → `{ asOfSeq, values: { permissions } }`）；门面经 `apply(ctx)` 挂载，全部场景走公共入口。降级场景（服务缺席、投影缺失、成员形状不符）用替身并标注。**Req 4.1 的真实审批判定证据不得用自写判定逻辑代替**（见 6.3）。
- [x] 6.2 结果与读回（Req 11.1）：committed/unchanged/not-applied/unknown-preset/invalid-preset/invalid-target/invalid-input/denied/unavailable/internal 全码 / 前置拒绝状态不变 / committed 后官方 `current` 与门面读面一致 / 审计内容。
- [x] 6.3 观察与一致性（Req 4.1、4.2、11.2）：官方路径（直调官方 `set`、官方 `/permission` 语义路径、knob 直写）变更到达订阅者 / 回调 containment / stale disposer 隔离 / **真实审批判定证据（真实 `ApprovalService` 实例，禁用自写判定逻辑）**：在真实官方链上，`select` 到 approval 为 `never` 的预设（默认表 `danger-full-access`）后，调用**真实 `ApprovalService` 的 `decide(req, session)`** 必须返回 `'rejected'` 且不派发 `approval/request` waterfall；切回 approval 为 `ask` 的预设（默认表 `workspace-write`）后同一调用必须派发 waterfall（以真实 `approval/request` 监听器是否被调用来判定）。另断言 `effectivePolicy(session)` 的官方返回值随选择变化 —— 即「至少一个真实审批判定随所选预设变化」由官方判定链自身承载（P4），门面不模拟审批、不代答。
- [x] 6.4 组合（Req 11.3）：两个独立 plugin tree（共享官方 seam、反向注册顺序）的确定性仲裁 / owner 派生与不可归因 → `denied` / 重复选择幂等（unchanged 不计第二次选择、不产第二次事件）/ 低信任上下文（不可归因）被拒且官方状态不变 / 与 `sessions.planMode` 正交（select 前后 plan mode 状态零变化，反之亦然）。
- [x] 6.5 降级（Req 11.4）：官方服务缺席 / `set` 成员缺失 / 投影载体缺失（`options` degraded 而 `select` 可用）/ **观察通道不可用（订阅失败 → availability `degraded`，读/写面不受影响）** → feature 降级、typed unavailable、availability 诚实、无关能力（`sessions.activity`、`tools`、`sessions.planMode` 等）不受牵连；审计写失败 gap 标记。
- [x] 6.6 正交与不反写（Req 9.2、9.3）：`select` 前后 mock 的 approval 授权面（`approval/request` 派发）、security policy 注册面、plan mode 面**零调用/状态不变**（跨域探针，plan-mode 线 `probeCrossDomain` 先例）；门面**未注册任何 prompt section / hook**、**未 append/emit 任何非官方 knob 事件**；门面不评估预设内部规则（不调用 `derive`、不重排选项）。
- [x] 6.7 迁移 slices（外部仓库不在工作区，沿用既有切片模式）：A——设置面板/TUI 的预设切换（原：直接 `services.permissionPresets` 裸 setter 或直调官方 `set`；迁：`sessions.permissionPresets.options` 渲染选项 + `select` 提交 + `observe` 驱动徽标）；B——编排/自动化消费者按预设约束自身行为（原：读官方投影或私有状态；迁：`current`/`options` 读取 + `observe` 订阅）。
- [x] 6.8 design 回写（逐项登记）：(a) P1–P4 的 Stage 4 运行结论；(b) `options` 视图补 `source`（与降级 `reason`）字段、审计记录补 `reason?` 字段——写入 design C2/C6 与 Data Models；(c) registry「拟新增行」表的 `observe.handle` composition → `additive`、`availability` 行 scope/authority → `facade` / `official permission-presets authority`；(d) design C1 的 availability 输入定义补入「观察通道不可用 → degraded」这一成因（与 design C1「degraded = 读载体缺失」并列为两种 degraded 成因）；(e) `select` 前置检查顺序若实现中发现需调整，同步回 design C3 正文（当前已按设计顺序落地）；(f) **design C4 的 `current()` 语义**由「最新投递视图」改为「该 handle 目标的读视图（与 `current` 同形，每次调用经官方重读核验）」——与 Task 1.5/3.2/3.4 的 unbound/closed 诚实视图要求及 `api-idioms.md` §3.1 只读视图口径一致，先例见 plan-mode 线同项修订（`session-plan-mode-control` 的 design C4「Stage 4 修订」注与其 tasks.md 全局终审第七轮处置第 3 条）。所有修订在交付报告与执行注中列出；如 Stage 4 实测发现官方 seam 行为与探针记录不符，先修 spec 再改实现。

## Task 7: 全量验证、全局终审与提交

- [x] 7.1 `npm test`（4G 护栏）全绿；治理 token 审计不新增泄漏（含 `Req N`/`Task N` 形态的自觉避免）；client bundle `--check` 一致（host-only，预期无 client 产物变化）。
- [x] 7.2 全局终审（阻塞式、只读，`run_in_background: false`）：只审整体交付与 Tasks/Design/Requirements 一致性 + `docs/standards/` 适用分册；返回「无偏差」后才可进入 7.3；有意见则集中修订并再次派审（不退回逐任务审查）。
- [x] 7.3 `git diff --check` 干净；终审通过后按阶段提交规则提交本 Stage 4 交付并完成最终登记（feature-list §7、README、registry、tasks 状态行与执行注）。

## 执行边界

- 版本冻结：不步进任何版本字段（AGENTS §3.0.1）。
- 不新增 R 包、不替换/禁用官方行、不 patch 官方包、不重写官方 permission-presets 组件；门面不自维护第二份 preset 状态（事实源 = 官方 session 日志 + 官方投影）。
- 不提供 approval 授权、不注册 security policy、不提供跨域 setter（各归 owner，Req 9.2）；不新增公共 client 半面（host-only）。
- 入口与运行期 fail-safe：挂载失败只记日志并停用；成员一律 typed 结果，绝不抛穿 apply/dispatch；availability 永不抛错。
- v1 无公共审计查询成员（克制设计）；审计经 feature 内部测试缝验证，不新增公共面。

## Stage 3 对抗性审查记录（第一轮）

结论「有意见」七条，逐条处置：

1. **（高）registry 两行与 design 表相斥**（`observe.handle` composition、`availability` scope/authority）→ 采纳 tasks 侧取值（仓库惯例与已交付先例：`sessions.activity`/`sessions.planMode` 的 `observe.handle` 为 `additive`；39 条 `*.availability` 行以 `scope: facade` + 域 authority 为主流），并在 Task 5.2 增加**design 表修订登记**条款、Task 6.8 列为回写项 (c)——registry 落地前先修 design，避免制品间直接冲突。
2. **（中）P6 引用了 plan-mode 线「未采用」的接线点** → P6 重写：明确**不**给 `composeSessionApi` 增静态参数、**不**把本子面加入 `_decoratedNamespaces` 名单（引 plan-mode 执行注偏离 1 的理由），子面改为 getter 内按访问合成 + method 风格 getter（引该线第四轮阻塞终审与其真实 cordis 回归）；并修正轮次引用（inert-core 回退 = 第三轮第 2 条）。
3. **（中）视图/审计字段集与 design Data Models 不等** → `options` 视图的 `source` 与降级 `reason` 作为 design C2「typed degraded」的机器可读承载予以保留，降级视图补回 `target`；审计 `reason?`（与 plan-mode 线一致）保留；两者均登记为 design 修订（Task 1.3/4.1/6.8）。
4. **（中）Req 4.1 的真实审批判定证据不得用自写 mock** → 实测六个官方包在本仓库可直接 import；Task 6.1 改为在真实 cordis 树上装配官方 `PermissionPresetService`/`ApprovalService`/`Session`/`SessionProjectionRegistry`/`SettingsProvider`，Task 6.3 改为**调用真实 `ApprovalService.decide`** 取证（`never` → `'rejected'` 不派发 waterfall；`ask` → 派发），自写模拟被显式禁用。
5. **（低）P1 行号错位** → 依源码修正：`names` 183–185、`selectFor` 222–228、`resolve` 235–239、`optionOf` 247–259（原文 optionOf/selectFor 互换、names/apply 起点偏移）。
6. **（低）P4 行号超界** → 修正为 `decide` 185–202、`effectivePolicy` 168–170、`overrideOf` 176–178，并补记 `signal?.aborted → 'cancelled'` 分支在 `never` 判定之前。
7. **（低）`select` 前置顺序与 design C3 不一致** → Task 2.2 改为严格按 design C3 顺序（参数 → availability → owner → 目标 → 预设名），并要求用例固化多前置同时失败时的结果码。

修订后：探针 P1–P9 的事实性经审查方独立复核（除上述行号外全部相符）；分册对照除意见 1/3 所涉字段外均符合，两处字段差异已转为已登记的 design 修订项。

### 第二轮（复审）意见与处置

复审确认第一轮 7 条中 6 条完全闭合（含行号独立核对、registry 取值与先例核对、P6 接线口径核对、官方判定链事实核对），另指出 1 条中等与 3 条低度问题，均已就地修订：

1. **（中）availability 的 degraded 成因在 tasks 内部与 tasks↔design 之间冲突** → Task 2.4 改为穷尽式两成因定义（(i) 投影读载体缺失；(ii) 观察通道不可用），与 Task 3.1 的「订阅失败 → degraded」一致；并把 design C1 的 availability 输入定义扩展登记为 Task 6.8 回写项 (d)；Task 3.5/6.5 补订阅失败场景用例。
2. **（低）Task 2.1 的轮次引用与 P6 冲突** → 统一为「plan-mode 线第三轮第 2 条」（inert-core 回退），删除「第四/八轮」误引。
3. **（低）未挂载态 `options` 形状缺 `target`/`observedAt`** → disabled 面 `options` 补全为 `{ target: null, options: [], currentValue: null, observedAt: null, source:'unavailable', reason }`，与 live/降级视图及 Task 1.3「target 恒在场」一致（对齐 plan-mode 已交付 disabled 面的全形状先例）。
4. **（低）P4 的依赖机制表述不实** → 更正为「环境 `node_modules` 携带整套官方 rc.6 组件，非本仓库依赖声明」，并据此调整证据链选型：真实审批链只用**已声明依赖**（真实 `dsh-user-approval` + 真实 `dsh-session` 的 `Session`；`dsh-settings` 需官方 settings 服务故为桩面），`permissionPresets` 与 `sessionProjections` 用探针形状忠实替身（与 plan-mode 线处理一致）；Task 6.1/6.3 同步改写，并允许在环境携带真实 `dsh-permission-presets` 时附加使用而不作为验收前提。**（第八轮更正**：本处原写「真实 `dsh-session` 日志」，但交付基座当时用的是本地日志对象；第八轮已改为真实 `Session`。）

### 第三轮意见与处置

第三轮确认第二轮 4 条全部实质闭合（availability 两成因定义与 design 修订登记、轮次引用统一、disabled `options` 全形状、依赖归属与证据链选型），另指出 2 条问题，均已就地修订：

1. **（中）observe handle `current()` 语义在 design C4 与 tasks 之间冲突** → design C4 原写「最新投递视图」，与 Task 1.5（unbound handle 诚实读视图）、Task 3.2（关闭后 degraded）、Task 3.4（读视图 + 官方重读核验）及 `api-idioms.md` §3.1 冲突；新增 Task 6.8 回写项 (f) 把 design C4 同步为读视图语义（先例：plan-mode 线同项修订），Task 3.4 同时标注该修订义务。
2. **（低）状态行未记录第二轮审查** → 状态行改为按轮次完整记录（7 条 → 4 条 → 2 条），与仓库 Stage 3 制品状态行惯例一致。

### 第四轮意见与处置

第四轮确认第三轮 2 条闭合、Task 6.8 回写清单与文末处置一一对应，另指出 3 条低度事实性引用/表述问题，均已就地修订：

1. **（低）plan-mode 轮次引用错误** → availability 行修订的登记轮次更正为「全局终审第一轮第 5 条 / 第二轮第 5 条」（第五轮仅含治理编号与 feature-list 两项）。
2. **（低）状态行「通过」门槛未成立** → 三轮结论均为「有意见」，状态行改为如实的在途表述（处于审查门中、尚未取得「无偏差」，后续轮次结论随派审追加）。
3. **（低）`status: 'advanced'` 的论据不实** → 更正为「与同域 `sessions.planMode.*` 五行（`get`/`select`/`observe`/`observe.handle`/`availability`）及全部 mutation 行一致；projection 行存在 advanced/recommended 两档，本 feature 不取 `recommended`（非 read 成员需 `bypasses`）」；第五轮又发现该处计数仍为旧值「六行」，已一并更正（见第五轮处置第 2 条）。

### 第五轮意见与处置

第五轮确认第四轮 (b) 闭合、全文终检未发现其他实质偏差（覆盖完整性、任务依赖、测试与迁移验收、fail-safe 与版本冻结、治理纪律均符合），另指出 3 条低度计数/引用残留，均已就地修订：

1. **（低）availability 的 plan-mode 轮次引用只改到一处** → 第 77 行残留的「第五轮终审口径」改为「全局终审第一轮第 5 条 / 第二轮第 5 条」，与本文件第 82 行及 plan-mode 记录一致。
2. **（低）`status: 'advanced'` 论据中的 planMode 行数不实** → 「六行」更正为五行（`get`/`select`/`observe`/`observe.handle`/`availability`），与 registry 实际及 plan-mode 自身登记一致。
3. **（低）P1 `resolve` 行号与官方源码/design 证据表不符** → 更正为 `resolve(name)` 235–239（240–246 为 `optionOf` 的 jsdoc），第一轮处置记录内的同一错值同步更正。

### 第六轮意见与处置

第六轮确认第五轮 3 条闭合、全文终检未发现其他偏差，另指出 1 条低度残留：第四轮处置记录内仍写「六行」（与 Task 5.2 主文的「五行」及 registry 实际不一致）→ 已同步更正为五行，并把该同步更正登记进第四轮记录，保持制品内同一论据的计数一致。

## Stage 4 执行注（2026-09-13）

**交付物**：`lib/sessions-permission-presets.js`（核心：结果映射、读/选项视图、观察 cell、三态在场性、审计环、epoch）、`lib/sessions-permission-presets-facade.js`（挂载与 caller-bound 子面）、`lib/index.js`（FEATURE_MOUNTERS 接线）、`lib/guards.js`（`sessionPermissionPresets` guard 分支）、`lib/plugin-api-service.js`（disabled 面工厂、sessions getter 的**双子面**按访问合成（method getter，plan-mode 与 permission-presets 共用同一段逻辑）、`_assignFeature`/`_readSlot`/`_disabledSurfaceFor`/`_unmountFeature` 分支、availability 层叠、`KNOWN_FEATURES`）、`lib/capability-descriptors.js`/`lib/capability-matrix.js`/`lib/namespace-availability.js`（运行时登记镜像）、canonical registry 六条成员行 + `namespaces` 导航记录 + `capabilityMatrix` cluster 行、`README.md` 与 feature-list §7 条目、design 修订登记（C1/C2/C4/C6 + Registry 表两行）；测试 `test/sessions-permission-presets.test.mjs`、`test/sessions-permission-presets-e2e.test.mjs`、`test/session-permission-presets-migration-slices.test.mjs`、`test/sessions-permission-presets-caller-binding.test.mjs`，共享基座 `test/session-permission-presets-test-kit.mjs`。

**与 Task 文字的偏离（逐条登记理由）**：

1. **e2e 基座：真实 cordis 树 + 真实官方 `ApprovalService` 与真实 `Session`；`permissionPresets`/`sessionProjections` 替身 + settings 桩面**（Task 6.1 的依赖归属取舍；第七/八轮终审意见登记）：`@deepseek-ai/dsh-user-approval`（已声明 peerDependency）以真实实例装载，Req 4.1 的证据直接调用其 `decide(req, session)`（`never` → `rejected` 且不派发瀑布；`ask` → 派发 `approval/request` 并按官方 `OUTCOMES` 词汇（`allowed-once`）返回），并断言 `effectivePolicy(session)` 随选择变化；`permissionPresets` 服务与 `sessionProjections` 用严格按 P1/P2 语义的替身（该两包未被本仓库声明依赖）。**session 日志载体是真实官方 `Session`**（`@deepseek-ai/dsh-session` 的 `Session.create(id)`，与仓库既有 durable 测试同构造；第八轮更正：此前误把该包**默认导出** `SessionStore`（需 ctx 且抛 `Cannot read properties of undefined (reading 'provide')`）当作 `Session` 类，因而误判「无法独立构造」——命名导出 `Session` 可正常 `create`/`append`）。唯一替身是**派发跳**：无 store 挂载的 session 其 `append` 不自行到达 `session/event`，由 harness 转发（Task 6.1 原文即如此描述）。`@deepseek-ai/dsh-settings` 的 `installSettingsSection` 需挂官方 settings 服务，settings 面在本基座为桩对象（本 feature 不消费 settings；`permission.defaultPreset` 属另一 authority 且被显式互斥声明）。门面不模拟审批判定。
2. **观察去重的粒度含选项签名**：投递签名 = `{ preset, currentValue, optionValues, optionNames, optionsSource }`；预设包切换会连写 `permission/preset` + 旋钮事件，事件逐条到达时按组合视图逐次投递（每次都是真实变化），最后一次携带落定视图。同一签名在 priming 与投递之间共用同一构造器（避免 priming 误报变化）。
3. **`select` 的 `unknown-preset` 判定用官方 `resolve` 的抛错**（而非自行比对 `names` 数组）：官方选项表是唯一真值来源，门面不复制表；抛错在写入前被拦截，官方状态不变。
4. **`options` 的降级视图保留 `target`/`observedAt` 字段**（Task 1.3 与 2.1 同形对齐，plan-mode 线 disabled 面先例）。
5. **sessions getter 收敛为双子面共享循环**：plan-mode 与 permission-presets 的子面物化逻辑合并为一段（`subFaces` 表），保持 method 风格 getter 与 inert-core 回退；plan-mode 既有行为不变（其测试与真实 cordis 回归全绿）。

**登记的 design 修订（Task 6.8 回写）**：C1 availability 的 degraded 成因扩展为两条（投影载体缺失 / 观察通道不可用）；C2 `options` 视图补 `source` 与降级 `reason`（降级时 `options: []`、`currentValue: null`、`target` 恒在场）；C4 handle `current()` 语义改为「经官方重读核验的读视图」（与 `current` 同形）；C6 与 Data Models 的审计记录补 `reason?`（bounded ≤240）；Registry 表 `observe.handle` composition → `additive`、`availability` 行 scope/authority → `facade`/`official permission-presets authority`。全部在 design 文末「Stage 4 修订登记」中逐条注明，不改写任何已交付验收边界。

**既有精确列表断言的同步点（Task 5.4 的 P9 清单 + 实跑补全）**：`test/host-cutover.test.mjs`、`test/index-session.test.mjs`、`test/index-agent.test.mjs`、`test/index-profile.test.mjs`、`test/index.test.mjs`、`test/index-session-durable.test.mjs`、`test/index-tools.test.mjs`、`test/index-events.test.mjs`、`test/index-system-prompt.test.mjs`、`test/index-remote.test.mjs`、`test/index-diagnostics.test.mjs`、`test/security-policy-assembly.test.mjs`、`test/official-passthrough-independence.test.mjs`（feature 总数 38 → 39，`sessionPermissionPresets` 落在 `sessionPlanMode` 之后、`sessionInteraction` 之前；`index.test.mjs` 的健康 fixture 补 `permissionPresets` 服务桩）。

**工程债登记（非阻塞）**：三个 mutation 线（plan-mode、permission-presets、credential-mutation）各自持有结构相同的 bounded audit ring；本 feature 未抽取共享模块，以免在已交付的 plan-mode 线上做未登记的维护改动。建议由 `plugin-api-m10-contract-convergence` 线在整树收敛时统一抽取并登记。

### Stage 4 全局终审（第一轮）意见与处置（2026-09-13）

终审返回「有意见」7 条（1 阻塞 / 3 中 / 3 低），全部实质修订：

1. **（阻塞）e2e 断言双次取时导致概率性失败** → 先取 `face.current(session)` 一次并复用其 `observedAt`（其余同类断言的取值方式复核后无此问题）。
2. **（中）Req 11.3 的反向注册顺序与竞争确定性证据缺失** → 新增 e2e 用例：两个 caller **反向**注册（后注册者先提交），同一同步跨度内两次相同选择分别得 `committed`/`unchanged` 且官方 seam 只写一条预设事实；随后相反方向的选择各自 `committed`，两个 caller 读同一官方 fold 裁决。
3. **（中）Req 11.4 的降级与无关能力隔离证据缺失** → 新增三处用例：(a) 以真实 guard 路径（`runFeatureGuard('sessionPermissionPresets', …)`）验证「服务缺 `set` 成员 → guard 拒绝」并断言 `tools`/`sessions`/`events`/`views` 与 `capabilities.get('tools')` 不受牵连；(b) facade 级「订阅建立失败 → `availability()` degraded、读/写面仍可用」（经拒绝 `ctx.on` 的代理上下文挂载真实 feature）；(c) disabled 面下无关成员仍在。审计写失败的「效果保留」在环层（容量 1 溢出）与 `select` 路径（`truncated` 不阻塞提交）双点验证。
4. **（中）Req 9/6.6 跨域正交探针缺失且一处断言空真** → kit 新增 `trackServiceAccess()`（记录 `ctx.get` 解析过的服务名）与 approval 决策记录器；新增用例断言本 feature 只解析 `permissionPresets`/`sessionProjections`/`sessions` 三个 seam；正交用例改为真实前后对比（select/current/options/observe + 一次事实投递期间 `systemPrompt` 注册数与 approval 决策调用数均零增长），删除恒真的 `typeof promptListeners === 'number'` 断言。
5. **（低）`select` 的 unknown-preset 检查位于官方 pre-read 之后** → 前移到目标检查之后、pre-read 之前（与 design C3 声明顺序一致，官方状态不变的角落组合不再改变结果码）。
6. **（低）design 声明的 secret 形状过滤未实现** → 引入 `lib/diagnostics-normalize.js` 的 `redactValue`：reason 与诊断在 bounded 前先做凭据形状脱敏；新增用例（含 5 万字符与 `sk-live-` 形状串）并做变异检验（去掉脱敏后该用例变红）。
7. **（低）`observe` 的事件类型过滤未按 design C4 声明实现** → 实现 `KNOB_EVENT_TYPES` 过滤（仅 `permission/preset`/`sandbox/mode`/`approval/policy` 触发重读），与声明一致。

修订后回归：`npm test` 全量绿；registry validator `registry valid`；client bundle `--check` 一致；`git diff --check` 干净。

### Stage 4 全局终审（第二轮）意见与处置（2026-09-13）

第二轮确认第一轮 7 条中 6 条真实闭合（含 flake 消除的重复运行验证、脱敏的变异检验、seam 探针的真实性、unknown-preset 前移的实测、事件过滤的无漏投递），另报 2 条：

1. **（中）「反向注册顺序」用例名实不符** → 复核属实：原用例先注册 B 再注册 A 且由先注册者先提交，不存在反向变量，且未体现 Task 6.4 的「两个独立 plugin tree」。已重写为**两棵独立 harness（共享同一官方 preset 组件与同一 session store）**：树 A 先注册插件、树 B 后注册，**行动顺序取注册顺序的逆序**（后注册者先提交），断言官方 fold 决定结果（`committed`/`unchanged`）、官方 seam 恰好写一条预设事实、相反方向的先后提交各自 `committed` 且两棵树读同一值；并补「跨树状态变更可观察 + 无状态变化的事实不投递」。
2. **（低）状态行测试计数过期** → 改为不写死数字（以文末最新记录为准），避免每轮处置后重复过期。

### Stage 4 全局终审（第三轮）意见与处置（2026-09-13）

第三轮确认第二轮 2 条闭合（反向注册用例重写为两棵独立 tree + 逆序行动、状态行不再写死用例数），另报 4 条**证据缺口**（均为「Task 要求有用例但缺失」，非行为缺陷），全部补齐：

1. **（中）Task 2.7 的 inert-core 用例缺失** → 新增 e2e 用例：正常挂载后以 inert core reconcile，断言 `sessions.permissionPresets` 成员在场、`availability()` 返回 `{status:'unavailable', reason}` 不抛、数据成员抛 `PluginApiInactiveError`（与 plan-mode 线同型先例）。
2. **（低）三 knob 事件类型与「非 knob 事件不重读」缺用例，且过滤零回归保护** → 收紧实现：`event` 非对象或非 knob 类型一律跳过重读（原先 `undefined` 事件会放行——非生产调用形态）；单测改为显式携带事件并新增「非 knob/不可读事实零重读、三 knob 各自触发重读」用例；e2e 新增「sandbox/mode 由其他官方组件写入可观察 + 非 knob 事实不投递 + approval/policy 单独移动视图」用例。
3. **（低）`_unmountFeature` 回退与卸载清理无断言** → 新增 e2e 用例按装配的真实卸载序列断言：owner cleanup（authority 退役 handle → `current()` stale）→ slot 回滚（命名空间 typed unavailable、`_sessionPermissionPresetsSlot` 清空）。
4. **（低）三态在场性的「store 恢复续投」缺用例** → 单测新增可变在场性用例：不可核验期间 knob 事实零重读零投递，store 恢复后同一 handle 在下一 knob 事实投递真实变化。

修订后回归：feature 五个测试文件全绿；`npm test` 全量绿；registry validator `registry valid`；client bundle `--check` 一致；`git diff --check` 干净。

### Stage 4 全局终审（第四轮）意见与处置（2026-09-13）

第四轮确认第三轮 4 条证据缺口已闭合，另报 3 条（1 中 / 2 低），均已修订：

1. **（中）卸载用例的「订阅退役」恒真且所述卸载序列与生产装配相反** → kit 改为记录 `root.on` 订阅并暴露 `subscriptions`，feature 改为经**生产路径**挂载（`prepareFeature` + `commit`，与 `runPreparedMountTransaction` 一致）；用例按真实序列断言：`prepared.rollback()`（槽位换为 typed disabled api → 命名空间 `unavailable`）→ owner cleanup（authority 退役 handle → `current()` stale）→ 两条 feature 订阅由 active 变 inactive（精确计数 -2）；并删除恒真断言与错误的 `'workspace-full-access'` 预设名。
2. **（低）「approval/policy 单独移动视图」断言恒真且事实未落日志** → 改为 `session.append('approval/policy', { policy: 'ask' })`（真实 durable 追加，与官方 seam 一致）并断言该 knob 单独产生一次投递（严格 `>` 对比）。
3. **（低）Task 6.8(a) 的 P1–P4 运行结论未回写 design** → design 新增「Stage 4 运行结论（P1–P4 回写）」一节，逐条记录四项探针在 Stage 4 的真实链复核结论（写入 seam 三段语义与 `unknown-preset` 判定源、投影载体形状与降级、三 knob 事实流与过滤、真实审批判定链与两条官方写路径的 durable 一致性）。

修订后回归：feature 五个测试文件全绿；`npm test` 全量绿；registry validator `registry valid`；client bundle `--check` 一致；`git diff --check` 干净。

### Stage 4 全局终审（第五轮）意见与处置（2026-09-13）

第五轮确认第四轮 3 条闭合（生产挂载路径与订阅计数非恒真、knob 追加真实投递、design P1–P4 回写与探针一致），另报 1 条低度证据缺口：

- **（低）官方 `/permission` 语义路径（`apply` + `approval.setPolicy`）无实测证据** → 两处修订：(i) kit 的替身 `apply(session, name, setApproval)` 恢复官方签名（`set` 传 session 写入器、command 路径传 live `setPolicy`），与 P1 语义一致；(ii) e2e 的「官方路径」用例改为真实驱动 `/permission` 语义——`apply(session, 'workspace-write', policy => kit.approval.setPolicy(agent, policy))`（真实 `ApprovalService`），断言真实审批服务的 `effectivePolicy(session)` 随之为 `ask`、订阅者收到该来源的变更、读面与选项面同步。原先仅 `root.emit`（不落日志）的近似断言已删除，三种来源（直调官方 `set`、`/permission` 语义、knob 追加）现各有实测证据。

修订后回归：feature 五个测试文件全绿；`npm test` 全量绿；registry validator、client bundle `--check`、`git diff --check` 均通过。

### Stage 4 全局终审（第六轮）意见与处置（2026-09-13）

第六轮确认第五轮 1 条闭合（替身 `apply` 与官方签名一致、`/permission` 语义由真实 `apply` + 真实 `ApprovalService.setPolicy` 驱动并断言读面/观察面同步、近似断言已删除），另报 1 条低度文档引用偏差：design 官方契约证据表把 `dsh-session-projection` 的 `snapshot` 行号写作 105–109（实为 105–115，与本 feature `tasks.md` P2 一致）→ 已更正。收尾终检（交付物、tasks 勾选与状态行、design 修订登记与 P1–P4 回写、registry 增量、README/feature-list、执行注与工程债登记）与全部门禁均通过。

### Stage 4 全局终审（第七轮）意见与处置（2026-09-13）

第七轮确认第六轮 1 条闭合，另报 1 条中等偏差：**Task 6.1/P4 声明的「真实 `@deepseek-ai/dsh-session` 的 `Session` 与真实 `installSettingsSection`」未落进交付基座，且该偏离未登记**。处置（采纳审查方给出的第二种闭合方式并如实登记）：

1. 复核事实：官方 `Session` 类确**无法独立构造**——`new Session('probe-1')` / `new Session('probe-1', [], undefined)` 均抛 `Cannot read properties of undefined (reading 'provide')`（需 session-provider/preparation 状态）；`installSettingsSection` 需挂官方 settings 服务。故基座维持「session 日志载体 + settings 面为替身」。
2. **登记偏离**：执行注偏离 1 补写该两条替身及其理由与实测证据；Task 6.1 与 P4 的文字同步标注「session/settings 载体见执行注偏离 1」，不再声称二者是真实官方组件（Req 4.1 的判定证据仍由真实 `ApprovalService` 承载，验收边界未变）。
3. **提升替身保真度**：session 日志载体的事件改为 `{ type, data, seq }` 且逐条深冻结（与官方日志的冻结与 seq 语义一致），`seq` 为事件序号；既有 18 个 e2e 断言在更严形状下全绿（含官方 fold 读取、投递签名与跨树观察）。

修订后回归：feature 五个测试文件全绿；`npm test` 全量绿；registry validator、client bundle `--check`、`git diff --check` 均通过。

### Stage 4 全局终审（第八轮）意见与处置（2026-09-13）

第八轮确认第七轮处置的「登记偏离」部分成立，另报 3 条并经复核属实，均已修订：

1. **（中）替身理由「官方 `Session` 无法独立构造」不实** → 采纳并更正：官方 `@deepseek-ai/dsh-session` 的**默认导出是 `SessionStore`**（构造需 ctx，抛 `Cannot read properties of undefined (reading 'provide')`），而命名导出 `Session` 可 `Session.create(id)` 正常构造与 `append`（本仓库既有 durable 测试即如此使用）；此前误把默认导出当作 `Session`，导致错误结论与不可复现的「实测证据」。据此**基座改用真实官方 `Session`**（`Session.create`），唯一替身只剩「无 store 时 append 不自行到达 `session/event` 的派发跳」（由 harness 转发，Task 6.1 原文即如此描述）。
2. **（低）P4 尾句与第二轮处置记录仍称真实 `dsh-session`/`dsh-settings`** → P4 与第二轮处置记录按实际基座改写（真实 `Session` + settings 桩），Task 6.1 恢复「真实 `Session`」表述。
3. **（中）新引入的治理 token 泄漏 `Req 4.1`**（kit 注释）→ 已删除该编号字样；全文件复查零命中。

修订后回归：feature 五个测试文件全绿（真实 `Session` 形状下）；`npm test` 全量绿；registry validator、client bundle `--check`、`git diff --check` 均通过。

### Stage 4 全局终审（第九轮）意见与处置（2026-09-13）

第九轮确认第八轮 3 条闭合（真实 `Session` 确被使用且 `append` 包装无双重派发、官方 fold 与真实 `ApprovalService` 判定链成立、P4/Task 6.1/第二轮记录措辞已一致、治理 token 零命中、门全通过），另报 1 条低度措辞残留：执行注偏离 1 的**标题**仍写「session 日志载体与 settings 面为忠实替身」，与其正文及实际基座相斥 → 标题已改为「真实 `ApprovalService` 与真实 `Session`；`permissionPresets`/`sessionProjections` 替身 + settings 桩面」。

### Stage 4 全局终审（第十轮）结论（2026-09-13）

**无偏差**。审查方确认第九轮标题措辞已与正文/Task 6.1/P4/kit 基座一致，且第八轮的全部更正（真实 `Session`、措辞同步、治理 token）无回归；`registry valid`、feature 各测试文件与全量 `npm test` 3272/3272、`git diff --check`、client bundle `--check` 均通过。据此进入 Stage 4 完成提交。
