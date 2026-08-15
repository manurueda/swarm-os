# Mission Orchestration

Executes a single Swarm OS 'mission': turn one natural-language goal into module assignments (route.ts), spawn one isolated worker agent per assigned module in its own git worktree with only that module's context (run.ts), have an independent read-only reviewer agent critique the resulting diff before commit (review.ts), then commit, compress the module's memory ('sleep'), and clean up worktrees. run.ts is the single orchestrator tying all of this together end-to-end.

## Owns

- `packages/core/src/mission/**`

## Read first

- `packages/core/src/mission/run.ts` — The orchestrator: runMission() drives route -> spawn worktree -> build context pack -> run worker agent -> compute diff/ownership -> review -> commit -> sleep/compress memory -> remove worktree -> write mission report. Also defines missionId(), WorkReport, MissionResult types and the worker's system prompt (workerCharter).
- `packages/core/src/mission/route.ts` — routeMission(): a cheap, tool-less agent that maps a goal to a minimal set of module assignments using only a system summary + one line per module (not the whole repo). Defines MissionPlan parsing/validation and renderPlan() for plan.md.
- `packages/core/src/mission/review.ts` — reviewModuleChange(): a read-only agent (Read/Grep/Glob only) that reviews one module's diff against its task, checks cross-module contract usage, verification claims, and whether new code is wired in. Verdict is advisory only — never blocks the commit.
- `packages/core/src/mission/mission-id.test.ts` — Regression test documenting exactly why missionId() must hash the full goal, not just derive a slug — read this before touching missionId().

## Depends on

- `swarm-orchestration`
- `workspace-git`
- `runtime`
- `mapper`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
