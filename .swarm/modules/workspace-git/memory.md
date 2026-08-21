# Workspace & Git Worktrees — memory

_Durable knowledge for the `workspace-git` swarm. Read on wake, rewritten on sleep._

## Invariants

- StateFile (.swarm/state.json) must be read/written whole, never rebuilt from a subset of known keys — readState spreads the raw parsed object before overriding `swarms`, so `digestHash`/`moduleHashes` survive. <sub>`packages/core/src/workspace/store.ts`</sub>
- writeModule() only seeds memory.md/decisions.md if they don't already exist (existsSync guard) — `swarm map` must never regenerate accumulated memory, only ownership.yaml/module.md. <sub>`packages/core/src/workspace/store.ts`</sub>
- archiveModulesNotIn moves (never deletes) stale module dirs to .swarm/archive/<label>/; a rename collision force-removes the old archive target first. <sub>`packages/core/src/workspace/store.ts`</sub>
- resetMissionLog must be called before a mission starts to truncate events.jsonl — mission ids derive from the goal, so re-running the same goal reuses the directory. <sub>`packages/core/src/workspace/store.ts`</sub>
- isWorkingTreeCleanIgnoringSwarm treats ONLY paths under `.swarm/` as non-dirty; used by `swarm loop` so tool bookkeeping never self-blocks. <sub>`packages/core/src/git/worktree.ts`</sub>
- **commitAll signature is now `(worktreePath, moduleSlug, ownsGlobs, message, linked?) → CommitSplit`** (breaking change; no longer a boolean/`{ok,detail}` result). It performs a two-phase commit: paths matching `ownsGlobs` (via `isOwned`/`checkOwnership` from swarm-orchestration's `ownership.ts`) go into the main commit; everything else out of bounds — additions, modifications, AND deletions — goes into a second commit prefixed `OUT OF BOUNDS (<module-slug>): <paths>`. Main commit is skipped if nothing is owned; quarantine commit is skipped if nothing is out of bounds. Linked paths (per `hiddenFromWork`) are excluded from both, unchanged. Every caller must migrate in lockstep — `packages/core/src/mission/run.ts` (module `mission`) is the sole external caller (confirmed via repo-wide grep). <sub>`packages/core/src/git/worktree.ts`</sub>
- commitAll/changedFiles/diffStat/fullDiff hide two things unconditionally: names in the `linked` argument and the literal `.swarm` directory, via `hiddenFromWork(linked) = [...linked, '.swarm']`. <sub>`packages/core/src/git/worktree.ts`</sub>
- linkDependencies creates symlinks (not copies) to the repo root's node_modules/.venv/etc; missing sources skipped silently, existing targets skipped (idempotent). <sub>`packages/core/src/git/worktree.ts`</sub>
- createWorktree reuses an existing worktree (checked via `<path>/.git`) without re-running `git worktree add`, and reuses an existing branch rather than erroring. <sub>`packages/core/src/git/worktree.ts`</sub>
- config.yaml is committed to the target repo, must never contain credentials/machine paths; parseConfig always forces `version: 1` and falls back to DEFAULT_CONFIG on malformed YAML rather than throwing. <sub>`packages/core/src/workspace/config.ts`</sub>
- parseConfig spreads DEFAULT_CONFIG before parsed YAML — new SwarmConfig fields are auto-backward-compatible, no migration code needed. <sub>`packages/core/src/workspace/config.ts`</sub>
- SwarmConfig has `maxVerifyRounds` (default 2) alongside `verifyCommand`/`verifyEnv`. <sub>`packages/core/src/workspace/config.ts`</sub>

## Gotchas

- **Known bug pending fix**: commitAll's final `commitStaged` step commits whatever `git diff --cached --name-only` reports at commit time, not just what `stagePaths` staged in this call — the old `git rm --cached --ignore-unmatch` cleanup of hidden/linked paths from the index is gone. `mission/run.ts` calls `fullDiff()` (which does `git add -AN`, staging every non-ignored path with no exclusion) immediately before `commitAll()`; any non-gitignored `.swarm/*` stub already in the index from that prior add can ride into the main commit uncleaned. Fix: strip hidden/linked paths from the index before diffing --cached, not only before staging. No test covers the fullDiff→commitAll sequence.
- Untested edge case: `git status --porcelain` collapses a brand-new untracked directory into one line (`?? newdir/`) unless `-uall` is passed; classifier/pathspec staging behavior for a new subdirectory straddling the owned/quarantine boundary is unverified (likely fine under `:(literal)` prefix matching, but unconfirmed).
- Do NOT add a backward-compatible overload defaulting `ownsGlobs` to `['**']` for old-style callers — that silently disables the boundary enforcement the change exists to add.
- As of this writing, `packages/core/src/mission/run.ts` (module `mission`) still calls commitAll with the pre-change 3-arg signature and reads the old `{ok,detail}` shape — repo-wide `tsc --build` is red until that module updates. Not a defect in workspace-git.
- ensureWorktreeIgnore is a deprecated alias for ensureSwarmIgnore; call ensureSwarmIgnore directly. <sub>`packages/core/src/git/worktree.ts`</sub>
- ensureSwarmIgnore fully overwrites .swarm/.gitignore every call (intentional — kills stale narrower versions). <sub>`packages/core/src/git/worktree.ts`</sub>
- isLinkedPath/hiddenFromWork compare against the string list from linkDependencies' return value, no filesystem re-scan — callers must pass the same `linked` list used at worktree creation. <sub>`packages/core/src/git/worktree.ts`</sub>
- fullDiff runs `git add -AN` (intent-to-add) as a side effect before diffing, mutating the index despite the read-only-sounding name. <sub>`packages/core/src/git/worktree.ts`</sub>
- git() never throws — failures become `{ok:false, stdout, stderr}`; every caller must check `.ok`. <sub>`packages/core/src/git/worktree.ts`</sub>
- Workspace.find() walks up looking for `.swarm/config.yaml` specifically — a bare `.swarm/` dir (mid-init) isn't found. <sub>`packages/core/src/workspace/store.ts`</sub>
- swarmRecord() returns memoryAreas only when listAreas() is non-empty; treat absent (not empty array) as "memory not split". <sub>`packages/core/src/workspace/store.ts`</sub>
- In sandboxed mission sessions, build/test commands (npm test, tsc) may be refused outright by the permission layer even without an approver — verify config/git changes by inspection when execution isn't available.

## Landmarks

- `packages/core/src/workspace/store.ts` — Workspace class: config, system.md, per-module files, per-area memory, state.json, mission records + events.jsonl. ~470 lines, exhaustive.
- `packages/core/src/workspace/config.ts` — SwarmConfig interface + DEFAULT_CONFIG + parseConfig/serializeConfig, committed at .swarm/config.yaml.
- `packages/core/src/git/worktree.ts` — git() exec wrapper, isGitRepo/currentBranch/isWorkingTreeClean(IgnoringSwarm), ensureSwarmIgnore, linkDependencies, createWorktree/removeWorktree/pruneWorktrees, changedFiles/diffStat/fullDiff/commitAll (now two-phase, returns CommitSplit), statusPaths/stagePaths/commitStaged helpers.
- `packages/core/src/git/clean-tree.test.ts` — regression: loop's clean-tree check ignores .swarm/ churn, still blocks on real changes.
- `packages/core/src/git/linked-paths.test.ts` — regression: linked symlinks and .swarm/ invisible to changedFiles/fullDiff/diffStat/commitAll, incl. gitignored-symlink edge case.
- `packages/core/src/git/commit-boundary.test.ts` — new: owned-only → one commit; mixed → two commits w/ correct split; out-of-bounds deletion → quarantine only; all-out-of-bounds → quarantine-only commit; linked paths uncommitted in both.
- `packages/core/src/index.ts` — barrel re-export confirming the module's real public interface.

## Public interface

- Workspace class (find, exists, readConfig/writeConfig, readSystem/writeSystem, readSystemFile/writeSystemFile, moduleDir/listModules/readModule/writeModule, archiveModulesNotIn, readModuleFile/writeModuleFile, areaDir/listAreas/readAreaFile/writeAreaFile/pruneAreas, appendDecision, readState/writeState/updateSwarm/swarmRecord, missionDir/writeMission/resetMissionLog/readMission/listMissions/writeMissionFile/logEvent/removeMission, rel)
- SWARM_DIR, estimateTokens constants/fns
- ModuleFile, StateFile, MemoryArea types
- SwarmConfig type (incl. maxVerifyRounds), DEFAULT_CONFIG, parseConfig, serializeConfig
- git(), isGitRepo, currentBranch, isWorkingTreeClean, isWorkingTreeCleanIgnoringSwarm, ensureSwarmIgnore
- createWorktree, linkDependencies, removeWorktree, pruneWorktrees, WorktreeHandle type
- changedFiles, diffStat, fullDiff, commitAll(worktreePath, moduleSlug, ownsGlobs, message, linked?) → CommitSplit
- CommitSplit type (main commit hash/paths, quarantine commit hash/paths)
- All re-exported flat from packages/core/src/index.ts (@swarm-os/core barrel), consumed by mission/run.ts, mapper/pipeline.ts, ui/snapshot.ts, swarm/manager.ts, swarm/memory-state.ts, swarm/finalize-sleep.ts, swarm/file-area-sections.ts, swarm/verify.ts, loop/run.ts
