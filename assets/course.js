(function () {
  'use strict';

  /* Graph geometry. The SVG scales to the card's width, so legibility is the
     ratio of these numbers to viewW/viewH: bigger boxes + bigger labels only
     help if the viewBox does not grow at the same rate. PAD_X/PAD_Y stay small
     (lane captions live above their row, not in the left gutter) and COL_GAP
     only just clears NODE_W, so a 5x5 lesson renders its labels at ~0.9 of
     their nominal size instead of ~0.6. */
  var NODE_W = 158, NODE_H = 66, COL_GAP = 188, ROW_GAP = 106, PAD_X = 24, PAD_Y = 52;
  /* Fixed rendered width of the diagram frame. The viewBox is ~988 units wide,
     so 760px is a constant ~0.77 scale: the diagram no longer grows when a
     sidebar is collapsed, which used to re-render it 30% larger. Anything
     narrower than this still scales down to fit — that cannot be avoided. */
  var GRAPH_MAX_W = 760;
  /* Text is measured, not guessed: a 158px box only holds ~148px of type, and
     "SQLite · generated col" overflows at 13px. Widths follow the usual CJK
     (1em) vs Latin (~0.56em) split and pick the first size that fits. */
  function charW(ch) {
    return /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.56;
  }
  function textW(str, size) {
    var w = 0, s = String(str || '');
    for (var i = 0; i < s.length; i++) w += charW(s.charAt(i)) * size;
    return w;
  }
  function fitSize(str, maxW, sizes) {
    for (var i = 0; i < sizes.length; i++) if (textW(str, sizes[i]) <= maxW) return sizes[i];
    return sizes[sizes.length - 1];
  }
  function titleSize(label) { return fitSize(label, NODE_W - 14, [18, 16, 14, 12]); }
  function subSize(sub) { return fitSize(sub, NODE_W - 12, [14, 13, 12, 11]); }
  var CURR = window.CURRICULUM || [];
  var BY_ID = window.CURRICULUM_BY_ID || {};
  // One grounded UML entry per unique graph block (assets/uml.js).
  var UML = window.WAY2SA_UML || {};

  /*
   * Shan's content-view renders an HTML file as
   *   <iframe srcDoc={PREVIEW_BRIDGE + html} sandbox="allow-scripts">
   * Two consequences this file is built around:
   *   - a srcdoc document inherits the APP's base URL, not the file's folder,
   *     so <link href="../assets/x.css"> and <script src="data.js"> 404.
   *     tools/build.mjs therefore inlines every asset into one document.
   *   - a sandboxed frame has an opaque origin and cannot navigate its parent,
   *     so course switching is an in-page button, never a link.
   */
  var EMBEDDED = (function () {
    try { return window.self !== window.top; } catch (e) { return true; }
  })();
  // Prefix for the few links that ARE safe in standalone (file://) mode.
  var BASE = window.WAY2SA_BASE || '';

  var S = {
    data: null, lessons: {}, view: 'map', keysBound: false,
    docKind: null, umlId: null, umlSteps: [],
    index: -1, playing: false, speed: 1,
    raf: null, timer: null, paths: [], viewW: 1000, viewH: 400
  };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(id) { return document.getElementById(id); }
  function html(id, value) { var el = $(id); if (el) el.innerHTML = value; }
  function cls(id, value) {
    var el = $(id); if (!el) return;
    if (el.setAttribute) el.setAttribute('class', value);
    else el.className = value;
  }
  function addClass(id, base, extra) { cls(id, extra ? base + ' ' + extra : base); }
  function nodeBase(n) {
    var kind = n.kind === 'kernel' ? ' kernel' : (n.kind === 'host' ? ' host' : (n.kind === 'human' ? ' human' : ''));
    return 'node' + kind + (n.carry ? ' carry' : '');
  }
  function now() { return Date.now ? Date.now() : new Date().getTime(); }
  function raf(cb) {
    if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(cb);
    return setTimeout(function () { cb(now()); }, 16);
  }
  function cancelRaf(id) {
    if (id == null) return;
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(id);
    else clearTimeout(id);
  }
  /*
   * THEME — follow the HOST APP's Settings > Appearance, with the OS as the
   * fallback. Shan writes its resolved Appearance as `<html class="dark">`, but
   * the HTML preview is `srcdoc + sandbox="allow-scripts"`: an opaque origin,
   * so the frame cannot read the parent DOM (and localStorage throws). The host
   * therefore hands the value down twice:
   *   1. as `window.__SHAN_THEME__` baked into srcdoc BEFORE this script runs —
   *      correct on the very first paint, no light flash in a dark app;
   *   2. as `postMessage({ shanTheme: 'dark' | 'light' })` — a live flip while
   *      the preview is open, without reloading the frame/lesson playback.
   * `WAY2SA_PARENT_THEME` / `way2saTheme` are the same channel for other hosts.
   * `auto` hands control back to `prefers-color-scheme`, which is also what a
   * stand-alone `file://` open uses (no host, no hint). No in-page control, no
   * persisted choice.
   */
  var colorQuery = null, parentTheme = null;
  try { colorQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null; }
  catch (e) {}

  function osTheme() { return colorQuery && colorQuery.matches ? 'dark' : 'light'; }
  function resolvedTheme() {
    if (parentTheme === 'dark' || parentTheme === 'light') return parentTheme;
    if (parentTheme === 'auto') return osTheme();
    // A hint injected into the srcdoc document wins over the OS. Shan resolves
    // its "auto" Appearance from the OS and republishes on every change below.
    var hint = window.WAY2SA_PARENT_THEME || window.__SHAN_THEME__;
    if (hint === 'dark' || hint === 'light') return hint;
    return osTheme();
  }
  function applyTheme() {
    var t = resolvedTheme();
    if (document.body) document.body.className = t === 'dark' ? 'dark' : '';
    if (document.documentElement && document.documentElement.style) {
      document.documentElement.style.colorScheme = t;
    }
    return t;
  }
  function watchThemePreference() {
    if (colorQuery) {
      var onChange = function () { applyTheme(); };
      try {
        if (colorQuery.addEventListener) colorQuery.addEventListener('change', onChange);
        else if (colorQuery.addListener) colorQuery.addListener(onChange);
      } catch (e) {}
    }
    try {
      window.addEventListener('message', function (e) {
        var d = e && e.data;
        if (!d || typeof d !== 'object') return;
        var t = d.shanTheme || d.way2saTheme || d.theme;
        if (t !== 'dark' && t !== 'light' && t !== 'auto') return;
        parentTheme = t;
        applyTheme();
      });
    } catch (e) {}
  }
  /* A file link is clickable only outside a sandbox: a srcdoc preview resolves
     relative hrefs against the host app's origin (sa-lessons hit exactly this).
     Inside one, the README becomes an in-place popup and other files are labels.
     The prototype docs are inlined too, so `doc` is a popup in BOTH modes. */
  function fileLink(label, href, hint, docKind) {
    if (EMBEDDED || docKind === 'doc') {
      return docKind
        ? '<button type="button" class="chip" title="' + esc(hint || '') + '" id="hero-' + esc(docKind) + '">' + esc(label) + '</button>'
        : '<span class="chip static" title="' + esc(hint || '') + '">' + esc(label) + '</span>';
    }
    return '<a class="chip" href="' + esc(href) + '">' + esc(label) + '</a>';
  }
  function switchChip(label, id) {
    return '<button type="button" class="chip" id="go-' + esc(id) + '">' + esc(label) + '</button>';
  }
  /* Lesson files sit in lessons/<slug>/; from the root map they need a prefix. */
  function lessonFile(name) {
    if (BASE) return name;
    var meta = S.data ? BY_ID[S.data.id] : null;
    return (meta && meta.dir ? meta.dir + '/' : '') + name;
  }

  /* ── 讲义弹窗 ────────────────────────────────────────────────────────────
     README.md is inlined by tools/build.mjs and rendered IN PLACE. No link can
     leave the sandbox; relative markdown links are drawn as dead code labels. */
  function mdInline(text) {
    var t = esc(text), codes = [];
    t = t.replace(/`([^`]+)`/g, function (_, code) {
      codes.push('<code>' + code + '</code>');
      return '\u0001' + (codes.length - 1) + '\u0001';
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
      return /^(https?:|mailto:|#)/i.test(href)
        ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
        : '<code class="md-deadlink">' + label + '</code>';
    });
    return t.replace(/\u0001(\d+)\u0001/g, function (_, i) { return codes[Number(i)]; });
  }
  function mdToHtml(md) {
    if (!md || !md.trim()) return '<p class="md-empty">（这一课没有 README.md）</p>';
    var lines = String(md).replace(/\r/g, '').split('\n'), out = [], list = null, i = 0;
    function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }
    function openList(tag) { if (list !== tag) { closeList(); out.push('<' + tag + '>'); list = tag; } }
    function cells(s) {
      return s.trim().replace(/^\||\|$/g, '').split('|').map(function (x) { return x.trim(); });
    }
    while (i < lines.length) {
      var line = lines[i];
      if (/^\s*```/.test(line)) {
        closeList(); var buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push('<pre class="md-code"><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (!line.trim()) { closeList(); i++; continue; }
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        closeList(); var lvl = Math.min(h[1].length, 4);
        out.push('<h' + lvl + '>' + mdInline(h[2]) + '</h' + lvl + '>'); i++; continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); i++; continue; }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        closeList();
        var head = cells(line); i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        var tbl = '<table><thead><tr>', k, r, c;
        for (k = 0; k < head.length; k++) tbl += '<th>' + mdInline(head[k]) + '</th>';
        tbl += '</tr></thead><tbody>';
        for (r = 0; r < rows.length; r++) {
          tbl += '<tr>';
          for (c = 0; c < head.length; c++) tbl += '<td>' + mdInline(rows[r][c] || '') + '</td>';
          tbl += '</tr>';
        }
        out.push(tbl + '</tbody></table>');
        continue;
      }
      var bq = /^\s*>\s?(.*)$/.exec(line);
      if (bq) { closeList(); out.push('<blockquote>' + mdInline(bq[1]) + '</blockquote>'); i++; continue; }
      var ul = /^\s*[-*+]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) { openList(ul ? 'ul' : 'ol'); out.push('<li>' + mdInline((ul || ol)[1]) + '</li>'); i++; continue; }
      closeList();
      out.push('<p>' + mdInline(line) + '</p>');
      i++;
    }
    closeList();
    return out.join('\n');
  }
  /* The map has no README of its own to inline; its 讲义 is the live registry,
     so it cannot drift from curriculum.js and costs no bytes in the document. */
  function mapReadme() {
    var lines = [
      '# Way2SA · 课程地图', '',
      '八门课对应 `dsh-superagent-prototype/docs/001-domain.md` → `008-cookbook.md`。一门课一篇文档，顺序即递进顺序。', '',
      '| 课 | 文档 | 主题 | 承接 |', '|---|---|---|---|'
    ], i;
    for (i = 0; i < CURR.length; i++) {
      var c = CURR[i];
      lines.push('| ' + c.id + ' | `' + c.doc + '` | ' + c.title + ' · ' + c.tag +
        ' | ' + (c.buildsOn || '起点') + ' |');
    }
    lines.push('', '## 怎么用', '',
      '- 点任意课程卡片，或用顶部选择框与 `◀` / `▶`，在本页内切换课程。',
      '- 每课点「讲义」就地看 `README.md`；`TUTORIAL.md` 与原型原文请在文件树里打开。',
      '- 悬浮栏常驻显示「第几步 / 共几步」与当前步骤名，拖动进度条可跳步；事件日志嵌在「模块与流转」卡片里，点任一条可跳回那一步。',
      '- 点流转图里任意模块，弹出它的 UML 类框、主要代码与接口函数。',
      '- 悬浮栏的「讲义」「教程」就地弹窗；`Space` 播放 / `S` 单步 / `R` 重置 / `←→` 步进 / `Esc` 关弹窗。',
      '', '> 后课的框架图沿用前课模块：淡色块 = 承接，实色块 = 本课新增。');
    return lines.join('\n');
  }
  /* The map has no TUTORIAL.md of its own; its 教程 is an index built from the
     eight inlined tutorials, so the button does something useful there too. */
  function mapTutorial() {
    var docs = window.WAY2SA_DOCS || {}, lines = [
      '# Way2SA · 代码教程索引', '',
      '八门课各有一份 `TUTORIAL.md`：逐段拆原型真实源码（路径 + 符号 + 抄录片段），末尾两个可直接 `node` 运行的纯 JS 实验。', ''
    ], i, j;
    for (i = 0; i < CURR.length; i++) {
      var c = CURR[i], text = (docs[c.id] && docs[c.id].tutorial) || '';
      var heads = text.split('\n').filter(function (l) { return /^##\s+/.test(l); })
        .map(function (l) { return l.replace(/^##\s+/, '').trim(); });
      lines.push('## ' + c.id + ' · ' + c.title, '', '对应文档：`' + c.doc + '`', '');
      for (j = 0; j < heads.length; j++) lines.push('- ' + heads[j]);
      lines.push('', '> 用顶部选择框进入这一课，再点悬浮栏「教程」看全文。', '');
    }
    return lines.join('\n');
  }
  function currentDoc(kind) {
    if (kind !== 'readme' && kind !== 'tutorial' && kind !== 'doc') return '';
    if (S.view === 'map') return kind === 'tutorial' ? mapTutorial() : mapReadme();
    var id = S.data && S.data.id;
    var entry = id && (window.WAY2SA_DOCS || {})[id];
    return entry ? (entry[kind] || '') : '';
  }
  function docName(kind) {
    if (kind === 'tutorial') return 'TUTORIAL.md · 代码教程';
    if (kind === 'doc') return ((S.data && S.data.doc) || '原型原文') + ' · 原型原文';
    return 'README.md · 讲义';
  }
  function openDoc(kind) {
    var modal = $('doc-modal'), body = $('doc-body'), title = $('doc-title');
    if (!modal || !body) return;
    closeUml();
    var text = currentDoc(kind);
    body.innerHTML = text
      ? mdToHtml(text)
      : '<div class="md-empty">这一课的原文没有内联进本页。</div>';
    if (title) {
      title.textContent = (S.view === 'map' ? '课程总览' : (S.data.id + ' · ' + S.data.title)) + ' · ' + docName(kind);
    }
    modal.style.display = 'flex';
    body.scrollTop = 0;
    S.docKind = kind;
  }
  function closeDoc() { var m = $('doc-modal'); if (m) m.style.display = 'none'; S.docKind = null; }
  function toggleDoc(kind) {
    var m = $('doc-modal');
    if (m && m.style.display === 'flex' && S.docKind === kind) closeDoc();
    else openDoc(kind);
  }
  function bindStaticChrome() {
    bind('doc-close', 'click', closeDoc);
    bind('doc-modal', 'click', function (e) {
      if (e.target === $('doc-modal')) closeDoc();
    });
    // The UML popup shares the modal conventions but has its own element, so
    // opening a 讲义 never leaves a stale class diagram behind, and vice versa.
    bind('uml-close', 'click', closeUml);
    bind('uml-modal', 'click', function (e) {
      if (e.target === $('uml-modal')) closeUml();
    });
  }

  /* ── UML：点流转图里任一模块，弹出它的类框 + 主要代码 + 接口函数 ──────────
     sa-lessons/diagrams.html does the same with a .uml-card. Here the class
     box is a real three-compartment SVG diagram with up to three neighbours,
     and the code is REUSED from the already-inlined lesson snippets (never a
     second copy of the source). Everything else — relations and the steps the
     block takes part in — is derived from this lesson's edges/steps. */
  function umlStereo(k) {
    return k === 'interface' ? '«interface»'
      : k === 'class' ? '«class»'
      : k === 'type' ? '«type»'
      : k === 'function' ? '«function»'
      : k === 'port' ? '«port»'
      : k === 'data' ? '«data»' : '«external»';
  }
  function umlCut(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function snippetBySymbol(sym) {
    var order = [], id, i, j, list;
    if (S.data) order.push(S.data);
    for (id in S.lessons) {
      if (Object.prototype.hasOwnProperty.call(S.lessons, id) && S.lessons[id] !== S.data) order.push(S.lessons[id]);
    }
    for (i = 0; i < order.length; i++) {
      list = order[i].snippets || [];
      for (j = 0; j < list.length; j++) if (list[j].symbol === sym) return { s: list[j], lesson: order[i].id };
    }
    return null;
  }
  function umlNeighbors(id) {
    var out = [], edges = (S.data && S.data.edges) || [], i, j, e, other, n, dup;
    for (i = 0; i < edges.length && out.length < 3; i++) {
      e = edges[i];
      if (e.from !== id && e.to !== id) continue;
      other = e.from === id ? e.to : e.from;
      if (other === id) continue;
      n = nodeById(other);
      if (!n) continue;
      dup = false;
      for (j = 0; j < out.length; j++) if (out[j].id === other) dup = true;
      if (dup) continue;
      out.push({ id: other, label: n.label, relation: e.label || '', dir: e.from === id ? 'out' : 'in' });
    }
    return out;
  }
  function umlSvg(node, e, neighbors) {
    var attrs = (e.a || []).slice(0, 3), methods = (e.m || []).slice(0, 5), i;
    var W1 = 344, HEAD = 46, ROW = 17;
    var hA = Math.max(30, 16 + attrs.length * ROW);
    var hM = Math.max(34, 16 + methods.length * ROW);
    var H1 = HEAD + hA + hM, x = 14, y = 14;
    var nbW = 246, nbH = 54, nbX = 408, gap = 10;
    var nbTotal = neighbors.length ? neighbors.length * (nbH + gap) - gap : 0;
    var W = neighbors.length ? nbX + nbW + 14 : W1 + 28;
    var H = Math.max(H1, nbTotal) + 28;
    var out = ['<svg class="uml-svg" viewBox="0 0 ' + W + ' ' + H +
      '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(node.label) + ' UML 类图">'];
    out.push('<defs><marker id="uml-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path class="uml-arrowhead" d="M1 1L9 5L1 9Z"/></marker></defs>');
    for (i = 0; i < neighbors.length; i++) {
      var ny = y + i * (nbH + gap);
      // One label per neighbour box below, not one per arrow: three arrows
      // sharing a 50px gap would stack their captions on the same spot.
      out.push('<path class="uml-rel" d="M ' + (x + W1) + ' ' + (y + HEAD / 2) +
        ' L ' + nbX + ' ' + (ny + nbH / 2) + '" marker-end="url(#uml-arrow)"/>');
    }
    out.push('<rect class="uml-box focus" x="' + x + '" y="' + y + '" width="' + W1 + '" height="' + H1 + '" rx="7"/>');
    out.push('<line class="uml-sep" x1="' + x + '" y1="' + (y + HEAD) + '" x2="' + (x + W1) + '" y2="' + (y + HEAD) + '"/>');
    out.push('<line class="uml-sep" x1="' + x + '" y1="' + (y + HEAD + hA) + '" x2="' + (x + W1) + '" y2="' + (y + HEAD + hA) + '"/>');
    out.push('<text class="uml-t-stereo" x="' + (x + 12) + '" y="' + (y + 17) + '">' + esc(umlStereo(e.k)) + '</text>');
    out.push('<text class="uml-t-name" x="' + (x + 12) + '" y="' + (y + 36) + '">' + esc(umlCut(e.n || node.label, 30)) + '</text>');
    out.push('<text class="uml-t-file" x="' + (x + W1 - 10) + '" y="' + (y + 36) + '" text-anchor="end">' + esc(umlCut(e.f || '', 34)) + '</text>');
    out.push('<text class="uml-t-label" x="' + (x + 12) + '" y="' + (y + HEAD + 13) + '">字段 / 属性</text>');
    for (i = 0; i < attrs.length; i++) {
      out.push('<text class="uml-t-attr" x="' + (x + 12) + '" y="' + (y + HEAD + 13 + (i + 1) * ROW) + '">' +
        esc(umlCut(attrs[i], 50)) + '</text>');
    }
    var my = y + HEAD + hA;
    out.push('<text class="uml-t-label" x="' + (x + 12) + '" y="' + (my + 13) + '">接口函数 / 方法</text>');
    for (i = 0; i < methods.length; i++) {
      out.push('<text class="uml-t-method" x="' + (x + 12) + '" y="' + (my + 13 + (i + 1) * ROW) + '">' +
        esc(umlCut(methods[i], 50)) + '</text>');
    }
    for (i = 0; i < neighbors.length; i++) {
      var q = neighbors[i], qy = y + i * (nbH + gap);
      out.push('<rect class="uml-box" x="' + nbX + '" y="' + qy + '" width="' + nbW + '" height="' + nbH + '" rx="6"/>');
      out.push('<text class="uml-t-stereo" x="' + (nbX + 10) + '" y="' + (qy + 17) + '">' + esc(umlStereo((UML[q.id] || {}).k)) + '</text>');
      out.push('<text class="uml-t-name small" x="' + (nbX + 10) + '" y="' + (qy + 34) + '">' + esc(umlCut(q.label, 28)) + '</text>');
      out.push('<text class="uml-t-file" x="' + (nbX + 10) + '" y="' + (qy + 48) + '">' +
        esc(umlCut((q.dir === 'out' ? 'uses → ' : '← used by ') + q.relation, 34)) + '</text>');
    }
    out.push('</svg>');
    return out.join('');
  }
  function umlCode(e) {
    var out = '', i, hit;
    for (i = 0; i < (e.c || []).length; i++) {
      hit = snippetBySymbol(e.c[i]);
      if (!hit) continue;
      out += '<div class="uml-code"><header><span class="sym">' + esc(hit.s.symbol) + '</span>' +
        '<span class="path">dsh-superagent-prototype/' + esc(hit.s.path) +
        (hit.lesson !== (S.data && S.data.id) ? ' · 出自 ' + esc(hit.lesson) : '') + '</span></header>' +
        '<pre><code>' + esc(hit.s.code) + '</code></pre><div class="why">' + esc(hit.s.why) + '</div></div>';
    }
    return out || '<p class="uml-note">这一块没有逐字抄录的代码片段；接口签名见左侧 UML 类框，逐段精读点悬浮栏「教程」。</p>';
  }
  function umlStepsOf(id) {
    var out = [], steps = (S.data && S.data.steps) || [], i;
    for (i = 0; i < steps.length && out.length < 8; i++) {
      if (steps[i].from === id || steps[i].to === id) out.push({ i: i, s: steps[i] });
    }
    return out;
  }
  function renderUml(id) {
    if (S.view !== 'lesson' || !S.data) return;
    var node = nodeById(id);
    if (!node) return;
    var e = UML[id] || { k: 'external', n: node.label, f: '—', a: [], m: [], c: [] };
    var nb = umlNeighbors(id), steps = umlStepsOf(id);
    var modal = $('uml-modal'), body = $('uml-body'), title = $('uml-title');
    if (!modal || !body) return;
    if (title) title.textContent = S.data.id + ' · ' + node.label + '  ' + umlStereo(e.k) + ' · ' + (e.n || '');
    var out = ['<div class="uml-top"><div class="uml-diagram">' + umlSvg(node, e, nb) + '</div>',
      '<div class="uml-meta">',
      '<div class="uml-line"><b>职责</b>' + esc(node.sub || '') + '</div>',
      '<div class="uml-line"><b>源码</b><code>' + esc(e.f || '—') + '</code></div>',
      '<div class="uml-line"><b>泳道</b>' + esc((S.data.lanes || [])[node.lane] || '') + '</div>',
      '<div class="uml-line"><b>类型</b>' + esc(e.n || node.label) + ' · ' + esc(umlStereo(e.k)) + '</div>',
      '</div></div>',
      '<div class="uml-grid"><div class="uml-col"><h3>主要代码（原型逐字抄录）</h3>', umlCode(e), '</div>',
      '<div class="uml-col"><h3>字段 / 属性</h3>'];
    out.push(e.a && e.a.length
      ? '<ul class="uml-list mono">' + e.a.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>'
      : '<p class="uml-note">该类框没有声明字段（纯函数 / 配置 / 外部块）。</p>');
    out.push('<h3>接口函数</h3>');
    out.push(e.m && e.m.length
      ? '<ul class="uml-list mono">' + e.m.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>'
      : '<p class="uml-note">' + (e.k === 'external'
        ? '人或外部世界，不是领域类型，没有接口函数。'
        : '这一块是数据 / 配置对象，没有成员函数；相关操作见「主要代码」与「参与的动态步骤」。') + '</p>');
    out.push('<h3>关系（本课框架图连线）</h3>');
    out.push(nb.length
      ? '<ul class="uml-list">' + nb.map(function (q) {
        return '<li>' + (q.dir === 'out' ? esc(node.label) + ' → ' : '') + esc(q.label) +
          (q.dir === 'in' ? ' → ' + esc(node.label) : '') +
          ' <span class="uml-tag">' + esc(q.relation) + '</span></li>';
      }).join('') + '</ul>'
      : '<p class="uml-note">本课框架图里没有连到别的块。</p>');
    out.push('<h3>参与的动态步骤</h3>');
    if (steps.length) {
      out.push('<div class="uml-steps">');
      for (var k = 0; k < steps.length; k++) {
        out.push('<button class="btn uml-step" id="uml-step-' + k + '" type="button">' +
          (steps[k].i + 1) + ' · ' + esc(umlCut(steps[k].s.label, 30)) + '</button>');
      }
      out.push('</div><p class="uml-note">点任一步：关弹窗并跳到那一步播放。</p>');
    } else out.push('<p class="uml-note">这一块在本课动态流转里没有被点亮。</p>');
    out.push('</div></div>');
    body.innerHTML = out.join('');
    modal.style.display = 'flex';
    body.scrollTop = 0;
    S.umlId = id;
    for (var b = 0; b < steps.length; b++) {
      (function (btnIdx, stepIdx) {
        bind('uml-step-' + btnIdx, 'click', function () {
          closeUml();
          pause();
          goto(stepIdx, false, true);
        });
      })(b, steps[b].i);
    }
  }
  function openUml(id) { closeDoc(); renderUml(id); }
  function closeUml() {
    var m = $('uml-modal');
    if (m) m.style.display = 'none';
    S.umlId = null; S.umlSteps = [];
  }

  function nodeById(id) {
    var list = S.data.nodes, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function center(n) {
    return { x: PAD_X + n.col * COL_GAP + NODE_W / 2, y: PAD_Y + n.lane * ROW_GAP + NODE_H / 2 };
  }
  function pathPoints(a, b) {
    var A = center(a), B = center(b);
    if (a.id === b.id) {
      return [
        { x: A.x - NODE_W / 2, y: A.y },
        { x: A.x - NODE_W / 2 - 22, y: A.y - NODE_H / 2 - 16 },
        { x: A.x + NODE_W / 2 + 22, y: A.y - NODE_H / 2 - 16 },
        { x: A.x + NODE_W / 2, y: A.y }
      ];
    }
    if (a.lane === b.lane) {
      var right = a.col <= b.col;
      var x1 = right ? A.x + NODE_W / 2 : A.x - NODE_W / 2;
      var x2 = right ? B.x - NODE_W / 2 : B.x + NODE_W / 2;
      return [{ x: x1, y: A.y }, { x: x2, y: B.y }];
    }
    var down = a.lane < b.lane;
    var y1 = down ? A.y + NODE_H / 2 : A.y - NODE_H / 2;
    var y2 = down ? B.y - NODE_H / 2 : B.y + NODE_H / 2;
    var mid = (y1 + y2) / 2;
    return [{ x: A.x, y: y1 }, { x: A.x, y: mid }, { x: B.x, y: mid }, { x: B.x, y: y2 }];
  }
  function pathD(pts) {
    var out = 'M ' + pts[0].x + ' ' + pts[0].y, i;
    for (i = 1; i < pts.length; i++) out += ' L ' + pts[i].x + ' ' + pts[i].y;
    return out;
  }
  function pointAt(pts, t) {
    var lens = [], total = 0, i;
    for (i = 1; i < pts.length; i++) {
      var d = Math.sqrt(Math.pow(pts[i].x - pts[i - 1].x, 2) + Math.pow(pts[i].y - pts[i - 1].y, 2));
      lens.push(d); total += d;
    }
    if (total === 0) return pts[0];
    var left = t * total;
    for (i = 0; i < lens.length; i++) {
      if (left <= lens[i] || i === lens.length - 1) {
        var u = lens[i] ? Math.min(1, left / lens[i]) : 0;
        return {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * u,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * u
        };
      }
      left -= lens[i];
    }
    return pts[pts.length - 1];
  }

  /* sa-lessons' arrangement: one select + a pair of ◀/▶ buttons, instead of
     eight chips. Inside Shan's sandboxed srcdoc these are in-page actions. */
  function renderTopbar() {
    var cur = S.view === 'lesson' ? S.data : null, opts = '', pos = -1, i;
    for (i = 0; i < CURR.length; i++) {
      var c = CURR[i];
      if (cur && c.id === cur.id) pos = i;
      opts += '<option value="' + esc(c.id) + '"' + (cur && c.id === cur.id ? ' selected' : '') +
        '>' + esc(c.id) + ' · ' + esc(c.title) + '</option>';
    }
    var nav = '<nav class="course-nav">' +
      '<button class="btn" id="lesson-prev" type="button" title="上一课"' + (pos <= 0 ? ' disabled' : '') + '>◀</button>' +
      '<select class="nav-select" id="lesson-select" title="选一节课">' +
        '<option value="__map__"' + (cur ? '' : ' selected') + '>课程地图</option>' + opts +
      '</select>' +
      '<button class="btn" id="lesson-next" type="button" title="下一课"' +
        (pos < 0 || pos >= CURR.length - 1 ? ' disabled' : '') + '>▶</button>' +
      '</nav>';
    html('topbar', '<div class="topbar"><div class="topbar-inner">' +
      '<div class="brand">Way2SA <small>从 8 篇原型文档学 Super-agent</small></div>' +
      nav +
      '<span class="tb-hint">点流转图任意模块看 UML</span>' +
      '</div></div>');
    bind('lesson-select', 'change', function (e) {
      var v = e.target && e.target.value;
      if (v === '__map__') showMap();
      else show(v);
    });
    if (pos > 0) bind('lesson-prev', 'click', function () { show(CURR[pos - 1].id); });
    if (pos >= 0 && pos < CURR.length - 1) bind('lesson-next', 'click', function () { show(CURR[pos + 1].id); });
    applyTheme();
  }
  function bindLesson(elId, lessonId) {
    bind(elId, 'click', function () { show(lessonId); });
  }

  /* 讲义 / 教程 / 课程地图 live on the FLOATING bar, beside the playback
     controls — one always-reachable place instead of a crowded topbar. The
     map view has the same bar so the buttons never disappear. */
  function docButtons(onMap) {
    return '<span class="player-docs">' +
      '<button class="btn" id="btn-readme" type="button" title="就地看这一课的 README.md">讲义</button>' +
      '<button class="btn" id="btn-tutorial" type="button" title="就地看这一课的代码教程">教程</button>' +
      '<button class="btn" id="map-btn" type="button" title="回到课程地图"' +
        (onMap ? ' disabled' : '') + '>课程地图</button>' +
      '</span>';
  }
  function bindDocButtons() {
    bind('btn-readme', 'click', function () { toggleDoc('readme'); });
    bind('btn-tutorial', 'click', function () { toggleDoc('tutorial'); });
    bind('map-btn', 'click', showMap);
  }

  function renderHero() {
    var d = S.data, meta = BY_ID[d.id] || {}, qs = '', i;
    for (i = 0; i < d.questions.length; i++) qs += '<li>' + esc(d.questions[i]) + '</li>';
    var prev = '', next = '', pos = -1;
    for (i = 0; i < CURR.length; i++) if (CURR[i].id === d.id) pos = i;
    if (pos > 0) prev = switchChip('← ' + CURR[pos - 1].id + ' ' + CURR[pos - 1].title, CURR[pos - 1].id);
    if (pos >= 0 && pos < CURR.length - 1) next = switchChip(CURR[pos + 1].id + ' ' + CURR[pos + 1].title + ' →', CURR[pos + 1].id);
    html('hero', '<div class="hero">' +
      '<div class="kicker">' + esc(d.id) + ' · ' + esc(d.title) + '</div>' +
      '<h1>' + esc(d.title) + ' <span style="color:var(--hint);font-weight:400;font-size:15px">/ ' + esc(d.tag || '') + '</span></h1>' +
      '<p class="sub">' + esc(d.subtitle || meta.oneLine || '') + '</p>' +
      '<div class="hero-grid">' +
        // No meta chips here: 起点 / doc / steps / modules were noise. The doc
        // is still reachable from the 原型原文 chip in the footer.
        '<div class="card"><h2>这课学什么</h2><p class="goal">' + esc(d.goal) + '</p></div>' +
        '<div class="card"><h2>学完能回答</h2><ol class="q-list">' + qs + '</ol></div>' +
      '</div><div class="footer-links">' + prev + next +
        fileLink('本课 README', lessonFile('README.md'), '点「讲义」就地查看 README.md', 'readme') +
        fileLink('代码教程', lessonFile('TUTORIAL.md'), '点悬浮栏「教程」就地查看 TUTORIAL.md', 'tutorial') +
        fileLink('原型原文 ' + d.doc, BASE + 'dsh-superagent-prototype/docs/' + d.doc,
          '就地打开 dsh-superagent-prototype/docs/' + d.doc, 'doc') +
      '</div>' +
      (EMBEDDED ? '<p class="embed-note">沙箱预览：README、教程与原型原文都在本页弹窗打开；课程切换也在本页内完成。</p>' : '') +
      '</div>');
    for (i = 0; i < CURR.length; i++) bindLesson('go-' + CURR[i].id, CURR[i].id);
    bind('hero-readme', 'click', function () { toggleDoc('readme'); });
    bind('hero-tutorial', 'click', function () { toggleDoc('tutorial'); });
    bind('hero-doc', 'click', function () { toggleDoc('doc'); });
  }

  function renderGraph() {
    var d = S.data, i, maxCol = 0, maxLane = 0;
    for (i = 0; i < d.nodes.length; i++) {
      maxCol = Math.max(maxCol, d.nodes[i].col);
      maxLane = Math.max(maxLane, d.nodes[i].lane);
    }
    S.viewW = PAD_X * 2 + maxCol * COL_GAP + NODE_W + 18;
    S.viewH = PAD_Y * 2 + maxLane * ROW_GAP + NODE_H + 16;

    /* The diagram is drawn in viewBox units, so its rendered type size is
       viewW-independent only while the wrap is narrower than GRAPH_MAX_W.
       Capping the wrap at a fixed pixel width freezes both the frame and the
       type: widening the pane (collapsing a sidebar) stops scaling the SVG up
       and simply adds whitespace around it. Below the cap the SVG still
       shrinks to fit — there is no way to draw 988 units in 700px otherwise. */
    var out = ['<div class="graph-wrap" id="graph-wrap" style="max-width:' +
      Math.min(S.viewW, GRAPH_MAX_W) + 'px">'];
    out.push('<svg viewBox="0 0 ' + S.viewW + ' ' + S.viewH + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="动态设计框架">');
    out.push('<defs><marker id="fa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>');
    var lanes = d.lanes || [];
    /* Everything drawn in the graph that labels must dodge: node boxes, the
       lane captions, and already-placed edge labels. */
    var boxes = [], labelRects = [], edgeLabels = [];
    for (i = 0; i < d.nodes.length; i++) {
      boxes.push({
        x: PAD_X + d.nodes[i].col * COL_GAP, y: PAD_Y + d.nodes[i].lane * ROW_GAP,
        w: NODE_W, h: NODE_H
      });
    }
    for (i = 0; i < lanes.length; i++) {
      // Lane captions sit ABOVE their row: the left gutter is only PAD_X wide,
      // and labels like "领域内核 · 可移植" would otherwise run into the boxes.
      // The dashed rules are gone — at this type size a caption plus the row
      // gap already separates the lanes, and the rule cut through the caption.
      out.push('<text class="lane-label" x="' + (PAD_X - 2) + '" y="' + (PAD_Y + i * ROW_GAP - 10) + '">' + esc(lanes[i]) + '</text>');
      // Reserve the caption so an edge label cannot land on top of it.
      labelRects.push({ x: PAD_X - 4, y: PAD_Y + i * ROW_GAP - 24, w: textW(lanes[i], 13) + 6, h: 18 });
    }
    var edges = d.edges || [];
    /* Edge labels are placed greedily: at this type size two labels can land on
       the same midpoint and bury a box, so each candidate point must be clear of
       every node box and every label already placed, or the label is dropped. */
    function hits(r, list) {
      for (var j = 0; j < list.length; j++) {
        var q = list[j];
        if (r.x < q.x + q.w + 2 && r.x + r.w + 2 > q.x && r.y < q.y + q.h + 2 && r.y + r.h + 2 > q.y) return true;
      }
      return false;
    }
    var labelTs = [0.5, 0.34, 0.66, 0.2, 0.8];
    for (i = 0; i < edges.length; i++) {
      var a = nodeById(edges[i].from), b = nodeById(edges[i].to);
      if (!a || !b) continue;
      var pts0 = pathPoints(a, b);
      out.push('<path class="edge" d="' + pathD(pts0) + '"/>');
      var text = edges[i].label;
      if (!text) continue;
      var size = 12, lw = textW(text, size) + 6, lh = size + 4;
      for (var t = 0; t < labelTs.length; t++) {
        var m = pointAt(pts0, labelTs[t]);
        var r = { x: m.x - lw / 2, y: m.y - lh / 2, w: lw, h: lh };
        if (r.x < 4 || r.y < 4 || r.x + r.w > S.viewW - 4 || r.y + r.h > S.viewH - 4) continue;
        if (hits(r, boxes) || hits(r, labelRects)) continue;
        labelRects.push(r);
        edgeLabels.push('<text class="edge-label" x="' + m.x + '" y="' + (m.y + 4) + '" text-anchor="middle">' + esc(text) + '</text>');
        break;
      }
    }
    S.paths = [];
    for (i = 0; i < d.steps.length; i++) {
      var s = d.steps[i], na = nodeById(s.from), nb = nodeById(s.to);
      var pts = (na && nb) ? pathPoints(na, nb) : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
      S.paths.push(pts);
      var k = s.kind === 'fact' ? ' fact' : (s.kind === 'effect' ? ' effect' : '');
      out.push('<path id="fp-' + i + '" class="flow-path' + k + '" d="' + pathD(pts) + '" marker-end="url(#fa)"/>');
    }
    for (i = 0; i < d.nodes.length; i++) {
      var n = d.nodes[i], p = { x: PAD_X + n.col * COL_GAP, y: PAD_Y + n.lane * ROW_GAP };
      var kind = n.kind === 'kernel' ? ' kernel' : (n.kind === 'host' ? ' host' : (n.kind === 'human' ? ' human' : ''));
      var carry = n.carry ? ' carry' : '';
      out.push('<g id="nd-' + esc(n.id) + '" data-node="' + esc(n.id) + '" class="node' + kind + carry + '">');
      out.push('<title>点开 ' + esc(n.label) + ' 的 UML 类图、主要代码与接口函数</title>');
      out.push('<rect class="node-box" x="' + p.x + '" y="' + p.y + '" width="' + NODE_W + '" height="' + NODE_H + '" rx="10"/>');
      out.push('<text class="node-title" style="font-size:' + titleSize(n.label) + 'px" x="' + (p.x + NODE_W / 2) + '" y="' + (p.y + 29) + '" text-anchor="middle">' + esc(n.label) + '</text>');
      out.push('<text class="node-sub" style="font-size:' + subSize(n.sub) + 'px" x="' + (p.x + NODE_W / 2) + '" y="' + (p.y + 52) + '" text-anchor="middle">' + esc(n.sub || '') + '</text>');
      out.push('</g>');
    }
    out.push(edgeLabels.join(''));
    out.push('</svg><div class="packet" id="packet"><span class="dot"></span><span id="packet-text"></span></div></div>');
    out.push('<div class="graph-legend"><span class="legend-item"><i class="swatch kernel"></i>领域内核 / 可移植</span>' +
      '<span class="legend-item"><i class="swatch host"></i>宿主适配器 / DSH</span>' +
      '<span class="legend-item"><i class="swatch human"></i>人或外部世界</span>' +
      '<span class="legend-item">点任一模块 → UML / 代码 / 接口函数</span></div>');
    html('graph', out.join(''));
    for (i = 0; i < d.nodes.length; i++) {
      (function (id) { bind('nd-' + id, 'click', function () { openUml(id); }); })(d.nodes[i].id);
    }
  }

  function renderMachine() {
    var sm = S.data.states || { nodes: [], transitions: [] }, i, maxC = 0;
    for (i = 0; i < sm.nodes.length; i++) maxC = Math.max(maxC, sm.nodes[i].c);
    var out = ['<div class="sm-grid" style="grid-template-columns:repeat(' + (maxC + 1) + ',minmax(0,1fr))">'];
    for (i = 0; i < sm.nodes.length; i++) {
      var n = sm.nodes[i];
      out.push('<div id="sm-' + esc(n.id) + '" class="sm-node" style="grid-column:' + (n.c + 1) + ';grid-row:' + (n.r + 1) + '"><b>' + esc(n.id) + '</b>' + esc(n.label) + '</div>');
    }
    out.push('</div><div class="trans-list">');
    for (i = 0; i < sm.transitions.length; i++) {
      var t = sm.transitions[i];
      out.push('<div id="tr-' + i + '" class="trans">' + esc(t.from) + ' → ' + esc(t.to) + ' · ' + esc(t.label) + '</div>');
    }
    out.push('</div>');
    html('machine', out.join(''));
  }

  function renderCode() {
    var list = S.data.snippets || [], out = ['<div class="code-grid">'], i;
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      out.push('<div class="code-card" id="cc-' + esc(s.id) + '"><header><span class="sym">' + esc(s.symbol) + '</span>' +
        '<span class="path">dsh-superagent-prototype/' + esc(s.path) + '</span></header>' +
        '<pre><code>' + esc(s.code) + '</code></pre>' +
        '<div class="why">' + esc(s.why) + '</div></div>');
    }
    out.push('</div>');
    html('code', out.join(''));
  }

  function renderNotes() {
    var d = S.data, i, out = [];
    var terms = '<table class="terms"><thead><tr><th>术语</th><th>职责</th><th>源码</th></tr></thead><tbody>';
    for (i = 0; i < d.glossary.length; i++) {
      var g = d.glossary[i];
      terms += '<tr><td>' + esc(g.term) + '</td><td>' + esc(g.desc) + '</td><td class="src">' + esc(g.src || '') + '</td></tr>';
    }
    terms += '</tbody></table>';
    // terms-card spans two grid tracks: the mono term column plus full source
    // paths never fit one track without cutting the paths off.
    out.push('<div class="card terms-card"><h2>术语与源码坐标</h2><div class="terms-wrap">' + terms + '</div></div>');

    var pit = '<ol class="pitfalls">';
    for (i = 0; i < d.pitfalls.length; i++) pit += '<li>' + esc(d.pitfalls[i]) + '</li>';
    pit += '</ol>';
    out.push('<div class="card"><h2>易错点</h2>' + pit + '</div>');

    var labs = '';
    for (i = 0; i < d.labs.length; i++) {
      var l = d.labs[i], steps = '';
      for (var j = 0; j < (l.steps || []).length; j++) steps += '<li>' + esc(l.steps[j]) + '</li>';
      labs += '<div class="lab"><b>' + esc(l.title) + '</b><p>' + esc(l.goal) + '</p><ol>' + steps + '</ol></div>';
    }
    out.push('<div class="card"><h2>动手实验</h2>' + labs +
      '<p style="font-size:11px;color:var(--hint);margin:0">实验的完整代码与逐段讲解见 ' +
        (EMBEDDED ? '<code>TUTORIAL.md</code>' : '<a href="' + esc(lessonFile('TUTORIAL.md')) + '">TUTORIAL.md</a>') +
        '；本页的动态演示是同一条链路的可视化版本。</p></div>');

    var take = '<ul class="takeaways">';
    for (i = 0; i < d.takeaways.length; i++) take += '<li>' + esc(d.takeaways[i]) + '</li>';
    take += '</ul>';
    out.push('<div class="card"><h2>带走这几条</h2>' + take + '</div>');
    html('notes', '<div class="notes-grid">' + out.join('') + '</div>');
  }

  function renderControls() {
    var d = S.data;
    /* Step progress lives on the FLOATING bar. The dynamic board can scroll
       out of view; "which step am I on" must never. Counter + slider + the
       current step label all update from the same renderStep() call. */
    html('player', '<button class="btn primary" id="btn-play" type="button">▶ 播放</button>' +
      '<button class="btn" id="btn-prev" type="button">← 上一步</button>' +
      '<button class="btn" id="btn-next" type="button">单步 →</button>' +
      '<button class="btn" id="btn-reset" type="button">重置</button>' +
      '<select id="speed" aria-label="播放速度"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select>' +
      '<span class="player-progress" id="progress-wrap" title="拖动可跳到任意一步">' +
        '<span class="counter" id="counter">0 / ' + d.steps.length + '</span>' +
        '<input id="progress" type="range" min="0" max="' + (d.steps.length - 1) + '" value="0" aria-label="步骤进度">' +
        '<span class="step-brief" id="step-brief">尚未开始</span>' +
      '</span>' +
      '<span class="spacer"></span>' + docButtons(false) +
      '<span class="mini" id="player-hint">Space 播放 · S 单步 · R 重置 · ← → 步进</span>');
    bindDocButtons();
    bind('btn-play', 'click', togglePlay);
    bind('btn-prev', 'click', function () { pause(); goto(S.index - 1, false, true); });
    bind('btn-next', 'click', function () { pause(); goto(S.index + 1, false, true); });
    bind('btn-reset', 'click', function () { pause(); goto(-1, false, false); });
    bind('speed', 'change', function (e) { S.speed = Number(e.target.value) || 1; });
    bind('progress', 'input', function (e) { pause(); goto(Number(e.target.value), false, true); });
  }
  function bind(id, type, fn) { var el = $(id); if (el && el.addEventListener) el.addEventListener(type, fn); }
  function logJump(j) { return function () { pause(); goto(j, false, true); }; }
  function bindLogRow(j) { bind('log-r' + j, 'click', logJump(j)); }

  function updateButtons() {
    if (!S.data) return;
    var b = $('btn-play');
    if (b) b.textContent = S.playing ? '❚❚ 暂停' : '▶ 播放';
    var p = $('progress'), c = $('counter');
    if (p) p.value = Math.max(0, S.index);
    if (c) c.textContent = (S.index + 1) + ' / ' + S.data.steps.length;
    var brief = $('step-brief');
    if (brief) {
      var cur = S.index >= 0 ? S.data.steps[S.index] : null;
      brief.textContent = cur ? cur.label : '尚未开始';
      // The label is ellipsised on a narrow bar; the tooltip keeps it readable.
      brief.title = cur ? cur.label : '尚未开始';
    }
  }

  function setPacket(pos, step) {
    var el = $('packet'), txt = $('packet-text');
    if (!el) return;
    if (!pos) { el.style.opacity = 0; return; }
    el.style.left = (pos.x / S.viewW * 100) + '%';
    el.style.top = (pos.y / S.viewH * 100) + '%';
    el.style.opacity = 1;
    el.className = 'packet ' + (step.kind === 'fact' ? 'fact' : (step.kind === 'effect' ? 'effect' : (step.kind === 'event' || step.kind === 'config' ? 'event' : '')));
    if (txt) txt.textContent = step.label;
  }

  function clearHighlights() {
    var d = S.data, i;
    for (i = 0; i < d.nodes.length; i++) cls('nd-' + d.nodes[i].id, nodeBase(d.nodes[i]));
    for (i = 0; i < d.steps.length; i++) {
      var s = d.steps[i];
      var k = s.kind === 'fact' ? ' fact' : (s.kind === 'effect' ? ' effect' : '');
      cls('fp-' + i, 'flow-path' + k);
    }
    var sm = d.states || { nodes: [], transitions: [] };
    for (i = 0; i < sm.nodes.length; i++) cls('sm-' + sm.nodes[i].id, 'sm-node');
    for (i = 0; i < sm.transitions.length; i++) cls('tr-' + i, 'trans');
    for (i = 0; i < d.snippets.length; i++) cls('cc-' + d.snippets[i].id, 'code-card');
  }

  function renderLog(i) {
    var d = S.data, j, log = '';
    /* The whole run is listed from the start — past, current and upcoming — so
       the panel is a playbill rather than an empty box waiting for playback,
       and any row can be clicked to jump straight to it. */
    for (j = 0; j < d.steps.length; j++) {
      var x = d.steps[j];
      var state = j < i ? ' done' : (j === i ? ' on' : ' pending');
      log += '<button type="button" id="log-r' + j + '" title="跳到第 ' + (j + 1) + ' 步：' + esc(x.label) + '" ' +
        'class="log-row' + state + '"><span class="n">' + (j + 1) + '</span>' +
        '<span class="k ' + esc(x.kind) + '">' + esc(x.kind) + '</span>' +
        '<span class="t">' + esc(x.from) + ' → ' + esc(x.to) + ' · ' + esc(x.label) + '</span></button>';
    }
    html('log-list', log);
    for (j = 0; j < d.steps.length; j++) bindLogRow(j);
    var box = $('log-list'), row = i >= 0 ? $('log-r' + i) : null;
    if (box && box.scrollTop !== undefined && row && typeof row.offsetTop === 'number') {
      // Keep the active row in view without yanking the list on every frame.
      var top = row.offsetTop - (box.clientHeight || 0) / 2 + 12;
      box.scrollTop = Math.max(0, top);
    }
  }

  function renderStep(i) {
    var d = S.data;
    clearHighlights();
    updateButtons();
    if (i < 0 || i >= d.steps.length) {
      setPacket(null, {});
      html('step-detail', '<div class="empty-state">按「播放」或「单步」，看一条消息 / 事件如何在模块之间流转。每一步都会同步点亮框架图、状态机、事件日志与对应代码。</div>');
      renderLog(i);
      return;
    }
    var s = d.steps[i];
    var na = nodeById(s.from), nb = nodeById(s.to);
    if (na) cls('nd-' + na.id, nodeBase(na) + ' active source');
    if (nb) cls('nd-' + nb.id, nodeBase(nb) + ' active target');
    cls('fp-' + i, 'flow-path' + (s.kind === 'fact' ? ' fact' : (s.kind === 'effect' ? ' effect' : '')) + ' on');

    var sm = d.states || { nodes: [], transitions: [] }, j;
    if (s.state) {
      addClass('sm-' + s.state, 'sm-node', 'active');
      for (j = 0; j < sm.transitions.length; j++) if (sm.transitions[j].to === s.state) addClass('tr-' + j, 'trans', 'active');
    }
    if (s.code) addClass('cc-' + s.code, 'code-card', 'active');

    html('step-detail', '<div class="step-head"><span class="step-no">' + (i + 1) + '</span>' +
      '<span class="step-kind ' + esc(s.kind) + '">' + esc(s.kind) + '</span></div>' +
      '<div class="step-label">' + esc(s.label) + '</div>' +
      '<div class="step-route">' + esc(s.from) + ' → ' + esc(s.to) + '</div>' +
      '<div class="step-note">' + esc(s.note) + '</div>' +
      (s.ref ? '<div class="step-note" style="margin-top:8px;color:var(--hint)">源码：' + esc(s.ref) + '</div>' : ''));

    renderLog(i);
  }

  function animate(i, done) {
    var s = S.data.steps[i], pts = S.paths[i];
    var duration = Math.max(180, 900 / S.speed);
    var start = now();
    cancelRaf(S.raf);
    function frame() {
      var t = Math.min(1, (now() - start) / duration);
      var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setPacket(pointAt(pts, eased), s);
      if (t < 1) S.raf = raf(frame);
      else if (done) done();
    }
    frame();
  }

  function cancelTimers() {
    cancelRaf(S.raf); S.raf = null;
    if (S.timer) clearTimeout(S.timer);
    S.timer = null;
  }

  function goto(i, chained, animateIt) {
    cancelTimers();
    var last = S.data.steps.length - 1;
    if (i < -1) i = -1;
    if (i > last) i = last;
    S.index = i;
    renderStep(i);
    if (i >= 0 && animateIt !== false) {
      animate(i, function () { if (chained) scheduleNext(); });
    } else if (chained) scheduleNext();
  }
  function scheduleNext() {
    if (!S.playing) return;
    S.timer = setTimeout(function () { advance(); }, Math.max(80, 300 / S.speed));
  }
  function advance() {
    if (!S.playing) return;
    if (S.index >= S.data.steps.length - 1) { S.playing = false; updateButtons(); return; }
    goto(S.index + 1, true, true);
  }
  function play() {
    if (S.playing) return;
    if (S.index >= S.data.steps.length - 1) { goto(-1, false, false); }
    S.playing = true; updateButtons(); advance();
  }
  function pause() { S.playing = false; cancelTimers(); if (S.data) updateButtons(); }
  function togglePlay() { if (S.view !== 'lesson') return; if (S.playing) pause(); else play(); }

  function bindKeys() {
    if (S.keysBound || !document.addEventListener) return;
    S.keysBound = true;
    document.addEventListener('keydown', function (e) {
      var k = e.key || '';
      if (k === 'Escape') { closeDoc(); closeUml(); return; }
      // A focused log row / button gets its own native Space/Enter behaviour;
      // the global playback shortcuts must not fire a second time for it.
      var tag = String((e.target && e.target.tagName) || '').toLowerCase();
      if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (S.view !== 'lesson' || !S.data || S.docKind || S.umlId) return;
      if (k === ' ' || k === 'Spacebar') { e.preventDefault && e.preventDefault(); togglePlay(); }
      else if (k === 's' || k === 'S') { pause(); goto(S.index + 1, false, true); }
      else if (k === 'r' || k === 'R') { pause(); goto(-1, false, false); }
      else if (k === 'ArrowRight') { pause(); goto(S.index + 1, false, true); }
      else if (k === 'ArrowLeft') { pause(); goto(S.index - 1, false, true); }
    });
  }

  function renderSkeleton() {
    html('app',
      '<div id="topbar"></div><div class="wrap">' +
      '<div id="hero"></div>' +
      /* Everything animated shares one board; the player itself stays floating. */
      '<section class="dynamic-board">' +
        '<div class="section-title"><h2>动态设计框架</h2><span class="hint">消息包沿连线移动 · 点任一模块看 UML / 主要代码 / 接口函数 · 悬浮栏看步数与跳步</span></div>' +
        '<div class="viz-grid">' +
          /* The event log is INSIDE the 模块与流转 card, not a separate row
             underneath it: the flow lines and the events they produced must
             be readable in one glance while the packet is moving. */
          '<div class="card flow-card"><div class="section-title"><h2>模块与流转</h2><span class="hint">淡色块 = 承接前课 · 点模块看 UML</span></div>' +
            '<div id="graph"></div>' +
            '<div class="flow-log"><div class="flow-log-head"><h3>事件日志</h3>' +
              '<span class="hint">与上方连线共用同一份步骤数据 · 点任一条跳回那一步</span></div>' +
              '<div class="log-list" id="log-list"></div></div>' +
          '</div>' +
          '<div class="viz-col"><div class="card"><div class="section-title"><h2>状态机</h2><span class="hint">随步骤点亮</span></div><div id="machine"></div></div>' +
          '<div class="card"><div class="section-title"><h2>当前这一步</h2><span class="hint">command / fact / effect 的区别</span></div><div id="step-detail"></div></div></div>' +
        '</div>' +
      '</section>' +
      '<div class="section-title" style="margin-top:22px"><h2>代码锚点（随步骤高亮）</h2><span class="hint">逐段讲解见 TUTORIAL.md</span></div><div id="code"></div>' +
      '<div class="section-title" style="margin-top:22px"><h2>本课笔记</h2><span class="hint">术语 / 易错点 / 实验 / 收获</span></div><div id="notes"></div>' +
      '<div class="player" id="player"></div>' +
      '</div>');
  }

  function renderAll() {
    S.view = 'lesson';
    renderSkeleton();
    renderTopbar();
    renderHero();
    renderGraph();
    renderMachine();
    renderCode();
    renderNotes();
    renderControls();
    renderStep(-1);
    bindKeys();
  }

  /* The course map is another IN-PAGE view, so it works inside the sandbox too. */
  function renderMap() {
    var i, cards = '';
    for (i = 0; i < CURR.length; i++) {
      var c = CURR[i], prev = i ? CURR[i - 1] : null;
      cards += '<button type="button" class="map-card" id="map-' + esc(c.id) + '">' +
        '<span class="no">' + esc(c.id) + ' · ' + esc(c.tag) + '</span>' +
        '<h3>' + esc(c.title) + '</h3><p>' + esc(c.oneLine) + '</p>' +
        '<div class="doc">docs/' + esc(c.doc) + '</div>' +
        '<div class="map-flow"><span>主题：' + esc(c.theme) + '</span><span>' +
        (prev ? '承接 ' + esc(prev.id) : '课程起点') + '</span></div></button>';
    }
    html('app',
      '<div id="topbar"></div><div class="wrap">' +
      '<div class="hero">' +
        '<div class="kicker">Way2SA / curriculum</div>' +
        '<h1>从 8 篇原型文档，学一个 Super-agent 底座</h1>' +
        '<p class="sub">一门课对应一篇 <code>docs/0XX-*.md</code>：读文档 → 看动态框架 → 逐段啃真实源码 → 做纯前端小实验。后课的图建立在前课模块之上，淡色块表示承接。点任意卡片在本页内切换课程，不需要跳转。</p>' +
        '<div class="meta-row">' +
          '<span class="tag doc">001-domain.md → 008-cookbook.md</span>' +
          '<span class="tag">8 课</span><span class="tag">单文件自包含 · 零 CDN</span>' +
          '<span class="tag">源码来自 dsh-superagent-prototype</span>' +
        '</div></div>' +
      '<div class="section-title"><h2>课程地图</h2><span class="hint">按顺序学：概念 → 授权 → 执行 → 提示词 → 面板 → 部署 → 架构 → 实战</span></div>' +
      '<div class="map-grid">' + cards + '</div>' +
      '<div class="card" style="margin-top:18px"><h2>每课固定四件套</h2><ol class="q-list">' +
        '<li><b>README.md</b> — 这课学什么、先修、验收标准、与前后课的关系。</li>' +
        '<li><b>TUTORIAL.md</b> — 代码教程：逐段拆解原型真实源码（路径 + 符号 + 抄录片段），末尾是两个不依赖 DSH 的动手实验。</li>' +
        '<li><b>index.html</b> — 动态设计框架：「模块与流转」卡片内含流转图与事件日志，旁边是状态机 / 当前步骤，下方代码锚点联动；点任一模块弹出 UML 类图、主要代码与接口函数。</li>' +
        '<li><b>动态演示</b> — 播放 / 单步 / 变速 / 跳转。一条 message 或 event 沿连线实际移动，五处同步高亮。</li>' +
      '</ol><p style="font-size:12px;color:var(--muted);margin:10px 0 0">课件只解释与可视化，不执行原型代码；所有代码片段均从 <code>dsh-superagent-prototype</code> 逐字抄录。原型是 DSH 的研究原型，文章里部分设计（存算分离、独立 Watchdog、异步 start/stop）在原型中并未实现，学习时按「文档 = 目标态 / 原型 = 部分落地」区分。</p></div>' +
      '<div class="card" style="margin-top:14px"><h2>运行与校验</h2>' +
        '<p style="font-size:12px;color:var(--muted);margin:0">每个 <code>index.html</code> 都内联了 CSS、渲染器与 8 课数据，因此 <code>file://</code> 直接双击可用，也能在 Shan 的 <code>content-view</code> HTML 预览（<code>srcdoc</code> + <code>sandbox="allow-scripts"</code>）里完整渲染。开发者可用 <code>node tools/build.mjs</code> 重新生成，用 <code>node tools/validate.mjs</code>、<code>node tools/smoke.mjs</code>、<code>node tools/tutorials.mjs</code> 校验。</p></div>' +
      (EMBEDDED ? '<p class="embed-note">沙箱预览：课程切换、播放与状态机都在本页内完成；悬浮栏「讲义」「教程」就地看文档，原型原文请在左侧文件树打开。</p>' : '') +
      '<div class="player" id="player"></div>' +
      '</div>');
    renderTopbar();
    // The map has no playback controls, but the doc buttons stay in the same
    // floating bar so 讲义 / 教程 are reachable from every view.
    html('player', docButtons(true) + '<span class="mini">讲义 · 教程 · 点卡片进课看 UML</span>');
    bindDocButtons();
    for (i = 0; i < CURR.length; i++) bindLesson('map-' + CURR[i].id, CURR[i].id);
  }

  function showMap() {
    pause();
    closeUml();
    S.view = 'map';
    renderMap();
    if (S.docKind) openDoc(S.docKind);
  }
  function show(id) {
    if (!S.lessons[id]) return;
    pause();
    closeUml();
    S.data = S.lessons[id];
    renderAll();
    // A 讲义 / 教程 opened on the previous lesson stays open and follows the switch.
    if (S.docKind) openDoc(S.docKind);
    try { if (window.scrollTo) window.scrollTo(0, 0); } catch (e) {}
  }

  /* data.js files call Course.boot(); build.mjs inlines all eight while HOLD
     is on, so they register without eight full renders. */
  function boot(data) {
    if (data && data.id) S.lessons[data.id] = data;
    if (window.WAY2SA_HOLD || !data) return;
    S.data = data;
    renderAll();
  }
  function bootCourse(map, initial) {
    if (map) {
      for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) S.lessons[k] = map[k];
    }
    if (initial === 'map' || !S.lessons[initial]) showMap();
    else show(initial);
  }

  // The modal lives outside #app, so its handlers survive every view switch.
  bindStaticChrome();
  applyTheme();
  watchThemePreference();
  window.Course = {
    boot: boot, bootCourse: bootCourse, show: show, showMap: showMap,
    openDoc: openDoc, closeDoc: closeDoc, openUml: openUml, closeUml: closeUml,
    mdToHtml: mdToHtml
  };
})();
