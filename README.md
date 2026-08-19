# dsh-plugin-api-main

DeepSeek Harness 社区插件 API 门面（主包 `@deepseek-ai/dsh-plugin-api-main`）：把官方 Cordis 扩展点稳定化，给第三方插件一个统一、受支持的 import/inject 入口。仓库路径仍为 `agent/dsh-plugin-api`（monorepo，辅助 replacement bundles 位于 `packages/`）。

> 当前状态：M2 host 能力 + R 类 compaction-events 通道已交付。唯一 full version 为 `0.1.0-rc.6-0.4`，协议为 `dsh.api: 0.4`；consumer 仍须按 feature availability 做 fail-safe 降级。

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
- `ctx.pluginApi.assertCompatible(requirement, pluginName?)`：插件对门面的版本协商；不满足时抛出 `PluginApiVersionError`，插件应捕获后自行 fail-safe。

### Agent 创建与 provider 生命周期（A11，host-only）

当 `pluginApi.agent` 与 M1 注册表读面启用时，门面提供以下受支持的 host API：

- Consumer：`agent.create(options)`、`agent.resume(options)`、`agent.register(agent)`。
- Advanced provider：`agent.provider.enter(agent, owner)`、`agent.provider.announce(agent)`、`agent.provider.setFactory(factory)`。这些是受支持的有序 provider 生命周期原语，不是普通插件的推荐创建入口。
- `agent.availability`：只读、冻结的 `{ create, resume, register, provider: { enter, announce, setFactory } }` 六叶能力矩阵；`agent.provider.isActive` 仅在三个 provider 成员都可用时为 `true`。

A11 成员是官方 AgentRegistry 的 A 类同参直通。调用从消费者的 Cordis context 解析 `agents`，保留精确参数、官方 receiver、同步返回值、registry Promise、`AgentHandle`、Agent、disposer、官方错误、生命周期发布和 teardown 行为；门面不包装或拦截返回的 handle/disposer。成员级探测或调用前解析失败只将对应成员降级为 `PluginApiFeatureDisabledError('agent', ...)`，并保留其他已验证成员。core inactive 仍优先抛出 P1，M1 whole-agent guard 失败时为 P2；factory 缺失或 provider slot 被占用属于官方调用时结果，不改变 availability。

### Routing 与有限 durable surface

M2 提供一个 service-lifetime stable、冻结的 `pluginApi.routing` composite：

```js
pluginApi.routing.ofExecution(exec)
pluginApi.routing.current(session)
pluginApi.routing.on(session, listener)
pluginApi.routing.once(session, listener)
pluginApi.routing.wait(session, options?)
pluginApi.routing.availability // { execution: boolean, session: boolean }
```

`ofExecution()` 只返回已在 `tools/pre-execute` 捕获的 execution-time snapshot；`current/on/once/wait` 只表示已提交的 session route。两者都不是 session-created 或 prompt-assembly 时的 final route。`agent.routeOf(exec)` 与 `tools.routeOf(exec)` 是兼容委托，和 `routing.ofExecution()` 共用同一 authority。pre-assembly prepared-route 与 route-conditioned contribution 仍是 C-class upstream proposal，不提供 runtime contribution API。

有限 surface message 写入必须使用 `pluginApi.session.appendMessage(targetSession, kind, payload, { sourceEventSeqs? })`，仅支持 `user/message`、`assistant/message`、`tool/result`；facade 负责 `surfaceOp` 与 provenance 校验/派生，并执行一次官方 append。任意 durable event、title、replacement 或 atomic-turn 语义不属于该 helper；官方 `tool/call` 等非有限记录继续沿用官方 Session.append 路径，不属于有限 append helper。

L2 图片准入政策的 scoped gateway 是唯一 `resolveModelInfo` wrapper owner；`pluginApi.llm.modelInfo()` 仍读取 authoritative pre-overlay 信息。L4 兼容 re-entry 的 prepared-call、adapter-registration、routing、loop reconstruction 与 caller-provenance 等等价性不作保证。

## 逃生舱（unsupported escape hatch）

第三方插件**可以**绕过门面直接 `import` / `inject` `@deepseek-ai/dsh-*` 内部包。门面不拦截、不 patch、不 block 这种直连。

但该路径是 **unsupported**：

- 无兼容承诺；官方内部包变化时可能直接破坏你的插件。
- 不受门面版本协商与 fail-safe guard 保护。
- 风险自担。只有在门面尚未覆盖的命名空间上，才建议临时走逃生舱，并计划迁移回门面 API。

## 替换行通道（R 类，replacement bundle）

当缺失语义天然属于某个官方 loader 行、且经 `docs/capability-strategy.md` 批准登记时，可发布独立 replacement bundle：用官方 patch 机制（`- id: <官方行>; disabled: true` + `- insert:` 替代行）禁用该官方行，由替代行完整提供原行的 ctx 服务/事件契约并增加接口。R 类绝不修改官方安装文件；它只替换 ctx 服务/事件面，**不替换** `@deepseek-ai/dsh-*` 包 import 面。细则与候选清单见 `docs/capability-strategy.md`。

**已交付示例：`plugin-api-compaction-events-r1`**（辅助包 `@deepseek-ai/dsh-plugin-api-compaction-events`，源码 `packages/compaction-events-r1/`）fork 官方 `compaction-basic` 行，在完整保留 `ctx.compaction` 契约的前提下新增 `compaction/*` 事件词汇（`request/started/completed/failed/skipped`），主包 `pluginApi.events.catalog` 以动态 R slice 呈现（仅替代行 active 时列出），并配套 boot 自检矩阵与 `dsh-read-image` B4 stale-index 消费迁移。详见 `docs/specs/plugin-api-compaction-events-r1/`。

## 门面完整性（F0.4 / F0.5）

- 符号解析门面（F0.4）的权威定义见 `docs/specs/plugin-api-facade-integrity/requirements.md` §1。
- 门面安装的所有包装都遵循链安全契约（F0.5）：dispose 只还原自己的包装；目标被其他插件包装时降级透传，绝不拆别人的链。

## 加载顺序

`@deepseek-ai/dsh-plugin-api-main`（row id `plugin-api-main`）必须在第三方插件之前加载（`cordis.patch.yml` 已声明对应 row），否则依赖 `inject: ['pluginApi']` 的第三方插件会 pending 并杀死 boot。

## 测试

```bash
node --test
```
