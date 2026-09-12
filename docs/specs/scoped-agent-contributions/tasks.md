# Stage 3 - Tasks

> feature_name: `scoped-agent-contributions`
> milestone: M10
> status: Tasks 已产出，待对抗性审查
> 输入溯源：goal.md；requirements.md（Reqs 1–12）；design.md（probe-first 方案、分工矩阵、生命周期表、组合边界）；Stage 3 源码级探针记录见下。

## Stage 3 探针记录（源码级事实，Stage 4 以行为测试复核）

- **S1 官方服务是宿主单例**：`tools`（`dsh-tools` ToolRuntime）与 `systemPrompt`（`dsh-system-prompt` SystemPrompt）都是宿主级 cordis Service；per-agent 性完全来自 (a) `ScopedLayers` 按 `scopeOf(ctx)`（agent 对象）分层、(b) cordis caller-shadow 绑定（`agent.ctx.systemPrompt.section(...)` 的 `this.ctx` 被换成 agent ctx shadow，注册落 agent scoped 层）。官方错误文案即权威指引："for a per-agent override, register through that agent's `agent.ctx` instead"。
- **S2 P1（fiber 内 caller-bound 安装）被否定**：cordis 的 `get`/属性解析按访问 ctx 对象/shadow 沿 fiber 链找最近 provide，**不按 AsyncLocalStorage**（ALS 只承载 initiator 归因）；在目标 agent 执行 fiber 内经门面调用，访问 ctx 仍是插件的 shadow（无 agent scope 标签）→ 落全局层。P1 不是有效的 per-agent 安装路径（Stage 4 以泄漏断言固化该结论）。
- **S3 P2（显式 target 通道）成立**：`agents.get(sessionId).ctx` 可达（官方 AgentRegistry `get` 返回 Agent 本体，`.ctx` = `createScope(loopCtx, agent)` 独立 fiber + `extend({agent})`）；经目标 ctx 调用官方 systemPrompt/tools 方法即落 agent scoped 层，官方 disposer 由 agent scope fiber 所有权兜底（agent 销毁自动撤销）。按 design 判定规则：**P2 通过 → register 时捕获目标服务解析闭包（lazy 重解析），register 是唯一新增解析点**；与 design 预案一致，无需升级人类裁决。
- **S4 身份与恢复**：agent 身份 = SessionId（branded string，运行时即 string）；同进程 resume（`resumeWith` 以 `resumeSessionId` 重注册）**同 id、新 Agent 对象**（ScopedLayers 按 agent 对象键 → 旧实例 scoped 注册随旧 fiber 消亡）。resume 检测点：官方 `agent/created`（announce 时发，payload `{agent}`，untagged listener 全收）+ `agent/disposed`（detach teardown 发，payload `{agent}`，scope-filtered）。
- **S5 销毁 vs resume-drain 张力**：`agent/disposed` 在 resume 换实例与最终销毁时都会发；若严格按 Req 6.1 在 disposed 即 purge 门面记录，S4 的自动重装将失去记录源。Stage 4 处置（记入执行注）：优先以官方 session 级事实区分（probe `session/disposed` 语义）；不可区分时回退为「disposed → 官方层注册自然消亡（fiber 所有权）+ 门面记录转 dormant（不再参与任何汇编）+ 同 id `agent/created` 重装 + handle dispose/owner 卸载才物理清除」，并在执行注记录该解释（purge 的可观察语义 = 死目标零汇编效果；dormant 记录仅为簿记）。
- **S6 汇编 payload 携带 agent 身份**：`system-prompt/assemble` 第二参 `context = assembleContextFor(agent, signal) = { agent, scope: agent, signal? }`；W2（宿主层 wrapper 按 id 过滤）技术上可行但被否——官方 section 对 undefined 返回的语义不确定、且偏离官方 per-agent 设计。统一采用 **W1（经目标 ctx 的官方 scoped 层）**。
- **S7 门面现状**：`createContributeEntry`（plugin-api-service.js:987–1052）per-owner Map + 同 owner 同 id conflict + 幂等 dispose + backing disabled typed unavailable，无 callerCtx.effect 绑定（owner 卸载不自动清理——scoped 变体需补 effect 绑定以满足 Req 6.2）；tools getter caller-bound 解析 `this.ctx.get('tools')`（:1370–1397），`tools.register(definition)` 单参、官方 restrict **强制 scoped ctx**（host ctx 调用直接抛错）；`agents.get/list/roots` 查询面已存在（直转官方 registry）；events bus 已支持 scope 门控且 `agent/disposed`、`agent/created` 已在门面 catalog（agent-events-catalog.js）。
- **S8 快照蓝本**：官方 `installModelSelection(agentCtx, selection)` —— `system-prompt/assemble` 捕获 `selection.current` 注入 `variables.provider/model`、`agent/request` 消费 `selection.assembled` 做 route（同一步一致快照的官方机制）。

## Task 1: scoped registry 核心模块（对应 Req 1、6、10）

**产出**：`lib/scoped-agent-contributions.js`（纯函数模块，零 harness 依赖可测）+ 单元测试 `test/scoped-agent-contributions.test.mjs`。

- [ ] 1.1 目标解析（Req 1.1–1.2）：`resolveTargetReference(agentsRef, agent)` —— 接受 string SessionId / `{ id }` / 带 `.id` 的 agent 引用；经官方 agents 面（`agents.get(id)`）解析；不可解析/已销毁/backing 不可用 → typed `unavailable`，不回退全局。
- [ ] 1.2 scope handle（Req 1.1、1.3、1.5）：冻结 `{ id, ownerId, generation, target, status(), dispose() }`——`target` 为冻结身份快照 `{ id, resolvedAt }`；`status()` 读官方 liveness（`agents.get(id)` 存在性）：存活报 usable、目标已销毁**恒报 destroyed**（Req 1.3；dormant 只是门面记录簿记状态，绝不作为 status 可观察值掩盖 destroyed）；`dispose()` identity-bound、幂等、stale no-op（不撤他 owner/他目标）；不挂 contribute 方法（design 边界）。
- [ ] 1.3 scoped 记录存储（Req 6.3、6.4）：按 `(owner, targetId)` 键控的记录表 `{ kind, contributionId, installClosure, generation }`；同 (owner, target, id) 互斥（conflict）；旧 generation 的 stale handle/disposer typed no-op 不撤新 generation。
- [ ] 1.4 lazy 目标 ctx 解析与安装（S3）：install closure 以 `agents.get(targetId)?.ctx` 为解析点（每次安装/重装时重解析，resume 后自然落新实例 scoped 层）；解析失败（目标不在）→ typed unavailable/destroyed，不安装孤儿状态（Req 6.5）。
- [ ] 1.5 生命周期钩子（Req 6.1、5.2、10.2；S4/S5）：门面以 untagged observe 订阅官方 `agent/created`（同 id 有 dormant/active 记录且 owner 仍 active → 重装到新实例 ctx）与 `agent/disposed`（官方层注册随旧 fiber 自然消亡；门面记录处置按 S5 的 session-fact probe 结论执行并在执行注记录）；订阅经 events bus 既有 observe 通道，不新增事件事实。**内部监听器必须自含故障**：重装失败降级为 typed 结果/有界日志、绝不向官方派发抛穿（官方 `agent/created` 的同步 throw 会否决 agent 发布，门面监听不得成为该否决源——G1 fail-safe 模式）。
- [ ] 1.6 owner 卸载清理（Req 6.2）：安装经 `callerCtx.effect` 绑定 identity-bound 撤除（该 owner 跨目标全部 scoped 贡献）；他 owner 存活；effect 不可用 → typed unavailable（不静默）。
- [ ] 1.7 测试：handle 形状与冻结 / 目标不可解析 typed unavailable / status 两态（usable/destroyed）/ dispose 幂等与 stale no-op / (owner, target, id) conflict / 旧 generation no-op / lazy 重解析（模拟同 id 新实例重装）/ dormant 语义 / owner 卸载 effect 清理。

## Task 2: `agents.scopes` 门面接入（对应 Req 1、10、11）

**产出**：`lib/index.js` / `lib/plugin-api-service.js` 接线 + surface 测试。

- [ ] 2.1 `agents.scopes.register` 挂既有 agents 域（`agents` surface 增 `scopes` 子对象；无顶层新域）；typed 错误族沿用 `PluginApiFeatureDisabledError`/`PluginApiInactiveError` 基线（Req 10.1–10.3）；不夺 agents 域既有 owner 权。
- [ ] 2.2 capability 自描述：`lib/capability-descriptors.js` 增 `agents.scopes` 行（effect register，features `['agents']`——backing 即官方 agents registry；不虚挂无关 feature）；`agents.scopes` 不可用不影响 `agents.create/get` 等既有成员（Req 10.1 局部降级断言）。
- [ ] 2.3 host-only 判定落登记（Req 11）：feature-list §7 条目载入六问全否记录。
- [ ] 2.4 测试：surface 形状 / 降级隔离 / inactive typed 错误。

## Task 3: `prompts.contribute` 的 scope 维度（对应 Req 2、7）

**产出**：`lib/plugin-api-service.js` `createContributeEntry` 扩展 + 测试。

- [ ] 3.1 `spec.scope` 判别（Req 2.1、2.5）：scope 为 scope handle（opaque token，经 handle 内部 token 校验归属当前 registry，防伪造）→ 按 kind 走 S3 通道（经目标 ctx 调官方 systemPrompt 成员注册进 agent scoped 层）；畸形/不支持 kind → 既有 typed failure shapes；scope-bearing 失败**不回退全局**。
- [ ] 3.2 conflict 键位扩展（design 分工矩阵）：同 owner 同 id **同目标** → 既有 conflict；同 owner 同 id 异目标 → 各自独立（键位 (owner, target, id)）；跨 owner 同目标同 id → 各自归属共存（Req 4.2）。
- [ ] 3.3 handle 与生命周期：contribution handle 仍为 `{ id, ownerId, seq, dispose() }`（idiom 不变）；dispose 走 identity-bound（owner+target+id）撤官方 scoped 注册；callerCtx.effect 绑定 owner 卸载（Task 1.6 机制）。
- [ ] 3.4 组合边界（Req 7.1、7.2、7.4）：scoped 贡献恒为追加型；不提供整体替换/删除语义；汇编顺序 = 全局追加 → 目标 scoped 追加 → assembly replacement policies（decision 线）——以官方 ScopedLayers 合并语义（全局层 + scope 层链）天然承载，测试断言该顺序。
- [ ] 3.5 测试：scoped section/context/variable/tools kind 各一正例（目标汇编含、他者不含——Req 2.2/2.4）/ suppressRuntimeContext scoped / 失败不回退 / conflict 键位矩阵 / 追加型边界（无替换语义可触发）/ 全局投影（无 target 的 host 级渲染）不含 scoped 贡献（Req 2.3 排除断言）/ 底层注册抛错转 typed result 不抛穿 caller（Req 10.2）。

## Task 4: `tools.register` / `tools.restrict.register` 的 scope 维度（对应 Req 3）

**产出**：`lib/plugin-api-service.js` `createToolsApi` 扩展 + 测试。

- [ ] 4.1 `tools.register(definition, { scope })`（Req 3.1、3.2）：外层 resourceRegistry 合同不变；scope 存在时经目标 ctx 调官方 register（S3 通道）→ 落 agent scoped 层，仅目标可见/可调用（汇编 wireSchemas 与执行 resolveExecution 双侧按官方 per-agent 解析）；他 agent 不可见。
- [ ] 4.2 `tools.restrict.register(policy, { scope })`（Req 3.3）：官方 restrict 强制 scoped ctx（host ctx 调用抛错是官方既有语义）——scope 通道经目标 ctx 调用正是使 restrict 可用的路径；无 scope 的既有行为不变（含官方 scoped-ctx 强制错误语义本身，不做「全局 restrict」放宽）。
- [ ] 4.3 冲突与隔离（Req 3.4、3.5）：键位 (owner, scope, key)；同 owner 同 key 同 scope 走既有 conflict 规则；异 scope/异 owner 不静默覆盖；dispose 只撤本 (owner, scope, key)；工具按键注册保持 resourceRegistry idiom、不与 prompt 贡献共享状态机。
- [ ] 4.4 测试：scoped 注册目标可见他者不可见（汇编+执行双侧）/ scoped restrict 仅作用目标 / 全局 register/restrict 既有行为回归 / conflict 矩阵 / dispose 隔离 / resume 重装（agent/created → 新实例 scoped 层重新可见）。

## Task 5: 本步模型选择快照消费侧（对应 Req 9）

**产出**：`lib/scoped-agent-contributions.js` 内 per-target 快照 cell + 测试。

- [ ] 5.1 per-target 快照 cell（Req 9.1–9.3；S8 蓝本）：`{ current, assembled }` 语义与官方 installModelSelection 一致——assembly 捕获 current → 本步 variables/路由消费 assembled；scoped variable 贡献读该 cell，不维护平行选择状态；跨步切换下一步全量换新、在途步保持已捕获值。
- [ ] 5.2 归属边界（Req 9.4）：外部选择状态的写入方归 interactive-session-access（本线只提供消费侧 cell 与读取契约）；共同验收（Req 9.5/12.6）登记为与 interactive 线/收口线的联合验收义务（tasks 执行注明确记录，不在本线单独宣称覆盖）。
- [ ] 5.3 测试：cell 捕获→消费同值 / 换步切换语义 / scoped variable 读 cell。

## Task 6: e2e 矩阵与迁移证据（对应 Req 4、5、12、design 迁移证据义务）

**产出**：`test/scoped-agent-contributions-e2e.test.mjs` + `test/scoped-agent-migration-slices.test.mjs`。

- [ ] 6.1 e2e mock 基座：mock agents registry（get/create/resume/announce，`agent/created`+`agent/disposed` 事实派发）+ mock systemPrompt/tools 宿主单例（ScopedLayers 简化模型：全局层 + per-agent-object 层、caller-shadow 语义按 S1 简化复刻），全走公共入口。
- [ ] 6.2 P1 否定固化（S2）：在模拟目标执行 fiber 内经门面安装 → 断言落全局层（泄漏到其他 agent）——证明 scope 通道必要性，作为回归防线记录。
- [ ] 6.3 Req 12.1–12.5 场景（含全局投影排除断言：非目标 agent 与无 target 渲染只见全局贡献）：双 agent 同插件不同目标 / 双插件同目标 / 全局+局部叠加与组合顺序 / 销毁清理（含 S5 处置语义）/ abort、dispose、owner reload 交错（stale no-op、目标清理、他 owner 存活）。
- [ ] 6.4 resume 场景（Req 5.2、12.3）：同 id 新实例（模拟 drain→announce）→ scoped 贡献自动重装生效、无需插件重注册；插件已卸载的贡献不复活。
- [ ] 6.5 泄漏防护矩阵（Req 4.5、12.7）：全部场景断言无官方业务服务旁路、无私有 Symbol、无 raw context 绕路（mock 断言官方服务只经官方公共方法被触达）。
- [ ] 6.6 迁移 slices（外部仓库不在工作区，沿用既有模式）：read-image per-agent 工具/提示词（M8 8.3(b) 闭合）与 agent-teams 成员 setup（P2 形态）各一 slice——记录原始行为、迁移公共调用形状、断言等价承载。
- [ ] 6.8 design 回写：P1/P2 行为复核结论与 S5 session-fact probe 结论按 spec 修订流程同步回 design「fiber probe」与「生命周期」对应条目（结论一致则记录「无偏差」即可）。
- [ ] 6.7 快照联合验收登记：Req 9.5/12.6 与 interactive-session-access 的共同验收场景登记到收口线（integration feature）任务清单，本线交付消费侧证据。

## Task 7: registry 修正与文档同步

- [ ] 7.1 canonical registry：新增 `agents.scopes.register` 行（resourceRegistry idiom）+ `agents.scopes.register.handle` 行（**六字段 idiom 例外**：target/status() 扩展成员，字段按 design「scope 表达」原文，verification 为字符串）；`prompts.contribute` 行补 scope 维度说明（conflict 键位 (owner, target, id)）；`tools.register` / `tools.restrict.register` 行补 scope 维度；validator 全绿。
- [ ] 7.2 能力与登记同步：`lib/capability-matrix.js` 如需补 `agents.scopes` 簇（与 registry capabilityMatrix 对齐）；`docs/specs/plugin-api-features/feature-list.md` §7 追加交付条目（载入 host-only 六问 + 与 decision 线/interactive 线的分工交叉引用）；design「迁移证据义务」达成情况记录。
- [ ] 7.3 一致性核对：registry validator + 相关 registry/capability 测试全绿。

## Task 8: 全量验证、全局终审与提交

- [ ] 8.1 `npm test`（4G 护栏）全绿；治理 token 审计不新增泄漏。
- [ ] 8.2 全局终审（阻塞式，只审整体）：返回「无偏差」后才可进入 8.3；有意见则集中修订并再次派审。
- [ ] 8.3 `git diff --check` 干净；终审通过后按阶段提交规则提交本 Stage 4 交付并完成最终登记。

## 执行边界

- 版本冻结：不步进任何版本字段（AGENTS §3.0.1）。
- 不重写 agent service；不 fork/替换官方组件；无新 replacement 包、无新被禁用官方行；无第四档 durable scope；不建第二个 prompts 贡献 owner 或第二个替换 owner；治理代号不进入实现/测试代码。
- S5 的销毁/恢复处置若与官方 session 事实 probe 冲突，按 spec 修订流程同步 requirements/design 对应条目（Req 6.1 的 purge 语义若采纳 dormant 解释须在 requirements 层面一并澄清）并在执行注记录。
