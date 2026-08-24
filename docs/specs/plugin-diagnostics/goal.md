# Stage 0 - Goal

## Feature Name

`plugin-diagnostics`

## Status

Stage 0 Goal 已确认，进入 Stage 1 Requirements。

## Goal

为插件作者、宿主运维者和 Web/TUI/CLI 消费者提供统一的插件健康与可用性诊断契约。插件可以报告自身或依赖能力为何处于 active、degraded、inactive 或 pending 状态，宿主可以读取结构化快照并订阅变更，从而把版本不匹配、依赖缺失、重复注册、schema 不兼容和 client/host 不可用从散落日志转为可查询、可解释、可脱敏的公共状态。

该 feature 只负责诊断和可见性，不改变现有 fail-safe 行为：apply 失败仍必须安静停用，健康检查失败也不自动卸载、重启或修复能力。

## Scope Boundary

- 包含：检查项注册、结构化诊断报告、按 boot/host/client/plugin 范围读取快照、变更通知、severity 与 remediation 信息，以及 health 与 availability 的区分。
- 报告必须支持敏感字段脱敏，并保留 owner、dependency、generation 和发生时间等可解释元数据。
- 诊断应能被后续 execution、usage、MCP 和 client lifecycle feature 复用，但不预先定义这些 feature 的具体业务 schema。
- 不包含自动 repair、profile mutation、重试/恢复、UI 展示组件或新的官方 loader replacement bundle。
- 必须与现有 feature guard、版本协商、局部降级和错误呈现路径保持一致，不新增治理代号到运行时可见名称。

## Expected Result

当一个能力没有生效时，插件作者和宿主可以通过统一诊断面回答“哪个能力不可用、从何时开始、依赖什么、是否仍可降级使用、如何处理”，而不必依赖不可结构化的日志猜测。
