# Mission Orchestration

Executes a single Swarm OS mission end-to-end: routes a natural-language goal to the fewest module(s) that must change (route.ts), spawns one isolated worker agent per assigned module in its own git worktree with only that module's charter/memory/context pack (run.ts:runMission), has a read-only reviewer agent critique each module's diff before commit (review.ts), then commits per-module branches, triggers memory compression ('sleep') for every touched swarm, and cleans up worktrees whose work was safely committed. run.ts is the sole orchestrator; route.ts and review.ts are agent-spawning helpers it calls.

## Owns

- `packages/core/src/mission/**`

## Read first

- `packages/core/src/mission/run.ts` — The orchestrator: runMission() is the whole mission lifecycle (route → spawn worktrees → work agents → review → commit → sleep → cleanup). Also defines missionId(), WorkReport/WORK_REPORT_SCHEMA, and the fixed worker system prompt (workerCharter).
- `packages/core/src/mission/route.ts` — routeMission(): a tool-less, cheap agent call that turns a goal + one-line-per-module summary into a MissionPlan (module -> task -> rationale). renderPlan() writes plan.md.
- `packages/core/src/mission/review.ts` — reviewModuleChange(): read-only reviewer agent that checks a module's diff against cross-module contracts, wiring, task fidelity, and verification claims before the diff is committed.
- `packages/core/src/mission/mission-id.test.ts` — Regression test documenting why missionId() must hash the FULL goal, not just its slug — protects against two goals differing only after word six colliding on one mission directory.

## Depends on

- `runtime`
- `swarm-orchestration`
- `workspace-git`
- `mapper`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
