# Tasks: plugin-api-tools-m1

> 依据：`requirements.md`（Stage 1，已批准，含 T4 AC 5.2–5.4 修订）与 `design.md`（Stage 2，已批准）。
> 执行顺序：Stage 4 按编号顺序一次一个任务；每个任务先写/先跑相关测试（TDD），全部通过后再进入下一个任务。
> 测试运行器：`node --test`。纯函数模块零 harness 依赖；涉及 Cordis/官方服务的测试使用 mock。
> 代码落点：`.worktrees/m1-tools` 工作树内；不修改官方 DSH 包文件；`apply` 永不 throw。

---

## 1. tools 事件目录纯模块

- [ ] 1.1 创建 `lib/tools-events-catalog.js`：导出深冻结的 `toolsEventsCatalog` 与 `toolsCatalogEntryOf(name)`。目录恰好包含 design Components 1 表格中的 6 个 `tools/*` 事件条目，每个条目含 `name/mode/scopeFiltered/subject/freeze/payload/args/source/type`；其中 `tools/execute` 的 `freeze` 为 `'except-signal'`，其余为 `'all'`。
- [ ] 1.2 创建 `test/tools-events-catalog.test.mjs`：断言恰好 6 个事件名、每个条目字段齐全且 mode/scopeFiltered/subject/freeze 与 design 表格一致（`tools/change` 为 `emit` 且 `scopeFiltered:false`；其余 5 个 `scopeFiltered:true` 且 `subject:'args[0].agent'`）、整个 catalog 与每个条目均 `Object.isFrozen`、`toolsCatalogEntryOf` 命中/未命中行为。
- 引用：requirements §3–§8、§11；design Components 1。

## 2. catalog 合并 helper

- [ ] 2.1 在 `lib/events-catalog.js` 新增纯函数 `mergeEventCatalogs(...catalogs)`：浅合并多个 catalog 后深冻结返回；任何异常捕获并返回 `eventsCatalog`（base catalog）。保持既有 `eventsCatalog` 与 `catalogEntryOf` 行为不变。
- [ ] 2.2 扩展 `test/events-catalog.test.mjs`：`mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)` 得到 25 个事件且深冻结；`mergeEventCatalogs(eventsCatalog)` 与 base 等价；合并结果每个条目仍冻结；base `eventsCatalog` 本身不被修改。
- 引用：requirements §11 AC 11.1、11.4、11.5；design Components 2。

## 3. deepFreezeExceptSignal 纯模块

- [ ] 3.1 在 `lib/deep-freeze.js` 新增 `deepFreezeExceptSignal(value)`：非对象原样返回；对每个自有属性，`signal` 跳过，其余递归 `deepFreeze` 并尽量定义为 `writable:false, configurable:false`；对对象 `Object.preventExtensions`；任一步失败都捕获并继续，绝不 throw。
- [ ] 3.2 扩展 `test/deep-freeze.test.mjs`：`tools/execute` 场景下 `exec.signal` 保持可写且值不冻结；非 signal 顶层属性不可写；嵌套对象深冻结；对象不可扩展；重复调用幂等；AbortSignal/exotic 对象不抛。
- 引用：requirements §5 AC 5.2–5.4；design Components 3。

## 4. events-bus 动态 catalog 与 freeze 策略

- [ ] 4.1 修改 `lib/events-bus.js`：把 `catalogEntryOf` 从静态 import 改为基于传入 `catalog` 的本地解析（`catalog[name]`）；`wrapped` 中根据 `meta.freeze` 选择 `deepFreezeExceptSignal`（`'except-signal'`）或 `deepFreeze`（默认）；其余 freeze/contain/scope gate/waterfall 语义保持不变。
- [ ] 4.2 扩展 `test/events-bus.test.mjs`：使用合并 catalog 覆盖 6 个 tools 事件——`tools/change` 全局 emit；5 个 scope-filtered tools 事件按 `args[0].agent` 过滤；`tools/execute` 下 listener 收到同一个 `exec`、非 signal 属性已冻结、`exec.signal` 可写，listener 原地替换 `exec.signal` 并调用 `next()` 后 mock 官方链观察到替换；其余 tools 事件 payload 全冻结且 waterfall/emit 语义不变。
- 引用：requirements §3–§8、§11；design Components 4、Error Handling 4–6。

## 5. plugin-api-service 扩展 tools 服务面

- [ ] 5.1 修改 `lib/plugin-api-service.js`：新增 `createDisabledToolsApi(active)`（`register/restrict/guard/get/schemas/execute/presentAs` 抛 inactive/feature-disabled typed error，不触碰官方服务）与 `createToolsApi(tools)`（委托传入的 traceable `tools`，含 `isActive:true`）。构造函数保存 `_toolsMounted=false` 与 `_toolsDisabled`，并用 `Object.defineProperty` 定义只读 accessor `get tools()`（未 mount 返回 `_toolsDisabled`；已 mount 返回 `createToolsApi(this.ctx.get('tools'))`）。`mountFeature(name, api)` 增加 `tools` 分支：设置 `_toolsMounted=true`。
- [ ] 5.2 新增 `test/plugin-api-service-tools.test.mjs`：inert 与 feature-disabled 两种 stub 抛 typed error；`mountFeature('tools', { isActive:true })` 后 accessor 返回 active API；`createToolsApi` 对 7 个方法逐一验证“调用 mock tools 同名方法、参数与返回值原样透传”；mock tools 方法抛错时 `pluginApi.tools.*` 原样传播、不吞错；未知名 `mountFeature` 仍拒绝。
- 引用：requirements §1 AC 1.1–1.2、§2、§9、§10；design Components 5。

## 6. tools feature guard

- [ ] 6.1 修改 `lib/guards.js` `runFeatureGuard`：新增 `tools` 分支，probe `ctx.get('tools')` 存在且 `register/restrict/guard/get/schemas/execute/presentAs` 均为 function。
- [ ] 6.2 新增 `test/tools-guard.test.mjs`：服务缺失、单个方法缺失、全部存在三组 probe 矩阵；guard 失败只返回 `tools` feature 的 problems，不影响其他 feature。
- 引用：requirements §1 AC 1.2；design Components 6、Error Handling 1。

## 7. index 挂载、catalog 扩展与集成测试

- [ ] 7.1 修改 `lib/index.js`：新增 `mountToolsFeature`（幂等：`service?.tools?.isActive === true` 时 no-op；调用 `service.mountFeature('tools', { isActive:true })`；返回 no-op disposer）。**不重复实现 `featureRegistry.mount('tools')`**：由 foundation apply 既有循环在 `ctx.effect` 后执行；因 `FEATURE_MOUNTERS` 中 `tools` 先于 `events`，`mountEventsFeature` 读取 `featureRegistry.isActive('tools')` 时已为 `true`。更新 `mountEventsFeature`：解构 `featureRegistry`，按 `featureRegistry.isActive('tools')` 选择 `mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)` 或 `eventsCatalog`，并传给 `createEventsBus`。`FEATURE_MOUNTERS` 顺序调整为 `tools` → `events` → `web` → `llm/admission`。
- [ ] 7.2 新增 `test/index-tools.test.mjs`：mock ctx（含 `get('tools')` 与 Cordis-like 事件方法）下 apply——tools active 时 `pluginApi.tools` 可用且 7 个方法委托 mock tools，`pluginApi.events.catalog` 含 base 19 + tools 6；tools guard 失败时 `pluginApi.tools` 抛 typed error、catalog 退回 base 19、门面其他 feature 仍 active；**重复 apply 时 `mountToolsFeature` 不再重复调用 `service.mountFeature('tools', ...)`**；apply 永不 throw。
- 引用：requirements §1、§11、§12；design Components 7、Architecture。

## 8. AGENTS.md / feature-list 同步与全量回归

- [ ] 8.1 更新 `.worktrees/m1-tools/AGENTS.md`：在“已交付 feature 登记”追加 `plugin-api-tools-m1` 条目（feature 名、范围 T1–T9、状态 delivered、spec 目录 `docs/specs/plugin-api-tools-m1/`、关键设计约束：`pluginApi.tools` scope-aware accessor / 6 个 tools 事件 catalog / `tools/execute` 的 `except-signal` 冻结策略 / 挂载顺序 `tools` 先于 `events`）。
- [ ] 8.2 更新 `docs/specs/plugin-api-features/feature-list.md`：将 T1–T9 的状态改为 `delivered`；T10 保持 `planned`。
- [ ] 8.3 在 `.worktrees/m1-tools` 运行全量 `node --test`：确保新增测试与既有 foundation / facade-integrity / llm-image-admission / events-m1 回归测试全部通过；仅在 spec 范围内修复回归。
- 引用：requirements §12；design「Documentation synchronization (AGENTS.md anti-staleness)」。

---

## Requirements coverage matrix

| Requirements 章节 | 任务 |
|---|---|
| 1. `pluginApi.tools` service surface and fail-safe | 5, 6, 7 |
| 2. Tool registration (T1) | 5（createToolsApi 直通）、7（集成） |
| 3. Tool change notification (T2) | 1（catalog 条目）、4（总线行为） |
| 4. Pre-execute gate waterfall (T3) | 1、4 |
| 5. Execute around-waterfall (T4) | 1、3、4 |
| 6. Post-execute decision waterfall (T5) | 1、4 |
| 7. Tool result notification (T6) | 1、4 |
| 8. Code dispatch log waterfall (T7) | 1、4 |
| 9. Tool restriction and guard passthrough (T8) | 5、7 |
| 10. Tool query and execution passthrough (T9) | 5、7 |
| 11. Tools event catalog extension | 1、2、4、7 |
| 12. Testability and regression coverage | 1–8 |
