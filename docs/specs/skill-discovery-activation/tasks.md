# Stage 3 - Tasks

## Status

SPEC3（M6 第六批次 Wave A，`feat/m6-skill-activation`）。承接已获批的 Stage 0–2（d7ab9fe）。本阶段不设用户确认门，以对抗性审查为门；审查返回"无偏差"后直接进入 Stage 4 自主执行。

执行载体：`temp/m6-batch6-contract.md`（Wave A 分工、命名规范、共享文件编辑边界、冻结文件、Schema 词汇、失败呈现路径、合并顺序）。冲突时以本 tasks 的"执行决议"为准并上报。

## 1. 执行决议（对抗性审查重点核对对象）

下列决议把已获批 Design 落到可执行形状；任何一条被审查否决即修订后再派审。

### 1.1 命名映射（契约 §2 vs 已获批 Design）

- **feature key / guard 分支 / FEATURE_MOUNTERS 键 / KNOWN_FEATURES 键 / registry 键统一为 `skillsActivation`**（契约 §2 Wave A）。
- **公开面命名空间遵循已获批 SDA-5.2 / Design §Components**：`pluginApi.skills.activation`（主门面条件投影 = 新增顶层 `skills` 命名空间下的 `activation` 子面，投影 `ctx.skillActivation`）。先例：`sessionBranch`（registry 键）→ `pluginApi.session.branches`（公开面），registry 键与公开面命名空间本就不同物；SDA-5.2 是已批准验收标准，不以契约简称为准改写。
- 替代行：行 id `plugin-api-tool-skill`，包名 `@deepseek-ai/dsh-plugin-api-tool-skill`，ctx 服务名 `skillActivation`，契约符号 `Symbol.for('dsh-plugin-api.tool-skill.contract')`（标记挂在 `ctx.skillActivation` 服务对象上；主门面经 `ctx.get('skillActivation')` + 符号探针解析）。
- FEATURE_MOUNTERS 插入位：`skillsActivation` 在 `toolDiscovery` 之后、`profile` 之前（契约 §3 固定顺序 + `index-profile` 既有"最后一项为 profile"断言）；guards else-if 分支紧随 `toolDiscovery` 分支之后（单 else-if）。
- 实现代码禁治理魔法字母（契约 §2）：spec 编号/工作流代号/分类字母不进 `lib/`、`packages/`、`test/`、`package.json`、patch 与运行时字符串；`test/governance-token-audit.test.mjs` 全量扫描通过。

### 1.2 失败呈现映射（契约 §6，typed 结果包络）

统一 typed 结果形状（跨 API 不抛穿插件回调）：`{ ok: true, ... }` / `{ ok: false, code, reason }`，返回对象冻结；`ctx.skillActivation` 各方法返回该形状。主门面 `pluginApi.skills.activation` 在不可用/版本失配时按既有惯例抛 typed `PluginApiFeatureDisabledError('skillsActivation')`（与 `pluginApi.session.branches` 一致），`availability()` 永不抛。

| 情形 | code |
|---|---|
| descriptor/registerSkill 输入校验失败（含非法 skillId、owner、summary>200、capabilities>16、sourceKind 非法、auto-match/provider-sourced 缺声明条件、tools/promptSections/resources 引用形状非法） | `SKILL_REGISTRATION_INVALID` |
| 同 skillId 已由其他 owner 注册 descriptor（所有权冲突） | `SKILL_ENTRY_CONFLICT` |
| skillId 不是官方 registry 身份（list/snapshot 不可解析）或无 descriptor 的 activate | `SKILL_ENTRY_UNKNOWN` |
| descriptor 已 dispose / registerSkill 句柄已 dispose 后调用其 activate | `SKILL_ENTRY_DISPOSED` |
| descriptor 状态为 failed（激活期官方 registry 校验失败后被标记）后的 activate | `SKILL_ENTRY_FAILED` |
| activate/deactivate/policy 输入中 scope 缺失或不可解析（含注册 minimal-update 政策时缺 scope） | `ACTIVATION_SCOPE_UNRESOLVED` |
| activate 输入其余字段非法（ttl 非正整数、sourceKind 非法、缺 condition、condition 与声明不符） | `ACTIVATION_INVALID`（本命名空间新增；契约 §6 清单为协调词汇，共享词与"不新增对方命名空间"约束照守，新增点在本 tasks 显式记录供审查） |
| 激活请求的 skill 在官方 registry 中已不可解析（descriptor 存在但 registry 丢失条目） | `ACTIVATION_DEGRADED`（degraded part=`registry`，不建空激活壳） |
| registry 校验在可选 `deadline` 内未完成（1.3.14） | `ACTIVATION_TIMEOUT`（timeout 归 `error` 语义，不落 mutation、无新终态词汇） |
| 激活成功但携带降级（依赖缺失等） | 激活结果 `ok:true` + `degraded:[{part,reason}]`（见 1.3） |
| 同 (skillId, scope) 新激活取代旧激活 | 新激活 `ok:true`；旧 generation 终态 `superseded`（audit 记 `supersede`） |
| deactivate 传 stale/foreign generation 或 scope 与记录不符 | `DEACTIVATE_STALE_GENERATION` |
| exposure 传 stale/foreign generation | `EXPOSURE_STALE_GENERATION` |

> 码表对齐注：契约 §6 列出的 `ACTIVATION_SUPERSEDED`、`ACTIVATION_EXPIRED` 仅作**激活记录状态词汇**（1.3.5 state 字段）与 audit kind，不作为本表返回码（supersede/expire 以状态 + audit 呈现，不产生 typed 拒绝）；`ACTIVATION_TIMEOUT` 为本表返回码（1.3.14）；`ACTIVATION_INVALID` 为本表新增码（1.2 表格，design 未列——design Error Handling 的 typed 码清单将在 9.3 一并修订：superseded/expired 移出返回码语义、增列 ACTIVATION_INVALID）。
| 替代行失配自检失败（主门面投影不可用） | `UNAVAILABLE`（主门面 `availability()` 报告） |
| 替代行未激活（official 行在位未禁用、重复插入、身份失配且无法安全回退） | `INACTIVE`（主门面 `availability()` 报告） |
| skill 工具加载门控拒绝（含 fail-closed） | 抛 `Error`（code 属性 `SKILL_LOAD_DENIED`，message 含原因；保留官方抛错机制与渲染面） |
| pre-step 注入门控跳过 | 静默跳过 + owner 归因诊断（不注入、不改 decision；`INJECTION_SKIPPED` 不出现在消息面） |

诊断归因：替代行经 `ctx.logger` 以 `tool-skill:` 前缀 + owner id 入文案；主门面投影经门面 logger 归因 `dsh-plugin-api`。任何失败不抛穿插件回调、不抛穿 apply。

### 1.3 语义决议（design 未逐字铺开处）

1. **descriptor = 激活政策覆盖层**（SDA-0）：descriptor 只对注册了它的 skill 生效；**无 descriptor 的 skill 保持官方静态行为**（三个路径完全 parity）。descriptor 内 `skillId` 即官方 registry 的 skill name（`isSkillName` 语法 + registry 解析双重校验）。
2. **descriptor 数据模型**（按 Design Data Models 落定）：`{ skillId, owner, summary(≤200 必填), capabilities(≤16 可选), sourceKind(默认 'userInvocable'), activationSource({kind:'auto-match'|'provider-sourced', condition}，sourceKind∈{auto-match,provider-sourced} 时必填且同 kind), dependencies(可选 skillId[]), tools(可选 [{entryId,generation?}]), promptSections(可选 string[]), resources(可选 [{resourceId,metadata?}]), generation(owner opaque token), state:'registered'|'failed' }`。
3. **Activation 输入**：`{ scope:{kind:'session'|'agent'|'turn', key}, reason?, ttl?(正整数 ms), sourceKind?(缺省=descriptor.sourceKind), condition?(auto-match/provider-sourced 必填且须等于 descriptor.activationSource.condition) }`。
4. **scope 解析**：调用侧 key 必填（'session'/'agent'/'turn'）；门控侧 'session'→`agent.session.header.id`、'agent'→`agent.id`（运行时 `agent.id === agent.session.id`，官方 1:1）；'turn' 在门控边界无 turn token seam，**turn 范围激活按 SDA-2.4 fail-closed**（记录、可被 exposure/audit 查询，但不出现在三路径；typing 为已记录激活 + 门控降级诊断，不做猜测）。
5. **ActivationRecord**：`{ skillId, owner, scopeKey, sourceKind, reason, ttlMs?, expiresAt?, generation, state:'active'|'degraded'|'expired'|'superseded', degraded:[{part,reason}] }`；TTL 到期为惰性转换（门控查询时检查 `expiresAt < now` → state `expired` + audit `expire`），activations 为 session 内内存态（不声明 durable）。
6. **降级与门控**：激活时 registry 不可解析 → 不建壳（`ACTIVATION_DEGRADED`，part=`registry`）；声明依赖缺失 → 建壳且 state `degraded`，degraded 含 part `dependencies`。**任何 state ≠ 'active' 的 skill 在三路径全部不可见**（"not degraded for catalog purposes" = 仅 state`active` 可进目录；degraded 的 part 列表仍随 exposure 查询可见）；explicit 类 skill 的加载门要求激活本身 sourceKind=`explicit`（SDA-3.2），且 pre-step 注入永跳过；无 descriptor 的 skill 不受门控影响（parity）。
7. **tools 委托（SDA-6）**：descriptor 的 `tools` 是声明式引用（插件已通过 `pluginApi.tools.discovery` 自注册后把 `entryId` 给我方）；替代行零主门面依赖（Design §Components），不探测 tools.discovery、不维护第二目录；exposure 在激活期间携带引用、deactivate/过期后从新 exposure 撤回（SDA-6.3"withdrawn for new exposures"）；tools/promptSections/resources 引用形状非法 → 注册期 typed 拒绝；激活后引用 map 为空 → 相应 part 不进 degraded（声明与内容 owner 分离，不伪造不可观测的降级）。**对 SDA-6.2 的收敛决议（显式记录）**：替代行结构性无法观测 `tools.discovery` 可用性（零主门面依赖），"tools.discovery 不可用/委托条目失败 → only tools portion degrades (typed unavailable)"由以下机制承担：插件侧注册/委托失败 → 不向 descriptor 声明引用（声明侧收敛）+ exposure 的 tools 部分随激活撤回（视图侧收敛）；替代行不伪造其不可观测的降级。
8. **minimal-update 政策**（SDA-C2）：`policy.registerMinimalCatalogUpdate({ scope })`（kind 限 `session`，key 必填 → 归一为 session scopeKey），返回 `{ ok:true, dispose }`；dispose 幂等；同一 scope 重复注册 latest-wins（旧 disposer 变 no-op）；scope 缺 key/kind 非 session → `ACTIVATION_SCOPE_UNRESOLVED`。**对 design 签名 `registerMinimalCatalogUpdate(scope?)` 的收敛**：政策必须 per-session（C2 语义），可选 scope 收敛为必填 `{kind:'session', key}`；该收敛在 9.3 就地修订 design 措辞。
9. **目录告知**（SDA-C1/C3）：首发布（`history.published === false`）恒为官方全量目录消息（`source.kind:'skill-catalog'`）；后续 digest 变化且无政策 → 官方全量 replacement 语义（`renderCatalogUpdate` 形状，`source.kind:'skill-catalog'`, `update:true`）；有政策 → 英文最小更新单条 CONTEXT（`source.kind:'skill-catalog-update'`，模板见 SDA-C2.1 三句式，聚合一行一条，changed 的 summary 用 `catalogDescription` 截断到 `min(catalogDescriptionMaxLength, 200)` 与 descriptor summary 上限对齐）；无有效变化 → 不注入（C1.3）。digest/历史机制为官方复刻：digest 只覆盖 `[name, description]`；invocation 政策使目录成员变化 → 表现为 added/removed（有效目录流即告知流，"policy change → changed 句式"落在 description 变化的 changed 句上）。
10. **消息替换语义**（SDA-C3.2/C4）：`skill-catalog-update` 消息的 `source.entries` 携带**全量有效条目**（元数据，非渲染文本），保证同 digest 幂等、跨轮次 delta 重算与政策 dispose 后的回落；fork 的 `catalogMessage`/`catalogHistory` 在官方只认 `skill-catalog` 的基础上扩展同时认 `skill-catalog-update`（无 update 消息时行为与官方逐字一致，parity 由测试证明）；delta 计算失败/注入抛错 → 回退默认全量重发 + owner 归因诊断，不改变 decision.kind、不破坏消息数组（SDA-C4/C2.5）。
11. **registerSkill 语法糖**（SDA-10）：组合顺序恒为 官方 `ctx.skills.register({name, description:summary, content, invocation 缺省官方默认})` → descriptor overlay；官方 first-wins（warn + no-op disposer）逐字透传，不伪造所有权；可选 `activation` 立即应用，**激活失败 = 整调用 typed 失败并回滚两半**（不留"半注册"可见状态；无 activation 时注册成功即 inactive、可描述）；`dispose()` 双半幂等、identity-bound、重复 no-op；官方内容注册抛错 → typed `SKILL_REGISTRATION_INVALID`（不 overlay）。
12. **audit**（SDA-8）：环形上限 500（设计 Data Models），记录 `{ seq, at(ISO), kind, skillId, owner, sourceKind, reason, generation }`，kind ∈ register/unregister/activate/deactivate/degrade/expire/supersede/catalog-change；`audit({limit=50})` 返回冻结数组（最新在前，limit 夹取 1..500）；auto-match/provider-sourced 激活在 reason 缺省时记录 `condition:<value>`；存储失败（环形分配异常）→ 显式 typed 报告、生命周期继续。
13. **availability()**（SDA-9）：`{ active, versionMatch, officialRowDisabled, replacementActive, seams: { skillTool, preStepInjection, catalogProvider } }` 全部来自自检矩阵真实结果，冻结，不伪造；exposure 内 `availability` 为 `{ status(记录 state), degradedParts, seamStatus(全局 seams 投影) }`。
14. **激活超时（SDA-1.5）**：激活是同步纯状态机 mutation；唯一异步步是 wiring 层的官方 registry 校验（`ctx.skills.list`）。`activate` 接受可选 `deadline`（正整数 ms，默认无）；registry 校验在 deadline 内未完成 → typed 结果 `{ ok:false, code:'ACTIVATION_TIMEOUT', reason:'timeout' }`（identity-and-lifecycle：timeout 归 `error` 语义，不新增终态词汇，state 不落任何 mutation）；deadline 只约束校验步，不改变引擎同步性。测试经注入的慢 registry resolver + 时钟验证；无 deadline 时永不触发。
15. **官方回退（SDA-R5 fail-safe）**：身份失配且 official 行已 disabled 时，替代行 import 并运行官方 `@deepseek-ai/dsh-tool-skill` 的 apply（官方包 import 面保留，R3）恢复官方行为，扩展面（ctx.skillActivation + 门控）不发布；官方 apply 抛错 → 记录诊断并静默 inert。official 行 enabled → 我方不注册任何东西（绝不双跑）。
16. **主门面版本门控**（SDA-5.2）：辅助包版本/协议与主门面 facadeContract 失配或缺失 → 仅停 `pluginApi.skills.activation` 投影（typed disabled surface），主门面与其他能力不受影响；投影只转发、不维护第二状态机（api-shape projection 面）。
17. **诊断归因通道决议（design 内部矛盾就地修订）**：design 架构图出现 `SA --> DG[plugin-diagnostics 归因]`，但 design §Components 硬约束"零主门面依赖"，且已核实 `pluginApi.diagnostics` 是主门面命名空间、无 ctx 级服务面可经零依赖解析——替代行诊断**经 `ctx.logger` 归因（`tool-skill:` 前缀 + owner id 入文案）**为主通道；主门面投影侧诊断经门面 logger 归因 `dsh-plugin-api`（未失配时投影可用，与替代行同 owner）。9.3 就地修订 design（仅为架构图 `SA --> DG[plugin-diagnostics 归因]` 一处；design Failure Paths 第 4 条与诊断归因无关，不改）。
18. **目录失效机制决议（design 陈述修正）**：已核实官方 `dsh-tool-skill` 全文**无 `skills/change` 监听**，目录失效由每轮 pre-step 的 digest/历史机制承担——本线 fork 按官方逐字复刻（无 epoch 监听）；design 中 skills/change 驱动失效的陈述共 **4 处**一并失实，9.3 全部修订：① 数据流图 `S --> EV[skills/change → 失效 epoch]`；② §数据流句 "skills/change / activate/deactivate → 状态机 mutation…"；③ 失败路径"官方 skills/change 监听器与 pre-step 钩子内部异常全部吞掉（官方语义：监听器失败不得否决注册表变更/决策流）"；④ Hook Extraction Summary（§2.5 强制表）"目录失效通知 | A | 官方 skills/change 事件绑定"——该绑定不存在，本 feature 的目录告知/失效由替代行 digest 机制承担（R 通道），修订时同步调整强制表归属。

### 1.4 与冻结共享断言的边界（契约 §3/§7，全量枚举）

- 本线只新增自己的前缀测试（`test/skill-activation-*.test.mjs`、`packages/tool-skill/test/*.mjs`）；不修改任何既有 `test/`、`packages/*/test/` 文件。
- 新增 feature 键 `skillsActivation`（插入 `toolDiscovery` 与 `profile` 之间：契约 §3"skillsActivation 在 toolDiscovery 之后"，且冻结测试多处把 `profile` 钉为"最后一个 FEATURE_MOUNTERS 条目"，故 profile 保持末位锚点；`index-profile` 的 last-pin 保持绿）使 feature-registry snapshot 恰好多一项。下列**既有**断言在本线 worktree 中必然偏移（已逐一读码核实；属 integration owner 的"共享断言增量维护"范围，本线不修，完成后逐条移交）：
  1. `features.length===27` 计数断言（9 处 length 计数 + 1 处可见绝对索引 pin，合计 10 处需更新）：`index-agent`（973/1028）、`index-events`（162/226）、`index-session`（185）、`index-system-prompt`（107）、`index-tools`（142/184）、`index.test`（197 计数 + 227 附近 `features[26]===profile` 可见 pin）。另有 5 处同型绝对索引 pin（`index-events` 203/269、`index-tools` 156/189、`index-system-prompt` 126 的 `features[26]===profile`）被同测试**前置 length 断言先行遮蔽**（length 失败即中断，不会产生独立失败；length 更新后自然随之更新），不单独枚举。
  2. 全序 name-list deepEqual（6 处）：`index-agent`（125 附近）、`index-session`（119/163/186 附近）、`index-session-durable`（110–140 附近）、`index.test`（healthy-apply 段）。
  3. 尾部负偏移 pin（契约所称 remote-last，22 处）：`index-remote`（97–105 附近 `names[length-10..-2]` 9 个 pin）、`security-policy-assembly`（70–78 附近 9 个 pin）、`index-diagnostics`（57–60 附近 `indexOf(diagnostics)===length-5` 等 4 个 pin，`length-1===profile` 保持）。
  4. host-boundary face 比对（契约所称 host-boundary，1 处）：`official-passthrough-independence`（254–266 附近 `BRANCH_ADDED_FEATURES` 未含 `skillsActivation` → current/boundary face 不等）。
  - 合计 11 个文件受影响；`index-profile` 保持绿（插入在 profile 之前）。
- Stage 4 验收 = 本线新增测试全绿 + `npm test` 除 §1.4 全量枚举的冻结断言失败外全绿 + 治理审计干净 + `git diff --check` 干净 + 官方包零修改。完成报告必须逐条列出（文件+断言形状+数量）并移交 integration owner；integration owner 负合并期同步修订义务（§3：共享断言增量维护）。
- 以下属于 integration owner 交付范围，本线不执行：full bundle patch 第 8 块、版本统一（任何版本号不 bump）、`feature-list.md` §7 登记与 U18 状态更新、共享断言增量、FEATURE_MOUNTERS 顺序终校验。SDA-R7（U18 登记 + 退役条件）已存在于 `feature-list.md` U18 行（d7ab9fe 前已登记），本线只在报告确认其存在并指向退役条件。

## 2. 任务清单

> 按依赖排序；每个任务含：目标（写/改/测）、子要点、验收对应需求编号。全部任务完成后按 AGENTS.md §3.2 执行一次全局终审，通过后才提交与清理。

### 1. packages/tool-skill 骨架与官方回退依赖

- [ ] **1.1 创建 `packages/tool-skill/package.json` 与 `packages/tool-skill/cordis.patch.yml`**
  - package.json：`name: '@deepseek-ai/dsh-plugin-api-tool-skill'`，`version: '0.1.0-rc.6-0.6'`，`type: module`，`main: lib/apply.js`，`dsh.api: '0.6'`，`dsh.bundle.patch: './cordis.patch.yml'`，`peerDependencies`：`@deepseek-ai/dsh-tool-skill@0.1.0-rc.6`（唯一被替代 owner 包）、`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/schemastery`、`@deepseek-ai/cordis`（均为 `^0.1.0-rc.6`/`^3.18.1`/`^4.0.1` 同型）；`scripts.test = 'node --test'`；license MIT。
  - cordis.patch.yml：只含 `- id: tool-skill / disabled: true` + `- insert: [{ id: plugin-api-tool-skill, name: '@deepseek-ai/dsh-plugin-api-tool-skill' }]`（官方行 id/name 以 dsh-base patch 第 247 行为准）。
  - 注释写明 replacement boundary（只换 ctx 服务/事件面，import 面保留官方）。
  - `package.json.description`、apply 日志文案保持中立（仅表达能力/语义），**不含任何治理编号 token**（`governance-token-audit` 的 `\b[ABCRMDLTWFSUP]\d+…` 模式会扫描 description 与日志文案）。
  - 验收：SDA-R1/R3。
- [ ] **1.2 创建 `packages/tool-skill/lib/version.js`**（纯函数，零 harness 依赖）
  - 镜像 session-branch `version.js`：`LOCKED_RUNTIME_VERSION='0.1.0-rc.6'`、`LOCKED_OWNER_PACKAGE='@deepseek-ai/dsh-tool-skill'`、`parseFullVersion`、`fullVersionContractsMatch`、`runtimeIdentityMatches`（支持注入锁定值）。
  - 验收：SDA-R5（runtime+owner 全量 identity 精确匹配、方向②主门面协议比较的基元）。

### 2. 纯校验与 diff 基元（TDD）

- [ ] **2.1 实现 `packages/tool-skill/lib/skill-activation-normalize.js` 与测试 `packages/tool-skill/test/normalize.test.mjs`**
  - 纯函数：descriptor spec 归一（见 1.3.2 全字段校验）、activation 输入归一（1.3.3/1.3.4/1.3.5）、scope 归一（kind 枚举 + key 非空字符串）、registerSkill 输入归一（name/summary/content/capabilities/sourceKind/activation 半归一）、audit 查询归一（limit 夹取）、minimal-update 政策输入归一。
  - 返回 `{ ok:true, value }` / `{ ok:false, code, reason }`；不抛。
  - 测试覆盖每条非法路径的 code、边界长度（summary 200/201、capabilities 16/17）、condition 声明与 auto-match/provider-sourced 的绑定。
  - 验收：SDA-0/1/3/10/C2 的输入侧 + 契约 §6 映射。
- [ ] **2.2 实现 `packages/tool-skill/lib/catalog-diff.js` 与测试 `packages/tool-skill/test/catalog-diff.test.mjs`**
  - 官方复刻纯函数：`catalogDescription(value, maxLength)`（正则归一 + 截断 `...`，与官方逐字一致）、`digestCatalogEntries(entries)`（sha256 over `JSON.stringify([name, description])` 行）、`readCatalogEntries(source)`（含 entries 数组校验，非法返回 undefined；官方语义）、`renderCatalogEntries`-等价的行渲染器（`- \`name\`: escapedDescription`，escapeText 由 dsh-skill 提供）。
  - 扩展纯函数：`buildDelta(previous, current)` → `{ added:[{name,summary}], removed:[{name}], changed:[{name,summary}] }`（按 name 比对 description）；`aggregateNotices(delta, maxSummaryLength)` → 单条有界英文 CONTEXT 文本（SDA-C2.1 三句式、changed summary 截断 `min(maxLength,200)`、一行一条、空 delta 返回 null）与 `{ kind:'skill-catalog-update' }` 元数据辅助。
  - 测试：差量三型、同 digest 幂等（`digestCatalogEntries` 对同一 entries 恒定）、截断、空 entries、readCatalogEntries 非法源返回 undefined、notice 模板逐字断言。
  - 验收：SDA-C1/C2/C3（计算侧）。

### 3. 激活状态机（TDD）

- [ ] **3.1 实现 `packages/tool-skill/lib/skill-activation-engine.js` 与测试 `packages/tool-skill/test/engine.test.mjs`**
  - 纯状态机（注入 `now()`、`generateGeneration()`、`recordAudit` 侧写）；API：`registerDescriptor`/`unregisterDescriptor`/`activate`/`deactivate`/`exposure`/`audit`/`availabilityGates`/`activationState(scopeKey, skillId)`/`policyRegister(scopeKey)`/`policyDispose(scopeKey)`/`minimalPolicyFor(scopeKey)`/`recordCatalogChange`。
  - 语义按 1.3：latest-wins（同 (skillId,scopeKey) 新激活 → 旧 `superseded` + audit）、TTL 惰性过期（`expired` + audit）、降级（registry/dependencies part）、explicit 加载门判定（`loadGateState(scopeKey, skillId)` 区分 absent/inactive/degraded/explicit-only/ok）、descriptor 生命周期（register/unregister/dispose、同 owner 重注册 = 新 descriptor generation、他 owner 冲突）、audit 环形 500、冻结投影。
  - 测试：latest-wins 链、TTL 到期/未到期、scope 两个激活互不影响、degrade 三态、audit 环形裁剪与冻结、stale/foreign generation 的 typed 拒绝、explicit 类激活门、重复 policy 注册 latest-wins + disposer no-op、descriptor 冲突/同 owner 重注册、**激活超时路径（1.3.14：注入慢 registry resolver + deadline → `ACTIVATION_TIMEOUT`；无 deadline 不触发；超时不落任何 mutation/终态）**。
  - 验收：SDA-1/3/4/5/6/7/8/9 主体 + 契约 §6（SDA-6 由 1.3.7 决议：descriptor 工具引用进 exposure、deactivate/过期撤回引用、不越权注册第二目录）。

### 4. 三面保真复刻 + 门控插入（TDD）

- [ ] **4.1 实现 `packages/tool-skill/lib/forked-tool-skill.js` 与 parity 测试 `packages/tool-skill/test/forked-tool-skill.test.mjs`**
  - 以官方 `@deepseek-ai/dsh-tool-skill/lib/index.js`（0.1.0-rc.6）为逐字基线复刻三面：① `skill` 工具 `defineTool`（name/description/parameters/output.schema/render/presentCall 逐字段一致，execute 走 `ctx.skills.list/get` + `isModelInvocable` + lookup `{cwd, signal, scope}`，错误文案逐字）；② `agent/pre-step` 用户调用注入（`/name` gesture 扫描 `invokedSkillNames`、`createUserMessage` + `renderSkillContent` 注入、`isUserInvocable` 检查）；③ `agent/pre-step` 目录机制（snapshot.complete 门、`catalogSourceEntries`、digest、`catalogHistory`、`catalogMessage`、首发布 `renderCatalogMessage`、变更 `renderCatalogUpdate`、同 digest 清理/幂等、消息 id 替换语义）。
  - 组合形态：`createForkedToolSkill({ ctx, config, extension })`；`extension === null` 时三面为**官方逐字 parity**（门控/告知策略零插入）；`extension` 提供 `{ activationStateFor(agent, skillId), minimalPolicyFor(agent), recordCatalogChange(agent, kind), diagnostic(ownerId, detail) }`。
  - 两个 pre-step 监听器按官方注册顺序与错误文案注册；`ctx.on` 返回 disposer 计数（供 apply 自检探针）。
  - parity 测试（先证 parity 再证扩展）：fake ctx + fake skills/tools 下，无 extension 时（a）skill 工具 schema/output/render 形状与官方逐字段比对（官方基线以直接 import 官方 `apply` 注册的同一 fake ctx 为对照，两边产出 deepEqual）；（b）execute 的 list→get 解析、未知名/不可 model 调用错误文案逐字；（c）`/name` 注入与目录消息文本、source.kind/entries/update 标记、首发布 vs 变更消息逐字；（d）同 digest 幂等、visibleDigest 清理。
  - 验收：SDA-R2/R3（契约保真，先 parity 后扩展）。
- [ ] **4.2 门控插入实现 + 测试 `packages/tool-skill/test/gating.test.mjs`（并入 4.1 的组件）**
  - 目录过滤：官方 `snapshot.skills.filter(isModelInvocable)` 之后按 1.3.6 叠加门控过滤（无 descriptor → parity 直通；descriptor'd 且 state≠active → 排除；scope 不可解析 → fail-closed 排除 + 诊断）。
  - `skill` 工具 execute：官方 `isModelInvocable` 检查并列处插入激活门（descriptor'd：state≠active → 抛 code=`SKILL_LOAD_DENIED` 的 Error，message 含原因；explicit 类且激活非 explicit → 同拒绝；scope 不可解析 → fail-closed 拒绝）。
  - pre-step 注入：官方 `isUserInvocable` 之后插入注入门（descriptor'd：state≠active → 跳过 + 诊断；sourceKind=explicit → 跳过；scope 不可解析 → 跳过）。
  - 测试：三路径各自的 allow/deny/skip 组合、无 descriptor skill 全程 parity、typed 拒绝的 code/message、fail-closed 缺 scope、deactivate 后三路径立即失效、TTL 过期后失效、激活新 generation 后旧结果不污染（注入/目录以当前 state 裁决）。
  - 验收：SDA-2/3/4（门控侧）。

### 5. 目录变化告知（TDD）

- [ ] **5.1 实现目录告知（并入 4.1 组件）与测试 `packages/tool-skill/test/catalog-notice.test.mjs`**
  - 首发布恒全量（官方消息，policy 无关）；无政策 digest 变化 → 官方全量 replacement（`skill-catalog` + update:true）；政策开启 digest 变化 → 单条英文最小更新 CONTEXT（`skill-catalog-update`，聚合、summary 截断 200、`source.entries` 全量有效条目元数据）；同 digest 幂等（不注入、既有消息清理语义保留）；政策 dispose 后下一次变化回落全量 replacement 并替换既有 notice；delta 计算/注入抛错 → 回退全量 + 诊断 + 不破坏 decision（kind 不变、消息数组形状不变、后续轮从存储历史重算）；catalog-history 扩展识别两种 kind 后与官方行为在不含 update 消息时逐字一致。
  - 测试：上述每条 + 消息文本逐字断言（三句式模板）、power 场景（同轮多 skill 增删改聚合为一条）。
  - 验收：SDA-C1/C2/C3/C4。

### 6. registerSkill 语法糖（TDD）

- [ ] **6.1 实现 `packages/tool-skill/lib/register-skill-sugar.js` 与测试 `packages/tool-skill/test/register-skill-sugar.test.mjs`**
  - `createRegisterSkillSugar({ ctx, engine, descriptorRegister, log })` → `registerSkill(input)`：组合顺序恒为官方 `ctx.skills.register` → descriptor overlay → 可选 activation；返回句柄 `{ skillId, owner, generation, activate, deactivate, exposure, dispose }`（句柄内方法即引擎/服务对应操作的 bound 转发）。
  - 官方 first-wins 透传（no-op disposer 不伪造所有权）；激活失败回滚两半（1.3.11）；dispose 双半幂等 identity-bound；官方注册抛错 → typed。
  - 测试：组合顺序 spy、first-wins、dispose 幂等/identity、半程回滚（overlay 失败回滚内容注册、激活失败回滚两半）、active 时官方 get 可解析 / inactive 时 skill 工具拒绝（接 4.2 的 load gate）、句柄方法转发。
  - 验收：SDA-10。

### 7. 替代行 apply（boot 自检矩阵 / 版本锁定 / owner 冲突 / 官方回退）

- [ ] **7.1 实现 `packages/tool-skill/lib/apply.js` 与测试 `packages/tool-skill/test/apply-matrix.test.mjs`**
  - `export const name = 'dsh-plugin-api-tool-skill'`、`export const inject = ['agents', 'tools', 'skills']`（官方行同型）、`Config`（`catalogDescriptionMaxLength` 默认 500 + 正整数断言，官方同型）、`apply`（fail-safe，任何路径不抛）。
  - `createToolSkillApply(overrides)`（读版本/读 api/officialApply/探针可注入，测试缝）：流程 = loader 组合探针（official 行 presence/disabled、replacement 行计数、重复插入）→ official enabled → leave；无 replacement 行/重复行 → inert + 诊断；身份矩阵（runtime identity + owner identity + 主门面 fullVersionContractsMatch）→ 过：实例化 engine + fork + 发布 `ctx.skillActivation`（服务对象挂 `Symbol.for('dsh-plugin-api.tool-skill.contract')` = true）+ boot 自检探针（official 行 disabled、replacement 行 active、`ctx.tools.get('skill')` 全局视图解析到本工具、两条 pre-step 监听已注册、catalog 提供者可解析、契约面成员齐全）→ 任一探针失败 = dispose 全部 + 诊断 + 返回；失配：官方行为回退（import `@deepseek-ai/dsh-tool-skill` 的 apply 运行，扩展不发布；official apply 抛错 → inert + 诊断）。
  - 测试矩阵：official enabled / disabled、replacement 0/1/2、身份 ok/失配（runtime、owner、主门面 api 分别失配）、official apply 抛错、探针失败回滚（工具未注册上、pre-step 注册失败、契约探针失败各一）、成功路径（自检矩阵全过，audit 无残留）。
  - 验收：SDA-R1/R4/R5/R6/R9 + 契约 §7 全绿约束。

### 8. 主门面条件投影（B 面 marker/版本门控）

- [ ] **8.1 `lib/plugin-api-service.js`：`skillsActivation` 挂载点与禁用面**
  - `KNOWN_FEATURES.add('skillsActivation')`；构造函数初始化 `_skillsActivationSlot`/`_skillsActivationSurface = createDisabledSkillsActivationApi(active)`，新增 `skills` 顶层命名空间（Object.defineProperty getter → 冻结 `{ activation: 当前面 }`）与 `_publishSkillsApi()`；`_assignFeature('skillsActivation', api)` 特例（成员形状校验、slot latest-wins、frozen surface、fail() 含 Inactive/Disabled typed 语义、availability 组合）；`_restoreDisabledSurface` 对应分支。
  - 验收：SDA-5（禁用 typed surface；只停本 feature）。
- [ ] **8.2 `lib/guards.js`：`skillsActivation` probe（单 else-if，紧随 toolDiscovery 分支之后）**
  - probe `ctx.get`（主门面需惰性解析 `ctx.skillActivation` 服务做 marker 探针）。
  - 验收：契约 §3 固定顺序 + 各 feature guard 模式。
- [ ] **8.3 `lib/index.js`：manifest 读取与 feature mounter**
  - `readReplacementAuxiliaryManifests()` 增 `toolSkill: readPackageManifest('@deepseek-ai/dsh-plugin-api-tool-skill')`；`mountSkillsActivationFeature({ ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract })`：version gate（复用 sessionBranch 同型比较：辅助包 fullVersion 的 runtime+api 与 facadeContract 一致）→ resolve/ensure（`ctx.get('skillActivation')` + 契约符号 + 成员校验）→ ownerApi 全方法转发 + availability；失配 → 仅本面禁用 + warn；FEATURE_MOUNTERS 插入 `['skillsActivation', mountSkillsActivationFeature]`（toolDiscovery 之后、profile 之前）；`export { mountSkillsActivationFeature }`。
  - 验收：SDA-5.2（marker 门控条件投影、其他能力不受影响）。
- [ ] **8.4 主门面测试 `test/skill-activation-facade.test.mjs` 与 `test/skill-activation-guard.test.mjs`**
  - facade：版本匹配/失配/辅助包缺失三态（投影 active / typed disabled surface / availability 报告）、转发形状（activate/exposure/audit/policy 与 fake 服务 deepEqual）、Inactive/Disabled 抛错、其他 feature 不受影响（相对快照）、`pluginApi.skills.activation` 命名空间形状、冻结面。
  - guard：probe 通过/缺 ctx.get 拒载、FEATURE_MOUNTERS 顺序（skillsActivation 在 toolDiscovery 后、profile 前）、registry 键名。
  - 验收：SDA-5 + 契约 §2/§3。

### 9. 全量验证与收尾

- [ ] **9.1 治理与完整性验证**
  - `node --test test/governance-token-audit.test.mjs` 零违规（含新增 packages/tool-skill 全部文件）；`git diff --check` 干净；官方包零修改验证：对 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 执行只读安装态一致性校验（基线内容比对或安装清单核对）并确认本线未向其写入（官方包不在本仓库 git 追踪内，"git status 官方路径"无效；该检查只服务于交付义务，不做仓库级文件哈希加固）。
  - **SDA-R8 六项判定证据记录**：完成报告逐项记录 host-only 六项判定证据（官方 `dsh-tool-skill/package.json` 无 `dsh.client` manifest；不注册 remote namespace；不提供 slot/settings bridge；无 client↔host 版本协商；无 browser-side state/reconnect 语义；无 client-facing event/service → 六项全否 → host-only、不产生 client 构建面），供 feature-list §7 登记与全局终审核对。
  - 验收：AGENTS.md §6 治理魔法字母、官方包硬约束、SDA-R8。
- [ ] **9.2 全量测试（Stage 4 门）**
  - worktree 根执行统一 `npm test`（勿裸 `node --test`）；结果 = 本线新增测试全绿 + 存量测试除 §1.4 全量枚举的冻结断言失败外全绿；逐条列出失败断言（文件 + 断言形状 + 数量）并确认全部落在 §1.4 枚举内，移交 integration owner。
  - 验收：契约 §7.1（按 1.4 边界解释）+ AGENTS.md §3.2 Stage 4。
- [ ] **9.3 文档回写与任务勾选**
  - 全部任务勾选 implemented；执行中发现的需求/设计矛盾按 AGENTS.md §3.2 就地修订对应文档并在报告列出（不夹带范围外变更），本线已知修订清单：design.md 的 skills/change 失实陈述**全部 4 处**（1.3.18：数据流图、数据流句、"官方 skills/change 监听器"失败路径句、Hook Extraction Summary 强制表"目录失效通知 | A | 官方 skills/change 事件绑定"——修订时同步调整强制表归属）、design.md 架构图 `SA --> DG[plugin-diagnostics 归因]`（1.3.17 归因通道决议，仅此一处）、design.md `policy.registerMinimalCatalogUpdate(scope?)` 签名措辞（1.3.8 收敛）、design.md Error Handling typed 码清单（码表对齐注：`ACTIVATION_SUPERSEDED`/`ACTIVATION_EXPIRED` 移出返回码语义为状态词汇、增列 `ACTIVATION_INVALID`）；tasks.md 状态行更新为 Stage 4 完成。
  - 验收：AGENTS.md §3.2 阶段纪律。

## 3. 完成提交与后续

- 全局终审（阻塞式、只读、AGENTS.md §3.2）通过后：结果报告（含枚举偏移清单与 integration owner 移交清单）→ Stage 4 完成提交（含实现、测试、本 tasks 回写与任何 spec 修订）→ 清理 worktree 状态（保持干净）。
- 移交 integration owner（不在本线执行）：full bundle patch 第 8 块、版本统一、共享断言增量、feature-list §7 登记 + U18 状态更新、FEATURE_MOUNTERS 顺序终校验、合并顺序（Wave A 先合入 main）。**移交报告中显式点出契约偏离**（供 integration owner 对齐共享词语义）：① 契约 §6"经 plugin-diagnostics 归因 owner"→ 本线按 1.3.17 以 ctx.logger owner 归因执行（pluginApi.diagnostics 无 ctx 级服务面，零主门面依赖硬约束）；② 契约 §2"feature key/guard 分支/registry 键/namespace 统一 skillsActivation"→ 三个命名面按本线 1.1/1.3.17 落地：feature key/registry 键 `skillsActivation`、ctx 服务名 `skillActivation`、公开面沿用已批准 SDA-5.2 的 `pluginApi.skills.activation`。