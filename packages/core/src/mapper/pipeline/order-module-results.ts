import type { ModuleSpec } from '../../types.js';
import type { MapModuleResult } from './types.js';

/** Every final module's result, in map order, defaulting to 'failed' for one that was never processed. */
export function orderModuleResults(
  finalModules: ModuleSpec[],
  results: Map<string, MapModuleResult>,
): MapModuleResult[] {
  return finalModules.map(
    (m) => results.get(m.slug) ?? { spec: m, status: 'failed' as const, error: 'not processed' },
  );
}
