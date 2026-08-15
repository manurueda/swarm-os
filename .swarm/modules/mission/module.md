# Mission Orchestration

Defines and executes a Swarm OS 'mission': routing a single natural-language goal to the module(s) it touches (route.ts), spawning one isolated worker agent per assigned module in its own git worktree with only that module's charter/memory (run.ts), and having an independent reviewer agent critique each resulting diff before it is committed (review.ts). run.ts is the orchestrator that ties routing, worktree creation, agent execution, review, commit, memory-compression ('sleep'), and worktree cleanup into one end-to-end mission lifecycle.

## Owns

- `packages/core/src/mission/**`

## Read first

- `packages/core/src/mission/run.ts` — The orchestrator — runMission() is the single public entry point that drives route -> spawn -> work -> review -> commit -> harvest/sleep -> cleanup. Also defines missionId(), WorkReport, MissionModuleResult, MissionResult.
- `packages/core/src/mission/route.ts` — routeMission() — cheap LLM call that maps a goal to per-module task assignments using only a one-line summary per module (not full repo context).
- `packages/core/src/mission/review.ts` — reviewModuleChange() — read-only reviewer agent that checks a worker's diff for invented cross-module contracts, dead code, unmet task, false verification claims.

## Depends on

- `runtime`
- `swarm-orchestration`
- `workspace-git`
- `mapper`

## System context

Swarm OS is a CLI + core library that decomposes a target repository into ownable modules and dispatches teams of Claude Code agents ('swarms') to work those modules concurrently in isolated git worktrees, coordinating missions, ownership, and scheduling. It is built for developers who want unattended, context-economical multi-agent refactors and feature work on their own codebases.

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
