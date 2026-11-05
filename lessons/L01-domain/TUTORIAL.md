# L01 代码教程 · 领域模型

本教程只读 `dsh-superagent-prototype` 的真实源码。所有片段逐字抄录，路径相对原型仓库根。实验代码不依赖 DSH、Node 或任何 npm 包，可直接粘进浏览器控制台运行。

## 1. 源码地图

| 路径 | 符号 | 看什么 |
|---|---|---|
| `src/core/model.ts` | `Trigger` / `Thread` / `Ticket` / `Mandate` / `followupOwners` | 领域形状与「谁的追问归谁」 |
| `src/core/intake.ts` | `Intake.receive` | 唯一摄入口：去重 → 过滤 → 扇出 → 排队 |
| `src/core/part.ts` | `queueForEval` / `leftToWorkers` | Thread 的 pending 队列与越权保护 |
| `src/core/evals.ts` | `Evals.start` / `decide` / `accept` | 批处理取最强、拒绝越权接单 |
| `src/core/tickets.ts` | `Tickets.create` / `wake` | 一个事务里落地整张票 |
| `docs/001-domain.md` | `Rejected concepts` | 哪些捷径被刻意关掉 |

## 2. 逐段精读

### 2.1 `Intake.receive` — 所有写都在一个同步事务里

`src/core/intake.ts`：

```ts
    if (!trigger.threads.length) throw new Error('A trigger must belong to at least one thread')
    if (this.repo.triggers.get(trigger.id)) return 'duplicate'
    const at = this.now()
    const filter = this.options.scope.scope(trigger)
    if (!filter.listened) {
      this.repo.triggers.save(trigger); this.repo.triggers.saveDisposition(trigger.id, { filtered: { code: filter.reason }, fanout: [], at })
```

- 第 1 行：Trigger 至少属于一个 Thread，这是 Eval 有一致视图的前提。
- 第 2 行：id 命中直接返回 `duplicate` —— 这就是「重读消息安全」的全部实现，不需要额外去重表。
- 第 4 行：`scope()` 是 `SourceScope` 端口；是否接收由 Source 决定，内核不解释 `meta`。
- 第 6 行：不监听也**要存下来**并记 `filtered`，面板才能向人解释「为什么没反应」。

### 2.2 `followupOwners` — 订阅不给授权的代码证据

`src/core/model.ts` 里这个函数决定一条消息归谁：它先 `if (!trigger.human) return []`，再剔除 `handbacks`、`context`、`requeued`，只留下 live Ticket 或「非人工结束且有等待消息」的票。对应 `src/core/part.ts`：

```ts
if (!this.owners(trigger).length) this.queueForEval(trigger)
for (const ticketId of fanout) this.tickets.wake(ticketId)
```

- 有人认领 → 不进 Eval，只 `wake` 订阅票（送上下文）。
- 无人认领 → 排进 primary Thread 的 `pending` 等 Eval。
- `leftToWorkers` 在主 Session 试图越权路由一条已归 Worker 的消息时抛 `UserError('workerDecides')`。

### 2.3 `Evals.start` — 一个批次取最强

`src/core/evals.ts`：

```ts
    for (const trigger of triggers) {
      const gate = policy.gate(trigger, thread, tickets)
      if (!gate.admissible) { reasons.push({ code: gate.reason, triggerId: trigger.id }); continue }
      const later = gate.strength === strongest?.strength && trigger.at >= strongest.trigger.at
      const weaker = !strongest || stronger(strongest.strength, gate.strength) !== strongest.strength
      if (weaker || later) strongest = { trigger, strength: gate.strength, basis: gate.basis }
    }
```

- `policy.gate` 是确定性的第一层，模型研判在它之后。
- 同强度取时间最新的 Trigger，避免批次里旧消息压过新消息。
- `basis` 被保留下来，日后 `revalidate` 要用它复查（L02）。

### 2.4 `Evals.decide` — 权限由代码强制

```ts
    if (outcome.kind === 'accept' && evaluation.strength !== 'explicit' && !this.policy().admitsInferred(outcome.rules ?? [])) {
      throw new UserError('notExplicit')
    }
```

推断候选不能在非 `auto` 模式下被直接接单。哪怕提示词或模型输出写了「accept」，这一行也会挡住 —— 这是 L04「文本改不了权限」的第一次出现。

### 2.5 `Tickets.create` — 原子建单

`src/core/tickets.ts` 在一个 `repo.atomic` 里完成：从 `triggerIds` 收集 `channels` → `prepareTicket` → `newAssignment`（`state:'pending'`）→ 对每个 thread `subscribe` → `replies.acknowledgeAccepted` → `executor.start` → `emit('ticket.created')`。任何一步失败，整张票都不存在。

### 2.6 `Rejected concepts` — 比概念表更重要

`docs/001-domain.md`：

```
| Admission checks on Subscriptions | A Subscription covers the whole Thread; the Mandate separates authorization from context |
| Correlation that routes | Subscriptions route; Correlation only adds context |
| Ticket state that follows the DSH Session | A Ticket can be handed off, resumed, or run by several Executors |
```

这三条分别保护：授权唯一来源、路由唯一来源、Ticket 状态自主。设计新底座时，这张表应当原样保留。

## 3. 实验 A · 扇出 vs Eval 分类器

目标：验证「bot 扇出但仍进 Eval」「人的追问命中订阅票则不进 Eval」「同 id 只存一次」。

```js
const triggers = new Map();
const dispositions = new Map();
const subscriptions = new Map([['th-1', ['tk-1']]]);
const pending = [];

function receive(t) {
  if (triggers.has(t.id)) return 'duplicate';
  triggers.set(t.id, t);
  if (!t.listened) {
    dispositions.set(t.id, { filtered: 'conversation_not_listed', fanout: [] });
    return 'filtered';
  }
  const fanout = subscriptions.get(t.thread) || [];
  dispositions.set(t.id, { fanout });
  const owned = t.human && fanout.length > 0;   // followupOwners 的极简版
  if (!owned) pending.push(t.id);               // queueForEval
  return { stored: true, fanout, queuedForEval: !owned };
}

console.log(receive({ id: 'm1', thread: 'th-1', human: true,  listened: true  })); // 不进 Eval
console.log(receive({ id: 'm2', thread: 'th-1', human: false, listened: true  })); // bot 扇出但进 Eval
console.log(receive({ id: 'm1', thread: 'th-1', human: true,  listened: true  })); // duplicate
console.log(receive({ id: 'm3', thread: 'th-2', human: true,  listened: false })); // filtered
console.log('pending =', pending); // ['m2']
```

**预期断言**：`pending` 只有 `m2`；`m1` 的 disposition 里 `fanout:['tk-1']` 且没有产生任何 Decision；`m3` 有记录但没有 Thread。对照 `tests/core-engine.spec.ts` 与 `tests/followups.spec.ts`。

## 4. 实验 B · 拒绝概念自检表

目标：把 11 条 Rejected concepts 变成可运行的规则检查，防止自己设计底座时把捷径加回来。

```js
const rejected = [
  ['Principal / Membership 实体', /principal|membership/i, '人只是 Trigger 的 actor 元数据'],
  ['跨 Source 身份映射',          /cross.?source.?map/i,     '映射是 prompt text，不是实体'],
  ['订阅上做准入检查',            /admission.*subscription/i, '授权只来自 Mandate'],
  ['Correlation 参与路由',        /correlation.*rout/i,       'Subscriptions route'],
  ['Ticket 跟随 Session 状态',    /ticket.*session.*state/i,  'Ticket 自定义 open/ended'],
  ['Eval 等待 / 自排延迟 Trigger', /eval.*(wait|delay)/i,      '等待属于 Source']
];
function audit(lines) {
  return lines.flatMap(line => rejected
    .filter(([, re]) => re.test(line))
    .map(([name, , why]) => `${name} → ${why}`));
}
console.log(audit([
  'We add a Principal entity and map identities across sources',
  'Correlation now routes to the right ticket'
]));
```

**预期输出**：4 条违规提示。这个实验的价值在于把「文档里的拒绝清单」变成可以放进 CI 的约束。

## 5. 自检清单

- [ ] 能说出 `Intake.receive` 的四个动作顺序。
- [ ] 能解释 `duplicate` 为什么不需要额外去重表。
- [ ] 能指出 `basis` 字段在 L02 的用途。
- [ ] 能画出两条路径在 Ticket 汇合的位置。
- [ ] 能背出至少 3 条 Rejected concepts 与理由。

## 6. 回到动态演示

| 步骤 | 对应源码 |
|---|---|
| 2 去重 + scope | `src/core/intake.ts:Intake.receive` |
| 3–4 订阅 fan-out | `src/core/model.ts:followupOwners`、`src/core/part.ts` |
| 5 排队 | `src/core/part.ts:queueForEval` |
| 6 gate | `src/core/evals.ts:Evals.start` |
| 7–8 建 Mandate / Ticket | `src/core/evals.ts:accept`、`src/core/tickets.ts:Tickets.create` |
| 14 唤醒 | `src/core/tickets.ts:Tickets.wake` |
| 15 Correlation 不路由 | `docs/001-domain.md:Rejected concepts` |
| 16 Ticket ended | `docs/001-domain.md:35-36,56`、`ticketStage(ticket)` |
