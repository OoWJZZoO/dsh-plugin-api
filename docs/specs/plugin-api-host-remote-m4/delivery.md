# Stage 4 Delivery: plugin-api-host-remote-m4

> feature_name: `plugin-api-host-remote-m4`
> 状态：delivered（M4 RB1 通用 host 侧 Typert Remote 发布）
> 上游：Stage 1–3 已批准（`requirements.md` / `design.md` / `tasks.md`）
> 分支：`plugin-api-host-remote-m4`（worktree：`dsh-plugin-api-host-remote-m4`）

---

## 交付范围

在 host 侧提供通用 Typert Remote 服务发布入口 `pluginApi.remote.publish(serviceKey, service)`，使社区插件的任意 JSON-safe 配置/状态服务经官方公开原语发布为 web 可消费的 Typert remote，无需手搓 `@Remote` marker / `TypertRemoteService` 子类 / `ctx.plugin` 装配。

### 实现文件（本 feature 新增/修改）

| 文件 | 角色 |
|---|---|
| `lib/remote-publication.js`（新） | 共享核心：owner 参数化绑定/标记/注册/回滚/disposer + 通用 JSON-safe/segment/marker helper |
| `lib/host-remote.js`（新） | generic publish leaf：`createHostRemoteApi` / `createDisabledHostRemoteApi` |
| `lib/settings-remote.js`（refactor，D5） | ST4 委托共享核心，settings 专用 get/set 保留本地 |
| `lib/errors.js`（append） | `PluginApiRemoteError`（`code: PLUGIN_API_REMOTE_INVALID`，可带 `serviceKey`） |
| `lib/guards.js`（append） | `remote` guard 分支（不含 `TypertRemoteService` 探针） |
| `lib/index.js`（append） | `mountHostRemoteFeature` + `FEATURE_MOUNTERS.set('remote', …)`（settingsRemote 之后） |
| `lib/plugin-api-service.js`（append） | `_remoteSurface` + `remote` getter + `KNOWN_FEATURES['remote']` + `_assignFeature/_readSlot/_disabledSurfaceFor/_unmountFeature` |
| `test/remote-publication.test.mjs` | 共享核心单测（19） |
| `test/host-remote.test.mjs` | generic publish（14） |
| `test/remote-guard.test.mjs` | guard（8） |
| `test/index-remote.test.mjs` | apply 级装配（6） |
| `test/remote-discovery.test.mjs` | 端到端 source-mode 发现（AC 2.5）+ AC 7.1 契约锁定（5） |
| `test/errors.test.mjs`（append） | `PluginApiRemoteError` 构造断言（+1） |
| `test/index*.test.mjs`（mechanical） | feature-order 断言更新（15→16，`remote` 为末项） |

### 非目标（未实现，确认边界）

- 客户端 `remote.<ns>` 原生动态发现（U6/C7）：仍为上游提案，不改 `dsh-api-remotes`。
- 任意服务发布 R 类化：`typert-gateway` 保持 capability-strategy 观察项（R 类状态未动）。
- client 侧新 API：client 零改动，继续复用 ST5/C2。
- 不覆盖 `pluginApi.settings.remote`（ST4 保持 settings 专用 owner）。

---

## 关键实现说明

1. **共享核心 owner 参数化（AC 5.6）**：`createRemoteOwner({ctx, ownerName})` 产出 `WeakMap<ctx, Map<ownerName, Map<serviceKey, record>>>`；`pluginApi.remote.publish` 用 `ownerName:'remote'`，ST4 `settings.remote` 用 `ownerName:'settingsRemote'`，两 API 各自 owner 地图 / disposer / duplicate / guard 完全独立。
2. **冲突检测（AC 1.6 / 4.1 / 4.1b）**：只读探测官方注册表（guarded `ctx.get(serviceKey)`）——同键同引用幂等短路返回既有 disposer；同键异引用 / 异 owner 同键 → typed `PluginApiRemoteError`；探测失败视为无 owner（fail-open for absence）。冲突判定在 re-home 之前，杜绝失败发布改调用方对象（M3）。
3. **re-home 专用原型（AC 2.4 / 3.7，D2/D2b）**：plain object / 外来原型对象的同函数引用搬到本 publication 专用 prototype 再打标，marker 只 key 该原型、绝不污染 `Object.prototype`；`dedicatedProtos` WeakSet 识别自身产物（再次发布不被 `isPlainObject` 误拒、D2b 中途失败恢复方法集）。
4. **wire 契约（AC 3.3 / 3.5）**：`methodParameterNames` 同款静态校验（标识符正则、唯一、无 destructuring/defaults/rest；`signal` 仅最末位），把官方 gateway 调用期 `signature-invalid` 提前到注册前；wire 参数名即方法参数名，re-home 保持同函数引用不改 `toString`。
5. **fail-safe（AC 4.4 / 4.6）**：发布中途失败只回滚 own 已完成注册、日志 contained、不抛穿 `apply`；P2 disabled 面（协议缺失）不影响其余 feature；`apply` 全路径不抛。
6. **KNOWN_FEATURES（设计 B3）**：`lib/plugin-api-service.js` 增加 `'remote'`，否则 `prepareFeature` 抛 unknown feature 使 feature 每 boot 静默禁用。

---

## 对抗性审查结果（每顶层大任务阻塞串行）

| 批次 | 结论 | 修复 |
|---|---|---|
| 1 共享核心 | PASS-WITH-MINOR | 修：`isObject` 缺失、D2b 恢复断言收紧、AC 4.3 stale-guard 真测试、binding 幂等复用、re-host 失败 typed |
| 2 host-remote | PASS-WITH-MINOR | 修：同对象异键 clear 报错、`setPrototypeOf` 失败 typed、registry-probe 冲突真测试 |
| 3 wiring | PASS | 修：`node_modules` symlink 入 `.gitignore`、index-remote 绝对末项断言、guard hostile 描述 |
| 4 ST4 D5 | PASS-WITH-MINOR | 修：namespace-aware 幂等短路（dispose 后可重发）、原型 freeze 保留（实例不 freeze，因 core 需定义 typertRemote）、`TypertRemoteService` 探针保留（guard 一致） |
| 5 e2e+contract | PASS-WITH-MINOR | 修：`sourceModeClaims` 补 `definition.type==='service'` 过滤 + 排除分支测试、AC 7.1 全文档替换语义锁定 |
| 6 governance | （本批次审查） | 见下 |

---

## recorded deviation：D5（ST4 委托共享核心）

按 `design.md §3.3 D5 / §8` 与并行契约 §2.3，`lib/settings-remote.js` 的泛型绑定/回滚/disposer 委托 `lib/remote-publication.js`：
- settings 专用构造（`describe` redacted 快照、`validateSetRequest` → set ops、`assertNamespace`）保留本地；
- `remote(namespace, serviceKey?)` 公开表面与既有测试全绿（`test/settings-remote.test.mjs` 7/7、`test/settings-guard.test.mjs`、`index-remote` 共存）；
- 本工作树不静默并入：完整记录于此并随交付报告上报，供 M4 合并期预检仲裁。

## recorded waiver：AC 7.3（pro-ex 消费者迁移）

**状态：waive（非交付目的缺失；仓库侧契约已锁）。** 理由：
- `dsh-pro-ex-ability-anchor` 工作树 `lib/index.js` 当前有另一代理的**未提交在途修改**（其他 M4 feature：`pluginApi.tools.toolAbortedError`、`pluginApi.services.shellEnv/jobs`）；
- 在其上执行 delete `lib/config-remote.js` + 替换 `ctx.plugin(...)` 块，会把这些未提交改动卷入本 feature 的迁移提交，属跨代理越界，违反并行工作流的共享边界；
- 因此本 feature 在仓库侧以 `test/remote-discovery.test.mjs` 的 AC 7.1 契约锁定测试锁定 pro-ex 形状（`get()` → `{value}` JSON-safe、`set(settings)` → `settings` wire 名、全文档替换语义、`remoteMethods` = `['get','set']` direct）——迁移可行性证据成立；消费者删文件动作待其工作树干净后按 AC 7.1–7.3 在获批 Tasks 中另行执行。
- 结论：迁移动机成立、仓库侧证据已锁；AC 7.3 允许的 waive 路径生效，交付报告显式记录。

---

## 验证

- 全量 `node --test`：**759/759 通过**（既有 706 + 新增 53：remote-publication 19、host-remote 14、remote-guard 8、index-remote 6、remote-discovery 5、errors.test 追加 1）。
- `git diff --check`：通过。
- 官方 DSH 包文件：未修改（仅只读调研，`/usr/lib/node_modules/@deepseek-ai/dsh/**` 无写操作）。
- 共享文件写入：全部 append-only（guards/index/plugin-api-service/errors）符合并行契约 §1.2；唯一非 append 为 D5（settings-remote.js，已记录）。

## 治理登记（AC 6.1–6.4）

- `docs/specs/plugin-api-features/feature-list.md`：§2.8 新增 `RB1 通用 Typert Remote host 发布`（B / M4 / delivered）；§4 迁移验收表新增 `dsh-pro-ex-ability-anchor` `lib/config-remote.js` → RB1 行（含 AC 7.3 waive 标注）。
- `AGENTS.md §8`：append `plugin-api-host-remote-m4` 条目（范围/状态/spec 目录/关键约束）。
- 版本号：本 feature 未单独 bump；minor 升级归 M4 integration 定界（AC 6.4）。

## 后续（上游/整合）

- C7（client `remote.<ns>` 原生发现）、U6（对应上游提案）保持 planned。
- `typert-gateway` R 类观察项：维持 capability-strategy 记录，未排期。
- M4 integration 合并期：本分支按并行契约归入统一波（尤其 D5 settings-remote 变更与 index*.test.mjs feature-order 断言）。
