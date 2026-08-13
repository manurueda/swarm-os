/**
 * Resolving the pieces every command needs: which repository, which runtime,
 * which configuration.
 */

import { resolve } from 'node:path';

import {
  ClaudeCodeLocalRuntime,
  DEFAULT_CONFIG,
  Workspace,
  type AgentRuntime,
  type SwarmConfig,
} from '@swarm-os/core';

import { flagNumber, flagString, type ParsedArgs } from './args.js';

export class UserError extends Error {}

export interface CommandContext {
  workspace: Workspace;
  runtime: AgentRuntime;
  config: SwarmConfig;
}

/** Locate the project: an explicit path, else the nearest mapped ancestor, else cwd. */
export function resolveWorkspace(args: ParsedArgs, explicitPath?: string): Workspace {
  const target = explicitPath ?? flagString(args.flags, 'repo');
  if (target) return new Workspace(resolve(target));
  return Workspace.find(process.cwd()) ?? new Workspace(process.cwd());
}

export function buildRuntime(config: SwarmConfig, args: ParsedArgs): AgentRuntime {
  if (config.runtime !== 'claude-code-local') {
    throw new UserError(
      `runtime "${config.runtime}" is not implemented yet. ` +
        `Personal mode uses "claude-code-local"; edit .swarm/config.yaml to change it.`,
    );
  }
  return new ClaudeCodeLocalRuntime({
    ...(flagString(args.flags, 'claude-bin') ? { bin: flagString(args.flags, 'claude-bin') as string } : {}),
    defaultModel: config.model,
    // `swarm doctor` reports on API keys; commands that spawn agents refuse.
    strictSubscription: true,
  });
}

/** Apply command-line overrides on top of the project's config. */
export function applyOverrides(config: SwarmConfig, args: ParsedArgs): SwarmConfig {
  const model = flagString(args.flags, 'model');
  const systemModel = flagString(args.flags, 'system-model');
  const concurrency = flagNumber(args.flags, 'concurrency');
  const budget = flagNumber(args.flags, 'memory-budget');
  const permissionMode = flagString(args.flags, 'permission-mode');

  return {
    ...config,
    ...(model ? { model } : {}),
    ...(systemModel ? { systemModel } : {}),
    ...(concurrency !== undefined ? { maxConcurrentAgents: Math.max(1, concurrency) } : {}),
    ...(budget !== undefined ? { memoryBudgetTokens: Math.max(200, budget) } : {}),
    ...(permissionMode ? { permissionMode } : {}),
  };
}

export async function loadContext(
  args: ParsedArgs,
  options: { requireMapped?: boolean; explicitPath?: string } = {},
): Promise<CommandContext> {
  const workspace = resolveWorkspace(args, options.explicitPath);

  if (options.requireMapped && !workspace.exists) {
    throw new UserError(
      `no Swarm OS project here (${workspace.repoRoot}).\n` +
        `Run \`swarm map\` inside the repository you want to work on.`,
    );
  }

  const config = applyOverrides(
    workspace.exists ? await workspace.readConfig() : { ...DEFAULT_CONFIG },
    args,
  );
  const runtime = buildRuntime(config, args);
  return { workspace, runtime, config };
}

/**
 * Refuse to spawn agents when preflight fails. This is where the subscription
 * guarantee is enforced: an API key in the environment stops the command rather
 * than quietly running up a bill.
 */
export async function assertRuntimeReady(runtime: AgentRuntime): Promise<void> {
  const report = await runtime.preflight();
  if (report.ok) return;
  const failures = report.checks.filter((c) => c.status === 'fail');
  throw new UserError(
    [
      'runtime preflight failed:',
      ...failures.map((f) => `  ${f.name}: ${f.detail}`),
      '',
      'Run `swarm doctor` for the full report.',
    ].join('\n'),
  );
}
