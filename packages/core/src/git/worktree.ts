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
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isOwned } from '../swarm/ownership.js';

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

/**
 * Clean, disregarding Swarm OS's own files.
 *
 * A loop cannot require a spotless tree and then dirty it itself on the first
 * mission. Changes under `.swarm/` are the tool's bookkeeping and never the
 * user's work, so they do not count — which also keeps this working on a repo
 * that committed those files before they were ignored.
 */
export async function isWorkingTreeCleanIgnoringSwarm(repoRoot: string): Promise<boolean> {
  const res = await git(repoRoot, ['status', '--porcelain']);
  if (!res.ok) return false;
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .every((line) => line.slice(2).trim().replace(/^"|"$/g, '').startsWith('.swarm/'));
}

export interface WorktreeHandle {
  path: string;
  branch: string;
  /** True when this call created it; false when an existing one was reused. */
  created: boolean;
  /** Dependency directories linked in so the worktree can be built. */
  linked?: string[];
}

/**
 * Keep Swarm OS's own bookkeeping out of the repository's status.
 *
 * `.swarm/` holds two different kinds of thing. The module map, each module's
 * memory and the config are shared knowledge — they belong in version control,
 * and a colleague cloning the repo should get them. Mission records, swarm
 * state, logs, generated views and agent worktrees are per-run and per-machine.
 *
 * Committing the second kind is not merely untidy: a mission writes its own
 * record while it runs, so the tool dirties the working tree of the repository
 * it is working on. An autonomous loop then fails its own clean-tree check on
 * the second round, having caused the problem itself.
 */
export async function ensureSwarmIgnore(repoRoot: string, worktreeRoot: string): Promise<void> {
  const swarmDir = join(repoRoot, '.swarm');
  await mkdir(swarmDir, { recursive: true });
  const rel = worktreeRoot.replace(/^\.swarm\//, '');
  const body = [
    '# Written by Swarm OS. Everything here is per-run or per-machine.',
    '# The module map, memories and config are NOT ignored — they are shared.',
    '',
    '# Disposable checkouts, one per agent per mission.',
    `${rel}/`,
    '',
    '# Records of individual runs.',
    'missions/',
    'loop.log',
    'loop.json',
    '',
    '# Local swarm state and fingerprints — specific to this checkout.',
    'state.json',
    '',
    '# Generated on demand.',
    'view.html',
    'REFACTOR.md',
    'refactor.json',
    'archive/',
    '',
  ].join('\n');
  // Rewritten rather than preserved: an older, narrower version is exactly the
  // problem this fixes.
  await writeFile(join(swarmDir, '.gitignore'), body, 'utf8');
}

/** @deprecated Use {@link ensureSwarmIgnore}. */
export const ensureWorktreeIgnore = ensureSwarmIgnore;

/**
 * Create (or reuse) a worktree on its own branch.
 * The branch is derived from the mission and module so it reads well in `git log`.
 */
/**
 * Link a repo's installed dependencies into a worktree.
 *
 * Symlinks, not copies: `node_modules` is routinely hundreds of megabytes and
 * every agent gets its own worktree. The link points at the developer's own
 * installed tree, which is the same one their build already uses.
 *
 * Returns the names that were linked. Missing sources are skipped silently —
 * a repo with no `node_modules` is not an error, it is a repo in another
 * language.
 */
export async function linkDependencies(
  repoRoot: string,
  worktreePath: string,
  names: string[],
): Promise<string[]> {
  const linked: string[] = [];
  for (const name of names) {
    const source = join(repoRoot, name);
    const target = join(worktreePath, name);
    if (!existsSync(source) || existsSync(target)) continue;
    try {
      await symlink(source, target);
      linked.push(name);
    } catch {
      // A failed link is not fatal; the agent will report it cannot build.
    }
  }
  return linked;
}

export async function createWorktree(options: {
  repoRoot: string;
  worktreeRoot: string;
  name: string;
  branch: string;
  base?: string;
  /** Gitignored directories to link in so the worktree is buildable. */
  links?: string[];
}): Promise<WorktreeHandle> {
  const { repoRoot, worktreeRoot, name, branch } = options;
  const path = join(repoRoot, worktreeRoot, name);

  await ensureSwarmIgnore(repoRoot, worktreeRoot);
  await mkdir(join(repoRoot, worktreeRoot), { recursive: true });

  if (existsSync(join(path, '.git'))) {
    const linked = await linkDependencies(repoRoot, path, options.links ?? []);
    return { path, branch, created: false, linked };
  }

  const base = options.base ?? (await currentBranch(repoRoot));

  // Reuse the branch if it already exists, otherwise create it.
  const branchExists = (await git(repoRoot, ['rev-parse', '--verify', branch])).ok;
  const args = branchExists
    ? ['worktree', 'add', path, branch]
    : ['worktree', 'add', '-b', branch, path, base];

  const res = await git(repoRoot, args);
  if (!res.ok) throw new Error(`could not create worktree ${name}: ${res.stderr.trim()}`);

  const linked = await linkDependencies(repoRoot, path, options.links ?? []);

  return { path, branch, created: true, linked };
}

export async function removeWorktree(repoRoot: string, path: string): Promise<void> {
  await git(repoRoot, ['worktree', 'remove', '--force', path]);
}

export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await git(repoRoot, ['worktree', 'prune']);
}

/**
 * Whether `path` is (or is under) one of the linked dependency directories.
 *
 * Linked entries are compared by top-level name, not by re-scanning the
 * filesystem for symlinks — `linked` is the source of truth handed down from
 * {@link linkDependencies}.
 */
function isLinkedPath(path: string, linked: string[]): boolean {
  return linked.some((name) => path === name || path.startsWith(`${name}/`));
}

/**
 * Files changed in a worktree relative to its base, staged or not.
 *
 * `linked` excludes the agent's own dependency symlinks (e.g. `node_modules`)
 * from the result. A directory-style `.gitignore` pattern like `node_modules/`
 * does not match a symlink of that name, so without this every mission would
 * report its linked dependencies as changed — and, worse, as an ownership
 * violation.
 */
export async function changedFiles(
  worktreePath: string,
  base: string,
  linked: string[] = [],
): Promise<string[]> {
  const tracked = await git(worktreePath, ['diff', '--name-only', base]);
  const untracked = await git(worktreePath, ['ls-files', '--others', '--exclude-standard']);
  const files = new Set<string>();
  for (const line of `${tracked.stdout}\n${untracked.stdout}`.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !isLinkedPath(trimmed, hiddenFromWork(linked))) files.add(trimmed);
  }
  return [...files].sort();
}

/**
 * Pathspecs that hide linked dependency names from a diff.
 *
 * `linkDependencies` plants symlinks (`.venv`, `node_modules`) in every worktree.
 * `commitAll` and `changedFiles` already exclude them, but the diff handed to the
 * reviewer did not — so every mission's reviewer rediscovered the same symlink and
 * spent a finding on it, once at blocker severity. The reviewer must see exactly
 * what can land, nothing else.
 */
/**
 * The machinery's own directory. Work agents may scribble in `.swarm/` (their
 * charter tells them to note decisions), but those edits must never ride a
 * mission branch: the memory compressor rewrites the same files on the main
 * checkout at mission end, so a branch carrying `.swarm/**` guarantees a merge
 * conflict with the machinery itself, and reviewers kept flagging the edits as
 * out-of-bounds noise. Memory belongs to the compressor; branches carry work.
 */
const SWARM_DIR = '.swarm';

function hiddenFromWork(linked: string[]): string[] {
  return [...linked, SWARM_DIR];
}

function excludeLinked(linked: string[]): string[] {
  const hidden = hiddenFromWork(linked);
  return ['--', '.', ...hidden.map((name) => `:(exclude)${name}`)];
}

/** Unified diff stat for a worktree, for the mission report. */
export async function diffStat(
  worktreePath: string,
  base: string,
  linked: string[] = [],
): Promise<string> {
  const res = await git(worktreePath, ['diff', '--stat', base, ...excludeLinked(linked)]);
  return res.ok ? res.stdout.trim() : '';
}

/** Full unified diff of a worktree against its base, including new files. */
export async function fullDiff(
  worktreePath: string,
  base: string,
  linked: string[] = [],
): Promise<string> {
  // Staging untracked files first is what makes them appear in the diff at all;
  // a review that cannot see newly added files is close to useless.
  await git(worktreePath, ['add', '-AN']);
  const res = await git(worktreePath, ['diff', base, ...excludeLinked(linked)]);
  return res.ok ? res.stdout : '';
}

/**
 * Every path git considers changed in a worktree — staged, unstaged, deleted
 * or untracked — relative to `git status --porcelain`.
 *
 * A rename ("R  old -> new") contributes both sides: the old path still needs
 * classifying (it disappears, and a disappearing owned file is still an owned
 * change) and the new one does too.
 */
function statusPaths(porcelain: string): string[] {
  const paths = new Set<string>();
  for (const raw of porcelain.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const rest = line.slice(2).trim().replace(/^"|"$/g, '');
    for (const part of rest.split(' -> ')) {
      const cleaned = part.trim();
      if (cleaned) paths.add(cleaned);
    }
  }
  return [...paths];
}

/**
 * Stage exactly `paths` — additions, modifications and deletions alike —
 * without touching anything else.
 *
 * Each path is wrapped in `:(literal)` pathspec magic so a filename that
 * happens to contain a glob metacharacter (`*`, `?`, `[`) is matched as
 * itself, not interpreted as a wildcard. Unlike the old `:(exclude)` trick,
 * this never names an ignored path explicitly — every path here came from
 * `git status`, which does not report ignored files in the first place — so
 * it does not reintroduce the "git add fails on an ignored pathspec" failure
 * mode that motivated the old two-step add/unstage.
 */
async function stagePaths(worktreePath: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const pathspecs = paths.map((p) => `:(literal)${p}`);
  const add = await git(worktreePath, ['add', '-A', '--', ...pathspecs]);
  if (!add.ok) throw new Error(add.stderr.trim());
}

/** Commit whatever is currently staged, if anything, and return its short hash. */
async function commitStaged(worktreePath: string, message: string): Promise<string | undefined> {
  const staged = await git(worktreePath, ['diff', '--cached', '--name-only']);
  if (!staged.ok) throw new Error(staged.stderr.trim());
  if (staged.stdout.trim() === '') return undefined;
  const commit = await git(worktreePath, ['commit', '-m', message]);
  if (!commit.ok) throw new Error(commit.stderr.trim());
  const rev = await git(worktreePath, ['rev-parse', '--short', 'HEAD']);
  if (!rev.ok) throw new Error(rev.stderr.trim());
  return rev.stdout.trim();
}

export interface CommitSplit {
  /** Set only when at least one owned path was committed. */
  mainCommitHash?: string;
  /** Set only when at least one out-of-bounds path was committed. */
  quarantineCommitHash?: string;
  /** Every changed path outside the module's `owns` globs, owned or not. */
  quarantinedPaths: string[];
}

/**
 * Stage and commit a worktree's changes split by module ownership.
 *
 * A diff that touches both a module's own files and someone else's — the
 * real incident this fixes deleted another module's audio assets — used to
 * land as one commit, so ownership was something `checkOwnership` reported
 * after the fact rather than something the commit itself enforced. This
 * produces at most two commits instead: a main commit containing only paths
 * matching `ownsGlobs` (per {@link isOwned}), and, only when something falls
 * outside them, a second "OUT OF BOUNDS" commit holding everything else —
 * additions, modifications AND deletions — so a reviewer can drop the second
 * commit with one rebase gesture and keep the first untouched. When nothing
 * is out of bounds there is no second commit; when everything is, the main
 * commit is skipped rather than created empty.
 *
 * `linked` (e.g. `['node_modules']`) and `.swarm/` are excluded from both
 * commits exactly as before — they are filtered out before classification,
 * so neither ever reaches either commit.
 *
 * The index is reset to `HEAD` before anything is classified. A work agent
 * may have run `git add` by hand before this ever runs — historically a
 * linked `.venv` symlink — and `commitStaged` commits whatever the index
 * holds, not just what this function staged. Resetting first means this
 * function is the sole author of what each commit contains; nothing staged
 * outside it can ride along.
 */
export async function commitAll(
  worktreePath: string,
  moduleSlug: string,
  ownsGlobs: string[],
  message: string,
  linked: string[] = [],
): Promise<CommitSplit> {
  const reset = await git(worktreePath, ['reset', '-q', 'HEAD']);
  if (!reset.ok) throw new Error(reset.stderr.trim());

  const status = await git(worktreePath, ['status', '--porcelain', '-uall']);
  if (!status.ok) throw new Error(status.stderr.trim());

  const hidden = hiddenFromWork(linked);
  const changed = statusPaths(status.stdout).filter((p) => !isLinkedPath(p, hidden));
  const owned = changed.filter((p) => isOwned(p, ownsGlobs)).sort();
  const quarantined = changed.filter((p) => !isOwned(p, ownsGlobs)).sort();

  await stagePaths(worktreePath, owned);
  const mainCommitHash = await commitStaged(worktreePath, message);

  let quarantineCommitHash: string | undefined;
  if (quarantined.length > 0) {
    await stagePaths(worktreePath, quarantined);
    const quarantineMessage = `OUT OF BOUNDS (${moduleSlug}): ${quarantined.join(', ')}`;
    quarantineCommitHash = await commitStaged(worktreePath, quarantineMessage);
  }

  return { mainCommitHash, quarantineCommitHash, quarantinedPaths: quarantined };
}
