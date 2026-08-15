/**
 * Get the module boundaries and system summary this run should use: either
 * fresh from the mapper agent, or the ones already on disk.
 */

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../../types.js';
import { mapRepository } from '../map.js';
import type { MapProgress } from './types.js';

export interface ResolvePartitionArgs {
  /** True to redraw boundaries; false to reuse the existing map. */
  partition: boolean;
  runtime: AgentRuntime;
  repoRoot: string;
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
  existingModules: ModuleSpec[];
  existingSystem: { summary: string; stack: string };
  report: (progress: MapProgress) => void;
}

export async function resolvePartition(
  args: ResolvePartitionArgs,
): Promise<{ modules: ModuleSpec[]; system: { summary: string; stack: string } }> {
  const { partition, runtime, repoRoot, model, onEvent, signal, existingModules, existingSystem, report } =
    args;

  if (!partition) {
    report({
      phase: 'partition',
      message: `reusing existing map (${existingModules.length} modules) — pass --repartition to redraw boundaries`,
    });
    return { modules: existingModules, system: existingSystem };
  }

  report({ phase: 'partition', message: 'proposing module boundaries from the digest' });
  const mapped = await mapRepository({
    runtime,
    repoRoot,
    ...(model ? { model } : {}),
    ...(onEvent ? { onEvent } : {}),
    ...(signal ? { signal } : {}),
  });
  report({
    phase: 'partition',
    message: `${mapped.modules.length} modules proposed: ${mapped.modules.map((m) => m.slug).join(', ')}`,
  });
  return { modules: mapped.modules, system: mapped.system };
}
