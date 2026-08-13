/**
 * Swarm OS core.
 *
 * An orchestration layer over locally installed coding agents. It exists to
 * make large repositories workable by never loading one into a single context
 * window: the repo is partitioned into modules, each module keeps compressed
 * durable memory on disk, and a mission wakes only the modules it touches.
 *
 * Nothing here knows which model is underneath. `AgentRuntime` is the seam.
 */

export * from './types.js';

// Runtime adapters
export { ClaudeCodeLocalRuntime } from './runtime/claude-code-local.js';
export type { ClaudeCodeLocalOptions, AuthStatus } from './runtime/claude-code-local.js';
export { collectAgent, sumUsage } from './runtime/collect.js';
export type { AgentOutcome } from './runtime/collect.js';
export {
  scrubEnv,
  detectBillingEnv,
  BILLING_ENV_VARS,
  NESTING_ENV_VARS,
} from './runtime/env.js';
export { NdjsonBuffer, translate, tryParseJson } from './runtime/stream-json.js';
export { standaloneSystemPrompt, standaloneAgentPrompt } from './runtime/system-tier.js';

// Self-update
export {
  detectInstall,
  checkForUpdate,
  applyUpdate,
  backgroundUpdate,
  readUpdateStatus,
  writeUpdateStatus,
  isCheckDue,
  updatesDisabled,
  stateDir,
  CHECK_INTERVAL_MS,
} from './update/index.js';
export type { InstallInfo, InstallKind, UpdateStatus, ApplyResult } from './update/index.js';

// Workspace
export { Workspace, SWARM_DIR, estimateTokens } from './workspace/store.js';
export type { ModuleFile } from './workspace/store.js';
export { DEFAULT_CONFIG, parseConfig, serializeConfig } from './workspace/config.js';
export type { SwarmConfig } from './workspace/config.js';

// Mapping
export { buildDigest, renderDigest } from './mapper/digest.js';
export type { RepoDigest } from './mapper/digest.js';
export { mapRepository, renderSystemMap, MODULE_MAP_SCHEMA } from './mapper/map.js';
export { mapProject, detectDrift } from './mapper/pipeline.js';
export type { MapResult, MapProgress, MapModuleResult, MapPhase } from './mapper/pipeline.js';

// Swarms
export { analyzeModule, renderCharter, renderMemory, renderClaim, parseClaimLine } from './swarm/analyst.js';
export type { ModuleAnalysis, Claim } from './swarm/analyst.js';
export {
  verifyModule,
  extractClaims,
  checkCitation,
  renderVerification,
  VERIFY_SCHEMA,
} from './swarm/verify.js';
export type { ModuleVerification, ClaimVerification, Verdict } from './swarm/verify.js';
export { buildContextPack, wakeSwarm, sleepSwarm, sleepAll } from './swarm/manager.js';
export type { ContextPack, SleepResult } from './swarm/manager.js';
export { checkOwnership, isOwned, matchesGlob, findOwnershipConflicts } from './swarm/ownership.js';
export type { OwnershipReport, OwnershipConflict } from './swarm/ownership.js';
export { Scheduler } from './swarm/scheduler.js';

// Missions
export { routeMission, renderPlan, ROUTE_SCHEMA } from './mission/route.js';
export { runMission, missionId, WORK_REPORT_SCHEMA } from './mission/run.js';
export type {
  MissionResult,
  MissionModuleResult,
  MissionProgress,
  RunMissionOptions,
  WorkReport,
} from './mission/run.js';

// Git
export {
  git,
  isGitRepo,
  currentBranch,
  isWorkingTreeClean,
  createWorktree,
  removeWorktree,
  pruneWorktrees,
  changedFiles,
  diffStat,
  commitAll,
} from './git/worktree.js';
export type { WorktreeHandle } from './git/worktree.js';
