# UI & Status Rendering — memory

_Durable knowledge for the `ui-observability` swarm. Read on wake, rewritten on sleep._

## Invariants

- embed() must escape `<`, `>`, U+2028 and U+2029 before interpolating JSON into the inline <script type="application/json"> tag — otherwise `</script` truncates the page or the JS parser chokes on raw line-terminator characters inside a JSON string. <sub>`packages/core/src/ui/render.ts`</sub>
- buildSnapshot's proposals field prefers the structured `.swarm/refactor.json` artifact (readProposalsJson) and only falls back to regex-parsing `.swarm/REFACTOR.md` (parseRefactorProposals) for older workspaces; the markdown parser is tightly coupled to the exact heading/paragraph shape written by architecture/refactor.ts#renderRefactorReport (`## Proposals`, `### <title>`, backtick-module · **severity** · effort meta line, `**Costs today.**`/`**Change.**`/`**Risk.**`/`**Evidence.**` paragraph labels) — if that renderer's format changes, this parser silently returns fewer/no proposals. <sub>`packages/core/src/ui/snapshot.ts`</sub>
- ModuleView.contextTokens is built by actually calling swarm/manager.ts's buildContextPack() for every module (not estimated), because the whole point of the UI's 'on wake' bar is showing what an agent truly receives — do not replace with a cheaper heuristic. <sub>`packages/core/src/ui/snapshot.ts`</sub>
- invariants vs gotchas in ModuleView are split from the module's memory.md by re-parsing which claim texts fall under a heading starting with 'invariant' (splitClaims/extractSection) — claim ordering/section-heading conventions in memory.md (produced by swarm/analyst.ts) must be preserved or claims silently land in the wrong bucket. <sub>`packages/core/src/ui/snapshot.ts`</sub>
- Signals with kind 'memory-pressure' are filtered out of the client-side task list once a module has areas > 0, because swarm/areas.ts splitting is considered the resolution — this dedup/suppression logic lives only in render.ts's SCRIPT (buildTasks), not in snapshot.ts, so the raw signal is still present in the snapshot even when hidden in the UI. <sub>`packages/core/src/ui/render.ts`</sub>

## Gotchas

- ProposalView is exported from snapshot.ts but is NOT re-exported from packages/core/src/index.ts (only buildSnapshot, UiSnapshot, ModuleView, and renderUi are). A consumer needing the proposal shape must import it from the deep path or infer it from UiSnapshot['proposals']. <sub>`packages/core/src/index.ts`</sub>
- renderUi() produces a page that is inert (static) by default; 'live mode' is entirely opt-in via a `window.__SWARM__ = {token}` script injected by the CLI (packages/cli/src/server.ts) into the same HTML before `</head>`. render.ts's SCRIPT checks `window.__SWARM__` at load time — if that global isn't present, the launcher/running-panel/EventSource code paths are simply skipped, so the identical renderUi() output serves both `swarm ui` (static file) and `swarm ui --serve` (live). <sub>`packages/core/src/ui/render.ts`</sub>
- Task list building in the client SCRIPT deduplicates identical signal kinds across modules by grouping on `kind + '|' + rank` (or exact title for proposals) and rewriting the title via humaniseKind() — adding a new Signal kind in architecture/signals.ts without adding matching humanise()/humaniseKind()/actionFor() cases here causes it to fall through to the raw `s.summary` string and a generic `swarm refactor <slug>` command. <sub>`packages/core/src/ui/render.ts`</sub>
- buildSnapshot re-derives almost everything from scratch on every call (buildDigest, countLines, buildImportGraph, computeSignals, buildContextPack per module) rather than reading cached state — it is not cheap, and packages/cli/src/server.ts calls it fresh on every GET / and every GET /api/snapshot request. <sub>`packages/core/src/ui/snapshot.ts`</sub>
- The 'unowned files' breakdown (unownedTop) buckets by the file's top-level path segment only (`file.split('/')[0]`), so two unowned files in different subdirectories of the same top-level dir are merged into one bucket regardless of how deep or unrelated they actually are. <sub>`packages/core/src/ui/snapshot.ts`</sub>

## Landmarks

- `packages/core/src/ui/snapshot.ts` — Defines ModuleView, ProposalView, UiSnapshot interfaces and buildSnapshot(); also contains parseRefactorProposals(), a markdown scraper that recovers structured proposals from `.swarm/REFACTOR.md` as a fallback when refactor.json is absent
- `packages/core/src/ui/render.ts` — renderUi(); contains the embed() helper for safely inlining JSON in a <script> tag, the full CSS template string, and the full client-side SCRIPT template string (tabs: Tasks/Map/Modules/Missions, task-list dedup logic, the SVG 'map' view, live-mode EventSource wiring)

## Public interface

- buildSnapshot(workspace: Workspace, config: SwarmConfig): Promise<UiSnapshot> — re-exported from packages/core/src/index.ts
- renderUi(snapshot: UiSnapshot): string — re-exported from packages/core/src/index.ts
- UiSnapshot, ModuleView types — re-exported from packages/core/src/index.ts
- ProposalView type — exported from ui/snapshot.ts directly but not from the core barrel
- Consumed by packages/cli/src/commands/ui.ts (writes renderUi(buildSnapshot(...)) to view.html for static `swarm ui`) and packages/cli/src/server.ts (calls both on every request/at startup for `swarm ui --serve`, and injects `window.__SWARM__={token}` into the returned HTML before serving)

---

_Surveyed 2026-08-15 by the `ui-observability` analyst, reading only this module's paths._
