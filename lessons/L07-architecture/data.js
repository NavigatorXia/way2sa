window.Course.boot({
  id: 'L07', title: '整体架构与内核边界', tag: '哪层可移植', doc: '007-architecture.md',
  subtitle: 'docs/007 是整份原型的架构说明书：跟着一条 Trigger 走完全链路，再把 src/core 与 DSH 宿主逐条切开。',
  goal: '能指认每一步落在哪个模块，说清「零 I/O 领域内核」与「DSH 适配器」之间的 ports 接缝在哪、为什么这样切、重启后靠什么恢复。',
  questions: [
    'src/core 为什么是零 I/O 内核？六类端口各自把什么能力挡在门外？',
    '哪些写发生在同一个同步事务里，哪些副作用是提交后才由 Effects 执行的？',
    '重启后进行到一半的 Assignment 怎么恢复，effects 队列里的行为什么会留存？'
  ],
  lanes: ['外部 / Source', '适配层 · 接入与调度', '零 I/O 领域内核', '适配层 · 执行与投递', '人与 Channel'],
  nodes: [
    { id: 'source', label: 'Source', sub: 'webhook · GitHub · Feishu', lane: 0, col: 0, kind: 'human', carry: true },
    { id: 'human', label: '人', sub: '注意力预算', lane: 0, col: 4, kind: 'human', carry: true },
    { id: 'passes', label: 'Passes', sub: '2s 心跳 · watchdog', lane: 1, col: 0, kind: 'host', carry: true },
    { id: 'intake', label: 'Intake', sub: 'scope · dedup · fan-out', lane: 1, col: 1, kind: 'host' },
    { id: 'effects', label: 'Effects', sub: '持久队列 · Later', lane: 1, col: 3, kind: 'host', carry: true },
    { id: 'outbox', label: 'Outbox', sub: 'receipt 幂等', lane: 1, col: 4, kind: 'host', carry: true },
    { id: 'ports', label: 'Ports', sub: '6 类接缝', lane: 2, col: 0, kind: 'kernel' },
    { id: 'engine', label: 'Engine', sub: '唯一写入口 · atomic', lane: 2, col: 1, kind: 'kernel' },
    { id: 'evals', label: 'Evals / Gate', sub: 'batch → Decision', lane: 2, col: 2, kind: 'kernel', carry: true },
    { id: 'ticket', label: 'Ticket / Mandate', sub: '领域状态', lane: 2, col: 3, kind: 'kernel', carry: true },
    { id: 'assignment', label: 'Assignment', sub: 'pending → running', lane: 2, col: 4, kind: 'kernel', carry: true },
    { id: 'store', label: 'Store', sub: 'SQLite · generated col', lane: 3, col: 0, kind: 'host', carry: true },
    { id: 'assessor', label: 'MasterAssessor', sub: '候选卡 · steer', lane: 3, col: 1, kind: 'host' },
    { id: 'router', label: 'Router', sub: 'orchestrator_route', lane: 3, col: 2, kind: 'host', carry: true },
    { id: 'worker', label: 'DshExecutor', sub: 'worker-<id> · worktree', lane: 3, col: 3, kind: 'host', carry: true },
    { id: 'report', label: 'Report / notices', sub: 'relay 回主 Session', lane: 3, col: 4, kind: 'host', carry: true },
    { id: 'channel', label: 'Channel', sub: 'send → sent/gone', lane: 4, col: 3, kind: 'host', carry: true }
  ],
  edges: [
    { from: 'source', to: 'intake', label: 'Trigger' },
    { from: 'source', to: 'passes', label: 'request' },
    { from: 'intake', to: 'engine', label: 'atomic' },
    { from: 'intake', to: 'store', label: 'disposition' },
    { from: 'intake', to: 'evals', label: 'queueForEval' },
    { from: 'passes', to: 'effects', label: 'kick' },
    { from: 'engine', to: 'evals', label: 'evaluateDue' },
    { from: 'engine', to: 'assessor', label: 'assessment' },
    { from: 'assessor', to: 'router', label: 'candidate' },
    { from: 'router', to: 'ticket', label: 'decide accept' },
    { from: 'ticket', to: 'assignment', label: '首派工' },
    { from: 'ticket', to: 'effects', label: 'launch' },
    { from: 'effects', to: 'worker', label: 'launchQueued' },
    { from: 'worker', to: 'report', label: 'orchestrator_report' },
    { from: 'report', to: 'engine', label: 'Engine.report' },
    { from: 'engine', to: 'outbox', label: 'Replies.send' },
    { from: 'outbox', to: 'channel', label: 'deliver' },
    { from: 'channel', to: 'human', label: '交付' },
    { from: 'human', to: 'worker', label: 'handback / 恢复' },
    { from: 'ports', to: 'engine', label: '注入' }
  ],
  steps: [
    { n: 1, from: 'source', to: 'intake', label: 'webhookTrigger → ctx.receive', kind: 'message', note: 'id = key(\'webhook\', message.id) 稳定；Source 自己发出的消息返回 undefined。这是 Source→Trigger 的唯一入口。', state: 'T.open.working', code: 'intake', ref: 'src/sources/github-trigger.ts' },
    { n: 2, from: 'source', to: 'passes', label: 'Passes.receive → request()', kind: 'command', note: '返回 stored 时立刻请求一次编排；关闭中直接抛 Orchestrator is stopping。', state: 'T.open.working', code: 'passes', ref: 'src/app/passes.ts:36-38' },
    { n: 3, from: 'intake', to: 'engine', label: 'Engine.receive = repo.atomic(...)', kind: 'command', note: '所有领域写都在一个同步事务里；at 被 isoTime 归一，按 id 去重返回 duplicate。', state: 'T.open.working', code: 'engine', ref: 'src/core/engine.ts:48' },
    { n: 4, from: 'intake', to: 'store', label: 'scope 过滤 + fan-out 写 disposition', kind: 'fact', note: '不在监听范围只存 filtered 与 reason，不建 Thread；命中订阅的票记 fanout 并被 wake。', state: 'T.open.working', code: 'intake', ref: 'src/core/intake.ts:25-27,58-61' },
    { n: 5, from: 'intake', to: 'evals', label: '分叉：owners() 决定快 / 慢路径', kind: 'command', note: '人的追问被 Ticket 认领就跳过 queueForEval（文章叫 Fast Path）；无人认领才进 pending 走 Evals（Slow Path）。注意：仓库里没有 FastPathRouter 这个类。', state: 'T.open.working', code: 'intake', ref: 'src/core/intake.ts / src/core/model.ts:followupOwners' },
    { n: 6, from: 'passes', to: 'effects', label: 'pumpOnce: kick + evaluateDue', kind: 'effect', note: '每 2000ms 先派发到期 effect，再让 Engine 检查到期 Eval；并发 request() 合并成一轮，这就是 watchdog 心跳。', state: 'T.open.working', code: 'passes', ref: 'src/app/passes.ts:63-68' },
    { n: 7, from: 'engine', to: 'evals', label: 'Evals.start + Policy.gate', kind: 'command', note: '把 pending 批成一个 Eval，写 thread.evaluating（含 deadline、policyVersion）；候选送达主 Session 前不超时。', state: 'T.open.working', code: 'engine', ref: 'src/core/engine.ts:82-84' },
    { n: 8, from: 'engine', to: 'assessor', label: 'assessment effect → 候选卡', kind: 'effect', note: 'MasterAssessor 经 sessions.prompt(..., steer) 送达主 Session；candidate.strength === explicit 会抛 EXPLICIT —— 显式请求走 Router，不走评估。', state: 'T.open.working', code: 'policy-port', ref: 'src/app/assessment.ts' },
    { n: 9, from: 'assessor', to: 'router', label: 'orchestrator_route / eval_decide', kind: 'command', note: '一次调用可含 1–20 个 decision（accept/attach/stop/ignore），逐条作为独立 Engine 命令执行。', state: 'T.open.working', code: 'engine-for', ref: 'docs/007-architecture.md:503,511' },
    { n: 10, from: 'router', to: 'ticket', label: 'decide(accept) 原子建单', kind: 'command', note: 'Ticket + Mandate + Subscriptions + 首个 Assignment + acknowledgement reply 在一个事务里落地，并发 ticket.created。', state: 'A.pending', code: 'engine', ref: 'docs/007-architecture.md:73' },
    { n: 11, from: 'ticket', to: 'effects', label: 'Executor.start 事务内入 launch', kind: 'effect', note: '内核里的端口方法只排队工作；适配器在 commit 之后才真正 dispatch。这一步与下一步之间必须断开。', state: 'A.pending', code: 'effects-enqueue', ref: 'src/executor/dsh.ts:264-265' },
    { n: 12, from: 'effects', to: 'worker', label: 'launchQueued：slot / prepare / ensure', kind: 'effect', note: '预留 WorkerSlots、跑 prepare 建 worktree、ensure(worker-<ticketId>)、prompt(..., queue)、engine.assignmentStarted；满槽或暂停抛 Later。', state: 'A.running', code: 'resume', ref: 'src/executor/dsh.ts:270-284,424-469' },
    { n: 13, from: 'worker', to: 'report', label: 'orchestrator_report + relay', kind: 'message', note: '六种状态；提问立即转 worker_attention 给主 Session，普通 progress 留在 Ticket 上。', state: 'A.running', code: 'engine-for', ref: 'src/app/notices.ts:reportRelay' },
    { n: 14, from: 'engine', to: 'outbox', label: 'Replies → Outbox.send', kind: 'command', note: '按用途限定后，在 store.atomic 内写 receipt 并入 reply effect；receipts.add 保证同一 message.id 永不再入队。', state: 'A.running', code: 'outbox-send', ref: 'src/app/outbox.ts:27-31' },
    { n: 15, from: 'outbox', to: 'channel', label: 'deliver: behind / allowed / send', kind: 'effect', note: '检查 Source 是否启用、behind(id,3) 保序、channelAllowed；sources.send 返回 sent/gone/waiting，gone 落 channelGone 永久丢弃。', state: 'A.running', code: 'outbox-send', ref: 'src/app/outbox.ts:39-48' },
    { n: 16, from: 'channel', to: 'human', label: '只在必要时交付', kind: 'message', note: 'Channel 是 Thread 的写侧；同一个 Ticket 到同一会话的消息按入队顺序出去，ack 一定早于后续结果。', state: 'T.open.person', code: 'outbox-send', ref: 'docs/003-execution.md:179' },
    { n: 17, from: 'human', to: 'worker', label: 'handback 与 restart 恢复', kind: 'event', note: '越界消息 handback 记 disposition.handbacks 并重排新 Eval；fiber.restart 后 DshExecutor.resume() 报 assignmentInterrupted，按创建时间从旧到新带 recovery note 重排，effects 行留存。', state: 'A.ended', code: 'resume', ref: 'src/executor/dsh.ts:524-536' },
    { n: 18, from: 'ticket', to: 'assignment', label: 'Assignment 生命周期独立于 Ticket', kind: 'fact', note: '一票可有多个 Assignment，各自 pending → running → ended；Ticket 的 stage 由 ticketStage(ticket) 纯函数派生、ticket 表没有这一列。assignmentInterrupted / ready / dropped 都只结束 Assignment，何时结束 Ticket 由 Engine 决定。', state: 'A.pending', code: 'engine-for', ref: 'docs/007-architecture.md:73、docs/003-execution.md:35-48' },
    { n: 19, from: 'engine', to: 'ports', label: '复盘：内核只认 6 类 ports', kind: 'fact', note: 'Repositories / Policy / SourceScope / Assessor / Executor / Outbox 全是纯类型；Runtime 是组合根，EngineFor* 把每个调用方能看到的方法收窄到本角色。换宿主时保留内核与 ports，替换适配器。', state: 'T.ended', code: 'engine-for', ref: 'docs/007-architecture.md:255-274' }
  ],
  states: {
    nodes: [
      { id: 'A.pending', label: 'A.pending · launch 已排队', c: 0, r: 0 },
      { id: 'A.running', label: 'A.running · worker turn', c: 1, r: 0 },
      { id: 'A.ended', label: 'A.ended · 含中断 / 顶替', c: 2, r: 0 },
      { id: 'T.open.working', label: 'T.open.working', c: 0, r: 1 },
      { id: 'T.open.person', label: 'T.open.person · 等人', c: 1, r: 1 },
      { id: 'T.ended', label: 'T.ended · by executor / human', c: 2, r: 1 }
    ],
    transitions: [
      { from: 'T.open.working', to: 'A.pending', label: 'accept → 首 Assignment' },
      { from: 'A.pending', to: 'A.running', label: 'assignmentStarted' },
      { from: 'A.running', to: 'T.open.person', label: 'blocked / failed / question' },
      { from: 'T.open.person', to: 'A.pending', label: 'retryTicket / 人的追问' },
      { from: 'A.running', to: 'A.ended', label: 'ready / dropped / interrupted' },
      { from: 'A.ended', to: 'A.pending', label: 'resume / retry + recovery note' },
      { from: 'T.open.working', to: 'T.ended', label: 'followsDone / stopTicket' },
      { from: 'T.ended', to: 'T.open.working', label: '人的消息 + Mandate 仍有效' }
    ]
  },
  snippets: [
    { id: 'policy-port', symbol: 'Policy (port)', path: 'src/core/ports.ts',
      code: [
        'export interface Policy {',
        '  version: string',
        '  paused: boolean',
        '  gate(trigger: Trigger, thread: Thread, tickets: Ticket[]): GateResult',
        "  /** Re-check a mandate's gate-layer basis under this policy, such as before an ended ticket resumes. */"
      ].join('\n'),
      why: '端口是纯 interface：内核只声明需要什么能力，settingsPolicy 的具体实现放在适配器侧。' },
    { id: 'engine', symbol: 'Engine.receive / evaluateDue', path: 'src/core/engine.ts',
      code: [
        "receive(trigger: Trigger): ReceiveResult { return this.repo.atomic(() => this.intake.receive(trigger)) }",
        'evaluateDue(): void {',
        '  const policy = this.options.policy()',
        '  for (const thread of this.repo.threads.active()) if (thread.evaluating) this.repo.atomic(() => { this.evals.due(thread, policy) })',
        '  if (policy.paused) return'
      ].join('\n'),
      why: 'Engine 全同步、每条命令一个事务；没有任何定时器、fetch 或文件系统访问。' },
    { id: 'engine-for', symbol: 'EngineFor* 角色 Pick', path: 'src/core/engine.ts',
      code: [
        "export type EngineForSources = Pick<Engine, 'receive' | 'bindThread' | 'threadClosed'>",
        "export type EngineForMainSession = Pick<Engine, 'candidate' | 'candidateDelivered' | 'decide' | 'attach' | 'reply' | 'requestStatus' | 'note'>",
        "export type EngineForPeople = Pick<Engine, 'stopTicket' | 'retryTicket' | 'reevaluate' | 'unsubscribe' | 'dismiss'>",
        "export type EngineForSettings = Pick<Engine, 'policyChanged'>"
      ].join('\n'),
      why: '越权调用在类型层就不成立：Source 只能 receive/bindThread/threadClosed，连 decide 都看不到。' },
    { id: 'intake', symbol: 'Intake.receive', path: 'src/core/intake.ts',
      code: [
        'const filter = this.options.scope.scope(trigger)',
        'if (!filter.listened) {',
        "  this.repo.triggers.save(trigger); this.repo.triggers.saveDisposition(trigger.id, { filtered: { code: filter.reason }, fanout: [], at })",
        'if (!this.owners(trigger).length) this.queueForEval(trigger)',
        'for (const ticketId of fanout) this.tickets.wake(ticketId)'
      ].join('\n'),
      why: '所谓 Fast/Slow Path 的真身：owners() 决定跳过还是排队；订阅只 wake，不产生授权。' },
    { id: 'effects-enqueue', symbol: 'Effects.enqueue / Later', path: 'src/app/effects.ts',
      code: [
        'this.store.db.prepare(`INSERT INTO effect (kind, key, value, seq, due, since) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE',
        "  SET value = excluded.value, generation = generation + 1, attempts = 0, error = '', due = excluded.due`)",
        '  .run(kind, key, JSON.stringify(payload), ++this.seq, this.now(), new Date(this.now()).toISOString())',
        'else if (failure.error instanceof Later) {',
        "  this.store.db.prepare(`UPDATE effect SET due = ? WHERE ${own}`).run(this.now() + handler.retry[0], ...ownRow)"
      ].join('\n'),
      why: '适配层把「提交后执行」补上：持久队列、(kind,key) 合并、Later 不计失败。' },
    { id: 'outbox-send', symbol: 'Outbox.send', path: 'src/app/outbox.ts',
      code: [
        'send(message: OutboundMessage): void {',
        "  if (message.kind === 'reply' && message.channel.source === 'feishu') checkedImText(message.text)",
        '  const { store, effects } = this.host',
        "  store.atomic(() => { if (store.receipts.add(message)) effects.enqueue('reply', message.id, {}) })"
      ].join('\n'),
      why: '收据 + effect 同事务是「不丢不重」的地基；重复 id 不产生第二个 effect。' },
    { id: 'resume', symbol: 'DshExecutor.resume', path: 'src/executor/dsh.ts',
      code: [
        'for (const ticket of this.host.store.tickets.open().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {',
        '  const running = runningAssignment(ticket), latest = latestAssignment(ticket)',
        '  if (running) {',
        "    this.host.context.agents.get(workerSessionId(ticket.id) as SessionId)?.cancel({ kind: 'user' }, { keepInbox: true })",
        "    this.stopWork(ticket.id, 'dsh-superagent restarted', true)"
      ].join('\n'),
      why: '重启恢复按票创建时间从旧到新，先取消 worker、保留 inbox，再带 recovery note 重排。' },
    { id: 'passes', symbol: 'Passes.start / pumpOnce', path: 'src/app/passes.ts',
      code: [
        "start(): void { if (!this.stopped) this.timer = setInterval(() => { this.request() }, 2000) }",
        'private async pumpOnce(): Promise<void> {',
        '  this.host.effects.kick()',
        '  if (this.host.closing()) return',
        '  // While processing is paused, the Engine only records the pause on active Evals so they do not expire.'
      ].join('\n'),
      why: '时钟完全在适配层；暂停时 Engine 只记录暂停，让 Eval 不超时。' }
  ],
  glossary: [
    { term: 'Engine', desc: '领域内核唯一写入口；receive / evaluateDue / decide / report / handback 等全同步。', src: 'src/core/engine.ts' },
    { term: 'Repositories', desc: '同步持久状态接口，atomic(work) 把一条命令包成事务。', src: 'src/core/ports.ts:105-107' },
    { term: 'Policy / SourceScope', desc: '准入规则与接收范围，都是内核声明的纯接口。', src: 'src/core/ports.ts' },
    { term: 'Assessor / Executor / Outbox', desc: '三个出站端口：评估、执行、发件；内核只在事务内入队。', src: 'src/core/ports.ts' },
    { term: 'EngineFor*', desc: '5 个 Pick<Engine,…>，调用方只拿到本角色的方法。', src: 'src/core/engine.ts:261-270' },
    { term: 'Effects', desc: 'SQLite 持久副作用队列，6 个 kind；Later 不计失败，3 次才报 health。', src: 'src/app/effects.ts' },
    { term: 'Passes', desc: '每 2 秒一次可合并的编排心跳：先 kick effects，再 evaluateDue。', src: 'src/app/passes.ts' },
    { term: 'Outbox（实现）', desc: '收据 + reply effect，含幂等 / 保序 / 丢弃。', src: 'src/app/outbox.ts' },
    { term: 'Runtime', desc: 'Cordis Service（名 orchestrator），组合根，含 lockSync 与 shutdown。', src: 'src/app/runtime.ts' },
    { term: 'DshExecutor / WorkerSlots', desc: '一票一个持久 worker Session + 独立 worktree；限流与恢复。', src: 'src/executor/dsh.ts' },
    { term: 'SourceKind / SourceRegistry', desc: 'Source 插件契约与实现 SourceScope 的注册表。', src: 'src/sources/kind.ts, registry.ts' },
    { term: 'one-writer-per-state', desc: 'Trigger/Thread/Decision/Ticket/Assignment 由 Engine 写；effect 行、receipt、健康位各有唯一写者。', src: 'docs/007:259-269' }
  ],
  pitfalls: [
    '把 Executor.start / Outbox.send 当成「立刻起 worker / 立刻发消息」：端口方法只排队，适配器在 commit 后才执行，事务回滚则 effect 行根本不落地。',
    '以为 stage 会落盘、有 ticket.stage 可读：ticketStage(ticket) 是纯函数，ticket 表里根本没有这一列。',
    '以为订阅 / 扇出等于授权，或把显式请求也送去做 proactive 评估：显式请求走 orchestrator_route，推断候选才走 orchestrator_eval*。',
    '把文章里的 Fast/Slow Path 当成仓库里真实存在的类去引用：原型里没有这个字面，真实实现是 followupOwners / queueForEval。同理「停止 Ticket 的那条消息不会自动重新 Eval」。'
  ],
  labs: [
    { title: '实验 A · 事务内入队 / 提交后派发 / 合并 模拟器', goal: '用纯 JS 复刻三种 effect 行为。',
      steps: [
        '实现 atomic(work)：先写临时对象，成功才 commit 合入 db.effect，抛错则丢弃。',
        '实现 enqueue(kind,key,payload) 的 ON CONFLICT 语义：generation++ / attempts=0 / seq 不变。',
        '点「事务内抛错」验证 effect 表为 0 行；点「同 key 重复入队」验证只改 value。',
        '注入 Later 验证 attempts 不变只推 due；普通失败验证 attempts+1 与指数退避。'
      ] },
    { title: '实验 B · 零 I/O 内核 + 可替换端口', goal: '证明领域结果与 I/O 无关。',
      steps: [
        '写 makeEngine({repo, scope, assessor, executor, outbox, policy})，参数全是普通对象，无 fetch / setTimeout / fs。',
        '提供 memoryAdapter 与 dshLikeAdapter 两套实现，交换时不改 makeEngine 一行代码。',
        '验证 stored / duplicate / filtered 三种返回值在两套适配器下完全一致。',
        '用 forSources = pick(engine, [...]) 验证 decide 为 undefined，体会角色 Pick 收窄。'
      ] }
  ],
  takeaways: [
    '可移植的是 src/core 全部文件、ports 契约、以及 dependency rules / one-writer / 单事务提交后副作用这些设计原则。',
    '要替换的是 Runtime + index.ts、DshExecutor、Sessions / delivery / assessment、Sources / infra、bundle patch 与 CLI —— 它们全是 DSH 宿主适配器。',
    '重启可恢复靠三件事：领域状态在 Store、待办副作用在 effect 表、 delivered-but-unread 的消息在 Session 记录里。'
  ]
});
