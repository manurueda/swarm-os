# Swarm Orchestration — memory

_Durable knowledge for the `swarm-orchestration` swarm. Read on wake, rewritten on sleep._

## Invariants

- Ownership is enforced two ways: an agent is told its globs in its charter, and its diff is checked afterwards against those globs (checkOwnership) — the diff check is what actually makes the boundary real, since Claude Code has no native glob-confinement flag. <sub>`packages/core/src/swarm/ownership.ts`</sub>
- `.swarm/` paths are always considered owned regardless of a module's globs, because that is where agents record memory. <sub>`packages/core/src/swarm/ownership.ts`</sub>
- extractClaims only pulls list items from '## Invariants' and '## Gotchas' sections of memory.md; '_..._' placeholder lines are skipped. Landmarks and Public interface are never treated as claims. <sub>`packages/core/src/swarm/verify.ts`</sub>
- checkCitation treats a claim as 'resolved' only if the cited path exists on disk under repoRoot AND is owned by (or is a prefix of) the module's globs; empty path is 'no-citation'. <sub>`packages/core/src/swarm/verify.ts`</sub>
- The stage-2 verifier agent is given only a bare numbered list of claim texts — no headings, no provenance — so it cannot infer which claims the analyst was confident about. <sub>`packages/core/src/swarm/verify.ts`</sub>
- Scheduler.run preserves task input order in its result array even though tasks complete out of order; a thrown task resolves to an Error in place. <sub>`packages/core/src/swarm/scheduler.ts`</sub>
- Once the scheduler observes a paused rate-limit status, no further tasks launch (running ones finish); unlaunched tasks resolve to an Error containing 'rate limit'. Scheduler.limit is clamped to a minimum of 1. <sub>`packages/core/src/swarm/scheduler.ts`</sub>
- detectAreas only proposes areas when there are ≥minAreas (default 3) qualifying groups of ≥minFiles (default 8) each at the single best-discriminating directory depth (1..4); otherwise returns []. <sub>`packages/core/src/swarm/areas.ts`</sub>
- sleepSwarm skips the compressor agent call entirely when there is no missionReport and current memory is already within budgetTokens. <sub>`packages/core/src/swarm/manager.ts`</sub>
- sleepSwarm is decomposed into six dependency-injected units, each in its own file with its own tests: readMemoryState, shouldSkipCompression (pure predicate), buildCompressorPrompt (pure), runCompressorAgent, fileAreaSections, writeMemoryAndUpdateState. sleepSwarm itself is a thin orchestrator calling these in order. <sub>`packages/core/src/swarm/manager.ts`</sub>
- writeMemoryAndUpdateState(workspace, slug, moduleMemory, memoryTokens) is the single write path used by both sleepSwarm's early-return (moduleMemory=undefined) and post-compression finish (moduleMemory=rewritten text): always sets state:'sleeping' via workspace.updateSwarm, and calls workspace.writeModuleFile only when moduleMemory is defined. <sub>`packages/core/src/swarm/finalize-sleep.ts`</sub>
- The swarm barrel `index.ts` re-exports only buildContextPack, wakeSwarm, sleepSwarm, sleepAll, ContextPack, SleepResult from manager.ts — internal helpers (including the six sleepSwarm units) are deliberately not public API.
- runLoop refuses to start if the working tree is dirty (ignoring .swarm/), creates exactly one integration branch (`swarm/auto/<timestamp>`) for the whole run, and every mission branches from/merges into that branch — main/base is untouched until the final checkout. <sub>`packages/core/src/loop/run.ts`</sub>

## Gotchas

- renderClaim/parseClaimLine are a load-bearing serialization round-trip (`- text <sub>\`path\`</sub>`, ` [doc]` suffix when source is 'doc'); a rendering change not mirrored in the parser silently disarms the deterministic half of `swarm verify`. <sub>`packages/core/src/swarm/analyst.ts`</sub>
- parseClaimLine treats an uncited claim line as source 'doc', not 'code' — default assumption is 'unverified documentation'. <sub>`packages/core/src/swarm/analyst.ts`</sub>
- areaAsModule fabricates a ModuleSpec with slug `${moduleSlug}/${areaSlug}` (slash inside slug) so the analyst/verify machinery, generic over ModuleSpec, can be reused on an area without a parallel implementation. <sub>`packages/core/src/swarm/areas.ts`</sub>
- buildContextPack's fileIndex is dropped entirely (not truncated) when file count exceeds maxIndexFiles (default 160) — a half-shown list is worse than none. <sub>`packages/core/src/swarm/manager.ts`</sub>
- dependencyContracts only pulls '## Public interface' from a dependency's memory.md and caps at the first 5 entries of spec.dependsOn. <sub>`packages/core/src/swarm/manager.ts`</sub>
- runLoop's runVerify sets PYTHONPATH to the worktree's own `src/` (when both `src/` and `pyproject.toml` exist) because otherwise editable installs resolve back to the original clone, silently verifying the wrong source. <sub>`packages/core/src/loop/run.ts`</sub>
- runVerify spawns with a 15-minute hard timeout and `stdio: 'ignore'`; a hung build fails silently with no output visible from runLoop's return value. <sub>`packages/core/src/loop/run.ts`</sub>
- findOwnershipConflicts evaluates every real file against every module's isOwned() rather than comparing glob strings textually, to avoid false positives. <sub>`packages/core/src/swarm/ownership.ts`</sub>
- In runLoop only signal kinds god-file, untested-module, junk-drawer, flat-directory, deep-nesting produce a task via goalFor(); import-cycle, unowned-files, ownership-conflict, scattered-module, memory-pressure, size-imbalance are silently dropped — a deliberate scope limit. <sub>`packages/core/src/loop/run.ts`</sub>
- swarm/areas.ts's planAreas (area-plan.test.ts) was previously extracted from mapProject's closure for the same "untestable, uncalled" reason as sleepSwarm — read its header before repeating this extraction elsewhere (mapProject in `packages/core/src/mapper/pipeline.ts` itself is still one 500-line closure-capturing function, not yet extracted).
- Sandbox: only plain read-only commands execute (git status/diff/log, ls, cat, pwd, which, node --version); npm, npx, node with any other flag, sh, tsc, and even `git -C <path>` are rejected instantly with no prompt ever resolving. Don't retry variants — verify statically and say so.
- node_modules/.bin in a worktree checkout are symlinks pointing outside the worktree (to the main repo clone), which the sandbox also blocks — a second, independent reason direct tsc invocation fails in worktrees.

## Landmarks

- `packages/core/src/swarm/manager.ts` — wakeSwarm/sleepSwarm (now a thin orchestrator), buildContextPack, COMPRESSOR_CHARTER.
- `packages/core/src/swarm/memory-state.ts`, `compression-budget.ts`, `compressor-prompt.ts`, `compressor-agent.ts`, `file-area-sections.ts`, `finalize-sleep.ts` — the six sleepSwarm units extracted from manager.ts, each with a co-located `.test.ts`.
- `packages/core/src/swarm/analyst.ts` — ANALYST_CHARTER, MODULE_ANALYSIS_SCHEMA, analyzeModule, renderMemory/renderCharter, renderClaim/parseClaimLine.
- `packages/core/src/swarm/verify.ts` — VERIFIER_CHARTER, VERIFY_SCHEMA, verifyModule (2-stage), renderVerification.
- `packages/core/src/swarm/ownership.ts` — globToRegExp, matchesGlob, isOwned, checkOwnership, findOwnershipConflicts.
- `packages/core/src/swarm/areas.ts` — detectAreas, areaAsModule, renderAreaIndex, planAreas (extraction precedent for this kind of refactor).
- `packages/core/src/swarm/scheduler.ts` — Scheduler class: bounded concurrency + rate-limit pause via observe(SwarmEvent).
- `packages/core/src/loop/run.ts` — tasksFromSignals, runLoop, runVerify.

## Public interface

- buildContextPack, dependencyContracts, wakeSwarm, sleepSwarm, sleepAll, ContextPack/ContextPackOptions/SleepResult types (swarm/manager.ts); internal helpers (memory-state, compression-budget, compressor-prompt, compressor-agent, file-area-sections, finalize-sleep) are not re-exported.
- analyzeModule, renderMemory, renderCharter, renderClaim, parseClaimLine, MODULE_ANALYSIS_SCHEMA, Claim/ModuleAnalysis types (swarm/analyst.ts)
- verifyModule, extractClaims, checkCitation, renderVerification, VERIFY_SCHEMA, ClaimVerification/ModuleVerification/Verdict types (swarm/verify.ts)
- globToRegExp, matchesGlob, isOwned, checkOwnership, findOwnershipConflicts, OwnershipReport/OwnershipConflict types (swarm/ownership.ts)
- detectAreas, areaAsModule, renderAreaIndex, AreaSpec/DetectAreasOptions types (swarm/areas.ts)
- Scheduler class with .run(), .observe(), .isPaused, .rateLimit (swarm/scheduler.ts)
- runLoop, tasksFromSignals, LoopTask/LoopStop/LoopAttempt/LoopResult/LoopProgress/RunLoopOptions types (loop/run.ts)
