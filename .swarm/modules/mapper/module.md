# Repo Mapper

Turns a target repository into a durable, on-disk module map without ever sending source code to a model. digest.ts computes a deterministic, git-derived structural fingerprint of the repo (file list, per-file content hashes, directory tree, doc headings, manifest excerpts) at zero token cost. map.ts sends only that digest to one tool-less agent to propose module boundaries (slug/name/purpose/owns-globs/entryPoints/dependsOn) and renders system.md / module.md prose. pipeline.ts (mapProject) orchestrates the full incremental digest->partition->analyse->survey-areas->synthesise run, composed of ~20 single-purpose step files under pipeline/ that each take explicit arguments instead of closing over mapProject's locals (so a step defined but never wired in shows up as an unimported file, not dead code hidden in a closure). pipeline.ts also exposes detectDrift (has the repo moved since the last map, per-module) and pendingSplits (large modules whose structural sub-domains were never surveyed into per-area memory).

## Owns

- `packages/core/src/mapper/**`

## Read first

- `packages/core/src/mapper/pipeline.ts` — The orchestrator: mapProject (the whole `swarm map` run), detectDrift, pendingSplits. Start here to see the phase order and how every pipeline/ step is wired together.
- `packages/core/src/mapper/digest.ts` — buildDigest/renderDigest — the only thing ever sent to the partition/analyst agents. Defines RepoDigest, the shape every pipeline step reasons about (files, fingerprints, hash).
- `packages/core/src/mapper/map.ts` — mapRepository (the partition step's actual agent call), MODULE_MAP_SCHEMA, slugify, renderModuleCharter/renderSystemMap. Owns the mapper agent's prompt/charter and the empty-module repair loop.
- `packages/core/src/mapper/pipeline/types.ts` — Shared shapes (MapPhase, MapProgress, MapModuleResult, MapResult, MapProjectOptions) that every pipeline/ step and pipeline.ts import from, instead of from pipeline.ts itself — keeps the dependency direction one-way.
- `packages/core/src/mapper/pipeline/module-files.ts` — hashFiles/filesFor — the incremental-mapping primitive every plan/analyse/drift step is built on: same file list + same content fingerprints => same hash => module skipped.

## Depends on

- `runtime`
- `swarm-orchestration`
- `workspace-git`

## System context

_Not recorded._

---

_Charter written by this module's analyst. `swarm map` will not overwrite it
without `--force`, and never touches memory.md or decisions.md._
