# Design: plugin-api-repo-normalization

> feature_name: `plugin-api-repo-normalization`
> 状态：Stage 2 已获当前授权（修订稿；前置门批准）
> 上游：Stage 0 Goal；Requirements 修订稿已获当前授权并作为本设计的确认上游。2026-08-21 仅为历史审计快照，执行阶段必须复核当前工作树。
> 类型：治理/工程规范化（无第三方可见 API 新增）

---

## 1. Overview

本 feature 在一个审计周期内完成「审计 → 登记 → 分批复核」。仓库当前仍是纯本地开发阶段，没有社区运维或外部兼容承诺；版本协商相关内容只做现状核对和记录，不把设想写成已运维政策。

执行链路：

```text
快照审计（静态扫描 + 官方包核验 + 版本核验）
  → 登记文件（报告 + 全部登记表）
  → 分批复核（按域，每批一个获批顶层任务）
  → 复审（重跑扫描 + 全量测试 + diff --check）存量项零未决
```

2026-08-21 的 main（治理迁移合并前：旧路径 ×9、AGENTS.md §8 旧形态、feature-list §7 缺失）只是历史审计 base。它的发现项单独呈列为历史迁移项；本次执行以当前仓库内容重新复核，并把当前复核新增或仍存在的范围内项目纳入存量项判定。

执行时不直接沿用该历史结论，而是以当前仓库内容重新复核。已随治理迁移消失的项目记录为“历史迁移项已关闭”；当前仍存在且属于本 feature 范围的项目才进入修复批次。

## 2. Architecture

本 feature 不增加运行时组件。架构由三个离线部分组成：扫描器/人工核验输入、`execution/` 下的结构化登记文件、按批次执行的最小修复。登记文件是本 feature 的审计事实源；标准分册与官方包源码是规范和外部证据源；实现代码只在明确发现且可保持行为不变时修改。

### 2.1 审计协议

#### 2.1.1 静态扫描清单（可按 X 机械执行、需人工判定处显式标注）

| # | 检查 | 方法 | 输出 |
|---|---|---|---|
| S1 | 治理编号残留（实现代码） | 扫描 `lib/`、`packages/`、`test/`、`scripts/`、`package.json`、bundle patch、文件名/路径、注释、标识符、测试描述和字符串字面量；每条规则记录规则版本、命令、排除项及理由。仅排除明确登记的非治理术语/测试构造所需片段；不得以“固定 token 清单”代替覆盖声明 | 命中表 + 豁免白名单 + 扫描规则摘要 |
| S2 | 旧路径/旧登记指向 | `docs/capability-strategy.md` 全仓 md 扫描；AGENTS.md §8 形态；feature-list §7 存在性 | 迁移项表（随治理合并消失）与存量项表 |
| S3 | scope 归属清单 | 可持久化/有状态 API 清点（Requirements A2.1 三类） | scope 归属表 |
| S4 | mutation 能力声明 | appendMessage / remote.publish / settings.remote.set 的既有约束清理（含 remote-publication 同键异引用 typed error）；retry 现状明示（A2.3） | 能力声明表 + 待声明缺口 |
| S5 | 词汇、身份与世代登记 | ① transaction / epoch / R 包事件词汇与统一终态五词汇逐类对照（含 settled/closed 混用点：lib/llm-request.js:322、lib/llm-admission-gateway.js:205、lib/session-durable-feature.js:186-200）；② A1.1 前向结论登记（executionId 由 plugin-api 生成）与 A1.2 结论登记（generation 用 owner-specific opaque token + owner-local revision、无跨 owner 比较） | 词汇映射表 + 身份/世代结论表 |
| S6 | namespace 三面图 | 建立 feature inventory → state-space owner → namespace 的映射，记录投影/策略/变更、直通豁免和基础设施豁免 | feature/state-space 主表 + namespace 汇总图 |
| S7 | smell 判据 | 以 feature/shared state-space owner 为单位运行三条判据，再生成 namespace 汇总；逐项记录 register/query/mutate 证据和豁免 | 零命中/命中项 + 豁免论证 |
| S8 | R 类边界与六步判定 | 官方包检查（dsh-compaction-basic / dsh-session-title 的 dsh.client、exports、运行时代码）；核对每个 replacement package 只归属一个官方组件、每个组件只有一个 owner、每个 feature 最多依赖一个 replacement package（A4.1） | 六步判定记录表（含组件 owner/package 边界列） |
| S9 | 版本核验 | 解析当前实际安装路径和 package metadata，记录四包 version/dsh.api、runtime 全量 identity、官方组件 identity、解析路径和包/hash 证据 | 版本核验表 |
| S10 | 可见性现状 | 按模型/UI/log/debug 四类输出面逐项核对 secret 默认禁止、插件申请提升、user/profile 全局禁止、非 secret 自主开放、来源/时间/不确定性，以及嵌套/二进制/cause/MCP resource 脱敏覆盖 | 可见性逐输出面登记表 |
| S11 | 并发与取消适用性 | 建立一行一个符合条件 surface 的 inventory；逐项判定 signal 传播、父子取消、stale 提交资格、identity-safe disposer、并发策略、retry/attempt/execution 关系；普通同步直通按明确 N/A 判据记录 | 并发与取消逐 surface 登记表 |

#### 2.1.2 人工判定点与处置路径

扫描无法自动定性的命中，按两类处置，逐条写入登记文件并标注判定人与日期：

1. **注释/测试名命中**：改为中立、面向语义的表述，零行为变化（以全量测试门验证）。
2. **运行时私有标识符命中**（例如 `runL4Phase`、`_execRouteP2Diagnostics` 等内部函数名）：二选一处置——(a) 行为保持的重命名（新名称中性，自带全量测试门）；(b) 登记为「已确认技术债」并经人工确认，进入重构窗口建议（A3.3）。不得默认豁免，不得跨过复审悬置（见 §5）。

人工判定还包括：豁免白名单（C0/C1 等）、A1.4 词汇混用点定性（既有契约 vs 本次/后续引入）、A3.2 逐 namespace 豁免论证。

并发/取消的人工判定只要求与 feature 风险相称的证据。普通同步直通可记录“不适用”及调用边界；只有存在重叠、跨调用生命周期或异步提交的面，才需要完整记录取消传播、stale 资格、disposer 身份和终态裁决。该登记不等同于新增端到端验证阶段。

### 2.2 Components and Interfaces

- **扫描输入**：仓库实现、测试、spec、六册 standards、AGENTS.md，以及本机已安装官方组件包。扫描只读；失败时输出 `not-audited`，并使对应检查保持阻塞。
- **登记接口**：固定由 `execution/audit-report.md` 承载结论与所有结构化表；R 包 requirements 只回填其自身 client 六步证据指针，不复制整份报告。报告头记录审计时点、分支、commit、runtime identity、依赖锁定摘要和标准基准。
- **修复接口**：仅允许中性注释/测试名/私有标识符改写、治理登记和获批 spec 回填；不得改变公开 API、事件目录、错误分类、包版本或官方文件。
- **验证接口**：聚焦扫描、`npm test`、`git diff --check` 和全部任务完成后的整体 Luna(max) 阻塞审查。

## 3. Data Models

登记文件固定为 `docs/specs/plugin-api-repo-normalization/execution/audit-report.md`（Requirements A0.3 约束登记必须落在 feature 目录下；本设计锁定报告文件名，Tasks 只细化表格和执行步骤）。每条登记必须可验证（引文件:行号、命令/规则版本、快照身份或官方包检查结果）。报告使用 `reportSchemaVersion: 1`；下列字段是固定字段，Tasks 不得删减或以自由文本替代。

### 3.1 固定报告头与证据字段

报告头 SHALL 以键值或等价表格完整记录以下字段：

| 字段 | 必填内容 |
|---|---|
| `reportSchemaVersion` | 固定 schema 版本；schema 变更时递增 |
| `auditTime` / `branch` / `commitSha` | UTC 审计时点、审计分支、完整 commit SHA |
| `runtimeIdentity` | Node 版本/执行器 identity、DSH runtime 完整版本/identity、官方包解析根 |
| `dependencyLock` | lockfile 路径、解析模式和依赖锁定摘要；缺失或无法核实必须为阻塞状态 |
| `auditBase` | 2026-08-21 历史快照 identity、当前复核 base identity，以及历史迁移项/当前存量项分栏规则 |
| `standards` / `conclusions` | 每册标准名称、版本或 commit/digest、条款范围，以及每册至少一行 `zero-findings` 或 `findings` 结论 |

所有发现项和“零发现”结论的证据记录 SHALL 同时包含 `evidenceKind`、`commandOrSource`、`ruleVersion`（适用时）、`locationOrPackagePath` 和判定时间；不能提供任一必要证据时状态必须是阻塞状态。

六步 R 类记录和版本核验记录 SHALL 使用以下固定字段：

| 记录 | 固定字段 |
|---|---|
| R 类六步记录 | `officialComponent`、`replacementOwner`、`replacementPackage`、`replacedRows[]`、`featureReplacementDependencies[]`、官方 package metadata（至少 name/version/exports/`dsh.client`）、实际解析路径、runtime identity、官方组件 identity、待核验文件清单及每个文件的 hash、六步 `step1`–`step6` 各自的 `result`/`evidence`/`checkedAt`、最终 `host-only` 或 `client-copy-required` 结论、回填的 R requirements 路径和条目 |
| 版本核验 | 包名、package.json 路径及 hash、解析路径、version、`dsh.api`、runtime 全量 identity、官方组件 identity、检查命令/时间、结论和证据 digest |
| 可见性输出面 | `surface`、audience、policy source、secret/non-secret classification、provenance（source/time/uncertainty）、nested/binary/exception-cause/MCP-resource redaction coverage、observed evidence 和结论 |

其中六步 `step1`–`step6` 的语义固定对应 `capability-strategy.md §10` 的六个问题，不得只写“六步通过”。

| 表 | 承载需求 | 结构 |
|---|---|---|
| 审计报告头 | A0.1/A0.2 | §3.1 的审计身份、runtime、依赖锁定、审计 base 和基准分册结论；迁移项/存量项两栏结论 |
| 发现项表 | A0.3 | id、位置、违反条款、证据（命令/规则版本/快照或包 identity/hash）、严重度、处置（登记/改写/豁免/重构建议）、状态 |
| scope 归属表 | A2.1 | API、scope 档（session/workspace/profile/运行时豁免/直通豁免）、声明位置 |
| 能力声明表 | A2.2/A2.3 | mutation 面、既有约束、补声明结论或豁免理由、建议位置、**retry 现状明示行（未知默认禁止满足，暂无违规）** |
| 词汇映射表 | A1.3/A1.4 | 用词、对象、性质（终态/生命周期/事件词汇）、与统一词汇映射、豁免理由 |
| 身份/世代结论表 | A1.1/A1.2 | 前向结论（executionId 自生成；generation opaque token + owner-local revision）、现状确认（无 event-seq 冒充身份、无全局单调计数器、无跨 owner 比较） |
| 三面映射图 | A3.1/A3.2 | feature、namespace、面分类、状态空间 owner、豁免依据、smell 判据结果 |
| 六步判定记录表 | A4.1/A4.2 | §3.1 固定 R 类字段（含 package metadata、解析路径、runtime/official identity、文件 hash、六步逐项证据）、组件 owner/package 边界、结论（host-only / 需 client 复制）、后续衔接 |
| 版本核验表 | A4.3 | §3.1 固定版本核验字段（含 metadata/path/hash、runtime/official identity、lock/digest、检查命令/时间、结论） |
| 可见性登记表 | A5.1–A5.3 | §3.1 固定可见性字段（含 audience、policy source、secret 分类、provenance、完整脱敏覆盖、证据和结论） |
| 并发与取消登记表 | A6.1–A6.3 | 适用面、signal/取消传播、stale 提交资格、disposer 所有权、并发策略、attempt/execution 关系、终态裁决 |
| 重构窗口建议表 | A3.3 | 负债项、建议、是否进入重构跟踪（§3.0.1） |

「零违反」类结论以对应扫描输出为证据，不虚构。状态域必须显式使用 `resolved`、`historical-closed`、`external-tracked`、`approved-refactor-tracked`、`not-in-scope` 或阻塞状态 `unverified`、`not-audited`、`pending-declaration`、`pending-decision`、`unknown`；未知状态值本身即为阻塞。阻塞状态不得被重标为“无发现”或“可追踪外部义务”。只有「历史迁移项已关闭」、明确登记的外部依赖，或有明确批准依据的「重构跟踪」可以作为不阻塞例外；每个例外必须附依据、责任边界和后续复核条件。

## 4. 修复批次划分（与 Tasks 顶层任务对齐）

执行按七个顶层任务顺序推进；全部任务完成后只进行一次整体对抗审查：

| 批次 | 域 | 内容 | 承载需求 |
|---|---|---|---|
| 1 | 背景项 | B1.1 所列 16 处注释/测试名改写（零行为变化）；增强扫描新发现命中的分级处置（§2.2：注释/测试名改写、私有标识符重命名或登记确认技术债）；governance-token-audit 自卫生（现有字面 `'A11'` 改为拼接构造，使测试自身不含字面禁用 token）；迁移项复检（合并后） | B1.1/B1.2、F1 |
| 2 | 身份/世代/终态 | 词汇映射登记（S5①）与 A1.4 混用点定性；A1.1/A1.2 结论登记（S5②） | A1.1–A1.4 |
| 3 | 持久化 | scope 归属表、能力声明补齐与豁免（含 appendMessage 官方语义声明、remote.publish 同键冲突声明、retry 现状明示） | A2.1–A2.3 |
| 4 | API 形状 | 三面映射图 + smell 判据 + 重构窗口建议表；对已完成合规登记的负债，重构建议作为**非阻塞知悉**呈报；若当前项仍不合规，则必须修复或升级为用户裁决，不能仅靠建议关闭（A3.1–A3.3） | A3.1–A3.3 |
| 5 | R 类 | 组件级 owner/package 边界核对（A4.1）；六步判定登记（A4.2，compaction-events / session-title）：**六步逐项结论 + 逐项证据位置指针回填两个 R 包 requirements**（兑现 capability-strategy §10"判定结果必须在 R 类 requirements 中记录、逐项给出证据"），全量证据保留于本 feature 登记文件；版本核验（A4.3） | A4.1–A4.3 |
| 6 | 可见性与并发 | secret 默认禁止/可申请提升/用户全局禁止；模型/UI/log/debug 逐面、provenance 与脱敏覆盖登记；并发/取消逐 surface 适用性及轻重分级证据 | A5.1–A5.3、A6.1–A6.3 |
| 7 | 收尾 | 复审扫描当前范围存量项零未决、可追踪外部义务单列、`npm test` 全绿、`git diff --check`、一次性提交 | F1–F2 |

批次顺序固定：1 → 2 → 3 → 4 → 5 → 6 → 7；批次 4 的重构建议清单随最终报告呈报用户知悉。

## 5. Error Handling

- **扫描工具失败**：该检查项记为 `not-audited` 并显式列明，绝不静默当作"零命中"；`not-audited`、`unknown` 及任何未定义状态均直接阻塞 F1，直到成功重跑并得到可验证结论。
- **改写零行为变化**：批次 1 的注释/测试名改写与私有标识符重命名均以 `npm test` 全绿为门；任何行为变化即停止该改写并标记缺陷。
- **豁免需人确认**：豁免白名单与人工判定结论必须逐条显式记录；未确认的命中按「待裁决」呈现，且**待裁决项必须在本批次审查前完成人工确认、完成修复，或明确升级为用户裁决/外部依赖**，不得以「待裁决」身份进入复审。
- **登记不虚构**：每条登记引证据；无法获得证据的条目标 `unverified`，不得写「合规」；`unverified`、`not-audited`、`unknown`、「待声明」和「待裁决」不得作为当前范围的最终状态，也不得通过状态改名绕过 F1。
- **零未决边界**：F1 只关闭 in-scope findings；历史迁移项和批准的重构建议单列，不能标记为合规关闭。
- **版本不动**：批次内任何 package.json 改动不得变更 version / dsh.api（A4.3）；当前纯本地开发阶段不新增社区运维兼容承诺。
- **不新增确认门**：A3.3 重构建议呈报为知悉性动作，不阻塞后续批次。

## 6. Testing Strategy

| 门 | 验证 |
|---|---|
| 每批 | 该批任务自测 + `git diff --check` |
| F1 | 增强扫描当前范围存量项零未决（无 `unverified`/`not-audited`/`unknown`/「待声明」/「待裁决」及其他未定义状态）+ 可追踪外部义务单列 + `npm test` 全绿 + `git diff --check` |
| F2 | 公开 API 形状 / 事件目录 / 错误分类 / **命名空间 / peerDependency** / 包版本 diff 为空（除批次 1 的注释、测试名与经批准的私有标识符重命名） |

## 7. 边界与豁免

- 不实现任何 M6 候选 feature；不修订 `docs/standards/` 分册；不修改官方 DSH 包文件。
- 不重命名已交付的运行时包/行 id；不改公开 API 形状；**不新增目录事件、错误分类、命名空间或 peerDependency**（requirements 非目标第 3 条）。
- 治理迁移合并（B1.2）为外部依赖，不在本 feature 内执行合并，只复检。
- 批次 5 对 R 包 requirements 的追加限于「六步逐项判定结论 + 逐项证据位置指针」，不改写历史验收内容；全量证据以本 feature 登记文件为主副本。

## 8. Requirements 映射表

| Requirements | 设计落点 |
|---|---|
| A0.1/A0.2/A0.3 | §1（执行模型与快照锚定）、§3（登记文件）、§2.2（判定处置） |
| A1.1–A1.4 | §2.1 S5、§2.2、§4 批次 2 |
| A2.1–A2.3 | §2.1 S3/S4、§4 批次 3 |
| A3.1–A3.3 | §2.1 S6/S7、§4 批次 4、§5 |
| A4.1–A4.3 | §2.1 S8/S9、§4 批次 5 |
| A5.1/A5.2 | §2.1 S10、§4 批次 6 |
| A5.3 | §2.1 S10、§3、§4 批次 6 |
| A6.1–A6.3 | §2.1 S11、§2.2、§3、§4 批次 6 |
| B1.1/B1.2 | §2.1 S1/S2、§2.2（分级处置路径）、§4 批次 1、§7 |
| F1–F2 | §5、§6 |
