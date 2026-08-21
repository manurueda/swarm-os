# swarm-os



**Stack.** 

**Size.** 162 tracked files across 8 modules.

## Modules

| Module | Purpose | Owns | Files |
| --- | --- | --- | --- |
| `architecture-analysis` | Pure, model-free static analysis of a target repository (file/line facts, a regex-derived import graph, and severity-ranked structural 'Signal's + per-module health), plus one model-backed step (refactor.ts) that spawns a read-only reviewer agent per module to confirm/reject those signals and emit structured, actionable refactor proposals rendered as a Markdown report. Four files total, each building on the last: code-stats.ts -> import-graph.ts/signals.ts -> refactor.ts. | `packages/core/src/architecture/**` | 6 |
| `cli` | The user-facing `swarm` CLI (@swarm-os/cli) plus the repo root docs/manifests. Parses argv (args.ts), resolves a Workspace/AgentRuntime/SwarmConfig context (context.ts), and dispatches to one handler per subcommand under commands/ (doctor, map, status, mission/missions, memory, verify, refactor, ui, sleep, wake, loop, update). Owns terminal rendering (ui.ts, including a live in-place multi-row status board), a localhost-only HTTP server for `swarm ui --serve` (server.ts), and self-update scheduling wrapped around every invocation (commands/update.ts). Contains zero domain logic itself — mapping, mission orchestration, workspace/git, verification, refactor-signal analysis and the runtime port are all imported from @swarm-os/core. | `packages/cli/**` `README.md` `docs/**` `package.json` `package-lock.json` `tsconfig.base.json` `LICENSE` `.gitignore` | 27 |
| `mapper` | Turns a target repository into a durable, on-disk module map without ever sending source code to a model. digest.ts computes a deterministic, git-derived structural fingerprint of the repo (file list, per-file content hashes, directory tree, doc headings, manifest excerpts) at zero token cost. map.ts sends only that digest to one tool-less agent to propose module boundaries (slug/name/purpose/owns-globs/entryPoints/dependsOn) and renders system.md / module.md prose. pipeline.ts (mapProject) orchestrates the full incremental digest->partition->analyse->survey-areas->synthesise run, composed of ~20 single-purpose step files under pipeline/ that each take explicit arguments instead of closing over mapProject's locals (so a step defined but never wired in shows up as an unimported file, not dead code hidden in a closure). pipeline.ts also exposes detectDrift (has the repo moved since the last map, per-module) and pendingSplits (large modules whose structural sub-domains were never surveyed into per-area memory). | `packages/core/src/mapper/**` | 41 |
| `mission` | Executes a single Swarm OS mission end-to-end: routes a natural-language goal to the fewest module(s) that must change (route.ts), spawns one isolated worker agent per assigned module in its own git worktree with only that module's charter/memory/context pack (run.ts:runMission), has a read-only reviewer agent critique each module's diff before commit (review.ts), then commits per-module branches, triggers memory compression ('sleep') for every touched swarm, and cleans up worktrees whose work was safely committed. run.ts is the sole orchestrator; route.ts and review.ts are agent-spawning helpers it calls. | `packages/core/src/mission/**` | 4 |
| `runtime` | Defines the AgentRuntime port and normalized domain vocabulary for Swarm OS (types.ts: ModuleSpec, SwarmRecord, MissionRecord, AgentSpec, SwarmEvent, AgentRuntime), and implements the sole runtime adapter today — ClaudeCodeLocalRuntime, a subprocess wrapper around the local `claude` CLI's `--output-format stream-json` NDJSON protocol, translated into a normalized SwarmEvent stream. Also owns environment scrubbing to protect subscription billing, tool-less "system tier" prompt construction, empirically-anchored per-agent context-window baseline estimates, and self-update detection/check/apply for the Swarm OS binary itself. index.ts is the single flat barrel re-exporting the entire @swarm-os/core package (not just this module) — its own contribution is lines 1-42. | `packages/core/src/runtime/**` `packages/core/src/update/**` `packages/core/src/index.ts` `packages/core/src/types.ts` `packages/core/package.json` `packages/core/tsconfig.json` | 13 |
| `swarm-orchestration` | Owns the swarm agent lifecycle (wake with a scoped context pack, sleep with memory compression), per-module ownership enforcement, the "areas" sub-splitting mechanism for large modules' memory, the analyst agent that produces a module's charter+memory, the adversarial memory verifier, a rate-limit-aware concurrency scheduler for spawning agent processes, and `runLoop` — the unattended survey→pick→mission→verify→merge cycle that drives `swarm loop` on a single integration branch. | `packages/core/src/swarm/**` `packages/core/src/loop/**` | 27 |
| `ui-observability` | Two-file module that (1) assembles a fully-serializable UiSnapshot of a Swarm OS `.swarm/` workspace — modules, structural signals, import graph, missions, refactor proposals, memory-claim excerpts, config, token budgets — by re-running/reading the mapper, architecture-analysis and swarm sub-packages (snapshot.ts), and (2) renders that snapshot into one self-contained dark-themed HTML/CSS/JS string with no server, build step or external assets, embedding the JSON snapshot inline (render.ts). The rendered page's client-side JS optionally goes 'live' (SSE + fetch) when a `window.__SWARM__` token is injected by the CLI's server.ts wrapper, but render.ts itself has no knowledge of networking beyond that hook. | `packages/core/src/ui/**` | 2 |
| `workspace-git` | Two tightly-scoped pieces read together: (1) workspace/store.ts + config.ts define the on-disk schema and typed read/write API for a target repo's `.swarm/` directory (config, module map/ownership, per-module memory/decisions/areas, swarm state.json, mission records + append-only event logs); (2) git/worktree.ts is a thin execFile wrapper around the `git` CLI plus a worktree lifecycle (create/reuse/remove/prune), dependency-symlinking so worktrees are buildable, and the diff/commit primitives (changedFiles, diffStat, fullDiff, commitAll) that always hide both linked dependency symlinks and `.swarm/` itself from what a mission can see or commit. | `packages/core/src/workspace/**` `packages/core/src/git/**` | 6 |

## Dependencies

```
architecture-analysis → swarm-orchestration
architecture-analysis → runtime
cli → runtime
cli → mission
cli → mapper
cli → swarm-orchestration
cli → workspace-git
cli → architecture-analysis
cli → ui-observability
mapper → runtime
mapper → swarm-orchestration
mapper → workspace-git
mission → runtime
mission → swarm-orchestration
mission → workspace-git
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
workspace-git → runtime
```

---

_Generated by `swarm map` from a structural digest (fingerprint `ee6d51de82db6c83`)._
_No source code was read to produce this map._
