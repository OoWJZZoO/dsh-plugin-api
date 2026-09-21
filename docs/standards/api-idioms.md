# 公共 API idiom 标准

> 适用范围：所有门面 host/client 公共叶子成员、公开 handle 与事件面。
> 关联：namespace 放置见 `public-api-shape.md`；语义三面见 `api-shape.md`；组合和 authority 见 `composition-and-authority.md`；身份、生命周期和并发见 `identity-and-lifecycle.md` 与 `concurrency-and-cancellation.md`；能力来源与 `services.*` 例外见 `capability-strategy.md`。

## 1. 分类原则与登记边界

**API idiom** 是调用方必须掌握的固定交互套路。成员按语义分类：调用方与它交互时需要遵循相同套路的成员属于同一 idiom；现有名字、实现包、namespace、领域读写属性和历史交付状态都不是分类依据。

除 `services.*` 外，每个公共叶子成员必须有且仅有一个主 idiom。namespace 只提供 bounded-context 导航，不能替成员承担语义标注；公开 handle 上的成员也必须按实际 dot path 单独登记。一个成员确实横跨两套套路时，应先拆为各自 idiom 的成员；不能拆时，registry 必须记录唯一主 idiom 和六项例外：`memberPath`、`baseContract`、`exception`、`reason`、`replacementShape`、`verification`。

**扩展成员与例外记录的边界**（六项例外的适用范围）：handle 上的**领域扩展成员**——例如 provider 注册的 `.replace`、scoped 注册的 `targetId`、工作流运行 handle 的 `meta` / `result` / `cancel`、资源 handle 的 `status()` / `snapshot()`、异步 contribution 的 `status()`、settings 桥的 `face` / `render`——按**公共 path 单独登记成员行**即可，**不消耗六项例外**。六项例外只保留给**外层合同偏离**：入口动词、结果形状、失败呈现、身份成员集与 `baseContract` 不一致。判据是「该成员是否改变了调用方必须学会的那套外层交互」——不改变的是领域扩展，改变而无法拆分的才登记例外。

**官方动词原样透传类的判定规则**（六项例外的唯一 register 例外类）：同时满足以下四条才可登记为「官方动词原样透传」——① 该成员的 authority 是官方组件包，且官方显式要求原样转发其注册动词；② 门面不铸第二身份（不派生 owner、不铸造 generation、不包装结果）；③ 官方返回 disposer 时原样返回；④ 在 registry 登记六项例外，且 `currentShape` 写明官方动词名。该类成员**不得**与门面自有 handle 混列在同一名字面下；读者必须能仅凭登记分辨「门面自有 handle」与「官方动词透传」。门面自有（非 `services.*`）注册一律以所属 idiom 的标准 handle 收场，不得以领域对象、`undefined`、裸 disposer 或查询值收场。

现行逐成员事实、host/client runtime、能力路径、组合模式、authority、可用性、旧路径状态和 `services.*` 白名单均以 [public-contract.registry.json](../specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json) 为唯一事实源。本册规定成员应满足的公共契约，不复制 registry 的逐叶子清单。

公共成员只使用下列八类 idiom：

| Idiom | 调用方心智动作 | 系统主导方 |
|---|---|---|
| `projection` | 取得或订阅冻结视图 | 调用方读取 |
| `policy` | 声明纯决策，由系统在决策点回调 | 系统调用策略 |
| `mutation` | 写入持久或半持久事实 | 调用方提交写入 |
| `operation` | 发起动作并等待确定终态 | authority 主导内部阶段 |
| `contribution` | 向装配器投入可撤销内容 | 装配器消费 |
| `resourceRegistry` | 登记数据或实现供系统按键使用 | 系统消费登记项 |
| `coordination` | 获得、续期、归还或抢占受控资源 | 租约与 fencing 规则 |
| `selfDescription` | 查询门面自身状态和能力 | 门面 |

`services.*` 是唯一 passthrough exception：其语义和兼容保证由官方契约及审计白名单决定，不套用八类 idiom；任何非 `services.` 路径不得标为 passthrough exception。直接 import 官方内部包仍是 unsupported escape hatch，不是 `services.*`。

## 2. 共用词汇和外层契约

- 判别式结果统一使用 `ok: boolean`、稳定机器码 `code` 与面向人类的 `reason`；`status` 不作成功标志。
- `id` 是资源身份。身份参数与资源归属是两个不同概念，必须分开表达：`ownerId` 是**调用者身份**，一律由调用上下文派生，调用方不得伪造；「资源所属者 / 目标 scope」是**领域参数**，必须以自己的名字出现（如 `targetId`、`scope`、`target`），不得借用 `ownerId` 命名，也不得用统一命名抹掉真实的归属语义。registry 的 `identitySource` 用 `derived-caller` 表示前者、`declared-resource-scope` 表示后者；调用方上下文不可追踪时使用根 token，并如实登记 `derived-caller (root-fallback)`。
- `generation` 是 **owner 铸造的不透明 token，标识 (owner, key) 槽位当前占用者**，用于判定 stale / superseded——即"旧状态、旧回调、旧 disposer 是否已被取代"。它不跨 owner 比较、不承载排序；注册顺序使用 `seq`；只用于判新的后端或装配代次使用 `epoch`。三者不得互换。**所有 `policy` 与 `resourceRegistry` handle 一律必含 `generation`**，不按 composition 分层、不因注册是 additive 而省略。`coordination` 的 `generation` 是 fencing 令牌，见 §3.7。
- 需要销毁的普通 handle 使用幂等 `dispose()`，返回冻结判别式结果 `{ ok, code, reason? }`：资源类（policy / registry / contribution / projection observer）成功码是 `revoked`、no-op 码是 `stale`（已释放、被新 generation 取代、资源已不存在）；operation handle 的 `dispose()` 表示「请求停止」而非终态裁决，成功码是 `requested`、no-op 码是 `stale`，终态由 `status()` 承担。stale disposer 绝不能撤销新 generation 或其他 owner 的资源，也绝不抛穿调用方（释放失败以 typed 失败码报告）。coordination lease 是例外，归还只能通过 `release(handle)`，不套用普通 disposer 契约。
- `terminal` 统一使用 `success | error | aborted | denied | superseded`。timeout 归入 `error` 并由原因字段标记；mutation 使用 `commitState` 承载其终态，资源生命周期使用 `lifecycleState`，不得混用字段语义。
- 每个公共 namespace 提供无副作用的 `availability()`，同步返回冻结对象且至少含 `status: active | degraded | unavailable`。**`status` 是可跨 namespace 比较的量，等于该 namespace 声明的当前可用性口径的最小值**：全部在册部分可用 ⇒ `active`；任一在册部分不可用 ⇒ `degraded`；命名空间整体不可用，或请求的目标 / scope 超出其后端能力 ⇒ `unavailable`。**字段语义分离**：`operations`、`durability`、`backend` 等字段表达**后端能力声明**（能做什么），不参与 `status` 聚合；当前可用性由 `status`（必要时附 `reason`）承担。各 namespace 的「在册部分」集合（如 `sources`、`faces`）与聚合方式必须在 registry 的 `availabilityShape` 或该行 `currentShape` 中声明。
- **领域 detail 必须保留**：非标准状态按下表归一（`unsupported` → `unavailable`；`unknown` / `inert` → `degraded`；`available` → `active`）并附 `reason`；不在三值也不在映射表内的 token 一律以 `degraded` + `reason`（含原 token）呈现，**禁止静默回落到描述符状态**。领域对象的其余字段（如 `scope`、`durability`、`operations`、`backend`、`epoch`）一并保留在同一冻结对象中，装饰层只做状态归一、不做裁剪。局部降级必须在 detail 中指明降级部分并附 `reason`；禁用形态与非禁用形态必须保留**同一 detail 字段集**（含 `epoch`）——「同一字段集」义务适用于**披露了领域记录**的面（禁用时以同一字段集回报，如 `storage` / `executions` / 四个决策面）；对**没有领域披露**的 namespace（描述符回落路径），`status` 非 `active` 时必须以 `reason` 点名不可用的 backing（不得只回裸 `status`），但不虚构 `epoch` 等未被披露的字段。禁止「有对象即 active」或「解析成功即 active」的判定分支；异步领域解析须在挂载期完成并缓存，使公共探针永远同步可读。
- 能力存在性由根 `capabilities.*` 表达；能力矩阵使用 `capabilityMatrix()`，不得占用 `availability` 名称——`capabilityMatrix()` 的内容模型是**当前能力簇 + 当前状态 + 限制 / 缺口原因**，它不承载迁移账本（改名 / 合并 / 迁移 / 删除 / 内化等历史处置只存在于 registry 的登记面，不进运行时可见输出）。
- 同一 idiom 的外层失败呈现、冲突结果、handle 名称与生命周期语义必须一致。领域参数、reducer 和并发选择只能在显式领域字段中变化，不能另造外层合同。
- **失败呈现的分界**：注册类成员（`policy` / `resourceRegistry`）失败一律 **typed throw**（输入非法、owner-conflict、环境不可用）；contribution / mutation / operation / coordination 失败一律返回**判别式结果**（环境不可用在该 idiom 下映射为 `inactive` / `unavailable` 码）。
- 公共成员 SHALL 显式声明调用形态（同步 / 异步），不得以返回值形态暗示同步。同步与异步差异本身予以保留，不做形态同化。
- **注册冲突词表（封闭）**：每个注册成员的 `conflictRule` 必须取以下值之一并与实现行为一致——`latest-wins`（同 owner 同 key 后登记者生效，旧 handle 变 stale）、`content-conflict`（同 key 同 owner 内容不同即 typed conflict）、`owner-conflict`（跨 owner 同 key 抛 typed conflict）、`owner-scoped`（按 owner 隔离、跨 owner 并存）、`fencing`（以 fencing 令牌判代次）、`not-applicable`（非注册成员）。跨 owner 同 key 一律不得静默覆盖。**由官方权威裁决**的成员在 `currentShape` 写明「官方裁决」，其词表值必须与官方行为一致——同 owner 重复注册若官方直接抛错，不得声明为 `latest-wins`；验证必须使用与官方行为一致的 owner 桩，宽松桩不得充当证据。

## 3. 八类标准形状

### 3.1 `projection`

用于冻结视图与订阅。查询使用 `get`、`list`、`inspect`、`history` 或 `current`；订阅统一使用 `observe`，不以 `on`、`once`、`watch`、`subscribe` 或 `onChange` 作为公开入口。

- 查询返回冻结只读视图；缺位或降级返回降级视图或 typed unavailable result，不抛穿调用方。**缺位词汇固定**：确定不存在 ⇒ `missing`；无法得知 ⇒ `unavailable`。成功只读视图不带 `ok` 字段是合法的（视图本身不是判别式结果）。
- `observe(subject?)` 返回 `{ current(), subscribe(listener), dispose(), epoch }`。`subscribe(listener)` 返回可用于退订的函数；handle 已释放时 `subscribe` 是 no-op（返回 no-op 退订函数）而非抛错；回调异常只降级该监听者；dispose 后不再回调且不影响其他订阅者。handle 只含这四个公共成员加**已登记的领域扩展**（冻结或等价不可变），内部可变记录（listener 集合、`disposed` / `stale` / `signal` / `abortHandler` 等）绝不外泄。
- **观察入口的入参合同**：`observe` 接收**单一 subject 参数**——规范形态是 options 对象（字段名与该命名空间同类动词一致，如 `coordination.observe({ resource })` 与 `acquire({ resource })`）；成员 MAY 额外接受裸主题便捷形态（字符串 id / name、领域对象或 handle），两种形态必须语义一致并在登记中写明；无主题的投影接受零参（或仅 options）。**任何观察入口不得接受订阅回调作为参数**——listener 一律经 `handle.subscribe(listener)` 挂上，纯 listener 形态退役。该禁令的范围是**投影观察入口**（namespace 级 `observe` 与其返回的 handle 契约）；operation handle 上已登记的领域扩展成员不受此限——如 `workflows.start.handle` 登记的 `observe(listener)` 是 run-scoped 过滤订阅并返回退订函数，其语义由该 handle 自己的登记承载。
- **同一命名空间内同义动词的入参形态必须一致**：同一资源的 `observe` 与 `acquire` 等入口使用同一字段名与同一语义。
- **`current()` 的调用形态按成员声明**：允许同步视图或 Promise 视图，由 registry 的 `callShape` 显式声明；调用方以 `const h = await ns.observe(subject); const v = await h.current()` 的 `await` 写法统一使用（`await` 对同步值透明）。不得为形状统一把异步读面伪造成同步。
- **降级与非法输入**：域处于降级（已释放 / 无法回答）时返回**同形降级 handle**（四成员合同齐备、`current()` 返回降级视图、`subscribe` 为 no-op、`dispose()` 返回判别式）；命名空间未挂载时按既有惯例抛 typed error；非法输入以 typed 结果或带 `code` 的 typed error 表达——**任何观察入口不得抛裸 `TypeError`**；非函数 listener 一律不注册且不抛穿。
- **事件面信封（host / client 同形）**：事件面的 `observe(subject)` 在任一端都以**冻结判别式信封**承载 handle——成功 `{ ok:true, code:'observed', handle }`；handle 本体仍是上面那四个成员，成员行按各自运行时的真实形状登记，不因此消耗例外。未知名必须是 typed 结果而不是裸 `TypeError`：host 的**非 catalog 名**以 `{ ok:true, code:'untyped', handle, reason }` 如实表达既有的**无类型透传通道**（自定义事件的既有观察路径，不关闭）；client 的事件面只有官方事件，未知名以 `{ ok:false, code:'unsupported', names }` 返回并给出可查询目录。两端信封同层同形，`code` 的差异即两端真实环境差异（登记为环境差异），读者可仅凭返回值判断所在端。
- 查询与订阅必须由不同成员表达：查询用 `get` / `list` / `inspect` / `history` / `current`，订阅用 `observe`；不得用一次调用同时充当快照与订阅。成员名须反映真实语义——拉取分页事件帧的成员不得占用 `list` 的资源枚举含义。
- 查询天然幂等；订阅是 additive 或 pure，不以订阅注册顺序表达业务语义。
- **绑定 / 访问器型成员的登记义务**：返回领域绑定对象（带读 / 写 / 订阅面）的查询成员（如 settings scope 一类）必须在 registry 登记该对象的成员集、读写面、`lifecycle` 与释放边界——写明「为何没有 `dispose()`」或「`dispose()` 释放的是什么；官方持有的部分随什么存续、调用方卸载是否移除」。不得以「领域不同」为由省略该登记。

### 3.2 `policy`

用于声明在明确决策点由系统调用的纯决策。入口为 `register(spec)`；`spec` 明确含 `id`、`priority` 与 `decide(context)`。

- handle 固定为 `{ id, ownerId, generation, dispose() }`；owner 由调用上下文派生，**generation 由门面按 owner 铸造，必含、不省略**。handle 上的领域扩展成员按 §1 单独登记，不消耗例外。
- 注册键决定冲突维度，且必须与 registry 的 `conflictRule` 一致。**(owner, id) 键控**的注册表：同 owner 同 id 为 latest-wins，不同 owner 的同名策略各自生效、在同一决策点共同参与收敛，允许并存——登记为 `owner-scoped`（如 `security.policy` / `security.redaction` / `security.egress`）。**id 全局限定**的注册表：同 owner 同 id 为 latest-wins，跨 owner 同 id 抛 typed conflict——登记为 `owner-conflict`（如 `llm.requestTransforms` / `llm.admissionPolicies` / `prompts.provenance.policy`）。两种形态都**以 typed error 表达注册错误，不返回 `ok:false` 或静默 no-op**（与 §3.3/§3.4/§3.5/§3.7 的判别式结果分界见 §2「失败呈现的分界」）。
- `dispose()` 返回冻结 `{ ok, code, reason? }`，成功码 `revoked`、no-op 码 `stale`（§2）。
- priority 词表固定为 `lowest | low | normal | high | highest | monitor`，同 priority 按成功注册顺序；未知 priority 必须报错，不得静默按默认档处理。领域 reducer 负责收敛策略结果并隔离策略回调错误。
- 注册必须自动生效。没有系统决策点的策略不得暴露让调用方自行咨询的入口；应在 registry 记录不可用能力及所需决策点性质。

### 3.3 `mutation`

用于写入不可逆领域事实。单步写入使用领域动词；事务中的事实写入使用 `record(op)`，并由 operation 的 `prepare`、`commit`、`rollback` 驱动。

- 业务结果返回冻结 `{ ok, code, commitState, generation, ... }`；公共契约破坏和不可恢复编程错误才抛 typed error。
- 已提交事实不提供 disposer；补偿必须是显式领域操作，例如 `restore`。
- 同资源写入使用 CAS/fencing 或等价 authority；终态重试返回既有终态并表明幂等性。

### 3.4 `operation`

用于发起由 authority 主导内部过程的动作。入口使用领域动词，接收 `options.signal` 时必须保留上游取消语义。

- 结果形状为 `{ ok, code, operation, ... }`，其中 `operation` 是控制该操作的 handle；**`terminal` 仅在返回时终态已可裁决时出现**——接受时尚未裁决的结果不带 `terminal`，其终态来源是 `operation.status()`，这条在场条件是一般规则，不为个别成员登记例外。长操作 handle 固定为 `{ id, ownerId, status(), observe(), dispose() }` 加已登记的领域扩展。事务 handle 可附加 `record`、`preview`、`commit` 与 `rollback`。
- `observe(listener)` 返回退订函数，并在订阅时首投当前状态。`dispose()` 只请求停止（返回 `requested` / `stale`，§2），正确性依赖提交资格与 generation guard。内部 retry 只增加 attempt，不创建新 operation；外部重发始终创建新 operation。
- `status()` 的领域词汇可以不同（`phase`、`state`、`attempts` 等），但字段名与终态词汇统一为 §2 的 `terminal` 词表；不得用生命周期词代替终态。
- 冲突统一返回确定 outcome。领域只可声明 `exclusive`、`latest-wins`、`queue`、`compare-and-swap` 或 `deduplicate` 等并发策略，不能改变外层结果形状。

### 3.5 `contribution`

用于把可撤销内容交给装配器，且不产生领域事实。入口为 `contribute(spec)`，返回判别式结果与 `{ id, ownerId, seq, dispose() }` handle。

- 同 owner 同 id 冲突返回稳定码；不使用 latest-wins，不使用 generation。
- 系统可在明确容量上界驱逐贡献，但必须可观测；异步生效的 contribution 必须在完成前提供可安全 dispose 的 pending handle。
- **异步生效的 contribution handle 增加 `status()`**，取值为 `pending | active | failed | revoked`（必要时附 `reason`），使调用方不必用 Promise 链承担撤销责任；同步生效的 contribution 不提供该成员。这是异步 contribution 的一般规则，不逐成员登记例外。
- `dispose()` 返回冻结 `{ ok, code, reason? }`，成功码 `revoked`、no-op 码 `stale`；在 pending 阶段即可安全调用。
- 与 mutation 的分界是可逆、不写领域历史且不使用并发控制令牌；与 registry 的分界是内容由装配器统一消费，而非按 key 独立取用。

### 3.6 `resourceRegistry`

用于登记由系统按键消费的数据或实现。入口为 `register(spec)`；查询面使用 `get` 与 `list`。门面自有（非 `services.*`）注册一律以标准 handle 收场；**官方动词原样透传是唯一的 register 例外类**，其判定规则与登记义务见 §1。

- handle 固定为 `{ id, ownerId, generation, dispose() }`，与 policy handle 同构；**`generation` 必含**（§2）。
- 同 owner、同 id、同内容的重复登记幂等返回既有条目；同 owner、同 id、不同内容抛 typed conflict；跨 owner 冲突抛 owner-conflict。
- 注册错误以 typed error 表达（§2「失败呈现的分界」）；`dispose()` 返回冻结 `{ ok, code, reason? }`，成功码 `revoked`、no-op 码 `stale`。
- 资源登记不等于策略：系统调用登记项的动作但不取得决定时，仍属 registry；只有在决策点取得决定的纯回调属于 policy。

### 3.7 `coordination`

用于租约、占用、抢占与条件写。公开动词固定为 `acquire`、`heartbeat`、`release`、`takeover`、`compareAndSet`、`observe` 与 `availability`，且状态变更入口全部异步。

- 状态变更返回 `{ ok, code, operation, observedAt, ... }`；lease handle 固定含 `{ id, resource, generation, fencingToken, expiresAt }`，不是 disposer handle。
- `generation` 是 fencing 令牌。`takeover` 必须带 expected proof，并记录跨 owner 抢占的 reason 与 provenance。
- 失败不抛穿：使用 `inactive`、`invalid-input`、`conflict`、`unavailable`、`unsupported` 等稳定码。`release` 幂等；过期或 stale handle 的 heartbeat 返回 typed result。
- `availability(scope)` 必须说明 durability、支持的 operations、backend 与 epoch；宿主不能提供 durable/atomic 语义时，只能诚实降级并报告。这些领域 detail 必须**保留在同一冻结的公共 `availability()` 结果**中（§2），不得为统一外形丢弃；异步解析在挂载期完成并缓存，公共探针同步可读。

### 3.8 `selfDescription`

用于查询门面自身的版本、能力与当前状态。根面包含 `isActive`、`apiVersion`、`assertCompatible` 与 `capabilities.get/list/require`；namespace 面使用 `availability()`。

- `availability()` 永不抛错，返回冻结状态；`capabilities.require` 在 capability 不可用时抛 capability-unavailable typed error。
- 此 idiom 无 owner、冲突或 disposer，调用应为 pure、幂等且无副作用。
- `events.catalog()` 属 selfDescription：它描述门面支持的事件词汇，不是领域投影。

## 4. 事件面

事件机制不是第九种 idiom：`events.catalog()` 属 selfDescription，`events.observe` 属 projection，`emit`、`serial`、`parallel`、`bail`、`waterfall` 属派发型 operation。派发型 operation 不产生独立 operation identity，也不重试；其余外层 operation 合同仍适用，并必须返回可表达 containment 的判别式结果。

每个事件成员在 registry 中额外登记 `decision`、`fact`、`observation` 或 `notification`：decision 是 policy 的事件式变体；fact 是 mutation 写入后不可撤销的领域事实；observation 是可丢失的诊断信号；notification 只作告知，不构成 idiom。

**订阅权不等于生产权。** canonical system event 的派发只授予相应的 producer authority：**event → producer owner 的映射由 canonical 事件目录条目承载**（registry 的 `producerAuthority` 字段，运行时由事件目录条目携带同一归属）。派发前必须判定调用者是否为该事件的 producer owner——不是则返回 typed `denied`，绝不派发。目录中**未声明 producer 归属的条目默认不可由第三方派发**（fail-closed）。门面自身的转译生产路径（把官方事件映射为门面事实、替代行派发官方事件）以内部 owner 身份取得权限，不占用第三方路径。第三方自定义事件只能通过 owner-scoped 的 `events.define(spec)` 获取能力受限 publisher，其名称空间、owner 归因与 stale 语义保持不变，不能依赖全局任意事件派发；事件式 policy 必须明确优先顺序、冲突收敛、监听者故障 containment 与默认决定。

## 5. Registry 与一致性检查

成员 registry 必须至少保存：

```text
publicPath, idiom, idiomExceptions, eventSemantics, semanticFace, effect,
composition, runtime, implementationChannel, authority, scope, resourceKey,
identitySource, conflictRule, lifecycle, failureSemantics, idempotency,
retryLayer, availabilityShape, concurrency, reducer, currentShape,
targetPath, migrationAction, callShape
```

`callShape` 是同步 / 异步的**显式声明**（§2）：取 `sync` / `async` / `not-applicable`（后者用于值行——handle 与已退役行），公共成员必须声明调用形态，调用方不得靠返回值形态猜测。

验证必须确保：每个公共叶子与 handle 成员已登记；每个成员有八类 idiom 或受限 `services.*` 例外；入口动词、失败/冲突形状和 handle 与所属 idiom 一致；**policy / resourceRegistry 的 handle 一律含 `generation`**；**handle 上的领域扩展成员已按其公共 path 登记成员行，且登记成员集与运行时实际成员集一致**；**`dispose()` 与失败呈现与登记的 `failureSemantics` / `lifecycle` 一致**；generation/seq/epoch 语义未混用；每个 namespace 有 `availability()`（`availabilityExemption` 除外）；所有事件登记事件语义（含 `producerAuthority`）；同步 / 异步语义已声明；registry、host/client 类型与 active/disabled surface snapshot 的成员集合一致。能力删减、迁移、合并或缺口必须保持能力守恒，并在相应 feature 的迁移账本中留下替代或 gap 证据。
