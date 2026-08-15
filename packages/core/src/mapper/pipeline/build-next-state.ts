import type { ModuleSpec, SwarmRecord } from '../../types.js';
import type { StateFile } from '../../workspace/store.js';
import type { MapModuleResult } from './types.js';

/**
 * The `state.json` this run leaves behind.
 *
 * Every module starts asleep — mapping never leaves an agent process running
 * — and any swarm record for a module that dropped out of the map goes with
 * it.
 */
export function buildNextState(
  state: StateFile,
  digestHash: string,
  moduleHashes: Record<string, string>,
  system: { summary: string; stack: string },
  finalModules: ModuleSpec[],
  mappedAt: string,
  results: Map<string, MapModuleResult>,
): StateFile {
  const finalSlugs = new Set(finalModules.map((m) => m.slug));
  const swarms: Record<string, SwarmRecord> = {};
  for (const [slug, record] of Object.entries(state.swarms)) {
    if (finalSlugs.has(slug)) swarms[slug] = record;
  }

  for (const spec of finalModules) {
    const current = swarms[spec.slug];
    swarms[spec.slug] = {
      module: spec.slug,
      state: 'sleeping',
      memoryTokens: results.get(spec.slug)?.memoryTokens ?? current?.memoryTokens ?? 0,
      ...(current?.lastMission ? { lastMission: current.lastMission } : {}),
      ...(current?.lastActiveAt ? { lastActiveAt: current.lastActiveAt } : {}),
    };
  }

  return {
    ...state,
    swarms,
    mappedAt,
    digestHash,
    moduleHashes,
    system,
  };
}
