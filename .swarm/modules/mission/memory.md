# Mission Orchestration — memory

_Durable knowledge for the `mission` swarm. Read on wake, rewritten on sleep._

## Invariants

- missionId(goal, now) must be a function of the ENTIRE goal string (via a sha256 fingerprint suffix), not just a slug of its first words — two goals differing only after word six previously collided on the same mission directory and overwrote each other's plan/report/event log. <sub>`packages/core/src/mission/run.ts`</sub>
- runMission() always calls workspace.resetMissionLog(id) before logging, because the same goal always maps to the same mission id/directory, so a stale log from a previous run of the identical goal must be cleared first. <sub>`packages/core/src/mission/run.ts`</sub>
- Worktrees are only removed after a module's changes are committed; if a worktree has uncommitted changed files it is deliberately kept (and reported) rather than deleted, so in-progress/failed-commit work is never silently lost. <sub>`packages/core/src/mission/run.ts`</sub>
- A commit failure (commitAll ok:false) is treated as a distinct, serious outcome (commitError) — the code comment explicitly calls a silently-failed commit 'the worst outcome available' because the branch would be announced ready with nothing on it. <sub>`packages/core/src/mission/run.ts`</sub>
- Review runs before commit but is advisory-only: a reject verdict marks the MissionModuleResult as not ok, but the commit still happens regardless of verdict (committed is computed independently of review). Review failures (thrown errors) are swallowed so a broken reviewer never loses the author's work. <sub>`packages/core/src/mission/run.ts`</sub>
- The router (routeMission) is given zero tools (tools: []) so it cannot explore the repo itself — routing decisions must come only from the system summary and one line per module. <sub>`packages/core/src/mission/route.ts`</sub>
- parsePlan() silently drops any assignment whose module slug is not in the known module set (hallucinated slugs), rather than erroring the whole mission. <sub>`packages/core/src/mission/route.ts`</sub>
- The reviewer agent is restricted to tools: ['Read','Grep','Glob'] — it is structurally read-only and cannot edit the worktree it is reviewing. <sub>`packages/core/src/mission/review.ts`</sub>
- reviewModuleChange truncates diffs over 60,000 chars (MAX_DIFF_CHARS) with a note telling the reviewer to read files directly for the rest, rather than sending the whole diff. <sub>`packages/core/src/mission/review.ts`</sub>
- Worker agents (module role) run with settingSources: 'project' inside the target repo's own worktree so the target project's own Claude settings apply, unlike the router/reviewer which use standalone/override system prompts. <sub>`packages/core/src/mission/run.ts`</sub>

## Gotchas

- parseReview() defaults an unparseable/failed reviewer outcome to verdict 'approve' (with an error field set), not to 'reject' or 'changes-needed' — a reviewer agent that crashes or returns malformed JSON does NOT block the mission; it silently approves. <sub>`packages/core/src/mission/review.ts`</sub>
- The whole point of the reviewer's charter (documented in the file's own header comment) is a real historical incident: a worker agent produced code that compiled, stayed inside its module boundary, reported 'complete', yet invented a neighbouring module's CLI syntax because it structurally could not have known better — this is why cross-module contract checking is listed as the reviewer's #1, highest-priority check. <sub>`packages/core/src/mission/review.ts`</sub>
- MissionModuleResult.ok is false if the worker reports status 'blocked' OR the reviewer verdict is 'reject' OR the agent outcome itself failed — but a module can still be 'committed: true' even when ok is false, since commit happens independently of the ok computation. <sub>`packages/core/src/mission/run.ts`</sub>
- If the goal is routed via the explicit `modules` option (bypassing the router), the MissionPlan is synthesized with the SAME task text (the raw goal) assigned identically to every named module — there is no per-module task tailoring in that path, unlike normal routing which writes a distinct self-contained task per module. <sub>`packages/core/src/mission/run.ts`</sub>
- renderModuleReport() (fed into sleepSwarm's memory compression) intentionally shows only that module's own slice of the mission — not other modules' changes — reinforcing the isolation invariant even at the memory-writing stage. <sub>`packages/core/src/mission/run.ts`</sub>

## Landmarks

- `packages/core/src/mission/run.ts` — runMission() orchestrator; missionId(); WORK_REPORT_SCHEMA/WorkReport; MissionProgress/MissionModuleResult/MissionResult types; renderMissionReport()/renderModuleReport() markdown renderers; workerCharter() system prompt for module agents.
- `packages/core/src/mission/route.ts` — routeMission(); ROUTE_SCHEMA; ROUTER_CHARTER; parsePlan() (silently drops hallucinated module slugs); renderPlan().
- `packages/core/src/mission/review.ts` — reviewModuleChange(); REVIEW_SCHEMA; REVIEWER_CHARTER (the ordered checklist reviewers follow: cross-module contracts first, then wiring, task fidelity, verification truthfulness, correctness, discipline); parseReview() defaults to 'approve' on unparseable/failed output.

## Public interface

- runMission(options: RunMissionOptions): Promise<MissionResult> — packages/core/src/mission/run.ts, re-exported from packages/core/src/index.ts
- missionId(goal, now?): string — packages/core/src/mission/run.ts
- WORK_REPORT_SCHEMA, WorkReport, MissionProgress, MissionModuleResult, MissionResult, RunMissionOptions — packages/core/src/mission/run.ts
- routeMission(options: RouteOptions): Promise<{plan?: MissionPlan; outcome: AgentOutcome}> — packages/core/src/mission/route.ts
- renderPlan(goal, plan): string, ROUTE_SCHEMA — packages/core/src/mission/route.ts
- reviewModuleChange(options: ReviewOptions): Promise<ModuleReview> — packages/core/src/mission/review.ts
- REVIEW_SCHEMA, ModuleReview, ReviewFinding — packages/core/src/mission/review.ts
- Consumed by packages/core/src/loop/run.ts (the autonomous swarm-loop) and by the CLI's `swarm mission` command via the @swarm-os/core index barrel

---

_Surveyed 2026-08-15 by the `mission` analyst, reading only this module's paths._
