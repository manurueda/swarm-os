import type { ModuleSpec } from '../../types.js';
import type { Workspace } from '../../workspace/store.js';
import type { RepoDigest } from '../digest.js';
import { renderSystemMap } from '../map.js';

export async function synthesiseSystemMap(
  workspace: Workspace,
  system: { summary: string; stack: string },
  finalModules: ModuleSpec[],
  digest: RepoDigest,
  verifyCommandMessage?: string,
): Promise<void> {
  await workspace.writeSystem(renderSystemMap(system, finalModules, digest, verifyCommandMessage));
}
