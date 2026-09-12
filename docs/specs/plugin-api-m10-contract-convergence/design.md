# Stage 2 Design: plugin-api-m10-contract-convergence

> feature_name: `plugin-api-m10-contract-convergence`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）。goal 于 2026-09-11 获批（M10 批量确认门）；本文与 requirements.md 同日交付。本文只定义设计与可验收方案，不创建 tasks.md、不写实现代码、不直接修改 canonical registry / docs/standards/ / feature-list。
> 上游输入：本目录 `goal.md`、`requirements.md`（同批）；M10 工作纲领 §3.10（十条设计决定）、§4（分工表）、§7（三张表 + 跨线故事 + 无损边界）、§8；M10 观察报告 §5 OBS-13/OBS-14、§6 纠正表、§7 闭合判据；`docs/standards/` 全部 12 分册；canonical registry 现状；九条 M10 线已交付制品（衔接点逐条引用见 §0）。

## Status

本文是 M10 整树收敛的设计：它产出目标语义树初版、逐成员映射方法与初版、idiom 归类初版与例外清单、全路径 authority 地图初版、OBS-14 归属判定、九线遗留对账、standards 实质修订清单（待人类确认）、装配与验收方案。定位约束（goal Boundaries）：不新增万能 runtime root、不新增 convergence namespace、不吞并产品插件、版本冻结。语义树与映射是**初版**：与九线已定 path 直接采纳，标注「Stage 4 probe 后固化」的开放项如实保留开放标记（OM-1…OM-7），不假装终稿。

## 0. 与九线制品的衔接索引

本文全部跨线结论以下列已交付制品为输入；引用格式 `docs/specs/<feature>/design.md` §章节：

| 线 | 衔接点（文件 + 章节） |
|---|---|
| session-plan-mode-control | design §Architecture（官方契约证据表）、§Namespace 放置、§Registry 拟新增行、§Authority Closure |
| session-permission-preset-control | design §Namespace 放置、§C3 写面、§Authority Closure（统一 + 互斥双分支）、§Registry 拟新增行 |
| credential-mutation-contract | design §Namespace 放置（一等领域论证）、§C4 revision 标记（B 类声明）、§Secret Visibility 表、§Registry 拟新增行 |
| compaction-operation | design §3.1 公共面放置、§3.2 门控、§3.4 R 类扩展点位、§3.5 码表、§3.9 装配顺序 |
| workflow-execution-contract | design §3.1 namespace 放置、§3.3 run handle（例外六元组）、§3.7 R 点位判定、§7 standards 结论 |
| decision-participation-contract | design §公共面与 path 决定、§逐点位保真表、§idiom 归类与例外登记、§横切派发语义与通道判定、§与既有等价面的分工矩阵 |
| llm-adapter-registration | design §registry 拆分与 rename/split 记录修正、§公共 path 候选与理由、§机制设计、§在途处置表 |
| scoped-agent-contributions | design §scope 表达与 scope-bound handle、§tools caller-bound 解析的复用判定与真实 fiber probe、§与 decision 线的组合边界 |
| interactive-session-access | design §Architecture（四面拆线）、§Existing Owner Reuse Matrix、§attachmentRefs Durable Mapping Contract、§Model Selection Snapshot Contract、§R-Point Design Statements |

## 1. 目标语义树（初版）

### 1.1 树的判据与输入

- 输入 = registry `hostDomainTree`/`clientDomainTree`/`members` 现状 + 九线已定 path。逐成员现状态的唯一事实源仍是 registry；本节只登记**新增/修正**成员，既有子树不复制逐叶子清单（public-api-shape §2 同纪律）。
- 一等领域判据（public-api-shape §1）：独立词汇 + 独立资源身份 + 独立使用场景。领域根挂靠判据：最近既有领域优先；`services.*` 只承载受限低层直通（capability-strategy §6）。
- 不新造万能 root：本树无 `runtime`/`convergence`/`misc` 类节点；每个新增节点都能指出其 bounded context。

### 1.2 host 树（标注 + 为九线新增，△ 为修正，(OM-x) 为开放标记）

```text
pluginApi
├── isActive / apiVersion / assertCompatible / capabilities          [不变]
├── events
│   ├── catalog / observe / define / emit / serial / parallel / bail / waterfall / availability  [不变]
│   └── decisions.register                                           [+decision 线；准入集枚举（fs/write-intent、fs/edit-intent、compaction/request、session-title/candidate）；OM-6]
├── llm
│   ├── modelInfo / prepareCall / stream                             [不变]
│   ├── requestTransforms.register / admissionPolicies.register      [不变]
│   ├── providers.register                                           [不变（configurable provider 登记）]
│   ├── models.register / models.list                                [+llm 线：models.list 统一只读目录 projection]
│   ├── adapters.register            △                               [+llm 线修正：交给真实 adapter route 登记（绑定官方 registerAdapter）；旧装饰实现迁出]
│   ├── adapters.list                △                               [+llm 线修正：真实 adapter 登记查询]
│   ├── adapters.register.handle     △                               [+llm 线修正：拆分为真实登记 handle 与 decorations handle 两行]
│   ├── adapters.decorations.register / .list / .register.handle      [+llm 线：装饰迁入，机制与独立身份不变]
│   └── routing.*                                                    [不变（policies/candidates/health/circuit/decisions/forExecution）]
├── agents
│   ├── get / list / roots / create / resume / register / providers / availability  [不变]
│   ├── scopes.acquire                                               [+scoped 线：scope-bound handle {id, ownerId, generation, target, status(), dispose()}；OM-2]
│   └── decisions.register                                           [+decision 线：point ∈ agent/pre-step | agent/request | agent/request-error；OM-1]
├── executions.*（observe/get/history/visibility/recovery/availability）  [不变]
├── sessions
│   ├── 既有查询/分支/通道/活动/持久子树                              [不变（逐成员以 registry 为准）]
│   ├── request / cancel             △                               [+interactive 线扩展：spec 增 message.attachmentRefs 与 delivery:'steer'|'queue'；cancel 接受 queuedRef；owner 与冲突语义不变]
│   ├── interactions.list / .get / .respond / .availability           [+interactive Face 2：受限视图 + 类型化应答；respond 为 operation]
│   ├── selection.get / .set / .availability                          [+interactive Face 4：CAS mutation，官方 model-selection 落点]
│   ├── planMode.get / .select / .observe / .observe.handle / .availability       [+plan-mode 线]
│   ├── permissionPresets.current / .options / .select / .observe / .observe.handle / .availability  [+preset 线]
│   └── compaction.run / .availability                                [+compaction 线：operation，替代行内子面承载；OM-7]
├── tools
│   ├── register / restrict.register △                               [+scoped 线：增加可选 scope 维度（handle 引用），外层合同不变；OM-2]
│   ├── guard.register / get / list / execute / discovery.* / presentation.register / executionMode.register / defineTool  [不变]
│   └── executionPolicies.register                                    [+decision 线：point ∈ execute | post-execute；execute 点带 around 例外]
├── skills.activation.* / attachments.* / mcp.* / tasks.* / coordination.* / workspaces.transactions / security.* / diagnostics.* / settings.* / profiles.* / remotes.* / storage  [不变]
├── prompts
│   ├── contribute                   △                               [+scoped 线：spec 增可选 scope 维度；kind 面与冲突语义不变；OM-2]
│   ├── render / renderContextSections / provenance.*                 [不变]
│   └── assemblyPolicies.register                                     [+decision 线：整体 sections 替换 / tools 筛选（M8 8.3(a) 兑现）]
├── credentials.set / .unset / .availability                          [+credential 线：顶层一等领域]
├── workflows.start / .availability                                   [+workflow 线：顶层一等领域；run handle 为 operation idiom + 例外三成员]
└── services.*（53 键静态白名单）     △                               [+本线 OBS-14 判定：候选新增 appExit 成员（§5.1）；其余成员不变]
```

### 1.3 client 树（ctx.pluginApi）

```text
ctx.pluginApi
├── isActive / apiVersion / assertCompatible / capabilities / connection / events / remotes /
│   settings / slots / lifecycle / codec / services / sessions / attention   [既有 14 根，不变]
├── sessions.request / .cancel        △                              [+interactive 线：请求 spec 扩展与 queuedRef 同形扩展；wire value-only 投影随之扩展]
├── sessions.interactions.list / .get / .respond / .availability       [+interactive Face 2 client]
└── sessions.selection.get / .set / .availability                      [+interactive Face 4 client]
```

Client 半面判定汇总：九线中 plan-mode、preset、credential、compaction、workflow、decision、scoped、llm 八线均为 host-only（各线 design §10 六问逐项记录）；interactive 线全部新增 client 成员经既有 carriers（connection/gateway/api-remotes/client-runtime，均带完整 client 半面）承载，不新增 R 包/行。

### 1.4 开放标记清单（Stage 4 probe 后固化，不阻塞本设计成稿）

| 标记 | 内容 | 固化方式 |
|---|---|---|
| OM-1 | `agents.decisions` 中 `agent/request`、`agent/request-error` 的决策词汇（点位在树、词汇待 probe） | decision 线 Stage 4 契约 probe 对照官方 producer 源码后固化并回写其 design（该线 §迁移证据义务） |
| OM-2 | scoped 安装通道选路（caller-bound 解析 vs acquire 时捕获目标服务闭包） | scoped 线 fiber probe 矩阵（其 design §probe 矩阵）；树上成员形状不变，仅实现通道二选一 |
| OM-3 | llm 线条件 R 扩展（官方 `registerAdapter` 合同若缺必需字段） | llm 线 Stage 4 probe；触发时走 capability-strategy R1–R8 与独立 spec 流程，树上 path 不变 |
| OM-4 | interactive 线两条条件 R 点位与 wire 细节 | 该线 Tasks/Stage 4（其 design §R-Point Design Statements、§Protocol Determination）；path 不变 |
| OM-5 | launch environment 层值是否全部可经 credentials authority 解析 | 本线 Stage 4 probe（§5.2）；发现真实缺口时升级 seam 提案或 C 类登记 |
| OM-6 | `agent/turn-stopping` 参与化 | C 类通道（catalog 修订 / upstream proposal），本线登记提案（§2.4）；树上不新增成员 |
| OM-7 | compaction 线 operation 子面的登记执行 | 该线 Stage 4 落盘（registry 行、capability-strategy §5 装配表注、feature-list §3.1、U-series 退役条件）；本线负责对账其一致性 |

### 1.5 领域根与 services 分层的一致依据

- 顶层一等领域新增仅两个：`credentials`（credential 线 design §Namespace 放置的判据论证：独立词汇/资源身份/使用场景 + registry 已有一等事件名）、`workflows`（workflow 线 design §3.1：官方 WorkflowRunId 独立身份 + 独立词汇 + 编排场景）。其余九线新增全部挂既有领域子命名空间（`sessions.*` 五组、`llm.adapters.decorations`、`llm.models.list`、`agents.scopes`、`agents.decisions`、`prompts.assemblyPolicies`、`tools.executionPolicies`、`events.decisions`），与「挂最近既有领域」一致。
- `services.*` 分层依据（capability-strategy §6.1）：九线全部把官方只读写面留在 services 白名单原样（`services.planMode.get`、`services.permissionPresets.current/resolve/optionOf`、`services.credentials.resolve/describe`、`services.llm.listProviders/listModels`、`services.apiProxy.respond` 等），一等语义面与 advanced 直通分层共存（`llm.*` ↔ `services.llm` 先例）；白名单均不回流写成员。本树新增的唯一 services 候选是 OBS-14 判定产物（§5.1）。

## 2. 逐成员 old → target → behavior 映射（方法与初版）

### 2.1 方法

1. **行为保留优先**（goal 取舍方向）：先从观察报告 §3/§6 与九线迁移证据义务汇总「需要保留的行为」全集（消费者行为表行来源）→ 按 §1 目标树给每行为定 target → 才做逐成员减法/修正。禁止先删 path 再补记录。
2. **映射键**：以 registry `oldToTargetMapping` 现有记录为起点，逐条执行 requirements Req 6.1 的「目标行为等价」核对；核对失败的记录进入 §2.2 修正清单。
3. **判别登记**：每个映射行必须能通过 Req 2.3 五组判别之一（注册/装饰、观测/决策、追加/替换、模式/权限、操作/事实），不能判别的映射视为错误映射。
4. **落盘纪律**：映射修正随收敛集成波一次落盘进 registry 与 surface snapshot（Req 12.1）；历史 spec 文首以现状注引用新映射，不改写历史验收边界。

### 2.2 registry 映射修正清单（本线明确承担的落盘义务）

以下为已证实的映射修正（依据 `llm-adapter-registration/design.md` §registry 拆分与 rename/split 记录修正；OBS-02/OBS-13）：

| registry 记录 | 现状问题 | 修正 |
|---|---|---|
| `llm.registerAdapter` → `llm.adapters.register`（rename） | 目标入口实际接装饰（`facet.decorate`），rename 意图未成真 | **rename 记录保留并变为真实**：`llm.adapters.register` 实现改为绑定官方 registerAdapter 的真实登记（A 类直绑）；currentShape 更新为 real adapter route registration（含普通对象 spec 合同） |
| `llm.adapters.decorate` → `llm.adapters.register`（split） | split 目标错位（与真实登记混义） | **split 目标修正**为 `llm.adapters.decorations.register`；装饰语义、机制与独立身份不变 |
| `llm.adapters.register.handle`（retain） | 单行承载两种 handle | **拆分为两行**：真实登记 handle（resourceRegistry）与 `llm.adapters.decorations.register.handle`（机制不变） |
| `llm.adapters.list`（retain，装饰快照） | 语义混载 | **语义拆分**：`llm.adapters.list` → 真实 adapter 登记查询；装饰快照查询迁 `llm.adapters.decorations.list` |
| `llm.adapters.snapshot` → `llm.adapters.list`（rename） | 旧行为是装饰快照 | 旧行为的等价 target 修正登记为 `llm.adapters.decorations.list` |
| （新增）`llm.models.list` | — | 统一只读模型目录 projection：官方目录 + discovery + 已登记 adapter routes 的冻结合并视图；label overlay 保持 label 字段、不投影为官方真值 |

除上表外，`oldToTargetMapping` 其余 370 条记录按 §2.1 方法逐条核对；核对结论在 Stage 4 以对账表落盘（无偏差条目与修正条目分列）。

### 2.3 B4 义务路径映射（M7 deletion report 批准记录 → 九线）

| B4 义务（deletion-report 批准记录） | old（已删） | target（九线已定） | 通道 |
|---|---|---|---|
| B4-3 planMode 写入面 | `services.planMode.set` | `sessions.planMode.select` | A 类受控包装（plan-mode 线） |
| B4-4 permissionPresets 写入面 | `services.permissionPresets.set` / `selectFor` | `sessions.permissionPresets.select` | A 类受控包装（preset 线） |
| B4-5 credentials 写入面 | `services.credentials.set` / `unset` | `credentials.set` / `unset` | A 类为主 + 一处声明式 B 类冲突检测（credential 线 §C4） |
| B4-7 compaction 主动触发面 | `services.compaction`（整键） | `sessions.compaction.run` | B 类门控 + R 类子面（compaction 线 §3.4；R 判定引 capability-strategy §4，登记执行 OM-7） |
| B4-8 workflows 能力面 | `services.workflows`（整键） | `workflows.start` | B 类受控包装，无 R（workflow 线 §3.7 判定） |

B4-1/2/6（approval.setPolicy、agentDefaultModel.saveSelection、sessionProjectionCache.write）为纯删除或保留裁决，无后续义务；对账时核对无回流（Req 12.3）。

### 2.4 语义判别五组的映射落点

| 判别组 | 旧混义形态 | 收敛后唯一入口 |
|---|---|---|
| 注册 / 装饰 | `llm.adapters.register` 一面两义（OBS-02） | 注册 = `llm.adapters.register`；装饰 = `llm.adapters.decorations.register`（§2.2） |
| 观测 / 决策 | `events.observe` 返回值丢弃但事件名同 decision 点位（OBS-01） | 观测 = `events.observe`（projection，monitor feed）；决策 = `agents.decisions` / `prompts.assemblyPolicies` / `tools.executionPolicies` / `events.decisions`（policy，返回值保真） |
| 追加 / 替换 | `prompts.contribute` 追加语义被期望承载整体替换（M8 8.3(a)） | 追加 = `prompts.contribute`（含 scoped 线 scope 维度）；替换/筛选 = `prompts.assemblyPolicies.register`；组合顺序固定（两线交叉条文） |
| 模式 / 权限 | 均曾为裸 `services.*` setter（B4-3/B4-4） | `sessions.planMode.select` 与 `sessions.permissionPresets.select` 正交、各归唯一 owner、互不引用对方状态机（两线 Orthogonality 章节） |
| 操作 / 事实 | `events.emit('compaction/...')` 可被误当执行（纲领 §3.7 边界） | 操作 = `sessions.compaction.run` / `workflows.start` / `sessions.request` / `sessions.interactions.respond`；事实 = `compaction/*`、`workflow/*`、`session/*`、`credentials/updated`（producer authority 保留在引擎/官方/官方组件，第三方经参与面参与、经 observe 消费） |

C 类登记项：`agent/turn-stopping` 保持 fact（OM-6）；`approval/request`、`session-telemetry/record`、`tools/code-dispatch-log` 不进 `events.decisions` 初始准入集（decision 线 design §公共面与 path 决定），后续按增量准入。

## 3. idiom 归类初版与例外清单

### 3.1 九线新增成员的 idiom 归类（采纳各线 registry 拟新增行）

| 成员组 | idiom | 依据 |
|---|---|---|
| `sessions.planMode.get/.observe/.observe.handle`、`sessions.permissionPresets.current/.options/.observe/.observe.handle` | projection | 两线 design §Registry 拟新增行（形状 `{current(), subscribe(listener), dispose(), epoch}`） |
| `sessions.planMode.select`、`sessions.permissionPresets.select` | mutation（compare-and-swap） | 同上；判别式结果 + commitState 仅 committed |
| `credentials.set/.unset` | mutation（compare-and-swap） | credential 线 §C4；revision 是资源状态标记（settings revision 先例），不与 owner generation 混用（identity-and-lifecycle §2 语义分界，非例外） |
| `credentials.availability`、`workflows.availability`、`sessions.compaction.availability`、`sessions.interactions.availability`、`sessions.selection.availability` | selfDescription | 各线 availability 冻结三态、永不抛错 |
| `sessions.compaction.run`、`workflows.start`、`sessions.interactions.respond`、`sessions.request`（既有） | operation | 各线 design；外层合同 `{ok, code, terminal}`（compaction）/ 判别式结果（workflow、interactions、M9 request） |
| `agents.decisions.register`、`prompts.assemblyPolicies.register`、`tools.executionPolicies.register`、`events.decisions.register`、`tools.restrict.register`（含 scope 变体） | policy | decision 线 §idiom 归类；handle `{id, ownerId, generation, dispose()}` |
| `llm.adapters.register`、`llm.adapters.decorations.register`、`agents.scopes.acquire`、`tools.register`（含 scope 变体）、`llm.providers.register`、`llm.models.register` | resourceRegistry | llm 线 §机制设计（同 owner 同 id 同内容幂等 / 异内容 conflict / 跨 owner owner-conflict + CAS 式替换）；scopes.handle 为登记型 handle 同构 |
| `llm.models.list`、`llm.adapters.list`、`llm.adapters.decorations.list`、`sessions.interactions.list/.get`、`sessions.selection.get` | projection | 各线 design；深冻结快照、读时合成（models.list） |
| `prompts.contribute`（含 scope 变体）、既有贡献面 | contribution | scoped 线 §与 prompts/tools 既有面的分工矩阵；kind 面与 conflict/dispose 语义不变 |
| `events.observe`、`sessions.channels.*`、`sessions.activity.*`、`attention.*`、`events.catalog` | projection / selfDescription（catalog） | 既有登记不变 |

### 3.2 例外清单（六项记录制，api-idioms §1）

| # | memberPath | baseContract | exception | reason | replacementShape | verification |
|---|---|---|---|---|---|---|
| E1 | `workflows.start.handle`（WorkflowRunHandle） | operation | holder-owned 领域附加成员 `meta` / `result` / `cancel(reason?)` | 官方 holder-owned 契约如实映射：identity 与 terminal 不可转译、cancel 是 seam 第一类动作（`workflow-execution-contract/design.md` §3.3） | `{id, ownerId, meta, status(), observe(), result, cancel(reason?), dispose()}` | 该线 §6 终态/取消/隔离测试 + registry 登记断言 |
| E2 | `tools.executionPolicies.register(point:'execute')` | policy | around-execution | 官方 `tools/execute` 瀑布语义：策略持有 `next` 续延所有权，可包裹执行（decision 线 §逐点位保真表） | decide 收 `{...exec, next, signal}`，返回 `next()` 结果或包裹值 | 两策略顺序组合 + callback throw containment + 不调 next 则执行不发生 |
| E3 | `events.decisions.register('fs/write-intent'\|'fs/edit-intent')` | policy | async-barrier | 执行前异步捕获必须先于副作用完成（屏障式：全部策略结算后才 `next()` 放行） | decide 收 `{target, exec, next, signal}`，可 await 副作用前置工作 | turn-rewind/checkpoint-rewind 迁移证据：异步快照先于工具副作用 |
| E4 | `sessions.compaction.run`（门控缺位时抛 typed feature-disabled） | operation | capability-unavailable typed error 替代判别结果 | 与 `sessions.branches` 同型既有先例；门面自身契约破坏/门控失败按 P2 typed error，业务失败仍走判别结果（compaction 线 §3.2/§5） | `PluginApiFeatureDisabledError('sessions.compaction', …)` + availability 'unavailable' | 门控矩阵测试（该线 §6 第 1 条） |
| E5 | `llm.adapters.decorations.register`（保留既有 decoration 机制） | resourceRegistry | match/wrap 与 binding lifecycle 语义（非纯 key-value 登记） | 已交付 replacement 机制原样保留（U20 装配事实，capability-strategy §5）；拆分只换归属不改机制（llm 线 §机制设计） | 现行 decoration registry 契约不变 | 既有 decoration 测试全绿 + 双跑防护断言 |

无例外登记的成员必须与所属 idiom 的标准形状逐字段一致（Req 7.2）。八类之外的机制（事件派发动词）按 api-idioms §4 登记为事件面，不是第九 idiom。

## 4. 全路径 authority 地图（初版）

格式：资源 → 受支持门面路径 / advanced services 直通 / 官方 native 路径 / closure 方式。escape hatch（直接 inject/import 官方包）对所有行一致存在且门面不声称拦截（capability-strategy §6 末段、goal Scope direction 3）。

| 资源 | 受支持门面路径 | advanced services / 低层 | 官方 native 路径 | closure 方式 |
|---|---|---|---|---|
| Plan Mode 状态 | `sessions.planMode.select`（唯一受支持门面写路径） | `services.planMode.get`（只读直通） | 官方 TUI toggle、`/plan` 命令、`exit_plan_mode` 工具 → 同一官方 set/onBoundary seam | 统一 authority = 官方 plan-mode 服务 + session 日志（plan-mode 线 Authority Closure） |
| 权限预设 | `sessions.permissionPresets.select` | `services.permissionPresets.current/resolve/optionOf`（只读） | 官方 `/permission` 命令 → 同一 apply/set seam；settings `permission.defaultPreset` 为显式互斥 authority（只影响未来 session） | 统一 + 显式互斥双分支（preset 线 Authority Closure） |
| 受管凭据 | `credentials.set/.unset` | `services.credentials.resolve/describe`（只读） | 官方 Models/设置页经官方自有路径写同一 provider seam | 统一 authority = 官方 credentials provider（唯一存储 owner）；私有 storage/.env 写入为非替代品（credential 线 Authority Closure） |
| 模型 adapter route | `llm.adapters.register` | —（无 services 成员） | 官方 `registerAdapter`（登记动作本体） | A 类直绑同一官方动作；`llm/adapters-updated` producer 官方（llm 线） |
| adapter 装饰 | `llm.adapters.decorations.register` | — | 官方拓扑 binding 匹配 | 装饰与登记两 authority 互斥可辨、互不越权处置（llm 线 authority closure） |
| 模型目录 | `llm.models.list`（统一视角 projection） | `services.llm.listProviders/listModels`（官方形状视角） | 官方目录/discovery | 两视角互不改写；目录真值归官方 |
| 模型选择（per-session） | `sessions.selection.set/.get` | `services.agentDefaultModel.currentSelection`（默认值，不同资源） | 官方 model-selection 路径（prompt assembly 捕获 → 本步 route） | 统一落点 = 官方 model-selection；route policy 仍归 `llm.routing`（interactive 线 Model Selection Snapshot Contract） |
| prompt 汇编 | 追加 = `prompts.contribute`；替换 = `prompts.assemblyPolicies.register` | `services.prompts.assemble`（官方装配直通） | 官方 `system-prompt/assemble` 派发点 | 组合顺序固定（追加 → scoped 追加 → 策略）；官方派发为唯一 producer（decision 线 + scoped 线交叉条文） |
| 工具执行边界 | 注册 = `tools.register`；可用性 = `tools.restrict.register`；放行 = `tools.guard.register`；环绕/改写 = `tools.executionPolicies.register` | `services.tools.toolAbortedError` 等纯直通 | 官方 `tools/pre-execute|execute|post-execute` 派发 | 每点位单一受支持参与面；guard/restrict/executionPolicies 职责不重叠（decision 线分工矩阵） |
| 会话压缩 | `sessions.compaction.run`（门控） | —（B4-7 已删整键，不回流） | 引擎内部自动触发（pressure/context-overflow） | 统一 authority = forked 引擎（durable lock 仲裁）；`compaction/request` 策略是参与者不是触发器（compaction 线 §3.6） |
| workflow run | `workflows.start` + run handle（cancel/dispose） | —（B4-8 已删整键，不回流） | 官方 `workflowEngine`（执行 authority）；`workflow/*` 事件 | 统一 authority = 官方引擎；tasks/executions 各管关系与观测（workflow 线 §3.5） |
| 会话发送/取消/排队 | `sessions.request`（含 steer/queue）/`sessions.cancel` | `services.sessions`（官方 store leaf，advanced） | 官方 agent-loop attempt 事实、官方 inbox | 统一 authority = 已交付 request authority；M9 边界沿用（interactive 线 Face 1） |
| 待处理交互 | `sessions.interactions.list/.get/.respond` | `services.apiProxy.respond`（底层应答承载）、`services.approval`/`services.userQuestions`（官方 passthrough） | 官方 approval/userQuestions 事件与判定 | 决策权归官方 authority；facade 只做受限投影与匹配应答（interactive 线 Face 2） |
| 只读事件流 | `sessions.channels.*` + `sessions.activity`（消费合同，不新增面） | — | 官方 session 事件顺序 | 载体 = 已交付 connection/gateway 替代行 owners；cursor/resume 语义沿用（interactive 线 Face 3） |
| 事件参与（决策点） | 四个 decisions registry | — | 官方 waterfall 派发点（A 类）；compaction/title 由已交付 replacement 承载 producer | 参与条目经 bus substrate 安装为官方 ctx 钩子；observe 面保持只读（decision 线机制设计） |
| 事件生产 | `events.define`（owner-scoped 受限 publisher） | — | canonical 事件 producer 各归官方/替代行 | 订阅权 ≠ 生产权；扩决策参与不扩 fact 伪造权（goal Scope direction 4） |
| 进程退出（OBS-14.1） | —（提案：`services.appExit`，§5.1） | 提案成员本体 | launcher `ctx.provide("appExit", host.exit)` | authority = 官方 launcher 进程生命周期；exclusive 本性，不进 Composable Profile |
| 启动环境值（OBS-14.2） | —（等价路径判定，§5.2） | `services.credentials.resolve`（层模型同源） | `@deepseek-ai/dsh-launch-environment` 包 import（escape hatch 现状） | 统一 authority = 官方 credentials provider 层模型 |
| 插件私有数据 | `pluginApi.storage`（owner-scoped 薄绑定） | `services.storage`/`services.storageDomain`（advanced） | 官方 storageDomain | 不作为共享 authority 旁路（durable-state §5） |

保证级别声明：上表「受支持门面路径」承诺 composition-and-authority §1 四层；「advanced services」默认仅形状稳定层（第一层），组合保证按成员登记（capability-strategy §6.1）；官方 native 路径与 escape hatch 在门面保证范围外。关键不变量（凭据不回显、预设判定权、压缩事务原子性、终态唯一、owner 派生不可伪造）全部由门面自身或其唯一 authority 闭合，不借推荐 services 绕过（Req 8.5）。

能力自描述承载（Req 10 的设计落点）：成员级实际 reachability 由成员表「availability 形状」字段承载——每 namespace 的 `availability()` 按真实 authority/carrier/source/replacement 状态报告（九线已定形状采纳：三态冻结、永不抛错、ref/成员级信号不与 namespace 级混同）；source/authority/carrier 缺失码（unavailable/degraded/typed disabled）与业务拒绝码（conflict/denied/rejected/unchanged/no-candidate）在成员表「失败呈现」字段逐成员核对分离；capability 粒度按 public-api-shape §5 足以表达部分可用性，aggregate active SHALL NOT 掩盖成员级失效（验收入口：Req 10.1–10.3 + client 能力面 degraded 断言先例 `test/client-capability-availability.test.mjs`）。

## 5. OBS-14 三项归属判定

### 5.1 优雅 appExit —— 需要明确公共 seam（services 白名单候选）

- **事实**：`dsh-web-ui/packages/dsh-desktop-launcher/src/index.ts:97–104` 优先 `ctx.get('appExit')` 否则 `process.exit`；官方证据：launcher 经 `dsh-cmdline/lib/index.js:29` 提供 `ctx.provide("appExit", host.exit)`，官方 headless/cmdline 组件同样消费该服务（同文件 :56、`dsh-headless/lib/index.js:106`）。优雅回收插件树后退出与立即退出不等价；`servicesWhitelist` 现无 `appExit`——等价路径不存在。
- **判定**：按纲领方向「小型 runtime access 优先受限声明式/白名单面」，提出新增 `services.appExit` 白名单成员：A 类受支持 advanced passthrough（官方 service key 一比一、runtime-shaped、门面零附加状态）；组合分类 = exclusive 本性的进程级操作（不进 Composable Profile 组合保证）；authority = 官方 launcher 进程生命周期；服务缺席 → 成员 typed unavailable，门面 SHALL NOT 合成 `process.exit`（fallback 是消费者业务，如实保留）。满足 capability-strategy §6 新增 passthrough 四条件（明确第三方用例 = 桌面/自动化插件的有界退出；静态白名单；组合分类；authority map）。退役条件：官方提供一等受支持退出语义时，该成员保持直通或按减法规则处置。
- **不做什么**：不包装、不排队、不拦截、不建设「优雅关机编排」平台；appExit 直通不授权 patch boot/launcher（观察报告 §5 OBS-14 边界）。

### 5.2 launchEnvironmentOf fallback —— 等价路径成立（附一项 Stage 4 probe）

- **事实**：`dsh-tool-describe-image/src/config-resolve.ts:186–201` 在 credentials 服务缺席时回退 `launchEnvironmentOf(ctx)`（`@deepseek-ai/dsh-launch-environment` 官方包 import）；该包提供不可变启动环境快照，层序 process / project-env / user-env（官方包 `lib/index.js` SOURCE_ORDER 实测）。官方 credentials provider 的 `describe(ref).source` 枚举为 `env|file|project-env|user-env`——层模型同源（`credential-mutation-contract/design.md` §官方契约证据表）。
- **判定**：等价路径 = `services.credentials.resolve(ref)`（A 类既有白名单成员）：凭据解析统一走共享 credential authority，其层模型已覆盖启动环境层；样本的 launchEnvironmentOf 分支只存在于 raw host 下 credentials 服务缺席的形态，在门面受支持基线上 `services.credentials` 恒在。
- **probe（OM-5）**：Stage 4 以一个真实 project-env/user-env 层值验证经 `services.credentials.resolve` 可解析。若证实存在「快照可解析而 credentials 层不可解析」的真实值缺口，该缺口升级为受限只读声明式 seam 提案（Req 9.3）或 C 类登记，不静默丢弃。

### 5.3 resolveDshHome/scope 行为 —— 等价路径成立，无需新 seam

- **事实**：`resolveDshHome` 是样本家族自带的本地纯函数（`dsh-web-ui/shared/host/dsh-home.ts`：`DSH_HOME` 环境覆盖 + `~/.dsh` 回退），官方 runtime 未提供对应 ctx 服务；纲领 §6 明示「可按私有存储语义迁移，但应确认原本数据 scope/生命周期」。
- **判定**：
  1. home 路径解析本身不是 DSH API 行为（本地计算，Node 标准能力），不计入门面覆盖分母（Req 1.6）；
  2. 插件自有数据（cost-meter 账本等）→ `pluginApi.storage`（profile 档；disable/reload 关 handle 不删数据、purge 显式，durable-state §5 生命周期条款）；
  3. 读取 DSH 受管数据（凭据、设置）→ 共享 authority（`services.credentials.resolve`、`services.settings`），禁止硬编码路径直读官方文件；
  4. 迁移证据义务：消费者行为表登记原数据 scope/生命周期 → 新承载的映射（Req 1.1/1.5）。
- **不做**：不新增 home-path 查询公共成员（当前无实证的只读展示需求；出现时按 Req 9.3 评估受限声明式面）。

## 6. 与九线遗留问题的对账表

处置词义：**吸收** = 收敛线承接（对账/登记/落盘协调）；**保留** = 该线 Stage 4/Tasks 继续；**需裁决** = 触发时请求人类取舍。

| # | 线 | 遗留条目（出处） | 处置 |
|---|---|---|---|
| L1 | plan-mode | registry 拟新增行落盘（design §Registry 拟新增行） | 保留（该线 Stage 4）；收敛线对账一致性（Req 12.1） |
| L2 | plan-mode | queued 结算可观察性的 firehose 触发路径（design §C4） | 保留（该线 Stage 4 验证） |
| L3 | preset | 「至少一个真实审批判定随预设变化」的官方判定链证据（design §C4） | 保留（该线 Stage 4） |
| L4 | credential | B 类冲突检测在 registry 登记中标注为门面模拟（design §Error Handling） | 吸收验收（收敛线 idiom/成员表核对 B 类标注）；执行在该线 |
| L5 | credential | ref/配置业务关联归插件自身 remote（design §C2 注） | 保留（消费者模式，无门面义务；消费者行为表登记） |
| L6 | compaction | 登记义务四件套：AGENTS §2/§4、feature-list、capability-strategy §5 装配表注、U-series 提案与退役条件（design §3.4） | 保留（该线 Stage 4 执行）；收敛线承担对账（OM-7，Req 3.2/12.1） |
| L7 | workflow | admission rationale 与退役条件随 registry 登记记录（design §3.7） | 保留（该线 Stage 4）；收敛线对账 |
| L8 | workflow | run handle 三附加成员例外六元组登记（design §3.3） | 吸收（本设计 §3.2 E1 已收录；registry 落盘时按行登记） |
| L9 | decision | `agent/request`、`agent/request-error` 决策词汇 probe 固化（design §迁移证据义务） | 保留（该线 Stage 4）；收敛树保留 OM-1 |
| L10 | decision | `agent/turn-stopping` 参与化 C 类登记（design §横切派发语义） | 吸收（收敛线 C 类提案登记，§2.4 OM-6） |
| L11 | decision | 若 probe 证实某决策点 producer 结构不可达 → 转 C 类 upstream proposal（design §通道判定） | 吸收（登记规则预告：出现即入收敛线 C 类登记；触发本身归该线 probe） |
| L12 | llm | registry rename/split 修正统一落盘（design §registry 拆分节） | **吸收**（本线明确承担，§2.2；与该线 Stage 4 协同执行） |
| L13 | llm | 条件 R 扩展点位（官方 registerAdapter 合同 probe） | 保留（该线 Stage 4）；收敛树 OM-3 |
| L14 | scoped | fiber probe P1/P2 判定与接线选路（design §probe 矩阵） | 保留（该线 Stage 4）；收敛树 OM-2 |
| L15 | scoped | P1/P2 均不通时升级（可能触及官方组件边界） | **需裁决（条件性）**：触发时为人类取舍点（该线已显式登记升级路径） |
| L16 | interactive | 两条条件 R 点位（应答 seam / session 生命周期 seam） | 保留（该线 Tasks/Stage 4 评估）；收敛树 OM-4；若触发 R，走独立确认流程并同步 capability-strategy §5 / AGENTS §2/§4 / feature-list §3.1 |
| L17 | interactive | wire 细节（`/plugin-api/*` 方法路由分工、value-only 序列化）延至 Tasks 固定（design §Protocol Determination） | 保留（该线 Tasks）；wire revision 仅真实协议族需要时登记（versioning-and-protocols §5） |
| L18 | interactive | attachmentRefs 词表与消费成员交付时同步 registry；M9 附件缺口注闭合（design §attachmentRefs 合同第 6 条） | 吸收（收敛线 Req 12.1/12.2 对账其登记与现状注更新）；执行在该线 |
| L19 | interactive | OBS-12「恢复后续跑」语义（Face 3 已承载，design §Face 3） | 保留（该线 Stage 4 验收；收敛线经 Req 5.3/5.8 组合验收） |
| L20 | 全线 | 九线拟新增 registry 行的统一落盘与 snapshot 一致 | **吸收**（本线 Req 12.1 集成波统一落盘） |

汇总：吸收 6 条（L4/L8/L10/L11/L12/L18/L20 中按条计 7 项义务）、保留 12 条、需裁决 1 条（L15，条件触发型，当前无阻塞）。**当前无条件阻塞的需裁决项：0 条。**

## 7. standards 实质修订清单（待人类确认的设计决定，本文不直接改分册）

| # | 对象 | 修订内容 | 依据 |
|---|---|---|---|
| S1 | AGENTS.md §4 第 3 条（事件 API 表述） | 把「事件 API 保留 Cordis 的 `ctx.on` + 派发动词」同步为现行事实：公共订阅入口为 `events.observe`（projection；M8 已把 `events.on/once` 合并入 observe），决策参与经领域化 decisions registry（§2.4），派发动词 `emit/serial/parallel/waterfall/bail` 保留 | OBS-13 治理张力（goal Scope direction 10：经人类确认同步，不在实现中改治理掩盖偏差）；M8 ledger 第 30 行 |
| S2 | `public-api-shape.md` §2 静态领域树与 §7 转译清单 | §2 树图按 registry 现状刷新（移除已迁 `services.*` 的旧叶子与已合并动词）；§7 的 settings 配置桥条目更新为现行事实（`remotes.register` 直发 + client `remotes.contribute`，`TypertRemoteService` 手搓组合不再是必需路径） | OBS-13「部分 standards 静态树保留旧名字」；M8 ledger §7b；分册「只写当前仓库事实」定位 |
| S3 | `domain-composition.md` §2 领域表 | 新增 `credentials` 与 `workflows` 领域行（最低组合要求：credentials = 官方 provider 唯一存储 owner、写入 fail-closed + 审计；workflows = 引擎唯一执行 owner、tasks/executions 各管关系与观测） | §1.5 两线一等领域论证成立后的领域表同步（AGENTS §6 登记规则） |
| S4 | `capability-strategy.md` §5 装配表 | compaction-events 行补注：该替代行内新增 operation 子面扩展（行集合不变、不新增行）；属 Stage 4 落盘时同步项，收敛线对账 | compaction 线 §3.4 登记义务（L6） |

不修订声明：`api-idioms.md`（例外按 §1 六项机制逐成员登记，分册正文不变）、`api-shape.md`、`composition-and-authority.md`、`ordering.md`、`identity-and-lifecycle.md`、`durable-state-and-scope.md`、`visibility-and-redaction.md`、`concurrency-and-cancellation.md`、`versioning-and-protocols.md` 本轮无实质边界修订。`services.appExit` 白名单新增属于 registry 变更 + capability-strategy §6.1 分级在 registry 逐成员登记，不需要分册正文修订。

## 8. 装配与验收方案

### 8.1 三张表产出流程

1. **行为清单固化**（先于任何减法）：从观察报告 §3（17 项目 + 子包枚举）与九线 design「迁移证据义务」章节汇总行为全集，作为消费者行为表行来源。
2. **逐行为填表**：每行为按 Req 1.1 字段登记，target 引用 §1 树的 path 与对应线制品章节；无 target 行走 Req 9/§5 判定。
3. **成员表生成**：以 §1 树 + §3 归类为骨架，逐成员登记 Req 2.1 字段；九线已定行直接采纳（Req 2.2）。
4. **实现/装配表生成**：逐能力登记 Req 3.1 字段；R 行附 R1–R8 核对（Req 3.2）。
5. **交叉核对**：三表以 registry publicPath 为连接键执行 Req 4.1 判定；不一致行出差异报告（Req 3.4）。三表作为收敛交付物落盘本目录（文件形态由 tasks 阶段定，如 delivery report 附录或独立对账文件）。

### 8.2 迁移切片 / fixture 策略

- **载体**：延续 `test/consumer-migration-slices.test.mjs` 先例（切片 A–E 矩阵），新增九线行为切片：每线至少一个「原行为 → 公共调用 → 运行结果」真实链切片；跨线故事（Req 5.1–5.8）各对应至少一个组合切片或既有回归引用。
- **纪律**：切片经真实公共入口与真实边界（wire 序列化、durable 落盘、双 owner、反向装配顺序）；fixture 不绕过公共入口注入成功内部对象（纲领 §5 MAINT-04 边界）；17 项目不要求逐项目完整迁移，按行为组覆盖；constitution 两个消费者（read-image/anchor）的回归义务保留（goal Scope direction 8）。
- **证据形态**：切片文件头矩阵 + 运行结果断言；不以「没有 import 官方字符串」单独判成功（观察报告 §6 纠正表末批）。

### 8.3 full / 选择性装配验收

- full 聚合 patch 装配测试 + 选择性装配（main + 全部辅助包）测试：同一组主包行与替代行、同一行为、无双跑（Req 11.1）。
- 缺失辅助包降级矩阵：逐辅助包缺席 → 仅该包 R 特性 typed disabled/unavailable，主包与无关能力不受连带（Req 11.3；复用既有门控测试模式：`sessions.branches`、compaction 线 §3.2）。
- 卸载恢复 + 官方包零修改审计 + 版本冻结断言（Req 11.2/11.5）。

### 8.4 验证入口

受护 `npm test`（4G 内存护栏，禁裸 `node --test`）、`git diff --check`、registry/surface snapshot 一致性、api-idioms §5 机械校验（Req 7.5）、全局终审（按 AGENTS §3 对整树交付执行一次，阻塞等待）。全部验证入口登记进实现/装配表（Req 3.1「验证入口」字段）。

## 9. 失败路径与 guard

| 失败 | guard |
|---|---|
| 本线落盘动作（registry/snapshot/文档同步）失败或不一致 | 以脚本 + 校验执行（复用 `scripts/registry-snapshot.mjs` 先例）；手改生成物禁止；失败 → 阻塞登记（证据 + 解除动作 + 授权需求），不静默落盘 |
| 某线交付与收敛核对冲突（形状/authority/idiom） | 差异报告 → 该线 spec 修订流程回改；收敛线不改写该线已获批边界（Req 3.4） |
| probe 类开放项（OM-1…OM-5）结论与本文假设冲突 | 按各线与本文的 spec 修订流程同步对应条目；树上 path 变更需重新过成员表判别（Req 2.3） |
| 验收证据不足 / 真实硬阻塞 | typed 未完成 + 阻塞登记；不降低纲领 §1.3 完成定义（Req 13.3） |
| 装配不等价 / 双跑 / 空洞降级 | Req 11 矩阵拦截；发现即阻塞交付，不豁免 |
| 治理代号泄漏进实现/新制品 | 文档登记义务核对（Req 12.5）；新制品不引入；历史制品按登记处理不逐文件改写 |

## 10. Standards 逐分册适用性结论

| 分册 | 结论 |
|---|---|
| capability-strategy | **适用**（核心）。全树 A/B/C/R 判定复核（§2.2/§2.3 通道列）；R 类仅两处已知点位（compaction operation 子面 = 已批扩展、llm/interactive 条件点位 = OM-3/OM-4），R1–R8 与 feature-list §3.1 一致性是验收项；横切派发语义永不 R；`services.*` 分级与白名单变更判据（§6）；§7 admission/retirement 用于 OBS-14 判定；§10 六问汇总（八线 host-only + interactive 既有 carriers）。 |
| api-shape | **适用**。五组判别（§2.4）是一面原则的整树核对：每面单 owner、投影无副作用、策略/操作/事实不混装；九线新增面的 smell 检查（interactive 四面拆线、llm 三面分离是正例）。 |
| api-idioms | **适用**（核心）。§3 归类初版 + 例外清单（E1–E5）按其 §1 六项机制；§2 统一词汇一致性是 Req 7.2 验收基础；§5 机械校验纳入验证入口。 |
| public-api-shape | **适用**（核心）。§1 树按其 §1/§3 规则组织（挂最近领域、一等领域判据、三层例外、无治理名泄漏）；§9 registry 唯一事实源是 Req 12.1 依据；其 §2/§7 的现状刷新列为 S2（待人类确认）。 |
| composition-and-authority | **适用**（核心）。§4 authority 地图按其 §6 closure 两分支逐行核对；§5 owner/key/generation 纪律与 Req 8.2 live-handle 边界；§9 善意插件模型界定验收深度（不做 IAM/对抗隔离）。 |
| domain-composition | **适用**。§1.5 各领域归属核对（新增 credentials/workflows 行列为 S3）；五组判别的领域 owner 复核（prompts 追加/替换、tools 三面、llm 四动作）。 |
| ordering | **适用**。决策点位排序沿用固定 priority + 注册顺序 + 领域收敛规则（decision 线逐点位保真表）；无全局 before/after 图； Req 7.2 顺序语义一致性核对。 |
| identity-and-lifecycle | **适用**。generation（owner-specific）/ seq / epoch 不混用核对（credential revision 与 workflow run id 的语义分界声明）；终态词汇五值 + `commitState` 字段分界是成员表核对项。 |
| durable-state-and-scope | **适用（有限）**。三档 scope 不变（无 agent 档）；compaction lineage、attachmentRefs durable 映射、selection 持久化均归官方/既有档位；插件 storage 边界（OBS-14.3 判定）。 |
| visibility-and-redaction | **适用**。跨线脱敏一致性核对（credential 全出口禁值、interactive 受限视图、compaction 失败 redacted、audit 元数据化）；host 脱敏先于序列化、client 只验形状。 |
| concurrency-and-cancellation | **适用**。各线 §6 并发策略声明汇入成员表（exclusive/parallel/compare-and-swap/queue/deduplicate 逐成员核对）；取消是信号、终态唯一、stale 提交资格、disposer 所有权为整树断言。 |
| versioning-and-protocols | **适用**。版本冻结断言（Req 11.5）；full/选择性等价（§6）；wire/durable revision 仅真实协议族登记（interactive OM-4）；无多版本兼容平台。 |

分册定位纪律：各分册只写当前仓库事实，本文是未来事实的设计；S1–S4 之外不与分册现状冲突，S1–S4 经人类确认后由相应治理修订执行。

## 11. 与 Requirements / Goal 的一致性

- requirements 十三组 Req 覆盖本 design 全部产出：§1 → Req 2/6、§2 → Req 6、§3 → Req 7、§4 → Req 8、§5 → Req 9、§6 → Req 9.2/12、§7 → Req 12.6、§8 → Req 1/3/4/5/11、§9 → Req 13、§10 → requirements「Standards 对照」。
- goal 十条 Scope direction 对应表见 requirements 文末；goal Boundaries 逐条遵守（无万能 root、不吞并产品、降级不视为完成、版本冻结）。
- 与九线制品零冲突声明：本文对九线 path、idiom、authority、例外全部采纳；冲突处理一律走 §9 差异报告通道。
