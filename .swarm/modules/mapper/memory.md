# Repo Mapper — memory

_Durable knowledge for the `mapper` swarm. Read on wake, rewritten on sleep._

## Invariants

- The mapper agent (mapRepository) and per-module analysts (analyzeModule) never receive source code — the mapper sees only the rendered digest (markdown, ~KBs) with `tools: []`; analysts read their own module's globbed files but never the mapper's digest-only view. This is what keeps `swarm map` cost proportional to repo shape, not repo size. <sub>`packages/core/src/mapper/map.ts`</sub>
- A module's incremental hash (hashFiles over filesFor(digest,owns) + digest.fingerprints) is the sole reuse gate: planModuleAnalysis marks a module 'unchanged' (analyst skipped, memory preserved) only when this hash matches state.moduleHashes[slug] and force is false. <sub>`packages/core/src/mapper/pipeline/plan-module-analysis.ts`</sub>
- A module that fails analysis has its hash deleted from moduleHashes before persisting, specifically so it is never mistaken for 'unchanged' and skipped on the next run. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- areasWithMemory / surveyModuleAreas / detectAreas run over EVERY module every map run, not only modules being re-analysed, so a module reused unchanged from an older mapper version can still pick up newly-detectable areas. The trigger for splitting a module is purely structural (detectAreas finding real sub-domains under its owned paths), never a measurement of memory.md size. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- surveyModuleAreas runs sequentially across modules (a for-loop, awaited one module at a time) because each call fans its own areas out across the same shared Scheduler; running two modules' area surveys concurrently would exceed config.maxConcurrentAgents. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- All concurrent state.json read-modify-writes (one per finishing analyst) are serialized through a single createSerialQueue() instance per mapProject run; recordModuleProgress must always go through that queue, never call workspace.readState/writeState directly from a scheduler task. <sub>`packages/core/src/mapper/pipeline/serial-queue.ts`</sub>
- detectDrift treats a module with no recorded hash in state.moduleHashes as drifted even when the whole-repo digest hash is unchanged (covers modules that were never successfully analysed); and treats an entirely absent state.digestHash as 'unknown' drift (never silently reports 'unchanged' when there is nothing to compare against). <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- Digest content fingerprints come from `git ls-files -s` (index blob SHA) overlaid with `git status --porcelain` markers for dirty files; staged-but-uncommitted content changes are captured, but the digest silently falls back to file size+mtime when git is unavailable/not a repo, which is coarser and can miss no-op touches. <sub>`packages/core/src/mapper/digest.ts`</sub>
- Ownership globs proposed by the mapper agent must partition the repo without overlap and every module must own at least one real file; map.ts enforces the latter with a one-shot repair round-trip (re-prompting with the exact empty globs) and then unconditionally drops any module still owning zero files afterward — mapProject never sees zero-file modules. <sub>`packages/core/src/mapper/map.ts`</sub>
- Duplicate slugs from the mapper agent are silently deduplicated (first wins) in parseModuleMap, because two modules sharing a directory would overwrite each other's charter/memory files on disk. <sub>`packages/core/src/mapper/map.ts`</sub>

## Gotchas

- analyseModule may re-derive a module's owned-files hash from analysis.correctedOwns (an analyst can correct its own ownership globs mid-run) rather than reuse the pre-computed plan hash; if correctedOwns is absent it falls back to entry.hash. A future change to when correctedOwns is set must keep this branch in sync or module-hash tracking silently diverges from what's actually on disk. <sub>`packages/core/src/mapper/pipeline/analyse-module.ts`</sub>
- areaNames is threaded into analyzeModule as an explicit named field, not appended into systemSummary text — a comment notes this used to be smuggled through the summary string because two people built the mapper and analyst sides in parallel without visibility into each other's work; do not revert to string-smuggling. <sub>`packages/core/src/mapper/pipeline/analyse-module.ts`</sub>
- surveyModuleAreas calls workspace.pruneAreas(spec.slug, ...) unconditionally before checking areas.length, even for modules with zero detected areas — a module that used to be big enough to split but no longer is loses its previously-surveyed area memory on every map run. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- MODULE_MAP_SCHEMA deliberately omits a `pattern` regex constraint on `slug` — the comment explains a regex would force a full structured-output retry (re-sending the whole conversation) for a cosmetic issue like `reel_core` vs `reel-core`; normalization happens after the fact via slugify() in code instead. <sub>`packages/core/src/mapper/map.ts`</sub>
- renderModuleCharter's trailing note ('swarm map will not overwrite ... without --force, and never touches memory.md or decisions.md') describes CLI/workspace-store behavior this module does not itself enforce — it's an assertion baked into generated file content, not something this module verifies. <sub>`packages/core/src/mapper/map.ts` [doc]</sub>
- detectDrift's digest-changed branch intentionally ignores the whole-repo hash difference itself as a drift signal for already-tracked modules — only per-module file-set/content changes count, because .swarm/ itself is git-tracked and gets rewritten by every map run, moving the whole-repo digest hash for reasons no module owns. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- loadReusedModuleResult re-estimates memoryTokens by reading memory.md fresh off disk rather than trusting any cached value in state.json — an out-of-band edit to memory.md between map runs changes the reported token count even though the module is 'reused'. <sub>`packages/core/src/mapper/pipeline/load-reused-module.ts`</sub>
- pipeline/types.ts is a one-way dependency boundary by convention (steps import types.ts, never pipeline.ts) — not enforced by tooling, just a deliberate structural rule stated in the file's own comment; a step that starts importing pipeline.ts would create a cycle. <sub>`packages/core/src/mapper/pipeline/types.ts` [doc]</sub>

## Landmarks

- `packages/core/src/mapper/pipeline.ts` — Orchestrator: mapProject (full pipeline), detectDrift, pendingSplits — the module's three public entry functions.
- `packages/core/src/mapper/digest.ts` — buildDigest/renderDigest + RepoDigest type; also fileFingerprints (git blob SHA + working-tree dirty markers) which is the basis of all drift/incremental logic.
- `packages/core/src/mapper/map.ts` — mapRepository (partition step), MODULE_MAP_SCHEMA, slugify, renderModuleCharter, renderSystemMap.
- `packages/core/src/mapper/pipeline/plan-module-analysis.ts` — Decides per-module whether the analyst needs to re-run, via hashFiles equality against previousHashes.
- `packages/core/src/mapper/pipeline/analyse-module.ts` — Runs one module's analyst agent, writes module.md/memory.md, handles the correctedOwns re-hash case and the failed-analyst fallback charter.
- `packages/core/src/mapper/pipeline/survey-module-areas.ts` — Structural sub-splitting: detects a module's 'areas' and, for any without recorded memory, spawns one analyst per area (fanned through the shared scheduler) before the module's own analyst runs.
- `packages/core/src/mapper/pipeline/serial-queue.ts` — createSerialQueue — trivial promise-chaining mutex protecting concurrent writes to state.json.
- `packages/core/src/mapper/pipeline/archive-stale-modules.ts` — Moves module dirs dropped by repartitioning out of workspace.listModules()'s view.
- `packages/core/src/mapper/pipeline/build-next-state.ts` — Builds the next state.json: every module ends 'sleeping', swarm records for removed modules are dropped.
- `packages/core/src/mapper/pipeline/resolve-partition.ts` — Chooses between calling mapRepository (fresh boundaries) or reusing existing modules/system, gated by shouldPartition.

## Public interface

- mapProject(options: MapProjectOptions): Promise<MapResult> — the full digest→partition→analyse→synthesise run, re-exported from packages/core/src/index.ts
- detectDrift(workspace): Promise<{drifted, changedModules, mappedAt?, unknown?}> — cheap no-model check for whether the repo moved since the last map
- pendingSplits(workspace, config): Promise<string[]> — module slugs with structural areas never surveyed into per-area memory
- mapRepository(options): Promise<ModuleMapResult> — single-agent partition step, callable standalone
- buildDigest(repoRoot): Promise<RepoDigest> / renderDigest(digest): string — deterministic repo scan, consumed directly by loop/run.ts, mission/run.ts and ui/snapshot.ts outside this module
- renderSystemMap(system, modules, digest): string — used to (re)write .swarm/system.md
- MODULE_MAP_SCHEMA — the JSON schema handed to the runtime for structured mapper output
- Types: MapResult, MapProgress, MapModuleResult, MapPhase, MapProjectOptions, RepoDigest — all re-exported from packages/core/src/index.ts

---

_Surveyed 2026-08-15 by the `mapper` analyst, reading only this module's paths._
