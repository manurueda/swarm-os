# UI & Status Rendering — memory

_Durable knowledge for the `ui-observability` swarm. Read on wake, rewritten on sleep._

## Invariants

- renderUi()'s output must contain a literal `</head>` exactly once: packages/cli/src/server.ts does `renderUi(snapshot).replace('</head>', '<script>window.__SWARM__=...</script></head>')` to inject the live-mode auth token. Changing the head markup breaks live-mode token injection silently. <sub>`packages/core/src/ui/render.ts`</sub>
- embed() escapes `<`, `>`, U+2028 and U+2029 before JSON.stringify-ing the snapshot into the inline `<script type="application/json">` block. Any new code path that serializes UiSnapshot into HTML must reuse embed() or risk the page failing to parse (or an injection via a repo name / memory.md text containing `</script>`). <sub>`packages/core/src/ui/render.ts`</sub>
- The client SCRIPT's expected SSE payload shape is `{ running, agents: Record<slug,{state,activity,tokens}>, goal?, missionId?, finished?, error? }`, matching the `LiveState` interface and `/api/events` broadcast in packages/cli/src/server.ts (outside this module). Changing this module's assumptions about that shape breaks the running-mission panel. <sub>`packages/core/src/ui/render.ts`</sub>
- The 'Tasks' tab suppresses a module's memory-pressure signal once `areas > 0`, on the assumption that `swarm map` resolves memory pressure by splitting memory into areas (mapper module, outside this scope). If that splitting behavior changes, this suppression must change with it. <sub>`packages/core/src/ui/render.ts`</sub>
- parseRefactorProposals() is a fallback parser tied character-for-character to the markdown produced by `architecture/refactor.ts#renderRefactorReport` (headings `## Proposals`/`### title`, paragraph labels `**Costs today.**`/`**Change.**`/`**Risk.**`/`**Evidence.**`). It only runs when `.swarm/refactor.json` is absent (pre-existing workspaces); any change to renderRefactorReport's markdown format silently breaks this fallback with no error. <sub>`packages/core/src/ui/snapshot.ts`</sub>
- splitClaims()/extractSection() parse a module's memory.md by finding `## `-headings whose text starts with 'invariant' or 'landmark' (case-insensitive) and then bullet lines (`- `) under them, skipping placeholder lines matching `^_.*_$`. This is a fragile textual contract with however memory.md is authored elsewhere (mapper/analyst modules, outside this scope). <sub>`packages/core/src/ui/snapshot.ts`</sub>

## Gotchas

- buildTasks() in the client script dedupes signal-derived tasks by shape key `kind + '|' + rank`, ignoring module — two structural signals of the same kind/severity across unrelated modules silently collapse into one card with a generic 'Several modules…' title (via humaniseKind) and only the first 2 evidence lines kept, losing per-module detail. <sub>`packages/core/src/ui/render.ts`</sub>
- Proposal-derived tasks key by `t.title` (normally unique per proposal) so they never get merged the way signal tasks do, and always sort above merged signal tasks (rank 0-2 vs 3-5) even if a signal is objectively more severe — the code comment justifies this as 'someone read the code for those'. <sub>`packages/core/src/ui/render.ts`</sub>
- renderUi's header comment claims the page is fully self-contained ('no server, no network, no build... it opens from disk'), but the SCRIPT unconditionally references `window.__SWARM__` and, when set, opens an EventSource to `/api/events` and POSTs to `/api/mission`. Those endpoints only exist under packages/cli/src/server.ts; the static-file case works only because `LIVE` (window.__SWARM__) is undefined there, so that whole branch is skipped at runtime. <sub>`packages/core/src/ui/render.ts`</sub>
- buildSnapshot() returns `modules` sorted by `files` descending, and the client's Modules-tab bar chart computes `max = Math.max(...D.modules.map(m => m.files))` from that same array — the first row's bar is always 100% width. Changing the sort in snapshot.ts silently changes visual module ranking on the page (bar widths stay mathematically correct either way). <sub>`packages/core/src/ui/snapshot.ts`</sub>
- readProposalsJson() returns undefined on ANY JSON parse error, missing 'modules' array, or unexpected shape in `.swarm/refactor.json` — a malformed refactor.json is silently treated identically to a missing one and falls through to the markdown-parsing fallback, with no error surfaced anywhere. <sub>`packages/core/src/ui/snapshot.ts`</sub>
- ModuleView.contextTokens is built (not estimated): buildSnapshot() calls `buildContextPack` (from `swarm/manager.js`, outside this module) per module to compute the actual token cost an agent would receive on wake, rather than approximating it. This is comparatively expensive (reads files, applies ownership/index limits) and runs once per module on every snapshot build, including for the static `swarm ui` command. <sub>`packages/core/src/ui/snapshot.ts`</sub>

## Landmarks

- `packages/core/src/ui/snapshot.ts` — Data-assembly layer: UiSnapshot/ModuleView/ProposalView types, buildSnapshot(), and readProposalsJson/parseRefactorProposals fallback logic for recovering refactor proposals.
- `packages/core/src/ui/render.ts` — Presentation layer: renderUi(), the embed()/escapeHtml() sanitizers, the inline CSS string (CSS), and the inline client-side script string (SCRIPT) that does tab switching, task building/deduping, module detail rendering, the SVG 'map' view, and SSE-driven live mode.

## Public interface

- buildSnapshot(workspace: Workspace, config: SwarmConfig): Promise<UiSnapshot> — re-exported from packages/core/src/index.ts
- renderUi(snapshot: UiSnapshot): string — re-exported from packages/core/src/index.ts
- UiSnapshot, ModuleView types — re-exported from packages/core/src/index.ts
- ProposalView type — exported from ui/snapshot.ts but NOT re-exported through core's index.ts barrel
- Consumed by packages/cli/src/commands/ui.ts (static `swarm ui` output, writes renderUi(buildSnapshot(...)) to disk)
- Consumed by packages/cli/src/server.ts (live server: injects window.__SWARM__ token via string-replace into renderUi's HTML, and independently serves buildSnapshot() JSON at GET /api/snapshot and GET /api/events, and accepts POST /api/mission that the client script calls)

---

_Surveyed 2026-08-15 by the `ui-observability` analyst, reading only this module's paths._
