# AGENTS.md — dsh-plugin-api

本文件是 `dsh-plugin-api` 仓库的 AI 编码代理与人类维护者指南。**先读完再动手。**
仓库当前处于 **spec coding 阶段**：只产规格文档，不写实现代码。

---

## 1. 这个仓库是什么

`dsh-plugin-api` 是 DeepSeek Harness 的**社区兼容层 / 插件 API 门面**：在不修改官方 DSH 包文件的前提下，把官方已有的 Cordis 扩展点稳定化，并用现有底层钩子把缺失的语义钩子尽量“转译”出来，给第三方插件一个统一的 import/inject 面。

计划形态（与 `agent/dsh-read-image` 同构的**双面 Cordis 插件**）：

```text
agent/dsh-plugin-api/
├── lib/index.js        # host 插件：注册 ctx.pluginApi，包装官方服务、挂转译钩子
├── lib/client.js       # client 插件：浏览器端 helper（remote contribution / codec / slot）
├── package.json        # 声明 dsh.client 清单；peerDependencies 共享宿主实例
├── docs/specs/         # spec coding 制品（见第 3 节）
└── test/               # node --test
```

一句话定位：**官方之上的“转译稳定器”**。官方内部包变化时，只改这一个仓库，而不是让 N 个社区插件各自 hack。

## 2. 与官方插件的关系（硬约束）

1. **不是 fork，不 patch 官方包文件。** 绝不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**`；只通过 profile/bundle 把本插件作为一行 entry 加载。
2. **同一棵 Cordis 树里的普通插件**，必须在第三方插件之前加载（row 顺序）。
3. 只通过 `inject` 消费官方服务（`llm`、`tools`、`agents`、`systemPrompt`、`settings` 等），**不 import 官方包的模块私有变量**。
4. 官方插件对本仓库无感知；本仓库不替代任何官方包。
5. 能被外部“引出”的钩子分两类，设计时必须写清：
   - **A 类：官方已 dispatch，只需稳定化**（如 `agent/*`、`tools/*`、`session/*`、`llm/stream`）。
   - **B 类：官方没有 dispatch 点，只能用底层钩子模拟**（如同步 `llm/request` 用 `llm/stream` 重入模拟）。
   - **C 类：不改官方做不到**，只能写 proposal / 等上游（如异步完整请求改写、boot 故障隔离、`WEB_SETTINGS_NAMESPACES` 动态化、客户端 `remote.<ns>` 原生动态发现）。
6. 任何插件 apply 抛错当前会杀死整个 harness boot，因此本仓库所有入口必须遵循 **fail-safe**：失败只记录日志并安静停用，绝不抛穿 apply（dsh-read-image 的 G1 模式）。

## 3. Kiro spec coding 工作流规范（本仓库铁律）

采用 [kevinlin/spec-coding-mcp](https://github.com/kevinlin/spec-coding-mcp) 的 spec-driven 五阶段流程。**Stage 0–3（Goal / Requirements / Design / Tasks）必须得到人类明确确认，才能进入下一阶段；Stage 4（Execute）在 Tasks 获批后由代理自主完成，不再逐任务等待人类确认（见 3.2）。**

运行时工作流由本仓库 skill `spec-coding` 驱动（`.dsh/skills/spec-coding/SKILL.md`）；AGENTS.md 是 constitution，两者冲突时以本文件铁律为准。

### 3.0 最高原则：工程质量优先

- **以工程质量为核心导向**：当交付速度、实现便利与工程质量冲突时，工程质量优先。任何阶段都不得以“先跑起来再说”为由跳过确认门、测试或 fail-safe 约束。
- **代理是工作流规范的责任人**：用户可能不熟悉 Kiro spec coding，也可能给出与规范冲突的指示；代理发现冲突时必须直接指出、说明理由并等待澄清，不得盲从。宁多问一轮，不埋一颗雷。

### 3.0.1 阶段声明：纯本地开发阶段（零发布负债窗口）

- 本仓库当前处于**纯本地开发阶段**，无任何**实质上**的已发布内容：没有第三方插件依赖本仓库的任何 API，不存在外部兼容承诺。§8 中登记为 `delivered` 的 feature 仅表示"本仓库内已完成交付"，**不构成**对外发布或兼容承诺。
- 因此：**任何 API 层面的重构（改名、命名空间调整、形状变更、折叠/展开、错误语义统一等）都应当趁此窗口尽早完成**——现在不改，就是以后发布了改不掉的负债。
- 此阶段内，"该 API 已 delivered / 已稳定，所以不能动"的论据**不成立**；是否修改的唯一判据是工程质量与长期形状，不是向后兼容。代理在评审、预检、设计中不得以"已发布"为由否决合理的 API 重构提案。
- 本窗口同样约束代理的行为：发现 API 形状负债时（含预检、审计、迁移验收中发现的），必须主动上报并建议纳入当前重构窗口，而不是留给未来。
- 当本仓库进入发布阶段（首个第三方插件实质依赖本仓库，或本仓库进入公开 profile 分发）时，必须更新本节为兼容性声明，届时 API 变更改走 `dsh.api` 版本协商轨道（F0.3）。

### 3.1 五阶段

| 阶段 | 制品 | 说明 |
|---|---|---|
| 1. Goal | 本阶段产出一个 `feature_name` 与目标摘要 | 用自然语言确认“做什么、为什么” |
| 2. Requirements | `docs/specs/<feature_name>/requirements.md` | **EARS 语法**，可测试 |
| 3. Design | `docs/specs/<feature_name>/design.md` | 技术架构、host/client 分工、钩子引出机制 |
| 4. Tasks | `docs/specs/<feature_name>/tasks.md` | 依赖有序的任务清单 |
| 5. Execute | 实现代码 + 测试 | 严格按 tasks 执行，不夹带 spec 外功能 |

### 3.2 确认门（gate）

- **Stage 0–3（Goal / Requirements / Design / Tasks）**：每个阶段完成后，把文档交给用户评审；**用户明确批准后才进入下一阶段**。未批准时，只能修订当前阶段文档，禁止提前写下一阶段文档，更禁止写实现代码。
- **每个阶段（除 Stage 0）结束时**：Stage 1–3 在把该阶段文档交给用户评审前，必须先启动一个后台子 agent 做对抗性审查；**仅小修改（如一两处文字或单点修正）无需再对抗性审查**。审查只核对当前阶段制品与已确认上游文档的一致性，不向上溯源；审查返回“无偏差”，或代理已按审查意见修复并复跑通过后，才可提交用户评审。Stage 4 全部任务完成后直接交付结果报告，**无需总体对抗性审查**。
- **Stage 4（Execute）**：Tasks 获批后由代理**自主完成全部任务**，不再逐任务等待人类确认。
  - 代理按 `tasks.md` 顺序一次执行一个任务；每完成一个任务，立即发起一个后台子 agent 做**对抗性审查**（只核对实现/测试与当前任务文档的一致性，不向上溯源）；**若该任务只是小修改（如一两处文字或单点修正），无需对抗性审查**。
  - 审查返回“无偏差”，或代理已按审查意见修复并复跑通过后，才继续下一个任务。
  - 若执行中发现 spec 错误：实现细节/设计矛盾由代理先修订对应 spec 文档（requirements/design/tasks）保持一致，并在最终报告中列出修订；若错误动摇已确认的 Goal 或 Requirements 验收标准，则暂停并请求人类裁决。
  - 代理仍需遵守 fail-safe、测试、不夹带 spec 外功能等全部约束；全部任务完成后向用户交付完整结果报告。

### 3.3 EARS 需求写法

需求必须写成 EARS（Easy Approach to Requirements Syntax）形式：

```text
WHEN <触发条件> THEN <系统> SHALL <行为>
GIVEN <前置状态> WHEN <触发条件> THEN <系统> SHALL <行为>
WHERE <适用范围> IF <条件> THEN <系统> SHALL <行为>
```

例如：

```text
WHEN a third-party plugin registers a synchronous llm/request transform
THEN the adapter SHALL receive the transformed request and the transform SHALL be idempotent.
```

### 3.4 质量门（每个 spec 必查）

- **requirements**：每条需求是否 EARS、可测试、无实现细节；是否覆盖 host/client 两面；是否把“外部可实现 vs 必须上游”标注清楚。
- **design**：是否说明每个钩子的引出机制（官方事件直接绑定 / 底层钩子模拟 / 标记为 upstream proposal）；是否有失败路径与 guard 策略。
- **tasks**：是否与 requirements 一一对应；是否包含测试任务；是否有迁移验收任务（见第 5 节）。

## 4. 核心设计决策（已讨论，作为 constitution 输入）

1. 插件作者的**推荐、受支持**入口是门面 `dsh-plugin-api`（运行时通过 `ctx.pluginApi` 服务解析符号），由门面提供稳定性、版本协商与 fail-safe 保障。第三方插件**可以**绕过门面直接与 `dsh-tools`/`dsh-llm` 等内部包交互，但该路径被明确标记为 **unsupported escape hatch**：无兼容承诺、官方内部变化时可能破坏、自担风险。门面不强制、不拦截这种直连，也不为其提供任何保障。
2. 版本协商：门面全量唯一版本号定义为 **`<runtime全量版本（含 rc 等后缀）>-<API协议大版本.迭代小版本>`**（如 `0.1.0-rc.6-0.2`，写入 `package.json.version`）：runtime 部分记录门面为哪个官方 runtime 构建，API 协议部分是门面自己的世代号（`package.json.dsh.api` 仅承载后者）。方向 ①（runtime↔门面）比较 runtime 部分与实际安装的官方 runtime；方向 ②（插件↔门面，`assertCompatible`）比较 API 协议版本。任一方向不匹配时安全停用/显式报错。API 协议 minor 按**数字递增**：`0.9` 之后是 `0.10`，永不进位为 `1.0`；**协议 `1.0` 保留给正式发布**，标志着公开发布（此前均为纯本地开发期契约，见 §3.0.1）。
3. 事件 API 保留 Cordis 的 `ctx.on` + `emit/serial/parallel/waterfall`，只增加稳定类型、只读 payload 与 `priority`（lowest/low/normal/high/highest/monitor）。
4. 需要优先“转译”的语义钩子：
   - 同步 `llm/request`（基于 `llm/stream` 重入，必须幂等收敛）
   - 语义化 `llm/admission`（首个 feature 定为 `llm-image-admission`：第三方只声明“本会话/请求需要图片准入且承诺投影”，不公开 ModelInfo 变更；`resolveModelInfo` 包装仅作 B 类隐藏实现，并附 C 类上游提案）
   - `exec.route` / `routeOf(exec)`（基于 `agent.session.requestContext()` 或 `tools/pre-execute` 注入）
   - settings 可视化配置桥（`TypertRemoteService` + 客户端 `ctx.remote.$mount`）
   - session 上屏事件构造 helper（封装 `surfaceOp` / `sourceEventSeqs`）
5. client bundle 允许打包一份 zod，用于生成满足 `dsh-api-remotes` 校验的真 codec；其余依赖尽量保持 peerDependencies 以共享宿主实例。

## 5. 验收对象（spec 需求的现实来源）

- `../dsh-read-image/docs/known-hacks.md`：A1（monkey-patch resolveModelInfo）、A2（llm/stream 重入投影）、A3/A4/A5（Remote/设置桥）、A6（routeOf 深挖 agent）、G1（环境自检总保险丝）。
- `../dsh-read-image/AGENTS.md`：peerDependency 实例同一性、deepFreeze 与 AbortSignal、fiber ctx 上 `ctx.service()` 不可用等硬核教训。
- `../dsh-pro-ex-ability-anchor/AGENTS.md`：`system-prompt/assemble` 替换、session 上屏事件形状、Remote 参数名 wire 约束、面板 client bundle 约束。
- 迁移验收标准：上述两个插件改用 `dsh-plugin-api` 后，对应 hack 代码可删除或退化为官方 API 调用，且 headless 冒烟与 dev boot 均通过。

## 6. 仓库规则

- **Stage 0–3 确认门未走完前只允许写 `AGENTS.md` 与 `docs/specs/**`**；Stage 4（Execute）获批后允许创建 `lib/`、`package.json`、`test/`、`scripts/` 等实现产物。
- 制品目录：`docs/specs/<feature_name>/requirements.md`、`design.md`、`tasks.md`。
- 测试（进入 execute 阶段后）：`node --test`；纯函数模块保持零 harness 依赖。
- 不引入与门面无关的运行时依赖；需要宿主共享实例的包一律 `peerDependencies`。
- 临时验证脚本放 `temp/`，用完即删。

## 7. 关键链接

### spec coding

- [kevinlin/spec-coding-mcp — Spec-driven Development Workflow](https://github.com/kevinlin/spec-coding-mcp)
- [GitHub Spec Kit — Spec-Driven Development](https://github.github.com/spec-kit/)
- [Spec Kit Quick Start](https://github.com/github/spec-kit/blob/5372dcbdeab4ccde9617865206e4df75841e1f0e/docs/quickstart.md)
- [Red Hat: How spec-driven development improves AI coding quality](https://developers.redhat.com/articles/2025/10/22/how-spec-driven-development-improves-ai-coding-quality)

### DeepSeek Harness 官方文档与源码

- [DSH Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/architecture.md)
- [DSH Extension Cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/cookbook/extension-cookbook.md)
- [DSH Event Producer/Consumer Matrix](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/event-producer-consumer.md)
- [DSH Services and dependencies](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md)
- [DSH Build a tool](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/user/develop/basic/tool.md)
- 本机 DSH 安装源码：`/usr/lib/node_modules/@deepseek-ai/dsh/`（实际包在 `node_modules/@deepseek-ai/` 下）

### 设计参考

- [PaperMC: Event Listeners](https://docs.papermc.io/paper/dev/event-listeners/)
- [Cordis: The Plugin Kernel Behind DeepSeek Harness](https://floatboat.ai/blog/cordis-plugin-framework)

## 8. 已交付 feature 登记（防过期）

> 规则：每个 feature 在 Stage 4 交付后，必须在本节追加条目，并同步 `docs/specs/plugin-api-features/feature-list.md` 中对应状态；公开 API 形状或里程碑状态变化时同步更新，防止文档过期过时。

| Feature | 范围 | 状态 | Spec 目录 | 关键约束 / 设计 |
|---|---|---|---|---|
| `plugin-api-foundation` | M0 F0.1–F0.3（`ctx.pluginApi` 服务、fail-safe guard、双向版本协商） | delivered | `docs/specs/plugin-api-foundation/` | host 插件 `inject=[]`；核心/feature 两级 guard；版本按 `major.minor` 比较 |
| `plugin-api-facade-integrity` | M0 F0.4–F0.5（符号解析门面、包装链安全） | delivered | `docs/specs/plugin-api-facade-integrity/` | `lib/wrap-safety.js` identity-guard；F0.4 权威定义 |
| `llm-image-admission` | L1（图片准入 B 类） | delivered | `docs/specs/llm-image-admission/` | AdmissionRegistry + ProjectionGuard + admission-bridge |
| `plugin-api-events-m1` | M1 基底：E1–E12 + O1–O7, O9–O12, O15, O16（`pluginApi.events` 稳定事件总线 + 19 个宿主事件目录 + `pluginApi.web` 直通） | delivered | `docs/specs/plugin-api-events-m1/` | events-bus 原生 hook 按序重注册；deepFreeze 只读 payload；scope 过滤（`args[0].agent` + `carrierKeyOf`）；`@deepseek-ai/dsh-scope` peerDependency |
| `plugin-api-tools-m1` | M1 tools：T1–T9（`pluginApi.tools` 服务直通 + 6 个 `tools/*` 事件目录） | delivered | `docs/specs/plugin-api-tools-m1/` | `pluginApi.tools` scope-aware accessor（`this.ctx.get('tools')`）；6 个 tools 事件 catalog；`tools/execute` 的 `except-signal` 冻结策略；挂载顺序 `tools` 先于 `events` |
| `plugin-api-agent-m1` | M1：A1–A8（12 个 `agent/*` 事件目录 + `pluginApi.agent.get/list/roots` 直通） | delivered | `docs/specs/plugin-api-agent-m1/` | catalog `scopeKey/fault/freeze` 三字段；`agent/created` sync-veto 保留；A3–A6 propagate；live `agent`/`signal` 不 deepFreeze；A8 直通 `ctx.agents` |
| `plugin-api-session-m1` | M1 会话面：S1 + S3 + S4 + S5（`pluginApi.session` 生命周期事件订阅 + 会话读面 + 只读状态访问器 + 会话事件目录） | delivered | `docs/specs/plugin-api-session-m1/` | S1 复用组合 events catalog；S4 `surface` 返回冻结快照；S5 从 `KNOWN_SESSION_EVENT_TYPES` + `isSurfaceEligibleType` 派生；`@deepseek-ai/dsh-session` peerDependency |
| `plugin-api-llm-m1` | L3, L6, L7, L8, L9（`llm/stream` 类型化 waterfall、`llm/adapters-updated` 类型化 emit、`llm.modelInfo` 只读查询、`prepareCall`/`stream` 直通、provider 注册直通） | delivered | `docs/specs/plugin-api-llm-m1/` | `llm` feature guard 六方法探测；`modelInfo` deepFreeze 只读；L9 注册 handle 原样直通；events 目录 19→21 |
| `plugin-api-system-prompt-m1` | M1 P1–P8（`pluginApi.systemPrompt`：P1–P5 服务直通 + P6/P7 事件目录扩展 + P8 渲染直通） | delivered | `docs/specs/plugin-api-system-prompt-m1/` | P1–P5 同参转发官方 disposer；P6/P7 经 `pluginApi.events` catalog（`system-prompt/assemble` scope key `args[1].scope`）；P8 官方公开导出 `renderPrompt`/`renderContextSections` 直通；`@deepseek-ai/dsh-system-prompt` peerDependency |
| `plugin-api-settings-m1` | M1 settings：ST1/ST2/ST3/ST8（`pluginApi.settings` 命名空间注册、scope、设置事件、describe/install helper） | delivered | `docs/specs/plugin-api-settings-m1/` | `lib/settings.js` A 类直通官方 `ctx.settings`；可选 settings 服务模式（服务缺失时 feature 仍 active，register/scope/describe 抛 service-unavailable，installSettingsSection 保持官方 no-op fallback）；`settings/updated`/`settings/document-updated` 进 events catalog 并带 feature gating；`@deepseek-ai/dsh-settings` peerDependency |
| `plugin-api-capabilities-m1` | M1 SV1–SV16, SV18（17 个官方 capability seam 服务经 `pluginApi.services.<name>` 稳定直通） | delivered | `docs/specs/plugin-api-capabilities-m1/` | `lib/services.js` 静态定义表 + frozen namespace/facade；method/getter/forward 三类 1:1 直通；per-service degradation；SV15 URI helpers 走 `@deepseek-ai/dsh-session-reference` 公开导出转发（peerDependency） |
