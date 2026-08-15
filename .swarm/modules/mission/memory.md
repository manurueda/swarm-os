# Mission Orchestration — memory

_Durable knowledge for the `mission` swarm. Read on wake, rewritten on sleep._

## Invariants

- missionId() must incorporate more than the first six words of the goal (a sha256 fingerprint of the full goal string) because autonomous loops generate goals differing only in their tail; without the fingerprint, two missions share a directory and overwrite each other's plan.md/report.md/event log. <sub>`packages/core/src/mission/run.ts`</sub>
- runMission() calls workspace.resetMissionLog(id) before doing anything else, because the mission id is deterministic per goal+date and a rerun must not append to a stale prior log. <sub>`packages/core/src/mission/run.ts`</sub>
- Review happens before commit, and a review failure (thrown exception) is swallowed so the work is still committed — a failed review must never lose the agent's work. <sub>`packages/core/src/mission/run.ts`</sub>
- Worktrees are only removed after the module's changes are committed; if changedFiles is non-empty but committed is false, the worktree is deliberately kept (uncommitted work is never deleted). <sub>`packages/core/src/mission/run.ts`</sub>
- A module result is only 'ok' if the agent outcome succeeded AND workReport.status !== 'blocked' AND review.verdict !== 'reject'; 'changes-needed' review verdicts still count as ok. <sub>`packages/core/src/mission/run.ts`</sub>
- The router (routeMission) is given tools: [] deliberately — it must not explore the repo itself, only route based on the system summary and one-line-per-module descriptions. <sub>`packages/core/src/mission/route.ts`</sub>
- A hallucinated module slug returned by the router is silently dropped in parsePlan (only slugs present in the passed-in `modules` list are accepted); if zero valid assignments remain the whole plan is undefined and runMission throws. <sub>`packages/core/src/mission/route.ts`</sub>
- The reviewer agent is restricted to tools ['Read','Grep','Glob'] — it must never be able to edit files; its output is advisory only and never blocks the commit itself (verdict is recorded but run.ts commits regardless of verdict, only 'reject' flips ok=false). <sub>`packages/core/src/mission/review.ts`</sub>
- Diffs longer than MAX_DIFF_CHARS (60,000 chars) are truncated before being sent to the reviewer, which is told to read files directly in the worktree (cwd) for the rest. <sub>`packages/core/src/mission/review.ts`</sub>
- run.ts must thread `handle.linked` (from createWorktree's WorktreeHandle, populated at worktree creation) as the third argument to both `changedFiles(worktreePath, base, linked)` and `commitAll(worktreePath, message, linked)`; omitting it compiles fine (both default the param to `[]`) but silently lets linked-dependency symlinks (e.g. a `node_modules` symlink not matched by the `node_modules/` ignore rule) get committed into mission branches and flagged as ownership violations. `WorktreeHandle.linked` is typed optional (`linked?: string[]`), so callers must default it (`handle.linked ?? []`). <sub>`packages/core/src/mission/run.ts`, `packages/core/src/git/worktree.ts`</sub>

## Gotchas

- After a mission finishes, record.status is set to 'review' (if every module ok) or 'failed' — never 'done', even though MissionStatus (in ../types.ts) includes a 'done' value. Something outside this module must be responsible for transitioning 'review' -> 'done' (or that transition doesn't exist yet); a future agent should not assume runMission ever marks a mission 'done'. <sub>`packages/core/src/mission/run.ts`</sub>
- dryRun mode returns early right after writing plan.md and the mission record (status 'planned') — no worktrees, no agents, no scheduler, no review; MissionResult.modules is empty and note is set. <sub>`packages/core/src/mission/run.ts`</sub>
- When the workspace is not a git repo (isGitRepo() false), every module agent runs directly in workspace.repoRoot with no worktree/branch/commit/diff/review — worktreePath equals repoRoot and changed/ownership/review are effectively skipped or empty. Mission mechanics degrade silently rather than erroring. <sub>`packages/core/src/mission/run.ts`</sub>
- options.modules (the --modules override) bypasses routeMission entirely and fabricates a MissionPlan client-side with task == the raw goal string for every named module (no per-module task tailoring, no rationale). <sub>`packages/core/src/mission/run.ts`</sub>
- skipCompress bypasses sleepSwarm() and just marks the swarm 'sleeping' directly — memory is NOT compressed, meaning learned invariants/gotchas from WorkReport are discarded (not written anywhere) even though they were parsed successfully. <sub>`packages/core/src/mission/run.ts`</sub>
- followUps from a module's WorkReport are appended to that module's decision log (workspace.appendDecision) regardless of skipCompress — this happens even when memory compression is skipped, so follow-ups survive even when other learnings don't. <sub>`packages/core/src/mission/run.ts`</sub>
- reviewModuleChange only runs at all when changed.length > 0 and !options.skipReview and repoIsGit — an agent that reports success but made zero file changes gets no review. <sub>`packages/core/src/mission/run.ts`</sub>
- The digest used for each module's context pack (buildDigest) is computed once for the whole repo and shared across all module tasks via digest.files.filter(isOwned) — it is not per-worktree, so it reflects the pre-mission state of the main checkout, not any worktree's edits. <sub>`packages/core/src/mission/run.ts`</sub>
- sessionId passed to the work agent is a fresh randomUUID() every call — collectAgent/runtime session continuity (if any) is not reused across missions for the same module from this call site. <sub>`packages/core/src/mission/run.ts`</sub>
- No test file exercises run.ts's worktree-to-commit wiring (e.g. that `handle.linked` actually reaches `changedFiles`/`commitAll`) — mission/run.ts has no dedicated test at all; verify such wiring by reading the diff/call sites directly, not by assuming CI covers it.
- If you're working in a checked-out worktree whose own `node_modules` is a symlink to the main repo's `node_modules` (outside the sandboxed worktree dir), any command resolving through it — `npm`, `npx`, even `command -v npm` — gets blocked by the sandbox awaiting approval that never arrives unattended. `git`, `node`, and direct file reads inside the worktree still work; fall back to reading source directly to verify correctness when `npm test` is unreachable.

## Landmarks

- `packages/core/src/mission/run.ts` — Mission lifecycle orchestrator; missionId() hashing; WORK_REPORT_SCHEMA / WorkReport shape workers must return; workerCharter() system prompt given to every module agent; renderMissionReport()/renderModuleReport() write .swarm/missions/<id>/report.md and the per-module memory-compression input. createWorktree's `handle.linked` now flows into both the `changedFiles` and `commitAll` calls to exclude linked-dependency symlinks.
- `packages/core/src/mission/route.ts` — ROUTE_SCHEMA + ROUTER_CHARTER; routeMission() calls a lean/ephemeral agent with tools:[] (no repo exploration) to produce a MissionPlan; renderPlan() writes plan.md.
- `packages/core/src/mission/review.ts` — REVIEW_SCHEMA + REVIEWER_CHARTER; reviewModuleChange() runs a read-only (Read/Grep/Glob only) agent against a truncated diff (MAX_DIFF_CHARS=60000) plus dependency contracts and ownership-violation list.
- `packages/core/src/mission/mission-id.test.ts` — Only test in the module; regression test for the missionId() collision bug (goals differing only after word 6 used to share a directory and clobber each other's plan/report/log).

## Public interface

- runMission(options: RunMissionOptions): Promise<MissionResult>
- missionId(goal: string, now?: Date): string
- routeMission(options: RouteOptions): Promise<{ plan?: MissionPlan; outcome: AgentOutcome }>
- renderPlan(goal: string, plan: MissionPlan): string
- reviewModuleChange(options: ReviewOptions): Promise<ModuleReview>
- WorkReport / WORK_REPORT_SCHEMA (schema module agents must return structured output against)
- ModuleReview / ReviewFinding (reviewer's structured verdict shape)
- MissionProgress, MissionModuleResult, MissionResult, RunMissionOptions (types for CLI/UI progress reporting)

---

_Surveyed 2026-08-15 by the `mission` analyst, reading only this module's paths._
