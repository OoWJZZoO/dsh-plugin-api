# Stage 3 - Tasks: plugin-diagnostics

## Status

Stage 3 Tasks 已通过阻塞式对抗性审查（0 blocking / 3 advisory，均已修订），待用户明确批准（SPEC3，M6 Wave A 并行 worktree `feat/m6-diagnostics`）。
契约包 = `temp/m6-parallel-contract.md`（临时编排参考，非制品）。

## 任务书定位（§6 最少字段）

- **范围**：本 feature 需求 PD-1 – PD-8 全部（见文末覆盖表）。
- **明确排除**：自动 repair/unload/reload/retry-orchestration/profile mutation；诊断 UI/命令面板/prompt feature；新的 official loader replacement（无 R）；universal env dump / raw log mirror / secret escrow（requirements Non-Goals；design §Error Handling "repair/retry/unload 请求按 out of contract 拒绝"）。
- **允许触碰文件清单**：
  - 新建 `lib/diagnostics-normalize.js`、`lib/diagnostics.js`
  - 新建 `test/diagnostics-normalize.test.mjs`、`test/diagnostics.test.mjs`、`test/diagnostics-guard.test.mjs`、`test/index-diagnostics.test.mjs`
  - 追加修改 `lib/guards.js`（仅一个 `else if (featureName === 'diagnostics')` 分支）
  - 追加修改 `lib/index.js`（仅 append `mountDiagnosticsFeature` + `FEATURE_MOUNTERS` 末尾 `['diagnostics', ...]`）
  - 追加修改 `lib/plugin-api-service.js`（disabled 工厂 + constructor 行 + `_assignFeature` 分支 + `_readSlot`/`_disabledSurfaceFor` 分支 + `KNOWN_FEATURES`）
  - 修改 `docs/specs/plugin-api-features/feature-list.md`（仅本 feature 的 §2 namespace 行 + §7 登记行）
  - 修改 `docs/specs/plugin-diagnostics/design.md`（Status 已随 Stage 2 关闭更新；实现阶段若需修订设计细节按 §3.2 Stage 4 规则处理）
  - 回写 `docs/specs/plugin-diagnostics/tasks.md`（标记 implemented + 登记偏离）
- **禁止触碰文件清单**：`/usr/lib/node_modules/@deepseek-ai/dsh/**`（零修改）；冻结文件 `lib/events-bus.js`、`lib/deep-freeze.js`、`lib/events-catalog.js`、`test/index.test.mjs`、`test/index-events.test.mjs`（如需变更记整合议题，不得私改）；任何既有 `test/index-*.test.mjs` 顺序/数量断言（`features.length === 16`、`remote` 为末项等）——由 integration owner 在 Wave C 统一维护，本 worktree **不**触碰，见 §4 偏差登记；主包 `package.json`/全量 bundle patch/版本（integration owner）；`AGENTS.md`（integration owner）。
- **依赖边界**：从 main `3278b5c`（设计已 commit）+ `2cbbfab`（temp 契约）已提交边界派生；本 feature 无硬依赖且不 mutate 他人（契约 §1/§3：只经 bounded evidence 引用 execution/usage/MCP 等）。
- **focused test 范围**：`node --test test/*diagnostics*.test.mjs`（覆盖 `diagnostics-normalize/diagnostics/diagnostics-guard/index-diagnostics` 四个新文件；显式文件参数，不递归扫描 temp/）；最终 `npm test` 全量。
- **提交边界**：Stage 4 全局终审通过后一次性完成提交（实现 + 测试 + 规格修订 + 登记），`git diff --check` 通过、工作区干净。
- **需向预检提交的证据**：focused 测试与全量 `npm test` 结果（含已知 integration-owned 断言 deltas）、`git diff --check`、工作区干净声明、官方 DSH 包零修改、治理 token 审计干净（新文件无治理魔法字母）。

## 设计决策（Stage 3 落地，供审查核对）

1. **公开面 shape（对齐 design §1/§3）**：`pluginApi.diagnostics.register({ownerId, checkId, scope, dependencies?, retry?, run}) → disposer`；`get({scope, ownerId?, audience?}) → frozen {scope, checks, state}`；`onChange({scope, ownerId?}, listener) → disposer`。三个方法都经 service `createFeatureSlot`（`methods: ['register','get','onChange']`）包装，feature 未激活抛 `PluginApiFeatureDisabledError`、核心未激活抛 `PluginApiInactiveError`（对齐 sessionRoute 槽位先例）。
2. **register 是“受控 source registration”**：只声明身份/依赖/结果更新入口（`run`），不产生任何 durable/profile mutation 面；同 `(ownerId, checkId)` 重复注册按确定性 latest-wins 只替换**本 owner** 该 id 的 generation，不得 dispose 他人检查；返回 disposer 幂等且 identity-bound（只删除本注册若其 generation 仍 current）。
3. **probe 模型（最小可用）**：注册后调度器并行调用一次 `run({signal, generation})`（同步或 Promise）；其结果经 reducer 提交为该 generation 的 committed snapshot。**不做轮询、不做依赖驱动的隐式 re-probe**；需要更新状态的检查通过再次注册（新 generation 发布新快照，PD-8 显式允许）。取消仅发生在 disposer 时（AbortController.abort）；abort/超时/抛错/reject 都是“非健康结果”：aborted/superseded 置为 explicit unknown/unavailable provenance，绝不输出健康的错误声明。重试仅在 `retry.declared === true` 且失败为 transient（抛错/reject/超时）时有界重试；permanent（invalid result）与 undeclared 一律不自动重试。
4. **facade 主机聚合检查（design Architecture“feature guards → check registry”，对齐 PD-4 证据）**：`get({scope:'host'})` 懒合并一条 ownerId `facade` / checkId `plugin-api-facade` 的主机聚合快照，来自 `coreActive + featureRegistry.snapshot()` 的**实时只读**派生（bounded evidence：各 capability 的 `{capability, active, reason?}`，reason 先脱敏）。它不存储、不拥有第二份状态（权威仍属 feature registry，api-shape §2 one-owner），不进入通知总线（消费者按需复查）。scope 为空/不可知 → 显式 `{state:'unknown', checks:[]}`，绝不返回健康声明（PD-3/PD-7）。
5. **redaction 全路径统一（design §Visibility）**：`lib/diagnostics-normalize.js` 纯函数先校验/规范化 bounded 词汇、再脱敏，产出单一 frozen snapshot；snapshot/notification/log/client 出版都只消费同一份已脱敏冻结快照，杜绝路径分叉泄漏。secrets/token/authorization/credential 等键 drop；evidence 仅允许 `{package, version, runtime, capability}` 四字段；boundedDetail 限长；nested depth 有界；脱敏/分类失败 fail-closed 为 `[redaction-failed]`。
6. **client publication 为可选 seam（design §4 “IF available”）**：owner 接受可选 `publication` 依赖（`{available(), publish(payload), onClientReport(fn)}`，仅 injected harness 提供；**本阶段不接 `service.remote`**，真实接线记整合议题，见 §4）。缺失/不兼容 → 显式 `clientAvailability:'unavailable'` + bounded reason，host 诊断保持 active；client 只能上报自身 availability（scope `client` 合成检查，health 保持 `unknown` 不撒谎）。
7. **挂着路径**：`mountDiagnosticsFeature` 走 B 类 prepared 事务路径（`service.prepareFeature('diagnostics', owner.api)` 返回 `{disposer, prepared}`），与 sessionRoute/typert 模板一致；guard 失败 → `featureRegistry.disable('diagnostics', reason)` + `featureFailNotice`（P2 disabled，现有 else 路径，不加特判）；mount/apply 任何失败都静默 inert、绝不抛穿 boot（PD-7）。

## 实现与测试任务

### 1. 纯函数规范化与脱敏（`lib/diagnostics-normalize.js`）

- [ ] 1.1 实现词汇校验/规范化纯函数：health / availability / severity / blocking / uncertainty 五组 bounded 词汇（与 design §Data Models 及契约 §2 PD 词汇完全一致）；缺失字段填中性默认（health `'unknown'`、availability `'unknown'`、severity `'info'`、blocking `'unknown'`、uncertainty `'inferred'`）；非法值 ⇒ 该条检查整体落为 `failed`/`unavailable` + `reason:{code:'invalid-result'}`，且**只影响该检查**、不波及 registry 其他条目（PD-2/PD-7）。
  - 0 harness 依赖（纯函数，零 import，AGENTS §6）。
- [ ] 1.2 实现 `redactDiagnosticValue` 纯函数：secret 键（token/secret/authorization/credential/password/api-key/cookie 等）值一律 `[redacted]`；`evidence` 仅保留 `{package, version, runtime, capability}` 四个 bounded 字段、其余键丢弃；`boundedDetail` 限长（≤ 200 字符）并剥离多行/控制符；nested depth 超过 3 折叠为 `[bounded]`；脱敏/分类过程抛错时 fail-closed 产出 `[redaction-failed]` 标记（PD-6）。
- [ ] 1.3 单元测试 `test/diagnostics-normalize.test.mjs`：
  - 五组词汇全部合法值 + 非法值回落；默认值填充；invalid-result 只作用于本检查（PD-2/PD-7）；
  - 脱敏：secret 键名/可疑值、evidence 白名单、depth 有界、`[redaction-failed]` fail-closed、audience 差异（operator 含 evidence/reason/remediation 详情 vs consumer 剔除内部细节但同样零 secret）（PD-6）。
  - 运行方式：`node --test test/diagnostics-normalize.test.mjs`。

### 2. 检查注册与所有权（`lib/diagnostics.js`，owner 骨架 A）

- [ ] 2.1 实现 `createDiagnosticsOwner({ ctx, logger, coreActive, registry, publication, probeTimeoutMs })`：
  - `register({ownerId, checkId, scope, dependencies?, retry?, run})` 入参校验（非空 ownerId/checkId、scope ∈ `{boot,host,client,plugin}`、`run` 为函数、`retry.declared` 默认 false 布尔）；非法入参时 `register` 抛出 `TypeError`（call-time，不触发 boot 路径）。
  - 登记表按 `scope → ownerId → checkId` 索引；每条记录带 opaque generation（单调序列）与 AbortController。
  - 同 `(ownerId, checkId)` 再次注册：确定性 latest-wins 只替换**该 owner 该 id** 的 generation（abort 旧 generation、旧结果标记 stale），**不得** dispose 另一 owner 的检查、不得改变其他 `(ownerId, checkId)`（PD-1）；替换发生时写一条 bounded 冲突日志（落实 PD-1 “SHALL report the conflict”，脱敏、不外泄）。
  - 返回幂等 identity-bound disposer：仅当持有的 generation 仍 current 时删除对应记录；第二次调用 no-op；不调用“新 generation 的 disposer”（PD-1/PD-8）。
  - 断言 register 不产生任何 profile/session/workspace durable 写入与 execution/usage policy（API 形状即证据，无需额外 mutation 面）（PD-1）。
- [ ] 2.2 单元测试（并入 `test/diagnostics.test.mjs`，按主题分 test 块）：
  - 稳定注册/所有权、同 owner 重复 latest-wins 只替换自身、跨 owner 隔离、重复注册后旧 generation 回调失去发布/变更权、幂等 disposer、late callback 不删除新 generation（PD-1/PD-8）。

### 3. Probe 调度 / 取消 / 超时 / 声明的重试（`lib/diagnostics.js`，owner 骨架 B）

- [ ] 3.1 实现 probe 调度器：注册后并行发起 `run({signal, generation})`（独立检查并发，互不阻塞）；结果经 1.x 规范化后交给 reducer（见任务 4）。
  - 抛错 / reject / 超时（`probeTimeoutMs`，默认 10_000ms，owner 可注入短值）→ 该检查置 `failed`/`unavailable` + `reason:{code:'probe-failed'|'probe-timeout'}`，其他检查保持可读（PD-7）。
  - `run` 不返回值（undefined）→ 置 `unknown`/`unavailable` + `reason:{code:'no-result'}` + `uncertainty:'unavailable'`，绝不输出健康声明（PD-7）。
  - 取消：disposer 触发 `controller.abort()`；被取消的 pending 结果只作为 aborted/superseded provenance（explicit `unknown`/`unavailable` + `reason:{code:'aborted'}`），绝不视为健康结果、绝不覆盖已提交终态（PD-8）。
  - 过期结果：owner/generation 不再 current 的迟到结果只保留为 bounded stale 证据（bounded log，不新增公开面），不得发布为当前状态、不得调用新 owner 的 disposer（PD-8）。
  - 重试：仅 `retry.declared === true` 且失败为 transient（抛错/reject/超时）时有界重试（默认≤2 次总尝试）；undeclared 或 permanent（invalid-result）不自动重试（PD-8）。
  - 终态纪律：同一 generation 一旦提交终态，后续信号不得改写该 generation 的 committed snapshot；新 generation（再次注册）可发布新快照（PD-8）。
- [ ] 3.2 单元测试（并入 `test/diagnostics.test.mjs`）：
  - 并行探针互不干扰；throw/reject/timeout 只影响本检查；undefined 结果显式 unknown/unavailable；abort 不产生健康结果；stale（generation 过期）不覆盖当前、不调用新 disposer；declared retry 有界重试 vs undeclared 不重试；终态后不被改写、新 generation 可发布新快照（PD-7/PD-8）。
  - 使用注入的短 `probeTimeoutMs` 与可控 run fixture 保证确定性，不依赖真实时钟休眠。

### 4. 快照 reducer / scope index / host 聚合 / audience（`lib/diagnostics.js`，owner 骨架 C）

- [ ] 4.1 实现 reducer 与提交路径：规范化后的结果首次提交记录 `firstObservedAt`、每次提交刷新 `lastUpdatedAt`（ISO 字符串）；与既有 committed snapshot 结构等价（fingerprint 比较）时 no-op（等价更新合并，PD-5 前置）。
  - 依赖清单 `dependencies` 作为**元数据**如实入快照（bounded `{id, status, evidence?}`，evidence 脱敏），不得静默拷入其他 owner/scope（PD-3）。
  - 结构化修复元数据 `remediation:{actionId, prerequisite?, mode:'manual'|'informational'}` 校验并仅作声明，**从不执行**（无任何执行面，PD-2）。
  - 生成 committed DiagnosticSnapshot 字段全集（对齐 design §Data Models；health/availability 分离；generation 为字符串 token）并 `deepFreeze`（导入冻结文件 `lib/deep-freeze.js`，不改动它）。返回对象或嵌套值任何修改都不得影响宿主状态（PD-2/PD-4）。
- [ ] 4.2 实现 scope index 查询：`get({scope, ownerId?, audience?})` 只返回该 scope（+可选 ownerId 过滤）的 committed 快照，按 `(ownerId, checkId)` 确定性排序；返回 frozen `{scope, checks, state}`，`state` 聚合规则：any `failed` ⇒ `failed`；否则 any `degraded|pending|unknown` ⇒ `degraded`；否则 checks.length>0 且全 `healthy` ⇒ `healthy`；否则（含空）⇒ `unknown`（PD-2/PD-3/PD-7）。
  - **host 聚合**：`get({scope:'host'})` 额外懒合并 ownerId `facade` 的实时派生聚合检查（见设计决策 4），其 evidence 为 registry snapshot 的 bounded 映射（脱敏后冻结），不存储、不通知（PD-3/PD-4）。
  - **audience 投影**：`audience:'operator'`（默认）含 evidence/reason(reason+detail)/remediation/uncertainty；`audience:'consumer'` 剔除内部细节（evidence、reason.detail、remediation）但保留 source/owner/timestamp/uncertainty 与 reason.code；两种投影都零 secret（PD-6）。
  - scope 非四值之一或无可判定 → 显式 empty/unknown，never healthy；scope 不是 durable storage scope 的替代（PD-3）。
- [ ] 4.3 单元测试（并入 `test/diagnostics.test.mjs`）：
  - 快照字段全集 + frozen 不可变；missing 字段默认值；invalid-result；健康/可用性分离；degraded+fallback ⇒ `degraded-active`；已加载但不可用不被标记健康（含 evidence 场景）（PD-2/PD-4/PD-6）；
  - scope 过滤 / ownerId 过滤 / 依赖作元数据不越界拷贝 / 空 scope ⇒ explicit unknown / 固定四 scope（PD-3）；
  - audience 差异与两投影零 secret（PD-6）。

### 5. 变更通知 / observer epoch / 合并 / 监听隔离（`lib/diagnostics.js`，owner 骨架 D）

- [ ] 5.1 实现通知总线：`onChange({scope, ownerId?}, listener)` 注册；listener 收到 `{snapshot, observerEpoch}`（快照为已提交 frozen snapshot 或稳定引用）。
  - observerEpoch：每次订阅独有、订阅期内稳定、可随重建/重连旋转（再订阅 = 新订阅 = 新 epoch）；同一份已提交快照可对不同 observer 携带不同 epoch；epoch 是投递侧元数据，**永不并入 committed snapshot**（PD-5，对齐 design §Data Models 注释）。
  - 合并：一个更新窗口（微任务 flush）内同一 `(ownerId, checkId)` 多次变化只投递一次、带最新快照；结构等价更新不产生通知；无 unbounded loop（PD-5）。
  - 触发条件：committed 快照的 health/availability/severity/reason/generation 任一变化即通知（PD-5）。
  - 监听隔离：某 listener throw/reject 被 contained（bounded log），其余 listener 继续（PD-5）。
  - 返回幂等 disposer，只移除本 listener（PD-1 disposer 纪律复用）。
- [ ] 5.2 单元测试（并入 `test/diagnostics.test.mjs`）：
  - 变化触发 / epoch 稳定且跨订阅不同且不进快照 / 同窗合并与等价去重 / 无循环 / listener 异常隔离 / disposer 只移除自身（PD-5）。
  - 用注入时钟/microtask flush 保证确定性。

### 6. 可选 client publication seam（`lib/diagnostics.js`，owner 骨架 E；可选注入）

- [ ] 6.1 实现可选 client publication：owner 接受 `publication`（设计决策 6）。
  - `publication.available() === true` ⇒ 出版一份 versioned + 脱敏的 client 快照（含 `version` 与 bounded redacted snapshot），并在后续 committed 变化时经 `publication.publish` 推送（复用 5.x 变化的合并语义）。
  - client 经 `publication.onClientReport(info)` 只上报自身 availability：合成 `scope:'client'`、ownerId `client`、checkId `availability` 检查，health 保持 `unknown`（不把 client 状态谎报为健康）（PD-3/PD-4/PD-6）。
  - 缺失 / `available()` 假 / `publish` 抛错 ⇒ 显式 `clientAvailability:'unavailable'` + bounded reason，**host 诊断保持 active**，不抛穿、不波及其他 feature（PD-7/design §4）。
- [ ] 6.2 单元测试（并入 `test/diagnostics.test.mjs`）：
  - 出版可用：初始 + 变化推送 versioned redacted 快照；client-only availability 上报；缺失/不兼容 publication ⇒ client unavailable + host active；出版路径零 secret（design Testing Strategy #6）。

### 7. Host 装配接线（guard / mounter / service slot）

- [ ] 7.1 `lib/guards.js`：追加一个 `else if (featureName === 'diagnostics')` 分支——唯一有意义的载荷探针 `ctx.get`（“diagnostics cannot resolve official services for host evidence”），deps 不新增；不 star 其他分支（契约 §3）。命名完全中立，无治理字母（AGENTS §6）。
- [ ] 7.2 `lib/plugin-api-service.js`（对齐 sessionRoute 槽位模板；契约 §3 共享文件写入模式，见 §4 偏差登记）：
  - `createDisabledDiagnosticsApi(active)` 工厂：`register/get/onChange` 在核心未激活抛 `PluginApiInactiveError`、feature 未激活抛 `PluginApiFeatureDisabledError('diagnostics')`（对齐 `createDisabledSessionRouteApi`）。
  - constructor：`this._diagnosticsSlot = null` + `this._diagnosticsSurface = createDisabledDiagnosticsApi(active)` + 一个 `diagnostics` getter 抛面。
  - `_assignFeature`：`if (name === 'diagnostics')` 分支——校验 api 含 `register/get/onChange` 函数（否则 `PluginApiFeatureDisabledError`），`createFeatureSlot({active, feature:'diagnostics', api, methods:['register','get','onChange'], isCurrent})`，设 slot + surface，返回 slot。
  - `_readSlot('diagnostics')` → `this._diagnosticsSlot?.api`；`_disabledSurfaceFor('diagnostics')` → `createDisabledDiagnosticsApi(this._active)`（为 prepared rollback 的 `_restoreDisabledSurface` 正确性所需）。
  - `KNOWN_FEATURES` 增加 `'diagnostics'`。
- [ ] 7.3 `lib/index.js`：
  - append `mountDiagnosticsFeature({ctx, service, featureRegistry, logger, createOwner = createDiagnosticsOwner})`：幂等信号 `featureRegistry.isActive('diagnostics')` ⇒ 返回 `() => {}`；创建 owner（注入 `coreActive: () => service.isActive`、`registry: featureRegistry`、`publication` 默认缺省）；校验 owner api/dispose 否则 dispose 并 return null；`service.prepareFeature('diagnostics', owner.api)` 返回 `{disposer, prepared}`（disposer 内 try/catch `owner.dispose()`）。不加任何 mount-loop 特判、不加 events catalog slice（契约 §3）。
  - `FEATURE_MOUNTERS` 末尾追加 `['diagnostics', mountDiagnosticsFeature]`（不改既有顺序；最终 host 顺序由 integration owner 在 Wave C 按 `execution → diagnostics → usage` 终裁）。
- [ ] 7.4 测试：
  - `test/diagnostics-guard.test.mjs`：`runFeatureGuard('diagnostics', ctx)` 正常 ctx（`ctx.get` 存在）通过；缺失 `ctx.get` 失败；不影响其他 feature 分支；`runCoreGuard` 不受影响（对齐 `remote-guard.test.mjs` 风格）。
  - `test/index-diagnostics.test.mjs`（对齐 `index-exec-route.test.mjs`/`index-remote.test.mjs` 的 createMockCtx + `apply()` 集成风格）：
    - 健康 boot：`features` 含 `diagnostics`、`pluginApi.diagnostics` 可用、register→get 落到快照、onChange 工作、host 聚合可见；
    - guard 失败（`ctx.get` 缺失或 DSH_PLUGIN_API_FORCE_GUARD_FAIL）：`features` 中 `diagnostics` disabled + bounded reason，其他 feature 仍 active，`apply` 不抛（P2 + fail-safe，PD-7）；
    - 服务/挂载失败（如 `ctx.effect` 抛错）⇒ inert：`apply` 正常返回、他 feature 状态不变（PD-7）；
    - `pluginApi.diagnostics` 在未激活时抛 typed disabled/inactive 错误，绝不静默返回健康数据。

### 8. 登记与交付验证

- [ ] 8.1 `docs/specs/plugin-api-features/feature-list.md`：追加本 feature 的 §2 namespace 小节（`pluginApi.diagnostics` 形状与三方法、词汇、scope/owner/audience/epoch 语义，含 `{scope, checks, state}` 包装与 client publication 的 clientAvailability 呈现，命名与 design §Data Models 保持一致/以 design 解释落点）与 §7 登记行（Feature=plugin-diagnostics、范围=PD-1–PD-8、状态=delivered、Spec 目录、关键约束/设计一栏）；只改本 feature 对应行（契约 §3）。
- [ ] 8.2 验证闸（契约 §7）：
  - focused：`node --test test/*diagnostics*.test.mjs` 全绿（含 `index-diagnostics.test.mjs`）；
  - 全量：`npm test`（**不裸跑 `node --test`**、不碰 temp/）——记录“已知 integration-owned 断言 deltas”（既有 `features.length === 16` 各断言与 `remote` 末项断言，因本批新增 feature 变为 integration 统一维护项），leaf-owned 测试全部绿；`git diff --check`；`governance-token-audit` 覆盖新文件零命中；官方 DSH 包零修改（`git status` 不含 `/usr/lib/node_modules/@deepseek-ai/dsh/**`）；工作区干净。
- [ ] 8.3 交付归整：
  - 回写 `tasks.md`：全部任务标记 implemented；登记本 stage 偏离（见 §4）；
  - 阻塞式全局终审（AGENTS §3.2 SPEC3 Stage 4，subagent `run_in_background:false`、只读）→ 无偏差后 Stage 4 完成提交 + 交付结果报告；
  - 无迁移验收任务：本 feature 是**新的投影面对**，无既有消费者需要迁移；design §Boundary 明确只经 bounded evidence 引用其他 feature、不 mutate，故不适用 §5 迁移验收（在报告中说明）。

## 需求 ↔ 任务覆盖表

| Requirement | 覆盖任务 |
|---|---|
| PD-1 | 2.1, 2.2 |
| PD-2 | 1.1, 1.3, 4.1, 4.3 |
| PD-3 | 4.2, 4.3, 6.1, 6.2 |
| PD-4 | 1.1, 1.3, 4.2, 4.3, 6.1 |
| PD-5 | 5.1, 5.2, 6.1 |
| PD-6 | 1.2, 1.3, 4.2, 4.3, 6.1, 6.2 |
| PD-7 | 3.1, 3.2, 4.2, 6.1, 7.4 |
| PD-8 | 2.1, 2.2, 3.1, 3.2 |

## §4 偏差与整合议题登记（Stage 3 草案占位，Stage 4 落实）

- **B1（plugin-api-service.js 分支数）**：契约 §3 文字为“disabled 工厂 + constructor 一行 + mountFeature 一个分支”；本任务按 sessionRoute 槽位模板还须 `_readSlot` / `_disabledSurfaceFor` 各一个分支（prepared 事务 rollback 的 `_restoreDisabledSurface` 正确性必需），属同一共享文件的标准逐分支追加，非跨 feature 语义变更。待用户批准。
- **B2（既有共享测试断言）**：`test/index.test.mjs`、`test/index-events.test.mjs`（冻结）及各 `index-*.test.mjs` 中的 `features.length === 16` / `remote` 末项断言，因本批任一 wave-A feature 加入 `FEATURE_MOUNTERS` 而必变；契约已声明顺序断言由 integration owner 统一维护，本 worktree **不**触碰既有测试文件（避免跨 worktree 冲突），全量 `npm test` 中的这些断言作为已知 integration-owned deltas 记录并上报。待用户批准。
- **B3（client publication 真实接线）**：本阶段只实现可选 seam + injected harness 测试，不接 `service.remote`；真实 host↔client 出版通道接线属 Wave C integration 议题（design §4 “IF available” 的落地归属），本 feature 缺省即显式 client-unavailable，host 保持 active。
- 偏离义务（契约 §5）：以上偏差与任何实现期 spec 修订都会写入本 spec 修订注记 + 交付报告显式上报；未上报的偏离预检打回。
