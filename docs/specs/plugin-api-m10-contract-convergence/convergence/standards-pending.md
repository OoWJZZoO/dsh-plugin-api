# standards 待人类确认清单（Standards Pending）

> feature: `plugin-api-m10-contract-convergence`（Stage 4 交付物；Req 12.6/12.7，design §7 S1–S5）
> 纪律：本清单**只登记**，不改写任何分册正文（Req 12.6/12.7）。已由九线同步的条目在此记为「已同步（核对通过）」。

| # | 对象 | design 要求的修订 | 实际状态（Stage 4 核对） | 处置 |
|---|---|---|---|---|
| S1 | `AGENTS.md` §4 第 3 条（事件 API 表述） | 同步为现行事实：公共订阅入口为 `events.observe`，决策参与经领域化 decisions registry，派发动词保留 | **未同步**（`AGENTS.md:178` 仍为成文时的表述） | **待人类确认**；同步前现行事实以 registry 与 M8 migration ledger 为准。与 M8 ledger 第 30 行（侧向参与删除）同属治理张力，**需人类裁决**，不在实现/维护中擅自改写 |
| S2 | `public-api-shape.md` §2 树图与 §7 转译清单 | §2 树图按 registry 现状刷新；§7 settings 桥条目更新为 `remotes.register` + client `remotes.contribute` | **部分同步**：`workflows` 块已由 workflow 线加入 §2；树图其余旧叶子与 §7 的 `TypertRemoteService` 条目仍在 | **待人类确认**（其余部分） |
| S3 | `domain-composition.md` §2 领域表 | 新增 `credentials` 与 `workflows` 两条领域行 | **部分同步**：`workflows` 行已在；**`credentials` 行缺失** | `credentials` 行**列入待确认清单**（经人类确认后新增），**不得记为核对通过** |
| S4 | `capability-strategy.md` §5 装配表 | compaction-events 行补注 operation 子面扩展 | **已同步**（compaction 线交付时写入 R 类扩展登记注） | 已核对通过，仅对账 |
| S5 | `capability-strategy.md` §5 / feature-list §3.1 / `AGENTS.md` §2/§4 | `agent/turn-stopping` R 切片登记义务 | **部分同步**：前两者已由 decision-participation 提交 `fb9f51d` 同步；`AGENTS.md` §2/§4 部分待确认 | **待人类确认**（AGENTS 部分） |

## 不修订声明（本轮）

`api-idioms.md`（例外按六项机制逐成员登记，正文不变）、`api-shape.md`、`composition-and-authority.md`、`ordering.md`、`identity-and-lifecycle.md`、`durable-state-and-scope.md`、`visibility-and-redaction.md`、`concurrency-and-cancellation.md`、`versioning-and-protocols.md` 本轮无实质边界修订；`services.appExit` 属 registry 变更 + capability-strategy §6.1 成员分级登记，不需要分册正文修订。
