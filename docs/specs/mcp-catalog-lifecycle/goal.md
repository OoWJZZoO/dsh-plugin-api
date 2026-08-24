# Stage 0 - Goal

## Feature Name

`mcp-catalog-lifecycle`

## Status

Stage 0 Goal 与 Stage 1 Requirements 随 M6 四 feature 批次确认（e8d4e3c）；Stage 2 Design 落地（3278b5c），Stage 3 Tasks 获批（13199a0）；Stage 4 已交付（2294008）并合入 M6 Wave C（merge 4123ab9 / 12c6ce0）；当前为 delivered 状态。

## Goal

为 MCP 工具提供稳定的动态 catalog 与生命周期契约，解决分页发现、异步连接、`list_changed`、断线重连、server generation 替换、旧工具注销、schema 规范化和工具调用身份在多个插件中被重复实现的问题。第三方插件应能观察 server/tool availability，按 generation 获取当前工具定义，并在连接变化时安全地丢弃过期工具，而不是继续静默暴露失效工具。

该 feature 已按用户明确批准作为 `dsh-mcp-client` 官方 loader 边界的 R 类 replacement 推进；Stage 1 只定义可测试需求，runtime identity、完整官方契约复刻和 replacement patch 的具体架构已由获批 Design 落地（见 `design.md` §1 与 feature-list §7 登记）。

## Scope Boundary

- 包含：server 状态与诊断、分页 `tools/list`、`list_changed`、连接 generation、工具原子替换与注销、public/raw name 映射、schema normalization、tool provenance 和断线期间的明确 unavailable 状态。
- 本 feature 采用 R 类 replacement（U16，replacement 为 current workaround）：必须完整复刻被替代官方行的 ctx service/event 面，只增加 MCP 生命周期契约；必须有（且已具备）runtime/package identity matrix、唯一 owner、boot 自检、版本失配局部停用和退役上游提案。
- MCP catalog 负责外部 MCP server 与工具身份；渐进式工具发现、通用 tools exposure policy 和预算决策保持独立 feature。
- 不包含修改官方包文件、覆盖官方 import 面、自动 route/retry、跨组件 R replacement 或 Web UI。
- 所有连接、schema、工具返回值和 pending call 的失败路径必须 fail-safe，不能因单个 server 或工具失效杀死 harness boot。

## Expected Result

MCP 相关插件可以依赖一个明确的 server/tool generation contract，在连接建立、变化、断开和恢复后获得一致的 catalog 与调用身份；官方能力缺失时，系统可诊断地降级，而不是双跑或静默使用过期工具。
