# Tasks: plugin-api-compaction-events-r1

> feature_name: `plugin-api-compaction-events-r1`
> 状态：Stage 4 交付完成（Requirements/Design/Tasks 已获批；每个顶层大任务经阻塞式子代理对抗性审查通过）
> 上游：`requirements.md`（49 条 AC，已批准）、`design.md`（已批准）
> 执行注：Stage 4 每完成一个**顶层大任务**（如 `1.x`）必须调用**一次**子代理做对抗性审查，并**阻塞等待其完成**（`run_in_background: false`）；通过后才进入下一顶层任务。审查只核对当前批次与 Tasks/Design/Requirements 的一致性，不向上溯源。未批准前不创建/修改任何实现产物。
> 测试约定：`node --test`；`lib/event-contract.js` 等纯函数模块保持零 harness 依赖；辅助包测试经 monorepo workspace 依赖运行。

---

## 1. 主包改名与 monorepo 骨架（req 1.1–1.7）

- [x] 1.1 建立 monorepo workspace
  - 新建 `pnpm-workspace.yaml`，包列表包含 `.` 与 `packages/*`；根包保持可独立安装。
  - 运行安装以确认根包现有测试仍可执行（`pnpm install --lockfile-only`；根 `node_modules/@deepseek-ai` 为官方安装目录的 symlink，禁止全量 install 触碰官方文件，故不执行会改写该 symlink 目标的 link 步骤）。
- [x] 1.2 主包改名与版本
  - 根 `package.json`：`name` → `@deepseek-ai/dsh-plugin-api-main`；`version` → `0.1.0-rc.6-0.4`；`dsh.api` → `0.4`；`exports` 形状不变。
  - `cordis.patch.yml`：行 id → `plugin-api-main`，name → `@deepseek-ai/dsh-plugin-api-main`；服务 key 保持 `pluginApi`。
- [x] 1.3 改名引用盘点与文档刷新（第一批）
  - 全仓库 grep `@deepseek-ai/dsh-plugin-api`、`plugin-api`（行 id 语境）、`0.1.0-rc.6-0.3`；
  - 修订 `AGENTS.md`、`README.md` 及受影响旧 spec 中的包名/行 id/版本引用；历史快照加权威指针（req 1.6/1.7）。
- [x] 1.4 回归
  - 运行现有 `node --test` 全绿（706/706）；`git diff --check` 通过。

## 2. 辅助包骨架与事件契约纯函数（req 1.3, 2.1–2.4, 5.1, 5.13）

- [x] 2.1 辅助包清单与 patch
  - 新建 `packages/compaction-events-r1/package.json`：name `@deepseek-ai/dsh-plugin-api-compaction-events`、version `0.1.0-rc.6-0.1`、`dsh.bundle.patch`、peerDependencies（与官方 compaction-basic 相同 + 官方包自身）、dependencies `@deepseek-ai/schemastery`、devDependencies `@deepseek-ai/dsh-app-boot`（仅用于 `composeEntries` patch 组合测试）、exports（`.`, `./package.json`）。
  - 新建 `cordis.patch.yml`：`- id: compaction-basic; disabled: true` + insert `compaction-events-r1` 行。
  - 测试：用官方 `composeEntries` 验证 disable+insert、移除恢复、缺席 id 语义。
- [x] 2.2 vendored fork 基底
  - 复制官方 `@deepseek-ai/dsh-compaction-basic@0.1.0-rc.6` 的 built `lib/index.js` 为 `packages/compaction-events-r1/lib/forked-engine.js`，文件头注明出处与 MIT；暂不加语义改动。
- [x] 2.3 事件契约纯函数
  - 新建 `lib/event-contract.js`：trigger 常量；request decision 校验（reject / replace-range / malformed）；payload 深冻结（排除 live agent/session）；redacted failure 构造。
  - 新建 `test/event-contract.test.mjs`（零 harness 依赖）。

## 3. ForkedEngine trigger 穿线与事件注入（req 3.1–3.7, 5.2–5.12, 5.14）

- [x] 3.1 trigger 穿线（先无事件）
  - 在 `forked-engine.js` 增加私有 `compactRegionInternal(start, end, agent, trigger, signal, sourceCommandId?)`；
  - 公开 `compactRegion` 委托 `'direct'`；`compactIfNeeded` 两次调用透传 `pressure`/`context-overflow`；`compactNow` 传 `'manual'` + `sourceCommandId`。
  - 测试：四个入口与官方等价行为（fake session/deps）。
- [x] 3.2 策略瀑布与哨兵
  - 在 `compactSurfaceRegion` 校验后、`session.append("compaction/start")` 前接入 `dispatchCompactionRequest`；实现 reject 哨兵 `COMPACTION_REJECTED` 与四条入口的返回值契约（`compactIfNeeded` 不重试、`compactNow`/`compactRegion` 返回 null）。
  - 测试：proceed/reject/replace/malformed/监听器 throw；reject 不写 durable 标记；重试循环不再发生。
- [x] 3.3 replace-range 五不变量复查
  - 实现新 range 的 `validateSurfaceRegion` 重跑、open-turn 重判定、`assertNoActiveCompaction` 复查；非法替换 log + 沿用原 range。
  - 测试：合法替换、各类非法替换回退。
- [x] 3.4 观察事件与失败时序
  - 注入 `started`（start 标记后、summarize 前）、`completed`（complete 后）、`failed`（catch/flushFailure 前、每事务一次）、`skipped`（reject 时）；
  - 显式支持 flush 失败 `completed`+`failed` 双事件；观察监听器故障 contain。
  - 测试：事件顺序、exactly-once、无 range 零事件、payload 深冻结、failed redaction。

## 4. 辅助包 apply 自检与 provider 决策（req 4.1–4.7）

- [x] 4.1 自检骨架
  - 新建 `lib/apply.js`：`{ name, inject: ['loader'], apply }`；inspectComposition（官方行 present-enabled / present-disabled / absent）；runtime identity 读取（dsh-llm + dsh-compaction-basic）；契约符号 `Symbol.for(...)`。
- [x] 4.2 provider 决策矩阵
  - 实现 versionOk × 组成态 3×2 矩阵、post-register 自检失败回滚 inert、同行冲突（已存在非本符号 provider → inert）、版本不匹配 fallback（官方包可解析时注册官方 `BasicCompactionEngine`）。
  - 测试：fake loader entries 覆盖全部单元格 + 冲突 + idempotent re-apply + 永不抛穿 apply。

## 5. 主包 R catalog 机制（req 6.1–6.4）

- [x] 5.1 R slice 定义
  - 新建 `lib/compaction-events-catalog.js`：5 个 entry（`type:'R'`、mode、`scopeKey:null`、fault/freeze、payload 描述）+ `isActive` guard（loader 条目 active + `ctx.get('compaction')` 契约符号）。
- [x] 5.2 events-bus 扩展
  - `createEventsBus` 接收 `rSlices`；内部 `catalogEntryOf` 用静态全集；对外 `catalog` 改为 accessor，按 guard 过滤并 deepFreeze；duplicate R name 沿用 fail-loud。
  - 测试：guard true/false 可见性；订阅包装、fault/freeze 生效；duplicate fail-loud。
- [x] 5.3 主包接线
  - `mountEventsFeature` 传入 compaction R slice；验证 `pluginApi.events.catalog` 动态可见性且主包不 import 辅助包。
  - 测试：catalog 集成 + 无辅助包时 catalog 不含 R 条目。

## 6. 主包版本与全量回归（req 1.1–1.2, 6.1–6.2）

- [x] 6.1 版本协商更新
  - 更新版本相关测试/断言到 `0.1.0-rc.6-0.4` / `dsh.api 0.4`。
- [x] 6.2 全量回归
  - 根与辅助包 `node --test` 全绿；`composeEntries` 组合测试；`git diff --check`。

## 7. 消费者迁移（req 7.1–7.3, 1.1 改名连带）

- [x] 7.1 dsh-read-image B4 消费
  - 在 `../dsh-read-image` 增加 `compaction/completed` 监听：按 `shadowedSeqs` 判定 `[Image #N]` 索引失效并给出可读提示；无 shadowed 图片时不提示。
  - 更新其 package.json 对主包新名的引用。
- [x] 7.2 dsh-pro-ex-ability-anchor 引用同步
  - 更新根 `package.json` 与 `panel/package.json` 中对主包新名的引用（req 1.1）。
- [x] 7.3 迁移验收
  - headless 冒烟通过；dev profile boot 通过；模拟 compaction 触发 stale-index notice。

## 8. 治理登记与交付审计（req 1.6–1.7, 8.1–8.3）

- [x] 8.1 登记
  - `docs/specs/plugin-api-features/feature-list.md` U8 状态更新；`AGENTS.md` §8 追加本 feature 条目；`README.md` 同步 R 通道说明。
- [x] 8.2 旧文档新鲜度终扫
  - 更新受影响旧 spec（尤其 catalog schema 增加 `'R'` 的 events/semantic-hooks 相关描述）；无法修订的历史快照加权威指针；交付清单人工核对。
- [x] 8.3 交付审计
  - 官方包文件 checksum 断言未修改（`test/official-fork-integrity.test.mjs`，pin `dsh-compaction-basic@0.1.0-rc.6`）；全套测试通过（dsh-plugin-api 根 759/759、辅助包 45/45、dsh-read-image 29/29、dsh-pro-ex-ability-anchor 123/123）；`git diff --check` 通过；headless smoke + dev boot HTTP 200 通过；Stage 4 完成提交。

---

## 覆盖检查

| requirements | 任务 |
|---|---|
| §1 命名/文档 | 1.1–1.4, 7.2, 8.2 |
| §2 装配可逆 | 2.1 |
| §3 官方契约 | 2.2, 3.1 |
| §4 自检矩阵 | 4.1–4.2 |
| §5 事件语义 | 2.3, 3.1–3.4 |
| §6 catalog | 5.1–5.3, 6.1 |
| §7 B4 迁移 | 7.1, 7.3 |
| §8 上游/退役 | 8.1, 8.3 |
