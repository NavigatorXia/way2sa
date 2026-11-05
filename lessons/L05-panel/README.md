# L05 · 面板与人的交互

> 对应原型原文：`dsh-superagent-prototype/docs/005-panel.md`
> 先修：L02（Policy / gate 由代码强制）、L04（提示词保存后的 `next-request` 通知）。

## 这课学什么

面板的设计目标不是「把所有状态都显示出来」，而是 **尽可能少占用人的注意力**。学完要能回答：一次「打开面板 → 改设置 → 保存 → 回刷」经过哪些模块，以及为什么所有写命令都必须带 `revision`。

三个关键词：只读视图、`400/404/409/500`、`await reload()`。

## 三个问题

1. 从 `GET state` 读视图，到 `PUT settings/:block` 写命令，再到 `reload()` 回刷，中间经过哪些模块？
2. `400 / 404 / 409 / 500` 分别由哪些错误类型映射而来？空 `404` 为什么不能当成「记录不存在」？
3. 面板为什么刻意「少显示」：计数、健康态、一次性网络错误各有什么规矩？

## 课程材料

| 文件 | 用途 |
|---|---|
| `README.md` | 本文件 |
| `TUTORIAL.md` | 精读 `app/http.ts` / `api.ts` / `views/records.ts` + `client/api.ts` / `draft.tsx` / `provider.tsx` + 2 个实验 |
| `index.html` + `data.js` | 14 个模块、19 步流转、写命令状态机、7 个真实代码锚点 |

## 学习路径

1. 读 `docs/005` 的「A count equals the length of the list it links to」「健康态不占空间」「只在人必须行动时说话」三条原则。
2. 对照 `src/app/api.ts` 的 `Api` 契约，把路由分成「读视图」与「写命令」两组。
3. 播放动态演示：第 1–9 步是读视图闭环，第 10–15 步是写命令闭环，第 16–19 步是回刷、409 rebase 与 400/404 refused 分支。
4. 跑两个实验：单机面板闭环模拟器、诚实状态与计数一致性断言。

## 动态演示怎么看

- 第 4 步 `api → http` 是唯一的准入关口：`host` 必须严格等于 `127.0.0.1:<port>` 或 `localhost:<port>`，还要带 `x-orchestrator-request: 1`；外站 `Origin` 直接 403。
- 第 6 步 `routes → views` 强调视图是**只读投影**：`snapshot()` 一次请求内相关记录只读一次，`page()` 返回 `next_offset`，不改写任何领域状态。
- 第 8 步的「诚实状态」不是 UI 美化，而是可断言的约束：Overview 的数字必须等于它链接到的列表长度，一次性网络错误不进 `problems`。
- 第 13 步 `Settings.save` 先查 `stale()`（冲突 → `SettingsConflict` → 409），再做 origin guard；面板 API 不靠登录态，但保存权限比主 Session 工具更大。
- 第 16 步是闭环的关键：`useAction` 无论成功失败都 `await reload()`；第 18 步的 409 走 `merge3` 保留草稿，绝不丢人的编辑；第 19 步补上 400/404 的 `refused` 分支，草稿同样保留。

## 验收标准

- [ ] 能画出 `GET state → stateView → OverviewView → json(200)` 与 `PUT settings/:block → Settings.save → notice → reload()` 两条链。
- [ ] 能说出 `sameOrigin()` 的三项判据，并解释为什么 CLI `status` 也要带同源头。
- [ ] 能把 `ZodError / SetupError / UserError.missing / SettingsConflict / PromptConflict / 其它` 映射到 `400/404/409/500`。
- [ ] 能解释为什么空 404 是「重启中路由未挂载」而不是「记录不存在」。
- [ ] 能复述 `usePoll` 的 5000ms / 隐藏页 ×6 / restart 降为 1000ms，以及 `SaveBar` 的 `dirty || busy || error`。

## 与前课的关系

承接 L02 的 Policy 视图、L03 的 `load / health` 状态、L04 的 `promptsNotice`。新增 type-only 契约、loopback 同源守卫、错误映射、只读视图投影、`useDraft` 乐观并发与三方 rebase。

## 易错点速查

| 误解 | 正确理解 |
|---|---|
| 面板 API 有登录态 | 靠 loopback + 头 + Origin 白名单；且 API 保存可改执行环境与账户字段，比主 Session 工具权限更大 |
| 视图可以直接改领域状态 | `views/*` 只读投影，写必须走 `PUT/POST` 命令并带 `revision` |
| 空 404 = 记录不存在 | 可能是重启时路由尚未挂载，客户端标为 `unreachable` |
| 409 就丢弃草稿重填 | `reload()` + `merge3(mine, base, saved)`，保留人的编辑 |
| 网络抖一下就报问题 | 一次性错误不算 `problems`；计数必须严格等于列表长度 |
| 保存后手动刷新页面即可 | `useAction` 强制 `await reload()`，`restarting` 时改走 `restart()` 触发 1s 轮询 |

## 源码坐标

```
docs/005-panel.md                 显示原则 / Overview / 破坏性操作确认
src/app/api.ts                    Api（type-only 契约）、TICKET_FILTERS
src/app/http.ts                   sameOrigin / registerHttp / failure / stateView / routes
src/app/views/records.ts          ViewHost / snapshot / page
src/app/views/overview.ts         OverviewView（problems / person / flow / policyVersion）
src/app/settings.ts               Settings.save（stale() / origin guard / restarting）
src/app/notices.ts                settingsNotice / promptsNotice / context_delivery
src/client/api.ts                 api() / caller() / usePoll / ApiError
src/client/provider.tsx           useAction / PanelProvider（restarts）
src/client/draft.tsx              useDraft / draftReducer / merge3 / SaveBar
src/client/route.ts               TABS / SETTINGS_GROUPS
```

## 下一步

L06 转向宿主：一份 `cordis.patch.yml` 如何变成两个 agent preset、一个 Setup 与一个 tmux 进程 —— 这是「底座与 DSH 的接缝」第一次完整显形。
