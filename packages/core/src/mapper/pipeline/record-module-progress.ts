import type { Workspace } from '../../workspace/store.js';
import type { SerialQueue } from './serial-queue.js';

/**
 * Fold one module's analysis result into `state.json`, serialized through
 * `queue` so concurrent analysts never race the same read-modify-write.
 */
export function recordModuleProgress(
  workspace: Workspace,
  queue: SerialQueue,
  slug: string,
  hash: string,
  memoryTokens: number,
): Promise<void> {
  return queue.run(async () => {
    const current = await workspace.readState();
    current.moduleHashes = { ...(current.moduleHashes ?? {}), [slug]: hash };
    current.swarms[slug] = { module: slug, state: 'sleeping', memoryTokens };
    await workspace.writeState(current);
  });
}
