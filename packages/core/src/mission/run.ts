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

import { createHash, randomUUID } from 'node:crypto';

import type {
  AgentRuntime,
  AgentLedgerEntry,
  MissionPlan,
  MissionRecord,
  ModuleSpec,
  SwarmEvent,
} from '../types.js';
import { collectAgent } from '../runtime/collect.js';
import { buildContextPack, dependencyContracts, sleepSwarm, wakeSwarm } from '../swarm/manager.js';
import { reviewModuleChange, type ModuleReview } from './review.js';
import { checkOwnership } from '../swarm/ownership.js';
import { Scheduler } from '../swarm/scheduler.js';
import { Workspace } from '../workspace/store.js';
import type { SwarmConfig } from '../workspace/config.js';
import {
  changedFiles,
  commitAll,
  createWorktree,
  removeWorktree,
  pruneWorktrees,
  currentBranch,
  diffStat,
  fullDiff,
  isGitRepo,
} from '../git/worktree.js';
import { renderPlan, routeMission } from './route.js';
import { buildDigest } from '../mapper/digest.js';
import { isOwned } from '../swarm/ownership.js';

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

## Boundaries

- You may modify files matching your module's globs. Nothing else.
- If the task genuinely requires changing another module, do NOT reach across.
  Finish what you can, and report it as a follow-up with the exact change needed.
  Your diff is checked against your globs afterwards and violations are flagged.
- Read outside your module only to understand a contract you consume. You were
  given the published interface of every module you depend on. Use it exactly as
  written. If what you need is not there, say so in your report — do NOT invent
  a signature, a flag or an option name that looks plausible. That specific
  failure has happened, it compiles, and it survives review unless someone
  catches it.

## How to write the code

Tests first, where tests exist. Write the failing test, make it pass, then
tidy. If the module has no test setup at all, say so plainly in your report and
verify another way — do not invent a test harness the project has not chosen.

One reason to change. A function or class that would need editing for two
unrelated reasons is two things wearing one name. Split it. Name things for what
they mean to a caller, not for how they work inside.

Duplication is cheaper than the wrong abstraction. Two similar blocks are fine;
extract on the third, when you can see what actually varies. An abstraction
invented from two examples usually encodes a coincidence, and unpicking it later
costs more than the duplication ever did.

Build only what the task asks for. No configuration nobody sets, no extension
point nobody extends, no parameter with one caller passing one value. If you
think something will be needed later, put it in follow-ups, not in the code.

Never refactor and change behaviour in the same step. Do one, confirm it still
works, then do the other. A diff that reorganises and alters at once cannot be
reviewed, and cannot be bisected when it breaks.

Small steps that keep working. Prefer five changes that each leave the code
running to one change that leaves it broken in the middle.

Match what is already there. Its conventions, its error handling, its level of
comment. Being locally consistent matters more than being globally right.

## Reporting

Verify your work. Run the tests or the command that proves it. If you cannot
verify, say exactly that rather than implying success — "partial" and "blocked"
are useful answers, and a confident "complete" that is not complete costs the
next mission far more than it saves.

When you finish, report what you did and — importantly — what you LEARNED about
this module that was not already in its memory. That is what makes the next
mission cheaper.`;
}

export interface MissionProgress {
  phase: 'preflight' | 'route' | 'spawn' | 'work' | 'review' | 'harvest' | 'sleep' | 'done';
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
  review?: ModuleReview;
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
  /**
   * Leave worktrees on disk after the mission.
   *
   * Off by default: the work is committed to a branch, so `git diff` from the
   * main checkout shows everything, and a worktree is a full copy of the
   * repository. Left behind they accumulate one per module per mission — on a
   * 1,700-file repo that is gigabytes for nothing.
   */
  keepWorktrees?: boolean;
  /** Skip the memory-compression step (faster, but the swarms learn nothing). */
  skipCompress?: boolean;
  /** Skip review. Faster, and nothing checks the contracts the author guessed. */
  skipReview?: boolean;
  onProgress?: (progress: MissionProgress) => void;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

/**
 * A mission's identity: date, a readable slug, and a hash of the whole goal.
 *
 * The slug alone is not enough. An autonomous loop generates goals that differ
 * only in their tail — "Split the oversized files in this module. Start with
 * X" versus "…Start with Y" — and six words of slug is identical for both. Two
 * missions then share a directory and overwrite each other's plan, report and
 * event log, so the record of what happened is whatever finished last.
 */
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
  const fingerprint = createHash('sha256').update(goal).digest('hex').slice(0, 6);
  return `${date}-${slug}-${fingerprint}`;
}

export async function runMission(options: RunMissionOptions): Promise<MissionResult> {
  const { workspace, config, runtime, goal } = options;
  const report = (p: MissionProgress): void => options.onProgress?.(p);

  const id = missionId(goal);
  const allModules = await workspace.listModules();
  if (allModules.length === 0) {
    throw new Error('this project has no module map — run `swarm map` first');
  }

  // Same goal, same id, same directory — so the previous run's log must go
  // before this one starts appending to it.
  await workspace.resetMissionLog(id);

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

  // One walk of the repository, shared by every agent's context pack.
  const digest = await buildDigest(workspace.repoRoot);

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
    let linked: string[] = [];
    if (repoIsGit) {
      try {
        const handle = await createWorktree({
          repoRoot: workspace.repoRoot,
          worktreeRoot: config.worktreeRoot,
          name: `${id}--${spec.slug}`,
          branch: `swarm/${id}/${spec.slug}`,
          base,
          links: config.worktreeLinks,
        });
        worktreePath = handle.path;
        branch = handle.branch;
        linked = handle.linked ?? [];
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

    const pack = await buildContextPack(workspace, spec, {
      files: digest.files.filter((f) => isOwned(f, spec.owns)),
      codeStyle: config.codeStyle,
      maxIndexFiles: config.contextFileIndex,
    });

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

    const changed = repoIsGit ? await changedFiles(worktreePath, base, linked) : [];
    const ownership = checkOwnership(changed, spec.owns);
    const stat = repoIsGit ? await diffStat(worktreePath, base) : '';

    // Review before commit: the author cannot check its own cross-module
    // guesses, and this is the only step that can.
    let review: ModuleReview | undefined;
    if (repoIsGit && changed.length > 0 && !options.skipReview) {
      report({ phase: 'review', message: 'reviewing', module: spec.slug });
      try {
        review = await reviewModuleChange({
          runtime,
          module: spec,
          cwd: worktreePath,
          goal,
          task: assignment.task,
          diff: await fullDiff(worktreePath, base),
          ...(workReport
            ? {
                authorReport: [
                  workReport.summary,
                  ...(workReport.verification ? [`Verification: ${workReport.verification}`] : []),
                ].join('\n'),
              }
            : {}),
          contracts: await dependencyContracts(workspace, spec),
          ownershipViolations: ownership.violations,
          ...(config.systemModel ? { model: config.systemModel } : {}),
          onEvent: log,
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch {
        // A failed review must not lose the work.
      }
    }

    let committed = false;
    if (repoIsGit && changed.length > 0) {
      const commit = await commitAll(
        worktreePath,
        `${spec.slug}: ${workReport?.summary?.split('\n')[0] ?? goal}`.slice(0, 100),
        linked,
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
      ok:
        outcome.ok &&
        workReport?.status !== 'blocked' &&
        review?.verdict !== 'reject',
      ...(workReport ? { report: workReport } : {}),
      worktree: worktreePath,
      ...(branch ? { branch } : {}),
      changedFiles: changed,
      ownershipViolations: ownership.violations,
      ...(stat ? { diffStat: stat } : {}),
      ...(review ? { review } : {}),
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

  // -- release worktrees ----------------------------------------------------
  // Only once every agent has finished and committed. The branch is the durable
  // artifact; the checkout is scaffolding.
  if (repoIsGit && !options.keepWorktrees) {
    for (const result of results) {
      if (!result.worktree || result.worktree === workspace.repoRoot) continue;
      // A worktree with uncommitted changes still holds work — keep it, and say
      // so, rather than deleting something that was never captured on a branch.
      if (result.changedFiles.length > 0 && !result.committed) {
        report({
          phase: 'harvest',
          message: 'uncommitted changes — worktree kept',
          module: result.module,
        });
        continue;
      }
      await removeWorktree(workspace.repoRoot, result.worktree);
    }
    await pruneWorktrees(workspace.repoRoot);
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
    ...(result.review && result.review.findings.length > 0
      ? [
          '',
          `Review verdict: ${result.review.verdict}`,
          ...result.review.findings.map((f) => `- ${f.severity}: ${f.file} — ${f.problem}`),
        ]
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

    if (r.review) {
      lines.push(`**Review: ${r.review.verdict}.** ${r.review.summary}`, '');
      if (r.review.verificationHolds === false) {
        lines.push('> The reviewer could not confirm the author\'s verification claim.', '');
      }
      for (const f of r.review.findings) {
        lines.push(`- **${f.severity}** \`${f.file}\` — ${f.problem}`);
        if (f.fix) lines.push(`  - ${f.fix}`);
      }
      if (r.review.findings.length > 0) lines.push('');
    }

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
