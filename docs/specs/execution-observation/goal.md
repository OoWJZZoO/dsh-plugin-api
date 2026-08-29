# Stage 0 - Goal

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.routing` | `pluginApi.llm.routing`（叶子 `forExecution`） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

## Feature Name

`execution-observation`

## Status

Stage 0 Goal 与 Stage 1 Requirements 随 M6 四 feature 批次确认（e8d4e3c）；Stage 2 Design 落地（3278b5c），Stage 3 Tasks 获批（663e7ec）；Stage 4 已交付（b7626af）并合入 M6 Wave C（merge dc1a7cd / 12c6ce0）；当前为 delivered 状态。

## Goal

为第三方插件提供统一、只读、可恢复的执行生命周期观察能力，把 agent、tool、LLM、session 等现有公开 seam 的相关事件关联到同一份稳定 execution projection。插件应能识别一次执行的身份、父子关系、阶段变化和唯一终态，从而在并发工具、重入流、取消、重试和重连场景中可靠地关联日志、usage、诊断和业务任务，而不必各自从碎片事件推断执行状态。

首版目标是公共观察契约，不重新定义官方 agent loop，不把所有内部阶段扩展为新事件，也不在观察层自动执行 retry、fallback 或恢复策略。

## Scope Boundary

- 包含：执行 identity 与父子关联、生命周期开始/阶段/终态观察、按 session 查询历史 projection，以及并发、取消、重入、重连和迟到事件下的稳定性约束。
- 观察结果是只读 projection；不承诺模型一定看到了某个事件，也不把 event sequence 当作 execution identity。
- 首版以现有公开 `agent/*`、`tools/*`、`llm/stream`、`session/*` seam 组合为主；需要官方提供真正稳定 execution identity 的部分单独登记为 upstream proposal。
- 不包含自动 retry、route policy、checkpoint restore、task/workflow 管理或新的 R 类 replacement bundle。
- 必须遵守 fail-safe、官方包不修改和与现有 `pluginApi.routing`、session durable observation 能力的去重边界。

## Expected Result

第三方 telemetry、diagnostics、recovery 和 task 类插件可以共享同一 execution correlation contract，并在 execution 已结束或连接重建后得到一致的只读终态，而不是各自维护互不兼容的 execution 状态机。
