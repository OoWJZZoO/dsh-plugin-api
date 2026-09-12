# Stage 2 - Design

> feature_name: `session-permission-preset-control`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）。Goal 于 2026-09-11 获批；Requirements 与 Design 同批交付。本文只定义设计与可验证契约，不创建 Tasks、不写实现代码；Tasks 以对抗性审查为门（AGENTS.md §3.2），通过后进入 Stage 4。
> 上游输入：本目录 `goal.md`（2026-09-11 获批）、`requirements.md`（同批交付基线）；M10 工作纲领 §3.5（OBS-05）；M7 deletion report B4-4；canonical registry `services.permissionPresets` 现状（current/resolve/optionOf）。

## Status

Stage 2 Design（2026-09-12 交付，Stage 0–2 已交付）。本文与已交付的 Requirements 一一对应；公共 path、写包装、authority closure、观察机制、冲突规则、审计载体在本文件定稿。实现通道为 **A 类受控包装（方案一门面转译）**：官方 `dsh-permission-presets` 组件在冻结 runtime（`@deepseek-ai/dsh-permission-presets@0.1.0-rc.6`）保留写入 seam `set(session, name)`，无需 B 类模拟、无 upstream proposal、**无 R 点位**（官方 seam 与官方派发点完整覆盖需求，不触发 `capability-strategy.md` §2 的 B→R 条件）。

## Overview

`session-permission-preset-control` 在主门面新增 `pluginApi.sessions.permissionPresets` 命名空间，为受信操作方提供受控、可追溯的目标权限预设选择面：

- **查询**：`current(session)`（官方当前生效选择，含官方派生的 `custom` 态）与 `options(session)`（官方预设选项表 + 当前值，官方 `permissions` projection 视图）。
- **写**：`select(session, name)` —— 包装官方 `set(session, name)`，补 owner 归因、审计、提交前检查与官方状态读回；不恢复裸 setter。
- **观察**：`observe(session)` —— 官方事实流（session 日志 `permission/preset`、`sandbox/mode`、`approval/policy` 经 `session/event` firehose）之上的 projection-observe 面，target 绑定的 per-target handle。
- **自描述**：`availability()`。

官方 preset 的判定权完整保留在官方 authority：门面不复制、不重排、不覆盖预设内部判定逻辑（Req 9.3）。**选择预设 ≠ 一次批准（approval）≠ 注册 security policy**：本面不提供 approval 授权或 policy 注册，三者各自归 owner（Req 9.2）。

## Architecture

```text
authorized caller ──▶ pluginApi.sessions.permissionPresets
        ├── current(session) ────▶ official permissionPresets.current(session.events)   [A]
        ├── options(session) ────▶ official sessionProjections snapshot('permissions')  [A]
        ├── select(session,name) ─▶ official permissionPresets.set(session, name)       [A] + 前置检查/读回/owner/audit
        ├── observe(session) ──┐
        │               ├── ctx.on('session/event') firehose            [A，官方派发点直绑]
        │               │     filter: permission/preset | sandbox/mode | approval/policy
        │               └── 变更判定：official current(session.events) + options 重读核验
        └── availability()

官方既有写路径（本 feature 不拦截）：
  official `/permission` command ──▶ 同一 official apply/set seam（durable session 事件）
  official settings `permission.defaultPreset` ──▶ settings authority（未来 session 默认值，非当前选择）
```

数据流单向：官方 session 日志（`permission/preset` + knob 事件）→ 官方 fold/投影 → 门面读/观投影；`select` 是唯一受支持的门面写路径。

### 官方契约证据（冻结 runtime 实测，`@deepseek-ai/dsh-permission-presets/lib/index.js`）

| 官方事实 | 证据锚点 |
|---|---|
| `set(session, name)`：同步、无返回值；内部 `apply(session, name, setApprovalPolicy)` | `PermissionPresetService.set`（lib/index.js:266–270） |
| `apply`：`resolve(name)` 对未知名抛错；`current(events) !== name` 时 append `permission/preset`；随后按需 `setSandboxMode` / `setApprovalPolicy`（各自仅在值变化时 append `sandbox/mode` / `approval/policy`） | `apply`（271–278）+ `resolve`（235–239） |
| `current(events)`：从 knob 事件 fold 派生预设名或 `custom`（派生态，永不为切换目标、不出现在事件 payload） | `current`/`derive`（201–215）+ 模块文档（8–15、19–23） |
| 选项表：`names` getter（声明序）；`optionOf(name)` → `{ value, name, description? }`；`selectFor(state)` → `{ options, currentValue }`（即 `permissions` projection 视图） | 183–228 |
| 官方读取载体：`permissions` session projection（key `permissions`，view `{options, currentValue}`），经官方 `sessionProjections.snapshot(session)` 可读 | 143–152 + `dsh-session-projection/lib/index.js` `snapshot`（105–109） |
| 状态唯一事实源 = session 日志（`permission/preset`、`sandbox/mode`、`approval/policy` 事件，last wins） | `effectivePermissionPreset`（32–37）+ `foldKnobs`/`applyKnobEvent`（51–73） |
| 相邻但不同 authority：`permission.defaultPreset` settings namespace 只承载未来 session 默认值（`installSettingsSection`） | 24–26、117–130 |
| 官方写路径：`/permission` command handler 直调 `this.apply(...)`；`dsh-client-ui-permission-presets` 是**独立官方 client 插件**（消费投影与 settings），不属于本服务行 | 153–177；官方包清单 |
| 官方组件无 client manifest（服务行）；无版本协商 | 官方 `package.json` 无 `dsh` 键（实测） |

### Namespace 放置（对照 registry 现状）

公共 path 定为 **`sessions.permissionPresets`**（新子命名空间，capability ID `sessions.permissionPresets`）：

- 目标是 session（官方 `set(session, name)`），状态折叠自 session 日志，官方读取载体是 session projection —— `sessions` 是最近既有领域（registry `hostDomainTree` 现有 `sessions` 一等领域，session 作用域子命名空间先例同 `sessions.planMode`）。
- 不放 `security.*`：facade `security` 域承载的是**插件贡献的** policy/redaction/egress 注册（`register` 类 decision 面，见 `domain-composition.md` §2 `security` 行）；预设选择是官方 session 状态的 mutation，不是策略注册，idiom 与 owner 均不同。放在 `security` 会让"注册 policy"与"选择预设"两种行为在树上混义，违反 goal Boundary。
- 不放 `services.permissionPresets`：与 `sessions.planMode` 同理——一等语义面与 advanced 直通分层共存（`services.permissionPresets` 的 current/resolve/optionOf 原样保留，白名单不回流 `set`/`selectFor` 写成员，Req 10.1）。
- registry 现无 `sessions.permissionPresets` path（实测）。

### Client 半面判定（capability-strategy §10 六问，逐项记录）

| # | 问题 | 判定 | 证据 |
|---|---|---|---|
| 1 | 被替换官方行是否声明 client manifest？ | 否 | 本 feature 无 replacement 行；官方服务行无 `dsh.client` |
| 2 | 是否注册 remote namespace？ | 否 | 门面不新增 remote |
| 3 | 是否提供 slot 或 settings bridge？ | 否（门面侧） | 官方服务的 `permission.defaultPreset` settings section 是官方 host 侧设置面（settings authority 承载），门面不包装、不复制；官方 client UI 是独立官方插件，不属本服务行 |
| 4 | 是否有 client↔host 版本协商？ | 否 | 无新协议族 |
| 5 | 是否有 browser-side state 或重连语义？ | 否 | 观察面在 host |
| 6 | 官方行是否拥有 client-facing event/service？ | 否 | `session/event` 不在 client remote 转发白名单 |

**结论：host-only，本 feature 不新增公共 client 半面。** 低信任 client/remote 的请求只能经某个插件自身 remote 到达 host，并以该插件的 owner 身份被归因；门面不因该面扩大任何 caller 的权限（Req 3.2，机制见下 Trust 节）。

## Hook / Binding Classification

| 绑定/钩子 | 引出机制 | 分类 | 失败路径与 guard |
|---|---|---|---|
| `select` → 官方 `permissionPresets.set` | 官方 ctx 服务受控包装（`ctx.get('permissionPresets')` 存在性 + 成员形状探测） | A（受控稳定化） | 服务缺失/形状不符 → feature 停用 + typed unavailable；官方抛错 → bounded typed 结果 |
| `current` → 官方 `current(session.events)` | 同上 | A | 官方抛错 → typed degraded 视图 |
| `options` → 官方 `sessionProjections.snapshot(session)` 的 `permissions` 视图 | 官方服务读（`services.sessionProjections` 已登记白名单成员 `snapshot`） | A | 投影缺位/降级 → typed degraded（`options` 空 + reason），不伪造选项 |
| `observe` → `ctx.on('session/event')` firehose 过滤三种 knob 事件 | 官方派发点直绑（仓库先例同 plan-mode 线） | A | 订阅失败 → 观察面 typed unavailable；listener 隔离 |
| 观察核验 → 官方 `current(session.events)` / snapshot 重读 | 官方服务读 | A | 重读失败 → 跳过该次投递 + bounded diagnostic |
| audit ring | 门面 authority 内部组件（三线统一先例） | A（门面 authority 基础设施） | 写失败 → gap 标记，不伪造 |

**无 B 类模拟、无 upstream proposal、无 R 点位**：官方派发点（`session/event`）覆盖全部选择事实；无 U-series 登记。

## Components and Interfaces

### C1. Feature mount 与 availability guard

与 plan-mode 线同构（fail-safe 挂载、namespace 常在、成员 typed unavailable 不抛穿、`availability()` 冻结三态）。availability 反映官方 `permissionPresets` 服务与 `sessionProjections` 读载体的可达性：读载体缺失记 `degraded`（select 仍可用），服务缺失记 `unavailable`。

### C2. 查询面（Req 1）

- `current(session)` → 冻结 `{ target, preset, observedAt, source: 'official' }`；`preset` 为官方派生名（含官方 `custom` 派生态——如实透传，`custom` 永不接受为 `select` 目标）。官方语义下不存在"无选择"态（空日志由官方 `pinInitialPermission` 落初始事实）；若官方返回异常缺失 → typed degraded 视图（Req 1.2 的 typed absence 分支仅覆盖该降级路径）。
- `options(session)` → 冻结 `{ target, options: [{value, name, description?}...], currentValue, observedAt }`，来自官方 `permissions` projection 视图（官方声明的选项集合与描述字段；门面不增删改名——Req 1.1）。描述字段为官方配置的 bounded 非敏感文案（Req 1.1；门面再做 bounded/脱敏防御，见 Standards）。
- 继承/覆盖语义**以官方为准**（goal Scope direction）：一次 `select` 的效果 = 官方 `apply` 的官方语义——当前生效选择已在目标名上时不再 append 事件；knob 值与目标预设 spec 不一致时分别落 `sandbox/mode`/`approval/policy`；跨目标的"继承"仅存在于官方 `pinInitialPermission` 对新建 session 落默认预设（settings `defaultPreset` authority），门面不另造继承规则。

### C3. 写面 `select(session, name)`（Req 2、3、6）

单次同步提交跨度内完成（官方 `set` 为同步）：

1. **前置检查（任何副作用之前，Req 2.3/3.1）**：
   - 请求参数：缺失或类型不符（如 `name` 非字符串、session 参数缺位）→ `{ ok:false, code:'invalid-input' }`（官方状态不变）。
   - availability：官方服务不可用 → `{ ok:false, code:'unavailable' }`（fail-closed，Req 3.3）。
   - owner 归因：caller fiber 不可归因 → `{ ok:false, code:'denied', reason:'owner-unresolved' }`（fail-closed；三线 mutation 面统一规则）。
   - 目标：session 不可解析/已关闭 → `{ ok:false, code:'invalid-target' }`。
   - 预设名：`name === 'custom'` → `{ ok:false, code:'invalid-preset' }`（官方保留派生态，永不为切换目标）；非官方选项（官方 `resolve(name)` 抛错，门面 guard 后映射）→ `{ ok:false, code:'unknown-preset' }`。**不静默回退默认预设**（Req 2.3）。
2. **官方提交**：调用官方 `set(session, name)`（未知名时官方抛错已被前置检查拦截；官方抛出的其他错误 → `{ ok:false, code:'internal' }` + bounded reason，官方状态不变，Req 2.4）。
3. **官方状态读回（Req 2.2 的证据义务）**：提交前后各读一次官方 `current(session.events)`：
   - 前 ≠ name 且后 = name → `{ ok:true, code:'committed', commitState:'success', preset, appliedAt }`（官方选择状态已证实变化）。
   - 前 = name（官方 `apply` 不 append 事件、knob 已匹配 spec，状态无变化）→ `{ ok:false, code:'unchanged', reason:'preset already effective', preset }` —— Req 6.2 声明的幂等结果：不记第二次独立选择、不产第二次选择事实；与 plan-mode 线 `noop` 同属"无操作类"呈现（ok:false，三线一致）。
   - 后 ≠ name → `{ ok:false, code:'not-applied', reason }`（官方状态不能证实变更——Req 2.2 的契约违反防线，门面报 typed 失败而非伪成功）。

统一词汇对齐与 plan-mode 线一致：`ok/code/reason`；`commitState:'success'` 仅出现在官方状态证实变更的 `committed`；结果码是领域码，不是新终态词（`identity-and-lifecycle.md` §3）。

### C4. 观察面 `observe(session)`（Req 4、5）

- **目标绑定（api-idioms §3.1 合规声明）**：观察入口为 **`observe(session)`**——target（session handle，与 `current`/`options`/`select` 同一目标语义）是入口的显式领域参数（§2 允许领域参数在显式领域字段中变化），返回 **target 绑定的** observe handle `{ current(), subscribe(listener), dispose(), epoch }`（§3.1 固定签名不变，**无 idiom 例外**）；handle 的 `current()` 返回**该 handle 目标**的最新投递视图。无全局多目标混杂：一个 handle 只服务一个目标。
- 形状与句柄：`{ current(), subscribe(listener), dispose(), epoch }` + `sessions.permissionPresets.observe.handle` 登记行。
- 机制（A 类）：单条 firehose 订阅（facade 级共享），过滤 `permission/preset`、`sandbox/mode`、`approval/policy` 三种事件（官方投影的完整折叠输入）；firehose 事件按 session 匹配到已订阅目标后，重读官方 `current` + `options`，组合视图变化才投递 `{ target, preset, options, currentValue, observedAt }`。事实全部来自官方派发与官方读（Req 5.3 的核验义务）。
- 任何官方路径（官方 `/permission` 命令、官方内部、knob 直写）引发的变更同样可达（Req 4.2）——门面观察不限于门面发起的变更。
- 读面/观察/真实审批行为一致性（Req 4.1）：三者共同上游是官方 knob fold；门面的义务是读回证据（C3 第 3 步）+ 如实投影；"至少一个真实审批判定随预设变化"由 Stage 4 证据在官方判定链上验证（门面不模拟审批）。
- containment / dispose / session 关闭降级：同 plan-mode 线 C4。

### C5. 信任与授权边界（Req 3）

**授权档位声明（对照 Req 3.1/3.2 与 goal「受信操作方」措辞）**：本面**不设额外授权档位**——可归因的 host 侧 owner 即可选预设，门面添加的权力不大于官方 seam 本身。官方 `set` 自身无鉴权门（实测），门面不复制也不旁路 user/profile policy 的既有作用点：官方选项表拒绝、settings `defaultPreset` authority（未来 session 默认）、官方审批链均在官方侧照常生效，门面不拦截、不重放、不代答。因此 Req 3.1 的 "unauthorized" 在本面可落实为且仅为：**不可归因（`denied`）、官方选项表拒绝（`unknown-preset`/`invalid-preset`）、官方服务不可用（`unavailable`）**——与官方 seam 自身的信任模型一致、符合克制设计（goal Boundary：不建立通用 IAM）。「受信操作方」在本面的可操作定义 = 拥有可归因 host 插件身份的 caller；低信任 client/remote 只能经某个可归因插件自身 remote 到达本面，其权力以该插件经官方 seam 已有的权力为上界。

机制逐条（goal Boundary："不建立通用 IAM；不通过任何高优先级 hook 自动绕过用户/profile 的拒绝"）：

- **本 feature 不注册任何 hook**（仅观察 firehose），结构上不存在"高优先级自动绕过"；门面不新增授权档位，判定权在官方 seam 与 user/profile 既有机制。
- **归因**：owner 从 caller fiber 派生（`callerIdentityOf` 先例）；caller 自报 owner 一律不接受（Req 3.4）；不可归因 → fail-closed `denied`（C3）。
- **低信任 client/remote**：无公共 client 半面；client 请求经插件自身 remote 到达 host 时以该插件身份归因与审计；门面不携带、不信任 client 声明的身份；门面添加的能力不超过官方 seam 本身（不放大权限——Req 3.2 的"reuse the owning authorities, no parallel permission system"）。
- **fail-closed**：授权判定的三个输入（官方服务可达、官方选项表、owner 可归因）任一不可确定 → typed `unavailable`/`unknown-preset`/`denied`，永不 open（Req 3.3）。

### C6. 审计与可追溯（Req 7）

三线统一 v1 载体（同 plan-mode 线 C5）：feature-authority 内部有界内存环（容量 512、`truncated`/`gapSince` 标记、深冻结脱敏视图、进程作用域、**非 durable、不新增存储档位**）。记录字段：`{ seq, at, ownerId, action: 'permission-preset.select', target: '<sessionId>', preset, outcome }`。写失败保留效果 + gap 标记；v1 无公共审计查询成员（Stage 4 经内部测试缝取证）。owner 派生与不可归因拒绝同 C5。

## Data Models

```text
select 结果    { ok, code, reason?, commitState?, preset?, appliedAt? }   // 冻结
结果码全集     committed / unchanged / not-applied / unknown-preset / invalid-preset /
               invalid-target / invalid-input / denied / unavailable / internal
current 视图   { target, preset, observedAt, source: 'official' }          // 冻结
options 视图   { target, options, currentValue, observedAt }               // 冻结
observe 投递   { target, preset, options, currentValue, observedAt }       // 冻结
observe 入口   observe(session) → target 绑定的 observe handle             // 领域参数在入口，handle 形状固定（§3.1）
observe handle { current(), subscribe(listener), dispose(), epoch }
audit 记录     { seq, at, ownerId, action, target, preset, outcome }       // bounded，冻结出环
availability   { status, reason? }                                          // 冻结
```

## Concurrency And Conflict Rules（concurrency-and-cancellation §6 声明）

- **外层合同（三线一致）**：乐观比较点与提交不可被并发交错。本线官方 `set` 为同步，单同步提交跨度即满足该规则（异步官方 seam 线的达成方式见 `credential-mutation-contract` design）。
- **并发策略**：`latest-wins`，但 winner 由**官方 durable 日志 fold**（最后一条 `permission/preset` 事件）裁决，门面不overlay自己的赢家（Req 6.3 的官方仲裁保留）。
- **scope 与冲突判定**：scope = 目标 session 的权限预设状态；冲突判定 = 官方 `apply` 的"当前生效选择比较"（`current(events) !== name` 才 append）+ 官方状态读回。官方 `set` 与门面包装同为单同步跨度（步骤 1–3 无 await），并发 caller 由 host 线程序列化——**声明的 race window = 单次同步提交跨度**，跨度内至多一个提交在执行，Req 6.1 的"一个 race window 至多一个 committed"在该声明下成立；不重叠的先后提交各自在提交时刻取得诚实的官方读回结果，最终官方状态是官方 fold 的合法解（最后提交的预设或官方派生 `custom`）。
- **取消行为**：`select` 为同步短事务，无 signal 参数（官方 seam 无取消点）；无在途操作需要 stale 隔离。
- **提交条件**：官方 append/knob 落地 + 读回证实（C3 第 3 步）；读回不能证实 → typed 失败（门面不伪造成功）。
- **cleanup owner**：feature disposer（firehose 订阅、观察 handle、审计环）。
- **stale 处理**：dispose 后到达的事件不投递；session 关闭后订阅静默停止。

## Error Handling And Guard Strategy

与 plan-mode 线同构：fail-safe 挂载；官方服务消失 → 各面 typed unavailable（局部失效隔离，Req 8.2）；官方抛错 → bounded typed 结果；投影读载体缺失 → `options`/观察面 degraded（select 不受影响）；审计失败 → gap 标记 + 效果保留。官方错误消息经 bounded 化与 secret 形状过滤后才进入 reason/日志（防御性；官方 preset 错误本身不含敏感值）。治理代号不进入实现命名。

## Authority Closure（composition-and-authority §6；Req 10.2 的 authority map）

| 写路径 | 归属与统一方式 |
|---|---|
| `sessions.permissionPresets.select`（门面） | 本 feature 唯一受支持门面写路径（owner/审计/读回） |
| 官方 `/permission` 命令 | 官方产品面，经**同一官方 apply/set seam** 提交——统一 authority = 官方 permissionPresets 服务 + session 日志；门面不拦截、不重复协调 |
| 官方 knob 直写（`sandbox/mode`/`approval/policy` 由官方其他组件落） | 官方组件各自的 authority；官方 fold 把它们与预设选择收敛为同一状态真相；门面观察面把它们纳入同一投影核验（读/观/行为一致性，Req 4） |
| settings `permission.defaultPreset` | **相邻且互斥声明的另一 authority**（settings 域）：只影响未来 session 的初始预设，不写当前 session 选择；本面不读不写它，两个 authority 在资源（未来默认 vs 当前选择）上互斥、无交集 |
| `services.permissionPresets` current/resolve/optionOf | 只读 advanced 直通，白名单不回流 `set`/`selectFor`（Req 10.1） |
| 直接 inject/import 官方组件 | unsupported escape hatch，门面不声称拦截（Req 10.3） |

**结论**：所有到达"当前 session 预设状态"的受支持写路径统一收敛到官方服务的单一 apply seam；门面写路径唯一；settings 默认值路径与当前选择资源显式互斥——Req 10.2 的"统一或显式互斥"两分支均落实。

## Orthogonality And Three-Verb Distinction（Req 9）

- `select` 只写官方预设状态；plan mode（`sessions.planMode`）状态不受影响，反之亦然——两线互不引用对方状态机，可独立组合（Req 9.1；goal Boundary"模式与预设独立组合"）。
- 一次批准（approval 授权某次操作）与 security policy 注册（插件贡献判定策略）各有 owner 面（approval/security 域）；本面不提供、不代理、不混义（Req 9.2）。
- 门面不评估预设内部规则（Req 9.3）：判定逻辑留在官方 `derive`/官方审批消费链。

## Registry 拟新增行（设计陈述，Stage 4 落地时同步 canonical registry）

| publicPath | idiom | effect | composition | conflictRule | scope | authority | runtime |
|---|---|---|---|---|---|---|---|
| `sessions.permissionPresets.current` | projection | read | pure | not-applicable | session | official permission-presets authority | host |
| `sessions.permissionPresets.options` | projection | read | pure | not-applicable | session | official permission-presets authority（官方投影载体） | host |
| `sessions.permissionPresets.select` | mutation | mutate | coordinated | compare-and-swap | session | official permission-presets authority | host |
| `sessions.permissionPresets.observe` | projection | subscribe | additive | not-applicable | session | official permission-presets authority | host |
| `sessions.permissionPresets.observe.handle` | projection | read | pure | not-applicable | session | official permission-presets authority | host |
| `sessions.permissionPresets.availability` | selfDescription | read | pure | not-applicable | session | facade | host |

capability ID：`sessions.permissionPresets`；`eventCatalog` 无新增事件（复用 `session/event`）。`conflictRule` 取 registry 现行词汇 `compare-and-swap`（官方"当前选择比较 + 读回证实"），日志 fold 的 latest-wins 语义在本表与 design 文字中声明。

## Testing Strategy（对应 Req 11）

1. **选择语义**：query（options/current）、select 成功（读回证实）、unknown-preset/invalid-target/`custom` 拒绝（状态不变）、unchanged 幂等、not-applied 防线、audit 内容。
2. **一致性**：select 后读面/观察/真实审批判定一致（官方审批链上至少一个真实判定随预设变化）；官方路径（直调官方 set / `/permission` 语义）引发的变更到达订阅者与读面。
3. **组合**：两个 synthetic plugin 反向注册顺序、同目标先后/并发 select 的确定性（官方 fold 裁决）、owner 派生、重复选择幂等、低信任/不可归因上下文被拒且状态不变。
4. **降级**：官方服务缺席、投影载体缺失（degraded options）、无关能力隔离、availability 诚实。
5. **registry/surface**：逐成员登记、snapshot 一致、受护 `npm test`、`git diff --check`、registry/surface 一致、全局终审（Req 11.5）。

## Standards Alignment（逐分册结论）

- `capability-strategy.md`：适用。A 类受控包装；无 R slice；`services.permissionPresets` 白名单写路径不回流；§10 六问全否 → host-only；冻结基线内交付。
- `api-shape.md`：适用。主面 mutation；query/observe 为同 authority 只读成员；判定权留在官方 authority，门面不注册平行策略；一面原则满足。
- `api-idioms.md`：适用。mutation 判别式结果、projection 形状、availability/selfDescription、统一词汇（与 plan-mode 线同表）。
- `public-api-shape.md`：适用。挂靠 `sessions` 最近既有领域；namespace 常在；不引入 package/row 身份；`security` 域混义风险已论证排除。
- `composition-and-authority.md`：适用。owner 派生不可伪造；authority closure 双分支落实（统一 + 显式互斥）；composition `coordinated`；§9 合作模型下不做 IAM、fail-closed 由可达性/归因/官方选项三项承载。
- `domain-composition.md`：适用。permissionPresets/approval/security/planMode 各归唯一 owner；选择预设 ≠ 一次批准 ≠ 注册 policy。
- `ordering.md`：适用（有限）。无多 owner 顺序决策；冲突由官方 fold/读回裁决，不以 priority 绕过。
- `identity-and-lifecycle.md`：适用。统一终态词汇经 `commitState`（仅 committed）；无新终态词；无新 identity 类型。
- `durable-state-and-scope.md`：适用（有限）。预设事实的持久性归官方 session 日志；v1 审计非 durable 进程环；不新增第四档 scope。
- `visibility-and-redaction.md`：适用。选项描述 bounded 非敏感；审计与 reason 最小暴露；低信任 client 半身按 §4 默认更保守（host-only 面，无 client 产物）。
- `concurrency-and-cancellation.md`：适用。§6 声明见上（race window 声明、官方 fold winner、无取消面短事务）。
- `versioning-and-protocols.md`：适用。冻结基线内交付；无新 wire/durable 协议。

## Requirements Traceability

| Requirement | 设计承载 |
|---|---|
| Req 1 预设查询投影 | C2（current/options 官方载体 + typed 降级） |
| Req 2 受控选择入口 | C3（三步提交 + 完整结果码 + 读回证据） |
| Req 3 提交前 authority/scope/trust 检查 | C3 步骤 1 + C5（fail-closed 三输入） |
| Req 4 读/事件/真实行为一致 | C3 读回 + C4（共同上游官方 fold；Stage 4 审批判定证据） |
| Req 5 观察面 | C4（三事件过滤 + 官方核验 + containment） |
| Req 6 并发与冲突 | C3 + Concurrency 声明（官方 fold winner、race window） |
| Req 7 审计 | C6（三线统一 v1 环） |
| Req 8 availability/能力/降级 | C1 |
| Req 9 正交与领域边界 | Orthogonality And Three-Verb Distinction |
| Req 10 authority closure | Authority Closure 表（统一 + 互斥） |
| Req 11 验证与交付门 | Testing Strategy |
