# UI & Status Rendering

Two-file module that (1) assembles a fully-serializable UiSnapshot of a Swarm OS `.swarm/` workspace — modules, structural signals, import graph, missions, refactor proposals, memory-claim excerpts, config, token budgets — by re-running/reading the mapper, architecture-analysis and swarm sub-packages (snapshot.ts), and (2) renders that snapshot into one self-contained dark-themed HTML/CSS/JS string with no server, build step or external assets, embedding the JSON snapshot inline (render.ts). The rendered page's client-side JS optionally goes 'live' (SSE + fetch) when a `window.__SWARM__` token is injected by the CLI's server.ts wrapper, but render.ts itself has no knowledge of networking beyond that hook.

## Owns

- `packages/core/src/ui/**`

## Read first

- `packages/core/src/ui/snapshot.ts` — buildSnapshot(workspace, config) — the only way to produce a UiSnapshot; shows exactly which sibling modules (mapper, architecture, swarm, runtime) are re-invoked and how their outputs are merged and shaped for the UI
- `packages/core/src/ui/render.ts` — renderUi(snapshot) — the entire HTML/CSS/client-JS page as template literals; also documents the module's design philosophy in its header comment (tasks over dashboards)

## Depends on

- `mapper`
- `architecture-analysis`
- `swarm-orchestration`
- `workspace-git`
- `runtime`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
