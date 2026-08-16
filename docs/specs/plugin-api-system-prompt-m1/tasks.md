# Tasks: plugin-api-system-prompt-m1

> 依据：`requirements.md`（Stage 1，已批准）与 `design.md`（Stage 2，已批准）。
> 执行顺序：Stage 4 按编号顺序一次一个任务；每个任务完成后跑相关测试，全部通过再进入下一个任务。
> 测试运行器：`node --test`。纯函数模块零 harness 依赖；涉及 Cordis/官方服务的测试使用 mock（渲染 helper 的 parity 断言允许 import 官方公开导出）。

---

## 1. 事件目录扩展（P6/P7 catalog 条目）

- [x] 1.1 修改 `lib/events-catalog.js`：在既有 19 个条目后追加 `system-prompt/assemble`（`mode: 'waterfall'`、`scopeFiltered: true`、`subject: 'args[1].scope'`、`payload: 'assembly {sections, contexts, tools, variables}; context {scope?, signal?}'`、`args: '(assembly, context, next)'`、`source: 'P6'`、`type: 'A'`）与 `system-prompt/change`（`mode: 'emit'`、`scopeFiltered: false`、`subject: undefined`、`payload: 'none'`、`args: '()'`、`source: 'P7'`、`type: 'A'`）。同步更新头部“19 event names”计数注释为“21 event names”，并把 `CatalogEntry.subject` 的 JSDoc 类型扩展为 `'args[0].agent' | 'args[1].scope' | null | undefined`。保持 catalog 深冻结只读。
- [x] 1.2 更新 `test/events-catalog.test.mjs`：事件名数量断言从 19 改为 21；断言两个新条目的全部字段与 design 表格一致；catalog 与每个条目仍 `Object.isFrozen`；`catalogEntryOf` 命中/未命中行为不变。
- 引用：requirements §7 AC 7.3、§8 AC 8.3；design Components 1。

## 2. events-bus scope gate 扩展（`args[1].scope`）

- [x] 2.1 修改 `lib/events-bus.js`：`createWrappedListener` 的 subject 解析新增 `'args[1].scope'` 分支（`args[1]?.scope`），行为与既有分支一致——不匹配的非 waterfall 返回 `undefined`，不匹配的 waterfall 调用 `next()` 继续；既有的 `'args[0].agent'` 与 `null`（presence-only）分支保持不变。
- [x] 2.2 更新 `test/events-bus.test.mjs`：新增 `system-prompt/assemble` 的 scope 过滤用例（`opts.scope` 匹配时收到、不匹配时 waterfall 继续 `next()`、未传 `opts.scope` 时全局收到）；新增 `system-prompt/change` 非 scope-filtered 事件传 `opts.scope` 被忽略的用例。
- 引用：requirements §7 AC 7.4；design Components 2。

## 3. systemPrompt 直通 API 模块

- [x] 3.1 创建 `lib/system-prompt.js`：`import * as dshSystemPrompt from '@deepseek-ai/dsh-system-prompt'`，导出 `createSystemPromptApi({ systemPrompt })`，返回 `{ isActive: true, section, context, variable, tools, suppressRuntimeContext, render, renderContextSections }`。P1–P5 同参转发官方服务方法并原样返回官方 disposer；P8 调用官方公开导出 `renderPrompt(assembly)` / `renderContextSections(assembly)`。不包 try/catch、不缓存、不预校验。
- [x] 3.2 创建 `test/system-prompt-api.test.mjs`：mock 官方 `systemPrompt` 服务，断言五个方法同参转发、官方 disposer 原样返回、官方抛错原样传播（如非有限 `order`）；`render` / `renderContextSections` 用官方真实导出对同一批 assembly 做 parity 断言，并断言官方抛错（未知变量/非法引用）原样传播。
- 引用：requirements §2–§6、§9；design Components 3。

## 4. plugin-api-service 扩展（systemPrompt stub 与 mountFeature）

- [x] 4.1 修改 `lib/plugin-api-service.js`：新增 `createDisabledSystemPromptApi(active)`（`section/context/variable/tools/suppressRuntimeContext/render/renderContextSections` 先查 core inactive 抛 `PluginApiInactiveError`，再抛 `PluginApiFeatureDisabledError('systemPrompt')`；`get isActive() { return false }`）。构造函数新增 `this.systemPrompt = createDisabledSystemPromptApi(active)`；`mountFeature` 新增 `'systemPrompt'` 分支（`this.systemPrompt = api`）。
- [x] 4.2 新增 `test/plugin-api-service-system-prompt.test.mjs`：inert 与 feature-disabled 两种 stub 行为、mount 后 API 可调、未知 feature 名仍拒绝。
- 引用：requirements §1 AC 1.3；design Components 4。

## 5. feature guard 扩展（systemPrompt）

- [x] 5.1 修改 `lib/guards.js` `runFeatureGuard(featureName, ctx, deps)`：新增 `systemPrompt` 分支——probe `ctx.get('systemPrompt')` 存在且 `section/context/variable/tools/suppressRuntimeContext` 均为 function；probe `deps.dshSystemPrompt.renderPrompt` 为 function；probe `deps.dshSystemPrompt.renderContextSections` 为 function。不探测官方事件源（纯订阅方，与 events-m1 对 O* 事件的策略一致）。
- [x] 5.2 新增 `test/system-prompt-guard.test.mjs`：probe 矩阵——完整时通过；缺任一服务方法、缺 `renderPrompt`、缺 `renderContextSections` 分别 fail 且问题名可读；`systemPrompt` 失败不影响其他 feature 分支。
- 引用：requirements §1 AC 1.2、§10 AC 10.1；design Components 5。

## 6. index 挂载 + package peerDependency + 集成测试

- [x] 6.1 修改 `lib/index.js`：顶部 `import * as dshSystemPrompt from '@deepseek-ai/dsh-system-prompt'`；新增 `mountSystemPromptFeature({ ctx, service, logger })`（幂等检查 `service?.systemPrompt?.isActive === true`；`safeGet(ctx, 'systemPrompt')`；`createSystemPromptApi({ systemPrompt })`；`service.mountFeature('systemPrompt', api)`；返回 no-op disposer）；`FEATURE_MOUNTERS` 在 `web` 之后追加 `['systemPrompt', mountSystemPromptFeature]`；`runFeatureGuard` 调用处传入 `{ dshLlm, dshSystemPrompt }`。
- [x] 6.2 修改 `package.json`：`peerDependencies` 增加 `"@deepseek-ai/dsh-system-prompt": "^0.1.0-rc.6"`。
- [x] 6.3 新增 `test/index-system-prompt.test.mjs`：apply 成功挂载 `pluginApi.systemPrompt`；`systemPrompt` guard 失败时门面仍 active 且只禁用 `systemPrompt`；`mountSystemPromptFeature` 幂等重入返回 no-op；apply 永不 throw。
- 引用：requirements §1、§10 AC 10.1/10.7；design Components 6/7。

## 7. 迁移验收回归测试（dsh-pro-ex-ability-anchor 行为等价）

- [x] 7.1 新增 `test/migration-system-prompt-assemble.test.mjs`：模拟 `dsh-pro-ex-ability-anchor` 的 `system-prompt/assemble` 直接监听模式（Cordis waterfall 监听器收到 `(assembly, context, next)` 并返回替换后的 assembly）。用 mock Cordis 上下文 + `createEventsBus` + 真实官方 `renderPrompt` 验证：经 `pluginApi.events.on('system-prompt/assemble', ...)` 注册的监听器收到相同实参、返回的新 assembly 成为权威结果，且渲染结果与直接官方监听行为一致（行为等价，不修改 `dsh-pro-ex-ability-anchor` 仓库）。
- 引用：requirements §7、§10；AGENTS.md §5 迁移验收对象（`system-prompt/assemble` 直接监听 → P6 类型化瀑布）。

## 8. AGENTS.md / feature-list 同步与全量回归

- [x] 8.1 更新当前 worktree 根 `AGENTS.md`（`.worktrees/m1-system-prompt/AGENTS.md`，即本 worktree 检出的仓库根 AGENTS.md）：追加 `plugin-api-system-prompt-m1` 条目（feature 名、范围 P1–P8、状态 delivered、spec 目录 `docs/specs/plugin-api-system-prompt-m1/`、关键设计约束：P1–P5 服务直通 / P6–P7 events catalog 扩展 / P8 官方公开导出直通 / `@deepseek-ai/dsh-system-prompt` peerDependency）。该变更随 `m1/system-prompt` 分支合并进入主线；并行工作期间不直接修改主工作树 `main` 的 `AGENTS.md`，避免与其他 worktree 互相干扰。
- [x] 8.2 更新 `docs/specs/plugin-api-features/feature-list.md`：将 §2.7 的 P1–P8 状态改为 `delivered`（P6/P7 注明经 `pluginApi.events` catalog；P8 注明官方公开导出直通）。
- [x] 8.3 运行全量 `node --test`：确保新增测试与既有 foundation / facade-integrity / llm-image-admission / events-m1 回归测试全部通过；仅在 spec 范围内修复回归。
- 引用：requirements §10；design「Documentation synchronization (AGENTS.md anti-staleness)」。

---

## Requirements coverage matrix

| Requirements 章节 | 任务 |
|---|---|
| 1. Namespace availability and fail-safe activation | 4（disabled stub）、5（guard）、6（index 挂载/集成） |
| 2. Prompt section registration (P1) | 3 |
| 3. Dynamic context registration (P2) | 3 |
| 4. Prompt variable registration (P3) | 3 |
| 5. Tool schema provider registration (P4) | 3 |
| 6. Runtime context suppression (P5) | 3 |
| 7. Typed `system-prompt/assemble` waterfall (P6) | 1（catalog）、2（scope gate）、7（迁移验收） |
| 8. Typed `system-prompt/change` notification (P7) | 1、2（非 scope-filtered 忽略 scope） |
| 9. Render helpers (P8) | 3 |
| 10. Testability and regression coverage | 1–8 |
