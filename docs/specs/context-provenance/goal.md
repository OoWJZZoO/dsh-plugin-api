# Stage 0 - Goal

## Feature Name

`context-provenance`

## Status

SPEC1 Stage 0–1：Goal/Requirements 已获用户批准（2026-08-26，M6 第六批次批量确认门；已同步移除对 `memory-interoperability` 的依赖，该候选已明确排除立项）。**2026-08-26 经用户明确指示重构**：`sent` 证据切片改走 **R 类实现**——在既有 `@deepseek-ai/dsh-plugin-api-agent-loop` replacement（owner `@deepseek-ai/dsh-agent-loop`）上新增 assembled-context 证据能力，使 `sent` 状态可达。重构后的 Goal/Requirements/Design 待本批确认门。

## Goal

为第三方插件提供可解释的上下文组合与 provenance 契约，回答一段内容从哪里来、是否实际服务给模型、何时被压缩/替换/归档以及为什么不可见。该能力把 `systemPrompt` 注入、session surface、attachment projection、memory 插件产出的 recall 内容、skill exposure 与 compaction 产生的碎片关联成一个有界、只读可审阅的贡献图，但不把“已贡献”伪装成“模型一定看到了”。

`sent` 证据边界经 R 类实现：官方 agent loop 在组装/发送点（`renderContextSections`/`renderPrompt`，位于 `dsh-agent-loop` 内部）没有 provenance dispatch。本 feature 在既有 agent-loop replacement 上增加证据切片——在等价渲染点发射冻结的 assembled-context 证据（本次实际进入请求的 section 与 message 范围 + 丢弃原因），使贡献图的 `sent` 状态由真实证据支撑；官方提供等价 seam 后退役（上游提案 U19）。

证据来源：`dsh-context` 维护 surface、archive、removed node、token pressure 和 request snapshot；`dsh-anchored-standard` 手工构造 virtual turn 并依赖 `sourceEventSeqs`；`dsh-vision-toolkit` 与 `dsh-agent-teams` 需要向 prompt 注入说明。现有 systemPrompt 注册和 session append 能承载局部动作，却无法统一解释来源、覆盖、压缩和丢弃原因。

## Batch Order and Dependencies

本 feature 是 M6 第六批次 Wave B，与 Wave A 的 `skill-discovery-activation` 同批推进，不要求等待其实现完成；本批已不含 `memory-interoperability`（该候选已明确排除立项），因此本 feature 不依赖任何 memory facade。它消费以下已交付或 Wave A 的公开投影：

- `execution-observation` 提供 execution/session correlation；
- `attachment-pipeline` 提供 attachment identity、generation 和 projection provenance；
- `session-branch-sidechain-edit` 提供 branch boundary 与 edit lineage；
- `progressive-tool-discovery` 与 `skill-discovery-activation` 提供工具/skill 暴露来源（消费 SDA-5 Exposure record 与目录 notice 的 `source.kind` 元数据）；
- `model-route-policy` 的 replacement 包 `@deepseek-ai/dsh-plugin-api-agent-loop`（owner `@deepseek-ai/dsh-agent-loop`）承载本 feature 的 **R 类 sent 证据切片**（同一官方组件内第二能力，capability-strategy R2/§4.1 允许）；
- 记忆来源（可选）：若具体 memory 插件参与上下文组装，须经既有 contribution/sourceEventSeqs 契约自行声明来源与可见性元数据，本 feature 不为其提供专用 facade 依赖；
- `plugin-diagnostics` 和 `visibility-and-redaction` 提供失败、可见性和脱敏边界。

## Scope Boundary

- 包含：`pluginApi.context` 的 contribution 注册、scope/phase/priority 元数据、`compose(request, { budget, policy })` 返回冻结 contribution graph、`inspect(session)` 的 served/archive/dropped 投影，以及 compaction/prune 的 replacement mapping；
- 每个节点必须区分 `contributed`、`served`、`sent`、`archived`、`redacted` 等 lifecycle/visibility 状态，并携带 source、sourceEventSeqs、supersedes、expiresAt 和受众包络；
- **R 类 sent 证据切片**：在既有 agent-loop replacement（`plugin-api-agent-loop`）上新增 assembled-context 证据发射（冻结 payload：实际进入请求的 system-prompt section 与 message 范围 + 丢弃原因）；证据只观测、不改变 loop 内的组装/策略决策；
- 组合结果是只读解释面，不拥有 memory、attachment、session、skill 或 tool 的持久状态；不得因 compose 结果自动执行 retry、route、approval、mutation 或 prompt 注入旁路；
- B/C/R 边界：门面本体为 B 类组合 facade；`sent` 证据切片为 R 类（归属 `dsh-agent-loop` 组件，唯一 replacement owner 已存在）；官方 agent loop 原生消费带 provenance 的 assembled context（含组装点策略消费）仍登记 C 类上游提案 U19，不伪造官方保证；
- 不包含：替代 token meter、重建官方 transcript、无限历史导出、secret 进入 inspector、客户端 remote/slot/settings、跨组件 R replacement。

## Classification and Guardrails

门面本体为 B 类组合 facade；`sent` 证据切片为 R 类能力，归属唯一官方组件 `dsh-agent-loop`（其 replacement 包 `@deepseek-ai/dsh-plugin-api-agent-loop` 已交付并锁定 runtime identity；本切片为其同包第二 feature，按 capability-strategy R2 执行）。横切派发语义不走 R。主公开面是 context projection/composition，memory/attachment/session/skill 的 mutation 与 policy owner 保持分离。需求和设计阶段必须明确 scope、redaction、budget、generation、取消与“served 不等于 sent”的证据语义——重构后 `sent` 由 R 证据切片支撑，但证据缺失时仍回落到 `served` 并显式披露。

## Expected Result

第三方插件和诊断/界面消费者能够审阅一轮请求的上下文贡献图：哪些内容来自 memory、attachment、skill、session 或 system prompt，哪些被替换、压缩、归档、脱敏或因预算丢弃，以及——在 R 证据切片存在时——哪些内容被实际发送给模型（`sent` 有证据、`served` 有上限、无证据不伪造）。缺失来源、过期 generation、组装失败或官方 seam 不可用时，系统返回有界的 unavailable/degraded 证据，不伪造模型可见性，也不影响宿主 boot。
