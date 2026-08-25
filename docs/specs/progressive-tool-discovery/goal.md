# Stage 0 - Goal

## Feature Name

`progressive-tool-discovery`

## Status

SPEC1 Stage 0：Goal 已确认（M6 第四批次批量确认门）。
修订注记（2026-08-25，用户指示）：若 Design 阶段取得充分证据证明官方 loader 不支持 turn 内 toolset 重建，本 feature 立即返工为 R 类（替代 `dsh-tools` 行），第一版即交付可用功能；不以只披露边界的门面残缺形态作为首版交付。

## Goal

为 tools 提供统一的 discover → search → activate → expose 生命周期，让"模型这一轮能看到哪些工具"成为可注册的策略，而不是全局静态暴露。解决两个公共痛点：工具集过大时模型不知道何时该用哪个工具；插件目前只能全量注册工具，或在自己的 prompt listener 里私自拼装暴露逻辑。

证据来源：`dsh-mcp-client-v2` 用 `mcp_tool_search` 避免把所有工具细节一次塞给模型；`dsh-vision-toolkit` 只在 vision-skills 激活后才注册 visual tools；`dsh-agent-teams` 通过 prompt usage 约束模型何时调用十个 team tools。三者都在绕过同一个缺失的公共语义：per-turn 的工具暴露策略。

## Batch Order and Dependencies

本 feature 是 M6 第四批次第二个 feature（Wave A，可与同批 `security-policy-egress-guard` 并行推进）。它被 M6 已交付能力实质解锁：

- `mcp-catalog-lifecycle` 已拥有外部 server identity 与 tool generation——本面把 MCP 工具作为 catalog source 之一，不重新实现 server lifecycle；
- `model-route-policy` 已拥有 route 决策边界——本面只消费其 decision 作为暴露约束输入，不做路由判断；
- `execution-observation` 提供激活的 session/execution scope；
- `plugin-diagnostics` 承接暴露策略降级与 catalog 注册失败的上报。

与候选池 #16（skill activation）的分工：本面负责**所有来源工具**（built-in、plugin、MCP、skill-sourced）的渐进式暴露策略；skill 自身的 activation lifetime 不在本 feature 内，另行立项。

## Scope Boundary

- 包含：`pluginApi.tools.discovery` 面——
  - `catalog.register({ id, summary, capabilities, activate })`：轻量 descriptor 注册，不含完整 tool schema；
  - `search(query, scope)`：只返回 descriptor，不产生激活副作用；
  - `activate(id, { session, execution, reason })`：返回带 generation 的 toolset；
  - `deactivate(id, generation)`：旧执行按其持有 generation 完成，新执行不可见；
  - 暴露原因、技能来源、模型可见性可查询（审计面）。
- 初版为 B 类门面实现：基于现有 tools registry、systemPrompt assemble 与 skills registry 组合。
- 不包含：
  - skill activation lifetime 本身（#16 另行立项）；
  - route policy 决策（已由 `model-route-policy` 拥有）；
  - prompt 文案创作或 systemPrompt 内容策略（本面只注入暴露所需的 descriptor/说明位）。

## Classification

B 类初版（tools registry + systemPrompt + skills 组合）。升级规则（2026-08-25 用户指示）：若 Design 阶段以充分证据证明官方 `dsh-tools` loader 行内 toolset 无法在门面侧动态重建到可用程度，本 feature **立即返工为 R 类**（替代 `dsh-tools` 装配行），第一版直接交付可用的 activation 功能——R 返工属于本 feature 内的通道决定，不是另立候选，也不得以"披露边界即可"的门面残缺形态充当首版。

## Expected Result

大型工具集场景下，插件可以注册"先搜索、再按需激活"的暴露策略：模型先看到轻量 summary，激活后才拿到完整工具定义；每轮请求实际生效的工具集有明确 generation 与来源记录；deactivate 不影响进行中的旧执行；catalog 注册失败只降级该条目并通过 diagnostics 可见。
