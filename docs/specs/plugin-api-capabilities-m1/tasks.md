# Feature Tasks: plugin-api-capabilities-m1

> Stage 4（Execute）执行清单。任务按依赖顺序排列，**一次只做一个任务**；每个任务采用 TDD：先写/改测试，再写实现，最后跑 `node --test` 全量通过。每个任务完成后按 AGENTS.md 发起对抗性审查，通过后再做下一个。
>
> 测试约束：`node --test`，mock Cordis context 与 mock 官方服务，**不 boot 真实 harness**。
>
> 迁移验收：feature-list §4 的迁移验收表没有与本 feature（SV1–SV16、SV18）对应的 dsh-read-image / dsh-pro-ex-ability-anchor hack 行，因此本 feature 无迁移验收编码任务；若执行中发现这两个插件存在对应 escape-hatch 使用，立即暂停并记录为后续 feature 的迁移验收输入。

---

## Tasks

### 1. Service definition table and its tests

- [ ] 1.1 目标：新建 `lib/services.js`，导出 `SERVICE_DEFINITIONS` 静态表，内容与 `design.md` §3.6 完全一致（17 个服务，每个含 `key` / `ctxService` / `pkg` / `members`；member 类型仅 `method` / `getter` / `forward`，`sessionTelemetry.flush` 标记 optional）。
  - 子要点：17 个 facade key 与 `requirements.md` §1 AC 1.2 完全一致；不含 `compaction`；SV15 的 `encodeSessionReferenceUri` / `decodeSessionReferenceUri` 为 `forward` 成员。
  - 引用：`requirements.md` §1 AC 1.2、§3–§19；`design.md` §3.6、§4.1。
- [ ] 1.2 目标：新建 `test/services-definitions.test.mjs`，先写测试再实现。
  - 子要点：断言 17 个 key、无 `compaction`、官方服务名映射（`workspaceRegistry` / `workflowEngine` / `sessionReferenceResolver`）、member kind 合法、SV15 两个 forward 成员存在、optional 仅 `sessionTelemetry.flush`。
  - 引用：`requirements.md` §1 AC 1.2、§17；`design.md` §3.6。

### 2. Active facade builder and passthrough tests

- [ ] 2.1 目标：在 `lib/services.js` 实现 `buildActiveFacade(def, service, uriHelpers)`，行为按 `design.md` §3.1。
  - 子要点：`method` 成员用 `service[name](...args)` 委托（保持 `this === service`、同参数、原样返回值、错误原样传播）；`getter` 成员用 `Object.defineProperty` 只读委托；`forward` 成员调用注入的 `uriHelpers` 函数；optional 成员仅在 `service[name]` 存在时挂载；返回 `Object.freeze(facade)`，facade 带 `isActive: true`。
  - 引用：`requirements.md` §2 AC 2.1–2.5；`design.md` §3.1、§4.2、§5。
- [ ] 2.2 目标：新建 `test/services-passthrough.test.mjs`，先写测试再实现。
  - 子要点：对 `SERVICE_DEFINITIONS` 全部 17 项逐一挂 mock 官方服务，验证每个 method 成员 1:1 委托（同参数、同顺序、返回值 identity）、官方方法抛错/reject 原样传播、provider/callback/对象参数不被包装；验证每个 getter 成员原样返回官方值（approval/userQuestions 的 fail-closed 专项断言由 Task 4.1 承接，见 design §6）。
  - 引用：`requirements.md` §2 AC 2.1–2.5、§3–§19、§20 AC 2/3；`design.md` §6。

### 3. Disabled facade and namespace builder and their tests

- [ ] 3.1 目标：在 `lib/services.js` 实现 `buildDisabledFacade(def, active, reason, featureCode = 'services.' + def.key)`、`createDisabledServicesNamespace(active)` 与 `createServicesNamespace({ ctx, active, logger, uriHelpers })`。
  - 子要点：disabled facade `isActive: false`，所有成员调用时先 `active()` 为 false 抛 `PluginApiInactiveError`，否则抛 `PluginApiFeatureDisabledError(featureCode, reason)`；per-service 降级使用默认 `featureCode`（`'services.<key>'`）；`createDisabledServicesNamespace` 为全部 17 个 key 构造 feature 级 disabled facade（`featureCode = 'services'`）并返回 frozen all-disabled namespace（供 Task 5 默认 namespace 与全部缺失回退复用）；`createServicesNamespace` 对每个服务独立 probe，缺失服务降级为 per-service disabled facade 并 `logger.error`，其余服务保持 active；全部缺失或 `ctx.get` 不可用时返回 all-disabled namespace；namespace 与 facade 全部 `Object.freeze`。
  - 引用：`requirements.md` §1 AC 1.1、1.3、1.5、1.6；`design.md` §3.1、§4.2–§4.4、§5。
- [ ] 3.2 目标：新建 `test/services-disabled.test.mjs` 与 `test/services-namespace.test.mjs`，先写测试再实现。
  - 子要点：断言 namespace 恰好 17 键、frozen、facade frozen、`isActive` 可观察；core inactive、feature disabled、单个服务缺失（只禁用对应 facade，其余 16 个 active）、全部服务缺失时的行为；disabled facade 不调用官方服务。
  - 引用：`requirements.md` §1 AC 1.1–1.6、§20 AC 1/4/5；`design.md` §6。

### 4. Optional member and fail-closed behavior tests

- [ ] 4.1 目标：新建 `test/services-optional-member.test.mjs` 与 `test/services-fail-closed.test.mjs`，先写测试再（如实现有缺口）修正 `lib/services.js`。
  - 子要点：optional 成员（`sessionTelemetry.flush?`）在官方对象存在/缺失两种情况下 facade 成员出现/不出现；fail-closed 测试覆盖 `approval` 的 `allowed-once|rejected|cancelled|unavailable` 四种 outcome 与 `userQuestions` 回答语义不被门面替换。
  - 引用：`requirements.md` §2 AC 2.3、§8、§9、§20 AC 6；`design.md` §3.6、§6。

### 5. PluginApi service default disabled namespace

- [ ] 5.1 目标：修改 `lib/plugin-api-service.js`：构造函数新增 `this.services = createDisabledServicesNamespace(active)`；`mountFeature('services', api)` 分支挂载 active namespace。
  - 子要点：默认 namespace 为 `createDisabledServicesNamespace(active)` 的 all-disabled 形态，17 个 facade 全部 `isActive: false` 且成员抛 typed error（feature 级错误串 `'services'`）；`mountFeature('services')` 后 `this.services` 为传入 namespace；未知 feature 仍抛 `PluginApiFeatureDisabledError`。
  - 引用：`requirements.md` §1 AC 1.5；`design.md` §3.2。
- [ ] 5.2 目标：扩展 `test/plugin-api-service.test.mjs`，先写测试再实现。
  - 子要点：断言默认 disabled namespace 的 17 键、inactive 与 feature-disabled 抛错路径、`mountFeature('services')` 生效。
  - 引用：`requirements.md` §1 AC 1.5、§20 AC 4；`design.md` §6。

### 6. Feature guard for services

- [ ] 6.1 目标：修改 `lib/guards.js` 的 `runFeatureGuard`，新增 `services` 分支：probe `ctx.get` 可用性与「17 个服务中至少一个存在」。
  - 子要点：单个服务缺失不构成 feature-level failure（留给 `createServicesNamespace` 做 per-service degradation）；未知 feature 行为保持不变。
  - 引用：`requirements.md` §1 AC 1.6；`design.md` §3.3。
- [ ] 6.2 目标：扩展 `test/guards.test.mjs`，先写测试再实现。
  - 子要点：`ctx.get` 缺失 → feature guard fail；17 个服务全缺失 → fail；部分服务缺失 → guard ok；全存在 → ok。
  - 引用：`requirements.md` §1 AC 1.6、§20 AC 5；`design.md` §6。

### 7. Host apply wiring

- [ ] 7.1 目标：修改 `lib/index.js`：实现 `mountServicesFeature({ ctx, service, featureRegistry, logger })` 并加入 `FEATURE_MOUNTERS`。
  - 子要点：幂等重入（`service.services[servicesBrand]` 已存在则返回 `() => {}`，brand 按 `design.md` §3.4）；从 `@deepseek-ai/dsh-session-reference` 仅 import `encodeSessionReferenceUri` / `decodeSessionReferenceUri` 两个公开导出并注入 `uriHelpers`；调用 `createServicesNamespace`；`service.mountFeature('services', namespace)`；返回 disposer；构建/挂载抛错时按现有 mounter 模式禁用 feature 并写日志，apply 不抛穿。
  - 引用：`requirements.md` §1 AC 1.5/1.6、§17；`design.md` §3.4、§5。
- [ ] 7.2 目标：新建 `test/index-services.test.mjs`，先写测试再实现。
  - 子要点：apply 后 `ctx.pluginApi.services` 为 active namespace；`mountServicesFeature` 抛错时 `featureRegistry` 中 `services` 为 disabled、apply 不抛；SV15 forward 成员调用注入的 mock `uriHelpers`；其余 feature（events/web/llm.admission）不受影响。
  - 引用：`requirements.md` §20 AC 4/5/7；`design.md` §6。

### 8. Package peerDependency and package test

- [ ] 8.1 目标：修改 `package.json`，在 `peerDependencies` 增加 `@deepseek-ai/dsh-session-reference`（版本范围与宿主一致）。
  - 子要点：不新增 dependencies；`dsh.api` 与现有 scripts 不变。
  - 引用：`design.md` §3.5。
- [ ] 8.2 目标：扩展 `test/package.test.mjs`，先写测试再实现。
  - 子要点：断言 peerDependencies 包含 `@deepseek-ai/dsh-session-reference`、无新增运行时 dependencies、`dsh.api` 仍为 `0.1`。
  - 引用：`requirements.md` §20 AC 7；`design.md` §3.5。

### 9. Delivered feature registration

- [ ] 9.1 目标：全部测试通过后，更新 `.worktrees/m1-capabilities/AGENTS.md` §8 已交付 feature 登记表，追加 `plugin-api-capabilities-m1` 条目；同步 `docs/specs/plugin-api-features/feature-list.md` 中 SV1–SV16、SV18 的状态为 `delivered` 并更新 API 形状列为 `pluginApi.services.<name>`。
  - 子要点：状态与关键约束描述准确（17 服务 A 类直通、frozen namespace、per-service degradation、SV15 公开导出转发）。
  - 引用：`AGENTS.md` §8；`requirements.md` §1 AC 1.2；`design.md` §8。

---

## 覆盖追溯

| requirements | tasks |
|---|---|
| §1 namespace 与只读形状 | 1, 3, 5 |
| §2 通用直通契约 | 2, 4 |
| §3–§19 各服务 | 1, 2, 4, 7 |
| §1 AC 1.5 / 1.6 fail-safe 与 per-service degradation | 3, 5, 6, 7 |
| §20 测试质量门 | 2–8 |
