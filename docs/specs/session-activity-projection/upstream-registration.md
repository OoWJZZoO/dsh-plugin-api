# Upstream Registration Draft — session-activity-projection（W11.2）

> 本文是 `session-activity-projection` 对共享 loop boundary slice 承载能力的 U-series 上游提案与退役条件**草稿**。草稿内容写入本线 spec 制品；feature-list §3 U-series 表的实际落条（编号分配、表位、与 interaction/checkpoint 线提案合并）由集成波 I2 执行。本线不直接编辑 feature-list.md（冻结文件）。

## U-series 提案（草稿）

**主题：官方 agent-loop attempt 生命周期 / settle / queue 公开 seam**

现状缺口（与本 feature 的 observed 终态/排队能力直接相关）：

- 官方 `dsh-agent-loop` 无 abort / supersede / settle 的公开事实出口——`turn/end` 的 `reason` 只能作边界证据，不能承载「本次 activity 最终 outcome」的权威语义；`aborted`、`superseded`、`denied` 的可靠判定只能由切片在 loop 真实提交点发出 attempt 事实获得。
- 官方无「排队 vs 空闲」的公开判定（`inbox.hasPending` 为内部实现细节）。
- 官方无稳定 per-request execution identity 的公开面（残余 C 登记同源）。

本线现状 workaround：既有 `packages/agent-loop` replacement 包内的共享 attempt-facts 切片（`agent/attempt/start|end`，outcome 五值 + followUp `none|queued`，payload 逐字段冻结于 `slice-consumption-contract.md`），由 agent-loop owner 包在真实提交点发出；切片未激活时投影按 availability 如实降级（reconstruction/unknown），不冒充 observed。

**退役条件**：官方在 agent-loop 组装/提交点（或等价权威位置）提供公开 attempt 生命周期/settle/queue seam——具名 attempt 身份（内部 retry 同 execution 新 attempt）、公开 terminal 事实出口（outcome 五值语义与 priority/adjudication 规则）、公开队列后续状态、且不破坏既有 ctx service/event 契约 —— 后，本 feature 的 attempt 事实消费侧直绑官方 seam，切片能力退役、相应 reconstruction 回退规则删除（`superseded-by-boundary` 等仅保留为官方数据缺失时的降级档），门面公共面 `sessions.activity` 保留。切片本体退役遵其 owner 包退役条件（由 interaction 线登记）；feature-list §3.1 共享 capability 条目的退役条件与本条一致（同一切片同一直绑目标）。

## 残余 C 类登记（要求 v2 已有，本文件重申证据）

官方 durable per-request identity 与 question 事实 seam：官方无公开面，非单一组件可闭合约缺失；官方提供后投影直绑并删除对应 reconstruction/unknown 规则（`waiting.kind=question` 从未知档升级为证据档）。执行中（in-flight）状态不属于本投影范围——interim status 由已提交事实派生，与 in-flight 不同轴。

## Host-only 判定（capability-strategy §10 六问，只读证据）

被替代官方行 `agent-loop`（`@deepseek-ai/dsh-agent-loop`，probe 于 2026-09-06）：

| # | 六问 | 证据 | 结论 |
|---|---|---|---|
| 1 | 官方行是否声明 client manifest？ | 官方 `package.json` 无 `dsh` 字段、无 client manifest/`dsh.client` 声明 | 否 |
| 2 | 是否注册 remote namespace？ | 无任何 remote/typert 注册面 | 否 |
| 3 | 是否提供 slot 或 settings bridge？ | 无 slot/settings 桥接面 | 否 |
| 4 | 是否有 client 与 host 之间的版本协商？ | 无 | 否 |
| 5 | 是否有 browser-side state 或 reconnect 语义？ | 无浏览器侧状态 | 否 |
| 6 | 官方行是否拥有 client-facing event/service？ | 事件面全部为 host 面（agent/status、agent/error 等） | 否 |

**六问全否 ⇒ host-only（记录即证据）。** 与 requirements R9 AC7 / design 判定一致；切片装配方（interaction 线）在其 spec 中作同样记录，集成波 I4 核对两份记录一致。