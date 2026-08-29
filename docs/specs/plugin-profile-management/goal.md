# Stage 0 - Goal

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.profile` | `pluginApi.profiles` |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

## Feature Name

`plugin-profile-management`

## Status

SPEC1 Stage 0：**Goal 已获用户批准**（M6 第五批次确认门）。结构性决策全部经对话确认：授权模型（无审批无开关）、交互形态（句柄仅限快捷写与手动 validate）、惰性物化 + 全局缓存、runtime 视图方案、快捷写强制 L1+L2、配额 256MB/1GB 与判孤即删、L2 判定语义（mock 优先）。**上游提案明确排除在本 spec 之外——该工作线整体归 M-final，本 spec 零涉及。**

## Background and Channel Verdict（立项前审计结论）

本 feature 源自启发式候选池 #20（Plugin/profile management contract）。原提案通道判断为"R 或 C"，立项前经对本机官方安装与 profile 结构的实地审计，收敛为如下结论：

1. **R 类不可行（审计关闭）**：官方约 190 个组件包中不存在 plugin/profile manager 组件行；最近的官方面（`dsh-host-plugin-inventory`、`dsh-client-ui-settings-plugin-inventory`）均为只读投影。profile 增删改语义由启动器/CLI 层拥有（`dsh plugin add` 即向 profile 目录转发 pnpm），不在行清单内——没有可替代的 owner 行，也没有可复刻的 ctx 服务面/事件面。
2. **进程内写逻辑不可行**：让运行中的插件代码直接实现 profile 写入存在自指问题、写坏即炸下次 boot、与 CLI 并发无锁。结论不是"门面不能有写动词"，而是**写入逻辑必须唯一实现于进程外执行器**——进程内 API 只能是其安全遥控器，管线三性质（先验证后落盘、CAS 防并发、原子替换无半写态）承担全部安全保障。
3. **实证的 profile 结构**：`$DSH_HOME/profiles/<name>/` 下 `cordis.yml` 为恒空根清单；真实组合是分层折叠——`package.json` 的 `dsh.profile.bundles` 有序列表 → `cordis.patch.yml`（允许 `!!js` 表达式）→ `--patch` 叠加；每个 profile 是独立 pnpm workspace；app 只是 bundles 列表中的一个包（web 档含 `dsh-web-app`，headless 档含 `dsh-headless`，共享 `dsh-base` 核心层）。核心运行时树（~190 包，30 MB）住全局安装、由启动器引用，profile 只装用户插件依赖。
4. **可用官方原语**：`--dump-config`（组合树打印、零副作用）、`DSH_HOME` 被 `dsh-home-paths` 尊重（快照全封闭启动）、headless one-shot 走用户默认模型（settings namespace `agent-default-model`），一次最小回合 LLM 调用成本已确认可接受。

## Goal

为第三方插件提供完整的 **host profile management 契约**：读侧统一三种视图的投影，写侧提供以"先验证后落盘"为核心的双模式变更管线，把各 UI 插件手工解析 profile、"安装后听天由命重启"的现状收敛为一个规范化读写闭环。

### 读侧：三视图投影

| 视图 | 数据源 | 语义 |
|---|---|---|
| **runtime** | 本插件 boot-init 时点捕获 | 本次 boot 实际加载态；按构造权威（从 boot 内部拍摄），且因行序规则先于第三方插件 apply，捕获的是未被干扰的组合基线 |
| **disk** | 当前 profile 的落盘文件 | "下一次重启时"的真实状态，写入面的作用对象 |
| **other** | 任意其他 profile 目录 | 纯 fs 只读读取，与 disk 共享同一折叠解析器 |

- `inspect` 返回 resolved rows（每行带来源 bundle identity）+ 包 identity/版本/依赖图；`health` 做 duplicate row id、缺包、row/package 错配、版本一致性检测；`planDiff` 对变更意图做 dry-run 计算。
- runtime 视图取不到的字段如实标 `unavailable`、绝不伪造（design 阶段核实 init 时点经公开 seam 的可见范围）；它是 **boot 时点快照，非实时 registry 镜像**。
- 跨视图对比（如内存 vs 磁盘差值）由消费方组合两次 inspect 自行完成，不设专用动词（克制）。

### 写侧：双模式变更管线

执行形态：独立 companion CLI 随本仓交付（非 `pluginApi` 命名空间成员），全程进程外；门面提供 JS 封装的遥控接口，前提是与 CLI 完成版本握手确认可用，不可用时写动词显式 typed 降级、读侧不受影响。

1. **快捷写**：调用方一次性传入操作意图，管线自动走完整 prepare → validate(L1+L2 全跑) → commit；校验通过即落盘，失败则真实 profile 从未被触碰。
2. **手动快照管理**：
   - `create`：从 runtime 或从磁盘 profile 创建快照；
   - `modify`：在快照上无校验地任意修改；
   - `validate`：对快照按需跑校验门（L1/L2 可选档）；
   - `apply`：将快照应用至磁盘 profile——**硬性前置：该快照最后一次修改后通过了校验门**（clean/dirty/validated 状态机）；
   - `delete`：仅能删除本插件自己创建的快照。

仅**长时操作**返回操作句柄（稳定 id），进度经事件/轮询获取、commit 前可取消——属于此类的只有两种：**快捷写**（自动串联完整管线）与手动模式下的 **`validate`**（涉及依赖安装与封闭 boot smoke，可达数十秒）。其余快照管理操作为近乎瞬时的原子步骤，直接返回 typed 结果：`create` 为配置复制 + 硬链接克隆；`modify` 为快照内文件编辑；`delete` 为所有权校验后的目录移除；`apply` 含真实 profile 的快速依赖对账（pnpm store 已被 validate 阶段焐热，通常秒级）→ 配置原子替换 → 备份轮换，成功附带 restart-required 明示，任一步失败即整体中止且真实 profile 保持原状。

## Safe Write Pipeline（校验门内部设计）

```text
prepare      配置类变更：生成候选 patch overlay（零克隆）
             依赖类变更：克隆目录 + pnpm install（惰性物化：node_modules 在 validate 时才安装）
validate L1  --dump-config：结构健康（YAML 可析、fold 无冲突、id 无重复）
validate L2  DSH_HOME=<tmp> 封闭 boot smoke：全部行真的能 apply；
             判定对象是「boot 与行 apply」而非「推理成功」——LLM 调用仅为驱动
             agent loop 达到稳态的手段，provider 层失败不得否决校验：
             首选=快照内注入测试专用 mock LLM 行（随执行器交付、仅存在于一次性
             验证环境）：零成本、零网络、无需播种真实凭据，退出码即干净的
             boot 健康信号；
             兜底=mock 不可用时退回真实模型调用，provider 层失败（欠费/鉴权/
             限流/网络等发生于 boot 完成之后）记为 caveat 放行并写入报告，
             boot 阶段崩溃一律阻断；
             端口经 overlay 钉住避免与生产实例冲突；
             手动镜像 boot 作为高危变更的人工档
客户端半身    机械校验：error=语法/import 边界/d.client 清单一致性（阻断），
             warning=危险 sink 启发式（不阻断）
commit       基线 hash CAS（prepare 后真实 profile 被并发修改则拒绝并要求 rebase）
             + 原子替换（官方 dsh-atomic-write 同款范式）+ 备份保留 N 份
rollback     备份即修复来源；repair 仅执行显式批准的动作
```

配套交付：面向第三方开发者的 client 半身威胁模型清单（浏览器不可信环境 / XSS 即 Agent 权限提升 / 永不信任 client 侧输入 / 展示遵守 redaction 包络），由校验 warning 词汇与开发者文档共同承载；`visibility-and-redaction.md` 分册增补 client 受众章节。

## Storage Governance（缓存、配额与 GC）

实测基础：配置层 28–32 KB；用户插件依赖 0.7–4.6 MB/档；核心运行时全局共享、零复制；故单个 L2 快照典型 1–10 MB、重度最坏 ~50 MB。

- **全局 seed 缓存**：首次快捷写时以硬链接克隆当前 profile 的 node_modules 创建（系统级单例）；后续快照自缓存硬链接克隆（增量≈0），依赖变更由 pnpm 在快照内对账；源依赖指纹变化时原子重建。不计入插件配额。
- **配额**：单插件默认 **256 MB**、全局默认 **1 GB**（settings 可调）；计量为快照目录表观字节；超限拒绝新的创建/修改，**绝不自动删除未成孤儿的数据腾地**。
- **GC**：所有权随快照持久化（owner = 创建时绑定的插件包身份）；boot-init 扫描时判定孤儿（owner 同时不在内存视图与目标 profile 声明依赖中，或目标 profile 已不存在），判孤即删。明示取舍：卸载→重装循环丢失快照，接受（重建成本为一次惰性物化）。

## Security Stance（信任模型假设，已获用户批准）

本 feature 的安全边界假设 = **已加载插件与宿主同等可信（与 DSH 插件体系现状一致）**。恶意插件本就拥有 fs/subprocess 级的等效侵入能力，profile 写权限门对其无意义。因此：**不设逐操作审批、不设 settings 写开关**；代之以三件套——① 校验管线本体防事故，② 审计日志（谁/何时/改了什么/结果）供归因取证，③ restart-required 让重启前可见待生效变更。将来若官方对插件宿主引入沙箱，此假设须重审并在 requirements 层重新提出授权模型。

## Batch Order and Dependencies

M6 第五批次唯一 feature（单线批次）。与第四批三个 feature 已核实零耦合，可完全并行推进。衔接方式：健康判定的版本一致性词汇与 constitution §4 同源但只读呈现；v2 方向（非本批验收）：plugin-diagnostics active 集合与本面磁盘态声明的对照差值视图。本 spec 与任何上游工作无依赖关系。

## Scope Boundary

- 包含：
  - `pluginApi.profile`（暂定名）只读动词集 `inspect` / `health` / `planDiff` 及三视图参数化；
  - 写动词集快捷写 `apply` 与快照管理 `create/modify/validate/apply/delete`（JS 遥控封装，实际逻辑在执行器）；
  - 进程外 companion 执行器（CLI）及 canary 管线全阶段；
  - 双面共用的容错折叠解析器（unknown 字段保留、不可折叠层显式标注、格式耦合单点翻译模块）；
  - 存储治理三件（seed 缓存 / 配额 / GC）与审计日志；
  - client 半身威胁模型清单文档与 warning 词汇。
- 门面结果一律 typed 值；任何解析失败 fail-open 显式降级，绝不抛穿 apply、绝不影响宿主 boot（G1 纪律）；输出遵循可见性脱敏纪律。
- 不包含：
  - 进程内写入逻辑（不变量：写入逻辑唯一实现在执行器，门面只做遥控）；
  - 替代任何官方组件行（R 通道审计关闭）；
  - 浏览器半身运行时行为验证（机械校验止步包层）；
  - 自动重启编排、多 profile 批量管理、实时 registry 镜像、跨视图专用 diff 动词；
  - **上游提案（`--boot-check` 启动验证模式、组合规则契约文档化）——整体归 M-final 工作线，本 spec 零涉及。**

## Upstream Proposal Exclusion（用户明示）

上游提案——含 `--boot-check` 类启动验证模式请求与 profile 组合规则的文档化契约——**完全不属于本 spec**：既非交付物，也不随本 feature 登记 U-series 编号或退役条件；该工作线整体归 M-final。本 spec 内 L2 的验证手段即「mock 行优先 + headless one-shot 兜底」的现实实现，不预设、不等待、不引用任何上游承诺。

## Classification

双面混合交付：读侧投影面为 B 类家族边缘形态（纯 fs 投影公开磁盘状态，无 dispatch 点、无需事件钩子；判定随 requirements 对照 capability-strategy 归档）；进程外执行器为生态基础设施工具，不占 A/B/C/R 分类学通道，不 patch 官方文件，只写用户自有 `$DSH_HOME` 区域，操作级别与官方 pnpm 转发同级。requirements/design 对照分册预期：capability-strategy（通道归档）、api-shape、visibility-and-redaction（含 client 受众增补）、identity-and-lifecycle（feature identity、快照所有权与备份代次）、durable-state-and-scope（快照/备份/审计的持久化与作用域）、concurrency-and-cancellation（CAS 冲突路径、句柄取消语义、CLI 与宿主生命周期解耦）。

## Risks and Constraints

- **格式负债**：组合规则无稳定契约；缓解=容错解析 + 显式降级 + 单点翻译模块，如实记账；
- **保真边界**：静态折叠还原不了 `!!js` 求值结果；L2 覆盖不到浏览器半身运行时；runtime 视图受 init 时点可见性限制；
- **执行器风险**：subprocess/pnpm 失败模式、端口冲突、L2 mock 行与 runtime 版本 llm 契约的同步锁定（防验证器自身腐化）、兜底路径下 provider 层失败的分类判定、CAS 冲突 rebase、宿主退出时在途操作的处置策略，均需测试任务覆盖；commit 必须原子；
- **所有权绑定**：快照 owner 身份的绑定机制须防调用方谎报（design 阶段定绑定层级）；
- **过度设计红线**：不做审批/开关、自动重启编排、多 profile 批量、浏览器运行时模拟、实时镜像、跨视图专用 diff 动词；v2 差值视图未经批准不得纳入验收。

## Expected Result

Web/UI 类第三方插件获得完整契约：一条 `inspect` 在三种视图间自由取数（本次 boot 加载态 / 待生效磁盘态 / 任意其他 profile），`health` 出结构化体检报告，`planDiff` 落盘前预览；需要变更时在 JS 里直接发起快捷写或手动经营快照，每次写入先在封闭快照中被证实能健康 boot，提交有 CAS 保护、原子替换、可回滚备份与审计记录。解析失败门面显式 unavailable 而宿主照常 boot；写入失败真实 profile 从未被触碰；存储有配额护栏、孤儿有 GC 归宿。本仓库 bundle 家族是第一个真实用户。
