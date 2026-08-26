# Stage 3 - Tasks

## Status

SPEC3：Tasks 产出于基底 commit d7ab9fe（M6 第六批次 Stage 2 获批提交），工作分支 `feat/m6-context-provenance`（Wave B）。本文按 AGENTS.md §3.2 在进入 Stage 4 前接受**阻塞式对抗性审查**；返回「无偏差」即通过审查门，直接进入 Stage 4 由代理自主完成；Stage 4 不再逐顶层大任务审查，全部任务完成并验证后执行一次全局终审，通过后完成 Stage 4 提交。

## Stage 4 完成注（2026-08-26，执行后回读）

- **顶层任务全部完成**：T1 `lib/context-normalize.js` + `test/context-normalize.test.mjs`；T2 `lib/context-engine.js` + `test/context-engine.test.mjs`；T3 `lib/context-sources.js` + `test/context-sources.test.mjs`；T4 `packages/agent-loop/lib/evidence-slice.js` + 发射点接线（forked-loop）+ apply 自检扩展 + `packages/agent-loop/test/evidence-slice.test.mjs`；T5 guards/service/index 接线 + `test/context-guard.test.mjs` + `test/index-context.test.mjs`；T6 全量 `npm test` 2192/2192 全绿、`git diff --check` 通过、治理 token 审计通过、官方包零修改。
- **执行期 spec 修订（本件与 design.md，最终报告同步列出）**：
  1. 投影纯度澄清：compose 绝不写引擎状态（CP-3.1/api-shape §1），`served` 为派生分类（最近一次 compose graph 包含即报 served），持久转移仅 evidence→sent / mapping→archived|superseded / redaction→redacted；engine 保留每 session 最近 graph 快照（latest-wins）。tasks T2.2/T2.3/T2.9 与 design.md「状态派生澄清」已同步。
  2. 实现细节钉死（task 级选择，与已批准文档无冲突）：`ComposeResult.budget` 语义——未传 budget → `{ applied: false }`；合法预算 → `{ applied: true, maxNodes }`（超出按节点截断并记 `budget-exceeded`）；畸形预算 → `{ applied: false, reason }`（不静默截断、不静默超预算）；policy 排除节点的 dropped 原因 `policy-excluded`；inspect 的 audience 内容包含放逐出节点投影（entry 级 `content`）；inspect 未 compose 过的已注册节点归入 archived bucket（原因 `contributed`）；`sentBy.evidenceId = String(证据 generation)`；compaction intake 经 engine `recordCompactionMapping`（shadowed seqs → 会话内节点 id，不伪造；历史达界时 `mapping().truncated` 为 true）；证据/compaction 订阅无条件安装（R 行晚于门面 apply）；`availability()` 扁平形状 `{ active, <kind>: status, sentReachable }`；`observe` disposer 首次即 `already: false`、重复为 `already: true`（幂等）。
  3. 终审修订（2026-08-26 全局终审一般意见的集中修订）：skillExposure adapter 新增 SDA-5 冻结词汇归一器 `normalizeSkillExposureRecord`（纯函数：结构/类型/有界数组，枚举语义归 Wave A），并经 adapter.normalize 暴露、正反例测试覆盖（T3.5 完整交付）；sessionResolver 语义显式声明为 design 级修订（显式引用解析，不当场做 live-store 存在性检查——持久会话假阴性；畸形引用 typed `INSPECT_UNAVAILABLE`，合法空引用有界空投影，见 design.md「sessionResolver 语义澄清」）；engine 模块头注释修正为「compose 仅写最近 graph 快照、inspect 仅 fail-closed redaction 转移」。
  3. 测试缝：`mountContextFeature`/`resolveMarkedEvidenceSlice` 导出于 index.js 并支持注入（evidenceResolver / readManifest，沿用 `buildToolAbortedErrorFactory` 先例）；`engine.recordCompactionMapping` 为该 feature 内部能力（辅助包核心语法不变）。
  4. contract 共享断言增量（integration-owned，本线先行机械更新并在最终报告标注）：features 列表/长度/尾部顺序 pins（index*.test、security-policy-assembly、official-passthrough-independence 的 BRANCH_ADDED_FEATURES）、compat listener 清单（新增 `agent-loop/assembled-context` 与 `compaction/completed` 两条无条件订阅）；Wave A 合并时由 integration owner 叠加其增量并协调冲突。
- **未越界确认**：版本未 bump；`feature-list.md` §7 与 U18/U19 状态未动（integration owner 统一）；events catalog 两文件零改动（无新增 catalog slice）；对方 feature（skill-discovery-activation）文件零改动；既有 agent-loop 冻结测试全绿；官方包零修改。

## 执行注（Stage 4 规则同步，AGENTS.md §3.2「历史/在途制品衔接」）

- Stage 4 按本文顶层任务/批次顺序执行；一个批次内的所有子项、实现文件和测试作为整体交付，不得借任务合并掩盖未完成验收标准。
- 执行中发现实现细节/设计矛盾：先修订对应 spec 文档（requirements/design/tasks）保持一致并列入最终报告；动摇已确认 Goal/Requirements 验收标准则暂停请求人类裁决。
- 全局终审通过后才可交付结果报告、执行 Stage 4 完成提交。
- 阶段提交（Stage 3 完工）：本文通过对抗性审查（无偏差）后，先提交 `tasks.md` 与必要附带改动（`git diff --check`），再进入 Stage 4。

## 依据与边界

- 依据：`goal.md` / `requirements.md` / `design.md`（CP-1…CP-10）；`docs/standards/` 六册；`capability-strategy.md` R1–R9（本 feature 的 R 能力切片沿用已交付 `@deepseek-ai/dsh-plugin-api-agent-loop` 的既有 R1–R9 实现，CP-5 逐条对照，其中 R2/R3 由既有包契约保真复刻覆盖，R4/R5/R6 沿用既有 boot 自检/版本锁定/owner 冲突检测并扩展证据切片探测）；`temp/m6-batch6-contract.md`（Wave B 职责、冻结边界、Schema 词汇、失败呈现、合并顺序）。
- 实现前已读一次 `docs/standards/` 适用分册（§3.4 分工：实现代理负责「实现前读懂一次」，审查代理负责「按 standard 比对交付」）。
- 命名：feature key / guard 分支 / registry 键统一 `context`；guard 单 else-if 分支；FEATURE_MOUNTERS 条目 `context`（contract §2：`skillsActivation` 在 `toolDiscovery` 之后、`context` 在 `skillsActivation` 之后；本线工作树不含 Wave A 的 `skillsActivation` 条目，条目先置于 `toolDiscovery` 之后并加注释，最终顺序由 integration owner 合并时保证，本线不重排既有分支）。
- 冻结（contract §3/§4）：官方包、既有 `lib/` 非本契约挂载点、`lib/events-catalog.js` 与 `lib/system-prompt-events-catalog.js`（本 feature 不新增 catalog slice）、文档 `docs/standards/*` 与 `AGENTS.md`、对方 feature spec（`skill-discovery-activation/`）、既有 `test/` 与各包既有测试与共享断言（`features.length`、`remote`-last、host-boundary）。本线只新增 `context-*` 前缀测试文件与 `packages/agent-loop/test/evidence-slice.test.mjs`。
- 交付归属（integration owner 统一，本线不做）：版本 bump（主包/辅助包/full bundle 版本与 `dsh.api`）、full bundle patch 装配、`feature-list.md` §7 登记、U18/U19 状态更新、共享断言增量维护。
- 实现代码禁止治理魔法字母（contract §2/AGENTS.md §6）：工作流代号、需求编号（CP-*）、分类字母（B/R）、R1–R9 等一律不进 `lib/`、`packages/`、`test/`、`package.json`、行 id 与运行时可见字符串；运行时命名中立（事件名 `agent-loop/assembled-context`、能力 marker `dsh-plugin-api.agent-loop.assembled-evidence`、feature key `context`）。

## 失败呈现（contract §6，实现统一遵守）

- typed 码（不抛穿插件回调、不抛穿 apply、经 plugin-diagnostics 归因 owner）：`CONTRIBUTION_INVALID` / `CONTRIBUTION_CONFLICT` / `CONTRIBUTION_UNKNOWN` / `CONTRIBUTION_DISPOSED` / `COMPOSE_SCOPE_UNRESOLVED` / `COMPOSE_ABORTED` / `SOURCE_UNAVAILABLE` / `SOURCE_DEGRADED` / `EVIDENCE_UNAVAILABLE` / `INSPECT_UNAVAILABLE` / `MAPPING_UNAVAILABLE` / `REDACTION_FAILED` / `INACTIVE`。
- 共享词（`UNAVAILABLE` / `INACTIVE`）语义与其他 feature 一致：typed、fail-safe、不杀 boot。
- R 证据切片发射异常被替代引擎吞掉并记诊断：证据发射失败不得影响模型请求的组装与发送（evidence-only 铁律）；门面在证据缺失时降级披露（`served ≠ sent` 上限），不伪造 `sent`。

## 顶层任务清单（依赖有序）

### T1 纯函数层 `lib/context-normalize.js`（覆盖 CP-1/2/3/4/6/7/8 的归一；零依赖纯函数）

1. **T1.1 contribution 校验与归一**：`normalizeContribution(spec)` 校验——id 非空字符串；owner 非空；scope 单档 `{ kind: 'request' | 'session', key: string }`；phase 非空字符串（默认 `'default'`）；priority 六档（lowest/low/normal/high/highest/monitor）；source 必须 `{ kind, owner }` 且 kind ∈ `{ systemPrompt, sessionSurface, attachment, toolExposure, skillExposure, memory, compaction, assembledEvidence }`；sourceEventSeqs 可选、有界（≤64 项）非负整数数组且**不得合成序号**；expiresAt 可选 ISO 字符串；audience 包络 `{ model, ui, diagnostic }` 布尔（缺失/非法 → invalid）；supersedes 可选 id 字符串。非法输入返回结构化 invalid 结果（供引擎映射 `CONTRIBUTION_INVALID`），不抛错。
2. **T1.2 图排序确定性**：`compareContributions` 排序键固定为 (scope kind：`session` 先于 `request`) → phase 字典序升序 → priority 档位降序（highest 先）→ 注册序升序（stable）→ id 字典序兜底。排序规则写入模块注释（文档化 tie-breaking，满足 CP-3.2）。
3. **T1.3 budget 截断**：`applyBudget(nodes, budget)`——budget 为 `{ maxNodes: 正整数 }`；超出部分逐节点产生 dropped 记录 `{ nodeId, reason: { code: 'budget-exceeded', detail } }`；无 budget 时不截断（CP-3.3：绝不静默包含超预算内容）。
4. **T1.4 证据与映射归一**：`normalizeAssembledEvidence(payload)`——校验 frozen Schema 词汇形状 `{ sessionId, generation, systemSections: [{ sectionKey, sourceTags }], messageRanges: [{ fromSeq, toSeq, count }], dropped: [{ ref, reason }], observedAt }`（contract §5）；只接受标识符/序号范围/原因，出现 content/secret 字段即 invalid（CP-5.3/CP-8）。`normalizeReplacementMapping(record)`——`{ oldNodeIds: string[], newNodeId: string, reason, generation, observedAt }`（CP-7.1）。
5. **T1.5 冻结工具**：复用 `lib/deep-freeze.js` 的 deepFreeze 对全部投影/证据输出冻结（CP-1.4）。

**测试**：`test/context-normalize.test.mjs`（校验矩阵、受众包络、排序确定性含 tie-break、budget dropped reason、evidence/mapping 归一正反例、无 content 字段强约束）。

### T2 引擎 `lib/context-engine.js`（CP-1/3/4/6/7/9；门面自有解释层状态机）

1. **T2.1 contribution 注册与 disposer**：`createContextEngine({ sources, reportDiagnostics, now, idFactory, sessionResolver, evidenceSource, evidenceRingLimit })`（注入面同 design.md「内部接口」：`sources` 为七个来源适配器（T3），`evidenceSource` 为 evidence 适配器（T3.7）单独注入，供 T2.8 消费）；`contribute(spec)` → `{ handle: { id, owner, generation, dispose } }`；同 owner 域重复 id → `CONTRIBUTION_CONFLICT` 且保留既有；disposer 幂等、只移除自己 owner 的条目（未知/已 disposed 处置幂等，`CONTRIBUTION_UNKNOWN`/`CONTRIBUTION_DISPOSED` 仅作 typed 结果，不抛穿）；`generation` 为 owner-specific opaque token（复用登记序号，`identity-and-lifecycle.md` §2，不做全局单调序号）。
2. **T2.2 节点六态状态机**：NodeRecord 生命周期/可见性状态 `contributed | served | sent | archived | redacted | superseded`（`identity-and-lifecycle.md` §3：这些是生命周期/可见性状态，不是统一终态词汇，字段与语义均不混用）；**持久转移仅四条**——evidence→`sent`（T2.8，外部证据事件驱动）、mapping→`archived`/`superseded`（T2.6，compaction/置换驱动）、redaction 失败→`redacted`（T2.5，fail-closed）；`served` 是**派生分类**（节点被该 session 最近一次 compose graph 包含即报告为 `served`，compose 保持投影纯度，CP-3.1/api-shape §1），不是持久状态转移；每条持久转移记录 `{ state, reason, observedAt }`；一旦提交到不可逆状态（sent/archived/redacted/superseded）**不得重写**（迟到 evidence、旧代 evidence、后到归档均不得改写，CP-5.6）；`superseded` 只作 replacement lineage（CP-4.4），保留旧节点供 lineage 查询、不再 re-served。
3. **T2.3 compose**：`compose(request, { budget, policy })`→ 冻结 `ComposeResult`（`{ sessionId, phase, generation, observedAt, budget, nodes, dropped, sources }`，节点无 content 字段——元数据投影，最小暴露）；**投影纯度**：compose 绝不写引擎状态、绝不触发 retry/route/approval/mutation/prompt 注入旁路（CP-3.1/CP-10.2/api-shape §1），graph 内节点按派生分类报告 `served`；engine 仅保留每 session 最近一次 graph 快照（latest-wins，用于 inspect 的 served 派生与分页）；scope 解析失败 → `COMPOSE_SCOPE_UNRESOLVED`；入口/出口检查 AbortSignal → `COMPOSE_ABORTED`；排序按 T1.2；预算按 T1.3（未用预算 → `budget.applied: false`）；过期节点（expiresAt 已过）不进 served 并记 dropped reason `expired`（CP-4.3，派生、不写节点）。
4. **T2.4 compose policy 瀑布**：`policy.register(fn, { name?, priority? })` → disposer；fn 为纯函数 `(eligibleNodes, requestContext) => eligibleNodes`（只读输入、显式传入、无副作用）；compose 决策点按 priority 有序求值（`api-shape.md` policy 面：单一 register 入口、决策点调用、结果幂等收敛）；**单个策略抛错只降级该决策点**（跳过该策略继续瀑布，记录 degraded 证据），绝不失败整个 compose（CP-3.4）。
5. **T2.5 inspect 投影**：`inspect(sessionId, { limit?, cursor?, audience?, signal? })`→ 冻结 `InspectResult`（`{ sessionId, served: [{ node, reason }], archived: [...], dropped: [...], truncated, nextCursor, unavailable? }`）；分页有界（limit 默认 50、上限 200），超出 → `truncated` + `nextCursor`，绝不伪造历史（CP-6.2）；session 缺失/越界 → `INSPECT_UNAVAILABLE`（不披露越界会话存在性，CP-6.4）；audience 包络逐节点强制（默认 deny，CP-8.2）；**取消语义（CP-9.1 的 inspect 臂）**：inspect 为同步内存投影（`concurrency-and-cancellation.md` §8 声明适用边界），入口检查可选 `signal`，已中止 → 冻结 `{ sessionId, aborted: true, reason }` typed aborted 结果、不触碰任何状态。
6. **T2.6 replacement mapping**：`mapping(query)`→ 冻结只读视图（CP-7.2）；compaction 来源缺失 → `MAPPING_UNAVAILABLE`，绝不伪造（CP-7.3）；bounded（每条 mapping 记录生成序，历史 ≤ 200 条，超界截断并附 truncated 元数据）。
7. **T2.7 observer epoch**：`observe(listener)` → disposer；listener 收到冻结快照（节点状态转移、evidence 应用、mapping 登记的变更通知）；dispose 后旧回调失去发布资格（stale-callback guard，CP-9.3/`concurrency-and-cancellation.md` §4）；epoch 替换按 identity。
8. **T2.8 evidence→sent 迁移**：engine 接收 `assembled-evidence` 归一记录（来自 sources 层）：`systemSections[].sectionKey` 匹配 `systemPrompt` 来源节点 → `sent`（`sentBy: { evidenceId, observedAt }`，evidenceId 取证据 generation 字符串）；`messageRanges` 匹配 `sessionSurface` 来源节点（sourceEventSeqs ⊆ 某 range）→ `sent`；`dropped[].ref` 匹配节点 → 记 dropped reason（该 ref 未进入请求，CP-5.5 未匹配贡献保持各自记录）；evidence 缺席/切片未激活 → 节点上限 `served` + `served ≠ sent` 披露（CP-5.4，availability() 报告 `sentReachable: false`）；迟到/旧代 evidence（generation 落后于该 session 已应用的最新 evidence）→ 不重写已终态节点、只作 diagnostic 保留（CP-5.6）；evidence 记录 bounded ring（evidenceRingLimit 默认 200，`design.md` AssembledEvidenceRecord 内存冻结快照，不承诺 durable）。
9. **T2.9 会话节点边界与 dropped 词汇**：每 session 注册节点上限常量 `MAX_NODES_PER_SESSION = 1000`；超限时最老 `contributed` 节点转 dropped（reason `registry-capacity`，注册路径的容量簿记、**不是 compose 副作用**），不伪造 archive/终态（bounded 内存、无 harness 生命周期泄漏）；`dropped` 是逐节点原因记录（inspect dropped bucket），不是第六态。
10. **T2.10 清理**：`dispose()` 幂等；observer、policy、注册表按 identity 清理；已 dispose 的 engine 上下文后续调用返回 typed `INACTIVE`（不抛穿 apply）。

**测试**：`test/context-engine.test.mjs`（六态转移与 reason 记录、superseded lineage、不可逆状态不可重写、compose 确定性/预算/策略瀑布与单策略降级、compose 与 inspect 的 AbortSignal 取消路径、inspect 分页与越界、redacted 排除于 served/受众 deny/REDACTION_FAILED fail-closed 三条断言、mapping 有界、observer epoch 与 stale guard、evidence→sent（含匹配/不匹配/迟到/旧代/缺席五种路径）、容量 dropped、dispose 幂等；注入 fake `sources`/`now`/`idFactory`，零 harness 依赖）。

### T3 来源适配 `lib/context-sources.js`（CP-2/5/7；A 类直通 + B 类委托已交付投影）

1. **T3.1 systemPrompt adapter**：消费官方 `ctx.systemPrompt` 已稳定化服务与 `renderContextSnapshot`/`joinContextSections` 直通（A 类），产出 sectionKey/sourceTags 贡献元数据（assembly 的 sections/contexts 名称即 sectionKey；sourceTags 只承载来源可见元数据，不合成）；服务缺失 → `SOURCE_UNAVAILABLE` 只降级本来源。
2. **T3.2 sessionSurface adapter**：消费 session surface 上屏 intent（`surfaceOp`/`sourceEventSeqs`，底层官方 `Session.append` 语义），产出有界 `sourceEventSeqs` 引用；不合成 source 未提供的序号（CP-2.2）。
3. **T3.3 attachment adapter**：消费已交付 attachments 投影 `projection.provenance`/`project`（A 类消费）；marker 缺失 → `SOURCE_UNAVAILABLE`。
4. **T3.4 toolExposure adapter**：消费已交付 `toolDiscovery` 投影（B 类消费）；缺失 → `SOURCE_UNAVAILABLE`。
5. **T3.5 skillExposure adapter**：消费 Wave A `skills.activation` 的 SDA-5 Exposure record 与目录 notice `source.kind`（`skill-catalog` / `skill-catalog-update`），按冻结词汇归一为贡献元数据（CP-2.3）；`skillsActivation` 未激活/缺席 → `SOURCE_UNAVAILABLE` 只降级（软性来源）。
6. **T3.6 compaction adapter**：消费已交付 compaction 事件词汇（facade events 面 `compaction/*`）与 durable 标记 → replacement mapping 记录（CP-7.1）；事件面缺失 → `SOURCE_UNAVAILABLE`/`MAPPING_UNAVAILABLE`。
7. **T3.7 assembledEvidence adapter**：订阅 R 切片自发射事件 `agent-loop/assembled-context`（原始 ctx.on，R 行自发射惯例，同 `mcp/catalog-changed`）；探测证据切片 marker/版本门（见 T4/T5），切片缺席/停用 → `EVIDENCE_UNAVAILABLE`（`sent` 不可达、`served` 上限披露）；证据归一后交给 engine（T2.8）。监听器抛错吞掉并记诊断，绝不中断事件分发。
8. **T3.8 memory 可选来源**：仅接受经 contribution 元数据声明的来源（无专用 facade 依赖，CP-2.4）。
9. **T3.9 per-source 降级**：单来源组装失败 → `SOURCE_DEGRADED` 只留 degraded 证据、graph 其余照常（CP-2.5/CP-9.4）；`availability()` 逐来源报告（available/unavailable/degraded + `sentReachable`）。

**测试**：`test/context-sources.test.mjs`（fake systemPrompt / session surface / attachments 投影 / toolDiscovery / SDA-5 exposure（冻结词汇正反例）/ compaction 事件流 / evidence 事件流；per-source 降级矩阵；memory 只认元数据；`availability()` 逐源报告；监听器异常隔离）。

### T4 R 证据切片（`packages/agent-loop/` 扩展，CP-5；同一官方组件第二能力，capability-strategy §4.1/R2）

1. **T4.1 证据切片模块** `packages/agent-loop/lib/evidence-slice.js`：证据构造/冻结/发射纯逻辑——`buildAssembledEvidence({ sessionId, generation, assembly, surfaceNodes, now })` 产出 frozen payload `{ sessionId, generation, systemSections: [{ sectionKey, sourceTags }], messageRanges: [{ fromSeq, toSeq, count }], dropped: [{ ref, reason }], observedAt }`：
   - `systemSections`：assembly.sections + assembly.contexts 中插值后非空者（sectionKey=name；sourceTags 只放可观测标签，无可观测标签为空数组，不合成）；
   - `dropped`：插值后为空文本的 section/context name（reason `rendered-empty`）；
   - `messageRanges`：取 session surface 上能派生消息的事件 seq（`session.deriveEventMessage` 非空的 surface 节点），连续 seq 分组为 `{ fromSeq, toSeq, count }`；
   - payload 只含标识符/序号范围/原因，**不含 content、不含 secret**（CP-5.3/CP-8）；observedAt 为发射时 ISO 时间。
2. **T4.2 发射点接线** `lib/forked-loop.js`（仅新增证据发射，不改变组装/决策/route-policy 语义）：在 `step()` 的 `const system = renderPrompt(assembly)`（等价官方渲染点）之后、`buildRequest`/dispatch 之前发射一次冻结证据；generation 为 loop 实例内 per-session 递增 opaque token（owner-specific，从 1 起）；发射异常被 try/catch 吞掉并记诊断日志，**绝不**影响请求组装与发送（evidence-only 铁律）；既有代码路径零改动（逐行 review 确认只插入新语句）。
3. **T4.3 能力 marker 与 boot 自检扩展** `lib/apply.js`：
   - 新能力 marker `Symbol.for('dsh-plugin-api.agent-loop.assembled-evidence')`（中立名，contract §2；组件级符号 `dsh-plugin-api.agent-loop.contract` 与 route-policy 符号**不变**）；
   - forked AgentLoop 服务实例挂接证据能力标记（additive，不改变既有 `ROUTE_POLICY_COMPONENT_SYMBOL` 与 route-policy 契约面）；
   - apply() 自检矩阵扩展：注册后探测证据能力标记与发射接线可用；**证据能力缺失只降级证据**（记录日志、正常 return，route-policy 照常）——不因证据问题整体回退（R4 语义：证据为 additive capability，boot 自检失败 = fail-safe 停用该能力而非整行）；版本锁定/owner 冲突检测沿用既有实现（R5/R6，不新增组件符号、不修改既有检测路径）；
   - `fullVersionContractsMatch` 等既有导出契约不变（既有 `test/agent-loop-replacement.test.mjs`、`agent-loop-fork-integrity.test.mjs` 冻结零改动）。
4. **T4.4 契约复刻保真**：切片不得改变既有 `ctx.agentLoop` 服务/事件面、route-policy 语义、settings/system-prompt 变量与 teardown 契约（R2/R3）；不覆盖 `@deepseek-ai/dsh-agent-loop` import 面（R3）；不注册主 facade events catalog slice（证据事件为 R 行自发射，`mcp/catalog-changed` 惯例，design.md「Non-Goals」）。
5. **T4.5 既有契约零回归验收**：证据切片为 additive 能力——不改 route-policy 决策语义、不改既有 fork 代码路径（逐行 review 确认只插入新语句）、不改既有包导出；冻结测试 `test/agent-loop-replacement.test.mjs` 与 `test/agent-loop-fork-integrity.test.mjs` 必须保持全绿（作为迁移验收项被 T6.5 引用）。

**测试**：`packages/agent-loop/test/evidence-slice.test.mjs`——construction/building 纯逻辑（payload 形状、无 content/secret 字段、ranges 分组、dropped 空节、sourceTags 不合成、frozen）；发射点等价性（fake assembly/surface 驱动 `buildAssembledEvidence` 与 forked-loop 接线探针）；发射失败不影响组装与 route-policy（注入抛错 listener/构造器，assert 原请求路径完成）；marker/版本门（apply 自检扩展的探测与降级路径）。

### T5 Host wiring（CP-10；guard 单 else-if 分支 + FEATURE_MOUNTERS + registry 键 `context`）

1. **T5.1 `lib/guards.js`**：新增 `'context'` 单 else-if 分支——mandatory 探针：`systemPrompt.service`（section/context/variable/tools/suppressRuntimeContext 形状）、sessions 服务（get/list，session surface 助手依赖）；软性来源（attachments marker、compaction 事件词汇、toolDiscovery、skillsActivation、evidence 切片 marker）**不设 guard 门**，于挂载期探测并在 `availability()` 逐源降级（design.md Failure Paths 1：软性缺失只降级对应 source，不整 feature 失效）；guard 失败 → 挂载 disabled 面（typed `INACTIVE`），绝不抛穿 apply（AGENTS.md §2.6 fail-safe）。
2. **T5.2 `lib/plugin-api-service.js`**（只加本 feature 挂载点，不触既有）：`KNOWN_FEATURES` 增 `context`；`createDisabledContextApi(active)`（typed disabled 面：contribute/compose/inspect/mapping/observe/availability 全抛 `PLUGIN_API_FEATURE_DISABLED`/`PLUGIN_API_INACTIVE`，与既有 disabled 面同构）；构造器定义 `pluginApi.context` getter（slot 挂载前返回 disabled 面）；`_assignFeature('context')` 槽（方法契约校验：contribute/compose/inspect/mapping/observe/availability）；`_readSlot('context')`、`_disabledSurfaceFor('context')`、`unmountFeature('context')`。
3. **T5.3 `lib/index.js`**：新增 `mountContextFeature({ ctx, service, featureRegistry, logger })`——构建 sources（T3，含 evidence 订阅与 marker/版本门解析）、构建 engine（T2，注入 sessionResolver：复用 execution-observation correlation，缺省回退 `session.requestContext()`，失败 typed `INSPECT_UNAVAILABLE`；`plugin-diagnostics` 归因经 `reportDiagnostics`）、`service.prepareFeature('context', api)` 挂载（fail-safe：任一依赖失败 → typed disabled 面，不抛穿 apply 不杀 boot）；FEATURE_MOUNTERS 增 `['context', mountContextFeature]`（置于 `toolDiscovery` 之后，注释注明 contract 顺序 `skillsActivation` → `context` 由 integration 合并保证）。
4. **T5.4 边界纪律**：不新增 client remote/slot/settings 面（host-only，CP-10.3/design Host/client boundary）；不注册 events catalog slice（冻结文件零改动）；不跨组件 R replacement（唯一 R 切片仍在 `dsh-agent-loop` 组件内，CP-10.4）；compose 结果零副作用（CP-10.2）。

**测试**：`test/context-guard.test.mjs`（guard 探针矩阵：mandatory 缺失 → feature disabled；软性来源缺失 → feature 仍 active；`DSH_PLUGIN_API_GUARD_DISABLE=1` 跳过语义）与 `test/index-context.test.mjs`（全量 apply 挂载：mock host（同 `index-tool-discovery.test.mjs` 模式）驱动 context 挂载、`pluginApi.context` 面形状与 disabled→active 迁移、sources 降级组合（skillsActivation 缺席等）、evidence 事件流端到端（fake R 行发射 → sent 迁移）、disposer 清理、unmount 恢复 disabled 面）。

### T6 交付验证与收尾（Stage 4 全局终审前置）

1. **T6.1** 统一 `npm test` 全绿（**勿用裸 `node --test`**；4G 内存护栏由 `npm test` 内联，超限先修测试不调阈值）。
2. **T6.2** `git diff --check` 通过；官方包零修改核实（`git status` 无 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 变更）。
3. **T6.3** 治理 token 审计干净（`governance-token-audit.test.mjs` 覆盖新文件：无 B/R 分类字母、无 CP-* 需求编号、无 SPEC/工作流代号、无 `r1` 后缀、无 `A-class` 等）。
4. **T6.4** spec 一致性回读：本文逐项勾选完成状态；实现中发现的 spec 冲突就地修订 requirements/design/tasks 并在最终报告列出；确认未越 contract 边界（版本不 bump、`feature-list.md` §7 与 U18/U19 状态由 integration owner 统一、不新增 catalog slice、对方 feature 文件零改动、既有测试零改动）。
5. **T6.5** 迁移验收适用性（AGENTS.md §5 / §3.4）：本 feature 无「被替换 hack」的外部插件迁移对象（全新能力，非既有 hack 转译）；其等价迁移验收为——既有 agent-loop replacement 契约（route-policy 语义、`ctx.agentLoop` 服务/事件面、boot 自检矩阵、版本锁定）在证据切片扩展后零回归（冻结测试 `test/agent-loop-replacement.test.mjs` / `agent-loop-fork-integrity.test.mjs` 保持全绿即验收项，T4.5）与 U-series 退役条件的登记口径（CP-5.7：feature 交付时 U19 上游提案状态由 integration owner 统一更新，本线只保证 spec 内登记口径一致）。
6. **T6.6** 阻塞式**全局终审**（只读对抗性子代理，`run_in_background: false`，AGENTS.md §3.2 Stage 4）：核对交付物与 Tasks/Design/Requirements 一致性、按 `docs/standards/` 适用分册比对规范符合性、contract 边界遵守；「无偏差」后完成 **Stage 4 完成提交**（实现 + 测试 + spec 产物；先 `git diff --check`），随后交付结果报告并清理 worktree 至干净状态。

## Requirements Coverage

- CP-1 → T1.1/T2.1；CP-2 → T3（七来源 + memory）；CP-3 → T1.2/T1.3/T2.3/T2.4；CP-4 → T2.2/T2.3；CP-5 → T4（+ T2.8/T3.7）；CP-6 → T2.5；CP-7 → T2.6/T3.6；CP-8 → T1.1/T1.4/T2.5（默认 deny/fail-closed）；CP-9 → T2.3/T2.5/T2.7/T2.8/T3.9；CP-10 → T5。