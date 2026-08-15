# CLI & Product Surface

The user-facing CLI (`@swarm-os/cli`, bin `swarm`) plus the repo's root docs/manifests. It parses argv, resolves a Workspace/AgentRuntime/SwarmConfig context, and dispatches to one handler per subcommand (map, status, mission, missions, memory, verify, refactor, ui, sleep, wake, loop, update). It owns zero domain logic — mapping, mission routing/orchestration, workspace/git, and the runtime port are all imported wholesale from `@swarm-os/core` — and contributes only: argv parsing (args.ts), context resolution (context.ts), terminal rendering including a live in-place multi-row status board (ui.ts), a localhost-only HTTP server for `swarm ui --serve` (server.ts), and self-update scheduling around every command invocation (commands/update.ts).

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

- `packages/cli/src/main.ts` — Program entry: builds argv→command dispatch table, owns the top-level HELP text (which is the closest thing to a CLI spec), SIGINT double-tap-to-kill handling, and the after-every-command background-update scheduling hook.
- `packages/cli/src/context.ts` — Every command starts with `loadContext(args)` from here — resolves the Workspace, applies config overrides from flags, builds the AgentRuntime, and is where the 'refuse to spawn agents on API billing' guarantee (assertRuntimeReady) lives.
- `packages/cli/src/args.ts` — The whole argv grammar (positionals vs `--flag value` vs `--flag=value` vs bare boolean vs `--`-terminated positionals) in ~70 lines; args.test.ts documents its exact edge cases.
- `packages/cli/src/ui.ts` — All terminal rendering primitives (color, table, LiveBoard) that every command/*.ts file imports; LiveBoard's in-place repaint via ANSI cursor-up is the only nontrivial piece of behavior in the file.
- `packages/cli/src/server.ts` — The whole implementation of `swarm ui --serve`: token-gated localhost HTTP server, SSE event broadcast, and the single place a mission is triggered from a web request rather than the CLI directly.

## Depends on

- `runtime`
- `workspace-git`
- `mission`
- `mapper`
- `swarm-orchestration`
- `ui-observability`
- `architecture-analysis`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
