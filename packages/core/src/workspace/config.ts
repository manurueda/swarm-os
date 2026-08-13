import { parse, stringify } from 'yaml';

/**
 * Project-level configuration, stored at `.swarm/config.yaml` inside the target
 * repository. Committed on purpose: any machine that clones the repo inherits
 * the same module map and the same concurrency policy.
 *
 * Contains no credentials and no machine-specific paths.
 */
export interface SwarmConfig {
  version: 1;
  /** Runtime adapter id. Personal mode is `claude-code-local`. */
  runtime: string;
  /** Model for work agents. */
  model: string;
  /** Cheaper model for routing, mapping and memory compression. */
  systemModel: string;
  /**
   * How many agent processes may run at once. Subscription quota is shared
   * across all of them, so this is a real budget, not a performance knob.
   */
  maxConcurrentAgents: number;
  /** Hard ceiling on each module's memory.md. Sleeping swarms must stay cheap. */
  memoryBudgetTokens: number;
  /** Permission mode for work agents. */
  permissionMode: string;
  /** Where per-agent git worktrees are created, relative to the repo root. */
  worktreeRoot: string;
  /** Built-in tools work agents may use. */
  tools: string[];
  /** Pause spawning when the subscription rate limit reports this status. */
  pauseOnRateLimitStatus: string[];
}

export const DEFAULT_CONFIG: SwarmConfig = {
  version: 1,
  runtime: 'claude-code-local',
  model: 'sonnet',
  systemModel: 'sonnet',
  maxConcurrentAgents: 3,
  memoryBudgetTokens: 2000,
  permissionMode: 'acceptEdits',
  worktreeRoot: '.swarm/worktrees',
  tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
  pauseOnRateLimitStatus: ['rejected', 'blocked'],
};

export function parseConfig(text: string): SwarmConfig {
  const raw: unknown = parse(text);
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...(raw as Partial<SwarmConfig>), version: 1 };
}

export function serializeConfig(config: SwarmConfig): string {
  return [
    '# Swarm OS project configuration.',
    '# Safe to commit — contains no credentials. Authentication is delegated',
    '# entirely to `claude auth` on each developer machine.',
    '',
    stringify(config),
  ].join('\n');
}
