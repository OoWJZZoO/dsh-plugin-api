# Stage 3 — Tasks

## Status

SPEC3 Stage 3：本任务书承接已确认的 `goal.md` / `requirements.md` / `design.md`（M9 批量确认门，2026-09-06 人类批准，requirements/design 均 v2）。本文按 AGENTS.md §3.2 以对抗性审查为门；审查返回「无偏差」后由编排主代理直接放行进入 Stage 4，不设用户确认门。

**并行纪律**：M9 四线 worktree 并行开发，遵循 `docs/specs/plugin-api-m1-integration/parallel-workflow.md` 三阶段协议与 M9 串并行契约（`temp/m9-parallel-development-contract.md`，下称「契约」）§7 共享文件边界、§8 合并顺序。任何任务不得修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**`（官方包文件）或本文「文件范围与并行纪律」节的冻结文件。

**串并行折线（本线铁律）**：任务批次 A（checkpoint record / capture status / restoreability / external-effect / plan 的无副作用先行部分；契约 §3.2 第一波 + §3.4 第三波 plan 对齐）在本波实现；**完整 restore operation 是 M9 最后进入实现的部分**（契约 §3.5）——批次 B 必须在 checkpoint record/plan、coordination fencing、workspace transaction、session branch/edit 与 recovery consumption contract 均无未决 authority 冲突后串行开工；批次 B 开门即 authority 对齐检查（任务 10），authority 无法闭合时交付诚实降级（任务 10.2/13.4），绝不伪装完整能力。批次 A 对应契约 §8 合并顺序第 4 步（checkpoint projection/plan），批次 B 对应第 5 步（restore operation 与跨组件 R slices），集成波对应第 6 步。

## 需求锚点

任务引用 `requirements.md` 的 `Requirement N`（下文简称 `ReqN`）：

- Req1 Checkpoint Identity And Single Scope / Req2 Checkpoint Record, Capture Status And Provenance / Req3 Capture Create Mutation With Source Capabilities / Req4 Checkpoint Projection Queries / Req5 Restore Planning — Pure Frozen Plan / Req6 Restore Operation — Single Authority Terminal, Stop-Then-Restore / Req7 Coordination, Fencing And Claims / Req8 Workspace Snapshot Slice Contract (R) / Req9 Loop Boundary Consumption And Auto-Capture (R 共享) / Req10 External Effects And Honest Boundaries / Req11 Availability, Capability And Degradation / Req12 Mutation, Plan And Operation Boundaries / Req13 Verification And Delivery Gates。

其余引用：`docs/standards/capability-strategy.md` R1–R8 与 §10 六问；契约 §2（冻结词汇）、§3.2/§3.4/§3.5（波次）、§6（失败呈现）、§7（文件边界）、§8（合并顺序）、§9（明确排除）。

## 冻结决策（源自 design/契约，实现须逐项遵守）

1. **版本冻结**：`packageVersion = 0.1.0-rc.6-0.1.0`、`dsh.api = 0.1`，任何任务不得步进任何版本字段（AGENTS.md §3.0.1；requirements 引言）。新建 `packages/workspace` 包同样遵循 `<A>-<B>.<C>.<D>` 与 `A.B.C` 装配契约：错配只停用该 slice，不波及其他面（`versioning-and-protocols.md` §3/§6）。
2. **公共面**：`pluginApi.executions.recovery.checkpoints`（host）三个语义面独立 owner：capture（`create`，durableMutation）、projection/plan（`list`/`inspect`/`planRestore`，projection；`planRestore` 为预定 verb 例外）、restore（`restore`，operation，单一 authority 提交 terminal）。capabilities 子簇（`.capture.branch`/`.capture.workspace-journal`/`.capture.workspace-snapshot`/`.restore`/`.restore.stop-then-restore`）与 registry 全量登记（含 `planRestore` verb 例外登记形状）留集成波（任务 15）。
3. **词汇纪律（契约 §2）**：`checkpointId`/`executionId`/`activityId`/`operationId` 不互换；`terminal`（restore op，五值）/`commitState`（create mutation）/`partial`（领域结果）/`superseded-by-restore`（checkpoint 记录级血缘归因）不互相代替；seq/cursor 只用于分页重放；fencing 只用于并发控制；capture status 五值（`captured`/`partial`/`missing`/`unknown`/`unavailable`）不互相代替；`unknown`/`unavailable`/`degraded`/`partial` 不互相代替。
4. **记录持久化**：append-only 单档 scope durable envelope（schema 两档明文 + 整数 version + owner + identity + scope + bounded data）；无 public purge mutation；不新开第二 storage 平台、generic scheduler、task registry 或 memory/context-retrieval 系统（Req12 AC1/AC5）。记录写入绑定已交付的 facade 单档 scope durable 记录设施（具体底座由任务 1.2 probe 固定）。
5. **stop-then-restore 是唯一运行中恢复语义**：不提供 attempt suspension/park（Req6 AC3、Req10 AC4；requirements 偏离注 2）。共享 cancel boundary 是唯一停止路径（`by: 'system'` + restore 因），本线无第二取消路径。
6. **共享 loop boundary slice（`packages/agent-loop`，owner：session-interaction-operation 线）**：本线**只读消费**，不实现、不修改、不派发/变换/否决其事件（Req9 AC4）；切片缺位/版本错配 ⇒ 相应能力如实降级（auto-capture unavailable、运行中 restore denied/blocked + concrete reason，fail-closed 方向）。
7. **workspace snapshot slice（新建 `packages/workspace`，本线 owner）**：完整行复刻 + 加法扩展；Stage 3 probe 为能力门；boot 自检/版本锁/owner 冲突检测；失败 = fail-safe（记录日志 + 正常 return），绝不静默双跑；绝不允许「官方行 disabled + 无工作替代」空洞（cap-strategy R1/R4/R5/R6；Req8）。
8. **治理魔法字母不进入实现**：`lib/`、`packages/workspace/`、`test/` 与运行时可见字符串（含包名、行 id、错误文案、Symbol 键）不得出现治理编号、分类字母、feature 名、需求号、工作流代号或带治理后缀的 id（AGENTS.md §6）；本线文件命名不得含治理字母/批次编号；行/包名用中性能力名（本线暂定，集成波 registry 定稿）。
9. **fail-safe**：本线全部入口失败只记录日志并安静停用/降级，绝不抛穿 apply/boot；失败呈现按契约 §6：P1 `PluginApiInactiveError` / P2 capability disabled typed error / P3 逐 source/逐 slice degraded/unavailable；业务冲突为 typed result，partial 为领域字段。
10. **不消费 `executions.recovery`**：checkpoints 面绝不调用 recovery evaluate/consume，不双消费（Req12 AC4）；不改变 route/admission/approval policy；不自行挂起 in-flight attempt。

## 文件范围与并行纪律（契约 §7.1 / §7.2）

**本线允许触碰**（命名不含治理字母/批次编号）：

- `docs/specs/checkpoint-restore-contract/**`（本文件从本任务起新增；Stage 4 只允许在本目录写修订注记、probe 证据与 U-series/退役条件登记）
- `lib/checkpoint-*.js`（本线 owner 模块，至少含 record / capture / projection / plan / restore / availability / auto-capture / loop-facts 职责模块，实现时可合并拆分；模块以可注入依赖的表面工厂形式导出，供集成波机械挂载——本线不修改 `lib/plugin-api-service.js` 等共享文件）
- `test/checkpoint-*.test.mjs`（本线 focused tests）
- `packages/workspace/**`（新建 dsh-workspace owner replacement 包：`cordis.patch.yml`、`lib/`、`package.json`、`test/`；包名/替代行 id 中性能力名，集成波 registry 定稿）
- `temp/`（临时验证脚本，用毕即删，不进 Git）

**冻结文件（任何情况下不得修改）**：`lib/plugin-api-service.js`、`lib/index.js`、`lib/guards.js`、`lib/events-catalog.js`、`lib/events-bus.js`、`lib/deep-freeze.js`、`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`、`docs/specs/plugin-api-features/feature-list.md`、`test/index.test.mjs`、`test/index-events.test.mjs`、`temp/m9-parallel-development-contract.md`、任何 `packages/*` 下属于其他线的文件（尤其 `packages/agent-loop/**`——只读；`packages/full/**`——集成波装配）。挂载进 `pluginApi`（append slot）、error/guard 集成、事件 catalog 新增词汇（若确需，走独立 slice 机制，契约 §7.2）与 registry 合并均由集成波执行（任务 15）。

## 任务清单

### 任务批次 A（先行：record / projection / plan 无副作用部分；契约 §3.2 第一波 + §3.4 第三波 plan 对齐）

#### [ ] 1. Stage 4 开门 probe 门与降级登记（Req2 AC6、Req8 AC11、Req13 AC9；design §4/§Architecture）

> 本任务是 Stage 4 实现开始时的能力门：probe 失败把相关任务降级为不可用登记，不硬撑。

- [ ] **1.1 workspace 行契约 probe（能力门）**：以官方安装事实（`@deepseek-ai/dsh-workspace` 包源码与 manifest）**只读**盘点被替代 `workspace` 行（web profile）的 ctx 服务面（`workspaceRegistry`：bootstrap/create/mutate/status）、事件面、时序/payload/接收者/错误/disposer 契约，并证明三项：(a) 官方行整面可复刻；(b) workspace 受管 mutation 流经被替代服务、可在 capture point 取得权威状态；(c) 快照应用路径可逆或可 fail-closed。产出 probe 证据记录到 `docs/specs/checkpoint-restore-contract/`（如 `workspace-slice-probe.md`；只读盘点，不修改官方任何文件）。
- [ ] **1.2 durable 记录设施绑定 probe**：以 registry/实现事实确认已交付 facade 单档 scope durable 记录设施可承载 checkpoint record schema envelope（identity/scope/owner/version/append-only），把设计「Stage 3 probe 固定绑定」落为具体底座；backend 缺失 ⇒ create typed unavailable（Req3 AC3）。
- [ ] **1.3 probe 结果分派与降级登记**：
  - 1.1 通过 ⇒ 执行任务 8（workspace snapshot slice 包）；1.1 失败 ⇒ 不产出 `workspace` 替代行（官方行保持原样、官方契约行为照常），`workspace-snapshot` capture source 在 availability/create 中 typed unavailable，记录证据（Req8 AC5/AC11、Req13 AC9）。
  - 1.2 失败 ⇒ create typed unavailable（backend 缺失），list/inspect/plan 与其余 source 不受影响（Req11 AC5）。
  - 无论分支，本任务都不宣称超出证据的能力；降级结论与原因登记写入本线 spec 制品（availability 形状与原因）。

#### [ ] 2. Checkpoint record durable envelope 与身份（Req1、Req2、Req12；design §Data Models 1）

- [ ] **2.1 checkpointId 身份**：facade 生成、稳定唯一、不复用；不是事件 seq/cursor、execution/activity/operation identity（Req1 AC1）；引用字段一律使用共享 M9 身份词汇，不凭事件序列发明身份（Req1 AC3）。
- [ ] **2.2 单档 scope**：每条记录恰一声明 `session | workspace | profile` 一档并携带对应 `sessionId`/`workspaceId`/`profileId`（契约 §2.5）；v1 无 profile 捕获源 ⇒ profile 档 capture typed unavailable 且不产生记录（Req1 AC2）；跨档需求拆成关联记录 + 显式 correlation，不合并成一条记录（Req1 AC2）。
- [ ] **2.3 envelope 全字段**：schema（`executions.recovery.checkpoints.session|workspace`）、整数 version、owner（由调用方 fiber/插件身份派生，不接受自报）、identity、scope、bounded data、per-component capture status（五值）、provenance（executionId/activityId/attemptId correlation、creator owner、reason、createdAt、autoTrigger）、restoreability、externalEffects、lineage（previousCheckpointId/captureKey）（Req2 AC1/AC4；design 数据模型 1 全字段）。
- [ ] **2.4 append-only 与资源消逝**：记录只追加不改写；无 public purge（Req2 AC1、Req12 AC5）；scope 资源消失/不可达 ⇒ 记录保持可 inspect 且 scope 资源标 `unavailable`，不删除/改写历史（Req1 AC4）。
- [ ] **2.5 解码与重复捕获纪律**：未知 schema/version ⇒ `unsupported-schema`，不猜测、不静默丢字段（Req2 AC6、Req4 AC5）；同一底层状态两次捕获 ⇒ 两条记录 + lineage，除非显式 capture-key 去重契约（Req1 AC5）。
- [ ] **2.6 审计面**：创建/恢复/stop 各步记录 owner/时间/结果码/锚点（无内容、无 secret，契约 §2.5）；audit 失败 ⇒ bounded gap marker（Req3 AC7 的审计面）。

#### [ ] 3. Capture authority — create(spec)（Req3；design §Components 2）

- [ ] **3.1 入口形状**：create(spec) 路由经 checkpoint capture authority，返回 durable mutation 判别式 outcome（`ok`/`code`/`commitState`）+ 冻结结果摘要（Req3 AC1；api-idioms mutation 契约）。
- [ ] **3.2 v1 source 表**：`branch`（session，经 `sessions.branches`）、`workspace-journal`（workspace，经 `workspaces.transactions`）、`workspace-snapshot`（workspace，workspace snapshot slice active 时）；未登记 source ⇒ typed `unsupported`；declared source 的 owning authority 不可用/capability-gated ⇒ typed unavailable + 具体缺失能力，绝不写假记录（Req3 AC2/AC3）。
- [ ] **3.3 部分成功诚实落盘**：capture 部分成功 ⇒ 记录以诚实 `partial`/`unknown` 状态落盘并在 outcome 暴露；`partial` 是领域结果字段；非 `captured` 状态在 inspect/list 中原样暴露、不呈现为完整捕获（Req2 AC2/AC3、Req3 AC4）。
- [ ] **3.4 去重与血缘**：settle/commit 前同 captureKey 重试 ⇒ 返回既有记录引用（dedupe）；settle/commit 后重触发 ⇒ 新记录 + lineage（Req3 AC5）。
- [ ] **3.5 权威归属**：capture 触达 session history/workspace state/任何 durable 领域状态时只经对应 owning authority（branch / transaction / snapshot slice），不行使旁路（Req3 AC6、Req12 AC2/AC3）。
- [ ] **3.6 audit 失败**：mutation 保留已声明效果 + bounded audit gap marker；不伪造记录（Req3 AC7）。
- [ ] **3.7 external effects 记录面**：记录提及 external effect 时分类 `rollbackable | external | unknown`；`external`/`unknown` 不执行、不承诺回滚（Req10 AC1）。

#### [ ] 4. Projection — list / inspect（Req4）

- [ ] **4.1 查询形状**：`list({ scope?, resourceId?, cursor?, limit? })` 返回冻结有序页 + cursor 续页；`inspect(checkpointId)` 返回全量冻结记录（Req4 AC1）。
- [ ] **4.2 单 scope 过滤**：按记录的单一声明 scope/resource 过滤；一过滤器下不返回跨 scope 结果（Req4 AC2）。
- [ ] **4.3 缺位呈现**：缺记录/scope 资源 ⇒ typed absence/unavailable，不抛（P1/P2 仅 core/capability 失败；契约 §6）（Req4 AC3）。
- [ ] **4.4 host 侧脱敏**：payload 内容、锚点私有状态、secret 不出任何出口（Req4 AC4、Req10 AC1；`visibility-and-redaction.md`）。
- [ ] **4.5 未知 schema**：投射面如实 `unsupported-schema`，不伪造字段（Req4 AC5）。

#### [ ] 5. Restore planning — planRestore(checkpointId)（Req5；design §Data Models 2；契约 §3.4 第三波）

- [ ] **5.1 纯性**：planRestore 纯只读——不写任何东西、不 durable 获取、不改变状态；重复调用同态同 fingerprint（Req5 AC7）。
- [ ] **5.2 冻结 plan 内容**：per-slice steps 绑定具体 owning authority（design step authority 键：`sessions.branches.restore` / `workspaces.transactions.*` / `workspaces.snapshot.restore`——内部 bound-authority 键，非新开 pluginApi 公共路径，公共命名集成波定稿）、每步预期 effect、required claims/preconditions、per-slice restoreability（`restoreable|partial|unavailable|not-applicable`）、external-effects 陈述、plan fingerprint（Req5 AC1）。
- [ ] **5.3 fingerprint**：覆盖稳定内容（slices/steps/claims/externalEffects/restoreability），排除 `generatedAt`/`epoch`/`liveState`/`stopThenRestore.available` 等易变或证据派生字段；确定性重算（design §Data Models 2）——支撑 Req5 AC7 与 Req6 AC2 stale 重验。
- [ ] **5.4 live-attempt 前置条件证据（Req5 AC2、Req9 AC1a）**：共享 loop slice active ⇒ observed 证据（`agent/attempt/start|end` → running/idle/queued + attemptId）且 stop-then-restore 路径标 available；slice 缺位 ⇒ 用可用 activity 投影降级证据（`sessions.activity` 未交付 ⇒ evidence `unknown`），运行中 restore 标 unavailable + 具体原因。
- [ ] **5.5 precondition 标记**：当前不可满足的步骤 ⇒ 标 blocked/`unavailable` + 具体原因，不静默丢弃（Req5 AC3）；无 restoreable slice ⇒ 整体 restoreability `unavailable`/`not-applicable` + reasons（Req5 AC4）。
- [ ] **5.6 authority map 对齐（契约 §3.4）**：plan 步骤绑定以已交付 authority 面（coordination、workspaces.transactions、sessions.branches、executions.recovery 的 registry 可证形状）为事实；锚点在 plan time 经各自 owning authority 校验，不可确认 ⇒ `unavailable`/`stale`（Req2 AC5）；某步骤无法绑定可证 authority ⇒ 该步骤 unavailable/blocked（Req13 AC9）。跨线全链路对齐验证归集成波（任务 15.4/15.5）。
- [ ] **5.7 external effects（plan 面）**：列出 + rollbackability 分类；`external`/`unknown` 不执行、不承诺回滚（Req5 AC6、Req10 AC1）。

#### [ ] 6. Availability 与降级自述（Req11；契约 §6）

- [ ] **6.1 `availability()`**：`executions.recovery.checkpoints.availability()` 返回冻结 `{ status: active|degraded|unavailable, reason? }`，覆盖 projection、各 v1 capture source（branch/workspace-journal/workspace-snapshot）、auto-capture 策略、restore authority（含 stop-then-restore 能力），永不抛（Req11 AC1）。
- [ ] **6.2 逐项缺失呈现**：capture source/slice/能力缺位（branch owner inactive、headless 无 workspace 行、snapshot slice 未装/probe 失败、loop slice 缺位）⇒ 对应条目 typed unavailable/denied + 具体原因；无关面保持 active（Req11 AC2、Req8 AC8）。
- [ ] **6.3 P1/P2 统一**：core inactive ⇒ `PluginApiInactiveError` 路径；capability disabled ⇒ typed unavailable 错误/结果（复用既有错误设施，不修改冻结的 error/guard 文件）（Req11 AC3；契约 §6）。
- [ ] **6.4 capabilities 谈判（Req11 AC4）**：checkpoints 能力簇与 per-source/restore 能力在 `capabilities` 暴露——**注册与形状合并归集成波**（任务 15.1）；本线只保证 `availability()` 对应能力面如实自述（6.1/6.2），不暴露包/行/替代身份。
- [ ] **6.5 最小交付规则**：restore authority 完全不可服务时，list/inspect/plan/availability 保持可用，restore typed unavailable（Req11 AC5；Goal 最小交付规则）。

#### [ ] 7. Auto-capture 策略（共享 loop boundary slice 只读消费）（Req9；design §Components 2）

- [ ] **7.1 消费契约**：只读订阅共享切片的 `agent/attempt/start|end` 事实（经 facade 内部只读消费点；不派发/变换/否决/生产这些事件——Req9 AC4）；切片未交付/缺位 ⇒ auto-capture unavailable（availability 明示）。
- [ ] **7.2 策略形状**：owner-scoped、默认关、可观测、有界配额（如每 terminal attempt / 每 N 步）；策略形状与配额登记留集成波 registry；不超声明节奏自动捕获（Req9 AC2）。
- [ ] **7.3 触发与落盘**：attempt 边界按策略调用 capture authority 建 branch 锚点 checkpoint；记录为普通 checkpoint record（Req2/Req3 语义），provenance 标记 autoTrigger（Req9 AC5）。
- [ ] **7.4 降级**：切片 inactive/版本错配 ⇒ auto-capture unavailable；手工 capture/restore 中能用可用证据确认 idle 的会话保持可用；无法确认 idle ⇒ typed blocked/denied + 具体原因（fail-closed 方向）（Req9 AC3）。

#### [ ] 8. Workspace snapshot slice 包（新建 `packages/workspace`；R——probe 通过时交付，失败时本任务整体降级为不可用登记）（Req8；cap-strategy R1–R8/§10）

- [ ] **8.1 包与行**：`packages/workspace/**`（`cordis.patch.yml`：官方 `workspace` 行 disabled + insert 替代行；零官方包修改，不加无关行——cap-strategy R1；Req8 AC1）。包名/替代行 id 用中性能力名（本线暂定，集成波 registry 定稿）；headless 无该官方行 ⇒ slice 缺席属正常装配差异（Req8 AC8）。
- [ ] **8.2 完整行复刻（cap-strategy R2）**：完整复刻 `workspaceRegistry`（bootstrap/create/mutate/status）ctx 服务面与事件/时序/payload/接收者/错误/disposer 契约（parity 测试逐项断言）；之后才加法扩展（Req8 AC2）。
- [ ] **8.3 加法接口——snapshot capture 与 restore-path**：capture-point：capture 时记录该行权威拥有的 workspace 受管状态 + 逐组件 capture status；restore-path：在 restore operation 的 fencing 内应用快照的 authority-bound 路径；只处理该行拥有的领域，不越界 session/external（Req8 AC3）。restore-path 接口与包级契约测试在本任务交付，但**第一次真实驱动在批次 B 的 restore authority 步骤执行**（任务 11.7），本任务不出现第二条独立恢复路径。
- [ ] **8.4 boot 自检（cap-strategy R4/R6；Req8 AC4）**：apply 内断言官方行已 disabled、替代行唯一 active、runtime/包 `A.B.C` 一致、无组件 owner 冲突、关键契约可用；失败 ⇒ fail-safe（记录日志 + 正常 return），绝不静默双跑。
- [ ] **8.5 版本锁定（cap-strategy R5；Req8 AC8）**：锁定 runtime 全量版本与被替代官方包 identity；错配 ⇒ 安全停用扩展面（只影响该 source），`workspace-journal`（transactions 面）保持可用。
- [ ] **8.6 client 半面判定（capability-strategy §10 六问；Req8 AC6）**：以被替代官方行 manifest 事实逐项回答六问（无 client manifest / remote / slot / settings / 协商 / browser state / client 事件 ⇒ 全否）⇒ host-only，附证据；若命中任一 ⇒ 依 R7 自建 client bundle 并对齐 `window.__DSH_BOOT__`/HMR 验证（预期为否）。
- [ ] **8.7 import 面边界（cap-strategy R3；Req8 AC7）**：第三方 `import '@deepseek-ai/dsh-workspace'` 仍解析官方原包；本包文档显式声明不拦截/不替代该 import 面。
- [ ] **8.8 probe 失败降级路径（Req8 AC5/AC11）**：任务 1.1 probe 失败 ⇒ 本任务整体替换为「降级登记」：不产出替代行（官方行保持原样、官方契约行为照常），`workspace-snapshot` source unavailable + 证据记录；绝不留「官方行 disabled + 无工作替代」空洞。
- [ ] **8.9 U-series 与退役条件（Req8 AC9/AC10）**：在本线 spec 制品登记本包的 U-series 上游提案（官方提供等价 snapshot/restore seam）与退役条件（官方 seam 可承载后迁移回官方绑定）；feature-list §3.1 登记留集成波（任务 15.2）。
- [ ] **8.10 包级测试（Req13 AC4）**：官方契约 parity、probe 失败降级、版本错配、boot 自检、owner 冲突、无双跑、移除后恢复官方行、headless 缺席（放 `packages/workspace/test/`）。

#### [ ] 9. 批次 A 测试与验收（Req13 AC1/AC2/AC5/AC6/AC9 的批次 A 部分）

- [ ] **9.1 capture 测试（Req13 AC1）**：单档 scope、checkpointId 身份独立、逐组件状态、captureKey 去重/血缘、未登记 source rejected、authority/slice 缺失 unavailable、partial 诚实落盘、不伪造记录（branch/transaction/workspace-snapshot 的 contract-faithful fixture）。
- [ ] **9.2 plan 测试（Req13 AC2）**：纯性（无写/无 acquire/无状态变更）、fingerprint 稳定性（同态同指纹、重算确定、stale 检测基础）、precondition 标记（slice active 的 observed live-attempt vs inactive 的 denial）、restoreability 分类、external effects 不承诺回滚。
- [ ] **9.3 边界测试（Req13 AC5 批次 A）**：无 branch/transaction 旁路、append-only 无改写、无 purge、记录只经 capture authority 写入、词汇不混用（capture status / commitState / partial 字段角色断言）。
- [ ] **9.4 owner/scope 隔离（Req13 AC6 批次 A 面）**：两个 synthetic 插件以相反注册顺序经 capture/projection/plan 相同路径 ⇒ outcome 一致、owner 隔离成立（批次 B 扩展 restore 路径，任务 13.3）。
- [ ] **9.5 共享切片消费测试（Req13 AC4 面）**：attempt 事实只读消费且本线不成为其 producer；切片缺位 ⇒ auto-capture unavailable 与运行中 restore 降级断言；auto-trigger provenance 标记。
- [ ] **9.6 降级与 availability**：逐 source/slice 缺位 ⇒ unavailable/denied + 原因；无关面 active；availability 永不抛。
- [ ] **9.7 批次 A 完成验收**：本批全部子项完成，focused（`test/checkpoint-*.test.mjs`）+ 包级（`packages/workspace/test/`）测试绿，`git diff --check` 通过，按 AGENTS.md §3.2 做阶段提交。

### 任务批次 B（串行收尾：restore operation；契约 §3.5 第四波）

> 本批次是 M9 最后进入实现的部分。开工前置：checkpoint record/plan（本线批次 A）、coordination、workspaces.transactions、sessions.branches 与 executions.recovery consumption contract 均无未决 authority 冲突；共享 loop boundary slice 由 interaction 线交付与否以实际装配为准（缺位 ⇒ 相应能力如实降级，不等待、不阻塞无依赖部分）。

#### [ ] 10. Authority 对齐检查（批次 B 开门；Req6/Req7/Req13 AC9；契约 §3.5）

- [ ] **10.1 逐面核对（以 registry/实现事实）**：coordination（acquire/heartbeat/release/takeover/compareAndSet + fencingToken）、workspaces.transactions（prepare/record/preview/commit/rollback/recover/get/observe）、sessions.branches（create/plan/preview/commit/rollback/restore）、executions.recovery（单一自动消费——本线确认绝不调用 evaluate，无冲突）、共享 loop boundary slice 的 cancel 契约（interaction 线交付状态）与 sessions.activity 降级证据（同批线交付状态）。
- [ ] **10.2 结论分派（权威结论，必须如实）**：
  - 全部必要 authority 可证明闭合 ⇒ 执行任务 11–13（完整 restore operation）。
  - **authority 无法闭合 ⇒ 交付诚实降级，不伪装**：不实现/不宣称超出证据的 restore；restore 保持 typed unavailable（availability/plan 明示缺失 authority 面），list/inspect/plan/availability 继续可用（Goal 最小交付规则、Req11 AC5、Req13 AC9）；降级结论与证据记录写入本线 spec 制品。
- [ ] **10.3 不可证明项逐条登记**：缺失 authority 面名称、缺口性质、所需上游/替代（capability-strategy §7 口径），供集成波 U-series 补登。

#### [ ] 11. Restore operation 实现（Req6、Req7；design §Components 3）

- [ ] **11.1 操作入口与 handle**：`restore(checkpointId, { plan, signal? })` ⇒ 经单一 checkpoint restore authority 创建唯一 restore operation，返回 operation handle `{ id, ownerId, status(), observe(), dispose() }`（Req6 AC1；api-idioms operation 契约）。
- [ ] **11.2 校验与 fail-closed preflight**：先重验 plan fingerprint、checkpoint 记录、锚点、required claims、preconditions；失败 ⇒ typed `denied`/`conflict`/`unavailable`，**不执行任何步骤**（Req6 AC2、Req5 AC5）。
- [ ] **11.3 排他与 fencing（Req7 AC1/AC2/AC3）**：目标资源排他——先 acquire 对应 coordination lease（key：`sessions.<sessionId>.restore` / `workspaces.<workspaceId>.restore`）再进入 stop/rewind 时序；fencing token 穿过步骤边界；lease 获取失败 ⇒ 不启动；lease 中途丢失 ⇒ 停止启动新步骤、受影响步骤 fail closed、由仍有效信号裁决 terminal，绝不用 stale fence 续写；步骤经自带 CAS/fencing 的 owning authority 时传递 fencing/claim proof，不行使旁路。
- [ ] **11.4 冲突隔离（Req7 AC4）**：两个 restore 或 restore 与 live 进程争同一资源 ⇒ 后者收到 typed conflict/denied，不交错。
- [ ] **11.5 claim 复查（Req7 AC5）**：plan 声明的 required claims 在每个 gated step 前重查，不再持有时不执行该步。
- [ ] **11.6 stop-then-restore 时序（Req6 AC3、Req9 AC1b、Req10 AC4）**：目标 live attempt 且 plan 声明 stop-then-restore ⇒ (a) 经共享 request authority 的 cancel boundary 以 `by: 'system'` 请求停止（唯一 cancel 路径，携带 restore 因）；(b) bounded wait 该 attempt 的 committed terminal（保留调用方 AbortSignal 语义）；(c) 仅当 attempt 达 terminal 后开始回滚步骤；bounded wait 超时 ⇒ fail-closed（`error`/`denied`），绝不在 live attempt 下回滚；切片缺位 ⇒ 运行中 restore denied + reason；无法确证空闲 ⇒ step blocked（fail-closed 方向）。
- [ ] **11.7 步骤执行与 partial（Req6 AC4/AC6）**：每步只经声明的 owning authority（session 档经 `sessions.branches.restore`；workspace 档经 `workspaces.transactions` 或 workspace snapshot slice restore-path——批次 A 交付的接口在 lease fencing 内驱动）；记录每步 typed 结果；首个不可恢复步骤失败 ⇒ `error` terminal + partial 领域结果（`stepsDone`/`failedStep`/perSlice）；step authority 返回 `denied`/fencing 冲突/stale anchor ⇒ 按类别记录，不超声明能力重试、不改写锚点 authority 已提交结果。
- [ ] **11.8 取消与 terminal 裁决（Req6 AC5/AC7；契约 §2.3/§2.4）**：取消/AbortSignal ⇒ 停止启动新步骤、当前步骤达其 authority 定义边界、按共享裁决优先级裁定 terminal；取消不伪造步骤结果；terminal 恰为 `success | error | aborted | denied | superseded` 之一、最终且唯一；迟到步骤结果/stale callback/终态后信号被提交资格拒绝；timeout 归 `error` + reason/classification（不新增 terminal 词）。
- [ ] **11.9 无级联与 retry/attempt（Req6 AC8/AC9）**：每条 checkpoint 记录独立 operation，无隐式跨记录级联；跨 scope 组合恢复以多个显式 operation 或 typed unavailable（需原子时）表达；内部 retry = 同 operation 下 attempt；外部重触发 = 新 operation + lineage；默认不自动 retry。
- [ ] **11.10 审计与释放（design §Error Handling And Lifecycle）**：终态后显式 release lease；各步审计 owner/op id/资源/步骤结果/terminal（无内容、无 secret）；stop 协调中的 bounded wait 随 operation dispose/AbortSignal 取消；disposer/callback identity-bound。

#### [ ] 12. 恢复后血缘与诚实边界（Req10 AC3/AC4/AC5；Req12 批次 B 面）

- [ ] **12.1 血缘归因**：restore operation 记录与结果 branch 携带 lineage-supersession 归因（superseded-by-restore，引用被 stop 的 execution/attempt 身份），经 branch authority 写入（Req10 AC4）；被 stop attempt 的 loop 侧 terminal 由 interaction operation authority 按其裁决规则提交（通常经 cancel 信号裁定 `aborted`），本线不改写该终态。
- [ ] **12.2 不可证明即不虚构**：stop 协调或 branch authority 不可证明（attempt 未达 terminal、branch authority 不可用）⇒ 归因 typed `unavailable`（Req10 AC4）；in-flight 执行状态（attempt/tool/provider context）不声称已恢复（保留 C 类边界）。
- [ ] **12.3 边界呈现**：消费者要求无 authority 可证明的恢复 ⇒ typed `unsupported`/`unavailable` + 指明缺失 authority，不发明隐式 owner/旁路（Req10 AC3）；文档（本线 spec 制品）枚举 v1 支持 source、各自 restore 语义与保留 gap（in-flight 执行状态恢复、跨档原子单提交、官方内部 durability checkpoint 引用、外部副作用回滚）及各 gap 退役条件（Req10 AC5）。
- [ ] **12.4 无旁路与不双消费（Req12 AC2/AC3/AC4 批次 B）**：restore 只经 branch/transaction/snapshot authority；不直接 session mutation、不 append 改写、不 durable 事件拼接；绝不调用 `executions.recovery` evaluate（不双消费）；不自己挂起 attempt（stop-then-restore 是唯一支持边界）。

#### [ ] 13. 批次 B 测试与验收（Req13 AC3/AC5/AC6/AC9 批次 B 面）

- [ ] **13.1 restore 时序测试（Req13 AC3）**：单 authority terminal；stop-then-restore 全时序（cancel 请求 → attempt terminal wait → 回滚；bounded-wait 失败闭合；无 live attempt 下回滚不可能性断言）；fencing 获取/丢失；步骤级 partial；cancel 裁决；迟到/stale 拒绝；无级联；retry/attempt 语义。
- [ ] **13.2 边界测试（Req13 AC5 批次 B）**：无 branch/transaction/workspace/coordination 旁路、无 recovery 双消费、无 attempt 挂起、无 durable 重写、append-only、词汇不混用（terminal/commitState/partial/superseded-by-restore）、恢复后血缘标记。
- [ ] **13.3 owner/scope 隔离（Req13 AC6 批次 B 面）**：两个 synthetic 插件反序注册经 restore 相同路径 ⇒ outcome 一致、owner 隔离成立。
- [ ] **13.4 诚实降级验收**：若 authority 未闭合（任务 10.2 降级分支）⇒ 断言 restore 保持 typed unavailable 且 list/inspect/plan/availability 可用；若切片缺位 ⇒ 断言运行中恢复 denied/blocked + reason（Req11 AC5、Req9 AC3）。
- [ ] **13.5 批次 B 完成验收**：本批全部子项完成，focused + 包级测试绿，`git diff --check` 通过，按 AGENTS.md §3.2 做阶段提交。

#### [ ] 14. 本线 Stage 4 终验（Req13 AC8；AGENTS.md §3.2）

- [ ] **14.1 套件全绿**：受护 `npm test`（走护栏脚本，**不用裸 `node --test`**）在 worktree 内全绿——既有冻结基线套件 + 本线 focused（`test/checkpoint-*.test.mjs`）与包级（`packages/workspace/test/`）测试。
- [ ] **14.2 机械验收**：`git diff --check` 通过；官方包零修改审计（`/usr/lib/node_modules/@deepseek-ai/dsh/**` 未被修改）通过；治理 token 扫描（既有扫描覆盖本线新文件）通过。
- [ ] **14.3 规格制品回写**：核对 requirements/design/tasks 与交付一致；发现的不一致就地修订本线制品（修订注记）；动摇已确认 Goal/Requirements 验收边界的偏差暂停上报，不擅改。
- [ ] **14.4 全局终审（由编排主代理执行，阻塞式只读）**：本线全部顶层任务完成后由编排主代理派发一次阻塞式只读全局终审（本工作代理不派发任何子代理）；返回「无偏差」后才可交付；有意见则集中修订后再次全局终审，直至通过。
- [ ] **14.5 Stage 4 完成提交**：终审通过后提交本 Stage 全部实现、测试、spec 修订与登记（先 `git diff --check`）；工作区干净后回报编排主代理。

### 集成波归属任务（集成代理执行；本线只列要求与验收，不自行执行；契约 §7.1/§8）

> 以下任务由集成代理在四线合并后的统一波执行。本线不触碰其冻结文件，只为每项提供要求与验收判据。

- [ ] **15.1 registry/shape 机械合并**：`public-contract.registry.json` 新增 `executions.recovery.checkpoints` 全成员条目（`create`/`list`/`inspect`/`planRestore`/`restore`/`restore.handle`/`availability`）、capabilities 子簇（`.capture.branch`/`.capture.workspace-journal`/`.capture.workspace-snapshot`/`.restore`/`.restore.stop-then-restore`）、`planRestore` 预定 verb 例外登记（按 M8 封闭 idiom 词表经六字段 `idiomExceptions` 承载，或集成波定稿的等效形状，须与 registry validator 校验规则对齐）、`agent/attempt/*` 事件面登记、新 `workspace` 替代行/包登记；registry-validate/snapshot 全绿。验收：registry 与快照一致、无未登记新叶子、表面快照匹配（Req13 AC7）。
- [ ] **15.2 feature-list 更新**：§7 本行状态（批次 A/B 交付后）、§3.1 跨组件 R 报备登记（workspace snapshot slice 新建 owner 包 + 共享 loop boundary slice 联合登记）、U-series 编号落地（本线 spec 制品已备登记内容）。验收：登记口径与 AGENTS.md §2 第 7 条、feature-list §3.1、capability-strategy §9 一致。
- [ ] **15.3 挂载装配**：`lib/plugin-api-service.js` append slot 挂载 checkpoints 面、`lib/index.js`/`lib/guards.js` 集成、`test/index.test.mjs`/`test/index-events.test.mjs` 挂载顺序与能力快照断言更新。验收：checkpoints 面经真实 `pluginApi` 可用、挂载顺序契约一致（契约 §1.3）。
- [ ] **15.4 共享切片装配验证**：`packages/agent-loop` 共享 loop boundary slice 与三线消费方（interaction/activity/checkpoint）联合装配；本线消费点（live-attempt 证据、cancel 唯一路径、auto-capture 触发）在真实切片上验证。验收：无双跑；切片缺位时本线降级路径如实（Req9）。
- [ ] **15.5 跨线 restore 全链路集成验证**：checkpoint restore 全链路（branches + transactions + coordination + 共享切片 cancel + 恢复后血缘 + 消费者经 `sessions.request` 续跑）在四线合并后真实装配验证；full bundle 与选择性安装装配等价（无双跑、无替代行语义改变）。验收：全链路 fixture 绿、装配等价（Req13 AC7/AC8、契约 §3.5/§8）。

## 完成条件

批次 A → 批次 B → 终验逐批推进（每批 `git diff --check` + 测试绿 + 按 AGENTS.md §3.2 阶段提交；每批完成后工作区干净）。批次 B 的 authority 对齐检查结论与降级决定必须记录在交付报告（含 10.3 不可证明项）。集成波任务由集成代理执行并由其验收，本线只提供要求与验收判据。全部本线任务完成、套件全绿、终审无偏差、完成提交后，才可宣告本线 Stage 4 完成。