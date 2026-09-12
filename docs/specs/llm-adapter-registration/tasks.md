# Stage 3 - Tasks

> feature_name: `llm-adapter-registration`
> milestone: M10
> status: Stage 3 审查门已通过（2026-09-12 阻塞式对抗性审查「有意见/非阻塞」，七条文字与覆盖补强意见已全部就地闭合：悬空引用改直引 goal/design、Task 6 门序改为终审先行于提交、补 Req 4.2 事件唯一性与 Req 8.1 隔离断言落点、Req 9 锚点载入登记义务、snapshot mapping 行加注、registry 键定为单一 llm.adapters 最小改动；按 §3.2 小修改不再复审）。Stage 4 执行中。
> 输入溯源：goal.md；requirements.md（Reqs 1–10）；design.md（registry 拆分、A 类直绑、delegation wrapper、在途处置表）；执行前 probe 记录见文末「执行时探针记录」。

## 执行时探针记录（Stage 3 探针，实现以此为事实源）

- **P1 官方 `registerAdapter` 合同**（`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js:956`）：`registerAdapter(providers: string[], adapter)`；adapter 为普通对象 `{ providerInfo(provider)→{id,name}, providerRetryPolicy?(provider), listModels(provider)→Promise<{provider,id,name,description?,inputModalities?}[]>, resolveModel(provider,model,signal)→Promise, stream(options)→async iterable }`；空 providers / 空名 / providerInfo 畸形 → `LlmError`（INVALID_ADAPTER / DUPLICATE_ADAPTER，全有或全无）；handle = `()=>dispose()`，`handle.replace(next)` 仅对**同一 adapter 实例**原子换 route set；dispose 撤 route 并发 `llm/adapters-updated`（官方 producer）。
- **P2 官方原子实现替换缺口**：`handle.replace` 不能换实现对象（只换 route set）→ 门面级 CAS 替换采用 **delegation wrapper**：每个 route-id 只向官方登记一个固定 adapter 对象，其 `stream/listModels/resolveModel/providerInfo/providerRetryPolicy` 全部委托到门面记录的当前实现条目；门面替换 = 原子换实现条目（官方拓扑与 adapter identity 不变，符合 design「门面不二次发同拓扑事实」）。
- **P3 门面现状**：`createConditionalLlmAdaptersSurface`（lib/plugin-api-service.js:752）register→`facet.decorate`、list→装饰快照、handle `{dispose(), snapshot()}`、typed 错误族 LlmAdapters{Validation,Conflict,OwnerConflict,Unavailable}Error；owner 派生 `deriveLlmAdaptersOwner`（caller fiber）；挂载门 `llmAdaptersContractOk` + `resolveMarkedLlmDecoration`（lib/index.js:2054/2118）；`llm` 面 `stream/prepareCall/modelInfo` 官方直通（lib/llm-api.js），nested `providers.register`/`models.register`（lib/index.js:841）。
- **P4 调用点清单（装饰语义 `llm.adapters.register/list`，全部需迁移，无 alias）**：lib/plugin-api-service.js（adapters 面构建）、test/plugin-api-service-llm.test.mjs、test/registration-contribution-surface.test.mjs、test/index-llm.test.mjs、test/subtraction-conservation.test.mjs、test/host-cutover.test.mjs、test/read-surface-projection.test.mjs。
- **P5 registry 现行行**（canonical registry）：`llm.adapters.register`（currentShape「adapter decoration registration with owner/generation handle」→ 需改真实登记）、`llm.adapters.decorate→llm.adapters.register`（split 目标需改 `llm.adapters.decorations.register`）、`llm.registerAdapter→llm.adapters.register`（rename 关系文案需成真）、`llm.adapters.register.handle`（retain，需拆两行）、`llm.adapters.list`（retain，语义需拆分）、无 `llm.models.list` 行（新增）。
- **P6 外部消费者仓库不在本工作区**（`~/global_workspace/agent/` 下无 dsh-vision-toolkit / dsh-tianshu-tui）→ design「迁移证据义务」按既有 migration-slice 模式落为仓库内证据测试（建模消费者调用点形状 + 全链路 mock 证据），不改动外部仓库。

## Task 1: 真实 adapter 登记 facade 模块（对应 Req 1、3、7.5、8）

**产出**：`lib/llm-adapter-registration.js`（纯函数模块，零 harness 依赖可测）+ 单元测试 `test/llm-adapter-registration.test.mjs`。

- [x] 1.1 Spec 规范化与四动作判别（Req 1.1–1.2、7.5）：`normalizeAdapterSpec(spec)` 校验普通对象合同——`provider`（非空 string route id）、`models`（非空数组，元素含 model 标识与真实 capability 声明字段）、`stream`（可调用实现）；含 `settingsNs`/`displayName` 目录字段或缺 `stream` 而含 decoration 词汇（`labels`）→ typed validation **互指正确入口**（`llm.providers.register` / `llm.models.register` / `llm.adapters.decorations.register`）；不要求 SDK 基类、不 import 官方私有模块。
- [x] 1.2 官方绑定与 delegation wrapper（Req 1.1、1.3）：首次登记 route 时以官方 `registerAdapter([provider], wrapperAdapter)` 登记 wrapper（P2 形状）；wrapper 全方法委托当前实现条目；登记成功返回 handle `{ id, ownerId, generation, dispose() }`（api-idioms §3.6 固定形状）；wrapper 自身不向调用方暴露。
- [x] 1.3 owner 记录 + 冲突/CAS（Req 3.1–3.4）：owner 自 `deriveLlmAdaptersOwner(callerCtx)` 派生；同 owner 同 id 同内容幂等返回既有 handle；同 owner 异内容（无 replace）→ typed conflict 不部分应用；同 owner `register(spec, { replace: expectedGeneration })` 匹配→原子换实现条目（delegation 层换入，官方拓扑不动），不匹配→typed stale/conflict 不换入；跨 owner → typed owner-conflict，不改名不静默覆盖。
- [x] 1.4 identity-bound 撤销（Req 3.5）：`callerCtx.effect` 绑定 disposer；dispose 幂等、stale disposer typed no-op 不伤他 owner / 新 generation；dispose 调官方 handle 撤 route（官方发 `llm/adapters-updated`，门面不二次发）。
- [x] 1.5 `llm.adapters.list` 真实语义（Req 4.1、4.3、8）：读时并集（官方拓扑 route 状态 + 门面 owner 记录），冻结数组；官方 seam 降级中条目诚实标注 unavailable；typed unavailable 族沿用既有错误类。
- [x] 1.6 测试：幂等 / conflict / owner-conflict / CAS 换入与 stale / dispose 幂等与 stale / 判别互指（四动作各一负例）/ 官方 LlmError 全有或全无透传为 typed validation / 降级 typed unavailable / 经门面 register 与 dispose 后 `llm/adapters-updated` 恰好各一次、门面层 CAS 替换不产生任何伪造事件（Req 4.2 事件唯一性）。每条测试标注对应验收条目。

## Task 2: 门面 surface 重排 + decorations namespace 迁移，无 alias（对应 Req 5、7、设计无 alias 决策）

**产出**：`lib/plugin-api-service.js`、`lib/index.js` 改动 + 既有测试迁移 + 新增断言。

- [x] 2.1 adapters 面重排（Req 5.1、7.3、7.4）：`llm.adapters` = `{ register（真实登记，Task 1）, list（真实语义）, decorations: { register, list } }`；装饰面按 P3 机制原样迁至 `decorations` 子对象（facet、typed 错误、handle `{dispose(), snapshot()}` 与六项例外登记全保留）。
- [x] 2.2 挂载接线（Req 8.1–8.3）：挂载门沿用 `llmAdaptersContractOk` + `resolveMarkedLlmDecoration`；装饰 facet 缺失时 decorations 子面 typed unavailable、真实登记面不受装饰 facet 可用性牵连（反向亦然）；registry 键与 capability 自描述**定为单一 `llm.adapters` 键**按现有一键机制最小改动，状态行如实反映登记与装饰两侧 backing（Req 8.2 两种方案下均可满足，取最小改动并在此记录取舍）。
- [x] 2.3 调用点迁移（P4 清单全量，无 alias）：lib 与 6 个测试文件内全部装饰语义调用迁 `llm.adapters.decorations.*`；`grep` 验证无 `adapters.decorate` / 装饰语义 `adapters.register` 残留调用点。无 alias 依据：goal.md Scope direction（不加长期 alias 掩盖错误抽象）+ design「registry 拆分与 rename/split 记录修正」表「本地开发期无 alias」行 + Req 7.5 四动作互指。
- [x] 2.4 测试：既有装饰套件（plugin-api-service-llm / registration-contribution-surface / index-llm / subtraction-conservation / host-cutover / read-surface-projection）迁移后全绿；新增断言——`llm.adapters.register` 不再接受 decoration spec（typed validation 指路）、`llm.adapters.list` 不含装饰条目、decorations 与登记两 registry generation 互不可比（Req 5.4）、装饰 dispose 后 route 仍可调用（Req 5.3）、登记撤销走装饰自身 lifecycle 不拆装饰 owner handle（Req 5.2）、`llm.adapters` 降级时 capability inventory 其余 llm 键（routing / requestTransforms / admissionPolicies）不变（Req 8.1 隔离断言）。

## Task 3: `llm.models.list` 只读投影（对应 Req 2、4.3）

**产出**：`lib/index.js`（mountLlmFeature nested models 增 list）+ 投影模块或纯函数 + 测试 `test/llm-models-projection.test.mjs`。

- [x] 3.1 投影实现（Req 2.1、2.4）：`llm.models.list()` 异步读时合成——官方 `listProviders()` + 逐 provider 官方 `listModels`（advisory 语义，list 失败=该条目 unavailable 诚实标注，不抛穿读方）+ 门面已登记 adapter routes 的声明 capability（Task 1 owner 记录）；返回深冻结快照；读纯函数无副作用、不缓存可变状态。
- [x] 3.2 真值边界（Req 2.3、1.5）：label overlay 只保留 label 元数据字段，绝不投影为 `inputModality` 等官方真值字段；不修改官方模型对象。
- [x] 3.3 并存（Req 2.2）：变体以独立 route 身份出现，原模型条目不动且可选。
- [x] 3.4 直通不混写（Req 2.5）：`services.llm.listProviders/listModels` 官方形状不变（不合并门面 routes）——既有官方直通断言 + 新增差异化断言。
- [x] 3.5 测试：合并内容与冻结性 / 目录变化后读刷新 / 变体并存 / overlay 真值边界 / 直通不混写 / 条目级 unavailable 标注 / llm 行未激活 typed unavailable。

## Task 4: e2e 与迁移证据（对应 Req 6、10、design 迁移证据义务）

**产出**：`test/llm-adapter-registration-e2e.test.mjs` + `test/llm-adapter-registration-migration-slices.test.mjs`。

- [x] 4.1 e2e mock 基座：mock llm 服务按 P1 官方合同实现 `registerAdapter`（routes Map、DUPLICATE_ADAPTER 全有或全无、stream waterfall 到 adapter.stream、dispose 撤 route）+ `listProviders/listModels/directory` 最小目录；wrapper 经官方动作入路由。
- [x] 4.2 synthetic provider 全链路（Req 10.1）：公共路径登记 → `llm.models.list` 可见 → 选择该 route 发起调用（经 mock 官方 stream 路径）→ mock stream 实现被真实调用、chunk 符合官方 chunk 合同；全程无官方 inject/import 旁路。
- [x] 4.3 图片变体并存（Req 10.2、2.2）：变体独立 route + 原模型并存、各自路由到各自实现。
- [x] 4.4 双 owner 冲突（Req 10.3、3.3）：确定性 owner-conflict。
- [x] 4.5 decorate + route replace + dispose 交叉（Req 10.4、5.5、6.4、6.5、4.2）：两 owner 各持独立 handle；替换后新调用走新实现、旧实现不再接新调用；装饰按自身 lifecycle 收口；互相不拆 handle；交叉全程官方 `llm/adapters-updated` 仅由官方 register/dispose 各发一次、无门面伪造事件。
- [x] 4.6 在途处置（Req 6.1–6.3）：撤销时在途流自然完成不污染身份；prepared call 引用已撤 route 执行时 typed stale/unavailable 不静默改路；取消经官方 signal 传播、门面不伪造 aborted 终态。
- [x] 4.7 迁移 slices（P6 模式）：vision-toolkit 图片变体调用点 slice（独立 route 登记→目录可见→选择器可见→mock stream 真实调用全链路）与 TUI vision-ask 自有 adapter slice；每 slice 头部声明消费者锚点与调用形状，断言公共路径可等价承载（Req 10 汇总 + design 迁移证据义务）。

## Task 5: registry 修正 + 文档同步（对应 design「registry 拆分与 rename/split 记录修正」表）

- [x] 5.1 canonical registry（`public-contract.registry.json`）：`llm.adapters.register` currentShape 改真实登记（含普通对象 spec 合同与 replace 选项）；`oldToTargetMapping` 的 `llm.adapters.decorate` split 目标改 `llm.adapters.decorations.register`、`llm.registerAdapter` rename 关系文案更新为真实登记、`llm.adapters.snapshot → llm.adapters.list` 行加注（旧 snapshot 消费者是装饰语义，无 alias 下随拆分迁 `llm.adapters.decorations.list`，mapping 文案不得误导）；新增 `llm.adapters.decorations.register` / `decorations.list` / `decorations.register.handle`（六字段例外行，verification 为字符串）/ `llm.models.list` 行；`llm.adapters.register.handle` 行改真实登记固定形状并新增装饰 handle 行；`statusByPath` 同步。
- [x] 5.2 能力与登记同步：`lib/capability-matrix.js` llm 域矩阵路径与状态同步（真实登记 / decorations / models.list）；`docs/standards/capability-strategy.md` llm 行补 A 类直绑说明（不新增 R slice）；`docs/specs/plugin-api-features/feature-list.md` §7 追加本 feature 交付条目，条目内显式载入 Req 9.1 的 host-only 六问判定与 Req 9.2 的 client 语义复用边界（不建第二目录）——Req 9 由 design「client 半面」六问记录与本登记承载，无实现工作。
- [x] 5.3 一致性核对：registry validator / 既有 registry 测试全绿；validator 规则（六字段例外 verification 字符串、capability 簇存在性）确认。

## Task 6: 全量验证、全局终审与提交

- [x] 6.1 `npm test`（4G 护栏）全绿；治理 token 审计不新增泄漏。
- [ ] 6.2 全局终审（阻塞式，只审整体交付与 Tasks/Design/Requirements 一致性 + standards 适用分册比对）：返回「无偏差」后才可进入 6.3；有意见则集中修订并再次派审。
- [ ] 6.3 `git diff --check` 干净；全局终审通过后按阶段提交规则提交本 Stage 4 交付（实现 + 测试 + registry/文档同步 + tasks 勾选与状态行）并完成最终登记。

## 执行边界

- 版本冻结：不步进任何版本字段（AGENTS §3.0.1）。
- 不动 `llm.routing` / `requestTransforms` / `admissionPolicies` 既有职责；不建第二个 llm owner；不为 A 类能力先造 replacement；本设计不预批任何 R 扩展。
- 无 alias：本地开发期 API 重构窗口，全部调用点迁移（Req 7.7 口径）。
- 治理代号不进入实现/测试代码。
