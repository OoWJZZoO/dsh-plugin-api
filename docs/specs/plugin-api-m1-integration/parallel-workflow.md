# 并行开发工作流协议（parallel-workflow protocol）

> feature_name: `plugin-api-m1-integration`（任务 2.12 制品）
> 状态：已确立。本文是 `dsh-plugin-api` 多 worktree 并行开发的**三阶段工作协议**，由 M1 七分支整合的实战教训固化而来。
> AGENTS.md §3.5 指向本文。

---

## 0. 为什么需要本协议

M1 由 7 个 worktree 并行实现，合并前预检发现：**功能覆盖完整、无夹带，但共享基础设施被四次平行发明**（catalog 条目 schema、冻结策略词汇、scope 解析分支、catalog 组合机制各不一致），21/21 分支对全部文本冲突，其中 `AGENTS.md` / `lib/guards.js` / `test/index-events.test.mjs` / `test/index.test.mjs` 在每个分支对上都冲突。结论：并行开发的成本不在"各写各的 feature"，而在**共享文件上的无契约并发写入**。本协议把冲突从"合并期语义仲裁"降级为"合并期机械拼接"。

---

## 1. 阶段一：并行前（准备）——契约先行

在派生任何 worktree **之前**，协调者必须产出并随任务书下发《契约包》。契约包至少覆盖：

### 1.1 命名规范

- feature 名 = `pluginApi` 命名空间名 = `runFeatureGuard` 分支名 = `FEATURE_MOUNTERS` 键（三者同名，camelCase）。
- 事件 slice 模块：`lib/<name>-events-catalog.js`，导出 `<name>EventsCatalog`；测试 `test/<name>-events-catalog.test.mjs`。
- feature 集成测试：`test/index-<feature>.test.mjs`（apply 级）、`test/plugin-api-service-<feature>.test.mjs`（service 级）、`test/<feature>-guard.test.mjs`（guard 级）。
- catalog 条目使用统一 schema（M1 整合后定稿）：`name / mode / scopeFiltered / scopeKey / payload / args / source / type` + 可选策略字段 `fault`（`'contain'|'created'|'propagate'`，缺省 `'contain'`）、`freeze`（`'all'|{deep:[...]}|'except-signal'`，缺省 `'all'`）。**禁止新增同义字段**（如 `subject`）；新增策略必须扩展既有词汇表而不是另立字段。

### 1.2 共享文件编辑边界（平行职责契约）

每个共享文件规定唯一的并发写入模式，使 git 三路合并能机械取并集：

| 共享文件 | 允许的写入模式 |
|---|---|
| `lib/guards.js` | 只在 `else` 未知分支**之前追加** `} else if (featureName === '<name>') { ... }`，并标注必需/可选（fail-closed/fail-open） |
| `lib/index.js` | 只**追加** mounter 函数；`FEATURE_MOUNTERS` 条目插入位置按契约包指定 |
| `lib/plugin-api-service.js` | 只追加：disabled 工厂函数 + constructor 一行 + `mountFeature` 一个分支 |
| `lib/events-catalog.js` | **禁止直接加条目**——新事件一律进自己的 slice 模块 |
| `lib/deep-freeze.js` / `lib/events-bus.js` | 并行期内**冻结**（frozen files）：任何总线/冻结语义变更必须先回收到整合分支统一做 |
| `AGENTS.md` §8 | 只在表尾**追加一行** |
| `docs/specs/plugin-api-features/feature-list.md` | 只改自己 feature 对应行的状态列 |
| `test/index-events.test.mjs` / `test/index.test.mjs` | **冻结**：features 顺序断言由整合分支统一维护；各分支用自己的 `test/index-<feature>.test.mjs` |

### 1.3 挂载与失败呈现契约

- `FEATURE_MOUNTERS` 全局顺序由契约包预先排定；分支不得自行调整既有顺序，只能按指定位置插入。
- 幂等信号统一为 `featureRegistry.isActive('<name>')`；禁止 `service?.<ns>?.isActive` 一类形状探测。
- 失败呈现只允许四条路径（design C7）：P1 inactive core（`PluginApiInactiveError`）/ P2 feature disabled（`PluginApiFeatureDisabledError`）/ P3 optional service unavailable（`PluginApiServiceUnavailableError`，仅可选服务）/ P4 per-member disabled facade（仅 `services.*`）。新 feature 在任务书里声明自己归哪条路径。
- guard 分类：必需服务 fail-closed；可选服务 fail-open（`ctx.get` 抛错视同缺失）。

### 1.4 目标与范围

- 每个 worktree 的任务书必须写明：本分支的 feature-list 编号范围、**明确排除**的编号（防夹带）、允许触碰的文件清单。
- 契约包同时给出合并顺序与冲突解决规则的预告，让各分支在实现时就朝"易合并"方向收敛。

---

## 2. 阶段二：并行中（worktree 守则）——强指导，非铁律

1. 各 worktree **应当**遵守契约包：命名、编辑边界、schema 词汇、失败呈现路径。
2. 契约是**强指导而非绝对规则**：实施中发现某条契约不切实际或有负价值时，**允许偏离**。
3. 偏离的义务：必须把偏离点与理由写入本 worktree 的 spec 文档（requirements/design 的修订注记），并在交付报告中**显式上报**，供合并期预检仲裁。
4. 未上报的偏离按违约处理：合并期预检发现即打回，不得静默并入。
5. 并行期内发现共享基础设施（frozen files）确需变更时，记录为"整合期议题"上交，不得私自在分支内改。

> M1 实例：agent 分支的 `subject→scopeKey` + `fault/freeze` schema 升级属于"动了 frozen files"的偏离，但已按第 3 条在自己的 spec 中记录并上报，整合期予以采纳并推广到全部分支——这是协议允许的正确偏离路径。

---

## 3. 阶段三：并行后（合并）——预检 → 集中整合 → 全绿

### 3.1 只读预检（merge 前必须完成）

1. **命名/同构审计**：逐分支核对 §1.1–§1.3 契约的遵守情况，列出全部平行发明点。
2. **覆盖与夹带核对**：逐 feature-list 编号验证实现 + 测试存在；验证无范围外实现。
3. **两两冲突图**：`git merge-tree` 全对模拟，产出冲突文件矩阵。
4. 每个分支一个独立审计（实现↔spec 一致性），产出结构化报告。

### 3.2 集中整合（一次合并波 + 一次统一波）

1. **合并波**：在 integration 分支上按预定顺序逐分支 merge，只做冲突解决与 schema 对齐，不做重构；每步测试绿。
2. **统一波**：按 design 任务清单（slice 化、总线统一、两遍式 apply、gating 收敛、幂等统一、失败呈现统一、版本与文档同步）逐项提交，每项测试绿。
3. 统一波中若发现 spec 矛盾（如 M1 的 `dsh.api` 版本语义），按 AGENTS.md §3.2 处理：修订 spec 并在最终报告列明；动摇已确认 AC 时暂停请人类裁决。

### 3.3 验收

- 全量 `node --test` 绿；关键回归闸（每个 catalog slice 的端到端门面待遇测试）在场。
- 文档同步：AGENTS.md §8、feature-list 状态与形状、被修订 spec 的修订注记。
- integration 分支合入 main，交付结果报告（含全部 spec 修订清单）。

---

## 4. M1 实战教训备查

| 教训 | 对策条款 |
|---|---|
| catalog schema 被 agent 分支单独升级，其余分支条目用旧字段 | §1.1 schema 词汇 + §1.2 events-catalog 冻结 |
| 三套 catalog 组合机制并存（原地追加 / compose / merge） | §1.2 slice 模块制 + 整合波统一 composeCatalogs |
| 两套冻结策略词汇（`{deep}` vs `except-signal`）各走各的总线分支 | §1.1 策略词汇表 + §1.2 deep-freeze/events-bus 冻结 |
| features 顺序断言散落 6 个测试文件，挂载顺序一变全碎 | §1.2 冻结 index-events/index.test，顺序断言集中维护 |
| settings 分支给 catalog 条目加 `feature` 字段做订阅期 gating，与 tools 的挂载期排除并存 | §1.3 gating 唯一机制：挂载期 slice 排除 |
| `dsh.api` 被当成官方 runtime 版本号相等比较，bump 即自杀 | 版本号语义规范化（§4.2 全量唯一版本号），整合任务 2.10 |
