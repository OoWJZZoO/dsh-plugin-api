# Stage 0 Goal: scoped-agent-contributions

> feature_name: `scoped-agent-contributions`
> milestone: M10
> status: Stage 0 Goal 提交用户批量确认（2026-09-12）；Requirements / Design 未开始
> 输入溯源：M10 工作纲领 §3.3（OBS-03）；观察报告 §5 OBS-03（消费源码锚点与 caller-bound 现状）；M8 migration ledger 8.3(b)（read-image 每 agent 工具/提示词保留官方作用域表面的契约外精度登记）；canonical registry `prompts.contribute` 现行登记（无目标 agent 绑定维度）。

## Goal

让插件能够为**具体 agent/session** 创建、查询作用域并安装可撤销贡献——prompt section/context/variable/tool provider 与必要的工具注册/限制——owner 与 target 分开表达，生命周期随目标清理，覆盖新建与恢复（cold resume）的 agent。贡献只影响目标，不泄漏到其他 agent/session；消费者不需要直接 inject 该 agent 的官方 tools/systemPrompt。

主公开面是 contribution（含明确的 target scope 维度）；工具按键注册仍归 resourceRegistry（tools 面），两者不共享含混状态机。最终公共 path 与 scope 表达形状在 Design 中确定，本阶段不批准具体 path。

## Why

OBS-03 证实：`prompts.contribute` 的贡献 kind 只有 section/context/variable/tools/suppressRuntimeContext，没有专门的目标 agent 绑定过程；ownerId 只承担归因/冲突，不是 agent scope。M8 ledger 8.3(b) 登记 read-image 的每 agent 工具注册/提示词段只能保留官方 agent 作用域表面（契约外精度）；agent-teams 的成员 setup 与 TUI 的动态模型选择要求 agent-local 贡献。官方 installModelSelection 在 prompt assembly 捕获选择并用于本步 route——「本步模型选择快照」同时服务 prompt 变量与路由，不能退化成两个可能错拍的独立 setter。`tools` getter 已按 caller context 解析官方 tools（`lib/plugin-api-service.js` caller-bound 解析），部分 scoped tools 可能已可用，但需真实双 agent/fiber probe 验证，不能无证据重写整个 agent service，也不能未经证实就宣称已覆盖。

## Scope direction

- 选择/取得明确目标的门面上下文或等价 scope-bound handle；不要求消费者直接 inject 该 agent 的官方 tools/systemPrompt，也不把 raw context 绕路当覆盖。
- 贡献仅影响目标：prompt section/context/variable/tool provider 与必要的工具注册/限制；不可用 target 不静默回退全局。
- 生命周期：新建/恢复 setup 时安装；agent 销毁后清理；插件卸载只撤自身贡献；旧 generation 不撤新贡献。
- 每个贡献的 owner 与 target 分开表达；持久 scope 仍只有 session/workspace/profile 三档，不引入第四档 agent durable scope。
- 全局贡献、作用域贡献、整体替换的优先/组合边界明确（与 decision-participation-contract 的替换语义协同，不重复建第二个替换 owner）。
- 「本步模型选择快照」同时用于 prompt 变量与路由，切换不把一半应用到旧步、一半应用到新步；外部选择状态归 interactive-session-access，本线保证贡献/决策消费侧的同步消费与共同验收。
- 现有实现复用优先：tools caller-bound 解析先做真实 fiber probe，能复用就复用；prompts 挂载闭包与作用域传递是重点验证对象。
- 通道方向：官方 agent scope/setup 的 A/B 门面化为主；只有证实缺少组件边界再评估 R，Goal 阶段不预批。

## Boundaries

- 工具按键注册仍归 resourceRegistry（tools 面），不与贡献共享含混状态机。
- 不重写整个 agent service；不为一个 helper 另造平台；多层现有 API 能满足时应简化组合。
- 不引入 agent durable scope 档；不新建跨域大状态机。
- 不拥有 agents/sessions 领域的既有 owner 权；只在其上增加贡献的 target 维度。
- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Expected result

同时两个 agent、同插件不同目标、两个插件同目标、cold resume、全局与局部叠加、abort/dispose/reload、同一步模型选择与 prompt 一致快照等场景全部成立且互不串扰；所有场景不访问官方业务服务旁路、不依赖私有 Symbol 或 raw context 绕路。`dsh-read-image` 的 per-agent 注册与 agent-teams 成员 setup 可经公共路径等价迁移。

## Stage boundary

本文件只确认 Goal 方向，不批准具体公共 path、scope handle 形状或 fiber probe 结论。Requirements 应把目标选择、贡献种类、生命周期、组合优先级与泄漏防护写成 EARS，并记录 client 半面判定；Design 再确定 scope 表达、与 tools/prompts 既有面的分工矩阵、fiber probe 方案与清理责任归属。
