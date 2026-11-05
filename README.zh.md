# Way2SA · 从 8 篇原型文档学 Super-agent

一套**纯静态、零 CDN、单文件自包含**的交互课程，用来读透 `dsh-superagent-prototype` 的 8 篇设计文档。一门课对应一篇文档，顺序即递进顺序。课程全部放在 `lessons/` 下。

英文概览（仓库定位、上手方式、原型 submodule）见 [README.md](README.md)。

## 为什么这么排

| 课 | 文档 | 主题 | 承接 |
|---|---|---|---|
| L01 | `001-domain.md` | 领域模型：概念与拒绝清单 | 起点 |
| L02 | `002-authorization.md` | 授权与主动性：gate / admission / Mandate | L01 |
| L03 | `003-execution.md` | 执行与可靠投递：stage / Effects / Outbox | L02 |
| L04 | `004-prompts.md` | 提示词：装配顺序、版本注入、优先级 | L03 |
| L05 | `005-panel.md` | 面板：只读视图 → 写命令 → 回刷 | L04 |
| L06 | `006-deployment.md` | 部署：profile / bundle / preset / 进程 | L05 |
| L07 | `007-architecture.md` | 全链路复盘与零 I/O 内核边界 | L06 |
| L08 | `008-cookbook.md` | 端到端实战：自己接一个 webhook Source | L07 |

后面课程的框架图**直接沿用前课的模块**：淡色块 = 承接，实色块 = 本课新增；所以从 L01 翻到 L08，模块位置不跳动，只是在同一张图上逐层点亮。

## 每课四件套

- `README.md` — 学什么、先修、验收标准、易错点速查。
- `TUTORIAL.md` — 代码教程：逐段拆原型真实源码（路径 + 符号 + 逐字抄录片段），末尾两个不依赖 DSH 的动手实验。
- `index.html` — 动态设计框架：「模块与流转」卡片内含流转图与事件日志，旁边是状态机 / 当前步骤，下方代码锚点，全部由同一份步骤数据联动；每个模块可点开 UML 类图。
- `data.js` — 本课的全部图数据。加新课只需复制一课目录、改 `data.js`、在 `assets/curriculum.js` 登记，并在 `assets/uml.js` 补上新模块的 UML 条目，然后重新构建。

`index.html` 是**生成物**：`tools/build.mjs` 把 `assets/course.css`、4 份共享 JS、8 份 `data.js`、8 份 README、8 份 TUTORIAL 与 8 篇原型原文（`docs/001…008`）全文内联进每个 HTML。不要直接编辑 `index.html`。

## 为什么全部内联（Shan content-view）

Shan 的 `content-view` 把 HTML 文件渲染成：

```html
<iframe srcDoc={PREVIEW_BRIDGE + THEME_HINT + html} sandbox="allow-scripts">
```

见 `shan/pkgs/client/content-view/src/file-viewer.tsx`。这带来三个约束：

1. `srcdoc` 文档的 base URL 继承自 **Shan 应用**，不是文件所在目录 → `../assets/course.css`、`data.js` 这类相对资源全部 404，脚本不执行，页面只剩一个空 `#app`。这就是之前「没渲染效果」的原因。
2. sandbox 没有 `allow-same-origin`，属**不透明源**：`localStorage` 会抛异常，帧也读不到父页的 `<html class="dark">`。所以渲染器完全不依赖本地存储，主题改由宿主显式递进来（见下方「主题」）。
3. 沙箱帧**不能导航父帧**：所有课程切换必须是页内动作，不能靠 `<a href>`。

因此每个 `index.html` 都是零外链的单文件文档，8 课数据、8 份 README、8 份 TUTORIAL、8 篇原型原文、UML 目录全部内联，`file://` 双击与 Shan 预览用同一个文件。`sa-lessons/diagrams.html` 处理的是同一个问题。

单文件现为 **585.8 KB**（`node tools/validate.mjs` 末行会打印当前最大值），超过 `TEXT_PREVIEW_MAX_BYTES = 256 KB` 的首块。这不是失败：Shan 对截断的 HTML 走另一条已实现的路径 —— `file-viewer.tsx` 里 `needsHtmlFull` 会用 `/api/files?type=download` 再取一次完整文件（上限 `HTML_PREVIEW_MAX_BYTES = 10 MB`），仍然渲染成同一个 `srcdoc`。代价只是预览多一次请求；`file://` 不受影响。参照物 `sa-lessons/diagrams.html` 本身就是 **790 KB**、走同一条路径且能正常预览，所以这条路径是验证过的。校验器只把 10 MB 当硬上限。

## 主题桥接：Shan 侧的唯一改动

`shan/pkgs/client/content-view/src/file-viewer.tsx` 新增 `useDocumentDark()`（用 `MutationObserver` 观察 `<html>` 的 `class` / `data-theme`），并在 HTML 预览 iframe 上：

- 生成 `srcdoc` 时在 `PREVIEW_BRIDGE` 之后、页面脚本之前放一段 `window.__SHAN_THEME__=…` 提示；该字符串**只在文件内容变化时重建**，主题切换不会改 `srcDoc`（否则帧会重载、课程播放进度会丢）。
- `onLoad` 与 `useEffect([shanDark])` 向帧 `postMessage({ shanTheme })`，覆盖实时切换与刚加载的帧。

`PREVIEW_BRIDGE` 仍排在最前，快捷键桥接不受影响；其它被预览的 HTML 只是多一个全局变量，行为不变。Shan 的其余源码未改动。

## 界面约定

- **顶部导航**：一个课程**选择框** + `◀` / `▶` 两个按钮，选课在页内完成，不跳转（参考 `sa-lessons`）。顶栏只放导航。
- **悬浮栏**：播放控制、**步骤进度**、`讲义`、`教程`、`课程地图` 同在一条 `position: sticky` 悬浮栏上，滚动时始终可见；课程地图页也保留同一条栏（地图页没有播放进度）。
  - **步骤进度**在悬浮栏上常驻：`第 N / 总数` 计数 + 当前步骤名 + 可拖动的进度条。播放、单步、重置、UML 弹窗跳步都会同步更新，滚到页面任意位置都知道走到第几步。
  - `讲义` 弹出当前课 `README.md`；`教程` 弹出当前课 `TUTORIAL.md`（逐段精读 + 两个可运行实验）。地图页的「教程」是从 8 份教程实时生成的索引。
  - `Esc`、点遮罩或 `✕` 关闭；切课后若弹窗开着，内容自动跟着换。相对链接一律不跳转，画成灰色代码标签。
- **点块看 UML**：流转图里**每个模块都可点**（鼠标悬停有提示）。弹出一张三栏 UML 类图 —— `«interface» / «class» / «type» / «function» / «data» / «external»`、字段、接口函数，并把最多 3 个相邻块画成关联框；下面给出：
  - **主要代码**：按 `assets/uml.js` 里的符号引用，直接复用本课（或其他课）已内联的真实原型代码片段，不复制第二份；
  - **接口函数**：完整签名清单（77 个去重块 / 192 条签名，全部来自 `dsh-superagent-prototype` 真实源码，路径由校验器逐条核对）；
  - **关系**与**参与的动态步骤**：从本课 `edges` / `steps` 派生，点任一步即关弹窗并跳到那一步播放。
  做法对齐 `sa-lessons/diagrams.html` 的 UML 卡片，但这里是一张真正的 SVG 类图。
- **动态区**：`dynamic-board` 里，左侧「模块与流转」卡片**把流转图与事件日志收在一起**（日志就在图的正下方，虚线分隔），右侧是状态机与当前步骤；播放时消息包经过的连线与刚落地的事件一眼可对照。事件日志**把整条链路一次列全**（未到的步骤淡显），卡片高度由内容决定、日志自然填满，所以一进来就是一整份可点的“节目单”，不是空盒子。每条都是**流转跳板** —— 点第 N 条就暂停播放并跳回第 N 步，悬浮栏步数同步。进度条属于控制项，放在悬浮栏而不是随内容滚走。
- **阅读尺寸**：正文统一 **15px**（与标题旁的 `/ 概念从哪来` 同号），代码与图表标签另设小一号。流转图**按固定像素封顶**（`GRAPH_MAX_W = 760`，见 `assets/course.js`）：viewBox 约 988 单位，所以图上文字恒定在 ~0.77 倍，窗口变宽（例如收起侧边栏）只是卡片里多出留白，图框与字号都不再变大；卡片比 760 更窄时才等比缩小，这没法避免。**左栏是固定轨道**：`grid-template-columns: minmax(0, 800px) minmax(260px, 1fr)` —— 左卡最宽 800px（=760 图 + 卡内边距），收起 aside 右边栏时多出来的宽度全给右栏，左卡不会变宽；窗口窄于 ~1120px 才开始收，1000px 以下单列。事件日志 `flex: 1 1 auto` + **`height: 176px`**：给的是**确定的 height 而不是 min-height** —— 只用 min-height 时，网格行有可能先按右栏（更矮）定高，日志随后被 176px 顶出卡片下沿（WebKit 上实际发生过）；确定高度会算进卡片自身高度，`模块与流转` 就恒等于 图 + 176，而 `flex-grow` 仍让它在右栏更高时跟着长。右栏两张卡 `flex: 1 1 auto` 分掉剩下的高度，所以 **日志底边 = 当前这一步底边 = 左卡底边**（`align-items: stretch`），状态迁移列表是带边框的滚动区，多出来的高度落进这个框里。窄屏单列时日志高度提到 240px。首屏两栏比例改成 **0.85 : 1.15**，「这课学什么」变窄，「学完能回答」拿到更多宽度。
- **笔记区**：`术语与源码坐标` 卡片**横跨两列**（`.terms-card`），术语是等宽字、源码是完整路径，一列放不下会把路径挤掉；再窄时表格在卡内横向滚动（`.terms-wrap`），不再被卡片边缘切掉。
- **原型原文**：悬浮栏外的 `原型原文 00X-*.md` 与首页的文档名都可点，**就地弹窗**显示 `dsh-superagent-prototype/docs/` 的原文（8 篇已内联，两种环境都可用）。课头的 `起点 / 文档 / 步数 / 模块数` 标签已去掉，只留下“这课学什么”和“学完能回答”。
- **主题**：**跟 Shan 的 Settings → Appearance 走**，系统偏好只作兜底。Shan 把 Appearance 解析成 `<html class="dark">`，但不透明源帧读不到父页 DOM，所以 `file-viewer.tsx` 做了两件事：
  1. 生成 `srcdoc` 时在页面脚本之前注入 `window.__SHAN_THEME__ = "dark" | "light"` —— 首屏就是正确主题，深色应用里不会闪一下白底；
  2. 用 `postMessage({ shanTheme })` 把**实时切换**送进帧（含 `iframe.onLoad`），不重建 `srcdoc`、不打断正在播放的课程。宿主侧读的是 `document.documentElement.classList.contains("dark")`（`MutationObserver` 跟随切换），与 `page-preview.tsx` 的 `useDocumentTheme()` 同一口径，因此 light/dark/mist/rose/pine/auto 六种 Appearance 都对得上。
  - 课件侧优先级：宿主 `postMessage` > 注入的 `__SHAN_THEME__` / `WAY2SA_PARENT_THEME` > `prefers-color-scheme`；`auto` 交还系统。`file://` 直接打开没有宿主，就纯跟系统并监听实时变化。始终设置 `color-scheme`，滚动条与表单控件一并跟随；**没有页内开关、没有 `localStorage`**。

快捷键：`Space` 播放/暂停、`S` 单步、`R` 重置、`←/→` 步进、`Esc` 关弹窗（讲义 / 教程 / UML）；弹窗打开时播放快捷键自动屏蔽；悬浮栏的进度条可跳到任意一步。

## 怎么用

1. 打开 `index.html`（课程地图），或直接双击 `lessons/L0X-*/index.html`。`file://` 下即可运行，无需服务器；在 Shan 里从文件树打开同样的文件即可。
2. 点悬浮栏「讲义」读该课 `README.md`，点「教程」看逐段源码精读；再看原型原文 `dsh-superagent-prototype/docs/0XX-*.md`。
3. 点 **播放**：一条 message / event 会沿连线实际移动，同步点亮框架图节点、状态机、流转图下方的事件日志与对应代码卡片；悬浮栏的 `第 N / 总数` 与步骤名实时跟着走。想回看某一步，直接点那条日志。
4. **点流转图里任一模块**：看它的 UML 类框、真实代码片段、接口函数、关系，以及它参与了哪几步流转；点其中一步可直接跳过去播放。
5. 把 `TUTORIAL.md` 的两个实验跑一遍，再对照 README 的验收标准自测。

## 数据来源与口径

- 所有代码片段与路径来自同目录下的 `dsh-superagent-prototype`（submodule，钉在 git `6337fc8`）。课件不执行原型代码，只做解释与可视化。
- 文档 = **设计目标态**，原型 = **部分落地**。存算分离 / 端侧 daemon、独立 Watchdog Session、异步 `start()/stop()` 在原型里没有真正实现。
- 文章中的 **Fast Path / Slow Path** 是讲法，不是原型里的类名；原型对应实现是 `followupOwners` / `queueForEval`。L07 专门讲了这点。
- Shan / pi local-loop、Cordis 只在需要对照时出现，不作为本课程的设计前提。

## 构建与校验

```bash
cd way2sa                       # 仓库根目录
node tools/build.mjs          # 重新生成 9 个自包含 index.html
node tools/build.mjs --check  # 只检查生成物是否过期
node tools/validate.mjs       # 数据完整性 + UML 目录核对 + 自包含性 + 生成物新鲜度 + 10MB 上限
node tools/smoke.mjs          # DOM 沙箱：两种环境 / 全步骤+悬浮栏计数 / 每个块的 UML / 日志跳步 / 讲义 / 教程 / 原型原文 / 宿主 Appearance 主题
node tools/tutorials.mjs      # 逐课执行 TUTORIAL.md 里的 16 个 JS 实验
```

四个脚本零依赖、不需要浏览器，当前全部通过：8 课 / 121 模块（77 个去重块）/ 141 连线 / 149 步流转 / 59 个代码锚点 / 192 条 UML 接口签名 / 16 个可运行实验。

## 目录

```
index.html                    课程地图（生成物）
README.md                     英文概览
README.zh.md                  本文件（地图页讲义由课程注册表实时生成，不内联本文件）
assets/                       course.css / course.js / curriculum.js / uml.js（单一数据源）
lessons/
  L01-domain/ … L08-cookbook/ 每课 README.md + TUTORIAL.md + data.js + index.html(生成物)
tools/                        build.mjs / validate.mjs / smoke.mjs / tutorials.mjs
dsh-superagent-prototype/     原型仓库（submodule，只读参考）
```

## 许可

课程本体（两份 README、每课 `README.md` / `TUTORIAL.md`、`assets/`、`lessons/*/data.js`、`tools/`）版权归 **Leo.X (2026)**，采用 [Apache License 2.0](LICENSE)，全文见 `LICENSE`。
`dsh-superagent-prototype/` 与内联进页面的 `docs/` 原文仍归 DeepSeek 的 MIT 许可，版权声明原样保留；Apache-2.0 与 MIT 在该方向兼容，二次分发需同时带上两份声明。
