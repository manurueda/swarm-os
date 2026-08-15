# Repo Mapper — memory

_Durable knowledge for the `mapper` swarm. Read on wake, rewritten on sleep._

## Invariants

- The mapper agent (mapRepository) is invoked with `tools: []` and a systemPromptOverride — it must never be able to read source files; only the compact digest markdown (renderDigest) is ever sent to it. This is what keeps mapping cost roughly constant regardless of repo size. <sub>`packages/core/src/mapper/map.ts`</sub>
- Module hashing (hashFiles) combines each owned file's path AND its content fingerprint (git blob SHA, or a `dirty:` marker for unstaged changes, or size:mtime fallback). A module is only skipped/reused on re-map if this hash exactly matches the previously recorded one in state.moduleHashes. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- A module whose analyst run fails has its hash deleted from moduleHashes rather than inheriting the old one, so it is guaranteed to be retried on the next `swarm map` even if nothing in the repo changed. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- If an analyst returns `correctedOwns` (it disagrees with the globs it was assigned), the module's file count and hash are recomputed from the corrected globs before being persisted — using the stale pre-analysis count/hash would misreport module size. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- state.json is read-modify-written by every parallel analyst as it finishes, so writes are serialized through a chained `stateWrites` promise (recordProgress). Module/area directories are per-module files and need no such serialization. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- Every module ends the pipeline with swarm state 'sleeping' — mapping never leaves an agent process running. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- A module is only split into per-area memory when its rendered memory.md would occupy >= 85% of config.memoryBudgetTokens; otherwise any existing areas are pruned back to none via workspace.pruneAreas(spec.slug, []). <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- mapRepository itself only guarantees no returned module owns zero files; cross-module ownership overlap is enforced by prompt instruction and later verified by findOwnershipConflicts (swarm/ownership.ts), not by this module. <sub>`packages/core/src/mapper/map.ts`</sub>
- detectDrift treats 'no digestHash on record' as drifted-with-unknown=true (not as unchanged) — a map from an older version or one with clobbered state can never be reported as clean. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- Repo digest excludes noise directories (node_modules, dist, build, .venv, vendor, coverage, etc.) via a fixed NOISE_SEGMENTS set applied to every path segment. <sub>`packages/core/src/mapper/digest.ts`</sub>

## Gotchas

- `digest.sourceFiles` is only populated (full path list) when the repo has <= 400 tracked files (SMALL_REPO_FILES); above that threshold only the aggregated directory tree is sent to the mapper agent, so digest.sourceFiles being empty is normal for large repos, not a bug. <sub>`packages/core/src/mapper/digest.ts`</sub>
- MODULE_MAP_SCHEMA deliberately has no regex `pattern` on `slug` — constraining it in the JSON schema would force a full structured-output retry (re-sending the whole conversation) whenever the model emits e.g. `reel_core` instead of `reel-core`. Normalization happens after the fact via slugify() in code, which is cheap. <sub>`packages/core/src/mapper/map.ts`</sub>
- mapRepository does a bounded one-shot 'repair' round when any proposed module owns zero real files, re-prompting with the exact unmatched globs and the authoritative file list; it only adopts the repaired output if it's strictly better than the original, and afterwards force-drops any module that still owns nothing (never creates an empty module directory). <sub>`packages/core/src/mapper/map.ts`</sub>
- The returned ModuleMapResult.outcome comes from the *repair* call if one ran (`repair = outcome` initially, reassigned only if a repair round executes), not necessarily the original mapper call — cost/usage figures reflect whichever call actually ran last. <sub>`packages/core/src/mapper/map.ts`</sub>
- `renderModuleCharter` exported from map.ts is not what mapProject's happy path writes for module.md — pipeline.ts instead uses `renderCharter` imported from ../swarm/analyst.js (and its own local `renderStructuralCharter` fallback when an analyst fails). Don't assume editing renderModuleCharter changes what `swarm map` actually writes. <sub>`packages/core/src/mapper/map.ts`</sub>
- fileFingerprints relies on `git ls-files -s` for blob SHAs plus `git status --porcelain` for dirty markers; in a non-git directory it silently falls back to size+mtime, which is coarser (won't detect a same-size same-mtime content change). <sub>`packages/core/src/mapper/digest.ts`</sub>
- renderTree's directory-inclusion threshold rises with depth (`Math.max(minCount, depth * 6)`), so small nested directories are hidden even though top-level small ones are shown — the tree is deliberately lossy/summarized, not a full listing, whenever sourceFiles is empty. <sub>`packages/core/src/mapper/digest.ts`</sub>

## Landmarks

- `packages/core/src/mapper/digest.ts` — Deterministic, zero-token repo scan: git ls-files based file listing (with fs-walk fallback), noise-dir filtering, directory tree rendering, extension histogram, doc heading extraction, manifest excerpting, and git-blob-based content fingerprints for drift detection.
- `packages/core/src/mapper/map.ts` — Single no-tools, structured-output agent call (MODULE_MAP_SCHEMA) that partitions the digest into modules; includes a one-shot self-repair round when a proposed module's globs match zero files, plus slugify() and the module-charter/system-map markdown renderers.
- `packages/core/src/mapper/pipeline.ts` — mapProject(): decides shouldPartition (force/repartition/no existing modules), hashes each module's owned files to skip unchanged ones, runs analyst agents via Scheduler with concurrency limits, splits oversized modules into per-area memory via detectAreas/areaAsModule, persists state.json incrementally as each analyst finishes, and archives module dirs whose slug disappeared from a new partition.

## Public interface

- buildDigest(repoRoot) -> Promise<RepoDigest> (re-exported from packages/core/src/index.ts; also imported directly by ui-observability's snapshot.ts, loop/run.ts and mission/run.ts)
- renderDigest(digest) -> string
- RepoDigest type
- mapRepository({ runtime, repoRoot, model?, onEvent?, signal? }) -> Promise<ModuleMapResult>
- renderSystemMap(system, modules, digest) -> string
- MODULE_MAP_SCHEMA (structured-output JSON schema constant)
- slugify(raw) -> string
- mapProject(options: MapProjectOptions) -> Promise<MapResult> — the swarm map CLI command's core entry point
- detectDrift(workspace) -> Promise<{ drifted, changedModules, mappedAt?, unknown? }>
- MapResult / MapProgress / MapModuleResult / MapPhase types

---

_Surveyed 2026-08-15 by the `mapper` analyst, reading only this module's paths._
