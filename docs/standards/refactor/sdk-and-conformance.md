# Developer SDK 与 Conformance Kit（后续参考）

> 状态：后续参考，不是当前实现计划，也不冻结包形态、命令名、类型入口或检查规则。
> 适用前提：只有在 API namespace、公共成员减法、版本模型和 composition contract 稳定，并出现真实第三方接入问题后，才重新评估本议题。

## 1. 当前判断

现在预先设计 SDK 容易把尚未稳定的公共形状固化为第二套兼容负担。因此当前不承诺独立 type-only 包、主包 subpath、conformance 命令、lint 规则、contract registry 服务或强制 adoption。

该判断不禁止第三方自行使用现有类型、测试和文档，也不把 SDK 作为 M7 重构的前置条件。

## 2. 未来评估方向

如果真实接入问题证明需要额外工具，可以评估：

- 一个不加载 Harness runtime 的契约入口，复用 `HostPluginApi`、`ClientPluginApi`、manifest、capability、claim、scope 和 typed result/error 的公共类型；
- 轻量 synthetic conformance tests，帮助插件在真实 Harness 之外检查 owner 生命周期、重复注册、冲突、卸载、重载和 callback 失败等共享边界；
- 类型检查负责 API 形状，manifest/preflight 负责声明与实际 capability，组合测试负责多 owner 行为；任何一层都不声称已经证明其他层性质；
- 对 advanced `services.*` 或未声明 capability 使用 warning 和开发期反馈，而不是 sandbox 或完整源码 lint 平台；
- 若未来存在 contract registry，将其作为构建期生成类型、参考文档和测试 fixture 的输入，而不是运行时 registry 服务。

具体采用独立 type-only 包、主包 subpath 或其他入口，留待 API 形状稳定后依据真实消费者和维护成本决定。SDK 的最终存在与范围以实际接入问题为依据，不预先承诺。
