# Stage 1 Requirements: plugin-api-m11-contract-enforcement（batch-2 实效收口）

> feature_name: `plugin-api-m11-contract-enforcement`（批次：**batch-2「实效收口」**）
> milestone: M11
> status: Stage 1 Requirements（2026-09-21 交付）。本文与同目录 `goal.md`、`design.md` 同日由 SPEC1 一口气产出并提交；不创建 `tasks.md`、不写实现代码。
> 上游输入：同目录 `goal.md`（十条 Scope direction）；`../batch-1/` 的 Goal / Requirements / Design / Tasks / 交付台账（已交付契约与本批的基线）；`temp/m11-effectiveness-review-and-fix-guide.md`（**临时指引，仅存 `temp/`、永不提交**；其结论已固化进 `design.md` §2 逐项处置表与 §9 决策清单）；`docs/standards/*` 十二册；canonical registry（`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`）。
> 阅读约定：批次间条款关系 = **第一批次的 Req 1–14 与本文有效**；本文条款若与 batch-1 条款在同一成员上冲突，以本文为准（本文是本批的验收合同），并在 `design.md` §3 以分册修订与 registry 登记对齐，**不改写** batch-1 已获批的验收边界表述（历史制品以现状注追加映射）。
> 决策口径：本批中若干条款（`settings.register` 的 handle 化与冲突口径、`settings.scope` 两端对象形态与读 / 订阅同名、`events.observe` 两端统一为信封、`attention.hubSnapshot` 内部化、client `slots` 命名收敛、`capabilities.get` 未知 path 不再抛错）是 SPEC1 在 `design.md` §9「需人类复核的决策清单」中列明**决策与替代方案**的公共形状决定；人类可在 Stage 3 前据该清单复核或推翻，推翻时按 `AGENTS.md` §3.2 回改本文与 design 后再推进。
> 通道标注约定：每条 EARS 末尾以【…】标注性质——【形状】门面公共形状变更（对齐 / 改名 / 合并 / 退役）；【登记】registry、树图、台账同步义务；【分册】standards 修订义务；【验收】测试与证据义务；【治理】纯文档 / 流程 / 范围义务；【R】涉及既有替代包内部扩展面的修订（**本批不新增 R 点**）。
> 纠偏记录：2026-09-21 由 SPEC2 复审并就地修订——Req 3.2 / 3.3 的 settings 注册口径与披露示例、Req 4.2 的 host 措辞、Req 7.6 与 Req 10.1 的登记 / 证据义务、映射表（含新增 goal ↔ Req 表）与决策清单引用；不改验收边界与 §9 的默认决策。

## Status

本文是 M11 第二批次（实效收口）的验收合同：它拥有「观察面 / 登记面 / 预检面 / availability 聚合 / client 降级」的**外层合同收口权**，以及针对 batch-1 已交付成员的**形状修订权（含减法）**；不拥有各领域运行时状态的所属权（领域语义仍归各领域 owner）。全部条款在冻结版本基线（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`）内交付，不提出任何版本字段变更，不新增公共能力，不新增 R 点。

## Req 1 输入固化与逐项去向

- **User story**：作为维护者，我要看到实效审查列出的每一项在实现前就有明确去向与证据锚点，且不依赖 `temp/` 文件。
- **Req 1.1** WHEN 本批进入设计 THEN 指引 §5 的 F1–F7 全部子项、指引 §3.2 对账出的 5 个未登记运行时成员、以及指引 §6 的低优先观察项 SHALL 逐项进入处置表，字段含：编号、实际公共 path、证据锚点（符号 / `file:line`）、当前实际形状（实测或源码）、目标形状、处置结论（**修复 / 保留例外 / 需人类复核 / 误报**）、依据与理由。【治理】
- **Req 1.2** WHEN 处置结论为「保留例外」THEN 该行 SHALL 给出例外类别与判定规则（或 registry 六项例外内容），SHALL NOT 以「领域不同」为唯一理由；WHEN 结论为「需人类复核」THEN 该行 SHALL 同时给出本批采用的默认决策与其替代方案，以及复核失败时的回退动作。【治理】
- **Req 1.3** WHEN 指引的实测结论与本批的只读复核不一致 THEN 处置表 SHALL 以复核后的源码事实为准并标注差异；SHALL NOT 直接照抄指引结论。【治理 + 验收】
- **Req 1.4** GIVEN 指引仅存在于 `temp/` THEN 其范围与结论 SHALL 在实现开始前固化进已提交制品；实现、测试与验收 SHALL NOT 依赖 `temp/` 的可获得性。【治理】
- **Req 1.5** WHEN 本批开工 THEN 代理 SHALL 核对指引基线 `cbbc29b` 之后是否存在新提交或已实施的修复，并对已修复项标注复用；SHALL NOT 重复实施。【治理】

## Req 2 观察面单一外层合同（F1）

- **User story**：作为插件作者，我要把「建立观察 → 读当前值 → 订阅 → 释放」写成一段代码，在任意观察成员、任意一端上都不必改写。
- **Req 2.1** WHEN 任一公共观察入口成功返回 THEN 结果 SHALL 是（或最终解析为）所属 idiom 规定的冻结观察 handle `{ current(), subscribe(listener), dispose(), epoch }` 加已登记领域扩展；SHALL NOT 出现 `{ ok, disposer }` 信封、裸 disposer 或无 `current()` 的观察合同。【形状 + 验收】
- **Req 2.2** WHEN 观察 handle 的 `dispose()` 被调用 THEN 它 SHALL 幂等并返回冻结判别式结果（资源类成功码 `revoked`、no-op 码 `stale`，可附 `reason`）；SHALL NOT 返回 `undefined`、布尔或 Promise。【形状 + 验收】
- **Req 2.3** WHEN handle 已释放 THEN `subscribe(listener)` SHALL 为 no-op（返回 no-op 退订函数）而非抛错；`current()` SHALL 返回降级视图而非抛错；非函数 listener SHALL NOT 使 `subscribe` 抛穿调用方。【形状 + 验收】
- **Req 2.4** WHEN 观察入口被调用 THEN 其入参 SHALL 为**单一 subject 参数**，规范形态为 options 对象（字段名与该命名空间同类动词一致）；成员 MAY 额外接受裸主题便捷形态（字符串 id/name、领域对象或 handle），但两种形态 SHALL 语义一致并在登记中写明；无主题的投影 SHALL 接受零参；**任何观察入口 SHALL NOT 接受订阅回调作为参数**（listener 一律经 `handle.subscribe`）。【形状 + 登记】
- **Req 2.5** WHEN 同一命名空间内存在多个同义动词 THEN 它们的同义入参形态 SHALL 一致（例：`coordination.observe({ resource })` 与 `coordination.acquire({ resource })`）。【形状】
- **Req 2.6** WHEN 某观察入口或某 `current()` 的调用形态为异步 THEN registry SHALL 显式声明该形态，且合同 SHALL 写明调用方以 `const h = await ns.observe(s); const v = await h.current()` 的 `await` 写法统一使用；SHALL NOT 为形状统一把异步读面伪造成同步。【形状 + 登记 + 验收】
- **Req 2.7** WHEN 某观察入口的域处于降级状态（已释放 / 无法回答）THEN 它 SHALL 返回同形降级 handle（合同齐备、`current()` 降级、`subscribe` no-op、`dispose()` 判别式）；命名空间未挂载时 SHALL 按既有惯例抛 typed error，SHALL NOT 抛裸 `TypeError`。【形状 + 验收】
- **Req 2.8** WHEN 观察入口收到非法输入（例：缺 `sessionId`、非法 scope）THEN 它 SHALL 以 typed 结果或带 `code` 的 typed error 表达，SHALL NOT 抛裸 `TypeError`。【形状 + 验收】
- **Req 2.9** WHEN 观察 handle 被返回给调用方 THEN 它 SHALL 只含 `current` / `subscribe` / `dispose` / `epoch` 四枚公共成员加已登记扩展（冻结或等价不可变）；内部 listener 集合、`disposed` / `stale` / `signal` / `abortHandler` 等可变实现字段 SHALL NOT 外泄。【形状 + 验收】
- **Req 2.10** WHEN 本批完成 THEN `sessions.durable.observe`、host `attention.observe`、`prompts.provenance.observe`、`sessions.channels.observe`、`diagnostics.observe`、`mcp.observe`、`coordination.observe`、`workspaces.transactions.observe`、`tasks.observe`、`sessions.activity.observe`、`executions.observe`、`events.observe`、`llm.routing.observe`、`sessions.planMode.observe`、`sessions.permissionPresets.observe`（含各自 disabled / 降级形态）SHALL 逐条满足 Req 2.1–2.9；不满足者 SHALL 有已登记的六项例外。【形状 + 验收】

## Req 3 登记面单一外层合同与冲突口径（F2）

- **User story**：作为插件作者，我学会一种「登记」后，在任何门面自有注册成员上拿到的都是同一形状的 handle，并用同一句 `dispose()` 释放。
- **Req 3.1** WHEN 门面自有（非 `services.*`）成员以 `register` 命名 THEN 成功返回 SHALL 是所属 idiom 的标准 handle（`policy` / `resourceRegistry` 一律含 `id`、`ownerId`、`generation`、`dispose()`，扩展成员按公共 path 登记）；SHALL NOT 以领域对象、`undefined`、裸 disposer 或查询值收场。【形状 + 验收】
- **Req 3.2** WHEN 某成员以 `register` 命名而其动作实为**查询**（只读取既有状态）THEN 它 SHALL NOT 占用 `register` 名；查询 SHALL 使用 `api-idioms` §3.1 的查询动词；旧名 SHALL 退役并落 `removed` 行 + `oldToTargetMapping` + `statusByPath`。门面自有的真注册（`settings.register` 向官方登记 namespace schema）SHALL 保留其名与语义；其取回面 `settings.scope` 本就不占 `register` 名。【形状 + 登记】
- **Req 3.3** WHEN 门面自有注册的释放能力受官方权威限制 THEN handle SHALL 仍然铸造（`generation` 由门面按 owner 铸造）并在 `dispose()` 的 `reason`、registry 的 `lifecycle` 与 `currentShape` 中**如实披露释放边界**（例如「官方注册为 ctx effect，随门面与 settings 服务挂载期存续；调用方插件卸载不移除它，也没有按 handle 的显式释放路径」）；SHALL NOT 以虚假的 `revoked` 掩盖未释放的官方副作用，也 SHALL NOT 以「无 handle」回避合同。【形状 + 登记】
- **Req 3.4** WHEN 任一注册成员在同一 key 上再次登记或与其他 owner 冲突 THEN 行为 SHALL 等于该行声明的封闭词表值之一（`latest-wins` / `content-conflict` / `owner-conflict` / `owner-scoped` / `fencing` / `not-applicable`）；跨 owner 同 key SHALL NOT 静默覆盖；同 owner 的 `latest-wins` SHALL 使旧 handle 返回 typed `stale` 且不能撤销新资源。【形状 + 登记 + 验收】
- **Req 3.5** WHEN 冲突结果由官方权威裁决 THEN 该行 SHALL 在 `currentShape` 写明「由官方裁决」，且声明的词表值 SHALL 与官方行为一致；验证 SHALL 使用与官方行为一致的 owner 桩，SHALL NOT 以宽松桩充当证据。【验收 + 登记】
- **Req 3.6** WHEN 「官方动词原样透传」类成员（门面不铸身份、原样返回官方结果）被保留 THEN `api-idioms` SHALL 给出该类成员的判定规则（何时可透传、如何登记、与门面自有 handle 如何分界），且该类成员 SHALL 逐条登记为六项例外。【分册 + 登记】
- **Req 3.7** WHEN 同一 authority 已有两个入口（例：登记与取回）THEN 二者 SHALL 指向同一对象 / 同一 authority 并在登记中互指；SHALL NOT 出现第二个可独立写状态的 authority。【登记】

## Req 4 host/client 同 path 同形（F3）

- **User story**：作为双端插件作者，我在 host 与 client 上对同一公共 path 写同一段调用代码，并且能从返回对象判断自己在用哪一端的差异（差异已登记）。
- **Req 4.1** WHEN host 与 client 存在同一公共 path 的语义成员 THEN 两端 SHALL 使用同一外层形状（成功 / 失败呈现、handle 或信封的层次）与同一成员名集合中**共同语义部分**；确实存在的环境差异 SHALL 显式登记（含理由与差异成员清单），SHALL NOT 让读者靠记忆分辨。【形状 + 分册 + 登记】
- **Req 4.2** WHEN `events.observe(name)` 在任一端被调用 THEN 返回 SHALL 是承载标准观察 handle 的冻结判别式信封；非 catalog 名（host）/ 未知名（client）SHALL 返回 typed 结果（client：`ok:false` + `code:'unsupported'` + 可查询目录；host：`ok:true` + `code:'untyped'` + `reason`，如实表达既有的非 catalog 无类型透传通道）；`events.define` 的 publisher 语义不变。【形状 + 登记 + 验收】
- **Req 4.3** WHEN `settings.scope` 在两端被调用 THEN 二者 SHALL 接受同一可复用的对象形态（`{ namespace, ... }`）并返回该命名空间的 scope 视图；视图中**读与订阅成员 SHALL 同名同义**（`get` / `watch`）；写面与释放面的差异（host 的 `update` / `replace` / `mutate` 与 scope 的 `dispose()` 边界、client 的官方 `set` / `unset`）SHALL 登记为环境差异并保留。【形状 + 登记】
- **Req 4.4** WHEN 本批完成 THEN `api-idioms` 或 `public-api-shape` SHALL 含一条可判定的「同 path 同形到什么程度」规则（至少定：成功形状、失败呈现、公共成员名、handle 层次）。【分册】

## Req 5 capability 预检可迁移（F4）

- **User story**：作为插件作者，我先探活再调用；同一段探活代码在 host 与 client 上都成立，且问到的是真实状态。
- **Req 5.1** WHEN `capabilities.get(path)` 被调用且 `path` 是**该端活面上可解析的公共成员 path** THEN 它 SHALL 解析到该成员所属的**最近能力簇**并以该簇的实时探针状态作答；SHALL NOT 以「对象存在」或「函数存在」作答。【形状 + 验收】
- **Req 5.2** WHEN `path` 无法解析（不在活面上、也不是能力路径）THEN `get` SHALL 返回冻结的 `{ capability, status: 'unavailable', reason: 'unknown capability' }`，SHALL NOT 抛错；`require` SHALL 保持 capability-unavailable typed throw（未知与不可用一律计入 missing）。【形状 + 验收】
- **Req 5.3** WHEN 某端接受成员级 path THEN 它 SHALL 只接受真实存在于该端活面的成员；不存在的成员 SHALL NOT 继承根状态。【验收】
- **Req 5.4** WHEN 两端实现解析 THEN 规则 SHALL 同源（同一分册条款描述），两端差异只允许存在于「各端能力路径清单」这一登记事实。【分册 + 登记】
- **Req 5.5** WHEN `capabilities.list({ prefix })` 被调用 THEN 两端 SHALL 同形（冻结路径列表 + 前缀过滤）；本批不要求两端列出同一粒度（粒度差异继续登记）。【形状】

## Req 6 登记完整性与可见性（F5）

- **User story**：作为维护者，登记面必须能看到每一个第三方可达的公共成员；任何绕过调用者范围的读面不得出现在公共面。
- **Req 6.1** WHEN 运行时存在公共成员 THEN 它 SHALL 在 canonical registry 有对应成员行（`services.*` 白名单成员与内部 `_` 前缀成员除外）；`events.decisions.availability`、`tools.executionPolicies.availability`、`agents.decisions.availability`、`prompts.assemblyPolicies.availability` SHALL 补齐 leaf / handle 行，其所属子命名空间 SHALL 补 namespace 记录。【登记】
- **Req 6.2** WHEN 某公开读面的作用域是**整 hub / 全量集合**且不接受调用者 THEN 它 SHALL NOT 出现在公共面；跨组件内部缝 SHALL 经内部通道（`Symbol.for` 键或非枚举成员）传递，且 SHALL NOT 登记为公共成员。【形状 + 分册 + 登记】
- **Req 6.3** WHEN `attention.hubSnapshot` 按 Req 6.2 内部化 THEN 消费方（`packages/api-remotes` 替代包）SHALL 改经内部缝取得 snapshot，且 kind 裁剪与脱敏语义保持不变；旧公共 path SHALL 落 `removed` 行 + `oldToTargetMapping`（内部化目标或 gap 说明）。【形状 + 登记 + R】
- **Req 6.4** WHEN 本批完成 THEN `visibility-and-redaction` SHALL 含一条「公共读面必须按调用者范围过滤；绕过调用者范围的聚合内部缝不得占用公共成员名」的条款。【分册】

## Req 7 availability 聚合与诚实（F6）

- **User story**：作为插件作者，我要能对任意 namespace 写 `if (status === 'active')` 而不被误导，并从 detail 看出降级在哪一部分。
- **Req 7.1** WHEN 任一 namespace 暴露 `availability()` THEN `status` SHALL 等于该 namespace **声明的当前可用性口径**的最小值：全部在册部分可用 ⇒ `active`；任一在册部分不可用 ⇒ `degraded`；命名空间整体不可用，或请求的目标 / scope 超出其后端能力 ⇒ `unavailable`。【形状 + 分册 + 验收】
- **Req 7.2** WHEN availability 结果同时含 `operations` / `durability` / `backend` 等字段 THEN 这些字段 SHALL 表达**后端能力声明**（能做什么）而非当前可用性；当前可用性 SHALL 由 `status`（可附 `reason`）承担；该分工 SHALL 写入分册，且各 namespace 的口径声明 SHALL 与 registry 的 `availabilityShape` 一致。【分册 + 登记】
- **Req 7.3** WHEN 领域给出的状态 token 不属于三值 THEN 它 SHALL 按固定映射归一（`unsupported → unavailable`；`unknown` / `inert → degraded`；**`available → active`**，附 `reason`）；不在映射表内的 token SHALL NOT 静默回落为描述符状态，SHALL 以 `degraded` + `reason` 如实呈现。【形状 + 验收】
- **Req 7.4** WHEN 某 namespace 存在多个在册部分（`sources` / `faces` / `operations` 等）THEN 降级部分 SHALL 在 detail 中指明，且 `status` 与 §7.1 的聚合一致；局部降级 SHALL 附 `reason` 或等价的 detail 字段。【形状 + 验收】
- **Req 7.5** WHEN namespace 未挂载（禁用形态）THEN `availability()` SHALL 返回 `unavailable` + `reason`，并保留与非禁用形态**同一 detail 字段集**（含 `epoch`）。【形状 + 验收】
- **Req 7.6** WHEN 本批完成 THEN `tasks`（存在 unavailable 来源）、`coordination`（跨 scope 请求）、`security`（部分 face `inert`）、`workspaces.transactions`（域 token `available` 与 detail 保留）四处的 `status` 与 detail SHALL 与 Req 7.1–7.5 逐条一致，并各有可复跑证据；`storage` 的禁用形态字段集 SHALL 满足 Req 7.5（含 `epoch`）。【验收】

## Req 8 client 降级路径与命名（F7）

- **User story**：作为面板插件作者，我在 client 上用的降级路径与安装态是同一段代码；命名不误导我调用错的成员。
- **Req 8.1** WHEN client attention runtime 未安装 THEN `attention.observe()` SHALL 返回与安装态**同形**的冻结 handle（`dispose()` 判别式、`subscribe` no-op、`current()` 降级视图）；降级路径的 `contribute` / `dismiss` / `invoke` SHALL 保持判别式结果（`ok:false` + `unavailable`）。【形状 + 验收】
- **Req 8.2** WHEN client `slots` 提供槽位读面 THEN 它 SHALL 只保留**一个**读成员并使用标准查询动词（`inspect(key)`），返回声明事实与条目（含 `declared` / `missing` / `unavailable` 三态、`spec` / `snapshot` / `declarationEpoch` / `entries`）；`slots.list` 与 `slots.declaration` 旧名 SHALL 退役并落 `removed` 行 + `oldToTargetMapping`（不得生成自环）。【形状 + 登记】
- **Req 8.3** WHEN client `remotes.observe` / `remotes.dispatch` 与 host `events.*` 并存 THEN 分册 SHALL 写明命名分工（client `remotes.*` = 远端事件通道的观察与载体派发；host `events.*` = 官方事件总线的投影与受生产权约束的派发），使读者不必靠登记推断。【分册】
- **Req 8.4** WHEN client 提供观察入口 THEN Req 2 的全部条款逐条适用（含 `attention.observe`、`events.observe`、`slots.observe`、`remotes.observe`、`lifecycle` 观察面）；与 host 同 path 者另按 Req 4 收敛。【形状 + 验收】

## Req 9 分册修订与治理同步

- **User story**：作为维护者，每条规则只有一个来源；改名与退役在登记面完整可追溯。
- **Req 9.1** WHEN 本批识别出分册缺口（观察入参合同与 `current()` 形态、事件面信封收口、登记面单一合同与官方透传判定规则、冲突词表、绑定型投影成员的登记义务、availability 聚合与字段语义、同 path 同形规则、capability 解析规则、可见性内部缝、client 命名分工）THEN 本批 SHALL 产出修订清单（分册 / 条款 / 现状问题 / 修订方向 / 同步面 / 是否需人类确认）并落盘；修订 SHALL 使每个成员只有一条规则来源。【分册】
- **Req 9.2** WHEN 修订涉及能力上限（`capability-strategy.md`）或新增公共能力 THEN SHALL 先经人类确认；其余修订按 `AGENTS.md` §6 的规范目录义务落盘。【治理 + 分册】
- **Req 9.3** WHEN 本批新增或重分类 idiom 例外 THEN 例外净额 SHALL 只减不增或持平（基线为 batch-1 收口实测：成员行 17 / 例外记录 19 / 公共 path 16），并同时给出三口径；每条新增例外 SHALL 附完整六项与 `verification`；SHALL NOT 用「改分册」为不必要的认知负担开脱。【分册 + 登记】
- **Req 9.4** WHEN 任一成员形状在本批发生变化 THEN registry SHALL 同步（`idiom` / `failureSemantics` / `identitySource` / `conflictRule` / `lifecycle` / handle 行 / `currentShape` / `callShape` / `availabilityShape`），并保持 registry 为唯一事实源；`currentShape` 已与实现相反的旧行 SHALL 一并订正。【登记 + 验收】
- **Req 9.5** WHEN 出现改名 / 合并 / 退役 / 内部化 THEN `removed` 行 + `oldToTargetMapping` + `statusByPath` SHALL 同步，且映射 SHALL NOT 自环；`docs/standards/public-api-shape.md` 的 host/client 树图与 `docs/specs/plugin-api-features/feature-list.md` §7 的 spec 目录与交付状态 SHALL 同步；历史制品以文首现状注追加映射，不改写已获批验收边界。【登记 + 治理】
- **Req 9.6** WHEN 本批完成 THEN M10 三表（成员表 / 行为表 / 装配表）SHALL 按受影响面复核：成员表由 `scripts/convergence-table-sync.mjs` 机械重建，行为表保持冻结行数与内容口径，装配表 token 可解析且 `convergence-verify` 全绿。【验收 + 登记】

## Req 10 机械校验与对账

- **User story**：作为维护者，我要用机械校验拦住「契约写了一套、实现跑了另一套」，而不是靠人读代码。
- **Req 10.1** WHEN 契约收口宣称完成 THEN `scripts/registry-validate.mjs` SHALL 扩展到覆盖本批新规则，至少：观察类行（公共 path 以 `.observe` 结尾的叶行）必须为 `projection`，且其 handle 行（在册行或本批补齐的 `prompts.provenance.observe` / `workspaces.transactions.observe`）必须登记四成员；注册类行必须为标准 handle 或登记完备的官方透传例外；每个 namespace / 子命名空间的 `availability` 成员在册；`conflictRule` 取值在封闭词表内且与官方行为一致（官方裁决行不得声明 `latest-wins`）；`*.observe` 的 subject 形态已记入 `currentShape`、`current()` 形态由 `callShape` 声明。【验收】
- **Req 10.2** WHEN 运行时成员与 registry 对账 THEN SHALL 有可复跑测试在挂载的门面（host 与 client）上枚举公共叶（跳过 `_` 前缀与 `services.*`）并断言每个成员有 registry 行；发现缺口即失败（本批前后的缺口清单 SHALL 记录在交付报告）。【验收】
- **Req 10.3** WHEN 冲突行为宣称一致 THEN SHALL 以两个 synthetic owner 的矩阵测试覆盖词表各值（含 stale disposer 不能撤销新资源、跨 owner 拒绝、同 owner latest-wins）。【验收】
- **Req 10.4** WHEN 观察合同宣称一致 THEN SHALL 有矩阵测试逐成员断言：handle 成员集、`dispose()` 结果形状、释放后 `subscribe`/`current()` 行为、非法输入的 typed 呈现（host 与 client 各一份矩阵）。【验收】

## Req 11 验收与证据

- **User story**：作为维护者，我要用可执行证据而不是台账自洽判断本批是否完成。
- **Req 11.1** WHEN 本批交付 THEN F1–F7 与 5 个未登记成员 SHALL 各有一条**可复跑**的探针或测试（含失败面），证据 SHALL 来自真实公共入口执行；SHALL NOT 以台账自洽、import 扫描、路径计数或测试总数充当证据。【验收】
- **Req 11.2** WHEN 本批交付 THEN `npm test`（4G 内存护栏内）SHALL 全绿；`node scripts/registry-validate.mjs`、`node scripts/convergence-verify.mjs`、`capability-matrix-sync --check`、`npm run build:client:check` SHALL 通过；`git diff --check` SHALL 干净。【验收】
- **Req 11.3** WHEN client 侧源被修改 THEN `lib/client.js` SHALL 经仓库重建入口重建，SHALL NOT 手编 bundle；产物 diff SHALL 只含预期变更。【验收】
- **Req 11.4** WHEN 某必需行为无法达成 THEN SHALL 登记阻塞项（原因 + 最小解除动作 + 是否需人类授权 + 日期）并保持未完成；SHALL NOT 以降级呈现充当完成。【治理】

## Req 12 边界与不回归

- **User story**：作为维护者，我要确保这次收口不夹带功能、不改变真实差异、不动版本与官方边界。
- **Req 12.1** WHEN 本批实施任何修改 THEN SHALL NOT 新增公共能力或新增 R 点；改名 / 合并 / 退役 SHALL 保持能力守恒并按 Req 9.5 登记。【治理 + 验收】
- **Req 12.2** WHEN 版本冻结、官方包禁改、fail-safe（apply 不抛穿）、横切派发语义被触及 THEN 约束 SHALL 保持；替代包（`packages/*`）的内部扩展面修订 SHALL 维持被替代官方行的契约复刻与 boot 自检。【R + 验收】
- **Req 12.3** WHEN 既有合理例外与真实差异被复核 THEN SHALL 保留并登记，SHALL NOT 机械抹平：`services.*` 存在性口径、coordination `release(handle)`、workflow run authority、checkpoint 恢复阶段、领域 detail 字段、official seam 原样透传、`agents.register` 官方动词透传、同步/异步差异本身。【治理 + 验收】
- **Req 12.4** WHEN 实现或测试产物被提交 THEN 治理分类字母、需求 / feature 编号等治理 token SHALL NOT 出现在 `lib/`、`packages/`、`test/` 与 `package.json` 中。【治理 + 验收】
- **Req 12.5** WHEN 本批交付完成 THEN SHALL NOT 遗留 `temp/` 依赖、临时脚本或未提交成果；正式制品与实现 SHALL 按阶段提交义务落盘。【治理】

## Requirements ↔ goal Scope direction 对应表

| goal Scope direction | 承载需求 |
|---|---|
| 1 观察面单一合同（F1） | Req 2（全部）、Req 4.2、Req 8.4 |
| 2 登记面单一合同与冲突口径（F2） | Req 3（全部）、Req 9.3 |
| 3 host/client 同 path 规则（F3） | Req 4（全部） |
| 4 capability 预检可迁移（F4） | Req 5（全部） |
| 5 登记完整性与可见性（F5） | Req 6（全部）、Req 1.1、Req 10.2 |
| 6 availability 可跨 namespace 比较（F6） | Req 7（全部） |
| 7 client 降级路径与命名（F7） | Req 8（全部） |
| 8 可复跑证据优先 | Req 10（全部）、Req 11（全部） |
| 9 分册与治理同步 | Req 9（全部） |
| 10 边界不动 | Req 12（全部） |

## Requirements ↔ 指引条目对应表

| 指引条目 | 承载需求 |
|---|---|
| F1 观察面（1 动词 4 返回、6 输入、3 个成员违反 handle 合同） | Req 2（全部）、Req 4.2、Req 9.1（观察入参合同与 `current()` 形态的分册修订）、Req 10.4 |
| F2 登记面（5 种成功结果、两个无 dispose、冲突口径多于词表） | Req 3（全部）、Req 9.3、Req 10.1、Req 10.3 |
| F3 host/client 同 path（`events.observe`、`settings.scope`） | Req 4（全部） |
| F4 capability 预检（host 49 条精选路径、client 成员级 path） | Req 5（全部） |
| F5 5 个未登记成员 + `attention.hubSnapshot` 越权 | Req 6（全部）、Req 1.1、Req 10.2 |
| F6 `availability().status` 跨 namespace 不可比 | Req 7（全部） |
| F7 client 降级 handle 与命名（`slots.list`、`remotes.*`） | Req 8（全部）、Req 4.1 |
| 指引 §6 低优先观察项 | 逐项在 `design.md` §2.8 落「纳入 / 不纳入（附理由）」；纳入项由 Req 2.5 / Req 3.6 承载 |
| 指引 §7 工作流纪律与硬停机点 | Req 1、Req 9、Req 11、Req 12 |
| 指引 §8 建议处置顺序 | `design.md` §2 的处置顺序与 §9 决策清单 |

## Standards 对照（requirements 层）

逐分册适用性与对齐结论详见 `design.md` §10。本文按验收判据引用：`api-idioms`（Req 2/3/4/5/6/7 的 idiom 与合同，§3.1 观察、§3.6 注册、§3.7 availability、§4 事件、§5 登记字段）、`api-shape`（Req 3.2/3.3 的投影纯度与三面边界：绑定型 / 有副作用成员不得伪装为纯投影）、`public-api-shape`（Req 4/5/9.5 的 namespace、树图与 capability 粒度）、`composition-and-authority`（Req 3.4/3.5/10.3 的 owner / key / 冲突 / authority closure）、`domain-composition`（Req 6/7 各领域最低要求，尤其 `events` 与 `settings` / `tasks` / `coordination` / `security` 行）、`identity-and-lifecycle`（Req 2.2/3.1 的 handle 生命周期与 `dispose()` 契约）、`concurrency-and-cancellation`（Req 2.2/2.9/3.4 的 stale 与 disposer 所有权）、`visibility-and-redaction`（Req 6.2/6.4 的调用者范围与内部缝）、`durable-state-and-scope`（Req 7.2 的能力声明与 detail）、`ordering`（Req 2.9 的 listener containment 边界，本批不新增排序设施）、`versioning-and-protocols`（Req 12.2 的版本冻结与装配）、`capability-strategy`（Req 6.3 的 R 包修订与 Req 12.1 的 R 点边界）。
