# 可见性与脱敏标准（visibility & redaction）

> 适用范围：任何 feature 暴露给模型 / UI / 日志 / debug 的语义（execution 诊断、usage、route reason、attachment metadata、error detail 等）。
> 权威性：Stage 0 共同问题 NO.5 的综合落地（2026-08-21 确认）。
> 关联：提升可见性的 policy 面契约见 `api-shape.md` §1；最小暴露不影响 fail-safe（AGENTS.md）。
> 增补：**§4 client 半身受众**（由 `plugin-profile-management` Stage 4 配套交付增补；威胁模型清单见
> `docs/specs/plugin-profile-management/client-threat-model-checklist.md`）。

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

## 4. client 半身受众（browser-half audience）

> 由 `plugin-profile-management` 增补（2026-08-25）。浏览器半身（client bundle）
> 的可见性语义独立于 host 受众，且默认更保守——浏览器不是可信环境。

- **默认最小暴露（client）**：client 侧渲染只呈现 UI 受众字段；secret 值、
  内部 diagnostic、异常 cause、未脱敏日志**永不进入浏览器产物**。与 §1 的
  host UI 受众相比，client 默认可见面更窄：host UI 受众仍可能出现在
  diagnostic 日志中，而 client 产物按最小可运行面裁剪。
- **client 提升通道**：与 host 一致——唯一通道是非 secret 的显式可见性
  policy；secret 提升必须由用户/profile policy 决定且默认禁止。client 侧
  不得存在可绕过该策略的旁路（例如把 secret 塞入 generic 字段、console、
  或 `remote` 消息负载）。
- **跨半身契约**：host 向 client 下发的投影（snapshot/payload）必须在 host
  侧完成脱敏后再序列化；client 侧二次校验形状但**不再承担脱敏责任**
  （host 脱敏失败 ⇒ fail-closed，不发未脱敏负载）。
- **展示包络**：client 展示必须遵守 redaction 包络——XSS 在 DSH 中视为
  Agent 权限提升，任何能注入页面上下文的漏洞都可升级为对 agent 数据的
  读写；因此 client 对危险 sink（`eval`、不安全 innerHTML 模式、通配
  postMessage）执行机械校验并共享 warning 词汇（见
  `docs/specs/plugin-profile-management/client-threat-model-checklist.md`）。
- **威胁模型清单**：面向第三方开发者的逐条自检清单、机械校验词汇与判定
  边界统一收于上述清单文档；本册只登记受众规则。
