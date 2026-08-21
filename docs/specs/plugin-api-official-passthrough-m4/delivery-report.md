# Delivery Report — plugin-api-official-passthrough-m4

> 交付范围：M4 冻结后的全部 63 个官方透传接口 ID 的一次性对账（L11/L12、A12/A13、
> S7/S8、T11–T13、P9/P10、RB1、ST9、C10–C25、O17–O20、SV19–SV48）。本报告是
> 每个 ID 的最终交付登记：批次、公开契约、负边界、聚焦测试证据、集成证据与状态。
> 报告在集成分支 `codex/plugin-api-official-passthrough-m4` 上于 2026-08-21 完成，
> 版本边界维持 M2 integration authority：主包与全部辅助包统一 `0.1.0-rc.6-0.5` /
> `dsh.api: 0.5`（本 feature 不 bump 版本）。
>
> 证据类别按 requirements R13（unit / integration / deployed-runtime 分离）标注：
> - **unit**：`node --test` 聚焦与全量测试（headless Node 环境）。
> - **integration**：挂载后门面（`apply` 后 `ctx.pluginApi`）与 VM 打包 client bundle 的实际装配断言。
> - **deployed-runtime / dev-boot / browser**：本交付**未执行**真实 harness dev-boot、
>   浏览器环境或部署态验证；下列所有断言不构成对浏览器或部署态的任何推论。

## 1. 对账结论摘要

- 63/63 ID 全部实现并交付；无省略、无重复、无未限定范围的宽泛声明。
- 四个历史交付 ID（T11、RB1、SV19、SV20）保留原交付事实，并在本 feature 的
  delivered-regression 测试中复证（`test/delivered-regression.test.mjs`）。
- L12 与 A13 的 approved scope correction 原样保留（见 §3）。
- 全量测试 926/926 通过；`git diff --check` 干净；官方包零修改；治理 token 审计干净。

## 2. 批次与合并记录

| 批次 | 内容 | 合并/提交 |
|---|---|---|
| W0 | 中性契约 fixture（`test/official-passthrough-contracts.mjs`） | `w0-contract.md` |
| W1 host-namespaces | L11/L12/A12/A13/S7/S8/T12/T13/P9/ST9 叶子工厂 | merge `09bcbff` |
| W1 host-events | O17–O20 事件 catalog 叶子 | merge `dc624a5` |
| W1 services | SV21–SV48 中性 service-definition fragment | merge `a7df3b4` |
| W1 client | C10–C25 client 叶子 | merge `ef62804` |
| W2.1–W2.2 | 预检 + host namespace / host event join | `ebea1e3`/`0b8b9ae` |
| W2.3 | 中央服务表集成（48 key） | `5af821c` |
| W2.4 | client 叶子装配 + outer facade 接线 | `0c29a44` |
| W2.5 | P10 共享语义 + delivered 回归 + 中性集成断言 | `45e3f66` |
| W3 | 本对账报告 + feature-list/AGENTS 登记 | 本提交 |

## 3. Approved scope corrections（保留原文）

- **L12**：“L12 的‘同组官方公开工件’固定为 `contentHasImage`、`createUserMessage`
  和 `BlockAssembler` 三项；不隐含同 package 的其他导出。该修订对应 feature-list L12
  的歧义，后续 feature-list 状态同步必须保留这三个明确成员。”
- **A13**：“A13 的‘至少 provider/model，保留其他官方声明配置字段’按当前审计到的
  官方 `AgentOptions` 完整集合固定为 `provider`、`model`、`maxTokens`；不暴露 Agent、
  Session、Context、Inbox 或私有 registry 状态。若官方后续新增声明字段，必须先更新
  M4 inventory/Requirements，再改变门面范围。”

两处修正均已同步进 feature-list 的 L12/A13 行，交付面只暴露修正后的成员。

## 4. 逐 ID 对账

状态列取值：`delivered`（默认）；`delivered+回归复证` = 旧 M4 已交付且经本 feature
`test/delivered-regression.test.mjs` 复证。批次缩写：HN=W1 host-namespaces；
HE=W1 host-events；SV=W1 services（W2.3 join）；CL=W1 client（W2.4 join）；
W25=W2.5。

### 4.1 核心命名空间叶子（批次 HN）

| ID | 公开契约 | 负边界 | 聚焦证据（unit） | 集成证据（integration） | 状态 |
|---|---|---|---|---|---|
| L11 | `llm.listProviders/listConfigurableProviders/discoverModels/providerRetryPolicy/listModels/resolveCallConfig`（六方法） | 成员缺失/畸形 → feature `llm` P2；不暴露私有 registry 状态；root 门面保持 active | `test/official-host-namespaces.test.mjs`（12 项） | `integration-surface`：llm host namespace 经 apply 挂载 | delivered |
| L12 | `llm.contentHasImage/createUserMessage/BlockAssembler`（官方身份，不克隆不改写；scope correction 三成员） | 同 L11；不隐含同 package 其他导出 | 同上（identity 断言） | 同上 | delivered |
| A12 | `agent.currentInitiator/requireInitiator/withInitiator/withoutInitiator/isOwnedBy`（五方法） | 依赖缺失 → feature `agent` 局部 P2；无 live agent/registry 状态；root inactive → P1 | 同上（receiver/Promise/error/disposer identity） | 同上 | delivered |
| A13 | `agent.options` 冻结快照，精确 `{provider, model, maxTokens}`（含 `undefined` 值；scope correction） | 输入对象 getter 失败 → malformed-dependency → agent P2（非全 undefined 快照）；不暴露 live Agent/Session/Context/Inbox/registry 状态 | 同上（冻结 keys + 无 live 状态） | 同上 | delivered |
| S7 | `session.create/prepare/enter/announce/flush`（五操作） | 保持官方 session identity 与生命周期顺序；无合成 projection/业务语义 | 同上（store 操作 identity） | 同上 | delivered |
| S8 | `session.append/deriveEventMessage`（Session 实例方法） | D2：store 级 append 在 runtime `0.1.0-rc.6` 无官方公开路径 → 源缺失默认 P2（feature `session`）；无合成 durable event/projection/replay；首参不再视为任意 receiver | 同上（D2 documented limitation） | 同上 | delivered |
| T12 | `tools.executionMode(exec)` | 保留官方 missing/invalid/sync/error 结果；调用时 P2（`tools`）；不重实现执行 | 同上（D4 call-time forward） | 同上 | delivered |
| T13 | `tools.defineTool(options)` → 官方 `ToolDefinition` | 不重复/重释工具执行；访问/调用时 P2（`tools`）；访问门面不得触碰 tools 服务（懒解析） | 同上（D4 lazy require） | 同上 | delivered |
| P9 | `systemPrompt.assemble(context?)` | 保留官方 assembly 结果/参数/context/error；依赖缺失 → P2（`systemPrompt`） | 同上（assemble 委托官方方法） | 同上 | delivered |
| ST9 | `settings.writable/prepareDocument/get/update/replace/mutate` | ST9 split：`ctx.get('settings')` 缺失/抛错 → P3 `PluginApiServiceUnavailableError`（`service='settings'`）；服务存在但成员缺失/畸形 → P2（`settings`）；两者都不禁用 settings 注册/事件/root 门面 | 同上（两种条件独立测试） | 同上 | delivered |

### 4.2 宿主事件 catalog 叶子（批次 HE）

统一契约：`emit` / `scopeFiltered: false` / `scopeKey: undefined` / `fault: 'contain'` / `freeze: 'all'`。
负边界（统一）：producer 缺失/畸形 → slice 经 fail-open availability 谓词 inert
（拒绝空对象与 thenable，property-descriptor 探测，不调用 provider 成员/getter）；
无合成 producer、bridge、replay、re-emission；目录中无治理标识。

| ID | 事件契约 | 聚焦证据（unit） | 集成证据（integration） | 状态 |
|---|---|---|---|---|
| O17 | `agent-loop/config-start-failed(payload {sessionId, error})`、`agent-preset/selected(sessionId, agentPreset)`（两行） | `test/official-host-events-catalog.test.mjs`（10 项：五 slice/九行精确 metadata 与字段序、一次派发一次投递、contained listener failure、stale native-hook cleanup、missing-producer isolation） | `integration-surface`：九行契约逐字段 deepEqual 入挂载 catalog；47 基线 union 完整 | delivered |
| O18 | `cordis/dynamic-package(pkg)`、`cordis/dynamic-retract(retracted)`、`cordis/request-run(request)`、`cordis/request-run-resolved(resolved)`（四行） | 同上 | 同上 | delivered |
| O19 | `cordis/inspect-query(request)`、`cordis/inspect-query-resolved(resolved)`（两行） | 同上 | 同上 | delivered |
| O20 | `domain/changed(change: DomainChanged)`（一行；后端确认持久化后发出） | 同上 | 同上 | delivered |

### 4.3 宿主 service seam（批次 SV · W2.3 集成）

统一负边界（R8.3/R8.4）：只暴露表中成员的 whitelist；服务/成员缺失 → 该 service
facade `isActive: false`，操作抛 `PluginApiFeatureDisabledError`（`feature === 'services.<key>'`），
不影响 namespace 与其他 seam（per-service P4）。统一证据：
- unit：`test/official-service-definitions.test.mjs`（6 项）+ W0 fixture
  `test/official-passthrough-contracts.mjs`（`SERVICE_DEFINITION_CONTRACTS`：28 输入 / 113 成员）。
- integration：`test/integration-surface.test.mjs`（48 key 顺序、全 28 输入 member-kind/name
  逐一相等、48 个 active facade 的精确 member key、getter 值转发、method receiver identity）。

| ID | 公开契约 | 聚焦/集成证据要点 | 状态 |
|---|---|---|---|
| SV21 | `services.agentLoop`: config(getter), create, createAgent, resume | W0 28 输入逐项相等 + 48-key 挂载面 | delivered |
| SV22 | `services.agentPresets`: list, resolve, mount, composeFrom, composedPreset, read, copy, remove, serviceFor, recompose, standingKeyFor（11） | 同上 | delivered |
| SV23 | `services.apiProxy`: downloads(getter), respond | 同上 | delivered |
| SV24 | `services.clientModules`: graph, clientPath, rebuilt, onRebuilt, onGraphChanged（5）；与 client `modules`(C10) 分属两面 | 同上 | delivered |
| SV25 | `services.commands`: register, list, find, execute | 同上 | delivered |
| SV26 | `services.credentials`: resolve, describe, set, unset | 同上 | delivered |
| SV27 | `services.directoryPicker`: capability | 同上 | delivered |
| SV28 | `services.e2b`: cwd(getter), runtimeRoot(getter), getSandbox | 同上 | delivered |
| SV29 | `services.goals`: get, disarm, create, edit, pause, resume, complete, block, clear, remoteExportCreate（10） | 同上 | delivered |
| SV30 | `services.invariants`: register | 同上 | delivered |
| SV31 | `services.lsp`: registerProvider, query | 同上 | delivered |
| SV32 | `services.messageFeedback`: list, put, delete | 同上 | delivered |
| SV33 | `services.permissionPresets`: current, selectFor, resolve, optionOf, set（5） | 同上 | delivered |
| SV34 | `services.planMode`: get, set | 同上 | delivered |
| SV35 | `services.sandbox`: confine | 同上 | delivered |
| SV36 | `services.sandboxPolicy`: defaultMode(getter), workspaceRoot(getter), resolve, overrideOf（4） | 同上 | delivered |
| SV37 | `services.sessionPersistence`: locate, supportsRawArtifacts(getter), readRaw, create, append, prepare, load, inspect, readFrom, list, listSnapshots（11） | 同上 | delivered |
| SV38 | `services.sessionProjectionCache`: cachedSnapshot, write, coldSnapshot | 同上 | delivered |
| SV39 | `services.shell`: resolve, run, start | 同上 | delivered |
| SV40 | `services.spillStore`: saveText | 同上 | delivered |
| SV41 | `services.storageDomain`: open, get, closeAll；与 SV10 `storage.*` 分离 | 同上 | delivered |
| SV42 | `services.subprocess`: resolveExecutable, spawn, spawnTerminal | 同上 | delivered |
| SV43 | `services.terminals`: registerBackend, listBackends, spawn, hasOwnerActivity, startSend, read, signal, kill, list（9） | 同上 | delivered |
| SV44 | `services.timer`: timeout, interval(overload), throttle, debounce（保留官方 overload/返回语义） | 同上 | delivered |
| SV45 | `services.toolResultPruner`: config(getter), measureContent, pruneContent, pruneSession（4） | 同上 | delivered |
| SV46 | `services.typertGateway`: invoke | 同上 | delivered |
| SV47 | `services.webServer`: register, registerUpgrade, registerFallback, tapIndex, applyIndexTaps（5） | 同上 | delivered |
| SV48 | `services.web`: registerSearchProvider, registerFetchProvider（既有 O15）+ search, fetch（4；非第二个 service key） | D6 确认官方 `ctx.web` 成员；无 “web 缺失禁用 services” 假设 | delivered |

### 4.4 client 叶子与 outer facade（批次 CL · W2.4 集成）

统一负边界（R9.1/R9.4/R9.5）：仅 whitelist 成员；constructor/concrete-provider 成员与
同包额外导出排除；provider 缺失/畸形 → 仅该叶子 P4（namespace 保持 publishable）；
stale disposer 不得移除更新的注册；事件仅允许官方 dispatch，无合成事件。

| ID | 公开契约 | 聚焦证据（unit） | 集成证据（integration） | 状态 |
|---|---|---|---|---|
| C10 | `client.modules`: version, loadCache, import, registerStatic, prefetch, invalidate（6） | `test/client-official-services.test.mjs`（+events+connection 合并 29 项） | `integration-surface`（client services 11 面 / 70 成员逐面精确 keys + 调用性） | delivered |
| C11 | `client.locale`: getLocale, getSnapshot, subscribe, setLocale, register, bind（6） | 同上 | 同上 | delivered |
| C12 | `client.sessions`: 17 成员（R9.1 = 完整 C12 scope） | 同上 | 同上 | delivered |
| C13 | `client.workspaces`: 13 成员（R9.1 = 完整 C13 scope） | 同上 | 同上 | delivered |
| C14 | `client.chatFileMentions`: forClosing | 同上 | 同上 | delivered |
| C15 | `client.layout`: toggleSidebar, openDetails, closeDetails | 同上 | 同上 | delivered |
| C16 | `client.theme`: getTheme, exportInspectTokens, setTheme, register, overrideTokens（5；value 成员懒 getter） | 同上 | 同上 | delivered |
| C17 | `client.appShell`: renderApp | 同上 | 同上 | delivered |
| C18 | `client.sessionLogDownload`: store(value), download, dismiss, dispose（4） | 同上；聚焦回归测试构建官方 snapshot-store 形状并发起精确对象 identity 断言 | 同上 | delivered |
| C19 | `client.cordisInspect`: register, publish, query, close | 同上（disposer identity） | 同上 | delivered |
| C20 | `client.dynamicCordisRunner`: 10 成员 | 同上（stale cleanup） | 同上 | delivered |
| C21 | 事件 `locale/change(snapshot)` | `test/client-official-events.test.mjs`（事件名/参数序/payload identity/dispatch timing/listener disposer/contained failure） | `integration-surface`（四事件 face + slim `isActive`/`on`） | delivered |
| C22 | 事件 `theme/change(snapshot)` | 同上 | 同上 | delivered |
| C23 | 事件 `connection/reset(official payload)` | 同上 | 同上 | delivered |
| C24 | 事件 `command/executed(sessionId, commandName, result)` | 同上 | 同上 | delivered |
| C25 | `client.connection.api.llm`: providers, models, discoverModels（嵌套读面） | `test/client-official-connection.test.mjs`（RPC payload/signal/Promise/error 转发；fail-open 缺失 `api.llm` 仅禁用叶子，`api.settings` 与 `connection.isActive` 语义不变） | `integration-surface`（三成员精确 keys + 调用性） | delivered |

### 4.5 delivered 回归复证（批次 W25）

| ID | 公开契约 | 负边界 | 聚焦证据（unit） | 集成证据（integration） | 状态 |
|---|---|---|---|---|---|
| T11 | `tools.toolAbortedError()`：typed `HarnessError`（`code === TOOL_ABORTED`、`name='AbortError'`、`message='tool call aborted'`） | 官方常量缺失 → 降级裸 `Error`（同 name/message，无发明的 code）；feature 禁用 → P2（`code='PLUGIN_API_FEATURE_DISABLED'`、`feature='tools'`） | `test/delivered-regression.test.mjs`（typed identity / degraded factory / disabled isolation 3 项） | 经 `apply` 的挂载门面调用 | delivered+回归复证 |
| P10 | `system-prompt/assemble` 可写 waterfall：catalog `fault:'propagate'`、`freeze:'waterfall'`；`assembly.sections/contexts/tools/variables` 在 `await next()` 前后可写/可替换；`context.scope/signal` identity 保留 | 不按 observer `emit` 冻结；仅四字段可写；`monitor` 保持 contain/observer-only；无关条目 freeze/fault 策略逐条不变；无合成 `ctx.on`/bridge/re-emission | `test/system-prompt-assemble-writable.test.mjs`（10 项：前后变异、替换、veto、scope/signal identity、sync-throw/rejection 传播、monitor containment、`freezeByPolicy('waterfall')` no-op、无关事件 `freeze:'all'` 不变） | `integration-surface`（waterfall 语义经挂载 events bus；47 基线目录 union 完整） | delivered |
| RB1 | `remote.publish(serviceKey, service)`：官方 `bindTypertRemote` + `Remote` marker + `ctx.reflect.provide`；方法参数名即 wire 名；owner 作用域 disposer | 不得以新名字重实现或静默当作 untracked 新需求；不可用/畸形 → P2（`feature='remote'`）；同键冲突 typed error | `test/delivered-regression.test.mjs`（官方 boundary 发布、wire-param 校验、幂等/owner 隔离 disposer、同键冲突、缺 typert 前提降级） | 经 `apply` 发布 + 官方注册表只读探测 | delivered+回归复证 |
| SV19 | `services.jobs`: start, list, get, read, kill, wait, onJobDone, onJobsChanged, attachController（9；on*/attach 返回官方 disposer） | 不暴露 concrete-provider 私有成员；无 `jobs/*` events API；per-service P4（`services.jobs`） | `test/delivered-regression.test.mjs`（精确 9 成员、receiver identity、per-service 降级） | `integration-surface`（48-key 面） | delivered+回归复证 |
| SV20 | `services.shellEnv`: register, collect, list（3；register 返回官方 disposer） | 不暴露 registry 私有成员；无 `shellEnv/*` events API；P4（`services.shellEnv`） | `test/delivered-regression.test.mjs`（精确 3 成员、receiver identity、per-service 降级） | `integration-surface`（48-key 面） | delivered+回归复证 |

## 5. 最终验证记录

| 检查 | 结果 | 证据类别 |
|---|---|---|
| 全量测试 `node --test test/*.test.mjs` | 926/926 通过（2026-08-21 分支 tip 复核复现；含 47 基线目录 cardinality、durable 五类、既有服务 seam 与 replacement 合约回归）；`node --test`（无参，含 `packages/*/test`）1050/1050 通过 | unit |
| 中性 cardinality | catalog 8 字段 × 9 host 行；服务 48 keys / 220 members（D6 实测；W0 28 输入 / 113 成员）；client 11 services / 70 members / 4 events / 3 connection members | unit+integration |
| host/chrome boot 检查 | `integration-surface`：host `apply`（全 capability stub）与 VM 打包 client bundle `apply`（忠实浏览器 service 形状）各装配断言全绿 | integration（headless） |
| lifecycle / stale-cleanup / fail-safe | client 叶子 P4 隔离、stale disposer、reapply 幂等、remote owner disposer、feature guard 失败路径（既有测试全绿） | unit |
| provenance | 合并历史逐 join 记录；本报告前 merge `main`（b0c2fdc 基线 + 3cad40e/518e861）无冲突；worktree 干净 | 治理 |
| immutability | `/usr/lib/node_modules/@deepseek-ai/dsh/**` 自 2026-08-20 起零修改（`find -newermt` 为空） | 治理 |
| `git diff --check` | 干净 | 治理 |
| 治理 token 审计 | 自动化审计 `test/governance-token-audit.test.mjs`（AGENTS.md 示例清单 + catalog `type`/`source` 字段模式，扫描 lib/、test/、packages/*、package.json、cordis.patch.yml）零命中；M4 新增文件（lib/official-*.js、lib/client-official-*.js 及其测试、fixture）无任何治理标识 | 治理 |

> **已知负债登记（2026-08-21，W3 复核补录）**：宽口径人工扫描发现，本 feature
> 之前的既有文件注释中残留历史治理编号引用（`lib/settings-remote.js`、`lib/remote-publication.js`
> 的 ST4，`lib/services.js` 的 SV15，`lib/client-codec.js` 的 W5，`test/package.test.mjs`
> 测试名 SV15 等），均不在自动化审计清单内，亦非本 feature 新增。按 AGENTS.md「治理魔法
> 字母不进入实现代码」规则，此类既有泄漏须在后续获批维护任务中清理，不得继续新增；
> 本交付不扩大写集，仅在此登记。

浏览器 / dev-boot / deployed-runtime 证据：**未执行**。本交付仅含 unit 与 headless
integration 证据；不对真实 harness dev-boot、浏览器渲染或部署态行为作任何结论
（R13 分离声明）。客户端面以官方浏览器 service 形状的忠实 stub + VM bundle 驱动，
后续真实浏览器验证需组成 profile 后另行进行。

## 6. ID 覆盖自检

- 列出的 ID 数：4.1（10）+ 4.2（4）+ 4.3（28）+ 4.4（16）+ 4.5（5）= 63。
- 无 ID 被省略、重复或合并进更宽的未限定声明；每个 ID 都有明确的公开契约、
  负边界、聚焦证据与集成证据列。
- feature-list（`docs/specs/plugin-api-features/feature-list.md`）63 行状态同步为
  `delivered`（T11/RB1/SV19/SV20 标注旧 M4 交付 + 本 feature 回归复证）；L12/A13
  行已按 §3 保留修正后的成员清单。
- AGENTS.md §8 已追加本 feature 的 delivered 登记行。