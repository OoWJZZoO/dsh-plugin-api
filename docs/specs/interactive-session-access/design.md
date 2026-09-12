# Stage 2 - Design

> feature_name: `interactive-session-access`
> milestone: M10
> status: Stage 2 已交付（2026-09-12，与 Stage 1 Requirements 同批产出）；Stage 3（Tasks）未开始
> 输入溯源：已确认 Goal（`goal.md`）与本线 Requirements；M10 观察报告 OBS-09/OBS-12；M10 工作纲领 §3.9/§4/§5；已交付 `session-interaction-operation` requirements/design（M9）及其 2026-09-11 维护现状注；canonical registry `sessions.request/cancel`、`sessions.channels.*`、`sessions.activity.*`、`attention.*`、`services.apiProxy`、client 根 `sessions`/`attention` 现状；`docs/standards/` 全部 12 分册。

## Status

本文承接已确认 Goal 与同批 Requirements，落实 Goal Stage boundary 的全部待定项：面拆线与 owner 划分、既有 owner 复用矩阵、协议取舍与等价判据、attachmentRefs durable 映射合同、M9 已交付面的扩展消费方式、可能的 R 点位陈述、失败路径与 guard 策略、standards 逐分册结论。版本冻结基线（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`）内交付；本文不提出任何版本字段变更，不批准任何新 replacement 包或行。

## Overview

本 feature 在既有 sessions authority 之上按行为拆分为四个独立 owner 的面，交付"只消费公开运行时契约"的完整交互：

1. **交互操作面（operation）**：owner = 已交付 session request authority（扩展）。承载发送（含附件）、取消、steer/queue 交付词表。
2. **待处理交互资源面（projection + respond operation）**：owner = 新增 facade pending-interaction authority。承载 pending approval/question 受限视图与匹配应答。
3. **只读流面（consumption contract）**：owner = 已交付 session channel authority（connection/gateway replacement owners）+ activity projection（只读消费）。承载基线/增量/断线重连/错过事件/身份关联的消费合同，不新建通道或事件体系。
4. **选择提交面（mutation）**：owner = 新增 facade selection authority（协调官方 model-selection 落点）。承载候选查询复用与目标 session 的模型/effort 变更。

三主面来自 Goal 的拆分指示；选择面为 Design 增补的第四面，理由：selection 提交是 mutation idiom，与 operation/interaction-resource 不共享状态空间，按 `api-shape.md` §3/§4（一面原则与 smell 判据 1）必须独立 owner，不得混入 request authority 或 interactions authority。

**不新增第二套 request/activity 状态机**的实现含义：Face 1 的排队/steer 状态由官方 inbox（durable `agent/inbox/*` 类型与 inserted/claimed/discarded 事实）承载；Face 2 只保存 id↔官方 pending item 的映射，生命周期由官方 approval/userQuestions 事件驱动；Face 3 是消费合同不是状态机；Face 4 的选择持久化由官方 session 持久化承载。四个 owner 均不复制官方内部算法。

## Current-State Findings

- 已交付基础（M9 及其维护后基线）：`sessions.request`/`cancel`（host+client 同形 operation，exclusive+deduplicate，terminal 唯一裁决）、operation status/observe wire（`/plugin-api/sessions` 路由、value-only 投影、client 重建）、activity correlation（`observed`/`reconstructed`/`unknown`/`unavailable` 不互代）、waiting 相位（与 activity 等待证据同源）、诚实 availability 与 stale 世代守卫。
- 已登记缺口（本线兑现）：`message.attachmentRefs` 无 durable content block 映射，当前 fail-closed（带附件请求 typed unavailable 且不写入）。
- 官方可达 seams：`services.apiProxy` 仅白名单 `downloads` getter 与 `respond` method（respond 是既有回答入口）；`approval.request`/`overrideOf`、`userQuestions.registerProvider`/`ask` 为官方 passthrough；官方 inbox 有 durable 类型与事实事件；model selection 经官方 prompt assembly 捕获并用于本步 route。
- 既有 carriers：`sessions.channels`（open/acquire/heartbeat/revoke/observe/fetchEvents/list/ack/resume + auth verifier/pairing/authorizer + redaction profile，typed 码含 `device-denied`/`session-denied`/`pairing-required`/`cursor-gap`/`resync-required`）已由 connection/gateway 两个 replacement owner 交付并各带完整 client 半面；client 根 `sessions` 已有 request/cancel/availability；client 根 `attention` 已交付。
- OBS-09 锚点事实：mobile channel 直接用 `apiProxy.events.mux` 并调用 sessions/workspace/agentPresets 多操作；门面不复制 mux，改以类型化公共面承载同等消费者行为。

## Architecture

```text
 独立 Web/手机页面 / browser 插件 / host-TUI 自动化
        │ 只消费公共契约（无官方 mux/RpcId/schema 依赖）
        ▼
 ┌────────────────────────── pluginApi.sessions（共享 authority 域） ──────────────────────────┐
 │                                                                                            │
 │  Face 1 交互操作面            Face 2 待处理交互资源面        Face 3 只读流面（消费合同）     │
 │  owner: request authority     owner: interactions authority  owner: channel authority       │
 │  (M9, 扩展)                   (新增 facade)                  + activity projection(只读)    │
 │  request/cancel/delivery      interactions.list/get/respond  channels open/observe/fetch/   │
 │  attachmentRefs 映射          (受限视图+类型化应答)           ack/resume + correlation       │
 │            │                          │                            ▲                        │
 │            │ 官方 inbox(steer/queue)  │ 官方 approval/userQuestions│ 官方 session 事件        │
 │            ▼                          ▼ + services.apiProxy.respond│                        │
 │  agent-loop 既有切片(attempt 事实)   官方 answer entry             sessions.channels 载体    │
 │                                                                            │               │
 │  Face 4 选择提交面（owner: selection authority，新增 facade）                │               │
 │  selection.get/set（CAS revision；官方 model-selection 路径落点）            │               │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
        client 半面：全部经已交付 client carriers（connection/gateway/api-remotes/client-runtime）
```

### Face 1: 交互操作面（owner = 已交付 session request authority，扩展）

| 成员 | runtime | idiom | 说明 |
|---|---|---|---|
| `sessions.request` | host+client | operation | 既有成员扩展 spec：`message.attachmentRefs`（新映射）、`delivery?: 'steer' | 'queue'`（缺省 = 已交付 `already-running` 行为不变） |
| `sessions.cancel` | host+client | operation | 既有成员；接受 queued reference（未认领排队项的取消） |
| operation handle/status/observe | host+client | operation | M9 既有 wire 不变；steer 并入活 attempt 时不产生第二个 operation |

扩展均落在同一 authority 内部（durable 适配层 + 官方 inbox 交付），不新增公共状态机。

### Face 2: 待处理交互资源面（owner = 新增 facade pending-interaction authority）

| 成员 | runtime | idiom | 形状 |
|---|---|---|---|
| `sessions.interactions.list({ sessionId?, cursor? })` | host+client | projection | 冻结 `{ items, nextCursor } \| availability view` |
| `sessions.interactions.get({ id })` | host+client | projection | 冻结单视图 \| typed `missing/unavailable` |
| `sessions.interactions.respond({ id, action, answer?, reason?, signal? })` | host+client | operation | typed `{ accepted \| stale \| rejected \| denied \| unavailable }` |
| `sessions.interactions.availability()` | host+client | selfDescription | 冻结状态，永不抛错 |

受限视图成员：`{ id, kind: 'approval' | 'question', sessionId, summary, createdAt, answerShape }`。`id` 为 facade 铸造公共身份；`summary`/`answerShape` 有界脱敏。内部只保存 id↔官方 pending item 映射（有界、内存、不 durable）；生命周期由官方事件驱动，映射随官方 resolution 清除。不旁路 approval/userQuestions authority，不暴露官方 registry 内部 id/形状。

### Face 3: 只读流面（owner = 已交付 channel authority + activity projection 只读消费）

不新增 namespace。本面是 `sessions.channels` + `sessions.activity` 的**消费合同**：

- 基线：open/acquire 后先 `fetchEvents`/`list` 取历史快照 + 当前 pending/running/queued 状态（后者读 activity projection），再消费增量。
- 增量：`observe` 订阅，官方 session 顺序 + channel cursor；heartbeat/ack 按既有 channel 合同。
- 重连：`resume(cursor)`；`cursor-gap`/`resync-required` ⇒ 消费者重建基线；不伪造补齐。
- 关联：与 accepted request 相关的事件携带 operation/activity 关联（M9 共享事实词汇）；禁止从 event seq 合成身份。
- 恢复后续跑语义（OBS-12 兑现）：重开 session 后，live/queued 工作经 activity projection（含 loop 已提交的 followUp/queue 事实）可见；旧 handle typed stale；已提交排队项不要求客户端重发。continue/queue 的裁决权仍在 loop/authority，本面只读。

### Face 4: 选择提交面（owner = 新增 facade selection authority）

| 成员 | runtime | idiom | 形状 |
|---|---|---|---|
| `sessions.selection.get({ sessionId })` | host+client | projection | 冻结 `{ sessionId, provider, model, effort, revision, source, committedAt, observedAt } \| availability view` |
| `sessions.selection.set({ sessionId, selection, expectedRevision?, signal? })` | host+client | mutation | typed `{ committed, revision } \| { conflict } \| { rejected } \| { unavailable }` |
| `sessions.selection.availability()` | host+client | selfDescription | 冻结状态 |

`selection = { provider?, model?, effort? }`。set 经官方 model-selection 路径提交（官方在 prompt assembly 捕获选择并用于本步 route 的既有行为是落点），facade 不维护平行选择存储；`revision` 由 authority 在每次成功提交时步进（owner-local，CAS 判据）；恢复读取官方持久化值，不漂移。候选查询不进本面（复用既有 catalog faces，见复用矩阵）。

## Existing Owner Reuse Matrix

| 既有 owner / 面 | 判定 | 说明 |
|---|---|---|
| 已交付 session request authority（M9 主包 facade） | **复用 + 扩展** | Face 1 唯一 owner；扩展点仅 attachmentRefs 映射与 delivery 词表；acceptance/dedupe/cancel/terminal/audit 逻辑不变 |
| connection 替代行（`dsh-client-connection` owner） | 复用 | client 根 `connection` unary rpc 与 generation/epoch/rebind 语义沿用；不扩展 |
| `sessions.channels`（connection + gateway 替代行 owners） | 复用 | Face 3 唯一载体；auth/redaction/cursor/resume 全部沿用；不新增 channel kind、不扩白名单 |
| `sessions.activity` 投影 owner | 复用（只读消费） | live/queued/waiting 证据与 followUp 事实的唯一来源；confidence 词汇沿用，不建第二套 activity 状态机 |
| `attention`（host+client） | 复用 | 通知/attention 呈现边界不动；interactions 受限视图与 attention item 语义分立（可应答资源 ≠ 通知呈现），互不吞并 |
| `approval` / `userQuestions` 官方 passthrough | 复用 | 决策权与提问权归官方 authority；Face 2 只做受限投影与应答转发 |
| `services.apiProxy.respond` | 复用（底层机制） | respond 的底层承载；passthrough 成员集不变；不要求插件接触官方私有 registry |
| api-remotes 替代行 | 复用 | host→client 事件受限通道与 codec 校验沿用；本线不扩其转发白名单 |
| client-runtime 替代行 | 复用 | client 能力自描述（诚实 availability）与生命周期沿用；本线新 client 成员随其登记 |
| `services.llm` / `llm.routing.candidates` / client `services.modelDirectories` / `services.agentPresets` | 复用 | 候选查询唯一来源；不建重复 catalog |
| `services.attachments` + `attachments.pipeline`/`projection` | 复用 | attachmentRefs 解析与 content block 形态的唯一权威 |
| `sessions.views.*` / durable list / `services.sessionQuery` | 复用 | 历史/搜索唯一来源 |
| `agents.create`/`resume`、`executions.recovery.checkpoints`、官方 `sessions.create` passthrough | 复用 | 生命周期行为唯一来源 |
| **新增**：pending-interaction authority | 新建（facade） | Face 2 owner；纯 facade，无 replacement |
| **新增**：selection authority | 新建（facade） | Face 4 owner；纯 facade，协调官方落点 |
| **新增**：durable 适配层 attachmentRefs→content block 映射 | 新建（facade 内部合同） | Face 1 的 durable adapter 扩展；消费 `services.attachments` |

结论：两个新建 owner 均为纯 facade authority（不替换任何官方行）；其余全部复用。full 与选择性安装的装配等价性不受影响（无新包、无新行，新增公共面随主包交付）。

## Protocol Determination And Equivalence Criteria

**取舍**：最终协议不复制官方 mux/ApiProxy。官方 mux 是官方 browser 插件的私有传输状态；本线公开契约是四个类型化面 + 已交付 channels 载体。消费者不解析 RpcId、不订阅 mux 状态、不重建官方 schema。传输细节（`/plugin-api/*` 类型化方法路由与 channel 方法的具体分工、value-only 序列化）在 Tasks 阶段按既有 M9 wire 先例固定；仅当真实协议边界需要时引入 wire revision 并登记（`versioning-and-protocols.md` §5）。

**等价判据**（最终协议不同于官方 mux 时，消费者行为与身份/重连语义必须逐条等价）：

1. **身份等价**：session、message、interaction、operation、activity 的公共身份在基线/增量/重连之间稳定；消费者不从传输内部合成身份。
2. **完整与有序**：每 session 事件按官方顺序到达；cursor 补取覆盖官方可见事件集；gap ⇒ 显式 typed resync，绝不伪造补齐或静默丢失。
3. **重连等价**：重连后状态 ≡ 新基线 + 错过增量；旧 epoch handle/回调 typed stale 且不写入新代（沿用 channel generation 与 M9 stale 守卫）。
4. **待处理交互 parity**：同一 session 上官方 browser 客户端可见的 pending approval/question 集与受限视图可见集一致（脱敏包络除外），且双向无幽灵项；应答路径匹配。
5. **并发/竞争等价**：两客户端并发、旧答复、旧 owner、旧 epoch 的结果与已交付 commit-eligibility/stale-guard 合同一致。
6. **不复制**：无 ApiProxy 拷贝、无 mux 状态重建、无第二套 request/activity 状态机、无前端框架强制。

## attachmentRefs Durable Mapping Contract

兑现已登记缺口（M9 durable 适配层当前 fail-closed），本合同为唯一定义：

1. **输入**：`message.attachmentRefs: string[]`——元素是可经既有 attachments authority 解析的附件引用 id（与 `attachments.projection` 同一引用词表）；顺序即呈现顺序。
2. **映射**：durable 适配层经 `services.attachments` 将每个 ref 解析为其当前 content block 形态，产出一条完整 durable user message：文本为 text block，每个 ref 恰好一个对应 media kind 的 content block（一一对应、不合并、不重排）；source provenance 按既有 source-audited durable 契约记录（含 refs 清单）。
3. **保真**：映射产出的 blocks 与 attachments pipeline 投影给模型的 blocks 同源；client payload 携带同一 refs——附件以附件形态同时到达模型与 UI，不缩水为纯文本、不伪造占位 block。
4. **fail-closed**：任一 ref 无法解析（缺失/过期/不支持）⇒ 整条请求 typed rejected/unavailable（携带逐 ref 有界原因），不追加部分消息、不静默丢弃、不以纯文本降级。
5. **词表边界**：请求侧 `user-message` 仍是 v1 唯一请求 kind（附件承载版由本合同正式定义）；其余 kind 保持 typed rejected；公共词表与 durable surface 词表互不泄漏（沿用 M9 适配层先例）。
6. **登记**：交付时在 canonical registry 同步该映射的消费成员与 kind 词表；M9 的"附件未映射 ⇒ unavailable"缺口注随之闭合。

## Model Selection Snapshot Contract（与 scoped 线共同验收）

- set 提交经官方 model-selection 路径落点：官方既有行为在 prompt assembly 捕获选择并用于本步 route——facade 复用该单一落点，因此 route 消费与 prompt 快照消费天然读同一值；facade 不做旁路路由改写（route policy 仍归 `llm.routing` 域）。
- 共同验收证据：一次 committed 选择后，本步 route 实际命中所选模型且 prompt 快照携带同一值（一条测试同时断言两侧）；scoped-agent-contributions 线的贡献/决策消费侧由其自身 spec 验收。
- 恢复：跨模式/重开读取官方持久化选择（session 档），facade 不存副本 ⇒ 无漂移。
- 并发：CAS `expectedRevision`；冲突 typed conflict；不 silent last-win；set 可携带 signal（取消提交尝试，不伪造终态）。

## M9 Delivered Faces: Consumption And Extension（扩展而非重建）

| M9 已交付面 | 本线消费方式 | 本线扩展增量 |
|---|---|---|
| `sessions.request`/`cancel`（host+client） | 唯一发送/取消入口；acceptance/dedupe/already-running/terminal 裁决/audit 逻辑原样消费 | spec 增 `attachmentRefs`、`delivery`；cancel 接受 queued reference；缺省冲突行为（`already-running`）不变 |
| operation handle/status/observe + wire | handle 重建、value-only 投影、stale 世代守卫原样沿用 | 无合同变更；steer 并入活 attempt 不产生新 operation |
| activity correlation / waiting 相位 | Face 3 关联与 pending/running 基线读取的唯一来源 | 无 |
| client 能力自描述（维护后基线） | Face 2/4 client 成员的 availability 语义前提（空对象 ≠ active） | 新成员按同规则登记 |
| agent-loop 既有切片 attempt 事实 | Face 1 交付判据与 Face 3 followUp 事实来源 | 不改切片边界；不新增行 |

已交付合同的接线/自描述修复归其自身维护；本线任何 Tasks 发现的该层缺陷按其维护通道处理，不在本线夹带。

## Client Half

- Face 1 client：已交付（M9），本线仅扩展请求 spec 字段与 queued reference 语义，wire value-only 投影随之扩展。
- Face 2/4 client：新增 client 成员（`sessions.interactions.*`、`sessions.selection.*`）随主包 client bundle 经既有 carriers（connection/gateway/api-remotes/client-runtime）交付；host 侧脱敏先行、client 只校验形状；offline/rebind/headless ⇒ typed unavailable（不排队不静默丢）。
- §10 六问：逐载体记录见 Requirements「Client-Half Determination」表——本线全部新增面经由已具备完整 client 半面的既有 owner 承载；本线不新增 R 包/行，故无新增 §10 判定义务；若触发下节 R 点位，Q6 命中 ⇒ 完整 client 半面 + R7 自建构建。

## R-Point Design Statements（仅设计陈述，本线基线无 R）

1. **待处理交互应答 seam**：基线判定 `services.apiProxy.respond` + 官方 user-questions admission 足以承载 Face 2 应答（B facade wrap）。若 Tasks 阶段 probe 证明 question-kind 应答必须管理官方私有 mux registry（即无安全 wrap 路径），条件 R 点位是官方 answer entry 所属组件行（api-gateway 的 typert-gateway 行或 user-questions 组件行）的唯一 replacement owner 切片：须完整复刻该行契约、boot 自检、版本锁定、退役条件登记；因官方行行使 client-facing service（§10 Q6 命中）必须提供完整 client 半面。
2. **session 生命周期 seam**：create/history/search 均有可达官方 seams（passthrough/projections/sessionQuery）。若 probe 证明某具体行为缺 dispatch 点，条件 R 点位是该行为所属官方组件行的唯一 owner 切片，同样受上述全套规则约束。
3. 既有 agent-loop 切片（M9）仍是 Face 1 唯一 R 消费面，本线不扩展其边界。横切派发语义（priority/deepFreeze/fault containment）永不进任何切片。

两条陈述均为"评估入口"而非批准：任何 R 落地必须走独立确认流程并同步 `capability-strategy.md` §5 装配表、AGENTS.md §2/§4 与 feature-list §3.1。

## Failure Paths And Guard Strategies

- **apply 安全**：两个新 authority 均为纯 facade，挂主包 ctx 生命周期；初始化失败 ⇒ 有界诊断 + 该面 typed unavailable，绝不抛穿 apply；无新 replacement 行 ⇒ 无新 patch 自检义务，既有 carriers 自检沿用。
- **失败呈现分层**：P1/P2 统一错误沿用；面级 degraded/unavailable view；业务冲突（conflict/stale/rejected/denied/duplicate/already-running）一律 typed result，不伪装 boot 失败。
- **授权失败**：typed denied + 有界原因；不泄露其他 session/interaction 存在性。
- **逐动作授权**：request（含 steer/queue）、respond、selection.set 均在各自 authority 入口按目标 session grant 校验（复用已交付 channel auth 的 verifier/authorizer/pairing 判定结果，device/session/owner 三检分立）；连接可达本身不构成任何动作授权，pairing 凭据只建立 device 身份；loopback/trusted-host 边界由 connection owner 原样维持，本线不改写。
- **stale 纪律**：旧 generation/epoch 的 handle、observer、respond、queued-reference 取消全部 typed stale/no-op；不写入新代。
- **脱敏**：受限视图 summary/answerShape、respond audit、client 负载逐出口脱敏；secret/owner-private/diagnostic 不出任何出口；host 脱敏失败 ⇒ fail-closed 不发未脱敏负载。
- **可用性诚实**：官方 pending source / selection 落点 / inbox 边界 / channel 不可达 ⇒ 对应面 typed degraded/unavailable；空列表不冒充健康"无待办"；无关面隔离不受连带。
- **audit**：respond/request 侧 bounded 内存诊断（owner、id、action、时间、outcome），无 payload、无 secret；写失败 ⇒ gap marker，不伪造记录（沿用 M9 Req10 形状）。

## Concurrency And Cancellation Declarations

| 面 | 策略 | scope | 提交资格 | 取消 |
|---|---|---|---|---|
| Face 1 | exclusive per session（缺省）+ 声明式 steer/queue 交付（官方 inbox 承载） | session | authority 提交点原子裁决（M9 不变） | signal ≠ terminal；queued 项官方 discard，认领后走活 operation cancel |
| Face 2 respond | coordinated per interaction id（第一提交者获胜） | interaction | pending 且官方未决 + 会话授权 | signal 取消在途提交；已接受不可撤回（官方裁决） |
| Face 3 | 只读消费；channel lease/fencing 按既有合同 | session | 不适用（无共享写入） | dispose/ack 按合同；旧 epoch 回调 stale |
| Face 4 | compare-and-swap（owner-local revision） | session | expectedRevision 匹配 + 官方落点接受 | signal 取消提交尝试，不伪造终态 |

## Data Models

```js
// 请求 spec 扩展（Face 1；未列字段沿用 M9）
message: { kind: 'user-message', text, attachmentRefs?: string[] }
delivery?: 'steer' | 'queue'          // 缺省 = M9 already-running 行为

// steer/queue 受理结果（accepted outcome 扩展）
{ ok: true, code: 'accepted', delivery: 'steer' | 'queue',
  operationRef?: { id },               // steer：并入的活 operation
  queuedRef?: { id } }                 // queue：可经 sessions.cancel 取消的排队引用

// 待处理交互受限视图（Face 2）
{ id, kind: 'approval' | 'question', sessionId, summary, createdAt, answerShape }

// respond 调用与结果（Face 2）
{ id, action: 'approve' | 'reject' | 'answer' | 'cancel', answer?, reason?, signal? }
→ { ok, code: 'accepted' | 'stale' | 'rejected' | 'denied' | 'unavailable', reason? }

// 选择视图与提交（Face 4）
{ sessionId, provider, model, effort, revision, source, committedAt, observedAt }
{ sessionId, selection: { provider?, model?, effort? }, expectedRevision?, signal? }
→ { ok: true, code: 'committed', revision } | { ok: false, code: 'conflict' | 'rejected' | 'unavailable', reason? }
```

## Hook Exposure And Component Ownership

| 钩子/源 | 类别 | 引出方式 | 失败路径与 guard |
|---|---|---|---|
| session 生命周期（create/list/history/search/open） | A | 既有 passthrough/projections/operations 直消费（复用矩阵） | 缺面 ⇒ typed unavailable，不建平行平台 |
| 发送/取消/steer/queue | B | 已交付 request authority 扩展 + 官方 inbox seams + M9 切片事实消费 | inbox 不可达 ⇒ typed unavailable；无 append-guess 回退 |
| attachmentRefs 映射 | B | durable 适配层合同，解析走 `services.attachments`（A seam） | ref 不可解析 ⇒ fail-closed 逐 ref 原因 |
| 候选模型查询 | A | `services.llm`/`llm.routing.candidates`/client `modelDirectories`/`agentPresets` | 缺 service ⇒ typed unavailable |
| 模型/effort 变更 | B | selection authority 协调官方 model-selection 落点 | 落点缺失 ⇒ typed unavailable；CAS 冲突 typed conflict |
| pending 交互视图 | B | interactions authority 投影官方 approval/userQuestions 事件/状态 | 官方源降级 ⇒ typed degraded/unavailable，空 ≠ 健康 |
| 应答/拒绝/取消 | B | respond operation 转发 `services.apiProxy.respond` / 官方 admission | seam 不可用 ⇒ typed unavailable；不代答、无重试 |
| 事件基线/增量/重连 | A | 已交付 channels owners（消费合同） | gap ⇒ typed resync；capability 失配 ⇒ degraded/isolated |
| attention 呈现 | A | 既有 attention hub 原样 | 不动 |

## Testing Strategy

1. 生命周期复用：无官方业务 API 依赖的交互测试客户端走通 create→list→history/search→open/restore（Requirement 1/10 AC1）；缺面行为 typed unavailable 断言。
2. 附件贯通：带 refs 请求在真实 durable 边界落成 content blocks（与 pipeline 投影同源）；不可解析 ref fail-closed 逐 ref 原因；UI/model 两侧同 refs（Requirement 2/7/10 AC5）。
3. steer/queue：活 operation 下 steer 并入本步、queue 入官方 inbox 并经 activity 可见；queued reference 取消（认领前 discard / 认领后活取消）；缺省 already-running 不回归（Requirement 2）。
4. 选择快照：committed 选择被本步 route 与 prompt 快照同值消费（与 scoped 线共同证据）；CAS 冲突；恢复无漂移（Requirement 3）。
5. 受限视图与应答：approval/question 视图形状与脱敏断言；匹配应答第一提交者获胜、第二 stale；形状不匹配 rejected；官方源降级视图；不代答（无任何自动应答路径）（Requirement 4/5）。
6. 流与重连：基线→增量→断线 resume→gap resync 全链；事件身份关联来自共享事实；两客户端并发/旧答复/旧 owner/旧 epoch（Requirement 6/10 AC2）。
7. 授权分立：device/session/owner 逐项拒绝；可达 ≠ 授权；pairing 不成全局授权；denied 不泄露存在性（Requirement 8）。
8. client 半面：同形 typed 结果、offline/rebind unavailable、stale 守卫、host 脱敏先行；availability 对空对象/缺失 carrier 如实报告（Requirement 9）。
9. 互操作：官方 browser 插件与独立客户端同 session pending 集与状态一致（脱敏包络内）（Requirement 10 AC3）。
10. 终验：受护 `npm test`、`git diff --check`、registry/surface 一致性、官方包零修改审计、全局对抗性终审；证据不足即保持 typed unavailable。

## Standards Applicability And Alignment

- `capability-strategy.md`: applicable。行为逐条 A/B 落点；R 判定逐条引用 §2/§4（基线无新 R，条件点位仅陈述且须走完整 R1–R8）；client 半面 §10 六问逐载体记录；services 分级沿用（apiProxy passthrough 不扩成员）；公共面减法不适用（本线为加性扩展，无删除）。
- `api-shape.md`: applicable。四面独立 owner、各自单主面（operation / projection+operation / 消费合同 / mutation）；状态空间互不共享；无 register+query+mutate 混合 smell；数据流单向（官方事实 → authority → 消费者）。
- `api-idioms.md`: applicable。interactions 视图 = projection（list/get/observe 词汇不新造）、respond = operation（handle 语义按需、typed outcome）、selection = mutation（CAS/commitState 词汇）、availability/selfDescription 沿用 §2；`id`/`ownerId` 派生不可伪造；generation/seq/epoch 不混用。
- `public-api-shape.md`: applicable。新成员挂既有 `sessions` 领域第三层（强领域关系），client 根 `sessions` 加性扩展；复数资源名、动词方法；不建 alias；capability 用公共语义 path；无治理代号入公开 path。
- `composition-and-authority.md`: applicable。respond coordinated（第一提交者获胜 + 提交资格）；selection coordinated CAS；owner 从调用上下文派生；authority closure 对受支持路径声明（直接 append 不隐含启动处理的 M9 边界沿用）；两个 synthetic 插件反向顺序验证纳入测试策略。
- `domain-composition.md`: applicable。sessions/channels/llm/tools/approval/attention 域各归其主；本线不建跨域大状态机；channels 域 scope/possession/auth owner 要求沿用。
- `ordering.md`: applicable。无新策略排序面；steer/queue 顺序由官方 inbox 语义承载；事件监听固定 priority 词汇；无全局 before/after 图。
- `identity-and-lifecycle.md`: applicable。interaction id 为 facade 铸造公共身份（独立于 event seq）；operation/execution/attempt/revision 各归其位；terminal 词汇五值不变；timeout 归 error。
- `durable-state-and-scope.md`: applicable。attachmentRefs 写入走 source-audited durable append（session 档）；selection 持久化由官方 session 持久化承载（不新增记录档位）；interaction 映射为有界内存（不 durable）；插件私有 storage 不参与。
- `visibility-and-redaction.md`: applicable。受限视图/audit/client 负载逐出口脱敏；client 半身更保守；XSS 包络机械校验沿用；secret 零出口。
- `concurrency-and-cancellation.md`: applicable。并发策略声明表成文（上文）；取消=信号、终态=裁决；stale 结果/迟到回调失去提交资格；disposer 幂等且只撤自有资源。
- `versioning-and-protocols.md`: applicable。冻结基线内交付；无新包/行 ⇒ 装配等价性自动保持；wire 细节延至 Tasks 按真实边界固定，仅真实协议族需要时引入整数 revision 并登记；durable 侧无新 record schema（映射消费既有 durable append 契约）。

## Key Decisions And Tradeoffs

1. **四面拆线而非三面**：selection 独立成面是为满足一面原则（mutation ≠ operation ≠ projection），代价是多一个 namespace；收益是 request authority 保持 M9 已验收形状不重开。
2. **Face 3 为消费合同而非新面**：channels 载体已交付且带完整 client 半面，重建只会产生第二套重连语义；代价是"面"没有独立 namespace，其边界由等价判据与测试固定。
3. **缺省冲突行为不变**：`delivery` 为显式 opt-in，M9 `already-running` 缺省保留——扩展显式、回归可控，不为便利改已交付缺省语义。
4. **respond 走官方 answer entry**：不管理官方私有 registry；代价是受限视图必须与官方 pending 源严格同步（映射随官方事件清除），收益是决策权不旁路。
5. **interaction 映射不 durable**：生命周期完全跟随官方 pending 源，facade 重启后从官方状态重建映射；代价是官方源降级时视图同步降级（typed），收益是零第二状态机。
6. **无新 R**：全部行为有可达官方 seams 或已交付 owner 承载；条件 R 点位仅留评估入口，避免"为激进而替换"。

## Design Completion Condition

本设计覆盖 Requirements 全部条目（Requirement 1–10 与 client 半面判定节）：四面 owner 划分与成员形状、复用矩阵逐项判定、协议等价判据、attachmentRefs 映射合同、选择快照合同、M9 扩展消费方式、R 点位陈述、失败/guard、并发声明与 standards 逐分册结论成文。Tasks 经对抗性审查后进入实现；用户侧修订就地更新本文与 requirements 对应条目。
