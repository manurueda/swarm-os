# Agent Runtime Port

Defines the AgentRuntime port (types.ts) and its sole implementation, a subprocess wrapper around the local `claude` CLI that speaks its `--output-format stream-json` NDJSON protocol and translates it into a normalized SwarmEvent stream. Also owns: environment scrubbing so spawned agents never see billing/nesting env vars, construction of tool-less "system tier" prompts, empirically-measured per-agent context baseline estimates, and self-update detection/checking/applying for the Swarm OS binary itself (git-checkout or npm install). index.ts is the package's single flat barrel export surface for all of @swarm-os/core, not just this module.

## Owns

- `packages/core/src/runtime/**`
- `packages/core/src/update/**`
- `packages/core/src/index.ts`
- `packages/core/src/types.ts`
- `packages/core/package.json`
- `packages/core/tsconfig.json`

## Read first

- `packages/core/src/types.ts` — Defines the whole domain vocabulary (ModuleSpec, SwarmRecord, MissionRecord, AgentSpec, SwarmEvent, AgentRuntime interface) that every other module in the repo imports from @swarm-os/core.
- `packages/core/src/runtime/claude-code-local.ts` — The only AgentRuntime implementation: builds claude CLI args from AgentSpec, spawns the subprocess, streams translated events, handles abort/kill and process-registry cleanup.
- `packages/core/src/runtime/stream-json.ts` — Pure translation layer from raw claude CLI NDJSON objects to SwarmEvent; change this when the CLI's stream-json shape changes.
- `packages/core/src/runtime/env.ts` — The billing/nesting safety mechanism — read this before touching how child processes are spawned anywhere in the codebase.
- `packages/core/src/update/index.ts` — Self-update logic (git vs npm install detection, background check/apply) — isolated, no dependency on the rest of runtime/.
- `packages/core/src/index.ts` — The single export surface for the whole @swarm-os/core package; shows what every other module is allowed to import.

## Depends on

- `cli — consumes AgentRuntime, backgroundUpdate/readUpdateStatus etc. for the `swarm update` command and to spawn agents`
- `mission — builds AgentSpec and drives it through AgentRuntime.run()/collectAgent for mission/reviewer agents`
- `swarm-orchestration — Scheduler and analyst/manager code use AgentRuntime, standaloneSystemPrompt/standaloneAgentPrompt, and agentBaselineTokens to budget and run agents`
- `mapper — partitioner/synthesiser agents use the system-tier prompt helpers and AgentRuntime`
- `workspace-git — Workspace persists SwarmRecord/MissionRecord/ModuleSpec types defined here; update/index.ts's stateDir() (~/.swarm) is distinct from the per-project workspace .swarm/ dir owned by workspace-git`

## System context

Swarm OS is a CLI + core library that decomposes a target repository into ownable modules and dispatches teams of Claude Code agents ('swarms') to work those modules concurrently in isolated git worktrees, coordinating missions, ownership, and scheduling. It is built for developers who want unattended, context-economical multi-agent refactors and feature work on their own codebases.

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
