# Tasks: plugin-api-session-m1

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.session`（S1/S3/S4/S5） | `pluginApi.sessions`（叶子名不变） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

> 依据：`docs/specs/plugin-api-session-m1/design.md`（Stage 2 已批准）。实现顺序遵循 design 的组件顺序：先纯模块，再 session API，再 guard/service 扩展，最后 host 集成与回归。
>
> 每个任务只做该任务列出的内容，不夹带 S2/S6 或其他 feature。测试运行器 `node --test`；纯函数模块保持零 harness 依赖。

---

## 1. S1 会话生命周期事件目录

- [x] 1.1 创建 `lib/session-events-catalog.js`
  - 导出 `SESSION_LIFECYCLE_EVENT_NAMES`：冻结数组，恰好 `['session/created', 'session/disposed', 'session/event', 'session/flush']`。
  - 导出 `sessionLifecycleEventsCatalog`：深冻结对象，恰好 4 个 entry；每个 entry 含 `name/mode/scopeFiltered/subject/payload/args/source/type`，取值与 design 组件 1 的表格完全一致（`mode: 'emit'|'parallel'`、`scopeFiltered: true`、`subject: null`、`source: 'S1'`、`type: 'A'`）。
  - 零 harness 依赖。
  - 引用：requirements §1 AC 1.1（目录化订阅的前提）；design 组件 1。

- [x] 1.2 创建 `test/session-events-catalog.test.mjs`
  - 断言 `SESSION_LIFECYCLE_EVENT_NAMES` 恰好 4 个名字且顺序正确、数组冻结。
  - 断言 `sessionLifecycleEventsCatalog` 恰好 4 个 key，每个 entry 的 `name/mode/scopeFiltered/subject/payload/args/source/type` 与 design 表格一致。
  - 断言 catalog 与每个 entry 均 `Object.isFrozen`（深冻结：entry 的嵌套字段若为对象也冻结；本模块 entry 均为字符串/布尔/null，浅层即可）。
  - 引用：requirements §1 AC 1.1；design Testing Strategy `session-events-catalog`。

---

## 2. catalog 组合纯模块

- [x] 2.1 创建 `lib/catalog-compose.js`
  - 导出 `composeCatalogs(...catalogs)`：按参数顺序合并所有 catalog 的 entry，返回新对象。
  - 返回对象与每个 entry 均深冻结（复用或内联与 `events-catalog.js` 等价的深冻结实现；不新增运行时依赖）。
  - 任意两个输入 catalog 出现同名 key 时直接抛 `Error`（fail loud，不静默覆盖）。
  - 零 harness 依赖；不负责日志。
  - 引用：requirements §5 AC 5.1（session 依赖 events catalog 组合）；design 组件 2。

- [x] 2.2 创建 `test/catalog-compose.test.mjs`
  - 用 `eventsCatalog`（base 19）与 `sessionLifecycleEventsCatalog`（4）组合，断言结果恰好 23 个 key、base 与 session 条目均保留原值。
  - 断言结果对象与每个 entry 均 `Object.isFrozen`。
  - 重复 key（两个包含 `session/created` 的 catalog）时抛错。
  - 空输入返回空冻结对象；单 catalog 返回等价冻结副本。
  - 引用：requirements §1 AC 1.1–1.2、§5 AC 5.1；design Testing Strategy `catalog-compose`。

---

## 3. S5 会话事件类型目录与类型守卫

- [x] 3.1 创建 `lib/session-catalog.js`
  - 导出 `createSessionTypeCatalogs({ knownSessionEventTypes, isSurfaceEligibleType })`。
  - 输入合法（`knownSessionEventTypes` 是 Set，`isSurfaceEligibleType` 是 function）时：
    - `sessionEventTypes = deepFreeze([...knownSessionEventTypes].sort())`；
    - `surfaceEventTypes = deepFreeze([...knownSessionEventTypes].filter((type) => isSurfaceEligibleType(type)).sort())`；
    - `isSessionEventType(value)`：`typeof value === 'string' && knownSessionEventTypes.has(value)`，永不 throw；
    - `isSurfaceEventType(value)`：`typeof value === 'string' && surfaceEventTypes.includes(value)`，永不 throw。
  - 返回 `{ ok: true, sessionEventTypes, surfaceEventTypes, isSessionEventType, isSurfaceEventType }`。
  - 输入非法时返回 `{ ok: false, sessionEventTypes: Object.freeze([]), surfaceEventTypes: Object.freeze([]), isSessionEventType: () => false, isSurfaceEventType: () => false }`，永不 throw。
  - 零 harness 依赖（`deepFreeze` 复用 `lib/deep-freeze.js`）。
  - 引用：requirements §4 AC 4.1–4.7；design 组件 6。

- [x] 3.2 创建 `test/session-catalog.test.mjs`
  - 用真实 `KNOWN_SESSION_EVENT_TYPES` 与 `isSurfaceEligibleType`（自 `@deepseek-ai/dsh-session` 根导出）测试：
    - `sessionEventTypes` 含 `session/end-seed` 与 `session/title`，**不含** `session/created|disposed|event|flush`；排序确定；数组冻结。
    - `surfaceEventTypes` 恰好排序后的 `['assistant/message', 'tool/result', 'user/message']`；每项通过官方 `isSurfaceEligibleType`；数组冻结。
    - 两个类型守卫对 `null/undefined/数字/对象` 返回 `false` 且不 throw；对目录内/外字符串返回正确布尔。
  - 非法输入矩阵（`knownSessionEventTypes` 非 Set、`isSurfaceEligibleType` 非 function、缺失）返回 `{ok:false}` 且守卫恒 `false` 不 throw。
  - 引用：requirements §4 AC 4.1–4.7；design Testing Strategy `session-catalog`。

---

## 4. session API 工厂与 mounter

- [x] 4.1 创建 `lib/session-feature.js`
  - 从 `@deepseek-ai/dsh-session` 根导出导入 `KNOWN_SESSION_EVENT_TYPES` 与 `isSurfaceEligibleType`（公开 API，非私有模块）。
  - 导出 `createSessionApi({ ctx, sessions, eventsApi, dshSession, logger })`，实现 design 组件 5.2：
    - **S1**：`on(name, listener, opts?)` / `once(name, listener, opts?)` 对 `SESSION_LIFECYCLE_EVENT_NAMES` 中的名字委托 `eventsApi.on/once` 并原样返回 disposer；其他名字走 `ctx.on/ctx.once` 原始透传，忽略 `opts`。
    - **S3**：`get(id)` / `list()` / `fork(source, boundary, childSessionId)` 直接委托 `sessions.get/list/fork`，参数（含 `undefined`）原样转发，返回值/异常原样返回/传播。
    - **S4**：`header/events/seq/requestHeader/requestContext` 直通官方 Session 成员；`deriveMessages` 返回 `deepFreeze([...session.deriveMessages()])`；`surface` 返回 `deepFreeze({ nodes: [...session.surface.nodes], replaceGeneration: session.surface.replaceGeneration })`，绝不返回官方 `SurfaceManager` 或内部 `nodes` 数组。
    - **AC 3.5 说明**：官方 `deriveMessages()` 无 options 参数（design 源码调研 L50/L1539–1554）；门面签名 `deriveMessages(session)` 已满足“按官方支持的 options 原样透传”——官方无 options 可透传，行为为空，无需额外参数。
    - **S5**：调用 `createSessionTypeCatalogs(dshSession)`；`{ok:true}` 时使用其目录与守卫；`{ok:false}` 时使用空目录与恒 `false` 守卫并 `logger.warn` 一条可读诊断（不 throw、不因此禁用 session）。
    - 返回对象含 `isActive: true`。
  - 导出 `mountSessionFeature({ ctx, service, logger })`：
    - 幂等：`service?.session?.isActive === true` 时返回 no-op disposer。
    - `sessions = safeGet(ctx, 'sessions')`（safeGet 逻辑与 `lib/index.js` 一致，或抽到共享 helper；不得因 `ctx.get` 抛错而 throw）。
    - 校验 `sessions.get/list/fork` 为 function、`service.events.on/once` 为 function、且 `service.features` 快照中存在 `{ name: 'events', isActive: true }`；任一不满足返回 `null`。
    - 通过后 `service.mountFeature('session', createSessionApi(...))`；返回 no-op disposer（无自有资源）。
  - 引用：requirements §1 AC 1.1–1.6、§2 AC 2.1–2.6、§3 AC 3.1–3.6、§4 AC 4.1–4.7、§5 AC 5.4；design 组件 5。

- [x] 4.2 创建 `test/session-api.test.mjs`
  - Mock `ctx`（`on/once` 记录原始透传）、`eventsApi`（`on/once` 记录委托并返回可控 disposer）、`sessions`（`get/list/fork` 返回哨兵值/抛 `SessionForkError`）。
  - S1：四个名字委托 `eventsApi.on/once` 且 disposer 原样返回；非 S1 名落到 `ctx.on/ctx.once` 原始 listener 且 `opts` 被忽略。
  - S3：`get/list/fork` 参数（含 `undefined`）原样转发；返回值一致；`sessions.fork` 抛错原样透传。
  - S4：构造带 `header/events/seq/surface/requestHeader/requestContext/deriveMessages` 的 mock session；断言各访问器返回值；`surface` 返回深冻结快照且修改其 `nodes` 不影响 `session.surface.nodes`；`deriveMessages` 返回冻结数组；访问器调用后 session 未被修改。
  - S5：目录与类型守卫来自 `createSessionTypeCatalogs`；`{ok:false}` 时目录为空、守卫恒 `false`、有 warn。
  - 引用：requirements §1 AC 1.1–1.6、§2 AC 2.1–2.6、§3 AC 3.1–3.6、§4 AC 4.1–4.7；design Testing Strategy `session-api`。

---

## 5. feature guard 扩展

- [x] 5.1 修改 `lib/guards.js`
  - `runFeatureGuard` 增加 `session` 分支，probe 三项：
    - `sessions.get`：`ctx.get('sessions')?.get` 为 function；
    - `sessions.list`：`ctx.get('sessions')?.list` 为 function；
    - `sessions.fork`：`ctx.get('sessions')?.fork` 为 function。
  - 不探测 events 是否已挂载；不探测 `@deepseek-ai/dsh-session` 静态导出。
  - 其余 probe 行为、`DSH_PLUGIN_API_GUARD_DISABLE=1`、未知 feature 拒绝保持现状。
  - 引用：requirements §5 AC 5.1–5.2；design 组件 8。

- [x] 5.2 创建 `test/session-guard.test.mjs`
  - `runFeatureGuard('session')` 在 `sessions` 缺失 / `get` 非函数 / `list` 非函数 / `fork` 非函数 / 全部正常 时的结果矩阵。
  - 断言 probe 失败只影响 `session`，`ok:false` 且 `problems` 有对应项；guard 永不 throw（含 `ctx.get` 抛错的敌意 ctx）。
  - 未知 feature 仍返回 `ok:false` 且 problem 为 unknown feature。
  - 引用：requirements §5 AC 5.1–5.2；design Testing Strategy `session-guard`。

---

## 6. pluginApi 服务扩展

- [x] 6.1 修改 `lib/plugin-api-service.js`
  - 构造时新增 `this.session = createDisabledSessionApi(active)`。
  - `createDisabledSessionApi(active)`：`on/once/get/list/fork/header/events/seq/surface/requestHeader/requestContext/deriveMessages/isSessionEventType/isSurfaceEventType` 全部走统一 `fail`（core inert 抛 `PluginApiInactiveError`，否则抛 `PluginApiFeatureDisabledError('session')`）；`sessionEventTypes` / `surfaceEventTypes` 为 `undefined`。
  - `mountFeature` 增加 `session` 分支。
  - 所有 stub 方法在抛错前不触碰任何官方服务（纯本地判断）。
  - 引用：requirements §5 AC 5.3；design 组件 7。

- [x] 6.2 创建 `test/plugin-api-service-session.test.mjs`
  - core active + session disabled：每个方法抛 `PluginApiFeatureDisabledError('session')`；`sessionEventTypes` / `surfaceEventTypes` 为 `undefined`。
  - core inert + session disabled：每个方法抛 `PluginApiInactiveError`。
  - `mountFeature('session', api)` 后 `service.session === api`。
  - 未知名 `mountFeature` 仍抛 typed error。
  - 引用：requirements §5 AC 5.3；design Testing Strategy `plugin-api-service-session`。

---

## 7. host 集成与回归更新

- [x] 7.1 修改 `lib/index.js`
  - 新增 import：`composeCatalogs`、`sessionLifecycleEventsCatalog`、`mountSessionFeature`。
  - 模块级 lazy 缓存 `getComposedEventsCatalog()`：`composeCatalogs(eventsCatalog, sessionLifecycleEventsCatalog)`，成功一次后缓存冻结对象；compose 抛错时向上抛（由 `mountEventsFeature` 捕获）。
  - `mountEventsFeature` 改用 `getComposedEventsCatalog()` 作为 `createEventsBus` 的 catalog；幂等复用判断改为 `service?.events?.catalog === getComposedEventsCatalog()`；`getComposedEventsCatalog()` 抛错时返回 `null`。
  - `FEATURE_MOUNTERS` 顺序调整为 `events → session → web → llm/admission`。
  - `apply` 主循环无需改动（已按 Map 顺序执行并处理 guard/mount/disposer）。
  - 引用：requirements §1 AC 1.1（session 事件进入 events catalog）、§5 AC 5.1–5.3；design 组件 4。

- [x] 7.2 创建 `test/index-session.test.mjs`
  - 扩展 `test/index-events.test.mjs` 的 mock ctx：`services` 增加 `sessions: { get(){}, list(){}, fork(){} }`。
  - 断言 apply 后 `pluginApi.events.catalog` 包含 base 19 + session 4 共 23 个 key 且深冻结。
  - 断言 `pluginApi.session.isActive === true`，且 `pluginApi.session.on('session/event', listener)` 后 mock ctx 收到名为 `session/event` 的 facade hook。
  - 断言 `pluginApi.session` 的 S3/S4/S5 表面存在且类型正确（方法为 function、目录为冻结数组）。
  - 无 `sessions` 服务时：仅 `session` disabled，门面 active，`events/web/llm-admission` 正常；`pluginApi.session` 方法抛 `PluginApiFeatureDisabledError('session')`。
  - apply 永不 throw。
  - 引用：requirements §1 AC 1.1–1.6、§2 AC 2.1–2.6、§3 AC 3.1–3.6、§4 AC 4.1–4.7、§5 AC 5.1–5.3；design Testing Strategy `index-session`。

- [x] 7.3 更新 `test/index-events.test.mjs`
  - `features` 数量 3 → 4，顺序 `events, session, web, llm/admission`。
  - `pluginApi.events.catalog` 断言从严格等于 `eventsCatalog` 改为组合目录（含 `session/created` 等 4 个 session key 且深冻结）。
  - 其余 events/web 行为断言不变。
  - 引用：requirements §1 AC 1.1–1.2、§5 AC 5.1；design Testing Strategy 更新既有测试。

- [x] 7.4 更新 `test/guards.test.mjs`（若其当前用例枚举 feature 名或 feature 数量）
  - 检查并补充 `session` 分支的 guard 结果断言；保持既有用例兼容。
  - 引用：requirements §5 AC 5.1–5.2；design Testing Strategy 更新既有测试。

---

## 8. package.json 与治理文档同步

- [x] 8.1 修改 `package.json`
  - `peerDependencies` 增加 `"@deepseek-ai/dsh-session": "^0.1.0-rc.6"`。
  - 不改动 `dsh.api`、`exports`、`dsh.bundle`。
  - 引用：requirements §5 AC 5.1（官方服务宿主来源）；design 组件 9。

- [x] 8.2 更新 `test/package.test.mjs`
  - 断言 `pkg.peerDependencies['@deepseek-ai/dsh-session']` 为 string。
  - 既有断言保持不变。
  - 引用：requirements §5 AC 5.1；AGENTS.md 第 6 节（peerDependencies 共享宿主实例）。

- [x] 8.3 更新治理文档（AGENTS.md 防过期；用户明确要求的例外文档任务）
  - 仓库根 `AGENTS.md` 第 8 节追加 `plugin-api-session-m1` 条目：范围 S1/S3/S4/S5、状态 delivered、spec 目录 `docs/specs/plugin-api-session-m1/`、关键约束（S1 复用组合 events catalog；S4 `surface` 返回冻结快照；S5 从 `KNOWN_SESSION_EVENT_TYPES` 派生）。
  - `docs/specs/plugin-api-features/feature-list.md` 中 S1/S3/S4/S5 状态 `planned` → `delivered`。
  - 引用：design Documentation synchronization；AGENTS.md 第 8 节。

---

## 9. 全量回归与迁移验收

- [x] 9.1 运行全量 `node --test`
  - 确保新增测试与既有测试全部通过；若任务 7.3/7.4 之外的既有测试因 feature 数量/目录变化失败，先检查是否为本 feature 的预期影响，再最小更新对应断言并记录。
  - 引用：requirements §1–§5（AC 1.1–5.5）；design Testing Strategy。

- [x] 9.2 运行迁移验收（AGENTS.md 第 5 节）
  - **范围说明**：本 feature 为 S1/S3/S4/S5 的 A 类直通，S2（上屏构造 helper）与 S6（官方上屏 helper）明确不在本 spec，因此没有可删除的对应 hack；迁移验收退化为“兄弟仓库无新增回归”的不回归检查，并在最终报告中记录该退化理由。
  - 运行 `../dsh-pro-ex-ability-anchor` 的 `npm test`（即 `node --test`），确认其会话上屏相关测试无新增失败。
  - 运行 `../dsh-read-image` 的测试：`node --test ../dsh-read-image/test/*.test.mjs`（该仓库无 npm scripts，但存在 `test/guards.test.mjs` 与 `test/runtime.test.mjs`），确认其 guards/runtime 行为无新增失败。
  - 验收标准：`dsh-plugin-api` 全量测试通过，且上述两个仓库的测试无新增失败；发现失败时先修复本仓库 spec/实现并复跑，不得修改兄弟仓库。
  - 引用：AGENTS.md 第 5 节；requirements §5 AC 5.5（escape hatch 不被拦截）。
