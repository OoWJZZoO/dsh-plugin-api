# Stage 0 Goal: session-plan-mode-control

> feature_name: `session-plan-mode-control`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）。Goal 于 2026-09-11 获批（M10 批量确认门）；Requirements 与 Design 2026-09-12 同批交付。
> 输入溯源：M10 工作纲领 §3.4（OBS-04）；观察报告 §5 OBS-04；M7 deletion report B4-3 批准记录与「后续 B 类接口义务」；canonical registry `services.planMode` 现状（仅 `get`）。

## Goal

兑现 M7 删除 `services.planMode.set` 时登记的功能义务：为第三方插件提供受控、可追溯的目标计划模式（Plan Mode）切换面，使其能够对明确目标进入/退出官方 Plan Mode、读取实际状态并观察变化，且切换真实影响官方 prompt / 工具 / 执行行为——而不是只翻动 UI 徽标、只改门面自有 flag，或注册一条与官方判定无关的 policy。

主公开面是 mutation（受控状态写入）；实际状态读取与变化观察是同一官方 authority 之上的只读成员。最终公共 path 挂靠最近既有领域并在 Design 中依总树一致性确定，本阶段不批准具体 path。

## Why

官方 `dsh-plan-mode` 服务本就保留写入能力（冻结 runtime 类型含 `set(agent, active): 'committed' | 'queued' | 'cancelled' | 'noop'`），但裸 singleton setter 在 M7 公共面减法中被删除（B4-3，人类逐项批准），同时登记了「功能不删减——后续须提供可追溯、可记录封装接口」的替代义务。当前门面 `services.planMode` 只剩 `get`，真实消费者 `dsh-tianshu-tui` 的模式切换（`src/ui/app.ts` 直接调用官方 `planMode.set(agent, active)`）无法经受支持路径迁移。本 feature 是该已登记义务的兑现与 OBS-04 的主归属，有真实消费者与人类裁决双重依据，不需要凭猜想立项。

## Scope direction

- 受控切换操作：指定目标（目标语义以官方 `set(agent, active)` 真实签名为准）执行进入/退出；包装官方服务，补齐 owner 归因、审计记录与冲突语义；不恢复裸 singleton setter。
- 官方返回的 `committed / queued / cancelled / noop` 等结果必须如实映射为门面统一失败/结果词汇，不得把 `cancelled`、`noop` 伪装成成功。
- 读取实际状态与观察变化：读面与写面同源（同一官方 authority），不得出现两套可能错拍的状态来源。
- 切换必须真实影响官方行为：prompt 装配、工具约束与执行侧看到的模式一致；若提交未生效，必须以显式失败呈现，不得留下「UI 已切换而运行时没变」的分裂状态。
- 可追溯：记录 who / what / when / 目标 / 结果；审计记录的存储档位（session / workspace / profile 三档之一或既有审计面）由 Design 判定，不为 convenience 随意跨档。
- 并发与重复调用有确定结果：composition mode 与冲突规则在 Design 声明；目标关闭期间或不可用时返回 typed 结果。
- Plan Mode 与权限预设是正交状态，各归唯一 owner；本 feature 不拥有权限预设面。
- 通道方向：官方服务 seam 存在，按受控包装稳定化（方案一门面转译）；本 feature 不涉及 R slice 评估。

## Boundaries

- 不建设新的「规划 Agent」产品能力；不新增官方模式之外的状态机或模式档位。
- 不以 security policy、事件伪装或纯 UI flag 替代真实官方状态提交。
- 不拥有 approval、permissionPresets、checkpoint、prompts 等邻近领域；只消费它们的既有公开面。
- 审计不得记录超出必要的内容，也不得把门面自有状态冒充官方状态。
- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Expected result

第三方插件（独立交互前端、TUI、自动化插件）可以通过受支持的受控切换面把目标置入/退出 Plan Mode，读取并观察到与官方一致的真实状态，审计留痕完整；并发、重复、失败、关闭与不可用场景有确定且诚实的呈现。`dsh-tianshu-tui` 的模式切换行为可经公共路径等价迁移，不再直接 inject 官方业务服务。

## Stage boundary

本文件只确认 Goal 方向，不批准具体公共 path、参数形状、结果码集合或审计载体。Requirements 应把切换、读取、观察、结果映射、审计、并发与失败路径写成 EARS；Design 再确定 namespace 放置、官方服务绑定细节、审计载体、composition mode 与失败 containment。
