# Architecture Analysis — memory

_Durable knowledge for the `architecture-analysis` swarm. Read on wake, rewritten on sleep._

## Invariants

- computeSignals() output is always sorted by severity (high, warn, info in that order) — signals.sort() runs unconditionally at the end of computeSignals. <sub>`packages/core/src/architecture/signals.ts`</sub>
- Signal.module is only set for module-scoped signals; repo-wide signals (unowned-files, ownership-conflict, size-imbalance, import-cycle) have no module field. Consumers (e.g. renderRefactorReport's 'unreviewed' filter) rely on this to separate the two. <sub>`packages/core/src/architecture/signals.ts`</sub>
- buildImportGraph edges only ever connect two distinct modules (moduleOf(target) === fromModule edges are dropped) and only cover files owned by some module (fromModule undefined => file skipped entirely) — files not covered by any ModuleSpec.owns produce no edges at all, even to each other. <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- `import type`/`export type` specifiers and barrel files (>=3 statements, and re-exports >=60% of them) are deliberately excluded from import-graph extraction to avoid inventing coupling — this is intentional under-reporting, not a bug. <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- dependsOn declared in ModuleSpec/ownership.yaml is never used to build signals; dependency-shape signals (hub-module, import-cycle) are only emitted when ComputeSignalsInput.imports is supplied, i.e. built from real regex-extracted edges, not analyst opinion. <sub>`packages/core/src/architecture/signals.ts`</sub>
- codeSignals() (god-file, junk-drawer, flat-directory, repeated-filenames, untested-module, deep-nesting) is only computed when ComputeSignalsInput.stats is supplied and non-empty; callers that skip line counting silently get no code-quality signals. <sub>`packages/core/src/architecture/signals.ts`</sub>
- god-file threshold is relative to each module's own median line count (>=400 lines AND >=3x module median), so it will not fire uniformly across a codebase of naturally long files. <sub>`packages/core/src/architecture/signals.ts`</sub>
- reviewModuleStructure() runs the reviewer agent with tools limited to ['Read','Grep','Glob'] and permissionMode 'dontAsk' — it is structurally read-only; it cannot write files even if the model tries. <sub>`packages/core/src/architecture/refactor.ts`</sub>
- parseReport() falls back to verdict 'workable' with empty proposals and an 'error' field whenever the agent's structured output is missing/malformed, rather than throwing — callers building REFACTOR.md must handle reports with error set and no proposals. <sub>`packages/core/src/architecture/refactor.ts`</sub>

## Gotchas

- `repeatedBasenames` deliberately ignores index.ts/__init__.py/mod.rs/main.* basenames as conventional, not duplication — don't 'fix' it to count them. <sub>`packages/core/src/architecture/code-stats.ts`</sub>
- JUNK_NAMES intentionally excludes 'core', 'lib', 'shared', 'tools' — comment explains they were tried and removed because they fired on healthy monorepo package names; do not re-add them without re-reading the rationale. <sub>`packages/core/src/architecture/code-stats.ts`</sub>
- countLines silently drops a whole 400-file chunk if `wc -l` fails on any file in it (catch-and-continue) rather than partially recovering — a single unreadable/deleted file in a chunk can suppress line stats for the other 399. <sub>`packages/core/src/architecture/code-stats.ts`</sub>
- Python absolute-import resolution in resolveSpecifier tries every plausible source root ('', 'src', 'lib', 'app') that actually has files under it — bare specifiers can resolve incorrectly if two roots both happen to contain a matching path. <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- Bare (non-relative) JS/TS specifiers are always treated as external packages and never resolved, even in a monorepo where the specifier might be a workspace package — noted in code as deliberately out of scope for a regex pass (would require package.json resolution). <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- findCycles caps DFS path length at 12 nodes (`if (path.length > 12) return`) — a genuine cycle longer than that among modules would be silently missed. Unlikely given typical module counts, but not unbounded. <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- findCycles deduplicates by member set and then drops any cycle that is a subset of a larger reported cycle's members — a 2-node cycle that is also part of a larger 4-node cycle is only reported once, as the larger one. <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- REFACTOR_SCHEMA's `proposals` array is capped at maxItems 6 by the JSON schema itself — the reviewer agent cannot emit more than 6 proposals per module even if more are warranted. <sub>`packages/core/src/architecture/refactor.ts`</sub>
- reviewModuleStructure runs collectAgent with `ephemeral: true, lean: true` (options defined in ../runtime/collect.js, outside this module) — implies no persistent memory/session for reviewer runs; verify against the runtime module if session lifecycle semantics matter. <sub>`packages/core/src/architecture/refactor.ts`</sub>

## Landmarks

- `packages/core/src/architecture/code-stats.ts` — countLines (batched, chunked `wc -l`), isCodeFile/isTestFile, directoryShapes, isJunkName, repeatedBasenames, median — the raw facts layer.
- `packages/core/src/architecture/import-graph.ts` — buildImportGraph() — file-level import edges rolled up to module edges (ModuleEdge with count+samples) plus deduplicated cycle detection (findCycles, DFS with depth cap 12).
- `packages/core/src/architecture/signals.ts` — computeSignals() — the single entry point that emits Signal[] (kind/severity/module/summary/evidence), ModuleHealth[], unowned files, ownership conflicts, and coverage ratio.
- `packages/core/src/architecture/refactor.ts` — reviewModuleStructure() (one agent run per module) + renderRefactorReport() (Markdown assembly for .swarm/REFACTOR.md); REFACTOR_SCHEMA is the structured-output contract enforced on the agent.
- `packages/core/src/architecture/import-graph.test.ts` — Documents the two intentional exclusions (barrels, type-only imports) via a real regression found by running this tool on Swarm OS itself.
- `packages/core/src/architecture/code-stats.test.ts` — Spec for isCodeFile/isTestFile/directoryShapes/repeatedBasenames edge cases (e.g. 'contest'/'latest' must not match isTestFile).

## Public interface

- computeSignals(input: ComputeSignalsInput): ArchitectureSignals — signals.ts, re-exported from index.ts
- Signal, SignalSeverity, ModuleHealth, ArchitectureSignals types — signals.ts
- countLines(repoRoot, files): Promise<FileStat[]> — code-stats.ts
- isCodeFile(path), isTestFile(path) — code-stats.ts, also used directly by ui/snapshot.ts
- directoryShapes, isJunkName, repeatedBasenames, median — code-stats.ts
- buildImportGraph(repoRoot, files, modules: ModuleSpec[]): Promise<ImportGraph> — import-graph.ts, used by loop/run.ts and ui/snapshot.ts
- ImportGraph, ModuleEdge, ImportEdge types — import-graph.ts
- reviewModuleStructure(options: ReviewModuleOptions): Promise<ModuleRefactorReport> — refactor.ts
- renderRefactorReport(repoName, reports, signals, checkedAt): string — refactor.ts, produces .swarm/REFACTOR.md content
- REFACTOR_SCHEMA — the JSON schema contract handed to the reviewer AgentRuntime call
- ModuleRefactorReport, RefactorProposal types — refactor.ts

---

_Surveyed 2026-08-15 by the `architecture-analysis` analyst, reading only this module's paths._
