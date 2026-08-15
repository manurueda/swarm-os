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
 *
 * mapProject itself is only an orchestrator: every decision below lives in its
 * own file under `pipeline/`, taking its dependencies as explicit arguments
 * rather than closing over this function's locals. That is what lets each one
 * be tested — and what makes a step that is defined but never called visible:
 * it shows up as a file nothing else imports, not as dead code buried in a
 * closure.
 */

import type { SwarmEvent } from '../types.js';
import { findOwnershipConflicts } from '../swarm/ownership.js';
import { Scheduler } from '../swarm/scheduler.js';
import { detectAreas, planAreas } from '../swarm/areas.js';
import { Workspace, estimateTokens } from '../workspace/store.js';
import type { SwarmConfig } from '../workspace/config.js';
import { buildDigest } from './digest.js';
import { areasWithMemory } from './pipeline/areas-with-memory.js';
import { analyseModule } from './pipeline/analyse-module.js';
import { archiveStaleModules } from './pipeline/archive-stale-modules.js';
import { buildNextState } from './pipeline/build-next-state.js';
import { countAreasByModule } from './pipeline/count-areas-by-module.js';
import { filesFor, hashFiles } from './pipeline/module-files.js';
import { loadReusedModuleResult } from './pipeline/load-reused-module.js';
import { orderModuleResults } from './pipeline/order-module-results.js';
import { planModuleAnalysis } from './pipeline/plan-module-analysis.js';
import { pruneStaleHashes } from './pipeline/prune-stale-hashes.js';
import { recordModuleProgress } from './pipeline/record-module-progress.js';
import { resolveFinalModules } from './pipeline/resolve-final-modules.js';
import { resolvePartition } from './pipeline/resolve-partition.js';
import { createSerialQueue } from './pipeline/serial-queue.js';
import { shouldPartition as decidePartition } from './pipeline/should-partition.js';
import { surveyModuleAreas } from './pipeline/survey-module-areas.js';
import { synthesiseSystemMap } from './pipeline/synthesise-system-map.js';
import type { MapModuleResult, MapProgress, MapProjectOptions, MapResult } from './pipeline/types.js';

export type { MapPhase, MapProgress, MapModuleResult, MapResult, MapProjectOptions } from './pipeline/types.js';

/**
 * Modules whose memory has outgrown what every agent should have to load, and
 * which have not been split by area yet.
 *
 * `swarm map` stops at "already mapped and unchanged" when the file
 * fingerprints match. But memory grows from missions, not from files, so a
 * module can cross its load budget without a single file changing — and the one
 * command able to split it would then decline to run on exactly the repositories
 * that need it. Deterministic and free: no agent, just the digest and what is
 * already on disk.
 */
export async function pendingSplits(
  workspace: Workspace,
  config: SwarmConfig,
): Promise<string[]> {
  const digest = await buildDigest(workspace.repoRoot);
  const pending: string[] = [];

  for (const spec of await workspace.listModules()) {
    const recorded = await areasWithMemory(workspace, spec.slug);
    const areaPlan = planAreas({
      areas: detectAreas(spec, digest.files),
      memoryTokens: estimateTokens(await workspace.readModuleFile(spec.slug, 'memory.md')),
      budgetTokens: config.memoryBudgetTokens,
      hasMemory: (slug) => recorded.has(slug),
    });
    if (areaPlan.survey.length > 0) pending.push(spec.slug);
  }

  return pending;
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
  const partition = decidePartition(options, existing.length);

  // -- 2. Partition ---------------------------------------------------------
  const { modules, system } = await resolvePartition({
    partition,
    runtime,
    repoRoot: workspace.repoRoot,
    ...(config.systemModel ? { model: config.systemModel } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    existingModules: existing,
    existingSystem: state.system ?? { summary: '', stack: '' },
    report,
  });

  // Repartitioning changes the slug set. Old module directories left behind
  // would be returned by listModules() alongside the new ones.
  const archived: string[] = partition
    ? await archiveStaleModules(workspace, modules, new Date().toISOString().slice(0, 10), report)
    : [];

  // -- 3. Analyse -----------------------------------------------------------
  const previousHashes = state.moduleHashes ?? {};
  const siblings = modules.map((m) => ({ slug: m.slug, purpose: m.purpose }));

  const plan = modules.map((spec) => planModuleAnalysis(digest, spec, previousHashes, options.force === true));

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
    results.set(entry.spec.slug, await loadReusedModuleResult(workspace, entry));
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
  const moduleHashes: Record<string, string> = { ...previousHashes };
  const stateQueue = createSerialQueue();

  await scheduler.run(
    toAnalyse.map((entry) => async () => {
      report({
        phase: 'analyse',
        message: 'surveying',
        module: entry.spec.slug,
        done,
        total: toAnalyse.length,
      });

      const outcome = await analyseModule({
        runtime,
        workspace,
        digest,
        entry,
        siblings: siblings.filter((s) => s.slug !== entry.spec.slug),
        systemSummary: system.summary,
        ...(config.systemModel ? { model: config.systemModel } : {}),
        onEvent: forward,
        ...(options.signal ? { signal: options.signal } : {}),
        generatedAt,
      });

      done += 1;

      // Persist the moment this analyst returns, not after all of them do.
      // A long map on a large repo is then durable and inspectable while it
      // runs, and an interrupted one keeps every module that finished.
      if (outcome.status === 'failed') {
        report({
          phase: 'analyse',
          message: 'survey failed',
          module: entry.spec.slug,
          done,
          total: toAnalyse.length,
        });
        // Drop any hash this module carried from an earlier map. Inheriting one
        // makes the next run consider it up to date, so a module that failed is
        // never retried until something else in it happens to change.
        delete moduleHashes[entry.spec.slug];
        results.set(entry.spec.slug, { spec: outcome.spec, status: 'failed', error: outcome.error });
        return;
      }

      moduleHashes[outcome.spec.slug] = outcome.hash;
      costUsd += outcome.costUsd ?? 0;
      await recordModuleProgress(workspace, stateQueue, outcome.spec.slug, outcome.hash, outcome.memoryTokens);

      results.set(outcome.spec.slug, {
        spec: outcome.spec,
        status: 'analysed',
        analysis: outcome.analysis,
        memoryTokens: outcome.memoryTokens,
        ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
      });

      report({
        phase: 'analyse',
        message: 'surveyed',
        module: outcome.spec.slug,
        done,
        total: toAnalyse.length,
      });
    }),
  );

  const finalModules = resolveFinalModules(modules, results);

  // -- 3b. Areas ------------------------------------------------------------
  // Over EVERY module, not only the ones just re-analysed. A module that is
  // over its load budget and has not changed is exactly the one that needs
  // splitting, and the incremental path skips it by definition — which is how
  // this step could be written, wired at both ends, and never once run.
  //
  // Sequentially, because surveyModuleAreas fans its own areas out across the
  // scheduler; overlapping those pools would exceed maxConcurrentAgents.
  for (const spec of finalModules) {
    const known = results.get(spec.slug)?.memoryTokens;
    const memoryTokens =
      known ?? estimateTokens(await workspace.readModuleFile(spec.slug, 'memory.md'));
    await surveyModuleAreas({
      runtime,
      workspace,
      scheduler,
      spec,
      memoryTokens,
      budgetTokens: config.memoryBudgetTokens,
      repoFiles: digest.files,
      force: options.force === true,
      ...(config.systemModel ? { model: config.systemModel } : {}),
      onEvent: forward,
      ...(options.signal ? { signal: options.signal } : {}),
      generatedAt,
      report,
    });
  }

  // -- 4. Synthesise --------------------------------------------------------
  report({ phase: 'synthesise', message: 'writing system map' });
  await synthesiseSystemMap(workspace, system, finalModules, digest);

  // Prune hashes for modules that no longer exist.
  const finalHashes = pruneStaleHashes(moduleHashes, finalModules);

  const mappedAt = new Date().toISOString();
  const nextState = buildNextState(state, digest.hash, finalHashes, system, finalModules, mappedAt, results);
  await workspace.writeState(nextState);

  const ordered = orderModuleResults(finalModules, results);

  return {
    repoName: digest.repoName,
    totalFiles: digest.totalFiles,
    modules: ordered,
    system,
    repartitioned: partition,
    digestHash: digest.hash,
    costUsd,
    totalMemoryTokens: ordered.reduce((sum, m) => sum + (m.memoryTokens ?? 0), 0),
    conflicts: findOwnershipConflicts(finalModules, digest.files),
    archived,
    areas: await countAreasByModule(workspace, finalModules),
  };
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
