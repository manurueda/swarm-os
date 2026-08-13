/**
 * The local view.
 *
 * What this has to answer, in order, for someone looking at a repository too
 * large to hold in their head:
 *
 *   1. What should I do about it?
 *   2. What is in here?
 *   3. What is already running?
 *
 * An earlier version answered a different question — how big is everything,
 * what imports what — with a treemap, a dependency matrix and a wall of
 * statistics. All true, all interesting, and none of it told anyone what to do
 * next. So the primary object here is a task, not a module: something that is
 * wrong, where it is, and the one command that acts on it.
 *
 * Everything that is not a task, a name, or a number is cut. There is no title
 * block, no section explaining what a section is, no label on a number that
 * speaks for itself.
 *
 * One self-contained file: no server, no network, no build. It opens from disk.
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
<title>${escapeHtml(snapshot.repoName)}</title>
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
/*
 * Dark-first, in the manner of Cursor and agent-orchestrator.
 *
 * Two rules borrowed from the latter and worth stating: hairlines SEPARATE,
 * they do not decorate — white at 7% alpha, below the usual 10%, so card edges
 * recede behind their contents rather than drawing a grid over them. And colour
 * is reserved for status; everything structural is neutral.
 */
:root {
  --bg: #0a0b0d;
  --card: #15171b;
  --card-2: #1b1e23;
  --line: rgba(255,255,255,.07);
  --line-2: rgba(255,255,255,.12);
  --fg: #f4f5f7;
  --fg-muted: #9ba1aa;
  --fg-passive: #646a73;
  --accent: #4d8dff;
  --high: #f87171;
  --warn: #fb923c;
  --ok: #4ade80;
  --radius: 10px;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg: #fcfcfc;
    --card: #ffffff;
    --card-2: #f6f6f7;
    --line: rgba(0,0,0,.08);
    --line-2: rgba(0,0,0,.14);
    --fg: #16181d;
    --fg-muted: #5f646d;
    --fg-passive: #90959e;
    --accent: #2563eb;
    --high: #dc2626;
    --warn: #d97706;
    --ok: #16a34a;
    color-scheme: light;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--fg);
  font: 14px/1.55 var(--sans);
  -webkit-font-smoothing: antialiased;
}
#app { max-width: 880px; margin: 0 auto; padding: 34px 24px 120px; }

/* The repo name is the heading. Nothing else earns that role. */
header { display: flex; align-items: baseline; gap: 11px; margin-bottom: 20px; }
header h1 { font-size: 19px; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
header .sub { color: var(--fg-passive); font-size: 12px; font-family: var(--mono); }

nav { display: flex; gap: 2px; margin-bottom: 20px; }
nav button {
  font: inherit; font-size: 13px; cursor: pointer;
  background: none; border: 0; border-radius: 7px;
  padding: 6px 11px; color: var(--fg-muted);
}
nav button:hover { background: var(--card); color: var(--fg); }
nav button[aria-selected="true"] { background: var(--card-2); color: var(--fg); }
nav button .n { font-family: var(--mono); font-size: 11px; color: var(--fg-passive); margin-left: 6px; }

/* A task: what is wrong, where, and the command that acts on it. */
.task {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 14px 16px; margin-bottom: 8px;
}
.task .top { display: flex; align-items: flex-start; gap: 10px; }
.task .dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; margin-top: 8px; }
.task .dot.high { background: var(--high); }
.task .dot.warn { background: var(--warn); }
.task .dot.info { background: var(--fg-passive); }
.task h2 { font-size: 14px; font-weight: 550; margin: 0; line-height: 1.45; letter-spacing: -0.01em; }
.task .where { color: var(--fg-passive); font-family: var(--mono); font-size: 11.5px; margin-top: 3px; }
.task .why { color: var(--fg-muted); font-size: 13.5px; margin-top: 7px; }
.task .ev { font-family: var(--mono); font-size: 11.5px; color: var(--fg-muted); margin-top: 8px; }
.task .ev div { padding: 1px 0; }

.act { display: flex; align-items: center; gap: 7px; margin-top: 12px; }
code {
  flex: 1; min-width: 0; font-family: var(--mono); font-size: 12px; color: var(--fg);
  background: var(--bg); border: 1px solid var(--line); border-radius: 7px;
  padding: 7px 10px; white-space: pre-wrap; word-break: break-word;
}
button.copy {
  flex: 0 0 auto; font: inherit; font-size: 12.5px; cursor: pointer;
  background: var(--card-2); color: var(--fg-muted);
  border: 1px solid var(--line-2); border-radius: 7px; padding: 7px 13px;
}
button.copy:hover { color: var(--fg); border-color: var(--accent); }
button.copy.done { color: var(--ok); border-color: var(--ok); }

/* Modules: a list, not a chart. A bar is read faster than a number, and the
   number is right beside it anyway. */
.mod {
  display: grid; grid-template-columns: 1fr 110px 54px 32px;
  gap: 14px; align-items: center;
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 12px 16px; margin-bottom: 6px; cursor: pointer;
}
.mod:hover { border-color: var(--line-2); }
.mod .name { font-weight: 550; font-size: 14px; letter-spacing: -0.01em; }
.mod .desc { color: var(--fg-muted); font-size: 12.5px; margin-top: 1px; }
.mod .bar { height: 4px; background: var(--line-2); border-radius: 3px; overflow: hidden; }
.mod .bar > i { display: block; height: 100%; background: var(--accent); }
.mod .num { font-family: var(--mono); font-size: 12px; color: var(--fg-muted); text-align: right; }
.mod .flag { font-family: var(--mono); font-size: 11px; text-align: right; }
.mod .flag.high { color: var(--high); }
.mod .flag.warn { color: var(--warn); }

.detail {
  background: var(--card-2); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 16px 18px; margin: -2px 0 8px;
}
.detail h3 { font-size: 14px; font-weight: 600; margin: 0 0 3px; }
.detail p { color: var(--fg-muted); font-size: 13.5px; margin: 0 0 4px; }
.detail .grp { margin-top: 15px; }
.detail .grp > b { display: block; font-size: 11.5px; color: var(--fg-passive); font-weight: 500; margin-bottom: 6px; }
.detail ul { margin: 0; padding: 0; list-style: none; }
.detail li { font-size: 13px; padding: 5px 0; border-bottom: 1px solid var(--line); }
.detail li:last-child { border-bottom: 0; }
.detail li em { font-style: normal; font-family: var(--mono); font-size: 11px; color: var(--fg-passive); display: block; }
.detail .tags { display: flex; flex-wrap: wrap; gap: 5px; }
.detail .tag {
  font-family: var(--mono); font-size: 11px; color: var(--fg-muted);
  background: var(--bg); border: 1px solid var(--line); border-radius: 5px; padding: 2px 7px;
}

.empty { text-align: center; color: var(--fg-passive); padding: 60px 0; font-size: 13.5px; }
.empty b { display: block; color: var(--fg-muted); font-size: 15px; margin-bottom: 5px; font-weight: 500; }
`;

const SCRIPT = `
const D = JSON.parse(document.getElementById('data').textContent);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n = (v) => (v ?? 0).toLocaleString();
const clip = (s, max) => {
  const flat = String(s ?? '').replace(/\\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '\\u2026';
};

/* ---- tasks -------------------------------------------------------------- */
/* One list, built from everything that represents work: refactor proposals an
   agent already judged real, and structural signals nobody has looked at yet.
   Proposals rank above signals because someone read the code for those. */
function buildTasks() {
  const tasks = [];

  for (const p of D.proposals ?? []) {
    tasks.push({
      rank: p.severity === 'high' ? 0 : p.severity === 'medium' ? 1 : 2,
      level: p.severity === 'high' ? 'high' : p.severity === 'medium' ? 'warn' : 'info',
      title: p.title,
      where: p.module + (p.effort ? ' \\u00b7 ' + p.effort : ''),
      why: p.problem,
      evidence: (p.evidence ?? []).slice(0, 3),
      cmd: 'swarm mission "' + String(p.title).replace(/"/g, "'") + '" --modules ' + p.module,
    });
  }

  for (const m of D.modules) {
    for (const s of m.signals) {
      // Signals the tool resolves itself are not the user's work. Memory
      // pressure is answered by splitting the module into areas, which
      // swarm map now does — once it has, there is nothing left to show.
      if (s.kind === 'memory-pressure' && (m.areas ?? 0) > 0) continue;
      tasks.push({
        rank: s.severity === 'high' ? 3 : s.severity === 'warn' ? 4 : 5,
        level: s.severity === 'high' ? 'high' : s.severity === 'warn' ? 'warn' : 'info',
        kind: s.kind,
        title: humanise(s, m.slug),
        where: m.slug,
        why: '',
        evidence: s.evidence.slice(0, 3),
        cmd: actionFor(s, m.slug),
      });
    }
  }
  for (const s of D.globalSignals) {
    tasks.push({
      rank: s.severity === 'high' ? 3 : s.severity === 'warn' ? 4 : 5,
      level: s.severity === 'high' ? 'high' : s.severity === 'warn' ? 'warn' : 'info',
      kind: s.kind,
      title: humanise(s, ''),
      where: '',
      why: '',
      evidence: s.evidence.slice(0, 3),
      cmd: 'swarm refactor',
    });
  }

  // The same problem across five modules is one thing to decide about, not
  // five cards saying the same sentence with a different name in it.
  const byShape = new Map();
  for (const t of tasks) {
    const shape = t.kind ? t.kind + '|' + t.rank : t.title;
    const seen = byShape.get(shape);
    if (seen) seen.also.push(t.where);
    else byShape.set(shape, { ...t, also: [] });
  }

  return [...byShape.values()]
    .map((t) =>
      t.also.length
        ? {
            ...t,
            title: humaniseKind(t.kind) ?? t.title,
            where: [t.where, ...t.also].join(', '),
            evidence: t.evidence.slice(0, 2),
          }
        : t,
    )
    .sort((a, b) => a.rank - b.rank);
}

/* Wording for a signal that turned out to affect several modules at once. */
function humaniseKind(kind) {
  switch (kind) {
    case 'memory-pressure':   return 'Several modules are too big to remember in one piece';
    case 'god-file':          return 'Several modules have files doing far more than the rest';
    case 'scattered-module':  return 'Several modules are spread across the tree';
    case 'untested-module':   return 'Several modules have no tests';
    case 'repeated-filenames':return 'Several modules repeat the same filenames';
    case 'junk-drawer':       return 'Several modules keep files under names that mean nothing';
    default: return undefined;
  }
}

/* The command that actually resolves this signal, not a generic one. */
function actionFor(s, slug) {
  switch (s.kind) {
    case 'memory-pressure': return 'swarm map --force';
    case 'unowned-files':
    case 'ownership-conflict': return 'swarm map --repartition';
    default: return slug ? 'swarm refactor ' + slug : 'swarm refactor';
  }
}

/* Signal summaries are written for a report. Say the same thing to a person. */
function humanise(s, slug) {
  const m = slug ? slug + ' ' : '';
  switch (s.kind) {
    case 'untested-module':   return m + 'has no tests, so nothing can verify a change here';
    case 'god-file':          return m + 'has files doing far more than the rest';
    case 'import-cycle':      return 'Modules import each other in a circle';
    case 'unowned-files':     return 'Some files belong to no module, so no agent can touch them';
    case 'scattered-module':  return m + 'is spread across the tree instead of living in one place';
    case 'memory-pressure':   return m + 'is too big to remember in one piece — split its memory by area';
    case 'junk-drawer':       return m + 'keeps files under names that mean nothing';
    case 'flat-directory':    return m + 'has a directory with no structure inside it';
    case 'repeated-filenames':return m + 'repeats the same filenames across directories';
    case 'deep-nesting':      return m + 'nests files very deeply';
    case 'ownership-conflict':return 'Two modules claim the same files';
    case 'size-imbalance':    return 'One module is far larger than the rest';
    default:                  return s.summary;
  }
}

/* ---- views -------------------------------------------------------------- */
let tab = 'tasks';
let open = null;

const taskCard = (t) => \`
  <div class="task">
    <div class="top">
      <span class="dot \${t.level}"></span>
      <div style="min-width:0;flex:1">
        <h2>\${esc(t.title)}</h2>
        \${t.where ? \`<div class="where">\${esc(t.where)}</div>\` : ''}
        \${t.why ? \`<div class="why">\${esc(t.why)}</div>\` : ''}
        \${t.evidence.length ? \`<div class="ev">\${t.evidence.map(e => \`<div>\${esc(e)}</div>\`).join('')}</div>\` : ''}
        <div class="act">
          <code>\${esc(t.cmd)}</code>
          <button class="copy" type="button" data-cmd="\${esc(t.cmd)}">Copy</button>
        </div>
      </div>
    </div>
  </div>\`;

const claimList = (list) => list.length
  ? '<ul>' + list.slice(0, 6).map(c =>
      \`<li>\${esc(c.text)}\${c.path ? \`<em>\${esc(c.path)}</em>\` : ''}</li>\`).join('') + '</ul>'
  : '';

const moduleDetail = (m) => {
  const cmd = 'swarm mission "<what you want changed>" --modules ' + m.slug;
  return \`
  <div class="detail">
    <h3>\${esc(m.slug)}</h3>
    <p>\${esc(m.purpose)}</p>
    <div class="act">
      <code>\${esc(cmd)}</code>
      <button class="copy" type="button" data-cmd="\${esc(cmd)}">Copy</button>
    </div>
    \${m.invariants.length ? \`<div class="grp"><b>Never break</b>\${claimList(m.invariants)}</div>\` : ''}
    \${m.gotchas.length ? \`<div class="grp"><b>Watch out</b>\${claimList(m.gotchas)}</div>\` : ''}
    \${m.largest.length ? \`<div class="grp"><b>Biggest files</b><ul>\${
      m.largest.slice(0, 5).map(f => \`<li>\${esc(f.path)}<em>\${n(f.lines)} lines</em></li>\`).join('')
    }</ul></div>\` : ''}
    <div class="grp"><b>Owns</b><div class="tags">\${
      m.owns.map(g => \`<span class="tag">\${esc(g)}</span>\`).join('')}</div></div>
  </div>\`;
};

const moduleRow = (m, max) => {
  const flags = m.signals.filter(s => s.severity !== 'info').length;
  const worst = m.signals.some(s => s.severity === 'high') ? 'high' : 'warn';
  return \`
  <div class="mod" data-slug="\${esc(m.slug)}">
    <div>
      <div class="name">\${esc(m.slug)}</div>
      <div class="desc">\${esc(clip(m.purpose, 76))}</div>
    </div>
    <span class="bar"><i style="width:\${Math.max(3, Math.round((m.files / max) * 100))}%"></i></span>
    <span class="num">\${n(m.files)}</span>
    <span class="flag \${worst}">\${flags ? '\\u25cf ' + flags : ''}</span>
  </div>
  \${open === m.slug ? moduleDetail(m) : ''}\`;
};

function body() {
  if (tab === 'tasks') {
    const tasks = buildTasks();
    return tasks.length
      ? tasks.map(taskCard).join('')
      : '<div class="empty"><b>Nothing to fix</b>Run swarm refactor to look again.</div>';
  }
  if (tab === 'modules') {
    const max = Math.max(...D.modules.map(m => m.files), 1);
    return D.modules.map(m => moduleRow(m, max)).join('');
  }
  return D.missions.length
    ? D.missions.map(x => \`
      <div class="task"><div class="top">
        <span class="dot \${x.status === 'failed' ? 'high' : 'info'}"></span>
        <div style="min-width:0;flex:1">
          <h2>\${esc(x.goal)}</h2>
          <div class="where">\${esc(x.status)} \\u00b7 \${esc(x.modules.join(', '))}</div>
        </div>
      </div></div>\`).join('')
    : '<div class="empty"><b>No missions yet</b>Pick something from Tasks.</div>';
}

function render() {
  const count = buildTasks().length;
  document.getElementById('app').innerHTML = \`
    <header>
      <h1>\${esc(D.repoName)}</h1>
      <span class="sub">\${n(D.totalFiles)} files</span>
    </header>
    <nav>
      <button data-tab="tasks"    aria-selected="\${tab === 'tasks'}">Tasks<span class="n">\${count}</span></button>
      <button data-tab="modules"  aria-selected="\${tab === 'modules'}">Modules<span class="n">\${D.modules.length}</span></button>
      <button data-tab="missions" aria-selected="\${tab === 'missions'}">Missions<span class="n">\${D.missions.length}</span></button>
    </nav>
    <main>\${body()}</main>\`;

  document.querySelectorAll('nav button').forEach(b => {
    b.onclick = () => { tab = b.dataset.tab; open = null; render(); };
  });
  document.querySelectorAll('.mod').forEach(el => {
    el.onclick = () => { open = open === el.dataset.slug ? null : el.dataset.slug; render(); };
  });
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button.copy');
  if (!btn) return;
  e.stopPropagation();
  navigator.clipboard.writeText(btn.dataset.cmd ?? '').then(() => {
    btn.textContent = 'Copied';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1300);
  });
});

render();
`;
