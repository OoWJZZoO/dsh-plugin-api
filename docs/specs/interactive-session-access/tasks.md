# Stage 3 - Tasks

> feature_name: `interactive-session-access`
> milestone: M10
> status: Stage 3（Tasks）产出中（2026-09-14）；Stage 1/2 已交付（2026-09-12），本阶段以对抗性审查为门（AGENTS.md §3.2），通过后直接进入 Stage 4。审查记录见文末（第一轮处置 21 条，第二轮处置 6 条，第三轮处置 4 条）。
> 输入溯源：`goal.md`（Stage 0）、`requirements.md`（R1–R10 + client 半面判定 + 复用矩阵）、`design.md`（四面拆线、复用矩阵、协议等价判据、attachmentRefs 映射合同、选择快照合同、R-Point 陈述、失败/guard、并发声明、standards 逐分册）；Stage 3 源码级探针见下（P1–P15）。
> 执行口径：版本冻结基线内交付（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`），不步进任何版本字段。**本线基线不新增 R 包/R 行**，也不落地 design R-Point 1：question 侧无可用 seam，approval 侧由 append 注册的兜底 answerer 承载（见 P6 与探针修订 4）。

## Stage 3 探针记录（源码级事实，Stage 4 以行为测试复核）

- **P1 附件事实源**（`@deepseek-ai/dsh-attachment@0.1.0-rc.6`）：`ctx.attachments` 是 `AttachmentStore`（抽象 `Service`），成员恰为 `imageLimits`（getter）、`validateImage(input)`、`saveImage(input)`、`readImage(ref, signal)`；`ImageAttachmentRef = { attachmentId, mediaType: 'image/png'|'image/jpeg'|'image/webp'|'image/gif', bytes, width, height, name? }`，`StoredImageAttachment = { ref, data }`。**durable 图像内容块形状 = `{ type: 'image', attachment: <ImageAttachmentRef> }`**：官方 `dsh-host-apiproxy` 的 `imageBlockIn`/`collectImageRefs`/`referencedImage` 与 `session.attachment` 处理器都按这一形状读写，`durablePromptContent()` 也把线上 image part 存成 `attachments.saveImage()` 的 ref 后生成同一形状。附件词表是**图像专用**（无通用文件附件 seam）：`attachmentRefs` 只能是图像引用。
- **P2 门面 services 白名单机制**（本仓库）：`lib/official-service-definitions.js` 的 `definitions` 数组按 `{ key, ctxService, members: [{ kind: 'getter'|'method'|'forward', name, optional? }] }` 声明；`lib/services.js` 的 `buildActiveFacade()` 只暴露声明成员（未声明的成员一律不可见），**缺任一必需（非 `optional`）成员则整个服务面 disabled**。**当前 `apiProxy` 声明恰为 `downloads`(getter) + `respond`(method)**；registry `servicesWhitelist` 的 `apiProxy` 行是粗粒度描述（`members` 为字符串），validator 对该行只校验 key 唯一性与 `channel` 词表，故可承载逐成员分级字段。
- **P3 官方 ApiProxyService 服务面**（`@deepseek-ai/dsh-host-apiproxy@0.1.0-rc.6`，`ApiProxyService extends Service`，服务名 `apiProxy`）：实例成员为 `sessions`、`subagents`、`workspace`、`host`、`goals`、`skills`、`agentPresets`、`settings`、`credentials`、`llm`、`events`、`downloads`、`respond`（`this.sessions = api.sessions` 等）。`api.sessions.models(request)` / `api.sessions.selectModel(request)` 是**mux 形状**：入参 `{ rpcId, payload }`，返回 `{ rpcId, result: { ok: true, value } | { ok: false, error: { code, message, details } } }`（`ok()`/`err()` 构造）。per-session 当前选择是 apiproxy 私有 `WeakMap` + `selectionFor(agent).current`，读优先级=**本进程内存值 → 会话最近一条已记录 request/header 的 `config` → 部署默认**；写=内存赋值 + 尽力而为 `agentDefaultModel.saveSelection`（**存储失败只 `logger.warn`，本次 set 仍成功**）。
- **P4 官方 selectModel 校验与错误词表**：`resolveCallConfig({provider, model, reasoningEffort?})` 先规范化；随后若会话（inbox 或历史）含图像且目标模型 `inputModalities` 不含 image → `err({ code:'model-unavailable', details:{provider, model} })`；`resolveCallConfig` 抛错同样归为 `model-unavailable`；未知 session → `session-not-found`（`agentFor` 解析失败）。成功返回 `{ selected: { provider, model, reasoningEffort? } }`。`session.models` 返回 `{ current:{provider,model,reasoningEffort?}, routable, groups, failures }`，**不返回 `current` 来自哪一层，也不返回任何提交时间**。**持久化失败不改变本次 set 的成功结果**，只由后续 `source` 披露（与 P3 一致；`saveSelection` 的失败不进入错误映射）。
- **P5 待处理 approval 的可见事实与答案入口**：官方 `@deepseek-ai/dsh-user-approval@0.1.0-rc.6` 的 `ApprovalService.request(req)` 先 append durable `approval/asked`（`{ id, toolName, callId?, reason? }`，`id = ApprovalRequestId(randomUUID())`），再 `decide()`，最后 append `approval/decided`（`{ id, outcome }`）。**pending 集 = asked 减 decided**；官方 apiproxy 的 answerer 自己就是这么扫会话日志的（从尾部回扫、按 `callId` 匹配、跳过已 claimed/decided 的 id）。官方 mux 答案入口 `apiProxy.respond({ rpcId, result })` 需要 **apiproxy 广播时才铸造的 `rpcId`**（`pendingApprovals` 的键，`RpcId(randomUUID())`），门面无法获得；answer payload 词表：approval `{ sessionId, approvalId, outcome:'allowed-once'|'rejected' }`（`result.ok:false` 对 approval 一律 `{accepted:false, reason:'bad-response'}`），question `{ sessionId, answer:{ answers:[{id, selected, custom?}] } }`（`result.ok:false` + `error.code:'cancelled'` 仅 question 分支存在，映射为 `{accepted:true}`）；respond 返回 `{ accepted:true } | { accepted:false, reason:'bad-response'|'not-pending' }`。
- **P6 approval 决策接缝（本线答案入口）**：`ApprovalService.decide()` 派发 `ctx.waterfall(scopeTarget(this, req.agent), 'approval/request', req, () => Promise.resolve('unavailable'))`；**谁先认领谁终止链**（监听器返回非 `next()` 值即停止），默认值 `'unavailable'`；outcome 闭集 `allowed-once`/`rejected`/`cancelled`/`unavailable`。apiproxy 在 web profile 注册一个 answerer（认领时铸造 rpcId 并广播）。**Cordis 事件没有 priority 机制**（`ctx.on` 只支持 `prepend`/`global`，监听器顺序 = 注册顺序，push/unshift），故本线的「兜底」只能表达为**以 append 方式注册（绝不 `prepend`）+ 依赖 row 顺序前提**：plugin-api 行在受支持安装路径下排在官方 `dsh-web-app` 的 api-proxy 行之后（bundle patch/`dsh plugin add` 均追加到行表尾），因此官方 answerer 先注册、先认领。该前提与「本线持有期间会 preempt 之后才注册的第三方 answerer」的语义按要求披露（Task 4.1/8.5）。
- **P7 question 侧接缝**：`ctx.userQuestions` 只有 `registerProvider`（单 provider，第二次注册抛 `DUPLICATE_PROVIDER`）与 `ask()`；官方 apiproxy 在 web profile 已占用该 provider。门面注册第二 provider 会让官方行 boot 失败（不可接受），且 question 没有 durable pending 痕迹。⇒ **question 侧视图与应答在本 runtime 诚实 typed unavailable**（design R-Point 1 的收敛结论：seam 未证实，不伪造列表、不抢占 provider）。
- **P8 inbox 交付与排队引用**（`@deepseek-ai/dsh-agent`）：`agent.followup(message)` = 入 `next-turn` 队列并唤醒 driver（每条成为独立 turn 的唯一普通消息）；`agent.steer(message)` = 提交到最近 step（idle 则开 turn，运行中在下一个 step 边界被消费）；`createUserMessage({ content, source })` 生成 `{ id, role:'user', content, source }`。`agent.inbox` 公开可读 `nextTurn`/`nextStep`/`hasPending`，并有公开**删除**成员 `remove(messageId) → boolean`（"Remove one pending message and durably record its cancellation"，返回是否仍在 pending；claimed 之后返回 false），durable 记录类型 `agent/inbox/spliced`（官方 `inserted`/`claimed`/`discarded` 为派发通知，`claimed` 非 durable）。**queuedRef 的 id 即 `createUserMessage` 铸的 message id**（`Inbox.locate/remove` 与官方 `session.updateQueue` 同一 id），无需另映射。
- **P9 live agent 解析**：官方 `agents.get(id)` 返回该 id（session id）的 live agent（registry `store.get(id)?.agent`）；门面既有 `agents` 域消费同一成员（workflow 线的 parent 校验已用）。delivery 需要 live agent 本体才能调 `steer`/`followup`/`inbox.remove`。
- **P10 durable append 合同**（本仓库 `lib/session-durable-feature.js`）：`appendMessage(session, kind, payload, opts)` 对 `user/message` 要求**精确记录** `{ id, role:'user', content, source }`（`content` 为块数组、`source` 为含非空 `source.kind` 的对象），且 `user/message` **禁止** `sourceEventSeqs`；当前门面适配器 `toSurfaceMessage()`（`lib/session-interaction-operation.js`）在 `attachmentRefs` 非空时 fail-closed（reason `attachment content blocks are not mapped to a durable message yet`）——本线要兑现的缺口。
- **P11 M9 request authority 的扩展点**（`lib/session-interaction-operation-authority.js`）：`request(spec, callerCtx)` 的顺序为 校验 → sessionExists → dedupe(idempotencyKey) → **同 session live operation 冲突（当前直接返回 `already-running`）** → 解析 loop boundary → `admit` → durable append（失败回滚 admission）→ 建立 operation/attempt。`delivery` 的落点在第 4 步；attachmentRefs 的落点在 durable append 的映射层（`toSurfaceMessage`）。取消路径 `cancel(queuedRef)` 的落点在权威的 cancel 分支（当前只接受已铸 operation 引用）；已交付 cancel 以 `{sessionId}` 解析**当前** live operation，故 queuedRef 必须自带交付时的 operation 身份才能避免误取消后续无关 operation（Task 2.5）。
- **P12 Face 3 的既有载体现状**（无需新代码）：`sessions.channels` 已交付 `open/acquire/handle/heartbeat/revoke/observe(onChange/subscribe)/fetchEvents/list/ack/resume` + `auth.registerVerifier/registerAuthorizer/registerPairingProvider/initiatePairing/approvePairing/rejectPairing` + 脱敏 profile；typed 码含 `device-denied`/`session-denied`/`pairing-required`/`cursor-gap`/`resync-required`；`sessions.activity` 提供 `current/get/history/availability` 与 `observed|reconstructed|unknown|unavailable` 关联分级；operation handle/status/observe 与 wire 均已交付。**本线 Face 3 是消费合同 + 证据，不新增成员、不新增通道、不新增事件。** 注意：`pairing-required` 只在词表内，已交付链路的 `denied()` 把非 `device-denied` 的拒绝归一为 `session-denied`，**当前无可产出点**（Task 6.4 只断言可产出码并登记该词表空缺）。
- **P13 白名单扩展的窄化实现**：定义成员的 `name` 是**单段名**（`facade[name] = (...args) => service[name](...)`），无法表达嵌套。为承接 Face 4 的两个官方 mux 成员，本线给定义格式加**可选 `path`（字符串数组）**，只声明两条窄成员 `sessionsModels` → `['sessions','models']`、`sessionsSelectModel` → `['sessions','selectModel']`，**两条都是 `optional: true`**（否则成员缺失会把 `downloads`/`respond` 一起打成 disabled，违反 R5 AC6）；**不暴露整个 `apiProxy.sessions` 对象**（那会把全部 mux 操作一次性放进白名单）。同步点不止两个定义测试：`test/official-service-definitions.test.mjs`、`test/services-definitions.test.mjs`、`test/official-passthrough-contracts.mjs`（apiProxy 成员表 fixture）、`test/integration-surface.test.mjs`（按扁平 `member.name` 造桩，需支持 `path`）、`test/index-services.test.mjs`（手写 apiProxy 桩）（Task 5.1/7.5）。
- **P14 Face 4 读取面的事实边界**（其 idiom 例外落点为 Task 5.6）：`session.models` 只返回 `current`（有效值），不返回它来自哪一层；`ctx.get('agentDefaultModel').currentSelection()`（部署默认）与 live session 的 `session.requestHeader()?.config`（最近已记录请求头）可读。⇒ `source` 用可观察证据分级推断：与 logged header config 相同 → `fallback-logged-request-config`；否则与部署默认相同 → `fallback-deployment-default`；否则 → `committed`（内存层是唯一剩余来源）；三者都取不到 → `unknown`。取值与兜底层重合时归因会偏保守（登记为残余歧义）。**读取路径的官方副作用**：`session.models` 经 `agentFor` 解析 session，冷 session 会被官方 resume（发布 live agent、派发 `agent/created`）——这是官方读取入口自身的契约，不是门面发明；按 idiom 例外登记并加断言（Task 8.4 承担载体断言）。
- **P15 授权分立的现状边界**（R8）：channel 的 verifier/authorizer/pairing 注册表与受控方法分发（`dispatchChannelMethod`）都**不对外暴露**（公开面只有 `register*`），且受控方法集 `CONTROLLED_METHODS` 是固定的 channel 方法表；client 请求路由以 `authority:'trusted-host'` 注册、handler 只有 `(endpoint, payload, signal)`，**没有调用者身份或 per-session grant 上下文**（`authority` 只是官方 connection 在 HTTP 层对 loopback/trusted-host 的分类）。⇒ **本线不发明授权系统**：host 侧调用方按已交付的 owner 归属（caller fiber）记账；运输层动作沿**本线新面实际穿越的同一条已交付 carrier 边界**（与 M9 `sessions.request`/`cancel` 同一路由与同一 transport 信任分类），不新增第二套凭据、不接受调用方自报 grant（composition-and-authority：身份不可由调用方伪造）。**per-session grant 的缺席如实登记为能力缺口**（与 question 侧同型：有 seam 才做，没有就不假装），评估触发条件=R8 的对齐条目。

## 探针结论对 Design/Requirements 的修订（随本阶段登记，Stage 4 回写正文）

1. **R-Point 1 收敛**：`approval/request` 是 answerer waterfall（非 durable 事件），durable 对为 `approval/asked` + `approval/decided`；mux 答案入口的 `rpcId` 门面不可达。approval **视图**经 durable 折叠可达；**应答**经门面 append 注册的兜底 answerer 承载（不遮蔽官方 mux answerer，但会 preempt 之后注册的第三方 answerer——按要求披露）；question 侧维持 typed unavailable。**本线不落地 R 点位。**
2. **Face 1 的 attachmentRefs 形状**：`string[]` → **`ImageAttachmentRef[]`**（官方 durable 引用对象）；裸 id 字符串属形状违规。durable 块固定为 `{type:'image', attachment:<canonical ref>}`。
3. **Face 2 视图形状**：增加逐 kind `sources`（`active|degraded|unavailable`）；`answerShape` 为公共可回答形状（approval：`{actions:['approve','reject','cancel']}`）。
4. **Face 2 的 arm/watch 语义**：兜底 answerer 只在目标 session 有活跃 watch 租约时持有（租约由 `interactions.list`/`get` 刷新，默认 60s 有界），否则 `next()`；租约过期以 `'unavailable'` 释放（等于官方无 answerer 的 fail-closed 默认），`req.signal` abort 以 `'cancelled'` 释放。
5. **Face 4 白名单成员形状**：两条按路径声明的**可选**窄成员，不暴露 `sessions` 整对象；`source` 由可观察兜底层分级推断；`committedAt` 只在门面确有提交证据时给出，否则 `null`（不用 `observedAt` 冒充）；读取路径的官方 resume 副作用按其 idiom 例外登记。
6. **逐动作授权（P15）**：不新增凭据/授权系统；host 调用方按 owner 归属记账，运输层动作沿本线新面实际穿越的**同一条已交付 carrier 边界**（与 M9 同路由、同 transport 信任分类），且**不把「连接可达」写成「已按 session 授权」**；per-session grant 的缺席如实登记为能力缺口（评估触发条件与 question 侧同型）。

## Task 1: Face 1 —— attachmentRefs durable 映射（对应 req R2 AC1–AC2、R7 AC1–AC4）

**产出**：`lib/session-interaction-operation.js`（映射层）+ `lib/session-interaction-operation-normalize.js`（请求形状）+ 单测 `test/session-interaction-operation-attachments.test.mjs`；同步既有 `test/session-interaction-operation-normalize.test.mjs`、`test/session-interaction-operation-durable-append.test.mjs`（旧 `string[]` 契约被对象数组契约取代）。

- [ ] 1.1 请求形状（P1/R2）：`message.attachmentRefs` 接受 **`ImageAttachmentRef[]`**：数组、每项为对象、`attachmentId` 非空字符串、`mediaType` 在官方四值内、`bytes`/`width`/`height` 为正安全整数、可选 `name` 为非空字符串；违反 → `invalid-input`（附逐字段原因，不触 durable、不触引擎）。冻结副本入请求值（调用方后续改动不影响已受理请求）。
- [ ] 1.2 逐 ref 解析与验证（P1/R2 AC1–AC2）：经注入的 `resolveAttachment(ref, signal)`（默认实现读 `ctx.get('attachments')` 的 `readImage`）验证每个 ref 仍可解析；**任一 ref 失败 ⇒ 整条请求 typed unavailable，reason 携带逐 ref 有界原因（`attachmentId` + 失败类），不追加部分消息、不以纯文本降级**。`attachments` 面不可达（服务缺失/成员缺失）⇒ 同样 typed unavailable。
- [ ] 1.3 durable 块映射（P1/P10/R7）：`toSurfaceMessage()` 产出 `content: [{type:'text', text}, {type:'image', attachment: <canonical ref>}…]`：一对一、保序、不合并、不重排；`attachment` 用**验证返回的 canonical ref**（`readImage().ref`），文本块在前；message `source` 仍为 `{ kind:'user' }`（source-audited durable 契约不变，无 `sourceEventSeqs`）。
- [ ] 1.4 fail-closed 与回滚（P11/R2 AC2）：映射/验证失败发生在 `admit` 之后时，按既有回滚路径取消 pending admission 并返回 typed unavailable；**不得**留下已受理但无内容的 operation。
- [ ] 1.5 单一逻辑消息（R2 AC4/design「单一逻辑消息口径」）：durable append 与 `delivery` 路径互斥（steer/queue 由官方 inbox 承载内容时门面不重复 append）；同一逻辑消息以请求铸制的 message/operation 身份判定，消费者按身份去重。
- [ ] 1.6 测试：形状矩阵（合法多 ref / 非法 mediaType / 非正 bytes / name 空串 / 裸 id 字符串 → `invalid-input`）；`readImage` 抛错 → typed unavailable 且无 durable 写入（逐 ref 原因可见）；`readImage` 被调用次数 = ref 数且保序；durable 消息精确记录形状（`isExactRecord` + 块顺序）；`attachmentRefs: []` 与 `undefined` 等价（纯文本路径零回归）；既有两个测试文件的旧契约断言同步改写（不得只删断言）。

## Task 2: Face 1 —— delivery（steer/queue）与排队取消（对应 req R2 AC3–AC6、R9 AC1）

**产出**：`lib/session-interaction-operation-authority.js`（live-operation 分支扩展）+ `lib/session-interaction-operation-normalize.js`（`delivery` 词表与结果形状）+ `lib/client-session-interaction-operation.js`（client 校验器接受 queue 受理形状）+ 重建 client bundle + 单测 `test/session-interaction-operation-delivery.test.mjs`。

- [ ] 2.1 `delivery` 词表（R2 AC3）：`delivery?: 'steer' | 'queue'`；缺省 = 已交付 `already-running` 行为**逐字不变**（回归用例锁定）；非法值 → `invalid-input`。
- [ ] 2.2 live agent 解析（P9/R2 AC6）：经注入的 `resolveLiveAgent(sessionId)`（默认读门面 `agents` 域的 live 引用）取 live agent；解析失败/非对象/缺 `steer`/`followup`/`inbox` 形状 ⇒ **typed unavailable，绝不 append-and-guess**。
- [ ] 2.3 steer 交付（P8/R2 AC3、R9 AC1）：附件 ref 同 Task 1.2 校验（fail-closed 不豁免）；`agent.steer(message)` 并入活 attempt；返回 `{ ok:true, code:'accepted', delivery:'steer', operation:{ id: <live operation id> } }`——**沿用 M9 的 `operation` 字段承载活 operation 引用**，client 校验器无需新形状；**不铸造第二个 operation**。
- [ ] 2.4 queue 交付（P8/R2 AC3、R9 AC1）：`agent.followup(message)` 入官方 `next-turn`；返回 `{ ok:true, code:'accepted', delivery:'queue', queuedRef:{ id, operationId } }`（`id` = message id，`operationId` = 交付时同 session 的活 operation 身份，可为 `null`）；**扩展 `lib/client-session-interaction-operation.js` 的 accepted 校验器**：`code:'accepted'` 且 `delivery:'queue'` 时要求 `queuedRef.id` 为字符串（否则 malformed），`delivery` 缺省/`'steer'` 仍要求 `operation.id`；随之重建 client bundle 并同步其测试。
- [ ] 2.5 排队取消（P8/P11/R2 AC5）：`sessions.cancel({ sessionId, queuedRef })` → `agent.inbox.remove(id)`：`true` ⇒ `{ ok:true, code:'accepted', scope:'queue' }`（官方 durable `agent/inbox/spliced` 记 `outcome:'canceled'`）；`false` ⇒ 已被 loop 认领 ⇒ 仅当 `queuedRef.operationId` **仍等于当前 live operation** 时走既有活取消路径，否则返回 typed `stale`（**不得**按 sessionId 误取消后续无关 operation）；queuedRef 形状不符/未知 ⇒ `stale`/`invalid-input`。
- [ ] 2.6 状态可观测（R2 AC4）：交付状态只经官方 `agent/inbox/spliced` durable 记录、`inserted`/`claimed`/`discarded` 派发通知与共享 `sessions.activity` 投影呈现；门面**不维护第二套队列状态机**（不新增 store、不新增事件名）。
- [ ] 2.7 测试：缺省 `already-running` 回归；steer 到达活 attempt（fake agent 记录 `steer` 调用与消息身份）且结果为 M9 形状的 `operation.id`；queue 到达 `next-turn` 且 queuedRef 可取回；未认领取消成功；已认领但 operationId 已变 ⇒ `stale`（不误取消）；已认领且仍为同一 operation ⇒ 走活取消并裁决终态；agent 形状不符 → typed unavailable 且无 append；`delivery` + attachmentRefs 组合（附件经 inbox 承载时内容块保真、ref 不可解析即 fail-closed）；队列/steer 不产生第二个 operation 身份；client 校验器对三种 accepted 形状的接受/拒绝矩阵。

## Task 3: Face 2 —— pending 交互受限视图（对应 req R4）

**产出**：`lib/sessions-interactions.js`（纯函数核心：pending 折叠、视图铸造、共享有界 id 注册表）+ `lib/sessions-interactions-facade.js`（挂载）+ 单测。

- [ ] 3.1 pending 折叠（P5/R4 AC2）：从**会话日志**折叠 `approval/asked` 减 `approval/decided`（复刻官方 answerer 的同一 id 匹配规则：尾部回扫、先收集 `decided`、同 id 即已决、按 `callId` 关联请求）；不做第二套生命周期状态机——已决/撤回项自然消失。
- [ ] 3.2 共享 id 注册表（审查意见 6）：`(sessionId, officialApprovalId) → facade id` 的有界内存注册表（容量上界 + 逐出策略；不 durable），**视图与兜底持有两侧共用同一注册表**，保证同一 approval 在 `list`/`get` 与 `respond` 中得到同一 id；`approval/decided` 出现或持有结算即清除；`id` 为门面铸造公共身份（不泄漏官方 registry id、不与 event seq 混用）。
- [ ] 3.3 受限视图（R4 AC1）：`{ id, kind:'approval'|'question', sessionId, summary, createdAt, answerShape }`，`summary` 有界脱敏（工具名 + 有界 reason，去 secret/路径/载荷），`answerShape` = `{ actions:['approve','reject','cancel'] }`，`createdAt` 取 `approval/asked` 的事件时间（非门面观察时间）。
- [ ] 3.4 逐 kind 来源状态（R4 AC3/探针修订 3）：视图携带 `sources: { approval, question }`（`active|degraded|unavailable`）；question 恒 `unavailable`（P7）；会话日志不可达/脱敏失败 ⇒ 不返回健康空列表，返回 typed degraded/unavailable。
- [ ] 3.5 成员形状（design Face 2、R8 AC4/P15）：`sessions.interactions.list({ sessionId?, cursor? })` → 冻结 `{ items, nextCursor, sources }`；`get({ id })` → 冻结单视图 | typed `missing`/`unavailable`；`availability()` → 冻结状态、永不抛错；**授权按 P15 的边界记账**：host 侧按 owner 归属过滤可见范围、运输层沿已交付 carrier 边界，**不伪造 per-session grant 判定**，也不因未授权泄漏其它 session 存在性；游标为门面自有有界游标（不冒充 event seq）。
- [ ] 3.6 测试：asked/decided 折叠矩阵（无 decided / 有 decided 同行 / 多 session 过滤 / 乱序事件 / 同 callId 多次 asked）；视图冻结与字段有界；`summary` 脱敏（含疑似 secret/路径的 reason 被裁剪）；question 恒 unavailable 且不被空列表冒充；日志源不可达 → typed degraded；游标翻页稳定；**未获授权时不泄漏其它 session 的存在性**（按 P15 边界记账，不伪造 grant 判定）；同一 approval 在 list 与 respond 前得到同一 id（与 Task 4 共用断言）。

## Task 4: Face 2 —— 兜底 answerer 与 respond（对应 req R5）

**产出**：`lib/sessions-interactions-authority.js`（pending 持有、watch 租约、respond 裁决、审计环）+ facade 接线 + 单测。

- [ ] 4.1 兜底 answerer（P6/探针修订 4）：以 **append 方式**（`ctx.on`，绝不 `prepend`）注册 `approval/request` 监听；**披露并断言顺序前提**：受支持安装路径下 plugin-api 行排在官方 api-proxy 行之后，故官方 answerer 先认领；同时披露「本线持有期间会 preempt 之后才注册的第三方 answerer」。仅在目标 session 有活跃 watch 租约时持有请求，否则 `next()`；持有项经共享 id 注册表（Task 3.2）关联 facade id ↔ `{sessionId, approvalId, resolve}`；**approvalId 由与官方同一算法的日志回扫（按 `callId`）推导**，推导不出则不持有（`next()`）。
- [ ] 4.2 watch 租约（探针修订 4）：`interactions.list`/`get` 按被报告的 session 刷新租约（默认 60s，注入 `now`/`timer` 可测）；**三类且仅三类结算**：显式 `respond`、`req.signal` abort（→ `'cancelled'`）、租约到期（→ `'unavailable'`，等于官方无 answerer 的 fail-closed 默认，官方随后自行 append `approval/decided`）；不产生任何 approve/reject 类答复。
- [ ] 4.3 respond 操作（R5 AC1–AC3）：`respond({ id, action, answer?, reason?, signal? })`，action 词表与 requirements 对齐为 `approve | reject | answer | cancel`：approval 接受 `approve | reject | cancel`（映射官方 outcome `allowed-once` / `rejected` / `cancelled`），`answer` 对 approval kind ⇒ `rejected`；**恰好一次**结算（同步认领，第二次 ⇒ `stale`）；返回冻结 `{ ok, code:'accepted'|'stale'|'rejected'|'denied'|'unavailable', reason? }`。
- [ ] 4.4 不可达与未持有（R5 AC1/AC2/AC6）：question kind 的 id ⇒ `unavailable`（P7）；**门面可见为 pending 但当前未被本线持有**（无租约 / 官方 answerer 已认领 / 官方未注册本线监听）⇒ `unavailable`（附有界原因，不冒充 `stale`）；既不可见也未曾持有 ⇒ `stale`；官方 authority 结算抛错 ⇒ `unavailable` + 有界诊断（不吞成成功）。
- [ ] 4.5 不代答与审计（R5 AC4/AC5）：**只**在 Task 4.2 的三类结算下推进；无自动答复、无重试、无默认答案、无自由答复转发；bounded 审计环记录 `{owner, interactionId, action, at, outcome}`，**不含 answer 载荷与 secret**；写失败 ⇒ gap marker，不伪造记录。
- [ ] 4.6 测试：持有→respond 结算（三种 action 对应官方 outcome）；第二提交者 `stale`；无租约时不持有（`next()` 被调用、官方默认生效）；租约内多次 `list` 续租保持 pending；租约到期 → `unavailable` 结算；abort → `cancelled` 结算；question id → `unavailable`；自由 `answer` → `rejected`；可见但未持有 → `unavailable`；**可达不被写成已授权**（断言结果/审计里没有任何「已按 session 授权」的宣称，授权只按 P15 边界记账）；审计环无载荷（逐字段断言）；`prepend` 未被使用 + 官方 answerer 先注册时不进入持有（与 Task 8.5 共用用例）。

## Task 5: Face 4 —— selection get/set 与白名单扩展（对应 req R3）

**产出**：`lib/sessions-selection.js`（核心：source 推断、CAS 比对、结果映射）+ `lib/sessions-selection-facade.js`（挂载）+ `lib/official-service-definitions.js`（两条可选窄成员 + `path` 支持）+ 相关桩/定义测试同步 + 单测。

- [ ] 5.1 白名单窄扩展（P2/P13/审查意见 16）：定义成员支持可选 `path`；新增 `{ kind:'method', name:'sessionsModels', path:['sessions','models'], optional:true }` 与 `{ kind:'method', name:'sessionsSelectModel', path:['sessions','selectModel'], optional:true }`；**`optional: true` 是硬要求**（成员缺失不得让 `downloads`/`respond` 连带 disabled）；同步 `test/official-service-definitions.test.mjs`、`test/services-definitions.test.mjs`、`test/official-passthrough-contracts.mjs`、`test/integration-surface.test.mjs`（stub 生成器支持 `path`）、`test/index-services.test.mjs`；**不暴露 `apiProxy.sessions` 整对象**。
- [ ] 5.2 `selection.get({ sessionId })`（R3 AC1/AC4，P3/P4/P14）：调 `apiProxy.sessionsModels({ rpcId, payload:{sessionId} })`；`result.ok` ⇒ 冻结 `{ sessionId, provider, model, effort, revision, source, committedAt, observedAt }`；`source` 按可观察证据分级（logged header config → `fallback-logged-request-config`；部署默认 → `fallback-deployment-default`；其余 → `committed`；两者都不可读 → `unknown`）；**`committedAt` 只在门面确有该 session 的提交证据时给出，否则 `null`**（不得用 `observedAt` 冒充提交时间）；`result.ok:false` ⇒ 按 `error.code` 映射 typed `unavailable`/`not-found`（不伪造选择值）。
- [ ] 5.3 `selection.set({ sessionId, selection, expected?, signal? })`（R3 AC2/AC3/AC5）：值级 CAS：先读官方 current；`expected` 提供且不匹配 ⇒ **不提交**、返回 `{ ok:false, code:'conflict' }`；匹配 ⇒ 经 `apiProxy.sessionsSelectModel({ rpcId, payload:{sessionId, provider, model, reasoningEffort?} })` 单点提交；成功 ⇒ `{ ok:true, code:'committed', revision }`（revision 为门面 owner-local、仅门面介入的成功提交步进，不宣称可感知官方路径写者）；`error.code` 映射 `rejected`/`unavailable`（`model-unavailable` → `rejected`，`session-not-found` → `unavailable`，原样携带官方 message 的有界部分，不改写语义）。**持久化失败不改变 commit 结果**（P4），只影响后续 `source`。
- [ ] 5.4 提交后确认与残余竞态（R3 AC5）：提交成功后重读 current 作为 `observedAt` 证据；比对与提交之间的窗口按官方 last-write-wins 语义，残余竞态在 design/registry 声明（不宣称线性化）；`signal` 取消在途尝试（不伪造终态，不重试）。
- [ ] 5.5 降级（R3 AC6/审查意见 16）：白名单成员不可服务 / `apiProxy` 缺失 / 返回形状不符 ⇒ `get`/`set` typed `unavailable`，`selection.availability()` 如实反映，而 `services.apiProxy` 的既有 `downloads`/`respond` 保持 active；候选查询与无关面隔离（候选查询不进本面，仍走既有 catalog faces）。
- [ ] 5.6 读取路径的官方副作用（审查意见 8/P14）：`selection.get` 对冷 session 的读取会经官方 `agentFor` resume 并发布 live agent——这是官方读取入口自身的契约；design 按 idiom 例外登记（projection 的官方载体副作用），availability 与 README 如实披露，并在测试中断言该副作用来自官方载体（fake 只按官方契约 resume）。
- [ ] 5.7 成员形状（design Face 4）：`sessions.selection.get/set/availability` host+client 同形；`availability()` 永不抛错；inert core 下 typed 呈现（`surfaceFor` + disabled 面）。
- [ ] 5.8 授权（R8 AC2/P15）：`set` 入口按 P15 的边界记账——host 调用方按 owner 归属；运输层动作沿已交付 carrier 边界，**不新增凭据校验也不接受调用方自报 grant**；`get` 不因未授权泄漏其它 session 的存在性。
- [ ] 5.9 测试：get 四态 source 推断；`committedAt` 无证据时为 `null`；set committed（revision 步进）；expected 冲突不触提交（fake 记录调用次数 = 0）；官方 `model-unavailable` → `rejected`；官方 `session-not-found` → `unavailable`+reason；`saveSelection` 失败仍 `committed`（P4）；成员缺失 → typed unavailable 且既有成员仍 active；窗口内并发写（fake 在比对后改 current）按官方语义返回 committed 并登记；`signal` 取消；**可达不被写成已授权**（按 P15 边界记账，不伪造 grant 判定）；冷 session 读取触发官方 resume（副作用来自载体）；白名单窄形状（`sessions` 整对象不可见）。

## Task 6: Face 3 消费合同与 R1/R8 复用证据（对应 req R1、R6、R8、R10 AC2）

**产出**：仅测试（无新代码）`test/interactive-session-consumption.test.mjs`。

- [ ] 6.1 生命周期复用（R1）：create（`agents.create`/官方 `sessions.create` passthrough）→ list/get/header → history/search（`sessions.views.events`/`deriveMessages`/sessionQuery）→ open/restore（`agents.resume` + activity）全链在**无官方业务 API 依赖**的测试客户端里走通；缺面 ⇒ typed unavailable（不建平行平台）。
- [ ] 6.2 基线/增量/重连（R6 AC1–AC3、AC6）：`channels.acquire` → `fetchEvents`/`list` 基线 + activity 当前态 → `observe` 增量（含 cursor）→ 断线 `resume` → 人为 gap ⇒ typed `resync-required`/`cursor-gap` 且**不伪造补齐**；channel 失活 ⇒ typed degraded 且无关面隔离。
- [ ] 6.3 关联与恢复后续跑（R6 AC4–AC5）：事件携带共享 operation/activity 关联（不从 event seq 合成身份）；重开 session 后 live/queued 经 activity 可见、旧 handle typed stale、已提交排队项不要求客户端重发。
- [ ] 6.4 授权分立（R8 AC1–AC4/P12/P15）：断言**可产出**的拒绝码 `device-denied`/`session-denied`（及 channel 既有 `resume-rejected` 类）；`pairing-required` 作为词表值**当前无产出点**，登记为词表空缺而非伪造用例；**可达 ≠ 授权**：断言本线新面的 client 路径与 M9 同路由、同 transport 信任分类，且**没有任何一处把「连接可达」写成「已按 session 授权」**（per-session grant 的缺席按 P15 登记为能力缺口，不用自报 grant 伪造）；pairing 只建立 device 身份、不成为全局授权；denied 不泄漏其它 session 存在性。
- [ ] 6.5 并发与旧代（R10 AC2）：两客户端同 session（含 Face 1/Face 2/Face 4 面）各自子面与 owner 归因；旧答复 ⇒ `stale`；旧 owner/旧 epoch ⇒ 不写入新代；无跨 owner 干扰。

## Task 7: capability、availability、登记、wire 与 client 半面（对应 req R9 与登记义务）

- [ ] 7.1 运行时 capability（审查意见 11/第二轮 #4）：`lib/capability-descriptors.js` 按 **namespace 粒度**增两条，**backing key 必须是本线新增并登记进 `FEATURE_MOUNTERS` 的内部 mount key**（`entry('sessions.interactions', 'execute', ['sessionInteractions'])`、`entry('sessions.selection', 'mutate', ['sessionSelection'])`——`entry()` 的第三参是内部 mount key，`'sessions'` 这个 key 不存在，写错会让 capability/availability 恒为 unavailable；effect 按 idiom 取 `execute`/`mutate`，不低估 respond 与 set）；`lib/index.js` 的 `FEATURE_MOUNTERS` 追加这两个 mounter；`lib/plugin-api-service.js` 的 `_decoratedNamespaces([...])` 列表补 `sessions.interactions`/`sessions.selection`；`lib/capability-matrix.js` 增 cluster 行；`lib/namespace-availability.js` 增两条叶子（`path: 'interactions'|'selection'`）。
- [ ] 7.2 canonical registry（审查意见 18）：新增 `sessions.interactions.{list,get,respond,availability}` 与 `sessions.selection.{get,set,availability}` 成员行（idiom：projection/operation/mutation/selfDescription；`respond` 的 `accepted` 结果按需登记 idiom 例外六元组，`committedAt`/`revision` 语义同）；**client runtime 成员行**按既有先例（`sessions.request`/`cancel` 的 `capability: client.sessions`）为新增 client 成员登记；`namespaces` 增两条记录（`contributingFeatures:['interactive-session-access']`）；**`hostDomainTree` 不动**（它是顶层根平面，`sessions` 下加叶子只写 `namespaces`，与 `sessions.planMode`/`permissionPresets`/`compaction` 先例一致）；`servicesWhitelist` 的 `apiProxy` 行更新成员描述并加**新字段**（如 `memberGrades`）承载逐成员分级（`sessionsModels` = pure/read、`sessionsSelectModel` = advanced + `bypasses` 登记 Face 4 为协调写路径，不入 Composable Profile）——**entry 级 `composition`/`status`/`channel` 三字段保持不变**（`test/registry.test.mjs` 强制 entry 级 `status==='advanced'`/`channel==='passthrough'`/`composition` 与 `SERVICE_DEFINITIONS` 一致，改 entry 级会直接红）；validator 与 `scripts/registry-snapshot.mjs` 无需改动（前者对白名单行只校验 key 唯一性与 `channel` 词表、允许新字段）。
- [ ] 7.3 治理同步：`public-api-shape.md` §2 增 `sessions.interactions`/`sessions.selection` 块；`domain-composition.md` §2 增领域行；`README.md` 增小节（含 selection 读取的官方 resume 副作用与 `source` 残余歧义）；`docs/specs/plugin-api-features/feature-list.md` §7 登记（含 client 半面判定、R-Point 收敛结论、残余竞态、`pairing-required` 词表空缺、per-session grant 能力缺口与退役触发）。
- [ ] 7.4 wire 与 client 半面（R9，审查意见 1/9）：固定 client 方法 token 列表（`sessions.interactions.list|get|respond`、`sessions.selection.get|set`）→ 既有 `/plugin-api/sessions` 路由 + 既有 connection rpc；**value-only 投影**（沿用 `projectWireOutcome`）；**无 wire revision**（冻结基线内、无协议族变更）；host 侧脱敏先行、client 只校验形状；offline/rebind ⇒ typed unavailable（不排队不静默丢）；旧代 handle ⇒ stale 守卫；availability 对空对象/缺失 carrier 如实报告；`lib/client-session-interaction-operation.js` 的 accepted 校验器按 Task 2.4 扩展；**client bundle 重建并 `--check` 一致**。
- [ ] 7.5 测试：capability/availability 镜像一致 + registry validator + feature 计数/顺序断言同步 + client bundle check + 治理 token 审计无新增泄漏（`interactive-session-access`、`R-Point`、`P1`–`P15` 等治理词不出现在实现代码）。

## Task 8: e2e 验收与迁移证据（对应 req R10 的 Testing Strategy）

**产出**：`test/interactive-session-e2e.test.mjs`（真实 cordis 树 + 真实官方组件）+ `test/interactive-session-migration-slices.test.mjs`。

- [ ] 8.1 基座与三套配置（审查意见 21）：真实 `@deepseek-ai/cordis` 树；附件用**真实 `@deepseek-ai/dsh-attachment-local`**（若其在本机可导入并有最小可用存储根，优先于 fake；不可用时用 fake 但按契约断言 `readImage` 返回 canonical ref、未知 ref 抛错）；审批用**真实 `dsh-user-approval`**；三套配置分别覆盖：(a) **无官方 mux answerer**（AC1 的 respond 证据）、(b) **官方 answerer 先注册在场**（8.5 非遮蔽证据）、(c) **反向注册顺序**（守卫断言：后注册的第三方 answerer 在门面持有期间不被调用，披露语义与前提）。门面经 `createPluginApiService` + mounter 挂载；**测试客户端侧不 import 官方业务 API**。
- [ ] 8.2 交互客户端全链（R10 AC1）：无官方业务 API 依赖的测试客户端走完 create → 候选查询 → 选择切换（route/prompt 同值：同一 `selection.get` 值与下一步实际使用值一致）→ 带附件发送（durable 块保真）→ 进度/终态 → 审批经受限视图 + respond（配置 (a)）→ 取消 → 断线重连 → 恢复历史；**question 段以 typed `unavailable` 断言收口**（P7 诚实缺口，不伪造）。
- [ ] 8.3 附件与 payload 保真（R10 AC5）：durable 记录含映射后的 content blocks，client payload 携带同一 refs；**断言无缩水（不是「没有报错」）**；fail-closed 分支逐 ref 原因可见；attachments 面缺失 ⇒ typed unavailable。
- [ ] 8.4 选择联合证据（R10 AC4）：同一提交值被 route 与 prompt 快照同值消费（与既有 scoped-contribution 事实共用断言面）；恢复无漂移分支与 `source`/`observedAt` 降级分支各一例；冷 session 读取的官方 resume 副作用一例。
- [ ] 8.5 互操作与不复制（R10 AC3、design 等价判据 4/6、审查意见 3）：**pending parity 断言**——受限视图的 approval pending 集与官方 answerer 的 asked−decided（同 id 口径）逐项一致、无幽灵项；官方 answerer 在场时不遮蔽（断言官方认领的请求不进入门面持有、门面 respond 对 mux 持有的项返回 `unavailable`）；**反向顺序守卫**（8.1(c)）；无 `ApiProxy` 拷贝、无第二 request/activity 状态机（结构断言：新增模块不定义队列/终态状态机）。
- [ ] 8.6 迁移 slices（外部仓库不在工作区，**不伪造消费者**）：A——`dsh-remote-web-ui` mobile channel（原：直接用 `apiProxy.events.mux` + 各 sessions/agentPresets 操作；迁：`sessions.request`（含 attachmentRefs/delivery）、`sessions.interactions.*`、`sessions.selection.*`、既有 channels/attention）；B——auto-continue/chat-recovery 类插件（原：自行拼事件推断运行态；迁：`sessions.activity` + operation status/observe + channels resume）。各 slice 记录删除的 hack 与替代面。
- [ ] 8.7 design/requirements 回写：P1–P15 运行结论与「探针结论对 Design/Requirements 的修订」6 条按 spec 修订流程写回正文（含 Face 2 视图形状 `sources`、共享 id 注册表、delivery 扩展点与 client 校验器、selection `source`/`committedAt` 与 resume 副作用、逐动作授权边界与 per-session grant 能力缺口、append 注册前提与 preempt 披露）。

## Task 9: 全量验证、全局终审与提交

- [ ] 9.1 `npm test`（4G 护栏）全绿；client bundle `--check` 一致；registry validator `registry valid`；`git diff --check` 干净；官方包零修改审计（`/usr/lib/node_modules/**` 未触碰）。
- [ ] 9.2 全局终审（阻塞式、只读）：只审整体交付与 Tasks/Design/Requirements 一致性 + `docs/standards/` 适用分册（尤其 `api-shape.md` 一面原则与 projection 副作用例外、`api-idioms.md` 六元组、`visibility-and-redaction.md` 逐出口脱敏、`concurrency-and-cancellation.md` 提交资格、`identity-and-lifecycle.md` 公共身份铸造、`capability-strategy.md` §6 services 分级）；返回「无偏差」后才可进入 9.3；有意见则集中修订并再次派审（**纯措辞/登记级小修改就地闭合并登记，不再回派复审**）。
- [ ] 9.3 终审通过后按阶段提交规则提交 Stage 4 交付并完成最终登记。

## 执行边界

- 版本冻结：不步进任何版本字段（AGENTS §3.0.1）；无 wire revision。
- **不新增 R 包/R 行**：Face 2 的兜底 answerer 是**监听者**而非替换行（不 disabled 官方行、不改 `cordis.patch.yml`、不 import 官方包模块，只经 `ctx.on`/`ctx.get`/`ctx.waterfall` 既有扩展点）；P7 排除了抢占 `userQuestions` provider 的做法；R-Point 1 不落地。
- **注册顺序前提（非 priority）**：兜底 answerer 以 append 注册、绝不 `prepend`；非遮蔽结论依赖「plugin-api 行在官方 api-proxy 行之后」的受支持安装路径前提，并在 Task 4.1/8.5 显式断言与披露；对「后注册第三方 answerer 会被 preempt」如实披露。
- **不代答**：只在 respond / signal abort / 租约到期三类事件下结算；无自动答复、无重试、无默认答案；自由 `answer` 对 approval 一律 `rejected`；question 侧不抢 provider、不伪造视图。
- **不建第二套状态机**：队列/steer 状态归官方 inbox；activity/operation 归已交付投影与权威；interaction 映射与共享 id 注册表为有界内存（不 durable）；selection 不持有第二份值。
- **脱敏**：受限视图 `summary`/`answerShape`、respond 审计、client 负载逐出口脱敏；日志不可达 ⇒ fail-closed 不发未脱敏内容。
- **fail-safe**：挂载失败只记日志并停用；成员一律 typed 结果（`availability()` 永不抛），绝不抛穿 apply/dispatch；新白名单成员一律 `optional`，缺成员不得连带停用既有成员。
- 入口与运行期 fail-safe：`interactions`/`selection` 在 inert core 下保持 typed 形状（`surfaceFor` + disabled 面），无关能力不受连带。

## Stage 3 对抗性审查记录（第一轮，2026-09-14）

结论「有意见」：正文标注 22 项（4 高 / 12 中 / 6 低），其中 §五 风险专项判定第 1 条并入下方记录条目 2，**处置合并为 21 条**，逐条如下：

- **[高] 1 accepted 形状与已交付 client 校验器不兼容** → Task 2.3 改为沿用 M9 `operation.id` 承载活 operation 引用；2.4 给出 queue 受理形状并通过扩展 `lib/client-session-interaction-operation.js` 校验器承接，产出清单与 7.4 同步（含 client bundle 重建）。
- **[高] 2（§五-1）Cordis 无 priority** → 全篇把「最低优先级」改为「append 注册 + row 顺序前提 + preempt 披露」（P6、探针修订 4、Task 4.1、执行边界、8.1(c)/8.5）。
- **[高] 16 新成员未标 optional 会整面 disabled** → P13 与 Task 5.1 明确 `optional: true` 为硬要求；5.9 增「成员缺失时既有成员仍 active」用例。
- **[高] 17 逐动作授权缺集成点** → 新增 P15 与探针修订 6：引入可注入 `authorizeAction` 缝（host 调用方放行、运输层来源缺 grant 证据即 `denied`）；Task 3.5/4.6/5.8/6.4 按其断言。
- 3 R10 AC3 parity 无断言 → 8.5 增 pending parity 逐项断言。
- 4 delivery 路径附件校验 → 2.3/2.7 明确同 Task 1.2 校验、不豁免。
- 5 R5 AC2 结果码口径 → requirements 拆分为「形状/非 pending ⇒ rejected/stale；无授权 ⇒ denied」。
- 6 共享 id 注册表缺失 → 新增 Task 3.2（`(sessionId, approvalId) → facade id`，视图与持有共用，decided/settle 清除，有界）与 4.1 的 approvalId 回扫推导。
- 7 `committedAt` 无官方来源 → 5.2 规定只在门面有提交证据时给出，否则 `null`。
- 8 `selection.get` 冷 session resume 副作用 → 新增 5.6（按 idiom 例外登记 + 载体断言 + README 披露），P14 记录事实。
- 9 wire 细节未固定 → 7.4 固定 method token、value-only 投影、无 revision 判定。
- 10 design/requirements 残留旧结论 → 已就地修订（design 的 Current-State Findings、架构图 answer entry 行、attachmentRefs 合同第 1/2 条、Data Models、Hook 表应答行、复用矩阵 apiProxy 行；requirements R2 AC1、R4 AC1/AC3、R5 AC1/AC2、R10 AC1、R4 Classification、复用矩阵 pending 行）。
- 11 capability 粒度 → 7.1 改为 namespace 级两条。
- 12 respond 词表与「可见未持有」结果码 → 4.3/4.4 对齐并明确 `unavailable`。
- 13 P4 的 saveSelection 归错 → P4 订正为「持久化失败不改变 set 成功结果」。
- 14 P5 的 cancelled 分支张冠李戴 → P5 订正为仅 question 分支存在。
- 15 白名单扩展的测试同步点不全 → P13/5.1 列出五个文件（含 stub 生成器的 `path` 支持）。
- 18 registry 事实错误 → 7.2 改为：不动 `hostDomainTree`、补 client runtime 成员行、`servicesWhitelist` 加逐成员分级字段。
- 19 旧契约测试同步 → Task 1 产出清单与 1.6 纳入两个既有测试文件。
- 20 租约与「无定时器」措辞矛盾 → 4.2 明确三类且仅三类结算，4.5/4.6 改为对应表述与「租约内续租保持 pending」用例。
- 21 e2e 证据力与 queuedRef 身份 → 8.1 三套配置 + 真实 attachments 优先；2.4/2.5 queuedRef 自带 `operationId`、已认领但 operationId 已变 ⇒ `stale`。

## Stage 3 对抗性审查记录（第二轮，2026-09-14）

结论「有意见」8 项标注（1 高 / 4 中 / 3 低），处置合并为 6 条：

- **[高] 授权缝缺生产者/验证者**（`authorizeAction` 的 grant 证据无人签发、无人验证；按默认会拒绝全部运输层客户端动作，冲突 R9 AC1 与 R2 client 路径；且与 design 旧文「复用已交付 channel auth」自相矛盾）→ **改为不发明授权系统**：P15 重写为现状边界（channel auth 注册表与受控分发不对外暴露、client 路由无 grant 上下文），host 调用方按 owner 归属、运输层动作沿与 M9 **同一条已交付 carrier 边界**，不接受调用方自报 grant；per-session grant 的缺席如实登记为能力缺口（与 question 侧同型）；design Failure Paths 与探针修订 6 同步改写，requirements R8 AC1/AC2 与 R4/R5 的授权注同步（见下）。
- **[中] design 的 accepted 形状未同步** → design Data Models 改为 steer 用 M9 `operation:{id}`、queue 用 `queuedRef:{id, operationId}`；探针修订第 3 条补 `operationId` 同一性守卫与 `stale` 分支。
- **[中] 「最低优先级」残留 4 处** → design R-Point 1、design 探针修订第 1 条、requirements R5 AC1 注、tasks 执行口径行统一改为「append 注册（绝不 `prepend`）+ row 顺序前提」。
- **[中] Task 7.1 的 backing mount key 错误** → 改为本线新增并登记进 `FEATURE_MOUNTERS` 的 `sessionInteractions`/`sessionSelection`，effect 改 `execute`/`mutate`，并补 `_decoratedNamespaces` 列表同步点。
- **[低] registry entry 级字段约束** → 7.2 明确 entry 级 `composition`/`status`/`channel` 保持不变、逐成员分级放新字段（`memberGrades`），validator 与 snapshot 脚本无需改动。
- **[低] 审查记录统计错记与陈旧交叉引用** → 统计改为「正文 4 高 / 12 中 / 6 低，处置合并 21 条」；删除无 diff 依据的「requirements 合同关系节」指认并改为实际修订清单；`P1–P14` 改 `P1–P15`；P14 的落点改指 Task 5.6；design 修订清单标题的「5 处」改「8 处」。

## Stage 3 对抗性审查记录（第三轮，2026-09-14）

结论「有意见」8 项标注（2 高 / 2 低 为实质残件；其余 4 项为已闭合确认），处置 4 条：

- **[高] design Failure Paths 的旧 `authorizeAction` 条未删除**（与改写后的边界条互斥）→ 删除该整条；Stage 3 探针修订第 8 条改写为「逐动作授权边界 + per-session grant 能力缺口」，并明确该缺口与 question seam（R-Point 1）是两个**独立的评估入口**、不互相指代；Task 8.7 的回写清单同步删除该词。
- **[高] per-session grant 旧语义残留**（R4 AC1/AC4、R5 AC2、Task 3.5/3.6/4.6/5.9 与 P15 互斥，Stage 4 无法同时满足）→ requirements R4 AC1/AC4、R5 AC2 加 Stage 3 探针注（grant 按实际穿越的边界记账；无 seam 的边界不伪造该判定，缺口按 R8 注登记）；Task 3.5 改为「授权按 P15 边界记账」、3.6/4.6/5.9 的「未授权 ⇒ denied/不出现」用例改为「按边界记账 + 可达不被写成已授权 + 不泄漏存在性」；design 并发声明的 Face 2 提交资格与 Testing Strategy 7 同步改写。
- **[低] 第二轮记录统计与自身条目不符** → 第二轮记录改为「8 项标注，处置合并为 6 条」；第一轮记录改为「正文标注 22 项（4 高 / 12 中 / 6 低），其中风险专项判定第 1 条并入条目 2，处置合并为 21 条」；status 行改为按处置条目数计（21 / 6 / 4）。
- **[低] P14 交叉引用自相矛盾** → 删除结尾的「Task 5.7/」，idiom 例外落点统一指向 Task 5.6，载体断言归 Task 8.4。

### 第三轮补充闭合（2026-09-14）

第四轮复核仅剩 1 条 `[低]` 单点交叉引用（design Failure Paths 把 per-session grant 缺口的触发条件指向 R-Point 1，与「两个独立评估入口、不互相指代」抵触）。该修正属 AGENTS §3.2「仅小修改（单点修正）」范围，审查方亦明确「修订后可视为本门通过」，故就地闭合：design Failure Paths 改为「与 question 侧缺口并列登记、互不指代；触发条件见 requirements R8 同步注与本文探针修订第 8 条」；Task 7.3 的 feature-list 登记清单补列该能力缺口（非阻塞完整性提示）。

**Stage 3 门结论：通过**（第四轮判定「4 条处置均已落地，仅 1 处单点措辞残件，修订后可视为本门通过」；残件已就地闭合且无同轮实质改动）。据此进入 Stage 4。

