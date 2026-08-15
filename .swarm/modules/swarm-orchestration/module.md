# Swarm Orchestration

Owns the swarm agent lifecycle (wake with a scoped context pack, sleep with memory compression), per-module ownership enforcement, the "areas" sub-splitting mechanism for large modules' memory, the analyst agent that produces a module's charter+memory, the adversarial memory verifier, a rate-limit-aware concurrency scheduler for spawning agent processes, and `runLoop` — the unattended survey→pick→mission→verify→merge cycle that drives `swarm loop` on a single integration branch.

## Owns

- `packages/core/src/swarm/**`
- `packages/core/src/loop/**`

## Read first

- `packages/core/src/swarm/manager.ts` — Central lifecycle file: buildContextPack (what an agent sees on wake), wakeSwarm, sleepSwarm (memory compression pipeline), sleepAll. Wires together memory-state, compression-budget, compressor-prompt, compressor-agent, area-memory, file-area-sections, finalize-sleep.
- `packages/core/src/swarm/analyst.ts` — Defines the analyst agent (the same kind of agent producing this report), its JSON schema/prompt, and the canonical render functions (renderMemory/renderCharter/renderClaim/parseClaimLine) for module.md and memory.md; verify.ts depends on parseClaimLine.
- `packages/core/src/swarm/verify.ts` — Two-stage `swarm verify`: deterministic citation resolution (checkCitation) then an independent adversarial re-read agent (verifyModule) that sees only claims, stripped of provenance.
- `packages/core/src/swarm/areas.ts` — detectAreas (directory-structure-driven sub-domain splitting), planAreas, areaAsModule, renderAreaIndex — keeps large modules' memory addressable instead of one saturated file.
- `packages/core/src/swarm/ownership.ts` — Glob primitives (matchesGlob/isOwned) and checkOwnership/findOwnershipConflicts — enforces and audits per-module file boundaries; consumed directly by mission/run.ts outside this module.
- `packages/core/src/swarm/scheduler.ts` — Bounded-concurrency runner that pauses new launches on rate-limit events; used wherever many agent processes are spawned at once (missions, map, verify).
- `packages/core/src/loop/run.ts` — runLoop: the whole unattended survey→pick→mission→verify→merge cycle; tasksFromSignals maps architecture signals to mission goals.

## Depends on

- `mission`
- `workspace-git`
- `runtime`
- `architecture-analysis`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
