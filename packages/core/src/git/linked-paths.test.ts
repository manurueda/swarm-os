/**
 * Linked dependency symlinks (e.g. `node_modules`) must stay invisible to
 * both `commitAll` and `changedFiles`.
 *
 * `linkDependencies` creates a symlink, but the conventional `node_modules/`
 * gitignore pattern (trailing slash) only matches a real directory, not a
 * symlink. Without an explicit exclusion, every mission branch would carry an
 * absolute path to one developer's machine, and `changedFiles` would flag it
 * as an ownership violation on every mission.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git, changedFiles, commitAll } from './worktree.js';

/** A real, non-empty git repo with an initial commit. */
async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'swarm-linked-'));
  await writeFile(join(root, 'README.md'), 'hello\n');
  await git(root, ['init', '-q']);
  // Ignore any global excludes (e.g. a developer's own `node_modules` entry)
  // so this test's behaviour does not depend on the machine it runs on.
  await git(root, ['config', 'core.excludesFile', '']);
  await git(root, ['add', '-A']);
  await git(root, [
    '-c', 'user.email=test@example.com',
    '-c', 'user.name=Swarm Test',
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', 'init',
  ]);
  return root;
}

test('commitAll excludes a linked symlink but still commits real changes', async () => {
  const root = await initRepo();
  const scratch = await mkdtemp(join(tmpdir(), 'swarm-linked-target-'));
  try {
    // Simulate what linkDependencies does: a symlink named `node_modules`
    // pointing outside the repo.
    await symlink(scratch, join(root, 'node_modules'));
    // And a genuine, owned change alongside it.
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');

    const result = await commitAll(root, 'add a.ts', ['node_modules']);
    assert.equal(result.ok, true);

    const show = await git(root, ['show', '--stat', 'HEAD']);
    assert.doesNotMatch(show.stdout, /node_modules/);
    assert.match(show.stdout, /a\.ts/);

    const status = await git(root, ['status', '--porcelain']);
    // The symlink remains untracked in the working tree — never staged.
    assert.match(status.stdout, /node_modules/);

    const lsTree = await git(root, ['ls-tree', '-r', '--name-only', 'HEAD']);
    assert.doesNotMatch(lsTree.stdout, /node_modules/);
    assert.match(lsTree.stdout, /a\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  }
});

test('commitAll still commits when the linked path is itself gitignored', async () => {
  // The case that actually broke, and the reason this cannot be done with an
  // `:(exclude)` pathspec. Naming any explicit pathspec makes `git add` FAIL on
  // ignored files rather than skipping them, so the exclusion worked only while
  // the path was not ignored — and a repo that fixed its `.gitignore` to catch
  // the symlink silently stopped committing anything at all. Missions then
  // announced branches that had nothing on them.
  const root = await initRepo();
  const scratch = await mkdtemp(join(tmpdir(), 'swarm-linked-target-'));
  try {
    await writeFile(join(root, '.gitignore'), 'node_modules\n');
    await symlink(scratch, join(root, 'node_modules'));
    await writeFile(join(root, 'c.ts'), 'export const c = 1;\n');

    const result = await commitAll(root, 'add c.ts', ['node_modules']);
    assert.equal(result.ok, true, result.detail);

    const lsTree = await git(root, ['ls-tree', '-r', '--name-only', 'HEAD']);
    assert.match(lsTree.stdout, /c\.ts/, 'the real change must reach the branch');
    assert.doesNotMatch(lsTree.stdout, /node_modules/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  }
});

test('commitAll reports why it failed rather than returning a bare false', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarm-linked-nogit-'));
  try {
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
    const result = await commitAll(root, 'nope', []);
    assert.equal(result.ok, false);
    assert.ok(result.detail.length > 0, 'a silent failure is the worst outcome available');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('changedFiles omits a linked symlink but still reports a real change', async () => {
  const root = await initRepo();
  const scratch = await mkdtemp(join(tmpdir(), 'swarm-linked-target-'));
  try {
    await symlink(scratch, join(root, 'node_modules'));
    await writeFile(join(root, 'b.ts'), 'export const b = 1;\n');

    const base = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const changed = await changedFiles(root, base, ['node_modules']);

    assert.ok(!changed.includes('node_modules'));
    assert.ok(!changed.some((f) => f.startsWith('node_modules/')));
    assert.ok(changed.includes('b.ts'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  }
});
