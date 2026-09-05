# Stage 2 - Design

> feature_name: `session-activity-projection`
> milestone: M9
> status: SPEC1 Stage 2 已确认（v2，2026-09-06 人类批准；与 Requirements v2 同批）；Stage 3（Tasks）待进行——Tasks 经对抗性审查门通过后进入 Stage 4。

## Status

SPEC1 Stage 2 v2（2026-09-06 同批人类确认）。本文承接 v2 Requirements（同批已确认）。v2 相对 v1 的实质修订：从"v1 零 R、superseded/aborted/settle 靠 reconstruction"改为**采纳 R**——与 `session-interaction-operation` 共用 `dsh-agent-loop` owner 包上的 loop boundary slice（attempt 生命周期/队列事实），把终态与排队判定升级为 observed；切片缺位时投影降级并如实报告。

## Overview

本 feature 在 host 门面 `pluginApi.sessions.activity` 提供只读 session activity projection：单一投影 owner 订阅官方事实（agent-loop durable 记录与状态事件、tools/approval 证据、session durable firehose）与 **R 切片 attempt 事实**，按证据分类收敛为冻结 snapshot，并提供 `current/get/list/history/observe/availability`。

边界不变：投影不拥有执行（调度/重试/终态提交/取消/通知都属各自 authority）；本 feature 只读已提交事实并显式标注推断；不是 scheduler/execution owner。新增的 v2 设计要点：**保真度分层**——full 安装（切片 active）交付 observed 级终态/排队事实；切片 inactive 时降级为 reconstruction 并在 availability 明示；重启后 in-memory 切片事实不冒充 durable（Requirement 6 AC2 规则）。

## Current-State Findings

- 官方证据源（名字级盘点，Stage 3 契约 probe 复核）：见 v1 相同事实，核心为——`dsh-agent-loop`（官方行 `agent-loop`，owner 包 `plugin-api-agent-loop`）持久类型 `request/header`、`turn/start|end`、`step/start|end`、`user/message`、`assistant/message`、`tool/call|result` 等；事件 `agent/status`、`agent/error`、`agent/inbox/inserted|claimed|discarded`；waterfall `agent/pre-step`、`agent/request-error`（本 feature 只订阅）。`dsh-session` firehose `session/event` + `session/created|disposed|flush`。`dsh-user-approval` 持久 `approval/asked|decided|policy`。`dsh-tools` 事件/持久 `tools/*`。
- **v2 关键缺口事实**：官方无 abort/supersede/settle 的公开事实出口、无稳定 per-execution identity、无"排队 vs 空闲"的公开判定（inbox `hasPending` 为内部）；这些事实只存在于 agent-loop 的提交点内部。v1 只能 reconstruction；v2 由既有 owner 包 fork 在其真实提交点发出 attempt 事实（R）——该 fork 已完整复刻官方行契约，扩展是纯加法。
- 既有可复用底座：`sessions.durable.*`（epoch-local observer、no-catch-up、`get/list` 读取）；`executions.observe/get/history` 语义模板。
- registry 现状：`sessions.activity.*` 零占位；`agent/attempt/*` 零占位（v2 新增 catalog 条目由切片 producer authority 登记）。

## Architecture

```text
                  third-party consumers
    current/get/list/history/observe/availability
                      │
            pluginApi.sessions.activity
             (facade projection owner; 只读; 单一状态 owner)
                      │
   ┌──────────────────┼─────────────────────────────┐
   │                  │                             │
 evidence adapters    │                    durable joiner
 (官方事件, observe)  │                    (cursor replay/dedupe)
   │                  │                             │
   ▼                  ▼                             ▼
 ┌───────────────────────────────────────────────────────┐
 │ loop boundary slice (R, dsh-agent-loop owner 包共享)   │
 │ agent/attempt/start · agent/attempt/end               │
 │ (outcome 五值 + followUp none|queued, 提交点发出)       │
 └───────────────────────────────────────────────────────┘
   │ session/event firehose · durable turn/step/request
   │ tools/result|change · approval/asked|decided
   ▼
 session activity store (per-session, in-memory, rebuildable)
 + observer hub (epoch-local) + availability probes
```

生命周期：切片 active 时 attempt 事实适配器提供 observed 输入；切片 inactive 时该适配器关闭，对应字段回到 derivation 规则（reconstruction/unknown），availability 报 degraded。宿主重启后 in-memory attempt 事实丢失：重建视图只对 durable 可再现的事实保留 observed，其余按 Requirement 6 AC2 降级。

## Components And Interfaces

### 1. 公共面与 idiom（registry 登记在集成波完成）

| 公共成员 | idiom | 面 | effect | composition | scope | 说明 |
|---|---|---|---|---|---|---|
| `sessions.activity.current(sessionId)` | projection | projection | read | pure | session | 当前活动冻结 snapshot 或 typed absence |
| `sessions.activity.get(activityId)` | projection | projection | read | pure | session | 单条活动记录 |
| `sessions.activity.list({sessionId,cursor?,limit?})` | projection | projection | read | pure | session | seq 顺序分页 |
| `sessions.activity.history(sessionId)` | projection | projection | read | pure | session | 过去活动（受 durable 证据边界限制） |
| `sessions.activity.observe({sessionId})` | projection | projection | subscribe | additive | session | handle `{current(),subscribe(listener),dispose(),epoch}` |
| `sessions.activity.observe.handle` | projection | projection | read | pure | session | handle 成员登记 |
| `sessions.activity.availability()` | selfDescription | — | read | pure | facade | `{status, reason?}`（含 fidelity 分层） |
| capability `sessions.activity` | — | — | — | — | — | 根 `capabilities` 词表条目（集成波） |
| capability `sessions.activity.attempt-facts` | — | — | — | — | — | fidelity-relevant 切片能力词条（中性名，不带包/行身份；Requirement 10 AC6；集成波登记） |

### 2. 内部结构

- **activity store（per-session）**：内存态、可从 durable 证据重建；不写任何 durable 记录。活动记录字段含 identity、correlation、status/terminal、证据分类、seq、cursor、observedAt。
- **evidence adapters**：官方事件面只读 adapter（source+seq+observedAt）+ **切片 attempt 事实 adapter**（R；运行门控）。attempt 事实 adapter 缺位 ⇒ 对应字段走 derivation 规则。
- **derivation 引擎**：reconstruction 规则表（见 Data Models §2）只在无 observed 事实时生效；规则输出必须带 `reconstructed` 标注与规则名。
- **durable joiner / observer hub / availability probe**：同 v1；epoch 重建关闭旧 epoch observer。observer hub 的订阅登记携带调用方 owner context：调用方 dispose/reload/owner context 结束时仅移除该 owner 的监听（Requirement 12 AC3），与投影 owner 的 epoch 重建正交。

### 3. Loop boundary slice（R，与 interaction 共享；本 feature 的消费契约）

- 位置：`packages/agent-loop`（既有 replacement 包）内共享切片模块；官方行 `agent-loop` disabled+insert 结构不变（cap-strategy R1）。切片承担三个功能域（同一实现、分属三 feature 契约）：
  1. **request admission/cancel boundary** —— 契约属 `session-interaction-operation`；
  2. **attempt 生命周期事实** —— 契约属本 feature 与 interaction 共用（本 feature 消费 observed 终态/排队证据）；
  3. （checkpoint 线消费同一事实集做 live-attempt 前置条件与自动捕获触发，见该线设计）。
- 事实事件（catalog 登记；semantics=`fact`；producer authority = agent-loop owner slice）：

| 事件 | payload 要点 | 本 feature 用途 |
|---|---|---|
| `agent/attempt/start` | attemptId、operationId（外部 request 发起时）、executionId（request 发起时有）、sessionId、seq、observedAt | activity 开始/执行中证据（observed） |
| `agent/attempt/end` | 同左 + outcome（`success/error/aborted/denied/superseded`，loop 提交点事实）、reason/classification（脱敏）、followUp（`none`\|`queued`，loop 内部队列状态） | terminal（observed）、排队 vs 空闲（observed）、superseded 归因 |

- 自检/版本/owner/无双跑：同 `session-interaction-operation` 的 Requirement 11 语义（fork 既有自检延续 + 切片契约 probe）；失败 ⇒ log + 切片不激活 + 官方契约行为照常（投影降级），绝不双跑、绝不留下官方行禁用而无替代的空洞。
- 客户端半面判定（capability-strategy §10 六问）：被替代官方行 `agent-loop` 六问全否 ⇒ host-only（记录即证据）。
- 退役条件/上游提案：官方提供公开 attempt/settle/queue seam 后切片退化为直绑（feature-list §3.1 U-series 登记）。

### 4. R 决策表（v2）

| 候选官方组件 | 候选语义 | v2 决策 | 证据/说明 |
|---|---|---|---|
| `dsh-agent-loop`（`agent-loop` 行，既有 owner 包） | attempt 终态/排队事实、supersede/abort observed 判定 | **采纳 R（共享切片）** | fork 完整复刻官方行（cap-strategy R2）；事实只在真实提交点发出；无该切片时相应能力只是降级而非丢失 |
| `dsh-session`/`session-projection`（session durable owner） | durable 活动记录 owner | 不采纳 | 事件与 durable 记录已公开（A）；投影不写 durable，无记录 owner 缺失；官方 durable per-request identity 为 C 类上游提案 |
| `dsh-llm`（`llm` 行，既有 owner 包） | stream settlement | 不采纳 | turn 终结由 durable `turn/end`/`assistant/message` 边界承载（A），无缺失语义 |
| `dsh-tools` / `dsh-user-approval`（无 owner） | tool/interaction evidence | 不采纳 | `tools/result`、`tools/change`、durable `tool/call|result`、`approval/asked|decided` 已公开（A 直绑） |
| question 事实（`dsh-user-questions`） | waiting-question observed | 不采纳（C） | 无稳定公开 dispatch/持久面；R 契约不可证明；官方 seam 落地后加 adapter |

## Data Models

### 1. Activity record（store 内部，public snapshot 投影字段）

```js
{
  activityId: string,            // facade 生成
  sessionId: string,
  kind: 'turn' | 'execution' | 'unknown',   // store 内部字段，不投影进 public snapshot；其 unknown 与证据分类不同轴（见下）
  execution: { executionId, attemptId, correlationConfidence, parentExecutionId },
  status: {                       // 进行中
    phase: 'preparing'|'running'|'waiting'|'interrupted',
    waiting: { kind: 'approval'|'question'|'user-message'|'tool'|'queued', confidence } | null,
    confidence,
  } | null,
  terminal: {                     // 结束；唯一不可改写
    outcome: 'success'|'error'|'aborted'|'denied'|'superseded',
    confidence: 'observed'|'reconstructed',
    reason, classification,       // 有界、脱敏
    byActivityId?,                // superseded 归因（切片事实提供时）
    followUp: 'none'|'queued' | null,   // 切片 end payload 观察到的 post-attempt 队列事实（Requirement 3 AC3）；会话级当前队列标记独立呈现，区别于进行中 waiting.kind=queued
  } | null,
  facts: [ { fact, source, seq, observedAt, confidence } ],   // 摘要级
  gap: {...} | null,
  seq, updatedCursor, observedAt, epoch,
  fidelity: { sliceObserved: boolean, note? },   // 可见保真度（v2）
}
```

**confidence 值集**（Requirement 2 AC1，四个成员不互相折叠）：`status`/`correlation` 字段取 `observed | reconstructed | unknown | unavailable`；`terminal.confidence` 实际仅 `observed | reconstructed`——终态一旦成立即 final（Requirement 3 AC2），不存在 unknown 的终态，源不可达经 `unavailable`/视图级 marker 表达（Requirement 6 AC3、Requirement 10 AC3）。`kind` 为 store 内部轴，不进入 public snapshot，其 `unknown` 与证据分类 `unknown` 不同轴。

### 2. Derivation 规则表（切片 inactive/重启后的降级路径）

| 目标事实 | observed 证据（切片 active） | reconstructed 规则（降级路径） | unknown 条件 |
|---|---|---|---|
| 开始/执行中 | `agent/attempt/start`；durable turn/step 边界 | — | 源缺失 |
| terminal success/error | `agent/attempt/end` outcome（提交点） | durable `turn/end`+空闲边界 ⇒ success；`agent/error` ⇒ error | 证据不全 ⇒ unknown |
| terminal aborted | `agent/attempt/end` outcome=aborted | 无可靠规则：取消证据缺口 ⇒ unknown | 默认 unknown |
| terminal superseded | `agent/attempt/end` outcome=superseded（含 byActivityId） | 新 user/turn 边界落在旧 turn 未 end ⇒ superseded（规则名 superseded-by-boundary） | 输入不全 ⇒ unknown |
| terminal denied | `agent/attempt/end` outcome=denied；approval/decided durable 拒绝经 joiner（correlation 许可） | approval 拒绝 durable + correlation 可证 ⇒ denied（规则名 denied-by-approval） | 无可靠规则 ⇒ 默认 unknown |
| 排队 vs 空闲 | `agent/attempt/end` followUp（none\|queued） | 无规则（避免误判"排队中"为 idle 或反之）⇒ waiting unknown/queued 缺省 unknown | 无 observed ⇒ unknown |

### 3. 快照脱敏与保真声明

同 v1：正文不进 snapshot；reason 有界脱敏；owner-private/secret 不出任何出口。`fidelity` 字段让消费者一眼知道当前安装/重启后处于 observed 还是降级档。

## Hook Exposure And Component Ownership

| 钩子/源 | 类别 | 引出方式 | 失败路径与 guard |
|---|---|---|---|
| `session/event` firehose + durable 记录 | A | ctx.on 只读 + joiner | 订阅失败 ⇒ unavailable；迟到/乱序去重+gap；不改写 |
| `agent/status|error`、`agent/inbox/*` | A | ctx.on 只读 | 同上；waterfall 只 observe |
| `tools/result|change`、durable `tool/*` | A | ctx.on/joiner | 同上 |
| `approval/asked|decided` | A | joiner/只读监听 | 同上 |
| `agent/attempt/start\|end`（共享切片） | R | 只读订阅；切片 active 门控 | 切片 inactive/错配 ⇒ adapter 关闭 + fidelity 降级 + availability degraded；绝不半装配 |
| question 等待 | C（seam 缺失） | v1 无稳定事实 ⇒ unknown | 上游提案；官方 seam 后加 adapter |
| execution identity | B | facade execution 层；切片回显 request 发起 executionId | 无身份证据 ⇒ unknown |

## Error Handling And Lifecycle

- 失败呈现（契约 §6）：P1/P2 统一；P3 视图级 degraded/unavailable（源缺失、切片 inactive、证据缺口）；业务性 absence/invalid-input 用 typed result。
- availability：含 fidelity 分层（Requirement 10 AC2）；健康/诊断归 diagnostics。上下文一致性（Requirement 12 AC5）：headless/web-host/TUI-host 在同一 runtime identity 下呈现相同 query/observe 语义，仅按该上下文可及源报告 per-context degraded（headless host 为主交付面；client 原始投影属 host-only v1 偏离注 1 范围）。
- 生命周期：owner 初始化 = probes → store 懒建 → observer hub；停用 = hub → adapters（含切片订阅）→ store；切片订阅随切片 lifecycle 联动，绝不留下 stale 订阅。
- stale containment：写 store/通知前检查 owner/generation/epoch/terminal 资格（Requirement 7 AC1）；切片事实与官方事件同等遵守。

## Testing Strategy

1. 纯契约与降级规则（Requirement 2/3/6/8）：derivation 表逐行 fixture；overclaim（silence→success、reconstructed→observed）断言不可能；`denied` 的 observed/reconstructed/unknown 各档 fixture（Requirement 3 AC3/AC4）。
2. 切片（Requirement 9）：官方契约 parity、版本错配、boot 自检、owner 冲突、无双跑、移除恢复；切片 active 时 observed 终态（含 `denied`）与排队 fixture；inactive 时 reconstruction/unknown fixture；start/end 事件 payload 形状断言（Requirement 9 AC3）。
3. 官方源绑定与查询/订阅（Requirement 1/4/5）：真实/契约保真 fixture；重建时 identity/seq/cursor 确定性（Requirement 1 AC1）；两 synthetic 插件反序证明查询/订阅独立性（Requirement 12 AC1）、owner context 清理（Requirement 12 AC3）、无效输入隔离（Requirement 12 AC2/AC4）与监听器异常 containment（Requirement 5 AC2）。
4. 重连/stale/重启（Requirement 6/7）：迟到事件、重复 durable、cursor gap、epoch rollover、旧 disposer、host 重启后 observed→reconstructed 降级；replay 时 `unknown`/`unavailable` 单值标记（Requirement 6 AC3）。
5. redaction/audience（Requirement 4 AC6、Requirement 13 AC5；含切片 end payload 的 reason/classification 脱敏，Requirement 9 AC3）：snapshot/日志敏感字段机械断言。
6. availability（Requirement 10）：逐源缺失 + 切片 inactive 的 status/reason 断言；per-context degraded 报告（Requirement 12 AC5）；P1/P2 路径。
7. 集成波（契约 §7/§8）：registry/surface/catalog（`agent/attempt/*`）一致性、与 interaction/attention/checkpoint 的共享词汇机械比对、受护 `npm test`、`git diff --check`、官方包零修改审计、全局终审。

**Requirement → testing 追踪**：Req 1 → 桶 3；Req 2 → 桶 1；Req 3 → 桶 1/2；Req 4 → 桶 3/5；Req 5 → 桶 3；Req 6 → 桶 1/4；Req 7 → 桶 4；Req 8 → 桶 1/2；Req 9 → 桶 2；Req 10 → 桶 6；Req 11 → 桶 1/7；Req 12 → 桶 3/6；Req 13 → 桶 1/2/4/5/7。

## Standards Applicability And Alignment

- `capability-strategy.md`: applicable。采纳 R（既有 owner 包扩展；R1–R8）；未采纳项 A 类证据；横切派发语义不进本 feature；选择性安装降级语义遵循 §6.2 与 `versioning-and-protocols.md` §3/§6。
- `api-shape.md`: applicable。单一 projection 面；只读；无 policy/mutation。
- `api-idioms.md`: applicable。verb/handle/availability 对齐；`agent/attempt/*` catalog 条目带 eventSemantics=fact 与 producer authority。
- `public-api-shape.md`: applicable。挂 `sessions` 领域树；不建 alias。
- `composition-and-authority.md`: applicable。单一投影 owner；切片只报事实，不提交 authority；stale/disposer 纪律。
- `domain-composition.md`: applicable。领域只读边界；切片事件由 agent-loop owner 生产、投影只消费。
- `ordering.md`: applicable。seq 投递；无全局排序图。
- `identity-and-lifecycle.md`: applicable。identity 生成与 terminal 词汇一致；attempt 不换身份。
- `durable-state-and-scope.md`: partially applicable。投影与切片事实均非 durable；重启降级规则显式（Requirement 6 AC2）；无新 scope/存储。
- `visibility-and-redaction.md`: applicable。host 侧脱敏先行；切片 payload 的 reason/classification 有界脱敏。
- `concurrency-and-cancellation.md`: applicable。提交资格/stale/裁决窗口/observer 所有权显式。
- `versioning-and-protocols.md`: applicable。冻结基线；切片扩展既有包，无新包/新行；无新增 wire/durable revision。

## Key Decisions And Tradeoffs

1. **采纳共享 loop boundary slice（v2 核心）**：把 Goal 六态中最关键的"superseded vs queued / aborted / idle"从猜测升级为提交点事实。成本：与 interaction 共用同一切片，词汇/实现必须联合登记（§3.1）；收益远大于成本。
2. **保真度分层 + 诚实降级**：full 安装默认全保真；切片缺位/错配/重启后降级并明示。这是安装模式语义，不是能力打折——选择性安装本来就不承诺未装 slice 的能力（`versioning-and-protocols.md` §6）。
3. **证据分类进公共模型 + fidelity 字段**：消费者（含同批线）永远知道自己是 observed 还是降级档，杜绝把 projection 当 ground truth。
4. **attempt 事实不冒充 durable**：in-memory 事件、重启丢失 → 降级规则兜底；不为此把投影改成 durable writer（Requirement 11 边界）。
5. **host-only v1**：client 原始投影后置（偏离注 1）。

## M9 Contract Conformance And Deviation Notes

契约 §2/§3/§5/§6 逐条采纳。偏离记录（契约 §8）：

1. host-only v1（requirements 偏离注 1）。
2. 共享切片契约与 interaction 联合登记（requirements 偏离注 2）；本设计 §3 为该切片的 activity 侧契约。
3. 诚实降级语义（requirements 偏离注 3）。
4. 契约 §7.1 共享文件边界：本线在并行期只写 `docs/specs/session-activity-projection/**`；`packages/agent-loop` 共享切片的实现由 `session-interaction-operation` 线（agent-loop owner 包）承担，activity/checkpoint 只读消费其契约；feature-list §3.1 登记同一条共享 capability，集成波统一装配与注册。

## Design Completion Condition

本设计覆盖 v2 requirements（Requirement 1–13）：共享切片契约与保真分层成文；数据模型含 fidelity 字段与降级规则；R 决策表逐组件证据齐全；残余 C 附证据与退役条件；registry/catalog 拟新增行齐备；失败/guard 策略逐钩子声明。用户确认前的修订就地更新本文与 requirements 对应条目。
