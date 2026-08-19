# Stage 2 Design: plugin-api-host-remote-m4

> feature_name: `plugin-api-host-remote-m4`
> 状态：Stage 2 草案（待对抗性审查与用户批准）
> 上游：Stage 0 Goal（已批准）、Stage 1 Requirements（已批准，`requirements.md`）、`AGENTS.md` §2/§4/§6、`docs/specs/plugin-api-settings-remote-m3/`（ST4 既有绑定/回滚实现）、`docs/specs/plugin-api-m1-integration/parallel-workflow.md`（共享文件编辑边界）、`dsh-pro-ex-ability-anchor/lib/config-remote.js`
> 类型：B 类（门面转译；官方 `bindTypertRemote` / `ctx.reflect.provide` 为公开原语，门面负责稳定封装）

---

## 1. Overview

在 host 侧提供**通用 Typert Remote 服务发布入口** `pluginApi.remote.publish(serviceKey, service)`：任何社区插件用它把自己的 JSON-safe 配置/状态服务一次性发布为官方认可的 remote（经官方 gateway source-mode 自动发现），返回 owner 作用域、幂等、stale-safe 的 disposer。它是 ST4 `pluginApi.settings.remote`（settings 专用桥）的**泛化兄弟**：ST4 只覆盖官方 settings 命名空间，本 feature 覆盖**任意自定义持久化/状态服务**（磁盘配置店、运行时状态、健康端点），从而让 pro-ex 这类插件删除其手搓的 `lib/config-remote.js`（95 行）桥接。

门面只消费官方公开协议原语（`isTypertRemoteSegment`/`bindTypertRemote`/`Remote`/`remoteMethods` from `@deepseek-ai/dsh-typert-protocol`）与公开装配点 `ctx.reflect.provide`，把 ST4 已验证的绑定 + 回滚 + 稳定 disposer 语义**抽取为共享核心并泛化复用**；同时保持 `settings.remote`（ST4）与 `remote.publish` 各自 owner 语义完全独立。client 侧**零改动**，继续复用 M3 已交付的 ST5/C2 `mountRemote` 消费面。

**形状定稿**（Stage 1 §1）：`pluginApi.remote.publish(serviceKey: string, service: object): () => boolean` —— `serviceKey` 兼任 Cordis service key + wire namespace；`service` 为普通对象、其**自有可调用属性**即 remote endpoint（AC 3.1 收窄为自有成员，见 §3.3 决策 D1）；返回 disposer。

---

## 2. Architecture

### 2.1 模块布局

```text
lib/
├── remote-publication.js   # (new) 共享核心：owner 参数化的绑定/标记/注册/回滚/disposer 机制 + 通用 JSON-safe/segment/marker helper
├── host-remote.js          # (new) 本 feature leaf：createHostRemoteApi() → pluginApi.remote 对象（isActive + publish + dispose）
├── settings-remote.js      # (refactor) ST4 leaf：settings 专用 get/set 服务构造保留，泛型绑定/回滚委托共享核心
├── guards.js               # (append) 新增 'remote' guard 分支
├── index.js                # (append) FEATURE_MOUNTERS 增加 ['remote', mountHostRemoteFeature]
├── plugin-api-service.js   # (append) _remoteSurface + Object.defineProperties + _assignFeature + _readSlot + _disabledSurfaceFor
└── errors.js               # (append) PluginApiRemoteError（validation/conflict 用），沿用 PluginApiError 家族
```

### 2.2 host/client 分工

- **host**：`pluginApi.remote.publish` 发布入口 + 共享核心 + ST4 复用。这是本 feature 的全部实现面。
- **client**：**零改动**。web client 继续用 M3 已交付的 C2 `client.mountRemote(contribution)` / ST5 消费已发布服务；pro-ex panel 的 `{ name: "settings", wire: "settings" }` contribution 原样可用（AC 7.1）。本 feature 不新增任何 client 面（AC 5.1）。

### 2.3 数据流（发布时序）

```mermaid
sequenceDiagram
  participant P as 社区插件
  participant F as pluginApi.remote.publish
  participant C as 共享核心 remote-publication
  participant O as ctx.reflect / ctx.get
  participant G as 官方 gateway

  P->>F: publish(serviceKey, service)
  F->>F: active? 形状/key校验(§3); 提取自有方法; 校验签名(§3.3/3.5); re-home 专用原型(AC 3.7)
  F->>C: publishRemotePublication({owner:'remote', serviceKey, service, methods, rehome:true})
  C->>O: 只读探测 ctx.get(serviceKey) (AC 4.1b)
  O-->>C: 已存在不同 service → 抛 conflict (AC 1.6/4.1)
  C->>C: bindTypertRemote + 挂 typertRemote (AC 2.1)
  C->>C: markRemote 各方法 → remoteMethods 校验 (AC 2.2/2.4)
  C->>O: ctx.reflect.provide(serviceKey, service) (AC 2.3)
  O-->>C: 返回官方 disposer(或抛出 → 回滚 own 已完成步骤 AC 4.4)
  C-->>F: owner record 提交 → 返回 owner disposer(幂等/stale-safe AC 4.2/4.3)
  F-->>P: () => boolean
  Note over G: 后续 gateway source-mode 遍历 ctx.reflect.props
  G->>O: ctx.get(serviceKey).typertRemote + remoteMethods → endpoint claim (AC 2.5)
```

---

## 3. Components and Interfaces

### 3.1 `lib/remote-publication.js`（共享核心，新）

**设计目标**：把 ST4 `settings-remote.js` 里已被 M3 验证过的**通用绑定/回滚/disposer 机制**沉淀为 owner 参数化共享模块，供 `host-remote`（generic）与 `settings-remote`（ST4）共同使用；要求遵守 AC 5.6（两 API 各自 owner 语义完全独立）与 AC 4.1b（跨 feature 冲突经官方注册表只读探测，不耦合 owner 地图）。

```js
// owner 参数化：同一 ctx 上每个 feature 名独占一个 record 地图
export function createRemoteOwner({ ctx, ownerName })          // WeakMap<ctx, Map<ownerName, Map<serviceKey, record>>>
export function publishRemotePublication({
  ctx, protocol, logger,
  owner,                       // createRemoteOwner 返回的 owner
  ownerName,                   // 'remote' | 'settingsRemote'（AC 5.6 参数化）
  serviceKey, service, methods // 方法列表（自有可调用属性名，稳定顺序）
  rehome,                      // true=需要专用原型 re-home（generic 用；ST4 自有类原型传 false）
})                             // → disposer
```

`publishRemotePublication` 内部按序执行（任意步骤失败 → 只回滚 own 已完成的注册，AC 4.4）：

1. **owner 幂等短路**（AC 1.5/4.1，与 host-remote 幂等优先配合）：若 `owner` 地图已存在同 `serviceKey` 且 `service` 引用相等 → 直接返回现有 record 的 disposer（不再探测/绑定/标记）；若同 `serviceKey` 但引用不同 → 进入冲突探测。
2. **只读冲突探测**（AC 4.1b）：`probePublishedService(ctx, serviceKey)` —— guarded `ctx.get(serviceKey)`（Cordis 对未注册 key 返回 `undefined`，不抛错）。若存在且引用不等于待发布 service：
   - 与 `owner` 地图中当前同名 record 的 `service` 引用相等 → 归并到幂等分支；
   - 否则 → **同行冲突**，抛 typed conflict（AC 1.6/4.1；覆盖 ST4 `settings.remote` 发布过的同键，因为两者写入同一官方注册表），且在**任何对象变更（re-home）已发生的情况下也不回滚**——见 §4.2 注：re-home 发生的对象变更虽不可逆，但不会写入注册表、不污染 `Object.prototype`（专用 proto 孤立，无害失败）。
   探测异常 → 视同"无现存 owner"（fail-open for absence）。
   > 注：该探测在核心内是**第二道**安全层——host-remote 已在 re-home 之前做过一次冲突前检（§3.2「冲突探测前置」），核心此步主要兜底 settingsRemote 路径与其他调用方，两者收敛于同一 typed conflict 结果。
3. **绑定**（AC 2.1）：`protocol.bindTypertRemote(service, serviceKey)`；校验返回 `{ service, serviceKey, namespace }` 与传入一致；`Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: true })`。
4. **标记**（AC 2.2/2.4）：对 `methods` 逐一 `markRemoteMethod(protocol, service, method)`（decorator-initializer 机制，Node 无 decorator 语法亦可用，同 ST4）；随后 `protocol.remoteMethods(service)` 校验恰好返回 `methods` 集合且顺序确定（按传入顺序的 Map 插入序）。标记只落在**本 publication 专用的 prototype** 上（见 §3.3 决策 D2）。
5. **注册**（AC 2.3）：`ctx.reflect.provide(serviceKey, service)`；若返回非函数 disposer → 视为注册失败。
6. **owner record 提交**：`{ serviceKey, service, methods, binding, disposer, disposed:false }` 写入 `owner` 地图。

**返回 disposer**（owner 作用域、幂等、stale-safe，AC 4.2/4.3）：与 ST4 相同的 epoch/identity guard —— 仅当 `owner.get(serviceKey) === record` 时才 unregister；unregister 前先 `probePublishedService` 确认线上仍是 `record.service`（防止延迟清理误撤后来者）；已 disposed → `false`。

**通用 helper 导出**（从 ST4 现有私有函数下沉，属性名与错误语义保持 ST4 等价）：
- `validateRemoteSegment(protocol, value, subject)`（AC 1.2/3.2）
- `markRemoteMethod(protocol, service, method)`（AC 2.2）
- `isJsonValue / assertJsonValue / cloneJsonValue / isPlainObject`（AC 3.4 契约 + clone 语义）
- `report(logger, message, error)`（fail-safe 日志，AC 4.4/4.6）
- `readPublishedService(ctx, serviceKey)`（guarded `ctx.get`，AC 4.1b/4.3 探测）

### 3.2 `lib/host-remote.js`（本 feature leaf，新）

```js
export function createHostRemoteApi({ ctx, protocol, active, logger })     // → { isActive, publish, dispose }
export function createDisabledHostRemoteApi(active)                        // → { isActive:false, publish:fail, dispose(){} }
```

- `publish(serviceKey, service)`：
  - inactive → `PluginApiInactiveError`（P1 既有语义）；协议/原语缺失 → P2 disabled 面（AC 4.5）。
  - **key 校验**：`validateRemoteSegment(protocol, serviceKey, 'Typert service key')`（AC 1.2）。
  - **owner 幂等优先**（AC 1.5/4.1，堵住 B1 漏洞）：先查本 feature `owner` 地图 —— 同 `serviceKey` 且 `service` 引用相等 → **直接返回现有 disposer**（在形状校验/re-home 之前短路，不做任何对象变更）；同 `serviceKey` 但引用不同 → 交共享核心冲突探测（step 1 判定后再抛 conflict，见 §3.1）。幂等短路保证：已 re-home 过的同一对象再次发布仍返回既有 disposer，绝不因 `isPlainObject` 误拒绝。
  - **形状判定**（AC 3.1 × AC 3.7 联合契约，堵住 B2 漏洞）：接受**普通对象字面量**（proto === `Object.prototype`）与**原型为外来/共享原型的对象**（含 `null`-proto 或用 `Object.create(sharedProto)` 构造的对象），**只要其自有（`Object.keys`）可调用成员非空且宿主能把同函数引用搬上专用原型**（见下 re-home）；拒绝 `null`/数组/无可调用自有成员的对象，以及无法安全 re-home 的对象（`Object.preventExtensions` 冻结对象、`Object.setPrototypeOf` 会抛错的对象）→ typed validation error。判定发生在**变更对象之前**。
  > 形状收窄说明：class 实例若方法**只在 class 原型上**（`Object.keys` 为空）→ 拒绝。这是对 AC 3.7「任何共享/外来原型对象都 re-home」字面的**有意收窄**：把共享 `Foo.prototype` 的方法搬走会破坏所有实例或需新建包装函数（违背 AC 2.4 不污染外来原型 / D3 保留方法身份），而本 feature 的验收形状（pro-ex `{ get() {}, set(settings) {} }` 字面量）不需要该类实例支持；若自有可调用成员非空则仍按外来原型处理。此收窄在 Stage 4 报告显式记录。
  - **提取自有方法**：对**可接受形状**的对象，取 `Object.keys(service)` 中 `typeof === 'function'` 的成员为 `methods`（命名空间/继承成员不发布，决策 D1）。方法名逐一 `validateRemoteSegment`（AC 3.2）。
  - **签名校验**（AC 3.3/3.5）：对每个方法做 `methodParameterNames` 同款静态检查（`Function.prototype.toString` + 标识符正则，唯一、非 destructuring/defaults/rest；`signal` 仅允许出现在最末位），不满足 → 注册前 typed error。此校验把官方 gateway 的调用期 `signature-invalid` 提前到发布期（稳定化价值，AC 3.3 注释）。
  - **冲突探测前置**（堵住 M3 泄漏：任何对象变更都不该发生在注定失败的发布上）：调用共享核心的 `publishRemotePublication` 前，host-remote 先做一次**只读冲突前检**（同 `probePublishedService` 语义，对 owner 地图 + 官方注册表判定同键冲突）；若冲突 → 立即抛 typed conflict（AC 1.6/4.1），**在 re-home 之前**，调用方传入对象保持原样（未变更）。
  - **re-home**（AC 3.7，决策 D2）：只对**通过冲突前检**的服务执行 → 创建本 publication 专用 prototype（`Object.create(Object.prototype)`），把 `methods` 的**同一函数引用**搬到其上，`Object.setPrototypeOf(service, 专用proto)`；并把 `service` 加入本 feature 的 **`dedicatedProtos` WeakSet**（D2b，供幂等/形状再判定识别自身产物）。同函数引用 → 保留 `Function.prototype.toString`（wire 参数名不变，AC 2.1/3.3）；marker 只落到专用 proto（AC 2.4）。re-home 失败（对象不可变更）→ 注册前 typed error。
  - 调用 `publishRemotePublication({ ownerName:'remote', service, methods, rehome:false (已在 host-remote 完成 re-home 与冲突前检) } )`，返回 disposer（AC 1.1）。
- `dispose()`：遍历 own `owner` 地图全部 record，逐一触发其 disposer。（与 ST4 api.dispose 同语义。）
- 只读、不包装业务方法（AC 3.6）：不替换/不拦截调用方方法体。

### 3.3 关键设计决策（含全仓库并行契约合规）

| 决策 | 内容 | 依据 |
|---|---|---|
| **D1 方法集 = 自有可调用成员** | `Object.keys(service)` 中函数成员作为发布集，排除原型链继承成员与命名空间成员 | AC 3.1「plain object 至少一个可调用方法」；避免误暴露共享原型方法（ST4 marker 泄漏教训）；pro-ex 迁移对象为 plain object 字面量，天然满足 |
| **D2 re-home 专用原型** | service 原型为 `Object.prototype` **或外来/共享原型时**，把同函数引用搬到本 publication 专用 prototype 再打标 | AC 2.4（marker 按 `Object.getPrototypeOf` key，绝不污染 `Object.prototype`）/ AC 3.7；与 ST4 `createRemoteService` 自建类原型等价，只是泛化到外部对象 |
| **D2b 专用原型识别 = 模块级 `dedicatedProtos` WeakSet** | 每成功 re-home 一个 service，就把其专用 proto 记入本 feature 的模块级 WeakSet；形状/幂等再判定时，`dedicatedProtos.has(Object.getPrototypeOf(service))` 视为本 feature 自身产物（通过形状判定、短路幂等）。**re-home 恢复须知**：若一次发布在中途失败（无 owner record），再次发布同一已 re-home 对象时 `Object.keys` 已不再含方法（方法在专用 proto 上）——本 feature 应在此场景下复用 `dedicatedProtos` 所指专用 proto 上的方法集（或取未提交 candidate 的 methods），而非当作空方法集拒绝，从而与 AC 1.5「同一对象再发布」意图一致 | 堵住 B1/B2：解决「已 re-home 对象再次发布被 `isPlainObject` 误拒绝」与「形状判定误杀外来原型对象」两个洞；WeakSet 不参与 owner 地图（不耦合 ST4，AC 5.6） |
| **D3 不包装业务方法** | 注册的就是调用方方法体原引用；门面不做参数/返回值包装 | AC 3.6（不干涉业务语义）+ AC 3.3（包装会改变 `Function.prototype.toString` → 破坏 wire 参数名派生）；JSON-safety 由官方 JSON 传输 + src-json descriptor 保证（§4.3） |
| **D4 共享核心 owner 参数化** | `publishRemotePublication` 收 `ownerName`，每个 feature 独占 record 地图；ST4 传 `'settingsRemote'`、本 feature 传 `'remote'` | AC 5.6（各自 owner map/disposer/duplicate/guard/P2 互相独立）+ 并行契约 §1.2（共享文件 append-only） |
| **D5 ST4 委托共享核心（recorded deviation）** | `settings-remote.js` 的泛型绑定/回滚/disposer 抽取到 remote-publication.js，ST4 委托之；settings 专用构造（describe 快照 / set ops 校验）留 ST4 本地 | Goal「与 ST4 共享既有绑定/回滚实现」+ AC 5.6；属已交付 feature 维护，Stage 4 需获批 Tasks 且 ST4 全部既有测试保持绿色（并行契约 §2.3 显式上报） |
| **D6 顶层命名空间 `pluginApi.remote`** | 新顶层 host 命名空间，`isActive` + `publish` + `dispose` | AC 1.4 + feature-list 命名空间安置规则（带门面附加语义 → 自建顶层；非纯直通故不进 `services.*`） |

### 3.4 guard 与挂载

**`lib/guards.js`**（append-only，`'remote'` 分支，必需 B 类 → fail-closed P2）：
```
} else if (featureName === 'remote') { // mandatory B-class generic host publication
  probe('ctx.get', ...)  probe('ctx.reflect.provide', ...)
  probe('typert.isTypertRemoteSegment', ...)  probe('typert.bindTypertRemote', ...)
  probe('typert.remoteMethods', ...)  probe('typert.Remote', ...)
}
```
（无 settings 依赖；**不含 `TypertRemoteService` 探测**——generic publish 走 `bindTypertRemote` + 专用原型 + `ctx.reflect.provide`，与 ST4 一样不消费该 class，见 `settings-remote.js:110-155`；形状与 `settingsRemote` guard 对齐但只探测 generic 实际消费的原语。）

**`lib/index.js`**（append-only）：
```js
function mountHostRemoteFeature({ ctx, service, logger, featureRegistry }) {
  if (featureRegistry?.isActive?.('remote')) return () => {}
  if (!featureRegistry?.isActive?.('typert')) return null
  const api = createHostRemoteApi({ ctx, protocol: typertProtocol, active: () => service.isActive, logger })
  if (!api.isActive) return null
  const prepared = service.prepareFeature('remote', api)
  return { disposer() { try { api.dispose?.() } catch {} }, prepared }
}
FEATURE_MOUNTERS.set('remote', mountHostRemoteFeature)   // 插在 settingsRemote 之后
```
（依赖 `typert` feature 已激活，与 `mountSettingsRemoteFeature` 同构；`prepareFeature` → prepared commit 走 M2 A1 既有事务边界。）

**`lib/plugin-api-service.js`**（append-only）：
- constructor：`this._remoteSurface = createDisabledHostRemoteApi(active)`；`Object.defineProperties` 增加 `remote: { enumerable, configurable:false, get: () => this._remoteSurface }`。
- `KNOWN_FEATURES` 增加 `'remote'`（**必须**，否则 `prepareFeature('remote', …)` 抛 `cannot prepare unknown feature` 导致 feature 每 boot 静默禁用；`settingsRemote` 已在其中，见 `plugin-api-service.js:927`）。
- `_assignFeature('remote', api)`：校验 `typeof api.publish === 'function'`，赋值 `this._remoteSurface = api`（形同 `settingsRemote` 分支）。
- `_readSlot('remote')` → `this._remoteSurface`；`_disabledSurfaceFor('remote')` → `createDisabledHostRemoteApi(this._active)`。

**`lib/errors.js`**（append-only）：新增 `PluginApiRemoteError extends PluginApiError`（`code: 'PLUGIN_API_REMOTE_INVALID'`），用于 key/形状/签名/冲突四类 validation & conflict。沿用 `PluginApiSettingsNamespaceError` 先例；不新增 guard schema 词汇（AC 5.7）。

---

## 4. Data Models

### 4.1 owner record

```ts
type RemoteRecord = {
  serviceKey: string            // Cordis key + wire namespace
  service: object               // 注册的 service 实例（re-home 后原型为专用 proto）
  methods: readonly string[]    // 发布的自有可调用成员（稳定顺序）
  binding: { service, serviceKey, namespace }  // 官方 bindTypertRemote 返回值
  disposer: () => boolean       // 官方 provider disposer（包装为 owner disposer）
  disposed: boolean
}
// 存储：WeakMap<ctx, Map<ownerName, Map<serviceKey, RemoteRecord>>>
```

### 4.2 dedicated prototype（re-home）

- 每次 `publish`（通过冲突前检后）创建**独立** prototype 对象（`Object.create(Object.prototype)`），只承载本次发布的 `methods` 函数引用。
- `Object.setPrototypeOf(service, dedicatedProto)`，保持 `service` 身份不变（后续 dispose 后原型不回退——专用 proto 泄漏无害，marker 只 key 该 proto）。
- marker 表（官方 WeakMap）只命中 `dedicatedProto`，永不命中 `Object.prototype`（测试锁定：`protocol.remoteMethods({}) === []`）。
- **D2b**：成功 re-home 后把 `service` 记入本 feature 模块级 `dedicatedProtos` WeakSet；形状判定 / owner 幂等短路用 `dedicatedProtos.has(Object.getPrototypeOf(service))` 识别本 feature 自身产物（已 re-home 对象再次发布不被 `isPlainObject` 误拒绝、也不重复 re-home；中途失败后同一对象再次发布时，从其专用 proto 上的方法集/未提交 candidate 恢复发布方法，而非当空方法集拒绝）。该 WeakSet 是非 owner 状态的隔离标识，不参与 owner 地图（不耦合 ST4，AC 5.6）。

### 4.3 JSON-safe 边界

- **generic publish 不主动校验/包装**（D3）：client 侧 RPC 请求体经 JSON 传输反序列化，方法收到的参数天然是 JSON-safe；方法返回结果经官方 transport JSON 序列化，非 JSON-safe 结果在传输边界失败（`rpcFailure`）。门面不复制 ST4 的 assertJsonValue 到运行时方法调用路径。
- 门面在**发布期**锁定契约：签名校验（§3.2）保证 wire 参数名可派生；service 形状校验保证方法集确定。ST4 保留其 settings 特有快照/操作的 assertJsonValue（因为它自建 get/set、需防 secrets 泄漏临时值），与 generic publish 的"信任官方传输 + 发布期契约"是两条一致但不相同的 JSON-safety 策略（AC 3.4/3.4b 已按 argument/result 分拆并注明机制属 design 决策）。

---

## 5. Error Handling

| 失败路径 | 呈现 | Typed error |
|---|---|---|
| core inactive | P1（既有） | `PluginApiInactiveError` |
| 协议/原语缺失或畸形（typert protocol、`ctx.reflect.provide`） | P2 disabled 面；不影响 `settingsRemote`/`settings` 等其余 feature（AC 4.5） | `PluginApiFeatureDisabledError('remote', reason)` |
| serviceKey 非法（AC 1.2）| 注册前拒绝 | `PluginApiRemoteError` |
| service 形状非法 / 无方法 / 方法名非法（AC 3.1/3.2）| 注册前拒绝 | `PluginApiRemoteError` |
| 签名不可派生 / signal 位置错（AC 3.3/3.5）| 注册前拒绝（把官方调用期 `signature-invalid` 提前）| `PluginApiRemoteError` |
| 同行冲突（AC 1.6/4.1，含跨 ST4 同键）| 抛 conflict | `PluginApiRemoteError`（带 `serviceKey`）|
| 发布中途失败（AC 4.4）| 只回滚 own 已完成注册，反序；日志 contained | 不抛穿 apply |
| disposer 幂等 / stale（AC 4.2/4.3）| stale 时不误撤后来者 | 返回 `false`，不抛 |
| `apply` 全程（AC 4.6）| fail-safe，绝不抛穿 | — |

> 与 ST4 一致：官方 call-time 业务错误（如方法内 `store.update` 抛错）保持官方身份透传，门面不 reinterpret。

---

## 6. Testing Strategy（对应 Stage 4 Tasks，逐顶层大任务对抗审查）

- `test/remote-publication.test.mjs`：共享核心单测——owner 参数化（同 ctx 下 `remote` 与 `settingsRemote` 各自 owner 地图互不可见）、re-home 专用原型 + `remoteMethods({})===[]` 泄漏锁定、绑定形状校验、disposer 幂等/stale（newer provider 不被旧 disposer 误撤）、只读冲突探测（同键同引用幂等 / 异引用 conflict）、注册中途失败回滚（mock `reflect.provide` 抛出）。
- `test/host-remote.test.mjs`：generic publish 形状/签名/JSON-safe 契约（D1/D2/D3）、**幂等短路**（同一对象二次发布返回既有 disposer，不抛/不变更）、**冲突前检**（冲突发布不改调用方对象）、P2 disabled 面、`dispose()` 全清。用 ST4 同款 `makeHost` 模式（mock ctx.get/ctx.reflect.provide）。
- `test/remote-guard.test.mjs`：`runFeatureGuard('remote', ctx, deps)` 必需探针通过/缺失 P2（含无 `TypertRemoteService` 探针的断言）。
- `test/index-remote.test.mjs`：apply 级——FEATURE_MOUNTERS 顺序、`KNOWN_FEATURES` 含 `'remote'`、`pluginApi.remote` 表面、`pluginApi.remote.isActive`、与 `pluginApi.settings.remote` 共存互不干扰。
- **端到端可发现性（AC 2.5）**：发布后模拟官方 gateway source-mode 遍历（读 `ctx.reflect.props` service 条目 → `ctx.get` → `typertRemote` + `remoteMethods`），断言 endpoint claim 出现且可调用。
- **AC 7.1 迁移契约锁定**（本仓库侧）：用 pro-ex 同款服务形状（`{ get() {}, set(settings) {} }`）发布，断言 `protocol.remoteMethods` 描述、wire 参数名 `settings`、JSON-safe 快照一致——不依赖 pro-ex 仓库。
- **ST4 回归**：`test/settings-remote.test.mjs` 全部保持绿（D5 refactor 的硬回归闸）。
- 全量 `node --test` + `git diff --check`。

## 6.1 治理与登记（对应 requirements §6）

- 交付时 feature-list 新增 `pluginApi.remote` 项（type B / milestone M4 / status delivered，AC 6.1）；§4 迁移验收表新增 `config-remote.js` → `publish` 一行（AC 6.2）；AGENTS.md §8 append `plugin-api-host-remote-m4` 条目（AC 6.3）；版本号不单独 bump，minor 升级归 M4 integration 定界（AC 6.4）。具体登记动作在获批 Tasks 中列出，不在本 design 实现。

---

## 7. 钩子引出机制与失败/guard 策略（AGENTS.md §3.4 质量门）

- **引出机制**：B 类 —— 官方无"第三方任意服务发布"的 dispatch 点；本 feature 转译官方**公开原语**（`bindTypertRemote`/`Remote`/`remoteMethods`/`isTypertRemoteSegment` + `ctx.reflect.provide`）为稳定入口，并依赖官方 gateway 既有的 source-mode 自动发现（`dsh-api-gateway/lib/index.js:75-88,143-156`）完成 wire 可达。不新增 hook、不新增 catalog slice、无合成 Cordis 事件。
- **guard 策略**：必需 B 类 fail-closed P2（协议/原语缺失）；P1 沿用 core inactive；不 monkey-patch 官方文件；`remote` feature 失败不影响 `settingsRemote`/`settings` 等其余 feature（AC 4.5）。
- **失败路径**：§5 完整覆盖；`apply` 全路径 fail-safe（AC 4.6）。
- **非目标复述**：不做 client `remote.<ns>` 原生发现（U6/C7）；不把"任意服务发布"做成 R 类（`typert-gateway` 保持 capability-strategy 观察项，AC 5.3）；不提供 client 侧新 API（AC 5.1）；不覆盖 `settings.remote`（AC 5.4）。

---

## 8. 并行契约与偏差上报

- 共享文件写入全部 **append-only**（guards.js 分支、index.js mounter、plugin-api-service.js 表面与 `KNOWN_FEATURES`、errors.js 错误类），符合并行契约 §1.2。
- **D5**（ST4 `settings-remote.js` 委托共享核心）是唯一非 append 的已交付 feature 修改，作为 **recorded deviation** 在本 design 记载并按并行契约 §2.3 在交付报告显式上报；其硬回归闸是 ST4 既有测试全绿 + m3-integration 的 `settings-remote`/`client-settings-remote` 行为不变。
- 新 feature 标识 `remote`（guard 分支 = FEATURE_MOUNTERS key = `pluginApi.remote` 命名空间 = `KNOWN_FEATURES` 条目，并行契约 §1.1 同名规则），无命名冲突（feature-list 无现存顶层 `pluginApi.remote`；client 面 `client.remote` 为 C6 事件桥，不同 bundle/不同 owner）。

## 9. 需求覆盖检查（Requirements → Design）

| Requirements § | Design 落点 |
|---|---|
| §1 表面形状（1.1–1.6） | §3.2 publish 流量 + D6；幂等短路 §3.2/§3.1 step1 + D2b |
| §2 绑定/标记/注册/发现（2.1–2.5） | §3.1 step3–5、§3.3 D2/D2b、§6 端到端可发现性测试 |
| §3 形状/JSON-safe/wire（3.1–3.7） | §3.2 形状判定（B2 修复契约）、签名校验、re-home、D1/D2/D3、§4.2、§4.3 |
| §4 fail-safe（4.1–4.1b, 4.2–4.6） | §3.1 step1–2、§3.2 冲突前检、§5 错误表 |
| §5 边界非目标（5.1–5.7） | §2.2、§7 非目标、§3.3 D4 |
| §6 治理（6.1–6.4） | §6.1 |
| §7 迁移证据（7.1–7.3） | §6 AC 7.1 契约锁定测试 |
| §8 覆盖检查 | 本表自证 |
