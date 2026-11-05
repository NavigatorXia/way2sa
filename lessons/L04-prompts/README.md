# L04 · 提示词

> 对应原型原文：`dsh-superagent-prototype/docs/004-prompts.md`
> 先修：L02（权限由代码强制）、L03（执行环境与 Session 装饰）。

## 这课学什么

提示词在这套系统里不是一堆字符串，而是**版本化配置 + 固定顺序装配 + 每次模型请求注入**的一条流水线。学完要能回答：为什么改提示词文本永远改不了 gate、Mandate、工具检查与账户包装。

三个关键词：8 段装配顺序、`effect:'next-request'`、Default updated。

## 三个问题

1. 为什么 `runtime/policy` 必须放最后，orchestrator 与 worker 的段集合为什么不同？
2. 保存一个版本后，运行中的 Session 何时、如何看到新版本？
3. 团队 override 与升级后的 Default updated 怎么处理？

## 课程材料

| 文件 | 用途 |
|---|---|
| `README.md` | 本文件 |
| `TUTORIAL.md` | 精读 `app/prompts.ts` / `versions.ts` / `sessions.ts` / `skill-files.ts` + 2 个实验 |
| `index.html` + `data.js` | 14 个模块、17 步流转、版本生效状态机、8 个真实代码锚点 |

## 学习路径

1. 读 `docs/004` 的装配顺序、优先级表、版本与升级三段。
2. 对照 `prompts/orchestrator.md`、`dispatch.md`、`work.md`、`worker.md`、`shared.md` 看内置文本长什么样（每句一行是有原因的）。
3. 播放动态演示：第 1–5 步是保存，第 6–8 步是 next-request 注入，第 9–13 步是装配与优先级，第 16–17 步是升级与 rebase。
4. 跑两个实验：8 段装配器、revision + base 模拟器。

## 动态演示怎么看

- 第 6 步 `panel → session` 只发 notice，**不重启、不取消、不唤醒**。
- 第 7 步是版本生效的唯一时点：`systemPrompt.section` 在下次模型请求回调时重读。
- 第 13 步特意说明 `runtime/policy` 放最后不是因为权限最高，而是让 Policy 变化不改动前面的 prompt 文本。
- 状态机把「客户端草稿 phase」与「服务端版本生效」放在一起，注意 `pending → bound` 的分界。

## 验收标准

- [ ] 能按顺序列出 orchestrator 的 8 段装配，并指出 worker 少了哪三段。
- [ ] 能解释 `[dsh-superagent prompt revision N]` 出现在哪里、由谁注入。
- [ ] 能说出 `effect:'next-request'` 与 `KV.sessions.prompts` 的关系。
- [ ] 能复述优先级表的 5 层，并指出最强与最弱分别是谁。
- [ ] 能解释「把 override 改回默认 = 删除 override」与「省略 base = 保留 base」。

## 与前课的关系

承接 L02 的 Policy / gate、L03 的 Executor 环境与 Session 装饰。新增版本快照、装配器、团队段、override、内置 parts、代码强制事实。

## 易错点速查

| 误解 | 正确理解 |
|---|---|
| 保存即生效 / 必须重启 | `Saving does not restart, cancel or wake a Session`；下次请求（含同一 turn 后续 step）生效 |
| 改提示词能改权限 | gate / Mandates / 工具检查 / 账户包装由代码强制；外部文本只是数据 |
| 省掉 `base` 就是清空 | 保留已保存的 `base` |
| 与默认相同是「保留自定义」 | 等于删除 override，反而重新跟随未来默认 |
| Policy 段最后 = 优先级最高 | 是稳定性考虑；它属于第 2 层「内置与生成段」 |

## 源码坐标

```
docs/004-prompts.md              装配顺序 / 优先级 / 版本 / 升级
src/app/prompts.ts               TEAM_SECTIONS / PART_KEYS / promptParts / policySection / savePrompts
src/app/versions.ts              Versions.save（不可变快照 + 指针）
src/app/sessions.ts              decorate / systemPrompt.section / promptFor
src/app/skill-files.ts           promptFile（把 md 合成段落）
src/policy.ts                    policyVersion
tests/prompts.spec.ts            装配顺序与 override 规则断言
```

## 下一步

L05 转向人这一侧：面板如何把只读视图、写命令与回刷组织成「尽量少占用注意力」的交互。
