# Stage 3 - Tasks

> feature_name: `session-plan-mode-control`
> milestone: M10
> status: Stage 4 已交付（2026-09-13）。Stage 3 对抗性审查四轮（八条 → 六条 → 六条 → 两条）全部就地闭合，末轮「无偏差」；Stage 4 全局终审结论见文末执行注。全量 `npm test` 3232/3232 绿（用例数随各轮终审意见处置增长，最终口径以文末最新一轮记录为准）；registry validator `registry valid`；client bundle `--check` 一致（host-only，无 client 产物变化）；治理 token 审计绿；`git diff --check` 干净。
> 输入溯源：`goal.md`（2026-09-11 获批）；`requirements.md`（Reqs 1–10）；`design.md`（C1–C5、结果映射表、并发声明、registry 拟新增行、Testing Strategy；含 Stage 4 回写的 P7 运行结论）；Stage 3 源码级探针记录见下。
> 执行口径：Stage 3 以对抗性审查为门（AGENTS.md §3.2），通过后直接进入 Stage 4；版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Stage 3 探针记录（源码级事实，Stage 4 以行为测试复核）

- **P1 官方服务与写入 seam**（`@deepseek-ai/dsh-plan-mode@0.1.0-rc.6`，`lib/index.js`）：`PlanModeController extends Service`，服务名 `planMode`；`inject = ['tools', 'systemPrompt']`。
  - `set(agent, active)`：**同步**返回 `'noop' | 'queued' | 'cancelled' | 'committed'`，无 signal 参数。判定顺序：①`active === (pending?.active ?? fold(events))` → `noop`；②`hasOpenTurn(events)` 为真 → 写 pending（`{active, narrate:true}`）后返回 `fold(events) === active ? 'cancelled' : 'queued'`；③`active === fold(events)` → 删 pending、返回 `cancelled`；④`session.append('plan/mode', {active})` + 删 pending，**若 `narration(session, active)` 返回非 undefined 才 `agent.inject(narration)`** → `committed`。`narration` 由 `planModeAtLastHeader(events)` 是否等于目标决定（`told === undefined || told === target` → undefined，即**不是无条件注入叙述**）。
  - `get(agent)`：`{ active }`，存在 pending 时 `{ active, pending: pending.active }`；`active` 来自 `foldPlanMode(agent.session.events)`（`plan/mode` last-wins），`pending` 来自私有 `WeakMap`（按 `agent.session`）。
  - `onBoundary(session)`：pending 存在时，目标等于日志态 → **静默删除 pending（无日志事件）**；否则 `session.append('plan/mode', ...)`。
  - `pendingIntents` 以 **`agent.session` 对象**为键（WeakMap）→ 每次读取都必须重新取 `agent.session`，并禁止缓存 agent 对象为身份。
- **P2 官方消费面**：`plan:policy` systemPrompt section（`order: 50`，读 pending ?? fold）、`exit_plan_mode` 工具（**无条件下常驻注册**：进出 plan 模式只改变 prompt section、不改变请求工具目录）、`/plan [off|message]` 命令、`sessionProjections.register({ key: 'plan', view: { active, pending: wanted !== null && wanted !== active } })`。沙箱/审批策略独立读写，不消费 plan 状态（与 Req 8 正交一致）。
- **P3 事实流与派发点**：状态唯一事实源是 session 日志 `plan/mode`；模块文档原文 "UIs observe committed flips through `session/event`; there is no live mirror"。本仓库 `session/event` 在门面 catalog 的登记为 `mode: 'emit'`、`scopeFiltered: true`、`scopeKey: null`、`args: '(session, event)'`（`lib/session-events-catalog.js`）；门面内既有 host 级订阅先例：`lib/session-activity-adapters.js`（`subscribe('session/event', 'session', (session, event) => …)`）、`lib/session-channel.js`、`lib/session-durable-feature.js`、`lib/execution-observation-sources.js`。
- **P4 白名单现状**：`services.planMode` 现存成员仅 `get`（`lib/services.js` 纯直通声明 + `lib/official-service-definitions.js` 的 planMode leaf 定义 + registry `servicesWhitelist`）；本 feature 不回流写成员（Req 9.1）。
- **P5 门面 sessions 子面接线落点（已按审查意见校正）**：子面经 `_assignFeature(name)` 内联分支（`lib/plugin-api-service.js` 内的 `createFeatureSlot({ active, feature, api, methods, isCurrent })`）发布，如 `name === 'sessionActivity'` 分支写入 `this._sessionActivitySlot` / `this._sessionActivitySurface` 并调用 `this._publishSessionApi()`；卸载回退在同文件的 `_unmountFeature` 内（`token === this._sessionActivitySlot` → 置 `current = false`、清 slot、恢复 `createDisabledSessionActivityApi(this._active)`、再次 `_publishSessionApi()`）。`_publishSessionApi()` 调 `composeSessionApi(baseSessionApi, durableSessionApi, branches, channels, interaction, activity, availabilityOf)`，并在 `availabilityOf` 内层叠各子面的降级 reason。**不存在 `_setXxxSlot`/`_publishSessionSurface` 方法**；`sessions.views` 不是 slot，是 base session 面的静态冻结子树（`lib/session-feature.js`）——本 feature 采用 **`_assignFeature` 新分支 + `this._sessionPlanModeSlot` + `_publishSessionApi()` + `_unmountFeature` 回退 + `createDisabledSessionPlanModeApi`**（先例 `createDisabledSessionActivityApi`），并把 `sessions.planMode` 加入 `_decoratedNamespaces([...])` 名单。
- **P6 owner 派生与 caller fiber**：既有 `deriveAdapterRegistrationOwner(callerCtx)`（`lib/llm-adapter-registration.js`，按 `callerCtx.fiber` 在 `loader.entries()` 中匹配 name）；门面 mutation 面另有 `callerIdentityOf`（`lib/profile-mutation.js`，`lib/index.js` 使用）。本 feature 的 owner 派生与 `scoped-agent-contributions`/`llm-adapter-registration` 同源，不可归因 → typed `denied`（fail-closed，与三线 mutation 面一致）。
- **P7 观察结算的待核实项（design §C4 明列）**：pending 静默清除（`onBoundary` 目标已等于日志态）不产生日志事件；官方的 `agent/pre-step` handler 在**被接受**时调用 `onBoundary`，其后官方 loop 通常继续 append 事件（如 request 头等），但官方文档**未显式保证**。Stage 4 须在冻结 runtime 上运行验证；若存在「静默清除后无日志活动」窗口，观察面诚实降级（不推送、读面可见 pending 消失、diagnostics 记录），不伪造投递。
- **P8 目标关闭的事实源（Stage 4 判定依据）**：官方关闭 = session 从 store 移除并派发 `session/disposed`（官方 `dsh-session`）。本 feature 以 `ctx.get('sessions').get(sessionId)` 在场性 + 门面已订阅的 `session/disposed` 作为**唯一**目标存活判定源，不自建簿记、不猜测（Req 1.4 的前置拒绝与 Task 3.4 的关闭降级共用同一事实源）。

## Task 1: plan-mode 核心模块（对应 Req 1、2、4、6、8）

**产出**：`lib/sessions-plan-mode.js`（纯函数模块，零 harness 依赖可测）+ 单元测试 `test/sessions-plan-mode.test.mjs`。

- [x] 1.1 结果映射（Req 1.2、1.3、6.1、6.3；design 映射表）：`mapSetOutcome(official, { requested, targetId, appliedAt })` 全表实现——`committed → { ok: true, code: 'committed', commitState: 'success', mode, appliedAt }`；`queued → { ok: true, code: 'queued', pending: true, mode }`（**无 commitState**）；`cancelled → { ok: false, code: 'cancelled', reason }`；`noop → { ok: false, code: 'noop', reason }`（幂等映射，不记第二次 committed）；未知官方码 → `{ ok: false, code: 'internal', reason }`（不猜测）；返回全部冻结。
- [x] 1.2 目标解析与前置拒绝（Req 1.4；P8）：接受官方 agent handle（`{ session: { id, events } }` 形状校验 + `session.id` 非空）；**存活判定经 `sessions.get(sessionId)` 在场性**（唯一事实源）；畸形/缺失/已关闭目标 → `{ ok:false, code:'invalid-target' }`；参数非 boolean → `invalid-input`；**任何副作用之前**返回，官方状态不变。
- [x] 1.3 读面视图（Req 2.1–2.3）：`planModeView(agent, officialGet)` → 冻结 `{ target, active, pending?, observedAt, source: 'official' }`（`pending` 仅在官方 `get` 返回时透传）；官方抛错/服务缺失 → typed `degraded`/`unavailable` 视图（不抛穿、不返回门面自记状态）。
- [x] 1.4 观察 cell 与去重（Req 3.1、3.3、6.2）：**去重粒度 = 每个 observe handle 各自持有一份 `lastDelivered` 视图**（design §C4「与该 handle 上次投递视图不同才投递」；同 target 多 owner 各有 handle，互不抑制）；投递前经官方 `get` 重读核验（事实源），重读失败跳过并记 bounded diagnostic；投递快照深冻结 `{ target, view: { active, pending? }, observedAt }`；`active` 与 `pending` 任一变化即投递。
- [x] 1.5 订阅者 containment（Req 3.2）：监听者 throw/rejection 只降级该监听者（bounded 诊断），其他监听者与源状态不受影响；`dispose()` 幂等，stale disposer 不影响其他订阅者与其他 handle；dispose 后到达的事件不投递。
- [x] 1.6 epoch 语义（api-idioms §2；先例 `sessions.activity.observe.handle`/`attention.observe`）：feature 持有 hub epoch 计数器；每个 observe handle 在创建时捕获当时的 hub epoch；hub 换代（feature 卸载/重挂）后旧 handle 的 `current()`/`subscribe()` 返回 typed stale/unavailable，绝不复用旧投递状态。
- [x] 1.7 Req 4 与 Req 8 的边界断言（Stage 3 审查意见 4）：模块**不注册任何 prompt section、不 append/emit `plan/mode` 或任何 session 事件、不写任何门面投影**（只读官方 + 观察）；`select` 的执行路径不触碰 permissionPresets/approval/security/policy 面（纯函数模块层面以「零注册、零事件、零跨域调用」断言承载；端到端断言见 Task 6.6）。
- [x] 1.8 测试：四码 + 未知码映射 / 前置拒绝矩阵（畸形、缺 session、非 boolean、session 不在场）/ 视图形状与冻结 / 视图无变化不投递 / 变化投递含 observedAt / 重读抛错跳过并记诊断 / 监听者 throw 隔离 / dispose 幂等与 stale 隔离 / **epoch 换代后 stale handle 断言** / 零注册零事件断言 / **per-handle 去重独立性断言**。

## Task 2: 门面接入 `sessions.planMode`（对应 Req 1、2、7）

**产出**：`lib/plugin-api-service.js` / `lib/index.js` / 新 `lib/sessions-plan-mode-facade.js` 接线 + surface 测试。

- [x] 2.1 命名空间放置（design「Namespace 放置」；P5 接线落点）：`sessions.planMode` 作为 sessions 域子面——`_assignFeature('sessionPlanMode')` 分支（成员形状校验 `get`/`select`/`observe`/`availability`）→ `this._sessionPlanModeSlot` + `this._sessionPlanModeSurface` + `_publishSessionApi()`；`_unmountFeature` 回退（清 slot + `createDisabledSessionPlanModeApi(this._active)` + 重发布）；`composeSessionApi` 增加 planMode 参数；`_decoratedNamespaces([...'sessions.planMode'...])` 名单；`KNOWN_FEATURES` 增 `sessionPlanMode`；**namespace 始终存在**。
  - **未挂载态的呈现（Stage 3 复审意见 ④，钉死）**：disabled 面**返回** typed 结果而不抛——`get` → `{ target, active: null? }` 形状的 degraded view（带 reason 的 typed 视图，与官方服务缺失时同形）、`select` → `{ ok:false, code:'unavailable', reason }`、`observe` → **dead handle**（`{ current(), subscribe(listener), dispose(), epoch }` 形状不变：`current()` 返回带 reason 的 degraded 视图，`subscribe(listener)` 立即以该 degraded 视图调用一次并返回 no-op disposer，`dispose()` 幂等）、`availability()` → `{ status:'unavailable', reason }`；**唯一抛错路径是核心 inactive**（`PluginApiInactiveError`）。这是对 `createDisabledSessionActivityApi`（抛 `PluginApiFeatureDisabledError`）的**有意差异**，依 design.md「Requirements Req 7.2 选定『返回不抛』呈现，优先于 public-api-shape §5 的『返回或抛』通用规则」；实现时在该工厂的注释中写明该差异理由。
  - **「namespace 始终存在」的接线要求（Stage 3 三审意见 1，钉死）**：`_publishSessionApi()` 必须传**恒存在的子面字段**——`composeSessionApi(..., this._sessionPlanModeSlot ? this._sessionPlanModeSlot.surface : this._sessionPlanModeSurface, ...)`，而**不得**照抄 `const activity = this._sessionActivitySlot?.surface` 的形态（未挂载时为 `undefined` → `composeSessionApi` 跳过该子面 → `sessions.activity`/`request`/`cancel` 在未挂载态实际缺失；这是既有先例的**行为缺陷**，本 feature 不复制）。`this._sessionPlanModeSurface` 必须在构造函数中初始化为 `createDisabledSessionPlanModeApi(active)`，保证 `sessions.planMode` 在任何时刻都存在（public-api-shape §5、design C1、registry namespaces 记录一致）。
  - **既有精确列表断言的同步点（Stage 3 三/四审意见 2/A，非穷尽）**：新增 feature/descriptor 会打断以下既有精确列表断言，Stage 4 必须同步更新，并**以 `npm test` 全量失败为准逐一收敛**（下列为已知集合，不保证穷尽）：`test/host-cutover.test.mjs`（`capabilities.list({ prefix: 'sessions.' })`）、`test/index-session.test.mjs`（feature-name `deepEqual` 与位置断言）、`test/index-agent.test.mjs`（同名 37 项 feature-name `deepEqual` 与位置断言）、`test/index-profile.test.mjs`（`features[features.length - N]` 尾部位置断言）、`test/index-session-durable.test.mjs`、`test/index.test.mjs`（feature registry 快照与尾部顺序）、`test/official-passthrough-independence.test.mjs`（`BRANCH_ADDED_FEATURES` 差集）、`test/security-policy-assembly.test.mjs`（`FEATURE_MOUNTERS` 尾部顺序断言）。
  - **feature 事务接线（Stage 3 四审意见 B）**：本 feature 沿用同域先例（`sessionActivity`/`sessionInteraction` 在 `lib/index.js` 走 `prepareFeature`），因此除 `_assignFeature`/`_unmountFeature` 外，**必须同步补** `_readSlot(name)` 与 `_disabledSurfaceFor(name)` 的 `sessionPlanMode` 映射——二者是 `_restoreDisabledSurface(name, api)` 事务回滚路径的唯一依赖，缺失会导致回滚后 slot 未清理、disabled 面未恢复（泄漏）。若 Stage 4 判定改用 `mountFeature` 立即挂载（不走 `prepareFeature`），须在该任务执行注中说明理由并验证回滚等价性。
- [x] 2.2 写面 `select(agent, active)`（Req 1.1、1.4、1.5、5.1–5.3、6.1）：单同步跨度 = availability 检查 → 目标检查（P8）→ **owner 派生**（caller fiber，不可归因 → typed `denied`）→ 审计 attempt（有界字段）→ 官方 `planMode.set(agent, active)` → 结果映射；`reason`/context 字符串 bounded，绝不作为授权依据；官方抛错 → typed `internal`/`degraded`（不抛穿）。
- [x] 2.3 读面 `get(agent)`（Req 2）：转发官方 `planMode.get`，冻结视图；服务不可用 → typed `unavailable` 视图。
- [x] 2.4 availability（Req 7.1、7.2）：`availability()` 冻结 `{ status: 'active'|'degraded'|'unavailable', reason? }`——active = 官方服务在场且 `get`/`set` 形状完整；degraded = 观察通道不可用；unavailable = 服务缺失/错配；**永不抛错**；`sessions.availability()` 的 reason 层叠纳入 planMode 的降级（先例 activity/interaction 的 `details` 层叠）。
- [x] 2.5 fail-safe 挂载（AGENTS §2.6；design C1）：`mountSessionPlanModeFeature` 幂等挂载 + **`lib/guards.js` 新增 `else if (featureName === 'sessionPlanMode')` 分支**——探 `ctx.get('planMode')` 存在性与 `get`/`set` 成员形状，并探 `ctx.on`（观察面依赖 `session/event` 与 `session/disposed` 订阅，先例 `sessionActivity` 的 `ctx.on` 探针；未登记分支会落入 `unknown feature` 而停用，见 `runFeatureGuard` 的 else 分支）；任何挂载异常只记日志并停用 feature，绝不抛穿 apply；运行期服务消失 → typed unavailable，不影响主门面与无关能力（Req 7.2）。
- [x] 2.6 authority closure（Req 9.1）：不向 `services.planMode` 白名单回流任何写成员；`services.planMode.get` 原样保留；门面不拦截官方 native 路径（Req 9.2）。
- [x] 2.7 测试：surface 形状 / 未挂载时的 typed 降级 / inactive typed 错误 / 无关能力隔离 / 白名单无写成员回归 / `sessions.availability()` reason 层叠。

## Task 3: 观察面 `observe(agent)`（对应 Req 3、6.2）

**产出**：`lib/index.js` firehose 订阅接线 + 测试。

- [x] 3.1 firehose 订阅（design C4；P3）：feature 挂载时建立**单条** `ctx.on('session/event', (session, event) => …)` 订阅（facade 级共享，cleanup owner = feature disposer）；按 `session` 匹配已绑定 target → 官方 `get` 重读 → 逐 handle 比对 `lastDelivered` → 变化才投递；订阅失败 → feature 降级（availability `degraded`），读/写面不受影响。
- [x] 3.1b **生命周期订阅（Stage 3 复审意见 ③）**：`session/disposed` 是与 `session/event` **并列的独立生命周期事件**（`lib/session-events-catalog.js`），因此本 feature 必须**自建** `ctx.on('session/disposed', (session) => …)` 订阅（cleanup owner = feature disposer），把已绑定 target 的 handle 置为 degraded 并停止投递；**不得复用**其他 feature（`session-activity-adapters`、`session-route`）的订阅。目标关闭的判定源仍为 `sessions.get(sessionId)` 在场性（P8），`session/disposed` 用于及时**通知**当前 handle。
- [x] 3.2 observe handle（Req 3.1、3.2；api-idioms §3.1）：`observe(agent)` → target 绑定 handle `{ current(), subscribe(listener), dispose(), epoch }`（**无 idiom 例外**）；`current()` 返回该 handle 目标的读视图（每次调用经官方重读核验，与 `get` 同形，见 design §C4 的 Stage 4 修订）；跨目标各自建 handle；epoch 语义见 Task 1.6。
- [x] 3.3 queued 结算观察（Req 6.2；design §C4 待核实项、P7）：`committed` 结算经 `plan/mode` 日志事件直达投递（机制性保证）；**静默清除**路径的投递以 P7 在冻结 runtime 上的运行结论为准——存在「无后续日志活动」窗口时诚实降级（不推送、读面 `pending` 消失可见、bounded diagnostics 记录），先前 `queued` 结果不被改写；Task 6.3 的断言按该结论的**条件形态**书写（不无条件断言降级路径）。
- [x] 3.4 session 生命周期（Req 3.2；P8 + 3.1b）：feature 自持的 `session/disposed` 订阅到达后该目标立即停止投递，`current()` 返回带 reason 的 degraded 视图；无 `session/disposed` 时，`sessions.get(sessionId)` 不在场也应在下一次 `session/event` 重读时被判定为关闭；feature 卸载销毁两条订阅与全部 handle（epoch 换代使旧 handle stale）。
- [x] 3.5 测试：官方路径（直调官方 `set`）变更到达订阅者 / `plan/mode` 事件投递 / 无变化不投递 / 同 target 两 handle 互不抑制 / 回调 throw 隔离 / stale disposer 隔离 / epoch 换代后旧 handle stale / session 关闭降级 / feature 卸载清理。

## Task 4: 审计与可追溯（对应 Req 5）

**产出**：模块内有界审计环 + 测试。

- [x] 4.1 载体（design C5；durable-state-and-scope §1–2）：feature-authority 内部有界内存环（容量与 `lib/security-audit.js` 同档 512、非 durable、不新增/不跨存储档位），记录字段 `{ seq, at, ownerId, action: 'plan-mode.select', target, requested: 'enter'|'exit', outcome }`，不含 payload/消息内容/owner 私有状态。
- [x] 4.2 记录时机（Req 5.1）：**触达官方 seam 的尝试与提交前拒绝都记录**（前置拒绝也记 attempt + 拒绝码）；写失败 → `gapSince` 标记 + bounded 日志，官方效果保留（**不回滚官方提交**），不伪造记录（Req 5.2）。
- [x] 4.3 owner 归因（Req 5.3）：owner 由 caller fiber 派生；caller 自报 owner 一律不接受；不可归因 → typed `denied` 且不产生未归因提交记录。
- [x] 4.4 测试：记录形状与 bounded / 提交前拒绝也记录 / 环溢出丢弃最旧并置 truncated / 写失败 gap 标记与效果保留 / owner 不可伪造 / 无 payload 泄漏（含 reason 截断）。

## Task 5: capability、availability 与登记（对应 Req 7.3、10.5）

- [x] 5.1 运行时 capability：`lib/capability-descriptors.js` 增 `sessions.planMode` 行——`entry('sessions.planMode', 'mutate', ['sessionPlanMode'])`（effect 取 `mutate`：该 capability path 承载 `select` 写成员，先例 `attention` 同取 `mutate`；`sessions.activity` 取 `read` 因其全为只读成员）；`lib/capability-matrix.js` 增同名 cluster 行；`lib/namespace-availability.js` 的 `HOST_NAMESPACE_RECORDS` 增 `'sessions.planMode'` 记录（`{ path: 'planMode', capabilityPath: 'sessions.planMode' }`）。**覆盖边界（登记在案）**：descriptor 的 features 输入来自挂载期 guard（`sessionPlanMode` feature 状态 + 官方 `planMode` 服务在场性），**运行期**官方服务消失由成员自身的 `availability()`/typed 结果诚实呈现，不经 descriptor 输入反映（design C1 已承认）。
- [x] 5.2 canonical registry 新增行（design「Registry 拟新增行」五条 + Stage 3 审查意见 3 的完备性要求）：
  - 五条行：`sessions.planMode.get`（projection/read/pure）、`sessions.planMode.select`（mutation/mutate/coordinated/compare-and-swap）、`sessions.planMode.observe`（projection/subscribe/additive）、`sessions.planMode.observe.handle`（projection/read/**additive**——handle 承载 `subscribe(listener)`，与 `sessions.activity.observe.handle` 先例一致，不记 pure）、`sessions.planMode.availability`（selfDescription/read/pure）。
  - **每行携带完整字段集**（未适用字段显式 `null`，按 `scripts/registry-validate.mjs` 的必填与词表校验；新成员的 `migrationAction` 显式 `null`——validator 规定非 null 的 `migrationAction` 必须配 `oldToTargetMapping` 条目）；**`failureSemantics` 取 `discriminated-result`**（validator 强制同 idiom 单一取值；既有全部 mutation/projection/selfDescription 成员均为此值，不得自行另取）；`capability` 一律 `sessions.planMode`。
  - `capabilityMatrix` 增同名 cluster 行：`{ capabilityCluster: 'sessions.planMode', currentPaths: ['sessions.planMode.availability', 'sessions.planMode.get', 'sessions.planMode.observe', 'sessions.planMode.select'], targetPaths: ['sessions.planMode.availability', 'sessions.planMode.get', 'sessions.planMode.observe', 'sessions.planMode.select'], status: 'retained', qualifiers: [], replacement: null, gapReason: null, affectedConsumers: ['session-permission-preset-control', 'interactive-session-access'], verification: ['registry-draft', 'capability-matrix'] }`——**矩阵行的 `status` 取能力守恒词表**（`retained`，先例 `sessions.activity`/`attention`），与成员 `status` 的 `advanced` 是两个不同词表，不得混用；`currentPaths` **不含** `sessions.planMode.observe.handle`（与最接近的同域先例 `sessions.activity` 对齐：其 `currentPaths` 不含 `observe.handle`），该选择在 Stage 4 落地时按同一口径执行；`affectedConsumers` 为已登记的相关线（权限预设控制与交互接入均会消费模式状态），如 Stage 4 发现更准确的集合则按实际消费者更新并说明。
  - `status` 取 **`advanced`**（与全部 17 条 mutation 成员及 `attention.observe` 先例一致；`recommended` 对非 read 成员须声明 `bypasses`，本 feature 不声称 authority closure 覆盖官方 native 路径，故不取 `recommended`——该升级若需要属独立登记决策）。
  - `namespaces` 增 `sessions.planMode` 导航记录（`{ namespace: 'sessions.planMode', runtime: 'host', capabilityPath: 'sessions.planMode', contributingFeatures: ['session-plan-mode-control'], availabilityMember: 'sessions.planMode.availability', availabilityExemption: null }`），否则 availability 叶子违反前缀闭包规则。
  - `eventCatalog` 不新增事件（复用 `session/event`）；`servicesWhitelist` 的 `planMode` 条目不变（不回流写成员）；validator 全绿。
- [x] 5.3 文档同步：`docs/specs/plugin-api-features/feature-list.md` §7 追加交付条目（含 host-only 六问记录、与 permissionPresets/interactive 的分工交叉引用、官方 native 路径不经门面 owner/审计的事实说明）；`README.md` 的 host 领域根与 `sessions` 域小节追加 `sessions.planMode`（AGENTS §8 文档同步面）。
- [x] 5.4 测试：capability/availability 镜像一致（registry validator + capability 测试 + namespace availability 测试）。

## Task 6: 端到端验收与迁移证据（对应 Req 10.1–10.4）

**产出**：`test/sessions-plan-mode-e2e.test.mjs`（含 mock 基座，必要时抽为 `test/session-plan-mode-test-kit.mjs`）+ `test/session-plan-mode-migration-slices.test.mjs`。

- [x] 6.1 e2e 基座：mock 官方 `planMode` 服务（`get`/`set` **严格按 P1 语义**：noop/queued/cancelled/committed 四分支、`hasOpenTurn` 判定、`session.append('plan/mode')`、pending 表、**条件性 narration**）+ mock session/event firehose + mock sessions 存活面（P8）+ 门面 `apply`；全走公共入口。
- [x] 6.2 结果与读回（Req 10.1）：committed/queued/cancelled/noop 四码端到端 / 前置拒绝（畸形、缺失、已关闭目标）/ 未知码 → `internal` / committed 后官方 `get` 与门面读面一致。
- [x] 6.3 观察（Req 10.2）：官方路径（直调 mock 官方 `set`）变更到达订阅者 / 回调 containment / stale disposer 隔离 / 同 target 两 owner handle 各自收到投递 / session 关闭降级 / queued 结算投递（含 P7 窗口的**条件性**诚实降级断言，与 Task 3.3 措辞一致）。
- [x] 6.4 组合（Req 10.3；composition-and-authority §11）：两个独立 synthetic plugin fiber（反向注册顺序）并发 `select` 确定性（官方仲裁码）/ owner 派生与不可归因 → `denied` / 重复选择幂等（noop 不计第二次 committed、审计只记 attempt）。
- [x] 6.5 降级（Req 10.4）：官方服务缺席 / `set` 成员缺失 → feature 降级、typed unavailable、availability 诚实、无关能力（`sessions.activity`、`tools` 等）不受牵连；审计写失败 gap 标记。
- [x] 6.6 正交与不反写（Req 4.3、8.1；Stage 3 审查意见 4）：`select` 前后 mock 的 permissionPresets/approval/security 面**零调用、状态不变**；门面**未注册任何 prompt section**、**未 append/emit 任何 session 事件**、官方 `plan:policy` section 与 `exit_plan_mode` 工具目录由官方自行变化（门面不 mirror/replay）。
- [x] 6.7 迁移 slices（外部仓库不在工作区，沿用既有切片模式）：A——TUI/独立前端的 `/plan` 等价切换（原：官方命令/直调官方 seam；迁：`sessions.planMode.select` + `observe` 驱动 UI 徽标）；B——自动化/编排消费者按模式约束自身行为（原：读取官方投影/私有状态；迁：`sessions.planMode.get`/`observe`）。
- [x] 6.8 design 回写：P7 待核实项在冻结 runtime 上的运行结论按 spec 修订流程同步回 design §C4（结论一致则记「无偏差」），并同步 P1/P2 的 narration 条件性与 `exit_plan_mode` 常驻事实表述；**并把 design「Registry 拟新增行」中 `sessions.planMode.observe.handle` 的 composition 由 `pure` 同步为 `additive`**（先例 `sessions.activity.observe.handle`）——该修订在 Stage 3 复审时已就地落在 design，Stage 4 只做核对与「无偏差」记录。

## Task 7: 全量验证、全局终审与提交

- [x] 7.1 `npm test`（4G 护栏）全绿；治理 token 审计不新增泄漏；client bundle `--check` 一致（host-only，预期无 client 产物变化）。
- [x] 7.2 全局终审（阻塞式，只审整体交付与 Tasks/Design/Requirements 一致性 + standards 适用分册）：返回「无偏差」后才可进入 7.3；有意见则集中修订并再次派审。
- [x] 7.3 `git diff --check` 干净；终审通过后按阶段提交规则提交本 Stage 4 交付并完成最终登记。

## Stage 3 对抗性审查记录（第一轮）

结论「有意见」八条，逐条处置：

1. **（阻塞）P5 探针记录三处与源码不符**：`_setSessionActivitySlot`/`_publishSessionSurface` 不存在、`sessions.views` 非 slot、接线落点指错 → P5 已按真实符号重写（`_assignFeature` 分支 + `_sessionXxxSlot` + `_publishSessionApi()` + `_unmountFeature` 回退 + `createDisabledSessionPlanModeApi`），Task 2.1 同步。
2. **去重粒度与 epoch 来源未钉死** → Task 1.4 明确 **per-handle** `lastDelivered`；Task 1.6/3.2 明确 hub epoch 捕获与换代失效，并在测试补 stale-epoch 断言。
3. **登记面不完备** → Task 5.2 补齐：完整字段集（显式 null）、availability 叶子的 `namespaces` 导航记录、`capabilityMatrix` cluster 行、`status` 取值依据（`advanced`；`recommended` 需 `bypasses`，本版不取）、`namespace-availability.js` 运行时镜像、`KNOWN_FEATURES`/`_decoratedNamespaces`；Task 5.3 补 `README.md`。
4. **Req 4 / Req 8 无验收项** → Task 1.7（模块层零注册零事件零跨域）+ Task 6.6（端到端零调用/状态不变/官方自行变化）补齐；Task 1 头注明覆盖 Req 4、8。
5. **P1 ④ / P2 与源码细节不符** → P1 改为「narration 非 undefined 才 inject」；P2 改为「`exit_plan_mode` 无条件下常驻注册」。
6. **内部 feature key 命名** → 统一为 `sessionPlanMode`（与 `sessionActivity`/`sessionInteraction` 等既有词表一致）。
7. **登记值对齐先例** → `sessions.planMode.observe.handle` 的 composition 改 **`additive`**（handle 承载 `subscribe`）；authority 措辞按既有先例（`official plan-mode authority` / owner 字样）。
8. **「已关闭目标」判定事实源未指定** → 新增 P8：以 `sessions.get(sessionId)` 在场性 + `session/disposed` 为唯一判定源（Task 1.2/3.4 共用）。

### 第二轮（复审）意见与处置

复审确认第一轮八条中 6 条完全闭合，另指出 6 条（两处「闭合时引入的新偏差」与四处欠定义），均已就地修订：

1. **（高）`capabilityMatrix` 行 `status` 误用成员词表** → 矩阵行 `status` 改为能力守恒词表 `retained`（先例 `sessions.activity`/`attention`），并写明 `currentPaths`/`targetPaths`/`qualifiers`/`replacement`/`gapReason`/`affectedConsumers`/`verification`；明确「矩阵行 status 与成员 status 是两个词表，不得混用」。
2. **（中）`sessions.planMode.observe.handle` 的 composition 在 tasks 与 design 间不一致** → design「Registry 拟新增行」已同步为 `additive`，Task 6.8 增补该回写/核对项。
3. **（中）`session/disposed` 缺接线落点** → 新增 Task 3.1b：feature **自建** `ctx.on('session/disposed', …)` 订阅（不得复用其他 feature 的订阅），Task 3.4 与 design §C4 同步改写；P8 明确 `sessions.get(sessionId)` 为事实源、关闭事件为通知源。
4. **（中）disabled 面「返回/抛」对冲** → Task 2.1 钉死「`select`/`get`/`observe`/`availability` 一律返回 typed 结果，仅核心 inactive 抛 `PluginApiInactiveError`」，并注明相对 `createDisabledSessionActivityApi` 的有意差异。
5. **（低）descriptor `effect` 未指定 + 运行期服务在场性覆盖边界** → Task 5.1 明确 `entry('sessions.planMode', 'mutate', ['sessionPlanMode'])`（先例 `attention`）并登记 descriptor 不反映运行期服务消失的覆盖边界。
6. **（低）新成员 `migrationAction`** → Task 5.2 明确新成员显式 `migrationAction: null` 及其 validator 依据。

### 第三轮意见与处置

第三轮确认第二轮六条修订全部闭合、无事实性偏差，另指出 6 条（两处中等问题与四处低度完整性/同步问题），均已就地修订：

1. **（中）「namespace 始终存在」与所引 activity 先例机制不一致** → Task 2.1 钉死接线：`_publishSessionApi()` 传**恒存在**的 `this._sessionPlanModeSlot ? … .surface : this._sessionPlanModeSurface`，并明示**不照抄** `const activity = this._sessionActivitySlot?.surface`（该先例未挂载时子面实际缺失，属既有行为缺陷，本 feature 不复制）。
2. **（中）新增 feature/descriptor 会打断既有精确列表断言** → Task 2.1 列出五个必须同步的测试文件（`host-cutover`、`index-session`、`index-session-durable`、`index`、`official-passthrough-independence`）。
3. **（低）矩阵行 `affectedConsumers` 为占位符** → 改为具体消费者（`session-permission-preset-control`、`interactive-session-access`）。
4. **（低）`currentPaths` 是否含 `observe.handle` 未定** → 钉死为**不含**（对齐同域最接近先例 `sessions.activity`）。
5. **（低）`lib/guards.js` 分支未登记** → Task 2.5 明确新增 `sessionPlanMode` guard 分支（`planMode` 服务形状 + `ctx.on` 探针；未登记分支会落入 `unknown feature` 而停用）。
6. **（低）`failureSemantics` 未指明** → Task 5.2 明确五条行均取 `discriminated-result`（validator 同 idiom 单一取值约束）。

### 第四轮意见与处置

第四轮确认第三轮六条修订全部闭合、无事实性偏差，另指出两处中等的同步点/接线登记缺口，均已就地修订：

1. **（中）同步点清单不完备** → Task 2.1 补入 `test/index-agent.test.mjs`、`test/index-profile.test.mjs`、`test/security-policy-assembly.test.mjs`，并改述为「非穷尽列举，以 `npm test` 全量失败为准逐一收敛」。
2. **（中）`_readSlot`/`_disabledSurfaceFor` 未登记** → Task 2.1 明确补 `sessionPlanMode` 映射（`_restoreDisabledSurface` 回滚路径的唯一依赖）；若改走 `mountFeature` 须在执行注说明理由并验证回滚等价性。

## 执行边界

- 版本冻结：不步进任何版本字段（AGENTS §3.0.1）。
- 不新增 R 包、不替换/禁用官方行、不 patch 官方包、不重写官方 plan-mode 组件；门面不自维护第二份 mode 状态（Req 4.1）。
- 不提供跨域 setter（permissionPresets/approval/security 归各自 owner，Req 8）；不新增公共 client 半面（host-only）。
- 入口与运行期 fail-safe：挂载失败只记日志并停用；成员一律 typed 结果，绝不抛穿 apply/dispatch。
- v1 无公共审计查询成员（克制设计）；审计经 feature 内部测试缝验证，不新增公共面。

## Stage 4 执行注（2026-09-13）

**交付物**：`lib/sessions-plan-mode.js`（核心：结果映射、读视图、观察 cell、审计环、epoch）、`lib/sessions-plan-mode-facade.js`（挂载与 caller-bound 子面）、`lib/index.js`（FEATURE_MOUNTERS 接线）、`lib/guards.js`（`sessionPlanMode` guard 分支）、`lib/plugin-api-service.js`（`_assignFeature`/`_readSlot`/`_disabledSurfaceFor`/`_unmountFeature` 分支 + disabled 面 + sessions getter 合成 + availability 层叠 + `KNOWN_FEATURES`）、`lib/capability-descriptors.js`/`lib/capability-matrix.js`/`lib/namespace-availability.js`（运行时登记镜像）、canonical registry 五条成员行 + `namespaces` 导航记录 + `capabilityMatrix` cluster 行、`README.md` 与 feature-list §7 条目；测试 `test/sessions-plan-mode.test.mjs`、`test/sessions-plan-mode-e2e.test.mjs`、`test/session-plan-mode-migration-slices.test.mjs`、`test/sessions-plan-mode-caller-binding.test.mjs`（第四轮终审新增的真实 cordis 调用方绑定回归），共享官方形状 mock `test/session-plan-mode-test-kit.mjs`。

**与 Task 文字的偏离（逐条登记理由）**：

1. **Task 2.1「把 `sessions.planMode` 加入 `_decoratedNamespaces([...])` 名单」未采用**：`select` 的 owner 派生要求子面按**访问时的调用方上下文**物化（`callerCtx = this?.ctx ?? this`；**修订注（第四轮终审）**：与 `llm`/`events` 同构的前提是 getter 以 method 形式声明——见文末第四轮记录，初期实现误用箭头 getter 导致该前提在真实 cordis 下不成立，现已修正并有真实 cordis 回归锁定），而 `_decoratedNamespaces` 以「原始 surface → 装饰结果」缓存，静态子面会把 owner 归因钉死在门面自身。实现改为：sessions getter 先取装饰后的基面，再按访问合成 `planMode`（命名空间与 `availability` 成员在任何时刻都存在，退化时由 disabled 面回答）。availability 语义不变——装饰器对已合规的 `{status, reason?}` 一律保留。
2. **审计环 payload 构建移入 guarded 跨度**：原实现把字段构造放在 try 之外，写失败路径不可达；现构造与入环同处 try，恶意/损坏 entry 退化为 `gapSince` 缺口标记（Req 5.2），并成为可测行为（`test/sessions-plan-mode.test.mjs`）。
3. **`observe` handle 的 `current()` 返回经核验的读视图**（与 `get` 同形、`source` 字段区分 official/degraded/unavailable），而非最近一次投递 payload——对齐 `attention.observe.handle.current()` 与 `sessions.activity.observe.handle.current()` 的同域先例；变更流由 `subscribe` 承载（design 数据模型的两条形状各自独立，不混用）。
4. **`select` 结果严格取 design 声明字段**：`{ ok, code, reason?, commitState?, mode?, pending?, appliedAt? }`，实现中一度多出的 `target` 已移除（design 数据模型与 registry `currentShape` 一致）。
5. **观察降级可恢复**：每次投递以官方重读为证据，重读成功即清除 `degraded` 标记（源恢复后继续投递），重读失败/形状异常才置降级，绝不猜测。
6. **诊断接线**：authority 的 `logger` 形参按既有先例接收门面 logger（原先误传函数导致 `warn` 静默），审计写失败与重读失败经 bounded 诊断输出。

**Task 6.8 回写**：design §C4 已同步 Stage 4 运行结论——冻结 runtime 源码级核实确认 `turn()` 在 `finally` 中无条件 `session.append('turn/end', …)`（`session.append` 即 `session/event` 派发点；`step/start` 在两条提前退出分支不会 append，机制性保证来自 `turn/end`），故**不存在**「静默清除后无日志活动」窗口，结算按机制性路径投递；P1/P2 复核无偏差（narration 条件性注入、`exit_plan_mode` 常驻注册）。

**既有精确列表断言的同步点（Task 2.1 列举 + 实跑补全）**：`test/host-cutover.test.mjs`、`test/index-session.test.mjs`、`test/index-agent.test.mjs`、`test/index-profile.test.mjs`、`test/index.test.mjs`、`test/index-session-durable.test.mjs`、`test/official-passthrough-independence.test.mjs`、`test/security-policy-assembly.test.mjs`，以及 Task 2.1 未列出的 `test/index-tools.test.mjs`、`test/index-events.test.mjs`、`test/index-system-prompt.test.mjs`、`test/index-remote.test.mjs`、`test/index-diagnostics.test.mjs`（feature 数与尾部顺序断言，逐一对齐至 38 项与 `sessionPlanMode` 位置）。

### 全局终审（第一轮）意见与处置（2026-09-13）

终审返回「有意见」八条（3 高 / 2 中 / 3 低），逐条处置如下；**高/中意见均已实质修订并新增回归**：

1. **（高）前置拒绝未记审计** → `select` 改为「拒绝路径与提交尝试同环记录」：owner 派生提前到拒绝之前（仅用于归因），`invalid-target`/`invalid-input`/`unavailable`/`denied` 全部入环（含 bounded `reason`）。新增断言：五类拒绝的 outcome 序列、`target`/`requested`（畸形请求记 `unknown`）与 `reason` 在场；并补「多前置同时失败时的声明顺序」用例（availability 优先于目标，目标优先于入参）。
2. **（高）close 通知违反冻结的投递形状** → 按 design §C4「目标 session 关闭后投递停止」与 Task 3.4 改写 `ingestSessionDisposed`：close 事实**不再向监听者投递**（变更流只承载状态变化，不承载生命周期通知），改为即时置 `closed`/`degraded` 并清空监听者；`current()` 返回带 reason 的 degraded 视图；已关闭/stale handle 上的 `subscribe` 返回 no-op disposer，不再以非冻结形状回调。单测/e2e 同步改写并把「订阅 payload 恒为 `{ target, view, observedAt }`」作为断言方向。
3. **（高）组合证据缺失（Req 10.3 / Task 6.4）** → 新增 e2e 用例「两个独立 plugin tree 共享同一官方 seam、反向注册顺序」：B 先注册观察、A 后注册；四次 select 的官方仲裁码序列确定性（committed/committed/committed/noop）、每次恰好触达官方 seam 一次、两棵树读同一 authority（无第二状态）、各自经自身事件基底收到同一 view。
4. **（中）降级证据不完整** → 新增 e2e 用例「事实流不可用只降级观察面」：`availability()` 为 `degraded`、读/写面仍走官方、`sessions.availability().reason` 含 `plan mode degraded`、主门面不被停用；另一用例断言 disabled 面下无关能力（`sessions.get/observe`、`tools.register`、`events.observe`、`sessions.activity`）仍在、父 capability 未被拖为 unavailable。
5. **（中）registry availability 行的 scope/authority 与 design 表不符** → 复核仓库全局惯例（39 条 `*.availability` 行的 scope 分布为 facade 30 / session 4 / profile 3 / workspace 2；authority 取域 authority 而非 `facade`）后，判定 **design 表为异类**，修订 design「Registry 拟新增行」的 availability 行（`scope: session→facade`、`authority: facade→official plan-mode authority`）；registry 行本就符合惯例，不再改动。属 spec 修订，已登记。
6. **（低）审计多出未声明的 `reason`** → 采纳而非删除：Task 4.4 已按「reason 截断」要求该字段存在，故把 `reason?`（bounded）补入 design §C5 记录字段与 Data Models，并注明该 Stage 4 修订以本行为准。
7. **（低）design §C4 结论的源码论据不准** → 复核官方 `turn()`：`step/start` 在两条提前退出分支不 append，机制性保证来自 `finally` 中无条件的 `turn/end`；design §C4 结论段已按 `turn/end` 修正（结论「无窗口」不变）。
8. **（低）`select` 前置检查顺序与 design §C3 不一致** → 按 design 声明顺序重排实现（availability → 目标 → 入参 → owner → 审计 attempt → 官方 set），并新增顺序用例固化该行为。

### 全局终审（第二轮）意见与处置（2026-09-13）

第二轮返回「有意见」五条（1 高 / 1 中 / 3 低），均已实质修订：

1. **（高）`availability()` 在核心 inactive 时抛错** → 违反 Req 7.1 / api-idioms §3.8「availability 永不抛错」；disabled 面的 `availability`（含工厂级与 surface 成员）不再 `assertActive`，inert core 下同样返回冻结 `{status:'unavailable', reason}`；数据成员（`get`/`select`/`observe`）保留 inactive-core 的既有无条件 typed-throw（与全门面其余 namespace 一致）。新增 inert-core 用例断言 availability 不抛、数据成员按既有语义抛 `PluginApiInactiveError`。
2. **（中）无 `session/disposed` 时未按在场性停止投递** → `deliver` 增加在场性核验（三态：在场 / 已消失 / 不可核验）：官方 store 不再持有该 session 时即时退休 handle（`closed` + 清空监听者），不可核验时跳过本次投递并置 degraded，绝不投递不可核验的状态。新增单测与 e2e 用例（仅删除 store 记录、不派发 close 事实）。
3. **（低）公共 reason 未 bounded** → `preflight` 的 `invalid-target` reason 截断至 240（调用方提供的 session id 不再原样外泄），诊断消息同样截断；新增用例覆盖 5 万字符 session id 下的 `select`/`get`/审计/诊断四处。
4. **（低）Task 6.6 的跨域零调用断言未落地** → harness 新增 `probeCrossDomain()`（在 boot 后安装记录型代理，覆盖 permissionPresets/approval/security/sandboxPolicy/sandbox），新增 e2e 用例断言 `select`/`get`/`observe`/投递全链路对该五面零访问。
5. **（低）执行注残留旧论据与数字** → 本节已修正为 `turn/end` 论据、测试用例计数改为按终审记录口径、availability scope 统计改为精确值（facade 30 / session 4 / profile 3 / workspace 2）。

修订后回归：plan-mode 三个测试文件全绿；`npm test` 全量绿；registry validator `registry valid`；`git diff --check` 干净；client bundle `--check` 一致。

### 全局终审（第三轮）意见与处置（2026-09-13）

第三轮返回「有意见」三条（2 中 / 1 低），均已实质修订：

1. **（中）`deliver` 把「sessions 服务不可用」误判为「目标已消失」** → 三态在场性经显式 seam 落地：核心改取 `resolveTargetPresence`（`true` 在场 / `false` 已消失 / `null` 不可核验），facade 在 `sessions` 服务缺失或 `get` 抛错时返回 `null`。`false` 才退休 handle；`null` 只跳过本次投递并置 degraded，绝不推断关闭；`preflight` 对 `null` 返回 typed `unavailable`（读面 `unavailable` 视图、写面 `unavailable` 拒绝），不再报 `invalid-target`。handle 在 target 身份可解析时即入册（不可核验是暂时状态），store 恢复后同一 handle 继续投递。新增三个用例：不可核验时读/写/投递的诚实降级、store 恢复后续投、以及（原）已消失目标的即时退休。
2. **（中）已挂载 + 核心 inactive 时 `sessions.planMode` 成员消失** → sessions getter 在 live slot 抛错（inert core 下 `createFeatureSlot` 的 `assertAvailable`）时，改为回退到 typed disabled 面再合成，成员在任何状态下都存在且 `availability()` 永不抛。新增用例：先正常挂载、再以 inert core reconcile，断言成员在场与 `{status:'unavailable', reason}` 形状。
3. **（低）5 万字符 id 用例的诊断断言空真** → 该用例补上真实诊断路径（在场性可核验 + 官方 `get` 抛错），断言诊断恰为一条且长度 bounded；原先的拒绝路径改为显式断言「不产生诊断」。

修订后回归：plan-mode 三个测试文件全绿；`npm test` 全量 3231/3231 绿；registry validator `registry valid`；`git diff --check` 干净；client bundle `--check` 一致。

### 全局终审（第四轮）意见与处置（2026-09-13）

第四轮返回「有意见」一条（**阻塞**），已实质修订：

- **（阻塞）`sessions` getter 用了箭头函数，caller-bound owner 派生在真实 Cordis 运行时失效** —— 复核方式：用真实 `@deepseek-ai/cordis` 树做只读探针，同一个 Service 上并列定义箭头 getter 与 method getter，再从子插件访问；结果 `arrow → fiber.name = 'ProbeService'`（服务自身注册上下文）、`method → fiber.name = 'Caller'`（访问方），结论成立：cordis 以**访问上下文作为接收者**调用访问器，箭头 getter 的 `this` 恒为服务实例，`callerCtx` 因此退化为服务自身上下文——所有第三方 `select` 的审计 owner 被记成门面自身（或不可归因 → `denied`），与 Req 5.3 / design §C5 / Task 2.2、6.4 不一致；此前 mock 基座的 `plugin(Class) { new Class(ctx) }` 不经过 cordis 的接收者重绑定，故 e2e 的 owner 断言为空真。

  处置：(a) `sessions` getter 改为 **method 风格**（`get() { … }`，与 `agents`/`llm`/`events` 同构），并加注释写明该接收者语义与箭头 getter 的后果；(b) 新增真实 Cordis 回归测试 `test/sessions-plan-mode-caller-binding.test.mjs`——在真实树上挂载门面与真实 feature，两个调用方插件各自经公共面 `select`，断言 (i) 两个调用方拿到**各自**的子面（箭头 getter 下两者相同 → 红）、(ii) 审计逐条 owner 为 `CallerA`/`CallerB`（派生自访问方而非门面）；(c) 做变异检验：把 getter 临时还原为箭头形式，新测试立即变红（`each caller receives its own materialized sub-surface`），恢复后转绿——确认该回归测试真能锁住此缺陷类别。

  同时修正「Stage 4 执行注」第 1 条中「与 `llm`/`events` 的 caller-bound 成员同构」的不实表述：本 feature 的子面物化本身是正确的方向，但 getter 必须以 method 形式声明才能拿到调用方上下文；纯 mock 基座无法观察该语义，故此类断言必须有真实 Cordis 承载。

修订后回归：plan-mode 四个测试文件全绿（含新真实 Cordis 回归）；`npm test` 全量 3232/3232 绿；registry validator `registry valid`；`git diff --check` 干净；client bundle `--check` 一致。

### 全局终审（第五轮）意见与处置（2026-09-13）

第五轮确认第四轮阻塞意见已实质闭合（审查方以独立真实 cordis 探针复核：method getter 下两个调用方分别归因 `CallerA`/`CallerB`，箭头语义下两者拿到同一子面必红），无新增阻塞/高/中问题；另报两条低度缺口，均已修复：

1. **（低）治理编号泄漏进新增测试注释** → 删除 `test/sessions-plan-mode-caller-binding.test.mjs` 与 `test/session-plan-mode-migration-slices.test.mjs` 中的 `(Req 5.3)`/`(Task 6.7)` 字样（AGENTS §6：治理编号不得进入实现与测试代码），并全量扫描本 feature 新增/改动文件确认无同类残留。注：`test/governance-token-audit.test.mjs` 的正则族不覆盖 `Req N`/`Task N` 形态，属既有审计盲区（历史先例见 packages/agent-loop/test/interaction-slice.test.mjs），本 feature 只保证不再新增。
2. **（低）feature-list §7 条目缺 Task 5.3 点名的两项内容** → 条目补齐：(i) 与 `session-permission-preset-control` 的正交分工及 `interactive-session-access` 的消费关系（client 编排归后者，消费本面 `get`/`observe` 取模式约束、不自建状态）；(ii) 官方 native 路径（官方 TUI、`/plan`、`exit_plan_mode`）经同一官方 `set`/`onBoundary` seam，不经门面 owner/审计、门面不拦截不重复协调。

修订后回归：`npm test` 全量 3232/3232 绿；plan-mode 测试全绿；registry validator `registry valid`；`git diff --check` 干净；client bundle `--check` 一致。

### 全局终审（第六轮）意见与处置（2026-09-13）

第六轮确认前五轮全部意见无回归，仅报两条低度文档自洽问题，均已修复：

1. **（低）状态行测试计数过期（3219/3219）** → 回写为最终口径 3232/3232（并在状态行注明计数随各轮处置增长、以文末最新一轮记录为准）。
2. **（低）执行注「交付物」清单漏列真实 cordis 回归测试文件** → 清单补入 `test/sessions-plan-mode-caller-binding.test.mjs`（第四轮新增）并注明其用途。

修订后回归：`npm test` 全量 3232/3232 绿；registry validator `registry valid`；`git diff --check` 干净；client bundle `--check` 一致。

### 全局终审（第七轮）意见与处置（2026-09-13）

第七轮确认前六轮意见无回归，另报三条低度问题，均已修复：

1. **（低）测试替身 narration 语义与官方不符** → 复核官方 `narration()`（`told === undefined || told === target` → 不注入）后修正 mock：`told` 语义改为「最后一次 header 所述模式」（新增 `markHeader` 缝），首个 header 之前不注入；e2e 断言随之改为「首次切换 0 条、header 告知另一模式后切换 1 条」，不再固化偏差。
2. **（低）tasks.md 审查记录节首条数与清单不符** → 第二轮节首改「两处新偏差 + 四处欠定义 = 6 条」、第三轮节首改「两处中等 + 四处低度 = 6 条」，与各自清单及状态行的「八条 → 六条 → 六条 → 两条」一致。
3. **（低）design §C4 与 Task 3.2 的 `current()` 语义未随实现回写** → 两处正文同步为「`current()` 返回该 handle 目标的读视图（与 `get` 同形、每次调用经官方重读核验），变更流由 `subscribe` 承载」，与执行注第 3 条偏离登记一致（此前仅有执行注记录、正文未改）。

修订后回归：plan-mode 四个测试文件 39/39 绿；`npm test` 全量 3232/3232 绿；registry validator `registry valid`；`git diff --check` 干净；client bundle `--check` 一致。

### 全局终审（第八轮）意见与处置（2026-09-13）

第八轮确认前七轮意见无回归，另报两条问题，均已修复：

1. **（中）未绑定目标的 handle 把非生命周期错误谎报为 `stale`** → `observe(null)` / `observe({})` 等无法解析身份的目标此前进入「未入册 → `live()` 为假 → `current()` 报 `stale`」路径，而该 handle 是刚创建、既未 dispose 也未换代。修正：区分 `bound`（身份可解析）与 `live()`（未 dispose、epoch 未换代、已入册），未绑定目标的 `current()` 直接委托 `readView`，返回与 `get`/`select` 同源的诚实 reason（`unavailable` + 真实原因）；未绑定目标上的 `subscribe` 返回 no-op disposer、不回调。新增用例覆盖四种畸形目标 ×（读视图 / 订阅 / dispose 幂等）并与读/写面 reason 家族对账。
2. **（低）第三轮节首严重度分布标注与清单不符** → **经复核该意见本身不成立，不予采纳**：第三轮清单 1–6 的逐条标注为（中）（中）（低）（低）（低）（低），即 2 中 + 4 低，节首原写「两处中等问题与四处低度完整性/同步问题」本就与清单一致（`grep -o "（[中高低]）" | sort | uniq -c` → 2 中 / 4 低）。审查意见所述的「三处中等 + 三处低度」为误读；本轮曾一度按其改写，复核制品后已回退为原文，并在此登记该裁决与证据。

修订后回归：plan-mode 四个测试文件 40/40 绿；`npm test` 全量绿；registry validator `registry valid`；`git diff --check` 干净；client bundle `--check` 一致。

### 全局终审（第九轮）结论（2026-09-13）

**无偏差**。审查方独立复核：第八轮第 1 条已闭合（四种畸形目标的 handle 经核心与公共面均返回与 `get`/`select` 同源的诚实 reason、订阅 no-op、dispose 幂等；bound 目标的投递/close/stale/epoch 语义未变）；第八轮第 2 条的否决成立（第三轮节首与清单逐条标注一致，独立复算 2 中 / 4 低）；registry validator `registry valid`、plan-mode 四个测试文件 40/40、全量 `npm test` 3233/3233、`git diff --check` 与 client bundle `--check` 均通过。据此进入 Stage 4 完成提交。
