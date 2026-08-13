/**
 * The `swarm map` pipeline.
 *
 *   1. DIGEST    — deterministic. Walks the repo, costs zero tokens.
 *   2. PARTITION — one agent, no tools, digest only. Proposes module boundaries.
 *   3. ANALYSE   — one agent per module, in parallel, each reading only its own
 *                  globs. Produces the charter and the first memory.
 *   4. SYNTHESISE— assemble system.md from what the analysts actually found.
 *
 * Re-running is incremental. The file list is fingerprinted per module, so a
 * second `swarm map` re-analyses only the modules whose files changed and
 * leaves the rest — and all accumulated memory — untouched. This is what makes
 * it reasonable to re-analyse whenever you sit down to work: the cost is
 * proportional to what moved, not to the size of the repo.
 */

import { createHash } from 'node:crypto';

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../types.js';
import { findOwnershipConflicts, isOwned, type OwnershipConflict } from '../swarm/ownership.js';
import { Scheduler } from '../swarm/scheduler.js';
import {
  analyzeModule,
  renderCharter,
  renderMemory,
  type ModuleAnalysis,
} from '../swarm/analyst.js';
import { areaAsModule, detectAreas } from '../swarm/areas.js';
import { Workspace, estimateTokens } from '../workspace/store.js';
import type { SwarmConfig } from '../workspace/config.js';
import { buildDigest, type RepoDigest } from './digest.js';
import { mapRepository, renderSystemMap } from './map.js';

export type MapPhase = 'digest' | 'partition' | 'analyse' | 'synthesise';

export interface MapProgress {
  phase: MapPhase;
  message: string;
  /** Present during the analyse phase. */
  module?: string;
  done?: number;
  total?: number;
}

export interface MapModuleResult {
  spec: ModuleSpec;
  status: 'analysed' | 'reused' | 'failed';
  analysis?: ModuleAnalysis;
  memoryTokens?: number;
  error?: string;
  costUsd?: number;
}

export interface MapResult {
  repoName: string;
  totalFiles: number;
  modules: MapModuleResult[];
  system: { summary: string; stack: string };
  /** True when the partition step ran; false when an existing map was reused. */
  repartitioned: boolean;
  digestHash: string;
  costUsd: number;
  /** Combined size of every module's memory — the cost of keeping this repo mapped. */
  totalMemoryTokens: number;
  /** Modules moved to `.swarm/archive/` because the map no longer has them. */
  archived: string[];
  /** Module slug -> number of areas its memory was split into. */
  areas: Record<string, number>;
  /** Modules claiming the same files, decided against the real file list. */
  conflicts: OwnershipConflict[];
}

/** A module's fingerprint: which files it owns, and what is in each of them. */
function hashFiles(files: string[], prints?: Map<string, string>): string {
  return createHash('sha256')
    .update(files.map((f) => `${f}\u0000${prints?.get(f) ?? ''}`).join('\n'))
    .digest('hex')
    .slice(0, 16);
}

function filesFor(digest: RepoDigest, globs: string[]): string[] {
  return digest.files.filter((f) => isOwned(f, globs));
}

export interface MapProjectOptions {
  runtime: AgentRuntime;
  workspace: Workspace;
  config: SwarmConfig;
  /** Re-partition and re-analyse everything, discarding the existing map. */
  force?: boolean;
  /** Re-partition boundaries but keep memory where module slugs survive. */
  repartition?: boolean;
  onProgress?: (progress: MapProgress) => void;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function mapProject(options: MapProjectOptions): Promise<MapResult> {
  const { workspace, config, runtime } = options;
  const report = (p: MapProgress): void => options.onProgress?.(p);

  // -- 1. Digest ------------------------------------------------------------
  report({ phase: 'digest', message: 'reading repository structure' });
  const digest = await buildDigest(workspace.repoRoot);
  report({
    phase: 'digest',
    message: `${digest.totalFiles} tracked files, ${digest.languages[0]?.[0] ?? 'mixed'} dominant`,
  });

  const state = await workspace.readState();
  const existing = await workspace.listModules();

  const shouldPartition =
    options.force === true ||
    options.repartition === true ||
    existing.length === 0;

  // -- 2. Partition ---------------------------------------------------------
  let modules: ModuleSpec[];
  let system: { summary: string; stack: string };

  if (shouldPartition) {
    report({ phase: 'partition', message: 'proposing module boundaries from the digest' });
    const mapped = await mapRepository({
      runtime,
      repoRoot: workspace.repoRoot,
      ...(config.systemModel ? { model: config.systemModel } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    modules = mapped.modules;
    system = mapped.system;
    report({
      phase: 'partition',
      message: `${modules.length} modules proposed: ${modules.map((m) => m.slug).join(', ')}`,
    });
  } else {
    modules = existing;
    system = state.system ?? { summary: '', stack: '' };
    report({
      phase: 'partition',
      message: `reusing existing map (${modules.length} modules) — pass --repartition to redraw boundaries`,
    });
  }

  // Repartitioning changes the slug set. Old module directories left behind
  // would be returned by listModules() alongside the new ones.
  let archived: string[] = [];
  if (shouldPartition) {
    archived = await workspace.archiveModulesNotIn(
      modules.map((m) => m.slug),
      new Date().toISOString().slice(0, 10),
    );
    if (archived.length > 0) {
      report({
        phase: 'partition',
        message: `archived ${archived.length} module(s) no longer in the map: ${archived.join(', ')}`,
      });
    }
  }

  // -- 3. Analyse -----------------------------------------------------------
  const previousHashes = state.moduleHashes ?? {};
  const siblings = modules.map((m) => ({ slug: m.slug, purpose: m.purpose }));

  const plan = modules.map((spec) => {
    const owned = filesFor(digest, spec.owns);
    const hash = hashFiles(owned, digest.fingerprints);
    const unchanged = !options.force && previousHashes[spec.slug] === hash;
    return { spec: { ...spec, fileCount: owned.length }, hash, unchanged };
  });

  const toAnalyse = plan.filter((p) => !p.unchanged);
  const reused = plan.filter((p) => p.unchanged);

  if (reused.length > 0) {
    report({
      phase: 'analyse',
      message: `${reused.length} module${reused.length === 1 ? '' : 's'} unchanged — memory preserved, not re-read`,
    });
  }

  const results = new Map<string, MapModuleResult>();
  for (const entry of reused) {
    const memory = await workspace.readModuleFile(entry.spec.slug, 'memory.md');
    results.set(entry.spec.slug, {
      spec: entry.spec,
      status: 'reused',
      memoryTokens: estimateTokens(memory),
    });
  }

  let done = 0;
  const scheduler = new Scheduler({
    limit: config.maxConcurrentAgents,
    pauseOnStatus: config.pauseOnRateLimitStatus,
    onPause: (snapshot) =>
      report({
        phase: 'analyse',
        message: `subscription rate limit ${snapshot.status} — holding back remaining analysts`,
      }),
  });

  const forward = async (event: SwarmEvent): Promise<void> => {
    scheduler.observe(event);
    await options.onEvent?.(event);
  };

  if (toAnalyse.length > 0) {
    report({
      phase: 'analyse',
      message: `surveying ${toAnalyse.length} module${toAnalyse.length === 1 ? '' : 's'}, ${config.maxConcurrentAgents} at a time`,
      done: 0,
      total: toAnalyse.length,
    });
  }

  const generatedAt = new Date().toISOString().slice(0, 10);
  let costUsd = 0;

  /**
   * Give an oversized module per-area memory.
   *
   * The trigger is the module's memory saturating its budget while covering
   * several sub-domains — the measured condition where each sub-domain gets
   * ~170 tokens and an agent loads mostly things it will never touch.
   */
  const surveyAreas = async (spec: ModuleSpec, memoryTokens: number): Promise<void> => {
    if (memoryTokens < config.memoryBudgetTokens * 0.85) {
      await workspace.pruneAreas(spec.slug, []);
      return;
    }

    const areas = detectAreas(spec, digest.files);
    await workspace.pruneAreas(spec.slug, areas.map((a) => a.slug));
    if (areas.length === 0) return;

    report({
      phase: 'analyse',
      message: `splitting into ${areas.length} areas`,
      module: spec.slug,
    });

    const surveys = await scheduler.run(
      areas.map((area) => async () => {
        const asModule = areaAsModule(spec, area);
        const { analysis } = await analyzeModule({
          runtime,
          repoRoot: workspace.repoRoot,
          module: asModule,
          siblings: areas
            .filter((a) => a.slug !== area.slug)
            .map((a) => ({ slug: a.slug, purpose: `the ${a.slug} area (${a.path})` })),
          systemSummary: spec.purpose,
          ...(config.systemModel ? { model: config.systemModel } : {}),
          onEvent: forward,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        if (!analysis) throw new Error(`area ${area.slug} returned nothing`);
        return { area, analysis };
      }),
    );

    for (const survey of surveys) {
      if (survey instanceof Error || !survey) continue;
      await workspace.writeAreaFile(
        spec.slug,
        survey.area.slug,
        'area.json',
        `${JSON.stringify(survey.area, null, 2)}\n`,
      );
      await workspace.writeAreaFile(
        spec.slug,
        survey.area.slug,
        'memory.md',
        renderMemory(areaAsModule(spec, survey.area), survey.analysis, generatedAt),
      );
    }
  };
  const moduleHashes: Record<string, string> = { ...previousHashes };

  // state.json is a read-modify-write shared by every analyst, so serialize
  // updates. Module directories are per-module and need no such protection.
  let stateWrites: Promise<void> = Promise.resolve();
  const recordProgress = (slug: string, hash: string, memoryTokens: number): Promise<void> => {
    stateWrites = stateWrites.then(async () => {
      const current = await workspace.readState();
      current.moduleHashes = { ...(current.moduleHashes ?? {}), [slug]: hash };
      current.swarms[slug] = { module: slug, state: 'sleeping', memoryTokens };
      await workspace.writeState(current);
    });
    return stateWrites;
  };

  await scheduler.run(
    toAnalyse.map((entry) => async () => {
      report({
        phase: 'analyse',
        message: 'surveying',
        module: entry.spec.slug,
        done,
        total: toAnalyse.length,
      });

      const { analysis, outcome } = await analyzeModule({
        runtime,
        repoRoot: workspace.repoRoot,
        module: entry.spec,
        siblings: siblings.filter((s) => s.slug !== entry.spec.slug),
        systemSummary: system.summary,
        ...(config.systemModel ? { model: config.systemModel } : {}),
        onEvent: forward,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      done += 1;

      // Persist the moment this analyst returns, not after all of them do.
      // A long map on a large repo is then durable and inspectable while it
      // runs, and an interrupted one keeps every module that finished.
      if (!analysis) {
        report({
          phase: 'analyse',
          message: 'survey failed',
          module: entry.spec.slug,
          done,
          total: toAnalyse.length,
        });
        // Write the structural spec so the module exists and can be retried,
        // but record no hash — it must be re-analysed next time.
        await workspace.writeModule(
          entry.spec,
          renderStructuralCharter(entry.spec, system.summary),
        );
        // Drop any hash this module carried from an earlier map. Inheriting one
        // makes the next run consider it up to date, so a module that failed is
        // never retried until something else in it happens to change.
        delete moduleHashes[entry.spec.slug];
        results.set(entry.spec.slug, {
          spec: entry.spec,
          status: 'failed',
          error: outcome.error ?? 'analyst returned no structured result',
        });
        return;
      }

      // An analyst that corrects its globs changes which files it owns, so the
      // count computed before it ran is stale. Left uncorrected this reports
      // modules as owning zero files while they demonstrably own several.
      const owns = analysis.correctedOwns ?? entry.spec.owns;
      const ownedNow = filesFor(digest, owns);

      const spec: ModuleSpec = {
        ...entry.spec,
        purpose: analysis.purpose || entry.spec.purpose,
        owns,
        fileCount: ownedNow.length,
        entryPoints:
          analysis.entryPoints.length > 0
            ? analysis.entryPoints.map((e) => e.path)
            : entry.spec.entryPoints,
        dependsOn: analysis.dependsOn.length > 0 ? analysis.dependsOn : entry.spec.dependsOn,
      };

      await workspace.writeModule(spec, renderCharter(spec, analysis, system.summary));
      const memory = renderMemory(spec, analysis, generatedAt);
      await workspace.writeModuleFile(spec.slug, 'memory.md', memory);

      const memoryTokens = estimateTokens(memory);
      const hash = analysis.correctedOwns ? hashFiles(ownedNow, digest.fingerprints) : entry.hash;
      moduleHashes[spec.slug] = hash;
      costUsd += outcome.costUsd ?? 0;
      await recordProgress(spec.slug, hash, memoryTokens);

      results.set(spec.slug, {
        spec,
        status: 'analysed',
        analysis,
        memoryTokens,
        ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
      });

      report({
        phase: 'analyse',
        message: 'surveyed',
        module: spec.slug,
        done,
        total: toAnalyse.length,
      });
    }),
  );

  await stateWrites;

  // -- 4. Synthesise --------------------------------------------------------
  report({ phase: 'synthesise', message: 'writing system map' });

  const finalModules = modules.map((m) => results.get(m.slug)?.spec ?? m);
  await workspace.writeSystem(renderSystemMap(system, finalModules, digest));

  // Prune hashes for modules that no longer exist.
  for (const slug of Object.keys(moduleHashes)) {
    if (!finalModules.some((m) => m.slug === slug)) delete moduleHashes[slug];
  }

  const nextState = {
    ...state,
    swarms: state.swarms,
    mappedAt: new Date().toISOString(),
    digestHash: digest.hash,
    moduleHashes,
    system,
  };
  for (const slug of Object.keys(nextState.swarms)) {
    if (!finalModules.some((m) => m.slug === slug)) delete nextState.swarms[slug];
  }
  // Every module starts asleep. Mapping does not leave processes running.
  for (const spec of finalModules) {
    const current = nextState.swarms[spec.slug];
    nextState.swarms[spec.slug] = {
      module: spec.slug,
      state: 'sleeping',
      memoryTokens: results.get(spec.slug)?.memoryTokens ?? current?.memoryTokens ?? 0,
      ...(current?.lastMission ? { lastMission: current.lastMission } : {}),
      ...(current?.lastActiveAt ? { lastActiveAt: current.lastActiveAt } : {}),
    };
  }
  await workspace.writeState(nextState);

  const ordered = finalModules.map(
    (m) => results.get(m.slug) ?? { spec: m, status: 'failed' as const, error: 'not processed' },
  );

  return {
    repoName: digest.repoName,
    totalFiles: digest.totalFiles,
    modules: ordered,
    system,
    repartitioned: shouldPartition,
    digestHash: digest.hash,
    costUsd,
    totalMemoryTokens: ordered.reduce((sum, m) => sum + (m.memoryTokens ?? 0), 0),
    conflicts: findOwnershipConflicts(finalModules, digest.files),
    archived,
    areas: Object.fromEntries(
      await Promise.all(
        finalModules.map(
          async (m) => [m.slug, (await workspace.listAreas(m.slug)).length] as const,
        ),
      ).then((pairs) => pairs.filter(([, n]) => n > 0)),
    ),
  };
}

/** Fallback charter when a module's analyst failed — structure only, no findings. */
function renderStructuralCharter(spec: ModuleSpec, systemSummary: string): string {
  return [
    `# ${spec.name}`,
    '',
    spec.purpose,
    '',
    '## Owns',
    '',
    ...spec.owns.map((g) => `- \`${g}\``),
    '',
    '## System context',
    '',
    systemSummary || '_Not recorded._',
    '',
    '---',
    '',
    '_This module\'s analyst did not complete. Re-run `swarm map` to survey it._',
    '',
  ].join('\n');
}

/**
 * Has the repository drifted since it was mapped? Cheap — no model call.
 * Used to prompt for a re-analysis when you return to a project.
 */
export async function detectDrift(workspace: Workspace): Promise<{
  drifted: boolean;
  changedModules: string[];
  mappedAt?: string;
  /** True when no fingerprint is on record, so drift cannot be ruled out. */
  unknown?: boolean;
}> {
  const state = await workspace.readState();
  const modules = await workspace.listModules();

  // No fingerprint is not the same as no change. A map written by an older
  // version, or one whose state was clobbered, cannot be compared — and
  // reporting "unchanged" there is a claim the data does not support.
  if (!state.digestHash) {
    return modules.length > 0
      ? { drifted: true, unknown: true, changedModules: modules.map((m) => m.slug) }
      : { drifted: false, changedModules: [] };
  }

  const digest = await buildDigest(workspace.repoRoot);
  const unanalysed = modules.filter((m) => (state.moduleHashes ?? {})[m.slug] === undefined);

  if (digest.hash === state.digestHash && unanalysed.length === 0) {
    return {
      drifted: false,
      changedModules: [],
      ...(state.mappedAt ? { mappedAt: state.mappedAt } : {}),
    };
  }

  const previous = state.moduleHashes ?? {};
  // A module with no recorded hash was never successfully analysed — it needs
  // work regardless of whether anything in the repository moved.
  const changed = modules
    .filter(
      (m) =>
        previous[m.slug] === undefined ||
        previous[m.slug] !== hashFiles(filesFor(digest, m.owns), digest.fingerprints),
    )
    .map((m) => m.slug);

  return {
    drifted: true,
    changedModules: changed,
    ...(state.mappedAt ? { mappedAt: state.mappedAt } : {}),
  };
}
