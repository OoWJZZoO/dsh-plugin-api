# 语义领域组合标准

> 适用范围：现行 host 公共 namespace 中各语义领域的 owner、顺序、冲突和 authority 边界。
> 关联：通用 composition mode 与 authority map 见 `composition-and-authority.md`；namespace 形状见 `public-api-shape.md`；`services.*` 见 `capability-strategy.md` §6；排序规则见 `ordering.md`。

## 1. 层次说明

本册是**领域层**要求，与另两册分层且不得混写：

- `composition-and-authority.md`：跨领域通用的 composition mode、owner/key/generation、authority closure、claim。
- **本册**：各领域在满足通用规则之外，额外必须满足的最低领域约束。
- `ordering.md`：普通事件监听的排序模型，以及领域 reducer/fixed stages 的使用边界。

## 2. 领域最低要求

| 领域 | 组合要求 |
|---|---|
| `events` | 区分 observe-only consumer 与 producer authority；canonical system event 只能由其 owner 派发，**event → producer owner 的映射由 canonical 事件目录条目承载**（registry `producerAuthority`），派发前判定归属、非 producer 返回 typed `denied`、**未声明 producer 的条目 fail-closed**；关键决策不用裸 waterfall 代替领域 reducer。第三方自定义事件通过合作型 `define` / publisher handle 发布；不提供对抗性同进程身份隔离，主动绕过门面在保证范围外 |
| `llm.requestTransforms` | owner-scoped、确定的 priority/注册顺序、声明改写范围、at-most-once/convergence；同字段冲突有明确规则 |
| `llm.admissionPolicies` | 使用固定 decision algebra；deny/ask/allow 等优先级不得由监听顺序隐式决定 |
| `llm.adapters` | owner/id/generation 隔离；稳定链序；卸载和 topology reconcile 不影响其他 owner |
| `llm.routing` | 查询、policy、candidate、health、decision 各自 owner 清晰；attempt 内 decision immutable；policy 冲突由领域 reducer 处理 |
| `agents.providers` | provider key 多 owner 隔离；真正 singleton factory 必须 claim 或由门面 multiplex |
| `executions` | projection 只读；execution identity 独立；recovery policy 由单一 authority 自动消费，合作型调用使用独立的 recovery operation |
| `sessions.branches` | branch/plan/commit identity、generation 和 CAS 明确；直接 session mutation 不得静默破坏 branch 保证 |
| `sessions.channels` | channel/device/session scope、generation possession 和认证 owner 清晰；注册链遵守声明的固定顺序 |
| `sessions.compaction` | 压缩引擎是唯一执行者与事实 producer；门面只做受控触发与终态映射，不新增 mutation authority、不铸造 operation 身份、不新建 durable scope |
| `sessions.interactions` | 待处理 approval/question 的受限视图从**官方 durable 对**（`approval/asked` 减 `approval/decided`）折叠，官方 approval authority 仍是唯一决策者；门面只在没有更早 answerer 认领时以**兜底 answerer**持有请求并把显式调用方的选择交回官方 outcome 闭集；不建第二套 pending 生命周期、不代答、不抢占 `userQuestions` provider（question 侧无 seam ⇒ 诚实 typed unavailable） |
| `sessions.selection` | per-session 选择的唯一事实源与提交入口是官方 api-proxy 状态（经审计白名单的两条窄成员承接）；门面只读有效值、按可观察兜底层披露 `source`、以值级比较换提交，不持有第二份选择；官方 seam 为 last-write-wins，残余竞态声明而非隐藏 |
| `workflows` | workflow 引擎是唯一执行者、校验者与终态 authority；门面只做受控启动、owner/parent 检查与终态映射，不铸造第二套 run 身份、不建全局 run 注册表、不代答终态；`tasks` 管关系、`executions` 管观测，各归其主 |
| `tools` | tool 名称/key 冲突显式；注册 owner 化；restrict/guard 使用固定组合代数；执行使用 scope 和 execution identity |
| `tools.discovery` | descriptor 与 activation owner 化；latest-wins 只发生在同 owner；跨 owner catalog 冲突显式 |
| `skills.activation` | skill descriptor/activation owner 化；静态 registry 与 session activation 的 authority 边界固定 |
| `prompts` | section/context/variable/tool provider 为加性注册并有稳定顺序；assemble 决策点明确可写范围 |
| `prompts.provenance` | projection 与 contribution/mapping owner 分离；不能通过 provenance API 绕过 prompt policy |
| `attachments` | pipeline stage owner、顺序、content identity、cleanup authority 和 cancellation 明确 |
| `mcp` | catalog/lifecycle 只读；server/tool identity 与 generation 稳定，不向查询方泄漏 mutation authority |
| `tasks` | task/attempt/resource identity、claim/fencing 和终态唯一；多个 task 插件消费同一 authority 投影；availability 的 `status` 是该 namespace 在册部分（`sources` 等）的最小值——任一来源不可用 ⇒ `degraded` 并附 `reason`，detail 保留 |
| `coordination` | resource key、owner、generation、fencing token 与 backend 能力显式；不把进程内状态伪装为 durable；`operations` / `durability` / `backend` 是后端能力声明、不参与 `status` 聚合——跨 scope 请求超出后端能力时 `status: unavailable` 并保留 detail |
| `workspaces.transactions` | 所有受保证的 workspace mutation 纳入 transaction authority；旁路写路径显式登记 |
| `security` | policy/redaction/egress 使用固定领域 reducer；policy/redaction 的 deny 与故障方向 fail-closed；egress 是 denylist（默认 allow，未命中 deny 即保持官方出站行为，初始零策略），只有显式 deny 拦截；受支持的 egress 路径形成 authority closure；availability 按 `faces` 在册部分聚合（局部缺失 ⇒ `degraded`，全部 `inert` ⇒ `unavailable`），detail 保留 |
| `diagnostics` | health 与 availability 分离；source 注册 owner 化；诊断不得改变被诊断 feature 的状态 |
| `settings` | namespace owner/key 冲突显式；document mutation 有 scope/revision；remote publication 不静默占键；namespace 注册的释放边界必须如实披露（官方注册随门面与 settings 服务存续时不得伪装为可按 handle 撤销） |
| `profiles` | read projection 与 mutation owner 分离；写操作 CAS/validation/claim 化；同 profile 写入不得 silent last-wins |
| `remotes` | service key owner 化；同 key 跨 owner 冲突拒绝；disposer 不撤销其他 generation |
| `storage` | 只保存 owner 私有实现数据；owner 自动派生、scope 显式；不得作为共享领域状态或 authority 的旁路 |

## 3. 应用方式

- 表中的要求是各领域 spec 的最低架构约束，不替代具体 requirements/design 中的可测试合同。
- 某个领域成员仅为纯官方 passthrough 时，按 `services.*` 分级处理，不强行套用语义领域改造。
- 领域确实需要比全局 priority 更强的顺序语义时，只在该领域内定义 reducer、固定阶段或 ordered pipeline，不建立跨领域 dependency graph。
- 某个 feature 同时包含 facade translation 和 replacement slice 时，公共领域要求保持不变；replacement 组件边界和退役条件另按 `capability-strategy.md` 处理。
