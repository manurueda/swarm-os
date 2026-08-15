# Swarm Orchestration — memory

_Durable knowledge for the `swarm-orchestration` swarm. Read on wake, rewritten on sleep._

## Invariants

- Ownership is enforced two ways: an agent is told its globs in its charter, and its diff is checked afterwards against those globs (checkOwnership) — the diff check is what actually makes the boundary real, since Claude Code has no native glob-confinement flag. <sub>`packages/core/src/swarm/ownership.ts`</sub>
- `.swarm/` paths are always considered owned regardless of a module's globs, because that is where agents record memory. <sub>`packages/core/src/swarm/ownership.ts`</sub>
- extractClaims only pulls list items from '## Invariants' and '## Gotchas' sections of memory.md; '_..._' placeholder lines (e.g. '_None recorded yet._') are skipped. Landmarks and Public interface are never treated as claims. <sub>`packages/core/src/swarm/verify.ts`</sub>
- checkCitation treats a claim as 'resolved' only if the cited path exists on disk under repoRoot AND is owned by (or is a prefix of) the module's globs; empty path is 'no-citation'. <sub>`packages/core/src/swarm/verify.ts`</sub>
- The stage-2 verifier agent is given only a bare numbered list of claim texts (no section headings, no provenance, no purpose statement) — deliberately, so it cannot infer which claims the analyst was confident about. <sub>`packages/core/src/swarm/verify.ts`</sub>
- Scheduler.run preserves task input order in its result array even though tasks complete out of order; a thrown task resolves to an Error in place rather than rejecting/aborting the whole batch. <sub>`packages/core/src/swarm/scheduler.ts`</sub>
- Once the scheduler observes a paused rate-limit status, no further tasks are launched (already-running tasks finish); unlaunched tasks resolve to an Error containing 'rate limit'. Scheduler.limit is clamped to a minimum of 1 even if constructed with 0. <sub>`packages/core/src/swarm/scheduler.ts`</sub>
- detectAreas only proposes areas when there are at least minAreas (default 3) qualifying groups of at least minFiles (default 8) each at the single best-discriminating directory depth (tried 1..4); otherwise it returns []. Splitting into 1-2 areas is treated as not worth it. <sub>`packages/core/src/swarm/areas.ts`</sub>
- sleepSwarm skips the (costly) compressor agent call entirely when there is no missionReport and current memory is already within budgetTokens — sleeping then costs no model call. <sub>`packages/core/src/swarm/manager.ts`</sub>
- runLoop refuses to start if the working tree is dirty (ignoring .swarm/), creates exactly one integration branch (`swarm/auto/<timestamp>`) for the whole run, and every mission branches from and merges back into that single branch — main/base is never touched until the final checkout back to it. <sub>`packages/core/src/loop/run.ts`</sub>

## Gotchas

- renderClaim/parseClaimLine are a load-bearing serialization round-trip: claims are rendered into memory.md as `- text <sub>\`path\`</sub>` (with an appended ` [doc]` marker when source is 'doc'), and parseClaimLine must reconstruct exactly this shape for extractClaims/checkCitation to work — a rendering change not mirrored in the parser silently disarms the deterministic half of `swarm verify`. <sub>`packages/core/src/swarm/analyst.ts`</sub>
- parseClaimLine treats an uncited claim line as source 'doc', not 'code' — the default assumption for anything without a resolvable path is 'unverified documentation', not 'read code'. <sub>`packages/core/src/swarm/analyst.ts`</sub>
- areaAsModule fabricates a ModuleSpec with slug `${moduleSlug}/${areaSlug}` (a slash inside the slug) purely so the existing analyst/verify machinery, which is generic over ModuleSpec, can be reused on an area without a parallel implementation. <sub>`packages/core/src/swarm/areas.ts`</sub>
- buildContextPack's fileIndex is dropped entirely (not truncated) when the module's file count exceeds maxIndexFiles (default 160) — a half-shown file list is considered worse than none because an agent can't distinguish 'not in this module' from 'cut off'. <sub>`packages/core/src/swarm/manager.ts`</sub>
- dependencyContracts only pulls the '## Public interface' section out of a dependency's memory.md (via sectionOf) and caps at the first 5 entries of spec.dependsOn — a dependency's full memory/source is never visible to a module that depends on it. <sub>`packages/core/src/swarm/manager.ts`</sub>
- runLoop's runVerify sets PYTHONPATH to point at the worktree's own `src/` (only when both `src/` and `pyproject.toml` exist there) because a worktree's Python tooling otherwise resolves an editable install back to the original clone, silently verifying the wrong source — this was observed causing a correct change to be rejected with 246 spurious errors. <sub>`packages/core/src/loop/run.ts`</sub>
- runVerify spawns the verify command with a 15-minute hard timeout and swallows all stdio (`stdio: 'ignore'`); a hung build fails silently rather than blocking the loop, and there is no way to see its output from runLoop's return value. <sub>`packages/core/src/loop/run.ts`</sub>
- findOwnershipConflicts deliberately does NOT compare glob strings textually (e.g. common-prefix comparisons) because that produces false positives; it evaluates every real file against every module's isOwned() and only reports modules that both actually match a concrete file. <sub>`packages/core/src/swarm/ownership.ts`</sub>
- In runLoop, only signal kinds god-file, untested-module, junk-drawer, flat-directory, deep-nesting produce a task via goalFor(); import-cycle, unowned-files, ownership-conflict, scattered-module, memory-pressure, size-imbalance always return undefined and are silently dropped even though they are real problems — this is a deliberate scope limit, not an oversight. <sub>`packages/core/src/loop/run.ts`</sub>

## Landmarks

- `packages/core/src/swarm/manager.ts` — wakeSwarm/sleepSwarm state transitions, buildContextPack (agent context assembly), and the memory-compressor agent charter (COMPRESSOR_CHARTER).
- `packages/core/src/swarm/analyst.ts` — ANALYST_CHARTER, MODULE_ANALYSIS_SCHEMA, analyzeModule, renderMemory/renderCharter, and the claim render/parse pair (renderClaim/parseClaimLine) — this exact prompt is what generated this very report.
- `packages/core/src/swarm/verify.ts` — VERIFIER_CHARTER, VERIFY_SCHEMA, verifyModule (2-stage check), renderVerification (the .swarm/modules/<slug>/verification.md report).
- `packages/core/src/swarm/ownership.ts` — globToRegExp, matchesGlob, isOwned, checkOwnership, findOwnershipConflicts.
- `packages/core/src/swarm/areas.ts` — detectAreas (directory-depth-based area detection), areaAsModule (area→ModuleSpec adapter so the same analyst can survey an area), renderAreaIndex.
- `packages/core/src/swarm/scheduler.ts` — Scheduler class: bounded concurrency + rate-limit pause via observe(SwarmEvent).
- `packages/core/src/loop/run.ts` — tasksFromSignals (which structural signals become autonomous tasks), runLoop (the full unattended cycle), runVerify (spawns the project's verify command inside a worktree, with PYTHONPATH shimming).

## Public interface

- buildContextPack, dependencyContracts, wakeSwarm, sleepSwarm, sleepAll, ContextPack/ContextPackOptions/SleepResult types (swarm/manager.ts)
- analyzeModule, renderMemory, renderCharter, renderClaim, parseClaimLine, MODULE_ANALYSIS_SCHEMA, Claim/ModuleAnalysis types (swarm/analyst.ts)
- verifyModule, extractClaims, checkCitation, renderVerification, VERIFY_SCHEMA, ClaimVerification/ModuleVerification/Verdict types (swarm/verify.ts)
- globToRegExp, matchesGlob, isOwned, checkOwnership, findOwnershipConflicts, OwnershipReport/OwnershipConflict types (swarm/ownership.ts)
- detectAreas, areaAsModule, renderAreaIndex, AreaSpec/DetectAreasOptions types (swarm/areas.ts)
- Scheduler class with .run(), .observe(), .isPaused, .rateLimit (swarm/scheduler.ts)
- runLoop, tasksFromSignals, LoopTask/LoopStop/LoopAttempt/LoopResult/LoopProgress/RunLoopOptions types (loop/run.ts)

---

_Surveyed 2026-08-15 by the `swarm-orchestration` analyst, reading only this module's paths._
