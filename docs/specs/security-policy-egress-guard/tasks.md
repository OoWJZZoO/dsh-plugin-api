# Stage 3 - Tasks

## Status

SPEC3：Stage 0 Goal、Stage 1 Requirements、Stage 2 Design 已确认（2026-08-25 批量确认门 + SPEC2 纠偏并入，基底 commit `cb17052`）；Stage 3 Tasks 已通过对抗性审查（2026-08-25，返回无偏差）；Stage 4 全部顶层任务已实施（1–7 implemented），全局终审两轮通过（2026-08-25，无偏差），`npm test` 全绿（1733/1733）。

## 执行注

- 本任务书按 AGENTS.md §3.2 SPEC3 规则执行：Tasks 通过对抗性审查门后直接进入 Stage 4（Execute），由代理自主完成全部顶层任务；全部完成并验证后先做**一次全局终审**，通过后才交付结果报告、做 Stage 4 完成提交并清理 worktree。
- 并行契约：本 worktree 代理 `security-policy-egress-guard` feature（Wave A，分支 `feat/sec-security-policy`，源自 `cb17052`）。契约见 `temp/m6-batch4-contract.md`（§1.1/§1.2 命名、§2 共享文件编辑边界、§3 冻结文件、§4 失败呈现、§5 合并顺序与预检）。
- 制品状态行：每个顶层任务完成后，把该任务标题前的 `[ ]` 改为 `[x]` 并在其下追加一行 `- 状态：implemented`。
- 实现约束（AGENTS.md §6 / 契约）：
  - 治理代号（`SEC-*`、需求编号、分类字母、`r1` 后缀、SPECx 等）不得出现在 `lib/`、`test/`、`package.json` 及任何运行时字符串中；错误码用能力词（`SECURITY_POLICY_INVALID_SPEC` 风格）。
  - 测试统一 `npm test`（4G 护栏），勿用裸 `node --test`；纯函数模块零 harness 依赖。
  - 不修改官方 DSH 包文件；所有入口 fail-safe，绝不抛穿 apply。
  - 冻结文件与共享文件编辑边界以契约为准；`docs/specs/security-policy-egress-guard/` 为本 feature 制品目录，可自由编辑。
  - 本批不单独改主包 `package.json` 的 version/dsh.api、不登记 feature-list §7、不改 full 聚合 patch（契约 §2/§5：批集成 sync 统一处理）。
  - 公共 API 形状见契约 §1.1：`pluginApi.security.policy` / `.redaction` / `.egress` / `.audit`（宿主面）；`pluginApi.security.availability` 为真值查询（security 域内保留名，与 usage/execution 先例一致）。

## Task List

### 1. 官方 seam 契约核实（锁定版本对照）
- 状态：implemented

- [x] 1.1 对照本机锁定 runtime（`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`）核实以下 seam 形状，并在 `lib/security-owner.js` 首部注释记录核实结论与版本来源（design「具体改写字段在实现任务首项对照锁定版本核实」）：
  - `dsh-user-approval/lib/types`：`approval/request` waterfall 签名与 `ApprovalOutcome`（'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'）、`ApprovalRequest` 字段（agent/toolName/callId/reason/signal）、短路语义（listener 返回 outcome 不调 `next()`）——SEC-3.1/3.2/3.3；
  - `dsh-tools/lib/types`：`tools/pre-execute` 签名与 `PreToolDecision`（allow/deny/ask）——SEC-2.1（tool-before 点）；`tools/post-execute` 签名与 `PostToolDecision`（accept 可带 `content` 或 `value` 之一、block）及官方 `postExecute` 对 accept 决策的字段处理（content 替换 / value 重建校验 / 两者同给抛 TypeError）——SEC-4.2；
  - `dsh-llm/lib/types`：`llm/stream` waterfall 签名 `(options, next)` 与 `GenerateOptions`——SEC-2.1（model-request-before 点）；
  - `tools` 事件同名的既有订阅者（execution-observation-sources、usage、llm-request 的 `llm/stream` 成员）与 Cordis waterfall 多成员 `next()` 链语义，确认本 feature 自持 listener 的位置约束（须在 llm-request 之后注册，见任务 6/7）。
- [x] 1.2 依据核实结果，把每个 seam 的返回/断言形状固化为任务 6/7 集成测试的 fixture 常量（不 import 官方私有模块；测试内联形状 + 来源注释）。产出：`test/security-policy-owner.test.mjs` 的 seam fixture 段 + 核实注释。
- [x] 1.3 迁移验收等价回归（design Testing Strategy #6）：无任何策略/规则注册时，official approval/tools/llm 行为零变化（listener 一律透传 `next()`；不为空转）。产出：回归断言（可置于任务 6.7 / 7.4 集成测试内，标注「无注册回归」）。

### 2. 注册表核心：`lib/security-policy.js`（registry + 决策收敛）
- 状态：implemented

- [x] 2.1 实现 `createSecurityPolicyRegistry({ pointDefault, validateSpec, now })` 与 `createSecurityRegistryInstance`（三实例复用：policy 面 / redaction 面 / egress 面，design Components 1）：
  - `register(ownerId, spec)` → 返回 `{ generation, dispose }`；typed 校验先行（缺 ownerId、缺/非法 matcher、非法 point、非法 outcome 枚举、过期时间非法 → 抛 typed 注册错误，未生效即拒）——SEC-1.1/1.2；
  - disposal 幂等且按 identity 只删本 owner 本条目的当前 generation；同 owner 再注册同 id → `latest-wins` 新 generation 取代旧 generation，旧 policy 在下一次 evaluate 前退休，过去决策的审计归因不变——SEC-1.3/1.4；
  - generation token：owner 域内 opaque `\`${ownerId}:${opaque 随机串}\``（注入 rng，测试可固定），不做全局单调序号（identity-and-lifecycle §2）。
- [x] 2.2 实现 `evaluate({ point, context, defaultOutcome })` → 收敛决策：
  - 冻结输入快照后按 `(point, insertion order)` 逐个调用匹配策略——SEC-2.1；
  - 冲突按 `deny > ask > allow` 收敛；决策含 `policyId`（winner）、`reason`、`expiresAt?`、`auditId`、`consulted`（全部被咨询 policyId 列表）——SEC-2.1/2.2；
  - 单策略抛错或返回畸形结果 → 只降级该策略为该点的默认决定，其余策略与宿主操作存活——SEC-2.3；
  - 点默认值 fail-closed 底线（任何点不得默认 allow）：egress=deny；approval-context=ask；tool-before=ask；model-request-before=ask；redaction=noop——SEC-2.4；
  - provenance 缺失（无法解析 session/execution 上下文）→ 仍评估，决策携带 `provenance: 'unknown'` 标记，不因缺失而拒绝评估——SEC-2.5。
- [x] 2.3 决策/审计关联：决策以 `auditId`（=决策 id）为键与审计记录一一对应（design Data Models：「auditId(=decisionId 关联键)」）——SEC-7.1/2.1/6.1。
- [x] 2.4 单元测试（纯函数，零 harness）：precedence 收敛矩阵（deny>ask>allow × 组合）、generation 替换与 dispose 幂等、点默认值矩阵、单策略降级、provenance unknown 容错、注册参数 typed rejection 矩阵（SEC-1.2/2.2/2.3/2.4/2.5）。产出：`test/security-policy.test.mjs`。

### 3. 脱敏引擎：`lib/security-redaction.js`（纯函数，零 harness 依赖）
- 状态：implemented

- [x] 3.1 实现 `applyRedaction({ root, audiences, rules })` → `{ content, applied: [{ ruleId, count }] }`（design Components 2）：
  - 规则注册要求显式 audience 集合，规则只对声明受众生效——SEC-4.1；
  - 覆盖边界（design 定稿、SEC-4.5）：嵌套对象递归；字符串按规则替换为带 `redacted:<ruleId>` 标记；二进制/buffer 仅在元数据层标记、不深读；异常 cause 展开一层；MCP resource 内容视为不可信文本同样过规则；日志面只输出摘要计数、不落全文（audit 记录只存计数/摘要）；
  - 单节点处理失败 → 该失败节点整体替换为 redacted marker（同级已成功节点不受影响）；整个输入无法结构化 → 整树替换——SEC-4.4；
  - 变换结果保持「发生过脱敏」的可感知结构（marker/count），不静默替换为无关数据——SEC-4.3。
- [x] 3.2 secret gate（design Components 3、SEC-5）：规则注册声明 `mayTouchSecret`；凡命中 secret 形状（凭据/认证材料/私钥/安全 token 等，按 `docs/standards/visibility-and-redaction.md` §2 定义的形状集合）或声明 true 的**暴露方向**决定，必须经 user/profile secret policy 放行（v1 内部固定默认 deny，插件注册单独不足以放行，availability 如实标注）；denied → 全受众保持脱敏（redacted marker）+ 有界审计计数（不含 secret 值）——SEC-5.1/5.2/5.3。
- [x] 3.3 单元测试矩阵（纯函数）：受众 × 内容类型（嵌套对象/数组/字符串/二进制/异常 cause/MCP 文本/日志摘要）、失败节点粒度、整树失败、secret gate 默认拒绝与计数出账、标记/count 结构断言（SEC-4.1/4.3/4.4/4.5、SEC-5.1/5.2/5.3）。产出：`test/security-policy-redaction.test.mjs`。

### 4. Egress 检查与租约：`lib/security-egress.js`
- 状态：implemented

- [x] 4.1 实现 egress 检查（复用任务 2 registry，point default=deny）：`check(target)` → 收敛决策（含 `policyId`、`reason`、`expiresAt?`、`auditId`）——SEC-6.1；`EgressTarget { kind: 'subprocess'|'http'|'mcp'|'remote', destination }`；非法 target（kind 枚举外、destination 缺失/非字符串）→ typed rejection。
- [x] 4.2 实现租约：`lease.acquire(target, ttl)` → `{ generation, expiresAt, revoke }`：
  - 租约作用域 = 授予时的目标描述；不授权目标之外任何 target——SEC-6.2；
  - 租约在 `expiresAt` 到期；`revoke` 幂等；过期或撤销后，后续 `check` 一律 fail-closed，禁止回溯延长——SEC-6.3；
  - grant 建账复用该 check 决策的 auditId（design「grant 审计复用该 check 决策的 auditId」）——SEC-7.1；
  - 时钟注入（`now`），测试可控。
- [x] 4.3 proxy 环境检测 ≠ egress allowance：检测到 proxy 配置既不产生 allow 也不产生 deny 之外的任何语义（v1 策略面不消费 proxy 环境变量——SEC-6.4）；无官方拦截点时强制拦截路径为 C `upstream-required`，如实披露于 availability/enforcement 边界注释，不伪造强制力——SEC-6.5。
- [x] 4.4 单元测试（纯函数 + 时钟注入）：check 收敛与默认 deny、lease 作用域（同 target 授权 / 异 target 拒绝）、到期与撤销后 fail-closed、不回溯延长、proxy 无关性、非法 target typed rejection。产出：`test/security-policy-egress.test.mjs`。

### 5. 审计账本：`lib/security-audit.js`
- 状态：implemented

- [x] 5.1 实现有界环形缓冲账本（design Components 5）：
  - `append(auditRecord)`：容量常量（默认 512，测试可注入小容量），溢出丢弃最旧并置 `truncated` 旗标——SEC-7.1；
  - 记录字段：`{ auditId, seq, at, kind: 'decision'|'redaction'|'egress-grant', ownerIds[], policyIds[], summary, outcome, generation? }`，无敏感原文，`at` 来自注入时钟——SEC-7.1；
  - 审计/暴露记录失败 → 后续查询暴露显式 `gapSince` 标记，不伪造缺失记录；基础决策本身照常生效——SEC-7.3。
- [x] 5.2 实现 `query(filter)` → 冻结只读视图（filter：`{ kind?, ownerId?, limit? }` 最小集）：
  - 视图 deep-frozen；secret 值/private 内容一律脱敏（只出 summary/count）——SEC-7.2；
  - 查询为只读投影，无 mutation 面（api-shape projection 面）。
- [x] 5.3 单元测试：bounded 环形 + truncated、冻结视图、脱敏视图、append 失败 → gapSince、decision↔audit 一一对应。产出：`test/security-policy-audit.test.mjs`。

### 6. Host owner：`lib/security-owner.js`（seam 绑定 + fail-safe）
- 状态：implemented

- [x] 6.1 实现 `createSecurityOwner({ ctx, logger, now, rng, diagnosticsFacade })` → `{ api, dispose, availability }`：
  - 组装 policy/redaction/egress/audit 四面 + secret gate；owner 构造或任一 seam 绑定失败 → 全 feature 降级 inert + availability 如实报告，绝不抛穿 apply（G1 模式）——SEC-8.2/8.3；
  - `api` 形状（宿主面，全 frozen；design Components 1/2/4/5）：`policy.register` / `redaction.register` / `egress.register`、`egress.check`、`egress.lease.acquire` / `audit.query` / `availability`；无 client 面（SEC-9.2：不暴露任何注册/决策/授权/审计 mutation 给 client 消费路径——本 feature 不新增 client transport，`lib/client*.js` 冻结不动，client 半面 inert 且不影响无关 client 面——SEC-9.1/9.3）。
- [x] 6.2 绑定官方 `approval/request` waterfall（design 引出机制表 / SEC-3）：`(req, next)` → 评估 approval-context 点 → deny → 短路返回 `'rejected'`；allow → 短路返回 `'allowed-once'`（官方结果语义）；ask / 无注册策略 → 透传 `next()`（官方行为完全不变）——SEC-3.1/3.2/3.3/3.4；C 类（无官方 dispatch 点的 approval 类决策类别）如实披露为 upstream-required，不发明平行审批通道——SEC-3.5。
- [x] 6.3 绑定官方 `tools/pre-execute` waterfall（SEC-2.1 tool-before 点）：评估 → deny → 返回 deny 型 `PreToolDecision`（短路）；allow/ask/无注册 → 透传 `next()`（不自动 allow，官方 ask 流照常）——SEC-2.4/3.4。
- [x] 6.4 绑定官方 `tools/post-execute` waterfall（SEC-4.2）：以任务 1 核实的 `PostToolDecision` accept 改写通道发布脱敏后 `content`（audiences 取 model/ui 消费面；日志面只出摘要计数入审计）；转换发生 → accept 短路返回改写后内容 + 决策/审计带 applied 计数（provenance marker/count，SEC-4.2/4.3）；无规则匹配 / 无改写 → 透传 `next()`；引擎失败 → fail-closed（整树/节点 redacted marker）绝不返回部分未保护原文——SEC-4.4；不改写失败结果中的 value 字段（锁定版本核实结论：value 重建走官方 schema 校验通道，v1 不触碰；覆盖边界在 availability/注释如实声明——SEC-4.5）。
- [x] 6.5 绑定门面自有 `llm/stream` 重入点（design 引出机制表 model-request-before 点）：该 listener 在 `lib/llm-request.js`（冻结）的 `llm/stream` listener **之后**注册（任务 7 装配序保证迭代位置在 llm-request 之后）；每次 dispatch 用 `GenerateOptions` 派生上下文评估 → deny → **抛 typed 错误使请求 fail-closed**；ask/allow/无注册 → 透传 `next()`；上下文不可解析 → provenance unknown 仍评估（SEC-2.5）；listener 自身绝不抛穿（策略错误只降级该策略）——SEC-2.1/2.3/2.4。
- [x] 6.6 诊断上报（SEC-8.1）：策略反复抛错或注册期验证失败 → 经既有 plugin diagnostics 设施以 owner 归因上报（`diagnosticsFacade`（`service.diagnostics`）可用时 register 一条 scope=plugin 的 degraded 检查；不可用时降级 logger.warn，availability 如实反映上报通道状态）；宿主操作与其他条目不受影响——SEC-8.1、契约 §4.2/4.5（禁止裸 console 替代 diagnostics 通道）。
- [x] 6.7 集成测试（`test/security-policy-owner.test.mjs`，mock ctx + 链式 waterfall 模拟）：
  - approval 短路（deny→'rejected'、allow→'allowed-once'）与 ask 透传；pre-execute deny 生效且 ask 不阻断；post-execute 脱敏 provenance（applied 计数 + content 改写）随结果下发；llm/stream 重入点 deny 抛 typed error、ask/allow 透传（含与 llm-request 迭代顺序的链式断言）；decision↔audit 关联（auditId 一一对应）；策略持续抛错 → 降级 + diagnostics 上报；无注册回归（任务 1.3）；secret gate 默认拒绝 + 计数出账；setup 注错 → inert + availability 如实；client 半面：宿主面外无任何 client 注册/决策/授权/审计面（SEC-9.1/9.2/9.3）。

### 7. 门面装配（共享文件追加式改动，契约 §2）
- 状态：implemented

- [x] 7.1 `lib/guards.js`：追加独立的 `security` feature guard branch（probe：`ctx.on` 可用性为强制基座；不修改他人 probe）。——契约 §2；SEC-8.2。
- [x] 7.2 `lib/plugin-api-service.js`（命名空间装配点，契约 §2 追加式）：追加带 `// security-policy` 分隔注释的注册块——
  - `KNOWN_FEATURES` 增加 `'security'`；
  - `_assignFeature` 增加 `'security'` 分支：校验 owner api 形状（policy.register / redaction.register / egress.register / egress.check / egress.lease.acquire / audit.query / availability），挂 slot + 公开 getter（`pluginApi.security`），disabled 时返回 typed `PluginApiFeatureDisabledError('security')` 面；
  - `_readSlot` / `_disabledSurfaceFor` / `unmountFeature` 相应分支（对齐 usage/recovery/coordination 先例）。
- [x] 7.3 `lib/index.js`（命名空间装配点，契约 §2 追加式）：追加 `// security-policy` 分隔注释注册块——import `createSecurityOwner`；定义 `mountSecurityFeature`（`featureRegistry.isActive('security')` 幂等短路；owner 构造失败 → 返回 null 由既有 fail-safe 路径禁用）；`FEATURE_MOUNTERS` 在 `llm/admission` 之后、`session` 之前插入 `['security', mountSecurityFeature]`（保证 `llm/stream` listener 注册序在 `llm/request` 之后——任务 6.5；同时不扰动尾部 pin：`test/index-remote.test.mjs` / `test/index-diagnostics.test.mjs` 只 pin 尾 6 位的相对顺序）。
- [x] 7.4 装配集成测试（`test/security-policy-assembly.test.mjs`，走 `apply(mockCtx)` 全链，对齐 `test/index-diagnostics.test.mjs` fixture）：
  - 健康 apply：`pluginApi.security` 四面子面可用 + availability 如实；`features` 含 `security` 且尾部 pin（remote/execution/recovery/coordination/diagnostics/usage 相对序）不破——契约 §5 预检；
  - guard 注错（`ctx.on` 缺失）→ security 停用、其余 feature 不受影响、禁用面抛 typed disabled 错误；
  - 全仓回归：`npm test` 全绿、`git diff --check`、无冻结文件改动、治理代号泄漏扫描（既有 `governance-token-audit.test.mjs` 全绿即满足）。
- [x] 7.5 迁移验收等价回归（`test/security-policy-facade.test.mjs`）：无任何策略/规则注册时，official approval/tools/llm seam 行为零变化（透传断言），与任务 1.3 呼应；有注册时行为符合 SEC-2/3/4/6 且失败呈现符合契约 §4 P1–P4。产出：装配回归与 face 回归。

### 8. 交付收尾

- [x] 8.1 全部顶层任务完成、`npm test`（4G 护栏）全绿后，回写 `docs/specs/security-policy-egress-guard/tasks.md` 全部勾选 + implemented 状态；执行 Stage 4 全局终审（阻塞式只读对抗性审查，`run_in_background: false`）；无偏差后做 Stage 4 完成提交（含本批实现、测试、spec 修订与登记），并清理 worktree。
  - 状态：implemented（全局终审两轮通过，2026-08-25）
- [x] 8.2 交付报告注明：实现中的 spec 修订（若有，含 design Data Models `EgressLease` 未列 `revoke`、本任务为满足 SEC-6.3 的补充注记）、越界改动（若有）与理由、批集成 sync 待办（版本/dsh.api、feature-list §7、full 聚合等价校验、catalog 基数断言）。

## Requirements 覆盖对照

| 需求 | 任务 |
|---|---|
| SEC-1.1/1.2/1.3/1.4 | 2.1/2.4 |
| SEC-2.1/2.2/2.3/2.4/2.5 | 2.2/2.3/2.4、6.2–6.5 |
| SEC-3.1–3.5 | 1.1、6.2、6.7 |
| SEC-4.1–4.5 | 1.1、3.1/3.2/3.3、6.4 |
| SEC-5.1/5.2/5.3 | 3.2/3.3 |
| SEC-6.1–6.5 | 4.1–4.4、6.1 |
| SEC-7.1/7.2/7.3 | 2.3、4.2、5.1/5.2/5.3 |
| SEC-8.1/8.2/8.3 | 6.1/6.6/6.7、7.1/7.4 |
| SEC-9.1/9.2/9.3 | 6.1/6.7（7.2/7.4 覆盖禁用面 availability 呈现） |
| design Testing Strategy #1–#6 | 2.4、3.3、4.4、5.3、6.7、1.3/7.5 |

## Standards 对照（实现前已读一次，审查按分册比对交付）

- capability-strategy：B 类门面，横切语义不触碰（design 已定，本任务不新增 R 行、不改 catalog）。
- api-shape：policy registry 面（单一 register 入口、纯函数、决策幂等收敛）；audit 为只读 projection；无 durable mutation 主面。
- identity-and-lifecycle：owner id + owner 域内 opaque generation；决策记录不复用生命周期词。
- durable-state-and-scope：audit v1 = 非 durable 内存有界队列，availability 如实标注（不虚占 scope 档）。
- visibility-and-redaction：受众四分落规则 audience 集；secret 提升走默认 deny 的 user/profile 平面（v1 内部固定 deny，availability 如实标注）。
- concurrency-and-cancellation：决策评估同步收敛（latest-wins 声明于 registry）；audit 订阅/查询只读；disposer 幂等 identity-bound。