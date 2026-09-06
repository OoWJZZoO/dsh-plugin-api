# Stage 3 — Tasks: session-activity-projection

> 本文是 `session-activity-projection` 的 Stage 3 任务书，承接已确认的 `goal.md`（Stage 0）、`requirements.md` v2 与 `design.md` v2（2026-09-06 M9 批量人类确认门通过）。公共主面：`pluginApi.sessions.activity`（host 只读 projection）。

## Status

SPEC3 Stage 3：本任务书以对抗性审查为门（AGENTS.md §3.2 SPEC3）；审查返回「无偏差」后直接进入 Stage 4，不设用户确认门；有意见则就地向本文件集中修订并再次派审。Stage 4 由代理自主完成全部顶层任务，不再逐任务等待人类确认。

**并行纪律（M9 串并行契约）**：本线工作于 worktree `m9/session-activity-projection`（分支 `m9/session-activity-projection`），遵守 `temp/m9-parallel-development-contract.md`（§2 冻结词汇、§3 依赖波、§6 失败呈现、§7 共享文件编辑边界、§8 合并顺序、§9 明确排除）与 `docs/specs/plugin-api-m1-integration/parallel-workflow.md` 三阶段协议。任何任务不得修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 或任何官方包文件；不得修改本任务书「冻结文件」清单所列文件；不得修改 `packages/*` 下任何文件。偏离必须记入本 feature 的 requirements/design 修订注记并显式上报（契约 §8），未上报偏离按违约处理。

### 本线允许触碰的文件范围

| 路径 | 规则 |
|---|---|
| `docs/specs/session-activity-projection/**` | 本线独占（契约 §7.1）；tasks、修订注记、登记草稿、registry draft 落此 |
| `lib/session-activity-*.js` | 本线 owner 模块（契约 §7.2）；中立领域名「session-activity」，不带治理分类字母、批次编号或需求号（AGENTS.md §6） |
| `test/session-activity-*.test.mjs` | 本线 focused tests（契约 §7.2）；命名同上 |

> 模块建议划分（Stage 4 可按实现需要合并/拆分，但保持中立命名与职责对应）：`session-activity-contract.js`（观测契约 marker 与冻结字段清单）、`session-activity-store.js`（per-session activity store + identity）、`session-activity-evidence.js`（证据分类模型）、`session-activity-adapters.js`（官方证据 adapter + durable joiner + 切片 event 注入面）、`session-activity-derivation.js`（reconstruction 规则）、`session-activity-view.js`（查询面 + 脱敏）、`session-activity-observe.js`（observer hub/handle）、`session-activity-availability.js`（availability/capability 状态源）。冻结文件（`lib/guards.js` 等）只读 import（如 P1/P2 typed error 构造），绝不修改。

### 冻结文件（任何情况下不得修改）

`lib/plugin-api-service.js`、`lib/index.js`、`lib/guards.js`、`lib/events-catalog.js`、`lib/events-bus.js`、`lib/deep-freeze.js`、`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`、`docs/specs/plugin-api-features/feature-list.md`、`test/index.test.mjs`、`test/index-events.test.mjs`、`temp/m9-parallel-development-contract.md`、任何 `packages/*` 下属于其他线的文件（含 `packages/agent-loop` 全包）。

## 需求锚点

任务引用 `requirements.md` 的 Requirement 1–13（`R1`–`R13`）：

- R1 Session-Scoped Activity Identity And Correlation / R2 Evidence Model / R3 Activity State And Terminal Vocabulary With Slice-Gated Fidelity / R4 Frozen Projection Queries / R5 Observe Subscriptions / R6 Durable Replay, Cursor Dedupe And Reconnect / R7 Stale Result And Generation Containment / R8 Execution And Attempt Correlation / R9 Loop Boundary Slice Contract（R，共享切片）/ R10 Availability And Degradation / R11 Feature Boundaries — No Action Authority / R12 Multi-Owner Composition And Consumer Safety / R13 Verification And Delivery Gates。

## 冻结决策（源自已批准 requirements/design 与 M9 契约；实现须逐项遵守）

1. **基线冻结**：runtime `0.1.0-rc.6`、主包及全部辅助/聚合包完整版本 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`、`frozen: true`；本 feature 任何任务不得步进任何版本字段，不新增包、不新增行（AGENTS.md §3.0.1 / §4 第 2 条）。
2. **只读消费者（v2 通道）**：本线只交付 facade B 投影（identity、evidence model、查询/订阅、重放去重、availability）。R 共享切片（`agent/attempt/start|end`）由 `session-interaction-operation` 线在既有 `packages/agent-loop` replacement 包内实现，本线**只消费**其冻结契约（R9 AC3 payload 逐字段：`start` = attemptId、operationId（外部 request 发起时有）、executionId（有则带）、sessionId、seq、observedAt；`end` = 同左 + outcome 五值 `success|error|aborted|denied|superseded`、reason/classification（脱敏）、followUp `none|queued`）；**本线不实现该切片、不修改 `packages/agent-loop`**。
3. **attempt 事实 adapter 以切片活性为门**：切片 active 且契约兼容才把 attempt 事实作为 observed 输入；切片 inactive / 版本错配 / 自检失败 ⇒ adapter 关闭、对应字段回 derivation（reconstructed/unknown）、availability 报 degraded——绝不半装配、绝不把猜测标成 observed（R3 AC4 / R10 AC2；诚实降级）。
4. **证据分类四值互不折叠**（R2 AC4）：`observed | reconstructed | unknown | unavailable`；`terminal.confidence` 实际仅 `observed | reconstructed`；silence 永不推断为 success（R2 AC2）；缺失事件不静默推断为成功（Goal Boundaries）；`unknown`/`unavailable`/`degraded`/`partial` 不互相代替（契约 §2.5）。
5. **词汇只消费不重定义**（契约 §2）：identity/generation/epoch/cursor/revision/terminal/commitState/cancellation/scope 沿用冻结语义；`settled|committed|closed|disposed` 不作 status 值（R3 AC1）；terminal 五值唯一、terminal 一旦提交不可改写（R3 AC2）；timeout 归入 `error` 用 reason/classification 标识（R3 AC5）；裁决优先级 `aborted > superseded > error > timeout-error` 一次应用并冻结（R3 AC6）。
6. **identity**：`activityId` 由 facade 生成、facade lifetime 内唯一、同一证据重建确定（同一证据源 ⇒ 同一记录）；不把 event seq、cursor 或官方私有字段当 activity identity；跨 facade lifetime 不承诺连续性（R1 AC1）。
7. **attempt 事实不冒充 durable**（R6 AC2、R7、design Key Decision 4）：切片事实为 in-memory 事件，host 重启后重建视图只对 durable 可再现事实保留 observed，其余降级并带 fidelity 注记。
8. **投影只读**（R11）：不 dispatch/transform/veto 任何 canonical 事件；不写 session durable；不拥有 executions/recovery/lease authority；不补偿性发明业务事实，gap 保持可见。
9. **host-only**（偏离注 1 落地）：不交付 client 原始 activity projection 面；六问判定证据与结论记入 11.3 草稿。
10. **治理魔法字母零泄漏**（AGENTS.md §6）：`lib/`、`test/`、登记草稿与 spec 制品中一切运行时可见名/字符串一律中立（`session-activity`、`attempt-facts`、`observation-contract` 等），禁止 A/R 分类字母、需求编号、`r1` 类治理后缀、工作流代号。
11. **idiom 对齐既有底座**（M8 交付先例）：handle 形状 `{ current(), subscribe(listener), dispose(), epoch }`（R5 AC1）、availability 形状 `{ status: active|degraded|unavailable, reason?: string }`（契约 §6）、verb 集 `current/get/list/history/observe/availability`（契约 §5）；查询/订阅返回冻结视图；typed absence/unavailable 不抛穿（R4 AC2/AC5）。
12. **观测契约 marker**（落实 R9 AC4「the facade's internal observation contract is compatible」）：本线在 `lib/session-activity-contract.js` 定义只读观测契约 marker——中立全局符号（如 `Symbol.for('dsh-plugin-api.session-activity.observation-contract')`）+ 契约版本 + `agent/attempt/*` 冻结字段清单；切片 apply 自检据此核对兼容性（核对方为 interaction 线实现，装配级验证归集成波 I4）。
13. **测试纪律**：统一走仓库 `npm test`（护栏内，禁止裸 `node --test` 绕过；确需原始命令用 `npm run test:raw`）；本线测试只落在 `test/session-activity-*.test.mjs`；纯函数模块零 harness 依赖。**回归不破坏既有套件**：冻结文件不提、既有行为不改。

## 任务清单

> 依赖序：W1 → W2 → （W3/W4/W5 三者相互独立，可在 W2 后并行推进）→ W6/W7/W8（依赖 2–5，可并行）→ W9 → W10 → W11。
> 标记：◆（interaction 线实现）任务由 `session-interaction-operation` 线执行，本线只消费/验收其契约；◆（集成波）任务由集成代理执行，本线只提供要求、草稿与验收标准，一律不自行执行。

### [ ] 1. Wave 1 — 基线核验、证据源 probe 与消费契约冻结（R1、R9；design §Current-State Findings）

- [ ] **1.1 基线核验**：核对 `contractBaseline.packageVersion === '0.1.0-rc.6-0.1.0'`、`api === '0.1'`、`frozen === true`（以 `docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json` 为事实源）；本 feature 不 bump 任何版本字段。产出核验记录（写入本线 spec 目录 `baseline-check.md` 或 tasks 注记）。
- [ ] **1.2 官方证据源只读 probe（名字级）**：盘点并可读验证本线依赖的官方面存在——`dsh-agent-loop` durable 类型与事件（`agent/status`、`agent/error`、`agent/inbox/*` 等）、`dsh-session` firehose（`session/event` 与 `session/created|disposed|flush`）、`dsh-tools`（`tools/*`）、`dsh-user-approval`（`approval/asked|decided`）；只读探测官方包文件，不做任何修改。probe 结果作为 Stage 4 实现输入记录。
- [ ] **1.3 共享切片消费契约冻结**：按 R9 AC3 与 design §3 逐字段冻结消费侧契约（事件名、payload 字段、`seq`/`observedAt` 语义、outcome 五值与 followUp 两值、reason/classification 脱敏要求），落成 `docs/specs/session-activity-projection/slice-consumption-contract.md`（本线侧契约镜像；实现/测试以此为唯一消费依据，不另造词汇）。
- [ ] **1.4 既有底座复用盘点**：核对可复用底座——`sessions.durable.*`（epoch-local observer、no-catch-up、`get/list` 读取语义）与 `executions.observe/get/history` 语义模板（R5/design §Current-State Findings）；列出本线直接复用项与需自行实现项，避免重复发明。
- [ ] **1.5 观测契约 marker 定义**：定义并导出观测契约 marker（冻结决策 12）：中立符号 key、契约版本、`agent/attempt/start|end` 字段清单与读取方式；测试断言 marker 存在且字段清单与 1.3 一致。◆（interaction 线）切片 apply 自检消费该 marker；本线只定义与导出。
- [ ] **1.6 命名与文件边界自查**：本线产物命名与文件 owner 边界自查（契约 §7.1/§7.2、冻结决策 10）：无治理字母/批次编号泄漏、无越界文件写入。

- **要求**：本 Wave 只产出核对、契约冻结与 probe 记录，不写投影实现代码。

### [ ] 2. Wave 2 — Activity store 与 evidence model（R1、R2、R8、R11）

- [ ] **2.1 identity 生成器**：facade 生成 `activityId`（facade lifetime 内唯一、不可枚举可重建）；实现证据源到 identity 的确定性映射（同一证据源 ⇒ 同一记录，R1 AC1）；明确不把 seq/cursor/官方私有字段当 identity。
- [ ] **2.2 per-session activity store**：内存态、可从 durable 证据重建（design §Components 2）；record 形状按 design §Data Models 1（identity、sessionId、correlation、status/terminal、证据分类、facts 摘要、gap、seq/updatedCursor/observedAt/epoch、fidelity）；`kind` 为 store 内部轴不投影；record 只属于单一 `sessionId`（R1 AC3）。
- [ ] **2.3 evidence 分类模型**：四值分类实现与字段级标注（R2 AC1）；字段取值规则（prefer stronger truthful、derivation 规则名记录、R2 AC4）；快照携带 `observedAt` 与适用时 `updatedCursor`（R2 AC5）。
- [ ] **2.4 correlation 合并且（R1 AC5/AC6）**：多来源（agent-loop durable、切片事实、session durable、tool/approval 证据）关联进同一 record，不建重复 record（R1 AC4）；correlation 只由新证据更新并在 public snapshot 冻结时记录证据来源（R1 AC5）；证据不明确时不启发式合并，保持独立 record + 显式 `unknown`/`unavailable` correlation marker（R1 AC6）。
- [ ] **2.5 确定性重建**：view rebuild 时从同一 durable 证据确定性再生成 `activityId`/`seq`/`cursor`；相同证据源 ⇒ 相同 record；facade lifetime 之间不承诺连续性（R1 AC1）。
- [ ] **2.6 只读性设计约束**：store 不写任何 durable 记录、不参与 dispatch/transform/veto、不成为 executions/recovery/leases owner（R11 AC2/AC3/AC4）——以代码结构保证并在测试断言。
- [ ] **2.7 测试**（`test/session-activity-store.test.mjs` / `test/session-activity-evidence.test.mjs`）：identity 唯一性/确定性重建、session 隔离（跨 session 不可见）、四值分类与不折叠、correlation 合并/不合并（ambiguous 分支）、reload 重建、迟后证据更新只冻结新证据、store 不写 durable。

### [ ] 3. Wave 3 — 官方证据 adapters 与 durable joiner（R1、R4、R6、R11）

- [ ] **3.1 官方事件只读 adapter**：`session/event` firehose、`agent/status|error`、`agent/inbox/*`、`tools/*`、`approval/asked|decided` 的只读订阅/观测 adapter（source+seq+observedAt；R1 AC4 输入面）；waterfall 面只 observe 不参与（R11 AC2）。
- [ ] **3.2 durable joiner**：session durable 记录（turn/step/request 边界、user/assistant message、tool/call|result、approval durable）的 cursor replay/join；同一事实的重复 durable 记录按 activity×cursor 只应用一次，dedupe provenance 有界进诊断（R6 AC1/AC5）。
- [ ] **3.3 cursor/gap 语义**：cursor 只用于 replay/去重/重建，不作 resource identity（契约 §2.2）；seq 不连续时暴露 gap marker，不猜测缺失事实为 success（R6 AC6）；payload 早于当前 cursor 的事件忽略/隔离，视图不倒退（R7 AC4）。
- [ ] **3.4 terminal 后迟到信号**：已提交 terminal 的 activity 接收迟到事件/durable 只作 redacted audit，不改写视图、不启动新 attempt、不作当前活动结果（R6 AC4）。
- [ ] **3.5 测试**：joiner 去重、cursor 续接、gap marker、迟到信号、来源缺失 ⇒ `unknown`/`unavailable` 单值标记（R6 AC3）、不重排视图。

### [ ] 4. Wave 4 — attempt 事实消费 adapter（R 消费侧；R2、R3、R9、R10；◆ 切片实现归 interaction 线）

- [ ] **4.1 切片活性探测与只读订阅**：探测入口（切片 active/inactive/版本错配/契约不兼容）与只读订阅注入面（`agent/attempt/start|end` 事件注入 fixture 通道，R9 AC3 冻结 payload 校验）；切片 inactive ⇒ adapter 关闭并联动 availability（W8），绝不半装配（冻结决策 3）。
- [ ] **4.2 start 事实消费**：`agent/attempt/start` ⇒ 该 activity 开始/执行中证据（observed）；attempt/execution correlation 记录；attempt 不创建新 activity identity（R8 AC1）；尝试按 1.3 契约消费 `operationId`/`executionId`。
- [ ] **4.3 end 事实消费（observed 终态/排队）**：`agent/attempt/end` outcome ⇒ terminal（observed，五值唯一、不可改写，R3 AC2/AC3）；`followUp: queued` ⇒ 在 terminal record 上记录 observed queue fact + 会话级 current-queue marker（独立呈现，区别于进行中 `waiting.kind=queued`，且绝不把 terminal 改写回 waiting，R3 AC3）；`followUp: none` ⇒ 空闲事实；`byActivityId`（superseded 归因）若存在则记录；reason/classification 按脱敏规则进入有界诊断（R9 AC3）。
- [ ] **4.4 降级路径（消费侧）**：切片 inactive / host 重启后 in-memory 事实丢失 ⇒ 对应字段回 reconstruction/unknown + fidelity 注记 + availability degraded（R3 AC4、R6 AC2、冻结决策 7）；被切片观察到的 outcome 不被 heuristic 覆盖（R3 AC3）。
- [ ] **4.5 测试**（`test/session-activity-slice.test.mjs`）：注入切片事件验证 observed 路径（start/end payload 形状断言逐字段、outcome 五值、followUp 两值、queue marker 置位/清除、terminal 不重写）；切片 inactive/错配/契约不兼容 fixture 断言降级与 fidelity；观察契约 marker 与契约镜像一致。◆（interaction 线）切片本体实现/官方契约 parity/boot 自检/无双跑测试由其 own；本线只做消费侧。

### [ ] 5. Wave 5 — Derivation 引擎（R2、R3、R6、R8、R11）

- [ ] **5.1 规则表逐行实现**（design §Data Models 2，仅在无 observed 事实时生效）：开始/执行中（durable turn/step 边界）、terminal success/error（`turn/end`+空闲边界 ⇒ success；`agent/error` ⇒ error）、superseded（新 user/turn 边界落在旧 turn 未 end ⇒ `superseded-by-boundary`）、denied（approval 拒绝 durable + correlation 可证 ⇒ `denied-by-approval`）、aborted（默认 unknown，无可靠规则）、排队 vs 空闲（无规则 ⇒ unknown）；规则输出必须带 `reconstructed` 标注与规则名（R2 AC1/AC4）。
- [ ] **5.2 裁决窗口与优先级**：同一证据窗口内 `aborted > superseded > error > timeout-error` 一次应用并冻结 terminal（R3 AC6）；timeout 证据 ⇒ `terminal: error` + reason/classification 标注 timeout（R3 AC5）。
- [ ] **5.3 overclaim 禁令实现**：silence ⇒ `unknown`/interim 而非 success（R2 AC2）；reconstructed 永远不能标成 observed；`unknown`/`unavailable` 不折叠（R2 AC4、R6 AC3）；不补偿性发明业务事实（R11 AC5）。
- [ ] **5.4 执行中边界**：`interrupted`/`waiting` 等 interim 由已提交事实派生；in-flight 内部上下文不属于本投影（requirements「残余 C 登记」注记），不臆造 in-flight 事实。
- [ ] **5.5 测试**（`test/session-activity-derivation.test.mjs`）：derivation 表逐行 fixture（输入证据 → 分类输出）；denied 的 observed/reconstructed/unknown 各档；overclaim（silence→success、reconstructed→observed）断言不可能；timeout→error；superseded 归因；裁决优先级一次冻结。

### [ ] 6. Wave 6 — 查询面（R2、R4、R10、R11）

- [ ] **6.1 `current(sessionId)`**：返回冻结 snapshot 或 typed absence；无副作用、不泄漏可写状态（R4 AC1）。
- [ ] **6.2 `get(activityId)`**：返回带完整证据分类的冻结 record；未知 record 返回 typed absence/unavailable 而非异常（R4 AC2）。
- [ ] **6.3 `list({ sessionId, cursor?, limit? })`**：按稳定 `seq`/cursor 语义的冻结有序分页 + cursor continuation（R4 AC3）。
- [ ] **6.4 `history(sessionId)`**：由 durable 证据界定的冻结历史 + truncation/unavailability 状态表达（R4 AC4）。
- [ ] **6.5 失败呈现**：成员不可服务时返回 typed unavailable/degraded，不外抛（除 P1 `PluginApiInactiveError` / P2 `PluginApiFeatureDisabledError`，只读复用 `lib/guards.js` 既有构造——冻结决策 11；契约 §6）。
- [ ] **6.6 host 侧脱敏（by audience）**：查询返回内容在冻结前按受众 host 侧脱敏；正文不进 snapshot；secret/owner-private 不出任何出口（R2 AC3、R4 AC6、visibility-and-redaction 分册）；content provenance 只露可证明部分。
- [ ] **6.7 边界纪律**：面内不暴露任何 request/cancel/retry/notify 动作（R11 AC1）。
- [ ] **6.8 测试**（`test/session-activity-view.test.mjs`）：六查询成员冻结性/副作用断言、typed absence/unavailable、分页续接、truncation 状态、P1/P2 路径、无动作成员。

### [ ] 7. Wave 7 — observe 订阅面（R5、R7、R12）

- [ ] **7.1 handle 形状**：`observe({ sessionId })` ⇒ `{ current(), subscribe(listener), dispose(), epoch }`；`current()` 返回调用时冻结当前 snapshot（R5 AC1）；handle 成员按 registry 规则独立登记（draft 见 11.1）。
- [ ] **7.2 投递与 containment**：变化时每个 listener 收到冻结新 snapshot 或 typed change record；listener 异常只收敛到该 listener（R5 AC2）；投递按投影稳定 `seq` 顺序（R5 AC6；ordering 分册 §1）。
- [ ] **7.3 dispose 语义**：stop invoking、幂等；stale disposer 不移除/不影响其他 observer 或重建后的 epoch（R5 AC3）。
- [ ] **7.4 epoch 语义**：observe 重建（reconnect/epoch rollover）后新 handle 暴露新 `epoch`；旧 epoch 回调不在新 handle 投递、不改写当前视图（R5 AC4）；投影 owner 自身 epoch 重建时关闭旧 epoch 内部 worker，不写入新 epoch 状态（R7 AC3）。
- [ ] **7.5 订阅相互独立**：additive；注册顺序不编码业务语义（R5 AC5）；owner context 结束/插件 reload/dispose 只移除该 owner 的监听（R12 AC3）；无效输入返回 typed invalid-input/absence 且不腐蚀其他订阅（R12 AC2）。
- [ ] **7.6 提交资格**：异步结果/回调/disposer 入库前检查 owner/generation/epoch/terminal 资格（R7 AC1）；资格失败不更新视图、不投递为当前变化、不清除新 observer 或他人资源，可有界留档诊断（R7 AC2）。
- [ ] **7.7 测试**（`test/session-activity-observe.test.mjs`）：handle 形状、containment、幂等 dispose、stale disposer、epoch rollover 与旧回调隔离、seq 顺序、additive 独立性、无效输入隔离。

### [ ] 8. Wave 8 — availability 与生命周期（R7、R10、R12）

- [ ] **8.1 `sessions.activity.availability()`**：冻结 `{ status: active|degraded|unavailable, reason?: string }`，永不抛（R10 AC1）；健康/诊断信息不混入（契约 §6）。
- [ ] **8.2 逐源探针**：每个官方证据源缺失 ⇒ 投影对仍可服务的源保持 active，reason 与 per-view marker 报告缺失源（R10 AC3）；切片 inactive/版本错配 ⇒ degraded + 具体 reason（如 `terminal-evidence=reconstructed`），official-event/durable 源事实照常服务（R10 AC2）。
- [ ] **8.3 owner 初始化失败**：投影 owner 初始化失败只记有界诊断、暴露 degraded/unavailable，不抛穿 apply/boot（R10 AC4）。
- [ ] **8.4 capability 状态源**：为 capability 词条（`sessions.activity`、`sessions.activity.attempt-facts`——中立名，不带包/行身份，R10 AC6）提供运行时状态源（active/degraded/unavailable 三值），供 capabilities 面在集成波装配时读取；词条登记本身归 11.1 draft + 集成波 I1。
- [ ] **8.5 上下文一致性**：headless/web-host/TUI-host 在同一 runtime identity 下呈现相同 query/observe 语义，仅按该上下文可及源报告 per-context degraded（R12 AC5；headless 为主交付面）。
- [ ] **8.6 测试**（`test/session-activity-availability.test.mjs`）：逐源缺失 + 切片 inactive 的 status/reason 断言；初始化失败路径；P1/P2；capability 状态源三值；per-context degraded。

### [ ] 9. Wave 9 — 组合与消费者安全（R12；R13 AC1）

- [ ] **9.1 独立性与隔离**：多插件查询/观察同一 session 得到同一冻结视图语义（单一投影 owner），互不见私有状态（R12 AC1）；视图/handle 交到调用方时冻结或只读（R12 AC4）。
- [ ] **9.2 双合成插件逆序组合测试**：两个 synthetic 插件逆序注册，证明查询/观察独立性、owner 清理、重复订阅与回调 containment（R13 AC1）。
- [ ] **9.3 测试**（`test/session-activity-composition.test.mjs`）：9.1/9.2 全项 + 无效输入隔离 + owner context 结束清理不影响他人。

### [ ] 10. Wave 10 — 保真/重放/脱敏专项与回归防退化（R13 AC3/AC4/AC5；R2、R3、R6）

- [ ] **10.1 fidelity 双态 fixture**（R13 AC3）：每个 documented derivation 规则与每类切片 observed 事实各有「输入证据 → 分类输出」fixture；切片 active 态断言 observed 级终态/排队事实（含 denied 的 observed 档）；切片 inactive 态断言 reconstruction/unknown 且 overclaim（silence→success、heuristic→observed）不可达。
- [ ] **10.2 replay/reconnect fixture**（R13 AC4）：host reload（observed→reconstructed fidelity 降级，R6 AC2）、terminal 后迟到事件、重复 durable、cursor gap、epoch rollover、stale disposer、旧 epoch 回调；replay 不可达证据 ⇒ `unknown`/`unavailable` 单值标记。
- [ ] **10.3 redaction fixture**（R13 AC5）：snapshot 与日志机械断言无 secret/owner-private 材料（含切片 end payload 的 reason/classification 脱敏，R9 AC3）。
- [ ] **10.4 回归防退化**：既有底座行为（`sessions.durable.*`、`executions.*` 既有测试）不回归；本线不改动冻结文件与既有行为（冻结决策 13）。

### [ ] 11. Wave 11 — 登记草稿、验证与交付（R9、R13；AGENTS.md §3.2/§6）

- [ ] **11.1 registry draft（sessions.activity 成员 + handle + capability 词条）**：产出 `docs/specs/session-activity-projection/registry-draft.json`——`current/get/list/history`（projection/read/pure/session）、`observe` 入口与 `observe.handle`（projection/subscribe(handle 行 read)/additive/session）、`availability()`（selfDescription/read/pure/facade）、capability `sessions.activity` 与 `sessions.activity.attempt-facts`（中立名、不带包/行身份）逐条含 M8 冻结决策 3 的字段全集（不适用字段显式 `null`）；`agent/attempt/*` catalog 条目（semantics=`fact`、producer authority=agent-loop owner slice）由切片装配方（interaction 线）+ 集成波登记，本线在 draft 中列消费侧字段核对表。◆（集成波 I1）机械合并进 `public-contract.registry.json`。
- [ ] **11.2 U-series 上游提案与退役条件草稿**：产出 `docs/specs/session-activity-projection/upstream-registration.md`——「官方 agent-loop attempt 生命周期/settle/queue 公开 seam」上游提案（现状缺口：官方无 abort/supersede/settle/排队公开事实出口、无稳定 per-execution identity 公开面——见 design §Current-State Findings 与残余 C 登记），**退役条件**：官方提供等价公开 attempt/settle/queue seam 后，attempt 事实侧直绑官方、相应 reconstruction 规则删除、本片切片能力退役、门面保留（capability-strategy §4.1 / requirements R9 AC8/AC9）；登记内容写入本线 spec 制品，feature-list §3 U-series 表实际落条归集成波 I2。◆（interaction 线）其 admission/cancel seam 提案由其线各自草拟，最终 U 编号/表位由集成波统一分配。
- [ ] **11.3 共享切片联合登记草稿 + host-only 六问证据**：产出共享切片联合登记草稿（Requirements R9 AC10：与 interaction/checkpoint 三线在 feature-list §3.1 登记为同一 owner 包共享 capability，attempt 事实词汇只定义一次、三线消费；本线写入消费侧词汇表/字段核对表与消费侧约束）；并对被替代官方行 `agent-loop` 做 capability-strategy §10 六问只读证据核对（client manifest / remote namespace / slot/settings bridge / 版本协商 / browser state / client-facing event-service 全否 ⇒ host-only），结论与证据写入同一草稿。◆（集成波 I2）§3.1 联合登记落表。
- [ ] **11.4 全量验证（迁移/验收门）**：本线改动后 `npm test` 全绿（护栏、禁止绕过；含既有全部测试与 `test/session-activity-*.test.mjs`，`temp/` 不参与扫描）；`git diff --check` 通过；官方包零修改审计（`/usr/lib/node_modules/@deepseek-ai/dsh/**` 未被修改）通过；本线范围内 registry/surface 自检（draft 与模块表面一致性）通过；任一失败/超时/无法建立证据按阻塞处理。
- [ ] **11.5 规格制品回写**：核对 requirements/design/tasks 与本线交付一致；实现中发现的细节偏差就地修订对应文档并列入最终报告；动摇 Goal/Requirements 验收边界的偏差必须暂停请示（AGENTS.md §3.2 Stage 4 通用规则）。
- [ ] **11.6 全局终审（阻塞，编排主代理执行）**：全部顶层任务完成后由编排主代理派发一次只读阻塞式全局终审；本线按结论集中修订（实质修订后再次终审直至「无偏差」）。
- [ ] **11.7 Stage 4 完成提交**：终审通过后 `git add` 本线交付（实现/测试/规格修订/登记草稿），先 `git diff --check`，阶段提交（信息如 `feat(m9): session-activity-projection stage 4`）；提交后工作区干净；交付最终结果报告（任务完成情况、spec 修订清单、阻塞记录）。

- **要求**：交付物全绿 + 终审无偏差 + 阶段提交 + 工作区干净，才可宣告本线 Stage 4 完成；集成波事项在 11.x 只产出草稿与验收标准，不越界执行。

## 集成波归属任务（本线不执行，仅列要求与验收；由集成代理在合并波/统一波执行）

| # | 任务 | 要求 | 验收 |
|---|---|---|---|
| I1 | registry/shape 机械合并 | 按 11.1 draft 将 `sessions.activity.*` 成员、`observe.handle` 行、capability 词条两枚与 `agent/attempt/*` catalog 条目（producer authority=agent-loop owner slice）机械合并进 `public-contract.registry.json`；不重排既有 registry；namespace 导航记录 `availabilityMember` 指向 `sessions.activity.availability()` | 每叶字段全集齐全；handle 行独立登记；idiom/语义/scope 与 draft 一致；validate/snapshot 脚本绿；既有条目零误改 |
| I2 | feature-list 行更新与联合登记落表 | 更新本 feature 行（状态 delivered、关键约束）；按 11.2/11.3 草稿在 §3 U-series 表新增条目并落 §3.1 共享切片联合登记（同一 owner 包 capability，三线词汇一次定义）；同步 U 编号分配 | 登记内容与草稿一致；无治理字母泄漏；退役条件成文 |
| I3 | 跨线 observed 全链路集成测试 + 共享词汇机械一致性 | 真实装配 `packages/agent-loop`（interaction 线交付切片的激活态）→ 发出 `agent/attempt/start\|end` → 本线投影 produce observed 终态/排队事实断言；本线/交互线/checkpoint 线词汇声明机械比对一致（偏离注 2 补偿测试） | 链路 fixture 全绿；observed 档断言；词汇表机械一致 |
| I4 | 切片装配验证（实现侧属 interaction 线） | 官方行 disabled、替代行 active、boot 自检（含观测契约 marker 兼容核对，冻结决策 12）、无双跑、版本错配局部停用不波及其他能力、移除恢复官方行；切片失败 ⇒ 只 log+inert，投影 degraded | 自检矩阵各态断言；错配只停用相关 slice；官方行永不落入「disabled 且无功能替代」空洞 |
| I5 | 挂载与 gating 集中整合 | 按契约包预定位置在 `lib/index.js` / `lib/plugin-api-service.js` 挂载本线 owner 模块（FEATURE_MOUNTERS / guard 分支 / disabled 工厂），P1/P2 路径与能力 gating 接 `capabilities` | apply 级冒烟绿；P1/P2 路径断言；能力三值映射正确 |
| I6 | 冻结文件解锁后的全局一致性 | 解锁后 registry/surface 一致性全局校验、全量快照重建、`npm test` 全绿（护栏）、`git diff --check`、官方包零修改审计 | 全部通过后方可交付 M9 集成报告 |

## 迁移与验收总则

- 本 feature 无跨仓库消费者迁移义务（AGENTS.md §5 所述 `dsh-read-image` / `dsh-pro-ex-ability-anchor` 现实来源不涉及本公共面；M9 消费方为同批其他 feature，属 I3 覆盖）。
- 验收 = 本线全量验证（11.4）+ 全局终审无偏差（11.6）+ Stage 4 完成提交与工作区干净（11.7）+ 集成波 I1–I6 全绿；任何一步失败均不得宣告交付。
- 执行中发现任何设计生效性问题（如「facade's internal observation contract」的具体形态、切片事实与 durable joiner 的优先级次序、queue marker 清除语义等实现细节）按 AGENTS.md §3.2 Stage 4 通用规则处理：属实现细节/设计矛盾由本线先修订对应 spec 文档并列入最终报告；动摇已确认验收边界则暂停并请求人类裁决。