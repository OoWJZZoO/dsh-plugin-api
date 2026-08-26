# Stage 0 - Goal

## Feature Name

`skill-discovery-activation`

## Status

SPEC1 Stage 0：Goal 待用户确认（M6 第六批次批量确认门，尚未获批）。Stage 1 Requirements 已产出（`requirements.md`），与 Goal 一并待本批确认门。

## Goal

为 skill 提供 discover → activate → expose → deactivate 的可组合生命周期，让 skill 的工具、prompt section 与 resource 暴露具备明确的来源、scope、generation 和失效语义。解决 `dsh-vision-toolkit`、`dsh-tianshu-tui` 等插件分别实现 skill browser、按需激活和工具注册的问题，同时复用已经交付的 MCP catalog 与 progressive tool discovery，而不再为 skill 另建一套工具目录。

证据来源：`dsh-vision-toolkit` 在 runtime ready 后按 skill 激活 visual tools；`dsh-tianshu-tui` 提供 skills browser、user-invocable gesture 与 `skills/change` 刷新；当前 `pluginApi.services.skills` 只提供 registry 直通，不拥有 activation lifetime。

## Batch Order and Dependencies

本 feature 是 M6 第六批次 Wave A；本批已不含 `memory-interoperability`（该候选已明确排除立项），它不依赖 memory，也不阻塞 `context-provenance` 的 Wave B。它建立在已交付能力上：

- `mcp-catalog-lifecycle` 提供 MCP server/tool identity 与 generation；
- `progressive-tool-discovery` 负责所有来源工具的 catalog/search/activate/expose，skill 面只管理 skill 生命周期并委托工具暴露；
- `client-generation-rebind` 提供 client connection/remote/slot/settings 的生命周期降级语义（本 feature 初版不新增 client wire）；
- `plugin-diagnostics` 承接 skill 缺依赖、激活失败和过期回调的有界诊断。

## Scope Boundary

- 包含：`pluginApi.skills.activation` 的 skill descriptor/discover、`activate(skill, { scope, reason, ttl })`、`exposure(skill, generation)`、`deactivate`、availability 与有界审计；
- 明确区分 `userInvocable`、explicit invocation、auto-match 和 provider-sourced activation；激活结果携带 generation，旧 generation 的异步结果不得继续发布；
- skill 可声明其工具、prompt sections、resources 和依赖，缺失依赖只降级该 skill，不影响其他 registry 条目；完整工具 schema 与 per-turn tool visibility 委托 `pluginApi.tools.discovery`；
- 初版为 B 类 host facade；若 Design 阶段证明官方 skill loader 是 skill-to-exposure 的唯一一致性 owner，再另行登记 R 类评估，不在本 feature 内替换官方行；
- 不包含：新的工具 scheduler、route/recovery/approval 决策、自动执行 skill action、prompt 文案编写、MCP transport 重实现、跨组件 replacement 或客户端动态 remote discovery。

## Classification and Guardrails

初版为 B 类 host-only facade，组合已公开的 skills registry、tools discovery、system-prompt assemble 与 execution/session scope。主公开面是 activation lifecycle projection/mutation；不把横切 priority、deepFreeze、fault containment 变成 R，也不修改官方包文件。generation、disposer、取消传播和 stale callback 约束在 Requirements/Design 阶段按 standards 定稿。

## Expected Result

插件可以先发现轻量 skill 描述，再按 session/agent/turn 范围显式激活，并查询本代实际暴露的工具、prompt sections 与 resources。停用或替换 skill 后旧回调不会污染新状态；依赖缺失、激活超时、provider 失败和 client 面不可用都只影响对应 skill，并通过 availability/diagnostics 给出明确结果。
