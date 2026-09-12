# Stage 1 - Requirements

> feature_name: `interactive-session-access`
> milestone: M10
> status: Stage 1 已交付（2026-09-12，与 Stage 2 Design 同批产出）；Stage 3（Tasks）未开始
> 输入溯源：M10 观察报告 §5 OBS-09 / OBS-12（含源码锚点）与 §3 样本导航（remote-web-ui mobile channel、auto-continue、chat-recovery、TUI、notification）；M10 工作纲领 §1/§2/§4 总览、§3.9 输入卡片与 §5 已闭合事实；canonical registry `sessions.request/cancel`、`sessions.channels.*`、`sessions.activity.*`、`attention.*`、`services.apiProxy`、client 根 `sessions`/`attention` 现状；已交付合同 `docs/specs/session-interaction-operation/requirements.md`（M9）。

## Status

本文与 Stage 2 Design 同批产出（2026-09-12），承接已确认的 Stage 0 Goal（`goal.md`）。本文件只确认 Requirements 方向：面拆线、既有 owner 复用矩阵、协议取舍、attachmentRefs 映射细则与可能的 R 点位由 Design 定稿。全程在版本冻结基线（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`）内交付，不提出任何版本字段变更。

## Introduction

`interactive-session-access` 让 browser 插件、独立 Web/手机页面与 host/TUI 只消费公开运行时契约即可实现完整会话交互：session 创建/列表/历史/打开恢复、发送/取消（含排队/steer）、候选模型查询与目标 session 的模型/effort 切换、pending approval/question 的受限视图与匹配应答、事件基线/增量/断线重连、原始消息/附件 payload 贯通——不依赖官方 private ApiProxy/mux 状态，不要求插件理解官方私有 RpcId/schema。

三条硬边界贯穿全部需求：

1. **复用优先**：已交付面能完成的行为一律复用（复用映射见文末附表），不新建第二个 sessions 平台，不建立第二套 request/activity 状态机。
2. **扩展而非重建**：本线是已交付 `session-interaction-operation` 合同（request/cancel/activity/attention/channel、operation status/observe）之上的扩展交互定义；该合同交付后的接线修复属其自身维护范围，本线不重复、不改写其已交付验收边界。
3. **诚实降级**：连接可达不等于有权限；持有空对象不等于能力 active；任何缺口以 typed 结果呈现，绝不静默缩水或伪造成功。

## Requirement 1: Session Lifecycle Through Existing Faces (No Second Sessions Platform)

**User Story:** As an independent frontend author, I want create/list/history/search/open/restore of sessions through the already-delivered public faces, so that I build interaction on one sessions authority instead of discovering a parallel platform.

### Acceptance Criteria

1. WHEN an interactive client creates a session THEN the system SHALL expose creation through the mapped existing public faces (`agents.create` operation and the official `sessions.create` passthrough where the runtime provides it), and SHALL NOT add a second creation authority for the same resource.
2. WHEN an interactive client lists sessions or reads a session header THEN it SHALL consume the delivered `sessions.list`/`sessions.get`/`sessions.header` projections with their existing typed availability semantics, and the system SHALL NOT publish a duplicate listing authority.
3. WHEN an interactive client reads history or searches a session THEN it SHALL consume the delivered read faces (`sessions.views.events`, `sessions.deriveMessages`, the durable list, `services.sessionQuery`), and the system SHALL NOT build a parallel history/search store.
4. WHEN an interactive client opens or restores a session THEN it SHALL combine the delivered open/restore owners (`agents.resume`, `executions.recovery.checkpoints` where applicable) with the shared activity projection for live/queued state, and SHALL NOT re-derive session state outside those owners.
5. WHEN a lifecycle behavior has no reachable existing face on the current runtime THEN the system SHALL report that behavior as typed unavailable and SHALL NOT introduce a duplicate sessions platform inside this feature to fill the gap.

**Classification:** A（既有面复用与稳定化；无新通道）。R 类判定：官方 seams 已可达，不涉及 R（`capability-strategy.md` §2）。

## Requirement 2: Send With Attachments And Queue/Steer Delivery

**User Story:** As an interactive client author, I want to send attachment-bearing input into a session and to steer or queue input while the session is busy, with honest typed outcomes instead of guessing.

### Acceptance Criteria

1. WHEN a request message carries `attachmentRefs` THEN the durable adapter SHALL resolve every ref through the existing attachments authority and SHALL append one durable user message whose content blocks preserve each attachment (media kind, reference, source provenance); the system SHALL NOT shrink attachments to plain text, drop refs, or fabricate placeholder blocks.
2. WHEN any ref cannot be resolved (missing, expired, unsupported) THEN the request SHALL fail closed with a typed rejected/unavailable outcome carrying the per-ref reason, and SHALL NOT append a partial message.
3. WHEN a request arrives while the target session has a live operation THEN the request authority SHALL apply the caller-declared `delivery`: `steer` (official next-step splice into the live attempt) or `queue` (official next-turn inbox), returning a typed accepted outcome that references the live operation (steer) or a cancellable queued reference (queue); WHEN `delivery` is absent THEN the delivered same-session outcome (`already-running` with the live operation reference) SHALL be preserved unchanged.
4. WHEN a steered or queued delivery is committed THEN its pending/queued state SHALL be observable through the official inbox durable record `agent/inbox/spliced` (discard recorded as `outcome: 'canceled'`), the `inserted`/`claimed`/`discarded` dispatch notifications (`claimed` is not durable), and the shared activity projection; this feature SHALL NOT maintain a second queue or request state machine.
5. WHEN a caller cancels a not-yet-claimed queued request via the delivered `sessions.cancel` with its queued reference THEN the authority SHALL request official discard and return a typed outcome; WHEN the loop has already claimed it THEN cancel SHALL follow the delivered live-operation cancel path (signal, never a forged terminal).
6. WHEN the official inbox or loop boundary is unavailable THEN steer/queue SHALL return typed unavailable and SHALL NOT fall back to an append-and-guess path.

**Classification:** B（已交付 request authority 的扩展：durable 适配映射 + 官方 inbox 交付词表）；消费已交付 agent-loop 切片事实，不新增 replacement 包或行。R 类判定：官方 inbox/answer seams 可达，不新增 R；未来若 probe 证明 seam 缺失，按 `capability-strategy.md` §2/§4 评估且仅在 Design 陈述。

## Requirement 3: Model And Effort Selection For A Target Session

**User Story:** As an interactive client author, I want to query candidate models and change the target session's current model/effort, so that the next step actually runs on what the user picked — with one snapshot for route and prompt.

### Acceptance Criteria

1. WHEN an interactive client queries model candidates THEN it SHALL consume the existing catalog faces (host `services.llm.listProviders`/`listModels`, `llm.routing.candidates`; client `services.modelDirectories`; presets via `services.agentPresets` where the sample uses them), and the system SHALL NOT publish a duplicate model catalog.
2. WHEN a caller commits a model/effort selection for a target session via the selection mutation face THEN the system SHALL commit through the single official selection submit seam — the audited `services.apiProxy` whitelist extension carrying the official per-session selection state — as a coordinated mutation with value-level compare-and-set, returning a typed `committed | conflict | rejected | unavailable` outcome; callers SHALL NOT write selection state through any parallel store.
3. WHEN a selection is committed THEN the next processing step of that session SHALL route to the committed model and SHALL carry the same committed value in that step's prompt snapshot — route consumption and prompt consumption SHALL observe one identical selection value (joint acceptance with the scoped-contribution line's same-step snapshot verification); the system SHALL NOT split one selection into two independently-committed copies.
4. WHEN a session is restored or the client reopens across modes THEN the visible selection SHALL equal the last committed selection when the official persistence succeeded (no drift); WHEN official persistence failed or is unavailable THEN the selection view SHALL typed-disclose the effective source and its degradation (`source`/`observedAt` fields) instead of presenting a stale committed value as authoritative.
5. WHEN a set arrives with an `expected` selection snapshot that no longer matches the official current value at commit time — including writes made through the official path outside the facade — THEN the system SHALL return typed conflict; the official submit seam itself is last-write-wins without an atomic compare-and-swap, so a write racing inside that window follows official semantics and the residual race SHALL be declared in Design.
6. WHEN the official selection submit seam is unavailable (whitelist member not servable on the current runtime, or the Design fallback applies) THEN get/set SHALL return typed unavailable views/results and the namespace availability SHALL reflect it honestly.

**Classification:** A（候选查询复用）+ A/B（选择提交：官方 selection 事实源与唯一提交入口在 `@deepseek-ai/dsh-host-apiproxy` 的 ApiProxyService；本线经 `services.apiProxy` 审计白名单扩展承接该 seam——§6 分级，submit 成员为 advanced passthrough 且声明 bypass——facade 选择面为其上的 coordinated mutation wrap）。R 类判定：基线不新增 R；若 probe 证明 submit 成员在当前 runtime 仅 mux 帧可达（不可作为 service 方法服务），按条件 R（dsh-host-apiproxy 的 apiProxy 行）或 C 类诚实 unavailable 基线处理（见 Design R-Point 陈述）。

## Requirement 4: Pending Interaction Restricted View

**User Story:** As an interactive client author, I want a bounded, redacted view of pending approvals and questions per session, without managing official private registries.

### Acceptance Criteria

1. WHEN approvals or questions are pending on a session the caller is granted THEN the interactions view face SHALL return frozen restricted views `{ id, kind: 'approval' | 'question', sessionId, summary, createdAt, answerShape }` where `id` is a facade-minted public interaction identity and `summary`/`answerShape` are bounded and redacted — free of secrets, payload bulk, owner-private state and official registry internals.
2. WHEN a pending interaction is resolved upstream (answered, expired, withdrawn) THEN the view SHALL stop reporting it as pending based on official events; the facade SHALL keep only the id-to-official-item mapping and SHALL NOT maintain its own interaction lifecycle state machine.
3. WHEN the official pending source is unreachable or degraded THEN the view SHALL return the typed degraded/unavailable form and SHALL NOT present an empty list as a healthy "nothing pending" state.
4. WHEN the caller lacks the session grant for a target session THEN its view SHALL NOT include that session's pending interactions.

**Classification:** B（facade projection：approval 侧经官方 `approval/request`、`approval/decided` 事件可达；question 侧 pending 集位于官方 apiproxy 内部（官方 ctx.userQuestions 仅 registerProvider/ask 且单 provider），其视图 seam 与应答 seam 同归条件 R 探针范围（见 Design）——seam 未证实前交付基线为诚实 typed unavailable，不伪造视图）。不旁路、不吞并既有 approval/userQuestions/attention authority。R 类判定：不新增 R（条件点位见 Design）。

## Requirement 5: Matched Respond, Reject And Cancel

**User Story:** As an interactive client author, I want to submit an answer, rejection or cancellation that matches a pending interaction's declared shape, through one typed operation that never answers on my behalf.

### Acceptance Criteria

1. WHEN a caller submits a respond operation `{ id, action, answer?, reason?, signal? }` where `action` is `approve | reject | answer | cancel` and the action and answer match the pending interaction's kind and declared answer shape THEN the facade SHALL forward exactly one answer through the official answer entry (`services.apiProxy.respond` / official user-questions admission) and SHALL return a typed `accepted | stale | rejected | denied | unavailable` outcome.
2. WHEN the answer shape mismatches the declared `answerShape`, the interaction is no longer pending, or the interaction belongs to a session without grant THEN the system SHALL return typed rejected/stale and SHALL NOT reinterpret or coerce the answer.
3. WHEN two clients respond to the same interaction THEN the first accepted submission SHALL win and the second SHALL receive typed stale/conflict; the official authority SHALL remain the decision owner.
4. WHEN a respond is accepted or refused THEN the facade SHALL record bounded audit (caller owner, interaction id, action, timestamp, outcome) without answer payload content or secrets.
5. The system SHALL NOT auto-answer: no schedule, trigger, retry or default answer SHALL be provided by the facade; every answered interaction SHALL be exactly one explicit caller action.
6. WHEN `services.apiProxy.respond` or the official question admission is unavailable THEN respond SHALL return typed unavailable; the delivered `services.apiProxy` passthrough (downloads/respond) SHALL remain unchanged.

**Classification:** B（facade operation；官方 answer entry——respond、pending approval/question registry 与 /api/respond 路由——归属 `@deepseek-ai/dsh-host-apiproxy` 的 ApiProxyService，`services.apiProxy.respond` 为其白名单底层，插件不管理官方私有 registry）；不代答。R 类判定：官方 answer seam 可达，不新增 R；question 侧视图/应答 seam 的条件点位见 Design。

## Requirement 6: Event Baseline, Increment, Reconnect And Correlation

**User Story:** As an interactive client author, I want baseline plus incremental session events with reconnect and catch-up, and events that carry real request/operation identities.

### Acceptance Criteria

1. WHEN a read-only stream consumer opens or reopens a session stream THEN it SHALL first obtain a baseline (history snapshot plus current pending/running/queued state) with a cursor before increments are delivered, using the delivered `sessions.channels` open/acquire path.
2. WHEN increments flow THEN they SHALL arrive in official session order with channel cursors, with heartbeat/ack per the delivered channel contract.
3. WHEN the connection drops and the consumer resumes with its cursor THEN the channel SHALL deliver the missed events or a typed `resync-required`/`cursor-gap` result; the consumer SHALL re-baseline on resync; the system SHALL NOT fabricate or silently drop events.
4. WHEN an event belongs to an accepted request or operation THEN it SHALL carry the shared operation/activity identity correlation from the delivered facts; consumers SHALL NOT synthesize identities from event sequences.
5. WHEN a client reopens a session after disconnect or restart THEN live/queued work SHALL be visible through the shared activity projection (including loop-committed follow-up/queue facts), stale handles SHALL return typed stale, and committed queued work SHALL NOT require a client re-send.
6. WHEN the channel capability is inactive or version-mismatched THEN the stream face SHALL report typed degraded/unavailable and unrelated faces SHALL remain isolated.

**Classification:** A/B（载体是已交付 channels owner，其 replacement 行已各自拥有完整 client 半面；本线只定义消费合同，不新建事件体系、不新增通道）。

## Requirement 7: Payload Fidelity And Message Kind Contract

**User Story:** As an interactive client author, I want original messages, attachments, source and provenance to reach model and UI without silent shrinkage, and new message kinds defined formally before they exist.

### Acceptance Criteria

1. WHEN original messages, attachments, source or provenance are projected to any interactive consumer THEN the system SHALL preserve them at their declared fidelity (content blocks, refs, source provenance) and SHALL NOT silently reduce them to plain text.
2. WHEN redaction applies THEN it SHALL apply per the visibility envelope (secrets, owner-private, diagnostics) and SHALL NEVER substitute for payload fidelity.
3. WHEN a request needs a message kind beyond the delivered contract THEN the kind SHALL be formally defined by this feature's Design before implementation; v1 defines the attachment-bearing `user-message`; all other kinds remain typed rejected.
4. WHEN the durable mapping for `attachmentRefs` is delivered THEN it SHALL be the single mapping consumed by the request authority's durable adapter (superseding the delivered fail-closed gap), registered in the canonical registry at the integration wave.

**Classification:** B（合同定义 + durable 适配映射）；append 走既有 source-audited durable mutation 契约。

## Requirement 8: Authentication And Authorization Separation

**User Story:** As a maintainer, I want target/device/session/owner expressed separately, so that reachability never masquerades as permission and pairing never becomes global authorization.

### Acceptance Criteria

1. WHEN a client connects THEN device identity, session grant and owner attribution SHALL be evaluated as separate checks by the delivered channel auth (verifier/authorizer/pairing), each independently refusable with its typed code (`device-denied`, `session-denied`, `pairing-required`).
2. WHEN a connection is established (reachable) THEN that SHALL NOT imply interaction authorization; every interaction-level action (request, steer/queue, respond, selection set) SHALL be authorized per target-session grant.
3. WHEN a pairing cookie or device credential is presented THEN it SHALL establish device identity only and SHALL NOT automatically become a global authorization; the delivered loopback/trusted-host boundaries of the connection owner SHALL be preserved unchanged.
4. WHEN authorization fails THEN the action SHALL return typed denied with a bounded reason, without revealing which other sessions or interactions exist.

**Classification:** A（复用已交付 channel auth owners）+ 本线对逐动作授权的显式要求；不新建认证/授权平台。

## Requirement 9: Client Half And Honest Capability Self-Description

**User Story:** As a Web/mobile client author, I want the same typed interaction faces in the browser with honest availability, so that remote clients never report phantom capabilities.

### Acceptance Criteria

1. WHEN a browser or remote client invokes the interaction faces (`sessions.request`/`cancel`, the interactions view/respond face, the selection face) THEN the client faces SHALL return the same typed shapes as the host, over the delivered client transport owners.
2. WHEN the transport, connection or a backing authority is unavailable (offline, rebinding, headless, version mismatch) THEN client calls SHALL return typed unavailable; nothing SHALL be queued invisibly or dropped silently.
3. WHEN a client handle, observer or callback belongs to an older connection generation or epoch THEN it SHALL be stale-guarded and SHALL NOT write into a newer generation.
4. WHEN capability or availability is reported THEN it SHALL reflect actual authority/carrier/source state; an empty object or a reserved namespace SHALL NOT be reported as active (the delivered self-description repair baseline maintained).
5. WHEN payloads cross to the client THEN host-side redaction SHALL complete before serialization; the client SHALL validate shape only and SHALL NOT receive secret, owner-private or diagnostic material.

**Classification:** B（facade client 面，承载于已交付且具备 client 半面的 carriers）。client 半面判定（capability-strategy §10 六问）见下节。

## Client-Half Determination (capability-strategy §10)

本线 client 半面重大：交互客户端是第一消费者，全部新增公共面 host/client 同形。六问按承载载体逐项记录（任何一项命中即要求完整复制其客户端能力）：

| 承载载体 | Q1 client manifest | Q2 remote namespace | Q3 slot/settings bridge | Q4 host↔client 版本协商 | Q5 browser state/reconnect | Q6 client-facing event/service | 结论 |
|---|---|---|---|---|---|---|---|
| connection 替代行（`dsh-client-connection` owner） | 有 | — | — | — | 有 | 有 | 完整 client 半面已由该 owner 复刻交付 |
| gateway 替代行（`dsh-api-gateway` owner） | 有 | — | — | — | 有 | 有 | 完整 client 半面已复刻交付 |
| api-remotes 替代行 | 有 | — | — | — | 有 | 有 | 完整 client 半面已复刻交付 |
| client-runtime 替代行 | 有 | — | — | — | 有 | 有 | 完整 client 半面已复刻交付 |
| agent-loop 切片（M9，本线仅消费） | 无 | 无 | 无 | 无 | 无 | 无 | host-only（M9 已记录，本线不改变） |

结论：本线全部新增公共面经由**已具备完整 client 半面的既有 owner** 承载，本线不新增 R 包或 R 行；新增 facade 面的 client 半面随其 carrier 的既有 client 通道交付，不新建第二套 browser 状态或重连 owner。若 Design/Tasks 阶段触发 R 点位（见 Design 陈述），因官方行行使 client-facing service（Q6 命中）必须提供完整 client 半面并按 R7 自建构建。

## Requirement 10: Verification And Delivery Gates

**User Story:** As a maintainer, I want end-to-end evidence from a client that depends on no official business API, so that "interactive access" cannot be declared by unary probes or source exports.

### Acceptance Criteria

1. WHEN the feature is verified THEN an interactive test client that imports no official business API SHALL complete: create session, query candidates and switch model/effort, send input with attachments, receive stream/operation progress, handle an approval and a question through the restricted view, cancel, disconnect and reconnect, and restore history.
2. WHEN concurrency is verified THEN two clients operating the same session, an old (superseded) reply, an old owner and an old epoch SHALL each produce the delivered commit-eligibility/stale-guard outcomes without cross-owner interference.
3. WHEN interop is verified THEN the official browser plugin and an independent client SHALL observe consistent pending interactions and consistent session state for the same session, within the redaction envelope.
4. WHEN selection is verified THEN one committed selection SHALL be observed identically by this-step route and prompt snapshot (joint evidence with the scoped-contribution line); restored sessions SHALL show no drift when official persistence succeeded, and SHALL typed-disclose the effective source (`source`/`observedAt`) when it did not.
5. WHEN payload fidelity is verified THEN attachment-bearing input SHALL reach the durable record with mapped content blocks and reach client payloads with the same refs; the pre-delivery fail-closed behavior SHALL be replaced by this contract, and no-shrinkage SHALL be asserted (not merely absence of errors).
6. WHEN acceptance is evaluated THEN unary-RPC-only tests or source-export presence SHALL NOT count as coverage; stream, pending-interaction, reconnect and concurrency evidence is mandatory.
7. WHEN delivery closes THEN the guarded full test suite, `git diff --check`, registry/surface consistency, official-package zero-modification audit and the required global adversarial review SHALL pass; evidence gaps SHALL keep the affected face typed unavailable rather than declared complete.

**Classification:** 交付门（覆盖 A 复用、B 扩展面与 client 半面）。

## Annex: Reuse Mapping (behavior → existing face)

| 行为（goal 行为域） | 复用的既有公共面 | 判定 |
|---|---|---|
| session 创建 | `agents.create`（operation）、官方 `sessions.create` passthrough | 复用 |
| session 列表/头部 | `sessions.list` / `sessions.get` / `sessions.header` | 复用 |
| 历史/搜索 | `sessions.views.events`、`sessions.deriveMessages`、durable list、`services.sessionQuery` | 复用 |
| 打开/恢复 | `agents.resume`、`executions.recovery.checkpoints`、`sessions.activity`（live/queued 只读） | 复用 |
| 发送/取消 | 已交付 `sessions.request`/`cancel` authority + operation status/observe wire（M9） | 复用 + 本线扩展（attachmentRefs、delivery 词表） |
| 排队/steer | 官方 inbox（durable 类型 `agent/inbox/spliced`，discard 以 `outcome: 'canceled'` 记录；inserted/claimed/discarded 为派发通知，claimed 非 durable）+ M9 attempt followUp 事实 | 复用官方状态，本线只加交付词表 |
| 候选模型查询 | `services.llm.listProviders/listModels`、`llm.routing.candidates`、client `services.modelDirectories`、`services.agentPresets` | 复用 |
| 模型/effort 变更 | 官方 selection 事实源与唯一提交入口（`@deepseek-ai/dsh-host-apiproxy` 的 `session.selectModel`/`session.models`）经 `services.apiProxy` 审计白名单扩展承接 | 复用 seam（白名单扩展）+ 本线新增受控 mutation 面 |
| pending 交互视图/应答 | 官方 approval / userQuestions authority + `services.apiProxy.respond`（底层） | 复用 authority + 新增受限视图/类型化 respond 面（approval 侧经 `approval/request`/`approval/decided` 事件完整可用；question 视图来源见 R-Point 1 条件探针，seam 未证实前该侧 typed unavailable） |
| 事件基线/增量/重连 | `sessions.channels`（open/acquire/observe/fetchEvents/ack/resume/revoke/auth/redaction）+ `sessions.activity` | 复用（消费合同） |
| 通知/attention 呈现 | `attention`（host+client） | 复用、不吞并 |
| 客户端传输 | connection、api-remotes、client-runtime carriers（均已交付 client 半面） | 复用 |
| 附件解析 | `services.attachments` + `attachments.pipeline`/`projection` | 复用（attachmentRefs→content block 映射的唯一来源） |

## Contract Relationship To The Delivered session-interaction-operation

- 本线消费而非重建：request authority（acceptance/dedupe/cancel/terminal 裁决、audit）、operation handle/status/observe（含 wire 承载）、activity correlation（confidence 三态不互代）、waiting 相位（approval 等待证据同源）全部按已交付合同消费。
- 本线的显式扩展点（由 Goal 授权）：`message.attachmentRefs` durable content block 映射（兑现已登记缺口）；`delivery`（steer/queue）交付词表（扩展同 session 冲突的已交付 `already-running` 默认行为，缺省行为不变）；`sessions.interactions` 与选择 mutation 两个新 facade 面。
- 已交付合同的接线与自描述修复属其自身维护范围；本线不重复该修复，其修复后的基线（诚实 availability、stale 世代守卫、host 侧脱敏先行）是本线 client 面的既有前提。
- 与 scoped-agent-contributions 的共同验收点（Requirement 3 AC3）：同一步 route 与 prompt snapshot 消费同一选择值；该线贡献/决策消费侧的验收由其自身 spec 承载，本线只保证选择提交侧的单一写点与单一事实源。

## Standards Applicability And Alignment

- `capability-strategy.md`: applicable。全部行为按 A/B 分类落点成文；R 判定逐条引用（本线基线不新增 R，条件性 R 点位仅作 Design 陈述）；client 半面按 §10 六问逐载体记录（上节）；横切派发语义不进任何切片。
- `api-shape.md`: applicable。行为按独立 owner 的面拆分（operation / 资源视图+respond / 只读流消费合同 / selection mutation），不共享状态空间；projection 无副作用、respond 不决策、selection 走 coordinated mutation；smell 判据自查通过。
- `api-idioms.md`: applicable。新面按八类 idiom 成形：interactions 视图 = projection、respond = operation、selection = mutation（CAS）、availability/selfDescription 词汇沿用；判别式结果 `{ok, code, reason}` 与冻结视图统一。
- `public-api-shape.md`: applicable。新成员挂既有 `sessions` 领域（`sessions.interactions`、`sessions.selection`），client 根 `sessions` 加性扩展；不建 alias、不泄漏 package/row/治理身份。
- `composition-and-authority.md`: applicable。respond 第一提交者获胜（commit eligibility）；selection 用 CAS revision；owner 从调用上下文派生、不可伪造；authority closure 只对受支持路径声明。
- `domain-composition.md`: applicable。approval/userQuestions/attention/session/channels 域 gate 各归其主；本线不新增跨域大状态机。
- `ordering.md`: applicable。本线无新策略排序面；事件监听沿用固定 priority 词汇；队列顺序由官方 inbox 语义承载，不建全局排序图。
- `identity-and-lifecycle.md`: applicable。interaction id 为 facade 铸造的公共身份（不与 event seq 混用）；operation/execution/attempt 身份沿用已交付词汇；terminal 词汇不变。
- `durable-state-and-scope.md`: applicable。attachmentRefs 映射写入走 source-audited durable append；selection/interaction 不新增持久 scope 档（session 档由官方持久化承载）；无私有 storage 旁路。
- `visibility-and-redaction.md`: applicable。受限视图逐出口脱敏；client 半身受众更保守；host 脱敏先行、fail-closed；secret 不出任何出口。
- `concurrency-and-cancellation.md`: applicable。取消=信号、终态=裁决（M9 authority 不变）；respond 第一提交者获胜；stale handle/generation 纪律；selection CAS 提交资格。
- `versioning-and-protocols.md`: applicable。冻结基线内交付；协议取舍与 wire revision 政策见 Design（仅真实协议边界需要时引入并登记）。

## 备注（Stage 边界）

本文件只确认 Requirements 方向。Design 将确定：三主面 + selection 面的 owner 划分与成员形状、既有 owner 复用矩阵（逐项 reuse/extend/new）、最终协议与官方 mux 的等价判据、attachmentRefs durable 映射的具体合同、M9 已交付面的扩展消费方式、可能的 R 点位陈述与失败/guard 策略。Tasks 经对抗性审查后才进入实现。
