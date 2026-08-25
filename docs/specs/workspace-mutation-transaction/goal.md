# Stage 0 - Goal

## Feature Name

`workspace-mutation-transaction`

## Status

Stage 0 Goal 已确认；Stage 2 Design 已确认（SPEC2 审查纠偏完成）；Stage 3 对抗性审查通过；Stage 4 交付完成（M6 第三批次）。

## Goal

为第三方插件提供统一的 workspace mutation transaction 契约，把 file claim、checkpoint、Change Ledger、Git diff/restore 与 tool/execution provenance 组合成一次可审阅的变更边界。该 feature 应能回答一次 agent 变更影响了哪些资源、产生了哪些可回滚与不可回滚副作用，以及在提交、回滚或恢复时当前证据是什么。

首版是 B 类协调层：它负责定义 transaction 的 identity、状态、变更记录、预览和恢复边界，但不承诺自动回滚任意外部系统，也不把不可逆副作用伪装成可回滚。

## Batch Order and Dependencies

本 feature 是本批次的第二个 feature，依赖已交付的 `recovery-policy` 与本批次先行的 `coordination-lease`，并消费公开 workspace、checkpoint、file-claim、session 和 approval 能力。它为后续 `task-execution-observation` 提供可追踪的 workspace 变更 provenance，但不拥有 task scheduler 或 execution identity。

## Scope Boundary

- 包含：`prepare`、mutation record、`preview`、`commit`、`rollback` 和 `recover` 的 transaction 边界；resource 清单、intent、before/after digest、source tool/execution 与 side-effect 分类。
- `prepare` 应绑定 lease 与适用 checkpoint；变更记录必须可按 transaction 查询，并明确区分 prepared、committed、rolled-back、recovering、failed 等状态及其证据。
- 通过 capability adapter 对接 Git、session branch、checkpoint、file claim 和 tool approval；只声明适配器实际确认的能力，不在 facade 内模拟缺失的 durable restore。
- 非可回滚的网络、进程、发布或其他外部副作用必须标记为 external，并要求对应的显式 approval/confirmation；预览不得把它们显示成可自动 rollback。
- 不包含 lease/CAS 实现本身、完整跨 session checkpoint restore、任意外部系统的事务协调、自动 retry/fallback、route 选择、task scheduler、session branch owner 或官方包替换。

## Classification

B 类门面协调层；跨文件、session、Git 和外部工具，不适合 R replacement。涉及官方没有公开恢复证明的部分保留为 C 类 unsupported/upstream boundary，不得在门面内伪造成功。

## Expected Result

文件修改、配置变更和工具驱动的 workspace 操作可以先预览、再提交，并保留与 execution、tool、lease 和 checkpoint 对应的 provenance。回滚或恢复不可用时，系统会明确返回边界与证据，而不是静默丢失变更或声称外部副作用已被撤销。
