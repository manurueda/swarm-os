# Repo Mapper

Turns a target repository into a durable, on-disk module map with zero speculative reading of source code. digest.ts computes a deterministic, git-derived structural fingerprint of the repo (file list, content hashes, directory tree, doc headings, manifest excerpts) that costs no model tokens. map.ts sends only that digest (never source) to one tool-less agent to propose module boundaries (slugs, ownership globs, entry points, dependencies) and renders the resulting system.md / module.md charters. pipeline.ts (mapProject) orchestrates the full incremental digest→partition→analyse→synthesise run by composing ~20 single-purpose steps under pipeline/, each taking explicit arguments instead of closing over mapProject's locals, and also exposes detectDrift (has the repo moved since the last map?) and pendingSplits (large modules whose structural sub-domains were never surveyed into per-area memory).

## Owns

- `packages/core/src/mapper/**`

## Read first

- `packages/core/src/mapper/pipeline.ts` — The orchestrator: mapProject drives digest→partition→analyse(+areas)→synthesise, plus detectDrift and pendingSplits. Read this first to see how the pipeline/* steps compose.
- `packages/core/src/mapper/digest.ts` — buildDigest/renderDigest: the deterministic, model-free repo scan every other piece depends on, including its own drift-detecting content fingerprints.
- `packages/core/src/mapper/map.ts` — mapRepository: the single tool-less LLM call that proposes module boundaries from the digest, plus the empty-glob repair loop and the charter/system-map renderers.
- `packages/core/src/mapper/pipeline/types.ts` — Shared shapes (MapProjectOptions, MapResult, MapModuleResult, MapProgress) that every pipeline/* step and the public API use; imported by steps, never imports the orchestrator.
- `packages/core/src/mapper/pipeline/module-files.ts` — hashFiles/filesFor — the incremental-mapping primitive (per-module content fingerprint) used by planning, analysis, drift detection and area surveying alike.

## Depends on

- `swarm-orchestration`
- `workspace-git`
- `runtime`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
