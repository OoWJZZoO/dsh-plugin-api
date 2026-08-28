# Stage 3 — Tasks

## Status

SPEC3 Stage 3：本任务书承接已确认的 `goal.md` / `requirements.md` / `design.md`（Stage 0–2 已获用户确认：goal/requirements/design 分别于 2026-08-28 提交，并在 SPEC2 复审后修订）。本文按 AGENTS.md §3.2 以对抗性审查为门；审查返回「无偏差」后直接进入 Stage 4，不设用户确认门。

**Stage 4 内附加人类门（design §Deletion Report Gate，M7 专属，不由本任务书取消）**：Task 3 产出 `deletion-report.md` 后必须暂停，呈交人类维护者并取得明确批准，才可执行涉及已报备删除项的实现/测试改动（Task 4 起的相关子任务）。报备不等于默认保留。

**并行纪律**：M7 全程串行（design §Implementation Sequence：「The sequence is serial. No parallel worktree is planned for M7」）。本任务书不派发并行契约；任何任务不得改动官方 DSH 包文件。

## 需求锚点

任务引用 `requirements.md` 各节（`§N` 为节号）：

- §1 Registry / §2 Target Host Namespace / §3 Target Client Namespace / §4 Namespace Migration And Public API Deletion / §5 Capability Presence, Availability, And Failure Vocabulary / §6 Composition, Owner, Authority, And Lifecycle / §7 Events, Ordering, And Domain Reducers / §8 Semantic Domain Minimums / §9 Services Member-Level Classification / §10 Version, Negotiation, Wire, And Durable Protocols / §11 Plugin Private State, Scope, Visibility, And Concurrency / §12 Capability Strategy And Replacement Boundary / §13 Package Assembly And Installation Equivalence / §14 Consumer Migration And Ecosystem Acceptance / §15 Verification, Test Matrix, And Delivery Gates / §16 Standards Applicability And Alignment。

## 冻结决策（源自 design，实现须逐项遵守）

1. **版本基线（冻结，Task 1 落地后整个 M7 不得再 bump）**：主包与全部本地辅助/full 包 `package.json` version 统一 `0.1.0-rc.6-0.1.0`，`dsh.api` 统一 `0.1`；`<A>=0.1.0-rc.6`（runtime 全量 identity 精确匹配）、`<B>.<C>=0.1`（第三方协商，实际 `C >= required C`，不同 `B` 不兼容）、`<D>=0`（包本地维护号，本次基线统一）。
2. **Registry**：单一事实源落盘 `docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`；构建期/测试期数据，不建设运行时 registry 服务、不成为全局 owner graph / permission 系统 / schema migration 平台。字段与词表按 design §Data Models（Public Contract Entry / Composition Contract / Availability / Version Contract / Owner And Generation / Terminal Outcome）冻结。
3. **目标 namespace**：host 按 design §Target Namespace Design（Host Domains 树）发布；重大归并：`agent`→`agents`、`session`→`sessions`（branch/channel 归 `sessions.branches` / `sessions.channels`）、`execution`→`executions`（recovery 归 `executions.recovery`）、`routing`/`routePolicy`→`llm.routing`、`systemPrompt`→`prompts`、`context`→`prompts.provenance`、`workspaceTransactions`→`workspaces.transactions`；slash event name（如 `system-prompt/assemble`）保持协议名，capability 用 dot path，互不混用。
4. **Client**：移除公共 `.client` 根，直接发布 `ctx.pluginApi` 根成员（isActive/apiVersion/assertCompatible/capabilities/connection/events/remotes/settings/slots/lifecycle/codec/services）；纯官方 client 直通归 `services.*`；`defineManifest` 仅静态导出。host/client 分别导出 `HostPluginApi` / `ClientPluginApi` 类型。
5. **旧路径与 alias**：不保留兼容 alias、deprecated forwarding property、silent no-op 或隐藏兼容分支；删除动作一律经 deletion report 人类门（Task 3）。
6. **实现通道注册**：每个公共成员在 registry `implementationChannel` 逐成员登记（facade / passthrough / proposal / replacement）；本 feature 不新增未批准的 R 类能力（requirements §12）；横切派发语义（priority / deepFreeze / fault containment）永不 R。
7. **typed 失败词表**：inactive core `PluginApiInactiveError` → capability-unavailable typed error/result → conflict/owner-conflict/claim-conflict → denied/aborted/superseded/stale discriminated outcomes → official 错误保留 identity；`undefined` 只表示领域合法缺失。availability 词表仅 `active | degraded | unavailable`；终态词表 `success | error | aborted | denied | superseded`（execution→`outcome`、mutation→`commitState`、resource→`lifecycleState`，`settled/closed/committed/disposed` 为生命周期词不混用）。
8. **Composable Profile**：成员完成 composition/authority 审计且 registry 记录完整才可 `status: 'recommended'` 并进入默认 profile；未完成审计不得标 recommended；profile 是 registry 标记与测试证据，非运行时服务（design §Composable Profile）。
9. **治理魔法字母禁令（AGENTS.md §6）**：`lib/`、`packages/`、`test/`、`scripts/`、`package.json`、`cordis.patch.yml`、运行时可见字符串不得出现治理编号/分类字母/带治理后缀的行 id（如 `A11`、`compaction-events-r1`、`M7`、`SPEC*` 等）；仅 `docs/**` 允许。
10. **fail-safe**：所有入口失败只记录日志并安静停用/回退，绝不抛穿 apply/boot；官方包文件任何情况下不修改。

## 任务清单

按 design §Implementation Sequence 的 1–9 串行顺序执行；一个顶层任务内所有子项、实现文件与测试作为整体交付；测试先于/伴随实现（TDD）。

- [ ] **1. 基线冻结与清点（requirements §1、§10、§15）**
  - **1.1 版本解析升级**：改造 `lib/version.js` 使完整版本解析为 `<A>-<B>.<C>.<D>` 单记录 `{ runtime, api, maintenance }`（design §Version And Assembly Adapter 冻结形状；当前只解析 `<runtime>-<B.C>`）；保留导出兼容：第三方协商只比较 `B.C`（同一 `B` 内 `实际 C >= required C`），runtime 匹配用 `A` 全量 identity 精确匹配；wire/durable 合同不依赖包版本。
  - **1.2 元数据基线冻结**：主包与全部本地辅助/full 包（`packages/*` 各 `package.json`，含 `full/`）统一 `version: 0.1.0-rc.6-0.1.0`、`dsh.api: "0.1"`（存在该字段处）；此后任何任务不得再 bump。同步更新主包 `version.test.mjs` 与 `package-policy.test.mjs`（或既有等价测试）断言冻结值与非 bump 检查。
  - **1.3 Registry 骨架**：创建 `docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`：contract baseline（冻结 `0.1.0-rc.6-0.1.0` / `dsh.api 0.1`）、host/client domain tree（冻结决策 3/4 的目标树）、空成员区、removed/disabled/advanced/recommended 状态词汇、old-to-target 映射区、实现通道词汇（facade/passthrough/proposal/replacement）。
  - **1.4 清点（inventory）**：枚举当前 host 公共面（`lib/plugin-api-service.js` 及各 mounter 发布的根/成员）与 client 面（`lib/client-runtime.js` 根成员、`lib/client.js` 检入 bundle 形状），为每个当前公共成员登记：publicPath（旧）、proposed target path（按冻结决策 3/4）、runtime（host/client）、effect、capability 候选、实现来源文件；写入 registry 的 old-to-target 映射区与成员区（supplier 为清点结果，`status` 先填 `advanced` 或未定，Task 4–7 中逐成员定稿）。清点显著项须与 design §Current-State Findings 1–9 一致。
  - **1.5 基线测试**：版本解析（`0.1.0-rc.6-0.1.0` → `{runtime:'0.1.0-rc.6', api:'0.1', maintenance:'0'}`；`B.C` 协商边界：同 B 大 C 通过、异 B 拒绝、D 不参与协商）、包元数据冻结断言、registry 骨架可解析为 JSON。
  - **要求**：本顶层任务完成后，版本面与 registry 骨架成为后续全部任务的共同基线；1.2 的冻结一旦提交，后续任何包版本改动即违规。

- [ ] **2. 契约校验与快照基础设施（requirements §1、§5、§15、§16）**
  - **2.1 纯校验器**：创建 `scripts/registry-validate.mjs`（纯 Node，零 harness 依赖）：校验 registry 必填字段、publicPath/capability 唯一性、路径深度（除 `services.*` 外最多两层领域后接方法，第三层仅强领域关系）、domain/member 一致性、status 词表 ∈ {removed, disabled, advanced, recommended}、availability 词表、composition 词表、terminal/priority/scope 词表；失败输出可定位条目并非零退出。
  - **2.2 快照/矩阵生成器**：创建 `scripts/registry-snapshot.mjs`（纯 Node）：从 registry 生成 host/client 表面快照、services fixtures、capability/disabled-surface fixtures、组合测试矩阵输入（供 Task 7 测试使用）；快照仅含中立能力/领域名，不得输出治理编号。
  - **2.3 校验测试**：创建 `test/registry.test.mjs`：对 registry 跑 2.1 校验器（好/坏用例：重复 publicPath、重复 capability、非法 depth、非法词表、缺必填字段）；对 2.2 快照断言与 registry 一致（同一事实源，无手写漂移）。
  - **2.4 治理 token 扫描扩展**：扩展/复用既有 `test/governance-token-audit.test.mjs`：扫描 `lib/**`、`packages/**`（代码与 patch、package.json）、`scripts/**`、`test/**`、仓库根 `package.json`、各 `packages/*/cordis.patch.yml`（或复用既有扫描的完整清单）中是否泄漏治理编号/分类字母/带治理后缀行 id（冻结决策 9 的清单）；新增负向断言：registry 快照与生成 fixture 也通过扫描。
  - **要求**：本顶层任务交付后，registry 的机器校验与快照生成成为标准流程；Task 4–7 每步改 registry 后必须重跑 2.1/2.2 + 对应测试。

- [ ] **3. 删除报告与人类门（requirements §4、§15；design §Deletion Report Gate）**
  - **3.1 删除清单编制**：创建 `docs/specs/plugin-api-m7-public-contract-refactor/deletion-report.md`，按 §4 与 design 逐项列出候选删除：历史 feature-shaped/替换-shaped 公共根（含 `agent`、`session`、`execution`、`routing`、`routePolicy`、`systemPrompt`、`context`、`workspaceTransactions`、`sessionChannel` 等旧根与重复 delegate，如 `agent.routeOf` / `tools.routeOf`）、`features` 快照、无独立长期价值的 `services.*` 成员、及其他清点为 duplicate/historical/unsupported-authority/no-value 的成员。**清单每项应标注类别：`rename`（旧路径归并入目标 namespace，由 Task 4 cutover 处理）、`remove`（无替代的实质删除，由 Task 6 减法处理）、`retain-unavailable`（保留路径但呈现 typed unavailable）。** 每项记录：确切旧 path/成员、类别（duplicate/historical/unsupported authority/no-value surface）、当前仓库与消费者引用、受影响的 package/patch/client/文档面、目标替代 path 或明确无替代、预期 typed 失败/availability 后果、registry 理由、所需测试与迁移更新。
  - **3.2 人类批准门（阻塞）**：将 3.1 报告呈交人类维护者，逐项取得明确批准（批准/驳回/修改每一项）；未获批准的项目不得进入删除实现；获批项目登记进 registry 的 removed 状态与 old-to-target 映射。**若某删除项的改变会动摇已确认的 Goal 或 Requirements 验收边界，则该删除项不得仅在删除报告中批准，必须另行呈交人类维护者就边界变更做出独立决策；在收到该独立决策前，不得推进该删除项的实施。** 在收到全部批准前，不得开始 Task 4 中对已报备删除项的实现/测试改动。
  - **3.3 删除门测试**：创建/扩展测试断言：approved 删除项已登记（registry removed 状态与删除报告链接）、未经批准的候选不得处于 removed、删除报备与 §15「deletion approval 链接」验收一致。
  - **要求**：3.2 是人类裁决点；本任务完成 = 报告产出 + 人类批准齐备 + registry 登记同步。

- [ ] **4. Host namespace cutover（requirements §2、§4、§5、§8、§9、§12、§13）**
  - **4.1 领域组装改造**：重构 `lib/plugin-api-service.js`（及需要的主干文件 `lib/index.js` 装配顺序）为以目标领域为单位的 builder 组装：根元数据（isActive/apiVersion/assertCompatible/capabilities）、每个目标 domain 一个 surface；既有 feature mounter 只发布内部 owner slot，公共 domain getter 只解析分配给该 domain 的当前 slot（冻结决策 3 的归并全部落实：`agents`、`sessions`（含 branches/channels）、`executions`（含 recovery）、`llm`（含 requestTransforms/admissionPolicies/adapters/routing）、`prompts`（含 provenance）、`tools`（含 discovery）、`skills.activation`、`attachments`、`mcp`、`tasks`、`coordination`、`workspaces.transactions`、`security`、`diagnostics`、`settings`、`profiles`、`remotes`、`storage`、`services`）；保留 lazy getter 以维持 caller-fiber identity 捕获，但绝不复活旧公共 path；disabled surface 使用目标成员形状与 typed 错误（§5）。
  - **4.2 capability 查询面**：实现 `pluginApi.capabilities.get/list/require`（design §Capability Query Surface 冻结形状）：读 registry-backed 能力描述与当前 availability；不暴露内部 mounter 快照、包名、替代行或可写 registry 对象；旧 `features` 快照按 Task 3 批准结果处理（批准删除则移除，未批准则从推荐面摘除并保留至批准）。
  - **4.3 装配通道落实**：经 Task 3 批准后，在同一个 cutover 边界内移除旧公共路径、重复 delegate、feature-shaped/replacement-shaped 公共根（§4「same migration boundary」）；只发布目标 path；每删除项在 registry 标 removed 并链接删除报告。
  - **4.4 services 元数据扩充**：`lib/services.js`（SERVICE_DEFINITIONS 静态表）为每个白名单成员扩充 registry 元数据（official service key/member、method kind、required/optional、public capability path、composition mode、authority/bypass 注记、runtime availability 规则、visibility/cancellation 注记，design §Services Adapter）；运行时保持 member-level：可用成员冻结 1:1 passthrough、缺失成员 typed unavailable、无官方 service 的父 namespace 保持形状 disabled、未登记官方成员绝不暴露。
  - **4.5 宿主面测试同步**：在同一 cutover 内更新既有宿主测试（`plugin-api-service-*.test.mjs`、`index-*.test.mjs`、`host-namespace-integration.test.mjs`、快照/cardinality 测试等）：目标 namespace 与成员基数（§15①）、旧 path 不存在（负向断言）、`.capabilities` 形状、disabled/unavailable 形状与 typed 错误（§5）、inactive core 统一错误、官方 passthrough 契约保持（§9）。
  - **要求**：cutover 后宿主公共面只包含目标树且无兼容 alias；`npm test` 中宿主相关测试与本任务新增测试全绿；registry 与快照一致。

- [ ] **5. Client namespace cutover（requirements §3、§5、§14；design §Client Surface Assembly）**
  - **5.1 client 根改组**：改造 `lib/client-runtime.js`：移除公共 `.client` 根 getter，直接发布根成员 `isActive / apiVersion / assertCompatible / capabilities / connection / events / remotes / settings / slots / lifecycle / codec / services`；纯官方 client 直通挪入 `services.*`（含 conversation、conversation events/views、timer、command UI、model directories 等按 registry 登记）；`defineManifest` 保持静态导出、不进运行时根；现有 caller-bound 构造与 leaf lease 保留在根 builder 之后。
  - **5.2 client 类型**：导出/维护 `ClientPluginApi`（与 `HostPluginApi` 分离；运行时可选属性探测不做类型级环境区分，§3）；host/client 同一领域词表与 owner/generation/stale-disposer/composition 合约（§3）。
  - **5.3 client bundle 重建**：按仓库既有 client bundle 构建流程重建并检入 `lib/client.js`（约含真实 codec、manifest、module-loader identity）；断言 bundle 中无 `.client` 公共成员、纯官方直通只经 `services.*`（§3、§5）；治理 token 扫描通过。
  - **5.4 client 测试同步**：更新/新增 `client*.test.mjs`：直接 `ctx.pluginApi` 根且无公开 `.client` 成员、host/client 词表一致、remote/slot/settings/lifecycle/reconnect/HMR/owner-local generation/stale cleanup/callback 失败、host 脱敏先于序列化 + client 形状校验、检入 bundle 形状与 manifest、官方 client leaves 只经声明 `services.*` 暴露。
  - **要求**：client cutover 后浏览器面无 `.client` 公共路径；client 相关测试全绿；检入 bundle 与 registry 一致。消费者 panel 的迁移在 Task 8 统一处理（依赖本任务完成）。

- [ ] **6. 公共面减法（requirements §2、§4、§5、§9；design 完成定义与 §capability-and-services 减法规则）**
  - **6.1 成员级减法执行**：对 Task 3 批准的删除项，在目标树稳定后执行最终移除（registry removed 定稿、运行时不再发布、快照/类型/文档/测试同步更新）；未批准项保留并保持其 availability 呈现，不得以别名/隐藏分支留存（§4）。
  - **6.2 services 减法**：按 §9 与 `capability-and-services.md` 逐成员审计 `services.*`：删除无独立长期价值成员（经批准）；仅因 runtime identity 差异不稳定的成员保留 path 且呈现 typed `disabled/unavailable`（§5、§9），绝不静默移除公共路径；已有一等领域 API 覆盖的重复入口移除。
  - **6.3 减法后验证**：快照/disabled-surface 形状与 registry 一致（§15①）；组合测试输入（2.2）重生成；负向断言：已删除 path 在公共面与 registry 快照中都不存在、runtime-unavailable path 仍存在且 typed。
  - **要求**：减法后公共面 = 目标树 ∩ 保留成员；所有减法项可回溯到批准记录。

- [ ] **7. 组合与 authority 加固（requirements §6、§7、§8、§11、§12；design §Domain Composition Rules / §Error Handling And Lifecycle / §Data Models / §Composable Profile）**
  - **7.1 成员登记定稿**：对每个保留成员在 registry 定稿 composition mode（pure/additive/ordered/coordinated/exclusive 五选一）、stateOwner、scope、resourceKey、identitySource、conflictRule、lifecycle、bypasses、availability 粒度（§6 AC 逐条）；未完成 composition/authority 审计的成员不得 `status: 'recommended'`、不得进入默认 Composable Profile（§6 末条、design §Composable Profile）；`recommended` 成员集合与 profile 一致并生成 profile fixture 供测试。
  - **7.2 owner/generation/disposer 最小机制**：owner 从实际调用方/插件装配身份派生（不接受调用方伪造 owner）；注册/策略/订阅类成员落实 owner 归因、同 key 冲突显式、identity-bound disposer（owner+key+generation）；stale disposer 返回 typed no-op、不删新 generation/他人资源；generation 为 owner-specific opaque token、不跨 owner 比较、无全局单调序号；`latest-wins` 仅限同 owner 同 key（§6、§11、`identity-and-lifecycle.md` §2）。
  - **7.3 事件与决策面**：`events` 区分 observe-only consumer 与 producer authority；自定义事件经 owner-scoped `events.define` 获取能力受限 publisher handle，拒绝可派发任意 canonical 事件名的全局入口；普通监听固定 priority 词表 + 同 priority 成功注册顺序；语义 policy 用领域 reducer/固定阶段而非裸 waterfall；无全局依赖图（§7、`ordering.md`）。
  - **7.4 领域组合规则落实**：按 design §Domain Composition Rules 逐领域落实最小机制：`llm.requestTransforms`（owner-scoped、ordered、改写范围、at-most-once/收敛）、`llm.admissionPolicies`（固定 decision algebra，deny/ask/allow 不由监听顺序决定）、`llm.routing`（查询/policy/candidate/health/decision 独立 owner，attempt 内 decision immutable）、`agents.providers`（singleton 需 claim 或门面 multiplex）、`executions`（projection 只读、execution identity 独立于事件序列且 attempt 间不变、recovery 消费单一 authority）、`sessions.branches/channels`（identity、scope、generation possession、CAS/fencing、认证 owner、直接 session mutation bypass 显式登记）、`prompts.provenance`（projection 与 contribution owner 分离、不能绕过 prompt policy）、`tools`/`tools.discovery`/`skills.activation`（key 冲突、descriptor/activation owner 化、registry vs session authority 边界）、其余领域按 §8 最低要求登记（attachments/mcp/tasks/coordination/workspaces.transactions/security/diagnostics/settings/profiles/remotes/storage）。
  - **7.5 storage 薄绑定**：若 registry 保留 `storage` 成员（按清点结果），落实 owner-scoped、scope 恰一档（profile/workspace/session）、schema envelope（schema ID + 整数 version + owner + scope + id + data）、未知未来版本 `unsupported-schema`、disable/reload/uninstall 关闭 handle 不删数据、显式 purge 才删除（§11、`plugin-state-and-lifecycle.md`）；无 upgrade 读取需求不预建 migrator。
  - **7.6 typed 失败与并发语义**：落实 design §Typed Failure Precedence 全序（inactive → unavailable → conflict → denied/aborted/superseded/stale → official error 保真）；异步面落实 §Stale And Cancellation Handling（保留 caller AbortSignal 并只叠加本地取消源、owner/generation/终态/资源持有校验后再发布或提交、终态后不启动 retry、stale 仅作有界 diagnostic、只 dispose 当前 owner/generation 创建的资源）；callback 抛错按决策点 containment（§6、§11、`concurrency-and-cancellation.md`）。
  - **7.7 组合矩阵测试**：按 design §Composition Matrix 与 §15②：至少两个 synthetic plugin 覆盖反向加载顺序、同 key 冲突确定性拒绝、owner/scope 隔离、重复注册、漏 dispose、stale disposer/generation、callback throw/rejection 与共享异步管线失败、ordered reducer 可重复性与顺序依赖、coordinated stale fencing/CAS/transaction、exclusive preflight 副作用前拒绝、authority closure 与显式 bypass、pure view 无写 authority 泄漏；client slot/remote/settings/lifecycle 同等级矩阵（§15③）。
  - **7.8 services 分级测试**：静态白名单成员、member-level availability、官方 receiver/argument/return/error 保留、未登记运行时成员不暴露（§15④、§9）。
  - **要求**：加固只给最终保留成员的最小机制，不建通用权限系统/全局 owner graph/全局排序依赖图/通用 migration 平台（goal Out Of Scope）；全部组合矩阵与领域测试全绿。

- [ ] **8. 消费者与装配对账（requirements §13、§14；design §Consumer And Boot Acceptance）**
  - **8.1 消费者迁移——`dsh-read-image`**（工作区外仓库 `agent/dsh-read-image`）：迁移为只使用目标领域 facade path（image admission、request transformation、settings/remote、execution route access），删除对应私有 monkey-patch、raw `llm/stream` 重入 owner、私有 route 遍历（设计 §Current-State Findings 8 与 §14 验收）；迁移后其 hack 代码不得以 dormant fallback 或 unsupported escape hatch 留存（§14 末三条）。
  - **8.2 消费者迁移——`dsh-pro-ex-ability-anchor`**（工作区外仓库 `agent/dsh-pro-ex-ability-anchor`）：迁移 session append、prompt 事件、settings remote、services、panel client 到目标 path；移除手写协议胶水；panel 不再使用 `ctx.pluginApi.client`（§3、§14）。
  - **8.3 迁移契约外行为**：任一消费者需要批准契约外的行为时，保留既有官方 path 或单独 proposal，不得隐式拓宽 M7 公共契约（§14）。
  - **8.4 装配等价与安装模式**：验证 full bundle（`packages/full/cordis.patch.yml`）与 main+全部辅助包选择性安装装配出同一组主包行/替代行/行为，无双跑、无替代行语义改变（§13）；main-only 安装下缺失可选能力显式 unavailable 且不影响无关能力；辅助包 `A.B.C` 错配只停用该能力、官方行不处于「disabled 且无功能替代」空洞、主门面与无关包保持 active；卸载恢复官方行；反向受支持插件顺序行为确定（§13、§15⑤）。
  - **8.5 消费者验收测试**：两个消费者的 headless 冒烟与文档化 dev boot 在冻结基线 `0.1.0-rc.6-0.1.0` 上通过、无 activation 错误（§14）；保留相关 message ordering、route absence、prompt 组合、provenance、client remote/slot、typed unavailable/failure 行为（§14）。
  - **要求**：迁移以真实消费者仓库代码为准，in-facade fixture 或 synthetic substitute 不满足迁移验收（§14）；消费者仓库的改动与验证记录在最终报告列出。

- [ ] **9. 终验、登记与交付（requirements §15、§16；AGENTS.md §3.2/§6/§8）**
  - **9.1 全量验证**：`npm test` 全绿（含既有全部测试与 M7 新增）；`git diff --check` 通过；官方包修改审计（`/usr/lib/node_modules/@deepseek-ai/dsh/**` 未被修改）通过；headless 冒烟与 dev boot 通过；任一验证失败/超时/无法建立证据按阻塞处理（§15 末条）。
  - **9.2 registry/文档/登记同步**：registry 与 public contract registry 输出（类型/快照/fixtures/参考片段）一致且为同一事实源；`docs/specs/plugin-api-features/feature-list.md` 登记本 feature（spec 链接、状态、关键约束/设计、删除报备链接；R 类涉及项按 §3.1 口径）；AGENTS.md / `docs/standards/` 需要同步的链接与 §8 登记项同步；删除报告与批准记录归档于本 feature 目录。
  - **9.3 规格制品回写**：核对 requirements/design/tasks 与交付一致；执行中发现的 spec 细节偏差就地修订对应文档并在最终报告列出（动摇 Goal/Requirements 验收边界的偏差必须暂停请示，不得擅改）。
  - **9.4 全局终审（阻塞）**：全部顶层任务完成后，调用一次只读阻塞式全局终审（核对整个 Stage 4 交付与 Tasks/Design/Requirements 的一致性，并按 `docs/standards/` 与 `docs/standards/refactor/` 适用分册比对规范符合性）；返回「无偏差」后才可交付；有意见则在整体范围内集中修订后再次全局终审，直至通过。
  - **9.5 Stage 4 完成提交**：终审通过后提交本 Stage 全部实现、测试、registry、规格制品修订与登记（先 `git diff --check`）；提交后工作区保持干净；交付最终结果报告（含任务完成情况、spec 偏差修订列表、删除批准记录、消费者迁移记录）。
  - **要求**：交付物全绿 + 终审无偏差 + 完成提交 + 工作区干净，才可宣告 Stage 4 完成。