# 能力覆盖与守恒矩阵（M8 验收输入）

> 本表回答“重构后门面能力是否总体保留”，不是实现排期。`retained` 表示语义基本不变，`renamed`/`merged` 表示入口变化但能力保留，`migrated` 表示转入 `services.*` 或内部机制，`deleted` 必须有替代或明确缺口，`gap` 表示目标契约已确定但当前实现尚不能兑现。

## 1. 覆盖规则

1. 每个 current 叶子必须且只能有一个最终状态。
2. `deleted` 不得只写“删除”；必须同时填写 `replacement` 或 `gapReason`。
3. 合并入口按能力计数而不是按入口计数：多个旧入口合并为一个目标入口仍算保留一项能力。
4. 迁移到 `services.*` 仍算保留官方能力，但不算门面附加语义。
5. 自动化替代手动入口时，必须证明触发条件、输入、输出、失败和可观察性覆盖；否则只能标 `gap`。

## 2. Host 能力矩阵

| 能力簇 | 当前入口 | 目标形状 | 状态 | replacement / gapReason |
|---|---|---|---|---|
| facade presence/version | `isActive/apiVersion/assertCompatible` | 同名 | retained | 无 |
| capability discovery | `capabilities.get/list/require` | 同名 | retained | 无 |
| event observe | `events.on/once` | `events.observe` | renamed | 标准订阅句柄 |
| event dispatch | `emit/serial/parallel/bail/waterfall` | 同名 outcome | migrated-shape | producer authority + containment |
| LLM call | `modelInfo/prepareCall/stream` | 同名 | retained-shape | 仅统一结果冻结边界 |
| LLM request transform | `llm.requestTransforms.transform` | `.register` policy | renamed | 自动决策点；无决策点则 gap |
| LLM admission | `llm.admissionPolicies.register` | 同名 policy | retained-shape | 自动生效 |
| LLM adapter/provider/model registration | 多个 `registerXxx` | 各登记表 `register` | merged/renamed | 数据/实现登记能力保留 |
| routing snapshot | `forExecution/current/on/once/wait` | `forExecution/current/observe/wait` | renamed | route query 唯一入口保留 |
| routing policy/health | `policies/candidates/health/circuit/decisions` | 分表 idiom 归属 | retained-shape | 手动 probe 迁移到 registry |
| agents | `get/list/roots/create/resume/register/providers.*` | projection + operation + registry | split/reclassified | 原能力全覆盖 |
| executions | observe/get/history/visibility | projection + policy | split/renamed | onChange 合并 observe |
| recovery evaluation | classify/evaluate | internal + operation | migrated-shape | classify 不再公开 |
| recovery consume | `consume` | 自动失败路径 | deleted/gap | 在官方失败决策点接入前不得宣称已替代 |
| recovery visibility project | `visibility.project` | 自动 projection | deleted/gap | 自动投影路径和可观察性待证明 |
| session reads/events | 多个 session accessor | projection 标准形状 | retained/reclassified | helper 与视图分开登记 |
| session durable | durable catalog/observe/append | projection + mutation | split/renamed | append 保留事实写入 |
| session branches | graph/plan/preview/create/commit/rollback/restore | projection + mutation | split/reclassified | 能力保留 |
| session channels | open/subscribe/fetch/heartbeat/ack/resume/revoke | coordination + projection + operation | split/renamed | channel authority 保留 |
| channel auth/redaction | 多个 register/dispatch | policy + registry + operation | split/renamed | 内部 dispatch 删除 |
| tools | register/restrict/guard/get/schemas/execute | registry + policy + projection + operation | split/renamed | 能力保留 |
| tool discovery | catalog/search/activate/deactivate/audit | registry + projection + operation | renamed | 能力保留 |
| skills activation | register/activate/deactivate/exposure/audit/policy | 四类 idiom | split/renamed | 能力保留 |
| prompts contributions | section/context/variable/tools/suppress | `prompts.contribute` | merged | 五类投稿保留为 kind |
| prompts provenance | contribute/compose/inspect/mapping/observe/policy | 同名按 idiom 分拆 | retained-shape | 能力保留 |
| attachments pipeline | ingest/transform/cleanup/registerTransform | operation + registry | renamed | replacement owner 保留 |
| attachments projection | resolve/open/project | `get/open/project` | renamed | 能力保留 |
| MCP catalog | servers/tools/resolve/onChange | projection + observe + availability | renamed/gap | 缺 availability 时标 gap |
| tasks | register/start/settle/attach/claim/reassign/reads | operation + coordination + projection | split/reclassified | 能力保留 |
| generic coordination | lease methods/watch | acquire/.../observe | renamed | lease 语义保留 |
| workspace transactions | prepare/record/preview/commit/rollback/recover/get/observe | operation + mutation + projection | split/reclassified | 能力保留 |
| security policies | policy/redaction/egress | policy registry | retained/gap | egress/redaction 自动咨询仍有缺口 |
| security audit | query | list | renamed | 能力保留 |
| diagnostics | register/get/onChange | registry + projection/observe | renamed | 能力保留 |
| settings | register/scope/describe/update/replace/mutate | registry + projection + mutation | split/renamed | installSettingsSection 合并 |
| profiles | inspect/health/planDiff/apply/snapshot | projection + mutation + operation | reclassified | 能力保留 |
| remotes | publish/isActive | register/availability | split/renamed | publication 能力保留 |
| storage | open/close/purge | open handle + explicit purge | retained-shape | close 不删除；purge 为明确 mutation extension |
| official tools/content helpers | `llm.contentHasImage` 等 | `services.*` | migrated | 官方能力保留，门面语义移除 |
| recovery adapters | `adapters.*` | `services.*` | migrated | 官方转换能力保留 |

## 3. Client 能力矩阵

| 能力簇 | 当前入口 | 目标形状 | 状态 | replacement / gapReason |
|---|---|---|---|---|
| client root/version/capabilities | root members | 同名 | retained | host/client vocabulary identical |
| connection RPC | `connection.rpc` | operation outcome | shape-only | 能力保留 |
| connection API access | `connection.api.settings/llm` | `connection.get` | renamed | 能力保留 |
| client event subscription | named `.on`, root `on` | `events.observe` | merged/renamed | 能力保留 |
| remote publication | mount methods | `remotes.contribute` | merged/renamed | 能力保留 |
| remote event transport | `$on/$dispatch` | observe + owner publisher | split/gap | custom publisher 尚需能力迁移 |
| settings scope/remote | scope + mount contribution | scope + contribute | renamed | 能力保留 |
| slots | register/inject/entries/subscribe/on | contribute/list/observe | merged/renamed | 能力保留 |
| lifecycle | caller-bound lifecycle surface | register/get/list/observe | gap | 需先完成叶子 inventory 与统一契约 |
| codec | codec object | register/get/validate | gap | 需明确公共 codec 叶子；不得把 zod 实例当 API |
| official browser leaves | `services.<key>.<member>` | 同名 `services.*` | migrated/retained | 逐服务审计，不进入八类 idiom |

## 4. 守恒验收

- M8 不能以“入口数量减少”作为能力损失证据；必须按能力簇对照本表。
- 任何 `deleted` 或 `gap` 能力都必须在交付报告中列出；未列出的删除视为未完成。
- 迁移完成的最低条件：所有 retained/renamed/merged/migrated 能力有目标 path；所有 gap 有明确上游或替代能力性质；没有无说明的孤儿 current path。
