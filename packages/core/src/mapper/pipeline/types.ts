/**
 * Shared shapes for the `swarm map` pipeline and its extracted steps.
 *
 * Kept apart from pipeline.ts so a step can depend on these types without
 * importing the orchestrator that assembles them — the orchestrator depends on
 * the steps, never the other way round.
 */

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../../types.js';
import type { OwnershipConflict } from '../../swarm/ownership.js';
import type { ModuleAnalysis } from '../../swarm/analyst.js';
import type { Workspace } from '../../workspace/store.js';
import type { SwarmConfig } from '../../workspace/config.js';

export type MapPhase = 'digest' | 'partition' | 'analyse' | 'synthesise';

export interface MapProgress {
  phase: MapPhase;
  message: string;
  /** Present during the analyse phase. */
  module?: string;
  done?: number;
  total?: number;
}

export interface MapModuleResult {
  spec: ModuleSpec;
  status: 'analysed' | 'reused' | 'failed';
  analysis?: ModuleAnalysis;
  memoryTokens?: number;
  error?: string;
  costUsd?: number;
}

export interface MapResult {
  repoName: string;
  totalFiles: number;
  modules: MapModuleResult[];
  system: { summary: string; stack: string };
  /** True when the partition step ran; false when an existing map was reused. */
  repartitioned: boolean;
  digestHash: string;
  costUsd: number;
  /** Combined size of every module's memory — the cost of keeping this repo mapped. */
  totalMemoryTokens: number;
  /** Modules moved to `.swarm/archive/` because the map no longer has them. */
  archived: string[];
  /** Module slug -> number of areas its memory was split into. */
  areas: Record<string, number>;
  /** Modules claiming the same files, decided against the real file list. */
  conflicts: OwnershipConflict[];
}

export interface MapProjectOptions {
  runtime: AgentRuntime;
  workspace: Workspace;
  config: SwarmConfig;
  /** Re-partition and re-analyse everything, discarding the existing map. */
  force?: boolean;
  /** Re-partition boundaries but keep memory where module slugs survive. */
  repartition?: boolean;
  onProgress?: (progress: MapProgress) => void;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}
