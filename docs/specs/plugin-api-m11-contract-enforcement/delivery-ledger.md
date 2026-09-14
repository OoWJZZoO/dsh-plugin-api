# Stage 4 交付台账: plugin-api-m11-contract-enforcement

> feature_name: `plugin-api-m11-contract-enforcement`
> milestone: M11
> 状态：**部分交付（in progress，未收口）**。Stage 3 审查门四轮闭合（见 `tasks.md`「Stage 3 审查门记录」）；Stage 4 按 `tasks.md` 顺序推进，**已完成范围见 §1，未完成项按 Task 编号在 §3 逐条登记为阻塞项**。本线**未达到 Stage 4 完成判定**；全局终审结论见 §7。
> 执行口径：版本冻结基线内（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`），**未步进任何版本字段**；未新增 R 点；官方包零修改。

## 1. 已交付范围（本轮提交，逐项可复核）

基线与计数口径：`tasks.md` P1 的 `3469` 是本线**开工时**（提交 `cf2a2d1`）的测试总数；本线自身新增契约内核测试 11 条，故台账 §2 记「本线实现批次前的 3480」为**含内核批次的中间基线**。交付时的总数见 §2。

| 交付块 | 内容 | 落地 | 台账声称的边界 |
|---|---|---|---|
| 契约内核 | `lib/contract-kernel.js`：判别式结果、资源/贡献/操作 handle、观察 handle（K1/K2/K5/K6/K7 的共用形状）。**零 harness 依赖**（全文零 `import`、纯函数） | 新增 + `test/contract-kernel.test.mjs`（11 断言） | 仅覆盖「可释放对象」的共用形状；**不含**异步 contribution 的 pending `status()` 状态机（见 B7） |
| 分册修订 S1–S15 | `api-idioms`（generation 定义、身份双角色、dispose 结果、availability detail 与归一表、缺位词汇、失败呈现分界、扩展成员/例外边界、terminal 在场条件、异步 contribution `status()`、同步/异步声明、生产者模型）、`public-api-shape`（host/client 树逐名刷新、层级预算、capability 示例修正）、`identity-and-lifecycle`（handle 生命周期面）、`composition-and-authority`（owner 双角色、producer 判定）、`domain-composition`（events 行）、`capability-strategy`（`services.*` 存在性口径例外）、`README`（索引） | `docs/standards/*` | 分册条款**已全部落盘**；S1/S2 在**未收口成员**上的实现一致性按 §4 与 B2 处理 |
| canonical 事件生产权 | 运行时事件目录条目携带 producer 声明（facade / official 两态）；`dispatch()` 在派发前判定——非 producer 返回冻结 `{ok:false, code:'denied'}` 且**不派发**，未声明者 fail-closed；门面转译路径以内部 owner 身份取得权限；官方原生 `ctx.emit` 不经 `dispatch()` 不受影响；`events.define` 语义不变 | `lib/events-bus.js` + 全部 `lib/*-events-catalog.js` + `test/events-producer-authority.test.mjs`（15 断言） | 见 §6 的**能力边界变化**单列 |
| host 注册面收口 | `tools.register` 双形态同形、`tools.restrict`、`tools.guard`、`tools.presentation`、`llm.requestTransforms`、`llm.admissionPolicies`、`llm.routing` 四类（**R 包**）、`remotes`、`tools.discovery.catalog`、`prompts.provenance.policy`（policy 形状 + typed throw + priority 词表校验）、`agents.providers`（显式变体判别）、`attachments.pipeline.transforms`（**R 包**，含把 facade 的注册类兜底 catch 收窄为 typed throw 穿透）、`diagnostics.register` —— 一律冻结标准 handle + 派生 owner + 铸造 generation | `lib/{plugin-api-service,llm-request,llm-input-policy,host-remote,remote-publication,tool-discovery,context-engine,agent-create-api,diagnostics}.js` + `packages/{agent-loop,attachments}` | 冲突规则**按各成员 idiom**：`llm.*` / `tools.register` / `prompts.provenance.policy` 跨 owner 同 id 为 typed owner-conflict；`diagnostics.register` 为 per-owner 记录（跨 owner 同 checkId **并存**，不是冲突）；`tools.guard`/`tools.presentation` 仅包裹官方注册、**无 owner 维度冲突判定**；`remotes.register` 的冲突键是 key |
| 观察面收口 | `sessions.activity.observe`、`executions.observe`、`tasks.observe`、`llm.routing.observe`、`mcp.observe`（**R 包**）、`diagnostics.observe` —— 冻结四成员 handle；内部可变记录闭包私有；释放后订阅 no-op；listener 异常只降级自身；`current()` 释放后返回降级视图 | `lib/{session-activity-observe,execution-observation,session-route,task-execution-observation,diagnostics}.js` + `packages/mcp` | **不含** host `events.observe`、`sessions.planMode.observe`、`sessions.permissionPresets.observe`、`events.define.handle` 的 dispose 收口（见 B8） |
| 操作控制对象 | `sessions.request`、`workflows.start`、`executions.recovery.checkpoints.restore` —— 控制对象统一在 `operation`，`dispose()` 返回 `requested`/`stale`，只读快照并入 `status()`，`observe` 返回退订函数并首投当前状态，`terminal` 仅在返回时可裁决时出现 | `lib/{session-interaction-operation-authority,workflows-operation,workflows-facade,checkpoint-restore}.js` | `tasks.start/settle/attach` 的动词串改名**未做**（见 B1） |
| availability 归一（装饰层） | 领域 detail 保留、非标准状态映射（`unsupported`→`unavailable`、`unknown`/`inert`→`degraded`，原 token 作 `reason`）、删除「解析成功即 active」、异步领域解析**首次探针惰性启动并缓存**（该次返回 descriptor 回退，其后读缓存）使公共探针始终同步 | `lib/namespace-availability.js` | **域侧子项未做**：`coordination.availability` 的缓存化、`security.availability` 的状态化（两文件本轮零改动），见 B9 |
| 缺位词汇（部分） | `executions.get`、`tasks.get`、`tasks.history` 按「确定不存在 ⇒ `missing` / 无法得知 ⇒ `unavailable`」 | `lib/{execution-observation,task-execution-observation}.js` | 余下点位（如 `lib/session-activity-view.js` 的 `absent`）**未做**，见 B10 |
| registry 与机械校验 | **共 57 行**随之落盘（可复核：`git diff cf2a2d1 -- <registry>` 逐行）：注册面 33 行（`tools.register`/`restrict`/`guard`/`presentation`、`llm.requestTransforms`/`admissionPolicies`/`routing` 四类、`agents.providers`、`remotes`、`tools.discovery.catalog`、`prompts.provenance.policy`、`attachments.pipeline.transforms`、`diagnostics.register` 的 leaf 与 handle 行）、观察面 9 行（`executions`/`tasks`/`llm.routing`/`mcp`/`diagnostics` 的 `observe` 及其 handle 行，并**补入缺失的 `tasks.observe.handle` 行**）、贡献面 1 行（`prompts.contribute.handle`）、操作面 6 行（`events.{emit,serial,parallel,bail,waterfall}` 的判别式结果与 producer 判定、`executions.recovery.checkpoints.restore` 及其 handle 行、`workflows.start` 及其 handle 行）、缺位词汇 3 行（`executions.get` / `tasks.get` / `tasks.history`）；`scripts/registry-validate.mjs` 新增两条 entry 级校验；差异表 `docs/specs/plugin-api-m10-contract-convergence/convergence/public-member-table.md` 随 registry 机械重建（**538 行**），并新增其重建入口 `scripts/convergence-table-sync.mjs` | registry + `scripts/*` | 校验面仅新增两条（见 §4）；**例外台账重分类（Task 3.3）未做**，见 B4；成员行数由 537 增至 538 是**补入缺失的 handle 行**，不新增公共能力（`oldToTargetMapping` 同步补行） |

## 2. 跑测与审计（本轮实际结果）

| 项目 | 结果 |
|---|---|
| `npm test`（4G 内存护栏内） | **3511 / 3511 通过**（开工基线 3469；内核批次后 3480；本线净增 42） |
| `node scripts/registry-validate.mjs <registry>` | `registry valid`（exit 0） |
| `node scripts/convergence-verify.mjs` | `537 member rows, 37 behavior rows, 37 fully linked behavior rows`（exit 0） |
| `npm run build:client:check` | `client bundle is up to date with its sources`（exit 0；`lib/client.js` 本轮零 diff，与 client 侧未触碰一致） |
| 治理 token 审计 | `node --test test/governance-token-audit.test.mjs` 2/2 通过（本轮修正了一处 `scripts/convergence-table-sync.mjs` 的 prose 泄漏） |
| 版本冻结审计 | `package.json` 与 registry `contractBaseline` 零 diff |
| 官方包零修改审计 | `/usr/lib/node_modules/@deepseek-ai/dsh/**` 本轮无修改 |
| R 落点契约复刻 / boot 自检 | `packages/agent-loop` 44/44、`packages/attachments` 39/39、`packages/mcp` 103/103 全绿 |

**顺带修复（工程前置）**：`test/session-channel-rate-limit.test.mjs` 的 `windowMs: 1` 与调度器竞速，属**本线开工前既有的偶发失败**（同一提交上 3 次运行中 1 次失败）；已把窗口放宽到 100ms / 等待 200ms，语义不变。该项与本 feature 无关，仅用于保证交付门的可重复性。

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
- **未完成子项**：`api-idioms` §5 已把 `async` 列为必需字段，但 registry 537 行**未回填**，validator 也**未加**该校验。
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

见文末（由终审子 agent 给出后追加）。
