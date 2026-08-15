# swarm-os



**Stack.** 

**Size.** 160 tracked files across 8 modules.

## Modules

| Module | Purpose | Owns | Files |
| --- | --- | --- | --- |
| `architecture-analysis` | Pure, model-free static analysis of a target repository (file/line facts, a regex-derived import graph, and severity-ranked structural 'Signal's + per-module health), plus one model-backed step (refactor.ts) that spawns a read-only reviewer agent per module to confirm/reject those signals and emit structured, actionable refactor proposals rendered as a Markdown report. Four files total, each building on the last: code-stats.ts -> import-graph.ts/signals.ts -> refactor.ts. | `packages/core/src/architecture/**` | 6 |
| `cli` | The user-facing CLI (`@swarm-os/cli`, bin `swarm`) plus the repo's root docs/manifests. It parses argv, resolves a Workspace/AgentRuntime/SwarmConfig context, and dispatches to one handler per subcommand (map, status, mission, missions, memory, verify, refactor, ui, sleep, wake, loop, update). It owns zero domain logic — mapping, mission routing/orchestration, workspace/git, and the runtime port are all imported wholesale from `@swarm-os/core` — and contributes only: argv parsing (args.ts), context resolution (context.ts), terminal rendering including a live in-place multi-row status board (ui.ts), a localhost-only HTTP server for `swarm ui --serve` (server.ts), and self-update scheduling around every command invocation (commands/update.ts). | `packages/cli/**` `README.md` `docs/**` `package.json` `package-lock.json` `tsconfig.base.json` `LICENSE` `.gitignore` | 26 |
| `mapper` | Builds a deterministic, model-free structural digest of a target repo (digest.ts) and drives the four-stage `swarm map` pipeline — digest → partition → analyse → synthesise (pipeline.ts, pipeline/*.ts) — that turns that digest into a durable module map: `.swarm/system.md`, per-module `module.md` charters and `memory.md`, written via the Workspace store. Also detects when a previously-generated map has drifted from the repo's current state (detectDrift) and flags modules whose structural sub-domains ('areas') were never surveyed into per-area memory (pendingSplits). | `packages/core/src/mapper/**` | 40 |
| `mission` | Executes a single Swarm OS 'mission': turn one natural-language goal into module assignments (route.ts), spawn one isolated worker agent per assigned module in its own git worktree with only that module's context (run.ts), have an independent read-only reviewer agent critique the resulting diff before commit (review.ts), then commit, compress the module's memory ('sleep'), and clean up worktrees. run.ts is the single orchestrator tying all of this together end-to-end. | `packages/core/src/mission/**` | 4 |
| `runtime` | Defines the AgentRuntime port (types.ts: ModuleSpec/SwarmRecord/MissionRecord/AgentSpec/SwarmEvent/AgentRuntime interface) and its sole implementation, ClaudeCodeLocalRuntime — a subprocess wrapper around the local `claude` CLI's `--output-format stream-json` NDJSON protocol, translated into a normalized SwarmEvent stream. Also owns: environment scrubbing (billing/nesting env vars stripped from spawned agents), tool-less "system tier" prompt construction with measured token savings, empirically-anchored per-agent context baseline estimates, and self-update detection/check/apply for the Swarm OS binary itself (git fast-forward or npm install -g). index.ts is the single flat barrel export for the entire @swarm-os/core package, not scoped to this module alone. | `packages/core/src/runtime/**` `packages/core/src/update/**` `packages/core/src/index.ts` `packages/core/src/types.ts` `packages/core/package.json` `packages/core/tsconfig.json` | 13 |
| `swarm-orchestration` | Owns the swarm agent lifecycle (wake with a scoped context pack, sleep with memory compression), per-module ownership enforcement, the "areas" sub-splitting mechanism for large modules' memory, the analyst agent that produces a module's charter+memory, the adversarial memory verifier, a rate-limit-aware concurrency scheduler for spawning agent processes, and `runLoop` — the unattended survey→pick→mission→verify→merge cycle that drives `swarm loop` on a single integration branch. | `packages/core/src/swarm/**` `packages/core/src/loop/**` | 27 |
| `ui-observability` | Two-file module that (1) assembles a fully-serializable UiSnapshot of a Swarm OS `.swarm/` workspace — modules, structural signals, import graph, missions, refactor proposals, memory-claim excerpts, config, token budgets — by re-running/reading the mapper, architecture-analysis and swarm sub-packages (snapshot.ts), and (2) renders that snapshot into one self-contained dark-themed HTML/CSS/JS string with no server, build step or external assets, embedding the JSON snapshot inline (render.ts). The rendered page's client-side JS optionally goes 'live' (SSE + fetch) when a `window.__SWARM__` token is injected by the CLI's server.ts wrapper, but render.ts itself has no knowledge of networking beyond that hook. | `packages/core/src/ui/**` | 2 |
| `workspace-git` | Durable on-disk store (`workspace/`) for everything Swarm OS knows about a target repo under its `.swarm/` directory (config, module map/ownership, per-module memory/decisions/areas, swarm state, mission records/event logs), plus a git CLI wrapper and worktree lifecycle manager (`git/`) that gives each agent an isolated checkout under `.swarm/worktrees/` so parallel swarms never collide on the index or working tree, and provides the primitives (diff, commit, clean-tree check) that missions and the unattended loop are built on. | `packages/core/src/workspace/**` `packages/core/src/git/**` | 6 |

## Dependencies

```
architecture-analysis → swarm-orchestration
architecture-analysis → runtime
cli → runtime
cli → workspace-git
cli → mission
cli → mapper
cli → swarm-orchestration
cli → ui-observability
cli → architecture-analysis
mapper → swarm-orchestration
mapper → workspace-git
mapper → runtime
mission → swarm-orchestration
mission → workspace-git
mission → runtime
mission → mapper
runtime → cli — consumes AgentRuntime, backgroundUpdate/readUpdateStatus etc. for the `swarm update` command and to spawn agents
runtime → mission — builds AgentSpec and drives it through AgentRuntime.run()/collectAgent for mission/reviewer agents
runtime → swarm-orchestration — Scheduler and analyst/manager code use AgentRuntime, standaloneSystemPrompt/standaloneAgentPrompt, and agentBaselineTokens to budget and run agents
runtime → mapper — partitioner/synthesiser agents use the system-tier prompt helpers and AgentRuntime
runtime → workspace-git — Workspace persists SwarmRecord/MissionRecord/ModuleSpec types defined here; update/index.ts's stateDir() (~/.swarm) is distinct from the per-project workspace .swarm/ dir owned by workspace-git
swarm-orchestration → mission
swarm-orchestration → workspace-git
swarm-orchestration → runtime
swarm-orchestration → architecture-analysis
ui-observability → mapper
ui-observability → architecture-analysis
ui-observability → swarm-orchestration
ui-observability → workspace-git
ui-observability → runtime
workspace-git → mission (run.ts drives Workspace + worktree.ts to orchestrate a mission end-to-end)
workspace-git → swarm-orchestration (manager.ts, finalize-sleep.ts, memory-state.ts, verify.ts consume Workspace heavily for module/state/memory)
workspace-git → mapper (pipeline/* uses Workspace extensively for module map read/write, areas, archiving)
workspace-git → ui-observability (snapshot.ts reads Workspace to build the dashboard snapshot)
```

---

_Generated by `swarm map` from a structural digest (fingerprint `cf900b3324076004`)._
_No source code was read to produce this map._
