# Agent Runtime Port

Defines the AgentRuntime port and normalized domain vocabulary for Swarm OS (types.ts: ModuleSpec, SwarmRecord, MissionRecord, AgentSpec, SwarmEvent, AgentRuntime), and implements the sole runtime adapter today — ClaudeCodeLocalRuntime, a subprocess wrapper around the local `claude` CLI's `--output-format stream-json` NDJSON protocol, translated into a normalized SwarmEvent stream. Also owns environment scrubbing to protect subscription billing, tool-less "system tier" prompt construction, empirically-anchored per-agent context-window baseline estimates, and self-update detection/check/apply for the Swarm OS binary itself. index.ts is the single flat barrel re-exporting the entire @swarm-os/core package (not just this module) — its own contribution is lines 1-42.

## Owns

- `packages/core/src/runtime/**`
- `packages/core/src/update/**`
- `packages/core/src/index.ts`
- `packages/core/src/types.ts`
- `packages/core/package.json`
- `packages/core/tsconfig.json`

## Read first

- `packages/core/src/types.ts` — Defines the whole domain vocabulary (Module/Swarm/Mission/Agent) and the AgentRuntime port interface every other module depends on transitively.
- `packages/core/src/runtime/claude-code-local.ts` — The only AgentRuntime implementation; buildArgs() shows exactly which claude CLI flags encode each AgentSpec field, and run() shows the subprocess/async-generator lifecycle.
- `packages/core/src/runtime/stream-json.ts` — translate() is the sole place raw claude CLI NDJSON becomes SwarmEvent; a silent bug here makes agents 'appear to do nothing' per its own test file's comment.
- `packages/core/src/runtime/env.ts` — The billing-safety mechanism (scrubEnv/BILLING_ENV_VARS/NESTING_ENV_VARS) that every spawned agent goes through.
- `packages/core/src/update/index.ts` — Self-update logic (detectInstall/checkForUpdate/applyUpdate/backgroundUpdate) consumed by the CLI's update scheduling.
- `packages/core/src/index.ts` — Barrel file; shows what the whole @swarm-os/core package exposes, including everything from sibling modules — useful to see the full public surface this module contributes to.

## Depends on

_Nothing — this module stands alone._

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
