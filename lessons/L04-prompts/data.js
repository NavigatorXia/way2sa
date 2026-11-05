window.Course.boot({
  id: 'L04', title: '提示词', tag: '规则怎么注入', doc: '004-prompts.md',
  subtitle: 'docs/004 讲的是一套「版本化配置 → 固定顺序装配 → 每次模型请求注入」的机制，以及提示词永远改不了权限这件事。',
  goal: '能复述 system prompt 的 8 段装配顺序、解释 revision 的 next-request 生效语义，并说清团队 override 与升级后的 Default updated 怎么处理。',
  questions: [
    '为什么 runtime/policy 必须放最后，而 orchestrator 与 worker 的段集合不同？',
    '保存一个提示词版本后，运行中的 Session 什么时候、以什么方式看到新版本？',
    '为什么改提示词文本永远改不了 gate、Mandate、工具检查与账户包装？'
  ],
  lanes: ['人在面板', 'HTTP / API', '提示词层 · 版本', 'Session 注入', '代码强制的事实'],
  nodes: [
    { id: 'panel', label: '面板 Prompts', sub: 'draft · Save', lane: 0, col: 0, kind: 'human' },
    { id: 'http', label: 'HTTP', sub: '同源 + PUT prompts', lane: 1, col: 0, kind: 'host' },
    { id: 'api', label: 'Api / savePrompts', sub: 'validate · conflict', lane: 1, col: 1, kind: 'host' },
    { id: 'versions', label: 'Versions', sub: '不可变快照 N', lane: 2, col: 0, kind: 'host' },
    { id: 'promptLayer', label: 'Prompts', sub: 'validate · compose', lane: 2, col: 1, kind: 'host' },
    { id: 'store', label: 'KV / Store', sub: 'prompts · sessions', lane: 2, col: 2, kind: 'host' },
    { id: 'policy', label: 'policySection', sub: '{version}{mode}{rules}', lane: 2, col: 3, kind: 'kernel', carry: true },
    { id: 'team', label: '团队三段', sub: 'communication/scope/delivery', lane: 2, col: 4, kind: 'host' },
    { id: 'session', label: 'systemPrompt.section', sub: 'order 9999', lane: 3, col: 0, kind: 'host' },
    { id: 'orchestrator', label: 'orchestrator', sub: 'dispatch+admission+policy', lane: 3, col: 1, kind: 'host', carry: true },
    { id: 'worker', label: 'worker', sub: 'work + environment', lane: 3, col: 3, kind: 'host', carry: true },
    { id: 'builtins', label: '内置 parts', sub: '15 个 override 键', lane: 4, col: 1, kind: 'host' },
    { id: 'facts', label: '工具与宿主事实', sub: '代码强制', lane: 4, col: 3, kind: 'kernel' },
    { id: 'tools', label: '主 Session 工具', sub: '权限更小', lane: 4, col: 0, kind: 'human' }
  ],
  edges: [
    { from: 'panel', to: 'http', label: 'PUT' },
    { from: 'http', to: 'api', label: 'sameOrigin' },
    { from: 'api', to: 'promptLayer', label: 'validate' },
    { from: 'promptLayer', to: 'store', label: 'save' },
    { from: 'store', to: 'versions', label: 'Versions.save' },
    { from: 'panel', to: 'session', label: 'notice' },
    { from: 'session', to: 'promptLayer', label: 'next request' },
    { from: 'promptLayer', to: 'store', label: 'bind revision' },
    { from: 'promptLayer', to: 'orchestrator', label: '8 段' },
    { from: 'promptLayer', to: 'worker', label: 'worker parts' },
    { from: 'store', to: 'policy', label: '现算' },
    { from: 'policy', to: 'orchestrator', label: '最后一段' },
    { from: 'team', to: 'promptLayer', label: 'override' },
    { from: 'builtins', to: 'promptLayer', label: '默认文本' },
    { from: 'orchestrator', to: 'facts', label: '优先级' },
    { from: 'facts', to: 'tools', label: '白名单' },
    { from: 'versions', to: 'team', label: '升级' }
  ],
  steps: [
    { n: 1, from: 'panel', to: 'http', label: '人在 Settings→Prompts 点 Save', kind: 'command', note: '发出 PUT /orchestrator/api/prompts，body 带 config 与 baseRevision；响应里 effect 是 next-request。', state: 'clean', code: 'save', ref: 'src/app/http.ts:208-211' },
    { n: 2, from: 'http', to: 'api', label: '同源守卫', kind: 'fact', note: 'host 必须是 127.0.0.1:<port> 或 localhost:<port>，且带 x-orchestrator-request: 1；外站 Origin 直接 403。', state: 'clean', code: 'save', ref: 'src/app/http.ts:75-79' },
    { n: 3, from: 'api', to: 'promptLayer', label: 'Prompts.validate(config)', kind: 'config', note: '.strict() 拒绝未知键、保留技能名、缺失占位符与 promptTooLong；超限是拒绝而不是静默截断。', state: 'editing', code: 'override', ref: 'src/app/prompts.ts:164-181' },
    { n: 4, from: 'promptLayer', to: 'store', label: 'save 校验 baseRevision', kind: 'config', note: 'stale revision 抛 PromptConflict → HTTP 409；首次保存先把 revision 0 用 versions.keep 固化为基线。', state: 'saving', code: 'versions', ref: 'src/app/prompts.ts:202-215' },
    { n: 5, from: 'store', to: 'versions', label: '写不可变快照，推进指针', kind: 'fact', note: '每次 save / restore / defaults 都产生 N+1 的新版本；版本含 previousRevision / savedAt / source / config。', state: 'rN', code: 'versions', ref: 'src/app/versions.ts:21-28' },
    { n: 6, from: 'panel', to: 'session', label: '只发 promptsNotice，不重启', kind: 'message', note: '文档原话：Saving does not restart, cancel or wake a Session。主 Session 在下次请求时才读到新版本。', state: 'pending', code: 'section', ref: 'docs/004-prompts.md:95' },
    { n: 7, from: 'session', to: 'promptLayer', label: '模型请求触发 section 回调', kind: 'event', note: 'systemPrompt.section 的 order 是 9999、interpolate:false，首行注入 [dsh-superagent prompt revision N] —— 这是版本生效的可见证据。', state: 'pending', code: 'section', ref: 'src/app/sessions.ts:244-249' },
    { n: 8, from: 'promptLayer', to: 'store', label: 'promptFor(bind=true) 绑定 revision', kind: 'fact', note: '把 revision 追加进 KV.sessions.prompts；同一 turn 的后续 step 也会重读，所以一轮对话里也可能换版本。', state: 'bound', code: 'section', ref: 'src/app/sessions.ts:329-339' },
    { n: 9, from: 'builtins', to: 'promptLayer', label: '读内置文本与 15 个 part 键', kind: 'fact', note: 'promptFile 把 prompts/*.md 按空行分段、每段合成一行；context.ts 把它们映射成 builtInParts 里的内置文本。', state: 'bound', code: 'promptFile', ref: 'src/app/skill-files.ts:29-32' },
    { n: 10, from: 'promptLayer', to: 'orchestrator', label: '按固定顺序装配 8 段', kind: 'fact', note: 'shared → role → 3 个团队段 → subscriptions/replies → dispatch → admission → handoff → environment → policy；空团队段被过滤掉。', state: 'bound', code: 'parts', ref: 'src/app/prompts.ts:102-116' },
    { n: 11, from: 'promptLayer', to: 'worker', label: 'worker 用 runtime/work', kind: 'fact', note: 'worker 不含 runtime/admission 与 runtime/policy，末尾止于 runtime/environment；角色差异是装配时决定的，不是运行时判断。', state: 'bound', code: 'team', ref: 'src/app/prompts.ts:110-114' },
    { n: 12, from: 'store', to: 'policy', label: 'policySection 现算三个占位符', kind: 'config', note: '从当前 settings 算 {version}=policyVersion(settings)、{mode}、{rules}；没有启用规则就换用 runtime/policy/none。', state: 'bound', code: 'policy-sec', ref: 'src/app/prompts.ts:92-97' },
    { n: 13, from: 'policy', to: 'orchestrator', label: 'runtime/policy 放最后', kind: 'fact', note: '不是因为它权限最高，而是因为 Policy 变化时前面所有 prompt 文本都不变，利于稳定与缓存。', state: 'bound', code: 'parts', ref: 'docs/004-prompts.md:59' },
    { n: 14, from: 'orchestrator', to: 'facts', label: '优先级：事实 > 内置 > 规则 > 团队 > 外部文本', kind: 'fact', note: '最强的是工具与宿主强制的事实（身份、权限、工具参数检查、回复目的与长度）；外部文本只是数据，永不改变规则或授权。', state: 'bound', code: 'team', ref: 'docs/004-prompts.md:65-71' },
    { n: 15, from: 'facts', to: 'tools', label: 'workOnly / noWait 守卫', kind: 'effect', note: '改提示词文本改不了 gate、Mandates、工具检查与账户包装；主 Session 工具保存的权限反而比面板 API 小。', state: 'bound', code: 'override', ref: 'src/app/sessions.ts:61-85,289-297' },
    { n: 16, from: 'versions', to: 'team', label: '升级：Default updated', kind: 'event', note: '内置文本变了的 override 被标记；人可选 Keep my text（把 base rebase 到新内置）或 Use the new default（删除 override）。未被 override 的段自动跟随新默认。', state: 'updated', code: 'override', ref: 'src/app/prompts.ts:186-194' },
    { n: 17, from: 'team', to: 'promptLayer', label: '三方 rebase 后重新装配', kind: 'config', note: '把 override 改回与默认完全一致等于删除它，反而重新跟随未来默认；省略 base 不是清空，而是保留已保存的 base。', state: 'rN', code: 'override', ref: 'docs/004-prompts.md:36-41,96' }
  ],
  states: {
    nodes: [
      { id: 'clean', label: 'clean · 无改动', c: 0, r: 0 },
      { id: 'editing', label: 'editing · 有草稿', c: 1, r: 0 },
      { id: 'saving', label: 'saving · 提交中', c: 2, r: 0 },
      { id: 'rN', label: 'revision N · 已存快照', c: 0, r: 1 },
      { id: 'pending', label: 'pending · 等下次请求', c: 1, r: 1 },
      { id: 'bound', label: 'bound · Session 已绑定', c: 2, r: 1 },
      { id: 'updated', label: 'Default updated', c: 0, r: 2 }
    ],
    transitions: [
      { from: 'clean', to: 'editing', label: 'edit' },
      { from: 'editing', to: 'saving', label: 'submit' },
      { from: 'saving', to: 'rN', label: 'saved {revision}' },
      { from: 'saving', to: 'editing', label: 'refused 409 / 400' },
      { from: 'rN', to: 'pending', label: 'promptsNotice' },
      { from: 'pending', to: 'bound', label: 'systemPrompt.section' },
      { from: 'bound', to: 'rN', label: '同一 turn 后续 step 重读' },
      { from: 'rN', to: 'updated', label: '升级改了内置文本' },
      { from: 'updated', to: 'rN', label: 'Keep my text / Use new default' }
    ]
  },
  snippets: [
    { id: 'team', symbol: 'TEAM_SECTIONS / TEAM_HEADINGS', path: 'src/app/prompts.ts',
      code: [
        "export const TEAM_SECTIONS = ['communication', 'scope', 'delivery'] as const",
        'export type TeamSection = typeof TEAM_SECTIONS[number]',
        '/** Markdown headings for each team section; fixed prompt sections refer to them by these exact names. */',
        "const TEAM_HEADINGS: Record<TeamSection, string> = { communication: 'Communication', scope: 'Ticket scope', delivery: 'Delivery requirements' }"
      ].join('\n'),
      why: '团队只写三段，固定段按标题引用它们 —— 所以升级内置文本时不需要改写团队内容。' },
    { id: 'promptFile', symbol: 'promptFile', path: 'src/app/skill-files.ts',
      code: [
        'export function promptFile(name: string): string {',
        "  const paragraphs = packaged('prompts', `${name}.md`).text.trim().split(/\\n(?:[ \\t]*\\n)+/)",
        "  return paragraphs.map(paragraph => paragraph.split('\\n').map(line => line.trim()).join(' ')).join('\\n')",
        '}'
      ].join('\n'),
      why: 'prompts/*.md 每句一行的写法在这里被合并成段落，这就是「内置文本」的来源。' },
    { id: 'parts', symbol: 'promptParts', path: 'src/app/prompts.ts',
      code: [
        '  return [',
        "    fixed('runtime/shared'), fixed(`runtime/${role}`),",
        '    ...TEAM_SECTIONS.map(team),',
        "    ...['subscriptions', 'replies', role === 'orchestrator' ? 'dispatch' : 'work'].map(name => fixed(`runtime/${name}`)),",
        "    ...role === 'orchestrator' ? [fixed('runtime/admission')] : [],",
        "    fixed('runtime/handoff', `runtime/handoff/${role}`),"
      ].join('\n'),
      why: '装配顺序就是优先级顺序；orchestrator 与 worker 的段集合在这里一次性分叉。' },
    { id: 'policy-sec', symbol: 'policySection', path: 'src/app/prompts.ts',
      code: [
        "  const line = (text: string) => text.replace(/\\s*\\n\\s*/g, ' ')",
        "  const rules = settings.policy.rules.filter(rule => rule.enabled).map(({ id, name, instruction }) => `- ${line(name)} (${id}): ${line(instruction)}`)",
        "  const part = rules.length ? 'runtime/policy' : 'runtime/policy/none'",
        "  return { key: part, text: fill(builtIn(config, part), { version: policyVersion(settings), mode: settings.eval.mode, rules: rules.join('\\n') }) }"
      ].join('\n'),
      why: 'Policy 段每次请求现算，规则名与 id 一起注入；这也是 Policy version 变化要重排 Eval 的原因。' },
    { id: 'section', symbol: 'decorate / systemPrompt.section', path: 'src/app/sessions.ts',
      code: [
        "    binding.disposers.push(agent.ctx.systemPrompt.section({ name: 'dsh-superagent-policy', order: 9999, interpolate: false, text: context => {",
        '      const version = this.promptFor(agent, context.signal !== undefined)',
        '      const current = ticket && host.store.tickets.get(ticket.id)',
        "      const composed = host.prompts.compose(version.config, master ? 'orchestrator' : 'worker', current ? host.environment(current) : undefined)",
        "      return `[dsh-superagent prompt revision ${version.revision}]\\n${composed}\\n${current ? mandateInstructions(current.mandate) : ''}`"
      ].join('\n'),
      why: '版本注入的关键位置：每次模型请求都重读 current()，并把 revision 与 Mandate 指令一起拼进 system prompt。' },
    { id: 'versions', symbol: 'Versions.save', path: 'src/app/versions.ts',
      code: [
        '  save(make: (revision: number) => V): V {',
        '    return this.store.atomic(() => {',
        '      const version = make(this.revision() + 1)',
        '      this.store.set(this.family(version.revision), version)',
        '      this.store.set(this.pointer, version.revision)',
        '      return version'
      ].join('\n'),
      why: '版本是 append-only 的不可变快照 + 一个指针；没有「原地修改」这回事。' },
    { id: 'override', symbol: 'Prompts.save / override 规则', path: 'src/app/prompts.ts',
      code: [
        "      if (!override.text.trim()) throw new UserError('promptPartEmpty', { part: name })",
        '      const missing = (part.placeholders ?? []).filter(placeholder => !override.text.includes(placeholder))',
        "      if (missing.length) throw new UserError('promptPlaceholders', { part: name, placeholders: missing.join(', ') })",
        '      const base = override.base ?? (Object.hasOwn(saved, name) ? saved[name]!.base : undefined) ?? builtInBase(part.text)',
        '      return override.text === part.text ? [] : [[name, { text: override.text, base }] as const]'
      ].join('\n'),
      why: '三个反直觉规则都在这一段：占位符必须留、省略 base 是保留、与默认相同等于删除 override。' },
    { id: 'save', symbol: 'savePrompts', path: 'src/app/prompts.ts',
      code: [
        "export async function savePrompts(host: { store: Pick<Store, 'atomic'>; prompts: Pick<Prompts, 'save'>; sessions: Pick<Sessions, 'notify' | 'delivery'> },",
        '  config: unknown, baseRevision: number, origin: SettingsOrigin) {',
        '  const version = host.store.atomic(() => {',
        "    const saved = host.prompts.save(config, baseRevision, origin)",
        "    if (origin !== 'tool') host.sessions.notify(...promptsNotice(saved.revision))"
      ].join('\n'),
      why: '保存、版本、通知在一个事务里；origin 区分面板与主 Session 工具的权限。' }
  ],
  glossary: [
    { term: 'TEAM_SECTIONS', desc: '团队可写的三段：communication / scope / delivery，顺序固定。', src: 'src/app/prompts.ts:14-15' },
    { term: 'PartKey', desc: '15 个可 override 的内置 part 键，如 runtime/dispatch、runtime/work。', src: 'src/app/prompts.ts:24-27' },
    { term: 'BuiltInPart', desc: '每段含 roles（BOTH / MAIN / WORKER）、内置文本、必须保留的占位符。', src: 'src/app/prompts.ts:47-70' },
    { term: 'PromptConfig', desc: '版本化配置根对象；.strict() 拒绝未知键。', src: 'src/app/prompts.ts:29-38' },
    { term: 'PromptVersion', desc: '不可变快照：revision / previousRevision / savedAt / source / config。', src: 'src/app/versions.ts:10-33' },
    { term: 'policyVersion', desc: '由 rules + mode + sources 哈希出的版本标识，每个 Mandate 都记录。', src: 'src/policy.ts' },
    { term: 'promptParts / composePrompt', desc: '按 docs/004 的 8 步顺序拼 system prompt。', src: 'src/app/prompts.ts:102-119' },
    { term: 'systemPrompt.section', desc: 'order 9999 的回调，每次模型请求重读版本并注入 revision 首行。', src: 'src/app/sessions.ts:244-249' },
    { term: 'effect: next-request', desc: '保存不重启 / 不取消 / 不唤醒；下一次请求才生效。', src: 'src/app/prompts.ts:246' },
    { term: 'DefaultChange', desc: '升级改动内置文本后，把受影响的 override 标为 Default updated。', src: 'src/app/prompts.ts:124-125,186-194' },
    { term: 'PromptConflict', desc: 'stale baseRevision 抛错，映射为 HTTP 409。', src: 'src/app/http.ts:89' },
    { term: 'workOnly / noWait', desc: 'Session 装饰里的工具白名单与防等待守卫，代码强制。', src: 'src/app/sessions.ts:61-85' }
  ],
  pitfalls: [
    '改提示词 ≠ 改权限：gate、Mandates、工具检查与账户包装由代码强制；外部文本永远只是数据。',
    '保存不重启、不唤醒，而且同一 turn 的后续 step 也会重读版本；runtime/policy 放最后是稳定性考虑，不是权限最高。',
    '把 override 改回与默认完全一致等于删除它；省略 base 是保留已保存的 base；升级后已移除 part 的 override 会被静默丢弃，但凭空捏造的 unknown part 会被拒绝。'
  ],
  labs: [
    { title: '实验 A · 8 段装配器', goal: '在页面里选 role，实时列出拼装顺序与每段的来源。',
      steps: [
        '声明 TEAM_SECTIONS 与两个角色各自的内置 part 列表。',
        '实现 assemble(role, config)：fixed → team → generated，空段过滤。',
        '切换 orchestrator / worker，观察 dispatch、admission、policy 三段的出现与消失。',
        '人为删掉某个占位符，让校验器报 promptPlaceholders。'
      ] },
    { title: '实验 B · revision + base 模拟器', goal: '复刻 next-request 生效与 Default updated 的两种选择。',
      steps: [
        '维护 current.revision、boundRevision、baseRevision 三个数字。',
        '点 Save 只推进 current 并置 pending；点「触发模型请求」才把 bound 追上 current。',
        '实现 Keep my text（rebase base）与 Use the new default（删除 override）。',
        '验证与默认文本完全相同的 override 保存后消失，之后自动跟随未来默认。'
      ] }
  ],
  takeaways: [
    '提示词是版本化数据 + 固定装配顺序，不是散落在代码里的字符串；每次请求都重新绑定版本。',
    '优先级里最强的是工具与宿主强制的事实，最弱的是外部文本；提示词文本永远改不了授权。',
    '升级时只有被 override 的段需要人处理，未 override 的段自动跟随新默认 —— 这大幅降低了维护成本。'
  ]
});
