#!/usr/bin/env node
/**
 * Way2SA curriculum validator (zero dependencies).
 *
 *   node tools/validate.mjs
 *
 * Checks: curriculum registry, every lesson's data.js schema and all cross
 * references (nodes / edges / steps / states / snippets), required lesson
 * files, HTML local resources, and source-coordinate paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { targets, render } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTO = path.join(ROOT, 'dsh-superagent-prototype');
const errors = [];
const warnings = [];
const stats = { lessons: 0, nodes: 0, edges: 0, steps: 0, snippets: 0, states: 0, transitions: 0, uml: 0, umlMethods: 0 };
const allNodeIds = new Set();
const allSnippetSymbols = new Set();

function err(where, msg) { errors.push(`${where}: ${msg}`); }
function warn(where, msg) { warnings.push(`${where}: ${msg}`); }
function read(p) { return fs.readFileSync(p, 'utf8'); }
function exists(p) { return fs.existsSync(p); }
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isInt = v => Number.isInteger(v) && v >= 0;
const arr = v => Array.isArray(v) && v.length > 0;

/** Run a browser-ish script in a fresh sandbox and return its `window`. */
function runScript(code, file, extra = {}) {
  const sandbox = { console, setTimeout, clearTimeout, Math, Date, JSON, ...extra };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { filename: file, timeout: 5000 });
  } catch (e) {
    err(file, `script threw: ${e.message}`);
  }
  return sandbox;
}

/* ---------------------------------------------------------------- 1. registry */
const curriculumPath = path.join(ROOT, 'assets', 'curriculum.js');
if (!exists(curriculumPath)) {
  err('assets/curriculum.js', 'missing');
} else {
  // A detached copy so data.js cannot mutate the registry we validate.
  var CURR = runScript(read(curriculumPath), 'assets/curriculum.js').CURRICULUM;
}
CURR = CURR || [];
if (CURR.length !== 8) err('curriculum', `expected 8 courses, got ${CURR.length}`);
const ids = new Set();
for (const [i, c] of CURR.entries()) {
  const w = `CURRICULUM[${i}]`;
  for (const k of ['id', 'dir', 'title', 'doc', 'tag', 'oneLine', 'theme']) {
    if (!isStr(c[k])) err(w, `missing/empty ${k}`);
  }
  if (c.id && ids.has(c.id)) err(w, `duplicate id ${c.id}`);
  if (c.id) ids.add(c.id);
  if (c.id !== `L0${i + 1}`) err(w, `id should be L0${i + 1}, got ${c.id}`);
  if (c.buildsOn !== null && c.buildsOn !== `L0${i}`) err(w, `buildsOn should be L0${i} or null`);
  if (c.doc && !exists(path.join(PROTO, 'docs', c.doc))) err(w, `doc not found: docs/${c.doc}`);
  if (c.dir && !exists(path.join(ROOT, c.dir))) err(w, `dir not found: ${c.dir}`);
}

/* ------------------------------------------------------------- 2. shared assets */
for (const f of ['assets/course.css', 'assets/course.js', 'assets/curriculum.js', 'assets/uml.js',
  'index.html', 'README.md', 'tools/build.mjs', 'tools/validate.mjs',
  'tools/smoke.mjs', 'tools/tutorials.mjs']) {
  if (!exists(path.join(ROOT, f))) err('root', `missing ${f}`);
}
for (const f of ['assets/course.css', 'assets/course.js', 'assets/curriculum.js', 'assets/uml.js']) {
  const p = path.join(ROOT, f);
  if (exists(p) && !read(p).trim()) err(f, 'empty file');
}
/* Theme policy: the HOST APP's Settings > Appearance is the source of truth,
   the OS is only the fallback (standalone file:// or a host that publishes
   "auto"). Shan's opaque-origin srcdoc frame cannot read <html class="dark">,
   so the host injects `__SHAN_THEME__` and posts `shanTheme` on live flips.
   Still forbidden: a persisted choice, localStorage, an in-page theme button.
   Step progress policy: counter + label must live on the floating bar. */
const rendererSrc = exists(path.join(ROOT, 'assets/course.js'))
  ? read(path.join(ROOT, 'assets/course.js')) : '';
// Detect CALLS, not prose: the file's comment legitimately explains that
// localStorage throws inside Shan's opaque-origin iframe.
for (const s of ['localStorage.getItem', 'localStorage.setItem', 'localStorage.removeItem',
  'id="theme-btn"', 'toggleTheme']) {
  if (rendererSrc.includes(s)) err('assets/course.js', `theme must have no persisted/in-page control; unexpected reference to ${s}`);
}
for (const s of ['__SHAN_THEME__', 'shanTheme', 'WAY2SA_PARENT_THEME', 'way2saTheme',
  "addEventListener('message'", 'prefers-color-scheme', 'parentTheme']) {
  if (!rendererSrc.includes(s)) err('assets/course.js', `missing ${s} (host Appearance bridge / OS fallback)`);
}
for (const s of ['player-progress', 'step-brief']) {
  if (!rendererSrc.includes(s)) err('assets/course.js', `missing ${s} (floating-bar progress)`);
}
/* Event-log policy: the log is nested INSIDE the 模块与流转 card, not a
   separate card below the viz-grid. Each row must be a clickable step jump. */
for (const s of ['class="card flow-card"', 'class="flow-log"', 'bindLogRow', 'logJump']) {
  if (!rendererSrc.includes(s)) err('assets/course.js', `missing ${s} (event log inside 模块与流转)`);
}
if (rendererSrc.includes('class="card log-panel"')) {
  err('assets/course.js', 'event log is still a separate bottom card');
}

/* ---------------------------------------------------------- 3. lesson by lesson */
const KINDS = new Set(['fact', 'message', 'command', 'event', 'effect', 'config']);
const NODE_KINDS = new Set(['kernel', 'host', 'human']);
const PSEUDO_STATES = new Set(['(incoming)', '(start)', '(end)']);

function checkLesson(c) {
  const dir = path.join(ROOT, c.dir);
  const w = c.id;
  stats.lessons++;

  /* required files */
  for (const f of ['index.html', 'data.js', 'README.md', 'TUTORIAL.md']) {
    if (!exists(path.join(dir, f))) { err(w, `missing ${f}`); continue; }
    if (fs.statSync(path.join(dir, f)).size < 200) err(w, `${f} looks too small`);
  }
  /* README / TUTORIAL must actually explain the lesson */
  let readme = '';
  if (exists(path.join(dir, 'README.md'))) {
    readme = read(path.join(dir, 'README.md'));
    for (const h of ['这课学什么', '三个问题', '验收标准', '源码坐标']) {
      if (!readme.includes(h)) err(`${w}/README.md`, `missing section ${h}`);
    }
  }
  if (exists(path.join(dir, 'TUTORIAL.md'))) {
    const t = read(path.join(dir, 'TUTORIAL.md'));
    for (const h of ['源码地图', '逐段精读', '实验 A', '实验 B', '自检清单']) {
      if (!t.includes(h)) err(`${w}/TUTORIAL.md`, `missing section ${h}`);
    }
    if (!t.includes('```')) err(`${w}/TUTORIAL.md`, 'no code fence');
  }
  /* Generated HTML must be entirely SELF-CONTAINED (Shan srcdoc preview) */
  if (exists(path.join(dir, 'index.html'))) {
    const h = read(path.join(dir, 'index.html'));
    const markup = h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
    for (const m of markup.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      const ref = m[1];
      if (/^(https?:|data:|mailto:|javascript:)/i.test(ref)) continue;
      err(`${w}/index.html`, `external local resource (404 inside srcdoc): ${ref}`);
    }
    if (!/<style>[\s\S]*<\/style>/.test(h)) err(`${w}/index.html`, 'CSS is not inlined');
    for (const s of [
      'window.CURRICULUM', 'window.Course', 'window.WAY2SA_UML', 'WAY2SA_DOCS', 'WAY2SA_HOLD',
      'id="app"', 'id="doc-modal"', 'id="uml-modal"', 'id="btn-tutorial"',
      'lesson-select', 'dynamic-board', 'player-docs',
      'player-progress', 'id="step-brief"', 'id="counter"',
      'flow-card', 'flow-log', 'id="log-list"'
    ]) {
      if (!h.includes(s)) err(`${w}/index.html`, `missing ${s}`);
    }
    if (!read(path.join(dir, 'README.md')).slice(0, 120).length) {
      err(`${w}/README.md`, 'empty');
    }
  }

  /* load data.js with a Course.boot stub */
  const dataPath = path.join(dir, 'data.js');
  if (!exists(dataPath)) return;
  let captured = null;
  const sandbox = {
    window: {
      CURRICULUM: CURR,
      CURRICULUM_BY_ID: Object.fromEntries(CURR.map(x => [x.id, x])),
      Course: { boot: d => { captured = d; } }
    }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  try {
    vm.runInContext(read(dataPath), sandbox, { filename: `${c.dir}/data.js`, timeout: 5000 });
  } catch (e) {
    err(`${w}/data.js`, `script threw: ${e.message}`);
    return;
  }
  const d = captured;
  if (!isObj(d)) { err(`${w}/data.js`, 'Course.boot() was not called with an object'); return; }

  /* scalar fields */
  for (const k of ['id', 'title', 'tag', 'doc', 'subtitle', 'goal']) {
    if (!isStr(d[k])) err(`${w}/data.js`, `missing/empty ${k}`);
  }
  if (d.id !== c.id) err(`${w}/data.js`, `id mismatch: ${d.id} != ${c.id}`);
  if (d.doc !== c.doc) err(`${w}/data.js`, `doc mismatch: ${d.doc} != ${c.doc}`);
  if (!arr(d.questions) || d.questions.length !== 3) err(`${w}/data.js`, 'questions must be exactly 3');
  if (!arr(d.lanes)) err(`${w}/data.js`, 'missing lanes');
  for (const k of ['nodes', 'edges', 'steps', 'snippets', 'glossary', 'pitfalls', 'labs', 'takeaways']) {
    if (!arr(d[k])) err(`${w}/data.js`, `missing/empty ${k}`);
  }
  if (!isObj(d.states)) err(`${w}/data.js`, 'missing states');

  /* nodes */
  const nodeIds = new Set();
  for (const [i, n] of (d.nodes || []).entries()) {
    const nw = `${w}.nodes[${i}]`;
    if (!isStr(n.id)) err(nw, 'missing id');
    if (n.id && nodeIds.has(n.id)) err(nw, `duplicate node id ${n.id}`);
    if (n.id) { nodeIds.add(n.id); allNodeIds.add(n.id); }
    for (const k of ['label', 'sub']) if (!isStr(n[k])) err(nw, `missing ${k}`);
    if (!isInt(n.lane) || !isInt(n.col)) err(nw, 'lane/col must be non-negative integers');
    if (d.lanes && n.lane >= d.lanes.length) err(nw, `lane ${n.lane} exceeds lanes (${d.lanes.length})`);
    if (!NODE_KINDS.has(n.kind)) err(nw, `bad kind ${n.kind}`);
  }
  stats.nodes += (d.nodes || []).length;
  if (d.lanes) {
    for (let lane = 0; lane < d.lanes.length; lane++) {
      if (!(d.nodes || []).some(n => n.lane === lane)) warn(w, `lane ${lane} (${d.lanes[lane]}) has no nodes`);
    }
  }
  // L01 is the starting lesson; every later lesson must reuse earlier modules.
  if (c.buildsOn && !(d.nodes || []).some(n => n.carry)) warn(w, 'no carry nodes (cumulative progression marker missing)');

  /* edges */
  for (const [i, e] of (d.edges || []).entries()) {
    const ew = `${w}.edges[${i}]`;
    if (!nodeIds.has(e.from)) err(ew, `unknown from ${e.from}`);
    if (!nodeIds.has(e.to)) err(ew, `unknown to ${e.to}`);
    if (!isStr(e.label)) err(ew, 'missing label');
  }
  stats.edges += (d.edges || []).length;

  /* state machine */
  const stateIds = new Set();
  const sm = d.states || { nodes: [], transitions: [] };
  for (const [i, s] of (sm.nodes || []).entries()) {
    const sw = `${w}.states.nodes[${i}]`;
    if (!isStr(s.id)) err(sw, 'missing id');
    if (s.id && stateIds.has(s.id)) err(sw, `duplicate state id ${s.id}`);
    if (s.id) stateIds.add(s.id);
    if (!isInt(s.c) || !isInt(s.r)) err(sw, 'c/r must be non-negative integers');
    if (!isStr(s.label)) err(sw, 'missing label');
  }
  stats.states += (sm.nodes || []).length;
  for (const [i, t] of (sm.transitions || []).entries()) {
    const tw = `${w}.states.transitions[${i}]`;
    if (!stateIds.has(t.from) && !PSEUDO_STATES.has(t.from)) err(tw, `unknown from ${t.from}`);
    if (!stateIds.has(t.to) && !PSEUDO_STATES.has(t.to)) err(tw, `unknown to ${t.to}`);
    if (!isStr(t.label)) err(tw, 'missing label');
  }
  stats.transitions += (sm.transitions || []).length;

  /* snippets */
  const snippetIds = new Set();
  for (const [i, s] of (d.snippets || []).entries()) {
    const sw = `${w}.snippets[${i}]`;
    if (!isStr(s.id)) err(sw, 'missing id');
    if (s.id && snippetIds.has(s.id)) err(sw, `duplicate snippet id ${s.id}`);
    if (s.id) snippetIds.add(s.id);
    if (s.symbol) allSnippetSymbols.add(s.symbol);
    for (const k of ['symbol', 'path', 'code', 'why']) if (!isStr(s[k])) err(sw, `missing ${k}`);
    if (s.path && !exists(path.join(PROTO, s.path))) warn(sw, `source path not in bundled prototype: ${s.path}`);
  }
  stats.snippets += (d.snippets || []).length;

  /* steps — the dynamic demo's integrity */
  const usedNodes = new Set(), usedStates = new Set(), usedCode = new Set();
  for (const [i, s] of (d.steps || []).entries()) {
    const sw = `${w}.steps[${i}]`;
    if (s.n !== i + 1) err(sw, `n should be ${i + 1}, got ${s.n}`);
    if (!nodeIds.has(s.from)) err(sw, `unknown from ${s.from}`);
    if (!nodeIds.has(s.to)) err(sw, `unknown to ${s.to}`);
    if (s.from) usedNodes.add(s.from);
    if (s.to) usedNodes.add(s.to);
    if (!KINDS.has(s.kind)) err(sw, `bad kind ${s.kind}`);
    for (const k of ['label', 'note', 'ref']) if (!isStr(s[k])) err(sw, `missing ${k}`);
    if (s.state) {
      if (!stateIds.has(s.state)) err(sw, `unknown state ${s.state}`);
      usedStates.add(s.state);
    }
    if (s.code) {
      if (!snippetIds.has(s.code)) err(sw, `unknown snippet ${s.code}`);
      usedCode.add(s.code);
    }
  }
  stats.steps += (d.steps || []).length;
  /* keep prose counts in sync with the actual data */
  const stepsClaim = /(\d+) 步流转/.exec(readme);
  const nodesClaim = /(\d+) 个模块/.exec(readme);
  const snippetsClaim = /(\d+) 个真实代码锚点/.exec(readme);
  if (stepsClaim && Number(stepsClaim[1]) !== d.steps.length) err(`${w}/README.md`, `says ${stepsClaim[1]} steps but data.js has ${d.steps.length}`);
  if (nodesClaim && Number(nodesClaim[1]) !== d.nodes.length) err(`${w}/README.md`, `says ${nodesClaim[1]} nodes but data.js has ${d.nodes.length}`);
  if (snippetsClaim && Number(snippetsClaim[1]) !== d.snippets.length) err(`${w}/README.md`, `says ${snippetsClaim[1]} snippets but data.js has ${d.snippets.length}`);
  /* coverage: every edge endpoint / state / snippet should be exercised */
  for (const n of nodeIds) if (!usedNodes.has(n)) warn(w, `node ${n} never appears in any step`);
  for (const s of stateIds) if (!usedStates.has(s)) warn(w, `state ${s} never highlighted by a step`);
  for (const s of snippetIds) if (!usedCode.has(s)) warn(w, `snippet ${s} never highlighted by a step`);

  /* glossaries / labs */
  for (const [i, g] of (d.glossary || []).entries()) {
    if (!isStr(g.term) || !isStr(g.desc)) err(`${w}.glossary[${i}]`, 'missing term/desc');
  }
  for (const [i, l] of (d.labs || []).entries()) {
    if (!isStr(l.title) || !isStr(l.goal) || !arr(l.steps)) err(`${w}.labs[${i}]`, 'missing title/goal/steps');
  }
  for (const [i, t] of (d.takeaways || []).entries()) if (!isStr(t)) err(`${w}.takeaways[${i}]`, 'empty');
  for (const [i, t] of (d.pitfalls || []).entries()) if (!isStr(t)) err(`${w}.pitfalls[${i}]`, 'empty');
}

for (const c of CURR) if (c && c.dir && exists(path.join(ROOT, c.dir))) checkLesson(c);

/* Each course names its prototype document; the popup needs it on disk so the
   build can inline it (docs/00x-*.md in dsh-superagent-prototype). */
for (const c of CURR) {
  if (!c || !c.doc) { err(c && c.id || 'curriculum', 'course has no doc'); continue; }
  if (!exists(path.join(ROOT, 'dsh-superagent-prototype', 'docs', c.doc))) {
    err(c.id, `missing prototype doc docs/${c.doc}`);
  }
}

/* --------------------------------------------------- 3.5 UML block catalog */
const UML_KINDS = new Set(['interface', 'class', 'type', 'function', 'port', 'data', 'external']);
const umlPath = path.join(ROOT, 'assets', 'uml.js');
if (exists(umlPath)) {
  const UML = runScript(read(umlPath), 'assets/uml.js').WAY2SA_UML;
  if (!isObj(UML)) err('assets/uml.js', 'WAY2SA_UML is not an object');
  else {
    for (const id of Object.keys(UML)) {
      const e = UML[id], w = `UML.${id}`;
      stats.uml++;
      if (!allNodeIds.has(id)) err(w, 'no flow-graph block has this id');
      if (!isObj(e)) { err(w, 'entry is not an object'); continue; }
      if (!UML_KINDS.has(e.k)) err(w, `bad stereotype ${e.k}`);
      if (!isStr(e.n)) err(w, 'missing symbol name n');
      if (!isStr(e.f)) err(w, 'missing source path f');
      if (e.f !== '—' && !exists(path.join(PROTO, e.f))) err(w, `source file not found: ${e.f}`);
      if (!Array.isArray(e.a) || !Array.isArray(e.m) || !Array.isArray(e.c)) err(w, 'a/m/c must be arrays');
      stats.umlMethods += (e.m || []).length;
      // The popup promises 主要代码, so every block must resolve to a real snippet.
      if (!(e.c || []).length) err(w, 'no code snippet reference (popup would show no 主要代码)');
      for (const sym of e.c || []) if (!allSnippetSymbols.has(sym)) err(w, `unknown snippet symbol ${sym}`);
      for (const m of e.m || []) if (!isStr(m)) err(w, 'empty method signature');
    }
    for (const id of allNodeIds) if (!UML[id]) err('assets/uml.js', `missing UML entry for node ${id}`);
  }
}

/* ------------------------------------- 4. generated artifacts + root HTML */
const rootHtml = exists(path.join(ROOT, 'index.html')) ? read(path.join(ROOT, 'index.html')) : '';
const rootMarkup = rootHtml.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
for (const m of rootMarkup.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  const ref = m[1];
  if (/^(https?:|data:|mailto:|javascript:)/i.test(ref)) continue;
  err('index.html', `external local resource (404 inside srcdoc): ${ref}`);
}
if (!rootHtml.includes('window.CURRICULUM')) err('index.html', 'course map does not read CURRICULUM');
if (!rootHtml.includes('class="map-card"')) err('index.html', 'course map cards were not inlined');

/* Every index.html is a build artifact: catch hand edits / stale output. */
let maxBytes = 0;
for (const t of targets()) {
  const expected = render(t);
  const p = path.join(ROOT, t.file);
  if (!exists(p)) err(t.file, 'generated file missing — run node tools/build.mjs');
  else if (read(p) !== expected) err(t.file, 'out of date — run node tools/build.mjs');
  // Shan's /api/files?type=read returns 256 KB chunks. A larger HTML preview
  // takes one extra download request (capped at HTML_PREVIEW_MAX_BYTES = 10 MB)
  // and still renders the same srcdoc, so only the hard cap is an error.
  const bytes = Buffer.byteLength(expected);
  maxBytes = Math.max(maxBytes, bytes);
  if (bytes >= 10 * 1024 * 1024) err(t.file, `${(bytes / 1024 / 1024).toFixed(1)} MB exceeds Shan's HTML_PREVIEW_MAX_BYTES (10 MB)`);
  if (!expected.includes('WAY2SA_DOCS')) err(t.file, 'README text was not inlined');
  if (!expected.includes('"tutorial"')) err(t.file, 'TUTORIAL text was not inlined');
  // 原型原文 opens in the same popup, so each course's docs/00x-*.md must ship.
  if (!expected.includes('"doc"')) err(t.file, 'prototype doc text was not inlined');
  if (!expected.includes('实验 A')) warn(t.file, 'no tutorial experiment text found in the generated document');
}

/* ------------------------------------------------------------------- report */
console.log('Way2SA curriculum validation');
console.log('─'.repeat(56));
console.log(`courses ${stats.lessons} · nodes ${stats.nodes} · edges ${stats.edges} · steps ${stats.steps}`);
console.log(`snippets ${stats.snippets} · states ${stats.states} · transitions ${stats.transitions}`);
console.log(`UML blocks ${stats.uml} · interface signatures ${stats.umlMethods} · largest page ${(maxBytes / 1024).toFixed(1)} KB`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const m of warnings) console.log('  ! ' + m);
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const m of errors) console.log('  x ' + m);
  process.exit(1);
}
console.log('\nOK: all 8 lessons, references, files and local resources are consistent.');
