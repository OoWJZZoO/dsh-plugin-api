# Stage 0 - Goal

## Feature Name

`plugin-api-policy-enforcement-closure`

## Status

SPEC1 Stage 0：已获用户确认（2026-09-01）。本文定义本 feature 的目标与边界；Stage 1 Requirements 只可在本阶段提交完成后开始。

## Goal

修正当前公共 policy 契约中过度保守的能力边界，使 policy 注册不再只是“提供一个可选咨询入口”，而是在锁定 runtime 的受支持官方执行路径上形成可验证的自动执行闭包。

本 feature 面向两类第三方插件作者：

1. 注册 egress、recovery 或其他领域 policy，希望官方运行路径在真实决策点自动应用 policy 的作者；
2. 自己拥有出站、失败处理或其他副作用路径，并愿意主动遵守同一套 policy 规则的合作型第三方插件作者。

预期结果是：

- 受支持的官方路径在副作用、终态提交或受保护发布发生前自动求值并执行适用 policy，业务调用方无需手动咨询；
- egress、recovery 以及盘点发现的其他同型 policy 仍保留清晰的公共注册面，并提供适合合作型第三方插件主动调用的显式决策、授权或执行接口；自动执行与主动遵守使用同一个 policy authority、组合规则、失败语义和审计事实；
- 当前 runtime 缺少决策点时，优先通过组件归属明确、官方契约可完整保留的 replacement slice 补齐，而不是直接把整条官方路径降为永久 gap；
- `events.define` 在合作型插件威胁模型下成为可用的自定义事件生产入口，不因无法抵御恶意同进程插件伪造 owner 或绕过门面而保持 unavailable；
- M8 收尾中误提交到仓库根目录的三个 cost-meter 测试 ledger 被精确删除，并验证正式测试不会重新生成。

## Problem Statement

现有实现与文档存在以下偏离：

1. `security.egress` 可以注册 policy 和申请 lease，但官方 HTTP、MCP、LLM、subprocess、remote 等路径没有形成统一的自动执行闭包；lease admission 不能等同于真实出站拦截。
2. `executions.recovery` 保留显式求值能力，但官方失败路径没有完整的自动消费 authority，导致 policy 仍可能停留在建议或咨询层。
3. M8 以“缺少官方 seam”为由删除咨询式入口并登记 gap，却没有系统评估现有 replacement owners 是否可以在各组件副作用或终态提交前补齐自动执行。
4. 现有 `events.define` gap 把 owner 防伪当作阻塞条件，超出了仓库已声明的“合作但可能有 bug 的插件”模型；主动身份伪造和绕过门面本就不属于受支持安全保证。
5. M8 Wave 7 提交误纳入三个名为 `undefined\dsh-cost-meter-test-*` 的外部测试 home/ledger 产物，仓库收尾不完整。

## Scope Boundary

### Included

- 建立锁定 runtime 的 policy inventory：枚举全部公共 policy registry、对应官方决策点、实际副作用/终态 owner、自动执行状态、公开主动调用面和可观察证据。
- 建立官方路径 enforcement matrix，至少覆盖：
  - egress 的 LLM/provider、model discovery、MCP stdio/HTTP、官方 web、subprocess/shell/terminal、attachment remote、remote/connection 及审计发现的其他官方出站路径；
  - recovery 的模型、工具、agent loop、任务及审计发现的其他官方失败/重试/降级路径；
  - 其他已经公开为 policy、但仍要求业务调用方手动咨询或实际上未在声明决策点自动执行的领域 policy。
- 对每条受支持官方路径，在实际副作用、终态提交或受保护发布之前自动求值 policy，并使 deny/retry/fallback/redaction/route 等领域决定按各自契约真实生效。
- 继续公开 policy 注册 API；同时为合作型第三方插件保留或新增明确的显式决策、授权或执行 API，使其自有路径可以主动遵守同一 policy authority，而不必复制 reducer、默认决定和审计逻辑。
- 主门面统一持有 policy 注册、组合、默认决定、可用性和审计语义；跨组件能力可以由多个 component-local replacement slices 协同承载，每个 replacement owner 仍只归属唯一官方组件包。
- full 安装模式形成已登记官方路径的完整闭包；选择性安装如缺少相关 enforcement owner，必须按具体路径诚实报告 degraded/unavailable，不得把部分覆盖描述为完整自动执行。
- 使 `events.define` 可用：支持自定义事件定义、能力受限 publisher、custom/canonical 事件分域、冲突规则、dispose/reload 与 stale lifecycle；owner 归因服务于正常组合与生命周期，不承诺抵御恶意插件伪造身份。
- 精确删除以下被 Git 跟踪的 M8 测试垃圾，并验证全量测试后不复发：
  - `undefined\dsh-cost-meter-test-home/storages/cost-meter/ledger.json`
  - `undefined\dsh-cost-meter-test-legacy-home/storages/cost-meter/ledger.json`
  - `undefined\dsh-cost-meter-test-mig-home/storages/cost-meter/ledger.json`
- 修正 M8 对 `storage.open.handle.close` 的能力守恒记账：该旧销毁动词已有 operation handle `dispose()` replacement，不是 capability gap；canonical registry、生成矩阵和交付文档必须把说明从 `gapReason` 迁到 `replacement`。
- 同步 canonical registry、capability matrix、迁移/交付报告、feature-list、适用 standards 与公开 capability/availability，使文档和运行时保证一致。

### Explicitly Retained Gaps

- 第三方插件主动绕过门面和官方受支持服务，直接调用 `fetch`、Node 网络模块、socket、WebSocket、child process、原生扩展或外部进程，不受本 feature 强制约束。
- 第三方插件直接 import 官方内部包或使用未经支持的私有路径，仍属于 unsupported escape hatch。
- 恶意同进程插件伪造 owner、窃取 publisher/handle、直接使用 Cordis 底层派发或绕过公共 API，不属于 `events.define` 或 policy authority 的安全承诺。
- 极少数无法在不破坏官方组件完整契约的前提下建立前置决策点的官方边缘路径，可以保留为逐路径、具名、带证据和退役条件的 gap；“官方没有现成 seam”本身不足以直接豁免，必须先完成 facade/replacement 可达性评估。

### Out Of Scope

- 不引入部署级沙箱、network namespace、容器网络策略、强制代理、防火墙、seccomp、浏览器 CSP 或其他框架外隔离方案。
- 不以防御恶意插件为目标，不建设通用权限系统、全局 owner 防伪系统或宿主进程隔离层。
- 不 monkey-patch Node 全局 `fetch`、`http`、`https`、socket、child process 或浏览器全局网络 API。
- 不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 或任何官方包文件。
- 不创建一个跨组件拥有全部官方行的全局 replacement；每个 replacement slice 必须保持组件唯一 owner 和官方整行契约保真。
- 不把公开的第三方主动调用 API当作官方路径自动执行的替代证据；两者必须分别验证。
- 不借仓库清扫扩大到与本 feature 无关的历史 `temp/` 文件、依赖目录或全仓重构。

## Capability Strategy

本 feature 采用主门面与 component-local replacement slices 的组合：

- 已有稳定官方事件/服务决策点的路径使用门面直绑；
- 可由已证明底层钩子在副作用前有限转译的路径使用门面适配；
- 缺少官方 seam、但缺失语义明确归属于单一官方组件且可完整保留官方 ctx 服务/事件契约的路径，评估扩展现有 replacement owner 或新增对应组件 replacement owner；
- 跨组件的同一 policy feature 可以协同，但不得打破每个 replacement 包只归属一个官方组件的边界；
- 每个新增或扩展的 replacement slice 必须满足 R 类 boot 自检、版本锁定、唯一 owner、fail-safe、上游提案和退役条件。

本 feature 不把 policy reducer、priority、deepFreeze 或 callback containment 等横切派发语义放进 replacement；replacement 只负责在其组件拥有的真实决策点调用主门面的内部 policy authority，并执行返回的领域决定。

## Success Criteria

1. canonical policy inventory 覆盖全部公共 policy 面；每个 policy 都有明确的自动官方决策点、合作型第三方主动调用面，或逐路径具名 gap，不存在“已注册但无人执行”的隐含状态。
2. egress enforcement matrix 中所有标记为受支持的官方路径，都在实际出站副作用发生前自动执行 policy；deny 时没有网络连接、请求发送、transport 创建或子进程创建副作用。
3. recovery enforcement matrix 中所有标记为受支持的官方失败路径，都在终态/重试/fallback 提交前自动执行 policy；不要求消费者手动 `evaluate` 后再自行消费决定，同一失败不会被重复消费。
4. 其他 inventory 发现的同型 policy 也满足“注册后在声明决策点自动执行”；不能满足者必须在本 feature 内补齐或以逐路径证据申请保留边缘 gap。
5. egress、recovery 和其他相似 policy 继续提供受支持的公共注册与显式主动调用接口；合作型第三方插件可以让自己的路径遵守同一 policy、默认决定、审计和 availability 语义。
6. 自动执行和第三方主动调用不会形成两套 registry、reducer、身份或审计事实；同一输入在同一 policy generation 下产生一致的领域决定。
7. `events.define` 可供第三方定义并发布自定义事件；publisher 不能通过受支持 API 发布 canonical 官方事件，dispose/reload/stale generation 不误伤其他正常 owner；不以恶意 owner 伪造防护作为交付门。
8. full 与选择性安装的 coverage 差异可以按具体官方路径查询；full 安装对登记路径形成完整闭包，选择性安装不虚报未安装 owner 的保护能力。
9. 所有新增/扩展 replacement slices 完整复刻被替代官方行契约，通过版本、boot、冲突和卸载恢复验证，且不修改官方包文件。
10. 三个 `undefined\dsh-cost-meter-test-*` ledger 从 Git 和工作树删除；规定的全量测试完成后未重新生成，且不使用宽泛 `.gitignore` 隐藏复发。
11. `storage.open.handle.close` 在 capability matrix 中保持已删除旧 path，并以 operation handle `dispose()` 作为 `replacement`；其 `gapReason` 清空，相关生成物和交付文档同步一致。
12. registry、capability matrix、交付报告、feature-list、standards、运行时 availability 与测试证据使用一致的保证边界；第三方主动绕过和获准保留的具名官方边缘路径是最终显式 gap，不再把大类官方路径整体描述为不可保证。
13. 所有入口维持 fail-safe，相关测试、全量 `npm test`、registry/surface consistency、安装模式验证、`git diff --check`、官方包零修改审计和 Stage 4 全局终审全部通过。

## Admission Rationale And Retirement

该能力值得由门面长期拥有，因为多个插件注册 policy 时需要共享唯一 reducer、默认决定、审计和 authority closure；让每个调用方自行咨询会产生真实的组合与安全语义分叉。

component-local replacement slices 是锁定 runtime 缺少决策 seam 时的当前实现通道。对应官方组件一旦提供等价的副作用前 policy hook、失败消费 hook 或 owner-scoped custom publisher seam，相关 replacement slice 应退役为官方直绑；公共 policy 与 `events.define` 契约在仍有独立稳定价值时保留。
