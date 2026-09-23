# dsh-plugin-api 官方 runtime 版本迁移构想（rc.6 → 目标版本）

> **文档性质（重要）**：本文件是**特殊文档 / 构想纲领**，不是 spec 制品、不是 feature 立项、不是 Stage 0–2 产出。
> 它记录一次调研的最终结论与方案精神，供 SDK/TS 化完成后做具体细节决策时参照。
>
> **期望生命周期**：本仓库进入正式发布流程后**归档或删除**；当前入库仅为防止调研结论丢失。
>
> **本文件不改变任何版本字段，不授权任何发布、解冻或 profile 分发。** 所有版本决策仍为 `AGENTS.md` §3.2 硬停机点，须人类独立裁决。
>
> - 日期：2026-09-23
> - 方案提出：人类维护者
> - 调研与落盘：代理（依据见 §7）
> - 规范依据：`docs/standards/versioning-and-protocols.md` §2 / §3

---

## 1. 方案构想（一句话）

**在 `0.1.0-rc.6` 就地完成 SDK 产出与 TS 化，作为可复用的基础设施基线；随后解冻版本号，以「按需步进 `A`、API 未变则不动 `B/C`」的纪律逐步迁移至目标版本。**

分四段：

| 段 | 内容 |
|---|---|
| **① 基座建设** | 在 rc.6 就地产出 SDK + 完成 TS 化。此时代码库在 rc.6 上全绿，是类型化最容易的时机。 |
| **② 解冻** | 解冻全部版本号字段（`A.B.C.D`）。**逻辑上必须先于步进**——冻结状态下无法步进 `A`。 |
| **③ 步进** | 逐步迁移至目标版本。能机械步进则机械步进；遇需重构处，判定是否须步进 `B`，否则只步进 `C`，极端情况甚至不动 `B/C`（只 `A` 变化）。 |
| **④ 收束** | 抵达目标版本，进入发布前流程。 |

---

## 2. 纪律：`A` / `B` / `C` 的判定

本方案的判定纪律**就是** `versioning-and-protocols.md` §2「同一 `B`、不同 `A`」的落法，不需要新机制：

- `A` = 构建的 **runtime 绑定轴**（官方 runtime 全量 identity）。
- `B.C` = **runtime 无关的 API 世代轴**（`package.json.dsh.api` 只承载 `B.C`）。
- `<A>-<B>.<C>.<D>` 格式**原生表达**「同一 API 世代的多个 `A` 构建」。

判定规则：

| 情形 | 处置 |
|---|---|
| 仅官方组件内部演进、公共语义面不变 | **只步进 `A`**，`B.C` 不动（§2「同一 `B`、不同 `A`」） |
| 新增能力、向后兼容 | 步进 `C` |
| 公共语义被动摇、需改变已存在语义 | 判定**须步进 `B`**；或按 §2 末条改为 capability `unavailable` / 删除该 semantic API |
| 极端情况 | `B.C` 完全不动，仅 `A` 变化 |

`D` 为包本地维护号，不改变公共 API 外观，不参与上述判定。

---

## 3. 实测事实（载荷结论）

> 以下为实测数据，是本方案各项约束的依据来源（复现方式见 §7）。

### 3.1 落差规模

| 项 | 值 |
|---|---|
| 本机已安装 runtime | `0.1.0-rc.6` |
| npm `latest` / `next` | `0.1.5-rc.3` |
| npm `alpha` | `0.1.7-alpha.2`（**不建议作为发布基线**） |
| 中间已发布版本 | 11 个，**全部在 npm 可得**（步进技术上可行） |
| 上游发布节奏 | 首次发布 2026-08-10，至 2026-09-23 共约 6 周、22 个版本（2026-09-22 单日 3 版） |
| 本仓库规模 | `lib/` 76,650 行、`packages/` 69,304 行、`test/` 71,182 行 |

**节奏含义**：任何受支持版本在数日内即过期，故「支持哪些旧 `A`」不存在有原则的滚动边界（见 §6.3）。

### 3.2 耦合面：13 个 R 类替代行

本仓库经 bundle patch 禁用并替代 13 个官方行。目标版本上的存亡：

| 被禁用行 | 本仓库包 | 目标版本状态 |
|---|---|---|
| `agent-loop` | `packages/agent-loop` | 存活（owner 增 `dsh-sdk-minimal`） |
| `api-remotes` | `packages/api-remotes` | 存活 |
| `attachment-local` | `packages/attachments` | 存活 |
| `compaction-basic` | `packages/compaction-events` | 存活 |
| `connection` | `packages/session-channel-connection` | 存活 |
| `llm` | `packages/llm` | 存活（owner 增 `dsh-sdk-minimal`） |
| `mcp-client` | `packages/mcp` | profile 级行，非包级行 |
| `session` | `packages/session-branch` | 存活（owner 增 `dsh-sdk-minimal`） |
| `session-title` | `packages/session-title` | 存活（owner 增 `dsh-sdk-minimal`） |
| `tool-skill` | `packages/tool-skill` | 存活 |
| `typert-gateway` | `packages/session-channel-gateway` | 存活 |
| `workspace` | `packages/workspace` | 存活 |
| **`client-runtime`** | **`packages/client-runtime`** | **已消失** |

官方包图（包级）：61 个共同包、**0 个被移除**、新增 11 个（均为新增 profile / 工具 / 应用面，不构成门面义务）。

### 3.3 断崖：唯一的破坏性步骤

行 id 总数 131 → 169。破坏性行变更**集中在唯一一步** `0.1.1-rc.2 → 0.1.2-alpha.5`：

- **删除**：`api-gateway`、`client-runtime`、`tool-subagent-report`
- **新增**：`session-controller`、`settings-controller`、`workspace-controller`、`session-turn-outline`、`session-reference` 等 13 行
- 客户端架构由「单一 `client-runtime` + `api-gateway`」重构为「`@deepseek-ai/dsh-api-*-controller` 族 + `dsh-client-modules` + `dsh-client-ui-renderer` + `ui-*` 族」

**这是本方案唯一的确定 B 事件**（见 §4.1）。另两处被删行 `tool-str-replace-editor`、`tool-subagent-report` 经实测在 `lib/`、`packages/*/lib/`、`test/` 中**零引用**，不在 13 个替代行内，不构成额外 B 事件。

### 3.4 步进序列：10 步可压缩为 6 步

| 步骤 | +行 | −行 | 实质变化 fork 数 | 评定 |
|---|---|---|---|---|
| rc.6 → rc.7 | 0 | 0 | 1 | 实质 |
| rc.7 → rc.8 | 6 | 0 | 1 | 实质 |
| rc.8 → 0.1.1-rc.2 | 0 | 0 | 2 | 实质 |
| **0.1.1-rc.2 → 0.1.2-alpha.5** | **13** | **3** | **6** | **破坏性（B 事件）** |
| 0.1.2-alpha.5 → 0.1.2-rc.1 | 0 | 0 | 0 | **空步，可跳过** |
| 0.1.2-rc.1 → 0.1.3-alpha.2 | 3 | 1 | 4 | 破坏性（删行不涉本仓库） |
| 0.1.3-alpha.2 → 0.1.5-alpha.2 | 5 | 0 | 3 | 实质 |
| 0.1.5-alpha.2 → 0.1.5-rc.1 | 0 | 0 | 0 | **空步，可跳过** |
| 0.1.5-rc.1 → 0.1.5-rc.3 | 0 | 0 | 0 | **空步，可跳过** |

**合并空步后的最小序列（6 步）**：

```
0.1.0-rc.6 → 0.1.0-rc.7 → 0.1.0-rc.8 → 0.1.1-rc.2 → 0.1.2-alpha.5 → 0.1.3-alpha.2 → 0.1.5-rc.3
```

3 个空步（行契约与 fork 均零变化）跳过**不损失任何归因信息**。

### 3.5 「机械步进」的实测边界

**成立**：
- 3 个空步（纯底座置换）。
- 3 个全程从未实质变化的 fork：**`dsh-workspace`、`dsh-compaction-basic`、`dsh-tool-skill`** ⇒ 仅需锁与字面量更新。
- 404 处版本字面量、9 处版本锁、92 处绝对路径的簿记（前提见 §5.1）。

**不成立**（需语义复刻工作，非机械）：`dsh-llm`（5 步有变化）、`dsh-agent-loop`（3 步）、`dsh-attachment-local`（3 步）、`dsh-api-remotes`（2 步）、`dsh-api-gateway`（断崖单步 **+235%**，1905 → 6189 行）。

> **不要按「机械」给每一步做预算**：每步真实工作量在 1~6 个 fork 的语义复刻上。

---

## 4. 方案成立的关键判定

### 4.1 断崖按 §2 必然是 B 事件

`client-runtime`、`api-gateway` 的删除使本仓库客户端语义面底座消失 ⇒ 触发 §2 末条（跨 runtime 差异动摇公共 semantic API 合同 → capability absence/unavailable、提高 `B`、或删除该 semantic API）。

**故该步走不了「只步进 `C` 或不动」分支**。本方案的 B/C 判定纪律会**正确识别**这一点——这是纪律有效的证明，而非纪律失效。

### 4.2 TS 先行是实质优势（非仅顺序偏好）

代码库类型化后，**编译器即成为迁移清单**：404 处字面量、9 处锁、各 fork 的契约漂移全部变成编译错误，而非静默的运行时失败。对 217k 行、13 个 fork 的迁移，这是可得的最佳安全网。

### 4.3 解冻必须先于步进

冻结状态下无法步进 `A`，故②必须先于③。这一顺序是逻辑必需，不是偏好。

### 4.4 方案代价（已知且有界）

- **断崖处的 B 事件**：rc.6 期建立的客户端侧语义内容在断崖作废。**有界于客户端面**，非全部表面。
- **每步的测试重定基线**：`test/` 335 文件 / 71,182 行，其中 36 个文件含 rc.6 字面量；行为期望的版本敏感面可能更广。**此项可能成为每步成本的主要项，而非 fork 工作**——需由 §5.3 的探针实测。

---

## 5. 前置条件与建议细化

### 5.1 工程前置（强制，先于任何步进）

现状：`node_modules/@deepseek-ai` 是指向**全局 CLI 内嵌官方树**的软链（`-> /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`）；仓库内引用该绝对路径 **92 处**，另有 **404 处** `0.1.0-rc.6` 版本字面量与 9 个 `packages/*/lib/version.js` 锁模块。

**必须先把上述引用收敛为单一解析点 + 每版本独立安装根**。理由：

- 本方案需切换底座 **6 次**（big-bang 只需 2 次），不改则每次都要批量改 92 处。
- 独立安装根使各版本**可在同一台机器并存**、切换**可逆**、不触碰全局 CLI。

此项属 `AGENTS.md` §3.0.2 允许的**工程前置**（不改公共 API 面、不改已交付验收边界、不引入运行时依赖）。

### 5.2 建议细化：TS/SDK 的「基础设施」与「内容」分离

| 层 | 内容 | 版本相关性 |
|---|---|---|
| **基础设施** | `.d.ts` 生成、打包、类型测试、构建管线 | **版本无关**——在 rc.6 建一次，全程复用 |
| **内容** | 被类型化的表面 | 每步重新生成 |

这样断崖只强制**重新生成客户端部分的内容**，且由管线自动完成，不构成人工重做。这是使本方案严格更优的一处细化。

### 5.3 建议的首个动作：把第一步当成本探针

**不必现在承诺 6 步。** 先做 `rc.6 → rc.7`（实测最便宜的一步：0 行变化、1 个 fork 变化，`dsh-mcp-client` 633 → 808 行），完整记录实际成本构成：

- fork 复刻工时
- 测试重定基线规模（§4.4 的主要成本候选）
- 锁与字面量改动量

据此外推决定：继续 6 步走完，还是收敛为更少的跳跃。

---

## 6. 待定决策（SDK/TS 化完成后逐项裁决）

> 本节列出**尚未决策**的事项，供后续参考本文件精神作具体决策。**本文件不对任何一项作出决定。**

### 6.1 目标版本

建议 `0.1.5-rc.3`（最新 `rc`）；不建议 `0.1.7-alpha.2` 作为发布基线。此为 §3.2 硬停机点（版本与发布决策），须人类裁决。

### 6.2 断崖处的 `B` 处置方式

三条可选路径（§2 末条已给出）：capability `unavailable`、提高 `B`、或删除该 semantic API。需在断崖步到达前决定。

### 6.3 是否为旧 `A` 产出冻结构建

- §2 已给出低 `A` 构建的**合法性判据**：若能保持同一 `C` 的语义与 API 外观、仅把无法适配的能力标为 `unavailable`，则合法；**若服务该旧 `A` 需要「改变语义」而非「标记不可用」，§2 即禁止该构建**。
- §3 给出形态：构建包 `A` 纯净 ⇒ **一个 `A` 一个构建**。
- 受节奏约束（§3.1），建议形态是**为一个具名旧 `A` 产出一个冻结构建**，而非滚动维护型多 `A` 线。
- 捕获旧状态的时间窗在**底座置换之前**；置换后需复活旧环境。
- 发布属 §3.2 硬停机点。

### 6.4 A2 能力策略再审计：哪些 R 类 fork 应删除而非移植

在移植 13 个 fork **之前**，逐个对目标基座按 `AGENTS.md` §2 第 7 条重问：官方是否已原生派发该 fork 所转译的语义？若是，应**删除该 fork** 而非移植——把成本项转为对上游耦合度的永久削减。

> 本次实测**未发现**此类机会（新增官方派发点在门面现存实现中无对应物），但需在逐 fork 核对时确认。

### 6.5 新增官方派发点的纳入/不纳入判定

rc.6 → 目标版本新增 10 个官方派发点、**0 个被移除**（门面注册表无条目失效）。其中：

- **被迫项（属迁移范围）**：`api-session/activity`、`added`、`error`、`removed`、`status` —— 属新客户端 controller 族，随断崖的客户端重塑一并覆盖。
- **候选登记项（不在迁移内实现）**：`agent/assistant-stream`、`feedback/committed`、`goal/activation-changed`、`webserver/index-inject` —— 逐个形成「纳入/不纳入」书面判定并登记；纳入者各自立项走 Stage 0–4。默认姿态按 §3.0.3 应为**不纳入**。
- **核对项**：`user-questions/request` 与既有 decision-participation 的事件名映射需核对，避免重复面。

> `AGENTS.md` §3.0.2：新增能力属新 feature，立项属 milestone 决策。**迁移不得夹带新 feature。**

### 6.6 行多 owner 语义验证

目标版本有 **46 个行 id 由超过一个官方包定义**，其中包含本仓库逐个禁用的 `llm`、`session`、`agent-loop`、`session-title`、`compaction-basic`、`tool-skill`（均为 `dsh-base` + `dsh-sdk-minimal` 双 owner），`system-prompt` 有 6 个 owner。

需按 composition 实测验证 `disabled: true` 的语义（是否覆盖全部贡献者；`sdk-minimal` / `sdk-app` / `acp-app` profile 下该行是否可见）。**此为未验证项，不得假设。**

### 6.7 `mcp-client` 行基准

该行非包级行，需按目标 profile 的组成确认其存在性与禁用可行性。

### 6.8 客户端 module id 契约

`lib/client-official-passthrough.js` 以 `moduleId: '@deepseek-ai/dsh-client-runtime'` 透传，而该包已停止发布（止于 `0.1.1-rc.2`）。需确认目标侧替代 module id。

---

## 7. 证据与复现

本文件各项实测结论的原始数据采集于 2026-09-23，采集产物置于 `temp/upstream-diff/`（`temp/` 为 gitignored 临时目录，**不入库、用毕即删**）：

| 产物 | 内容 |
|---|---|
| `rows.json` | 两版本全量「行 id → owner 包」映射 |
| `timeline.json` | 11 个版本的逐版行集 |
| `perstep.json` | 11 个被替代包在 10 个版本上的 LOC |
| `events.json` / `repo_events.json` | 官方派发点与门面注册表事件名 |
| `newtree/` | 官方 `0.1.5-rc.3` 完整依赖树（241 包） |
| `client-*.tgz`、`v-*`、`timeline/`、`perstep/` | 双版本与逐版本解包 |

复现方式：以 `npm view` / `npm pack` 取官方 tarball，解析各包 `cordis.patch.yml` 的 `- id:` 得到行清单，与本地已安装 rc.6 树（`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`）对比。

**本文件已内嵌全部载荷结论**，故上述临时产物删除后本文件仍自洽。

---

## 8. 治理边界（重申）

- 本文件**不是** feature 立项，**不进入** `docs/specs/` 制品体系，**不登记**于 `docs/specs/plugin-api-features/feature-list.md`。
- 本文件**不改变**任何版本字段，**不授权**解冻、发布或 profile 分发。
- 版本与发布决策、milestone 范围增减均为 `AGENTS.md` §3.2 **硬停机点**，须人类独立、明确裁决。
- 后续 SDK/TS 化完成后，本文件的 §6 待定决策应逐项裁决，其结论再按现行 spec coding 工作流落为正式制品。
- 本仓库进入正式发布流程后，本文件**归档或删除**。
