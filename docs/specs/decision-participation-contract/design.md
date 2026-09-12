# Stage 2 - Design

> feature_name: `decision-participation-contract`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12；与 requirements.md 同批产出，承接已确认 goal.md）
> 输入溯源：goal.md；requirements.md（同批）；canonical registry eventCatalog 现行 decision 条目；`lib/events-bus.js` 现行实现（monitor feed observe + 内部非 monitor 优先级监听机制）；M8 migration ledger 第 30 行与 8.3(a)；M10 工作纲领 §3.1 / §4.1 / §8。

## Status

Stage 2 与 Stage 1 同批交付（2026-09-12）。本文确定机制选型（领域化 decision/transform registry 为核心、统一参与机制仅作承载）、公共面与 path、逐点位归属与通道判定、与既有等价面的分工矩阵、失败 containment 与排序语义、client 半面判定与 standards 逐分册适用性结论。

## Overview

公共 events bus 现状（已证实，`lib/events-bus.js`）：`observe` 经固定 `monitor` 优先级 feed 派发，`deliver` 只 containment 异常、丢弃返回值；而**同一 substrate 的内部订阅机制已完整支持非 monitor 优先级条目**（`lowest…highest` + 注册顺序、waterfall `next` 续延所有权、await 语义、按 catalog fault 策略的 containment/propagate）。缺口不是机制而是**公共面**：M8 减法删除了侧向决策登记后，第三方没有任何入口创建非 monitor 参与条目。

因此设计取「**领域 registry 为公共面、统一机制为承载**」：

1. **统一参与承载（内部机制）**：在 events bus substrate 上开放一条受控的参与条目安装路径（非 monitor 优先级 waterfall 监听 + 返回值保真 + 按 catalog `listenerFailureDefault` 的 containment 包装）。该机制不单独成为公共入口。
2. **领域化公共 registry（公共面）**：每个有领域归属的决策点族在领域命名空间提供 typed `register`（policy idiom），决策词汇按点位固化；没有领域归属的 catalog decision 点位由 `events.decisions` 一个 typed 准入 registry 承载（枚举准入集，拒绝一切非 catalog decision 名）。不恢复无语义约束的万能 `ctx.on`。

## Current-State Findings

- `events.observe`（`lib/events-bus.js:396–486`）：monitor feed、返回值丢弃、rejection containment——最小运行复现证实 `observe('agent/pre-step').subscribe(() => ({kind:'reject'}))` 不改变决策。
- 内部订阅（同文件 `subscribe` / `reconcile` / `createWrappedListener` / `runWaterfallListener`，行 125–322、338–383）：优先级 vocabulary + 注册顺序、waterfall `next` 守卫续延（`guardedNext` + `continueIfNeeded`）、await 保留、`fault: 'propagate' | 'contain' | 'created'` 策略、scope 门控（`scopeKey` 解析）。参与承载可直接复用该机制，不需新派发内核。
- catalog 现状（registry eventCatalog）：decision 语义条目均带 `decisionPrecedence`（declared priority then successful registration order）、`conflictConvergence`（last decision wins along the waterfall）、`listenerFailureDefault`（contain + documented default decision）。`agent/turn-stopping` 登记为 `fact`/`serial`。
- 既有等价面：`tools.guard.register` / `tools.restrict.register`（policy，ordered）、`security.redaction.register`（policy，ordered）、`llm.requestTransforms.register`（policy，at-most-once）、`llm.admissionPolicies.register`、`llm.routing.policies` / `candidates` / `health.*`、`prompts.contribute`（contribution，追加型，kind：section/context/variable/tools/suppressRuntimeContext）。
- 汇编改写缺口：M8 ledger 8.3(a) 登记 anchor 的整体 sections 替换 + tools 过滤超出追加语义，保留官方 Cordis 钩子 + 提案；本 feature 以 assembly policy 面兑现该提案方向。
- 两条 replacement 点位：`compaction/request` 与 `session-title/candidate` 的 producer 由已交付 replacement（compaction-events / session-title 包）承载，决策词汇已在其 event-contract 中固化（reject/replace-range；exclude/replace），但**没有公共登记入口**。

## 公共面与 path 决定

| 决策点（catalog） | 公共 path（候选，集成波同步 registry） | idiom | 引出机制 |
|---|---|---|---|
| `agent/pre-step`、`agent/request`、`agent/request-error` | `pluginApi.agents.decisions.register({ point, id, priority, scope?, decide })` | policy（decide 收 `next`，见下「idiom 归类」） | 官方 waterfall 直绑：participation 条目经 bus substrate 安装为非 monitor 官方 ctx 钩子 |
| `agent/turn-stopping` | `pluginApi.agents.decisions.register({ point: 'turn-stopping', id, priority, scope?, decide })` | policy（R 切片承载，2026-09-12 人类裁决） | agent-loop 替代行在派发点路由进门面参与链（见下「R slice 设计」）；官方 serial fact 派发保持原样 |
| `system-prompt/assemble` | `pluginApi.prompts.assemblyPolicies.register({ id, priority, scope?, decide })` | policy | 同上（scope-filtered 官方 dispatch） |
| `tools/execute`、`tools/post-execute` | `pluginApi.tools.executionPolicies.register({ point: 'execute'\|'post-execute', id, priority, scope?, decide })` | policy + 显式 around 例外（execute 点） | 同上 |
| `fs/write-intent`、`fs/edit-intent`、`compaction/request`、`session-title/candidate` | `pluginApi.events.decisions.register(name, spec)` | policy | 同上；准入集枚举 + catalog 校验 |

path 理由：

- `agents.decisions`：四个 agent 决策点同族（同一 producer 主体、同一 scope 语义、同族收敛规则），一个 `point` 判别入口比四个平行 namespace 更符合「领域 registry」且避免 `agents.preStep` / `agents.request` 之类动词条目；`turn-stopping` 点位的 backing 是 R 切片（见「R slice 设计」），公共登记面与其余三点位同形。`tools.executionPolicies` / `prompts.assemblyPolicies` 同理（复数资源 + `register`，符合 `public-api-shape.md` §3.5）。
- `events.decisions`：fs 意图、compaction、session-title 没有一等领域 namespace；为其各造顶层命名空间会违反「挂最近既有领域」并制造单成员 namespace。events 是这些点位的 catalog 归属域；准入集枚举 + 逐点位 typed 决策词汇保证它不是万能 on。`approval/request`、`session-telemetry/record`、`tools/code-dispatch-log` 不进初始准入集（无实证消费者；需求 1.7 的 typed unsupported 显式拒绝，后续按增量准入）。
- 不采用的替代：把全部点位统一塞进 `events.decisions`（会丢掉领域词汇与 tools/prompts 既有 owner 的连续性）；或为 fs 意图新建 `fs` 顶层域（单 feature 单点位，过度设计）。

## 逐点位保真表（输入 / 可改范围 / 决定 / next / await / 取消 / scope / 失败默认 / 排序 / 通道）

| 点位 | 输入（catalog payloadShape） | 可改范围 | 决定词汇 | next/续延所有权 | await | 取消 | scope | 失败默认 | 排序 | 通道判定 |
|---|---|---|---|---|---|---|---|---|---|---|
| `agent/pre-step` | `{agent, messages, turn, step, signal}`，freeze `deep:['messages']` | 决策对象 + 返回的 messages | `{kind:'enter', messages}`（官方消费必带 messages，循环解引用 `decision.messages`）\| `{kind:'reject', reason?}` | 策略可 `await next()` 取链末决策再改写；返回 typed 决定而不调 `next` 则该决策预占（veto） | 保留（dispatch 待策略 promise 结算） | `signal` 贯通；abort 后按默认决策收口 | scope-filtered（agent） | contain + 沿用当前链决策 | priority + 注册顺序；last-decision-wins | A 类稳定化；无 R |
| `agent/request` | `{agent, turn, step, signal}` | 决策对象 | 官方 producer 消费语义（官方消费 config 对象；词汇含无决定表达形式，Stage 4 probe 固化到 registry，不预置） | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 | A 类稳定化；无 R |
| `agent/request-error` | `{agent, turn, step, provider, failure, retryPolicy, signal}`，freeze `deep:['failure']` | 决策对象 | 官方 producer 消费语义（retry vs 放弃等以官方消费为准；词汇含无决定表达形式，Stage 4 probe 固化，不预置）；route/health 决策归 `llm.routing.*` | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 | A 类稳定化；无 R |
| `agent/turn-stopping` | `{agent, turn, signal}`（agent 由官方 fused dispatcher 注入），freeze `deep:[]` | 决策对象 | proceed（无决定/\`{kind:'proceed'}\`）\| \`{kind:'continue', message}\`（经官方 next-step inbox 通道续延） | 官方 serial fact 派发原样保留；切片在派发结算后、循环停止复查前调用参与链并应用决定 | 循环 await 官方派发；参与链结算先于停止复查 | 载荷 `signal` 贯通；派发后官方 `throwIfAborted` 照常 | scope-filtered（agent） | contain + proceed（停止照官方判定）；畸形决定按未决定处理 | priority + 注册顺序；链上 last-decision-wins | **R 类**（2026-09-12 人类裁决，agent-loop owner 切片；见「R slice 设计」） |
| `system-prompt/assemble` | assembly `{sections, contexts, tools, variables}` + `{scope?, signal?}` | 整体 sections 替换 / 删除、tools 筛选、contexts/variables 值 | 返回改写后 assembly（waterfall 收敛） | 同 waterfall 续延 | 保留 | context signal | scope-filtered | contain + assembly 原样继续 | 同上；`prompts.contribute` 追加先合成，策略见合并后 assembly | A 类稳定化；无 R（追加语义已在 prompts 域） |
| `tools/pre-execute` | `exec` | —（既有面承载） | `tools.guard`：`{allow}` \| `{deny, reason}` \| `{ask, reason?}` | — | guard 既有语义 | exec.signal | scope-filtered | guard 既有 | guard 既有 | **既有面**：`tools.guard.register` 等价承载；需求 7.5 只做 algebra 覆盖核对，不建第二入口 |
| `tools/execute` | `exec`（call identity 不可变，仅 `exec.signal` 可原位替换） | around 包裹（先于 `next()` 的异步捕获、结果包裹）；不改 call identity | 返回 `next()` 结果或包裹值 | 策略持有 `next`；不调用则执行不发生 | 保留；副作用不先于捕获完成 | exec.signal（可原位替换） | scope-filtered | contain + 直接 `next()` 放行 | priority + 注册顺序 | A 类稳定化；around 作为 policy idiom 的显式例外登记 |
| `tools/post-execute` | `{exec, result}`（result 只读） | 决策对象（accept + content/value 改写、block + feedback） | `{kind:'accept', content?\|value?}` \| `{kind:'block', feedback}` | waterfall（无执行续延） | 保留 | exec.signal | scope-filtered | contain + accept 现结果 | 同上；内容脱敏归 `security.redaction` | A 类稳定化；无 R |
| `llm/stream` | GenerateOptions；`next(): AsyncIterable<StreamChunk>` | —（既有面承载） | — | decoration 链 | decoration 既有 | decoration 既有 | binding match | — | decoration 链序 | **既有面**：`llm.adapters` decoration（binding 匹配的 request/chunk 变换）+ `llm.requestTransforms`；不开放裸 `llm/stream` 参与条目 |
| `fs/write-intent` / `fs/edit-intent` | `{target:{targetKey, displayPath}, exec}`，freeze `all` | 决策对象（放行 / 拒绝） | proceed（无决定/undefined）\| deny（携带 reason） | 屏障式：异步捕获完成后才 `next()` 放行 | **副作用前完成**（写入等全部策略结算） | exec/signal 贯通 | facade | contain + 放行 | priority + 注册顺序 | A 类稳定化（producer 为 filesystem authority）；无 R |
| `compaction/request` | `{agent, session, trigger, range, sourceCommandId?}` | 决策对象 | proceed（无决定，以 undefined 表达）\| `{kind:'reject', reason?}` \| `{kind:'replace-range', range}` | waterfall | 保留 | 载荷 signal | facade | contain + proceed | 同上 | A 类稳定化（producer 为已交付 compaction replacement）；触发操作归 compaction-operation 线，本线只承载参与 |
| `session-title/candidate` | `{agent, session, message:{seq,text,source}}` | 决策对象 | proceed（无决定，以 undefined 表达）\| exclude(reason?) \| replace(`{seq}`) | waterfall | 保留 | —（catalog 无 signal） | facade | contain + proceed | 同上 | A 类稳定化（producer 为已交付 session-title replacement）；title provider authority 不变 |

## 机制设计

### 统一参与承载（内部，不设公共万能入口）

- **安装**：`registerParticipation(name, entry)`（bus substrate 内部）：校验 catalog 条目 `eventSemantics === 'decision'` 且 `dispatch === 'waterfall'`；创建与现行内部订阅同构的条目（priority、scope、order），经 `reconcile` 安装为官方 ctx 钩子。官方 dispatch 模式与 payload 冻结策略（`freezeByPolicy`）原样保留——**不新增派发内核，不改变 deepFreeze 语义**。
- **串行 R 切片变体（仅 turn-stopping）**：该点位不走 ctx 监听安装（串行派发的返回值契约不属于公共面，且官方 fact 派发必须逐位保留）；替代行经契约符号探测调用门面 `agents.decisions` 的参与链，priority/冻结/containment/收敛仍在门面 registry（见「R slice 设计」）。
- **返回值保真（值感知续延包装）**：策略 `decide(context)` 的 `context` 含 `{ ...payload, next, signal }`；策略同步返回决策或返回 promise（await 保留，waterfall dispatch 等待结算）。参与包装的成功路径是**值感知**的，不是官方 listener 续延语义的原样复用：返回 `undefined`（无决定，proceed 类词汇）→ 经 `next()` 续链（链以其输入继续）；返回 typed 决定值 → 该值成为链结果（预占，`next` 不被调用——对齐官方 cordis「不调 next 即 veto 整链」语义，保证 reject/deny 不被下游覆盖）；畸形返回 → 按未决定处理（续链 + 有界诊断）。失败路径沿用 containment：throw/rejection/迟到 promise → contain + 续链（点位默认决定生效），`continueIfNeeded` 仅用于失败/monitor 路径。据此，现行 `runWaterfallListener` 的条目安装、优先级排序、scope 门控与冻结机制照常复用；其成功路径的「直接返回返回值」语义仅为非参与条目保留，参与条目一律走上述值感知包装（否则返回 undefined 的 proceed 型策略会以 undefined veto 整链、破坏 producer）。
- **containment 包装**：参与条目不使用 `fault: 'propagate'` 原样透传第三方异常；每个策略 slot 的 throw/rejection 被 containment（对齐 catalog `listenerFailureDefault`），该 slot 以「未决定」参与收敛，producer 按点位默认决定继续。理由：官方 propagate 语义保护的是官方 listener 契约；第三方策略的缺陷 containment 是 `composition-and-authority.md` §10 的门面义务。官方自身的 listener（若有）不经此包装。
- **排序**：`sortEntries`（priority index + order）原样；`monitor` 不接受为参与优先级（保留给 observe feed）。
- **scope 门控**：catalog `scopeFiltered` 条目按 `scopeKey` 解析主题；绑定 scope 的条目不匹配即跳过（waterfall 下静默续延 `next()`）。

### 领域 registry 记录

- 每个 registry 维护 owner/id/generation 记录（policy idiom handle：`{ id, ownerId, generation, dispose() }`）；owner 由 caller fiber 派生（现行 `resolveOwnerId` 机制）；同 owner 同 id 按 policy idiom 外层合同 **latest-wins**（新条目替换仍在生效的旧条目并返回新 generation handle，旧 handle 成为 typed stale no-op），跨 owner 同 id typed `owner-conflict` error（`api-idioms.md` §3.2 外层合同：注册错误以 typed error 表达、不返回 ok:false，不登记例外）；dispose 幂等、stale no-op、只撤自身。
- `events.decisions` 的准入集为显式枚举（初始四点位），新增点位 = 显式增量（catalog 校验 + 领域归属核对），不自动吸收 catalog 新 decision 条目。
- capability / availability：各 registry 提供 `availability()`；backing（官方 dispatch 或 replacement producer）不可用时 typed `unavailable`，不影响无关能力。

## idiom 归类与例外登记

- 纯 decision 点位（pre-step reject/enter、compaction、title、fs deny、post-execute）→ `policy` idiom（`api-idioms.md` §3.2）：`register(spec)`、priority 词表、handle 同构、注册自动生效。
- 串行 transform（assembly 改写、消息改写）→ policy idiom 的 waterfall 收敛变体（catalog 已声明 last-decision-wins）；不伪装为 projection。
- **around / 异步屏障**（`tools/execute` around、fs 意图屏障）→ `policy` baseContract 的**显式 idiom 例外**：允许 await 副作用前置工作与 `next` 续延所有权；registry 逐成员登记六项例外（`memberPath`、`baseContract: 'policy'`、`exception: 'around-execution' | 'async-barrier'`、`reason`、`replacementShape`、`verification`）。不伪装为 projection，也不为此新造第九 idiom。
- 「策略必须纯」不删除功能：屏障/around 的副作用前置工作被显式 idiom 例外合法化；纯 decision 点位的 decide 仍不得夹带 mutation（api-shape policy 面约束不变）。

## 与既有等价面的分工矩阵（迁移 / 补不足）

| 消费者行为 | 承载面 | 处置 |
|---|---|---|
| agent-teams pre-step 激活（await next、保留 reject、追加 activation message） | `agents.decisions('pre-step')` | **本线新增承载**（无既有等价面） |
| model-failover 请求/错误参与（重试、熔断、probe、failover 候选） | route/health 决策 → `llm.routing.policies` / `llm.routing.health.circuitPolicy` / `probe.register`（既有）；agent 层 request/request-error 决策 → `agents.decisions('request'\|'request-error')`（本线） | **分工**：route 域决策不进 agents.decisions；迁移证据在 Stage 4 逐行为对账 |
| secret-redactor 工具结果改写 | `security.redaction.register`（既有） | **迁移**到既有面；post-execute 仅补 block-with-feedback 缺口 |
| file-claim 执行前拒绝 | `tools.guard.register`（既有） | **迁移**到既有面；本线只核对 allow/deny/ask algebra 覆盖 |
| anchor 整体 sections 替换 + tools 过滤 | `prompts.assemblyPolicies.register`（本线） | **兑现 M8 8.3(a) 提案方向**；追加型贡献继续走 `prompts.contribute`（不迁移、不废弃） |
| turn-rewind / checkpoint-rewind 执行前捕获 | `events.decisions('fs/write-intent'\|'fs/edit-intent')` + `tools.executionPolicies('execute')`（本线）；快照执行归 checkpoint owner | **本线新增承载**（参与机制与顺序保证） |
| cost-meter 流用量观察 | `events.observe('llm/stream')` 或 decoration（既有） | 无需参与面 |
| request 改写（at-most-once） | `llm.requestTransforms.register`（既有） | 不变；`admissionPolicies` / `routing` 职责不被本线触碰 |
| tool 可用性筛选（非汇编期） | `tools.restrict.register`（既有） | 不变 |

不制造第二个相同决策 owner：每个点位在 registry 中只登记一个受支持参与面（需求 12.3）；`tools.guard`、`security.redaction`、`llm.requestTransforms`、`llm.routing.*`、`prompts.contribute` 全部保留既有 authority。

## 与 scoped-agent-contributions / compaction-operation 的协同边界

- **汇编内容与替换语义**：`prompts.contribute`（含 scoped 线的 target 维度）承载**追加型**汇编内容；`prompts.assemblyPolicies`（本线）承载**整体替换/筛选**决策。组合顺序固定：全局追加贡献 → target-scoped 追加贡献（scoped 线）→ assembly policies（本线，见到合并后 assembly）。本线不建 per-agent 贡献的 target 维度（归 scoped 线），scoped 线不建替换 owner（归本线）——两条 design 交叉引用处以本条为准。
- **快照执行**：fs 意图与 tools execute 屏障只保证「异步捕获先于副作用完成」的参与顺序；捕获/快照的执行、存储与恢复归 checkpoint owner（`checkpoint-restore-contract` 已交付面）。本线不定义快照内容与持久化。
- **compaction**：`compaction/request` 的参与归本线（`events.decisions`）；主动触发的 operation、终态与 provenance 归 compaction-operation 线。策略 registry 不是主动触发器。
- **模型选择快照**：本线不拥有选择状态（归 interactive-session-access）；scoped 线定义消费侧一致性，本线 assembly policy 看到的 variables 为该步快照。

## 横切派发语义与通道判定

- **priority / deepFreeze / fault containment 永不走替换通道**（constitution 与 `capability-strategy.md` §2）：即使 turn-stopping 的派发点位于替代行内，参与链的排序、冻结与 containment 仍在门面 registry（见下「R slice 设计」的边界条款）。
- 逐点位通道判定：`agent/pre-step`、`agent/request`、`agent/request-error`、`system-prompt/assemble`、`tools/*`、`fs/*`、`llm/stream`（消费侧）为 **A 类**（官方已 dispatch，门面稳定化引出参与）；`compaction/request`、`session-title/candidate` 为 **A 类 on top of 已交付 replacement**（producer 已由 compaction-events / session-title 替代行承载，参与登记是门面侧补足，不新增被禁用官方行、不新建 replacement 包）。
- **唯一 R 点位：`agent/turn-stopping`**（人类裁决 2026-09-12）：官方 runtime 在该派发点之后直接依循环内停止复查收口，除 next-step inbox 续延外无决策通道；经人类裁决走 R 类，由既有 agent-loop 组件唯一 owner 的替代行承载参与切片。其余点位维持无 R 判定：没有出现「官方组件缺少必要业务边界」的情形——缺失的只是门面公共面；若 Stage 4 probe 证实某官方决策点的 producer 不经可订阅的 dispatch（结构上不可达），该点位转 C 类 upstream proposal 并上报，不擅自转 R。

## R slice 设计：`agent/turn-stopping` 参与（2026-09-12 人类裁决）

### 裁决与替代单位

- **替代单位 = turn-stopping 派发行**：该派发点位于官方 `dsh-agent-loop` 行的循环驱动内（已核实锚点：官方 `dsh-agent-loop/lib/index.js` 循环内 `await this.dispatch.serial("agent/turn-stopping", { turn, signal })`，其后 `signal.throwIfAborted()` 与停止复查 `if (turnEnds && this.inbox.nextStep.length === 0) break;`）。该行**已被既有 R 装配替代**（官方行 `agent-loop` `disabled: true` + 替代行 `plugin-api-agent-loop`，见 `packages/agent-loop/cordis.patch.yml` 与 capability-strategy §5 装配表）——本切片**不新增被禁用官方行、不新增替代行**，是在既有替代行内新增一个能力切片。
- **owner = 既有组件唯一 owner**：`@deepseek-ai/dsh-plugin-api-agent-loop`（唯一官方组件包 `@deepseek-ai/dsh-agent-loop`）。不为本点位新建第二个 owner，也不在别处复制派发语义。

### R1–R8 逐条对照

| 规则 | 对照 |
|---|---|
| R1 | 只走官方 patch 机制：替代单位是已被替代的官方行 `agent-loop`（`disabled: true` + 替代行 `plugin-api-agent-loop`，既有 patch）；不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 任何官方包文件 |
| R2 | 替代行完整复刻被替代行的 ctx 服务面与事件面契约；turn-stopping 派发点的官方等价基线（serial fact 派发、payload、时序、停止复查）逐位保留后才叠加参与切片（见下「官方契约基线」） |
| R3 | **不覆盖 import 面**：第三方 `import '@deepseek-ai/dsh-agent-loop'`（及其余 `@deepseek-ai/dsh-*`）仍解析官方原包；本切片只作用于该行的 ctx 服务/事件行为，门面参与链经契约符号协作，不改变任何包的模块解析 |
| R4 | boot 自检：apply 既有自检矩阵追加本切片加性检查项（官方行已 disabled、替代行已 active、主门面版本一致、参与链契约符号可达）；失败 = 仅本切片 fail-safe 停用 + 有界诊断，绝不静默双跑 |
| R5 | 版本锁定：复用该包 identity 矩阵（runtime `0.1.0-rc.6` 全量 identity、官方组件包 identity、主包 `A.B.C` 一致）；失配仅停用本切片 |
| R6 | 组件唯一 owner：`@deepseek-ai/dsh-agent-loop` 的 replacement owner 仍为 `@deepseek-ai/dsh-plugin-api-agent-loop`；本切片是该 owner 管理的又一能力，不新建 owner，并复用其组件级冲突/双跑检测 |
| R7 | client 面自建构建：不适用——本切片 host-only（§10 六问全否，见下），无 client 半面需要构建 |
| R8 | 不覆盖 boot 胶水与框架级语义：turn-stopping 的 priority/冻结/containment/收敛全部留在门面 registry；替代行不触碰 Cordis 派发机制与 `dsh-app-boot`（见「参与链与横切语义归属」边界条款） |

### 官方契约基线（R2 完整复刻）

替代行必须完整提供被替代行的 ctx 服务面与事件面契约——turn-stopping 派发点的官方等价基线为：

1. 触发条件：`turnEnds` 已判且 next-step pending inbox 为空（turn 即将停止）。
2. 派发形态：官方 fused serial dispatcher（`agentEvents(loopCtx, agent)`），payload `{ turn, signal }` 融合注入 `agent` → `{ agent, turn, signal }`，冻结策略按 catalog（`deep: []`）。
3. 时序：loop `await` 派发 → 官方 `throwIfAborted()` → 停止复查（next-step pending 非空则继续本 turn）。
4. 事实语义：无参与决定时行为与官方行逐位一致（serial 派发照发、observe 面照常、停止结果照官方判定）。

fork 现行实现（`packages/agent-loop/lib/forked-loop.js`）已逐位复刻上述基线；本切片只**追加**参与链调用与决定应用，不改、不绕过、不双跑官方派发。

### 决定词汇与默认语义（基于已核实派发语义）

- **词汇**：`proceed`（无返回 / `{ kind: 'proceed' }`）| `{ kind: 'continue', message }`。
- **语义依据**：官方循环在派发后复查 next-step pending inbox——这是官方唯一的本 turn 续延通道。`continue` 的应用方式是**经官方 next-step inbox 通道插入 message**（官方 Inbox 持久 splice，`agent/inbox/inserted` 等事实由官方路径照常发出），使循环自身的停止复查观察到 pending 项而继续下一步；切片不绕过、不复刻该复查。
- **默认语义**：无参与者 / 全部未决定 / 收敛为 proceed → 与官方行逐位一致（派发照发、停止照判定）。畸形决定（词汇外或 message 不满足官方 pending 消息契约）按未决定处理 + 有界诊断（家族先例：session-title `malformed` 语义），不抛穿派发。
- **收敛**：参与链上 last-decision-wins（与 catalog 决策族收敛规则一致）；proceed 不覆盖先到的 `continue` 之外的任何东西——链末决定即应用决定。

### 参与链与横切语义归属（「横切语义永不 R」的边界）

- **派发路由机制**：替代行在派发点经**契约符号探测**（与既有切片同模式：`Symbol.for` 键 + 门面侧契约标记）获取门面 `agents.decisions` 的 turn-stopping 参与链；切片以 `{ agent, turn, signal }` 冻结载荷调用链，取得收敛决定后应用。参与条目**不安装为 ctx 监听**（串行派发的返回值契约不属于公共面），官方 serial fact 派发保持原样——observe 面看到的时序与官方完全一致。
- **横切语义归属**：priority 排序（固定词表 + 注册顺序）、载荷冻结（deepFreeze 策略）、participant 故障 containment、收敛规则全部在**门面 registry**实现；替代行只做两件事——把官方派发点路由进参与链、按收敛决定走官方 inbox 通道。替代行不复刻、不覆盖、不修改任何派发横切语义；这就是「横切语义永不 R」在本切片的落点。
- **idiom 归类**：turn-stopping 参与为 policy idiom（`agents.decisions.register` 同形 handle `{ id, ownerId, generation, dispose() }`）；decide 不持有 `next`（无执行续延），与 pre-step 家族的水续延例外不同，不需 around 例外登记。

### fail-safe、boot 自检、版本锁定

- **fail-safe**：门面缺位（主门面未装、契约符号缺失、版本失配）或参与链调用失败 → 替代行回退**官方等价 serial 派发**（默认行为），绝不双跑（参与链与官方派发是同一次派发内的先后步骤，不存在两次事件）、绝不静默（降级写有界诊断）；参与登记面返回 typed `unavailable`。
- **boot 自检（R4）**：沿用该包 apply 既有自检矩阵的**加性切片检查**模式（同 evidence/interaction 切片）：官方行已 disabled、替代行已 active、主门面版本一致、参与链契约符号可达；任一失败 → 仅本切片停用（登记 typed unavailable + 诊断），替代行其余能力与本包其他切片照常，绝不静默双跑。
- **版本锁定（R5）**：复用该包既有 identity 矩阵（runtime 全量 identity `0.1.0-rc.6`、官方组件包 identity、主包 `A.B.C` 一致性）；失配仅停用本切片能力，不影响同包其他切片与主包无关能力（versioning-and-protocols §3 降级规则）。

### 与同包既有切片的行级关系（互不干扰）

同一替代行（`plugin-api-agent-loop`）当前承载：route-policy 能力（U11 上游提案对应）、loop-boundary 交互切片（M9 交付：attempt 事实/admission/cancel 契约，`INTERACTION_ACTIVE_SYMBOL` + activity 投影契约版本交叉核对）、assembled-context 证据切片（context-provenance 交付：`EVIDENCE_ACTIVE_SYMBOL` 标记）。本切片的行级共存关系：

1. **同一替代行、独立契约符号与门控**：turn-stopping 参与切片使用独立的 `Symbol.for` 契约键与 active 标记，不读写其他切片的符号、状态或契约版本。
2. **自检加性**：apply 自检矩阵追加本切片的加性检查项；本切片失败只降级本切片（先例：证据切片失败只降级证据，不整体回退）。
3. **零共享状态机**：参与链状态只存于门面 `agents.decisions` registry；切片内不维护参与者状态（无状态路由 + 决定应用），与 interaction 切片的 attempt 事实、evidence 切片的证据发射互不引用。
4. **事件面不交叉**：本切片不发新事件（决定应用经官方 inbox 通道，事实由官方路径发出）；不改 `agent/inbox/*`、attempt、evidence 任何既有事件语义。

### client 半面（§10 六问，R 切片专项）

1. 被替代的官方行（agent-loop）是否声明 client manifest？——**否**（该替代行现状 host-only，本切片不新增 manifest）。
2. 是否注册 remote namespace？——**否**。3. 是否提供 slot 或 settings bridge？——**否**。4. 是否有 client↔host 版本协商？——**否**（复用既有包级 identity 检查，非 client 协商）。5. 是否有 browser-side state 或 reconnect 语义？——**否**。6. 官方行是否拥有 client-facing event/service？——**否**（turn-stopping 为 host 派发点）。

结论：R 切片 **host-only**（与该替代行既有判定一致；未来任一项转正则触发新的 client 审计）。

### 登记义务清单（Stage 4 动作，本文只陈述）

- canonical registry：eventCatalog `agent/turn-stopping` 行由 `fact` 修订为 decision 参与语义（补 `decisionPrecedence` / `conflictConvergence` / `listenerFailureDefault`）；`agents.decisions` 成员行覆盖 `turn-stopping` 点位；capabilityMatrix 增补本切片条目。
- `docs/standards/capability-strategy.md` §5 装配表注：`plugin-api-agent-loop` 行注明本能力切片。
- `docs/specs/plugin-api-features/feature-list.md` §3.1 报备（同组件同包能力切片先例）与 **U-series 新条目**：agent-loop owner 已有 U11（route-policy seam）与 U19（assembled-context evidence seam）两条目，均不覆盖 turn-stopping 参与——本切片登记为**独立新条目**（不重复占用/扩展 U11/U19），退役条件：官方在 turn-stopping 派发点原生提供等价决策参与 seam（或等价公开 continuation/decision 钩子）后，本 R 切片退役、参与面迁官方 seam、门面 registry 保留。
- AGENTS.md §2/§4 能力边界同步（如裁决后的表述需要）。
- admission rationale：turn 即将停止时的受控续延（auto-continue 类场景）是真实第三方需求；官方无决策参与 seam 且结构上不可达（循环内复查），符合 R 类准入方向。

## 失败路径与 guard 策略

| 失败 | guard |
|---|---|
| 策略 throw / rejection / 迟到 promise | slot containment + 点位默认决定 + 有界诊断；不抛穿 dispatch / apply |
| dispatch abort（signal） | 策略收口为默认决定；迟到结算按提交资格检查丢弃（不补写决策） |
| stale disposer / owner reload | typed no-op；只撤自身 generation 条目 |
| 同 owner 同 id 重复登记 / 跨 owner 冲突 | 同 owner **latest-wins**（新 generation handle，旧 handle stale no-op）；跨 owner typed `owner-conflict` error（policy idiom 外层合同，`api-idioms.md` §3.2：注册错误抛 typed error，不用 ok:false） |
| backing 不可用 / 版本错配 | `unavailable` typed 结果 + capability degraded；不影响无关点位 |
| 恶意/畸形决策对象（不满足点位词汇） | 按未决定处理（对齐 session-title 包既有 `malformed` 语义），不抛穿 |
| turn-stopping 切片：门面缺位 / 契约符号缺失 / 参与链失败 | 替代行回退官方等价 serial 派发（默认行为）；绝不双跑、绝不静默（有界诊断）；参与登记 typed `unavailable`（见「R slice 设计」） |
| 注册风暴 / 无界增长 | 每 owner 每 id 唯一 + dispose 义务；不设配额（cooperative 模型，`composition-and-authority.md` §9） |

## 并发与取消

- 取消是信号：`signal` 贯通到策略 `context`；abort 不等于决策被改写，producer 在收敛点按仍有效信号裁决（`concurrency-and-cancellation.md` §1）。
- 迟到结算（promise 在 dispatch 收口后才 settle）：结果失去提交资格，仅作诊断保留，不改写已收敛决策。
- 参与条目无独立 execution identity、不重试；同一次 dispatch 的多策略调用属同一 waterfall 链。

## client 半面（capability-strategy §10 六问）

1. 被替换官方行是否声明 client manifest？——**否**（本线不替换任何官方行）。
2. 是否注册 remote namespace？——**否**。
3. 是否提供 slot 或 settings bridge？——**否**。
4. 是否有 client↔host 版本协商？——**否**。
5. 是否有 browser-side state 或 reconnect 语义？——**否**（决策回调在 host dispatch 点执行）。
6. 官方行是否拥有 client-facing event/service？——**否**（参与面不经 wire 暴露）。

结论：**host-only**。client 模型/会话交互面（如需观察决策结果投影）归 interactive-session-access 线，本线不发布任何 client 面。

## Standards 逐分册适用性结论

| 分册 | 结论 |
|---|---|
| capability-strategy | **适用**：除 turn-stopping 外全部点位 A 类稳定化；**唯一 R 点位 `agent/turn-stopping`**（人类裁决 2026-09-12，agent-loop owner 既有替代行内的能力切片，R1–R8 对照与登记义务见「R slice 设计」）；横切语义永不 R（边界条款已写明）；host-only 六问已记录（含 R 切片专项）；无新 `services.*` 成员。 |
| api-shape | **适用**：参与面 = policy 语义面（含显式 around/async-barrier idiom 例外）；observe 保持 projection 面无副作用；数据流单向（决策点→策略→producer 消费→事件→投影），策略不写共享状态（屏障例外的副作用前置工作除外，已登记例外）。 |
| api-idioms | **适用**：policy idiom 形状（register/handle/priority/conflict）；around 与异步屏障按 §1 例外机制六项登记；`events.observe` 保持 projection；事件语义登记不变。 |
| public-api-shape | **适用**：`agents.decisions` / `tools.executionPolicies` / `prompts.assemblyPolicies` 挂既有领域；`events.decisions` 为 events 域内 typed 准入面；无顶层新域；path 不泄漏治理名。 |
| composition-and-authority | **适用**：ordered composition mode；owner 派生、冲突、containment、authority closure（每点位单一受支持参与面；guard/redaction/requestTransforms/routing/contribute 既有 authority 保留）。 |
| domain-composition | **适用**：`events` 领域（决策不用裸 waterfall 代替领域 reducer——本线即领域 typed 决策面的兑现）、`tools`、`prompts`、`llm`、`agents` 各行对齐。 |
| ordering | **适用**：固定 priority vocabulary + 注册顺序；无全局 before/after DAG；领域收敛规则（last-decision-wins）按 catalog 声明。 |
| identity-and-lifecycle | **适用**：参与条目 handle generation（owner-specific）；无独立 execution identity（waterfall 链不分立 identity）；无终态词汇需求（决策无终态对象）。 |
| durable-state-and-scope | **不适用**（参与登记无持久记录；无 storage 写入）。 |
| visibility-and-redaction | **部分适用**：策略回调看到的 payload 按 catalog freeze；诊断只记有界摘要（不含消息/工具内容全文）；不改变模型/UI 受众；secret 提升不归本线（`security.redaction` 既有通道）。 |
| concurrency-and-cancellation | **适用**：signal 贯通、迟到结算提交资格、containment、无重试；disposer 所有权（stale no-op、identity 判断清理）。 |
| versioning-and-protocols | **部分适用**：版本冻结基线内交付；无新 wire/durable 协议（host 内机制）；registry 同步走集成波。 |

## 迁移证据义务（Stage 4）

对每个已证实消费者建立「原行为 → 目标公共调用 → 运行证据」映射：agent-teams（pre-step 激活）、turn-rewind / checkpoint-rewind（fs 意图与 tools execute 屏障，含异步快照先于副作用）、model-failover（request/request-error 与 routing/health 分工）、secret-redactor（redaction 迁移）、anchor（assembly 整体替换 + tools 筛选）。官方 `agent/request` / `agent/request-error` 的决策词汇以 Stage 4 契约 probe 对照官方 producer 源码后固化，probe 结论与偏差按 spec 修订流程同步本文档。

turn-stopping R 切片另需（R 类证据等级）：官方契约基线逐位对照证据（fork 派发 vs 官方行：payload/时序/停止复查）、双跑检测、门面缺位 fallback 行为、boot 自检矩阵（含与 interaction/evidence/route-policy 切片的加性独立降级）、`continue` 决定经官方 inbox 通道真实续延本 turn 的运行证据，以及「无参与者默认官方等价行为」的等价性断言。
