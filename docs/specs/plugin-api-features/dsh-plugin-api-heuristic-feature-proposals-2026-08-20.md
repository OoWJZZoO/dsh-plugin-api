# dsh-plugin-api 启发式新 Feature 提案

日期：2026-08-20
范围：公开 DSH 插件源码、插件生态仓库与本地 `temp/research/` 快照。
目的：从真实插件反复实现的 workaround、状态机和失败处理里反推 `dsh-plugin-api` 尚未覆盖的公共能力。

本报告最初只做调研和候选提出，不创建正式 spec，不进入 Stage 0，不实现任何 feature。
2026-08-24 起，经用户明确指示，候选自候选池陆续立项并进入 SPEC1 Stage 0。截至 2026-08-26，共 **17 个候选正式立项**：第一/二批八项（`execution-observation`、`plugin-diagnostics`、`usage-budget-telemetry`、`mcp-catalog-lifecycle`、`model-route-policy`、`attachment-pipeline`、`recovery-policy`、`client-generation-rebind`）已全部完成 Stage 4 交付；第三批三项（`coordination-lease`、`workspace-mutation-transaction`、`task-execution-observation`）已全部完成 Stage 4 交付（SPEC3 全程）；第四批三项（`security-policy-egress-guard`、`progressive-tool-discovery`、`session-branch-sidechain-edit`）已完成 Stage 4 交付；第五批次一项（`plugin-profile-management`）已完成 Stage 4 交付；第六批次两项（`skill-discovery-activation`、`context-provenance`）已进入 SPEC1 Stage 0，当前等待批量 Goal 确认门。`memory-interoperability` 经评审明确排除立项（功能组件而非门面：单插件即可用已交付 API 完整实现记忆，跨插件共享记忆缺少已证实需求），已撤出候选池，详见 §10。本报告继续只承担候选溯源与状态登记，不承载 Requirements、Design 或 Tasks；已交付状态的权威登记以 `feature-list.md` §7 为准。

## 当前立项状态

| Feature | 状态 | 当前阶段 | Spec 制品 |
|---|---|---|---|
| `execution-observation` | 已交付（B 类） | SPEC3 Stage 4：交付完成（M6 第一批 Wave C） | `docs/specs/execution-observation/goal.md`；`docs/specs/execution-observation/requirements.md`；`docs/specs/execution-observation/design.md`；`docs/specs/execution-observation/tasks.md` |
| `plugin-diagnostics` | 已交付（B 类） | SPEC3 Stage 4：交付完成（M6 第一批 Wave C） | `docs/specs/plugin-diagnostics/goal.md`；`docs/specs/plugin-diagnostics/requirements.md`；`docs/specs/plugin-diagnostics/design.md`；`docs/specs/plugin-diagnostics/tasks.md` |
| `usage-budget-telemetry` | 已移除（2026-08-26 按用户 ANY 指示经 `chore/usage-api-removal` 移除，commit `856746f`；见 §6 执行记录） | SPEC3 Stage 4：交付完成（M6 第一批 Wave C）；2026-08-26 复审：登记待弃用（功能组件非门面，见 §6 复审结论）；同日按用户指示执行移除（见 §6 执行记录） | `docs/specs/usage-budget-telemetry/goal.md`；`docs/specs/usage-budget-telemetry/requirements.md`；`docs/specs/usage-budget-telemetry/design.md`；`docs/specs/usage-budget-telemetry/tasks.md` |
| `mcp-catalog-lifecycle` | 已交付（R 类；运行时名 `@deepseek-ai/dsh-plugin-api-mcp`） | SPEC3 Stage 4：交付完成（M6 第一批 Wave C） | `docs/specs/mcp-catalog-lifecycle/goal.md`；`docs/specs/mcp-catalog-lifecycle/requirements.md`；`docs/specs/mcp-catalog-lifecycle/design.md`；`docs/specs/mcp-catalog-lifecycle/tasks.md` |
| `model-route-policy` | 已交付（R 类；运行时名 `@deepseek-ai/dsh-plugin-api-agent-loop`；owner `@deepseek-ai/dsh-agent-loop`） | SPEC3 Stage 4：交付完成（M6 第二批） | `docs/specs/model-route-policy/goal.md`；`docs/specs/model-route-policy/requirements.md`；`docs/specs/model-route-policy/design.md`；`docs/specs/model-route-policy/tasks.md` |
| `attachment-pipeline` | 已交付（R 类；运行时名 `@deepseek-ai/dsh-plugin-api-attachments`；owner `@deepseek-ai/dsh-attachment-local`） | SPEC3 Stage 4：交付完成（M6 第二批 Wave A） | `docs/specs/attachment-pipeline/goal.md`；`docs/specs/attachment-pipeline/requirements.md`；`docs/specs/attachment-pipeline/design.md`；`docs/specs/attachment-pipeline/tasks.md` |
| `recovery-policy` | 已交付（B/C policy-first） | SPEC3 Stage 4：交付完成（M6 第二批） | `docs/specs/recovery-policy/goal.md`；`docs/specs/recovery-policy/requirements.md`；`docs/specs/recovery-policy/design.md`；`docs/specs/recovery-policy/tasks.md` |
| `client-generation-rebind` | 已交付（B 类） | SPEC3 Stage 4：交付完成（M6 第二批 Wave A） | `docs/specs/client-generation-rebind/goal.md`；`docs/specs/client-generation-rebind/requirements.md`；`docs/specs/client-generation-rebind/design.md`；`docs/specs/client-generation-rebind/tasks.md` |
| `coordination-lease` | 已交付（B 类） | SPEC3 Stage 4：交付完成（M6 第三批次） | `docs/specs/coordination-lease/goal.md`；`docs/specs/coordination-lease/requirements.md`；`docs/specs/coordination-lease/design.md`；`docs/specs/coordination-lease/tasks.md` |
| `workspace-mutation-transaction` | 已交付（B 类） | SPEC3 Stage 4：交付完成（M6 第三批次） | `docs/specs/workspace-mutation-transaction/goal.md`；`docs/specs/workspace-mutation-transaction/requirements.md`；`docs/specs/workspace-mutation-transaction/design.md`；`docs/specs/workspace-mutation-transaction/tasks.md` |
| `task-execution-observation` | 已交付（B 类） | SPEC3 Stage 4：交付完成（M6 第三批次） | `docs/specs/task-execution-observation/goal.md`；`docs/specs/task-execution-observation/requirements.md`；`docs/specs/task-execution-observation/design.md`；`docs/specs/task-execution-observation/tasks.md` |
| `security-policy-egress-guard` | 已交付（B 类） | SPEC3 Stage 4：交付完成（M6 第四批次 Wave A Stage 4；批次集成 sync 后合入） | `docs/specs/security-policy-egress-guard/goal.md`；`docs/specs/security-policy-egress-guard/requirements.md`；`docs/specs/security-policy-egress-guard/design.md`；`docs/specs/security-policy-egress-guard/tasks.md` |
| `progressive-tool-discovery` | 已交付（B 类） | SPEC3 Stage 4：交付完成（M6 第四批次 Wave A Stage 4；批次集成 sync 后合入） | `docs/specs/progressive-tool-discovery/goal.md`；`docs/specs/progressive-tool-discovery/requirements.md`；`docs/specs/progressive-tool-discovery/design.md`；`docs/specs/progressive-tool-discovery/tasks.md` |
| `session-branch-sidechain-edit` | 已交付（R 类；owner `@deepseek-ai/dsh-session`，运行时名 `@deepseek-ai/dsh-plugin-api-session-branch`） | SPEC3 Stage 4：交付完成（M6 第四批次 Wave B；批次集成 sync 后合入） | `docs/specs/session-branch-sidechain-edit/goal.md`；`docs/specs/session-branch-sidechain-edit/requirements.md`；`docs/specs/session-branch-sidechain-edit/design.md`；`docs/specs/session-branch-sidechain-edit/tasks.md` |
| `plugin-profile-management` | 已交付（双面：投影 + 进程外执行器遥控写入） | SPEC3 Stage 4：交付完成（M6 第五批次） | `docs/specs/plugin-profile-management/goal.md`；`docs/specs/plugin-profile-management/requirements.md`；`docs/specs/plugin-profile-management/design.md`；`docs/specs/plugin-profile-management/tasks.md` |
| `memory-interoperability` | 已明确排除立项（功能组件非门面；由具体 memory 插件基于已交付 API 自行实现） | 不进入 Stage 0 | —（候选分析留档于本文件 §10） |
| `skill-discovery-activation` | 已立项，待确认（R 类；owner `@deepseek-ai/dsh-tool-skill`，运行时名 `plugin-api-tool-skill`；2026-08-26 用户指示由 B 类改 R 类） | SPEC1 Stage 2 重构：Goal/Requirements/Design 已产出，待批量确认门（M6 第六批次 Wave A；Stage 0–1 已获批 2026-08-26） | `docs/specs/skill-discovery-activation/goal.md`；`docs/specs/skill-discovery-activation/requirements.md`；`docs/specs/skill-discovery-activation/design.md` |
| `context-provenance` | 已立项，待确认（B 类门面 + `sent` 证据 R 切片于 `plugin-api-agent-loop`，owner `@deepseek-ai/dsh-agent-loop`；2026-08-26 用户指示） | SPEC1 Stage 2 重构：Goal/Requirements/Design 已产出，待批量确认门（M6 第六批次 Wave B；Stage 0–1 已获批 2026-08-26） | `docs/specs/context-provenance/goal.md`；`docs/specs/context-provenance/requirements.md`；`docs/specs/context-provenance/design.md` |

其余 2 个候选（`remote-session-channel`、`adapter-decoration`）仍处于候选池，未进入 Stage 0；`memory-interoperability` 已于 2026-08-26 撤出候选池并明确排除立项。

## 结论先行

当前最值得进入下一轮候选池的不是一个 feature，而是五个互相支撑的能力面：

1. **统一执行生命周期与因果观察**：把 agent、tool、LLM、session、workflow、job 的碎片事件关联成可恢复的 execution/span。
2. **MCP catalog 与动态工具生命周期**：解决工具分页、异步连接、generation 替换、`list_changed`、断线重连和工具搜索；这是明确适合 R 类的官方 loader 边界。
3. **模型健康与路由策略**：把 fallback、circuit breaker、probe 和失败分类收敛到官方 route 决策边界；同样可以正式考虑替换 `dsh-agent`/`dsh-agent-loop` loader 行。
4. **附件/多模态输入管线**：从 image-only admission 扩展到 attachment identity、转换、投影、缓存、来源和清理；若官方附件 loader 是唯一语义 owner，R 类是合理的主方案。
5. **诊断、预算和恢复基础设施**：让插件能报告自己为何 inactive、一个 execution 花了什么、失败后能否重试以及恢复到哪个 checkpoint。

这五项之外，仍有十五个有独立价值的候选。它们不应因为当前需要底层模拟或 replacement bundle 就提前排除。判断依据应是：

- 是否存在真实生态痛点和重复 workaround；
- 是否有清晰的公共语义边界；
- 是否能定义 identity、generation、disposer、durable provenance 和 fail-safe；
- 若缺口天然属于一个官方 loader 行，是否应直接采用 R 类，而不是在门面里长期复制官方内部逻辑。

## 调研方法与证据

调研通过 Tavily HTTP MCP 搜索公开仓库和文档，并将相关仓库 clone 到 `temp/research/` 阅读源码。未调用 Tavily 云端 research/agent，只使用搜索结果和公开仓库内容。源码快照的 origin 与当前 commit 可用下面命令复核：

```sh
for d in temp/research/*; do
  test -d "$d/.git" || continue
  printf '%s\t' "$(basename "$d")"
  git -C "$d" remote get-url origin
  git -C "$d" rev-parse --short HEAD
done
```

重点来源：

| 来源 | 观察到的机制 |
|---|---|
| [dsh-notification](https://github.com/omdsh-dev/dsh-notification) | turn baseline、单调序列、reconnect 去重、session projection |
| [dsh-session-notification](https://github.com/dingyi222666/dsh-session-notification) | running 边沿、pending interaction、tail settle、重连后的状态重建 |
| [dsh-auto-continue](https://github.com/HsiangNianian/dsh-auto-continue) | 失败分类、cooldown/backoff、reconnect scan、loop guard、工具重复检测 |
| [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | team/task/member identity、attempt capability、handoff、reassign、持久化恢复 |
| [dsh-task-relay](https://github.com/LeslieWylie/dsh-task-relay) | 跨 session 任务队列、handoff 摘要、原子 JSON store |
| [dsh-file-claim](https://github.com/Nwflower/dsh-file-claim) | heartbeat、stale takeover、跨进程锁、pending merge |
| [dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) | Change Ledger、preview、stale plan、rescue point、restore verify、session fork |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | session/workspace/config 三态 checkpoint、配额和保留策略 |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | context fold、surface/archive/provenance、bounded state、token pressure |
| [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) | `llm/stream` usage 捕获、daily/session/provider-model ledger、价格和预算 |
| [dsh-plugins](https://github.com/DamonKoy/dsh-plugins) | MCP v2、secret redaction、approval policy、memory、system proxy、usage/cost |
| [dsh-model-failover](https://github.com/Letter2025/dsh-model-failover) | model/provider circuit breaker、fallback、probe、请求错误分类 |
| [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | task board、remote channel、plugin manager、profile mutation、atomic update |
| [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | skill 激活、progressive exposure、image limits、cache、deadline、runtime generation |
| [dsh-tianshu-tui](https://github.com/huiliyi37/dsh-tianshu-tui) | session fork/rewind、skills browser、memory、cost、doctor/status、TUI reconnect |
| [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | terminal reconnect/replay、后台任务、session-isolated layout、插件工作台 |
| [dsh-open-in-vscode](https://github.com/omdsh-dev/dsh-open-in-vscode) | 原生 slot + compatibility adapter、Typert Remote、client/host 降级 |

本地证据位于 `/home/wanwe/global_workspace/agent/dsh-plugin-api/temp/research/`；上一轮市场观察底稿见 [dsh-plugin-api-market-research-2026-08-18.md](./dsh-plugin-api-market-research-2026-08-18.md)。

## 已有能力和去重边界

本仓库当前已经覆盖：

- 稳定事件总线和 47 条事件目录；
- `llm` 的 modelInfo、adapter、stream、同步 request transform、image admission；
- agent/session/tools/systemPrompt/settings 的主要事件和直通面；
- execution route 查询、session durable observation、受限 durable append；
- 19 个早期服务 seam，以及 M4 已登记的 `jobs`、`shellEnv` 等服务；
- client manifest、slot、remote contribution、settings remote/codec；
- compaction service seam、session-title replacement bundle 等既有 R 类能力。

因此，下文提出的候选不会把已有的 raw event、route query、session append、tokenMeter、skills registry、attachments storage 或普通 remote publish 重新包装成同名 feature。新增部分主要是**跨事件的语义组合、生命周期管理、策略注册、持久化 provenance 或官方 loader 行替换**。

## 候选总览

评分含义：价值是对第三方插件生态的潜在收益；证据强度表示公开源码中是否已经出现多次或高质量的同类 workaround；风险是 API 语义、跨版本和恢复正确性的综合风险。分数不是排除门槛。

| # | 候选 feature | 直接痛点 | 首选通道 | 价值 | 证据 | 风险 | 建议 |
|---:|---|---|---|---:|---:|---:|---|
| 1 | 统一执行生命周期观察 | 事件碎片无法关联为一次真实执行 | B + C 边界 | 5 | 5 | 4 | 第一梯队 |
| 2 | Durable coordination / lease | 多 agent、文件和任务没有共同 ownership 语义 | B | 5 | 5 | 4 | 第一梯队 |
| 3 | Client generation / rebind | client 服务晚绑定、重连、旧 UI 写回污染新状态 | B，必要时 R | 5 | 4 | 4 | 第一梯队 |
| 4 | Recovery / retry / checkpoint policy | 每个插件重复分类错误、退避和恢复 | B | 5 | 5 | 5 | 第一梯队 |
| 5 | Context composition / provenance | prompt 注入、压缩和 surface 变更无法解释来源 | B/C | 5 | 4 | 5 | 第一梯队 |
| 6 | Usage / cost / budget telemetry | usage 只在各插件私自计算，预算不能成为策略输入 | B | 5 | 5 | 3 | 第一梯队；已交付后 2026-08-26 登记待弃用 |
| 7 | MCP catalog / dynamic lifecycle | tools/list、连接和工具 generation 不稳定 | R 优先 | 5 | 5 | 4 | 第一梯队，正式 R 候选 |
| 8 | Progressive tool discovery | 工具集过大，模型不知道何时暴露哪个工具 | B，必要时 R | 5 | 4 | 4 | 第一梯队 |
| 9 | Security policy / egress guard | approval、redaction、子进程出站策略互相割裂 | B，横切不 R | 5 | 5 | 5 | 第一梯队 |
| 10 | Memory interoperability | memory 只是一组私有工具，无法共享 scope/provenance | B | 4 | 4 | 4 | 已排除立项（2026-08-26） |
| 11 | Session branch / sidechain / edit | fork、rewind、side question 没有统一 branch identity | R 优先 | 5 | 5 | 5 | 第一梯队，正式 R 候选 |
| 12 | Plugin health / diagnostics | feature 失败只能看日志，用户不知道为何 inactive | B | 5 | 5 | 2 | 第一梯队 |
| 13 | Model health / failover / route policy | 路由策略被每个插件私自 prepend | R 优先 | 5 | 5 | 5 | 第一梯队，正式 R 候选 |
| 14 | Remote session / channel bridge | mobile/remote 连接没有统一 resume、ack、权限语义 | R 优先 | 4 | 4 | 5 | 第二梯队，正式 R 候选 |
| 15 | Task/workflow execution observation | task board、workflow、job、session identity 不一致 | B | 5 | 5 | 4 | 第一梯队 |
| 16 | Skill discovery / activation | skill 注册和工具暴露没有 per-agent/per-turn 生命周期 | R 或 B | 4 | 4 | 4 | 已立项（R 类，2026-08-26） |
| 17 | Adapter decoration lifecycle | synthetic adapter / wrapper 复制 metadata、难以卸载 | R 优先 | 5 | 5 | 5 | 第一梯队，正式 R 候选 |
| 18 | Multimodal attachment pipeline | image workaround 无法扩展到 attachment provenance 和转换 | R 优先 | 5 | 5 | 5 | 第一梯队，正式 R 候选 |
| 19 | Workspace mutation transaction | claim、checkpoint、rewind、restore 不能形成一次事务 | B | 5 | 5 | 5 | 第一梯队 |
| 20 | Plugin/profile management contract | duplicate row、依赖布局、更新回滚由插件各自处理 | R 或 C | 4 | 5 | 4 | 第二梯队 |

## 详细候选分析

### 1. 统一执行生命周期观察

**源码痛点。** `dsh-notification` 和 `dsh-session-notification` 需要从 session event 推断 turn 完成；`dsh-cost-meter` 需要从 `llm/stream` 累积 usage 再在 `agent/turn-stopping` settle；`dsh-model-failover` 在 `agent/request-error` 判断是否计入 circuit；`dsh-web-ui` task board 又用自己的 task/session/execution 对齐。这些实现都说明已有事件能被消费，但缺少跨域、稳定、可恢复的执行 identity。

**建议语义。** 增加 `pluginApi.execution`，提供冻结的 `ExecutionRef`：`executionId`、`sessionId`、`agentId`、`parentExecutionId`、`turn`、`step`、route snapshot 和 start sequence。提供 `onStart`、`onPhase`、`onSettled`、`current(exec)`、`history(session)`，明确 `settled` 只允许一个终态，并保留 `outcome: success | error | aborted | denied | superseded`。观察结果应是 read-only projection，不要求所有内部阶段都成为新的 catalog event。

**通道判断。** 基础层可以由现有 `agent/*`、`tools/*`、`llm/stream`、`session/*` 组合，属于 B 类；若要求官方在 prompt/tool assembly 前提供真正稳定的 execution identity，则应另列 C 类上游提案。它是跨横切语义，不应为此替换某个单一官方 loader 行。

**风险与验收重点。** 必须覆盖并发 tool、重入 stream、abort、retry 后新 execution、reconnect 恢复、旧 execution late event 和 session fork。不能把 event seq 当作 execution identity，也不能因为某个事件缺失就伪造成功终态。

### 2. Durable coordination / lease

**源码痛点。** `dsh-agent-teams` 用 attempt id 防止旧成员覆盖新成员；`dsh-task-relay` 保存跨 session handoff；`dsh-file-claim` 自己实现 heartbeat、stale 判断、force takeover 和 pending merge。三者实际上需要同一类 owner/lease/CAS 机制。

**建议语义。** 增加 `pluginApi.coordination`：

```text
lease.acquire(resource, { owner, ttlMs, metadata })
lease.heartbeat(handle)
lease.release(handle)
lease.takeover(resource, { expectedExpiredAt })
lease.watch(resource, listener)
record.compareAndSet(key, expectedVersion, value)
```

每个 handle 要带 `ownerId`、`generation`、`expiresAt`、`fencingToken`；写入必须携带 fencing token，避免 stale holder 在网络恢复后继续写。存储 backend、workspace scope、session scope 和内存 fallback 要明确区分。

**通道判断。** B 类门面服务，底层可利用现有 storage/workspace service；不是 R 的首选，因为它是跨任务、文件和 agent 的横切语义。若未来官方提供统一 lease service，应优先直通并保留现有 facade。

**价值。** 这是把“多 agent 协作看起来能用”提升到可证明的 ownership contract，直接减少 late result、重复执行和 stale takeover 数据损坏。

### 3. Client generation / rebind

**源码痛点。** `dsh-web-ui`、`dsh-better-sidebar`、`dsh-open-in-vscode` 都要面对 client slot、Typert Remote、服务重连和旧版宿主差异；`dsh-vision-toolkit` 还实现了 runtime manager 和 settings generation。当前 client manifest、remote mount 和 slot 能力解决了“如何挂载”，但没有统一解决“挂载后如何换代”。

**建议语义。** 增加 `pluginApi.client.lifecycle`：

- `generation()` 返回当前 host/client contract generation；
- `registerFace(name, { version, capabilities, bind, dispose })`；
- `onRebind(listener)` 和 `availability(name)`；
- 所有 remote/slot/settings contribution 携带 epoch；
- 旧 epoch 的异步结果自动被丢弃，重连后可重新 bind；
- 每个 contribution 独立降级，不因一个 remote face 缺失而停掉所有 client mounter。

**通道判断。** 初版可在当前 client bundle、remote 和 slot facade 上做 B 类生命周期层。若官方 client loader/api-remotes 没有任何 generation 或 rebind 边界，直接替换相应 loader 行是合理 R 类候选，不应为了避免 R 长期在每个插件中写版本适配。

**风险。** 不能把 browser refresh、SSE reconnect、Typert remote schema version 混成一个 generation。必须测试 rebind 期间 pending call、旧 disposer、重复 mount、partial face 和 host 不可用。

### 4. Recovery / retry / checkpoint policy

**源码痛点。** `dsh-auto-continue` 自己分类 transient/permanent failure 并做 cooldown/backoff；`dsh-turn-rewind` 自己维护 stale plan、rescue point、restore verify；`dsh-checkpoint-rewind` 自己决定三态 snapshot、配额和 retention；`dsh-agent-teams` 还要处理 task attempt 重派。这不是一个简单的 `agent/request-error` 监听问题。

**建议语义。** 增加 `pluginApi.recovery`：

- `classify(error, context)` 返回 typed failure class、retryability、idempotency；
- `registerPolicy({ id, match, decide })` 组合 retry/abort/fork/fallback；
- `checkpoint.create(scope, reason)`、`checkpoint.list(scope)`、`checkpoint.restore(id, options)`；
- `attempt.begin/retry/supersede/settle`；
- 规定 retry 与 fork 的 durable marker、backoff、budget 和 manual approval。

**通道判断。** B 类共同策略层，先消费现有 error/turn/session/checkpoint 能力。不能声称它能凭空恢复官方没有保存的状态；涉及完整请求边界或官方 loop 内部 retry 选择的部分应保留 C 类 proposal。R 不是必要条件，因为 recovery policy 横跨多个 loader。

**验收重点。** `abort` 不得被当作 transient；retry 不能重放非幂等工具；checkpoint restore 必须验证 session/workspace/config 是否都恢复；旧 attempt 的 late completion 必须被拒绝。

### 5. Context composition / provenance

**源码痛点。** `dsh-context` 维护 surface、archive、removed node、token pressure 和请求 snapshot；`dsh-anchored-standard` 手工构造 virtual turn 并依赖 `sourceEventSeqs`；`dsh-vision-toolkit` 与 `dsh-agent-teams` 都需要向 prompt 注入说明。当前 systemPrompt 注册和 session append 已有，但插件无法统一回答“这段上下文从哪里来、覆盖了什么、为什么被压缩或删除”。

**建议语义。** 增加 `pluginApi.context`：

- `contribute({ id, scope, phase, priority, content, provenance, ttl })`；
- `compose(request, { budget, policy })` 返回 immutable contribution graph；
- 每个节点带 `source`, `sourceEventSeqs`, `supersedes`, `expiresAt`, `visibility`；
- `inspect(session)` 显示 served surface、archived content、dropped content 和原因；
- compaction/prune 时发出可查询的 replacement mapping，而不是只留下结果。

**通道判断。** 现有 `systemPrompt` 和 session surface 可支撑一部分 B 类实现；真正让官方 agent loop 消费带 provenance 的 assembled context 可能需要 C 类上游接口。它不应取代现有 tokenMeter 或 session surface，而是为两者提供可解释的组合层。

**立项结论（2026-08-26，用户明确指示）：门面本体维持 B 类；`sent` 证据切片改 R 类。** 官方 `dsh-agent-loop` 组装/发送点（`renderContextSections`/`renderPrompt`）无 provenance dispatch；本候选在既有 `@deepseek-ai/dsh-plugin-api-agent-loop` replacement（唯一 owner `@deepseek-ai/dsh-agent-loop`）上新增 evidence-only 证据发射（identifiers/seq 范围，无 content，不改组装/策略决策），使 `sent` 由真实证据支撑；组装点原生消费带 provenance 的 assembled context 仍登记 C 类上游提案 U19。

**风险。** provenance 不能伪造为“模型一定看到了”；必须区分 contributed、served、sent、archived、redacted 五种状态，并控制敏感信息进入 inspector。

### 6. Usage / cost / budget telemetry

**源码痛点。** `dsh-cost-meter` 从多个 usage chunk 去重计 call，并把日账本、session 账本、provider/model 价格和预算告警都自己实现；`dsh-tianshu-tui` 又自己展示 `/cost`；当前 `tokenMeter` 是估算服务，不是实际 provider usage ledger。

**建议语义。** 增加 `pluginApi.usage`：

- `record(sample)`：input/output/cache/reasoning token、provider/model、execution id；
- `settle(execution)`：幂等提交一次 execution 的实际 usage；
- `ledger.query({ session, workspace, day, provider, model })`；
- `pricing.register(provider, model, price)`；
- `budget.register({ scope, limit, action: 'notify'|'deny'|'route' })`；
- `events.on('usage/settled')` 和 `events.on('budget/threshold')`。

**通道判断。** B 类即可从 `llm/stream` usage chunk、execution identity 和 session scope 统一实现。若未来官方 provider 给出 authoritative invoice/credit 事件，应允许 source 标记为 provider-confirmed，不能把估算冒充账单。

**价值。** 它不仅是 UI 统计，也能成为 route policy、auto-continue、MCP tool exposure 和 workflow 调度的输入。预算 action 为 deny/route 时必须走现有 approval/fail-safe 语义。

**复审结论（2026-08-26）：登记为待弃用（pending deprecation），当前不动工。** 该 feature 与 `memory-interoperability` 同型：单个 cost 插件（如 `dsh-cost-meter`）即可用已交付的 `llm/stream`、session 与 execution observation API 端到端实现成本账本，`pluginApi.usage` 的 ledger/pricing/budget 是会计功能子系统而非门面转译。可能保留的门面化方向仅为 usage sample 规范化与 provider-confirmed/estimated 词汇。弃用动工待用户另行指示，此前 API 保持不变。

**执行记录（2026-08-26）：** 按用户 ANY 指示执行移除——`pluginApi.usage`（`record / settle / pricing.register / query / budget.observe / availability`）整面删除（commit `856746f`，worktree `chore/usage-api-removal`），feature-list §7 与各 spec 状态行同步登记为 removed，spec 目录保留作历史存档。移除后成本账本由单 cost 插件经已交付的 `llm/stream`、session 与 execution observation API 端到端实现。

### 7. MCP catalog / dynamic tool lifecycle

**源码痛点。** `dsh-mcp-client-v2` 明确补了官方客户端的多个缺口：分页 `tools/list`、非阻塞启动、server 状态 RPC、工具搜索、`list_changed`、reconnect、generation swap、旧工具注销和 JSON Schema 降级。它还必须保持官方命名 `mcp__server__tool` 并区分 public name 与 raw name。

**建议语义。** 这是一个独立的 `pluginApi.mcp`：

- `servers.list/status`；
- `tools.list({ server, generation })`；
- `onToolGenerationChanged(listener)`；
- `resolvePublicName(publicName)` 与 `resolveCall(identity)`；
- schema normalization、tool provenance、connection diagnostics；
- tool registration/disposer 必须按 server generation 原子替换；
- disconnected server 的工具状态明确是 unavailable，不是静默保留旧 tool。

**通道判断。** **R 类优先。** MCP client 本身就是官方 loader 的自然 owner；如果现有官方行无法表达非阻塞连接、分页发现和 generation replacement，完整替换 `dsh-mcp-client` 行并复刻其服务/事件面，再增加 `pluginApi.mcp`，比在 facade 中复制一套 MCP client 更可维护。该 R 类必须锁定 runtime identity、检测官方行 disabled、禁止双跑，并保留官方 transport/tool contract。

**风险。** MCP server 不可信，schema、tool name、返回 content、stderr、断线期间 pending call 都需要边界。替换不能只复制“能调用工具”的 happy path。

### 8. Progressive tool discovery

**源码痛点。** MCP v2 用 `mcp_tool_search` 避免把所有工具细节一次塞给模型；`dsh-vision-toolkit` 只有在 `vision-skills` 激活后才注册 visual tools；`dsh-agent-teams` 通过 prompt usage 约束模型何时调用十个 team tools。当前 `tools.register` 是全局静态暴露，没有统一的 discover/activate/expose 生命周期。

**建议语义。** 增加 `pluginApi.tools.discovery`：

- `catalog.register({ id, summary, capabilities, activate })`；
- `search(query, scope)` 只返回轻量 descriptor；
- `activate(id, { session, execution, reason })` 返回带 generation 的 toolset；
- `deactivate(id, generation)`，旧执行仍可完成但新执行不可见；
- 暴露原因、技能来源、模型可见性和审计事件可查询。

**通道判断。** 初版 B 类，基于现有 tools registry 和 systemPrompt/skills；若模型 toolset 在官方 `dsh-tools` loader 内不可动态重建，可把 `dsh-tools` 的工具装配行作为后续 R 候选。它和 MCP catalog 不重复：MCP 负责外部 server identity/lifecycle，本 feature 负责所有工具的渐进式暴露策略。

### 9. Security policy / egress guard

**源码痛点。** `dsh-secret-redactor` 在 `tools/post-execute` 之后递归脱敏 tool result，收集 env、SSH password、API key、JWT、private key 等；`dsh-approve-for-me` 在 `approval/request` 之前按 read-only/dangerous 规则 allow/deny/ask；`dsh-system-proxy` 又独立处理子进程 proxy export。`dsh-web-ui` 的 SSH 文档还明确记录了明文密码、重连重放非幂等命令和 unredacted output 风险。

**建议语义。** 增加 `pluginApi.security`，但拆成清晰的三个面：

- `policy.register/decide`：tool、session、workspace、route、user approval context；
- `redaction.register/apply`：对模型可见、UI 可见、日志可见分别定义 policy；
- `egress.check/lease`：subprocess、HTTP、MCP、remote channel 的 destination policy。

所有 deny 必须 fail-closed；decision 带 `policyId`, `reason`, `expiresAt`, `auditId`，并区分模型请求前、工具执行前、工具结果后三个时点。

**通道判断。** B 类 facade + 多个官方 seam；**横切安全语义不应 R**。只有某一个官方 security/approval loader 天然拥有完整决策边界时，才另行评估 replacement，不能让 R bundle 偷换其他服务。

**风险。** redaction 不能只做 regex；二进制、嵌套对象、日志、异常 cause、MCP resource 都要定义覆盖范围。egress 允许策略和系统 proxy 配置不是一回事，必须防止“检测到 proxy”被误当成“允许出站”。

### 10. Memory interoperability

**源码痛点。** `dsh-memories` 提供 project-scoped key/value、list/search/delete；`dsh-tianshu-tui` 提供 `/remember` 和 memory browser；`dsh-context` 有 context surface，但没有稳定 memory provenance。私有工具足以保存字符串，却无法保证多插件 scope、冲突、过期、敏感标记和 prompt 注入的一致性。

**建议语义。** 增加 `pluginApi.memory`：

- provider 注册和 capability 声明；
- scope 类型：workspace、project、session、user、team；
- `put/get/search/remove` 返回 `memoryId`, version, source, confidence, createdAt, expiresAt；
- `recall({ query, scope, budget, sensitivity })` 只返回候选，不自动注入；
- `compose` 阶段显式标记哪些 memory 进入模型请求；
- conflict resolution、redaction 和 retention policy 可注册。

**通道判断。** B 类，基于 storage、session、context 组合。它不替代某个具体 memory plugin；后者应只是 provider/consumer。没有必要 R，除非官方未来新增唯一 memory loader。

**立项结论（2026-08-26）：排除立项，撤回候选。** 评审确认该候选是功能组件而非门面转译：最终用户安装一个 memory 插件即可完整获得记忆能力，且该插件可基于已交付的工具接口、session/execution 观察与 systemPrompt/session 上屏 seam 自行实现；`pluginApi.memory` 的 `put/get/search/remove`、`recall`、`compose` 没有稳定任何官方语义钩子，而是新造一个记忆子系统。跨插件共享同一份记忆的需求未被任何已证实场景支撑，属于臆想性多消费者设计（AGENTS.md §3.0.3 克制设计原则）。因此本候选从候选池撤出，不再立项；记忆能力由具体功能插件自行实现，需要来源解释的消费者走既有 contribution/sourceEventSeqs 契约。

### 11. Session branch / sidechain / edit

**源码痛点。** 现有 `session.fork` 和 durable append 已经解决低层能力，但 `dsh-turn-rewind`、`dsh-checkpoint-rewind`、`dsh-tianshu-tui` 仍各自处理 branch、rewind、side question、rescue point、session truncation 和 restore。`btw` 类 side question 甚至需要 fork 前缀、单轮收尾和独立 stream filter。

**建议语义。** 增加高层 `pluginApi.session.branches`：

- `branch.create(parent, boundary, { kind: 'retry'|'sidechain'|'experiment'|'rescue' })`；
- `branch.current(session)`、`ancestors/children`；
- `edit.plan(session, target, expectedVersion)`、`preview(plan)`、`commit(plan)`、`rollback(commitId)`；
- branch event 带 parent boundary、causal source seqs、visibility 和 retention；
- sidechain 可以声明是否继承 route、memory、attachments、tool state。

**通道判断。** **R 类优先。** 分支和 session durable semantics 天然属于 `dsh-session` loader；如果只在 facade 中拼接 fork、append、truncate，很难保证官方 session index、flush、query 和 event producer 的一致性。可设计 replacement bundle 复刻完整 session 服务/事件面，再增加 branch contract。R 的退役条件应是官方提供等价 branch/edit/sidechain API。

**风险。** 这是高风险 feature：不能把“新 child session”伪装成原 session 的修改；restore/rollback 必须考虑非 session 状态、tool side effect 和旧 client cursor。

### 12. Plugin health / diagnostics

**源码痛点。** 本仓库已有核心和 feature guard，但第三方插件仍把 unavailable、pending inject、schema mismatch、duplicate registration、版本不匹配写入各自日志。`dsh-mcp-client-v2` 提供 status RPC，`dsh-vision-toolkit` 提供 runtime readiness，`dsh-tianshu-tui` 有 `/doctor`，`dsh-plugin-manager` 则维护 health/status/repair。

**建议语义。** 增加 `pluginApi.diagnostics`：

- `registerCheck({ id, owner, scope, run, severity })`；
- `report({ code, state, since, remediation, dependency, generation })`；
- `snapshot({ scope: 'boot'|'host'|'client'|'plugin' })`；
- `onChanged`；
- `health` 与 `availability` 分离：健康检查失败不一定卸载能力，contract failure 才进入 inactive；
- 输出可被 CLI、Web、TUI 和其他插件消费，敏感信息需 redaction。

**通道判断。** B 类基础设施。它应与 fail-safe guard 对接，但不改变“apply 失败不能穿透 boot”的硬约束。风险低、收益广，建议尽早做。

### 13. Model health / failover / route policy

**源码痛点。** `dsh-model-failover` 在 `agent/request`/`agent/request-error` 之间实现 model/platform 两级 circuit breaker、fallback、cooldown 和真实 probe；`dsh-tianshu-tui` 的调研文档也指出 provider 切换属于 turn boundary；当前 `pluginApi.routing` 主要是 route 查询，不是 policy owner。

**建议语义。** 增加 `pluginApi.routing.policy`：

- `register({ id, match, rank, select, onFailure })`；
- `health.observe(route, outcome)`、`circuit.status(route)`、`probe(route)`；
- `resolve(request, candidates)` 返回带 reason、policy chain、budget 和 fallback lineage 的 route decision；
- 同一 execution 内 route immutable，跨 turn 才允许切换；
- 记录 primary、fallback、probe、circuit-open/close 的 durable observation。

**通道判断。** **R 类优先。** 最终 route 决策天然在 `dsh-agent`/`dsh-agent-loop` loader 行内；如果继续通过多个 `agent/request` prepend 竞争顺序，策略之间会互相覆盖。应考虑 replacement bundle 完整复刻官方 route/loop 行，再提供有序 policy registry。R 不是降级，而是这里最接近正确 ownership 的交付通道。

**风险。** 不得把一次 retry 误记为新 route；不能在已有 stream 中途换 model；probe 不能泄漏用户 prompt 或产生非预期副作用；fallback 要服从 budget、approval 和 input modality admission。

### 14. Remote session / channel bridge

**源码痛点。** `dsh-web-ui` 的 remote-web-ui 实现 pairing、authorized devices、SSE/polling fallback、ack/heartbeat、session RPC 和 tunnel status；README 记录 Cloudflare/Tailscale 对 SSE 的现实限制。现有 remote publish 和 client `$mount` 是插件 UI/config bridge，不是跨设备 session channel contract。

**建议语义。** 增加 `pluginApi.remoteSessions`：

- `channel.open({ device, capabilities, resumeToken })`；
- `subscribe({ session, cursor })`、`ack(cursor)`、`resume(token, cursor)`；
- `presence/heartbeat/revoke`；
- transport capability negotiation：SSE、poll、WebSocket、loopback；
- per-method authorization、redaction、rate limit 和 audit；
- 明确定义 at-least-once delivery、dedupe key 与 snapshot resync。

**通道判断。** **R 类优先。** pairing、session channel、auth 和 replay 天然归 `dsh-api-gateway`/remote loader；门面仅做一层兼容会复制安全边界。应复刻官方 HTTP route、auth 和 service 面，再增加规范化 channel capability。没有稳定 auth/transport contract 时，也可以先以 C 类上游 proposal 记录。

### 15. Task/workflow execution observation

**源码痛点。** `dsh-web-ui` task board 把 task card 绑定到真实 DSH session，等待 settled outcome；`dsh-agent-teams` 自己维护 task/attempt/member；官方已经有 workflow engine 和 jobs service，但它们没有统一对外表达“业务 task -> workflow run -> agent execution -> session transcript -> job”。

**建议语义。** 增加 `pluginApi.tasks`：

- `task.register/start/claim/reassign/settle`；
- `run` 绑定 workflow、execution、session、job；
- `status` 使用统一 terminal outcome 和 attempt/fencing token；
- `observe(taskId)` 能在断线后从 durable state 重建；
- `attach(session)`、`openTranscript(run)`；
- task board、TUI、agent teams 都作为 consumer，不再各自发明 identity。

**通道判断。** B 类聚合层，底层可使用 jobs/workflows/subagents/session。它和统一 execution observation 的区别是：execution 是运行时观察，task 是用户/业务拥有的 durable work item。需要避免新增一套与官方 jobs 重叠的 worker scheduler。

### 16. Skill discovery / activation

**源码痛点。** `dsh-vision-toolkit` 只在 upstream runtime ready 后注册 skill、activation bootstrap 和 Agent-scoped visual tools；skill 文档中有明确 `whenToUse`，工具不是始终暴露。`dsh-tianshu-tui` 实现 skills browser、user-invocable gesture 和 `skills/change` 刷新；当前 `pluginApi.services.skills` 是 registry 直通，不负责 activation lifetime。

**建议语义。** 增加 `pluginApi.skills.activation`：

- `discover({ query, session, agent })`；
- `activate(skill, { reason, scope, ttl })`；
- `exposure(skill)` 返回可见工具、prompt sections、resources；
- `deactivate` 和 generation；
- `userInvocable`、auto-match、explicit invocation 的来源区分；
- skill 依赖缺失时只降级该 skill，不影响其他 registry 条目。

**通道判断。** B 类可以围绕现有 skills registry、tools registry 和 systemPrompt 实现；如果官方 skill loader 是唯一负责“skill -> tool exposure”的地方，R 类也应正式保留为选项。不要为了规避 R 把每个 skill 的 activation 拼在插件自己的 prompt listener 里。

**立项结论（2026-08-26，用户明确指示）：改 R 类。** 官方 `dsh-skill` 只拥有 registry，模型侧暴露的唯一一致性 owner 是 `dsh-tool-skill`（`skill` 工具 + `agent/pre-step` 注入 + `<available_skills>` 目录机制，均只查静态 `modelInvocable`/`userInvocable` 布尔）。本候选以 R 类落地：禁用 `tool-skill` 行 + 插入 `plugin-api-tool-skill`，保真复刻三面契约后增加 session 内动态 activation 策略、目录变化告知策略（默认官方全量重发对齐，政策入口切换为英文最小更新信息）；U18 保留为上游提案。上述“B 类 + R 选项”判断被本结论取代。

### 17. Adapter decoration lifecycle

**源码痛点。** ModLens 通过 synthetic adapter 复制官方 model info，委托真实 provider，并监听 `llm/adapters-updated` 做 reconcile；`dsh-read-image` 早期也需要 adapter discovery、重入和自嵌套防护。`registerAdapter` 解决 provider 注册，却没有官方级的 decorator chain、identity、顺序和撤销协议。

**建议语义。** 增加 `pluginApi.llm.adapters.decorate`：

- `decorate({ id, match, priority, capabilities, wrap })`；
- wrapper 接收 stable adapter identity、source route、AbortSignal 和 operation context；
- decoration chain 可查询、按 generation reconcile、按 identity disposer；
- 明确 metadata overlay 与 execution transform 分离；
- 禁止 wrapper 重新匹配自己造成递归；
- provider unload 时自动撤销其 decorations。

**通道判断。** **R 类优先。** adapter/provider loader 是唯一知道真实 provider identity、model info 和 stream ownership 的位置。若官方不提供 decorator boundary，替换 `dsh-llm` 行比在门面里 monkey-patch resolver、复制 metadata 更诚实。R bundle 必须完整复刻 `llm` 服务和事件面，只增加 decoration contract。

**风险。** 这是高风险 runtime feature：必须测试多 decorator 排序、stream rejection、adapter replacement、source identity、disposer identity、self-match 和 partial boot。

### 18. Multimodal attachment pipeline

**源码痛点。** 当前本仓库已有 image admission 和 `attachments.validateImage/saveImage/readImage`，但 `dsh-vision-toolkit` 仍需自行处理 paste backend、图片大小/像素限制、压缩缓存、文件变化校验、deadline、输出 staging 和来源 hash。ModLens 还在 client capture paste，绕过原生 attachment 路径。真实需求已经超过“模型是否接受 image”。

**建议语义。** 增加 `pluginApi.attachments.pipeline`：

- `ingest(source, policy)` 生成 stable attachment id、digest、media type、dimensions、owner；
- `transform(id, operation, policy)` 产生新 generation，保留 parent provenance；
- `project(id, targetRoute)` 明确 image/audio/file 到请求 content 的投影；
- `resolve(id)`、`open(id, signal)`、`cleanup(id, retention)`；
- `validate`、size/pixel/deadline/concurrency policy；
- session event、request transform、cost meter 都能引用 attachment id，而不是重复传路径。

**通道判断。** **R 类优先。** attachment loader 天然拥有 ingestion、storage、validation 和 media identity；如果官方行缺少 pipeline，可以 replacement `dsh-attachment`，完整保留官方 attachment service/事件面，再增加通用 pipeline。image admission 仍应是上层 route policy，不要把所有 modality policy 塞回 storage。

**风险。** 路径不能作为 identity；文件在请求前变化必须 fail-closed；缓存必须 workspace/session 隔离；远程 URL、data URI、MCP resource 和浏览器 paste 的信任级别要不同；不能把压缩后的附件误当原始附件。

### 19. Workspace mutation transaction

**源码痛点。** `dsh-file-claim` 负责谁能写；`dsh-checkpoint-rewind` 负责变更前 snapshot；`dsh-turn-rewind` 负责 Change Ledger 和 file restore；`dsh-better-sidebar`/web UI 又有 Git diff、暂存、还原和多 tab 编辑。它们之间没有统一的 mutation transaction，因而无法原子回答“这次 agent 变更影响了哪些文件、session、config 和外部 side effect”。

**建议语义。** 增加 `pluginApi.workspace.transactions`：

- `prepare({ workspace, resources, intent })` 先获取 lease 并创建 checkpoint；
- `recordMutation(tx, change)` 记录 before/after digest、tool/execution/source；
- `preview(tx)` 返回可审阅 diff 和 side effects；
- `commit(tx)`、`rollback(tx)`、`recover(tx)`；
- 与 Git、session branch、tool approval、file claim、checkpoint 通过 capability adapter 对接；
- 非可回滚副作用必须标记为 external，并要求显式 approval。

**通道判断。** B 类协调层，依赖 coordination、recovery、workspace、session；不应 R，因为它跨文件、session、Git 和外部工具。它可以先定义公共 transaction/provenance，而不是一开始承诺自动回滚所有外部副作用。

### 20. Plugin/profile management contract

**源码痛点。** `dsh-web-ui/packages/dsh-plugin-manager` 处理 profile mutation、duplicate row、patch diff、atomic rename、repair、health/status 和 gateway jobs；其 README 和主仓库文档还记录 strict pnpm layout、hoisting、release-age gate、聚合包 row id 冲突以及“安装后必须重启”。这些不是单一 UI bug，而是 plugin bundle 分发边界的公共痛点。

**建议语义。** 增加 `pluginApi.profile` 或独立 manager bundle：

- `inspect(profile)` 返回 resolved rows、package identity、source、version、dependency graph；
- `planInstall/planRemove/planUpdate` 输出 patch diff 和 conflict；
- `apply(plan)` 原子写入并保留 rollback snapshot；
- `health(profile)` 检查 duplicate id、missing package、row/package mismatch、main/helper version mismatch；
- `repair(profile)` 只执行显式批准的修复；
- `reload/restartRequired` 明确告诉 client 当前状态。

**通道判断。** 若作为公共 profile API，先做 C 类上游 proposal，避免 facade 偷定义官方 profile mutation 的全部语义；若官方 plugin manager loader 已存在且缺少这些能力，R 类可替换该 manager 行。它不是核心 plugin API 的最小依赖，应作为独立可选 bundle，不能让普通 headless plugin boot 依赖 Web manager。

## R 类候选的正式评估

R 类在本仓库的定位是：**当缺失语义天然属于某个官方 loader 行，而且 replacement 能完整复刻原服务/事件契约时，R 是正式的交付通道。** 下面这些候选不应因为“用了 R”被降级：

| 候选 | 可能替换的官方 owner | 为什么 R 合理 | 不能省略的约束 |
|---|---|---|---|
| MCP catalog/lifecycle | `dsh-mcp-client` | MCP transport、server generation、tool registration 本来就由该行拥有 | 分页、断线、`list_changed`、旧工具卸载、schema 降级、tool call identity |
| Session branch/sidechain/edit | `dsh-session` | branch boundary、event index、flush/query 是 session loader 的一致性责任 | 完整 event/service 面、fork identity、durable restore、旧 cursor 和 external side effect |
| Model health/failover/route policy | `dsh-agent` + `dsh-agent-loop` | 最终 route 选择和 retry boundary 在 agent loop 内 | agent/request/error 契约、turn-boundary route、fallback lineage、probe isolation |
| Remote session/channel bridge | `dsh-api-gateway` | auth、pairing、transport、resume 和 replay 属于 channel owner | 原 auth/route 面、权限拒绝、ack/dedupe、SSE/poll fallback、敏感字段隔离 |
| Adapter decoration | `dsh-llm` | provider identity、model info、stream ownership 在 LLM loader 内 | 全量 llm service/event 面、adapter identity、dispose、self-match、stream failure |
| Attachment pipeline | `dsh-attachment` | attachment identity、storage、validation、transform provenance 属于附件 owner | 原 storage/validation 面、路径安全、digest、generation、cleanup、fail-closed |
| Skill activation | 官方 skill loader（若确认其是 exposure owner） | skill 到 tools/prompt/resources 的生命周期必须单一 owner | registry 兼容、activation/disposer、user invocation、partial degradation |
| Plugin/profile manager | 官方 manager loader（若存在） | profile row/package/dependency mutation 不宜由多个 UI 插件各写一套 | patch diff、atomicity、rollback、duplicate guard、restart status |

R 类共有的推进条件：

1. 先写 replacement identity matrix：runtime 全量版本、被替代官方包 identity、服务面、事件面、导出/非导出边界。
2. patch 中明确 `disabled: true` 的官方行和唯一替代行，boot 自检失败必须正常 return，不能静默双跑。
3. 只替换 ctx service/event 面，不覆盖 `@deepseek-ai/dsh-*` 包 import 面。
4. 替代包与主包版本不一致时，只停用该 R 能力，不影响主 facade 和其他能力。
5. 为每个 R 候选登记上游提案和退役条件：官方提供等价 seam 后，消费者迁移并删除 replacement。
6. R bundle 不能承载 priority、deepFreeze、fault containment 等横切派发语义；这些仍属于 facade/framework 层。

## 优先级建议

> 本节为 2026-08-20 的启动顺序建议（历史快照）；实际立项与当前状态以「当前立项状态」表为准。

### 第一梯队：先做公共契约

建议优先形成 Stage 0 候选的顺序：

1. `execution-observation`：其他 telemetry、recovery、task、routing 都需要稳定 correlation。
2. `plugin-diagnostics`：低风险、高覆盖面，能让后续所有 feature 的 fail-safe 可诊断。
3. `usage-budget-telemetry`：源码证据强，能立即统一 cost-meter 类插件。（2026-08-26 起已登记待弃用，见 §6 复审结论。）
4. `mcp-catalog-lifecycle`：直接采用 R 评估，不把它压缩成普通 tools register 扩展。
5. `model-route-policy`：直接采用 R 评估，不继续让多个插件竞争 `agent/request` prepend。
6. `attachment-pipeline`：与已有 image admission 衔接，向 audio/file/resource 扩展。
7. `recovery-policy` + `workspace-mutation-transaction`：两者共享 checkpoint/lease/provenance 设计，应在 requirements 阶段对齐。

### 第二梯队：依赖第一梯队

- `coordination-lease`：需要先定 task/execution identity 和 storage scope。
- `context-provenance`：需要先定 execution、attachment 和 session branch provenance；memory 来源由具体插件经既有 contribution 元数据声明，不依赖专用 memory facade。
- `client-generation-rebind`：需要先定 diagnostics/availability 和 remote contract。
- `task-execution-observation`：需要复用 execution、lease 和 recovery。
- `progressive-tool-discovery`、`skill-activation`：需要对齐 tools catalog 和 client exposure。
- `session-branch-sidechain-edit`、`remote-session-channel`、`adapter-decoration`：价值高但状态一致性和 R 复刻成本更高，适合在对应 owner identity 已明确后启动。
- `plugin-profile-management`：价值明确，但不是普通第三方插件安装后必需的核心依赖，适合独立可选 bundle。

（`memory-interoperability` 已于 2026-08-26 撤出候选池并明确排除立项，见 §10，不再参与启动顺序。）

这里的“第二梯队”表示依赖关系和启动顺序，不表示候选没有价值，也不表示 R 类候选应该被排除。

## Stage 0 前需要共同确认的问题

> 权威版 2026-08-21 起按领域分册至 `docs/standards/`（见其 `README.md` 索引；`stage0-common-questions.md` 已弃用，仅作溯源）；本节保留为历史快照。

这些问题影响多个候选，应在正式 Goal 阶段之前统一口径：

1. `executionId` 是否由 plugin-api 生成，还是必须等待官方提供稳定 execution identity？
2. durable record 的最小存储 contract 是 session、workspace 还是 profile-scoped storage？
3. 所有 generation 是否都采用单调整数，还是使用 owner-specific opaque token？
4. `settled`、`committed`、`closed`、`disposed` 是否需要严格区分，避免把生命周期词混用？
5. 哪些语义需要模型可见，哪些只允许 UI/diagnostic 可见，哪些必须 redacted？
6. R bundle 是否按现有 full/selection install 模式作为独立辅助包发布？
7. replacement 是否需要提供官方行的完整 client half，还是只替 host 行？必须按具体 owner 的原始契约决定，不能一概而论。
8. 所有恢复和 retry 是否默认 fail-closed；对 non-idempotent tool 是否强制要求 capability declaration？
9. 纯 projection、policy registry、durable mutation 的边界在哪里，避免把每个候选都做成一个万能 service？
10. 当前仓库仍处于纯本地开发窗口，合理的 API 形状重构应尽早纳入，而不能用“已 delivered”作为拒绝理由；但仍必须遵守每个 feature 的 Stage 0–4 gate。

## 证据限制

- star、下载量和仓库源码会变化；本报告的判断基于 2026-08-20 前后的公开内容和本地快照。
- “热门”按公开生态可见度、功能复杂度和源码可观察性综合判断，不把 star 当作质量证明。
- 公开插件的 workaround 不是官方 contract；本报告把它们当作需求证据，不把所有实现细节直接推荐进 API。
- 某些 R 候选需要再次核对当前官方 runtime 的完整 loader identity，当前报告只提出 owner 假设，不替代 replacement identity audit。
- 本报告没有修改主工作目录的 `lib/`、`test/`、`package.json`、`docs/specs/` 或 `AGENTS.md`，也没有实现任何候选 feature。
