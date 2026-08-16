# Tasks: plugin-api-events-m1

> 依据：`requirements.md`（Stage 1，已批准）与 `design.md`（Stage 2，已批准）。
> 执行顺序：Stage 4 按编号顺序一次一个任务；每个任务完成后跑相关测试，全部通过再进入下一个任务。
> 测试运行器：`node --test`。纯函数模块零 harness 依赖；涉及 Cordis/官方服务的测试使用 mock。

---

## 1. 事件目录纯模块

- [ ] 1.1 创建 `lib/events-catalog.js`：导出深冻结的 `eventsCatalog` 与 `catalogEntryOf(name)`。目录恰好包含 design 中列出的 19 个事件条目，每个条目含 `name/mode/scopeFiltered/subject/payload/args/source/type`。
- [ ] 1.2 创建 `test/events-catalog.test.mjs`：断言 19 个事件名与 requirements AC 7.3 完全一致、每个条目字段齐全且 mode/scopeFiltered/subject 与 design 表格一致、整个 catalog 与每个条目均 `Object.isFrozen`、`catalogEntryOf` 命中/未命中行为。
- 引用：requirements §7（E12）、§8–§14；design Components 1。

## 2. deepFreeze 纯模块

- [ ] 2.1 创建 `lib/deep-freeze.js`：`deepFreeze(value)` 递归 `Object.freeze`；`WeakSet` 防循环；`Object.isFrozen` 短路；函数/primitive 原样返回；任何异常捕获后返回原值（绝不 throw）。
- [ ] 2.2 创建 `test/deep-freeze.test.mjs`：普通对象/数组、嵌套对象、循环引用、已冻结对象、函数与 primitive、exotic 对象（不抛且返回原值）。
- 引用：requirements §4（E9）；design Components 2。

## 3. priority typed error

- [ ] 3.1 在 `lib/errors.js` 新增 `PluginApiEventPriorityError`（`code: 'PLUGIN_API_INVALID_PRIORITY'`，携带非法 `priority` 值），继承 `PluginApiError`。
- [ ] 3.2 扩展 `test/errors.test.mjs`：断言 error 的 `code/name/priority` 与 instanceof 关系。
- 引用：requirements §3 AC 3.2；design Components 5。

## 4. events-bus 订阅骨架（on/once + 非 cataloged 透传）

- [ ] 4.1 创建 `lib/events-bus.js`：`createEventsBus({ ctx, catalog, logger })` 返回 `eventsApi`。实现 `on/once`：cataloged 事件先注册 entry（本任务 wrapper 为直接调用用户 listener 的占位实现，后续任务增强）；非 cataloged 事件直接 `ctx.on/ctx.once` 透传并返回 Cordis disposer；返回的 disposer 幂等、第二次调用返回 `false`；`once` 首次调用前先移除自身。
- [ ] 4.2 创建 `test/events-bus.test.mjs` 与 mock Cordis 事件上下文（实现 dispatch：shift 可选 `thisArg` 与 name、绑定 `this`、按 emit 调用回调）。断言：on/once 注册与 disposer 布尔语义、once 只调用一次且先移除、非 cataloged 名直接落到 `ctx.on/ctx.once` 且门面不包裹。
- 引用：requirements §1（E1/E2）AC 1.1–1.5；design Components 3.1。

## 5. priority 排序与重注册（E8）

- [ ] 5.1 在 `lib/events-bus.js` 实现六档 priority 有序 entry 列表与 `reconcile(name)`：dispose 旧 facade hooks → 按 tier 升序、同 tier 按 `order` 升序重注册 `ctx.on(name, wrapped, {})`；非法 priority 抛 `PluginApiEventPriorityError` 且不注册；注册失败回滚并 rethrow。
- [ ] 5.2 扩展 `test/events-bus.test.mjs`：六档顺序、同档插入序、monitor 最后、disposer 移除后顺序更新、非法 priority typed error。
- 引用：requirements §3（E8）AC 3.1–3.4、3.7；design Components 3.1/3.3、Error Handling 7。

## 6. 非 waterfall 包裹：deepFreeze + 故障隔离（E9/E11）

- [ ] 6.1 在 `lib/events-bus.js` 把占位 wrapper 升级为 mode 化 wrapper：调用前对非函数 object 实参 `deepFreeze`；`emit`/`bail`/`serial`/`parallel` 四种模式的 sync throw 与 rejected promise 全部 contain（log 不 rethrow / 不 reject aggregate），`bail`/`serial` 失败 listener 不产生 bail；`parallel` 恒返回 resolved；`bail`/`serial` 的 `monitor` listener 恒返回 `undefined`（observe-only，不产生 bail、不改写 serial 结果）。
- [ ] 6.2 扩展 `test/events-bus.test.mjs`：emit/bail/serial/parallel 的 sync throw 与 rejection 包含、dispatch 继续、payload 已 deepFreeze、parallel aggregate 不 reject、monitor 在 bail/serial 下返回值被忽略且派发结果不被 monitor 改变。
- 引用：requirements §4 AC 4.1–4.3、§6 AC 6.1–6.2、6.4–6.6；design Components 3.3。

## 7. scope 过滤 + waterfall 包裹（E10/E9/E11/E8-monitor）

- [ ] 7.1 在 `lib/events-bus.js` 实现 scope gate：`subject === 'args[0].agent'` 用 `args[0]?.agent`；`subject === null` 用 `carrierKeyOf(this)`；不匹配的非 waterfall 返回 `undefined`，不匹配的 waterfall 调 `next()` 继续；非 scope-filtered 事件传 `opts.scope` 忽略。实现 waterfall wrapper：`guardedNext` 标记 `called` 并记录 `chainResult`；sync throw / rejection 时 contain，且 `!called` 时继续 `originalNext()`；`monitor` 忽略自身返回值，返回 `called ? chainResult : originalNext()`。
- [ ] 7.2 扩展 `test/events-bus.test.mjs`：`goal/changed`、`approval/request` 按 `args[0].agent` 过滤；`subagent/start|end` 用 mock scope carrier + 真实 `carrierKeyOf` 过滤；waterfall 继续语义、rejection 继续、monitor 不 veto 且不改写链结果。
- 引用：requirements §5（E10）、§6 AC 6.3、§4 AC 4.4、§3 AC 3.5；design Components 3.3、Data Models。

## 8. 派发面委托（E3–E7）

- [ ] 8.1 在 `lib/events-bus.js` 实现 `emit/serial/parallel/bail/waterfall`：分别委托 `ctx.emit/serial/parallel/bail/waterfall` 并原样返回结果。
- [ ] 8.2 扩展 `test/events-bus.test.mjs`：断言五种方法调用对应 `ctx.*`、参数与返回值透传、facade listener 作为原生 hook 收到相同实参。
- 引用：requirements §2（E3–E7）；design Components 3.2。

## 9. plugin-api-service 扩展（events/web stubs 与 mountFeature）

- [ ] 9.1 修改 `lib/plugin-api-service.js`：构造时新增 `events` 与 `web` disabled stub（方法抛 inactive/feature-disabled typed error；`events.catalog` 为 `undefined`）；`mountFeature` 支持 `events`、`web`。
- [ ] 9.2 新增 `test/plugin-api-service-events.test.mjs`：inert 与 feature-disabled 两种 stub 行为、mount 后 API 可调、未知名仍拒绝。
- 引用：requirements §1 AC 1.6、§2 AC 2.7、§13 AC 13.3；design Components 4。

## 10. feature guard 扩展（events/web）

- [ ] 10.1 修改 `lib/guards.js` `runFeatureGuard`：新增 `events` 分支（probe `ctx.on/once/emit/serial/parallel/bail/waterfall` 均为 function）与 `web` 分支（probe `ctx.get('web')` 的 `registerSearchProvider/registerFetchProvider` 均为 function）。
- [ ] 10.2 新增 `test/events-guard.test.mjs`：probe 矩阵、缺 `web` 服务时仅 `web` disabled、`events` 失败不影响其他 feature。
- 引用：requirements §15 AC 15.9；design Components 6、Error Handling 1–2。

## 11. index 挂载 + package peerDependency + 集成测试

- [ ] 11.1 修改 `lib/index.js`：`FEATURE_MOUNTERS` 增加 `events`（`mountEventsFeature`：`createEventsBus` → `service.mountFeature('events', api)` → 返回 dispose 全部 facade hooks 的 disposer）与 `web`（`mountWebFeature`：构造 `webApi`，其中 `registerSearchProvider(provider)` / `registerFetchProvider(provider)` 分别调用 `ctx.get('web').registerSearchProvider(provider)` / `registerFetchProvider(provider)` 并**原样返回官方返回值**，不包装、不缓存、不改写 provider；`service.mountFeature('web', webApi)` → no-op disposer）。
- [ ] 11.2 修改 `package.json`：`peerDependencies` 增加 `"@deepseek-ai/dsh-scope": "^0.1.0-rc.6"`。
- [ ] 11.3 新增 `test/index-events.test.mjs`：apply 成功挂载 events/web、events 失败时门面仍 active 且只禁用 events、apply 永不 throw；web 直通断言：同一 provider 对象传给官方方法、官方返回值原样返回、门面不包装 provider、web 服务缺失时 stub 抛 typed error（与任务 9.2 对齐）。
- 引用：requirements §15 AC 15.9–15.10、§13（O15）；design Components 7/8。

## 12. AGENTS.md / feature-list 同步与全量回归

- [ ] 12.1 更新 `AGENTS.md`：追加 `plugin-api-events-m1` 条目（feature 名、范围 E1–E12 + O1–O7,O9–O12,O15,O16、状态 delivered、spec 目录、关键设计约束：events-bus 原生 hook 按序重注册 / deepFreeze / scope 过滤 / `dsh-scope` peerDependency）。
- [ ] 12.2 更新 `docs/specs/plugin-api-features/feature-list.md`：将 E1–E12 与 O1–O7,O9–O12,O15,O16 的状态改为 `delivered`（E12 注明首版目录覆盖本次 25 个 feature）。
- [ ] 12.3 运行全量 `node --test`：确保新增测试与既有 foundation / facade-integrity / llm-image-admission 回归测试全部通过；仅在 spec 范围内修复回归。
- 引用：requirements §15；design「Documentation synchronization (AGENTS.md anti-staleness)」。

---

## Requirements coverage matrix

| Requirements 章节 | 任务 |
|---|---|
| 1. Subscription surface (E1/E2) | 4, 9 |
| 2. Dispatch surface (E3–E7) | 8 |
| 3. Priority ordering (E8) | 3, 5, 6（bail/serial monitor observe-only）, 7（waterfall monitor observe-only） |
| 4. Read-only payload (E9) | 2, 6, 7 |
| 5. Scope-aware subscription (E10) | 7 |
| 6. Listener fault isolation (E11) | 6, 7 |
| 7. Event catalog (E12) | 1 |
| 8. File-system events (O1–O3) | 1（catalog 条目）+ 4–8（总线能力） |
| 9. Subagent events (O4/O5) | 1 + 4–8 |
| 10. Workflow events (O6) | 1 + 4–8 |
| 11. Approval request (O7) | 1 + 4–8 |
| 12. Change notifications (O9–O12) | 1 + 4–8 |
| 13. Web passthrough (O15) | 9（disabled stub）、10（guard）、11（直通实现与测试） |
| 14. Session telemetry (O16) | 1 + 4–8 |
| 15. Testability and regression | 1–12 |
