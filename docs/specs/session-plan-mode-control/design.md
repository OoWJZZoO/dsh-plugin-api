# Stage 2 - Design

> feature_name: `session-plan-mode-control`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）。Goal 于 2026-09-11 获批；Requirements 与 Design 同批交付。本文只定义设计与可验证契约，不创建 Tasks、不写实现代码；Tasks 以对抗性审查为门（AGENTS.md §3.2），通过后进入 Stage 4。
> 上游输入：本目录 `goal.md`（2026-09-11 获批）、`requirements.md`（同批交付基线）；M10 工作纲领 §3.4（OBS-04）；M7 deletion report B4-3；canonical registry `services.planMode` 现状。

## Status

Stage 2 Design（2026-09-12 交付，Stage 0–2 已交付）。本文与已交付的 Requirements 一一对应；所有公共 path、结果码、观察机制、审计载体与并发规则在本文件定稿。实现通道为 **A 类受控包装（方案一门面转译）**：官方 `dsh-plan-mode` 组件在冻结 runtime（`@deepseek-ai/dsh-plan-mode@0.1.0-rc.6`）中保留完整写入 seam，无需 B 类模拟、无 upstream proposal、**无 R 点位**（官方 seam 存在且契约完整，R 评估不触发 `capability-strategy.md` §2 的 B→R 条件）。

## Overview

`session-plan-mode-control` 在主门面新增 `pluginApi.sessions.planMode` 命名空间，为第三方插件提供受控、可追溯的目标 Plan Mode 切换面：

- **写**：`select(agent, active)` —— 包装官方 `planMode.set(agent, active)`，补 owner 归因、审计与官方结果码如实映射；不恢复裸 singleton setter（`services.planMode` 白名单不回流写成员）。
- **读**：`get(agent)` —— 官方 authority 之上的冻结视图（含 pending 选择）。
- **观察**：`observe(agent)` —— 官方事实流（session 日志 `plan/mode` 经 `session/event` firehose）之上的 projection-observe 面，target 绑定的 per-target handle；官方路径（官方 TUI、`/plan` 命令、`exit_plan_mode` 工具）引发的变更同样可达。
- **自描述**：`availability()`。

不新建与官方模式无关的状态机：门面不自维护第二份 mode 状态，一切读/观/写均以官方服务与 session 日志为唯一事实源。

## Architecture

```text
third-party plugin ──▶ pluginApi.sessions.planMode
                        ├── get(agent) ───────────▶ official planMode.get(agent)          [A]
                        ├── select(agent, active) ─▶ official planMode.set(agent, active) [A] + owner/audit
                        ├── observe(agent) ──┐
                        │               ├── ctx.on('session/event') firehose  [A，官方派发点直绑]
                        │               └── 变更判定：official planMode.get(agent) 重读核验
                        └── availability() ──▶ official service presence + feature state

官方既有写路径（本 feature 不拦截、不包装）：
  official TUI toggle / `/plan` command / exit_plan_mode tool ─▶ 同一 official set/onBoundary seam
```

数据流单向：官方日志（`plan/mode` 事实）→ 官方服务 fold → 门面读/观投影；`select` 是唯一受支持的门面写路径，经官方 seam 提交；门面不向 prompt/policy/projection 反写模式状态（Req 4.3）。

### 官方契约证据（冻结 runtime 实测，`@deepseek-ai/dsh-plan-mode/lib/index.js`）

| 官方事实 | 证据锚点 |
|---|---|
| `set(agent, active): 'committed' \| 'queued' \| 'cancelled' \| 'noop'`，同步、无 signal 参数 | `PlanModeController.set`（lib/index.js:339–358） |
| `committed` = 立即 append `plan/mode` 日志事件并注入官方叙述消息 | 同上（353–357） |
| `queued` = 开 turn 期间记录 pending 选择，待下一个被接受的 in-turn pre-step 由 `onBoundary` 落日志 | 同上（342–348）+ `onBoundary`（360–370） |
| `cancelled` = 请求目标与日志态一致、清除反向 pending，不追加日志事件 | 同上（347、349–352） |
| `noop` = 请求目标已等于生效状态（含 pending），无任何变更 | 同上（341） |
| `get(agent): { active, pending? }`，读日志 fold + 官方私有 pending 表 | `PlanModeController.get`（315–322） |
| 状态唯一事实源 = session 日志 `plan/mode`（last wins）；"UIs observe committed flips through `session/event`; there is no live mirror" | 模块文档（7–20、107–109）+ `foldPlanMode`（73–82） |
| 官方消费面：`plan:policy` prompt section、`exit_plan_mode` 工具、`/plan` 命令、`plan` session projection（`{active, pending}`） | 142–181、225–306、182–224 |
| 官方组件无 client manifest、无 remote/slot/设置桥、无版本协商 | 官方 `package.json` 无 `dsh` 键（实测） |

### Namespace 放置（对照 registry 现状）

公共 path 定为 **`sessions.planMode`**（新子命名空间，capability ID `sessions.planMode`）：

- 官方状态按 session 折叠（`plan/mode` 是 durable session 事件），目标是 session 绑定的 agent，官方消费面（prompt assembly、投影、执行约束）全部是 session 域机制 —— `sessions` 是最近既有领域（registry `hostDomainTree` 现有 `sessions` 一等领域，其下已有 `branches`/`channels`/`activity`/`durable` 等 session 作用域子命名空间先例）。
- 不放 `services.planMode`：`services.*` 是 advanced 低层直通层，本 feature 是带门面附加语义（owner/audit/结果映射/观察面）的一等语义面；且 Req 9.1 要求 `services.planMode` 白名单不回流写成员，`services.planMode.get` 原样保留（advanced 直通、与 `llm.*` ↔ `services.llm` 同构的分层共存先例）。
- 与 `sessions.branches.plan`（branch 计划查询）不同子树、语义无关，无命名冲突；registry 现无 `sessions.planMode` path（实测 `members`/`servicesWhitelist`）。

### Client 半面判定（capability-strategy §10 六问，逐项记录）

| # | 问题 | 判定 | 证据 |
|---|---|---|---|
| 1 | 被替换官方行是否声明 client manifest？ | 否 | 本 feature 无 replacement 行；官方 `dsh-plan-mode` 无 `dsh.client` |
| 2 | 是否注册 remote namespace？ | 否 | 门面不新增 remote；官方服务无 remote |
| 3 | 是否提供 slot 或 settings bridge？ | 否 | 官方服务无 slot/settings 桥；门面不新增 |
| 4 | 是否有 client↔host 版本协商？ | 否 | 无新协议族 |
| 5 | 是否有 browser-side state 或重连语义？ | 否 | 观察面在 host；client 经插件自身 remote 转发 |
| 6 | 官方行是否拥有 client-facing event/service？ | 否 | 官方事实流是 host 侧 `session/event`；`session/event` 不在 client remote 转发白名单 |

**结论：host-only，本 feature 不新增公共 client 半面。** client 端交互（独立前端/TUI）经插件自身 remote 调用 host 面（既有 remotes/codec 机制承载）；完整交互接入的 client 编排归 `interactive-session-access`（与 Requirements Introduction 一致）。

## Hook / Binding Classification

| 绑定/钩子 | 引出机制 | 分类 | 失败路径与 guard |
|---|---|---|---|
| `select` → 官方 `planMode.set` | 官方 ctx 服务 `planMode` 的受控包装（经 `ctx.get('planMode')` 存在性探测 + 成员形状校验） | A（受控稳定化） | 服务缺失/成员缺失 → feature 停用，成员返回 typed unavailable；官方未知结果码 → `internal` typed 结果，不猜测 |
| `get` → 官方 `planMode.get` | 同上 | A | 同上；官方抛错 → typed degraded view，不抛穿 |
| `observe` → `ctx.on('session/event')` firehose | 官方派发点直绑（仓库既有先例：`lib/session-activity-adapters.js`、`lib/session-route.js`、`lib/execution-observation-sources.js`） | A | 订阅失败 → feature 降级，观察面 typed unavailable；listener 抛错只降级该监听者 |
| `observe` 变更核验 → 官方 `planMode.get(agent)` 重读 | 官方服务读，事实核验（Req 3.3） | A | 重读抛错 → 该次投递跳过并记 bounded diagnostic，不猜测 |
| audit ring | 门面 authority 内部组件（先例：`lib/security-audit.js`、`adapter-decoration` design §Persistence and audit） | A（门面 authority 基础设施） | 写失败 → gap 标记 + bounded 日志，不伪造记录 |
| pending 结算观察 | `session/event` 活动触发的官方状态重读（见下"queued 结算"） | A | 无 B 类模拟：所有事实均来自官方派发点与官方读 |

**无 B 类底层模拟、无 upstream proposal、无 R 扩展点位**：官方 seam 与派发点（`session/event`）已完整覆盖需求；不登记任何 U-series 提案，不评估 replacement。

## Components and Interfaces

### C1. Feature mount 与 availability guard

- 挂载于主包 `lib/`（新模块，Stage 4 命名），经既有 feature registry 幂等挂载；**fail-safe**：官方 `planMode` 服务缺失、`get`/`set` 成员形状不符或挂载过程任何异常 → 记日志、feature 停用、正常返回，绝不抛穿 apply（AGENTS §2.6）。
- `sessions.planMode` namespace **始终存在**（public-api-shape §5）；不可用时成员返回 typed unavailable 结果（Requirements Req 7.2 选定"返回不抛"呈现，优先于 public-api-shape §5 的"返回或抛"通用规则）。
- `availability()` 返回冻结 `{ status: 'active'|'degraded'|'unavailable', reason? }`：active = 官方服务在场且形状完整；degraded = 服务在场但观察通道降级；unavailable = 服务缺失/错配。永不抛错（Req 7.1）。

### C2. 读面 `get(agent)`（Req 2）

- 目标语义：与官方签名一致，接受官方 agent handle（经 `pluginApi.agents.get/list` 取得或插件上下文持有的同一对象）。
- 返回冻结视图 `{ target, active, pending?, observedAt, source: 'official' }`；`pending` 为官方 pending 选择（存在时透传官方值）。
- 无 plan-mode 状态/官方服务不可用 → typed unavailable/degraded 视图，不抛穿（Req 2.2）。
- 不返回门面自有簿记作为状态（Req 2.1）；与 `services.planMode.get`（advanced 直通，原样保留）同 authority、不同保证层。

### C3. 写面 `select(agent, active)`（Req 1、6）

单次同步提交跨度内完成：availability 检查 → 目标检查 → owner 派生 → 审计 attempt → 官方 `set` → 结果映射。官方 `set` 为同步调用，跨度内无交错窗口。

**官方结果 → 公共结果映射（冻结判别式结果 `{ ok, code, reason?, ... }`，完整表）：**

| 官方返回 | ok | code | 附加字段 | 说明 |
|---|---|---|---|---|
| `committed` | `true` | `committed` | `commitState: 'success'`、`mode`、`appliedAt` | 日志已落 `plan/mode`（Req 1.2：成功 + 结果模式） |
| `queued` | `true` | `queued` | `pending: true`、`mode` | 官方已记录选择，待下一被接受 pre-step 生效；**无 commitState**（日志未提交）；结算经观察面呈现（Req 6.2），先前结果不改写 |
| `cancelled` | `false` | `cancelled` | `reason`（bounded：请求目标已是日志态，反向 pending 被清除，本次调用未变更模式） | goal 硬约束：不伪装成成功切换；无 commitState |
| `noop` | `false` | `noop` | `reason`（bounded：已是请求模式） | goal 硬约束同上；这是 Req 6.3 声明的幂等映射——重复选择收敛到同一 typed 结果，不记第二次 committed、不发第二次官方日志事件 |
| 前置拒绝（服务不可用/目标不可解析或已关闭/owner 不可归因/参数非法） | `false` | `unavailable` / `invalid-target` / `denied` / `invalid-input` | `reason` | 任何副作用之前返回（Req 1.4）；官方状态不变 |
| 官方返回未知结果码（runtime 等价词之外） | `false` | `internal` | `reason` | 不猜测、不伪装（Req 1.3 "runtime equivalents" 边界） |

统一词汇对齐：`ok/code/reason` 按 `api-idioms.md` §2；`commitState` 只在发生官方日志提交的 `committed` 上携带、取统一终态词 `success`（`identity-and-lifecycle.md` §3，不新造终态词）；`cancelled`/`noop`/`queued` 是领域结果码，不是新终态。owner 不可归因（caller fiber 无 loader entry）→ typed `denied`（fail-closed，三线 mutation 面统一规则；普通第三方插件恒有可归因 fiber，root 回退仅用于只读/归因面）。

### C4. 观察面 `observe(agent)`（Req 3）

- **目标绑定（api-idioms §3.1 合规声明）**：观察入口为 **`observe(agent)`**——target（agent handle，与 `get`/`select` 同一目标语义）是入口的显式领域参数（§2 允许领域参数在显式领域字段中变化），返回 **target 绑定的** observe handle `{ current(), subscribe(listener), dispose(), epoch }`（§3.1 固定签名不变，**无 idiom 例外**）；handle 的 `current()` 返回**该 handle 目标**的最新投递视图，`subscribe(listener)` 只接收监听函数。无全局多目标混杂：一个 handle 只服务一个目标，跨目标订阅各自建 handle。
- 形状：projection-observe `{ current(), subscribe(listener), dispose(), epoch }`（`api-idioms.md` §3.1）；observe handle 另登记 `sessions.planMode.observe.handle`。
- 机制（A 类）：feature 挂载时建立**单条** `ctx.on('session/event')` firehose 订阅（facade 级共享）；firehose 事件按 session 匹配到已订阅目标后，重读官方 `get(agent)` 得到组合视图 `{active, pending?}`，与该 handle 上次投递视图不同才投递 `{ target, view, observedAt }`。事实全部来自官方派发点与官方读，不猜测（Req 3.3 的"官方状态核验"）。
- **queued 结算可观察性**（Req 6.2）：结算为 `committed` 时官方落 `plan/mode` 事件 → firehose 直达投递，此为机制性保证。结算为 `cancelled`（`onBoundary` 静默清除 pending，无日志事件）时，投递依赖「被接受 pre-step 之后该 session 随后有日志事件」这一官方 loop 行为——官方文档仅保证 `onBoundary` 在下次 request assembly 前由 plan-mode 服务自身的 `agent/pre-step` handler 调用，**未显式保证后续必有日志事件**；本设计将其列为**待核实项，不作机制性断言**：Stage 4 须在冻结 runtime 上运行验证（accepted pre-step 后 firehose 是否出现可触发重读的事件）。若实测存在「静默清除后无日志活动」的窗口，该分支诚实降级：结算不推送，pending 消失经读面（`get` 的 `pending` 字段）可见，observe 面以 typed 方式记录该降级，不伪造投递。两种结算下，先前 `queued` 结果都不被改写（Req 6.2）。
- 官方路径变更（官方 TUI、`/plan`、`exit_plan_mode`、官方内部）同样经 firehose 可达（Req 3.1）。
- 订阅者回调 throw/rejection 只降级该监听者（containment）；dispose 幂等、stale disposer 不影响其他订阅者（Req 3.2）；目标 session 关闭（`session/disposed`）后投递停止，`current()` 返回带 reason 的 degraded 视图。
- feature 卸载时销毁 firehose 订阅（cleanup owner = feature disposer）；stale 回调（dispose 后到达）失去投递资格（concurrency-and-cancellation §4/§5）。

### C5. 审计与可追溯（Req 5）

- 载体判定：**v1 审计 = feature-authority 内部有界内存环**，进程（profile 生命周期）作用域、非 durable、不新增存储档位、不跨档（`durable-state-and-scope.md` §1–2；Requirements Req 5.1 的非 durable 分支）。先例：`lib/security-audit.js`（容量 512、truncated 标记、gapSince 缺口标记、深冻结脱敏视图）与 `adapter-decoration` design 的 bounded non-durable audit。**不声明 durable 档位**；未来 durable 审计必须是独立 feature（显式 scope + commit 契约）。
- 记录字段（bounded）：`{ seq, at, ownerId, action: 'plan-mode.select', target: '<agentId>', requested: 'enter'|'exit', outcome: <结果码> }`；不含 prompt 内容、消息 payload、owner 私有状态（Req 5.4）。
- owner 派生：caller fiber loader entry（既有 `callerIdentityOf` 机制，先例 `lib/index.js:662`、`lib/plugin-api-service.js:717`）；不接受 caller 自报 owner（Req 5.3）；不可归因 → typed `denied`（见 C3），不产生未归因审计提交记录。
- 写失败：切换保留已声明效果（官方提交不因审计失败回滚），bounded diagnostics 暴露 gap 标记（环内 `gapSince` + bounded 日志），不伪造记录（Req 5.2）。
- v1 无公共审计查询成员（无已证实消费者需求，克制设计）；Stage 4 验证证据经 feature 内部测试缝访问环内容（非公共 `pluginApi` 面）。

## Data Models

```text
select 结果    { ok, code, reason?, commitState?, mode?, pending?, appliedAt? }   // 冻结
get 视图       { target, active, pending?, observedAt, source: 'official' }       // 冻结
observe 投递   { target, view: { active, pending? }, observedAt }                 // 冻结
observe 入口    observe(agent) → target 绑定的 observe handle                    // 领域参数在入口，handle 形状固定（§3.1）
observe handle { current(), subscribe(listener), dispose(), epoch }
audit 记录     { seq, at, ownerId, action, target, requested, outcome }           // bounded，冻结出环
availability   { status: 'active'|'degraded'|'unavailable', reason? }             // 冻结
```

## Concurrency And Conflict Rules（concurrency-and-cancellation §6 声明）

- **外层合同（三线一致）**：乐观比较点与提交不可被并发交错。本线官方 `set` 为同步，单同步提交跨度即满足该规则（异步官方 seam 线的达成方式见 `credential-mutation-contract` design）。
- **并发策略**：官方仲裁保留（`compare-and-swap` 型官方比较——官方 `set` 先比较请求与 pending/日志态再决定 `noop`/`queued`/`cancelled`/`committed`）。门面不发明 silent latest-wins，不覆盖官方仲裁（Req 6.1）。
- **scope 与冲突判定**：scope = 目标 agent 的 plan 状态；冲突判定 = 官方 `set` 的比较结果（唯一裁决）。官方 `set` 与门面包装同为单同步跨度，多个 caller 的并发提交由 host 线程序列化，各自得到官方仲裁码，不存在交错窗口。
- **取消行为**：`select` 为同步短事务，无 signal 参数（官方 seam 无取消点）；本册 §3 取消传播不适用，§1"取消是信号、终态是裁决"由官方结果码承载（`cancelled` 即官方裁决）。
- **提交条件**：官方返回 `committed`/`queued` 即为该次调用的确定结果；queued 的后续结算由官方在 pre-step 边界裁决，门面不补写、不改写（终态唯一、后到信号不改写已提交结果）。
- **cleanup owner**：feature disposer（firehose 订阅、观察 handle、审计环）；插件卸载不影响其他 feature 与其他 owner 的订阅。
- **stale 处理**：dispose 后到达的 firehose 事件不投递；目标 session 关闭后订阅静默停止 + degraded current。

## Error Handling And Guard Strategy

- 挂载失败 → fail-safe 停用（不抛穿 apply）；运行期官方服务消失/降级 → typed unavailable 结果，不伪装成功、不影响主门面其余能力（Req 7.2 的局部失效隔离）。
- 每次 `select`/`get` 经 try 包裹：官方抛错 → bounded typed 结果（`internal`/`degraded`），原始错误经 bounded 日志输出（不含 payload）；不向 caller 抛穿。
- 观察通道降级（firehose 订阅失败）→ availability 记 `degraded`，观察面 typed unavailable；读/写面不受影响。
- 审计失败 → gap 标记 + 效果保留（见 C5）。
- 治理编号/分类字母不进入实现命名（AGENTS §6）；运行时命名用中立能力词（`sessions.planMode` 等）。

## Authority Closure（composition-and-authority §6）

| 写路径 | 归属 |
|---|---|
| `sessions.planMode.select`（门面） | 本 feature 唯一受支持门面写路径；owner 派生 + 审计 + 官方结果映射 |
| 官方 `/plan` 命令、`exit_plan_mode` 工具、官方 TUI toggle | 官方产品面，经同一官方 `set`/`onBoundary` seam 提交——统一 authority = 官方 plan-mode 服务 + session 日志；门面不拦截、不重复协调（官方仲裁一体） |
| `services.planMode.get` | 只读 advanced 直通，白名单不回流写成员（Req 9.1） |
| 直接 inject/import `@deepseek-ai/dsh-plan-mode` | unsupported escape hatch，门面不声称拦截（Req 9.2） |

门面保证的 scope：受支持门面写路径的 owner/审计/结果语义闭合；官方 native 路径的变更经观察面同样可见（同源）。

## Orthogonality（Req 8）

- 本 feature 不读写 permissionPresets、approval、security policy、sandbox 状态；不注册任何影响其他领域的 hook（仅观察 `session/event`）；不提供跨域 setter。
- Plan Mode 与权限预设正交、各归唯一 owner：`sessions.planMode`（本 feature）与 `sessions.permissionPresets`（sibling feature）互不引用对方状态机，可独立组合切换。

## Registry 拟新增行（设计陈述，Stage 4 落地时同步 canonical registry）

| publicPath | idiom | effect | composition | conflictRule | scope | authority | runtime |
|---|---|---|---|---|---|---|---|
| `sessions.planMode.get` | projection | read | pure | not-applicable | session | official plan-mode authority | host |
| `sessions.planMode.select` | mutation | mutate | coordinated | compare-and-swap | session | official plan-mode authority | host |
| `sessions.planMode.observe` | projection | subscribe | additive | not-applicable | session | official plan-mode authority | host |
| `sessions.planMode.observe.handle` | projection | read | pure | not-applicable | session | official plan-mode authority | host |
| `sessions.planMode.availability` | selfDescription | read | pure | not-applicable | session | facade | host |

capability ID：`sessions.planMode`；`eventCatalog` 无新增事件（复用已登记的 `session/event`）。事件语义：本面不自产事实，`plan/mode` 事实的 producer authority 保留在官方 plan-mode 服务。

## Testing Strategy（对应 Req 10）

1. **结果映射**：committed/queued/cancelled/noop 四码逐一断言（含 `cancelled`/`noop` 的 ok:false、`queued` 的 pending 标记与无 commitState）、前置拒绝（无效目标/关闭目标/不可归因）、官方未知码 → `internal`。
2. **官方读回**：committed 后官方 `get` 与门面读面一致；开 turn 中 select → queued → 模拟接受 pre-step 落日志 → 观察面收到结算投递；静默清除路径的投递依赖按 §C4 待核实项在冻结 runtime 上运行验证，实测存在无日志活动窗口时断言诚实降级呈现（读面可见、observe 不伪造投递）。
3. **观察**：官方路径（直调官方 set）引发的变更到达订阅者；回调 throw 隔离；stale disposer 隔离；session 关闭降级。
4. **组合**：两个 synthetic plugin 反向注册顺序、并发 select 确定性（官方仲裁码）、owner 派生（含不可归因 → denied）、重复选择幂等（noop 不计第二次 committed、审计只记 attempt）。
5. **降级**：官方服务缺席 → typed unavailable、availability 诚实、无关能力不受牵连；审计写失败 gap 标记。
6. **registry/surface**：新成员逐成员登记（单一主 idiom）、surface snapshot 一致、`npm test`（4G 护栏）、`git diff --check`、registry/surface 一致、全局终审（Req 10.5）。

## Standards Alignment（逐分册结论）

- `capability-strategy.md`：适用。A 类受控包装（官方 seam 存在）；无 R slice；`services.planMode` 白名单不减不增；§10 六问全否 → host-only；冻结基线内交付。
- `api-shape.md`：适用。主面 mutation；读/观为同 authority 只读成员；无策略注册、无汇总投影；一面原则满足（§3）。
- `api-idioms.md`：适用。mutation 判别式结果（§3.3）、projection 形状（§3.1）、availability/selfDescription（§3.8）；统一词汇 `ok/code/reason`/`commitState`（§2）；不新增第九 idiom。
- `public-api-shape.md`：适用。挂靠最近既有领域 `sessions`（§1）；namespace 常在、capability path 语义化（§5）；不引入 package/row 身份。
- `composition-and-authority.md`：适用。owner 派生不可伪造（§5）；authority closure（§6，含官方 native 路径归一说明）；composition mode `coordinated`；§9 合作插件模型下不做 IAM。
- `domain-composition.md`：适用。planMode/permissionPresets/approval/security 各归唯一 owner；不建跨域状态机。
- `ordering.md`：适用（有限）。无多 owner 顺序决策；firehose 订阅为 additive 观察，不承载业务排序。
- `identity-and-lifecycle.md`：适用。统一终态词汇经 `commitState`（仅 committed 携带 `success`）；queued 结算经观察面、不改写已提交结果（§3）；无新 identity 类型。
- `durable-state-and-scope.md`：适用（有限）。模式事实的持久性归官方 session 日志；v1 审计为进程作用域非 durable 环，不新增存储档位、不跨档。
- `visibility-and-redaction.md`：适用。审计与 reason bounded、无 payload；观察投递只含官方模式视图；无 secret 面。
- `concurrency-and-cancellation.md`：适用。§6 声明见上；官方仲裁优先；stale 投递失去资格（§4/§5）。
- `versioning-and-protocols.md`：适用。冻结基线内交付；无新 wire/durable 协议（无跨进程新数据；观察面为 host 进程内）。

## Requirements Traceability

| Requirement | 设计承载 |
|---|---|
| Req 1 受控切换入口 | C3（select + 完整结果映射表 + 前置拒绝） |
| Req 2 忠实读取 | C2（get 冻结视图 + typed 降级 + 单一来源） |
| Req 3 变化观察 | C4（firehose 直绑 + 官方重读核验 + containment） |
| Req 4 单一事实源 | Architecture 数据流 + Authority Closure（不自维护第二状态、不反写 prompt/policy） |
| Req 5 审计 | C5（bounded 非 durable 环 + owner 派生 + gap 标记） |
| Req 6 并发/重复/官方仲裁 | C3 映射表 + Concurrency 声明 + C4 结算观察 |
| Req 7 availability/能力/降级 | C1 + C2/C3/C4 的 typed unavailable 呈现 |
| Req 8 与邻域正交 | Orthogonality |
| Req 9 无裸 setter 回归 | Authority Closure（services 白名单不变、escape hatch 不拦截） |
| Req 10 验证与交付门 | Testing Strategy |
