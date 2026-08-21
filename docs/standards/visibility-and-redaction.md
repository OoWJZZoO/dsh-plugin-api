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

## 2. 显式提升（唯一通道是 policy）

默认不可见的内容只有经显式 policy 才可提升可见性，例如：

- 某些 route reason 可进入模型（route 决策 policy 显式放行）；
- 某些 attachment metadata 可进入 UI；
- 某些 error detail 可进入 debug mode。

## 3. 约束

- 提升可见性的 policy 本身遵循 `api-shape.md` 的 policy 面契约（纯函数、输入显式传入）；最小暴露仍为默认，policy 只能收窄之外显式放宽，不得反过来要求"除 policy 外全开"。
- 脱敏不是简单的"去掉关键字"：二进制、嵌套对象、日志、异常 cause、MCP resource 等都需定义覆盖范围；feature design 必须写清脱敏覆盖边界。
- 可见性声明是 API 形状的一部分：feature 的 requirements 必须逐条标明受众（模型可见 / UI 可见 / diagnostic 可见 / redacted）。