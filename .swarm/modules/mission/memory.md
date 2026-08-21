# Mission Orchestration — memory

_Durable knowledge for the `mission` swarm. Read on wake, rewritten on sleep._

## Invariants

- missionId(goal) is deterministic per exact goal string (date + first 6 words slugged + sha256(goal).slice(0,6)); two goals sharing first six words but differing later still get different ids via the hash fingerprint. <sub>`packages/core/src/mission/run.ts`</sub>
- runMission() calls workspace.resetMissionLog(id) before routing/work; same goal => same id => same mission directory; a second run of the identical goal wipes the previous run's event log/plan/report. <sub>`packages/core/src/mission/run.ts`</sub>
- A worktree is only removed via removeWorktree() after the module's commit succeeded (or zero changed files); if changedFiles.length > 0 and committed is false, the worktree is deliberately kept and reported, never silently deleted. <sub>`packages/core/src/mission/run.ts`</sub>
- reviewModuleChange() failures are caught and swallowed in runMission — a broken reviewer never loses or blocks the author's committed work. <sub>`packages/core/src/mission/run.ts`</sub>
- The router agent is spawned with tools: [] — decides routing purely from summary + one-line descriptions, never explores the filesystem. <sub>`packages/core/src/mission/route.ts`</sub>
- The reviewer agent is spawned with tools restricted to ['Read','Grep','Glob'] — structurally read-only, cannot edit the diff it judges. <sub>`packages/core/src/mission/review.ts`</sub>
- parsePlan() (route.ts) drops any assignment whose module slug is unknown or task/module fields are missing — hallucinated slugs are silently discarded, no worker spawned. <sub>`packages/core/src/mission/route.ts`</sub>
- A module result's ok flag requires outcome.ok AND workReport.status !== 'blocked' AND review.verdict !== 'reject'; a 'changes-needed' review verdict does NOT flip ok to false. As of this mission, moduleResult.ok also does NOT consult verifyOutcome — a module that failed verification through all maxVerifyRounds can still ship ok:true and get committed. This is a known gap, not yet flagged as intentional-vs-bug by the task author. <sub>`packages/core/src/mission/run.ts`</sub>
- Diffs longer than MAX_DIFF_CHARS (60,000) are truncated before being shown to the reviewer, with a note to read the files directly for the rest. <sub>`packages/core/src/mission/review.ts`</sub>
- record.status after all modules run is 'review' (all delivered), 'partial' (some delivered), or 'failed' (none) — never a literal 'complete'. <sub>`packages/core/src/mission/run.ts`</sub>
- runVerify(module, worktreePath, verifyCommand) -> Promise<{outcome:'passed'|'failed'|'skipped-no-command', output}> is a cross-module contract shared verbatim with swarm-orchestration's loop/run.ts migration. It has no extraEnv param — config.verifyEnv PYTHONPATH-style overrides are NOT carried over, only the automatic Python/src heuristic. <sub>`packages/core/src/mission/verify.ts`</sub>
- runVerifyLoop always calls verify() at least once even with an empty verifyCommand — it delegates the "configured at all" check to the injected verify fn (which returns skipped-no-command), not to a gate before calling it. With maxVerifyRounds=N it calls verify() up to N times but resumes the agent at most N-1 times (the final failed round gets no further turn). <sub>`packages/core/src/mission/verify-loop.ts`</sub>
- MissionModuleResult.verifyOutcome and .refusalCount are non-optional, populated on every return path including both early-error paths and the scheduler-error fallback, matching the existing convention for ok/changedFiles/ownershipViolations. <sub>`packages/core/src/mission/run.ts`</sub>

## Gotchas

- MissionResult.costUsd only sums each result's r.costUsd (work agent cost). Router cost, per-module reviewer cost, sleep/compression cost, and (as of this mission) resume-verify cost are NOT reliably included — see the double-counting bug below. <sub>`packages/core/src/mission/run.ts`</sub>
- record.status of 'review' after full success means 'ready for review', not 'in progress'. <sub>`packages/core/src/mission/run.ts`</sub>
- If the target repo is not a git repo, worktreePath falls back to workspace.repoRoot — worker edits the real checkout with no isolation, branch, commit, diff review, or ownership check (changed=[] always). <sub>`packages/core/src/mission/run.ts`</sub>
- dryRun stops after routing + writing plan.md/mission record (status 'planned') — no worktree, no verify, no agents spawned. <sub>`packages/core/src/mission/run.ts`</sub>
- sleepSwarm() failure during harvest is caught and swarm force-marked 'sleeping' with no compression — never blocks completion, but memory silently doesn't improve. <sub>`packages/core/src/mission/run.ts`</sub>
- workerCharter() embeds a large fixed rule-set as a template literal in run.ts, identical for every module/mission, not configurable.
- options.modules (--modules override) bypasses routeMission() entirely; task === goal verbatim for every listed module, no rationale, no trimming.
- **Known unfixed bug (changes-needed review, not yet corrected):** in run.ts ~469-474, after a resume `outcome` is reassigned to `verifyLoop.lastOutcome` (already just the resumed turn's cost), then `costUsd = (outcome.costUsd ?? 0) + verifyLoop.resumeCostUsd` double-counts that same resume cost and drops the initial work-agent turn's cost entirely. Corrupts moduleResult.costUsd. Fix before trusting cost figures on any mission that hit a resume.
- readRefusalCount in verify-loop.ts casts `outcome as AgentOutcome & {refusalCount?: number}` — AgentOutcome has no such field yet AND runtime/collect.ts's event switch never forwards one, so in production this always evaluates to 0 today. Two runtime-owned files (claude-code-local.ts and collect.ts) both need work before refusalCount does anything real.
- maxVerifyRounds is read via `(config as SwarmConfig & {maxVerifyRounds?: number}).maxVerifyRounds ?? 2` because workspace-git's config.ts doesn't define the field yet — a configured value in swarm.yaml cannot override the default of 2 until that lands. Delete the cast once SwarmConfig grows the field.
- loop/run.ts (swarm-orchestration's file) still has its own un-migrated inline `runVerify(worktree, command, extraEnv)` — mission/verify.ts is the intended shared replacement, but switching loop/run.ts's import and deleting the local copy is swarm-orchestration's task, not this module's.
- AgentLedgerEntry / persisted mission.json record.agents ledger does NOT carry verifyOutcome or refusalCount — only MissionModuleResult and report.md do. Leave the ledger alone unless a task explicitly asks for it there.
- This sandbox refuses essentially all process execution (node -e, npx, npm run/build, direct tsc binary) with an unattended "requires approval" — expect to be unable to run tests/build here; verify by careful manual type-trace against actual source shapes instead, and say so explicitly rather than claiming tests pass.

## Landmarks

- `packages/core/src/mission/run.ts` — runMission() orchestrator; missionId(); WORK_REPORT_SCHEMA/WorkReport; workerCharter() (work prompt now explicitly forbids running tests/builds/package managers/git — states the harness verifies after the agent reports); renderModuleReport()/renderMissionReport() (now include Verify/refusal lines); runs runVerifyLoop() between work-agent completion and review.
- `packages/core/src/mission/route.ts` — routeMission(), ROUTE_SCHEMA, ROUTER_CHARTER, renderPlan(), parsePlan().
- `packages/core/src/mission/review.ts` — reviewModuleChange(), REVIEW_SCHEMA, REVIEWER_CHARTER (6-point check order), MAX_DIFF_CHARS=60000.
- `packages/core/src/mission/verify.ts` — shared runVerify() helper, extracted/reused from loop/run.ts's original (loop/run.ts itself not yet migrated to it).
- `packages/core/src/mission/verify-loop.ts` — runVerifyLoop(): dependency-injected fail-then-fix policy; resumes the work agent via runtime.run + spec.resume (through collectAgent) on verify failure, trims verify output into the fix prompt; readRefusalCount() bridge helper.
- `packages/core/src/mission/verify.test.ts`, `verify-loop.test.ts` — cover pass/fail-then-fix/fail-through-all-rounds/no-command + refusal counting, using a fake AgentRuntime and injected fake verify fn (no subprocess spawned).
- `packages/core/src/mission/mission-id.test.ts` — specifies exact mission id shape: `<date>-<first-6-slug-words>-<sha256-of-full-goal,6hex>`.

## Public interface

- runMission(options: RunMissionOptions): Promise<MissionResult>
- missionId(goal: string, now?: Date): string
- RunMissionOptions / MissionResult / MissionModuleResult (now includes verifyOutcome, refusalCount) / MissionProgress types
- WorkReport / WORK_REPORT_SCHEMA
- routeMission(options: RouteOptions): Promise<{ plan?: MissionPlan; outcome: AgentOutcome }>
- renderPlan(goal, plan): string
- ROUTE_SCHEMA
- reviewModuleChange(options: ReviewOptions): Promise<ModuleReview>
- ModuleReview / ReviewFinding types
- REVIEW_SCHEMA
- runVerify(module: string, worktreePath: string, verifyCommand: string): Promise<{outcome: 'passed'|'failed'|'skipped-no-command'; output: string}>
- runVerifyLoop(...): loops runVerify + resume, up to maxVerifyRounds
