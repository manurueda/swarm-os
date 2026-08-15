import type { ModuleSpec } from '../../types.js';
import type { Workspace } from '../../workspace/store.js';

/** Module slug -> number of areas its memory was split into. Modules with no split are omitted. */
export async function countAreasByModule(
  workspace: Workspace,
  finalModules: ModuleSpec[],
): Promise<Record<string, number>> {
  const pairs = await Promise.all(
    finalModules.map(async (m) => [m.slug, (await workspace.listAreas(m.slug)).length] as const),
  );
  return Object.fromEntries(pairs.filter(([, n]) => n > 0));
}
