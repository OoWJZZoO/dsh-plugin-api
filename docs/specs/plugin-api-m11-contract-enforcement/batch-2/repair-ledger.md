# 后续修补台账: plugin-api-m11-contract-enforcement（batch-2 追加修补）

> feature_name: `plugin-api-m11-contract-enforcement`（批次：**batch-2 追加修补**，承接 `delivery-ledger.md`）
> milestone: M11
> 工作流模式：**ANY**（AGENTS §3.0.2）——维护性缺陷修复；不新增能力、不改写已交付的 Goal / Requirements 验收边界、不重开 batch-1 / batch-2 的处置结论。
> 触发：batch-2 交付（`48c2537`）后的**独立实效复核**。复核不看台账自洽，而是在装配后的活面上逐成员实际调用（host 走查 278 叶：17 个 `observe`、41 个 `register`/`define`、4 个 `contribute` 用非法输入矩阵；43 个 `availability()` 逐个校验；client 侧同法走查）。
> 机械基线复核（本轮开工实测）：`npm test` 3614/3614 全绿；`convergence-verify` 572 行 / 37 行为行全链；`capability-matrix-sync --check` 一致；`build:client:check` 一致；`git diff --check` 干净。
> 执行口径（承 batch-2）：版本冻结基线内（runtime `0.1.0-rc.6`、主包及全部辅助/聚合包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`）；不步进任何版本字段；不新增 R 点；官方包文件零修改；`lib/client.js` 只经 `npm run build:client` 重建；所有入口 fail-safe。

## §1 修补点清单

| 编号 | 成员 / 位置 | 类别 | 根因（复核实测） | 本轮动作 |
|---|---|---|---|---|
| R1 | `sessions.durable.observe`（`lib/plugin-api-service.js` ↔ `lib/index.js`） | **功能性回归** | batch-2 把该成员的形状改为标准 handle 时，实现改为转发 `facade.observeDurable`；但 `lib/index.js` 装配的 durable facade 字面量只复制了 `onDurable` / `onceDurable`，`observeDurable` 全仓无装配点。durable epoch 激活时任何一次调用都抛裸 `TypeError: Function.prototype.apply was called on undefined`（batch-2 之前转发 `facade.onDurable`，形状不对但可用）。门面侧测试注入 `observeDurable: () => 'observe-handle'` 宽松桩、`session-durable-feature` 侧测试直接驱动未接线模块，两侧都绕过了装配链，故 3614 条测试全绿仍漏检 | ① 把 facade 构造提为可测试的工厂并补上 `observeDurable` 接线；② 转发前做能力自检：facade 未提供该成员时抛 typed disabled（杜绝裸 `TypeError`）；③ 新增「真工厂 + 真 service」断言，使该接线不再只靠宽松桩取证 |
| R2 | `executions.visibility.register`（`lib/execution-visibility.js`） | 未 typed 失败 | `register(spec)` 的 5 处校验全部抛裸 `TypeError`（`visibility policy must be an object` / `id is required` / `ownerId is required` / `filter must be a pure function` / `duplicate id`）；该成员 idiom 为 `policy`，登记 `failureSemantics: typed-throw`，实测非法输入全部无 `code` | 该模块改用 `PluginApiError` 家族（`EXECUTION_VISIBILITY_REGISTRATION_INVALID`），五处失败统一 typed |
| R3 | `sessions.channels.auth.pairingProvider.register`（`lib/session-channel-auth.js`） | 未 typed 失败 | 形参直接解构（`({ id, initiate, approve, reject }, owner)`），`register()` / `register(null)` 抛裸 `TypeError: Cannot destructure ...`；函数体自身的校验已抛 typed `PLUGIN_API_CHANNEL_AUTH_SPEC_INVALID`，同一命名空间的 `auth.register` 也是 typed——同动词同命名空间两套失败呈现 | 解构前归一 spec（非对象视为空 spec），失败一律走既有 typed 码 |
| R4 | `sessions.channels.redaction.register`（`lib/session-channel-redact.js`） | 未 typed 失败 | 与 R3 同型：`registerProfile = ({ id, allowlist }, owner)` 形参直接解构，`register()` / `register(null)` 抛裸 `TypeError`；函数体已有 typed `PLUGIN_API_CHANNEL_REDACTION_SPEC_INVALID` | 同 R3 |
| R5 | `tasks.register`（`lib/task-execution-observation.js`） | 未 typed 失败（异步面） | `async register(input = {})` 的默认值只覆盖 `undefined`：`register(null)` 逃逸为 **rejected Promise + 裸 `TypeError: Cannot read properties of null (reading 'taskId')`**；而 `register({})` 走判别式 `{ok:false, code:'invalid-input'}`——同一成员两种失败呈现 | `null` / 非对象 spec 归一为判别式 `invalid-input`，与既有分支同形 |
| R6 | client `lifecycle.register`（`lib/client-generation-rebind.js`） | 未 typed 失败 | `validateRegistration` 的 7 处校验抛裸 `TypeError`（`client lifecycle registration must be an object` 等）；该成员 idiom 为 `resourceRegistry`，失败应按登记呈现为 typed | 改用 `PluginApiError`（`PLUGIN_API_CLIENT_LIFECYCLE_INVALID_INPUT`）；`lib/client.js` 经 `npm run build:client` 重建 |

## §2 复核排除项（非缺陷，避免重复追查）

- `codec.json.register`：**不在册公共成员**。client 的 `codec.json` 叶值是被打包进 bundle 的 zod schema 对象，其自有方法 `register(reg, meta)` 是 zod 的注册表 API；该 leaf 由扫描器过度下钻得到，registry 无此成员，不属公共面。
- client `sessions.interactions.availability` / `sessions.selection.availability`：**误报**。两者是按 `callShape: async` 声明的异步成员（`lib/client-sessions-interactions.js`），等待后的答案是合规的冻结三值描述符（`status` / `reason?` / `sources?`）；复核中「返回 `{}`」的观测来自探针未 `await`（`JSON.stringify(Promise)` 即 `{}`）。本轮不涉代码改动。
- 观察入口对「非法但可解读的裸主题」的宽松接受（如 `executions.observe(42)` 返回降级 handle）：不构成裸 `TypeError`，且登记已写明裸主题便捷形态；收紧口径会改变已登记的可接受入参集合，超出 ANY 边界，**不纳入本轮**（如需收紧，另立 spec 批次）。

## §3 开放项（ANY 边界外，需授权后另批处置）

**`llm.routing.health.observe`（host）——登记与实现相反，暂不修改。**

- 事实：登记为 `idiom: projection` / `effect: subscribe`，`currentShape` 只写 `health subscription`，且在册 22 个 `.observe` 叶中是**唯一**未声明 handle 的一条；实际实现是健康证据**上报动词** `health.observe(scope, outcome, evidence)`，返回冻结记录 `{ scope, outcome, source, observedAt, reason }`，没有 `current` / `subscribe` / `dispose`（`packages/agent-loop/lib/route-policy.js` 的 `createHealthOwner.observe`，经 `lib/plugin-api-service.js` 原样转发）。
- 为什么不在本轮修：这是**公共面形状决策**（改名退役、或改造为真正的观察入口、或收窄为内部缝），涉及 registry 行、`oldToTargetMapping` / `statusByPath`、能力矩阵、树图与分册措辞；按 AGENTS §3.0.2，ANY 不得改动已交付的验收边界与公共形状。batch-2 `design.md` §2.9-4 已明文把它排除在核验范围外，重开需要人类授权（milestone 范围决策）。
- 备选处置（供授权时取舍）：① 改名为领域动词（如 `llm.routing.health.record`，走 `removed` + mapping，与其他改名同型）；② 保留名字但改造为真观察入口（新增能力，须走 SPEC1→SPEC3）；③ 降级为内部缝并从公共面移除。推荐 ①：语义诚实的代价最小，且不新增能力。

## §4 边界与不变量

- 不新增公共能力、不新增顶层 namespace、不新增 R 点；R1–R6 全部是既有成员的失败呈现或装配修复，不改成员名、不改成功路径形状、不改 registry 行。
- 版本冻结字段零步进；官方包文件零修改；`lib/client.js` 只经 `npm run build:client` 重建并核对 `--check`。
- 失败呈现收敛方向：注册类（policy / resourceRegistry）一律 typed throw，异步面与判别式面维持既有 `{ ok:false, code }` 形状；任何公共入口不得抛裸 `TypeError`。
- R1 的修复必须可被装配级断言取证：不得再以「桩 facade + 未接线模块」两侧分离的测试充当证据。

## §5 执行结果

见本文件末尾「§6 执行与验证记录」。

## §6 执行与验证记录

### 6.1 逐项落地

| 编号 | 改动 | 文件 |
|---|---|---|
| R1 | durable facade 由就地字面量提为 `createSessionDurableFacade` 工厂，补上 `observeDurable: activeApi.observeDurable` 接线；观察入口转发前做能力自检，缺失目标抛 typed disabled | `lib/session-durable-feature.js`（新增工厂）、`lib/index.js`（改用工厂、import 同步）、`lib/plugin-api-service.js`（自检） |
| R2 | 五处注册校验改用 `PluginApiError`（`EXECUTION_VISIBILITY_REGISTRATION_INVALID`） | `lib/execution-visibility.js` |
| R3 | 三个注册入口统一 spec 归一（非对象视为空 spec），失败走既有 typed 码 | `lib/session-channel-auth.js` |
| R4 | 同上（`PLUGIN_API_CHANNEL_REDACTION_SPEC_INVALID`） | `lib/session-channel-redact.js` |
| R5 | `null` / 非对象 spec 归一为判别式 `{ ok:false, code:'invalid-input', action:'register' }` | `lib/task-execution-observation.js` |
| R6 | 注册校验改用 `PluginApiError`（`PLUGIN_API_CLIENT_LIFECYCLE_INVALID_INPUT`），并重建产物 | `lib/client-generation-rebind.js`、`lib/client.js`（`npm run build:client`） |

新增/更新的断言（净增 6 个用例，另在既有用例内补断言）：

- `test/plugin-api-service-session-durable.test.mjs`（+2）：真工厂 + 真 service 的接线断言（`observeDurable` 可达且转发到位）；facade 缺转发目标时答 typed disabled 而非裸 `TypeError`。
- `test/session-durable-feature.test.mjs`（+1）：真 `createSessionDurableApi` + 真工厂的装配断言（`facade.observeDurable` 与 `api.observeDurable` 是同一函数，且经它返回标准四成员 handle）。
- `test/session-channel-auth.test.mjs`（+1）：三个注册入口对 `undefined` / `null` / 字符串 / 数字 spec 一律 typed。
- `test/index-tasks.test.mjs`（+1）：挂载门面上 `tasks.register(null|'spec'|42|[])` 一律判别式 `invalid-input`。
- `test/client-observation-handles.test.mjs`（+1）：client `lifecycle.register` 四类非法声明一律 typed。
- `test/execution-visibility.test.mjs`、`test/session-channel-integration.test.mjs`：既有用例内的 `TypeError` 断言改为 typed 码，并补缺失 spec 与公共路径（`channels.auth.pairingProvider.register` / `channels.redaction.register`）的非法输入断言。

### 6.2 活面复验（修补后实测）

| 修补点 | 复验调用 | 实测回答 |
|---|---|---|
| R1 | `sessions.durable.observe({ targetSession, kind })`（走查挂载，目标会话不存在） | typed `invalid-target-session`（不再是裸 `TypeError`）；接线用例中经真转发目标返回观察结果 |
| R2 | `executions.visibility.register(null)` / owner 级 `register()` | typed `EXECUTION_VISIBILITY_REGISTRATION_INVALID` |
| R3 | `sessions.channels.auth.pairingProvider.register(null)` | typed `PLUGIN_API_CHANNEL_AUTH_SPEC_INVALID` |
| R4 | `sessions.channels.redaction.register(null)` | typed `PLUGIN_API_CHANNEL_REDACTION_SPEC_INVALID` |
| R5 | `tasks.register(null)` | `{ ok:false, code:'invalid-input', action:'register' }` |
| R6 | client `lifecycle.register(null)` | typed `PLUGIN_API_CLIENT_LIFECYCLE_INVALID_INPUT` |

独立扫描复验（同一套探针，非法输入矩阵：无参 / `undefined` / `null` / 字符串 / 数组 / 数字）：

- host：62 个在册入口（17 `observe` + 41 `register`/`define` + 4 `contribute`）**未 typed 失败 0 处**（修补前 5 处）；43 个 `availability()` 全部冻结三值、非 active 带 `reason`。
- client：`lifecycle.register` 由裸 `TypeError` 转为 typed；其余在册面维持合规（两个 `sessions.*.availability` 为 `callShape: async` 成员，`await` 后答冻结三值描述符——见 §2 复核排除项）。

### 6.3 全量验证与边界复核

- `npm test`：**3620 / 3620** 通过（基线 3614，净增 6 个用例）。
- `scripts/convergence-verify.mjs`：572 行 / 37 行为行 / 37 fully linked；`capability-matrix-sync --check`：in sync；`build:client:check`：产物与源一致；`git diff --check`：干净。
- 边界：`package.json` / `pnpm-lock.yaml` / `packages/**` / `cordis.patch.yml` **零改动**（版本冻结字段零步进、未新增 R 点、R 包契约复刻与 boot 自检未受影响）；官方包目录零改动；`lib/client.js` 只经 `npm run build:client` 重建。
- 工作区状态：本轮改动（15 个文件 + 本文件）**留在工作区、尚未提交**，提交与否由人类决定。

### 6.4 未纳入本轮

- §3 的开放项 `llm.routing.health.observe`：需公共形状决策，未修改。
- §2 末条的「非法但可解读裸主题的宽松接受」（如 `executions.observe(42)` 返回降级 handle）：不构成裸 `TypeError`，收紧会改变已登记的可接受入参集合，超出 ANY 边界，未修改。
