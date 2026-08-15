/**
 * The last step of a sleep: rewrite the module memory file, if there is a new
 * one, and record the swarm as sleeping.
 */

import type { SwarmRecord } from '../types.js';
import type { Workspace } from '../workspace/store.js';

export async function writeMemoryAndUpdateState(
  workspace: Workspace,
  slug: string,
  /** New module memory text to write, or `undefined` to leave it unchanged. */
  moduleMemory: string | undefined,
  memoryTokens: number,
): Promise<SwarmRecord> {
  if (moduleMemory !== undefined) {
    await workspace.writeModuleFile(slug, 'memory.md', moduleMemory);
  }
  return workspace.updateSwarm(slug, {
    state: 'sleeping',
    memoryTokens,
    lastActiveAt: new Date().toISOString(),
  });
}
