# Architecture Analysis — memory

_Durable knowledge for the `architecture-analysis` swarm. Read on wake, rewritten on sleep._

## Invariants

- Type-only imports (`import type`/`export type ... from`) and barrel files (>=60% and >=3 of a file's statements are re-exports) are deliberately excluded from the import graph — they create no runtime coupling / describe API surface rather than dependency, not a dependency edge. <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- Import edges only connect *different* modules (owned via isOwned/ownership.owns) — imports within the same module are dropped, and imports from files owned by no module are ignored entirely (fromModule check). <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- Unresolved import specifiers (bare package names, unmatched paths) are counted but produce no edge — this makes the graph strictly under-report; absence of an edge is not proof of independence. <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- Cycle detection (findCycles) reports each cycle once, deduplicated by member set, and keeps only maximal cycles (a cycle that is a strict subset of another reported cycle's members is dropped); DFS paths longer than 12 are abandoned to bound runtime. <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- computeSignals only emits dependency-shape signals (hub-module, import-cycle) when an ImportGraph is explicitly passed in `input.imports`; it deliberately never builds these from a module's declared `dependsOn` (that is a judgement, not a fact). <sub>`packages/core/src/architecture/signals.ts`</sub>
- code-level signals (god-file, junk-drawer, flat-directory, repeated-filenames, untested-module, deep-nesting) only run when `input.stats` is supplied and non-empty; omitting stats silently skips them rather than erroring. <sub>`packages/core/src/architecture/signals.ts`</sub>
- God-file detection is relative to each module's own median line count (>=400 lines AND >=3x the module's median), not a global threshold — a module of naturally long files won't universally trigger it. <sub>`packages/core/src/architecture/signals.ts`</sub>
- signals are always returned sorted by severity (high, warn, info in that order). <sub>`packages/core/src/architecture/signals.ts`</sub>
- countLines() batches files into chunks of 400 for `wc -l` to avoid exceeding argv length limits; a whole chunk failing (e.g. deleted file) is silently skipped rather than failing the whole scan, so results can legitimately be missing entries for some files. <sub>`packages/core/src/architecture/code-stats.ts`</sub>
- reviewModuleStructure() runs its reviewer agent with tools restricted to Read/Grep/Glob and permissionMode 'dontAsk', framed explicitly as 'proposing, not doing' — it must never be given write/edit tools. <sub>`packages/core/src/architecture/refactor.ts`</sub>

## Gotchas

- The JUNK_NAMES list deliberately excludes common monorepo package names like 'core', 'lib', 'shared', 'tools' — they were removed after producing pure noise. Don't 're-fix' this by adding them back without re-reading the comment; it's a considered exclusion, not an oversight. <sub>`packages/core/src/architecture/code-stats.ts`</sub>
- Bare (non-relative) JS/TS import specifiers are always treated as external packages and never resolved, even in a monorepo where the specifier could be a local workspace package — the code comment says that would need package.json resolution, which is explicitly out of scope for this regex pass. <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- Python absolute imports are resolved by trying a fixed guess-list of source roots (['', 'src', 'lib', 'app'], filtered to ones that actually exist in the file list) against every module — this is a heuristic, not a real sys.path resolution, and can both over- and under-resolve in unusual repo layouts. <sub>`packages/core/src/architecture/import-graph.ts`</sub>
- isJunkName() strips the file extension before matching, so it is applied to both directory segments and the final filename inside the same loop in signals.ts (`f.split('/').some((seg, i, arr) => isJunkName(...))`) — a file literally named `utils.ts` counts as junk the same as a directory named `utils/`. <sub>`packages/core/src/architecture/signals.ts`</sub>
- refactor.ts's parseReport() treats any structurally invalid or missing agent output as a soft fallback (verdict 'workable', empty proposals, an `error` string) rather than throwing — callers must check the `error` field to know the reviewer actually ran successfully. <sub>`packages/core/src/architecture/refactor.ts`</sub>
- reviewModuleStructure uses `lean: true, ephemeral: true` on the agent spawn options (via collectAgent from ../runtime/collect.js) — this module depends on runtime's agent-spawning contract and its own correctness for cost/session semantics; not re-verified here as it's outside this module's globs. <sub>`packages/core/src/architecture/refactor.ts`</sub>

## Landmarks

- `packages/core/src/architecture/code-stats.ts` — File classification (isCodeFile/isTestFile), batched `wc -l` line counting, directory-shape and junk-name heuristics, repeated-basename detection, median helper.
- `packages/core/src/architecture/import-graph.ts` — Regex-based JS/TS and Python import extraction, specifier resolution against the real file set, module attribution via isOwned(), barrel/type-only exclusion, DFS cycle detection deduplicated to maximal cycles.
- `packages/core/src/architecture/signals.ts` — computeSignals(): unowned-files, ownership-conflict, scattered-module (glob fragmentation), memory-pressure, size-imbalance, hub-module, import-cycle, and the code-level signals (god-file, junk-drawer, flat-directory, repeated-filenames, untested-module, deep-nesting).
- `packages/core/src/architecture/refactor.ts` — REFACTOR_CHARTER + REFACTOR_SCHEMA prompt/schema for a per-module read-only 'reviewer' agent; reviewModuleStructure() runs it via collectAgent(); renderRefactorReport() writes the Markdown report.
- `packages/core/src/architecture/code-stats.test.ts` — Behavioral spec for code-stats.ts helpers.
- `packages/core/src/architecture/import-graph.test.ts` — Behavioral spec documenting the barrel/type-only/cross-module exclusions with a concrete real-world motivating case (a false mapper→orchestrator→runtime→mapper cycle).

## Public interface

- computeSignals(input): ArchitectureSignals — signals.ts, the main aggregation entry point
- types: ArchitectureSignals, Signal, SignalSeverity, ModuleHealth, ComputeSignalsInput — signals.ts
- buildImportGraph(repoRoot, files, modules): Promise<ImportGraph> — import-graph.ts
- types: ImportGraph, ModuleEdge, ImportEdge — import-graph.ts
- countLines, directoryShapes, repeatedBasenames, isCodeFile, isTestFile, median, isJunkName — code-stats.ts
- types: FileStat, DirectoryShape — code-stats.ts
- reviewModuleStructure(options): Promise<ModuleRefactorReport>, renderRefactorReport(...), REFACTOR_SCHEMA — refactor.ts
- types: ModuleRefactorReport, RefactorProposal — refactor.ts
- All of the above are re-exported directly from packages/core/src/index.ts (the @swarm-os/core barrel) under an 'Architecture review' section

---

_Surveyed 2026-08-15 by the `architecture-analysis` analyst, reading only this module's paths._
