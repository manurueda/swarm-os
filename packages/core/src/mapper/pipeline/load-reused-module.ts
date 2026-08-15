import { estimateTokens, type Workspace } from '../../workspace/store.js';
import type { ModuleAnalysisPlan } from './plan-module-analysis.js';
import type { MapModuleResult } from './types.js';

/** A module whose fingerprint is unchanged: its memory is preserved, not re-read by an analyst. */
export async function loadReusedModuleResult(
  workspace: Workspace,
  entry: ModuleAnalysisPlan,
): Promise<MapModuleResult> {
  const memory = await workspace.readModuleFile(entry.spec.slug, 'memory.md');
  return { spec: entry.spec, status: 'reused', memoryTokens: estimateTokens(memory) };
}
