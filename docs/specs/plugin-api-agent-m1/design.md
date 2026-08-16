# Design: plugin-api-agent-m1

## Overview

`plugin-api-agent-m1` 把 feature-list §2.4 中的 **A1–A8** 落地为两个 host 侧门面能力：

1. **`pluginApi.events` 目录与总线策略扩展**：把 12 个官方 `agent/*` 事件纳入 `pluginApi.events.catalog`，并对 `lib/events-bus.js` 增加 per-event 的 **fault policy** 与 **freeze policy**，使 A 类 agent 事件的官方故障语义与只读边界被精确保留。
2. **`pluginApi.agent` 注册表读面**：新增 `pluginApi.agent.get(id)` / `agent.list()` / `agent.roots()`，直通官方 `ctx.agents` 服务的三个只读方法。

本 feature 只覆盖 **host 侧**，不新增 client bundle、不新增 client remote。A9/A10/A11 不在本 spec 范围。

依赖已交付的 `plugin-api-foundation`（服务/guard/版本协商）、`plugin-api-facade-integrity`（门面完整性；本 feature 不包装官方边界，不新增包装链）与 `plugin-api-events-m1`（事件总线与目录；本 feature 扩展其 catalog schema 并对其 E9/E11 策略声明 `agent/*` 例外）。

---

## 源码调研结论

### 1. 官方 `agent/*` 事件声明与派发点

官方类型声明：`@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts` L134–321（module augmentation `Events` 接口）。官方派发点：

| 事件 | 官方 mode | scope-filtered | 官方 payload（listener 收到） | 派发点 |
|---|---|---|---|---|
| `agent/created` | emit | 是（subject `args[0].agent`） | `{ agent }` | `dsh-agent/lib/index.js` `announce()` L660–682 |
| `agent/disposed` | emit | 是 | `{ agent }` | `dsh-agent/lib/index.js` `emitDisposed()` L638–652 |
| `agent/status` | emit | 是 | `{ agent, status }` | `dsh-agent-loop/lib/index.js` L388 |
| `agent/session-start` | emit | 是 | `{ agent, source }` | `dsh-agent-loop/lib/index.js` L1165（经 `emitAgentEvent`） |
| `agent/inbox/inserted` | emit | 是 | `{ agent, message }` | `dsh-agent-loop/lib/index.js` L359 |
| `agent/inbox/claimed` | emit | 是 | `{ agent, message, turn }` | `dsh-agent-loop/lib/index.js` L365 |
| `agent/inbox/discarded` | emit | 是 | `{ agent, message }` | `dsh-agent-loop/lib/index.js` L362 |
| `agent/pre-step` | waterfall | 是 | `(payload, next)`，payload `{ agent, messages, turn, step, signal }` | `dsh-agent-loop/lib/index.js` L501 |
| `agent/request` | waterfall | 是 | `(payload, next)`，payload `{ agent, turn, step, signal }` | `dsh-agent-loop/lib/index.js` L685 |
| `agent/request-error` | waterfall | 是 | `(payload, next)`，payload `{ agent, turn, step, provider, failure, retryPolicy, signal }` | `dsh-agent-loop/lib/index.js` L630 |
| `agent/turn-stopping` | serial | 是 | `(payload)`，payload `{ agent, turn, signal }` | `dsh-agent-loop/lib/index.js` L565 |
| `agent/error` | emit | 是 | `{ agent, turn, step, error }` | `dsh-agent-loop/lib/index.js` L470 |

`dsh-scope/lib/invariant.js` 权威表确认全部 12 个 `agent/*` 事件均为 scope-filtered，subject resolver 均为 `(args) => args[0]["agent"]`。`dsh-agent/lib/index.js` `agentEvents()` L335–365 负责把 `agent` 注入 payload 并作为 scope carrier 的 key。

### 2. 官方 `agent/*` 故障语义（本设计 fault policy 的唯一依据）

| 事件 | 同步 throw | 异步 rejection | 官方依据 |
|---|---|---|---|
| `agent/created` | **propagate**（veto 发布） | **contain**（只报告） | `runtime-types.d.ts` L138–141；`announce()` L671–681：不 catch 同步 throw，`Promise.resolve(returned).catch(warn)` 只 contain 异步 |
| `agent/disposed` | contain | contain | `emitDisposed()` L644–651：逐个 catch sync 与 async |
| `agent/status`、`agent/session-start`、3 个 inbox、`agent/error` | contain | contain | `agentEvents.emit()` L347–355：逐个 catch sync 与 async |
| `agent/pre-step`、`agent/request`、`agent/request-error` | propagate | propagate | `agentEvents.waterfall()` L361–364 直接委托 `ctx.waterfall`，无 catch；Cordis `waterfall` L317–325 不 catch listener |
| `agent/turn-stopping` | propagate | propagate | `agentEvents.serial()` L357–360 直接委托 `ctx.serial`，无 catch；Cordis `serial` L289–294 不 catch listener |

### 3. 官方 `agents` 注册表读面

`ctx.agents` 服务（`dsh-agent/lib/index.js` L425 `super(ctx, "agents")`）：

| 方法 | 行为 | 源码 |
|---|---|---|
| `get(id)` | 返回 live agent，或 `undefined` | `dsh-agent/lib/index.js` L688–690 |
| `list()` | 返回 fresh array（registration order） | L706–708 |
| `roots()` | 返回 fresh top-level agent array | L715–717 |

门面只做直通，不缓存、不克隆、不排序。

### 4. 已交付 `plugin-api-events-m1` 的当前实现事实

- `lib/events-catalog.js`：19 个事件，字段 `{ name, mode, scopeFiltered, subject, payload, args, source, type }`；`subject` 取值 `'args[0].agent' | null | undefined`；整个 catalog 深冻结。
- `lib/events-bus.js`：
  - `createWrappedListener` 对**所有实参**调用 `deepFreeze`（L113）。
  - scope gate 用 `meta.subject` 解析（L120–124）。
  - 非 waterfall 路径对 sync throw / async rejection 一律 contain（L147–162）；waterfall 路径同样 contain 并 `continueIfNeeded()`（L203–218）；`monitor` priority 先做 observe-only contain（L135–145、L184–201）。
- `lib/plugin-api-service.js`：可挂载 feature 名 `llm/admission`、`events`、`web`。
- `lib/guards.js`：feature guard 只有 `llm/admission`、`events`、`web` 三分支。
- `lib/index.js`：`FEATURE_MOUNTERS` 顺序为 `events` → `web` → `llm/admission`。

---

## 钩子引出机制（本仓库必填）

| 能力 | 类型 | 引出机制 | 失败路径与 guard 策略 |
|---|---|---|---|
| A1–A2, A7 八个 emit 事件（除 `agent/created` 外的 7 个） | A | 官方 `agentEvents.emit` / `emitDisposed` 已 dispatch；门面纳入 catalog 并注册 facade hook，fault=`'contain'` 保持官方逐 listener 包含 | 门面不探测具体事件源；事件未派发时最多收不到调用。listener 错误 contain 后官方 dispatch 继续 |
| A1 `agent/created` | A | 官方 `announce()` 已 dispatch；门面纳入 catalog 并注册 facade hook，fault=`'created'`：同步 throw 直接 propagate（保留 sync-veto），异步 rejection contain | 同上；同步 throw 将按官方语义传播给官方 dispatcher，门面不拦截、不日志包装 |
| A3–A5 三个 waterfall 事件 | A | 官方 `agentEvents.waterfall` → `ctx.waterfall` 已 dispatch；门面纳入 catalog 并注册 facade hook，fault=`'propagate'`，不 catch、不把 throw 转成 `next()` | 门面不探测事件源；listener throw/rejection 按 Cordis 原生语义传播给官方 caller |
| A6 `agent/turn-stopping` serial | A | 官方 `agentEvents.serial` → `ctx.serial` 已 dispatch；门面纳入 catalog 并注册 facade hook，fault=`'propagate'` | 同上；listener throw/rejection 传播给官方 caller |
| A1–A7 全部 12 个事件的只读策略 | A（对已交付 E9 的细化） | facade hook 按 catalog `freeze` policy 冻结：`freeze:'all'` 保持 E9 全量 deepFreeze；`freeze:{deep:[...]}` 对顶层对象浅冻结并对指定字段 deepFreeze；`agent`/`signal` 永不冻结 | `freezeByPolicy` 永不 throw；冻结失败只跳过，不阻断 dispatch |
| A8 `pluginApi.agent.get/list/roots` | A | `ctx.get('agents')` 服务方法直通，返回值原样返回 | `agent` feature guard 失败 → 仅 `agent` 禁用并显式报错；官方 `agents` 服务缺失时 stub 抛 `PluginApiFeatureDisabledError`，不触碰其他服务 |

---

## Architecture

```mermaid
flowchart TD
    APPLY["lib/index.js apply (foundation)"] --> GUARDS["runFeatureGuard per feature"]
    GUARDS -->|events ok| EVM["mountEventsFeature"]
    GUARDS -->|agent ok| AGM["mountAgentFeature"]
    EVM --> CAT["lib/events-catalog.js (frozen, 31 entries)"]
    EVM --> BUS["lib/events-bus.js createEventsBus(ctx, catalog, logger)"]
    BUS --> FREEZE["lib/deep-freeze.js freezeByPolicy"]
    EVM -->|service.mountFeature('events', api)| SVC["pluginApi service"]
    AGM --> AGAPI["agentApi = { get, list, roots }"]
    AGM -->|service.mountFeature('agent', api)| SVC
    AGM --> AGENTSVC["ctx.get('agents').get/list/roots"]
```

```mermaid
flowchart LR
    PLUGIN["third-party plugin"] -->|inject: ['pluginApi']| API["ctx.pluginApi"]
    API --> EVENTS["pluginApi.events"]
    API --> AGENT["pluginApi.agent"]
    EVENTS -->|on/once for agent/*| BUS["facade hook (freeze policy + fault policy + scope gate)"]
    EVENTS -->|catalog| CAT["31 entries, frozen"]
    AGENT -->|get/list/roots| AGENTSVC["official agents service"]
```

---

## Components and Interfaces

### 1. `lib/events-catalog.js` — 目录扩展与 schema 升级（修改）

#### 1.1 Schema 变更

统一字段名 `subject` → `scopeKey`（与 requirements AC 1.2 一致），并新增两个 per-event 策略字段：

```ts
type ScopeKey = 'args[0].agent' | null | undefined
type FaultPolicy = 'contain' | 'created' | 'propagate'
type FreezePolicy = 'all' | { deep: string[] }

type CatalogEntry = {
  name: string
  mode: 'on' | 'emit' | 'serial' | 'parallel' | 'bail' | 'waterfall'
  scopeFiltered: boolean
  scopeKey: ScopeKey
  payload: string
  args: string
  source: string
  type: 'A' | 'B'
  fault: FaultPolicy
  freeze: FreezePolicy
}
```

- `fault`：`'contain'` = facade 对 sync/async 都包含；`'created'` = sync propagate、async contain；`'propagate'` = facade 完全不包含。
- `freeze`：`'all'` = 维持 `plugin-api-events-m1` E9 的“对每个实参 deepFreeze”；`{ deep: string[] }` = 对每个 object 实参**浅冻结**（`Object.freeze(arg)`），并仅对 `deep` 中列出的顶层字段递归 `deepFreeze`。函数实参原样跳过。

#### 1.2 既有 19 个事件回填

全部设为 `fault: 'contain'`、`freeze: 'all'`、`scopeKey` 取值与原 `subject` 相同。该回填保证 `plugin-api-events-m1` 已交付行为 100% 不变。

#### 1.3 新增 12 个 `agent/*` 条目

| name | mode | scopeFiltered | scopeKey | fault | freeze | payload / args（listener 收到） | type | source |
|---|---|---|---|---|---|---|---|---|
| `agent/created` | emit | true | `args[0].agent` | `created` | `{ deep: [] }` | `(payload)`，payload `{ agent }` | A | A1 |
| `agent/disposed` | emit | true | `args[0].agent` | `contain` | `{ deep: [] }` | `(payload)`，payload `{ agent }` | A | A1 |
| `agent/status` | emit | true | `args[0].agent` | `contain` | `{ deep: [] }` | `(payload)`，payload `{ agent, status }` | A | A1 |
| `agent/session-start` | emit | true | `args[0].agent` | `contain` | `{ deep: [] }` | `(payload)`，payload `{ agent, source }` | A | A1 |
| `agent/inbox/inserted` | emit | true | `args[0].agent` | `contain` | `{ deep: [] }` | `(payload)`，payload `{ agent, message }` | A | A2 |
| `agent/inbox/claimed` | emit | true | `args[0].agent` | `contain` | `{ deep: [] }` | `(payload)`，payload `{ agent, message, turn }` | A | A2 |
| `agent/inbox/discarded` | emit | true | `args[0].agent` | `contain` | `{ deep: [] }` | `(payload)`，payload `{ agent, message }` | A | A2 |
| `agent/pre-step` | waterfall | true | `args[0].agent` | `propagate` | `{ deep: ['messages'] }` | `(payload, next)`，payload `{ agent, messages, turn, step, signal }` | A | A3 |
| `agent/request` | waterfall | true | `args[0].agent` | `propagate` | `{ deep: [] }` | `(payload, next)`，payload `{ agent, turn, step, signal }` | A | A4 |
| `agent/request-error` | waterfall | true | `args[0].agent` | `propagate` | `{ deep: ['failure'] }` | `(payload, next)`，payload `{ agent, turn, step, provider, failure, retryPolicy, signal }` | A | A5 |
| `agent/turn-stopping` | serial | true | `args[0].agent` | `propagate` | `{ deep: [] }` | `(payload)`，payload `{ agent, turn, signal }` | A | A6 |
| `agent/error` | emit | true | `args[0].agent` | `contain` | `{ deep: [] }` | `(payload)`，payload `{ agent, turn, step, error }` | A | A7 |

> 目录静态性说明：`eventsCatalog` 是静态冻结数据，始终包含上述 12 个 `agent/*` 条目；`agent` feature guard 失败只禁用 `pluginApi.agent` 服务面，**不**动态裁剪 `eventsCatalog`。requirements AC 1.1 是正向条件（events 与 agent 均 active 时目录包含这些条目），本设计满足该条件；events feature 被禁用时整个 `pluginApi.events`（含 catalog）由 events disabled stub 提供，目录不可达。

冻结边界理由：

- `agent`/`signal` 是官方仍持有的 live object，**永不冻结**（requirements AC 9.3.5）。
- `agent/pre-step` 的 `messages` 是从 inbox claim 出来的本 step 消息数组；默认 `next()` 会把它作为进入 step 的 messages。deepFreeze 可防止 facade listener 改写本 step 输入，且后续 `session.append` 只做 JSON snapshot（`dsh-session/lib/index.js` L1440–1459），不会因对象被冻结而失败。
- `agent/request-error` 的 `failure` 是 adapter 边界归一化的可序列化 facts，dispatch 后官方只读取不修改；deepFreeze 安全。
- 其余字段（`message`、`status`、`source`、`turn`、`step`、`provider`、`retryPolicy`、`error`）要么是官方 live object（`message`）、要么是共享的配置/策略对象（`retryPolicy`）、要么是 Error 对象（`error`）、要么是 primitive（`status`/`source`/`turn`/`step`/`provider`），官方所有权或不可变性不确定，故本设计只浅冻结 payload 外层，**不 deepFreeze** 这些字段；插件对它们的深层次 mutation 由官方所有权约束，门面不承诺阻止。

### 2. `lib/deep-freeze.js` — 新增 `freezeByPolicy`（修改，纯函数）

```js
deepFreeze(value)                    // 现有实现不变
freezeByPolicy(value, policy)        // 新增
```

`freezeByPolicy(value, policy)`：

- `policy === 'all'`：返回 `deepFreeze(value)`。
- `policy` 为对象：若 `value` 是 object（非函数），先 `Object.freeze(value)`，再对 `policy.deep ?? []` 中每个存在于 `value` 的字段调用 `deepFreeze(value[key])`。
- 其他情况原样返回。
- 任何冻结异常都被捕获并返回原值（冻结永远不能成为 dispatch 失败点）。

### 3. `lib/events-bus.js` — per-event fault/freeze policy（修改）

#### 3.1 `createWrappedListener` 变更

1. 把 L113 的 `for (const arg of args) deepFreeze(arg)` 改为：
   ```js
   for (const arg of args) freezeByPolicy(arg, meta.freeze)
   ```
   即冻结策略从 catalog entry 读取。
2. scope gate 把 `meta.subject` 改为 `meta.scopeKey`。
3. 非 waterfall 路径按 `meta.fault` 分派：
   - `entry.priority === 'monitor'`：维持现有 observe-only contain，**不随 fault 变化**（monitor 永不 veto）。
   - `meta.fault === 'propagate'`：直接 `return entry.listener.apply(this, args)`，不 try/catch、不处理 thenable（保留原始 return/rejection）。
   - `meta.fault === 'created'`：
     ```js
     const returned = entry.listener.apply(this, args)  // 不 catch 同步 throw
     if (returned != null && typeof returned.then === 'function') {
       return Promise.resolve(returned).then(
         (value) => value,
         (error) => { contain(error); return undefined },
       )
     }
     return returned
     ```
     即同步 throw 传播（官方 sync-veto），异步 rejection 被 contain（官方只报告）。
   - 其他（`'contain'`）：维持现有行为。
4. `runWaterfallListener` 按 `meta.fault` 分派：
   - `entry.priority === 'monitor'`：维持现有 observe-only contain。
   - `meta.fault === 'propagate'`：使用相同的 `guardedNext` 包装 `next`，但**不 try/catch**：
     ```js
     const returned = entry.listener.apply(this, callArgs)
     return returned
     ```
     同步 throw 与 thenable rejection 都按 Cordis 原生语义传播。
   - 其他（`'contain'`）：维持现有行为。
   - `agent/*` 没有 waterfall `'created'`，但实现上 `'created'` 在 waterfall 路径回退为 `'contain'`，防御式处理。

#### 3.2 不变式

- 非 cataloged 事件名仍直接透传 `ctx.on/once`，不冻结、不排序、不包含。
- priority 排序、disposer 幂等、once 先移除后调用、scope gate 对不匹配 waterfall 调 `next()` 等行为全部不变。
- `disposeAll`、`reconcile` 回滚逻辑不变。

### 4. `lib/plugin-api-service.js` — 新增 `agent` disabled stub 与挂载点（修改）

新增：

```js
function createDisabledAgentApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('agent')
  }
  return {
    isActive: false,
    get: fail,
    list: fail,
    roots: fail,
  }
}
```

- 构造函数增加 `this.agent = createDisabledAgentApi(active)`。
- `mountFeature(name, api)` 增加分支 `if (name === 'agent') { this.agent = api; return }`。
- 可挂载名变为：`llm/admission`、`events`、`web`、`agent`。

### 5. `lib/guards.js` — 新增 `agent` feature guard（修改）

在 `runFeatureGuard` 增加分支：

```js
else if (featureName === 'agent') {
  probe('agents.get', 'agent registry read API is unavailable', () => {
    return typeof ctx?.get === 'function' && typeof ctx.get('agents')?.get === 'function'
  })
  probe('agents.list', 'agent registry list API is unavailable', () => {
    return typeof ctx?.get === 'function' && typeof ctx.get('agents')?.list === 'function'
  })
  probe('agents.roots', 'agent registry roots API is unavailable', () => {
    return typeof ctx?.get === 'function' && typeof ctx.get('agents')?.roots === 'function'
  })
}
```

guard 不探测任何 `agent/*` 事件源：事件订阅方不因事件缺失而禁用门面（与 events feature 相同原则）。

### 6. `lib/index.js` — 挂载 `agent` feature（修改）

新增：

```js
function mountAgentFeature({ ctx, service }) {
  // Idempotent re-apply: a reused service already carries the mounted API.
  if (service?.agent?.isActive === true) {
    return () => {}
  }

  const agents = safeGet(ctx, 'agents')
  const agentApi = {
    isActive: true,
    get(id) {
      return agents.get(id)
    },
    list() {
      return agents.list()
    },
    roots() {
      return agents.roots()
    },
  }
  service.mountFeature('agent', agentApi)
  return () => {}
}
```

`FEATURE_MOUNTERS` 顺序调整为：`events` → `agent` → `web` → `llm/admission`（agent 服务直通不依赖 events，但放在 events 后便于阅读；两者独立，若 events 被禁用 agent 仍可挂载）。

`mountAgentFeature` 不产生任何资源，disposer 为 no-op。所有异常由 `apply` 既有 try/catch 兜底，绝不抛穿 `apply`。

---

## Data Models

```ts
type EventMode = 'on' | 'emit' | 'serial' | 'parallel' | 'bail' | 'waterfall'

type ScopeKey = 'args[0].agent' | null | undefined
// null = presence-only（carrierKeyOf(this)）；undefined = 非 scope-filtered

type FaultPolicy = 'contain' | 'created' | 'propagate'
// contain  = facade contains sync throw and async rejection
// created  = sync throw propagates, async rejection contained (official agent/created)
// propagate= facade does not contain; official Cordis caller handles it

type FreezePolicy = 'all' | { deep: string[] }
// 'all'             = deepFreeze the whole argument (E9 original behavior)
// { deep: ['messages'] } = shallow-freeze the top-level argument, deepFreeze only the listed fields

type CatalogEntry = {
  name: string
  mode: EventMode
  scopeFiltered: boolean
  scopeKey: ScopeKey
  payload: string
  args: string
  source: string
  type: 'A' | 'B'
  fault: FaultPolicy
  freeze: FreezePolicy
}

type AgentApi = {
  isActive: boolean
  get(id: string): Agent | undefined
  list(): Agent[]
  roots(): Agent[]
}
```

---

## Error Handling

1. **boot fail-safe 不变**：`mountAgentFeature` 任何异常由 foundation 的 mount try/catch 与 feature-registry 捕获，绝不抛穿 `apply`；agent feature 失败只禁用 `agent`，门面其他 feature 保持 active。
2. **feature 禁用/inert**：`pluginApi.agent` 的 disabled stub 方法先抛 `PluginApiInactiveError` 或 `PluginApiFeatureDisabledError('agent')`，抛错前不触碰任何官方服务。
3. **fault=`'contain'`**：facade listener 的 sync throw / async rejection 一律 contain，dispatch 继续、不 reject；官方 listeners 不感知。
4. **fault=`'created'`**：`agent/created` 的 sync throw 不 catch、按官方语义传播给 `announce()`；async rejection 被 contain（读得 diagnostic log，不 reject aggregate）。
5. **fault=`'propagate'`**：A3–A6 语义 waterfall/serial 的 sync throw / async rejection 不 catch，按 Cordis 原生语义传播给官方 caller；门面不日志包装、不转成成功继续。
6. **monitor priority 例外**：`priority === 'monitor'` 的 facade listener 无论 fault policy 如何，都按 observe-only contain 处理；它永不 veto、永不改写链结果。
7. **freeze 永不 throw**：`freezeByPolicy` 对所有异常吞掉并返回原值；`Object.freeze` 对 exotic/live object 的失败不会阻断 dispatch。
8. **scope 过滤**：不匹配的 waterfall facade listener 调 `next()` 继续；不匹配的 serial listener 返回 `undefined`；不匹配的 emit listener 不调用。
9. **官方服务缺失**：guard 探测 `ctx.get('agents')` 缺失时禁用 `agent` feature；运行时再缺服务由 disabled stub 的 typed error 路径处理（实际 guard 先行，不会发生）。
10. **`agent.get(id)` 返回 `undefined`**：官方语义为“不存在该 live agent”，门面原样返回，不抛错。

---

## Testing Strategy

运行器 `node --test`；纯模块零 harness 依赖；集成测试用 mock Cordis context（复用 `plugin-api-events-m1` 测试中 `createMockCordisCtx` 的语义：shift `thisArg`/name、绑定 `this`、按 emit/serial/parallel/bail/waterfall 调用回调；需扩展为支持 scope carrier）。

- `test/events-catalog.test.mjs`（更新）：
  - catalog 恰好 31 个事件名（原 19 + 新 12），且无其他 `agent/*`。
  - 每个 entry 含 `mode/scopeFiltered/scopeKey/payload/args/source/type/fault/freeze`，schema 合法。
  - 12 个 agent 事件的 mode/scopeKey/fault/freeze 与本文 §1.3 表一致；19 个旧事件 fault=`'contain'`、freeze=`'all'`、scopeKey 与原 subject 一致。
  - catalog 与每个 entry 深冻结。
- `test/deep-freeze.test.mjs`（更新）：
  - `freezeByPolicy(value, 'all')` 等于 `deepFreeze`。
  - `freezeByPolicy(value, { deep: ['messages'] })`：顶层浅冻结（`Object.isFrozen(value)` true）、`messages` 深冻结、未列出的嵌套对象不被深冻结。
  - 函数/primitive/exotic/循环对象不抛。
- `test/events-bus.test.mjs`（更新 + 新增）：
  - 用 `createMockCordisCtx` 扩展 `scopedEmit/scopedSerial/scopedWaterfall`，验证 12 个 agent 事件。
  - **contain emit（7 个）**：sync throw / async rejection 被 contain，其余 listeners 继续。
  - **`agent/created`**：sync throw 传播出 `ctx.emit`/mock `announce` 调用；async rejection 被 contain，后续 listeners 继续。
  - **waterfall propagate**：`agent/pre-step`/`agent/request`/`agent/request-error` 的 listener 不调用 `next()` 返回替换值成为结果；调用 `next()` 可组合；sync throw 与 rejected promise 传播到 mock official dispatch；不匹配 scope 调 `next()` 继续。
  - **serial propagate**：`agent/turn-stopping` 顺序、bail 短路、不匹配 scope 返回 `undefined`、sync throw / rejection 传播。
  - **scope filtering**：对全部 12 个 agent 事件，`opts.scope` 匹配时只投递给该 scope，不匹配时 emit 不调用 / serial 返回 `undefined` / waterfall 调 `next()`；`opts.scope` 省略时全部 12 个事件全局可见。
  - **freeze policy**：`agent/pre-step` listener 内 `payload` 顶层 frozen、`payload.messages` 与每个 message frozen、`payload.agent`/`payload.signal` 未被 facade 冻结（`Object.isFrozen` false，且引用恒等）；`agent/request` 的 payload 顶层 frozen、`agent`/`signal` 未冻结。
  - **priority/monitor**：agent 事件上 `monitor` listener 永不改变 waterfall/serial/emit 结果，即使 fault=`'propagate'` 也 contain。
  - **非 cataloged 名透传**不变。
- `test/events-guard.test.mjs`（更新）：`runFeatureGuard('agent')` 的 probe 矩阵；缺 `agents` 服务时仅 `agent` 禁用。
- `test/plugin-api-service-agent.test.mjs`（新增）：disabled stub 抛 typed error；`mountFeature('agent', api)` 后 `get/list/roots` 可调；`mountFeature` 未知名仍拒绝。
- `test/index-agent.test.mjs`（新增）：apply 挂载 `agent` 的 mock 集成——agent guard 失败时门面仍 active 且只禁用 `agent`；apply 永不 throw；`events` 失败不影响 `agent` 直通，反之亦然。
- `test/agent-api.test.mjs`（新增）：mock `agents` 服务验证 `get/list/roots` 直通（返回值恒等、fresh array、不缓存不排序）。
- 回归：更新后全部既有测试（foundation、facade-integrity、llm-image-admission、events-m1）保持通过。

---

## Requirements coverage matrix

| Requirements 章节 | 设计落点 |
|---|---|
| 1. Agent event catalog extension (A1–A7) | Components 1；Data Models；Testing `events-catalog` |
| 2. Agent lifecycle events (A1) | Components 1.3、3（fault=`created`/`contain`）；Testing `events-bus` |
| 3. Agent inbox events (A2) | Components 1.3、3 |
| 4. `agent/pre-step` waterfall (A3) | Components 1.3（freeze `messages`）、3.1/3.2 |
| 5. `agent/request` waterfall (A4) | Components 1.3、3 |
| 6. `agent/request-error` waterfall (A5) | Components 1.3（freeze `failure`）、3 |
| 7. `agent/turn-stopping` serial (A6) | Components 1.3、3 |
| 8. `agent/error` event (A7) | Components 1.3、3 |
| 9.1 Fault policy | Components 1.1/1.3、3；源码调研 §2 |
| 9.2 Scope-filtered subscription | Components 3.1（`scopeKey` gate）；源码调研 §1 |
| 9.3 Read-only payload policy | Components 2、3.1；Data Models `FreezePolicy` |
| 10. `pluginApi.agent` registry read passthrough (A8) | Components 4/5/6；Data Models `AgentApi` |
| 11. Inactive / disabled surface | Components 4；Error Handling 2 |
| 12. Testability and regression coverage | Testing Strategy |

---

## Documentation synchronization (AGENTS.md anti-staleness)

1. WHEN `plugin-api-agent-m1` 的 Stage 4 全部任务完成并验收，THEN 必须同步更新仓库根 `AGENTS.md` 第 8 节：追加 `plugin-api-agent-m1`（范围 A1–A8、状态 delivered、spec 目录 `docs/specs/plugin-api-agent-m1/`、关键设计：catalog `scopeKey/fault/freeze` 三字段、`agent/created` sync-veto 保留、A3–A6 propagate、A8 直通 `ctx.agents`）。
2. WHEN 本 feature 修改了 `plugin-api-events-m1` 的 catalog schema（`subject`→`scopeKey`、新增 `fault`/`freeze`）与 E11 故障语义，THEN Stage 3 tasks 必须包含一个文档同步任务：在 `docs/specs/plugin-api-events-m1/design.md` 的 Data Models 与 Error Handling 节追加修订注记，并更新 `docs/specs/plugin-api-events-m1/requirements.md` 中 E11/E12 相关 AC 的“后续修订”注记，防止两份 spec 对同一目录字段与故障语义长期不一致。
3. WHEN 本 feature Stage 4 交付，THEN 必须同步 `docs/specs/plugin-api-features/feature-list.md` §2.4 的 A1–A8 状态为 `delivered`，并同步根 `AGENTS.md` 第 8 节；公开 API 形状或里程碑变化时同步更新。
