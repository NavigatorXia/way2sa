# L05 代码教程 · 面板与人的交互

片段逐字抄自 `dsh-superagent-prototype`。实验代码纯 JS，可直接 `node` 运行。

## 1. 源码地图

| 路径 | 符号 | 看什么 |
|---|---|---|
| `src/app/api.ts` | `Api` / `ApiRequest` / `ApiResponse` | 面板↔宿主的 type-only 路由清单 |
| `src/app/http.ts` | `sameOrigin` / `registerHttp` / `failure` / `stateView` / `routes` | 同源守卫、403、错误映射、读视图入口 |
| `src/app/views/records.ts` | `ViewHost` / `snapshot` / `page` | 只读投影与分页 |
| `src/app/views/overview.ts` | `overview()` | problems / person / flow 的组装 |
| `src/app/settings.ts` | `Settings.save` | `stale()`、origin guard、`restarting` |
| `src/app/notices.ts` | `settingsNotice` / `promptsNotice` | 写命令后的 `next-request` 通知 |
| `src/client/api.ts` | `api()` / `caller()` / `usePoll` / `ApiError` | 同源头、串行轮询、隐藏页退避 |
| `src/client/provider.tsx` | `useAction` / `PanelProvider` | 防重入 + 强制 `reload()` |
| `src/client/draft.tsx` | `useDraft` / `draftReducer` / `merge3` / `SaveBar` | 乐观并发与三方 rebase |

## 2. 逐段精读

### 2.1 `Api` — 一份类型契约切开两端

`src/app/api.ts:20-46`：

```ts
  'POST executor/pause': { body: { paused: boolean }; response: { paused: boolean } }
  'PUT settings/:block': { body: { value: unknown; revision: number }; response: { revision: number; restarting: boolean } }
  'GET policy/history': { response: HistoryView }
  'POST setup/check': { response: { restarting: true } }
```

每个 key 形如 `'VERB path'`，`body` / `query` / `response` 齐全。`caller()` 由此推导参数与响应类型。**关键是 `import type`**：客户端只吃类型，不打包宿主实现。注意 `PUT settings/:block` 的 `revision` 与 `PUT prompts` 的 `baseRevision` —— 它们是乐观并发的载体。

### 2.2 `sameOrigin` — 管理 API 的准入判据

`src/app/http.ts:75-79`：

```ts
export function sameOrigin(req: Pick<IncomingMessage, 'headers'>, port: number): boolean {
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false
  return req.headers['x-orchestrator-request'] === '1' && (req.headers.origin === undefined || req.headers.origin === `http://${host}`)
}
```

三项判据：loopback host 严格相等、头值必须是字符串 `'1'`、`Origin` 缺省或恰为 `http://<host>`。`registerHttp` 还先行检查 `ctx.webServer.host !== '127.0.0.1'` 就拒绝挂载，失败时 `json(res, 403, ...)`。这解释了 L06 里 `scripts/dsh-superagent` 的 `state(url)` 为何必须带同一个头：

```python
request = urllib.request.Request(url.rstrip('/') + '/orchestrator/api/state',
                                 headers={'x-orchestrator-request': '1'})
```

### 2.3 `failure()` — 状态码是错误类型的函数

`src/app/http.ts:81-90`：

```ts
function failure(error: unknown): [number, Record<string, unknown>] {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
    return [400, { error: `Invalid settings: ${issues.map(issue => issue.path).join(', ')}`, issues }]
  }
  if (error instanceof SetupError) return [400, { error: error.message, setup: error.problem }]
  if (error instanceof RouteError) return [error.status, { error: error.message }]
```

后半段是 `UserError.missing → 404`、`SettingsConflict / PromptConflict → 409`、其余 `500`。`SetupError` 额外带 `setup` 问题对象，`ZodError` 带 `issues[].path`，所以面板能把错误本地化并跳到对应设置页。**唯一的映射点**意味着客户端只需处理四种结构化结果。

### 2.4 `stateView` 与 `ViewHost` — 读侧只读一次

`src/app/http.ts:105-110`：

```ts
export function stateView(runtime: HttpHost) {
  const settings = runtime.store.settings()
  return { setup: setupView(runtime), load: { ...executorLoad(runtime.store, runtime.executor.activeCount()),
    maxWorkers: settings.executor.maxWorkers },
    masterId: runtime.masterId, paused: settings.paused, health: runtime.health }
}
```

`src/app/views/records.ts:12-14`：

```ts
export type LinkTarget = (channel: ChannelRef) => ChannelLink
export interface ViewHost { store: Store; sources: SourceRegistry; links: LinkTarget }
export const page = <T>(items: T[], offset: number, limit: number) => ({ items: items.slice(offset, offset + limit), total: items.length, next_offset: offset + limit < items.length ? offset + limit : null })
```

`ViewHost` 只有 `store / sources / links` 三个窄接口；`snapshot()` 用 Map 去重（`ownersOf` / `threadsOf`），保证「一次请求内相关记录只读一次」。这正是 `docs/005` 里「A count equals the length of the list it links to」能成立的原因：数字与列表来自同一个快照。`stateView` 同时是 CLI `status` 的数据源 —— 面板与运维看到的是同一份事实。

### 2.5 `api()` / `usePoll` — 客户端的同源头与回刷

`src/client/api.ts:33-40`：

```ts
async function api<T>(messages: ApiMessages, path: string, method: string, body?: unknown): Promise<T> {
  let response: Response
  const json = body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  try {
    response = await fetch(`/orchestrator/api/${path}`, { method, ...json, headers: { 'x-orchestrator-request': '1', ...json.headers } })
  } catch {
    throw new ApiError(messages.offline, 0, { unreachable: true })
  }
```

`usePoll`（`:60-98`）用 `queue = queue.then(once)` 串行化请求，跨依赖变化丢弃过期响应，出错时**保留上一次成功的数据**；`HIDDEN_FACTOR = 6`，`document.hidden` 时把 5000ms 乘 6，restart 期间降到 1000ms。空 404 被标成 `unreachable`（重启中路由未挂载），注释明确提醒不要当成「记录不存在」。

### 2.6 `useAction` / `useDraft.submit` — 写命令闭环

`src/client/provider.tsx:41-51`：

```ts
export function useAction<A extends unknown[]>(action: (...args: A) => Promise<unknown>,
  { reload }: { reload?: () => Promise<unknown> } = {}) {
  const { notify } = usePanel()
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const run = async (...args: A): Promise<boolean> => {
```

核心在 `:51`：`try { await action(...args); await reload?.(); return true }`。`ExecutionStatus` 的暂停按钮甚至只有一行 `await call('POST executor/pause', ...); await reload()`。

`src/client/draft.tsx:150-155`：

```ts
  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const { draft } = state
    if (state.phase !== 'editing' || !draft) return
    dispatch({ type: 'submit' })
    let result: { revision: number; restarting?: boolean }
```

`phase !== 'editing'` 是防重入。`:156-168` 里成功时按 `restarting` 选 `restart()` 或 `await reload()`；409 时 `await reload().then(...)` 并置 `rebasing`，`merge3(mine, base, saved)` 保留草稿；400/404 保留草稿并 `notify(errorText(...))`。`SaveBar` 的显隐是 `shown = dirty || busy || line.error` —— 平静时不占空间。

### 2.7 服务端 `Settings.save` 与通知

`src/app/settings.ts:148-195`：先 `stale(revision)`（不匹配抛 `SettingsConflict`），再做 origin guard —— 非 panel 来源不得改执行环境与账户字段；成功返回 `{ revision, restarting }`。`restarting = setupChanged(old, settings) || !setup.configured()`。随后 `src/app/notices.ts:14-32` 写入 `settingsNotice`，带 `effect:'next-request'` 与 `context_delivery: 'injected' | 'pending'`，由 Effects 送进主 Session 上下文。这与 L04 的 `promptsNotice` 是同一套机制。

## 3. 实验 A · 读视图 → 写命令 → 回刷 单机模拟器

```js
let view = { revision: 0, paused: false };
let draft = null;
const log = [];

function sameOrigin(req) {
  const okHost = req.host === '127.0.0.1:3082' || req.host === 'localhost:3082';
  return okHost && req.header === '1' && (req.origin === undefined || req.origin === `http://${req.host}`);
}
function GET_state(req) {
  if (!sameOrigin(req)) return { status: 403 };
  return { status: 200, body: { ...view } };
}
function PUT_settings(req) {
  if (!sameOrigin(req)) return { status: 403 };
  if (req.body.revision !== view.revision) return { status: 409, body: { ...view } };
  if (req.body.value === null) return { status: 400, body: { error: 'ZodError: value' } };
  view = { ...view, ...JSON.parse(JSON.stringify(req.body.value)), revision: view.revision + 1 };
  return { status: 200, body: { revision: view.revision, restarting: false } };
}
function merge3(mine, base, saved) {                  // 三方 rebase 的最小版
  const out = { ...saved };
  for (const k of Object.keys(mine)) if (JSON.stringify(mine[k]) !== JSON.stringify(base[k])) out[k] = mine[k];
  return out;
}
async function submit(next) {
  const base = { paused: view.paused };
  const mine = { paused: next };
  const res = PUT_settings({ host: '127.0.0.1:3082', header: '1', body: { value: mine, revision: draft.revision } });
  log.push('PUT → ' + res.status);
  if (res.status === 409) {                          // 并发保存：保留草稿
    draft = { value: merge3(mine, base, { paused: res.body.paused }), revision: res.body.revision };
    log.push('rebasing, 草稿保留 = ' + JSON.stringify(draft.value));
  } else if (res.status === 200) {
    draft = { value: mine, revision: res.body.revision };
  }
  await reload();                                    // 成功 / 409 / 400 都回刷
  return res.status;
}
async function reload() {
  const res = GET_state({ host: '127.0.0.1:3082', header: '1' });
  draft = { value: { paused: res.body.paused }, revision: res.body.revision };
  log.push('reload → revision ' + draft.revision);
}
function saveBar(state) { return state.dirty || state.busy || state.error; }

(async () => {
  await reload();
  draft = { value: { paused: true }, revision: draft.revision };
  await submit(true);
  console.log('view =', view, 'log =', log);
  console.log('SaveBar(dirty=false,busy=false,error=false) =', saveBar({ dirty: false, busy: false, error: false }));
  // 模拟并发：另一处先把 revision 推到 2
  view = { ...view, revision: view.revision + 1 };
  draft = { value: { paused: false }, revision: 1 };
  await submit(false);
  console.log('并发后 log =', log.slice(-3));
  console.log('外站 Origin =', GET_state({ host: '127.0.0.1:3082', header: '1', origin: 'http://evil.example' }).status);
})();
```

**断言**：成功保存后 `revision` 递增且 `reload()` 被调用；并发场景返回 409 且草稿字段不丢；`SaveBar` 在平静时为 `false`；外站 `Origin` 得到 403。

## 4. 实验 B · 诚实状态与计数一致性

```js
const dropped = ['m1', 'm2', 'm3'];
const overview = { dropped: dropped.length, problems: [] };
let consecutiveFailures = 0;

function healthSlot(problems) { return problems.length === 0 ? 0 : problems.length; } // 健康态零高度
function observeNetwork(ok) {
  if (ok) { consecutiveFailures = 0; return; }
  consecutiveFailures += 1;
  if (consecutiveFailures >= 3) overview.problems.push({ kind: 'outgoing', detail: '连续 3 次' });
}
function pollInterval(hidden, restarting) {
  const base = restarting ? 1000 : 5000;
  return hidden ? base * 6 : base;
}
function detectRestart(prev, now) { return prev === false && now === true; }

console.assert(overview.dropped === dropped.length, '计数必须等于列表长度');
observeNetwork(false);
console.assert(overview.problems.length === 0, '一次性网络错误不算问题');
console.assert(healthSlot(overview.problems) === 0, '健康态不占空间');
observeNetwork(false); observeNetwork(false);
console.assert(overview.problems.length === 1, '连续三次才报问题');
console.log('interval(默认) =', pollInterval(false, false));
console.log('interval(隐藏页) =', pollInterval(true, false));
console.log('interval(restart) =', pollInterval(false, true));
console.log('down→up 触发 restarts++ ?', detectRestart(false, true));
console.log('dropped =', overview.dropped, 'problems =', JSON.stringify(overview.problems));
```

**断言**：`overview.dropped === dropped.length`；一次失败不进 problems，连续三次才进；健康时占位高度为 0；`5000 / 30000 / 1000` 三种轮询间隔；`error` 由 `false → true → false` 后 `restarts++` 触发视图重新订阅。

## 5. 自检清单

- [ ] 能说出 `sameOrigin()` 三项判据和 `registerHttp` 额外的 loopback 检查。
- [ ] 能列出 400/404/409/500 各自对应的错误类型。
- [ ] 能解释 `stateView` 为何同时服务面板与 CLI `status`。
- [ ] 能解释 `usePoll` 保留上次成功值、空 404 视为 `unreachable` 的原因。
- [ ] 能写出 `merge3(mine, base, saved)` 在 409 时保住哪些编辑。
- [ ] 能复述 `docs/005` 三条显示原则并转成断言。

## 6. 回到动态演示

| 步骤 | 对应源码 |
|---|---|
| 1 打开面板 | `src/client/route.ts:7-17` |
| 2–3 轮询与 call | `src/client/provider.tsx:89`、`src/client/api.ts:33-40,60-98` |
| 4–5 同源守卫与路由 | `src/app/http.ts:75-79,97-110,156,230-237` |
| 6–8 只读投影与诚实状态 | `src/app/views/records.ts:12-14,36-68`、`overview.ts:38-79`、`docs/005:56-57` |
| 9 json(200) | `src/app/http.ts:72-74,243` |
| 10–12 动作与写命令 | `src/client/execution.tsx:22`、`settings-kit.tsx:23-41`、`api.ts:108-116` |
| 13–14 `Settings.save` | `src/app/settings.ts:148-195` |
| 15 通知注入 | `src/app/notices.ts:14-32` |
| 16–18 回刷与 409 rebase | `src/client/provider.tsx:41-55`、`draft.tsx:150-168` |
| 19 400/404 refused | `src/app/http.ts:81-90`、`src/client/api.ts:16-24` |
