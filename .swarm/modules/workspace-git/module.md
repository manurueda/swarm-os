# Workspace & Git Worktrees

Two tightly-scoped pieces read together: (1) workspace/store.ts + config.ts define the on-disk schema and typed read/write API for a target repo's `.swarm/` directory (config, module map/ownership, per-module memory/decisions/areas, swarm state.json, mission records + append-only event logs); (2) git/worktree.ts is a thin execFile wrapper around the `git` CLI plus a worktree lifecycle (create/reuse/remove/prune), dependency-symlinking so worktrees are buildable, and the diff/commit primitives (changedFiles, diffStat, fullDiff, commitAll) that always hide both linked dependency symlinks and `.swarm/` itself from what a mission can see or commit.

## Owns

- `packages/core/src/workspace/**`
- `packages/core/src/git/**`

## Read first

- `packages/core/src/workspace/store.ts` — Defines the Workspace class — the sole read/write surface for `.swarm/`. Every consumer in the rest of the codebase goes through this, not the filesystem directly.
- `packages/core/src/workspace/config.ts` — Defines SwarmConfig, its DEFAULT_CONFIG, and the parse/serialize round-trip. Read this before touching any config field — every field's doc comment explains a real incident it fixes.
- `packages/core/src/git/worktree.ts` — All git interaction in the repo goes through this file's `git()` execFile wrapper. Also owns worktree create/remove and the commit/diff primitives with their linked-path/`.swarm`-exclusion logic.

## Depends on

- `runtime`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
