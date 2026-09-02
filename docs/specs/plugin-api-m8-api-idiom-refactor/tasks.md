# Stage 3 — Tasks

> 公共契约现状注（2026-09-02）：本文第 3.7 条记录的是 M8 当时尚未交付 `events.define` 的边界；后续 policy-enforcement-closure 已交付合作型 publisher handle。本文已批准的 M8 验收边界不变，现行状态以 canonical registry 及后续交付报告为准。

## Status

SPEC3 Stage 3：本任务书承接已确认的 `goal.md` / `requirements.md` / `design.md`（Stage 0–2 已获用户确认：goal / requirements / design 分别于 2026-08-31 批准，design 在 SPEC2 契约细化后于同日获批准）。本文按 AGENTS.md §3.2 以对抗性审查为门；审查返回「无偏差」后直接进入 Stage 4，不设用户确认门。

**并行纪律**：M8 全程串行（design §Implementation Sequence：「The sequence is serial」）。不派发并行契约、不使用并行 worktree。任何任务不得修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 或任何官方包文件。

**条件性人类门（非默认门）**：按 requirements §12 第 6 条与 design §Migration And Deletion Ledger，默认不设删除批准门；仅当实现过程中发现某个候选删除会改变已批准的 Goal 或 Requirements 验收边界时，才暂停该子任务并请求人类边界裁决。除此情形外 Stage 4 不中断。

## 需求锚点

任务引用 `requirements.md` 各节（`§N` 为节号）：

- §1 Member Contract Registry / §2 Idiom Classification And Naming / §3 Projection / §4 Policy / §5 Mutation / §6 Operation / §7 Contribution / §8 Resource Registry / §9 Coordination / §10 Self-Description And Availability / §11 Event Semantics And Producer Authority / §12 Public Surface Migration And Deletion / §13 Host And Client Parity / §14 Owner, Scope, Lifecycle, And Concurrency / §15 Composition And Authority / §16 Capability Conservation And Services Audit / §17 Implementation Channel And Capability Boundaries / §18 Verification, Consumer Migration, And Delivery Gates。

## 冻结决策（源自 design，实现须逐项遵守）

1. **基线冻结**：沿用 M7 冻结基线 `packageVersion = 0.1.0-rc.6-0.1.0`、`api = 0.1`、`frozen = true`；M8 不因公共 path 变化新建版本边界（design §Wire And Durable Records）。
2. **registry 原地扩展**：唯一事实源仍为 `docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`。不得新建平行 registry；registry 只作为构建期/测试期数据，不成为运行时服务、权限系统或 schema 迁移平台。
3. **成员记录字段全集**：每个叶子记录必须携带 design §Member Contract Entry 的全字段；不适用字段记显式 `null`，不得省略（requirements §1 第 2 条）。
4. **idiom 词表**：八个标准 idiom（`projection`、`policy`、`mutation`、`operation`、`contribution`、`resourceRegistry`、`coordination`、`selfDescription`）加唯一的例外值 `passthrough-exception`；后者仅允许出现在以 `services.` 开头的 public path 上，且与八 idiom 双向互斥（requirements §1 第 4 条、§2 第 1 条）。
5. **namespace 集合**：公共 namespace 集合等于 registry `namespaces` 导航记录集合，不由 path 深度隐含推导。每条导航记录必须二选一：`availabilityMember` 命名该 namespace 的 `availability()` 叶子，或 `availabilityExemption` 非空（`services.*` 直通 namespace 的豁免理由为「官方 passthrough 面不获得门面 availability 语义」）。导航记录只承载导航事实，不承载 idiom 或语义分类。
6. **handle 叶子独立登记**：公开 handle 成员作为独立 registry 条目；父条目与 handle 条目 idiom 可不同，但必须显式表达，遗漏即缺陷。
7. **统一命名词表**：`ok` / `code` / `reason` / `id` / `ownerId` / `generation` / `seq` / `observedAt` / `epoch` / `dispose()`；禁用 `success` / `result` / `status`（作成功标志）、`errorCode` / `kind` / `message`（作调用方文本）、`key` / `name`（作身份）、`owner` / `revision` / `version` / `index` / `at` / `timestamp`、`close()` / `remove()` / `unsubscribe()` / `revoke()`（handle 销毁）。唯一登记例外：coordination 租约 handle 的归还是入口动词 `release(handle)`，该 handle 不提供 `dispose()`。
8. **能力守恒 `status`**：六值封闭词表 `retained` / `renamed` / `merged` / `migrated` / `deleted` / `gap`，是守恒校验唯一读取字段；复合信息写入 `qualifiers`（`shape` / `split` / `reclassified` / `internalized`），不得写进 `status`。
9. **事件三 idiom 归属**：`events.catalog()` 为 selfDescription 查询；`events.observe` 为 projection 订阅；派发成员为 operation 的 dispatch 变体。派发的 operation identity 与 retry 两条契约条目记 `null` 并注明理由（一次派发无独立身份、永不重试），返回值改为判别式派发结果。decision 事件按 policy 事件式变体补齐三项：决策优先顺序、冲突收敛规则、listener 抛错时的 containment 与默认决定。
10. **coordination 全异步**：`acquire` 返回租约句柄（`id` / `resource` / `generation` / `fencingToken` / `expiresAt`），句柄是凭证不提供 `dispose()`，归还通过入口动词 `release(handle)`；重复 release 幂等；stale 条件以 `code: 'conflict'` + `reason` 表达，`stale` 不作机器码。同步有界借用只把 expiry 与 takeover 两条契约条目记为不适用，不豁免异步要求。
11. **治理魔法字母不进入实现**：`lib/` / `packages/` / `test/` / `scripts/` / `package.json` / patch 文件与运行时可见字符串中，不得出现治理编号、分类字母、feature 名、需求号或工作流代号（AGENTS.md §6）。生成制品只含中立领域/能力名。
12. **语义分类先于形状改造、结构迁移先于语义加固**：先冻结每个叶子的唯一主 idiom，再做形状迁移；先建立目标 path 与保留成员，再补 CAS / fencing / retry / 取消担保。

## 任务清单

### [ ] 1. Wave 1 — 基线与完整成员清单（requirements §1、§12、§13、§16；design §Wave 1）

- [x] **1.1 基线核验**：校验 `contractBaseline.packageVersion === '0.1.0-rc.6-0.1.0'`、`api === '0.1'`、`frozen === true`；主包与本地包 `package.json` version 与 `dsh.api` 与之一致；不为 M8 bump 版本。产出核验结论并记为 Wave 1 证据。
- [x] **1.2 Host 叶子枚举（事实来源优先）**：以 `lib/plugin-api-service.js` 的各 `createDisabled*Api` 面与各条件面（`createConditionalMcpSurface` / `createConditionalAttachmentsSurface` / `createConditionalRoutePolicySurface` / `createConditionalLlmAdaptersSurface`）、`_publishRoutingSurface`、以及各域 slice（`host-remote.js`、`storage-binding.js`、`services.js`、`official-host-namespaces.js`）为事实来源，逐域枚举当前公共叶子，至少覆盖：root（`isActive` / `apiVersion` / `assertCompatible` / `capabilities`）、`events`、`llm`（含 `requestTransforms` / `admissionPolicies` / `adapters` / `routing` 的 `policies` / `candidates` / `health` / `circuit` / `decisions` / `forExecution` / `current` / `on` / `once` / `wait`）、`agents`（含 `providers`）、`executions`（含 `recovery` 的 `capability` / `policy` / `visibility` / `adapters`）、`sessions`（含 durable / `branches` / `channels` 的 `auth` / `redaction`）、`tools`（含 `discovery` 的 `catalog` / `audit`）、`skills.activation`、`prompts`（含 `provenance`）、`attachments`（`pipeline` / `projection`）、`mcp`、`tasks`、`coordination`、`workspaces.transactions`、`security`（`policy` / `redaction` / `egress` / `audit`）、`diagnostics`、`settings`（含 `remote`）、`profiles`（含 `snapshot`）、`remotes`、`storage`、`services.*`。
- [x] **1.3 Client 叶子枚举**：以 `lib/client-runtime.js` 的 `m3Members` / `buildClient` / root 定义属性与 `CLIENT_CAPABILITY_PATHS` 为事实来源，枚举 `connection`（含 `api`）、`events`（含各官方事件面与 `on`）、`remotes`、`settings`（含 `remote`）、`slots`、`lifecycle`、`codec`、`services.*` 以及 root 四个自述成员。
- [x] **1.4 Client lifecycle 与 codec 逐叶子枚举**：按 requirements §13 第 7、8 条与 design §Client，逐个列出 `lifecycle` 与 `codec` 的公共叶子并给出 idiom 归属；`codec` 不得把原始 schema 库实例作为公共 API 暴露。未枚举的 client 叶子不得视为已登记公共成员。
- [x] **1.5 公开 handle 叶子枚举**：枚举各注册/订阅/操作/租约 handle 上可观察的成员（policy handle、resource handle、contribution handle、operation handle、coordination lease handle、transaction handle、storage binding handle、projection observe handle），逐成员建条目。
- [x] **1.6 落地 `member-inventory.json`**：在本 feature 目录产出机器可读清单，每行一个 current 叶子 / target 叶子 / handle 叶子，字段至少含 `publicPath`、`runtime`、`currentShape`、`targetPath`、`idiom`、`migrationAction`、`shapeNote`；与 `docs/standards/refactor/member-inventory.md` 的表格一一对应，表格未覆盖的实现叶子由本任务补齐。
- [x] **1.7 枚举 `services.*` 白名单现状**：列出 host 与 client 两侧 `servicesWhitelist` 现有条目，标注保留/迁移/删除候选，作为 §16 成员级审计输入。
- [x] **1.8 缺口解决门**：以上枚举中任何无法从实现事实确定的叶子必须在 Wave 1 内解决（补齐或记为明确缺口），未解决的叶子不得进入 Wave 2。

- **要求**：本 Wave 只产出清单与数据，**不改变任何运行时公共 path**；不得创建运行时 registry 服务。

### [ ] 2. Wave 2 — Registry 契约与机械证据（requirements §1、§2、§10、§11、§14、§16、§18；design §Registry Contract And Validator）

- [x] **2.1 扩展 `vocabulary`**：新增 `idiom`、`eventSemantics`、`semanticFace`、`failureSemantics`、`conflictRule`、`migrationAction`、`lifecycleState`、`coordinationCode`、`concurrency`、`reducer`、`qualifier`、`operationTerminal` 等词表；保留 M7 既有词表（`runtime` / `effect` / `composition` / `availability` / `status` / `terminal` / `priority` / `scope` / `implementationChannel` / `deletionCategory`）不回退。新增词表必须给出封闭取值集合，其中 `migrationAction` 取值集合固定为 `rename` / `merge` / `split` / `migrate` / `delete` / `internalize` / `retain`；`gap` 不是迁移动作值，只作为 `capabilityMatrix.status` 的取值。
- [x] **2.2 `members` 升级为叶子级**：按 1.2–1.5 的清单把 `members` 从 namespace 级扩展到叶子级；每条含 `publicPath`、`targetPath`、`capability`、`idiom`、`idiomExceptions`、`eventSemantics`、`semanticFace`、`effect`、`composition`、`runtime`、`implementationChannel`、`authority`、`scope`、`resourceKey`、`identitySource`、`conflictRule`、`lifecycle`、`failureSemantics`、`idempotency`、`retryLayer`、`availabilityShape`、`concurrency`、`reducer`、`currentShape`、`migrationAction`、`status`、`verification`；不适用字段一律显式 `null`。
- [x] **2.3 新增 `namespaces` 导航记录**：每个公共 namespace 一条，含 `namespace`、`runtime`、`capabilityPath`、`contributingFeatures`、`availabilityMember`、`availabilityExemption`；按冻结决策 5 二选一。**namespace 前缀闭包规则（供 2.7 机械校验）**：`namespaces` 记录的集合显式声明公共 namespace 全集；成员 `publicPath` 的某级前缀属于该全集者必须有导航记录，不属于全集的中间前缀只是路径分组、不产生记录义务，也不得据此把中间层隐含升为公共 namespace。多 feature 组成的 namespace 必须列出全部 contributing feature；导航记录不得携带 idiom 或语义分类。
- [x] **2.4 新增 `capabilityMatrix`**：每个能力簇一条，含 `capabilityCluster`、`currentPaths`、`targetPaths`、`status`、`qualifiers`、`replacement`、`gapReason`、`affectedConsumers`、`verification`；`status` 六值唯一且为守恒校验唯一读取字段，`qualifiers` 只取登记词表（`shape` / `split` / `reclassified` / `internalized`）且不得改变守恒类，`deleted` 必须带 `replacement` 或 `gapReason`，`gap` 必须说明缺失能力性质与所需上游/替代性质；一个能力簇的 retained 部分与未证明部分无法用单一 `status` 表达时，必须记为两行 capability 记录，不得写入复合 `status`（requirements §16 第 1/2 条）。
- [x] **2.5 扩展 `eventCatalog`**：每条事件含 `name`、`eventSemantics`、`scope`、`payloadShape`、`freeze`、`priority`、`observerFailure`、`producerAuthority`、`dispatch`、`implementationChannel`；decision 事件额外含 `decisionPrecedence`、`conflictConvergence`、`listenerFailureDefault`。
- [x] **2.6 扩展 `oldToTargetMapping`**：覆盖全部 current→target，含 `action`（rename / merge / split / migrate / delete / internalize / retain）与关系说明；删除条目的 `targetPath` 记 `null`。
- [x] **2.7 扩展 `scripts/registry-validate.mjs`**（纯 Node、零 harness 依赖），至少校验：
  - 必填字段齐全，不适用者必须为显式 `null`；
  - `idiom` 属于八 idiom，或当且仅当 public path 以 `services.` 开头时为 `passthrough-exception`（双向互斥）；
  - current / target public path 与 capability path 唯一；
  - handle 叶子存在，且允许与父条目 idiom 不同但必须显式表达；
  - 每条 `idiomExceptions` 非空时必须含 `memberPath` / `baseContract` / `exception` / `reason` / `replacementShape` / `verification` 六项，缺一即无效；
  - 命名词表与统一字段名（含 `release(handle)` 唯一 `dispose()` 例外）；
  - 同一 idiom 的外层 `failureSemantics` 与冲突结果形状一致，领域 `concurrency` / `reducer` 差异必须显式登记；
  - `generation` / `seq` / `epoch` 语义不串用；
  - 事件语义、生产权、priority 词表与派发条目；
  - namespace 导航记录的 `availabilityMember` 返回形状含 `status` 或存在非空 `availabilityExemption`；且成员 `publicPath` 的每一级前缀中凡 registry 声明为公共 namespace 者，都必须有对应导航记录——未登记 namespace 或未登记的豁免均为契约缺陷（requirements §10 第 7 条）；仅为路径分组、未被声明为公共 namespace 的中间前缀不产生记录义务，该规则在 2.3 中以 namespace 前缀闭包形式声明以便机械判定；本校验取值面限于 registry 自身导出结果，运行时公共面的等价性由 9.1 的 registry/surface 一致性检查证明；
  - `capabilities.get(path)` 把每个 capability path 映射到 `active` / `degraded` / `unavailable` 三值之一；
  - `capabilityMatrix` 每个簇恰一个 `status`、`qualifiers` 合法、`status` 内无复合标签；
  - 同一 public path 的 `members[].migrationAction` 与 `oldToTargetMapping[].action` 一致；`gap` 只允许出现在 `capabilityMatrix.status`，不得作为迁移动作值；
  - host/client 声明 parity 的成员外层契约对齐；
  - `recommended` 成员的组合/authority 证据完整。
- [x] **2.8 扩展 `scripts/registry-snapshot.mjs`**：从同一 registry 生成中立制品——host/client 公共面快照、按 idiom 分组、handle 成员、capability 状态、service fixture、事件权威、推荐 profile、migration diff、composition matrix。生成器不检查任意运行时对象、不发现未登记官方成员。
- [x] **2.9 治理 token 扫描测试**：扫描 `lib/` / `packages/` / `test/` / `scripts/` / `package.json` / patch 文件与生成制品，断言无治理编号/分类字母/feature 名/需求号泄漏（冻结决策 11）。
- [x] **2.10 负向测试**：未登记叶子、非法 idiom、path alias、generation/seq/epoch 语义混用、未登记官方 service、六字段缺失的 idiom 例外、namespace 既无 availabilityMember 又无豁免、namespace 无 registry 导航记录、capabilityMatrix 复合 status、`migrationAction` 与 `oldToTargetMapping.action` 不一致、`gap` 被用作迁移动作值——均能被引擎与测试判定为缺陷。

- **要求**：registry 与快照/类型是同一事实源；不得另造平行 registry。

### [ ] 3. Wave 3 — 共享外层契约与事件语义（requirements §3 第 2/3/5 条、§6、§11；design §Event Semantic Adapter / §Shared Internal Mechanisms）

- [x] **3.1 私有外层契约 helper**：冻结结果与冻结视图构造、typed unavailable / conflict 结果与错误、owner identity 从调用上下文派生、generation/seq/epoch 生成与 stale 判定、取消信号组合、listener containment。helper 保持 facade/领域私有，不成为通用 SDK 或权限引擎。事件面本 Wave 只消费冻结视图与 listener containment（与 typed error）；其余 helper 随其消费域（Wave 4–6 的 projection / policy / operation / coordination 面）就地复用或扩展既有领域模块，不在本 Wave 预造。
- [x] **3.2 `events.catalog()`**：由 getter 改为纯自述查询函数，返回冻结的门面事件词表自述；不改变事件名协议。
- [x] **3.3 `events.observe`**：`on` / `once` 合并为标准投影订阅入口，句柄提供 `current()` / `subscribe(listener)` / `dispose()` / `epoch`；重复 dispose 幂等、不再通知已废弃 listener、不影响其他订阅者；listener 抛错/reject 只收敛到该 listener。
- [x] **3.4 派发为 operation dispatch 变体**：`emit` / `serial` / `parallel` / `bail` / `waterfall` 返回判别式派发结果而非 `undefined`；派发结果与 operation 同外层契约。
- [x] **3.5 派发的两条不适用登记**：operation identity 与 retry 契约条目记 `null`，理由为「一次派发无独立身份且永不重试」。
- [x] **3.6 decision 事件三项补齐**：登记决策优先顺序、冲突收敛规则、listener 抛错时的 containment 与默认决定；其余 failure/conflict 契约与 policy 一致。fact / observation / notification 事件不得因同一总线而获得决策语义。
- [x] **3.7 生产权分离**：canonical 事件派发只由其 producer authority 调用；普通订阅者不因订阅获得派发权。owner-scoped 自定义发布器 `events.define(spec)` 在当前 runtime 无法强制 owner scope 时登记为 unavailable/proposal，不得描述为已存在。
- [x] **3.8 测试**：catalog 冻结自述、observe 句柄与幂等 dispose、派发判别式结果、listener containment、生产权拒绝、自定义发布器 unavailable 登记。

### [ ] 4. Wave 4 — Projection 与 Self-Description 面（requirements §3、§10；design §Wave 4 / §Availability And Capability Presence）

- [x] **4.1 读取路径迁移**：低风险读取/观察路径迁到 `get` / `list` / `inspect` / `history` / `observe`，返回冻结只读视图或 typed unavailable 结果；缺失或降级通过文档化的 unavailable/degraded 视图表达，不抛穿调用方。本 Wave 新增的 observe 订阅面（llm.routing.observe / mcp.observe / coordination.observe / diagnostics.observe / sessions.durable.observe）已按冻结决策 6 登记 handle 行；其标准投影句柄形状（current/subscribe/dispose/epoch）随 Wave 5–6 的共享句柄契约落地，registry 以 handle 行 currentShape 如实记录本阶段形状。
- [x] **4.2 namespace `availability()`**：按 2.3 的导航记录，为每个公共 namespace 提供返回冻结 `{ status, ... }` 的 `availability()`，`status` 恰为 `active` / `degraded` / `unavailable`；不可用 namespace 保持形状兼容并报 `unavailable`，不因 backing 缺失而消失。
- [x] **4.3 capabilities 与 capabilityMatrix 分离**：`capabilities.get` / `list` / `require` 描述公共能力存在与当前状态（三值），不暴露内部 mounter/包名/替代行/可写 registry 对象；能力矩阵另用 `capabilityMatrix()`，不与 availability 混用；`capabilities.require` 对缺失能力抛 typed capability-unavailable 错误。
- [x] **4.4 移除业务结果内嵌 availability**：判别式业务结果不得内嵌 availability 字段；availability 唯一公共入口是 namespace `availability()`（coordination 为 `availability(scope)`）。本 Wave 已从 tasks / workspaces.transactions 的判别式结果移除 availability（durability/epoch 由 namespace availability() 承载）；coordination 租约结果的 availability 内嵌由 Wave 6（6.3/6.5）移除。
- [x] **4.5 官方只读 helper 处置**：没有门面语义担保的官方只读 helper 迁到经审计的 `services.*`，或保留并在 registry 显式登记其 passthrough 性质与理由。
- [x] **4.6 测试**：冻结视图、observe 句柄、availability 三值与幂等无副作用、capability 三值映射、业务结果无内嵌 availability、移除重复暴露。

### [ ] 5. Wave 5 — Policy / Resource Registry / Contribution 面（requirements §4、§7、§8；design §Wave 5）

- [x] **5.1 Policy 迁移**：决策注册统一 `register(spec)`，回调命名 `decide(context)`；成功返回含 `id` / `ownerId` / `generation` 与身份绑定幂等 `dispose()` 的 handle；同 owner 同 id 再注册按 latest-wins 换代，不同 owner 抢同一冲突键以 typed owner-conflict 错误拒绝；注册冲突或违约抛 typed 注册错误（`conflict` 子类用于身份/键冲突），不返回 `ok:false` 判别式或 no-op disposer；被注册 policy 必须在其声明的决策点被自动咨询（按 reducer/priority/invocation bound）；决策点无法被当前 runtime 咨询时不得暴露咨询式成员，改记 capability gap 与所需迁移性质；callback 抛错/reject 收敛并套用该决策点的默认决定。本 Wave 的读侧 policy 注册（tools.restrict/guard、channels.auth、skills.activation.policy、llm.requestTransforms、routing health.circuitPolicy、recovery 等）经 register 入口落地；门面自有注册表（admissionPolicies、routePolicy replacement、事件决策等）维持其 owner/generation/冲突语义，官方直通注册保留官方身份与语义（A-class 绑定规则），其 owner/latest-wins 语义随官方注册面。
- [x] **5.2 Resource registry 迁移**：一张语义注册表只暴露 `register` / `get(id)` / `list(filter?)`，不按注册物种类拆分入口动词；handle 含 `id` / `ownerId` / `generation` 与幂等 `dispose()`；同 owner 同 id 同内容幂等返回既有 handle，同 owner 同 id 不同内容抛 typed `conflict`，不同 owner 争同一共享键抛 distinct owner-conflict；dispose 后再注册开启新生命周期，不视为上一代的 stale 更新；查询侧登记为 projection，不改变注册冲突语义；backing service 不可用用声明的 unavailable 失败形状，不静默声称已注册。
- [x] **5.3 Contribution 迁移**：可撤销装配输入统一 `contribute(spec)`，返回含 handle（`id` / `ownerId` / `seq` / 幂等 `dispose()`）的判别式结果；同 owner 在原 contribution 仍 active 时重复提交同一 id 返回判别式冲突结果（稳定 `code` 区分冲突与非法输入）、不抛、不做 latest-wins 替换；dispose 或 eviction 后不再参与后续装配结果，eviction 产出可观察事件或文档化 outcome，不静默移除；异步 pending 的 contribution 允许在完成前安全 dispose，完成不得泄漏官方 disposer 或复活 stale contribution；被装配消费的 contribution 不作为持久领域事实，除非另有 mutation 显式记录。
- [x] **5.4 混合成员先拆分**：跨两个交互模式的成员先拆分为独立成员，或补六字段 `idiomExceptions` 与验证证据；runtime 不咨询的注册不得表现为自动生效。
- [x] **5.5 测试**：policy/resource/contribution 的 handle 形状、owner 派生、latest-wins、owner 与内容冲突、idempotent dispose、contribution seq 与 eviction 可观察、咨询式入口不存在、callback 失败收敛与默认决定。

### [ ] 6. Wave 6 — Mutation / Operation / Coordination 面（requirements §5、§6、§9、§14；design §Wave 6）

- [x] **6.1 Mutation 迁移**：业务写入返回冻结判别式结果，含 `ok` / `code` / `commitState`，使用 CAS/fencing 的领域带 `generation`；业务拒绝/冲突/拒绝写入返回文档化判别式结果而不抛穿；非法入参/违约/不可恢复编程错误抛 typed 错误；已 commit 的事实不提供静默撤回的 disposer， reversal 必须走显式补偿操作或 mutation；多步写入的 `prepare` / `record` / `commit` / `rollback` 中，`prepare` / `commit` / `rollback` 登记为 operation、`record` 登记为 mutation；终态后重试返回既有终态并带 `idempotent: true`，不产生第二个事实；不可用通过 namespace `availability()` 或 typed unavailable 结果表达，不用返回 `undefined` 表达不可用。
- [x] **6.2 Operation 迁移**：启动返回判别式 outcome（`ok` / `code` / `operation` / `terminal`）或含 `id` / `ownerId` / `status()` / `observe()` / `dispose()` 的 handle；handle dispose 只请求停止、不声称已停止，后续结果发布受 operation identity / owner / generation / terminal 状态守卫；取消/被取代/被拒绝/不可用/失败的 terminal 使用标准词表（`aborted` / `superseded` / `denied` / `error` 或文档化 unavailable 结果），timeout 产生 `terminal: 'error'` 并把 timeout provenance 放进 `reason`，不新增独立 terminal 值；内部重试保留 operation identity 并加 `attempt`，调用方外部新启操作创建新身份；领域资源竞争在 registry 登记 `concurrency`（`exclusive` / `latest-wins` / `queue` / `compare-and-swap` / `deduplicate`）连同 resource key 与裁决点，外层形状仍为 operation 判别式 outcome；入口不可用返回 typed unavailable 且不抛穿；transaction / storage binding handle 以 `record` / `preview` / `commit` / `rollback` 或 `purge()`（显式登记为 mutation 扩展）扩展标准 operation handle，不引入 `close` / `finish` / `settle` 作为销毁动词。
- [x] **6.3 Coordination 迁移**：动词取自 `acquire` / `heartbeat` / `release` / `takeover` / `compareAndSet` / `observe` / `availability`，全异步；`acquire` 返回租约 handle（`id` / `resource` / `generation` / `fencingToken` / `expiresAt`），handle 视为凭证、不提供 `dispose()`，只通过入口动词 `release(handle)` 归还；重复 release 幂等；stale handle 的 heartbeat 或状态变更返回 `code: 'conflict'`（coordination 码词表 `inactive` / `invalid-input` / `conflict` / `unavailable` / `unsupported`）并把 stale 条件放进 `reason`，不抛穿；takeover 请求必须携带要求的 expected proof 并记录跨 owner 接管的 reason 与 provenance；`availability(scope)` 返回 `{ status, scope, durability, operations, backend, epoch }` 并显式声明 backing 是否真的提供持久性，不内嵌业务结果；仅内存或有界 scope adapter 诚实报降级，不声称持久协调；同步有界借用把 expiry 与 takeover 两条契约条目记为不适用，其余契约不变（含异步要求）。
- [x] **6.4 领域 authority closure 与并发守卫**：对保留成员补齐 owner/scope/authority closure、取消信号组合（保留调用方 `AbortSignal`，只追加本地取消源）、terminal 后不重启重试、stale 诊断有界且非权威、只 dispose 当前 owner/generation 创建的资源。实现来源：既有领域守卫（事务 settle/commit 的 terminal 门、租约 validateLease 的 stale fencing、watch/observe 的 AbortSignal 组合）；组合级验证由 8.5 承载。
- [x] **6.5 测试**：mutation commitState 与幂等重试、operation terminal/attempt/cancel/stale、coordination 租约/release 幂等/stale conflict/takeover proof/availability 诚实降级、CAS 与 transaction rollback、显式 compensation、领域 authority closure 与显式 bypass。

### [ ] 7. Wave 7 — 公共面减法与 Host/Client 对账（requirements §12、§13、§16；design §Wave 7）

- [x] **7.1 移除旧 path（requirements §12 第 1/2/3/5 条）**：目标形状稳定后，对迁移清单中 `migrationAction` 为 rename / merge / split / migrate / delete / internalize 的每个条目执行处置——rename / merge / split / migrate 条目删除旧 path 并让其 `targetPath` 以目标 idiom 形状暴露；delete 条目删除旧 path 且不留下替代入口；internalize 条目把成员移出公共面、不作为公共入口保留；多个现存入口表示同一能力时按能力矩阵合并并只保留该能力一次；一个现存入口横跨多个 idiom 时拆分为 idiom 专属成员或补六字段 `idiomExceptions` 与验证证据。实施任何 destructive 删除前，该项的 registry 状态、capability matrix 处置与受影响消费者引用必须已在迁移清单或迁移账本中登记；未登记者不得实施（design §Migration And Deletion Ledger）。核验基线为 `docs/standards/refactor/api-migration.md` §1 删除表与 §2.2 退为内部机制表。本子项的判定口径是「旧 path 已从公共面消失；rename / merge / split / migrate 条目另需其 `targetPath` 以目标 idiom 形状暴露；delete 条目另需该能力簇在 capability matrix 中记有 `replacement` 或 `gapReason`；internalize 条目另需该成员未在公共面以任何别名重现」，不涵盖残留形态的排查。
- [x] **7.2 残留形态禁令核验（requirements §12 第 5 条；goal Out Of Scope）**：独立扫描「公共面与实现」两侧并确认——不存在任何以兼容 alias、deprecated forwarding property、hidden public alias、silent no-op、dormant fallback 或隐藏兼容分支形式残留的旧入口；内部机制泄漏面、重复官方转发面、以及策略未被自动咨询的咨询式入口均已被移除；只服务门面内部流程的成员已被内部化而非保留为公共入口。核验基线为 `docs/standards/refactor/api-migration.md` §1 删除表、§2.2 退为内部机制表，以及 §7 表后「一律按 §1 删除，不留咨询式入口」的结论文。本子项单独判定，不得与 7.1 的移除动作共用判定结论。若发现某删除动摇已批准的 Goal/Requirements 边界，在**实施该删除前**暂停并请求人类边界裁决（requirements §12 第 6 条；本 feature 默认不设删除批准门，仅此条件触发）。
- [x] **7.3 重建 host/client 公共面快照与类型**：从 registry 重建；移除公共 `.client` 包装；官方 browser leaves 只留在 registry 声明的 `services.*` 下。
- [x] **7.4 重建并检查检入的 client bundle**：保证静态 manifest 与检入 bundle 边界不被破坏，模块加载器身份不变。
- [x] **7.5 对账项**：`services.*` 成员级白名单（未审计的官方成员即使可在 runtime service 对象上发现也不得暴露）、host-first redaction 先于序列化、client codec 在 redaction 之后校验声明的 wire 形状、可选能力隔离只影响其 owner 成员、lifecycle/codec 逐叶子已枚举并赋 idiom、无未登记公共叶子。
- [x] **7.6 迁移账本（含删除与 gap 记录）**（requirements §12 第 4 条；`docs/standards/refactor/capability-matrix.md` 作为守恒验收基线）：在本 feature 目录产出 `migration-ledger.md`，覆盖 rename / merge / split / migrate / delete / internalize 各类处置与 gap 能力簇、每个删除的 replacement 或 gap reason、受影响的类型/快照/测试/包与 patch 文件/消费者、预期 unavailable 与失败后果、以及手动路径被自动替代时「触发/输入/输出/失败/可观察性」五维守恒证据；交付报告逐条列出全部删除项与 gap 能力簇。
- [x] **7.7 测试（三条独立断言，不得合并判定：7.7a 对应 7.1、7.7b 对应 7.2、7.7c 对应 7.5）**：
  - **7.7a 旧 path 移除断言**（对应 7.1）：三个分支分别判定——(a) 对 `migrationAction` 为 rename / merge / split / migrate 的条目，断言其旧 public path 已不存在于 host 与 client 公共面快照，且其 `targetPath` 以目标 idiom 形状存在；(b) 对 `migrationAction` 为 delete 的条目，断言其旧 public path 已不存在于两侧快照，且 capability matrix 中该能力簇记有 `replacement` 或 `gapReason`（`targetPath` 为 `null`，不作目标 path 断言）；(c) 对 `migrationAction` 为 internalize 的条目，断言其旧 public path 已不存在于两侧快照，且该成员未在公共面以任何别名重现（内部目标 path 不在公共面断言范围内）。
  - **7.7b 残留形态禁令断言**（requirements §12 第 5 条）：三条子断言分别判定，任一失败即 7.2 失败——(a) 公共面与实现中不存在兼容 alias、deprecated forwarding property、hidden public alias、silent no-op、dormant fallback 或隐藏兼容分支形态的旧入口；(b) 内部机制泄漏面、重复官方转发面、策略未被自动咨询的咨询式入口在 host 与 client 公共面快照中均已不存在（含 `migrationAction = internalize` 的条目）；(c) 只服务门面内部流程的成员在公共面快照中不存在，且未以任何公共别名保留。
  - **7.7c 对账断言**（对应 7.5，六项逐项断言，不再转指其他任务）：(a) `services.*` 白名单逐成员——未审计的官方成员未暴露；(b) host-first redaction 先于序列化——host 数据在发布到 client 前完成脱敏与冻结，client 侧收到的已是脱敏后载荷；(c) client codec 在 redaction 之后校验声明的 wire 形状，且 codec 不暴露原始 schema 库实例作为公共 API；(d) 可选能力隔离只影响其 owner 成员、不影响无关门面能力（与 8.4 的安装模式断言互补而非替代）；(e) `lifecycle` 与 `codec` 每个叶子均已枚举并赋 idiom（枚举来源 1.4，快照来源 2.8）；(f) 公共面无未登记叶子，client root 无 `.client` 包装。

### [ ] 8. Wave 8 — 消费者、安装与最终证据（requirements §17、§18；design §Consumer And Boot Acceptance）

- [x] **8.1 消费者迁移 — `dsh-read-image`**（工作区外仓库 `../dsh-read-image`）：改用目标公共 path（image admission、request transform、settings/remote、execution route 访问），删除对应私有 monkey-patch 与私有 route 遍历，迁移后不得以 dormant fallback 或 unsupported escape hatch 留存。
- [x] **8.2 消费者迁移 — `dsh-pro-ex-ability-anchor`**（工作区外仓库 `../dsh-pro-ex-ability-anchor`）：迁移 session append、prompt、settings remote、services、panel client 到目标 path，移除手写协议 fallback，panel 不再使用公共 `.client` 包装。
- [x] **8.3 契约外行为处置**：消费者需要批准契约之外的行为时，保留既有官方 path 或单独 proposal，不得隐式拓宽公共契约。
- [x] **8.4 装配等价与安装模式**：full 聚合 bundle 与「主包 + 显式选择辅助包」在同一基线装配出同一组主包行/替代行与行为，无双跑、无替代行语义改变；main-only 安装或可选辅助包不可用时只让受影响能力报 typed unavailable/disabled，不影响无关门面能力；`A.B.C` 错配只停用该能力且不让官方行处于「disabled 且无功能替代」空洞；移除替代后恢复官方行；反向受支持插件加载顺序行为确定。
- [x] **8.5 组合矩阵**：至少两个合成插件覆盖逆序注册/加载、同 owner/id 幂等与同/异 owner 冲突、owner 与 scope 隔离、重复注册与缺失 dispose、stale disposer/generation、callback 抛错与共享异步管线失败、ordered reducer 可重复性与声明的顺序依赖、协调租约过期/stale fencing/takeover proof/CAS/transaction rollback、exclusive 预检先于副作用拒绝、authority closure 与显式低层 bypass、纯 projection 不能改共享状态、client remote/slot/settings/lifecycle 等价项。
- [x] **8.6 消费者 headless 冒烟与文档化 dev boot**：按冻结基线通过且无 activation 错误，保留 route absence、message ordering、prompt 组合、provenance、client remote/slot、typed unavailable/failure 行为证据。若消费者仓库 `node_modules/@deepseek-ai` 指向官方共享安装树导致本地无法把门面接入解析路径，按 requirements §18 验收第 6 条的冒烟义务以阻塞记录处理（M7 交付同款先例，见迁移账本 §7b 与最终报告），不得伪造通过。
- [x] **8.7 能力守恒测试**：对每个能力簇断言恰一个最终 `status`、renamed/merged/migrated 有 target path、deleted 有 replacement 或 gapReason、自动替代证据覆盖触发/输入/输出/失败/可观察性、registry/快照/消费者引用中无未解释的现有 path。

### [ ] 9. 终验、登记与交付（requirements §18；AGENTS.md §3.2 / §6 / §8）

- [x] **9.1 全量验证**：`npm test` 全绿（含既有全部测试与 M8 新增，走护栏脚本，不用裸 `node --test`）；`git diff --check` 通过；官方包修改审计（`/usr/lib/node_modules/@deepseek-ai/dsh/**` 未被修改）通过；registry/surface 一致性检查通过；任一验证失败/超时/无法建立证据按阻塞处理。
- [x] **9.2 registry / 文档 / 登记同步**：registry 与其快照/类型/fixture 输出一致且为同一事实源；`docs/specs/plugin-api-features/feature-list.md` 登记本 feature（spec 链接、状态、关键约束/设计、迁移账本与删除账本链接）；`AGENTS.md` / `docs/standards/` 需要同步的链接与登记项同步；`README.md` 公共契约现状注同步。
- [x] **9.3 规格制品回写**：核对 requirements / design / tasks 与交付一致；执行中发现的 spec 细节偏差就地修订对应文档并在最终报告列出；动摇 Goal/Requirements 验收边界的偏差必须暂停请示。已知的待回写项：design §Migration And Deletion Ledger 的处置清单（当前为「rename, merge, split, migrate, delete and gap」）需补 `internalize`，与 2.1 词表 / 2.6 / 7.6 保持四处一致。
- [x] **9.4 全局终审（阻塞）**：全部顶层任务完成后，调用一次只读阻塞式全局终审，核对整个 Stage 4 交付与 Tasks/Design/Requirements 的一致性，并按 `docs/standards/` 适用分册（含 `docs/standards/refactor/` 目标分册）比对规范符合性；返回「无偏差」后才可交付；有意见则在整体范围内集中修订后再次全局终审，直至通过。
- [x] **9.5 Stage 4 完成提交**：终审通过后提交本 Stage 全部实现、测试、registry、规格制品修订与登记（先 `git diff --check`）；提交后工作区保持干净；交付最终结果报告（任务完成情况、spec 偏差修订列表、删除与 gap 记录、消费者迁移记录、阻塞记录）。

- **要求**：交付物全绿 + 终审无偏差 + 完成提交 + 工作区干净，才可宣告 Stage 4 完成。
