/**
 * Git worktree lifecycle.
 *
 * Every work agent gets its own checkout so parallel swarms cannot fight over
 * the index or the working tree. Worktrees live under `.swarm/worktrees/` and
 * are ignored by git via `.swarm/.gitignore`, so they never show up as
 * untracked noise in the parent repo.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export async function git(repoRoot: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: repoRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? 'git failed' };
  }
}

export async function isGitRepo(repoRoot: string): Promise<boolean> {
  const res = await git(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  return res.ok && res.stdout.trim() === 'true';
}

export async function currentBranch(repoRoot: string): Promise<string> {
  const res = await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return res.ok ? res.stdout.trim() : 'HEAD';
}

export async function isWorkingTreeClean(repoRoot: string): Promise<boolean> {
  const res = await git(repoRoot, ['status', '--porcelain']);
  return res.ok && res.stdout.trim() === '';
}

export interface WorktreeHandle {
  path: string;
  branch: string;
  /** True when this call created it; false when an existing one was reused. */
  created: boolean;
}

/** Make sure worktrees are invisible to the parent repo's status. */
export async function ensureWorktreeIgnore(repoRoot: string, worktreeRoot: string): Promise<void> {
  // `.swarm/worktrees` is the default; keep the ignore file next to it.
  const swarmDir = join(repoRoot, '.swarm');
  await mkdir(swarmDir, { recursive: true });
  const ignorePath = join(swarmDir, '.gitignore');
  const rel = worktreeRoot.replace(/^\.swarm\//, '');
  const body = [
    '# Agent worktrees are disposable checkouts, never committed.',
    `${rel}/`,
    '',
    '# Raw event logs can get large; mission.json carries the durable summary.',
    'missions/*/events.jsonl',
    '',
  ].join('\n');
  if (!existsSync(ignorePath)) await writeFile(ignorePath, body, 'utf8');
}

/**
 * Create (or reuse) a worktree on its own branch.
 * The branch is derived from the mission and module so it reads well in `git log`.
 */
export async function createWorktree(options: {
  repoRoot: string;
  worktreeRoot: string;
  name: string;
  branch: string;
  base?: string;
}): Promise<WorktreeHandle> {
  const { repoRoot, worktreeRoot, name, branch } = options;
  const path = join(repoRoot, worktreeRoot, name);

  await ensureWorktreeIgnore(repoRoot, worktreeRoot);
  await mkdir(join(repoRoot, worktreeRoot), { recursive: true });

  if (existsSync(join(path, '.git'))) {
    return { path, branch, created: false };
  }

  const base = options.base ?? (await currentBranch(repoRoot));

  // Reuse the branch if it already exists, otherwise create it.
  const branchExists = (await git(repoRoot, ['rev-parse', '--verify', branch])).ok;
  const args = branchExists
    ? ['worktree', 'add', path, branch]
    : ['worktree', 'add', '-b', branch, path, base];

  const res = await git(repoRoot, args);
  if (!res.ok) throw new Error(`could not create worktree ${name}: ${res.stderr.trim()}`);

  return { path, branch, created: true };
}

export async function removeWorktree(repoRoot: string, path: string): Promise<void> {
  await git(repoRoot, ['worktree', 'remove', '--force', path]);
}

export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await git(repoRoot, ['worktree', 'prune']);
}

/** Files changed in a worktree relative to its base, staged or not. */
export async function changedFiles(worktreePath: string, base: string): Promise<string[]> {
  const tracked = await git(worktreePath, ['diff', '--name-only', base]);
  const untracked = await git(worktreePath, ['ls-files', '--others', '--exclude-standard']);
  const files = new Set<string>();
  for (const line of `${tracked.stdout}\n${untracked.stdout}`.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) files.add(trimmed);
  }
  return [...files].sort();
}

/** Unified diff stat for a worktree, for the mission report. */
export async function diffStat(worktreePath: string, base: string): Promise<string> {
  const res = await git(worktreePath, ['diff', '--stat', base]);
  return res.ok ? res.stdout.trim() : '';
}

export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<{ ok: boolean; detail: string }> {
  const add = await git(worktreePath, ['add', '-A']);
  if (!add.ok) return { ok: false, detail: add.stderr.trim() };
  const status = await git(worktreePath, ['status', '--porcelain']);
  if (status.stdout.trim() === '') return { ok: true, detail: 'nothing to commit' };
  const commit = await git(worktreePath, ['commit', '-m', message]);
  return commit.ok
    ? { ok: true, detail: commit.stdout.trim() }
    : { ok: false, detail: commit.stderr.trim() };
}
