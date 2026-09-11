# Stage 0 Goal: session-permission-preset-control

> feature_name: `session-permission-preset-control`
> milestone: M10
> status: Goal approved（2026-09-11，M10 批量确认门）；Requirements 提交确认中（2026-09-11）；Design 未开始
> 输入溯源：M10 工作纲领 §3.5（OBS-05）；观察报告 §5 OBS-05；M7 deletion report B4-4 批准记录与「后续 B 类接口义务」；canonical registry `services.permissionPresets` 现状（仅 current/resolve/optionOf）。

## Goal

兑现 M7 删除 `services.permissionPresets.set` / `selectFor` 时登记的功能义务：为受信操作方提供受控、可追溯的目标权限预设选择面，使其能够查询可用预设、为明确目标选择预设，并使官方权限判定、状态投影与真实工具审批行为随之一致变化——而不是在门面登记一条平行 policy，或用一次 approval 放行冒充预设切换。

主公开面是 mutation（受控状态写入，官方 preset authority 保留）；预设查询与当前选择读取是只读面。最终公共 path 在 Design 中依总树一致性确定，本阶段不批准具体 path。

## Why

官方 `dsh-permission-presets` 服务保留写入 seam（冻结 runtime 类型含 `set(session, name)`），但裸 setter 在 M7 被删除（B4-4，人类逐项批准），并登记了「后续须提供可追溯、可记录封装接口」义务。当前门面只剩 `current/resolve/optionOf` 读面。观察报告明确：本轮样本中直接 setter 调用的消费者证据弱于 Plan Mode，本 feature 不伪造消费者；立项依据是 M7 人类裁决这一已登记义务本身。因此验收必须证明官方 preset 状态与真实执行判定变化，而非只新增门面自有登记。

## Scope direction

- 受控选择操作：指定目标（目标语义以官方 `set(session, name)` 真实签名为准）与预设名执行选择；包装官方服务，补齐 owner 归因、审计记录与冲突语义；不恢复裸 setter。
- 预设查询：可用预设集合、每个预设的必要描述（不含敏感实现细节）与当前生效选择可读；读面与写面同源。
- 必要的目标继承/覆盖语义（预设如何在目标间继承、一次选择如何覆盖）以官方语义为准，在 Design 中明确；不在门面另造继承规则。
- 提交前置检查：authority/scope 检查先于副作用；未知预设名、失效目标与越权提交返回 typed 结果，不静默回退默认预设。
- 实际官方选择状态变化可验证；读取、事件与真实工具审批行为三者一致，不得只改门面自有登记。
- 并发冲突显式：多个调用方同时选择同一目标有确定结果（composition mode 与冲突规则在 Design 声明）。
- 官方 preset 的判定权保留在官方 authority；门面不复制、不重排、不覆盖预设内部判定逻辑。
- 与 Plan Mode 正交：模式与预设独立组合，各自唯一 owner；一个的切换不得暗示或带动另一个。
- 若存在多条受支持写路径（含远端/受权 UI 路径），统一收敛到同一 authority 或显式互斥（authority closure），不得只协调新 API 一条路径。
- 通道方向：官方服务 seam 存在，按受控包装稳定化（方案一门面转译）；本 feature 不涉及 R slice 评估。

## Boundaries

- 不建立通用 IAM 或权限管理平台；不新增官方预设之外的授权档位。
- 不通过任何高优先级 hook 自动绕过用户/profile 的拒绝；低信任 client/remote 不得借该面扩大自身权限。
- 选择预设、一次批准（approval）与注册 security policy 是三种不同行为，不在本 feature 内混义。
- 不拥有 approval、security、planMode 领域；只消费它们的既有公开面。
- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Expected result

受信操作方可以通过受支持路径查询并为明确目标选择权限预设；官方判定、状态读取与真实审批行为随之一致变化；并发、失效目标、越权提交有确定拒绝；审计记录 who / what / when / 目标 / 结果。低信任端不能借该面提升权限；Plan Mode 与预设可独立组合切换。

## Stage boundary

本文件只确认 Goal 方向，不批准具体公共 path、预设描述字段或冲突码集合。Requirements 应把查询、选择、前置检查、一致性、并发与失败写成 EARS；Design 再确定 namespace 放置、官方绑定、多写路径的 authority closure 与审计载体。
