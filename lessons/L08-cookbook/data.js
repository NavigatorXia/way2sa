window.Course.boot({
  id: 'L08', title: 'Cookbook 端到端实战', tag: '自己接一个 Source', doc: '008-cookbook.md',
  subtitle: 'docs/008 是动手手册：用 11 步写出一个 webhook Source kind，把前七课的概念全部用一遍。',
  goal: '能照着 11 步把一个新 Source 从「映射事件」做到「构建 / 注册 / 重启生效」，并追踪一条队列消息到交付的完整链路。',
  questions: [
    '为什么 Trigger.id / Thread.id / channel.address 必须一次定稳？重读消息凭什么安全？',
    'scope 为什么只能依赖 meta 与配置？channel.send 为什么只有永久失败才返回 gone？',
    '从写完 apply() 到真的能收消息，tsdown / exports / patch / profile / restart 各起什么作用？'
  ],
  lanes: ['开发者', 'Source kind 契约', '插件与轮询', '构建 / 注册 / 宿主', '端到端链路'],
  nodes: [
    { id: 'dev', label: '开发者', sub: '11 步', lane: 0, col: 0, kind: 'human' },
    { id: 'kind', label: 'webhookKind', sub: 'ConfigSchema · health', lane: 1, col: 0, kind: 'host' },
    { id: 'trigger', label: 'webhookTrigger', sub: "key('webhook', id)", lane: 1, col: 1, kind: 'host' },
    { id: 'scope', label: 'scope', sub: '只依赖 meta + 配置', lane: 1, col: 2, kind: 'host' },
    { id: 'channel', label: 'channel.send', sub: '--key 幂等', lane: 1, col: 3, kind: 'host', carry: true },
    { id: 'ctx', label: 'threadContext / policy', sub: '有界上下文 · 变量', lane: 1, col: 4, kind: 'host' },
    { id: 'tests', label: 'webhook.spec.ts', sub: '文档索引校验', lane: 2, col: 0, kind: 'host' },
    { id: 'plugin', label: 'apply(ctx)', sub: 'inject orchestrator', lane: 2, col: 1, kind: 'host' },
    { id: 'poll', label: 'watch / pollQueue', sub: 'cursor 成功后才推进', lane: 2, col: 2, kind: 'host' },
    { id: 'state', label: 'KV.cursor', sub: '持久读位点', lane: 2, col: 3, kind: 'host' },
    { id: 'build', label: 'tsdown / exports', sub: 'webhook-watch entry', lane: 3, col: 0, kind: 'host' },
    { id: 'bundle', label: 'cordis.patch.yml', sub: 'disabled: true', lane: 3, col: 1, kind: 'host', carry: true },
    { id: 'profile', label: 'profile + restart', sub: 'disabled: false', lane: 3, col: 2, kind: 'host', carry: true },
    { id: 'host', label: 'Runtime / Engine', sub: 'receive 三态', lane: 4, col: 0, kind: 'host', carry: true },
    { id: 'eval', label: 'Eval / gate', sub: 'explicit', lane: 4, col: 1, kind: 'kernel', carry: true },
    { id: 'ticket', label: 'Ticket', sub: 'ack reply', lane: 4, col: 2, kind: 'kernel', carry: true },
    { id: 'outbox', label: 'Outbox / registry', sub: 'reply effect', lane: 4, col: 3, kind: 'host', carry: true },
    { id: 'delivery', label: 'delivery', sub: 'sent / gone', lane: 4, col: 4, kind: 'host', carry: true }
  ],
  edges: [
    { from: 'dev', to: 'kind', label: 'Step 1-2' },
    { from: 'dev', to: 'trigger', label: 'Step 3' },
    { from: 'dev', to: 'scope', label: 'Step 4' },
    { from: 'dev', to: 'channel', label: 'Step 5' },
    { from: 'dev', to: 'ctx', label: 'Step 6-8' },
    { from: 'dev', to: 'plugin', label: 'Step 9' },
    { from: 'plugin', to: 'poll', label: 'watch' },
    { from: 'poll', to: 'state', label: 'cursor' },
    { from: 'dev', to: 'build', label: 'Step 10' },
    { from: 'build', to: 'bundle', label: 'entry' },
    { from: 'bundle', to: 'profile', label: 'enable' },
    { from: 'profile', to: 'host', label: 'restart' },
    { from: 'host', to: 'eval', label: 'gate' },
    { from: 'eval', to: 'ticket', label: 'accept' },
    { from: 'ticket', to: 'outbox', label: 'ack' },
    { from: 'outbox', to: 'delivery', label: 'send' },
    { from: 'dev', to: 'tests', label: 'Step 11' },
    { from: 'poll', to: 'host', label: 'ctx.receive' }
  ],
  steps: [
    { n: 1, from: 'dev', to: 'kind', label: 'Step 1：先定稳定映射', kind: 'command', note: 'Trigger id、Thread id、Channel address 都会持久化，以后改动会让已有记录失联。key(\'webhook\', message.id) 与 Thread 拼接规则要先定死。', state: 'received', code: 'mapping', ref: 'docs/008-cookbook.md:21' },
    { n: 2, from: 'dev', to: 'kind', label: 'Step 2：ConfigSchema + health', kind: 'config', note: 'conversations[].listen ∈ {mentions, all}、pollSeconds 默认 30；health:[\'webhook\'] 注册时 claim，与 runtime / effect kind / sync: 等保留名冲突会被拒。', state: 'received', code: 'mapping', ref: 'docs/008-cookbook.md:47-54,79' },
    { n: 3, from: 'dev', to: 'trigger', label: 'Step 3：webhookTrigger', kind: 'command', note: 'sender.id === me 时返回 undefined（绝不给自己发 Trigger）；addressed:\'mention\'；meta 带 conversation / messageId / root。', state: 'received', code: 'webhook-trigger', ref: 'docs/008-cookbook.md:100-117' },
    { n: 4, from: 'dev', to: 'scope', label: 'Step 4：scope 只吃 meta + 配置', kind: 'config', note: 'revalidate 会用 Mandate 里存的 meta 再调 scope，所以不能读外部状态；被过滤的消息也要交给 receive，面板才能解释为什么过滤。', state: 'filtered', code: 'scope', ref: 'docs/008-cookbook.md:138-142,145,149' },
    { n: 5, from: 'dev', to: 'channel', label: 'Step 5：send 用 message.id 幂等', kind: 'config', note: '发送可能在远端已收到之后才失败，所以 --key message.id；只有 410 这类永久不可达返回 gone，其它失败必须抛错让 Outbox 从 5s 退避到 300s 重试。', state: 'reply', code: 'send-webhook', ref: 'docs/008-cookbook.md:163-179' },
    { n: 6, from: 'dev', to: 'ctx', label: 'Step 6：threadContext.read', kind: 'config', note: '给 orchestrator_eval 初始窗口、eval_read 翻页；part 可以是 thread / root / parent，消息字段是有界的 {id, from, at, text, bot?, url?}。', state: 'candidate', code: 'mapping', ref: 'docs/008-cookbook.md:185-200' },
    { n: 7, from: 'dev', to: 'ctx', label: 'Step 7-8：policy + environment', kind: 'config', note: 'policy.row 必须等于 scope 的 row；cells 由 listen===\'all\' 决定。环境变量前缀 DSH_SUPERAGENT_<KIND>_，绝不放凭据，非本 Source 的票返回空串。', state: 'candidate', code: 'scope', ref: 'docs/008-cookbook.md:215-250' },
    { n: 8, from: 'dev', to: 'plugin', label: 'Step 9：apply(ctx) 注册 + watch', kind: 'command', note: 'inject=[\'orchestrator\']；await ctx.ready，!ctx.configured() 时 health(\'paused\',\'setupPending\') 直接返回；AbortController 保证 stop / restart 立即结束循环。', state: 'received', code: 'apply', ref: 'docs/008-cookbook.md:255-267' },
    { n: 9, from: 'plugin', to: 'poll', label: 'watch 每轮重读 config', kind: 'effect', note: '一轮里读 KV.cursor、逐条 ctx.receive(trigger)、全部 stored 之后才 state.set(cursor, page.next)；连续 3 次失败才报 error/pollFailures。', state: 'queued', code: 'poll-queue', ref: 'docs/008-cookbook.md:289-291,300-324' },
    { n: 10, from: 'poll', to: 'state', label: '游标只在整轮成功后推进', kind: 'fact', note: '中断的一轮游标不动，稳定 id 让重放全部变成 duplicate；时间戳游标用 cursorAt(started) 减 5 秒容忍远端迟到。', state: 'duplicate', code: 'poll-queue', ref: 'docs/008-cookbook.md:324' },
    { n: 11, from: 'dev', to: 'build', label: 'Step 10：加构建入口与导出', kind: 'config', note: "tsdown.config.ts 加 'webhook-watch': 'src/sources/webhook.ts'，package.json 加 \"./webhook-watch\": \"./lib/webhook-watch.js\"。", state: 'queued', code: 'build', ref: 'docs/008-cookbook.md:336-343' },
    { n: 12, from: 'build', to: 'bundle', label: 'patch.yml 插入插件行', kind: 'config', note: 'insert 一行 id: dsh-superagent-webhook / name: dsh-superagent/webhook-watch / disabled: true，与现有 feishu 行同构。', state: 'queued', code: 'build', ref: 'docs/008-cookbook.md:345-349' },
    { n: 13, from: 'bundle', to: 'profile', label: 'profile 设 disabled:false 并重启', kind: 'config', note: '构建 + 重启才生效；改 Source 账户字段或 setup 等待中的保存也会触发 ctx.fiber.restart()，脚本用 tmux + operation.lock + health 轮询判断就绪。', state: 'queued', code: 'build', ref: 'docs/008-cookbook.md:351' },
    { n: 14, from: 'profile', to: 'host', label: '重启后 register + ctx.receive', kind: 'message', note: 'Runtime 重新 lockSync / 开 Store，插件注册 kind；一条 hookq pull 消息 → webhookTrigger → ctx.receive → Engine.receive 返回 stored / filtered / duplicate。', state: 'received', code: 'poll-queue', ref: 'docs/008-cookbook.md:362-400' },
    { n: 15, from: 'host', to: 'eval', label: '显式 @ → gate 给 explicit', kind: 'fact', note: '测试断言 candidate(key(\'webhook\',\'m1\')).strength === \'explicit\'；显式请求走 orchestrator_route，不做 proactive 评估。', state: 'evaluating', code: 'mapping', ref: 'docs/008-cookbook.md:396' },
    { n: 16, from: 'eval', to: 'ticket', label: 'route accept → 原子建 Ticket', kind: 'command', note: 'Engine.decide 在一个事务里造 Ticket + 首 Assignment + acknowledgement reply；Source 不能自己结束工单，Engine 仍然决定 Ticket 何时结束。', state: 'ticket', code: 'mapping', ref: 'docs/008-cookbook.md:332' },
    { n: 17, from: 'ticket', to: 'outbox', label: 'Outbox.send 写 receipt + effect', kind: 'effect', note: '收据与 reply effect 同事务；SourceRegistry.send 在 kind 未安装时返回 waiting（Later），保序只限同票同会话。', state: 'reply', code: 'send-webhook', ref: 'src/app/outbox.ts:27-31' },
    { n: 18, from: 'outbox', to: 'delivery', label: 'hookq reply --key → sent', kind: 'effect', note: 'channel.send 返回 sent 或 gone；gone 落 channelGone/dropped 且永不重排，普通失败进入退避重试。', state: 'sent', code: 'send-webhook', ref: 'src/sources/registry.ts:95-98' },
    { n: 19, from: 'outbox', to: 'delivery', label: "410 → 'gone' / dropped，永不重排", kind: 'event', note: "CliError.code === 410 这类永久不可达才返回 gone：Outbox 落 channelGone / dropped，收据保留使 id 永不再入队；其它失败一律抛错进 5s→300s 退避。把任何失败都当 gone 是典型错误。", state: 'dropped', code: 'send-webhook', ref: 'docs/008-cookbook.md:163-179、src/app/outbox.ts:45-48' },
    { n: 20, from: 'dev', to: 'tests', label: 'Step 11：补测试与文档索引', kind: 'fact', note: 'tests/webhook.spec.ts 用真实 Store + stand-in ports 验证整条链；tests/docs.spec.ts 检查 007 的 Modules / Tests 两张索引表是否完整。', state: 'sent', code: 'build', ref: 'docs/008-cookbook.md:353,413-425' }
  ],
  states: {
    nodes: [
      { id: 'received', label: 'S.received · stored', c: 0, r: 0 },
      { id: 'filtered', label: 'S.filtered · 终态', c: 0, r: 1 },
      { id: 'duplicate', label: 'S.duplicate · 终态', c: 0, r: 2 },
      { id: 'queued', label: 'S.queued · pending', c: 1, r: 0 },
      { id: 'evaluating', label: 'S.evaluating', c: 2, r: 0 },
      { id: 'candidate', label: 'S.candidate · 候选卡', c: 3, r: 0 },
      { id: 'ticket', label: 'S.ticket · 原子建单', c: 2, r: 1 },
      { id: 'reply', label: 'S.reply · receipt pending', c: 3, r: 1 },
      { id: 'sent', label: 'S.sent · 终态', c: 3, r: 2 },
      { id: 'dropped', label: 'S.dropped · 终态', c: 2, r: 2 }
    ],
    transitions: [
      { from: '(incoming)', to: 'received', label: 'scope.listened=true' },
      { from: '(incoming)', to: 'filtered', label: 'scope.listened=false' },
      { from: '(incoming)', to: 'duplicate', label: 'trigger.id 已存在' },
      { from: 'received', to: 'queued', label: 'queueForEval' },
      { from: 'queued', to: 'evaluating', label: 'Passes → Evals.start' },
      { from: 'evaluating', to: 'candidate', label: 'assessment effect' },
      { from: 'candidate', to: 'ticket', label: 'route accept' },
      { from: 'ticket', to: 'reply', label: 'Outbox.send' },
      { from: 'reply', to: 'sent', label: "channel.send → 'sent'" },
      { from: 'reply', to: 'dropped', label: "'gone' / channelIgnored" },
      { from: 'reply', to: 'reply', label: 'behind / waiting / 退避' }
    ]
  },
  snippets: [
    { id: 'webhook-trigger', symbol: 'webhookTrigger', path: 'docs/008-cookbook.md',
      code: [
        'export function webhookTrigger(message: QueueMessage, me: string): Trigger | undefined {',
        "  if (message.sender.id === me) return undefined",
        '  const thread = `${message.conversation}:${message.thread ?? message.id}`',
        '  return {',
        "    id: key('webhook', message.id),"
      ].join('\n'),
      why: '稳定 id + 丢弃自己的消息；把编辑当作新事件要把 edit version 拼进 key（GitHub 用 updated_at）。' },
    { id: 'scope', symbol: 'scope({ meta }, config)', path: 'docs/008-cookbook.md',
      code: [
        '  scope({ meta }, config) {',
        '    const conversation = config.conversations.find(item => item.id === meta.conversation)',
        "    if (!conversation) return { listened: false, reason: 'conversation_not_listed' }",
        "    return { listened: true, observed: conversation.listen === 'all', row: conversation.id }",
        '  },'
      ].join('\n'),
      why: '只依赖 meta 与配置，revalidate 才能重放；row 与 policy.rows 必须是同一个值。' },
    { id: 'send-webhook', symbol: 'sendWebhook', path: 'docs/008-cookbook.md',
      code: [
        "export async function sendWebhook(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {",
        "  const { conversation, message: to } = message.channel.address",
        "  if (!conversation || !to) throw new Error('Missing webhook reply target')",
        '  try {',
        "    await host.commands.run('hookq', ['reply', '--conversation', conversation, '--to', to, '--key', message.id,"
      ].join('\n'),
      why: '--key message.id 是幂等键；410 才返回 gone，其余抛错交给 Outbox 退避。' },
    { id: 'apply', symbol: 'apply(ctx) / watch', path: 'docs/008-cookbook.md',
      code: [
        "export const name = 'dsh-superagent-webhook'",
        "export const inject = ['orchestrator']",
        'export function apply(ctx: Context): void {',
        "  ctx.effect(() => ctx.orchestrator.sources.register(webhookKind), 'webhook: source kind')",
        '  ctx.effect(() => {'
      ].join('\n'),
      why: '注册 kind 与轮询循环都用 ctx.effect 登记 disposer，卸载时自动清理。' },
    { id: 'poll-queue', symbol: 'pollQueue', path: 'docs/008-cookbook.md',
      code: [
        "export async function pollQueue(ctx: SourceContext, signal: AbortSignal): Promise<{ read: number; unreadable: number }> {",
        '  const after = ctx.state.get(KV.webhook.cursor) ?? 0',
        "  const output = await ctx.commands.withSignal(signal).run('hookq', ['pull', '--after', String(after), '--json'])",
        '  const page = PageSchema.parse(JSON.parse(output))',
        '  let unreadable = 0'
      ].join('\n'),
      why: '读位点只在所有 Trigger 都 stored 之后推进；signal 传给命令与 delay 以便立即停止。' },
    { id: 'build', symbol: 'entry / exports / patch', path: 'docs/008-cookbook.md',
      code: [
        "entry: { index: 'src/index.ts', 'github-watch': 'src/sources/github.ts', 'feishu-watch': 'src/sources/feishu.ts',",
        "  'webhook-watch': 'src/sources/webhook.ts' },",
        '    - id: dsh-superagent-webhook',
        '      name: dsh-superagent/webhook-watch',
        '      disabled: true'
      ].join('\n'),
      why: '写完代码不等于生效：构建入口、包导出、bundle 插件行、profile 开关、重启，一个都不能少。' },
    { id: 'mapping', symbol: '稳定映射与测试断言', path: 'docs/008-cookbook.md',
      code: [
        'Trigger ids, Thread ids and Channel addresses are persisted, so changing them later can disconnect existing records.',
        "Engine.receive returns 'duplicate' for stored ids ... Re-reading messages is therefore safe.",
        'Advance a cursor only after every covered Trigger has been stored. An interrupted round leaves the cursor unchanged; stable ids make replay safe.',
        "candidate(key('webhook','m1')).strength === 'explicit'"
      ].join('\n'),
      why: '四句话概括整篇 cookbook 的正确性约束：稳定 id、可安全重放、游标不抢跑、显式请求直达 Router。' }
  ],
  glossary: [
    { term: 'SourceKind<C>', desc: 'Source 插件契约：kind/title/schema/fields/health + 可选 scope/channel/threadContext/policy/environment。', src: 'src/sources/kind.ts' },
    { term: 'ConfigSchema', desc: 'zod 校验存储配置；conversations[].listen、pollSeconds 10..3600 默认 30，.strict()。', src: 'docs/008:47-54' },
    { term: 'webhookTrigger', desc: '事件→Trigger 翻译；稳定 id、丢弃自己的消息、addressed:\'mention\'。', src: 'docs/008:100-117' },
    { term: 'ScopeResult', desc: '{listened, observed, row} 或 {listened:false, reason}，只依赖 meta 与配置。', src: 'src/core/ports.ts:10' },
    { term: 'SourceChannel', desc: 'allowed / send / link；send 返回 sent 或 gone，其余抛错。', src: 'src/sources/kind.ts' },
    { term: 'threadContext', desc: '给 eval 工具提供有界会话上下文，part 为 thread / root / parent。', src: 'docs/008:185-200' },
    { term: 'SourcePolicyPart', desc: 'Source 侧的 allowed / explicit / rows，rows 的 cell 由 listen 决定。', src: 'docs/008:215-234' },
    { term: 'environment.variables', desc: '声明并注入 Executor 变量，前缀 DSH_SUPERAGENT_<KIND>_，不含凭据。', src: 'docs/008:239-250' },
    { term: 'KV.webhook.cursor', desc: '持久读位点；tests/store.spec.ts 要求 key 字面量只出现在注册表里。', src: 'src/kv.ts' },
    { term: 'pollQueue', desc: '一轮读取：拉页、逐条 receive、全部成功后才推进 cursor。', src: 'docs/008:300-324' },
    { term: 'ctx.ready / configured()', desc: '挡在轮询循环最前面的两个守卫，未就绪时 health 标 paused。', src: 'docs/008:262-266' },
    { term: 'tests/docs.spec.ts', desc: '检查 007 架构文档里的 Modules / Tests 两张索引表是否完整。', src: 'docs/008:353' }
  ],
  pitfalls: [
    '以后改 id / Thread / Channel 地址会让已有记录失联；把时间戳或随机数塞进 id 会让重放变成新工单。要区分「编辑」就把 edit version 拼进 key。',
    'scope 读了配置之外的东西、或在轮询循环里悄悄丢掉被过滤的消息：revalidate 会重放 meta，面板也需要 disposition 才能解释过滤原因。',
    'channel.send 把任何失败都当 gone、或不用 message.id 做幂等：只有永久不可达才 gone，其余抛错交给 Outbox 退避。',
    '游标在消息全部 receive 之前就推进、key 字面量散落在代码里、signal 没传给命令与 delay；另外 Source 不能自己结束工单，Engine 才决定 Ticket 何时结束。'
  ],
  labs: [
    { title: '实验 A · 稳定 id + 去重 + scope + 游标 模拟器', goal: '复刻 docs/008 的测试断言，不装任何依赖。',
      steps: [
        '实现 key(kind,id)、webhookTrigger（me 消息返回 undefined）、scope（只吃 meta.conversation + config）。',
        '实现 receive(trigger) 用 Map 返回 stored / duplicate / filtered。',
        '实现 pollQueue：PageSchema 式校验计 unreadable，全部 receive 后才 cursor=page.next。',
        '投喂 [{m1@bot ops}, {broken}, {m2 elsewhere}] 再投同一页，验证 {read:3, unreadable:1} 与游标不动时的重放全为 duplicate。'
      ] },
    { title: '实验 B · 幂等收据 + gone / retry / 排序 模拟器', goal: '把永久失败与可重试失败分开。',
      steps: [
        '用 Map 实现 Outbox.send（同 id 只 add 一次）与 reply effect 队列。',
        '让 channel.send 可切换「成功 / 410 / 瞬时抛错 / 被 behind 阻塞」。',
        '实现 FAILURES_BEFORE_ERROR=3 与 delay=min(300000, 5000*2**min(attempts,16))。',
        '验证同 id 连发两次远端只出现一次；410 永不重排；前一条失败 3 次后后一条立刻放行。'
      ] }
  ],
  takeaways: [
    '接一个新 Source 的本质是「把外部词汇翻译成领域词汇」：稳定 id、Thread 归属、ScopeResult、OutboundMessage。',
    '正确性靠三个不变量：稳定 id 让重放安全、scope 只依赖可持久化的 meta、channel.send 用 message.id 幂等。',
    '代码写完只是开始；构建入口 → 包导出 → bundle 插件行 → profile 开关 → 重启，才让插件真正开始收消息。'
  ]
});
