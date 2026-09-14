# Stage 1 Requirements: plugin-api-m11-contract-enforcement

> feature_name: `plugin-api-m11-contract-enforcement`
> milestone: M11
> status: Stage 0–2 已交付（2026-09-14）。本文与同目录 `goal.md`、`design.md` 同日由 SPEC1 一口气产出并提交；不创建 `tasks.md`、不写实现代码。
> 上游输入：本目录 `goal.md`（十条 Scope direction，逐条对应见文末对照表）；`temp/m11-api-contract-convergence-handoff.md`（§3 主线 A、§4 主线 B、§5 局部必修 C1–C14、§6 排除项、§8 验收目标、附录 A–D 子审线索；该文件为临时输入，本线已把其结论固化进 design §2 处置表）；canonical registry（`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`）；`docs/standards/*` 十二册；本线开工时的只读证据核验（design §2 各行的 `file:line` 锚点）。

## Status

Stage 1 Requirements（2026-09-14 交付）。本文是 M11 契约收口 feature 的验收合同：它拥有外层合同（idiom 入口、handle、失败呈现、身份、availability、生产权）的收口权与分册修订的提案权，不拥有各领域运行时状态的所属权（领域语义仍归各领域 owner）。全部条款在冻结版本基线（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`）内交付，不提出任何版本字段变更。

通道标注约定：每条 EARS 条款末尾以【…】标注其性质——

- 【A】官方已 dispatch / 已提供服务，门面只需稳定化；【B】官方无 dispatch 点，经底层钩子/官方服务模拟；【C】不改官方做不到，只能 upstream proposal；【R】涉及既有替代包内部扩展面的修订（引 `docs/standards/capability-strategy.md` R1–R8；**本线不新增 R 点**）。
- 【治理】纯文档 / 登记 / 验收判定义务，无运行时通道；【验收】测试与证据义务；【分册】standards 分册修订义务。
- 涉及已交付成员形状的条款，其 A/B/R 判定随对应领域既有设计；本文只定义外层合同与处置义务，不重裁领域内部语义。

## Req 1 输入固化与处置表

- **User story**：作为维护者，我要看到指引列出的每一项问题都有明确去向和证据，以便在实现前就知道哪些要改、哪些是合理例外、哪些不成立。
- **Req 1.1** WHEN 本线进入设计 THEN 指引 §3/§4/§5 的全部问题项（主线 A1–A5、主线 B1–B3、局部必修 C1–C14）与子审追加线索（附录 A–D 的剩余线索，含 design §2.3 的 C15–C17）SHALL 逐项进入处置表，字段含：问题编号、实际公共 path、源码证据锚点（按符号定位）、当前实际形状、目标 idiom 与形状、处置结论（修复 / 合理例外 / 已修复 / 误报）、依据与理由；任何计数型结论 SHALL 写明计量单位（成员行 / 例外记录 / 公共 path）与取样口径。【治理】
- **Req 1.2** WHEN 某处置结论为「合理例外」THEN 该行 SHALL 引用 registry 的六项例外记录（`memberPath`、`baseContract`、`exception`、`reason`、`replacementShape`、`verification`）或给出待登记的完整六项内容；SHALL NOT 以「领域不同」为唯一理由。【治理】
- **Req 1.3** WHEN 某处置结论为「误报 / 已修复」THEN 该行 SHALL 附当前源码证据（`file:line` 或符号）说明为何不成立或已完成；SHALL NOT 为凑齐问题而实施无意义修改。【治理 + 验收】
- **Req 1.4** GIVEN 指引文件仅存在于 `temp/`（gitignored、永不提交）THEN 其范围与结论 SHALL 在实现开始前固化进已提交的本 spec 制品；SHALL NOT 让实现或验收依赖 `temp/` 文件的可获得性。【治理】
- **Req 1.5** WHEN 本线开工 THEN 代理 SHALL 先核对指引基线 `9b6c243` 之后是否存在新提交或已实施的修复，并对已修复项标注复用；SHALL NOT 重复实施已完成的修复。【治理】

## Req 2 统一登记 handle 与 dispose 合同

- **User story**：作为插件作者，我要在任意 `register(...)` 上拿到同一形状的 handle，并用同一个 `dispose()` 语句释放，以便不逐个成员查文档。
- **Req 2.1** WHEN 门面自有（非 `services.*`）注册成员成功 THEN 其返回值 SHALL 为该 idiom 规定的标准 handle 对象；`policy` 与 `resourceRegistry` SHALL 返回 `{ id, ownerId, generation, dispose() }`，除非该成员已登记完整六项例外。【治理 + 验收】
- **Req 2.2** WHEN 官方注册 API 在 handle 之外提供必要附加能力（例如 provider 注册的 `.replace`）THEN 该能力 SHALL 作为 handle 的显式成员保留并登记，SHALL NOT 因形状统一而删除真实能力。【A + 治理】
- **Req 2.3** WHEN 同一成员因附加参数（例如 `scope` 目标）改变安装目标 THEN 其外层结果形状 SHALL 保持不变；scope 失败 SHALL NOT 退化为全局安装。【验收】
- **Req 2.4** WHEN 任一普通 handle 的 `dispose()` 被调用 THEN 它 SHALL 幂等，返回冻结判别式结果（`ok`、稳定 `code`，必要时 `reason`）；重复释放或已被新 generation 取代时 SHALL 返回类型化的 no-op 结果；SHALL NOT 撤销新 generation 或其他 owner 的资源。【验收】
- **Req 2.5** WHEN `dispose()` 属于 operation handle THEN 其语义 SHALL 是「请求停止」而非终态裁决，返回结果 SHALL 与该语义一致；coordination lease 的归还 SHALL 保持 `release(handle)`，不套用普通 disposer。【验收；例外引 api-idioms §3.7】

## Req 3 owner 身份与资源所属者

- **User story**：作为插件作者，我不应通过填写一个字符串就成为别人的资源所有者；作为维护者，我要能从登记看出身份到底从哪里来。
- **Req 3.1** WHEN 某公共注册 / 策略 / 变更成员需要 owner 身份 THEN 该身份 SHALL 从调用方上下文派生；SHALL NOT 接受调用方自报的 owner 字符串作为调用者身份。【治理 + 验收】
- **Req 3.2** WHEN 某成员确实需要表达「资源所属者 / 目标 scope」而非调用者身份 THEN 该语义 SHALL 以独立命名的领域参数保留，并与 `ownerId` 在同一成员上可区分；SHALL NOT 借统一命名删除真实语义。【治理】
- **Req 3.3** GIVEN 调用方上下文不可追踪 THEN 该成员 SHALL 使用根 token 并在 registry 的 `identitySource` 中如实登记回退事实；SHALL NOT 静默使用来源不明的统一 owner。【治理 + 验收】
- **Req 3.4** WHEN 同 owner 同 id 再次登记 THEN 冲突行为 SHALL 为 latest-wins 或 typed conflict 之一（按该成员 idiom 规定）；跨 owner 同 id SHALL NOT 静默覆盖，SHALL 返回 typed owner-conflict。【验收】
- **Req 3.5** WHEN registry 的 `identitySource` / `conflictRule` 字段与实现不一致 THEN 二者 SHALL 在本线内对齐（改登记或改实现，并记录判定理由）。【治理】

## Req 4 availability 与能力自描述

- **User story**：作为插件作者，我要能从 availability 判断某项能力此刻能不能用、有哪些附加限制，而不是看到不真实的 active。
- **Req 4.1** WHEN 任一公共 namespace 暴露 `availability()` THEN 返回 SHALL 为冻结对象且含 `status: active | degraded | unavailable`；`availability()` SHALL 无副作用、不抛穿调用方。【验收】
- **Req 4.2** WHEN 领域提供的可用性取值不属于标准三值（例如 `unsupported`、`unknown`、`inert`）THEN 归一 SHALL 映射为 `degraded` 或 `unavailable` 并附 `reason`；SHALL NOT 出现「有对象即 active」或「解析成功即 active」的判定分支。【验收】
- **Req 4.3** WHEN 领域可用性携带调用方决策所需的领域信息（例如 coordination 的 durability / operations / backend / epoch）THEN 该信息 SHALL 在公共 `availability()` 结果中保留；SHALL NOT 为统一外形丢弃有意义的领域字段。【验收；引 api-idioms §3.7】
- **Req 4.4** WHEN 领域可用性实现为异步 THEN 公共 `availability()` SHALL 仍以同步方式返回可用结果（异步解析在挂载期完成并缓存），SHALL NOT 让通用探针读到 `undefined`。【验收】
- **Req 4.5** WHEN `capabilities.get/list/require` 查询能力 THEN client 面 SHALL 接受与 host 一致的公共语义 dot path（含成员级 path），并按真实叶子状态报告状态；SHALL NOT 以对象存在性报告 `active`。【验收】
- **Req 4.6** WHEN `services.*` 保留官方存在性口径（`isActive`）THEN 该例外 SHALL 在分册与 registry 中被显式登记为受支持例外；其余命名空间一律使用 `availability().status`。【治理 + 分册】

## Req 5 观察面分层与公共 handle

- **User story**：作为插件作者，我要在 host 和 client 用同一个套路建立观察、读当前值并释放，并且拿到的对象不含内部状态。
- **Req 5.1** WHEN 任一 projection 成员提供订阅 THEN 入口 SHALL 为 `observe`，返回 `{ current(), subscribe(listener), dispose(), epoch }`；SHALL NOT 以 `on` / `once` / `watch` / `onChange` 作为公开订阅入口（`services.*` 除外）。【验收】
- **Req 5.2** WHEN 调用 `subscribe(listener)` THEN 其返回 SHALL 是可用于退订的函数；handle 已 dispose 时订阅 SHALL 为 no-op；回调异常 SHALL 只降级该监听者。【验收】
- **Req 5.3** WHEN 观察 handle 被返回给调用方 THEN 其 SHALL 只包含公共成员（`Object.isFrozen` 成立或等价不可变），SHALL NOT 暴露内部 listeners 集合、`disposed` / `stale` / `signal` / `abortHandler` 等可变实现字段。【验收】
- **Req 5.4** WHEN 同一命名空间同时提供「读当前状态」与「订阅变化」THEN 二者 SHALL 以不同成员表达（查询用 `get` / `list` / `inspect` / `history` / `current`，订阅用 `observe`）；SHALL NOT 用一次调用同时充当快照与订阅。【验收】
- **Req 5.5** WHEN 某成员实际拉取的是分页事件帧而非资源枚举 THEN 其名称 SHALL 反映该语义，SHALL NOT 占用 `list` 的资源枚举含义。【治理 + 验收】

## Req 6 操作身份、结果词汇与控制对象

- **User story**：作为插件作者，我要能从 session 请求、workflow 启动、checkpoint 恢复拿到同一个「控制对象」，并用同一段代码观察与停止它。
- **Req 6.1** WHEN 长操作发起成功 THEN 结果 SHALL 为 `{ ok, code, operation, ... }`，其中 `operation` 为控制该操作的 handle；`terminal` **仅在返回时终态已可裁决时出现**，该在场条件 SHALL 作为分册一般条款（design §4-S13）生效，SHALL NOT 逐成员登记例外，也 SHALL NOT 为未裁决的接受结果伪造终态。【验收】
- **Req 6.2** WHEN 长操作 handle 被返回 THEN 其成员 SHALL 为 `{ id, ownerId, status(), observe(), dispose() }` 加已登记领域扩展；`observe(listener)` SHALL 返回退订函数并首投当前状态。【验收】
- **Req 6.3** WHEN 某成员的结果字段承载的是「动作名称」而非操作身份 THEN 该字段 SHALL 改名，SHALL NOT 占用 `operation` 名称。【治理 + 验收】
- **Req 6.4** WHEN 某动作不产生调用方持有的长操作 THEN 该成员 SHALL 按语义归类（mutation / policy / projection / 带例外的 operation）并登记例外；SHALL NOT 凭字段名给所有动作硬造长操作 handle。【治理】
- **Req 6.5** WHEN 某成员以只读状态快照伴随发起结果 THEN 快照 SHALL 通过 handle 的 `status()`（或独立成员）表达，SHALL NOT 与 handle 共用 `operation` 名称。【治理 + 验收】

## Req 7 贡献面合同与 pending handle

- **User story**：作为插件作者，我要用同一个 `contribute(spec)` 套路向槽位、远程面、设置面板投入内容，并在异步生效完成前就能安全撤销。
- **Req 7.1** WHEN 任一 contribute 成员被调用 THEN 其 SHALL 返回判别式结果（`ok`、稳定 `code`、必要时 `reason`）并携带 `{ id, ownerId, seq, dispose() }` handle；SHALL NOT 返回裸 disposer、裸 Promise 或 `status` 作为成功标志。【验收】
- **Req 7.2** WHEN 贡献的生效是异步的 THEN 调用 SHALL 在完成前即返回可安全 `dispose()` 的 pending handle，且失败 SHALL 可被观察；SHALL NOT 迫使调用方以 Promise 链承担撤销责任。【验收】
- **Req 7.3** WHEN 同一 contribute 语义在 host 与 client 都存在 THEN 其外层结果、失败呈现与 handle 成员 SHALL 同形；SHALL NOT 因运行环境不同另造外层合同。【验收】
- **Req 7.4** WHEN 同步生效的官方挂载入口被收口 THEN 官方挂载 / 租约 / 重绑定正确性 SHALL 保留；SHALL NOT 为形状统一破坏官方挂载语义。【A + 验收】
- **Req 7.5** WHEN 同 owner 同 id 的贡献冲突 THEN SHALL 返回稳定冲突码；SHALL NOT 使用 latest-wins 或 generation。【治理】

## Req 8 事件生产权

- **User story**：作为插件作者，我要明确知道哪些事件我可以派发、哪些只能订阅；作为维护者，我要 canonical 事实不被第三方伪造。
- **Req 8.1** WHEN 调用方派发 canonical 系统事件 THEN 门面 SHALL 判定其 producer authority，非 producer SHALL 收到 typed `denied` 结果；判定 SHALL 以内建事件目录中的 producer 归属为依据。【验收】
- **Req 8.2** WHEN 事件目录中某条目未声明 producer 归属 THEN 该事件 SHALL 默认不可由第三方派发（fail-closed），并 SHALL 与 observation / notification 型事件区分登记。【治理 + 验收】
- **Req 8.3** WHEN 第三方需要派发自定义事件 THEN SHALL 继续通过 `events.define` 取得 owner-scoped publisher，其名称空间、owner 归因与 stale 语义保持不变。【验收】
- **Req 8.4** WHEN producer 判定引入 THEN 门面自身的转译生产路径（官方事件的事实生产者）SHALL 保持可用；SHALL NOT 出现「实现自用路径被自身判定拒绝」。【验收】
- **Req 8.5** WHEN 生产权变更落地 THEN 该能力边界变化 SHALL 在正式制品中显式记载并在交付报告中列出；SHALL NOT 通过把入口移入 `services.*` 规避判定。【治理】

## Req 9 host 注册面逐成员收口

- **User story**：作为插件作者，我要在 `llm` 命名空间下的每一类注册、`prompts` 的策略与贡献、`agents` / `tools` 的注册上得到同一套外层交互。
- **Req 9.1** WHEN `tools.register(def)` 与 `tools.register(def, { scope })` 被调用 THEN 二者 SHALL 返回同形外层结果与清理方式；`tools.restrict.register` SHALL 与其一致。【验收】
- **Req 9.2** WHEN `llm` 命名空间下的注册成员（request transforms、admission policies、routing policies / candidates / health、providers、models）成功 THEN 其 SHALL 返回标准 handle 并由门面派生 owner、铸造 generation；SHALL NOT 要求调用方自报 owner 或 generation。【B + R|验收】
- **Req 9.3** WHEN `prompts.provenance.policy.register` 被调用 THEN 其 SHALL 采用 policy idiom 的入口与失败语义（入口含 `id` / `priority` / 决策回调，失败为 typed error 或统一判别式结果），SHALL NOT 保留 `(fn, options)` 旧式签名与 `detail` 字段。【B|验收】
- **Req 9.4** WHEN `agents.providers.register` 被调用 THEN 变体判别 SHALL 显式（不依赖键存在性嗅探），非法输入 SHALL 返回指明合法变体的错误，各变体 SHALL 返回标准 handle 或登记明确的例外。【B|验收】
- **Req 9.5** WHEN 某命名空间在 active 与 disabled 两种安装状态下被访问 THEN 其成员集合 SHALL 一致，仅成员可用性不同；残留 alias 与重复入口 SHALL 按公共面减法处置并落 registry。【治理 + 验收】
- **Req 9.6** WHEN 同一语义在 `prompts.contribute` 的全局路径与 scoped 路径上表达 THEN 匿名 id 推导规则 SHALL 一致，非法输入错误 SHALL 列出合法取值。【验收】

## Req 10 client 公共面收口

- **User story**：作为面板/设置类插件作者，我要能挂载真实槽位，并让 client 的六个旧命名空间与 M9 之后的新面使用同一套合同。
- **Req 10.1** WHEN 面板插件向官方已声明的槽位投入内容 THEN 门面 SHALL 允许该投入，准入判定 SHALL 以官方声明为依据；SHALL NOT 以维护者猜测的前缀集合拒绝真实槽位。【A|验收】
- **Req 10.2** WHEN 插件需要知道某槽位是否已声明 THEN 门面 SHALL 提供只读的声明投影能力（区分「未声明」与「已声明但为空」）。【A|验收】
- **Req 10.3** WHEN client 的 `slots` / `remotes` / `settings` / `connection` / `events` / `codec` 被访问 THEN 每个命名空间 SHALL 暴露与其真实状态一致的 `availability()`，与 registry 的登记一致。【验收】
- **Req 10.4** WHEN client 事件面提供订阅 THEN 其 SHALL 返回标准观察 handle，且事件目录 SHALL 可被查询；未知名 SHALL 返回 typed 结果而非裸 `TypeError`。【验收】
- **Req 10.5** WHEN 某成员的名字暗示「取值」而实际返回的是某个 API 命名空间 THEN 命名 SHALL 反映对象角色；SHALL NOT 用 `get` 伪装 namespace，也不为缩短路径制造重复 authority。【治理】
- **Req 10.6** WHEN host 与 client 存在同一公共 path 的语义资源 THEN 两者 SHALL 使用同一调用套路；若因环境确实不同而保留差异 THEN 差异 SHALL 被显式登记。【治理 + 验收】

## Req 11 分册修订与治理同步

- **User story**：作为维护者，我要每条规则只有一个来源，不再因为分册自相矛盾而在实现里留下两套惯例。
- **Req 11.1** WHEN 本线识别出分册间的矛盾或分册与已交付事实的偏离 THEN 本线 SHALL 产出分册修订清单（分册、条款、现状、问题、修订方向、影响成员与登记、是否需人类确认）并作为正式制品落盘。【分册】
- **Req 11.2** WHEN 分册修订与实现收口同时进行 THEN 两者 SHALL 相互一致：修订后的条款 SHALL 是该成员实现的唯一规则来源；SHALL NOT 保留与分册相反且未登记的例外。【分册 + 验收】
- **Req 11.3** WHEN 分册修订涉及能力上限（`capability-strategy.md`）THEN 该册实质修订 SHALL 经人类确认后方可落盘，并同步 `AGENTS.md` §2/§4 与 `docs/specs/plugin-api-features/feature-list.md`。【治理】
- **Req 11.4** WHEN 修订含树图 / 层级 / 命名空间条目 THEN 分册 SHALL 与 runtime、registry 的现行事实一致（含 client 领域树与已删除成员的清理）。【分册 + 治理】
- **Req 11.5** WHEN 本线新增或重分类 idiom 例外 THEN 例外总数 SHALL 不高于现状（现状为 17 个带例外的成员行 / 20 条例外记录 / 16 个公共 path），核算 SHALL 以「例外记录」为主口径并同时给出「成员行」口径；每条新增例外 SHALL 附完整六项与 `verification`；SHALL NOT 用「改分册」为不必要的认知负担开脱。【治理 + 验收】
- **Req 11.6** WHEN 分册修订被提出 THEN 该修订 SHALL NOT 放宽 fail-safe、版本冻结、横切派发语义（priority / deepFreeze / fault containment）、官方包禁改与既有 Stage 门。【治理】

## Req 12 登记与一致性义务

- **User story**：作为插件作者，我依赖 registry 与文档了解现行形状；它们必须与实现一致。
- **Req 12.1** WHEN 任一成员形状在本线发生变化 THEN canonical registry SHALL 同步更新（`idiom`、`failureSemantics`、`identitySource`、`conflictRule`、`lifecycle`、handle 行、`oldToTargetMapping`），并保持 registry 为唯一事实源。【治理 + 验收】
- **Req 12.2** WHEN 本线的只读核验发现 registry 自身缺口（缺父行、缺 handle 行、`currentShape` 漂移或为 `null`）THEN 缺口 SHALL 逐条修补或显式登记为待办。【治理】
- **Req 12.3** WHEN 形状变更被落盘 THEN `docs/specs/plugin-api-features/feature-list.md` 与受影响的 `README.md` 表述 SHALL 同步；历史制品 SHALL 以文首现状注追加映射，不改写其已获批验收边界。【治理】
- **Req 12.4** WHEN 实现或测试产物被提交 THEN 治理分类字母、需求 / feature 编号等治理 token SHALL NOT 出现在 `lib/`、`packages/`、`test/` 与 `package.json` 中。【治理 + 验收】
- **Req 12.5** WHEN 本线交付完成 THEN 台账 SHALL 记录 22 项问题的最终去向与实际 API 变化清单。【治理】

## Req 13 验收、证据与完成判定

- **User story**：作为维护者，我要用可执行的证据证明契约已收口，而不是靠阅读代码判断。
- **Req 13.1** WHEN 契约收口宣称完成 THEN registry 驱动或本线新增的机械校验 SHALL 全绿，覆盖：入口动词与 idiom 一致、handle 成员集按 composition 一致、失败呈现与登记一致、`generation` / `seq` / `epoch` 未混用、每个 namespace 的 `availability` 存在性。【验收】
- **Req 13.2** WHEN 组合行为宣称一致 THEN SHALL 以两个独立 synthetic 插件在真实公共入口上验证（反向加载顺序、同 key 冲突、卸载隔离、旧 handle 不得撤销新资源、callback 失败隔离）。【验收】
- **Req 13.3** WHEN 迁移与等价性宣称成立 THEN 证据 SHALL 来自真实公共入口执行（迁移切片 / fixture，文件头写明「原行为 → 现行公共调用 → 运行结果」矩阵）；SHALL NOT 以 import 扫描、路径计数或测试总数充当证据。【验收】
- **Req 13.4** WHEN 本线交付 THEN `npm test`（仓库内存护栏内）SHALL 全绿，client bundle SHALL 经重建产出且 `--check` 一致，`git diff --check` SHALL 干净。【验收】
- **Req 13.5** WHEN 本线交付 THEN SHALL 同时满足：处置表全部条目有结论、分册修订清单落盘且与实现一致、registry 与 runtime 成员集合一致、无新增未登记例外、版本冻结与官方包零修改审计通过。【验收】
- **Req 13.6** WHEN 某必需行为无法达成本线目标 THEN SHALL 登记阻塞项（原因 + 最小解除动作 + 是否需人类授权 + 日期）并保持未完成；SHALL NOT 以降级呈现充当完成。【治理】

## Req 14 边界、排除与不回归

- **User story**：作为维护者，我要确保这次收口不夹带功能、不改运行时语义、不动治理之外的系统边界。
- **Req 14.1** WHEN 本线实施任何修改 THEN SHALL NOT 新增公共能力、新增 R 点或改变 `services.*` 白名单成员集合（除非某处置项明确要求并已登记）。【治理】
- **Req 14.2** WHEN 形状收口触及同步 / 异步差异、领域参数、结果 payload 差异 THEN 该差异 SHALL 被保留，SHALL NOT 为表面一致改写运行时语义。【验收】
- **Req 14.3** WHEN 既有合理例外（coordination `release(handle)`、`services.*` 官方形状、workflow run authority、checkpoint 恢复阶段、task 生命周期词汇等）被复核 THEN 其 SHALL 被保留并登记，SHALL NOT 被机械抹平。【治理】
- **Req 14.4** WHEN 版本冻结、fail-safe（apply 不抛穿）、官方包禁改、replacement 行契约复刻与 boot 自检被触及 THEN 约束 SHALL 保持；替代包内部扩展面的修订 SHALL 维持对被替代官方行的契约复刻。【R + 验收】
- **Req 14.5** WHEN 交付完成 THEN 本线 SHALL NOT 遗留 `temp/` 依赖、临时脚本或未提交成果；正式制品与实现 SHALL 按阶段提交义务落盘。【治理】

## Requirements ↔ goal Scope direction 对应表

| goal Scope direction | 承载需求 |
|---|---|
| 1 契约内核先行 | Req 2、3、4、5、6、7、8（内核决策见 design §1） |
| 2 注册面统一 | Req 2、Req 9 |
| 3 身份双角色 | Req 3 |
| 4 自描述诚实 | Req 4 |
| 5 观察面分层 | Req 5 |
| 6 长操作一致 | Req 6 |
| 7 贡献面统一 | Req 7 |
| 8 生产权与订阅权分离 | Req 8 |
| 9 分册双向对齐 | Req 11（清单见 design §4） |
| 10 收口可验证 | Req 1、Req 12、Req 13、Req 14 |

## Standards 对照（requirements 层）

逐分册适用性与对齐结论详见 design §10。本文按验收判据引用：`api-idioms`（Req 2/3/4/5/6/7/8/9/11.5）、`public-api-shape`（Req 4.5/10/11.4/12）、`composition-and-authority`（Req 3/7.5/8/13.2）、`api-shape`（Req 6.4/9.5 的一面原则与归类）、`domain-composition`（Req 8/9/10 各领域最低要求）、`ordering`（Req 8.1 事件 producer 与 priority 边界）、`identity-and-lifecycle`（Req 3/6）、`durable-state-and-scope`（Req 6.1/6.4 的 operation 能力声明）、`visibility-and-redaction`（Req 5.3/12.4）、`concurrency-and-cancellation`（Req 2.4/2.5/6.2 stale 与 disposer 所有权）、`versioning-and-protocols`（Req 14.4 版本冻结与装配）、`capability-strategy`（Req 9.2/11.3/14.1/14.4 R 类与 `services.*` 边界）。
