# Stage 0 Goal: decision-participation-contract

> feature_name: `decision-participation-contract`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）；Requirements / Design 同批交付于本目录（requirements.md / design.md）
> 输入溯源：M10 工作纲领 §3.1（OBS-01、OBS-03）；观察报告 §5 OBS-01（含最小运行复现与消费源码锚点）；M8 migration ledger 第 30 行（侧向决策注册不再公共、汇编改写由 `prompts.contribute` 承载）与 8.3(a)（anchor 整体替换超出现有贡献语义的提案登记）；canonical registry eventCatalog 现状（decision 语义事件目录与 `events.observe` 投影）。

## Goal

让第三方插件能够通过稳定公共契约**参与官方真实决策点与必要执行边界**——纯 decision、串行 transform、异步执行前屏障与 around middleware 各按真实 idiom 表达，保留返回值、异步顺序与作用域语义——而不是只能 observe 到通知。决策回调必须真实影响 producer 的本次操作：reject/deny 实际阻止进入、transform 产出进入下一阶段、环绕逻辑真实包裹执行。

主公开面是按 idiom 分开的参与机制（decision/transform/屏障/环绕各自有准确语义），与只读 observer 明确分界；最终公共 path 与机制选型在 Design 中依总树一致性确定，本阶段不批准具体 path。

## Why

OBS-01 已证实（含最小运行复现）：公共 events bus 的 `observe` 经固定 monitor feed 派发，`deliver` 调用消费者后只处理 rejection、不把返回值回给 waterfall——`observe('agent/pre-step').subscribe(() => ({kind:'reject'}))` 不改变决策结果（仍返回 enter）。M8 公共面减法删除了侧向 waterfall listener 注册（migration ledger 第 30 行），汇编改写交给 `prompts.contribute`，但 anchor 的整体 sections 替换 + tools 过滤（ledger 8.3(a)）超出追加贡献语义，当时登记为提案；`compaction/request`、`session-title/candidate` 等决策事件在 catalog 中保留 priority/冲突/失败语义描述，公共调用者却无法按原语义参与。真实消费者有源码调用点：agent-teams 的 pre-step 激活（等待 `next()`、保留 reject、追加 activation message、返回新 enter decision）、turn-rewind 与 checkpoint-rewind 的执行前捕获（涉及异步屏障）、model-failover 的 request/request-error 参与、secret-redactor 的工具结果改写。这些插件当前只能保留官方 raw 旁路或丢失行为。

## Scope direction

- 按真实 idiom 区分参与方式：只读 observer、纯 decision、串行 transform、异步执行前屏障、around middleware；不以单一 observe 冒充全部，也不把所有 hook 强塞为纯 decide。
- 覆盖点位（逐点保真清单在 Requirements 落实）：`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping`（现行 catalog 登记为 fact 语义，如需修订参与语义须对照目录现状显式声明）、`system-prompt/assemble`、`tools/pre-execute` / `execute` / `post-execute`、`llm/stream`、fs write/edit intent、`compaction/request`、`session-title/candidate`。
- 已有等价面优先：`llm.requestTransforms` / `admissionPolicies` / `routing`、`tools.guard` / `restrict`、`security.redaction` 等若能等价承载，则补其不足与迁移证据，不制造第二个相同决策 owner。
- 决策回调真实影响 producer 本次操作：reject/deny 不被下游误覆盖；transform 产出进入下一阶段而非旁边另存一份；支持整体 sections 替换、既有 tools 筛选等已证实行为，不只支持追加。
- 有副作用的执行前工作（如执行前快照）用正确的生命周期/operation 合同承载（snapshot 执行归 checkpoint owner），不以「策略必须纯」删除功能；纯 decision 不夹带副作用。
- 合理保留 scope、priority、注册顺序与失败隔离；observer 的返回值始终不参与决定；callback throw/rejection、abort、stale disposer 不破坏其他 owner。
- 通道方向：官方已 dispatch 的决策点按 A/B 稳定化；框架横切派发语义（priority / deepFreeze / fault containment）永不 R；仅当证实某官方组件确实缺少必要业务边界时，单独评估该组件的 R slice，Goal 阶段不预批。
- 点位归属与 scoped-agent-contributions、compaction-operation、interactive-session-access 及总契约线共同确定；公共事件生产权收敛归总契约线；不建全局 before/after DAG。

## Boundaries

- 不恢复无语义约束的万能 `ctx.on`；领域化的 decision/transform registry 优先，必要通用 hook 仅作统一机制。
- 不把 around 副作用伪装成纯 policy，也不以 projection 名义登记例外。
- 不拥有 prompts 汇编与 checkpoint 快照的领域 owner 权；本线提供参与机制与其保真合同，领域内容由既有 owner 承载。
- 不扩大 canonical fact 伪造权；研究插件自有事件走既有 `events.define`，不另造事件体系。
- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Expected result

研究插件（agent-teams、turn-rewind、checkpoint-rewind、model-failover、secret-redactor、anchor）的决策/改写/屏障/环绕行为可经公共路径等价迁移并真实生效：pre-step reject 实际阻止进入本步、消息改写实际到达本步、异步快照在工具副作用前完成、post-execute 改写进入模型；两个策略按明确顺序组合；callback throw/rejection、abort、stale disposer 不破坏其他 owner；observer 返回值始终不参与决定。

## Stage boundary

本文件只确认 Goal 方向，不批准具体公共 path、注册 API 形状、逐点位归属终表或任何 R 点位。Requirements 应把逐点位保真清单（输入、可改范围、返回值/决定、next/continuation 所有权、await、取消、scope、失败默认、排序）写成 EARS，并记录 client 半面判定；Design 再确定机制选型（领域化 decision/transform registry 与统一机制的分工）、点位归属终表、失败 containment 与排序语义。
