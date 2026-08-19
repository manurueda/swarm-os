# Repo Mapper — memory

_Durable knowledge for the `mapper` swarm. Read on wake, rewritten on sleep._

## Invariants

- mapRepository (mapper agent) and analyzeModule (per-module analysts) never see source code — mapper gets only the rendered digest (`tools: []`); analysts glob their own module's files but never see the digest. Keeps `swarm map` cost proportional to repo shape, not size. <sub>`packages/core/src/mapper/map.ts`</sub>
- A module's incremental hash (hashFiles over filesFor(digest,owns) + digest.fingerprints) is the sole reuse gate: planModuleAnalysis marks 'unchanged' (analyst skipped) only when it matches state.moduleHashes[slug] and force is false. <sub>`packages/core/src/mapper/pipeline/plan-module-analysis.ts`</sub>
- A module that fails analysis has its hash deleted from moduleHashes before persisting, so it's never mistaken for 'unchanged' next run. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- areasWithMemory/surveyModuleAreas/detectAreas run over EVERY module every map run (not just re-analysed ones), so old modules can pick up newly-detectable areas. Split trigger is purely structural, never memory.md size. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- surveyModuleAreas runs sequentially across modules (awaited for-loop) since each call fans areas across the shared Scheduler; concurrent modules would exceed maxConcurrentAgents. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- All concurrent state.json read-modify-writes are serialized through one createSerialQueue() per mapProject run; recordModuleProgress must always go through it, never call workspace.readState/writeState directly from a scheduler task. <sub>`packages/core/src/mapper/pipeline/serial-queue.ts`</sub>
- detectDrift treats a module with no recorded hash as drifted even if the whole-repo digest hash is unchanged; treats an absent state.digestHash as 'unknown' drift. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- Digest fingerprints come from `git ls-files -s` overlaid with `git status --porcelain`; falls back to size+mtime (coarser) when git unavailable. <sub>`packages/core/src/mapper/digest.ts`</sub>
- Ownership globs must partition the repo without overlap; map.ts does a one-shot repair round-trip for empty-owning modules, then drops any still-zero-file module — mapProject never sees zero-file modules. Duplicate slugs are silently deduped (first wins) in parseModuleMap. <sub>`packages/core/src/mapper/map.ts`</sub>
- The area-survey decision (which detected areas still need surveying) belongs in exactly one place: `planAreas` in `packages/core/src/swarm/areas.ts` (owned by a different module). Both `pendingSplits` and `survey-module-areas.ts` must call it rather than inlining their own `!recorded.has(slug)` filtering — do not let this logic re-fork.

## Gotchas

- **Unresolved as of 2026-08-17**: `pendingSplits` in pipeline.ts was edited to drop its unused `SwarmConfig` param and call `planAreas`, but the call was written against an assumed signature (`planAreas(areas, recorded, force?)` returning `Area[]`) that does **not** match the real, current `planAreas` in `packages/core/src/swarm/areas.ts`, which is `planAreas({areas, hasMemory, force?}): {keep, survey}` (options object, `hasMemory` predicate, object return). This will fail to type-check. Also `packages/cli/src/commands/map.ts` still calls `pendingSplits(workspace, config)` with two args — that caller is outside this module's ownership and was not updated, so the build breaks there too until both sides land together. Fix: match pipeline.ts's `planAreas` call to swarm/areas.ts's actual contract, and coordinate the CLI caller update.
- In this sandboxed environment, `npm`/`tsc`/`node -e` invocations (even `npm --version`) can be unconditionally blocked ("requires approval") with no interactive approval path — verification may have to be done by static/manual review instead of running tests.
- analyseModule may re-derive the owned-files hash from `analysis.correctedOwns` (analyst can correct its own globs mid-run) rather than the pre-computed plan hash; falls back to `entry.hash` if absent — keep in sync if correctedOwns's lifecycle changes. <sub>`packages/core/src/mapper/pipeline/analyse-module.ts`</sub>
- `areaNames` is passed into analyzeModule as an explicit field, not smuggled into systemSummary text (it used to be, from parallel-built mapper/analyst code) — don't revert. <sub>`packages/core/src/mapper/pipeline/analyse-module.ts`</sub>
- surveyModuleAreas calls `workspace.pruneAreas(spec.slug, ...)` unconditionally even for modules with zero detected areas — a module that shrank below split-worthiness loses its previously-surveyed area memory every run. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- MODULE_MAP_SCHEMA deliberately omits a `pattern` regex on `slug` (would force a full structured-output retry for cosmetic mismatches); normalization happens via slugify() after the fact. <sub>`packages/core/src/mapper/map.ts`</sub>
- detectDrift's digest-changed branch ignores the whole-repo hash diff itself for already-tracked modules — only per-module changes count, since `.swarm/` is git-tracked and moves the whole-repo hash on every map run for reasons no module owns. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- loadReusedModuleResult re-estimates memoryTokens by reading memory.md fresh off disk, not from any cached state.json value. <sub>`packages/core/src/mapper/pipeline/load-reused-module.ts`</sub>
- pipeline/types.ts is a one-way dependency boundary (steps import types.ts, never pipeline.ts) — convention only, not tooling-enforced. <sub>`packages/core/src/mapper/pipeline/types.ts`</sub>

## Landmarks

- `packages/core/src/mapper/pipeline.ts` — Orchestrator: mapProject, detectDrift, pendingSplits (currently `(workspace)`, mid-refactor — see gotcha above).
- `packages/core/src/mapper/digest.ts` — buildDigest/renderDigest + RepoDigest; fileFingerprints is the basis of drift/incremental logic.
- `packages/core/src/mapper/map.ts` — mapRepository, MODULE_MAP_SCHEMA, slugify, renderModuleCharter, renderSystemMap.
- `packages/core/src/mapper/pipeline/plan-module-analysis.ts` — per-module rerun decision via hashFiles equality.
- `packages/core/src/mapper/pipeline/analyse-module.ts` — runs one module's analyst, writes module.md/memory.md.
- `packages/core/src/mapper/pipeline/survey-module-areas.ts` — structural sub-splitting, fans area analysts through shared scheduler.
- `packages/core/src/mapper/pipeline/serial-queue.ts` — createSerialQueue, mutex for concurrent state.json writes.
- `packages/core/src/mapper/pipeline/archive-stale-modules.ts`, `build-next-state.ts`, `resolve-partition.ts` — repartition bookkeeping steps (archive dropped modules, build next state.json, choose fresh-vs-reuse partition).

## Public interface

- mapProject(options: MapProjectOptions): Promise<MapResult>
- detectDrift(workspace): Promise<{drifted, changedModules, mappedAt?, unknown?}>
- pendingSplits(workspace): Promise<string[]> — module slugs with structural areas never surveyed (param list currently inconsistent with CLI caller, see gotcha)
- mapRepository(options): Promise<ModuleMapResult>
- buildDigest(repoRoot): Promise<RepoDigest> / renderDigest(digest): string
- renderSystemMap(system, modules, digest): string
- MODULE_MAP_SCHEMA
- Types: MapResult, MapProgress, MapModuleResult, MapPhase, MapProjectOptions, RepoDigest
