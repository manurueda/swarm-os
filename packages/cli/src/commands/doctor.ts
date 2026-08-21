/**
 * `swarm doctor` — is this machine ready, and on what billing basis?
 *
 * The billing question is the important one. Claude Code silently prefers an
 * API key over your subscription, so a stray `ANTHROPIC_API_KEY` turns a swarm
 * of a dozen agents into a metered bill. This command answers it plainly.
 */

import {
  ClaudeCodeLocalRuntime,
  detectBillingEnv,
  detectDrift,
  detectVerifyCommand,
  isGitRepo,
  type PreflightCheck,
  type VerifyCommandDetection,
} from '@swarm-os/core';

import type { ParsedArgs } from '../args.js';
import { flagBool } from '../args.js';
import { loadContext } from '../context.js';
import { c, heading, line, note, symbols, table } from '../ui.js';

/**
 * An empty `verifyCommand` silently disables the whole mission verify loop —
 * no build, no test, no gate. Pulled out as plain strings so the wording can
 * be pinned without driving a full `doctorCommand` run or touching the
 * filesystem `detectVerifyCommand` reads from.
 */
export function verifyCommandCheckLines(detection: VerifyCommandDetection): string[] {
  const lines = [
    'no verifyCommand set — the mission verify loop is disabled',
    "  no build, no test, no gate: an unattended mission merges on the reviewer's word alone.",
  ];
  if (detection.command) {
    lines.push(`  detected: ${detection.command} (${detection.reason})`);
    lines.push('  set it with `verifyCommand:` in .swarm/config.yaml, or re-run `swarm map` to accept it.');
  } else {
    lines.push('  nothing detected — set `verifyCommand:` in .swarm/config.yaml, or re-run `swarm map`.');
  }
  return lines;
}

export async function doctorCommand(args: ParsedArgs): Promise<number> {
  const { workspace, runtime, config } = await loadContext(args);

  heading('Runtime');
  const report = await runtime.preflight();
  for (const check of report.checks) renderCheck(check);

  heading('Billing');
  const billingVars = detectBillingEnv();
  if (billingVars.length === 0) {
    line(`${c.green(symbols.active)} Claude subscription — no per-token API charges`);
    note('  Agents inherit the credentials from `claude auth login`.');
    note('  Swarm OS stores no credentials and never reads the keychain.');
  } else {
    line(`${c.red(symbols.warn)} API billing would take precedence`);
    note(`  Set in this shell: ${billingVars.join(', ')}`);
    note('  Swarm OS strips these from every agent it spawns, but unset them');
    note('  in your shell to be certain nothing else picks them up.');
  }

  heading('Context economy');
  note('Every agent pays a baseline before it reads a line of your code.');
  note('Lean spawning strips MCP servers, skills, plugins and user settings');
  note('from agent processes — measured at ~95k tokens down to ~12k.');
  if (flagBool(args.flags, 'measure')) {
    await measure(args);
  } else {
    note('');
    note('Run `swarm doctor --measure` to measure it on this machine (2 short calls).');
  }

  heading('Project');
  if (!workspace.exists) {
    line(`${c.gray(symbols.sleeping)} not mapped — run \`swarm map\` in a repository`);
  } else {
    const modules = await workspace.listModules();
    const gitRepo = await isGitRepo(workspace.repoRoot);
    line(`${c.green(symbols.ok)} ${workspace.repoRoot}`);
    line(`  ${modules.length} modules · runtime ${config.runtime} · model ${config.model}`);
    if (!gitRepo) {
      line(`  ${c.yellow(symbols.warn)} not a git repository — agents will share one working tree`);
    }
    const drift = await detectDrift(workspace);
    if (drift.drifted) {
      line(
        `  ${c.yellow(symbols.warn)} ${drift.changedModules.length} module(s) changed since mapping — run \`swarm map\``,
      );
    }
    if (!config.verifyCommand) {
      const [first, ...rest] = verifyCommandCheckLines(detectVerifyCommand(workspace.repoRoot));
      if (first) line(`  ${c.yellow(symbols.warn)} ${first}`);
      for (const l of rest) note(`  ${l}`);
    }
  }

  line();
  return report.ok && billingVars.length === 0 ? 0 : 1;
}

function renderCheck(check: PreflightCheck): void {
  const mark =
    check.status === 'pass'
      ? c.green(symbols.ok)
      : check.status === 'warn'
        ? c.yellow(symbols.warn)
        : c.red(symbols.fail);
  line(`${mark} ${check.name}`);
  note(`  ${check.detail}`);
}

/**
 * Measure the baseline cost of an agent with and without lean spawning.
 * Two trivial calls; the difference is what lean mode saves on every agent.
 */
async function measure(args: ParsedArgs): Promise<void> {
  const runtime = new ClaudeCodeLocalRuntime({ defaultModel: 'sonnet' });
  const probe = async (lean: boolean): Promise<number | undefined> => {
    const { collectAgent } = await import('@swarm-os/core');
    const outcome = await collectAgent(runtime, {
      id: lean ? 'probe-lean' : 'probe-ambient',
      role: 'probe',
      prompt: 'Reply with exactly: OK',
      cwd: process.cwd(),
      tools: [],
      model: 'sonnet',
      permissionMode: 'dontAsk',
      lean,
      ephemeral: true,
    });
    return outcome.usage?.contextTokens;
  };

  line();
  note('measuring…');
  const ambient = await probe(false);
  const lean = await probe(true);

  if (ambient === undefined || lean === undefined) {
    note('could not measure (an agent did not report usage)');
    return;
  }

  table(
    [
      ['ambient environment', `${ambient.toLocaleString()} tokens`],
      ['lean spawn', `${lean.toLocaleString()} tokens`],
      [
        c.bold('saved per agent'),
        c.green(`${(ambient - lean).toLocaleString()} tokens (${(ambient / Math.max(lean, 1)).toFixed(1)}×)`),
      ],
    ],
    { head: ['baseline', 'context'] },
  );
}
