# Stage 3 - Tasks

## Status

Stage 3 Tasks 草案，待用户确认。Stage 4 在 Tasks 获批后由代理自主完成，随后做一次全局终审。

## Scope

本 feature 在 `.worktrees/m6-mcp`（分支 `feat/m6-mcp`）上实现，契约包 = `temp/m6-parallel-contract.md`。

- **范围**：新建 R 类 replacement 辅助包 `packages/mcp/**`（运行时包名 `@deepseek-ai/dsh-plugin-api-mcp`，replacement row id `plugin-api-mcp`），唯一官方组件 owner 为 `@deepseek-ai/dsh-mcp-client`（锁定 `0.1.0-rc.6`）。该包先忠实复刻官方 host `ctx` 契约，再增加只读 catalog 与 lifecycle 投影。
- **明确排除**：主门面 `pluginApi.mcp` 条件投影不在本 worktree 交付（主包 `lib/**` 本批仅由 B feature 追加 mounter；`pluginApi.mcp` 投影的装配归属 integration，见契约 §3 与 design Component 3/5 的 “may” 授权）；不新增 `lib/events-catalog.js` / `lib/events-bus.js` 的 catalog slice（冻结）；`test/index*.mjs` 冻结不碰；不改主包 `package.json` 版本（integration owner 统一对齐）。
- **允许触碰文件**：`packages/mcp/**`（新建）、`docs/specs/mcp-catalog-lifecycle/tasks.md`（本制品）、`docs/specs/plugin-api-features/feature-list.md`（仅本 feature 对应登记行）、`AGENTS.md`（不碰）。
- **依赖边界**：派生自 main `2cbbfab`（design 已随 `3278b5c` 提交、用户已批准）；消费官方 `@deepseek-ai/dsh-mcp-client` 与其 `peerDependencies` 面。
- **focused test 范围**：本 worktree 只新增并运行 `packages/mcp/test/*.mjs`；交付前跑仓库根 `npm test`（`test/**/*.mjs`）确认全绿且不破坏既有断言（不新增 `test/` 根文件）。

## 实现前置说明（落实到任务的取舍）

- **每 server 实例语义**：与官方一致，replacement 插件的每个实例对应一个 MCP server（接受与官方 `Config` 完全相同的 per-server shape：stdio / streamable-http 两分支、`serverName` 唯一性、`toolCallTimeoutMs`、`failOnStartupError`、`reconnect`），不改变官方 config 形状（MC-1 R2）。
- **组件级共享 catalog**：catalog 状态按 `ctx.root` 共享（参考官方 `activeServerNames` 的 WeakMap 模式），首个 active 实例注册 `ctx.mcpCatalog` 服务，后续实例向同一注册表 append 自己的 server 快照；`mcp/catalog-changed` 由 replacement 自身 emit（不登记进主 facade 事件总线）。
- **双跑检测按组件整面**：boot 自检必须核查 loader 组合中**所有** `name === '@deepseek-ai/dsh-mcp-client'` 的 entry 均已 disabled、replacement row active、无重复插入、无其它 owner；任一残留即 fail-safe 停用本能力（MC-6/MC-7）。任何情况下不与官方 `mcp-client` 行双跑。
- **版本矩阵**：复用主 facade 版本协商规则（runtime 全量 `0.1.0-rc.6` + `dsh.api 0.5`）；辅助包 version 先按 `0.1.0-rc.6-0.5` 占位，最终由 integration owner 对齐；失配只停用本 MCP 能力，不波及其他 feature。
- **测试护栏**：包内测试用显式 glob `node --test "test/*.mjs"`（package.json 的 `test` script 同写法），不裸 `node --test` 防 temp/ 混入；仓库根一律 `npm test`。

## Task List

### 顶层 1：包骨架、patch 装配与版本一致性基座

- [x] **1.1 创建 `packages/mcp/` 骨架**（MC-6, MC-7）
  - 新建 `packages/mcp/package.json`：name `@deepseek-ai/dsh-plugin-api-mcp`，version `0.1.0-rc.6-0.5`（占位），`type: module`，`main: lib/apply.js`，`dsh.api: "0.5"`，`dsh.bundle.patch: "./cordis.patch.yml"`。
  - `peerDependencies` 按官方 `dsh-mcp-client` 面声明：`@deepseek-ai/dsh-mcp-client`（精确 `0.1.0-rc.6`）、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-subprocess`、`@deepseek-ai/dsh-timeout`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-invariants`、`@deepseek-ai/cordis`；`dependencies`：`@modelcontextprotocol/sdk`、`zod`、`@deepseek-ai/schemastery`（与官方一致）。
  - `scripts.test` 用 `node --test "test/*.mjs"`。
- [x] **1.2 patch 组合测试（TDD 前置）**（MC-6, MC-7; 契约 §3/§7）
  - 新建 `packages/mcp/test/patch-composition.test.mjs`，用 `composeEntries`（`@deepseek-ai/dsh-app-boot`）断言：
    - `cordis.patch.yml` 声明 `- id: mcp-client; disabled: true` 与 `- insert: [{id: plugin-api-mcp, name: '@deepseek-ai/dsh-plugin-api-mcp'}]`；
    - disable+insert 后：官方行 disabled、replacement 行 active、顺序正确；
    - 目标行缺失时 disable 子句被跳过并告警、insert 仍生效；
    - 官方行 enabled 时（仅 base layer）组合保持官方 enabled（可逆性：移除本包即还原）。
  - 创建 `packages/mcp/cordis.patch.yml`：`- id: mcp-client; disabled: true` + `- insert: [- id: plugin-api-mcp, name: '@deepseek-ai/dsh-plugin-api-mcp', config: {}]`。
- [x] **1.3 版本解析与一致性纯函数基座**（MC-7; design Component 1）
  - 实现 `packages/mcp/lib/version.js`：`parseFullVersion`（`<runtime>-<api>` 解析）、`fullVersionContractsMatch`（own/main 的 runtime + api + 各自 `dsh.api` 一致）；直接复用 `packages/compaction-events/lib/apply.js` 中同形实现的语义。
  - `packages/mcp/test/version.test.mjs`：合法/非法/失配断言（覆盖 prerelease 后缀 `0.1.0-rc.6-0.5` 与数字递增）。

### 顶层 2：官方契约忠实复刻（R2，faithful core）

- [x] **2.1 复刻 transports 与命名/schema/output/executor 纯逻辑**（MC-1, MC-4, MC-5）
  - `packages/mcp/lib/transports.js`：`buildChildEnv`（`scrubbedParentEnv` + 显式 env）、`createTransport`（stdio：command/args/env/cwd；streamable-http：URL + headers，无 secrets 进 catalog）。
  - `packages/mcp/lib/tools.js`：`MAX_PUBLIC_NAME_LENGTH=64`、`INVALID_NAME_CHARS`、`HASH_LENGTH=12`、`publicToolName`（不变名直出 `mcp__<serverName>__<rawName>`；损失归一或截断时追加 identity SHA-256 disambiguator，**绝不折叠两个 `(serverName, rawName)` 为同一 public name**）、`listToolsUncached`、`callToolUncached`（raw name + `exec.signal` + `toolCallTimeoutMs`，绝不用 public name 反解析）、`supportedOutputSchema`（`assertSupportedJsonSchema` safe fallback）、`createOutput`（canonical content/structuredContent + render）、`createExecutor`（raw-name 调用、`isError` 抛错、content/structuredContent 映射）、`extractText`（text/image/audio/resource 安全投影）。
  - `packages/mcp/test/faithful-tools.test.mjs`：public name 规范化/hash 防碰撞（两个不同 identity 产出不同 public name）、raw name wire 断言、schema fallback、output/render/extractText 的边界（缺 mimeType/text 的防御 fallback）。
- [x] **2.2 复刻分页同步与 fetch-before-swap**（MC-1, MC-3, MC-4）
  - `packages/mcp/lib/sync.js`：`syncTools(client, ctx, opts, previous)` —— 先 drain 全部 `tools/list` 分页（cursor 循环）构建完整候选 generation；重复 raw name 即拒绝；候选 fetch 成功后 dispose 上一 generation（swap phase），再逐个 `ctx.tools.register`；注册冲突回滚（已注册的全部 dispose + 可选 `throw`），绝不发布部分 generation。
  - `packages/mcp/test/sync.test.mjs`（mock client + 注册探针）：多页 drain、重复 raw name 拒绝且旧 generation 未动、fetch 失败旧 generation 保留、注册冲突回滚到空、previous disposer 幂等。
- [x] **2.3 复刻连接主管（generation / reconnect / dispose / HMR）**（MC-1, MC-5, MC-10）
  - `packages/mcp/lib/connection.js`：`RECONNECT_DEFAULTS`、`GENERATION_CLOSE_TIMEOUT_MS`、`resolveReconnectPolicy`（配置键校验、初/最大延迟、attempt 上限、frozen policy）、`startConnection(ctx, config, policy)` —— 逐次 `connectGeneration`、`syncChain` 串行化、`generationDown`、`scheduleReconnect`（bounded exponential backoff、outage 预算、exhaustion 时 unregister 并停止）、`waitForClose`、`dispose`（等待 quiescence、幂等、identity-bound disposer：旧 generation disposer 不得清掉新 generation 资源）、`failOnStartupError` 语义。
  - 构造路径可注入（transport/client 工厂 + fake timers），供测试驱动。
  - `packages/mcp/test/connection.test.mjs`：策略校验非法输入、重复失败耗尽后 unregister、稳定窗口重置预算、dispose 期间不重叠进程、startup error 语义、racing disconnect 幂等。
- [x] **2.4 official-fork-integrity 基线测试**（MC-1; 沿用 compaction-events/session-title 的 `official-fork-integrity` 模式）
  - `packages/mcp/test/official-fork-integrity.test.mjs`：对锁定官方包 `@deepseek-ai/dsh-mcp-client` 做只读基线核算（复用 checkout 源码位置、reader 调 `require('@deepseek-ai/dsh-mcp-client/package.json')`），断言本 fork 复刻的关键常量与函数行为与官方一致（公共 name 规则、reconnect 默认、config shape 键集、注入面 `name/inject`）。任何官方 identity 变化导致断言失败 = 显式失败并要求重新审计（对应 MC-8 六项阴性检查的 host 侧）。

### 顶层 3：Catalog 投影与生命周期（replacement 承载的 capability slice）

- [x] **3.1 catalog reducer 与只读投影**（MC-2, MC-4, MC-10）
  - `packages/mcp/lib/catalog.js`：`LifecycleState`（`pending | available | unavailable | disposed`，**`superseded` 永不入 lifecycleState**）、`ProvenanceSource`（`config | sync | list_changed | reconnect`）；`ServerRecord`（identity、lifecycleState、generation、transport 无 secrets、observedAt、reason code/category、provenance）、`ToolRecord`（identity、publicName、generation、description、input/output schema availability、lifecycleState、provenance）。
  - 投影 API：`servers({ includeUnavailable? })`、`tools({ serverName?, generation? })`、`resolvePublicName(publicName)`、`onChange(listener)`。所有返回深冻结、只读；查询参数仅过滤、**绝不触发注册/反注册/resync** 等副作用。
  - 根级共享注册表（`ctx.root` WeakMap）：每个 server 实例投递自己的快照，catalog 汇总为快照集。
  - `packages/mcp/test/catalog.test.mjs`：记录形状、深度 frozen（尝试写抛错）、过滤语义无副作用、resolvePublicName 正反例、unavailable/disposed 表示、`superseded` 词不进 lifecycleState。
- [x] **3.2 generation 生命周期接入**（MC-2, MC-3, MC-5）
  - `packages/mcp/lib/catalog.js` 提供 reducer 过渡函数，`connection.js` 的 `enqueueSync` / `generationDown` / exhaustion / dispose 路径分别以 `provenance`（sync / list_changed / reconnect / config）与 `lifecycleState` 更新快照：连接中 `pending` → 首代完成 `available` → 断开/失败 `unavailable(reason)` → 耗尽清除工具并 `unavailable` / dispose `disposed`；旧 generation 仅作 bounded 诊断证据保留，绝不继续被当作 current 广播。
  - 调用侧 stale guard：`createExecutor` 捕获调用起始的 generation；generation 已失效时 pending call 按 cause settle 为 unavailable/error/aborted，绝不把旧 generation 成功结果发布进新 generation，也不启动 unbounded retry。
  - `packages/mcp/test/lifecycle.test.mjs`：状态机过渡全表、stale call 结果被丢弃、disconnect during pending call 的 settle、dispose 后 catalog 终态。
- [x] **3.3 同步串行化与 racing（latest-wins）**（MC-3）
  - 每个 server 的 resync 串行化（`syncChain` 模式）；`list_changed` / 显式 resync 创建新 owner-local generation；两个 resync racing 时旧结果必须通过 generation/owner guard 失败，不得 dispose/unregister 新 generation 资源；candidate 校验通过前不得把上一 generation 标 stale。
  - `packages/mcp/test/racing.test.mjs`：并发 list_changed、旧 page/schema 结果后到、candidate 校验失败保留最后有效 generation、`list_changed` 期间 disconnect 的竞态。
- [x] **3.4 `mcp/catalog-changed` 通知与 onChange**（MC-2; 契约 §3 不新增 catalog slice）
  - catalog 每次原子发布后经 replacement 自身 `ctx.emit('mcp/catalog-changed', snapshot)` + `ctx.mcpCatalog.onChange(listener)` 订阅；payload 为深冻结只读快照；listener 抛错被包含（fail-safe，不穿 apply 不跨 listener 泄漏）。
  - `packages/mcp/test/catalog-events.test.mjs`：发布次数、快照不可变、listener 错误隔离。
- [x] **3.5 可见性与失败隔离（redaction + containment）**（MC-10）
  - catalog/日志/UI 面只含公开 tool identity、schema availability、bounded lifecycle reason；**排除** transport headers、凭据、raw env secrets、私有 command args、unbounded MCP content；无法安全分类的值直接省略并置该 server/tool 为不可用（fail-closed redaction）。
  - 单 server/transport/schema/list/call 失败隔离到该 server/generation，不 throw 穿 boot（`failOnStartupError` 官方契约保留的唯一例外）。
  - **越界拒绝（MC-10 闭环）**：replacement 不暴露 route 策略 / budget 决策 / generic tools exposure / Web UI mutation 接口；测试加显式阴性断言——这些面不可调用（调用方拿不到对应 service/方法），且 catalog/projection 操作不得突变任何其它 feature 的状态。
  - `packages/mcp/test/redaction.test.mjs`：构造带 headers/env/secrets 的 config → 断言 catalog 与日志不含这些值；一 server 故障不影响其它 server 快照；越界面不可调用/不改他 feature 状态。

### 顶层 4：Apply 入口与 boot 自检矩阵

- [x] **4.1 apply 入口：自检矩阵、服务注册、fail-safe**（MC-6, MC-7）
  - `packages/mcp/lib/apply.js`：仿 compaction-events 的 `createMcpApply(overrides)` 可注入工厂（`readPackageVersion` / `readPackageApi` / loader entry 枚举 / faithful service 构造 / fake timers），导出一致 `name = 'plugin-api-mcp'`、`inject = ['loader', 'tools']`（或官方等价面）、纯 `Config` 校验（复用官方 Config shape）。
  - 自检矩阵（全部失败 → bounded 诊断 + 正常 return，绝不静默双跑/绝不 throw 穿 apply）：
    1. loader 组合：所有 `@deepseek-ai/dsh-mcp-client` entry 已 disabled；replacement row active；无重复 `plugin-api-mcp` 插入；
    2. 组件唯一 owner：无其它 replacement 声明 `@deepseek-ai/dsh-mcp-client`；
    3. 版本 identity matrix：锁定 runtime 全量 + 官方包 identity/version + 本包与主包 `fullVersionContractsMatch`（含 prerelease）；
    4. post-register contract probe：`ctx.mcpCatalog` 服务可用、faithful `ctx.tools.register` 面可用；失败回滚并停用本能力。
  - 自检通过后：优先接管官方行语义（加载官方 `Config` 相同 shape，注册 faithful 连接 supervisor + catalog），并挂 1.2 补的 `cordis.patch.yml` 语义；身份失配只停用本 MCP 能力，主 facade 与其它 feature 不受波及。
  - `packages/mcp/test/apply.test.mjs`：全矩阵失败路径（target 未禁用、replacement 缺失、重复插入、owner 冲突、runtime/官方包/主包版本失配、post-register 探针失败）、成功路径、fail-safe 不 throw、不双跑断言。
- [x] **4.2 六项 client 阴性检查回归 fixture**（MC-8; 契约 §7 MCP 加测）
  - `packages/mcp/test/client-surface-audit.test.mjs`：以锁定官方包为输入，断言六项 client 检查全为阴性——无 `dsh.client` manifest、无 remote namespace、无 slot/settings bridge、无 host/client 版本协商、无 browser-side state/reconnect 面、无 client-facing event/service；任一变阳性 → 显式失败并要求 Requirements/Design 六步复审后再启用 client replacement。

### 顶层 5：装配冒烟、登记与验证闸

- [x] **5.1 完整装配冒烟**（MC-6; 契约 §7 MCP 加测）
  - `packages/mcp/test/assembly-guards.test.mjs`：组合 base layer + 本包 patch 用 `composeEntries` 断言最终组合（官方禁、替代活、无重复）；带官方 enabled 的输入断言自检拒斥（不双跑）；identity matrix 失配时仅 MCP 能力停用、主 facade `plugin-api-main` 行保持——若主 facade 不可在包内实例化，退化为对 `fullVersionContractsMatch` + `composeEntries` 组合级断言并在测试内注明。
- [x] **5.2 feature 登记（U-series + replacement 行）**（MC-9; 契约 §3）
  - 在 `docs/specs/plugin-api-features/feature-list.md` §3 U-series 表追加一行：提案覆盖官方 MCP catalog/lifecycle seam（generation、list-change、availability、identity、stale cleanup），并标注本 replacement 为 current workaround 与**显式退役条件**（官方 `dsh-mcp-client` 提供等价公共 catalog/lifecycle 契约时 deprecate/退役、消费者迁移官方 seam、本包停止发布重复语义）；在 §3.1 R 类登记表追加一行（运行时名 `plugin-api-mcp`，owner `@deepseek-ai/dsh-mcp-client`，U-series 引用）。
  - 本文件 `tasks.md` 执行注同步为“Stage 4 获批后由代理自主要完成 + 全局终审”并引用 AGENTS.md §3.2。
- [x] **5.3 验证闸与提交**（契约 §6/§7）
  - 在 `.worktrees/m6-mcp` 内运行 `node --test "test/*.mjs"`（包内）并回仓库根跑 `npm test` 全绿；`git diff --check` 通过；工作区干净；官方 `@deepseek-ai/dsh-mcp-client` 与其所在官方安装目录零修改审计（`git` 外显式声明未触碰 `/usr/lib/node_modules/@deepseek-ai/**`）；Stage 4 完成提交落到 `feat/m6-mcp`，等 integration owner 合并。

## Requirements Coverage

| Requirement | Tasks |
|---|---|
| MC-1 | 1.1, 2.1, 2.2, 2.3, 2.4 |
| MC-2 | 3.1, 3.4 |
| MC-3 | 2.2, 3.2, 3.3 |
| MC-4 | 2.1, 2.2, 3.1 |
| MC-5 | 2.1, 2.3, 3.2 |
| MC-6 | 1.2, 4.1, 5.1 |
| MC-7 | 1.2, 1.3, 4.1, 5.1 |
| MC-8 | 4.2 |
| MC-9 | 5.2 |
| MC-10 | 2.1, 2.3, 3.1, 3.5 |

## 偏离义务

本批并行契约（`temp/m6-parallel-contract.md`）规定任何偏离必须写入本 worktree 的 spec 修订注记 + 交付报告显式上报，未上报偏离预检打回。Stage 4 若发现 design 细节矛盾，按 AGENTS.md §3.2 就地回改对应 spec 文档并在结果报告列出；若动摇已确认 Goal/Requirements 验收标准，必须停下请求人类裁决。

## Stage 4 执行注记

- 状态：全部 17 项任务已实施并验证，**全局终审通过（无偏差）**，Stage 4 完成提交 `2294008`（`feat/m6-mcp`）。Stage 3 Tasks 提交 `13199a0`。
- 交付：`packages/mcp/**`（辅助 replacement bundle `@deepseek-ai/dsh-plugin-api-mcp`，row `plugin-api-mcp`）+ `docs/specs/plugin-api-features/feature-list.md` 登记（U16 上游提案行、§3.1 R 类登记行、§7 delivered 条目；U10 与第二批 design 批准注册的编号冲突，Wave C integration 统一改排为 U16）。
- 验证：包内 `node --test "test/*.mjs"` 99/99；仓库根 `npm test` 1047/1047；`git diff --check` 干净；治理 magic token 扫描 0 命中；官方 `@deepseek-ai/dsh-mcp-client` 及 `/usr/lib/node_modules/@deepseek-ai/**` 零修改。
- 终审修订：全局终审 P2（组件唯一 owner 冲突检测）已按意见补 `Symbol.for('dsh-plugin-api.mcp.contract')` owner marker + 跨包冲突 fail-safe + 两条针对测试，复核无偏差。
- 上报的偏离：无（`pluginApi.mcp` 主门面条件投影明确不在本 worktree 交付、属 integration 归属，Scope 已声明，非未上报偏离；辅助包版本 `0.1.0-rc.6-0.5` 为占位，最终由 integration owner 对齐）。
- 契约：MCP 不设 guard 分支/不进 FEATURE_MOUNTERS；冻结文件（`lib/events-bus.js`、`lib/events-catalog.js`、`test/index*.mjs`）零改动；不新增 events catalog slice；`mcp/catalog-changed` 由 replacement 自身 emit。
