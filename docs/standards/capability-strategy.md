# 能力上限策略（capability strategy）

> 本文与 `AGENTS.md` §2 / §4 共同构成 A/B/C/R 分类与能力上限决策的权威依据；两者冲突时以 `AGENTS.md` 铁律为准。
> 配套登记：`docs/specs/plugin-api-features/feature-list.md`。
>
> **版本与安装**：R 类辅助包、主包与全量聚合包采用 `<A>-<B>.<C>.<D>` 版本模型：共享 runtime 全量 identity `A` 与 API 合同 `B.C`，包本地维护号 `D` 可以不同；`dsh.api` 仅承载 `B.C`。主包校验辅助包 `A.B.C` 完全一致；不一致时**只停用该辅助包对应的 R 类特性**（替代行仍提供官方原接口，新增事件/策略面不发布），不得停用主包或其他能力。完整版本与协议规则见 `versioning-and-protocols.md`。R 类运行时命名不得携带治理后缀（如分类字母、需求编号）。安装模式为全量聚合 bundle `@deepseek-ai/dsh-plugin-api-full`（确定性 patch 装配）或选择性安装主包 + 所需辅助包。

---

## 1. 双通道

1. **方案一（门面转译，facade translation）** 是默认能力通道。
2. **方案三（replacement bundle）** 是经批准的补充通道：禁用官方行 + 插入替代行。
3. **方案二（直接修改官方运行时源码）不作为插件分发通道**：只在部署/运维层例外使用，且不受 `dsh.api` 版本承诺（见 §8）。

---

## 2. 实现通道分类

| 类型 | 含义 | 通道 |
|---|---|---|
| A 类 | 官方已 dispatch / 已提供服务，只需稳定化 | 方案一（门面直通，不转 R） |
| B 类 | 官方没有 dispatch 点，只能用底层钩子模拟 | 默认方案一；组件边界清晰、契约可保留、风险与维护成本可接受时才评估 R 类 |
| C 类 | 不改官方做不到 | 默认只写 upstream proposal；经批准且缺陷落在单一官方组件包内才可评估 R 类 |
| **R 类（替换类）** | 缺失语义天然属于某个**官方组件插件包**，由该组件唯一 replacement owner 经官方 patch 机制禁用一个或多个官方行并插入替代行 | 方案三 |

B 类是否转 R 按组件边界、契约可保留性、风险和维护成本判断，不采用统一量化门槛。只有 R 类、durable mutation、异步重入和 client replacement 才要求完整的契约与失败路径证明；其余只需按风险提供与决策相关的最小证据。

**横切派发语义**（事件 `priority` / `deepFreeze` / fault containment）**永不转 R**，维持方案一或 upstream proposal。

“替代”的唯一官方形状（已由 `dsh-app-boot` `applyEntryPatches` 与本仓库装配验证）：

```yaml
- id: <official-row-id>
  disabled: true
- insert:
    - id: <replacement-row-id>
      name: <replacement-package>
```

后层 patch 按 id 覆盖；boot 审计（`assertEntriesActivated`）与 client roster 扫描（`dsh-client-modules`）都跳过 disabled 行，因此这是官方支持、可逆、per-profile 的装配语义，**不是 patch 官方包文件**。

---

## 3. 安全不变量（所有通道共同适用）

1. **无安装即无效果**：未安装的包不得产生任何运行时影响。
2. **可逆**：安装/卸载后必须恢复官方原始装配；`dsh plugin remove` 后官方行自动恢复。
3. **不伤害旁路**：不得破坏其他插件，包括走 unsupported escape hatch（直接 `import` / `ctx.get` 官方包）的调用者。
4. **升级可见**：官方升级导致契约失效时必须被检测并 fail-safe（安全停用/明确提示），绝不静默错跑。
5. **副作用有证明**：超出声明 API 的副作用必须有 confinement proof，无法证明的必须拒绝实现。

---

## 4. R 类硬性规则

R1. **只走官方 patch 机制**：禁用官方行 + 插入替代行；绝不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 或任何官方包文件。
R2. **替代单位是整行，管理单位是官方组件插件包**：替代行必须完整提供被替代行的 ctx 服务面与事件面契约（含时序与 payload 形状），在此基础上才能增加接口；一个 replacement 包可以替换同一官方组件插件包内的多个行，并承载该组件范围内的多个相关 feature。一个 feature 也可由分属不同官方组件的多个 replacement 包协同实现，须在 feature-list.md §3.1 报备登记，且每个 replacement 包仍只归属唯一官方组件。
R3. **包 import 面明确不覆盖**：R 类只替换 `ctx` 服务/事件面；第三方 `import '@deepseek-ai/dsh-*'` 仍解析到官方原包。任何 R 类文档必须显式声明此边界。
R4. **boot 自检（强制）**：替代包必须在 apply 内断言“官方行已 disabled、替代行已 active、关键契约可用”；失败 = fail-safe（记录日志 + 正常 return），绝不静默双跑。
R5. **版本锁定**：替代包固定其支持的 runtime 全量版本与被替代官方包的 identity；不匹配时安全停用或显式报错，不做尽力而为的猜测。
R6. **组件唯一 owner**：一个官方组件插件包最多允许一个 replacement owner；该 owner 可管理该包内多个官方行。替代包必须检测组件级 owner 冲突、未禁用的目标行和重复插入，并 fail-safe。
R7. **client 面自建构建**：带 client 半面的 R 类必须自行维护 bundle 构建、验证 `window.__DSH_BOOT__` 装配与 HMR 行为；不得手改官方已发布 bundle。
R8. **不覆盖 boot 胶水与框架级语义**：`dsh-app-boot`、launcher 与 Cordis 派发机制（priority/deepFreeze/fault containment 等横切语义）不适用 R 类；这些继续走方案一或 upstream proposal，极端情况走 §8 的运维例外。

新增 R 类必须走 spec coding Stage 0–4；Stage 1 的 requirements 必须逐条对照 R1–R8 写出可测试验收。普通 A 类直通不要求完整 R 证明；B/C 设计只需记录来源、公开边界、失败行为和组件归属，除非其风险触发更高等级的证据要求。

### 4.1 组件边界与 facade 组合

- 一个 replacement 包只能对应一个官方组件插件包；跨多个官方组件包实现的 feature 须在 feature-list.md §3.1 报备登记，其每个 replacement 包仍只归属唯一官方组件。
- 一个 feature 可由一个 replacement 包承载，也可由分属不同官方组件的多个 replacement 包协同承载（须报备登记）；一个 replacement 包可以承载同一官方组件范围内的多个 feature。
- 一个 feature 可以同时包含 facade translation 与一个或多个 R capability slice；每个 R slice 仍必须归属于唯一官方组件包。
- facade 可以组合多个官方组件的公开能力，也可以与跨组件 R 能力组合为同一 feature。
- 每个 replacement 包必须登记其承载能力的 upstream proposal 与退役条件；官方提供等价公开 seam 后该包进入 deprecation。

---

## 5. 当前已交付的 replacement 装配

下表是当前 `packages/` 下已交付 replacement bundle 的装配事实（禁用行 id、替代行 id、目标官方组件包）。每个包的详细契约见其自身 spec 制品与 `README.md`。

| 替代行 id | replacement 包 | 被禁用官方行 id | 目标官方组件包 | client 半面 |
|---|---|---|---|---|
| `plugin-api-compaction-events` | `@deepseek-ai/dsh-plugin-api-compaction-events` | `compaction-basic` | `@deepseek-ai/dsh-compaction-basic` | 无（host-only） |
| `plugin-api-session-title` | `@deepseek-ai/dsh-plugin-api-session-title` | `session-title` | `@deepseek-ai/dsh-session-title` | 无（host-only） |
| `plugin-api-mcp` | `@deepseek-ai/dsh-plugin-api-mcp` | `mcp-client` | `@deepseek-ai/dsh-mcp-client` | 无（host-only） |
| `plugin-api-attachments` | `@deepseek-ai/dsh-plugin-api-attachments` | `attachment-local` | `@deepseek-ai/dsh-attachment-local` | 无（host-only） |
| `plugin-api-agent-loop` | `@deepseek-ai/dsh-plugin-api-agent-loop` | `agent-loop` | `@deepseek-ai/dsh-agent-loop` | 无（host-only） |
| `plugin-api-session-branch` | `@deepseek-ai/dsh-plugin-api-session-branch` | `session` | `@deepseek-ai/dsh-session` | 无（host-only） |
| `plugin-api-tool-skill` | `@deepseek-ai/dsh-plugin-api-tool-skill` | `tool-skill` | `@deepseek-ai/dsh-tool-skill` | 无（host-only） |
| `plugin-api-llm` | `@deepseek-ai/dsh-plugin-api-llm` | `llm` | `@deepseek-ai/dsh-llm` | 无（host-only） |
| `plugin-api-session-channel-connection` | `@deepseek-ai/dsh-plugin-api-session-channel-connection` | `connection` | `@deepseek-ai/dsh-client-connection` | 有（`dsh.client` manifest） |
| `plugin-api-session-channel-gateway` | `@deepseek-ai/dsh-plugin-api-session-channel-gateway` | `typert-gateway` | `@deepseek-ai/dsh-api-gateway` | 有（`dsh.client` manifest） |
| `plugin-api-workspace` | `@deepseek-ai/dsh-plugin-api-workspace` | `workspace` | `@deepseek-ai/dsh-workspace` | 无（host-only；六问全否） |
| `plugin-api-api-remotes` | `@deepseek-ai/dsh-plugin-api-api-remotes` | `api-remotes` | `@deepseek-ai/dsh-api-remotes` | 有（`dsh.client` manifest 半面复刻 + 浏览器 attention 运行时 receiver 通道） |
| `plugin-api-client-runtime` | `@deepseek-ai/dsh-plugin-api-client-runtime` | `client-runtime` | `@deepseek-ai/dsh-client-runtime` | 有（`dsh.client` manifest 半面复刻 + 浏览器 attention 运行时） |

- 全量聚合 bundle `@deepseek-ai/dsh-plugin-api-full` 持有按确定顺序装配主包行与上述全部替代行的 patch，不新增第三方 API。
- `packages/profile-manager/` 提供 profile 变更落地的配套 CLI，不是 replacement 行（其 `package.json` 没有 `dsh.bundle.patch`）。
- 门面上由 marker/版本门控的 R 类条件投影（`attachments`、`llm.adapters`、`sessions.branches`、`skills.activation`、`mcp`）只在对应替代行激活且版本一致时提供实时面，否则退化为 typed disabled 面。

---

## 6. `services.*` 官方低层直通

`services.*` 是受支持、静态白名单、runtime-shaped 的低层官方 service 适配层。它不是杂物箱，也不是默认推荐层；保持官方 service key 的一比一命名，不按人为领域再次分组。组合保证按成员登记，不能按整个 service 推断。

- 每个新增 passthrough 必须具备明确第三方用例、静态白名单、composition 分类和 authority map；不得自动吸收官方新增成员。
- 白名单与逐成员登记见公共契约 registry 的 `servicesWhitelist`；本册不复制该清单。
- 直接 `import`/`inject` 官方内部包是 **unsupported escape hatch**，与 supported-but-tiered 的 `services.*` 是两个不同概念：前者无兼容承诺，后者有版本协商与 fail-safe 保护。

### 6.1 成员分级

| 官方成员类型 | 门面处理 |
|---|---|
| 只读查询、纯计算、冻结投影 | 可以列入 pure services |
| 有稳定 owner/key/disposer 的加性注册 | 补齐调用方 owner 与 stale guard 后列入 additive |
| 多策略/transform 决策点 | 不裸透传，由领域 namespace 提供 ordered registry/reducer |
| 共享资源 mutation | 要求 coordinated authority，或移出 Composable Profile |
| singleton setter/provider slot | 由领域 registry 多路复用，或要求 exclusive claim |
| 返回 live 可写对象 | 改为只读 view/受限 handle，或明确排除 pure |
| 无法证明官方组合语义 | 保持 advanced supported passthrough，不宣传组合保证 |

若 service mutator 能绕过同仓库高层 authority，必须包装、claim 化或移出 Composable Profile；不能只靠文档提醒“谨慎使用”。

低层 service 与门面语义能力可以共存（如 `services.attachments` 与 `attachments.pipeline`），但推荐工作流不得要求第三方自行拼接多个 `services.*` 才能维持关键不变量。

### 6.2 Runtime-specific availability

某个 `services.*` 成员若因官方 runtime identity 差异无法稳定兑现：

- 保留公共 API path，不静默从公共树删除；
- 对该成员返回可识别的 `disabled/unavailable` 结果；
- 在开发者文档和 capability 状态中说明适用 runtime 条件；
- 不要求所有插件使用者预先把 runtime identity 绑定为安装前置条件，但建议使用者在使用该成员时考虑 runtime 和 availability。

这条规则只针对 runtime-specific 不稳定。它不阻止删除没有独立长期价值的成员——公共面减法决定是否值得保留，availability 决定在当前 runtime 上是否可用，两者判断必须分开。

---

## 7. Feature admission、retirement 与公共面减法

Feature admission 与 retirement 是软性评估方向，不设置可机械判定的硬门槛或量化评分。消费者数量、共享 arbiter、官方 seam 稳定性、owner/scope/lifecycle 价值和长期维护成本用于帮助维护者判断，不因单项未满足而自动批准或拒绝。

评估必须分开回答两个问题：

1. **归属判断**：该能力是否值得由门面长期拥有，是否保护真实的插件共享边界。
2. **实现通道判断**：获准进入后，应使用一等语义 API、`services.*` passthrough、upstream proposal 还是 replacement。

A/B/C/R 是实现分类，不能代替归属判断。技术上可以包装或替换，不代表门面应当长期拥有该能力。

删除公共成员的优先候选：

- 泄漏 writable live authority、裸 singleton setter、底层 registry 或未经协调的 shared mutation 的 `services.*` 成员。
- 只能复刻当前 runtime 形状、无法提供可说明稳定语义的 passthrough。
- 已有一等领域 API 覆盖的重复入口。
- 只减少少量样板、没有真实消费者或本应由单一产品插件拥有的 feature。
- 无法闭合 authority、无法给出清楚组合语义且保留为 supported API 会产生误导的成员。
- 官方等价 seam 已使 adapter 或 replacement 失去独立价值的实现。

减法只在公共领域树稳定后逐成员执行：领域树调整期间不删除成员，也不为零散删除或候选能力建立新 alias（见 `public-api-shape.md` §6）。

Retirement 规则：

- 官方 seam 已能承载现有公共语义时，优先退役 adapter 或 replacement；公共 capability 只有在 wrapper 仍提供独立稳定价值时才保留。
- capability 语义继续存在时保留 identity；能力本身退出时同步移除 identity，不保留空壳 capability。
- 每个新 feature 在对应 spec 中简短说明 admission rationale 和可预见的 retirement trigger，不建立独立治理平台。

---

## 8. 方案二（修改运行时源码）例外条件

仅当同时满足以下全部条件时，允许以**部署/运维脚本**形式存在（不是插件分发形态）：

1. 目标是 boot 胶水级 C 类，方案一/三结构上不可达；
2. 由人类逐次明确批准，不通过 `dsh plugin` 分发，不进入 `dsh-plugin-api` 的 API 承诺；
3. 脚本具备锚点校验、备份/逆补丁、升级后重放与失败回滚；
4. 每次官方升级后必须重新审计并重新应用；
5. 明确标注“与任何第三方源码补丁互不兼容”。

违反任一条件时，方案二必须被拒绝。

---

## 9. 文档同步责任

- 新增/变更 R 类：同步 `AGENTS.md` §2/§4、`docs/specs/plugin-api-features/feature-list.md` 类型标注与 U-series 登记、本文 §5 装配表。
- 上游提案落地：更新 §5 对应行，并在 feature-list 标记退役。
- 本文的任何实质修订须经人类确认（与 AGENTS.md 同级治理）。

---

## 10. 客户端半面判定（host-only 或完整 client 复制）

按序逐项判定，**任何一项命中即要求完整复制其客户端能力**：

1. 被替换的官方行是否声明 client manifest？
2. 是否注册 remote namespace？
3. 是否提供 slot 或 settings bridge？
4. 是否有 client 与 host 之间的版本协商？
5. 是否有 browser-side state 或 reconnect 语义？
6. 官方行是否拥有 client-facing event/service？

全部为否则 host-only。判定结果必须在 R 类 requirements 中记录，逐项给出证据；命中的客户端能力依 R7（client 面自建构建）落地。

---

## 11. 当前阶段的版本与运维边界

本仓库仍处于纯本地开发阶段。版本协商、runtime identity 和 replacement 自检用于尽早发现本地错配、并行开发混装和契约漂移；它们不构成社区兼容承诺，也不代表已经定义生产升级、降级、迁移窗口、长期支持或 profile 修复政策。进入社区运维阶段后，再单独补齐这些规则。
