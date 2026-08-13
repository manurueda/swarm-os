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

interface AgentRow {
  module: string;
  state: 'waiting' | 'working' | 'done' | 'failed';
  activity: string;
  tokens?: number;
  window?: number;
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
    board.set(
      `a:${module}`,
      `  ${mark} ${c.bold(pad(module, 20))} ${pad(clip(row.activity, 44), 44)} ${usage}`,
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
      onProgress,
      onEvent,
    });
  } catch (err) {
    board.stop();
    throw err instanceof Error ? new UserError(err.message) : err;
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

  const branches = result.modules.filter((m) => m.branch && m.changedFiles.length > 0);
  line();
  if (branches.length > 0) {
    ok(`${branches.length} branch(es) ready for review`);
    for (const m of branches) {
      note(`  git diff main..${m.branch}      ${m.changedFiles.length} files`);
    }
  } else {
    note('No files were changed.');
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
      c.gray(clip(m.error ?? m.report?.summary ?? '', 48)),
    ];
  });
  table(rows, { head: ['  module', 'status', 'changed', 'context', ''] });

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
