# Tasks: plugin-api-llm-m1

> **Historical amendment:** L1 admission and the narrow L8 no-listener/no-re-dispatch
> wording were superseded by `plugin-api-llm-request-m2`; do not use this task file to
> reintroduce `admission.isActive`, a legacy projector, or a second resolver wrapper.

> 依据：`requirements.md`（Stage 1，已批准）与 `design.md`（Stage 2，已批准）。
> 执行顺序：Stage 4 按编号顺序一次一个任务；每个任务完成后跑相关测试，全部通过再进入下一个任务。
> 测试运行器：`node --test`。纯函数模块零 harness 依赖；涉及 Cordis/官方 `llm` 服务的测试使用 mock。
> TDD 约束：任务 1–5 先写/改测试并确认测试因缺少实现而失败，再完成实现并跑到通过。

---

## 1. 事件目录扩展：`llm/stream` 与 `llm/adapters-updated`（L3/L6）

- [x] 1.1 更新 `test/events-catalog.test.mjs`：
  - `EXPECTED_NAMES` 增加 `llm/stream` 与 `llm/adapters-updated`，并更新“19 个”相关测试名与断言为“21 个”。
  - matrix 增加 `llm/stream: ['waterfall', false, undefined]` 与 `llm/adapters-updated: ['emit', false, undefined]`。
  - 新增断言：`llm/stream` 的 `payload` 含 `GenerateOptions` 描述、`args === '(options, next)'`、`source === 'L3'`、`type === 'A'`；`llm/adapters-updated` 的 `payload === 'none'`、`args === '()'`、`source === 'L6'`、`type === 'A'`。
  - 运行 `node --test test/events-catalog.test.mjs`，确认因目录缺少新条目而失败。
- [x] 1.2 修改 `lib/events-catalog.js`：
  - 在 `entries` 末尾追加 `llm/stream`（`mode:'waterfall'`、`scopeFiltered:false`、`subject:undefined`、`payload:'GenerateOptions (official dsh-llm type); this binding is the LlmRuntime; next(): AsyncIterable<StreamChunk>'`、`args:'(options, next)'`、`source:'L3'`、`type:A`）与 `llm/adapters-updated`（`mode:'emit'`、`scopeFiltered:false`、`subject:undefined`、`payload:'none'`、`args:'()'`、`source:'L6'`、`type:A`）。
  - 更新文件头注释：目录计数 19 → 21；将“exactly the 25 in-scope features of plugin-api-events-m1 (19 event names)”修订为“plugin-api-events-m1 的 25 个 feature 加上 plugin-api-llm-m1 的 2 个事件 feature（L3/L6），共 21 个事件名”。
  - 不删除、不重命名既有 19 个条目。
- [x] 1.3 运行 `node --test test/events-catalog.test.mjs`，全部通过。
- [x] 1.4 更新 `test/events-bus.test.mjs`，补充 L3/L6 运行时订阅/派发用例：
  - 用 mock Cordis waterfall 派发 `llm/stream`：断言经 `pluginApi.events.on('llm/stream')` 注册的 facade listener 收到 `(options, next)`，且 `options` 已深冻结（`Object.isFrozen` 为 `true`）。
  - 断言 `pluginApi.events.waterfall('llm/stream', options, next)` 委托到 mock `ctx.waterfall`，参数与返回值透传。
  - 用 mock Cordis emit 派发 `llm/adapters-updated`：断言经 `pluginApi.events.on('llm/adapters-updated')` 注册的 facade listener 被无参调用。
  - 运行 `node --test test/events-bus.test.mjs`，全部通过。
- 引用：requirements §1 AC 1.2–1.4，§2 AC 2.2–2.3，§7 AC 7.2–7.3；design Components 1、Testing Strategy。

---

## 2. `lib/llm-api.js` 直通模块（L7/L8/L9）

- [x] 2.1 创建 `test/llm-api.test.mjs`，用 mock `llm` 服务覆盖：
  - `modelInfo(provider, model)`：断言 mock 收到两参；mock 返回可变 `LlmResolvedModelInfo` 时，结果对象及其可达对象均 `Object.isFrozen`；`modelInfo` 返回 Promise。
  - `modelInfo(provider, model, signal)`：断言 mock 收到三参且 `signal` 为同一引用。
  - `modelInfo` 官方 reject（或 async throw）时：返回的 promise 携带同一 error 对象。
  - `llmApi` 不含 `resolveModelInfo` 键。
  - `prepareCall(config)` 与 `prepareCall(config, signal)`：委托、signal 同一引用、返回值同一对象引用、官方 reject 同一 error。
  - `stream(options)`：委托、返回值同一对象引用、官方 throw 时同一 error 对象 rethrow。
  - `registerAdapter` / `registerConfigurableProviders` / `registerModelDiscovery`：委托、返回值同一对象引用（含 handle `.replace` 时保持）、参数对象不被克隆/包装、官方 throw 同一 error rethrow。
  - 运行 `node --test test/llm-api.test.mjs`，确认因模块缺失而失败。
- [x] 2.2 创建 `lib/llm-api.js`：按 design Components 2 实现 `createLlmApi({ llm, deepFreeze })`。`modelInfo` 用 `async` + `deepFreeze`；`prepareCall` 未传 signal 时只传 `config`、传入时传 `(config, signal)`；其余方法同步直通且不 catch。模块不 import Cordis。
- [x] 2.3 运行 `node --test test/llm-api.test.mjs`，全部通过。
- 引用：requirements §3 AC 3.1–3.6，§4 AC 4.1–4.5，§5 AC 5.1–5.6，§7 AC 7.4–7.6、7.8；design Components 2。

---

## 3. `plugin-api-service.js` 扩展：`llm` disabled stub 与 mount（L7/L8/L9 门面装配）

- [x] 3.1 创建 `test/plugin-api-service-llm.test.mjs`：
  - 初始 `pluginApi.llm` 为 disabled stub：`isActive === false`；core inactive 时六个方法抛 `PluginApiInactiveError`；core active 时抛 `PluginApiFeatureDisabledError('llm')`，且不触碰 mock 官方服务。
  - `mountFeature('llm', llmApi)` 后六个方法可调、`isActive === true`。
  - `mountFeature('llm')` 不覆盖既有 `llm.admission`；`mountFeature('llm/admission')` 仍可单独覆盖 `admission`。
  - 运行测试，确认因 service 缺少 `llm` stub/mount 分支而失败。
- [x] 3.2 修改 `lib/plugin-api-service.js`：
  - 新增 `createDisabledLlmApi(active)`（六个方法 + `isActive: false`，错误语义与既有 disabled stub 一致）。
  - 构造函数 `this.llm` 改为 `{ ...createDisabledLlmApi(active), admission: createDisabledAdmissionApi(active) }`；`createDisabledAdmissionApi` 为既有函数，保持不变。
  - `mountFeature` 新增 `'llm'` 分支：`for (const [key, value] of Object.entries(api)) this.llm[key] = value`；该分支不写 `admission` 键。
- [x] 3.3 运行 `node --test test/plugin-api-service-llm.test.mjs`，全部通过。
- 引用：requirements §6 AC 6.4、6.5，§7 AC 7.7；design Components 3。

---

## 4. `guards.js` 扩展：`llm` feature guard（L7/L8/L9 依赖探测）

- [x] 4.1 更新 `test/guards.test.mjs`，新增 `runFeatureGuard('llm')` probe 矩阵：
  - 缺 `ctx.get`、缺 `llm` 服务、缺 `resolveModelInfo` / `prepareCall` / `stream` / `registerAdapter` / `registerConfigurableProviders` / `registerModelDiscovery` 中任一方法 → 对应 problem 出现在返回的 `featureProblems['llm']`。
  - 六方法齐全 → `ok === true`。
  - 断言 guard 永不 throw。
  - 运行测试，确认新矩阵失败。
- [x] 4.2 修改 `lib/guards.js` `runFeatureGuard`：新增 `featureName === 'llm'` 分支，按 design Components 4 探测 `ctx.get` 与官方 `llm` 六个方法；复用现有 probe（每次 try/catch，不 throw）。不探测 `llm/stream` / `llm/adapters-updated` 事件源。
- [x] 4.3 运行 `node --test test/guards.test.mjs`，全部通过。
- 引用：requirements §6 AC 6.1、6.2；design Components 4。

---

## 5. `index.js` 挂载 `llm` feature（L7/L8/L9 服务面接线）

- [x] 5.1 创建 `test/index-llm.test.mjs`（mock apply 集成）：
  - `llm` feature guard 通过时：`pluginApi.llm` 六个方法被 mount，`admission` 保持已交付形状（mock `llm/admission` mount 后仍存在且可调）。
  - `llm` guard 失败时：仅 `llm` 禁用（`pluginApi.llm.isActive === false`，方法抛 `PluginApiFeatureDisabledError('llm')`）；`pluginApi` 仍 active；`pluginApi.events.catalog` 仍含 `llm/stream` 与 `llm/adapters-updated`。
  - `apply` 在以上场景永不 throw。
  - `mountLlmFeature` 幂等：重复 apply 不重复 mount、不覆盖 admission。
  - 运行测试，确认因 index 未挂载 `llm` 而失败。
- [x] 5.2 修改 `lib/index.js`：
  - 从 `./llm-api.js` 导入 `createLlmApi`；从 `./deep-freeze.js` 导入 `deepFreeze`（勿使用 `events-catalog.js` 内的局部同名函数）。
  - 新增 `mountLlmFeature({ ctx, service })`：`service?.llm?.isActive === true` 时返回 no-op；否则 `safeGet(ctx, 'llm')` → `createLlmApi({ llm, deepFreeze })` → `service.mountFeature('llm', llmApi)` → 返回 no-op disposer。
  - `FEATURE_MOUNTERS` 调整为 `events`、`web`、`llm`、`llm/admission`。
- [x] 5.3 运行 `node --test test/index-llm.test.mjs`，全部通过。
- 引用：requirements §6 AC 6.1–6.5，§7 AC 7.7、7.9；design Components 5。

---

## 6. 全量回归与迁移验收

- [x] 6.1 运行全量 `node --test`，确保新增测试与既有 foundation / facade-integrity / llm-image-admission / plugin-api-events-m1 回归测试全部通过；仅在 spec 范围内修复回归。同时确认新增代码未修改官方 DSH 包文件、未 import 官方包私有变量、仅经 `safeGet(ctx, 'llm')` 消费官方 `llm` 服务（requirements §6 AC 6.6 的实现纪律检查）。
- [x] 6.2 运行 `node --check lib/*.js`，确保所有 lib 文件语法通过。
- [x] 6.3 运行 `scripts/verify-migration.sh`（含 `node --test`、`node --check`、headless 冒烟、dev boot readiness）。若当前环境无 `dsh` 命令、headless/dev profile 不可用或 3082 端口被占用，则记录具体失败原因与脚本输出片段，并在最终结果报告中作为环境受限项说明，不得删除或绕过该脚本。
- 引用：requirements §7 AC 7.9、7.10；AGENTS.md 第 5 节迁移验收。

---

## 7. 文档同步（治理任务，按 AGENTS.md 第 8 节与 requirements §8 执行）

- [x] 7.1 更新工作树根 `AGENTS.md` 第 8 节：追加 `plugin-api-llm-m1` 条目（范围 `L3, L6, L7, L8, L9`、状态 `delivered`、spec 目录 `docs/specs/plugin-api-llm-m1/`、关键约束：`llm` feature guard 六方法探测、`modelInfo` deepFreeze 只读、L9 注册 handle 原样直通、events 目录 19→21）。
- [x] 7.2 更新 `docs/specs/plugin-api-features/feature-list.md`：将 L3、L6、L7、L8、L9 的状态改为 `delivered`，并同步任何公开 API 形状定稿差异。
- [x] 7.3 更新 `docs/specs/plugin-api-events-m1/requirements.md` AC 7.3/7.4：在 AC 7.3 的显式事件名清单中追加 `llm/stream` 与 `llm/adapters-updated` 两条，并调整 AC 7.4 的 scope 表述，使这两个 `plugin-api-llm-m1` 追加条目不再被“outside this spec's 25-feature scope”排除；原 19 事件目录由此扩展为 21 个事件。
- 引用：requirements §8 AC 8.1–8.3；design「Documentation synchronization」。

---

## Requirements coverage matrix

| Requirements 章节 | 任务 |
|---|---|
| 1. Typed `llm/stream` waterfall (L3) | 1 |
| 2. Typed `llm/adapters-updated` (L6) | 1 |
| 3. Read-only model-info query (L7) | 2, 3, 4, 5 |
| 4. Call preparation and streaming entry (L8) | 2, 3, 4, 5 |
| 5. Provider registration passthrough (L9) | 2, 3, 4, 5 |
| 6. Feature guard and fail-safe | 4, 5 |
| 7. Testability and regression | 1–6 |
| 8. Documentation synchronization | 7 |
