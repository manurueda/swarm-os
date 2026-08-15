import type { ModuleSpec } from '../../types.js';

/** Drop fingerprints for modules that no longer exist in the map. */
export function pruneStaleHashes(
  moduleHashes: Record<string, string>,
  finalModules: ModuleSpec[],
): Record<string, string> {
  const slugs = new Set(finalModules.map((m) => m.slug));
  return Object.fromEntries(Object.entries(moduleHashes).filter(([slug]) => slugs.has(slug)));
}
