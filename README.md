# Way2SA · Learning to learn from — and build — a super agent

A personal study repo. The goal is not to ship an agent, but to get good at
**reading a system you did not build, and turning that reading into something you
could rebuild yourself**.

The subject is [`dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype)
(DeepSeek, MIT) and its eight design documents. Each document becomes one lesson;
each lesson is a self-contained interactive page.

中文完整说明见 [README.zh.md](README.zh.md)（课程排版、Shan 预览约束、主题桥接等细节）。

## What is here

```
index.html                    course map (generated)
README.md                     this file
README.zh.md                  the detailed Chinese write-up
AGENTS.md                     project conventions
assets/                       course.css / course.js / curriculum.js / uml.js — single source of truth
lessons/L01-domain/ … L08-cookbook/   README.md + TUTORIAL.md + data.js + index.html (generated)
tools/                      build.mjs / validate.mjs / smoke.mjs / tutorials.mjs
dsh-superagent-prototype/   upstream prototype, a git submodule used as read-only reference
```

Every lesson ships four artifacts: `README.md` (what you learn, prerequisites,
acceptance criteria, common mistakes), `TUTORIAL.md` (line-by-line reading of real
prototype source, ending in two runnable exercises), `index.html` (animated module
graph, state machine, event log, per-module UML class diagrams) and `data.js` (the
graph data for that lesson).

| Lesson | Prototype doc | Topic |
|---|---|---|
| L01 | `001-domain.md` | domain model: concepts and the rejection list |
| L02 | `002-authorization.md` | authorization and proactivity: gate / admission / Mandate |
| L03 | `003-execution.md` | execution and reliable delivery: stage / Effects / Outbox |
| L04 | `004-prompts.md` | prompts: assembly order, version injection, priority |
| L05 | `005-panel.md` | panel: read-only views → write commands → refresh |
| L06 | `006-deployment.md` | deployment: profile / bundle / preset / processes |
| L07 | `007-architecture.md` | full-chain review and the zero-I/O kernel boundary |
| L08 | `008-cookbook.md` | end to end: wire your own webhook Source |

Lessons build on each other: in a later lesson's diagram, faded blocks are carried
over from the previous lesson and solid blocks are new, so module positions never
jump — the same picture just lights up layer by layer.

## How to use it

No server, no CDN, no build step needed to read. `index.html` works over `file://`,
and each page is one self-contained HTML file (that is also why it survives being
previewed inside a sandboxed iframe — see the Chinese README for the constraints
behind this design).

1. Open `index.html` (the course map), or double-click `lessons/L0X-*/index.html`.
2. Open the lesson's 讲义 (README) and 教程 (TUTORIAL) from the sticky bar, then the
   original upstream doc — all three are inlined in the page.
3. Press play: a message travels along the edges while the graph, the state machine
   and the event log light up in sync. Click any module for its UML class diagram
   and the real source behind it; click any logged event to jump to that step.

```bash
node tools/build.mjs          # regenerate the 9 self-contained index.html files
node tools/build.mjs --check  # fail if generated files are stale
node tools/validate.mjs       # data integrity, UML/path checks, self-containment, size limit
node tools/smoke.mjs          # DOM sandbox: every step, every UML popup, both themes
node tools/tutorials.mjs      # run the 16 JS exercises embedded in the tutorials
```

The scripts have zero dependencies and need no browser. Current state: 8 lessons,
121 modules, 141 edges, 149 animation steps, 59 code anchors, 192 UML signatures.

`index.html` files are generated — edit `assets/*` and `lessons/*/data.js`, then
rebuild.

## The prototype as a submodule (no fork needed)

`dsh-superagent-prototype/` is **not** a fork; nothing here changes upstream. It is
a submodule pointing at the public repo, pinned to commit `6337fc8` — the exact
tree the lessons were written against. Upstream later re-published `main` as
`8c32a9d` with an identical tree, so the pin is safe but not the newest commit.

```bash
git clone --recurse-submodules https://github.com/NavigatorXia/way2sa.git
# or, after a plain clone:
git submodule update --init --depth 1
```

Skip it if you only want the course: the eight upstream docs are already inlined in
the generated pages.

## The line between design and code

Source of truth is split, and the lessons keep the split honest: the prototype docs
describe the **intended design**, the code is a **partial implementation**. Anything
with no counterpart in the code — storage/compute separation, a device-side daemon,
a separate Watchdog session, async `start()` / `stop()` — is labelled as design
intent. "Fast Path / Slow Path" is a teaching phrasing, not a class name; the real
code is `followupOwners` / `queueForEval` (L07 dwells on this).

## License

Copyright 2026 Leo.X. The course content in this repo (READMEs, tutorials, `assets/`,
`lessons/*/data.js`, `tools/`) is released under the
[Apache License 2.0](LICENSE) — see `LICENSE`.

That does not relicense the upstream prototype: `dsh-superagent-prototype/` and the
excerpts inlined from its `docs/` stay under DeepSeek's MIT license, with the
original copyright notice preserved as-is. Apache-2.0 and MIT are compatible in this
direction, so reuse must carry both notices.
