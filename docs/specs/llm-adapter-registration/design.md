# Stage 2 - Design

> feature_name: `llm-adapter-registration`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12；与 requirements.md 同批产出，承接已确认 goal.md）
> 输入溯源：goal.md；requirements.md（同批）；canonical registry `llm.adapters.register` 现行登记（currentShape「adapter decoration registration with owner/generation handle」）与 `llm.registerAdapter`→`llm.adapters.register`（rename）、`llm.adapters.decorate`→`llm.adapters.register`（split）记录；M8 migration ledger 第 41–43 行；`packages/llm/lib/decoration-registry.js` / `decoration-shared.js` 现状；`lib/plugin-api-service.js` adapters 面现状（register → `facet.decorate`）；M10 工作纲领 §3.2。

## Status

Stage 2 与 Stage 1 同批交付（2026-09-12）。本文确定现行 `llm.adapters.register` 语义碰撞的拆分方案与 registry rename/split 记录的修正陈述、公共 path 候选与理由、与 packages/llm replacement owner 的关系、公共函数接普通对象的合同、client 模型选择复用目录语义的衔接、失败/guard 策略与 standards 逐分册结论。

## Overview

现行碰撞（已证实）：canonical registry 把旧 `llm.registerAdapter` 以 **rename** 迁至 `llm.adapters.register`、旧 `llm.adapters.decorate` 以 **split** 迁至同一入口；但现行实现（`lib/plugin-api-service.js` adapters 面 `register` → `facet.decorate`）只执行**装饰登记**。`packages/llm` 的 decoration registry 明确「never creates synthetic adapters」，metadata 只允许 `labels`、execution phase 只有 `stream`。结果：真实 adapter 登记没有公共面，`dsh-vision-toolkit` 图片变体（独立 provider id + registerAdapter → 选择器独立路由）与 TUI vision-ask adapter 无法等价迁移。

设计：**一处归属换位 + 一次迁移**——`llm.adapters.register` 交给真实 adapter 登记（绑定官方 `registerAdapter` 的真实登记动作，A 类稳定化），装饰迁至 `llm.adapters.decorations.*`（保留已交付 decoration registry 的全部机制与独立身份），模型目录增加统一只读 projection `llm.models.list`。不新建第二个 llm owner，不动 `llm.routing` / `requestTransforms` / `admissionPolicies` 既有职责。

## Current-State Findings

- registry 记录：`llm.registerAdapter`（migrationAction: rename → `llm.adapters.register`，currentShape「adapter registration」）——**rename 记录的意图是对的，但目标入口的实际实现接的是装饰**；`llm.adapters.decorate`（split → 同入口）——split 本身合理，目标入口错。
- 现行实现：adapters 面由 `packages/llm` fork 的 decoration facet 支撑；`llm.adapters.list` 列的是装饰快照；`llm/adapters-updated` 由官方发（decoration registry 不二次发）。
- decoration 机制现状（保留复用）：owner/id/generation 记录、priority 链序、`match`/`wrap`、recursion fence（共享 ALS）、binding lifecycle（active/superseded/revoked）、有界审计环、detach 冻结投影、caller fiber owner 派生与 identity-bound disposer。
- 目录登记现状：`llm.providers.register` 转发官方 configurable provider 登记；`llm.models.register` 转发官方 model discovery——均为目录/发现动作，**不绑定 stream backend**。
- 消费者锚点：`dsh-vision-toolkit/src/image-input-variants.ts:937–982`（独立 provider id + registerAdapter，使图片变体成为选择器独立路由）；`dsh-tianshu-tui/vision-ask/src/index.ts`（自有 vision adapter）。
- 官方 seam：官方 `registerAdapter` 已存在（观察报告确认），其登记动作即真实 adapter route 登记；门面此前从未绑定它。

## registry 拆分与 rename/split 记录修正（设计陈述，集成波执行）

| registry 行 | 现行记录 | 修正方案 |
|---|---|---|
| `llm.registerAdapter` → `llm.adapters.register` | rename；currentShape「adapter registration」 | **rename 记录保留并变为真实**：`llm.adapters.register` 的实现由 decoration 改为绑定官方 registerAdapter 的真实登记；currentShape 更新为 real adapter route registration（含普通对象 spec 合同）。旧 facade 调用点（装饰语义）全部迁至新装饰入口。 |
| `llm.adapters.decorate` → `llm.adapters.register` | split | **split 目标修正**为 `llm.adapters.decorations.register`；currentShape 更新为 decoration registration（语义不变，仅归属换位）。 |
| `llm.adapters.register.handle` | retain（decoration facet handle） | 拆分为两行：真实登记 handle（resourceRegistry idiom 固定形状 `{ id, ownerId, generation, dispose() }`）与 `llm.adapters.decorations.register.handle`（既有 caller-bound facet handle，实际形状 `{ dispose(), snapshot() }`——owner/generation 由 decoration registry 内部记账、不暴露在 handle 上；该形状偏差按 `api-idioms.md` §1 六项例外登记，机制不变，见下注）。 |
| `llm.adapters.list` | retain（装饰快照） | 语义拆分：`llm.adapters.list` → 真实 adapter 登记查询；装饰快照查询迁 `llm.adapters.decorations.list`。 |
| `llm.models.list`（新增行） | — | 统一只读模型目录 projection：官方目录 + discovery + 已登记 adapter routes 的冻结合并视图。 |
| 本地开发期无 alias | — | 不加长期 alias 掩盖错误抽象；全部调用点与测试随本 feature 迁移（本地开发阶段 API 重构窗口，AGENTS §3.0.1）。 |

装饰 handle 形状例外（六项登记，随集成波入 registry）——`llm.adapters.decorations.register.handle` 不符合 `api-idioms.md` §3.6 固定 handle 形状，按 §1 登记例外而非改形（改形会触碰已交付 decoration 机制，违反本线「机制与独立身份不变」边界）：`memberPath: llm.adapters.decorations.register.handle`；`baseContract: resourceRegistry`；`exception: caller-bound facet handle（{ dispose(), snapshot() }）`；`reason: 保留已交付 decoration registry 的机制与独立身份（goal 边界）；caller fiber owner 派生与 registry 内部 generation 记账已提供等价的 identity-bound disposal 与 stale 语义，handle 面不重复暴露`；`replacementShape: { dispose(), snapshot() }`（snapshot 为该登记项的只读投影，非 mutation 面）；`verification: 既有 decoration 套件全绿 + stale disposer / identity-bound disposal 断言`。

修正执行面：canonical registry 与 surface snapshot 由本 feature 的 Stage 4 / 集成波（含总契约线的 registry 修正义务）统一落盘；本节是修正方案的设计陈述与验收对照。

## 公共 path 候选与理由

- `llm.adapters.register`（真实登记）：沿用 rename 记录的目标名，使历史登记意图成真；「adapters」的语义重心回到真实可调用 adapter。
- `llm.adapters.decorations.register` / `decorations.list`：装饰是 adapter 域内的强关联子资源（脱离 adapter 无意义），第三层 namespace 符合 `public-api-shape.md` §3.6 的强领域关系例外；复数资源 + register 动词符合 idiom。备选 `llm.decoration.*`（独立域）被否：装饰不是一等领域，单拆顶层域制造无归属词汇。
- `llm.models.list`：目录投影归属 `llm.models`（与既有 `llm.models.register` discovery 同域）；备选 `llm.catalog` 被否——与 `llm.models.register` 形成两个模型词汇。`services.llm.listProviders/listModels` 官方直通保持原样（不混写门面登记项）。
- 四动作归属总览：configurable provider → `llm.providers.register`；model discovery → `llm.models.register`；adapter 登记 → `llm.adapters.register`；decoration → `llm.adapters.decorations.register`。四个 `register` 各有独立 spec 判别与错误互指（需求 7.5：错误入口 typed 拒绝并指路），不再共享一个含混状态机。

## 机制设计

### 真实 adapter 登记（绑定官方 registerAdapter）

- **引出机制（A 类直绑）**：`llm.adapters.register(spec)` 规范化 spec 后转发官方 adapter 登记动作；owner 从 caller fiber 派生（现行 adapters 面 `deriveLlmAdaptersOwner` 机制复用），门面补 owner 记录、generation、conflict 判定与 identity-bound disposer。
- **普通对象合同**：spec 为普通对象——route identity（provider id / route key）、models 数组（每项含 model 标识与真实 capability 字段：如 input modalities、context 等）、`stream` 可调用实现（签名对齐官方 adapter 调用合同；不要求任何 SDK 基类、不 import 官方私有模块）。规范化失败 → typed validation 结果并**互指正确入口**（需求 7.5）。
- **冲突与替换**：resourceRegistry 规则（同 owner 同 id 同内容幂等；同 owner 同 id 异内容 typed conflict；跨 owner owner-conflict）+ 显式 CAS 式替换：`register(spec, { replace: expectedGeneration })` 原子换入，期望 generation 不符返回 typed stale/conflict。跨 owner 替换一律拒绝（user-visible route 身份不做 owner 限定改名）。
- **拓扑与事件**：登记经官方动作进入官方拓扑，`llm/adapters-updated` 仍由官方 producer 发；门面不二次发同拓扑事实（与 decoration registry 同约束）。门面查询面读官方拓扑状态 + 门面 owner 记录的并集。

### 模型目录 projection（`llm.models.list`）

- **引出机制**：读时合成（官方 provider/model 目录 + discovery 结果 + 已登记 adapter routes 的声明 capability），深冻结快照、纯函数、无副作用；目录变化经读刷新（不缓存可变状态）。
- **真值边界**：只合并**真实声明** capability；label overlay 保持 label 元数据字段，绝不投影为官方真值字段（如 `inputModality`）；不修改官方模型对象。原始模型与变体并存：变体以独立 route 身份出现，原模型条目不动。
- **与服务直通的关系**：`services.llm.listProviders/listModels` 保持官方形状（官方目录视角）；`llm.models.list` 是门面统一视角。两者不互相改写（条目 5）。

### 与 packages/llm replacement owner 的关系

- **复用唯一 owner**：`@deepseek-ai/dsh-plugin-api-llm` 是 llm 组件唯一 replacement owner；本 feature 的装饰面继续由该包的 decoration registry 承载。真实登记绑定官方 registerAdapter（A 类），**默认不需要扩展 R slice**。
- **扩展点位只陈述**：若 Stage 4 契约 probe 证实官方 registerAdapter 合同缺少本线需求所必需的字段（例如 route 级真实 capability 声明、原子替换钩子、在途流句柄），才在 llm owner 包内评估最小 R 扩展（同组件同包扩展先例：agent-loop 交互切片），走 capability-strategy R1–R8 与 spec coding 流程；**本设计不预批任何 R 扩展，也不为 A 类能力先造 replacement**。
- **装饰绑定新 adapter**：decoration 的 `match` 按官方拓扑 binding 匹配，新登记的 adapter route 出现在官方拓扑后天然可被装饰（机制无需变更）；两侧 generation 独立（需求 5.4）。

### 在途处置表

| 事件 | 处置 |
|---|---|
| route 被撤销/替换，旧实现在途流 | 在途流按既有取消/提交规则自然完成；身份不被撤销动作污染（停止努力 ≠ 正确性） |
| prepared call 引用已撤销 route | 执行时 typed stale/unavailable，不静默改路由 |
| 取消在途流 | 经官方 signal 路径传播；门面不因 cancel 请求伪造 `aborted` 终态 |
| route 原子换入 | 换点后新选择走新实现；旧实现不再接新调用 |
| 装饰在途 | decoration 链按其 binding lifecycle（superseded/revoked）自行收口；adapter 登记侧不动装饰 owner 的 handle |

## 失败路径与 guard 策略

| 失败 | guard |
|---|---|
| llm 行未激活 / 版本错配 | typed `unavailable`；capability degraded 仅限本域（registration/decoration），routing/transforms/admission 不连带 |
| spec 畸形 / 错误入口 | typed validation + 指路（正确入口名）；不部分应用 |
| 同 owner 异内容 / 跨 owner 冲突 | typed `conflict` / owner-conflict；不静默覆盖 |
| CAS 期望 generation 不符 | typed stale/conflict，不换入 |
| 双跑防护（decoration 与登记） | 两侧独立 registry 状态 + owner 记录；无共享状态机；boot 自检沿用 replacement 包既有 R4 自检 |
| 官方 seam 行为漂移 | 官方拓扑为唯一事实源，门面只并读；漂移经版本锁定 + capability 自描述暴露（R5 精神在 facade 侧同样适用） |
| projection 合成异常 | 单条目合成失败按「该条目 unavailable」诚实标注（需求 4.3），不抛穿读方 |

## 并发与取消

- 登记/替换/撤销的并发以 owner 记录 + generation CAS 收敛；同 owner 串行语义（同 id 操作互斥于门面记录层）。
- 在途流遵循 `concurrency-and-cancellation.md` §1–§5：取消是信号、终态由官方流合同裁决、stale 结果不补写；本 feature 不新增重试语义（重试策略仍归官方 adapter 合同 / decoration retry 词汇）。

## client 半面（capability-strategy §10 六问）

1. 被替换的官方行（llm）是否声明 client manifest？——**否**（`plugin-api-llm` host-only）。
2. 是否注册 remote namespace？——**否**。
3. 是否提供 slot 或 settings bridge？——**否**。
4. 是否有 client↔host 版本协商？——**否**。
5. 是否有 browser-side state 或 reconnect 语义？——**否**。
6. 官方行是否拥有 client-facing event/service？——**否**（目录/登记均为 host 面）。

结论：**host-only**。client 模型选择的衔接：TUI/独立前端经其既有通道（官方 client 服务、interactive-session-access 线的选择状态面）做选择动作；本线只保证目录语义（route 身份、capability 投影、原模型与变体并存）成为唯一目录词汇，client 侧**不建第二套模型目录**（需求 9.2）。

## Standards 逐分册适用性结论

| 分册 | 结论 |
|---|---|
| capability-strategy | **适用**：A 类直绑官方 registerAdapter；复用唯一 llm replacement owner；R 扩展仅作条件陈述（§4.1）；host-only 六问已记录；无新 `services.*` 成员。 |
| api-shape | **适用**：登记 = resourceRegistry 面；目录 = 独立 projection 面（只读、无注册写权）；装饰保留独立面；三面不共享状态空间；错误抽象以换位修复而非加 alias。 |
| api-idioms | **适用**：resourceRegistry 形状（register/get、幂等/冲突规则）；真实登记 handle 为 §3.6 固定形状 `{ id, ownerId, generation, dispose() }`；装饰 handle 保留既有 `{ dispose(), snapshot() }` 形状并按 §1 六项例外登记（见「registry 拆分与 rename/split 记录修正」节注），不声称 handle 同构；`llm.models.list` 为 projection 形状；四动作语义分开、同名不同义消除。 |
| public-api-shape | **适用**：全部归属既有 `llm` 域；`decorations` 第三层为强领域关系例外；无治理名泄漏；registry 修正随集成波同步（单一事实源）。 |
| composition-and-authority | **适用**：additive/resourceRegistry composition + CAS 替换的 coordinated 最小机制；owner 派生与冲突规则；authority closure——真实登记与装饰两 authority 互斥可辨、互不越权处置。 |
| domain-composition | **适用**：`llm.adapters` 行（owner/id/generation 隔离、稳定链序、卸载与 reconcile 不影响其他 owner）对齐并扩展到真实登记侧。 |
| ordering | **不适用**（无多插件排序语义；decoration 链序为已交付机制，不在本线变更范围）。 |
| identity-and-lifecycle | **适用**：owner-specific generation；route 撤销/替换的 lifecycleState 语义（active/revoked/superseded）不与终态词汇混用。 |
| durable-state-and-scope | **不适用**（登记为进程内 registry 状态，无 durable 记录）。 |
| visibility-and-redaction | **部分适用**：capability 投影只暴露声明字段，不含 secret；label overlay 不冒充真值字段（真值边界即可见性边界）。 |
| concurrency-and-cancellation | **适用**：在途处置表、CAS、取消传播、stale 提交资格、disposer 所有权（§1–§5 逐条对齐）。 |
| versioning-and-protocols | **部分适用**：冻结基线内交付；无新 wire/durable 协议；registry/snapshot 修正随集成波；full 与选择性装配等价不变。 |

## 迁移证据义务（Stage 4）

- `dsh-vision-toolkit`：图片变体适配器迁公共登记路径——独立 route 登记成功、原模型并存、选择器可见、真实调用生效（全链路 mock stream 证据）。
- TUI vision-ask：自有 vision adapter 同路径迁移。
- 既有装饰调用点与测试：全部迁 `llm.adapters.decorations.*`；`llm.adapters.register` 的装饰语义调用点清零（无 alias 残留，依据 goal Scope direction 与本表「本地开发期无 alias」行，以 Req 7.5 四动作互指口径断言）。
- decorate + route replace + dispose 交叉、双 owner 冲突、在途流撤销的运行证据按 requirements 10 逐条落测。
