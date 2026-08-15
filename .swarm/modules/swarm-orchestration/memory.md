# Swarm Orchestration — memory

_Durable knowledge for the `swarm-orchestration` swarm. Read on wake, rewritten on sleep._

## Invariants

- checkOwnership always allows `.swarm/` paths regardless of a module's globs — that is where agents record memory, and it must never register as a violation. <sub>`packages/core/src/swarm/ownership.ts`</sub>
- Every claim (invariant/gotcha) rendered into memory.md must carry a `path` and `source` ('code' or 'doc'); renderClaim/parseClaimLine round-trip through the exact `- text <sub>\`path\`[ [doc]]</sub>` markdown format, and verify.ts's extractClaims depends on that exact shape to find claims under `## Invariants` / `## Gotchas` headings only. <sub>`packages/core/src/swarm/analyst.ts`</sub>
- checkCitation treats a claim as 'outside-module' unless its path is owned by the module's globs (or a glob string starts with the normalized path) — a claim citing a real file outside the module's own paths is flagged, not silently trusted. <sub>`packages/core/src/swarm/verify.ts`</sub>
- Splitting into areas only happens structurally, driven by detectAreas over directory layout — never by measuring memory.md size — because the decision must be answerable before memory.md exists at all (e.g. on first map). SPLIT_AT (0.85) is dead/unused for this decision, kept only because index.ts still re-exports it. <sub>`packages/core/src/swarm/areas.ts`</sub>
- detectAreas requires at least minAreas (default 3) qualifying groups of minFiles (default 8) each; splitting into 1-2 areas is refused because it buys nothing over module-level memory. <sub>`packages/core/src/swarm/areas.ts`</sub>
- In sleepSwarm, area sections are filed into area memory files (fileAreaSections) BEFORE the module memory.md is overwritten, specifically so a crash between the two steps never loses area-specific knowledge already committed to disk. <sub>`packages/core/src/swarm/manager.ts`</sub>
- The compressor agent runs with zero tools and must return the full replacement memory.md text (not a diff); manager.ts strips a possible markdown code fence (stripFence) and requires >40 chars of output before treating it as usable, otherwise memory is left unchanged and a note is recorded. <sub>`packages/core/src/swarm/manager.ts`</sub>
- runLoop refuses to start unless the working tree is clean (ignoring `.swarm/`), creates exactly one integration branch per run, and every mission branches from and merges into that same branch (never `main`) — so work compounds across missions instead of producing parallel conflicting branches. <sub>`packages/core/src/loop/run.ts`</sub>
- A LoopTask that fails (mission error, no usable change, review reject, verify failure, merge conflict) is never retried within the same run — its `key` is added to `attempted` regardless of outcome, and each such failure increments consecutiveFailures which can stop the whole loop. <sub>`packages/core/src/loop/run.ts`</sub>
- Verification in runLoop happens inside each mission's own worktree BEFORE any merge to the integration branch, on purpose: the alternative (merge-then-verify-then-reset) would require a destructive `git reset --hard` on the shared branch, which an unattended process must never own. <sub>`packages/core/src/loop/run.ts`</sub>

## Gotchas

- areas.ts's own docstring notes an observed failure this module exists to prevent: an isolated agent, when it cannot see a sibling module's real interface, will invent a plausible-but-wrong one (e.g. guessed CLI syntax `swarm mission <module> "<goal>"` instead of the real `swarm mission "<goal>" --modules <module>`) rather than admit it doesn't know — hence dependencyContracts only ever shares a dependency's 'Public interface' section, never its source. <sub>`packages/core/src/swarm/manager.ts`</sub>
- fileIndex (the 'every file in this module' listing in the context pack) is dropped entirely, not truncated, once file count exceeds maxIndexFiles (default 160) — a partial list is considered worse than none because an agent can't distinguish 'not in this module' from 'list got cut off'. <sub>`packages/core/src/swarm/manager.ts`</sub>
- moduleAnalysisSchema's array limits are halved (SPLIT_LIMITS vs UNSPLIT_LIMITS) once a module has areas — this is a deliberate proportional cut tied to how much detail moved into per-area files, not a token-budget computation. <sub>`packages/core/src/swarm/analyst.ts`</sub>
- extractClaims only harvests claim lines from sections whose heading starts with 'invariant' or 'gotcha' (case-insensitive) — bullet lines anywhere else in memory.md (e.g. under 'Landmarks' or 'Public interface') are never picked up for verification, even if formatted identically. <sub>`packages/core/src/swarm/verify.ts`</sub>
- The verifier agent prompt in verify.ts deliberately gives claims as a bare numbered list with no section headings, provenance markers, or purpose statement — this is intentional to avoid biasing the independent re-read, not an oversight. <sub>`packages/core/src/swarm/verify.ts`</sub>
- planAreas only lists an area under `survey` (worth spawning an analyst for) if it has no existing memory yet, unless `force` is set — repeated `swarm map` runs won't re-survey areas that already have memory.md content. <sub>`packages/core/src/swarm/areas.ts`</sub>
- mergeAreaMemory assumes `## From missions` is always the last section of an area file and only ever appends fresh (deduped-by-exact-line) bullets under it or creates it — anything writing below that heading elsewhere would corrupt the append invariant. <sub>`packages/core/src/swarm/area-memory.ts`</sub>
- tasksFromSignals only converts a subset of signal kinds into loop tasks (god-file, untested-module, junk-drawer, flat-directory, deep-nesting); import-cycle, unowned-files, scattered-module, memory-pressure, ownership-conflict, and size-imbalance are deliberately left for a human because they are boundary decisions, not work an isolated module agent can execute. <sub>`packages/core/src/loop/run.ts`</sub>
- runVerify mutates the environment to point PYTHONPATH at the worktree's own `src` when it looks like a Python project (pyproject.toml + src/), because a worktree checkout otherwise resolves against the original clone's editable install and produces false collection failures — observed directly on a real mission (246 spurious errors) before this fix. <sub>`packages/core/src/loop/run.ts`</sub>
- Scheduler.run() never rejects the overall Promise.all — a per-task throw or a 'paused' skip both resolve that task's slot to an Error object in the results array, preserving original index order, so callers must check each element with `instanceof Error` rather than relying on try/catch around the whole run. <sub>`packages/core/src/swarm/scheduler.ts`</sub>

## Landmarks

- `packages/core/src/swarm/area-memory.ts` — splitAreaSections (pulls `## Area: <slug>` blocks out of compressor output) and mergeAreaMemory (append-only, dedupes by exact bullet line, into an area's own memory.md).
- `packages/core/src/swarm/file-area-sections.ts` — Files the compressor's per-area sections into their area memory files before the module file is rewritten, so a crash loses nothing already on disk; silently drops any area slug the compressor invents that isn't in the known area list.
- `packages/core/src/swarm/compressor-prompt.ts / compressor-agent.ts` — Builds the prompt and runs the tool-less memory-compression agent (COMPRESSOR_CHARTER) that rewrites memory.md within a token budget, offloading area-specific facts via `## Area: <slug>` headings.
- `packages/core/src/swarm/compression-budget.ts` — shouldSkipCompression: skips the model call entirely when nothing happened and memory is already within budget.
- `packages/core/src/swarm/finalize-sleep.ts` — Last step of sleepSwarm: writes memory.md if changed, marks the swarm record sleeping with updated memoryTokens.
- `packages/core/src/swarm/memory-state.ts` — Trivial helper: reads memory.md and its estimated token count.
- `packages/core/src/swarm/scheduler.ts` — Scheduler class: observe(event) watches for `ratelimit` events with status in pauseOnStatus (default rejected/blocked) and stops launching new tasks; run() preserves input order, never rejects the whole batch.

## Public interface

- buildContextPack, dependencyContracts, wakeSwarm, sleepSwarm, sleepAll (swarm/manager.ts)
- analyzeModule, renderCharter, renderMemory, renderClaim, parseClaimLine, ModuleAnalysis, Claim (swarm/analyst.ts)
- verifyModule, extractClaims, checkCitation, renderVerification, VERIFY_SCHEMA, ModuleVerification, ClaimVerification, Verdict (swarm/verify.ts)
- checkOwnership, isOwned, matchesGlob, findOwnershipConflicts, OwnershipReport, OwnershipConflict (swarm/ownership.ts)
- detectAreas, areaAsModule, planAreas, renderAreaIndex, AreaSpec, AreaPlan, SPLIT_AT (unused, kept for backward compat) (swarm/areas.ts)
- splitAreaSections, mergeAreaMemory, AreaSections (swarm/area-memory.ts)
- Scheduler class (swarm/scheduler.ts)
- runLoop, tasksFromSignals, LoopTask, LoopResult, LoopAttempt, LoopProgress, LoopStop (loop/run.ts)

---

_Surveyed 2026-08-15 by the `swarm-orchestration` analyst, reading only this module's paths._
