# Stage 0 - Goal

## Feature Name

`usage-budget-telemetry`

## Status

Stage 0 Goal 与 Stage 1 Requirements 随 M6 四 feature 批次确认（e8d4e3c）；Stage 2 Design 落地（3278b5c），Stage 3 Tasks 获批（d24f7f8）；Stage 4 已交付（1c9d23d）并合入 M6 Wave C（merge 8ff0b67 / 12c6ce0）；当前为 delivered 状态。2026-08-26 复审登记：**待弃用**（pending deprecation）——与 `memory-interoperability` 同型的功能组件倾向（ledger/pricing/budget 属会计功能而非门面转译，单 cost 插件即可用已交付 API 端到端自足）；弃用动工待用户另行指示，弃用前 API 保持不变。2026-08-26 已按用户 ANY 指示执行移除（worktree `chore/usage-api-removal`，commit `856746f`）：`pluginApi.usage` 整面删除、feature-list §7 登记 removed；本 spec 目录保留作历史存档。

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
