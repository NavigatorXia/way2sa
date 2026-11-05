window.Course.boot({
  id: 'L06', title: '部署与宿主装配', tag: '怎么跑起来', doc: '006-deployment.md',
  subtitle: 'docs/006 把「一个研究原型」变成「一个能长期跑的服务」：profile / bundle / preset / Session / tmux 与 setup。',
  goal: '掌握 patch.yml → bundle → 两个 agent preset → Sessions.ensure → 进程的装配链，并理解 setup 验证与 status 退出码的运维语义。',
  questions: [
    'profile 的 cordis.patch.yml 和 bundle 的 cordis.patch.yml 各负责什么？',
    '两个 preset 的 5 秒后台化解决的是什么问题，为什么不能手选或禁用？',
    'status 的 0 / 1 / 2 / 3 分别代表什么，stop 与 restart 对停止标记有何不同？'
  ],
  lanes: ['安装与运维', 'profile / bundle', '插件与 preset', 'Runtime 装配', '进程与状态'],
  nodes: [
    { id: 'cli', label: 'CLI / 人', sub: 'dsh plugin add', lane: 0, col: 0, kind: 'human' },
    { id: 'profile', label: 'profile patch', sub: 'stateDir · port 3082', lane: 1, col: 0, kind: 'host' },
    { id: 'package', label: 'package.json', sub: 'dsh.bundle.patch', lane: 1, col: 1, kind: 'host' },
    { id: 'bundle', label: 'cordis.patch.yml', sub: '5 行 insert', lane: 1, col: 2, kind: 'host' },
    { id: 'config', label: 'machineOf(Config)', sub: '拒绝未知键', lane: 2, col: 1, kind: 'host' },
    { id: 'preset', label: '两个 agent preset', sub: 'worker 90 / router 91', lane: 2, col: 2, kind: 'host' },
    { id: 'setup', label: 'Setup.run', sub: 'resolveDeployment', lane: 2, col: 3, kind: 'host' },
    { id: 'env', label: 'writeEnvironment', sub: 'gh / lark-cli shim', lane: 2, col: 4, kind: 'host' },
    { id: 'runtime', label: 'Runtime.initialize', sub: 'registerHttp 先行', lane: 3, col: 1, kind: 'host' },
    { id: 'store', label: 'Store', sub: 'orchestrator.sqlite', lane: 3, col: 2, kind: 'host', carry: true },
    { id: 'sessions', label: 'Sessions.ensure', sub: 'decorate · noWait', lane: 3, col: 3, kind: 'host', carry: true },
    { id: 'jobs', label: 'bash / tool-jobs', sub: '5s 转后台', lane: 3, col: 4, kind: 'host' },
    { id: 'script', label: 'scripts/dsh-superagent', sub: 'tmux · PID · lock', lane: 4, col: 0, kind: 'human' },
    { id: 'status', label: 'GET state', sub: '退出码 0/1/2/3', lane: 4, col: 2, kind: 'human' },
    { id: 'health', label: 'hourly check', sub: '--respect-stop', lane: 4, col: 4, kind: 'host' }
  ],
  edges: [
    { from: 'cli', to: 'profile', label: '新装' },
    { from: 'profile', to: 'package', label: 'bundle' },
    { from: 'package', to: 'bundle', label: 'patch 入口' },
    { from: 'bundle', to: 'preset', label: 'insert 行' },
    { from: 'preset', to: 'config', label: 'apply' },
    { from: 'config', to: 'setup', label: 'resolve' },
    { from: 'setup', to: 'env', label: '写 shim' },
    { from: 'env', to: 'runtime', label: 'verify' },
    { from: 'config', to: 'runtime', label: 'initialize' },
    { from: 'runtime', to: 'store', label: 'lockSync' },
    { from: 'runtime', to: 'sessions', label: 'install' },
    { from: 'preset', to: 'sessions', label: 'ensure' },
    { from: 'preset', to: 'jobs', label: 'timeoutMs' },
    { from: 'sessions', to: 'jobs', label: 'noWait' },
    { from: 'cli', to: 'script', label: 'start' },
    { from: 'script', to: 'status', label: 'tmux exec' },
    { from: 'status', to: 'health', label: 'stateView' },
    { from: 'health', to: 'script', label: 'restart --respect-stop' }
  ],
  steps: [
    { n: 1, from: 'cli', to: 'profile', label: '新装：创建 profile', kind: 'command', note: 'dsh superagent --from-default-profile web 创建 profile，dsh plugin --profile superagent add 挂上仓库；profile patch 提供 stateDir 与 webserver.port。', state: 'stopped', code: 'bundle-yaml', ref: 'docs/006-deployment.md:75-85' },
    { n: 2, from: 'profile', to: 'package', label: 'bundle 声明', kind: 'config', note: 'package.json 的 dsh.bundle.patch = ./cordis.patch.yml 把仓库声明为 DSH bundle；engines 同时约束 node 与 dsh 版本。', state: 'stopped', code: 'package-json', ref: 'package.json:22-33,53-56' },
    { n: 3, from: 'package', to: 'bundle', label: 'patch 插入 5 行', kind: 'config', note: '3 个插件行（主插件 / github-watch / 默认禁用的 feishu-watch）+ 2 个 agent preset 行；用 entry-list 方言应用。', state: 'stopped', code: 'bundle-yaml', ref: 'cordis.patch.yml:4-12,20,125' },
    { n: 4, from: 'bundle', to: 'preset', label: 'worker(90) / router(91)', kind: 'config', note: '两个 @deepseek-ai/dsh-agent-preset；bash-sandbox 与 tool-jobs 的超时都是 5000ms，subagent 用 standard（60s）。', state: 'stopped', code: 'preset-timeout', ref: 'cordis.patch.yml:23-26,44-50,70-74,128-131' },
    { n: 5, from: 'preset', to: 'config', label: 'apply(ctx, config) → machineOf', kind: 'fact', note: '校验 stateDir 必须是绝对路径且必填；未知配置键直接拒绝启动，MOVED 表还会提示它搬到哪去了；同时关掉 DSH 自动设置页。', state: 'starting', code: 'machine', ref: 'src/deployment.ts:15-43' },
    { n: 6, from: 'config', to: 'runtime', label: 'Runtime.initialize 开始装配', kind: 'effect', note: '锁住 stateDir、打开 orchestrator.sqlite，并在 setup 完成之前先注册 /orchestrator/api 路由 —— 这样运维能进 UI 修 setup 问题。', state: 'starting', code: 'initialize', ref: 'src/app/runtime.ts:201-203' },
    { n: 7, from: 'config', to: 'setup', label: 'Setup.run → resolveDeployment', kind: 'command', note: '用 gh api user / repos/... --jq 验证仓库、agent 账号与 push 权限；Feishu bot 解析失败只记 feishuProblem，GitHub 仍可用。', state: 'starting', code: 'resolve', ref: 'src/deployment.ts:87-105' },
    { n: 8, from: 'setup', to: 'env', label: 'writeEnvironment 写 shim', kind: 'effect', note: '在 worker-bin 写 gh / lark-cli 包装器与 blocked commands 的 fail shim，并写 worker-gitconfig（GIT_CONFIG_GLOBAL / NOSYSTEM）。', state: 'starting', code: 'environment', ref: 'src/infra/environment.ts:79-116' },
    { n: 9, from: 'env', to: 'runtime', label: 'verifyEnvironment 通过', kind: 'fact', note: '检查 credential helper；失败会以 SetupError(foreignFile / gitTooOld / environmentFailed) 停在 problem 状态。', state: 'starting', code: 'environment', ref: 'src/app/setup.ts:87-97' },
    { n: 10, from: 'runtime', to: 'store', label: 'lockSync + Store 就绪', kind: 'effect', note: '单文件 <stateDir>/orchestrator.sqlite；升级后迁移过的数据库旧版打不开，所以升级前必须备份。', state: 'starting', code: 'initialize', ref: 'docs/006-deployment.md:236,242' },
    { n: 11, from: 'runtime', to: 'sessions', label: 'sessions.install() / executor.install()', kind: 'event', note: '监听 agent/created，Web UI 空白 Session 误选默认 preset 时在首轮之前改回 role-specific preset。', state: 'starting', code: 'initialize', ref: 'src/app/runtime.ts:208-209' },
    { n: 12, from: 'preset', to: 'sessions', label: 'ensure(masterId, ROUTER_PRESET)', kind: 'command', note: '主 Session 用 router preset，worker 由 DshExecutor 用 worker preset；Session 记住创建时的 preset，删掉 patch 行会导致 resume 报 agent-preset/not-found。', state: 'starting', code: 'initialize', ref: 'src/app/sessions.ts:138-155' },
    { n: 13, from: 'sessions', to: 'jobs', label: 'decorate：danger-full-access + noWait', kind: 'config', note: '主 Session 有工具白名单；sleep / >30s 命令 / >5s job 等待被拒。这不是进程隔离 —— worker 仍可按绝对路径执行程序、读操作者 home。', state: 'running', code: 'preset-timeout', ref: 'docs/006-deployment.md:19' },
    { n: 14, from: 'cli', to: 'script', label: 'start 在 tmux 里 exec dsh', kind: 'command', note: 'umask 077; exec dsh --profile superagent --no-open；用 exec 是为了让 tmux 打印的 pane PID 就是服务进程本身。', state: 'running', code: 'outcome', ref: 'scripts/dsh-superagent:159-184' },
    { n: 15, from: 'script', to: 'status', label: 'status 读 GET state，算退出码', kind: 'fact', note: 'pids 不等于 1 或 runtime 未就绪 → 1；有 setup 问题 → 3；非 runtime 组件报错 → 2；都健康 → 0。仍在启动的 Source 与未检查的 Feishu bot 都算正常。', state: 'running', code: 'outcome', ref: 'scripts/dsh-superagent:81-95,112-129' },
    { n: 16, from: 'status', to: 'health', label: 'hourly check --respect-stop', kind: 'effect', note: '只有 stop 写 manually-stopped 标记，start 清除，restart 不写 —— 这样监控能救回一次 shutdown 超时的重启。', state: 'running', code: 'outcome', ref: 'docs/006-deployment.md:138,141' },
    { n: 17, from: 'health', to: 'script', label: 'broken → restart', kind: 'event', note: '退出码 1 表示重启可能修好；有 marker 时 --respect-stop 会保留人为停止，不自动拉起。', state: 'broken', code: 'outcome', ref: 'docs/006-deployment.md:113-124' },
    { n: 18, from: 'status', to: 'health', label: 'setup 等待 → 退出码 3', kind: 'fact', note: "current['setup'] 非空时 outcome() 返回 SETUP_WAITS=3：仓库 / 账号 / push 权限需要人在面板里补齐，重启修不好。仍在启动的 Source 不算问题。", state: 'setup-waits', code: 'outcome', ref: 'scripts/dsh-superagent:112-119、docs/006:181-191' },
    { n: 19, from: 'status', to: 'health', label: '组件持续错误 → 退出码 2', kind: 'fact', note: 'part_errors(current) 为真返回 PART_ERROR=2；它排除 runtime 本身，指某个 Source / 组件的持续错误，需要运维处理而不是重启。', state: 'part-error', code: 'outcome', ref: 'scripts/dsh-superagent:112-119' },
    { n: 20, from: 'cli', to: 'script', label: 'stop 写 manually-stopped 标记', kind: 'command', note: '只有 stop 写 marker、start 清除、restart 不写；hourly check 带 --respect-stop，看到 marker 就跳过 start/restart，因此不会把人为停止误拉起。', state: 'manually-stopped', code: 'outcome', ref: 'docs/006-deployment.md:138,141' }
  ],
  states: {
    nodes: [
      { id: 'stopped', label: 'stopped · 无进程', c: 0, r: 0 },
      { id: 'starting', label: 'starting · 等 runtime_up', c: 1, r: 0 },
      { id: 'running', label: 'running(0) · 正常', c: 2, r: 0 },
      { id: 'part-error', label: 'part-error(2)', c: 3, r: 0 },
      { id: 'setup-waits', label: 'setup-waits(3)', c: 2, r: 1 },
      { id: 'broken', label: 'broken(1) · 可重启', c: 1, r: 1 },
      { id: 'manually-stopped', label: 'manually-stopped', c: 0, r: 1 }
    ],
    transitions: [
      { from: 'stopped', to: 'starting', label: 'scripts start' },
      { from: 'starting', to: 'running', label: 'pids=1 且全健康 → 0' },
      { from: 'starting', to: 'setup-waits', label: 'setup 非空 → 3' },
      { from: 'starting', to: 'part-error', label: 'part_errors → 2' },
      { from: 'starting', to: 'broken', label: 'pids!=1 / runtime 未就绪 → 1' },
      { from: 'running', to: 'manually-stopped', label: 'stop 写 marker' },
      { from: 'manually-stopped', to: 'running', label: 'start 清 marker' },
      { from: 'broken', to: 'starting', label: 'restart --respect-stop' },
      { from: 'part-error', to: 'running', label: '组件错误自清' }
    ]
  },
  snippets: [
    { id: 'package-json', symbol: 'dsh.bundle.patch / engines', path: 'package.json',
      code: [
        '  "dsh": {',
        '    "bundle": {',
        '      "patch": "./cordis.patch.yml"',
        '    },',
        '  "engines": {',
        '    "node": "^22.19.0 || >=24.0.0",',
        '    "dsh": "^0.2.1-alpha.2"'
      ].join('\n'),
      why: '这一行把普通 npm 包变成 DSH bundle，决定了 patch 从哪里读。' },
    { id: 'bundle-yaml', symbol: 'cordis.patch.yml insert', path: 'cordis.patch.yml',
      code: [
        '- insert:',
        '    - id: dsh-superagent',
        '      name: dsh-superagent',
        '    - id: dsh-superagent-github',
        '      name: dsh-superagent/github-watch',
        '    - id: dsh-superagent-worker-preset',
        "      name: '@deepseek-ai/dsh-agent-preset'"
      ].join('\n'),
      why: '插件行就是词汇：id / name / config / disabled / group；bundle 用它们装配整套系统。' },
    { id: 'preset-timeout', symbol: 'bash-sandbox / tool-jobs', path: 'cordis.patch.yml',
      code: [
        '              - id: bash-sandbox',
        "                name: '@deepseek-ai/dsh-bash-sandbox'",
        '                disabled: !!js process.platform === \'win32\'',
        '                config:',
        '                  timeoutMs: 5000',
        '                  maxTimeoutMs: 5000'
      ].join('\n'),
      why: '5 秒把前台命令转后台，是 worker 能「下一步就收新消息」的前提；!!js 表达式是 patch 方言。' },
    { id: 'machine', symbol: 'machineOf(Config)', path: 'src/deployment.ts',
      code: [
        'export function machineOf(config: DeploymentConfig): Machine {',
        "  const unknown = Object.keys(config).filter(key => !(key in (Config.dict ?? {})))",
        "  if (unknown.length) throw new Error(`dsh-superagent configuration has keys it does not use: ${unknown.map(key => MOVED[key] ? `${key} (now ${MOVED[key]})` : key).join(', ')}; docs/006-deployment.md lists the keys`)",
        '  const { stateDir, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs } = config'
      ].join('\n'),
      why: '未知键直接阻止启动，并用 MOVED 告诉用户旧键搬到哪了 —— 机器配置与设置页被刻意分开。' },
    { id: 'resolve', symbol: 'resolveDeployment', path: 'src/deployment.ts',
      code: [
        'export async function resolveDeployment(machine: Machine, github: unknown, probe: Probe, path = process.env.PATH ?? \'\'): Promise<Deployment> {',
        '  const { stateDir } = machine',
        '  const accounts = GithubAccountsSchema.parse(github ?? {})',
        '  const remote = accounts.repository',
        "  if (!remote) throw new SetupError('repositoryUnset')",
        "  if (!accounts.cli) throw new SetupError('agentCliUnset')"
      ].join('\n'),
      why: 'setup 用结构化 SetupError({place, code}) 报错，面板可以直接把人带到对应设置页。' },
    { id: 'environment', symbol: 'writeEnvironment', path: 'src/infra/environment.ts',
      code: [
        "  await shim('gh', run(github.cli))",
        "  await shim('lark-cli', feishu ? run(feishu.cli) : fail('lark-cli is unavailable: this installation has no Feishu bot.'))",
        '  for (const name of new Set(blockedCommands.filter(name => !WORKER_COMMANDS.includes(name)))) {',
        '    await shim(name, fail(`${name} is blocked in this installation; use gh, which acts as ${github.login}.`))',
        '  }'
      ].join('\n'),
      why: '账户包装器只负责选择凭据，不隔离进程；WORKER_COMMANDS 里的 gh/git/lark-cli 不允许被 block。' },
    { id: 'initialize', symbol: 'apply / Runtime.initialize / ensure', path: 'src/app/runtime.ts',
      code: [
        '  private async initialize(): Promise<void> {',
        '    // Register management HTTP routes before setup completes so operators can fix setup problems in the UI.',
        '    this.disposers.push(registerHttp(this.ctx, this.httpHost()))',
        '    if (!await this.setup.run(this.store.settings())) {',
        "      this.runtimeHealth.set({ ...health('paused', 'setupPending'), at: now() })"
      ].join('\n'),
      why: '组合根的顺序：路由 → setup → install → ensure → resume / passes.start；路由先行是运维可用性的关键。' },
    { id: 'outcome', symbol: 'scripts/dsh-superagent: outcome()', path: 'scripts/dsh-superagent',
      code: [
        'def outcome(pids, current):',
        '    """Compute the CLI exit code from running PIDs and management API state."""',
        "    if len(pids) != 1 or not runtime_up(current):",
        '        return 1',
        "    if current['setup']:",
        '        return SETUP_WAITS'
      ].join('\n'),
      why: '退出码是给监控脚本看的契约：1 可重启修，2/3 重启修不好，0 正常。' }
  ],
  glossary: [
    { term: 'dsh.bundle.patch', desc: 'package.json 里声明 bundle 的 patch 入口。', src: 'package.json:30-33' },
    { term: 'profile patch', desc: '提供 stateDir 与 webserver.port（示例 3082、host 127.0.0.1）。', src: 'examples/profile.cordis.patch.yml' },
    { term: 'WORKER_PRESET / ROUTER_PRESET', desc: '两个 agent preset id，order 90 / 91，不供手动选择。', src: 'src/app/sessions.ts:47-48' },
    { term: 'bash-sandbox / tool-jobs', desc: '5000ms 前台转后台与 job 等待上限；subagent 用 standard 60s。', src: 'cordis.patch.yml:44-50,69-74' },
    { term: 'machineOf(Config)', desc: '机器配置 schema；未知键拒绝启动，stateDir 必填绝对路径。', src: 'src/deployment.ts:13-43' },
    { term: 'SETUP_FIELDS', desc: '改动会触发 setup 重跑 / 重启的设置字段（github.repository/cli、feishu.cli）。', src: 'src/deployment.ts:50-51' },
    { term: 'SetupProblem', desc: '结构化启动错误：place + code，面板可跳转对应设置页。', src: 'src/setup.ts:4-39' },
    { term: 'writeEnvironment', desc: '写 worker-bin 命令 shim 与 worker-gitconfig，隔离 git 全局配置。', src: 'src/infra/environment.ts' },
    { term: 'Runtime.initialize', desc: '组合根：registerHttp → setup.run → install → ensure → resume → passes.start。', src: 'src/app/runtime.ts:201-218' },
    { term: 'Sessions.ensure / decorate', desc: '创建/恢复 Session 并挂 preset、工具白名单与 noWait 守卫。', src: 'src/app/sessions.ts:138-155' },
    { term: 'outcome()', desc: '由 pids 与 GET state 计算退出码 0/1/2/3。', src: 'scripts/dsh-superagent:112-119' },
    { term: 'manually-stopped', desc: '只有 stop 写、start 清、restart 不写的停止标记。', src: 'docs/006:141' }
  ],
  pitfalls: [
    '升级绝不能重跑 profile 创建命令：它会替换 profile 并删掉 cordis.patch.yml；新版迁移过的数据库旧版打不开，回滚必须先恢复升级前备份。',
    '两个 preset 不能手选或禁用；danger-full-access 不是进程隔离，账户包装器只选凭据，worker 仍可执行任意路径的程序、读操作者 home。',
    '只有 stop 写停止标记、start 清除、restart 不写；仍在启动的 Source 与 Feishu bot 未能检查都算正常运行。升级时 stateDir 不能在面板里改。'
  ],
  labs: [
    { title: '实验 A · patch → preset → session 装配可视化', goal: '把 yml 插件行变成可勾选的装配链。',
      steps: [
        '解析 5 行 insert：3 个插件 + 2 个 preset，显示 id / name / disabled。',
        '勾选 worker / router preset，模拟 Sessions.ensure 选择 preset 的过程。',
        '取消勾选后点 resume，观察 agent-preset/not-found 错误。',
        '把 timeoutMs 改成 5000，显示前台命令 5 秒转后台的效果。'
      ] },
    { title: '实验 B · 退出码 0/1/2/3 模拟器', goal: '用 5 个输入复刻 outcome()。',
      steps: [
        '输入 pids 数量、runtime 状态、setup 是否等待、partErrors、manually-stopped 标记。',
        '实现 outcome(pids, current) 返回 0/1/2/3 并给出原因。',
        '验证 stop 写 marker、start 清 marker、restart 不写，--respect-stop 因此不会误拉起。',
        '验证「仍在启动的 Source」与 Feishu 未检查都返回 0。'
      ] }
  ],
  takeaways: [
    '装配链是：profile patch → bundle patch → preset → Runtime → Sessions → 进程；每层各管一件事，不越界。',
    '5 秒后台化与 worker slot / 提示词注入共同支撑「异步、不阻塞、能随时收新消息」。',
    '运维语义写在退出码与 marker 里：可重启修的错和重启修不好的错必须分开。'
  ]
});
