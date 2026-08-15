# Workspace & Git Worktrees

Durable on-disk store (`workspace/`) for everything Swarm OS knows about a target repo under its `.swarm/` directory (config, module map/ownership, per-module memory/decisions/areas, swarm state, mission records/event logs), plus a git CLI wrapper and worktree lifecycle manager (`git/`) that gives each agent an isolated checkout under `.swarm/worktrees/` so parallel swarms never collide on the index or working tree, and provides the primitives (diff, commit, clean-tree check) that missions and the unattended loop are built on.

## Owns

- `packages/core/src/workspace/**`
- `packages/core/src/git/**`

## Read first

- `packages/core/src/workspace/store.ts` — Defines the Workspace class — the sole typed async API onto .swarm/. Every read/write of config, modules, areas, state, missions goes through it.
- `packages/core/src/workspace/config.ts` — Defines SwarmConfig, its defaults, and the parse/serialize round-trip used for .swarm/config.yaml — the project-level policy every other module reads.
- `packages/core/src/git/worktree.ts` — All git operations (worktree create/remove, diff, commit, clean-tree checks) live in this single file; everything else in git/ is just tests of it.

## Depends on

- `mission (run.ts drives Workspace + worktree.ts to orchestrate a mission end-to-end)`
- `swarm-orchestration (manager.ts, finalize-sleep.ts, memory-state.ts, verify.ts consume Workspace heavily for module/state/memory)`
- `mapper (pipeline/* uses Workspace extensively for module map read/write, areas, archiving)`
- `ui-observability (snapshot.ts reads Workspace to build the dashboard snapshot)`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
