# Stage 0 - Goal

## Feature Name

`model-route-policy`

## Status

Stage 0 Goal 已由用户确认；本 feature 已明确批准按 R 类 replacement 推进。

## Goal

为第三方插件提供一个有序、可解释、受执行边界约束的模型路由策略契约，统一处理 provider/model 健康、熔断、探测、fallback 与失败归因。插件不再通过多个 `agent/request` listener 竞争 prepend 顺序，而是在明确的 route decision point 参与一次可审计的候选选择。

同一 execution/attempt 内的 route 必须保持不变；只有新的 turn 或明确的新 attempt 才能产生新的 route decision。每次 fallback、probe 或 circuit 状态变化都应能与原始 route decision 关联，但本 feature 不负责创建 execution，也不负责决定是否重试。

## Scope Boundary

- 包含：route policy 注册与有序收敛、候选 route 选择、provider/model 健康观察、circuit 状态、受限 probe、fallback lineage、decision reason 与不可变 route snapshot。
- 依赖 `execution-observation` 提供 execution/attempt correlation，依赖 `usage-budget-telemetry` 提供预算与 usage evidence；不复制这两个 feature 的状态空间。
- `recovery-policy` 负责 retry、attempt 创建、abort 与 fork 决策；本 feature 只在被提供的 decision point 上返回 route decision，不自行启动 retry。
- R 类唯一官方组件 owner 锁定为 `@deepseek-ai/dsh-agent-loop`，目标官方 row 为 `agent-loop`；replacement 必须完整保留该行的 `agentLoop` 服务、agent factory/driver、settings、system-prompt variables、配置驱动 agent 生命周期及全部事件/失败时序，再增加 route policy capability slice，不替换 `@deepseek-ai/dsh-agent-loop` 的 package import 面。
- 不包含修改官方包文件、在已有 stream 中途换 model、绕过 approval 或 input-modality admission、把 probe 当作真实用户请求、跨组件 replacement 或 provider billing。

## Expected Result

模型 failover、cost-aware routing、provider circuit breaker 与诊断插件可以共享同一套 route identity、decision reason 和 fallback lineage。在 route 选择失败、健康状态不确定或 replacement 不可用时，系统能够明确降级并保持官方执行安全，而不是依赖 listener 顺序和隐式重入。
