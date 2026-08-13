/**
 * `swarm loop` — keep fixing things until there is nothing left, or the budget
 * runs out, or something goes wrong enough to stop.
 *
 * Built to be started and walked away from, so it writes a running log to
 * `.swarm/loop.log` and a machine-readable record to `.swarm/loop.json`. Both
 * survive the terminal being closed, which is the point.
 */

import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  runLoop,
  tasksFromSignals,
  isWorkingTreeClean,
  type LoopProgress,
  type LoopResult,
} from '@swarm-os/core';

import { flagBool, flagList, flagNumber, type ParsedArgs } from '../args.js';
import { assertRuntimeReady, loadContext, UserError } from '../context.js';
import { c, heading, line, note, ok, pad, symbols, table, warn } from '../ui.js';

export async function loopCommand(args: ParsedArgs): Promise<number> {
  const { workspace, runtime, config } = await loadContext(args, { requireMapped: true });
  await assertRuntimeReady(runtime);

  const dryRun = flagBool(args.flags, 'dry-run');

  if (!dryRun && !(await isWorkingTreeClean(workspace.repoRoot))) {
    throw new UserError(
      'the working tree has uncommitted changes.\n' +
        'A loop runs for hours and merges as it goes — commit or stash first.',
    );
  }

  const maxMissions = flagNumber(args.flags, 'missions') ?? 20;
  const maxHours = flagNumber(args.flags, 'hours') ?? 5;
  const modules = flagList(args.flags, 'modules');

  heading(dryRun ? 'What the loop would do' : 'Autonomous loop');
  note(`  up to ${maxMissions} missions or ${maxHours}h, whichever comes first`);
  note(`  work accumulates on one branch — \`${await currentBranchName(workspace.repoRoot)}\` is not touched`);
  if (config.verifyCommand) {
    note(`  nothing is kept unless \`${config.verifyCommand}\` passes`);
  } else {
    warn('  no verifyCommand in config — changes are kept on a reviewer\'s word alone');
    note('    set one so an unattended run can prove what it kept, e.g. `npm test`');
  }
  line();

  const logPath = join(workspace.root, 'loop.log');
  const log = async (text: string): Promise<void> => {
    await appendFile(logPath, `${new Date().toISOString()}  ${text}\n`, 'utf8').catch(() => {});
  };
  await log(`--- loop start (${maxMissions} missions, ${maxHours}h) ---`);

  let round = 0;
  const onProgress = (p: LoopProgress): void => {
    if (p.phase === 'pick' && p.task) {
      round = p.attempt ?? round + 1;
      line();
      line(`  ${c.bold(`${round}.`)} ${c.gray(p.task.module ?? '')} ${p.task.goal.split('.')[0]}`);
      void log(`pick ${p.task.key} — ${p.task.goal.slice(0, 120)}`);
    } else if (p.phase === 'mission') {
      note(`     running…`);
    } else if (p.phase === 'verify') {
      note(`     verifying with ${p.message}`);
    } else if (p.phase === 'merge') {
      line(`     ${c.green(symbols.ok)} ${p.message}`);
      void log(`merged: ${p.message}`);
    } else if (p.phase === 'survey' && round > 0) {
      note(`     ${p.message}`);
    }
  };

  let result: LoopResult;
  try {
    result = await runLoop({
      runtime,
      workspace,
      config,
      maxMissions,
      maxHours,
      ...(modules ? { modules } : {}),
      dryRun,
      onProgress,
    });
  } catch (err) {
    await log(`error: ${err instanceof Error ? err.message : String(err)}`);
    throw err instanceof Error ? new UserError(err.message) : err;
  }

  await workspace.writeSystemFile('loop.json', `${JSON.stringify(result, null, 2)}\n`);
  await log(`--- stopped: ${result.stoppedBecause} · ${result.merged} kept ---`);

  // -- what happened --------------------------------------------------------
  heading('Result');
  if (result.attempts.length === 0) {
    ok('nothing to do');
    line();
    return 0;
  }

  table(
    result.attempts.map((a) => {
      const mark = a.merged
        ? c.green(symbols.ok)
        : a.note?.includes('reverted')
          ? c.red(symbols.fail)
          : c.gray(symbols.bullet);
      return [
        `  ${mark} ${pad(a.task.module ?? '—', 22)}`,
        pad(a.task.key.split(':')[0] ?? '', 20),
        a.merged ? c.green('kept') : c.gray(a.note ?? 'no change'),
      ];
    }),
  );

  line();
  line(
    `  ${result.merged} of ${result.attempts.length} kept · stopped because ${c.bold(result.stoppedBecause)}`,
  );

  if (result.merged > 0) {
    line();
    ok(`review it all in one place:`);
    note(`  git diff main..${result.branch}`);
    note(`  git merge ${result.branch}    # when you are happy with it`);
  }
  line();
  note(`  log: ${workspace.rel(logPath)}`);
  line();

  return 0;
}

async function currentBranchName(repoRoot: string): Promise<string> {
  const { currentBranch } = await import('@swarm-os/core');
  return currentBranch(repoRoot);
}

/** `swarm loop --plan` — the queue, without running anything. */
export async function loopPlanCommand(args: ParsedArgs): Promise<number> {
  const { workspace, config } = await loadContext(args, { requireMapped: true });
  const { buildDigest, countLines, buildImportGraph, computeSignals, estimateTokens } =
    await import('@swarm-os/core');

  const modules = await workspace.listModules();
  const digest = await buildDigest(workspace.repoRoot);
  const stats = await countLines(workspace.repoRoot, digest.files);
  const imports = await buildImportGraph(workspace.repoRoot, digest.files, modules);

  const memory: Record<string, { tokens: number; landmarks: number }> = {};
  for (const spec of modules) {
    memory[spec.slug] = {
      tokens: estimateTokens(await workspace.readModuleFile(spec.slug, 'memory.md')),
      landmarks: 0,
    };
  }

  const { signals } = computeSignals({
    modules,
    files: digest.files,
    memory,
    memoryBudget: config.memoryBudgetTokens,
    stats,
    imports,
  });

  const tasks = tasksFromSignals(signals);
  heading(`${tasks.length} mission(s) queued`);
  if (tasks.length === 0) {
    note('  nothing a loop can act on. Boundary problems need a person.');
    line();
    return 0;
  }
  for (const [i, t] of tasks.entries()) {
    const sev = t.severity === 'high' ? c.red('high') : t.severity === 'warn' ? c.yellow('warn') : c.gray('info');
    line(`  ${pad(`${i + 1}.`, 4)}${sev}  ${c.bold(t.module ?? '')}`);
    note(`      ${t.goal.split('.')[0]}`);
  }
  line();
  note(`  ${signals.length - tasks.length} signal(s) left out — boundary decisions, not work.`);
  line();
  return 0;
}
