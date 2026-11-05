# L06 · 部署与宿主装配

> 对应原型原文：`dsh-superagent-prototype/docs/006-deployment.md`
> 先修：L05（同源管理 API 与 `GET state`）、L04（Session 装饰与 `noWait`）。

## 这课学什么

这一课把「研究原型」变成「能长期跑的服务」，也是**第一次看清底座与 DSH 宿主的接缝**。学完要能回答：一份 `cordis.patch.yml` 如何一路变成一个 tmux 进程，以及 `status` 的退出码为什么是给监控脚本的契约。

三个关键词：bundle patch、两个 preset、`0/1/2/3`。

## 三个问题

1. profile 的 `cordis.patch.yml` 和 bundle 的 `cordis.patch.yml` 各负责什么？
2. 两个 preset 的 5 秒后台化解决的是什么问题，为什么不能手选或禁用？
3. `status` 的 0 / 1 / 2 / 3 分别代表什么，`stop` 与 `restart` 对停止标记有何不同？

## 课程材料

| 文件 | 用途 |
|---|---|
| `README.md` | 本文件 |
| `TUTORIAL.md` | 精读 `package.json` / `cordis.patch.yml` / `deployment.ts` / `environment.ts` / `runtime.ts` / `sessions.ts` / `scripts/dsh-superagent` + 2 个实验 |
| `index.html` + `data.js` | 15 个模块、20 步流转、服务生命周期状态机、8 个真实代码锚点 |

## 学习路径

1. 读 `docs/006` 的安装、setup、健康检查与升级四段，特别注意「升级不能重跑 profile 创建命令」。
2. 把 `package.json:dsh.bundle.patch` → 根目录 `cordis.patch.yml` → `examples/profile.cordis.patch.yml` 三份文件摆在一起看职责分工。
3. 播放动态演示：第 1–4 步是配置装配，第 5–13 步是 Runtime / Setup / Session 装配，第 14–20 步是进程、退出码分支与停止标记。
4. 跑两个实验：patch → preset → Session 装配可视化，退出码 0/1/2/3 模拟器。

## 动态演示怎么看

- 第 3 步的 5 行 `insert` 是整套装配的词汇表：3 个插件行（Feishu 默认 `disabled: true`）+ 2 个 agent preset 行。bundle 只插行**不带配置**，`stateDir` 由 profile patch 提供。
- 第 4 步的 `timeoutMs: 5000` / `waitTimeoutMs: 5000` 是 L03「worker 下一步就能收新消息」的宿主层保障；`subagent` 用 `standard`（60s）是另一套权衡。
- 第 5 步 `machineOf` 对未知配置键**直接拒绝启动**，并用 `MOVED` 表提示旧键搬到哪去了；三个限额是 `.volatile()`，改后无需重启。
- 第 6 步 `registerHttp` 排在 `setup.run` **之前** —— 这样 setup 出问题时运维仍能进 UI 修配置，这是 L05 那条链能成立的部署前提。
- 第 12 步 `Sessions.ensure` 记住创建时的 preset；删掉 patch 行会导致 resume 报 `agent-preset/not-found`。
- 第 15–20 步把「可重启修的错」与「重启修不好的错」分开：18 是 setup 等待(3)、19 是组件持续错误(2)、20 是 `manually-stopped` 标记让监控不误拉起。

## 验收标准

- [ ] 能按顺序列出 `profile patch → bundle patch → preset → Runtime → Sessions → tmux` 装配链。
- [ ] 能说出 `WORKER_PRESET`(order 90) / `ROUTER_PRESET`(order 91) 的用途及为何不供手动选择。
- [ ] 能解释 `writeEnvironment` 写 `worker-bin` shim 与 `worker-gitconfig`，并说明它**不是**进程隔离。
- [ ] 能复述 `Runtime.initialize` 的顺序，并解释路由先行的原因。
- [ ] 能实现 `outcome(pids, current)` 返回 0/1/2/3，说清 `stop / start / restart` 与 marker 的关系。

## 与前课的关系

承接 L03 的 worker slot、L04 的 `systemPrompt.section` 装饰、L05 的 `GET state` 与同源守卫。新增的是它们赖以运行的宿主层：Cordis patch 词汇、DSH agent preset、Setup 验证、进程管理与监控契约。这一课也是 L07「可移植 / 不可移植」清单的证据来源。

## 易错点速查

| 误解 | 正确理解 |
|---|---|
| 升级要重跑 profile 创建命令 | 它会替换 profile 并删掉 `cordis.patch.yml`；升级前必须备份数据库（迁移后旧版打不开） |
| 两个 preset 可以手选或禁用 | 它们由 Session 记住，删掉会导致 resume 报 `agent-preset/not-found` |
| `danger-full-access` = 进程隔离 | 账户包装器只选凭据；worker 仍可按绝对路径执行程序、读操作者 home |
| setup 完成后才注册路由 | `registerHttp` 在 setup 之前，运维才能进 UI 修 setup 问题 |
| restart 也会写停止标记 | 只有 `stop` 写、`start` 清、`restart` 不写；`--respect-stop` 据此不误拉起 |
| 2 / 3 也该自动重启 | 1 才是「重启可能修好」；2 是组件持续错误、3 是 setup 等待人工，重启修不好 |
| 仍在启动的 Source 算异常 | 与「Feishu bot 未能检查」一样都算正常运行 |

## 源码坐标

```
docs/006-deployment.md            安装 / setup / 健康检查 / 升级 / 退出码
package.json                      dsh.bundle.patch / engines / files
cordis.patch.yml                  5 行 insert / preset / bash-sandbox / tool-jobs
examples/profile.cordis.patch.yml stateDir / webserver.port（示例 3082）
src/deployment.ts                 Config / machineOf / MOVED / SETUP_FIELDS / resolveDeployment
src/setup.ts                      SetupProblem / SetupError / setupChanged
src/infra/environment.ts          workerBin / workerGitConfig / WORKER_COMMANDS / writeEnvironment
src/index.ts                      apply / restart（ctx.fiber.restart）
src/app/runtime.ts                Runtime.initialize（组合根）
src/app/sessions.ts               ensure / decorate / WORKER_PRESET / ROUTER_PRESET
src/app/http.ts                   stateView（CLI status 的数据源）
scripts/dsh-superagent            state / outcome / start / stop / restart / hourly check
tests/bundle-patch.spec.ts        applyEntryPatches 断言 5 行 id 与三个 5000
```

## 下一步

L07 做一次全链路复盘，并把 `src/core` 的零 I/O 内核与这一课里出现的所有 DSH 适配器逐条切开 —— 这正是后续「底座内核彻底与 DSH 无关」的判断依据。
