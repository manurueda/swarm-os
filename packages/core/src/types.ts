/**
 * Core domain types for Swarm OS.
 *
 * The vocabulary, from largest to smallest:
 *
 *   Project  — a repository Swarm OS has mapped. Owns a `.swarm/` directory.
 *   Module   — one domain of that project (editor, billing, rendering...).
 *              Has persistent, compressed memory that outlives any process.
 *   Swarm    — the agent team for one module. Either SLEEPING (zero processes,
 *              zero tokens, knowledge on disk) or ACTIVE (n live processes).
 *   Mission  — a goal. Routes to a subset of modules, wakes their swarms,
 *              spawns agents, harvests results, compresses memory, sleeps.
 *   Agent    — one runtime process with its own cwd, worktree, prompt,
 *              tool scope and session id.
 */

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export interface ModuleSpec {
  /** Stable kebab-case identifier, also the directory name under .swarm/modules. */
  slug: string;
  /** Human-facing name. */
  name: string;
  /** One or two sentences: what this domain is responsible for. */
  purpose: string;
  /** Globs this module owns. Used to scope agents and to police their diffs. */
  owns: string[];
  /** Notable files an agent should read first when waking into this module. */
  entryPoints: string[];
  /** Slugs of modules this one depends on. */
  dependsOn: string[];
  /** Rough size signal from the deterministic digest. */
  fileCount?: number;
}

export type SwarmState = 'sleeping' | 'waking' | 'active' | 'compressing';

export interface SwarmRecord {
  module: string;
  state: SwarmState;
  /** Mission id that last touched this swarm. */
  lastMission?: string;
  lastActiveAt?: string;
  /** Estimated size of memory.md, in tokens. The cost of keeping this swarm alive. */
  memoryTokens?: number;
  /** Claude session ids by agent role, so a swarm can be resumed rather than restarted. */
  sessions?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export type MissionStatus = 'planned' | 'running' | 'review' | 'done' | 'failed' | 'aborted';

export interface MissionRecord {
  id: string;
  goal: string;
  status: MissionStatus;
  createdAt: string;
  finishedAt?: string;
  /** Module slugs this mission routed to. */
  modules: string[];
  /** Per-agent ledger, keyed by agent id. */
  agents: Record<string, AgentLedgerEntry>;
}

export interface AgentLedgerEntry {
  role: string;
  module?: string;
  sessionId?: string;
  worktree?: string;
  ok?: boolean;
  usage?: UsageSnapshot;
  costUsd?: number;
  durationMs?: number;
  /** Files changed outside the module's owned globs. Empty is the happy path. */
  ownershipViolations?: string[];
}

/** How a mission decomposes across modules, produced by the router. */
export interface MissionPlan {
  summary: string;
  assignments: MissionAssignment[];
  /** Router's note on anything it could not route. */
  notes?: string;
}

export interface MissionAssignment {
  module: string;
  /** What this module's agent must accomplish. Self-contained — the agent
   *  never sees the other modules' code. */
  task: string;
  /** Why the router believes this module is involved. */
  rationale?: string;
}

// ---------------------------------------------------------------------------
// Agents & runtime
// ---------------------------------------------------------------------------

export type PermissionMode =
  | 'acceptEdits'
  | 'auto'
  | 'bypassPermissions'
  | 'manual'
  | 'dontAsk'
  | 'plan';

export interface AgentSpec {
  /** Unique within a mission. Used for display and for the event log. */
  id: string;
  /** lead | module | reviewer | mapper | router | compressor | ... */
  role: string;
  module?: string;
  /** The turn prompt. */
  prompt: string;
  /** Appended to Claude Code's system prompt — the agent's charter. */
  systemPrompt?: string;
  /**
   * REPLACES Claude Code's default system prompt instead of appending to it.
   *
   * The default prompt is mostly tool-use guidance and harness description. An
   * agent with no tools does not need any of it, so replacing it is a large
   * saving for the system tier (partitioner, router, compressor). Never use
   * this for an agent that has tools — it would lose the instructions that make
   * tool use work.
   */
  systemPromptOverride?: string;
  /** Working directory. Normally a git worktree. */
  cwd: string;
  /** Extra directories the agent may touch beyond cwd. */
  addDirs?: string[];
  /** Built-in tools to expose. Fewer tools = smaller system prompt = more room. */
  tools?: string[];
  model?: string;
  permissionMode?: PermissionMode;
  /** When set, the runtime demands structured output matching this JSON Schema. */
  jsonSchema?: unknown;
  /** Pin a session id so the swarm can resume this agent later. */
  sessionId?: string;
  /** Resume an existing session instead of starting cold. */
  resume?: string;
  /**
   * Lean mode (default true) strips the ambient environment — MCP servers,
   * skills, plugins, user settings — from the child process. Measured on
   * Claude Code 2.1.231: ~95k tokens of baseline overhead down to ~12k.
   * This is the single highest-leverage setting in Swarm OS.
   */
  lean?: boolean;
  /**
   * Which settings files the agent loads: '' (none), 'project', 'user,project',
   * etc. Defaults to '' under lean mode. Work agents operating inside a target
   * repo usually want 'project' so the repo's own permissions apply.
   */
  settingSources?: string;
  /** Skip writing a resumable transcript. Right for one-shot system agents. */
  ephemeral?: boolean;
  /** Hard ceiling for this agent, in equivalent USD. */
  maxBudgetUsd?: number;
}

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** inputTokens + cacheRead + cacheCreation — what actually occupied the window. */
  contextTokens: number;
  contextWindow?: number;
}

export interface RateLimitSnapshot {
  status: string;
  rateLimitType?: string;
  /** Unix seconds. */
  resetsAt?: number;
  isUsingOverage?: boolean;
}

// ---------------------------------------------------------------------------
// Normalized event stream
// ---------------------------------------------------------------------------

export type SwarmEvent =
  | { type: 'agent.start'; at: string; agentId: string; role: string; module?: string; sessionId: string; model?: string; cwd: string }
  | { type: 'agent.text'; at: string; agentId: string; text: string }
  | { type: 'agent.tool'; at: string; agentId: string; tool: string; summary: string }
  | { type: 'agent.tool_result'; at: string; agentId: string; tool: string; ok: boolean }
  | { type: 'agent.usage'; at: string; agentId: string; usage: UsageSnapshot }
  | { type: 'agent.done'; at: string; agentId: string; ok: boolean; result?: string; structured?: unknown; usage?: UsageSnapshot; costUsd?: number; durationMs?: number }
  | { type: 'agent.error'; at: string; agentId: string; message: string }
  | { type: 'ratelimit'; at: string; snapshot: RateLimitSnapshot }
  | { type: 'log'; at: string; level: 'info' | 'warn' | 'error'; message: string };

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export interface PreflightReport {
  ok: boolean;
  runtime: string;
  checks: PreflightCheck[];
}

export interface PreflightCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

// ---------------------------------------------------------------------------
// Runtime port
// ---------------------------------------------------------------------------

/**
 * The seam that keeps swarms, memory and missions independent of whichever
 * model sits underneath. `ClaudeCodeLocalRuntime` is the personal-mode
 * implementation (your subscription, your machine, no API keys). A product-mode
 * `ClaudeApiRuntime` or a `CodexRuntime` implements the same three methods.
 */
export interface AgentRuntime {
  readonly id: string;
  /** Verify the runtime can be used at all, and on which billing basis. */
  preflight(): Promise<PreflightReport>;
  /** Run one agent to completion, yielding normalized events as they arrive. */
  run(spec: AgentSpec, signal?: AbortSignal): AsyncIterable<SwarmEvent>;
}
