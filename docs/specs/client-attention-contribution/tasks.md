# Stage 3 — Tasks

> feature_name: `client-attention-contribution`
> milestone: M9

## Status

SPEC3 Stage 3：本任务书承接已确认的 `goal.md`（2026-09-06 人类批准）与 `requirements.md`/`design.md` v2（2026-09-06 同批人类确认，M9 批量确认门）。本章按 AGENTS.md §3.2 以对抗性审查为门；审查返回「无偏差」后直接进入 Stage 4，不设用户确认门。

**并行纪律（引用契约 §7.1 与 `docs/specs/plugin-api-m1-integration/parallel-workflow.md` 三阶段协议）**：本 feature 属于 M9 第二波（`temp/m9-parallel-development-contract.md` §3.3），在独立 worktree `m9/client-attention-contribution` 工作，所有提交只落在本分支。本线并行期只写「文件边界」列出的 owner 文件；`lib/plugin-api-service.js`、`lib/index.js`、`lib/guards.js`、`lib/events-catalog.js`、`lib/events-bus.js`、`lib/deep-freeze.js`、`test/index.test.mjs`、`test/index-events.test.mjs`、`docs/specs/plugin-api-features/feature-list.md`、`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json` 与 `temp/m9-parallel-development-contract.md` 并行期冻结。任何任务不得修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 或任何官方包文件。

**R 准入（capability-strategy R1–R8 硬性规则逐条适用）**：两个 R slice（api-remotes、client-runtime，均新建 owner 包）提交前必须各自满足 R1（只走官方 patch 机制）/R2（整行复刻 ctx 服务面与事件面契约，parity fixture 逐项门）/R3（官方 import 面不覆盖）/R4（apply 内 boot 自检，失败 fail-safe 记录日志+正常 return，绝不静默双跑）/R5（版本锁定 runtime 全量 identity 与被替代官方包 identity）/R6（组件唯一 owner、检测 owner 冲突与重复插入）/R7（client 半面自建构建，官方模块 id、`window.__DSH_BOOT__`/HMR 验证）/R8（不覆盖 boot 胶水与 framework 横切派发语义）。

**probe 门（design §6）**：两个 slice 每个都以「契约 probe」为进入完整复刻的前置门。probe 验证官方行/官方包契约可复刻性与扩展边界；probe 失败按 fallback 语义处理——官方行行为照常（官方 apply 重跑或官方路径保持）、扩展不宣称、能力 typed `degraded`/`unavailable`，绝不留下官方行 disabled 而无工作替代的空洞、绝不静默双跑（Requirement 11 AC5/Requirement 12 AC5）。

**条件性人类裁决门（非默认门）**：Stage 4 默认全程自主执行不中断。仅当实现中发现 probe 结论与 design §3/§4 声明不符、官方契约事实与已批准 Requirements/Design 验收边界冲突（动摇 Goal/Requirements 验收边界），或需要越出「文件边界」触碰冻结/其他线文件时，暂停对应子任务，在交付报告中上报编排主代理请求人类边界裁决。其余情形 Stage 4 不中断。

## 需求锚点

任务引用 `requirements.md` 各节；Wave 标注覆盖的 Requirement（R1–R14）：

- **R1** 条目、owner 与 handle（contribution 入口与冲突码）；**R2** 内容契约与脱敏包络；**R3** host projection（current/list/observe）；**R4** dismiss/expiry/cleanup 生命周期；**R5** client 面（projection/contribute/dismiss/invoke 往返）；**R6** reconnect/rebind/generation containment；**R7** action invocation；**R8** availability/degradation/capability；**R9** scope/durability/privacy 边界；**R10** 边界（无 activity 判断、无 UI 策略）；**R11** api-remotes R slice 契约；**R12** client-runtime R slice 契约；**R13** 多 owner 组合与消费者安全；**R14** 验证与交付门。

## 冻结决策（实现须逐项遵守）

1. **基线冻结**：`packageVersion = 0.1.0-rc.6-0.1.0`、`dsh.api = 0.1`；两个新 owner 包与主包共享同一 `A.B.C`（`0.1.0-rc.6-0.1.0`，各包 `D` 沿用 `0`）。任何版本字段不得 bump（AGENTS.md §3.0.1 冻结条款）；不得以新增 API/公共语义修订为由擅自步进版本。
2. **单一条目 authority（不变式）**：host attention hub 是唯一条目 authority；client 生产与消费都回到 hub；任何 slice 只是传输/运行时，不产生第二个条目权威；无双 hub、无双跑（R10 AC5、design §Key Decisions 2）。
3. **事实来源纪律（契约 §3.3）**：attention 不拥有 activity 事实、不判断 turn settle；只消费 `sessions.activity` projection 的派生信号（可选适配）；事实源未装配时诚实降级，correlation 引用不可验证 ⇒ 标记 `unknown`（R2 AC3、R10 AC1）。
4. **idiom 与公共面形状**：contribution 入口 `contribute(spec)` + 判别式结果 + `{id, ownerId, seq, dispose()}` handle；`dismiss`/`invoke` 为贡献域内受控动作；projection 用 `current`/`list`/`observe`（observe handle `{current(), subscribe(listener), dispose(), epoch}`，listener 异常只降级该 listener）；`availability()` 冻结 `{status: active|degraded|unavailable, reason?}` 且永不抛。形状对齐 `docs/standards/api-idioms.md` §3.1/§3.5 与 `docs/standards/api-shape.md`。
5. **治理魔法字母不入实现（AGENTS.md §6、契约 §5）**：`lib/`、`packages/<两个新包>/`、`test/`、`package.json`、patch 文件与运行时可见字符串中不得出现治理编号、分类字母、feature 名、需求号、批次代号或带治理后缀的 token（如 `attention-r1`、`A11` 等）。运行时命名中性、面向能力/语义。
6. **生成物纪律**：主包 `lib/client.js` 与 R slice 的 client 半面 `packages/*/lib/client.js` 是检入生成物，**禁止手工编辑**；只能经各自检入重建入口更新（主包 `npm run build:client` = `scripts/build-client-bundle.mjs`；slice 包 `npm run build:client` = `scripts/build-client.mjs`），重建后核对产物 diff 仅含预期变更再提交。
7. **非 durable + 脱敏 fail-closed + client 不排队**：attention 条目只存 hub/runtime 内存，不写任何 durable 记录/session 历史（R9 AC1/AC2）；redaction 在 host hub 产出转发消息前生效（受众裁剪失败 ⇒ 不产出负载，宁可 unavailable，R2 AC2、design §Data Models §4）；client 只做形状校验，无法注入 host 可见字段（R5 AC5）；client 离线/不可达 ⇒ typed `unavailable`，不排队（R5 AC4、R10 AC5）。
8. **`attention/update` 边界（R11 AC3 由 probe 钉定）**：11 个官方白名单事件语义逐字复刻，`attention/update` 只在完整复刻（R2 顺序）后作为 typed 扩展键加入转发集；**不扩大**消费者侧 `ctx.remote.$on` 合法键集（保持复刻后的 11 键）；扩展消息经替换模块自身复刻的转发路径送达 client-runtime slice，第三方消费者经 `ctx.pluginApi.attention` 获取，不经 `$on`。
9. **R slice 失败语义**：自检/parity/probe 失败 ⇒ 记录有界日志 + 官方行为照常 + 能力不宣称 + typed `unavailable`；绝不留官方行 disabled 而无工作替代（R11 AC5、R12 AC5）。
10. **U-series 登记与退役条件**：每个 R slice 在本线 spec 制品登记其 U-series 上游提案与退役条件（capability-strategy §4.1）；feature-list §3.1 的 registry 登记由集成波执行（R11 AC8/R12 AC8、design §3/§4）。

## 文件边界（引用契约 §7.1；本线 owner 表）

### 本线并行期允许触碰（owner）

- `docs/specs/client-attention-contribution/**`：本线 spec 制品目录（本任务书 + Stage 4 就地修订 + 本线 U-series/内部契约制品）。
- `lib/attention-*.js`：host attention hub 及配套纯模块（feature-domain 命名，如 `attention-hub.js`、`attention-projection.js` 等；不得含治理字母/批次编号）。
- `lib/client-attention-*.js`：主包 client 面 leaf 纯模块（对外形状 `ctx.pluginApi.attention.{current,list,observe,observe.handle,contribute,dismiss,invoke,availability}`；消费 client-runtime slice 暴露的内部 runtime 契约；由集成波挂载进 client bundle entry）。
- `test/attention-*.test.mjs` 与 `test/client-attention-*.test.mjs`：本线 focused tests（owner 模块与测试均可直接构造测试，不依赖共享 mounter/guard）。
- `packages/api-remotes/**`：api-remotes R slice（唯一官方组件 owner `@deepseek-ai/dsh-api-remotes`）。
- `packages/client-runtime/**`：client-runtime R slice（唯一官方组件 owner `@deepseek-ai/dsh-client-runtime`）。

### 冻结文件（任何情况下不得修改）

`lib/plugin-api-service.js`、`lib/index.js`、`lib/guards.js`、`lib/events-catalog.js`、`lib/events-bus.js`、`lib/deep-freeze.js`、`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`、`docs/specs/plugin-api-features/feature-list.md`、`test/index.test.mjs`、`test/index-events.test.mjs`、`temp/m9-parallel-development-contract.md`、任何 `packages/*` 下属于其他线的文件，以及 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 全部官方包文件。

### 集成波归属（本线只列出要求与验收，不执行）

`lib/plugin-api-service.js` append slot、`lib/index.js`/`lib/guards.js` mounter 追加、`lib/client-runtime.js` client bundle entry 挂载 attention leaf + `lib/client.js` 重建、registry/feature-list/README/full 聚合装配与跨线装配验证（详见 Wave 8）。

---

## 任务清单

### [ ] 1. Wave 1 — 基线核验与本线契约基底（R8、R14；契约 §2/§7.2）

- [ ] **1.1 基线核验**：核验主包与两个新包 `package.json` version 均为 `0.1.0-rc.6-0.1.0`、`dsh.api` 均为 `0.1`；确认冻结文件清单在工作树中未被触碰（`git status` 对照）；确认 worktree 隔离与官方包零修改基线。不为 M9 步进任何版本字段。产出核验结论作为 Wave 1 证据。
- [ ] **1.2 共享词汇对齐**：核对 M9 契约 §2 词汇（identity/epoch/cursor/revision/seq/terminal/visibility 等）只消费不重定义——item `id`/`seq` 为领域内身份，`epoch` 只表示可重建的转发/观察代次，`generation` 为 owner-specific opaque stale guard 且不作跨 owner 数值比较；不引入 `generation`/`terminal` 等词汇伪装条目状态（`identity-and-lifecycle.md` partially applicable）。
- [ ] **1.3 本线私有 helper 清单**：按需实现所属模块共享的外层 helper——owner identity 从调用上下文派生（不得 caller 自报）、判别式结果与 typed unavailable 构造、冻结视图构造、seq/epoch 生成与 stale 判定、listener containment、host 侧脱敏层（受众裁剪 + fail-closed）。helper 保持 facade/领域私有，不成为通用 SDK 或权限引擎；shared helper 只有在两个以上 feature 证明确实共用后才进入 integration wave，本线不各自复制其他线的 identity/terminal/availability helper（契约 §7.2）。
- [ ] **1.4 focused test 脚手架**：建立 `test/attention-*.test.mjs` / `test/client-attention-*.test.mjs` 目录骨架与纯模块直接构造惯例（不依赖共享 mounter/guard、不触碰冻结测试文件）。

- **要求**：本 Wave 只产出基线证据与私有 helper，不改变任何冻结文件；`npm test` 覆盖的测试文件 glob 不变（`node --test "test/**/*.mjs" "packages/*/test/*.mjs"`，temp/ 不参与，走护栏 `systemd-run`）。

### [ ] 2. Wave 2 — Host attention hub（facade B；R1/R2/R3/R4/R7/R8/R9/R10/R13 host 侧；design §Components And Interfaces §2 / §Data Models）

- [ ] **2.1 单一条目 hub 核心**：实现 `lib/attention-hub.js`——条目注册表、单调 `seq`、hub `epoch`、同 owner 同 id 冲突、跨 owner 冲突、dedupeKey 活窗去重、`expiresAt` 到期扫描、容量上界与可观测驱逐（eviction 以 removal reason 呈现）、owner teardown 时以 reason `withdrawn` 批量清理（R1 AC1–AC6、R4 AC3/AC4）。
- [ ] **2.2 contribute 入口与 handle（R1）**：`attention.contribute(spec)` 返回判别式结果；成功含 handle `{id, ownerId, seq, dispose()}`，`ownerId` 由调用方上下文派生；同 owner 同 id 未移除时返回稳定 same-owner 冲突码且不静默替换；跨 owner 同 id 拒绝；spec 畸形/空/超限/非法 scope/audience/level 词表返回 typed invalid-input 且不注册；stale/跨 owner disposer 返回 typed stale/no-op 且不删除当前条目；dispose 幂等（R13 AC1–AC5）。
- [ ] **2.3 内容契约与脱敏包络（R2）**：public item 形状冻结——`id/ownerId/seq/scope 关联({sessionId?}/{workspaceId?}; 仅关联)/level(info|warning|error)/title/有界 body/dedupeKey/expiresAt/audience(固定 client-kind 词表)/actions([{id,label}])/correlation({activityId?, executionId?})/observedAt(hub 指派、不可自报)/有界非 secret meta`。host 侧 redaction 先行：secret/owner-private 值在进入 projection/转发负载/log 前拒绝或剥离；脱敏失败 ⇒ 不产出负载（fail-closed）。无 scope 关联条目为 unscoped、不得归于任何 session durable 记录（R9 AC1–AC3）。
- [ ] **2.4 host projection（R3）**：`current()` 返回调用方可达 scope 的冻结快照；`list({scope?, audience?, cursor?, limit?})` 返回冻结有序页 + cursor 延续；`observe({scope?, audience?})` 返回 `{current(), subscribe(listener), dispose(), epoch}` handle，listener 只收到冻结 add/update/remove（remove 带 reason），异常只降级该 listener；按 audience/scope 授权过滤（未授权条目不只对消费者不可见，且不泄漏存在性，超出有界聚合）；hub degraded/unavailable 时返回 typed 视图不抛。
- [ ] **2.5 dismiss/expiry/cleanup（R4）**：`dismiss(itemId, {by})` 对消费者合法可见条目直接移除（reason `dismissed`，不需生产方同意）；到期移除 reason `expired`；无到期条目保持到 withdrawn/dismissed/evicted；清理可观测且不写任何 durable 记录；owner 上下文结束/reload ⇒ 该 owner 活条目 reason `withdrawn`；reload 后重新 contribute 是新注册；stale disposer 不删除新代次条目。
- [ ] **2.6 action invocation（R7）**：生产方按 action id 注册有界 owner-bound handler（不可被他 owner 替换）；`invoke(itemId, actionId)` 验证条目 live/可见/action 存在后执行 handler 并返回 typed outcome（`invoked|not-found|conflict|unavailable`）；handler 异常收敛并带 owner 归因；action 指向已前进的 session/activity 时返回 stale/conflict；条目 dispose 或 owner 上下文结束后 pending handler 随条目禁用。
- [ ] **2.7 host availability 与 selfDescription（R8 host 侧）**：`attention.availability()` 返回冻结三值覆盖 hub、管线（api-remotes slice）、浏览器 runtime（client-runtime slice）与本地消费路径，永不抛；facade core inactive / capability disabled 按契约 §6 走 P1/P2 typed 错误；单 slice 缺失/错配只降级其覆盖面，host hub 与 host 消费者保持 active。
- [ ] **2.8 非 durable/scope/privacy/边界（R9/R10 host 侧）**：断言无 durable 写入；audit 文档化声明非 durable 性质；session/workspace 关联仅关联、不授予 durable 权威/内容访问/变更能力；model-facing 可见性默认 deny（attention 默认 UI/consumer-only，不泄漏进 model context）；本线不申请浏览器权限、不发声、不强制 UI framework、不提供通用 client state store/scheduler/message bus/任意 remote namespace（R10 AC2/AC3/AC4）。
- [ ] **2.9 activity 事实来源消费（契约 §3.3）**：实现可选的 `sessions.activity` 派生信号适配——consumer 接口只读、缺位时不启用适配并诚实降级；`correlation` 引用未知/不可验证 ⇒ 标记 `unknown`（R2 AC3）；不向 session authority 发送 request/cancel（R10 AC1/AC4）。
- [ ] **2.10 hub→管线内部契约**：在本线 spec 制品钉定 host hub 产出转发消息的 wire 形状与触发语义——`AttentionUpdate { kind: 'attention.snapshot'|'attention.delta', epoch, seq, changes?: [{op:'add'|'remove'|'update', item?, id?, reason?}] }`（frozen+redacted），producer authority = attention hub（host），经 api-remotes slice 转发（设计 §Data Models §2）；catalog 登记 `attention/update`（eventSemantics=observation）列为集成波任务（Wave 8.2），本任务只钉定消息族形状与时序。
- [ ] **2.11 host hub focused tests（R1/R2/R3/R4/R7/R13 host 侧与 R14 AC1）**：覆盖 contribute/同 owner/跨 owner 冲突、invalid-input、dedupeKey、dispose 幂等与 stale disposer 隔离、容量驱逐可观测、expiry/dismiss/withdraw 的 removal reason、owner teardown 隔离、reload 后重新注册为新条目、action live/可见性/handler containment/owner 失效、listener containment、audience/scope 无泄漏、非 durable 断言、availability 三值与 P1/P2 typed 错误、冻结视图不可变。

- **要求**：hub 为纯模块可直接构造测试（DI synthetic ctx）；不触碰 `lib/plugin-api-service.js`/`lib/index.js`/`lib/guards.js`（挂载属集成波）；不复制其他线 helper。

### [ ] 3. Wave 3 — api-remotes R slice（packages/api-remotes；R11；capability-strategy R1–R8）

- [ ] **3.1 契约 probe 门（R11 AC3 钉定）**：只读 probe 官方 `@deepseek-ai/dsh-api-remotes` 与 web profile 行——(a) 官方行 `api-remotes` 存在且无 replacement owner；(b) 逐一提取 `API_REMOTE_FORWARDED_EVENTS` 11 键（`agent-preset/selected`、`commands/change`、`credentials/updated`、`cordis/request-run`、`cordis/request-run-resolved`、`cordis/dynamic-package`、`cordis/dynamic-retract`、`cordis/inspect-query`、`cordis/inspect-query-resolved`、`llm/adapters-updated`、`settings/document-updated`）及其逐字转发语义（wire 名 = host 事件名、payload = 参数列表）；(c) Remote Agent/Session identity BFF 行为（`ApiRemoteSessionNotFound`、subagent ownership 围栏、agent resolver）；(d) receiver/error/disposer 形状与 client manifest 半面（`dsh.client` manifest inject `[dsh-api-gateway]`，R11 §10 证据 row 1）；(e) 钉定 `ctx.remote.$on` 合法键集 = 复刻后的 11 键，`attention/update` 不进入该键集、经替换模块自身复刻的转发路径送达 browser runtime、第三方消费者经 `ctx.pluginApi.attention` 获取（R11 AC3 边界 pin）；(f) 官方 bundle verbatim 内联 + 切片重注册可行性（session-channel-connection 先例）。probe 产出证据记录；**probe 失败 ⇒ 不进入 3.3–3.5 扩展实现**，按 Wave 3.7 fallback 语义降级并上报（绝不虚报能力）。
- [ ] **3.2 包脚手架**：`packages/api-remotes/` 落 `package.json`（version `0.1.0-rc.6-0.1.0`、`dsh.api 0.1`、exports 含 `./client`、scripts 含 `build:client`、peerDependencies 锁定 `@deepseek-ai/dsh-api-remotes: 0.1.0-rc.6` 等 runtime identity）与 `cordis.patch.yml`——`- id: api-remotes; disabled: true` + 单一 insert 替代行（替代行 id/运行时命名中性、随官方行 inject/config 形状）；包/行名 registry 登记留集成波（R11 AC1、R2 整行单位）。
- [ ] **3.3 整行复刻 host 面 + parity fixture（R11 AC2）**：完整复刻官方 `api-remotes` 行 ctx 服务/事件面契约——11 事件白名单逐字转发（无 projection/redaction/renaming，wire 名与 payload 形状逐一复刻）、BFF identity 行为、receiver/error/disposer 形状；parity fixture 逐一对官方实现断言 11 事件键及 per-event 语义（与 `packages/compaction-events/test/official-fork-integrity.test.mjs` 同型的一对一官方源码对照机制）；第三方直接 `import '@deepseek-ai/dsh-api-remotes'` 的 import 面不覆盖（R3，显式声明于包文档与测试）。
- [ ] **3.4 client manifest 半面（R7）**：自建 client bundle（`scripts/build-client.mjs`：官方 `@deepseek-ai/dsh-api-remotes/client` bundle verbatim 内联 + 切片重注册，官方模块 id）；检入 `packages/api-remotes/lib/client.js` 生成物并核对产物 diff；`window.__DSH_BOOT__` 装配与 HMR 验证（R11 AC6）。
- [ ] **3.5 扩展：`attention/update` 转发（R11 AC3）**：在完整复刻之后，把 host hub 产出的 `AttentionUpdate`（frozen、redacted、带 item id/seq/epoch）纳入本行转发集——仅对本行新增的注意力消息生效，不改动官方白名单语义；单列扩展 fixture 断言（不参与官方 11 键 parity 断言）；`$on` 合法键集保持复刻后的 11 键（probe pin 的边界固定为测试断言）。送达路径：经替换模块自身复刻的 host→browser 管线送达 client-runtime slice，第三方消费者经 `ctx.pluginApi.attention` 获取。
- [ ] **3.6 boot 自检 + fail-safe + 版本锁 + owner 冲突（R4/R5/R6）**：apply 内断言官方行 `api-remotes` disabled、替代行唯一 active、runtime/包 `A.B.C` 一致、关键契约可用、无组件 owner 冲突、无双跑；版本错配/自检失败/parity 失败 ⇒ 记录有界日志 + 重跑官方 apply（官方转发行为照常，不启用扩展）+ attention 路由不宣称（client delivery typed `unavailable`，host hub 不受影响）；绝不留下官方行 disabled 而无工作替代（R11 AC5）。
- [ ] **3.7 headless 缺席（R11 AC10）**：headless profile 无 `api-remotes` 行 ⇒ 不插入任何替代行、client 投递路径按 Requirement 8 AC3 报 typed `unavailable`。
- [ ] **3.8 U-series 与退役条件制品（R11 AC8/AC9）**：在本线 spec 制品登记 U-series 上游提案（官方提供白名单之外等价 typed publication seam）与退役条件（官方 seam 可用 ⇒ slice 迁移回官方绑定并进入 deprecation/退役）；feature-list §3.1 registry 登记留集成波（Wave 8.2）。
- [ ] **3.9 slice focused tests（R14 AC2 上半）**：parity fixture（11 键逐字转发/BFF/错误与 disposer 形状，一对一官方对照）、`attention/update` 扩展键单列断言、`$on` 键集不扩大断言、版本错配局部停用、boot 自检矩阵、owner 冲突、无双跑、模块 id 注册、`window.__DSH_BOOT__`/HMR、移除恢复官方行、headless 缺席、官方包零修改与 apply 不抛穿。

- **要求**：只写 `packages/api-remotes/**` 与 `docs/specs/client-attention-contribution/**`；row id/包名 registry 登记留集成波；client bundle 生成物经 `scripts/build-client.mjs` 重建并核对 diff。

### [ ] 4. Wave 4 — client-runtime R slice（packages/client-runtime；R12；capability-strategy R1–R8）

- [ ] **4.1 契约 probe 门（R12 AC2 钉定）**：只读 probe 官方 `@deepseek-ai/dsh-client-runtime` 与 web profile 行——(a) 官方行 `client-runtime` 存在且无 owner；(b) 浏览器模块契约可复刻：`slots`（含 `slots/changed`）、`conversationEvents`、`conversationViews`、`connection/reset`、sessions/workspaces reflect outward face；(c) client manifest inject `[dsh-client-connection, dsh-typert-registry, dsh-api-remotes]` 与装配语义（R12 §10 证据 row 1/5/6）；(d) connection/reset 与模块 HMR 语义（browser-side state/reconnect，被复刻契约）；probe 产出证据记录；**probe 失败 ⇒ 不进入 4.3–4.5 扩展实现**，按 Wave 4.6 fallback 语义降级并上报。
- [ ] **4.2 包脚手架**：`packages/client-runtime/` 落 `package.json`（version `0.1.0-rc.6-0.1.0`、`dsh.api 0.1`、exports 含 `./client`、scripts 含 `build:client`、peerDependencies 锁定 `@deepseek-ai/dsh-client-runtime: 0.1.0-rc.6` 等）与 `cordis.patch.yml`——`- id: client-runtime; disabled: true` + 单一 insert 替代行（替代行 id/运行时命名中性、随官方行 inject 形状）；包/行名 registry 登记留集成波（R12 AC1）。
- [ ] **4.3 整行复刻 browser 模块契约 + parity fixture（R12 AC2）**：完整复刻官方 `client-runtime` 行 browser 服务/事件面——`slots`（register/inject/entries/subscribe + `slots/changed` 语义）、`conversationEvents`、`conversationViews`、`connection/reset`、`sessions`/`workspaces` reflect outward face 与 `dsh.client` manifest 半面；parity fixture 对官方实现一对一断言；官方 import 面（`@deepseek-ai/dsh-client-runtime`）不覆盖（R3）。
- [ ] **4.4 client manifest 半面（R7）**：自建 client bundle（`scripts/build-client.mjs`：官方 `@deepseek-ai/dsh-client-runtime/client` verbatim 内联 + 切片重注册，官方模块 id）；检入 `packages/client-runtime/lib/client.js` 生成物并核对产物 diff；`window.__DSH_BOOT__` 与 HMR 验证（R12 AC6）。
- [ ] **4.5 扩展：浏览器 attention runtime（R12 AC3；内部契约，非公共 API）**：订阅经管线送达的 `AttentionUpdate`；按 item id/seq 对账/去重（R6 AC5 无双渲染）；`connection/reset`/HMR 时以新 epoch 重建并从 host 重取 snapshot（不把旧 epoch 活条目当 current，R6 AC1）；把 frozen/redacted 视图暴露给主包 client 面（内部 runtime 契约，钉定于本线 spec 制品供 Wave 5.1 与集成波接线）；slots 呈现集成（consumer 选择使用，R12 AC3）；client→host 请求（`contribute`/`dismiss`/`invoke`）经已交付 session-channel 的 client→host 请求往返面转发（类型化传输；本 feature 只消费、不替换；不排队，R5 AC4）；具体通道入口与 wire revision 集成波固定（design §4/§5、R5 AC2 决策表呼应）。
- [ ] **4.6 boot 自检 + fail-safe + 版本锁 + owner 冲突（R4/R5/R6）**：apply 内断言官方行 `client-runtime` disabled、替代行唯一 active、runtime/包 `A.B.C` 一致、关键契约可用、无组件 owner 冲突、无双跑；失败 ⇒ 运行时不宣称 + 重跑官方 apply（slots/conversation/reflect 官方行为照常）+ client face typed `unavailable`；绝不留官方行 disabled 而无工作替代（R12 AC5）。
- [ ] **4.7 headless 缺席（Requirement 8 AC3）**：headless profile 无 `client-runtime` 行 ⇒ 不插入替代行、client 面 typed `unavailable`（如实报告）。
- [ ] **4.8 U-series 与退役条件制品（R12 AC8/AC9）**：本线 spec 制品登记 U-series 上游提案（官方原生 attention/reconnect seam）与退役条件；feature-list §3.1 registry 登记留集成波（Wave 8.2）。
- [ ] **4.9 slice focused tests（R14 AC2 下半）**：slots/conversation/reflect 官方契约 parity、`slots/changed`/`connection/reset` 语义、版本错配、boot 自检、owner 冲突、无双跑、模块 id 注册、HMR、移除恢复官方行、headless 缺席、官方包零修改与 apply 不抛穿。

- **要求**：只写 `packages/client-runtime/**` 与 `docs/specs/client-attention-contribution/**`；row id/包名 registry 登记留集成波；client bundle 生成物经 `scripts/build-client.mjs` 重建并核对 diff。

### [ ] 5. Wave 5 — 主包 client 面与 rebind/HMR 组合（R5/R6/R8/R13；design §Components §1/§5）

- [ ] **5.1 主包 client 面 leaf 纯模块**：`lib/client-attention-*.js` 实现 `ctx.pluginApi.attention.{current,list,observe,observe.handle,contribute,dismiss,invoke,availability}`——与 host 投影同形冻结语义（frozen、typed、audience 覆盖该 client）、消费 client-runtime slice 暴露的内部 runtime 契约（定向窗 4.5 钉定的契约）；contribute/dismiss/invoke 经 client→host 请求通道转发到 host hub（owner 由 client 调用方上下文派生），host hub 仍是单一条目 authority；客户端只做对账单形状校验，不接收 secret/owner-private/diagnostic 材料、不可注入 host 可见字段（R5 AC1/AC2/AC3/AC5）。
- [ ] **5.2 rebind/HMR/epoch/generation containment（R6）**：`connection/reset`/HMR 后浏览器 runtime 以新 epoch 从 host snapshot 重建（R6 AC1）；host epoch 变更/owner generation 变 stale ⇒ 旧 client 面/disposer/callback 失去提交资格（不得写新 hub 状态、不得移除新代次条目、不作为 current 事件投递，R6 AC2）；stale 代次请求到 host 返回 typed stale/conflict 且不应用（R6 AC3）；模块 HMR 重载后 client 面在官方连接生命周期内自我重建，消费者不需要 `$mount` 胶水（R6 AC4）；重复/乱序投递按 item id/seq 去重不双渲染（R6 AC5）。
- [ ] **5.3 client 可用性（R5/R8 下半）**：pipeline/连接/hub 不可用 ⇒ client 调用 typed `unavailable`（不排队、不隐形重试）；client projection 如实报告自身 availability（frozen 三值 + reason）；headless 无 client 行 ⇒ client 面 typed `unavailable`；无 client consumer 的 profile ⇒ host hub 保持 active，client 投递路径报 degraded/unavailable，host 侧消费者继续被服务（R5 AC4/AC6）。
- [ ] **5.4 组合与消费者安全（R13）**：两个合成插件（host 与 client 两面）以反序注册/加载覆盖同 owner/cross-owner 冲突、dedupe、expiry/dismiss/withdraw、容量驱逐、callback containment、stale disposer 隔离、scope 隔离——各插件收到同一 hub 有序视图语义，不观察彼此私有 state/handler；invalid-input 不破坏其他注册；owner-bound cleanup 身份制；对外视图冻结不可变（R13 AC1–AC5、R14 AC1）。
- [ ] **5.5 client 面 focused tests + bundle shape**：`test/client-attention-*.test.mjs` 覆盖 5.1–5.4；client 面对外形状与 host 同形断言；rebind/HMR fixture（connection reset、host epoch change、stale 代次写入拒绝、id/seq 去重、snapshot 对账、重载后免 `$mount` 出现）。

- **要求**：本 Wave 只产出纯模块与其 focused tests；主包 client bundle entry（`lib/client-runtime.js`）的挂载与 `lib/client.js` 重建属集成波（Wave 8.5），本线不触碰。

### [ ] 6. Wave 6 — 隐私、边界与负向机械断言（R2 AC2/R9/R10/R14 AC4/AC5）

- [ ] **6.1 脱敏机械断言（R14 AC4）**：host projection、转发负载与日志出口机械断言无 secret/owner-private 材料；client 侧形状-only 校验断言（client 收到已是脱敏后载荷，未收到 secret/owner-private/diagnostic 材料；不可注入 host 可见字段）。
- [ ] **6.2 非 durable 断言（R14 AC5）**：fixture 证明任何 attention 条目从不进入 session durable history 或任何 scope-backed durable 记录；无 durable 写入路径存在。
- [ ] **6.3 R10 负向断言**：不申请浏览器权限、不发声、不强制具体 UI framework 行为；不向 session authority 发送 request/cancel 信号；`session-interaction-operation` 不通过本 hub 隐式发布 UI notification；本 feature 不提供通用 client state store/scheduler/message bus/任意 remote namespace。
- [ ] **6.4 模型可见性默认 deny（R9 AC4）**：注意默认 UI/consumer-only，model-facing 消费需要显式可见性决策；默认不泄漏进 model context。
- [ ] **6.5 容量驱逐可观测（R1 AC6/R4 AC3）**：容量耗尽时驱逐最旧可移除条目或以 typed capacity outcome 呈现当无条目可移除；每次驱逐以 removal reason 可观测。

- **要求**：机械断言优先用纯函数/字符串扫描断言，避免失控失败断言累积大量 diff（守卫内存护栏 §6）。

### [ ] 7. Wave 7 — R slice 装配、失败回退与回归（R11/R12/R14 AC2；capability-strategy 适用条款）

- [ ] **7.1 版本错配局部停用**：runtime/包 `A.B.C` 错配 ⇒ 只停用对应 slice 覆盖能力（pipeline slice 失配 ⇒ host→client 投递 `unavailable`；runtime slice 失配 ⇒ client 面 `unavailable`），host hub 与 host 消费者保持 active，availability 明确命名具体原因（R8 AC3）。
- [ ] **7.2 失败回退与无双跑**：probe/parity/boot 自检失败 ⇒ 重跑官方 apply（官方行为照常）、扩展不宣称、能力 typed `unavailable`；断言「官方行 disabled 且无工作替代」空洞不存在；无双跑（R11 AC5、R12 AC5）。
- [ ] **7.3 owner 冲突与重复插入检测**：组件唯一 owner 冲突、目标行未禁用、重复插入均被检测并 fail-safe（R6）。
- [ ] **7.4 模块 id 注册 / `__DSH_BOOT__` / HMR**：两 slice 的 client 半面以官方模块 id 注册、`window.__DSH_BOOT__` 装配、HMR 后替换模块恢复（R7/R11 AC6/R12 AC6）。
- [ ] **7.5 移除与官方行恢复**：移除替代行后官方行恢复且官方行为完整（patch 撤销路径）。
- [ ] **7.6 headless 缺席回归**：headless profile 下两 slice 均不插入替代行、对应能力 typed `unavailable`。
- [ ] **7.7 官方包零修改审计（slice 级）**：两 slice 各自断言未 touch 官方包文件（生成物重建读官方 bundle 为只读、比对官方包 mtime/hash 或 git 隔离基线）。

- **要求**：Wave 7 全为回归/负向测试，不改功能面；与 Wave 3/4 的正向 parity 形成闭环。

### [ ] 8. Wave 8 — 集成波归属任务（由集成代理执行；本线列出要求与验收，不自行执行）

> 以下任务在 M9 集成波统一执行（契约 §7.1 owner 表与 §8 合并顺序第 6 步）。本线只定义要求与验收，Standalone Stage 4 交付不执行；执行前须以本线两 R slice 包与主包 client-attention 纯模块为已就绪输入。

- [ ] **8.1 主包 host 挂载**：`lib/plugin-api-service.js` 按预定 append slot、`lib/index.js`/`lib/guards.js` 追加 mounter，把 host `attention` 面（Wave 2 hub）接入门面并贯穿 disabled 面；挂载后 host focused tests 全绿（验收：R1–R4/R7/R8 host 面经真门面可达，统一挂载顺序断言由集成 owner 维护）。
- [ ] **8.2 registry/shape 机械合并与 catalog 登记**：host/client `attention` namespace 与成员行、capability `attention`、`attention/update` catalog 条目（eventSemantics=observation；producer authority = attention hub（host）；经 api-remotes slice 转发，独立 slice 登记、不改冻结 `lib/events-catalog.js`）、两个新包/行 registry entries 机械一致（验收：Requirement 14 AC6，registry 校验器/快照全绿，surface 快照一致）。
- [ ] **8.3 feature-list 与 R 登记**：feature-list §7 本行更新为 delivered 状态；§3.1 跨组件 R 登记两 slice（api-remotes + client-runtime，各自 U-series 提案与退役条件取自 Wave 3.8/4.8 制品）（验收：登记与制品一致，feature-list 状态同步 AGENTS.md §8 指针）。
- [ ] **8.4 full 聚合装配**：`packages/full/` 增加两新包依赖与确定顺序 patch 块；full 安装与「main + 显式选择辅助包」装配同一组主包行/替代行与同一行为，无双跑、无替代行语义改变（验收：装配等价测试绿，R14 相关验收；选择性安装缺 slice 只降级对应能力）。
- [ ] **8.5 主包 client bundle 接线**：`lib/client-runtime.js` client bundle entry 挂载 attention leaf（`lib/client-attention-*.js`）并加入 mounter/capability 路径，`npm run build:client` 重建 `lib/client.js` 并核对产物 diff 仅含预期变更（禁止手工编辑生成物）；主包 client manifest inject 列表不变（`[dsh-client-connection, dsh-client-runtime, dsh-api-remotes, dsh-client-ui-settings]`）；client 面在替换模块 ctx 中运行并消费新 runtime，HMR 后免 `$mount` 重建（验收：client bundle shape 测试、R5/R6 client fixture 在真装配全绿）。
- [ ] **8.6 与 activity projection 事实来源跨线装配验证**：与 `session-activity-projection` 线装配验证 correlation 词表对齐；事实源未装配时 hub 诚实降级（correlation `unknown`）、不成为活动权威（验收：交叉 fixture，两线各自 focused tests 全绿）。
- [ ] **8.7 11 事件白名单转发端到端验证**：在真实装配（full profile，host 两替换行 active）中验证 11 个官方白名单事件经复刻管线逐字转发 + `attention/update` 扩展投递到浏览器 runtime + 第三方消费者经 `ctx.pluginApi.attention` 而非 `$on` 获取（验收：端到端 fixture；官方 parity 与扩展边界不回归）。
- [ ] **8.8 wire revision 与文档同步**：attention 转发消息族（`AttentionUpdate`/`AttentionRequest`/`AttentionOutcome`）wire revision 登记；README/公共契约现状注/AGENTS.md 需要的同步项更新（验收：`versioning-and-protocols.md` 适用条款对齐，文档与 registry 一致）。

- **要求**：集成波任务由集成代理执行；本线交付物（hub 纯模块、client-attention 纯模块、两 R slice 包、内部契约制品）是 8.1/8.4/8.5 的输入；集成波不得改写本线已交付的验收边界。

### [ ] 9. Wave 9 — 终验、登记与交付（R14 AC7；AGENTS.md §3.2/§6/§8）

- [ ] **9.1 套件全绿**：受护 `npm test` 全绿（护栏脚本，`systemd-run --user --scope -p MemoryMax=4G`，不用裸 `node --test`；覆盖 `test/**/*.mjs` 与 `packages/*/test/*.mjs`）；`git diff --check` 通过；官方包零修改审计（`/usr/lib/node_modules/@deepseek-ai/dsh/**`）通过；registry/surface 一致性（集成后）通过。任一验证失败/超时/无法建立证据按阻塞处理，阻塞登记含解除动作。
- [ ] **9.2 规格制品回写与登记**：核对 requirements/design/tasks 与交付一致；执行中发现的 spec 细节偏差就地修订对应文档并在最终报告列出；动摇 Goal/Requirements 验收边界的偏差按「条件性人类裁决门」上报。已知待确认项：probe 结论（3.1/4.1）与 design §3/§4 复刻清单的符合性就地记录。
- [ ] **9.3 全局终审（阻塞，编排主代理执行）**：全部顶层任务完成后，由编排主代理调用一次只读阻塞式全局终审，核对整个 Stage 4 交付与 Tasks/Design/Requirements 的一致性，并按 `docs/standards/` 适用分册（capability-strategy/api-shape/api-idioms/public-api-shape/composition-and-authority/domain-composition/ordering/durable-state-and-scope/visibility-and-redaction/concurrency-and-cancellation/versioning-and-protocols；identity-and-lifecycle 为 partially applicable）比对规范符合性；返回「无偏差」后才可交付；有意见则在整体范围内集中修订后再次全局终审，直至通过。
- [ ] **9.4 Stage 4 完成提交**：终审通过后提交本 Stage 全部实现、测试、spec 制品修订与登记（先 `git diff --check`，提交只含本线文件，工作区保持干净）。

- **要求**：交付物「套件全绿 + `git diff --check` + 终审无偏差 + 完成提交 + 工作区干净」齐备才可宣告 Stage 4 完成。

---

## 任务间依赖与顺序注记

1. Wave 1 → 2 → 3/4 可并行（host hub 与两 slice 契约由本线内部契约制品钉定后解耦）→ 5（依赖 4.5 runtime 契约）→ 6/7（依赖 2/3/4/5 交付）→ 8（集成波）→ 9。
2. Wave 3/4 各自 probe 门（3.1/4.1）与其扩展实现（3.5/4.5）串行；probe 失败时该 slice 停在官方复刻 + fallback 语义，不进入扩展，并在交付报告与 9.2 记录。
3. Wave 5 的 client 面 leaf 依赖 4.5 钉定的内部 runtime 契约；两者以本线 spec 制品（内部契约文档）为对齐点，可在契约钉定后并行推进。
4. 本线并行期不触碰冻结文件与集成波文件（「文件边界」）；集成波任务以本线交付物为输入。