# Stage 3 - Tasks

> feature_name: `scoped-agent-contributions`
> milestone: M10
> status: Stage 4 已交付（2026-09-13）。Stage 3 对抗性审查：第一轮「有意见」七条（两条阻塞：销毁清理责任与 Req 6.1 冲突、`snapshotOf` 无 tasks/design 依据；五条非阻塞）全部就地闭合后复审「无偏差」。Stage 4 全局终审三轮：第一轮 8 条非阻塞、第二轮 2 条非阻塞，全部集中修订后第三轮「无偏差」。全量 3192/3192 绿；registry validator `registry valid`；client bundle `--check` 一致；`git diff --check` 干净。
> 输入溯源：goal.md；requirements.md（Reqs 1–12，含 Stage 4 修订的 Req 6.1/6.6）；design.md（probe-first 方案、分工矩阵、生命周期表、组合边界，含 Stage 4 回写的 probe 结论）；Stage 3 源码级探针记录见下。
> 门序事实（如实记录）：本清单首次提交（`f58875d`）时状态行为「待对抗性审查」，而 Task 1/2 的实现提交（`391fbc8`、`75663bb`）先于审查记录落盘，属门序未留痕；2026-09-13 承接者补做 Stage 3 阻塞式对抗性审查并按其意见修订本清单、Goal/Requirements/Design 与实现，审查门以本轮结论为准。

## Stage 3 探针记录（源码级事实，Stage 4 以行为测试复核）

- **S1 官方服务是宿主单例**：`tools`（`dsh-tools` ToolRuntime）与 `systemPrompt`（`dsh-system-prompt` SystemPrompt）都是宿主级 cordis Service；per-agent 性完全来自 (a) `ScopedLayers` 按 `scopeOf(ctx)`（agent 对象）分层、(b) cordis caller-shadow 绑定（`agent.ctx.systemPrompt.section(...)` 的 `this.ctx` 被换成 agent ctx shadow，注册落 agent scoped 层）。官方错误文案即权威指引："for a per-agent override, register through that agent's `agent.ctx` instead"。
- **S2 P1（fiber 内 caller-bound 安装）被否定**：cordis 的 `get`/属性解析按访问 ctx 对象/shadow 沿 fiber 链找最近 provide，**不按 AsyncLocalStorage**（ALS 只承载 initiator 归因）；在目标 agent 执行 fiber 内经门面调用，访问 ctx 仍是插件的 shadow（无 agent scope 标签）→ 落全局层。P1 不是有效的 per-agent 安装路径（Stage 4 以泄漏断言固化该结论）。
- **S3 P2（显式 target 通道）成立**：`agents.get(sessionId).ctx` 可达（官方 AgentRegistry `get` 返回 Agent 本体，`.ctx` = `createScope(loopCtx, agent)` 独立 fiber + `extend({agent})`）；经目标 ctx 调用官方 systemPrompt/tools 方法即落 agent scoped 层，官方 disposer 由 agent scope fiber 所有权兜底（agent 销毁自动撤销）。按 design 判定规则：**P2 通过 → register 时捕获目标服务解析闭包（lazy 重解析），register 是唯一新增解析点**；与 design 预案一致，无需升级人类裁决。
- **S4 身份与恢复**：agent 身份 = SessionId（branded string，运行时即 string）；同进程 resume（`resumeWith` 以 `resumeSessionId` 重注册）**同 id、新 Agent 对象**（ScopedLayers 按 agent 对象键 → 旧实例 scoped 注册随旧 fiber 消亡）。resume 检测点：官方 `agent/created`（announce 时发，payload `{agent}`）+ `agent/disposed`（detach teardown 发，payload `{agent}`）。
- **S5 销毁 vs resume-drain 张力（Stage 4 已裁决）**：`agent/disposed` 在 resume 换实例与最终销毁时都会发。Stage 4 追加 probe（2026-09-13）：官方同进程恢复路径 `dsh-agent-loop.resumeWith` → `restoreOrCreateConfigured` 在恢复前先 `waitForDrainingConfiguredIdentity`，等待 `agents.get(id) === undefined` **且** `sessions.get(id) === undefined`（即 `agent/disposed` 与 `session/disposed` 均已发出）才重新 announce；官方 session 事实集里没有可区分「恢复排水」与「最终销毁」的信号。**结论：销毁与恢复排水在事实层不可区分** → 采纳 tasks 预案的回退：`agent/disposed` → 官方层注册自然消亡（fiber 所有权）+ 门面记录转 dormant（不再参与任何汇编）+ 同 id `agent/created` 重装 + handle dispose/owner 卸载才物理清除；并已按 spec 修订流程同步 requirements Req 6.1/6.6 与 design 生命周期表（purge 的可观察语义 = 死目标零汇编效果；dormant 记录仅为簿记）。
- **S6 汇编 payload 携带 agent 身份**：`system-prompt/assemble` 第二参 `context = assembleContextFor(agent, signal) = { agent, scope: agent, signal? }`；W2（宿主层 wrapper 按 id 过滤）技术上可行但被否——官方 section 对 undefined 返回的语义不确定、且偏离官方 per-agent 设计。统一采用 **W1（经目标 ctx 的官方 scoped 层）**。
- **S7 门面现状**：`createContributeEntry`（plugin-api-service.js:987–1052）per-owner Map + 同 owner 同 id conflict + 幂等 dispose + backing disabled typed unavailable，无 callerCtx.effect 绑定（owner 卸载不自动清理——scoped 变体补齐 effect 绑定以满足 Req 6.2）；tools getter caller-bound 解析 `this.ctx.get('tools')`，`tools.register(definition)` 单参、官方 restrict **强制 scoped ctx**（host ctx 调用直接抛错）；`agents.get/list/roots` 查询面已存在（直转官方 registry）；events bus 已支持 scope 门控且 `agent/disposed`、`agent/created` 已在门面 catalog（agent-events-catalog.js）。
- **S8 快照蓝本**：官方 `installModelSelection(agentCtx, selection)` —— `system-prompt/assemble` 捕获 `selection.current` 注入 `variables.provider/model`、`agent/request` 消费 `selection.assembled` 做 route（同一步一致快照的官方机制）。
- **S9 订阅传播（Stage 4 追加）**：`agent/created` / `agent/disposed` 在门面 catalog 中均为 `scopeFiltered: true`（`scopeKey: args[0].agent`），官方以 agent scope carrier 派发；宿主根上下文的 `ctx.on` 订阅经 Cordis 向上传播接收（官方同型依据：`dsh-agent-loop` 的 `waitForDrainingConfiguredIdentity`、`dsh-session-title` 的 `ctx.on('session/disposed', ...)` 均在 owner/root 上下文订阅这类事实）。实现经 `ctx.on` 直接订阅官方事实（不依赖 `pluginApi.events` feature 激活、不新建事件事实、不伪造 producer）。
- **S10 全局 contribute 的 owner 归因（既有语义）**：全局 `prompts.contribute` 的 owner 由 caller fiber 派生，**显式 `spec.ownerId` 优先**（M8 Wave 5 审查修复 `935d2f4` 明确保留 "spec.ownerId stays explicit"，commit message 原话）；scoped 路径沿用同一入口的同一规则，形状不分裂。

## Task 1: scoped registry 核心模块（对应 Req 1、6、10）

**产出**：`lib/scoped-agent-contributions.js`（纯函数模块，零 harness 依赖可测）+ 单元测试 `test/scoped-agent-contributions.test.mjs`。

- [x] 1.1 目标解析（Req 1.1–1.2）：`resolveTargetReference(agentsRef, agent)` —— 接受 string SessionId / `{ id }` / 带 `.id` 的 agent 引用；经官方 agents 面（`agents.get(id)`）解析；不可解析/已销毁/backing 不可用 → typed `unavailable`，不回退全局。
- [x] 1.2 scope handle（Req 1.1、1.3、1.5）：冻结 `{ id, ownerId, generation, target, status(), dispose() }`——`target` 为冻结身份快照 `{ id, resolvedAt }`；`status()` 读官方 liveness（`agents.get(id)` 存在性）：存活报 usable、目标已销毁**恒报 destroyed**（Req 1.3；dormant 只是门面记录簿记状态，绝不作为 status 可观察值掩盖 destroyed）；`dispose()` identity-bound、幂等、stale no-op（不撤他 owner/他目标）；不挂 contribute 方法（design 边界）。
- [x] 1.3 scoped 记录存储（Req 6.3、6.4）：按 `(owner, target, contributionKey)` 键控的记录表 `{ kind, contributionId, installClosure, generation }`；同 (owner, target, key) 互斥（conflict）；旧 generation 的 stale handle/disposer typed no-op 不撤新 generation。
- [x] 1.4 lazy 目标 ctx 解析与安装（S3）：install closure 以 `agents.get(targetId)?.ctx` 为解析点（每次安装/重装时重解析，resume 后自然落新实例 scoped 层）；解析失败（目标不在）→ typed unavailable/destroyed，不安装孤儿状态（Req 6.5）。
- [x] 1.5 生命周期钩子（Req 6.1、5.2、10.2；S4/S5/S9）：门面以 untagged `ctx.on` 订阅官方 `agent/created`（同 id 有 dormant/active 记录且 owner 仍 active → 重装到新实例 ctx）与 `agent/disposed`（官方层注册随旧 fiber 自然消亡；门面记录转 dormant 即 eviction，物理清除按 Req 6.6），不新增事件事实、不伪造 producer。**内部监听器必须自含故障**：重装失败降级为 typed 结果/有界日志、绝不向官方派发抛穿（官方 `agent/created` 的同步 throw 会否决 agent 发布，门面监听不得成为该否决源——G1 fail-safe 模式）。
- [x] 1.6 owner 卸载清理（Req 6.2）：安装经 `callerCtx.effect` 绑定 identity-bound 撤除（该 owner 跨目标全部 scoped 贡献）；他 owner 存活；effect 不可用 → typed unavailable（不静默）。
- [x] 1.7 测试：handle 形状与冻结 / 目标不可解析 typed unavailable / status 两态（usable/destroyed）/ dispose 幂等与 stale no-op / (owner, target, key) conflict / 旧 generation no-op / lazy 重解析（模拟同 id 新实例重装）/ dormant 语义（含 `inspection().dormant` 诚实计数）/ owner 卸载 effect 清理。
- [x] 1.8 **handle 的 owner 绑定（Req 6.6，Stage 4 新增）**：`agents.scopes.register` 的 handle record 绑定 `callerCtx.effect`——owner 卸载（含插件漏 dispose handle）即释放该 handle 名下贡献记录与快照 cell，把门面簿记上界收敛到「owner 仍存活且仍持有的 live scope handle」；effect 通道不可用时降级为 dispose 驱动生命周期，不因缺失 effect 拒绝 register。测试：owner teardown 后 `inspection()` 的 records/scopes/snapshotCells 归零、handle 变 stale。

## Task 2: `agents.scopes` 门面接入（对应 Req 1、9.3、10、11）

**产出**：`lib/index.js` / `lib/plugin-api-service.js` / `lib/scoped-agent-facade.js` 接线 + surface 测试。

- [x] 2.1 `agents.scopes.register` 挂既有 agents 域（`agents` surface 增 `scopes` 子对象；无顶层新域）；typed 错误族沿用 `PluginApiFeatureDisabledError`/`PluginApiInactiveError` 基线（Req 10.1–10.3）；不夺 agents 域既有 owner 权。
- [x] 2.2 capability 自描述：`lib/capability-descriptors.js` 增 `agents.scopes` 行（effect register，features `['agents']`——backing 即官方 agents registry；不虚挂无关 feature）；`agents.scopes` 不可用不影响 `agents.create/get` 等既有成员（Req 10.1 局部降级断言）。
- [x] 2.3 host-only 判定落登记（Req 11）：feature-list §7 条目载入六问全否记录。
- [x] 2.4 测试：surface 形状 / 降级隔离 / inactive typed 错误。**Stage 4 落点**：`test/scoped-agent-contributions-e2e.test.mjs` 的「without the lifecycle substrate the feature degrades alone with typed errors」用例——缺 `ctx.on` 时 `agents.scopes.register` 抛 `PluginApiFeatureDisabledError('agents.scopes')`、`capabilities.get('agents.scopes')` 报 `degraded`、`capabilities.get('agents')` 仍 `active`、`agents.list()` 不受影响、全局 `prompts.contribute` 仍可用（Req 10.1/10.2/10.3）。
- [x] 2.6 **未挂载时的诚实降级面与 capability 输入（Stage 4 新增，审查意见 1）**：scoped feature 未挂载时 `agents.scopes` 成员**仍然存在**并抛 typed disabled/inactive 错误（不用「成员缺席 → TypeError」表达降级）；`capability-descriptors.js` 的 `agents.scopes` 行 availability 输入修正为真实 feature key `['agent', 'scopedAgentContributions']`（此前误用不存在的 `'agents'`，导致该 capability 恒为 `unavailable`），使 capability 反映真实 backing 而非对象存在性。
- [x] 2.5 **消费侧只读成员的 tasks 与 design 依据（Stage 4 新增）**：`agents.scopes.snapshotOf(scopeHandle)`（projection idiom，见 design「消费侧只读成员」）为解决 Req 9.3「scoped variable 贡献读 per-step 快照」所必需的公共读取契约——补齐其 design 条目、registry 行与 capability 登记依据；**不新增第二个快照状态机、不暴露写入面**（写入归 interactive-session-access，本线非公共 seam 不进登记）。

## Task 3: `prompts.contribute` 的 scope 维度（对应 Req 2、7）

**产出**：`lib/plugin-api-service.js` `createContributeEntry` 扩展 + 测试。

- [x] 3.1 `spec.scope` 判别（Req 2.1、2.5）：scope 为 scope handle（opaque token，经 handle 内部 token 校验归属当前 registry，防伪造）→ 按 kind 走 S3 通道（经目标 ctx 调官方 systemPrompt 成员注册进 agent scoped 层）；畸形/不支持 kind → 既有 typed failure shapes；scope-bearing 失败**不回退全局**。
- [x] 3.2 conflict 键位扩展（design 分工矩阵）：同 owner 同 id **同目标** → 既有 conflict；同 owner 同 id 异目标 → 各自独立；跨 owner 同目标同 id → 各自归属共存（Req 4.2）。**键位 = `(owner, target, id)`**：prompts 面一个 owner 的 id 命名空间不按 kind 拆分（与全局 `prompts.contribute` 同构，kind 不进键位）；tools 面按键位 `(owner, scope, key)` 保持 register/restrict 各自按键空间（design「Stage 4 probe 结论」第 4 条）。
- [x] 3.3 handle 与生命周期：contribution handle 仍为 `{ id, ownerId, seq, dispose() }`（idiom 不变）；dispose 走 identity-bound（owner+target+id）撤官方 scoped 注册；callerCtx.effect 绑定 owner 卸载（Task 1.6 机制）。
- [x] 3.4 组合边界（Req 7.1、7.2、7.4）：scoped 贡献恒为追加型；不提供整体替换/删除语义；汇编顺序 = 全局追加 → 目标 scoped 追加 → assembly replacement policies（decision 线）——以官方 ScopedLayers 合并语义（全局层 + scope 层链）天然承载，测试断言该顺序。
- [x] 3.5 测试：scoped section/context/variable/tools kind 各一正例（目标汇编含、他者不含——Req 2.2/2.4）/ suppressRuntimeContext scoped / 失败不回退 / conflict 键位矩阵 / 追加型边界（无替换语义可触发）/ 全局投影（无 target 的 host 级渲染）不含 scoped 贡献（Req 2.3 排除断言）/ 底层注册抛错转 typed result 不抛穿 caller（Req 10.2）。
- [x] 3.6 **owner 归因平权（Stage 4 新增，S10）**：scope-bearing spec 沿用全局入口同一规则——显式 `spec.ownerId` 优先，否则 caller fiber 派生；在 tasks/design 明确该平权（形状不分裂），并把「owner 可由调用方显式指定」的跨线 authority 议题登记给 convergence 线（本线不单方面收紧已交付的全局行为）。
- [x] 3.7 **Req 5.3/5.5 断言（Stage 4 新增，审查意见 4）**：provider 型贡献每次目标汇编重新求值（不缓存陈旧值）、跨 step 持久；非目标汇编绝不调用 provider。

## Task 4: `tools.register` / `tools.restrict.register` 的 scope 维度（对应 Req 3）

**产出**：`lib/plugin-api-service.js` `createToolsApi` 扩展 + 测试。

- [x] 4.1 `tools.register(definition, { scope })`（Req 3.1、3.2）：外层 resourceRegistry 合同不变；scope 存在时经目标 ctx 调官方 register（S3 通道）→ 落 agent scoped 层，仅目标可见/可调用（汇编 wireSchemas 与执行 resolveExecution 双侧按官方 per-agent 解析）；他 agent 不可见。
- [x] 4.2 `tools.restrict.register(policy, { scope })`（Req 3.3）：官方 restrict 强制 scoped ctx（host ctx 调用抛错是官方既有语义）——scope 通道经目标 ctx 调用正是使 restrict 可用的路径；无 scope 的既有行为不变（含官方 scoped-ctx 强制错误语义本身，不做「全局 restrict」放宽）。
- [x] 4.3 冲突与隔离（Req 3.4、3.5）：键位 (owner, scope, key)；同 owner 同 key 同 scope 走既有 conflict 规则；异 scope/异 owner 不静默覆盖；dispose 只撤本 (owner, scope, key)；工具按键注册保持 resourceRegistry idiom、不与 prompt 贡献共享状态机。**Stage 4 口径（审查意见 5）**：scoped 路径的同键重复登记在触达官方 backing 前即抛 typed conflict（不按内容比较、不做 content-idempotent）；官方 backing 对全局登记的 content-idempotent/content-conflict 语义不变。设计「失败路径」表与 registry `tools.register` 的 currentShape 已同步该口径。
- [x] 4.4 测试：scoped 注册目标可见他者不可见（汇编+执行双侧）/ scoped restrict 仅作用目标 / 全局 register/restrict 既有行为回归 / conflict 矩阵 / dispose 隔离 / resume 重装（agent/created → 新实例 scoped 层重新可见）。**Stage 4 补齐**：冲突矩阵（同 owner 同 key 同 scope typed conflict、异 key 共存）、dispose 幂等与只撤自身、resume 重装、dead target 零贡献。

## Task 5: 本步模型选择快照消费侧（对应 Req 9）

**产出**：`lib/scoped-agent-contributions.js` 内 per-target 快照 cell + 公共读取成员 + 测试。

- [x] 5.1 per-target 快照 cell（Req 9.1–9.3；S8 蓝本）：`{ current, assembled }` 语义与官方 installModelSelection 一致——assembly 捕获 current → 本步 variables/路由消费 assembled；scoped variable 贡献读该 cell，不维护平行选择状态；跨步切换下一步全量换新、在途步保持已捕获值。
- [x] 5.2 归属边界（Req 9.4）：外部选择状态的写入方归 interactive-session-access（本线只提供消费侧 cell 与读取契约，公共读取 = `agents.scopes.snapshotOf`，见 Task 2.5）；共同验收（Req 9.5/12.6）登记为与 interactive 线/收口线的联合验收义务（本线交付消费侧证据，见 Task 6.4/6.7）。
- [x] 5.3 测试：cell 捕获→消费同值 / 换步切换语义 / scoped variable 读 cell / stale handle typed unavailable / 最后一个绑定该目标的 live handle 释放时 cell 一并释放（Task 1.8 断言）。

## Task 6: e2e 矩阵与迁移证据（对应 Req 4、5、12、design 迁移证据义务）

**产出**：`test/scoped-agent-test-kit.mjs` + `test/scoped-agent-contributions-e2e.test.mjs` + `test/scoped-agent-migration-slices.test.mjs`。

- [x] 6.1 e2e mock 基座：mock agents registry（get/create/resume/announce，`agent/created`+`agent/disposed` 事实派发）+ mock systemPrompt/tools 宿主单例（ScopedLayers 简化模型：全局层 + per-agent-object 层、caller-shadow 语义按 S1 简化复刻），全走公共入口。**Stage 4**：基座抽为共享 `test/scoped-agent-test-kit.mjs`，e2e 与迁移切片复用同一官方侧模型。
- [x] 6.2 P1 否定固化（S2）：在模拟目标执行 fiber 内经门面安装 → 断言落全局层（泄漏到其他 agent）——证明 scope 通道必要性，作为回归防线记录。
- [x] 6.3 Req 12.1–12.5 场景（含全局投影排除断言：非目标 agent 与无 target 渲染只见全局贡献）：双 agent 同插件不同目标 / 双插件同目标 / 全局+局部叠加与组合顺序 / 销毁清理（含 S5 处置语义）/ abort、dispose、owner reload 交错（stale no-op、目标清理、他 owner 存活）。
- [x] 6.4 resume 场景（Req 5.2、12.3）：同 id 新实例（模拟 drain→announce）→ scoped 贡献自动重装生效、无需插件重注册；插件已卸载的贡献不复活；provider 每次汇编重新求值（Req 5.3）。
- [x] 6.5 泄漏防护矩阵（Req 4.5、12.7）：全部场景断言无官方业务服务旁路、无私有 Symbol、无 raw context 绕路（mock 断言官方服务只经官方公共方法被触达）。
- [x] 6.6 迁移 slices（外部仓库不在工作区，沿用既有模式）：`test/scoped-agent-migration-slices.test.mjs` —— A：`dsh-read-image` per-agent 工具/提示词（M8 8.3(b) 闭合）；B：agent-teams 成员 setup（P2 形态）；C：TUI 模型选择投影与路由同快照消费；D：全局+目标叠加与第二 owner 共存。
- [x] 6.7 快照联合验收登记：Req 9.5/12.6 与 interactive-session-access 的共同验收场景登记到收口线（integration feature）任务清单，本线交付消费侧证据。**落点说明（终审意见 6）**：收口线（`plugin-api-m10-contract-convergence`）的 tasks 尚未产出，该登记在 M10 串行推进到收口线时随其 tasks 落盘；本线已在 Task 5.2/6.7 记录义务，不重复宣称已落盘。
- [x] 6.8 design 回写：P1/P2 行为复核结论、S5 session/agent 事实 probe 结论、订阅传播（S9）与冲突键位按 spec 修订流程同步回 design「fiber probe」「生命周期」「scope 表达」对应条目（已按结论回写）。
- [x] 6.9 **Req 8 边界验证（Stage 4 新增，审查意见 4）**：断言 scoped 贡献不建立任何 durable 档、不请求 storage/persistence backing（运行时态诚实丢失），持久化由插件经既有三档重装。
- [x] 6.10 **五 kind 正例与失败矩阵（Stage 4 新增，审查意见 4）**：五种 kind 各一正例落目标层且全局零落点 / unsupported 与 stale scope 的 typed 失败 / 底层成员抛错转 typed result 且无孤儿状态、无全局回退。
- [x] 6.11 **两个独立 synthetic plugin fiber（Stage 4 新增，终审意见 7）**：`test/scoped-agent-test-kit.mjs` 的 `createPluginContext(label)` 提供真实第二/第三插件 fiber（各自 ctx shadow → owner 由该 fiber 派生，`teardown()` 即 owner 卸载）；`test/scoped-agent-contributions-e2e.test.mjs`「two independent plugin fibers on one target」断言两个真实插件 fiber 的 owner 归因、同 id 跨 owner 共存、同 owner 重复 conflict、以及一方卸载只撤自身贡献与 handle（`composition-and-authority.md` §11）。

## Task 7: registry 修正与文档同步

- [x] 7.1 canonical registry：新增 `agents.scopes.register` 行（resourceRegistry idiom）+ `agents.scopes.register.handle` 行（**六字段 idiom 例外**：target/status() 扩展成员，字段按 design「scope 表达」原文，verification 为字符串）+ `agents.scopes.snapshotOf` 行（projection，Task 2.5）；`prompts.contribute` 行补 scope 维度说明（conflict 键位 (owner, target, id)）；`tools.register` / `tools.restrict.register` 行补 scope 维度；validator 全绿。
- [x] 7.2 能力与登记同步：`lib/capability-matrix.js` / `lib/capability-descriptors.js` 补 `agents.scopes` 簇（与 registry capabilityMatrix 对齐）；`docs/specs/plugin-api-features/feature-list.md` §7 追加交付条目（载入 host-only 六问 + 与 decision 线/interactive 线的分工交叉引用）；design「迁移证据义务」达成情况记录。
- [x] 7.3 一致性核对：registry validator + 相关 registry/capability 测试全绿。
- [x] 7.4 **跨线 authority 议题登记（Stage 4 新增，S10）**：把「`prompts.contribute` 显式 `spec.ownerId` 与 `composition-and-authority.md` §5.1『不接受调用方伪造 owner』的张力」作为跨线观察登记给 convergence 线（本线只做 scoped 与全局的形状平权，不单方面改已交付契约）。**落点说明（终审意见 6）**：与 Task 6.7 同——该登记随收口线 tasks 落盘，本线先记录义务与证据（`935d2f4` 的 M8 审查决定保留显式 ownerId）。

## Task 8: 全量验证、全局终审与提交

- [x] 8.1 `npm test`（4G 护栏）全绿；治理 token 审计不新增泄漏。
- [x] 8.2 全局终审（阻塞式，只审整体）：返回「无偏差」后才可进入 8.3；有意见则集中修订并再次派审。
- [x] 8.3 `git diff --check` 干净；终审通过后按阶段提交规则提交本 Stage 4 交付并完成最终登记。

## Stage 3 对抗性审查记录（2026-09-13，阻塞式只读审查）

审查只核对 tasks 与 SPEC1 已交付 Goal/Requirements/Design 的一致性并按 `docs/standards/` 适用分册比对，结论「有意见」七条，逐条处置：

1. **（阻塞）销毁清理责任与 Req 6.1 / design 生命周期表冲突** → 已完成官方 probe（S5/S9：同进程恢复先排空旧身份且无可区分信号），按 spec 修订流程同步 requirements Req 6.1/6.6 与 design 生命周期表为 **eviction + 有界簿记**语义，并新增 Task 1.8（handle owner 绑定）与 Task 6.9 作为有界性证据。
2. **（阻塞）`agents.scopes.snapshotOf` 无 tasks/design 依据** → 新增 Task 2.5 补齐 design「消费侧只读成员」条目、registry 行与 capability 登记依据（成员实现自 `75663bb` 起已在登记中）。
3. **（非阻塞）status 行与实际状态不自洽、门序问题** → 状态行与勾选已更正；门序事实在头部如实记录，不以「已实现」倒推审查已通过。
4. **（非阻塞）需求覆盖缺口（Req 8 / 5.3 / 5.5 / 7.4）** → 新增 Task 6.9、3.7，并把 Req 7.4 的落点写进 Task 7.1/7.2。
5. **（非阻塞）conflict 键位多一个 `kind` 维** → prompts 面统一为 `(owner, target, id)`（kind 不进键位，与全局入口同构）；tools 面保留各自按键空间并写进 Task 3.2/design。
6. **（非阻塞）Task 1.5 订阅通道措辞与实现不一致** → 按实现与官方依据改写为「`ctx.on` 订阅官方 facts，宿主根上下文经向上传播接收」（S9），并回写 design。
7. **（非阻塞）编号错位 / generation 语义 / 执行边界缺 fail-safe** → 编号修正；handle 的 `generation` 语义在 design「scope 表达」与 registry 行按「不承载跨代比较、stale 由 disposed 标志判定」如实表述；执行边界明确入口 fail-safe（Task 1.5 自含故障 + mount fail-safe 既有实现）。

## Stage 4 全局终审记录（2026-09-13，阻塞式只读审查）

第一轮结论「有意见」，八条全部为**非阻塞**（无一条动摇交付正确性），逐条处置：

1. **Task 2.1/2.4 的 Req 10.1/10.3 断言缺位** → 新增 Task 2.6 与 mount 级降级用例（见 2.4 落点）；同时修正 capability availability 输入的 feature key（`'agents'` → `'agent'` + `'scopedAgentContributions'`），使 `agents.scopes` 的 capability 从「恒 unavailable」变为随真实 backing 变化。
2. **`purgeOwner` 死代码** → 删除；owner 卸载只保留 `callerCtx.effect` 单一路径，并在模块注释中写明「刻意不设第二条 owner-purge 扫掠」。
3. **design 生命周期表订阅事实与实现不一致** → 表内收敛为「实现只订阅 `agent/created` / `agent/disposed`；`session/disposed` 仅作 S5 probe 依据」。
4. **registry `failureSemantics: typed-throw` 与实现口径** → 不改字段（validator 要求同 idiom 单一取值），改 `agents.scopes.register` / `.handle` 的 `currentShape` 写明「invalid/unavailable 为判别式 typed 结果，未挂载/核心不活跃为 typed disabled/inactive 错误」。
5. **tools scoped 与 `content-idempotent` 声明** → 按审查建议明确口径（scoped 同键一律 conflict、不比较内容；全局路径保持官方 content-idempotent），同步 design 失败路径表、Task 4.3 与 registry `tools.register` 的 currentShape。
6. **Task 6.7/7.4 的跨线登记落点不可核** → 在两条 task 中写明「随收口线 tasks 落盘」并保留义务记录（该落点在 M10 串行推进到收口线时兑现）。
7. **`composition-and-authority.md` §11 两独立 synthetic plugin 证明** → 新增 Task 6.11 与真实双 fiber 用例（不再只用 `spec.ownerId` 模拟 owner）。
8. **mock 自证风险与 assemble 负载形状** → test-kit 增加 fidelity 声明注释，`assemble` 的 agent 负载改为接受官方对象形状（`{ agent, scope, signal? }`）。

第二轮结论「有意见」两条，均为非阻塞，已就地闭合：

1. **design「并发与取消」仍用 purge 表述**（与本文件 eviction 语义自相矛盾）→ 该节改写为 install/dispose/evict + 「不存在物理 purge 窗口」+ 物理清除三种触发来源，与「生命周期与清理责任」表、Req 6.1 一致。
2. **`createDisabledScopesApi` 落在 `// tool-discovery` 切片标记对内部**（归属错置）→ 移出该标记对，改用 `// scoped-agent-contributions` 标记对包裹，保持 tool-discovery 切片只含 tool-discovery 工件。

第三轮结论：**无偏差**（标记对配对零未配对、eviction 表述与 requirements Req 6.1/6.6 及实现一致、3192 全绿、registry valid、client bundle `--check` 一致、lint 零诊断）。非阻塞观察两条（本 feature 未声明裸标记纪律；`context-provenance`/`adapter-decoration` 的既有近似未配对标记）与本交付无关，不构成偏差。

## 执行边界

- 版本冻结：不步进任何版本字段（AGENTS §3.0.1）。
- 不重写 agent service；不 fork/替换官方组件；无新 replacement 包、无新被禁用官方行；无第四档 durable scope；不建第二个 prompts 贡献 owner 或第二个替换 owner；治理代号不进入实现/测试代码。
- 入口 fail-safe：mount/apply 与全部内部监听器失败只记录有界诊断并安全停用，绝不抛穿官方 apply/dispatch（§2 第 6 条）。
- S5 的销毁/恢复处置与官方 session/agent 事实 probe 一致（不可区分 → eviction 语义），已按 spec 修订流程同步 requirements Req 6.1/6.6 与 design 生命周期表。
