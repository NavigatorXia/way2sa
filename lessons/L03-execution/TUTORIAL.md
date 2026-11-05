# L03 代码教程 · 执行与可靠投递

片段逐字抄自 `dsh-superagent-prototype`。两个实验分别复刻 `tests/effects.spec.ts` 与 `tests/outbox.spec.ts` 的核心行为，纯 JS 可直接运行。

## 1. 源码地图

| 路径 | 符号 | 看什么 |
|---|---|---|
| `src/core/stage.ts` | `ticketStage` / `canRetry` | 纯派生阶段 |
| `src/app/outbox.ts` | `send` / `deliver` | 收据 + effect 同事务、Later、保序 |
| `src/app/store.ts` | `atomic` / `receipts.add` / `behind` / `settle` | 事务边界与幂等根 |
| `src/app/effects.ts` | `enqueue` / `dispatch` / `attempt` / `Later` | (kind,key) 合并、退避、健康位 |
| `src/app/passes.ts` | `start` / `pumpOnce` | 2 秒心跳 |
| `docs/003-execution.md` | Ticket stages / Stored work | 规则原文 |

## 2. 逐段精读

### 2.1 `ticketStage` — 首行命中的纯函数

`src/core/stage.ts`：

```ts
export function ticketStage(ticket: Ticket): TicketStage {
  if (ticket.ended) return { stage: 'ended' }
  if (ticket.delivery) return { stage: 'person', action: 'delivery' }
  if (ticket.attention) return { stage: 'person', action: 'answer' }
  const assignment = latestAssignment(ticket)
  const report = assignment?.report?.state
```

依次判断 `ended` → `delivery` → `attention` → `ready`(person/review) → `blocked|failed` → 无 Assignment/pending(working/queued) → `waiting` 或 assignment ended(idle) → 其它 working。`Ticket` 里**没有 stage 字段**，所以重启后从 Reports 与 Inputs 现算即可恢复。

### 2.2 `Outbox.send` — 收据与 effect 同事务

`src/app/outbox.ts`：

```ts
  send(message: OutboundMessage): void {
    if (message.kind === 'reply' && message.channel.source === 'feishu') checkedImText(message.text)
    const { store, effects } = this.host
    store.atomic(() => { if (store.receipts.add(message)) effects.enqueue('reply', message.id, {}) })
  }
```

`receipts.add` 返回 `false` 时（id 已存在）连 effect 都不会入队。这一行就是「不重」的全部。

### 2.3 `receipts.add` 与 `settle` — 幂等的两端

`src/app/store.ts`：

```ts
    add: (message: OutboundMessage): boolean => {
      const receipt: Receipt = { ...message, status: 'pending' }
      return Number(this.db.prepare('INSERT OR IGNORE INTO outbox (id, value) VALUES (?, ?)').run(message.id, JSON.stringify(receipt)).changes) > 0
    },
```

`settle` 用 `json_patch` 只更新 `pending` 行；如果行已被 `withdraw` 删掉，它会 `INSERT OR IGNORE` 重建一条带 `dropped` 的记录 —— 于是这个 id 被永久占用，`deliver` 里 `status !== 'pending'` 直接返回。`docs/003` 原话：`A dropped acknowledgement reads as dropped, not sent.`

### 2.4 `Store.atomic` — 提交边界

```ts
    this.committed[level] = []
    this.db.exec(`SAVEPOINT ${name}`)
    let value: T
    try { value = operation(); this.db.exec(`RELEASE ${name}`) }
    catch (error) { this.db.exec(`ROLLBACK TO ${name}`); this.db.exec(`RELEASE ${name}`); throw error }
```

嵌套按 `depth` 分层；回滚层丢弃该层 `afterCommit` 回调。`afterCommit` 只做内存内跟进，**不能替代 Effects**：只有落在 effect 表里的行才能跨崩溃存活。`tests/effects.spec.ts` 明确断言「runs an effect queued inside a transaction once it commits, and none from a transaction that rolled back」。

### 2.5 `Effects.enqueue` / `attempt` — 合并与三分

```ts
    this.store.db.prepare(`INSERT INTO effect (kind, key, value, seq, due, since) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE
      SET value = excluded.value, generation = generation + 1, attempts = 0, error = '', due = excluded.due`)
      .run(kind, key, JSON.stringify(payload), ++this.seq, this.now(), new Date(this.now()).toISOString())
```

`ON CONFLICT(kind,key)` 保留 `seq` 队位、`generation+1` 防止运行中的旧版本覆盖新 payload。`attempt` 的三分：

```ts
    if (!failure) this.store.db.prepare(`DELETE FROM effect WHERE ${own}`).run(...ownRow)
    else if (this.stopped) return
    else if (failure.error instanceof Later) {
      this.store.db.prepare(`UPDATE effect SET due = ? WHERE ${own}`).run(this.now() + handler.retry[0], ...ownRow)
    } else {
      const delay = Math.min(handler.retry[1], handler.retry[0] * 2 ** Math.min(row.attempts, 16))
```

停机时保留 running 行，下次 `start` 续跑；`Later` 不增 attempts；普通失败指数退避，`FAILURES_BEFORE_ERROR = 3` 后才报系统问题。

### 2.6 `Outbox.deliver` — 终态直接返回

```ts
    const receipt = store.receipts.get(id)
    if (receipt?.status !== 'pending') return
    if (!sources.instance(receipt.channel.source)?.enabled) throw new Later('The Source is off or not installed')
    if (store.receipts.behind(id, FAILURES_BEFORE_ERROR)) throw new Later('An earlier message of this ticket to this conversation waits')
    if (!sources.channelAllowed(receipt.channel)) { store.receipts.settle(receipt, 'channelIgnored'); return }
```

`reply` handler 的 `retry: [5000, 300_000]`；`behind` 只在同票同会话且更早消息失败 <3 次时阻塞。`Passes.pumpOnce` 每 2 秒先 `effects.kick()` 再 `engine.evaluateDue()`。

## 3. 实验 A · atomic + enqueue 模拟器

```js
let rows = [], callbacks = [], depth = 0, seq = 0;
function atomic(work) {
  const rowMark = rows.length, cbMark = callbacks.length;
  depth++;
  let out;
  try {
    out = work();
    depth--;
    callbacks.splice(cbMark).forEach(fn => fn());   // 只在提交后 flush
    return out;
  } catch (e) {
    rows.length = rowMark; callbacks.length = cbMark;
    depth--; throw e;
  }
}
function enqueue(kind, key, payload) {
  callbacks.push(() => {
    const i = rows.findIndex(r => r.kind === kind && r.key === key);
    if (i >= 0) Object.assign(rows[i], { value: payload, generation: rows[i].generation + 1, attempts: 0 });
    else rows.push({ kind, key, value: payload, seq: ++seq, generation: 0, attempts: 0 });
  });
}
try { atomic(() => { enqueue('reply', 'm1', { a: 1 }); throw new Error('rollback'); }); } catch (_) {}
console.log('回滚后行数 =', rows.length);                         // 0
atomic(() => { enqueue('reply', 'm1', { a: 1 }); enqueue('reply', 'm1', { a: 2 }); });
console.log(rows);                                                // 1 行，generation 1，value a:2，seq 不变
atomic(() => enqueue('launch', 'a1', {}));
console.log('总行数 =', rows.length);                             // 2
```

**断言**：回滚后 0 行；同 `(kind,key)` 二次入队只改 value / generation、不新增行、不重排 seq。

## 4. 实验 B · 幂等 outbox + 退避

```js
const receipts = new Map(), sent = [];
const FAIL = 3, BASE = 5000, MAX = 300000;
const delay = a => Math.min(MAX, BASE * 2 ** Math.min(a, 16));
function add(id, msg) {
  if (receipts.has(id)) return false;
  receipts.set(id, { id, ...msg, status: 'pending', attempts: 0 });
  return true;
}
function settle(id, status) {
  const r = receipts.get(id);
  if (!r) receipts.set(id, { id, status, attempts: 0 });  // 缺行重建 → id 永久占用
  else r.status = status;
}
function deliver(id, outcome) {
  const r = receipts.get(id);
  if (!r || r.status !== 'pending') return 'skip';         // 终态幂等
  if (outcome === 'sent') { sent.push(id); settle(id, 'sent'); return 'sent'; }
  if (outcome === 'gone') { settle(id, 'dropped'); return 'dropped(channelGone)'; }
  if (outcome === 'waiting') return 'Later(attempts 不变)';
  r.attempts++;
  return 'retry in ' + delay(r.attempts) + 'ms, attempts=' + r.attempts;
}
console.log(add('m1', { text: 'ack' }), deliver('m1', 'sent'), add('m1', { text: 'ack' }), deliver('m1', 'sent'));
console.log('sent =', sent);                                  // ['m1'] 只发一次
add('m2', { text: 'gone case' });
console.log(deliver('m2', 'gone'), add('m2', {}), deliver('m2', 'sent')); // dropped 后 false + skip
add('m3', { text: 'flaky' });
console.log(deliver('m3', 'error'), deliver('m3', 'waiting'), deliver('m3', 'error'));
```

**断言**：同 id 只发一次；`dropped` 后再 `add` 仍 false；`waiting` 不增 attempts；普通失败 5s→20s 退避（中间那次 Later 不计数）。

## 5. 自检清单

- [ ] 能说出 stage 表 7 行的顺序及「首行命中」的含义。
- [ ] 能解释 `afterCommit` 为什么不能替代 `Effects`。
- [ ] 能写出 `(kind,key)` 合并时哪些字段变、哪些不变。
- [ ] 能说明 `behind` 的作用范围与 3 次阈值。
- [ ] 能列出 restart 后留存的四类东西（Session / 目录 / 订阅 / 待投递消息 + effect 行）。

## 6. 回到动态演示

| 步骤 | 对应源码 |
|---|---|
| 1 stage 派生 | `src/core/stage.ts:ticketStage` |
| 3–4 事务边界 | `src/core/ports.ts`、`src/app/store.ts:atomic` |
| 5 心跳 | `src/app/passes.ts:pumpOnce` |
| 13–14 收据 + effect | `src/app/outbox.ts:send`、`src/app/store.ts:receipts.add` |
| 15 保序 | `src/app/outbox.ts:deliver`、`receipts.behind` |
| 20 三分 | `src/app/effects.ts:attempt` |
| 21 恢复 | `src/executor/dsh.ts:resume`、`docs/003:144-152` |
