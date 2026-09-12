# Stage 0 Goal: credential-mutation-contract

> feature_name: `credential-mutation-contract`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）。Goal 于 2026-09-11 获批（M10 批量确认门）；Requirements 与 Design 2026-09-12 同批交付。
> 输入溯源：M10 工作纲领 §3.6（OBS-06）；观察报告 §5 OBS-06；M7 deletion report B4-5 批准记录与「后续 B 类接口义务」；canonical registry `services.credentials` 现状（仅 resolve/describe）与 `credentials/updated` 事件登记。

## Goal

兑现 M7 删除 `services.credentials.set` / `unset` 时登记的功能义务：为受权操作方提供受约束、可追溯的受管凭据创建/更新/删除面，使其能够按 ref 写入或清除凭据，并与既有 resolve/describe 读面、模型/provider 请求的真实取值形成完整闭环——而不是借插件私有 storage、直接写配置文件或泛化 settings 写入旁路共享凭据 authority。

主公开面是 mutation（受控状态写入，官方 credentials provider 持有存储权）；resolve/describe 既有读面继续承载查询。最终公共 path 在 Design 中依总树一致性确定，本阶段不批准具体 path。

## Why

官方 `dsh-credentials` 服务保留写入 seam（冻结 runtime 类型含 `set(ref, value): Promise<void>` 与 `unset(ref): Promise<void>`），但裸 setter 在 M7 被删除（B4-5，人类逐项批准），并登记了「后续须提供可追溯、可记录封装接口（含安全/脱敏）」义务。当前门面只剩 `resolve/describe`，真实消费者 `dsh-vision-toolkit` 的设置页（`src/web.ts` 校验 revision/ref 后调用官方 `credentials.set` 保存用户 API key）无法经受支持路径迁移。缺少的是凭据提交动作，不是 credentialRef 类型。

## Scope direction

- 受控写操作：按 ref 设置/更新/删除凭据；ref 与当前配置关联的校验先于副作用；写入成功以真实持久化为准。
- 并发写入冲突显式：ref/revision 被并发改变时拒绝（并发策略与冲突码在 Design 声明），不得 silent last-wins。
- 成功后可见状态发布：真实持久化完成后状态可见（复用官方 `credentials/updated` 事件 authority 或其投影，不另造第二套事件体系）；后续 provider 请求读取到新值；unset 后按官方层级解析。
- 写失败保持原值：部分失败不得留下半提交状态。
- secret 的输入、存储、输出三个方向分开设计：允许受权用户在 client 端输入新凭据并提交（经由插件自身 remote/受权路径到达同一 credential authority）；host 侧查询、错误、日志、RPC outcome 与快照不得回显 secret 值；审计只记录必要元数据（ref、时间、owner、结果），不记录值。
- 通道方向：官方服务 seam 存在，按受控包装稳定化（方案一门面转译）；本 feature 不涉及 R slice 评估。

## Boundaries

- 不新建密钥管理后端、加密平台或 SDK 凭据类；官方 credentials provider 仍是唯一存储 authority。
- 「不得向 UI 输出 secret」不构成取消正常凭据录入功能的理由：录入方向（client → host）与回显方向（host → client）是两个不同的数据方向，本 feature 只开放前者。
- 私有 storage、直接写 `.env`/配置文件、泛化 settings 写入不替代本面。
- 不拥有 settings、storage、visibility 领域；脱敏边界遵循 `visibility-and-redaction.md` 标准。
- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Expected result

`dsh-vision-toolkit` 设置页的保存行为可经公共路径等价迁移并真实生效：保存后后续 provider 请求读取新值；并发修改被拒绝；只读 backend/unavailable、重复写/删除、失败保持原值各有诚实呈现；全链路（日志、RPC outcome、异常 cause、快照）无 secret 泄漏；remote 权限不因该面扩大。

## Stage boundary

本文件只确认 Goal 方向，不批准具体公共 path、结果码、事件形状或审计字段。Requirements 应把写入/更新/删除、校验、并发、可见状态、失败保持与脱敏写成 EARS；Design 再确定 namespace 放置、官方绑定、client 输入路径（若需公共 client 半面）、事件复用与审计载体。
