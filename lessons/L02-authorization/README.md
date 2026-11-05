# L02 · 授权与主动性

> 对应原型原文：`dsh-superagent-prototype/docs/002-authorization.md`
> 先修：L01（领域词汇与两条路径）。

## 这课学什么

L01 建好了词汇，L02 回答「谁可以让工作开始，这份工作能包含什么」。核心一句话：**宿主强制允许名单、规则与 Mandate；消息、评论、引用文档都只是判断的输入，不能改变权限**。

这课把三件事拧成一条链：`gate`（确定性准入）→ `assessment`（模型研判 + accept mode）→ `Mandate`（不可变授权），并补上结束后的 `revalidate`。

## 三个问题

1. `explicit` / `inferred` / `not admitted` 分别由哪条规则判定？
2. `observe` 与 `auto` 差在哪，为什么 inferred 的 accept 一定要 assessment？
3. 只有哪三个操作能改变 Mandate？resume 前 revalidate 检查什么？

## 课程材料

| 文件 | 用途 |
|---|---|
| `README.md` | 本文件 |
| `TUTORIAL.md` | 精读 `sources/registry.ts` 的 scope / `src/policy.ts` / `admission.ts` / `core/evals.ts` + 2 个可运行实验 |
| `index.html` + `data.js` | 15 个模块、17 步流转、Mandate 生命周期状态机、6 个真实代码锚点 |

## 学习路径

1. 读 `docs/002` 的 **Two paths for a Trigger** 与 **Strength**，再读 Admission、Accept mode、Resume and stop；别跳过 `:119` 那句 `Source configuration is separate from Policy` —— scope 是 gate 之前的第 0 道闸，见 `TUTORIAL.md` 2.0。
2. 播放动态演示：第 1–6 步是 gate 的输入与 admission table；第 7–10 步是 Eval → assessment → accept；第 15–17 步是 stop 与 revalidate。
3. 精读 `TUTORIAL.md`，尤其 `settingsPolicy.gate` 的优先级顺序。
4. 跑两个实验：准入表复刻、Mandate 三操作与 revalidate。

## 动态演示怎么看

- 第 12 步 `Subscription → Ticket` 标了「绕过 gate，不给权」—— 和 L01 第 4 步是同一条规则，这里从授权角度再看一次。
- 第 6 步 `Policy → Gate` 是 `config` 类型：accept mode 是配置，不是消息。
- 第 17 步 `Revalidate → Eval` 说明失败后消息被视为「未达任何 Ticket」，重新走 Eval。
- 状态机只有 5 个节点：`absent → granted → held`，出口只有 `withdrawn` 与 `revoked`。

## 验收标准

- [ ] 画出 admission table 的三行三格，并说明哪些格只在「收全部消息」的范围可用。
- [ ] 说出飞书与 GitHub 在 `listened` 上的相反默认，以及 GitHub 映射不出行时这条消息落到哪三格。
- [ ] 解释为什么 `off` 挡不住显式请求。
- [ ] 说出 `MandateBasis.via` 的五种取值，以及每种在 revalidate 时的额外条件。
- [ ] 解释「人在 Thread 说 stop」与「面板 Stop」的区别。
- [ ] 说明 Policy version 变化时正在运行的 Eval 与 live Ticket 分别会怎样。

## 与前课的关系

承接 L01 的 `Eval`、`Mandate`、`Ticket`、`Subscription`（图中淡色块）。本课新增 gate / admission table / Policy / assessment / Router / revalidate / handback / 面板 stop。

## 易错点速查

| 误解 | 正确理解 |
|---|---|
| `off` 什么都不接 | `Explicit requests work in every mode`；off 只挡 inferred |
| scope 属于 Policy | `Source configuration is separate from Policy`（`docs/002:119`）；`listened` 在 intake 就把消息 `filtered` 掉了，Policy 只拿到剩下的 |
| GitHub 没配的行 = 不接收 | GitHub 的 `listened` 恒为 `true`（`github.ts:61`）；映射不出 `row` 只是退回 `ADMISSION_DEFAULTS`，真正白名单拒收的是飞书（`chat_not_allowed`） |
| `not_human` 就是「不是人发的」 | `policy.ts:173`（actor 不在 bot list）与 `:175`（scope 不听，或未点名且该范围不全收）共用同一个 reason |
| 被 scope 挡掉 = 丢弃 | 仍 `save(trigger)` 并存 `{ filtered: { code }, fanout: [] }` 的 disposition —— 不进 Eval，但可审计、可当上下文 |
| 订阅绕过 gate = 获得权限 | `bypasses the gate and grants no new authority` |
| 人在 Thread 说 stop 就停 | 那只是普通 Trigger，由 Eval 决定；面板 Stop 才是命令 |
| Policy 改了立即撤销 Mandate | 只丢弃运行中的 Eval、给受影响票发 `policy-changed` Input；撤销发生在 resume 前的 revalidate |

## 源码坐标

```
docs/002-authorization.md          Strength / Admission / Accept mode / Resume and stop（:119 是 scope 与 Policy 的分界）
src/core/ports.ts                  ScopeResult / SourceScope / GateResult / Policy.revalidate
src/sources/registry.ts            scope（:124-131）/ resolve（:134，配置坏掉即视为禁用）/ channelAllowed（:75）
src/sources/feishu.ts              feishuKind.scope（白名单）/ channel.allowed（复用 scope）
src/sources/github.ts              githubKind.scope（恒 listened）/ scopeOf / OBSERVED 四个全收开关
src/core/intake.ts                 :25-28 listened 为假即 filtered（仍落库）
src/policy.ts                      settingsPolicy.gate / machineGate / admissionOf / assessmentOutcome / policyVersion
src/admission.ts                   ADMISSION_DEFAULTS
src/core/model.ts                  MandateBasis / Strength / AcceptMode
src/core/evals.ts                  decide / accept（notExplicit 守卫）
tests/policy.spec.ts               off / observe / auto 与显式 cell 的组合断言
```

## 下一步

L03 把这张被接下的票送进执行：stage 派生、worker slot、事务内入队、Effects 退避与 Outbox 幂等。
