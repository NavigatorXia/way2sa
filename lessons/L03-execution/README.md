# L03 · 执行与可靠投递

> 对应原型原文：`dsh-superagent-prototype/docs/003-execution.md`（203 行，8 篇文档里信息密度最高的一篇）
> 先修：L01、L02。

## 这课学什么

跟着一张被接下的 Ticket 走完执行、交付与恢复。全篇的地基是一句话：`What dsh-superagent does after a decision ... is stored first and done afterwards.` —— **状态先落盘，副作用提交后再做**。

前半篇讲「执行长什么样」：stage 派生、worker slot、后台作业、prepare 命令、执行变量、结单规则。后半篇讲「出错怎么办」：失败重试、restart、stored work、Source / Channel 失败、暂停处理。

## 三个问题

1. 为什么 stage 不落盘，而 blocked / failed 重启后还能保持？
2. `Later` 和普通失败有什么本质区别？为什么 effect 必须写在同一个事务里？
3. 一个 dropped / withdrawn 的消息 id，为什么永远不会被再次排队？

## 课程材料

| 文件 | 用途 |
|---|---|
| `README.md` | 本文件 |
| `TUTORIAL.md` | 精读 `stage.ts` / `outbox.ts` / `store.ts` / `effects.ts` / `passes.ts` + 2 个实验 |
| `index.html` + `data.js` | 16 个模块、21 步流转、Effect Row 状态机、10 个真实代码锚点 |

## 学习路径

1. 读 `docs/003` 的 **Ticket stages** 表（从上往下、首行命中）与 **The Executor**。
2. 跳到 **Stored work** 与 **Channel failure**，把「先存后做」这条主线抓出来。
3. 播放动态演示：第 3–5 步是事务边界，第 12–16 步是 Outbox 幂等与保序，第 20 步是 Later / 退避，第 21 步是 restart 恢复。
4. 跑 `TUTORIAL.md` 的两个实验，它们分别复刻 `tests/effects.spec.ts` 与 `tests/outbox.spec.ts` 的核心断言。

## 动态演示怎么看

- 第 3 步 `Assignment → Effects` 与第 4 步 `Store → Effects` 必须连着看：前者在事务**内**入队，后者是 commit 之后才 kick。
- 第 15 步标了 `behind(id,3)`：保序只限「同一 Ticket 到同一会话」，其它票不等待。
- 第 20 步是三类结局的分叉：成功 DELETE / Later 只推 due / 普通失败 attempts+1。
- 状态机是 Effect Row 的生命周期，不是 Ticket 的；Ticket 阶段在右侧「当前这一步」里解释。

## 验收标准

- [ ] 能按优先级背出 stage 表的 7 行，并解释为什么 `ready` 落在 `person/review` 而不是 `ended`。
- [ ] 能解释 worker slot 的「+1 给人」规则解决了什么问题。
- [ ] 能写出 `delay = min(max, base * 2^min(attempts,16))`，并说出 `Later` 不消耗失败次数。
- [ ] 能说明 `receipts.add` 的 `INSERT OR IGNORE` 与 `settle` 的「缺行重建」如何共同保证 id 永不重排。
- [ ] 能说出 restart 后哪些东西留存、哪些 Assignment 会重新开始。

## 与前课的关系

承接 Ticket / Assignment / Stage 相关概念。新增 Store / Effects / Passes / Outbox / Receipt / WorkerSlots / prepare / 后台作业 / 执行环境 —— 这些几乎全在 `src/app/*` 与 `src/executor/*`，是**适配器**而非内核，L07 会据此切分边界。

## 易错点速查

| 误解 | 正确理解 |
|---|---|
| Ticket 有 `stage` 字段 | `ticketStage(ticket)` 是纯函数；blocked/failed 从存下的 Reports / Inputs 现算 |
| `Later` 算一次失败 | 只推 `due`，不增 attempts、不记 error、不报 health |
| blocked/failed 就不能再操作 | 不自动收 Input，但工具仍可用，人可以直接在 Session 里继续 |
| `ready` 一定结单 | 有 follows 时要等它打开的 PR 全关闭，面板此时显示 Awaiting review |
| dropped 消息可以重发 | 记录保留（含时间与原因），id 永久占用 |

## 源码坐标

```
docs/003-execution.md            stages / Executor / Stored work / Failure and recovery
src/core/stage.ts                ticketStage / canRetry
src/app/outbox.ts                send / deliver（reply handler、Later、settle）
src/app/store.ts                 atomic / afterCommit / receipts.add / behind / settle
src/app/effects.ts               enqueue / dispatch / attempt / Later
src/app/passes.ts                start / pumpOnce
src/executor/dsh.ts              WorkerSlots / prepare / resume
tests/effects.spec.ts            事务回滚与 Later 断言
tests/outbox.spec.ts             幂等与保序断言
```

## 下一步

L04 换一个视角：这些规则怎么变成模型读到的 system prompt，以及为什么提示词文本改不了它们。
