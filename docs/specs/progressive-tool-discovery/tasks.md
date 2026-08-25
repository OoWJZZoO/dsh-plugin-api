# Stage 3 - Tasks

## Status

SPEC1 Stage 0–2 已确认（M6 第四批次批量确认门）；Stage 3 Tasks 已通过对抗性审查（2026-08-25「无偏差」）。审查建议项 A-1/A-2/A-3/B-1/C-1/D-1/E-1 已就地吸收进本文件与 design.md（含 S5/S4 修订），吸收清单随 Stage 4 最终报告列出；本文件通过审查即进入 Stage 4，不再提交用户评审。

## 执行约定（本 feature 批次纪律）

- 新文件一律进本 feature 命名空间：`lib/tool-discovery.js`、`lib/tool-discovery-normalize.js`、`lib/tool-discovery-errors.js`；测试 `test/tool-discovery*.test.mjs`、`test/index-tool-discovery.test.mjs`、`test/plugin-api-service-tool-discovery.test.mjs`。测试统一 `npm test`（4G 护栏），不用裸 `node --test`。
- 共享文件仅按批次契约 §2 追加式改动：`lib/plugin-api-service.js` / `lib/index.js` 各自追加 `// tool-discovery` 分隔注释的注册块 + import 行；`lib/guards.js` 追加独立 probe 分支。**预先声明一处有理由偏离（契约 §3.5 偏离义务，交付报告显式上报）**：`pluginApi.tools` 命名空间 getter 为 `configurable:false` 且返回 `Object.freeze` 产物，`tools.discovery` 挂载必须在该 getter/createToolsApi 组成路径内追加最小 add-on 行（带 `// tool-discovery` 分隔注释、仅追加不改写既有逻辑）。冻结文件（契约 §3）一律不碰；本批不改版本号/dsh.api。
- **实现与测试代码中不得出现治理代号**（不写 SPEC/PTD/B 类/r1 等字样、不写需求编号；用能力语义命名）。错误码用能力词（如 `DISCOVERY_ENTRY_CONFLICT`）。generation token 为 `${ownerId}:${随机串}`（owner 域内 opaque）。
- 每个任务 fail-safe：任何 apply/setup 路径失败只降级本 feature（inert + availability 如实），绝不抛穿 apply、不影响其他 feature。
- 执行顺序即下文编号；每个大批次作为整体交付。真实生效边界（下一个 assemble）如实披露（对应「无 immediate 承诺」边界），不虚报即时生效。
- 验收对象（§5）与本 feature 无迁移关系：本 feature 的迁移验收任务体现为测试策略的「零条目逐字节回归锚点」（任务 6）与全量套件回归（任务 9），不涉及 dsh-read-image / dsh-pro-ex-ability-anchor。

## Tasks

- [ ] **1. 运行时事实核验（对应 requirements PTD-3.4/3.5 与 design「官方 loader 能力审计」表）**
  - 1.1 在 `temp/ptd-fact-check.mjs` 写一次性核验脚本（用完即删，不提交）：对锁定 runtime 的 `@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-agent-loop`、`@deepseek-ai/dsh-tools` 与 `packages/agent-loop`（replacement 同路径核验）逐一断言 design 审计表 4 条事实：
    1. `systemPrompt.tools(provider)` 存在且每次 `assemble` 重新求值 provider，provider 返回形状为 `{ schemas, knownNames }`，`assemble` 上下文含 `{ agent, scope, signal }`（`assembleContextFor` 契约）；
    2. agent-loop 每个 step 重新 `systemPrompt.assemble()` 并把 `assembly.tools` 传入 `buildRequest`（官方与 replacement 两处）；
    3. toolset 变化被官方以 `request/header` reason `change` 记账（canonicalHeader 对空 tools 省略 `tools` 键）；
    4. tools registry 具备 `register`/`restrict`/`get`/`schemas(scope?)`。
  - 1.2 任一事实不成立 → **立即停止**本 tasks 执行，按 goal/requirements 的返工规则转 R 通道（替代 `dsh-tools` 装配行）并回改 requirements/design/tasks 后重新派审；全部成立则记录证据文件路径，继续任务 2。
  - 引用：requirements PTD-3.4/PTD-3.5；design「官方 loader 能力审计」表、「Stage 3 落地澄清」S4。

- [ ] **2. 纯函数归一化/校验模块（lib/tool-discovery-normalize.js）+ 单测（TDD）**
  - 2.1 先写 `test/tool-discovery-normalize.test.mjs` 再实现模块（零 harness 依赖、纯函数）：
    - descriptor 规范校验：id/owner 非空字符串；summary ≤200 字符；capabilities ≤16 项且每项非空字符串；可选 `toolNames`（case 2）≤16 项非空字符串；sourceKind 枚举 `plugin|skill|mcp|builtin-ref`（缺省 `plugin`）；activate 为函数；
    - 工具定义归一化：激活产出数组逐元素归一为 `{ name, description, parameters }`，name 非空字符串、description 字符串、parameters 对象，畸形元素标记不可用；
    - **structuredClone 安全保证**：归一化层对每个参数的 `parameters` 实际执行一次 `structuredClone` 校验（函数/Symbol/循环引用 → 该定义标记不可用，按 design S4 落入 entry failed 通道），绝不把不可克隆对象交给官方 assemble；
    - scope key 归一化：`session.id` → `execution.agent.session.id` → `execution.sessionId` 顺序解析，全部缺失返回不可解析标记；
    - 审计过滤/截断辅助（query 过滤器归一化、有界游标语义）。
  - 2.2 单测覆盖：边界（199/200/201 字符、15/16/17 项 capabilities、空串 id/owner、非法 sourceKind、非函数 activate）、畸形定义各形态（含 parameters 内嵌函数/循环引用 → 克隆校验拒绝）、scope 解析三种来源与缺失、游标分页、toolNames 量级边界。
  - 引用：requirements PTD-1.1（校验面）、PTD-7.4；design「Stage 3 落地澄清」S1/S6。

- [ ] **3. typed errors 模块（lib/tool-discovery-errors.js）+ 单测**
  - 3.1 新增错误类（全部继承 `PluginApiError`，code 用能力词，无治理代号）：
    - `DISCOVERY_REGISTRATION_INVALID`、`DISCOVERY_ENTRY_CONFLICT`、`DISCOVERY_ENTRY_UNKNOWN`、`DISCOVERY_ENTRY_DISPOSED`、`DISCOVERY_ENTRY_DEACTIVATED`、`DISCOVERY_ENTRY_FAILED`、`DISCOVERY_SCOPE_UNRESOLVED`；
    - stale/foreign generation dispose 的 typed outcome 常量构造器 `DISCOVERY_GENERATION_STALE`（不抛，见任务 4）。
  - 3.2 `test/tool-discovery-errors.test.mjs`：code/name/instanceof PluginApiError/cause 传递。
  - 引用：requirements PTD-1.2/3.3/4.4 的 typed 语义；design「Stage 3 落地澄清」S6。

- [ ] **4. 引擎主体（lib/tool-discovery.js）：registry、activation、generation、audit、availability + 单测（TDD）**
  - 4.1 先写 `test/tool-discovery.test.mjs`（依赖注入：注入激活回调、时钟、审计写入器、内核可用性谓词、scope 约束 seam）再实现引擎（不接触官方服务，纯门面状态机）：
    - `catalog.register(spec)` → 校验（任务 2 归一化）通过后入目录，返回 `Handle{ generation, dispose }`（entry generation = `${ownerId}:${随机串}`）；同 owner 重复 id → `DISCOVERY_ENTRY_CONFLICT` 且保留既有条目；dispose 幂等、只清本 entry（含其各 scope active 记录与 audit 标记），他人条目不受影响；descriptor 冻结只读；
    - `activate(id, { session?, execution?, reason? })` → `Promise<ToolsetHandle{ generation, dispose }>`：scope key 解析失败抛 `DISCOVERY_SCOPE_UNRESOLVED`；entry 未知/已 dispose/已 failed/已软下线分别抛对应 typed error；激活回调抛错或产出畸形定义 → 该 entry 标记 failed（owner 归因经注入的 diagnostics 上报）、抛 `DISCOVERY_ENTRY_FAILED`、其余条目不受影响；回调为异步时，resolve 后校验 generation 仍为当前（latest-wins）：已被同 entry 同 scope 的新激活取代或被回收 → 结果丢弃、audit 记 `revoke`、仅保留为 diagnostics；发布成功 → 写 ActiveToolset 并 audit `activate`；
    - `handle.dispose()`：精确回收该 (entryId, scopeKey, generation)；stale/foreign → 冻结 typed outcome `{ ok:false, code:'DISCOVERY_GENERATION_STALE' }` 且保留当前 active 暴露、不抛错；成功回收 audit `deactivate`；
    - `deactivate(id, { reason? })`：entry 软下线（audit `deactivate`），已发 handle 与 active toolset 保持有效；其后 activate 抛 `DISCOVERY_ENTRY_DEACTIVATED`；
    - audit：内存有界循环队列（上限 500），kind 全表 `activate|deactivate|revoke|exclude|fail`（`exclude` 由搜索排除写入，`fail` 由 entry failed 写入；本任务实现 activate/deactivate/revoke/fail 四条写入路径），`audit.query(filter?) → { items, truncated, nextCursor? }` 冻结视图；写入器注入失败 → availability 显式 gap 标记、不伪造记录、exposure 继续（对应审计失败路径）；
    - case 2 最小落位：spec 可选 `toolNames` 校验（任务 2）后冻结存入 descriptor，激活时 ActiveToolset.tools 记 names[]（状态/审计可见），provider 不输出其 schema、search 投影不含 toolNames；
    - visibility：全部投影 deepFreeze。
  - 4.2 单测矩阵：冲突/保留、条目生命周期（register→activate→dispose→后引用）、generation 替换 latest-wins、迟到异步结果只进审计、stale dispose 保留当前暴露、delete 只清本 owner、audit 有界截断与 gap、all five audit kinds 写入路径、case 2 记录（toolNames 冻结、激活后 names 入 ActiveToolset、search 投影不泄漏）、availability 各状态真值。
  - 引用：requirements PTD-1.1–1.4、PTD-3.1–3.3、PTD-3.6、PTD-4.1–4.4、PTD-5.1–5.3、PTD-7.1/7.3/7.4；design Architecture、Data Models、「Stage 3 落地澄清」S1/S5/S6。

- [ ] **5. 搜索面 + 约束 seam（引擎扩展）+ 单测**
  - 5.1 在引擎内实现 `search(query, { scope? })`（可注入 `scopeConstraint(scopeKey)` seam）：
    - 匹配：query 对 id/summary/capabilities 大小写不敏感子串；缺省/空 query 返回全部（同 scope 约束过滤后）；
    - **descriptor 投影字段集钉死为 `{ id, summary, capabilities, sourceKind }`**（PTD-2.1 枚举；`owner`、`toolNames` 等仅存在于 audit/内部状态，不进入模型可见投影）；
    - 结果 `{ descriptors, exclusions, constraint }` 全冻结；约束 `forbidden` 命中条目从 descriptors 滤出并各写一条 `{ entryId, reason }` 到 exclusions，**且按 PTD-5.1 追加 audit `exclude` 记录**（这是 search 唯一允许的状态写入；激活/注册/暴露状态零触碰、零副作用）；constraint 元数据如实携带 `status: 'none'|'applied'|'unknown'` 与 reason/detail；
    - 无匹配 → `{ descriptors: [], exclusions: [], constraint: { status: 'none', forbidden: [] } }`，不捏造建议。
  - 5.2 `test/tool-discovery-search.test.mjs`：匹配语义、投影字段集（无 owner/toolNames）、冻结性、空结果形状、三个 constraint 状态（none/applied-with-forbidden/unknown）下的过滤与元数据、`exclude` 审计写入确证、seam 抛错 → 视为 unknown 且搜索继续、无激活/无注册侧效果断言。
  - 引用：requirements PTD-2.1–2.4；design Search 段、「Stage 3 落地澄清」S2。

- [ ] **6. 装配面集成（真实官方 SystemPrompt 服务 + 迷你 ctx）：provider 与 hint + 测试**
  - 6.1 在引擎外部提供 facade-owned provider 与 hint section 工厂（host 装配用）：provider 每次求值按 design S4 输出当前 scope 的 active toolset schemas（scope 来自上下文 `scope/agent.session.id`，不可解析返回空集）；hint section text 按 design S3 输出/空串；两者抛错一律内部消化 → 空集 + diagnostics 上报。
  - 6.2 `test/tool-discovery-assemble.test.mjs` 用**真实 `SystemPrompt` 服务**（`@deepseek-ai/dsh-system-prompt` 默认导出 + 迷你 Cordis ctx：effect 支持生成器 disposer、waterfall 直通、emit 空实现）驱动 `assemble({ scope: { session: { id } } })`：
    - 注册但零激活 → `assembly.tools` 为空、hint section 渲染空串（不泄漏 schema）；
    - activate 后**下一次 assemble** 断言新 schema 出现在 `assembly.tools`（turn 内重建回归锚点）；hint 渲染出该条目描述行；
    - `handle.dispose()` 后下一次 assemble 断言消失；不同 session scope 的 assemble 互不可见；
    - 一个坏 activate 回调 → 该 entry failed（diagnostics 归因），其他 entry 正常出 schema；
    - **不可克隆 parameters 对抗用例**：activate 产出含函数内嵌的 parameters → assemble 不炸（provider 返回前被克隆校验拦截）、该 entry failed、其他条目正常出 schema（structuredClone 安全落位回归）；
    - 零条目基线：facade 注册后 renderPrompt 输出与无注册时逐字节一致；provider 内部抛错 → 返回空集、assembling 不失败。
  - 引用：requirements PTD-3.1/3.4、PTD-6.1–6.3、PTD-7.1；design Testing Strategy 1/2/4、「Stage 3 落地澄清」S3/S4/S8。

- [ ] **7. 服务装配（lib/plugin-api-service.js `// tool-discovery` 注册块）+ 测试**
  - 7.1 在服务类追加（追加式、带 `// tool-discovery` 分隔注释；`tools` 命名空间 getter 组成路径内追加最小 add-on 行——契约 §3.5 预先声明的有理由偏离，见执行约定）：
    - `createDisabledToolsDiscoveryApi(active)`：所有成员在未激活/未装配时抛 `PLUGIN_API_INACTIVE`/`PLUGIN_API_FEATURE_DISABLED('toolDiscovery')`；
    - `tools` 命名空间内挂 `discovery` 成员（缺省 disabled surface；装配后为活动 surface）；
    - `_assignFeature('toolDiscovery', api)` 校验 owner 形状（register/search/activate/deactivate/audit/availability）并挂槽；`KNOWN_FEATURES` 增加 `toolDiscovery`；`_readSlot`/`_disabledSurfaceFor`/`unmountFeature` 对应分支。
  - 7.2 `test/plugin-api-service-tool-discovery.test.mjs`：disabled surface 各方法 typed 失败；mount 后 surface 可用；unmount 后恢复 disabled；核心 inactive 时抛 `PLUGIN_API_INACTIVE`；`features` 快照反映装配状态。
  - 引用：requirements PTD-7.2/7.3；design Components and Interfaces、「Stage 3 落地澄清」S7。

- [ ] **8. guards probe + 宿主装配（lib/guards.js probe 分支；lib/index.js `// tool-discovery` 注册块）+ 索引级集成测试**
  - 8.1 guards.js 追加 `toolDiscovery` probe 分支（不再动他人 probe）：`systemPrompt.tools`、`systemPrompt.section`、官方 `tools` 服务面存在性。
  - 8.2 index.js 追加 `mountToolDiscoveryFeature`（带 `// tool-discovery` 分隔注释）：构造引擎 owner；经 `systemPrompt.tools()` 注册 provider、`systemPrompt.section()` 注册 hint（disposer 入 ctx.effect）；`scopeConstraint` 从 `resolveMarkedRoutePolicy(ctx)` 接线（design S2 宿主映射，route-policy 缺位 → none）；entries 失败/注册失败经注入 diagnostics 钩子上报（owner 归因）；任何 setup 异常 → 本 feature 不激活、availability 如实、其余 feature 照常装配；FEATURE_MOUNTERS 追加条目。
  - 8.3 `test/index-tool-discovery.test.mjs`（mock ctx：systemPrompt stub 捕获 providers/sections 并按官方形状求值、services 完备、可注入 FakeRoutePolicyService 车道）：
    - guard 通过 → feature active，`pluginApi.tools.discovery` 全链路（register→search→activate→next assemble 出 schema→audit→deactivate→dispose）；
    - guard 失败（systemPrompt.tools 缺失）→ feature disabled、availability/features 如实、boot 不炸；
    - setup 注错（provider 注册抛错）→ inert 降级、其余 feature 存活；
    - route-policy 车道：接入带标记的 FakeRoutePolicyService（denied 决策 → constraint applied；无决策 → unknown；缺位 → none），断言 search 结果 constraint/exclusions 元数据；
    - 客户端边界：断言 host client 出口（client bundle/export 面）不存在任何 discovery 面，`lib/client*.js` 未新增（PTD-8.1–8.3 由「无 client 面」+ 只读 host 投影已有通道声明满足，v1 不新增 transport）。
  - 引用：requirements PTD-2.3、PTD-7.2、PTD-8.1–8.3；design Client Boundary、「Stage 3 落地澄清」S2/S7。

- [ ] **9. 全量回归与完成检查**
  - 9.1 `npm test`（4G 护栏）全绿；专项跑 `test/tool-discovery*.test.mjs`、`test/index-tool-discovery.test.mjs`、`test/plugin-api-service-tool-discovery.test.mjs`。
  - 9.2 完成检查清单：`git diff --check` 零告警；冻结文件（契约 §3）零改动；实现/测试代码零治理代号泄漏扫描（无 SPEC/PTD/B 类/r1/需求编号字样，仅 doc 制品允许）；`temp/ptd-fact-check.mjs` 用完即删（temp/ gitignored，不提交）；阶段提交只含本 feature 制品与必要装配改动。
  - 9.3 Stage 4 完成提交（提交本 Stage 实现、测试、tasks/design 回改与必要登记），提交后工作区干净。
  - 引用：design Testing Strategy 3/4；AGENTS.md §3.2 Stage 4 完成提交与 §6 仓库规则。