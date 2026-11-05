# L01 · 领域模型

> 对应原型原文：`dsh-superagent-prototype/docs/001-domain.md`
> 建议同时读 `docs/000-philosophy.md`（33 行，讲「消耗尽可能少的人类注意力」）。

## 这课学什么

`001-domain.md` 不是功能说明，而是**词汇宪法**：它给系统定了一套不许乱用的概念，并用一张「Rejected concepts」表把 11 条捷径明确关掉。学完你要能跟住一个 Trigger 从 Source 走到 Ticket，说出每个概念各自「保持哪条规则」。

一句话：`Work moves from Trigger to Eval to execution.` 但真正的重点在于——**Eval 和 Subscription 是两条完全不同的路**。

## 先修

无。这是课程起点。只需要知道原型是一个跑在 DeepSeek Harness 上的研究原型。

## 三个问题

1. 为什么已订阅 Thread 上人的消息既不产生 Decision，也不产生新授权？
2. Mandate 记了什么，为什么只有 `accept` 能创建它？
3. Ticket 为什么不跟随 Executor Session 的状态？Correlation 为什么不能路由？

## 课程材料

| 文件 | 用途 |
|---|---|
| `README.md` | 本文件：目标、路径、验收 |
| `TUTORIAL.md` | 逐段精读 `core/model.ts` / `intake.ts` / `evals.ts` / `tickets.ts`，含 2 个可运行实验 |
| `index.html` + `data.js` | 动态设计框架：12 个模块、16 步流转、Ticket 状态机、5 个真实代码锚点 |

## 学习路径

1. **读原文**（15 分钟）：先读 Flow 与 Concepts 表，再读 Rejected concepts，最后扫一遍 Glossary 与 Group/Values。
2. **看动态演示**：从 `Source 产出 Trigger` 一路点到第 14 步「追问唤醒已结束 Ticket」，再用第 15–16 步看 Correlation 与 `ended` 两个边界。注意第 3–4 步（订阅 fan-out）与第 5–8 步（Eval → Mandate → Ticket）是两条路。
3. **精读代码**：`TUTORIAL.md` 第 2 节，重点 `Intake.receive` 与 `Evals.start`。
4. **做实验**：把「扇出 vs Eval」和「拒绝概念自检」两段代码粘进浏览器控制台，对照预期输出。

## 动态演示怎么看

- 实线 message / event 是前向消息；`fact` 用虚线，表示已经发生、被记录下来的事实。
- 绿色块 = 零 I/O 领域内核（可移植）；橙色 = DSH 宿主适配器；蓝色 = 人或外部世界。
- 第 4 步 `Subscription → Ticket` 标了「无 Eval」：这是全课最容易读错的地方。
- 点任意步骤，右侧状态机会点亮对应状态，下方代码卡片同步高亮。

## 验收标准

能做到这 5 件事，就算过关：

- [ ] 不看文档画出 `Source → Trigger → Thread → {Eval | Subscription} → Ticket → Assignment → Executor → Channel` 的分叉。
- [ ] 解释「Admission checks on Subscriptions」为什么被拒绝。
- [ ] 说出 Mandate 的 5 个字段类别，以及改变它的三个操作（accept / 人的 stop / revalidate 失败 —— 后两个在 L02 展开）。
- [ ] 解释「A person is not a domain concept」在代码里的含义：Trigger 只带 Source 给的 actor。
- [ ] 举出 3 条被拒绝的概念，并说出加回来会破坏什么。

## 与前课的关系

起点。本课出现的 12 个模块里，绿色内核块会在 L02 / L03 / L07 反复出现并变成淡色「承接块」。

## 易错点速查

| 误解 | 文档原话 / 正确理解 |
|---|---|
| 订阅 = 授权 | `A Subscription covers the whole Thread; the Mandate separates authorization from context` |
| Correlation 可以路由 | `Subscriptions route; Correlation only adds context` |
| Ticket 状态跟着 Session | `A Ticket can be handed off, resumed, or run by several Executors` |
| 人是领域实体 | `A person is Trigger metadata`；跨 Source 身份映射只是 prompt text |

## 源码坐标

```
dsh-superagent-prototype/docs/001-domain.md        Flow / Concepts / Rejected / Glossary
dsh-superagent-prototype/src/core/model.ts         Trigger / Thread / Ticket / Mandate / followupOwners
dsh-superagent-prototype/src/core/intake.ts        Intake.receive（唯一摄入口）
dsh-superagent-prototype/src/core/evals.ts         Evals.start / decide / accept
dsh-superagent-prototype/src/core/tickets.ts       Tickets.create / wake / end
dsh-superagent-prototype/tests/core-engine.spec.ts 幂等与扇出断言
```

## 下一步

L02 会在这套词汇上叠加「谁有权让工作开始」：gate、admission table、accept mode 与 Mandate basis。
