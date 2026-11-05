# L08 · Cookbook 端到端实战

> 对应原型原文：`dsh-superagent-prototype/docs/008-cookbook.md`
> 先修：L01–L07 全部（这一课把前七课亲手串一遍）。

## 这课学什么

照 `docs/008` 的 **11 步**写出一个 webhook Source kind，从「映射一个外部事件」做到「构建 / 注册 / 重启生效 / 交付」。学完要能回答：接一个新 Source 的本质是什么，以及哪三个不变量保证它不会把系统搞乱。

三个关键词：稳定 id、ScopeResult、游标只在成功后推进。

## 三个问题

1. 为什么 `Trigger.id` / `Thread.id` / `channel.address` 必须一次定稳？重读消息凭什么安全？
2. `scope` 为什么只能依赖 `meta` 与配置？`channel.send` 为什么只有永久失败才返回 `gone`？
3. 从写完 `apply()` 到真的能收消息，`tsdown` / `exports` / `patch` / `profile` / `restart` 各起什么作用？

## 课程材料

| 文件 | 用途 |
|---|---|
| `README.md` | 本文件 |
| `TUTORIAL.md` | 精读 cookbook 的 `webhookTrigger` / `scope` / `sendWebhook` / `apply` / `pollQueue` / 构建装配 + 2 个实验 |
| `index.html` + `data.js` | 18 个模块、20 步流转、端到端状态机、7 个真实代码锚点 |

## 学习路径

1. 通读 `docs/008` 的 11 步，先把 Step 1 的映射表抄下来 —— 它是后面所有代码的约束。
2. 对照 `src/sources/kind.ts` 的 `SourceKind<C>` 类型总纲，看每一步补的是哪个可选字段。
3. 播放动态演示：第 1–8 步是 Step 1–9 的编码，第 9–10 步是轮询与游标，第 11–13 步是构建与重启，第 14–19 步是一条消息走完 L07 的全链路（含 `gone` 分支），第 20 步是测试与文档索引。
4. 跑两个实验：稳定 id + 去重 + scope + 游标模拟器，幂等收据 + gone / retry / 排序模拟器。

## 动态演示怎么看

- 第 1 步就点明不可回头的决定：`Trigger ids, Thread ids and Channel addresses are persisted`，以后改会让已有记录失联。`key('webhook', message.id)` 用稳定 id，编辑要区分就把 edit version 拼进 key（GitHub 用 `updated_at`）。
- 第 4 步 `scope` 只吃 `meta` 与配置，因为 **revalidate 会用 Mandate 里存的 meta 重放**；被过滤的消息也必须交给 `receive`，面板才有 disposition 可解释。
- 第 5 步 `--key message.id` 是幂等键：远端可能已收到但本地才发现失败。只有 `410` 这类永久不可达返回 `gone`，其余抛错让 Outbox 从 5s 退避到 300s。
- 第 10 步是正确性核心：`ctx.state.set(cursor, page.next)` 在**所有** `ctx.receive` 成功之后。中断一轮游标不动，稳定 id 让重放全变 `duplicate`。时间戳游标用 `cursorAt(started)` 减 5 秒容忍迟到。
- 第 11–13 步提醒「写完代码 ≠ 生效」：tsdown entry → `package.json` export → bundle 插件行（`disabled: true`）→ profile 开关 → 重启，一个都不能少。
- 第 15–18 步就是 L07 那条链的复现：`explicit → orchestrator_route → Engine.decide → Outbox.send → channel.send`。注意 **Source 不能自己结束工单**，Ticket 何时结束仍由 Engine 决定。

## 验收标准

- [ ] 能写出 Step 1 映射表的五项（Trigger / Thread / Actor / Channel / scope row）。
- [ ] 能解释 `webhookTrigger` 里 `sender.id === me → undefined` 与 `addressed: 'mention'` 的作用。
- [ ] 能说明为什么 `policy.row` 必须等于 `scope` 返回的 `row`。
- [ ] 能实现 `pollQueue`，并解释 `{ read: 3, unreadable: 1 }` 与 `cursor === 3` 两个测试断言。
- [ ] 能列出从代码到生效的 5 个装配动作，以及 `tests/docs.spec.ts` 检查的两张索引表。

## 与前课的关系

L01 的 Trigger/Thread/Channel、L02 的 gate / explicit、L03 的 Outbox、L04 的 environment 变量、L05 的面板解释过滤、L06 的 bundle patch 与重启、L07 的端到端链路，在这 11 步里全部被用到一次。这是结课，不是新知识。

## 易错点速查

| 误解 | 正确理解 |
|---|---|
| 以后可以改 id / Thread / Channel | 三者持久化，改了会让已有记录失联；时间戳或随机数塞进 id 会让重放变成新工单 |
| `scope` 可以读外部状态 | revalidate 会用存下的 meta 重放；只能依赖 `meta` 与配置 |
| 过滤掉的消息不用交给 `receive` | 必须交，面板需要 disposition 才能解释为什么过滤 |
| 任何发送失败都返回 `gone` | 只有永久不可达（如 410）才 gone；其余抛错交给 Outbox 退避 |
| 游标可以边读边推进 | 必须全部 `receive` 成功后才推进；中断一轮游标不动 |
| 写完 `apply()` 就能收消息 | 还需 entry / exports / patch 行 / profile 开关 / 重启 |
| Source 能自己结束 Ticket | 只有 Engine 决定 Ticket 何时结束 |
| `KV` key 字面量可以散落 | `tests/store.spec.ts` 要求 key 字面量只出现在注册表里 |

## 源码坐标

```
docs/008-cookbook.md              11 步教程 / 映射表 / 全部示例代码 / 测试断言
src/sources/kind.ts               SourceKind<C> / SourceChannel / ScopeResult 类型总纲
src/sources/registry.ts           SourceRegistry.register / send（waiting / sent / gone）
src/core/ports.ts                 ScopeResult / SourceScope / Outbox
src/app/outbox.ts                 Outbox.send（receipt + reply effect 同事务）
src/kv.ts                         KV.webhook.cursor 注册表
src/app/runtime.ts                Runtime.initialize / restart
tsdown.config.ts                  entry: webhook-watch
package.json                      exports: ./webhook-watch
cordis.patch.yml                  insert 插件行 disabled: true
tests/webhook.spec.ts             真实 Store + stand-in ports 的端到端断言
tests/docs.spec.ts                校验 007 的 Modules / Tests 索引表
tests/store.spec.ts               KV key 字面量集中性
```

## 下一步

八课到此闭环。若要继续，可把 L07 的「可移植 vs 要替换」清单当作底座改造的输入：保留 `src/core` + ports，替换 Runtime / DshExecutor / Sessions / Sources / bundle patch，并把 L06 的 Cordis patch 词汇降为纯组合层。
