# Stage 3 Tasks: plugin-api-host-remote-m4

> feature_name: `plugin-api-host-remote-m4`
> 状态：Stage 3 草案（待对抗性审查与用户批准）
> 下游：Stage 4 Execute（Tasks 获批后自主执行，逐顶层大任务对抗审查）
> 上游：Stage 1 Requirements（已批准）、Stage 2 Design（已批准，含决策 D1–D6 与 recorded deviation D5）

---

## 执行约定（每批次必须遵守）

- **测试先行（TDD）**：每个实现任务先写/先跑失败测试，再实现到绿。
- **fail-safe 硬约束**：所有入口不得抛穿 `apply`；失败只记录日志并安静停用（AGENTS.md §2.6，requirements AC 4.6）。
- **共享文件 append-only**：`lib/guards.js`、`lib/index.js`、`lib/plugin-api-service.js`、`lib/errors.js` 只做契约预定位置的追加；`lib/settings-remote.js` 的 D5 refactor 是唯一 recorded deviation，需在 Stage 4 交付报告显式上报（并行契约 §2.3）。
- **不修改官方包文件**；只消费官方公开协议原语（`isTypertRemoteSegment`/`bindTypertRemote`/`Remote`/`remoteMethods` + `ctx.reflect.provide`）。
- 每个顶层大任务完成后，**阻塞等待一次子 agent 对抗性审查**再进入下一批次（AGENTS.md §3.2）。
- 全部批次完成后：全量 `node --test` 绿、`git diff --check` 通过、正式提交、交付结果报告。

---

## 1. 共享核心 `lib/remote-publication.js` + 单测

- [ ] 1.1 新建 `lib/remote-publication.js`：导出 owner 参数化核心
  - 目标：写共享核心模块，实现 design §3.1 的完整发布机制。
  - 子要点：
    - **先建错误类型（B1 依赖顺序修复）**：在 `lib/errors.js`（append-only）新增 `PluginApiRemoteError extends PluginApiError`（`code: 'PLUGIN_API_REMOTE_INVALID'`，可选带 `serviceKey`；沿用 `PluginApiSettingsNamespaceError` 先例，AC 5.7 不新增 guard schema 词汇）。该类型被本批次 1.2 与批次 2（2.1/2.2）直接抛出，因此必须在批次 1 最先落地（design §5 错误表；AC 1.2/1.6/3.1/3.2/3.3/3.5/4.1）。
    - `createRemoteOwner({ ctx, ownerName })` → `WeakMap<ctx, Map<ownerName, Map<serviceKey, RemoteRecord>>>`（D4；AC 5.6 owner 语义独立）。
    - `publishRemotePublication({ ctx, protocol, logger, owner, ownerName, serviceKey, service, methods, rehome })` → disposer，按序执行：①owner 幂等短路 → ②只读冲突探测 → ③绑定 → ④标记 → ⑤注册 → ⑥owner record 提交（design §3.1 step 1–6；AC 1.5/4.1/4.1b/2.1/2.2/2.3/4.4）。
    - **re-home 专用原型 + `dedicatedProtos` WeakSet（D2/D2b）归属共享核心**：本批次实现 rehome=true 时的专用原型创建与 `dedicatedProtos` 登记/识别（design §4.2），并导出给 `host-remote`（批次 2）复用——这样本批次 1.2 的 D2b 恢复测试不依赖批次 2 基建（M-minor-1 归属澄清）。
    - 通用 helper 下沉（从 ST4 私有函数抽出的同名等价实现）：`validateRemoteSegment`、`markRemoteMethod`、`isJsonValue`/`assertJsonValue`/`cloneJsonValue`/`isPlainObject`、`report`、`readPublishedService`（AC 1.2/3.2/2.2/3.4/4.4/4.6/4.1b/4.3）。
  - 引用需求：AC 1.2, 1.5, 1.6, 2.1, 2.2, 2.3, 3.2, 3.4, 4.1, 4.1b, 4.2, 4.3, 4.4, 5.6, 5.7。
- [ ] 1.2 新建 `test/remote-publication.test.mjs`（TDD，跑红→绿）
  - 目标：锁共享核心行为。
  - 子要点：
    - owner 参数化：同 ctx 下 `ownerName:'remote'` 与 `ownerName:'settingsRemote'` 各自 record 地图互不可见（AC 5.6）。
    - re-home 专用原型 + `protocol.remoteMethods({}) === []` 无泄漏锁定（AC 2.4）。
    - 绑定形状校验（`bindTypertRemote` 返回 `{service, serviceKey, namespace}` 且与传入一致；AC 2.1）。
    - disposer 幂等 / stale：old disposer 不撤后来者（AC 4.2/4.3）。
    - 只读冲突探测：同键同引用 → 幂等返回现有 disposer；同键异引用 → typed conflict（AC 1.5/1.6/4.1/4.1b）。
    - 注册中途失败回滚：mock `ctx.reflect.provide` 抛出 → 只回滚 own 已完成注册、日志 contained、不抛穿（AC 4.4）。
    - **D2b 中途失败恢复**：mock 一次注册失败后再对**同一已 re-home 对象**调成功发布 → 应从 `dedicatedProtos` 专用原型上的方法集恢复（`Object.keys(service)` 已空），而非当作空方法集拒绝（design §4.2 D2b 须知；AC 1.5/3.7）。
  - 引用需求：AC 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 3.7, 4.1, 4.1b, 4.2, 4.3, 4.4, 5.6。
- [ ] 1.3 全量该文件测试绿 + `git diff --check`。

（顶层大任务 1 完成 → 阻塞对抗审查）

---

## 2. host leaf `lib/host-remote.js` + 单测

- [ ] 2.1 新建 `lib/host-remote.js`：`createHostRemoteApi` / `createDisabledHostRemoteApi`
  - 目标：写 generic publish 入口，实现 design §3.2。
  - 子要点：
    - `publish(serviceKey, service)` 流程（design §3.2）：
      - inactive → `PluginApiInactiveError`；协议/原语缺失 → P2 disabled 面（AC 4.5）。
      - key 校验 `validateRemoteSegment`（AC 1.2）。
      - owner 幂等短路（同键同引用 → 返回既有 disposer，不抛/不变更；AC 1.5，堵住 B1）。
      - 形状判定（AC 3.1 × 3.7 联合契约 + B2 收窄说明，design §3.2）。
      - 提取自有方法（D1；AC 3.2 方法名 segment 校验）。
      - 签名校验 `methodParameterNames` 同款静态检查 + `signal` 最末位（AC 3.3/3.5）。
      - 冲突探测前置（read-only，re-home 之前；AC 1.6/4.1，堵住 M3）。
      - re-home 专用原型 + `dedicatedProtos` WeakSet（D2/D2b；AC 3.7/2.4）。
      - 调 `publishRemotePublication({ ownerName:'remote', rehome:false })` 返回 disposer（AC 1.1）。
    - `dispose()` 全清 own records；不包装业务方法（AC 3.6）。
  - 引用需求：AC 1.1, 1.2, 1.3, 1.5, 1.6, 2.4, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 4.5。
- [ ] 2.2 新建 `test/host-remote.test.mjs`（TDD，跑红→绿）
  - 目标：锁 generic publish 行为。
  - 子要点：
    - 形状/签名/JSON-safe 契约（D1/D2/D3；AC 3.1/3.2/3.3/3.4/3.4b/3.5）。JSON-safe 具体断言（M1，限定门面自身契约，不包装业务方法）：发布 `{ get(){ return {ok:true} }, set(settings){ return {ok:true} } }` 后，方法与参数名经 `Function.prototype.toString`/`methodParameterNames` 语义可派生、官方 descriptor 解码 clean（src-json 通道透传），且门面不替换/不包装方法体（AC 3.6）；非 JSON-safe 的 argument/result 失败交由官方传输边界，门面发布期不主动 assert——用一条断言锁「门面不包装、签名可派生」即可。
    - 幂等短路：同一对象二次发布返回既有 disposer，不抛、不变更对象（AC 1.5）。
    - 冲突前检：冲突发布不改调用方对象（AC 1.6/4.1，M3）。
    - P2 disabled 面：协议缺失时 `pluginApi.remote.isActive === false`，`publish` 抛 `PluginApiFeatureDisabledError('remote')`（AC 4.5）。
    - `dispose()` 全清。
    - 用 ST4 同款 `makeHost` 模式（mock ctx.get/ctx.reflect.provide）。
  - 引用需求：AC 1.1, 1.2, 1.3, 1.5, 1.6, 3.1, 3.2, 3.3, 3.4, 3.4b, 3.5, 3.6, 3.7, 4.5。
- [ ] 2.3 全量该文件测试绿 + `git diff --check`。

（顶层大任务 2 完成 → 阻塞对抗审查）

---

## 3. 接线：errors / guards / mounts / plugin-api-service + apply 级测试

- [ ] 3.1 `lib/errors.js` 校验 `PluginApiRemoteError`
  - 目标：确认错误类型已在批次 1 就位（B1 依赖顺序：批次 1.1 已创建），本任务仅做一致性校验。
  - 子要点：确认 `PluginApiRemoteError extends PluginApiError`（`code: 'PLUGIN_API_REMOTE_INVALID'`）存在且不新增 guard schema 词汇（AC 5.7）；其在批次 1.2/2.2/3.6 的 typed-error 断言中被间接锁定；如需则把 `PluginApiRemoteError` 的构造断言补入 `test/errors.test.mjs`（M4）。
  - 引用需求：AC 5.7, 1.2, 1.6, 4.1。
- [ ] 3.2 `lib/guards.js`（append-only）新增 `'remote'` guard 分支
  - 目标：必需 B 类 fail-closed P2 guard。
  - 子要点：探针 `ctx.get`/`ctx.reflect.provide`/`typert.isTypertRemoteSegment`/`typert.bindTypertRemote`/`typert.remoteMethods`/`typert.Remote`（**不含** `TypertRemoteService`，design §3.4）；fail-closed → P2；与 `settingsRemote` 等无关 feature 互不影响（AC 4.5）。
  - 引用需求：AC 4.5, 4.6。
- [ ] 3.3 新建 `test/remote-guard.test.mjs`（TDD）
  - 目标：锁 guard 行为。
  - 子要点：`runFeatureGuard('remote', ctx, deps)` 全探针通过 → ok；任一必需原语缺失 → P2；断言无 `TypertRemoteService` 探针；不依赖 settings 服务。
  - 引用需求：AC 4.5, 4.6。
- [ ] 3.4 `lib/index.js`（append-only）新增 `mountHostRemoteFeature` + `FEATURE_MOUNTERS.set('remote', ...)`
  - 目标：host apply 装配。
  - 子要点：`featureRegistry.isActive('remote')` 幂等短路；依赖 `typert` 激活（否则返回 null）；`createHostRemoteApi` 失败 → null（不抛穿 apply）；`prepareFeature('remote', api)` + prepared 事务边界（design §3.4，与 `mountSettingsRemoteFeature` 同构）；插入位置在 `settingsRemote` 之后。
  - 引用需求：AC 4.6, 5.6。
- [ ] 3.5 `lib/plugin-api-service.js`（append-only）新增 `remote` 表面
  - 目标：`pluginApi.remote` 顶层命名空间。
  - 子要点（design §3.4）：constructor `_remoteSurface = createDisabledHostRemoteApi(active)`；`Object.defineProperties` 加 `remote` getter；**`KNOWN_FEATURES` 增加 `'remote'`**（否则 `prepareFeature` 抛 unknown feature → 每 boot 静默禁用，B3）；`_assignFeature('remote', api)` 校验 `publish` 是函数；`_readSlot('remote')`；`_disabledSurfaceFor('remote')`；与 `settings.remote`（ST4 子面）共存互不覆盖（AC 5.4）。
  - 引用需求：AC 1.4, 4.5, 5.4, 5.6。
- [ ] 3.6 新建 `test/index-remote.test.mjs`（apply 级，TDD）
  - 目标：端到端装配测试。
  - 子要点：FEATURE_MOUNTERS 含 `'remote'` 且顺序在 settingsRemote 后；`KNOWN_FEATURES` 含 `'remote'`；`pluginApi.remote.{isActive,publish,dispose}` 表面；与 `pluginApi.settings.remote` 共存互不干扰；P2 时 `pluginApi.remote` disabled 而其余 feature 正常。
  - 引用需求：AC 1.4, 4.5, 4.6, 5.4。
- [ ] 3.7 相关全部测试绿（含新 3 个测试文件）+ `git diff --check`。

（顶层大任务 3 完成 → 阻塞对抗审查）

---

## 4. D5：ST4 `settings-remote.js` 委托共享核心（recorded deviation）

- [ ] 4.1 refactor `lib/settings-remote.js`
  - 目标：把 ST4 泛型绑定/回滚/disposer 委托到 `remote-publication.js`，settings 专用语义保留本地。
  - 子要点（design §3.3 D5）：
    - 复用共享核心的 `validateRemoteSegment`/`markRemoteMethod`/JSON-safe helpers/`readPublishedService`/`report`（删除 ST4 本地重复私有函数，行为等价）。
    - `remote(namespace, serviceKey?)` 改为经 `publishRemotePublication({ ownerName:'settingsRemote', ... })` 发布；settings 专用构造（describe 快照 / validateSetRequest → set ops）保留在本地。
    - 不改变 ST4 公开表面与既有行为（`pluginApi.settings.remote(namespace, serviceKey?)` 形状、redacted snapshot、stale/protection 语义逐一对齐）。
  - 引用需求：AC 4.1（跨 ST4 同键冲突）、5.6；Goal「与 ST4 共享既有绑定/回滚实现」。
- [ ] 4.2 ST4 回归硬闸（TDD）
  - 目标：锁 D5 refactor 无回归。
  - 子要点：`test/settings-remote.test.mjs` 全部保持绿；`test/settings-guard.test.mjs` 保持绿；`test/index-remote.test.mjs` 中与 `settings.remote` 共存用例保持绿。
  - 引用需求：AC 5.6, 5.4；并行契约 §2.3 偏差上报。
- [ ] 4.3 在**交付报告**显式上报 D5 为 recorded deviation（design.md §3.3 D5 / §8 已记录；Stage 4 不静默并入、不编辑已获批 design 文档）

（顶层大任务 4 完成 → 阻塞对抗审查）

---

## 5. 端到端可发现性 + AC 7.1 迁移契约锁定测试

- [ ] 5.1 新建端到端可发现性测试（并入 `test/index-remote.test.mjs` 或独立 `test/remote-discovery.test.mjs`）
  - 目标：AC 2.5 —— 发布后官方 gateway source-mode 能发现 endpoint 并可调用。
  - 子要点：模拟官方 gateway source-mode 遍历（读 `ctx.reflect.props` service 条目 → `ctx.get` → 读 `typertRemote` + `remoteMethods` → 组 endpoint claim）；对 `pluginApi.remote.publish('extraproAnchorConfig', { get(){}, set(settings){ return {ok:true} } })` 断言 claim 出现、方法可经官方 descriptor 路径调用；无需改 `dsh-api-remotes` 硬编码。
  - 引用需求：AC 2.5。
- [ ] 5.2 新建 AC 7.1 迁移契约锁定测试（本仓库侧，不依赖 pro-ex 仓库）
  - 目标：锁 pro-ex 迁移形状的 wire 契约。
  - 子要点：用 pro-ex 同款服务形状（`{ get() {}, set(settings) {} }`）发布；断言 `protocol.remoteMethods` 描述、wire 参数名 `settings`（`{name:'settings', wire:'settings'}` 对应）、`get` 返回 JSON-safe 快照、`set` 完整文档原子持久化语义；锁 `Function.prototype.toString` 派生不因 re-home 改变。
  - 引用需求：AC 7.1, 3.3。
- [ ] 5.3 相关测试全绿 + `git diff --check`。

（顶层大任务 5 完成 → 阻塞对抗审查）

---

## 6. 验收证据与治理登记（交付动作）

- [ ] 6.1 迁移验收证据（AC 7.1–7.3，非目的）
  - 目标：证明社区作者可直接用该入口（pro-ex 迁移）。
  - 子要点：
    - 优先执行 pro-ex `dsh-pro-ex-ability-anchor` 迁移：删除 `lib/config-remote.js`（95 行）、`lib/index.js` 中 `createExtraproAnchorConfigBridge` 的 `ctx.plugin(...)` 桥挂载块（以函数名 `createExtraproAnchorConfigBridge` 为定位锚，约 `lib/index.js:421-445`）替换为 `pluginApi.remote.publish('extraproAnchorConfig', service)`（service 由 `settingsStore`/宿主 facts 构造），面板读写行为保持（get 返回 `{value, host}`、set 原子持久化、`settings` wire 名不变）；headless 冒烟 + dev boot + panel 检查通过（AC 7.2）。若消费者仓库在窗口内不可用，按 AC 7.3 在交付报告显式记录 waive 理由（本仓库契约锁定测试 5.2 不受影响）。
  - 引用需求：AC 7.1, 7.2, 7.3。
- [ ] 6.2 治理登记
  - 目标：feature-list 与 AGENTS.md §8 同步（防过期规则）。
  - 子要点：
    - `docs/specs/plugin-api-features/feature-list.md`：§2.8 或新增 `pluginApi.remote` 小节加一行（type B / M4 / delivered，附官方源码出处，AC 6.1）；§4 迁移验收表加 `dsh-pro-ex-ability-anchor` `lib/config-remote.js`（95 行）→ `pluginApi.remote.publish('extraproAnchorConfig', …)` 一行（AC 6.2）。
    - `AGENTS.md` §8 append `plugin-api-host-remote-m4` 条目（AC 6.3）。
    - 版本号不单独 bump（AC 6.4；minor 升级归 M4 integration 定界）。
  - 引用需求：AC 6.1, 6.2, 6.3, 6.4。
- [ ] 6.3 全量回归 + 交付
  - 目标：交付门槛。
  - 子要点：全量 `node --test` 绿；`git diff --check`；正式提交（含本 spec 三文档 + 实现 + 测试 + 登记）；交付结果报告（含 D5 recorded deviation、AC 7.3 若 waive 的理由、全部 spec 修订清单）。
  - 引用需求：AC 4.6, 5.7；AGENTS.md §3.2 Stage 4 完成提交。

（顶层大任务 6 完成 → 阻塞对抗审查；全部完成后交付结果报告）

---

## 需求覆盖检查（Tasks ↔ Requirements）

| Requirements | 任务批次 |
|---|---|
| §1 表面形状（1.1–1.6） | 批次 2（2.1/2.2）+ 批次 3（3.5/3.6） |
| §2 绑定/标记/注册/发现（2.1–2.5） | 批次 1（1.1/1.2）+ 批次 5（5.1） |
| §3 形状/JSON-safe/wire（3.1–3.7） | 批次 2（2.1/2.2）+ 批次 5（5.2） |
| §4 fail-safe（4.1–4.1b, 4.2–4.6） | 批次 1（1.2）+ 批次 2（2.2）+ 批次 3（3.2/3.3/3.4/3.6）+ 批次 4（4.1/4.2） |
| §5 边界非目标（5.1–5.7） | 全批次贯穿（不实现 client/不 R 化/不覆盖 settings.remote）+ 批次 3（3.5/3.6）+ 批次 6（6.2） |
| §6 治理（6.1–6.4） | 批次 6（6.2） |
| §7 迁移证据（7.1–7.3） | 批次 5（5.2）+ 批次 6（6.1） |

> 非目标（本 spec 不实现，Tasks 亦不含）：客户端 `remote.<ns>` 原生发现（U6/C7）、任意服务发布 R 类、client 侧新 API、合成 Cordis 事件/catalog slice、patch 官方包。
