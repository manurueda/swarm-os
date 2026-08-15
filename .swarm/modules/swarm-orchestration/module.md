# Swarm Orchestration

Manages the agent swarm lifecycle and the multi-module missions built on it: enforces per-module file ownership (glob matching + post-hoc diff checking), splits large modules into 'areas' for finer-grained memory, runs the per-module 'analyst' agent that produces a module's charter and memory, verifies memory claims deterministically and adversarially, schedules concurrent agent processes under a subscription rate-limit budget, and drives `swarm loop` — an unattended, hours-long cycle of survey → pick task → run mission → verify → merge onto a single integration branch.

## Owns

- `packages/core/src/swarm/**`
- `packages/core/src/loop/**`

## Read first

- `packages/core/src/swarm/manager.ts` — Swarm wake/sleep lifecycle and buildContextPack — the function that assembles everything an agent sees when it wakes into a module (system summary, charter, memory, area index, dependency contracts, file index).
- `packages/core/src/swarm/analyst.ts` — Defines the Claim type, MODULE_ANALYSIS_SCHEMA, analyzeModule (runs the read-only analyst agent), and the render/parse functions (renderClaim/parseClaimLine) that are the serialization contract for memory.md claims — shared with verify.ts.
- `packages/core/src/swarm/verify.ts` — Two-stage claim verification: deterministic citation resolution (extractClaims/checkCitation) plus an adversarial re-read agent (verifyModule). This is what `swarm verify` runs.
- `packages/core/src/swarm/ownership.ts` — Glob-to-regex translation and the ownership/conflict-detection logic that is the only real enforcement of module boundaries.
- `packages/core/src/swarm/areas.ts` — detectAreas splits an oversized module's files into sub-domain 'areas' by directory depth, each with its own memory budget.
- `packages/core/src/swarm/scheduler.ts` — Bounded-concurrency runner (Scheduler.run) used to launch agents in parallel, with rate-limit pause behavior.
- `packages/core/src/loop/run.ts` — runLoop — the `swarm loop` command's implementation: survey → pick task from structural signals → run mission → verify → merge, with multiple stop conditions.

## Depends on

- `runtime`
- `workspace-git`
- `mission`
- `architecture-analysis`
- `mapper`

## System context

Swarm OS is a CLI + core library that decomposes a target repository into ownable modules and dispatches teams of Claude Code agents ('swarms') to work those modules concurrently in isolated git worktrees, coordinating missions, ownership, and scheduling. It is built for developers who want unattended, context-economical multi-agent refactors and feature work on their own codebases.

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
