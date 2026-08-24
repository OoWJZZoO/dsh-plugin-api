# Tasks: plugin-api-repo-normalization

> feature_name: `plugin-api-repo-normalization`
> 状态：Stage 3 已获用户批准，进入 Stage 4 Execute
> 上游：已获当前授权的 Goal、Requirements、Design
> 执行原则：用户于 2026-08-24 明确批准本 Tasks，并明确授权本次执行跳过逐批对抗性审查，改为七个顶层批次全部完成后进行一次整体 Luna(max) 只读审查。整体审查必须返回最终 `PASS` 才能完成 Stage 4 提交；错误、超时、无结果或 `REVISE` 均不是批准，实质修订后必须重新进行整体审查。不得修改官方 DSH 包、M4/M5 冻结边界或新增公开 API。

## 0. Execution Contract

本 feature 的承载 worktree 与 integration owner 固定为当前仓库的 `main`
worktree（`/home/wanwe/global_workspace/agent/dsh-plugin-api`）和其当前
本地 owner `OoWJZZoO`；Stage 4 开始前必须先通过 `git diff --check`，再把本
Tasks 获批边界提交到 `main`，并在该提交上执行；提交失败或存在无法归属的
变更时不得进入 Stage 4。不得另建并行 leaf worktree。保护清单中的
authoritative source 绑定到已交付 M4/M5 的 task contracts 与 integration
commits：M4 = `docs/specs/plugin-api-official-passthrough-m4/tasks.md` /
commit `6d14d9b`，M5 =
`docs/specs/plugin-api-official-passthrough-m5/tasks.md` / commit `9228720`。
Stage 4 首次审计时若这些 refs 已移动，integration owner 必须以完整 SHA、
当前 branch ref 和实际可解析的 execution record 更新 manifest；不能用短 SHA、
路径猜测或抽象角色代替绑定。

Stage 4 bootstrap 必须在批次 1 开始前完成：先只读捕获 pre-bootstrap snapshot
（完整 status、branch/commit、dirty/untracked 指纹、runtime/lock identity、standards
digest 和计划的 bootstrap write set），再创建任何可变产物。该 snapshot 必须作为
`execution/audit-report.md` 的首条记录持久化；随后按 Design §3.1 初始化
`reportSchemaVersion: 1` 的完整固定报告头、证据字段和全部登记表骨架，再生成
`execution/protection-manifest.json` 初版，解析 M4/M5 的 branch、完整 commit、owner、
精确 `files`/`sharedFileRules` 和复检触发条件，并执行一次 §0 固定复检。manifest
缺失、占位、过期或任一 entry 不可解析时不得开始批次 1；该 bootstrap 是批次 1 的
初始化子步骤，不另立顶层批次；其唯一允许写入为 `execution/audit-report.md` 和
`execution/protection-manifest.json`，两者必须在创建前后记录写集、hash 和 manifest
digest，并纳入批次 1 的 `allowedWriteSet`。批次 1.3 负责在 bootstrap 基础上核验或
更新 manifest，并记录最终可审计的版本和 digest。

每个顶层批次开始前，integration owner 必须在 `execution/audit-report.md`
记录完整 `batchBase`（当时 `HEAD` 的 full SHA）、manifest digest、完整
`git status --short --untracked-files=all`、每个既有 dirty/untracked 路径的
index/worktree 指纹，以及本批次精确的 `allowedWriteSet`（每条路径附对应任务和
理由）。对每个 manifest `files`/`sharedFileRules` 路径还必须记录
authoritative commit blob、当前 index blob 和工作树 hash（文件不存在时显式记录
`missing`）。批次开始时冻结路径的 index 或工作树与 authoritative source 不同，
或共享路径不符合 owner/`allowedEdit`，即为阻塞；不得把既有脏改动默认为本批次
写集。

每个顶层批次开始后、整体只读审查前、整体审查返回后和 Stage 4 完成提交前均执行同一组保护复检，并把
命令、时间、结果、`batchBase`、manifest digest、完整写集和路径判定写入
`execution/audit-report.md`：

```text
git show-ref --verify refs/heads/main
git rev-parse --verify <authoritative-commit>^{commit}
git status --short --untracked-files=all
git diff --name-only <authoritative-commit>...HEAD
git diff --cached --name-only <batch-base>
git diff --name-only
git diff --name-only <batch-base>
git ls-files --others --exclude-standard
git rev-parse <authoritative-commit>:<each-manifest-file>
git ls-files -s -- <each-manifest-file>
git hash-object --no-filters -- <each-manifest-file>
git hash-object -- docs/specs/plugin-api-repo-normalization/execution/protection-manifest.json
```

复检必须将 staged、unstaged、base-to-worktree 和 untracked 输出合并为实际写集，
并与批次开始快照比较，以识别已存在 dirty 文件后续被改写的内容变化。实际写集内
每个新增或变更路径都必须属于 `allowedWriteSet`；冻结路径不得出现 index/worktree
变化；共享路径只有同时符合 manifest owner、`allowedEdit` 和 `allowedWriteSet` 才可
继续。整体审查返回后的写集或指纹变化会使该轮审查失效，必须先处置变化后重新进行整体审查。
任一 branch、commit、路径、hash、owner、digest、manifest version 或写集判定不可
解析时，该批次保持阻塞，不得以外部待办关闭。每次引用、写集或共享规则变化都必须
递增 `manifestVersion` 并重新记录 `baseCommit` 与 digest。

只读审计若发现问题位于 M4/M5 冻结或在途路径，必须在报告发现项表登记为
`external-tracked` 待办，写明源位置、证据、修复建议、authoritative surface/owner、
责任边界和复检条件；它不构成当前范围的合规关闭。实际写集出现冻结路径改动或违规
共享路径则是保护检查阻塞，不能改记为外部待办。

## 1. 治理残留与保护边界

- [ ] **1.1** 由 `main` integration owner 运行版本化 `governance-token-audit`：扫描实现路径、包元数据、bundle patch、文件名/路径、注释、标识符、测试描述和字符串字面量；把规则版本、完整命令、排除项理由、快照身份和命中输出写入 `execution/audit-report.md`。扫描规则必须检出测试源自身的治理 token；现有 `test/governance-token-audit.test.mjs` 中的字面 `A11` 改为构造表达式（例如 `'A' + '11'`），并以扫描结果证明测试仍覆盖同一 token。（Requirements B1.1, A0.2）
- [ ] **1.2** 以 Requirements B1.1 的固定命中清单和增强扫描新增命中为闭集逐项处置：注释/测试描述中性改写；运行时私有标识符选择行为保持的重命名，或仅在逐项记录位置、责任人、复核条件、批准人、批准依据/引用、决策日期和技术债理由后登记为 `approved-refactor-tracked`；C0/C1 控制字符术语按源位置登记为明确豁免。缺少该项人类批准依据的标识符不得延后：必须完成中性重命名，或以阻塞状态升级请求用户裁决后才可进行批次 1 审查。对每个命中记录 token、位置、人工判定日期、处置状态、证据命令、diff/hash 和 `npm test` 结果；对 Requirements B1.2 列出的旧路径/旧登记逐项记录 `historical-closed` 或 `external-tracked` 状态、治理迁移合并后的复检条件和 owner，不跨分支合并。（Requirements B1.1, B1.2, A3.3）
- [ ] **1.3** 由本文件 §0 绑定的 `main` integration owner 核验或更新 Stage 4 bootstrap 生成的 `execution/protection-manifest.json`，为 M4 和 M5 各填可解析的 source/branch/full commit/owner，以及精确 `files` 或 `sharedFileRules` 和触发条件；在本批次开始与结束各执行 §0 固定复检，记录 manifest version/digest、路径 diff、逐路径 hash 和共享规则核对。（Requirements F3, F4, A0.2）
- [ ] **1.4** 运行 `git diff --check` 和 §0 的完整 staged/unstaged/base-to-worktree/untracked 写集复检；以已记录的 full `batchBase`、起始指纹和 `allowedWriteSet` 逐项判定，确认没有 `/usr/lib/node_modules/@deepseek-ai/dsh/**`、M4/M5 冻结路径、违规共享路径或未声明文件；本次按用户授权不在本批次派发审查，保留批次边界记录并在整体审查返回后再次复检。（Requirements F2, F3, F4）

## 2. Identity and Lifecycle

- [ ] **2.1** 核验 Stage 4 bootstrap 已按 Design §3.1 初始化 `reportSchemaVersion: 1` 的完整报告头、证据字段和登记表骨架；复核并补记本批的审计时点、分支、commit、dirty 纳入边界、runtime identity、依赖锁定摘要、历史/current base 与 standards digest，且只追加可验证快照，不改变固定 schema。（Requirements A0.1, A0.2, A0.3）
- [ ] **2.2** 清点 execution、event sequence、transaction、epoch、R 包事件及 `settled`/`closed`，在报告中逐行给出统一终态映射、既有契约豁免理由、终态唯一性证据；另列四条可验证身份断言：`sourceEventSeqs` 不能作为 execution identity、`routing.ofExecution(exec)` 只透传官方对象身份（引用 `lib/exec-route.js`）、实现中无全局单调 generation 或跨 owner 比较、未来 generation 采用 owner-local opaque token + revision。（Requirements A1.1, A1.2, A1.3, A1.4）
- [ ] **2.3** 用 `rg`/`git grep` 输出词汇与身份命中清单，逐项引用源文件/行号；运行 §0 保护复检、`git diff --check`，将命令/输出路径/快照写入报告，确认本批次只产生登记或中性文档改写后提交。（Requirements F1, F2）

## 3. Durable State, Scope and Retry

- [ ] **3.1** 清点可持久化、有状态和内存 API，建立 API → scope 档位 → owner/声明位置表，区分 session durable、运行时内存、官方直通和跨档零记录。（Requirements A2.1）
- [ ] **3.2** 为 mutation 面完成具体能力核对和声明：`session.appendMessage` 按 session scope 记录追加为非幂等且默认不自动 retry；`remote.publish` 记录同键异引用的 typed error 语义；`settings.remote.set` 和上述 mutation 逐项核对 `who/what/when/generation` 审计追踪字段的现状与缺口，并记录冲突、幂等性和自动 retry 声明。缺失项必须补齐或升级为有责任人的用户裁决，不以待声明关闭。（Requirements A2.1, A2.2）
- [ ] **3.3** 登记当前无自动 retry 循环的证据（`rg -n "retry|attempt" lib packages` 与相关源文件指针），并将 retry/attempt 命中清单交给批次 6 作为 A6.2 的证据输入；本条只关闭当前 retry 现状与 A2.3 的登记，不绑定 A6.2 的 execution/attempt 结论。（Requirements A2.3）
- [ ] **3.4** 运行针对 scope/mutation/retry 登记的检查、`git diff --check`，确认不改变公开 API，并提交本批次。（Requirements F1, F2）

## 4. API Shape

- [ ] **4.1** 建立 feature inventory → shared state-space owner → namespace 的主映射，记录 projection/policy/mutation 三面以及直通和基础设施豁免，生成 namespace 汇总视图。（Requirements A3.1, A3.2）
- [ ] **4.2** 以 feature/state-space owner 为单位运行 register/query/mutate smell 判据，逐项记录证据、命中处置或轻量豁免；对真实形状负债单列 AGENTS.md §3.0.1 重构建议，不能用建议掩盖未修复违反。（Requirements A3.2, A3.3）
- [ ] **4.3** 运行映射与 smell 检查、`git diff --check`，核对 namespace、事件目录、错误分类、peerDependency 和公开 API diff 均未被意外改变，并提交本批次。（Requirements F1, F2）

## 5. R Component Ownership, Client Surface and Version

- [ ] **5.1** 对 `compaction-events` 与 `session-title` 建立 official component → single replacement owner/package → replaced rows → feature dependency 表，确认每个 R 实现只归属一个官方组件、每个 feature 至多依赖一个 replacement package，facade 组合不违反该边界。（Requirements A4.1）
- [ ] **5.2** 从当前实际安装路径读取官方 package metadata、`dsh.client`、exports、运行时 identity、组件 identity 和文件 hash，逐项完成 capability-strategy §10 六步判定；把每一步证据位置指针回填对应 R 包 requirements，并在 audit report 保留完整记录。（Requirements A4.2）
- [ ] **5.3** 核验主包、辅助包和聚合包的 version/`dsh.api`、runtime 全量 identity 与 lockfile 摘要；不得为本 feature 改版本号或改变安装语义。（Requirements A4.3, F2）
- [ ] **5.4** 运行明确的 R/client/version 检查：解析四包 `package.json`、官方组件路径和 `dsh.client`/exports，执行 §10 六步字段完整性检查；运行 `git diff --name-only`、官方树 checksum 对照和 `git diff --check`，把每条输出指针写入报告，确认不修改官方包文件、不跨组件实现后提交本批次。（Requirements F1, F2, F3）

## 6. Visibility, Concurrency and Cancellation

- [ ] **6.1** 建立模型、UI、log、debug 四类输出面矩阵，记录 audience、policy source、secret/non-secret 分类、source/time/uncertainty provenance，以及嵌套值、二进制、exception cause、MCP resource 的脱敏覆盖；必须以源证据核对 `settings.describe({ redactSecrets: true })`、事件 payload 经 `deepFreeze`、`lib/` 无默认 `console.*` 输出（logger 依赖注入），并分别记录命令、路径/行号和结论。验证 secret 默认禁止、插件可申请提升、用户/profile 可全局禁止，非 secret 诊断按声明尽可能开放。每个缺失的可见性声明必须逐项补齐，或在本批次审查前升级为有责任人、有决策记录和后续证据位置的用户裁决；不得以未声明状态进入下一批。（Requirements A5.1, A5.2, A5.3）
- [ ] **6.2** 为每个可能重叠、超出调用方生命周期或含 signal/timeout/cancel/disposer/generation/Promise cache 的 feature surface 建立一行审计记录；普通同步直通以证据标记 N/A。记录 signal/父子取消传播、stale 提交资格、identity-safe disposer 和并发策略。（Requirements A6.1）
- [ ] **6.3** 在并发记录中绑定核对 A6.2 与 A6.3：引用批次 3.3 的 retry/attempt 证据，确认内部 provider/tool retry 属于同一 execution 的新增 attempt，model/user/external re-invocation 创建新 execution，timeout 归入 error reason；同时验证终态优先级 `aborted > superseded > error > timeout-error`、终态 final/identity-safe 和 stale generation 防护。不重复实现 attempt/execution 关系，也不为 timeout 新增终态类别。（Requirements A6.2, A6.3）
- [ ] **6.4** 运行 visibility/concurrency 检查、`git diff --check`，确认没有新增 visibility policy、事件、错误分类或公开 API；提交本批次。（Requirements F1, F2）

## 7. Final Audit and Delivery

- [ ] **7.1** 重跑版本化 `governance-token-audit`、S2 旧路径/旧登记当前工作树扫描（`docs/capability-strategy.md`、AGENTS.md §8 形态和 feature-list.md §7），并重跑批次 2–6 的全部 current-scope 检查：身份/终态词汇与 A1.4 断言、scope/mutation/retry 声明、feature-to-namespace/state-space 与 smell 判据、R/client/version 六步字段、visibility/concurrency/cancellation 逐项检查。S2 对每个旧路径/旧登记记录最终 snapshot identity/digest、位置、命中证据与 `resolved`、`historical-closed` 或带 owner/责任边界/合并后复检条件的 `external-tracked` 状态。每项必须记录规则版本、完整命令和输出位置、snapshot identity、输入/结果 digest、适用范围和结论；任一命令失败、输入缺失、解析失败、结果不可复算或出现未解决 in-scope finding 时均为阻塞，不得以既有批次结论替代最终重跑。（Requirements A0.1–A6.3, B1.1, B1.2, F1）
- [ ] **7.2** 汇总 `execution/audit-report.md`：每册至少一条结论，当前 in-scope findings 无 `unverified`/`not-audited`/`unknown`/待声明/待裁决状态；历史关闭项、外部依赖和批准的重构跟踪单列，不能标作合规关闭。（Requirements A0.1, A0.3, F1）
- [ ] **7.3** 按 protection manifest 的 branch/commit/path/shared-file/hash 规则完成最终复检：逐个执行 §0 的 branch/commit/diff/hash 命令，记录 schema/version/digest、owner、触发条件、命令和结果；M4/M5 的每一条 `external-tracked` 发现必须完整记录源位置、证据、修复建议、authoritative surface/owner、责任边界和后续复检条件。确认 M4/M5 仅登记、不修改。（Requirements F3, F4）
- [ ] **7.4** 执行 `npm test`（即 `node --test "test/**/*.mjs"`）和 `git diff --check`；执行公开 API、事件目录、错误分类、namespace、peerDependency 和 package version diff 检查。（Requirements F1, F2）
- [ ] **7.5** 对照 AGENTS.md §5 检查 `../dsh-read-image` 与
  `../dsh-pro-ex-ability-anchor`：记录本 feature 无公开 API/运行时行为变更，
  因而不执行消费者迁移、不修改两个外部仓库的豁免理由；同时记录当前可验证的
  迁移证据来源（M2/session-title 已有迁移记录）与本 feature 的边界。若审计发现
  本 feature 的中性改写改变了任一消费者契约，立即将本条标为阻塞并暂停收尾。
  （Requirements F1, F2；AGENTS.md §5）
- [ ] **7.6** 在最终报告中列出两仓库路径、检查命令、commit/dirty 快照和
  `not-applicable` 判定；不得把未执行跨仓库迁移写成已通过的 headless/dev-boot
  验收，也不得把本 feature 的审计登记替代消费者真实迁移证据。（Requirements F1, F2；AGENTS.md §5）
- [ ] **7.7** 仅在 7.1–7.6 全部通过、七个顶层批次的写集与批次边界均已记录、且按用户授权进行的整体 Luna(max) 只读审查返回最终 `PASS` 后，复跑 §0 保护复检和 `git diff --check`，再创建 Stage 4 完成提交，包含本 feature 的 spec、audit report、protection manifest、必要的中性改写和 `docs/specs/plugin-api-features/feature-list.md §7` feature 登记；交付报告列出整体审查结论、各批次快照身份、外部待办和剩余风险。（Requirements F1–F4）
