# Stage 0 - Goal

## Feature Name

`skill-discovery-activation`

## Status

SPEC1 Stage 0–1：Goal/Requirements 已获用户批准（2026-08-26，M6 第六批次批量确认门）。**2026-08-26 经用户明确指示重构**：本 feature 改走 **R 类通道**（替换官方 `tool-skill` 行，owner `@deepseek-ai/dsh-tool-skill`），提供 session 内动态 skill 策略；session 内 skill 目录变化时默认与官方对齐（全量重发 catalog），注册政策后切换为英文最小更新信息。重构后的 Goal/Requirements/Design 待本批确认门。

## Goal

为 skill 提供 discover → activate → expose → deactivate 的可组合生命周期，并把该生命周期**接入官方模型侧暴露路径**：官方 `dsh-skill` 只提供 registry（`registerProvider/register/list/snapshot/get` + `skills/change` 失效通知），而官方模型侧暴露（`skill` 工具、`agent/pre-step` 用户调用注入、`<available_skills>` 目录）由 `dsh-tool-skill` 拥有且**不感知任何 activation 状态**——每个 skill 只有静态的 `modelInvocable`/`userInvocable` 布尔，session 内没有激活/停用/TTL/来源约束的中间档位。

本 feature 经 R 类通道替换官方 `tool-skill` 行（保真复刻其全部 ctx 契约面），增加：

1. **session 内动态 skill 策略**：per-session（含 agent/turn 粒度）的激活、停用、TTL、generation 与来源分类，并在这三条官方路径上强制执行（目录过滤、`skill` 工具加载门控、`agent/pre-step` 注入门控）；
2. **目录变化告知（默认与官方对齐）**：当 session 内生效 skill 目录发生变化时，像 AGENTS.md 变化通知一样向模型注入 CONTEXT；**默认保持官方行为——全量重发 catalog**（与 stock DSH 一致）；
3. **英文最小更新政策入口**：提供 policy 注册入口，注册后该 session 目录变化改为**英文**最小更新信息（「Skill xxx has been removed / added / changed, new shape is ...」），不全量重发；文案语言与 DSH 惯用 prompt 对齐。

证据来源：`dsh-vision-toolkit` 在 runtime ready 后按 skill 激活 visual tools；`dsh-tianshu-tui` 提供 skills browser、user-invocable gesture 与 `skills/change` 刷新；官方 `dsh-tool-skill` 的 `agent/pre-step` 目录机制已有 session 级 digest 历史，但变化时**全量重发**目录且不感知 activation 状态（本机 DSH `0.1.0-rc.6` 源码核实）。

## Batch Order and Dependencies

本 feature 是 M6 第六批次 Wave A；本批已不含 `memory-interoperability`（该候选已明确排除立项），它不依赖 memory，也不阻塞 `context-provenance` 的 Wave B。它建立在已交付能力上：

- `mcp-catalog-lifecycle` 提供 MCP server/tool identity 与 generation；
- `progressive-tool-discovery` 负责所有来源工具的 catalog/search/activate/expose，skill 声明的工具委托 `pluginApi.tools.discovery`，不再另建工具目录；
- `client-generation-rebind` 提供 client connection/remote/slot/settings 的生命周期降级语义（本 feature host-only，无 client wire）；
- `plugin-diagnostics` 承接 skill 缺依赖、激活失败和过期回调的有界诊断。

## Scope Boundary

- 包含：`pluginApi.skills.activation` 的 descriptor/discover、`activate(skill, { scope, reason, ttl })`、`exposure(skill, generation)`、`deactivate`、availability 与有界审计；session 内动态策略在三官方路径上的强制执行；目录变化告知（默认官方全量重发对齐；政策入口切换为英文最小更新信息）；
- 包含：`registerSkill` 快捷注册运行时内存 skill（**语法糖**：官方 `ctx.skills.register()` 内容注册 + descriptor overlay 的组合，内容仍归官方 registry，descriptor 是官方条目的激活政策覆盖层，不是第二内容源）；
- 明确区分 `userInvocable`、explicit invocation、auto-match 和 provider-sourced activation；激活结果携带 generation，旧 generation 的异步结果不得继续发布；
- skill 可声明其工具、prompt sections、resources 和依赖，缺失依赖只降级该 skill；完整工具 schema 与 per-turn tool visibility 委托 `pluginApi.tools.discovery`；
- **R 类边界**：只替换官方 `tool-skill` 行（运行时名 `plugin-api-tool-skill`，唯一 owner `@deepseek-ai/dsh-tool-skill`）；不替换 `dsh-skill` registry 行；不得跨组件替换；横切派发语义（priority/deepFreeze/fault containment）永不走 R；
- 不包含：新的工具 scheduler、route/recovery/approval 决策、自动执行 skill action、prompt 文案编写、MCP transport 重实现、客户端动态 remote discovery 或 client wire。

## Classification and Guardrails

**R 类 replacement bundle**（不再以 B 类 facade 为初版通道）：禁用官方 `tool-skill` 行 + 插入替代行，保真复刻官方 ctx 契约面（`skill` 工具、`agent/pre-step` 用户调用注入与目录机制）之后再增加 activation 语义。主门面只做 marker/版本门控条件投影（`pluginApi.skills.activation`），替代行自含状态机；boot 自检、版本锁定、组件唯一 owner 检测与 fail-safe 按 `capability-strategy.md` R1–R9 执行；U18 保留为上游提案并登记退役条件。generation、disposer、取消传播和 stale callback 约束在 Requirements/Design 阶段按 standards 定稿。

## Expected Result

插件可以先发现轻量 skill 描述，再按 session/agent/turn 范围显式激活或停用，且这些变化**真实生效于模型侧**：官方目录、`skill` 工具与用户调用注入都按当前 session 的激活状态裁决。session 内目录变化时，模型默认收到与官方对齐的全量 catalog 重发；注册最小更新政策后收到英文最小更新信息。停用或替换 skill 后旧回调不污染新状态；依赖缺失、激活超时、provider 失败都只影响对应 skill，并通过 availability/diagnostics 给出明确结果；任何失败不抛穿 apply、不杀 boot。
