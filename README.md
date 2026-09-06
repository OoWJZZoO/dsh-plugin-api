# dsh-plugin-api

DeepSeek Harness 社区插件 API 门面（主包 `@deepseek-ai/dsh-plugin-api-main`）：把官方 Cordis 扩展点稳定化，给第三方插件一个统一、受支持的 import/inject 入口。仓库路径为 `agent/dsh-plugin-api`（monorepo：主包 + `packages/` 下的辅助 replacement bundles + 全量聚合 bundle）。

> 当前状态：host 能力 + replacement 通道已交付，公共 API 已按业务领域树统一。已交付 replacement bundles：`compaction-events`（压缩事件词汇）、`session-title`（会话标题候选资格策略）、`mcp`（MCP server/tool catalog 与 lifecycle 只读投影）、`attachments`（attachment pipeline/投影）、`agent-loop`（model route policy/health/circuit）、`session-branch`（会话分支与编辑）、`tool-skill`（skill activation 与动态目录）、`llm`（adapter decoration lifecycle）、`session-channel-connection`（连接层 transport/围栏/resume）、`session-channel-gateway`（channel RPC 派发/remote 命名空间）。
>
> host 公共领域根：`agents` / `sessions`（含 `sessions.branches`、`sessions.channels`）/ `executions`（含 `executions.recovery`）/ `llm`（含 `llm.routing`、`llm.adapters`、`llm.requestTransforms`、`llm.admissionPolicies`）/ `prompts`（含 `prompts.provenance`）/ `tools`（含 `tools.discovery`）/ `skills.activation` / `attachments` / `mcp` / `tasks` / `coordination` / `workspaces.transactions` / `security` / `diagnostics` / `settings` / `profiles` / `remotes` / `storage` / `services`；client 为 `ctx.pluginApi` 直接根成员（已无 `.client` 子命名空间）：`connection` / `events` / `remotes` / `settings` / `slots` / `lifecycle` / `codec` / `services`。marker 门控的 R 类投影：`attachments` / `llm.adapters` / `sessions.branches` / `skills.activation` / `mcp`。
>
> 现行公共 path、成员状态与版本基线的唯一事实源是 `docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`（旧 path → 目标 path 映射见其 `oldToTargetMapping`）。主包与全部辅助包统一 full version `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`；consumer 仍须按 capability availability 做 fail-safe 降级。
>
> 政策强制闭合约定（2026-09-01）：`security.egress` 对已登记受支持官方路径（llm model discovery、mcp stdio/http transport）自动管治——出站策略是 **denylist**：初始不注册任何策略，未命中 deny 策略的出站目标保持官方原版行为，只有显式 deny 策略拦截；合作型第三方在调用公共接口（`security.egress.register` / `lease.acquire|release`）时受支持，直接绕过（裸网络/进程原语）不在保证内；`executions.recovery` 自动消费单窗口至多一次，合作型求值走 `executions.recovery.evaluate`；`events.define` 提供合作型自定义事件生产（canonical/custom 分域、owner-conflict 确定性拒绝、stale publisher 失效），不提供对抗性同进程隔离；其余官方路径与具名 edge gap（web/subprocess/terminal/shell/connection/telemetry/llm-provider/remote）的边界见 `docs/specs/plugin-api-policy-enforcement-closure/delivery-report.md`。

## 安装

只提供两种明确的安装模式。

默认全量安装（主包 + 全部替代行，由聚合 bundle 的 patch 按确定顺序装配）：

```bash
dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-full
```

选择性安装（按需添加辅助包）：

```bash
dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-main
dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-compaction-events
# 需要标题候选策略时：
# dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-session-title
# 需要 MCP 只读 catalog/lifecycle 投影时：
# dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-mcp
# 需要 attachment pipeline 时：
# dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-attachments
# 需要 model route policy（agent-loop）时：
# dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-agent-loop
# 需要会话分支与编辑时：
# dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-session-branch
# 需要 skill activation 与动态目录时：
# dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-tool-skill
# 需要 adapter decoration lifecycle 时：
# dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-llm
# 需要远程会话通道（连接层 + gateway）时：
# dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-session-channel-connection
# dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-session-channel-gateway
```

`@deepseek-ai/dsh-plugin-api-full` 只做聚合：依赖主包与全部辅助包（含上述十个 replacement bundle），并拥有一份按确定顺序装配主包及所有替代行的 patch；它不新增任何 API，第三方 API 仍完全由主包的 `ctx.pluginApi` 提供。全量安装必须与选择性安装（main + 全部辅助包）装配出同一组主包行与替代行、同一行为；任一辅助包与主包版本不一致时，只停用该辅助包对应的 replacement 特性，不波及主包门面。

## 版本协商（主包与辅助包统一）

- 每个包都使用全量唯一版本号 `<A>-<B>.<C>.<D>`，即 `<runtime 全量 identity>-<API 大版本.迭代小版本.包本地维护号>`（当前 `0.1.0-rc.6-0.1.0`）；`dsh.api` 只承载 `B.C`（当前 `0.1`）。`A` 与已安装 runtime 全量 identity 精确匹配，`D` 为包本地维护号、不参与协商；模型口径见 AGENTS.md §4 第 2 条。
- 主包要求辅助包版本一致（runtime 全量 identity 与 `dsh.api` 都相等）。不一致时**只停用该辅助包对应的 replacement 特性**（其替代行仍提供官方原接口，新增事件/策略 vocabulary 不发布），不波及主包门面或其他能力。
- 第三方插件用 `ctx.pluginApi.assertCompatible('0.1', 'my-plugin')` 做方向② 协商；不满足时抛出 `PluginApiVersionError`，插件应捕获后自行 fail-safe。

## 推荐用法（supported）

第三方插件默认通过门面消费稳定 API：

```js
export const inject = ['pluginApi']

export function apply(ctx) {
  if (!ctx.pluginApi.isActive) {
    // 门面 core 自检未通过，安全停用自己
    return
  }
  ctx.pluginApi.assertCompatible('0.1', 'my-plugin')
  // 使用门面领域 API，例如 ctx.pluginApi.llm.admissionPolicies.register(...)
}
```

门面提供：

- `ctx.pluginApi.isActive`：门面核心是否通过自检（`false` 时其余 API 会抛出 inactive 错误）。
- `ctx.pluginApi.capabilities`：registry-backed 能力查询面（`get` / `list` / `require`），按 capability path 给出描述与 `active | degraded | unavailable` 可用性；不暴露内部 feature/mounter 快照、包名或替代行。
- `ctx.pluginApi.assertCompatible(requirement, pluginName?)`：插件对门面的版本协商。

### Agent 创建与 provider 生命周期（host-only）

当 `pluginApi.agents` 与注册表读面启用时，门面提供以下受支持的 host API：

- Consumer：`agents.create(options)`、`agents.resume(options)`、`agents.register(agent)`。
- Advanced provider：`agents.providers.enter(agent, owner)`、`agents.providers.announce(agent)`、`agents.providers.setFactory(factory)`。这些是受支持的有序 provider 生命周期原语，不是普通插件的推荐创建入口；singleton provider 需要显式 claim。
- `agents.availability`：只读、冻结的统一形状 `{ status: 'active' | 'degraded' | 'unavailable', reason?: string }`；成员级探测由调用时的类型化错误承接。

Agent extension 成员是官方 AgentRegistry 的同参直通。调用从消费者的 Cordis context 解析 `agents`，保留精确参数、官方 receiver、同步返回值、registry Promise、`AgentHandle`、Agent、disposer、官方错误、生命周期发布和 teardown 行为；门面不包装或拦截返回的 handle/disposer。成员级探测或调用前解析失败只将对应成员降级为 `PluginApiFeatureDisabledError('agent', ...)`，并保留其他已验证成员；core inactive 仍优先抛 inactive 错误，whole-agent guard 失败时为 feature-disabled 错误；factory 缺失或 provider slot 被占用属于官方调用时结果，不改变 availability。

### Routing 与有限 durable surface

提供一个 service-lifetime stable、冻结的 `pluginApi.llm.routing` composite（原 `pluginApi.routing` 与 `pluginApi.routePolicy` 已合并于此）：

```js
pluginApi.llm.routing.forExecution(exec)
pluginApi.llm.routing.current(session)
pluginApi.llm.routing.on(session, listener)
pluginApi.llm.routing.once(session, listener)
pluginApi.llm.routing.wait(session, options?)
pluginApi.llm.routing.policies   // 原 routePolicy 面（复数 policies）
pluginApi.llm.routing.candidates / health / circuit / decisions
pluginApi.llm.routing.availability // { status: 'active' | 'degraded' | 'unavailable', reason?: string }
```

`forExecution()` 只返回已在 `tools/pre-execute` 捕获的 execution-time snapshot；`current/observe/wait` 只表示已提交的 session route（`on/once` 已合并为 `observe`）。两者都不是 session-created 或 prompt-assembly 时的 final route。旧的 `agent.routeOf(exec)` / `tools.routeOf(exec)` 兼容委托**已删除**，route 查询唯一入口为 `llm.routing.forExecution()`。pre-assembly prepared-route 与 route-conditioned contribution 仍是 upstream proposal，不提供 runtime contribution API。

有限 surface message 写入必须使用 `pluginApi.sessions.appendMessage(targetSession, kind, payload, { sourceEventSeqs? })`，仅支持 `user/message`、`assistant/message`、`tool/result`；facade 负责 `surfaceOp` 与 provenance 校验/派生，并执行一次官方 append。任意 durable event、title、replacement 或 atomic-turn 语义不属于该 helper。

图片准入政策的 scoped gateway 是唯一 `resolveModelInfo` wrapper owner；`pluginApi.llm.modelInfo()` 仍读取 authoritative pre-overlay 信息。兼容请求 transform 的 prepared-call、adapter-registration、routing、loop reconstruction 与 caller-provenance 等等价性不作保证。

### 会话活动投影、请求操作、注意力与检查点（M9 域）

- `pluginApi.sessions.activity`：session 活动只读投影（`current/get/list/history/observe/availability`）。attempt 事实与排队证据来自共享 loop boundary slice 时以 `observed` 置信呈现，切片缺位/版本错配时如实降级为 `reconstructed/unknown`，绝不把猜测标成 observed。
- `pluginApi.sessions.request / sessions.cancel`：受单一 authority 约束的会话请求/取消操作。返回 operation handle（`{id, ownerId, capability, status(), observe(), dispose()}`）；内部 retry 是同一 activity 下的新 attempt；终态 `success|error|aborted|denied|superseded` 一经提交不可改写。浏览器面同形 stub 经 `/plugin-api/sessions` 类型化通道，通道缺位时 typed unavailable，绝不排队。
- `pluginApi.attention`：host 注意力 hub 的冻结投影与 contribution 面（`current/list/observe/contribute/dismiss/invoke/availability`）。内容 host 边界先行脱敏，per-stream audience 裁剪 fail-closed；浏览器侧经 `attention/update` 沿官方 host→browser 事件流送达（`$on` 合法键集保持官方 11 键）。
- `pluginApi.executions.recovery.checkpoints`：checkpoint capture/投影/恢复（`create/list/inspect/planRestore/restore/availability`）。capture 是 durable mutation，plan 纯只读且无副作用，restore 经单一 operation authority + coordination fencing 提交终态；stop-then-restore 使用共享切片唯一 cancel 路径（`by: 'system'` + restore cause），不承诺外部副作用自动回滚。

每个命名空间提供无副作用 `availability()`（`{status: 'active' | 'degraded' | 'unavailable', reason?}`）。

## 逃生舱（unsupported escape hatch）

第三方插件**可以**绕过门面直接 `import` / `inject` `@deepseek-ai/dsh-*` 内部包。门面不拦截、不 patch、不 block 这种直连。

但该路径是 **unsupported**：

- 无兼容承诺；官方内部包变化时可能直接破坏你的插件。
- 不受门面版本协商与 fail-safe guard 保护。
- 风险自担。只有在门面尚未覆盖的命名空间上，才建议临时走逃生舱，并计划迁移回门面 API。

## 替换行通道（replacement bundle）

当缺失语义天然属于某个官方 loader 行、且经 `docs/standards/capability-strategy.md` 批准登记时，可发布独立 replacement bundle：用官方 patch 机制（`- id: <官方行>; disabled: true` + `- insert:` 替代行）禁用该官方行，由替代行完整提供原行的 ctx 服务/事件契约并增加接口。replacement 绝不修改官方安装文件；它只替换 ctx 服务/事件面，**不替换** `@deepseek-ai/dsh-*` 包 import 面。

**已交付示例：`@deepseek-ai/dsh-plugin-api-compaction-events`**（源码 `packages/compaction-events/`，row id `plugin-api-compaction-events`）fork 官方 `compaction-basic` 行，在完整保留 `ctx.compaction` 契约的前提下新增 `compaction/*` 事件词汇（`request/started/completed/failed/skipped`）；**`@deepseek-ai/dsh-plugin-api-session-title`**（源码 `packages/session-title/`，row id `plugin-api-session-title`）fork 官方 `session-title` 行并提供 `session-title/candidate` 候选资格策略瀑布；**`@deepseek-ai/dsh-plugin-api-mcp`**（源码 `packages/mcp/`，row id `plugin-api-mcp`）fork 官方 `mcp-client` 行，在忠实复刻官方 host ctx 契约之上提供只读 `ctx.mcpCatalog` catalog/lifecycle 投影；**`@deepseek-ai/dsh-plugin-api-attachments`**（源码 `packages/attachments/`，row id `plugin-api-attachments`）fork 官方 `attachment-local` 行，保留 `ctx.attachments` 官方契约并增加 `pipeline` / `projection`；**`@deepseek-ai/dsh-plugin-api-agent-loop`**（源码 `packages/agent-loop/`，row id `plugin-api-agent-loop`）fork 官方 `agent-loop` 行，保留 `ctx.agentLoop` 官方契约并增加有序 route 收敛与 attempt decision evidence；**`@deepseek-ai/dsh-plugin-api-session-branch`**（源码 `packages/session-branch/`，row id `plugin-api-session-branch`）fork 官方 `session` 行，增加 named branch 与 CAS edit plan；**`@deepseek-ai/dsh-plugin-api-tool-skill`**（源码 `packages/tool-skill/`，row id `plugin-api-tool-skill`）fork 官方 `tool-skill` 行，增加 per-session activation 与动态目录；**`@deepseek-ai/dsh-plugin-api-llm`**（源码 `packages/llm/`，row id `plugin-api-llm`）fork 官方 `llm` 行，增加 adapter decoration lifecycle；**`@deepseek-ai/dsh-plugin-api-session-channel-connection`**（源码 `packages/session-channel-connection/`，row id `plugin-api-session-channel-connection`）与 **`@deepseek-ai/dsh-plugin-api-session-channel-gateway`**（源码 `packages/session-channel-gateway/`，row id `plugin-api-session-channel-gateway`）协同提供远程会话通道；**`@deepseek-ai/dsh-plugin-api-workspace`**（源码 `packages/workspace/`，row id `plugin-api-workspace`）组合官方 `workspace` 行并增加受管状态 snapshot capture/get/apply（fail-closed 官方-API 重建）；**`@deepseek-ai/dsh-plugin-api-api-remotes`**（源码 `packages/api-remotes/`，row id `plugin-api-api-remotes`）复刻官方 `api-remotes` 行并增加 `attention/update` typed 扩展转发；**`@deepseek-ai/dsh-plugin-api-client-runtime`**（源码 `packages/client-runtime/`，row id `plugin-api-client-runtime`）复刻官方 `client-runtime` 行并承载浏览器注意力运行时。主包 `pluginApi.events.catalog` 以动态 replacement slice 呈现（仅替代行 active 且版本一致时列出）；R 类 marker-gated 投影（`pluginApi.mcp` / `attachments` / `llm.adapters` / `sessions.branches` / `skills.activation`）仅在对应替代行激活时出现（原 `routePolicy` 面已并入 `llm.routing`）。专项规格见 `docs/specs/` 下对应制品。

## 门面完整性

- 符号解析门面的权威定义见 `docs/specs/plugin-api-facade-integrity/requirements.md` §1。
- 门面安装的所有包装都遵循链安全契约：dispose 只还原自己的包装；目标被其他插件包装时降级透传，绝不拆别人的链。

## 加载顺序

`@deepseek-ai/dsh-plugin-api-main`（row id `plugin-api-main`）必须在第三方插件之前加载（`cordis.patch.yml` 与全量聚合 bundle 的 patch 均已声明该顺序），否则依赖 `inject: ['pluginApi']` 的第三方插件会 pending 并杀死 boot。

## 全局规范

- 现行全局设计规范统一收于 `docs/standards/`，索引见 `docs/standards/README.md`：能力策略与 `services.*` 分级、语义三面、公共 API idiom 与成员级契约、公共 namespace 与成员形状、组合与 authority、领域组合最低要求、多插件排序、身份与生命周期、持久状态与作用域、可见性与脱敏、并发与取消、版本与协议。这些分册只写**当前仓库事实**。

## 测试

```bash
# 覆盖仓库全量测试（test/ 与全部 packages/*/test/；temp/ 等临时目录永不参与扫描）
npm test
```
