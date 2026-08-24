# 可见性与脱敏标准（visibility & redaction）

> 适用范围：任何 feature 暴露给模型 / UI / 日志 / debug 的语义（execution 诊断、usage、route reason、attachment metadata、error detail 等）。
> 权威性：Stage 0 共同问题 NO.5 的综合落地（2026-08-21 确认）。
> 关联：提升可见性的 policy 面契约见 `api-shape.md` §1；最小暴露不影响 fail-safe（AGENTS.md）。

## 1. 默认最小暴露

| 受众 | 默认可见性 |
|---|---|
| 模型（prompt / tool 输出） | 看不到 execution 内部诊断等内部语义 |
| UI | 看不到 secret 等敏感字段 |
| 日志 | 只保留摘要（不落全文敏感内容） |

默认值是安全底线，不是生态推荐的最终可见性。对非 secret 的运行诊断，尤其是 harness 故障、route、execution、usage、能力状态和有助于 agent 自诊断的上下文，设计应优先考虑完整、可解释地提供给模型；仍需标明来源、时间和不确定性，避免模型把过期投影当作事实。

## 2. 显式提升（唯一通道是 policy）

任意第三方插件都可以为**非 secret** 信息注册可见性 policy，自主决定是否向模型、UI、日志或 debug 面开放；不要求中央审批。推荐插件对非敏感诊断采取开放策略，特别是面向 agent 自我诊断的内容。

secret 信息也可以由插件提出提升申请，但是否允许必须由用户/profile policy 决定，且该 policy 默认禁止。插件不能绕过该全局禁止策略直接暴露凭据、认证材料、私钥、安全 token 或同等敏感值。

经 policy 提升的内容示例：

- 某些 route reason 可进入模型（route 决策 policy 显式放行）；
- 某些 attachment metadata 可进入 UI；
- 某些 error detail 可进入 debug mode。

## 3. 约束

- 提升可见性的 policy 本身遵循 `api-shape.md` 的 policy 面契约（纯函数、输入显式传入）；非 secret policy 可由任意插件自行决定，secret policy 仍受默认拒绝的用户/profile policy 约束。
- policy 冲突时，用户/profile 对 secret 的禁止优先；对非 secret 内容，插件注册的决定按 feature 自身声明的顺序、priority 和 scope 收敛，不引入中央审批器。
- 脱敏不是简单的"去掉关键字"：二进制、嵌套对象、日志、异常 cause、MCP resource 等都需定义覆盖范围；feature design 必须写清脱敏覆盖边界。
- 可见性声明是 API 形状的一部分：feature 的 requirements 必须逐条标明受众（模型可见 / UI 可见 / diagnostic 可见 / redacted）。
