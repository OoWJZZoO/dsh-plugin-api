# Design: plugin-api-tools-abort-helper-m4

> feature_name: `plugin-api-tools-abort-helper-m4`
> 状态：Stage 2 草案（待对抗性审查与用户批准）
> 上游：`requirements.md`（Stage 1 已批准，§1–§6 编号 AC）、`AGENTS.md` §2/§4/§6、`docs/specs/plugin-api-features/feature-list.md` §2.6、`docs/specs/plugin-api-tools-m1/`（`pluginApi.tools` 命名空间契约）、`dsh-pro-ex-ability-anchor/lib/index.js`
> 类型：A 类（官方公开常量/类的稳定化 helper，无新语义）；host-only，无 client bundle。

---

## Overview

本 feature 在 `pluginApi.tools` 命名空间上新增一个**零依赖、纯构造**的成员 `toolAbortedError(): Error`，返回与官方 dsh-tool-bash / dsh-tool-pwsh 完全等价的“工具调用已中止”错误（见 requirements §2 的 typed identity）。实现极小：一个新纯模块 + 门面两处薄挂载 + 一处惰性常量解析，不新增事件、不新增错误分类、不接管 abort/超时逻辑。

两个关键不变量：

1. **typed identity 由官方公开导出决定**：官方常量可用时，返回 `new HarnessError('tool call aborted', TOOL_ABORTED)` + `name='AbortError'`（`HarnessError` ← `@deepseek-ai/dsh-llm` 根导出；`TOOL_ABORTED` ← `@deepseek-ai/dsh-tools` 根导出）。返回值在 `{name, code, message}` 上深等官方配方（requirements 2.4）；抛出后经官方 runtime 物化的 `error.info` 与官方 canonical `toolAbortedResult` 逐字段相等，agent loop 原样识别（requirements 2.5 + 1.4）。
2. **fail-safe 双路径**：官方常量不可用 → 纯模块内部降级为裸 `Error`（`name='AbortError'`，无 `code`，requirements 3.1）；tools feature 禁用 → 按门面禁用契约抛 typed `PluginApiFeatureDisabledError('tools')`（requirements 1.5）。两条路径互斥、均不抛穿 apply（requirements 3.2）。

---

## Architecture

```mermaid
flowchart LR
  subgraph apply["apply() · lib/index.js（fail-safe）"]
    resolver["buildToolAbortedErrorFactory(resolveModule?)<br/>惰性 + try/catch，绝不抛穿 apply"]
    svc["createPluginApiService({ …, toolAbortedErrorFactory })"]
  end
  resolver -->|"HarnessError ← dshLlm（静态）<br/>TOOL_ABORTED ← createRequire('@deepseek-ai/dsh-tools')（惰性、可缺失）"| factory
  factory["createToolAbortedErrorFactory(deps)<br/>lib/tool-abort.js · 纯模块（零 import）"]
  factory -->|deps 齐备| full["toolAbortedError() →<br/>HarnessError{ name:'AbortError', code:'ABORTED', message:'tool call aborted' }"]
  factory -->|deps 缺失| degraded["toolAbortedError() →<br/>Error{ name:'AbortError', message:'tool call aborted' }（无 code）"]
  svc -->|tools feature active| getter
  getter["pluginApi.tools getter（每次求值）"]
  getter --> tools["createToolsApi(resolveTools, routeOf, toolAbortedErrorFactory)"]
  svc -->|tools feature disabled| disabled["createDisabledToolsApi → toolAbortedError: fail"]
  tools -->|pluginApi.tools.toolAbortedError()| full
  tools -->|pluginApi.tools.toolAbortedError()| degraded
  disabled -->|pluginApi.tools.toolAbortedError()| throw["PluginApiFeatureDisabledError('tools')"]
```

- **`lib/tool-abort.js`** 是唯一实现核心；`lib/plugin-api-service.js` 只负责把它挂到两个门面态；`lib/index.js` 负责惰性解析官方导出（一次性）。三者职责单一、可独立测试。
- 常量解析**只发生一次**（apply 内、创建服务前），结果作为稳定工厂注入服务 → 满足 requirements 3.3（host 生命周期内行为稳定）。

---

## Components and Interfaces

### C1. `lib/tool-abort.js` —— 纯工厂模块（新文件）

零 import、零 harness 依赖（镜像 `lib/deep-freeze.js` 模式），导出单一函数：

```js
/**
 * @param {{ HarnessError?: Function, TOOL_ABORTED?: string }} deps
 *   官方公开导出；任一项缺失即走降级路径。
 * @returns {() => Error} 稳定工厂：每次调用返回一个新建、未冻结、可抛掷的 Error。
 */
export function createToolAbortedErrorFactory(deps)
```

- **全量模式**（`typeof deps.HarnessError === 'function'` 且 `typeof deps.TOOL_ABORTED === 'string'`）：返回 `() => { const e = new deps.HarnessError('tool call aborted', deps.TOOL_ABORTED); e.name = 'AbortError'; return e }`。
- **降级模式**（否则）：返回 `() => { const e = new Error('tool call aborted'); e.name = 'AbortError'; return e }`。
- 模式在**工厂创建时决定一次**（闭包内不含运行时判断）→ 满足 3.3 稳定性；两次调用返回独立实例、不冻结 → 满足 1.3；函数不声明形参 → 天然忽略多余实参（1.2）。

### C2. `lib/index.js` —— 惰性解析 + apply 接线

- 新增命名导出（镜像 `mountExecRouteFeature` 等可测模式），默认使用 `lib/index.js` 已有的模块级 `const require = createRequire(import.meta.url)`：
  ```js
  export function buildToolAbortedErrorFactory(resolveModule = require) {
    try {
      const dshTools = resolveModule('@deepseek-ai/dsh-tools')
      return createToolAbortedErrorFactory({
        HarnessError: dshLlm?.HarnessError,   // 已有静态 import，天然可用
        TOOL_ABORTED: dshTools?.TOOL_ABORTED, // dsh-tools 可缺失 / 导出可缺失
      })
    } catch {
      return createToolAbortedErrorFactory({ HarnessError: dshLlm?.HarnessError })
    }
  }
  ```
  - `resolveModule` 可注入，单测可用“抛错/空对象”模拟 `@deepseek-ai/dsh-tools` 缺失 → 直接覆盖 3.2 的可失败解析路径，不需要真实操作 node_modules。
  - 任何解析失败只导致该工厂降级，`try/catch` 保证**绝不向外抛**（3.2）。
- 在 apply 内、`createPluginApiService({...})` 之前调用**一次** `buildToolAbortedErrorFactory()`，把得到的稳定工厂作为 `toolAbortedErrorFactory` 注入服务。

### C3. `lib/plugin-api-service.js` —— 门面双态挂载

- `createPluginApiService` 新增可选参数 `toolAbortedErrorFactory`（默认 `createToolAbortedErrorFactory({})` → 降级安全，保证构造永不抛）：
  - 构造函数存 `this._toolAbortedErrorFactory = ...`；
  - `tools` getter 的 active 分支改为 `createToolsApi(resolveTools, routeOf, this._toolAbortedErrorFactory)`。
- **幂等 re-apply**：`apply` 的复用分支（fiber 已持有 branded `pluginApi`）不再调用 `createPluginApiService`，因此 `toolAbortedErrorFactory` 只在**首次 apply** 决定一次，并随复用服务实例贯穿到后续 re-apply，无需 `reconcile` 变更 —— 与 requirements 3.3 的 host 生命周期稳定性一致（本文件只补一句文档，不改复用分支）。
- `createToolsApi(resolveTools, routeOf, toolAbortedErrorFactory)` 冻结面新增一个只读成员：
  ```js
  toolAbortedError() { return toolAbortedErrorFactory() }
  ```
  - 注意该方法**不调用 `tools()` 服务**——它是纯构造，与官方 tools 服务可解析性无关（requirements 1.4 语义；服务不可解析也仅在调用 register/execute 等成员时抛错，不影响本 helper）。
- `createDisabledToolsApi(active, routeOf)` 新增 `toolAbortedError: fail`：与 `register`/`restrict`/`get` 等常规成员一致，抛 `PluginApiInactiveError` / `PluginApiFeatureDisabledError('tools')`（1.5；`routeOf` 是本命名空间唯一豁免，见 requirements 1.5 注）。

### C4. `package.json` —— peerDependency 声明（Stage 4 落地）

- 新增 `"@deepseek-ai/dsh-tools": "^0.1.0-rc.6"` 到 `peerDependencies`。理由：本 feature 直接消费 `TOOL_ABORTED` 官方公开导出，声明即诚实（与仓库对所有被消费官方包列为 peer 的约定一致）。运行时**仍**走惰性解析、缺包不 boot 失败（声明与容错并存；peer 缺失时门面降级可用）。

### C5. `dsh-pro-ex-ability-anchor` 迁移（验收证据，跨仓库只读验证）

- 删除 `loadAbortedErrorFactory`（`lib/index.js:290-308`）及其唯一调用点 `const makeAbortedError = loadAbortedErrorFactory()`（`lib/index.js:384`）。
- 替换为 fiber ctx 上的插件间解析 + 兜底：
  ```js
  const makeAbortedError = () => {
    const pluginApi = typeof ctx.get === 'function' ? ctx.get('pluginApi') : undefined
    const f = pluginApi?.tools?.toolAbortedError
    return typeof f === 'function' ? f() : fallbackPlainAbortError() // 裸 AbortError 兜底
  }
  ```
- 兜底保留当前“裸 `Error` 命名 `AbortError`”行为，保证 `pluginApi.tools` 不可达时（要点：pro-ex 现有 `ctx.get('pluginApi')` 可用路径在 `lib/index.js:467-475`，工具执行体内有 fiber ctx）工具中止仍可识别。
- **有意的行为偏移**：现行代码在 apply 时一次性求值工厂（L384），替换后改为**每次 throw 时**再解析 `ctx.get('pluginApi')`；可观察错误身份不变（全量或兜底，均被 agent loop 识别），该惰性化偏移属有意为之，由 pro-ex headless 冒烟 + dev boot（requirements 6.1–6.2）验证覆盖。
- 验证：pro-ex headless 冒烟 + dev boot 通过（requirements 6.1–6.2）。

---

## Data Models

| 模式 | 返回值形状 | 与官方路径的关系 |
|---|---|---|
| 全量（官方常量可用） | `Error` 子类 `HarnessError`：`name:'AbortError'`、`code:'ABORTED'`（= `TOOL_ABORTED`）、`message:'tool call aborted'`；未冻结；每次新实例 | 与官方 dsh-tool-bash `new HarnessError('tool call aborted', TOOL_ABORTED)` + `name='AbortError'` 在 `{name, code, message}` 上深等（2.4）；抛出后 `errorInfo` → `{name:'AbortError', code:'ABORTED'}`，与 canonical `toolAbortedResult.error.info` 逐字段相等（2.5） |
| 降级（官方常量缺失） | 裸 `Error`：`name:'AbortError'`、`message:'tool call aborted'`；**无** `code`；每次新实例 | 与 pro-ex 现行 fallback 一致；保持 agent loop 对 abort 的识别（3.1） |

无新实体类型、无新事件 payload、无 catalog slice；本 feature 不新增任何 `pluginApi` 顶层命名空间（4.3）。

---

## Error Handling

| 场景 | 行为 | 依据 |
|---|---|---|
| 官方常量可用，调用 helper | 返回全量 Error，不抛 | 1.1/2.1–2.4 |
| 官方常量缺失（dsh-tools 未装 / 未来导出改名），调用 helper | 返回降级裸 `Error`，不抛解析错误 | 3.1 |
| apply 期间 `resolveModule('@deepseek-ai/dsh-tools')` 抛错 | 吞掉，工厂降级，apply 正常返回 | 3.2 |
| tools feature 禁用，调用 `toolAbortedError` | 抛 `PluginApiInactiveError`（core 未激活）或 `PluginApiFeatureDisabledError('tools')`（feature 禁用） | 1.5 |
| helper 本身 | 全量/降级均不触发任何监听器、不订阅信号、不设定时器；不写官方包文件 | 3.4/4.2 |

无新增错误分类；降级为**静默**（pro-ex 现行先例），不新增日志（极小实现面）；如需观测可在未来版本以 debug 级日志追加，不改变本 spec 行为契约。

---

## Testing Strategy

全部 `node --test`、纯模块零 harness 依赖（镜像 `test/deep-freeze.test.mjs` 风格）。

### T1. `test/tool-abort.test.mjs`（纯单测，注入假类/字面量）
- 全量：`createToolAbortedErrorFactory({ HarnessError: StubClass, TOOL_ABORTED: 'ABORTED' })` 的返回值满足 `instanceof StubClass`、`name==='AbortError'`、`code==='ABORTED'`、`message==='tool call aborted'`；`{name,code,message}` 与“用同一 stub 按官方配方构造”深等（2.4）；两次调用非同一实例、未冻结、可继续写属性（1.3）；多余实参被忽略（1.2）；`errorInfo` 等价提取 `{name,code}` === `{name:'AbortError', code:'ABORTED'}`（2.5）。
- 降级：`createToolAbortedErrorFactory({})` 与 `createToolAbortedErrorFactory({ HarnessError })`（缺 `TOOL_ABORTED`）均返回裸 `Error`（`!instanceof StubClass`）、`name==='AbortError'`、`message==='tool call aborted'`、无 `code`（3.1）；同一工厂多次调用模式稳定（3.3）。
- 边界：`HarnessError` 非函数 / `TOOL_ABORTED` 非字符串各分支。

### T2. `test/tool-abort-official.test.mjs`（真实官方类，锁定 AC 2.1–2.4）
- `import { HarnessError } from '@deepseek-ai/dsh-llm'`（已是 peerDep，测试可硬 import）；`@deepseek-ai/dsh-tools` 用**惰性动态 import**（`await import(...)` 包在 try/catch 中）：解析成功才在相应 case 中取 `TOOL_ABORTED` 并断言真实 identity；解析失败则 `test.skip`，绝不让缺包的测试文件在模块加载期崩溃 —— 与本 feature 的 fail-safe 哲学（requirements 3.2）一致，测试套件自身不硬依赖 peer-only 包。
- 断言与真实官方构造 `new HarnessError('tool call aborted', TOOL_ABORTED)`+`name='AbortError'` 在 `{name,code,message}` 深等；`instanceof HarnessError === true`；`code === TOOL_ABORTED`。
- 备选（Stage 4 环境注意项）：若要让 T2 恒跑而非跳过，可将 `@deepseek-ai/dsh-tools` 同时加入 devDependencies；两种方式二选一，设计默认前者（惰性+skip，面最小）。

### T3. `test/index-tools-abort.test.mjs`（门面集成，走 apply + mock fiber ctx，镜像现有 index-* 测试）
- disabled 态：`pluginApi.tools.toolAbortedError` 存在；调用抛 `PluginApiFeatureDisabledError('tools')`；`tools.isActive === false`（1.5）。
- active 态：`pluginApi.tools.toolAbortedError()` 返回 `name==='AbortError'` 且 `code==='ABORTED'`（测试环境经真实 resolver 取到官方常量）；用 mock `ctx.get('tools')` 断言**未**被调用（helper 不依赖 service，1.4）。
- fail-safe：`apply` 全程不抛（既有 fail-safe 基线叠加本校验）；feature 禁用时的调用只产生 typed 门面错误，而非 apply 崩溃（3.2/1.5）。
- resolver 单测（并入 T1 或独立）：`buildToolAbortedErrorFactory(() => { throw … })` 与 `buildToolAbortedErrorFactory(() => ({}))` 均返回可用降级工厂、不抛（3.2），经注入 `resolveModule` 模拟缺包。

### T4. 迁移验证（跨仓库，Stage 4 交付动作）
- 在 `dsh-pro-ex-ability-anchor` 删除 `loadAbortedErrorFactory` 并按 C5 替换；跑其 headless 冒烟 + dev boot（6.1–6.2）。

---

## Key Decisions

| # | 决策 | 理由 |
|---|---|---|
| D1 | 纯模块 `lib/tool-abort.js`，`createToolAbortedErrorFactory(deps)` 注入官方导出 | 完全可单测（假类/字面量）、零 harness、镜像 `deep-freeze.js`；与解析逻辑解耦 |
| D2 | 零参数、固定字面量 `message==='tool call aborted'` | typed identity 可逐字节锁定（2.3/2.4）；极小面；“自定义 message”无路由价值且会造成社区实现再次分化（与要解决的问题相反） |
| D3 | 常量缺失 → 降级裸 `Error`（不抛），而非 typed 错误 | 匹配 pro-ex 现行兜底与“agent loop 也识别 bare AbortError”的前提；helper 的本职是“可以 throw 的对象”，调用时不应再抛；Goal 允许的“或 typed error”落到 1.5 门面禁用路径 |
| D4 | `HarnessError` 用既有静态 `dshLlm`；`TOOL_ABORTED` 用惰性 `createRequire` 且可缺失 | dsh-llm 已是硬 peerDep/静态 import（预存事实）；dsh-tools 非硬依赖，惰性解析保证“缺包不 boot 失败”（3.2） |
| D5 | `@deepseek-ai/dsh-tools` 登记为 peerDependency（声明）但运行时仍容错 | 声明诚实（直接消费其公开导出），容错保 fail-safe；声明与缺失容忍并存 |
| D6 | 工厂在 apply 内一次创建、经服务注入 | 满足 3.3 host 生命周期稳定；`tools` getter 每次重建 `createToolsApi` 也不影响稳定性（注入的是同一稳定函数） |
| D7 | 无新 hook / 事件 / dispatch；A 类的“引出机制”= 仅消费官方公开导出 | requirements 4.1–4.6：本 feature 无 Cordis 事件绑定，无失败呈现四路径参与，无 catalog slice |

---

## Requirements Traceability

| Requirements AC | 设计落点 |
|---|---|
| 1.1 / 1.2 / 1.3（形状：返回 Error、零参、新实例、未冻结） | C1 + T1 |
| 1.4（抛出后可被 agent loop 识别） | C1 全量模式 + T1（2.5 定向）+ T2 |
| 1.5（禁用态抛 typed 错误） | C3 `createDisabledToolsApi` + T3 |
| 2.1–2.4（instanceof / code / name / message / 深等官方配方） | C1 + C2 + T1 + T2 |
| 2.5（物化 `error.info` 逐字段相等，非降级前提） | C1 全量模式 + T1 |
| 3.1 / 3.3（缺失降级 + 稳定性） | C1 降级模式 + T1 |
| 3.2（缺包不抛穿 apply / 惰性解析可失败） | C2 + T3 resolver 单测 |
| 3.4（无副作用、不写官方包） | C1/C3 设计 + T3 |
| 4.1–4.3（不新增错误分类/监听/namespace） | D7 + C1/C3 面 |
| 4.4（只消费公开导出） | C1/C2（`HarnessError`/`TOOL_ABORTED` 均根导出）|
| 4.5（不做 client 面） | 无 client 改动 |
| 4.6（极小实现面、零 harness） | C1 单文件 + T1 纯单测 |
| 5.1–5.4（登记：feature-list §2.6 T11、§4 迁移行、AGENTS §8、版本不定界） | Stage 4 交付动作 + C4 |
| 6.1–6.3（pro-ex 迁移证据） | C5 + T4 |
