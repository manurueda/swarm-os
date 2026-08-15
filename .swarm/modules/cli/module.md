# CLI & Product Surface

The user-facing CLI package (`@swarm-os/cli`, bin name `swarm`) plus the repo's root docs/manifests. It parses argv, resolves a Workspace/AgentRuntime/SwarmConfig context, and dispatches to one handler per subcommand (map, status, mission, missions, memory, verify, refactor, ui, sleep, wake, loop, doctor, update). All domain logic — mapping, mission routing, orchestration, workspace/git, runtime — is imported wholesale from the single package `@swarm-os/core`; this module contributes only argv parsing, terminal rendering (a live in-place status board), a local HTTP server for the live `swarm ui --serve` view, and self-update scheduling.

## Owns

- `packages/cli/**`
- `README.md`
- `docs/**`
- `package.json`
- `package-lock.json`
- `tsconfig.base.json`
- `LICENSE`
- `.gitignore`

## Read first

- `packages/cli/src/main.ts` — The actual bin entry (`swarm`): argv → command dispatch table, embedded HELP text, SIGINT handling (double Ctrl-C escalates to SIGKILL of agents), and background self-update scheduling after every command.
- `packages/cli/src/context.ts` — Where every command builds its CommandContext: resolveWorkspace (finds nearest .swarm/ ancestor or cwd), buildRuntime (only 'claude-code-local' is implemented, strictSubscription always true for spawning commands), applyOverrides (CLI flags over config), assertRuntimeReady (the billing-safety gate).
- `packages/cli/src/args.ts` — The entire argv grammar: one positional command, then flags/positionals. Read before touching any command's flag handling — its quirks are load-bearing (see gotchas).
- `packages/cli/src/ui.ts` — Terminal rendering primitives (color, table, LiveBoard) used by every command; LiveBoard's in-place repaint logic is the trickiest piece of UI code in the module.
- `packages/cli/src/server.ts` — The `swarm ui --serve` HTTP server: token-gated mission trigger, SSE event stream, security model documented in its header comment.
- `docs/ARCHITECTURE.md` — System-wide layer diagram (CLI → @swarm-os/core → AgentRuntime → provider) and the AgentRuntime port contract that context.ts implements against.

## Depends on

- `runtime`
- `workspace-git`
- `mapper`
- `mission`
- `swarm-orchestration`
- `ui-observability`
- `architecture-analysis`

## System context

Swarm OS is a CLI + core library that decomposes a target repository into ownable modules and dispatches teams of Claude Code agents ('swarms') to work those modules concurrently in isolated git worktrees, coordinating missions, ownership, and scheduling. It is built for developers who want unattended, context-economical multi-agent refactors and feature work on their own codebases.

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
