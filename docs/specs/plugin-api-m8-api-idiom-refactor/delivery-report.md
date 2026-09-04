# M8 交付报告 — plugin-api-m8-api-idiom-refactor

> 状态：已交付（Stage 4 完成 + 全局终审通过 + tasks.md 全勾）。本报告补记交付轨迹与形状收敛偏差的清零记录，不改变已获批的验收边界。

## 1. 交付轨迹

| 批次 | 提交 | 内容 |
|---|---|---|
| M8 本体（waves 1–8 + 9.4 全局终审 + 9.5） | `2655028` | 公共契约迁移到八个 idiom；registry/能力矩阵/类型/事件语义/错误与生命周期共同收敛 |
| 门面形状收敛批次（ANY） | `d270b02` | `availability()` 统一 `{status, reason?}`、host 侧成员级 isActive 退役主体、145 条已登记迁移翻转、`sessions.views` 重组、skills kind 显式判别、registry 卫生 |
| 收尾批次（ANY，2026-09-04） | `a4cf756` `620d6c6` `5832fbf` `edd9007` `68d1ebd` | 见 §2 |

## 2. 收尾批次：偏差清零记录

对照 `temp/handoff-2026-09-02-facade-shape-rework.md` §6 与 2026-09-02 复核清单：

| # | 偏差 | 处置 | 提交 |
|---|---|---|---|
| 1 | client bundle 无重建工具链，源与检入产物无法安全同步 | 新增 `scripts/build-client-bundle.mjs`（`npm run build:client` / `build:client:check`）与 esbuild devDependency；重建产物与检入 `lib/client.js` 逐字节一致后才动手改源 | `620d6c6` |
| 2 | client 侧 `connection.isActive` / `events.isActive` / `lifecycle.isActive` 残留（源 + 检入 bundle），`officialEventFaces` 死代码 | 删除实现与死代码，重建 bundle（产物 diff 仅含预期的 17 行删除）；8 个测试文件的断言同步（改用读取成员探测与根 `capabilities` 查询） | `5832fbf` |
| 3 | host 侧 `llm.isActive` / `tools.isActive` / `settings.isActive` / `prompts.isActive` 残留 | 删除四处实现；`prompts.contribute` 的禁用判据由成员级标志改为 systemPrompt feature 状态探针（错误语义 `unavailable` 不变）；registry 15 条 `migrationAction` retain→delete，使 subtraction 守恒测试成为守门员 | `5832fbf` |
| 4 | 错误 feature 参数（`settingsRemote`、`officialPassthrough`、`prompts.<member>`） | 统一改用 capability path（`settings` / `prompts`）；行为相同的降级分支合并 | `edd9007` |
| 5 | servicesWhitelist 未扩展 7 键、`services.storage` 未补成员 | 白名单 46→53（`llm` `agents` `sessions` `settings` `prompts` `tools` `recovery` 按 `createServicesMigrateLeaves` 组合顺序追加，storage 成员补全）；validator 新增"迁入 services.* 的目标面必须登记白名单"规则；白名单镜像测试口径同步 | `68d1ebd` |
| 6 | `settings.scope.isActive` 与 `sessions.views` 未登记 | 复核确认前批次已解决：scope 句柄无 isActive 成员；registry `namespaces` 已含 `sessions.views`；`connection.get` 登记与实现一致 | 无需动作 |

## 3. 保留裁决

- 根 `pluginApi.isActive`（host/client）按 7c 裁决保留为 facade 元数据。
- `services.*` 直通面的成员级 isActive（host `services.typert`、client services 面）按 services 命名空间的 availability 豁免语义保留；其契约由 53 键白名单与 client 官方叶子登记承载，不适用 7c 的 availability() 收敛。

## 4. 验证

- `npm test`：2605 全绿（fail 0）
- `node scripts/registry-validate.mjs docs/specs/.../public-contract.registry.json`：registry valid
- `npm run build:client:check`：检入 bundle 与源一致
- `git diff --check` 通过；`/usr/lib/node_modules/@deepseek-ai/dsh/**` 未改动

## 5. 后续接续项

- 官方加载位置（`/usr/lib`）的 client 副本同步：工作区外动作，须人类明确授权后执行；本仓库产物与重建入口已就绪，同步后按 §2.1 的 boot 自检验证即可。
