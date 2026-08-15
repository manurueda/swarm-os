# UI & Status Rendering

Assembles a serializable snapshot of everything in a `.swarm/` workspace (modules, signals, missions, refactor proposals, memory claims, import graph) via buildSnapshot(), and renders it as a single self-contained dark-themed HTML/CSS/JS page via renderUi(). Used both for the static `swarm ui` output and, wrapped by the CLI's local HTTP server (packages/cli/src/server.ts), for a live-updating view of a running mission. Deliberately opinionated: the primary object on the page is a 'task' (something wrong, where, and the command that fixes it), not a dashboard of stats.

## Owns

- `packages/core/src/ui/**`

## Read first

- `packages/core/src/ui/snapshot.ts` — buildSnapshot() — pulls together digest, code stats, import graph, signals, memory.md claims, missions and refactor proposals into the UiSnapshot the renderer consumes.
- `packages/core/src/ui/render.ts` — renderUi() — produces the entire HTML/CSS/inline-JS page as one template string; also documents the design rationale (task-first, not stats-first) in its header comment.

## Depends on

- `workspace-git`
- `architecture-analysis`
- `swarm-orchestration`
- `runtime`

## System context

Swarm OS is a CLI + core library that decomposes a target repository into ownable modules and dispatches teams of Claude Code agents ('swarms') to work those modules concurrently in isolated git worktrees, coordinating missions, ownership, and scheduling. It is built for developers who want unattended, context-economical multi-agent refactors and feature work on their own codebases.

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
