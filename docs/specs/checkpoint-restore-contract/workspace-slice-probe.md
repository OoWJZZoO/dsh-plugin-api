# Workspace Slice Probe Evidence（Stage 3 probe，能力门）

> feature: checkpoint-restore-contract / task 1
> 日期: 2026-09-06（Stage 4 开工前）
> 性质: probe 证据记录；本文件是本线 spec 制品（`docs/specs/checkpoint-restore-contract/**`），供 Stage 4 实现、集成波与对抗性审查引用。只读盘点官方安装事实（`/usr/lib/node_modules/@deepseek-ai/dsh/**`），未修改任何官方文件。

## 1.1 workspace 行契约 probe（能力门）

### 官方行装配事实

- 行: `- id: workspace / name: '@deepseek-ai/dsh-workspace'`，出处为官方 `dsh-web-app/cordis.patch.yml`（web profile bundle 的 insert 行，无 config 块）。
- 官方包 identity: `@deepseek-ai/dsh-workspace@0.1.0-rc.6`（package.json `version`）。
- headless/非 web profile 无该行 ⇒ `workspace` 类 source 在 headless 缺席属正常装配差异（availability 如实报告），不是故障。

### 被替代行的 ctx 契约清单（盘点自 `dsh-workspace/lib/index.js`，757 行）

**服务面 `ctx.workspaceRegistry`（`WorkspaceRegistry extends Service`，`super(ctx, 'workspaceRegistry')`）：**

| 成员 | 形态 | 时序/契约要点 |
|---|---|---|
| `create(path, title?)` | async → entity | `fs.realpath` 规范化（唯一 canon）；不存在路径 reject 原 ENOENT；非目录 reject；同 canonical path 幂等返回既有 entity（不改 title）；新记录 prepend 到 durable order；经内部 `enqueueOperation` 串行队列 |
| `get(id)` | sync → entity \| undefined | 只读缓存 |
| `list()` | sync → entity[] | durable order 投影；order 引用缺失 entity 时 throw |
| `delete(id)` | async → boolean | 队列化；未知 id 幂等 no-op 返回 false；保留目录与 session log；失败回滚 order 且 entity 保持发布 |
| `insertBefore(id, beforeId?)` | async → workspaceIds | DOM-insertBefore 语义；未知 source/anchor throw `WorkspaceOrderInvalidError` |
| `archiveSession(sessionId)` | async → void | registry 全局 archive 集合（单向增；无 unarchive 公共 API）；未知 session throw `WorkspaceUnknownSessionError` |
| `sessionKnown(id)` | async → boolean | live / header 索引 / persistence 三源；storage 故障如实传播（不伪装 unknown） |
| `resolveByPath(path)` | async → entity \| undefined | 不创建不 mutate |
| `get archivedSessionIds` | sync → string[] | archive order |

**entity 面（`WorkspaceEntity`，getter + 方法）：** `path` / `title` / `createdAt` / `updatedAt` / `sessionIds`（按 canonical-cwd header 索引过滤）/ `setTitle(title)` async mutate / `attachSession(sessionId)` async（header cwd 校验 + canonical 匹配） / `insertSessionBefore(sessionId, beforeId?)` async（`WorkspaceMoveInvalidError`）/ `detachSession(sessionId)` async / `status()` async → `'ok' \| 'missing-dir'`（fs stat）。

**事件面：零。** 全文件无 `ctx.on/emit`、无事件 dispatch、无 client 事件。时序契约 = Cordis Service 生命周期：`[Service.init]` 等待 `storageDomain` + `sessionPersistence`（inject），完成一次性 history bootstrap 与 live session 索引后才 active；所有异步 mutation 经 `operationTail` 串行队列；durable 写入统一 `updatedAt` 盖章后原地换 entity 快照。

**错误面：** `WorkspaceMoveInvalidError` / `WorkspaceUnknownSessionError` / `WorkspaceOrderInvalidError`（具名 class，`name` 稳定）；其余 reject 为 plain `Error`（如 create 的 ENOENT、attach 的 cwd 校验失败、order 引用缺失）。

**持久化面：** `ctx.storageDomain.open(workspaceDomainSpec)`（exported spec：domain `name: 'workspace'`、`version: 2`、global 状态含 `initialized/workspaceIds/archivedSessionIds/pendingMutation`、表 `workspaces`（`workspaceRecord`：path/title/sessionIds/createdAt/updatedAt，zod 校验））；`open()` 对已开 domain 抛 `already-open`；facility `get(name)` 可拿已开 domain（诊断面，不用于替代行写入——见 (c)）。

**client 半面（capability-strategy §10 六问）：** ① manifest：package.json 无 `dsh.client` 字段 ⇒ 否；② remote namespace：无 ⇒ 否；③ slot/settings bridge：无 ⇒ 否；④ host↔client 版本协商：无 ⇒ 否；⑤ browser-side state/reconnect：实现全为 node:fs/storage-domain，无 ⇒ 否；⑥ client-facing event/service：事件面为零 ⇒ 否。**六问全否 ⇒ host-only**（不建 client bundle，R7 不适用）。

### 三项可复刻性判定

**(a) 官方行整面可复刻：PASS。** 服务面/entity 面/零事件面/错误面/时序面全部可枚举（上表）。实现路径 = **组合（composition）而非重写**：替代行 apply 内实例化官方 `WorkspaceRegistry`（与已交付 `packages/session-branch` 对官方 SessionStore 同一模式），再以逐成员 1:1 委托 delegate 换入 `ctx.workspaceRegistry`——契约保真由委托保证，不是再实现。官方 import 面（R3）：第三方 `import '@deepseek-ai/dsh-workspace'` 仍解析官方原包；替代包内部 import 官方导出（`WorkspaceRegistry`、`workspaceDomainSpec` 等）用于组合。

**(b) workspace 受管 mutation 流经被替代服务、capture point 可取得权威状态：PASS。** 组合模式下官方实例就是 service 本体，全部 mutation（create/delete/insertBefore/archiveSession + entity setTitle/attach/detach/insertSessionBefore）继续流经被替代行的实现本体，串行队列与 durable 写入语义原样保留；capture point 通过官方面只读投影即可取得权威状态：`list()`（order + entity 字段）+ `archivedSessionIds` + 逐 entity `status()`（fs 目录状态）。无私有状态访问。capture 语义 = registry 当前 committed 缓存视图（所有 mutation 先 durable 提交后换缓存快照，且经队列串行 ⇒ 读到的是一致提交点）；任一项读取失败 ⇒ 逐组件 status 如实 `partial`/`unavailable`。

**(c) 快照应用路径可逆或可 fail-closed：PASS（fail-closed，官方 API 重建路径）。** 判定依据：

- `storageDomain.open()` 对已开 domain 抛 `already-open`（官方 registry 已在 init 打开 `workspace` domain）；facility 的 `get(name)` 虽可取得已开 domain 句柄，但**直接写 domain 会使官方 registry 的内存 entity/state 缓存失同步**（其缓存仅在自身 mutate/recover 后更新）⇒ 明确不采用直接 domain 写入。
- 采用 **fail-closed 官方 API 重建**：apply 按快照经官方 registry 公共 API 逐项重建——`insertBefore`（order）、`setTitle`（title）、`attachSession`/`detachSession`/`insertSessionBefore`（sessionIds 成员与顺序）、`create`（同 path 幂等复用既有 id ⇒ captured 时存在的 workspace 身份保留）、`delete`（快照之外的多余 workspace）、`archiveSession`（archive 集合增项）。全部写入经官方队列 ⇒ 无缓存失同步、无旁路、无双跑。
- apply 前置（fail-closed）：必须携带 restore operation 的 fencing（`fencingToken` + `generation`），否则 `denied`；state 必须为合法快照形状；registry 必须已启动。**注意：apply 是恢复语义（回滚捕获后的变更），前置校验不要求当前状态等于快照**——修订本 probe 草案早期表述。
- 不可经官方 API 表达的组件**如实 fail-closed / partial，绝不伪装**：① archive 集合只增不减（无 unarchive 公共 API）⇒ 快照 archive 集与当前不等（当前有多余归档）时该组件 restoreability `partial` / `unavailable`（原因注明），slice 级 `partial`；② 快照中的 workspace 在捕获后被 `delete` ⇒ 身份已消灭，以新 id 重建会破坏血缘 ⇒ 该记录 restoreability `unavailable`（原因注明），不重建；③ 目录缺失（`status() === 'missing-dir'` ⇒ create 的 realpath 会 ENOENT）⇒ 该记录 `partial`/`unavailable` + 原因。
- 每组件经官方 API 调用本身原子（官方队列串行）；组件级结果如实聚合，绝不虚构组件。

**判定：probe PASS ⇒ 交付 workspace snapshot slice 包（packages/workspace）**；capture-point 与 restore-path（fail-closed 官方 API 重建）作为 delegate 的加法接口；restore-path 首次真实驱动在批次 B restore authority。

### 1.2 durable 记录设施绑定 probe（结论）

- 绑定底座 = facade 既有薄存储绑定设施（`lib/storage-binding.js` 模式）：经 `ctx.storage.domain`（官方 `dsh-storage-domain` facility）开 owner-scoped 单档 scope unit，schema envelope（schema id + 整数 version + owner + scope + name），typed 失败映射（`backend-not-found` ⇒ `backend-unavailable`、`version-mismatch` ⇒ `unsupported-schema`、`already-open` ⇒ `conflict`）。
- checkpoint record store = facade 内部两个 unit：`session`/`workspace` 各一（owner label `checkpoints`、name `records`、schema `executions.recovery.checkpoints.session|workspace`、version 1、表 `records`（key = checkpointId）+ `keys`（captureKey 去重索引））。
- backend 缺失（headless 无 storage 行）⇒ `create` typed `unavailable`；list/inspect/plan 与 availability 不受影响；schema/decoder 归 facade（本线 modules）。
- **判定：PASS，绑定固定为上述底座。** 注：官方 storage 行（storage/storage-json/storage-domain）同为 dsh-web-app patch 的 web-profile insert 行；headless 下后端缺失属正常装配差异。

## 结论与降级登记

1. 1.1 PASS、1.2 PASS ⇒ 进入任务 8 全量实现；若后续实现中上述任一证据被推翻（如官方包升级破坏组合契约），按 Req8 AC5/AC11 降级：不产出替代行、`workspace-snapshot` source unavailable、官方契约行为照常，并在此追加证据。
2. 降级分支登记（当前未触发）：probe 失败 ⇒ 替代行不产出（官方行保持原样）；`workspace-snapshot` source 在 availability/create 中 typed unavailable；绝不留下「官方行 disabled + 无工作替代」空洞。