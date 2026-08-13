/**
 * The autonomous loop.
 *
 * Pick the most serious thing wrong with the repository, fix it, verify it,
 * keep it if it holds, and go again — for hours, unattended.
 *
 * Everything here is shaped by that last word. A tool that runs for five hours
 * with nobody watching has to be trusted with a real repository, and trust is
 * built out of specific refusals:
 *
 *   - `main` is never touched. Every mission branches from, and merges into, a
 *     single integration branch created at the start. One branch to review at
 *     the end, one branch to delete if the whole run was a mistake.
 *   - Nothing merges without passing the project's own verify command. A
 *     reviewer's approval is a judgement; a green build is a fact, and after
 *     five unattended hours only facts are worth much.
 *   - It stops itself. Consecutive failures, exhausted quota, a time budget, a
 *     mission budget, or simply running out of things to do.
 *   - A task that fails is not retried in the same run. Repeating a failure for
 *     five hours is the worst possible use of the window.
 *
 * Work accumulates on the integration branch on purpose: mission N+1 branches
 * from N's result, so a long refactor compounds instead of producing forty
 * conflicting branches off the same commit.
 */

import type { AgentRuntime, SwarmEvent } from '../types.js';
import { Workspace } from '../workspace/store.js';
import type { SwarmConfig } from '../workspace/config.js';
import { buildDigest } from '../mapper/digest.js';
import { countLines } from '../architecture/code-stats.js';
import { buildImportGraph } from '../architecture/import-graph.js';
import { computeSignals, type Signal } from '../architecture/signals.js';
import { estimateTokens } from '../workspace/store.js';
import { runMission, type MissionModuleResult } from '../mission/run.js';
import { git, currentBranch, isWorkingTreeCleanIgnoringSwarm } from '../git/worktree.js';

export interface LoopTask {
  /** Stable identity, so a failure is not retried in the same run. */
  key: string;
  module?: string;
  goal: string;
  severity: 'high' | 'warn' | 'info';
  source: 'signal';
}

export type LoopStop =
  | 'nothing-left'
  | 'mission-budget'
  | 'time-budget'
  | 'consecutive-failures'
  | 'rate-limit'
  | 'aborted'
  | 'dirty-tree';

export interface LoopAttempt {
  task: LoopTask;
  startedAt: string;
  finishedAt?: string;
  /** What the mission's modules reported. */
  modules: Array<{ module: string; status: string; review?: string; changed: number }>;
  verified?: boolean;
  merged: boolean;
  note?: string;
}

export interface LoopResult {
  branch: string;
  stoppedBecause: LoopStop;
  attempts: LoopAttempt[];
  merged: number;
  startedAt: string;
  finishedAt: string;
}

export interface LoopProgress {
  phase: 'survey' | 'pick' | 'mission' | 'verify' | 'merge' | 'idle' | 'done';
  message: string;
  task?: LoopTask;
  attempt?: number;
}

export interface RunLoopOptions {
  runtime: AgentRuntime;
  workspace: Workspace;
  config: SwarmConfig;
  /** Stop after this many missions. */
  maxMissions?: number;
  /** Stop after this many hours. */
  maxHours?: number;
  /** Only work on these modules. */
  modules?: string[];
  /** Stop after this many consecutive failed missions. */
  maxConsecutiveFailures?: number;
  /** Plan and report without running anything. */
  dryRun?: boolean;
  onProgress?: (progress: LoopProgress) => void;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

/**
 * Turn structural signals into things a mission can be asked to do.
 *
 * Only signals with a clear remedy become tasks. `import-cycle` and
 * `unowned-files` are real problems but they are decisions about boundaries,
 * not work an isolated module agent can carry out, so an unattended loop leaves
 * them for a person.
 */
export function tasksFromSignals(signals: Signal[]): LoopTask[] {
  const tasks: LoopTask[] = [];

  for (const signal of signals) {
    if (!signal.module) continue;

    const goal = goalFor(signal);
    if (!goal) continue;

    tasks.push({
      key: `${signal.kind}:${signal.module}`,
      module: signal.module,
      goal,
      severity: signal.severity,
      source: 'signal',
    });
  }

  const rank = { high: 0, warn: 1, info: 2 } as const;
  return tasks.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function goalFor(signal: Signal): string | undefined {
  const biggest = signal.evidence.find((e) => /\d+\s+lines/.test(e));
  switch (signal.kind) {
    case 'god-file':
      return (
        `Split the oversized files in this module into focused units. ` +
        (biggest ? `Start with ${biggest}. ` : '') +
        `Separate distinct responsibilities into their own files, keep every ` +
        `existing export working, and change no behaviour — this is a pure ` +
        `reorganisation and must be verifiable as one.`
      );
    case 'untested-module':
      return (
        `This module has no tests. Add tests for its most important behaviour, ` +
        `using whatever test framework the project already uses. If the project ` +
        `has no test setup at all, say so and stop rather than introducing one.`
      );
    case 'junk-drawer':
      return (
        `Files here live under names that say nothing — utils, helpers, misc. ` +
        `Move each into a module named for what it actually does, updating every ` +
        `import. Change no behaviour.`
      );
    case 'flat-directory':
      return (
        `A directory here holds many files with no structure. Group them into ` +
        `subdirectories that reflect what they do, updating every import. ` +
        `Change no behaviour.`
      );
    case 'deep-nesting':
      return (
        `Files here are nested very deeply, which usually stands in for an ` +
        `abstraction that was never written. Flatten the hierarchy where the ` +
        `depth carries no meaning. Change no behaviour.`
      );
    default:
      // scattered-module, memory-pressure, import-cycle, unowned-files,
      // ownership-conflict, size-imbalance: all boundary decisions, not work.
      return undefined;
  }
}

export async function runLoop(options: RunLoopOptions): Promise<LoopResult> {
  const { workspace, config, runtime } = options;
  const report = (p: LoopProgress): void => options.onProgress?.(p);

  const startedAt = new Date();
  const maxMissions = options.maxMissions ?? 20;
  const maxHours = options.maxHours ?? 5;
  const maxFailures = options.maxConsecutiveFailures ?? 3;

  // A dirty tree means uncommitted work that a mission's worktree would branch
  // away from and a merge could later bury.
  if (!(await isWorkingTreeCleanIgnoringSwarm(workspace.repoRoot))) {
    return finish('dirty-tree', '', []);
  }

  // -- one integration branch for the whole run -----------------------------
  const base = await currentBranch(workspace.repoRoot);
  const branch = `swarm/auto/${startedAt.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  const created = await git(workspace.repoRoot, ['checkout', '-b', branch]);
  if (!created.ok) {
    return finish('aborted', branch, [], `could not create ${branch}: ${created.stderr}`);
  }

  const attempts: LoopAttempt[] = [];
  const attempted = new Set<string>();
  let consecutiveFailures = 0;
  let merged = 0;
  let stop: LoopStop = 'nothing-left';

  outer: while (true) {
    if (options.signal?.aborted) {
      stop = 'aborted';
      break;
    }
    if (attempts.length >= maxMissions) {
      stop = 'mission-budget';
      break;
    }
    if (Date.now() - startedAt.getTime() > maxHours * 3600_000) {
      stop = 'time-budget';
      break;
    }
    if (consecutiveFailures >= maxFailures) {
      stop = 'consecutive-failures';
      break;
    }

    // -- survey: free, and it reflects the work already merged --------------
    report({ phase: 'survey', message: 'looking at the repository again' });
    const signals = await survey(workspace, config);
    const candidates = tasksFromSignals(signals)
      .filter((t) => !attempted.has(t.key))
      .filter((t) => !options.modules || (t.module && options.modules.includes(t.module)));

    const task = candidates[0];
    if (!task) {
      stop = 'nothing-left';
      break;
    }
    attempted.add(task.key);

    report({
      phase: 'pick',
      message: `${task.severity} · ${task.module ?? 'repository'}`,
      task,
      attempt: attempts.length + 1,
    });

    if (options.dryRun) {
      attempts.push({
        task,
        startedAt: new Date().toISOString(),
        modules: [],
        merged: false,
        note: 'dry run',
      });
      continue;
    }

    const attempt: LoopAttempt = {
      task,
      startedAt: new Date().toISOString(),
      modules: [],
      merged: false,
    };

    // -- the mission --------------------------------------------------------
    report({ phase: 'mission', message: task.goal.slice(0, 80), task });
    let results: MissionModuleResult[] = [];
    try {
      const mission = await runMission({
        runtime,
        workspace,
        config,
        goal: task.goal,
        ...(task.module ? { modules: [task.module] } : {}),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      results = mission.modules;
    } catch (err) {
      attempt.note = err instanceof Error ? err.message : String(err);
      attempt.finishedAt = new Date().toISOString();
      attempts.push(attempt);
      consecutiveFailures += 1;
      continue;
    }

    attempt.modules = results.map((r) => ({
      module: r.module,
      status: r.report?.status ?? (r.ok ? 'finished' : 'failed'),
      ...(r.review ? { review: r.review.verdict } : {}),
      changed: r.changedFiles.length,
    }));

    const usable = results.filter(
      (r) => r.branch && r.changedFiles.length > 0 && r.review?.verdict !== 'reject',
    );

    if (usable.length === 0) {
      attempt.note = results.some((r) => r.review?.verdict === 'reject')
        ? 'review rejected the change'
        : 'no usable change produced';
      attempt.finishedAt = new Date().toISOString();
      attempts.push(attempt);
      consecutiveFailures += 1;
      continue;
    }

    // -- prove it, then merge ----------------------------------------------
    // Verification happens in the mission's own worktree, before anything
    // touches the integration branch. The alternative — merge, verify, reset on
    // failure — needs a `git reset --hard` in the developer's checkout, and a
    // reset there destroys any uncommitted work they had. An unattended process
    // must not own an operation that can do that.
    //
    // Each branch was cut from the current integration head, so verifying it in
    // isolation is verifying the combination.
    if (config.verifyCommand) {
      report({ phase: 'verify', message: config.verifyCommand, task });
      for (const result of usable) {
        const passed = result.worktree
          ? await runVerify(result.worktree, config.verifyCommand, config.verifyEnv)
          : false;
        if (!passed) {
          attempt.verified = false;
          attempt.note = `${config.verifyCommand} failed — nothing merged`;
          attempt.finishedAt = new Date().toISOString();
          attempts.push(attempt);
          consecutiveFailures += 1;
          continue outer;
        }
      }
      attempt.verified = true;
    }

    let mergedAny = false;
    for (const result of usable) {
      const res = await git(workspace.repoRoot, ['merge', '--no-edit', result.branch as string]);
      if (res.ok) mergedAny = true;
      else await git(workspace.repoRoot, ['merge', '--abort']);
    }

    if (!mergedAny) {
      attempt.note = 'merge conflicted';
      attempt.finishedAt = new Date().toISOString();
      attempts.push(attempt);
      consecutiveFailures += 1;
      continue;
    }

    report({ phase: 'merge', message: `kept ${usable.length} change(s)`, task });
    attempt.merged = true;
    attempt.finishedAt = new Date().toISOString();
    attempts.push(attempt);
    merged += 1;
    consecutiveFailures = 0;
  }

  await git(workspace.repoRoot, ['checkout', base]);
  return finish(stop, branch, attempts, undefined, merged);

  function finish(
    because: LoopStop,
    branchName: string,
    list: LoopAttempt[],
    note?: string,
    mergedCount = 0,
  ): LoopResult {
    report({ phase: 'done', message: note ?? because });
    return {
      branch: branchName,
      stoppedBecause: because,
      attempts: list,
      merged: mergedCount,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }
}

/** The deterministic pass, re-run each round so it sees the merged work. */
async function survey(workspace: Workspace, config: SwarmConfig): Promise<Signal[]> {
  const modules = await workspace.listModules();
  const digest = await buildDigest(workspace.repoRoot);
  const stats = await countLines(workspace.repoRoot, digest.files);
  const imports = await buildImportGraph(workspace.repoRoot, digest.files, modules);

  const memory: Record<string, { tokens: number; landmarks: number }> = {};
  for (const spec of modules) {
    const text = await workspace.readModuleFile(spec.slug, 'memory.md');
    memory[spec.slug] = { tokens: estimateTokens(text), landmarks: 0 };
  }

  return computeSignals({
    modules,
    files: digest.files,
    memory,
    memoryBudget: config.memoryBudgetTokens,
    stats,
    imports,
  }).signals;
}

/**
 * Run the verify command inside a worktree.
 *
 * The environment matters as much as the command. A worktree is a bare
 * checkout and a project's installed tooling still points at the original
 * clone, so without help the verification runs against the wrong source or
 * fails to resolve it at all. Both look like the change is broken when it is
 * not — and an unattended loop then throws away work that was correct.
 *
 * Observed: a mission split a 1,712-line module into a clean package, the
 * reviewer approved it, and the gate rejected it with 246 collection errors
 * that were entirely an artefact of the worktree. With PYTHONPATH pointed at
 * the worktree's own sources the same branch passed the whole suite.
 */
async function runVerify(
  worktree: string,
  command: string,
  extraEnv: Record<string, string> = {},
): Promise<boolean> {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { join, isAbsolute } = await import('node:path');

  const env: NodeJS.ProcessEnv = { ...process.env };

  // PYTHONPATH precedes site-packages, so pointing it at the worktree's own
  // sources shadows an editable install pointing at the original clone.
  if (existsSync(join(worktree, 'src')) && existsSync(join(worktree, 'pyproject.toml'))) {
    const own = join(worktree, 'src');
    env['PYTHONPATH'] = env['PYTHONPATH'] ? `${own}:${env['PYTHONPATH']}` : own;
  }

  for (const [key, value] of Object.entries(extraEnv)) {
    env[key] = isAbsolute(value) ? value : join(worktree, value);
  }

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: worktree,
      shell: true,
      env,
      stdio: 'ignore',
      // A hung build must not hold a five-hour run hostage.
      timeout: 15 * 60_000,
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
