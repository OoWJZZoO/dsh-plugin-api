# Second-batch 并行契约（temp 临时版 · 非制品）

> 定位：**临时编排参考，不是 spec 制品**。不登记、不进入 `docs/specs/`、不单独提交；分发任务书时直接引用本文件；用毕即删（AGENTS.md §3.5 轻量契约路径）。
> 基线：main `c1d49d656beb0770b15483e7adce662d732ba0a4`（四份 Requirements 已提交；四份 Design 已批准并提交，Stage 2 已完成）。本契约是编排准备，不改变四份 spec 的任何验收边界，也不构成对任何后续 Stage 确认门的提前通过。
> 生效前置：每 feature 的 `tasks.md` 仍须获用户批准并提交（Stage 3 边界）后，才可派生/执行该 feature；详见 §0。

## 0. 前置门槛

- 每 feature 的 `tasks.md` 获用户批准并提交（Stage 3 边界）后，才允许派生并执行该 feature；未获批准或未提交的 feature 不得提前开工。
- 任何 worktree 只能从**已提交边界**派生；不得从脏工作区派生。
- **外部基座（推荐等待）**：M6 的 `execution-observation` 与 `usage-budget-telemetry` Stage 4 交付并合入 main，作为 `model-route-policy` / `recovery-policy` 的 execution/attempt 与 budget evidence 的 interop 验证基座。若这两个基座尚未交付，两个 feature 只能以 fixture 仿真其公开投影，且相关验收必须显式标注 `deferred-integration`（需用户批准）——默认不采用该降级。
- 本文件要点在任务书里以“契约包 = `temp/second-batch-parallel-contract.md` 第 N 节”的方式引用，不另行复制。

## 1. Feature 矩阵

| Feature | 公开面 / 命名空间 | 分类 | 硬依赖 | worktree / 分支建议 |
|---|---|---|---|---|
| `attachment-pipeline` | `pluginApi.attachments`（marker 门控）+ `packages/attachments/`（row `plugin-api-attachments`） | R replacement（`dsh-attachment-local` 唯一 owner） | 无硬依赖；`llm` admission / `model-route-policy` 只作显式 evidence 输入（`{accepted, source, observedAt}`） | `.worktrees/second-attachments` / `feat/second-attachments` |
| `client-generation-rebind` | `pluginApi.client.lifecycle`（client bundle 内） | B client facade | 无硬依赖；`plugin-diagnostics` 只经公开投影引用，不 mutate | `.worktrees/second-client-lifecycle` / `feat/second-client-lifecycle` |
| `model-route-policy` | `pluginApi.routePolicy`（marker 门控）+ `packages/agent-loop/`（row `plugin-api-agent-loop`） | R replacement（`dsh-agent-loop` 唯一 owner） | 软依赖 EO / UB 公开投影（availability 门控）；与 `recovery-policy` 语义配对（fallback 归属 / attempt 授权边界） | `.worktrees/second-route-policy` / `feat/second-route-policy` |
| `recovery-policy` | `pluginApi.recovery` | B host policy facade | 软依赖 EO / UB / `routePolicy.decisions` 公开投影（availability 门控） | `.worktrees/second-recovery` / `feat/second-recovery` |

硬依赖判定：本批四个 feature 之间**没有编译期/运行期硬依赖**，全部是“若已 active 则消费公开投影、否则 evidence=unavailable”的软 interop。因此波次安排不由硬依赖决定，而由共享文件冲突、R 类风险与语义配对决定（见 §5）。

## 2. 冻结公共词汇（防平行发明）

- **终态词汇**：`outcome` / `commitState` 只允许 `success | error | aborted | denied | superseded`；`settled`、`closed`、`disposed`、`settledAt` 只作生命周期元数据，不得当 outcome（`identity-and-lifecycle.md`）。
- **EO（权威归 execution-observation）**：`executionId`、`attemptId`、terminal outcome、provenance/uncertainty。本批只能消费，不得自造 execution identity。
- **UB（权威归 usage-budget-telemetry）**：budget/usage evidence 的形状、`provisional/late/replay` 与 certainty 语义；本批只消费。
- **admission evidence（attachment ↔ llm/route）**：`{ accepted: boolean, source: string, observedAt: string }`；缺失 → `unavailable`，绝不推断。
- **route（model-route-policy 权威）**：`decisionId`、`windowKey {sessionId, turn, attemptEpoch}`、`fallbackParentId`、provider/model、非 secret config、`commitState: success|denied`；attempt 内 immutable，新 turn / 新 attemptEpoch 才重评。
- **recovery（recovery-policy 权威）**：`class {transient|permanent|aborted|denied|superseded}`；`action {retry|abort|fallback|fork|stop}`；`decisionId`、`parent {executionId, attemptId?}`、`proposedAttemptId`、`bounds`、`consumed`；safe default `stop`；consume single-use。
- **attachment（attachment-pipeline 权威）**：`attachmentId = sha256:<hex>`、`recordId`、`ownerId + generation`（owner-local opaque）、scope 每次只取 `session|workspace|profile` 之一、`origin {original|derived}`、`commitState`。
- **client lifecycle（client-generation-rebind 权威）**：`FaceState {available|pending|unavailable|degraded|disposed}`（不是 execution outcome）；`contributionId/contributionEpoch`；connection/remote/slot/settings/modules 五个 epoch 独立，refresh/reconnect/schema revision 绝不合并为一个数字；connection epoch 是 facade 从官方公开信号推导的 owner-local epoch（官方 controller 的 generation/attempt 是 instance-private，不得读）。
- **共用 owner 规则**：所有注册/记录带 `ownerId + generation`；disposer 幂等且 identity-bound；stale 结果只保留为诊断证据；`latest-wins` 仅在未提交终态前有效；未显式声明 idempotent/retryable 的操作默认**不自动 retry**。
- **visibility policy face**：一律走 `docs/standards/api-shape.md` §1 的单注册点 + 纯函数 + disposer 形态；redaction 失败 = fail-closed。无 policy 时：模型可见 recovery 数据默认缺席，UI/日志省略 payload/路径/凭据/raw bytes。

## 3. 命名与共享文件边界

- **R 类 leaf 不设 guard 分支、不进 `FEATURE_MOUNTERS`**：`attachment-pipeline` 与 `model-route-policy` 只走 replacement marker + boot 自检 + 版本 identity matrix（对齐 M6 `mcp-catalog-lifecycle` 约定）。主包 leaf 只按 marker 门控，可用性失败呈现 `unavailable` + typed error。
- **recovery**：guard 分支名 = `FEATURE_MOUNTERS` 键 = namespace 名：`recovery`。disabled 工厂进 `lib/plugin-api-service.js` 对应追加。
- **client-lifecycle**：仅 client 侧；**无 host guard 分支、不进 host `FEATURE_MOUNTERS`**；client 侧 feature key `clientLifecycle`。
- **契约符号**（`Symbol.for`，主包不 import 辅助包）：
  - `dsh-plugin-api.attachments.contract`（挂在 replacement 的 `ctx.attachments` 实例）
  - `dsh-plugin-api.agent-loop.contract`（挂在 replacement 的 `ctx.agentLoop` 实例）
- **公开服务名（运行时中立，无治理后缀）**：`ctx.attachmentsPipeline`、`ctx.routePolicy`。

| 共享文件 | 写入模式 |
|---|---|
| `lib/index.js` | attachment / routePolicy / recovery 三个 host 工作树都会追加 mounter。**本文件一个时刻只有一个 worktree 拥有**：波次串行化决定 owner（§5）；其余工作树只读。 |
| `lib/plugin-api-service.js` | 同上串行化：各工作树只追加自己的 disabled 工厂 + constructor 一行 + `mountFeature` 一个分支。 |
| `lib/guards.js` | 仅 recovery worktree 追加自己的一个 `else if` 分支。 |
| `packages/full/cordis.patch.yml` | attachment 与 model-route 各自追加自己的替代行；**按波次串行修改**，禁止两工作树同时改。 |
| `packages/attachments/**`、`packages/agent-loop/**`（新建） | 各自 worktree 自有；辅助包版本先按“与主包同源格式”占位，最终版本由 integration owner 对齐。 |
| `lib/client.js` 及其 client 侧源模块 | 仅 client-lifecycle worktree；attachment / routePolicy / recovery worktree **禁止触碰**。 |
| 主包 `package.json` / 版本 bump / 聚合 bundle 装配 | integration owner；本批 leaf worktree 不得改主包版本号。 |
| `docs/specs/<own-feature>/` | 各自自有。 |
| `docs/specs/plugin-api-features/feature-list.md` | 只改自己 feature 对应的行/登记；U10–U15 注册由 design 批准提交统一完成，leaf worktree 不重复注册。 |
| `AGENTS.md` | 本批 leaf worktree 不改；integration owner 统一处理。 |

| 冻结文件 | 说明 |
|---|---|
| `lib/events-bus.js` / `lib/deep-freeze.js` / `lib/events-catalog.js` / `lib/catalog-compose.js` / `lib/version.js` / `lib/wrap-safety.js` | 需要变更一律记“整合期议题”，不得私改。 |
| `test/index.test.mjs` / `test/index-events.test.mjs` | 顺序断言由 integration owner 统一维护。 |

- **本批不新增 events catalog slice**：三份 design 已声明（attachment、route-policy、recovery 均不加 catalog）；client-lifecycle 也不加。若实现发现确需新 catalog 条目，记“整合期议题”上交。

## 4. 失败呈现

- R（attachment / route-policy）：自检失败 / 版本失配 / owner 冲突 → 结构化诊断 + 正常 return；官方行已禁用时注册官方等价 fallback（pipeline/routePolicy 关闭）；官方行 enabled 时 inert；任何情况下禁止与官方行双跑；仅停用本 R capability，不波及主 facade 与其他 feature。
- recovery：guard 失败 → P2 feature disabled；`pluginApi.recovery` 返回 disabled surface + typed error；`apply` 绝不抛穿 boot。
- client-lifecycle：client 侧官方服务缺失 / 初始化失败 → inert disabled surface；client boot 继续。
- 三个 host 面（attachments leaf / routePolicy leaf / recovery）的 feature 初始化失败各自独立降级，不得互相连带。

## 5. 波次与合并顺序

### 推荐方案（4 wave，工程质量优先）

| 波次 | 内容 | 理由 |
|---|---|---|
| **Wave A（并行）** | `client-generation-rebind` + `attachment-pipeline` 两个 worktree | 二者共享文件冲突最小：client-lifecycle 只动 client 侧，attachments 拥有 `packages/attachments/**` 并在 host 共享文件中按约定槽位追加；同一波内互不等待。 |
| **Wave B（串行）** | `model-route-policy`（单独） | 它是 1295 行 `dsh-agent-loop` fork，自检/契约等价测试最重、风险最高；且它要改 `lib/index.js` + `lib/plugin-api-service.js` + full patch，与 Wave A 的 attachment 若并行必然在同一批共享文件上冲突。同时其 interop 验收需要 EO / UB 基座（§0）。 |
| **Wave C（串行）** | `recovery-policy`（单独） | 与 route-policy 存在双向语义边界（fallback 候选归属 route-policy、attempt 授权归 recovery），等 route-policy 合入后其 interop 测试能对真实现运行；它也是下一个 `lib/index.js`/`plugin-api-service.js`/`guards.js` 的唯一 owner。 |
| **Wave D（integration）** | 只读预检（scope/owner/夹带核对 + 两两 `git merge-tree` 冲突图 + 官方包零修改审计 + 治理 token 审计）→ 按 §5.1 顺序 merge，每次 join 后全量 `npm test` 绿 → Stage 4 全局终审 → 合入 main。 | 集中整合与全绿收口。 |

### 5.1 合并顺序（Wave D）

`client-generation-rebind → attachment-pipeline → model-route-policy → recovery-policy`

- 前两个是 Wave A 并行产物，join 时按“共享文件占用最少者先合”排序：client-lifecycle（host 零共享）先合，再合 attachment。
- 后两个按波次顺序合入，每个 join 后全量 `npm test` 绿才能进入下一个 join。

### 5.2 为什么不把 recovery 也放进 Wave A（三路并行）

`recovery-policy` 与 `attachment-pipeline` / `model-route-policy` 一样要追加 `lib/index.js` + `lib/plugin-api-service.js`；三路并行会把集成期冲突全部集中在同一个文件，且 route ↔ recovery 的语义配对（fallback / attempt 授权）需要串行验证。本批只有 4 个 feature、其中 2 个是高风险的 R fork，**质量优先于并行度**。

### 5.3 备选（更快但需用户批准）

若用户明确要求压缩周期：Wave A 可增加 `recovery-policy` worktree，条件是提前把 `lib/index.js` 与 `lib/plugin-api-service.js` 的追加槽位在任务书中精确分片（三个 host 工作树各自只写自己命名的独立模块，`mountFeature` 分支由 integration owner 在 Wave D 统一接线），并把 EO / UB 未交付时的 fixture-only 验收降级写成用户批准记录。默认不推荐。

## 6. 每个 worktree 任务书最少字段

1. 范围：本 feature 需求编号全列；2. 明确排除的编号；3. 允许触碰文件清单；4. 禁止触碰文件清单；5. 依赖边界（引用哪些已提交边界，含 EO/UB 基座与 §2 冻结词汇）；6. focused test 范围（取自各自 design 的 Testing Strategy）；7. 提交边界；8. 需向预检提交的证据（测试结果、diff-check、干净工作区声明、官方包零修改证据）。

## 7. 验证闸

- 每个 worktree：`npm test` 全绿（**不裸跑 `node --test`，不绕过 4G 内存护栏**）、`git diff --check`、工作区干净、官方 DSH 包零修改、治理 token 审计干净。
- R worktree 加测（取自 design）：patch 组合 / 自检失败不双跑 / identity matrix 失配仅停用本能力 / owner 冲突 / config 连续性 / vendored fork 与官方基线等价 / 六项 client 判定回归 / U-series 退役提案登记。
- client-lifecycle worktree 加测：五 epoch 独立、bind/rebind、stale guard、官方契约保真、诊断不拥有状态。
- recovery worktree 加测：safe default `stop`、consume single-use、terminal 保护、policy 收敛、public-projection 门控。
- Integration：全量 `npm test` 绿 + feature-list / AGENTS 同步 + 四 feature spec 覆盖一致 + 版本对齐（主包与两个新辅助包统一 full unique version）。

## 8. R 类约束不豁免

`attachment-pipeline` 与 `model-route-policy` 仍须完整满足 `docs/standards/capability-strategy.md` R1–R9：整行替代、只用官方 patch 机制、组件唯一 owner、版本锁定、boot 自检、R3 import 边界、client 半面判定、上游提案与退役条件。本 temp 契约只简化**编排载体**，不降低任何 R 类硬约束或 Stage 确认门。
