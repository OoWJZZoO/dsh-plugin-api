# 反直觉结构清单（M8 目标清单）

> 本表从当前实现反向整理问题。每一项绑定公共 path、问题、目标和验收证据；抽象规则只有在能落到具体 path 时才算完成。

| current path / shape | 反直觉点 | M8 目标 | 验收证据 |
|---|---|---|---|
| 多个 namespace 同时含 register/query/mutate | 一个对象承载多套心智模型 | 按八类 idiom 拆叶子，namespace 只作 bounded context 导航 | member registry 每叶一行 |
| `tools.restrict`, `tools.guard` | 看似调用动作，实际是策略注册 | `*.register({ decide })` | policy contract + auto-apply test |
| `llm.requestTransforms.transform` | transform 入口不像注册，且可能只在重入时触发 | `requestTransforms.register`；无决策点登记 gap | policy decision-point record |
| `registerAdapter/registerConfigurableProviders/registerModelDiscovery` | 同一登记套路有多个动词 | 各 registry 使用 `register(spec)` | resourceRegistry naming check |
| `agents.providers.enter/announce/setFactory` | 同一登记表按种类裂成动词 | `providers.register({ kind })` | one-table rule |
| `section/context/variable/tools/suppressRuntimeContext` | 投稿被伪装成五个领域动作 | `prompts.contribute({ kind })` | contribution handle shape |
| `remotes.publish`, `mountRemote`, `mountRemoteContribution` | host/client 投稿动词不一致 | `register` 仅用于资源登记，装配投稿统一 `contribute` | host/client parity |
| `sessions.on/once`, `onDurable/onceDurable`, `onChange`, `watch` | 订阅词过多且一次性订阅另成入口 | `observe` + 标准句柄；一次性为 subscribe 选项 | projection naming check |
| `coordination.watch` | coordination 使用 watch，projection 使用多套 observe/onChange | `coordination.observe` | coordination vocabulary check |
| `diagnostics.register` / `settings.register` | 当前返回裸 disposer | 标准 handle 或明确 contribution handle | return-shape fixtures |
| durable observers / remote registration | 裸 disposer 与 `{ ok, disposer }` 并存 | projection/contribution 标准 handle | handle member registry |
| `security` registration handles | handle 缺少统一 id/ownerId/generation | policy handle 统一四字段 | security contract test |
| tool discovery register handle | 只有 generation/dispose，缺 id/owner | resourceRegistry 标准 handle | registry shape check |
| `generation` / `sequence` / `revision` / `epoch` | 并发令牌、注册序号、新鲜度混用 | generation=fencing；seq=注册序号；epoch=新鲜度 | field vocabulary check |
| `security.availability`, `agents.availability` | availability 名称承载能力矩阵 | `capabilityMatrix()`；`availability()` 只表达当前状态 | return-shape fixtures |
| 多数 namespace 缺 `availability()` | 不可用状态依赖属性存在或异常 | 每个公共 namespace 有冻结 `availability()` | namespace parity check |
| coordination outcome 内嵌 `availability` | 每次业务结果携带状态快照 | 独立 `coordination.availability(scope)` | outcome schema |
| policy register 后不自动咨询 | “注册成功但不生效”需要调用方自行 check | 删除咨询入口并登记决策点缺口 | decision-point inventory |
| `security.egress.check` | 咨询式入口掩盖官方路径缺决策点 | 删除入口；接入出站决策点后由 policy 自动生效 | gap row + no public member |
| `executions.recovery.consume` | 调用方自行签收策略结果 | 自动失败路径消费；未实现前保留 gap | replacement proof |
| `executions.recovery.visibility.project` | 手动投影与自动投影并存 | 自动投影；手动入口删除 | projection trace |
| `events.on/emit` 全局同面 | consumer 可误以为可生产任意系统事件 | observe 与 producer-authorized dispatch 分离 | authority map |
| no owner-scoped custom event publisher | 第三方无法安全派发自定义事件 | `events.define(spec)` 返回受限 publisher | owner/claim record |
| events dispatch returns `undefined` | operation 无 outcome，无法表达 containment | 判别式 dispatch outcome | event outcome schema |
| `sessions.channels.open/revoke` | lease 动词与普通资源 open/close 混同 | `acquire/release` + generation/fencing | coordination contract |
| `tasks.claim/reassign` | 抢占语义被普通任务动词掩盖 | `acquire/takeover` | coordination contract |
| `profiles.snapshot.validate` | mutation 命名却返回进度 handle | operation 标准 outcome/handle | operation inventory |
| `storage.open` handle 含 `purge` | 生命周期停止与持久删除混在一个 handle | dispose 仅停止；purge 明确 mutation extension | storage exception record |
| `connection.dispose` / service dispose | 内部生命周期泄漏到 client 公共面 | 仅公开业务句柄 disposer；根 dispose 内部化 | client surface snapshot |
| client `slots` register/inject/entries/subscribe/on | client 端与 host idiom 不对齐 | contribute/list/observe 与 host 同构 | host/client parity matrix |
| client `$on/$dispatch` | 远程传输机制暴露为领域 API | remotes.observe + owner publisher | client migration row |
| official client leaves mixed with facade leaves | 使用者无法判断哪些有门面保证 | 全部官方低层叶子进入 `services.*` | services audit |
| namespace registry entries | namespace 被误当成员，无法校验叶子 | namespace 只导航；叶子/handle 独立登记 | registry schema |
| operation conflict vocabulary varies by domain | 同一 idiom 学习成本高且规则不确定 | 统一外层 `concurrency` 字段；领域仅声明允许策略枚举 | operation exception format |
| mutation “typed failure” vs discriminated result | 失败到底抛还是返回不明确 | 业务结果统一 discriminated；编程错误/契约破坏才 typed throw | failure matrix |
| resourceRegistry duplicate semantics | “重复冲突”与“幂等重复”未分层 | same owner+same content returns existing; otherwise typed conflict | conflict matrix |

## 1. 问题项最低格式

新增公共成员时，必须同时记录：具体 path、违反的统一契约、目标 path/形状、是否造成能力损失、验证方式。只写“命名不统一”而不列 path 不满足 M8 清单要求。
