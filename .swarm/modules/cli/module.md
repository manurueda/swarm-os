# CLI & Product Surface

The user-facing `swarm` CLI (@swarm-os/cli) plus the repo root docs/manifests. Parses argv (args.ts), resolves a Workspace/AgentRuntime/SwarmConfig context (context.ts), and dispatches to one handler per subcommand under commands/ (doctor, map, status, mission/missions, memory, verify, refactor, ui, sleep, wake, loop, update). Owns terminal rendering (ui.ts, including a live in-place multi-row status board), a localhost-only HTTP server for `swarm ui --serve` (server.ts), and self-update scheduling wrapped around every invocation (commands/update.ts). Contains zero domain logic itself — mapping, mission orchestration, workspace/git, verification, refactor-signal analysis and the runtime port are all imported from @swarm-os/core.

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

- `packages/cli/src/main.ts` — argv → HELP/version short-circuit → SIGINT handling → command dispatch table → background-update scheduling on exit. Read this first to see the whole shape.
- `packages/cli/src/args.ts` — the entire (hand-rolled) argv grammar: command detection, --flag=value, --flag value, boolean short flags, `--` escaping. args.test.ts pins its exact edge-case behavior.
- `packages/cli/src/context.ts` — every command's first call: resolveWorkspace/loadContext/assertRuntimeReady. This is where the subscription-billing guarantee and 'nearest mapped ancestor' workspace resolution live.
- `packages/cli/src/ui.ts` — shared terminal primitives (`c`, `line`, `table`, LiveBoard) used by every command's presentation layer.
- `packages/cli/src/server.ts` — the only networked surface in the CLI; localhost + token auth model for `swarm ui --serve`.
- `packages/cli/src/commands/update.ts` — self-update mechanics: detached background worker, the SWARM_UPDATE_WORKER re-entrancy guard, and appliedAt notice-on-next-run flow.

## Depends on

- `runtime`
- `mission`
- `mapper`
- `swarm-orchestration`
- `workspace-git`
- `architecture-analysis`
- `ui-observability`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
