#!/usr/bin/env node
/**
 * Way2SA DOM-sandbox smoke test (zero dependencies, no browser needed).
 *
 *   node tools/smoke.mjs
 *
 * Executes the INLINE SCRIPTS OF THE GENERATED index.html files — the exact
 * artifact Shan's content-view puts into `<iframe srcdoc sandbox="allow-scripts">`
 * — against a tiny fake DOM. Two environments are simulated:
 *
 *   standalone (file://)  storage works, window.top === window.self
 *   embedded   (Shan)     storage throws, window.top is a different object
 *
 * Then it drives the real controls: every dynamic step (asserting the floating
 * bar's counter + current-step label each time), play to the end, reset,
 * keyboard shortcuts, host Appearance theme (injected hint + postMessage flip,
 * OS fallback), speed, select/prev/next nav,
 * the in-place 讲义 / 教程 modals, a UML popup for EVERY graph block, step
 * jumps from that popup and from the event-log rows inside 模块与流转, and the
 * course map. Any exception fails the run.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { curriculum, targets } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CURR = curriculum();
const failures = [];
const read = p => fs.readFileSync(p, 'utf8');

/* --------------------------------------------------------------- fake DOM */
function makeDom(embedded, osDark) {
  const els = new Map();
  const frames = [];
  const timers = new Map();
  let timerId = 0;
  let fakeNow = 1000;
  let dark = !!osDark;
  let storageReads = 0;
  const mqListeners = [];
  const winHandlers = {};

  function el(id, className = '') {
    if (els.has(id)) return els.get(id);
    const e = {
      id, innerHTML: '', textContent: '', className, value: 0,
      style: {}, scrollTop: 0, scrollHeight: 0, handlers: {}, _attrs: {},
      addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
      setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'class') this.className = String(v); },
      getAttribute(k) { return k in this._attrs ? this._attrs[k] : (k === 'class' ? this.className : null); },
      appendChild() {}, removeChild() {},
      get parentNode() { return null; }
    };
    els.set(id, e);
    return e;
  }

  function register(markup) {
    const tagRe = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
    let m;
    while ((m = tagRe.exec(markup))) {
      const id = /\bid="([^"]+)"/.exec(m[2]);
      if (!id) continue;
      const cn = /\bclass="([^"]+)"/.exec(m[2]);
      const e = el(id[1]);
      // innerHTML replaced this node: its listeners are new, not accumulated.
      e.handlers = {};
      e.className = cn ? cn[1] : e.className;
    }
  }

  const document = {
    body: { className: '' },
    documentElement: { style: {} },
    handlers: {},
    getElementById(id) { return els.get(id) || null; },
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  };

  const localStorage = embedded
    ? { getItem() { storageReads++; throw new Error('SecurityError'); }, setItem() { storageReads++; throw new Error('SecurityError'); } }
    : { _v: {}, getItem(k) { storageReads++; return this._v[k] ?? null; }, setItem(k, v) { storageReads++; this._v[k] = String(v); } };

  const sandbox = {
    console, Math, JSON, document, localStorage,
    Date: { now: () => fakeNow },
    navigator: { userAgent: 'way2sa-smoke' },
    matchMedia(q) {
      return {
        media: q, get matches() { return dark; },
        addEventListener(type, fn) { if (type === 'change') mqListeners.push(fn); },
        addListener(fn) { mqListeners.push(fn); }
      };
    },
    addEventListener(type, fn) { (winHandlers[type] ||= []).push(fn); },
    requestAnimationFrame(cb) { frames.push(cb); return frames.length; },
    cancelAnimationFrame() {},
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  if (embedded) sandbox.top = { shan: true };
  vm.createContext(sandbox);

  /* html(id, value) writes element.innerHTML; intercept to register nested ids. */
  const originalGet = document.getElementById;
  const seen = new WeakSet();
  document.getElementById = function (id) {
    const e = originalGet.call(this, id);
    if (e && !seen.has(e)) {
      seen.add(e);
      let _html = e.innerHTML;
      Object.defineProperty(e, 'innerHTML', {
        get() { return _html; },
        set(v) { _html = String(v); register(_html); },
        configurable: true
      });
    }
    return e;
  };

  function dispatch(id, type, extra = {}) {
    const e = els.get(id);
    if (!e || !e.handlers[type]) return false;
    const ev = { target: e, preventDefault() {}, ...extra };
    // Snapshot: a real DOM does not invoke listeners added during dispatch.
    // Re-rendering a lesson rebinds topbar handlers onto these fake elements.
    for (const fn of e.handlers[type].slice()) fn(ev);
    return true;
  }
  function docDispatch(type, key) {
    const fns = (document.handlers[type] || []).slice();
    for (const fn of fns) fn({ key, preventDefault() {} });
    return fns.length > 0;
  }
  function winDispatch(type, data) {
    const fns = (winHandlers[type] || []).slice();
    for (const fn of fns) fn({ data });
    return fns.length > 0;
  }
  function flushFrames(max = 40) {
    for (let i = 0; i < max && frames.length; i++) {
      const batch = frames.splice(0, frames.length);
      fakeNow += 250;
      for (const cb of batch) cb(fakeNow);
    }
  }
  function flushTimers(max = 40) {
    for (let i = 0; i < max && timers.size; i++) {
      const batch = [...timers.entries()];
      timers.clear();
      for (const [, fn] of batch) fn();
      flushFrames();
    }
  }
  return {
    sandbox, els, el, register, dispatch, docDispatch, winDispatch,
    flushFrames, flushTimers,
    advance: ms => { fakeNow += ms; },
    storageReads: () => storageReads,
    setOsDark(v) { dark = !!v; for (const fn of mqListeners) fn({ matches: dark }); }
  };
}

function run(code, filename, sandbox) {
  try { vm.runInContext(code, sandbox, { filename, timeout: 5000 }); }
  catch (e) { failures.push(`${filename}: threw ${e.message}`); }
}

function assert(cond, msg) { if (!cond) failures.push(msg); }
const has = (dom, id) => dom.els.has(id);

/** Generated HTML has ONLY inline <script> blocks — no src=/href= at all. */
function bootHtml(file, embedded = false, osDark = false, hostTheme = null) {
  const html = read(path.join(ROOT, file));
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert(blocks.length >= 14, `${file}: expected >= 14 inline scripts, got ${blocks.length}`);
  // Look only at real markup: comments inside course.js quote example tags.
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  assert(!/<script[^>]*\bsrc=/i.test(markup), `${file}: still has an external <script src>`);
  assert(!/<link[^>]*\bhref=/i.test(markup), `${file}: still has an external <link href>`);
  assert(html.includes('<style>'), `${file}: CSS is not inlined`);
  assert(html.includes('WAY2SA_DOCS'), `${file}: README text is not inlined`);
  assert(html.includes('window.WAY2SA_UML'), `${file}: UML catalog is not inlined`);
  assert(html.includes('实验 A'), `${file}: TUTORIAL text is not inlined`);
  assert(html.includes('id="doc-modal"'), `${file}: 讲义 modal markup missing`);
  assert(html.includes('id="uml-modal"'), `${file}: UML modal markup missing`);

  const dom = makeDom(embedded, osDark);
  // Register ids from STATIC markup only (the modal lives outside #app).
  dom.register(html.replace(/<script[\s\S]*?<\/script>/g, ''));
  // Shan bakes `window.__SHAN_THEME__` into srcdoc BEFORE the page's scripts
  // boot. A host value that disagrees with the OS proves it takes precedence.
  if (hostTheme) dom.sandbox.__SHAN_THEME__ = hostTheme;
  blocks.forEach((code, i) => run(code, `${file}#script-${i + 1}`, dom.sandbox));
  return dom;
}

/** Re-run one data.js with a capture-only Course.boot to get the lesson object. */
function captureData(dom, c) {
  const S = dom.sandbox;
  const real = S.window.Course.boot;
  let data = null;
  S.window.Course.boot = d => { data = d; };
  run(read(path.join(ROOT, c.dir, 'data.js')), `${c.dir}/data.js`, S);
  S.window.Course.boot = real;
  return data;
}

/* --------------------------------------------------------- shared chrome */
function checkChrome(dom, w, isMap = false) {
  const topbar = dom.els.get('topbar')?.innerHTML || '';
  assert(topbar.includes('id="lesson-select"'), `${w}: topbar has no course <select>`);
  assert((topbar.match(/<option value="L0\d"/g) || []).length === 8,
    `${w}: course select does not list 8 lessons`);
  assert(topbar.includes('id="lesson-prev"') && topbar.includes('id="lesson-next"'),
    `${w}: prev/next buttons missing`);
  assert(!topbar.includes('id="chip-L01"'), `${w}: old eight-chip nav is still present`);
  // 讲义 / 教程 / 课程地图 moved to the FLOATING bar; 主题 is gone for good.
  for (const id of ['btn-readme', 'btn-tutorial', 'map-btn', 'theme-btn']) {
    assert(!topbar.includes('id="' + id + '"'), `${w}: ${id} is still in the topbar`);
  }
  const player = dom.els.get('player')?.innerHTML || '';
  assert(player.includes('id="btn-readme"'), `${w}: 讲义 is not on the floating bar`);
  assert(player.includes('id="btn-tutorial"'), `${w}: 教程 is not on the floating bar`);
  assert(player.includes('id="map-btn"'), `${w}: 课程地图 is not on the floating bar`);
  assert(!player.includes('id="theme-btn"'), `${w}: theme button was not removed`);
  assert(!dom.sandbox.document.getElementById('theme-btn')?.handlers?.click?.length,
    `${w}: theme toggle is still bound`);
  if (isMap) {
    assert(!player.includes('id="progress-wrap"'), `${w}: course map has no playback to track`);
    return;
  }
  // The step counter / slider / current step name belong on the FLOATING bar.
  for (const id of ['progress-wrap', 'progress', 'counter', 'step-brief']) {
    assert(player.includes('id="' + id + '"'), `${w}: ${id} is not on the floating bar`);
  }
  const app = dom.els.get('app')?.innerHTML || '';
  assert(app.includes('class="dynamic-board"'), `${w}: dynamic visuals are not grouped`);
  // Board must contain the graph, state machine, step detail and log together,
  // but NOT the progress controls (those moved up to the always-visible bar).
  const board = app.slice(app.indexOf('class="dynamic-board"'), app.indexOf('</section>'));
  for (const id of ['graph', 'machine', 'step-detail', 'log-list']) {
    assert(board.includes('id="' + id + '"'), `${w}: ${id} is outside the dynamic board`);
  }
  // The event log must be NESTED in the 模块与流转 card: after the graph,
  // before the right column starts, and never a separate bottom card.
  assert(board.includes('class="card flow-card"'), `${w}: 模块与流转 card marker missing`);
  assert(!board.includes('class="card log-panel"'),
    `${w}: event log is still a separate card under the viz-grid`);
  const g = board.indexOf('id="graph"'), l = board.indexOf('id="log-list"'), m = board.indexOf('id="machine"');
  assert(g >= 0 && l > g && l < m,
    `${w}: event log is not inside the 模块与流转 card (graph ${g}, log ${l}, machine ${m})`);
  assert(!board.includes('id="progress-wrap"'), `${w}: step progress is still stuck in the dynamic board`);
  assert(app.includes('class="player" id="player"'), `${w}: floating player missing`);
}

/** Initial state of the floating-bar step display. */
function checkProgress(dom, w, data) {
  const total = data.steps.length;
  assert((dom.els.get('counter')?.textContent || '').trim() === '0 / ' + total,
    `${w}: floating bar does not show the initial step count`);
  assert((dom.els.get('step-brief')?.textContent || '').trim() === '尚未开始',
    `${w}: floating bar does not show the initial step name`);
  assert(dom.els.has('progress'), `${w}: floating-bar progress slider missing`);
  assert(dom.dispatch('progress', 'input', { target: { value: '0' } }),
    `${w}: the floating-bar slider cannot jump to a step`);
}

function checkReadme(dom, w, expectTitle) {
  assert(dom.dispatch('btn-readme', 'click'), `${w}: 讲义 button has no click handler`);
  const modal = dom.els.get('doc-modal');
  assert(modal?.style.display === 'flex', `${w}: 讲义 modal did not open`);
  const body = dom.els.get('doc-body')?.innerHTML || '';
  assert(body.includes('<h1') || body.includes('<h2'), `${w}: README was not rendered as HTML`);
  assert((dom.els.get('doc-title')?.textContent || '').includes(expectTitle),
    `${w}: 讲义 shows the wrong lesson's README`);
  assert(!body.includes('<script'), `${w}: README HTML contains a script tag`);
  assert(dom.docDispatch('keydown', 'Escape'), `${w}: no keydown handler registered`);
  assert(modal.style.display === 'none', `${w}: Escape did not close the 讲义`);
  assert(dom.dispatch('btn-readme', 'click'), `${w}: 讲义 cannot reopen`);
  assert(dom.dispatch('doc-close', 'click'), `${w}: ✕ has no click handler`);
  assert(dom.els.get('doc-modal').style.display === 'none', `${w}: ✕ did not close the 讲义`);
}

function checkTutorial(dom, w) {
  assert(dom.dispatch('btn-tutorial', 'click'), `${w}: 教程 button has no click handler`);
  const modal = dom.els.get('doc-modal');
  assert(modal?.style.display === 'flex', `${w}: 教程 modal did not open`);
  const body = dom.els.get('doc-body')?.innerHTML || '';
  assert(body.includes('源码地图') && body.includes('实验 A'),
    `${w}: TUTORIAL.md was not rendered in the modal`);
  assert((dom.els.get('doc-title')?.textContent || '').includes('TUTORIAL.md'),
    `${w}: 教程 modal has the wrong title`);
  assert(!body.includes('<script'), `${w}: tutorial HTML contains a script tag`);
  assert(dom.dispatch('doc-close', 'click'), `${w}: ✕ has no click handler`);
  assert(modal.style.display === 'none', `${w}: ✕ did not close the 教程`);
}

function checkDocPopup(dom, w, doc) {
  // 原型原文 is inlined, so the footer chip opens it in place in BOTH modes.
  assert(dom.dispatch('hero-doc', 'click'), `${w}: 原型原文 chip has no click handler`);
  const modal = dom.els.get('doc-modal');
  assert(modal?.style.display === 'flex', `${w}: 原型原文 did not open the popup`);
  const body = dom.els.get('doc-body')?.innerHTML || '';
  assert(body.length > 400, `${w}: 原型原文 rendered empty`);
  assert(!body.includes('<script'), `${w}: prototype doc HTML contains a script tag`);
  assert((dom.els.get('doc-title')?.textContent || '').includes(doc),
    `${w}: 原型原文 popup has the wrong title`);
  assert(dom.dispatch('doc-close', 'click'), `${w}: ✕ has no click handler`);
  assert(modal.style.display === 'none', `${w}: ✕ did not close 原型原文`);
}

function checkUml(dom, w, data) {
  const UML = dom.sandbox.WAY2SA_UML || {};
  // EVERY block in the lesson must open a grounded UML popup, not just a sample.
  // (A node's own `c` list decides whether real prototype code is expected.)
  for (const n of data.nodes) {
    assert(dom.dispatch('nd-' + n.id, 'click'), `${w}: node nd-${n.id} has no click handler`);
    const modal = dom.els.get('uml-modal');
    assert(modal?.style.display === 'flex', `${w}: UML popup did not open for ${n.id}`);
    const title = dom.els.get('uml-title')?.textContent || '';
    assert(title.includes(n.label) && title.includes('«'), `${w}: wrong UML title for ${n.id}: ${title}`);
    const body = dom.els.get('uml-body')?.innerHTML || '';
    assert(body.includes('<svg') && body.includes('uml-box'), `${w}: ${n.id} has no UML class diagram`);
    assert(body.includes('字段 / 属性') && body.includes('接口函数 / 方法'),
      `${w}: ${n.id} class box is missing compartments`);
    assert(body.includes('主要代码') && body.includes('接口函数'),
      `${w}: ${n.id} popup lacks the code / interface sections`);
    if ((UML[n.id]?.c || []).length) {
      assert(body.includes('uml-code'), `${w}: ${n.id} did not reuse the real prototype snippet`);
    }
    assert(!body.includes('<script'), `${w}: UML HTML contains a script tag`);
    assert(dom.dispatch('uml-close', 'click'), `${w}: UML ✕ has no click handler`);
    assert(modal.style.display === 'none', `${w}: UML ✕ did not close the popup`);
  }
  // A step button jumps playback; Escape closes the popup as well.
  const jumpNode = data.nodes.find(n => data.steps.some(s => s.from === n.id || s.to === n.id)) || data.nodes[0];
  assert(dom.dispatch('nd-' + jumpNode.id, 'click'), `${w}: cannot reopen UML for a step jump`);
  assert((dom.els.get('uml-body')?.innerHTML || '').includes('id="uml-step-0"'),
    `${w}: UML popup has no step jump buttons`);
  assert(dom.dispatch('uml-step-0', 'click'), `${w}: UML step button has no click handler`);
  assert(dom.els.get('uml-modal').style.display === 'none', `${w}: step jump did not close UML`);
  assert((dom.els.get('step-detail')?.innerHTML || '').includes('step-no'),
    `${w}: step jump did not render a step`);
  assert(dom.dispatch('nd-' + jumpNode.id, 'click'), `${w}: cannot reopen UML for Escape`);
  assert(dom.docDispatch('keydown', 'Escape'), `${w}: no keydown handler registered`);
  assert(dom.els.get('uml-modal').style.display === 'none', `${w}: Escape did not close UML`);
}

function checkTheme(dom, w, embedded, osDark, hostTheme) {
  const S = dom.sandbox;
  const cls = t => (t === 'dark' ? 'dark' : '');
  const os = osDark ? 'dark' : 'light';
  // On load: Shan's Settings > Appearance (baked into srcdoc) wins over the OS;
  // a standalone file:// with no host falls back to prefers-color-scheme.
  const initial = hostTheme || os;
  assert(S.document.body.className === cls(initial),
    `${w}: background did not follow the host Appearance on load (host=${hostTheme}, os=${os})`);
  assert(S.document.documentElement.style.colorScheme === initial,
    `${w}: color-scheme did not follow the host Appearance`);
  // A live flip in Settings > Appearance is delivered by postMessage.
  const flipped = initial === 'dark' ? 'light' : 'dark';
  assert(dom.winDispatch('message', { shanTheme: flipped }),
    `${w}: no host theme message listener (srcdoc frame cannot read the parent DOM)`);
  assert(S.document.body.className === cls(flipped),
    `${w}: a live Appearance flip was ignored`);
  assert(S.document.documentElement.style.colorScheme === flipped,
    `${w}: color-scheme did not follow the live Appearance flip`);
  // The OS must NOT override an explicit Appearance setting.
  dom.setOsDark(!osDark);
  assert(S.document.body.className === cls(flipped), `${w}: OS overrode the host Appearance`);
  dom.setOsDark(osDark);
  // "auto" hands control back to the OS (Shan resolves auto from the system).
  assert(dom.winDispatch('message', { shanTheme: 'auto' }), `${w}: auto message not accepted`);
  assert(S.document.body.className === cls(os), `${w}: auto did not restore the OS value`);
  // The other host channel used by non-Shan embedders still works.
  assert(dom.winDispatch('message', { way2saTheme: flipped }), `${w}: way2saTheme channel missing`);
  assert(S.document.body.className === cls(flipped), `${w}: way2saTheme was ignored`);
  dom.winDispatch('message', { shanTheme: 'auto' });
  // No in-page control, nothing persisted — even where storage throws.
  assert(!dom.dispatch('theme-btn', 'click'), `${w}: theme button is still bound (embedded=${embedded})`);
  assert(dom.storageReads() === 0, `${w}: renderer still depends on localStorage`);
}

/* ------------------------------------------------------------ lesson runner */
function smokeLesson(c, embedded, osDark, hostTheme = null) {
  const dom = bootHtml(`${c.dir}/index.html`, embedded, osDark, hostTheme);
  const w = c.id + (embedded ? '/shan' : '/file');
  const data = captureData(dom, c);
  if (!data) { failures.push(`${w}: lesson data was not registered`); return; }

  const check = (id, label) => assert(has(dom, id) && dom.els.get(id).innerHTML.length > 0,
    `${w}: ${label} (#${id}) not rendered`);
  for (const [id, label] of [
    ['topbar', 'topbar'], ['hero', 'hero'], ['graph', 'graph'], ['machine', 'machine'],
    ['code', 'code cards'], ['notes', 'notes'], ['player', 'player'],
    ['step-detail', 'step detail'], ['log-list', 'log']
  ]) check(id, label);
  checkChrome(dom, w);
  checkProgress(dom, w, data);

  const graph = dom.els.get('graph')?.innerHTML || '';
  assert(graph.includes('<svg'), `${w}: graph has no <svg>`);
  assert(graph.includes('id="packet"'), `${w}: graph has no animated packet`);
  assert((dom.els.get('hero')?.innerHTML || '').includes(data.title),
    `${w}: hero does not show the initial lesson`);
  if (embedded) {
    const hero = dom.els.get('hero')?.innerHTML || '';
    assert(!/<a class="chip" href=/.test(hero), `${w}: embedded mode still renders navigable links`);
    assert(hero.includes('沙箱预览'), `${w}: embedded-mode hint missing`);
  }

  for (const n of data.nodes) assert(has(dom, 'nd-' + n.id), `${w}: missing node nd-${n.id}`);
  for (const s of data.states.nodes) assert(has(dom, 'sm-' + s.id), `${w}: missing state sm-${s.id}`);
  for (const s of data.snippets) assert(has(dom, 'cc-' + s.id), `${w}: missing code card cc-${s.id}`);
  for (let i = 0; i < data.steps.length; i++) assert(has(dom, 'fp-' + i), `${w}: missing flow path fp-${i}`);

  /* click flow-graph blocks → UML popup, code, interface functions, step jump */
  checkUml(dom, w, data);

  /* single-step through EVERY step */
  for (let i = 0; i < data.steps.length; i++) {
    assert(dom.dispatch('progress', 'input', { target: { value: String(i) } }),
      `${w}: #progress has no input handler`);
    dom.flushFrames();
    assert((dom.els.get('step-detail')?.innerHTML || '').includes(String(data.steps[i].n)),
      `${w}: step ${i + 1} detail not rendered`);
    assert((dom.els.get('nd-' + data.steps[i].from)?.className || '').includes('active'),
      `${w}: step ${i + 1} source not highlighted`);
    assert((dom.els.get('nd-' + data.steps[i].to)?.className || '').includes('target'),
      `${w}: step ${i + 1} target not highlighted`);
    assert(dom.els.get('packet')?.style.opacity === 1, `${w}: step ${i + 1} packet not shown`);
    // The floating bar must report exactly which step is on screen.
    assert((dom.els.get('counter')?.textContent || '').trim() === `${i + 1} / ${data.steps.length}`,
      `${w}: floating bar shows the wrong step number at step ${i + 1}`);
    assert((dom.els.get('step-brief')?.textContent || '').trim() === data.steps[i].label,
      `${w}: floating bar shows the wrong step name at step ${i + 1}`);
    assert(dom.els.get('step-brief')?.title === data.steps[i].label,
      `${w}: ellipsised step name has no full-text tooltip at step ${i + 1}`);
  }
  assert(((dom.els.get('log-list')?.innerHTML || '').match(/class="log-row/g) || []).length === data.steps.length,
    `${w}: event log row count is wrong`);
  // The log is inside 模块与流转: every row is a jump back into the flow above.
  const logJump = Math.min(3, data.steps.length - 1);
  assert(dom.dispatch('log-r' + logJump, 'click'), `${w}: event log row has no click handler`);
  dom.flushFrames();
  assert((dom.els.get('counter')?.textContent || '').trim() === `${logJump + 1} / ${data.steps.length}`,
    `${w}: clicking a log row did not jump the flow to that step`);
  assert((dom.els.get('step-brief')?.textContent || '').trim() === data.steps[logJump].label,
    `${w}: log-row jump did not update the current step name`);

  /* play to the end */
  assert(dom.dispatch('btn-reset', 'click'), `${w}: #btn-reset has no click handler`);
  assert((dom.els.get('step-detail')?.innerHTML || '').includes('empty-state'), `${w}: reset did not clear step`);
  assert((dom.els.get('counter')?.textContent || '').trim() === '0 / ' + data.steps.length,
    `${w}: reset did not clear the floating-bar counter`);
  assert((dom.els.get('step-brief')?.textContent || '').trim() === '尚未开始',
    `${w}: reset did not clear the floating-bar step name`);
  assert(dom.dispatch('btn-play', 'click'), `${w}: #btn-play has no click handler`);
  for (let i = 0; i < data.steps.length + 6; i++) { dom.flushFrames(); dom.flushTimers(); dom.advance(1000); }
  assert((dom.els.get('btn-play')?.textContent || '').includes('播放'), `${w}: playback did not stop at the end`);

  /* keyboard + speed + prev/next step */
  assert(dom.docDispatch('keydown', ' '), `${w}: no keydown handler registered`);
  for (const k of ['s', 'r', 'ArrowRight', 'ArrowLeft']) assert(dom.docDispatch('keydown', k), `${w}: keydown ${k} failed`);
  dom.flushFrames();
  for (const id of ['btn-prev', 'btn-next', 'btn-reset']) assert(dom.dispatch(id, 'click'), `${w}: #${id} has no click handler`);
  assert(dom.dispatch('speed', 'change', { target: { value: '2' } }), `${w}: #speed has no change handler`);

  /* select + ◀/▶ navigation, and the 讲义 popup */
  const nextPos = (CURR.findIndex(x => x.id === c.id) + 1) % CURR.length;
  assert(dom.dispatch('lesson-select', 'change', { target: { value: CURR[nextPos].id } }),
    `${w}: course select has no change handler`);
  assert((dom.els.get('hero')?.innerHTML || '').includes(CURR[nextPos].title),
    `${w}: select did not switch lesson in-page`);
  let currentId = CURR[nextPos].id;
  if (nextPos > 0) {
    assert(dom.dispatch('lesson-prev', 'click'), `${w}: ◀ has no click handler`);
    currentId = CURR[nextPos - 1].id;
    assert((dom.els.get('hero')?.innerHTML || '').includes(CURR[nextPos - 1].title), `${w}: ◀ did not go back`);
  } else {
    assert((dom.els.get('topbar')?.innerHTML || '').includes('id="lesson-prev" type="button" title="上一课" disabled'),
      `${w}: ◀ should be disabled on the first lesson`);
  }
  checkReadme(dom, w, currentId);
  checkTutorial(dom, w);
  checkDocPopup(dom, w, (CURR.find(x => x.id === currentId) || c).doc);
  checkTheme(dom, w, embedded, osDark, hostTheme);

  /* course map round trip */
  assert(dom.dispatch('map-btn', 'click'), `${w}: #map-btn has no click handler`);
  assert((dom.els.get('app')?.innerHTML || '').match(/class="map-card"/g)?.length === 8,
    `${w}: course map did not render 8 cards in-page`);
  assert(dom.dispatch('map-' + c.id, 'click'), `${w}: map-${c.id} has no click handler`);
  assert((dom.els.get('hero')?.innerHTML || '').includes(data.title), `${w}: map did not restore ${c.id}`);

  console.log(`  ${w.padEnd(12)} ✓ ${data.nodes.length} nodes / ${data.steps.length} steps / nav + 讲义 + 教程 + UML + 悬浮栏进度`);
}

/* ------------------------------------------------------------- course map */
function smokeCourseMap(embedded, osDark, hostTheme = null) {
  const dom = bootHtml('index.html', embedded, osDark, hostTheme);
  const label = 'map' + (embedded ? '/shan' : '/file');
  const mapHtml = dom.els.get('app')?.innerHTML || '';
  assert((mapHtml.match(/class="map-card"/g) || []).length === 8,
    `${label}: expected 8 course cards`);
  for (const c of CURR) {
    assert(mapHtml.includes('id="map-' + c.id + '"'), `${label}: missing card ${c.id}`);
    assert(mapHtml.includes('docs/' + c.doc), `${label}: missing doc label ${c.doc}`);
  }
  checkChrome(dom, label, true);
  assert(dom.dispatch('btn-readme', 'click'), `${label}: 讲义 has no click handler`);
  assert((dom.els.get('doc-body')?.innerHTML || '').includes('Way2SA'),
    `${label}: root README did not render in the modal`);
  assert(dom.dispatch('btn-tutorial', 'click'), `${label}: 教程 has no click handler`);
  assert((dom.els.get('doc-body')?.innerHTML || '').includes('代码教程索引'),
    `${label}: tutorial index did not render in the modal`);
  dom.dispatch('doc-close', 'click');
  assert(dom.dispatch('map-L01', 'click'), `${label}: map-L01 has no click handler`);
  assert((dom.els.get('graph')?.innerHTML || '').includes('<svg'), `${label}: L01 graph missing`);
  assert(dom.dispatch('map-btn', 'click'), `${label}: cannot return to the map`);
  checkTheme(dom, label, embedded, osDark, hostTheme);
  console.log(`  ${label.padEnd(12)} ✓ 8 cards / 讲义 / open lesson / back`);
}

console.log('Way2SA DOM smoke test (generated self-contained HTML)');
console.log('─'.repeat(72));
try { smokeCourseMap(false, false); } catch (e) { failures.push(`index.html(file): uncaught ${e.stack || e.message}`); }
// Shan embedded with OS=dark but Appearance=light: the host must win.
try { smokeCourseMap(true, true, 'light'); } catch (e) { failures.push(`index.html(shan): uncaught ${e.stack || e.message}`); }
for (const c of CURR) {
  const embedded = c.id === 'L01' || c.id === 'L08';
  const osDark = c.id === 'L05';
  // An injected host theme that CONTRADICTS the OS proves the bridge is live.
  const hostTheme = embedded ? (osDark ? 'light' : 'dark') : null;
  try { smokeLesson(c, embedded, osDark, hostTheme); }
  catch (e) { failures.push(`${c.id}: uncaught ${e.stack || e.message}`); }
}
// Opposite-mode passes prove both branches of storage and the media query.
try { smokeLesson(CURR[0], false, true); } catch (e) { failures.push(`L01/file: uncaught ${e.stack || e.message}`); }
try { smokeLesson(CURR[7], false, false); } catch (e) { failures.push(`L08/file: uncaught ${e.stack || e.message}`); }
// A lesson page inside Shan where Appearance=light and the OS is dark.
try { smokeLesson(CURR[2], true, true, 'light'); } catch (e) { failures.push(`L03/shan: uncaught ${e.stack || e.message}`); }

if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  const seen = new Set();
  for (const f of failures) { if (seen.has(f)) continue; seen.add(f); console.log('  x ' + f); }
  process.exit(1);
}
console.log(`\nOK: ${targets().length} generated pages booted in both environments; every step animated with the floating-bar counter in sync, every graph block opened a UML popup, event-log rows jumped back into the flow; 讲义 / 教程, host Appearance theme (with OS fallback) and map switching ran without runtime errors.`);
