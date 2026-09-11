# Stage 2 - Design

> feature_name: `session-interaction-operation`
> milestone: M9
> status: SPEC1 Stage 2 已确认（v2，2026-09-06 人类批准；与 Requirements v2 同批）；Stage 3（Tasks）待进行——Tasks 经对抗性审查门通过后进入 Stage 4。
> 现状注（2026-09-07 核对）：Tasks（Stage 3）已通过对抗性审查门，Stage 4 已交付并合入 main（实现提交 `fe5b3c7`、终审修订 `4992090`）；本线随 M9 集成波在 `85c0dd9` 收尾。本行之上的历史批准记录原样保留，不代表当前仍在进行。
> 现状注（2026-09-11 维护）：Data Models §2 与 Hook Exposure 表的 activity 关联在维护中补齐——authority 经 `sessions.activity` 的公共只读面按 facade execution identity 读取投影**已证实**的 activity 记录，采用投影自身的证据分级（`observed`/`reconstructed`，永不升格），投影缺位/降级记 `unavailable`、投影健康但尚无证据记 `unknown`（三态不互代）；读取器在 `lib/session-interaction-operation.js` 以 ctx 派生默认注入，接线与回归见 `test/session-interaction-operation-authority.test.mjs`、`test/session-interaction-operation.test.mjs`、`test/session-interaction-operation-wire.test.mjs`、`test/integration-m9-loop-facts.test.mjs`。作者权仍在投影 owner，本线不建第二套 activity 状态机；历史批准记录不改写。

## Status

SPEC1 Stage 2 v2（2026-09-05 批次；2026-09-06 同批人类确认）。本文承接已获批方向（Goal）与已确认的 Stage 1 Requirements。v2 修订：本线 R 切片确认为 M9 共享 loop boundary slice（attempt 事实同时供 activity/checkpoint 消费，§3.1 联合登记；见偏离注 5）。本文确定官方 loader owner 证据、R 切片边界与内部契约、client 半面传输路径、装配顺序与失败/guard 策略。

## Overview

本 feature 在 host 与 client 提供受单一 operation authority 约束的 session interaction operation：`pluginApi.sessions.request` / `pluginApi.sessions.cancel`（host/client 同形）。所有外部 session 处理请求经一个 authority 提交 acceptance/dedupe/cancel/terminal；`appendMessage` 仍只是受限 durable mutation，启动处理必须显式 request。

设计遵循的边界：

1. **单一提交 owner**：operation terminal 只由本 feature 的 request authority 在提交点原子裁决；loop 侧的 R 切片只报告 attempt/提交事实，绝不各自 commit operation 终态。
2. **不猜 loop**：没有任何路径用 append→flush→猜事件模拟 request；官方 seam 缺失时返回 typed unavailable，而不是伪装完整 API。
3. **切面最小化**：R 切片只补"外部请求被 loop 接受/取消可达/attempt 事实"这一边界，是既有 `dsh-agent-loop` replacement owner 包内的扩展 feature（同组件同包第二 feature 先例：agent-loop 包内 assembled-context evidence slice），不新增 replacement 包、不新增行。
4. **词汇共享**：activity/execution/attempt/cursor 词汇全部来自 M9 共同契约与 `session-activity-projection` 冻结定义；本线不另造状态机。

## Current-State Findings

- 官方 request 边界事实：`dsh-agent`（行 `agent`，无 owner）per-agent ctx dispatch `agent/request`（waterfall，provider 侧消费）；`dsh-agent-loop`（行 `agent-loop`，owner 包 `plugin-api-agent-loop`）作为 agents factory（`agents.setFactory`），公开 `agentLoop.create/createAgent/resume`（门面亦有 `services.agentLoop` passthrough 与 `agents.create/resume` operation 面）。
- 官方 inbox 语义：`agent/inbox/spliced` 持久类型 + `agent/inbox/inserted|claimed|discarded` 事件；Inbox replay-once 投影，pending 分 `next-turn`/`next-step`。外部 user message 的 durable 写入与 inbox 拾取是官方既有路径（本 feature 复用，不绕过）。
- 官方 cancel 边界事实：agent-loop 内 `abort`/`cancel` 方法位为内部实现；无公开 operation/cancel ctx 事件、无公开 per-request 稳定 operation identity、无 attempt 终态事实出口（名字级盘点；Stage 3 以契约 probe 复核）。
- approval/tools/llm：`approval/request` decision waterfall、`tools/execute|pre-execute|post-execute`、`agent/pre-step`、`agent/request-error` 由官方/已交付 owner 消费；本 feature 不新增这些域的 slice（门在各域内部闭合）。
- durable append：`sessions.durable.appendMessage` 只接受 source-audited 有限 kind（M2 S2 边界）；request 的内容写入必须走该契约。
- 客户端传输：既有 `sessions.channels`（ack/resume 等 client→host 类型化 operation 传输先例）与 gateway/remotes client 面已交付；主包 client bundle 已随 `dsh.client` 注入 web profile。官方 `api-remotes` 转发白名单是 host→browser 事件的受限通道（本 feature 的 client 面走既有传输的请求/响应，不扩白名单）。
- 注册表现状：`sessions.request`/`sessions.cancel` 无占位/迁移记录；`sessions.requestHeader/requestContext`（已 removed，迁 `sessions.views.*`）与本 feature 的 verb 同名不同物，本 feature 明确不建立任何 alias。

## Architecture

```text
 browser plugin (Web UI)                 host plugin (auto-continue / automation)
      │ sessions.request/cancel                 │ sessions.request/cancel
      │ (client face, typed)                    │ (host face, typed)
      ▼                                        ▼
 ┌──────────────────────── client transport (delivered channel path) ──┐
 │                                                                      │
 │                 pluginApi.sessions request authority                 │
 │        (facade; SINGLE owner: acceptance / dedupe / cancel /         │
 │          terminal adjudication / audit)                              │
 │                         │ internal admission contract                │
 │                         ▼                                            │
 │        dsh-agent-loop owner pkg — interaction slice (R extension)    │
 │        admission-once · cancel propagation · attempt/end facts       │
 │                         │ (fork of official agent-loop row)          │
 │                         ▼                                            │
 │        loop attempts: durable append + inbox + approval/tools/llm    │
 └──────────────────────────────────────────────────────────────────────┘
      ▲
      │ shared activity vocabulary (sessions.activity projection, 只读消费)
```

装配：主门面 apply 内初始化 request authority（P 层）；authority 通过内部 symbol-keyed 契约探测 agent-loop slice 是否 active；slice active 且版本一致 → admission/cancel/attempt 事实可用；否则 authority 保持公共面并返回 typed unavailable（execute 面），绝不降级为 append 猜测。agent-loop owner 包的 fork 在自身 apply 自检通过后注册交互边界切片（切片是既有 replacement 包的一部分，不改变 patch 行）。

## Components And Interfaces

### 1. 公共面与 idiom（registry/catalog 登记在集成波完成）

| 公共成员 | runtime | idiom | 面 | effect | composition | scope | 说明 |
|---|---|---|---|---|---|---|---|
| `sessions.request` | host | operation | — | execute | exclusive | session | 单 session 并发策略；deduplicate 同 key |
| `sessions.cancel` | host | operation | — | execute | exclusive | session | signal 型操作；typed outcome；不伪造终态 |
| `sessions.request` | client | operation | — | execute | exclusive | session | 同形 client 面（既有通道传输封装） |
| `sessions.cancel` | client | operation | — | execute | exclusive | session | 同形 client 面 |
| `sessions.request.handle` / `sessions.cancel.handle` | both | operation | — | read | pure | session | operation handle 成员登记（`{id,ownerId,status(),observe(),dispose()}`） |
| `sessions.availability()` | host | selfDescription | — | read | pure | facade | 现有成员扩展 reason 口径（request/cancel 可用性分层） |
| client `sessions.availability()` | client | selfDescription | — | read | pure | facade | client 面可用性 |
| capability `sessions.request` | — | — | — | — | — | — | 根 `capabilities` 条目（集成波登记） |

client 领域树新增根 `sessions`（facade 语义面，与 `services.*` 下的官方 sessions 直通不同子树，无冲突）。

### 2. Request authority（facade 内部）

- 输入规格：`RequestSpec { sessionId, message?: { kind: 'user-message', text, attachmentRefs? }, idempotencyKey?, parent?/cause?, signal? }`；`message.kind` 只接受 durable append 层 source-audited 的 kind（v1：`user-message`），其余 rejected。
- 流程：validate（session 存在、owner 派生、kind 受审）→ dedupe 检查（同 owner 同 idempotencyKey 且未终态 ⇒ duplicate+既有 op 引用）→ 并发检查（同 session 已有活 operation ⇒ already-running）→ slice admission 契约单次受理 → 受理后经 audited durable append 写内容（source 标记）→ 关联 activity/execution（来自共享 projection 事实）→ 返回 operation handle。
- Terminal 提交：authority 是 operation terminal 唯一提交者；提交点把仍有效的竞争信号（cancel 请求、attempt 事实、deadline、域 deny 结果）按共享裁决优先级（`aborted` > `superseded` > `error` > timeout-`error`）收敛为唯一 terminal，原子提交后不可改写；迟到信号只作诊断/审计。
- Audit：owner、operationId、sessionId、时间、outcome 码、attempt 数、关联 id（无 payload 内容、无 secret）；v1 为 authority 内部有界内存诊断（不写 durable、不建 audit projection 子系统，Requirement 10 AC1）；记录写失败 ⇒ bounded gap marker，不伪造记录（Requirement 10 AC2）。

### 3. Agent-loop interaction slice（R 扩展，owner 包内）

- 位置：`packages/agent-loop`（既有 replacement 包，`@deepseek-ai/dsh-plugin-api-agent-loop`）新增 interaction 边界模块与测试；官方行 `agent-loop` 的 disabled+insert 结构不变（cap-strategy R1：只走既有官方 patch 机制、零官方包修改）。
- **共享切片（v2 联合契约）**：本切片是 M9 的共享 loop boundary slice——admission/cancel 契约归本 feature；attempt 生命周期/队列事实（`agent/attempt/start|end` + followUp）同时被 `session-activity-projection`（observed 终态/排队证据）与 `checkpoint-restore-contract`（live-attempt 前置条件、stop-coordination、自动捕获触发）消费；三个 feature 在 feature-list §3.1 联合登记同一 owner 包切片，attempt 事实词汇只定义一次（activity 设计 §3 载有消费侧契约）。
- 契约保真：fork 已完整复刻官方 `agentLoop` ctx 服务/事件面（cap-strategy R2/R4/R5/R6 由既有包自检延续）；切片只做加法：内部契约方法（非公共 path）：
  - `admit(operationSpec) → { accepted, attemptRef } | { rejected, code, reason }`（单次受理；幂等由 authority dedupe 保证）；
  - `cancelAttempt(attemptRef, { reason, signal })`（尽力传播到 attempt 及其 provider/tool 请求，返回 typed 结果）；
  - attempt 生命周期事实（见下事件）。
- 新 canonical 事件（集成波登 events.catalog；语义 `fact`；producer authority = agent-loop owner slice）：

| 事件 | payload 要点 | 语义 |
|---|---|---|
| `agent/attempt/start` | attemptId、operationId（外部 request 发起时）、executionId（如有）、sessionId、seq、observedAt | fact：loop 提交了一个 attempt 开始 |
| `agent/attempt/end` | 同左 + outcome（`success/error/aborted/denied/superseded` 的 loop 侧事实）、reason/classification（脱敏）、followUp（`none`\|`queued`，loop 提交点队列状态） | fact：loop 侧 attempt 终结事实（operation terminal 仍由 authority 裁决；followUp 供 activity 投影的排队/空闲 observed 判定） |

- 自检（cap-strategy R4–R6）：apply 在既有检查之上增加切片契约 probe（官方行 disabled、替代行唯一 active、runtime/包 `A.B.C` 一致、主包内部契约可解析且版本一致（compatible）、无组件 owner 冲突）；任一失败 ⇒ log + 保持既有官方契约行为 + 切片不激活（interaction 面按 unavailable 报告）。
- 客户端半面判定（capability-strategy §10 六问）：被替代官方行 `agent-loop` 无 client manifest、无 remote namespace、无 slot/settings bridge、无 host↔client 版本协商、无 browser state/reconnect、无 client-facing event/service ⇒ 六问全否 ⇒ **host-only slice**，无 client bundle 义务（记录于本表即证据）。
- 退役条件/上游提案：官方提供等价的外部 request acceptance/cancel/attempt 公开 seam（或官方 execution identity 常态化）后，切片退化为官方直绑；以 feature-list §3.1 登记的 U-series 上游提案承载。

### 4. Client half（B 传输封装）

- 宿主侧注册类型化 operation 方法端点（复用既有 channel 类 client→host 传输先例，与 `sessions.channels` ack/resume 同类机制；集成波核对并固定具体通道入口与 wire revision）。
- client 面：`ctx.pluginApi.sessions.request/cancel` 同形 stub；请求/响应 payload 在 host 侧脱敏后序列化，client 只做形状校验；offline/rebind/通道缺失 ⇒ typed `unavailable`（v1 不排队、不静默丢弃）；connection generation/epoch 变更后旧 handle/回调 stale-guard。
- 若既有通道在目标 profile 不可达（如 headless），client 面 availability 如实报告 degraded/unavailable，不影响 host authority。

#### 现状注：request message → durable 写入的适配（实现细节 + 已知缺口）

- 公共输入 `message.kind` 使用 source-audited 的请求词表（v1 `user-message`），durable 层只接受 surface message 词表（`user/message` 等）且要求完整消息形状 `{ id, role, content, source }`；门面在 durable 适配层做唯一映射（文本写入 `{ type:'text', text }`，`source: { kind:'user' }`），两侧词表互不泄漏。
- durable append 的写入目标是**活的官方 session 对象**而非 session id；id 由 host 侧解析，公共面继续只暴露 id。
- **已知缺口（登记，不掩盖）**：`message.attachmentRefs` 尚无 durable content block 映射。当前为 fail-closed —— 带附件的请求返回 typed `unavailable`（reason 明确指向附件未映射）且**不写入任何内容**，绝不静默丢弃附件或伪造纯文本写入。附件 content block 的公共语义与映射属交互接入线的正式范围，不在本线维护内解决。
- 写入失败时，authority 透出 durable 层自身的原因（bounded）：「content write failed」单句无法区分被拒绝、未映射与不可用。

#### 现状注：client operation status/observe 的 wire 承载（实现细节，无合同变更）

已交付的 client handle 形状（`{id,ownerId,status(),observe(),dispose()}`）要求 client 能持续获知 host operation 的真实进展。当前固定的实现细节如下：

- 路由 `/plugin-api/sessions` 除 `sessions.request` / `sessions.cancel` 外，新增方法 token `sessions.operation.status`：`{ ok:true, code:'status', status }` 返回与 handle 同源的 value-only 状态；未知/已终结并回收的 id 返回 `{ ok:false, code:'stale' }`，不伪造终态。
- accepted outcome 在 host 端经 value-only 投影后过线：handle 的方法成员（`status()` / `observe()` / `dispose()`）永不进入 wire，由 client 依 operation id 重建等价 handle；私有对象与函数一律不过线。
- client transport 的 `operation.observe` 以该 unary carrier 的状态路由做变更探测（carrier 本身无 push 语义）：首次投递最近快照后立即拉取一次，随后按 cadence 刷新，phase 变化即投递；到达 terminal 或 connection generation（epoch）变化即停止并清理，旧 generation 的回调绝不写入新代。
- 调用方 abort signal 经 carrier 传播到 host 路由并注入 request spec：请求仍在途时已 abort 的 signal 不会启动新 operation（authority 立即按 `aborted` 裁决），已 running 的 operation 由既有 cancel 传播路径处理，唯一终态语义不变。
- 未接线/通道缺失时 transport 不提供 `operation` 面，client 按既有降级路径报告 typed `unavailable`。

### 5. 并发与 retry 声明

- 并发策略：同 session **exclusive**（同时只允许一个活外部 request；冲突 ⇒ `already-running`）+ **deduplicate**（同 owner 同 idempotencyKey ⇒ 共享同一 operation 引用，不合并 execution identity）；queue 不在 v1。
- attempt 层级：loop 内部 retry/attempt 在同一 operation/execution 下新增 attempt（attempt 可有独立局部取消控制器）；attempt timeout 按 operation 能力声明决定是否进入下一 attempt；operation 已终态后禁止新 attempt；外部重新触发永远是新 operation（parent/cause 记录）。
- 自动 retry：默认无（未声明能力不自动重试）；恢复行为由 recovery authority 按其自动消费契约处理，本线不 double-consume。

## Data Models

### 1. Request outcome（判别式结果）

```js
{ ok: true,  code: 'accepted', operation: { id, ownerId, status(), observe(), dispose() },
  activity: { activityId?, executionId?, confidence } }
{ ok: true,  code: 'duplicate', operationRef: { id, statusUrl? } }          // 同 key 活操作
{ ok: true,  code: 'already-running', operationRef: { id } }                 // 同 session 活操作
{ ok: false, code: 'rejected' | 'denied', reason: string, domainCode?: string }
{ ok: false, code: 'unavailable', reason: string }
```

### 2. Operation status（handle 内部）

```js
{ phase: 'pending' | 'accepted' | 'running' | 'waiting' | 'terminal',
  terminal: { outcome: 'success'|'error'|'aborted'|'denied'|'superseded',
              reason?: string, classification?: string } | null,
  attempt: { attemptId?, attemptSeq?, startedAt?, endedAt? } | null,
  activity: { activityId?, executionId?, confidence },
  observedAt: number }
```

`waiting` 表达 approval/interaction 等待（与 activity 的 waiting 证据同源）；`settled` 等生命周期词不进入 status。

**confidence 词汇**（契约 §2.5，Requirement 6 AC3）：`unknown` = 投影/证据源健康但尚未观察到证据；`unavailable` = 投影或证据源不可用/降级；`degraded` 不进入 confidence 值域，属面级 availability 状态。

### 3. Cancel call

```js
{ sessionId?, operationId?, reason?: string, by?: 'user'|'owner'|'system' }
→ { ok, code: 'accepted'|'conflict'|'stale'|'invalid-input'|'unavailable', reason? }
```

### 4. 内部契约方法形状（slice ↔ authority；不公开）

```js
admit(spec)         → { accepted, attemptRef } | { rejected, code, reason }
cancelAttempt(ref)  → { ok, code }
attemptFacts        → agent/attempt/start|end 事件（authority 订阅，作为 terminal 裁决输入之一）
```

## Hook Exposure And Component Ownership

| 钩子/源 | 类别 | 引出方式 | 失败路径与 guard |
|---|---|---|---|
| durable append（内容写入） | A | 既有 `sessions.durable.appendMessage`（source-audited kind） | kind 不受审 ⇒ rejected；append 失败 ⇒ operation error/unavailable，不启动处理 |
| loop 受理/取消/attempt（切片） | R（既有 owner 包扩展） | 内部 symbol-keyed 契约 + `agent/attempt/start\|end` 事件 | 切片不激活/错配 ⇒ typed unavailable；自检失败仅 log+inert，无双跑 |
| approval / tools / llm / recovery gates | A | 域 owner 自行消费；本线只收 typed 结果/等待证据 | 域结果缺失 ⇒ waiting unknown 或 unavailable，不代答 |
| activity 关联 | A/B | `sessions.activity` 公共/内部只读投影 | projection 缺位/降级 ⇒ confidence=unavailable；证据未出现 ⇒ unknown（契约 §2.5 不互代，Requirement 6 AC3）；不另造状态机 |
| client 传输 | B | 既有 channel 类类型化传输（集成波固定入口） | 通道缺位 ⇒ client unavailable；host 侧脱敏先行 |

## Error Handling And Lifecycle

- 失败呈现（契约 §6）：P1/P2 统一错误；P3 `degraded/unavailable` view；业务冲突（duplicate/already-running/denied/stale/conflict）为 typed result，不伪装 boot 失败。
- 可用性：`sessions.availability()`（host/client 各自）与根 `capabilities` 表达 request/cancel 能力；切片 inactive 时 execute 面 unavailable、面状态 degraded（reason 指明边界未激活），主门面与其他能力不受影响；TUI/cli host 上下文走 host 面（同一 authority），可达能力差异沿 `sessions.availability()` 的 per-context degraded/unavailable 口径如实报告，v1 不为 TUI 新增专门面（Requirement 8 AC4）。
- 生命周期：authority 与切片都挂在各自 ctx 生命周期；卸载/重载时关闭 attempt 订阅与 observer，stale disposer/回调不得影响新代次；apply 全程 fail-safe。
- Redaction：request/cancel payload、reason、audit、client 负载逐出口脱敏；host 脱敏先行，client 只校验形状。

## Testing Strategy

1. Acceptance/dedupe/already-running（Requirement 1/3/5 + Requirement 2）：契约保真 loop fixture 上验证单次受理、duplicate 引用、already-running、rejected kind、denied 域码、unavailable 与 append provenance；operation handle 生命周期：terminal 唯一冻结不可改写、stale handle 返回 typed stale/no-op（Requirement 2 AC2/AC4）。
2. Cancel/adjudication（Requirement 4）：信号传播、提交窗口裁决优先级、终态后 stale cancel、child/parent 传播、provider 不可停时的正确终态、无伪造 aborted。
3. Attempt/retry（Requirement 5/7 + Requirement 6）：attempt 同 execution、新外部触发新 operation、默认不自动 retry、recovery 不 double-consume；activity correlation confidence 三态（projection 缺位 ⇒ unavailable、证据未出现 ⇒ unknown，Requirement 6 AC3）。
4. Slice 完整性（Requirement 11）：官方契约 parity、版本错配、boot 自检、owner 冲突、无双跑、移除恢复、切片 inactive 时 unavailable 报告；host-only 六问证据核对；共享 attempt 事实词汇机械一致性（Requirement 11 AC5）。
5. Client face（Requirement 9）：同形结果、offline/rebind typed unavailable、stale guard、host 脱敏先行断言、两 synthetic 插件反序。
6. Availability/audit/capability（Requirement 8/10）：`sessions.availability()` headless/web/TUI 同语义与 per-context degraded reason（Requirement 8 AC4）、capabilities 不带包/行身份（Requirement 8 AC5）、audit 记录无 payload 且写失败 ⇒ gap marker 不伪造（Requirement 10 AC1/AC2）。
7. Registry/catalog/shape（Requirement 12）：全部新行（含 client `sessions` 命名空间、`agent/attempt/*` catalog 条目）机械一致。
8. 终验：受护 `npm test`、`git diff --check`、registry/surface 一致性、官方包零修改审计、全局对抗性终审；证据不足即保持 unavailable，不宣布完成。

## Standards Applicability And Alignment

- `capability-strategy.md`: applicable（R1–R8 适用条款逐条落实；切片为既有 owner 包扩展；host-only 判定按 §10 六问记录证据；横切派发语义不进切片）。
- `api-shape.md`: applicable（operation 面与 durable mutation 分界；projection 只读消费；无策略混入）。
- `api-idioms.md`: applicable（operation/判别式结果/terminal/availability 词汇全部对齐；handle dispose 只请求停止）。
- `public-api-shape.md`: applicable（host/client 同形面；client 新增 `sessions` 语义根并登记；不建 alias；verb `request`/`cancel` 不注册化）。
- `composition-and-authority.md`: applicable（单一 operation authority；owner 派生；stale disposer；authority closure 只覆盖受支持路径，旁路（直接 append）显式声明不隐含启动处理）。
- `domain-composition.md`: applicable（sessions/executions/llm/tools/approval 域 gate 各归其主）。
- `ordering.md`: applicable（attempt 顺序由 authority 声明；无全局排序图）。
- `identity-and-lifecycle.md`: applicable（operationId/executionId 生成；attempt 不换身份；terminal 唯一；裁决优先级一致）。
- `durable-state-and-scope.md`: applicable（operation 能力声明；retry 分层；append 受审）。
- `visibility-and-redaction.md`: applicable（逐出口脱敏；client 半身更保守；secret 不出任何出口）。
- `concurrency-and-cancellation.md`: applicable（signal≠terminal、传播方向、提交资格、attempt timeout 与终态边界、disposer 所有权）。
- `versioning-and-protocols.md`: applicable（冻结基线；不新增包/行；client 传输 wire revision 仅当真实边界需要时引入并登记）。

## Key Decisions And Tradeoffs

1. **单一 authority 提交 terminal，切片只报事实**：杜绝"多个 owner 各自 commit"；代价是 authority 需要把 loop 侧 attempt 事实映射为 operation terminal，映射规则必须有 fixture 证明（Testing 2/3）。
2. **切片最小化（admission/cancel/attempt 事实）**：不把 route/admission/approval/tools 语义搬进切片；这些门留在各自域。
3. **client 半面复用既有 channel 传输**：不新增第二套传输；既有通道不可达时 typed unavailable 而非排队（v1 无 client 队列）。
4. **exclusive-per-session + deduplicate**：避免同 session 多请求竞争 loop 状态；多 agent session（agent teams）若后续需要并行 request，作为独立 capability 决策，不在本 v1 静默放开。
5. **切片 inactive 即 typed unavailable**：宁缺毋假；append→flush 猜测路径在任何 availability 状态下都不存在。

## M9 Contract Conformance And Deviation Notes

契约 §2/§3/§5/§6 逐条采纳。偏离记录（契约 §8；含补偿测试）：

1. R 协同收敛为单组件切片（见 requirements 偏离注 1）；`dsh-session`、`dsh-llm`、`dsh-tools`、approval 未新增 slice，理由：durable append/inbox（session 侧）、turn 边界（llm 侧）、approval/tools gate（各自域）均已由既有行/域闭合；无契约缺失要补。补偿：切片激活/未激活双态 parity 与 unavailable 测试。
2. client 半面 v1 交付（requirements 偏离注 2）；client 领域树新增 `sessions` 语义根属本设计定稿（契约未预置 client path）。
3. `agent/attempt/start|end` 为本线新增 canonical 事件词汇（集成波登 catalog；producer authority = agent-loop owner slice），不使用任何治理编号/批次字样的运行时名称。
4. 契约 §7.1 共享文件边界遵守：本线在并行期只写 `docs/specs/session-interaction-operation/**` 与既有 `packages/agent-loop`（该包官方组件 owner 属本线切片范围）；registry/feature-list/README/共享测试由集成波统一更新。
5. 共享切片联合登记（v2）：`packages/agent-loop` 的 loop boundary slice 同时服务 interaction（admission/cancel）、activity（attempt 终态/队列事实）与 checkpoint（live-attempt 前置条件、stop-coordination、自动捕获触发）三个 feature，feature-list §3.1 联合登记；切片由 agent-loop owner 包实现一次，attempt 事实词汇只定义一次。

## Design Completion Condition

本设计覆盖全部 Stage 1 requirements（Requirement 1–12）：request/cancel/operation/attempt 语义与 vocabulary 冻结；R 切片边界、自检与退役条件明确；client 半面传输与 host-only 判定证据齐全；全部钩子有失败/guard 策略；registry/catalog 拟新增行与并发/retry 声明成文。用户确认前的修订就地更新本文与 requirements 对应条目。
