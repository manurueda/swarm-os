# Swarm Orchestration — memory

_Durable knowledge for the `swarm-orchestration` swarm. Read on wake, rewritten on sleep._

## Invariants

- checkOwnership always allows `.swarm/` paths regardless of a module's globs — that is where agents record memory. <sub>`packages/core/src/swarm/ownership.ts`</sub>
- Every claim rendered into memory.md must carry a `path`/`source`; renderClaim/parseClaimLine round-trip the exact `- text <sub>\`path\`[ [doc]]</sub>` format, and verify.ts's extractClaims depends on that shape, only under `## Invariants`/`## Gotchas` headings. <sub>`packages/core/src/swarm/analyst.ts`</sub>
- checkCitation flags a claim as 'outside-module' unless its path is owned by the module's globs. <sub>`packages/core/src/swarm/verify.ts`</sub>
- Splitting into areas only happens structurally, via detectAreas over directory layout — never by measuring memory.md size — so the decision is answerable before memory.md exists. <sub>`packages/core/src/swarm/areas.ts`</sub>
- detectAreas requires ≥minAreas (default 3) qualifying groups of minFiles (default 8); 1-2 areas is refused. <sub>`packages/core/src/swarm/areas.ts`</sub>
- planAreas(areas, recorded, force) => AreaSpec[] is the single source of truth for which detected areas still need surveying: all if force, else only slugs absent from `recorded`. <sub>`packages/core/src/swarm/areas.ts`</sub>
- sleepSwarm files area sections into area memory (fileAreaSections) BEFORE overwriting module memory.md, so a crash between the two never loses area knowledge already on disk. <sub>`packages/core/src/swarm/manager.ts`</sub>
- The compressor agent runs with zero tools, must return full replacement memory.md text (not a diff); manager.ts strips a code fence and requires >40 chars output or leaves memory unchanged. <sub>`packages/core/src/swarm/manager.ts`</sub>
- runLoop refuses to start unless the working tree is clean (ignoring `.swarm/`), creates one integration branch per run, and every mission branches from/merges into that same branch, never `main`. <sub>`packages/core/src/loop/run.ts`</sub>
- A failed LoopTask is never retried within the same run — its `key` is added to `attempted` regardless of outcome, incrementing consecutiveFailures which can stop the loop. <sub>`packages/core/src/loop/run.ts`</sub>
- Verification happens inside each mission's own worktree BEFORE any merge to the integration branch, avoiding a destructive `git reset --hard` on the shared branch. Pre-merge verify is now `verifyUsable(usable, verifyCommand, verify?)`, which delegates to the mission module's `runVerify(module, worktreePath, verifyCommand) => {outcome: 'passed'|'failed'|'skipped-no-command', output}`. Any non-'passed' outcome blocks merge; `verify?` param exists so tests can inject a fake instead of a real git repo/agent runtime. <sub>`packages/core/src/loop/run.ts`</sub>

## Gotchas

- areas.ts's docstring: an isolated agent, unable to see a sibling module's real interface, will invent a plausible-but-wrong one — hence dependencyContracts only ever shares a dependency's 'Public interface' section, never its source. <sub>`packages/core/src/swarm/manager.ts`</sub>
- fileIndex is dropped entirely, not truncated, once file count exceeds maxIndexFiles (default 160) — partial list is worse than none. <sub>`packages/core/src/swarm/manager.ts`</sub>
- moduleAnalysisSchema's array limits halve (SPLIT_LIMITS vs UNSPLIT_LIMITS) once a module has areas. <sub>`packages/core/src/swarm/analyst.ts`</sub>
- extractClaims only harvests from sections whose heading starts with 'invariant'/'gotcha' (case-insensitive); identical bullets elsewhere (e.g. 'Landmarks') are never picked up. <sub>`packages/core/src/swarm/verify.ts`</sub>
- The verifier agent prompt gives claims as a bare numbered list with no headings/provenance, to avoid biasing the independent re-read. <sub>`packages/core/src/swarm/verify.ts`</sub>
- planAreas only lists an area under `survey` if it has no existing memory yet, unless `force` is set. <sub>`packages/core/src/swarm/areas.ts`</sub>
- mergeAreaMemory assumes `## From missions` is always the last section of an area file; only ever appends deduped bullets there or creates it. <sub>`packages/core/src/swarm/area-memory.ts`</sub>
- tasksFromSignals only converts god-file, untested-module, junk-drawer, flat-directory, deep-nesting into loop tasks; import-cycle, unowned-files, scattered-module, memory-pressure, ownership-conflict, size-imbalance are left for a human. <sub>`packages/core/src/loop/run.ts`</sub>
- Scheduler.run() never rejects Promise.all — a per-task throw/pause resolves that slot to an Error object, index-preserved; callers must check `instanceof Error`. <sub>`packages/core/src/swarm/scheduler.ts`</sub>
- Some worktrees have `node_modules` symlinked outside the worktree; the sandbox refuses filesystem access through such a symlink, blocking npm/tsc/npx — and in the worst cases even `git diff`/`git status`/`ls` on the target fail. When this happens, no process-execution command works at all in the session; verification can only be manual code review — state this explicitly in the mission report rather than implying tests passed.
- `packages/core/src/mapper/**` is a separate module (not swarm-orchestration) but is the sole real caller of areas.ts's planAreas. A swarm-orchestration mission cannot edit mapper/ or index.ts under its own boundary (`swarm/**`, `loop/**`) — cross-cutting renames there need a companion mission scoped to mapper/index. As of 2026-08-17, planAreas returns `AreaSpec[]` directly (was `AreaPlan {keep, survey}`), SPLIT_AT was deleted from areas.ts, but the `AreaPlan` interface is still exported unused (orphaned) and index.ts's SPLIT_AT re-export status is unconfirmed; npm test was never run. Treat as unverified.
- As of 2026-08-21: `packages/core/src/loop/run.ts` imports `runVerify` from `'../mission/verify.js'`, but that file does not exist in the repo yet — this is one leg of a 3-part coordinated mission whose mission-module companion (owning/exporting shared runVerify) had not landed. loop/run.ts will not build/typecheck until `mission/verify.ts` exists with a structurally compatible export. Check before trusting loop/run.ts builds.
- The old inline runVerify in loop/run.ts read `config.verifyEnv` (workspace/config.ts) to override auto-detected PYTHONPATH for Python worktrees, fixing a real prior failure mode (spurious collection errors from a worktree resolving against the original clone's install). The new shared `runVerify(module, worktreePath, verifyCommand)` 3-arg contract has no slot for extraEnv — `config.verifyEnv` is now defined/tested in workspace/config.ts but consumed nowhere. This is a real regression pending resolution, not yet fixed as of 2026-08-21.

## Landmarks

- `packages/core/src/swarm/area-memory.ts` — splitAreaSections / mergeAreaMemory (append-only, dedupe-by-line) for an area's own memory.md.
- `packages/core/src/swarm/file-area-sections.ts` — files compressor's per-area sections before the module file is rewritten; silently drops unknown area slugs.
- `packages/core/src/swarm/compressor-prompt.ts` / `compressor-agent.ts` — builds prompt and runs the tool-less memory-compression agent, token-budgeted, offloads via `## Area: <slug>` headings.
- `packages/core/src/swarm/compression-budget.ts` — shouldSkipCompression: skips the model call when nothing happened and memory is already in budget.
- `packages/core/src/swarm/finalize-sleep.ts` — last step of sleepSwarm: writes memory.md if changed, marks swarm record sleeping.
- `packages/core/src/swarm/scheduler.ts` — Scheduler: observe() watches `ratelimit` events (pauseOnStatus) to stop launching new tasks.
- `packages/core/src/loop/run.ts` — expects `packages/core/src/mission/verify.ts` to export `runVerify`; does not exist yet as of 2026-08-21 (see gotcha).

## Public interface

- buildContextPack, dependencyContracts, wakeSwarm, sleepSwarm, sleepAll (swarm/manager.ts)
- analyzeModule, renderCharter, renderMemory, renderClaim, parseClaimLine, ModuleAnalysis, Claim (swarm/analyst.ts)
- verifyModule, extractClaims, checkCitation, renderVerification, VERIFY_SCHEMA, ModuleVerification, ClaimVerification, Verdict (swarm/verify.ts)
- checkOwnership, isOwned, matchesGlob, findOwnershipConflicts, OwnershipReport, OwnershipConflict (swarm/ownership.ts)
- detectAreas, areaAsModule, planAreas(areas, recorded, force) => AreaSpec[], renderAreaIndex, AreaSpec (swarm/areas.ts) — AreaPlan interface still exported but orphaned; SPLIT_AT removed from this file (index.ts export status unverified)
- splitAreaSections, mergeAreaMemory, AreaSections (swarm/area-memory.ts)
- Scheduler class (swarm/scheduler.ts)
- runLoop, tasksFromSignals, verifyUsable(usable, verifyCommand, verify?), LoopTask, LoopResult, LoopAttempt, LoopProgress, LoopStop (loop/run.ts) — verifyUsable now delegates to mission/verify.ts's runVerify (currently missing, see gotchas); config.verifyEnv no longer consumed

---

_Surveyed 2026-08-15; areas.ts entries updated 2026-08-17; loop/run.ts verify-gate extraction 2026-08-21 (partial mission, changes-needed — missing mission/verify.ts, verifyEnv regression)._
