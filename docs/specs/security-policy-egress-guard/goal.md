# Stage 0 - Goal

## Feature Name

`security-policy-egress-guard`

## Status

SPEC1 Stage 0：Goal 待用户确认（M6 第四批次批量确认门，尚未获批）。

## Goal

为第三方插件提供统一的 security policy 门面，把目前分散在各插件私自实现的 approval 决策、结果脱敏与出站（egress）控制收敛为三个可注册、可审计、fail-closed 的策略面。该 feature 回答三个问题：

1. **决策**：一次模型请求或工具执行是否被允许、由哪条策略以何理由决定；
2. **可见性**：工具结果与请求内容中哪些字段对模型、UI、日志分别可见（redaction）;
3. **出站**：子进程、HTTP、MCP、remote channel 的目标是否被允许（egress）。

证据来源：`dsh-secret-redactor` 在 `tools/post-execute` 后递归脱敏 env/SSH password/API key/JWT/private key；`dsh-approve-for-me` 在 `approval/request` 前按 read-only/dangerous 规则 allow/deny/ask；`dsh-system-proxy` 独立处理子进程 proxy export；`dsh-web-ui` 文档记录的明文密码、重连重放非幂等命令与 unredacted output 风险。三者各自为政且互相不感知，是典型的"同一语义被多次 workaround"。

## Batch Order and Dependencies

本 feature 是 M6 第四批次第一个 feature（Wave A，可与同批 `progressive-tool-discovery` 并行推进）。它没有未交付的前置依赖；与已交付能力的衔接方式：

- 消费 `execution-observation` 的 execution identity 标注决策上下文（哪个 execution/session 触发了 decision）；
- 策略自身的失败与 inactive 通过 `plugin-diagnostics` 上报，不改变 fail-safe 语义；
- 对 MCP 工具结果与 attachment 内容的脱敏只定义调用时点（post-execute / request 前），不重复实现其内部管线。

## Scope Boundary

- 包含：`pluginApi.security` 三个面——
  - `policy.register/decide`：tool、session、workspace、route、user approval context 上的前置决策；
  - `redaction.register/apply`：对模型可见、UI 可见、日志可见三种 visibility 分别定义 policy；
  - `egress.check/lease`：subprocess、HTTP、MCP、remote channel 的 destination policy。
- 所有 deny 必须 fail-closed；decision 携带 `policyId`、`reason`、`expiresAt`、`auditId`。
- 覆盖三个时点：模型请求前、工具执行前、工具结果后；多个策略共存时有确定的组合顺序，不互相静默覆盖。
- 不包含：
  - 替代官方 approval loader 行（`approval/request` 官方 dispatch 保持原样，本面是其前置消费者）；
  - 接管系统 proxy 配置——egress 允许策略与"检测到 proxy"是两回事，后者不得被当成前者；
  - regex-only 的脱敏实现承诺——覆盖范围必须定义二进制、嵌套对象、日志、异常 cause、MCP resource 的边界，具体深度在 requirements 阶段定；
  - 横切派发语义（priority / deepFreeze / fault containment）——永不 R 化，也不在本 feature 内重造。

## Classification

B 类门面 + 多个官方 seam 组合（`approval/request`、`tools/pre|post-execute` 等）；横切安全语义不转 R，与 capability-strategy 判据一致。

## Expected Result

第三方插件可以注册一条"拒绝危险命令的 approval 策略"、"对日志隐藏 API key 的脱敏策略"或"禁止子进程访问某网段的 egress 策略"，每条决策可查询、可审计、fail-closed；策略之间有确定组合顺序而不是互相覆盖；策略自身故障只降级自身并通过 diagnostics 可见，不影响宿主 boot 与其他插件。
