# 实现/装配表（Implementation & Assembly Table）

> feature: `plugin-api-m10-contract-convergence`（Stage 4 交付物，Req 3.1）
> 字段：能力 → owner 包 → 真实 source/决策点/carrier → 版本条件 → full 与选择性装配等价 → 缺位行为 → 验证入口。

| 能力 | owner 包 | source / 决策点 / carrier | 版本条件 | full vs 选择性 | 缺位行为 | 验证入口 |
|---|---|---|---|---|---|---|
| `sessions.request` / `sessions.cancel`（M9 + 本线扩展） | 主包 | agent-loop 切片 `INTERACTION_BOUNDARY_SYMBOL` 边界 + durable append + 官方 inbox（`agent.steer/followup/inbox.remove`）；client 经 `/plugin-api/sessions` typed 路由 | 主包版本；切片版本经 `versionOk` 校验 | 等价（纯门面，无替代行依赖） | 边界不可用 → typed `unavailable`；durable/附件不可达 → typed `unavailable`（不 append-and-guess） | `test/session-interaction-operation-*.test.mjs`、`test/client-session-interaction-operation.test.mjs` |
| `sessions.interactions.*`（本线） | 主包 | 会话日志 durable 对 `approval/asked`/`approval/decided` 折叠 + 官方 `approval/request` waterfall（append 注册）+ `/plugin-api/sessions/interactions` 路由 | 主包版本；无替代行依赖 | 等价（纯门面） | 日志源不可读 → typed degraded/unavailable；question 侧恒 `unavailable`（登记缺口） | `test/sessions-interactions.test.mjs`、`test/interactive-session-e2e.test.mjs`、`test/client-sessions-interactive.test.mjs` |
| `sessions.selection.*`（本线） | 主包 | 官方 `apiProxy.sessions.models/selectModel`（经审计白名单两条可选窄成员转发）+ `/plugin-api/sessions/selection` 路由 | 主包版本；官方 apiProxy 需带 nested seam | 等价（纯门面） | read 缺失 → `unavailable`；只缺 submit → `degraded`（get 仍可用） | `test/sessions-selection.test.mjs`、`test/client-sessions-interactive.test.mjs` |
| `sessions.planMode.*` | 主包 | 官方 plan-mode 服务 `set/onBoundary` + session 日志投影 | 主包版本 | 等价（纯门面） | 官方服务缺失 → typed disabled + availability 如实 | `test/sessions-plan-mode*.test.mjs` |
| `sessions.permissionPresets.*` | 主包 | 官方 permission-presets `set/current` + `permissions` 投影 | 主包版本 | 等价（纯门面） | 同上 | `test/sessions-permission-presets*.test.mjs` |
| `credentials.set/unset` | 主包 | 官方 credentials provider 唯一写链 + `credentials/updated` 事实 + 管理存储层证据 | 主包版本 | 等价（纯门面；冲突检测为**声明的门面模拟**） | env 影子 → `read-only`；标记失效 → `revision-unknown` | `test/credentials-mutation.test.mjs` |
| `sessions.compaction.run` | **替代包** `@deepseek-ai/dsh-plugin-api-compaction-events` | 既有 replacement owner 的 operation 子面（marker + 版本 + 行状态四条件门控） | 辅助包 `A.B.C` 必须与主包一致；四条件门控 | 等价（选择性安装需显式添加该辅助包；full 聚合等价，不双跑） | 门控不通过 → typed feature-disabled + availability `unavailable` | `test/sessions-compaction-*.test.mjs`、`test/sessions-compaction-e2e.test.mjs` |
| `workflows.start` | 主包 | 官方 `workflowEngine.start`（经 `ctx.get` 内部消费，**不进白名单**） | 主包版本 | 等价（纯门面） | 引擎缺失/形状不符 → typed disabled | `test/workflows-*.test.mjs` |
| `agents.scopes.register` / `prompts.contribute({scope})` | 主包 | 目标 agent ctx 落官方 scoped 层 + `agent/created`/`agent/disposed` 事实 | 主包版本 | 等价（纯门面） | 目标销毁 → eviction（typed） | `test/scoped-agent-*.test.mjs` |
| 决策参与（`agents.decisions` / `prompts.assemblyPolicies` / `tools.executionPolicies` / `events.decisions`） | 主包 + **agent-loop 替代包**（turn-stopping R 切片） | 门面值感知参与基底 + agent-loop owner 切片 | 辅助包 `A.B.C` 一致；切片 marker | 等价（不新增行） | 参与基底缺失 → typed unavailable | `test/decision-participation-*.test.mjs` |
| `llm.adapters.register` / `llm.adapters.decorations.*` / `llm.models.list` | 主包 + 替代包 `@deepseek-ai/dsh-plugin-api-llm` | 官方 `registerAdapter` 直绑（真实登记）+ 既有 decoration registry（装饰） | 辅助包 `A.B.C` 一致 | 等价 | 缺辅助包 → 装饰面 typed unavailable，真实登记仍可用 | `test/llm-adapter-*.test.mjs`、`packages/llm/test/decoration-registry.test.mjs` |
| `sessions.channels.*` | 替代包 `session-channel-connection` / `session-channel-gateway` | 官方 session 事件流 + channel engine（含 client 半面） | 辅助包 `A.B.C` 一致 | 等价（full 聚合与选择性安装同一组行） | channel 失活 → typed degraded/unavailable | `test/session-channel-*.test.mjs` |
| `attention.*` | 主包（attention hub）+ 既有 client carriers | 官方 session 事件流 + 门面 attention hub；通知呈现归消费者 | 主包版本 | 等价（纯门面） | 源缺失 → typed unavailable | `test/attention-*.test.mjs`、`test/client-attention-face.test.mjs` |
| `services.appExit`（本线新增） | 主包 | 官方 launcher `ctx.provide('appExit', host.exit)`（1:1 直通，无门面状态） | 主包版本；成员 `optional` | 等价（可选成员，缺位不连带） | 服务缺席 → `services.appExit` 面 disabled（`isActive:false`）、`exit()` 抛 typed `PluginApiFeatureDisabledError`；服务在场但成员缺失 → 成员整个不出现（`optional` 语义）；两种情况门面都绝不合成 `process.exit` | `test/convergence-app-exit.test.mjs`、`test/services-*.test.mjs` |
| 其余 `services.*`（46 个既有键） | 主包 | 官方服务 1:1 直通（`lib/official-service-definitions.js`） | 主包版本 | 等价 | 必需成员缺失 → 该服务面 disabled（不连带其他键） | `test/services-*.test.mjs`、`test/integration-surface.test.mjs` |
| `sessions.activity.*` | 主包 | 官方 session 事件流 → 门面 activity 投影（只读；waiting 证据同源） | 主包版本 | 等价（纯门面） | 投影缺失 → typed `unavailable`，confidence 三态不互代 | `test/session-activity-*.test.mjs` |
| `workspaces.transactions.prepare/commit` | 替代包 `@deepseek-ai/dsh-plugin-api-workspace` | 官方 WorkspaceRegistry + snapshot capture/get/apply（R 类 owner） | 辅助包 `A.B.C` 一致 | 等价（full 聚合与选择性安装同行集合） | 应用失败 → fail-closed 官方 API 重建 | `test/workspace-transaction-*.test.mjs` |
| `sessions.branches.*` | 主包 | 官方 session 分支能力 + 门面 generation/CAS 记账 | 主包版本 | 等价（纯门面） | 未挂载 → typed feature-disabled + availability `unavailable` | `test/index-session-branch.test.mjs` |
| `llm.admissionPolicies.register` / `llm.modelInfo` | 主包 | 官方 `resolveModelInfo` 包装（B 类隐藏实现）+ 官方 `apiProxy.sessions` 作用域上的准入网关（`lib/llm-admission-gateway.js`、`lib/index.js` 的 `mountAdmissionFeature`） | 主包版本；官方 llm 的 resolveModelInfo、agents.get 与 apiProxy.sessions 的 prompt/selectModel 边界在场 | 等价（纯门面，无替代行依赖） | 边界缺失 → 该特性 disabled（typed）；无匹配策略 / `match` 抛错 → 官方判定原样保留 | `test/llm-request-integration.test.mjs`、`test/llm-admission-gateway.test.mjs`、`test/convergence-consumer-equivalence.test.mjs` |
| `llm.requestTransforms.register` | 主包 | 门面包 llm/stream 重入投影（同步 `llm/request` 转译，幂等收敛） | 主包版本 | 等价（纯门面） | 变换失败 containment，终态唯一 | `test/llm-request-*.test.mjs` |
| `llm.routing.*`（candidates/health/decisions/policies） | 主包 + 替代包 `@deepseek-ai/dsh-plugin-api-llm`（route policy） | 官方 llm 调用链 + 门面 route policy 平面 | 辅助包 `A.B.C` 一致 | 等价 | 策略缺失 → typed degraded；无自动 probe 调度 | `test/model-route-policy.test.mjs`、`test/route-policy-facade.test.mjs` |
| `remotes.register` / `remotes.contribute` | 主包（host）+ 既有 client carriers | 门面 remote owner + client 贡献面（`remotes.register` 直发） | 主包版本 | 等价 | carrier 缺失 → typed unavailable | `test/client-remote-contribution.test.mjs`、`test/registration-contribution-surface.test.mjs` |
| `mcp.*` | 替代包 `@deepseek-ai/dsh-plugin-api-mcp` | 官方 MCP 客户端接入（R 类 owner） | 辅助包 `A.B.C` 一致 | 等价 | 缺包 → `mcp.*` typed unavailable，主包无关能力不受连带 | `test/index-mcp.test.mjs` |
| 出口脱敏（visibility 包络） | 主包 | 各出口 owner 逐出口脱敏（attention/channel/audit/client 负载），fail-closed | 主包版本 | 等价 | 脱敏失败 → 不发未脱敏负载 | `test/attention-privacy.test.mjs`、`test/session-channel-redact.test.mjs`、`test/security-policy-assembly.test.mjs` |
| 读面复用组（`sessions.views.*` / `services.sessionProjections` / `settings` / `slots` / `storage` / `tools` / `agents`） | 主包 | 官方服务 1:1 直通 + 门面投影面 | 主包版本 | 等价 | 缺面 → typed unavailable/degraded | `test/read-surface-projection.test.mjs`、`test/index-session.test.mjs`、`test/index-services.test.mjs`、`test/storage-binding.test.mjs`、`test/client-slot*.test.mjs` |

## R 类承载行核对（Req 3.2）

- `sessions.compaction.run`（`compaction-events` 替代包内 additive operation 子面）与 `agent/turn-stopping`（`agent-loop` 替代包内 R 切片）逐条核对 R1–R8：唯一 owner、boot 自检、版本锁定、退役条件、U-series 提案均已登记在 `docs/standards/capability-strategy.md` §5 与 feature-list §3.1；**不新增行、不改变行集合**。
- 本线**不新增 R 包/R 行**；`services.appExit` 是 A 类 advanced passthrough 白名单成员，不属 R 类。
