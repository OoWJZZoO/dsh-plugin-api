# Stage 3 — Tasks

> feature_name: `session-interaction-operation`
> milestone: M9
> status: SPEC3 Stage 3（Tasks）已产出，待对抗性审查门；通过后直接进入 Stage 4。

## Status

SPEC3 Stage 3：本任务书承接已确认的 `goal.md` / `requirements.md` / `design.md`（Stage 0–2 于 2026-09-06 M9 批量确认门获批，均为 v2）。本文按 AGENTS.md §3.2 以对抗性审查为门；审查返回「无偏差」后直接进入 Stage 4，不设用户确认门。本文由 `session-interaction-operation` 线 WORK-AGENT 在续建 worktree `m9/session-interaction-operation` 内编写。

**并行纪律**：本线遵守 `temp/m9-parallel-development-contract.md`（§2 冻结词汇、§3.2 第二波依赖、§5 动词与命名规则、§6 失败呈现、§7 共享文件编辑边界、§8 合并顺序、§9 明确排除）与 `docs/specs/plugin-api-m1-integration/parallel-workflow.md` 三阶段协议。任何任务不得修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 或任何官方包文件；不得改动主 checkout；提交只发生在本线 worktree 分支上。

**实施通道缺省决策**：按 requirements 引言「实现通道方向」与 design Current-State Findings，缺省为 **Exit B（R 切片实现）**——在既有 `dsh-agent-loop` replacement owner 包（`packages/agent-loop`）内扩展共享 loop boundary slice。任务 1 是 Stage 3 契约 probe 复核门：**仅当 probe 以可复现证据证明官方公开 seam 已足以支撑与本 feature 相同语义（request acceptance / cancel / attempt 终态事实出口）时**，才按 Design 决策规则退回纯 facade（**Exit A**）并在本 feature 的 requirements/design 就地登记修订。退回纯 facade 属已获批决策规则的自然执行（requirements 引言已含此判据），不改变已确认的 Goal/Requirements 验收边界，故不触发新的人类确认门；但必须登记偏离并让任务 5/6/7/8 改用官方 seam，任务 2/3/4 标记为按门不执行。

**任何情况下**：官方 seam 无法证明时返回 typed `unavailable`，绝不把 append→flush→猜 loop 路径伪装成完整 request API（Requirement 1 AC4、Requirement 3）。

## 需求锚点

任务按段引用 `requirements.md` 各节（`Requirement N` 为节号；`N-M` 为该节第 M 条 AC）：

- Requirement 1 Request Operation Entry And Acceptance Outcomes / Requirement 2 Operation Handle And Lifecycle / Requirement 3 Single Request Authority — No Append-Flush Guessing / Requirement 4 Cancel Is A Signal, Terminal Is An Adjudication / Requirement 5 Idempotency, Duplicate And Re-Trigger Semantics / Requirement 6 Activity Correlation And Shared Vocabulary / Requirement 7 Domain Gates Stay Owned By Their Domains / Requirement 8 Availability, Capability And Degradation / Requirement 9 Client Half For Interactive UIs / Requirement 10 Audit, Owner And Bounded Evidence / Requirement 11 Agent-Loop Replacement Slice Contract / Requirement 12 Verification And Delivery Gates。

## 冻结决策（源自 design，实现须逐项遵守）

1. **基线冻结**：现行 `packageVersion = 0.1.0-rc.6-0.1.0`、`dsh.api = 0.1`、runtime `0.1.0-rc.6`；本 feature 全程不步进任何版本字段（requirements 引言、design §Key Decisions）。
2. **单一提交 owner**：operation terminal 只由本 feature 的 request authority 在提交点原子裁决；loop 侧 R 切片只报 attempt/提交事实，绝不各自 commit operation 终态（design Overview 边界 1）。
3. **不猜 loop**：没有任何路径用 append→flush→猜事件模拟 request；官方 seam 缺失时返回 typed unavailable，不伪装完整 API（design Overview 边界 2）。
4. **切面最小化**：R 切片只补「外部请求被 loop 接受 / 取消可达 / attempt 事实」边界；是既有 `dsh-agent-loop` replacement owner 包内的同组件第二/三 feature 扩展（先例：`packages/agent-loop` 内 assembled-context evidence 切片），**不新建 replacement 包、不新增被禁用官方行、不改 `cordis.patch.yml` 的 disabled+insert 结构**，官方行契约整面保留（design Overview 边界 3、Requirement 11 AC1/AC2）。
5. **词汇共享**：activity/execution/attempt/cursor 词汇全部来自 M9 契约 §2 与 `session-activity-projection` 冻结定义；attempt 事实词汇由 agent-loop owner 包定义一次（本线实现），同时供 activity（observed 终态/排队）与 checkpoint（live-attempt 前置/stop-coordination/自动捕获）只读消费；本线不另造 activity state machine（design Overview 边界 4、Requirement 6 AC2）。
6. **terminal 与裁决优先级**：terminal 五值 `success | error | aborted | denied | superseded` 唯一且终态不可改写；提交窗口裁决优先级 `aborted > superseded > error > timeout-error`（Requirement 4 AC2、M9 契约 §2.3）。
7. **cancel 是信号，不是终态**：`dispose()`/`cancel` 只请求停止，终态由提交点裁决；`AbortSignal` 不等于已提交 `aborted`（Requirement 2 AC3、Requirement 4 AC1、`concurrency-and-cancellation.md` §1）。
8. **fail-safe 与无双跑**：任何 apply/probe/自检失败只记录日志并安全停用（或保持官方契约行为），绝不抛穿 apply、绝不双跑、绝不留「官方行 disabled 而无功能替代」空洞（Requirement 11 AC4、capability-strategy R4/R6、AGENTS.md §2 第 6 条）。
9. **切片 inactive 即面降级**：execute admission/cancel 面返回 typed `unavailable` + `sessions.availability()` 报 `degraded`（reason 指明边界未激活），不影响主门面与其他能力；availability 与健康/诊断分离（Requirement 8 AC2、contract §6）。
10. **治理魔法字母不进入实现**：`lib/`、`packages/`、`test/` 与运行时可见字符串不得出现治理编号/分类字母/需求号/工作流代号；运行时命名只使用中立、面向能力/语义的命名（AGENTS.md §6）。

## 文件编辑边界（contract §7.1 引用）

**本线允许触碰的范围**（实现与测试命名不得含治理字母/批次编号）：

- `docs/specs/session-interaction-operation/**`（本线 spec 制品，含本文与 probe/偏离登记）；
- 本线 owner 模块：`lib/session-interaction-operation-*.js`、`lib/client-session-interaction-operation-*.js`（纯 owner 模块，self-contained，不抢共享 mounter/guard/service）；
- 本线 focused tests：`test/session-interaction-operation-*.test.mjs`、`test/client-session-interaction-operation*.test.mjs`；
- `packages/agent-loop/**` 的**加性扩展**（interaction 边界切片模块与测试、apply 自检矩阵扩展、package.json exports 若需扩展）；禁止改动 `cordis.patch.yml` 的 disabled+insert 结构；
- 若客户端半面确需穿透主包 client bundle 源码（`lib/client-runtime.js` 加性组合）：只允许加性编辑，并必须 `npm run build:client` 重建 + 核对 `lib/client.js` 产物 diff 仅含预期变更（`scripts/build-client-bundle.mjs`；禁止手工编辑生成物）。

**冻结文件清单（任何情况下不得修改）**：`lib/plugin-api-service.js`、`lib/index.js`、`lib/guards.js`、`lib/events-catalog.js`、`lib/events-bus.js`、`lib/deep-freeze.js`、`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`、`docs/specs/plugin-api-features/feature-list.md`、`test/index.test.mjs`、`test/index-events.test.mjs`、`temp/m9-parallel-development-contract.md`、任何 `packages/*` 下属于其他线的文件（如 `packages/session-branch`、`packages/llm` 等）。

共享文件（service 挂载、guards/index mounter、registry、feature-list、共享集成测试）由集成波统一整合，本线只交付 owner 模块、focused 测试与集成波所需的需求/验收说明。

## 任务清单

---

### [ ] 1. 契约 probe 与实现通道决策门（design Current-State Findings「Stage 3 以契约 probe 复核」；Requirement 1/3/11 前置）

**门语义**：以可复现证据确证官方公开 seam 是否已足以支撑本 feature 的 request acceptance / cancel / attempt 终态事实语义；决定 Exit A（退回纯 facade）或 Exit B（R 切片实现）。本任务只做只读取证与登记，不写实现。

- **1.1 官方 seam 清单取证**（只读，记录证据于本 feature 目录 `contract-probe.md`）：
  - `dsh-agent-loop` official 服务面：`AgentLoop` 公共成员（`config` / `create` / `createAgent` / `resume`）与事件面（仅 `agent-loop/config-start-failed`）；核实**不存在**外部单请求 admission/dedupe、per-request operation identity 或公开 cancel/abort ctx 事件（官方类型源 `@deepseek-ai/dsh-agent-loop` 0.1.0-rc.6）。
  - `dsh-agent` 派发面：`agent/request`（waterfall，provider 侧模型配置消费）与 `agent/inbox/*`、`agent/pre-step`；核实这些是 per-agent 模型路由/inbox 拾取，**不是**接受外部 request 的单一 operation authority 幂等面。
  - 官方 durable/inbox 类型：`agent/inbox/spliced`、`turn/step start|end`、`user|assistant message`；核实无稳定 external request identity 或 attempt 终态事实公开出口。
  - fork 内部边界：既有 `packages/agent-loop/lib/forked-loop.js` 的 `cancel(cause)` / `phase.abort` 为内部实现；核实无公开 per-request operation 语义 seam 可被门面稳定消费。
  - 版本锁定事实：官方 `dsh-agent-loop` 全量 identity `0.1.0-rc.6`（与既有 replacement 锁定一致）。
- **1.2 决策门裁决**：
  - **Exit A（官方 seam 确已足够）**：在 requirements/design 就地登记偏离（含证据与补偿路径），任务 2/3/4 标记为按门不执行；任务 5/6/7/8 改为直接消费官方 seam，availability 按官方 seam 可达性如实报告；仍遵守冻结决策 2/3/7。本出口属 requirements 引言已载明的已获批决策规则的自然执行，不触发新的人类确认门；**但若 probe 取证显示需删改已确认 Goal/Requirements 验收边界之外的内容（不止于"退回纯 facade + 登记修订"），则暂停并请求人类裁决**（AGENTS.md §3.2 Stage 4 通用规则）。
  - **Exit A 下游建模（MAJOR-2 补齐）**：
    - **(a) 任务 9.4 去向**：任务 9.4 撤标为按门不执行，并改写为「**官方 seam parity 测试**」——断言官方 seam 的 request/cancel/attempt 面与 design Data Models 冻结契约逐字段对齐、availability 如实反映官方 seam 可达性、无双路径、无 append 猜测；原 R 自检矩阵各子项（版本错配/owner 冲突/无双跑等）仅保留适用于官方 seam 的部分。
    - **(b) 跨线消费依赖声明**：Exit A 的偏离登记必须明确声明对 `session-activity-projection` 与 `checkpoint-restore-contract` 两线消费依赖的影响（attempt 事实词汇不再由本线提供、observed 终态/排队与 stop-then-restore 的 live-attempt 前置条件退回各线 reconstruction/降级口径）；两线需**同步走其自身偏离/修订路径**（各线 requirements/design 修订注记），本线不替他线登记。
    - **(c) 共享词汇单一来源在 Exit A 下的处理**：Requirement 11 AC5「词汇只定义一次」承诺在 Exit A 下改由**集成波阻塞性对齐项**承载——任务 11.3/11.6 的验收口径改为「在三线各自的 seam（官方或切片）之上比对 attempt 事实字段契约一致；若任何一线缺少同源事实，集成波须显式声明该能力的降级档（reconstructed/unknown）并阻塞至对齐或登记差异」，不得出现三线各自定义词汇的平行漂移。
  - **Exit B（缺省；取证不足或官方 seam 不满足等价语义）**：继续任务 2/3/4（R 切片），facade 经内部 symbol-keyed 契约消费切片；切片 inactive/mismatch 时 execute 面 typed `unavailable`，绝不用 append 猜测补位。
- **1.3 验收**：probe 证据表落盘（文件/行引用 + 包 identity 锁定）；门裁决无歧义；任一偏离已在 requirements/design 修订注记登记；下游任务按门结论展开。

**依赖**：任务 2/3/4（Exit B 才执行）、5/6/7/8 的通道选择受本门结论约束。

---

### [ ] 2. 共享 loop boundary slice（R）— admission/cancel 边界（Requirement 11；Requirement 3 AC3；Requirement 4 AC1/AC6）

> Exit B 执行。实现于 `packages/agent-loop`（既有 replacement owner 包）加性扩展。

- **2.1 扩展模块建立**：新增 interaction 边界模块（中性名，如 `lib/interaction-slice.js`）与契约 marker（如 `Symbol.for('dsh-plugin-api.agent-loop.interaction')`），随既有 apply/ctx effect 生命周期注册与清理；不新增被禁用官方行、不改 `cordis.patch.yml` disabled+insert 结构（Requirement 11 AC1、capability-strategy R1）。
- **2.2 官方行整行契约复刻保持**：确认 fork 已完整复刻官方 `agentLoop` ctx 服务/事件面（`config`/`create`/`createAgent`/`resume` 时序、事件 payload 与 disposer 语义）；扩展只做加法，不得改变官方契约时序/payload/接收者/错误/disposer 行为（Requirement 11 AC2、capability-strategy R2）。
- **2.3 `admit(operationSpec)` 内部契约方法**：单次受理；返回 `{ accepted, attemptRef }` 或 `{ rejected, code, reason }`（typed）；幂等由 facade authority dedupe 保证（同 key 不重复 admit，Requirement 5 AC1）；受理失败不产生任何 loop 副作用（Requirement 3 AC3）。
- **2.4 `cancelAttempt(attemptRef, { reason, signal })`**：尽力传播到当前 attempt 及其 owned provider/tool 请求（复用 fork 既有 cancel/abort 内部位）；返回 typed 结果；**绝不自行写 terminal**（Requirement 4 AC1/AC6、`concurrency-and-cancellation.md` §1-§2）；无法立即停止 provider/工具属预期，由 authority 提交资格保证正确完结。
- **2.5 加性证明**：admission-once 证据（验收 fixture：同 key 不二次 admit、crash/retry/reconnect 不二次 admission）、取消传播证据、slice inactive 时边界不激活证据。

**验收**：官方契约 parity 保持；admit/cancelAttempt 形状与冻结契约一致；无双跑、无半服务；测试见任务 9.4。

---

### [ ] 3. 共享 loop boundary slice（R）— attempt 生命周期事实（Requirement 11 AC5；Requirement 6 AC1-AC3；与 `session-activity-projection`、`checkpoint-restore-contract` 共享）

> Exit B 执行。attempt 事实词汇**只定义一次**（agent-loop owner 包实现），activity/checkpoint 只读消费其契约；本线不另造 activity state machine（Requirement 6 AC2）。

- **3.1 `agent/attempt/start` 事实发射**：在 loop 真实提交点发出；payload 逐字段冻结 `attemptId`、`operationId`（外部 request 发起时）、`executionId`（如有）、`sessionId`、`seq`、`observedAt`（设计 Data Models §2；activity design §3 消费侧契约对齐）。
- **3.2 `agent/attempt/end` 事实发射**：同左 + `outcome`（`success/error/aborted/denied/superseded` 的 loop 提交点事实）、`reason`/`classification`（有界、脱敏）、`followUp`（`none`|`queued`，loop 提交点队列状态）；operation terminal 仍由 facade authority 裁决，end 事实只是裁决输入之一（Requirement 4 AC2、Requirement 11 AC5）。
- **3.3 事件语义与所有权**：`fact` 语义（非 decision/notification）；producer authority = agent-loop owner slice；payload deepFreeze；owner-scoped（不泄漏其他 owner 私有内容）。
- **3.4 稳定性保证**：事实发射绝不改变官方事件时序/payload/loop 决策（evidence-only iron rule 类推，先例 `evidence-slice.js`）；发射失败只 log+skip；不引入对 activity/checkpoint 消费侧状态的任何写回。
- **3.5 共享词汇单一来源实现与机械一致性**：以本线 requirements/design 与 `session-activity-projection` 冻结字段契约为准实现一次；测试断言实现发射 payload 与冻结字段契约（逐字段）机械一致（Requirement 11 AC5、Requirement 12 AC4 扩展的共享词汇机械一致性）；activity/checkpoint 只读消费其字段，不反向定义词汇。

**验收**：payload 逐字段断言；发射中性（不改变 loop 行为）；单一词汇来源；测试见任务 9.4。

---

### [ ] 4. R 切片完整性 — boot 自检、host-only 判定、U-series 与退役条件（Requirement 11 AC1/AC3/AC4/AC8/AC9/AC10；capability-strategy R1–R8）

> Exit B 执行。

- **4.1 apply 自检矩阵扩展**：在既有 `packages/agent-loop/lib/apply.js` 自检之上增加切片契约 probe——官方行 disabled、恰一个替代行 active、runtime/包 `A.B.C` 与锁定 runtime 一致、主门面内部操作契约可解析且 compatible、无组件 owner 冲突（Requirement 11 AC3、capability-strategy R4/R5/R6）。**activity 观测契约 marker 项（MINOR）**：切片 apply 检查 activity 线定义的观测契约 marker（`Symbol.for('dsh-plugin-api.session-activity.observation-contract')`，activity 线定义并导出、本线切片 apply 消费）——present 且兼容 ⇒ attempt 事实可完整宣称 observed；absent ⇒ 仅 log bounded 诊断（不降级官方契约行为、不影响事实发射安全），**该 marker 的互相兼容性核对由集成波统一装配验证（任务 11.3/11.6）兜底**，避免两线职责悬空。
- **4.2 自检失败 fail-safe**：log bounded diagnostics + 切片不激活（既有官方契约行为照常）；不双跑、不杀 boot、不半服务边界；绝不留「官方行 disabled 而无工作官方契约路径」空洞（Requirement 11 AC4）。
- **4.3 host-only 判定（capability-strategy §10 六问）**：逐项取证并记录——被替代官方行无 client manifest / 无 remote namespace / 无 slot/settings bridge / 无 host↔client 版本协商 / 无 browser state/reconnect / 无 client-facing event/service ⇒ 六问全否 ⇒ **host-only slice**（无 client bundle 义务）；判定结论与证据写入本线 spec 制品（Requirement 11 AC9）。
- **4.4 U-series 上游提案与退役条件登记（写入本线 spec 制品；feature-list §3.1 registry 登记留集成波）**：官方提供等价 request acceptance/cancel/attempt 公开 seam（或官方 execution identity 常态化）后，切片退化为官方直绑、consumers 迁移官方 seam（Requirement 11 AC6/AC7 与设计退役条件；feature-list 登记见任务 11.2）。
- **4.5 不覆盖官方 import 面**：第三方 `import '@deepseek-ai/dsh-agent-loop'` 仍解析官方原包；切片不宣称拦截/替换该 import 面（Requirement 11 AC5 之八、capability-strategy R3）。

**验收**：自检矩阵 active/inactive 双态 fixture；六问证据落盘；U-series/退役条件登记于 spec；import 面不覆盖。

---

### [ ] 5. Facade request authority — host 面 owner 模块（Requirement 1、2、3、5、7、10）

- **5.1 owner 模块建立**：`lib/session-interaction-operation-*.js`（normalize / authority / handle / availability 可分拆）；self-contained，不触碰冻结/共享文件；流程输入规范化与判定纯函数保持模块化可测。
- **5.2 RequestSpec 校验（Requirement 1 AC3）**：`{ sessionId, message?: { kind:'user-message', text, attachmentRefs? }, idempotencyKey?, parent?/cause?, signal? }`；session 存在性、owner/kind 合法性；`message.kind` 只接受 durable append 层 source-audited kind（v1 仅 `user-message`），其余 typed `rejected`（invalid-input）；不启动处理、不追加任何内容。
- **5.3 dedupe + 并发 + 重触发（Requirement 1 AC1、Requirement 5 AC1/AC2/AC3/AC5）**：同 owner 同 `idempotencyKey` 且未终态 ⇒ `duplicate` + 既有 operation 引用；同 session 已有活外部 request ⇒ `already-running`（exclusive-per-session，design §5）；终态后外部重触发 ⇒ **新 operation**（不与既有的合并 identity，`parent`/`cause` 相关性在 caller/recovery 证据提供时记录）；loop 内部 retry/attempt 是同一 operation/execution 下的 attempt，不新建 operation 或外部 request identity；引用不含其他 owner 私有内容。
- **5.4 单次受理 + audited durable append（Requirement 1 AC2/AC5、Requirement 3 AC3）**：经切片 `admit`（Exit B）或官方 seam（Exit A）恰一次受理后，才经既有 `sessions.durable.appendMessage` 写入内容（source provenance 记录）；**不绕过**该契约、不发明 caller 未提供的内容；受理前 caller 不得观察到任何 activity 变化。
- **5.5 activity/execution 关联（Requirement 6 AC1/AC3）**：操作暴露 `activityId`/`executionId` 仅在共享投影证据出现后；不从事件序列发明活动身份；projection 缺位/降级 ⇒ correlation `unavailable`，证据未出现 ⇒ `unknown`（不互代）。
- **5.6 operation handle（Requirement 2 AC1-AC5）**：`{ id, ownerId, status(), observe(), dispose() }`；`id = operationId`（facade 生成）；`ownerId` 从调用方 fiber 派生；`status()` 返回冻结当前状态（`phase: pending|accepted|running|waiting|terminal`，terminal 五值 + reason/classification + 有界 audit）；`observe()` 订阅进度/终态；`dispose()` 只请求停止，不伪造 `aborted`；stale handle（终态/dispose/owner reload/generation 替换后）返回 typed stale/no-op，不影响新 operation 或其他 owner（Requirement 2 AC4）。
- **5.7 typed outcome 形状（Requirement 1 AC1/AC4、Requirement 5 AC4）**：判别式结果 `{ ok, code, operation|operationRef, activity?, reason?, domainCode? }`，主码 `accepted|duplicate|already-running|rejected|denied|unavailable`；业务冲突为 typed result 不伪装 boot 失败（contract §6）；**accepted handle 携带冻结 declared-capability 成员 `capability: { idempotent, autoRetry, failClosed }`**（`idempotent` = 是否提供 `idempotencyKey`；`autoRetry` 恒 false；`failClosed` 恒 true；Requirement 5 AC4 默认不自动 retry；成员形状登记见 tasks 11.1 与 `r-slice-record.md` §6），操作元数据不含其他 owner 私有内容。
- **5.8 失败闭合与旁路边界（Requirement 1 AC4、Requirement 3 AC2/AC4）**：admission/commit 歧义 ⇒ `error`/`unavailable` + bounded reason；绝不 append→flush→猜 loop；**`sessions.durable.appendMessage` 直连不被解释为隐式处理请求**——启动处理必须显式 request operation 或走 session 自身官方驱动路径；官方 seam 无法证明 ⇒ typed `unavailable`。
- **5.9 域 gate 各归其主（Requirement 7 AC1-AC4）**：route/admission/exposure/approval/security 门由各自域 authority 消费；本线只收 `denied`/`rejected` + 域码 + bounded reason；approval pending ⇒ `waiting`（与共享 activity waiting 证据同源），不代答审批、不发 UI notification；recovery 决策由 recovery authority 按其自动消费契约处理、本线不 double-consume、不超声明能力自动 retry。

**验收**：每个 outcome 有契约保真 fixture；dedupe/already-running/retry 语义正确；handle 生命周期如冻结决策 6/7；见任务 9.1/9.3。

---

### [ ] 6. Facade cancel 与 terminal 裁决 — host 面 owner 模块（Requirement 4、2 AC3、3 AC4、6 AC4）

- **6.1 `sessions.cancel({ sessionId?, operationId?, reason?, by?: 'user'|'owner'|'system' })`（Requirement 4 AC1）**：signal 型 operation；typed result（`accepted|conflict|stale|invalid-input|unavailable`）；取消是请求不是终态。`by` 字段与 design Data Models §3 冻结签名一致——`system` 身份供 checkpoint 线 stop-then-restore 经本 request authority 唯一 cancel 路径以 `by:'system'` + restore cause 请求停止；本线不做第二条 cancel 通道（Requirement 11 共享切片消费方契约；checkpoint 线 consumption 见其 Requirements 对应条目）。
- **6.2 传播（Requirement 4 AC1/AC5/AC6、checkpoint 线 stop-then-restore 消费方）**：向活 operation、当前 attempt 与 owned provider/tool（经切片 `cancelAttempt` / Exit A 官方等价路径）尽力传播；**不自行写 terminal**；`AbortSignal` 组合保留调用方上游取消语义，不加本地 signal 替换调用方 signal；`by:'system'` 的 cancel 与 `user`/`owner` 走同一唯一 cancel 路径（仅 cause/by 元数据不同），不做特殊旁路或第二条通道。
- **6.3 提交窗口裁决（Requirement 4 AC2、Requirement 2 AC5）**：把仍有效的竞争信号（cancel 请求（含 `by:'system'` 的 stop-then-restore 请求）、attempt 事实、deadline、域 deny 结果）按 `aborted > superseded > error > timeout-error` 收敛为唯一 terminal；timeout ⇒ terminal `error`（`reason`/`classification` 标记 timeout，不新增 terminal 词）；原子提交后不可改写；迟到信号只作 bounded diagnostic/audit（Requirement 6 AC4）。`by:'system'` 裁决结果照常进入 audit/可用性口径，不下钻到 checkpoint 消费侧的 restore 时序（那是 checkpoint 线的 `stop-then-restore` 编排职责，本线只保证走唯一 cancel 路径与正确裁决）。
- **6.4 终态后 cancel（Requirement 4 AC3）**：typed stale/conflict；不重写已提交 terminal、不启动新 attempt；operation 终态后禁止新 attempt（`durable-state-and-scope.md` §3）。
- **6.5 parent/child 传播（Requirement 4 AC4）**：父 operation/execution 取消 ⇒ 沿 authority 的 parent→child 索引级联同一 `requestCancel` 路径传播到仍存活的 child operation/attempt（含其 owned provider/tool）；child 取消/失败默认不反向取消父（除非 operation 契约声明 required）；child 的级联取消同样遵守 best-effort 与提交资格。
- **6.6 provider/工具不可立即停止（Requirement 4 AC6）**：经提交资格（owner/generation/operation 终态/资源持有/epoch）正确完结 operation；停止努力不呈现为终态证明。
- **6.7 supersede 产生路径（终审 MINOR-3 落地）**：`superseded` 终态须有明确生产者沿路径传递标记（共享切片 `cancelAttempt` reason 携带 `superseded`、或 authority 内部 `requestCancel` 的 `supersede` 选项）；v1 默认不自动 supersede（exclusive-per-session），路径与接线见 `r-slice-record.md` §5，供 checkpoint stop-then-restore 与未来队列机制在集成波直接消费。

**验收**：裁决优先级 fixture；终态后 stale cancel；child/parent 传播；provider 不可停时正确完结；无伪造 aborted；见任务 9.2。

---

### [ ] 7. Client 半面 — B 传输封装 owner 模块 + bundle 重建（Requirement 9）

- **7.1 client face owner 模块**：`lib/client-session-interaction-operation.js`——`ctx.pluginApi.sessions.request/cancel`（client 面）同形 stub；走既有 channel 类 client→host 类型化传输（`sessions.channels` ack/resume 先例；具体通道入口与 wire revision 由集成波核对固定，design §4）；**不扩 api-remotes 转发白名单**（Requirement 9、design Components §4）。
- **7.2 host 侧注册类型化 operation 方法端点**：复用既有 channel 类传输机制在宿主侧提供 endpoint；请求/响应 payload host 侧脱敏完成后序列化；client 只做形状校验，不承担脱敏（Requirement 9 AC4、`visibility-and-redaction.md` §4）。
- **7.3 不可达语义（Requirement 9 AC2/AC5）**：offline/rebind 进行中/headless 无 client 通道 ⇒ typed `unavailable`；v1 不排队、不静默丢弃；client 面自己 availability 如实报告，不影响 host operation authority。
- **7.4 stale guard（Requirement 9 AC3）**：旧 connection generation/epoch/rebind 的 handle/回调/观察者 stale-guarded；不得写入新 client 面或新 host generation（复用既有 generation/epoch 词汇）。
- **7.5 同形 outcome parity（Requirement 9 AC1）**：client 面返回与 host 面相同的 typed outcome 与 operation 引用语义。
- **7.6 bundle 重建义务**：若本线实现确需穿透主包 client bundle 源码（`lib/client-runtime.js` 加性组合）⇒ 只作加性编辑，并运行 `npm run build:client`（`scripts/build-client-bundle.mjs`）重建 `lib/client.js`，核对产物 diff 仅含预期变更；禁止手工编辑生成物；重建入口缺失时上报，不自行另起构建通道。

**验收**：同形结果、offline/rebind unavailable、stale guard、host 先脱敏断言、两 synthetic 插件反序；见任务 9.5。bundle diff 仅预期变更。

---

### [ ] 8. Availability、capability 与 audit（Requirement 8、10、6 AC3）

- **8.1 `sessions.availability()` reason 口径扩展（Requirement 8 AC1）**：host/client 各自返回冻结 `{ status: active | degraded | unavailable, reason?: string }`，反映 operation authority、loop admission 边界（R 切片 active + version-matched）与 client transport；availability 绝不 throw、不混入健康/诊断信息。
- **8.2 切片 inactive/mismatch（Requirement 8 AC2）**：execute admission/cancel 面 typed `unavailable`；`sessions.availability()` 报 `degraded` + reason（边界未激活）；不静默双跑、不停用整个主门面或无关能力。
- **8.3 P1/P2 统一（Requirement 8 AC3）**：facade core inactive / capability disabled ⇒ `PluginApiInactiveError` / `PluginApiFeatureDisabledError`；不得观察部分操作状态。
- **8.4 capabilities（Requirement 8 AC5）**：根 `capabilities` 携带 request/cancel 能力条目；不带 package/row/replacement 身份（集成波登记，见任务 11.1）。
- **8.5 audit（Requirement 10 AC1/AC2）**：v1 authority 内部 bounded in-memory 诊断——owner、operationId、sessionId、时间戳、outcome 码、attempt 数、关联 id、**cancel cause 与 `by` 维度（`'user'|'owner'|'system'`，供 checkpoint stop-then-restore 的 `by:'system'` 调用可追溯）**；无 payload 内容/凭据/secret；写失败 ⇒ bounded gap marker，不伪造记录（不建 audit projection 子系统）。
- **8.6 owner 派生与脱敏（Requirement 10 AC3/AC4、Requirement 8 AC4）**：owner identity 从实际调用方 fiber 派生，不接收 caller 自报 owner；reason/error 逐出口有界、脱敏，无 payload 内容/凭据/owner-private 状态。

**验收**：availability 三态（含 per-context reason）fixture；capabilities 无身份泄漏；audit bounded + gap；owner 派生不可伪造；见任务 9.6。

---

### [ ] 9. Focused 测试套件与回归（Requirement 12 AC1-AC5；design Testing Strategy 1–6）

- **9.1 acceptance/dedupe/already-running/terminal handle 生命周期（Requirement 1/2/3/5 + design Testing 1）**：契约保真 loop fixture 上验证单次受理、duplicate 引用、already-running、rejected kind、denied 域码、unavailable、append provenance、**direct `appendMessage` 不隐含启动处理（Requirement 3 AC2 负向断言）**；operation handle 生命周期：terminal 唯一冻结不可改写、stale handle 返回 typed stale/no-op（Requirement 2 AC2/AC4）。
- **9.2 cancel/adjudication（Requirement 4 + design Testing 2）**：信号传播、提交窗口裁决优先级、终态后 stale cancel、child/parent 传播、provider 不可停时正确终态、无伪造 aborted；**覆盖 `by:'system'`（stop-then-restore 语义）与 `by:'user'|'owner'` 触发用例**——system 身份经唯一 cancel 路径传播、cause/by 进入 audit、裁决路径与 user/owner 逐项等价断言。
- **9.3 attempt/retry 与 activity correlation（Requirement 5/6/7 + design Testing 3）**：attempt 同 execution、外部重触发新 operation（parent/cause 记录）、默认不自动 retry、recovery 不 double-consume；activity correlation confidence 三态（projection 缺位 ⇒ unavailable、证据未出现 ⇒ unknown）。
- **9.4 slice 完整性（Requirement 11 + design Testing 4）**：官方契约 parity、版本错配、boot 自检、owner 冲突、无双跑、移除恢复、切片 inactive 时 unavailable 报告；host-only 六问证据核对；共享 attempt 事实词汇机械一致性（逐字段冻结断言，Requirement 11 AC5）。
- **9.5 client face（Requirement 9 + design Testing 5）**：同形结果、offline/rebind typed unavailable、stale guard、host 脱敏先行断言、两 synthetic 插件反序。
- **9.6 availability/audit/capability（Requirement 8/10 + design Testing 6）**：`sessions.availability()` 三态（`active/degraded/unavailable`）与 reason 口径、capabilities 执行不带包/行身份、audit 无 payload 且写失败 ⇒ gap marker 不伪造（Requirement 10 AC1/AC2）。**证据归属注（终审 MINOR-4）**：Requirement 8 AC4（headless/web/TUI per-context availability reason）与 AC5（根 `capabilities` 词条不带 package/row 身份）的端到端证据由**集成波**承担——focused 测试覆盖 owner 模块层三态/reason 口径，per-profile 挂载呈现与 capabilities 词条在任务 11.1/11.3 落验（验收口径见 `r-slice-record.md` §7），不得静默未覆盖。
- **9.7 回归**：既有全量测试保持绿；**不触碰** `test/index.test.mjs`、`test/index-events.test.mjs` 及任何冻结/其他线文件；事件总览/挂载顺序断言由集成波维护。

**验收**：focused suites 在受护 `npm test`（护栏脚本）下全绿；命名符合 contract §7.2（`test/session-interaction-operation-*.test.mjs`、`packages/agent-loop/test/interaction-slice.test.mjs`）。

---

### [ ] 10. 验证与交付门（Requirement 12 AC7/AC8；AGENTS.md §3.2 Stage 4 规则）

- **10.1 套件全绿**：受护 `npm test`（护栏脚本 `systemd-run`；可与缺少 DBUS 时默认值内联；**不要用裸 `node --test`**）。
- **10.2 `git diff --check`**：干净。
- **10.3 官方包零修改审计**：`/usr/lib/node_modules/@deepseek-ai/dsh/**` 未被修改。
- **10.4 治理 token 审计**：`lib/`、`packages/`、`test/`、package.json、patch 文件无治理编号/分类字母/需求号/工作流代号泄漏（冻结决策 10）。
- **10.5 证据不足即不宣布完成（Requirement 12 AC8）**：任一必需证据无法建立 ⇒ 受影响 operation 面保持 typed `unavailable`，交付不得宣告该部分完成。
- **10.6 Stage 4 完成提交与全局终审**：全局对抗性终审（由编排主代理阻塞执行）返回「无偏差」后，先 `git diff --check` 再完成提交；工作区保持干净（阶段提交纪律）。

---

### [ ] 11. 集成波归属任务（由集成代理执行；本线只列出要求与验收，不自行执行）

- **11.1 registry/shape 机械合并（Requirement 12 AC6；contract §7.1）**：`public-contract.registry.json` 登记 host `sessions.request`（operation idiom）与 `sessions.cancel`（operation idiom）、handle 成员（`sessions.request.handle`/`sessions.cancel.handle`，`{id,ownerId,capability,status(),observe(),dispose()}`，含 accepted handle 的 declared-capability 只读成员 `capability`）、client `sessions` 语义根与同形成员、`sessions.availability()` 存量成员 reason 口径扩展、根 `capabilities` 词条、`agent/attempt/*` catalog 条目（`fact` 语义 + producer authority）；`oldToTargetMapping` 无 alias；surface snapshot 匹配。**验收**：每个新 host/client 成员与 handle 成员一个主 idiom、semantic face、effect、composition、scope、authority、availability shape 与 event catalog 登记齐备；registry/surface 一致性校验通过；`capabilities` 词条不含 package/row/replacement 身份（Requirement 8 AC5）。
- **11.2 feature-list 行更新与 §3.1 登记**：§7 追加 `session-interaction-operation` 交付条目（M9 状态 → delivered）；§3.1 登记共享 loop boundary slice 为同一条共享 package capability（agent-loop owner 包），写入 U-series 上游提案与退役条件（三线联合登记：interaction/activity/checkpoint），同 `§3` 登记对应 U 行。**验收**：登记事实与任务 4.4 落盘内容一致；不带治理后缀的运行时命名。
- **11.3 跨线切片装配验证（activity/checkpoint 消费侧 observed 全链路）**：agent-loop 切片激活/未激活双态下——activity 线 observed 终态/排队全链路集成测试、checkpoint 线 live-attempt 前置条件/stop-coordination（`by:'system'` + restore cause）/自动捕获触发消费侧集成测试；切片失败 fail-safe 只停用相关 R 特性。**验收**：双态装配等价、无双跑、观察侧不写回。
- **11.4 client bundle 随主包装配验证**：`npm run build:client`（如任务 7.6 触发）产物随主包装配一致；multi-line（本线 + attention 等 client 侧线）client bundle 组合无冲突；`window.__ModuleLoader__` handoff 与模块加载器身份不变。**验收**：full 与选择性安装装配等价（契约 §8）。
- **11.5 主门面 mounting 交接（contract §7.1）**：`lib/plugin-api-service.js` append slot（sessions namespace 扩展成员与 availability reason 口径）、`lib/index.js` mounter + 事件总线 R slice 接线（`agent/attempt/*` catalog slice）、`lib/guards.js` else-if 分支位置、feature key 与 mounting/unmounting lifecycle、disabled surface。**验收**：按本线预订 append slot 机械整合；disabled 面 typed；挂载顺序不破坏既有断言。
- **11.6 共享词汇跨线机械比对**：attempt 事实字段契约在 interaction（实现源）/activity（消费）/checkpoint（消费）三线间的机械一致性断言（本线实现为其唯一来源）。**验收**：比对脚本/测试通过。

---

## 交付顺序与依赖概要

```text
1. 契约 probe 门 ──(Exit A)──▶ 5/6/7/8 直接消费官方 seam（2/3/4 按门不执行）
        │
        └──(Exit B)──▶ 2. admission/cancel 边界 → 3. attempt 事实 → 4. 自检/host-only/U-series
                          │
                          ├──▶ 5. 宿主 request authority ──▶ 6. cancel 与裁决 ──▶ 8. availability/audit
                          └──▶ 7. client 半面（与 5/6 形状对齐后）
   5/6/7/8 ──▶ 9. focused 测试 ──▶ 10. 验证与交付门 ——▶ 11. 集成波（registry/feature-list/跨线装配/client bundle/mounting）
```

顶层依赖：任务 1 →（Exit B）任务 2 → 任务 3 → 任务 4；任务 5/6 消费任务 2/3（或 Exit A 的官方 seam）；任务 7 依赖 5/6 的冻结 outcome 形状；任务 8 依赖 5/6/4；任务 9 覆盖全部；任务 10 是 Stage 4 交付门；任务 11 由集成波执行。

## 验收要求

- 交付物全绿：受护 `npm test` 全绿 + `git diff --check` 通过 + 官方包零修改审计 + 治理 token 审计通过。
- 每个顶层任务完成时工作区回到干净状态或按阶段提交纪律提交（AGENTS.md §3.2）。
- 任一顶层任务无法建立证据 ⇒ 对应该部分的能力保持 typed unavailable，不宣布完成（Requirement 12 AC8）。