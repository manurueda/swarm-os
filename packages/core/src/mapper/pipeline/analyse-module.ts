/**
 * Run one module's analyst and file what it found.
 *
 * This is the unit that used to be the middle of a `scheduler.run` closure
 * inside `mapProject`, capturing the runtime, the workspace, the digest, the
 * scheduler's own bookkeeping and more. None of that is needed to run one
 * module's analysis — only the module, its siblings, and where to write the
 * result.
 */

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../../types.js';
import { analyzeModule, renderCharter, renderMemory, type ModuleAnalysis } from '../../swarm/analyst.js';
import { estimateTokens, type Workspace } from '../../workspace/store.js';
import type { RepoDigest } from '../digest.js';
import { filesFor, hashFiles } from './module-files.js';
import type { ModuleAnalysisPlan } from './plan-module-analysis.js';
import { renderStructuralCharter } from './render-structural-charter.js';

export type ModuleAnalysisOutcome =
  | { status: 'failed'; spec: ModuleSpec; error: string }
  | {
      status: 'analysed';
      spec: ModuleSpec;
      analysis: ModuleAnalysis;
      memoryTokens: number;
      hash: string;
      costUsd?: number;
    };

export interface AnalyseModuleArgs {
  runtime: AgentRuntime;
  workspace: Workspace;
  digest: RepoDigest;
  entry: ModuleAnalysisPlan;
  siblings: Array<{ slug: string; purpose: string }>;
  systemSummary: string;
  /**
   * Slugs of this module's already-surveyed areas, when `surveyModuleAreas`
   * ran ahead of this call and found real sub-domains. Non-empty tells the
   * analyst per-area memory exists, so it should write cross-area facts only
   * — anything specific to one area belongs in that area's own memory.md.
   */
  areaNames?: string[];
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
  generatedAt: string;
}

export async function analyseModule(args: AnalyseModuleArgs): Promise<ModuleAnalysisOutcome> {
  const {
    runtime,
    workspace,
    digest,
    entry,
    siblings,
    systemSummary,
    areaNames,
    model,
    onEvent,
    signal,
    generatedAt,
  } = args;

  const { analysis, outcome } = await analyzeModule({
    runtime,
    repoRoot: workspace.repoRoot,
    module: entry.spec,
    siblings,
    systemSummary,
    // Passed as a field rather than appended to systemSummary. Two agents built
    // both ends of this in parallel and could not see each other: the mapper
    // smuggled it through the summary text because it had no way to know the
    // analyst was growing a real parameter for it. Now that both halves are
    // here, the summary goes back to being only the summary.
    ...(areaNames && areaNames.length > 0 ? { areaNames } : {}),
    ...(model ? { model } : {}),
    ...(onEvent ? { onEvent } : {}),
    ...(signal ? { signal } : {}),
  });

  if (!analysis) {
    // Write the structural spec so the module exists and can be retried, but
    // record no hash — the caller must never treat this as up to date.
    await workspace.writeModule(entry.spec, renderStructuralCharter(entry.spec, systemSummary));
    return {
      status: 'failed',
      spec: entry.spec,
      error: outcome.error ?? 'analyst returned no structured result',
    };
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

  await workspace.writeModule(spec, renderCharter(spec, analysis, systemSummary));
  const memory = renderMemory(spec, analysis, generatedAt);
  await workspace.writeModuleFile(spec.slug, 'memory.md', memory);

  const memoryTokens = estimateTokens(memory);
  const hash = analysis.correctedOwns ? hashFiles(ownedNow, digest.fingerprints) : entry.hash;

  return {
    status: 'analysed',
    spec,
    analysis,
    memoryTokens,
    hash,
    ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
  };
}

