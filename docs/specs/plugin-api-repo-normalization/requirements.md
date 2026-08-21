# Requirements: plugin-api-repo-normalization

> feature_name: `plugin-api-repo-normalization`
> 状态：已批准（commit 058849e；Stage 2 对抗审查期间 B1.1 一次修订：修复范围扩至私有标识符处置路径，见 B1.1 与 design §2.2）
> 上游：Stage 0 Goal（用户已确认方向："先把当前仓库规范化、标准化"）；审计基准 = `docs/standards/` 各分册（2026-08-21）与 AGENTS.md §2/§4/§6/§8 及 §3.0.1（纯本地开发窗口）
> 类型：治理/工程规范化（无第三方可见 API 新增）
> 审计快照：2026-08-21（M6 治理迁移未合并主分支时的 main 状态）

## Introduction

2026-08-21 以 10 条 Stage 0 决议确立了五册全局标准并完成治理迁移。以该时点标准审计仓库后发现若干不符合事项：持久化 API 的 scope 归属未成清单、mutation 面缺少 operation 能力声明、R 类客户端半面判定证据缺失、终态/生命周期用词与统一词汇未登记映射、既有 namespace 的三面边界未成图、治理编号仍残留在实现代码注释/测试名中、治理迁移未合并导致旧路径/旧登记指向残留在 main。本 feature 以审计报告 + 获批任务把这些事项规范化；审计发现类需求逐条携带证据，报告类需求以报告形状与登记位置为验收。

---

## 1. 审计交付物（A0）

**A0.1.** WHEN this feature 执行 THEN 系统 SHALL 产出合规审计报告，逐条记录：审计基准分册与条款、发现位置、证据、违反认定、修复建议；每册至少一条「零违反」或「有发现」的明示结论。
**A0.2.** GIVEN 审计发现项均来自 2026-08-21 快照 WHEN 报告交付 THEN 报告 SHALL 标注审计时点与 base（main @ 治理迁移合并前），并区分「已合并即消失」的迁移项与「合并后仍存在」的存量项。
**A0.3.** WHEN 审计发现需登记（scope 归属、能力声明、半面判定、词汇映射、面图）THEN 登记 SHALL 落于 `docs/specs/plugin-api-repo-normalization/` 下的登记文件（由 Tasks 阶段定文件名），每条登记 SHALL 可验证（引代码位置或官方包检查结果）。

## 2. 新标准落实（按分册）

### 2.1 identity-and-lifecycle（Q1/Q3/Q4）

**A1.1.** GIVEN 既有 API 不生成 execution identity WHEN 审计执行 THEN 报告 SHALL 确认：现有代码不以 event seq 冒充执行身份（`sourceEventSeqs` 等仅作溯源，非身份），`routing.ofExecution(exec)` 只透传官方对象身份；并登记结论「首个 execution 系 feature 立项时 SHALL 落实 executionId 由 plugin-api 生成」（evidence：lib/exec-route.js、lib/session-durable-feature.js、lib/llm-request-snapshot.js）。
**A1.2.** GIVEN 现有世代机制为 owner-local（session-durable 的 capability epoch `active/breached/closed`、agent facade transaction 的 transaction.epoch 等）WHEN 审计执行 THEN 报告 SHALL 确认无全局单调 generation 计数器、确认无跨 owner generation 比较，并登记结论「新 feature 的 generation SHALL 用 owner-specific opaque token + owner-local revision」（evidence：lib/session-durable-feature.js:51,107-113、lib/plugin-api-service.js:685-692）。
**A1.3.** GIVEN 既有生命周期/终态用词（transaction state `prepared/committed/rolled-back`；epoch state `active/breached/closed`；R 包事件 `started/completed/failed/skipped`）WHEN 审计执行 THEN 报告 SHALL 逐类登记其与统一终态词汇（success/error/aborted/denied/superseded）的映射或豁免理由（例如：transaction 终态 rolled-back 对应何种 outcome；R 包事件词汇为已交付契约，保留并登记对应关系），确认终态 final 且唯一（无事后改写路径），并登记结论「新 feature 的终态只能使用统一词汇」（evidence：lib/plugin-api-service.js:685-725、lib/session-durable-feature.js:186-200、packages/compaction-events/lib/event-contract.js）。
**A1.4.** WHERE 审计发现某处用词可能与统一词汇冲突（如 `settled`、`closed` 用作终态性表述）THEN 系统 SHALL 区分处理：属既有交付契约的登记差异与理由（保留语义，按 A1.3 登记）；属本次修复或后续 feature 引入的改写为统一词汇（前向约束见 A1.3 登记结论）。

### 2.2 durable-state-and-scope（Q2/Q8）

**A2.1.** GIVEN 仓库存在可持久化/有状态 API WHEN 审计执行 THEN 系统 SHALL 产出 scope 归属清单：`pluginApi.session.appendMessage`（session 档，spec 已约束 targetSession）、官方直通 seam（tokenMeter/settings/jobs 等，A 类直通豁免）、运行时内存状态（R 包引擎、remote 注册表等，不属 durable record 豁免）；登记「跨档零记录」；对 appendMessage 与 `remote.publish` 等 mutation 面核对审计可追溯（who/what/when/generation）现状并登记缺口。
**A2.2.** GIVEN 既有 mutation 面缺少 operation 能力声明（appendMessage 无幂等/自动重试声明；`remote.publish`/`settings.remote.set` 无显式能力声明）WHEN 审计执行 THEN 系统 SHALL 在登记文件补齐声明或记录豁免理由：appendMessage 按官方 `Session.append` 语义声明（追加非幂等、默认不自动 retry）；`remote.publish` 已有的同键异引用 typed error（lib/remote-publication.js）SHALL 作为能力声明登记；空缺项 SHALL 标记为待声明并给出建议位置。
**A2.3.** GIVEN 当前自动 retry 行为为零（lib 无 retry 循环）WHEN 审计执行 THEN 报告 SHALL 明示「未知默认禁止满足，暂无违规」；任何后续 feature 引入 retry SHALL 遵守 durable-state-and-scope §3/§4（attempt 与 operation 分层、transient/permanent/aborted/denied/superseded 分类）。

### 2.3 api-shape（Q9）

**A3.1.** GIVEN 既有 namespace 多为直通/基础设施 WHEN 审计执行 THEN 系统 SHALL 产出 namespace → 三面映射图并逐项登记豁免理由：llm（投影 modelInfo + 策略 admission/request transform + 直通 stream/prepareCall，多面但独立 owner，符合三面先例）；session（投影 surface/durable observation + mutation appendMessage，独立状态空间）；routing（纯投影）；events（基础设施豁免）；services.*（纯直通豁免，api-shape §5）；settings（A 类直通豁免）；remote/settingsRemote（B 类转译，单面 mutation，豁免依据为官方公开原语 + 独立 owner）；client.*（官方 client 直通豁免）。
**A3.2.** GIVEN smell 判据（同 namespace 共享状态空间出现 register+query+mutate 等三条）WHEN 审计执行 THEN 系统 SHALL 逐 namespace 运行判据并在报告登记零命中或命中项；命中项 SHALL 进入修复清单，未命中项 SHALL 附判据与豁免论证。
**A3.3.** GIVEN 审计发现 API 形状负债（含三面 smell 命中项）WHEN 报告交付 THEN 系统 SHALL 逐项标注「重构窗口建议（AGENTS.md §3.0.1）」并与登记性修复分开呈现；未附重构建议的负债项 SHALL NOT 被标记为已关闭。

### 2.4 capability-strategy（Q6/Q7）

**A4.1.** GIVEN 已交付 R 辅助包为两包两行（compaction-events ↔ `dsh-compaction-basic`；session-title ↔ `dsh-session-title`）WHEN 审计执行 THEN 报告 SHALL 确认 1:1 边界合规（capability-strategy §9），并登记「未来 R 候选每替换一个官方行 = 一个独立辅助包」。
**A4.2.** GIVEN 两个 R 包声明 host-only 但从未按 §10 六步判定 WHEN 审计执行 THEN 系统 SHALL 按六步清单逐项判定并登记证据：
- `dsh-compaction-basic`：无 `dsh.client` 清单、无 client 运行时代码、exports 无 `./client` → 六步全阴，host-only 成立；
- `dsh-session-title`：无 `dsh.client` 清单、`./client` 子路径仅指向类型出口空桩 `lib/types/client.js`（`export {}`，无运行逻辑）→ 无 client-facing 运行时能力，host-only 成立，但登记中 SHALL 记录该 `./client` 类型桥的存在。
（evidence：`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-{compaction-basic,session-title}/package.json` 2026-08-21 检查结果；capability-strategy §10 要求"判定结果必须在 R 类 requirements 中记录"，与本节登记文件的衔接方式（是否同步回填两个 R 包 requirements）由 Tasks 阶段明确）
**A4.3.** GIVEN 四包版本已一致（main 与三个辅助包均 `0.1.0-rc.6-0.5` / `dsh.api 0.5`）WHEN 修复涉及 package.json THEN 系统 SHALL 保持该一致性，且修复不得改动版本号。

### 2.5 visibility-and-redaction（Q5）

**A5.1.** GIVEN 现状已具备最小暴露要素 WHEN 审计执行 THEN 报告 SHALL 登记：settings remote 快照经 `redactSecrets` 脱敏（lib/settings-remote.js:154）、事件 payload 深冻结（lib/deep-freeze.js）、lib 无默认 `console.*` 输出（依赖注入 logger）。确认零敏感默认暴露。
**A5.2.** GIVEN 既有输出面的可见性声明缺位 WHEN 审计执行 THEN 系统 SHALL 登记缺口（例如：错误对象进入模型的可见范围、debug 级诊断的触发条件）并给出声明位置建议；新 feature 的 requirements 必须逐条标明受众（模型/UI/diagnostic/redacted）。

## 3. 背景项：既有规则复核（非主审计）

**B1.1.** GIVEN 实现代码存在治理编号残留 WHEN 审计执行 THEN 系统 SHALL 登记全部位置并纳入修复清单：注释与测试名命中改写为中立语义表述（零行为变化，全量测试为门）；运行时私有标识符命中（如 `runL4Phase`、`_execRouteP2Diagnostics` 等）经人工判定后二选一处置——行为保持的重命名（零行为变化由全量测试验证）或登记为「确认技术债」并附重构窗口建议；C0/C1 等非治理术语豁免并登记；增强扫描在 B1.1 清单之外的新发现命中按同一处置路径分级处理，不得默认豁免。位置清单：lib/settings-remote.js:2,6,8,51,116,146（ST4/D5）、lib/remote-publication.js:6,324（ST4）、lib/llm-input-policy.js:46（L1）、lib/services.js:14（SV15）、lib/client-codec.js:6（W5）、packages/compaction-events/lib/event-contract.js:85（C6）、packages/compaction-events/lib/forked-engine.js:641（C4.7）、packages/session-title/lib/event-contract.js:5（C4/D1）、test/services-definitions.test.mjs:84（SV17 测试名）、test/index-tools-abort.test.mjs:67（T2 注释）；C0/C1 为 ASCII 控制字符术语（packages/session-title/lib/event-contract.js:136 等同型处）豁免。
**B1.2.** GIVEN 治理迁移尚未合并主分支 WHEN 审计执行 THEN 系统 SHALL 登记 main 上的旧路径/旧指向（`docs/capability-strategy.md` 旧路径 ×9 文件、AGENTS.md §8 登记表旧形态、feature-list.md §7 缺失）为「随迁移合并消失」项，并登记合并边界后复检无残留。

## 4. 验证（F）

**F1.** WHEN 全部修复完成 THEN 重跑审计检查（本 feature 登记清单 + 增强后的 governance-token-audit 覆盖）SHALL 对存量项零未决；`git diff --check` 通过；全量 `node --test` 全绿。B1.2 的治理迁移合并属外部依赖，另行跟踪（迁移合并后复检无残留，不视为本 feature 的未决项）。
**F2.** GIVEN 修复涉及已交付 feature 的登记/注释/文档 WHEN 提交 THEN 每个修复 SHALL 以本 feature 获批任务为依据，且不改变任何公开 API 形状、事件目录、错误分类或包版本。
**F3.** GIVEN 审计发现项指向 M4/M5 执行分支在途文件 WHEN 执行 THEN 系统 SHALL 仅登记待办（位置与建议），不得跨分支修改。

## 非目标

- 不实现任何 M6 候选 feature（execution/usage/recovery 等）。
- 不修订 `docs/standards/` 分册本身；分册演进走 AGENTS.md 治理。
- 不修改官方 DSH 包文件；不新增目录事件、错误分类、命名空间或 peerDependency。
- 不重命名已交付的运行时包/行 id（中性命名已合规）。
- 不把登记当作免责：每条登记必须可验证、可追溯。