# Agent Runtime Port

Defines the AgentRuntime port (types.ts: ModuleSpec/SwarmRecord/MissionRecord/AgentSpec/SwarmEvent/AgentRuntime interface) and its sole implementation, ClaudeCodeLocalRuntime — a subprocess wrapper around the local `claude` CLI's `--output-format stream-json` NDJSON protocol, translated into a normalized SwarmEvent stream. Also owns: environment scrubbing (billing/nesting env vars stripped from spawned agents), tool-less "system tier" prompt construction with measured token savings, empirically-anchored per-agent context baseline estimates, and self-update detection/check/apply for the Swarm OS binary itself (git fast-forward or npm install -g). index.ts is the single flat barrel export for the entire @swarm-os/core package, not scoped to this module alone.

## Owns

- `packages/core/src/runtime/**`
- `packages/core/src/update/**`
- `packages/core/src/index.ts`
- `packages/core/src/types.ts`
- `packages/core/package.json`
- `packages/core/tsconfig.json`

## Read first

- `packages/core/src/types.ts` — Defines the AgentRuntime port interface (preflight/run) and every domain type (AgentSpec, SwarmEvent, ModuleSpec, MissionRecord, UsageSnapshot) that the rest of the package depends on.
- `packages/core/src/runtime/claude-code-local.ts` — The only AgentRuntime implementation: buildArgs() maps AgentSpec to claude CLI flags, run() is the async-generator subprocess driver, killAllAgents()/liveChildren is the process-leak backstop.
- `packages/core/src/runtime/stream-json.ts` — translate() converts raw claude CLI NDJSON objects into SwarmEvent[]; NdjsonBuffer handles partial-chunk line splitting; tryParseJson() is the structured-output fallback parser.
- `packages/core/src/runtime/env.ts` — scrubEnv()/detectBillingEnv() and the BILLING_ENV_VARS/NESTING_ENV_VARS lists — the single mechanism preventing agents from silently billing per-token.
- `packages/core/src/update/index.ts` — Self-update: detectInstall() (git vs npm), checkForUpdate(), applyUpdate(), backgroundUpdate() — all state cached under ~/.swarm/update.json.
- `packages/core/src/index.ts` — The single package entry point; shows what this module exports alongside every sibling module's surface.

## Depends on

_Nothing — this module stands alone._

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
