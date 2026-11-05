window.CURRICULUM = [
  { id: 'L01', dir: 'lessons/L01-domain',        title: '领域模型',       doc: '001-domain.md',        tag: '领域词汇',
    oneLine: '认识 Source / Trigger / Thread / Eval / Mandate / Ticket / Assignment / Subscription 的职责与边界。',
    buildsOn: null,  theme: '概念从哪来、什么被刻意拒绝' },
  { id: 'L02', dir: 'lessons/L02-authorization', title: '授权与主动性',   doc: '002-authorization.md', tag: '谁能开工',
    oneLine: 'gate、admission table、accept mode、Mandate basis 与 revalidate，搞清「订阅不给授权」。',
    buildsOn: 'L01', theme: '权力只来自 Mandate' },
  { id: 'L03', dir: 'lessons/L03-execution',     title: '执行与可靠投递', doc: '003-execution.md',     tag: '怎么干活',
    oneLine: 'stage 派生、worker slot、后台作业、事务内入队、Effects 退避与 Outbox 幂等收据。',
    buildsOn: 'L02', theme: '状态先存、副作用后做' },
  { id: 'L04', dir: 'lessons/L04-prompts',       title: '提示词',         doc: '004-prompts.md',       tag: '规则怎么注入',
    oneLine: '8 段固定装配顺序、版本快照与 next-request 注入、团队 override 与优先级。',
    buildsOn: 'L03', theme: '文本不能改权限' },
  { id: 'L05', dir: 'lessons/L05-panel',         title: '面板与人的交互', doc: '005-panel.md',         tag: '注意力预算',
    oneLine: '只读视图 → 人操作 → 带 revision 的写命令 → 轮询回刷，以及 loopback 同源 API。',
    buildsOn: 'L04', theme: '只在人必须行动时说话' },
  { id: 'L06', dir: 'lessons/L06-deployment',    title: '部署与宿主装配', doc: '006-deployment.md',    tag: '怎么跑起来',
    oneLine: 'profile / bundle patch / 两个 agent preset / Sessions.ensure / setup / tmux 与退出码。',
    buildsOn: 'L05', theme: 'DSH 宿主层是什么' },
  { id: 'L07', dir: 'lessons/L07-architecture',  title: '整体架构与内核边界', doc: '007-architecture.md', tag: '哪层可移植',
    oneLine: '一条 Trigger 的全链路复盘，并把零 I/O 的 src/core 与 DSH 适配器逐条切开。',
    buildsOn: 'L06', theme: 'ports 就是全部接缝' },
  { id: 'L08', dir: 'lessons/L08-cookbook',      title: 'Cookbook 端到端实战', doc: '008-cookbook.md',  tag: '自己接一个 Source',
    oneLine: '照 11 步写出一个 webhook Source kind，从稳定 id 做到构建、注册、重启生效与交付。',
    buildsOn: 'L07', theme: '把前七课串成一条链' }
];

window.CURRICULUM_BY_ID = {};
window.CURRICULUM.forEach(function (c) { window.CURRICULUM_BY_ID[c.id] = c; });
