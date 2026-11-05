window.Course.boot({
  id: 'L03', title: '执行与可靠投递', tag: '怎么干活', doc: '003-execution.md',
  subtitle: 'docs/003 跟着一张被接下的 Ticket 走完执行、交付与恢复：状态先存好，副作用提交后再做。',
  goal: '掌握 stage 派生、worker slot / 后台作业、事务内入队、Effects 的 Later 与退避、Outbox 的幂等收据与保序，以及崩溃后靠什么恢复。',
  questions: [
    '为什么 stage 不落盘，而 blocked / failed 的状态重启后还能保持？',
    'Later 和普通失败有什么本质区别？为什么 effect 必须写在同一个事务里？',
    '一个 dropped / withdrawn 的消息 id，为什么永远不会被再次排队？'
  ],
  lanes: ['外部 / 人', '领域内核 · 可移植', '运行时 · 持久副作用', '执行环境 · DSH', 'Channel / 交付'],
  nodes: [
    { id: 'human', label: '人', sub: '只在必要时出现', lane: 0, col: 0, kind: 'human' },
    { id: 'ticket', label: 'Ticket', sub: 'open / ended', lane: 1, col: 0, kind: 'kernel', carry: true },
    { id: 'stage', label: 'ticketStage', sub: '纯派生，不落盘', lane: 1, col: 1, kind: 'kernel' },
    { id: 'assignment', label: 'Assignment', sub: 'pending/running/ended', lane: 1, col: 2, kind: 'kernel', carry: true },
    { id: 'report', label: 'Report', sub: 'progress…dropped', lane: 1, col: 3, kind: 'kernel' },
    { id: 'store', label: 'Store.atomic', sub: 'SQLite savepoint', lane: 2, col: 0, kind: 'host' },
    { id: 'effects', label: 'Effects', sub: 'kind+key · Later', lane: 2, col: 1, kind: 'host' },
    { id: 'passes', label: 'Passes', sub: '每 2 秒一拍', lane: 2, col: 2, kind: 'host' },
    { id: 'outbox', label: 'Outbox', sub: 'receipt + reply effect', lane: 2, col: 3, kind: 'host' },
    { id: 'receipts', label: 'Receipt', sub: 'pending/sent/dropped', lane: 2, col: 4, kind: 'host' },
    { id: 'slots', label: 'WorkerSlots', sub: '并发 +1 给人', lane: 3, col: 0, kind: 'host' },
    { id: 'prepare', label: 'prepare', sub: 'worktree · 10 分钟', lane: 3, col: 2, kind: 'host' },
    { id: 'worker', label: 'Worker Session', sub: 'worker-<ticketId>', lane: 3, col: 3, kind: 'host' },
    { id: 'background', label: '后台 job', sub: '5s 转后台 · 30min', lane: 3, col: 4, kind: 'host' },
    { id: 'env', label: '执行环境', sub: '变量不含凭据', lane: 3, col: 1, kind: 'host' },
    { id: 'channel', label: 'Channel', sub: '同票同会话保序', lane: 4, col: 3, kind: 'host' }
  ],
  edges: [
    { from: 'ticket', to: 'stage', label: '派生' },
    { from: 'ticket', to: 'assignment', label: '派工' },
    { from: 'assignment', to: 'effects', label: 'launch' },
    { from: 'store', to: 'effects', label: 'commit → kick' },
    { from: 'passes', to: 'effects', label: 'pumpOnce' },
    { from: 'effects', to: 'slots', label: 'reserve' },
    { from: 'slots', to: 'prepare', label: 'prepare cmd' },
    { from: 'prepare', to: 'worker', label: 'ensure' },
    { from: 'env', to: 'worker', label: 'variables' },
    { from: 'worker', to: 'background', label: '5s' },
    { from: 'worker', to: 'report', label: 'orchestrator_report' },
    { from: 'report', to: 'outbox', label: 'reply' },
    { from: 'outbox', to: 'store', label: 'receipt + effect' },
    { from: 'store', to: 'receipts', label: 'INSERT OR IGNORE' },
    { from: 'receipts', to: 'channel', label: 'deliver' },
    { from: 'channel', to: 'human', label: '交付' },
    { from: 'human', to: 'ticket', label: '回答' },
    { from: 'background', to: 'worker', label: '完成后唤醒' },
    { from: 'passes', to: 'worker', label: 'restart 恢复' }
  ],
  steps: [
    { n: 1, from: 'ticket', to: 'stage', label: 'ticketStage 首行命中', kind: 'fact', note: '从上往下读表，第一行匹配即返回；Ticket 里根本没有 stage 字段，blocked/failed 也是从 Reports 与 Inputs 现算的。', state: 'enqueued', code: 'stage', ref: 'src/core/stage.ts:ticketStage' },
    { n: 2, from: 'ticket', to: 'assignment', label: '首个 Assignment = pending', kind: 'effect', note: '每张票一个 Executor Session（worker-<id>）与一个目录；Assignment 状态独立于 Ticket。', state: 'enqueued', code: 'stages-doc', ref: 'docs/003-execution.md:23-29' },
    { n: 3, from: 'assignment', to: 'effects', label: '事务内 enqueue launch', kind: 'effect', note: 'Executor.start 只把 (kind,key) 写进 effect 表；端口方法「只排队工作」，真正的启动在 commit 之后。', state: 'enqueued', code: 'enqueue', ref: 'src/core/ports.ts:59-69' },
    { n: 4, from: 'store', to: 'effects', label: 'RELEASE 提交 → kick()', kind: 'event', note: 'afterCommit 回调与 queueMicrotask(dispatch) 只在最外层 RELEASE 之后发生；事务回滚则 effect 行根本不存在。', state: 'running', code: 'atomic', ref: 'src/app/store.ts:Store.atomic' },
    { n: 5, from: 'passes', to: 'effects', label: 'pumpOnce：kick + evaluateDue', kind: 'effect', note: '每 2000ms 一拍，先派发到期 effect，再让 Engine 检查到期 Eval；并发 request() 合并成一轮。', state: 'running', code: 'atomic', ref: 'src/app/passes.ts:Passes.pumpOnce' },
    { n: 6, from: 'effects', to: 'slots', label: 'launchQueued 预留 worker slot', kind: 'fact', note: '从 launch 开始（含 prepare）就占槽；并发上限之外还有一个额外槽专门给人的消息或状态请求，新工作不能挡住人继续已有票。', state: 'deferred', code: 'stages-doc', ref: 'docs/003-execution.md:55-61' },
    { n: 7, from: 'slots', to: 'prepare', label: 'prepare 命令建 worktree', kind: 'effect', note: '目录不存在时以 sh 在 execution root 跑一次，限时 10 分钟；失败会让票 failed 并记下输出，重试或人的消息会再试。', state: 'deferred', code: 'env-doc', ref: 'docs/003-execution.md:49-53' },
    { n: 8, from: 'env', to: 'worker', label: '注入执行变量（无凭据）', kind: 'config', note: 'prepare 读环境变量，Executor 在提示词里读值与描述；只有面板能改这些设置，发给主 Session 的文字不能改 shell 命令。', state: 'deferred', code: 'env-doc', ref: 'docs/003-execution.md:63-80' },
    { n: 9, from: 'prepare', to: 'worker', label: 'ensure Session + 投首个 prompt', kind: 'effect', note: 'worker preset 把前台 shell 5 秒转后台，让 worker 下一步就能收到新消息；随后上报 assignmentStarted。', state: 'running', code: 'stages-doc', ref: 'docs/003-execution.md:27-35' },
    { n: 10, from: 'worker', to: 'background', label: 'turn 结束时仍有后台作业', kind: 'effect', note: '票保留 slot 并保持 working，不报 waiting、主 Session 也收不到 waiting report；作业完成在同一 slot 唤醒 Executor，上限 30 分钟。', state: 'running', code: 'stages-doc', ref: 'docs/003-execution.md:31-39' },
    { n: 11, from: 'worker', to: 'report', label: 'report{progress, question}', kind: 'command', note: '六种状态：progress / waiting / ready / blocked / failed / dropped；带 question 会写 Attention，askedBy 必须是到达该票的人写消息。', state: 'running', code: 'report-doc', ref: 'docs/003-execution.md:9-17' },
    { n: 12, from: 'report', to: 'outbox', label: 'attention reply 入队', kind: 'message', note: 'Replies 按用途（acknowledgement / answer / result / attention）限定；key 由 attention.id 派生，保证幂等。', state: 'receipt', code: 'outbox-send', ref: 'src/core/replies.ts:ReplyRequest' },
    { n: 13, from: 'outbox', to: 'store', label: 'receipt + effect 同一事务', kind: 'effect', note: 'Outbox.send 在 store.atomic 里做 receipts.add 与 effects.enqueue(reply)，两个 INSERT 落在同一 savepoint。', state: 'receipt', code: 'outbox-send', ref: 'src/app/outbox.ts:Outbox.send' },
    { n: 14, from: 'store', to: 'receipts', label: 'INSERT OR IGNORE，status=pending', kind: 'fact', note: 'receipts.add 返回 changes>0 才入队；同一 message.id 第二次 add 返回 false，不产生新行、也不产生新 effect。', state: 'receipt', code: 'receipts-add', ref: 'src/app/store.ts:Store.receipts.add' },
    { n: 15, from: 'receipts', to: 'channel', label: 'behind(id,3) 保序 / Later', kind: 'fact', note: '同票同会话更早的 pending 且失败 <3 次时抛 Later 只推 due；Source 未启用也抛 Later；channelAllowed 为假则 settle channelIgnored。', state: 'deferred', code: 'deliver', ref: 'src/app/outbox.ts:Outbox.deliver' },
    { n: 16, from: 'channel', to: 'human', label: 'sources.send → sent / gone / waiting', kind: 'effect', note: '真正写 Channel；瞬时失败从 5s 起指数退避到 300s，gone 才永久 dropped。dropped 也保留记录，永不再排队。', state: 'deleted', code: 'deliver', ref: 'docs/003-execution.md:175-191' },
    { n: 17, from: 'human', to: 'ticket', label: '人的回答 fan-out，唤醒', kind: 'event', note: '人的新消息解除 waitsForPerson，blocked/failed 回到 working；结束的票在 Mandate 通过 revalidate 后以同一 Mandate 复活。', state: 'running', code: 'report-doc', ref: 'docs/003-execution.md:19,125-141' },
    { n: 18, from: 'background', to: 'worker', label: 'job 完成在同一 slot 唤醒', kind: 'event', note: 'handoff 给人时立即释放 slot，subagents 停止，但 shell jobs（例如供 review 的 server）可留到 Assignment 结束且不再唤醒 Executor。', state: 'running', code: 'stages-doc', ref: 'docs/003-execution.md:37-41' },
    { n: 19, from: 'worker', to: 'ticket', label: 'report{ready} → 结单', kind: 'command', note: '无 follows 时 ready 以 completed 结束；有 PR 时要等它打开的所有 PR 关闭，此时面板显示 Awaiting review。', state: 'deleted', code: 'report-doc', ref: 'docs/003-execution.md:92-106' },
    { n: 20, from: 'effects', to: 'store', label: 'Later / 退避 / 成功 DELETE', kind: 'effect', note: 'Later 不增 attempts 只推 due；普通失败 delay=min(max, base*2^min(attempts,16)) 且 attempts+1，连续 3 次才把该类标为系统问题；成功按 seq+generation 精确删行。', state: 'error', code: 'attempt', ref: 'src/app/effects.ts:Effects.attempt' },
    { n: 21, from: 'passes', to: 'worker', label: 'restart：assignmentInterrupted', kind: 'event', note: '运行中的 Assignment 以 host restarted 结束，新 Assignment 带 recovery note（先查目录 / git 历史 / GitHub 再重复外部动作），按票创建时间从旧到新；effect 行与待投递消息跨重启留存。', state: 'enqueued', code: 'atomic', ref: 'docs/003-execution.md:144-152' }
  ],
  states: {
    nodes: [
      { id: 'enqueued', label: 'enqueued · due 已定', c: 0, r: 0 },
      { id: 'running', label: 'running · dispatch 中', c: 1, r: 0 },
      { id: 'deferred', label: 'deferred · Later', c: 1, r: 1 },
      { id: 'deleted', label: 'deleted · 成功', c: 2, r: 0 },
      { id: 'error', label: 'error · 连续 3 次', c: 2, r: 1 },
      { id: 'receipt', label: 'receipt · pending', c: 3, r: 0 }
    ],
    transitions: [
      { from: 'enqueued', to: 'running', label: 'dispatch 选 due<=now' },
      { from: 'running', to: 'deleted', label: '成功且 seq/generation 匹配' },
      { from: 'running', to: 'deferred', label: 'Later / paused / 满槽' },
      { from: 'deferred', to: 'enqueued', label: 'due 到点重新派发' },
      { from: 'running', to: 'error', label: '普通失败 attempts+1' },
      { from: 'running', to: 'receipt', label: 'reply handler → deliver' },
      { from: 'receipt', to: 'deleted', label: 'sent / dropped 落回执' }
    ]
  },
  snippets: [
    { id: 'stage', symbol: 'ticketStage', path: 'src/core/stage.ts',
      code: [
        'export function ticketStage(ticket: Ticket): TicketStage {',
        "  if (ticket.ended) return { stage: 'ended' }",
        "  if (ticket.delivery) return { stage: 'person', action: 'delivery' }",
        "  if (ticket.attention) return { stage: 'person', action: 'answer' }",
        '  const assignment = latestAssignment(ticket)',
        "  const report = assignment?.report?.state"
      ].join('\n'),
      why: '纯函数、首行命中：面板阶段只是视图分类，重启后由 Reports / Inputs 重新算出来。' },
    { id: 'outbox-send', symbol: 'Outbox.send', path: 'src/app/outbox.ts',
      code: [
        '  send(message: OutboundMessage): void {',
        "    if (message.kind === 'reply' && message.channel.source === 'feishu') checkedImText(message.text)",
        '    const { store, effects } = this.host',
        "    store.atomic(() => { if (store.receipts.add(message)) effects.enqueue('reply', message.id, {}) })"
      ].join('\n'),
      why: '收据与 effect 同事务、commit 后才执行 —— 这是「不丢不重」的地基。' },
    { id: 'receipts-add', symbol: 'Store.receipts.add', path: 'src/app/store.ts',
      code: [
        '    add: (message: OutboundMessage): boolean => {',
        "      const receipt: Receipt = { ...message, status: 'pending' }",
        "      return Number(this.db.prepare('INSERT OR IGNORE INTO outbox (id, value) VALUES (?, ?)').run(message.id, JSON.stringify(receipt)).changes) > 0"
      ].join('\n'),
      why: '幂等根：重复 id 返回 false，不产生新行也不产生新 effect。' },
    { id: 'atomic', symbol: 'Store.atomic', path: 'src/app/store.ts',
      code: [
        '    this.committed[level] = []',
        '    this.db.exec(`SAVEPOINT ${name}`)',
        '    let value: T',
        '    try { value = operation(); this.db.exec(`RELEASE ${name}`) }',
        '    catch (error) { this.db.exec(`ROLLBACK TO ${name}`); this.db.exec(`RELEASE ${name}`); throw error }'
      ].join('\n'),
      why: '嵌套 savepoint 按 depth 分层；回滚层丢弃该层 afterCommit 回调，effect 也随事务一起回滚。' },
    { id: 'enqueue', symbol: 'Effects.enqueue', path: 'src/app/effects.ts',
      code: [
        '    this.store.db.prepare(`INSERT INTO effect (kind, key, value, seq, due, since) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE',
        "      SET value = excluded.value, generation = generation + 1, attempts = 0, error = '', due = excluded.due`)",
        '      .run(kind, key, JSON.stringify(payload), ++this.seq, this.now(), new Date(this.now()).toISOString())',
        '    this.kick()'
      ].join('\n'),
      why: '(kind,key) 合并保留 seq 队位，generation+1 防止运行中被覆盖；kick 只是唤醒派发。' },
    { id: 'attempt', symbol: 'Effects.attempt', path: 'src/app/effects.ts',
      code: [
        "    if (!failure) this.store.db.prepare(`DELETE FROM effect WHERE ${own}`).run(...ownRow)",
        '    else if (this.stopped) return',
        '    else if (failure.error instanceof Later) {',
        "      this.store.db.prepare(`UPDATE effect SET due = ? WHERE ${own}`).run(this.now() + handler.retry[0], ...ownRow)",
        '    } else {',
        '      const delay = Math.min(handler.retry[1], handler.retry[0] * 2 ** Math.min(row.attempts, 16))'
      ].join('\n'),
      why: '成功 / 延后 / 失败三分；Later 不消耗失败次数，停机时保留 running 行下次续跑。' },
    { id: 'deliver', symbol: 'Outbox.deliver', path: 'src/app/outbox.ts',
      code: [
        "    const receipt = store.receipts.get(id)",
        "    if (receipt?.status !== 'pending') return",
        "    if (!sources.instance(receipt.channel.source)?.enabled) throw new Later('The Source is off or not installed')",
        "    if (store.receipts.behind(id, FAILURES_BEFORE_ERROR)) throw new Later('An earlier message of this ticket to this conversation waits')",
        "    if (!sources.channelAllowed(receipt.channel)) { store.receipts.settle(receipt, 'channelIgnored'); return }"
      ].join('\n'),
      why: '终态直接返回；Source 关闭与保序阻塞都属于 Later，不是错误。' },
    { id: 'stages-doc', symbol: 'Ticket stages / Executor', path: 'docs/003-execution.md',
      code: [
        'Each open Ticket has one stage, determined by what it is waiting for. Read the table from top to bottom; the first matching row wins.',
        'Executor Sessions run commands without approval as the operator\'s OS user.',
        'When a turn ends with shell jobs or subagents still running, the Ticket keeps its worker slot and stays working.'
      ].join('\n'),
      why: '文档把「派生阶段」与「后台工作占槽」写在同一篇，说明二者都是运行时事实而非领域状态。' },
    { id: 'env-doc', symbol: 'Execution variables', path: 'docs/003-execution.md',
      code: [
        'The prepare command and Executor instructions receive the same execution variables.',
        'None contains credentials.',
        'Only the panel can change execution environment settings; text sent to the main Session cannot change the configured shell command.',
        'These wrappers and directories establish defaults, not a security boundary.'
      ].join('\n'),
      why: '执行环境是「方便」不是「隔离」；这条也解释了为什么凭据不能进上下文。' },
    { id: 'report-doc', symbol: 'How a Ticket ends', path: 'docs/003-execution.md',
      code: [
        'Ready without a pull request: a `ready` Report ends the Ticket as completed.',
        "An Executor that finds no work for a person to act on ... reports `dropped`.",
        'The Ticket is done when none of the pull requests it opened remain open.',
        '"Awaiting review" therefore means a `ready` Report with a pull request.'
      ].join('\n'),
      why: '结单规则属于 Ticket 自己，与 DSH Session 是否结束无关。' }
  ],
  glossary: [
    { term: 'TicketStage', desc: '由 ended / delivery / attention / report / assignment 派生的面板阶段，不落盘。', src: 'src/core/stage.ts' },
    { term: 'AssignmentState', desc: 'pending / running / ended，独立于 Ticket。', src: 'src/core/model.ts' },
    { term: 'ReportState', desc: 'progress / waiting / ready / blocked / failed / dropped。', src: '001:112' },
    { term: 'Attention', desc: 'Ticket 上等待人回答的问题；触发 person/answer。', src: 'src/core/model.ts' },
    { term: 'WorkerSlots', desc: '并发槽；额外 +1 槽专门让人的消息 / 状态请求不被新工作挡住。', src: 'docs/003:55-61' },
    { term: 'prepare command', desc: '首个 Assignment 前跑一次的 sh 命令（常用 git worktree），限时 10 分钟。', src: 'docs/003:49-53' },
    { term: 'EffectKind', desc: 'assessment / launch / delivery / relay / notice / reply 六种持久副作用。', src: 'src/app/effects.ts' },
    { term: 'Later', desc: '「现在不能跑」而非失败：只推 due，不增 attempts、不记 error。', src: 'src/app/effects.ts' },
    { term: 'FAILURES_BEFORE_ERROR', desc: '连续 3 次失败才把该类 effect 标为系统问题。', src: 'src/app/effects.ts' },
    { term: 'Receipt', desc: '出站消息回执：pending / sent / dropped，dropped 含时间与原因。', src: 'src/app/store.ts' },
    { term: 'receipts.behind', desc: '同票同会话更早 pending 且失败 <3 次时阻塞后一条，保证 ack 早于结果。', src: 'src/app/store.ts' },
    { term: 'Passes.pumpOnce', desc: '每 2s 一次：先 effects.kick()，再 engine.evaluateDue()。', src: 'src/app/passes.ts' }
  ],
  pitfalls: [
    'stage 不落盘：ticketStage 是纯函数，Ticket 没有 stage 字段；blocked/failed 靠存下来的 Reports 与 Inputs 现算，所以重启也能保持。',
    'Later 不是失败：paused / 槽位满 / Source 未安装 / 保序等待都只推 due，不增 attempts、不记 error；只有连续 3 次普通失败才报健康错误。',
    'dropped 消息留档且永不再排队；另外 blocked/failed 的票不自动收 Input（CI 与 bot 只记录不投递），但工具仍可用，人可以直接在 Session 里继续。'
  ],
  labs: [
    { title: '实验 A · atomic + enqueue 模拟器', goal: '证明「副作用随事务提交才落地」和 (kind,key) 合并。',
      steps: [
        '用数组 rows、pendingCallbacks、depth 实现 atomic(work)：成功才 flush 本层回调，抛错整层丢弃。',
        '实现 enqueue(kind,key,payload)：同 key 只改 value / generation++ / attempts=0，seq 不变。',
        '验证：事务内 enqueue 后抛错 → rows 为空；提交 → 恰好一行。',
        '验证：同 key 连续入队两次 → 只有一行且 payload 是最后一次。'
      ] },
    { title: '实验 B · 幂等 outbox + 退避', goal: '复刻 receipt 生命周期与 Later / 普通失败的分界。',
      steps: [
        '用 Map 实现 receipts.add（有 id 返回 false）、settle（缺行则重建）、behind（同 ticket+thread 且更早）。',
        '实现 delay=min(300000, 5000*2**min(attempts,16)) 与 FAILURES_BEFORE_ERROR=3。',
        '验证同 id 发两次远端只出现一次；dropped 之后再 add 仍返回 false。',
        '验证 Source 关闭时 Later 不增 attempts；三次普通失败后 health=error。'
      ] }
  ],
  takeaways: [
    '领域状态与运行时事实分开：stage 派生、receipt 与 effect 持久化，二者共同让重启可恢复。',
    '副作用必须写在同一个事务里，commit 之后才由 Effects 派发；Later 让「暂时不能做」不污染失败计数。',
    '投递的幂等与保序都建立在 message.id 上：dropped 也留档，因此一条消息永远不会被重复排队。'
  ]
});
