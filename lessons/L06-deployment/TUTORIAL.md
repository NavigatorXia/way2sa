# L06 代码教程 · 部署与宿主装配

片段逐字抄自 `dsh-superagent-prototype`。实验代码纯 JS，可直接 `node` 运行。

## 1. 源码地图

| 路径 | 符号 | 看什么 |
|---|---|---|
| `package.json` | `dsh.bundle.patch` / `engines` | 把普通 npm 包声明成 DSH bundle |
| `cordis.patch.yml` | `insert` / preset / `bash-sandbox` / `tool-jobs` | 插件行词汇与 5 秒后台化 |
| `examples/profile.cordis.patch.yml` | `stateDir` / `webserver.port` | profile 层与 bundle 层的分工 |
| `src/deployment.ts` | `Config` / `machineOf` / `MOVED` / `resolveDeployment` | 机器配置 schema 与 setup 账号验证 |
| `src/infra/environment.ts` | `writeEnvironment` / `WORKER_COMMANDS` | shim 与 gitconfig |
| `src/index.ts` | `apply` / `restart` | 插件入口与 `ctx.fiber.restart()` |
| `src/app/runtime.ts` | `Runtime.initialize` | 组合根顺序 |
| `src/app/sessions.ts` | `ensure` / `decorate` | preset 绑定与工具白名单 |
| `scripts/dsh-superagent` | `state` / `outcome` / `start` | 进程管理与退出码契约 |

## 2. 逐段精读

### 2.1 `package.json` — bundle 的入口声明

```json
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
```

```json
  "engines": {
    "node": "^22.19.0 || >=24.0.0",
    "dsh": "^0.2.1-alpha.2"
  },
```

`dsh.bundle.patch` 让 DSH 把仓库根的 `cordis.patch.yml` 当作 entry-list patch 应用；`files` 把 `lib / cordis.patch.yml / prompts / skills` 打进包；`peerDependencies` 全部锁到同一 DSH 版本。**这一行是「配置从哪来」的唯一答案。**

### 2.2 `cordis.patch.yml` — 5 行 insert 就是词汇表

第 4–12 行：

```yaml
- insert:
    - id: dsh-superagent
      name: dsh-superagent
    - id: dsh-superagent-github
      name: dsh-superagent/github-watch
    # Optional Feishu Source; requires configuring a bot CLI after enabling.
    - id: dsh-superagent-feishu
      name: dsh-superagent/feishu-watch
      disabled: true
```

worker preset（`:20-26`）：

```yaml
    - id: dsh-superagent-worker-preset
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: dsh-superagent-worker
        name: dsh-superagent 执行器
        description: dsh-superagent 的执行器 Session 专用，不供手动选择。前台命令超 5 秒转入后台，只含执行工作所需的工具。
        order: 90
```

router preset 在 `:125-131`，`order: 91`。两个 `config.id` 必须与 `src/app/sessions.ts:47-48` 的 `WORKER_PRESET` / `ROUTER_PRESET` 常量一致。`tests/bundle-patch.spec.ts:31-32` 用 Cordis 的 `applyEntryPatches` 直接断言这 5 行的 id 顺序。**bundle 只插行不带配置**：`stateDir` 来自 profile 的 `examples/profile.cordis.patch.yml`，否则插件拒绝启动。

### 2.3 5 秒后台化 — `bash-sandbox` / `tool-jobs`

```yaml
              - id: bash-sandbox
                name: '@deepseek-ai/dsh-bash-sandbox'
                disabled: !!js process.platform === 'win32'
                config:
                  timeoutMs: 5000
                  maxTimeoutMs: 5000
```

```yaml
          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'
            config:
              waitTimeoutMs: 5000
              maxWaitTimeoutMs: 5000
```

`!!js` 是 patch 方言表达式。`subagent` 用 `agentPreset: standard`（其 shell 60s 才后台化，因为子代理结束时作业会被杀）。这三个 `5000` 被 `tests/bundle-patch.spec.ts:37-39,43` 显式断言。它与 L03 的 worker slot、L04 的 `noWait` 共同保证主 Session 不被长命令卡住。

### 2.4 `machineOf` — 未知键拒绝启动

`src/deployment.ts:15-17,38-41`：

```ts
export const Config = s.object({
  stateDir: absolute('Directory for the database, locks, worker shims, the agent\'s git configuration and, by default, the ticket directories.').required(),
  promptMaxChars: s.number().min(LIMITS.promptMaxChars.min).max(LIMITS.promptMaxChars.max).step(1).default(100000)
```

```ts
export function machineOf(config: DeploymentConfig): Machine {
  const unknown = Object.keys(config).filter(key => !(key in (Config.dict ?? {})))
  if (unknown.length) throw new Error(`dsh-superagent configuration has keys it does not use: ${unknown.map(key => MOVED[key] ? `${key} (now ${MOVED[key]})` : key).join(', ')}; docs/006-deployment.md lists the keys`)
  const { stateDir, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs } = config
```

`stateDir` 必填且必须绝对路径（`absolute()` 用 `/^\//`）；三个限额是 `.volatile()`，改后无需重启。`MOVED` 映射旧键（`repository → GitHub Source`、`author → prompt text`、`blockedCommands → Execution settings` 等）。**机器配置与设置页被刻意分开**：升级时 `stateDir` 不能在面板里改。

### 2.5 `resolveDeployment` — setup 的结构化验证

`src/deployment.ts:87-92`：

```ts
export async function resolveDeployment(machine: Machine, github: unknown, probe: Probe, path = process.env.PATH ?? ''): Promise<Deployment> {
  const { stateDir } = machine
  const accounts = GithubAccountsSchema.parse(github ?? {})
  const remote = accounts.repository
  if (!remote) throw new SetupError('repositoryUnset')
  if (!accounts.cli) throw new SetupError('agentCliUnset')
  let cli: string
```

`:95` 用 `probe([cli, 'api', 'user'])` 验身份，`:99-105` 用 `repos/... --jq` 验 `push` 权限（`push !== true → repositoryReadOnly`），仓库名取 GitHub 返回的 `full_name` 以兼容重命名，`noreply = ${id}+${login}@users.noreply.github.com`。所有错误是 `SetupError(code, values)` 并带 `place`（`deployment` / `github` / `feishu`），面板据此把人带到对应设置页。`workerProbe` 会先把 `worker-bin` 从 PATH 移除，避免 shim 自引用。

### 2.6 `writeEnvironment` — 账户绑定落在进程环境

`src/infra/environment.ts:100-104`：

```ts
  await shim('gh', run(github.cli))
  await shim('lark-cli', feishu ? run(feishu.cli) : fail('lark-cli is unavailable: this installation has no Feishu bot.'))
  for (const name of new Set(blockedCommands.filter(name => !WORKER_COMMANDS.includes(name)))) {
    await shim(name, fail(`${name} is blocked in this installation; use gh, which acts as ${github.login}.`))
  }
```

`WORKER_COMMANDS = ['gh','git','lark-cli']` 不允许被 block；`own()` 拒绝覆盖非本系统写的文件（`SetupError('foreignFile')`）；shim 用临时文件 + `rename` 原子替换，避免并发 worker 看到半写状态；`worker-gitconfig` 通过 `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_NOSYSTEM=1` 替换操作者的全局/系统 git 配置。**注意：这不是进程隔离**，worker 仍可按绝对路径执行任意程序、读操作者 home。

### 2.7 `apply` → `initialize` → `ensure` — 组合根顺序

`src/index.ts:10-13`：

```ts
export async function apply(ctx: Context, config: DeploymentConfig): Promise<void> {
  const machine = machineOf(config)
  // The management panel provides its own settings UI, so disable DSH's auto-generated settings page.
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
```

`src/app/runtime.ts:201-207`：

```ts
  private async initialize(): Promise<void> {
    // Register management HTTP routes before setup completes so operators can fix setup problems in the UI.
    this.disposers.push(registerHttp(this.ctx, this.httpHost()))
    if (!await this.setup.run(this.store.settings())) {
      this.runtimeHealth.set({ ...health('paused', 'setupPending'), at: now() })
      return
    }
    this.sessions.install()
```

后续顺序：`sessions.install()` → `ensure(masterId, stateDir, ..., 'orchestrator')` → `syncable().sync()` → `executor.resume()` / `passes.start()`。

`src/app/sessions.ts:138-145`：

```ts
  async ensure(id: string, cwd: string, title: string, role: 'orchestrator' | 'worker'): Promise<Agent> {
    const ctx = this.ctx
    let result = await ctx.sessionController.resolveAgent(id as SessionId)
    if ('error' in result && result.error.code === 'session/not-found') {
      const workspace = await ctx.workspaceRegistry.create(cwd)
      // A Session keeps the preset it was created with, one of the bundle's own (cordis.patch.yml).
      await ctx.sessionController.create({ sessionId: id as SessionId, workspaceId: workspace.id,
```

`agentPreset: role === 'worker' ? WORKER_PRESET : ROUTER_PRESET`，并 `permissionPresets.set(..., 'danger-full-access')`。注释里那句「A Session keeps the preset it was created with」就是删 patch 行会报 `agent-preset/not-found` 的原因。

### 2.8 `outcome()` — 退出码是给监控的契约

`scripts/dsh-superagent:112-119`：

```python
def outcome(pids, current):
    """Compute the CLI exit code from running PIDs and management API state."""
    if len(pids) != 1 or not runtime_up(current):
        return 1
    if current['setup']:
        return SETUP_WAITS
    # A component's lasting error, unlike a Feishu bot check that failed during setup, requires operator action.
    return PART_ERROR if part_errors(current) else 0
```

`PART_ERROR = 2`、`SETUP_WAITS = 3`。`runtime_up` 要求恰好 1 个 pid 且 `health.runtime ∈ {ready, paused}`；`part_errors` 排除 runtime 本身。`:176-178`：

```python
        # `exec` replaces the shell so the pane PID printed by tmux is the DSH service process itself.
        command = ('umask 077; exec ' + shlex.join([dsh, '--profile', args.profile, '--no-open'])
                   + ' >> ' + shlex.quote(str(log)) + ' 2>&1')
```

`exec` 让 tmux pane 的 PID 就是服务进程。`manually-stopped` 只有 `stop` 写、`start` 清、`restart` 不写，于是 `--respect-stop` 能在监控里保留人为停止，同时救回一次 shutdown 超时的重启。

## 3. 实验 A · patch → preset → Session 装配可视化

```js
const PATCH = [
  { id: 'dsh-superagent', name: 'dsh-superagent', type: 'plugin' },
  { id: 'dsh-superagent-github', name: 'dsh-superagent/github-watch', type: 'plugin' },
  { id: 'dsh-superagent-feishu', name: 'dsh-superagent/feishu-watch', type: 'plugin', disabled: true },
  { id: 'dsh-superagent-worker-preset', name: '@deepseek-ai/dsh-agent-preset', type: 'preset', preset: 'dsh-superagent-worker', order: 90 },
  { id: 'dsh-superagent-router-preset', name: '@deepseek-ai/dsh-agent-preset', type: 'preset', preset: 'dsh-superagent-router', order: 91 }
];
const WORKER_PRESET = 'dsh-superagent-worker', ROUTER_PRESET = 'dsh-superagent-router';

function machineOf(config) {
  const known = ['stateDir', 'promptMaxChars', 'admissionContextMaxPages', 'admissionContextTimeoutMs'];
  const unknown = Object.keys(config).filter(k => !known.includes(k));
  if (unknown.length) throw new Error('unknown config keys: ' + unknown.join(', '));
  if (!config.stateDir || !config.stateDir.startsWith('/')) throw new Error('stateDir must be absolute');
  return config;
}
function ensure(sessionId, role, enabledPresets) {
  const wanted = role === 'worker' ? WORKER_PRESET : ROUTER_PRESET;
  if (!enabledPresets.has(wanted)) throw new Error('agent-preset/not-found: ' + wanted);
  return { sessionId, agentPreset: wanted, permission: 'danger-full-access' };
}
function resume(session) {
  if (!session) return 'no session';
  return 'resume ok: ' + session.agentPreset;
}
const config = machineOf({ stateDir: '/Users/me/.dsh/superagent', promptMaxChars: 100000 });
const enabled = new Set(PATCH.filter(p => p.type === 'preset' && !p.disabled).map(p => p.preset));
const master = ensure('master', 'orchestrator', enabled);
const worker = ensure('worker-tk1', 'worker', enabled);
console.log('config =', config, '\nmaster =', master, '\nworker =', worker);
console.log('resume =', resume(master));
enabled.delete(WORKER_PRESET);                              // 模拟删掉 patch 行
try { ensure('worker-tk2', 'worker', enabled); } catch (e) { console.log('删行后：', e.message); }
try { machineOf({ stateDir: 'relative/path' }); } catch (e) { console.log('相对路径：', e.message); }
console.log('5 秒后台化：timeoutMs=5000, waitTimeoutMs=5000 → 前台命令转后台');
```

**断言**：5 行 insert 中 3 个插件 + 2 个 preset；`ensure` 按角色选 `WORKER_PRESET` / `ROUTER_PRESET`；删掉 worker preset 行后 resume 报 `agent-preset/not-found`；`stateDir` 非绝对路径被拒。

## 4. 实验 B · 退出码 0/1/2/3 与停止标记模拟器

```js
const PART_ERROR = 2, SETUP_WAITS = 3;
let marker = false;                                        // manually-stopped
function runtime_up(current) {
  return ['ready', 'paused'].includes(current.health.runtime) && current.runtimeUp;
}
function partErrors(current) { return current.parts.filter(p => p !== 'runtime' && p.startsWith('error')).length > 0; }
function outcome(pids, current) {
  if (pids.length !== 1 || !runtime_up(current)) return 1;
  if (current.setup) return SETUP_WAITS;
  return partErrors(current) ? PART_ERROR : 0;
}
function stop() { marker = true; }
function start() { marker = false; }
function restart({ respectStop }) { if (respectStop && marker) return 'skipped: 尊重人为停止'; return 'restarted'; }
function hourlyCheck(pids, current) {
  const code = outcome(pids, current);
  return code === 1 ? restart({ respectStop: true }) : 'no action (code ' + code + ')';
}
const healthy = { health: { runtime: 'ready' }, runtimeUp: true, setup: false, parts: ['ok', 'ok'] };
console.log('健康 →', outcome([101], healthy));                                   // 0
console.log('两个 pid →', outcome([101, 102], healthy));                            // 1
console.log('setup 等待 →', outcome([101], { ...healthy, setup: true }));          // 3
console.log('组件错误 →', outcome([101], { ...healthy, parts: ['error:source'] }));  // 2
console.log('Source 仍在启动 →', outcome([101], { ...healthy, parts: ['starting'] })); // 0
console.log('进程挂了 →', hourlyCheck([], healthy));
stop();
console.log('stop 后 marker =', marker, '| hourly →', hourlyCheck([], healthy));
console.log('start 清 marker =', (start(), marker));
console.log('restart 不写 marker =', (restart({ respectStop: false }), marker));
```

**断言**：`0` 正常、`1` 可重启修、`2` 组件持续错误、`3` setup 等待人工；仍在启动的 Source 与未检查的 Feishu bot 都返回 0；`stop` 写 marker、`start` 清、`restart` 不写，`--respect-stop` 因此不会误拉起。

## 5. 自检清单

- [ ] 能说清 profile patch 与 bundle patch 各管什么配置。
- [ ] 能复述 5 行 insert 的 id 与两个 preset 的 order。
- [ ] 能解释三个 `5000` 与 `subagent: standard (60s)` 的不同权衡。
- [ ] 能写出 `Runtime.initialize` 的完整顺序并解释路由先行。
- [ ] 能说明 `writeEnvironment` 是凭据包装而非进程隔离。
- [ ] 能实现 `outcome()` 并解释 marker 与 `--respect-stop` 的配合。
- [ ] 能列出升级时两条不可逆风险（profile 重建、数据库迁移）。

## 6. 回到动态演示

| 步骤 | 对应源码 |
|---|---|
| 1–3 profile / bundle / insert | `docs/006:75-98`、`package.json:22-33,53-56`、`cordis.patch.yml:4-12,20,125` |
| 4 preset 与 5 秒 | `cordis.patch.yml:23-26,44-50,70-74,128-131` |
| 5 `machineOf` | `src/deployment.ts:15-43` |
| 6 路由先行 | `src/app/runtime.ts:201-203` |
| 7–9 setup / 环境 / 校验 | `src/deployment.ts:87-105`、`src/infra/environment.ts:79-116`、`src/app/setup.ts:87-97` |
| 10–12 Store / install / ensure | `docs/006:236,242`、`src/app/runtime.ts:208-209`、`src/app/sessions.ts:138-155` |
| 13 decorate / noWait | `docs/006:19` |
| 14–16 进程 / 退出码 / 巡检 | `scripts/dsh-superagent:159-184,81-95,112-129`、`docs/006:138,141` |
| 17 broken → restart | `docs/006:113-124` |
| 18 setup-waits(3) | `scripts/dsh-superagent:112-119`、`docs/006:181-191` |
| 19 part-error(2) | `scripts/dsh-superagent:part_errors` |
| 20 manually-stopped | `docs/006:138,141` |
