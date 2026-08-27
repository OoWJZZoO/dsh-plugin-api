# dsh-plugin-api

DeepSeek Harness 社区插件 API 门面（主包 `@deepseek-ai/dsh-plugin-api-main`）：把官方 Cordis 扩展点稳定化，给第三方插件一个统一、受支持的 import/inject 入口。仓库路径为 `agent/dsh-plugin-api`（monorepo：主包 + `packages/` 下的辅助 replacement bundles + 全量聚合 bundle）。

> 当前状态：host 能力 + replacement 通道已交付。已交付 replacement bundles：`compaction-events`（压缩事件词汇）、`session-title`（会话标题候选资格策略）、`mcp`（MCP server/tool catalog 与 lifecycle 只读投影）、`attachments`（attachment pipeline/投影）、`agent-loop`（model route policy/health/circuit）、`session-branch`（会话分支与编辑）、`tool-skill`（skill activation 与动态目录）、`llm`（adapter decoration lifecycle）、`session-channel-connection`（连接层 transport/围栏/resume）、`session-channel-gateway`（channel RPC 派发/remote 命名空间）。M6 门面投影：`pluginApi.execution` / `diagnostics` / `recovery` / `coordination` / `workspaceTransactions` / `tasks` / `security` / `context` / `profile` / `sessionChannel`，以及 marker 门控的 `pluginApi.routePolicy` / `mcp` / `attachments` / `llm.adapters` / `session.branches` / `skills.activation` 与 client 侧 `pluginApi.client.lifecycle`。主包与全部辅助包统一 full version `0.1.0-rc.6-0.7`、`dsh.api: 0.7`；consumer 仍须按 feature availability 做 fail-safe 降级。

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

- 每个包都使用全量唯一版本号 `<runtime全量版本>-<API协议大版本.迭代小版本>`（当前 `0.1.0-rc.6-0.7`），`dsh.api` 仅承载 API 协议版本（当前 `0.7`）。
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
  // 使用门面 feature API，例如 ctx.pluginApi.llm.admission.register(...)
}
```

门面提供：

- `ctx.pluginApi.isActive`：门面核心是否通过自检（`false` 时其余 API 会抛出 inactive 错误）。
- `ctx.pluginApi.features`：各 feature 的启用/禁用快照，例如 `[{ name: 'llm/admission', isActive: true }]`。
- `ctx.pluginApi.assertCompatible(requirement, pluginName?)`：插件对门面的版本协商。

### Agent 创建与 provider 生命周期（host-only）

当 `pluginApi.agent` 与注册表读面启用时，门面提供以下受支持的 host API：

- Consumer：`agent.create(options)`、`agent.resume(options)`、`agent.register(agent)`。
- Advanced provider：`agent.provider.enter(agent, owner)`、`agent.provider.announce(agent)`、`agent.provider.setFactory(factory)`。这些是受支持的有序 provider 生命周期原语，不是普通插件的推荐创建入口。
- `agent.availability`：只读、冻结的 `{ create, resume, register, provider: { enter, announce, setFactory } }` 六叶能力矩阵；`agent.provider.isActive` 仅在三个 provider 成员都可用时为 `true`。

Agent extension 成员是官方 AgentRegistry 的同参直通。调用从消费者的 Cordis context 解析 `agents`，保留精确参数、官方 receiver、同步返回值、registry Promise、`AgentHandle`、Agent、disposer、官方错误、生命周期发布和 teardown 行为；门面不包装或拦截返回的 handle/disposer。成员级探测或调用前解析失败只将对应成员降级为 `PluginApiFeatureDisabledError('agent', ...)`，并保留其他已验证成员；core inactive 仍优先抛 inactive 错误，whole-agent guard 失败时为 feature-disabled 错误；factory 缺失或 provider slot 被占用属于官方调用时结果，不改变 availability。

### Routing 与有限 durable surface

提供一个 service-lifetime stable、冻结的 `pluginApi.routing` composite：

```js
pluginApi.routing.ofExecution(exec)
pluginApi.routing.current(session)
pluginApi.routing.on(session, listener)
pluginApi.routing.once(session, listener)
pluginApi.routing.wait(session, options?)
pluginApi.routing.availability // { execution: boolean, session: boolean }
```

`ofExecution()` 只返回已在 `tools/pre-execute` 捕获的 execution-time snapshot；`current/on/once/wait` 只表示已提交的 session route。两者都不是 session-created 或 prompt-assembly 时的 final route。`agent.routeOf(exec)` 与 `tools.routeOf(exec)` 是兼容委托，和 `routing.ofExecution()` 共用同一 authority。pre-assembly prepared-route 与 route-conditioned contribution 仍是 upstream proposal，不提供 runtime contribution API。

有限 surface message 写入必须使用 `pluginApi.session.appendMessage(targetSession, kind, payload, { sourceEventSeqs? })`，仅支持 `user/message`、`assistant/message`、`tool/result`；facade 负责 `surfaceOp` 与 provenance 校验/派生，并执行一次官方 append。任意 durable event、title、replacement 或 atomic-turn 语义不属于该 helper。

图片准入政策的 scoped gateway 是唯一 `resolveModelInfo` wrapper owner；`pluginApi.llm.modelInfo()` 仍读取 authoritative pre-overlay 信息。兼容请求 transform 的 prepared-call、adapter-registration、routing、loop reconstruction 与 caller-provenance 等等价性不作保证。

## 逃生舱（unsupported escape hatch）

第三方插件**可以**绕过门面直接 `import` / `inject` `@deepseek-ai/dsh-*` 内部包。门面不拦截、不 patch、不 block 这种直连。

但该路径是 **unsupported**：

- 无兼容承诺；官方内部包变化时可能直接破坏你的插件。
- 不受门面版本协商与 fail-safe guard 保护。
- 风险自担。只有在门面尚未覆盖的命名空间上，才建议临时走逃生舱，并计划迁移回门面 API。

## 替换行通道（replacement bundle）

当缺失语义天然属于某个官方 loader 行、且经 `docs/standards/capability-strategy.md` 批准登记时，可发布独立 replacement bundle：用官方 patch 机制（`- id: <官方行>; disabled: true` + `- insert:` 替代行）禁用该官方行，由替代行完整提供原行的 ctx 服务/事件契约并增加接口。replacement 绝不修改官方安装文件；它只替换 ctx 服务/事件面，**不替换** `@deepseek-ai/dsh-*` 包 import 面。

**已交付示例：`@deepseek-ai/dsh-plugin-api-compaction-events`**（源码 `packages/compaction-events/`，row id `plugin-api-compaction-events`）fork 官方 `compaction-basic` 行，在完整保留 `ctx.compaction` 契约的前提下新增 `compaction/*` 事件词汇（`request/started/completed/failed/skipped`）；**`@deepseek-ai/dsh-plugin-api-session-title`**（源码 `packages/session-title/`，row id `plugin-api-session-title`）fork 官方 `session-title` 行并提供 `session-title/candidate` 候选资格策略瀑布；**`@deepseek-ai/dsh-plugin-api-mcp`**（源码 `packages/mcp/`，row id `plugin-api-mcp`）fork 官方 `mcp-client` 行，在忠实复刻官方 host ctx 契约之上提供只读 `ctx.mcpCatalog` catalog/lifecycle 投影；**`@deepseek-ai/dsh-plugin-api-attachments`**（源码 `packages/attachments/`，row id `plugin-api-attachments`）fork 官方 `attachment-local` 行，保留 `ctx.attachments` 官方契约并增加 `pipeline` / `projection`；**`@deepseek-ai/dsh-plugin-api-agent-loop`**（源码 `packages/agent-loop/`，row id `plugin-api-agent-loop`）fork 官方 `agent-loop` 行，保留 `ctx.agentLoop` 官方契约并增加有序 route 收敛与 attempt decision evidence；**`@deepseek-ai/dsh-plugin-api-session-branch`**（源码 `packages/session-branch/`，row id `plugin-api-session-branch`）fork 官方 `session` 行，增加 named branch 与 CAS edit plan；**`@deepseek-ai/dsh-plugin-api-tool-skill`**（源码 `packages/tool-skill/`，row id `plugin-api-tool-skill`）fork 官方 `tool-skill` 行，增加 per-session activation 与动态目录；**`@deepseek-ai/dsh-plugin-api-llm`**（源码 `packages/llm/`，row id `plugin-api-llm`）fork 官方 `llm` 行，增加 adapter decoration lifecycle；**`@deepseek-ai/dsh-plugin-api-session-channel-connection`**（源码 `packages/session-channel-connection/`，row id `plugin-api-session-channel-connection`）与 **`@deepseek-ai/dsh-plugin-api-session-channel-gateway`**（源码 `packages/session-channel-gateway/`，row id `plugin-api-session-channel-gateway`）协同提供远程会话通道。主包 `pluginApi.events.catalog` 以动态 replacement slice 呈现（仅替代行 active 且版本一致时列出）；R 类 marker-gated 投影（`pluginApi.mcp` / `attachments` / `routePolicy` / `llm.adapters` / `session.branches` / `skills.activation`）仅在对应替代行激活时出现。专项规格见 `docs/specs/` 下对应制品。

## 门面完整性

- 符号解析门面的权威定义见 `docs/specs/plugin-api-facade-integrity/requirements.md` §1。
- 门面安装的所有包装都遵循链安全契约：dispose 只还原自己的包装；目标被其他插件包装时降级透传，绝不拆别人的链。

## 加载顺序

`@deepseek-ai/dsh-plugin-api-main`（row id `plugin-api-main`）必须在第三方插件之前加载（`cordis.patch.yml` 与全量聚合 bundle 的 patch 均已声明该顺序），否则依赖 `inject: ['pluginApi']` 的第三方插件会 pending 并杀死 boot。

## 测试

```bash
# 覆盖仓库全量测试（test/ 与全部 packages/*/test/；temp/ 等临时目录永不参与扫描）
npm test
```
