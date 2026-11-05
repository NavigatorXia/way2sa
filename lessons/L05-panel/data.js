window.Course.boot({
  id: 'L05', title: '面板与人的交互', tag: '注意力预算', doc: '005-panel.md',
  subtitle: 'docs/005 的原则是「少显示」而不是「多显示」：面板是一套只读视图 + 带 revision 的写命令 + 轮询回刷的闭环。',
  goal: '掌握从打开面板到一次设置保存的完整链路，理解 loopback 同源管理 API 的错误语义，以及并发保存时草稿如何三方 rebase。',
  questions: [
    '从 GET state 读视图，到 PUT settings/:block 写命令，再到 reload 回刷，中间经过哪些模块？',
    '400 / 404 / 409 / 500 分别由哪些错误类型映射而来？空 404 为什么不能当成「记录不存在」？',
    '面板为什么刻意「少显示」：计数、健康态、一次性网络错误各有什么规矩？'
  ],
  lanes: ['人与浏览器', '客户端 React', 'HTTP 管理 API', '只读视图 / Store', '主 Session / 结果'],
  nodes: [
    { id: 'human', label: '人', sub: '打开面板', lane: 0, col: 0, kind: 'human' },
    { id: 'panel', label: 'Panel App', sub: 'Tabs · Header · 术语表', lane: 1, col: 0, kind: 'host' },
    { id: 'draft', label: 'useDraft', sub: 'merge3 · SaveBar', lane: 1, col: 1, kind: 'host' },
    { id: 'provider', label: 'usePoll / useAction', sub: '5s · 隐藏页 6×', lane: 1, col: 2, kind: 'host' },
    { id: 'api', label: 'client api()', sub: 'x-orchestrator-request', lane: 2, col: 1, kind: 'host' },
    { id: 'http', label: 'sameOrigin / failure', sub: '403 · 400/404/409/500', lane: 2, col: 2, kind: 'host' },
    { id: 'routes', label: 'routes()', sub: 'GET / PUT / POST', lane: 2, col: 3, kind: 'host' },
    { id: 'overview', label: 'OverviewView', sub: 'problems · person · flow', lane: 3, col: 0, kind: 'kernel', carry: true },
    { id: 'views', label: '只读视图投影', sub: 'ViewHost · snapshot · page', lane: 3, col: 1, kind: 'kernel' },
    { id: 'store', label: 'Store / Settings', sub: 'block revision', lane: 3, col: 2, kind: 'host', carry: true },
    { id: 'session', label: '主 Session', sub: 'notices 注入', lane: 3, col: 4, kind: 'host', carry: true },
    { id: 'health', label: 'Health', sub: '诚实状态', lane: 4, col: 0, kind: 'host' },
    { id: 'settings', label: 'Settings.save', sub: 'stale() · origin guard', lane: 4, col: 2, kind: 'host' },
    { id: 'actions', label: '破坏性操作', sub: 'Retry / Stop / Pause 需确认', lane: 4, col: 4, kind: 'human' }
  ],
  edges: [
    { from: 'human', to: 'panel', label: '打开' },
    { from: 'panel', to: 'provider', label: 'GET state' },
    { from: 'provider', to: 'api', label: 'call' },
    { from: 'api', to: 'http', label: 'fetch' },
    { from: 'http', to: 'routes', label: 'match' },
    { from: 'routes', to: 'views', label: 'views' },
    { from: 'views', to: 'overview', label: '组装' },
    { from: 'overview', to: 'health', label: '诚实状态' },
    { from: 'health', to: 'panel', label: 'json(200)' },
    { from: 'human', to: 'actions', label: '确认' },
    { from: 'actions', to: 'draft', label: '写命令' },
    { from: 'draft', to: 'api', label: 'PUT + revision' },
    { from: 'api', to: 'settings', label: 'save' },
    { from: 'settings', to: 'store', label: '写入' },
    { from: 'store', to: 'session', label: 'notice' },
    { from: 'session', to: 'provider', label: 'reload' },
    { from: 'provider', to: 'views', label: '重取视图' },
    { from: 'settings', to: 'draft', label: '409 rebase' },
    { from: 'http', to: 'draft', label: '400/404' }
  ],
  steps: [
    { n: 1, from: 'human', to: 'panel', label: '打开 Superagent 面板', kind: 'fact', note: 'App / Pages 按 route 渲染 Overview，Header 提供搜索与术语表；TABS 与设置分组在 route.ts 里定义。', state: 'view', code: 'api-contract', ref: 'src/client/route.ts:7-17' },
    { n: 2, from: 'panel', to: 'provider', label: 'PanelProvider 每 5000ms 轮询', kind: 'command', note: 'restart 时降到 1000ms；document.hidden 时把间隔乘 6，避免后台标签页空转。', state: 'view', code: 'client-api', ref: 'src/client/provider.tsx:89' },
    { n: 3, from: 'provider', to: 'api', label: 'call("GET state")', kind: 'command', note: '客户端只 import 宿主的 type-only Api 契约，不打包宿主代码；请求出错时保留上次成功的数据。', state: 'view', code: 'client-api', ref: 'src/client/api.ts:33-40' },
    { n: 4, from: 'api', to: 'http', label: '同源守卫 + 请求头', kind: 'message', note: 'host 必须是 127.0.0.1:<port> / localhost:<port>，带 x-orchestrator-request: 1；外站 Origin 返回 403。', state: 'view', code: 'same-origin', ref: 'src/app/http.ts:75-79' },
    { n: 5, from: 'http', to: 'routes', label: '匹配 GET state / GET overview', kind: 'fact', note: 'registerHttp 在 setup 完成之前就注册好 /orchestrator 路由，好让运维能在 UI 里修 setup 问题。', state: 'view', code: 'state-view', ref: 'src/app/http.ts:97-110,156' },
    { n: 6, from: 'routes', to: 'views', label: 'stateView + 只读投影', kind: 'fact', note: 'ViewHost={store,sources,links}；snapshot 提供 threadsOf/rule/actor/owners，page() 一次请求只读一次并返回 next_offset。', state: 'view', code: 'view-host', ref: 'src/app/views/records.ts:12-14,36-68' },
    { n: 7, from: 'views', to: 'overview', label: '组装 problems / person / flow', kind: 'fact', note: 'Overview 回答两个问题：「现在需要我吗」「系统健康吗」；数字必须等于它链接到的列表长度。', state: 'view', code: 'state-view', ref: 'src/app/views/overview.ts:38-79' },
    { n: 8, from: 'overview', to: 'health', label: '诚实状态：健康态不占空间', kind: 'fact', note: '问题必须可行动；一次性网络错误不算问题；dropped 计数必须恰好等于 Source 页 dropped 列表长度。', state: 'view', code: 'state-view', ref: 'docs/005-panel.md:56-57' },
    { n: 9, from: 'health', to: 'panel', label: 'json(200, view)', kind: 'message', note: '每个页面都读 GET state；同一个 stateView 也是 scripts/dsh-superagent status 的数据源。', state: 'view', code: 'state-view', ref: 'src/app/http.ts:72-74,243' },
    { n: 10, from: 'human', to: 'actions', label: '点 Retry / Stop / Pause', kind: 'event', note: '破坏性操作必须二次确认；SaveBar 只在 dirty / busy / error 时出现。', state: 'view', code: 'use-draft', ref: 'src/client/execution.tsx:22,35-37' },
    { n: 11, from: 'actions', to: 'draft', label: '转成写命令', kind: 'command', note: 'POST executor/pause、PUT settings/:block 或 PUT prompts；草稿带 baseRevision，提交时 phase 变 saving 防重入。', state: 'write', code: 'use-draft', ref: 'src/client/settings-kit.tsx:37-41' },
    { n: 12, from: 'draft', to: 'api', label: 'caller() 拼路径 + query', kind: 'message', note: 'api() 带同源头发出 PUT/POST；caller 把 :block 这类路径参数替换掉。', state: 'write', code: 'client-api', ref: 'src/client/api.ts:108-116' },
    { n: 13, from: 'api', to: 'settings', label: 'Settings.save(block, value, revision)', kind: 'command', note: '先查 stale()（冲突抛 SettingsConflict → 409），再做 origin guard：非 panel 来源不得改执行环境与账户字段。', state: 'accepted', code: 'failure', ref: 'src/app/settings.ts:148-195' },
    { n: 14, from: 'settings', to: 'store', label: '写 store，返回新 revision', kind: 'fact', note: '成功返回 {revision, restarting}；若改了 SETUP_FIELDS 或 setup 尚未 configured，会触发 setup 重跑与重启。', state: 'accepted', code: 'state-view', ref: 'src/app/settings.ts:176,193-194' },
    { n: 15, from: 'store', to: 'session', label: 'settingsNotice 注入主 Session', kind: 'message', note: '通知带 effect:next-request 与 context_delivery:injected|pending；写命令完成后由 Effects 送进主 Session 上下文。', state: 'accepted', code: 'api-contract', ref: 'src/app/notices.ts:14-32' },
    { n: 16, from: 'session', to: 'provider', label: 'useAction / useDraft 强制 reload()', kind: 'command', note: 'await action() 之后一定 await reload()；成功与 409 都会回刷，草稿在 409 时做 merge3 三方 rebase。', state: 'refresh', code: 'use-draft', ref: 'src/client/provider.tsx:41-55' },
    { n: 17, from: 'provider', to: 'views', label: 'usePoll 重取，restart 时 1s', kind: 'effect', note: '检测 error 由 false→true→false 后 restarts++，依赖变化触发视图重新订阅；30 秒超时。', state: 'view', code: 'client-api', ref: 'src/client/provider.tsx:85-98' },
    { n: 18, from: 'settings', to: 'draft', label: '409：保留草稿并 rebasing', kind: 'event', note: 'stale revision 时不丢用户编辑：notify 显示冲突，merge3 把 mine / base / saved 合并；400/404 则保留草稿并提示 errorText。', state: 'conflict409', code: 'failure', ref: 'src/client/draft.tsx:150-168' },
    { n: 19, from: 'http', to: 'draft', label: '400/404：refused，草稿不丢', kind: 'event', note: 'ZodError / UserError / SetupError / RouteError → 400，UserError.missing → 404。客户端 notify(errorText(failure)) 并保留草稿，SaveBar 因 line.error 继续可见；空 404 则是重启中路由未挂载，标 unreachable。', state: 'refused', code: 'failure', ref: 'src/app/http.ts:81-90、src/client/api.ts:16-24' }
  ],
  states: {
    nodes: [
      { id: 'view', label: 'view · 持有 revision', c: 0, r: 0 },
      { id: 'write', label: 'write · saving', c: 1, r: 0 },
      { id: 'accepted', label: 'accepted · 200', c: 2, r: 0 },
      { id: 'conflict409', label: 'conflict · 409', c: 2, r: 1 },
      { id: 'refused', label: 'refused · 400/404', c: 1, r: 1 },
      { id: 'refresh', label: 'refresh · reload()', c: 0, r: 1 }
    ],
    transitions: [
      { from: 'view', to: 'write', label: '人点 Save' },
      { from: 'write', to: 'accepted', label: 'revision 匹配 + guard 通过' },
      { from: 'write', to: 'conflict409', label: 'stale() → SettingsConflict' },
      { from: 'write', to: 'refused', label: 'ZodError / UserError / SetupError' },
      { from: 'conflict409', to: 'refresh', label: 'reload() + merge3' },
      { from: 'refused', to: 'view', label: 'notify，保留草稿' },
      { from: 'accepted', to: 'refresh', label: 'await reload()' },
      { from: 'refresh', to: 'view', label: 'usePoll 重取视图' }
    ]
  },
  snippets: [
    { id: 'api-contract', symbol: 'Api (type-only)', path: 'src/app/api.ts',
      code: [
        "  'POST executor/pause': { body: { paused: boolean }; response: { paused: boolean } }",
        "  'PUT settings/:block': { body: { value: unknown; revision: number }; response: { revision: number; restarting: boolean } }",
        "  'GET policy/history': { response: HistoryView }",
        "  'POST setup/check': { response: { restarting: true } }"
      ].join('\n'),
      why: '面板与宿主之间的全部契约；客户端只 import 类型，不打包宿主实现。' },
    { id: 'same-origin', symbol: 'sameOrigin', path: 'src/app/http.ts',
      code: [
        "export function sameOrigin(req: Pick<IncomingMessage, 'headers'>, port: number): boolean {",
        '  const host = req.headers.host',
        '  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false',
        "  return req.headers['x-orchestrator-request'] === '1' && (req.headers.origin === undefined || req.headers.origin === `http://${host}`)"
      ].join('\n'),
      why: '管理 API 不靠登录态，靠 loopback + 头 + Origin 白名单；缺一即 403。' },
    { id: 'failure', symbol: 'failure()', path: 'src/app/http.ts',
      code: [
        'function failure(error: unknown): [number, Record<string, unknown>] {',
        '  if (error instanceof z.ZodError) {',
        "    const issues = error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))",
        "    return [400, { error: `Invalid settings: ${issues.map(issue => issue.path).join(', ')}`, issues }]",
        '  }',
        "  if (error instanceof SetupError) return [400, { error: error.message, setup: error.problem }]"
      ].join('\n'),
      why: '错误类型到状态码的单一映射点；409 来自 SettingsConflict / PromptConflict。' },
    { id: 'state-view', symbol: 'stateView', path: 'src/app/http.ts',
      code: [
        'export function stateView(runtime: HttpHost) {',
        '  const settings = runtime.store.settings()',
        '  return { setup: setupView(runtime), load: { ...executorLoad(runtime.store, runtime.executor.activeCount()),',
        '    maxWorkers: settings.executor.maxWorkers },',
        '    masterId: runtime.masterId, paused: settings.paused, health: runtime.health }',
        '}'
      ].join('\n'),
      why: '每个页面都读它，CLI status 也读它 —— 面板与运维看到的是同一份事实。' },
    { id: 'view-host', symbol: 'ViewHost / page', path: 'src/app/views/records.ts',
      code: [
        'export type LinkTarget = (channel: ChannelRef) => ChannelLink',
        'export interface ViewHost { store: Store; sources: SourceRegistry; links: LinkTarget }',
        'export const page = <T>(items: T[], offset: number, limit: number) => ({ items: items.slice(offset, offset + limit), total: items.length, next_offset: offset + limit < items.length ? offset + limit : null })'
      ].join('\n'),
      why: '视图是只读投影：一次请求读一次快照，分页返回 next_offset，不改写任何领域状态。' },
    { id: 'client-api', symbol: 'api() / usePoll', path: 'src/client/api.ts',
      code: [
        'async function api<T>(messages: ApiMessages, path: string, method: string, body?: unknown): Promise<T> {',
        '  let response: Response',
        "  const json = body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }",
        '  try {',
        "    response = await fetch(`/orchestrator/api/${path}`, { method, ...json, headers: { 'x-orchestrator-request': '1', ...json.headers } })",
        '  } catch {'
      ].join('\n'),
      why: '客户端统一注入同源头；注释还提醒空 404 可能来自重启时路由未挂载，不能当成记录不存在。' },
    { id: 'use-draft', symbol: 'useDraft.submit / useAction', path: 'src/client/draft.tsx',
      code: [
        '  const submit = async (event?: FormEvent) => {',
        '    event?.preventDefault()',
        '    const { draft } = state',
        "    if (state.phase !== 'editing' || !draft) return",
        "    dispatch({ type: 'submit' })",
        '    let result: { revision: number; restarting?: boolean }'
      ].join('\n'),
      why: 'phase 防重入；409 也走 reload + merge3，保证并发保存不丢人的编辑。' }
  ],
  glossary: [
    { term: 'Api', desc: '面板↔宿主的 type-only 路由清单，客户端 import 而不打包宿主代码。', src: 'src/app/api.ts:20-46' },
    { term: 'sameOrigin', desc: 'loopback host + x-orchestrator-request:1 + Origin 白名单。', src: 'src/app/http.ts:75-79' },
    { term: 'failure()', desc: '错误 → 400/404/409/500 的状态码映射。', src: 'src/app/http.ts:81-91' },
    { term: 'StateView', desc: '每个页面都读的状态；也是 CLI status 的数据源。', src: 'src/app/http.ts:97-110' },
    { term: 'ViewHost', desc: '只读视图投影的宿主窄接口：store / sources / links。', src: 'src/app/views/records.ts:12-14' },
    { term: 'OverviewView', desc: 'problems / person / executor / flow / policyVersion。', src: 'src/app/views/overview.ts:38-79' },
    { term: 'usePoll', desc: '5s 轮询、隐藏页 6 倍退避、重启检测 restarts++。', src: 'src/client/api.ts:60-98' },
    { term: 'useDraft / merge3', desc: '草稿持久化、三方 rebase、乐观并发。', src: 'src/client/draft.tsx:21-108' },
    { term: 'useAction', desc: '动作包装：防重入 + 强制 await reload()。', src: 'src/client/provider.tsx:41-55' },
    { term: 'SaveBar', desc: 'shown = dirty || busy || line.error，只在有变化 / 保存中 / 失败时出现。', src: 'src/client/draft.tsx:176-203' },
    { term: 'Notice', desc: '写命令后注入主 Session 的通知，effect:next-request。', src: 'src/app/notices.ts:14-32' },
    { term: 'context_delivery', desc: 'injected / pending，表示通知是否已进入主 Session 上下文。', src: 'src/app/notices.ts' }
  ],
  pitfalls: [
    '面板 API 不靠登录态，靠 loopback + 头；而且 API 保存比主 Session 工具保存权限更大（可改执行环境与账户字段）。',
    '面板刻意少显示：计数必须等于列表长度、健康态不占额外空间、一次性网络错误不算问题；破坏性操作必须确认。',
    '已投递给工单的人工跟进没有 Eval/Decision；「重新评估」的可用条件很窄。Feishu AppLink 搜索只在当前进程生命周期内有效，不是持久索引。'
  ],
  labs: [
    { title: '实验 A · 读视图 → 写命令 → 回刷 单机模拟器', goal: '不看 React，用三个按钮复刻面板闭环。',
      steps: [
        '声明 view={revision:0, paused:false} 与 draft 对象。',
        '实现 GET state（返回 view）、PUT settings/:block（带 revision，stale 则 409）。',
        '实现 submit：成功或 409 都调 reload()，409 时用 merge3 合并 mine/base/saved。',
        '验证 SaveBar 只在 dirty / busy / error 时出现，破坏性操作要先 confirm。'
      ] },
    { title: '实验 B · 诚实状态与计数一致性', goal: '把 docs/005 的显示原则变成可断言的检查。',
      steps: [
        '造 dropped 列表与 Overview.dropped 数字，断言二者严格相等。',
        '模拟一次网络失败，验证它不进入 problems（连续三次才报）。',
        '给健康组件零高度占位，验证「健康态不占空间」。',
        '验证 restart 时轮询从 5000ms 降到 1000ms、down→up 后 restarts++。'
      ] }
  ],
  takeaways: [
    '面板是只读视图 + 带 revision 的写命令 + 强制回刷，任何写操作之后都必须 reload。',
    '同源守卫与错误映射集中在 http.ts；409 是并发保存的常态，草稿必须三方 rebase 而不是丢弃。',
    '交互设计的目标是节省人的注意力：只在人必须行动或结果可用时出现，数字与列表永远一致。'
  ]
});
