# Stage 0 — Goal

## Feature Name

`plugin-api-repo-normalization`

## Goal

以 2026-08-21 确立的全局规范 —— `docs/standards/` 分册（`capability-strategy`、`api-shape`、`identity-and-lifecycle`、`durable-state-and-scope`、`visibility-and-redaction`）与 AGENTS.md 治理约定 —— 为基准，对仓库现状做一次**合规审计**，并把审计发现的不符合事项以获批任务逐一规范化：**补登记、补声明、补证据**，或按 §3.0.1 纯本地窗口做最小改写。本 feature **不新增任何第三方可见 API**，不改变交付能力边界，不修改官方 DSH 包文件，不触碰 M4/M5 执行分支的在途/冻结文件（对其发现项只登记待办）。

## Scope Boundary

- 审计基准：2026-08-21 的 10 条 Stage 0 决议综合出的分册标准（`docs/standards/`）+ AGENTS.md §2/§4/§6/§8。
- 产物：(1) 合规审计报告（按分册逐条：位置 / 违反条款 / 证据 / 修复建议，含"零违反"项明示）；(2) 按获批任务完成的登记、声明与最小改写；(3) 复审后零未决项。
- 背景项（非主审计）：既有 AGENTS.md 规则的一次性复核（实现代码治理编号残留、治理迁移未合并导致的旧路径/旧登记指向），与主审计同批次纳入修复清单。
- 不做：实现任何 M6 候选 feature；修订规范分册本身；修改官方包文件；修改 M4/M5 执行分支在途制品；把"登记"当作免责（每条登记必须可验证）。