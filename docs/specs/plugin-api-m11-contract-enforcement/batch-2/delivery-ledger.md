# Stage 4 交付台账: plugin-api-m11-contract-enforcement（batch-2 实效收口）

> feature_name: `plugin-api-m11-contract-enforcement`（批次：**batch-2「实效收口」**）
> milestone: M11
> status: **Stage 4 已交付（2026-09-21）**。上游制品：同目录 `goal.md` / `requirements.md` / `design.md` / `tasks.md`（Stage 3 经两轮阻塞式只读对抗性审查通过，提交 `b3d432c`）。
> 证据口径（Req 11.1）：本文的每条结论都以**可复跑证据**为准——测试文件、机械校验与真实公共入口执行；不以台账自洽、import 扫描、路径计数或测试总数充当。
> 例外净额基线（batch-1 收口实测）：成员行 17 / 例外记录 19 / 公共 path 16。

## §1 F1–F7 与 5 个未登记成员的最终去向

### F1 观察面（Req 2）

| 子项 | 最终去向 | 可复跑证据 |
|---|---|---|
| 4 种外层返回（裸 handle / Promise / 手工 handle / `{ok, disposer}` 信封） | **修复**：全部观察入口统一为「标准四成员 handle（+已登记扩展）；异步入口与异步 `current()` 由 `callShape` 声明」；`prompts.provenance.observe` 的 `{ok, disposer}` 信封退役 | `test/observation-contract-matrix.test.mjs`（events / attention / coordination / prompts.provenance / sessions.activity / diagnostics / executions / llm.routing / planMode / permissionPresets 逐一断言四成员、冻结、判别式 dispose、释放后 no-op、非函数 listener 不抛） |
| 6 种输入形态 | **修复**：subject 规范形态统一为 options 对象（字段名与同类动词一致），裸主题仅为便捷形态；**不接受订阅回调参数** | 同上矩阵（事件 `{ name }` 与裸名两形态同答一种信封码；coordination 由 `test/observation-subject-forms.test.mjs` 断言 `{ resource }` 与裸 resource 等价、且与 `acquire` 的 `resource` 字段同形；`test/observation-contract-matrix.test.mjs` 对 diagnostics `{ scope }` / executions `{ sessionId }` / planMode `{ agent }` / permissionPresets `{ session }` 的裸形态逐条跑完整观察合同断言，不只判「可调用」）；`llm.routing.observe` 的 `{ session }` 与裸 session 等价同由 `test/observation-subject-forms.test.mjs` 断言；`sessions.observe` 由 `test/index-session.test.mjs` 断言两形态都注册具名原生钩子（对象形态不再被字符串化而静默不投递）、listener 只经 handle 挂载；`sessions.activity.observe` 的裸形态不属便捷形态，以 typed 非法输入收口（同文件断言见下一条） |
| `attention.observe` 的 `dispose()` 返回 `undefined` | **修复**：改用内核 handle（活面与禁用 hub 两分支同形） | 矩阵的「attention 活面 / 降级 hub」两个 case；`test/attention-hub.test.mjs` |
| `coordination.observe` 的 `dispose()` 布尔 + 释放后抛裸 `TypeError` | **修复**：内核 handle + 判别式 dispose + 释放后 no-op | 矩阵 coordination case；`test/coordination-watch.test.mjs`（更新为判别式与 no-op 断言） |
| `workspaces.transactions.observe` 同缺陷 + 无 handle 行 | **修复**：内核 handle + `{transactionId}` 形态 + 判别式；registry 补 handle 行 | `test/workspace-transaction-visibility.test.mjs`（更新 dispose 断言）；registry `workspaces.transactions.observe.handle` |
| `tasks.observe` 的 async `current()` | **已合规（声明/形态补全）**：`callShape: async` + `{taskId}` 对象形态；handle 扩展保留 | `test/call-shape.test.mjs`（tasks 全域 async 断言）；`test/task-execution-observe.test.mjs`（`{ taskId }` 规范形态与裸 id 同 subject：四成员、同一次投影读、非法 subject 为 typed 结果）；矩阵不含 tasks（见 §5 证据等级说明） |
| `sessions.activity.observe` 非法输入抛裸 `TypeError` | **修复**：抛 `PLUGIN_API_SESSION_ACTIVITY_INVALID_INPUT` typed error | `test/session-activity-observe.test.mjs`（更新为 typed 断言） |
| `sessions.channels.observe(listener)` 纯 listener 形态 | **修复**：零参 `observe()`，listener 经 handle | `test/session-channel-integration.test.mjs`（更新为零参 + handle.subscribe） |
| `diagnostics.observe(options, listener)` 两参形态 | **修复**：单参 `observe(options)` | `test/diagnostics.test.mjs`、`test/index-diagnostics.test.mjs`（更新为单参 + handle.subscribe） |
| host `events.observe` 直接 handle、未知名语义 | **修复**：判别式信封（catalog `observed` / 非 catalog `untyped` + reason），与 client 同形；非函数 listener 收口 no-op | 矩阵 events case（catalog / 非 catalog 两态）；`test/events-bus.test.mjs`、`test/events-observe-production.test.mjs`、`test/e2e-catalog-gates.test.mjs` 等事件面测试批量更新 |
| `sessions.durable.observe(targetSession, kind, listener)` 三参 + 官方 disposer | **修复**：`observe({ targetSession, kind })` → 标准 handle（`current()` = 最近投递记录 / 降级视图） | `test/plugin-api-service-session-durable.test.mjs`（facade 转发更新）；`lib/session-durable-feature.js` 的 `observeDurable` |
| `mcp.observe(listener)`（R 包） | **修复**：公共别名零参；本地复刻 handle 保留 | `lib/plugin-api-service.js` 的 `observe: () => withCatalog('onChange')()`；boot 自检由 `packages/mcp/test/*` 在全量测试内通过 |
| `llm.routing.observe(session, listener)` | **修复**：`observe({ session })` 直接返回 handle，listener 参数退役（源码 `on` 的 listener 变为可选） | `test/observation-surface.test.mjs`（更新）；矩阵 llm.routing case |
| `executions.observe` | **登记订正**：入参本就是 `{ sessionId, since?, signal? }`；`currentShape` 重写 | registry `executions.observe` 行；矩阵 executions case |
| 全部成员的 disabled / 降级形态同形 | **修复/保持**：events disabled 面改信封 + inert 判别式 handle；attention 降级 hub 同形；executions disabled 面补 `status/reason` 字段集 | `test/index-events.test.mjs`（disabled events 断言：信封 + `epoch` + `current()` 为 null + 惰性 handle 的 `subscribe` no-op 与判别式 `dispose`）；`test/plugin-api-service-execution.test.mjs`（disabled 面字段集 `status` / `reason` / `sources` / `epoch` 与冻结）；矩阵的降级 case |

### F2 登记面（Req 3）

| 子项 | 最终去向 | 可复跑证据 |
|---|---|---|
| `settings.register` 返回不可释放的 scope 对象 | **修复（需人类复核的默认决策 §9-1）**：标准 handle `{id=ns, ownerId, generation, dispose()}` + 扩展 `get/watch/update/replace/mutate`；`dispose()` 释放门面绑定并在 `reason` 如实披露官方注册随门面与 settings 服务存续 | `test/settings.test.mjs`（handle 身份成员、dispose 判别式与 reason 披露、owner-conflict、duplicate 映射）；`lib/settings.js`；`test/plugin-api-service.test.mjs`（caller-bound view） |
| `settings.register` 冲突口径 | **修复**：官方裁决（同 ns 重复注册由官方拒绝，门面映射为 typed `PLUGIN_API_SETTINGS_REGISTRATION_REFUSED`）；跨 owner 先判 typed `PLUGIN_API_SETTINGS_OWNER_CONFLICT`；`conflictRule: owner-conflict` | `test/settings.test.mjs`（duplicate 映射断言）；validator 的「官方裁决行不得声明 latest-wins」规则 |
| `tools.executionMode.register` 名字占用注册名 | **修复**：`tools.executionMode.get`（projection / sync）；旧名退役（`removed` + mapping） | `test/host-namespace-integration.test.mjs`、`test/registration-contribution-surface.test.mjs`、`test/subtraction-conservation.test.mjs` |
| `agents.register` 官方透传例外 | **保留例外 + 分册规则**：`currentShape` 写明官方动词名；S18 类判定规则落盘 | registry `agents.register` 行；`docs/standards/api-idioms.md` §1 |
| 冲突口径多于词表 | **修复**：全部注册行逐行核对；封闭词表入分册（S19）；冲突矩阵覆盖 owner-conflict / latest-wins / 官方裁决 | `test/contract-conflict-and-availability-matrix.test.mjs`；`test/settings.test.mjs`；`test/diagnostics.test.mjs`（per-owner latest-wins） |

### F3 host/client 同 path（Req 4）

| 子项 | 最终去向 | 可复跑证据 |
|---|---|---|
| `events.observe` 两端不同形 | **修复**：两端统一「冻结判别式信封 + handle」；host 非 catalog 名 `untyped` + reason、client 未知名 `unsupported` + names（差异登记） | 矩阵 events case（host）；`test/client-self-description.test.mjs`、`test/official-passthrough-client-root.test.mjs`；`test/integration-m9-attention.test.mjs` 等 |
| `settings.scope` 两端成员集不相交 | **修复（默认决策 §9-6）**：两端接受 `{ namespace, ... }`；读 / 订阅成员同名 `get` / `watch`（client 在官方 scope 外包别名层并冻结）；写面与释放面差异登记 | `test/settings-scope-parity.test.mjs`（**同段代码体**在两端挂载下逐字复用：`scope({ namespace }) → get → watch → 退订`；裸字符串形态的 host 便捷与 client typed 拒绝作为已登记差异逐条断言）；`test/client-settings-scope.test.mjs`；`test/client-generation-rebind-migration.test.mjs`（官方 dispose 保留） |
| 「同 path 同形到什么程度」缺乏规则 | **分册落盘（S22）**：四条可判定规则 + 命名分工（client `remotes.*` / host `events.*`） | `docs/standards/public-api-shape.md` §4/§5 |

### F4 capability 预检（Req 5）

| 子项 | 最终去向 | 可复跑证据 |
|---|---|---|
| host 只有 49 条精选路径，成员级不可问 | **修复**：接受活面上可解析的成员 path（任意深度），解析到最近能力簇；`get` 未知不抛（`{status:'unavailable', reason:'unknown capability'}`）；`require` 保持 typed throw | `test/registry-surface-reconciliation.test.mjs`（capabilities 组）；`test/host-cutover.test.mjs`（unknown 结果断言） |
| client 仅单层成员 + 状态取根 | **修复**：逐段解析、任意深度；不存在的成员不继承根状态 | `test/client-self-description.test.mjs` |
| 两端规则同源 | **分册落盘（S22）** | `docs/standards/public-api-shape.md` §5 |

### F5 登记完整性与 `attention.hubSnapshot`（Req 6）

| 子项 | 最终去向 | 可复跑证据 |
|---|---|---|
| 四个 `*.availability` 无 registry 行 | **登记补齐**：`events.decisions` / `tools.executionPolicies` / `agents.decisions` / `prompts.assemblyPolicies` 的 leaf 行 + 子命名空间记录；degraded 时补 `reason` | registry（572 行 / 57 namespaces）；`scripts/registry-validate.mjs` 的「namespace 记录指向在册 availability 成员」规则；`test/contract-conflict-and-availability-matrix.test.mjs`（四个决策面：无背书时 degraded 且 reason 点名不可用决策点、单点可解析即 active 且无 reason、未挂载面 unavailable + reason） |
| `attention.hubSnapshot` 公开且绕过调用者范围 | **修复（默认决策 §9-3）**：移出公共面，改经 `Symbol.for('dsh-plugin-api.attention.snapshot-seed')` 内部缝；api-remotes 消费方改经内部缝；kind 裁剪与脱敏语义不变 | `test/integration-m9-attention.test.mjs`（公共面无 `hubSnapshot` + 内部缝 seed 的 per-kind 裁剪断言）；`packages/api-remotes/lib/apply.js` |
| 「公共读面必须按调用者范围过滤」无分册条款 | **分册落盘（S23）** | `docs/standards/visibility-and-redaction.md` §3 |

### F6 availability 聚合（Req 7）

| 子项 | 最终去向 | 可复跑证据 |
|---|---|---|
| 映射表缺 `available`、未映射 token 静默回落 | **修复**：`available → active`；未映射 token → `degraded` + reason（含原 token）；无状态声明的 detail-only 记录仍按其声明口径回落描述符 | `test/contract-conflict-and-availability-matrix.test.mjs`（三个归一 case） |
| `tasks` 有 unavailable 来源却报 active | **修复**：sources 参与聚合（任一来源不可用 ⇒ `degraded` + reason 指明来源） | `test/index-tasks.test.mjs`、`test/task-execution-guard.test.mjs`、`test/task-execution-observe.test.mjs`（更新为 degraded 断言 + `availability()` 函数调用） |
| `coordination` 的能力声明与当前状态混淆 | **修复（分册 + 登记）**：`operations`/`durability`/`backend` 定位为后端能力声明；聚合口径入分册（S21/S26）与 registry | `docs/standards/api-idioms.md` §2、`docs/standards/domain-composition.md`；registry `coordination.availability` |
| `security` 局部缺失口径 | **已合规 + 登记口径** | `lib/security-owner.js`；registry `security.availability` |
| `storage` 禁用形态缺 `epoch` | **修复**：禁用面与非禁用面同字段集（含 `epoch`） | `test/contract-conflict-and-availability-matrix.test.mjs`（storage 禁用字段集）；`lib/storage-binding.js` |
| `workspaces.transactions` 专用探针丢弃 detail | **修复**：域 probe 以**两种形态任一**（函数 / 冻结记录）原样发布，装饰层统一归一（`available → active`）并保留 `scope/durability/operations/backend/epoch`；真实 owner 发布的是冻结记录，门面按记录形态透传 | `lib/plugin-api-service.js`（workspaces surface + `workspaces.transactions` namespace 记录）；`test/workspace-transaction-guard.test.mjs`（真实 owner 挂载下公共探针的 detail 断言）；`test/mutation-operation-coordination-surface.test.mjs`（记录形态与函数形态两态）；`test/workspace-transaction-visibility.test.mjs` |
| 描述符回落分支只回裸 `status`（Req 7.5 的「+ `reason`」半边未落实） | **修复**：`lib/namespace-availability.js` 的回落分支在 `status` 非 `active` 时以 `reason` 点名不可用的 backing（`unavailable` 列出未激活的 backing 特征、`degraded` 点名未被激活的那一项），`active` 仍回裸判定；同时给**七个**只回裸 `status` 的禁用提供者（`sessions.branches` / `skills.activation` / `sessions.activity` / `sessions.request` / `attention` / `events` / `remotes`）补 `reason`——其中 `events` / `sessions.branches` / `skills.activation` / `remotes` 在全量 feature 挂载配置下**可作为公共禁用面读到**（各有断言，见证据列）；`sessions.activity` / `sessions.request` / `attention` 的禁用形态在全量 feature 挂载配置下未发布（`attention` 在纯核心挂载下可见且同样带 `reason`）（`sessions.request` 无 `availability` 成员、`sessions.activity` 与 `attention` 答活面/域记录），三项按同一形状补齐以避免同族提供者不一致，不计入「已收口的公共禁用面」；并补两处同类缺口：① 归一分支对「声明了非 `active` 状态但没给 `reason`」的领域记录（标准 token 与 `active: false` 标记两条路径）按同一 backing 口径补 `reason`，使任何禁用形态都不再读作裸 `status`；② `attachments` / `attachments.projection` 的禁用形态原先答的是**操作失败记录**（`commitState` / `error`，字段集与活面不同）且无 `reason`，现改为可用性描述符（`reason` + 与活面同一字段集 `supportedMedia` / `imageLimits` / `limits`），域侧 `packages/attachments` 的 disposed 记录同步补 `reason` 与 `imageLimits`；不虚构未被披露的 `epoch`（该义务适用于披露了领域记录的面，见 §7 的分册澄清） | `test/contract-conflict-and-availability-matrix.test.mjs`（回落三分支：`active` 裸判定 / `unavailable` 带 reason / `degraded` 点名未激活项）；`test/plugin-api-service-tool-discovery.test.mjs`、`test/security-policy-assembly.test.mjs`（禁用面 `reason` 断言）；`test/index-session-branch.test.mjs`、`test/skill-activation-guard.test.mjs`、`test/index-remote.test.mjs`（`sessions.branches` / `skills.activation` / `remotes` 三个可达禁用面各自的 `reason` 断言）、`test/index-events.test.mjs` 与 `test/index-agent.test.mjs`（`events` 禁用面的 `reason`）、`test/read-surface-projection.test.mjs`（`mcp` 回落与 `attachments` / `attachments.projection` 禁用面的 `reason` 与字段集）；`test/read-surface-projection.test.mjs`（`attachments` / `attachments.projection` 的可用性描述符与字段集）；`test/contract-conflict-and-availability-matrix.test.mjs`（回落分支与归一分支的 reason 三分支）；`lib/namespace-availability.js`、`lib/plugin-api-service.js`、`lib/host-remote.js`、`packages/attachments/lib/pipeline-service.js` |

### F7 client 降级与命名（Req 8）

| 子项 | 最终去向 | 可复跑证据 |
|---|---|---|
| client attention 降级 handle 破坏合同 | **修复**：改用内核 handle（判别式 dispose、no-op subscribe、降级 `current()`）；安装态的 `subscribe(非函数)` 同步收口为 no-op，两态同形 | `test/client-observation-contract-matrix.test.mjs`（runtime 安装 / 未安装两态逐条断言）；`lib/client-runtime.js`、`lib/client-attention-face.js` |
| `slots.list` / `slots.declaration` 双成员读同一事实 | **修复（默认决策 §9-4）**：收敛为 `slots.inspect(key)`；两旧名退役（`removed` + mapping，不自环） | `test/client-slots.test.mjs`；registry 的 removed 行与映射；`test/client-self-description.test.mjs` |
| `remotes.*` 与 `events.*` 命名分工无分册 | **分册落盘（S22）** | `docs/standards/public-api-shape.md` §4 |

## §2 实际 API 变化清单

- **观察面形状**：全部观察入口统一「单一 subject + 标准四成员 handle + 判别式 dispose + 释放后 no-op」；`events.observe` 两端改为判别式信封；`prompts.provenance.observe` 零参；`sessions.durable.observe` 收敛为 `{ targetSession, kind }`；纯 listener / 两参 / 三参形态退役。
- **登记面形状**：`settings.register` 由「无释放能力的 scope 对象」改为标准 handle + 扩展成员（**返回值形状变化**）；冲突口径改为「官方裁决 + 门面 owner-conflict 前置判定」。
- **公共面减法**（`removed` + `oldToTargetMapping` + `statusByPath`，映射不自环）：
  - `tools.executionMode.register` → `tools.executionMode.get`（rename）；
  - `slots.list` / `slots.declaration` → `slots.inspect`（rename）；
  - `attention.hubSnapshot` → 内部符号缝（internalize，无公共目标）。
- **行为变更单列**：`capabilities.get` 对未知 path 由抛 `PLUGIN_API_CAPABILITY_UNAVAILABLE` 改为返回 `{ status:'unavailable', reason:'unknown capability' }`（`require` 的 typed throw 不变）；host `events.observe` 由直接 handle 改为信封（调用方需取 `.handle`）；`settings.register` 返回值由 scope 对象改为 handle（调用方按 handle 使用 `get/watch/...` 扩展成员）；`workspaces.transactions.availability()` 由只回 `{ status }` 改为域记录原样发布（`status` 归一到三值词表 + `scope/durability/operations/backend/epoch`，与 registry 行和 design §2.6 一致）；`coordination.observe(<裸 resource>)` 由返回 typed 非-handle 结果改为返回标准 handle（subject 判别按字段而非「是对象」）；client `events.observe` 由只接受裸事件名改为同时接受规范 subject `{ name }`；`sessions.observe` 收敛为单一 subject（`{ name, ...options }` 规范形态 + 裸事件名便捷，原 `opts` 并入 subject），退役的 listener 形参不再订阅、listener 一律经 `handle.subscribe`。禁用/降级面的 `availability()` 一律以 `reason` 点名不可用的 backing（描述符回落分支、归一分支的非 `active` 无 reason 记录、以及七个只回裸 `status` 的禁用提供者均已收口，其中四个在挂载中可达），`active` 判定仍回裸 `status`；`attachments` / `attachments.projection` 的禁用形态由操作失败记录改为可用性描述符（含 `reason` 与活面同一字段集）。
- **登记订正**：`settings.scope` 的 `failureSemantics` 由 `discriminated-result` 改为 `typed-throw`（未知 ns 抛 typed）；`attention.observe.handle` / `coordination.observe.handle` / `sessions.durable.observe.handle` / `sessions.observe.handle` 的四成员与判别式登记补齐；`tools.executionMode` 历史 reshape 行的目标链改指 `tools.executionMode.get`。另有三个 `*.availability` 行的 `currentShape` 由「领域成员形态」（`{ active, contract }` / getter 抛错）订正为**公共归一形态**（`{ status, reason?, ...domainDetail }`），因 registry 是公共契约的事实源：`skills.activation.availability`、`sessions.branches.availability`、`tools.discovery.availability`。另有两个 `*.availability` 行的 `currentShape` 由「availability query / getter」按公共事实写明形态与禁用面同字段集：`attachments.availability`、`attachments.projection.availability`。

## §3 §2.8 观察项去向复核

- 「同 namespace 内 facade idiom / official passthrough / 领域动词混排」→ **纳入**：官方透传类判定规则落盘（api-idioms §1）+ `agents.register` 登记；（证据：`docs/standards/api-idioms.md`、registry 行）。
- 「`coordination.acquire({resource})` 与 `observe(resource)` 入参不一致」→ **纳入**：`coordination.observe({ resource, ...options })` 与 `acquire` 同字段（证据：矩阵 coordination case）。
- 「`sessions.activity.observe({sessionId})` vs `executions.observe(options)` vs `tasks.observe(id)`」→ **纳入**：对象形态规范 + 裸主题便捷，登记写明（证据：registry currentShape 逐行 + 矩阵）。
- 「`sessions.views` 公开 12 个成员混合 projection 与 helper」→ **不纳入**（非 F1–F7；成员均已登记，改名面横跨多个消费者且收益低于迁移成本）。
- 「`llm.models.list` async 而 `llm.adapters.list` sync；`tasks.*` async 而 `executions.*` sync」→ **不纳入**（同步/异步差异本身是 batch-1 明文排除项，已由 `callShape` 声明）。

## §4 例外净额三口径（执行后实测）

| 口径 | 实测 | 基线（batch-1 收口） | 结论 |
|---|---|---|---|
| 成员行（含 idiomExceptions 的行） | **17** | 17 | 持平 |
| 例外记录 | **19** | 19 | 持平 |
| 公共 path | **16** | 16 | 持平 |

本批未新增任何六项例外：`settings.register` 的 handle 化按 `resourceRegistry` 既有合同补齐（扩展成员按成员行登记）、`events.observe` 信封由 §3.1 既有条款授权、`slots.inspect` 是改名、`attention.hubSnapshot` 是减法。

## §5 计数型结论的计量单位与取样口径

- `npm test`：**3614/3614**（4G 护栏内；batch-1 基线 3577，本批净增 37），`duration_ms ≈ 6.0s`。新增测试文件 6 个——`test/observation-contract-matrix.test.mjs`（host 观察矩阵，11 用例）、`test/client-observation-contract-matrix.test.mjs`（client 观察矩阵，2 用例）、`test/observation-subject-forms.test.mjs`（facade 级 subject 形态等价，2 用例）、`test/registry-surface-reconciliation.test.mjs`（对账与 capability，3 用例）、`test/contract-conflict-and-availability-matrix.test.mjs`（冲突与可用性矩阵，10 用例）、`test/settings-scope-parity.test.mjs`（两端同段代码体，2 用例）——另有既有测试的合同更新与断言增补：`test/client-official-events.test.mjs`（client `observe` 的 catalog / 未知名两态冻结信封 + handle 四成员 + 两形态等价）、`test/workspace-transaction-guard.test.mjs` 与 `test/mutation-operation-coordination-surface.test.mjs`（真实 owner 记录形态的 detail 断言）、`test/index-mcp.test.mjs`（`mcp.observe()` 零参 + handle 四成员）、`test/index-session.test.mjs`（+1：`sessions.observe` 的 subject 两形态与具名钩子）、`test/session-durable-feature.test.mjs`（+1：真实 `observeDurable` 的 handle 合同与投递）、`test/task-execution-observe.test.mjs`（+1：`{ taskId }` 与裸 id 同 subject）、`test/session-api.test.mjs`（两用例从退役的 `observe(name, listener, opts)` 形态更新为 subject 形态）、`test/index-events.test.mjs`、`test/index-agent.test.mjs`、`test/plugin-api-service-execution.test.mjs`、`test/plugin-api-service-tool-discovery.test.mjs`、`test/security-policy-assembly.test.mjs`、`test/index-session-branch.test.mjs`、`test/skill-activation-guard.test.mjs`、`test/index-remote.test.mjs` 与 `test/read-surface-projection.test.mjs`（禁用面 handle 判别式、`reason` 与字段集断言）；新增用例的既有文件为 `test/settings.test.mjs`（+2）与 `test/registry-negative.test.mjs`（+2）。
- registry：members **572**、namespaces **57**、eventCatalog 69、oldToTargetMapping **398**、statusByPath **181**、capabilityMatrix **100** 簇、servicesWhitelist **54**、removed 行 164。
- `scripts/convergence-verify.mjs`：**572 member rows / 37 behavior rows / 37 fully linked**。
- 运行时↔registry 对账：host 走查叶 **278**，非 `services.*` 缺口 **0**（`test/registry-surface-reconciliation.test.mjs`；走查跳过 `_` 前缀、`ctx`/`name`/`apiVersion` 与 `services.*`，与指引 §3.2 口径一致）；client 反向：全部在册 client 行（除 `.handle` 形状行）在活面解析 ✓。
- 证据等级说明：Req 2.10 点名的 **15** 个观察成员逐条有可复跑证据——`tasks.observe` 的 subject 形态与投影读由 `test/task-execution-observe.test.mjs` 断言（async 声明另由 `test/call-shape.test.mjs` 覆盖）；`workspaces.transactions.observe` / `sessions.channels.observe` 由各自既有测试的**公共入口执行**（更新后断言）；`sessions.durable.observe` 由 `test/session-durable-feature.test.mjs` 直接驱动**真实** `observeDurable`（不再只有宽松桩转发断言）断言 handle 四成员、投递与释放；`mcp.observe` 由 `test/index-mcp.test.mjs` 的公共入口断言（本批更新为 `observe()` 并断言 handle 四成员），其 R 包侧 boot 自检由全量测试覆盖；其余 **10** 个成员（`events.observe` / host `attention.observe` / `prompts.provenance.observe` / `coordination.observe` / `sessions.activity.observe` / `diagnostics.observe` / `executions.observe` / `llm.routing.observe` / `sessions.planMode.observe` / `sessions.permissionPresets.observe`）由 `test/observation-contract-matrix.test.mjs` 覆盖（11 个 case，attention 的活面与降级面各一），其中 `coordination.observe` 与 `llm.routing.observe` 的 subject 形态等价另由 facade 级 `test/observation-subject-forms.test.mjs` 覆盖；client 侧同形由 `test/client-observation-contract-matrix.test.mjs` 覆盖。1 + 2 + 1 + 1 + 10 = 15，即 Req 10.4 的逐成员矩阵。Req 2.4 的 subject 合同同时对 `sessions.observe`（不在 15 成员表内但同属观察入口）生效，由 `test/index-session.test.mjs` 覆盖。

## §6 机械校验与边界审计

- 机械校验：`registry-validate` → `registry valid`（含本批新增五组规则）；`convergence-verify` → 全链；`capability-matrix-sync --check` → in sync；`build:client:check` → bundle 与源一致（`lib/client.js` 经 `npm run build:client` 重建）；`git diff --check` 干净。
- 边界审计：版本冻结未步进（`0.1.0-rc.6-0.1.0` / `dsh.api 0.1`，`package.json` 零改动）；官方包目录零修改（`/usr/lib/node_modules/@deepseek-ai/dsh/package.json` mtime 早于本批开工）；本批 `packages/attachments` 仅改其**自身扩展面**的 disposed 可用性记录（补 `reason` 与 `imageLimits`，不涉被替代官方行的契约复刻，boot 自检由全量测试覆盖）；`servicesWhitelist` 键集合 54 不变；未新增 R 点（`packages/*/cordis.patch.yml` 本批零改动；本批 `packages/` 下只改两个文件——`api-remotes/lib/apply.js` 的 snapshot resolver 来源与 `attachments/lib/pipeline-service.js` 的 disposed 可用性记录；`mcp` 的公共别名入参改动落在门面 `lib/plugin-api-service.js`，R 包自身零改动，其 boot 自检与契约复刻由全量测试覆盖）；治理 token 审计：`lib/`、`packages/*/lib/`、`test/`、`package.json` 对 `F/B/S/Req/M11/batch` 编号零命中。
- 真实差异保留复核（Req 12.3）：`services.*` 存在性口径、coordination `release(handle)`、workflow run authority、checkpoint 恢复阶段、领域 detail 字段、official seam 原样透传、`agents.register` 官方动词透传、同步/异步差异——逐条复核未机械抹平（证据：batch-1 台账 §3 保留清单 + 本批 `git diff` 未触及相应实现路径）。

## §7 spec 就地修订与执行注

- `design.md` / `requirements.md`：无需修订（实现与验收边界一致）。
- 执行中的形状细化（不改验收边界，仅按 B1-2 的「字段名与同类动词一致」定名）：`sessions.permissionPresets.observe` 的对象形态字段用 `{ session }`（该命名空间 `select` 的字段名），`sessions.planMode.observe` 用 `{ agent }`。
- 范围内的补完（第五轮终审闭合时落地）：`sessions.observe` 不在 Req 2.10 的 15 成员表与 design §2 的处置表内，但 Req 2.4 与本批落盘的 `api-idioms` §3.1（S16）为**无条件**措辞（不得接受订阅回调参数、规范形态为 options 对象），交付前该成员两者都不满足（既收 listener 形参，又把 `{ name }` 当裸名而静默不投递）。按「实现向无条件条款收敛」处理：`sessions.observe` 收敛为单一 subject（原 `opts` 并入 subject），退役 listener 形参，registry 行同步。该修订不新增能力、不改变 Req 2.10 的 15 成员验收边界，属本批合同统一（F1）在同一 idiom 上的完整化。
- `scripts/registry-validate.mjs`：新增五组规则（observation projection 与 handle 四成员、注册行 handle 或例外、namespace availability 在册、`conflictRule` 的封闭注册词表 + 官方裁决不得 latest-wins、观察行 subject 形态与 callShape）；并把「同 idiom 单一 failureSemantics」放宽为允许 projection 声明 `typed-throw`（查询入口的非法输入以 typed error 表达；缺位与降级仍不抛）——依据 `api-idioms` §2/§3.1。其中 `conflictRule` 一组按 `api-idioms` §2 的**封闭注册词表**（`latest-wins` / `content-conflict` / `owner-conflict` / `owner-scoped` / `fencing` / `not-applicable`）判定于注册类 idiom（`policy` / `resourceRegistry`）；并发策略词（如 `compare-and-swap`，`mutation` 行的并发问题）不在该词表内，不得作为注册冲突的答案。
- 分册就地澄清（第七轮终审闭合时落地，S21 的 availability 条款）：`docs/standards/api-idioms.md` 的「禁用形态与非禁用形态必须保留同一 detail 字段集（含 `epoch`）」补明了适用范围——该「同一字段集」义务适用于**披露了领域记录**的面（`storage` / `executions` / 四个决策面等在禁用时以同一字段集回报）；对**没有领域披露**的 namespace（描述符回落路径），非 `active` 时必须用 `reason` 点名不可用的 backing，但不虚构 `epoch` 等未被披露的字段。据此实现向 Req 7.5 的「+ `reason`」半边收敛（回落分支与六个禁用面），Req 7.6 点名的 `storage` 字段集义务不变。
- `README.md` 同步（Task 12.2）：`pluginApi.llm.routing.observe(session, listener)` 已按本批的 listener 退役改为 `observe({ session })` 形态（README 其余受本批影响的成员名经全量检索无残留）。
- `scripts/convergence-verify.mjs` 的 `CLIENT_LEAF_TARGETS` 清掉本批已退役的 `slots.list` 豁免项（退役后已无映射行以它为 `targetPath`，保留会静默放行未来指向退役路径的映射）。
- 分册范围澄清（第八轮终审闭合时落地，S16）：`docs/standards/api-idioms.md` §2 的「任何观察入口不得接受订阅回调作为参数」补明其范围为**投影观察入口**（namespace 级 `observe` 与其 handle 契约）；operation handle 上已登记的领域扩展成员不受此限（如 `workflows.start.handle` 登记的 `observe(listener)` 是 run-scoped 过滤订阅，语义由该 handle 自己的登记承载）。
- 分册修订 S16–S26 全部落盘（S24 树图与 registry 同一提交同步）。

## §8 阻塞项

**无。** 本批全部顶层任务完成，机械校验与全量测试全绿；无触达硬停机点的事项。

## §9 公共面变化（单列）

| 变化 | 类型 | 旧 → 新 | 证据 |
|---|---|---|---|
| `attention.hubSnapshot` | 内部化（减法） | 公共成员 → `Symbol.for('dsh-plugin-api.attention.snapshot-seed')` 内部缝（api-remotes 消费方同步） | `test/integration-m9-attention.test.mjs` |
| `tools.executionMode.register` | 改名 | → `tools.executionMode.get` | `test/host-namespace-integration.test.mjs` |
| `slots.list` / `slots.declaration` | 合并改名 | → `slots.inspect` | `test/client-slots.test.mjs` |
| `capabilities.get` 未知 path | 行为变更 | 抛 typed error → `{ status:'unavailable', reason:'unknown capability' }` | `test/host-cutover.test.mjs`、`test/client-self-description.test.mjs` |
| host `events.observe` | 形状变更 | 直接 handle → 判别式信封（`code: 'observed' \| 'untyped'`） | 矩阵 events case |
| `settings.register` | 形状变更 | scope 对象 → 标准 handle + 扩展 | `test/settings.test.mjs` |
| `workspaces.transactions.availability()` | 行为订正 | 只回 `{ status }` → 域记录原样发布（`scope/durability/operations/backend/epoch` 保留） | `test/workspace-transaction-guard.test.mjs` |
| `coordination.observe(<裸 resource>)` | 行为订正 | 返回 typed 非-handle 结果（subject 判别误把 resource 对象当 options）→ 返回标准四成员 handle + `resource` 扩展，与 `{ resource }` 形态等价 | `test/observation-subject-forms.test.mjs` |
| client `events.observe` | 行为订正 | 只接受裸事件名 → 同时接受规范 subject `{ name }`（两形态语义一致） | `test/client-official-events.test.mjs`、`test/client-observation-contract-matrix.test.mjs` |
| `sessions.observe` | 形状变更 | `observe(name, listener?, options?)` → `observe({ name, ...options })` + 裸事件名便捷；listener 退役 | `test/index-session.test.mjs`、`test/session-api.test.mjs` |
| 禁用/降级面 `availability()` | 行为订正 | 非 `active` 时只回 `{ status }` → 补 `reason` 点名不可用 backing（回落分支、归一分支的无 reason 记录、七个禁用提供者，含 `events`） | `test/contract-conflict-and-availability-matrix.test.mjs`、`test/index-session-branch.test.mjs`、`test/skill-activation-guard.test.mjs`、`test/index-remote.test.mjs`、`test/index-events.test.mjs`、`test/index-agent.test.mjs` |
| `attachments` / `attachments.projection` `availability()` | 行为订正 | 禁用时答操作失败记录（`commitState` / `error`，无 `reason`，字段集不同）→ 答可用性描述符（`reason` + `supportedMedia` / `imageLimits` / `limits`） | `test/read-surface-projection.test.mjs` |

## §10 全局终审修订记录

### 第一轮全局终审（阻塞式只读，2026-09-21）

Stage 4 完成后按 AGENTS §3.2 派发了一次阻塞式只读全局终审，结论「有偏差」（4 阻塞 / 3 中度 / 3 低度）。意见 1–9 已集中闭合（含 registry 行订正、capabilityMatrix 生成物重算、client 三处裸 TypeError 收口、client 观察矩阵与 settings 证据补齐、台账数字订正），第 10 项以历史制品现状注闭合。修订后 `npm test` 3601/3601，全部机械校验绿，并再次派发全局终审（结论与闭合见下）。本批的全局终审逐轮记录如下（轮次按序排列，每节先引言后表格）。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（阻塞） | client `capabilities.get` 行与实现相反 | 订正 client 行 `currentShape`（未知 path 返回冻结 unknown 结果、`require` 保持 typed throw），与 host 行对齐 |
| 2（阻塞） | `settings.register.handle` / `settings.scope.handle` 行仍写「无 id/ownerId/generation/dispose」 | 两行重写为标准 handle + 扩展成员 + 释放边界披露（与主行互指） |
| 3（阻塞） | `capabilityMatrix()` 的 `tools` / `client.slots` 误报 degraded 且携带退役旧名 | 两簇 `targetPaths` 更新为现行名（`tools.executionMode.get`、`slots.inspect`）并重新生成 `lib/capability-matrix.js`；两簇恢复 `active`、`limitations` 清空 |
| 4（阻塞） | client 三处裸 `TypeError`（attention 安装态 subscribe、slots.observe 非法事件、remotes.observe 非白名单事件） | 三处收口：非函数 listener → no-op；非法事件 → 带 code 的 typed error（`PLUGIN_API_SLOT_EVENT_INVALID_INPUT` / `PLUGIN_API_REMOTE_EVENT_NOT_FORWARDED`）；测试同步更新 |
| 5（中度） | `statusByPath` 缺 `attention.hubSnapshot`；执行模式键串名 | 补 `attention.hubSnapshot` = removed；键订正为 `tools.executionMode.register`（删除旧前缀键） |
| 6（中度） | client 观察矩阵缺位、client attention 修复无测试、台账引证失实 | 新增 `test/client-observation-contract-matrix.test.mjs`（attention 两态 + slots/remotes/events/lifecycle）；台账 F7 引证改正 |
| 7（中度） | settings 的 owner-conflict 与 handle 身份/披露无测试 | `test/settings.test.mjs` 补 2 个用例（derived identity + disclosing release；跨 owner typed conflict） |
| 8（低度） | 台账测试总数不实 | 订正为 3601/3601（净增 24：基线 3577） |
| 9（低度） | client `attention.observe` 行误植 host 降级语 | 按客户端事实重写（runtime 未安装 → 同形 handle、`current()` 冻结空数组降级视图） |
| 10（低度） | 历史制品缺「公共契约现状注」 | 对 batch-1/tasks.md、batch-1/delivery-ledger.md、plugin-api-m8-api-idiom-refactor/migration-ledger.md、plugin-api-m10-contract-convergence/design.md、client-attention-contribution/probe-and-delivery-notes.md 追加现状注 |

### 第二轮全局终审（阻塞式只读，2026-09-21）

修订后重派终审，结论「有偏差」（1 阻塞 / 1 中度 / 3 低度）。全部意见已集中闭合，闭合方式如下；闭合后 `npm test` 3607/3607，机械校验全绿，再次重派终审确认。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（阻塞） | `workspaces.transactions.availability()` 丢弃全部领域 detail：门面只接受函数形态 probe，而真实 owner 发布的是冻结记录，守卫 `typeof === 'function'` 恒不成立、回落分支恒被选中（registry 行与 design §2.6 均要求域 probe 原样发布并保留 detail） | `lib/plugin-api-service.js` 的探针守卫改为两种形态任一都原样发布（函数则调用、冻结记录则透传），装饰层归一 `available → active` 并保留 `scope/durability/operations/backend/epoch`；`test/workspace-transaction-guard.test.mjs` 在**真实 owner** 挂载下断言公共探针的完整 detail；`test/mutation-operation-coordination-surface.test.mjs` 在保留函数形态桩（含 verbose reason 那一支）之外**新增**真实记录形态的 case 并断言 detail 保留，使该失败模式不再被宽松桩掩盖 |
| 2（中度） | Task 5.5 的「两端同段代码体」证据缺失；host `scope({ namespace })` 对象形态零覆盖；台账 F3 引证失实 | 新增 `test/settings-scope-parity.test.mjs`：同一段代码体在 host / client 两端挂载下逐字复用（`scope({ namespace }) → get → watch → 退订`），并逐条断言裸字符串形态的已登记差异；台账 F3 引证改正为该文件 |
| 3（低度） | Task 5.7 点名的 client 证据文件未更新 | `test/client-official-events.test.mjs` 补齐 client `observe` 的 catalog / 未知名两态冻结信封 + handle 四成员断言（未知名携带 `names` 目录、不发布 handle） |
| 4（低度） | validator 规则 ④ 窄于 tasks 10.5 ④：缺「`conflictRule` 取值在封闭词表内」的注册侧判定 | `scripts/registry-validate.mjs` 增补注册类 idiom（`policy` / `resourceRegistry`）的封闭注册词表判定；`test/registry-negative.test.mjs` 补 2 个用例；registry 数据无需改动（81 个注册行零违规，词表外的 `compare-and-swap` / `none` 全在 `mutation` / `projection` 行上） |
| 5（低度） | 四个 `*.availability` 的 degraded + reason 无对应测试；台账 F5 引证不成立 | `test/contract-conflict-and-availability-matrix.test.mjs` 补 2 个用例（四个决策面在无背书时 degraded 且 reason 点名不可用决策点、单点可解析即 active 且无 reason、未挂载面 unavailable + reason）；台账 F5 引证改正 |

### 第三轮全局终审（阻塞式只读，2026-09-21）

第二轮闭合后重派终审，结论「有偏差」（1 阻塞 / 0 中度 / 3 低度）。全部意见已集中闭合，闭合后 `npm test` 3607/3607、机械校验全绿，再次重派终审确认。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（阻塞） | client `events.observe` 不接受规范 subject `{ name }`：实现只按裸事件名查表，而 Task 5.2 与注册行 `client\|events.observe`（`events.observe({ name }) (a bare event name stays accepted)`）都声明对象形态为规范形态——catalog 内的名字写成规范形态会得到假的 `unsupported` 拒绝，属「契约写了一套、实现跑了另一套」 | `lib/client-official-events.js` 的 `observe` 收敛为与 host 同一 subject 归一（对象形态为规范形态、裸事件名为便捷形态，语义一致）；`lib/client.js` 经 `npm run build:client` 重建；`test/client-official-events.test.mjs` 与 `test/client-observation-contract-matrix.test.mjs` 补两形态等价断言（含未知名两形态回答同一 `names` 目录） |
| 2（低度） | 台账 §10 第二轮第 1 项的闭合措辞与文件事实不符：函数形态宽松桩仍在，本批是新增记录形态 case 而非「订正」 | 措辞改正为「在保留函数形态桩之外新增真实记录形态 case」（见本轮上一节第 1 行） |
| 3（低度） | 台账 §6 称 `packages/mcp` 被修订，实际 `packages/mcp` 零改动（别名改动落在门面 `lib/plugin-api-service.js`） | §6 语句改正：本批 `packages/` 只改 `api-remotes/lib/apply.js`，mcp 公共别名改动在门面 |
| 4（低度） | 台账 §5 称 `mcp.observe` 证据为「（更新后断言）」，实际 `test/index-mcp.test.mjs` 零改动且仍以退役的 listener 直参形态调用 | `test/index-mcp.test.mjs` 更新为零参公共入口断言（handle 四成员 + 释放），使该引证成立；§5 证据等级说明按实际改写 |

### 第四轮全局终审（阻塞式只读，2026-09-21）

第三轮闭合后重派终审，结论「有偏差」（0 阻塞 / 0 中度 / 3 低度，均为台账文字与文件事实不符）。闭合时第 2 项在补实测证据的过程中**发现并修复了一处真实缺陷**（见下表第 2 行）。闭合后 `npm test` 3609/3609、机械校验全绿，再次重派终审确认。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（低度） | 台账 §5「观察矩阵覆盖其余 11 个成员」的计数与归属不实（矩阵实为 10 个成员 / 11 个 case，`mcp.observe` 已在前段归给 `test/index-mcp.test.mjs`） | §5 证据等级说明按 Req 2.10 的 15 个成员逐项重写（4 既有测试 + 1 mcp + 10 矩阵 = 15），并单列 client 侧同形证据 |
| 2（低度） | 台账 §1-F1「6 种输入形态」行声称「均含对象形态与裸形态等价断言」不成立：host 矩阵对列名成员无两形态等价断言，`coordination` 那一 case 调的是 owner 的 `watch(<裸 resource>)` 而非门面 `observe({ resource })` | 补**真实**断言而非改写措辞：`test/observation-contract-matrix.test.mjs` 增事件 `{ name }` 与裸名、diagnostics `{ scope }` 与裸 scope、executions `{ sessionId }` 与裸 id 的两形态断言；新增 facade 级 `test/observation-subject-forms.test.mjs` 断言 `coordination.observe({ resource })` 与裸 resource 等价、`llm.routing.observe({ session })` 与裸 session 等价。补测过程中发现**真实缺陷**：`coordination.observe` 的 subject 判别只按「是对象」，把裸 resource 对象误当规范 options，`spec.resource` 取到 `undefined`，于是**文档承诺的裸形态返回非 handle 的 typed 结果**；已按同类动词 `llm.routing.observe` 的判别方式（按字段是否在 subject 上）修正 `lib/plugin-api-service.js`，并把 `sessions.activity.observe` 的裸形态（本就是 typed 非法输入，非便捷形态）如实写明 |
| 3（低度） | 台账 §10 第一轮第 10 项闭合行点名的历史制品路径不存在（`plugin-api-client-attention-contribution/…`） | 更正为 `docs/specs/client-attention-contribution/probe-and-delivery-notes.md`（该文件确有本批现状注） |

### 第五轮全局终审（阻塞式只读，2026-09-21）

第四轮闭合后重派终审，结论「有偏差」（1 中度 / 2 低度）。闭合后 `npm test` 3611/3611、机械校验全绿，再次重派终审确认。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（中度） | `sessions.observe` 仍接受退役的订阅回调形参（`observe(name, listener, opts)`），且规范 options 形态被静默误观测（`{ name }` 被字符串化成 `[object Object]` 的原生钩子，既不投递也不报错）；本批自己落盘的 `api-idioms` §3.1（S16）为无条件措辞「任何观察入口不得接受订阅回调作为参数」，台账 §1-F1 的「一律」随之失实，且该成员无例外登记 | 收敛该成员（不是收窄条款）：`lib/session-feature.js` 的 `observe` 改为单一 subject（`{ name, ...options }` 规范形态 + 裸事件名便捷，原 `opts` 并入 subject），删除 listener 分支，listener 一律经 `handle.subscribe`；registry 行同步为 subject 形态；`test/index-session.test.mjs` 新增用例断言两形态都注册**具名**原生钩子（不再出现 `[object Object]`）且投递经 handle，`test/session-api.test.mjs` 两个用例从退役形态更新到 subject 形态。**连带收口**：唯一的生产调用方 `lib/session-channel.js`（会话事件入通道引擎）原本依赖退役的 listener 形参，收敛后改为经 handle 挂载；顺带丢弃该调用处一个**从未生效**的 `{ scope: true }`（旧代码的 `(name, listener) => …` 两参箭头把第三个实参丢掉了，保留它反而会另开一条 feed、破坏「durable hub / sessionRoute / sessionChannel 共享同一条 session/event feed」的既有事实，由 `test/index-session-durable.test.mjs` 的 feed 计数断言把住）；`test/session-channel-cross-package.test.mjs` 的会话桩同步为收敛后的 subject 合同 |
| 2（低度） | §5 称 `sessions.durable.observe` 的证据为「公共入口执行（更新后断言）」，实际只有宽松桩（`observeDurable: () => 'observe-handle'`）转发断言，本批新写的真实实现零覆盖 | `test/session-durable-feature.test.mjs` 新增用例直接驱动**真实** `observeDurable`：handle 四成员、首次投递前的降级读面、只投递匹配记录、`current()` 报最近投递、释放判别式与释放后静默/读面降级、底层 feed 拆除；§5 证据等级说明按实际改写 |
| 3（低度） | 矩阵对裸形态只断言 `typeof dispose === 'function'`，深度低于 §1-F1 的措辞 | `test/observation-contract-matrix.test.mjs` 的 diagnostics / executions / planMode / permissionPresets 裸形态改为跑完整 `assertObservationContract`（四成员 + 判别式释放 + 释放后 no-op + `current()` 不抛） |

### 第六轮全局终审（阻塞式只读，2026-09-21）

第五轮闭合后重派终审，结论「有偏差」（0 阻塞 / 0 中度 / 2 低度，均为「结论缺可复跑证据」）。闭合后 `npm test` 3612/3612、机械校验全绿，再次重派终审确认。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（低度） | `tasks.observe` 本批新增的规范对象形态 `{ taskId }` 零覆盖；§1-F1 引证的 `test/call-shape.test.mjs` 只覆盖 async 声明，§5 把它并入「更新后断言」不实（本批对 `test/task-execution-observe.test.mjs` 的更新改的是 `availability`，observe 调用全为裸 id） | `test/task-execution-observe.test.mjs` 新增用例：`{ taskId }` 规范形态与裸 id 为同一 subject（四成员、同一次投影读相等、`{ taskId, audience }` 的选项随 subject、非法 subject 为 typed 结果）；§1-F1 与 §5 的证据归属改正（`tasks.observe` 单列，并注明 async 声明另由 `test/call-shape.test.mjs` 覆盖） |
| 2（低度） | §1-F1 末行自称新增的两处语义无断言：「events disabled 面的 inert 判别式 handle」被引文件只断言信封/`epoch`/`current()`，「executions disabled 面补 `status/reason`」中 `reason` 在任何测试零命中 | 补真实断言：`test/index-events.test.mjs` 断言惰性 handle 的 `subscribe` no-op 与判别式 `dispose`（`ok:false` / `code:'stale'` / `reason` 为字符串）；`test/plugin-api-service-execution.test.mjs` 断言禁用面字段集含 `reason`；§1-F1 该行引证按实际改写 |

### 第七轮全局终审（阻塞式只读，2026-09-21）

第六轮闭合后重派终审，结论「有偏差」（0 阻塞 / 1 中度 / 1 低度）。闭合后 `npm test` 3613/3613、机械校验全绿，再次重派终审确认。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（中度） | Req 7.5 / design B5-5 / Task 7.1 与本批新落盘的 `api-idioms` §2 条款在**描述符回落分支**未落实：域未披露可归一记录时 `availability()` 只回裸 `{ status }`，既无 `reason` 也不含字段集；实测 `mcp` / `profiles` / `sessions.branches` / `skills.activation` 等面均无 `reason`，`settings` 报 `degraded` 却无任何理由。台账 §7 的「requirements / design 无需修订」随之失去依据 | 实现向条款收敛（不是收窄条款）：`lib/namespace-availability.js` 的回落分支在非 `active` 时以 `reason` 点名不可用的 backing；`lib/plugin-api-service.js` 的五个只回裸 `status` 的禁用面与 `lib/host-remote.js` 的 `remotes` 禁用面补 `reason`；`test/contract-conflict-and-availability-matrix.test.mjs` 补回落三分支用例，`test/plugin-api-service-tool-discovery.test.mjs` 与 `test/security-policy-assembly.test.mjs` 补禁用面 `reason` 断言；`docs/standards/api-idioms.md` 就地澄清「同一 detail 字段集」义务适用于披露了领域记录的面、无领域披露者以 `reason` 点名 backing 但不虚构 `epoch`；同步订正三个描述「领域成员形态」的 `*.availability` 行（§2 登记订正），`README.md` 按 Task 12.2 同步退役形态 |
| 2（低度） | README 未按 Task 12.2 同步：仍文档化本批已退役的 `llm.routing.observe(session, listener)` 形态（README 本批零改动，台账亦未记录该项去向） | `README.md` 改为 `observe({ session })` 并注明 listener 经 `handle.subscribe`；全量检索 README 无其它本批退役形态残留（`slots.list` / `slots.declaration` / `tools.executionMode.register` / `hubSnapshot` / 各 `observe(...)` 旧形均零命中）；§7 登记该项 |

### 第八轮全局终审（阻塞式只读，2026-09-21）

第七轮闭合后重派终审，结论「有偏差」（0 阻塞 / 1 中度 / 0 低度）。闭合后 `npm test` 3613/3613、机械校验全绿，再次重派终审确认。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（中度） | 第七轮意见的闭合**不完整**：禁用 `events` 面（`lib/plugin-api-service.js` 的 `createDisabledEventsApi`）仍只回裸 `{ status }`，Req 7.5 未落实；台账 §2/§1-F6/§10 的「一律」「六个禁用面均已收口」随之失真（该面是 `_eventsSurface` 的初始/降级发布路径，属真实可达的 fail-safe 公共面） | 补齐该面 `reason`；并按同一口径**全扫** `lib/`、`packages/*/lib/` 的所有 `status: unavailable \| degraded` 提供者，确认除本面外均已带 `reason` 或属「披露了领域记录」的允许情形（逐条核对 `executions` / `agents` / `storage` / `tasks` 等）；`test/index-events.test.mjs` 与 `test/index-agent.test.mjs` 补该面的 `reason` 断言；台账三处措辞按实际改为七个禁用面 |

### 第九轮全局终审（阻塞式只读，2026-09-21）

第八轮闭合后重派终审，结论「有偏差」（0 阻塞 / 1 中度 / 2 低度）。闭合后 `npm test` 3614/3614、机械校验全绿，再次重派终审确认。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（中度） | `attachments` / `attachments.projection` 的禁用形态仍违 Req 7.5，且两条禁用路径各行其是：命名空间未挂载时答的是**操作失败记录**（`commitState` / `error`，无 `reason`，字段集与活面不同），域已 dispose 时答 `{ status, supportedMedia, limits }`（无 `reason`，且少 `imageLimits`）；台账 §2 的「一律」与 §10 第八轮的「全扫…除本面外均已带 reason」随之失真 | `lib/plugin-api-service.js` 的可用性入口改为答可用性描述符（新增 `ATTACHMENT_AVAILABILITY_UNAVAILABLE`：`reason` + `supportedMedia` / `imageLimits` / `limits`，与活面同一字段集；`invoke` 增加 `unavailableShape`，不影响同族的操作失败记录）；`packages/attachments` 的 disposed 记录补 `reason` 与 `imageLimits`；并**把该缺陷升级为通用保证**：归一分支对「声明非 `active` 但无 `reason`」的领域记录（标准 token 与 `active: false` 两条路径）按 backing 口径补 `reason`，使任何禁用形态都不再读作裸 `status`；`test/read-surface-projection.test.mjs` 与 `test/contract-conflict-and-availability-matrix.test.mjs` 分别断言描述符形状与归一三分支 |
| 2（低度） | §10 的第一轮未成节（无自己的 `###` 节点，10 项记录挤在 §10 引言里），与二至八轮的「标题 + 引言 + 表」不一致 | 补 `### 第一轮全局终审` 节点，§10 现为第一轮至第九轮顺序成节 |
| 3（低度） | 本批新补 `reason` 的六个面（`sessions.branches` / `skills.activation` / `sessions.activity` / `sessions.request` / `attention` / `remotes`）无测试断言；该行原引证的两份测试断言的是另外两个面 | 在各自的既有测试补 `reason` 断言：`test/index-session-branch.test.mjs`、`test/skill-activation-guard.test.mjs`、`test/index-remote.test.mjs`（另 `test/index-events.test.mjs` / `test/index-agent.test.mjs` 覆盖 `events`）；§1-F6 与 §9 的引证按实际改写 |

### 第十轮全局终审（阻塞式只读，2026-09-21）

第九轮闭合后重派终审，结论「有偏差」（0 阻塞 / 0 中度 / 4 低度，全部为台账文字与结构失准；功能、契约、分册与边界判据全部通过）。闭合后 `npm test` 3614/3614、机械校验全绿，再次重派终审确认。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（低度） | §1-F6 的禁用面证据括号称「七个禁用面各自的 `reason` 断言」，实际被引的五个文件只覆盖 4 个面；且 `sessions.activity` / `sessions.request` / `attention` 的禁用形态在实测挂载配置下**未作为公共面发布**（`sessions.request` 无 `availability` 成员、`sessions.activity` 与 `attention` 答活面/域记录），把它们计作「已收口的公共禁用面」属计数与证据口径同时失真 | 按实测重写计数与证据：七个**禁用提供者**各自补 `reason`（代码事实），其中 `events` / `sessions.branches` / `skills.activation` / `remotes` 四个在挂载中可达并各有断言（逐一点名对应测试），另三个按同一形状补齐以避免同族不一致、不计入公共禁用面；§2 / §9 同步为「七个禁用提供者（其中四个可达）」 |
| 2（低度） | §6 边界审计自相矛盾：前句已写 `packages/attachments` 的修订，后句仍称「`packages/` 下本批只改 `api-remotes/lib/apply.js`」（`git status -- packages/` 实为两个文件） | §6 改为如实列出两个文件（`api-remotes/lib/apply.js` 的 snapshot resolver 来源、`attachments/lib/pipeline-service.js` 的 disposed 可用性记录） |
| 3（低度） | §9 的 `attachments` 行多一格（5 列），表结构失真 | 该行改为 4 列；同轮另修一处同型问题：`host events.observe` 行的 `code: 'observed' \| 'untyped'` 内裸竖线在表内未转义（改为转义竖线）。现全表按未转义竖线计数只剩 3 列 / 4 列两种 |
| 4（低度） | §10 第一轮引言结尾的「本批共 N 轮全局终审」在每轮追加记录后即成为假陈述（本轮审查本身即使其失效） | 该句改为不含轮次总数的表述（「本批的全局终审逐轮记录如下（轮次按序排列，每节先引言后表格）」），从结构上消除每轮必然失效的计数 |

### 第十一轮全局终审（阻塞式只读，2026-09-21）

第十轮闭合后重派终审，结论「有偏差」（0 阻塞 / 0 中度 / 2 低度，均为台账表格结构问题；功能、契约、登记、分册与边界判据全部通过，第十轮 4 项复核全部成立）。闭合后 `npm test` 3614/3614、机械校验全绿，再次重派终审确认。

| # | 终审意见 | 闭合方式 |
|---|---|---|
| 1（低度） | §10 第八轮第 1 行的闭合方式在代码 span 内有一处**未转义竖线**（`status: unavailable \| degraded` 的原文形式），使该行在 3 列表格里呈现为 4 格、尾格在被 GFM 渲染时静默丢弃；与第十轮第 3 行所修的属同一缺陷类但未扫净 | 该竖线改为转义；并按「未转义竖线计数」全表复算，现只剩 3 列 / 4 列两种形状（第十轮所见的两处同类问题已连同本轮一并扫净） |
| 2（低度） | 第九轮表格末行与 `### 第十轮全局终审` 标题之间缺空行（§10 其余各节标题前均有空行） | 补空行；全文件各 ATX 标题前均已有空行 |
| —（同轮澄清，非偏差） | §1-F6 的「在实测挂载配置下」未指明是哪一套挂载，而 `attention` 在纯核心挂载下可见且同样带 `reason` | 措辞写明为「全量 feature 挂载配置」，并注明 `attention` 在纯核心挂载下可见且带 `reason` |

## §11 交付后修补（独立复核触发，2026-09-22）

batch-2 交付（`48c2537`）后的一次独立实效复核（在装配后的活面上逐成员实际调用，不看台账自洽）发现 6 处残留偏差，其中 1 处为 batch-2 引入的功能性回归。这些修补按 **ANY** 工作流（AGENTS §3.0.2）立项，逐项修补点、复核排除项、ANY 边界外的开放项与执行记录见同目录 [`repair-ledger.md`](./repair-ledger.md)。本节的结论以该文件的「§6 执行与验证记录」为准。

