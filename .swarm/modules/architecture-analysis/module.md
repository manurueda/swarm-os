# Architecture Analysis

Pure, model-free static analysis of a target repository (file/line facts, a regex-derived import graph, and severity-ranked structural 'Signal's + per-module health), plus one model-backed step (refactor.ts) that spawns a read-only reviewer agent per module to confirm/reject those signals and emit structured, actionable refactor proposals rendered as a Markdown report. Four files total, each building on the last: code-stats.ts -> import-graph.ts/signals.ts -> refactor.ts.

## Owns

- `packages/core/src/architecture/**`

## Read first

- `packages/core/src/architecture/signals.ts` — The synthesis point: computeSignals() combines ModuleSpec[], file list, memory stats, code stats and (optionally) the import graph into the ranked Signal[]/ModuleHealth[]/coverage that everything downstream consumes.
- `packages/core/src/architecture/code-stats.ts` — Lowest layer: language-agnostic file/line facts (wc -l based), directory shape, junk-name and repeated-basename heuristics. isCodeFile/isTestFile are used pervasively elsewhere in the module and by ui/snapshot.ts.
- `packages/core/src/architecture/import-graph.ts` — Regex-based per-language (JS/TS + Python) import extraction resolved to real repo files and attributed to modules via isOwned(); also does cycle detection. Explicitly under-reports by design (dynamic imports, barrels, monorepo package resolution are out of scope).
- `packages/core/src/architecture/refactor.ts` — The only model-backed piece: spawns one 'reviewer' AgentRuntime job per module (read-only: Read/Grep/Glob tools only) seeded with that module's signals + memory, parses its structured JSON verdict, and renders REFACTOR.md.

## Depends on

- `swarm-orchestration`
- `runtime`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
