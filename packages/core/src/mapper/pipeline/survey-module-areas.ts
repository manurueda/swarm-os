/**
 * Give a structurally oversized module per-area memory.
 *
 * The trigger is structural, not measured: `detectAreas` finds enough real
 * sub-domains under the module's own paths. Memory doesn't factor in, on
 * purpose — this now runs before that module's analyst ever produces any, so
 * there is nothing yet to measure on a first map.
 *
 * This is the step that was once a closure inside `mapProject` capturing
 * seven outer variables, defined and never called. It takes every one of
 * those as an explicit argument now, specifically so a test can call it
 * directly and a missing call site in the orchestrator is visible.
 */

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../../types.js';
import { analyzeModule, renderMemory } from '../../swarm/analyst.js';
import { areaAsModule, detectAreas } from '../../swarm/areas.js';
import type { Scheduler } from '../../swarm/scheduler.js';
import type { Workspace } from '../../workspace/store.js';
import { areasWithMemory } from './areas-with-memory.js';
import type { MapProgress } from './types.js';

export interface SurveyModuleAreasArgs {
  runtime: AgentRuntime;
  workspace: Workspace;
  scheduler: Scheduler;
  spec: ModuleSpec;
  /** Every tracked file in the repo — areas are grouped from this. */
  repoFiles: string[];
  force: boolean;
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
  generatedAt: string;
  report: (progress: MapProgress) => void;
}

export interface SurveyModuleAreasResult {
  /** Slugs of the areas this module now has. Empty means it does not split. */
  areaNames: string[];
}

export async function surveyModuleAreas(args: SurveyModuleAreasArgs): Promise<SurveyModuleAreasResult> {
  const { runtime, workspace, scheduler, spec, repoFiles, force, model, onEvent, signal, generatedAt, report } =
    args;

  const areas = detectAreas(spec, repoFiles);
  // A module with nothing structural to split along loses whatever areas an
  // earlier, larger version of it once had.
  await workspace.pruneAreas(spec.slug, areas.map((a) => a.slug));
  if (areas.length === 0) return { areaNames: [] };

  const recorded = await areasWithMemory(workspace, spec.slug);
  const survey = force ? areas : areas.filter((a) => !recorded.has(a.slug));

  if (survey.length > 0) {
    report({
      phase: 'analyse',
      message: `splitting into ${areas.length} areas`,
      module: spec.slug,
    });

    const surveys = await scheduler.run(
      survey.map((area) => async () => {
        const { analysis } = await analyzeModule({
          runtime,
          repoRoot: workspace.repoRoot,
          module: areaAsModule(spec, area),
          siblings: areas
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

    for (const result of surveys) {
      if (result instanceof Error || !result) continue;
      await workspace.writeAreaFile(
        spec.slug,
        result.area.slug,
        'area.json',
        `${JSON.stringify(result.area, null, 2)}\n`,
      );
      await workspace.writeAreaFile(
        spec.slug,
        result.area.slug,
        'memory.md',
        renderMemory(areaAsModule(spec, result.area), result.analysis, generatedAt),
      );
    }
  }

  return { areaNames: areas.map((a) => a.slug) };
}
