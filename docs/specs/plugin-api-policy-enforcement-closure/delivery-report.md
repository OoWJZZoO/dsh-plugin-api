# 交付报告 — plugin-api-policy-enforcement-closure（Stage 4）

> 本文是 `docs/specs/plugin-api-policy-enforcement-closure/` feature 的 Stage 4 交付报告，与 `policy-inventory.json`（构建期/测试期数据，非运行时状态）、canonical registry（`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`）与 `docs/specs/plugin-api-features/feature-list.md` §7 登记保持一致。验证引用一律指向本仓库测试与制品路径，不指向外部。
>
> 版本冻结：runtime `0.1.0-rc.6`、主包及全部辅助/聚合包 `0.1.0-rc.6-0.1.0`、`dsh.api 0.1`。本 feature 全程未步进任何版本字段。

## 1. Policy disposition 清单（policy-inventory.json `inventory`）

每条 policy 的最终归类；`automatic` = 官方决策点自动执行已由测试证据闭合；`planned-automatic` 不再使用（本窗口全部升级为 automatic，见下）。

| policyPath | 归类 | 合作型接口 | 验证引用 |
|---|---|---|---|
| `llm.requestTransforms` | automatic | `llm.prepareCall` / llm request path | `test/llm-input-policy.test.mjs`、既有 llm request 测试 |
| `llm.admissionPolicies` | automatic | llm request path | `test/llm-input-policy.test.mjs`、`test/policy-authority-contract.test.mjs` |
| `llm.routing.policies` | automatic | `llm.routing` operations（`forExecution`/`current`/`observe`） | `test/model-route-policy.test.mjs`、既有 llm routing 测试 |
| `llm.routing.health.circuitPolicy` | automatic | `llm.routing.health.get/history/observe` projections；`probe.register` | 既有 llm routing health 测试 |
| `executions.visibility` | automatic | `executions.get/history/observe` with audience options | `test/execution-visibility` 系列 |
| `executions.recovery.policy` | automatic（单次消费） | `executions.recovery.evaluate`（operation；调用方按返回 action 行事） | `test/recovery-single-consumption.test.mjs`、`test/index-recovery-policy.test.mjs` |
| `executions.recovery.visibility` | automatic（投影） | recovery decision/history projection reads | 同上（wave4 recovery-consumption tests） |
| `sessions.channels.auth` | automatic | `sessions.channels` operations | `test/session-channel-auth` 系列 |
| `tools.restrict` / `tools.guard` | automatic | `tools.execute` 及相关 domain operations | 既有 tools-guard 测试 |
| `skills.activation.policy` | automatic | `skills.activation.activate` 及相关 operations | `test/skill-activation-facade.test.mjs` |
| `prompts.provenance.policy` | automatic | `prompts.provenance.compose` 与 projection reads | `test/context-provenance` 系列 |
| `security.policy` / `security.redaction` | automatic | 对应 domain operations 与 projections | `test/security-policy*.test.mjs` |
| `security.egress` | automatic（受支持官方路径） | `security.egress.lease.acquire` / `release`（coordination） | `test/security-policy-egress.test.mjs`、`test/policy-authority-contract.test.mjs`、`packages/llm/test/apply.test.mjs`、`packages/mcp/test/connection.test.mjs` |

## 2. 自动官方路径与 coverage 证据（enforcementMatrix）

| officialPath | 归类 | 证据/验证引用 |
|---|---|---|
| `llm/modelDiscovery` | automatic | `packages/llm/test/apply.test.mjs`：egress gate 挂接，`discoverModels` 在请求前求值 `request.baseURL` |
| `mcp/stdio`、`mcp/http` | automatic | `packages/mcp/test/connection.test.mjs`：egress gate deny 阻断 connect，allow 放行；首次连接、每次重连、潜在新出站目标 transport 请求前求值 |
| `recovery/model` | automatic | `test/recovery-single-consumption.test.mjs`：agent/model 请求失败在 `agent/request-error` 边界归一化、求值并应用 retry/fallback/abort/surface，单窗口至多消费一次，官方默认路径结果归一化进同一决定窗口不二次重试 |
| `recovery/tool` | automatic | 同上：agent-loop 调度器把 dispatch/preparation 失败路由到同一 recovery authority，终态 step 结果提交前应用决定 |
| `recovery/task`、`recovery/transaction` | automatic | 同上：task settlement 与 workspace transaction recovery 在终态提交、retry 或 rollback 前调用同一私有 authority |
| `recovery-visibility` | automatic | 自动消费证据同 wave4 测试；投影由 recovery owner 驱动 |
| `llm/request-transform`、`llm/admission`、`route`、`circuit`、`visibility`、`channel-auth`、`tool-restrict`、`tool-guard`、`skill-activation`、`prompt-provenance`、`security-policy`、`security-redaction` | automatic | 既有已交付测试（见 §1 对应行） |

被测路径的共同断言（wave3/wave4 测试）：注册后自动求值（调用方无第二次咨询）、显式 deny 发生在 transport 建立/副作用前、allow 绑定精确目标/owner/generation/expiry、目标或动作变化重新求值、egress 的 callback 失败与 authority 不可用保持官方出站行为并报 unavailable（denylist 基线）、各 owner coverage 独立、第三方裸调用不被伪称为已拦截。

## 3. 具名 edge gap 与退役条件（gaps）

本窗口按 Requirement 10 逐路径评估后保留的具名 gap；每条携带证据与退役条件，不泛化到已闭合路径。

| gapPath | 组件 | 失败通道（摘要） | 退役条件 |
|---|---|---|---|
| `telemetry` | `dsh-session-telemetry-otel` | 无官方 pre-export dispatch 点；门面无 exporter transport 所有权；无已批准 replacement；新 replacement 需无 harness 验证的契约复刻 | 官方提供 pre-export policy seam，或 harness 验证的 replacement 复刻 exporter 契约 |
| `remote` | facade remote/attachment 路径 | 桥接路径的最终副作用 owner 在官方组件闭包内；transitive 证明先于独立 gate | 该层展示独立出站副作用后补独立 gate |
| `web` / `web/attachmentRemote` | `dsh-web` / `dsh-web-search-deepseek` | `dsh-web` 无已批准 replacement、provider 闭包不暴露门面可触达的 pre-fetch seam；新建 replacement 需完整契约复刻 | 官方 pre-fetch seam 或 harness 验证的 replacement |
| `subprocess` / `terminal` / `shell` | `dsh-subprocess` / `dsh-subprocess-local` / `dsh-terminal*` / `dsh-shell` | 完整官方 Service（spawn/spawnTerminal/进程树/terminal 原语），无 harness 验证复刻不可安全交付；替换 `ctx.subprocess` 会改变每个消费者的官方服务 | 官方 spawn/pre-exec seam 或 harness 验证的 replacement |
| `connection` | browser connection | host/client 拆分；浏览器 transport 无法在无 harness 环境验证 | 可验证的客户端 gate 交付窗口 |
| `llm/provider` | `dsh-llm-deepseek` / `dsh-llm-pi-ai` | provider 最终 endpoint 在 adapter 闭包内私有；provider 行 replacement 需 harness 验证 parity | 官方暴露 provider endpoint 决策 seam，或 harness 验证的 provider 行 replacement |

以上 gap 影响安装模式：full 与 selective 均只影响具名路径的 availability 报告（`unavailable`/`degraded`），不影响其余受保护路径。

## 4. 合作型接口清单

- egress：`security.egress.register`（policy）+ `security.egress.lease.acquire/release`（coordination；异步 `Outcome<Lease>`、release 幂等、stale handle typed conflict）。第三方调用公共接口时受支持；直接绕过（裸 fetch/socket/spawn）不在保证内（Requirement 10 AC5）。
- recovery：`executions.recovery.capability.register` / `policy.register`（policy）+ `executions.recovery.evaluate`（operation，返回冻结 M8 operation outcome；不声称改变调用方私有 operation）。自动消费与合作型求值共用同一 registry、同一 reducer、同一默认决定、同一审计 authority。
- 自定义事件：`events.define(spec)` → 冻结 publisher handle `{ id, ownerId, generation, name, emit(payload), dispose() }`（Wave 5）。合作型归属：owner 可用时从真实插件上下文派生，否则 root token；canonical/custom 分域；同身份冲突确定性拒绝，绝不静默替换 owner；stale publisher 既不能派发也不能移除较新定义；`events.observe` 可用标准投影句柄观察已定义 custom 事件。`scope` 字段作为已接受的定义元数据保留，对 custom 事件派发/观察不引入额外门控（canonical `scopeFiltered` 语义不适用于 custom 目录）。不声称对抗性同进程隔离（恶意绕过记 out of scope）。
- 内部契约（非公共面）：root ctx 上 symbol-keyed `egress.admit/release`、`recovery.decide/commit`、`policy.status`；组件 owner 缺失 = typed unavailable/degraded；对 egress（denylist，默认 allow）表现为保持官方出站行为而非隐式放行新的能力，recovery 与其他领域仍绝不隐式放行。

## 5. 安装模式验证

- full 聚合与「主包 + 选择性 enforcement 包」在同一冻结基线装配等价能力集与行为，无双跑、无替代行语义改变（既有 full-bundle 等价测试与本 feature 各 replacement 包测试）。
- 缺少可选 enforcement owner 时，仅受影响具名路径报 `degraded`/`unavailable`，不把官方行置于「disabled 且无功能替代」的空洞（replacement apply boot 自检 + fail-safe 回退）。
- 移除 replacement 后恢复官方行且 coverage 如实变化（各 replacement 包文档与既有恢复测试）。
- 官方包零修改：`/usr/lib/node_modules/@deepseek-ai/dsh/**` 未修改。

## 6. 边界声明

- **egress**：已登记受支持官方路径（llm model discovery、mcp stdio/http transport）自动受内部 egress authority 管治；egress 是 **denylist**，初始不注册任何策略，未命中 deny 策略的出站目标按官方原版行为放行，只有显式 deny 策略拦截；合作型第三方路径在调用公共接口（注册 policy、获取/归还 lease）时受支持；直接绕过（裸网络/进程原语）不在保证内。`security.egress.check` 不恢复为公共成员，守恒由自动执行证据闭合。
- **recovery**：`executions.recovery.consume` 不恢复；自动消费（单窗口至多一次）与合作型 `evaluate` 求值区分记录；官方 retry provider 默认路径行为在无自定义 policy 时不变。
- **events.define**：合作型归属 + canonical/custom 分域；不提供对抗性同进程 owner 隔离；`events.define` availability 在合作型自定义事件契约可用时即报 active。
- **能力守恒**：四个原 gap/removal 簇（`events.define`、`storage removals`、`security.egress removals`、`executions.recovery removals`）均以 replacement 或闭合证据收口，registry 无残余 gap；`lib/capability-matrix.js` 镜像与 registry 机械一致（`test/policy-inventory.test.mjs` 全量 parity 断言）。

## 7. 上游提案与退役条件

- U24（feature-list §3）：官方 owner-scoped custom event publisher seam。官方提供等价定义注册、身份冲突与生命周期回收后，`events.define` 退役为官方直绑，门面保留 canonical 目录与稳定化语义。
- U11/U13/U14/U15（route/recovery 相关）保持原登记；本 feature 的 R 类扩展（`agent-loop` egress/recovery 消费、`llm` egress gate、`mcp` egress gate）均为已批准 replacement 的加性切片，各自退役条件见 feature-list §3/§7 对应行。

## 8. 验证

- `npm test`（护栏脚本）全绿；`git diff --check` 通过；`scripts/registry-validate.mjs` 与 `scripts/policy-inventory-validate.mjs` 全绿；官方包修改审计通过；本 feature 未新增客户端面、未引入新运行时依赖、未产生跨组件全局 replacement。