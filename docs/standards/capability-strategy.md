# 能力上限策略（capability strategy）

> 状态：由人类直接指示修订（采纳“方案一 + 方案三”双通道）。
> 本文与 `AGENTS.md` §2 / §4 共同构成 A/B/C/R 分类与能力上限决策的权威依据；两者冲突时以 `AGENTS.md` 铁律为准。
> 配套登记：`docs/specs/plugin-api-features/feature-list.md`。
>
> **维护修订（包政策推行）**：R 类辅助包与主包采用同一全量唯一版本规则（`<runtime全量版本>-<API协议大版本.迭代小版本>`，`dsh.api` 仅承载协议版本），主包校验辅助包版本一致；不一致时**只停用该辅助包对应的 R 类特性**（替代行仍提供官方原接口，新增事件/策略面不发布），不得停用主包或其他能力。R 类运行时命名不得携带治理后缀（如 `r1`、分类字母、需求编号）：已交付辅助包现行名为 `packages/compaction-events/`（row `plugin-api-compaction-events`）与 `packages/session-title/`（row `plugin-api-session-title`）。安装模式为全量聚合 bundle `@deepseek-ai/dsh-plugin-api-full`（确定性 patch 装配）或选择性安装主包 + 所需辅助包。

---

## 1. 已定结论

1. **双通道**：方案一（门面转译，facade translation）继续作为默认能力通道；方案三（replacement bundle，禁用官方行 + 插入替代行）成为经批准的补充通道。
2. **方案二不作为插件分发通道**：直接修改官方运行时源码只在部署/运维层例外使用，且不受 `dsh.api` 版本承诺（见 §7）。
3. **B 类迁移判据**：
   - 低/中工作量且高价值 → 优先转 R 类（方案三）；
   - 高工作量 → 维持方案一门面转译；
   - 横切/框架级派发语义 → 永不转 R，维持方案一或上游提案。

---

## 2. 术语

| 类型 | 含义 | 通道 |
|---|---|---|
| A 类 | 官方已 dispatch / 已提供服务，只需稳定化 | 方案一（门面直通，不转 R） |
| B 类 | 官方没有 dispatch 点，只能用底层钩子模拟 | 按 §5 矩阵：低/中工作量且高价值 → R；否则维持方案一 |
| C 类 | 不改官方做不到 | 默认只写 upstream proposal；经批准且缺陷落在单一官方行内的可评估 R 类 |
| **R 类（替换类）** | 缺失语义天然属于某个**官方 loader 行**，由 replacement bundle 经官方 patch 机制禁用该行并插入替代行 | 方案三 |

“替代”的唯一官方形状（已由 `dsh-app-boot` `applyEntryPatches` 与本仓库实验验证）：

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
R2. **替代单位是整行/整包**：替代行必须完整提供被替代行的 ctx 服务面与事件面契约（含时序与 payload 形状），在此基础上才能增加接口。
R3. **包 import 面明确不覆盖**：R 类只替换 `ctx` 服务/事件面；第三方 `import '@deepseek-ai/dsh-*'` 仍解析到官方原包。任何 R 类文档必须显式声明此边界。
R4. **boot 自检（强制）**：替代包必须在 apply 内断言“官方行已 disabled、替代行已 active、关键契约可用”；失败 = fail-safe（记录日志 + 正常 return），绝不静默双跑。
R5. **版本锁定**：替代包固定其支持的 runtime 全量版本与被替代官方包的 identity；不匹配时安全停用或显式报错，不做尽力而为的猜测。
R6. **同行唯一 owner**：同一官方行只允许一个经登记的替代 owner；替代包必须检测同行冲突（另一个替代者/官方行未禁用）并 fail-safe。
R7. **上游提案与退役**：每个 R 类都必须登记一条 U-series upstream proposal 与明确退役条件（官方 seam 落地后删除 fork）。
R8. **client 面自建构建**：client R 类必须自行维护 bundle 构建、验证 `window.__DSH_BOOT__` 装配与 HMR 行为；不得手改官方已发布 bundle。
R9. **不覆盖 boot 胶水与框架级语义**：`dsh-app-boot`、launcher 与 Cordis 派发机制（priority/deepFreeze/fault containment 等横切语义）不适用 R 类；这些继续走方案一或上游提案，极端情况走 §7 的运维例外。

新增 R 类必须走 spec coding Stage 0–4；Stage 1 的 requirements 必须逐条对照 R1–R9 写出可测试验收。

---

## 5. 当前 B 类迁移矩阵

> 工作量按“被 fork 官方行/包体量与构建面”评估；价值按“保真度收益 + 能否连带解锁 C 类 + 调用者覆盖”评估。

| B 类 | 现转译基座 | 拟 fork 行 | 工作量 | 价值 | 决策 |
|---|---|---|---|---|---|
| L4 同步 `llm/request` | `llm/stream` 重入 + marker + 收敛 | `llm`（`dsh-llm`，宿主面 1407 行） | 高 | 高（可连带 L5/U2） | **维持方案一**，待 fork 经济性变化后重估 |
| L2 图片准入 | 包装 `apiProxy.sessions` + `llm.resolveModelInfo`（ALS confinement） | `llm` + `api-gateway`（`dsh-host-apiproxy` 5648 行，且 headless 无 `api-gateway` 行） | 很高 | 高 | **维持方案一** |
| A9/T10 `exec.route` | `tools/pre-execute` prepend + `session.requestContext()` 快照 | `tools`（3570 行）；完整 prepared-route 还需 `agent-loop`/`agent` 协同 | 高 | 高 | **维持方案一** |
| S2 session 上屏 helper | 门面校验后调官方 `Session.append` | `session`（`dsh-session` 1886 行，核心域） | 高 | 高 | **维持方案一** |
| ST4 host 设置 remote 桥 | 自建 `bindTypertRemote` 等价实现 | `typert-gateway`（396 行）或 typert 相关行 | 中 | 中 | **R 类观察项**，不排期 |
| ST5/ST6/C2（+C7） client remote/codec/mount | `$mount` 自挂载 + 手搓 codec | `api-remotes`（client bundle 5900+ 行，需自建构建） | 高 | 高（C7） | **维持方案一**；C7 维持 upstream proposal |
| E8 priority / E9 deepFreeze / E11 fault containment | facade 注册侧/派发侧统一实现 | 无单一官方行（跨所有事件生产者；`@deepseek-ai/cordis` 不是 loader 行） | — | — | **永不转 R**，维持方案一或 Cordis 上游提案 |
| U8 `compaction/*` 事件词汇 | `CompactionEngine.summarize()` 子类钩子 | `compaction-basic`（962 行） | 低–中 | 高 | **已交付**：R1 辅助包 `@deepseek-ai/dsh-plugin-api-compaction-events`（`plugin-api-compaction-events-r1`）作为 current workaround；U8 保留为上游提案（见 feature-list §3） |
| U9 `session-title/candidate` 候选资格 / 合成消息排除 | 官方 `session-title` 的 fallback + first-prompt provider 直接消费 `source.kind:'user'`，无候选资格 dispatch 点 | `session-title`（`dsh-session-title`，580 行） | 低–中 | 高 | **已交付**：R1 辅助包 `@deepseek-ai/dsh-plugin-api-session-title`（`plugin-api-session-title-r1`）作为 current workaround（fallback 与 first-prompt provider 在统一候选资格策略下消费同一候选集）；U9 保留为上游提案（见 feature-list §3） |

重估条件（允许已判“维持方案一”的条目回到 R 评估）：官方把对应包拆小/提供 src 构建流水线；出现第二个插件对同一语义的独立需求；或官方升级使门面转译的收敛证明不再成立。

---

## 6. 首批 R 类候选与执行边界

- **候选 1：U8 `compaction/*` 事件词汇 —— 已交付**：fork `compaction-basic` 行，在保留官方 `compaction` 服务契约的前提下增加压缩事件 dispatch，经 `plugin-api-compaction-events-r1` 落地（含 R1–R9 的 requirements/design：boot 自检、版本锁定、同行冲突检测、上游提案 U8 的退役条件）。U8 仍保留为上游提案，replacement 为 current workaround；官方提供等价词汇后辅助包进入 deprecation。
- **观察项：ST4 settings remote 原生绑定** —— 价值中等，仅在其他理由已 fork typert 相关行时合并评估，不单独立项。

其余 B 类维持方案一门面转译；`E8/E9/E11` 明确禁止 R 化。

---

## 7. 方案二（修改运行时源码）例外条件

仅当同时满足以下全部条件时，允许以**部署/运维脚本**形式存在（不是插件分发形态）：

1. 目标是 boot 胶水级 C 类（典型：U4 插件 boot 故障隔离），方案一/三结构上不可达；
2. 由人类逐次明确批准，不通过 `dsh plugin` 分发，不进入 `dsh-plugin-api` 的 API 承诺；
3. 脚本具备锚点校验、备份/逆补丁、升级后重放与失败回滚；
4. 每次官方升级后必须重新审计并重新应用；
5. 明确标注“与任何第三方源码补丁互不兼容”。

违反任一条件时，方案二方案必须被拒绝。

---

## 8. 文档同步责任

- 新增/变更 R 类：同步 `AGENTS.md` §2/§4、`docs/specs/plugin-api-features/feature-list.md` 类型标注与 U-series 登记、本文 §5 矩阵。
- 上游提案落地：从本文移除对应 R 类候选，并在 feature-list 标记退役。
- 本文的任何实质修订须经人类确认（与 AGENTS.md 同级治理）。

---

## 9. R 辅助包边界（每替换一个官方行 = 一个独立辅助包）

> 综合 Stage 0 共同问题 NO.6（2026-08-21 确认）。

- **每个 R 能力一个独立辅助包**：每替换一个官方包/行就对应一个独立辅助包，命名 `@deepseek-ai/dsh-plugin-api-<domain>`（如 MCP → `@deepseek-ai/dsh-plugin-api-mcp`、session branch → `@deepseek-ai/dsh-plugin-api-session-branch`、attachments → `@deepseek-ai/dsh-plugin-api-attachments`）；不得把一个辅助包塞进多个替换行。
- 沿用现有 full/selection install 模式与统一版本协商（见文首"维护修订"条）；辅助包与主包版本不一致时只停用该 R 特性。

## 10. 客户端半面判定（host-only 或完整 client 复制）

> 综合 Stage 0 共同问题 NO.7（2026-08-21 确认）。按序逐项判定，**任何一项命中即要求完整复制其客户端能力**：

1. 被替换的官方行是否声明 client manifest？
2. 是否注册 remote namespace？
3. 是否提供 slot 或 settings bridge？
4. 是否有 client 与 host 之间的版本协商？
5. 是否有 browser-side state 或 reconnect 语义？
6. 官方行是否拥有 client-facing event/service？

全部为否则 host-only。判定结果必须在 R 类 requirements 中记录，逐项给出证据；命中的客户端能力依 R8（client 面自建构建）落地。
