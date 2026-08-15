import type { ModuleSpec } from '../../types.js';
import type { MapModuleResult } from './types.js';

/** The spec each proposed module ends this run with: the analysed one where an analyst ran, else the original. */
export function resolveFinalModules(
  modules: ModuleSpec[],
  results: Map<string, MapModuleResult>,
): ModuleSpec[] {
  return modules.map((m) => results.get(m.slug)?.spec ?? m);
}
