/**
 * Filing the compressor's `## Area: <slug>` sections into their area memory
 * files, ahead of the module file being rewritten.
 *
 * Done before the module file is written so a crash between the two loses
 * nothing that was not already on disk.
 */

import type { Workspace } from '../workspace/store.js';
import { mergeAreaMemory } from './area-memory.js';

export async function fileAreaSections(
  workspace: Workspace,
  slug: string,
  areas: Record<string, string>,
  areaSlugs: string[],
): Promise<void> {
  for (const [area, text] of Object.entries(areas)) {
    // Never invent an area. A slug the compressor made up would create a
    // memory file no context pack ever indexes, i.e. knowledge written to a
    // place nothing reads.
    if (!areaSlugs.includes(area)) continue;
    const existing = await workspace.readAreaFile(slug, area);
    await workspace.writeAreaFile(slug, area, 'memory.md', mergeAreaMemory(existing, text));
  }
}
