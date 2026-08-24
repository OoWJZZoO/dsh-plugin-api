# Stage 0 - Goal

## Feature Name

`attachment-pipeline`

## Status

Stage 0 Goal 已由用户确认；本 feature 已明确批准按 R 类 replacement 推进。

## Goal

为第三方插件提供统一的附件摄取、校验、转换、投影、读取和清理契约，把 image-only workaround 扩展为可追踪的多模态输入管线。每个附件应有稳定 identity、digest、媒体元数据、owner 和 generation，并能保留从原始来源到转换结果再到模型请求投影的 provenance。

该能力把“附件是什么、当前哪一代、是否仍可读取”与“目标 route 是否接受该 modality”分开：附件管线负责资源生命周期与内容投影，`llm` admission/route policy 负责请求决策。

## Scope Boundary

- 包含：从文件、浏览器 paste、data URI、远程资源或 MCP resource 摄取附件；稳定 identity/digest；媒体类型与尺寸元数据；受策略约束的 transform；面向目标 route 的 content projection；signal-aware open、resolve、retention cleanup 与 provenance 查询。
- 必须覆盖大小、像素/时长、deadline、并发、路径变化、缓存隔离和不可信来源；文件路径不得成为附件 identity，原始内容与转换内容必须可区分。
- R 类唯一官方组件 owner 锁定为 `@deepseek-ai/dsh-attachment-local`，目标官方 row 为 `attachment-local`；replacement 必须完整保留该行通过 `@deepseek-ai/dsh-attachment` 提供的 `ctx.attachments` 服务、配置、持久化、完整性验证、错误与取消语义，再增加 attachment pipeline capability slice，不替换任何官方 package import 面。
- image admission 仍是上层 `llm`/route policy；本 feature 不把 modality 准入、模型选择或 approval 决策塞入存储层。
- 不包含修改官方包文件、自动发送附件、任意路径访问、把压缩结果冒充原始附件、跨组件 replacement、支付/账单或客户端 UI。

## Expected Result

session event、request transform、usage ledger 和 UI/日志消费者可以引用同一个 attachment identity，而不是重复传递路径或自行猜测来源。附件缺失、校验失败、文件变化、转换超时或 generation 失效时，系统明确返回 unavailable/error 并安全清理，不继续静默使用过期内容。
