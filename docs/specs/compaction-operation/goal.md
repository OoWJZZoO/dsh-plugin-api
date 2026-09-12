# Stage 0 Goal: compaction-operation

> feature_name: `compaction-operation`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）
> 输入溯源：M10 工作纲领 §3.7（OBS-07）；观察报告 §5 OBS-07；M7 deletion report B4-7 批准记录与「后续 B 类接口义务」；canonical registry eventCatalog `compaction/*` 现状与官方 `dsh-compaction-basic` 类型。

## Goal

兑现 M7 删除 `services.compaction` 整键时登记的功能义务：让第三方插件通过门面显式发起一次**真实压缩**，复用既有压缩引擎、决策策略与事件词汇，获得统一的 operation 结果与 lineage——而不是造第二个 summary 模型或压缩算法，更不是拿 `events.emit('compaction/...')` 假装引擎执行。

主公开面是 operation（发起由 authority 主导内部过程的动作并等待确定终态）；压缩引擎仍是唯一 mutation owner；`compaction/request` 的策略 registry 是决策参与者，不是主动触发器，二者分开。

## Why

B4-7 批准删除整键 `services.compaction`（compactIfNeeded / compactNow / compactRegion），理由是压缩决策/事件语义已由 replacement 包 `@deepseek-ai/dsh-plugin-api-compaction-events`（替换官方 `compaction-basic` 行并注册 fork 引擎）承载、raw 控制面无独立消费者，同时登记了「`packages/compaction-events` 后续必须新增『可主动发起 compact 事件』的 API（替代删除的 raw 触发语义）」义务。官方冻结 runtime 保留三个触发方法（`compactIfNeeded(agent, trigger, signal)`、`compactNow(agent, signal, sourceCommandId?)`、`compactRegion(start, end, agent, signal?)`）。registry eventCatalog 已登记 `compaction/request`（decision/waterfall）与 `started/completed/failed/skipped`（fact），producer authority 均为 compaction replacement authority——缺的只是主动触发入口。真实消费者 `dsh-tianshu-tui` 的 `/compact` 命令（`src/commands/registry.ts` 经可选服务名调用 compactIfNeeded；服务名与当前 runtime 的一致性在迁移时验证）。压缩事件观察、派发同名通知、checkpoint 恢复都不等于执行一次压缩。

## Scope direction

- 主面 operation：门面入口 → `compaction/request` 决策（复用既有 decision 面）→ 引擎动作 → 统一终态；请求、策略、引擎、终态、session/provenance 更新接成一条真实链。
- 触发语义取舍：官方三方法覆盖「按需 / 立即 / 区域」三种语义；公共触发面承载哪些、以什么参数形状表达，由 Design 依真实消费者行为决定，不照搬全部 raw 语义。
- 结果可区分：成功（含 compactionId / shadowed range 等 lineage）/ 无需压缩（skipped 及原因）/ 拒绝（request policy 决定）/ 失败 / 取消。
- 与活跃 attempt 的并发策略清楚；不重复压缩、不重复发事实——fact 生产权仍在 compaction replacement authority。
- 主动压缩与自动压缩共用同一事件/provenance 词汇；触发来源（插件主动请求 vs 自动 trigger）可辨，不伪造 provenance。
- 通道方向：B4-7 指定落点为既有 compaction-events replacement owner（组件唯一 owner 不变）；触发能力在该 owner 内扩展，门面公共 operation 面按既有 marker/版本门控条件投影模式提供，替代行未激活或版本不一致时退化为 typed disabled/unavailable。横切派发语义不 R。
- client 半面判定按 `capability-strategy.md` §10 六问在 Requirements 记录（官方 compaction 组件为 host-only 的证据链）。

## Boundaries

- 不造第二个 summary 模型、压缩算法或摘要策略；引擎仍是唯一执行者与 mutation owner。
- 不以 `events.emit('compaction/...')` 假装引擎执行；不把 `compaction/request` 策略 registry 当主动触发器。
- 不替换新的无关组件；不新增与压缩无关的 session 操作。
- 不为压缩建新 durable scope 档；lineage/provenance 沿用既有事实词汇。
- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Expected result

从门面发起后实际 session 内容/压缩记录改变（compactionId / lineage 可查）；request policy 能拒绝或改范围；取消和并发行为确定；无压缩候选正确 skipped；主动与自动压缩的事件、provenance、错误呈现一致。`dsh-tianshu-tui` 的 `/compact` 行为可经公共路径等价迁移，不再直接 inject 官方服务。

## Stage boundary

本文件只确认 Goal 方向，不批准具体公共 path、参数形状、结果码集合或 R 扩展的内部契约。Requirements 应把触发、范围、结果区分、并发、取消、事件/provenance 一致性与 R1–R8 逐条对照写成 EARS；Design 再确定触发语义取舍、replacement 扩展的内部契约、门控条件与装配顺序。
