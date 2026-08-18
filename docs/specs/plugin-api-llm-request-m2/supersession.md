# Supersession Record: plugin-api-llm-request-m2

> feature_name: `plugin-api-llm-request-m2`
> 状态：Stage 4 交付记录（requirements §10.9 的正式 supersession 声明）
> 日期：2026-08-18（delivery commit）

---

## 1. Superseded contracts

最终交付正式取代以下已命名契约。取代范围**仅限于本文列出的具体条目**；未列出的保证全部保留。

### 1.1 `plugin-api-llm-m1` L1（`llm-image-admission` L1 注册面）

- 被取代：L1 需求中保留 `admission.isActive` 作为准入活跃信号、以及 inactive 时 no-op 注册行为的条款。
- 替换：`pluginApi.llm.admission` 只暴露 `register(policy)`；`featureRegistry.isActive('llm/admission')` 是唯一活跃信号；禁用面同样不暴露 `isActive`。`{ id, match, project }` 意图形状、独立投影 listener、插件自有 `resolveModelInfo` monkey-patch 路径一律拒绝/退役（见 `llm-image-admission` 部分）。

### 1.2 `plugin-api-llm-m1` L8（`pluginApi.llm.stream()` 语义）

- 被取代：L8 中「`pluginApi.llm.stream()` 既不参与新增 `llm/stream` listener、也不在 active compat transforms 观察其不可区分的公开 waterfall 时重派发」的窄化条款。
- 替换（限于 §1 验收标准 8 描述的 compat 行为）：公开 `llm/stream` waterfall 可被 active compat transforms 观察；`pluginApi.llm.stream(options)` 仍保持其公开参数、返回与错误接口（facade 自身不附加 dispatch）。
- 保留：L8 其余全部参数/返回/错误接口保证不变。

### 1.3 `llm-image-admission` Requirements 2、4、7

- 被取代：R2（`{ id, match, project }` 注册）、R4（独立投影 listener / 插件自有 resolver monkey-patch 的迁移路径）、R7（旧 dsh-read-image 迁移）中要求这些 L1 形状与路径的条款。
- 替换：L2 `{ id, match, input: 'image', process, validate }` 政策契约 + 统一 L4 兼容管线（`llm/request` owner）+ scoped gateway。图像投影只经统一 L4 兼容管线执行，无独立 L1 `llm/stream` 投影 listener、无 legacy admission bridge、无插件自有 monkey-patch。

---

## 2. Retained guarantees

下列保证不受 supersession 影响，继续有效：

- **门面基础**（`plugin-api-foundation`）：`ctx.pluginApi` 服务、fail-safe guard、双向版本协商。
- **门面完整性**（`plugin-api-facade-integrity`）：wrap-safety identity guard 与 F0.4/F0.5 权威定义。
- **LLM M1**：`modelInfo`/`prepareCall`/`stream`/L9 注册成员的直通语义（除 1.2 窄化外）；`llm/stream` + `llm/adapters-updated` catalog slice。
- **semantic-hooks M2**：owner-local 收敛、marker、诊断与 A1 事务门契约。
- **事件/工具/agent/session/settings/systemPrompt/services M1**：全部既有 catalog 与服务直通。
- **L2/L4 安全不变式**：任何拒绝路径零原 continuation / 零兼容重入；终端分类 unknown 永不 collapse 为 image-absent；官方拒绝在 gateway 不可用时原样保留。

---

## 3. Replacement contracts (L2/L4)

| 面 | 契约 | 位置 |
|---|---|---|
| L4 transform | `pluginApi.llm.request.transform({ id, mode: 'compat', priority?, apply, isConverged })` → identity-bound disposer | `lib/llm-request.js` |
| L2 policy | `pluginApi.llm.admission.register({ id, input: 'image', match, process, validate })` → identity-bound disposer | `lib/llm-input-policy.js` |
| 终端分类 | facade 权威 `contentHasImage` 扫描；unknown fail-closed | `lib/llm-request.js` / `lib/llm-request-boundary.js` |
| gateway | scoped 官方准入检查放松（confinement proof：scope 归属 + 参数匹配 + 至多一次 + 权威 bypass 排除） | `lib/llm-admission-gateway.js` |
| staged 发布 | `prepareFeature`/`commit`/`rollback` 事务 + `effect → commit → registry.mount` 宿主序 | `lib/plugin-api-service.js` / `lib/index.js` |

---

## 4. C/M4 upstream proposals

最终实现记录两个上游提案（design「Native Upstream Proposals」），在官方 seam 出现前保持 C/M4：

1. **原生 `llm/request` waterfall**：带显式 owner/caller provenance 的公开 request envelope、不可变输入与可替换 continuation、定义明确的取消行为、prepared-call/adapter-registration/routing 保持、声明的 sync/async/full-replacement 边界。
2. **原生 `llm/admission` decision seam**：在官方准入拒绝前与最终 adapter 执行前派发的 scoped request/session context，含目标能力结果、policy 决策协议、终端输入验证点与取消/生命周期所有权。

官方 seam 以所述保真度出现时，门面保留 transform/policy 注册与 disposer 形状，退役 compat re-entry 与 resolver/gateway wrapper。

---

## 5. Migration evidence

- `dsh-read-image` 迁移提交：`6902386`（L2 注册形状）+ `a0ab551`（process/validate 行为断言）。
- 迁移验收：`scripts/verify-guards.sh` 全流程通过（正常/强制失败 headless 冒烟 + dev web 3082）；sibling 单测 30/30；L2 注册形状对真实 profile 门面端到端验证通过。
