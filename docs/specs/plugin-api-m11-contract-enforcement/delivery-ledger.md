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
| `npm test`（4G 内存护栏内） | **3519 / 3519 通过**（开工基线 3469；首轮交付 3514；本轮净增 5） |
| `node scripts/registry-validate.mjs <registry>` | `registry valid`（exit 0） |
| `node scripts/convergence-verify.mjs` | `539 member rows, 37 behavior rows, 37 fully linked behavior rows`（exit 0；行数增至 539 是补入 `lifecycle.register` 现行 leaf 行，不新增公共能力） |
| `npm run build:client:check` | `client bundle is up to date with its sources`（exit 0；本轮 client 侧源码有改动——`client-generation-rebind`、`client-attention-face`、`client-slots`——bundle 已重建，产物 diff 仅含预期变更） |
| 治理 token 审计 | `node --test test/governance-token-audit.test.mjs` 2/2 通过（本轮修正了一处 `scripts/convergence-table-sync.mjs` 的 prose 泄漏） |
| 版本冻结审计 | `package.json` 与 registry `contractBaseline` 零 diff |
| 官方包零修改审计 | `/usr/lib/node_modules/@deepseek-ai/dsh/**` 本轮无修改 |
| R 落点契约复刻 / boot 自检 | `packages/agent-loop` 44/44、`packages/attachments` 39/39、`packages/mcp` 103/103 全绿 |

**顺带修复（工程前置）**：`test/session-channel-rate-limit.test.mjs` 的 `windowMs: 1` 与调度器竞速，属**本线开工前既有的偶发失败**（同一提交上 3 次运行中 1 次失败）；已把窗口放宽到 100ms / 等待 200ms，语义不变。该项与本 feature 无关，仅用于保证交付门的可重复性。

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
| 3.5 / 3.6（登记同步） | 本轮全部实现改动同步 registry（B1/B2/B9/B10/B11/B14/B18/B19/B20/C3 的 `currentShape`、`identitySource`、`bypasses`）；成员表机械重建（**539 行**） | registry + `convergence/public-member-table.md` |

**本轮未完成**（**不是阻塞项**：无硬停机点、无环境 / 工具链 / 权限缺失，全部是同一工作序列中尚未执行的主体工作；清单即下一轮的起点）：

| Task | 未完成内容 |
|---|---|
| 5.1–5.6、5.13（client 半）、8.4–8.7（B3） | client 贡献面（`slots.contribute` / `remotes.contribute` / `settings.remote.contribute` / host `settings.remote.contribute`）的判别式结果与 pending handle；client `events.observe` 的观察 handle 与事件目录查询；client 六个 `availability` 与 `capabilities.*` 的真实叶子状态；`connection.get` → `connection.api.settings`；`settings.scope` 调用套路统一；slots 的只读声明投影与 `list` 的「未声明 / 已声明为空」区分 |
| 3.3 / 3.4 / 10.1(e)（B4） | 例外台账重分类（回收 6 条记录 / 4 行、新增 3 条）与 validator 的三条 entry 级校验 |
| 3.1（registry 半，B5） | 538 行 `async` 回填与 validator 校验 |
| 3.6（B6） | M10 行为表 / 装配表与历史现状注（成员表已随 registry 重建并全链通过） |
| 8.x 余项（B12） | C1b、C4/C5 通道半、C7、C8、C9、C10a、C12、C13 保留判定、C14 内容模型、C15、C17 抽样复核 |
| 9.1 / 9.2（B13） | 双 synthetic 插件组合验收与迁移切片的新增证据 |
| 10.1(a)（B16a） | A1–A5 / B1–B3 / C1–C17 / R1–R6 的四态结论表 |

**B5 的取舍记录**：两条路径均已评估——运行时逐叶采集需完整 harness（(a) 方案的本意即为此建采集入口）；静态扫描对 471 个可判定成员命中 413（88%），其余 58 个为 getter、别名与 removed 行。**用启发式结果回填会产生与运行时不符的登记**，故本轮不落该字段，留待 (a) 的采集入口，避免以失实登记充数。

---

## 3. 阻塞项登记（Req 13.6）

按 `tasks.md` 的 **Task 编号**逐条登记。每条给出：未完成子项、解除所需的**具体可执行动作**、是否需要人类授权。**原因**在不言自明（单一未完成子项 + 明确动作）的条目中从略，在需要解释取舍或依赖关系的条目（B6、B9、B11、B12、B13）中写出。登记日期 2026-09-14（未变更）。

### B1 Task 6.4 —— `tasks` 动词串字段改名与三个例外
- **未完成子项**：`tasks.start` / `settle` / `attach` 的外层结果字段仍为 `operation`（承载动作名）；三条新增例外（`baseContract: operation`）六项未落 registry。
- **解除动作**：改 `lib/task-execution-observation.js` 三处字段名为 `action`；加 `tasks.{start,settle,attach}` 三条六项例外；registry 三行同步。
- **人类授权**：否（design §2 B1 已授权）。

### B2 Task 4.14 / 4.15 —— K1/K2/K3 全树一致性收口
- **未完成子项**：registry 驱动的静态枚举未执行完。已知未收口成员族：`executions.recovery.{policy,visibility,capability}.register|declare`、`executions.visibility.register`、`agents.decisions.register` / `tools.executionPolicies.register` / `prompts.assemblyPolicies.register` / `events.decisions.register`、`security.{policy,redaction,egress}.register`、`sessions.channels.auth.{register,pairingProvider.register}` 与 `sessions.channels.redaction.register`、`skills.activation.register`、client `lifecycle.register`、`tools.executionMode.register`（**注**：该官方动词是分类查询、不是注册，registry 行文字漂移，与本项一并处置）、`llm.adapters.register.handle`、`llm.adapters.decorations.register.handle`。
- **解除动作**：按 `tasks.md` Task 4.14 的两臂枚举（`idiom ∈ {policy, resourceRegistry, contribution}` 的现行行 + handle 行；`currentShape` 描述 disposer/handle 的行）逐项就地收口；随后把 §4 的 generation 校验从「itemize 成员集」提升为**覆盖全部 policy/resourceRegistry handle 行**，并把 16 行 `currentShape: null` 一并补齐。
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

1. **policy / resourceRegistry handle 的 generation 成员**。规则**只对「itemize 成员集」（`currentShape` 含 `{`）的行生效**，且**豁免带 `idiomExceptions` 的行**（该行的偏离已登记）。实测口径（现行 registry，`kind === 'handle'` 且 `status !== 'removed'`）：policy/resourceRegistry handle 行共 **37** 行，其中 `currentShape` 为 `null` 的 **16** 行（不被本规则覆盖）；形状为 prose 且未登记例外的仅 **2** 行（`skills.activation.register.handle`、client `lifecycle.register.handle`），二者即 B2 的收口对象。
2. **例外记录的 `baseContract` 必属八类 idiom**。

**为什么现在不强制全量**：本线未完成 B2 的全树收口；若对全部 37 行强制，就等于要求为**未改动的成员**填写与其运行时不符的 `currentShape`——那是伪造登记，比漏报更有害。另有 **21 行** handle 行的 `currentShape` 为 `null`（**本线开工前既有的 registry 缺口**，design §2.4 的 R 系列只覆盖其中六条），按 Req 12.2 在此显式登记为待办，解除动作并入 B2。

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
