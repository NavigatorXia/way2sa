window.Course.boot({
  id: 'L01', title: '领域模型', tag: '概念从哪来', doc: '001-domain.md',
  subtitle: 'docs/001-domain.md 给这个系统定了一套不许乱用的词：work moves from Trigger to Eval to execution。',
  goal: '跟住一个 Trigger 从 Source 走到 Ticket，说清每个概念「保持哪条规则」，以及文档刻意拒绝的概念为什么不能加回来。',
  questions: [
    '为什么订阅 Thread 上人的消息不会产生 Decision，也不产生新授权？',
    'Mandate 记了哪些东西、为什么只有 accept 能创建它？',
    'Ticket 为什么不跟着 Executor Session 的状态走，Correlation 为什么不能路由？'
  ],
  lanes: ['外部世界', 'Source 边界', '领域内核 · 可移植', '执行边界', '交付与回流'],
  nodes: [
    { id: 'source', label: 'Source', sub: '事件流 · 读位点', lane: 0, col: 0, kind: 'human' },
    { id: 'human', label: '人', sub: '不是领域概念', lane: 0, col: 2, kind: 'human' },
    { id: 'trigger', label: 'Trigger', sub: '不可变事件', lane: 1, col: 1, kind: 'host' },
    { id: 'channel', label: 'Channel', sub: 'Thread 的写侧', lane: 1, col: 4, kind: 'host' },
    { id: 'thread', label: 'Thread', sub: '时序 · 持有订阅', lane: 2, col: 1, kind: 'kernel' },
    { id: 'subscription', label: 'Subscription', sub: '只给上下文', lane: 2, col: 0, kind: 'kernel' },
    { id: 'eval', label: 'Eval', sub: 'gate + assessment', lane: 2, col: 2, kind: 'kernel' },
    { id: 'mandate', label: 'Mandate', sub: '不可变授权', lane: 2, col: 3, kind: 'kernel' },
    { id: 'ticket', label: 'Ticket', sub: '被授权的工作单元', lane: 3, col: 1, kind: 'kernel' },
    { id: 'assignment', label: 'Assignment', sub: '绑定 Executor', lane: 3, col: 2, kind: 'kernel' },
    { id: 'correlation', label: 'Correlation', sub: '关联，不路由', lane: 3, col: 3, kind: 'kernel' },
    { id: 'executor', label: 'Executor', sub: '域外，经 Assignment', lane: 4, col: 3, kind: 'host' }
  ],
  edges: [
    { from: 'source', to: 'trigger', label: '产生 Trigger' },
    { from: 'trigger', to: 'thread', label: '归一到 Thread' },
    { from: 'thread', to: 'subscription', label: '持有' },
    { from: 'subscription', to: 'ticket', label: 'fan-out' },
    { from: 'thread', to: 'eval', label: 'batch' },
    { from: 'eval', to: 'mandate', label: 'accept' },
    { from: 'mandate', to: 'ticket', label: 'grant' },
    { from: 'ticket', to: 'assignment', label: '派工' },
    { from: 'assignment', to: 'executor', label: '绑定' },
    { from: 'ticket', to: 'channel', label: '结果' },
    { from: 'channel', to: 'human', label: '交付' },
    { from: 'human', to: 'thread', label: '追问' },
    { from: 'thread', to: 'correlation', label: '共享 Trigger' }
  ],
  steps: [
    { n: 1, from: 'source', to: 'trigger', label: 'Source 产出 Trigger', kind: 'event', note: 'Source 先丢掉自己的消息与不监听的 Trigger，再把剩下的翻译成 Trigger：带 actor、human、addressed 与 threads[0]。', state: 'none', code: 'doc-flow', ref: 'docs/001-domain.md:27-28' },
    { n: 2, from: 'trigger', to: 'thread', label: 'Engine.receive → 去重 + scope', kind: 'command', note: 'Intake.receive 是唯一摄入口：id 命中即 duplicate；未监听记 filtered 并保留 disposition，不建 Thread。', state: 'none', code: 'intake', ref: 'src/core/intake.ts:Intake.receive' },
    { n: 3, from: 'thread', to: 'subscription', label: '命中订阅，fan-out', kind: 'message', note: '匹配 Trigger 扇出给每个 live 订阅票，不检查发送者身份 —— 但这也意味着它不给任何授权。', state: 'none', code: 'doc-flow', ref: 'docs/001-domain.md:37' },
    { n: 4, from: 'subscription', to: 'ticket', label: 'TicketInput 直达，无 Eval', kind: 'fact', note: '已订阅 Thread 上人的消息留在 Ticket 里，由它的 Executor 决定；不进 Eval、不产生 Decision。', state: 'open', code: 'doc-reject', ref: 'docs/001-domain.md:53-54' },
    { n: 5, from: 'trigger', to: 'eval', label: 'queueForEval（无 owner）', kind: 'command', note: '只有当 followupOwners(trigger) 为空才把 Trigger 排进 primary Thread 的 pending；一个 Thread 同时最多跑一个 Eval。', state: 'none', code: 'intake', ref: 'src/core/part.ts:queueForEval' },
    { n: 6, from: 'thread', to: 'eval', label: 'Evals.start：gate 逐条判定', kind: 'fact', note: '对批次里每个 Trigger 调 policy.gate，用 stronger() 取最强、同强度取最新；Eval 自身不持有状态。', state: 'none', code: 'evals-start', ref: 'src/core/evals.ts:Evals.start' },
    { n: 7, from: 'eval', to: 'mandate', label: 'Decision=accept → Mandate', kind: 'command', note: 'Mandate 记 Policy version、scope、strength、匹配规则与来源身份；不可变，更大范围要开新 Ticket。', state: 'created', code: 'accept-guard', ref: 'src/core/evals.ts:Evals.accept' },
    { n: 8, from: 'mandate', to: 'ticket', label: '原子创建 Ticket', kind: 'event', note: 'Tickets.create 在一个事务里收集 Channels、建首 Assignment、订阅各 Thread、发 acknowledgement，并 emit ticket.created。', state: 'created', code: 'accept-guard', ref: 'src/core/tickets.ts:Tickets.create' },
    { n: 9, from: 'ticket', to: 'assignment', label: '首个 Assignment = pending', kind: 'effect', note: 'Ticket 可以有多个 Assignment，状态独立于 Ticket：pending → running → ended。', state: 'open', code: 'doc-flow', ref: 'docs/001-domain.md:36' },
    { n: 10, from: 'assignment', to: 'executor', label: 'Executor.start（只排队工作）', kind: 'effect', note: 'Executor 连 Session / 目录都在领域之外，内核只通过 Assignment 与端口认识它；这里不是「立刻起了 worker」。', state: 'open', code: 'doc-reject', ref: 'src/core/ports.ts:59-69' },
    { n: 11, from: 'executor', to: 'ticket', label: 'Report 回报状态', kind: 'fact', note: '只有 Assignment 的 final report 才可能在 Executor 侧结束 Ticket；Ticket 自己定义状态，不跟随 Session。', state: 'open', code: 'doc-reject', ref: 'docs/001-domain.md:36,56' },
    { n: 12, from: 'ticket', to: 'channel', label: '结果写回 Channel', kind: 'message', note: 'Channel 是 Thread 的写侧；致谢、回复、PR、已解决的 review 都是写。一个 Thread 可有多个 Channel。', state: 'open', code: 'doc-flow', ref: 'docs/001-domain.md:31' },
    { n: 13, from: 'channel', to: 'human', label: '只在必要时占用注意力', kind: 'message', note: 'docs/000 的原则：只在人必须行动、或结果可用时才说话。', state: 'open', code: 'doc-flow', ref: 'docs/000-philosophy.md' },
    { n: 14, from: 'human', to: 'thread', label: '追问唤醒已结束 Ticket', kind: 'event', note: '结束的 Ticket 保留订阅与 Mandate；人的消息让它回到 open，无 Eval、无 Decision。被人工 stop 的票再也收不到东西。', state: 'resumed', code: 'doc-reject', ref: 'docs/001-domain.md:35,37' },
    { n: 15, from: 'thread', to: 'correlation', label: 'Correlation 只关联，不路由', kind: 'fact', note: 'Correlation 记录多条 Thread 共享同一个 Trigger，是关联信息；它不决定走哪条路、不给授权、不触发 Eval。docs/001 明确拒绝把它当路由键。', state: 'open', code: 'doc-reject', ref: 'docs/001-domain.md:Rejected concepts' },
    { n: 16, from: 'ticket', to: 'ticket', label: 'final report → Ticket ended', kind: 'fact', note: 'Ticket 由 ready / dropped / 人工 stop 进入 ended，且 stage 是 ticketStage(ticket) 的派生值、不落盘；ended 仍保留订阅与 Mandate，才有人追问时的 wake。', state: 'ended', code: 'doc-flow', ref: 'docs/001-domain.md:35-36,56' }
  ],
  states: {
    nodes: [
      { id: 'none', label: '尚无 Ticket', c: 0, r: 0 },
      { id: 'created', label: 'accept 原子创建', c: 1, r: 0 },
      { id: 'open', label: 'open · 工作进行中', c: 2, r: 0 },
      { id: 'ended', label: 'ended · by executor / human', c: 2, r: 1 },
      { id: 'resumed', label: 'resumed · 同一 Mandate', c: 1, r: 1 }
    ],
    transitions: [
      { from: 'none', to: 'created', label: 'Evals.accept' },
      { from: 'created', to: 'open', label: 'Tickets.create' },
      { from: 'open', to: 'ended', label: 'ready / dropped / stop' },
      { from: 'ended', to: 'resumed', label: 'Tickets.wake + revalidate' },
      { from: 'resumed', to: 'open', label: '沿用原 Mandate' },
      { from: 'open', to: 'open', label: 'Subscription fan-out' }
    ]
  },
  snippets: [
    { id: 'intake', symbol: 'Intake.receive', path: 'src/core/intake.ts',
      code: [
        "    if (!trigger.threads.length) throw new Error('A trigger must belong to at least one thread')",
        "    if (this.repo.triggers.get(trigger.id)) return 'duplicate'",
        "    const at = this.now()",
        "    const filter = this.options.scope.scope(trigger)",
        "    if (!filter.listened) {",
        "      this.repo.triggers.save(trigger); this.repo.triggers.saveDisposition(trigger.id, { filtered: { code: filter.reason }, fanout: [], at })"
      ].join('\n'),
      why: '去重、范围过滤、扇出、排队都在同一个同步事务里；重复 id 让重读消息安全。' },
    { id: 'evals-start', symbol: 'Evals.start', path: 'src/core/evals.ts',
      code: [
        '    for (const trigger of triggers) {',
        '      const gate = policy.gate(trigger, thread, tickets)',
        "      if (!gate.admissible) { reasons.push({ code: gate.reason, triggerId: trigger.id }); continue }",
        "      const later = gate.strength === strongest?.strength && trigger.at >= strongest.trigger.at",
        "      const weaker = !strongest || stronger(strongest.strength, gate.strength) !== strongest.strength",
        '      if (weaker || later) strongest = { trigger, strength: gate.strength, basis: gate.basis }'
      ].join('\n'),
      why: '一个批次取最强、同强度取最新；gate 是确定性的一层，模型研判在它之后。' },
    { id: 'accept-guard', symbol: 'Evals.decide', path: 'src/core/evals.ts',
      code: [
        "    if (outcome.kind === 'accept' && evaluation.strength !== 'explicit' && !this.policy().admitsInferred(outcome.rules ?? [])) {",
        "      throw new UserError('notExplicit')",
        '    }'
      ].join('\n'),
      why: '推断候选不能在非 auto 模式下被直接接单；权限由代码强制，不是提示词说了算。' },
    { id: 'doc-flow', symbol: 'Flow (mermaid)', path: 'docs/001-domain.md',
      code: [
        'flowchart LR',
        '  S[Source] -->|Trigger| T[Thread]',
        '  T -->|batch| E[Eval]',
        '  T -->|Subscription fan-out| K[Ticket]',
        '  E -->|accept with Mandate / stop| K',
        '  K -->|Assignment| W[Executor]'
      ].join('\n'),
      why: '整篇文档的骨架：两条路径在 Ticket 汇合 —— Eval 决定是否开新工作，Subscription 只续上下文。' },
    { id: 'doc-reject', symbol: 'Rejected concepts', path: 'docs/001-domain.md',
      code: [
        '| Admission checks on Subscriptions | A Subscription covers the whole Thread; the Mandate separates authorization from context |',
        '| Correlation that routes | Subscriptions route; Correlation only adds context |',
        '| Ticket state that follows the DSH Session | A Ticket can be handed off, resumed, or run by several Executors |'
      ].join('\n'),
      why: '这张「拒绝清单」比概念表更重要：它规定哪些捷径不许走，正是底座可移植的原因。' }
  ],
  glossary: [
    { term: 'Source', desc: '事件流；kind 是可复用实现，instance 是一份配置。保存读位点，重启不重放。', src: '001:27' },
    { term: 'Trigger', desc: '一个不可变事件，审计与幂等的单位；同一 Trigger 被 accept 两次只产生一张票。', src: '001:28' },
    { term: 'Thread', desc: '时序上的 Trigger 集合；串行跑 Eval，持有订阅、运行中的 Eval 与 Decision 历史。', src: '001:29' },
    { term: 'Correlation', desc: '共享同一 Trigger 的 Thread 之间的关系；只加上下文，绝不路由。', src: '001:30' },
    { term: 'Channel', desc: 'Thread 的写侧；致谢、回复、PR、review 都是写。Ticket 持有一组 Channel。', src: '001:31' },
    { term: 'Policy', desc: '有版本的准入规则 + 每个 Source 的允许名单 / bot 名单 / admission table。', src: '001:32' },
    { term: 'Eval', desc: '对一批 Trigger 的判断，两层：gate 与 assessment；输入含 Thread 快照与全部 Ticket，无状态。', src: '001:33' },
    { term: 'Mandate', desc: 'accept 授予的东西：Policy version、scope、strength、匹配规则、来源身份；不可变。', src: '001:34' },
    { term: 'Ticket', desc: '一个被授权的工作单元；自定义 open/ended，不跟随 Executor Session。', src: '001:35' },
    { term: 'Assignment', desc: 'Ticket 与一个 Executor 实例的绑定；状态独立于 Ticket。', src: '001:36' },
    { term: 'Subscription', desc: 'Thread 与 Ticket 的多对多关系；fan-out 只送上下文，且不给授权。', src: '001:37' },
    { term: 'stage / Report / Input', desc: '术语表里的面板概念，后续 003、005 展开。', src: '001:100-105' }
  ],
  pitfalls: [
    '订阅 ≠ 授权：文档明确拒绝 Admission checks on Subscriptions，权力只来自 accept 生成的 Mandate。',
    '人不是领域概念：Trigger 只带 Source 给的 actor；跨 Source 的身份映射是提示词文本，不是实体，也不要把不同 Source 的 id 互相映射。',
    'Correlation 只加上下文、Subscription 才路由；Ticket 的状态不能跟随 DSH Session，否则 handoff / resume / 多 Executor 都会崩。'
  ],
  labs: [
    { title: '实验 A · 扇出 vs Eval 分类器', goal: '用两个数组复刻 Intake.receive，验证「哪些消息进 Eval」。',
      steps: [
        '声明 subscriptions=[t1] 与 pending=[]，写一个 receive(trigger) 函数。',
        '实现 dedup：Map 里已有 id 直接返回 duplicate。',
        '实现 fan-out：命中订阅就写 TicketInput，并检查 human 与 owner 决定要不要 queueForEval。',
        '投入 bot / CI / 人的消息，观察：bot 扇出但仍进 pending；人的追问命中订阅票则不进 pending。'
      ] },
    { title: '实验 B · 拒绝概念自检表', goal: '把 Rejected concepts 变成可勾选的规则，检验自己的设计有没有越界。',
      steps: [
        '列出 11 条被拒绝的概念，做成复选框。',
        '给每条写一句「如果加回来会破坏什么」（例如 Correlation 路由会让订阅与授权混淆）。',
        '对照 docs/001 的 What is reusable，标出哪些属于部署实现、哪些属于可复用规则。'
      ] }
  ],
  takeaways: [
    '系统的词汇是刻意收敛的：一个业务需要只能变成某个概念的属性，不能新增实体。',
    '两条路径必须分清：Eval 决定开不开新工作，Subscription 只把后续事件送到已有 Ticket。',
    'src/core 里的概念与规则可移植；Source / Policy 内容 / Executor / Channel 实现属于部署，换底座时替换的是后者。'
  ]
});
