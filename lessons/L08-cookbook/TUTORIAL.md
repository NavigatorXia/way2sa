# L08 代码教程 · Cookbook 端到端实战

片段逐字抄自 `dsh-superagent-prototype/docs/008-cookbook.md`。实验代码纯 JS，可直接 `node` 运行。

## 1. 源码地图

| 路径 | 符号 | 看什么 |
|---|---|---|
| `docs/008:19-29` | Step 1 映射表 | Trigger / Thread / Actor / Channel / scope row 五项的稳定约定 |
| `src/sources/kind.ts` | `SourceKind<C>` / `SourceChannel` | 全部实现步骤的类型总纲 |
| `docs/008:100-117` | `webhookTrigger` | 稳定 id、防环、`addressed` |
| `docs/008:138-142` | `scope({meta}, config)` | 可重放的接收判据 |
| `docs/008:163-179` | `sendWebhook` | `--key` 幂等与 410 → gone |
| `docs/008:255-267` | `apply(ctx)` | `inject` / `ctx.effect` / AbortController |
| `docs/008:300-324` | `pollQueue` | 读位点只在成功后推进 |
| `docs/008:336-353` | entry / exports / patch / tests | 从代码到生效的装配 |
| `src/sources/registry.ts` | `SourceRegistry.send` | `waiting` / `sent` / `gone` |

## 2. 逐段精读

### 2.1 Step 1 — 先把映射定死，再写代码

`docs/008` 开头那句必须逐字记住：

> Trigger ids, Thread ids and Channel addresses are persisted, so changing them later can disconnect existing records.

一个外部事件映射为：Trigger = 一条消息、Thread = `${conversation}:${firstId}`、Actor = 队列 sender id、Channel = conversation + 被回复消息、scope = conversation 对应的 admission row。**这些值一旦落库就不能改**；若要把「编辑」当新事件，把 edit version 拼进 `key`（GitHub Source 用 `updated_at`）。Step 2 的 `ConfigSchema` 用 zod `.strict()`：`conversations[].listen ∈ {mentions, all}`、`pollSeconds` 默认 30（10..3600）、`health: ['webhook']` 注册时 claim —— 与 `runtime / effect kind / sync:` 等保留名冲突会被拒。

### 2.2 Step 3 — `webhookTrigger`：稳定 id 与防环

`docs/008:100-116`：

```ts
export function webhookTrigger(message: QueueMessage, me: string): Trigger | undefined {
  if (message.sender.id === me) return undefined
  const thread = `${message.conversation}:${message.thread ?? message.id}`
  return {
    id: key('webhook', message.id),
    source: 'webhook',
    threads: [{ source: 'webhook', id: thread }],
    actor: { source: 'webhook', id: message.sender.id },
    human: !message.sender.bot,
    ...(message.mentions_me ? { addressed: 'mention' as const } : {}),
    at: message.at,
    text: message.text,
    channel: { source: 'webhook', thread: `webhook:${thread}`,
      address: { conversation: message.conversation, message: message.id, ...(message.url ? { url: message.url } : {}) } },
```

- `sender.id === me → undefined`：绝不给自己造 Trigger（防环）。
- `id: key('webhook', message.id)`：稳定 id，让 `Engine.receive` 能返回 `'duplicate'`，**重读消息因此安全**。
- `...(mentions_me ? { addressed: 'mention' } : {})`：显式请求的来源，L02 的 gate 据此给 `explicit`。
- `channel.thread` 决定同 Ticket 同会话的排序（L03 `receipts.behind`）。
- `meta` 只放 Source 私有字段（conversation / messageId / root），因为下面 `scope` 要依赖它，而且 revalidate 会重放它。

### 2.3 Step 4 — `scope` 只吃 `meta` 与配置

`docs/008:138-142`：

```ts
  scope({ meta }, config) {
    const conversation = config.conversations.find(item => item.id === meta.conversation)
    if (!conversation) return { listened: false, reason: 'conversation_not_listed' }
    return { listened: true, observed: conversation.listen === 'all', row: conversation.id }
  },
```

`docs/008:149` 的原话是「Make it depend only on meta and configuration」。原因有两层：① `revalidate` 用 Mandate 里**存下来的 meta** 重放，读外部状态会得到不同结果；② 被过滤的消息**也必须交给 `ctx.receive`**，面板才能用 disposition 解释为什么过滤，所以 `Engine.receive` 有 `'filtered'` 这一返回值。`row` 必须与 Step 7 `policy.rows` 产出的值相同，否则准入表对不上。

### 2.4 Step 5 — `sendWebhook`：幂等与永久失败

`docs/008:163-174`：

```ts
export async function sendWebhook(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const { conversation, message: to } = message.channel.address
  if (!conversation || !to) throw new Error('Missing webhook reply target')
  try {
    await host.commands.run('hookq', ['reply', '--conversation', conversation, '--to', to, '--key', message.id,
      '--text', message.text])
    return 'sent'
  } catch (error) {
    if (error instanceof CliError && error.code === 410) return 'gone'
    throw error
  }
```

`--key message.id` 是幂等键：发送可能在远端已收到之后才失败，重试时必须让远端识别为同一条。只有 `410`（消息被撤回 / Issue 被删这类**永久不可达**）返回 `'gone'`，Outbox 落 `channelGone` / `dropped` 并永不重排；其余失败 `throw`，交给 L03 的 5s → 300s 退避。`SourceRegistry.send` 在 kind 未安装时返回 `'waiting'`（`Later`），保序只限同票同会话。

### 2.5 Steps 6–8 — 上下文、Policy、环境

- `threadContext.read` 给 `orchestrator_eval` 初始窗口与 `eval_read` 翻页，`part ∈ {thread, root, parent}`，消息字段是有界的 `{id, from, at, text, bot?, url?}`；`repliesTo(trigger)` 返回 `key('webhook', meta.replyTo)`。
- `policy.rows(stored)` 用 `ConfigSchema.parse` 为每个 conversation 产行，`cells` 由 `listen === 'all'` 决定 `listedUnaddressed / unlistedUnaddressed`；**`row` 必须等于 `scope` 返回的 `row`**。
- `environment.variables` 前缀 `DSH_SUPERAGENT_<KIND>_`，**绝不放凭据**（凭据由 L06 的 worker shim 负责），非本 Source 的票返回空串。

### 2.6 Step 9 — `apply` / `watch` / `pollQueue`

`docs/008:255-267`：

```ts
export const name = 'dsh-superagent-webhook'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(webhookKind), 'webhook: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, webhookKind)
    const controller = new AbortController()
    // DSH ends its process on an unhandled rejection, so a failure that escapes the loop becomes the Source's health.
    const running = watch(source, controller.signal)
      .catch((error: unknown) => { source.report('webhook', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}
```

注册 kind 与轮询循环都用 `ctx.effect` 登记 disposer，卸载时自动清理。`watch` 里先 `await ctx.ready`、`if (!ctx.configured())` 就 `report('paused','setupPending')` 并返回；连续 3 次失败才 `report('error','pollFailures')`。`AbortController` 让 stop / restart 立即结束循环 —— `signal` 必须同时传给命令与 `delay`。

`docs/008:300-316`：

```ts
export async function pollQueue(ctx: SourceContext, signal: AbortSignal): Promise<{ read: number; unreadable: number }> {
  const after = ctx.state.get(KV.webhook.cursor) ?? 0
  const output = await ctx.commands.withSignal(signal).run('hookq', ['pull', '--after', String(after), '--json'])
  const page = PageSchema.parse(JSON.parse(output))
  let unreadable = 0
  for (const item of page.items) {
    if (signal.aborted) throw new Error('The webhook Source stopped during the read')
    const message = MessageSchema.safeParse(item)
    if (!message.success) { unreadable++; continue }
    const trigger = webhookTrigger(message.data, page.me)
    if (!trigger) continue
    await ctx.receive(trigger)
    const conversation = { label: { zh: '对话', en: 'Conversation' }, value: message.data.conversation }
    for (const ref of trigger.threads) ctx.threads.describe(threadKey(ref), { facts: { conversation } })
  }
  ctx.state.set(KV.webhook.cursor, page.next)
  return { read: page.items.length, unreadable }
}
```

**最后一行 `ctx.state.set(...)` 是全篇最重要的顺序约束**：游标只在所有 `ctx.receive` 都成功之后推进。中断的一轮游标不动，重放时稳定 id 让每条消息都返回 `'duplicate'`，于是既不会丢、也不会重复建单。时间戳游标用 `cursorAt(started)` 减 5 秒容忍远端迟到。`KV.webhook.cursor` 的字面量只允许出现在 `src/kv.ts` 注册表里（`tests/store.spec.ts`）。

### 2.7 Steps 10–11 — 从代码到生效，以及测试断言

`docs/008:339-341,346-349`：

```ts
entry: { index: 'src/index.ts', 'github-watch': 'src/sources/github.ts', 'feishu-watch': 'src/sources/feishu.ts',
  'webhook-watch': 'src/sources/webhook.ts' },
    - id: dsh-superagent-webhook
      name: dsh-superagent/webhook-watch
      disabled: true
```

五步装配：`tsdown.config.ts` entry → `package.json` 的 `"./webhook-watch"` export → `cordis.patch.yml` 插入 `disabled: true` 的插件行（与现有 feishu 行同构）→ profile 里设 `disabled: false` → 构建 + 重启。`ctx.fiber.restart()` 会重新 `lockSync` / 开 Store / 注册 kind。改 Source 账户字段或 setup 等待中的保存也会触发重启（L05/L06）。

`docs/008:388-396` 的测试断言把整条链钉死：

```ts
  expect(await pollQueue(h.ctx, new AbortController().signal)).toEqual({ read: 3, unreadable: 1 })
  expect(await h.receive.mock.results[0]!.value).toBe('stored')
  expect(await h.receive.mock.results[1]!.value).toBe('filtered')
  expect(h.store.get(KV.webhook.cursor)).toBe(3)
  // An allowed sender who mentions the agent makes an explicit request.
  expect(h.engine.candidate(key('webhook', 'm1'))?.strength).toBe('explicit')
```

`tests/webhook.spec.ts` 用真实 Store + stand-in ports 跑完整链路；`tests/docs.spec.ts` 检查 `docs/007` 的 Modules / Tests 两张索引表是否完整 —— 加模块就必须补文档，这是架构文档的活校验。**Source 不能自己结束工单**：`Engine.decide` 在一个事务里造 Ticket + 首 Assignment + acknowledgement reply，Ticket 何时结束仍由 Engine 决定。

## 3. 实验 A · 稳定 id + 去重 + scope + 游标 模拟器

```js
const key = (kind, id) => `${kind}:${id}`;
const config = { conversations: [{ id: 'ops', listen: 'all' }] };
const triggers = new Map(), dispositions = new Map(), state = new Map();
const received = [];

function webhookTrigger(m, me) {
  if (m.sender === me) return undefined;                  // 防环
  const thread = `${m.conversation}:${m.thread ?? m.id}`;
  return { id: key('webhook', m.id), meta: { conversation: m.conversation },
    thread, addressed: m.mentions_me ? 'mention' : undefined };
}
function scope({ meta }, cfg) {
  const c = cfg.conversations.find(x => x.id === meta.conversation);
  if (!c) return { listened: false, reason: 'conversation_not_listed' };
  return { listened: true, observed: c.listen === 'all', row: c.id };
}
function receive(t) {
  if (triggers.has(t.id)) return 'duplicate';
  triggers.set(t.id, t);
  const s = scope(t, config);
  dispositions.set(t.id, s.listened ? 'stored' : 'filtered:' + s.reason);
  return s.listened ? 'stored' : 'filtered';
}
function pollQueue(page, me) {
  const after = state.get('cursor') ?? 0;
  if (after >= page.next) return { read: 0, unreadable: 0 };
  let unreadable = 0;
  for (const item of page.items) {
    if (item.broken) { unreadable++; continue; }
    const t = webhookTrigger(item, me);
    if (!t) continue;
    received.push(receive(t));
  }
  state.set('cursor', page.next);                        // 全部 receive 之后才推进
  return { read: page.items.length, unreadable };
}
const page = { next: 3, me: 'bot', items: [
  { id: 'm1', conversation: 'ops', sender: 'alice', mentions_me: true },
  { broken: true },
  { id: 'm2', conversation: 'random', sender: 'alice' }
] };
console.log('第一轮 =', pollQueue(page, 'bot'), 'receive =', received, 'cursor =', state.get('cursor'));
console.log('自己发的 =', webhookTrigger({ id: 'm3', conversation: 'ops', sender: 'bot' }, 'bot'));
state.set('cursor', 0);                                   // 模拟中断后重放同一页
console.log('重放 =', pollQueue(page, 'bot'), 'receive =', received.slice(3));
console.log('稳定 id =', webhookTrigger({ id: 'm1', conversation: 'ops', sender: 'alice' }, 'bot').id);
```

**断言**：第一轮 `{read: 3, unreadable: 1}`、`receive = ['stored','filtered']`、`cursor = 3`；自己发的返回 `undefined`；游标不动时重放同一页全部为 `duplicate`；同一消息两次映射得到同一个稳定 id。

## 4. 实验 B · 幂等收据 + gone / retry / 排序 模拟器

```js
const receipts = new Map(), effects = [], remote = [];
const FAILURES_BEFORE_ERROR = 3;
let mode = 'success', clock = 0;

function Outbox_send(m) {                                // receipt + effect 同事务
  if (receipts.has(m.id)) return false;
  receipts.set(m.id, { id: m.id, status: 'pending', attempts: 0, ticket: m.ticket });
  effects.push({ kind: 'reply', key: m.id });
  return true;
}
function delay(attempts) { return Math.min(300000, 5000 * 2 ** Math.min(attempts, 16)); }
function deliver(id) {
  const r = receipts.get(id);
  if (!r || r.status !== 'pending') return 'skip';
  const earlier = [...receipts.values()].find(x => x.ticket === r.ticket && x.id < id && x.status === 'pending');
  if (earlier && earlier.attempts >= FAILURES_BEFORE_ERROR) { /* 前面的失败 3 次后放行 */ }
  else if (earlier) return 'Later: behind(' + earlier.id + ')';
  if (mode === 'gone') { r.status = 'channelGone'; return 'gone（永不重排）'; }
  if (mode === 'error') {
    r.attempts += 1; r.due = clock + delay(r.attempts);
    return 'throw → attempts=' + r.attempts + ', due=+' + delay(r.attempts);
  }
  if (!remote.includes(id)) remote.push(id);           // --key message.id 远端去重
  r.status = 'sent';
  return 'sent';
}
console.log(Outbox_send({ id: 'm1', ticket: 'tk-1' }), Outbox_send({ id: 'm1', ticket: 'tk-1' }));
console.log('effect 行数 =', effects.length, '| deliver =', deliver('m1'), '| remote =', remote);
mode = 'error';
console.log(Outbox_send({ id: 'm2', ticket: 'tk-2' }), deliver('m2'), deliver('m2'), deliver('m2'));
console.log('m2 attempts =', receipts.get('m2').attempts, '（达 3 次后 health 报错）');
mode = 'gone';
console.log(Outbox_send({ id: 'm3', ticket: 'tk-3' }), deliver('m3'));
console.log('重排 m3 →', deliver('m3'));
console.log(Outbox_send({ id: 'm4', ticket: 'tk-4' }), Outbox_send({ id: 'm5', ticket: 'tk-4' }));
console.log('同票后一条先送 →', deliver('m5'));          // behind 保序
```

**断言**：同 `id` 连发两次只有一行 effect、远端只出现一次；瞬时抛错 `attempts+1` 且 `delay` 从 5000 指数增长、封顶 300000；`410` 落 `channelGone` 且永不重排；同 Ticket 后一条被 `behind` 阻塞（`Later`），前一条失败 3 次后放行。

## 5. 自检清单

- [ ] 能写出 Step 1 映射表的五项并解释为什么不可改。
- [ ] 能逐行解释 `webhookTrigger` 的稳定 id、防环、`addressed`、`channel.thread`。
- [ ] 能说明 `scope` 为何只能依赖可持久化的 `meta` 与配置，以及 `row` 与 `policy.rows` 的关系。
- [ ] 能区分 `'sent'` / `'gone'` / 抛错三种发送结果及其后果。
- [ ] 能解释游标为什么必须在所有 `receive` 之后推进，与稳定 id 如何配合。
- [ ] 能列出从代码到生效的 5 个装配动作，并复述 4 条测试断言。

## 6. 回到动态演示

| 步骤 | 对应源码 |
|---|---|
| 1–2 Step 1/2 映射与 ConfigSchema | `docs/008:21,47-54,79` |
| 3 Step 3 webhookTrigger | `docs/008:100-117` |
| 4 Step 4 scope | `docs/008:138-142,145,149` |
| 5 Step 5 sendWebhook | `docs/008:163-179` |
| 6–7 Step 6-8 上下文 / policy / environment | `docs/008:185-200,215-250` |
| 8–10 Step 9 apply / watch / 游标 | `docs/008:255-267,289-291,300-324` |
| 11–13 Step 10 构建与重启 | `docs/008:336-343,345-349,351` |
| 14–16 端到端链路 | `docs/008:362-400,396,332`、`src/core/engine.ts:48` |
| 17–18 Outbox / delivery | `src/app/outbox.ts:27-31`、`src/sources/registry.ts:95-98` |
| 19 gone → dropped | `docs/008:163-179`、`src/app/outbox.ts:45-48` |
| 20 Step 11 测试与文档索引 | `docs/008:353,413-425`、`tests/docs.spec.ts` |
