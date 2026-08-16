# Tasks: plugin-api-agent-m1

> 依据：`requirements.md`（Stage 1，已批准，含 `agent/created` 修订）与 `design.md`（Stage 2，已批准）。
> 执行顺序：Stage 4 按编号顺序一次一个任务；每个任务完成后跑相关测试，全部通过再进入下一个任务。
> 测试运行器：`node --test`。纯函数模块零 harness 依赖；涉及 Cordis/官方服务的测试使用 mock。
> 迁移验收：A1–A8 对应官方已 dispatch 事件与 `ctx.agents` 读面，无 dsh-read-image / dsh-pro-ex-ability-anchor 既有 hack 可删（那些迁移对象是 A9/T10、S2、P6、C1 等，不在本 feature 范围）。本 feature 验收以全量回归 + 消费者接入测试为准（见任务 6.2）。

---

## 1. 事件目录扩展与 schema 升级

- [ ] 1.1 修改 `lib/events-catalog.js`：
  - schema 字段 `subject` 统一改为 `scopeKey`；
  - 每个条目新增 `fault` 与 `freeze` 字段；
  - 既有 19 个事件全部回填 `fault: 'contain'`、`freeze: 'all'`、`scopeKey` 与原 `subject` 取值一致；
  - 新增 design §1.3 表中的 12 个 `agent/*` 条目（name/mode/scopeFiltered/scopeKey/fault/freeze/payload/args/type/source 与 design 表逐项一致）；
  - 保持整个 catalog 与每个 entry 深冻结，`catalogEntryOf(name)` 行为不变。
- [ ] 1.2 更新 `test/events-catalog.test.mjs`：
  - 断言 catalog 恰好 31 个事件名（原 19 + 新 12），且无其他 `agent/*`；
  - 断言每个条目字段齐全且 schema 合法（`mode/scopeFiltered/scopeKey/payload/args/source/type/fault/freeze`）；
  - 断言 12 个 agent 事件的 mode/scopeKey/fault/freeze 与 design 表一致；
  - 断言 19 个旧事件 fault=`'contain'`、freeze=`'all'`、scopeKey 与原 subject 一致；
  - 断言 catalog 与每个 entry 均 `Object.isFrozen`，`catalogEntryOf` 命中/未命中行为。
- 引用：requirements §1 AC 1.1–1.5、§12 AC 12.1；design Components 1、Data Models。

## 2. `freezeByPolicy` 纯函数

- [ ] 2.1 修改 `lib/deep-freeze.js`：新增 `freezeByPolicy(value, policy)`：
  - `policy === 'all'`：返回 `deepFreeze(value)`；
  - `policy` 为对象：若 `value` 为 object（函数/primitive 原样返回），先 `Object.freeze(value)`，再对 `policy.deep ?? []` 中每个存在于 `value` 的顶层字段调用 `deepFreeze(value[key])`；
  - 其他情况原样返回；任何异常捕获后返回原值，绝不 throw。
- [ ] 2.2 更新 `test/deep-freeze.test.mjs`：
  - `freezeByPolicy(value, 'all')` 等价于 `deepFreeze(value)`；
  - `freezeByPolicy(value, { deep: ['messages'] })`：顶层浅冻结、`messages` 深冻结、未列出的嵌套对象不被深冻结；
  - 函数/primitive/循环对象/exotic 对象不抛且返回原值。
- 引用：requirements §9.3 AC 9.3.1–9.3.7；design Components 2。

## 3. events-bus per-event freeze / fault / scopeKey

- [ ] 3.1 修改 `lib/events-bus.js`：
  - 引入 `freezeByPolicy`；把 `createWrappedListener` 中的全量 `deepFreeze(arg)` 替换为 `freezeByPolicy(arg, meta.freeze)`；
  - scope gate 的 `meta.subject` 改为 `meta.scopeKey`；
  - 非 waterfall 路径按 `meta.fault` 分派：
    - `entry.priority === 'monitor'`：维持 observe-only contain（不随 fault 变化）；
    - `meta.fault === 'propagate'`：直接 `return entry.listener.apply(this, args)`，不 catch、不处理 thenable；
    - `meta.fault === 'created'`：不 catch 同步 throw；对 thenable 挂 `Promise.resolve(returned).then(v => v, e => { contain(e); return undefined })`；
    - 其他（`'contain'`）：维持现有 contain 行为；
  - waterfall 路径按 `meta.fault` 分派：
    - `entry.priority === 'monitor'`：维持 observe-only contain；
    - `meta.fault === 'propagate'`：用 `guardedNext` 包装 `next` 后直接 `return entry.listener.apply(this, callArgs)`，不 try/catch；
    - 其他（`'contain'`）：维持现有 contain 行为；
  - 非 cataloged 透传、priority 排序、disposer 幂等、once 先移除后调用、reconcile 回滚、disposeAll 均不变。
- [ ] 3.2 更新 `test/events-bus.test.mjs`（扩展 mock `scopedEmit/scopedSerial/scopedWaterfall`）：
  - 7 个 contain emit：sync throw / async rejection 被 contain，其余 listeners 继续；
  - `agent/created`：sync throw 传播出 mock official dispatch，async rejection 被 contain 且后续 listeners 继续；
  - `agent/pre-step`/`agent/request`/`agent/request-error`：不调用 `next()` 返回替换值成为结果；调用 `next()` 可组合；sync throw 与 rejected promise 传播到 mock official dispatch；不匹配 scope 调 `next()` 继续；
  - `agent/turn-stopping`：顺序、bail 短路、不匹配 scope 返回 `undefined`、sync throw/rejection 传播；
  - 全部 12 个 agent 事件：`opts.scope` 匹配时只投递给该 scope，不匹配时 emit 不调用 / serial 返回 `undefined` / waterfall 调 `next()`；`opts.scope` 省略时全局可见；
  - freeze policy：`agent/pre-step` listener 内 payload 顶层 frozen、`payload.messages` 与每个 message frozen、`payload.agent`/`payload.signal` 未被 facade 冻结（`Object.isFrozen` false 且引用恒等）；`agent/request` payload 顶层 frozen、`agent`/`signal` 未冻结；
  - `monitor` listener 在 agent 事件上永不改变 waterfall/serial/emit 结果，即使 fault=`'propagate'` 也 contain；
  - 非 cataloged 名透传不变。
- 引用：requirements §2–§9、§12 AC 12.2–12.6；design Components 3、Error Handling 3–8。

## 4. `pluginApi.agent` disabled stub 与挂载点

- [ ] 4.1 修改 `lib/plugin-api-service.js`：
  - 新增 `createDisabledAgentApi(active)`：`isActive: false`，`get/list/roots` 方法在 inert 时抛 `PluginApiInactiveError`，feature-disabled 时抛 `PluginApiFeatureDisabledError('agent')`；
  - 构造函数新增 `this.agent = createDisabledAgentApi(active)`；
  - `mountFeature(name, api)` 增加 `'agent'` 分支：`this.agent = api`。
- [ ] 4.2 新增 `test/plugin-api-service-agent.test.mjs`：
  - inert 与 feature-disabled 两种 stub 行为（`get/list/roots` 抛对应 typed error，且不触碰任何官方服务）；
  - `mountFeature('agent', api)` 后 `get/list/roots` 可调；
  - `mountFeature` 未知名仍拒绝。
- 引用：requirements §10 AC 10.4–10.5、§11 AC 11.1–11.3；design Components 4。

## 5. `agent` feature guard

- [ ] 5.1 修改 `lib/guards.js` `runFeatureGuard`：新增 `agent` 分支：
  - probe `agents.get`：`ctx.get('agents')?.get` 为 function；
  - probe `agents.list`：`ctx.get('agents')?.list` 为 function；
  - probe `agents.roots`：`ctx.get('agents')?.roots` 为 function；
  - 不探测任何 `agent/*` 事件源。
- [ ] 5.2 更新 `test/events-guard.test.mjs`：`runFeatureGuard('agent')` probe 矩阵；缺 `agents` 服务或任一方法时仅 `agent` 禁用；`agent` 失败不影响 events/web/llm-admission。
- 引用：requirements §11、§12 AC 12.8；design Components 5。

## 6. `mountAgentFeature` 与集成测试

- [ ] 6.1 修改 `lib/index.js`：
  - 新增 `mountAgentFeature({ ctx, service })`：幂等检查 `service?.agent?.isActive === true` 时返回 no-op；否则 `safeGet(ctx, 'agents')`，构造 `agentApi = { isActive: true, get(id){ return agents.get(id) }, list(){ return agents.list() }, roots(){ return agents.roots() } }`，`service.mountFeature('agent', agentApi)`，返回 no-op disposer；
  - `FEATURE_MOUNTERS` 顺序调整为 `events` → `agent` → `web` → `llm/admission`。
- [ ] 6.2 新增 `test/index-agent.test.mjs` 与 `test/agent-api.test.mjs`：
  - mock `agents` 服务验证 `get/list/roots` 直通（返回值恒等、fresh array、不缓存不排序不克隆）；
  - apply 成功挂载 `agent`；agent guard 失败时门面仍 active 且只禁用 `agent`；apply 永不 throw；
  - `events` 失败不影响 `agent` 直通，反之亦然；
  - 消费者接入测试：模拟第三方插件经 `inject: ['pluginApi']` 使用 `pluginApi.events.on('agent/created', ...)` 与 `pluginApi.agent.get/list/roots`，不 import `dsh-agent` 内部包。
- 引用：requirements §10、§11、§12 AC 12.7–12.10；design Components 6。

## 7. 文档同步与全量回归

- [ ] 7.1 更新仓库根 `AGENTS.md` 第 8 节：追加 `plugin-api-agent-m1` 条目（范围 A1–A8、状态 delivered、spec 目录 `docs/specs/plugin-api-agent-m1/`、关键设计：catalog `scopeKey/fault/freeze` 三字段、`agent/created` sync-veto 保留、A3–A6 propagate、A8 直通 `ctx.agents`）。
- [ ] 7.2 更新 `docs/specs/plugin-api-features/feature-list.md` §2.4：将 A1–A8 状态改为 `delivered`，并在关键约束处注明 `agent/created` 故障语义与 catalog 扩展。
- [ ] 7.3 同步 `docs/specs/plugin-api-events-m1/design.md` Data Models/Error Handling 与 `docs/specs/plugin-api-events-m1/requirements.md` E11/E12 相关 AC：追加修订注记，说明 catalog schema 升级（`scopeKey`/`fault`/`freeze`）与 `agent/*` 事件例外，防止两份 spec 对同一总线契约不一致。
- [ ] 7.4 运行全量 `node --test`：确保新增测试与既有 foundation / facade-integrity / llm-image-admission / events-m1 回归测试全部通过；仅在 spec 范围内修复回归。
- [ ] 7.5 迁移验收注记：确认 A1–A8 无 dsh-read-image / dsh-pro-ex-ability-anchor 既有 hack 可删（迁移对象为 A9/T10、S2、P6、C1 等，不在本 feature）；在最终报告中标明本 feature 验收以全量回归 + 任务 6.2 消费者接入测试为准。
- 引用：requirements §12；design「Documentation synchronization (AGENTS.md anti-staleness)」。

---

## Requirements coverage matrix

| Requirements 章节 | 任务 |
|---|---|
| 1. Agent event catalog extension (A1–A7) | 1, 3 |
| 2. Agent lifecycle events (A1) | 1（目录）、3（fault/emit 行为）、6（消费） |
| 3. Agent inbox events (A2) | 1, 3 |
| 4. `agent/pre-step` waterfall (A3) | 1, 3 |
| 5. `agent/request` waterfall (A4) | 1, 3 |
| 6. `agent/request-error` waterfall (A5) | 1, 3 |
| 7. `agent/turn-stopping` serial (A6) | 1, 3 |
| 8. `agent/error` event (A7) | 1, 3 |
| 9.1 Fault policy | 1（fault 字段）、3（wrapper 分派） |
| 9.2 Scope-filtered subscription | 1（scopeKey）、3（scope gate） |
| 9.3 Read-only payload policy | 1（freeze 字段）、2（freezeByPolicy）、3（wrapper 调用） |
| 10. `pluginApi.agent` registry read passthrough (A8) | 4, 5, 6 |
| 11. Inactive / disabled surface | 4, 6 |
| 12. Testability and regression coverage | 1.2, 2.2, 3.2, 4.2, 5.2, 6.2, 7.4 |
