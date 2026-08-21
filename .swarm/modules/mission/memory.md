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
- moduleResult.ok requires ALL of: outcome.ok, workReport.status !== 'blocked', review.verdict !== 'reject', AND verifyLoop.verifyOutcome !== 'failed'. A module that exhausts all maxVerifyRounds still failing verification now reports ok:false — this gap is fixed as of this mission. A 'changes-needed' review verdict still does NOT flip ok to false. <sub>`packages/core/src/mission/run.ts`</sub>
- Module cost aggregation: `initialCostUsd` is captured from the work agent's outcome.costUsd *before* `outcome` is reassigned to `verifyLoop.lastOutcome`; final `costUsd = initialCostUsd + verifyLoop.resumeCostUsd`, where resumeCostUsd already sums every resume round. Never read outcome.costUsd after the reassignment for this sum — it double-counts the last round and drops the first turn. <sub>`packages/core/src/mission/run.ts`</sub>
- Diffs longer than MAX_DIFF_CHARS (60,000) are truncated before being shown to the reviewer, with a note to read the files directly for the rest. <sub>`packages/core/src/mission/review.ts`</sub>
- record.status after all modules run is 'review' (all delivered), 'partial' (some delivered), or 'failed' (none) — never a literal 'complete'. <sub>`packages/core/src/mission/run.ts`</sub>
- runVerify(module, worktreePath, verifyCommand) -> Promise<{outcome:'passed'|'failed'|'skipped-no-command', output}> is a cross-module contract shared verbatim with swarm-orchestration's loop/run.ts. It still has NO env/extraEnv param — the module/worktree/verifyCommand signature is unchanged; PYTHONPATH shadowing is hardcoded inside it, config.verifyEnv cannot be passed through without a signature change here first. <sub>`packages/core/src/mission/verify.ts`</sub>
- runVerifyLoop always calls verify() at least once even with an empty verifyCommand — the injected verify fn (not a gate before calling it) decides "configured at all" and returns skipped-no-command. With maxVerifyRounds=N it calls verify() up to N times but resumes the agent at most N-1 times. <sub>`packages/core/src/mission/verify-loop.ts`</sub>
- MissionModuleResult.verifyOutcome and .refusalCount are non-optional, populated on every return path including both early-error paths and the scheduler-error fallback. AgentOutcome.refusalCount (runtime/collect.ts) and SwarmConfig.maxVerifyRounds (workspace/config.ts) are themselves now required, non-optional fields upstream — no bridging casts remain in this module for either. <sub>`packages/core/src/mission/run.ts`, `packages/core/src/mission/verify-loop.ts`</sub>

## Gotchas

- MissionResult.costUsd only sums each result's r.costUsd (work agent cost, now correctly aggregated across resume rounds). Router cost, per-module reviewer cost, and sleep/compression cost are still NOT included. <sub>`packages/core/src/mission/run.ts`</sub>
- record.status of 'review' after full success means 'ready for review', not 'in progress'. <sub>`packages/core/src/mission/run.ts`</sub>
- If the target repo is not a git repo, worktreePath falls back to workspace.repoRoot — worker edits the real checkout with no isolation, branch, commit, diff review, or ownership check (changed=[] always). <sub>`packages/core/src/mission/run.ts`</sub>
- dryRun stops after routing + writing plan.md/mission record (status 'planned') — no worktree, no verify, no agents spawned. <sub>`packages/core/src/mission/run.ts`</sub>
- sleepSwarm() failure during harvest is caught and swarm force-marked 'sleeping' with no compression — never blocks completion, but memory silently doesn't improve. <sub>`packages/core/src/mission/run.ts`</sub>
- workerCharter() embeds a large fixed rule-set as a template literal in run.ts, identical for every module/mission, not configurable; explicitly forbids the work agent from running tests/builds/package managers/git — harness verifies after the report.
- options.modules (--modules override) bypasses routeMission() entirely; task === goal verbatim for every listed module, no rationale, no trimming.
- loop/run.ts (swarm-orchestration's file) still has its own un-migrated inline runVerify(worktree, command, extraEnv). Any task asking to route config.verifyEnv through the shared mission/verify.ts helper rests on a false premise until runVerify here gains an env param — flag this if assigned such a task again.
- AgentLedgerEntry / persisted mission.json record.agents ledger does NOT carry verifyOutcome or refusalCount — only MissionModuleResult and report.md do.
- No test file exercises run.ts directly in this module (only mission-id.test.ts, verify.test.ts, verify-loop.test.ts exist) — cost/ok-gate logic in run.ts can only be checked by manual trace, not automated tests.
- This sandbox refuses essentially all process execution (node -e, npx, npm run/build, direct tsc) with an unattended "requires approval" — expect to be unable to run tests/build here; verify by careful manual type-trace against actual source shapes and say so explicitly rather than claiming tests pass.

## Landmarks

- `packages/core/src/mission/run.ts` — runMission() orchestrator; missionId(); WORK_REPORT_SCHEMA/WorkReport; workerCharter(); renderModuleReport()/renderMissionReport() (include Verify/refusal lines); runs runVerifyLoop() between work-agent completion and review; owns the ok-gate and cost-aggregation logic above.
- `packages/core/src/mission/route.ts` — routeMission(), ROUTE_SCHEMA, ROUTER_CHARTER, renderPlan(), parsePlan().
- `packages/core/src/mission/review.ts` — reviewModuleChange(), REVIEW_SCHEMA, REVIEWER_CHARTER (6-point check order), MAX_DIFF_CHARS=60000.
- `packages/core/src/mission/verify.ts` — shared runVerify() helper, (module, worktree, verifyCommand) signature only, no env param.
- `packages/core/src/mission/verify-loop.ts` — runVerifyLoop(): dependency-injected fail-then-fix policy; resumes work agent via runtime.run + spec.resume (through collectAgent) on verify failure; readRefusalCount() reads outcome.refusalCount directly (no cast).
- `packages/core/src/mission/verify.test.ts`, `verify-loop.test.ts` — cover pass/fail-then-fix/fail-through-all-rounds/no-command + refusal counting, using a fake AgentRuntime and injected fake verify fn (no subprocess spawned).
- `packages/core/src/mission/mission-id.test.ts` — specifies exact mission id shape: `<date>-<first-6-slug-words>-<sha256-of-full-goal,6hex>`.

## Public interface

- runMission(options: RunMissionOptions): Promise<MissionResult>
- missionId(goal: string, now?: Date): string
- RunMissionOptions / MissionResult / MissionModuleResult (verifyOutcome, refusalCount required) / MissionProgress types
- WorkReport / WORK_REPORT_SCHEMA
- routeMission(options: RouteOptions): Promise<{ plan?: MissionPlan; outcome: AgentOutcome }>
- renderPlan(goal, plan): string
- ROUTE_SCHEMA
- reviewModuleChange(options: ReviewOptions): Promise<ModuleReview>
- ModuleReview / ReviewFinding types
- REVIEW_SCHEMA
- runVerify(module: string, worktreePath: string, verifyCommand: string): Promise<{outcome: 'passed'|'failed'|'skipped-no-command'; output: string}>
- runVerifyLoop(...): loops runVerify + resume, up to maxVerifyRounds (config.maxVerifyRounds, required field, default 2)
