# Stage 3 - Tasks

> feature_name: `decision-participation-contract`
> milestone: M10
> status: Stage 3 已交付（2026-09-12）：Tasks 经两轮阻塞对抗性审查通过（第一轮修订 compaction/title 词汇等六处；第二轮无阻塞，两条单点建议已落实），进入 Stage 4
> 上游：goal.md / requirements.md / design.md（Stage 0–2 已交付）；本清单与 requirements 逐条对应。
> 版本冻结：全部任务在 runtime `0.1.0-rc.6`、包版本 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1` 冻结基线内完成，不得步进任何版本字段。

## 执行前置（已完成的 Stage 4 契约探针记录）

以下官方消费语义已对照锁定 runtime 源码核实（任务内引用为「探针结论」，实现以结论为准；若实现中发现偏差，按 spec 修订流程同步 requirements/design 并登记）：

- **P1 `agent/request`**（官方 `dsh-agent-loop/lib/index.js`）：waterfall 链默认返回 `seedConfig`（deep-frozen `{provider, model, reasoningEffort?, maxTokens?}`）；producer 消费 `proposedConfig.provider/model`（缺失即抛错）。词汇：config 对象（provider/model 非空字符串）；`undefined` = 无决定（续链）。catalog freeze `deep: []`。
- **P2 `agent/request-error`**（同上）：链默认返回 `undefined`；producer 仅判 `action?.kind === 'retry'`（否则按官方失败收口）。词汇：`undefined`（无决定）| `{kind:'retry'}`。
- **P3 `tools/post-execute`**（官方 `dsh-tools/lib/index.js` `postExecute`）：dispatch args `(exec, result, next)`；官方 `PostToolDecision` = `{kind:'accept', content?|value?, additionalContexts?}` | `{kind:'block', feedback, additionalContexts?}`；`content` 与 `value` 同现官方抛 TypeError（参与面按 malformed → 无决定处理，containment 家族先例）；value 替换在 `result.isError` 时官方抛 TypeError（同理 malformed）。默认链返回 `{kind:'accept'}`。
- **P4 `tools/execute`**（官方 `dispatchScheduledExecution`）：dispatch args `(exec, next)`，`exec` 为 mutable（官方在 body 前后原位替换 `exec.signal`）；around 返回值即链结果（`normalizeDispatchResult` 消费）。call identity 不可变、仅 `exec.signal` 可原位替换（catalog payload 契约）。
- **P5 `fs/write-intent` / `fs/edit-intent`**（官方 `dsh-tool-fs` + `dsh-fs-local`）：waterfall 返回值直接作为 `writeText/editText` 的 `expected` CAS 条件消费（`kind: 'replaceIfVersion' | 'createIfAbsent'`）；官方**没有**返回值型 deny 通道——deny 的官方机制是 listener 抛错（经 `fault: 'propagate'` 家族路径）使工具以 isError 收口。参与面的 deny 决定因此实现为**有意的 typed denial 错误传播**（见 T2/T3）；意外失败仍 containment + 放行。facade catalog 登记 fault `'contain'` / freeze `'all'`（base events catalog 现状），参与包装的 deny 传播是分类后的决定路径，不是故障路径。
- **P6 `system-prompt/assemble`**（官方 `dsh-system-prompt` `assemble`）：追加型 contributions（facade `prompts.contribute` 经官方 layers 登记）在 waterfall **派发前**已合入 assembly——Req 6.3 结构性成立。官方在 waterfall 之后仍执行 complete-section 过滤与 runtimeContext suppression（使用派发前快照）：当 complete section 存在时，策略对其他 sections 的修改在最终输出中被官方语义收敛。此为官方消费语义，按原样保留并在测试中如实断言（不改官方行为、不伪装策略改写总是可见）。
- **P7 `agent/turn-stopping` 消息契约**（官方 `dsh-agent-loop` `Inbox` + loop）：next-step pending 项为 user message 形状（claim 后作为 `decision.messages` 进入 `preStep`，append 为 `user/message`）；`Inbox.splice` 本身不做形状校验。切片的 message 有效性校验在门面分类器中按 user-message 形状最小判定（对象 + 可投影内容），与既有 session-title `malformed` 家族语义一致。
- **P8 `agent/pre-step`**（官方 `preStep`）：waterfall 默认链返回 `{kind:'enter', messages:[...claimed, context]}`；`decision.kind === 'reject'` 短路；enter 必带 `messages`（循环解引用 `decision.messages.length`）。

## Task 1: 统一参与承载——events bus 值感知参与条目（内部机制）

**对应需求**：Req 11（排序/收敛/containment）、Req 12（observe 分界）、Req 13.4–13.5；design「机制设计·统一参与承载」。

- [ ] 1.1 在 `lib/events-bus.js` 新增内部安装路径 `registerParticipation(name, spec)`（非枚举 bus 成员，与 `dispose` 同模式）：校验 `name` 在**当前 active catalog** 中存在、`meta.mode === 'waterfall'`、`spec.decide` 为函数、`spec.priority` ∈ `lowest|low|normal|high|highest`（拒绝 `monitor`——保留给 observe feed）；不校验事件语义（准入归领域 registry 层，bus 只做模式与存在性守门）。
- [ ] 1.2 参与条目复用现行 `subscribe`/`reconcile`/`sortEntries`/scope 门控/冻结机制安装为非 monitor 官方 ctx 钩子；条目带 `participation` 标记，`runWaterfallListener` 对参与条目走**值感知包装**（非参与条目成功路径语义不变）：
  - 返回 `undefined`（无决定）→ 续链（`continueIfNeeded()`）；
  - 返回 typed 决定（分类器判定有效）→ 该值成为链结果（不调 `next`，对齐 cordis「不调 next 即 veto」语义，保证 reject/deny 不被下游覆盖）；
  - 返回畸形值（分类器判定 malformed）→ 按未决定处理：有界诊断（logger.warn，单条、无 payload 全文）+ 续链；
  - throw / rejection → containment（对齐 catalog `listenerFailureDefault` 家族）+ 续链（点位默认决定生效）；
  - promise 返回值一律 await 保留（dispatch 待结算）；分类在结算后进行。
- [ ] 1.3 deny 传播例外（P5）：fs 意图点位的分类器可声明 `onDecision: 'propagate-error'`；该点位的有效 deny 决定转化为 typed denial 错误从参与槽位抛出（经官方 dispatch 传播到 producer，使写入以 isError 收口）；意外 throw/rejection 仍 containment + 放行。该例外仅限准入集中官方消费语义为「抛错即拒绝」的点位。
- [ ] 1.4 测试（`test/decision-participation-bus.test.mjs`）：undefined 续链 / 有效决定 veto 整链 / malformed 续链且有界诊断（不含 payload 全文）/ throw 与 rejection containment 且 producer 完成递延 / 优先级词表 + 注册顺序 / `monitor` 拒绝 / scope 门控复用（不匹配静默续链）/ observe monitor feed 仍观察参与派发且返回值不参与（Req 12.1–12.2）/ 非参与条目（既有 `events.on` waterfall 语义）回归不变。

## Task 2: 决策分类器与参与 registry 工厂

**对应需求**：Req 1.1/1.5、Req 10.3、Req 11.3–11.5、Req 13；design「机制设计·领域 registry 记录」「失败路径与 guard 策略」。

- [ ] 2.1 新建 `lib/decision-participation.js`（零 harness 依赖的纯模块 + 可注入依赖的工厂，模式同 `llm-request.js` 的 registry）：`createDecisionRegistry({ point/name, classify, install, resolveOwnerId, logger, availability })`。registry 记录 owner/id/generation/priority/scope/decide/order；owner 由 caller 上下文派生（`CORDIS_TRACKER` 绑定 + `callerIdentityOf`，同 `events.define` 模式，不可伪造）；**generation 为 owner-specific opaque token（`identity-and-lifecycle.md` §2），不使用全局单调序号**（`events.define` 的全局计数器形态不复制）；同 owner 同 id **latest-wins**（新条目替换仍在生效旧条目，返回新 generation handle，旧 handle 变 typed stale no-op）；跨 owner 同 id 抛 typed `owner-conflict` error（`api-idioms.md` §3.2 外层合同：注册错误以 typed error 表达，不返回 ok:false）；handle 固定 `{ id, ownerId, generation, dispose() }`；dispose 幂等、identity-bound、只撤自身 generation。
- [ ] 2.2 逐点位决策分类器 `classify(value) → 'undecided' | 'decision' | 'malformed'`（词汇按探针结论 P1–P7 固化，注释引用官方消费语义）：
  - `agent/pre-step`：`{kind:'enter', messages:array}` | `{kind:'reject', reason?}`；
  - `agent/request`：`{provider:非空string, model:非空string, ...}` config 对象（undefined = undecided）；
  - `agent/request-error`：`{kind:'retry'}`（undefined = undecided）；
  - `agent/turn-stopping`：`{kind:'proceed'}` | `{kind:'continue', message:<user-message 形状>}`（undefined = proceed；message 按 P7 最小判定）；
  - `system-prompt/assemble`：改写后 assembly（结构化对象，含 `sections` 数组；undefined = undecided → 续链沿用当前 assembly）；
  - `tools/execute`（around 例外）：任何非 undefined 返回值均为有效链结果（undefined = 续链调用 next）；
  - `tools/post-execute`：`{kind:'accept', content?|value?(互斥), additionalContexts?}` | `{kind:'block', feedback, additionalContexts?}`（undefined = undecided）；
  - `fs/write-intent` / `fs/edit-intent`：`{kind:'deny', reason?}`（undefined = proceed；有效 deny → propagate-error 路径，见 1.3）；
  - `compaction/request`：`{kind:'reject', reason?}` | `{kind:'replace-range', start, end}`（扁平 inclusive 整数边界、`start <= end`；undefined = undecided；嵌套 `range` 对象按 producer 契约为 malformed；家族先例 = compaction-events event-contract `decideCompactionRequest` 分类语义）；
  - `session-title/candidate`：`{kind:'exclude', reason?}` | `{kind:'replace', message:{seq}, reason?}`（undefined = undecided；`reason` 可选且合法，缺失不得误判 malformed；家族先例 = session-title event-contract `decideSessionTitleCandidate` 分类语义）。
- [ ] 2.3 turn-stopping 参与链导出：registry 工厂支持导出某点位的收敛调用器；门面侧在 pluginApi 服务上以 `Symbol.for('dsh-plugin-api.agents.decisions.turn-stopping')` 契约键安装 `{ contractVersion, invoke({agent, turn, signal}) }`：priority + 注册顺序排序、scope 门控（agent 身份匹配）、payload deepFreeze（catalog `deep: []`）、逐参与者 containment（失败 = proceed 槽位 + 有界诊断）、收敛 = 链上最后一个显式 `continue`（未决定不覆盖先到 continue），无 continue → 返回 null（官方等价行为）。横切语义全部留在门面（R8 边界）。
- [ ] 2.4 测试（`test/decision-participation-registry.test.mjs`）：owner 派生与不可伪造（caller tracker 缺失 → root fallback）/ 同 owner latest-wins（旧 handle stale no-op 且不撤新条目）/ 跨 owner owner-conflict typed error / dispose 幂等 + identity-bound / owner 卸载隔离（一个 owner 的条目被移除或其 fiber 卸载后，仅其自身条目失效，其他 owner 在同点位的条目继续被派发——Req 13.2）/ 逐点位分类器三态判定（含 P1–P7 边界样本：content+value 同现、provider 缺失、thenable、replace 携带可选 reason 等）/ turn-stopping 链收敛与 containment（含 scope 不匹配跳过、畸形 continue 按未决定）。

## Task 3: 领域 registry 公共面与 namespace 组装

**对应需求**：Req 1（全部条目）、Req 10（准入与约束）、Req 13.1–13.3、Req 15；design「公共面与 path 决定」。

- [ ] 3.1 新建 `lib/decision-participation-facade.js`（组装模块，依赖注入 bus / 探针 / logger / resolveOwnerId）：按 design path 表创建四个公共 registry：
  - `agents.decisions.register({ point, id, priority, scope?, decide })`：point ∈ `pre-step | request | request-error | turn-stopping`；前三者经 `bus.registerParticipation` 安装；`turn-stopping` 走 2.3 的链（不装 ctx 监听）。
  - `tools.executionPolicies.register({ point: 'execute'|'post-execute', id, priority, scope?, decide })`。
  - `prompts.assemblyPolicies.register({ id, priority, scope?, decide })`（point 固定 `system-prompt/assemble`）。
  - `events.decisions.register(name, spec)`：准入集显式枚举 = `fs/write-intent | fs/edit-intent | compaction/request | session-title/candidate`；逐点位 typed 词汇（2.2）。
- [ ] 3.2 准入与冲突拒绝（Req 1.6/1.7、Req 10.2）：非准入名 / fact / 观察事件名 / 已有领域面承载的点位（`tools/pre-execute` → guard、`llm/stream` → decoration+requestTransforms、route/health → `llm.routing.*`）→ typed `unsupported`/`conflict` 结果，reason 指明目录状态或承载面；不安装任何监听。`tools/executionPolicies('post-execute')` 注册照常受理（Req 7.4 的 block-with-feedback 缺口面）——仅当参与需求为**纯内容脱敏**时，在文档与 diagnostic 中改道既有 `security.redaction` 面，post-execute 面不复制脱敏 authority。`tools.guard`、`security.redaction`、`llm.requestTransforms`、`llm.routing.*`、`prompts.contribute` 既有 authority 零改动（不制造第二决策 owner）。
- [ ] 3.3 可用性门控（Req 13.3）：每次 `register` 前探测点位 backing——基础 catalog 点位按 active catalog 成员判定；`compaction/request`、`session-title/candidate` 按对应替代行 catalog slice 的 isActive 判定；`turn-stopping` 按 agent-loop 替代行 active + 版本一致 + `agentLoop` 服务存在判定（复用 `auxiliaryManifests.agentLoop` 契约与 loader 探测，模式同 compaction-events slice）。backing 不可用 → typed `unavailable` 结果（注册面）+ registry `availability()` 报 degraded/unavailable；不影响无关点位。
- [ ] 3.4 namespace 组装（`lib/plugin-api-service.js` + `lib/index.js`）：新增 feature mounter `mountDecisionParticipationFeature`（FEATURE_MOUNTERS 中置于 `events` 之后，需要 bus 与 caller tracker）；服务上以 slot 模式（`createFeatureSlot` + namespace getter merge，模式同 checkpoints/activity slot）把 `decisions` 并入 `agents`、`executionPolicies` 并入 `tools`、`assemblyPolicies` 并入 `prompts`、`decisions` 并入 `events`；各 registry 面提供无副作用 `availability()`（冻结对象，status ∈ active|degraded|unavailable）。feature guard 失败时四个成员保持 typed disabled 形状（不破坏既有 namespace）。
- [ ] 3.5 测试（`test/decision-participation-facade.test.mjs`）：四入口注册→官方派发真实生效（active catalog 点位）/ 准入集拒绝矩阵（非 catalog 名、fact 名、领域面承载点名）/ `unavailable` 门控（构造替代行缺位与版本错配两种场景）/ slot 装配与 disabled 形状（feature 未挂载时成员存在且 typed disabled）/ `availability()` 冻结无副作用。

## Task 4: turn-stopping R 切片（agent-loop 替代行内能力切片）

**对应需求**：Req 5（全部条目）；design「R slice 设计」（R1–R8、官方契约基线、横切语义归属、同包切片共存）。

- [ ] 4.1 新建 `packages/agent-loop/lib/participation-slice.js`：`TURN_STOPPING_PARTICIPATION_SYMBOL = Symbol.for('dsh-plugin-api.agents.decisions.turn-stopping')`（字符串与门面侧一致；包不 import 门面模块）；探测 helper（从 `loopCtx.get('pluginApi')` 取契约、`contractVersion` 数值比对）与决定应用 helper。
- [ ] 4.2 `packages/agent-loop/lib/forked-loop.js` 派发点切片：构造器探测门面参与链（同 routePolicy 探测模式，缺位/版本失配 → 本切片停用，官方等价行为）；在官方 `await this.dispatch.serial("agent/turn-stopping", {turn, signal})` 之后、`signal.throwIfAborted()` 之前追加：以冻结 `{agent: this, turn, signal}` 调用参与链 → 收敛 `continue` → 经官方 next-step inbox 通道插入 message（`this.inject(message)`，官方 Inbox 持久 splice，`agent/inbox/inserted` 由官方路径发出）→ 循环自身停止复查观察到 pending 项而续延本 turn；收敛 proceed/null → 无任何动作。全程 try/catch containment：切片失败 = 停止流程照官方判定，绝不抛穿循环、绝不双跑（参与链与官方 serial 派发是同一次派发内的先后步骤）。
- [ ] 4.3 `packages/agent-loop/lib/apply.js` 加性自检：既有自检矩阵追加本切片检查项（门面契约符号可达 + contractVersion 一致）；失败仅降级本切片（有界日志），替代行其余切片（route-policy / interaction / evidence / recovery）与官方等价循环契约照常，绝不静默双跑。
- [ ] 4.4 测试（`packages/agent-loop/test/`，新增 `turn-stopping-participation.test.mjs`）：官方契约基线逐位对照（无参与者时 fork 派发 payload/时序/停止复查与官方行等价——既有基线回归 + 本切片零干扰）/ `continue` 决定经官方 inbox 真实续延本 turn（pending 非空 → 循环进入下一步，claim 消息成为下一步 messages）/ 门面缺位、契约版本失配、参与链 throw 各自回退官方等价行为（有界诊断）/ serial 派发恰好一次（双跑检测）/ scope 不匹配参与者不被调用 / 同包切片隔离（interaction/evidence/route-policy 各自 active 标记与行为不受本切片失败影响）。

## Task 5: 端到端验收与迁移证据

**对应需求**：Req 2、Req 3、Req 4、Req 6、Req 7、Req 8（归属证明）、Req 9、Req 14；design「与既有等价面的分工矩阵」「迁移证据义务」。

- [ ] 5.1 端到端验收测试（`test/decision-participation-e2e.test.mjs`，真实官方 dispatch substrate，不用同进程 mock 旁路公共入口）：
  - Req 14.1 两策略不同 priority 有序组合、终局决定反映两者；
  - Req 14.2 pre-step reject 实际阻止本步进入（producer 收到 reject，`turnEnds: blocked` 家族行为）；
  - Req 14.3 消息改写到达本步（enter messages 成为 `decision.messages`）、assembly 整体替换 + tools 过滤进入下一阶段、post-execute content/value 改写到达模型结果；
  - Req 14.4 `tools/execute` around 异步捕获在工具副作用前完成（真实工具 body 顺序断言）+ around 策略收到的 `exec` 引用与官方派发对象同一（identity 相等，仅 `exec.signal` 可原位替换——P4）；fs 意图屏障在写入前结算，deny 阻止写入（P5 传播路径 → isError 结果）；
  - Req 14.5 throw/rejection/abort/stale disposer 不破坏其他 owner 与 producer；
  - Req 14.6 observe 返回 reject 形状值不改变决定结果（最小复现行为保持）。
- [ ] 5.2 消费者迁移切片（追加到 `test/consumer-migration-slices.test.mjs` 或本 feature 专属切片文件，文件头矩阵：原行为 → 目标公共调用 → 运行结果）：
  - agent-teams pre-step 激活（await next、保留 reject、追加 activation message、返回新 enter）；
  - anchor 整体 sections 替换 + tools 筛选（含 P6 complete-section 官方语义的如实断言）；
  - turn-rewind / checkpoint-rewind 执行前捕获（fs 意图屏障 + tools execute around；快照执行归 checkpoint owner 的归属注记）；
  - model-failover request-error `{kind:'retry'}` 参与 + route/health 决策归 `llm.routing.*` 的分工证据；
  - secret-redactor 迁移到 `security.redaction`（既有面）+ post-execute block-with-feedback 缺口补足；
  - auto-continue turn-stopping 受控续延（经 R 切片）。
- [ ] 5.3 Req 8 归属证明：测试断言 `events.decisions('llm/stream')` 返回 typed unsupported 且 reason 指明 `llm.adapters` decoration + `llm.requestTransforms` 承载面（逐点证明已有领域 API 承载）。

## Task 6: 契约登记与治理同步

**对应需求**：Req 1 分类、Req 5 分类（R 类登记义务）；design「idiom 归类与例外登记」「R slice 设计·登记义务清单」。

- [ ] 6.1 canonical registry（`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`）同步：eventCatalog `agent/turn-stopping` 行修订为 decision 参与语义（补 `decisionPrecedence` / `conflictConvergence` / `listenerFailureDefault`）；新增成员行 `agents.decisions.register`、`tools.executionPolicies.register`、`prompts.assemblyPolicies.register`、`events.decisions.register`（idiom `policy`；`tools/execute` around-execution 与 fs 意图 async-barrier 两处 §1 六项例外登记：memberPath / baseContract / exception / reason / replacementShape / verification）；capabilityMatrix 增补本能力条目（公共语义 path，不含治理名）。同步时按本文边界规则把 post-execute 决策词汇的官方 `additionalContexts?`（探针 P3，较 Req 7.3 枚举为超集）回写 requirements Req 7.3 与 design 保真表，保持 spec 与实现词汇一致。
- [ ] 6.2 `docs/standards/capability-strategy.md` §5 装配表注：`plugin-api-agent-loop` 行注明 turn-stopping 参与能力切片。
- [ ] 6.3 `docs/specs/plugin-api-features/feature-list.md`：§3.1 报备（同组件同包能力切片先例）+ 本 feature §7 交付登记（Stage 4 完成后）。
- [ ] 6.4 U-series 新条目：agent-loop owner 独立新提案（turn-stopping 参与 seam；不占用/扩展 U11/U19），退役条件 = 官方在 turn-stopping 派发点原生提供等价决策参与 seam。
- [ ] 6.5 AGENTS.md §2/§4 能力边界同步（若裁决后表述需要；无则记录「无需变更」结论）。
- [ ] 6.6 版本冻结核查：全部改动不触及 runtime identity、`dsh.api`、任何包版本字段；registry JSON 与包 JSON 无版本步进。

## Task 7: 全局验证与收尾

- [ ] 7.1 `npm test` 全量（4G 护栏）全绿；`git diff --check` 干净。
- [ ] 7.2 装配等价：full 聚合装配下 agent-loop 替代行切片行为与选择性安装一致（既有 full 装配测试覆盖 + 本切片用例）；未安装 agent-loop 辅助包时 `agents.decisions('turn-stopping')` typed `unavailable`、其余点位不受影响。
- [ ] 7.3 spec 状态行与 feature-list 登记更新；交付报告列明探针结论（P1–P8）与 requirements/design 的任何就地修订。

## 依赖顺序

Task 1 → Task 2 → Task 3 →（Task 4 可与 Task 3 并行开发，集成在 Task 5）→ Task 5 → Task 6 → Task 7。Task 4 依赖 Task 2.3 的契约键定义；Task 5 依赖 Task 3 与 Task 4；Task 6 的 registry 同步在实现形状定稿后执行。

## 边界（执行期约束）

- 不改动 `tools.guard` / `tools.restrict` / `security.redaction` / `llm.requestTransforms` / `llm.admissionPolicies` / `llm.routing.*` / `prompts.contribute` 的既有 authority 与行为。
- 不恢复万能 `ctx.on` 决策登记；`events.decisions` 准入集之外一律 typed 拒绝。
- 不新增派发内核、不改变官方 dispatch 模式与 deepFreeze 语义；`events.observe` 行为零变更。
- 治理代号（模式字母、需求编号、feature 编号）不进入任何实现代码、包名或运行时字符串。
- 若实现中发现官方消费语义与探针结论不符：先修订本目录 spec 文档保持一致再继续；触及硬停机点（版本与发布、milestone 范围）时暂停上报。
