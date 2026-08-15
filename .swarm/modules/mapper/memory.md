# Repo Mapper — memory

_Durable knowledge for the `mapper` swarm. Read on wake, rewritten on sleep._

## Invariants

- The mapper agent (mapRepository) is invoked with `tools: []` and a tool-less system prompt override — it must never read repo source, only the rendered digest text. This keeps `swarm map` a fixed-token-cost operation regardless of repo size. <sub>`packages/core/src/mapper/map.ts`</sub>
- A module's incremental hash is `hashFiles(filesFor(digest, module.owns), digest.fingerprints)`. plan-module-analysis.ts, analyse-module.ts and pipeline.ts's detectDrift() all recompute this independently with the same two functions — keep call sites consistent or 'unchanged' detection silently breaks. <sub>`packages/core/src/mapper/pipeline/module-files.ts`</sub>
- detectDrift() is two-tier: first compares digest.hash to state.digestHash; only if they differ does it fall through to comparing each module's own hashFiles(filesFor(...)) against the recorded moduleHashes entry. `drifted` is true iff `changedModules` is non-empty (a module was never analysed, or its own owned files changed) — never true merely because the whole-repo digest moved due to files no module owns (e.g. .swarm/ being rewritten by `swarm map` itself). <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- When a module's analyst fails, its previous hash is deleted from moduleHashes rather than carried forward — guarantees retry on the next `swarm map` run instead of being treated as up to date forever. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- detectAreas triggering (module split into per-area memory) is purely structural, never based on memory.md size — runs before that module's analyst produces any memory, including on a first-ever map. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- surveyModuleAreas runs sequentially, once per module, in a `for` loop (not concurrently across modules) because each call internally fans its own areas out across the same shared Scheduler; concurrent module surveys would exceed config.maxConcurrentAgents. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- Concurrent module analysts must not race state.json: every write goes through a single createSerialQueue() instance shared for the whole mapProject run (recordModuleProgress). <sub>`packages/core/src/mapper/pipeline/serial-queue.ts`</sub>
- A proposed module owning zero files is never accepted: mapRepository does one repair round showing the model which globs matched nothing, then unconditionally filters out any module still owning zero files, and throws if that leaves none. <sub>`packages/core/src/mapper/map.ts`</sub>
- Duplicate module slugs from the partition agent are collapsed to the first occurrence (later ones silently dropped) — two modules must never share a directory and overwrite each other's memory. <sub>`packages/core/src/mapper/map.ts`</sub>
- archiveStaleModules only runs when the partition step actually ran (repartition/force/no existing modules); on a normal incremental `swarm map` run stale module directories are never pruned. <sub>`packages/core/src/mapper/pipeline.ts`</sub>

## Gotchas

- This worktree's node_modules is a symlink to `/Users/manu/swarm-os/node_modules`, outside the sandboxed worktree dir. The Bash tool sandbox hard-blocks path resolution outside the worktree even via symlink, so `npm test`/`npm run build`/`npx tsc`/`node -e` all fail here with no way to grant approval in an autonomous mission. Verify changes by reading/reasoning against real type/interface definitions instead of assuming tests are runnable.
- The MODULE_MAP_SCHEMA deliberately omits a `pattern` regex constraint on `slug` — a mismatch would force a full structured-output retry re-sending the whole conversation; slugs are normalized in code via slugify() after the fact. <sub>`packages/core/src/mapper/map.ts`</sub>
- areaNames is passed to analyzeModule as an explicit field, not appended into systemSummary text — a comment records an earlier string-smuggling hack that is gone but is a landmine for reintroducing for a new parameter. <sub>`packages/core/src/mapper/pipeline/analyse-module.ts`</sub>
- Every pipeline/*.ts file was deliberately extracted from what used to be closures inside mapProject so a step defined but never wired up shows as 'a file nothing imports' rather than dead code buried in a closure — new steps must be wired into pipeline.ts explicitly. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- renderModuleCharter's generated module.md text asserts `swarm map` won't overwrite manual edits without `--force` and never touches memory.md/decisions.md — this is a claim in rendered output, not enforced by code in this module; actual write/overwrite behavior lives in Workspace.writeModule (workspace-git module), unverified from here. <sub>`packages/core/src/mapper/map.ts` [doc]</sub>
- 'Areas' use the exact same analyzeModule() analyst call as full modules, via areaAsModule(spec, area) fabricating a pseudo-ModuleSpec — area survey failures throw (`area ${slug} returned nothing`) inside the scheduler.run() batch rather than being reported per-area like module failures. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- pendingSplits() is completely free — no digest fingerprint comparison, no model call — it re-walks the live repo with detectAreas per already-recorded module and compares against on-disk area memory. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- buildDigest's content fingerprinting comes from `git ls-files -s` blob SHAs plus `git status --porcelain` for dirty markers — in a non-git directory it silently falls back to size+mtime per file, and stat failures map the file to the literal string 'missing'. <sub>`packages/core/src/mapper/digest.ts`</sub>

## Landmarks

- `packages/core/src/mapper/pipeline.ts` — Orchestrator: mapProject(), detectDrift(), pendingSplits().
- `packages/core/src/mapper/pipeline.test.ts` — tests for detectDrift(), incl. digest-moved-but-no-owned-file-change (not drifted) and missing module hash (still drifted).
- `packages/core/src/mapper/digest.ts` — Deterministic repo scan → RepoDigest + markdown rendering; git-backed file listing and content fingerprinting.
- `packages/core/src/mapper/map.ts` — The single 'partition' agent call, its JSON schema, empty-module repair loop, slug normalization, charter/system-map rendering.
- `packages/core/src/mapper/pipeline/module-files.ts` — hashFiles()/filesFor() — the incremental-mapping primitive shared by plan-module-analysis, analyse-module and detectDrift.
- `packages/core/src/mapper/pipeline/plan-module-analysis.ts` — Decides per-module whether an analyst needs to run at all (fingerprint compare).
- `packages/core/src/mapper/pipeline/analyse-module.ts` — Runs one module's analyst (delegates to swarm/analyst.js), writes module.md + memory.md, handles corrected ownership globs.
- `packages/core/src/mapper/pipeline/survey-module-areas.ts` — Detects and, if needed, surveys per-area sub-modules inside a structurally oversized module.
- `packages/core/src/mapper/pipeline/resolve-partition.ts` — Chooses between redrawing boundaries (calls mapRepository) or reusing the existing map.
- `packages/core/src/mapper/pipeline/serial-queue.ts` — Tiny FIFO async queue used to serialize concurrent analysts' read-modify-write of state.json.
- `packages/core/src/mapper/pipeline/build-next-state.ts` — Assembles next state.json: every module set to 'sleeping', stale swarm records dropped.
- `packages/core/src/mapper/pipeline/archive-stale-modules.ts` — Moves module dirs dropped by repartitioning out of the way (via workspace.archiveModulesNotIn).

## Public interface

- buildDigest(repoRoot) / renderDigest(digest) / RepoDigest type — digest.ts
- mapRepository(options) / renderSystemMap / renderModuleCharter / MODULE_MAP_SCHEMA / slugify — map.ts
- mapProject(options: MapProjectOptions) => Promise<MapResult> — pipeline.ts, the main driver of `swarm map`
- detectDrift(workspace) — pipeline.ts, cheap no-model repo-vs-map staleness check; drifted true iff changedModules non-empty
- pendingSplits(workspace, config) — pipeline.ts, finds modules whose structural areas were never surveyed
- Types: MapResult, MapProgress, MapModuleResult, MapPhase, MapProjectOptions — pipeline/types.ts, re-exported from pipeline.ts
