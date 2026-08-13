/**
 * A single self-contained HTML file.
 *
 * No server, no build step, no network. The snapshot is embedded as JSON and
 * the page renders itself, so it works offline, can be opened straight from
 * disk, and can be committed or emailed if you want someone else to see the
 * shape of a codebase.
 *
 * Design rule, applied throughout: the data is the interface. No title block
 * restating the tool's name, no subtitle restating the title, no paragraph
 * explaining what a section is when the section's contents already say it. A
 * label appears only where the number next to it would otherwise be ambiguous.
 * Every pixel that is not a fact about this repository is a pixel spent.
 */

import type { UiSnapshot } from './snapshot.js';

/**
 * JSON safe to embed inside a <script> tag.
 *
 * `</` would close the script element early, and U+2028/U+2029 are line
 * terminators in JavaScript string context but not in JSON — both have to be
 * escaped or the page silently fails to parse.
 */
function embed(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderUi(snapshot: UiSnapshot): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(snapshot.repoName)} — swarm</title>
<style>${CSS}</style>
</head>
<body>
<div id="app"></div>
<script id="data" type="application/json">${embed(snapshot)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

const CSS = `
:root {
  --bg: #fbfbfa;
  --panel: #ffffff;
  --line: #e4e2dd;
  --ink: #1a1917;
  --ink-2: #6b675f;
  --ink-3: #9b968c;
  --accent: #3b5bdb;
  --ok: #2f9e44;
  --warn: #e8a33d;
  --high: #d64545;
  --sleep: #c9c5bd;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
}
:root:not([data-theme="light"]) {
  @media (prefers-color-scheme: dark) {
    --bg: #16161a;
    --panel: #1d1d22;
    --line: #2e2e35;
    --ink: #eceaf0;
    --ink-2: #a09daa;
    --ink-3: #6e6b78;
    --accent: #7c93f5;
    --ok: #5fc97a;
    --warn: #e9b45a;
    --high: #f0736b;
    --sleep: #3a3a44;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font: 13px/1.5 var(--sans);
  -webkit-font-smoothing: antialiased;
}
#app { max-width: 1400px; margin: 0 auto; padding: 18px 20px 80px; }

/* One line of facts. No heading above it — the repo name IS the heading. */
.bar {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 14px;
  padding-bottom: 12px; margin-bottom: 18px;
  border-bottom: 1px solid var(--line);
}
.bar .repo { font-weight: 600; font-size: 15px; letter-spacing: -0.01em; }
.bar .f { color: var(--ink-2); font-family: var(--mono); font-size: 12px; }
.bar .f b { color: var(--ink); font-weight: 600; }
.bar .spacer { flex: 1; }
.bar .path { color: var(--ink-3); font-family: var(--mono); font-size: 11px; }

.cols { display: grid; grid-template-columns: 1fr 380px; gap: 20px; align-items: start; }
@media (max-width: 1040px) { .cols { grid-template-columns: 1fr; } }

/* Treemap: area is file count, so "where is the code" is answered by looking.
   Cells with room also list their heaviest files — the same question one level
   down, answered in space that would otherwise be blank. */
#map { position: relative; width: 100%; height: 420px; }
.cell {
  position: absolute; overflow: hidden; cursor: pointer;
  border: 1px solid var(--bg); border-radius: 3px;
  padding: 7px 8px; transition: filter .12s;
}
.cell:hover { filter: brightness(1.08); }
.cell.sel { outline: 2px solid var(--accent); outline-offset: -2px; z-index: 2; }
.cell .n { font-weight: 600; font-size: 12px; line-height: 1.25; }
.cell .m { font-family: var(--mono); font-size: 10.5px; opacity: .72; margin-top: 2px; }
.cell .dot { position: absolute; top: 7px; right: 7px; width: 6px; height: 6px; border-radius: 50%; }
.cell.small { padding: 4px 5px; }
.cell.small .m { display: none; }
.cell.tiny .n { font-size: 10px; }
.cell .files { margin-top: 8px; }
.cell .fr { display: grid; grid-template-columns: 1fr 46px 34px; gap: 6px; align-items: center; height: 14px; }
.cell .fp { font-family: var(--mono); font-size: 10px; opacity: .62; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell .fb { height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; }
.cell .fb > i { display: block; height: 100%; opacity: .8; }
.cell .fn { font-family: var(--mono); font-size: 10px; opacity: .55; text-align: right; }

.sect { margin-top: 26px; }
.sect > .lbl {
  font-family: var(--mono); font-size: 10.5px; text-transform: uppercase;
  letter-spacing: .07em; color: var(--ink-3); margin-bottom: 8px;
}

table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th {
  text-align: left; font-weight: 500; color: var(--ink-3);
  font-family: var(--mono); font-size: 10.5px; text-transform: uppercase;
  letter-spacing: .06em; padding: 0 8px 6px 0; border-bottom: 1px solid var(--line);
}
td { padding: 5px 8px 5px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
td.num, th.num { text-align: right; font-family: var(--mono); font-size: 12px; }
tr.row { cursor: pointer; }
tr.row:hover td { background: var(--panel); }
tr.row.sel td { background: var(--panel); box-shadow: inset 2px 0 0 var(--accent); }
.mono { font-family: var(--mono); }
.dim { color: var(--ink-2); }
.dim3 { color: var(--ink-3); }

.sev { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.sev.high { background: var(--high); }
.sev.warn { background: var(--warn); }
.sev.info { background: var(--ink-3); }
.sev.ok { background: var(--ok); }

/* Detail panel. Sticky so the map stays usable while reading. */
#panel {
  position: sticky; top: 18px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 14px 15px; max-height: calc(100vh - 40px); overflow-y: auto;
}
#panel h2 { margin: 0 0 2px; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
#panel .purpose { color: var(--ink-2); font-size: 12.5px; margin: 0 0 12px; }
#panel .grp { margin-top: 14px; }
#panel .grp > .lbl {
  font-family: var(--mono); font-size: 10px; text-transform: uppercase;
  letter-spacing: .07em; color: var(--ink-3); margin-bottom: 5px;
}
#panel ul { margin: 0; padding: 0; list-style: none; }
#panel li { padding: 3px 0; font-size: 12.5px; border-bottom: 1px solid var(--line); }
#panel li:last-child { border-bottom: 0; }
#panel li .cite { font-family: var(--mono); font-size: 10.5px; color: var(--ink-3); display: block; }
#panel .stats { display: flex; flex-wrap: wrap; gap: 10px 16px; font-family: var(--mono); font-size: 11.5px; }
#panel .stats i { font-style: normal; color: var(--ink-3); }
.empty { color: var(--ink-3); font-size: 12px; }

.chip {
  display: inline-block; font-family: var(--mono); font-size: 10.5px;
  padding: 1px 6px; border: 1px solid var(--line); border-radius: 3px;
  margin: 0 4px 4px 0; color: var(--ink-2);
}
.chip.link { cursor: pointer; }
.chip.link:hover { border-color: var(--accent); color: var(--accent); }

/* Dependency matrix. Row imports column; a cycle is a pair either side of the
   diagonal, which is far easier to see than crossing chords. */
.matrix { width: auto; border-collapse: collapse; font-family: var(--mono); font-size: 11px; margin-top: 4px; }
.matrix th { border: 0; padding: 0; text-transform: none; letter-spacing: 0; }
.matrix th.r { text-align: right; padding: 0 8px 0 0; color: var(--ink-2); font-weight: 500; white-space: nowrap; }
.matrix th.v { vertical-align: bottom; padding: 0 0 5px; height: 1px; }
.matrix th.v > span {
  writing-mode: vertical-rl; transform: rotate(180deg);
  white-space: nowrap; color: var(--ink-2); font-weight: 500;
}
.matrix td {
  width: 22px; height: 22px; padding: 0; text-align: center;
  border: 1px solid var(--line); color: var(--ink-3);
}
.matrix td.diag { background: var(--line); border-color: var(--line); }
.matrix td.on { background: color-mix(in srgb, var(--accent) calc(var(--a) * 100%), transparent); color: var(--ink); }
.matrix td.on.cyc { background: color-mix(in srgb, var(--high) calc(var(--a) * 100%), transparent); }

.sig { padding: 7px 0; border-bottom: 1px solid var(--line); }
.sig:last-child { border-bottom: 0; }
.sig .h { font-size: 12.5px; }
.sig .k { font-family: var(--mono); font-size: 10.5px; color: var(--ink-3); margin-right: 8px; }
.sig .ev { font-family: var(--mono); font-size: 11px; color: var(--ink-2); margin-top: 3px; padding-left: 14px; }
.sig .ev div { padding: 1px 0; }

.bars { display: flex; flex-direction: column; gap: 3px; }
.barrow { display: grid; grid-template-columns: 120px 1fr 54px; gap: 8px; align-items: center; font-size: 12px; }
.barrow .t { width: 100%; height: 9px; background: var(--line); border-radius: 2px; overflow: hidden; }
.barrow .t > i { display: block; height: 100%; background: var(--accent); }
.barrow .v { font-family: var(--mono); font-size: 11px; color: var(--ink-2); text-align: right; }

/* Copyable CLI commands, attached to whatever they act on. */
.cmd { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.cmd code {
  flex: 1; min-width: 0; font-family: var(--mono); font-size: 11px; color: var(--ink);
  background: var(--bg); border: 1px solid var(--line); border-radius: 3px;
  padding: 3px 7px; white-space: pre-wrap; word-break: break-all;
}
.copy-btn {
  flex: 0 0 auto; font-family: var(--mono); font-size: 10.5px; cursor: pointer;
  color: var(--ink-2); background: var(--panel); border: 1px solid var(--line);
  border-radius: 3px; padding: 3px 8px; transition: color .12s, border-color .12s;
}
.copy-btn:hover { color: var(--accent); border-color: var(--accent); }
.copy-btn.copied { color: var(--ok); border-color: var(--ok); }

.proposal { padding: 9px 0; border-bottom: 1px solid var(--line); }
.proposal:last-child { border-bottom: 0; }
.proposal .h { font-size: 12.5px; }
.proposal .k { font-family: var(--mono); font-size: 10.5px; color: var(--ink-3); margin-right: 8px; }
.proposal .eff { font-family: var(--mono); font-size: 10.5px; color: var(--ink-3); margin-left: 6px; }
.proposal .body { color: var(--ink-2); font-size: 12px; margin-top: 3px; }
.proposal .body div { padding: 1px 0; }
`;

const SCRIPT = `
const D = JSON.parse(document.getElementById('data').textContent);
const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n = (v) => (v ?? 0).toLocaleString();
const k = (v) => v >= 1000 ? (v/1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(v ?? 0);
const HUE = { ok: 'var(--sleep)', warn: 'var(--warn)', high: 'var(--high)' };

let selected = D.modules[0]?.slug ?? null;

/* ---- actionable commands ------------------------------------------------ */
const missionCmd = (slug) => 'swarm mission "<your goal>" --modules ' + slug;
const refactorCmd = (slug) => 'swarm refactor ' + slug;
const cmdRow = (cmd) => \`<div class="cmd"><code>\${esc(cmd)}</code><button class="copy-btn" type="button" data-cmd="\${esc(cmd)}">Copy</button></div>\`;

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const cmd = btn.dataset.cmd ?? '';
  navigator.clipboard.writeText(cmd).then(() => {
    const prev = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => { btn.textContent = prev; btn.classList.remove('copied'); }, 1200);
  });
});

/* ---- squarified treemap ------------------------------------------------ */
function treemap(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let rest = items.slice().sort((a, b) => b.value - a.value);
  let area = { x, y, w, h };
  let scale = (w * h) / total;

  const worst = (row, len) => {
    const sum = row.reduce((s, r) => s + r.value, 0) * scale;
    const max = Math.max(...row.map(r => r.value)) * scale;
    const min = Math.min(...row.map(r => r.value)) * scale;
    return Math.max((len * len * max) / (sum * sum), (sum * sum) / (len * len * min));
  };

  while (rest.length) {
    const vertical = area.w >= area.h;
    const len = vertical ? area.h : area.w;
    let row = [rest[0]];
    while (rest.length > row.length && worst(row, len) >= worst(row.concat(rest[row.length]), len)) {
      row = row.concat(rest[row.length]);
    }
    const sum = row.reduce((s, r) => s + r.value, 0) * scale;
    const thick = len ? sum / len : 0;
    let off = 0;
    for (const item of row) {
      const share = len ? (item.value * scale) / thick : 0;
      out.push(vertical
        ? { item, x: area.x, y: area.y + off, w: thick, h: share }
        : { item, x: area.x + off, y: area.y, w: share, h: thick });
      off += share;
    }
    if (vertical) { area.x += thick; area.w -= thick; } else { area.y += thick; area.h -= thick; }
    rest = rest.slice(row.length);
  }
  return out;
}

function drawMap() {
  const el = document.getElementById('map');
  if (!el) return;
  el.innerHTML = '';
  const w = el.clientWidth, h = el.clientHeight;
  const items = D.modules.map(m => ({ value: Math.max(m.files, 1), m }));
  for (const c of treemap(items, 0, 0, w, h)) {
    const m = c.item.m;
    const small = c.w < 110 || c.h < 46;
    const tiny = c.w < 70 || c.h < 30;
    // A large cell has room to answer the next question too: which files
    // inside it hold the mass. Empty space in the biggest module is exactly
    // the space where that belongs.
    const room = Math.floor((c.h - 46) / 15);
    const inner = (!small && room >= 2 && m.largest.length)
      ? '<div class="files">' + m.largest.slice(0, Math.min(room, 6)).map(f =>
          \`<div class="fr"><span class="fp">\${esc(f.path.split('/').slice(-2).join('/'))}</span><span class="fb"><i style="width:\${Math.round((f.lines / (m.largest[0].lines || 1)) * 100)}%;background:\${HUE[m.health]}"></i></span><span class="fn">\${n(f.lines)}</span></div>\`).join('') + '</div>'
      : '';
    const cell = $(\`<div class="cell \${small ? 'small' : ''} \${tiny ? 'tiny' : ''} \${m.slug === selected ? 'sel' : ''}"
      style="left:\${c.x}px;top:\${c.y}px;width:\${c.w - 2}px;height:\${c.h - 2}px;background:\${HUE[m.health]}22;border-color:\${HUE[m.health]}55">
      <div class="n">\${esc(m.slug)}</div>
      <div class="m">\${n(m.files)} files · \${k(m.lines)} lines</div>
      \${inner}
      \${m.health !== 'ok' ? \`<span class="dot" style="background:\${HUE[m.health]}"></span>\` : ''}
    </div>\`);
    cell.onclick = () => select(m.slug);
    el.appendChild(cell);
  }
}

/* ---- dependency matrix -------------------------------------------------- */
/* A ring of chords is unreadable past a handful of edges. A matrix gives the
   exact count per pair, and a cycle appears as a filled cell on both sides of
   the diagonal — which is the thing you actually want to spot. */
function drawGraph() {
  const el = document.getElementById('graph');
  if (!el || D.modules.length === 0) return;
  const order = D.modules.map(m => m.slug);
  const at = {};
  for (const e of D.edges) at[e.from + '>' + e.to] = e.count;
  const inCycle = new Set();
  for (const cyc of D.cycles) for (let i = 0; i < cyc.length - 1; i++) inCycle.add(cyc[i] + '>' + cyc[i + 1]);
  const max = Math.max(1, ...D.edges.map(e => e.count));

  let h = '<table class="matrix"><thead><tr><th></th>' +
    order.map(s2 => \`<th class="v"><span>\${esc(s2)}</span></th>\`).join('') + '</tr></thead><tbody>';
  for (const from of order) {
    h += \`<tr><th class="r">\${esc(from)}</th>\`;
    for (const to of order) {
      if (from === to) { h += '<td class="diag"></td>'; continue; }
      const count = at[from + '>' + to];
      const cyc = inCycle.has(from + '>' + to);
      h += count
        ? \`<td class="on \${cyc ? 'cyc' : ''}" style="--a:\${(0.25 + 0.75 * count / max).toFixed(2)}" title="\${esc(from)} imports \${esc(to)} — \${count}">\${count}</td>\`
        : '<td></td>';
    }
    h += '</tr>';
  }
  el.innerHTML = h + '</tbody></table>';
}

/* ---- detail panel ------------------------------------------------------ */
function drawPanel() {
  const el = document.getElementById('panel');
  const m = D.modules.find(x => x.slug === selected);
  if (!el || !m) return;
  const claims = (list) => list.length
    ? '<ul>' + list.map(c => \`<li>\${esc(c.text)}\${c.path ? \`<span class="cite">\${esc(c.path)}\${c.source === 'doc' ? ' · doc' : ''}</span>\` : ''}</li>\`).join('') + '</ul>'
    : '<div class="empty">none recorded</div>';

  el.innerHTML = \`
    <h2>\${esc(m.slug)}</h2>
    <p class="purpose">\${esc(m.purpose)}</p>
    <div class="grp"><div class="lbl">run a mission</div>\${cmdRow(missionCmd(m.slug))}</div>
    <div class="stats">
      <span><i>files</i> \${n(m.files)}</span>
      <span><i>lines</i> \${n(m.lines)}</span>
      <span><i>tests</i> \${n(m.testFiles)}</span>
      <span><i>memory</i> \${k(m.memoryTokens)}</span>
      <span><i>state</i> \${esc(m.state)}</span>
    </div>
    \${m.signals.length ? \`<div class="grp"><div class="lbl">signals</div>\${m.signals.map(s =>
      \`<div class="sig"><div class="h"><span class="sev \${s.severity}"></span>\${esc(s.summary)}</div>
       <div class="ev">\${s.evidence.slice(0, 4).map(e => \`<div>\${esc(e)}</div>\`).join('')}</div></div>\`).join('')}</div>\` : ''}
    \${m.largest.length ? \`<div class="grp"><div class="lbl">largest files</div><div class="bars">\${
      m.largest.map(f => \`<div class="barrow"><span class="mono dim" title="\${esc(f.path)}">\${esc(f.path.split('/').pop())}</span>
        <span class="t"><i style="width:\${Math.round((f.lines / (m.largest[0].lines || 1)) * 100)}%"></i></span>
        <span class="v">\${n(f.lines)}</span></div>\`).join('')}</div></div>\` : ''}
    <div class="grp"><div class="lbl">invariants</div>\${claims(m.invariants)}</div>
    <div class="grp"><div class="lbl">gotchas</div>\${claims(m.gotchas)}</div>
    \${m.landmarks.length ? \`<div class="grp"><div class="lbl">landmarks</div><ul>\${
      m.landmarks.map(l => \`<li>\${esc(l.replace(/\\s*<sub>.*?<\\/sub>\\s*$/, ''))}</li>\`).join('')}</ul></div>\` : ''}
    \${(m.importsFrom.length || m.importedBy.length) ? \`<div class="grp"><div class="lbl">imports</div>
      \${m.importsFrom.map(d => \`<span class="chip link" data-go="\${esc(d.slug)}">→ \${esc(d.slug)} ·\${d.count}</span>\`).join('')}
      \${m.importedBy.map(d => \`<span class="chip link" data-go="\${esc(d.slug)}">← \${esc(d.slug)} ·\${d.count}</span>\`).join('')}
    </div>\` : ''}
    <div class="grp"><div class="lbl">owns</div>\${m.owns.map(g => \`<span class="chip">\${esc(g)}</span>\`).join('')}</div>
  \`;
  el.querySelectorAll('[data-go]').forEach(c => { c.onclick = () => select(c.dataset.go); });
  el.scrollTop = 0;
}

function select(slug) {
  selected = slug;
  drawMap();
  drawPanel();
  document.querySelectorAll('tr.row').forEach(r => r.classList.toggle('sel', r.dataset.slug === slug));
}

/* ---- page -------------------------------------------------------------- */
function render() {
  const app = document.getElementById('app');
  const sleeping = D.modules.filter(m => m.state === 'sleeping').length;
  const rows = D.modules.map(m => \`
    <tr class="row" data-slug="\${esc(m.slug)}">
      <td><span class="sev \${m.health}"></span><b>\${esc(m.slug)}</b></td>
      <td class="num">\${n(m.files)}</td>
      <td class="num">\${n(m.lines)}</td>
      <td class="num">\${m.testFiles ? n(m.testFiles) : '<span class="dim3">0</span>'}</td>
      <td class="num">\${k(m.memoryTokens)}</td>
      <td class="dim" style="max-width:340px">\${esc(m.purpose.slice(0, 110))}</td>
    </tr>\`).join('');

  app.innerHTML = \`
    <div class="bar">
      <span class="repo">\${esc(D.repoName)}</span>
      <span class="f"><b>\${n(D.totalFiles)}</b> files</span>
      <span class="f"><b>\${k(D.totalLines)}</b> lines</span>
      <span class="f"><b>\${D.modules.length}</b> modules</span>
      <span class="f"><b>\${sleeping}</b> sleeping</span>
      <span class="f"><b>\${k(D.memoryTokens)}</b> memory</span>
      <span class="f"><b>\${Math.round(D.coverage * 100)}%</b> owned</span>
      <span class="spacer"></span>
      <span class="path">\${esc(D.repoRoot)}</span>
    </div>

    <div class="cols">
      <div>
        <div id="map"></div>

        <div class="sect">
          <table>
            <thead><tr>
              <th>module</th><th class="num">files</th><th class="num">lines</th>
              <th class="num">tests</th><th class="num">mem</th><th></th>
            </tr></thead>
            <tbody>\${rows}</tbody>
          </table>
        </div>

        \${D.edges.length ? '<div class="sect"><div class="lbl">imports · row → column</div><div id="graph"></div></div>' : ''}

        \${D.proposals.length ? \`<div class="sect"><div class="lbl">refactor proposals</div>\${
          D.proposals.map(p => \`<div class="proposal">
            <div class="h"><span class="sev \${p.severity === 'high' ? 'high' : p.severity === 'medium' ? 'warn' : 'info'}"></span><span class="k">\${esc(p.module)}</span>\${esc(p.title)}<span class="eff">\${esc(p.effort)}</span></div>
            <div class="body"><div>\${esc(p.problem)}</div><div>→ \${esc(p.change)}</div></div>
            \${cmdRow(refactorCmd(p.module))}
          </div>\`).join('')}</div>\` : ''}

        \${D.globalSignals.length ? \`<div class="sect"><div class="lbl">repository</div>\${
          D.globalSignals.map(s => \`<div class="sig"><div class="h"><span class="sev \${s.severity}"></span><span class="k">\${esc(s.kind)}</span>\${esc(s.summary)}</div>
          <div class="ev">\${s.evidence.slice(0, 5).map(e => \`<div>\${esc(e)}</div>\`).join('')}</div></div>\`).join('')}</div>\` : ''}

        \${D.missions.length ? \`<div class="sect"><div class="lbl">missions</div><table><tbody>\${
          D.missions.map(x => \`<tr><td class="mono dim">\${esc(x.id)}</td><td>\${esc(x.status)}</td>
          <td class="dim">\${x.modules.map(s => esc(s)).join(', ')}</td></tr>\`).join('')}</tbody></table></div>\` : ''}
      </div>

      <div id="panel"></div>
    </div>
  \`;

  app.querySelectorAll('tr.row').forEach(r => { r.onclick = () => select(r.dataset.slug); });
  drawMap();
  drawGraph();
  drawPanel();
  select(selected);
}

render();
let t; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { drawMap(); drawGraph(); }, 120); });
`;
