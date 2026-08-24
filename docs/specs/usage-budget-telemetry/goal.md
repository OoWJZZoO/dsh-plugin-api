# Stage 0 - Goal

## Feature Name

`usage-budget-telemetry`

## Status

Stage 0 Goal 已确认，进入 Stage 1 Requirements。

## Goal

为第三方插件提供统一的实际 usage、成本和预算观测契约，消除各插件从 `llm/stream` 重复去重、累计和结算的差异。该能力应能把 provider/model usage 样本与 `execution-observation` 的 execution identity 关联，形成可按 execution、session、workspace、日期和 provider/model 查询的幂等 ledger，并在预算接近阈值时产生结构化通知。

首版优先解决记录、幂等结算、查询和阈值通知；预算触发 deny、route 或自动降级等会改变执行决策的动作不在默认首版目标内，须在 Requirements 阶段单独确认。

## Scope Boundary

- 包含：input/output/cache/reasoning 等 usage 样本、execution 级 settle、去重与账本查询、价格信息登记、scope 预算和 threshold 事件。
- 明确区分 provider-confirmed usage 与本地估算，不把估算冒充账单事实。
- 依赖 execution correlation，但不复制 execution lifecycle；与现有 `tokenMeter` 的估算服务保持清晰边界。
- 不包含模型路由选择、自动 retry、approval/deny 执行、账单支付系统或客户端成本 UI。
- 必须处理重复 chunk、部分 stream、abort、重连、旧 execution 迟到结果和 provider/model 缺失，并遵守 fail-safe 与敏感信息可见性约束。

## Expected Result

cost-meter、预算告警、TUI/Web 统计和后续 route/recovery policy 可以消费同一份可追溯 usage ledger；同一次 execution 无论收到多少 usage chunk，都只产生一次一致的终态结算。
