/**
 * Mission execution.
 *
 * One goal in, N isolated agents out — one per module the goal actually
 * touches. Each agent gets a worktree of its own, its module's charter and
 * memory, and nothing else. They never share a context window, so a mission
 * across six modules costs six small contexts instead of one impossible one.
 *
 * Afterwards every swarm compresses what it learned back into memory and goes
 * to sleep, leaving the repository ready for the next mission and holding no
 * running processes.
 */

import { randomUUID } from 'node:crypto';

import type {
  AgentRuntime,
  AgentLedgerEntry,
  MissionPlan,
  MissionRecord,
  ModuleSpec,
  SwarmEvent,
} from '../types.js';
import { collectAgent } from '../runtime/collect.js';
import { buildContextPack, sleepSwarm, wakeSwarm } from '../swarm/manager.js';
import { checkOwnership } from '../swarm/ownership.js';
import { Scheduler } from '../swarm/scheduler.js';
import { Workspace } from '../workspace/store.js';
import type { SwarmConfig } from '../workspace/config.js';
import {
  changedFiles,
  commitAll,
  createWorktree,
  currentBranch,
  diffStat,
  isGitRepo,
} from '../git/worktree.js';
import { renderPlan, routeMission } from './route.js';

export const WORK_REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'changed', 'learned'],
  properties: {
    status: {
      type: 'string',
      enum: ['complete', 'partial', 'blocked'],
      description: 'blocked means you could not proceed without something outside your module.',
    },
    summary: { type: 'string', description: 'What you actually did.' },
    changed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'what'],
        properties: {
          path: { type: 'string' },
          what: { type: 'string' },
        },
      },
    },
    learned: {
      type: 'object',
      additionalProperties: false,
      required: ['invariants', 'gotchas'],
      properties: {
        invariants: {
          type: 'array',
          items: { type: 'string' },
          description: 'Rules you discovered that a future agent must not break.',
        },
        gotchas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Traps you hit or nearly hit. Worth a future agent knowing.',
        },
      },
    },
    verification: {
      type: 'string',
      description: 'How you confirmed this works, or why you could not.',
    },
    followUps: { type: 'array', items: { type: 'string' } },
  },
} as const;

export interface WorkReport {
  status: 'complete' | 'partial' | 'blocked';
  summary: string;
  changed: Array<{ path: string; what: string }>;
  learned: { invariants: string[]; gotchas: string[] };
  verification?: string;
  followUps?: string[];
}

function workerCharter(spec: ModuleSpec): string {
  return `You are the \`${spec.slug}\` agent in a Swarm OS mission.

You own this module and only this module. Other agents are working on other
modules of the same repository at the same time, in their own worktrees. You
cannot see them and they cannot see you.

Your working directory is a dedicated git worktree. Edit freely — nothing you do
here touches the developer's checkout until the mission is reviewed.

Boundaries:
- You may modify files matching your module's globs. Nothing else.
- If the task genuinely requires changing another module, do NOT reach across.
  Finish what you can, and report it as a follow-up with the exact change needed.
  Your diff is checked against your globs afterwards and violations are flagged.
- Read outside your module only when you must understand a contract you consume.

Method:
- Your memory file records what previous agents learned here. Trust it, but if
  you find it wrong, say so — it will be corrected when you finish.
- Verify your work. Run the tests or the command that proves it. If you cannot
  verify, say exactly that rather than implying success.
- Report honestly. "partial" and "blocked" are useful answers; a confident
  "complete" that is not complete costs the next mission far more than it saves.

When you finish, report what you did and — importantly — what you LEARNED about
this module that was not already in its memory. That is what makes the next
mission cheaper.`;
}

export interface MissionProgress {
  phase: 'preflight' | 'route' | 'spawn' | 'work' | 'harvest' | 'sleep' | 'done';
  message: string;
  module?: string;
}

export interface MissionModuleResult {
  module: string;
  ok: boolean;
  report?: WorkReport;
  worktree?: string;
  branch?: string;
  changedFiles: string[];
  ownershipViolations: string[];
  diffStat?: string;
  committed?: boolean;
  contextTokens?: number;
  costUsd?: number;
  error?: string;
}

export interface MissionResult {
  record: MissionRecord;
  plan?: MissionPlan;
  modules: MissionModuleResult[];
  costUsd: number;
  aborted?: boolean;
  note?: string;
}

export interface RunMissionOptions {
  runtime: AgentRuntime;
  workspace: Workspace;
  config: SwarmConfig;
  goal: string;
  /** Skip routing and target these module slugs directly. */
  modules?: string[];
  /** Route and write the plan, but spawn no work agents. */
  dryRun?: boolean;
  /** Leave worktrees in place after the mission for inspection. */
  keepWorktrees?: boolean;
  /** Skip the memory-compression step (faster, but the swarms learn nothing). */
  skipCompress?: boolean;
  onProgress?: (progress: MissionProgress) => void;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export function missionId(goal: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const slug =
    goal
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 6)
      .join('-') || 'mission';
  return `${date}-${slug}`;
}

export async function runMission(options: RunMissionOptions): Promise<MissionResult> {
  const { workspace, config, runtime, goal } = options;
  const report = (p: MissionProgress): void => options.onProgress?.(p);

  const id = missionId(goal);
  const allModules = await workspace.listModules();
  if (allModules.length === 0) {
    throw new Error('this project has no module map — run `swarm map` first');
  }

  const log = async (event: SwarmEvent): Promise<void> => {
    scheduler.observe(event);
    await workspace.logEvent(id, event);
    await options.onEvent?.(event);
  };

  const scheduler = new Scheduler({
    limit: config.maxConcurrentAgents,
    pauseOnStatus: config.pauseOnRateLimitStatus,
    onPause: (snapshot) =>
      report({
        phase: 'work',
        message: `subscription rate limit ${snapshot.status} — no further agents will be launched`,
      }),
  });

  // -- Route ----------------------------------------------------------------
  let plan: MissionPlan | undefined;

  if (options.modules && options.modules.length > 0) {
    const unknown = options.modules.filter((m) => !allModules.some((x) => x.slug === m));
    if (unknown.length > 0) {
      throw new Error(`unknown module${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
    }
    plan = {
      summary: goal,
      assignments: options.modules.map((module) => ({ module, task: goal })),
    };
    report({ phase: 'route', message: `targeting ${options.modules.join(', ')} (routing skipped)` });
  } else {
    report({ phase: 'route', message: 'deciding which modules this touches' });
    const system = await workspace.readSystem();
    const routed = await routeMission({
      runtime,
      repoRoot: workspace.repoRoot,
      goal,
      systemSummary: firstParagraphs(system),
      modules: allModules,
      ...(config.systemModel ? { model: config.systemModel } : {}),
      onEvent: log,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    plan = routed.plan;
    if (!plan) {
      throw new Error(routed.outcome.error ?? 'router could not route this goal to any module');
    }
    report({
      phase: 'route',
      message: `routed to ${plan.assignments.map((a) => a.module).join(', ')}`,
    });
  }

  await workspace.writeMissionFile(id, 'plan.md', renderPlan(goal, plan));

  const record: MissionRecord = {
    id,
    goal,
    status: options.dryRun ? 'planned' : 'running',
    createdAt: new Date().toISOString(),
    modules: plan.assignments.map((a) => a.module),
    agents: {},
  };
  await workspace.writeMission(record);

  if (options.dryRun) {
    return { record, plan, modules: [], costUsd: 0, note: 'dry run — no agents spawned' };
  }

  // -- Spawn ----------------------------------------------------------------
  const repoIsGit = await isGitRepo(workspace.repoRoot);
  const base = repoIsGit ? await currentBranch(workspace.repoRoot) : 'HEAD';

  const specBySlug = new Map(allModules.map((m) => [m.slug, m]));

  const tasks = plan.assignments.map((assignment) => async (): Promise<MissionModuleResult> => {
    const spec = specBySlug.get(assignment.module);
    if (!spec) {
      return {
        module: assignment.module,
        ok: false,
        changedFiles: [],
        ownershipViolations: [],
        error: 'module disappeared between routing and spawn',
      };
    }

    report({ phase: 'spawn', message: 'waking swarm', module: spec.slug });
    await wakeSwarm(workspace, spec.slug, id);

    // Each agent gets its own checkout so parallel swarms cannot collide.
    let worktreePath = workspace.repoRoot;
    let branch: string | undefined;
    if (repoIsGit) {
      try {
        const handle = await createWorktree({
          repoRoot: workspace.repoRoot,
          worktreeRoot: config.worktreeRoot,
          name: `${id}--${spec.slug}`,
          branch: `swarm/${id}/${spec.slug}`,
          base,
        });
        worktreePath = handle.path;
        branch = handle.branch;
      } catch (err) {
        return {
          module: spec.slug,
          ok: false,
          changedFiles: [],
          ownershipViolations: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const pack = await buildContextPack(workspace, spec);

    const prompt = [
      pack.text,
      '',
      '---',
      '',
      '# Mission',
      '',
      `**Overall goal.** ${goal}`,
      '',
      '# Your task',
      '',
      assignment.task,
      ...(assignment.rationale ? ['', `_Why you: ${assignment.rationale}_`] : []),
      '',
      '---',
      '',
      '# Your boundaries',
      '',
      'Paths you may modify:',
      '',
      ...spec.owns.map((g) => `- \`${g}\``),
      '',
      'Do the work, verify it, then report.',
    ].join('\n');

    report({ phase: 'work', message: 'working', module: spec.slug });

    const outcome = await collectAgent(
      runtime,
      {
        id: `work:${spec.slug}`,
        role: 'module',
        module: spec.slug,
        prompt,
        systemPrompt: workerCharter(spec),
        cwd: worktreePath,
        tools: config.tools,
        model: config.model,
        permissionMode: config.permissionMode as never,
        jsonSchema: WORK_REPORT_SCHEMA,
        sessionId: randomUUID(),
        lean: true,
        // Work agents run inside the target repo, so let its own settings apply.
        settingSources: 'project',
      },
      log,
      options.signal,
    );

    const workReport = parseWorkReport(outcome.structured);

    const changed = repoIsGit ? await changedFiles(worktreePath, base) : [];
    const ownership = checkOwnership(changed, spec.owns);
    const stat = repoIsGit ? await diffStat(worktreePath, base) : '';

    let committed = false;
    if (repoIsGit && changed.length > 0) {
      const commit = await commitAll(
        worktreePath,
        `${spec.slug}: ${workReport?.summary?.split('\n')[0] ?? goal}`.slice(0, 100),
      );
      committed = commit.ok;
    }

    report({
      phase: 'work',
      message: workReport?.status ?? (outcome.ok ? 'finished' : 'failed'),
      module: spec.slug,
    });

    return {
      module: spec.slug,
      ok: outcome.ok && workReport?.status !== 'blocked',
      ...(workReport ? { report: workReport } : {}),
      worktree: worktreePath,
      ...(branch ? { branch } : {}),
      changedFiles: changed,
      ownershipViolations: ownership.violations,
      ...(stat ? { diffStat: stat } : {}),
      committed,
      ...(outcome.usage ? { contextTokens: outcome.usage.contextTokens } : {}),
      ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    };
  });

  const settled = await scheduler.run(tasks);

  const results: MissionModuleResult[] = settled.map((r, i) =>
    r instanceof Error
      ? {
          module: plan?.assignments[i]?.module ?? 'unknown',
          ok: false,
          changedFiles: [],
          ownershipViolations: [],
          error: r.message,
        }
      : r,
  );

  // -- Harvest & sleep ------------------------------------------------------
  report({ phase: 'harvest', message: 'compressing what each swarm learned' });

  for (const result of results) {
    const entry: AgentLedgerEntry = {
      role: 'module',
      module: result.module,
      ...(result.worktree ? { worktree: result.worktree } : {}),
      ok: result.ok,
      ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      ...(result.ownershipViolations.length > 0
        ? { ownershipViolations: result.ownershipViolations }
        : {}),
    };
    record.agents[`work:${result.module}`] = entry;

    if (options.skipCompress) {
      await workspace.updateSwarm(result.module, {
        state: 'sleeping',
        lastActiveAt: new Date().toISOString(),
      });
      continue;
    }

    report({ phase: 'sleep', message: 'compressing memory', module: result.module });
    try {
      await sleepSwarm({
        workspace,
        runtime,
        slug: result.module,
        ...(result.report ? { missionReport: renderModuleReport(goal, result) } : {}),
        budgetTokens: config.memoryBudgetTokens,
        ...(config.systemModel ? { model: config.systemModel } : {}),
        onEvent: log,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch {
      await workspace.updateSwarm(result.module, { state: 'sleeping' });
    }

    if (result.report && (result.report.followUps?.length ?? 0) > 0) {
      await workspace.appendDecision(
        result.module,
        [
          '',
          `## ${new Date().toISOString().slice(0, 10)} — ${goal}`,
          '',
          ...(result.report.followUps ?? []).map((f) => `- Follow-up: ${f}`),
          '',
        ].join('\n'),
      );
    }
  }

  const costUsd = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  record.status = results.every((r) => r.ok) ? 'review' : 'failed';
  record.finishedAt = new Date().toISOString();
  await workspace.writeMission(record);
  await workspace.writeMissionFile(id, 'report.md', renderMissionReport(goal, plan, results));

  report({ phase: 'done', message: 'mission finished' });

  return { record, plan, modules: results, costUsd };
}

function parseWorkReport(raw: unknown): WorkReport | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const status = o['status'];
  if (status !== 'complete' && status !== 'partial' && status !== 'blocked') return undefined;

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  const learnedRaw =
    typeof o['learned'] === 'object' && o['learned'] !== null
      ? (o['learned'] as Record<string, unknown>)
      : {};

  const changed = Array.isArray(o['changed'])
    ? o['changed'].flatMap((x) => {
        if (typeof x !== 'object' || x === null) return [];
        const r = x as Record<string, unknown>;
        return typeof r['path'] === 'string' && typeof r['what'] === 'string'
          ? [{ path: r['path'], what: r['what'] }]
          : [];
      })
    : [];

  return {
    status,
    summary: typeof o['summary'] === 'string' ? o['summary'] : '',
    changed,
    learned: {
      invariants: strings(learnedRaw['invariants']),
      gotchas: strings(learnedRaw['gotchas']),
    },
    ...(typeof o['verification'] === 'string' ? { verification: o['verification'] } : {}),
    ...(strings(o['followUps']).length > 0 ? { followUps: strings(o['followUps']) } : {}),
  };
}

function firstParagraphs(system: string): string {
  const stop = system.split('\n').findIndex((l) => /^##\s+Modules/i.test(l));
  const lines = system.split('\n');
  return (stop === -1 ? lines.slice(0, 20) : lines.slice(0, stop)).join('\n').trim();
}

/** What the compressor sees: only this module's slice of the mission. */
function renderModuleReport(goal: string, result: MissionModuleResult): string {
  const r = result.report;
  return [
    `Mission goal: ${goal}`,
    `Outcome: ${r?.status ?? (result.ok ? 'finished' : 'failed')}`,
    '',
    r?.summary ?? '',
    ...(r?.verification ? ['', `Verification: ${r.verification}`] : []),
    ...(r && r.learned.invariants.length > 0
      ? ['', 'Newly discovered invariants:', ...r.learned.invariants.map((i) => `- ${i}`)]
      : []),
    ...(r && r.learned.gotchas.length > 0
      ? ['', 'Newly discovered gotchas:', ...r.learned.gotchas.map((g) => `- ${g}`)]
      : []),
    ...(result.changedFiles.length > 0
      ? ['', 'Files changed:', ...result.changedFiles.slice(0, 40).map((f) => `- ${f}`)]
      : []),
  ].join('\n');
}

function renderMissionReport(
  goal: string,
  plan: MissionPlan | undefined,
  results: MissionModuleResult[],
): string {
  const lines: string[] = ['# Mission report', '', `**Goal.** ${goal}`, ''];
  if (plan?.summary) lines.push(plan.summary, '');

  for (const r of results) {
    lines.push(`## \`${r.module}\``, '');
    lines.push(`- Status: **${r.report?.status ?? (r.ok ? 'finished' : 'failed')}**`);
    if (r.branch) lines.push(`- Branch: \`${r.branch}\``);
    if (r.worktree) lines.push(`- Worktree: \`${r.worktree}\``);
    if (r.contextTokens) lines.push(`- Context used: ${r.contextTokens.toLocaleString()} tokens`);
    if (r.error) lines.push(`- Error: ${r.error}`);
    lines.push('');

    if (r.report?.summary) lines.push(r.report.summary, '');
    if (r.report?.verification) lines.push(`**Verification.** ${r.report.verification}`, '');

    if (r.ownershipViolations.length > 0) {
      lines.push('**Ownership violations** — files changed outside this module:', '');
      lines.push(...r.ownershipViolations.map((f) => `- \`${f}\``), '');
    }
    if (r.diffStat) {
      lines.push('```', r.diffStat, '```', '');
    }
    if (r.report?.followUps?.length) {
      lines.push('**Follow-ups.**', '', ...r.report.followUps.map((f) => `- ${f}`), '');
    }
  }

  return lines.join('\n');
}
