# Workspace & Git Worktrees — memory

_Durable knowledge for the `workspace-git` swarm. Read on wake, rewritten on sleep._

## Invariants

- StateFile (.swarm/state.json) must be read/written whole, never rebuilt from a subset of known keys — an earlier bug reconstructing it from `swarms`/`mappedAt` silently dropped `digestHash`/`moduleHashes`, breaking incremental re-mapping. readState spreads the raw parsed object before overriding `swarms`. <sub>`packages/core/src/workspace/store.ts`</sub>
- writeModule() only seeds memory.md/decisions.md if they don't already exist (existsSync guard) — `swarm map` must never regenerate/overwrite accumulated memory, only ownership.yaml and module.md are always rewritten. <sub>`packages/core/src/workspace/store.ts`</sub>
- archiveModulesNotIn moves (never deletes) stale module directories to .swarm/archive/<label>/ to preserve memory when repartitioning changes the slug set; a rename collision (same-day re-partition) force-removes the old archive target first. <sub>`packages/core/src/workspace/store.ts`</sub>
- resetMissionLog must be called before a mission starts to truncate events.jsonl — mission ids derive from the goal, so re-running the same goal reuses the same directory, and an un-reset log would interleave events from two separate runs. <sub>`packages/core/src/workspace/store.ts`</sub>
- isWorkingTreeCleanIgnoringSwarm treats ONLY paths under `.swarm/` (tracked or untracked) as non-dirty; any other untracked/modified file still fails the check. Used by `swarm loop` so the tool's own bookkeeping never self-blocks the next iteration. <sub>`packages/core/src/git/worktree.ts`</sub>
- commitAll/changedFiles/diffStat/fullDiff all hide two things unconditionally: names in the `linked` argument (dependency symlinks like node_modules/.venv) and the literal `.swarm` directory — via hiddenFromWork(linked) = [...linked, '.swarm']. `.swarm/` edits an agent makes during a mission must never ride the work branch, since the memory compressor rewrites those same files on the main checkout at mission end. <sub>`packages/core/src/git/worktree.ts`</sub>
- commitAll stages with a two-step add-then-unstage (`git add -A` then `git rm --cached --ignore-unmatch` per hidden name), not an `:(exclude)` pathspec — an explicit pathspec makes `git add` FAIL outright on ignored paths instead of skipping them, which previously caused missions to report success with nothing committed once a repo's .gitignore caught the linked symlink name. <sub>`packages/core/src/git/worktree.ts`</sub>
- linkDependencies creates symlinks (not copies) pointing at the repo root's existing node_modules/.venv/etc; missing sources are skipped silently and existing targets are skipped (idempotent reuse of an existing worktree). <sub>`packages/core/src/git/worktree.ts`</sub>
- createWorktree reuses an existing worktree at the same path (checked via presence of `<path>/.git`) without re-running `git worktree add`, and reuses an existing branch name (`rev-parse --verify`) rather than erroring if it's already there. <sub>`packages/core/src/git/worktree.ts`</sub>
- config.yaml is committed to the target repo by design, must never contain credentials/machine-specific paths, and parseConfig always forces `version: 1` on read regardless of stored value — unknown/malformed YAML silently falls back to DEFAULT_CONFIG rather than throwing. <sub>`packages/core/src/workspace/config.ts`</sub>
- parseConfig spreads DEFAULT_CONFIG before the parsed YAML, so any newly added SwarmConfig field is automatically backward-compatible for legacy on-disk configs — adding a field only requires updating the interface and DEFAULT_CONFIG, no migration code needed. <sub>`packages/core/src/workspace/config.ts`</sub>
- SwarmConfig has `maxVerifyRounds` (number, default 2) alongside `verifyCommand`/`verifyEnv`, controlling how many fix-and-reverify loops the mission layer runs against a module's verify command. <sub>`packages/core/src/workspace/config.ts`</sub>

## Gotchas

- ensureWorktreeIgnore is a deprecated alias for ensureSwarmIgnore, kept only for compatibility — new code should call ensureSwarmIgnore directly. <sub>`packages/core/src/git/worktree.ts`</sub>
- ensureSwarmIgnore fully overwrites .swarm/.gitignore on every call (not merged/appended) — intentionally destructive so a stale, narrower version from an older Swarm OS build can't linger. <sub>`packages/core/src/git/worktree.ts`</sub>
- isLinkedPath/hiddenFromWork compare by exact top-level name or `name + '/'` prefix against the string list from linkDependencies' return value — it does not re-scan the filesystem for symlinks, so a caller that fails to pass the same `linked` list used at worktree-creation time leaks dependency paths into diffs/commits. <sub>`packages/core/src/git/worktree.ts`</sub>
- fullDiff runs `git add -AN` (intent-to-add) as a side effect before diffing, purely so untracked new files show up in the diff output — this mutates the worktree's index even though the function name suggests read-only. <sub>`packages/core/src/git/worktree.ts`</sub>
- git() never throws — failures are swallowed into `{ok: false, stdout, stderr}`; every caller must check `.ok` explicitly (isWorkingTreeClean/diffStat fall back to false/'' on failure). <sub>`packages/core/src/git/worktree.ts`</sub>
- Workspace.find() walks up parent directories looking for `.swarm/config.yaml` specifically (not just a `.swarm/` dir) — a `.swarm/` dir without config.yaml (mid-init) won't be found as an existing workspace. <sub>`packages/core/src/workspace/store.ts`</sub>
- swarmRecord() returns memoryAreas only when listAreas() is non-empty; callers must treat memoryAreas as absent (not empty array) to mean 'memory is not split'. <sub>`packages/core/src/workspace/store.ts`</sub>
- In sandboxed mission sessions, npm test / npx tsc / other build-and-test commands may be refused outright by the permission layer even with sandbox disabled and no approver present; changes to config.ts have historically been verified only by code inspection (spread/merge semantics) rather than execution in that case.

## Landmarks

- `packages/core/src/workspace/store.ts` — Workspace class: config, system.md, per-module (ownership.yaml/module.md/memory.md/decisions.md), per-area memory, state.json, mission records + events.jsonl. ~470 lines, exhaustive.
- `packages/core/src/workspace/config.ts` — SwarmConfig interface + DEFAULT_CONFIG + parseConfig/serializeConfig. Committed to the target repo at .swarm/config.yaml. Fields include verifyCommand, verifyEnv, maxVerifyRounds.
- `packages/core/src/git/worktree.ts` — git() exec wrapper, isGitRepo/currentBranch/isWorkingTreeClean(IgnoringSwarm), ensureSwarmIgnore, linkDependencies, createWorktree/removeWorktree/pruneWorktrees, changedFiles/diffStat/fullDiff/commitAll.
- `packages/core/src/git/clean-tree.test.ts` — Regression tests proving the loop's clean-tree check ignores .swarm/ churn but still blocks on real user changes.
- `packages/core/src/git/linked-paths.test.ts` — Regression tests proving linked dependency symlinks and .swarm/ are invisible to changedFiles/fullDiff/diffStat/commitAll, including the gitignored-symlink edge case.
- `packages/core/src/index.ts` — Barrel re-export (lines ~45-48, ~126-142) — confirms exactly which store/config/git symbols are the module's real public interface.

## Public interface

- Workspace class (find, exists, readConfig/writeConfig, readSystem/writeSystem, readSystemFile/writeSystemFile, moduleDir/listModules/readModule/writeModule, archiveModulesNotIn, readModuleFile/writeModuleFile, areaDir/listAreas/readAreaFile/writeAreaFile/pruneAreas, appendDecision, readState/writeState/updateSwarm/swarmRecord, missionDir/writeMission/resetMissionLog/readMission/listMissions/writeMissionFile/logEvent/removeMission, rel)
- SWARM_DIR, estimateTokens constants/fns
- ModuleFile, StateFile, MemoryArea types
- SwarmConfig type (incl. maxVerifyRounds), DEFAULT_CONFIG, parseConfig, serializeConfig
- git(), isGitRepo, currentBranch, isWorkingTreeClean, isWorkingTreeCleanIgnoringSwarm, ensureSwarmIgnore
- createWorktree, linkDependencies, removeWorktree, pruneWorktrees, WorktreeHandle type
- changedFiles, diffStat, fullDiff, commitAll
- All re-exported flat from packages/core/src/index.ts (the @swarm-os/core barrel), consumed by mission/run.ts, mapper/pipeline.ts, ui/snapshot.ts, swarm/manager.ts, swarm/memory-state.ts, swarm/finalize-sleep.ts, swarm/file-area-sections.ts, swarm/verify.ts, loop/run.ts

---

_Surveyed 2026-08-21 by the `workspace-git` analyst, reading only this module's paths._
