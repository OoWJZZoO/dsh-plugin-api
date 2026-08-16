# Tasks: plugin-api-facade-integrity

> TDD：先补测试、再改实现、最后 `node --test`。任务只覆盖 `plugin-api-facade-integrity` spec（requirements 第 1–5 节）范围内的代码、测试与文档修订；不夹带 spec 外功能。实现一律在 worktree `.worktrees/m0`（分支 `m0`）的 `lib/`、`test/`、`README.md`、`docs/specs/**` 中进行。

---

## 1. Shared chain-safety helper

- [x] 1.1 **目标：新增纯模块 `lib/wrap-safety.js` 与 `test/wrap-safety.test.mjs`。**
  - 先写 `test/wrap-safety.test.mjs`，覆盖矩阵：
    - own-wrapper dispose：所有 `target[property]` 还原为 install 时记录的 original；
    - foreign-wrapper degrade：dispose 前把某一 property 换成外部 wrapper，dispose 后断言外部 wrapper 仍在、handle `isActive()===false`、原始调用被原样透传（无可观察变更）、logger.warn 被调用；
    - repeated install：同一 marker 第二次 install 返回 `alreadyWrapped` no-op，且不嵌套；
    - double dispose：第二次 dispose 为 no-op；
    - malformed target / 非函数 property：返回 `invalid`，无半截安装；
    - 多 property 中一个非法：所有 property 均未被改写。
  - 实现 `createWrapSafety({ marker })` 与 `installWrappers(specs, { logger })`，严格按 design.md Components 1 的步骤与 `mark()` descriptor 规格。
  - 零 harness 依赖。
  - 引用：requirements 2.1–2.6 / 3.1–3.5 / 5.1 / 5.4。

---

## 2. Refactor admission-bridge onto the helper

- [x] 2.1 **目标：重构 `lib/admission-bridge.js`，让 `llm/admission` 成为 `wrap-safety` 的客户端。**
  - 删除本地 `mark` / `isMarked` 实现，改用 `createWrapSafety`；决定 `ADMISSION_WRAPPER_MARKER` 的迁移方式（保留 `Symbol.for('dsh-plugin-api.llm-image-admission')` 传入 helper，或改用 helper 默认 marker 并确认回归测试仍识别为 own-wrapper）。
  - 三个 wrapper 均通过 `wrapperFactory({ original, isActive })` 创建；`isActive()===false` 时直接 `original.call(...)` 原样透传（含 prompt/selectModel 不再创建 `AsyncLocalStorage` 作用域）。
  - `installAdmissionBridge` 的返回值语义保持不变：boundaries invalid → `isActive:false`；already wrapped → `isActive:true` + no-op dispose；installed → `isActive` 由 `WrapHandle` 派生，`dispose` 委托 `WrapHandle.dispose`。
  - 跑 `test/admission-bridge.test.mjs`，**不改任何断言**，必须全部通过；其中「dispose does not tear down another plugin wrapper and degrades to transparent」用例即 requirement §4.4 的验收载体，重构后必须仍断言外部 wrapper 保持、`isActive()===false` 且原始信息未被追加 `image`。
  - 引用：requirements 2.1–2.6 / 4.1–4.4 / 5.3；等价基线 `llm-image-admission/requirements.md` §5。

---

## 3. F0.4 policy documentation and pointer

> 本任务与任务 1/2 无依赖，可与 1/2 并行执行；仅在任务 4 的全量回归前完成即可。

- [x] 3.1 **目标：更新 README 政策描述与 foundation §2 指针，并补文档断言测试。**
  - `README.md`：确认并保留“推荐入口 `inject: ['pluginApi']` + unsupported escape hatch（不拦截/不保障）”两段；如已满足，仅做最小修订以引用 `plugin-api-facade-integrity`。
  - `docs/specs/plugin-api-foundation/requirements.md` §2 增加一行指针：F0.4 权威定义见 `plugin-api-facade-integrity/requirements.md` §1。
  - 新增 `test/readme-policy.test.mjs`（或扩展现有 `test/package.test.mjs`）：断言 `README.md` 包含推荐入口与 escape hatch 措辞。
  - 跑 `node --test test/readme-policy.test.mjs`（或对应文件）。
  - 引用：requirements 1.1 / 1.3 / 1.4 / 5.2；design Components 3。

---

## 4. Full test pass and regression verification

- [x] 4.1 **目标：全量 `node --test` 通过，确认改动范围与回归基线。**
  - 运行 `node --test` 并修复全部失败。
  - 检查 `git diff --stat`：实现改动只落在 `lib/wrap-safety.js`、`lib/admission-bridge.js`、`test/**`、`README.md`、`docs/specs/plugin-api-foundation/requirements.md` 与 `docs/specs/plugin-api-facade-integrity/**`。
  - 核验 requirement §1.2：diff 中不新增任何对 `@deepseek-ai/dsh-*` 内部包的 import/inject/拦截逻辑（仅保留 README 政策措辞），据此确认逃生舱“不拦截”约束未被破坏。
  - 确认 `admission-bridge.test.mjs`、`admission-registry.test.mjs`、`projection-guard.test.mjs` 以及 `plugin-api-foundation` 的全部测试继续通过。
  - 引用：requirements 5.1 / 5.3 / 5.4。

---

## Requirements coverage

| Requirements | 任务 |
|---|---|
| 1. Recommended symbol-resolution facade | 3.1 |
| 2. Chain-safety contract | 1.1 / 2.1 |
| 3. Reusable chain-safety helper | 1.1 |
| 4. Migrate llm/admission to helper | 2.1 |
| 5. Testability and regression coverage | 1.1 / 3.1 / 4.1 |
