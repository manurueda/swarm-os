# Workspace & Git Worktrees — memory

_Durable knowledge for the `workspace-git` swarm. Read on wake, rewritten on sleep._

## Invariants

- StateFile (.swarm/state.json) must be read and written whole, preserving unknown fields — readState spreads the raw parsed object rather than rebuilding from known keys, because an earlier version that rebuilt it silently dropped digestHash/moduleHashes and broke incremental re-mapping. <sub>`packages/core/src/workspace/store.ts`</sub>
- resetMissionLog() must be called before a mission starts writing events.jsonl, because mission ids are derived from the goal so re-running the same goal reuses the same directory; without clearing it, the log interleaves events from two different runs. <sub>`packages/core/src/workspace/store.ts`</sub>
- archiveModulesNotIn moves (not deletes) module directories dropped by a repartition, into .swarm/archive/<label>/, to preserve accumulated memory; listModules() would otherwise return stale slugs alongside new ones and corrupt ownership resolution. <sub>`packages/core/src/workspace/store.ts`</sub>
- memory.md and decisions.md are seeded only if absent (writeModule never overwrites them) — swarm map must never regenerate accumulated memory from scratch. <sub>`packages/core/src/workspace/store.ts`</sub>
- parseConfig always forces version:1 regardless of what's in the file, and unknown/malformed YAML falls back to DEFAULT_CONFIG entirely rather than partially — config.yaml is committed and must be forward/backward tolerant across Swarm OS versions. <sub>`packages/core/src/workspace/config.ts`</sub>
- DEFAULT_CONFIG.worktreeLinks deliberately excludes anything that could hold secrets (e.g. .env); only dependency directories (node_modules, .venv, vendor, target, .gradle) are symlinked into agent worktrees by default. <sub>`packages/core/src/workspace/config.ts`</sub>
- Linked dependency symlinks (from linkDependencies) must be excluded from commitAll and changedFiles via the `linked` parameter — a trailing-slash gitignore pattern like `node_modules/` does not match a symlink of that name, so without explicit exclusion every mission would report/commit an absolute machine-local path. <sub>`packages/core/src/git/worktree.ts`</sub>
- commitAll must exclude linked paths by staging everything then `git rm --cached` on the linked names, NOT via an `:(exclude)` pathspec — naming an explicit pathspec makes `git add` fail outright when the path is gitignored, which silently produced 'nothing committed' missions. <sub>`packages/core/src/git/worktree.ts`</sub>
- isWorkingTreeCleanIgnoringSwarm treats any status line whose path starts with '.swarm/' as clean; used by `swarm loop`'s pre-flight so the tool's own bookkeeping never blocks or is blamed for dirtying the tree. <sub>`packages/core/src/git/worktree.ts`</sub>
- ensureSwarmIgnore fully rewrites .swarm/.gitignore on every call rather than merging with an existing one — an older/narrower version already committed is exactly the failure mode it fixes. <sub>`packages/core/src/git/worktree.ts`</sub>

## Gotchas

- ensureWorktreeIgnore is a deprecated alias for ensureSwarmIgnore, kept only for compatibility — new code should call ensureSwarmIgnore directly. <sub>`packages/core/src/git/worktree.ts`</sub>
- createWorktree reuses an existing worktree at the target path (detected via a .git file inside it) without checking the branch matches; it just re-links dependencies and returns created:false. Callers relying on a specific branch should verify it themselves. <sub>`packages/core/src/git/worktree.ts`</sub>
- fullDiff runs `git add -AN` (intent-to-add) first as a side effect so untracked new files show up in the diff — this mutates the worktree's index state even though the function looks read-only. <sub>`packages/core/src/git/worktree.ts`</sub>
- Workspace.find() walks up parent directories looking for .swarm/config.yaml specifically (not just a .swarm/ dir) to decide a workspace exists at that root. <sub>`packages/core/src/workspace/store.ts`</sub>
- swarmRecord() only includes memoryAreas when listAreas() returns a non-empty list; modules with a single unsplit memory.md get no memoryAreas key at all (not an empty array) — callers must check for its presence, not just length. <sub>`packages/core/src/workspace/store.ts`</sub>
- .swarm/config.yaml, system.md and the modules/ tree are meant to be committed (shared knowledge); everything else under .swarm/ (worktrees, missions/, state.json, loop.log/json, view.html, REFACTOR.md, archive/) is written to .swarm/.gitignore by ensureSwarmIgnore and must stay per-machine/per-run. <sub>`packages/core/src/git/worktree.ts`</sub>

## Landmarks

- `packages/core/src/workspace/store.ts` — Workspace class: config, system.md, per-module files (module.md/memory.md/decisions.md/verification.md/conventions.md), per-module 'areas' for split memory, state.json (swarm records), mission records + event logs, and archiving of stale module dirs.
- `packages/core/src/workspace/config.ts` — SwarmConfig type + DEFAULT_CONFIG + parseConfig/serializeConfig for .swarm/config.yaml, which is committed to the target repo.
- `packages/core/src/git/worktree.ts` — git() exec wrapper, isWorkingTreeClean(IgnoringSwarm), createWorktree/removeWorktree/pruneWorktrees, linkDependencies (symlinks node_modules etc into worktrees), changedFiles/diffStat/fullDiff, commitAll, ensureSwarmIgnore (writes .swarm/.gitignore).
- `packages/core/src/git/clean-tree.test.ts` — Regression tests pinning down exactly what isWorkingTreeCleanIgnoringSwarm must and must not ignore — read before touching that function.
- `packages/core/src/git/linked-paths.test.ts` — Regression tests for why symlinked dependency dirs must be excluded from both commitAll and changedFiles, including the pathspec-exclude bug this codebase hit and avoided.

## Public interface

- Workspace class (find, exists, readConfig/writeConfig, readSystem/writeSystem, readSystemFile/writeSystemFile, moduleDir/listModules/readModule/writeModule/archiveModulesNotIn, readModuleFile/writeModuleFile, areaDir/listAreas/readAreaFile/writeAreaFile/pruneAreas, appendDecision, readState/writeState/updateSwarm/swarmRecord, missionDir/writeMission/resetMissionLog/readMission/listMissions/writeMissionFile/logEvent/removeMission, rel)
- SWARM_DIR, estimateTokens
- ModuleFile, StateFile, MemoryArea types
- SwarmConfig type, DEFAULT_CONFIG, parseConfig, serializeConfig
- git(), isGitRepo, currentBranch, isWorkingTreeClean, isWorkingTreeCleanIgnoringSwarm
- createWorktree, removeWorktree, pruneWorktrees, WorktreeHandle type
- linkDependencies, ensureSwarmIgnore (+ deprecated ensureWorktreeIgnore alias)
- changedFiles, diffStat, fullDiff, commitAll
- all re-exported wholesale from packages/core/src/index.ts

---

_Surveyed 2026-08-15 by the `workspace-git` analyst, reading only this module's paths._
