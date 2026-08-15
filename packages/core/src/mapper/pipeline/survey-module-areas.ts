/**
 * Give an oversized module per-area memory.
 *
 * The trigger is the module's memory saturating its budget while covering
 * several sub-domains — the measured condition where each sub-domain gets
 * ~170 tokens and an agent loads mostly things it will never touch.
 *
 * This is the step that was once a closure inside `mapProject` capturing
 * seven outer variables, defined and never called. It takes every one of
 * those as an explicit argument now, specifically so a test can call it
 * directly and a missing call site in the orchestrator is visible.
 */

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../../types.js';
import { analyzeModule, renderMemory } from '../../swarm/analyst.js';
import { areaAsModule, detectAreas, planAreas } from '../../swarm/areas.js';
import type { Scheduler } from '../../swarm/scheduler.js';
import type { Workspace } from '../../workspace/store.js';
import { areasWithMemory } from './areas-with-memory.js';
import type { MapProgress } from './types.js';

export interface SurveyModuleAreasArgs {
  runtime: AgentRuntime;
  workspace: Workspace;
  scheduler: Scheduler;
  spec: ModuleSpec;
  memoryTokens: number;
  budgetTokens: number;
  /** Every tracked file in the repo — areas are grouped from this. */
  repoFiles: string[];
  force: boolean;
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
  generatedAt: string;
  report: (progress: MapProgress) => void;
}

export async function surveyModuleAreas(args: SurveyModuleAreasArgs): Promise<void> {
  const {
    runtime,
    workspace,
    scheduler,
    spec,
    memoryTokens,
    budgetTokens,
    repoFiles,
    force,
    model,
    onEvent,
    signal,
    generatedAt,
    report,
  } = args;

  const recorded = await areasWithMemory(workspace, spec.slug);
  const areaPlan = planAreas({
    areas: detectAreas(spec, repoFiles),
    memoryTokens,
    budgetTokens,
    hasMemory: (slug) => recorded.has(slug),
    ...(force ? { force: true } : {}),
  });

  await workspace.pruneAreas(spec.slug, areaPlan.keep.map((a) => a.slug));
  if (areaPlan.survey.length === 0) return;

  report({
    phase: 'analyse',
    message: `splitting into ${areaPlan.keep.length} areas`,
    module: spec.slug,
  });

  const surveys = await scheduler.run(
    areaPlan.survey.map((area) => async () => {
      const { analysis } = await analyzeModule({
        runtime,
        repoRoot: workspace.repoRoot,
        module: areaAsModule(spec, area),
        siblings: areaPlan.keep
          .filter((a) => a.slug !== area.slug)
          .map((a) => ({ slug: a.slug, purpose: `the ${a.slug} area (${a.path})` })),
        systemSummary: spec.purpose,
        ...(model ? { model } : {}),
        ...(onEvent ? { onEvent } : {}),
        ...(signal ? { signal } : {}),
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
}
