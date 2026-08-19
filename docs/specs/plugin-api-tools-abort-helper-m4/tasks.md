# Tasks: plugin-api-tools-abort-helper-m4

> feature_name: `plugin-api-tools-abort-helper-m4`
> 状态：Stage 3 草案（待用户批准）
> 上游：`requirements.md`（已批准）、`design.md`（已批准）
> 测试约定：`node --test`；`lib/tool-abort.js` 为纯模块（零 import、零 harness 依赖）；真实官方 identity 测试用惰性动态 import + 缺包 skip（不硬依赖 peer-only 包）。
> 执行注（AGENTS.md §3.2）：Stage 4 顶层大任务/批次完成后，每个批次调用一次**阻塞式**子代理对抗性审查，批准后进入下一批次。

---

## 1. 纯工厂模块与纯单测（req 1.1–1.4, 2.1–2.5, 3.1, 3.3, 4.1–4.4, 4.6）

- [ ] 1.1 测试环境基线
  - 确认/安装本 worktree 测试所需依赖（`@deepseek-ai/dsh-llm` 等 peer 包），使现有 `node --test` 可执行且全绿（镜像 compaction-events-r1 task 1.1 的安装确认）。
- [ ] 1.2 新建 `lib/tool-abort.js`（纯工厂模块）
  - 导出 `createToolAbortedErrorFactory(deps)`，`deps = { HarnessError, TOOL_ABORTED }`，零 import；
  - 全量模式（`HarnessError` 为函数且 `TOOL_ABORTED` 为字符串）：返回 `() => { const e = new HarnessError('tool call aborted', TOOL_ABORTED); e.name = 'AbortError'; return e }`；
  - 降级模式（否则）：返回 `() => { const e = new Error('tool call aborted'); e.name = 'AbortError'; return e }`；
  - 模式在**工厂创建时决定一次**（闭包不含运行时判断 → req 3.3 稳定性）；每次调用新实例、不冻结；函数不声明形参（无视多余实参 → req 1.2）。
  - 文件头 JSDoc 说明职责与两模式。
- [ ] 1.3 新建 `test/tool-abort.test.mjs`（零 harness 纯单测）
  - 全量（注入 stub `HarnessError` 类 + `TOOL_ABORTED: 'ABORTED'`）：
    - `instanceof stub`、`name==='AbortError'`、`code==='ABORTED'`、`message==='tool call aborted'`（req 2.1–2.3）；
    - `{name,code,message}` 与“同一 stub 按官方配方 `new HarnessError('tool call aborted', TOOL_ABORTED)`+`name='AbortError'`”深等（req 2.4）；
    - 两次调用非同一实例、未冻结、可继续写属性（req 1.3）；多余实参被忽略且返回身份不变（req 1.2）；
    - errorInfo 等价提取 `{name, code}` === `{name:'AbortError', code:'ABORTED'}`（req 2.5 非降级前提）。
  - 降级：`createToolAbortedErrorFactory({})` 与缺 `TOOL_ABORTED` 分支 → 裸 `Error`（`!instanceof stub`）、`name==='AbortError'`、`message==='tool call aborted'`、无 `code`（req 3.1）；同一工厂多次调用模式稳定（req 3.3）。
  - 边界：`HarnessError` 非函数 / `TOOL_ABORTED` 非字符串 各分支。

## 2. 解析接线与门面双态挂载 + 集成测试（req 1.1, 1.5, 3.2, 3.4, 4.6）

- [ ] 2.1 `lib/index.js` 新增命名导出 `buildToolAbortedErrorFactory(resolveModule = require)`
  - 复用模块级 `const require = createRequire(import.meta.url)`；
  - `try { const dshTools = resolveModule('@deepseek-ai/dsh-tools'); return createToolAbortedErrorFactory({ HarnessError: dshLlm?.HarnessError, TOOL_ABORTED: dshTools?.TOOL_ABORTED }) } catch { return createToolAbortedErrorFactory({ HarnessError: dshLlm?.HarnessError }) }`；
  - 任何解析失败只降级、绝不向外抛（req 3.2）；不新增顶层层级 import 官方包。
- [ ] 2.2 apply 接线
  - 在 `apply` 内、`createPluginApiService({...})` 之前**调用一次** `buildToolAbortedErrorFactory()`，把稳定工厂作为 `toolAbortedErrorFactory` 选项传入（首 apply 决定一次，随复用服务实例贯穿 re-apply，不改 reconcile 分支）。
- [ ] 2.3 `lib/plugin-api-service.js` 双态挂载
  - `createPluginApiService` 新增可选参数 `toolAbortedErrorFactory`（默认降级安全工厂），构造函数存 `this._toolAbortedErrorFactory`；
  - `tools` getter 的 active 分支改为 `createToolsApi(resolveTools, routeOf, this._toolAbortedErrorFactory)`；
  - `createToolsApi(resolveTools, routeOf, toolAbortedErrorFactory)` 冻结面新增 `toolAbortedError() { return toolAbortedErrorFactory() }`——**不调用** `tools()` 服务（req 1.4 语义）；
  - `createDisabledToolsApi(active, routeOf)` 新增 `toolAbortedError: fail`：core 未激活抛 `PluginApiInactiveError`，tools feature 禁用抛 `PluginApiFeatureDisabledError('tools')`（req 1.5）。
- [ ] 2.4 新建 `test/index-tools-abort.test.mjs`（门面集成，走 apply + mock ctx，镜像现有 index-* 测试）
  - disabled 态：`pluginApi.tools.toolAbortedError` 存在且可调用；调用抛 `PluginApiFeatureDisabledError('tools')`；`tools.isActive === false`（req 1.5）；
  - active 态：返回对象 `name==='AbortError'`；`code==='ABORTED'` 的断言在 dsh-tools 可解析时成立（测试环境经真实 resolver），否则仅锁 `name` 与降级形状；用 mock 的 `ctx.get('tools')` 断言**未**被调用（req 1.4）；
  - fail-safe：`buildToolAbortedErrorFactory(() => { throw … })` / `(() => ({}))` → 返回可用降级工厂、不抛（req 3.2，经注入 resolveModule 模拟缺包）；`apply` 全程不抛。

## 3. 真实官方 identity 测试 + peerDependency + 全量回归（req 2.1–2.4, 4.4, 5.4）

- [ ] 3.1 新建 `test/tool-abort-official.test.mjs`（真实官方类，锁定 AC 2.1–2.4）
  - `import { HarnessError } from '@deepseek-ai/dsh-llm'`（硬 peer，可直接 import）；
  - `await import('@deepseek-ai/dsh-tools')` 包 try/catch：成功 → 取真实 `TOOL_ABORTED`，断言 `instanceof HarnessError === true`、`code === TOOL_ABORTED`、`{name,code,message}` 与真实官方配方深等；失败 → `test.skip`（缺包绝不使测试文件加载期崩溃）。
- [ ] 3.2 `package.json` peerDependencies 新增 `"@deepseek-ai/dsh-tools": "^0.1.0-rc.6"`
  - 声明诚实（直接消费其公开导出）；运行时仍走惰性解析、缺包降级（声明与容错并存，req 3.2/4.4）。
- [ ] 3.3 全量回归
  - `node --test` 全绿（含既有全部测试 + 本 feature 新增测试）；`git diff --check` 通过；
  - 版本协商断言**不因本 feature 而改变**（不自改 version / `dsh.api`；req 5.4 不 bump）。当前已登记边界为 `0.1.0-rc.6-0.4` / `dsh.api 0.4`（由 `plugin-api-compaction-events-r1` 承接、已交付）；若 Stage 4 执行时工作区实际边界不同，断言以当时生效边界为准并在交付报告记录，必要时与 M4 integration 对账。

## 4. 治理登记（req 5.1–5.4）

- [ ] 4.1 feature-list 登记
  - `docs/specs/plugin-api-features/feature-list.md` §2.6 追加一行（拟 `T11 工具中止错误构造`，类型 `A`、milestone `M4`、status `delivered`、附 `dsh-tools`/`dsh-llm`/`dsh-tool-bash` 出处）；
  - §4 迁移验收表新增 `dsh-pro-ex-ability-anchor` 的 `loadAbortedErrorFactory` → `pluginApi.tools.toolAbortedError()` 行（req 5.1/5.2）。
- [ ] 4.2 AGENTS.md §8 登记
  - 追加 `plugin-api-tools-abort-helper-m4` 条目（范围/状态/spec 目录/关键约束/版本不定界说明）（req 5.3/5.4）。
- [ ] 4.3 登记一致性核查
  - 复核 feature-list 状态与 AGENTS §8 条目一致；无遗留旧版本断言（本 feature 不 bump，仅核查不自改）。

## 5. dsh-pro-ex-ability-anchor 迁移验收（req 6.1–6.3；验收证据，非实现目标）

- [ ] 5.1 迁移编辑（跨仓库）
  - 在 `../dsh-pro-ex-ability-anchor`：删除 `loadAbortedErrorFactory`（`lib/index.js:290-308`）；
  - 替换唯一调用点（`lib/index.js:384`）为 fiber ctx 解析 + 兜底：
    `const makeAbortedError = () => { const p = typeof ctx.get==='function' ? ctx.get('pluginApi') : undefined; const f = p?.tools?.toolAbortedError; return typeof f==='function' ? f() : <裸 AbortError 兜底> }`；
  - 兜底保留当前裸 `Error` 命名 `AbortError` 行为（退出 `pluginApi.tools` 不可达时的可识别性）。
- [ ] 5.2 迁移验收
  - pro-ex headless 冒烟通过、dev boot 通过（req 6.1–6.2）；
  - 若窗口内无法完成迁移：在交付报告中显式记录豁免理由（req 6.3）；本仓库自身 §2 typed identity 契约测试不受影响。

## 6. 交付审计（工程基线）

- [ ] 6.1 交付审计
  - 全量 `node --test` 绿；`git diff --check` 通过；官方 `@deepseek-ai/dsh-*` 包文件未被修改（checksum/未触碰调查）；无临时脚本残留（`temp/` 用完即删）；
  - Stage 4 完成提交：实现、测试、规格与登记全部入库（AGENTS.md §3.2 阶段提交+完成提交规约）。

---

## 覆盖检查

| requirements | 任务 |
|---|---|
| §1 形状（1.1–1.5） | 1.2–1.3, 2.3–2.4 |
| §2 typed identity（2.1–2.5） | 1.2–1.3, 3.1 |
| §3 fail-safe（3.1–3.4） | 1.2–1.3, 2.1, 2.4, 3.2 |
| §4 边界（4.1–4.6） | 1.2–1.3, 2.3, 3.2 |
| §5 治理登记（5.1–5.4） | 3.3, 4.1–4.3 |
| §6 迁移验收（6.1–6.3） | 5.1–5.2 |
