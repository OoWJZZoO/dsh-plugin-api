# Tasks: remote-session-channel

> feature_name: `remote-session-channel`
> 状态：Stage 3（Tasks）待对抗性审查通过后进入 Stage 4 执行
> 上游：`requirements.md`（Stage 1/2 修订稿已获用户确认，2026-08-27）、`design.md`（Stage 2 修订稿已获用户确认，2026-08-27）
> 基线：main `8654c14`（治理先行已落；跨组件 R 政策修订 + adapter-decoration / remote-session-channel 已确认 spec 制品）；实现叶子 worktree `remote-session-channel` 自 main 派生，无并发线（A 线并行，见批次契约）。
> 批次契约：`temp/m6-final-batch-contract-2026-08-27.md`（临时契约，非制品，用毕即删）。本任务书遵守其全部命名规范（§2 B 冻结标识）、共享文件编辑边界（§3）、冻结文件（§4）、失败呈现（§5）与派生/合并顺序（§6）。
> 执行注（SPEC3）：Stage 3 产出的本任务书经**阻塞式对抗性审查**（`run_in_background: false`，仅小修改免审）通过后直接进入 Stage 4；Stage 4 完成全部顶层任务并验证后做**一次全局终审**（同样阻塞），通过后才交付、提交并清理叶子 worktree。同线内审查→修订串行。审查只核对交付物与 Tasks/Design/Requirements 一致性 + `docs/standards/` 适用分册符合性，不向上溯源。
> 测试约定：统一 `npm test`（`node --test "test/**/*.mjs" "packages/*/test/*.mjs"`，4G 内存护栏，勿裸跑 `node --test`）；纯函数模块保持零 harness 依赖；辅助包测试经 monorepo workspace 依赖运行。既有主仓库 `test/` 文件**不修改**（`features.length`/host-boundary 等 integration-owned 断言增量由 I 统一维护）。
> 治理编号禁令：`AD-Rx`/`U20`–`U23`/`SPEC*`/`M6`/批次名/A·B·C·R 分类字母等**不得**出现在 lib/、packages/、test/、package.json、cordis.patch.yml 或任何运行时可见字符串；仅允许出现在 `docs/**` 治理/规格制品。

---

## 1. 共享词汇与两个 R 包骨架/装配（RSC-R1, RSC-R4, RSC-R14）

- [ ] 1.1 共享 channel 词汇（三处一致）
  - 主包 `lib/session-channel-shared.js`（纯函数、零 harness 依赖）：终态词汇 `success|error|aborted|denied|superseded`；typed 诊断码→终态映射（`superseded`/`aborted` 1:1、`timeout`→`error`+reason、`denied` 变体（pairing-required/device-denied/session-denied/resume-rejected）→`denied`、`resync-required`/`cursor-gap` 为消费语义结果非终态、其余→`error`）；`CONTRACT_SYMBOL = Symbol.for('dsh-plugin-api.session-channel.contract')`；文档化默认限流界（per-method）与默认重放保留窗口界；错误 payload 白名单（仅 bounded code / 安全 message / 非 secret 细节）。
  - `packages/session-channel-connection/lib/shared-vocab.js` 与 `packages/session-channel-gateway/lib/shared-vocab.js`：与主包同源词汇的本地副本（R 包不 import 主包运行时）。
  - 一致性测试：`test/session-channel-shared.test.mjs` 与两包 `test/*-vocab-consistency.test.mjs` 逐字比对三处词汇（终态五词、typed 码全集、映射、符号 key 字符串、默认界），漂移即失败（RSC-R14 AC4）。
- [ ] 1.2 connection 替换包骨架
  - 新建 `packages/session-channel-connection/package.json`：name `@deepseek-ai/dsh-plugin-api-session-channel-connection`、version `0.1.0-rc.6-0.7`、`type: module`、`main: lib/index.js`、`exports`（`.`、`./invariant`、`./package.json`）、`dsh.api: 0.7`、`dsh.bundle.patch: ./cordis.patch.yml`、`dsh.client: { platform: 'web', inject: [], immediately: true }`（官方 connection 行 client manifest 为正，RSC-R11）。
  - peerDependencies：官方 `dsh-client-connection@0.1.0-rc.6`（精确）与其 peer 集（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-host-webserver`、`@deepseek-ai/dsh-invariants`）+ 复刻 host 实际运行时 import 面（`@deepseek-ai/dsh-host-apiproxy` 及其 `api` 子路径、`@deepseek-ai/schemastery`、`ws`）；官方 dependencies 中未被复刻 host 运行时 import 的包（如 `@deepseek-ai/dsh-commands`）**不携带**（AGENTS.md §6 不引入与门面无关的运行时依赖）；主包 `@deepseek-ai/dsh-plugin-api-main` 作为 peerDependency（版本一致校验用，不 import 其运行时）。
  - 新建 `packages/session-channel-connection/cordis.patch.yml`：`- id: connection; disabled: true` + insert 行 `id: plugin-api-session-channel-connection`、`name: '@deepseek-ai/dsh-plugin-api-session-channel-connection'`、`inject: [webRuntime]`、`config: { trustedHosts: ... }`（与官方 dsh-web-app 156–163 行同构；config 由用户 profile 层按 id 覆盖，patch 只提供占位）。
- [ ] 1.3 gateway 替换包骨架
  - 新建 `packages/session-channel-gateway/package.json`：name `@deepseek-ai/dsh-plugin-api-session-channel-gateway`、version `0.1.0-rc.6-0.7`、`type: module`、`main: lib/index.js`、`exports`（`.`、`./invariant`、`./package.json`）、`dsh.api: 0.7`、`dsh.bundle.patch: ./cordis.patch.yml`、`dsh.client: { platform: 'web', inject: ['@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-client-connection'], immediately: true }`（官方 typert-gateway 行 client manifest 为正，RSC-R11）。
  - peerDependencies：官方 `dsh-api-gateway@0.1.0-rc.6`（精确）与其 peer 集（`@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-invariants`、`@deepseek-ai/dsh-typert-registry`、`@deepseek-ai/cordis`）+ `@deepseek-ai/dsh-typert-protocol`（官方 dependencies 面）；主包 peerDependency（同 1.2）。
  - 新建 `packages/session-channel-gateway/cordis.patch.yml`：`- id: typert-gateway; disabled: true` + insert 行 `id: plugin-api-session-channel-gateway`、`name: '@deepseek-ai/dsh-plugin-api-session-channel-gateway'`。
- [ ] 1.4 包级 patch 装配测试
  - 两包各自 `test/patch-composition.test.mjs`：用官方 `composeEntries`（`@deepseek-ai/dsh-app-boot` devDependency）验证 disable+insert、移除恢复、官方行缺席时 disable 告警跳过而 insert 生效、后续层只写 `config` 不复位 `disabled`（RSC-R1 AC1/AC2）。
  - 两包各自 `test/version-lock.test.mjs`：版本锁四元组（runtime 全量 identity、被替换官方包 identity、辅助包、主包 `dsh.api`）校验逻辑纯函数化并测试（RSC-R4 AC1/AC3）。
- [ ] 1.5 官方包文件不可变审计基线
  - 记录 `@deepseek-ai/dsh-client-connection@0.1.0-rc.6`、`@deepseek-ai/dsh-api-gateway@0.1.0-rc.6` 与 `dsh-base`/`dsh-web-app` 包文件清单/校验基线（供交付审计对比）；不修改任何 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 文件（RSC-R1 AC3）。

## 2. connection R 包：官方 host 契约复刻 + 增量切片（RSC-R2, RSC-R3, RSC-R13）

- [ ] 2.1 vendored 官方 host 基底
  - 新建 `packages/session-channel-connection/lib/forked-host.js`：复制官方 `@deepseek-ai/dsh-client-connection@0.1.0-rc.6/lib/index.js` 全文（588 行），文件头注明出处与 MIT；本任务先不加语义改动。保留导出面：`API_PATH`、`Config`、`HOST_EVENTS_PATH`、`HostConnectionService`、`MUX_EVENTS_PATH`、`apply`、`inject`、`name`。
  - 新建 `packages/session-channel-connection/test/official-fork-integrity.test.mjs`：与官方包逐名比对公开导出集、`inject`、`Config` 键集、`HostConnectionService` 公开成员（`rpc.handle`/`rpc.intercept`/`createSharedFetchHandler`/`register`/`registerInterceptor`/`trustedHosts`）、`apply` 行为要点（trustedHosts 校验、privileged methods loopback 钉扎、`/api/events.mux|host` GET→426、apiProxy fallback、`/api` route + WS downlinks 注册）；记录 `trustedHosts` 是 DNS-rebinding fence 而非认证的官方注释事实（RSC-R2 AC1 证据）。
- [ ] 2.2 apply 自检矩阵与 fail-safe
  - 新建 `packages/session-channel-connection/lib/apply.js`：`{ name: 'plugin-api-session-channel-connection', inject: ['loader', 'webRuntime'] }`；`inspectComposition` 定位官方 `connection` 行（按 `id === 'connection'` 优先、name `@deepseek-ai/dsh-client-connection` 回退）。
  - 决策矩阵：官方行 disabled 且替代行 active 且无竞争 owner（已有带本契约符号的 provider→idempotent；存在其他 `connection` 服务 provider 且无本符号→log+inert 绝不双跑）且版本锁通过 → 注册复刻 host 面 + 增量切片；任一失败 → `ctx.logger` 有界诊断（`session-channel:` 前缀 + owner id 归因）+ **正常 return** + 本 R 面 inert。
  - 官方行契约探针：`/api` 共享 fetch handler 可构造、`rpc.intercept` 可调用、`webServer.register`/`registerUpgrade` 存在、`trustedHosts` fence 语义（`isTrustedApiRequest` 等价）可验证（RSC-R2 AC2/RSC-R3 AC1）；`apiProxy` 缺席时 `/api` fallback 404 行为保持（RSC-R2 AC2）。
  - RSC-R2 AC5 应急路径：契约保真度对已装 runtime 无法证明时 → 本切片暂停（inert + 诊断），并把受影响切片在交付报告/登记中记为 C 类上游提案（供 I 在 feature-list 落盘），不伪造 replacement 边界。
  - 版本失配 → 只停用本 R 能力，不波及主门面其他能力（RSC-R4 AC3）。
- [ ] 2.3 增量切片：transport 协商
  - 在复刻 host 面之上增加配置切片：`advertisedTransports` / `authorizedTransports`（官方已支持载波词汇内：`websocket|sse|polling|loopback`）；只协商 `advertised ∩ authorized` 且已通告的 transport；transport 选择不是授权，授权必须先于敏感 channel 打开（RSC-R7 AC4 / design connection 切片）。
  - 暴露 `connection.transport.negotiated()` 只读查询（transport 状态投影），不引入第二套终态词汇。
- [ ] 2.4 增量切片：连接层 channel 代次围栏 + carrier resume 再附着
  - 连接层维护 channel 绑定 generation 表（`ConnectionState.channelGeneration` 为 transport 本地围栏用的只读 opaque 绑定，只与自身比较、不做 channel 生命周期决策；channel 级 generation 单一权威 owner 是 B 门面，见 design concurrency §1.4）。
  - 当 B 门面可用时（`ctx.get('pluginApi')?.sessionChannel` 带 `CONTRACT_SYMBOL`，见任务 7）订阅其 `onChange` 投影，把 channel generation 变化同步进连接层围栏表；B 门面缺席/inert → 围栏表不发布 channel 能力、官方复刻面保持不变（RSC-R2 AC4/RSC-R14 AC3）。
  - carrier 级 resume 传输再附着原语：`connection.resume.reattach(connectionGeneration, signal)` 提供传输层再附着；channel/session 语义由 B 门面拥有，本层只做载波再附着（design connection 切片）。
- [ ] 2.5 增量切片测试
  - `packages/session-channel-connection/test/transport-negotiation.test.mjs`：只协商已通告且已授权 transport；未通告/未授权不 fallback；transport 状态投影只读（RSC-R7 AC4）。
  - `packages/session-channel-connection/test/fencing.test.mjs`：旧连接代次失去提交资格、stale frame 不写回、B 门面缺席时围栏表 inert、代次只读 opaque 不与 channel 生命周期决策混用（RSC-R9 AC1/design concurrency）。
  - `packages/session-channel-connection/test/carrier-resume.test.mjs`：`reattach` 有界、AbortSignal 传播、不扩大 session scope（RSC-R7/RSC-R10 AC2）。

## 3. connection R 包：client 半面（R8 自建，RSC-R11）

- [ ] 3.1 client bundle 构建管线
  - 包内新建 `lib/client-src/` 源文件 + 构建脚本（esbuild iife，参照主包 `lib/client.js` 的 `--bundle --format=iife --global-name=...` + `window.__ModuleLoader__.load` 外壳模式）：构建产物 `lib/client.js` 注册 `@deepseek-ai/dsh-plugin-api-session-channel-connection` 模块。
  - 构建时**逐字内联**官方 `@deepseek-ai/dsh-client-connection@0.1.0-rc.6/lib/client.js`（不手改官方 bundle，R8；同主包内联 zod 先例），并以其原始 factory 重新注册官方模块 id `@deepseek-ai/dsh-client-connection`（保留 client 侧 import 面，R3），再注册本包模块 id 返回“官方 exports + 增量切片”。
  - 增量切片（client 半面）：transport 选择结果应用、连接层代次围栏表在 browser reconnect 状态中的使用、carrier resume 再附着客户端原语。
  - 构建产物检查（R8）：产物含 `window.__ModuleLoader__.load`、两模块 id 均注册、零治理 token、`git diff --check` 干净。
- [ ] 3.2 client 半面测试与装配验证
  - `packages/session-channel-connection/test/client-surface-audit.test.mjs`：对官方包六项检查**均为正**（client manifest、remote namespace 面、browser state/reconnect、client-facing event/service、版本协商、slot/settings bridge 中命中项）→ 断言本包必须自带 client 半面；本包 `dsh.client` manifest 与 `exports['./client']` 存在（RSC-R11 AC1/AC2）。
  - `packages/session-channel-connection/test/client-bundle-shape.test.mjs`：产物可被 `exports['./client']` 解析、模块 id 正确、官方模块重新注册存在、无 secret/异常 cause 进入产物、形状再校验（client 不承担脱敏，RSC-R8 AC4）。

## 4. gateway R 包：官方 host 契约复刻 + 增量切片（RSC-R2, RSC-R3, RSC-R13）

- [ ] 4.1 vendored 官方 host 基底
  - 新建 `packages/session-channel-gateway/lib/forked-host.js`：复制官方 `@deepseek-ai/dsh-api-gateway@0.1.0-rc.6/lib/index.js` 全文（396 行），文件头注明出处与 MIT；先不加语义改动。保留导出面：`TypertGatewayError`、`TypertGatewayService`（default）。
  - 新建 `packages/session-channel-gateway/test/official-fork-integrity.test.mjs`：与官方包逐名比对公开导出集、`TypertGatewayService` 公开成员（`claimsEndpoint`/`collectSrcClaims`/`invoke`/`dispatchRpc`/`invokeRpc`）与 `/api` intercept 语义（`{authority: "trusted-host"}`、claim→dispatch、RPC 信封 `{ok,value}`/`{ok:false,error}`、descriptor collection、SRC fallback、错误分类）（RSC-R2 AC1 证据）。
- [ ] 4.2 apply 自检矩阵与 fail-safe
  - 新建 `packages/session-channel-gateway/lib/apply.js`：`{ name: 'plugin-api-session-channel-gateway', inject: ['loader'] }`；`inspectComposition` 定位官方 `typert-gateway` 行（`id === 'typert-gateway'` 优先、name 回退）。
  - 决策矩阵同 2.2（官方行 disabled、替代行 active、无竞争 owner、版本锁通过 → 注册复刻 host 面 + 增量切片；任一失败 → `session-channel:` 前缀有界诊断 + 正常 return + 本 R 面 inert）。
  - 官方行契约探针：`TypertGatewayService` 构造可用、`connection.rpc.intercept('/api', ...)` 可调用、descriptor 收集/RPC claim/dispatch 行为与官方一致、`remote` service 装配可用（RSC-R2 AC2/RSC-R3 AC1）。
  - RSC-R2 AC5 应急路径：契约保真度对已装 runtime 无法证明时 → 本切片暂停（inert + 诊断），并把受影响切片在交付报告/登记中记为 C 类上游提案（供 I 在 feature-list 落盘），不伪造 replacement 边界。
- [ ] 4.3 增量切片：channel 方法 RPC 派发
  - 在复刻面之上增加 channel 方法面：把 `open`/`subscribe`/`ack`/`resume`/`revoke` 作为经官方 RPC carrier（`/api`）进出的 channel 方法端点（如 `sessionChannel/open` 等），带 descriptor 校验与调用边界。
  - 端点命中时路由到 B 门面 `dispatchChannelMethod`（经 `CONTRACT_SYMBOL` 发现）；B 门面缺席/inert → 该端点返回有界 `unavailable`、官方 gateway 面保持不变（RSC-R2 AC4/RSC-R14 AC2/AC3）。
  - 本包只做 RPC/remote 派发管道，channel 语义（auth、cursor、replay、revoke 决策）全部由 B 门面拥有；不复制第二份 channel 状态（RSC-R11 AC3/RSC-R13 AC3）。
- [ ] 4.4 增量切片：remote 命名空间扩展
  - 在既有 `remote` 之上提供 channel 专用 remote 命名空间（host 注册 + client mount）：channel 状态投影与配对 UI 可经此暴露；复用 `remote.publish`/client `$mount` 机制，不发明新协议（design gateway 切片）。
  - 投影只读（api-shape §1）：经 remote 暴露的 channel 投影不能 ack/revoke/授权/改状态。
- [ ] 4.5 增量切片测试
  - `packages/session-channel-gateway/test/channel-rpc-dispatch.test.mjs`：channel 方法端点 claim/dispatch 路由到 B 门面（fake 门面）、descriptor 校验、B 门面缺席时 `unavailable`、官方端点（非 channel）行为不变（RSC-R2/RSC-R14）。
  - `packages/session-channel-gateway/test/remote-namespace.test.mjs`：channel remote 命名空间 host 注册 + 形状、投影只读、无 secret（RSC-R8）。

## 5. gateway R 包：client 半面（R8 自建，RSC-R11）

- [ ] 5.1 client bundle 构建管线
  - 同 3.1 模式：包内 `lib/client-src/` 源 + esbuild iife 构建产物 `lib/client.js`，注册 `@deepseek-ai/dsh-plugin-api-session-channel-gateway` 模块；逐字内联官方 `@deepseek-ai/dsh-api-gateway@0.1.0-rc.6/lib/client.js` 并重新注册官方模块 id `@deepseek-ai/dsh-api-gateway`（R3），再注册本包模块 id。
  - 增量切片（client 半面）：channel remote 命名空间 mount、channel 方法经官方 carrier 调用、client 侧形状再校验（不承担脱敏）。
  - 构建产物检查同 3.1（R8）。
- [ ] 5.2 client 半面测试与装配验证
  - `packages/session-channel-gateway/test/client-surface-audit.test.mjs`：对官方包六项检查命中项（client manifest、remote namespace、client-facing event/service）→ 断言本包自带 client 半面（RSC-R11 AC1/AC2）。
  - `packages/session-channel-gateway/test/client-bundle-shape.test.mjs`：同 3.2 形状断言 + 无 secret（RSC-R8 AC4）。

## 6. B 门面 `sessionChannel`：认证抽象 + 控制面 + 机械层（RSC-R5, RSC-R6, RSC-R7, RSC-R9, RSC-R10, RSC-R15, RSC-R16）

> 主包 `lib/` 只写本 feature 分支文件（`lib/session-channel-*.js`），不交叉修改其他 feature 内容；共享文件（guards.js、FEATURE_MOUNTERS）只追加自己的 else-if 分支/末尾项（任务 7）。

- [ ] 6.1 认证抽象（`lib/session-channel-auth.js`）
  - `auth.registerVerifier({ id, verify(deviceCredential, context) -> { deviceId, scope } | { denied, reason } })`、`auth.registerPairingProvider({ id, initiate/approve/reject })`、`auth.registerAuthorizer({ id, authorize({deviceId, scope, method, session, channel}) -> allow | { deny, reason } })`，各返回幂等 disposer。
  - fail-closed：无任何 verifier → `open` 返回 typed `unavailable`（RSC-R5 AC2/RSC-R15 AC2）；多 verifier/authorizer 默认全部通过（AND）才放行；同一 `id` 重复注册替换旧链；按注册顺序调用；范式无关，不耦合任何单一范式（RSC-R5 AC5/RSC-R15 AC4/AC5）。
  - 配对→验证交接契约：`approve(pendingToken)` 返回的 `deviceCredential` 是 `verify` 的输入；`pendingToken` 是不透明值门面不解释。
  - 插件回调（verify/pairing/authorize）抛错 → 只降级对应操作为有界 typed 结果，不抛穿（契约 §5）；认证失败不泄露无关设备或 session 是否存在（RSC-R15 AC6）。
  - 测试：`test/session-channel-auth.test.mjs`——fail-closed、AND 组合、重复 id 替换、范式无关（approval/PIN/QR/token/custom 均可表达）、回调抛错降级、存在性不泄露。
- [ ] 6.2 控制面与生命周期（`lib/session-channel-core.js`）
  - `open({device, capabilities, session?, resumeToken?, clientNonce?}, signal?) -> OpenedChannel | typed denied/error/unavailable`：先验证注册链（verifier→authorizer 逐方法授权）再创建 channel 记录；验证/能力/凭证失败或无 verifier → typed 结果，**不留半创建 channel**（多步操作原子性，design error handling；RSC-R5 AC1/AC2）。
  - `subscribe({channelId, session, cursor?, eventTypes?, redactionProfile?}, signal?) -> Subscription | resync-required | typed`：从请求 cursor 之后开始投递；会话 scope 与显式投递模式（RSC-R6 AC1）。
  - `ack({channelId, subscriptionId, cursor, dedupeKeys?}, signal?) -> AckedCursor | typed stale/denied/error`：同一 channel generation 内单调推进 watermark；ack 幂等（RSC-R6 AC3）。
  - `resume({channelId, resumeToken, session, cursor}, signal?) -> ResumedChannel | resync-required | typed`：验证 token/device/session/generation 后在保留窗口内重放；窗口外 bounded snapshot/resync 显式 gap reason，不静默跳 gap（RSC-R7 AC1/AC3）。
  - `revoke({device, channelId?, reason}, signal?) -> Revoked | typed`：profile 级撤销并递增 authorization generation，旧 channel 无法重获资格；revoke/expire 后 subscribe/ack/resume 被拒、旧代失去提交资格（RSC-R5 AC3/AC4）。
  - channel/subscription 记录为 session 级、不复制 profile 密钥或官方 transcript（RSC-R10 AC1）；终态提交后迟到帧/回调不得重写（RSC-R9 AC2）。
  - 取消：`AbortSignal`/revoke 取消传播到订阅、当前 transport 与 replay；已提交终态不被重写；disposer 幂等且只撤销本 channel identity 拥有的资源（RSC-R9 AC2/AC3）。
  - 子订阅失败/取消不撤销父设备/通道，除非注册 auth owner 显式声明该关系（RSC-R9 AC6）。
  - 测试：`test/session-channel-core.test.mjs`——open 原子性、生命周期迁移、ack 单调、resume 窗口、revoke 后拒新、latest-wins 代次、取消传播、子订阅隔离、timeout→`error`+reason（RSC-R9 AC5）、stale disposer 不能 dispose 新 channel。
- [ ] 6.3 session 游标/重放机械层（`lib/session-channel-cursor.js`）
  - 基于官方 session 事件流（`pluginApi.session` 生命周期事件 / `sessionEventTypes` / 官方 `sessions` 服务）实现 channel 级消费语义：稳定 event id + dedupe key、at-least-once、有界保留窗口、`resync-required` 不伪造缺失事件（RSC-R6 AC2/AC4）。
  - presence/heartbeat 只更新本 channel generation，不复活已撤销/过期通道（RSC-R5 AC4）。
  - 重试按操作有界：transport reconnect 仅在 channel 授权、deadline 与 generation 仍有效时重试；`denied`/`aborted`/`superseded`/无效 cursor 不自动重试（RSC-R10 AC2/AC3）。
  - 测试：`test/session-channel-cursor.test.mjs`——投递去重、ack 单调、窗口外 resync-required、resume 不静默跳 gap、heartbeat 不复活、有界重试。
- [ ] 6.4 逐方法限流（`lib/session-channel-rate-limit.js`）
  - per-method 有界 rate limit；超限 → typed `rate-limited`，不建 channel/不推进 cursor；未声明方法用文档化默认界，绝不 fail-open（RSC-R16 AC1/AC2）。
  - 测试：`test/session-channel-rate-limit.test.mjs`。
- [ ] 6.5 脱敏与审计（`lib/session-channel-redact.js` / `lib/session-channel-audit.js`）
  - host 序列化前按 session scope、per-method 授权与受众 redaction profile 脱敏；redaction 失败 fail-closed 省略字段；token/凭证/未脱敏日志/无关 session 数据永不上 wire（RSC-R8 AC1/AC2）。
  - channel 生命周期/授权变更 append bounded audit（who/what/when/generation），不含原始 token 与 session 内容（RSC-R8 AC3）。
  - 纯函数模块零 harness 依赖；测试：`test/session-channel-redact.test.mjs`、`test/session-channel-audit.test.mjs`——fail-closed、无 secret/异常 cause、audit 有界。

## 7. B 门面：guards + FEATURE_MOUNTERS + 装配集成（RSC-R3, RSC-R13, RSC-R14）

- [ ] 7.1 投影面与门面装配（`lib/session-channel.js` / `lib/session-channel-project.js`）
  - `observe({channelId?, session?}) -> frozen snapshot { channels, subscriptions, connectionState }`（只读投影，不 ack/revoke/授权/改状态，api-shape §1）；`onChange(listener) -> disposer`（通道/订阅/连接状态变更通知；监听异常隔离；disposer 只移除本监听）。
  - 门面装配：`pluginApi.sessionChannel` 挂 `open/subscribe/ack/resume/revoke`（控制面）+ `observe/onChange`（投影面）+ `auth.*`（注册接口）+ 跨包协调钩子（`dispatchChannelMethod`、channel generation 只读查询/订阅）并打 `CONTRACT_SYMBOL`；挂载必需钩子（session 观察、auth 注册接口）不可用时 → inert + typed diagnostic，不挂载 channel 能力（RSC-R3 AC4）。激活 gate 三条件：运行时可检的 1（必需钩子可用）与 3（信任模型已文档化）在 mount 时执行；条件 2（feature 级装配已登记 feature-list §3.1.1）是交付期治理义务，由任务 8.2 落实，不做运行时检查（design 激活 gate 的治理属性）。
  - 信任模型文档化：认证强度由第三方注册链决定，门面不提供内置安全保证；`trustedHosts`/`authority: trusted-host` 不作设备认证（RSC-R15 AC1/AC3）。
  - 测试：`test/session-channel-project.test.mjs`——快照冻结、投影只读、onChange 派发、监听异常隔离、B 门面缺钩子 inert。
- [ ] 7.2 guards.js 追加 `sessionChannel` 分支
  - `runFeatureGuard('sessionChannel', ...)` 单 else-if 分支：探测必需 session 观察钩子（`pluginApi.session` 生命周期事件/`sessionEventTypes`/`sessions` 服务可用性）与 auth 注册接口构造可用；任一缺失 → feature problem（不 fail core）。
  - 只追加 else-if，不交叉修改既有分支；测试：`test/session-channel-guard.test.mjs`（缺钩子→feature disabled/inert）。
- [ ] 7.3 FEATURE_MOUNTERS 末尾追加 `sessionChannel`
  - `lib/index.js` FEATURE_MOUNTERS 末尾（`profile` 之后）追加 `['sessionChannel', mountSessionChannelFeature]`；apply 两遍执行中追加单 else-if 分支；registry 键 `sessionChannel`；namespace 门控：`pluginApi.sessionChannel` 命名空间投影以 `featureRegistry.isActive('sessionChannel')` 为门（feature 未挂载/disabled 时命名空间不出现或为 inert），四处一致（guard else-if / FEATURE_MOUNTERS 末尾 / registry 键 / namespace 门控）。
  - 测试：`test/session-channel-integration.test.mjs`——挂载后 `featureRegistry.isActive('sessionChannel')`、`ctx.pluginApi.sessionChannel` 形状、缺失切片时对应 R 能力报 `unavailable` 不宣称完整 channel（RSC-R14 AC2）。
- [ ] 7.4 跨包协调接线测试
  - fake connection/gateway R 包 + B 门面同进程装配：channel 方法经 gateway 路由到门面、connection 围栏表经 `onChange` 同步、任一 R 包缺失时门面对应切片 `unavailable`（RSC-R13 AC4/RSC-R14 AC1/AC2）。
  - `test/session-channel-cross-package.test.mjs`。

## 8. 登记文本、装配交付与全局终审（RSC-R12, RSC-R14）

- [ ] 8.1 feature-list §3 表尾追加 U21/U22/U23 行
  - `docs/specs/plugin-api-features/feature-list.md` §3 表尾**仅追加**三行（自带完整溯源：feature 名、状态、spec 目录、关键约束），同 U8–U19 行型：
    - U21：官方 authenticated remote session/channel owner（feature 级；出现后 B 门面退役）；
    - U22：官方 connection carrier transport/fencing seam（connection R 包退役条件）；
    - U23：官方 gateway channel RPC/remote dispatch seam（gateway R 包退役条件）。
  - 只追加不内联；§3.1/§3.1.1 行文本另行提供（8.2），由 I 整合时落盘。
- [ ] 8.2 feature-list §3.1.1 跨组件登记行文本（供 I 落盘）
  - 提供行文本（在交付报告与任务书内）：Feature=`remote-session-channel`，协同 replacement 包 = `plugin-api-session-channel-connection`（owner `@deepseek-ai/dsh-client-connection`）+ `plugin-api-session-channel-gateway`（owner `@deepseek-ai/dsh-api-gateway`），B 门面 coordinating（非 replacement，不占 replacement 包列），报备日期 2026-08-27，设计依据指向本 feature spec 目录（RSC-R13 AC1/RSC-R14 AC1）。
- [ ] 8.3 装配交付（供 I 整合的块文本）
  - 提供 `packages/full/cordis.patch.yml` 块 9（`- id: connection; disabled: true` + insert `plugin-api-session-channel-connection`）与块 10（`- id: typert-gateway; disabled: true` + insert `plugin-api-session-channel-gateway`）的完整行文本（B **不写**该文件，I 为唯一写者按块序追加）。
  - 全量聚合与选择性安装（main + 两 R 包）装配一致性：由 I 落盘后统一 `npm test` 验证（本线只保证各包自身 patch 装配测试通过，RSC-R1 AC4 的集成验证由 I 完成）。
- [ ] 8.4 全局终审
  - 全部顶层任务完成并 `npm test` 全量通过（4G 护栏）后，调用**一次**阻塞式只读对抗性审查（`run_in_background: false`）做全局终审：核对交付物与 Tasks/Design/Requirements 一致性 + `docs/standards/` 适用分册（capability-strategy / api-shape / identity-and-lifecycle / durable-state-and-scope / visibility-and-redaction / concurrency-and-cancellation）符合性 + 契约 §2 命名规范/§4 冻结文件/§5 失败呈现符合性；返回“无偏差”后才交付结果报告、执行 Stage 4 完成提交并清理 worktree。
  - 提交：Stage 4 完成提交只含本 feature 实现、测试、spec 修订与登记（不夹带批次契约文件，`temp/` 已 gitignored）；提交前 `git diff --check` 通过、工作区回到干净状态。

---

## 覆盖检查

| requirements | 任务 |
|---|---|
| RSC-R1 Official Patch Mechanism | 1.2, 1.3, 1.4, 8.3 |
| RSC-R2 Official Contract Fidelity | 2.1, 2.2, 4.1, 4.2, 4.3, 4.5 |
| RSC-R3 Boot Self-Check and Fail-Safe | 2.2, 4.2, 7.1, 7.2 |
| RSC-R4 Version and Owner Locking | 1.1, 1.4, 2.2, 4.2 |
| RSC-R5 Auth Abstraction and Channel Lifecycle | 6.1, 6.2 |
| RSC-R6 Subscription, Delivery and Cursor Semantics | 6.2, 6.3 |
| RSC-R7 Resume and Transport Negotiation | 2.3, 2.5, 6.2, 6.3 |
| RSC-R8 Visibility, Redaction and Audit | 3.2, 4.4, 5.2, 6.5 |
| RSC-R9 Concurrency, Cancellation and Disposer Ownership | 2.4, 6.2 |
| RSC-R10 Durable Scope and Retry Boundary | 2.5, 6.2, 6.3 |
| RSC-R11 Client-Half Decision | 1.2, 1.3, 3.1, 3.2, 5.1, 5.2 |
| RSC-R12 Upstream Proposal and Retirement | 8.1 |
| RSC-R13 B+R Composition | 2.1, 2.3, 4.1, 4.3, 6.2, 7.1, 7.4, 8.2 |
| RSC-R14 Cross-Package Coordination and Registration | 1.1, 2.4, 4.3, 7.1, 7.4, 8.2, 8.3 |
| RSC-R15 Trust Model and Auth Abstraction | 6.1, 7.1 |
| RSC-R16 Per-Method Rate Limiting | 6.4 |

## 命名/边界速查（批次契约 §2/§3/§4 摘要）

- 冻结标识：connection 替代行 `id: plugin-api-session-channel-connection` / `name: '@deepseek-ai/dsh-plugin-api-session-channel-connection'`（禁官方 `connection` 行，owner `@deepseek-ai/dsh-client-connection`）；gateway 替代行 `id: plugin-api-session-channel-gateway` / `name: '@deepseek-ai/dsh-plugin-api-session-channel-gateway'`（禁官方 `typert-gateway` 行，owner `@deepseek-ai/dsh-api-gateway`）。版本锁 `0.1.0-rc.6-0.7`/`dsh.api 0.7`（I sync 时定）。契约符号 `Symbol.for('dsh-plugin-api.session-channel-connection.contract')` 与 `Symbol.for('dsh-plugin-api.session-channel-gateway.contract')`（组件 owner 私有标记）；跨包协调符号 `Symbol.for('dsh-plugin-api.session-channel.contract')`。
- B 门面命名（design 冻结形状）：`pluginApi.sessionChannel.open/subscribe/ack/resume/revoke` + `observe/onChange` + `auth.registerVerifier/registerPairingProvider/registerAuthorizer`；主门面 feature key `sessionChannel`（guard else-if / FEATURE_MOUNTERS 末尾 / registry 键 / namespace 门控四处一致）。
- 诊断前缀：`session-channel:` + owner id 归因。
- 共享文件边界：`lib/**` B 只写自己的 `sessionChannel` 分支文件与 guards.js/FEATURE_MOUNTERS 追加项；`packages/full/cordis.patch.yml` **不写**（只提供块 9/10 行文本）；feature-list §3 只追加表尾、§3.1.1 提供行文本由 I 落盘；`packages/{agent-loop, attachments, compaction-events, mcp, profile-manager, session-branch, session-title, tool-skill}/`、既有 spec 制品（goal/requirements/design）与主仓库既有 `test/` 文件冻结不改。
- 测试文件：`packages/session-channel-connection/test/*.test.mjs`、`packages/session-channel-gateway/test/*.test.mjs`、`test/*session-channel*.test.mjs`（B 门面）。

---

## 9. 维护修订批（2026-08-27，ANY 工作流，用户指示）

> 依据：Stage 4 交付后的只读审查报告（安全偏差 V1–V6 / 功能缺口 F1–F7）。性质：实现回归已获批 RSC-R5/R6/R7/R8/R16/R10 的缺陷修复 + 机制细节回填；EARS 验收边界不变。详见 design.md Status 追注与 Decision Points 8。

已执行（本批完成）：

- [x] 9.1 随机 opaque id/generation：channel/subscription id 与 generation 改为 UUID 派生随机 token（原实现为时间戳+自增计数，可枚举）；generation 兼任占有凭证。（RSC-R5 AC1 执行机制）
- [x] 9.2 占有凭证门控：`subscribe`/`fetchEvents`/`ack`/`resume`/`heartbeat`/`revoke` 必须出示匹配的 `channelGeneration`（ack/fetchEvents 另需 `subscriptionGeneration`），缺失/不匹配 typed 拒绝；subscribe 校验 session 与 channel 的 scope 绑定。
- [x] 9.3 身份传播：open/resume 经 verifier 链得到的 canonical deviceId/scope 写入 channel 记录并用于 authorizer 输入与审计 `who`；resume 绑定 canonical deviceId 与 generation。
- [x] 9.4 拉取式投递落地：新增 `fetchEvents({channelId, channelGeneration, subscriptionId, subscriptionGeneration, cursor?, maxEvents?})` 有界分批拉取（cap 200/次、不推进 watermark）；`subscribe` 响应内联初始重放批；`resume` 窗口内内联重放批；`deliveryMode: 'at-least-once-pull'` 显式声明。cursor/dedupe 回退值由引擎单调序列派生（弃用 Date.now()）。gateway 派发面新增 `sessionChannel/fetchEvents` 端点。
- [x] 9.5 presence/heartbeat：新增 `heartbeat({channelId, channelGeneration})`，只顺延活跃 channel 的过期时限，revoked/expired 不复活；过期改为所有访问路径惰性执行。
- [x] 9.6 限流键控修复：方法界按调用方分桶施加——无凭证调用共享 `anonymous` 桶（预认证消耗）、凭证无效计入 `rejected` 共享桶、通过验证按 canonical deviceId 分桶、本地 face 用 `local` 桶；单洪泛者不再锁定其他调用方。
- [x] 9.7 脱敏 profile 注册：`sessionChannel.redaction.registerProfile({ id, allowlist }) -> disposer`；`subscribe.redactionProfile` 引用未注册 id fail-closed `invalid-input`；secret 字段名单始终优先剔除；capture 取并集、wire 按订阅 profile 过滤。
- [x] 9.8 插件回调异常呈现收口：verifier/pairing/authorizer 抛错时远端固定通用拒绝文案，异常细节仅进 host 诊断日志（经 onError sink）。
- [x] 9.9 capabilities bounded 校验（数组 ≤32 项、每项有界字符串），违反即 `invalid-input`。
- [x] 9.10 spec 回填：goal/requirements/design 三制品追注维护状态；design 公开面补 `fetchEvents`/`heartbeat`/redaction 注册接口、Decision Points 补第 8 条、追溯表更新。

显式遗留项（不在本批范围，防假装完成）：

- [ ] 9.a 服务端主动连续推送（live push）：依赖 connection transport 切片闭环（client 半面 reconnect 后的通道绑定与下行泵）；当前交付为拉取式 + 内联重放批，消费方可轮询 `fetchEvents` 达成同等语义。
- [ ] 9.b 设备级/profile 授权撤销的管理面：归注册链 owner 自建（design Data Models 修正稿）；门面不代持授权状态。
- [ ] 9.c 远端浏览器消费的完整 client 形状（Frame schema 文档、dedupe 折叠 helper）：待 I 整合批次随 client 半面统一落盘。
