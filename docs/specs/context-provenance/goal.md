# Stage 0 - Goal

## Feature Name

`context-provenance`

## Status

SPEC1 Stage 0：Goal 待用户确认（M6 第六批次批量确认门，尚未获批）。已按 2026-08-26 决定同步移除对 `memory-interoperability` 的依赖（该候选已明确排除立项），其余内容不变。Stage 1 Requirements 已产出（`requirements.md`，Wave B，消费 Wave A skill exposure 词汇），与 Goal 一并待本批确认门。

## Goal

为第三方插件提供可解释的上下文组合与 provenance 契约，回答一段内容从哪里来、是否实际服务给模型、何时被压缩/替换/归档以及为什么不可见。该能力把 `systemPrompt` 注入、session surface、attachment projection、memory 插件产出的 recall 内容、skill exposure 与 compaction 产生的碎片关联成一个有界、只读可审阅的贡献图，但不把“已贡献”伪装成“模型一定看到了”。

证据来源：`dsh-context` 维护 surface、archive、removed node、token pressure 和 request snapshot；`dsh-anchored-standard` 手工构造 virtual turn 并依赖 `sourceEventSeqs`；`dsh-vision-toolkit` 与 `dsh-agent-teams` 需要向 prompt 注入说明。现有 systemPrompt 注册和 session append 能承载局部动作，却无法统一解释来源、覆盖、压缩和丢弃原因。

## Batch Order and Dependencies

本 feature 是 M6 第六批次 Wave B，与 Wave A 的 `skill-discovery-activation` 同批推进，不要求等待其实现完成；本批已不含 `memory-interoperability`（该候选已明确排除立项），因此本 feature 不依赖任何 memory facade。它消费以下已交付或 Wave A 的公开投影：

- `execution-observation` 提供 execution/session correlation；
- `attachment-pipeline` 提供 attachment identity、generation 和 projection provenance；
- `session-branch-sidechain-edit` 提供 branch boundary 与 edit lineage；
- `progressive-tool-discovery` 与 `skill-discovery-activation` 提供工具/skill 暴露来源；
- 记忆来源（可选）：若具体 memory 插件参与上下文组装，须经既有 contribution/sourceEventSeqs 契约自行声明来源与可见性元数据，本 feature 不为其提供专用 facade 依赖；
- `plugin-diagnostics` 和 `visibility-and-redaction` 提供失败、可见性和脱敏边界。

## Scope Boundary

- 包含：`pluginApi.context` 的 contribution 注册、scope/phase/priority 元数据、`compose(request, { budget, policy })` 返回冻结 contribution graph、`inspect(session)` 的 served/archive/dropped 投影，以及 compaction/prune 的 replacement mapping；
- 每个节点必须区分 `contributed`、`served`、`sent`、`archived`、`redacted` 等 lifecycle/visibility 状态，并携带 source、sourceEventSeqs、supersedes、expiresAt 和受众包络；
- 组合结果是只读解释面，不拥有 memory、attachment、session、skill 或 tool 的持久状态；不得因 compose 结果自动执行 retry、route、approval、mutation 或 prompt 注入旁路；
- 初版按 B/C 边界推进：现有 systemPrompt/session surface 可支撑有界 facade；若要求官方 agent loop 在组装点原生消费带 provenance 的 assembled context，则只登记 C 类 upstream proposal，不伪造官方保证；
- 不包含：替代 token meter、重建官方 transcript、无限历史导出、secret 进入 inspector、客户端 remote/slot/settings、跨组件 R replacement。

## Classification and Guardrails

初版为 B 类组合 facade，并保留官方 assembled-context seam 的 C 类边界；横切派发语义不走 R。主公开面是 context projection/composition，memory/attachment/session/skill 的 mutation 与 policy owner 保持分离。需求和设计阶段必须明确 scope、redaction、budget、generation、取消与“served 不等于 sent”的证据语义。

## Expected Result

第三方插件和诊断/界面消费者能够审阅一轮请求的上下文贡献图：哪些内容来自 memory、attachment、skill、session 或 system prompt，哪些被替换、压缩、归档、脱敏或因预算丢弃。缺失来源、过期 generation、组装失败或官方 seam 不可用时，系统返回有界的 unavailable/degraded 证据，不伪造模型可见性，也不影响宿主 boot。
