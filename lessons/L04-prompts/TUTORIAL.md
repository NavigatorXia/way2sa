# L04 代码教程 · 提示词

片段逐字抄自 `dsh-superagent-prototype`。实验代码纯 JS，可直接运行。

## 1. 源码地图

| 路径 | 符号 | 看什么 |
|---|---|---|
| `src/app/prompts.ts` | `TEAM_SECTIONS` / `PART_KEYS` / `builtInParts` / `promptParts` | 装配顺序与 15 个 override 键 |
| `src/app/prompts.ts` | `policySection` / `promptParts` / `savePrompts` / `Prompts.save` | 生成段、版本与校验 |
| `src/app/versions.ts` | `Versions.save` | 不可变快照 + 指针 |
| `src/app/sessions.ts` | `decorate` / `systemPrompt.section` / `promptFor` | 版本注入与工具白名单 |
| `src/app/skill-files.ts` | `promptFile` | 内置文本从 md 装载 |
| `docs/004-prompts.md` | 优先级表 | 五层优先级 |

## 2. 逐段精读

### 2.1 团队段与内置文本

`src/app/prompts.ts`：

```ts
export const TEAM_SECTIONS = ['communication', 'scope', 'delivery'] as const
export type TeamSection = typeof TEAM_SECTIONS[number]
/** Markdown headings for each team section; fixed prompt sections refer to them by these exact names. */
const TEAM_HEADINGS: Record<TeamSection, string> = { communication: 'Communication', scope: 'Ticket scope', delivery: 'Delivery requirements' }
```

固定段按**标题**引用团队段，不复制其内容 —— 升级内置文本时团队内容不必改写。`src/app/skill-files.ts`：

```ts
export function promptFile(name: string): string {
  const paragraphs = packaged('prompts', `${name}.md`).text.trim().split(/\n(?:[ \t]*\n)+/)
  return paragraphs.map(paragraph => paragraph.split('\n').map(line => line.trim()).join(' ')).join('\n')
}
```

这解释了为什么 `prompts/*.md` 每句一行：空行分段，段内拼接成一行。

### 2.2 `promptParts` — 顺序就是优先级

```ts
  return [
    fixed('runtime/shared'), fixed(`runtime/${role}`),
    ...TEAM_SECTIONS.map(team),
    ...['subscriptions', 'replies', role === 'orchestrator' ? 'dispatch' : 'work'].map(name => fixed(`runtime/${name}`)),
    ...role === 'orchestrator' ? [fixed('runtime/admission')] : [],
    fixed('runtime/handoff', `runtime/handoff/${role}`),
```

orchestrator 额外有 `runtime/admission` 与末尾的 `runtime/policy`；worker 用 `runtime/work` 且止于 `runtime/environment`。空团队段被 `.filter(part => part.text)` 去掉。`tests/prompts.spec.ts` 直接断言 `parts[role].at(-1).name === 'runtime/policy'`（对 orchestrator）。

### 2.3 `policySection` — 每次请求现算

```ts
  const line = (text: string) => text.replace(/\s*\n\s*/g, ' ')
  const rules = settings.policy.rules.filter(rule => rule.enabled).map(({ id, name, instruction }) => `- ${line(name)} (${id}): ${line(instruction)}`)
  const part = rules.length ? 'runtime/policy' : 'runtime/policy/none'
  return { key: part, text: fill(builtIn(config, part), { version: policyVersion(settings), mode: settings.eval.mode, rules: rules.join('\n') }) }
```

`{version}` 来自 `policyVersion(settings)`（rules + mode + sources 的哈希），所以 Policy 一变，运行中的 Eval 必须丢弃重排（L02）。模板必须保留 `{version}` / `{mode}` / `{rules}`，否则 `promptPlaceholders` 报错。

### 2.4 `systemPrompt.section` — 版本注入的真正位置

`src/app/sessions.ts`：

```ts
    binding.disposers.push(agent.ctx.systemPrompt.section({ name: 'dsh-superagent-policy', order: 9999, interpolate: false, text: context => {
      const version = this.promptFor(agent, context.signal !== undefined)
      const current = ticket && host.store.tickets.get(ticket.id)
      const composed = host.prompts.compose(version.config, master ? 'orchestrator' : 'worker', current ? host.environment(current) : undefined)
      return `[dsh-superagent prompt revision ${version.revision}]\n${composed}\n${current ? mandateInstructions(current.mandate) : ''}`
```

`order: 9999` 保证它在最后；`interpolate:false` 防止宿主再解释文本；`promptFor(bind=true)` 把 revision 记进 `KV.sessions.prompts`。因为这是**回调**，同一 turn 的后续 step 也会重新调用，所以一轮对话里也可能换版本。

### 2.5 `Versions.save` 与 override 的三条反直觉规则

`src/app/versions.ts`：

```ts
  save(make: (revision: number) => V): V {
    return this.store.atomic(() => {
      const version = make(this.revision() + 1)
      this.store.set(this.family(version.revision), version)
      this.store.set(this.pointer, version.revision)
      return version
```

`src/app/prompts.ts:Prompts.save`：

```ts
      if (!override.text.trim()) throw new UserError('promptPartEmpty', { part: name })
      const missing = (part.placeholders ?? []).filter(placeholder => !override.text.includes(placeholder))
      if (missing.length) throw new UserError('promptPlaceholders', { part: name, placeholders: missing.join(', ') })
      const base = override.base ?? (Object.hasOwn(saved, name) ? saved[name]!.base : undefined) ?? builtInBase(part.text)
      return override.text === part.text ? [] : [[name, { text: override.text, base }] as const]
```

三行分别对应：占位符必须保留、省略 `base` 是**保留**已存值、与默认完全相同等于**删除** override。另：升级后已移除 part 的 override 会被静默丢弃，但客户端凭空捏造的 unknown part 会 `unknownPromptPart` 拒绝。校验「never silently truncates text」——超长是拒绝而非截断。

### 2.6 优先级表（`docs/004`）

从强到弱：① 工具与宿主强制的事实；② 内置与生成段；③ 匹配的规则（仅该 Executor）；④ 团队段与技能；⑤ 外部文本（消息 / 评论 / 文档 / 引用，只是数据）。`src/app/sessions.ts` 的 `workOnly` 工具白名单与 `noWait` 守卫就是第 ① 层的证据。

## 3. 实验 A · 8 段装配器

```js
const TEAM_SECTIONS = ['communication', 'scope', 'delivery'];
function assemble(role) {
  const parts = [
    'runtime/shared', `runtime/${role}`,
    ...TEAM_SECTIONS.map(t => `team/${t}`),
    'runtime/subscriptions', 'runtime/replies',
    `runtime/${role === 'orchestrator' ? 'dispatch' : 'work'}`
  ];
  if (role === 'orchestrator') parts.push('runtime/admission');
  parts.push(`runtime/handoff/${role}`, 'runtime/environment');
  if (role === 'orchestrator') parts.push('runtime/policy');
  return parts;
}
function validateOverride(text, placeholders) {
  const missing = placeholders.filter(p => !text.includes(p));
  if (missing.length) throw new Error('promptPlaceholders: ' + missing.join(', '));
  return true;
}
console.log('orchestrator:', assemble('orchestrator'));
console.log('worker:', assemble('worker'));
console.log('worker has policy?', assemble('worker').includes('runtime/policy')); // false
validateOverride('v={version} mode={mode} rules={rules}', ['{version}', '{mode}', '{rules}']);
```

**断言**：worker 不含 `runtime/admission` 与 `runtime/policy`，且以 `runtime/environment` 结尾；orchestrator 以 `runtime/policy` 结尾。删掉一个占位符会抛错。

## 4. 实验 B · revision + base 模拟器

```js
let builtIn = 'default-v0';
let current = { revision: 0, builtIn };
let bound = 0;
const overrides = new Map();

function save(config, baseRevision) {
  if (baseRevision !== current.revision) throw new Error('PromptConflict → 409');
  current = { revision: current.revision + 1, builtIn };
  return { effect: 'next-request', revision: current.revision };
}
function modelRequest() {                       // systemPrompt.section 回调
  bound = current.revision;
  return `[dsh-superagent prompt revision ${bound}]`;
}
function setOverride(part, text, base) {
  if (text === builtIn) { overrides.delete(part); return 'removed: 与默认相同 = 删除 override'; }
  overrides.set(part, { text, base: base ?? overrides.get(part)?.base ?? builtIn });
  return 'saved';
}
console.log(save({ text: 'team' }, 0), 'bound=' + bound);   // 已存但尚未生效
console.log(modelRequest(), 'bound=' + bound);              // 下次请求才绑定
console.log(setOverride('scope', 'our scope'));
console.log('升级前 base =', overrides.get('scope').base);
builtIn = 'default-v1';                                     // 升级改了内置文本
console.log('Default updated?', overrides.get('scope').base !== builtIn); // true
console.log('Keep my text →', setOverride('scope', 'our scope', builtIn)); // rebase base
console.log('Use new default →', setOverride('scope', builtIn));            // 删除 override
```

**断言**：保存后 `bound` 不变；`modelRequest()` 才追上；升级后 `base !== builtIn` 触发 Default updated；改回与默认相同会删除 override（之后自动跟随未来默认）。

## 5. 自检清单

- [ ] 能写出两种角色的装配差异。
- [ ] 能指出版本注入的回调位置与 `order` 值。
- [ ] 能说出优先级表的 5 层及最强 / 最弱项。
- [ ] 能解释 `base` 省略、与默认相同、unknown part 三种情况的不同结果。
- [ ] 能解释为什么升级只让「被 override 的段」需要人工处理。

## 6. 回到动态演示

| 步骤 | 对应源码 |
|---|---|
| 1–2 保存与同源 | `src/app/http.ts:208-211,75-79` |
| 3–4 校验与冲突 | `src/app/prompts.ts:164-181,202-215` |
| 5 版本快照 | `src/app/versions.ts:21-28` |
| 6–8 next-request | `docs/004:95`、`src/app/sessions.ts:244-249,329-339` |
| 9 内置文本 | `src/app/skill-files.ts:29-32` |
| 10–13 装配与优先级 | `src/app/prompts.ts:102-119`、`docs/004:59,65-71` |
| 16–17 升级 rebase | `src/app/prompts.ts:186-194`、`src/client/prompts.tsx:161-171` |
