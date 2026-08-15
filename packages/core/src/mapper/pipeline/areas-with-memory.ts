import type { Workspace } from '../../workspace/store.js';

/** Areas of a module that already hold knowledge worth not overwriting. */
export async function areasWithMemory(workspace: Workspace, slug: string): Promise<Set<string>> {
  const recorded = new Set<string>();
  for (const area of await workspace.listAreas(slug)) {
    if ((await workspace.readAreaFile(slug, area)).trim()) recorded.add(area);
  }
  return recorded;
}
