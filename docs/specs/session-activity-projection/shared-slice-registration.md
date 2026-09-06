# Shared Slice Joint Registration Draft — session-activity-projection（W11.3）

> `session-interaction-operation` / `session-activity-projection` / `checkpoint-restore-contract` 三线在 feature-list §3.1 的**共享切片联合登记草稿**（requirements R9 AC10）。本文件由 activity 线产出其消费侧部分；integration 线产出其 operation 侧部分、checkpoint 线产出其 live-attempt 侧部分；集成波 I2 将三份草稿合并为一条共享 capability 登记落表，attempt 事实词汇只定义一次。

## 共享 capability 登记主体（草稿）

- **能力名（中性，不带包/行身份）**：`agent-loop attempt-facts`（运行时/登记用词均不含治理编号或批次后缀）。
- **实现位置**：既有 `@deepseek-ai/dsh-plugin-api-agent-loop` replacement 包（唯一 owner `@deepseek-ai/dsh-agent-loop`，替代官方行 `agent-loop`，完整复刻官方行契约之上加法扩展——cap-strategy R2）。
- **承载功能域**（同一切片，三个契约分属三线）：
  1. request admission/cancel boundary —— 契约属 `session-interaction-operation`；
  2. attempt 生命周期事实（`agent/attempt/start|end` + followUp）—— 契约属本 feature 与 interaction 共用（本 feature 消费 observed 终态/排队证据）；被 `checkpoint-restore-contract` 消费为 live-attempt 前置条件与自动捕获触发；
  3. （checkpoint 线消费同一事实集）。
- **词汇一次定义**：事件名、payload 字段、outcome 五值、followUp 两值、seq/observedAt 语义以 `slice-consumption-contract.md`（本线镜像）为消费侧基准，与 interaction 线 `agent/attempt/start|end` 定义、checkpoint 线消费声明逐字段机械一致（集成波 I3 机械比对测试）。
- **退役条件**：见 `upstream-registration.md`（官方 seam 直绑）。

## 本线消费侧字段核对表（集成波 I1 机械核对输入）

| 事件 | 字段 | 本线消费语义 |
|---|---|---|
| `agent/attempt/start` | `attemptId`（必填） | 同 execution 内部 retry = 新 attempt 同一 activity（R8 AC1） |
| | `operationId`（外部 request 时有） | 仅校验存在性；operation 关联由 interaction 线表达 |
| | `executionId`（有则带） | correlation observed 档 |
| | `sessionId`（必填） | activity scope |
| | `seq` / `observedAt`（必填） | cursor / 时间事实 |
| `agent/attempt/end` | 同左 + `outcome`（五值必填） | terminal observed；绝不覆盖为 heuristic |
| | `reason` / `classification`（脱敏） | 有界；reason 仅 diagnostics 受众 |
| | `followUp`（`none\|queued` 必填） | post-attempt queue fact + 会话级 current-queue marker；不改写 terminal |

## 装配与验证归属

- 切片本体实现、官方契约 parity、boot 自检（含观测契约 marker 核对，`Symbol.for('dsh-plugin-api.session-activity.observation-contract')`）、无双跑、移除恢复：interaction 线实现并测试（本线只消费）。
- 装配级验证（官方行 disabled、替代行 active、版本错配局部停用、跨线 observed 全链路集成测试）：集成波 I4/I3。
- host-only 六问证据：`upstream-registration.md`（本线记录）与 interaction 线记录一致核对：集成波 I4。