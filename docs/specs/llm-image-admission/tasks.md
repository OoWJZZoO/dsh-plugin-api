# Task Planning: llm-image-admission

> **Historical record only.** These tasks describe the superseded L1 shape. They are not
> executable follow-up work; current L2/L4 ownership and migration authority is recorded in
> `docs/specs/plugin-api-llm-request-m2/supersession.md`.
>
> **Rename/version pointer（`plugin-api-compaction-events-r1`）**：正文中的包名 `@deepseek-ai/dsh-plugin-api` / row id `plugin-api` 为主包历史记录；当前主包 `@deepseek-ai/dsh-plugin-api-main`（row id `plugin-api-main`），full version `0.1.0-rc.6-0.4` / `dsh.api: 0.4`。

> 需求引用记号：`R<section>.<criterion>`，例如 `R2.1` 表示 requirements.md 第 2 节第 1 条验收标准。
> 执行顺序：从上到下；每个任务完成后停下等待用户复核，不得自动连续执行。

## 1. Scaffolding and pure admission registry

- [x] 1.1 Create package scaffolding and bundle patch
  - Objective: create `package.json` and `cordis.patch.yml` so the host plugin can be loaded by DSH and tested with `node --test`。
  - 子要点：
    - 按 design.md「Packaging and row order」一节执行：包名 `@deepseek-ai/dsh-plugin-api`、`"type": "module"`、`main`/`exports` 指向 `lib/index.js`、`dsh.bundle.patch: "./cordis.patch.yml"`、`scripts.test: "node --test"`。
    - peerDependencies 使用宿主共享实例：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-llm`（不写普通 dependencies）。
    - `cordis.patch.yml`：insert row id `plugin-api`、name `@deepseek-ai/dsh-plugin-api`；注释写明必须在第三方插件之前加载（row 顺序）。
  - 引用：R1.1, R8.1

- [x] 1.2 TDD pure admission registry
  - Objective: 先写 `test/admission-registry.test.mjs`，再实现 `lib/admission.js`。
  - 子要点：
    - `register(intent)` 返回 `() => boolean`：内部是 `() => dispose(id)` 的包装；第一次调用返回 `true`，重复调用返回 `false`。
    - 单独测试 `dispose(id)`：存在时返回 `true` 并移除；不存在时返回 `false`；重复调用返回 `false`。
    - 非法 id 测试：空字符串 / 非字符串 / 空白字符串 → 抛 `AdmissionIntentError('INVALID_ADMISSION_ID')`。
    - 缺/非法 `match` → 抛 `AdmissionIntentError('INVALID_ADMISSION_INTENT')`；缺/非法 `project` → 抛 `AdmissionIntentError('PROJECTOR_REQUIRED')`；重复 id → 抛 `AdmissionIntentError('DUPLICATE_ADMISSION_INTENT')`；均不产生部分注册。
    - 无 intent 时 `matches()` 为 false 且 `matchingProjectors()` 为空。
    - 多 intent：OR 语义；projector 按注册顺序返回。
    - `match` 必须按同步 boolean 处理：抛错、返回 Promise/thenable 或非布尔值，均按 no-match 处理，并限流 warn：**每个 id 每 30s 最多一次**。
  - 引用：R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R4.6, R8.1

## 2. Environment guard (fail-safe)

- [x] 2.1 TDD environment guard
  - Objective: 先写 `test/guards.test.mjs`，再实现 `lib/guards.js` 的 `checkHostEnvironment`。
  - 子要点：
    - 核心契约：`ctx.plugin`、`ctx.llm.resolveModelInfo`、`ctx.agents.get`、`dshLlm.contentHasImage`、`AsyncLocalStorage`。
    - 可选契约：`apiProxy.sessions.prompt` / `sessions.selectModel`；缺失只标记可选失败，不判核心失败。
    - 测试环境变量：`DSH_PLUGIN_API_FORCE_GUARD_FAIL=1` 强制失败；`DSH_PLUGIN_API_GUARD_DISABLE=1` 跳过 guard。
    - guard 永远不抛错。
  - 引用：R1.2, R1.4, R3.6, R8.4

- [x] 2.2 Guard log and bilingual notice
  - Objective: 实现 `writeGuardLog` 与 `guardFailNotice`，并在 guard 测试中验证。
  - 子要点：
    - 覆盖写 `~/.dsh/logs/dsh-plugin-api-guard.log`（路径恒定）。
    - 前台只打一条双语提示，包含日志路径。
  - 引用：R1.2

## 3. Public service registration (before any bridge)

- [x] 3.1 Implement PluginApiService
  - Objective: 实现服务类（Cordis `Service`），暴露 `llm.admission.register(intent)` 与 `llm.admission.isActive`。
  - 子要点：
    - `register` 委托 `AdmissionRegistry`，返回 `() => boolean`（即 `dispose(id)` 的包装）。
    - `register` 的校验错误必须携带 design.md 定义的 code：`INVALID_ADMISSION_ID` / `INVALID_ADMISSION_INTENT` / `PROJECTOR_REQUIRED` / `DUPLICATE_ADMISSION_INTENT`。
    - `isActive === false` 时 `register()` 返回恒 `false` 的 no-op dispose。
  - 引用：R1.1, R1.3, R2.1, R2.2, R2.6

- [x] 3.2 Register service via ctx.plugin in apply, including guard-failure inert path
  - Objective: 在 `lib/index.js` 中实现 apply 骨架：guard 通过后创建 registry 并用 `ctx.plugin(PluginApiService)` 注册 `pluginApi` 服务。
  - 子要点：
    - 不使用 fiber ctx 上不可用的 `ctx.service()`。
    - guard 核心失败但 `ctx.plugin` 可用时：仍注册 inert `pluginApi`（`isActive === false`），然后写 guard log + 双语提示 + 正常 return；第三方插件拿到的是“功能未激活”的明确信号，而不是服务缺失错误。
    - 仅当 `ctx.plugin` 本身缺失：无法注册服务，写日志并正常 return。
  - 引用：R1.1, R1.2, R1.3

## 4. Admission bridge (scoped ModelInfo effect)

- [x] 4.1 TDD scoped resolveModelInfo wrapper
  - Objective: 先写 `test/admission-bridge.test.mjs`，再实现 `lib/admission-bridge.js`。
  - 子要点：
    - 用 mock `llm` + mock `apiProxy.sessions` 安装 bridge。
    - `AdmissionScope` 内且 intent 匹配且文本路由 → 追加 `image`；作用域外 → 与官方逐字节一致。
    - 原生已含 `image` 或 `inputModalities` 为 `undefined` → 不修改。
    - **mock 原方法抛错：断言包装后的方法原样 rethrow 同一个错误对象（不 catch、不 mask、不替换）。**
    - dispose 恢复原方法；若发现被其他插件包装，降级为透传并 warn，不拆别人的链。
    - 重复安装不嵌套（`Symbol.for('dsh-plugin-api.llm-image-admission')` 标记）。
  - 引用：R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R5.1, R5.2, R5.3, R5.4

- [x] 4.2 Wire AdmissionBridge into apply with optional apiProxy
  - Objective: 在 `lib/index.js` 的 apply 中，guard 通过后安装 AdmissionBridge（当 `apiProxy` 形状完整时）。
  - 子要点：
    - `apiProxy` 用 `ctx.get('apiProxy')` 可选获取，绝不加入 `inject`。
    - `apiProxy` 缺失/形状不符 → **统一使用 `logger.warn`**，不安装 bridge；`pluginApi` 服务仍注册，`admission.isActive === false`，`register()` 返回恒 `false` 的 no-op dispose。
    - 所有包装通过 `ctx.effect` 注册清理。
  - 引用：R1.3, R3.6, R5.4

## 5. Projection guard (model-boundary enforcement)

- [x] 5.1 TDD projection application pure logic
  - Objective: 先写 `test/projection-guard.test.mjs` 的纯逻辑部分，再实现 `lib/projection-guard.js` 中的纯函数 `applyProjectors`（该函数已在 design.md Component 5 定义）。
  - 子要点：
    - `applyProjectors(options, projectors, hasImage)`：按注册顺序应用 projector；每次执行后立即检查，无图即停并返回该结果。
    - projector 抛错 → rethrow 同一个错误。
    - 全部 projector 执行后仍含图 → throw `AdmissionProjectionError`。
  - 引用：R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R4.7, R8.3

- [x] 5.2 Implement llm/stream listener and re-entry
  - Objective: 实现同步 `ctx.on('llm/stream', listener)`，并在测试中用 mock waterfall 验证重入与 fail-closed。
  - 子要点：
    - 无 `messages` / 无图片 / `sessionId` 为空 / 无匹配 intent → `return next()`。
    - 有匹配 intent：调用 `applyProjectors`；成功且投影结果与 `options` 不同 → `return this.stream(projected)` 重入 waterfall（无图请求二进宫直通，收敛）。
    - `applyProjectors` 抛错：`logger.error` 后 rethrow，不转发、不重入死循环。
    - 图片检测使用官方 `dshLlm.contentHasImage`，测试中可注入 detector。
  - 引用：R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R4.7

- [x] 5.3 Wire ProjectionGuard into apply and dispose
  - Objective: 在 `lib/index.js` 中安装/清理 ProjectionGuard。
  - 子要点：
    - `ctx.effect` 注册 `llm/stream` 监听与 dispose。
    - guard 失败路径不安装 ProjectionGuard。
  - 引用：R4, R5.4

## 6. Syntax check and full unit test run

- [x] 6.1 Syntax check and full unit test run
  - Objective: `node --check` 所有 lib 文件；`node --test` 全绿。
  - 子要点：
    - 修复所有失败直到测试通过。
  - 引用：R8.1, R8.2, R8.3, R8.4, R8.5

## 7. Migration and automated acceptance

- [x] 7.1 Migrate dsh-read-image A1 to admission intent
  - Objective: 修改 `../dsh-read-image/lib/index.js`：删除 M1 `resolveModelInfo` monkey-patch，改为 `ctx.pluginApi.llm.admission.register({ match, project })`。
  - 子要点：
    - `match` 覆盖文本/未知路由会话；原生多模态路由不注册。
    - `project` 复用现有 `lib/runtime.js` 的 `projectRequest`。
    - 保留 dsh-read-image 自身 guard fallback：facade 不可用时安全退回官方拒绝。
  - 引用：R7.1, R7.5

- [x] 7.2 Remove dsh-read-image A2 self-owned projection boundary
  - Objective: 删除 dsh-read-image 自己的 `llm/stream` 投影监听器（M2），投影改由门面 ProjectionGuard 执行。
  - 子要点：
    - 避免双投影与重复重入；确认门面 fail-closed 语义不变。
  - 引用：R7.2

- [x] 7.3 Write and run automated migration verification script
  - Objective: 创建 `scripts/verify-migration.sh`（或 `.mjs`），一键执行单元测试、headless 冒烟、dev boot HTTP 200 检查，并运行到绿。
  - 子要点：
    - `node --test` 全绿。
    - `dsh --profile headless "请直接回复：OK"` 输出 OK 且无堆栈。
    - dev boot 就绪检查：后台 job + `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3082/` 返回 200。
    - 脚本只做自动化断言，不替代人类最终验收。
  - 引用：R7.3, R7.4, R8.5

- [x] 7.4 Fix issues found by verification until green
  - Objective: 根据 7.3 的失败输出修复代码或迁移代码，并重跑脚本直到通过。
  - 引用：R7.3, R7.4
