# dsh-plugin-api

DeepSeek Harness 社区插件 API 门面：把官方 Cordis 扩展点稳定化，给第三方插件一个统一、受支持的 import/inject 入口。

> 当前状态：M0 基础（`plugin-api-foundation`）已实现——`ctx.pluginApi` 服务、分层 fail-safe guard、双向版本协商，以及首个 feature `llm/admission`。

## 推荐用法（supported）

第三方插件默认通过门面消费稳定 API：

```js
export const inject = ['pluginApi']

export function apply(ctx) {
  if (!ctx.pluginApi.isActive) {
    // 门面 core 自检未通过，安全停用自己
    return
  }
  ctx.pluginApi.assertCompatible('0.1', 'my-plugin')
  // 使用门面 feature API，例如 ctx.pluginApi.llm.admission.register(...)
}
```

门面提供：

- `ctx.pluginApi.isActive`：门面核心是否通过自检（`false` 时其余 API 会抛出 inactive 错误）。
- `ctx.pluginApi.features`：各 feature 的启用/禁用快照，例如 `[{ name: 'llm/admission', isActive: true }]`。
- `ctx.pluginApi.assertCompatible(requirement, pluginName?)`：插件对门面的版本协商；不满足时抛出 `PluginApiVersionError`，插件应捕获后自行 fail-safe。

## 逃生舱（unsupported escape hatch）

第三方插件**可以**绕过门面直接 `import` / `inject` `@deepseek-ai/dsh-*` 内部包。门面不拦截、不 patch、不 block 这种直连。

但该路径是 **unsupported**：

- 无兼容承诺；官方内部包变化时可能直接破坏你的插件。
- 不受门面版本协商与 fail-safe guard 保护。
- 风险自担。只有在门面尚未覆盖的命名空间上，才建议临时走逃生舱，并计划迁移回门面 API。

## 加载顺序

`dsh-plugin-api` 必须在第三方插件之前加载（`cordis.patch.yml` 已声明对应 row），否则依赖 `inject: ['pluginApi']` 的第三方插件会 pending 并杀死 boot。

## 测试

```bash
node --test
```
