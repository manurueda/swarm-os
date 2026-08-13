/**
 * Environment hygiene for spawned agents.
 *
 * Two independent problems, both solved here:
 *
 * 1. BILLING. Claude Code prefers `ANTHROPIC_API_KEY` over your subscription
 *    when both are present. A stray key in the parent shell would silently move
 *    every agent onto pay-per-token API billing. Swarm OS strips those
 *    variables from every child, so agents always resolve to the subscription
 *    credentials that `claude auth login` put in the OS keychain.
 *
 * 2. NESTING. When Swarm OS is itself launched from inside a Claude Code
 *    session, the parent exports CLAUDE_CODE_* coordination variables. Children
 *    inheriting them try to join the parent's session plumbing. Stripped too.
 *
 * Swarm OS never reads, stores or transmits a credential. It only removes them.
 */

/** Variables that would divert an agent off the subscription onto API billing. */
export const BILLING_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'AWS_BEARER_TOKEN_BEDROCK',
] as const;

/** Parent-session coordination variables that must not leak into children. */
export const NESTING_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_CONFIG_DIR',
] as const;

export interface ScrubResult {
  env: NodeJS.ProcessEnv;
  /** Names (never values) of billing variables that were present and removed. */
  removedBilling: string[];
  removedNesting: string[];
}

/**
 * Produce a clean environment for an agent process.
 * Returns variable *names* only — values are dropped on the floor, never logged.
 */
export function scrubEnv(source: NodeJS.ProcessEnv = process.env): ScrubResult {
  const env: NodeJS.ProcessEnv = { ...source };
  const removedBilling: string[] = [];
  const removedNesting: string[] = [];

  for (const name of BILLING_ENV_VARS) {
    if (env[name] !== undefined) {
      removedBilling.push(name);
      delete env[name];
    }
  }
  for (const name of NESTING_ENV_VARS) {
    if (env[name] !== undefined) {
      removedNesting.push(name);
      delete env[name];
    }
  }

  // Agents are non-interactive; make that explicit so nothing waits on a TTY.
  env['CI'] = env['CI'] ?? '1';

  return { env, removedBilling, removedNesting };
}

/** Names of billing variables currently set in the parent shell. */
export function detectBillingEnv(source: NodeJS.ProcessEnv = process.env): string[] {
  return BILLING_ENV_VARS.filter((name) => {
    const v = source[name];
    return v !== undefined && v !== '';
  });
}
