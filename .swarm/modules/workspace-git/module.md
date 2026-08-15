# Workspace & Git Worktrees

Two tightly related pieces: (1) `workspace/` — a typed, all-async wrapper (`Workspace` class) around the project's `.swarm/` directory, which is the durable, on-disk store of everything Swarm OS knows about a repo (config, module map/ownership, per-module memory/decisions, swarm state, mission records/logs); (2) `git/` — a thin wrapper around the `git` CLI plus git-worktree lifecycle management, giving each agent an isolated checkout under `.swarm/worktrees/` so parallel swarms never collide on the index or working tree.

## Owns

- `packages/core/src/workspace/**`
- `packages/core/src/git/**`

## Read first

- `packages/core/src/workspace/store.ts` — Defines the `Workspace` class — the single read/write gateway to `.swarm/`. Almost every other core module (mapper, mission, loop, swarm orchestration, ui) goes through this.
- `packages/core/src/workspace/config.ts` — Defines `SwarmConfig`, its defaults, and the parse/serialize pair used for `.swarm/config.yaml`, the one file that's committed to the target repo.
- `packages/core/src/git/worktree.ts` — All git interaction goes through the `git()` helper here; also owns worktree create/remove/prune, dependency-linking, diffing and committing.

## Depends on

- `runtime`

## System context

Swarm OS is a CLI + core library that decomposes a target repository into ownable modules and dispatches teams of Claude Code agents ('swarms') to work those modules concurrently in isolated git worktrees, coordinating missions, ownership, and scheduling. It is built for developers who want unattended, context-economical multi-agent refactors and feature work on their own codebases.

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
