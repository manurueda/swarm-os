# Repo Mapper — memory

_Durable knowledge for the `mapper` swarm. Read on wake, rewritten on sleep._

## Invariants

- A module's fingerprint hash (hashFiles over its owned files + content fingerprints from `git ls-files -s` / working-tree dirty markers) is the sole basis for 'unchanged' — same files+content => same hash => the module is reused (memory untouched, no agent spawned). Re-running mapProject is therefore incremental: cost is proportional to what moved, not repo size. <sub>`packages/core/src/mapper/pipeline/module-files.ts`</sub>
- A module that fails analysis has its hash deleted from moduleHashes rather than inheriting its old one, so it is retried on the next map instead of being silently treated as up to date. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- surveyModuleAreas (area detection/splitting) runs for EVERY module before that module's own analyst runs, and runs sequentially across modules (not concurrently), because it fans its own area-analysts out across the same Scheduler and overlapping pools would exceed maxConcurrentAgents. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- The area/split trigger is purely structural (detectAreas finding real sub-domains under a module's owned files), never based on memory.md size — deliberately, so it works even on a first map before any memory exists. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- mapRepository rejects any proposed module that owns zero files after matching globs against the digest's real file list; it does one repair round showing the agent exactly which globs matched nothing, and drops still-empty modules afterward rather than ever creating an empty module directory. <sub>`packages/core/src/mapper/map.ts`</sub>
- Duplicate slugs from the partition agent are deduplicated by keeping only the first occurrence (parseModuleMap), because two modules sharing a slug would share a directory and overwrite each other's memory. <sub>`packages/core/src/mapper/map.ts`</sub>
- detectDrift treats 'no digestHash on record' as drift=true with unknown=true (unless there are zero modules at all), never as 'unchanged' — an unmapped or state-clobbered workspace must never be misreported as already-mapped-and-current. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- When the whole-repo digest hash changes but a given module's own owned-file fingerprint hash is unchanged, that module is NOT reported as drifted (the repo digest can move for reasons no module owns, e.g. .swarm/ itself being tracked and rewritten by every map run). <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- Every module ends a map run in swarms[slug].state = 'sleeping' in state.json, and any swarm record for a module slug no longer in finalModules is dropped — mapping never leaves an agent 'awake'. <sub>`packages/core/src/mapper/pipeline/build-next-state.ts`</sub>
- renderModuleCharter's footer promises `swarm map` never overwrites module.md without --force and never touches memory.md/decisions.md at all; analyse-module.ts's normal path always calls workspace.writeModule (i.e. does overwrite module.md on a fresh analysis) and always overwrites memory.md via writeModuleFile — the 'never overwrite without --force' protection, if it exists, lives outside this module (in Workspace), not enforced here. <sub>`packages/core/src/mapper/map.ts` [doc]</sub>

## Gotchas

- buildDigest's `hash` field intentionally is NOT what per-module drift is computed from — that's module-files.ts's hashFiles(filesFor(...), digest.fingerprints) applied to just that module's owned files. digest.hash is a whole-repo fingerprint used only to short-circuit detectDrift when literally nothing changed. <sub>`packages/core/src/mapper/digest.ts`</sub>
- digest.sourceFiles is populated ('Every file' section in renderDigest) only under SMALL_REPO_FILES (400) tracked files; above that, only the directory tree (renderTree, capped at 140 lines) is sent to the partition agent, so on large repos the mapper agent literally cannot see individual file paths outside the tree summary and manifests/doc headings. <sub>`packages/core/src/mapper/digest.ts`</sub>
- areaNames is passed to analyzeModule as a distinct field, not appended into systemSummary text — a comment in analyse-module.ts explains this was previously smuggled through the summary string because two agents built both ends without coordinating; do not revert to string-smuggling. <sub>`packages/core/src/mapper/pipeline/analyse-module.ts`</sub>
- In analyseModule, if the analyst returns analysis.correctedOwns, the returned hash is recomputed via hashFiles(ownedNow, digest.fingerprints); if it does NOT correct owns, the hash returned is simply entry.hash (computed earlier from the pre-analysis owns/plan). Getting this branch wrong would let a module with corrected ownership be marked 'unchanged' against files it no longer actually owns. <sub>`packages/core/src/mapper/pipeline/analyse-module.ts`</sub>
- surveyModuleAreas calls workspace.pruneAreas(spec.slug, ...) unconditionally, even when detectAreas returns zero areas — a module that shrank below the area-detection threshold since an earlier, larger map loses whatever area memory it previously had. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- MODULE_MAP_SCHEMA deliberately has no `pattern` regex constraint on the slug field — a comment explains a regex constraint would force a full structured-output retry (re-sending the whole conversation) on a minor format slip like `reel_core`; normalization happens cheaply in code via slugify() instead. <sub>`packages/core/src/mapper/map.ts`</sub>
- mapRepository's repair round is only accepted if it strictly improves on the empty-module count (emptyIn(repaired).length < unmatched.length); a repair that doesn't improve is silently discarded and the original (possibly still partially empty) parse is kept, then filtered. <sub>`packages/core/src/mapper/map.ts`</sub>
- mapProject's costUsd only sums outcome.costUsd from freshly-analysed modules (toAnalyse) and does not include area-survey agent costs from surveyModuleAreas, nor the partition agent's cost from resolvePartition — MapResult.costUsd undercounts total spend for a run that repartitions or splits areas. <sub>`packages/core/src/mapper/pipeline.ts`</sub>

## Landmarks

- `packages/core/src/mapper/pipeline/plan-module-analysis.ts` — Decides per-module whether the last analysis still holds (fingerprint match) or a fresh analyst is needed.
- `packages/core/src/mapper/pipeline/resolve-partition.ts` — Either calls mapRepository fresh or reuses the existing on-disk module list/system summary, based on the `partition` flag from should-partition.ts.
- `packages/core/src/mapper/pipeline/should-partition.ts` — One-liner: partition iff force || repartition || no existing modules.
- `packages/core/src/mapper/pipeline/analyse-module.ts` — Runs one module's analyst agent (via swarm/analyst.js analyzeModule), writes module.md + memory.md, applies correctedOwns if the analyst fixed its globs.
- `packages/core/src/mapper/pipeline/survey-module-areas.ts` — Detects structural sub-domains (detectAreas) inside an oversized module and spawns one analyst per area, writing area.json + memory.md per area under .swarm/modules/<slug>/areas/.
- `packages/core/src/mapper/pipeline/archive-stale-modules.ts` — Moves module directories dropped by a repartition out of workspace.listModules()'s view.
- `packages/core/src/mapper/pipeline/load-reused-module.ts` — Builds a MapModuleResult for a module whose fingerprint matched — reads memory.md back only to compute its token count, does not re-analyse.
- `packages/core/src/mapper/pipeline/build-next-state.ts` — Assembles the next state.json; every module is forced back to state 'sleeping' on every map run.
- `packages/core/src/mapper/pipeline/serial-queue.ts` — Tiny FIFO promise chain so concurrent analysts writing state.json never race a read-modify-write.
- `packages/core/src/mapper/pipeline/record-module-progress.ts` — Persists one module's result into state.json immediately as its analyst finishes, through the serial queue — makes a long map run durable/inspectable mid-flight and interruption-safe.
- `packages/core/src/mapper/pipeline/render-structural-charter.ts` — Fallback module.md written when an analyst fails — structure only, explicitly says the module needs a re-run.
- `packages/core/src/mapper/pipeline/count-areas-by-module.ts` — Module slug -> number of areas, used for MapResult.areas and pendingSplits.

## Public interface

- mapProject(options: MapProjectOptions): Promise<MapResult> — full incremental map run, re-exported from packages/core/src/index.ts
- detectDrift(workspace): Promise<{drifted, changedModules, mappedAt?, unknown?, moduleCount}> — re-exported from index.ts
- pendingSplits(workspace, config): Promise<string[]> — re-exported from index.ts
- mapRepository(options): Promise<ModuleMapResult> — re-exported from index.ts; used directly by resolve-partition.ts
- buildDigest(repoRoot): Promise<RepoDigest> — re-exported from index.ts; also imported directly (bypassing the pipeline) by ../loop/run.ts, ../ui/snapshot.ts, ../mission/run.ts
- renderDigest(digest): string — re-exported from index.ts
- renderSystemMap, MODULE_MAP_SCHEMA — re-exported from index.ts
- Types: MapResult, MapProgress, MapModuleResult, MapPhase, MapProjectOptions, RepoDigest — re-exported from index.ts for consumers

---

_Surveyed 2026-08-21 by the `mapper` analyst, reading only this module's paths._
