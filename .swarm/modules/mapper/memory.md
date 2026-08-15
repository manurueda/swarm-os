# Repo Mapper — memory

_Durable knowledge for the `mapper` swarm. Read on wake, rewritten on sleep._

## Invariants

- The mapper agent (mapRepository) is invoked with `tools: []` and a tool-less system prompt override — it must never be able to read repo source, only the rendered digest text. This is what keeps `swarm map` a fixed-token-cost operation regardless of repo size. <sub>`packages/core/src/mapper/map.ts`</sub>
- A module's incremental hash is `hashFiles(filesFor(digest, module.owns), digest.fingerprints)`. plan-module-analysis.ts, analyse-module.ts and pipeline.ts's detectDrift() all recompute this independently with the same two functions — if you change filesFor/hashFiles semantics you must keep all call sites consistent or 'unchanged' detection silently breaks. <sub>`packages/core/src/mapper/pipeline/module-files.ts`</sub>
- When a module's analyst fails, its previous hash is deleted from moduleHashes rather than carried forward — this guarantees the module is retried on the next `swarm map` run instead of being treated as up to date forever. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- detectAreas triggering (module split into per-area memory) is purely structural (detectAreas finding real sub-domains under the module's globs), never based on memory.md size — this runs before that module's analyst produces any memory, including on a first-ever map. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- surveyModuleAreas runs sequentially, once per module, in a `for` loop (not concurrently across modules) because each call internally fans its own areas out across the same shared Scheduler; running modules' surveys concurrently would exceed config.maxConcurrentAgents. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- Concurrent module analysts must not race state.json: every write goes through a single createSerialQueue() instance shared for the whole mapProject run (recordModuleProgress). <sub>`packages/core/src/mapper/pipeline/serial-queue.ts`</sub>
- A proposed module owning zero files is never accepted: mapRepository does one repair round showing the model exactly which globs matched nothing, then unconditionally filters out any module still owning zero files afterward, and throws if that leaves none. <sub>`packages/core/src/mapper/map.ts`</sub>
- Duplicate module slugs from the partition agent are collapsed to the first occurrence (later ones silently dropped) — two modules must never share a directory and overwrite each other's memory. <sub>`packages/core/src/mapper/map.ts`</sub>
- detectDrift() treats a missing state.digestHash as drifted+unknown (not 'unchanged') for any repo with modules already mapped — absence of a fingerprint is never interpreted as 'no change'. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- archiveStaleModules only runs when the partition step actually ran (repartition/force/no existing modules); on a normal incremental `swarm map` run stale module directories are never pruned. <sub>`packages/core/src/mapper/pipeline.ts`</sub>

## Gotchas

- The MODULE_MAP_SCHEMA deliberately omits a `pattern` regex constraint on `slug` — a regex mismatch (e.g. model emitting `reel_core`) would force a full structured-output retry re-sending the whole conversation; instead slugs are normalized in code via slugify() after the fact. <sub>`packages/core/src/mapper/map.ts`</sub>
- areaNames is passed to analyzeModule as an explicit field, not appended into systemSummary text — a comment records that an earlier version smuggled it through the summary string because the two halves (mapper and analyst) were built in parallel without visibility into each other; that hack is gone but the comment is a landmine for anyone tempted to reintroduce string-smuggling for a new parameter. <sub>`packages/core/src/mapper/pipeline/analyse-module.ts`</sub>
- Every pipeline/*.ts file was deliberately extracted from what used to be closures inside mapProject specifically so a step defined but never wired up would show as 'a file nothing imports' rather than dead code buried in a closure — when adding a new step, wire it into pipeline.ts explicitly or it is invisible dead code by this module's own design philosophy. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- renderModuleCharter's generated module.md text asserts that `swarm map` will not overwrite manual edits without `--force` and never touches memory.md/decisions.md — this is a claim baked into the rendered output, not something enforced by code inside packages/core/src/mapper/**; the actual write/overwrite behavior lives in Workspace.writeModule (workspace-git module), so treat this as unverified from this module's own code. <sub>`packages/core/src/mapper/map.ts` [doc]</sub>
- 'Areas' use the exact same analyzeModule() analyst call as full modules, via areaAsModule(spec, area) which fabricates a pseudo-ModuleSpec for the area — area survey failures throw (`area ${slug} returned nothing`) inside the scheduler.run() batch rather than being reported per-area like module failures are. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- pendingSplits() (used to prompt re-running `swarm map` on older maps) is completely free — no digest fingerprint comparison against state, no model call — it just re-walks the live repo with detectAreas per already-recorded module and compares against on-disk area memory. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- buildDigest's content fingerprinting comes from `git ls-files -s` blob SHAs plus `git status --porcelain` for dirty markers — in a non-git directory it silently falls back to size+mtime per file (coarser, and stat failures map the file to the literal string 'missing'). <sub>`packages/core/src/mapper/digest.ts`</sub>

## Landmarks

- `packages/core/src/mapper/pipeline.ts` — Orchestrator: mapProject(), detectDrift(), pendingSplits().
- `packages/core/src/mapper/digest.ts` — Deterministic repo scan → RepoDigest + markdown rendering; git-backed file listing and content fingerprinting.
- `packages/core/src/mapper/map.ts` — The single 'partition' agent call, its JSON schema, empty-module repair loop, slug normalization, charter/system-map rendering.
- `packages/core/src/mapper/pipeline/module-files.ts` — hashFiles()/filesFor() — the incremental-mapping primitive; same functions used by plan-module-analysis, analyse-module and detectDrift so all three agree on what 'unchanged' means.
- `packages/core/src/mapper/pipeline/plan-module-analysis.ts` — Decides per-module whether an analyst needs to run at all (fingerprint compare).
- `packages/core/src/mapper/pipeline/analyse-module.ts` — Runs one module's analyst (delegates to swarm/analyst.js), writes module.md + memory.md, handles corrected ownership globs.
- `packages/core/src/mapper/pipeline/survey-module-areas.ts` — Detects and, if needed, surveys per-area sub-modules inside a structurally oversized module (areas), writing area.json/memory.md under the module.
- `packages/core/src/mapper/pipeline/resolve-partition.ts` — Chooses between redrawing boundaries (calls mapRepository) or reusing the existing map.
- `packages/core/src/mapper/pipeline/serial-queue.ts` — Tiny FIFO async queue used to serialize concurrent analysts' read-modify-write of state.json.
- `packages/core/src/mapper/pipeline/build-next-state.ts` — Assembles the next state.json: every module set to 'sleeping', stale swarm records dropped.
- `packages/core/src/mapper/pipeline/archive-stale-modules.ts` — Moves module dirs dropped by repartitioning out of the way (via workspace.archiveModulesNotIn) so listModules() doesn't return ghosts.

## Public interface

- buildDigest(repoRoot) / renderDigest(digest) / RepoDigest type — digest.ts
- mapRepository(options) / renderSystemMap / renderModuleCharter / MODULE_MAP_SCHEMA / slugify — map.ts
- mapProject(options: MapProjectOptions) => Promise<MapResult> — pipeline.ts, the main driver of `swarm map`
- detectDrift(workspace) — pipeline.ts, cheap no-model repo-vs-map staleness check
- pendingSplits(workspace, config) — pipeline.ts, finds modules whose structural areas were never surveyed
- Types: MapResult, MapProgress, MapModuleResult, MapPhase, MapProjectOptions — pipeline/types.ts, re-exported from pipeline.ts

---

_Surveyed 2026-08-15 by the `mapper` analyst, reading only this module's paths._
