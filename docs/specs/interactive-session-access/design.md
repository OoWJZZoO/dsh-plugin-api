# Stage 2 - Design

> feature_name: `interactive-session-access`
> milestone: M10
> status: Stage 2 已交付（2026-09-12，与 Stage 1 Requirements 同批产出）；Stage 3（Tasks）产出中（2026-09-14），正文已按 Stage 3 探针结论修订 Face 1/2/4 与 R-Point 1（见文末「Stage 3 探针修订」）
> 输入溯源：已确认 Goal（`goal.md`）与本线 Requirements；M10 观察报告 OBS-09/OBS-12；M10 工作纲领 §3.9/§4/§5；已交付 `session-interaction-operation` requirements/design（M9）及其 2026-09-11 维护现状注；canonical registry `sessions.request/cancel`、`sessions.channels.*`、`sessions.activity.*`、`attention.*`、`services.apiProxy`、client 根 `sessions`/`attention` 现状；`docs/standards/` 全部 12 分册。

## Status

本文承接已确认 Goal 与同批 Requirements，落实 Goal Stage boundary 的全部待定项：面拆线与 owner 划分、既有 owner 复用矩阵、协议取舍与等价判据、attachmentRefs durable 映射合同、M9 已交付面的扩展消费方式、可能的 R 点位陈述、失败路径与 guard 策略、standards 逐分册结论。版本冻结基线（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`）内交付；本文不提出任何版本字段变更，不批准任何新 replacement 包或行。

## Overview

本 feature 在既有 sessions authority 之上按行为拆分为四个独立 owner 的面，交付"只消费公开运行时契约"的完整交互：

1. **交互操作面（operation）**：owner = 已交付 session request authority（扩展）。承载发送（含附件）、取消、steer/queue 交付词表。
2. **待处理交互资源面（projection + respond operation）**：owner = 新增 facade pending-interaction authority。承载 pending approval/question 受限视图与匹配应答。
3. **只读流面（consumption contract）**：owner = 已交付 session channel authority（connection/gateway replacement owners）+ activity projection（只读消费）。承载基线/增量/断线重连/错过事件/身份关联的消费合同，不新建通道或事件体系。
4. **选择提交面（mutation）**：owner = 新增 facade selection authority（经 `services.apiProxy` 审计白名单扩展承接官方 selection seam，选型论证见 Model Selection Snapshot Contract）。承载目标 session 的模型/effort 变更（候选查询复用既有 catalog faces，不进本面）。

三主面来自 Goal 的拆分指示；选择面为 Design 增补的第四面，理由：selection 提交是 mutation idiom，与 operation/interaction-resource 不共享状态空间，按 `api-shape.md` §3/§4（一面原则与 smell 判据 1）必须独立 owner，不得混入 request authority 或 interactions authority。

**不新增第二套 request/activity 状态机**的实现含义：Face 1 的排队/steer 状态由官方 inbox（durable 类型 `agent/inbox/spliced`，discard 以 `outcome: 'canceled'` 记录；`inserted`/`claimed`/`discarded` 为派发通知，claimed 非 durable）承载；Face 2 只保存 id↔官方 pending item 的映射，生命周期由官方 approval 事件（question 侧来源见 Face 2 与 R-Point 1 的条件探针）驱动；Face 3 是消费合同不是状态机；Face 4 的选择事实源是官方 apiproxy selection 状态（其持久化为官方尽力而为的部署默认，见 Model Selection Snapshot Contract）。四个 owner 均不复制官方内部算法。

## Current-State Findings

- 已交付基础（M9 及其维护后基线）：`sessions.request`/`cancel`（host+client 同形 operation，exclusive+deduplicate，terminal 唯一裁决）、operation status/observe wire（`/plugin-api/sessions` 路由、value-only 投影、client 重建）、activity correlation（`observed`/`reconstructed`/`unknown`/`unavailable` 不互代）、waiting 相位（与 activity 等待证据同源）、诚实 availability 与 stale 世代守卫。
- 已登记缺口（本线兑现）：`message.attachmentRefs` 无 durable content block 映射，当前 fail-closed（带附件请求 typed unavailable 且不写入）。
- 官方可达 seams 与官方事实（审查更正后）：`services.apiProxy` 白名单仅 `downloads` getter 与 `respond` method（respond 是既有回答入口）；**per-session 当前选择是 `@deepseek-ai/dsh-host-apiproxy`（ApiProxyService）的私有状态（selections Map + `selectionFor(agent).current`），唯一官方提交/读取入口是 mux unary `session.selectModel`/`session.models`（官方 UI 经 connection client 调用）**；`services.agentDefaultModel` 只是部署默认值，`ctx.llm.resolveCallConfig` 仅校验，两者都不是选择状态来源。answer entry（respond、pending approval/question registry、/api/respond 路由）同属 dsh-host-apiproxy。官方 `ctx.userQuestions` 仅 `registerProvider`/`ask` 且单 provider（web profile 下已被 apiproxy 占用），pending question 集位于 apiproxy 内部（mux 帧）。官方 inbox durable 类型为 `agent/inbox/spliced`（discard 以 `outcome: 'canceled'` 记录），`inserted`/`claimed`/`discarded` 是 dispatch 通知（claimed 非 durable）。官方 selectModel 持久化为尽力而为（`agentDefaultModel.saveSelection`；存储失败仅记日志；无 settings provider 时仅 session-local），运行时回退链为内存值 → 会话最近一次已记录请求的 header config（dsh-session `requestHeader()` fold 至最后一条 request/header，非创建时值）→ 部署默认。`approval.request`/`overrideOf` 为官方 passthrough，approval 侧 pending 集由 **durable 对** `approval/asked`/`approval/decided` 折叠得到（`approval/request` 是 answerer waterfall，不是 durable 事件；Stage 3 探针更正）。
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
 │            ▼                          ▼ 官方 approval waterfall     │                        │
 │  agent-loop 既有切片(attempt 事实)   (兜底 answerer, append 注册)    sessions.channels 载体    │
 │                                                                            │               │
 │  Face 4 选择提交面（owner: selection authority，新增 facade）                │               │
 │  selection.get/set（值级 CAS；经 services.apiProxy 白名单扩展承接官方 seam）  │               │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
        client 半面：全部经已交付 client carriers（connection/gateway/api-remotes/client-runtime）
```

### Face 1: 交互操作面（owner = 已交付 session request authority，扩展）

| 成员 | runtime | idiom | 说明 |
|---|---|---|---|
| `sessions.request` | host+client | operation | 既有成员扩展 spec：`message.attachmentRefs: ImageAttachmentRef[]`（官方 durable 图像引用对象数组，新映射）、`delivery?: 'steer' | 'queue'`（缺省 = 已交付 `already-running` 行为不变）；`delivery` 经官方 `agent.steer`/`agent.followup` 交付，排队引用即 durable inbox 项身份 |
| `sessions.cancel` | host+client | operation | 既有成员；接受 queued reference（未认领排队项的取消） |
| operation handle/status/observe | host+client | operation | M9 既有 wire 不变；steer 并入活 attempt 时不产生第二个 operation |

扩展均落在同一 authority 内部（durable 适配层 + 官方 inbox 交付），不新增公共状态机。

**单一逻辑消息口径（与官方 splice 记录的关系）**：`delivery: 'steer' | 'queue'` 走官方 inbox splice 时，插入内容由官方 `agent/inbox/spliced` durable 记录承载，facade 不再重复 append 一份内容；缺省路径维持 M9 的 durable append。一条逻辑消息以请求铸制的 message/operation 身份关联判定，消费者按身份去重、不按 durable 记录条数；官方路径原生产生的既有重复记录如实呈现，不由本线合成或隐藏。Tasks 验证项：probe 官方 splice/claim 路径，确认 splice 是否要求先经 durable append 还是自行记录内容；适配层保证每条逻辑消息在官方路径允许的范围内恰有一条承载内容的记录。

### Face 2: 待处理交互资源面（owner = 新增 facade pending-interaction authority）

| 成员 | runtime | idiom | 形状 |
|---|---|---|---|
| `sessions.interactions.list({ sessionId?, cursor? })` | host+client | projection | 冻结 `{ items, nextCursor, sources } \| availability view`（`sources` 逐 kind 报 `active/degraded/unavailable`） |
| `sessions.interactions.get({ id })` | host+client | projection | 冻结单视图 \| typed `missing/unavailable` |
| `sessions.interactions.respond({ id, action, answer?, reason?, signal? })` | host+client | operation | typed `{ accepted \| stale \| rejected \| denied \| unavailable }`；approval 的 `action` 闭集 `approve/reject/cancel` → 官方 outcome 闭集 |
| `sessions.interactions.availability()` | host+client | selfDescription | 冻结状态，永不抛错 |

受限视图成员：`{ id, kind: 'approval' | 'question', sessionId, summary, createdAt, answerShape }`。`id` 为 facade 铸造公共身份；`summary`/`answerShape` 有界脱敏。内部只保存 id↔官方 pending item 映射（有界、内存、不 durable）；生命周期由官方事件驱动，映射随官方 resolution 清除。不旁路 approval/userQuestions authority，不暴露官方 registry 内部 id/形状。

**视图来源分侧（Stage 3 探针修订）**：approval 侧 pending 集由**会话日志的 durable 对** `approval/asked`（`{id, toolName, callId?, reason?}`）减 `approval/decided`（`{id, outcome}`）折叠得到——官方 apiproxy 的 answerer 用同一算法（尾部回扫、按 `callId` 匹配），投影无障碍；`approval/request` 是 **answerer waterfall**，不是 durable 事件。question 侧无 durable 痕迹，且 `ctx.userQuestions` 单 provider 槽位在 web profile 已被 apiproxy 占用（第二 provider 会 `DUPLICATE_PROVIDER` 并让官方行 boot 失败）——**question 视图与应答在本 runtime 诚实 typed unavailable**，不伪造列表、不抢槽位。

**应答来源（Stage 3 探针修订）**：官方 mux 答案入口 `apiProxy.respond({rpcId, result})` 需要 apiproxy 广播时才铸造的 `rpcId`（`pendingApprovals` 的键），门面不可达；可达的官方 answer entry 是 `approval/request` waterfall 本身。门面以 **append 方式**（`ctx.on`，绝不 `prepend`；Cordis 无 priority 机制，顺序=注册顺序）注册兜底 answerer：只有没有更早 answerer 认领（即官方 mux answerer 缺席）的部署里才会收到请求——**不遮蔽**官方 answerer（前提是受支持安装路径下 plugin-api 行排在官方 api-proxy 行之后：bundle patch 与 `dsh plugin add` 均追加到行表尾）；收到即持有该请求并把显式调用方的选择换算成官方 outcome 闭集（`approve→allowed-once`、`reject→rejected`、`cancel→cancelled`）交回官方 authority 记账（`approval/decided` 仍由官方 append）。持有以**活跃 watch 租约**为前提（见 Failure Paths），无客户端的部署行为不变（仍走官方默认 `'unavailable'`）。

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
| `sessions.selection.set({ sessionId, selection, expected?, signal? })` | host+client | mutation | typed `{ committed, revision } \| { conflict } \| { rejected } \| { unavailable }` |
| `sessions.selection.availability()` | host+client | selfDescription | 冻结状态 |

`selection = { provider?, model?, effort? }`；`expected = { provider?, model?, effort? }` 为调用方经 get 观察到的选择快照（值级 CAS 依据，见 Snapshot Contract）。set 经 `services.apiProxy` 审计白名单扩展的官方 selection submit seam 提交（官方事实源为 apiproxy 私有 selections 状态），facade 不维护平行选择存储；`revision` 为 owner-local，仅随 facade 介入的成功提交步进（变更观察用，不宣称可感知官方路径写者）；`source` typed 披露有效值来源（committed / 部署默认回退 / 最近已记录请求 header config 回退 / unknown）。候选查询不进本面（复用既有 catalog faces，见复用矩阵）。

## Existing Owner Reuse Matrix

| 既有 owner / 面 | 判定 | 说明 |
|---|---|---|
| 已交付 session request authority（M9 主包 facade） | **复用 + 扩展** | Face 1 唯一 owner；扩展点仅 attachmentRefs 映射与 delivery 词表；acceptance/dedupe/cancel/terminal/audit 逻辑不变 |
| connection 替代行（`dsh-client-connection` owner） | 复用 | client 根 `connection` unary rpc 与 generation/epoch/rebind 语义沿用；不扩展 |
| `sessions.channels`（connection + gateway 替代行 owners） | 复用 | Face 3 唯一载体；auth/redaction/cursor/resume 全部沿用；不新增 channel kind、不扩白名单 |
| `sessions.activity` 投影 owner | 复用（只读消费） | live/queued/waiting 证据与 followUp 事实的唯一来源；confidence 词汇沿用，不建第二套 activity 状态机 |
| `attention`（host+client） | 复用 | 通知/attention 呈现边界不动；interactions 受限视图与 attention item 语义分立（可应答资源 ≠ 通知呈现），互不吞并 |
| `approval` / `userQuestions` 官方 passthrough | 复用 | 决策权与提问权归官方 authority；Face 2 只做受限投影与应答转发 |
| `services.apiProxy`（现有 downloads/respond 成员） | 复用 | 现有成员集与语义不变（新增的两条 selection 成员为 `optional`，缺成员不连带停用既有成员）；Face 2 不经 mux answer 入口（`rpcId` 不可达），不要求插件接触官方私有 registry |
| `services.apiProxy` selection read/submit 成员 | 复用 + **审计白名单扩展**（本线新增成员） | Face 4 唯一官方 seam（官方事实源在 dsh-host-apiproxy ApiProxyService）；§6 分级 + bypass 登记；成员探针不可服务 ⇒ 条件 R/C 回退（见 R-Point 2） |
| api-remotes 替代行 | 复用 | host→client 事件受限通道与 codec 校验沿用；本线不扩其转发白名单 |
| client-runtime 替代行 | 复用 | client 能力自描述（诚实 availability）与生命周期沿用；本线新 client 成员随其登记 |
| `services.llm` / `llm.routing.candidates` / client `services.modelDirectories` / `services.agentPresets` | 复用 | 候选查询唯一来源；不建重复 catalog |
| `services.attachments` + `attachments.pipeline`/`projection` | 复用 | attachmentRefs 解析与 content block 形态的唯一权威 |
| `sessions.views.*` / durable list / `services.sessionQuery` | 复用 | 历史/搜索唯一来源 |
| `agents.create`/`resume`、`executions.recovery.checkpoints`、官方 `sessions.create` passthrough | 复用 | 生命周期行为唯一来源 |
| **新增**：pending-interaction authority | 新建（facade） | Face 2 owner；纯 facade，无 replacement |
| **新增**：selection authority | 新建（facade） | Face 4 owner；wrap 上述 `services.apiProxy` 扩展成员（owner 派生、值级 CAS、audit、typed outcome） |
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

1. **输入**：`message.attachmentRefs: ImageAttachmentRef[]`（Stage 3 探针修订）——元素是官方 durable 图像引用对象 `{ attachmentId, mediaType, bytes, width, height, name? }`（与 `attachments.readImage()`/官方 durable 块同一引用词表）；顺序即呈现顺序；裸 id 字符串属形状违规（`invalid-input`）。
2. **映射**：durable 适配层经 `services.attachments.readImage(ref)` 验证每个 ref 仍可解析，并以**返回的 canonical ref** 产出块 `{ type:'image', attachment: <canonical ref> }`（与官方 `durablePromptContent()`/`imageBlockIn()` 同形），产出一条完整 durable user message：文本为 text block，每个 ref 恰好一个图像块（一一对应、不合并、不重排）；source provenance 按既有 source-audited durable 契约记录（`user/message` 无 `sourceEventSeqs`）。
3. **保真**：映射产出的 blocks 与 attachments pipeline 投影给模型的 blocks 同源；client payload 携带同一 refs——附件以附件形态同时到达模型与 UI，不缩水为纯文本、不伪造占位 block。
4. **fail-closed**：任一 ref 无法解析（缺失/过期/不支持）⇒ 整条请求 typed rejected/unavailable（携带逐 ref 有界原因），不追加部分消息、不静默丢弃、不以纯文本降级。
5. **词表边界**：请求侧 `user-message` 仍是 v1 唯一请求 kind（附件承载版由本合同正式定义）；其余 kind 保持 typed rejected；公共词表与 durable surface 词表互不泄漏（沿用 M9 适配层先例）。
6. **登记**：交付时在 canonical registry 同步该映射的消费成员与 kind 词表；M9 的"附件未映射 ⇒ unavailable"缺口注随之闭合。
7. **单一逻辑消息**：与官方 inbox splice 记录的关系及双写判定口径见 Face 1 节「单一逻辑消息口径」——steer/queue 的内容由官方 `agent/inbox/spliced` durable 记录承载时，facade 不重复 append；本合同适用于承载内容的那一条记录。

## Model Selection Snapshot Contract（与 scoped 线共同验收）

- **seam 选型（Stage 3 探针修订）**：per-session 当前选择的官方事实源是 `@deepseek-ai/dsh-host-apiproxy`（ApiProxyService）的私有状态（selections Map + `selectionFor(agent).current`），唯一官方提交/读取入口是 mux unary `session.selectModel`/`session.models`；`services.agentDefaultModel` 只是部署默认值、`ctx.llm.resolveCallConfig` 仅校验，均非选择状态来源。本线选定 **A 类通路：扩 `services.apiProxy` 审计白名单**，承接 selection read/submit 两个成员（§6 分级：read=pure passthrough；submit=advanced supported passthrough，不入 Composable Profile，`bypasses` 声明 Face 4 为其上的替代协调写路径），Face 4 在其上加 owner 派生、值级 CAS、bounded audit 与 typed outcome。论证：这是唯一可达且不要求插件理解 mux 帧的官方入口；白名单扩展保持基线无 R；submit 的共享 mutation 风险由 §6 分级与 authority closure（声明 bypass + Face 4 协调面）闭合；明确第三方用例即本线交互客户端（mobile channel 的模型列举/选择）。诚实降级：若 probe 证明 submit 成员在当前 runtime 不能作为 service 方法服务（仅 mux 帧可达），回退为条件 R（dsh-host-apiproxy 的 apiProxy 行，见 R-Point 2）或 C 类诚实 unavailable 基线（候选查询不受影响），收敛线回合同步。
- **seam 可达性（Stage 3 探针事实）**：`ApiProxyService` 实例上 `sessions` 是公开成员，`sessions.models(request)`/`sessions.selectModel(request)` 是 **mux 形状**（入参 `{rpcId, payload}`，返回 `{rpcId, result:{ok,value|error}}`），因此可在进程内经 `services.apiProxy` 白名单的**两条窄成员**（`sessionsModels`/`sessionsSelectModel`，按路径声明）承接，无需理解 mux 帧语义；白名单**不暴露 `apiProxy.sessions` 整对象**。
- **读取与 source 推断（Stage 3 探针事实）**：`session.models` 只返回有效值 `current`，不返回它来自哪一层；可观察的兜底层为部署默认（`agentDefaultModel.currentSelection()`）与会话最近一条已记录请求头（`session.requestHeader()?.config`）。`source` 因此按证据分级推断：与 logged header config 相同 ⇒ `fallback-logged-request-config`；否则与部署默认相同 ⇒ `fallback-deployment-default`；否则 ⇒ `committed`（内存层是唯一剩余来源）；两者都取不到 ⇒ `unknown`。取值与兜底层重合时归因偏保守，登记为残余歧义。
- **单一写点**：set 经该 seam 一次提交；facade 不持有第二份选择值。route 侧由官方在构建本步请求时消费同一状态；prompt 侧消费点由 scoped-agent-contributions 线的贡献承载同一事实源——本步 route 与 prompt 快照读同一值，以联合验收证据断言（一条测试同断言两侧）。facade 不做旁路路由改写（route policy 仍归 `llm.routing` 域）；若 probe 显示某一消费点缺位，按 typed 结果上报并进收敛线同步，本线不伪造第二个写入点。
- **恢复（尽力而为持久化，审查更正后）**：官方 selectModel 持久化为部署默认的尽力而为（`agentDefaultModel.saveSelection`；存储失败仅记日志；无 settings provider 时仅 session-local），运行时回退链为内存值 → 会话最近一次已记录请求的 header config（dsh-session `requestHeader()` fold 至最后一条 request/header，非创建时值）→ 部署默认。因此**无漂移仅在官方持久化成功时成立**；选择视图以 `source`（`committed` | `fallback-deployment-default` | `fallback-logged-request-config` | `unknown`）与 `observedAt` typed 披露有效值来源与降级，不把最后提交值冒充为恢复后的权威值。
- **并发（值级 CAS + 残余竞态声明，审查更正后）**：提交时以 `expected`（get 观察的选择快照）与官方当前值做值级比对，不匹配 ⇒ typed conflict——该比对覆盖经官方路径（如官方 browser 插件 selectModel）的并发写；facade owner-local `revision` 仅用于 facade 介入写者的变更观察。官方 seam 本身 last-write-wins、无原子 CAS：比对与官方提交之间窗口内的竞态按官方语义生效，此残余竞态如实声明，不宣称线性化；set 可携带 signal（取消提交尝试，不伪造终态）。

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

1. **待处理交互应答与 question 视图 seam（Stage 3 探针收敛）**：approval 侧的**视图**经 durable 对完整可达；**应答**经门面以 append 方式注册（绝不 `prepend`；Cordis 无 priority 机制）的兜底 `approval/request` answerer 承载（官方 mux answerer 在场时不进入；见 Face 2 应答来源与探针修订第 6 条）。question 侧的视图与应答在本 runtime 均无可用 seam（无 durable 痕迹 + 单 provider 槽位被占用），**基线交付为诚实 typed unavailable**。因此本线**不落地 R 点位**：question 侧要变成可用，需要官方提供 question 的 pending/answer seam（或放开 provider 槽位），届时应按 `capability-strategy.md` §2/§4 以新 feature 评估条件 R（`@deepseek-ai/dsh-host-apiproxy` 的 apiProxy 行或 `dsh-user-questions`）——本线只登记该评估入口与触发条件，不预先批准也不替换任何官方行。
2. **selection submit seam**：基线为 `services.apiProxy` 审计白名单扩展（A 类，论证见 Model Selection Snapshot Contract）。若 probe 证明 submit 成员在当前 runtime 仅 mux 帧可达（不可作为 service 方法服务），条件 R 点位同为 dsh-host-apiproxy 的 apiProxy 行（唯一 owner、完整契约复刻、完整 client 半面），或退为 C 类诚实 unavailable 基线。
3. **session 生命周期 seam**：create/history/search 均有可达官方 seams（passthrough/projections/sessionQuery）。若 probe 证明某具体行为缺 dispatch 点，条件 R 点位是该行为所属官方组件行的唯一 owner 切片，同样受上述全套规则约束。
4. 既有 agent-loop 切片（M9）仍是 Face 1 唯一 R 消费面，本线不扩展其边界。横切派发语义（priority/deepFreeze/fault containment）永不进任何切片。

各条陈述均为"评估入口"而非批准：任何 R 落地必须走独立确认流程并同步 `capability-strategy.md` §5 装配表、AGENTS.md §2/§4 与 feature-list §3.1。

## Failure Paths And Guard Strategies

- **apply 安全**：两个新 authority 均为纯 facade，挂主包 ctx 生命周期；初始化失败 ⇒ 有界诊断 + 该面 typed unavailable，绝不抛穿 apply；无新 replacement 行 ⇒ 无新 patch 自检义务，既有 carriers 自检沿用。
- **失败呈现分层**：P1/P2 统一错误沿用；面级 degraded/unavailable view；业务冲突（conflict/stale/rejected/denied/duplicate/already-running）一律 typed result，不伪装 boot 失败。
- **授权失败**：typed denied + 有界原因；不泄露其他 session/interaction 存在性。
- **逐动作授权（Stage 3 探针修订）**：request（含 steer/queue）、respond、selection.set 的授权沿各自**实际穿越的边界**记账：host 调用方按已交付 owner 归属（caller fiber）；运输层动作沿与 M9 `sessions.request`/`cancel` **同一条已交付 carrier 边界**（同路由、同 transport 信任分类），本线**不新增凭据系统、不接受调用方自报 grant**。已交付 channel auth 的 verifier/authorizer/pairing 只作用于 channel 自身受控方法（其注册表与受控分发不对外暴露），**不能**被本线新面复用；因此 **per-session grant 的缺席如实登记为能力缺口**（与 question 侧缺口**并列登记、互不指代**；触发条件见 requirements R8 同步注与本文 Stage 3 探针修订第 8 条），连接可达不写成「已按 session 授权」，pairing 凭据只建立 device 身份；loopback/trusted-host 边界由 connection owner 原样维持，本线不改写。
- **stale 纪律**：旧 generation/epoch 的 handle、observer、respond、queued-reference 取消全部 typed stale/no-op；不写入新代。
- **脱敏**：受限视图 summary/answerShape、respond audit、client 负载逐出口脱敏；secret/owner-private/diagnostic 不出任何出口；host 脱敏失败 ⇒ fail-closed 不发未脱敏负载。
- **可用性诚实**：官方 pending source / selection seam / inbox 边界 / channel 不可达 ⇒ 对应面 typed degraded/unavailable；空列表不冒充健康"无待办"；无关面隔离不受连带。
- **watch 租约与结算闭集（Stage 3 探针修订 + 审查更正）**：兜底 answerer 只在目标 session 有活跃 watch 租约时持有请求；租约由 `interactions.list`/`get` 刷新（默认 60s 有界，注入 now/timer 可测）。持有的 pending **只允许三类且仅三类结算**：显式 `respond`（→ 官方 outcome 闭集）、`req.signal` abort（→ `'cancelled'`）、租约到期（→ `'unavailable'`，等于官方「无 answerer」时的 fail-closed 默认值，随后由官方 authority 自行 append `approval/decided`）。**不产生任何 approve/reject 类答复**，无重试、无默认答案。无客户端部署不因本线改变官方默认 `'unavailable'` 行为。
- **共享 id 注册表（审查更正）**：`(sessionId, officialApprovalId) → facade id` 的有界内存映射由视图与持有两侧共用，保证同一 approval 在 `list`/`get` 与 `respond` 中得到同一公共 id；`approval/decided` 出现或持有结算即清除；不 durable、有容量上界。持有项的 `approvalId` 由与官方 answerer 同一算法的日志回扫（按 `callId`）推导，推导不出则不持有。
- **selection seam 降级阶梯**：`services.apiProxy` 白名单扩展成员不可服务 ⇒ Face 4 get/set typed unavailable（availability 如实报告），按 R-Point 2 走条件 R（apiProxy 行）或 C 类诚实 unavailable 基线；候选查询与无关面隔离不受连带。
- **audit**：respond/request 侧 bounded 内存诊断（owner、id、action、时间、outcome），无 payload、无 secret；写失败 ⇒ gap marker，不伪造记录（沿用 M9 Req10 形状）。

## Concurrency And Cancellation Declarations

| 面 | 策略 | scope | 提交资格 | 取消 |
|---|---|---|---|---|
| Face 1 | exclusive per session（缺省）+ 声明式 steer/queue 交付（官方 inbox 承载） | session | authority 提交点原子裁决（M9 不变） | signal ≠ terminal；queued 项官方 discard，认领后走活 operation cancel |
| Face 2 respond | coordinated per interaction id（第一提交者获胜） | interaction | pending 且官方未决（授权按「逐动作授权」条的实际边界记账） | signal 取消在途提交；已接受不可撤回（官方裁决） |
| Face 3 | 只读消费；channel lease/fencing 按既有合同 | session | 不适用（无共享写入） | dispose/ack 按合同；旧 epoch 回调 stale |
| Face 4 | 值级 compare-and-set（`expected` 快照）+ owner-local revision（仅 facade 介入写者） | session | `expected` 与官方当前值匹配 + 官方 seam 接受；官方 seam 为 last-write-wins，比对与提交窗口内的竞态按官方语义（残余竞态已声明） | signal 取消提交尝试，不伪造终态 |

## Data Models

```js
// 请求 spec 扩展（Face 1；未列字段沿用 M9）
message: { kind: 'user-message', text, attachmentRefs?: ImageAttachmentRef[] }
delivery?: 'steer' | 'queue'          // 缺省 = M9 already-running 行为；经 agent.steer / agent.followup 交付

// steer/queue 受理结果（accepted outcome 扩展；steer 沿用 M9 的 operation 字段）
{ ok: true, code: 'accepted', delivery: 'steer',
  operation: { id } }                  // steer：并入的活 operation（M9 既有字段形状）
{ ok: true, code: 'accepted', delivery: 'queue',
  queuedRef: { id, operationId } }     // queue：message id + 交付时活 operation 身份（可为 null）

// 待处理交互受限视图（Face 2）
{ id, kind: 'approval' | 'question', sessionId, summary, createdAt, answerShape }

// respond 调用与结果（Face 2）
{ id, action: 'approve' | 'reject' | 'answer' | 'cancel', answer?, reason?, signal? }
→ { ok, code: 'accepted' | 'stale' | 'rejected' | 'denied' | 'unavailable', reason? }

// 选择视图与提交（Face 4）
{ sessionId, provider, model, effort, revision, source, committedAt, observedAt }
//   source: 'committed' | 'fallback-deployment-default' | 'fallback-logged-request-config' | 'unknown'
{ sessionId, selection: { provider?, model?, effort? }, expected?: { provider?, model?, effort? }, signal? }
→ { ok: true, code: 'committed', revision } | { ok: false, code: 'conflict' | 'rejected' | 'unavailable', reason? }
```

## Hook Exposure And Component Ownership

| 钩子/源 | 类别 | 引出方式 | 失败路径与 guard |
|---|---|---|---|
| session 生命周期（create/list/history/search/open） | A | 既有 passthrough/projections/operations 直消费（复用矩阵） | 缺面 ⇒ typed unavailable，不建平行平台 |
| 发送/取消/steer/queue | B | 已交付 request authority 扩展 + 官方 inbox seams + M9 切片事实消费 | inbox 不可达 ⇒ typed unavailable；无 append-guess 回退 |
| attachmentRefs 映射 | B | durable 适配层合同，解析走 `services.attachments`（A seam） | ref 不可解析 ⇒ fail-closed 逐 ref 原因 |
| 候选模型查询 | A | `services.llm`/`llm.routing.candidates`/client `modelDirectories`/`agentPresets` | 缺 service ⇒ typed unavailable |
| 模型/effort 变更 | A+B | selection authority wrap 官方 selection seam（经 `services.apiProxy` 审计白名单扩展成员，§6 分级 + bypass 登记） | 成员不可服务 ⇒ typed unavailable（条件 R/C 回退）；值级 CAS 冲突 typed conflict |
| pending 交互视图 | B | interactions authority 投影官方 approval 事件与状态；question 侧来源见 R-Point 1 条件探针 | 官方源降级 ⇒ typed degraded/unavailable，空 ≠ 健康；question seam 未证实 ⇒ 该侧 typed unavailable |
| 应答/拒绝/取消 | B | respond operation 经**兜底 `approval/request` answerer**（append 注册；官方 mux answerer 在场时不进入）把显式调用方的选择交回官方 outcome 闭集 | 未持有/不可达 ⇒ typed unavailable；不代答、无重试、无默认答案 |
| 事件基线/增量/重连 | A | 已交付 channels owners（消费合同） | gap ⇒ typed resync；capability 失配 ⇒ degraded/isolated |
| attention 呈现 | A | 既有 attention hub 原样 | 不动 |

## Testing Strategy

1. 生命周期复用：无官方业务 API 依赖的交互测试客户端走通 create→list→history/search→open/restore（Requirement 1/10 AC1）；缺面行为 typed unavailable 断言。
2. 附件贯通：带 refs 请求在真实 durable 边界落成 content blocks（与 pipeline 投影同源）；不可解析 ref fail-closed 逐 ref 原因；UI/model 两侧同 refs（Requirement 2/7/10 AC5）。
3. steer/queue：活 operation 下 steer 并入本步、queue 入官方 inbox，pending 状态经官方 `agent/inbox/spliced` durable 记录与 `inserted`/`claimed`/`discarded` 派发通知、activity 投影可观测；queued reference 取消（认领前 discard / 认领后活取消）；缺省 already-running 不回归；单一逻辑消息双写探针（splice 是否要求先经 durable append，见 Face 1 口径）（Requirement 2）。
4. 选择快照：committed 选择被本步 route 与 prompt 快照同值消费（与 scoped 线共同证据）；`expected` 值级 CAS 冲突（含模拟经官方路径的外部写）；官方持久化成功分支恢复无漂移、失败分支视图 `source`/`observedAt` 降级披露；白名单成员可服务性双态（可服务 → committed 路径；不可服务 → typed unavailable）（Requirement 3）。
5. 受限视图与应答：approval/question 视图形状与脱敏断言；匹配应答第一提交者获胜、第二 stale；形状不匹配 rejected；官方源降级视图；不代答（无任何自动应答路径）（Requirement 4/5）。
6. 流与重连：基线→增量→断线 resume→gap resync 全链；事件身份关联来自共享事实；两客户端并发/旧答复/旧 owner/旧 epoch（Requirement 6/10 AC2）。
7. 授权分立：断言**可产出**的 device/session 拒绝码（channel 受控面）与「可达 ≠ 授权」的记账纪律（新面沿实际边界、不宣称 per-session grant、不泄漏存在性）；pairing 不成全局授权；`pairing-required` 与 per-session grant 的缺席按能力缺口登记（Requirement 8）。
8. client 半面：同形 typed 结果、offline/rebind unavailable、stale 守卫、host 脱敏先行；availability 对空对象/缺失 carrier 如实报告（Requirement 9）。
9. 互操作：官方 browser 插件与独立客户端同 session pending 集与状态一致（脱敏包络内）（Requirement 10 AC3）。
10. 终验：受护 `npm test`、`git diff --check`、registry/surface 一致性、官方包零修改审计、全局对抗性终审；证据不足即保持 typed unavailable。

## Standards Applicability And Alignment

- `capability-strategy.md`: applicable。行为逐条 A/B 落点；R 判定逐条引用 §2/§4（基线无新 R，条件点位仅陈述且须走完整 R1–R8）；client 半面 §10 六问逐载体记录；services 分级：`services.apiProxy` 按 §6 审计扩展 selection read/submit 成员（read=pure；submit=advanced、不入 Composable Profile、`bypasses` 登记 Face 4 为协调写路径），其余成员集不变；公共面减法不适用（本线为加性扩展，无删除）。
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
4. **respond 走官方 answer entry**：不管理官方私有 registry；answer entry/pending registry 归属 dsh-host-apiproxy（审查更正后归属）；代价是受限视图必须与官方 pending 源严格同步（映射随官方事件清除），收益是决策权不旁路。
5. **selection seam 选 A 类白名单扩展**：扩 `services.apiProxy` 审计白名单承接官方 selection read/submit（唯一可达且无需 mux 帧的官方入口，论证见 Snapshot Contract）；代价是 submit 成员须按 §6 以 advanced 分级 + bypass 声明闭合 authority closure，收益是保持基线无 R 且消费者不解 mux 帧；probe 失败时的条件 R（apiProxy 行）/C 类 unavailable 回退阶梯如实声明，不掩盖降级后果。
6. **interaction 映射不 durable**：生命周期完全跟随官方 pending 源，facade 重启后从官方状态重建映射；代价是官方源降级时视图同步降级（typed），收益是零第二状态机。
7. **无新 R**：全部行为有可达官方 seams（含上述白名单扩展）或已交付 owner 承载；条件 R 点位仅留评估入口，避免"为激进而替换"。

## Design Completion Condition

本设计覆盖 Requirements 全部条目（Requirement 1–10 与 client 半面判定节）：四面 owner 划分与成员形状、复用矩阵逐项判定、协议等价判据、attachmentRefs 映射合同、选择快照合同、M9 扩展消费方式、R 点位陈述、失败/guard、并发声明与 standards 逐分册结论成文。Tasks 经对抗性审查后进入实现；用户侧修订就地更新本文与 requirements 对应条目。

## Stage 3 探针修订（2026-09-14）

Tasks 阶段的源码级探针（P1–P15）与本设计成文时的事实有 8 处差异，正文已就地修订，此处汇总登记：

1. **R-Point 1 收敛（Face 2 视图/应答来源）**：`approval/request` 不是 durable 事件而是 answerer waterfall；durable 对为 `approval/asked`/`approval/decided`。approval 视图经 durable 折叠可达；应答经门面 **append 注册的兜底 answerer**（绝不 `prepend`；官方 mux answerer 在场时不进入，且以 watch 租约为前提）承载；question 侧无 durable 痕迹且单 provider 槽位被官方占用 ⇒ 本 runtime 诚实 typed unavailable。本线不落地 R 点位，只登记 question 侧的评估入口与触发条件。
2. **Face 1 的 attachmentRefs 形状**：由 `string[]` 改为官方 durable 图像引用对象数组 `ImageAttachmentRef[]`（`{attachmentId, mediaType, bytes, width, height, name?}`）；裸 id 字符串属形状违规。durable 块形状固定为 `{type:'image', attachment:<canonical ref>}`（与官方 `durablePromptContent()`/`imageBlockIn()` 同形），验证经 `attachments.readImage()`，任一 ref 不可解析即整条 fail-closed。
3. **Face 1 的 delivery 落点**：`steer` 经官方 `agent.steer(message)` 并入最近 step，`queue` 经官方 `agent.followup(message)` 入 `next-turn`；queuedRef 的 `id` 即 durable inbox 项身份，取消经官方公开 `agent.inbox.remove(messageId)`（返回是否仍在 pending）；**已认领时仅当 queuedRef 记录的 `operationId` 仍等于当前 live operation 才转既有活取消路径，否则 typed `stale`**（避免按 sessionId 误取消后续无关 operation）。
4. **Face 2 视图形状**：冻结视图增加逐 kind `sources`（`active|degraded|unavailable`），使 R4 AC3「空列表不冒充健康」可判定；受限视图 `answerShape` 为公共可回答形状（approval：`{actions:['approve','reject','cancel']}`）。
5. **Face 4 白名单成员形状与 source 推断**：白名单承接方式由「扩 selection read/submit 两个成员」细化为**两条按路径声明的窄成员**（`apiProxy.sessionsModels`/`sessionsSelectModel`），**两条均为 `optional`**（缺成员不得连带停用既有 `downloads`/`respond`），不暴露 `sessions` 整对象；`source` 由可观察兜底层分级推断（见 Model Selection Snapshot Contract），取值重合时的保守归因登记为残余歧义；`committedAt` 只在门面确有提交证据时给出，否则 `null`。
6. **兜底 answerer 的注册顺序前提（审查更正）**：Cordis `ctx.on` **没有 priority 机制**（只有 `prepend`/`global`，顺序=注册顺序），故「最低优先级」的表述不成立；机制实为 **append 注册 + row 顺序前提**（受支持安装路径下 plugin-api 行排在官方 api-proxy 行之后）。同时如实披露：本线持有期间会 preempt **之后**才注册的第三方 answerer。
7. **Face 4 读取路径的官方副作用（审查更正）**：`selection.get` 经 `session.models` 解析 session，**冷 session 会被官方 `agentFor` resume 并发布 live agent**——这是官方读取入口自身的契约（与官方 UI 同路径），不是门面发明；按 idiom 例外登记并在 availability/README 披露，测试断言该副作用来自官方载体。
8. **逐动作授权边界与能力缺口（审查更正）**：见 Failure Paths 的「逐动作授权（Stage 3 探针修订）」条。**per-session grant 的缺席独立登记为能力缺口**（评估触发条件：官方或后续 feature 提供可达的 per-session 授权 seam；届时按新 feature 立线，不在本线内发明凭据系统，也不接受调用方自报 grant）——该缺口与 question seam（R-Point 1）是**两个独立的评估入口**，不要互相指代。

## Stage 4 运行结论（2026-09-14）

- **Face 1（扩展）**：`attachmentRefs` 为官方 durable 图像引用对象数组，逐 ref 经 `attachments.readImage()` 验证并以 canonical ref 映射为 `{type:'image', attachment}` 块（文本块在前、一对一保序）；任一 ref 不可解析 ⇒ 整条 typed unavailable 且无写入（逐 ref 有界原因）。`delivery: 'steer'|'queue'` 只在同 session 有活 operation 时生效：steer 经官方 `agent.steer` 并入活 attempt 且沿用 M9 的 `operation.id` 形状，queue 经官方 `agent.followup` 入 `next-turn` 并返回 `queuedRef:{id, operationId}`；queuedRef 取消经官方 `agent.inbox.remove(id)`，已认领且 operationId 不再匹配 ⇒ typed `stale`（不误取消后续无关 operation）。缺省 `already-running` 行为逐字不变。
- **Face 2（视图 + 兜底应答）**：pending 集从 durable 对折叠；视图含逐 kind `sources`；`respond` 只结算**本线持有**的请求（三类结算：显式动作 / abort → `cancelled` / 租约到期 → `unavailable`），未持有的同 pending 项返回 `unavailable`（不冒充 `stale`），未知 id 返回 `stale`；`answer` 对 approval 一律 `rejected`；自由答复、重试、默认答案、定时器一律不存在。门面持有期间视图仍报告该项（客户端必须看得见才能应答），`deriveApprovalId` 用 claimed 集消歧。
- **Face 3（消费合同）**：`test/interactive-session-consumption.test.mjs` 以已交付 channels/auth/operation 面取证（baseline 视图、typed 拒绝、device/session 拒绝码、可达 ≠ 授权、stale 纪律），零新增代码。
- **Face 4（选择）**：读/提交经两条可选窄白名单成员；`source` 按可观察兜底层分级、`committedAt` 无证据即 `null`；值级比较换不匹配不触提交；官方 `model-unavailable` → `rejected`、`session-not-found` → `unavailable`；持久化失败不改变 commit 结果（由后续 `source` 披露）；冷 session 读取带官方 resume 副作用（availability/README 披露）。
- **真实证据边界**：审批链在真实 `dsh-user-approval` + 真实 `dsh-session` 上取得（含真实 durable 对与 outcome 闭集）；附件映射在真实 durable append 上取得；选择在官方 mux 形状替身上取得（形状来自 P3/P4 探针）；question 侧与 per-session grant 为登记的能力缺口。
