# Slice Consumption Contract — session-activity-projection（W1.3 契约镜像）

> 本线对 agent-loop attempt-facts 切片（`packages/agent-loop` 既有 replacement 包内，由 `session-interaction-operation` 线实现）的**消费侧契约镜像**。实现事实源：`lib/session-activity-contract.js`（冻结词汇与校验器）+ `lib/session-activity-adapters.js`（消费适配器）。本文件只描述消费；切片本体实现权属 interaction 线，本线不实现、不修改。

## 事件与 payload（逐字段冻结，R9 AC3）

### `agent/attempt/start`

| 字段 | 类型 | 语义 |
|---|---|---|
| `attemptId` | string（必填） | attempt 身份；同一 execution 的内部 retry 是**新 attempt、同一 activity**（R8 AC1） |
| `operationId` | string（外部 request 发起时有） | interaction operation 关联；本线消费侧仅校验存在性，不将其纳入 activity correlation 模型（operation 关联由 interaction 线表达） |
| `executionId` | string（有则带） | execution correlation（observed 档） |
| `sessionId` | string（必填） | 归属 session；活动的唯一 scope |
| `seq` | int ≥ 0（必填） | 切片事实序号；cursor 语义，不作 identity |
| `observedAt` | ISO string（必填） | 事实发生时间 |

### `agent/attempt/end`

`attemptId` / `operationId` / `executionId` / `sessionId` / `seq` / `observedAt` 同 start，另加：

| 字段 | 类型 | 语义 |
|---|---|---|
| `outcome` | `success|error|aborted|denied|superseded`（必填） | loop 提交点终态事实（observed） |
| `reason` | string（脱敏、有界） | 终端原因文本；`ui` 受众不透出，`diagnostics` 受众有界可见 |
| `classification` | string（脱敏） | 终端分类词 |
| `followUp` | `none|queued`（必填） | post-attempt 队列状态：`queued` ⇒ terminal record 上的 observed queue fact + 会话级 current-queue marker（独立呈现，绝不把 terminal 改写回 waiting）；`none` ⇒ 空闲事实 |

## 消费方行为约束

1. 切片活性门控：`setSliceState({active, versionMatched})` 全真才受理 attempt 事实；否则拒绝（`ingestAttemptFact` 返回 false）并走降级路径——投影按 availability 如实降级（`terminal-evidence=reconstructed` / `attempt-facts=version-mismatch`），**绝不把猜测标成 observed**（R3 AC4 / R10 AC2）。
2. 只读订阅：适配器只订阅 `agent/attempt/start|end` 事件并校验 payload；不 dispatch、不 transform、不 veto（R11 AC2）。
3. 不冒充 durable：attempt 事实为 in-memory 事件；host 重启后丢失 ⇒ 重建视图只对 durable 可再现事实保留 observed（R6 AC2）。
4. 观测契约 marker：`Symbol.for('dsh-plugin-api.session-activity.observation-contract')`（`activityObservationContract()`：version 1 + 字段清单 + 校验器）供切片 apply 自检核对「facade's internal observation contract is compatible」（R9 AC4）；装配级验证归集成波 I4。
5. 词汇机械一致性：本镜像与 interaction/checkpoint 线声明必须逐字段一致（共享词汇机械一致性测试，集成波 I3）。