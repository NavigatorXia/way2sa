# L07 代码教程 · 整体架构与内核边界

片段逐字抄自 `dsh-superagent-prototype`。实验代码纯 JS，可直接 `node` 运行。

## 1. 源码地图

| 路径 | 符号 | 看什么 |
|---|---|---|
| `src/core/ports.ts` | `Policy` / `SourceScope` / `Executor` / `Outbox` / `Repositories` | 内核边界的正式定义处 |
| `src/core/engine.ts` | `Engine.receive` / `evaluateDue` / `EngineFor*` | 唯一写入口、单事务、角色 Pick |
| `src/core/intake.ts` | `Intake.receive` | 去重 / scope / owners / fanout 分叉 |
| `src/app/runtime.ts` | `Runtime`（组合根） | `new Engine({...})` 把端口接到 DSH 实现 |
| `src/app/effects.ts` | `enqueue` / `attempt` / `Later` | 事务内入队、提交后派发、退避 |
| `src/app/outbox.ts` | `Outbox.send` / `deliver` | 幂等收据与保序 |
| `src/app/passes.ts` | `start` / `pumpOnce` | 2 秒心跳 / watchdog |
| `src/executor/dsh.ts` | `resume` / `WorkerSlots` | 重启恢复 |

## 2. 逐段精读

### 2.1 `ports.ts` — 边界是纯类型

`src/core/ports.ts:17-21`：

```ts
export interface Policy {
  version: string
  paused: boolean
  gate(trigger: Trigger, thread: Thread, tickets: Ticket[]): GateResult
  /** Re-check a mandate's gate-layer basis under this policy, such as before an ended ticket resumes. */
  revalidate(mandate: Mandate): boolean
```

6 类端口：`Repositories`（同步持久状态 + `atomic<T>(work)`）、`Policy`、`SourceScope`、`Assessor`、`Executor`、`Outbox`，另有 `DomainEvents`。**全部是 `interface` / `type`**，`src/core` 除 Node 的 `crypto` 外不 import 任何东西，没有定时器、网络、文件访问。`Executor.start` 的注释明确写着「each method only queues work」。这就是「零 I/O 内核」的可验证含义。

### 2.2 `Engine` — 一条命令一个同步事务

`src/core/engine.ts:48,75-78`：

```ts
receive(trigger: Trigger): ReceiveResult { return this.repo.atomic(() => this.intake.receive(trigger)) }
evaluateDue(): void {
  const policy = this.options.policy()
  for (const thread of this.repo.threads.active()) if (thread.evaluating) this.repo.atomic(() => { this.evals.due(thread, policy) })
  if (policy.paused) return
```

`decide` / `report` / `handback` / `assignmentInterrupted` 同样被 `atomic` 包裹。`evaluateDue` 先跑到期 Eval，`paused` 直接返回（暂停时只记录暂停，让 Eval 不超时），再对 `thread.pending.length && !thread.evaluating` 跑 `evals.start`；每个 Eval / Ticket 各用一个独立事务。**全同步**是边界的关键：内核从不「等」外部世界。

### 2.3 `EngineFor*` — 越权调用在类型层不成立

`src/core/engine.ts:261-270`：

```ts
export type EngineForSources = Pick<Engine, 'receive' | 'bindThread' | 'threadClosed'>
export type EngineForMainSession = Pick<Engine, 'candidate' | 'candidateDelivered' | 'decide' | 'attach' | 'reply' | 'requestStatus' | 'note'>
export type EngineForPeople = Pick<Engine, 'stopTicket' | 'retryTicket' | 'reevaluate' | 'unsubscribe' | 'dismiss'>
export type EngineForSettings = Pick<Engine, 'policyChanged'>
export type EngineForExecutor = Pick<Engine, 'assignmentStarted' | 'inputsDelivered' | 'inputsRead' | 'turnEnded' | 'deliveryFailed'
  | 'assignmentInterrupted' | 'report' | 'markUnrelated' | 'handback' | 'followForContext' | 'reply'>
```

Source 只拿到 `receive / bindThread / threadClosed`，连 `decide` 都看不见。组合根按角色把同一个 Engine 的不同视图注入不同适配器 —— 这是 L02「权力只来自 Mandate」在类型层的延伸。

### 2.4 `Intake.receive` — Fast/Slow Path 的真身

`src/core/intake.ts:25-27,58-61`：

```ts
const filter = this.options.scope.scope(trigger)
if (!filter.listened) {
  this.repo.triggers.save(trigger); this.repo.triggers.saveDisposition(trigger.id, { filtered: { code: filter.reason }, fanout: [], at })
if (!this.owners(trigger).length) this.queueForEval(trigger)
for (const ticketId of fanout) this.tickets.wake(ticketId)
this.emit('trigger.received', { triggerId: trigger.id, threads: trigger.threads.map(threadKey) })
return 'stored'
```

`isoTime` 归一 `at`、按 `id` 去重返回 `'duplicate'`；`scope.scope(trigger)` 过滤；**`if (!this.owners(trigger).length)` 就是文章 Fast/Slow Path 的实际分叉** —— 人的追问被 `followupOwners` 认领就跳过 `queueForEval`，无人认领才排队进 Evals。订阅扇出只 `wake`，不产生任何授权。仓库里搜索不到 `FastPathRouter` / `SlowPathRouter`，不要按文章字面引用。

### 2.5 组合根 `Runtime` — 端口在这里接上 DSH

`src/app/runtime.ts:137-138,200`：

```ts
const engine = this.engine = new Engine({ repo: store, scope: sources, policy, assessor, executor,
  outbox, prepareTicket: (ticket, outcome) => executor.prepare(ticket, outcome), emit: event => {
private paused(): boolean { return !this.setup.configured() || this.store.settings().paused }
```

6 个参数的实际对象全部来自 L06 的 DSH 宿主层。**换宿主就是把这 6 个实现换掉，`src/core` 一行不改** —— 这是「底座内核彻底与 DSH 无关」的技术落点。Runtime 本身是 Cordis Service（名 `orchestrator`），负责 `lockSync` / `shutdown`，不可移植。

### 2.6 `Effects` — 事务内入队、提交后派发

`src/app/effects.ts:62-64,138-141`：

```ts
this.store.db.prepare(`INSERT INTO effect (kind, key, value, seq, due, since) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE
  SET value = excluded.value, generation = generation + 1, attempts = 0, error = '', due = excluded.due`)
  .run(kind, key, JSON.stringify(payload), ++this.seq, this.now(), new Date(this.now()).toISOString())
else if (failure.error instanceof Later) {
  this.store.db.prepare(`UPDATE effect SET due = ? WHERE ${own}`).run(this.now() + handler.retry[0], ...ownRow)
} else {
  const delay = Math.min(handler.retry[1], handler.retry[0] * 2 ** Math.min(row.attempts, 16))
```

`ON CONFLICT(kind, key)` 让同键入队变成「合并」：`generation++`、`attempts = 0`、`error = ''`，`seq` 表达顺序。`Later` **不计失败**，只推 `due`；普通失败才 `attempts+1` 并指数退避（`5000 → 300000`，`min(attempts,16)` 封顶），连续 3 次才报 health。队列是 SQLite 持久表，所以重启后行还在。

### 2.7 `Outbox.send` — 收据与 effect 同事务

`src/app/outbox.ts:27-31,45-48`：

```ts
send(message: OutboundMessage): void {
  // Validate IM reply length here; acknowledgements are already validated when decided.
  if (message.kind === 'reply' && message.channel.source === 'feishu') checkedImText(message.text)
  const { store, effects } = this.host
  store.atomic(() => { if (store.receipts.add(message)) effects.enqueue('reply', message.id, {}) })
if (store.receipts.behind(id, FAILURES_BEFORE_ERROR)) throw new Later('An earlier message of this ticket to this conversation waits')
if (!sources.channelAllowed(receipt.channel)) { store.receipts.settle(receipt, 'channelIgnored'); return }
// A permanently unreachable target (such as a recalled message or deleted Issue) settles as `channelGone` so its receipt prevents retries.
const result = await sources.send(receipt, commands)
```

`receipts.add` 用 `INSERT OR IGNORE` 保证同一 `message.id` 永不产生第二个 effect；`behind(id, 3)` 保证同 Ticket 同会话顺序（ack 一定早于结果）；`channelGone` / `dropped` 的记录**保留**，所以 id 永不被重排。one-writer-per-state 在这里体现为：receipt 只有 Outbox 写，effect 行只有 Effects 写，健康位由各自 claimer 写。

### 2.8 `resume` 与 `Passes` — 恢复与心跳都在适配层

`src/executor/dsh.ts:526-535`：

```ts
for (const ticket of this.host.store.tickets.open().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
  const running = runningAssignment(ticket), latest = latestAssignment(ticket)
  if (running) {
    this.host.context.agents.get(workerSessionId(ticket.id) as SessionId)?.cancel({ kind: 'user' }, { keepInbox: true })
    this.stopWork(ticket.id, 'dsh-superagent restarted', true)
    this.host.engine.assignmentInterrupted(ticket.id, running.id)
  }
  else if (latest?.state === 'pending' && !waitsForPerson(ticket)) this.start(ticket, latest)
```

`src/app/passes.ts:28,63-68` 与 `src/index.ts:18-21`：

```ts
start(): void { if (!this.stopped) this.timer = setInterval(() => { this.request() }, 2000) }
private async pumpOnce(): Promise<void> {
  this.host.effects.kick()
  if (this.host.closing()) return
  // While processing is paused, the Engine only records the pause on active Evals so they do not expire.
  this.host.engine.evaluateDue()
const restart = (): void => {
  ctx.fiber.restart().then(() => { ctx.get('settings')?.describe() }).catch((error: unknown) => { ctx.logger.error('dsh-superagent restart failed: %s', String(error)) })
}
```

时钟**完全在适配层**：`pumpOnce()` 先 `effects.kick()` 再 `engine.evaluateDue()`，并发 `request()` 合并成一轮。重启恢复靠三件事：领域状态在 Store、待办副作用在 effect 表、已投递未读消息在 Session 记录里（`keepInbox: true`）。

### 2.9 可移植 vs 要替换

**可移植**：`src/core` 全部文件、`ports` 契约、dependency rules / one-writer / 单事务提交后副作用这些原则、领域词汇（L01）与状态机（L02/L03）。
**要替换**：`Runtime` + `index.ts`、`DshExecutor`、`Sessions` / delivery / assessment、`Sources` / infra、`cordis.patch.yml` 与 CLI（全部是 DSH 宿主适配器）。Cordis 本身可作为组合层的词汇来源保留。

## 3. 实验 A · 事务内入队 / 提交后派发 / 合并 模拟器

```js
let db = { effect: new Map() };
let staged = null;
let seq = 0;
function atomic(work) {
  staged = new Map(db.effect);                       // 临时副本
  try { const out = work(); db.effect = staged; staged = null; return out; }
  catch (e) { staged = null; throw e; }             // 回滚：effect 行根本不落地
}
function enqueue(kind, key, payload) {
  const k = kind + '|' + key, prev = staged.get(k);
  staged.set(k, { value: payload, generation: prev ? prev.generation + 1 : 0,
    attempts: 0, error: '', due: 0, seq: prev ? prev.seq : ++seq });
}
function attempt(kind, key, failure) {
  const k = kind + '|' + key, row = db.effect.get(k);
  if (failure === 'Later') { row.due = Date.now() + 5000; return 'due 推后，attempts=' + row.attempts; }
  row.attempts += 1;
  row.due = Math.min(300000, 5000 * 2 ** Math.min(row.attempts, 16));
  return 'attempts=' + row.attempts + ', delay=' + row.due;
}
atomic(() => { enqueue('launch', 'tk-1', { ticket: 1 }); enqueue('reply', 'm-1', {}); });
console.log('提交后 effect 行数 =', db.effect.size);
atomic(() => { enqueue('launch', 'tk-1', { ticket: 1, updated: true }); });
console.log('同 key 合并后 =', db.effect.get('launch|tk-1'));   // generation=1, attempts=0, seq 不变
try { atomic(() => { enqueue('launch', 'tk-2', {}); throw new Error('事务内抛错'); }); }
catch (e) { console.log('抛错后行数 =', db.effect.size); }        // 仍是 2，tk-2 未落地
console.log('Later →', attempt('launch', 'tk-1', 'Later'));
console.log('普通失败 →', attempt('launch', 'tk-1', 'Error'));
```

**断言**：提交后正好 2 行；同 `(kind,key)` 只改 `value` 并 `generation++ / attempts=0 / seq 不变`；事务内抛错后 `tk-2` 根本不存在；`Later` 不改 `attempts`，普通失败才 `attempts+1` 并指数退避。

## 4. 实验 B · 零 I/O 内核 + 可替换端口

```js
function makeEngine({ repo, scope, assessor, executor, outbox, policy }) {
  // 注意：这里没有 fetch / setTimeout / fs，6 个参数全是普通对象
  return {
    receive(trigger) {
      return repo.atomic(() => {
        if (repo.triggers.has(trigger.id)) return 'duplicate';
        const filter = scope.scope(trigger);
        repo.triggers.set(trigger.id, trigger);
        if (!filter.listened) return 'filtered';
        if (!policy.paused && policy.gate(trigger).strength === 'explicit') {
          executor.start(trigger);                 // 只排队
          outbox.send({ id: 'ack-' + trigger.id });
        } else assessor.queue(trigger);
        return 'stored';
      });
    }
  };
}
function memoryAdapter() {
  const triggers = new Map(), effects = [], receipts = new Set();
  return {
    repo: { triggers, atomic: work => work() },
    scope: { scope: t => ({ listened: t.allowed !== false }) },
    assessor: { queue: t => effects.push('assess:' + t.id) },
    executor: { start: t => effects.push('launch:' + t.id) },
    outbox: { send: m => { if (!receipts.has(m.id)) { receipts.add(m.id); effects.push('reply:' + m.id); } } },
    policy: { paused: false, gate: t => ({ strength: t.addressed ? 'explicit' : 'inferred' }) },
    effects, receipts
  };
}
function dshLikeAdapter() {                        // 换一套实现，makeEngine 一行不改
  const a = memoryAdapter();
  a.executor.start = t => a.effects.push('dsh.launchQueued:' + t.id);
  a.outbox.send = m => { if (!a.receipts.has(m.id)) { a.receipts.add(m.id); a.effects.push('dsh.receipt+reply:' + m.id); } };
  return a;
}
function pick(engine, keys) { const o = {}; for (const k of keys) if (k in engine) o[k] = engine[k]; return o; }

for (const [name, adapter] of [['memory', memoryAdapter()], ['dshLike', dshLikeAdapter()]]) {
  const engine = makeEngine(adapter);
  const t = id => ({ id, allowed: true, addressed: 'mention' });
  console.log(name, [
    engine.receive(t('m1')),
    engine.receive(t('m1')),                                     // duplicate
    engine.receive({ id: 'm2', allowed: false, addressed: 'mention' }) // filtered
  ], adapter.effects);
}
const engine = makeEngine(memoryAdapter());
const forSources = pick(engine, ['receive', 'bindThread', 'threadClosed']);
console.log('EngineForSources 有 decide 吗？', 'decide' in forSources);   // false
```

**断言**：`stored / duplicate / filtered` 三态在两套适配器下完全一致；`makeEngine` 内没有任何 I/O；`EngineForSources` 的 `decide` 为 `undefined`。

## 5. 自检清单

- [ ] 能列出 6 类 ports，并说明每一类把哪种 I/O 挡在内核外。
- [ ] 能解释为什么 `Engine` 全同步、每条命令一个事务。
- [ ] 能指出 `owners(trigger)` 是 Fast/Slow Path 的真实实现，并说明文章用词与代码不同。
- [ ] 能画出「事务内入队 → commit → effects.kick → dispatch」的时间线。
- [ ] 能解释 `Later`、`behind(id,3)`、`channelGone` 三者各自的语义。
- [ ] 能列出可移植与需替换的清单，并指出 `Runtime` 是组合根。

## 6. 回到动态演示

| 步骤 | 对应源码 |
|---|---|
| 1 Source→Trigger | `src/sources/github-trigger.ts`、`docs/008:100-117` |
| 2–3 Passes / Engine.receive | `src/app/passes.ts:36-38`、`src/core/engine.ts:48` |
| 4–5 scope / owners 分叉 | `src/core/intake.ts:25-27,58-61`、`src/core/model.ts:followupOwners` |
| 6–7 心跳与 Evals.start | `src/app/passes.ts:63-68`、`src/core/engine.ts:75-84` |
| 8–9 assessment / route | `src/app/assessment.ts`、`docs/007:503,511` |
| 10 accept 原子建单 | `docs/007:73` |
| 11–12 入队与 dispatch | `src/executor/dsh.ts:264-265,270-284,424-469` |
| 13–16 report / Outbox / Channel | `src/app/notices.ts:reportRelay`、`src/app/outbox.ts:27-48`、`docs/003:179` |
| 17 恢复 | `src/executor/dsh.ts:524-536` |
| 18 Assignment 独立生命周期 | `docs/007:73`、`docs/003:35-48` |
| 19 边界复盘（6 类 ports） | `docs/007:255-274` |
