# Swarm Orchestration — memory

_Durable knowledge for the `swarm-orchestration` swarm. Read on wake, rewritten on sleep._

## Invariants

- checkOwnership always allows `.swarm/` paths regardless of a module's globs — that is where agents record memory, and it must never register as a violation. <sub>`packages/core/src/swarm/ownership.ts`</sub>
- Every claim (invariant/gotcha) rendered into memory.md must carry a `path` and `source` ('code' or 'doc'); renderClaim/parseClaimLine round-trip through the exact `- text <sub>\`path\`[ [doc]]</sub>` markdown format, and verify.ts's extractClaims depends on that exact shape to find claims under `## Invariants` / `## Gotchas` headings only. <sub>`packages/core/src/swarm/analyst.ts`</sub>
- checkCitation treats a claim as 'outside-module' unless its path is owned by the module's globs (or a glob string starts with the normalized path) — a claim citing a real file outside the module's own paths is flagged, not silently trusted. <sub>`packages/core/src/swarm/verify.ts`</sub>
- Splitting into areas only happens structurally, driven by detectAreas over directory layout — never by measuring memory.md size — because the decision must be answerable before memory.md exists at all (e.g. on first map). <sub>`packages/core/src/swarm/areas.ts`</sub>
- detectAreas requires at least minAreas (default 3) qualifying groups of minFiles (default 8) each; splitting into 1-2 areas is refused because it buys nothing over module-level memory. <sub>`packages/core/src/swarm/areas.ts`</sub>
- planAreas(areas: AreaSpec[], recorded: Set<string>, force?: boolean) => AreaSpec[] is the single source of truth for 'which detected areas still need surveying': all of `areas` if force, else only those whose slug is absent from `recorded`. Its two real callers — survey-module-areas.ts's inline filter and pipeline.ts's `pendingSplits` — both live in `packages/core/src/mapper/**` (the mapper module, not swarm-orchestration) and as of 2026-08-17 still duplicate this expression inline rather than calling planAreas (see gotchas). <sub>`packages/core/src/swarm/areas.ts`</sub>
- In sleepSwarm, area sections are filed into area memory files (fileAreaSections) BEFORE the module memory.md is overwritten, so a crash between the two steps never loses area-specific knowledge already committed to disk. <sub>`packages/core/src/swarm/manager.ts`</sub>
- The compressor agent runs with zero tools and must return the full replacement memory.md text (not a diff); manager.ts strips a possible markdown code fence and requires >40 chars of output before treating it as usable, otherwise memory is left unchanged. <sub>`packages/core/src/swarm/manager.ts`</sub>
- runLoop refuses to start unless the working tree is clean (ignoring `.swarm/`), creates exactly one integration branch per run, and every mission branches from and merges into that same branch (never `main`). <sub>`packages/core/src/loop/run.ts`</sub>
- A LoopTask that fails is never retried within the same run — its `key` is added to `attempted` regardless of outcome, and each failure increments consecutiveFailures which can stop the whole loop. <sub>`packages/core/src/loop/run.ts`</sub>
- Verification in runLoop happens inside each mission's own worktree BEFORE any merge to the integration branch, to avoid ever needing a destructive `git reset --hard` on the shared branch. <sub>`packages/core/src/loop/run.ts`</sub>

## Gotchas

- areas.ts's docstring: an isolated agent, unable to see a sibling module's real interface, will invent a plausible-but-wrong one rather than admit it doesn't know — hence dependencyContracts only ever shares a dependency's 'Public interface' section, never its source. <sub>`packages/core/src/swarm/manager.ts`</sub>
- fileIndex is dropped entirely, not truncated, once file count exceeds maxIndexFiles (default 160) — a partial list is worse than none since an agent can't tell 'not in module' from 'list got cut off'. <sub>`packages/core/src/swarm/manager.ts`</sub>
- moduleAnalysisSchema's array limits are halved (SPLIT_LIMITS vs UNSPLIT_LIMITS) once a module has areas — proportional to how much detail moved into per-area files, not a token-budget computation. <sub>`packages/core/src/swarm/analyst.ts`</sub>
- extractClaims only harvests claim lines from sections whose heading starts with 'invariant' or 'gotcha' (case-insensitive) — identical-looking bullets elsewhere (e.g. 'Landmarks') are never picked up. <sub>`packages/core/src/swarm/verify.ts`</sub>
- The verifier agent prompt gives claims as a bare numbered list with no headings or provenance, deliberately, to avoid biasing the independent re-read. <sub>`packages/core/src/swarm/verify.ts`</sub>
- planAreas only lists an area under `survey` if it has no existing memory yet, unless `force` is set — repeated `swarm map` runs won't re-survey areas that already have memory.md content. <sub>`packages/core/src/swarm/areas.ts`</sub>
- mergeAreaMemory assumes `## From missions` is always the last section of an area file and only ever appends fresh deduped bullets under it or creates it. <sub>`packages/core/src/swarm/area-memory.ts`</sub>
- tasksFromSignals only converts a subset of signal kinds into loop tasks (god-file, untested-module, junk-drawer, flat-directory, deep-nesting); import-cycle, unowned-files, scattered-module, memory-pressure, ownership-conflict, size-imbalance are left for a human as boundary decisions. <sub>`packages/core/src/loop/run.ts`</sub>
- runVerify points PYTHONPATH at the worktree's own `src` for Python projects (pyproject.toml + src/), because a worktree checkout otherwise resolves against the original clone's editable install and produces false collection failures. <sub>`packages/core/src/loop/run.ts`</sub>
- Scheduler.run() never rejects the overall Promise.all — a per-task throw or 'paused' skip resolves that slot to an Error object, index-preserved; callers must check each element with `instanceof Error`. <sub>`packages/core/src/swarm/scheduler.ts`</sub>
- Some worktrees have `node_modules` symlinked to a path outside the worktree (e.g. the original clone); the sandbox refuses filesystem access resolving through such a symlink, so `npm test`/`npx tsc --build` fail with 'requires approval' and cannot be run at all in that session, even with dangerouslyDisableSandbox. Changes in such a session can only be verified by manual code review — flag this explicitly in the mission report rather than implying tests passed.
- packages/core/src/mapper/** is a separate module (not swarm-orchestration) even though it's the sole real caller of areas.ts's planAreas and areas.ts's SPLIT_AT is/was re-exported from packages/core/src/index.ts. A swarm-orchestration mission cannot edit mapper/ or index.ts under its own boundary (`swarm/**`, `loop/**`) — cross-cutting renames (e.g. retiring SPLIT_AT, wiring callers to planAreas) need a companion mission scoped to mapper/index, or will land only half-done.
- As of the 2026-08-17 mission: planAreas in areas.ts was rewritten to return `AreaSpec[]` directly (was `AreaPlan {keep, survey}`), and SPLIT_AT was deleted from areas.ts — but the `AreaPlan` interface is still exported unused (orphaned), index.ts's SPLIT_AT re-export was not confirmed removed, and npm test was never actually run (see node_modules gotcha above). Treat this area of areas.ts as unverified/possibly build-broken until confirmed.

## Landmarks

- `packages/core/src/swarm/area-memory.ts` — splitAreaSections / mergeAreaMemory (append-only, dedupe-by-line) for an area's own memory.md.
- `packages/core/src/swarm/file-area-sections.ts` — files compressor's per-area sections before the module file is rewritten; silently drops unknown area slugs.
- `packages/core/src/swarm/compressor-prompt.ts` / `compressor-agent.ts` — builds prompt and runs the tool-less memory-compression agent (COMPRESSOR_CHARTER), token-budgeted, offloads via `## Area: <slug>` headings.
- `packages/core/src/swarm/compression-budget.ts` — shouldSkipCompression: skips the model call when nothing happened and memory is already in budget.
- `packages/core/src/swarm/finalize-sleep.ts` — last step of sleepSwarm: writes memory.md if changed, marks swarm record sleeping.
- `packages/core/src/swarm/scheduler.ts` — Scheduler: observe() watches `ratelimit` events (pauseOnStatus, default rejected/blocked) to stop launching new tasks.

## Public interface

- buildContextPack, dependencyContracts, wakeSwarm, sleepSwarm, sleepAll (swarm/manager.ts)
- analyzeModule, renderCharter, renderMemory, renderClaim, parseClaimLine, ModuleAnalysis, Claim (swarm/analyst.ts)
- verifyModule, extractClaims, checkCitation, renderVerification, VERIFY_SCHEMA, ModuleVerification, ClaimVerification, Verdict (swarm/verify.ts)
- checkOwnership, isOwned, matchesGlob, findOwnershipConflicts, OwnershipReport, OwnershipConflict (swarm/ownership.ts)
- detectAreas, areaAsModule, planAreas(areas, recorded, force) => AreaSpec[], renderAreaIndex, AreaSpec (swarm/areas.ts) — AreaPlan interface still exported but currently orphaned (no producer); SPLIT_AT removed from this file (index.ts export status unverified)
- splitAreaSections, mergeAreaMemory, AreaSections (swarm/area-memory.ts)
- Scheduler class (swarm/scheduler.ts)
- runLoop, tasksFromSignals, LoopTask, LoopResult, LoopAttempt, LoopProgress, LoopStop (loop/run.ts)

---

_Surveyed 2026-08-15 by the `swarm-orchestration` analyst; areas.ts entries updated 2026-08-17 (partial mission, changes-needed)._
