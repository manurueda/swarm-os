# swarm-os

Swarm OS is a CLI + core library that decomposes a target repository into ownable modules and dispatches teams of Claude Code agents ('swarms') to work those modules concurrently in isolated git worktrees, coordinating missions, ownership, and scheduling. It is built for developers who want unattended, context-economical multi-agent refactors and feature work on their own codebases.

**Stack.** TypeScript monorepo (npm workspaces), two packages: packages/cli (command-line front end) and packages/core (orchestration engine); no visible web framework, runtime is Node.js spawning local Claude Code agent processes via a stream-json protocol.

**Size.** 57 tracked files across 8 modules.

## Modules

| Module | Purpose | Owns | Files |
| --- | --- | --- | --- |
| `architecture-analysis` | Pure, model-free static analysis of a target repository, plus one model-backed step that turns those facts into human-actionable refactor proposals. Four files: code-stats.ts (language-agnostic file/line/naming facts via `wc -l` and path heuristics), import-graph.ts (a regex-based, per-language import graph resolved to repo files, module-attributed, with cycle detection), signals.ts (combines the module map + code stats + import graph into a sorted list of severity-ranked `Signal`s plus per-module `ModuleHealth` and ownership coverage), and refactor.ts (spawns a read-only reviewer agent per module, seeded with the signals concerning it, that confirms/rejects them and emits structured refactor proposals, and renders them all into a Markdown report). Consumed by `swarm loop` (packages/core/src/loop/run.ts) for incremental re-analysis and by the UI snapshot builder (packages/core/src/ui/snapshot.ts) for the dashboard, and re-exported wholesale from packages/core/src/index.ts. | `packages/core/src/architecture/**` | 4 |
| `cli` | The user-facing CLI package (`@swarm-os/cli`, bin name `swarm`) plus the repo's root docs/manifests. It parses argv, resolves a Workspace/AgentRuntime/SwarmConfig context, and dispatches to one handler per subcommand (map, status, mission, missions, memory, verify, refactor, ui, sleep, wake, loop, doctor, update). All domain logic — mapping, mission routing, orchestration, workspace/git, runtime — is imported wholesale from the single package `@swarm-os/core`; this module contributes only argv parsing, terminal rendering (a live in-place status board), a local HTTP server for the live `swarm ui --serve` view, and self-update scheduling. | `packages/cli/**` `README.md` `docs/**` `package.json` `package-lock.json` `tsconfig.base.json` `LICENSE` `.gitignore` | 25 |
| `mapper` | Builds a deterministic, tokens-free structural digest of a target repo and drives the four-stage `swarm map` pipeline (digest → partition → analyse → synthesise) that turns it into a durable module map with per-module charters and memory files under the workspace's `.swarm/` directory. Also detects when a previously-generated map has drifted from the repo's current state. | `packages/core/src/mapper/**` | 3 |
| `mission` | Defines and executes a Swarm OS 'mission': routing a single natural-language goal to the module(s) it touches (route.ts), spawning one isolated worker agent per assigned module in its own git worktree with only that module's charter/memory (run.ts), and having an independent reviewer agent critique each resulting diff before it is committed (review.ts). run.ts is the orchestrator that ties routing, worktree creation, agent execution, review, commit, memory-compression ('sleep'), and worktree cleanup into one end-to-end mission lifecycle. | `packages/core/src/mission/**` | 3 |
| `runtime` | Defines the AgentRuntime port (types.ts) and its sole implementation, a subprocess wrapper around the local `claude` CLI that speaks its `--output-format stream-json` NDJSON protocol and translates it into a normalized SwarmEvent stream. Also owns: environment scrubbing so spawned agents never see billing/nesting env vars, construction of tool-less "system tier" prompts, empirically-measured per-agent context baseline estimates, and self-update detection/checking/applying for the Swarm OS binary itself (git-checkout or npm install). index.ts is the package's single flat barrel export surface for all of @swarm-os/core, not just this module. | `packages/core/src/runtime/**` `packages/core/src/update/**` `packages/core/src/index.ts` `packages/core/src/types.ts` `packages/core/package.json` `packages/core/tsconfig.json` | 10 |
| `swarm-orchestration` | Manages the agent swarm lifecycle and the multi-module missions built on it: enforces per-module file ownership (glob matching + post-hoc diff checking), splits large modules into 'areas' for finer-grained memory, runs the per-module 'analyst' agent that produces a module's charter and memory, verifies memory claims deterministically and adversarially, schedules concurrent agent processes under a subscription rate-limit budget, and drives `swarm loop` — an unattended, hours-long cycle of survey → pick task → run mission → verify → merge onto a single integration branch. | `packages/core/src/swarm/**` `packages/core/src/loop/**` | 7 |
| `ui-observability` | Assembles a serializable snapshot of everything in a `.swarm/` workspace (modules, signals, missions, refactor proposals, memory claims, import graph) via buildSnapshot(), and renders it as a single self-contained dark-themed HTML/CSS/JS page via renderUi(). Used both for the static `swarm ui` output and, wrapped by the CLI's local HTTP server (packages/cli/src/server.ts), for a live-updating view of a running mission. Deliberately opinionated: the primary object on the page is a 'task' (something wrong, where, and the command that fixes it), not a dashboard of stats. | `packages/core/src/ui/**` | 2 |
| `workspace-git` | Two tightly related pieces: (1) `workspace/` — a typed, all-async wrapper (`Workspace` class) around the project's `.swarm/` directory, which is the durable, on-disk store of everything Swarm OS knows about a repo (config, module map/ownership, per-module memory/decisions, swarm state, mission records/logs); (2) `git/` — a thin wrapper around the `git` CLI plus git-worktree lifecycle management, giving each agent an isolated checkout under `.swarm/worktrees/` so parallel swarms never collide on the index or working tree. | `packages/core/src/workspace/**` `packages/core/src/git/**` | 3 |

## Dependencies

```
architecture-analysis → swarm-orchestration (packages/core/src/swarm/ownership.ts: isOwned, findOwnershipConflicts, matchesGlob — used to attribute files/imports to module slugs and detect ownership conflicts)
architecture-analysis → runtime (packages/core/src/runtime/collect.ts: collectAgent/AgentOutcome, and packages/core/src/runtime/system-tier.ts: standaloneAgentPrompt — used by refactor.ts to spawn the read-only reviewer agent)
architecture-analysis → core types (packages/core/src/types.ts: ModuleSpec, AgentRuntime, SwarmEvent — shared domain types this module's functions are parameterized over)
cli → runtime
cli → workspace-git
cli → mapper
cli → mission
cli → swarm-orchestration
cli → ui-observability
cli → architecture-analysis
mapper → swarm-orchestration
mapper → workspace-git
mapper → runtime
mission → runtime
mission → swarm-orchestration
mission → workspace-git
mission → mapper
runtime → cli — consumes AgentRuntime, backgroundUpdate/readUpdateStatus etc. for the `swarm update` command and to spawn agents
runtime → mission — builds AgentSpec and drives it through AgentRuntime.run()/collectAgent for mission/reviewer agents
runtime → swarm-orchestration — Scheduler and analyst/manager code use AgentRuntime, standaloneSystemPrompt/standaloneAgentPrompt, and agentBaselineTokens to budget and run agents
runtime → mapper — partitioner/synthesiser agents use the system-tier prompt helpers and AgentRuntime
runtime → workspace-git — Workspace persists SwarmRecord/MissionRecord/ModuleSpec types defined here; update/index.ts's stateDir() (~/.swarm) is distinct from the per-project workspace .swarm/ dir owned by workspace-git
swarm-orchestration → runtime
swarm-orchestration → workspace-git
swarm-orchestration → mission
swarm-orchestration → architecture-analysis
swarm-orchestration → mapper
ui-observability → workspace-git
ui-observability → architecture-analysis
ui-observability → swarm-orchestration
ui-observability → runtime
workspace-git → runtime
```

---

_Generated by `swarm map` from a structural digest (fingerprint `9e6360e5a0518bd5`)._
_No source code was read to produce this map._
