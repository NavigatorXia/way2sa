# L02 代码教程 · 授权与主动性

片段逐字抄自 `dsh-superagent-prototype`。实验代码是纯 JS，可直接在浏览器控制台运行。

## 1. 源码地图

| 路径 | 符号 | 看什么 |
|---|---|---|
| `src/sources/registry.ts` | `SourceRegistry.scope` / `resolve` | gate 之前的第 0 道闸；`listened` 的四种失效方式 |
| `src/sources/feishu.ts` | `feishuKind.scope` | 白名单式接收：`chat_not_allowed` / `direct_messages_not_allowed` |
| `src/sources/github.ts` | `githubKind.scope` / `scopeOf` / `OBSERVED` | 恒 `listened: true`，只分级 `observed` |
| `src/policy.ts` | `settingsPolicy.gate` / `machineGate` / `assessmentOutcome` / `policyVersion` | 准入优先级、研判校验、版本哈希 |
| `src/admission.ts` | `ADMISSION_DEFAULTS` | 三格默认值 |
| `src/core/ports.ts` | `ScopeResult` / `SourceScope` / `GateResult` / `Policy.revalidate` | 端口签名 |
| `src/core/model.ts` | `MandateBasis` / `Strength` / `AcceptMode` | 授权依据与强度枚举 |
| `src/core/evals.ts` | `decide` / `accept` | 越权接单拦截、Mandate 组装 |
| `tests/policy.spec.ts` | 各组合断言 | 可直接当规格书读 |

## 2. 逐段精读

### 2.0 Source scope —— gate 之前的第 0 道闸

`docs/002-authorization.md:119` 把这条边界写得很硬，别把它和 Policy 混起来：

```
Source configuration is separate from Policy. It controls what enters the system: which chats are read and whether a scope receives all messages or only mentions.
```

内核只声明一个端口（`src/core/ports.ts:10-13`），返回值三个字段就是 scope 的全部语义：

```ts
export type ScopeResult = { listened: true; observed: boolean; row?: string } | { listened: false; reason: string }
/** Source configuration as the domain sees it: listening scope per trigger or per recorded Mandate basis. */
export interface SourceScope {
  scope(input: { source: string; meta: Record<string, unknown> }): ScopeResult
}
```

- `listened` —— 这条消息收不收；不收就带 `reason`。
- `observed` —— 收不收**没 @ 智能体**的消息，也就是「全收」开关。
- `row` —— 用准入表的**哪一行**判它；下一节那张表的行就是这么来的。

实现者是 `SourceRegistry`（`src/sources/registry.ts:124-131`，类声明 `implements SourceScope`）。它自己几乎不判断，四步之后把活儿交给 kind：

```ts
    if (!kind) return stored ? { listened: false, reason: 'source_not_installed' } : { listened: true, observed: false }
    const instance = this.resolve(kind, stored)
    if (!instance.enabled) return { listened: false, reason: 'source_disabled' }
    return kind.scope ? kind.scope({ meta: input.meta }, instance.config) : { listened: true, observed: false }
```

三个细节：① 插件缺失**分两种** —— 存过配置说明装过又卸了才拒（`source_not_installed`），冷启动没配置过时直接放行，不误杀第一批；② `resolve()`（`:134`）里 `enabled: parsed.success && (stored?.enabled ?? true)`，**存储配置解析失败等于禁用**，fail-closed；③ 没有 `scope` 的 kind 默认「全收但不观察」（`src/sources/kind.ts:97` 注释）。

它在 intake 里落地（`src/core/intake.ts:25-28`），注意顺序在去重之后：

```ts
    const filter = this.options.scope.scope(trigger)
    if (!filter.listened) {
      this.repo.triggers.save(trigger); this.repo.triggers.saveDisposition(trigger.id, { filtered: { code: filter.reason }, fanout: [], at })
      return 'filtered'
    }
```

**「不收」不等于「丢弃」**：Trigger 照样落库，只多一条 `{ filtered: { code }, fanout: [] }` 的 disposition —— 可审计、仍可当 Thread 上下文读，但不扇出、不进 Eval。

### 2.0.1 两个 kind 的相反默认（本课最容易答错的地方）

飞书是**白名单**（`src/sources/feishu.ts:54-58`）：

```ts
    if (meta.direct === true) return config.directMessages ? { listened: true, observed: false, row: 'direct' } : { listened: false, reason: 'direct_messages_not_allowed' }
    const chat = config.chats.find(item => item.chatId === meta.chatId)
    if (chat) return { listened: true, observed: chat.listen === 'all', row: chat.chatId }
    return config.otherChats === 'mentions' ? { listened: true, observed: false, row: 'other' } : { listened: false, reason: 'chat_not_allowed' }
```

GitHub 是**全收 + 分级 observed**（`src/sources/github.ts:59-61`，注释 `:59`："What the Source observes across the repository it receives in full; elsewhere, only what addresses the agent."）：

```ts
  scope: ({ meta }, config) => {
    const row = scopeOf(meta)
    return { listened: true, observed: row !== undefined && config[OBSERVED[row]], ...row ? { row } : {} }
  },
```

于是两个「没有对应配置」的结局完全不同，别混：

| 情形 | 结果 | 落点 |
|---|---|---|
| 飞书群不在 `config.chats`、`otherChats: none` | `listened: false` / `chat_not_allowed` | intake 里 `filtered`，根本不进 gate |
| GitHub 的 meta 映射不出行（`scopeOf` 返回 `undefined`，如 `github.ts:33` 那种没有 `meta.branch` 的 CI） | `listened: true`、`observed: false`、**无 `row`** | 进 gate，`admissionOf`（`policy.ts:138-139`）因 `row === undefined` 退回 `ADMISSION_DEFAULTS` |

**GitHub 的「没有行」= 按默认三格，不是「不接收」。** 而且 `listened` 一旦为假，人和机器的失效点也不同：机器的 `machineGate`（`policy.ts:175`）要求 `listened && (addressed || observed)`，人的那一支（`:200`）只在**未点名**消息上用 `observed` 决定是否查表 —— 点名消息即使 `listened: false` 也照样能查出 `explicit`。这只是纵深防御：新消息早在 intake 就被 `filtered` 了，gate 里还会再看到「不听」的情况是 resume 前的 revalidate（`policy.ts:217` 拿 Mandate basis 里记的 `scope` 重算）。**执行「不听」的那道闸在 intake，不在 gate。**

顺带两个 `reason` 撞车的坑：`policy.ts:173`（actor 不在 bot list）和 `:175`（scope 不听 / 没点名又不全收）**都返回 `not_human`**，排障时看不出区别。所以「群里 bot 的消息报 not_human」有两解，先用 scope 的 reason 排除前者。

最后，scope 还管**出**：`registry.channelAllowed`（`:75-79`）→ `feishuKind.channel.allowed`（`feishu.ts:60-62`）直接复用 `scope()`，注释写着 "A reply goes only to a chat the Source still receives"。把群从白名单撤掉，老工单的回信也发不出去。

### 2.1 强度表 —— 授权来源等级，不是消息重要性

`docs/002-authorization.md`：

```
| explicit | A person on the list addresses the agent, or follows up on a Thread that already has a Ticket |
| inferred | A person not on the list follows up on a Thread with a Ticket ... |
| not admitted | Any other bot's message, everything the admission table ignores, and every inferred case while the accept mode is `off` |
```

关键在下一句：`For an unlisted person, an explicit admission cell takes precedence even on a Thread with Tickets and works in every accept mode.` 也就是说**显式 cell 优先于 follow-up 推断**，这是实验 A 的核心断言。

### 2.2 admission table —— 主动性边界

```
| On the list, not addressing the agent | inferred, ignore | inferred |
| Not on the list, addressing the agent | explicit, inferred, ignore | ignore |
| Not on the list, not addressing the agent | inferred, ignore | ignore |
```

- 行 = 接收范围（Feishu 各群 / 私信；GitHub new Issue / PR / comment / 默认分支 CI）。
- 后两格只在 Source 收全部消息时可用，也就是 scope 的 `observed`：飞书取 `chat.listen === 'all'`（`feishu.ts:57`），GitHub 取 `OBSERVED[row]` 那四个开关 `observeIssues` / `observePulls` / `observeComments` / `observeCi`（`github.ts:30`，`gate` 里的判据是 `receivable`，`policy.ts:200`）。CI 没有 sender，只提供最后一格。
- `src/admission.ts:ADMISSION_DEFAULTS` 给出 `listedUnaddressed:'inferred', unlistedAddressed:'ignore', unlistedUnaddressed:'ignore'`。
- `settingsPolicy.gate` 的顺序：**先 `listened(sources, ...)` 拿 scope**（人的这支在 `:194`，机器的 `machineGate` 在 `:174`），行的来源就是 `scope.row`，且 `:195` 写成 `scope.listened ? scope.row : undefined`；bot 先走 `machineGate`（只放行 listed bot 与无 sender 的 CI，且必须 `listened && (addressed || observed)`）；然后 `allowed && addressed` → `via:'addressed'` explicit；**再判断 admission cell 的 explicit 优先**；最后才是 follow-up 的 `participating` 分支。

### 2.3 `Evals.decide` — 代码层挡住越权接单

`src/core/evals.ts`：

```ts
    if (outcome.kind === 'accept' && evaluation.strength !== 'explicit' && !this.policy().admitsInferred(outcome.rules ?? [])) {
      throw new UserError('notExplicit')
    }
```

`Direct accept refuses a Trigger that the gate did not admit as explicit.` 模型输出、提示词、外部文本都无法绕过这一行。对应 `docs/002` 的 `Accepting an inferred candidate always requires an assessment.`

### 2.4 accept mode —— 默认 observe 是安全档

```
| `off` | Nothing inferred becomes a candidate |
| `observe` (default) | a positive assessment is recorded as ignore marked "would accept", and nothing is accepted |
| `auto` | A positive assessment of an inferred candidate accepts it |
Explicit requests work in every mode.
```

`assessmentOutcome` 在代码里做三件事：每条 enabled rule 恰好评一次、`directionAllowed` 与 `intent_evidence` 必填、inferred 且非 auto 时返回 `{kind:'ignore', reason:{code:'observed'}, audit:{would_accept:true}}`。这让团队可以先看记录再切 auto。

### 2.5 Mandate 与 revalidate —— 三个操作，五类复查

`docs/002-authorization.md`：

```
Only three operations change a Mandate: accept creates it, a person's stop withdraws it, and failed revalidation revokes it.
- An explicit follow-up Mandate passes.
- An inferred Mandate needs `auto` mode and its matched rules still enabled.
A person saying "stop" in a Thread is an ordinary Trigger, and Eval decides stop.
```

其余三类 basis 的额外条件：`admission` 要求今天的表与成员身份仍给至少原强度；`bot` 要求 bot 仍在 bot list；`listed` 等其它要求 sender 仍在 allowed list。共同前提是 Source 仍监听原 Thread。

失败时的语义很硬：`The main Session is not told it reached a worker.` 票保持 ended、丢弃等待消息、消息按「未达任何 Ticket」回 Eval。

### 2.6 handback 与释放 follow-ups

`docs/002` 规定：Executor 只在「越界或属于另一张票」时 handback 一次；消息只有在**没有任何 Ticket 认领**后才进入新 Eval，且候选里带各 Executor 的理由。Ticket 结束时，未被读取 / 确认 / 回答 / handback 的消息会被释放回 Eval。这一段解释了动态演示第 13–14 步为什么不能跳过。

## 3. 实验 A · 准入表复刻

```js
const DEFAULTS = { listedUnaddressed: 'inferred', unlistedAddressed: 'ignore', unlistedUnaddressed: 'ignore' };
function cellValue(addressed, allowed, cell) {
  const key = allowed ? 'listedUnaddressed' : (addressed ? 'unlistedAddressed' : 'unlistedUnaddressed');
  return cell[key] || 'ignore';
}
function gate({ human, addressed, allowed, participating, mode = 'observe', cell = DEFAULTS, contextOnly = false }) {
  if (!human) return { strength: 'not admitted', reason: 'not_human' };
  if (!contextOnly && cell.unlistedAddressed === 'explicit' && !allowed && addressed)
    return { strength: 'explicit', basis: 'admission' };          // 显式 cell 优先于 follow-up
  if (!contextOnly && allowed && addressed) return { strength: 'explicit', basis: 'addressed' };
  if (!contextOnly && participating) return { strength: allowed ? 'explicit' : 'inferred', basis: 'followup' };
  const v = cellValue(addressed, allowed, cell);
  if (v === 'ignore') return { strength: 'not admitted', reason: 'admission_ignored' };
  if (v === 'inferred' && mode === 'off') return { strength: 'not admitted', reason: 'mode_off' };
  return { strength: v, basis: 'admission' };
}
console.log(gate({ human: true, addressed: true,  allowed: false, participating: true, mode: 'off',
                   cell: { ...DEFAULTS, unlistedAddressed: 'explicit' } })); // explicit（off 也挡不住）
console.log(gate({ human: true, addressed: false, allowed: true,  participating: false, mode: 'off' })); // not admitted
console.log(gate({ human: false, addressed: true, allowed: false, participating: false }));             // not_human
console.log(gate({ human: true, addressed: true,  allowed: false, participating: true, contextOnly: true })); // 走表 → ignore
```

**对照**：`tests/policy.spec.ts:53-88,109-151`；`src/policy.ts:settingsPolicy.gate`。

## 4. 实验 B · Mandate 三操作与 revalidate

```js
const LEGAL = new Set(['accept', 'humanStop', 'failedRevalidate']);
let mandate = null;
function apply(op, basis = 'addressed') {
  if (!LEGAL.has(op)) throw new Error('illegal operation: ' + op);
  if (op === 'accept') mandate = { state: 'granted', basis, policyVersion: 1 };
  if (op === 'humanStop') mandate = { ...mandate, state: 'withdrawn' };
  if (op === 'failedRevalidate') mandate = { ...mandate, state: 'revoked' };
  return mandate;
}
function revalidate(m, policy) {
  if (m.state !== 'granted' && m.state !== 'held') return false;
  if (m.basis === 'addressed' || m.basis === 'followup') return true;
  if (m.basis === 'inferred') return policy.mode === 'auto' && policy.rulesEnabled;
  if (m.basis === 'admission') return policy.strengthAtLeastOriginal && policy.senderStillListed;
  if (m.basis === 'bot') return policy.botStillListed && policy.mode === 'auto' && policy.rulesEnabled;
  return policy.senderStillAllowed;
}
console.log(apply('accept', 'inferred'));
console.log('auto + rules:', revalidate(mandate, { mode: 'auto', rulesEnabled: true }));
console.log('observe:', revalidate(mandate, { mode: 'observe', rulesEnabled: true }));
console.log(apply('humanStop'));  // withdrawn：之后必须重新 accept
```

**预期**：`inferred` 在 `observe` 下 false、在 `auto + rules` 下 true；`withdrawn` 状态不能再被 revalidate 救回。对照 `docs/002:129-141` 与 `tests/core-engine.spec.ts` 的 resume / revalidate 断言。

## 5. 自检清单

- [ ] 能写出 gate 的优先级顺序，并解释显式 cell 为什么插在 follow-up 之前。
- [ ] 能说出 `ScopeResult` 的三个字段各自被谁消费（`listened` → intake 的 `filtered` 与 resume 前的 revalidate；`observed` → gate 的 `receivable`；`row` → 准入表的行），并举出 GitHub 与飞书在 `listened` 上的相反默认。
- [ ] 能说出 `assessmentOutcome` 的三条校验。
- [ ] 能列出改变 Mandate 的三个操作。
- [ ] 能解释 Policy version 变化为什么丢弃运行中的 Eval 却不立即撤销 live Ticket。
- [ ] 能说清 handback 之后消息重新进 Eval 的条件。

## 6. 回到动态演示

| 步骤 | 对应源码 / 文档 |
|---|---|
| 1 之前 · `listened` 过滤（图上没画的那道闸） | `src/core/intake.ts:25`、`src/sources/registry.ts:124`、`src/sources/feishu.ts:54` / `github.ts:59` |
| 4–6 admission / mode / gate | `src/policy.ts`、`src/admission.ts`、`docs/002:56-101` |
| 7 GateResult | `src/core/ports.ts` |
| 8–9 assessment / route | `src/policy.ts:assessmentOutcome`、`prompts/dispatch.md` |
| 10 accept → Mandate | `src/core/evals.ts:accept` |
| 12 订阅绕过 gate | `docs/002:20` |
| 13–14 owner / handback | `src/core/model.ts:followupOwners`、`docs/002:28-34` |
| 15 stop | `docs/002:129,143-144` |
| 16–17 revalidate | `src/core/ports.ts:Policy.revalidate`、`docs/002:131-141` |
