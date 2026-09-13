# Stage 3 - Tasks

> feature_name: `credential-mutation-contract`
> milestone: M10
> status: Stage 4 已交付（2026-09-13）。Stage 3 审查门第四轮「无偏差」；Stage 4 全局终审见文末执行注。全量 `npm test` 绿（用例数随终审处置增长，以文末最新记录为准）；registry validator `registry valid`；client bundle `--check` 一致；`git diff --check` 干净。四轮结论：8 条（2 高 / 3 中 / 3 低）→ 4 条（1 高 / 1 中 / 2 低）→ 1 条（高）→ 无偏差；全部就地修订，处置见文末各节。
> 输入溯源：`goal.md`（2026-09-11 获批）；`requirements.md`（Reqs 1–11，含 2026-09-12 与 Design 收敛时的就地修订）；`design.md`（C1–C7、Data Models、Secret Visibility 表、Concurrency、Authority Closure、Registry 拟新增行、Testing Strategy）；Stage 3 源码级探针记录见下。
> 执行口径：Stage 3 以对抗性审查为门（AGENTS.md §3.2），通过后直接进入 Stage 4；版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。**本线是三条 mutation 线中唯一的异步 seam**（官方写 seam 返回 Promise），串行化与失败路径须按 async 语义设计。

## Stage 3 探针记录（源码级事实，Stage 4 以行为测试复核）

- **P1 官方抽象 seam**（`@deepseek-ai/dsh-credentials@0.1.0-rc.6`，`lib/index.js`，67 行）：`CredentialProvider extends Service`，服务名 `credentials`；`REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/`（POSIX shell identifier，:12）；`credentialRef(value)` 对不符模式抛 `TypeError`（:17–20）。`notifyUpdated(ref)`（:43–59）只由 provider 在**写/重载真实提交后**调用；派发 `credentials/updated`（args 仅 `ref`）并对 listener 失败 contained（异步 rejection 与同步 throw 都只记日志），唯一例外是 `error.code === 'INVARIANT'` 时在全部 listener 跑完后 rethrow（同步 listener 才会到 caller）。模块文档（:3–10）：消费者**每次操作 resolve 一次**、配置面只持引用不看值。
- **P2b 事实派发顺序（锁释放的关键事实）**：`notifyUpdated(ref)` 在 `write` 的队列操作内、**文件与内存快照更新之后**同步调用，而 `set`/`unset` 的 Promise 在 `write` 返回后才 settle —— 即**正常路径下 `credentials/updated` 的同步派发先于写 Promise 的结算**。门面的标记 listener 必须是**同步且内部 containment**（自身不抛）的函数，因此在写 Promise 结算时标记必然已推进；锁在写 Promise 结算时释放，不产生「锁已释放、标记未推进」窗口。**两个显式前提**：(i) unset-of-absent 在官方步骤⑧早退、不派发事实——该路径本无官方变更，标记不推进不影响任何不变量；(ii) listener 若抛普通错误会被官方 contained 但标记不推进；**保留陈旧已知标记是 fail-open 的**——持有该旧 revision 的后续提交会「匹配」通过并静默覆盖（Req 3.1 禁止）。故 Task 1.3 要求 listener 自带 guard，且**推进失败时把该 ref 的标记置为「未知/失效」**（而非保留旧值），使后续携带 `expectedRevision` 的提交按 design「模拟层自身故障 → 一律 `revision-unknown`（fail-closed），不退化为放行」拒绝；不带 `expectedRevision` 的提交按 bootstrap 规则放行并以本次事实重建基线。观察桥整体降级（listener 未挂载）时同样在结算时释锁，标记保持未知（后续携带 expectedRevision 的提交 fail-closed），**不产生死锁**。
- **P2 本地 provider 写路径**（`@deepseek-ai/dsh-credentials-local@0.1.0-rc.6`，`lib/index.js`，398 行）：`set(ref, value)`（:274–277）先拒空值（`throw 'an empty value cannot be stored for "<ref>"; use unset'`）再 `await this.write(ref, value)`；`unset(ref)`（:279–281）`await this.write(ref, void 0)`——**两者均为 async、无返回值、无 revision/CAS 参数**。
  - `write(ref, value)`（:295–321）：①`isClosed()` → 抛"disposed: cannot <verb>"；②`assertUnshadowed(ref, verb)`（:327–330，env 影子下抛错并提示在启动 shell 处理）；③`enqueue(...)`（:281–286）把操作接到**独占操作链**尾部（`this.operations = task.then(ok, ok)`，链上串行）；④队列内再次 `isClosed()` 复查、再次 `assertUnshadowed`；⑤`mkdir(dirname(file), recursive, 0700)`；⑥`withFileLock(file, ...)`（跨进程文件锁）；⑦`reconcileFromDisk()`（写前从盘重读）；⑧`if (value === void 0 && existing === void 0) return;`（**unset 缺席 ref 静默无操作、不 notify**）；⑨`renderDocument` →（读盘文本 + 行编辑，非整文件重写）→`writeFileAtomic(file, nextText, { mode: 0600, dirMode: 0700 })`；⑩内存快照更新（`values.set/delete`）；⑪`notifyUpdated(ref)`。**官方保证（含已登记的例外）**：写失败/抛错时文件与内存快照都不变 → 原值保持生效、无半提交可见。**例外（P1 的 INVARIANT 语义）**：`notifyUpdated` 对普通 listener 失败 contained，但同步 listener 抛 `code === 'INVARIANT'` 时会在全部 listener 跑完后 rethrow——官方 `dsh-credentials` 自带的 invariant listener 正属此类；此时**官方写入已提交（文件与快照已更新）但 `set()` 的 Promise 仍会 reject**。门面因此**不得**把「写 Promise reject」直接等同于「未提交」：reject 后必须 `resolve(ref)` 复核，值等于提交值 → 报告 `committed`（附 bounded diagnostic 说明观察者 invariant 失败），否则报告 typed 失败（此时原值保持生效）。该复核规则见 Task 1.5，行为见 Task 6.2。
- **P3 层级与读形状**：`resolve(ref)`（:234–251）→ env 继承（`source:'env'`）> 管理存储（`source:'file'`）> `.env` 回退（`source:'project-env'|'user-env'`）> `undefined`；`describe(ref)`（:252–273）→ env `{configured:true, source:'env', writable:false}`；存储 `{configured:true, source:'file', writable:true}`；`.env` 回退 `{configured:true, source:<fallback source>, writable:true}`；未配置 `{configured:false, writable:true}`。层规则（P1 模块文档）：空值存储等于处处缺席。**注意**：`.env` 回退层的 `writable: true`——只读信号只来自 env 继承层（门面以 `describe(ref).writable === false` 判 `read-only`，不得据 `source` 自行推断只读）。
- **P4 无 CAS**：`set(ref, value)` / `unset(ref)` 签名实测无 revision/expected 参数（P2）→ Req 3.2 的 B 类模拟成立；唯一可用的比较依据是门面自己维护的 per-ref 标记，其唯一事实来源是官方 `credentials/updated`（P1）。
- **P5 既有门面资产**：`services.credentials` 白名单成员仅 `resolve`/`describe`（`lib/official-service-definitions.js` + registry `servicesWhitelist`；本 feature 不回流写成员）；facade event catalog 已登记 `credentials/updated`（`mode: 'emit'`、payload 仅 `ref`、`fault: 'contain'`，producer authority = 官方 credentials authority）；`lib/client-remote-events.js` 的 `FORWARDED_REMOTE_EVENTS` 已含 `credentials/updated`（既有转发，本 feature 不修改其契约）。**本面零新增事件、零自产事实**。
- **P6 门面接线落点（本线与前两条线的关键差异：顶层新领域，不是 sessions 子面）**：公共 path 为顶层 **`pluginApi.credentials`**（新一等领域，design 已论证成立判据）。接线要点：
  - 根命名空间经 `Object.defineProperty(this, 'credentials', { get() { … } })` 发布，**method 风格 getter**（cordis 以访问上下文为接收者调用访问器 → 取得调用方 shadow 上下文，先例 `agents`/`llm`/`events`；plan-mode 线第四轮终审的箭头 getter 教训同样适用）；
  - `set`/`unset` 是 **caller-bound 写成员**（owner 派生自调用方 fiber）→ 子面按访问合成（`surfaceFor(callerCtx)` + per-caller WeakMap 缓存），与 `sessions.planMode`/`sessions.permissionPresets` 同一模式；`availability()` 为普通只读成员；
  - feature 经 `_assignFeature('credentials')` 分支（`createFeatureSlot({...})`，成员形状校验）发布到 `this._credentialsSlot`/`this._credentialsSurface`；`unmountFeature` 回退到 `createDisabledCredentialsApi(this._active)`；`_readSlot`/`_disabledSurfaceFor` 必须同步补映射（`_restoreDisabledSurface` 事务回滚路径的唯一依赖）；`KNOWN_FEATURES` 增 `credentials`；
  - 挂载走 `prepareFeature('credentials', api)`（与 sibling 两线一致的生产路径），`lib/index.js` 的 `FEATURE_MOUNTERS` 追加 `['credentials', mountCredentialsMutationFeature]`；`lib/guards.js` 增 `credentials` 分支（探 `ctx.get('credentials')` 的 `set`/`unset` 成员形状 + `describe`，以及 `ctx.on`）。
  - **未挂载态（core active）**：disabled 面**返回** typed 结果而不抛（`set`/`unset` → `{ok:false, code:'unavailable', reason}`；`availability` → `{status:'unavailable', reason}`）。**core inert 时**：操作成员（`set`/`unset`——本面没有只读数据成员）抛 `PluginApiInactiveError`，**`availability()` 仍返回 typed 结果且永不抛错**（sibling 两线已交付口径：`createDisabledSessionPlanModeApi` 的 `unavailable()`/`view()` 先 `assertActive()`，只有 `availability` 无该断言；见 `test/sessions-plan-mode-e2e.test.mjs` 的 inert-core 用例）。
- **P7 owner 派生**：既有 `deriveAdapterRegistrationOwner(callerCtx)`（`lib/llm-adapter-registration.js`；按 `callerCtx.fiber` 匹配 `loader.entries()`，回退 `fiber.name`）；不可归因 → typed `denied`（fail-closed）；caller 自报 owner 一律不接受。
- **P8 脱敏既有机制**：`lib/security-redaction.js` 的 `isSecretShapedString`/`isSecretShapedKey`；`lib/diagnostics-normalize.js` 的 `redactValue(value)`（已用于 permission-presets 线的 reason/诊断 bounded 化）。本线所有 reason/日志/diagnostic 出口统一过「bounded + secret 形状过滤」，且值从不进入结果字段（Data Models 字段白名单：`{ ok, code, reason?, ref?, revision?, expectedRevision?, currentRevision?, persistedAt? }`）。
- **P9 既有精确列表断言的同步点（非穷尽，Stage 4 以 `npm test` 全量失败为准逐一收敛）**：feature 总数 39 → 40（`credentials` 追加在 `FEATURE_MOUNTERS` 末尾相邻处）；受影响文件：`test/host-cutover.test.mjs`（capabilities 前缀列表与发布的根命名空间断言）、`test/index-*.test.mjs`（feature 列表与尾部位置断言，`features.length` 9 处）、`test/official-passthrough-independence.test.mjs`（`BRANCH_ADDED_FEATURES`）、`test/security-policy-assembly.test.mjs`（尾部顺序 pin，追加即全量位移）、`test/registry.test.mjs`（`hostDomainTree → hostSurface.roots` 投影核对，投影实现见 `scripts/registry-snapshot.mjs`）。**新增顶层根**还要同步 registry 的 `hostDomainTree`（补 `credentials`）与 `namespaces` 导航记录。

## Task 1: credential mutation 核心模块（对应 Req 1、2、3、7）

**产出**：`lib/credentials-mutation.js`（纯函数模块，零 harness 依赖可测）+ 单元测试 `test/credentials-mutation.test.mjs`。

- [x] 1.1 结果映射（Req 1.1、2.1、C2/C3 表）：`mapSetResult`/`mapUnsetResult` 全表——committed（`{ ok:true, code:'committed', commitState:'success', ref, revision, persistedAt }`）、unchanged（same-value 跳过与 unset-of-absent 两种，`ok:false` + reason + `revision`（已知时携带））、conflict（`ref/expectedRevision/currentRevision`）、revision-unknown（`ok:false`）、read-only、invalid-input、denied、unavailable、internal；字段集**恰为** Data Models 声明的白名单（**永不含凭据值**），全部冻结。**design Data Models 修订（登记）**：(i) 结果白名单补 `commitState?`（design C2 步骤 3 与结果码说明已声明其存在，仅 Data Models 的字段枚举漏列）；(ii) 审计记录补 `reason?`（bounded、与 sibling 两线一致；design C7/Data Models 原枚举无此字段）；(iii) unset-of-absent 的 `unchanged` 允许携带 `revision`（design.md 的 absent 结果文字未列 revision——以「已知则携带、未知则省略」为准）。三项随 Task 6.7 回写 design 并登记。
- [x] 1.2 前置校验（Req 1.2、2.1、6.1；design C2 步骤 1 顺序）：availability（写成员缺失 → `unavailable`）→ owner（不可归因 → `denied`）→ ref 模式（`/^[A-Za-z_][A-Za-z0-9_]*$/` → `invalid-input`）→ 值（非字符串/空串 → `invalid-input`，**仅 set**）→ backend 可写性（`describe(ref).writable === false` → `read-only`，reason 提示 env 影子需在启动 shell 处理；`configured === false` **不阻止写入**）→ revision 冲突检测（C4）→ 全部在任何副作用之前返回。
- [x] 1.3 revision 标记表与 in-flight 单飞锁（Req 3.1–3.4；design C4；**锁释放规则经 P2b 修正并登记为 design 修订**）：per-ref 单调递增不透明整数；`observe(ref)` 由官方 `credentials/updated` 事实推进（listener **必须同步且内部 containment——抛错只记 bounded diagnostic、不抛出，并把该 ref 标记置为「未知/失效」**；禁止保留陈旧已知标记，见 P2b 前提 (ii)）；**同一门面同步段内原子完成「expectedRevision 比较 + 登记 in-flight」**；持锁期间新到提交立即 typed `conflict`（reason 'racing write unsettled'，不入队、不触官方 seam）；**成功路径在官方写 Promise 结算时释锁**——由 P2b 的事实派发顺序（同步 `notifyUpdated` 先于 Promise 结算）保证此时标记已推进，不存在「已释锁、未推进」窗口；观察桥整体降级时同样在结算时释锁（标记保持未知 → 后续携带 expectedRevision 的提交 fail-closed），**不产生死锁**；**失败路径**于 Promise rejection 释锁；`expectedRevision` 已知不匹配 → `conflict`（携带 expected/current，无值）；无标记证据（挂载后未观察过该 ref）→ 提供 `expectedRevision` 者 fail-closed `revision-unknown`、未提供者放行（声明的 bootstrap 规则）。
- [x] 1.4 幂等跳过（Req 4.3；C2 步骤 2）：host 内 `resolve(ref)`，仅当 `source === 'file'` 且存储值 === 提交值才跳过官方写 seam 并返回 `unchanged`（不产生重复事实、不推进标记）；resolve 失败/形状异常 → 不跳过，走正常提交（保守方向）。
- [x] 1.5 失败分类与**提交后抛错的诚实判定**（Req 1.3、2.3；C2 步骤 4 + P2 例外）：官方抛错 → 按官方语义归类（env 影子/只读类 → `read-only`；disposed/后端缺失类 → `unavailable`；其余 → `internal`）；**写 Promise reject 后必须以「管理存储层」证据复核**（不得只看 `resolve` 的返回值——`.env` 回退层会掩盖真实结果）：
  - **set**：reject 后 `describe(ref)` 报 `configured === true` 且 `source === 'file'`，**且** `resolve(ref)` 返回 `{ source: 'file', value === 提交值 }` → 判为已提交，报告 `{ ok:true, code:'committed', commitState:'success', … }` + 一条 bounded diagnostic（观察者 invariant 失败）；其余（`source` 为 `project-env`/`user-env`/`env`，或值不符）→ typed 失败且**原值保持生效**。
  - **unset**：以**写前** `describe(ref)` 快照为基准——写前 `source === 'file'` 且 reject 后 `describe(ref)` 不再报 `source === 'file'` → 判为已删除（按 committed 呈现）；写前即非 `source === 'file'`（仅 `.env` 回退层持有）→ 官方本为 no-op 提交，按 `unchanged` 呈现；其余 → typed 失败且原值保持。
  - 该层的 `source === 'file'` 限定与幂等跳过规则（步骤 2）同源；env 影子路径在提交前即被 `read-only` 拒绝，不会进入本复核分支。
- [x] 1.6 审计环（Req 7；C7）：feature-authority 内部有界内存环（容量 512、非 durable、`truncated`/`gapSince`、深冻结），记录 `{ seq, at, ownerId, action: 'credential.set'|'credential.unset', ref, outcome, reason? }`；触达 seam 的尝试与提交前拒绝都记录；写失败保留效果 + gap；**只含元数据、永不含值**（含超长/恶意 ref 的 bounded 化）。
- [x] 1.7 脱敏出口纪律（Req 5.1、5.3、5.4；design Secret Visibility 表）：模块返回的一切字符串（reason/diagnostic）先过 secret 形状过滤再 bounded；无法证明脱敏的输出省略内容（fail-closed）；模块**不持有值**（值只在 `await` 官方 seam 的实参位置出现，绝不进结果/审计/日志）。
- [x] 1.8 测试：结果映射全表 / 前置拒绝矩阵与顺序 / 空值与畸形 ref 官方状态不变 / same-value 跳过（不发第二次事实）/ unset-of-absent 的 declared 结果 / env 影子 → `read-only` 且不触 seam / 官方抛错三分类 + 提交后抛错的复核分支 / **并发：同 expectedRevision 两提交（先到 committed、后到 conflict）与无 expectedRevision 并发（至多一个 committed）** / revision-unknown fail-closed 与 bootstrap 放行 / **标记推进失败 → 标记失效 → 后续携带 expectedRevision 的提交得 `revision-unknown`（不得「匹配」通过）** / 审计形状与无值 / 超长与 secret 形状输入（5 万字符、`sk-live-…`）的 bounded + 脱敏（含变异检验）。

## Task 2: 门面接入顶层 `pluginApi.credentials`（对应 Req 8、9、10）

**产出**：`lib/credentials-mutation-facade.js` / `lib/plugin-api-service.js` / `lib/index.js` / `lib/guards.js` 接线 + surface 测试。

- [x] 2.1 命名空间发布（design「Namespace 放置」；P6）：顶层 `credentials` 根，method 风格 getter 内**按访问合成** caller-bound 子面（`surfaceFor(callerCtx)` + per-caller 缓存）；`_assignFeature('credentials')` + `this._credentialsSlot`/`this._credentialsSurface` + `unmountFeature` 回退 + `_readSlot`/`_disabledSurfaceFor` 映射 + `KNOWN_FEATURES`；挂载经 `prepareFeature('credentials', api)`；namespace 在任何状态下都存在（inert core 回退 typed disabled 面）。
- [x] 2.2 写面 `set(ref, value, options?)` / `unset(ref, options?)`（Req 1、2、3、6）：async；调用核心模块完成前置校验 → 幂等 → 官方 seam → 结果映射；`options.expectedRevision` 透传到冲突检测；结果**永不含值**；全程 try 包裹，官方抛错 → typed 结果（不抛穿）。
- [x] 2.3 availability（Req 9.1、9.2）：`{ status:'active'|'degraded'|'unavailable', reason? }` 冻结、**永不抛错**；active = 官方服务在场且 `set`/`unset`/`describe` 形状完整；degraded = 观察桥/revision 推进降级（标记停滞）；unavailable = 服务缺失/写成员缺失/错配；服务在而只读是 **ref 级**信号（`describe.writable === false`，C1 的粒度声明），不进 namespace availability。
- [x] 2.4 fail-safe 挂载与降级隔离（AGENTS §2.6；Req 9.2）：`lib/guards.js` 增 `credentials` 分支（`set`/`unset`/`describe` 形状 + `ctx.on`）；挂载异常只记日志并停用；运行期服务消失 → 各面 typed unavailable，**`services.credentials` 的 resolve/describe 直通与其它能力不受牵连**（Req 10.1 回归）。
- [x] 2.5 authority closure（Req 8.1–8.3）：不向 `services.credentials` 白名单回流 `set`/`unset`（读成员契约原样）；门面不拦截官方 provider 路径与官方产品面；不为私有 storage / `.env` 直写 / 泛化 settings 写入提供任何 shim 或文档推荐。
- [x] 2.6 测试：surface 形状 / 未挂载 typed 降级（core active） / inert core 下成员在场、`set`/`unset` 抛 `PluginApiInactiveError`、**`availability()` 不抛** / 无关能力隔离 / 白名单无写成员回归 / caller-bound 子面（真实 cordis：两个调用方各自子面 + owner 归因，参照 `test/sessions-plan-mode-caller-binding.test.mjs`）/ 异步语义（结果在官方 Promise 结算后才返回，不预发成功）。

## Task 3: 事件复用与可见状态（对应 Req 4）

**产出**：事件桥接线（复用既有）+ 测试。

- [x] 3.1 零新增事件（Req 4.1；P5）：`credentials/updated` 由官方 provider 在提交后派发，门面经**既有** events bus 桥与既有 client 转发白名单承载；本 feature 不新增事件登记、不自产事实、不修改 `lib/client-remote-events.js` 的转发契约。
- [x] 3.2 观察→标记推进（Req 3.1、4.1）：门面订阅官方事实（`ctx.on('credentials/updated', ref => …)`，cleanup owner = feature disposer）推进 per-ref 标记；仅在事务当前（feature 卸载后到达的事件不推进已停用表）。
- [x] 3.3 可见性闭环（Req 4.1、4.2、10.2）：写提交后官方 `resolve` 读到新值（e2e 断言）、unset 后按官方层级回退（env > 无 > `.env` 回退）；读面不缓存不影子（零门面状态）；观察桥降级 → availability `degraded` + 提供 expectedRevision 的提交 fail-closed。
- [x] 3.4 幂等不重复事实（Req 4.3）：same-value 跳过不产生 `credentials/updated`（e2e 计数断言）；unset-of-absent 官方本就不派发。
- [x] 3.5 测试：提交后事件经既有桥可达（含订阅者收到 `ref` payload）/ 重复 same-value 不产生第二次事实 / 桥缺失时 typed 降级且读面仍准确 / 卸载后事件不推进标记。

## Task 4: 三向 secret 分离与逐出口脱敏（对应 Req 5）

- [x] 4.1 输入方向（开放）：文档与实现明确「client → 插件自身 remote → host handler → 本面」为受支持录入路径；本 feature **不新增公共 client 半面**（六问结论）、不新增 remote/slot/codec（Req 5.2）。
- [x] 4.2 出口清扫（Req 5.1、5.3、5.4；design 表逐行）：对 `describe`、本面结果、审计、日志、RPC outcome、异常 cause、快照（无此出口）、client payload（既有转发 payload 仅 `ref`）逐出口断言**值缺席**；异常 cause 不进结果、只在 host 日志按形状过滤后输出；无法证明脱敏的出口省略内容。
- [x] 4.3 测试：脱敏清扫矩阵（含 malformed 输入与官方失败场景）/ 值不出现在 `JSON.stringify(result)` / 恶意值（含 secret 形状、超长、换行注入）不改变输出形状 / client payload 形状校验（既有转发契约不变）。

## Task 5: capability、availability 与登记（对应 Req 9.3、11.5）

- [x] 5.1 运行时 capability：`lib/capability-descriptors.js` 增 `entry('credentials', 'mutate', ['credentials'])`；`lib/capability-matrix.js` 增同名 cluster 行；`lib/namespace-availability.js` 的 `HOST_NAMESPACE_RECORDS` 增 `credentials`（`{ path: '', capabilityPath: 'credentials' }`）。
- [x] 5.2 canonical registry：
  - 三条成员行（design「Registry 拟新增行」）：`credentials.set`（mutation/mutate/**coordinated**/**compare-and-swap**/scope **profile**/authority `official credentials provider`）、`credentials.unset`（同上）、`credentials.availability`（selfDescription/read/pure/**scope `facade`**/authority **`official credentials provider`**）。
  - **design 表修订登记（承 sibling 两线先例）**：design 表把 availability 行写作 `scope: profile` + `authority: facade`，与仓库 40 条 `*.availability` 行的实际惯例（authority 全取域 authority、scope 以 `facade` 为主流；已交付 `sessions.planMode.availability`/`sessions.permissionPresets.availability` 均为 `facade` + 域 authority）及 sibling 两线的修订判例相反。本 tasks 取 **`scope: facade` + `authority: official credentials provider`**，并在 Task 6.7 把这处 design 表修订与回写一并登记（含具体 authority 字符串）。
  - 完整字段集（未适用显式 `null`）、`failureSemantics: 'discriminated-result'`、`migrationAction: null`（新成员）、`status: 'advanced'`、`kind: 'leaf'`；`conflictRule` 的 B 类模拟在 design 与 registry 双处标注（registry `currentShape`/`lifecycle` 文字中写明"facade optimistic compare over official updated facts; the official write chain stays the final arbiter"）。
  - **`hostDomainTree` 增 `credentials` 根**（新顶层领域；与 README/registry 领域树一致）+ `namespaces` 增 `credentials` 导航记录（runtime host、capabilityPath `credentials`、`contributingFeatures: ['credential-mutation-contract']`、`availabilityMember: 'credentials.availability'`、`availabilityExemption: null`）。
  - `capabilityMatrix` 增 `credentials` cluster 行（`status: 'retained'`、`currentPaths`/`targetPaths` = 三条叶子、`affectedConsumers` 填已登记相关线（如 `interactive-session-access`；按实际更新）、`verification: ['registry-draft','capability-matrix']`）。
  - `eventCatalog` **不新增**（`credentials/updated` 已登记）；`servicesWhitelist` 的 `credentials` 条目不变（不回流写成员）；validator 全绿。
- [x] 5.3 文档同步：`docs/specs/plugin-api-features/feature-list.md` §7 追加交付条目（含 host-only 六问、三向分离、B 类模拟标注、与 settings/storage 的分工交叉引用、vision-toolkit 迁移切片说明）；`README.md` 增 `pluginApi.credentials` 小节（顶层根 + 写面 + 脱敏纪律）。
- [x] 5.4 测试：capability/availability 镜像一致 + registry validator + P9 精确列表断言同步（39 → 40、根领域树断言）。

## Task 6: 端到端验收与迁移证据（对应 Req 11）

**产出**：`test/credentials-mutation-e2e.test.mjs` + 共享基座 `test/credentials-mutation-test-kit.mjs` + `test/credentials-mutation-migration-slices.test.mjs` + `test/credentials-mutation-caller-binding.test.mjs`。

- [x] 6.1 e2e 基座（**真实官方组件优先**）：在真实 `@deepseek-ai/cordis` 树上装配**真实 `@deepseek-ai/dsh-credentials-local` 的本地 provider**（真实独占写链、文件锁、原子替换、层级与 notifyUpdated）+ 临时目录中的凭据文档（`temp/` 或 `os.tmpdir()`，用毕清理）；真实 `@deepseek-ai/dsh-settings` 如需则按声明依赖取舍。无法用真实链表达的降级场景（服务缺失、写成员缺失、只读 backend）用探针形状替身并标注。**Req 11.1 的"真实持久化"必须由真实 provider 承载**（写后官方 `resolve` 读到新值）。
- [x] 6.2 写语义（Req 11.1）：set 新建 / update 覆盖 / committed 后官方 resolve 读新值 / unset 后官方层级回退 / unset-of-absent 的 declared 结果 / ref 模式与空值前置拒绝（状态不变）/ same-value 幂等（无第二次事实）/ 写失败保持原值（注入后端故障：只读文件/锁冲突/进程内 mock 故障——断言文件与 resolve 均保持旧值）/ **提交后抛错的复核端到端**（注入官方 `credentials/updated` 的 INVARIANT 型 listener 使其在提交后 rethrow：断言 set 被诚实报为 `committed` 而非失败；再构造「仅 `.env` 回退层持有同值」的场景断言不产生假 `committed`；unset 同理断言已删除/未删除两种判定）。
- [x] 6.3 冲突（Req 11.2）：expectedRevision 匹配/不匹配/无证据三分支 / 同 expectedRevision 的并发提交确定裁决（先到 committed、后到 conflict，最终存储值为先到值）/ 无 expectedRevision 的并发提交至多一个 committed / conflict 上下文含 expected/current 且无值 / 模拟的 B 类标注在 registry 断言中可查。
- [x] 6.4 脱敏清扫（Req 11.3）：逐出口（describe、availability、audit、日志、RPC 结果、异常 cause、client payload）在成功/畸形/失败三类场景下断言值缺席；含"官方错误消息含路径/ref 但不含值"的实测与门面附加过滤的变异检验。
- [x] 6.5 信任与降级（Req 11.4）：不可归因 → `denied` 且状态不变 / 只读 backend（env 影子 ref → `read-only`，不触 seam）/ 写 seam 缺失 → `unavailable` / 无关能力隔离 / **两个独立 plugin tree、反向注册顺序** + owner 派生（`CallerA`/`CallerB` 各自归因）。
- [x] 6.6 迁移 slices（外部仓库不在工作区）：A——`dsh-vision-toolkit` 设置页保存流程（原：插件校验 revision/ref 后直调官方 `credentials.set`；迁：`pluginApi.credentials.set(ref, value, { expectedRevision })` + 结果码分支渲染）；B——provider 集成插件在启动/设置变更后清理凭据（原：直调官方 `unset`；迁：`unset` + 官方回退语义断言）。
- [x] 6.7 design 回写（逐项登记）：(a) P1–P8 的运行结论（含真实 provider 行为、事实派发顺序 P2b、冲突裁决实测、脱敏出口实测）；(b) **C4 的锁释放规则**改为「官方写 Promise 结算时释放」并写明 P2b 依赖（同步且受 containment 保护的 listener）；**同批修订 C4 的论证前提**（现文「标记只在提交结算后才推进」与 P2b 相反，须改为「同步派发先于结算」）、**标记推进失败的故障策略**（标记置「未知/失效」→ 后续携带 `expectedRevision` 的提交 `revision-unknown` fail-closed；与 design Error Handling 既有声明一致）与 **Concurrency 节的「per-ref 串行化与 liveness」段**（现文逐字复述旧释放规则）；(c) **C2 步骤 4 增加「提交后抛错复核」规则**（INVARIANT 例外下的诚实判定）；(d) **Data Models 结果白名单补 `commitState?`**、**审计记录补 `reason?`**、**unset-of-absent 的 `unchanged` 允许携带 `revision`**；(e) **Registry 表 availability 行改为 `scope: facade` + `authority: official credentials provider`**。所有修订在交付报告与执行注中列出；如实测与探针不符，先修 spec 再改实现。

## Task 7: 全量验证、全局终审与提交

- [x] 7.1 `npm test`（4G 护栏）全绿；治理 token 审计不新增泄漏（含 `Req N`/`Task N` 形态的自觉避免）；client bundle `--check` 一致（host-only，预期无 client 产物变化）。
- [x] 7.2 全局终审（阻塞式、只读）：只审整体交付与 Tasks/Design/Requirements 一致性 + `docs/standards/` 适用分册（尤其 `visibility-and-redaction.md` 逐出口与 `durability`/`concurrency` 声明）；返回「无偏差」后才可进入 7.3；有意见则集中修订并再次派审（**纯措辞/登记级小修改就地闭合并登记，不再回派复审**）。
- [x] 7.3 `git diff --check` 干净；终审通过后按阶段提交规则提交本 Stage 4 交付并完成最终登记。

## 执行边界

- 版本冻结：不步进任何版本字段（AGENTS §3.0.1）。
- 不新增 R 包、不替换/禁用官方行、不 patch 官方包、不重写官方 credentials 组件；门面零缓存、零影子凭据状态（事实源 = 官方 provider）。
- 不提供 approval 授权、不注册 security policy、不提供私有 storage 或泛化 settings 写入 shim（Req 8.2）；不新增公共 client 半面（host-only）。
- 入口与运行期 fail-safe：挂载失败只记日志并停用；成员一律 typed 结果，绝不抛穿 apply/dispatch；availability 永不抛错。
- 冲突检测是**门面声明式 B 类模拟**（官方无 CAS），登记与文档中永不表述为官方仲裁；模拟层故障 fail-closed（`revision-unknown`）。
- v1 无公共审计查询成员；审计经 feature 内部测试缝验证，不新增公共面。

## Stage 3 对抗性审查记录（第一轮）

结论「有意见」八条（2 高 / 3 中 / 3 低），逐条处置：

1. **（高）`credentials.availability` 行的 scope/authority 与 design 表相斥且未登记修订** → tasks 取 **`scope: facade` + `authority: official credentials provider`**（仓库 40 条 `*.availability` 行的实际惯例 + sibling 两线判例），并在 Task 5.2 增加 **design 表修订登记** 条款、Task 6.7 列为回写项 (e)（含具体 authority 字符串）。
2. **（中）结果/审计字段集与 design Data Models 不等** → 三处均以 design 修订登记收口：结果白名单补 `commitState?`（C2 与结果码说明已声明存在，仅 Data Models 漏列）、审计补 `reason?`（与 sibling 两线一致）、unset-of-absent 的 `unchanged` 允许携带 `revision`（已知则携带）；Task 1.1 内联登记、Task 6.7 回写项 (d)。
3. **（高）in-flight 锁的成功路径释放条件在观察桥降级时不可满足（liveness 矛盾）** → 经源码复核补 **P2b**：官方 `notifyUpdated` 在队列操作内**先于**写 Promise 结算同步派发，门面 listener 同步 ⇒ 结算时标记必已推进；据此把锁释放规则钉死为「**官方写 Promise 结算时释锁**」（正常路径无「已释锁、未推进」窗口；桥整体降级时同样释锁、标记保持未知 → 后续携带 expectedRevision 的提交 fail-closed，**不死锁**），并把该修正登记为 design C4 修订（Task 1.3 内联 + Task 6.7 回写项 (b)）。
4. **（中）P2 的「官方保证」忽略 INVARIANT 例外，失败映射缺「提交后抛错」分支** → P2 补记例外（同步 listener 抛 `INVARIANT` 时全部 listener 跑完后 rethrow，**官方已提交但 Promise reject**），Task 1.5 增加**提交后复核规则**（reject 后用官方 `resolve` 判定：值等于提交值 → 报 `committed` + bounded diagnostic；否则报 typed 失败且原值保持），e2e/Task 6.2 覆盖。
5. **（中）P6 未挂载态的 inert-core 语义与既有实现口径不符** → 区分两态：core active 且未挂载 → 成员一律返回 typed 结果；**core inert** → 操作成员（`set`/`unset`）抛 `PluginApiInactiveError`，`availability()` 仍返回 typed 且永不抛（sibling 已交付口径，附代码与用例锚点）；Task 2.6 同步。
6. **（低）P9 两处指认与仓库事实不符** → 更正为：`hostDomainTree → hostSurface.roots` 投影核对在 `test/registry.test.mjs`（投影实现 `scripts/registry-snapshot.mjs`）；删除对 `test/namespace-availability.test.mjs` 的错误指认。
7. **（低）`_unmountFeature` 不存在** → 方法名更正为 `unmountFeature`。
8. **（低）「官方抛错四类归类」无定义的第四类** → 更正为「三分类 + 提交后抛错的复核分支」（与 Task 1.5 一致）。

修订后：探针 P1–P9 的事实性经审查方独立复核（仅行号偏移与上述 P2/P6/P9 表述问题，已逐条更正）；分册对照中仅 `concurrency-and-cancellation` 一项因意见 3 判为偏差，已通过锁释放规则修订闭合；其余分册适用/符合。

### 第二轮（复审）意见与处置

复审确认第一轮 8 条闭合（availability 行取值与修订登记、字段集三处登记、P2b 事实与不死锁结论、inert-core 两态、三处事实更正），另指出 4 条（1 高 / 1 中 / 2 低），均已就地修订：

1. **（高）提交后复核查核缺「管理存储层」限定，可产生假 `committed` / 假失败** → 复核规则改为以 `source === 'file'` 为管理层的唯一证据：**set** 要求 reject 后 `describe` 报 `source === 'file'` 且 `resolve` 返回 `{source:'file', value === 提交值}` 才判已提交（仅 `.env` 回退层持有同值不得判成功）；**unset** 以写前 `describe` 快照为基准（写前 `file` → 写后非 `file` 判已删除；写前非 `file` 判官方 no-op → `unchanged`）。env 影子的路径在提交前即被 `read-only` 拒绝，不进入该分支；该限定与幂等跳过规则同源。
2. **（中）design 回写项 (b) 范围不完整** → 回写清单扩展为同批修订三处：C4 释放规则、**C4 的论证前提**（「标记只在结算后推进」→「同步派发先于结算」）、**Concurrency 节「per-ref 串行化与 liveness」段**（现文逐字复述旧规则）。
3. **（低）P2 尾句与第一轮记录声称 Task 6.2 覆盖复核行为，而 Task 6.2 无此用例** → Task 6.2 补入「提交后抛错的复核端到端」用例（INVARIANT listener 注入 + 仅 `.env` 回退层同值的反例 + unset 两种判定），使交叉引用成立。
4. **（低）P2b「必然已推进」的两个未声明前提** → 显式登记：(i) unset-of-absent 早退不派发（无官方变更，不影响不变量）；(ii) listener 必须**同步且内部 containment**（抛错只记 bounded diagnostic、不推进标记 → 携带旧 `expectedRevision` 的后续提交得 `conflict` 而非静默覆盖，方向 fail-closed）；Task 1.3 同步钉死该 listener 契约。

### 第三轮（复审）意见与处置

复审确认第二轮 4 条中 3 条闭合（管理层限定、回写范围、Task 6.2 覆盖、P2b 前提 (i)），另指出 1 条**高**：P2b 前提 (ii) 的 fail-closed 方向写反——标记推进失败而**保留陈旧已知标记**时，持有该旧 revision 的后续提交会「匹配」通过并静默覆盖（fail-open，违反 Req 3.1/3.2）。已按审查方给出的正确处置修订：

- **标记推进失败 → 该 ref 标记置「未知/失效」**（禁止保留陈旧已知值），后续携带 `expectedRevision` 的提交按 design Error Handling 既有声明得 `revision-unknown`（fail-closed，不退化为放行）；不带 `expectedRevision` 的提交按 bootstrap 规则放行并以本次事实重建基线。三处同步：P2b 前提 (ii)、Task 1.3 的 listener 契约、Task 6.7(b) 的 design 回写（携带该故障策略）。
- Task 1.8 增补单测：**标记推进失败 → 标记失效 → 后续携带 expectedRevision 的提交得 `revision-unknown`（断言其不得「匹配」通过）**。

## Stage 4 执行注（2026-09-13）

**交付物**：`lib/credentials-mutation.js`（核心：结果映射、前置校验顺序、管理存储层复核、revision 标记表与 per-ref 单飞门、审计环、脱敏纪律）、`lib/credentials-mutation-facade.js`（挂载与 caller-bound 子面）、`lib/index.js`（FEATURE_MOUNTERS 接线）、`lib/guards.js`（`credentials` guard 分支）、`lib/plugin-api-service.js`（disabled 面工厂、**顶层 `credentials` 根的方法式 getter 与按访问合成**、`_assignFeature`/`_readSlot`/`_disabledSurfaceFor`/`unmountFeature` 分支、`KNOWN_FEATURES`）、`lib/capability-descriptors.js`/`lib/capability-matrix.js`/`lib/namespace-availability.js`（运行时镜像）、canonical registry（**三条成员行 + `hostDomainTree` 新增 `credentials` 根 + `namespaces` 导航记录 + `capabilityMatrix` cluster 行**）、`README.md` 与 feature-list §7 条目、design 修订登记（C2 步骤 4、C4 释放规则与故障策略、C4/Concurrency 前提、Data Models 三处、Registry availability 行）与「Stage 4 运行结论（P1–P4 回写）」一节；测试 `test/credentials-mutation.test.mjs`、`test/credentials-mutation-e2e.test.mjs`、`test/credentials-mutation-caller-binding.test.mjs`、`test/credentials-mutation-migration-slices.test.mjs`，共享基座 `test/credentials-mutation-test-kit.mjs`。

**与 Task 文字的偏离（逐条登记理由）**：

1. **e2e 基座用真实官方 provider，全程不启用 watcher**：真实的 `@deepseek-ai/dsh-credentials-local` 挂载在真实 cordis 树上（临时凭据文档、`watch` 默认关闭）。理由：watcher（chokidar）在测试进程内保持句柄、导致 `node --test` 不退出；外部编辑场景改为在 seam 上直接投递等效官方事实（`authority.observeUpdated`），语义与 watcher 热发布一致，且不依赖时序。
2. **「写失败保持原值」用注入的官方 seam 故障取证**（临时替换 provider 的 `set` 使其抛出且不提交），而非 `chmod 0400`：后者在具备写权限的环境下不可复现；注入式故障对「typed 失败 + 原值与文档不变 + 恢复后可用」的断言是确定的。
3. **caller 绑定与「两个独立 tree」合并到一个专用测试文件**：两棵独立 harness 共享同一凭据文档（真实 provider 对同一路径的两个实例），注册顺序 A→B、行动顺序 B→A，断言各自子面、审计 owner 归因与匿名上下文 `denied`；e2e 另有一处同树双 caller 用例。
4. **`inspection`/`revisionOf`/`invalidateRevision` 为内部测试缝**（非公共成员）：用于断言标记推进与失效策略；`revisionOf` 返回 `{ known, invalid, revision? }` 冻结视图。
5. **标记失效后「不带 expectedRevision 的提交」放行**：与 design C4 的 bootstrap 规则一致（无标记证据时提供 expectedRevision 者 fail-closed、不提供者放行并以本次事实重建基线），实现中把失效检查放在比较点内而非前置校验里，避免把 bootstrap 路径一并封死。

**登记的 design 修订（Task 6.7 回写，均已落盘）**：(a) P1–P4 运行结论新增「Stage 4 运行结论」一节；(b) C4 释放规则改为「官方写 Promise 结算时释锁」并写明 P2b 依赖、C4 的论证前提改为「同步派发先于结算」、Concurrency 节「per-ref 串行化与 liveness」同步；(c) C2 步骤 4 增加提交后复核规则；(d) Data Models 补 `commitState?`、审计补 `reason?`、unset-of-absent 的 `unchanged` 允许携带 `revision`；(e) Registry 表 availability 行改 `scope: facade` + `authority: official credentials provider`。另额外登记「标记推进失败 → 标记失效」的故障策略（Stage 3 第三轮审查意见）。

**既有精确列表断言的同步点（P9 + 实跑补全）**：`test/index.test.mjs`（feature 快照 + 总数 40）、`test/index-agent.test.mjs`、`test/index-session.test.mjs`、`test/index-session-durable.test.mjs`、`test/index-tools.test.mjs`、`test/index-events.test.mjs`、`test/index-system-prompt.test.mjs`、`test/index-profile.test.mjs`、`test/index-remote.test.mjs`、`test/index-diagnostics.test.mjs`、`test/host-cutover.test.mjs`、`test/official-passthrough-independence.test.mjs`、`test/security-policy-assembly.test.mjs`（`credentials` 追加在 `FEATURE_MOUNTERS` 末尾 → 尾部倒数索引全量 +1）；`index.test.mjs` 的健康 fixture 补 `credentials` 服务桩。

**工程债登记（非阻塞）**：三条 mutation 线（plan-mode、permission-presets、credential-mutation）各自持有结构相同的 bounded audit ring；仍建议由 `plugin-api-m10-contract-convergence` 线在整树收敛时统一抽取并登记（与 permission-presets 执行注同一笔）。

### Stage 4 全局终审（第一轮）意见与处置（2026-09-13/14）

终审返回「有意见」4 条（1 高 / 2 中 / 1 低），全部实质修订：

1. **（高）Task 6.2/6.3/6.5 声明的端到端项缺证据而 checkbox 已勾选、design 运行结论随之过度声明** → 逐项补齐：(a) 新增 e2e「提交后抛错（真实链）」用例——在真实 cordis 树上挂载同步抛 `code:'INVARIANT'` 的 `credentials/updated` listener，断言 `set`/`unset` 在文档已提交后仍被诚实报为 `committed`；`.env` 回退反例**登记为环境限制**（e2e 基座未装配 `launchEnvironment` 分层服务），其语义由单测（`fallback` + `setThrows`）与 `source === 'file'` 规则覆盖，并在 design 运行结论中如实标注；(b) 新增 e2e「同 `expectedRevision` 并发提交」用例（真实 provider 上先到 committed、后到 typed `conflict`，最终文档值为先到者）+ 单测同 revision 二次提交（结算后标记已推进 → `conflict`，不产生第二次提交）；(c) 新增 e2e「写 seam 缺失」用例（`noProvider`：`set`/`unset` → `unavailable`、availability `unavailable`、无关能力可用）。
2. **（中）Task 2.6/3.5 声明的 facade 生命周期测试未交付** → 新增 `test/credentials-mutation-facade-lifecycle.test.mjs` 四个用例：未挂载（core active）→ 成员在场且 `set`/`unset` 返回 typed `unavailable`；inert core → 成员在场、操作成员同步抛 `PluginApiInactiveError`、`availability()` 不抛；事实流订阅失败 → availability `degraded` 且写面仍可提交（无 revision 可观）；`prepared.rollback()` + `feature.disposer()` → 命名空间 typed unavailable、feature 订阅精确释放、teardown 后事实不推进退役 authority。
3. **（中）`unavailable`/`denied` 结果原样回显未校验的 ref（secret 形状、超长无界）** → 核心模块修订：前置校验**通过之前**的拒绝（`unavailable`/`denied`/`invalid-input`）不再携带 `ref`（调用方自知其输入）；通过校验的 ref 与所有 reason 一律 `bounded(…, 240)`（提交/unchanged/冲突/失败四类结果同规则）；单测新增「秘密形状与 5 万字符 ref 的回显清扫」用例。
4. **（低）design C3 的 absent reason 字面与实现不一致** → design 字面同步为实现的 `'ref absent from managed storage; nothing to remove'` 并在 Stage 4 修订登记中标注。

### Stage 4 全局终审（第二轮）意见与处置（2026-09-14）

第二轮确认第一轮 4 条全部实质闭合（含 ref 回显探针复现、真实链 INVARIANT/并发证据、facade 生命周期三态、C3 字面），另报 2 条：

1. **（中）facade 生命周期用例 4 的「teardown 后不推进标记」断言恒真** → 复核属实：`invalid === false` 无法区分「正确 no-op」与「退役后仍推进」。已改为在 dispose 前断言标记已 known（真实提交被观察），dispose 后投递事实并 `deepEqual(revisionOf(REF), { known: false, invalid: false })`——删除 `!current` 守卫或用例行为错误都会变红。
2. **（低）Task 6.2 的「空值前置拒绝（状态不变）」缺 e2e 实例** → e2e 脱敏用例补入：`set(REF, '')` 与 `unset('bad-ref')` 的 `invalid-input` 断言，并比对拒绝前后 durable 文档内容完全一致。

### Stage 4 全局终审（第三轮）结论（2026-09-14）

**无偏差**。审查方以变异推演确认：facade 生命周期用例的标记断言现已能区分「正确 no-op」与「退役后仍推进」（删除 `!current` 守卫即变红）；空值拒绝的 e2e 实例与文档前后比对真实有效；两处修订未引入新偏差。门全部通过（registry validator、feature 五个测试文件、全量 `npm test` 3308/3308、`git diff --check`、client bundle `--check`）。据此进入 Stage 4 完成提交。
