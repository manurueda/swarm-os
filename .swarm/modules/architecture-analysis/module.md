# Architecture Analysis

Pure, model-free static analysis of a target repository, plus one model-backed step that turns those facts into human-actionable refactor proposals. Four files: code-stats.ts (language-agnostic file/line/naming facts via `wc -l` and path heuristics), import-graph.ts (a regex-based, per-language import graph resolved to repo files, module-attributed, with cycle detection), signals.ts (combines the module map + code stats + import graph into a sorted list of severity-ranked `Signal`s plus per-module `ModuleHealth` and ownership coverage), and refactor.ts (spawns a read-only reviewer agent per module, seeded with the signals concerning it, that confirms/rejects them and emits structured refactor proposals, and renders them all into a Markdown report). Consumed by `swarm loop` (packages/core/src/loop/run.ts) for incremental re-analysis and by the UI snapshot builder (packages/core/src/ui/snapshot.ts) for the dashboard, and re-exported wholesale from packages/core/src/index.ts.

## Owns

- `packages/core/src/architecture/**`

## Read first

- `packages/core/src/architecture/signals.ts` — The aggregation point: computeSignals() is what callers actually invoke, taking modules/files/memory/stats/imports and returning the sorted Signal[] plus ModuleHealth used everywhere else (loop, UI, refactor prompts).
- `packages/core/src/architecture/code-stats.ts` — Defines the cheap, no-parser primitives (isCodeFile, isTestFile, countLines, directoryShapes, isJunkName, repeatedBasenames, median) that both signals.ts and import-graph.ts build on.
- `packages/core/src/architecture/import-graph.ts` — buildImportGraph() is the only source of 'real' (non-opinion) module dependency edges and cycles; understand its exclusions (barrels, type-only imports, unresolved specifiers) before trusting or extending it.
- `packages/core/src/architecture/refactor.ts` — reviewModuleStructure() shows the only place in this module that calls an LLM agent; REFACTOR_SCHEMA and renderRefactorReport() define the shape of `.swarm/REFACTOR.md`.

## Depends on

- `swarm-orchestration (packages/core/src/swarm/ownership.ts: isOwned, findOwnershipConflicts, matchesGlob — used to attribute files/imports to module slugs and detect ownership conflicts)`
- `runtime (packages/core/src/runtime/collect.ts: collectAgent/AgentOutcome, and packages/core/src/runtime/system-tier.ts: standaloneAgentPrompt — used by refactor.ts to spawn the read-only reviewer agent)`
- `core types (packages/core/src/types.ts: ModuleSpec, AgentRuntime, SwarmEvent — shared domain types this module's functions are parameterized over)`

## System context

Swarm OS is a CLI + core library that decomposes a target repository into ownable modules and dispatches teams of Claude Code agents ('swarms') to work those modules concurrently in isolated git worktrees, coordinating missions, ownership, and scheduling. It is built for developers who want unattended, context-economical multi-agent refactors and feature work on their own codebases.

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
