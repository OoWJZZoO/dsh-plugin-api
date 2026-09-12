# Stage 2 - Design

> feature_name: `scoped-agent-contributions`
> status: Stage 0–2 已交付（2026-09-12；与 requirements.md 同批产出，承接已确认 goal.md）
> 输入溯源：goal.md；requirements.md（同批）；观察报告 §5（`lib/index.js:857–867` systemPrompt 挂载闭包、`lib/system-prompt.js:39–56` 闭包转发、`lib/plugin-api-service.js:971–1049` 贡献 kind 与 owner 归因、`lib/plugin-api-service.js:1354–1367` tools caller-bound 解析）；M8 migration ledger 8.3(b)；M10 工作纲领 §3.3 / §4.1；canonical registry `prompts.contribute` 现行登记。

## Status

Stage 2 与 Stage 1 同批交付（2026-09-12）。本文确定 scope 表达与 scope-bound handle、与 `prompts.contribute` / tools 既有面的分工矩阵、tools caller-bound 解析的复用判定与真实 fiber probe 方案（验证义务，不预下结论）、生命周期清理责任、与 decision-participation-contract 的组合边界、本步模型选择快照的消费侧机制、失败/guard 与 standards 逐分册结论。

## Overview

现状（已证实）：`prompts.contribute` 的 kind 面只有 section/context/variable/tools/suppressRuntimeContext，ownerId 只承担归因/冲突，没有目标 agent 维度；门面 `prompts` 面是对官方 systemPrompt 服务的闭包转发（host 级，非 per-agent）。tools getter 已按 caller context 在调用时解析官方 tools（`this.ctx.get('tools')`）——部分 scoped tools 可能已经可用，但**未经真实双 agent/fiber probe 证实**。M8 8.3(b) 登记 read-image 的每 agent 工具/提示词只能保留官方 agent 作用域表面（契约外精度）。

设计：**贡献面加 target 维度 + 显式 scope-bound handle**，全部走既有 contribution / resourceRegistry idiom 与既有 owner，不重写 agent service：

1. `agents.scopes.acquire({ agent })` → scope-bound handle（目标校验、状态查询、identity-bound 释放）。
2. `prompts.contribute(spec)` 增加 `spec.scope`（handle 引用）→ 单一 contribution owner 上的 target 维度。
3. `tools.register(definition, { scope })` / `tools.restrict.register(policy, { scope })` → resourceRegistry/policy 契约上的 target 维度。
4. 清理绑定官方 `agent/disposed` 事实 + owner 卸载 identity-bound 撤除；持久 scope 三档不变。

## Current-State Findings

- `lib/plugin-api-service.js:971–1051`：`CONTRIBUTION_KINDS` 判别 + `createContributeEntry`（owner 归因、同 owner 同 id conflict、seq handle、幂等 dispose、backing disabled → typed unavailable）。扩展点是 `spec` 判别与底层安装目标的解析，机制无需重造。
- `lib/plugin-api-service.js:1354–1368`：tools getter 每次访问经 `this.ctx.get('tools')` 按 caller fiber 解析官方 tools——**caller-bound 解析已存在**，但「在目标 agent 的 fiber/上下文内调用门面」是否等价于「为目标 agent 安装」未被验证（观察报告明确标注待真实双 agent/fiber probe）。
- `lib/index.js:857–869` / `lib/system-prompt.js`：prompts 面挂载时闭包持有 host 级 systemPrompt 服务实例；per-agent 安装需要目标 agent 自己的服务面，这是当前闭包转发未覆盖的维度。
- 官方面：官方 AgentRegistry（`ctx.get('agents')`）的 create/resume/register（`lib/agent-create-api.js` 转发面）；官方 installModelSelection 在 prompt assembly 捕获选择并用于本步 route（观察报告确认的官方语义）；`agent/disposed`（catalog fact，scope-filtered）可作销毁信号。
- `agents` 门面已有 `create/resume/register/providers.register` operation/registry 面；`agents.get/list` 等查询面在 registry 领域树已登记。

## scope 表达与 scope-bound handle

- **获取**：`pluginApi.agents.scopes.acquire({ agent })`。`agent` 接受门面已知的 target 引用（agents 域查询/创建返回的 agent 身份）；acquire 经官方 agents 面解析目标，解析失败/目标已销毁 → typed `unavailable`（不回退全局，需求 1.2）。owner 从 caller fiber 派生（现行 `resolveOwnerId` 机制）。
- **handle 形状**：`{ id, ownerId, generation, target, status(), dispose() }`——`target` 为冻结的目标身份快照（agent 身份 + 解析时间），`status()` 反映目标可用性，`dispose()` 释放该 handle 名下 bookkeeping（identity-bound、幂等、stale no-op）。handle 不挂 contribute 方法：贡献调用仍走各自领域入口，`scope` 以 handle（opaque token）传入——避免 handle 变成第二贡献入口、保持「工具按键注册仍归 tools 面」的边界。
- **身份稳定性**：scoped 贡献 registry 以**稳定 target 身份**（agent 身份，非 handle 实例）为键；同目标的多个 handle 共享目标键。cold resume 覆盖以 Stage 4 probe 证实目标身份跨恢复稳定为前提（需求 5.4 显式义务；不证实则该覆盖不宣称）。

## tools caller-bound 解析的复用判定与真实 fiber probe（验证义务）

设计采用 **probe-first**：不预下「caller-bound 已足够」或「必须显式 target 通道」的结论，把判定写为 Stage 4 验证义务。

- **probe 矩阵**（真实两个 agent + 两个独立 synthetic 插件，全走公共入口，禁止官方服务旁路）：
  1. 在 agent-A 的执行 fiber 内（例如 A 的工具执行回调中）经门面调用 `tools.register` / `prompts.contribute`，验证 caller-bound 解析是否落在 A 的官方 tools/systemPrompt 服务面（假设 P1：fiber 绑定足够）。
  2. 在插件根 context（agent-B 创建者）中持有 B 的 scope handle 安装贡献，验证安装是否可达 B 的服务面（假设 P2：setup 场景需要显式 target 通道）——agent-teams 成员 setup 正是此形态。
  3. 反向装配顺序 + 两个 agent 同时运行的隔离断言；cold resume 后重复 1–2。
- **判定规则（写入 tasks/验收）**：P1 通过 → per-execution 安装直接复用 caller-bound 解析（复用既有机制，不新建路径）；P2 通过 → acquire 时经官方 agent 实例面捕获目标服务解析闭包（acquire 是唯一新增解析点）；P1/P2 都不通 → 该缺口升级为人类裁决点（可能触及官方组件边界，再评估通道），**不得无证据重写整个 agent service**（goal 硬约束）。
- probe 结论与实际接线在 Stage 4 记录；若与本文档假设冲突，按 spec 修订流程同步本文档对应条目。

## 与 prompts / tools 既有面的分工矩阵

| 能力 | 承载面 | 处置 |
|---|---|---|
| 全局 prompt section/context/variable/tools/suppressRuntimeContext | `prompts.contribute`（既有，无 scope） | 不变 |
| 目标 agent 的 prompt 贡献 | `prompts.contribute` + `spec.scope`（本线扩展维度） | **同 owner 扩展**：kind 面不变、conflict/dispose 语义不变、增加 target 键位（conflict 按 (owner, target, id) 判定） |
| 全局工具注册 / 可用性 | `tools.register` / `tools.restrict.register`（既有） | 不变 |
| 目标 agent 的工具注册/限制 | `tools.register(definition, { scope })` / `tools.restrict.register(policy, { scope })`（本线扩展维度） | **同 owner 扩展**：resourceRegistry/policy 外层合同不变，target 维度只作用于解析/可见性 |
| 整体 sections 替换 / 汇编筛选 | `prompts.assemblyPolicies.register`（decision-participation-contract 线） | **不在本线**：本线贡献恒为追加型；target 维度的整体替换走 decision 线的 scope binding（交叉条文见下） |
| 目标身份解析 / 生命周期锚点 | `agents.scopes`（本线新增） | acquire/status/dispose；agents 域既有 owner 之上增加贡献 target 维度，不夺 agents 领域既有 owner 权 |

## 生命周期与清理责任

| 事件 | 清理责任与动作 |
|---|---|
| target agent 销毁 | 门面订阅官方 `agent/disposed`（catalog fact，observe 路径即可）→ 按 target 身份 purge 该目标全部 scoped 贡献（跨 owner）；purge 只清 scoped registry 状态，不触碰官方 agent 遗留状态。销毁信号生产权归官方/agent authority，本线只消费。 |
| 贡献者插件卸载/重载 | owner identity-bound 撤除该 owner 全部 scoped 贡献（跨目标）；其他 owner 贡献存活；旧 generation handle 一律 typed no-op（不撤新贡献）。 |
| scope handle dispose | 释放 handle 名下 bookkeeping；其名下已安装贡献按 (owner, target, contribution id) identity-bound 撤除——handle dispose 撤「自己装的」，不撤别的 owner 对同一目标的贡献。 |
| cold resume | 目标身份稳定（probe 证实）→ scoped 贡献按 target 键存活，恢复后继续生效；贡献者已卸载的贡献不复活。 |
| 安装与销毁竞争 | 目标销毁后到达的安装 → typed unavailable/destroyed，不安装孤儿状态。 |

贡献本身为运行时 registry 状态（非 durable）；持久化需求走既有 session/workspace/profile 三档，由插件自行 re-install（需求 8）。

## 与 decision-participation-contract 的组合边界（交叉条文）

- **组合顺序固定**：目标 agent 汇编 = 全局追加贡献（`prompts.contribute` 无 scope）→ 目标 scoped 追加贡献（本线）→ assembly replacement policies（decision 线 `prompts.assemblyPolicies`，含 scope binding 时仅匹配目标）。本线**不提供**整体替换/删除语义；decision 线**不提供** target 贡献维度——各自 design 互引本条，集成波以本条为归属判据。
- **tools 侧对称**：scoped restrict（本线，作用于可见集）与 guard/pre-execute 决策（decision 线归 `tools.guard` 既有面）正交：前者决定「有哪些工具」，后者决定「工具执行是否放行」。
- **模型选择快照**：快照的**外部选择状态**归 interactive-session-access；本线定义**消费侧**——scoped variable 贡献暴露的选择变量与该步 route 解析读同一 per-step 快照（官方 installModelSelection 的「assembly 捕获 → 本步 route」语义为机制蓝本，Stage 4 以契约 probe 对照官方源码固化接线）；decision 线的 assembly policy 看到的 variables 亦为该步快照。三条 design 对快照归属的表述一致：选择状态 = interactive 线，快照机制接线 = 本线（消费侧）+ 官方语义，参与机制 = decision 线。

## 实现约束（不重写 agent service）

- 门面只在**既有**官方面上增加解析与登记：官方 AgentRegistry（create/resume/register）、官方 per-agent ctx 服务解析（probe 判定后选路）、官方 systemPrompt/tools 服务的既有方法。不 fork、不替换、不重写官方 agent 组件；无新 replacement 包；无新被禁用官方行。
- scoped registry 为门面内存态（owner/target/contribution 记录 + identity-bound disposer），与 `createContributeEntry` 既有 owner/id/seq 机制同构扩展；不建跨域大状态机。
- multi-layer 现有 API 能满足的部分（例如 fiber 内 caller-bound 安装在 P1 通过时）直接复用，不新增平行入口。

## 失败路径与 guard 策略

| 失败 | guard |
|---|---|
| 目标不可解析 / 已销毁 / backing 不可用 | typed `unavailable`（acquire 与安装皆然）；**不静默回退全局** |
| 同 owner 同 id 同目标重复贡献 | typed `conflict`（既有 prompts/tools conflict 语义，键位扩展） |
| stale handle / 旧 generation | typed no-op；identity-bound，不撤新贡献/他人贡献 |
| 贡献 provider 回调异常 | 按 assembly/tool 解析点的 containment 规则降级该贡献（不破坏汇编与其他 owner）；诊断有界 |
| agents/prompts/tools backing 缺失或版本错配 | capability degraded 仅限相关面；typed unavailable，不抛穿 apply |
| 贡献泄漏（回归防线） | 隔离断言（需求 4）作为正式测试矩阵：双 agent、双插件、全局+局部、反向装配顺序 |

## 并发与取消

- scoped registry 变更（install/dispose/purge）以门面记录层串行化；同 (owner, target, id) 互斥。
- agent 销毁与安装竞争按「销毁优先」收口（安装得到 typed 结果）；`agent/disposed` 到 purge 之间新装配不读到已销毁目标的贡献（purge 先于下一次汇编读取，或在读取处按目标存活状态过滤——以 probe 后实现为准，验收以需求 4/6 断言为准）。
- 无重试语义；abort 场景由上游 dispatch 的既有取消语义承载，本线不新增 signal 面。

## client 半面（capability-strategy §10 六问）

1. 被替换的官方行是否声明 client manifest？——**否**（本线不替换官方行）。
2. 是否注册 remote namespace？——**否**。
3. 是否提供 slot 或 settings bridge？——**否**。
4. 是否有 client↔host 版本协商？——**否**。
5. 是否有 browser-side state 或 reconnect 语义？——**否**。
6. 官方行是否拥有 client-facing event/service？——**否**（scope/contribution 均为 host 面语义）。

结论：**host-only**。客户端模型选择与作用域贡献的交汇（选择 → 本步快照 → prompt/route）由 interactive-session-access 的 client 面发起、经本线的 host 消费侧语义落地；本线不发布 client 面。

## Standards 逐分册适用性结论

| 分册 | 结论 |
|---|---|
| capability-strategy | **适用**：官方 agent scope/setup 的 A/B 门面化为主；无预批 R 点位（probe 不通时才升级人类裁决/通道评估）；host-only 六问已记录；无新 `services.*` 成员。 |
| api-shape | **适用**：主面 = contribution（追加、可撤销、不产生领域事实）；scoped tools = resourceRegistry 面；target 维度不改变各面边界；不把替换伪装成贡献。 |
| api-idioms | **适用**：contribution 形状（contribute/handle `{id, ownerId, seq, dispose}`、同 owner 同 id conflict、pending 不适用——安装为同步语义）；resourceRegistry/policy 形状在 scoped 变体上保持外层合同；`agents.scopes.acquire` 为登记型 handle（resourceRegistry 同构），status 为 projection 只读。 |
| public-api-shape | **适用**：`agents.scopes` 挂既有 agents 域；`prompts.contribute` / `tools.register` / `tools.restrict.register` 原地扩展维度；无顶层新域、无治理名泄漏。 |
| composition-and-authority | **适用**：additive composition + (owner, target) 键位冲突规则；owner 派生不可伪造；authority closure——scoped 贡献不旁路 prompts/tools 既有 authority，全部写路径经既有入口的 scope 维度。 |
| domain-composition | **适用**：`prompts` 行（加性注册 + assemble 决策点可写范围明确——追加归贡献、替换归 policy）与 `tools` 行（注册 owner 化、restrict 固定代数）对齐并扩展 target 维度。 |
| ordering | **不适用**（贡献为 additive 无序合并；汇编内顺序由 prompts 域既有稳定顺序承载，本线不引入新排序语义）。 |
| identity-and-lifecycle | **适用**：handle generation（owner-specific）；target 身份与 handle 实例分离；清理按 identity 而非共享键。 |
| durable-state-and-scope | **适用（边界确认）**：不引入 agent durable 档；scoped 贡献为运行时状态；三档持久 scope 不变。 |
| visibility-and-redaction | **部分适用**：scoped 贡献内容进入目标 prompt 即按既有 prompt 可见性规则；不新增受众面；不含 secret 处理。 |
| concurrency-and-cancellation | **适用**：销毁/安装竞争、stale handle、identity-bound 清理、提交资格（销毁后安装不生效）；无异步发布面。 |
| versioning-and-protocols | **部分适用**：冻结基线内交付；无新 wire/durable 协议；registry 同步随集成波。 |

## 迁移证据义务（Stage 4）

- `dsh-read-image`：per-agent 工具注册/提示词段从「官方 agent 作用域表面（契约外精度）」迁公共 scoped 路径，删除契约外精度保留（M8 8.3(b) 闭合证据）。
- agent-teams：成员 setup 场景（P2 形态）经 scope handle + scoped 贡献迁移；pre-step 激活归 decision 线（分工对账）。
- fiber probe 记录：probe 矩阵三项的运行证据与判定结论（P1/P2/升级），接线选路据此定稿并回写本文档（如有偏差按 spec 修订流程同步）。
- 隔离矩阵：需求 4/6/12 的全部组合作为正式回归（双 agent、双插件、反向顺序、abort/dispose/reload、cold resume）。
