window.Course.boot({
  id: 'L02', title: '授权与主动性', tag: '谁能开工', doc: '002-authorization.md',
  subtitle: 'docs/002 回答一个问题：谁可以让工作开始，这份工作可以包含什么。宿主强制规则，消息只是判断的输入。',
  goal: '把 gate、admission table、accept mode、Mandate basis 与 revalidate 串成一条链，能解释「订阅不给授权」和「off 不挡显式请求」这两条反直觉规则。',
  questions: [
    'explicit / inferred / not admitted 三种强度分别由哪条规则判定？',
    'observe 与 auto 差在哪，为什么 inferred 的 accept 一定要 assessment？',
    '只有哪三个操作能改变 Mandate？resume 前 revalidate 会检查什么？'
  ],
  lanes: ['外部与 Source', '准入第一层', '决策与授权', '运行中', '终止与恢复'],
  nodes: [
    { id: 'source', label: 'Source', sub: 'mention / direct', lane: 0, col: 0, kind: 'human' },
    { id: 'human', label: '人', sub: 'listed / unlisted', lane: 0, col: 1, kind: 'human' },
    { id: 'bot', label: 'Bot · CI', sub: '只能 inferred', lane: 0, col: 3, kind: 'host' },
    { id: 'gate', label: 'Gate', sub: '确定性第一层', lane: 1, col: 1, kind: 'kernel' },
    { id: 'admission', label: 'Admission table', sub: '行 = 接收范围', lane: 1, col: 2, kind: 'host' },
    { id: 'policy', label: 'Policy', sub: 'version · mode · rules', lane: 2, col: 0, kind: 'kernel' },
    { id: 'eval', label: 'Eval', sub: 'gate + assessment', lane: 2, col: 1, kind: 'kernel', carry: true },
    { id: 'assessor', label: 'Assessment', sub: '逐条评 enabled rules', lane: 2, col: 2, kind: 'host' },
    { id: 'router', label: 'Router', sub: 'orchestrator_route', lane: 2, col: 3, kind: 'host' },
    { id: 'mandate', label: 'Mandate', sub: '不可变 · 记 basis', lane: 2, col: 4, kind: 'kernel', carry: true },
    { id: 'ticket', label: 'Ticket', sub: '受 Mandate 约束', lane: 3, col: 2, kind: 'kernel', carry: true },
    { id: 'worker', label: 'Worker', sub: 'follow-up owner', lane: 3, col: 4, kind: 'host' },
    { id: 'panel', label: '面板 · 人', sub: 'stop 是命令', lane: 4, col: 0, kind: 'human' },
    { id: 'revalidate', label: 'Revalidate', sub: 'resume 前复查', lane: 4, col: 2, kind: 'kernel' },
    { id: 'subscription', label: 'Subscription', sub: '绕过 gate，不给权', lane: 3, col: 0, kind: 'kernel', carry: true }
  ],
  edges: [
    { from: 'source', to: 'gate', label: 'Trigger' },
    { from: 'human', to: 'gate', label: 'follow-up' },
    { from: 'bot', to: 'gate', label: 'bot list' },
    { from: 'gate', to: 'admission', label: '查行' },
    { from: 'admission', to: 'policy', label: 'cell → 强度' },
    { from: 'policy', to: 'gate', label: 'mode' },
    { from: 'gate', to: 'eval', label: 'admissible' },
    { from: 'eval', to: 'assessor', label: 'inferred' },
    { from: 'assessor', to: 'router', label: 'candidate' },
    { from: 'router', to: 'mandate', label: 'accept' },
    { from: 'mandate', to: 'ticket', label: '约束' },
    { from: 'subscription', to: 'ticket', label: 'context only' },
    { from: 'ticket', to: 'worker', label: '归 Worker' },
    { from: 'worker', to: 'eval', label: 'handback' },
    { from: 'panel', to: 'mandate', label: 'stop' },
    { from: 'revalidate', to: 'ticket', label: 'resume' },
    { from: 'revalidate', to: 'eval', label: '失败重排' }
  ],
  steps: [
    { n: 1, from: 'source', to: 'gate', label: 'Trigger 带 mention / direct', kind: 'event', note: 'Source 记录消息是否指向 agent：mention 是 @ 了 bot/账号，direct 是私信。这是 gate 的输入，不是授权。', state: 'absent', code: 'two-paths', ref: 'docs/002-authorization.md:11' },
    { n: 2, from: 'human', to: 'gate', label: '已订阅 Thread 上的追问', kind: 'event', note: 'Thread 已有 Ticket 时，人的 follow-up 归该 Ticket 的 Executor：不产生 Eval、不产生 Decision。', state: 'absent', code: 'two-paths', ref: 'docs/002-authorization.md:22' },
    { n: 3, from: 'bot', to: 'gate', label: 'bot 只能做 inferred 候选', kind: 'event', note: 'bot list 上的 bot 可以产 inferred candidate，永远不能做 explicit request，也不能 stop Ticket；CI 没有 sender，只走最后一格。', state: 'absent', code: 'strength', ref: 'docs/002-authorization.md:77-81' },
    { n: 4, from: 'gate', to: 'admission', label: '按接收范围查行的三个 cell', kind: 'fact', note: '行 = 接收范围（Feishu 群 / 私信，GitHub new Issue / PR / comment / CI）；一格决定 explicit、inferred 还是忽略。', state: 'absent', code: 'cells', ref: 'docs/002-authorization.md:58-71' },
    { n: 5, from: 'admission', to: 'policy', label: 'cell 决定 strength', kind: 'fact', note: '未名单且 @ 的人默认 ignore，但把该格设为 explicit 就能让任何人在这个范围请求工作；显式 cell 优先于 follow-up 判断。', state: 'absent', code: 'cells', ref: 'docs/002-authorization.md:73,54' },
    { n: 6, from: 'policy', to: 'gate', label: 'accept mode: off / observe / auto', kind: 'config', note: 'off 挡住所有 inferred；observe 记录 would accept 但不接单；auto 才让正向研判接单。显式请求在三种模式下都有效。', state: 'absent', code: 'modes', ref: 'docs/002-authorization.md:93-101' },
    { n: 7, from: 'gate', to: 'eval', label: 'GateResult: admissible + basis', kind: 'command', note: 'gate 输出 {admissible, strength, basis}；basis 记下它是靠 addressed / followup / admission / listed / bot 哪条放行的，供日后 revalidate 复查。', state: 'absent', code: 'strength', ref: 'src/core/ports.ts:GateResult' },
    { n: 8, from: 'eval', to: 'assessor', label: 'inferred 必须完整 assessment', kind: 'message', note: '每条 enabled rule 恰好评一次；proactive accept 至少要命中一条规则。唯一捷径是卡片明显不碰任何规则时直接 ignore，并记 ignoredFromCard。', state: 'absent', code: 'modes', ref: 'docs/002-authorization.md:85-89,101' },
    { n: 9, from: 'assessor', to: 'router', label: 'candidate card → 主 Session', kind: 'message', note: '显式候选走 orchestrator_route，一次调用可含多个 accept/attach/stop/ignore，逐条独立执行；某个被拒不影响其它。', state: 'absent', code: 'two-paths', ref: 'docs/002-authorization.md:85' },
    { n: 10, from: 'router', to: 'mandate', label: 'accept 创建 Mandate', kind: 'command', note: 'Mandate 记 Policy version、scope、strength、matched rules 与 sender 身份；不可变，更大范围要开新 Ticket。', state: 'granted', code: 'decide-guard', ref: 'src/core/evals.ts:Evals.accept' },
    { n: 11, from: 'mandate', to: 'ticket', label: 'Ticket 受 Mandate 约束', kind: 'fact', note: '订阅只提供上下文，每张票仍被自己的 Mandate 限死。Policy 变化只给受影响的 live Ticket 发 policy-changed Input，不立即撤销 Mandate。', state: 'held', code: 'resume', ref: 'docs/002-authorization.md:107-117' },
    { n: 12, from: 'subscription', to: 'ticket', label: 'fan-out 绕过 gate，不给权', kind: 'message', note: '包括 bot / CI 在内，已订阅 Thread 的每条消息都作为 context 到达；这条路径完全没有准入检查。', state: 'held', code: 'two-paths', ref: 'docs/002-authorization.md:20' },
    { n: 13, from: 'ticket', to: 'worker', label: '人的追问归 Worker 决定', kind: 'message', note: 'Worker 在范围内就处理，越界或属于别的票就 handback 一次；期间 Router 只能按人的请求 stop，accept / attach / ignore / requeue 都会被拒。', state: 'held', code: 'two-paths', ref: 'docs/002-authorization.md:22-32' },
    { n: 14, from: 'worker', to: 'eval', label: 'handback 后无人认领才重排', kind: 'event', note: '消息只有在没有任何 Ticket 认领时才进入新的 Eval，候选里会带上各 Executor 给出的理由。', state: 'held', code: 'two-paths', ref: 'docs/002-authorization.md:28-34' },
    { n: 15, from: 'panel', to: 'mandate', label: '面板 stop = 命令，撤回 Mandate', kind: 'command', note: 'Thread 里一句「stop」只是普通 Trigger，由 Eval 决定；面板上的 Stop 是直接作用于 Ticket 的命令，记为 manual stop。', state: 'withdrawn', code: 'resume', ref: 'docs/002-authorization.md:129,143-144' },
    { n: 16, from: 'revalidate', to: 'ticket', label: 'resume 前 revalidate', kind: 'fact', note: 'Source 仍监听原 Thread；explicit follow-up 直接通过，inferred 需要 auto + 规则仍启用，table / bot / listed 各有额外条件。通过才用同一 Mandate 复活。', state: 'held', code: 'resume', ref: 'docs/002-authorization.md:131-141' },
    { n: 17, from: 'revalidate', to: 'eval', label: '失败：视为未达任何 Ticket', kind: 'event', note: '票保持 ended、丢弃等待消息、主 Session 也不会被告知消息到过 worker；消息若无人认领就回 Eval，后续工作必须重新 accept。', state: 'revoked', code: 'resume', ref: 'docs/002-authorization.md:141' }
  ],
  states: {
    nodes: [
      { id: 'absent', label: '尚无 Mandate', c: 0, r: 0 },
      { id: 'granted', label: 'granted · accept 创建', c: 1, r: 0 },
      { id: 'held', label: 'held · 运行中 / 已结束仍保留', c: 2, r: 0 },
      { id: 'withdrawn', label: 'withdrawn · 人 stop', c: 2, r: 1 },
      { id: 'revoked', label: 'revoked · revalidate 失败', c: 1, r: 1 }
    ],
    transitions: [
      { from: 'absent', to: 'granted', label: 'Evals.accept' },
      { from: 'granted', to: 'held', label: 'Ticket 创建 / 结束' },
      { from: 'held', to: 'held', label: 'Policy 变化：只发 Input' },
      { from: 'held', to: 'withdrawn', label: '人的 stop' },
      { from: 'held', to: 'revoked', label: 'revalidate 失败' },
      { from: 'withdrawn', to: 'absent', label: '需要新的 accept' },
      { from: 'revoked', to: 'absent', label: '需要新的 accept' }
    ]
  },
  snippets: [
    { id: 'two-paths', symbol: 'Two paths for a Trigger', path: 'docs/002-authorization.md',
      code: [
        '### Eval: deciding whether to start work',
        '- An allowed person who addresses the agent makes an explicit request.',
        '- A bot on the Source\'s bot list can produce an inferred candidate, never an explicit request.',
        '### Subscriptions: continuing existing work',
        'Every message on a subscribed Thread reaches its subscribed Tickets as context, including messages from bots and CI.',
        'This delivery bypasses the gate and grants no new authority.'
      ].join('\n'),
      why: '两条路径的分工是整篇文档的轴：Eval 管「开不开工」，Subscription 管「续上下文」。' },
    { id: 'strength', symbol: 'Strength', path: 'docs/002-authorization.md',
      code: [
        '| explicit | A person on the list addresses the agent, or follows up on a Thread that already has a Ticket |',
        '| inferred | A person not on the list follows up on a Thread with a Ticket ... |',
        '| not admitted | Any other bot\'s message, everything the admission table ignores, and every inferred case while the accept mode is `off` |'
      ].join('\n'),
      why: '强度不是「消息重要程度」，而是授权的来源等级；off 只挡 inferred。' },
    { id: 'cells', symbol: 'Admission cells', path: 'docs/002-authorization.md',
      code: [
        '| On the list, not addressing the agent | inferred, ignore | inferred |',
        '| Not on the list, addressing the agent | explicit, inferred, ignore | ignore |',
        '| Not on the list, not addressing the agent | inferred, ignore | ignore |'
      ].join('\n'),
      why: '一张表就表达了主动性边界；只有 Source 收全部消息的范围才有后两格可用。' },
    { id: 'modes', symbol: 'Accept mode and rules', path: 'docs/002-authorization.md',
      code: [
        '| `off` | Nothing inferred becomes a candidate |',
        '| `observe` (default) | a positive assessment is recorded as ignore marked "would accept", and nothing is accepted |',
        '| `auto` | A positive assessment of an inferred candidate accepts it |',
        'Explicit requests work in every mode.'
      ].join('\n'),
      why: '默认 observe 是安全档：先看记录的 Decision，再决定是否切到 auto。' },
    { id: 'decide-guard', symbol: 'Evals.decide', path: 'src/core/evals.ts',
      code: [
        "    if (outcome.kind === 'accept' && evaluation.strength !== 'explicit' && !this.policy().admitsInferred(outcome.rules ?? [])) {",
        "      throw new UserError('notExplicit')",
        '    }'
      ].join('\n'),
      why: '代码层强制「推断候选不得直接接单」；这正是「消息文本改不了权限」的一个例子。' },
    { id: 'resume', symbol: 'Resume and stop', path: 'docs/002-authorization.md',
      code: [
        'Only three operations change a Mandate: accept creates it, a person\'s stop withdraws it, and failed revalidation revokes it.',
        '- An explicit follow-up Mandate passes.',
        '- An inferred Mandate needs `auto` mode and its matched rules still enabled.',
        'A person saying "stop" in a Thread is an ordinary Trigger, and Eval decides stop.'
      ].join('\n'),
      why: '把「谁能改授权」收敛到三个操作，是这套模型最值钱的纪律。' }
  ],
  glossary: [
    { term: 'Gate', desc: 'Eval 的确定性第一层：谁可以发起工作、以什么强度。输出 GateResult。', src: '001:90; src/core/ports.ts' },
    { term: 'Assessment', desc: '模型研判；每条 enabled rule 恰好评一次。', src: '002:91,101' },
    { term: 'Admission table', desc: '每个 Source 的 Policy 里按接收范围分行，最多三格决定请求强度。', src: '002:58-71' },
    { term: 'Strength', desc: 'explicit / inferred / not admitted；显式 cell 优先于 follow-up 推断。', src: '002:46-54' },
    { term: 'AcceptMode', desc: 'off / observe / auto，属于 Policy version；默认 observe。', src: '002:93-101' },
    { term: 'MandateBasis', desc: 'gate 放行依据：addressed / followup / admission / listed / bot，供 revalidate 复查。', src: 'src/core/model.ts' },
    { term: 'Policy version', desc: 'rules + accept mode + 各 Source 部分的组合标识，每个 Mandate 都记录它。', src: '002:107-109' },
    { term: 'Handback', desc: 'Executor 把越界或属于别票的消息交回，一次；无人认领才进新 Eval。', src: '002:28-32' },
    { term: 'Revalidate', desc: '结束的票复活前按 Mandate basis 复查当前 Policy；失败则撤销。', src: '002:131-141' },
    { term: 'ignoredFromCard', desc: '卡片明显不碰任何启用规则时的快捷 ignore，用来和规则研判区分。', src: '002:87' },
    { term: 'would accept', desc: 'observe 模式下正向研判只记录为 ignore 并打标，不真的接单。', src: '002:98' },
    { term: 'unavailable', desc: 'Eval 超时两次重试、研判失败或 Policy 过期时的 Decision。', src: '002:147-155' }
  ],
  pitfalls: [
    'off 不挡显式请求：explicit 在 off / observe / auto 下都有效，且显式 cell 优先于 follow-up 推断。',
    '订阅绕过 gate 但不给授权；「人在 Thread 里说 stop」只是普通 Trigger（Eval 决定），只有面板 Stop 是直接命令。',
    'revalidate 失败时票保持 ended、丢弃等待消息，主 Session 甚至不会被告知消息曾到达 worker；此时不能 attach，只能重新 accept。'
  ],
  labs: [
    { title: '实验 A · 准入表复刻', goal: '写一个纯函数 gate(...)，验证 off 与显式 cell 的组合行为。',
      steps: [
        '声明强度序 STRENGTH={ignore:0, inferred:1, explicit:2} 与 ADMISSION_DEFAULTS。',
        '实现 admissionCell(human, addressed, allowed, participating, mode, cell)。',
        '验证 off + unlistedAddressed:explicit 仍返回 explicit；inferred 在 off 下被挡。',
        '验证 context-only Thread 使用 admission table 而不是 follow-up 强度；human:false 走 bot list。'
      ] },
    { title: '实验 B · Mandate 三操作与 revalidate', goal: '用对象模拟 Mandate 生命周期，只有三条迁移合法。',
      steps: [
        '状态机只允许 accept→granted、stop→withdrawn、failedRevalidate→revoked。',
        '实现 revalidate(mandate, policy)，按 basis 分支检查 auto / rules / bot list / allowed list。',
        '投入「Policy 改了但没到 resume」的用例，确认 Mandate 不被撤销、只产生 policy-changed Input。',
        '投入「sender 被移出名单」的用例，确认 resume 被拒、消息回 Eval。'
      ] }
  ],
  takeaways: [
    '授权只有一个来源：accept 创建的 Mandate；订阅、消息文本、提示词都不能改变它。',
    '主动性由 admission table × accept mode × enabled rules 三层共同控制，默认 observe 让系统先只记录不动作。',
    '只有 accept / 人的 stop / revalidate 失败能改变 Mandate，这条收敛让「恢复」也可预测。'
  ]
});
