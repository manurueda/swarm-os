/**
 * `swarm mission "<goal>"` — put the swarms to work.
 *
 * Routes the goal to the modules it touches, wakes those swarms, runs one agent
 * per module in its own worktree, then compresses what each learned and puts
 * them back to sleep.
 */

import {
  runMission,
  type MissionModuleResult,
  type MissionProgress,
  type SwarmEvent,
} from '@swarm-os/core';

import { flagBool, flagList, type ParsedArgs } from '../args.js';
import { assertRuntimeReady, loadContext, UserError } from '../context.js';
import {
  LiveBoard,
  c,
  clip,
  formatTokens,
  heading,
  line,
  note,
  ok,
  pad,
  symbols,
  table,
  warn,
} from '../ui.js';

type VerifyOutcome = 'passed' | 'failed' | 'skipped-no-command';

interface AgentRow {
  module: string;
  state: 'waiting' | 'working' | 'done' | 'failed';
  activity: string;
  tokens?: number;
  window?: number;
  verifyOutcome?: VerifyOutcome;
  refusalCount?: number;
}

/**
 * mission contracts MissionModuleResult to carry verifyOutcome/refusalCount,
 * but this package may build against a @swarm-os/core snapshot from before
 * those fields landed. Read them defensively so cli keeps compiling either
 * way, and render nothing (rather than guess) when they are absent.
 */
export function verifyOutcomeOf(m: MissionModuleResult): VerifyOutcome | undefined {
  return (m as unknown as { verifyOutcome?: VerifyOutcome }).verifyOutcome;
}

export function refusalCountOf(m: MissionModuleResult): number {
  return (m as unknown as { refusalCount?: number }).refusalCount ?? 0;
}

export function formatVerify(outcome: VerifyOutcome | undefined): string {
  if (outcome === 'passed') return c.green('passed');
  if (outcome === 'failed') return c.red('failed');
  if (outcome === 'skipped-no-command') return c.gray('skipped');
  return c.gray('—');
}

export function formatRefusals(n: number): string {
  return n > 0 ? c.red(`${symbols.warn} ${n}`) : c.gray('0');
}

/**
 * mission contracts MissionModuleResult to carry quarantinedPaths/
 * quarantineCommitHash once the commit step splits out-of-bounds changes
 * into their own commit, but this package may build against a @swarm-os/core
 * snapshot from before those fields landed. Read them defensively, same as
 * verifyOutcomeOf/refusalCountOf above.
 */
export function quarantinedPathsOf(m: MissionModuleResult): string[] {
  return (m as unknown as { quarantinedPaths?: string[] }).quarantinedPaths ?? [];
}

export function quarantineCommitHashOf(m: MissionModuleResult): string | undefined {
  return (m as unknown as { quarantineCommitHash?: string }).quarantineCommitHash;
}

export async function missionCommand(args: ParsedArgs): Promise<number> {
  const goal = args.positionals.join(' ').trim();
  if (!goal) {
    throw new UserError('give the mission a goal:  swarm mission "make the timeline smooth with 100+ scenes"');
  }

  const { workspace, runtime, config } = await loadContext(args, { requireMapped: true });
  await assertRuntimeReady(runtime);

  const dryRun = flagBool(args.flags, 'dry-run');
  const modules = flagList(args.flags, 'modules');

  heading(goal);

  const board = new LiveBoard();
  const rows = new Map<string, AgentRow>();
  let phase = '';

  const paintPhase = (text: string, done = false): void => {
    phase = text;
    board.set(
      '__phase',
      `${done ? c.green(symbols.ok) : c.cyan(board.spinner())} ${text}`,
    );
  };

  const paintRow = (module: string): void => {
    const row = rows.get(module);
    if (!row) return;
    const mark =
      row.state === 'done'
        ? c.green(symbols.ok)
        : row.state === 'failed'
          ? c.red(symbols.fail)
          : row.state === 'working'
            ? c.green(symbols.active)
            : c.gray(symbols.sleeping);
    const usage = row.tokens ? c.gray(formatTokens(row.tokens)) : '';
    const verify = row.verifyOutcome ? ` verify:${formatVerify(row.verifyOutcome)}` : '';
    const refused = row.refusalCount ? ` ${formatRefusals(row.refusalCount)} refused` : '';
    board.set(
      `a:${module}`,
      `  ${mark} ${c.bold(pad(module, 20))} ${pad(clip(row.activity, 44), 44)} ${usage}${verify}${refused}`,
    );
  };

  board.start();

  const onProgress = (p: MissionProgress): void => {
    if (p.module) {
      const existing = rows.get(p.module) ?? {
        module: p.module,
        state: 'waiting' as const,
        activity: 'waiting',
      };
      if (p.phase === 'spawn') {
        rows.set(p.module, { ...existing, state: 'working', activity: 'waking swarm…' });
      } else if (p.phase === 'work') {
        const finished = ['complete', 'partial', 'blocked', 'finished', 'failed'].includes(p.message);
        rows.set(p.module, {
          ...existing,
          state: finished ? (p.message === 'failed' || p.message === 'blocked' ? 'failed' : 'done') : 'working',
          activity: finished ? p.message : 'working…',
        });
      } else if (p.phase === 'review') {
        rows.set(p.module, { ...existing, activity: 'under review…' });
      } else if (p.phase === 'sleep') {
        rows.set(p.module, { ...existing, activity: 'compressing memory…' });
      }
      paintRow(p.module);
      return;
    }
    paintPhase(`${p.phase}  ${c.gray(clip(p.message, 70))}`);
  };

  const onEvent = (event: SwarmEvent): void => {
    if (event.type === 'agent.tool' && event.agentId.startsWith('work:')) {
      const module = event.agentId.slice('work:'.length);
      const row = rows.get(module);
      if (row) {
        rows.set(module, {
          ...row,
          state: 'working',
          activity: `${event.tool}${event.summary ? ` ${event.summary}` : ''}`,
        });
        paintRow(module);
      }
    } else if (event.type === 'agent.usage' && event.agentId.startsWith('work:')) {
      const module = event.agentId.slice('work:'.length);
      const row = rows.get(module);
      if (row) {
        rows.set(module, {
          ...row,
          tokens: event.usage.contextTokens,
          ...(event.usage.contextWindow ? { window: event.usage.contextWindow } : {}),
        });
        paintRow(module);
      }
    } else if (event.type === 'ratelimit' && event.snapshot.status !== 'allowed') {
      board.setFooter(c.yellow(`  rate limit: ${event.snapshot.status}`));
    }
  };

  let result;
  try {
    result = await runMission({
      runtime,
      workspace,
      config,
      goal,
      ...(modules ? { modules } : {}),
      dryRun,
      keepWorktrees: flagBool(args.flags, 'keep-worktrees'),
      skipCompress: flagBool(args.flags, 'no-compress'),
      skipReview: flagBool(args.flags, 'no-review'),
      onProgress,
      onEvent,
    });
  } catch (err) {
    board.stop();
    throw err instanceof Error ? new UserError(err.message) : err;
  }

  for (const m of result.modules) {
    const row = rows.get(m.module);
    if (row) {
      rows.set(m.module, {
        ...row,
        verifyOutcome: verifyOutcomeOf(m),
        refusalCount: refusalCountOf(m),
      });
      paintRow(m.module);
    }
  }

  paintPhase(phase.replace(/^\S+\s+/, '') || 'finished', true);
  board.stop();

  // -- dry run --------------------------------------------------------------
  if (dryRun) {
    heading('Plan');
    if (result.plan?.summary) note(result.plan.summary);
    line();
    for (const a of result.plan?.assignments ?? []) {
      line(`  ${c.bold(a.module)}`);
      if (a.rationale) note(`    ${clip(a.rationale, 90)}`);
      line(`    ${clip(a.task, 90)}`);
      line();
    }
    if (result.plan?.notes) {
      warn(result.plan.notes);
      line();
    }
    note(`Plan written to ${workspace.rel(workspace.missionDir(result.record.id))}/plan.md`);
    note('Re-run without --dry-run to execute it.');
    line();
    return 0;
  }

  // -- results --------------------------------------------------------------
  heading('Results');
  printResults(result.modules);

  // The review is the part worth reading first — it checked what the author
  // structurally could not.
  const reviewed = result.modules.filter((m) => m.review);
  if (reviewed.length > 0) {
    line();
    for (const m of reviewed) {
      const r = m.review;
      if (!r) continue;
      const mark =
        r.verdict === 'approve'
          ? c.green(symbols.ok)
          : r.verdict === 'reject'
            ? c.red(symbols.fail)
            : c.yellow(symbols.warn);
      line(`  ${mark} ${c.bold(m.module)} ${c.gray(r.verdict)}`);
      if (r.summary) note(`     ${clip(r.summary, 92)}`);
      if (r.verificationHolds === false) {
        note(`     ${c.yellow('the author\'s verification claim could not be confirmed')}`);
      }
      for (const f of r.findings.slice(0, 5)) {
        const sev =
          f.severity === 'blocker' ? c.red('blocker') : f.severity === 'major' ? c.yellow('major') : c.gray('minor');
        note(`     ${sev} ${c.gray(f.file)}`);
        note(`       ${clip(f.problem, 90)}`);
      }
      line();
    }
  }

  const violations = result.modules.flatMap((m) =>
    m.ownershipViolations.map((f) => `${m.module} → ${f}`),
  );
  if (violations.length > 0) {
    line();
    warn(`${violations.length} file(s) changed outside module boundaries:`);
    for (const v of violations.slice(0, 12)) note(`  ${v}`);
    if (violations.length > 12) note(`  … and ${violations.length - 12} more`);
    note('  Review these before merging — a module reached outside its own domain.');
  }

  const quarantined = result.modules.filter((m) => quarantinedPathsOf(m).length > 0);
  if (quarantined.length > 0) {
    line();
    const total = quarantined.reduce((sum, m) => sum + quarantinedPathsOf(m).length, 0);
    warn(`${total} file(s) quarantined out of bounds into a separate commit:`);
    for (const m of quarantined) {
      const paths = quarantinedPathsOf(m);
      const hash = quarantineCommitHashOf(m);
      note(`  ${m.module}${hash ? ` — commit ${c.bold(hash)}` : ''}`);
      for (const p of paths.slice(0, 12)) note(`    ${p}`);
      if (paths.length > 12) note(`    … and ${paths.length - 12} more`);
    }
    note('  Drop that commit with a rebase to keep it off the branch.');
  }

  const worked = result.modules.filter((m) => m.branch && m.changedFiles.length > 0);
  // A branch is only ready if the work actually reached it. Announcing one that
  // failed to commit sends someone to `git diff` an empty branch and conclude
  // the agent did nothing, when the work is sitting in the worktree.
  const branches = worked.filter((m) => m.committed);
  const stranded = worked.filter((m) => !m.committed);

  line();
  if (branches.length > 0) {
    ok(`${branches.length} branch(es) ready for review`);
    for (const m of branches) {
      note(`  git diff main..${m.branch}      ${m.changedFiles.length} files`);
    }
  } else if (stranded.length === 0) {
    note('No files were changed.');
  }

  if (stranded.length > 0) {
    line();
    warn(`${stranded.length} module(s) changed files that could not be committed:`);
    for (const m of stranded) {
      note(`  ${m.module} — ${m.changedFiles.length} files, left in ${workspace.rel(m.worktree ?? '')}`);
      if (m.commitError) note(`    ${clip(m.commitError, 100)}`);
    }
    note('  The work is in the worktree, not on the branch. Nothing was lost.');
  }

  line();
  note(`  Report:  ${workspace.rel(workspace.missionDir(result.record.id))}/report.md`);
  note('  Every swarm is asleep again. Memory updated with what they learned.');
  line();

  return result.modules.every((m) => m.ok) ? 0 : 1;
}

function printResults(modules: MissionModuleResult[]): void {
  const rows = modules.map((m) => {
    const status = m.report?.status ?? (m.ok ? 'finished' : 'failed');
    const mark =
      status === 'complete' || status === 'finished'
        ? c.green(symbols.ok)
        : status === 'partial'
          ? c.yellow(symbols.warn)
          : c.red(symbols.fail);
    return [
      `${mark} ${c.bold(pad(m.module, 20))}`,
      status,
      `${m.changedFiles.length} files`,
      formatTokens(m.contextTokens),
      formatVerify(verifyOutcomeOf(m)),
      formatRefusals(refusalCountOf(m)),
      c.gray(clip(m.error ?? m.report?.summary ?? '', 40)),
    ];
  });
  table(rows, { head: ['  module', 'status', 'changed', 'context', 'verify', 'refused', ''] });

  // A nonzero refusal count means the harness blocked the agent from running
  // something it needed (usually a misconfigured permission mode) — that is
  // urgent enough to call out here rather than leave it in the table above.
  const refused = modules.filter((m) => refusalCountOf(m) > 0);
  if (refused.length > 0) {
    line();
    warn(
      `${refused.reduce((sum, m) => sum + refusalCountOf(m), 0)} tool call(s) were refused by the permission layer:`,
    );
    for (const m of refused) note(`  ${m.module} — ${refusalCountOf(m)} refused`);
    note('  Check config.permissionMode — a misconfigured mode blocks agents from doing real work.');
  }

  const followUps = modules.flatMap((m) => m.report?.followUps ?? []);
  if (followUps.length > 0) {
    line();
    line(`  ${c.bold('Follow-ups')}`);
    for (const f of followUps.slice(0, 10)) note(`  ${symbols.bullet} ${clip(f, 96)}`);
  }
}

/** `swarm missions` — list past missions. */
export async function missionsCommand(args: ParsedArgs): Promise<number> {
  const { workspace } = await loadContext(args, { requireMapped: true });
  const missions = await workspace.listMissions();

  if (missions.length === 0) {
    note('No missions yet.  swarm mission "<goal>"');
    return 0;
  }

  heading('Missions');
  table(
    missions.map((m) => [
      `  ${c.bold(pad(m.id, 36))}`,
      m.status,
      m.modules.join(','),
      c.gray(clip(m.goal, 50)),
    ]),
    { head: ['  id', 'status', 'modules', 'goal'] },
  );
  line();
  return 0;
}
