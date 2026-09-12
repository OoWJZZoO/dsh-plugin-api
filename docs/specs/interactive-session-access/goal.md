# Stage 0 Goal: interactive-session-access

> feature_name: `interactive-session-access`
> milestone: M10
> status: Stage 0 Goal 提交用户批量确认（2026-09-12）；Requirements / Design 未开始
> 输入溯源：M10 工作纲领 §3.9（OBS-09、OBS-12）；观察报告 §5 OBS-09/OBS-12 与 §3 样本导航（remote-web-ui mobile channel、auto-continue、chat-recovery、TUI、notification）；canonical registry `services.apiProxy`、`sessions.channels.*`、`sessions.activity.*`、`attention.*`、client `sessions.request/cancel` 现状；M9 已交付合同与 ANY-MAINT-01/02 接线修复记录（纲领 §5）。

## Goal

让 browser 插件、独立 Web/手机页面与 host/TUI 可以**只消费公开运行时契约**实现完整会话交互：session 创建/列表/历史/打开恢复、发送/取消、候选模型查询与目标 session 模型/effort 切换、pending approval/question 的受限视图与应答、事件基线/增量/断线重连、原始消息/附件 payload 贯通——不依赖官方 private ApiProxy/mux 状态，不要求插件理解官方私有 RpcId/schema。

主面按行为拆分：请求操作（operation）、待处理交互资源与只读流为独立 owner 的面，共享既有 sessions authority；不新增第二套 request/activity 状态机。具体拆线在 Design 决策，本阶段不批准具体 path。

## Why

OBS-09 证实：`dsh-remote-web-ui` 的 mobile channel 直接使用 `apiProxy.events.mux` 并调用 sessions/workspace/agentPresets 多个操作（模型列举/选择、create/history/search/prompt/rename），mux 客户端涉及 approval/question 等 server request。当前门面 `services.apiProxy` 只有 downloads/respond（respond 是既有回答入口，不能写成完全没有回答能力）；`sessions.channels` 观测 session 事件，但不等价于全部官方 mux 请求与基线；client 根 sessions 只有 request/cancel；`connection.rpc` 是固定 unary wrapper。OBS-12 残余已登记归本线：`message.attachmentRefs` 的 durable content block 映射当前 fail-closed；「恢复后续跑」语义待正式定义。M9 已交付 request/cancel/activity/attention/channel 与 operation status/observe（ANY-MAINT-01 修复接线、ANY-MAINT-02 修复自描述），是本线的既有基础而非重复建设对象。

## Scope direction

- 按真实样本列举行为清单：session 创建、列表、历史/搜索、打开/恢复、发送/取消、必要的排队/steer 更新；已有 services/operation 可完成的复用，不笼统新建一个 sessions 平台。
- 模型交互：候选模型查询、改变目标 session 当前模型/effort；保存的选择与本步实际 route/prompt snapshot 一致（与 scoped-agent-contributions 共同验收），跨模式恢复不漂移。
- 待处理交互：取得 pending approval/question 的受限视图，提交匹配答案/拒绝/取消；`services.apiProxy.respond` 可作底层，但不要求插件管理官方私有 registry；复用既有 approval/userQuestions authority，不代答。
- 事件与重连：事件基线、增量、断线重连、错过事件、请求与 operation 的 identity 关联；不因 client API 持有空对象就报 active（维持 M9 自描述修复后的诚实降级基线）。
- payload 贯通：原始消息/附件/source/provenance 不静默缩成纯文本；新 message kind 若超既有合同由本 feature 正式定义（含 attachmentRefs durable 映射的兑现）。
- 认证与授权分开：target/device/session/owner 各自表达；连接可达不等于有权限；维持官方 loopback/trusted-host 边界，不把远端 pairing cookie 自动当作全局授权。
- 通道方向：复用 connection、api-remotes、client-runtime、channel 的既有 owner；真实缺口必要时协调 R slice，组件唯一 owner 与完整 client 半面不变；最终协议可不同于官方 mux，只要消费者行为与身份/重连语义等价。

## Boundaries

- 不写新的前端框架，不复制整套 ApiProxy，不强制第三方采用官方 UI primitives。
- 不吞并通知/attention 呈现逻辑与各产品 UI 业务。
- 不重复 M9 已交付合同的接线修复（归 ANY 维护）；本线只定义扩展交互。
- 不建立第二套 request/activity 状态机；不旁路既有 approval/userQuestions/attention authority。
- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Expected result

无官方业务 API 依赖的交互测试客户端可以：建立 session、切换模型、发送含附件输入、接收 stream/operation 进度、处理审批与提问、取消、断线重连、恢复历史；两个客户端并发、旧答复、旧 owner、旧 epoch 场景正确；官方 browser 插件与独立客户端互操作。验收不能以只测 unary RPC 或源码有 export 通过。

## Stage boundary

本文件只确认 Goal 方向，不批准具体公共 path、channel 协议、message kind 合同或 R 点位。Requirements 应按真实样本把行为清单、认证/授权、重连语义与 payload 贯通写成 EARS，并记录 client 半面判定；Design 再确定面拆线、既有 owner 复用矩阵、协议取舍、attachmentRefs 映射与 R 点位（若有）。
