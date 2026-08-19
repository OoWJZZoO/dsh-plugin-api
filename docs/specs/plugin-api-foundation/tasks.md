# Tasks: plugin-api-foundation

> **M2 supersession note:** This M0 task record remains useful for historical foundation traceability. Its old admission-bridge/projection-guard ownership is not an executable current task or contract: M2 L2 is owned solely by `lib/llm-admission-gateway.js`. Do not reintroduce that historical implementation while maintaining the F0.3 version and guard policy.
>
> **Rename/version pointer（`plugin-api-compaction-events-r1`）**：主包现名 `@deepseek-ai/dsh-plugin-api-main`（row id `plugin-api-main`），full version `0.1.0-rc.6-0.4` / `dsh.api: 0.4`；monorepo 见根 `pnpm-workspace.yaml`。本任务正文为历史执行记录。

> 说明：每个任务按 TDD 执行——先补测试、再改实现、最后跑 `node --test`。任务只覆盖 `plugin-api-foundation` spec（requirements 第 1–5 节）范围内的代码、测试与包入口；不夹带 spec 外功能。实现一律在 worktree 分支 `feature/m0-f0.1` 的 `lib/`、`test/`、`package.json`、`README.md` 中进行。

---

## 1. Typed errors and pure version contract

- [x] 1.1 **目标：新增 `lib/errors.js`，定义门面 typed errors，并写 `test/errors.test.mjs`。**
  - 实现 `PluginApiError`（base，含 `code`）与 `PluginApiInactiveError`、`PluginApiFeatureDisabledError`、`PluginApiVersionError`。
  - `PluginApiFeatureDisabledError` 必须携带 `feature` 字段；`PluginApiVersionError` 必须携带 `declared` 与 `required` 字段。
  - 测试覆盖：错误 `code`、`instanceof` 关系、可读 `message`。
  - 引用：requirements 3.5 / 3.6 / 4.9（typed errors）。

- [x] 1.2 **目标：新增纯函数 `lib/version.js` 与 `test/version.test.mjs`，实现 major.minor 契约比较。**
  - 实现 `normalizeVersion(version)`：把 `0.1.0-rc.6`、`0.1.0` 等归一为 `0.1`；非法输入返回 `null`。
  - 实现 `parseContract(contract)`：只接受 `^\d+\.\d+$`；非法返回 `null`。
  - 实现 `satisfiesContract(declared, actual)`：归一化后相等则 `true`，否则 `false`。
  - 测试覆盖：`0.1` vs `0.1.0-rc.6` 为 `true`；`0.1` vs `0.2.0` 为 `false`；缺失/不可解析返回 `null` 或 `false`（按函数契约断言）。
  - 零 harness 依赖。
  - 引用：requirements 4（Contract granularity）。

---

## 2. Pure feature state registry

- [x] 2.1 **目标：新增纯函数 `lib/feature-registry.js` 与 `test/feature-registry.test.mjs`。**
  - 实现 `createFeatureRegistry()`：`mount(name)`、`disable(name, reason)`、`snapshot()`、`isActive(name)`、`assertActive(name)`。
  - `mount`/`disable` 对同一 `name` 幂等：后写覆盖前写，`snapshot()` 始终是完整状态。
  - `assertActive(name)` 对 disabled feature 抛 `PluginApiFeatureDisabledError`。
  - 测试覆盖：初始为空、mount→active、disable→reason 可读、重复操作幂等、assert 抛错。
  - 零 harness 依赖（可依赖 `lib/errors.js`）。
  - 引用：requirements 3.3 / 3.4 / 3.5 / 3.7。

---

## 3. Layered guard framework

- [x] 3.1 **目标：重构 `lib/guards.js` 为“核心 / feature”两级 guard，并重写 `test/guards.test.mjs`。**
  - 实现 `runCoreGuard(ctx, { apiVersion, runtimeVersion })`，核心 probe 逐条对应 design Component 3：
    - `ctx.plugin`：服务注册入口；
    - `ctx.reflect.provide`：Service 构造函数所需；
    - `apiVersion` 可解析且匹配 `^\d+\.\d+$`（对应 requirements 4.4 的“`dsh.api` 缺失/不可解析”）；
    - `runtimeVersion` 的归一化比较为初始实现记录；已由 `plugin-api-m2-integration` Task 8.2 supersede 为 facade runtime portion 与 installed runtime 的完整 identity 精确比较。
    - 返回 `GuardResult { ok, skipped, problems, coreProblems, featureProblems }`。
  - 实现 `runFeatureGuard(featureName, ctx, deps)`：
    - 本 spec 只实现 `llm/admission` feature guard；必须 probe：`ctx.get('llm')?.resolveModelInfo`、`ctx.get('agents')?.get`、`deps.dshLlm.contentHasImage`、`AsyncLocalStorage`、`ctx.get('apiProxy')?.sessions.prompt/selectModel`。
    - 任一必须 probe 失败 → 该 feature guard `ok:false`，problem 记入 `featureProblems['llm/admission']`。
  - 保留 `writeGuardLog` / `guardFailNotice`（文案改为 foundation：core inert 与 feature disabled 两种 notice），保留 `DSH_PLUGIN_API_GUARD_DISABLE=1` / `DSH_PLUGIN_API_FORCE_GUARD_FAIL=1`。
  - 测试覆盖：核心通过；`ctx.plugin`/`ctx.reflect.provide` 缺失各自是 core failure；runtime 版本不匹配是 core failure；`llm.admission` 任一必需 probe 缺失只产生 feature failure 且 core 仍 ok；敌意 ctx 永不抛错；开关优先级。
  - 引用：requirements 1.3 / 3.1 / 3.2 / 3.3 / 3.7 / 4.3 / 4.4 / 4.5 / 5.3。

---

## 4. PluginApi service with version negotiation

- [x] 4.1 **目标：重写 `lib/plugin-api-service.js` 为 foundation 门面服务，并写 `test/plugin-api-service.test.mjs`。**
  - 实现模块级 `pluginApiBrand` 符号；`createPluginApiService({ apiVersion, registry, coreActive })` 返回 `PluginApiService extends Service`，并在**服务实例自身**设置品牌字段（值 = `pluginApiBrand`），供 `ctx.get('pluginApi')` 复用判定读取。
  - 实例形状：`isActive`、`apiVersion`、`features`（registry 快照）、`assertCompatible(requirement, pluginName?)`、以及 `llm.admission`（由 feature mount 注入；未 mount 时方法抛 `PluginApiFeatureDisabledError`）。
  - 状态规则：`isActive/apiVersion/features` 永远可读；core inert 时其余方法抛 `PluginApiInactiveError`；disabled feature 方法抛 `PluginApiFeatureDisabledError`；**任何方法在抛错前不得调用官方服务**。
  - `assertCompatible`：core active 且 `satisfiesContract(requirement, apiVersion)` 为 false 时抛 `PluginApiVersionError`；core inert 时抛 `PluginApiInactiveError`。
  - 测试覆盖：active / inert / feature disabled 三态；`assertCompatible` 满足/不满足/inert；抛错前无官方服务调用（用 spy 断言）。
  - 引用：requirements 1.1 / 1.2 / 2.1 / 3.5 / 3.6 / 4.7 / 4.8 / 4.9 / 5.4。

---

## 5. Host apply orchestration and feature mounting

- [x] 5.1 **目标：重构 `lib/index.js`，实现 fail-safe 编排与幂等服务注册，并写 `test/index.test.mjs`。**
  - `inject` 改为 `[]`；所有官方服务通过 `ctx.get` 在 feature guard 中探测。
  - apply 顺序：读版本契约与 runtime 版本 → `runCoreGuard` → 服务注册（品牌检测 + 幂等复用）→ core 失败路径（inert 或 no-service）→ feature 循环（guard 通过才 mount，失败只 disable + 显式日志）→ 最终 catch 兜底。
  - 服务注册幂等：`ctx.get('pluginApi')` 返回**实例上带 `pluginApiBrand` 字段**的服务则复用；返回外部同名服务则不覆盖并正常 return；否则 `ctx.plugin(createPluginApiService(...))`。
  - feature 清理：仅对 mount 成功的 feature 调用 `ctx.effect` 注册 disposer；guard 失败的 feature 不得注册清理 effect。
  - 测试（mock ctx）覆盖：core 成功 + feature 成功；core 失败（非注册原语）→ inert 服务；core 失败（注册原语缺失）→ 无服务、无全局状态；feature 失败 → 核心 active 且该 feature disabled；重复 apply → 仅一次 `provide('pluginApi')`；apply 永不 throw；**runtime 版本 mismatch（core inert）时，第三方直连 mock 内部包，门面不拦截/不包装/不改写该交互**。
  - 引用：requirements 1.1 / 1.3 / 1.4 / 2.2 / 3.1–3.8 / 4.1–4.6 / 5.3 / 5.5。

- [x] 5.2 **目标：把现有 `llm/admission` 迁移到 feature 挂载协议，保证行为不回归。**
  - 将现有 `lib/admission-bridge.js` / `lib/projection-guard.js` 的安装改为由 `runFeatureGuard('llm/admission')` 通过后调用；guard 失败时不安装任何 admission hook。
  - `ctx.pluginApi.llm.admission` 仅在 feature active 时可用；disabled 时方法抛 `PluginApiFeatureDisabledError`。
  - 保持 `AdmissionRegistry`、admission-bridge、projection-guard 的既有 fail-closed / 包装链安全语义不变。
  - 跑通现有 `test/admission-bridge.test.mjs`、`test/admission-registry.test.mjs`、`test/projection-guard.test.mjs`。
  - 引用：requirements 3.3 / 3.4 / 3.7 / 5.2；回归基线来自 `llm-image-admission` spec。

---

## 6. Package manifest and public-surface wiring

- [x] 6.1 **目标：更新 `package.json` 与根 `README.md`，完成门面公共入口的接线，并写 `test/package.test.mjs`。**
  - `package.json`：增加 `"dsh": { "api": "0.1", "bundle": { "patch": "./cordis.patch.yml" } }`；确认 `peerDependencies` 仍为共享宿主实例所需包。
  - `cordis.patch.yml`：确认 insert `id` 为 `plugin-api-main`（历史 `plugin-api`）且 `name` 指向 `@deepseek-ai/dsh-plugin-api-main`（本 feature 不改变 row 顺序，Cordis 服务 key 仍为 `pluginApi`）。
  - 根 `README.md`：写明推荐入口 `inject: ['pluginApi']`、unsupported escape hatch 边界、`isActive` / `features` / `assertCompatible` 用法。
  - `test/package.test.mjs`：断言 `package.json` 可解析、`dsh.api` 满足 `^\d+\.\d+$`、`main`/`exports` 指向 `lib/index.js`。
  - 引用：requirements 1.1 / 2.1 / 2.3 / 4.1；design 的 “Packaging and row order” 与 “User-facing documentation landing points”。

---

## 7. Full test pass and regression verification

- [x] 7.1 **目标：全量跑 `node --test`，确保所有新增与既有测试通过，且无 spec 外功能混入。**
  - 运行 `node --test` 并修复全部失败。
  - 检查 `git diff --stat`，确认**实现改动**只落在 `lib/`、`test/`、`package.json`、`README.md` 与 `docs/specs/plugin-api-foundation/**`；另有 Stage 0 已批准同步的 `AGENTS.md` 第 4.1 条与 `docs/specs/plugin-api-features/feature-list.md` 措辞修订（不属于本 feature 实现改动，仅确认内容与已批准目标一致）。
  - 确认 `llm-image-admission` 既有测试 `test/admission-bridge.test.mjs`、`test/admission-registry.test.mjs`、`test/projection-guard.test.mjs` 继续通过（与 design “Testing Strategy” 回归基线一致）。
  - 引用：requirements 5.1 / 5.2 / 5.4 / 5.5。

---

## Requirements coverage

| Requirements | 任务 |
|---|---|
| 1. Facade service registration and injection | 4.1 / 5.1 / 6.1 |
| 2. Recommended facade and unsupported escape hatch | 4.1 / 5.1 / 6.1 |
| 3. Layered fail-safe guard | 2.1 / 3.1 / 4.1 / 5.1 / 5.2 |
| 4. Bidirectional version negotiation | 1.2 / 3.1 / 4.1 / 5.1 / 6.1 |
| 5. Testability and regression coverage | 1.1–7.1 全部 |
