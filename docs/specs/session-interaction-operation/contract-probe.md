# Contract Probe — session-interaction-operation (Task 1)

> 本文件是 Stage 3 契约 probe 复核（design Current-State Findings「Stage 3 以契约 probe 复核」；tasks.md 任务 1）的取证与裁决记录。probe 只读取证，不产生实现。裁决结果：**Exit B（R 切片实现）**。
> 记录日期：2026-09-06；probe 依据为本机官方安装树 `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（官方 runtime `0.1.0-rc.6`）。

## 1. Probe 清单与取证

### 1.1 官方 `dsh-agent-loop` 公开服务/事件面

| 项 | 取证 | 结论 |
|---|---|---|
| 服务公共成员 | `lib/types/index.d.ts` `AgentLoop extends Service implements AgentFactory`：`config`（`config` 属性）、`create(id, options?, meta?)`、`createAgent(ownerCtx, options?)`、`resume(ownerCtx, options?)`；其余 `prepare` / `restoreOrCreateConfigured` / `setupAndPublish` / `resumeWith` / `reportConfiguredStartupFailure` 均为 `private` | 公开面只有 config + 三个 agent 创建/恢复驱动方法；**无外部单请求 admission/dedupe API** |
| 事件面 | `Context.Events` 仅声明 `agent-loop/config-start-failed`（emit，`{ sessionId, error }`） | **无 per-request operation/cancel/attempt 终态公开事件** |
| per-request identity | 类型面无 `operationId` / `attemptId` / request-acceptance 相关公共成员 | 无稳定外部 request identity 出口 |

### 1.2 官方 `dsh-agent` 派发面（外部分发/拾取是否可充当 acceptance authority）

| 项 | 取证 | 结论 |
|---|---|---|
| `agent/request` | `runtime-types.d.ts` `'agent/request'(this: Scoped<Agent>, payload: ...)`（waterfall，provider 侧模型配置替换） | 是每个 agent 单次模型请求的路由瀑布，**不是**外部 request 的接受/受理 authority |
| `agent/inbox/inserted|claimed|discarded` | `runtime-types.d.ts` 各事件为 inbox 变更通知（`{ agent, message }` 等） | 是**投影通知**；拾取动作在 agent-loop 驱动内部，无公开单请求幂等受理 |
| `agent/pre-step` / `agent/turn-stopping` / `agent/request-error` | waterfall/serial 类事件 | 单步/回合边界决策点，非外部 request 提交面 |
| Inbox 投影 | `dsh-agent/lib/types/inbox.d.ts`：`hasPending`（公开布尔）、`claim` / `splice` / `cancel` 等方法 | `hasPending` 是 **Inbox 实例**成员（agent 内部可及），**不是**对外稳定「排队 vs 空闲」运营判定的公开权威；无 per-request queue 状态出口 |

### 1.3 官方 durable 会话记录（是否足以作为 attempt 终态事实）

| 项 | 取证 | 结论 |
|---|---|---|
| `turn/start`、`turn/end` | `dsh-session/lib/types/types.d.ts`：`turn/start { turn }`；`turn/end { turn, reason: TurnEndReason }`；reason 为 `completed | aborted | blocked | error | max-tokens | interrupted` | durable 回合边界存在，但：
1) 不携带外部 request identity（无 `operationId`）；
2) 无 `superseded`（该词不在 TurnEndReasonMap）；
3) 无 `followUp`（排队 vs 空闲）字段 —— followUp 只能从 loop 内部 `inbox.hasPending` 在提交点观察 |
| `step/start`、`step/end` | 同文件 `{ turn, step }` | 步骤边界，非 attempt 事实 |
| `request/header` | `types.d.ts` 全量 request 快照 | 非 per-request operation 身份 |
| `agent/inbox/spliced`（持久 inbox 投影） | `dsh-agent/lib/index.js:149-164` 消费 | 持久 inbox 只有 splice 结构，无 accept/cancel/terminal 语义 |

### 1.4 replacement fork 内部 cancel 位（可被门面稳定消费吗）

| 项 | 取证 | 结论 |
|---|---|---|
| `ReactLoopAgent.cancel(cause, options)` | `packages/agent-loop/lib/forked-loop.js:484`：清 inbox（除非 `keepInbox`）+ `phase.abort.abort(cause)` | 内部实现；**无公开 per-request operation 身份的 cancel ctx 事件/API**；对外可消费的只有新增内部契约（本线切片） |
| `phase.abort` / `wakeDriver` / `kick` | 同文件 470-570 | 内部 driver/phase 状态机；`kick()` 内 `while(await this.turn())`，turn 顺序无外部 request 归因 |

### 1.5 版本锁定事实

| 项 | 取证 |
|---|---|
| 官方 `dsh-agent-loop` | `package.json` `version = "0.1.0-rc.6"`（与既有 replacement `packages/agent-loop` 锁定一致） |

## 2. 裁决：Exit B（R 切片实现）

官方公开面（组合 1.1–1.4 证据）**不足以支撑**本 feature 的等价语义：

- 无外部 request 的单一接受/幂等/去重 authority 公开 seam；
- 无 per-request 稳定 operation identity 与公开 cancel/abort 契约；
- 无 attempt 终态事实出口（`superseded`、`followUp` 词汇在官方 durable/事件面不存在）；
- 现存 `agent/request` / `agent/inbox/*` / durable `turn/*` 只能作为**投影/重建**输入，达不到「observed 终态/排队事实」与「单次受理」的验收要求。

因此按 design Current-State Findings 与 tasks.md 任务 1 的 **Exit B** 执行：在既有 `dsh-agent-loop` replacement owner 包内实现共享 loop boundary slice（admission/cancel 边界 + `agent/attempt/start|end` 事实）；官方 seam 在切片缺位时无法支撑 typed 语义，公共面按 typed `unavailable` 诚实降级，绝不 append→flush→猜 loop。

## 3. 附：probe 边界说明

- probe 为只读取证；上述取证的官方文件与行号基于 runtime `0.1.0-rc.6`（`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop`、`dsh-agent`、`dsh-session`）。
- 本文件是本线 spec 制品；feature-list §3.1 的 U-series 登记与 registry 登记仍按任务 4.4/11.2 在集成波完成。