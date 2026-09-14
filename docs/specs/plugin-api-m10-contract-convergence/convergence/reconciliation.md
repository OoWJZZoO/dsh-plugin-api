# 对账与映射（Reconciliation）

> feature: `plugin-api-m10-contract-convergence`（Stage 4 交付物；对应 Req 6、Req 9、Req 12.3，design §2.2/§2.3/§2.4/§5/§6）

## 1. 逐成员映射核对（Req 6.1）

| 项 | 结论 |
|---|---|
| registry `oldToTargetMapping` 规模 | 交付前 375 条 → 交付后 **382 条**（本线新增 7 条 B4 义务路径记录）；其中 **30 条**为删除/内化记录（`targetPath: null`，处置写在 `action`/`relation`），**352 条**带 target |
| schema | 不齐：`oldPath`/`targetPath` 恒在，`action`/`relation` 可缺省（**交付前** 375 条为 22 / 28 / 325 分布；本线新增 7 条均带 `action`+`relation`，故**现状**为 22 / 28 / 332）⇒ 本线按缺省形态处理，**未**要求补齐既有记录 |
| 机械核对（结构） | `scripts/registry-validate.mjs`：`oldPath` 非空与唯一、`action`（若有）在词表内、`members.publicPath` 与 `oldToTargetMapping.targetPath` 中 `services.<key>` 形态的值必须命中白名单键（`oldPath` 本身不校验白名单——B4 记录的 `oldPath` 恰是已删除键，本就不可能命中现状白名单） |
| 机械核对（target 解析） | `scripts/convergence-verify.mjs` 校验项 (f)：每条带 target 的记录都必须解析到**已实现的路径**——registry `members` 的 `publicPath`、`namespaces` 的 `namespace`（或其前缀），或 `services.<key>` 白名单键；两类明确登记的目标按下列登记处理，**其余一律报错**（`test/convergence-verify.test.mjs` 用变异 registry 证明该检查可证伪） |
| 人工核对（行为等价） | 逐条核对的判据是「target 在当前实现中提供旧行为等价语义」。**结论：375 条既有记录中，涉及本轮九线改动面的记录为零**（本线已全量扫描：无任何既有记录的 `oldPath`/`targetPath` 触及 planMode/permissionPresets/credentials/compaction/workflows），故既有记录**无修正项落盘**；本轮新增的 7 条见 §2，其等价语义逐条由对应线的交付测试承担（`consumer-behavior-table.md` 的「成功证据」列） |

**逐条 target 解析的三类结论（382 条全量，按机械检查 (f) 分类）**：

| 类别 | 条数 | 判据与证据 |
|---|---|---|
| 无偏差——target 命中 registry 现有路径 | 340 | target 直接命中 `members.publicPath`/`namespaces.namespace`（或其前缀）、`services.<key>` 白名单键；其中 5 条是 `ctx.pluginApi.client.* → ctx.pluginApi.<path>` 记录（去掉 `ctx.pluginApi.` 前缀后即命中当前路径，前缀只是书写形态） |
| 豁免——client 叶子 target（registry 对 client 半面按 namespace 粒度声明） | 10 | `connection.get`（`test/client-bundle.test.mjs`）、`remotes.observe`/`remotes.dispatch`（`test/client-remote-events.test.mjs`）、`slots.list`/`slots.observe`（`test/official-passthrough-client-root.test.mjs`）、`lifecycle.observe`/`lifecycle.list`（`test/client-generation-rebind.test.mjs`）、`codec.validate`（`test/client-codec.test.mjs`）——registry 的 `clientDomainTree`/`clientRoot` 声明 client namespace 与根成员，client 叶子由运行时实现与上述测试承载，故不逐叶落 `members` 行；豁免清单与证据文件**硬编码在 `scripts/convergence-verify.mjs`**，证据文件缺失同样报错 |
| 豁免——描述性 target（非 ctx 路径） | 2 | `ctx.pluginApi(root)`（client 根本身）、`static module export (client-manifest)`（模块级导出，非 ctx 路径） |
| 修正项 | 0 | 未发现需要在 registry 修正的记录；后续若出现未解析 target，(f) 会以失败而非告警呈现 |

判定口径：上表两类豁免都只对**已核实为真实存在**的目标开放——client 叶子逐条给出实现与测试证据，描述性 target 逐条说明其非路径形态；不为凑数开放通用放行。

## 2. M7 B4 义务路径（Req 6.4/12.3，design §2.3）——本线落盘

| B4 | old（已删） | target | 通道 | 兑现证据 |
|---|---|---|---|---|
| B4-3 | `services.planMode.set` | `sessions.planMode.select` | A 类受控包装 | `test/sessions-plan-mode*.test.mjs` |
| B4-4 | `services.permissionPresets.set` / `selectFor` | `sessions.permissionPresets.select` | A 类受控包装 | `test/sessions-permission-presets*.test.mjs` |
| B4-5 | `services.credentials.set` / `unset` | `credentials.set` / `unset` | A 类 + 声明式 B 类冲突检测 | `test/credentials-mutation.test.mjs` |
| B4-7 | `services.compaction`（整键） | `sessions.compaction.run` | B 类门控 + R 类子面 | `test/sessions-compaction-*.test.mjs`、`test/sessions-compaction-e2e.test.mjs` |
| B4-8 | `services.workflows`（整键） | `workflows.start` | B 类受控包装、无 R | `test/workflows-*.test.mjs` |

**B4-1/6/2 核对（Req 12.3 后半，不在 375 条扫描范围）**：

| 项 | 批准裁决 | 核对结论 |
|---|---|---|
| B4-1 `approval.setPolicy` | 纯删除 | **无回流**：`lib/services.js` 的 `approval` 定义无 `setPolicy` 成员，registry 无对应行 |
| B4-6 `sessionProjectionCache.write` | 纯删除 | **无回流**：`lib/services.js` 的 `sessionProjectionCache` 定义仅 `cachedSnapshot`/`coldSnapshot`，无 `write` |
| B4-2 `services.agentDefaultModel.saveSelection` / `currentSelection` | 驳回删除、保留 | **保留现状无回归**：两成员仍在 `lib/services.js` 白名单定义与 registry 行内，行为未改 |

## 3. registry 映射修正清单核对（design §2.2，L12）

| 记录 | 期望 | 核对结论 |
|---|---|---|
| `llm.registerAdapter` → `llm.adapters.register` | rename 记录保留并变为真实（A 类直绑官方 registerAdapter） | **已由 llm 线落盘**：registry 成员行存在且 currentShape 为真实登记 |
| `llm.adapters.decorate` → `llm.adapters.decorations.register` | split 目标修正 | **已落盘**：`llm.adapters.decorations.register` 成员行存在 |
| `llm.adapters.register.handle` 拆分 | 真实登记 handle 与 `llm.adapters.decorations.register.handle` 两行 | **已落盘**：两行均存在，装饰 handle 的 caller-bound 形状偏差按六元组登记（E8） |
| `llm.adapters.list` 语义拆分 | 真实登记查询；装饰快照迁 `llm.adapters.decorations.list` | **已落盘** |
| `llm.adapters.snapshot` → `llm.adapters.decorations.list`（rename） | 旧行为的等价 target 修正 | **已落盘** |
| `llm.models.list`（新增） | 统一只读模型目录 projection | **已落盘** |

⇒ 本线对 §2.2 **只做核对**（结论如上），未重复落盘。

## 4. 语义判别五组（Req 2.3/6.6）

| 判别组 | 唯一入口 | 互指说明 |
|---|---|---|
| 注册 / 装饰 | `llm.adapters.register`（注册）vs `llm.adapters.decorations.register`（装饰） | 四动作归属总览在 llm 线 design；错误入口按 typed 拒绝 |
| 观测 / 决策 | `events.observe`（projection）vs `agents.decisions` / `prompts.assemblyPolicies` / `tools.executionPolicies` / `events.decisions`（policy） | 观测返回值丢弃、决策返回值保真 |
| 追加 / 替换 | `prompts.contribute`（追加，含 scope）vs `prompts.assemblyPolicies.register`（替换/筛选） | 组合顺序固定 |
| 模式 / 权限 | `sessions.planMode.select` vs `sessions.permissionPresets.select` | 两者正交、各归唯一 owner |
| 操作 / 事实 | 操作 = `sessions.compaction.run` / `workflows.start` / `sessions.request` / `sessions.interactions.respond`；事实 = `compaction/*` / `workflow/*` / `session/*` / `credentials/updated` | 事实 producer authority 保留在引擎/官方组件 |

## 5. OBS-14 三项归属（Req 9，design §5）

### 5.1 优雅 appExit —— 已交付公共 seam

- 实现：`services.appExit`（A 类 advanced passthrough，成员 `exit`，**`optional`**；官方 launcher 经 `dsh-cmdline` `ctx.provide('appExit', host.exit)`）。
- 成员级分级登记在 registry `servicesWhitelist` 的 `memberGrades`：`exclusive` 本性、`composableProfile: false`（不进 Composable Profile）、authority = 官方 launcher 进程生命周期。
- **键数变化**：`servicesWhitelist` 由 53 键增至 **54** 键（design §1.2/§1.5 的「键数不变」表述已按本线修订为「除本线新增的 `appExit` 外键数不变」）。
- 缺席行为（**成员级与面级两种缺席，语义不同**）：官方服务不存在 ⇒ `services.appExit` **面整体 disabled**（`isActive: false`），`exit()` 抛 typed `PluginApiFeatureDisabledError`（`code: PLUGIN_API_FEATURE_DISABLED`）；官方服务在场但成员缺失 ⇒ 面保持 active，`exit` 因 `optional` **整个不出现**（调用方在成员面即可判定）。两种形态都**不合成** `process.exit`（fallback 属消费者业务），也都可与「服务在场的正常调用」区分。证据：`test/convergence-app-exit.test.mjs`（两个用例分别驱动真实装配形态与成员级可选形态）。
- **不做**：不包装、不排队、不拦截、不建设优雅关机编排平台。
- 证据：`test/convergence-app-exit.test.mjs`。

### 5.2 launchEnvironmentOf fallback —— 等价路径成立（契约论证；Task 3.2 的运行时 probe 未执行，见下）

- probe 对象：`services.credentials.resolve(ref)` 的层模型（`env` / `file` / `project-env` / `user-env`）是否覆盖启动环境层。
- 结论（**契约论证**，非运行时 probe）：官方凭据 seam 的层模型**自身覆盖** project-env/user-env——`@deepseek-ai/dsh-credentials` 的类型契约明示本地 provider 的层 id 为 `env`/`file`/`project-env`/`user-env`（`dsh-credentials/lib/types/index.d.ts:23`），而门面 `services.credentials.resolve` 是白名单 1:1 直通（`lib/official-service-definitions.js` 的 `credentials.resolve/describe`，`lib/services.js` 的 `buildActiveFacade` 逐成员转发）⇒ 快照能解析的层，共享 authority 同样能解析；样本的 `launchEnvironmentOf` 分支只存在于 raw host 下 credentials 服务缺席的形态，在受支持基线上该服务恒在。
- **缺口判定**：按契约论证未发现「快照可解析而 credentials 层不可解析」的真实值缺口 ⇒ 无需新增受限只读 seam。
- **未执行的 probe（如实登记）**：Task 3.2 要求的「以真实 project-env/user-env 层值经 `services.credentials.resolve` 验证」**未执行**——该运行时验证需要真实层值与可写存储根，属部署级夹具而非本仓可复现的契约证据。本行以契约论证成立结案，**不冒充 probe 结论**；若后续要求运行时证据，按增量任务补做。

### 5.3 resolveDshHome/scope —— 等价路径成立，无需新 seam

- home 路径解析本身不是 DSH API 行为（本地计算）⇒ 非门面义务，不计入覆盖分母。
- 插件自有数据 → `pluginApi.storage`（profile 档）；读取 DSH 受管数据 → 共享 authority（`services.credentials` / `services.settings`）；禁止硬编码路径直读官方文件。
- 消费者行为表（`consumer-behavior-table.md`）已登记原数据 scope/生命周期 → 新承载的映射行。

## 6. 九线遗留对账（design §6 L1–L21）

| # | 处置 | 本线结论 |
|---|---|---|
| L1 | 保留（该线） | plan-mode 拟新增行已落盘；本线对账一致 |
| L2 | 保留（该线） | queued 结算可观察性由该线 Stage 4 验证 |
| L3 | 保留（该线） | 「审批判定随预设变化」证据在该线；本线组合验收复用（`test/cross-line-scenarios.test.mjs`） |
| L4 | 吸收（本线对账） | 核对 registry：credential 线的冲突检测记录带「门面模拟、非官方仲裁」表述（`sessions.selection.set`/`credentials.set` 的 lifecycle/currentShape 与 capability-strategy 注） |
| L5 | 保留（消费者模式） | 已登记为非门面义务 |
| L6 | 保留（该线）+ 本线对账 | compaction 登记义务四件套已在 capability-strategy §5 / feature-list |
| L7 | 保留（该线）+ 本线对账 | workflow admission rationale 已随 registry 记录 |
| L8 | 吸收（design §3.2 E1–E4） | registry 按 dot path 逐行登记，核对通过 |
| L9 | 保留（该线） | decision 词汇 probe 固化在该线 |
| L10 | 吸收 | turn-stopping 登记为 R 点位（agent-loop owner 切片），registry/standards 核对通过 |
| L11 | 吸收（登记规则） | 无触发项 |
| L12 | 吸收 | §3 核对结论：已由 llm 线落盘 |
| L13 | 保留（该线） | 条件 R 点位随该线（OM-3） |
| L14 | 保留（该线） | fiber probe 判定已在该线 Stage 4 给出结论 |
| L15 | 需裁决（条件触发） | **当前无触发**（该线 probe 已通过，未触及官方组件边界） |
| L16 | 保留（该线） | 三条条件 R 评估入口**均未触发**（interactive 线 Stage 4 的 R-Point 1 收敛为「不落地 R」，R-Point 2 由 A 类白名单窄成员承接，R-Point 3 未触发） |
| L17 | 保留（该线） | wire 细节已在该线 Tasks 固定（两条 typed 路由 + value-only 投影，无 revision） |
| L18 | 吸收 | `attachmentRefs` 映射与消费成员已随该线同步 registry，M9 附件缺口注闭合 |
| L19 | 保留（该线）+ 本线组合验收 | 「恢复后续跑」经 activity/channels 组合验收 |
| L20 | 吸收 | 九线拟新增行已统一落盘，snapshot 与 registry 一致（`test/registry.test.mjs`） |
| L21 | 吸收（本线对账项） | `sessions.selection.set` 的 committed 结果**不带** `commitState`/`generation`：本线核对后按 design §3.1 三选一的**第一项**处置——该线已登记 **idiom 例外六元组**（`memberPath: sessions.selection.set`，`exception: 外层结果省略姊妹 mutation 的统一字段`，见 registry `idiomExceptions`），故无需补齐字段或改写 spec |

## 7. 能力缺口与阻塞项（Req 9.4）

| 项 | 性质 | 最小解除动作 | 需人类授权 | 登记日期 |
|---|---|---|---|---|
| `sessions.interactions` 的 question 侧 pending/answer seam | 能力缺口（非门面义务之外的**真实缺口**） | 官方提供 question 的 pending/answer seam（或放开 `userQuestions` provider 槽位）后按新 feature 立线 | 是（新增 R 点位需走完整 R 流程） | 2026-09-14 |
| per-session grant（逐动作授权） | 能力缺口 | 官方或后续 feature 提供可达的 per-session 授权 seam | 是（同上） | 2026-09-14 |
| `pairing-required` 码无可产出点 | 词表空缺 | 由 channel auth owner 在产生该条件的路径上接线 | 否（属该 owner 维护范围） | 2026-09-14 |

以上三项**不视为非门面义务**，已同步 feature-list §7；无当前触发的需裁决项（design §6 汇总「需裁决 1 条（L15）」当前无触发）。

## 8. authority 地图逐资源对账（Task 5.3 / Req 8.1–8.5）

以 design §4 的 19 行地图为清单逐资源人工对账，结论如下（「实现入口」列给出本仓库的可复核承载；「closure」列核对 design §4 声明的闭合分支是否成立）。

| 资源（design §4 行） | 受支持门面路径 | advanced services / 低层 | 官方 native 路径 | closure 与核对结论 |
|---|---|---|---|---|
| Plan Mode 状态 | `sessions.planMode.select`（唯一受支持门面写路径） | `services.planMode.get`（只读） | 官方 TUI toggle、`/plan`、`exit_plan_mode` → 同一官方 set/onBoundary seam | 统一 authority = 官方 plan-mode 服务 + session 日志（`lib/sessions-plan-mode.js`、`lib/sessions-plan-mode-facade.js`）；白名单不回流写成员（仍只有只读 `get`），native 路径不经门面 owner/审计——**一致** |
| 权限预设 | `sessions.permissionPresets.select` | `services.permissionPresets.current/resolve/optionOf`（只读） | 官方 `/permission`；settings `permission.defaultPreset` 为**显式互斥** authority（只影响未来 session） | 统一 + 显式互斥双分支（`lib/sessions-permission-presets.js`、`-facade.js`）；互斥声明在双方 registry 行与 design——**一致** |
| 受管凭据 | `credentials.set` / `unset` | `services.credentials.resolve/describe`（只读） | 官方 Models/设置页经官方自有写链写同一 provider | 统一 authority = 官方 credentials provider（唯一存储 owner）（`lib/credentials-mutation.js`、`lib/credentials-mutation-facade.js`）；白名单不回流 `set`/`unset`，门面零缓存零影子——**一致** |
| 模型 adapter route | `llm.adapters.register` | —（无 services 成员） | 官方 `registerAdapter`（登记动作本体） | A 类直绑同一官方动作（`lib/llm-adapter-registration.js`）；`llm/adapters-updated` 仍是官方唯一拓扑 producer，门面 CAS 不伪造事件——**一致** |
| adapter 装饰 | `llm.adapters.decorations.register` | — | 官方拓扑 binding 匹配 | 装饰与登记两 authority 互斥可辨（同一模块内两个 registry，各自 handle 与撤销语义），互不越权处置——**一致** |
| 模型目录 | `llm.models.list`（统一 projection） | `services.llm.listProviders/listModels`（官方形状视角） | 官方目录/discovery | 两视角互不改写（`lib/llm-models-projection.js`）；decoration labels 绝不投影为官方能力字段——**一致** |
| 模型选择（per-session） | `sessions.selection.set/get` | `services.apiProxy` 白名单两条窄成员（`sessionsModels` 只读 / `sessionsSelectModel` advanced 直通、`composableProfile:false`、`bypasses` 声明门面协调写路径） | 官方事实源 = apiproxy 私有 selections 状态；官方提交入口 = mux unary `session.selectModel` | 统一 authority = 官方 apiproxy selection 状态（`lib/sessions-selection.js`、`-facade.js`）；门面值级 CAS 覆盖经官方路径的并发写，残余竞态如实声明——**一致** |
| prompt 汇编 | 追加 = `prompts.contribute`；替换 = `prompts.assemblyPolicies.register` | `services.prompts.assemble`（官方装配直通） | 官方 `system-prompt/assemble` 派发点 | 组合顺序固定（追加 → scoped 追加 → 策略）（`lib/system-prompt.js`、`lib/decision-participation*.js`）；官方派发为唯一 producer——**一致** |
| 工具执行边界 | 注册 = `tools.register`；可用性 = `tools.restrict.register`；放行 = `tools.guard.register`；环绕/改写 = `tools.executionPolicies.register` | `services.tools` 纯直通成员 | 官方 `tools/pre-execute|execute|post-execute` 派发 | 每点位单一受支持参与面，三类职责不重叠（`lib/decision-participation.js`、`lib/scoped-agent-contributions.js`）——**一致** |
| 会话压缩 | `sessions.compaction.run`（门控） | —（B4-7 已删整键，不回流） | 引擎内部自动触发（pressure/context-overflow） | 统一 authority = forked 引擎（durable lock 仲裁）（`lib/sessions-compaction.js`、`lib/sessions-compaction-facade.js`、替代包 `packages/compaction-events`）；门面零 emit、零缓存、不自建锁——**一致** |
| workflow run | `workflows.start` + holder-owned run handle | —（B4-8 已删整键，不回流） | 官方 `workflowEngine`（执行 authority）、`workflow/*` 事件 | 统一 authority = 官方引擎（`lib/workflows-facade.js`、`lib/workflows-operation.js`）；门面零缓存、零全局 run 注册表、零新增事件——**一致** |
| 会话发送/取消/排队 | `sessions.request`（含 steer/queue）/`sessions.cancel` | `services.sessions`（官方 store leaf，advanced） | 官方 agent-loop attempt 事实、官方 inbox | 统一 authority = request authority（`lib/session-interaction-operation.js`、`-authority.js`）；M9 边界沿用，排队引用取消走官方 `inbox.remove`——**一致** |
| 待处理交互 | `sessions.interactions.list/get/respond` | `services.apiProxy.respond`、`services.approval`/`services.userQuestions`（官方直通） | 官方 approval/userQuestions 事件与判定 | 决策权归官方 authority，门面只做受限投影与匹配应答（`lib/sessions-interactions.js`、`-facade.js`）；`question` 侧无 seam 已登记为能力缺口——**一致（含已登记缺口）** |
| 只读事件流 | `sessions.channels.*` + `sessions.activity`（消费合同，不新增面） | — | 官方 session 事件顺序 | 载体 = 已交付 connection/gateway 替代行 owners（`lib/session-channel*.js`、`packages/session-channel-*`）；cursor/resume 语义沿用——**一致** |
| 事件参与（决策点） | 四个 decisions registry | — | 官方 waterfall 派发点（A 类）；`agent/turn-stopping` 为 R 点位（agent-loop owner 切片） | 参与条目经 bus substrate 安装为官方 ctx 钩子（`lib/events-bus.js`、`lib/decision-participation*.js`、`packages/agent-loop`）；observe 面保持只读——**一致** |
| 事件生产 | `events.define`（owner-scoped 受限 publisher） | — | canonical 事件 producer 各归官方/替代行 | 订阅权 ≠ 生产权（`lib/events-catalog.js`、`lib/catalog-compose.js`）；扩决策参与不扩 fact 伪造权——**一致** |
| 进程退出（OBS-14.1） | `services.appExit`（本线新增，advanced passthrough） | 该成员本体 | launcher `ctx.provide('appExit', host.exit)` | authority = 官方 launcher 进程生命周期；**exclusive 本性、不进 Composable Profile**（registry `memberGrades.composableProfile:false` + `bypasses`）；服务缺席 → 面 disabled + typed 错误，成员级缺席 → 成员不出现；门面**绝不合成** `process.exit`——**一致** |
| 启动环境值（OBS-14.2） | —（等价路径判定，§5.2） | `services.credentials.resolve`（层模型同源） | `@deepseek-ai/dsh-launch-environment` 包 import（escape hatch 现状） | 统一 authority = 官方 credentials provider 层模型（`lib/official-service-definitions.js` 的 `credentials.resolve/describe` 1:1 直通）；契约论证成立、运行时 probe 未执行（如实登记于 §5.2）——**一致（含未执行 probe 的登记）** |
| 插件私有数据 | `pluginApi.storage`（owner-scoped 薄绑定） | `services.storage`/`services.storageDomain`（advanced） | 官方 storageDomain | 不作为共享 authority 旁路（`lib/storage-binding.js`）；每记录只属一个 scope 档——**一致** |

**保证级别声明（Req 8.3）**：「受支持门面路径」承诺 composition-and-authority §1 四层；「advanced services」默认仅形状稳定层（第一层），组合保证按成员登记（capability-strategy §6.1）——本线新增的 `services.appExit` 成员级分级即按此登记（`exclusive`、`composableProfile:false`）。官方 native 路径与 escape hatch 在门面保证范围外。

**live handle 的合法用法边界（Req 8.2）**：官方返回的 live handle 被门面包装或消费的位置与其边界逐条登记如下；「不支持用法」一律以 typed 结果或 stale 守卫处理，不泄漏无边界共享写 authority（composition-and-authority §5.7）。

| live handle（来源） | 门面包装/消费点 | 合法用法 | 不支持用法（呈现） |
|---|---|---|---|
| 官方 workflow run | `workflows.start` 的 holder-owned handle | holder 读 `status()`/`observe()`/`result`、`cancel(reason?)`、`dispose()` | 跨 owner 共享写、伪造终态、`dispose` 后继续观察（typed stale/no-op，见 `test/workflows-e2e.test.mjs`） |
| 官方 agent | `agents.scopes.register` 的 scope-bound handle `{ id, ownerId, generation, target, status(), dispose() }` | contributor 对**自己的** target 安装/撤销、读状态 | 对他人 target 安装、以旧 generation 撤销（typed 冲突/eviction，见 `test/scoped-agent-contributions.test.mjs`） |
| 官方 session | `sessions.planMode.observe` 的 target 绑定句柄 | 读投递（投递前重读官方 `get` 核验）、随 `session/disposed` 停止 | 目标关闭后继续投递（即时停止，见 `test/sessions-plan-mode.test.mjs`） |
| 官方 session 事件流 | `sessions.channels` 的 channel handle（含 generation） | 按 generation 续读、cursor 推进、显式释放 | 跨 generation 续读（`stale`/`invalid-input` typed 拒绝，见 `test/interactive-session-consumption.test.mjs`） |
| 官方 request operation | `sessions.request`/`cancel` 的 operation 句柄 | status/observe 读、以 operation id 取消、client 经 typed 路由读投影 | 复用 rebind 前的旧句柄（stale 守卫）、同 session 并发第二请求（`already-running`，见 `test/session-interaction-operation-wire.test.mjs`） |
| 官方 adapter binding | `llm.adapters.register` 的 `{ id, ownerId, generation, dispose() }` 与装饰的 `{ dispose(), snapshot() }` | 登记 owner 按 identity 撤销、读装饰快照 | 撤销他人 handle、以旧 generation 换实现（identity-bound typed no-op，见 `test/llm-adapter-registration-e2e.test.mjs`） |
| 官方 checkpoint 记录 | `executions.recovery.checkpoints` 的创建/恢复句柄 | `inspect`/`planRestore` 只读、恢复操作句柄读终态 | 把 checkpoint 记录当活指针、跨记录隐式级联（typed 拒绝，见 `test/checkpoint-restore.test.mjs`） |
| 官方 approval 请求 | `sessions.interactions` 的受限视图 + 兜底 answerer 持有 | 持有时应答、按视图 id 寻址、租约到期自动结算 | 未持有时应答（`stale`/`unavailable` typed）、代答（不进入即不干预，见 `test/sessions-interactions.test.mjs`） |

**关键不变量的门面闭合（Req 8.5）**：凭据不回显（逐出口 fail-closed 脱敏）、预设判定权（门面不模拟审批）、压缩事务原子性（引擎唯一执行者）、终态唯一（loop/引擎裁决）、owner 派生不可伪造（caller-fiber 派生）五项均由门面自身或其唯一 authority 闭合，未借推荐 `services`/raw 对象绕过；九线与本线的组合证据见 `test/cross-line-scenarios.test.mjs` 的 slice A–I。
