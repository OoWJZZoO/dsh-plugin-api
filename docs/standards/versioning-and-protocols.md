# 版本与协议标准

> 适用范围：主包、辅助包、全量聚合包、第三方插件协商，以及真实 wire/durable 合同。
> 关联：能力 presence 与 unavailable 见 `capability-strategy.md` §6.2；公共面减法见 `capability-strategy.md` §7。

## 1. 包版本格式

所有主包、辅助包和全量聚合包使用以下完整版本形式：

```text
<A>-<B>.<C>.<D>
```

- `A`：官方 DSH runtime 的全量 identity，包含 patch、rc/prerelease 等后缀，是 facade/replacement 与外部 runtime 的构建匹配轴。
- `B`：API 协议的向后兼容保证世代，也是最大的 API 版本号。
- `C`：同一 `B` 世代内的向后兼容增量版本。
- `D`：当前包自己的内部实现维护版本，仅区分包内维护发布，不表达新的公共 API 合同。

主包、所有辅助包和全量聚合包共享相同的 `A.B.C`，可以有各自独立的 `D`。`D` 的变化不得改变公共 API 外观、主包与辅助包的装配接口或其他包依赖的已声明内部契约。

## 2. 兼容规则

- 同一 `A.B.C`：公共 API 外观、语义合同、错误模型、owner/scope 和 composition 规则完全一致；不同 `D` 只代表包内维护差异。
- 同一 `A`、同一 `B`、较大的 `C`：必须兼容在较小 `C` 上编写的插件；较大 `C` 可以增加新的 API/capability，因此面向较大 `C` 的插件不保证能在较小 `C` 上运行。
- 同一 `B`、不同 `A`：semantic API 尽量保持同一 `C` 的公共语义和 API 外观；无法适配时报告 capability 不可用，不能静默改变已存在的语义。
- 不同 `A`、不同 `C` 只有在对应 capability 的公共合同确实满足同一 `B` 世代的兼容关系时才能称为向后兼容。
- 如果跨 runtime 的差异动摇公共 semantic API 合同，应通过 capability absence/unavailable、提高 `B` 或删除该 semantic API 解决。

## 3. 包装配与 runtime 检查

- runtime 校验使用 `A` 的全量 identity 精确匹配。任意包与当前安装 runtime 的 `A` 不同，该包自动安全停用。
- 辅助包与主包按 `A.B.C` 做装配兼容校验，三段必须完全相同；不能因为 facade 插件对较大的 `C` 具有向后兼容性，就允许主包和辅助包混装不同的 `C`。
- 辅助包 `D` 可以不同，且不参与主包是否认领辅助包接口的兼容判断。
- 辅助包的 `A.B.C` 与主包不同时，主包不认领该辅助包提供的扩展接口；对应 replacement/辅助能力降级为官方 runtime 对应行为或明确 unavailable，不能静默半装配。
- 降级到官方行为时必须确保不会出现官方行已禁用而替代行又失效的空洞状态；无关辅助包和主包能力不受连带停用影响。

## 4. 第三方插件协商

第三方插件不需要理解 `D`，也不直接使用完整包版本做普通范围比较，主要声明：

```js
requires: {
  api: '>=B.C <next-B',
  capabilities: ['...'],
}
```

比较规则由 facade 实现：同一 `B` 内，实际 `C` 不小于插件要求的 `C` 即可；不同 `B` 不兼容。capability presence 表达可选能力是否提供，不为每个 capability 预建独立版本矩阵。

`A` 仍是插件运行环境的重要事实，尤其在使用 `services.*` 时。门面应说明 `A` 相关限制，但除非 feature 明确提出更强要求，不强制第三方插件把 runtime 绑定写成安装前置条件。

## 5. Wire 与 Durable 合同

内存 API、wire protocol 与 durable record 是三个独立合同层，不使用 package/runtime version 充当 schema version：

| 合同 | 范围 | 最小版本方式 |
|---|---|---|
| In-process API | JS namespace、方法、错误、composition | 全局 API version + capability presence |
| Wire | host/client RPC、remote descriptor、forwarded event | 每个实际协议族一个整数 revision |
| Durable | session event、task/branch/profile/audit 等持久记录 | 每种 record 一个 schema ID + 整数 version |

只有确实跨进程、跨 client 或跨升级留存的数据才引入 schema version。最小 durable envelope 为：

```js
{
  schema: 'sessions.branch',
  version: 1,
  owner: '...',
  scope: { ... },
  id: '...',
  data: { ... },
}
```

规则：

- 新 writer 只写当前版本。
- 已知旧版本确有读取需求时，在 record 附近提供局部纯函数 decoder/upcast，不建设通用 migration 平台。
- append-only event 不重写历史记录；projection reader 按需 upcast。
- 可变记录只有在真实需要时才做显式 CAS/原子迁移，普通读取不得偷偷改盘。
- 未知未来版本返回 `unsupported-schema`，不猜测、不静默丢字段。
- 没有升级读取需求的数据不预建 migrator。
- replacement 只有在实际写入公开 durable 数据时，才需要把 schema/decoder 放到不会随 replacement 退役的位置。
- wire mount/连接只校验实际协议族 revision；无共同 revision 时明确 unavailable，不建设通用多版本协商图或模糊 payload coercion。

不新增通用存储 API、schema registry daemon、数据库迁移服务或跨版本数据框架。

## 6. 安装模式与装配等价性

只提供两种明确安装模式：

```bash
# 默认全量
dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-full

# 选择性安装
dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-main
dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-compaction-events
```

- `@deepseek-ai/dsh-plugin-api-full` 是全量聚合 bundle，依赖主包和全部辅助包，并按确定顺序装配主包及替代行；它不新增第三方 API。
- 全量安装必须与选择性安装（主包加全部所需辅助包）装配出同一组主包行、替代行和行为，不得双跑或改变替代行语义。
- 选择性安装的最小组合是主包；需要某个 replacement 能力时再显式添加对应辅助包。辅助包只作为替代行参与装配，不提供第三方直接 import 的 API 面。
- 全量聚合包和全部辅助包与主包共享 `A.B.C`；不一致时只停用相关辅助能力。
