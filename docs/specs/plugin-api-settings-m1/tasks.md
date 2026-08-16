# Feature Tasks: plugin-api-settings-m1

> 执行顺序：按编号从上到下，一次只做一个任务；每个任务先写/改测试（TDD），再改实现，最后跑 `node --test` 验证。任务全部完成后运行最终验证与登记任务。
> 所有测试使用 `node --test` + `node:assert`，mock Cordis context 与官方 settings 服务，不 boot 真 harness（最终迁移验收除外）。

---

## 1. Typed errors for settings namespace

- [x] **1.1** 在 `lib/errors.js` 中新增 `PluginApiServiceUnavailableError` 与 `PluginApiSettingsNamespaceError`
  - 目标：为 settings feature 增加两个继承 `PluginApiError` 的 typed error；补测试。
  - 子要点：
    - `PluginApiServiceUnavailableError`：code `PLUGIN_API_SERVICE_UNAVAILABLE`，携带 `service` 字段，消息可读。
    - `PluginApiSettingsNamespaceError`：code `PLUGIN_API_SETTINGS_NAMESPACE_NOT_FOUND`，携带 `ns` 字段。
    - 更新 `test/errors.test.mjs`：断言 `instanceof PluginApiError`、`code`、字段与消息。
  - 覆盖需求：AC 1.8, 2.2, 2.10, 4.8；设计 §7。

## 2. Settings feature guard

- [x] **2.1** 在 `lib/guards.js` 的 `runFeatureGuard` 中新增 `settings` 分支，并新增 `test/settings-guard.test.mjs`
  - 目标：启动期判定 settings feature 是否可用；guard 自身绝不抛。
  - 子要点：
    - 先 TDD 写 `test/settings-guard.test.mjs`：`ctx.get` 缺失 → 失败；`ctx.settings` 缺失 → 通过（可选 settings 模式）；`ctx.settings` 存在但缺 `register`/`describe`/`get`/`mutate` 任一 → 失败；`ctx.get` 抛错 → guard 不抛且按失败/通过规则处理。
    - 再实现：`probe('ctx.get', ...)`；安全读取 `ctx.get('settings')`；服务非空时逐个 probe 四个方法。
  - 覆盖需求：AC 1.7, 1.8, 2.9, 2.10, 4.7, 4.8（guard 决定 feature 是否 disabled）；设计 §6。

## 3. Disabled settings API stub and mountFeature case

- [x] **3.1** 修改 `lib/plugin-api-service.js`：新增 `createDisabledSettingsApi(active)`，构造函数挂 `this.settings`，`mountFeature` 支持 `'settings'`
  - 目标：feature 未挂载时 `pluginApi.settings` 抛 foundation 定义的 typed error，且不触碰官方服务。
  - 子要点：
    - 先更新 `test/plugin-api-service.test.mjs`：inactive 时 `settings.register/scope/describe/installSettingsSection` 抛 `PluginApiInactiveError`；active 未挂载时抛 `PluginApiFeatureDisabledError('settings')`；`mountFeature('settings', api)` 后注入真实 API；`isActive` 属性正确。
    - 再实现 stub 与 mount case。
  - 覆盖需求：AC 1.7, 2.9, 3.9, 4.7；设计 §2。

## 4. Settings event catalog entries

- [x] **4.1** 修改 `lib/events-catalog.js`：新增 `settings/updated` 与 `settings/document-updated` 两个深冻结 catalog 条目
  - 目标：`pluginApi.events.catalog` 扩展为 21 个事件名，既有 19 个条目保持不变。
  - 子要点：
    - 先更新 `test/events-catalog.test.mjs`：期望事件名列表 19 → 21；新增条目的 `name/mode/scopeFiltered/subject/args/payload/source/type/feature` 断言；深冻结断言覆盖新条目。
    - 再实现条目：`settings/updated`（`emit`, `scopeFiltered: false`, `subject: undefined`, `args: '(ns, next, prev, source)'`, `source: 'ST3'`, `type: 'A'`, `feature: 'settings'`）；`settings/document-updated`（`emit`, `scopeFiltered: false`, `args: '(ns, revision)'`, 其余同前）。
    - entry 类型注释增加可选 `feature` 字段。
  - 覆盖需求：AC 3.5, 3.6, 3.7；设计 §4。

## 5. Events bus feature gating

- [x] **5.1** 修改 `lib/events-bus.js`：`createEventsBus` 接受可选 `featureRegistry`，订阅时按 catalog entry 的 `feature` 门禁
  - 目标：settings feature 禁用时，`pluginApi.events.on/once` 订阅两个 settings 事件抛 `PluginApiFeatureDisabledError('settings')`；未传 `featureRegistry` 的既有调用行为不变。
  - 子要点：
    - 先 TDD 写 `test/events-bus.test.mjs`（或新增 `test/events-bus-settings-gating.test.mjs`）：无 `featureRegistry` 时两个 settings 事件可正常订阅/派发；有 registry 且 settings inactive 时 `on/once` 两个事件抛 feature-disabled；settings active 时正常订阅并收到官方位置参数。
    - 再实现：`subscribe` 中 catalog 命中后、注册 native hook 前检查 `meta?.feature && featureRegistry && !featureRegistry.isActive(meta.feature)` 则抛错。
  - 覆盖需求：AC 3.1–3.4, 3.8, 3.9；设计 §5。

## 6. Settings API core: register, scope, and handle

- [x] **6.1** 新建 `lib/settings.js`：实现 `createSettingsApi` 的 `register`、`scope`、`createScopeHandle`、`dispose` 与 `getSettings` 服务解析
  - 目标：门面 scope handle 完全直通官方 `SettingsScope` 与 provider 方法，`scope(ns)` 只返回门面注册过的 handle。
  - 子要点：
    - 先 TDD 写 `test/settings.test.mjs`（本任务先覆盖 register/scope/handle）：`register` 委托参数（`options` 省略与 `base/applies/validate` 透传）、返回 handle；`scope(ns)` 返回同一 handle；非门面注册 `ns` 抛 `PluginApiSettingsNamespaceError`；`get` 委托 provider `get(ns)`；`watch` 委托官方 scope（含 disposer 移除）；`update/replace` 委托官方 scope；`mutate` 委托 provider `mutate(ns, ops, expectedRevision?)`；`SettingsConflictError` 透传；官方重复/非法 `ns` 错误原样上抛。
    - 再实现：`scopes = new Map()`、`getSettings()`（`ctx.get('settings')` 不可用抛 `PluginApiServiceUnavailableError`）、`register`（官方成功后存 map）、`scope`（查 map）、`createScopeHandle`、`dispose`。
  - 覆盖需求：AC 1.1–1.6, 2.1–2.8；设计 §1。

## 7. Settings API: describe, installSettingsSection, service-unavailable paths

- [x] **7.1** 扩展 `lib/settings.js`：实现 `describe` 直通与 `installSettingsSection` 官方 helper 再导出，并补齐服务不可用错误路径
  - 目标：ST8 全部行为落地；服务不可用时 `register/scope/describe` 抛 typed error，`installSettingsSection` 保持官方 no-op fallback。
  - 子要点：
    - 先 TDD 扩展 `test/settings.test.mjs`：`describe(options?)` 直通与 `redactSecrets` 结果透传；`installSettingsSection` 为官方公共导出（或行为等价），服务缺失/从未挂载时不抛且走官方 `ctx.inject` 语义；服务不可用时 `register`/`scope`/`describe` 抛 `PluginApiServiceUnavailableError`，`installSettingsSection` 不抛。
    - 再实现：`describe(options)` 调 `getSettings().describe(options)`；`installSettingsSection` import 自 `@deepseek-ai/dsh-settings` 公共导出并原样挂到 API；在 `register`/`scope`/`describe` 复用 `getSettings()`。
  - 覆盖需求：AC 1.8, 2.10, 4.1–4.6, 4.8；设计 §1/§8。

## 8. Wire settings feature into the host plugin

- [x] **8.1** 修改 `lib/index.js`：挂载 settings feature，并把 `featureRegistry` 传给 `createEventsBus`
  - 目标：完整 apply 流程中 settings feature 就绪；events 总线具备 settings 事件门禁；apply 绝不抛。
  - 子要点：
    - 先 TDD 写 `test/index-settings.test.mjs`：mock ctx（含 `settings` 服务）下 apply 后 `service.settings.isActive === true`、五个方法可用；settings guard 失败时 `service.settings` 为 disabled stub、`pluginApi.isActive === true`、apply 不抛；重复 apply 幂等。
    - 再实现：`import { createSettingsApi } from './settings.js'`；`FEATURE_MOUNTERS` 追加 `['settings', mountSettingsFeature]`；`mountSettingsFeature` 幂等检查 `service?.settings?.isActive === true`，创建 API、`service.mountFeature('settings', settings)`，返回 `settings.dispose`；`mountEventsFeature` 增加 `featureRegistry` 入参并传给 `createEventsBus`。
  - 覆盖需求：全部 AC 的集成路径；设计 §3。

## 9. Package peerDependency for official settings helper

- [x] **9.1** 修改 `package.json` 与 `test/package.test.mjs`
  - 目标：声明 `@deepseek-ai/dsh-settings` 为 peerDependency（共享宿主实例），并锁定测试。
  - 子要点：
    - 先更新 `test/package.test.mjs`：断言 `peerDependencies['@deepseek-ai/dsh-settings']` 为字符串。
    - 再修改 `package.json`：增加 `"@deepseek-ai/dsh-settings": "^0.1.0-rc.6"`；不新增运行时 `dependencies`。
  - 覆盖需求：设计 §8；AGENTS.md §6。

## 10. Final verification and delivery registration

- [x] **10.1** 运行全量验证并同步交付登记
  - 目标：所有测试与迁移验收通过，并完成 AGENTS.md/feature-list 交付登记。
  - 子要点：
    - 运行 `node --test`（全部单测通过，不 boot 真 harness）。
    - 运行 `node --check lib/*.js`（语法检查全部通过）。
    - 运行 `scripts/verify-migration.sh`（headless smoke + dev boot readiness + 既有迁移验收；本 feature 为 A 类直通，不新增 dsh-read-image/dsh-pro-ex-ability-anchor 迁移点）。
    - 在 `.worktrees/m1-settings/AGENTS.md` 第 8 节追加 `plugin-api-settings-m1` 已交付条目；同步 `docs/specs/plugin-api-features/feature-list.md` §2.8 中 ST1/ST2/ST3/ST8 状态为 `delivered`。
    - 回写本 `tasks.md`：所有 checkbox 标记为 `[x]`。
  - 覆盖需求：AC 5.1–5.6；AGENTS.md §8 防过期登记与迁移验收。
