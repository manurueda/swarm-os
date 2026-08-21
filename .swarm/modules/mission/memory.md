# Mission Orchestration — memory

_Durable knowledge for the `mission` swarm. Read on wake, rewritten on sleep._

## Invariants

- missionId(goal) is deterministic per exact goal string (date + first 6 words slugged + sha256(goal).slice(0,6)); two goals sharing their first six words but differing later still get different ids via the hash fingerprint. <sub>`packages/core/src/mission/run.ts`</sub>
- runMission() calls workspace.resetMissionLog(id) before doing any routing/work, because same goal => same id => same mission directory; a second run of the identical goal wipes the previous run's event log/plan/report. <sub>`packages/core/src/mission/run.ts`</sub>
- A worktree is only removed via removeWorktree() after the module's commit succeeded (or there were zero changed files); if changedFiles.length > 0 and committed is false, the worktree is deliberately kept and reported, never silently deleted. <sub>`packages/core/src/mission/run.ts`</sub>
- reviewModuleChange() failures are caught and swallowed (empty catch) in runMission — a broken reviewer never loses or blocks the author's committed work. <sub>`packages/core/src/mission/run.ts`</sub>
- The router agent is spawned with tools: [] — it must decide routing purely from the system summary + one-line module descriptions, never explore the filesystem itself. <sub>`packages/core/src/mission/route.ts`</sub>
- The reviewer agent is spawned with tools restricted to ['Read','Grep','Glob'] only — it is structurally read-only and cannot edit the diff it is judging. <sub>`packages/core/src/mission/review.ts`</sub>
- parsePlan() (route.ts) drops any assignment whose module slug is not in the known module set, or whose task/module fields are missing — a hallucinated slug is silently discarded rather than spawning a worker for a nonexistent module. <sub>`packages/core/src/mission/route.ts`</sub>
- A module result's ok flag requires outcome.ok AND workReport.status !== 'blocked' AND review.verdict !== 'reject'; a 'changes-needed' review verdict does NOT flip ok to false. <sub>`packages/core/src/mission/run.ts`</sub>
- Diffs longer than MAX_DIFF_CHARS (60,000) are truncated before being shown to the reviewer, with an explicit note telling it to read the files directly for the rest. <sub>`packages/core/src/mission/review.ts`</sub>
- record.status after all modules run is 'review' when every module delivered (delivered === results.length), 'partial' when some but not all delivered, 'failed' when none did — it is never set to a literal 'complete' state. <sub>`packages/core/src/mission/run.ts`</sub>

## Gotchas

- MissionResult.costUsd only sums each result's r.costUsd (the work agent's cost). Router cost, per-module reviewer cost (result.review.costUsd), and sleep/compression cost are NOT included in the returned top-level costUsd, even though they appear in the event log and review objects individually. <sub>`packages/core/src/mission/run.ts`</sub>
- record.status of 'review' after a fully successful mission is easy to misread as an in-progress/pending state; it actually means 'all modules delivered, ready for human/next-stage review', not that anything is still running. <sub>`packages/core/src/mission/run.ts`</sub>
- If the target repo is not a git repo (isGitRepo() false), worktreePath falls back to workspace.repoRoot itself — the worker agent edits the real checkout directly with no isolation, no branch, no commit, no diff-based review or ownership check (changed=[] always). <sub>`packages/core/src/mission/run.ts`</sub>
- dryRun stops immediately after routing and writing plan.md/mission record (status 'planned') — no worktree, no digest build, no agents at all are spawned even though the plan was computed. <sub>`packages/core/src/mission/run.ts`</sub>
- sleepSwarm() failure during harvest is caught and the swarm is force-marked 'sleeping' with no memory compression having happened — a broken compressor never blocks mission completion, but memory quietly does not improve for that module. <sub>`packages/core/src/mission/run.ts`</sub>
- workerCharter() embeds a long, fixed set of engineering-style rules (tests-first, one-reason-to-change, no speculative config, never refactor+behave-change together, etc.) directly as a template literal in run.ts — it is not configurable per module or per mission, and is identical for every worker agent regardless of language/stack. <sub>`packages/core/src/mission/run.ts`</sub>
- options.modules (the --modules override) completely bypasses routeMission(); the resulting plan has task === goal verbatim for every listed module, with no per-module rationale and no attempt to trim to the fewest modules. <sub>`packages/core/src/mission/run.ts`</sub>

## Landmarks

- `packages/core/src/mission/run.ts` — runMission() orchestrator; missionId(); WORK_REPORT_SCHEMA/WorkReport; workerCharter() (large fixed worker system prompt); renderModuleReport()/renderMissionReport() for mission markdown artifacts
- `packages/core/src/mission/route.ts` — routeMission(), ROUTE_SCHEMA, ROUTER_CHARTER, renderPlan(), parsePlan() (silently drops hallucinated module slugs)
- `packages/core/src/mission/review.ts` — reviewModuleChange(), REVIEW_SCHEMA, REVIEWER_CHARTER (6-point check order), MAX_DIFF_CHARS=60000 truncation
- `packages/core/src/mission/mission-id.test.ts` — Only test file in the module; specifies the exact shape of a mission id: `<date>-<first-6-slug-words>-<sha256-of-full-goal, 6 hex chars>`

## Public interface

- runMission(options: RunMissionOptions): Promise<MissionResult> — the module's sole orchestrator entry point
- missionId(goal: string, now?: Date): string
- RunMissionOptions / MissionResult / MissionModuleResult / MissionProgress types
- WorkReport / WORK_REPORT_SCHEMA
- routeMission(options: RouteOptions): Promise<{ plan?: MissionPlan; outcome: AgentOutcome }>
- renderPlan(goal, plan): string
- ROUTE_SCHEMA
- reviewModuleChange(options: ReviewOptions): Promise<ModuleReview>
- ModuleReview / ReviewFinding types
- REVIEW_SCHEMA

---

_Surveyed 2026-08-21 by the `mission` analyst, reading only this module's paths._
