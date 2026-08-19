# Tasks: plugin-api-session-title-r1

> feature_name: `plugin-api-session-title-r1`
> 状态：Stage 3 草案（待对抗性审查与用户批准）
> 上游：`requirements.md`（Stage 1 已批准，含 Stage 2 同步的 R-5.11 修订）、`design.md`（Stage 2 已批准）
> 基线：worktree 已 rebase 到 main `bacf593`（compaction-events-r1 已交付：主包 `@deepseek-ai/dsh-plugin-api-main@0.1.0-rc.6-0.4`、`rSlices` 机制在位）。本分支只做追加/新建，不重造 R-slice 机制、不改 frozen files。
> 执行注：Stage 4 每完成一个**顶层大任务**（`1.x`–`8.x`）必须调用**一次**子代理做对抗性审查，并**阻塞等待其完成**（`run_in_background: false`）；通过后才进入下一顶层任务。审查只核对当前批次与 Tasks/Design/Requirements 的一致性，不向上溯源。
> 测试约定：`node --test`；`lib/event-contract.js` 等纯函数模块保持零 harness 依赖；辅助包测试经 monorepo workspace 依赖运行（同 compaction-events-r1）。

---

## 1. 辅助包骨架与 patch 装配（req 1.1–1.3, 2.1–2.4, 3.6）

- [ ] 1.1 辅助包清单
  - 新建 `packages/session-title-r1/package.json`：name `@deepseek-ai/dsh-plugin-api-session-title`、version `0.1.0-rc.6-0.1`、`type: module`、`main: lib/index.js`、`exports`（`.`、`./invariant`、`./package.json`）、`dsh.bundle.patch: ./cordis.patch.yml`、`scripts.test: node --test`。
  - peerDependencies 按 design C2：官方 `dsh-session-title` 的 peer 集（`@deepseek-ai/cordis@^4.0.1`、`@deepseek-ai/dsh-brand@^0.1.0-rc.6`、`@deepseek-ai/dsh-invariants@^0.1.0-rc.6`、`@deepseek-ai/dsh-llm@^0.1.0-rc.6`、`@deepseek-ai/dsh-session@^0.1.0-rc.6`、`@deepseek-ai/dsh-session-projection@^0.1.0-rc.6`）+ 精确 `@deepseek-ai/dsh-session-title@0.1.0-rc.6`；dependencies `zod@^4.4.3`、`@deepseek-ai/schemastery@^3.18.1`；devDependencies `@deepseek-ai/dsh-app-boot@^0.1.0-rc.6`（仅 `composeEntries` 测试）。
  - 包目录自动进入 `packages/*` workspace（`pnpm-workspace.yaml` 已由 compaction 交付），不新建/修改 workspace 骨架。
  - 测试：辅助包源码不 import `@deepseek-ai/dsh-plugin-api-main`，`packages/session-title-r1` 可独立 `node --test`（req 1.3）。
- [ ] 1.2 patch 装配
  - 新建 `packages/session-title-r1/cordis.patch.yml`：`- id: session-title; disabled: true` + insert 行 `id: session-title-r1`、`name: '@deepseek-ai/dsh-plugin-api-session-title'`、`config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 }`（design C2/D6）。
  - 新建 `packages/session-title-r1/test/patch-composition.test.mjs`：用官方 `composeEntries` 验证 disable+insert、移除恢复、官方行缺席时 disable 告警跳过而 insert 生效、后续层只写 `config` 不复位 `disabled`（design C3 config 连续性前提）。
- [ ] 1.3 invariant companion
  - 新建 `packages/session-title-r1/lib/invariant.js`：注册本包名 `@deepseek-ai/dsh-plugin-api-session-title` 的 no-op companion（本包不新增 durable event 类型）；`inject: ['invariants']`、`apply(ctx) => ctx.invariants.register(...)`，结构镜像 `dsh-session-title/lib/invariant.js`。
  - 测试：companion 可被 `exports["./invariant"]` 解析且导出 `{ apply, inject, name }` 形状。
- [ ] 1.4 官方包文件不可变审计基线
  - 记录 `@deepseek-ai/dsh-session-title@0.1.0-rc.6` 与 `dsh-base` 包文件清单/校验（供任务 8.3 交付审计对比）；不修改任何 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 文件（req 2.3）。

## 2. 事件契约纯函数（req 5.1, 5.4–5.8, 5.11）

- [ ] 2.1 `lib/event-contract.js`
  - 新建 `packages/session-title-r1/lib/event-contract.js`（零 harness 依赖）：`SESSION_TITLE_CANDIDATE = 'session-title/candidate'`；`DECISION`（proceed/exclude/replace/malformed）；`decideSessionTitleCandidate(value)` 校验（undefined→proceed；`{kind:'exclude', reason?:string}`；`{kind:'replace', message:{seq:number}, reason?:string}`；thenable/其他形状→malformed）。
  - `buildSessionTitleCandidatePayload(agent, session, message)`：`message` 与其 `source` 深冻结、`agent`/`session` 保持 live 引用（R-5.11 修订后语义）。
  - `resolveReplacement(session, message, throughSeq?)` 纯判定：`session.events[seq]` 存在、`event.seq === seq`、`type === 'user/message'`、`source.kind === 'user'`、规范化文本非空、`seq <= throughSeq`（design Data Models）。
  - `redactedFailure`/诊断构造：不输出候选文本/标题文本/session 正文。
- [ ] 2.2 `test/event-contract.test.mjs`
  - 覆盖：四种决策、reason 类型校验、replace seq 非法（非整数/越界/非 user/空文本/超 throughSeq）、thenable 收敛、payload 冻结（message/source frozen、agent/session 可写）、redaction。
  - 纯函数测试不 import 主包/Cordis（req 5.4–5.8、5.11）。

## 3. vendored fork 与候选策略注入（req 3.1–3.5, 5.2–5.13）

- [ ] 3.1 vendored 基底与完整性
  - 新建 `packages/session-title-r1/lib/forked-service.js`：复制官方 `@deepseek-ai/dsh-session-title@0.1.0-rc.6/lib/index.js`，文件头注明出处与 MIT；本任务先不加语义改动。
  - 新增 `packages/session-title-r1/test/official-fork-integrity.test.mjs`：与官方包同文件对比公开导出集、`static inject`、`static Config` 键集、`SessionTitleService` 公开方法（get/rename/refresh/register）签名长度；记录官方无自有事件 dispatch 的事实（req 3.5 条件性满足）。
- [ ] 3.2 策略感知候选采集与五处调用点改写
  - 在 `forked-service.js` 打 `// R-class patch:` 增量：契约符号 `Symbol.for('dsh-plugin-api.session-title-r1.active')`（构造器 `defineProperty`）；内部 `collectEligible(session, events, throughSeq?)`；`dispatchCandidatePolicy(ctx, payload)`（`ctx.waterfall(..., () => undefined)`，先返回者胜，throw/thenable 收敛）。
  - 按 design C4 改写：`onUserMessage` 单次采集（调度期筛选）；`refresh` 单次采集并把 `messages` 存入 `pending/work`、fallback 分支透传 `ensureFallback(session, messages)`；`runProvider` 用 `work.messages ?? collectEligible(...)`、空候选时跳过 `provider.generate()` 走官方 no-candidate 结局；`ensureFallback(session, precomputed?)` 私有参数。
  - `agent` 懒解析：`ctx.get('agents').list()` 按 `agent.session.id === session.id` 反查，缺失/失败为 `undefined`（design C4）。
  - 保持公开导出、`collectSessionTitleMessages` 等纯函数与官方逐名一致（req 3.1/3.6）。
- [ ] 3.3 `test/forked-service.test.mjs`
  - fake ctx/session 覆盖：零监听器与官方行为逐项等价（fallback 首候选、first-prompt `messages[0]`、provider cadence、rename 不受策略影响、durable append 形状，req 5.2/5.12）；exclude/replace/malformed/throw/thenable 各结局（5.4–5.8）；每 generation attempt 每候选至多一次 dispatch 与调度期筛选边界（5.3）；同一策略后候选集被 fallback 与 provider 共享（5.9）；空候选（5.10）；payload 不可变（5.11）；无采集不派发（5.13）。

## 4. 辅助包 apply 自检矩阵（req 4.1–4.7, design C3）

- [ ] 4.1 `lib/apply.js` 与 `lib/index.js` 入口
  - 新建 `packages/session-title-r1/lib/apply.js`：`{ name: 'dsh-plugin-api-session-title', inject: ['loader'] }`；`inspectComposition`（按 `options.id === 'session-title'` 优先、name `@deepseek-ai/dsh-session-title` 回退）；`readPackageVersion('@deepseek-ai/dsh-llm') === '0.1.0-rc.6' && readPackageVersion('@deepseek-ai/dsh-session-title') === '0.1.0-rc.6'`。
  - `resolveSessionTitleConfig(ctx, ownConfig)` config 连续性：官方行 entry 存在时读 `entry.options.config`，按官方同款校验（三正整数 + `fallbackMaxBytes <= maxTitleBytes`）合法则采用，否则回退本行 config + 诊断；全 try/catch。
  - provider 决策矩阵与同行冲突：已有 `ctx.sessionTitle` 带本符号→idempotent return；存在非本符号→log+inert；versionOk × {present-enabled→inert, present-disabled/absent→`ctx.plugin(ForkedSessionTitleService, config)`}；mismatch × {present-enabled→inert, present-disabled/absent→官方 `SessionTitleService` 可解析则 fallback 注册，否则 inert+loud}。
  - post-register 自检：`ctx.get('sessionTitle')` 可解析、get/rename/refresh/register callable、契约符号存在、`typeof ctx.waterfall === 'function'`；失败→dispose 回滚+log+inert。
  - 提供 `createSessionTitleApply(overrides)` 测试 seam（readPackageVersion/forkedEngine/officialEngine/officialAvailable）；默认导出 `apply`；`lib/index.js` 转发 `./apply.js`。
- [ ] 4.2 `test/apply.test.mjs`
  - fake loader entries 覆盖 versionOk × 组成态 3×2 矩阵全部单元格；同行冲突（既有非本符号 provider）；idempotent re-apply；post-register 失败回滚 inert；config 连续性（官方行合法自定义 config 生效 / 非法回退本行 config / 官方行缺席用本行 config）；任何探针抛错不抛穿 apply（4.5）。

## 5. 主包 R-slice 集成（req 6.1–6.4, 3.7）

- [ ] 5.1 `lib/session-title-events-catalog.js`
  - 新建主包 slice 模块：`sessionTitleEventsCatalogSlice = { name: 'session-title-r1', entries, isActive }`；entry 按 design C1/C5（`type:'R'`、`mode:'waterfall'`、`scopeFiltered:false`、`scopeKey:null`、`payload/args` 描述、`fault:'contain'`、`freeze:{deep:['message']}`、`feature:'plugin-api-session-title-r1'`）。
  - `isSessionTitleReplacementActive(ctx)` guard：loader 条目 name `@deepseek-ai/dsh-plugin-api-session-title` active + `ctx.get('sessionTitle')` 带契约符号；全 try/catch 返回 false。主包不 import 辅助包（仅共享 `Symbol.for` 字面量）。
- [ ] 5.2 主包接线
  - `lib/index.js`：import 本 slice；`createEventsBus({ ..., rSlices: [compactionEventsCatalogSlice, sessionTitleEventsCatalogSlice], ... })`（追加式，不改 compaction slice 与 events-bus）。
  - 回归既有 catalog 测试不回归；新增 `test/session-title-catalog.test.mjs`：guard true 时公开 `pluginApi.events.catalog['session-title/candidate']` 存在且元数据正确；guard false/无辅助包时公开 catalog 不含该条目；订阅静态元数据可用；`pluginApi.events.on('session-title/candidate', ...)` waterfall 决策与 `next()` 透传（用 fake ctx 驱动事件总线）；facade 未挂载/不订阅时 raw `ctx.on('session-title/candidate', ...)` 直连可观察（req 6.3）。
  - 同步更新 `test/compaction-events-catalog.test.mjs` 中 `rSlices: [compactionEventsCatalogSlice]` 的精确子串断言为追加后的 `rSlices: [compactionEventsCatalogSlice, sessionTitleEventsCatalogSlice]`（该文件非 frozen，追加切片后必须保持其回归绿）。
- [ ] 5.3 SV13 直通回归
  - 新增/扩展测试：替代 provider fake（带契约符号）下 `pluginApi.services.sessionTitle.get/rename/refresh/register` 仍按原直通路径解析到同一服务对象（req 3.7）；官方行为面不被 catalog 扩展改变。

## 6. 主包版本协商更新（req 1.1–1.2, design C1/C6）

- [ ] 6.1 版本 bump `0.1.0-rc.6-0.4` → `0.1.0-rc.6-0.5` / `dsh.api` `0.4` → `0.5`
  - `package.json`：`version: 0.1.0-rc.6-0.5`、`dsh.api: 0.5`。
  - `lib/version.js` 注释示例、`test/version.test.mjs` 解析示例、`test/package.test.mjs`（`pkg.version === '0.1.0-rc.6-0.5'`、`dsh.api === '0.5'`、协议 0.4→0.5 数字递增且不触碰保留的 1.0）、`test/index.test.mjs` 的 `apiVersion === '0.5'`。
  - 顺带：`test/session-durable-anchor-mapping.test.mjs` 中 `createPluginApiService({ apiVersion: '0.4', ... })` 夹具字面量同步为 `'0.5'`（非断言点，仅保持一致性）。
- [ ] 6.2 全量回归
  - 根包与 `packages/session-title-r1`、`packages/compaction-events-r1` 的 `node --test` 全绿；`git diff --check`；确认主包在辅助包未安装时行为不变。

## 7. pro-ex 迁移与验收（req 7.1–7.3，证据非目的）

- [ ] 7.1 迁移 fixture 与配方
  - 在本仓库 `test/` 或 `packages/session-title-r1/test/` 增加 anchor-scenario fixture：合成 `source.form === ANCHOR_USER_SOURCE_FORM` 的虚拟 user message + 后续真实 user message，验证 `exclude` 后 fallback 与 first-prompt provider 的 `messages[0]` 均来自真实消息（与 design C7 映射一致）。
  - 记录迁移配方（design C7 的监听器代码）供 pro-ex 仓库执行。
- [ ] 7.2 pro-ex 迁移执行（跨仓库，按 design C7 与 pro-ex 独立获批任务）
  - 在 `../dsh-pro-ex-ability-anchor` 删除标题纠偏代码（`lib/index.js:574-691`），代之以 `pluginApi.events.on('session-title/candidate', ...)` 的 exclude 监听器；若该仓库迁移任务尚未获批，本任务阻塞上报，不夹带跨仓库未获批改动。
  - 更新其对本仓库主包新名 `@deepseek-ai/dsh-plugin-api-main` 的引用（若 compaction 迁移批次未完成）。
- [ ] 7.3 迁移验收
  - headless 冒烟通过；dev profile boot 通过（replacement 行 active，`ctx.sessionTitle` 契约符号在位）；锚定会话标题来自真实消息而非虚拟消息；验收结果仅作为 API 形状证据记录（7.3）。

## 8. 治理登记与交付审计（req 1.4–1.7, 8.1–8.3）

- [ ] 8.1 登记
  - `docs/specs/plugin-api-features/feature-list.md`：U9（官方 session-title 候选资格 / 合成消息排除）入上游提案表，并记录**退役条件**（官方等价 seam 落地后辅助包 deprecate/退役，replacement 为 current workaround，req 8.2）；本 feature 对应行/类型标注补 R 类登记。
  - `AGENTS.md` §8 表尾追加 `plugin-api-session-title-r1` 条目（范围、状态、spec 目录、关键约束）；§2/§4 仅在与能力边界相关处同步（本 feature 不改变 A/B/C/R 边界，故主要核对而非改写）。
  - `docs/capability-strategy.md` §5 矩阵补 session-title 行（R 类，U9 workaround）。
- [ ] 8.2 旧文档新鲜度终扫
  - grep 盘点受影响引用：catalog 条目总数（如 README/旧 spec 中 47/48 条等计数）、`0.1.0-rc.6-0.4`/`0.4` 的现行权威版本指向、主包/辅助包命名；就地追加/修订或对历史快照加权威指针（1.4/1.5）。
- [ ] 8.3 交付审计与 Stage 4 提交
  - 官方包文件校验对比任务 1.4 基线，断言未修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**`；根与两个辅助包测试全绿；`git diff --check`；提交本 Stage 的实现、测试、规格与治理登记。

---

## 覆盖检查

| requirements | 任务 |
|---|---|
| §1 命名/文档新鲜度 | 1.1–1.4, 6.1, 8.2 |
| §2 装配可逆 | 1.1–1.2, 1.4 |
| §3 官方契约复刻 | 3.1–3.3, 5.3 |
| §4 自检矩阵 | 4.1–4.2 |
| §5 候选策略语义 | 2.1–2.2, 3.2–3.3 |
| §6 catalog 集成 | 5.1–5.2 |
| §7 pro-ex 迁移 | 7.1–7.3 |
| §8 上游/退役/治理 | 8.1–8.3 |
| design C1 主包版本 0.5 | 6.1–6.2 |
| design C3 config 连续性 | 1.2（前提验证）, 4.1–4.2 |
