# Client-Half Threat Model Checklist (plugin-profile-management)

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.profile`（`inspect`/`health`/`planDiff`/`apply`/`snapshot.*`） | `pluginApi.profiles`（叶子名不变） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本清单的威胁模型结论。

> 配套交付（authorized design KDD #7）：面向第三方开发者的 client 半身威胁模型清单，
> 由 profile 校验管线的机械校验 warning 词汇（`CLIENT_WARNING_CODES`）与本清单共同承载。
> Warning 词汇与执行器 `runClientHalfCheck` 共享同一份词表：`eval` /
> `unsafe-inner-html` / `wildcard-postmessage`。

## 核心假设：浏览器不是可信环境

- 浏览器端（client bundle）运行在用户的浏览器上下文里，任何输入都可能是攻击者
  构造的；**永远不能信任 client 侧输入**作为安全边界。
- **XSS 在 DSH 里等价于 Agent 权限提升**：一个能在页面上下文执行任意脚本的漏洞，
  可以读取/改写 agent 的会话数据、伪造上屏事件、向 host remote 发出任何该 client
  已注册权限的调用。
- client 代码经过 `dsh.client` 清单装载；装载即执行。任何能影响浏览器产物内容的
  供应链缺口（依赖投毒、构建替换、未校验的 hot reload source）都具备相同的
  agent-权限提升后果。

## 机械校验词汇（与校验管线共享）

| warning code | 含义 | 为什么危险 |
|---|---|---|
| `eval` | 直接 `eval(...)` 调用 | 字符串到代码，输入可控即 RCE；`new Function` 同族 |
| `unsafe-inner-html` | `innerHTML`/`outerHTML`/`insertAdjacentHTML` 赋值 | 直接把输入拼接进 DOM 即注入点；只用 textContent/受控渲染 |
| `wildcard-postmessage` | `postMessage(msg, '*')` | 任意 origin 都能收到消息；目标 origin 必须显式白名单 |

机械校验的判定边界（authorized requirements）：

- **阻断（blocking）**：语法错误、禁止的 import 边界（client entry 引用 node
  内置模块）、`dsh.client` 清单一致性失败 → 校验 verdict fail；
- **不阻断（warning）**：上表危险 sink 启发式 → 写入 `clientWarnings`，**不否决
  boot**；
- 机械校验**止步包层**：不做浏览器运行时行为验证（不在设计范围内）。

## 开发者自检清单（发布 client bundle 前逐条过）

1. 是否确认了所有展示内容符合 `visibility-and-redaction` 的 redaction 包络
   （secret 永远不出现在 client 侧渲染，除非经显式 policy 提升）？
2. client 条目是否有任何 `node:` 内置模块 import？（阻断项，必须为 0。）
3. 全局搜索 `eval`、`new Function`、`innerHTML`、`outerHTML`、
   `insertAdjacentHTML`、`postMessage`：命中项是否都有显式审查与白名单？
4. `postMessage` 的 targetOrigin 是否从不使用 `'*'`？
5. `dsh.client` 清单（platform/inject）是否与打包出的浏览器产物一致？
6. 任何会执行拼接字符串/模板注入的路径是否都经过转义或受控渲染？
7. 从 host remote 接收的数据是否在 client 侧二次校验形状（永远不假设 host 已
   净化）？
8. 变更是否经过 `pluginApi.profile` 校验管线（含本机械校验）后落地？