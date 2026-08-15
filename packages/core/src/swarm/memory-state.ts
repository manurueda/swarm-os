/**
 * A module's memory file, and how big it currently is.
 */

import { estimateTokens, type Workspace } from '../workspace/store.js';

export interface MemoryState {
  before: string;
  beforeTokens: number;
}

export async function readMemoryState(workspace: Workspace, slug: string): Promise<MemoryState> {
  const before = await workspace.readModuleFile(slug, 'memory.md');
  return { before, beforeTokens: estimateTokens(before) };
}
