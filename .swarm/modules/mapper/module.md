# Repo Mapper

Builds a deterministic, tokens-free structural digest of a target repo and drives the four-stage `swarm map` pipeline (digest → partition → analyse → synthesise) that turns it into a durable module map with per-module charters and memory files under the workspace's `.swarm/` directory. Also detects when a previously-generated map has drifted from the repo's current state.

## Owns

- `packages/core/src/mapper/**`

## Read first

- `packages/core/src/mapper/pipeline.ts` — mapProject() is the orchestrator: runs digest→partition→analyse→synthesise, decides incremental re-analysis via per-module file hashing, and writes all workspace state. Also has detectDrift().
- `packages/core/src/mapper/digest.ts` — buildDigest() computes the RepoDigest (file list, tree, languages, doc headings, manifests, content fingerprints, overall hash) — the only view of the repo ever sent to a model.
- `packages/core/src/mapper/map.ts` — mapRepository() is the single tool-less agent call that turns a RepoDigest into a ModuleSpec[] + system summary; also renders module.md / system.md markdown.

## Depends on

- `swarm-orchestration`
- `workspace-git`
- `runtime`

## System context

Swarm OS is a CLI + core library that decomposes a target repository into ownable modules and dispatches teams of Claude Code agents ('swarms') to work those modules concurrently in isolated git worktrees, coordinating missions, ownership, and scheduling. It is built for developers who want unattended, context-economical multi-agent refactors and feature work on their own codebases.

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
