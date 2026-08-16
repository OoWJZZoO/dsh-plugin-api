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

采用 [kevinlin/spec-coding-mcp](https://github.com/kevinlin/spec-coding-mcp) 的 spec-driven 五阶段流程。**每个阶段必须得到人类明确确认，才能进入下一阶段。**

运行时工作流由本仓库 skill `spec-coding` 驱动（`.dsh/skills/spec-coding/SKILL.md`）；AGENTS.md 是 constitution，两者冲突时以本文件铁律为准。

### 3.1 五阶段

| 阶段 | 制品 | 说明 |
|---|---|---|
| 1. Goal | 本阶段产出一个 `feature_name` 与目标摘要 | 用自然语言确认“做什么、为什么” |
| 2. Requirements | `docs/specs/<feature_name>/requirements.md` | **EARS 语法**，可测试 |
| 3. Design | `docs/specs/<feature_name>/design.md` | 技术架构、host/client 分工、钩子引出机制 |
| 4. Tasks | `docs/specs/<feature_name>/tasks.md` | 依赖有序的任务清单 |
| 5. Execute | 实现代码 + 测试 | 严格按 tasks 执行，不夹带 spec 外功能 |

### 3.2 确认门（gate）

- 每个阶段完成后，把文档交给用户评审；**用户明确批准后才进入下一阶段**。
- 未批准时，只能修订当前阶段文档，禁止提前写下一阶段文档，更禁止写实现代码。
- 执行阶段若发现 spec 错误，**先回改对应 spec 文档并重新确认**，不得在代码里悄悄偏离 spec。

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

1. 插件作者只依赖一个门面 `dsh-plugin-api`（运行时通过 `ctx.pluginApi` 服务解析符号），不直接依赖 `dsh-tools`/`dsh-llm` 等内部实现包。
2. 版本协商：`package.json` 的 `dsh` 字段增加 `api` 声明；版本不匹配时安全停用并给出可读错误。
3. 事件 API 保留 Cordis 的 `ctx.on` + `emit/serial/parallel/waterfall`，只增加稳定类型、只读 payload 与 `priority`（lowest/low/normal/high/highest/monitor）。
4. 需要优先“转译”的语义钩子：
   - 同步 `llm/request`（基于 `llm/stream` 重入，必须幂等收敛）
   - `llm/model-info`（集中化、链式包装 `resolveModelInfo`）
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

- **当前阶段只允许写 `AGENTS.md` 与 `docs/specs/**`**；未走完 spec coding 确认门前禁止创建 `lib/`、`package.json`、`test/` 等实现产物。
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
