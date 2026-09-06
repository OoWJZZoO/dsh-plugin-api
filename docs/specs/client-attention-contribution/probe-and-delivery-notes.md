# Probe And Delivery Notes

> feature_name: `client-attention-contribution`
> milestone: M9
> status: Stage 4 终审修订制品。记录契约 probe 结论、官方转发机械归属、attention 送达三条 seam 的集成波归属与浏览器端 feed 接入点，以及 `__DSH_BOOT__`/HMR 验证范围的限制声明。

本文是 Stage 4 终审 MINOR-1/MINOR-3 的就地落盘（tasks.md 9.2/7.4 引用本文）。

## 1. Contract probe 结论

两个 R slice 的契约复刻可证明性由各 slice probe 门控（tasks 3.1/4.1），结论如下：

- **api-remotes（官方 `@deepseek-ai/dsh-api-remotes`，web 行 `api-remotes`）**：probe 全部通过。官方 host 半面 = 11 事件转发白名单常量（`API_REMOTE_FORWARDED_EVENTS`）+ Remote Agent/Session identity BFF + 空 `apply`；官方 client 半面 = `dsh.client` manifest（inject `[dsh-api-gateway]`）+ 5 个硬编码 remote 贡献。全部可整行复刻（parity fixture 门）。BFF 与常量逐项与官方 1:1 断言；`$on` 合法键集保持复刻后的 11 键，`attention/update` 扩展键经替换模块自身复刻转发路径送达 browser runtime，三方消费者经 `ctx.pluginApi.attention` 获取。
- **client-runtime（官方 `@deepseek-ai/dsh-client-runtime`，web 行 `client-runtime`）**：probe 全部通过。官方 host 入口 = 空 `apply`（6 行）；浏览器模块契约（slots/slots/changed、conversationEvents、conversationViews、connection/reset、sessions/workspaces reflect）+ `dsh.client` manifest（inject `[dsh-client-connection, dsh-typert-registry, dsh-api-remotes]`）可整行复刻；浏览器 attention runtime 以替换模块自身内联状态机承载。

## 2. 官方转发机械归属（偏离记录）

- 官方 11 事件白名单的 **host→browser 转发机械**实际位于 `dsh-host-apiproxy`（其 import 官方 `dsh-api-remotes` 的 `API_REMOTE_FORWARDED_EVENTS`，把 11 键映射为 `host/remote-event` 帧推入浏览器事件流）。本 feature **不替换** `dsh-host-apiproxy`；官方 import 面（`import "@deepseek-ai/dsh-api-remotes"`）不覆盖（R3）。
- 因此 `attention/update` 投递为 **slice 自持的单一路线**：api-remotes 替换行的 host forwarder 订阅 host hub `attention/update` 产出，以与官方管线一致的 `host/remote-event` 帧形推入浏览器事件流（不建平行私有通道），并做 per-stream audience 裁剪（见 §4 与终审 MAJOR-1 修复）。这与 design §3"同一官方转发机械"字面措辞的路径差别已记录；验收边界（11 键 parity 不动、`$on` 键集不扩大、无双通道、host 脱敏先行）全部由 fixture 钉定。

## 3. Attention 送达三条 seam 与集成波归属

| seam | 现状（本线交付） | 集成波接入点/固定 |
|---|---|---|
| host forwarder 接入 | `packages/api-remotes/lib/attention-forwarder.js`（attach source/stream/snapshot/kind，DI 可测） | apply `resolveSource`/`resolveStream`/`resolveSnapshot` 的 ctx 实接线（`ctx.on('attention/update')`、connection 帧推流、`pluginApi.attention.hubSnapshot(kind)` 别名挂载） |
| browser 端 feed 接入 | `packages/api-remotes/lib/client-src/replacement.js` 注册内部 receiver 通道（`Symbol.for('dsh-plugin-api.attention.receiver')` 的 `subscribe/receive`） | **receiver 通道喂入点留集成波**：把经浏览器事件流到达的 `attention/update` 帧解出后调用 `receive(message)` 的真实接线（依赖连接层帧分发在真实浏览器装配下的入口） |
| client→host 请求通道 | `packages/client-runtime/lib/browser-runtime.js` 的 `send`/`fetchSnapshot` seam；`Symbol.for('dsh-plugin-api.attention.request-channel')` 读入点 | 具体通道入口与 wire revision 集成波固定（design §4；经已交付 session-channel 请求往返面，类型化传输、不排队） |

## 4. Per-stream audience 裁剪（host 边界 fail-closed，终审 MAJOR-1 修复）

- `lib/attention-redaction.js` 的 `buildRedactedItemPayload(item, {kind})`：audience 不含 kind ⇒ 返回 null（无负载产出）。
- `lib/attention-hub.js` 的 `snapshotAll(kind)`：按 kind 逐条裁剪，跨 audience 条目不出 host 边界。
- `packages/api-remotes/lib/attention-forwarder.js` 的 `attach({ source, stream, snapshot, kind })`：per-stream kind 裁剪快照 items 与 delta add/update；remove 只对先前已送达该 stream 的 id 转发（不泄漏跨 audience 存在性）。机械断言见 `test/attention-privacy.test.mjs` 与 `packages/api-remotes/test/attention-forwarder.test.mjs`。

## 5. `__DSH_BOOT__` 装配与 HMR 验证范围限制声明（终审 MINOR-3）

- **结构性验证**（本线已交付）：client 半面以官方模块 id 注册（bundle shape 断言）、wrapper 提供 HMR 重执行路径（模块重执行即替换 stale runtime 并重建投影）。
- **执行级覆盖**（`window.__DSH_BOOT__` 真装配 + 浏览器 HMR 重载 + DOM bootstrap）本线不提供无 DOM harness，**留集成波真装配 fixture 验收**；在真装配验证前，"单一管线语义 + `$on` 11 键不扩大 + bundle 可复现与官方包零修改"维持为验收前置断言。
- 若后续需要执行级覆盖，可将 wrapper 提取为可注入 `globalThis` 的纯函数并补充 HMR 重执行断言（本轮选择声明限制 + 集成波验收口径）。

## 6. 验收前置

集成波端到端验证（Wave 8.7）前，以下断言持续有效并为验收前置：官方 11 事件白名单逐字转发不回归、`attention/update` 不进入 `$on` 键集、无平行私有通道、host 脱敏先行与 per-stream 裁剪 fail-closed、官方包零修改。集成波完成 registry/feature-list/`capability-strategy.md` §5 装配表登记后关闭本文引用项。