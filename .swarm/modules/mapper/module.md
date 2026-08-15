# Repo Mapper

Builds a deterministic, model-free structural digest of a target repo (digest.ts) and drives the four-stage `swarm map` pipeline — digest → partition → analyse → synthesise (pipeline.ts, pipeline/*.ts) — that turns that digest into a durable module map: `.swarm/system.md`, per-module `module.md` charters and `memory.md`, written via the Workspace store. Also detects when a previously-generated map has drifted from the repo's current state (detectDrift) and flags modules whose structural sub-domains ('areas') were never surveyed into per-area memory (pendingSplits).

## Owns

- `packages/core/src/mapper/**`

## Read first

- `packages/core/src/mapper/pipeline.ts` — mapProject() is the orchestrator — reads it top-to-bottom to see the whole digest→partition→analyse(+areas)→synthesise flow and how each pipeline/*.ts step plugs in. Also hosts detectDrift() and pendingSplits().
- `packages/core/src/mapper/digest.ts` — buildDigest()/renderDigest() — the only thing ever sent to a model; defines RepoDigest (files, fingerprints, hash, tree, docs, manifests) that every other file in this module consumes.
- `packages/core/src/mapper/map.ts` — mapRepository() — the single tool-less agent call that proposes module boundaries from the digest; also owns renderModuleCharter/renderSystemMap and the MODULE_MAP_SCHEMA the agent's structured output must satisfy.
- `packages/core/src/mapper/pipeline/types.ts` — Shared shapes (MapProjectOptions, MapResult, MapModuleResult, MapProgress) that every pipeline/*.ts step and consumer imports; read this before any individual step file.

## Depends on

- `swarm-orchestration`
- `workspace-git`
- `runtime`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
