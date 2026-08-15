/**
 * Move module directories that repartitioning has dropped out of the way.
 *
 * Left behind, they would keep showing up in `workspace.listModules()`
 * alongside the new map.
 */

import type { ModuleSpec } from '../../types.js';
import type { Workspace } from '../../workspace/store.js';
import type { MapProgress } from './types.js';

export async function archiveStaleModules(
  workspace: Workspace,
  modules: ModuleSpec[],
  label: string,
  report: (progress: MapProgress) => void,
): Promise<string[]> {
  const archived = await workspace.archiveModulesNotIn(
    modules.map((m) => m.slug),
    label,
  );
  if (archived.length > 0) {
    report({
      phase: 'partition',
      message: `archived ${archived.length} module(s) no longer in the map: ${archived.join(', ')}`,
    });
  }
  return archived;
}
