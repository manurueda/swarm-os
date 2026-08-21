# Repo Mapper — memory

_Durable knowledge for the `mapper` swarm. Read on wake, rewritten on sleep._

## Invariants

- A module's fingerprint hash (hashFiles over its owned files + content fingerprints from `git ls-files -s` / working-tree dirty markers) is the sole basis for 'unchanged' — same files+content => same hash => the module is reused (memory untouched, no agent spawned). <sub>`packages/core/src/mapper/pipeline/module-files.ts`</sub>
- A module that fails analysis has its hash deleted from moduleHashes rather than inheriting its old one, so it's retried next map instead of silently treated as up to date. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- surveyModuleAreas runs for EVERY module before that module's own analyst runs, and sequentially across modules (not concurrently) — it fans area-analysts across the same Scheduler and overlapping pools would exceed maxConcurrentAgents. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- Area/split trigger is purely structural (detectAreas), never memory.md size — works even on first map before memory exists. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- mapRepository rejects any proposed module owning zero files after glob-matching; one repair round, then drops still-empty modules — never creates an empty module directory. <sub>`packages/core/src/mapper/map.ts`</sub>
- Duplicate slugs from the partition agent keep only the first occurrence (parseModuleMap) — shared slug = shared directory = clobbered memory. <sub>`packages/core/src/mapper/map.ts`</sub>
- detectDrift treats 'no digestHash on record' as drift=true, unknown=true (unless zero modules exist) — never reported as 'unchanged'. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- Whole-repo digest hash changing does NOT drift a module whose own owned-file fingerprint is unchanged (digest hash can move for reasons no module owns, e.g. tracked .swarm/). <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- Every module ends a map run in swarms[slug].state = 'sleeping'; swarm records for slugs no longer in finalModules are dropped. <sub>`packages/core/src/mapper/pipeline/build-next-state.ts`</sub>
- renderModuleCharter's footer promises `swarm map` never overwrites module.md without --force / never touches memory.md/decisions.md — analyse-module.ts's normal path always overwrites both; that protection, if real, is enforced outside this module. <sub>`packages/core/src/mapper/map.ts` [doc]</sub>
- applyVerifyCommandDetection only ever fills a blank config.verifyCommand — enforced as its first line (`if (config.verifyCommand) return undefined;`) — so it's safe to call unconditionally on every mapProject run without risk of overwriting a user-set command. <sub>`packages/core/src/mapper/pipeline/apply-verify-command-detection.ts`</sub>

## Gotchas

- buildDigest's `hash` field is NOT what per-module drift is computed from — that's module-files.ts's hashFiles applied to just that module's owned files; digest.hash only short-circuits detectDrift when nothing changed at all. <sub>`packages/core/src/mapper/digest.ts`</sub>
- digest.sourceFiles is populated only under SMALL_REPO_FILES (400) tracked files; above that only the directory tree (capped 140 lines) is sent to the partition agent. <sub>`packages/core/src/mapper/digest.ts`</sub>
- areaNames is passed to analyzeModule as a distinct field, not appended into systemSummary text — do not revert to string-smuggling (past bug from uncoordinated agents). <sub>`packages/core/src/mapper/pipeline/analyse-module.ts`</sub>
- In analyseModule, if analysis.correctedOwns is set, the returned hash is recomputed via hashFiles(ownedNow, ...); otherwise it's just entry.hash from pre-analysis owns. Getting this branch backwards lets a module with corrected ownership be marked 'unchanged' against files it no longer owns. <sub>`packages/core/src/mapper/pipeline/analyse-module.ts`</sub>
- surveyModuleAreas calls workspace.pruneAreas unconditionally, even with zero detected areas — a module that shrank below the area threshold loses prior area memory. <sub>`packages/core/src/mapper/pipeline/survey-module-areas.ts`</sub>
- MODULE_MAP_SCHEMA has no `pattern` regex on slug — a regex would force a full structured-output retry on minor slip; normalization happens via slugify() in code instead. <sub>`packages/core/src/mapper/map.ts`</sub>
- mapRepository's repair round is only accepted if it strictly improves empty-module count; a non-improving repair is discarded silently. <sub>`packages/core/src/mapper/map.ts`</sub>
- mapProject's costUsd only sums freshly-analysed modules' costs — excludes area-survey agent costs and the partition agent's cost; undercounts total spend on runs that repartition or split areas. <sub>`packages/core/src/mapper/pipeline.ts`</sub>
- detectVerifyCommand's fallback candidate order (when no dominant-language match) puts Cargo.toml BEFORE go.mod — a repo with both and a non-matching dominant language yields `cargo test`, not `go test`. <sub>`packages/core/src/mapper/pipeline/detect-verify-command.ts`</sub>
- digest.languages entries are lowercased extensions with no leading dot ('ts', 'py', 'go'); files with no extension (e.g. Makefile) bucket under '(none)' — so a 'make test' candidate's languages array is always empty and can only be picked via matrix-order fallback, never a dominant-language match. <sub>`packages/core/src/mapper/pipeline/detect-verify-command.ts`</sub>
- New mapper exports meant for cli/other packages must reach `packages/core/src/index.ts`, the flat @swarm-os/core barrel — but that file is owned by the runtime module, not mapper, so mapper cannot edit it directly. Re-exporting from mapper/pipeline.ts alone is NOT sufficient for `import { x } from '@swarm-os/core'` to work. Precedent (2026-08-15, 2026-08-17, 2026-08-21): each time this was missed, review flagged it as a blocking gap. Always leave an explicit follow-up note in decisions.md ("index.ts needs X — owned by runtime, not mine to edit") when adding an export a consumer outside mapper needs; the 2026-08-21 mission (detectVerifyCommand for doctor) missed this note and got a changes-needed review verdict as a result — check decisions.md before assuming it's done. <sub>`packages/core/src/index.ts`</sub>

## Landmarks

- `packages/core/src/mapper/pipeline/plan-module-analysis.ts` — Decides per-module whether last analysis still holds or a fresh analyst is needed.
- `packages/core/src/mapper/pipeline/resolve-partition.ts` — Calls mapRepository fresh or reuses existing modules/system summary, per should-partition.ts.
- `packages/core/src/mapper/pipeline/analyse-module.ts` — Runs one module's analyst, writes module.md + memory.md, applies correctedOwns.
- `packages/core/src/mapper/pipeline/survey-module-areas.ts` — Detects sub-domains, spawns one analyst per area under .swarm/modules/<slug>/areas/.
- `packages/core/src/mapper/pipeline/build-next-state.ts` — Assembles next state.json; every module forced to 'sleeping'.
- `packages/core/src/mapper/pipeline/detect-verify-command.ts` — Pure filesystem detection of a candidate verifyCommand (npm/pytest/cargo/go/make matrix), disambiguated by digest's dominant language; returns chosen + alternatives.
- `packages/core/src/mapper/pipeline/apply-verify-command-detection.ts` — Called by mapProject; fills config.verifyCommand from detect-verify-command only if it was empty; persists to .swarm/config.yaml.
- `packages/core/src/mapper/pipeline/synthesise-system-map.ts` — Renders system.md, now includes a **Verify.** line reporting the detected/chosen verifyCommand or its absence.

## Public interface

- mapProject(options: MapProjectOptions): Promise<MapResult> — full incremental map run, re-exported from packages/core/src/index.ts
- MapResult now includes verifyCommandMessage?: string — human-readable outcome of verify-command detection for this run
- detectDrift(workspace), pendingSplits(workspace, config), mapRepository(options), buildDigest(repoRoot), renderDigest(digest), renderSystemMap, MODULE_MAP_SCHEMA — re-exported from index.ts
- detectVerifyCommand(repoRoot, digest) — pure fs-inspection helper, re-exported from mapper/pipeline.ts; NOT yet reachable via `@swarm-os/core` flat barrel (index.ts edit pending, owned by runtime module — see gotcha above)
- Types: MapResult, MapProgress, MapModuleResult, MapPhase, MapProjectOptions, RepoDigest — re-exported from index.ts
