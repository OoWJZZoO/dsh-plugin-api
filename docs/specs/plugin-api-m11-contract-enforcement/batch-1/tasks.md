# Stage 3 Tasks: plugin-api-m11-contract-enforcement

> feature_name: `plugin-api-m11-contract-enforcement`
> milestone: M11
> status: Stage 3 已产出（2026-09-14）。Stage 0–2 已交付（同日，四轮提交：`f273202`、`3b18b75`、`4a63e32`、`cf2a2d1`）。本文按 design §11 的依赖顺序编排，但把「§4 分册修订」提到「§2 逐成员映射」之前，依据是 design §4 的明文纪律「修订未落盘前，实现不得先落新形状」；design §11 只要求「按 §1 内核 → §2 映射 → §4 分册修订的依赖顺序」，未禁止该调序。Tasks 经**阻塞对抗性审查**通过后，**先提交 tasks.md（Stage 3 阶段提交，AGENTS §3.2「阶段提交（强制）」）**，再进入 Stage 4；不提交用户评审。
> 输入溯源：`goal.md`（十条 Scope direction）；`requirements.md`（Req 1–14 与 Scope direction 对应表）；`design.md`（§1 内核 K1–K8、§2 逐成员处置映射 A/B/C1–C17/R1–R6、§3 idiom 归类与例外变更、§4 分册修订清单 S1–S15、§5 owner 模型、§6 失败路径、§7 装配影响与落点、§8 验收与证据映射、§9 风险与排除、§10 分册适用性、§11 阶段边界）。
> 批次注：本文件属 M11 **第一批次**（契约落实，2026-09-14 产出、2026-09-16 收口）。自 2026-09-21 起本批制品位于本 feature 目录的 `batch-1/` 子目录（目录重排由人类指示）；第二批次（实效收口）制品见同 feature 目录的 `batch-2/`。除路径引用与文首批次注外，本文件内容未改写。
> 执行口径：版本冻结基线内交付（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`），不步进任何版本字段；**本线不新增 R 点**，仅在三处既有替代包自身的扩展面内修订（`packages/agent-loop`、`packages/attachments`、`packages/mcp`）并维持被替代官方行的契约复刻（R2）与 boot 自检（R4）；官方包文件零修改；所有入口 fail-safe（apply 不抛穿）。
> 连续执行纪律（AGENTS §3.2「Stage 4 连续执行纪律」）：Stage 3 审查门通过后，本线 SHALL 在同一工作序列内完成全部顶层任务直至 Stage 4 完成判定；**只有两类因素可以合法停下**——触及硬停机点（版本与发布、milestone 范围），或因环境 / 工具链 / 权限缺失而确实无法完成的已授权工作。不得以批次边界、会话长度、上下文占用、任务规模或「已交付部分成果」为由终止未完成的主体工作；未完成项不得登记为「阻塞项」——「阻塞项」的判定标准是代理**无法**完成，而非**尚未**完成。
> 执行纪律（design §7 / §9-5、AGENTS §3.5）：**本线单线串行执行，不并行派工**。`lib/plugin-api-service.js`、`lib/index.js`、`lib/client-runtime.js`、`lib/namespace-availability.js` 与 `public-contract.registry.json` 为 design §7 指定的热点共享文件，按 Task 编号顺序集中串行修改；任一热点文件在多个 Task 出现时，以本文件编排的先后为编辑边界与合并顺序。
> 治理 token 边界（AGENTS §6、Req 12.4）：本文在 `docs/` 下使用 A/B/C/K/R/S 编号是允许的，但**实现产物不得携带这些编号**——`lib/`、`packages/`、`test/`、`package.json` 与 bundle patch 中的命名、错误文案、Symbol 键、目录/文件名一律使用中立、面向能力或语义的名字（如包名 `@deepseek-ai/dsh-plugin-api-compaction-events`，不得出现 `r1` 之类治理后缀）。Task 9.6 是末端审计，实现者在动手时即须遵守。
> 人类授权记录：`design.md` §4-S9（canonical producer 收紧）与 §4-S10（`capability-strategy.md` 实质修订）原列「需人类确认」。人类于 2026-09-14 在本线 SPEC3 开工指示中**预授权**这两项，故 Task 2.9 / Task 2.10 不再以「待确认」阻塞；两项的确认依据与能力边界变化声明按 design §4 表下注、K8「能力边界变化声明」与 Task 10.3 落盘。
> 审查轮次记录（Stage 3 门）：本文经**四轮**阻塞式只读对抗性审查收敛。第 1 轮改「有偏差」（探针 P5 引用不存在的符号；K2 `dispose()` 落点缺失）→ 第 2 轮改「有偏差」（K2 落点仍不完整；M10 三表镜像无人承载）→ 第 3 轮改「有偏差」（K1/K2/K3 的全树义务未穷尽；行为表口径误解）→ 第 4 轮结论见文末。第 1–3 轮的实质意见已全部就地闭合，其中「全树义务」一项的闭合方式是从「枚举清单」升级为 **Task 4.14 的 registry 驱动枚举方法**（见该条），因为逐轮补枚举无法穷尽；该升级依据 goal Scope direction 2 与 Req 2.1 的无条件表述，属**本线范围的完整化**而非扩大。
>
> 公共契约现状注（2026-09-21，M11 batch-2）：本文中出现的 `slots.list` / `slots.declaration` 已由 `slots.inspect` 取代，`tools.executionMode.register` 已由 `tools.executionMode.get` 取代，`attention.hubSnapshot` 已内部化（内部符号缝 `dsh-plugin-api.attention.snapshot-seed`）；观察入口统一为「单一 subject + 标准四成员 handle + 判别式 dispose」，host `events.observe` 现回答判别式信封，`settings.register` 现回答标准资源 handle。本注只做指针映射，不改写本文的验收边界表述。

## Stage 3 探针记录（开工时基线，Stage 4 以对账与测试复核）

- **P1 基线全绿**（开工时工作区干净，HEAD = `cf2a2d1`）：`npm test` **3469/3469** 通过（4.7s，4G 护栏内）；`node scripts/registry-validate.mjs <registry>` 输出 `registry valid`；`node scripts/convergence-verify.mjs` 输出 `537 member rows, 37 behavior rows, 37 fully linked`；`npm run build:client:check` 输出 `client bundle is up to date with its sources`。Stage 4 的一切「不回归」判定以此四项为基线。
- **P2 registry 骨架实测**：`members` 537、`namespaces` 52、`eventCatalog` 69、`servicesWhitelist` 54、`oldToTargetMapping` 382、`capabilityMatrix` 100、`statusByPath` 177、`clientDomainTree` 14、`hostDomainTree` 26。design 文首记录的五项（537 成员行 / 52 namespace / 100 能力簇行 / 69 事件目录行 / 17 个带 idiom 例外的成员行）与之逐项一致。`servicesWhitelist` 实测为 **54** 键（含 M10 交付的 `appExit`），本线只读登记、不改该键数。
- **P3 `producerAuthority` 已存在于 registry，但 runtime 目录无此声明**：`eventCatalog` 69 行的字段并集为 `name/runtime/eventSemantics/scope/payloadShape/freeze/priority/observerFailure/producerAuthority/dispatch/implementationChannel/decisionPrecedence/conflictConvergence/listenerFailureDefault/participationChannel`，**每行均已带 `producerAuthority`**，且 `scripts/registry-validate.mjs:420` 已把它列为必需非空字段。但运行时事件目录模块（`lib/events-catalog.js` 的 `entries`、各 `*-events-catalog.js`）**不携带任何 producer 归属**，`lib/events-bus.js:639` 的 `dispatch()` 也只校验事件名在目录内。⇒ K8/S9 的**新工作量在运行时侧**：把 producer 归属带入运行时目录并在派发点判定；registry 侧只需补「未声明 producer 的条目」与 `observation`/`notification` 的区分登记，**不重设事件总线**。
- **P4 `lib/events-bus.js` 的订阅/派发分层实测**：门面监听经 `ctx.on(name, wrapped)` 注册（`reconcile()`，`:134-157`），派发经公共成员 `emit/serial/parallel/bail/waterfall` 调用 `dispatch()`（`:855-871`），后者执行 `ctx[mode](name, ...args)`。官方插件自身的派发走原生 `ctx.emit`，**不经过 `dispatch()`**。⇒ K8 的判定点落在 `dispatch()` 一处即可覆盖「第三方经门面派发」；官方与门面转译路径不经该函数，天然不受影响，但**门面自有的、经公共成员的内部生产路径必须显式取证**（见 Task 7.3）。
- **P5 `lib/namespace-availability.js` 归一分支实测**：`availabilityOf` 内的 `normalized(raw, resolved)`（`:130-144`）只有两条存活分支——`AVAILABILITY_STATUSES.includes(raw.status)` 时返回冻结 `{ status, reason? }`（`:132-134`），`typeof raw.active === 'boolean'` 时返回 `{ status: raw.active ? 'active' : 'unavailable' }`（`:136-137`）；随后 `resolved && typeof existing === 'function'` 一律回落冻结 `{ status: 'active' }`（`:140-142`，即「函数解析成功即 active」）。**领域对象的其余字段在存活分支上被丢弃**（只取 `status` 与字符串 `reason`）。非三值状态的处理分两条路径：领域 availability 为函数且解析成功时，因 `resolved === true` 先命中 `:140-142` 而报 `active`（这正是 K4 要删除的分支）；`existing` 为普通记录时走 `normalized(existing, false)`（`resolved === false`），落到 `statusOf(capabilityPath)` 回退（`:143`）。与 design §1-K4 / §2-C1 的描述一致。
- **P6 `tools.register` 双形态实测**：`lib/plugin-api-service.js:470-531` 的 `scopedRegister` 返回冻结 `{ id, ownerId, targetId, dispose() }`，`dispose()` 经 `registry.removeScoped(...).status === 'ok'` 返回**布尔**并由 `try/catch` 吞异常；无 `opts.scope` 时 `register` 直接透传 `tools().register(definition)` 的官方裸 disposer。与 design §2 A1 一致。
- **P7 基线观察 handle 实测**：`lib/sessions-plan-mode.js:437-470` 的 `observe(agent)` 返回冻结 `{ epoch, current(), subscribe(listener), dispose() }` 形状（`subscribe` 返回退订函数、内部 `record` 含 `listeners` Set 但**不外泄**、dispose 后 no-op、listener 异常只降级该监听者）；`lib/sessions-permission-presets.js:531` 同形。⇒ 二者是 Task 1.4（K5 内核）与 Task 5 全部观察面收口的**形状基准**，不重造第三套。
- **P8 内核现状分散**：仓内已有 owner 派生机制 `callerIdentityOf`（`lib/profile-mutation.js:98`，回退 `ROOT_OWNER_TOKEN = 'root'`，定义在 `:60`）与 `FACADE_OWNER_IDS`（`lib/plugin-api-service.js:1035`，含 `@deepseek-ai/dsh-plugin-api-main` 与 `plugin-api-main`）；generation 铸造为逐模块自建（`lib/decision-participation.js:222` 的 `nextGeneration(ownerId)`、`packages/session-branch/lib/delegate.js:80` 的 `makeGeneration()`、`packages/mcp/lib/connection.js:72` 的 `nextGenerationId`），**无统一 helper**。⇒ Task 1 只统一「handle / dispose 结果 / observe / contribution 结果」四类重复形状（K1、K2、K5、K6、K7），**不**建全局 generation 铸造器（design §5 已定 generation 为 owner-specific opaque token，逐 owner 自铸是正确形状，统一铸造反而违反 §2 语义）；owner 派生（K3）沿用上述既有机制、只统一调用面，canonical producer 判定（K8）落在 `lib/events-bus.js` 单点，二者均**不**进 `lib/contract-kernel.js`（见 Task 1 的覆盖边界声明）。
- **P9 分册修订面实测**：`docs/standards/` 现行 12 分册 + `README.md`（31 行）。S1/S2 的冲突点确认在位——`api-idioms.md:33` 的 `generation` 定义仅「可比较的并发控制令牌」且明文「注册顺序使用 `seq`」，`api-idioms.md:53`（policy handle）与 `:86`（resourceRegistry handle）强制 handle 含 `generation`，而 `api-idioms.md:54` 又要求「注册错误以 typed error 表达，不返回 `ok:false`」，与 `public-api-shape.md:143` 的「返回**或**抛出 capability-unavailable」形成两册并存口径。`public-api-shape.md` §2 host 树仍含 5 个已 `removed` 的订阅名——`llm.routing` 行的 `on` / `once`（`:26`，同段还混入仍为 `advanced` 的 `wait`）、`executions` 行的 `onChange`（`:35`）、`sessions` 行的 `onDurable` / `onceDurable`（`:46`）；`public-api-shape.md:137` 的 `events.compaction` 不存在（即 C16）。⇒ Task 2 的 15 条修订逐条可核对，无需新增探针。
- **P10 校验脚本可扩展面**：`scripts/registry-validate.mjs` 已有 `MEMBER_FIELDS`（28 字段全集要求）与 `failureByIidom`（同 idiom 单一 `failureSemantics`）两处强校验，是 S1/S12/S15 三条新校验的落点；`MAX_PATH_DEPTH = 5` 是 S8「层级规则」修订须对齐的现行常量。`scripts/convergence-verify.mjs` 以 registry `publicPath` 为连接键校验三表，与 M11 无制表义务冲突，本线不改。

---

## Task 1: 契约内核落定（design §1 K1、K2、K5、K6、K7 的共用形状，对应 Req 2、5、6、7）

**目标**：把 design §1 中**需要跨模块复用的五个内核决策**落成仓库内的**唯一规则来源**，供 Task 4–8 逐领域复用。内核只定义形状与构造方式，不承载领域语义。

**内核覆盖边界**（除本条声明外，K3 / K4 / K8 不设独立内核模块）：design §1 的 K3（owner 身份双角色）以既有机制为准——派生入口 `callerIdentityOf`（`lib/profile-mutation.js:98`）与 `FACADE_OWNER_IDS`（`lib/plugin-api-service.js:1035`）已在仓内，本线只统一其调用面，落点为 Task 2.3（分册）、Task 6.6/6.7（逐成员）；K4（availability 归一）是单一装饰器的就地重写，落点为 Task 2.4（分册）、Task 8.1/8.2（实现）；K8（canonical producer 判定）属事件总线单点语义，落点为 Task 2.9（分册）、Task 7.1–7.5（实现）。**不为 K3/K4/K8 另建内核模块**，以免把领域语义抽进内核（克制设计，design §9-1 / AGENTS §3.0.3）。

- [ ] 1.1 内核落点与共享模块：新增内部模块 `lib/contract-kernel.js`（零 harness 依赖、纯函数、不 import 官方包），导出三组构造器——判别式结果、资源/操作 handle、观察 handle。**只统一 P8 指出的重复形状**，不建全局 generation 铸造器（design §5 已定 generation 为 owner-specific opaque token，逐 owner 自铸是正确形状，统一铸造反而违反语义）、不建反射式注册框架。
- [ ] 1.2 K1 注册 handle 构造：`policy` / `resourceRegistry` handle 固定 `{ id, ownerId, generation, dispose() }`；handle 上的**领域扩展成员**（`.replace`、`targetId`、`status()`、`snapshot()`、`meta`、`result`、`cancel`、`target`、`face`、`render`）由构造器显式接收并保留，且**不消耗六项例外**（design §3 分类规则 / S12）。
- [ ] 1.3 K2 `dispose()` 结果合同：普通 handle `dispose()` 返回冻结 `{ ok, code, reason? }`；资源类成功码 `revoked`、no-op 码 `stale`；operation handle 成功码 `requested`、no-op 码 `stale`；`dispose()` 幂等、绝不抛穿、绝不撤销新 generation 或其他 owner 的资源。coordination lease 不套用（design §2 B1、Req 2.5 引 api-idioms §3.7）。**本合同对全树普通 handle 生效（Req 2.4「任一普通 handle」），包括 design §2 标为「已修复 / 基准」的成员**（design §1 明文「§2 任何一行与本节冲突时以本节为准并按 §4 修订分册」）；因此其落点义务分列于 Task 4.1–4.11、4.13、4.14、4.15、5.1–5.5、5.11、5.13、6.1–6.4、8.8，**交付后不得存在返回布尔 / `Promise` / `{status}` 的普通 handle，也不得为此新增例外**。该完整性断言由 Task 4.14（registry 驱动的全树枚举收口）与 Task 4.15 / 5.13（补充成员）共同兑现；Task 4.14 的「不可就地收口」规则是唯一合法的例外通道（登记阻塞项，不新增例外）。
  **枚举补充声明**：design §2 的处置表源于指引 §3/§4/§5 的 22 项与子审线索，**不是**对全树 handle 的穷尽枚举。Task 4.14 与 4.15 承接由 registry 现行行与源码复核发现的补充成员（`llm.adapters.register.handle`、`llm.adapters.decorations.register.handle`），`executions.visibility.register` 与 `executions.recovery.*`、`security.*.register`、`agents.decisions` / `tools.executionPolicies` / `prompts.assemblyPolicies` / `events.decisions`、`tools.guard` / `presentation` / `executionMode`、`sessions.channels.auth.*` 等由 Task 4.14 的全树枚举统一收口，其依据是 design §1-K1/K2/K3 的**内核义务本身**（design §1 明文「§2 任何一行与本节冲突时以本节为准并按 §4 修订分册」），最终在 design §2 补行、registry 落行并在台账（Task 10.1）逐条记载。
- [ ] 1.4 K5 观察 handle 构造：返回冻结 `{ current(), subscribe(listener), dispose(), epoch }`，`subscribe` 返回退订函数、handle 已释放时返回 no-op 退订函数、回调异常只降级该监听者、内部可变记录（`listeners` Set / `disposed` / `stale` / `signal` / `abortHandler`）**不外泄**。形状**基准**为 P7 的 `lib/sessions-plan-mode.js:437` 与 `lib/sessions-permission-presets.js:531`（基准指 `epoch`/`current`/`subscribe`/`dispose` 四成员与「冻结、不外泄、释放后订阅 no-op」四项语义；**不含**其 `dispose()` 的布尔返回值——后者按 1.3 与 Task 5.13 统一为判别式结果），供 A5/C5 复用。
- [ ] 1.5 K6 操作结果与终态词汇：发起结果 `{ ok, code, operation, ... }`（`operation` 是控制对象 handle），`terminal` **仅在返回时终态已可裁决时出现**（S13 一般条款，不逐成员登记例外）；长操作 handle 固定 `{ id, ownerId, status(), observe(), dispose() }` 加已登记领域扩展，`observe(listener)` 返回退订函数并首投当前状态；`dispose()` 按 1.3 的 operation 码集返回。
- [ ] 1.6 K7 contribution 结果与 pending handle：`contribute(spec)` 返回冻结 `{ ok, code, reason?, handle }`，handle 为 `{ id, ownerId, seq, dispose() }`（`dispose()` 按 1.3 的资源类码集返回）；异步生效的贡献在返回时即给出 pending handle，其 `status()` 报告 `{ state: 'pending' | 'active' | 'failed' | 'revoked', reason? }`，任一状态下 `dispose()` 安全（S14 一般条款）。
- [ ] 1.7 内核单元测试：新增 `test/contract-kernel.test.mjs`，逐条断言 1.2–1.6 的形状（冻结、码集、幂等、no-op、listener containment、pending 状态机、扩展成员保留）。纯函数模块，零 harness 依赖。

## Task 2: 分册修订落盘（design §4 S1–S15，对应 Req 11）

**纪律**：design §4 明文「修订未落盘前，实现不得先落新形状」。本 Task 在 Task 4–8 之前完成；每条修订同时给出 registry 影响（落在 Task 3 与各实现 Task）。

- [ ] 2.1 S1 `api-idioms.md` §2/§3.2/§3.6：扩写 `generation` 定义为「owner 铸造的不透明 token，标识 (owner, key) 槽位当前占用者，用于 stale / superseded 判定」；排序用 `seq`；**所有 policy / resourceRegistry handle 一律必含 `generation`**，不按 composition 分层、不省略。
- [ ] 2.2 S2 `api-idioms.md` §3.2/§3.6 + `public-api-shape.md` §5：定一条可判定的失败分界——**注册（policy / resourceRegistry）失败一律 typed throw**；**contribution / mutation / operation / coordination 失败一律判别式结果**（环境不可用在该 idiom 下映射为 `inactive` / `unavailable` 码）。两册写同一句话。
- [ ] 2.3 S3 `api-idioms.md` §2 + `composition-and-authority.md` §5.1：区分并命名两个概念——`ownerId`（调用者身份，一律派生）与「资源所属者 / 目标 scope」（领域参数、单独命名、单独登记）；`identitySource` 词表增加 `derived-caller` / `declared-resource-scope` 两值。
- [ ] 2.4 S4 `api-idioms.md` §2/§3.7：写明外层三值 + **领域 detail 保留**；非标准状态映射表（`unsupported` → `unavailable`，`unknown` / `inert` → `degraded`，附 `reason`）；禁止「有对象 / 解析成功即 active」；异步领域解析须在挂载期完成并缓存。
- [ ] 2.5 S5 `api-idioms.md` §2：统一普通 handle `dispose()` 返回冻结 `{ ok, code, reason? }`，资源类码 `revoked` / `stale`，operation 类码 `requested` / `stale`；coordination `release(handle)` 例外保留。
- [ ] 2.6 S6 `identity-and-lifecycle.md` §3 + `api-idioms.md` §2：补 handle 生命周期小节——`status()` 承载资源 / 操作生命周期（领域词汇可不同，但字段名与终态词汇统一）；`lifecycleState` 与 `terminal` 不得混用。
- [ ] 2.7 S7 `api-idioms.md` §3.1：补缺位词汇表——确定不存在 ⇒ `missing`；无法得知 ⇒ `unavailable`；成功只读视图不带 `ok` 合法。
- [ ] 2.8 S8 `public-api-shape.md` §2/§3.6/§4/§5：host 树按 registry 现状逐名刷新（删除 5 个已 `removed` 订阅名、保留 `llm.routing.wait` 等 `advanced` 项）；client 树由 8 个领域补到运行时 / registry 的 14 个（含 `sessions`、`attention`）；§3.6 层级规则改为「叶子路径总段数上限 + 强领域关系白名单」并明确 handle 成员不占层级预算（对齐 `MAX_PATH_DEPTH = 5`，见 P10）；§5 示例 `events.compaction` → 真实存在的 capability path（C16）。
- [ ] 2.9 S9 `api-idioms.md` §4 + `composition-and-authority.md` §8 + `domain-composition.md` events 行：补 producer 模型——event → producer owner 的映射由 canonical 事件目录条目承载（`producerAuthority`）；未声明者 **fail-closed**；门面内部生产路径以内部 owner 身份取得权限；第三方一律走 `events.define`。**人类已于 2026-09-14 预授权**（能力边界收紧，见 K8「能力边界变化声明」与 Task 10.3）。
- [ ] 2.10 S10 `capability-strategy.md` §6 + `api-idioms.md` §2：§6 写明 `services.*` 采用官方存在性口径（`isActive`）**为例外**、语义面一律 `availability().status`；§2 为 `capabilityMatrix()` 补内容定义（只表达**当前**能力与限制，迁移账本留在 registry）。**人类已于 2026-09-14 预授权**（该册 §9 要求实质修订经人类确认）。
- [ ] 2.11 S11 `docs/standards/README.md`：索引与各册适用范围描述随本轮修订同步。
- [ ] 2.12 S12 `api-idioms.md` §1/§5：写明分类边界——**领域扩展成员按成员行登记、不消耗六项例外**；六项例外只用于**外层合同偏离**；§5 的机械校验清单增加「扩展成员已登记且与 handle 实际成员集一致」。
- [ ] 2.13 S13 `api-idioms.md` §3.4：明确 `terminal` **仅在返回时终态已可裁决时出现**；未裁决的接受结果以 `operation.status()` 为终态来源。
- [ ] 2.14 S14 `api-idioms.md` §3.5：写明异步生效的 contribution handle 增加 `status()`（`pending | active | failed | revoked`）；同步生效的 contribution 不提供该成员。
- [ ] 2.15 S15 `api-idioms.md` §2/§5：§5 必需字段增加 `callShape`（同步 / 异步声明，取 `sync` / `async` / `not-applicable`；交付字段名见 registry `namingDecisions`）；§2 写明「公共成员 SHALL 显式声明调用形态；不得以返回值形态暗示同步」（同步 / 异步差异本身保留，as-is 排除项）。

## Task 3: registry 落盘与机械校验扩展（对应 Req 11.5、Req 12.1/12.2、design §2.4、P2/P3/P10）

- [ ] 3.1 S1/S12/S15 的 registry 面：`vocabulary` 增 `identitySource` 两值（`derived-caller` / `declared-resource-scope`）与 `callShape` 词表（`sync` / `async` / `not-applicable`）；handle 行补齐 `id` / `ownerId` / `generation` 身份成员（含 `llm.adapters.decorations.register.handle`）；全量成员行回填 `callShape` 字段（S15）。回填须以**实现现状**为准逐行判定，不得整批复制同一值。
- [ ] 3.2 R1–R6 缺口逐条修补：**R1** 补 `lifecycle.register` 现行 leaf 行（旧名 `lifecycle.registerFace` 保持 removed）并核对旧路径映射；**R2** 三个 domain namespace 的 `admitted()` 补登记（与 Task 8.3 的 C10b 是**同一件工作，只做一次**，或内化）；**R3** `diagnostics.register.handle` 的 `currentShape`（随 Task 4.7）；**R4** `events.emit` 的 `currentShape` 由 "returns undefined" 改为判别式结果（随 Task 7.2）；**R5** `storage.availability` 的 `currentShape` 对齐实现（随 Task 8.11）；**R6** `capabilityMatrix` 行 `currentShape`（随 Task 8.12）+ client 面 `events.observe` 补现行（advanced）行（随 Task 5.6）。
- [ ] 3.3 例外台账重分类（design §3）：回收 6 条记录 / 4 行（`workflows.start.handle` 的 `.meta`/`.result`/`.cancel` 3 条、`agents.scopes.register.handle` 1 条、`llm.adapters.decorations.register.handle` 1 条、`workflows.start` 的 `terminal` 例外 1 条）；新增 4 条记录 / 4 行（`tasks.start`/`tasks.settle`/`tasks.attach`，以及 entry 级校验要求下同样需要登记的 `tasks.register`，四者六项齐全）。**净额（执行后实测）**：重分类本身为记录 20 → 18、成员行 17 → 17、公共 path 16 → 16；后续复核轮为 `agents.register` 追加一条 handle 形状例外记录（行 / path 不变），**HEAD 实测为记录 19、成员行 17、公共 path 16**，三口径均不高于 Req 11.5 的上限（17 行 / 20 记录 / 16 path）；设计时的预测值已按实测订正（见 design §3 净额段）。同时按 Req 14.3 **复核保留的 14 条例外记录**（`events.define`、`events.define.handle`、`agents.register`、`sessions.channels.ack`、`tools.executionPolicies.register`、`events.decisions.register`、`profiles.snapshot.validate`、`sessions.compaction.run`、`executions.recovery.checkpoints.planRestore`、`sessions.interactions.respond` host/client 各 1 条、`sessions.selection.set` 2 条、`sessions.selection.get`）逐条**保留并登记**，不得被机械抹平；复核结论落台账（Task 10.1）。
- [ ] 3.4 `scripts/registry-validate.mjs` 扩展 entry 级机械校验：入口动词与 idiom 一致；handle 成员集与所属 idiom 一致（policy / resourceRegistry 一律含 `generation`，S1）；handle 扩展成员已按成员行登记（S12）；`dispose()` / 失败呈现与登记的 `failureSemantics` / `lifecycle` 一致（S2/S5）；`generation` / `seq` / `epoch` 未混用（沿用并加强既有 `:221-227` 检查）；每个 namespace 的 `availability` 存在性（`availabilityExemption` 除外）；`callShape` 声明已回填（S15）。**不做**反射式全树运行时一致性引擎（design §8 明文的克制边界）。
- [ ] 3.5 迁移面与 authority 面同步：C7 的 `connection.get` → `connection.api.settings` 回滚须同时改写 registry 成员行、`oldToTargetMapping` 与 `statusByPath`，**避免生成自环**（design §2.3-C7 注）；C15 为 `settings.register.handle` / `settings.scope.handle` 两行加互指说明；Task 4–8 的每个形状变更同步 `targetPath` / `currentShape` / `lifecycle` / `identitySource` / `conflictRule`，并按 design §4-S4 的同步面补 `availabilityShape` 字段与各 namespace 记录（含 Task 8.2 新增的 `workspaces.transactions`）；按 design §5 末段的 authority closure 义务，为 `storage.open`（保留 `domain`）、`settings` mutation、`events` 派发三条路径在 registry 的 `bypasses` 字段写明是否旁路高层 authority，**无旁路者记录「闭合」**（`composition-and-authority` §6）。**注**：registry 现行数据**没有任何成员携带 `bypasses` 字段**（新增 array 形字段），而 `scripts/registry-validate.mjs:229` 已按 array 语义校验它（仅对 `status: recommended` 且非 read 的成员强制）；上述三条路径均为 `advanced`，故该登记当前不受机械校验约束，属**自愿如实登记**而非被校验项。（**第二十八轮现状补注**：前半句为 Task 3.5 落盘前的快照；`bypasses` 已由 B15 落盘 **11 行**——`events.{emit,serial,parallel,bail,waterfall}` 五行、settings 五个成员行、`storage.open`——其中 10 行 `advanced`、`settings.get` 为 `removed`；「不受机械校验约束、属自愿登记」的结论不变。）
- [ ] 3.6 registry 下游镜像同步（M10 三表）：M11 对 `members` 的任何增删改（新增行、`currentShape` / `availabilityShape` / idiom 例外变更）都会打破 M10 交付的三表镜像——`scripts/convergence-verify.mjs` 强制 `public-member-table.md` 的行数**等于** registry `members` 数并逐字比对 `idiom` / `effect` / `composition` / `availabilityShape` / `currentShape` / `authority`（`:63-66`、`:68-99`），且该校验由 `test/convergence-verify.test.mjs` 在 `npm test` 内执行（`execFileSync` 非零退出即失败）。同步面**按各表自身口径分别处置**：**成员表** 1:1 随 registry 增删改（行数与六个字段逐字对账）；**行为表** 保持其 37 行冻结清单（`EXPECTED_BEHAVIOR_ROWS`，`:270-275`）——**不随 registry 增行**，只就地重写受影响行的内容并维持与成员表、装配表的互链（`linkedRows === behaviorRows.length`，`:237-269`）；**装配表**保持 token 可解析（`:226-235`）；三表引用的测试文件须存在（`:170-190`）；`oldToTargetMapping` 每行须可解析（`:192-224`）。三表的历史行已获批验收边界不改写，只做镜像更新与必要的现状注。此外，**行为表各行引用的 token 必须可在 registry 解析**（`:104-124`：每个行为行须引用至少一个公共 path，且每个被引用 path 须命中 `knownPaths`，否则报 `references unknown public path`）——本文改名的成员保留 `removed` 行，故 `knownPaths` 仍可解析，但须逐条核对。**不得**为了通过校验而改 `EXPECTED_BEHAVIOR_ROWS`（该常量不在 Task 3.4 授权的校验扩展范围内）。

## Task 4: host 注册面逐成员收口（design §2 A1–A3 + C6/C9，对应 Req 2、Req 3、Req 9）

- [ ] 4.1 A1 `tools.register` / `tools.restrict.register`：全局与 scoped 两分支**同形**返回 `{ id, ownerId, generation, dispose() }`，`targetId` 作为已登记领域扩展保留；`dispose()` 改判别式结果；**scope 失败绝不退化为全局安装**（现状已满足，须保持且有测试）。落点 `lib/plugin-api-service.js`（+ `lib/scoped-agent-contributions.js` 记录 token）。
- [ ] 4.2 A2 `llm.requestTransforms.register` / `llm.admissionPolicies.register`：门面派生 owner、铸造 generation、返回标准 handle；同 owner 同 id latest-wins、跨 owner typed conflict（现状同 id 重复注册直接抛错且无 owner 维度）。落点 `lib/llm-request.js`、`lib/llm-input-policy.js`（facade 包装）。
- [ ] 4.3 A2 `llm.routing` 四类（`policies` / `candidates` / `health.circuitPolicy` / `health.probe`）：**R 落点** `packages/agent-loop/lib/route-policy.js`——注册表增加 owner 维度与跨 owner 冲突判定，facade 注入派生 owner 与铸造 generation，取消调用方自报 `ownerId`/`generation`；替代行对被替代官方行的契约复刻与 boot 自检须复核通过（design §6-5）。
- [ ] 4.4 A2 `llm.providers.register`（官方可调用 handle + 未登记成员 `.replace` 包装为标准 handle，`.replace` 作为显式成员保留并登记）、`llm.models.register`（官方裸 disposer，签名与错误映射保留）。落点 `lib/index.js`。
- [ ] 4.5 A2 `attachments.pipeline.transforms.register`：**R 落点** `packages/attachments/lib/pipeline-service.js`——成功返回标准 handle、同 owner 同 key 静默覆盖改冲突判定；facade 的泛化 `invoke` 兜底 catch **收窄到操作类调用**，注册类调用不得被折叠为 `ATTACHMENT_UNAVAILABLE`（design §6-1）。
- [ ] 4.6 A2 `remotes.register`（host）：官方裸幂等 disposer → 标准 handle（同 key 不同 service 已抛冲突，保持）。落点 `lib/remote-publication.js`、`lib/host-remote.js`。
- [ ] 4.7 A2 `diagnostics.register`：`ownerId` 必填自报 → 派生、裸 disposer → 标准 handle、裸 `TypeError` → typed 输入错误（保留「错误信息列出合法 scope」的既有优点）。落点 `lib/diagnostics.js`。
- [ ] 4.8 A2 `tools.discovery.catalog.register`：`{ generation, dispose() }`（缺 `id`/`ownerId`）→ 标准 handle，`owner` 由调用方自报字符串进 generation → 派生。落点 `lib/tool-discovery.js`。
- [ ] 4.9 A3 `prompts.provenance.policy.register`：`(fn, {priority, name})` 旧式签名 → policy idiom 的 `register(spec)`（含 `id` / `priority` / `decide`）；失败由 `{ok:false, code, detail}` 改 typed throw；priority 词表校验（未知 priority 静默按默认档 → 报错）；owner 派生。落点 `lib/context-engine.js`。
- [ ] 4.10 C6 `agents.providers.register`：显式变体判别（不依赖 `factory`/`announce`/`agent` 键存在性嗅探）、非法输入返回指明合法变体的错误、各变体返回标准 handle 或登记明确的例外；官方 factory/announce/enter 语义与 owner 传参保留。落点 `lib/agent-create-api.js`。
- [ ] 4.11 C9 `prompts.contribute` 匿名 id 与错误词表：全局路径匿名 id `anonymous:<seq>` 与 scoped 路径 `scoped:<kind>` 共用同一规则；kind 非法时错误列出合法 kind 词表。落点 `lib/plugin-api-service.js`。
- [ ] 4.12 Req 9.5 / C10a：`decision-participation` active / disabled 两形态成员集合一致（disabled 形态的 `admitted()` 补登记或内化，见 Task 8.3）；`registerMinimalCatalogUpdate` 公开面已不含该名 ⇒ 保持公开面现状，内部残留与 `packages/tool-skill` 的 facade 回退分支**显式登记、不删除**（删除会切断 tool-skill 替代行）。
- [ ] 4.13 K2 `dispose()` 结果统一（host 贡献面）：`prompts.contribute` 全局与 scoped 两个 handle（`lib/plugin-api-service.js:1360-1375`、`:2487-2500`，scoped 的 dispose 块自 `:2491` 起）的 `dispose()` 由布尔改为冻结 `{ ok, code, reason? }`（资源类：成功码 `revoked`、no-op 码 `stale`），并按 Req 2.4 保证幂等、绝不抛穿。**外层结果的冻结现状已满足**（`:1321`/`:1378`/`:2444`/`:2501` 处已 `Object.freeze`，design §7 落点列出的「`prompts.contribute` 冻结」属陈旧项/已满足）——本项只做 `dispose()` 结果与对应登记的收口，不重复实现冻结。
- [ ] 4.14 K1/K2/K3 全树一致性收口（**registry 驱动的枚举 + 逐项收口**，本线范围的完整化而非扩大）：依据是 goal Scope direction 2「**门面自有 register 一律返回标准 handle**」与 Req 2.1 的同义条款——二者都是无条件表述，design §2 的处置表是其**处置映射而非穷尽清单**（Task 1.3 的枚举补充声明）。⇒ 执行时按 registry 做一次**静态枚举**（design §8 明确不做反射式全树运行时引擎）：列出**现行行**（`status !== 'removed'`；`removed` 行无运行时可收口对象，命名空间级 `dispose` 成员非 handle、不适用 K2）中全部 `idiom ∈ {policy, resourceRegistry, contribution}` 的成员行及其 handle 行，外加 `currentShape` 描述 disposer / handle 的成员行，逐行核对 K1（标准 handle 成员集）、K2（`dispose()` 判别式结果）、K3（身份派生而非自报）三项；对每处偏差就地收口（门面侧、语义等价、不新增能力、不改官方 seam）。已知的补充成员（三、四轮审查发现，必须在本次枚举中被覆盖）：
  - `executions.recovery.policy.register` / `executions.recovery.visibility.register` / `executions.recovery.capability.register` / `declare`（`lib/recovery-policy.js`）——handle 为 `{id, ownerId, generation, dispose()}` 但 `dispose()` 返回布尔，且 `ownerId` / `generation` 由调用方自报（K2 + K3）；
  - `agents.decisions.register` / `tools.executionPolicies.register` / `prompts.assemblyPolicies.register` / `events.decisions.register`——共用 `lib/decision-participation.js:311-322` 的 handle，`dispose()` 返回 `true|false`（K2）；注意这三/四行的**既有保留例外**（around 屏障、fs 异步屏障等）只描述**入口语义**，不覆盖 `dispose()` 返回形状，故例外保留、返回形状按 K2 收口；
  - `security.policy.register` / `security.redaction.register` / `security.egress.register`（`lib/security-owner.js`、`lib/security-policy.js`）——`dispose()` 返回布尔（K2；身份派生由 Task 6.6 承担）；
  - `tools.guard.register` / `tools.presentation.register` / `tools.executionMode.register`（`lib/plugin-api-service.js`）——返回官方裸 registration disposer（K1）；
  - `sessions.channels.auth.register` / `sessions.channels.auth.pairingProvider.register` / `sessions.channels.redaction.register`（`lib/session-channel-auth.js`）——返回官方裸 registration disposer（K1）。
  **不可就地收口的处置规则**：若某处收口需要改变官方 seam 语义、新增公共能力或触及硬停机点，则**不得**自行实施，按 Req 13.6 登记为阻塞项（原因 + 最小解除动作 + 是否需人类授权 + 日期）并在台账逐条记载；**不得**用新增 idiom 例外消化（Req 11.5 只许净额下降），也**不得**删除 Task 1.3 的完整性断言。**本次枚举发现的每一处补充成员，与 Task 1.3 声明同规则**：在 design §2 补行、registry 落行，并在 Task 10.1 台账逐条记载（不依赖引用推断）。
- [ ] 4.15 K1/K2/K3 余项收口（host 注册面补充成员，见 Task 1.3 的枚举补充声明）：**`llm.adapters.register.handle`**——handle 已是 `{ id, ownerId, generation, dispose() }`，但 `dispose()` 经 `lib/llm-adapter-registration.js:307-320` 返回冻结 `{ status: 'ok' | 'stale' }`、`:344-351` 的 catch 分支返回 `{ status: 'unavailable' }`（design §1-K2「现状」点名的 `{status}` 形状），改按 K2 返回 `{ ok, code, reason? }`（资源类 `revoked` / `stale`），并把 `unavailable` 失配为等价码；**`llm.adapters.decorations.register.handle`**——现仅 `{ dispose(), snapshot() }`（`lib/plugin-api-service.js:1109-1143`），按 design §3 的回收理由**补齐** `id` / `ownerId` / `generation` 身份成员、`dispose()` 改判别式结果、`snapshot()` 转为扩展成员登记（这是 design §3 明文要求改实现的那一条，不能只改 registry）。**注**：`executions.visibility.register` 与同族的 `executions.recovery.*`、`tools.guard/presentation/executionMode.register`、`sessions.channels.auth.*` 等补充成员由 Task 4.14 的全树枚举统一收口，本项只承载 `llm.adapters` 两行。同步在 design §2 补行、registry 落行（Task 3.5）。
- [ ] 4.16 测试：`test/` 下新增或扩展注册面形状断言，覆盖 4.1–4.15 每个成员的结果形状、身份来源、冲突呈现与 `dispose()` 结果（含 4.14 全树枚举收口的每个成员）；R 落点三处（4.3 / 4.5 + Task 5.8）同时跑既有替代包测试。

## Task 5: 贡献面与观察面收口（design §2 A4/A5 + C5，对应 Req 7、Req 5、Req 10.4）

- [ ] 5.1 A4 client `slots.contribute`：官方裸 disposer（同步）→ K7 判别式结果 + 标准 contribution handle。落点 `lib/client-slots.js`（+ 重建 `lib/client.js`）。
- [ ] 5.2 A4 client `remotes.contribute`：`Promise<裸退订函数>` → 返回时即给 pending handle（`status()` 报 `pending|active|failed|revoked`），失败可观察，调用方不必用 Promise 链承担撤销责任。落点 `lib/client-remote-contribution.js`。
- [ ] 5.3 A4 client `settings.remote.contribute`：`Promise<{status, face, render, dispose}>`（`status` 充当成功标志）→ 判别式结果 + handle，`face` / `render` 作为领域扩展成员保留。落点 `lib/client-settings-remote.js`。
- [ ] 5.4 A4 host `settings.remote.contribute`：同步裸 disposer → 判别式结果 + handle；同步生效的官方挂载 / 租约 / 重绑定内部逻辑保留（Req 7.4）。落点 `lib/settings-remote.js`。
- [ ] 5.5 A4 client `attention.contribute`：外层结果改为冻结（形状已是判别式 + `{id, ownerId, seq, dispose()}`）。落点 `lib/client-attention-face.js`。
- [ ] 5.6 A5 client `events.observe`：裸退订函数 → 标准观察 handle；事件目录可查询；未知名返回 typed 结果而非裸 `TypeError`。落点 `lib/client-official-events.js`、`lib/client-runtime.js`（+ registry 补现行行，见 Task 3.2-R6）。
- [ ] 5.7 A5 `llm.routing.observe`：裸退订函数 → 标准观察 handle；`forExecution` 语义、成员名与参数保持。落点 `lib/session-route.js`。
- [ ] 5.8 A5 `mcp.observe`：裸 cordis disposer → 标准观察 handle。**R 落点** `packages/mcp/lib/catalog.js`（契约复刻 + boot 自检复核）。
- [ ] 5.9 A5 `diagnostics.observe`：裸 disposer → 标准观察 handle；owner 释放后的订阅失效以 `degraded` / epoch 语义表达，不静默。落点 `lib/diagnostics.js`。
- [ ] 5.10 A5/C5 `sessions.activity.observe` / `executions.observe`：内部可变记录（`listeners` Set、`disposed`、`stale`、`signal`、`abortHandler`）→ 另建外部冻结 handle，内部记录私有化，dispose 后订阅 **no-op 而非抛 `TypeError`**。落点 `lib/session-activity-observe.js`、`lib/execution-observation.js`。
- [ ] 5.11 A5 `tasks.observe`：冻结 handle 但 dispose 后订阅抛错 → 订阅语义对齐 no-op（`taskId` / `initialState` 扩展成员保留）；其 `dispose()` 同时按 K2 由布尔改为判别式结果（handle 冻结区 `lib/task-execution-observation.js:1354-1366`，dispose 实现于 `:1329-1343`）。
- [ ] 5.12 B1（观察面部分）`sessions.channels`：`observe()` 的一次性深度冻结快照 → `current()`；新增 `observe(listener)` 标准 handle；事件帧拉取由 `list` 改名（`history({...})`，api-idioms §3.1 允许的查询动词）；`ack` 与订阅身份保留。落点 `lib/session-channel-project.js` + `lib/plugin-api-service.js`。
- [ ] 5.13 K2 `dispose()` 结果统一（既有基准成员与补充成员收口，见 Task 1.3 的枚举补充声明）：design §2 标为「已修复 / 基准 / 保持」但不满足 K2 的普通 handle 逐处收口为冻结 `{ ok, code, reason? }`（资源类：`revoked` / `stale`）——host `events.observe`（`lib/events-bus.js:610-625`）、`sessions.planMode.observe` / `sessions.permissionPresets.observe`（`lib/sessions-plan-mode.js:486-492`、`lib/sessions-permission-presets.js:567-572`）**及其 disabled 安装态的同一 `observe()` 实现**（`lib/plugin-api-service.js:243-245`、`:302-304`，按 Req 9.5「active/disabled 成员集合一致」必须同形收口）、client/host `attention.contribute`、`events.define.handle`（`lib/events-bus.js:802-809`；其**保留例外**只覆盖「publish 动词旁的资源生命周期身份与幂等 disposer」这一外层偏离，不覆盖 `dispose()` 返回形状，故按 K2 收口而例外继续保留）、client `lifecycle.register.handle`（`lib/client-generation-rebind.js:587-606` 的 `disposeFace` 返回布尔 → 判别式结果）。**K5 形状（四成员、冻结、`subscribe` 返回退订函数、释放后订阅 no-op、内不外泄）保持为全树基准不变**，本项只改 `dispose()` 返回值与对应 handle 行登记。同时按 Task 3.1/3.5 同步 host `events.observe` 的 handle 行登记文案（design §2.1 A5 标为「登记同步」的那一项）。
- [ ] 5.14 测试：观察 handle 形状矩阵（含 client）、内部记录不外泄断言、dispose 后 no-op 断言、listener 异常只降级该监听者断言、client 三处贡献的 pending dispose 测试、以及 5.13 的 `dispose()` 判别式结果断言（对应 design §8 场景 4/5/8/10）。

## Task 6: 操作控制对象与身份派生（design §2 B1/B2，对应 Req 6、Req 3）

- [ ] 6.1 B1 `sessions.request`：`dispose()` 由 `{ok, code:'accepted'|'stale'|'unavailable'}` 改为 operation 语义的「请求停止」（成功码 `requested`、no-op `stale`）；`terminal` 按 S13 一般条款处理（不新增例外）；`observe` 返回退订函数保持。落点 `lib/session-interaction-operation-authority.js`。
- [ ] 6.2 B1 `workflows.start`：结果字段名 `handle` → `operation`；`dispose()` 由 `Promise` → `{ok, code:'requested'|'stale'}`；run authority 与 `meta` / `result` / `cancel` 扩展成员**保持原样**（design §3 明文：「`meta`/`result`/`cancel` 的领域语义与官方契约不变，仅登记方式改变」），`cancel` 继续 verbatim 委派官方 `run.cancel(reason)`（无返回值）——不因其返回 `undefined` 而改动官方委派签名（design §9「operation 内部阶段与领域 payload 差异」属排除项）。落点 `lib/workflows-operation.js`、`lib/workflows-facade.js`。
- [ ] 6.3 B1 `executions.recovery.checkpoints.restore`：字段名 `handle` → `operation`；只读快照并入 `handle.status()`；成功码与 registry 对齐（`started` → `accepted|completed` 口径）；`handle.observe` 返回退订函数而非对象；恢复阶段与资格控制保留。落点 `lib/checkpoint-restore.js`。
- [ ] 6.4 B1 `tasks.start` / `tasks.settle` / `tasks.attach`：动词串字段 `operation` → `action`；归类为**带例外的 operation**（控制对象是 durable task/attempt 身份，经 `tasks.get` / `tasks.observe` 观察，**不铸造第二套操作身份**）；三个新例外六项齐全并落 registry（Task 3.3）。落点 `lib/task-execution-observation.js`。
- [ ] 6.5 B1 终态词汇统一：四个域的 `status()` 领域词汇可不同，但字段名与终态词汇统一为 `success | error | aborted | denied | superseded`（S6）。落点同 6.1–6.4 各属主模块。
- [ ] 6.6 B2 身份自报面改派生：`security.policy/redaction/egress.register(ownerId, spec)`、`diagnostics.register({ownerId})`、`workspaces.transactions.prepare({ownerId})`、client `lifecycle.register({ownerId})`、`prompts.contribute` 的显式 `spec.ownerId` 覆盖位、`tools.discovery.catalog.register` 的 `owner`——语义为「调用者身份」者删除参数改派生；`storage.open` 的 `owner` 归同类（由派生值参与官方 `{scope}__{owner}__{name}` 命名，门面自身 `mountStorageFeature` 内部挂载路径继续显式传门面 owner，**不经公共入口**）。落点 `lib/security-owner.js`、`lib/diagnostics.js`、`lib/storage-binding.js`、`lib/workspace-mutation-transaction.js`、`lib/client-generation-rebind.js`、`lib/plugin-api-service.js`。
- [ ] 6.7 B2 冲突判定与 generation 语义：同 owner 同 id 按成员 idiom（policy/registry latest-wins 或内容等价幂等；contribution 稳定冲突码）；**跨 owner 同 id 一律 typed owner-conflict**（含 routing 注册表）；不可追踪调用方使用根 token 并在 registry 的 `identitySource` 如实登记 `derived-caller (root-fallback)`；stale handle 的 `dispose()` 返回 `{ok:false, code:'stale'}` 且绝不撤销新 generation 的资源。
- [ ] 6.8 测试：控制对象形状矩阵（`sessions.request` / `workflows.start` / `checkpoints.restore` 三域 `res.operation` + `status()`/`observe()`/`dispose()`，design §8 场景 6）；双插件 owner 冲突 + stale dispose 组合测试（同 §8 场景 2）；身份派生断言（自报参数确已移除、`identitySource` 与实现一致）。

## Task 7: canonical 事件生产权落地（design §1-K8 / §2-B3 / §4-S9，对应 Req 8）

- [ ] 7.1 运行时事件目录携带 producer 归属：为运行时目录条目（`lib/events-catalog.js` 与各 `*-events-catalog.js`、各 R slice 目录）增加机器可用的 producer 声明，取值与 registry `eventCatalog[*].producerAuthority` 的语义一一对应（P3：registry 侧 69 行已齐备，本项补齐的是运行时侧）。未声明 producer 的条目默认 **fail-closed**，并区分 `observation` / `notification` 语义登记。
- [ ] 7.2 派发判定：`lib/events-bus.js` 的 `dispatch()`（P4 实测的唯一天然判定点）在派发前按目录条目判定 producer——非 producer 返回冻结 `{ ok:false, code:'denied', reason }`；保持「派发变体不产生独立 operation 身份、不重试」的既有语义与既有 `unsupported` / `error` 码路径；`events.define` 的 owner-scoped publisher 语义**不变**（Req 8.3）。同步修正 registry `events.emit` 的 `currentShape`（Task 3.2-R4）。
- [ ] 7.3 门面自身生产路径取证：门面转译路径（把官方事件映射为门面事实）与替代行派发官方事件的路径须以**内部 owner 身份**取得权限；经真实公共入口取证「实现自用路径不被自身判定拒绝」（Req 8.4）。**官方插件自身的原生 `ctx.emit` 不经 `dispatch()`**（P4），不得为判定而改动官方派发机制或横切语义。
- [ ] 7.4 能力边界变化落盘：`AGENTS.md` §4 第 3 条的同步**与 Task 10.3 是同一件工作，只做一次**（由 Task 10.3 统一执笔，本项只负责提供 K8 的正文措辞与依据，避免两处各改一次同一段）；`docs/specs/plugin-api-features/feature-list.md` §3.1 同步（S9 同步面）由本项承担；交付台账单列该变化（Task 10.1），并在交付报告中显式记载「第三方经门面派发 canonical 系统事件由可用变为 typed `denied`，`events.define` 路径不受影响」。**不得**通过把入口移入 `services.*` 规避判定（Req 8.5）。
- [ ] 7.5 测试：producer `denied` 反向测试 + `events.define` 正向测试 + 门面自用路径放行测试（design §8 场景 11）；catalog 缺 producer 声明的 fail-closed 断言。

## Task 8: 局部必修与修剪 C1–C17（design §2.3 / §2.3b，对应 Req 4、Req 5、Req 9.5/9.6、Req 10）

- [ ] 8.1 C1 availability 归一失真：`lib/namespace-availability.js` 按 K4 重写归一——三值透传、非标准状态映射（`unsupported`→`unavailable`、`unknown`/`inert`→`degraded`，附 `reason`）、领域 detail 保留、删除「解析成功即 active」分支、异步领域解析改挂载期缓存；`coordination.availability(scope)` 缓存化、`security.availability` 状态化（顶层无 `status` 的 getter）。落点 `lib/namespace-availability.js`、`lib/coordination-lease.js`、`lib/security-owner.js`。
- [ ] 8.2 C1b `workspaces.transactions.availability`：补子命名空间 `availability()` 并登记 namespace 记录。落点 `lib/plugin-api-service.js` + registry。
- [ ] 8.3 C10b `admitted()` 登记：三个 domain namespace 的 `admitted()` 补 registry 行或内化（与 Task 3.2-R2 同一件工作，只做一次）。
- [ ] 8.4 C2 client 自描述失真：capability 只认 14 个根名、非 `sessions`/`attention`/`services` 一律「对象存在即 active」；六个已登记 `availability` 成员（`connection`/`events`/`remotes`/`settings`/`slots`/`codec`）运行时缺失；client `sessions`/`attention` 反有成员而未登记；`lifecycle.availability(faceId, ownerId)` 返回 face 快照而非三值。按 Req 4.5/10.3 补齐并按真实叶子状态报告。落点 `lib/client-runtime.js` + 各 client 模块 + registry。
- [ ] 8.5 C3 slots 白名单拒绝真实槽位：准入交官方声明判定（不再用前缀正则拒绝 `tool.call.toolview`）；`list` 区分「未声明」与「已声明为空」；暴露只读声明投影（含官方 `spec` / `specDynamic` / `declarationEpoch` / `snapshot` 事实，**不新增根、不新增注册平台**，登记为 projection 成员，见 design §9 取舍记录）。落点 `lib/client-slots.js`（+ 重建 `lib/client.js`）。
- [ ] 8.6 C7 client `connection.get` 改名：`Proxy({})` 逐属性转发官方 settings → 导航成员 `connection.api.settings`（与既有 `connection.api.llm` 对称）；**对已批准 rename 的回滚**，须同步改 registry 成员行、`oldToTargetMapping`、`statusByPath` 以避免自环（Task 3.5），并在交付台账标注该回滚与理由。落点 `lib/client-runtime.js`、`lib/client-connection.js`。
- [ ] 8.7 C8 `settings.scope` 双端调用套路统一：client 暴露 `scope(spec)`（内部沿用 `bind`）；返回对象差异（门面 handle vs 官方 scope）作为环境差异**显式登记**，不机械抹平。落点 `lib/client-settings-scope.js` + registry。
- [ ] 8.8 C10c `agents.scopes`：`dispose()` 结果按 K2 统一；`status()` 的 `usable`/`destroyed` 领域词汇保留并登记（S6）；`target` / `status()` 由例外记录改成员行登记（S12）；修正 leaf 行 `failureSemantics: typed-throw` 与 `currentShape`（判别式结果）的自相矛盾。落点 `lib/scoped-agent-contributions.js` + registry。
- [ ] 8.9 C11 缺位 / 不可用词汇统一：`absent`（`session-activity-view`，且与非法输入合并）、`undefined`（`executions.get`）、`missing`（`interactions.get`，已正确区分 unavailable）、`{ok:true, found:false}`（`tasks.get`）、`unavailable`（`tasks.history` 对「不存在」）→ 统一为「确定不存在 ⇒ `missing`；无法得知 ⇒ `unavailable`」；成功只读视图不带 `ok` 合法（`activity.list`/`history` 保持）。落点 `lib/session-activity-view.js`、`lib/execution-observation.js`、`lib/sessions-interactions-facade.js`、`lib/task-execution-observation.js`。
- [ ] 8.10 C12 settings mutation 呈现：直通官方 `Promise<void>` 并抛官方错误 → 包装为冻结 `{ok, code, commitState, generation}`；官方 revisions/CAS 语义与错误映射保留。落点 `lib/official-host-namespaces.js`。
- [ ] 8.11 C13 `storage.open.handle.domain`：**保留** `domain`（owner-scoped 记录访问面，无等价公共替代），registry 行由 `removed/migrate` 改回 retained 并登记理由；`storage.availability` 按 K4 补齐 scope / durability / epoch（Task 3.2-R5）。落点 `lib/storage-binding.js` + registry。
- [ ] 8.12 C14 `capabilityMatrix` 内容模型：保留成员（api-idioms §2 已授权），内容改为「当前能力簇 + 当前状态 + 限制 / 缺口原因」，迁移词汇（`renamed`/`merged`/`migrated`/`deleted`/`internalized`）移出**运行时可见输出**、保留在 registry 登记面。落点 `lib/capability-matrix.js` + registry 行 `currentShape`（Task 3.2-R6）。
- [ ] 8.13 C15 / C17：C15 为 `settings.register.handle` 与 `settings.scope.handle` 两行加互指说明（实现不变）；C17 的 `callShape` 声明义务**与 Task 3.1 是同一件工作，只做一次**——在 Task 3.1 的全量成员行回填中一并完成，本项只做「以 `tasks.*` 全域 async 为抽样点核对回填结果使调用形态可预测」的复核（**保留 async**，不形态同化，Req 14.2）。
- [ ] 8.14 C4 复核：`sessions.channels` 的三成员语义（Task 5.12）与 `ack` / 订阅身份一并复核，确认「快照 / 订阅 / 事件帧」不再因名称造成错误调用（design §8 场景 8）。
- [ ] 8.15 测试：availability 矩阵测试（含 `unknown`/`unsupported` 映射与 detail 保留，design §8 场景 9）；`tool.call.toolview` 真实槽位 contribute/list 通过测试 + 声明投影（场景 7）；缺位词汇断言；`connection.api.settings` 命名断言。

## Task 9: 组合验收、迁移证据与跑测（对应 Req 13）

- [ ] 9.1 双 synthetic 插件组合测试：反向加载顺序、同 key 冲突、卸载隔离、**旧 handle 不得撤销新资源**、callback 失败隔离（Req 13.2 / design §8 场景 2）。
- [ ] 9.2 迁移切片：同一工具全局→agent scope 外层 handle 与清理方式不变（场景 1）；同一策略在 llm / prompts / security 以可迁移方式登记（场景 3）。每个切片文件头写明「原行为 → 现行公共调用 → 运行结果」矩阵（Req 13.3）；**证据须来自真实公共入口执行**，不得以 import 扫描、路径计数或测试总数充当等价证据（design §9-6）。
- [ ] 9.3 机械校验跑测：`scripts/registry-validate.mjs` 扩展后对 registry 全量通过（Task 3.4）；`node scripts/convergence-verify.mjs` 通过，硬判据为「**成员表行数与六个字段逐字随 registry**；**行为表 37 行冻结且全链**；装配表 token 可解析；三表引用的测试文件存在；`oldToTargetMapping` 每行可解析」（Task 3.6）。P1 记录的 `537 / 37 / 37` 是**开工基线**，用于核对「未登记的漂移」，不是交付期硬性数字；交付期判据是上述逐项成立且脚本退出码为 0。
- [ ] 9.4 client 生成物重建（最终复核）：Task 5.1 / 5.6 / 8.5 / 8.6 等 client 源改动各自即时重建一次；**本项是交付前的最终重建与产物 diff 复核**——`lib/client.js` 经 `npm run build:client` 重建，核对产物 diff **仅含预期变更**，`npm run build:client:check` 一致（design §6-6）。与前述 Client 侧任务的关系是「同一件工作的最终复核」，不重复计项。
- [ ] 9.5 全量跑测：`npm test`（4G 护栏内）全绿，且总数不低于 P1 基线 3469（新增测试须为净增）；`git diff --check` 干净。
- [ ] 9.6 边界审计：治理 token 不出现在 `lib/`、`packages/`、`test/`、`package.json`（Req 12.4）；**版本冻结未被步进**；官方包零修改；**`servicesWhitelist` 的键集合与基线一致（54 键，未新增 / 未删除成员）且本线除已登记的 C3 只读声明投影外未新增任何公共能力或 R 点**（Req 14.1 的括注例外正是为 C3 而设，见 design §9 取舍记录；与 P2 探针记录对账）；R 落点三处的替代行契约复刻、boot 自检、组件 owner 唯一均复核通过（Req 14.4）。

## Task 10: 交付台账与治理同步（对应 Req 1、Req 11.3、Req 12）

- [ ] 10.1 交付台账落盘：新增 `docs/specs/plugin-api-m11-contract-enforcement/batch-1/delivery-ledger.md`，逐项记录 (a) A1–A5 / B1–B3 / C1–C17（含 §2.3b）与 §2.4 的 R1–R6 的**最终去向**（修复 / 合理例外 / 已修复 / 误报 + 证据锚点 + 落地提交）；(b) 实际 API 变化清单；(c) K8 的能力边界变化单列；(d) C7 回滚的标注与理由；(e) 例外台账三口径的净额核算（Task 3.3）；(f) 计数型结论的计量单位与取样口径（Req 1.1）。合理例外须附六项或指向 registry 的例外记录；「误报 / 已修复」须附当前源码证据（Req 1.2/1.3）。
- [ ] 10.2 登记同步：`docs/specs/plugin-api-features/feature-list.md` §7（本 feature 交付条目与状态）与受影响的 `README.md` 表述；历史制品若有旧 path 受影响，以文首「公共契约现状注」追加映射，**不改写**其已获批验收边界（Req 12.3）。
- [ ] 10.3 治理同步：`AGENTS.md` §4 第 3 条（S9 producer 模型 + 能力边界变化；**与 Task 7.4 是同一件工作，由本项统一执笔**）与 §2/§4 的对应表述（S10 `services.*` 存在性口径与 `capabilityMatrix` 内容定义）；`docs/standards/README.md` 索引（S11，若 Task 2.11 未覆盖）。
- [ ] 10.4 阻塞项登记：本线未达成的必需行为按 Req 13.6 逐条登记（原因 + 最小解除动作 + 是否需人类授权 + 日期），**不以降级呈现充当完成**；无阻塞项时显式记录「无」。
- [ ] 10.5 阶段收口：全局终审通过后提交；确认工作区无 `temp/` 依赖、无临时脚本残留、无未提交成果（Req 14.5）。

---

## 需求覆盖对照（Req → Task）

| 需求 | 承载 Task |
|---|---|
| Req 1 输入固化与处置表 | 10.1（台账） |
| Req 2 注册 handle 与 dispose | 1.2、1.3、4.1–4.11、4.13、4.14、4.15、5.1–5.5、5.11、5.13 |
| Req 3 owner 身份双角色 | 2.3、4.2–4.8、4.14、4.15、6.6、6.7 |
| Req 4 availability 与自描述 | 2.4、8.1、8.2、8.4、8.11、8.12 |
| Req 5 观察面分层 | 1.4、2.7、5.6–5.12、8.9 |
| Req 6 操作身份与终态 | 1.5、2.6、2.13、6.1–6.5 |
| Req 7 贡献面与 pending handle | 1.6、2.14、5.1–5.5 |
| Req 8 事件生产权 | 2.9、7.1–7.5 |
| Req 9 host 注册面收口 | 4.1–4.12、4.14、4.15、8.3、8.8 |
| Req 10 client 公共面收口 | 5.1–5.6、5.13、8.4–8.7 |
| Req 11 分册修订与治理同步 | 2.1–2.15、3.1–3.6、10.3 |
| Req 12 登记与一致性 | 3.1–3.6、9.6、10.1、10.2 |
| Req 13 验收与证据 | 9.1–9.6 |
| Req 14 边界与不回归 | 2.15、3.3、4.5、4.14、7.3、8.13、9.6、10.1、10.4、10.5 |

## 阶段边界

本 Task 清单只规划 Stage 4 的执行顺序与验收义务，不批准任何超出 `goal.md` / `requirements.md` / `design.md` 的范围。Tasks 经阻塞对抗性审查通过后直接进入 Stage 4 自主执行；执行中的 spec 错误按 AGENTS §3.2「Stage 4 通用规则」就地修订并登记，触及硬停机点（版本与发布、milestone 范围）时暂停并请求人类裁决。

## Stage 3 审查门记录

**第 4 轮结论：无偏差（门通过）。** 四轮均为**阻塞式只读对抗性审查**（`run_in_background: false`，只读子 agent，无写权限、无子派发）。各轮结果与闭合方式：

| 轮次 | 结论 | 实质意见与闭合方式 |
|---|---|---|
| 1 | 有偏差 | ① 探针 P5 引用了代码中不存在的符号 `looksLikeStatus` → 改写为对 `lib/namespace-availability.js` 真实分支的引用并更正行号；② K2 `dispose()` 统一下落点缺失 → 补落点清单并新增 Task 4.13 / 5.13 / 5.11；另闭合中度 4 条、低度 5 条 |
| 2 | 有偏差 | ① K2 落点仍不完整（`llm.adapters.register.handle`、`llm.adapters.decorations.register.handle`、`events.define.handle`、client `lifecycle.register.handle`、`executions.visibility.register`）→ 新增 Task 4.15，扩展 5.13；② M10 convergence 三表镜像无人承载（`scripts/convergence-verify.mjs` 在 `npm test` 内强制）→ 新增 Task 3.6、改写 Task 9.3；另闭合中度 2 条、低度 3 条 |
| 3 | 有偏差 | ① K1/K2/K3 的全树义务未穷尽（`executions.recovery.*`、`agents.decisions` / `tools.executionPolicies` / `prompts.assemblyPolicies` / `events.decisions`、`security.*.register`、`tools.guard` / `presentation` / `executionMode`、`sessions.channels.auth.*`）→ 把「枚举清单」升级为 **Task 4.14 的 registry 驱动枚举方法**（含不可就地收口的阻塞登记规则）；② 行为表口径误解（`EXPECTED_BEHAVIOR_ROWS = 37` 是冻结清单，不随 registry 增行）→ 按各表自身口径分别改写 Task 3.6 / 9.3；另闭合低度 5 条 |
| 4 | **无偏差** | 两条阻塞均确认闭合；本轮仅 3 条低度（行为表 token 可解析性检查、Task 9.6 与 C3 加性投影的措辞张力、Task 4.14 的 `removed` 行过滤与 design §2 补行义务）→ 均已按 AGENTS §3.2「仅小修改无需再对抗性审查」的口径就地闭合 |

**范围判定记录**：第 3 轮提出的「Task 4.14 是否构成 milestone 范围扩大」经审查确认**不成立**——依据是 `goal.md` Scope direction 2 的原文「**门面自有 register 一律返回标准 handle**，官方必要附加能力（如 `.replace`）作为 handle 成员保留；裸 disposer 与旧式结果在门面层收口」与 `requirements.md` Req 2.1 的同义无条件条款；design §1 明文「内核是本次收口的『唯一规则来源』……§2 任何一行与本节冲突时以本节为准并按 §4 修订分册」，故 design §2 是处置映射而非穷尽枚举。Task 4.14 是在**已批准的 Req 2.1 验收边界内**完成内核落地，不新增能力、不新增 R 点、不改官方 seam，不触发 AGENTS §3.2 的硬停机点。
