# L07 · 整体架构与内核边界

> 对应原型原文：`dsh-superagent-prototype/docs/007-architecture.md`
> 先修：L01–L06 全部（这是一次全链路复盘）。

## 这课学什么

跟着**一条 Trigger** 从 Source 走到 Channel，边走边给每个模块贴标签：哪些属于零 I/O 领域内核，哪些是 DSH 宿主适配器。学完要能回答：接缝到底在哪，以及为什么这个切法使「换宿主、留内核」成为可能。

三个关键词：6 类 ports、单事务提交后副作用、one-writer-per-state。

> 这一课也是后续「底座内核彻底与 DSH 无关」这一约束的直接依据。

## 三个问题

1. `src/core` 为什么是零 I/O 内核？六类端口各自把什么能力挡在门外？
2. 哪些写发生在同一个同步事务里，哪些副作用是提交后才由 Effects 执行的？
3. 重启后进行到一半的 Assignment 怎么恢复，effects 队列里的行为什么会留存？

## 课程材料

| 文件 | 用途 |
|---|---|
| `README.md` | 本文件 |
| `TUTORIAL.md` | 精读 `core/ports.ts` / `core/engine.ts` / `core/intake.ts` + `app/effects.ts` / `app/outbox.ts` / `app/passes.ts` / `executor/dsh.ts` + 2 个实验 |
| `index.html` + `data.js` | 17 个模块、19 步流转、Ticket/Assignment 生命周期状态机、8 个真实代码锚点 |

## 学习路径

1. 先读 `docs/007` 的 dependency rules、one-writer-per-state、whole system map 三节，再回头读一遍 `docs/001` 的流程图。
2. 打开 `src/core/ports.ts`，逐个确认 6 个端口都是纯 `interface`，没有 `import` 任何宿主运行时。
3. 播放动态演示：第 1–5 步是 intake 分叉，第 6–9 步是心跳与 Eval，第 10–12 步是 accept 与事务内入队，第 13–16 步是报告与投递，第 17–19 步是恢复、Assignment 边界与内核复盘。
4. 跑两个实验：事务内入队 / 提交后派发模拟器，零 I/O 内核 + 可替换端口。

## 动态演示怎么看

- 第 3 步 `Engine.receive = repo.atomic(() => intake.receive(trigger))`：一条命令 = 一个同步事务，内核里没有定时器、`fetch`、文件系统访问。
- 第 5 步是文章里 Fast/Slow Path 的**真实分叉点**：`owners(trigger)` 决定跳过 `queueForEval` 还是排队。仓库里没有 `FastPathRouter` / `SlowPathRouter` 这两个类，别按文章字面去代码里找。
- 第 11 步与第 12 步之间必须断开：内核端口方法只**排队**，适配器在 commit 之后才真正 dispatch。第 19 步回头总结这条边界。
- 第 14 步 `Outbox.send` 把 receipt 与 reply effect 写在**同一个事务**里，这是 L03「不丢不重」的地基。
- 第 17 步恢复按 Ticket 创建时间从旧到新：`cancel(..., {keepInbox:true})` → `stopWork` → `assignmentInterrupted` → 带 recovery note 重排；effect 行留在 SQLite 里。
- 状态机刻意把 Ticket 与 Assignment 两条生命周期并列：`ticketStage(ticket)` 是纯函数，ticket 表里**没有** `stage` 这一列。

## 验收标准

- [ ] 能说出 6 类 ports（`Repositories / Policy / SourceScope / Assessor / Executor / Outbox`）各自拦住了什么 I/O。
- [ ] 能解释 `EngineFor*` 用 `Pick<Engine, ...>` 收窄调用方视图，例如 `EngineForSources` 看不到 `decide`。
- [ ] 能指出「事务内入队 → 提交后派发」的分界线在两个文件的哪两个函数之间。
- [ ] 能列出 `Later` 与普通失败的差别，以及 `Passes.pumpOnce()` 的两件事。
- [ ] 能给出「可移植 vs 要替换」各至少 5 项，并说明 Runtime 是组合根。

## 与前课的关系

L01 的领域词汇、L02 的 gate / Mandate、L03 的 Effects / Outbox、L04 的提示词注入、L05 的只读视图、L06 的 DSH 装配链，在这一课被串成一条链并**分层**。此后 L08 用 cookbook 把整条链亲手再走一遍。

## 易错点速查

| 误解 | 正确理解 |
|---|---|
| `Executor.start` 立刻起 worker | 端口方法只排队工作；适配器在 commit 后才 dispatch，事务回滚则 effect 行根本不落地 |
| 有 `ticket.stage` 字段可读 | `ticketStage(ticket)` 是纯函数派生，ticket 表没有这一列 |
| 订阅 / 扇出等于授权 | 扇出只 `wake` 并送上下文，授权只来自 Mandate |
| 显式请求也做 proactive 评估 | 显式走 `orchestrator_route`；推断候选才走 `orchestrator_eval*` |
| 文章里的 Fast/Slow Path 是类名 | 原型里没有这个字面，真实实现是 `followupOwners` / `queueForEval` |
| 重启后丢失在途工作 | 领域状态在 Store、待办副作用在 effect 表、已投递未读消息在 Session 记录里 |
| `stage` / `Assignment` 由适配器写 | `Trigger/Thread/Decision/Ticket/Assignment` 都由 Engine 写，effect 行、receipt、健康位各有唯一写者 |

## 源码坐标

```
docs/007-architecture.md          dependency rules / one-writer / whole system map / Modules 索引表
src/core/ports.ts                 6 类 ports（纯 interface）、GateResult、DomainEvents
src/core/engine.ts                Engine（唯一写入口）/ evaluateDue / EngineFor*
src/core/intake.ts                receive：scope · dedup · owners · fanout · queueForEval
src/core/evals.ts                 start / due / decide
src/app/runtime.ts                Runtime（组合根）：new Engine({repo, scope, policy, ...})
src/app/effects.ts                Effects.enqueue / attempt / Later / 指数退避
src/app/outbox.ts                 Outbox.send / deliver / behind / channelGone
src/app/passes.ts                 Passes.start / pumpOnce（2s 心跳）
src/executor/dsh.ts               DshExecutor.start / resume / WorkerSlots
src/app/assessment.ts             MasterAssessor
src/sources/kind.ts, registry.ts  SourceKind / SourceRegistry
tests/docs.spec.ts                校验 007 的 Modules / Tests 两张索引表
```

## 下一步

L08 是结课实战：照 `docs/008` 的 11 步写出一个 webhook Source，把稳定 id、ScopeResult、`ctx.receive`、Outbox 与重启生效亲手串起来。
